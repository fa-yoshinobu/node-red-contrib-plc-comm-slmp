"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const slmp = require("../lib/slmp");

function buildWords(start, count, values) {
  return Array.from({ length: count }, (_, index) => Number(values[start + index] || 0) & 0xffff);
}

test("readDeviceRangeCatalogForFamily reads one IQ-F SD block and formats X/Y in octal", async () => {
  const calls = [];

  class FakeClient extends slmp.SlmpClient {
    constructor() {
      super({ host: "127.0.0.1", _allowManualProfile: true });
    }

    async readDevices(device, points, options) {
      const text = typeof device === "string" ? device : `${device.code}${device.number}`;
      if (text.startsWith("ZR") || (calls.length > 0 && points === 1)) {
        throw new slmp.SlmpError("rejected by test");
      }
      calls.push({
        device: text,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      return buildWords(260, 46, {
        260: 1024,
        262: 1024,
        264: 7680,
        266: 256,
        268: 512,
        270: 128,
        274: 7680,
        280: 8000,
        282: 512,
        284: 512,
        288: 512,
        290: 16,
        292: 256,
        298: 64,
        300: 20,
        302: 2,
        304: 0x8000,
        305: 0x0000,
      });
    }
  }

  const client = new FakeClient();
  const catalog = await client.readDeviceRangeCatalogForFamily("iq-f");

  assert.equal(catalog.family, slmp.SlmpDeviceRangeFamily.IqF);
  assert.equal(catalog.model, "IQ-F");
  assert.deepEqual(calls, [{ device: "SD260", points: 46, bitUnit: false }]);

  const entries = Object.fromEntries(catalog.entries.map((entry) => [entry.device, entry]));
  assert.equal(entries.X.pointCount, 1024);
  assert.equal(entries.X.addressRange, "X0000-X1777");
  assert.equal(entries.X.notation, slmp.SlmpDeviceRangeNotation.Base8);
  assert.equal(entries.Y.addressRange, "Y0000-Y1777");
  assert.equal(entries.R.pointCount, 32768);
  assert.equal(entries.R.addressRange, "R0-R32767");
  assert.equal(entries.V.supported, false);
  assert.equal(entries.V.pointCount, null);
  assert.equal(entries.LCS.pointCount, 64);
  assert.equal(entries.LCS.addressRange, "LCS0-LCS63");
});

test("readDeviceRangeCatalogForFamily uses SD300 for QnU ST family and fixed Z range", async () => {
  const calls = [];
  const fakeClient = {
    async readDevices(device, points, options) {
      const text = typeof device === "string" ? device : `${device.code}${device.number}`;
      if (text.startsWith("ZR") || (calls.length > 0 && points === 1)) {
        throw new slmp.SlmpError("rejected by test");
      }
      calls.push({
        device: text,
        points,
        bitUnit: Boolean(options.bitUnit),
      });
      return buildWords(286, 26, {
        286: 8192,
        288: 8192,
        290: 8192,
        291: 8192,
        293: 8192,
        295: 2048,
        296: 2048,
        297: 2048,
        298: 8192,
        299: 2048,
        300: 16,
        301: 1024,
        304: 2048,
        305: 65535,
        308: 12288,
        310: 8192,
      });
    },
  };

  const catalog = await slmp.readDeviceRangeCatalogForFamily(fakeClient, slmp.SlmpDeviceRangeFamily.QnU);

  assert.deepEqual(calls, [{ device: "SD286", points: 26, bitUnit: false }]);
  const entries = Object.fromEntries(catalog.entries.map((entry) => [entry.device, entry]));
  assert.equal(entries.STS.pointCount, 16);
  assert.equal(entries.STS.addressRange, "STS0-STS15");
  assert.equal(entries.STC.pointCount, 16);
  assert.equal(entries.STN.pointCount, 16);
  assert.equal(entries.CS.pointCount, 1024);
  assert.equal(entries.CS.addressRange, "CS0-CS1023");
  assert.equal(entries.Z.pointCount, 20);
  assert.equal(entries.Z.addressRange, "Z0-Z19");
  assert.equal(entries.R.pointCount, 0);
  assert.equal(entries.R.addressRange, null);
});

test("device-range helpers only accept canonical family names", async () => {
  await assert.rejects(
    () => slmp.readDeviceRangeCatalogForFamily({ readDevices: async () => [] }, "iqr"),
    /Unsupported PLC family: iqr/
  );
});
