"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const slmp = require("../lib/slmp");

const SHARED_SPEC_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "plc-comm-slmp-cross-verify",
  "specs",
  "shared"
);

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(SHARED_SPEC_DIR, name), "utf8"));
}

function build4EResponse(requestFrame, responseData, endCode = 0) {
  const request = Buffer.from(requestFrame);
  const data = Buffer.from(responseData || Buffer.alloc(0));
  const payload = Buffer.concat([Buffer.from([endCode & 0xff, (endCode >> 8) & 0xff]), data]);
  return Buffer.concat([
    Buffer.from([0xd4, 0x00]),
    request.subarray(2, 4),
    Buffer.from([0x00, 0x00]),
    request.subarray(6, 11),
    Buffer.from([payload.length & 0xff, (payload.length >> 8) & 0xff]),
    payload,
  ]);
}

class CaptureClient extends slmp.SlmpClient {
  constructor(responseData) {
    super({
      host: "127.0.0.1",
      plcFamily: "iq-r",
      monitoringTimer: 0x0010,
      raiseOnError: true,
    });
    this.capturedFrame = null;
    this.responseData = Buffer.from(responseData || Buffer.alloc(0));
  }

  async connect() {}

  async _sendAndReceive(frame) {
    this.capturedFrame = Buffer.from(frame);
    return build4EResponse(frame, this.responseData);
  }
}

test("shared address normalization vectors match Node high-level helpers", () => {
  const data = loadJson("high_level_address_normalize_vectors.json");
  for (const entry of data.cases) {
    if (!entry.implementations.includes("node")) {
      continue;
    }
    const options = requiresExplicitPlcFamily(entry.input) ? { plcFamily: "iq-r" } : undefined;
    assert.equal(options ? slmp.normalizeAddress(entry.input, options) : slmp.normalizeAddress(entry.input), entry.expected, entry.id);
  }
});

test("shared address parse vectors match Node high-level parser", () => {
  const data = loadJson("high_level_address_parse_vectors.json");
  for (const entry of data.cases) {
    if (!entry.implementations.includes("node")) {
      continue;
    }
    const parsed = slmp.parseAddress(entry.input);
    assert.deepEqual(
      {
        base: parsed.base,
        dtype: parsed.dtype,
        bit_index: parsed.bitIndex,
      },
      entry.expected,
      entry.id
    );
  }
});

test("shared device vectors match Node low-level encoder", () => {
  const data = loadJson("device_spec_vectors.json");
  for (const entry of data.vectors) {
    if (!entry.implementations.includes("node")) {
      continue;
    }
    const series = entry.series === "iqr" ? slmp.PLCSeries.IQR : slmp.PLCSeries.QL;
    const encoded = slmp.encodeDeviceSpec(entry.device, { series });
    assert.equal(encoded.toString("hex").toUpperCase(), entry.hex, entry.id);
  }
});

test("shared frame vectors match Node client requests", async () => {
  const data = loadJson("frame_golden_vectors.json");
  for (const entry of data.cases) {
    if (!entry.implementations.includes("node")) {
      continue;
    }
    const client = new CaptureClient(Buffer.from(entry.response_data_hex || "", "hex"));
    await dispatchFrameCase(client, entry);
    assert.ok(client.capturedFrame, `${entry.id}: frame was not captured`);
    assert.equal(client.capturedFrame.toString("hex").toUpperCase(), entry.request_hex, entry.id);
  }
});

async function dispatchFrameCase(client, entry) {
  const args = entry.args || {};
  switch (entry.operation) {
    case "read_type_name": {
      const info = await client.readTypeName();
      assert.equal(info.model, "Q03UDVCPU");
      return;
    }
    case "read_words": {
      const values = await client.readDevices(args.device, args.points);
      assert.deepEqual(values, [0x1234, 0x5678]);
      return;
    }
    case "write_bits":
      await client.writeDevices(args.device, args.values, { bitUnit: true });
      return;
    case "read_random": {
      const result = await client.readRandom({
        wordDevices: args.word_devices,
        dwordDevices: args.dword_devices,
      });
      assert.equal(result.word.D100, 0x1111);
      assert.equal(result.word.D101, 0x2222);
      assert.equal(result.dword.D200, 0x12345678);
      return;
    }
    case "write_random_bits":
      await client.writeRandomBits({
        bitValues: Object.fromEntries(args.bit_values.map((item) => [item.device, item.value])),
      });
      return;
    case "read_block": {
      const result = await client.readBlock({
        wordBlocks: args.word_blocks,
        bitBlocks: args.bit_blocks,
      });
      assert.deepEqual(result.wordValues, [0x1234, 0x5678]);
      assert.deepEqual(result.bitWordValues, [0x0005]);
      return;
    }
    case "remote_password_unlock":
      await client.remotePasswordUnlock(args.password);
      return;
    default:
      throw new Error(`Unsupported shared frame operation for Node: ${entry.operation}`);
  }
}

function requiresExplicitPlcFamily(address) {
  return /^[\s]*[XY]/i.test(String(address || ""));
}
