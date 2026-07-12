"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const slmp = require("../lib/slmp");
const { formatParsedAddress, normalizeAddress, normalizeAddressList, parseAddress, readNamed, readTyped, writeNamed, writeTyped } = slmp;
const TEST_TARGET = Object.freeze({ network: 0, station: 0xff, moduleIO: 0x03ff, multidrop: 0 });

test("parseAddress supports count and string forms", () => {
  assert.deepEqual(parseAddress("D100:U,10"), {
    base: "D100",
    dtype: "U",
    bitIndex: null,
    count: 10,
    hasCount: true,
    explicitDtype: true,
  });
  assert.deepEqual(parseAddress("D100:STR,10"), {
    base: "D100",
    dtype: "STR",
    bitIndex: null,
    count: 10,
    hasCount: true,
    explicitDtype: true,
  });
  assert.throws(() => parseAddress("DSTR200,8"), /explicit dtype/i);
});

test("normalizeAddress and formatParsedAddress keep one canonical spelling", () => {
  const options = { plcProfile: "melsec:iq-r" };
  assert.equal(normalizeAddress(" d200:f ", options), "D200:F");
  assert.equal(normalizeAddress("d50.a", options), "D50.A");
  assert.equal(normalizeAddress("d50.d", options), "D50.D");
  assert.throws(() => normalizeAddress("dstr200,8", options), /explicit dtype/i);
  assert.throws(() => normalizeAddress("d100:i", options), /unsupported dtype/i);
  assert.throws(() => normalizeAddress("d100:string", options), /unsupported dtype/i);
  assert.equal(formatParsedAddress(parseAddress("D100:U,10"), options), "D100:U,10");
  assert.throws(() => parseAddress("D100,10"), /requires an explicit dtype/i);
  assert.throws(() => parseAddress("D100:BOGUS"), /unsupported dtype/i);
  assert.throws(() => normalizeAddress("D100:BOGUS", options), /unsupported dtype/i);
  assert.throws(() => normalizeAddress("d50.10", options), /invalid bit-in-word/i);
  assert.throws(() => parseAddress("D50:BIT_IN_WORD"), /no bit index/i);
  assert.throws(() => normalizeAddress("x1a:BIT"), /requires options\.plcProfile/i);
  assert.equal(normalizeAddress("x1a:BIT", { plcProfile: "melsec:iq-r" }), "X1A:BIT");
  assert.equal(normalizeAddress("y217:BIT", { plcProfile: "melsec:iq-f" }), "Y217:BIT");
  assert.throws(() => normalizeAddress("x1a:BIT", { plcProfile: "iq-r" }), /Unsupported plcProfile/);
  assert.equal(normalizeAddress("x10:BIT", { plcProfile: "melsec:iq-f" }), "X10:BIT");
  assert.equal(normalizeAddress("x10:BIT", { plcProfile: "melsec:iq-r" }), "X10:BIT");
  for (const missing of [undefined, null, {}, [], { client: { plcProfile: "melsec:iq-r" } }]) {
    assert.throws(
      () => normalizeAddress("D0:U", missing),
      /normalizeAddress requires options\.plcProfile/
    );
    assert.throws(
      () => formatParsedAddress(parseAddress("D0:U"), missing),
      /formatParsedAddress requires options\.plcProfile/
    );
  }
});

test("readNamed and writeNamed reject BIT_IN_WORD without an explicit bit index", async () => {
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices() {
      throw new Error("unexpected read");
    },
    async writeDevices() {
      throw new Error("unexpected write");
    },
  };

  await assert.rejects(() => readNamed(fakeClient, ["D50:BIT_IN_WORD"]), /no bit index/i);
  await assert.rejects(() => writeNamed(fakeClient, { "D50:BIT_IN_WORD": true }), /no bit index/i);
});

test("readNamed and writeNamed reject unknown dtype suffixes", async () => {
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom() {
      throw new Error("unexpected read");
    },
    async writeRandomWords() {
      throw new Error("unexpected write");
    },
  };

  await assert.rejects(() => readNamed(fakeClient, ["D100:BOGUS"]), /unsupported dtype/i);
  await assert.rejects(() => writeNamed(fakeClient, { "D100:BOGUS": 7 }), /unsupported dtype/i);
  await assert.rejects(() => readTyped(fakeClient, "D100", "BOGUS"), /unsupported dtype/i);
  await assert.rejects(() => writeTyped(fakeClient, "D100", "BOGUS", 7), /unsupported dtype/i);
});

test("normalizeAddressList keeps count suffixes in comma-separated input", () => {
  assert.deepEqual(normalizeAddressList("D100:U,10,D200:F,M1000:BIT"), ["D100:U,10", "D200:F", "M1000:BIT"]);
  assert.deepEqual(normalizeAddressList("D100:STR,10 D200:U,2"), ["D100:STR,10", "D200:U,2"]);
});

test("readNamed batches word and dword requests like the Python helper layer", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom({ wordDevices, dwordDevices }) {
      calls.push({
        kind: "readRandom",
        wordDevices: wordDevices.map((device) => `${device.code}${device.number}`),
        dwordDevices: dwordDevices.map((device) => `${device.code}${device.number}`),
      });
      return {
        word: {
          D100: 42,
          D50: 0x0008,
          M992: 0x0100,
        },
        dword: {
          D200: 0x40490fdb,
        },
      };
    },
    async readDevices(device, points, options) {
      calls.push({ kind: "readDevices", device: `${device.code}${device.number}`, points, options });
      if (device.code === "D" && device.number === 50) {
        return [0x0008];
      }
      throw new Error("unexpected fallback read");
    },
  };

  const snapshot = await readNamed(fakeClient, ["D100:U", "D200:F", "D50.3", "M1000:BIT"]);
  assert.equal(snapshot["D100:U"], 42);
  assert.equal(snapshot["D200:F"].toFixed(3), "3.142");
  assert.equal(snapshot["D50.3"], true);
  assert.equal(snapshot["M1000:BIT"], true);
  assert.ok(
    calls.some(
      (call) =>
        call.kind === "readRandom" &&
        call.wordDevices.includes("M992") &&
        call.wordDevices.includes("D100") &&
        call.wordDevices.includes("D50")
    )
  );
  assert.ok(
    !calls.some((call) => call.kind === "readDevices" && call.device === "M1000" && call.options.bitUnit === true)
  );
  assert.equal(calls.length, 1);
});

test("readNamed rejects random reads that exceed the one-request limit before transport", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom({ wordDevices, dwordDevices }) {
      const wordNames = wordDevices.map((device) => `${device.code}${device.number}`);
      calls.push({ wordDevices: wordNames, dwordDevices });
      return {
        word: Object.fromEntries(wordDevices.map((device) => [`${device.code}${device.number}`, device.number])),
        dword: {},
      };
    },
    async readDevices() {
      throw new Error("unexpected direct read");
    },
  };

  const addresses = Array.from({ length: 97 }, (_, index) => `D${index * 2}:U`);
  await assert.rejects(() => readNamed(fakeClient, addresses), /must fit one request/i);
  assert.equal(calls.length, 0);
});

test("writeNamed rejects mixed families and bit-in-word before transport", async () => {
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices(device) {
      assert.equal(`${device.code}${device.number}`, "D50");
      return [0x0000];
    },
    async writeDevices(device, values, options) {
      writes.push({
        kind: "writeDevices",
        device: `${device.code}${device.number}`,
        values: Array.from(values),
        bitUnit: Boolean(options.bitUnit),
      });
    },
    async writeRandomWords({ wordValues, dwordValues }) {
      writes.push({
        kind: "writeRandomWords",
        wordValues: wordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
        dwordValues: dwordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
      });
    },
  };

  await assert.rejects(
    () => writeNamed(fakeClient, { "D100:U": 42, "D50.3": true, "M1000:BIT": true, "D200:F": 3.5 }),
    /bit-in-word read-modify-write/
  );
  assert.equal(writes.length, 0);
});

test("writeNamed rejects random word writes that exceed the one-request limit before transport", async () => {
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async writeRandomWords({ wordValues, dwordValues }) {
      writes.push({
        wordValues: wordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
        dwordValues,
      });
    },
  };

  const updates = Object.fromEntries(Array.from({ length: 81 }, (_, index) => [`D${index * 2}:U`, index]));
  await assert.rejects(() => writeNamed(fakeClient, updates), /must fit one request/i);
  assert.equal(writes.length, 0);
});

test("writeNamed rejects overlapping normalized destinations before transport", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async writeDevices(...args) { calls.push(args); },
    async writeRandomWords(...args) { calls.push(args); },
  };
  await assert.rejects(
    () => writeNamed(fakeClient, { "D100:D": 0x11223344, "D101:U": 0x9999 }),
    /overlapping destination/
  );
  assert.equal(calls.length, 0);
});

test("readNamed rejects block-read fallback routes before transport", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom() {
      throw new Error("unexpected random read");
    },
    async readDevices(device, points, options) {
      calls.push({
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      if (device.code === "TS") {
        return [true, false, true];
      }
      if (device.code === "D") {
        return [11, 12, 13];
      }
      throw new Error("unexpected block read");
    },
  };

  await assert.rejects(
    () => readNamed(fakeClient, ["TS1000:BIT", "D100:U"]),
    /exactly one protocol request/
  );
  assert.deepEqual(calls, []);
});

test("readNamed rejects count arrays and strings that require block reads", async () => {
  const calls = [];
  const floatWords = [];
  for (const value of [1.5, -2.25]) {
    const raw = Buffer.alloc(4);
    raw.writeFloatLE(value, 0);
    floatWords.push(raw.readUInt16LE(0), raw.readUInt16LE(2));
  }
  const helloWords = [0x4548, 0x4c4c, 0x004f];
  const abcdWords = [0x4241, 0x4443];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom() {
      throw new Error("unexpected random read");
    },
    async readDevices(device, points, options) {
      const call = {
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      };
      calls.push(call);
      if (call.device === "M1000" && call.bitUnit) {
        return [true, false, true];
      }
      if (call.device === "D100" && !call.bitUnit) {
        return [11, 12, 13];
      }
      if (call.device === "D200" && !call.bitUnit) {
        return floatWords;
      }
      if (call.device === "D300" && !call.bitUnit) {
        return helloWords;
      }
      if (call.device === "D400" && !call.bitUnit) {
        return abcdWords;
      }
      throw new Error(`unexpected read ${call.device}`);
    },
  };

  await assert.rejects(
    () => readNamed(fakeClient, ["M1000:BIT,3", "D300:STR,5"]),
    /exactly one protocol request/
  );
  assert.deepEqual(calls, []);
});

test("readNamed permits one long-timer cluster as one request", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom() {
      throw new Error("unexpected random read");
    },
    async readDevices(device, points, options) {
      calls.push({
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      if (device.code === "LTN" && device.number === 0) {
        return [0x0002, 0x0001, 0x0003, 0x0000, 0x0004, 0x0000, 0x0002, 0x0000];
      }
      if (device.code === "LSTN" && device.number === 4) {
        return [0x0006, 0x0000, 0x0001, 0x0000, 0x0007, 0x0000, 0x0002, 0x0000];
      }
      throw new Error(`unexpected long timer read ${device.code}${device.number}`);
    },
  };

  const snapshot = await readNamed(fakeClient, ["LTN0:D", "LTC0:BIT"]);
  assert.equal(snapshot["LTN0:D"], 0x00010002);
  assert.equal(snapshot["LTC0:BIT"], true);
  assert.deepEqual(calls, [{ device: "LTN0", points: 4, bitUnit: false }]);
});

test("readTyped resolves long-family values through supported routes", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom({ dwordDevices }) {
      calls.push({
        device: dwordDevices.map((device) => `${device.code}${device.number}`).join(","),
        points: dwordDevices.length,
        bitUnit: false,
        random: true,
      });
      return {
        word: {},
        dword: Object.fromEntries(dwordDevices.map((device) => [`${device.code}${device.number}`, 8])),
      };
    },
    async readDevices(device, points, options) {
      calls.push({
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      if (device.code === "LTN" && device.number === 0) {
        return [0x0002, 0x0001, 0x0003, 0x0000];
      }
      if (device.code === "LSTN" && device.number === 4) {
        return [0x0006, 0x0000, 0x0001, 0x0000];
      }
      if ((device.code === "LCS" || device.code === "LCC") && device.number === 10) {
        return [true];
      }
      throw new Error(`unexpected long-family read ${device.code}${device.number}`);
    },
  };

  assert.equal(await readTyped(fakeClient, { code: "LTN", number: 0, plcProfile: "melsec:iq-r" }, "D"), 0x00010002);
  assert.equal(await readTyped(fakeClient, { code: "LTS", number: 0, plcProfile: "melsec:iq-r" }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LTC", number: 0, plcProfile: "melsec:iq-r" }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LSTN", number: 4, plcProfile: "melsec:iq-r" }, "D"), 6);
  assert.equal(await readTyped(fakeClient, { code: "LSTC", number: 4, plcProfile: "melsec:iq-r" }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LCN", number: 10, plcProfile: "melsec:iq-r" }, "D"), 8);
  assert.equal(await readTyped(fakeClient, { code: "LCS", number: 10, plcProfile: "melsec:iq-r" }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LCC", number: 10, plcProfile: "melsec:iq-r" }, "BIT"), true);
  assert.deepEqual(calls, [
    { device: "LTN0", points: 4, bitUnit: false },
    { device: "LTN0", points: 4, bitUnit: false },
    { device: "LTN0", points: 4, bitUnit: false },
    { device: "LSTN4", points: 4, bitUnit: false },
    { device: "LSTN4", points: 4, bitUnit: false },
    { device: "LCN10", points: 1, bitUnit: false, random: true },
    { device: "LCS10", points: 1, bitUnit: true },
    { device: "LCC10", points: 1, bitUnit: true },
  ]);
});

test("readNamed rejects mixed long-counter random and direct routes", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom({ dwordDevices }) {
      calls.push({
        kind: "readRandom",
        dwordDevices: dwordDevices.map((device) => `${device.code}${device.number}`),
      });
      return {
        word: {},
        dword: {
          LCN0: 0x00010002,
          LCN1: 4,
        },
      };
    },
    async readDevices(device, points, options) {
      calls.push({
        kind: "readDevices",
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      if (device.code === "LCC" || device.code === "LCS") {
        return [true];
      }
      throw new Error(`unexpected long counter read ${device.code}${device.number}`);
    },
  };

  await assert.rejects(() => readNamed(fakeClient, ["LCN0:D", "LCC0:BIT"]), /exactly one protocol request/);
  assert.deepEqual(calls, []);
});

test("named count and string entries share one multi-block request", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readBlock(options) {
      calls.push({ kind: "readBlock", blocks: options.wordBlocks });
      return {
        wordBlocks: [
          { values: [11, 12, 13] },
          { values: [0x4241, 0x4443] },
        ],
        bitBlocks: [],
      };
    },
    async writeBlock(options) {
      calls.push({ kind: "writeBlock", blocks: options.wordBlocks });
    },
  };

  const snapshot = await readNamed(fakeClient, ["D100:U,3", "D110:STR,4"]);
  assert.deepEqual(snapshot, { "D100:U,3": [11, 12, 13], "D110:STR,4": "ABCD" });
  await writeNamed(fakeClient, { "D100:U,3": [21, 22, 23], "D110:STR,4": "WXYZ" });

  assert.equal(calls.filter((call) => call.kind === "readBlock").length, 1);
  assert.equal(calls.filter((call) => call.kind === "writeBlock").length, 1);
  assert.equal(calls[0].blocks.length, 2);
  assert.equal(calls[1].blocks.length, 2);
});

test("one contiguous named word cluster uses one direct request on block-disabled profiles", async () => {
  const client = new slmp.SlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    plcProfile: "melsec:qcpu:qj71e71-100",
    target: { network: 0, station: 0xFF, moduleIO: 0x03FF, multidrop: 0 },
  });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: command === 0x0401 ? Buffer.from([0x11, 0x11, 0x22, 0x22]) : Buffer.alloc(0) };
  };

  assert.deepEqual(await readNamed(client, ["D100:U,2"]), { "D100:U,2": [0x1111, 0x2222] });
  await writeNamed(client, { "D100:U,2": [0x3333, 0x4444] });

  assert.deepEqual(calls.map((call) => call.command), [0x0401, 0x1401]);
});

test("named multi-block options cannot replace compiled destinations", async () => {
  const calls = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async writeBlock(options) {
      calls.push(options.wordBlocks.map(([device, values]) => [`${device.code}${device.number}`, values]));
    },
  };

  await writeNamed(
    fakeClient,
    { "D100:U,2": [1, 2], "D110:U,2": [3, 4] },
    { wordBlocks: [["D999", [9]]] }
  );
  assert.deepEqual(calls, [[["D100", [1, 2]], ["D110", [3, 4]]]]);
});

test("readNamed forwards per-request target overrides to client calls", async () => {
  const calls = [];
  const target = { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 };
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readRandom(options) {
      calls.push({
        kind: "readRandom",
        target: options.target,
      });
      return {
        word: { D100: 42, M992: 0x0100 },
        dword: { D200: 0x3fc00000 },
      };
    },
    async readDevices(device, points, options) {
      calls.push({
        kind: "readDevices",
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
        target: options.target,
      });
      throw new Error("unexpected block read");
    },
  };

  const snapshot = await readNamed(fakeClient, ["D100:U", "D200:F", "M1000:BIT"], { target });
  assert.equal(snapshot["D100:U"], 42);
  assert.equal(snapshot["D200:F"], 1.5);
  assert.equal(snapshot["M1000:BIT"], true);
  assert.deepEqual(calls, [{ kind: "readRandom", target }]);
});

test("writeNamed rejects bit-in-word mixed with direct bits", async () => {
  const reads = [];
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices(device, points, options) {
      reads.push({
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      return [0x0000];
    },
    async writeDevices(device, values, options) {
      writes.push({
        device: `${device.code}${device.number}`,
        values: Array.from(values),
        bitUnit: Boolean(options.bitUnit),
      });
    },
    async writeRandomWords() {
      throw new Error("unexpected random write");
    },
  };

  await assert.rejects(
    () => writeNamed(fakeClient, { "D50.3": true, "M1000:BIT": true }),
    /bit-in-word read-modify-write/
  );
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});

test("writeNamed rejects block and bit families before transport", async () => {
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices() {
      throw new Error("unexpected read");
    },
    async writeDevices(device, values, options) {
      writes.push({
        device: `${device.code}${device.number}`,
        values: Array.from(values),
        bitUnit: Boolean(options.bitUnit),
      });
    },
    async writeRandomWords() {
      throw new Error("unexpected random write");
    },
  };

  await assert.rejects(
    () => writeNamed(fakeClient, { "D100:U,3": [11, 12, 13], "M100:BIT": true }),
    /exactly one protocol request/
  );
  assert.deepEqual(writes, []);
});

test("writeNamed rejects mixed long current and state command families", async () => {
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices() {
      throw new Error("unexpected read");
    },
    async writeDevices(device, values, options) {
      writes.push({
        kind: "writeDevices",
        device: `${device.code}${device.number}`,
        values: Array.from(values),
        bitUnit: Boolean(options.bitUnit),
      });
    },
    async writeRandomWords({ wordValues, dwordValues }) {
      writes.push({
        kind: "writeRandomWords",
        wordValues: wordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
        dwordValues: dwordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
      });
    },
    async writeRandomBits({ bitValues }) {
      writes.push({
        kind: "writeRandomBits",
        bitValues: bitValues.map(([device, value]) => [`${device.code}${device.number}`, Boolean(value)]),
      });
    },
  };

  await assert.rejects(
    () => writeNamed(fakeClient, { "LSTN4:L": -5, "LTC0:BIT": true }),
    /exactly one protocol request/
  );
  assert.deepEqual(writes, []);
});

test("writeTyped routes long current and state devices through random writes", async () => {
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async writeDevices() {
      throw new Error("unexpected direct write");
    },
    async writeRandomWords({ dwordValues }) {
      writes.push({
        kind: "writeRandomWords",
        dwordValues: dwordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
      });
    },
    async writeRandomBits({ bitValues }) {
      writes.push({
        kind: "writeRandomBits",
        bitValues: bitValues.map(([device, value]) => [`${device.code}${device.number}`, Boolean(value)]),
      });
    },
  };

  await writeTyped(fakeClient, { code: "LCN", number: 10, plcProfile: "melsec:iq-r" }, "D", 123);
  await writeTyped(fakeClient, { code: "LCS", number: 10, plcProfile: "melsec:iq-r" }, "BIT", true);

  assert.deepEqual(writes, [
    { kind: "writeRandomWords", dwordValues: [["LCN10", 123]] },
    { kind: "writeRandomBits", bitValues: [["LCS10", true]] },
  ]);
});

test("writes validate boolean and numeric values before any client call", async () => {
  let calls = 0;
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices() {
      calls += 1;
      return [0];
    },
    async writeDevices() {
      calls += 1;
    },
    async writeRandomWords() {
      calls += 1;
    },
    async writeRandomBits() {
      calls += 1;
    },
  };

  for (const value of ["not-a-number", Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 0x10000]) {
    await assert.rejects(() => writeTyped(fakeClient, "D100", "U", value), /numeric|finite|integer|range/i);
  }
  for (const value of ["yes", "", 2, -1, Number.NaN, null]) {
    await assert.rejects(() => writeTyped(fakeClient, "M1000", "BIT", value), /expects boolean/i);
  }
  await assert.rejects(
    () => writeNamed(fakeClient, { "D100:U": 1, "D101:U": "bad" }),
    /expects a numeric value/i
  );
  assert.equal(calls, 0);
});

test("writes accept only documented boolean tokens and integer widths", async () => {
  const writes = [];
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async writeDevices(device, values, options) {
      writes.push({ device: `${device.code}${device.number}`, values, bitUnit: options.bitUnit });
    },
  };

  for (const [value, expected] of [
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ["ON", true],
    ["off", false],
    ["TRUE", true],
    ["false", false],
  ]) {
    await writeTyped(fakeClient, "M1000", "BIT", value);
    assert.equal(writes.at(-1).values[0], expected);
  }
  await writeTyped(fakeClient, "D100", "U", "65535");
  await writeTyped(fakeClient, "D101", "S", "-32768");
  assert.deepEqual(writes.slice(-2).map((entry) => entry.values), [[65535], [32768]]);
});

test("writeNamed forwards per-request target overrides to client calls", async () => {
  const writes = [];
  const target = { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 };
  const fakeClient = {
    plcProfile: "melsec:iq-r",
    async readDevices(device, points, options) {
      writes.push({
        kind: "readDevices",
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
        target: options.target,
      });
      return [0x0000];
    },
    async writeDevices(device, values, options) {
      writes.push({
        kind: "writeDevices",
        device: `${device.code}${device.number}`,
        values: Array.from(values),
        bitUnit: Boolean(options.bitUnit),
        target: options.target,
      });
    },
    async writeRandomWords(options) {
      writes.push({
        kind: "writeRandomWords",
        wordValues: options.wordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
        dwordValues: options.dwordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
        target: options.target,
      });
    },
  };

  await writeNamed(
    fakeClient,
    {
      "D100:U": 42,
      "D200:F": 1.5,
    },
    { target }
  );

  assert.deepEqual(writes, [
    { kind: "writeRandomWords", wordValues: [["D100", 42]], dwordValues: [["D200", 1069547520]], target },
  ]);
});

test("slmp-connection creates a client and closes it with the node", async () => {
  const constructorOptions = [];
  let connectCalls = 0;
  let closeCalls = 0;

  class FakeSlmpClient {
    constructor(options) {
      constructorOptions.push(options);
      this.plcProfile = options.plcProfile || null;
      this.strictProfile = options.strictProfile !== false;
      this.frameType = options.plcProfile ? "4e" : options.frameType;
      this.plcSeries = options.plcProfile ? "iqr" : options.plcSeries;
      this.defaultTarget = slmp.normalizeTarget(options.defaultTarget);
    }

    async connect() {
      connectCalls += 1;
    }

    async close() {
      closeCalls += 1;
    }
  }

  await withMockedSlmp({ SlmpClient: FakeSlmpClient }, async () => {
    const { RED, create } = createMockRed();
    require("../nodes/slmp-connection")(RED);

    const node = create("slmp-connection", {
      id: "conn-1",
      host: "192.168.0.10",
      port: "5001",
      transport: "udp",
      timeout: "4500",
      plcProfile: "melsec:iq-r",
      monitoringTimer: "32",
      network: "1",
      station: "255",
      moduleIO: "03FF",
      multidrop: "2",
      useRemotePassword: true,
      credentials: {
        remotePassword: "secret1",
      },
    });

    assert.equal(constructorOptions.length, 1);
    assert.equal(constructorOptions[0].host, "192.168.0.10");
    assert.equal(constructorOptions[0].port, 5001);
    assert.equal(constructorOptions[0].transport, "udp");
    assert.equal(constructorOptions[0].timeout, 4500);
    assert.equal(constructorOptions[0].monitoringTimer, 32);
    assert.equal(constructorOptions[0].plcProfile, "melsec:iq-r");
    assert.equal(Object.prototype.hasOwnProperty.call(constructorOptions[0], "strictProfile"), false);
    assert.equal(constructorOptions[0].remotePassword, "secret1");
    assert.ok(node.getClient() instanceof FakeSlmpClient);
    assert.deepEqual(node.getProfile(), {
      host: "192.168.0.10",
      port: 5001,
      transport: "udp",
      plcProfile: "melsec:iq-r",
      frameType: "4e",
      plcSeries: "iqr",
      target: {
        network: 1,
        station: 255,
        moduleIO: 0x03ff,
        multidrop: 2,
      },
      remotePasswordConfigured: true,
    });
    assert.deepEqual(node.statusCalls[0], { fill: "grey", shape: "ring", text: "ready" });

    await node.connect();
    await node.disconnect();
    await node.reinitialize();

    assert.equal(connectCalls, 2);
    assert.equal(closeCalls, 2);
    assert.deepEqual(node.statusCalls.slice(1, 7), [
      { fill: "yellow", shape: "ring", text: "connecting" },
      { fill: "green", shape: "dot", text: "connected" },
      { fill: "yellow", shape: "ring", text: "disconnecting" },
      { fill: "red", shape: "ring", text: "disconnected" },
      { fill: "yellow", shape: "ring", text: "reinitializing" },
      { fill: "green", shape: "dot", text: "connected" },
    ]);

    let doneCalled = false;
    await new Promise((resolve) => {
      node.emit("close", false, () => {
        doneCalled = true;
        resolve();
      });
    });

    assert.equal(closeCalls, 3);
    assert.equal(doneCalled, true);
    assert.deepEqual(node.statusCalls.at(-1), { fill: "grey", shape: "ring", text: "closed" });
  });
});

test("slmp-connection rejects invalid saved connection options before client creation", async () => {
  const constructorOptions = [];

  class FakeSlmpClient {
    constructor(options) {
      const defaultTarget = slmp.normalizeTarget(options.defaultTarget);
      constructorOptions.push(options);
      this.plcProfile = options.plcProfile;
      this.frameType = "4e";
      this.plcSeries = "iqr";
      this.defaultTarget = defaultTarget;
    }

    async close() {}
  }

  await withMockedSlmp({ SlmpClient: FakeSlmpClient }, async () => {
    const { RED, create } = createMockRed();
    require("../nodes/slmp-connection")(RED);

    const requiredConfig = {
      host: "192.168.0.10",
      transport: "tcp",
      plcProfile: "melsec:iq-r",
      network: 0,
      station: 0xff,
      moduleIO: 0x03ff,
      multidrop: 0,
      useRemotePassword: false,
    };
    for (const invalidPort of [undefined, null, "", " ", false, 0, -1, 1.5, 65536, NaN, Infinity, {}, []]) {
      assert.throws(
        () => create("slmp-connection", {
          id: `conn-invalid-port-${String(invalidPort)}`,
          ...requiredConfig,
          port: invalidPort,
        }),
        /port/,
      );
      assert.equal(constructorOptions.length, 0);
    }
    for (const invalidTransport of [undefined, null, "", " ", false, 0, {}, [], "serial", "tpc"]) {
      assert.throws(
        () => create("slmp-connection", {
          id: `conn-invalid-transport-${String(invalidTransport)}`,
          ...requiredConfig,
          port: 1025,
          transport: invalidTransport,
        }),
        /transport/i,
      );
      assert.equal(constructorOptions.length, 0);
    }
    for (const invalidTimeout of [null, "", " ", false, 0, -1, 1.5, 2147483648, NaN, Infinity, {}, []]) {
      assert.throws(
        () => create("slmp-connection", {
          id: `conn-invalid-timeout-${String(invalidTimeout)}`,
          ...requiredConfig,
          port: 1025,
          timeout: invalidTimeout,
        }),
        /timeout/,
      );
      assert.equal(constructorOptions.length, 0);
    }
    for (const invalidMonitoringTimer of [undefined, null, "", " ", false, true, -1, 1.5, 65536, NaN, Infinity, {}, []]) {
      assert.throws(
        () => create("slmp-connection", {
          id: `conn-invalid-monitoring-timer-${String(invalidMonitoringTimer)}`,
          ...requiredConfig,
          port: 1025,
          monitoringTimer: invalidMonitoringTimer,
        }),
        /monitoringTimer/,
      );
      assert.equal(constructorOptions.length, 0);
    }
    for (const invalidStrictProfile of [false, "false", "0", "off", 0, null, "", "unknown", {}, []]) {
      assert.throws(
        () => create("slmp-connection", {
          id: `conn-obsolete-strict-profile-${String(invalidStrictProfile)}`,
          ...requiredConfig,
          port: 1025,
          strictProfile: invalidStrictProfile,
        }),
        /strictProfile is no longer configurable/,
      );
      assert.equal(constructorOptions.length, 0);
    }
    assert.throws(
      () => create("slmp-connection", {
        id: "conn-obsolete-strict-profile-alias",
        ...requiredConfig,
        port: 1025,
        strict_profile: false,
      }),
      /strict_profile is not a supported/,
    );
    assert.equal(constructorOptions.length, 0);
    const routeFields = ["network", "station", "moduleIO", "multidrop"];
    for (let fieldMask = 0; fieldMask < 0b1111; fieldMask += 1) {
      const partialRouteConfig = {
        id: `conn-partial-route-${fieldMask}`,
        ...requiredConfig,
        port: 1025,
      };
      routeFields.forEach((field, index) => {
        if ((fieldMask & (1 << index)) === 0) {
          delete partialRouteConfig[field];
        }
      });
      assert.throws(() => create("slmp-connection", partialRouteConfig), /required/);
      assert.equal(constructorOptions.length, 0);
    }
    for (const field of routeFields) {
      for (const invalidValue of [null, "", false, -1, 1.5, NaN, Infinity, {}, []]) {
        assert.throws(
          () => create("slmp-connection", {
            id: `conn-invalid-route-${field}-${String(invalidValue)}`,
            ...requiredConfig,
            port: 1025,
            [field]: invalidValue,
          }),
          /target|integer|range|required/i,
        );
        assert.equal(constructorOptions.length, 0);
      }
    }
    assert.throws(
      () => create("slmp-connection", {
        id: "conn-password-toggle-missing",
        host: "192.168.0.10",
        port: 1025,
        transport: "tcp",
        plcProfile: "melsec:iq-r",
      }),
      /useRemotePassword is required and must be a boolean/
    );
    assert.throws(
      () => create("slmp-connection", {
        id: "conn-password-enabled-empty",
        host: "192.168.0.10",
        port: 1025,
        transport: "tcp",
        plcProfile: "melsec:iq-r",
        useRemotePassword: true,
        credentials: { remotePassword: "" },
      }),
      /remotePassword is required/
    );
    assert.throws(
      () => create("slmp-connection", {
        id: "conn-password-invalid-toggle",
        host: "192.168.0.10",
        port: 1025,
        transport: "tcp",
        plcProfile: "melsec:iq-r",
        useRemotePassword: "true",
        credentials: { remotePassword: "secret1" },
      }),
      /useRemotePassword is required and must be a boolean/
    );
    create("slmp-connection", {
      id: "conn-obsolete-strict-profile-true",
      ...requiredConfig,
      port: 1025,
      strictProfile: true,
    });
    assert.equal(constructorOptions.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(constructorOptions[0], "strictProfile"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(constructorOptions[0], "remotePassword"), false);
  });
});

test("slmp-connection omits disabled credentials and reports close failures without blocking shutdown", async () => {
  const constructorOptions = [];

  class FakeSlmpClient {
    constructor(options) {
      constructorOptions.push(options);
      this.plcProfile = options.plcProfile;
      this.frameType = "4e";
      this.plcSeries = "iqr";
      this.defaultTarget = slmp.normalizeTarget(options.defaultTarget);
    }

    async close() {
      throw new slmp.SlmpError("Remote password lock failed. end_code=0xC810");
    }
  }

  await withMockedSlmp({ SlmpClient: FakeSlmpClient }, async () => {
    const { RED, create } = createMockRed();
    require("../nodes/slmp-connection")(RED);
    const node = create("slmp-connection", {
      id: "conn-disabled-password",
      host: "192.168.0.10",
      port: 1025,
      transport: "tcp",
      plcProfile: "melsec:iq-r",
      monitoringTimer: 16,
      network: 0,
      station: 0xff,
      moduleIO: 0x03ff,
      multidrop: 0,
      useRemotePassword: false,
      credentials: { remotePassword: "must-not-be-forwarded" },
    });

    assert.equal(Object.prototype.hasOwnProperty.call(constructorOptions[0], "remotePassword"), false);
    let doneCalled = false;
    await new Promise((resolve) => {
      node.emit("close", false, () => {
        doneCalled = true;
        resolve();
      });
    });
    assert.equal(doneCalled, true);
    assert.equal(node.warnCalls.length, 1);
    assert.match(node.warnCalls[0], /authentication or transport error/);
    assert.doesNotMatch(node.warnCalls[0], /must-not-be-forwarded/);
  });
});

test("slmp-connection defaults timeout and monitoring timer only when saved properties are absent", async () => {
  const constructorOptions = [];

  class FakeSlmpClient {
    constructor(options) {
      constructorOptions.push(options);
      this.plcProfile = options.plcProfile;
      this.frameType = "4e";
      this.plcSeries = "iqr";
      this.defaultTarget = slmp.normalizeTarget(options.defaultTarget);
    }

    async close() {}
  }

  await withMockedSlmp({ SlmpClient: FakeSlmpClient }, async () => {
    const { RED, create } = createMockRed();
    require("../nodes/slmp-connection")(RED);

    create("slmp-connection", {
      id: "conn-timeout-absent",
      host: "192.168.0.10",
      port: 1025,
      transport: "tcp",
      plcProfile: "melsec:iq-r",
      network: 0,
      station: 0xff,
      moduleIO: 0x03ff,
      multidrop: 0,
      useRemotePassword: false,
    });

    assert.equal(constructorOptions.length, 1);
    assert.equal(constructorOptions[0].timeout, 3000);
    assert.equal(constructorOptions[0].monitoringTimer, 16);

    create("slmp-connection", {
      id: "conn-monitoring-timer-zero",
      host: "192.168.0.10",
      port: 1025,
      transport: "tcp",
      plcProfile: "melsec:iq-r",
      monitoringTimer: 0,
      network: 0,
      station: 0xff,
      moduleIO: 0x03ff,
      multidrop: 0,
      useRemotePassword: false,
    });
    assert.equal(constructorOptions.length, 2);
    assert.equal(constructorOptions[1].monitoringTimer, 0);
  });
});

test("slmp-read prefers msg.addresses and can return a single value", async () => {
  const calls = [];
  const fakeClient = { kind: "client", plcProfile: "melsec:iq-r" };

  await withMockedSlmp({
    readNamed: async (client, addresses) => {
      calls.push({ client, addresses });
      return { "M1000:BIT": true };
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-1", {
      getClient: () => fakeClient,
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      }),
    });

    const node = create("slmp-read", {
      id: "read-1",
      connection: "cfg-1",
      addresses: "D100:U",
      outputMode: "value",
    });

    const msg = { addresses: ["M1000:BIT"] };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(msg.payload, true);
    assert.deepEqual(msg.slmp, {
      operation: "read",
      metadataMode: "full",
      itemCount: 1,
      addresses: ["M1000:BIT"],
      connection: {
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      },
      target: undefined,
      targetSource: "connection",
    });
    assert.deepEqual(calls, [{ client: fakeClient, addresses: ["M1000:BIT"] }]);
    assert.deepEqual(node.statusCalls[0], { fill: "blue", shape: "dot", text: "reading" });
    assert.deepEqual(node.statusCalls.at(-1), { fill: "green", shape: "dot", text: "1 item(s)" });
  });
});

test("slmp-read can return an array payload in address order", async () => {
  await withMockedSlmp({
    readNamed: async () => ({
      "D100:U,3": [1, 2, 3],
      "D200:F": 1.5,
      "M1000:BIT": true,
    }),
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-array-read", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-read", {
      id: "read-array",
      connection: "cfg-array-read",
      addresses: "D100:U,3\nD200:F\nM1000:BIT",
      outputMode: "array",
    });

    const msg = {};
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.deepEqual(msg.payload, [[1, 2, 3], 1.5, true]);
  });
});

test("slmp-read resolves configured addresses from a msg property", async () => {
  const calls = [];

  await withMockedSlmp({
    readNamed: async (_client, addresses) => {
      calls.push(addresses);
      return { "D100:U,3": [1, 2, 3] };
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-typed-read", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", host: "127.0.0.1", port: 5000, transport: "tcp", frameType: "4e", plcSeries: "ql" }),
    });

    const node = create("slmp-read", {
      id: "read-typed",
      connection: "cfg-typed-read",
      addresses: "source.addresses",
      addressesType: "msg",
      outputMode: "object",
    });

    const msg = { source: { addresses: ["D100:U,3"] } };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.deepEqual(calls, [["D100:U,3"]]);
    assert.deepEqual(msg.payload, { "D100:U,3": [1, 2, 3] });
  });
});

test("slmp-read forwards msg.target to readNamed and records the effective route", async () => {
  const calls = [];

  await withMockedSlmp({
    readNamed: async (_client, addresses, options) => {
      calls.push({ addresses, target: options.target });
      return { "D100:U": 42 };
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-route-read", {
      getClient: () => ({}),
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
        target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
      }),
    });

    const node = create("slmp-read", {
      id: "read-route-msg",
      connection: "cfg-route-read",
      addresses: "D100:U",
    });

    const result = await invokeNode(node, {
      target: { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(calls, [
      {
        addresses: ["D100:U"],
        target: { network: 2, station: 3, moduleIO: 0x03ff, multidrop: 1 },
      },
    ]);
    assert.deepEqual(result.sent[0].slmp.target, {
      network: 2,
      station: 3,
      moduleIO: 0x03ff,
      multidrop: 1,
    });
  });
});

test("slmp-read rejects a partial msg.target value before readNamed", async () => {
  let readCalls = 0;

  await withMockedSlmp({
    readNamed: async () => {
      readCalls += 1;
      return { "D100:U": 42 };
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-invalid-route-read", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 } }),
    });

    const node = create("slmp-read", {
      id: "read-invalid-route-msg",
      connection: "cfg-invalid-route-read",
      addresses: "D100:U",
    });
    const result = await invokeNode(node, { target: { network: "1junk" } });

    assert.match(result.error.message, /target\..*required/i);
    assert.equal(readCalls, 0);
    assert.equal(result.sent.length, 0);
  });
});

test("slmp-read minimal metadata keeps only target and item count", async () => {
  await withMockedSlmp({
    readNamed: async () => ({ "D100:U": 42, "D200:U": 7 }),
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-minimal", {
      getClient: () => ({}),
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
        target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
      }),
    });

    const node = create("slmp-read", {
      id: "read-minimal",
      connection: "cfg-read-minimal",
      addresses: "D100:U\nD200:U",
      metadataMode: "minimal",
    });

    const msg = { slmp: { custom: "keep", addresses: ["OLD"], connection: { stale: true } } };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.deepEqual(msg.slmp, {
      custom: "keep",
      operation: "read",
      target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
      targetSource: "connection",
      itemCount: 2,
      metadataMode: "minimal",
    });
  });
});

test("slmp-read metadata off leaves msg.slmp unchanged", async () => {
  await withMockedSlmp({
    readNamed: async () => ({ "D100:U": 42 }),
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-off", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 } }),
    });

    const node = create("slmp-read", {
      id: "read-off",
      connection: "cfg-read-off",
      addresses: "D100:U",
      metadataMode: "off",
    });

    const msg = {};
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(msg.slmp, undefined);
  });
});

test("slmp-read reports an error when no address is available", async () => {
  await withMockedSlmp({}, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-1", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-read", {
      id: "read-2",
      connection: "cfg-1",
      addresses: "",
      outputMode: "object",
    });

    const result = await invokeNode(node, { payload: null });

    assert.equal(result.sent.length, 0);
    assert.match(result.error.message, /No SLMP addresses were provided/);
    assert.deepEqual(node.statusCalls.at(-1), {
      fill: "red",
      shape: "ring",
      text: "No SLMP addresses were provided",
    });
  });
});

test("slmp-read can attach an error to msg.error instead of throwing", async () => {
  await withMockedSlmp({
    readNamed: async () => {
      throw new Error("boom");
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-msg-error", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-read", {
      id: "read-msg-error",
      connection: "cfg-read-msg-error",
      addresses: "D100:U",
      errorHandling: "msg",
    });

    const msg = {};
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].error.message, "boom");
    assert.deepEqual(node.statusCalls.at(-1), { fill: "red", shape: "ring", text: "boom" });
  });
});

test("slmp-read can route errors to the second output", async () => {
  await withMockedSlmp({
    readNamed: async () => {
      throw new Error("boom");
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-output2", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-read", {
      id: "read-output2",
      connection: "cfg-read-output2",
      addresses: "D100:U",
      errorHandling: "output2",
    });

    const result = await invokeNode(node, {});

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(Array.isArray(result.sent[0]), true);
    assert.equal(result.sent[0][0], null);
    assert.equal(result.sent[0][1].error.message, "boom");
  });
});

test("slmp-read does not let the removed skipUnsupported flag bypass errorHandling", async () => {
  await withMockedSlmp({
    readNamed: async () => {
      throw new Error("SLMP device code 'LTC' is not supported for plcProfile 'melsec:lcpu'.");
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-skip-unsupported", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:lcpu" }),
    });

    const node = create("slmp-read", {
      id: "read-skip-unsupported",
      connection: "cfg-read-skip-unsupported",
      addresses: "LTC10:BIT",
      errorHandling: "output2",
    });

    const result = await invokeNode(node, { slmpSkipUnsupported: true });

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], null);
    assert.equal(result.sent[0][1].slmpSkippedUnsupported, undefined);
    assert.equal(result.sent[0][1].error.code, undefined);
    assert.match(result.sent[0][1].error.message, /not supported/);
    assert.equal(node.statusCalls.at(-1).fill, "red");
    assert.equal(node.warnCalls.length, 1);
    assert.match(node.warnCalls[0], /skipUnsupported was removed/);
  });
});

test("slmp-read supports connect/disconnect/reinitialize control messages", async () => {
  const actions = [];

  await withMockedSlmp({}, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-control", {
      connect: async () => actions.push("connect"),
      disconnect: async () => actions.push("disconnect"),
      reinitialize: async () => actions.push("reinitialize"),
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-read", {
      id: "read-control",
      connection: "cfg-read-control",
      addresses: "D100:U",
    });

    const connectResult = await invokeNode(node, { connect: true });
    const disconnectResult = await invokeNode(node, { topic: "disconnect" });
    const reinitResult = await invokeNode(node, { reinitialize: true });

    assert.deepEqual(actions, ["connect", "disconnect", "reinitialize"]);
    assert.equal(connectResult.sent.length, 0);
    assert.equal(disconnectResult.sent.length, 0);
    assert.equal(reinitResult.sent.length, 0);
    assert.deepEqual(node.statusCalls.slice(-2), [
      { fill: "yellow", shape: "ring", text: "reinitialize" },
      { fill: "green", shape: "dot", text: "reinitialize" },
    ]);
  });
});

test("slmp-write builds a typed update from msg.address and msg.value", async () => {
  const calls = [];
  const fakeClient = { kind: "client", plcProfile: "melsec:iq-r" };

  await withMockedSlmp({
    writeNamed: async (client, updates) => {
      calls.push({ client, updates });
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-1", {
      getClient: () => fakeClient,
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      }),
    });

    const node = create("slmp-write", {
      id: "write-1",
      connection: "cfg-1",
      updates: "",
    });

    const msg = { address: "D200", dtype: "F", value: 3.5 };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(calls, [{ client: fakeClient, updates: { "D200:F": 3.5 } }]);
    assert.deepEqual(msg.slmp.updates, { "D200:F": 3.5 });
    assert.deepEqual(node.statusCalls.at(-1), { fill: "green", shape: "dot", text: "1 item(s)" });
  });
});

test("slmp-write inserts dtype before a count suffix when msg.address uses ',count'", async () => {
  const calls = [];

  await withMockedSlmp({
    writeNamed: async (_client, updates) => {
      calls.push(updates);
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-1", {
      getClient: () => ({}),
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      }),
    });

    const node = create("slmp-write", {
      id: "write-1b",
      connection: "cfg-1",
      updates: "",
    });

    const result = await invokeNode(node, {
      address: "D200,2",
      dtype: "F",
      value: [1.5, -2.25],
    });

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(calls, [{ "D200:F,2": [1.5, -2.25] }]);
  });
});

test("slmp-write resolves configured updates from a msg property", async () => {
  const calls = [];

  await withMockedSlmp({
    writeNamed: async (_client, updates) => {
      calls.push(updates);
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-write-msg", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", host: "127.0.0.1", port: 5000, transport: "tcp", frameType: "4e", plcSeries: "ql" }),
    });

    const node = create("slmp-write", {
      id: "write-msg-source",
      connection: "cfg-write-msg",
      updates: "source.updates",
      updatesType: "msg",
    });

    const result = await invokeNode(node, { source: { updates: { "D100:U,3": [1, 2, 3] } } });

    assert.equal(result.error, undefined);
    assert.deepEqual(calls, [{ "D100:U,3": [1, 2, 3] }]);
  });
});

test("slmp-write resolves a configured route target from msg and forwards it to writeNamed", async () => {
  const calls = [];

  await withMockedSlmp({
    writeNamed: async (_client, updates, options) => {
      calls.push({ updates, target: options.target });
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-route-write", {
      getClient: () => ({}),
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
        target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
      }),
    });

    const node = create("slmp-write", {
      id: "write-route-msg",
      connection: "cfg-route-write",
      updates: "{\"D100:U\":42}",
      routeTarget: "route",
      routeTargetType: "msg",
    });

    const result = await invokeNode(node, {
      route: { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(calls, [
      {
        updates: { "D100:U": 42 },
        target: { network: 2, station: 3, moduleIO: 0x03ff, multidrop: 1 },
      },
    ]);
    assert.deepEqual(result.sent[0].slmp.target, {
      network: 2,
      station: 3,
      moduleIO: 0x03ff,
      multidrop: 1,
    });
  });
});

test("slmp-write minimal metadata keeps only target and item count", async () => {
  await withMockedSlmp({
    writeNamed: async () => {},
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-write-minimal", {
      getClient: () => ({}),
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
        target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
      }),
    });

    const node = create("slmp-write", {
      id: "write-minimal",
      connection: "cfg-write-minimal",
      updates: "{\"D100:U\":42,\"M1000:BIT\":true}",
      metadataMode: "minimal",
    });

    const msg = { slmp: { custom: "keep", updates: { stale: true }, connection: { stale: true } } };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.deepEqual(msg.slmp, {
      custom: "keep",
      operation: "write",
      target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
      targetSource: "connection",
      itemCount: 2,
      metadataMode: "minimal",
    });
  });
});

test("slmp-write metadata off leaves msg.slmp unchanged", async () => {
  await withMockedSlmp({
    writeNamed: async () => {},
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-write-off", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 } }),
    });

    const node = create("slmp-write", {
      id: "write-off",
      connection: "cfg-write-off",
      updates: "{\"D100:U\":42}",
      metadataMode: "off",
    });

    const msg = {};
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(msg.slmp, undefined);
  });
});

test("slmp-write rejects configured update lines when msg does not override them", async () => {
  const calls = [];

  await withMockedSlmp({
    writeNamed: async (_client, updates) => {
      calls.push(updates);
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-1", {
      getClient: () => ({}),
      getProfile: () => ({
        plcProfile: "melsec:iq-r",
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      }),
    });

    const node = create("slmp-write", {
      id: "write-2",
      connection: "cfg-1",
      updates: "D100=42\nM1000=true",
    });

    const result = await invokeNode(node, {});

    assert.match(result.error.message, /Unable to parse updates JSON/);
    assert.equal(result.sent.length, 0);
    assert.deepEqual(calls, []);
  });
});

test("slmp-write can route errors to the second output", async () => {
  await withMockedSlmp({
    writeNamed: async () => {
      throw new Error("write failed");
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-write-output2", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-write", {
      id: "write-output2",
      connection: "cfg-write-output2",
      updates: "{\"D100:U\":42}",
      errorHandling: "output2",
    });

    const result = await invokeNode(node, {});

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], null);
    assert.equal(result.sent[0][1].error.message, "write failed");
  });
});

test("slmp-write does not let the removed skipUnsupported flag bypass errorHandling", async () => {
  await withMockedSlmp({
    writeNamed: async () => {
      throw new Error("SLMP device code 'LTC' is not supported for plcProfile 'melsec:lcpu'.");
    },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-write-skip-unsupported", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:lcpu" }),
    });

    const node = create("slmp-write", {
      id: "write-skip-unsupported",
      connection: "cfg-write-skip-unsupported",
      updates: "{\"LTC10:BIT\":true}",
      errorHandling: "output2",
    });

    const result = await invokeNode(node, { slmp: { skipUnsupported: true } });

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], null);
    assert.equal(result.sent[0][1].slmpSkippedUnsupported, undefined);
    assert.equal(result.sent[0][1].error.code, undefined);
    assert.match(result.sent[0][1].error.message, /not supported/);
    assert.equal(node.statusCalls.at(-1).fill, "red");
    assert.equal(node.warnCalls.length, 1);
    assert.match(node.warnCalls[0], /skipUnsupported was removed/);
  });
});

test("slmp single write requires one exact dtype source", async () => {
  const calls = [];
  await withMockedSlmp({
    writeNamed: async (_client, updates) => { calls.push(updates); },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);
    setNode("cfg-single-dtype", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });
    const node = create("slmp-write", {
      id: "write-single-dtype",
      connection: "cfg-single-dtype",
      updates: "{\"D900:U\":900}",
    });

    const valid = [
      { address: "M100", dtype: "BIT", value: true, key: "M100:BIT" },
      { address: "D100", dtype: "U", value: 65535, key: "D100:U" },
      { address: "D101", dtype: "S", value: -32768, key: "D101:S" },
      { address: "D102", dtype: "D", value: 0xffffffff, key: "D102:D" },
      { address: "D104", dtype: "L", value: -2147483648, key: "D104:L" },
      { address: "D106", dtype: "F", value: 1.5, key: "D106:F" },
      { address: "D108,2", dtype: "STR", value: "A", key: "D108:STR,2" },
      { address: "D110:U", value: 1, key: "D110:U" },
      { address: "D111.3", value: true, key: "D111.3" },
      { address: "D112:STR,2", value: "B", key: "D112:STR,2" },
    ];
    for (const item of valid) {
      const msg = { address: item.address, value: item.value };
      if (Object.prototype.hasOwnProperty.call(item, "dtype")) msg.dtype = item.dtype;
      const result = await invokeNode(node, msg);
      assert.equal(result.error, undefined, JSON.stringify(item));
      assert.deepEqual(calls.at(-1), { [item.key]: item.value });
    }
    const callsBeforeInvalid = calls.length;
    for (const dtype of [undefined, null, "", " ", false, true, 0, "u", "I", "STRING", "unknown", {}, []]) {
      const result = await invokeNode(node, { address: "D200", value: 1, dtype });
      assert.ok(result.error instanceof Error, `invalid bare dtype ${String(dtype)}`);
    }
    assert.ok((await invokeNode(node, { address: "D200", value: 1 })).error instanceof Error);
    for (const address of ["D200:U", "D200.3", "D200:STR,2"]) {
      for (const dtype of [undefined, null, "", false, "U", "D"]) {
        const result = await invokeNode(node, { address, value: 1, dtype });
        assert.match(result.error.message, /exactly once/);
      }
    }
    for (const address of ["D200:", "D200..3", "D200:U:BIT"]) {
      assert.ok((await invokeNode(node, { address, value: 1 })).error instanceof Error);
    }
    assert.equal(calls.length, callsBeforeInvalid);
  });
});

test("Node-RED SLMP name is optional display-only state", async () => {
  const { normalizeDisplayName } = require("../nodes/runtime-validation");
  for (const value of [undefined, null, "", "   ", false, 0, {}, []]) {
    assert.equal(normalizeDisplayName(value), "", `display name ${String(value)}`);
  }
  assert.equal(normalizeDisplayName("  Line A  "), "Line A");

  const readCalls = [];
  const writeCalls = [];
  class FakeSlmpClient {
    constructor(options) {
      this.plcProfile = options.plcProfile;
      this.frameType = "4e";
      this.plcSeries = "iqr";
      this.defaultTarget = slmp.normalizeTarget(options.defaultTarget);
    }
    async connect() {}
    async close() {}
  }
  await withMockedSlmp({
    SlmpClient: FakeSlmpClient,
    readNamed: async (...args) => {
      readCalls.push(args);
      return { "D100:U": 7 };
    },
    writeNamed: async (...args) => {
      writeCalls.push(args);
    },
  }, async () => {
    const runtime = createMockRed();
    require("../nodes/slmp-connection")(runtime.RED);
    require("../nodes/slmp-read")(runtime.RED);
    require("../nodes/slmp-write")(runtime.RED);

    const connectionBase = {
      host: "192.0.2.10",
      port: 5001,
      transport: "tcp",
      timeout: 3000,
      plcProfile: "melsec:iq-r",
      monitoringTimer: 16,
      network: 0,
      station: 255,
      moduleIO: 0x03ff,
      multidrop: 0,
      useRemotePassword: false,
    };
    const connectionWithoutName = runtime.create("slmp-connection", { ...connectionBase, id: "connection-a" });
    const connectionWithWhitespace = runtime.create("slmp-connection", { ...connectionBase, id: "connection-b", name: "   " });
    const connectionWithInvalidName = runtime.create("slmp-connection", {
      ...connectionBase,
      id: "connection-c",
      name: { host: "must-not-be-used" },
    });
    assert.equal(connectionWithoutName.name, "");
    assert.equal(connectionWithWhitespace.name, "");
    assert.equal(connectionWithInvalidName.name, "");
    assert.deepEqual([connectionWithoutName.id, connectionWithWhitespace.id, connectionWithInvalidName.id], [
      "connection-a",
      "connection-b",
      "connection-c",
    ]);
    assert.deepEqual(connectionWithoutName.getProfile(), connectionWithWhitespace.getProfile());
    assert.deepEqual(connectionWithoutName.getProfile(), connectionWithInvalidName.getProfile());

    const connection = {
      getClient: () => ({ marker: "same-client" }),
      getProfile: () => ({
        host: "192.0.2.10",
        port: 5001,
        transport: "tcp",
        plcProfile: "melsec:iq-r",
        frameType: "4e",
        plcSeries: "iqr",
        target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
        remotePasswordConfigured: false,
      }),
    };
    runtime.setNode("shared-connection", connection);
    const readBase = {
      connection: "shared-connection",
      addresses: "D100:U",
      addressesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "full",
      errorHandling: "throw",
      outputs: 1,
    };
    const writeBase = {
      connection: "shared-connection",
      updates: '{"D100:U":1}',
      updatesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      metadataMode: "full",
      errorHandling: "throw",
      outputs: 1,
    };
    const readA = runtime.createRaw("slmp-read", { ...readBase, id: "read-a" });
    const readB = runtime.createRaw("slmp-read", { ...readBase, id: "read-b", name: " duplicate " });
    const writeA = runtime.createRaw("slmp-write", { ...writeBase, id: "write-a", name: false });
    const writeB = runtime.createRaw("slmp-write", { ...writeBase, id: "write-b", name: "duplicate" });
    assert.equal(readA.name, "");
    assert.equal(readB.name, "duplicate");
    assert.equal(writeA.name, "");
    assert.equal(writeB.name, "duplicate");
    assert.equal(readA.connection, connection);
    assert.equal(readB.connection, connection);
    assert.equal(writeA.connection, connection);
    assert.equal(writeB.connection, connection);
    assert.deepEqual([readA.id, readB.id, writeA.id, writeB.id], ["read-a", "read-b", "write-a", "write-b"]);

    const readMessageA = {};
    const readMessageB = {};
    const writeMessageA = {};
    const writeMessageB = {};
    assert.equal((await invokeNode(readA, readMessageA)).error, undefined);
    assert.equal((await invokeNode(readB, readMessageB)).error, undefined);
    assert.equal((await invokeNode(writeA, writeMessageA)).error, undefined);
    assert.equal((await invokeNode(writeB, writeMessageB)).error, undefined);
    assert.deepEqual(readCalls[0], readCalls[1]);
    assert.deepEqual(writeCalls[0], writeCalls[1]);
    for (const message of [readMessageA, readMessageB, writeMessageA, writeMessageB]) {
      assert.equal(JSON.stringify(message).includes("duplicate"), false);
    }

    for (const file of ["slmp-connection.html", "slmp-read.html", "slmp-write.html"]) {
      const html = fs.readFileSync(path.join(__dirname, "..", "nodes", file), "utf8");
      assert.match(html, /name:\s*\{\s*value:\s*""\s*\}/);
      assert.doesNotMatch(html, /name:\s*\{[^}]*required:\s*true/);
    }
  });
});

test("removed skipUnsupported inputs only warn and preserve every configured error route", async () => {
  const makeUnsupportedError = () => {
    const error = new Error("selected PLC profile does not support this operation");
    error.code = "SLMP_PROFILE_FEATURE";
    error.details = { feature: "direct", plcProfile: "melsec:iq-r" };
    return error;
  };
  await withMockedSlmp({
    readNamed: async () => { throw makeUnsupportedError(); },
    writeNamed: async () => { throw makeUnsupportedError(); },
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    setNode("cfg-removed-skip", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });
    const variants = [
      { msg: {}, warns: 0 },
      { msg: { slmpSkipUnsupported: false }, warns: 1 },
      { msg: { slmpSkipUnsupported: true }, warns: 1 },
      { msg: { slmpSkipUnsupported: "true" }, warns: 1 },
      { msg: { slmp: { skipUnsupported: false } }, warns: 1 },
      { msg: { slmp: { skipUnsupported: true } }, warns: 1 },
      { msg: { slmp: { skipUnsupported: "true" } }, warns: 1 },
    ];
    for (const mode of ["throw", "msg", "output2"]) {
      for (const operation of ["read", "write"]) {
        for (const [index, variant] of variants.entries()) {
          const node = operation === "read"
            ? create("slmp-read", {
              id: `removed-skip-read-${mode}-${index}`,
              connection: "cfg-removed-skip",
              addresses: "D100:U",
              errorHandling: mode,
            })
            : create("slmp-write", {
              id: `removed-skip-write-${mode}-${index}`,
              connection: "cfg-removed-skip",
              updates: "{\"D100:U\":1}",
              errorHandling: mode,
            });
          const msg = structuredClone(variant.msg);
          const result = await invokeNode(node, msg);
          let error;
          if (mode === "throw") {
            error = result.error;
            assert.equal(result.sent.length, 0);
          } else if (mode === "msg") {
            error = msg.error;
            assert.equal(result.sent.length, 1);
            assert.equal(result.sent[0], msg);
          } else {
            error = result.sent[0][1].error;
            assert.equal(result.sent.length, 1);
            assert.equal(result.sent[0][0], null);
          }
          assert.equal(error.code, "SLMP_PROFILE_FEATURE");
          assert.deepEqual(error.details, { feature: "direct", plcProfile: "melsec:iq-r" });
          assert.equal(Object.prototype.hasOwnProperty.call(msg, "slmpSkippedUnsupported"), false);
          assert.equal(node.warnCalls.length, variant.warns);
          assert.equal(node.statusCalls.at(-1).fill, "red");
        }
      }
    }
  });
});

test("slmp-write supports connect/disconnect/reinitialize control messages", async () => {
  const actions = [];

  await withMockedSlmp({}, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-write")(RED);

    setNode("cfg-write-control", {
      connect: async () => actions.push("connect"),
      disconnect: async () => actions.push("disconnect"),
      reinitialize: async () => actions.push("reinitialize"),
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r" }),
    });

    const node = create("slmp-write", {
      id: "write-control",
      connection: "cfg-write-control",
      updates: "{\"D100:U\":42}",
    });

    const connectResult = await invokeNode(node, { topic: "connect" });
    const disconnectResult = await invokeNode(node, { disconnect: true });
    const reinitResult = await invokeNode(node, { reinitialize: true });

    assert.deepEqual(actions, ["connect", "disconnect", "reinitialize"]);
    assert.equal(connectResult.sent.length, 0);
    assert.equal(disconnectResult.sent.length, 0);
    assert.equal(reinitResult.sent.length, 0);
  });
});

test("slmp read and write require an exact saved source type", async () => {
  await withMockedSlmp({}, async () => {
    const { RED, createRaw } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);

    const readConfig = {
      id: "read-source-type-contract",
      connection: "cfg",
      addresses: "D100:U",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "full",
      errorHandling: "throw",
      outputs: 1,
    };
    const writeConfig = {
      id: "write-source-type-contract",
      connection: "cfg",
      updates: "{\"D100:U\":1}",
      routeTarget: "",
      routeTargetType: "str",
      metadataMode: "full",
      errorHandling: "throw",
      outputs: 1,
    };

    assert.throws(() => createRaw("slmp-read", readConfig), /addressesType is required/);
    assert.throws(() => createRaw("slmp-write", writeConfig), /updatesType is required/);
    for (const invalidType of [undefined, null, "", false, 0, "STR", "Msg", "unknown", {}, []]) {
      assert.throws(
        () => createRaw("slmp-read", { ...readConfig, addressesType: invalidType }),
        /addressesType is required/,
      );
      assert.throws(
        () => createRaw("slmp-write", { ...writeConfig, updatesType: invalidType }),
        /updatesType is required/,
      );
    }

    const readHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-read.html"), "utf8");
    const writeHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-write.html"), "utf8");
    assert.match(readHtml, /addressesType:\s*\{\s*value:\s*"str",\s*required:\s*true\s*\}/);
    assert.match(writeHtml, /updatesType:\s*\{\s*value:\s*"str",\s*required:\s*true\s*\}/);
    assert.doesNotMatch(readHtml, /this\.addressesType\s*\|\|\s*"str"/);
    assert.doesNotMatch(writeHtml, /this\.updatesType\s*\|\|\s*"str"/);
  });
});

test("slmp read and write evaluate every supported source type without fallback", async () => {
  const readCalls = [];
  const writeCalls = [];

  await withMockedSlmp({
    readNamed: async (_client, addresses) => {
      readCalls.push(addresses);
      return Object.fromEntries(addresses.map((address) => [address, 1]));
    },
    writeNamed: async (_client, updates) => {
      writeCalls.push(updates);
    },
  }, async () => {
    const { RED, createRaw, setNode, setFlow, setGlobal, setEnv } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    setNode("cfg-source-types", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });

    setFlow("read-source", "D101:U");
    setGlobal("read-source", ["D102:U"]);
    setEnv("read-source", "D103:U");
    setFlow("write-source", { "D101:U": 11 });
    setGlobal("write-source", { "D102:U": 12 });
    setEnv("write-source", { "D103:U": 13 });

    const cases = [
      { type: "str", readValue: "D100:U", writeValue: "{\"D100:U\":10}", msg: {} },
      { type: "msg", readValue: "input.addresses", writeValue: "input.updates", msg: { input: { addresses: "D104:U", updates: { "D104:U": 14 } } } },
      { type: "flow", readValue: "read-source", writeValue: "write-source", msg: {} },
      { type: "global", readValue: "read-source", writeValue: "write-source", msg: {} },
      { type: "env", readValue: "read-source", writeValue: "write-source", msg: {} },
    ];
    for (const [index, sourceCase] of cases.entries()) {
      const readNode = createRaw("slmp-read", {
        id: `read-source-${sourceCase.type}`,
        connection: "cfg-source-types",
        addresses: sourceCase.readValue,
        addressesType: sourceCase.type,
        routeTarget: "",
        routeTargetType: "str",
        outputMode: "object",
        metadataMode: "full",
        errorHandling: "throw",
        outputs: 1,
      });
      const writeNode = createRaw("slmp-write", {
        id: `write-source-${sourceCase.type}`,
        connection: "cfg-source-types",
        updates: sourceCase.writeValue,
        updatesType: sourceCase.type,
        routeTarget: "",
        routeTargetType: "str",
        metadataMode: "full",
        errorHandling: "throw",
        outputs: 1,
      });
      const readResult = await invokeNode(readNode, structuredClone(sourceCase.msg));
      const writeResult = await invokeNode(writeNode, structuredClone(sourceCase.msg));
      assert.equal(readResult.error, undefined, `read source type ${sourceCase.type}`);
      assert.equal(writeResult.error, undefined, `write source type ${sourceCase.type}`);
      assert.equal(readCalls.length, index + 1);
      assert.equal(writeCalls.length, index + 1);
    }

    const missingReadNode = createRaw("slmp-read", {
      id: "read-missing-reference",
      connection: "cfg-source-types",
      addresses: "missing.path",
      addressesType: "msg",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    const missingWriteNode = createRaw("slmp-write", {
      id: "write-missing-reference",
      connection: "cfg-source-types",
      updates: "missing.path",
      updatesType: "msg",
      routeTarget: "",
      routeTargetType: "str",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    const readCount = readCalls.length;
    const writeCount = writeCalls.length;
    assert.ok((await invokeNode(missingReadNode, {})).error instanceof Error);
    assert.ok((await invokeNode(missingWriteNode, {})).error instanceof Error);
    assert.equal(readCalls.length, readCount);
    assert.equal(writeCalls.length, writeCount);

    const evaluatorMissingNode = createRaw("slmp-read", {
      id: "read-evaluator-missing",
      connection: "cfg-source-types",
      addresses: "input.addresses",
      addressesType: "msg",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    delete RED.util;
    const evaluatorResult = await invokeNode(evaluatorMissingNode, { input: { addresses: "D105:U" } });
    assert.match(evaluatorResult.error.message, /property evaluator is unavailable/);
    assert.equal(readCalls.length, readCount);
  });
});

test("slmp runtime input properties never fall back to configured operations", async () => {
  let readCalls = 0;
  let writeCalls = 0;
  await withMockedSlmp({
    readNamed: async (_client, addresses) => {
      readCalls += 1;
      return Object.fromEntries(addresses.map((address) => [address, 1]));
    },
    writeNamed: async () => {
      writeCalls += 1;
    },
  }, async () => {
    const { RED, createRaw, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    setNode("cfg-runtime-contract", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });
    const readNode = createRaw("slmp-read", {
      id: "read-runtime-contract",
      connection: "cfg-runtime-contract",
      addresses: "D900:U",
      addressesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    const writeNode = createRaw("slmp-write", {
      id: "write-runtime-contract",
      connection: "cfg-runtime-contract",
      updates: "{\"D900:U\":900}",
      updatesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });

    for (const addresses of [undefined, null, "", " ", false, 0, {}, [], [null], [""]]) {
      const result = await invokeNode(readNode, { addresses });
      assert.ok(result.error instanceof Error, `invalid msg.addresses ${String(addresses)}`);
      assert.equal(result.sent.length, 0);
    }
    for (const updates of [undefined, null, "", " ", false, 0, [], {}, "{bad", "{}"]) {
      const result = await invokeNode(writeNode, { updates });
      assert.ok(result.error instanceof Error, `invalid msg.updates ${String(updates)}`);
      assert.equal(result.sent.length, 0);
    }
    for (const address of [undefined, null, "", " ", false, 0, {}, []]) {
      const result = await invokeNode(writeNode, { address, value: 1, dtype: "U" });
      assert.ok(result.error instanceof Error, `invalid msg.address ${String(address)}`);
      assert.equal(result.sent.length, 0);
    }
    for (const msg of [
      { address: "D100", dtype: "U" },
      { updates: { "D100:U": 1 }, address: "D101", value: 2, dtype: "U" },
      { updates: { "D100:U": 1 }, value: 2 },
      { updates: { "D100:U": 1 }, dtype: "U" },
      { value: 1 },
      { dtype: "U" },
      { value: 1, dtype: "U" },
    ]) {
      const result = await invokeNode(writeNode, msg);
      assert.ok(result.error instanceof Error, `conflicting or isolated runtime fields ${JSON.stringify(msg)}`);
      assert.equal(result.sent.length, 0);
    }
    assert.equal(readCalls, 0);
    assert.equal(writeCalls, 0);

    assert.equal((await invokeNode(readNode, { addresses: ["D100:U"] })).error, undefined);
    assert.equal((await invokeNode(writeNode, { updates: { "D100:U": 1 } })).error, undefined);
    assert.equal((await invokeNode(writeNode, { address: "D101", value: 2, dtype: "U" })).error, undefined);
    assert.equal(readCalls, 1);
    assert.equal(writeCalls, 2);
  });
});

test("slmp read and write require route source type only for an explicit configured override", async () => {
  await withMockedSlmp({}, async () => {
    const { RED, createRaw } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    const readBase = {
      id: "read-route-type-contract",
      connection: "cfg",
      addresses: "D100:U",
      addressesType: "str",
      outputMode: "object",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    };
    const writeBase = {
      id: "write-route-type-contract",
      connection: "cfg",
      updates: "{\"D100:U\":1}",
      updatesType: "str",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    };

    assert.doesNotThrow(() => createRaw("slmp-read", readBase));
    assert.doesNotThrow(() => createRaw("slmp-write", writeBase));
    for (const invalidRouteTarget of [null, false, 0, {}, []]) {
      assert.throws(() => createRaw("slmp-read", { ...readBase, routeTarget: invalidRouteTarget }), /routeTarget must be/);
      assert.throws(() => createRaw("slmp-write", { ...writeBase, routeTarget: invalidRouteTarget }), /routeTarget must be/);
    }
    for (const invalidType of [undefined, null, "", false, 0, "STR", "Msg", "unknown", {}, []]) {
      assert.throws(
        () => createRaw("slmp-read", { ...readBase, routeTarget: "route", routeTargetType: invalidType }),
        /routeTargetType is required/,
      );
      assert.throws(
        () => createRaw("slmp-write", { ...writeBase, routeTarget: "route", routeTargetType: invalidType }),
        /routeTargetType is required/,
      );
    }

    const readHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-read.html"), "utf8");
    const writeHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-write.html"), "utf8");
    assert.match(readHtml, /routeTargetType:\s*\{\s*value:\s*"str",\s*required:\s*true\s*\}/);
    assert.match(writeHtml, /routeTargetType:\s*\{\s*value:\s*"str",\s*required:\s*true\s*\}/);
    assert.doesNotMatch(readHtml, /this\.routeTargetType\s*\|\|\s*"str"/);
    assert.doesNotMatch(writeHtml, /this\.routeTargetType\s*\|\|\s*"str"/);
  });
});

test("slmp route override sources never fall back to the connection route", async () => {
  const readTargets = [];
  const writeTargets = [];
  await withMockedSlmp({
    readNamed: async (_client, addresses, options) => {
      readTargets.push(options.target);
      return { [addresses[0]]: 1 };
    },
    writeNamed: async (_client, _updates, options) => {
      writeTargets.push(options.target);
    },
  }, async () => {
    const { RED, createRaw, setNode, setFlow, setGlobal, setEnv } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    setNode("cfg-route-sources", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });

    const routes = [
      { network: 1, station: 1, moduleIO: 0x0101, multidrop: 1 },
      { network: 2, station: 2, moduleIO: 0x0202, multidrop: 2 },
      { network: 3, station: 3, moduleIO: 0x0303, multidrop: 3 },
      { network: 4, station: 4, moduleIO: 0x0404, multidrop: 4 },
      { network: 5, station: 5, moduleIO: 0x0505, multidrop: 5 },
    ];
    setFlow("route-source", routes[2]);
    setGlobal("route-source", routes[3]);
    setEnv("route-source", routes[4]);
    const cases = [
      { type: "str", value: JSON.stringify(routes[0]), msg: {} },
      { type: "msg", value: "route", msg: { route: routes[1] } },
      { type: "flow", value: "route-source", msg: {} },
      { type: "global", value: "route-source", msg: {} },
      { type: "env", value: "route-source", msg: {} },
    ];
    for (const [index, sourceCase] of cases.entries()) {
      const readNode = createRaw("slmp-read", {
        id: `read-route-${sourceCase.type}`,
        connection: "cfg-route-sources",
        addresses: "D100:U",
        addressesType: "str",
        routeTarget: sourceCase.value,
        routeTargetType: sourceCase.type,
        outputMode: "object",
        metadataMode: "full",
        errorHandling: "throw",
        outputs: 1,
      });
      const writeNode = createRaw("slmp-write", {
        id: `write-route-${sourceCase.type}`,
        connection: "cfg-route-sources",
        updates: "{\"D100:U\":1}",
        updatesType: "str",
        routeTarget: sourceCase.value,
        routeTargetType: sourceCase.type,
        metadataMode: "full",
        errorHandling: "throw",
        outputs: 1,
      });
      const readMsg = structuredClone(sourceCase.msg);
      const writeMsg = structuredClone(sourceCase.msg);
      assert.equal((await invokeNode(readNode, readMsg)).error, undefined);
      assert.equal((await invokeNode(writeNode, writeMsg)).error, undefined);
      assert.deepEqual(readTargets[index], routes[index]);
      assert.deepEqual(writeTargets[index], routes[index]);
      assert.equal(readMsg.slmp.targetSource, `configured.${sourceCase.type}`);
      assert.equal(writeMsg.slmp.targetSource, `configured.${sourceCase.type}`);
    }

    const readNode = createRaw("slmp-read", {
      id: "read-route-invalid-reference",
      connection: "cfg-route-sources",
      addresses: "D100:U",
      addressesType: "str",
      routeTarget: "route",
      routeTargetType: "msg",
      outputMode: "object",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    const writeNode = createRaw("slmp-write", {
      id: "write-route-invalid-reference",
      connection: "cfg-route-sources",
      updates: "{\"D100:U\":1}",
      updatesType: "str",
      routeTarget: "route",
      routeTargetType: "msg",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    const readCount = readTargets.length;
    const writeCount = writeTargets.length;
    for (const invalidRoute of [undefined, null, "", " ", false, 0, [], "not-json", { network: 1 }]) {
      const msg = invalidRoute === undefined ? {} : { route: invalidRoute };
      assert.ok((await invokeNode(readNode, structuredClone(msg))).error instanceof Error);
      assert.ok((await invokeNode(writeNode, structuredClone(msg))).error instanceof Error);
      assert.equal(readTargets.length, readCount);
      assert.equal(writeTargets.length, writeCount);
    }

    const configuredRouteRead = createRaw("slmp-read", {
      id: "read-route-priority",
      connection: "cfg-route-sources",
      addresses: "D100:U",
      addressesType: "str",
      routeTarget: JSON.stringify(routes[0]),
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    });
    assert.ok((await invokeNode(configuredRouteRead, { target: null })).error instanceof Error);
    assert.ok((await invokeNode(configuredRouteRead, { slmp: { target: { network: 1 } } })).error instanceof Error);
    assert.equal(readTargets.length, readCount);
    const explicitTarget = { network: 9, station: 9, moduleIO: 0x0909, multidrop: 9 };
    assert.equal((await invokeNode(configuredRouteRead, { target: explicitTarget })).error, undefined);
    assert.deepEqual(readTargets.at(-1), explicitTarget);
  });
});

test("slmp-read output modes have exact saved values and fixed payload types", async () => {
  let readCalls = 0;
  await withMockedSlmp({
    readNamed: async (_client, addresses) => {
      readCalls += 1;
      return Object.fromEntries(addresses.map((address, index) => [address, index + 7]));
    },
  }, async () => {
    const { RED, createRaw, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);
    setNode("cfg-output-modes", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });
    const base = {
      id: "read-output-mode-contract",
      connection: "cfg-output-modes",
      addresses: "addresses",
      addressesType: "msg",
      routeTarget: "",
      routeTargetType: "str",
      metadataMode: "off",
      errorHandling: "throw",
      outputs: 1,
    };
    assert.throws(() => createRaw("slmp-read", base), /outputMode is required/);
    for (const invalidMode of [undefined, null, "", false, 0, "OBJECT", "Value", "unknown", {}, []]) {
      assert.throws(() => createRaw("slmp-read", { ...base, outputMode: invalidMode }), /outputMode is required/);
    }

    const cases = [
      { mode: "object", addresses: ["D100:U"], expected: { "D100:U": 7 } },
      { mode: "object", addresses: ["D100:U", "D101:U"], expected: { "D100:U": 7, "D101:U": 8 } },
      { mode: "array", addresses: ["D100:U"], expected: [7] },
      { mode: "array", addresses: ["D100:U", "D101:U"], expected: [7, 8] },
      { mode: "value", addresses: ["D100:U"], expected: 7 },
    ];
    for (const [index, outputCase] of cases.entries()) {
      const node = createRaw("slmp-read", { ...base, id: `read-output-${index}`, outputMode: outputCase.mode });
      const msg = { addresses: outputCase.addresses };
      const result = await invokeNode(node, msg);
      assert.equal(result.error, undefined);
      assert.deepEqual(msg.payload, outputCase.expected);
    }
    const callsBeforeError = readCalls;
    const valueNode = createRaw("slmp-read", { ...base, id: "read-output-value-count", outputMode: "value" });
    const multipleResult = await invokeNode(valueNode, { addresses: ["D100:U", "D101:U"] });
    const emptyResult = await invokeNode(valueNode, { addresses: [] });
    assert.match(multipleResult.error.message, /exactly one address/);
    assert.match(emptyResult.error.message, /must not be empty/);
    assert.equal(multipleResult.sent.length, 0);
    assert.equal(emptyResult.sent.length, 0);
    assert.equal(readCalls, callsBeforeError);

    const html = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-read.html"), "utf8");
    assert.match(html, /outputMode:\s*\{\s*value:\s*"object",\s*required:\s*true\s*\}/);
    assert.doesNotMatch(html, /outputMode\s*\|\|\s*"object"/);
  });
});

test("slmp metadata modes replace only owned fields for the current operation", async () => {
  await withMockedSlmp({
    readNamed: async () => ({ "D100:U": 7 }),
    writeNamed: async () => undefined,
  }, async () => {
    const { RED, createRaw, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    setNode("cfg-metadata-contract", {
      getClient: () => ({}),
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET, host: "127.0.0.1" }),
    });
    const readBase = {
      id: "read-metadata-contract",
      connection: "cfg-metadata-contract",
      addresses: "D100:U",
      addressesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      errorHandling: "throw",
      outputs: 1,
    };
    const writeBase = {
      id: "write-metadata-contract",
      connection: "cfg-metadata-contract",
      updates: "{\"D100:U\":8}",
      updatesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      errorHandling: "throw",
      outputs: 1,
    };
    for (const invalidMode of [undefined, null, "", false, 0, "FULL", "Minimal", "unknown", {}, []]) {
      assert.throws(() => createRaw("slmp-read", { ...readBase, metadataMode: invalidMode }), /metadataMode is required/);
      assert.throws(() => createRaw("slmp-write", { ...writeBase, metadataMode: invalidMode }), /metadataMode is required/);
    }

    const fullRead = createRaw("slmp-read", { ...readBase, id: "read-metadata-full", metadataMode: "full" });
    const fullWrite = createRaw("slmp-write", { ...writeBase, id: "write-metadata-full", metadataMode: "full" });
    const msg = {
      slmp: {
        custom: "keep",
        operation: "write",
        updates: { stale: true },
        addresses: ["STALE"],
        connection: { stale: true },
        targetSource: "stale",
        itemCount: 99,
        metadataMode: "minimal",
      },
    };
    assert.equal((await invokeNode(fullRead, msg)).error, undefined);
    assert.equal(msg.slmp.custom, "keep");
    assert.equal(msg.slmp.operation, "read");
    assert.deepEqual(msg.slmp.addresses, ["D100:U"]);
    assert.equal(Object.prototype.hasOwnProperty.call(msg.slmp, "updates"), false);
    assert.equal(msg.slmp.itemCount, 1);
    assert.equal(msg.slmp.metadataMode, "full");
    assert.equal(msg.slmp.targetSource, "connection");

    assert.equal((await invokeNode(fullWrite, msg)).error, undefined);
    assert.equal(msg.slmp.custom, "keep");
    assert.equal(msg.slmp.operation, "write");
    assert.deepEqual(msg.slmp.updates, { "D100:U": 8 });
    assert.equal(Object.prototype.hasOwnProperty.call(msg.slmp, "addresses"), false);
    assert.equal(msg.slmp.itemCount, 1);
    assert.equal(msg.slmp.metadataMode, "full");
    assert.equal(msg.slmp.targetSource, "msg.slmp.target");

    const minimalRead = createRaw("slmp-read", { ...readBase, id: "read-metadata-minimal-contract", metadataMode: "minimal" });
    assert.equal((await invokeNode(minimalRead, msg)).error, undefined);
    assert.deepEqual(msg.slmp, {
      custom: "keep",
      operation: "read",
      target: TEST_TARGET,
      targetSource: "msg.slmp.target",
      itemCount: 1,
      metadataMode: "minimal",
    });

    const offRead = createRaw("slmp-read", { ...readBase, id: "read-metadata-off-contract", metadataMode: "off" });
    const existing = { custom: "unchanged", operation: "old", updates: { stale: true } };
    const offMsg = { slmp: existing };
    assert.equal((await invokeNode(offRead, offMsg)).error, undefined);
    assert.equal(offMsg.slmp, existing);
    assert.deepEqual(offMsg.slmp, { custom: "unchanged", operation: "old", updates: { stale: true } });

    const readHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-read.html"), "utf8");
    const writeHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-write.html"), "utf8");
    assert.match(readHtml, /metadataMode:\s*\{\s*value:\s*"full",\s*required:\s*true\s*\}/);
    assert.match(writeHtml, /metadataMode:\s*\{\s*value:\s*"full",\s*required:\s*true\s*\}/);
    assert.doesNotMatch(readHtml, /metadataMode\s*\|\|\s*"full"/);
    assert.doesNotMatch(writeHtml, /metadataMode\s*\|\|\s*"full"/);
  });
});

test("slmp error modes and output counts define one exact message route", async () => {
  const clientState = { fail: false };
  await withMockedSlmp({
    readNamed: async () => {
      if (clientState.fail) throw new Error("read transport failed");
      return { "D100:U": 7 };
    },
    writeNamed: async () => {
      if (clientState.fail) throw new Error("write transport failed");
    },
  }, async () => {
    const { RED, createRaw, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);
    require("../nodes/slmp-write")(RED);
    setNode("cfg-error-modes", {
      getClient: () => clientState,
      getProfile: () => ({ plcProfile: "melsec:iq-r", target: TEST_TARGET }),
    });
    const readBase = {
      id: "read-error-contract",
      connection: "cfg-error-modes",
      addresses: "D100:U",
      addressesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      outputMode: "object",
      metadataMode: "off",
    };
    const writeBase = {
      id: "write-error-contract",
      connection: "cfg-error-modes",
      updates: "{\"D100:U\":8}",
      updatesType: "str",
      routeTarget: "",
      routeTargetType: "str",
      metadataMode: "off",
    };
    for (const invalidMode of [undefined, null, "", false, 0, "THROW", "Msg", "unknown", {}, []]) {
      assert.throws(() => createRaw("slmp-read", { ...readBase, errorHandling: invalidMode, outputs: 1 }), /errorHandling is required/);
      assert.throws(() => createRaw("slmp-write", { ...writeBase, errorHandling: invalidMode, outputs: 1 }), /errorHandling is required/);
    }
    for (const [mode, outputs] of [["throw", 1], ["msg", 1], ["output2", 2]]) {
      assert.equal(createRaw("slmp-read", { ...readBase, errorHandling: mode }).outputs, outputs);
      assert.equal(createRaw("slmp-write", { ...writeBase, errorHandling: mode }).outputs, outputs);
      for (const invalidOutputs of [undefined, null, "", false, true, 0, "1", "2", outputs === 1 ? 2 : 1, {}, []]) {
        if (invalidOutputs === undefined) continue;
        assert.throws(
          () => createRaw("slmp-read", { ...readBase, errorHandling: mode, outputs: invalidOutputs }),
          /conflicts/,
        );
        assert.throws(
          () => createRaw("slmp-write", { ...writeBase, errorHandling: mode, outputs: invalidOutputs }),
          /conflicts/,
        );
      }

      const readNode = createRaw("slmp-read", { ...readBase, id: `read-error-${mode}`, errorHandling: mode, outputs });
      const writeNode = createRaw("slmp-write", { ...writeBase, id: `write-error-${mode}`, errorHandling: mode, outputs });
      clientState.fail = false;
      for (const node of [readNode, writeNode]) {
        const success = await invokeNode(node, {});
        assert.equal(success.error, undefined);
        assert.equal(success.sent.length, 1);
        assert.equal(Array.isArray(success.sent[0]), false);
      }
      clientState.fail = true;
      for (const node of [readNode, writeNode]) {
        const failedMsg = {};
        const failed = await invokeNode(node, failedMsg);
        if (mode === "throw") {
          assert.ok(failed.error instanceof Error);
          assert.equal(failed.sent.length, 0);
        } else if (mode === "msg") {
          assert.equal(failed.error, undefined);
          assert.equal(failed.sent.length, 1);
          assert.equal(failed.sent[0], failedMsg);
          assert.ok(failedMsg.error instanceof Error);
        } else {
          assert.equal(failed.error, undefined);
          assert.equal(failed.sent.length, 1);
          assert.equal(Array.isArray(failed.sent[0]), true);
          assert.equal(failed.sent[0][0], null);
          assert.ok(failed.sent[0][1].error instanceof Error);
        }
      }
    }

    const readHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-read.html"), "utf8");
    const writeHtml = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-write.html"), "utf8");
    for (const html of [readHtml, writeHtml]) {
      assert.match(html, /errorHandling:\s*\{\s*value:\s*"throw",\s*required:\s*true\s*\}/);
      assert.match(html, /this\.outputs\s*=\s*\$\("#node-input-errorHandling"\)\.val\(\)\s*===\s*"output2"\s*\?\s*2\s*:\s*1/);
      assert.doesNotMatch(html, /errorHandling\s*\|\|\s*"throw"/);
    }
  });
});

function createMockRed() {
  const registeredTypes = new Map();
  const nodes = new Map();
  const flowValues = new Map();
  const globalValues = new Map();
  const envValues = new Map();

  const RED = {
    nodes: {
      createNode(node, config) {
        const emitter = new EventEmitter();
        node.on = emitter.on.bind(emitter);
        node.once = emitter.once.bind(emitter);
        node.emit = emitter.emit.bind(emitter);
        node.removeListener = emitter.removeListener.bind(emitter);
        node.sendCalls = [];
        node.statusCalls = [];
        node.warnCalls = [];
        node.send = (message) => node.sendCalls.push(message);
        node.status = (status) => node.statusCalls.push(status);
        node.warn = (warning) => node.warnCalls.push(warning);
        node.id = config.id;
        node.credentials = config.credentials || {};
        if (config.id) {
          nodes.set(config.id, node);
        }
      },
      registerType(name, constructor) {
        registeredTypes.set(name, constructor);
      },
      getNode(id) {
        return nodes.get(id);
      },
    },
    util: {
      evaluateNodeProperty(value, type, _node, msg, callback) {
        try {
          callback(null, evaluateValue(value, type, msg, flowValues, globalValues, envValues));
        } catch (error) {
          callback(error);
        }
      },
    },
  };

  return {
    RED,
    createRaw(name, config) {
      const Constructor = registeredTypes.get(name);
      assert.ok(Constructor, `Node type ${name} is registered`);
      return new Constructor(config);
    },
    create(name, config) {
      const Constructor = registeredTypes.get(name);
      assert.ok(Constructor, `Node type ${name} is not registered`);
      const editorDefaults = name === "slmp-read"
        ? { addressesType: "str", routeTargetType: "str", outputMode: "object", metadataMode: "full", errorHandling: "throw", outputs: 1 }
        : name === "slmp-write"
          ? { updatesType: "str", routeTargetType: "str", metadataMode: "full", errorHandling: "throw", outputs: 1 }
          : {};
      const resolved = { ...editorDefaults, ...config };
      if ((name === "slmp-read" || name === "slmp-write") && !Object.prototype.hasOwnProperty.call(config, "outputs")) {
        resolved.outputs = resolved.errorHandling === "output2" ? 2 : 1;
      }
      return new Constructor(resolved);
    },
    setNode(id, node) {
      nodes.set(id, node);
    },
    setFlow(key, value) {
      flowValues.set(key, value);
    },
    setGlobal(key, value) {
      globalValues.set(key, value);
    },
    setEnv(key, value) {
      envValues.set(key, value);
    },
  };
}

function evaluateValue(value, type, msg, flowValues, globalValues, envValues) {
  if (!type || type === "str") {
    return value;
  }
  if (type === "msg") {
    return getPathValue(msg, value);
  }
  if (type === "flow") {
    return flowValues.get(String(value));
  }
  if (type === "global") {
    return globalValues.get(String(value));
  }
  if (type === "env") {
    return envValues.get(String(value));
  }
  throw new Error(`Unsupported type ${type}`);
}

function getPathValue(source, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), source);
}

function invokeNode(node, msg) {
  return new Promise((resolve) => {
    const sent = [];
    node.emit("input", msg, (message) => sent.push(message), (error) => {
      resolve({ error, sent });
    });
  });
}

async function withMockedSlmp(overrides, work) {
  const slmpModulePath = require.resolve("../lib/slmp");
  const originalSlmpModule = require.cache[slmpModulePath];
  const nodeModulePaths = [
    require.resolve("../nodes/slmp-connection"),
    require.resolve("../nodes/slmp-read"),
    require.resolve("../nodes/slmp-write"),
  ];

  require.cache[slmpModulePath] = {
    id: slmpModulePath,
    filename: slmpModulePath,
    loaded: true,
    exports: { ...slmp, ...overrides },
  };

  for (const nodeModulePath of nodeModulePaths) {
    delete require.cache[nodeModulePath];
  }

  try {
    return await work();
  } finally {
    for (const nodeModulePath of nodeModulePaths) {
      delete require.cache[nodeModulePath];
    }
    if (originalSlmpModule) {
      require.cache[slmpModulePath] = originalSlmpModule;
    } else {
      delete require.cache[slmpModulePath];
    }
  }
}
