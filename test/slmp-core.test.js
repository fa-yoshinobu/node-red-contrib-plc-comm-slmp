"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Command,
  SlmpClient,
  ValueError,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeRequest,
  packBitValues,
  parseDevice,
  resolveConnectionProfile,
  unpackBitValues,
} = require("../lib/slmp");

test("parseDevice handles decimal and hex devices", () => {
  assert.deepEqual(parseDevice("D100"), { code: "D", number: 100 });
  assert.deepEqual(parseDevice("X1F"), { code: "X", number: 31 });
  assert.equal(deviceToString({ code: "X", number: 31 }), "X1F");
});

test("parseDevice uses octal X/Y numbering for iq-f when plcFamily is explicit", () => {
  assert.deepEqual(parseDevice("X217", { plcFamily: "iq-f" }), { code: "X", number: 0x8f });
  assert.equal(deviceToString({ code: "Y", number: 0x90 }, { plcFamily: "iq-f" }), "Y220");
});

test("resolveConnectionProfile derives fixed defaults from plcFamily", () => {
  const profile = resolveConnectionProfile({ plcFamily: "iq-l" });
  assert.deepEqual(profile, {
    plcFamily: "iq-l",
    plcSeries: "iqr",
    frameType: "4e",
    deviceFamily: "iq-r",
    rangeFamily: "iq-r",
  });
  assert.throws(
    () => resolveConnectionProfile({ plcFamily: "iq-r", plcSeries: "ql" }),
    /already determines frameType, plcSeries/
  );
});

test("resolveConnectionProfile rejects missing plcFamily on the standard route", () => {
  assert.throws(
    () => resolveConnectionProfile({ frameType: "4e", plcSeries: "iqr" }),
    /plcFamily is required for the standard client profile/
  );
});

test("encodeDeviceSpec follows QL and iQR layouts", () => {
  assert.deepEqual([...encodeDeviceSpec("D100", { series: "ql" })], [100, 0, 0, 0xa8]);
  assert.deepEqual([...encodeDeviceSpec("D100", { series: "iqr" })], [100, 0, 0, 0, 0xa8, 0x00]);
});

test("packBitValues and unpackBitValues round-trip", () => {
  const packed = packBitValues([true, false, true, true, false]);
  assert.deepEqual([...packed], [0x10, 0x11, 0x00]);
  assert.deepEqual(unpackBitValues(packed, 5), [true, false, true, true, false]);
});

test("encodeRequest and decodeResponse work for 4E frames", () => {
  const request = encodeRequest({
    frameType: "4e",
    serial: 0x1234,
    target: { network: 0, station: 0xff, moduleIO: 0x03ff, multidrop: 0 },
    monitoringTimer: 0x0010,
    command: 0x0401,
    subcommand: 0x0002,
    data: Buffer.from([0xaa, 0xbb]),
  });
  assert.equal(request.subarray(0, 2).toString("hex"), "5400");

  const response = Buffer.from([
    0xd4, 0x00,
    0x34, 0x12,
    0x00, 0x00,
    0x00,
    0xff,
    0xff, 0x03,
    0x00,
    0x04, 0x00,
    0x00, 0x00,
    0x78, 0x56,
  ]);
  const decoded = decodeResponse(response, { frameType: "4e" });
  assert.equal(decoded.serial, 0x1234);
  assert.equal(decoded.endCode, 0);
  assert.deepEqual([...decoded.data], [0x78, 0x56]);
});

test("3E client keeps requests serialized", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  let active = 0;
  let maxActive = 0;

  client._requestInternal = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true };
  };

  await Promise.all([client.request(0x0401), client.request(0x0401), client.request(0x0401)]);
  assert.equal(maxActive, 1);
});

test("4E client keeps requests serialized by default for single-connection compatibility", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", _allowManualProfile: true });
  let active = 0;
  let maxActive = 0;

  client._requestInternal = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true };
  };

  await Promise.all([client.request(0x0401), client.request(0x0401), client.request(0x0401)]);
  assert.equal(maxActive, 1);
});

test("4E client can opt into concurrent requests", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", allowConcurrentRequests: true, _allowManualProfile: true });
  let active = 0;
  let maxActive = 0;

  client._requestInternal = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true };
  };

  await Promise.all([client.request(0x0401), client.request(0x0401), client.request(0x0401)]);
  assert.equal(maxActive, 3);
});

test("4E TCP response matching uses serial instead of FIFO order", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", _allowManualProfile: true });
  const first = client._awaitTcpFrame(0x1001);
  const second = client._awaitTcpFrame(0x1002);

  client._handleTcpData(
    Buffer.concat([
      make4EResponse(0x1002, [0x22, 0x22]),
      make4EResponse(0x1001, [0x11, 0x11]),
    ])
  );

  const [firstFrame, secondFrame] = await Promise.all([first, second]);
  const firstDecoded = decodeResponse(firstFrame, { frameType: "4e" });
  const secondDecoded = decodeResponse(secondFrame, { frameType: "4e" });

  assert.equal(firstDecoded.serial, 0x1001);
  assert.deepEqual([...firstDecoded.data], [0x11, 0x11]);
  assert.equal(secondDecoded.serial, 0x1002);
  assert.deepEqual([...secondDecoded.data], [0x22, 0x22]);
});

test("writeRandomBits uses 1402 bit subcommand and iQR two-byte states", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  const calls = [];
  client.request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.writeRandomBits({ bitValues: { LTC10: true, LTS10: false } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 0x1402);
  assert.equal(calls[0].subcommand, 0x0003);
  assert.deepEqual(
    [...calls[0].data],
    [
      0x02,
      0x0a, 0x00, 0x00, 0x00, 0x50, 0x00, 0x01, 0x00,
      0x0a, 0x00, 0x00, 0x00, 0x51, 0x00, 0x00, 0x00,
    ]
  );
});

test("readDevices rejects direct long timer state reads before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readDevices("LTC10", 1, { bitUnit: true }),
    (error) => error instanceof ValueError && /Direct bit read is not supported for LTC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("writeDevices rejects direct long-family state writes before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeDevices("LCC10", [true], { bitUnit: true }),
    (error) => error instanceof ValueError && /Direct bit write is not supported for LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("readDevices rejects non-4-word long timer current reads before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readDevices("LTN10", 2, { bitUnit: false }),
    (error) => error instanceof ValueError && /requires 4-word blocks/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("readDevices rejects direct LCN word reads before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readDevices("LCN10", 4, { bitUnit: false }),
    (error) => error instanceof ValueError && /Direct word read is not supported for LCN/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("writeDevices rejects direct word writes to 32-bit long-family devices before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeDevices("LCN10", [1], { bitUnit: false }),
    (error) => error instanceof ValueError && /Direct word write is not supported for LCN/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("readRandom rejects LCS/LCC before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readRandom({ wordDevices: ["LCS10"] }),
    (error) => error instanceof ValueError && /Read Random \(0x0403\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("readRandom rejects long current word entries before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readRandom({ wordDevices: ["LCN10"] }),
    (error) => error instanceof ValueError && /does not support LTN\/LSTN\/LCN\/LZ as word entries/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("readBlock rejects LCS/LCC before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readBlock({ bitBlocks: [["LCS10", 1]] }),
    (error) => error instanceof ValueError && /Read Block \(0x0406\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("readBlock rejects LCN and LZ block routes before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readBlock({ wordBlocks: [["LCN10", 4]] }),
    (error) => error instanceof ValueError && /does not support LCN\/LZ/.test(error.message)
  );
  await assert.rejects(
    () => client.readBlock({ wordBlocks: [["LZ0", 2]] }),
    (error) => error instanceof ValueError && /does not support LCN\/LZ/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("writeBlock rejects LCS/LCC before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeBlock({ bitBlocks: [["LCC10", [1]]] }),
    (error) => error instanceof ValueError && /Write Block \(0x1406\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("writeBlock rejects long current and LZ block routes before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeBlock({ wordBlocks: [["LCN10", [1, 0]]] }),
    (error) => error instanceof ValueError && /does not support LTN\/LSTN\/LCN\/LZ/.test(error.message)
  );
  await assert.rejects(
    () => client.writeBlock({ wordBlocks: [["LZ0", [1, 0]]] }),
    (error) => error instanceof ValueError && /does not support LTN\/LSTN\/LCN\/LZ/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("request rejects monitor register payloads with LCS/LCC before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._requestInternal = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };
  const payload = Buffer.concat([Buffer.from([0x01, 0x00]), encodeDeviceSpec("LCS10", { series: "iqr" })]);

  assert.throws(
    () => client.request(Command.MONITOR_REGISTER, 0x0002, payload),
    (error) => error instanceof ValueError && /Entry Monitor Device \(0x0801\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

function make4EResponse(serial, data) {
  const payload = Buffer.from(data);
  const buffer = Buffer.alloc(15 + payload.length);
  buffer.writeUInt16LE(0x00d4, 0);
  buffer.writeUInt16LE(serial, 2);
  buffer.writeUInt16LE(0x0000, 4);
  buffer.writeUInt8(0x00, 6);
  buffer.writeUInt8(0xff, 7);
  buffer.writeUInt16LE(0x03ff, 8);
  buffer.writeUInt8(0x00, 10);
  buffer.writeUInt16LE(2 + payload.length, 11);
  buffer.writeUInt16LE(0x0000, 13);
  payload.copy(buffer, 15);
  return buffer;
}
