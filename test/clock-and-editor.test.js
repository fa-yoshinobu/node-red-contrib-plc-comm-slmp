"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const protocol = "slmp";
const api = require("../lib/slmp");

test("clock sample distinguishes readback from acknowledgements and clears SM213", () => {
  const flow = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "examples", "flows", "slmp-set-time.json"), "utf8"));
  const byId = id => flow.find(node => node.id === "slmp-clock-" + id);
  const ids = new Set(flow.map(node => node.id));
  assert.equal(ids.size, flow.length);
  for (const node of flow) {
    for (const id of [...(node.wires || []).flat(), ...(node.scope || []), ...[node.z, node.connection].filter(Boolean)]) {
      assert.ok(ids.has(id), `missing flow reference ${id}`);
    }
    if (node.type === "inject") {
      assert.equal(node.once, false);
      assert.equal(node.repeat, "");
      assert.equal(node.crontab, "");
    }
  }
  assert.equal(flow.find(node => node.type === "slmp-connection").host, "127.0.0.1");
  assert.deepEqual(byId("settime").wires[0], [byId("ack-format").id, byId("set-delay").id]);
  assert.deepEqual(byId("off").wires[0], [byId("compare").id]);
  assert.ok(byId("cleanup-catch").scope.includes(byId("off").id));
  assert.equal(byId("catch").scope.includes(byId("off").id), false, "cleanup failure must not retry the write");

  const now = new Date(2026, 10, 1, 12, 19, 30, 100).getTime();
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const errors = [];
  const run = (id, msg) => vm.runInNewContext("(function(msg,node){" + byId(id).func + "})(msg,node)", {
    msg, Date: FixedDate, node: { error: message => errors.push(message) }
  });
  const snapshot = {"SD210:U,7": [2026, 11, 1, 12, 19, 29, 0], "SM210:BIT": false, "SM211:BIT": false, "SD203:U": 0};
  assert.ok(byId("read").addresses.split("\n").includes("SD210:U,7"));
  const saved = run("save-snapshot", {payload: snapshot});
  assert.equal(saved.snapshot, snapshot);
  assert.equal(saved.updates["SM213:BIT"], false);
  const result = run("compare", saved).payload;
  assert.equal(result.result, "PASS");
  assert.equal(result.deltaMs, -1100);
  assert.equal(result.readRequestRestored, true);
  for (const changed of [
    {"SD210:U,7": [2026, 11, 1, 12, 0, 0, 0]},
    {"SD210:U,7": [2026, 11, 1, 12, 19, 29, 1]},
    {"SM210:BIT": true}, {"SM211:BIT": true}, {"SM211:BIT": undefined}
  ]) {
    assert.equal(run("compare", {snapshot: {...snapshot, ...changed}}).payload.result, "CHECK");
  }
  const failed = run("cleanup-error", {error: {message: "read failed"}});
  assert.equal(failed.updates["SM213:BIT"], false);
  assert.equal(run("compare", failed).payload.result, "FAIL");
  assert.equal(run("compare", {snapshot: {}}), null);
  assert.match(errors[0], /clock readback/);
});

function client(plcProfile = "melsec:iq-r") {
  return new api.SlmpClient({ host: "127.0.0.1", port: 1025, transport: "tcp", plcProfile, target: { network: 0, station: 255, moduleIO: 1023, multidrop: 0 } });
}

// Run the real editor callback with an initially unpopulated select and delayed profile response.
test("saved PLC profiles survive asynchronous option creation and reopening", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "nodes", protocol + "-connection.html"), "utf8");
  const source = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  let definition, callback, selected;
  const options = new Set([""]);
  const select = {
    val(value) { if (!arguments.length) return selected; selected = options.has(value) ? value : null; return this; },
    trigger() { return this; },
    find() { return { remove() { options.clear(); options.add(""); } }; }
  };
  const stub = { is() { return false; }, prop() { return this; }, on() { return this; }, val() { return ""; } };
  const $ = (selector) => {
    if (selector === "#node-config-input-plcProfile") return select;
    if (selector !== "<option>") return stub;
    let value;
    return { val(v) { value = v; return this; }, text() { return this; }, appendTo() { options.add(value); return this; } };
  };
  $.getJSON = (_url, cb) => { callback = cb; };
  vm.runInNewContext(source, { RED: { nodes: { registerType(_type, def) { definition = def; } } }, $ });
  const profiles = api.profileDescriptors();
  for (const profile of profiles.filter(p => p.connectable)) {
    options.clear(); options.add(""); selected = null;
    definition.oneditprepare.call({ plcProfile: profile.canonicalName });
    callback(profiles);
    assert.equal(selected, profile.canonicalName);
    // Reopening starts with a fresh select, just as the editor does.
    options.clear(); options.add(""); selected = "";
    definition.oneditprepare.call({ plcProfile: profile.canonicalName });
    callback(profiles);
    assert.equal(selected, profile.canonicalName);
  }
});

test("set-time node forwards explicit input, preserves messages, and reports failures through done", async () => {
  let Constructor;
  const calls = [];
  const c = client();
  c._request = async (_command, _subcommand, data) => { calls.push(Buffer.from(data)); return { data: Buffer.alloc(0) }; };
  let connection = { getClient() { return c; } };
  const RED = { nodes: {
    createNode(node) { const e = new EventEmitter(); node.on = e.on.bind(e); node.emit = e.emit.bind(e); node.status = s => { node.lastStatus = s; }; },
    getNode() { return connection; },
    registerType(type, ctor) { assert.equal(type, protocol + "-set-time"); Constructor = ctor; }
  } };
  require("../nodes/" + protocol + "-set-time")(RED);
  const node = new Constructor({ connection: "c" });
  const invoke = msg => new Promise(resolve => { const sent = []; node.emit("input", msg, m => sent.push(m), error => resolve({ error, sent })); });
  const msg = { payload: [26, 10, 31, 12, 34, 56, 6], topic: "original", custom: true };
  const result = await invoke(msg);
  assert.equal(result.error, undefined);
  assert.equal(result.sent[0], msg);
  assert.equal(msg.topic, "original");
  assert.equal(node.lastStatus.fill, "green");
  assert.equal(calls.length, 3);
  const sandboxDate = vm.runInNewContext("new Date(2026, 9, 31, 12, 34, 56)");
  assert.equal((await invoke({ payload: sandboxDate })).error, undefined, "Function-node Date must cross the VM boundary");

  const count = calls.length;
  for (const payload of [undefined, null, 0, "2026-10-31", [], [26, 2, 30, 1, 2, 3, 1], [26, 10, 31, 12, 34, 56, 0], new Date(NaN)]) {
    const failed = await invoke({ payload });
    assert.ok(failed.error);
    assert.equal(failed.sent.length, 0);
    assert.equal(node.lastStatus.fill, "red");
  }
  assert.equal(calls.length, count, "invalid inputs must not send");
  c.setTime = async () => { throw new Error("transport failure"); };
  const failed = await invoke({ payload: new Date(2026, 9, 31) });
  assert.match(failed.error.message, /transport failure/);
  assert.deepEqual(failed.sent, []);
  connection = undefined;
  const missing = new Constructor({});
  await new Promise(resolve => missing.emit("input", msg, () => assert.fail("unexpected output"), error => { assert.match(error.message, /connection/); resolve(); }));
});

test("SLMP clock encoding, route forwarding, serialization and partial failure", async () => {
  const cases = [
    ["melsec:iq-r", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:iq-r:rj71en71", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:iq-f", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:iq-l", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:mx-f", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:mx-r", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:mx-r:rj71en71", [2026, 10, 31, 12, 34, 56, 6]],
    ["melsec:qnu", [0x2610, 0x3112, 0x3456, 0x2006]],
    ["melsec:qnu:qj71e71-100", [0x2610, 0x3112, 0x3456, 0x2006]],
    ["melsec:qnudv", [0x2610, 0x3112, 0x3456, 0x2006]],
    ["melsec:qnudv:qj71e71-100", [0x2610, 0x3112, 0x3456, 0x2006]],
    ["melsec:qcpu:qj71e71-100", [0x2610, 0x3112, 0x3456, 0x2006]],
    ["melsec:lcpu", [0x2610, 0x3112, 0x3456, 0x2006]],
    ["melsec:lcpu:lj71e71-100", [0x2610, 0x3112, 0x3456, 0x2006]]
  ];
  assert.deepEqual(cases.map(([profile]) => profile).sort(),
    api.profileDescriptors().filter(profile => profile.connectable).map(profile => profile.canonicalName).sort(),
    "every connectable profile must have clock wire coverage");
  for (const [profile, expected] of cases) {
    const c = client(profile);
    const wire = [];
    c._request = async (command, subcommand, data) => { wire.push({command, subcommand, data: Buffer.from(data)}); return {data: Buffer.alloc(0)}; };
    await c.setTime([26, 10, 31, 12, 34, 56, 6]);
    assert.deepEqual(wire.map(x => x.command), [0x1401, 0x1401, 0x1401]);
    assert.deepEqual(Array.from({length: expected.length}, (_, i) => wire[1].data.readUInt16LE(wire[1].data.length - expected.length * 2 + i * 2)), expected);
    assert.equal(wire[0].data.at(-1), 0);
    assert.equal(wire[2].data.at(-1), 0x10);
    const calls = [];
    c.writeDevices = async (device, values, options) => { calls.push({device, values, options}); await new Promise(resolve => setImmediate(resolve)); };
    const options = { target: { network: 1, station: 2, moduleIO: 1023, multidrop: 0 } };
    await Promise.all([c.setTime([26, 10, 31, 12, 34, 56, 6], options), c.setTime(new Date(2026, 9, 31, 12, 34, 56), options)]);
    assert.deepEqual(calls.map(x => x.device), ["SM210", "SD210", "SM210", "SM210", "SD210", "SM210"]);
    assert.deepEqual(calls[0].values, [false]);
    assert.deepEqual(calls[1].values, expected);
    assert.deepEqual(calls[2].values, [true]);
    assert.equal(calls[0].options.target, options.target);
    assert.equal(calls[1].options.bitUnit, false);
  }
  const c = client(); let sends = 0;
  c.writeDevices = async () => { sends++; if (sends === 2) throw new Error("write failed"); };
  await assert.rejects(c.setTime([26, 10, 31, 12, 34, 56, 6]), /write failed/);
  assert.equal(sends, 2, "must not trigger SM210 after failed clock data write");
  sends = 0;
  for (const value of [[-20,1,1,0,0,0,2], [80,1,1,0,0,0,1], [26,1,1,24,0,0,4], [26,1,1,0,0,60,4], [26,1,1,0,0,0,"4"], new Date(2100,0,1)]) {
    await assert.rejects(c.setTime(value));
  }
  c.plcProfile = "melsec:unknown";
  await assert.rejects(c.setTime(new Date()), /not verified/);
  assert.equal(sends, 0);
});
