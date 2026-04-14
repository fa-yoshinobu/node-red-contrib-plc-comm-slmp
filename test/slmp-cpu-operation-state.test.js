"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const slmp = require("../lib/slmp");

test("readCpuOperationState masks upper bits of SD203", async () => {
  const calls = [];

  class FakeClient extends slmp.SlmpClient {
    constructor() {
      super({ host: "127.0.0.1" });
    }

    async readDevices(device, points, options) {
      calls.push({
        device: typeof device === "string" ? device : `${device.code}${device.number}`,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      return [0x00a2];
    }
  }

  const client = new FakeClient();
  const state = await client.readCpuOperationState();

  assert.deepEqual(calls, [{ device: "SD203", points: 1, bitUnit: false }]);
  assert.equal(state.status, slmp.SlmpCpuOperationStatus.Stop);
  assert.equal(state.rawStatusWord, 0x00a2);
  assert.equal(state.rawCode, 0x02);
});

test("decodeCpuOperationState returns unknown for unhandled code", () => {
  const state = slmp.decodeCpuOperationState(0x00f5);

  assert.equal(state.status, slmp.SlmpCpuOperationStatus.Unknown);
  assert.equal(state.rawStatusWord, 0x00f5);
  assert.equal(state.rawCode, 0x05);
});
