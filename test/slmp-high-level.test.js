"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const slmp = require("../lib/slmp");
const { formatParsedAddress, normalizeAddress, normalizeAddressList, parseAddress, readNamed, readTyped, writeNamed, writeTyped } = slmp;

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
  assert.deepEqual(parseAddress("DSTR200,8"), {
    base: "D200",
    dtype: "STR",
    bitIndex: null,
    count: 8,
    hasCount: true,
    explicitDtype: true,
  });
});

test("normalizeAddress and formatParsedAddress keep one canonical spelling", () => {
  assert.equal(normalizeAddress(" d200:f "), "D200:F");
  assert.equal(normalizeAddress("d50.a"), "D50.A");
  assert.equal(normalizeAddress("d50.d"), "D50.D");
  assert.equal(normalizeAddress("dstr200,8"), "D200:STR,8");
  assert.equal(normalizeAddress("d100:i"), "D100:S");
  assert.equal(formatParsedAddress(parseAddress("D100:U,10")), "D100:U,10");
  assert.throws(() => parseAddress("D100,10"), /requires an explicit dtype/i);
  assert.throws(() => normalizeAddress("d50.10"), /invalid bit-in-word/i);
  assert.throws(() => parseAddress("D50:BIT_IN_WORD"), /no bit index/i);
  assert.throws(() => normalizeAddress("x1a:BIT"), /require explicit plcProfile/i);
  assert.equal(normalizeAddress("x1a:BIT", { plcProfile: "melsec:iq-r" }), "X1A:BIT");
  assert.equal(normalizeAddress("y217:BIT", { plcProfile: "melsec:iq-f" }), "Y217:BIT");
  assert.throws(() => normalizeAddress("x1a:BIT", { plcProfile: "iq-r" }), /Unsupported plcProfile/);
});

test("readNamed and writeNamed reject BIT_IN_WORD without an explicit bit index", async () => {
  const fakeClient = {
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

test("normalizeAddressList keeps count suffixes in comma-separated input", () => {
  assert.deepEqual(normalizeAddressList("D100:U,10,D200:F,M1000:BIT"), ["D100:U,10", "D200:F", "M1000:BIT"]);
  assert.deepEqual(normalizeAddressList("D100:STR,10 D200:U,2"), ["D100:STR,10", "D200:U,2"]);
});

test("readNamed batches word and dword requests like the Python helper layer", async () => {
  const calls = [];
  const fakeClient = {
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
        },
        dword: {
          D200: 0x40490fdb,
        },
      };
    },
    async readDevices(device, points, options) {
      calls.push({ kind: "readDevices", device: `${device.code}${device.number}`, points, options });
      if (device.code === "M") {
        return [true];
      }
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
  assert.ok(calls.some((call) => call.kind === "readRandom"));
  assert.ok(
    calls.some(
      (call) =>
        call.kind === "readDevices" &&
        call.device === "M1000" &&
        call.points === 1 &&
        call.options.bitUnit === true
    )
  );
  assert.ok(
    calls.some(
      (call) =>
        call.kind === "readDevices" &&
        call.device === "D50" &&
        call.points === 1 &&
        call.options.bitUnit === false
    )
  );
});

test("readNamed splits random reads at the iQ-R manual batch limit", async () => {
  const calls = [];
  const fakeClient = {
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
  const snapshot = await readNamed(fakeClient, addresses);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].wordDevices.length, 96);
  assert.equal(calls[1].wordDevices.length, 1);
  assert.equal(calls[1].wordDevices[0], "D192");
  assert.equal(snapshot["D0:U"], 0);
  assert.equal(snapshot["D192:U"], 192);
});

test("writeNamed supports word, bit-in-word, direct bit, and float writes", async () => {
  const writes = [];
  const fakeClient = {
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

  await writeNamed(fakeClient, {
    "D100:U": 42,
    "D50.3": true,
    "M1000:BIT": true,
    "D200:F": 3.5,
  });

  const randomWrite = writes.find((write) => write.kind === "writeRandomWords");
  const bitWrite = writes.find((write) => write.kind === "writeDevices" && write.device === "M1000");
  const wordWrite = writes.find((write) => write.kind === "writeDevices" && write.device === "D50");

  assert.deepEqual(randomWrite.wordValues, [["D100", 42]]);
  assert.equal(randomWrite.dwordValues.length, 1);
  assert.equal(randomWrite.dwordValues[0][0], "D200");
  assert.deepEqual(wordWrite, { kind: "writeDevices", device: "D50", values: [8], bitUnit: false });
  assert.deepEqual(bitWrite, { kind: "writeDevices", device: "M1000", values: [true], bitUnit: true });
});

test("writeNamed splits random word writes at the iQ-R manual weighted limit", async () => {
  const writes = [];
  const fakeClient = {
    async writeRandomWords({ wordValues, dwordValues }) {
      writes.push({
        wordValues: wordValues.map(([device, value]) => [`${device.code}${device.number}`, value]),
        dwordValues,
      });
    },
  };

  const updates = Object.fromEntries(Array.from({ length: 81 }, (_, index) => [`D${index * 2}:U`, index]));
  await writeNamed(fakeClient, updates);

  assert.equal(writes.length, 2);
  assert.equal(writes[0].wordValues.length, 80);
  assert.equal(writes[1].wordValues.length, 1);
  assert.deepEqual(writes[1].wordValues[0], ["D160", 80]);
});

test("readNamed coalesces contiguous direct bits and word ranges into block reads", async () => {
  const calls = [];
  const fakeClient = {
    async readRandom() {
      throw new Error("unexpected random read");
    },
    async readDevices(device, points, options) {
      calls.push({
        device: `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      if (device.code === "M") {
        return [true, false, true];
      }
      if (device.code === "D") {
        return [11, 12, 13];
      }
      throw new Error("unexpected block read");
    },
  };

  const snapshot = await readNamed(fakeClient, ["M1000:BIT", "M1001:BIT", "M1002:BIT", "D100:U", "D101:U", "D102:U"]);
  assert.deepEqual(snapshot, {
    "M1000:BIT": true,
    "M1001:BIT": false,
    "M1002:BIT": true,
    "D100:U": 11,
    "D101:U": 12,
    "D102:U": 13,
  });
  assert.deepEqual(calls, [
    { device: "M1000", points: 3, bitUnit: true },
    { device: "D100", points: 3, bitUnit: false },
  ]);
});

test("readNamed supports count arrays and string addresses", async () => {
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

  const snapshot = await readNamed(fakeClient, ["M1000:BIT,3", "D100:U,3", "D200:F,2", "D300:STR,5", "DSTR400,4"]);
  assert.deepEqual(snapshot, {
    "M1000:BIT,3": [true, false, true],
    "D100:U,3": [11, 12, 13],
    "D200:F,2": [1.5, -2.25],
    "D300:STR,5": "HELLO",
    "DSTR400,4": "ABCD",
  });
  assert.deepEqual(calls, [
    { device: "M1000", points: 3, bitUnit: true },
    { device: "D100", points: 3, bitUnit: false },
    { device: "D200", points: 4, bitUnit: false },
    { device: "D300", points: 3, bitUnit: false },
    { device: "D400", points: 2, bitUnit: false },
  ]);
});

test("readNamed resolves LT and LST families through helper-backed 4-word blocks", async () => {
  const calls = [];
  const fakeClient = {
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

  const snapshot = await readNamed(fakeClient, ["LTN0:D", "LTC0:BIT", "LTS0:BIT", "LTN1:D", "LSTN4:D", "LSTC4:BIT", "LSTS4:BIT,2"]);
  assert.deepEqual(snapshot, {
    "LTN0:D": 0x00010002,
    "LTC0:BIT": true,
    "LTS0:BIT": true,
    "LTN1:D": 4,
    "LSTN4:D": 6,
    "LSTC4:BIT": true,
    "LSTS4:BIT,2": [false, true],
  });
  assert.deepEqual(calls, [
    { device: "LTN0", points: 8, bitUnit: false },
    { device: "LSTN4", points: 8, bitUnit: false },
  ]);
});

test("readTyped resolves long-family values through supported routes", async () => {
  const calls = [];
  const fakeClient = {
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

  assert.equal(await readTyped(fakeClient, { code: "LTN", number: 0 }, "D"), 0x00010002);
  assert.equal(await readTyped(fakeClient, { code: "LTS", number: 0 }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LTC", number: 0 }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LSTN", number: 4 }, "D"), 6);
  assert.equal(await readTyped(fakeClient, { code: "LSTC", number: 4 }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LCN", number: 10 }, "D"), 8);
  assert.equal(await readTyped(fakeClient, { code: "LCS", number: 10 }, "BIT"), true);
  assert.equal(await readTyped(fakeClient, { code: "LCC", number: 10 }, "BIT"), true);
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

test("readNamed resolves long counter current and state bits through supported routes", async () => {
  const calls = [];
  const fakeClient = {
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

  const snapshot = await readNamed(fakeClient, ["LCN0:D", "LCC0:BIT", "LCS0:BIT", "LCN1:D"]);
  assert.deepEqual(snapshot, {
    "LCN0:D": 0x00010002,
    "LCC0:BIT": true,
    "LCS0:BIT": true,
    "LCN1:D": 4,
  });
  assert.deepEqual(calls, [
    { kind: "readRandom", dwordDevices: ["LCN0", "LCN1"] },
    { kind: "readDevices", device: "LCC0", points: 1, bitUnit: true },
    { kind: "readDevices", device: "LCS0", points: 1, bitUnit: true },
  ]);
});

test("readNamed forwards per-request target overrides to client calls", async () => {
  const calls = [];
  const target = { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 };
  const fakeClient = {
    async readRandom(options) {
      calls.push({
        kind: "readRandom",
        target: options.target,
      });
      return {
        word: { D100: 42 },
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
      if (device.code === "M") {
        return [true];
      }
      throw new Error("unexpected block read");
    },
  };

  const snapshot = await readNamed(fakeClient, ["D100:U", "D200:F", "M1000:BIT"], { target });
  assert.equal(snapshot["D100:U"], 42);
  assert.equal(snapshot["D200:F"], 1.5);
  assert.equal(snapshot["M1000:BIT"], true);
  assert.deepEqual(calls, [
    { kind: "readRandom", target },
    { kind: "readDevices", device: "M1000", points: 1, bitUnit: true, target },
  ]);
});

test("writeNamed coalesces contiguous direct bits and same-word bit updates", async () => {
  const reads = [];
  const writes = [];
  const fakeClient = {
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

  await writeNamed(fakeClient, {
    "D50.3": true,
    "D50.4": true,
    "M1000:BIT": true,
    "M1001:BIT": false,
    "M1002:BIT": true,
  });

  assert.deepEqual(reads, [{ device: "D50", points: 1, bitUnit: false }]);
  assert.deepEqual(writes, [
    { device: "M1000", values: [true, false, true], bitUnit: true },
    { device: "D50", values: [0x0018], bitUnit: false },
  ]);
});

test("writeNamed supports count arrays and string writes", async () => {
  const writes = [];
  const fakeClient = {
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

  await writeNamed(fakeClient, {
    "M1000:BIT,3": [true, false, true],
    "D100:U,3": [11, 12, 13],
    "D200:F,2": [1.5, -2.25],
    "D300:STR,5": "HELLO",
    "DSTR400,4": "ABCD",
  });

  const floatWords = [];
  for (const value of [1.5, -2.25]) {
    const raw = Buffer.alloc(4);
    raw.writeFloatLE(value, 0);
    floatWords.push(raw.readUInt16LE(0), raw.readUInt16LE(2));
  }

  assert.deepEqual(writes, [
    { device: "M1000", values: [true, false, true], bitUnit: true },
    { device: "D100", values: [11, 12, 13], bitUnit: false },
    { device: "D200", values: floatWords, bitUnit: false },
    { device: "D300", values: [0x4548, 0x4c4c, 0x004f], bitUnit: false },
    { device: "D400", values: [0x4241, 0x4443], bitUnit: false },
  ]);
});

test("writeNamed routes long current values and long state bits through random writes", async () => {
  const writes = [];
  const fakeClient = {
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

  await writeNamed(fakeClient, {
    "LTN0:D,2": [1, 2],
    "LSTN4:L": -5,
    "LTC0:BIT": true,
    "LSTS4:BIT": true,
    "LCC10:BIT": true,
    "LCS10:BIT": false,
    "LZ0:D": 123456,
    "LZ1:D": 789,
  });

  assert.deepEqual(writes, [
    {
      kind: "writeRandomWords",
      wordValues: [],
      dwordValues: [
        ["LTN0", 1],
        ["LTN1", 2],
        ["LSTN4", 0xfffffffb],
        ["LZ0", 123456],
        ["LZ1", 789],
      ],
    },
    {
      kind: "writeRandomBits",
      bitValues: [
        ["LTC0", true],
        ["LSTS4", true],
        ["LCC10", true],
        ["LCS10", false],
      ],
    },
  ]);
});

test("writeTyped routes long current and state devices through random writes", async () => {
  const writes = [];
  const fakeClient = {
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

  await writeTyped(fakeClient, { code: "LCN", number: 10 }, "D", 123);
  await writeTyped(fakeClient, { code: "LCS", number: 10 }, "BIT", true);

  assert.deepEqual(writes, [
    { kind: "writeRandomWords", dwordValues: [["LCN10", 123]] },
    { kind: "writeRandomBits", bitValues: [["LCS10", true]] },
  ]);
});

test("writeNamed forwards per-request target overrides to client calls", async () => {
  const writes = [];
  const target = { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 };
  const fakeClient = {
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
      "D50.3": true,
      "M1000:BIT": true,
      "D200:F": 1.5,
    },
    { target }
  );

  assert.deepEqual(writes, [
    { kind: "writeRandomWords", wordValues: [["D100", 42]], dwordValues: [["D200", 1069547520]], target },
    { kind: "writeDevices", device: "M1000", values: [true], bitUnit: true, target },
    { kind: "readDevices", device: "D50", points: 1, bitUnit: false, target },
    { kind: "writeDevices", device: "D50", values: [8], bitUnit: false, target },
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
      credentials: {
        remotePassword: "secret1",
      },
    });

    assert.equal(constructorOptions.length, 1);
    assert.equal(constructorOptions[0].host, "192.168.0.10");
    assert.equal(constructorOptions[0].port, 5001);
    assert.equal(constructorOptions[0].transport, "udp");
    assert.equal(constructorOptions[0].timeout, 4500);
    assert.equal(constructorOptions[0].plcProfile, "melsec:iq-r");
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

test("slmp-connection defaults missing port but rejects blank port", async () => {
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
      id: "conn-missing-port",
      host: "192.168.0.10",
      plcProfile: "melsec:iq-r",
    });

    assert.equal(constructorOptions[0].port, 1025);
    assert.throws(
      () =>
        create("slmp-connection", {
          id: "conn-blank-port",
          host: "192.168.0.10",
          port: "",
          plcProfile: "melsec:iq-r",
        }),
      /slmp-connection port is required/
    );
  });
});

test("slmp-read prefers msg.addresses and can return a single value", async () => {
  const calls = [];
  const fakeClient = { kind: "client" };

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
      addresses: ["M1000:BIT"],
      connection: {
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      },
      target: undefined,
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
      getProfile: () => ({}),
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
      getProfile: () => ({ host: "127.0.0.1", port: 5000, transport: "tcp", frameType: "4e", plcSeries: "ql" }),
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

test("slmp-read minimal metadata keeps only target and item count", async () => {
  await withMockedSlmp({
    readNamed: async () => ({ "D100:U": 42, "D200:U": 7 }),
  }, async () => {
    const { RED, create, setNode } = createMockRed();
    require("../nodes/slmp-read")(RED);

    setNode("cfg-read-minimal", {
      getClient: () => ({}),
      getProfile: () => ({
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
      target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
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
      getProfile: () => ({ target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 } }),
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
      getProfile: () => ({}),
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
      getProfile: () => ({}),
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
      getProfile: () => ({}),
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

test("slmp-read can opt in to skip unsupported device errors", async () => {
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
    assert.equal(result.sent[0][1].slmpSkippedUnsupported, true);
    assert.equal(result.sent[0][1].slmp.skipStatus, "UNSUPPORTED_DEVICE");
    assert.equal(result.sent[0][1].error.code, "SLMP_UNSUPPORTED_DEVICE");
    assert.deepEqual(node.statusCalls.at(-1), { fill: "yellow", shape: "ring", text: "skipped unsupported device" });
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
      getProfile: () => ({}),
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
  const fakeClient = { kind: "client" };

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

    const msg = { address: "D200", dtype: "f", value: 3.5 };
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
      dtype: "f",
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
      getProfile: () => ({ host: "127.0.0.1", port: 5000, transport: "tcp", frameType: "4e", plcSeries: "ql" }),
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
      target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 },
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
      getProfile: () => ({ target: { network: 0, station: 255, moduleIO: 0x03ff, multidrop: 0 } }),
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
      getProfile: () => ({}),
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

test("slmp-write can opt in to skip unsupported device errors", async () => {
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
    assert.equal(result.sent[0][1].slmpSkippedUnsupported, true);
    assert.equal(result.sent[0][1].slmp.skipStatus, "UNSUPPORTED_DEVICE");
    assert.equal(result.sent[0][1].error.code, "SLMP_UNSUPPORTED_DEVICE");
    assert.deepEqual(node.statusCalls.at(-1), { fill: "yellow", shape: "ring", text: "skipped unsupported device" });
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
      getProfile: () => ({}),
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
        node.send = (message) => node.sendCalls.push(message);
        node.status = (status) => node.statusCalls.push(status);
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
    create(name, config) {
      const Constructor = registeredTypes.get(name);
      assert.ok(Constructor, `Node type ${name} is not registered`);
      return new Constructor(config);
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
