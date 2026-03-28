"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SlmpClient,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeRequest,
  packBitValues,
  parseDevice,
  unpackBitValues,
} = require("../lib/slmp");

test("parseDevice handles decimal and hex devices", () => {
  assert.deepEqual(parseDevice("D100"), { code: "D", number: 100 });
  assert.deepEqual(parseDevice("X1F"), { code: "X", number: 31 });
  assert.equal(deviceToString({ code: "X", number: 31 }), "X1F");
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
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e" });
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
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e" });
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
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", allowConcurrentRequests: true });
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
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e" });
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
