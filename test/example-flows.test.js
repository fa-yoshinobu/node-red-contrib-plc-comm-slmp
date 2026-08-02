"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const flowDirectory = path.join(__dirname, "..", "examples", "flows");
const controlledWriteFlows = [
  "slmp-basic-read-write.json",
  "slmp-array-string.json",
  "slmp-udp-read-write.json",
  "slmp-demo.json",
];

function loadFlow(fileName) {
  return JSON.parse(fs.readFileSync(path.join(flowDirectory, fileName), "utf8"));
}

function byId(flow, id) {
  const node = flow.find((candidate) => candidate.id === id);
  assert.ok(node, `missing node ${id}`);
  return node;
}

function runFunction(flow, id, msg) {
  const node = byId(flow, id);
  assert.equal(node.type, "function", id);
  const execute = new Function("msg", "node", node.func);
  return execute(msg, {
    error(error) {
      throw error instanceof Error ? error : new Error(String(error));
    },
  });
}

function makeClient() {
  const calls = [];
  return {
    calls,
    plcProfile: "melsec:iq-r",
    async writeRandomWords(options) {
      calls.push({ kind: "writeRandomWords", options });
    },
    async writeBlock(options) {
      calls.push({ kind: "writeBlock", options });
    },
    async readDevices(device, points, options) {
      calls.push({ kind: "readDevices", device, points, options });
      return [0];
    },
    async writeDevices(device, values, options) {
      calls.push({ kind: "writeDevices", device, values: Array.from(values), options });
    },
  };
}

function createWriteRuntime(flow, client) {
  let WriteConstructor;
  const connection = {
    getClient: () => client,
    getProfile: () => ({
      plcProfile: "melsec:iq-r",
      host: "127.0.0.1",
      port: 1025,
      transport: "tcp",
      frameType: "4e",
      plcSeries: "iqr",
      target: { network: 0, station: 0xff, moduleIO: 0x03ff, multidrop: 0 },
    }),
  };
  const RED = {
    nodes: {
      createNode(node, config) {
        const emitter = new EventEmitter();
        node.on = emitter.on.bind(emitter);
        node.emit = emitter.emit.bind(emitter);
        node.status = () => {};
        node.warn = () => {};
        node.credentials = {};
        node.id = config.id;
      },
      registerType(name, constructor) {
        if (name === "slmp-write") WriteConstructor = constructor;
      },
      getNode(id) {
        return flow.some((node) => node.id === id && node.type === "slmp-connection")
          ? connection
          : null;
      },
    },
    util: {
      evaluateNodeProperty(_value, _type, _node, _msg, callback) {
        callback(new Error("configured fallback must not be evaluated when msg.updates is present"));
      },
    },
  };
  require("../nodes/slmp-write")(RED);
  assert.ok(WriteConstructor, "slmp-write registered");
  return function create(id) {
    return new WriteConstructor(byId(flow, id));
  };
}

function invokeWrite(node, msg) {
  return new Promise((resolve, reject) => {
    const sent = [];
    node.emit("input", msg, (output) => sent.push(output), (error) => {
      if (error) {
        reject(error);
        return;
      }
      assert.equal(sent.length, 1);
      if (Array.isArray(sent[0])) {
        reject(sent[0][1]?.error ?? new Error("slmp-write routed an unknown error"));
        return;
      }
      resolve(sent[0]);
    });
  });
}

test("saved write flows are manual snapshot/random/restore sequences", () => {
  for (const fileName of controlledWriteFlows) {
    const flow = loadFlow(fileName);
    const tab = flow.find((node) => node.type === "tab");
    const comment = flow.find((node) => node.type === "comment");
    const writeInject = flow.find((node) => node.type === "inject" && /random \+ restore/i.test(node.name));
    assert.ok(writeInject, `${fileName}: explicit random + restore Inject`);
    assert.equal(writeInject.props.some((property) => property.p === "updates"), false, fileName);
    const next = byId(flow, writeInject.wires[0][0]);
    assert.equal(next.type, "slmp-read", `${fileName}: write path snapshots before writing`);
    const safety = `${tab.info} ${comment.info}`;
    assert.match(safety, /controlled test/i, fileName);
    assert.match(safety, /restore/i, fileName);
    assert.match(safety, /outcome[- ]unknown/i, fileName);
  }
});

test("basic flow restores word and float writes while bit-in-word stays read-only", async () => {
  const flow = loadFlow("slmp-basic-read-write.json");
  const gettingStarted = fs.readFileSync(
    path.join(__dirname, "..", "docsrc", "user", "GETTING_STARTED.md"),
    "utf8",
  );
  const client = makeClient();
  const createWrite = createWriteRuntime(flow, client);
  const original = { "D300:U": 11, "D301:U": 22, "D200:F": 1.5, "D302.3": false };

  assert.match(byId(flow, "read-basic").addresses, /^D302\.3$/m);
  assert.doesNotMatch(byId(flow, "read-basic-original").addresses, /^D302\.3$/m);
  assert.equal(
    flow.some((node) => node.type === "slmp-write" && /bit/i.test(`${node.id} ${node.name}`)),
    false,
  );
  assert.match(`${byId(flow, "tab-slmp-basic").info} ${byId(flow, "comment-slmp-basic").info}`, /D302\.3.*read-only/is);
  assert.match(gettingStarted, /D302\.3.*read-only/is);
  assert.doesNotMatch(gettingStarted, /bit-in-word writes/i);

  let msg = runFunction(flow, "prepare-basic-random", { payload: { ...original } });
  assert.deepEqual(Object.keys(msg.updates).sort(), ["D300:U", "D301:U"]);
  assert.equal(Object.hasOwn(msg.updates, "D302.3"), false);
  msg = await invokeWrite(createWrite("write-basic"), msg);

  msg = runFunction(flow, "prepare-basic-random-float", msg);
  assert.deepEqual(Object.keys(msg.updates), ["D200:F"]);
  assert.equal(typeof msg.updates["D200:F"], "number");
  msg = await invokeWrite(createWrite("write-basic-float"), msg);

  msg = runFunction(flow, "prepare-basic-restore-float", msg);
  assert.deepEqual(msg.updates, { "D200:F": 1.5 });
  msg = await invokeWrite(createWrite("restore-basic-float"), msg);

  msg = runFunction(flow, "prepare-basic-restore-words", msg);
  assert.deepEqual(msg.updates, { "D300:U": 11, "D301:U": 22 });
  await invokeWrite(createWrite("restore-basic-words"), msg);

  assert.equal(client.calls.filter((call) => call.kind.startsWith("write")).length, 4);
  assert.equal(client.calls.filter((call) => call.kind === "readDevices").length, 0);
});

for (const flowCase of [
  {
    fileName: "slmp-array-string.json",
    prepare: "prepare-array-random",
    write: "write-array-string",
    prepareRestore: "prepare-array-restore",
    restore: "restore-array-string",
    original: {
      "D300:U,10": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      "D200:F,2": [1.25, -2.5],
      "D320:STR,10": "ORIGINAL10",
    },
  },
  {
    fileName: "slmp-udp-read-write.json",
    prepare: "prepare-udp-random",
    write: "write-udp",
    prepareRestore: "prepare-udp-restore",
    restore: "restore-udp",
    original: { "D300:U,4": [10, 11, 12, 13], "D320:STR,10": "ORIGINAL10" },
  },
  {
    fileName: "slmp-demo.json",
    prepare: "prepare-demo-random",
    write: "write-demo",
    prepareRestore: "prepare-demo-restore",
    restore: "restore-demo",
    original: { "D300:U,3": [10, 11, 12], "D320:STR,10": "ORIGINAL10" },
  },
]) {
  test(`${flowCase.fileName} executes current msg.updates snapshot and restore path`, async () => {
    const flow = loadFlow(flowCase.fileName);
    const client = makeClient();
    const createWrite = createWriteRuntime(flow, client);
    let msg = runFunction(flow, flowCase.prepare, { payload: structuredClone(flowCase.original) });
    assert.ok(msg.updates && typeof msg.updates === "object");
    assert.equal(Object.hasOwn(msg, "payload"), false);
    msg = await invokeWrite(createWrite(flowCase.write), msg);
    msg = runFunction(flow, flowCase.prepareRestore, msg);
    assert.deepEqual(msg.updates, flowCase.original);
    await invokeWrite(createWrite(flowCase.restore), msg);
    assert.equal(client.calls.filter((call) => call.kind === "writeBlock").length, 2);
  });
}

test("device matrix exposes only read controls and has no wire to its write node", () => {
  const flow = loadFlow("slmp-device-matrix.json");
  const writeControlIds = ["inject-device-matrix-run-all-write", "inject-device-matrix-write"];
  for (const id of writeControlIds) {
    const control = byId(flow, id);
    const mode = control.props.find((property) => property.p === "mode");
    assert.equal(mode.v, "catalog", id);
    assert.match(control.name, /writes disabled/i, id);
  }
  const router = byId(flow, "function-device-matrix-router");
  assert.deepEqual(router.wires[1], []);
  assert.match(byId(flow, "tab-slmp-device-matrix").info, /read-only/i);
});
