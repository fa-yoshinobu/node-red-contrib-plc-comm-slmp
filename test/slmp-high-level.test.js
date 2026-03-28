"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const slmp = require("../lib/slmp");
const { normalizeAddressList, parseAddress, readNamed, readTyped, writeNamed } = slmp;

test("parseAddress supports count and string forms", () => {
  assert.deepEqual(parseAddress("D100,10"), {
    base: "D100",
    dtype: "U",
    bitIndex: null,
    count: 10,
    hasCount: true,
  });
  assert.deepEqual(parseAddress("D100:STR,10"), {
    base: "D100",
    dtype: "STR",
    bitIndex: null,
    count: 10,
    hasCount: true,
  });
  assert.deepEqual(parseAddress("DSTR200,8"), {
    base: "D200",
    dtype: "STR",
    bitIndex: null,
    count: 8,
    hasCount: true,
  });
});

test("normalizeAddressList keeps count suffixes in comma-separated input", () => {
  assert.deepEqual(normalizeAddressList("D100,10,D200:F,M1000"), ["D100,10", "D200:F", "M1000"]);
  assert.deepEqual(normalizeAddressList("D100:STR,10 D200,2"), ["D100:STR,10", "D200,2"]);
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

  const snapshot = await readNamed(fakeClient, ["D100", "D200:F", "D50.3", "M1000"]);
  assert.equal(snapshot.D100, 42);
  assert.equal(snapshot["D200:F"].toFixed(3), "3.142");
  assert.equal(snapshot["D50.3"], true);
  assert.equal(snapshot.M1000, true);
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
    D100: 42,
    "D50.3": true,
    M1000: true,
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

  const snapshot = await readNamed(fakeClient, ["M1000", "M1001", "M1002", "D100", "D101", "D102"]);
  assert.deepEqual(snapshot, {
    M1000: true,
    M1001: false,
    M1002: true,
    D100: 11,
    D101: 12,
    D102: 13,
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

  const snapshot = await readNamed(fakeClient, ["M1000,3", "D100,3", "D200:F,2", "D300:STR,5", "DSTR400,4"]);
  assert.deepEqual(snapshot, {
    "M1000,3": [true, false, true],
    "D100,3": [11, 12, 13],
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

  const snapshot = await readNamed(fakeClient, ["LTN0", "LTC0", "LTS0", "LTN1", "LSTN4", "LSTC4", "LSTS4,2"]);
  assert.deepEqual(snapshot, {
    LTN0: 0x00010002,
    LTC0: true,
    LTS0: true,
    LTN1: 4,
    LSTN4: 6,
    LSTC4: true,
    "LSTS4,2": [false, true],
  });
  assert.deepEqual(calls, [
    { device: "LTN0", points: 8, bitUnit: false },
    { device: "LSTN4", points: 8, bitUnit: false },
  ]);
});

test("readTyped resolves LT, LST, and LC families through helper-backed 4-word blocks", async () => {
  const calls = [];
  const fakeClient = {
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
      if (device.code === "LCN" && device.number === 10) {
        return [0x0008, 0x0000, 0x0003, 0x0000];
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
    { device: "LCN10", points: 4, bitUnit: false },
    { device: "LCN10", points: 4, bitUnit: false },
    { device: "LCN10", points: 4, bitUnit: false },
  ]);
});

test("readNamed resolves LC families through helper-backed 4-word blocks", async () => {
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
      if (device.code === "LCN" && device.number === 0) {
        return [0x0002, 0x0001, 0x0003, 0x0000, 0x0004, 0x0000, 0x0002, 0x0000];
      }
      throw new Error(`unexpected long counter read ${device.code}${device.number}`);
    },
  };

  const snapshot = await readNamed(fakeClient, ["LCN0", "LCC0", "LCS0", "LCN1"]);
  assert.deepEqual(snapshot, {
    LCN0: 0x00010002,
    LCC0: true,
    LCS0: true,
    LCN1: 4,
  });
  assert.deepEqual(calls, [{ device: "LCN0", points: 8, bitUnit: false }]);
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

  const snapshot = await readNamed(fakeClient, ["D100", "D200:F", "M1000"], { target });
  assert.equal(snapshot.D100, 42);
  assert.equal(snapshot["D200:F"], 1.5);
  assert.equal(snapshot.M1000, true);
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
    M1000: true,
    M1001: false,
    M1002: true,
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
    "M1000,3": [true, false, true],
    "D100,3": [11, 12, 13],
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

test("writeNamed routes long current values through per-point dword writes", async () => {
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
  };

  await writeNamed(fakeClient, {
    "LTN0,2": [1, 2],
    "LSTN4:L": -5,
    LTC0: true,
  });

  assert.deepEqual(writes, [
    {
      kind: "writeRandomWords",
      wordValues: [],
      dwordValues: [
        ["LTN0", 1],
        ["LTN1", 2],
        ["LSTN4", 0xfffffffb],
      ],
    },
    { kind: "writeDevices", device: "LTC0", values: [true], bitUnit: true },
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
      D100: 42,
      "D50.3": true,
      M1000: true,
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
      this.frameType = options.frameType;
      this.plcSeries = options.plcSeries;
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
      plcSeries: "iqr",
      frameType: "3e",
      monitoringTimer: "32",
      network: "1",
      station: "255",
      moduleIO: "03FF",
      multidrop: "2",
    });

    assert.equal(constructorOptions.length, 1);
    assert.equal(constructorOptions[0].host, "192.168.0.10");
    assert.equal(constructorOptions[0].port, 5001);
    assert.equal(constructorOptions[0].transport, "udp");
    assert.equal(constructorOptions[0].timeout, 4500);
    assert.ok(node.getClient() instanceof FakeSlmpClient);
    assert.deepEqual(node.getProfile(), {
      host: "192.168.0.10",
      port: 5001,
      transport: "udp",
      frameType: "3e",
      plcSeries: "iqr",
      target: {
        network: 1,
        station: 255,
        moduleIO: 0x03ff,
        multidrop: 2,
      },
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

test("slmp-read prefers msg.addresses and can return a single value", async () => {
  const calls = [];
  const fakeClient = { kind: "client" };

  await withMockedSlmp({
    readNamed: async (client, addresses) => {
      calls.push({ client, addresses });
      return { M1000: true };
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
      addresses: "D100",
      outputMode: "value",
    });

    const msg = { addresses: ["M1000"] };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(msg.payload, true);
    assert.deepEqual(msg.slmp, {
      addresses: ["M1000"],
      connection: {
        host: "127.0.0.1",
        port: 5000,
        transport: "tcp",
        frameType: "4e",
        plcSeries: "ql",
      },
      target: undefined,
    });
    assert.deepEqual(calls, [{ client: fakeClient, addresses: ["M1000"] }]);
    assert.deepEqual(node.statusCalls[0], { fill: "blue", shape: "dot", text: "reading" });
    assert.deepEqual(node.statusCalls.at(-1), { fill: "green", shape: "dot", text: "1 item(s)" });
  });
});

test("slmp-read can return an array payload in address order", async () => {
  await withMockedSlmp({
    readNamed: async () => ({
      "D100,3": [1, 2, 3],
      "D200:F": 1.5,
      M1000: true,
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
      addresses: "D100,3\nD200:F\nM1000",
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
      return { "D100,3": [1, 2, 3] };
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

    const msg = { source: { addresses: ["D100,3"] } };
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.deepEqual(calls, [["D100,3"]]);
    assert.deepEqual(msg.payload, { "D100,3": [1, 2, 3] });
  });
});

test("slmp-read forwards msg.target to readNamed and records the effective route", async () => {
  const calls = [];

  await withMockedSlmp({
    readNamed: async (_client, addresses, options) => {
      calls.push({ addresses, target: options.target });
      return { D100: 42 };
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
      addresses: "D100",
    });

    const result = await invokeNode(node, {
      target: { network: 2, station: 3, moduleIO: "03FF", multidrop: 1 },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(calls, [
      {
        addresses: ["D100"],
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
    readNamed: async () => ({ D100: 42, D200: 7 }),
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
      addresses: "D100\nD200",
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
    readNamed: async () => ({ D100: 42 }),
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
      addresses: "D100",
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
      addresses: "D100",
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
      addresses: "D100",
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
      addresses: "D100",
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

    const result = await invokeNode(node, { source: { updates: { "D100,3": [1, 2, 3] } } });

    assert.equal(result.error, undefined);
    assert.deepEqual(calls, [{ "D100,3": [1, 2, 3] }]);
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
      updates: "{\"D100\":42}",
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
        updates: { D100: 42 },
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
      updates: "{\"D100\":42,\"M1000\":true}",
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
      updates: "{\"D100\":42}",
      metadataMode: "off",
    });

    const msg = {};
    const result = await invokeNode(node, msg);

    assert.equal(result.error, undefined);
    assert.equal(msg.slmp, undefined);
  });
});

test("slmp-write parses configured update lines when msg does not override them", async () => {
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

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(calls, [{ D100: 42, M1000: true }]);
    assert.deepEqual(result.sent[0].slmp.updates, { D100: 42, M1000: true });
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
      updates: "D100=42",
      errorHandling: "output2",
    });

    const result = await invokeNode(node, {});

    assert.equal(result.error, undefined);
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], null);
    assert.equal(result.sent[0][1].error.message, "write failed");
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
      updates: "D100=42",
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
