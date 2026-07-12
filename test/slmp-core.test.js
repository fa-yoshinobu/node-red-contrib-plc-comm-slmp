"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { SlmpTransport } = require("../lib/slmp/transport");

const slmpApi = require("../lib/slmp");
const {
  Command,
  ModuleIONo,
  RemoteClearMode,
  getEndCodeName,
  isRemotePasswordEndCode,
  SlmpError,
  SlmpExtendedDevice,
  SlmpIndexLz,
  SlmpIndexZ,
  SlmpIndirect,
  SlmpClient: StrictSlmpClient,
  ValueError,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeRequest,
  extractFrameFromBuffer,
  isDeviceCodeSupportedForPlcProfile,
  normalizeMonitoringTimer,
  normalizeTransport,
  normalizeTimeout,
  normalizeTarget,
  packBitValues,
  parseDevice,
  parseSlmpErrorInfo,
  resolveConnectionProfile,
  SlmpProfileFeatureError,
  unpackBitValues,
} = slmpApi;

const TEST_TARGET = Object.freeze({ network: 0, station: 0xff, moduleIO: 0x03ff, multidrop: 0 });

function SlmpClient(options) {
  const client = new StrictSlmpClient({ port: 1025, transport: "tcp", target: TEST_TARGET, ...options });
  const rawCommand = client.rawCommand.bind(client);
  const readDevices = client.readDevices.bind(client);
  const writeDevices = client.writeDevices.bind(client);
  client.rawCommand = (command, requestOptions = {}) => rawCommand(command, { subcommand: 0, payload: Buffer.alloc(0), ...requestOptions });
  client.readDevices = (device, points, requestOptions = {}) => readDevices(device, points, { bitUnit: false, ...requestOptions });
  client.writeDevices = (device, values, requestOptions = {}) => writeDevices(device, values, { bitUnit: false, ...requestOptions });
  return client;
}

function loadDeviceRangeRulesFixture() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "slmp_device_range_rules.json"), "utf8"));
}

test("parseDevice handles decimal and hex devices", () => {
  const options = { plcProfile: "melsec:iq-r" };
  assert.deepEqual(parseDevice("D100", options), { code: "D", number: 100, plcProfile: "melsec:iq-r" });
  assert.deepEqual(parseDevice("X1F", options), { code: "X", number: 31, plcProfile: "melsec:iq-r" });
  assert.deepEqual(parseDevice("XFF", options), { code: "X", number: 0xff, plcProfile: "melsec:iq-r" });
  assert.deepEqual(parseDevice("SWFF", options), { code: "SW", number: 0xff, plcProfile: "melsec:iq-r" });
  assert.deepEqual(parseDevice("S10", options), { code: "S", number: 10, plcProfile: "melsec:iq-r" });
  assert.equal(deviceToString({ code: "X", number: 31, plcProfile: "melsec:iq-r" }, options), "X1F");
  assert.throws(() => parseDevice("D100"), /require options\.plcProfile/);
  assert.throws(() => parseDevice("DFFFF", options), /device code 'D'/);
});

test("parseDevice uses octal X/Y numbering for iq-f when plcProfile is explicit", () => {
  assert.equal(parseDevice("X10", { plcProfile: "melsec:iq-f" }).number, 8);
  assert.equal(parseDevice("X10", { plcProfile: "melsec:iq-r" }).number, 16);
  assert.equal(parseDevice("Y10", { plcProfile: "melsec:iq-f" }).number, 8);
  assert.equal(parseDevice("Y10", { plcProfile: "melsec:iq-r" }).number, 16);
  assert.deepEqual(parseDevice("X217", { plcProfile: "melsec:iq-f" }), { code: "X", number: 0x8f, plcProfile: "melsec:iq-f" });
  assert.equal(deviceToString({ code: "Y", number: 0x90, plcProfile: "melsec:iq-f" }, { plcProfile: "melsec:iq-f" }), "Y220");
  assert.throws(
    () => deviceToString({ code: "Y", number: 0x90, plcProfile: "melsec:iq-r" }, { plcProfile: "melsec:iq-f" }),
    /does not match/
  );
  assert.throws(
    () => deviceToString({ code: "Y", number: 0x90 }, { plcProfile: "melsec:iq-f" }),
    /must include plcProfile/
  );
  assert.throws(() => parseDevice("X1A", { plcProfile: "melsec:iq-f" }), /Invalid SLMP device number/);
  assert.equal(parseDevice("X1A", { plcProfile: "melsec:iq-r" }).number, 0x1a);
  for (const options of [undefined, null, {}, [], { plcProfile: "iq-r" }]) {
    assert.throws(() => parseDevice("D0", options), /require options\.plcProfile|Unsupported plcProfile/);
  }
});

test("profile-free or mismatched semantic device objects cannot bypass the client profile", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    plcProfile: "melsec:iq-f",
    target: TEST_TARGET,
  });
  let requests = 0;
  client._request = async () => {
    requests += 1;
    return { endCode: 0, data: Buffer.from([0]) };
  };

  await assert.rejects(
    () => client.readDevices({ code: "X", number: 16 }, 1, { bitUnit: true }),
    /must include plcProfile/
  );
  await assert.rejects(
    () => client.readDevices({ code: "X", number: 16, plcProfile: "melsec:iq-r" }, 1, { bitUnit: true }),
    /does not match requested plcProfile/
  );
  assert.equal(requests, 0);
});

test("parseDevice rejects device codes that are unsupported by the explicit PLC profile", () => {
  assert.deepEqual(parseDevice("LZ0", { plcProfile: "melsec:iq-f" }), { code: "LZ", number: 0, plcProfile: "melsec:iq-f" });
  assert.deepEqual(parseDevice("LTS10", { plcProfile: "melsec:iq-r" }), { code: "LTS", number: 10, plcProfile: "melsec:iq-r" });
  assert.throws(() => parseDevice("V10", { plcProfile: "melsec:iq-f" }), /not supported for plcProfile 'melsec:iq-f'/);
  assert.throws(() => parseDevice("DX10", { plcProfile: "melsec:iq-f" }), /not supported for plcProfile 'melsec:iq-f'/);
  assert.throws(() => parseDevice("DY10", { plcProfile: "melsec:iq-f" }), /not supported for plcProfile 'melsec:iq-f'/);
  assert.throws(() => parseDevice("LCS10", { plcProfile: "melsec:lcpu" }), /not supported for plcProfile 'melsec:lcpu'/);
  assert.throws(() => parseDevice("RD10", { plcProfile: "melsec:qnudv" }), /not supported for plcProfile 'melsec:qnudv'/);
  assert.throws(() => parseDevice("LZ0", { plcProfile: "melsec:qnu" }), /not supported for plcProfile 'melsec:qnu'/);
  assert.throws(
    () => parseDevice("LTN0", { plcProfile: "melsec:qcpu:qj71e71-100" }),
    /not supported for plcProfile 'melsec:qcpu:qj71e71-100'/
  );
  assert.throws(() => parseDevice("G10", { plcProfile: "melsec:iq-r" }), /not supported in the Node-RED public high-level surface/);
  assert.throws(() => parseDevice("G10"), /require options\.plcProfile/);
  assert.throws(() => parseDevice("HG10"), /require options\.plcProfile/);
  assert.equal(isDeviceCodeSupportedForPlcProfile("LZ", "melsec:qnudv"), false);
  assert.equal(isDeviceCodeSupportedForPlcProfile("G", "melsec:qnu"), false);
  assert.equal(isDeviceCodeSupportedForPlcProfile("G", null), false);
  assert.equal(isDeviceCodeSupportedForPlcProfile("HG", null), false);
});

test("profile unsupported device codes follow canonical device range fixture", () => {
  const payload = loadDeviceRangeRulesFixture();
  for (const [profile, profilePayload] of Object.entries(payload.profiles)) {
    for (const [item, rule] of Object.entries(profilePayload.rules)) {
      const expected = rule.kind !== "unsupported";
      for (const { device } of payload.rows[item].devices) {
        assert.equal(
          isDeviceCodeSupportedForPlcProfile(device, profile),
          expected,
          `${profile} ${device}`
        );
      }
    }
  }

  assert.equal(isDeviceCodeSupportedForPlcProfile("DX", "melsec:iq-f"), false);
  assert.equal(isDeviceCodeSupportedForPlcProfile("DY", "melsec:iq-f"), false);
});

test("resolveConnectionProfile derives fixed defaults from plcProfile", () => {
  const profile = resolveConnectionProfile({ plcProfile: "melsec:iq-l" });
  assert.deepEqual(profile, {
    plcProfile: "melsec:iq-l",
    plcSeries: "iqr",
    frameType: "4e",
    addressProfile: "melsec:iq-l",
    rangeProfile: "melsec:iq-l",
  });
  assert.deepEqual(resolveConnectionProfile({ plcProfile: "melsec:qcpu:qj71e71-100" }), {
    plcProfile: "melsec:qcpu:qj71e71-100",
    plcSeries: "ql",
    frameType: "4e",
    addressProfile: "melsec:qcpu",
    rangeProfile: "melsec:qcpu:qj71e71-100",
  });
  assert.deepEqual(resolveConnectionProfile({ plcProfile: "melsec:iq-r:rj71en71" }), {
    plcProfile: "melsec:iq-r:rj71en71",
    plcSeries: "iqr",
    frameType: "4e",
    addressProfile: "melsec:iq-r",
    rangeProfile: "melsec:iq-r:rj71en71",
  });
  assert.throws(
    () => resolveConnectionProfile({ plcProfile: "melsec:qcpu" }),
    /melsec:qcpu is a base profile; use melsec:qcpu:qj71e71-100/
  );
  assert.throws(
    () => resolveConnectionProfile({ plcProfile: "melsec:iq-r", plcSeries: "ql" }),
    /already determines frameType, plcSeries/
  );
  assert.throws(
    () => resolveConnectionProfile({ plcProfile: "iq-r" }),
    /Unsupported plcProfile/
  );
});

test("resolveConnectionProfile rejects missing plcProfile on the standard route", () => {
  assert.throws(
    () => resolveConnectionProfile({ frameType: "4e", plcSeries: "iqr" }),
    /plcProfile is required for the standard client profile/
  );
});

test("SlmpClient requires explicit connection identity and defaults timeout only when absent", async () => {
  const base = { host: "127.0.0.1", plcProfile: "melsec:iq-r", transport: "tcp", target: TEST_TARGET };
  for (const invalidPort of [undefined, null, "", " ", false, 0, -1, 1.5, 65536, NaN, Infinity, {}, []]) {
    assert.throws(() => new StrictSlmpClient({ ...base, port: invalidPort }), /port/);
  }
  for (const validPort of [1, 1025, 65535, "1025"]) {
    const client = new StrictSlmpClient({ ...base, port: validPort });
    assert.equal(client.port, Number(validPort));
  }
  for (const invalidTransport of [undefined, null, "", " ", false, 0, {}, [], "serial", "tpc"]) {
    assert.throws(
      () => new StrictSlmpClient({ ...base, port: 1025, transport: invalidTransport }),
      /transport/i,
    );
    assert.throws(() => normalizeTransport(invalidTransport), /transport/i);
  }
  for (const [input, expected] of [["tcp", "tcp"], ["UDP", "udp"], [" tcp ", "tcp"]]) {
    assert.equal(normalizeTransport(input), expected);
    assert.equal(new StrictSlmpClient({ ...base, port: 1025, transport: input }).transportType, expected);
  }
  const defaultTimeoutClient = new StrictSlmpClient({ ...base, port: 1025 });
  assert.equal(defaultTimeoutClient.timeout, 3000);
  assert.equal(defaultTimeoutClient._transport.timeout, 3000);
  for (const validTimeout of [1, 3000, 0x7fffffff, "3000"]) {
    const client = new StrictSlmpClient({ ...base, port: 1025, timeout: validTimeout });
    assert.equal(normalizeTimeout(validTimeout), Number(validTimeout));
    assert.equal(client.timeout, Number(validTimeout));
    assert.equal(client._transport.timeout, Number(validTimeout));
  }
  for (const invalidTimeout of [undefined, null, "", " ", false, 0, -1, 1.5, 0x80000000, NaN, Infinity, {}, []]) {
    assert.throws(() => normalizeTimeout(invalidTimeout), /timeout/);
    assert.throws(
      () => new StrictSlmpClient({ ...base, port: 1025, timeout: invalidTimeout }),
      /timeout/,
    );
  }
  assert.throws(() => new StrictSlmpClient({ ...base, port: 1025, target: { network: 0 } }), /required/);
  const strict = new StrictSlmpClient({ ...base, port: 1025 });
  await assert.rejects(() => strict.rawCommand(0x0401, { payload: Buffer.alloc(0) }), /subcommand/);
  await assert.rejects(() => strict.rawCommand(0x0401, { subcommand: 0 }), /payload/);
  await assert.rejects(() => strict.readDevices("D0", 1), /bitUnit/);
  await assert.rejects(() => strict.writeDevices("D0", [1]), /bitUnit/);
  for (const invalidBitUnit of [undefined, null, "", "false", 0, 1, {}, []]) {
    await assert.rejects(() => strict.readDevices("D0", 1, { bitUnit: invalidBitUnit }), /bitUnit/);
    await assert.rejects(() => strict.writeDevices("D0", [1], { bitUnit: invalidBitUnit }), /bitUnit/);
  }
  await assert.rejects(
    () => strict.rawCommand(0x0401, { subcommand: 0, payload: Buffer.alloc(0), serial: 7 }),
    /does not accept serial/
  );
  await assert.rejects(
    () => strict.rawCommand(0x0401, { subcommand: 0, payload: Buffer.alloc(0), series: "ql" }),
    /does not accept series/
  );
  await assert.rejects(() => strict.readDevices("D0", 1, { bitUnit: false, series: "ql" }), /does not accept series/);
});

test("monitoring timer defaults only when absent and preserves exact 3E/4E wire values", async () => {
  const base = {
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    target: TEST_TARGET,
  };
  const defaultClient = new StrictSlmpClient({ ...base, plcProfile: "melsec:iq-r" });
  assert.equal(defaultClient.monitoringTimer, 16);
  assert.equal(defaultClient.timeout, 3000);
  assert.equal(defaultClient._transport.timeout, 3000);

  for (const valid of [0, 1, 16, 65535, "0", "16", "65535"]) {
    assert.equal(normalizeMonitoringTimer(valid), Number(valid));
    const client = new StrictSlmpClient({ ...base, plcProfile: "melsec:iq-r", monitoringTimer: valid });
    assert.equal(client.monitoringTimer, Number(valid));
  }
  for (const invalid of [undefined, null, "", " ", false, true, -1, 1.5, 65536, NaN, Infinity, {}, []]) {
    assert.throws(() => normalizeMonitoringTimer(invalid), /monitoringTimer/);
    assert.throws(
      () => new StrictSlmpClient({ ...base, plcProfile: "melsec:iq-r", monitoringTimer: invalid }),
      /monitoringTimer/,
    );
  }

  const clients = [
    {
      frameType: "4e",
      timerOffset: 13,
      client: new StrictSlmpClient({ ...base, plcProfile: "melsec:iq-r", monitoringTimer: 32 }),
      response: (frame) => make4EResponse(frame.readUInt16LE(2), Buffer.alloc(0)),
    },
    {
      frameType: "3e",
      timerOffset: 9,
      client: new StrictSlmpClient({ ...base, plcProfile: "melsec:iq-f", monitoringTimer: 32 }),
      response: () => make3EResponse(Buffer.alloc(0)),
    },
  ];
  for (const item of clients) {
    const frames = [];
    item.client._sendAndReceive = async (frame) => {
      frames.push(Buffer.from(frame));
      return item.response(frame);
    };
    await item.client.rawCommand(Command.DEVICE_READ, { subcommand: 0, payload: Buffer.alloc(0) });
    for (const timer of [0, 1, 16, 65535]) {
      await item.client.rawCommand(Command.DEVICE_READ, {
        subcommand: 0,
        payload: Buffer.alloc(0),
        monitoringTimer: timer,
      });
    }
    assert.deepEqual(
      frames.map((frame) => frame.readUInt16LE(item.timerOffset)),
      [32, 0, 1, 16, 65535],
      `${item.frameType} monitoring timer field`,
    );
    const sentBeforeInvalid = frames.length;
    for (const invalid of [undefined, null, "", " ", false, true, -1, 1.5, 65536, NaN, Infinity, {}, []]) {
      await assert.rejects(
        () => item.client.rawCommand(Command.DEVICE_READ, {
          subcommand: 0,
          payload: Buffer.alloc(0),
          monitoringTimer: invalid,
        }),
        /monitoringTimer/,
      );
    }
    assert.equal(frames.length, sentBeforeInvalid, `${item.frameType} rejects invalid timer before send`);
  }

  const indefinite = new StrictSlmpClient({ ...base, plcProfile: "melsec:iq-r", monitoringTimer: 0 });
  assert.equal(indefinite.monitoringTimer, 0);
  assert.equal(indefinite.timeout, 3000);
  assert.equal(indefinite._transport.timeout, 3000);
});

test("random reads allow one device kind and reject empty or invalid collections", async () => {
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    target: TEST_TARGET,
    plcProfile: "melsec:iq-r",
  });
  const responses = [Buffer.from([0x34, 0x12]), Buffer.from([0x78, 0x56, 0x34, 0x12])];
  let requestCount = 0;
  client._request = async () => ({ data: responses[requestCount++] });

  const wordOnly = await client.readRandom({ wordDevices: ["D0"] });
  assert.deepEqual(wordOnly, { word: { D0: 0x1234 }, dword: {} });
  const dwordOnly = await client.readRandom({ dwordDevices: ["D2"] });
  assert.deepEqual(dwordOnly, { word: {}, dword: { D2: 0x12345678 } });

  await assert.rejects(() => client.readRandom(), /must not both be empty/);
  await assert.rejects(() => client.readRandomExt(), /must not both be empty/);
  for (const invalid of [null, 1, {}, "D0"]) {
    await assert.rejects(() => client.readRandom({ wordDevices: invalid }));
    await assert.rejects(() => client.readRandomExt({ wordDevices: invalid }));
  }
  assert.equal(requestCount, 2);
});

test("random word writes allow one value kind and reject empty or invalid collections", async () => {
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    target: TEST_TARGET,
    plcProfile: "melsec:iq-r",
  });
  const payloads = [];
  client._request = async (_command, _subcommand, data) => {
    payloads.push(Buffer.from(data));
    return { data: Buffer.alloc(0) };
  };

  await client.writeRandomWords({ wordValues: [["D0", 0x1234]] });
  await client.writeRandomWords({ dwordValues: [["D2", 0x12345678]] });
  await client.writeRandomWordsExt({ wordValues: [[String.raw`J1\D0`, 0x1234]] });
  await client.writeRandomWordsExt({ dwordValues: [[String.raw`J1\D2`, 0x12345678]] });
  assert.deepEqual(payloads.map((payload) => [...payload.subarray(0, 2)]), [[1, 0], [0, 1], [1, 0], [0, 1]]);

  await assert.rejects(() => client.writeRandomWords(), /must not both be empty/);
  await assert.rejects(() => client.writeRandomWordsExt(), /must not both be empty/);
  for (const invalid of [null, 1, Symbol("invalid"), "D0"]) {
    await assert.rejects(() => client.writeRandomWords({ wordValues: invalid }));
    await assert.rejects(() => client.writeRandomWordsExt({ wordValues: invalid }));
  }
  assert.equal(payloads.length, 4);
});

test("block access allows one block kind and rejects empty or invalid collections", async () => {
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    target: TEST_TARGET,
    plcProfile: "melsec:iq-r",
  });
  const responseData = [Buffer.from([0x34, 0x12]), Buffer.from([0x10, 0x00])];
  const payloads = [];
  client._request = async (_command, _subcommand, data) => {
    payloads.push(Buffer.from(data));
    return { data: responseData.shift() || Buffer.alloc(0) };
  };

  const wordOnly = await client.readBlock({ wordBlocks: [["D0", 1]] });
  assert.deepEqual(wordOnly.wordBlocks[0].values, [0x1234]);
  assert.deepEqual(wordOnly.bitBlocks, []);
  const bitOnly = await client.readBlock({ bitBlocks: [["M0", 1]] });
  assert.deepEqual(bitOnly.wordBlocks, []);
  assert.deepEqual(bitOnly.bitBlocks[0].values, [0x0010]);
  await client.writeBlock({ wordBlocks: [["D0", [0x1234]]] });
  await client.writeBlock({ bitBlocks: [["M0", [0x0001]]] });
  assert.deepEqual(payloads.map((payload) => [...payload.subarray(0, 2)]), [[1, 0], [0, 1], [1, 0], [0, 1]]);

  await assert.rejects(() => client.readBlock(), /must not both be empty/);
  await assert.rejects(() => client.writeBlock(), /must not both be empty/);
  for (const invalid of [null, 1, Symbol("invalid"), "D0"]) {
    await assert.rejects(() => client.readBlock({ wordBlocks: invalid }));
    await assert.rejects(() => client.writeBlock({ wordBlocks: invalid }));
  }
  assert.equal(payloads.length, 4);
});

test("raiseOnError defaults to true and accepts only explicit booleans", async () => {
  const base = {
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    target: TEST_TARGET,
    plcProfile: "melsec:iq-r",
  };
  assert.equal(new StrictSlmpClient(base).raiseOnError, true);
  assert.equal(new StrictSlmpClient({ ...base, raiseOnError: true }).raiseOnError, true);
  assert.equal(new StrictSlmpClient({ ...base, raiseOnError: false }).raiseOnError, false);
  for (const invalid of [undefined, null, "", "false", "true", 0, 1, {}, []]) {
    assert.throws(() => new StrictSlmpClient({ ...base, raiseOnError: invalid }), /raiseOnError must be a boolean/);
  }

  const strict = new StrictSlmpClient(base);
  let strictSends = 0;
  strict._sendAndReceive = async (frame) => {
    strictSends += 1;
    return make4EResponse(frame.readUInt16LE(2), Buffer.alloc(0), 0xc051);
  };
  await assert.rejects(
    () => strict.rawCommand(Command.DEVICE_READ, { subcommand: 0, payload: Buffer.alloc(0) }),
    (error) => error instanceof SlmpError && error.endCode === 0xc051,
  );
  assert.equal(strictSends, 1);

  const diagnostic = new StrictSlmpClient({ ...base, raiseOnError: false });
  const frames = [];
  diagnostic._sendAndReceive = async (frame) => {
    frames.push(Buffer.from(frame));
    return make4EResponse(frame.readUInt16LE(2), Buffer.alloc(0), 0xc051);
  };
  const response = await diagnostic.rawCommand(Command.DEVICE_READ, {
    subcommand: 0,
    payload: Buffer.alloc(0),
  });
  assert.equal(response.endCode, 0xc051);

  for (const invalid of [undefined, null, "", "false", "true", 0, 1, {}, []]) {
    assert.throws(
      () => diagnostic._request(Command.DEVICE_READ, 0, Buffer.alloc(0), { raiseOnError: invalid }),
      /raiseOnError must be a boolean/,
    );
  }
  assert.equal(frames.length, 1, "invalid request policies must fail before transport");
});

test("normalizeTarget rejects partial, fractional, and non-finite route values", () => {
  assert.deepEqual(normalizeTarget({ network: "1", station: "2", moduleIO: "03FF", multidrop: "3" }), {
    network: 1,
    station: 2,
    moduleIO: 0x03ff,
    multidrop: 3,
  });
  for (const target of [
    { ...TEST_TARGET, network: "1junk" },
    { ...TEST_TARGET, station: "2.9" },
    { ...TEST_TARGET, moduleIO: "03FFzz" },
    { ...TEST_TARGET, multidrop: "3x" },
    { ...TEST_TARGET, network: 1.5 },
    { ...TEST_TARGET, station: Number.NaN },
    { ...TEST_TARGET, moduleIO: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => normalizeTarget(target), /integer/i);
  }
  assert.throws(() => normalizeTarget({ network: 0 }), /required/i);
  assert.throws(() => normalizeTarget({ ...TEST_TARGET, module_io: 0x03ff }), /both moduleIO and module_io/i);
  assert.deepEqual(normalizeTarget({ network: 0, station: 0, module_io: 0, multidrop: 0 }), {
    network: 0,
    station: 0,
    moduleIO: 0,
    multidrop: 0,
  });
  assert.deepEqual(normalizeTarget({ network: 255, station: 255, moduleIO: 65535, multidrop: 255 }), {
    network: 255,
    station: 255,
    moduleIO: 65535,
    multidrop: 255,
  });

  const routeFields = ["network", "station", "moduleIO", "multidrop"];
  for (let fieldMask = 0; fieldMask < 0b1111; fieldMask += 1) {
    const partial = {};
    routeFields.forEach((field, index) => {
      if ((fieldMask & (1 << index)) !== 0) {
        partial[field] = TEST_TARGET[field];
      }
    });
    assert.throws(() => normalizeTarget(partial), /required/i);
  }
  for (const invalidTarget of [undefined, null, "", false, 0, [], "not-a-route"]) {
    assert.throws(() => normalizeTarget(invalidTarget), /target/i);
  }
  for (const field of routeFields) {
    for (const invalidValue of [null, "", false, -1, 1.5, NaN, Infinity, {}, []]) {
      assert.throws(() => normalizeTarget({ ...TEST_TARGET, [field]: invalidValue }), /target|integer|range|required/i);
    }
  }
});

test("SlmpClient inherits a complete route only when request target is absent", async () => {
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    plcProfile: "melsec:iq-r",
    target: TEST_TARGET,
  });
  const frames = [];
  client._sendAndReceive = async (frame) => {
    frames.push(Buffer.from(frame));
    return make4EResponse(frame.readUInt16LE(2), Buffer.alloc(0));
  };

  await client.rawCommand(Command.DEVICE_READ, { subcommand: 0, payload: Buffer.alloc(0) });
  const override = { network: 1, station: 2, moduleIO: 0x1234, multidrop: 3 };
  await client.rawCommand(Command.DEVICE_READ, { subcommand: 0, payload: Buffer.alloc(0), target: override });
  await assert.rejects(
    () => client.rawCommand(Command.DEVICE_READ, { subcommand: 0, payload: Buffer.alloc(0), target: { network: 1 } }),
    /required/,
  );

  assert.equal(frames.length, 2);
  assert.deepEqual(readRequestTarget(frames[0]), TEST_TARGET);
  assert.deepEqual(readRequestTarget(frames[1]), override);
});

test("HG qualified device never changes the user-selected request target", async () => {
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    plcProfile: "melsec:iq-r",
    target: TEST_TARGET,
  });
  const frames = [];
  client._sendAndReceive = async (frame) => {
    frames.push(Buffer.from(frame));
    return make4EResponse(frame.readUInt16LE(2), Buffer.alloc(0));
  };

  await client.writeRandomWordsExt({ wordValues: [[String.raw`U3E1\HG100`, 0x1234]] });
  const cpu2 = { network: 0, station: 0xff, moduleIO: ModuleIONo.MULTIPLE_CPU_2, multidrop: 0 };
  await client.writeRandomWordsExt({ wordValues: [[String.raw`U3E1\HG100`, 0x5678]], target: cpu2 });

  assert.equal(frames.length, 2);
  assert.deepEqual(readRequestTarget(frames[0]), TEST_TARGET);
  assert.deepEqual(readRequestTarget(frames[1]), cpu2);
  assert.equal(frames[0].readUInt16LE(15), Command.DEVICE_WRITE_RANDOM);
  assert.equal(frames[1].readUInt16LE(15), Command.DEVICE_WRITE_RANDOM);
});

test("queued requests snapshot the effective target before caller mutation", async () => {
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: 1025,
    transport: "tcp",
    plcProfile: "melsec:iq-r",
    target: TEST_TARGET,
  });
  assert.equal(Object.isFrozen(client.defaultTarget), true);
  assert.throws(() => {
    client.defaultTarget.network = 9;
  }, TypeError);
  assert.throws(() => {
    client.defaultTarget = { network: 9, station: 9, moduleIO: 9, multidrop: 9 };
  }, TypeError);

  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const observed = [];
  client._requestInternal = async (_command, _subcommand, data, options) => {
    observed.push({
      target: { ...options.target },
      data: Buffer.from(data),
      monitoringTimer: options.monitoringTimer,
      raiseOnError: options.raiseOnError,
    });
    if (observed.length === 1) {
      await firstGate;
    }
    return { serial: 0, target: options.target, endCode: 0, data: Buffer.alloc(0), raw: Buffer.alloc(0) };
  };

  const first = client.rawCommand(Command.CLEAR_ERROR, {
    subcommand: 0,
    payload: Buffer.from([0x01]),
  });
  await waitFor(() => observed.length === 1);

  const mutableTarget = { network: 1, station: 2, moduleIO: 0x03ff, multidrop: 3 };
  const mutablePayload = Buffer.from([0x02]);
  const secondOptions = {
    subcommand: 0,
    payload: mutablePayload,
    target: mutableTarget,
    monitoringTimer: 0,
    raiseOnError: false,
  };
  const second = client.rawCommand(Command.CLEAR_ERROR, secondOptions);
  mutableTarget.network = 9;
  secondOptions.target = { network: 8, station: 8, moduleIO: 8, multidrop: 8 };
  mutablePayload[0] = 0xff;
  secondOptions.monitoringTimer = 16;
  secondOptions.raiseOnError = true;

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(observed[1].target, { network: 1, station: 2, moduleIO: 0x03ff, multidrop: 3 });
  assert.deepEqual([...observed[1].data], [0x02]);
  assert.equal(observed[1].monitoringTimer, 0);
  assert.equal(observed[1].raiseOnError, false);
});

test("encodeDeviceSpec follows QL and iQR layouts", () => {
  assert.deepEqual([...encodeDeviceSpec("D100", { series: "ql" })], [100, 0, 0, 0xa8]);
  assert.deepEqual([...encodeDeviceSpec("D100", { series: "iqr" })], [100, 0, 0, 0, 0xa8, 0x00]);
});

test("Extended Device public model is semantic and raw wire encoders are hidden", () => {
  assert.equal("encodeExtendedDeviceSpec" in slmpApi, false);
  assert.equal("encodeResolvedExtendedDeviceSpec" in slmpApi, false);
  assert.equal("normalizeExtensionSpec" in slmpApi, false);
  assert.equal("resolveExtendedDeviceAndExtension" in slmpApi, false);
  const typed = new SlmpExtendedDevice(String.raw`U1\G0`, new SlmpIndexZ(4));
  assert.equal(typed.address, String.raw`U1\G0`);
  assert.equal(typed.modification.index, 4);
  assert.throws(() => new SlmpIndexZ(-1), /0\.\.255/);
  assert.equal(new SlmpIndexLz(1).index, 1);
  assert.throws(() => new SlmpIndexLz(2), /0\.\.1/);
  assert.throws(() => new SlmpExtendedDevice("D0", {}), /modification/);
});

test("slmp-connection editor supplies required new-node connection values", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-connection.html"), "utf8");
  assert.match(
    html,
    /port:\s*\{\s*value:\s*1025,\s*required:\s*true,/,
  );
  assert.match(html, /id="node-config-input-port"/);
  assert.match(html, /transport:\s*\{\s*value:\s*"tcp",\s*required:\s*true\s*\}/);
  assert.match(html, /id="node-config-input-transport"/);
  assert.match(
    html,
    /timeout:\s*\{\s*value:\s*3000,\s*required:\s*true,\s*validate:[\s\S]*?slmpValidateIntegerInRange\(value,\s*1,\s*2147483647\)/,
  );
  assert.match(html, /id="node-config-input-timeout"/);
  assert.match(
    html,
    /monitoringTimer:\s*\{\s*value:\s*16,\s*required:\s*true,\s*validate:[\s\S]*?slmpValidateIntegerInRange\(value,\s*0,\s*65535\)/,
  );
  assert.match(html, /id="node-config-input-monitoringTimer"/);
  assert.match(html, /0 means the PLC-side processing wait is indefinite/i);
  assert.match(html, /communication timeout remains separate/i);
  for (const [field, value] of [["network", "0"], ["station", "255"], ["moduleIO", "03FF"], ["multidrop", "0"]]) {
    assert.match(
      html,
      new RegExp(`${field}:\\s*\\{\\s*value:\\s*"${value}",\\s*required:\\s*true,`),
    );
    assert.match(html, new RegExp(`id="node-config-input-${field}"`));
  }
  assert.doesNotMatch(html, /node-config-input-strictProfile/);
  assert.doesNotMatch(html, /strictProfile\s*:/);
  assert.doesNotMatch(html, /strictProfile\s*=\s*false/i);
  for (const relativePath of [
    "README.md",
    "docsrc/user/GETTING_STARTED.md",
    "docsrc/user/USAGE_GUIDE.md",
    "docsrc/user/PROFILES.md",
    "docsrc/user/API_REFERENCE.md",
    "nodes/slmp-read.js",
    "nodes/slmp-write.js",
  ]) {
    const content = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    assert.doesNotMatch(content, /strictProfile|strict_profile/);
  }
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
    target: { network: 0, station: 0xff, moduleIO: ModuleIONo.MULTIPLE_CPU_2, multidrop: 0 },
    monitoringTimer: 0x0010,
    command: 0x0401,
    subcommand: 0x0002,
    data: Buffer.from([0xaa, 0xbb]),
  });
  assert.equal(request.subarray(0, 2).toString("hex"), "5400");
  assert.equal(request.readUInt16LE(8), ModuleIONo.MULTIPLE_CPU_2);

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

test("ModuleIONo exposes named target module I/O constants", () => {
  assert.equal(ModuleIONo.CONTROL_SYSTEM_CPU, 0x03d0);
  assert.equal(ModuleIONo.STANDBY_SYSTEM_CPU, 0x03d1);
  assert.equal(ModuleIONo.SYSTEM_A_CPU, 0x03d2);
  assert.equal(ModuleIONo.SYSTEM_B_CPU, 0x03d3);
  assert.equal(ModuleIONo.MULTIPLE_CPU_1, 0x03e0);
  assert.equal(ModuleIONo.MULTIPLE_CPU_2, 0x03e1);
  assert.equal(ModuleIONo.MULTIPLE_CPU_3, 0x03e2);
  assert.equal(ModuleIONo.MULTIPLE_CPU_4, 0x03e3);
  assert.equal(ModuleIONo.REMOTE_HEAD_1, ModuleIONo.MULTIPLE_CPU_1);
  assert.equal(ModuleIONo.REMOTE_HEAD_2, ModuleIONo.MULTIPLE_CPU_2);
  assert.equal(ModuleIONo.CONTROL_SYSTEM_REMOTE_HEAD, ModuleIONo.CONTROL_SYSTEM_CPU);
  assert.equal(ModuleIONo.STANDBY_SYSTEM_REMOTE_HEAD, ModuleIONo.STANDBY_SYSTEM_CPU);
  assert.equal(ModuleIONo.OWN_STATION, 0x03ff);
});

test("decodeResponse and SlmpError expose structured PLC error information", () => {
  const errorData = Buffer.from("00ffff030001040100", "hex");
  const response = Buffer.concat([
    Buffer.from([
      0xd4, 0x00,
      0x34, 0x12,
      0x00, 0x00,
      0x00,
      0xff,
      0xff, 0x03,
      0x00,
      0x0b, 0x00,
      0x51, 0xc0,
    ]),
    errorData,
  ]);

  const decoded = decodeResponse(response, { frameType: "4e" });

  assert.equal(decoded.endCode, 0xc051);
  assert.deepEqual(decoded.errorInfo, {
    network: 0x00,
    station: 0xff,
    moduleIO: 0x03ff,
    multidrop: 0x00,
    command: 0x0401,
    subcommand: 0x0001,
    raw: errorData,
  });
  const error = new SlmpError("raw", { endCode: decoded.endCode, data: decoded.data });
  assert.deepEqual(error.errorInfo, decoded.errorInfo);
  assert.deepEqual(parseSlmpErrorInfo(errorData), decoded.errorInfo);
});

test("4E TCP client waits for the first response before sending the second request frame", async () => {
  const frames = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    frames.push(Buffer.from(frame));
    if (frames.length > 1) {
      socket.write(responseForRequest(frame, "4e", [0x22, 0x22]));
    }
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "4e", timeout: 200, _allowManualProfile: true });

  try {
    const first = client.rawCommand(0x0401, { payload: Buffer.from([0x01]) });
    const second = client.rawCommand(0x0401, { payload: Buffer.from([0x02]) });

    await waitFor(() => frames.length === 1);
    await delay(30);
    assert.equal(frames.length, 1);

    server.sockets[0].write(responseForRequest(frames[0], "4e", [0x11, 0x11]));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    assert.equal(frames.length, 2);
    assert.deepEqual([...requestPayload(frames[0], "4e")], [0x01]);
    assert.deepEqual([...requestPayload(frames[1], "4e")], [0x02]);
    assert.deepEqual([...firstResponse.data], [0x11, 0x11]);
    assert.deepEqual([...secondResponse.data], [0x22, 0x22]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("4E TCP client preserves FIFO send order for concurrently issued requests", async () => {
  const order = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    order.push(requestPayload(frame, "4e")[0]);
    socket.write(responseForRequest(frame, "4e", [requestPayload(frame, "4e")[0]]));
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "4e", timeout: 200, _allowManualProfile: true });

  try {
    const responses = await Promise.all([
      client.rawCommand(0x0401, { payload: Buffer.from([0x01]) }),
      client.rawCommand(0x0401, { payload: Buffer.from([0x02]) }),
      client.rawCommand(0x0401, { payload: Buffer.from([0x03]) }),
    ]);

    assert.deepEqual(order, [0x01, 0x02, 0x03]);
    assert.deepEqual(responses.map((response) => response.data[0]), [0x01, 0x02, 0x03]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("4E TCP timeout destroys its generation and a separately queued request reconnects", async () => {
  const frames = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    frames.push(Buffer.from(frame));
    if (frames.length === 2) {
      socket.write(responseForRequest(frame, "4e", [0x22, 0x22]));
    }
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "4e", timeout: 25, _allowManualProfile: true });

  try {
    const first = client.rawCommand(0x0401, { payload: Buffer.from([0x01]) });
    const second = client.rawCommand(0x0401, { payload: Buffer.from([0x02]) });

    await assert.rejects(() => first, /TCP communication timeout/);
    const secondResponse = await second;

    assert.equal(frames.length, 2);
    assert.deepEqual([...requestPayload(frames[1], "4e")], [0x02]);
    assert.deepEqual([...secondResponse.data], [0x22, 0x22]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("4E TCP request gate releases after transport close and reconnects for the next queued request", async () => {
  const frames = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    frames.push(Buffer.from(frame));
    if (frames.length === 1) {
      socket.destroy();
      return;
    }
    socket.write(responseForRequest(frame, "4e", [0x33, 0x33]));
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "4e", timeout: 200, _allowManualProfile: true });

  try {
    const first = client.rawCommand(0x0401, { payload: Buffer.from([0x01]) });
    const second = client.rawCommand(0x0401, { payload: Buffer.from([0x02]) });

    await assert.rejects(() => first, /TCP connection closed|TCP transport failure|read ECONNRESET/);
    const secondResponse = await second;

    assert.equal(frames.length, 2);
    assert.deepEqual([...requestPayload(frames[1], "4e")], [0x02]);
    assert.deepEqual([...secondResponse.data], [0x33, 0x33]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("4E TCP request gate releases after a PLC end-code error", async () => {
  const frames = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    frames.push(Buffer.from(frame));
    if (frames.length === 1) {
      socket.write(responseForRequest(frame, "4e", [], 0xc051));
      return;
    }
    socket.write(responseForRequest(frame, "4e", [0x44, 0x44]));
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "4e", timeout: 200, _allowManualProfile: true });

  try {
    const first = client.rawCommand(0x0401, { payload: Buffer.from([0x01]) });
    const second = client.rawCommand(0x0401, { payload: Buffer.from([0x02]) });

    await assert.rejects(
      () => first,
      (error) =>
        error instanceof SlmpError &&
        error.endCode === 0xc051 &&
        error.errorInfo?.command === 0x0401 &&
        error.errorInfo?.subcommand === 0x0000
    );
    const secondResponse = await second;

    assert.equal(frames.length, 2);
    assert.deepEqual([...requestPayload(frames[1], "4e")], [0x02]);
    assert.deepEqual([...secondResponse.data], [0x44, 0x44]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("expectResponse false requests keep FIFO send order in the shared request queue", async () => {
  const order = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    order.push(requestPayload(frame, "4e")[0]);
    if (order.length === 1 || order.length === 3) {
      socket.write(responseForRequest(frame, "4e", [requestPayload(frame, "4e")[0]]));
    }
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "4e", timeout: 200, _allowManualProfile: true });

  try {
    await Promise.all([
      client.rawCommand(0x0401, { payload: Buffer.from([0x01]) }),
      client.rawCommand(0x1401, { payload: Buffer.from([0x02]), expectResponse: false }),
      client.rawCommand(0x0401, { payload: Buffer.from([0x03]) }),
    ]);

    assert.deepEqual(order, [0x01, 0x02, 0x03]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("3E TCP concurrently issued requests wait and both complete instead of failing on a second pending request", async () => {
  const order = [];
  const server = await startMockTcpServer("3e", ({ frame, socket }) => {
    order.push(requestPayload(frame, "3e")[0]);
    socket.write(responseForRequest(frame, "3e", [requestPayload(frame, "3e")[0]]));
  });
  const client = new SlmpClient({ host: "127.0.0.1", port: server.port, transport: "tcp", frameType: "3e", timeout: 200, _allowManualProfile: true });

  try {
    const responses = await Promise.all([
      client.rawCommand(0x0401, { payload: Buffer.from([0x01]) }),
      client.rawCommand(0x0401, { payload: Buffer.from([0x02]) }),
    ]);

    assert.deepEqual(order, [0x01, 0x02]);
    assert.deepEqual(responses.map((response) => response.data[0]), [0x01, 0x02]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("request serialization gate is independent of transport type", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", transport: "udp", frameType: "4e", _allowManualProfile: true });
  let active = 0;
  let maxActive = 0;

  client._requestInternal = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(5);
    active -= 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await Promise.all([
    client.rawCommand(0x0401, { payload: Buffer.from([0x01]) }),
    client.rawCommand(0x0401, { payload: Buffer.from([0x02]) }),
    client.rawCommand(0x0401, { payload: Buffer.from([0x03]) }),
  ]);

  assert.equal(maxActive, 1);
});

test("remote password unlock sequence does not deadlock behind the request serialization gate", async () => {
  const commands = [];
  const server = await startMockTcpServer("4e", ({ frame, socket }) => {
    commands.push(frame.readUInt16LE(15));
    socket.write(responseForRequest(frame, "4e", []));
  });
  const client = new SlmpClient({
    host: "127.0.0.1",
    port: server.port,
    transport: "tcp",
    frameType: "4e",
    plcSeries: "iqr",
    remotePassword: "secret1",
    timeout: 200,
    _allowManualProfile: true,
  });

  try {
    await withTimeout(client.rawCommand(0x0401, { payload: Buffer.from([0x01]) }), 300);

    assert.deepEqual(commands.slice(0, 2), [Command.REMOTE_PASSWORD_UNLOCK, 0x0401]);
  } finally {
    await client.close();
    await server.close();
  }
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

test("3E TCP frame extraction waits for split response chunks", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const response = make3EResponse([0x34, 0x12]);
  const pending = client._awaitTcpFrame(0);

  client._handleTcpData(response.subarray(0, 6));
  client._handleTcpData(response.subarray(6));

  const frame = await pending;
  const decoded = decodeResponse(frame, { frameType: "3e" });
  assert.deepEqual([...decoded.data], [0x34, 0x12]);
});

test("TCP sendAndReceive resolves a split response injected by a mock socket", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", timeout: 50, _allowManualProfile: true });
  const writes = [];
  const request = Buffer.from([0x01, 0x02, 0x03]);
  const response = make4EResponse(0x2222, [0x44, 0x55]);
  client._transport._tcpSocket = {
    destroyed: false,
    write(frame, callback) {
      writes.push(Buffer.from(frame));
      setTimeout(() => {
        client._handleTcpData(response.subarray(0, 8));
        client._handleTcpData(response.subarray(8));
      }, 0);
      callback();
    },
  };

  const raw = await client._sendAndReceive(request, 0x2222);
  const decoded = decodeResponse(raw, { frameType: "4e" });

  assert.deepEqual([...writes[0]], [...request]);
  assert.equal(decoded.serial, 0x2222);
  assert.deepEqual([...decoded.data], [0x44, 0x55]);
});

test("3E TCP frame extraction discards responses without a waiter", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", timeout: 5, _allowManualProfile: true });

  client._handleTcpData(Buffer.concat([make3EResponse([0x11, 0x11]), make3EResponse([0x22, 0x22])]));

  await assert.rejects(() => client._awaitTcpFrame(0), /TCP communication timeout/);
});

test("TCP busy rejection occurs before any frame is written", async () => {
  const transport = new SlmpTransport({
    host: "127.0.0.1", port: 1025, transportType: "tcp", frameType: "3e", timeout: 100,
  });
  let writes = 0;
  transport._tcpSocket = { write() { writes += 1; } };
  transport._tcpPending = { resolve() {}, reject() {}, timeoutHandle: setTimeout(() => {}, 1000) };
  await assert.rejects(() => transport.sendAndReceive(Buffer.from([1]), 0), /already waiting/);
  clearTimeout(transport._tcpPending.timeoutHandle);
  assert.equal(writes, 0);
});

test("remote password configuration distinguishes omission from invalid explicit values", () => {
  const base = {
    host: "127.0.0.1",
    plcProfile: "melsec:iq-r",
  };
  const omitted = new SlmpClient(base);
  const explicitUndefined = new SlmpClient({ ...base, remotePassword: undefined });

  assert.equal(omitted._hasRemotePassword(), false);
  assert.equal(explicitUndefined._hasRemotePassword(), false);
  assert.equal(Object.prototype.hasOwnProperty.call(omitted, "remotePassword"), false);

  for (const invalid of [null, "", false, 0, {}, []]) {
    assert.throws(
      () => new SlmpClient({ ...base, remotePassword: invalid }),
      /password is required and must be a non-empty string/,
    );
  }
  for (const invalid of ["12345", "123456789012345678901234567890123", "secret\u0000", "秘密1234"]) {
    assert.throws(
      () => new SlmpClient({ ...base, remotePassword: invalid }),
      /password length|printable ASCII/,
    );
  }

  const configured = new SlmpClient({ ...base, remotePassword: "secret1" });
  assert.equal(configured._hasRemotePassword(), true);
  assert.equal(Object.prototype.hasOwnProperty.call(configured, "remotePassword"), false);
  assert.equal(JSON.stringify(configured).includes("secret1"), false);

  assert.doesNotThrow(() => new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:qcpu:qj71e71-100",
    remotePassword: "AB12",
  }));
  assert.throws(() => new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:qcpu:qj71e71-100",
    remotePassword: "ABCDEF",
  }), /Q\/L password length must be exactly 4/);
});

test("public options cannot bypass the managed remote password lifecycle", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:qcpu:qj71e71-100",
    remotePassword: "AB12",
  });
  let requests = 0;
  client._requestInternal = async () => {
    requests += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.connect({ skipRemotePasswordLifecycle: true }),
    /connect does not accept options/,
  );
  await assert.rejects(
    () => client.rawCommand(0x0401, {
      subcommand: 0,
      payload: Buffer.alloc(0),
      skipRemotePasswordLifecycle: true,
    }),
    /does not accept skipRemotePasswordLifecycle/,
  );
  await assert.rejects(
    () => client.remotePasswordUnlock("AB12", { skipRemotePasswordLifecycle: true }),
    /does not accept skipRemotePasswordLifecycle/,
  );
  await assert.rejects(
    () => client.remotePasswordLock("AB12"),
    /unavailable when managed remotePassword is configured/,
  );
  assert.equal(requests, 0);
});

test("managed remote password state follows the transport generation and is never replayed", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:qcpu:qj71e71-100",
    remotePassword: "AB12",
  });
  const commands = [];
  const fakeTransport = {
    generation: 0,
    open: false,
    failNextUserCommand: false,
    connect() {
      if (!this.open) {
        this.open = true;
        this.generation += 1;
      }
    },
    connectionGeneration() {
      return this.generation;
    },
    hasOpenTransport() {
      return this.open;
    },
    nextSerial() {
      return 0;
    },
    async sendAndReceive(frame) {
      const commandOffset = client.frameType === "4e" ? 15 : 11;
      const command = frame.readUInt16LE(commandOffset);
      commands.push({ generation: this.generation, command });
      const isPasswordCommand = command === Command.REMOTE_PASSWORD_UNLOCK || command === Command.REMOTE_PASSWORD_LOCK;
      if (!isPasswordCommand && this.failNextUserCommand) {
        this.failNextUserCommand = false;
        throw new SlmpError("UDP communication timeout");
      }
      return responseForRequest(frame, client.frameType, []);
    },
    async close() {
      this.open = false;
    },
  };
  client._transport = fakeTransport;

  await client.remoteStop();
  await client.remotePause({ force: false });
  fakeTransport.failNextUserCommand = true;
  await assert.rejects(() => client.remoteStop(), /UDP communication timeout/);
  await client.remotePause({ force: false });
  fakeTransport.open = false;
  await client.remoteStop();
  await client.close();

  assert.deepEqual(commands, [
    { generation: 1, command: Command.REMOTE_PASSWORD_UNLOCK },
    { generation: 1, command: Command.REMOTE_STOP },
    { generation: 1, command: Command.REMOTE_PAUSE },
    { generation: 1, command: Command.REMOTE_STOP },
    { generation: 1, command: Command.REMOTE_PASSWORD_UNLOCK },
    { generation: 1, command: Command.REMOTE_PAUSE },
    { generation: 2, command: Command.REMOTE_PASSWORD_UNLOCK },
    { generation: 2, command: Command.REMOTE_STOP },
    { generation: 2, command: Command.REMOTE_PASSWORD_LOCK },
  ]);
  assert.equal(fakeTransport.open, false);
});

test("close always closes locally and reports remote password lock failures", async () => {
  function attachTransport(client, { failClose = false } = {}) {
    const transport = {
      generation: 0,
      open: false,
      failLock: false,
      connect() {
        if (!this.open) {
          this.open = true;
          this.generation += 1;
        }
      },
      connectionGeneration() {
        return this.generation;
      },
      hasOpenTransport() {
        return this.open;
      },
      nextSerial() {
        return 0;
      },
      async sendAndReceive(frame) {
        const commandOffset = client.frameType === "4e" ? 15 : 11;
        const command = frame.readUInt16LE(commandOffset);
        if (command === Command.REMOTE_PASSWORD_LOCK && this.failLock) {
          return responseForRequest(frame, client.frameType, [], 0xc810);
        }
        return responseForRequest(frame, client.frameType, []);
      },
      async close() {
        this.open = false;
        if (failClose) {
          throw new Error("synthetic local close failure");
        }
      },
    };
    client._transport = transport;
    return transport;
  }

  const client = new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:qcpu:qj71e71-100",
    remotePassword: "AB12",
  });
  const transport = attachTransport(client);
  await client.remoteStop();
  transport.failLock = true;
  await assert.rejects(
    () => client.close(),
    (error) => error instanceof SlmpError && error.endCode === 0xc810 && /Remote password lock failed/.test(error.message),
  );
  assert.equal(transport.open, false);

  const doubleFailureClient = new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:qcpu:qj71e71-100",
    remotePassword: "AB12",
  });
  const doubleFailureTransport = attachTransport(doubleFailureClient, { failClose: true });
  await doubleFailureClient.remoteStop();
  doubleFailureTransport.failLock = true;
  await assert.rejects(
    () => doubleFailureClient.close(),
    (error) =>
      error instanceof SlmpError
      && error.cause instanceof AggregateError
      && error.cause.errors.length === 2
      && !error.message.includes("AB12"),
  );
  assert.equal(doubleFailureTransport.open, false);

  const localCloseClient = new SlmpClient({
    host: "127.0.0.1",
    plcProfile: "melsec:iq-r",
  });
  localCloseClient._transport._tcpSocket = {
    destroyed: false,
    once() {},
    destroy() {
      throw new Error("synthetic socket destroy failure");
    },
  };
  await assert.rejects(
    () => localCloseClient.close(),
    (error) => error instanceof SlmpError && /transport close failed/.test(error.message),
  );
  assert.equal(localCloseClient._transport._tcpSocket, null);
});

test("TCP transport enables keepalive with a 30-second idle", async () => {
  const server = await startMockTcpServer("4e", () => {});
  const originalSetKeepAlive = net.Socket.prototype.setKeepAlive;
  const observed = [];
  net.Socket.prototype.setKeepAlive = function setKeepAlive(enable, initialDelay) {
    observed.push({ enable, initialDelay });
    return originalSetKeepAlive.call(this, enable, initialDelay);
  };
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: server.port,
    transport: "tcp",
    plcProfile: "melsec:iq-r",
    target: TEST_TARGET,
  });
  try {
    await client.connect();
    assert.ok(observed.some((item) => item.enable === true && item.initialDelay === 30000));
  } finally {
    net.Socket.prototype.setKeepAlive = originalSetKeepAlive;
    await client.close();
    await server.close();
  }
});

test("TCP transport rejects and destroys the socket when required keepalive setup fails", async () => {
  const server = await startMockTcpServer("4e", () => {});
  const originalSetKeepAlive = net.Socket.prototype.setKeepAlive;
  let observedSocket = null;
  net.Socket.prototype.setKeepAlive = function setKeepAlive() {
    observedSocket = this;
    throw new Error("keepalive unavailable");
  };
  const client = new StrictSlmpClient({
    host: "127.0.0.1",
    port: server.port,
    transport: "tcp",
    plcProfile: "melsec:iq-r",
    target: TEST_TARGET,
  });
  try {
    await assert.rejects(
      () => client.connect(),
      /TCP keepalive configuration failed: keepalive unavailable/,
    );
    assert.equal(client._transport._tcpSocket, null);
    assert.equal(observedSocket.destroyed, true);
  } finally {
    net.Socket.prototype.setKeepAlive = originalSetKeepAlive;
    await client.close();
    await server.close();
  }
});

test("3E UDP timeout closes its socket generation and rejects a delayed response from that generation", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", transport: "udp", frameType: "3e", timeout: 5, _allowManualProfile: true });
  let oldClosed = false;
  const oldSocket = {
    send(_frame, callback) { callback(); },
    close() { oldClosed = true; },
  };
  client._transport._udpSocket = oldSocket;

  await assert.rejects(() => client._transport.sendUdp(Buffer.from([1]), 0), /UDP communication timeout/);
  assert.equal(oldClosed, true);
  assert.equal(client._transport._udpSocket, null);

  const newSocket = {
    send(_frame, callback) { callback(); },
    close() {},
  };
  client._transport._udpSocket = newSocket;
  const next = client._transport.sendUdp(Buffer.from([2]), 0);
  client._transport.handleUdpMessage(make3EResponse([0x11]), oldSocket);
  client._transport.handleUdpMessage(make3EResponse([0x22]), newSocket);
  const frame = await next;
  assert.deepEqual([...decodeResponse(frame, { frameType: "3e" }).data], [0x22]);
});

test("TCP frame wait reports the existing timeout message", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", timeout: 5, _allowManualProfile: true });

  await assert.rejects(() => client._awaitTcpFrame(0), /TCP communication timeout/);
});

test("TCP failure rejects pending waits with the provided error", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", _allowManualProfile: true });
  const pending = client._awaitTcpFrame(0x1001);

  client._handleTcpFailure(new SlmpError("synthetic TCP close"));

  await assert.rejects(() => pending, /synthetic TCP close/);
});

test("4E TCP response matching discards unmatched serials", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", timeout: 5, _allowManualProfile: true });

  client._handleTcpData(make4EResponse(0x1002, [0x22, 0x22]));

  await assert.rejects(() => client._awaitTcpFrame(0x1002), /TCP communication timeout/);
});

test("writeRandomBits uses 1402 bit subcommand and iQR two-byte states", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  const calls = [];
  client._request = async (command, subcommand, data) => {
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

test("extended random APIs derive iQR payloads from qualified devices and typed modifiers", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    if (calls.length === 1) {
      return { endCode: 0, data: Buffer.from([0x34, 0x12, 0xef, 0xcd, 0xab, 0x89]) };
    }
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  const read = await client.readRandomExt({
    wordDevices: [new SlmpExtendedDevice("D100", new SlmpIndexZ(4))],
    dwordDevices: [new SlmpExtendedDevice(String.raw`U01\G10`, new SlmpIndirect())],
  });
  assert.deepEqual(read, {
    word: { "D100+Z4": 0x1234 },
    dword: { [String.raw`U01\G10+INDIRECT`]: 0x89abcdef },
  });

  await client.writeRandomWordsExt({
    wordValues: [[String.raw`J1\D10`, 0x1234]],
    dwordValues: [[String.raw`U1\G20`, 0x89abcdef]],
  });
  await client.writeRandomBitsExt({
    bitValues: [
      [new SlmpExtendedDevice("M7", new SlmpIndexZ(3)), true],
      [new SlmpExtendedDevice("M8", new SlmpIndirect()), false],
    ],
  });

  assert.equal(calls[0].command, Command.DEVICE_READ_RANDOM);
  assert.equal(calls[0].subcommand, 0x0082);
  assert.equal(calls[0].data.toString("hex"), "0101044064000000a800000000000000080a000000ab0000000100f8");

  assert.equal(calls[1].command, Command.DEVICE_WRITE_RANDOM);
  assert.equal(calls[1].subcommand, 0x0082);
  assert.equal(calls[1].data.toString("hex"), "010100000a0000a800000100f93412000014000000ab0000000100f8efcdab89");

  assert.equal(calls[2].command, Command.DEVICE_WRITE_RANDOM);
  assert.equal(calls[2].subcommand, 0x0083);
  assert.equal(calls[2].data.toString("hex"), "02034007000000900000000000000100000808000000900000000000000000");

  await assert.rejects(
    () => client.readRandomExt({ wordDevices: [["D0", { extensionSpecification: 1 }]] }),
    /no longer accept raw extension fields/
  );
  await assert.rejects(
    () => client.writeRandomWordsExt({ wordValues: [["D0", 1, { extensionSpecification: 1 }]] }),
    /exact \[device, value\] tuples/
  );
  await assert.rejects(
    () => client.readRandomExt({ wordDevices: [new SlmpExtendedDevice(String.raw`J1\D0`, new SlmpIndexZ(1))] }),
    /link-direct devices do not support/
  );
});

test("extended random APIs derive QL payloads from qualified devices", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qcpu:qj71e71-100" });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    if (calls.length === 1) {
      return { endCode: 0, data: Buffer.from([0x34, 0x12, 0xef, 0xcd, 0xab, 0x89]) };
    }
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  const read = await client.readRandomExt({
    wordDevices: [String.raw`U01\G100`],
    dwordDevices: [String.raw`U02\G200`],
  });
  assert.deepEqual(read, {
    word: { [String.raw`U01\G100`]: 0x1234 },
    dword: { [String.raw`U02\G200`]: 0x89abcdef },
  });

  await client.writeRandomWordsExt({
    wordValues: [[String.raw`U01\G10`, 0x1234]],
    dwordValues: [[String.raw`U02\G20`, 0x89abcdef]],
  });
  await client.writeRandomBitsExt({
    bitValues: [
      [String.raw`U03\M7`, true],
      [String.raw`U04\M8`, false],
    ],
  });

  assert.equal(calls[0].command, Command.DEVICE_READ_RANDOM);
  assert.equal(calls[0].subcommand, 0x0080);
  assert.equal(calls[0].data.toString("hex"), "01010000640000ab00000100f80000c80000ab00000200f8");

  assert.equal(calls[1].command, Command.DEVICE_WRITE_RANDOM);
  assert.equal(calls[1].subcommand, 0x0080);
  assert.equal(calls[1].data.toString("hex"), "010100000a0000ab00000100f834120000140000ab00000200f8efcdab89");

  assert.equal(calls[2].command, Command.DEVICE_WRITE_RANDOM);
  assert.equal(calls[2].subcommand, 0x0081);
  assert.equal(calls[2].data.toString("hex"), "02000007000090000003000001000008000090000004000000");
  await assert.rejects(
    () => client.readRandomExt({ wordDevices: [new SlmpExtendedDevice("D0", new SlmpIndexLz(1))] }),
    /not available for Q\/L/
  );
});

test("extended random APIs use profile ext limit keys before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-f" });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readRandomExt({
      wordDevices: Array.from({ length: 97 }, (_, index) => String.raw`U1\D${index}`),
    }),
    /1\.\.96/
  );
  await assert.rejects(
    () => client.writeRandomWordsExt({
      wordValues: Array.from({ length: 81 }, (_, index) => [String.raw`U1\D${8000 + index}`, 0]),
    }),
    /1\.\.80/
  );
  await assert.rejects(
    () => client.writeRandomBitsExt({
      bitValues: Array.from({ length: 95 }, (_, index) => [String.raw`U1\M${4000 + index}`, false]),
    }),
    /1\.\.94/
  );

  const qcpu = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qcpu:qj71e71-100" });
  qcpu._request = client._request;
  await assert.rejects(
    () => qcpu.readRandomExt({
      wordDevices: Array.from({ length: 186 }, (_, index) => String.raw`U1\D${index}`),
    }),
    /1\.\.185/
  );
  assert.equal(calls, 0);
});

test("readDevices rejects direct long timer state reads before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
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
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeDevices("LCC10", [true], { bitUnit: true }),
    (error) => error instanceof ValueError && /Direct bit write is not supported for LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("S device write policy follows selected PLC profile", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeDevices("S10", [true], { bitUnit: true }),
    (error) => error instanceof ValueError && /S is read-only/.test(error.message)
  );
  await assert.rejects(
    () => client.writeRandomBits({ bitValues: { S10: true } }),
    (error) => error instanceof ValueError && /read-only device S for plcProfile 'melsec:iq-r'/.test(error.message)
  );
  await assert.rejects(
    () => client.writeBlock({ bitBlocks: [["S10", [1]]] }),
    (error) => error instanceof ValueError && /read-only device S for plcProfile 'melsec:iq-r'/.test(error.message)
  );
  assert.equal(calls, 0);

  const iqfClient = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-f" });
  iqfClient._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };
  await iqfClient.writeDevices("S10", [true], { bitUnit: true });
  await iqfClient.writeRandomBits({ bitValues: { S10: true } });
  await iqfClient.writeBlock({ bitBlocks: [["S10", [1]]] });
  assert.equal(calls, 3);
});

test("iQ-R manual point limits reject overruns before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  const wordDevices = Array.from({ length: 97 }, (_, index) => `D${index}`);
  const wordValues = Array.from({ length: 81 }, (_, index) => [`D${8000 + index}`, 0]);
  const dwordValues = Array.from({ length: 69 }, (_, index) => [`D${8200 + index * 2}`, 0]);
  const bitValues = Array.from({ length: 95 }, (_, index) => [`M${4000 + index}`, false]);

  await assert.rejects(() => client.readDevices("D0", 961), /1\.\.960/);
  await assert.rejects(() => client.writeDevices("D0", new Array(961).fill(0)), /1\.\.960/);
  await assert.rejects(() => client.readDevices("M0", 7169, { bitUnit: true }), /1\.\.7168/);
  await assert.rejects(() => client.writeDevices("M0", new Array(7169).fill(false), { bitUnit: true }), /1\.\.7168/);
  const iqfClient = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-f" });
  iqfClient._request = client._request;
  await assert.rejects(() => iqfClient.readDevices("M0", 3585, { bitUnit: true }), /1\.\.3584/);
  await assert.rejects(() => iqfClient.writeDevices("M0", new Array(3585).fill(false), { bitUnit: true }), /1\.\.3584/);
  await assert.rejects(() => client.readRandom({ wordDevices }), /1\.\.96/);
  await assert.rejects(() => client.writeRandomWords({ wordValues }), /word\/dword access points/);
  await assert.rejects(() => client.writeRandomWords({ dwordValues }), /word\/dword access points/);
  await assert.rejects(() => client.writeRandomBits({ bitValues }), /1\.\.94/);
  await assert.rejects(() => client.readBlock({ wordBlocks: [["D0", 961]] }), /total device points/);
  await assert.rejects(() => client.writeBlock({ wordBlocks: [["D8000", new Array(952).fill(0)]] }), /total device points/);
  await assert.rejects(() => client.memoryReadWords(0, 481), /1\.\.480/);
  await assert.rejects(() => client.memoryWriteWords(0, new Array(481).fill(0)), /1\.\.480/);
  await assert.rejects(() => client.extendUnitReadWords(0, 961, 0x03e0), /1\.\.960/);
  await assert.rejects(() => client.extendUnitWriteWords(0, 0x03e0, new Array(961).fill(0)), /1\.\.960/);
  await assert.rejects(() => client.extendUnitReadBytes(0, 1921, 0x03e0), /2\.\.1920/);
  await assert.rejects(() => client.extendUnitWriteBytes(0, 0x03e0, Buffer.alloc(1921)), /2\.\.1920/);
  assert.equal(calls, 0);
});

test("write APIs reject duplicate and overlapping destinations before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeRandomWords({ wordValues: [["D100", 1], ["D100", 2]] }),
    /duplicate word destinations/
  );
  for (const value of [-1, 0x10000, 1.5, "1", true, NaN]) {
    await assert.rejects(() => client.writeDevices("D0", [value], { bitUnit: false }), /integer in range/);
    await assert.rejects(() => client.writeRandomWords({ wordValues: [["D0", value]] }), /integer in range/);
  }
  for (const value of ["false", "0", 2, -1, 0.5, {}]) {
    await assert.rejects(() => client.writeDevices("M0", [value], { bitUnit: true }), /boolean|number 0 or 1/);
    await assert.rejects(() => client.writeRandomBits({ bitValues: [["M0", value]] }), /boolean|number 0 or 1/);
  }
  await assert.rejects(
    () => client.writeRandomWords({ wordValues: [["D100", 1]], dwordValues: [["D99", 2]] }),
    /overlapping word\/dword destinations/
  );
  await assert.rejects(
    () => client.writeRandomWords({ dwordValues: [["D100", 1], ["D101", 2]] }),
    /overlapping dword destinations/
  );
  await assert.rejects(
    () => client.writeRandomBits({ bitValues: [["M100", true], ["M100", false]] }),
    /duplicate bit destinations/
  );
  await assert.rejects(
    () => client.writeBlock({ wordBlocks: [["D100", [1, 2]], ["D101", [3]]] }),
    /overlapping destinations/
  );
  assert.equal(calls, 0);

  const extClient = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r", _maintainerStrictProfile: false });
  extClient._request = client._request;
  await assert.rejects(
    () => extClient.writeRandomWordsExt({
      wordValues: [[String.raw`U1\D100`, 1]],
      dwordValues: [[String.raw`U1\D99`, 2]],
    }),
    /overlapping word\/dword destinations/
  );
  await assert.rejects(
    () => extClient.writeRandomBitsExt({
      bitValues: [[String.raw`U1\M100`, true], [String.raw`U1\M100`, false]],
    }),
    /duplicate bit destinations/
  );
  assert.equal(calls, 0);
});

test("direct access does not use device-range upper bounds as a send guard", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    const data = calls === 1 ? Buffer.from([0x34, 0x12]) : Buffer.alloc(0);
    return { endCode: 0, data };
  };

  assert.deepEqual(await client.readDevices("D999999", 1), [0x1234]);
  await client.writeDevices("D999999", [0x5678]);
  assert.equal(calls, 2);
});

test("remote and memory helpers build expected commands", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const calls = [];
  client._request = async (command, subcommand, data, options = {}) => {
    calls.push({ command, subcommand, data: Buffer.from(data), expectResponse: options.expectResponse });
    return { endCode: 0, data: Buffer.from([0x64, 0x00, 0xc8, 0x00]) };
  };

  await client.remoteRun({ force: false, clearMode: RemoteClearMode.NO_CLEAR });
  await client.remoteStop();
  await client.remoteReset();
  const values = await client.memoryReadWords(0x100, 2);
  await client.memoryWriteWords(0x100, [100, 200]);

  assert.deepEqual(values, [100, 200]);
  assert.deepEqual(
    calls.map((call) => [call.command, call.subcommand, call.data.toString("hex"), call.expectResponse]),
    [
      [Command.REMOTE_RUN, 0x0000, "01000000", undefined],
      [Command.REMOTE_STOP, 0x0000, "0100", undefined],
      [Command.REMOTE_RESET, 0x0000, "0100", false],
      [Command.MEMORY_READ, 0x0000, "000100000200", undefined],
      [Command.MEMORY_WRITE, 0x0000, "0001000002006400c800", undefined],
    ]
  );
});

test("remoteStop rejects non-manual force option", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  await assert.rejects(
    () => client.remoteStop({ force: true }),
    (error) => error instanceof ValueError && /remoteStop does not support force/.test(error.message)
  );
});

test("remote RUN and PAUSE require explicit operation intent", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(() => client.remoteRun(), /options are required/);
  await assert.rejects(() => client.remoteRun({ clearMode: 0 }), /force is required/);
  await assert.rejects(() => client.remoteRun({ force: false }), /clearMode is required/);
  await assert.rejects(() => client.remoteRun({ force: 0, clearMode: 0 }), /force is required/);
  await assert.rejects(() => client.remotePause(), /options are required/);
  await assert.rejects(() => client.remotePause({}), /force is required/);
  await assert.rejects(() => client.remotePause({ force: 0 }), /force is required/);
  assert.deepEqual(RemoteClearMode, {
    NO_CLEAR: 0,
    CLEAR_EXCEPT_LATCH: 1,
    CLEAR_ALL: 2,
  });
  assert.equal(calls, 0);
});

test("remote RUN clear modes and RUN/PAUSE force choices have exact wire values", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push([command, subcommand, Buffer.from(data).toString("hex")]);
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.remoteRun({ force: false, clearMode: RemoteClearMode.NO_CLEAR });
  await client.remoteRun({ force: false, clearMode: RemoteClearMode.CLEAR_EXCEPT_LATCH });
  await client.remoteRun({ force: false, clearMode: RemoteClearMode.CLEAR_ALL });
  await client.remoteRun({ force: true, clearMode: RemoteClearMode.NO_CLEAR });
  await client.remotePause({ force: false });
  await client.remotePause({ force: true });

  assert.deepEqual(calls, [
    [Command.REMOTE_RUN, 0, "01000000"],
    [Command.REMOTE_RUN, 0, "01000100"],
    [Command.REMOTE_RUN, 0, "01000200"],
    [Command.REMOTE_RUN, 0, "03000000"],
    [Command.REMOTE_PAUSE, 0, "0100"],
    [Command.REMOTE_PAUSE, 0, "0300"],
  ]);
});

test("remoteReset rejects public subcommand and response-wait overrides before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  await assert.rejects(
    () => client.remoteReset({ subcommand: 0x0001 }),
    (error) => error instanceof ValueError && /does not accept subcommand/.test(error.message)
  );
});

test("configured remote password unlocks before lazy requests and locks on close", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    frameType: "3e",
    plcSeries: "iqr",
    remotePassword: "secret1",
    _allowManualProfile: true,
  });
  const calls = [];
  let transportOpen = false;

  client._connectTransport = async () => {
    if (!transportOpen) {
      calls.push({ kind: "connect" });
      transportOpen = true;
    }
  };
  client._hasOpenTransport = () => transportOpen;
  client._closeTransport = async () => {
    calls.push({ kind: "close" });
    transportOpen = false;
  };
  client._sendAndReceive = async (frame, _serial, options = {}, internalContext = null) => {
    if (!internalContext) {
      await client.connect();
    }
    calls.push({
      kind: "request",
      command: frame.readUInt16LE(11),
      subcommand: frame.readUInt16LE(13),
      data: frame.subarray(15).toString("hex"),
      managedLifecycleCommand: Boolean(internalContext),
    });
    return Buffer.from("d00000ffff030002000000", "hex");
  };

  await client.remoteStop();
  await client.close();

  assert.deepEqual(calls, [
    { kind: "connect" },
    {
      kind: "request",
      command: Command.REMOTE_PASSWORD_UNLOCK,
      subcommand: 0x0000,
      data: "070073656372657431",
      managedLifecycleCommand: true,
    },
    {
      kind: "request",
      command: Command.REMOTE_STOP,
      subcommand: 0x0000,
      data: "0100",
      managedLifecycleCommand: false,
    },
    {
      kind: "request",
      command: Command.REMOTE_PASSWORD_LOCK,
      subcommand: 0x0000,
      data: "070073656372657431",
      managedLifecycleCommand: true,
    },
    { kind: "close" },
  ]);
});

test("concurrent remote password requests wait for the same unlock", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    frameType: "4e",
    plcSeries: "iqr",
    remotePassword: "secret1",
    _allowManualProfile: true,
  });
  const commands = [];
  let transportOpen = false;

  client._connectTransport = async () => {
    transportOpen = true;
  };
  client._hasOpenTransport = () => transportOpen;
  client._closeTransport = async () => {
    transportOpen = false;
  };
  client._sendAndReceive = async (frame, serial, options = {}, internalContext = null) => {
    if (!internalContext) {
      await client.connect();
    }
    const command = frame.readUInt16LE(15);
    commands.push(command);
    if (command === Command.REMOTE_PASSWORD_UNLOCK) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const response = Buffer.from("d4000000000000ffff030002000000", "hex");
    response.writeUInt16LE(serial, 2);
    return response;
  };

  await Promise.all([client.remoteStop(), client.remotePause({ force: false })]);

  assert.equal(commands.filter((command) => command === Command.REMOTE_PASSWORD_UNLOCK).length, 1);
  assert.equal(commands[0], Command.REMOTE_PASSWORD_UNLOCK);
  const observedRemoteCommands = commands.slice(1).sort((left, right) => left - right);
  const expectedRemoteCommands = [Command.REMOTE_STOP, Command.REMOTE_PAUSE].sort((left, right) => left - right);
  assert.deepEqual(observedRemoteCommands, expectedRemoteCommands);
});

test("configured remote password unlock reports password errors clearly", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    frameType: "3e",
    plcSeries: "iqr",
    remotePassword: "123456",
    _allowManualProfile: true,
  });
  let transportOpen = false;
  let closed = false;

  client._connectTransport = async () => {
    transportOpen = true;
  };
  client._hasOpenTransport = () => transportOpen;
  client._closeTransport = async () => {
    closed = true;
    transportOpen = false;
  };
  client._sendAndReceive = async (frame, _serial, options = {}, internalContext = null) => {
    if (!internalContext) {
      await client.connect();
    }
    assert.equal(frame.readUInt16LE(11), Command.REMOTE_PASSWORD_UNLOCK);
    return Buffer.from("d00000ffff0300020010c8", "hex");
  };

  await assert.rejects(
    () => client.remoteStop(),
    (error) =>
      error instanceof SlmpError &&
      error.endCode === 0xc810 &&
      error.endCodeName === "slmp_end_code_c810" &&
      /Remote password unlock failed/.test(error.message) &&
      !("endCodeMessage" in error) &&
      error.isRemotePasswordError &&
      /end_code=0xC810/.test(error.cause?.rawMessage)
  );
  assert.equal(closed, true);
});

test("request reports remote password lock errors clearly", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    frameType: "3e",
    plcSeries: "iqr",
    _allowManualProfile: true,
  });

  client._connectTransport = async () => {};
  client._hasOpenTransport = () => true;
  client._sendAndReceive = async () => Buffer.from("d00000ffff0300020001c2", "hex");

  await assert.rejects(
    () => client.readDevices("D100", 1),
    (error) =>
      error instanceof SlmpError &&
      error.endCode === 0xc201 &&
      error.command === Command.DEVICE_READ &&
      error.endCodeName === "slmp_end_code_c201" &&
      /SLMP error end_code=0xC201/.test(error.message) &&
      !("endCodeMessage" in error) &&
      error.isRemotePasswordError &&
      /end_code=0xC201/.test(error.rawMessage)
  );
});

test("remote password end-code helper classifies password codes", () => {
  assert.equal(getEndCodeName(0xc201), "slmp_end_code_c201");
  assert.equal(getEndCodeName(0xc810), "slmp_end_code_c810");
  assert.equal(getEndCodeName(0xd913), "slmp_end_code_d913");
  assert.equal(getEndCodeName(0xdead), "slmp_end_code_dead");
  assert.equal(isRemotePasswordEndCode(0xc201), true);
  assert.equal(isRemotePasswordEndCode(0xc810), true);
  assert.equal(isRemotePasswordEndCode(0xc814), true);
  assert.equal(isRemotePasswordEndCode(0xc051), false);
});

test("remote password authentication retry delay codes keep numeric diagnostics", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    frameType: "3e",
    plcSeries: "iqr",
    _allowManualProfile: true,
  });

  client._connectTransport = async () => {};
  client._hasOpenTransport = () => true;

  const cases = [
    [0xc811, /end_code=0xC811/],
    [0xc812, /end_code=0xC812/],
    [0xc813, /end_code=0xC813/],
    [0xc814, /end_code=0xC814/],
    [0xc815, /end_code=0xC815/],
  ];

  for (const [endCode, messagePattern] of cases) {
    client._sendAndReceive = async () => {
      const response = Buffer.from("d00000ffff030002000000", "hex");
      response.writeUInt16LE(endCode, 9);
      return response;
    };

    await assert.rejects(
      () => client.readDevices("D100", 1),
      (error) => error instanceof SlmpError && error.endCode === endCode && messagePattern.test(error.message)
    );
  }
});

test("extend unit helpers build expected commands", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: Buffer.from([0x6f, 0x00, 0xde, 0x00]) };
  };

  const values = await client.extendUnitReadWords(0x10, 2, 0x03e0);
  await client.extendUnitWriteWords(0x10, 0x03e0, [111, 222]);

  assert.deepEqual(values, [111, 222]);
  assert.deepEqual(
    calls.map((call) => [call.command, call.subcommand, call.data.toString("hex")]),
    [
      [Command.EXTEND_UNIT_READ, 0x0000, "100000000400e003"],
      [Command.EXTEND_UNIT_WRITE, 0x0000, "100000000400e0036f00de00"],
    ]
  );
});

test("label helpers build payloads and parse responses", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    if (command === Command.LABEL_ARRAY_READ) {
      return { endCode: 0, data: Buffer.from([0x01, 0x00, 0x09, 0x01, 0x02, 0x00, 0xaa, 0xbb]) };
    }
    if (command === Command.LABEL_READ_RANDOM) {
      return { endCode: 0, data: Buffer.from([0x01, 0x00, 0x09, 0x00, 0x02, 0x00, 0x31, 0x00]) };
    }
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  const randomValues = await client.readRandomLabels(["LabelW"]);
  await client.writeRandomLabels([{ label: "LabelW", data: Buffer.from([0x31, 0x00]) }]);
  const arrayValues = await client.readArrayLabels([{ label: "LabelW", unitSpecification: 1, arrayDataLength: 2 }]);
  await client.writeArrayLabels([{ label: "LabelW", unitSpecification: 1, arrayDataLength: 2, data: Buffer.from([0xaa, 0xbb]) }]);

  assert.equal(randomValues[0].readDataLength, 2);
  assert.deepEqual([...randomValues[0].data], [0x31, 0x00]);
  assert.equal(arrayValues[0].arrayDataLength, 2);
  assert.deepEqual([...arrayValues[0].data], [0xaa, 0xbb]);
  assert.deepEqual(
    calls.map((call) => [call.command, call.subcommand, call.data.toString("hex")]),
    [
      [Command.LABEL_READ_RANDOM, 0x0000, "0100000006004c006100620065006c005700"],
      [Command.LABEL_WRITE_RANDOM, 0x0000, "0100000006004c006100620065006c00570002003100"],
      [Command.LABEL_ARRAY_READ, 0x0000, "0100000006004c006100620065006c00570001000200"],
      [Command.LABEL_ARRAY_WRITE, 0x0000, "0100000006004c006100620065006c00570001000200aabb"],
    ]
  );
});

test("remoteReset closes the send-only transport generation", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  let sent = 0;
  let closed = 0;
  client.connect = async () => undefined;
  client._transport = {
    nextSerial() { return 0; },
    async sendOnly() { sent += 1; },
    async close() { closed += 1; },
    hasOpenTransport() { return true; },
    connectionGeneration() { return 1; },
  };

  await client.remoteReset();

  assert.equal(sent, 1);
  assert.equal(closed, 1);
});

test("label abbreviation omission and references are validated before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: Buffer.from([0x01, 0x00, 0x09, 0x00, 0x00, 0x00]) };
  };

  await client.readRandomLabels(["%2.Member"], { abbreviationLabels: ["RootA", "RootB"] });
  assert.deepEqual([...calls[0].data.subarray(0, 4)], [1, 0, 2, 0]);

  const invalidCalls = [
    () => client.readRandomLabels(["%"], { abbreviationLabels: ["Root"] }),
    () => client.readArrayLabels(
      [{ label: "%2.Member", unitSpecification: 1, arrayDataLength: 1 }],
      { abbreviationLabels: ["Root"] }
    ),
    () => client.writeArrayLabels(
      [{ label: "%0.Member", unitSpecification: 1, arrayDataLength: 1, data: Buffer.from([0]) }],
      { abbreviationLabels: ["Root"] }
    ),
    () => client.writeRandomLabels(
      [{ label: "%x.Member", data: Buffer.from([0]) }],
      { abbreviationLabels: ["Root"] }
    ),
  ];
  for (const invoke of invalidCalls) {
    await assert.rejects(invoke, (error) => error instanceof ValueError && /invalid abbreviation reference/.test(error.message));
  }
  for (const abbreviationLabels of [null, false, "Root", [123]]) {
    await assert.rejects(
      () => client.readRandomLabels(["FullLabel"], { abbreviationLabels }),
      (error) => error instanceof ValueError && /abbreviation/.test(error.message)
    );
  }
  await assert.rejects(
    () => client.readRandomLabels(["FullLabel"], { abbreviationLabels: new Array(65536).fill("Root") }),
    (error) => error instanceof ValueError && /abbreviation label count/.test(error.message)
  );
  assert.equal(calls.length, 1);
});

test("readDevices rejects non-4-word long timer current reads before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
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
  client._request = async () => {
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
  client._request = async () => {
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
  client._request = async () => {
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
  client._request = async () => {
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
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.readBlock({ bitBlocks: [["LCS10", 1]] }),
    (error) => error instanceof ValueError && /Read Block \(0x0406\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

for (const profile of ["melsec:lcpu", "melsec:qnu"]) {
  test(`readBlock rejects ${profile} profile before transport`, async () => {
    const client = new SlmpClient({ host: "127.0.0.1", plcProfile: profile });
    let calls = 0;
    client._request = async () => {
      calls += 1;
      return { endCode: 0, data: Buffer.alloc(0) };
    };

    await assert.rejects(
      () => client.readBlock({ wordBlocks: [["D100", 1]], bitBlocks: [["M100", 1]] }),
      (error) =>
        error instanceof SlmpProfileFeatureError &&
        error.profileId === profile &&
        error.featureKey === "block" &&
        error.state === "blocked"
    );
    assert.equal(calls, 0);
  });
}

test("readBlock rejects LCN and LZ block routes before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
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
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeBlock({ bitBlocks: [["LCC10", [1]]] }),
    (error) => error instanceof ValueError && /Write Block \(0x1406\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

for (const profile of ["melsec:lcpu", "melsec:qnu"]) {
  test(`writeBlock rejects ${profile} profile before transport`, async () => {
    const client = new SlmpClient({ host: "127.0.0.1", plcProfile: profile });
    let calls = 0;
    client._request = async () => {
      calls += 1;
      return { endCode: 0, data: Buffer.alloc(0) };
    };

    await assert.rejects(
      () => client.writeBlock({ wordBlocks: [["D100", [1]]], bitBlocks: [["M100", [1]]] }),
      (error) =>
        error instanceof SlmpProfileFeatureError &&
        error.profileId === profile &&
        error.featureKey === "block" &&
        error.state === "blocked"
    );
    assert.equal(calls, 0);
  });
}

test("writeBlock inlines each block's data after its own spec", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let captured;
  client._request = async (command, subcommand, data) => {
    captured = { command, subcommand, data: Buffer.from(data) };
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.writeBlock({
    wordBlocks: [["D300", [0x1111, 0x2222]]],
    bitBlocks: [["M200", [0x00ff]]],
  });

  assert.equal(captured.command, Command.DEVICE_WRITE_BLOCK);
  assert.equal(captured.subcommand, 0x0002);
  assert.equal(
    captured.data.toString("hex"),
    Buffer.concat([
      Buffer.from([0x01, 0x01]),
      encodeDeviceSpec("D300", { series: "iqr" }),
      Buffer.from([0x02, 0x00, 0x11, 0x11, 0x22, 0x22]),
      encodeDeviceSpec("M200", { series: "iqr" }),
      Buffer.from([0x01, 0x00, 0xff, 0x00]),
    ]).toString("hex")
  );
});

test("writeBlock rejects long current and LZ block routes before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._request = async () => {
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
    () => client._request(Command.MONITOR_REGISTER, 0x0002, payload),
    (error) => error instanceof ValueError && /Entry Monitor Device \(0x0801\) does not support LCS\/LCC/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("request rejects monitor register payloads with G/HG before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let calls = 0;
  client._requestInternal = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };
  const payload = Buffer.concat([Buffer.from([0x01, 0x00]), Buffer.from([0x0a, 0x00, 0x00, 0x00, 0xab, 0x00])]);

  assert.throws(
    () => client._request(Command.MONITOR_REGISTER, 0x0002, payload),
    (error) => error instanceof ValueError && /Entry Monitor Device \(0x0801\) does not support standalone G\/HG/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("selfTestLoopback validates, sends one fixed command, and verifies the echo", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: Buffer.from([0x04, 0x00, 0x41, 0x31, 0x42, 0x32]) };
  };

  assert.deepEqual(await client.selfTestLoopback(Buffer.from("A1B2", "ascii")), Buffer.from("A1B2", "ascii"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, Command.SELF_TEST);
  assert.equal(calls[0].subcommand, 0);
  assert.equal(calls[0].data.toString("hex"), "040041314232");

  for (const invalid of [Buffer.alloc(0), Buffer.from("abcd"), Buffer.from("HELLO"), "A1B2"]) {
    await assert.rejects(() => client.selfTestLoopback(invalid), /selfTestLoopback/);
  }
  assert.equal(calls.length, 1);
});

test("selfTestLoopback verifies the transmitted snapshot when caller data changes", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  let releaseResponse;
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  let transmitted;
  client._request = async (_command, _subcommand, data) => {
    transmitted = Buffer.from(data);
    await responseGate;
    return { endCode: 0, data: Buffer.from(transmitted) };
  };
  const callerData = Buffer.from("A1B2", "ascii");

  const pending = client.selfTestLoopback(callerData);
  callerData.fill(0x46);
  releaseResponse();

  assert.deepEqual(await pending, Buffer.from("A1B2", "ascii"));
  assert.equal(transmitted.toString("hex"), "040041314232");
});

test("selfTestLoopback rejects malformed echo responses", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const responses = [
    Buffer.from([0x04]),
    Buffer.from([0x03, 0x00, 0x41, 0x31, 0x42, 0x32]),
    Buffer.from([0x04, 0x00, 0x41, 0x31, 0x42]),
    Buffer.from([0x04, 0x00, 0x41, 0x31, 0x42, 0x33]),
  ];
  client._request = async () => ({ endCode: 0, data: responses.shift() });
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(() => client.selfTestLoopback(Buffer.from("A1B2")), SlmpError);
  }
});

test("clearError sends one fixed empty command", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.clearError();
  assert.deepEqual(calls, [{ command: Command.CLEAR_ERROR, subcommand: 0, data: Buffer.alloc(0) }]);
});

test("monitor semantic APIs register once and decode three cycles", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const calls = [];
  client._request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    if (command === Command.MONITOR) {
      return { endCode: 0, data: Buffer.from([0x11, 0x11, 0x78, 0x56, 0x34, 0x12]) };
    }
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.registerMonitorDevices({ wordDevices: ["D120"], dwordDevices: ["D200"] });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const result = await client.runMonitorCycle({ wordPoints: 1, dwordPoints: 1 });
    assert.deepEqual(result, { word: [0x1111], dword: [0x12345678] });
  }
  assert.equal(calls.length, 4);
  assert.equal(calls[0].command, Command.MONITOR_REGISTER);
  for (const call of calls.slice(1)) {
    assert.equal(call.command, Command.MONITOR);
    assert.equal(call.data.length, 0);
  }
});

test("extended monitor registration uses the qualified-device subcommand", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  let captured;
  client._request = async (command, subcommand, data) => {
    captured = { command, subcommand, data: Buffer.from(data) };
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.registerMonitorDevicesExt({ wordDevices: [String.raw`U3E0\HG0`] });
  assert.equal(captured.command, Command.MONITOR_REGISTER);
  assert.equal(captured.subcommand, 0x0082);
  assert.equal(captured.data[0], 1);
  assert.equal(captured.data[1], 0);
});

test("monitor semantic APIs reject incomplete counts before transport", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  let calls = 0;
  client._request = async () => { calls += 1; return { endCode: 0, data: Buffer.alloc(0) }; };

  await assert.rejects(() => client.registerMonitorDevices(), /must not both be empty/);
  await assert.rejects(() => client.runMonitorCycle({ wordPoints: 1 }), /required/);
  await assert.rejects(() => client.runMonitorCycle({ wordPoints: 0, dwordPoints: 0 }), /must not both be zero/);
  await assert.rejects(() => client.runMonitorCycle({ wordPoints: 97, dwordPoints: 0 }), /out of range/);
  assert.equal(calls, 0);
});

test("monitor semantic API propagates PLC errors and size mismatch without fallback", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const plcError = new SlmpError("PLC NG");
  let calls = 0;
  client._request = async () => {
    calls += 1;
    throw plcError;
  };

  await assert.rejects(() => client.runMonitorCycle({ wordPoints: 1, dwordPoints: 0 }), (error) => error === plcError);
  assert.equal(calls, 1);

  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.from([0x11]) };
  };
  await assert.rejects(
    () => client.runMonitorCycle({ wordPoints: 1, dwordPoints: 0 }),
    /monitor response size mismatch/
  );
  assert.equal(calls, 2);
});

test("clearError propagates one PLC error without another command", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r" });
  const plcError = new SlmpError("PLC NG");
  let calls = 0;
  client._request = async () => {
    calls += 1;
    throw plcError;
  };

  await assert.rejects(() => client.clearError(), (error) => error === plcError);
  assert.equal(calls, 1);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  assert.equal(predicate(), true);
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    }),
  ]);
}

function startMockTcpServer(frameType, onFrame) {
  const sockets = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (true) {
        const extracted = extractFrameFromBuffer(buffer, { frameType });
        if (!extracted) {
          return;
        }
        buffer = Buffer.from(extracted.rest);
        onFrame({ frame: Buffer.from(extracted.frame), socket });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port: server.address().port,
        sockets,
        close: () =>
          new Promise((closeResolve) => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

function responseForRequest(frame, frameType, data, endCode = 0) {
  const responseData = endCode === 0 ? data : errorDataForRequest(frame, frameType, data);
  if (frameType === "4e") {
    return make4EResponse(frame.readUInt16LE(2), responseData, endCode);
  }
  return make3EResponse(responseData, endCode);
}

function errorDataForRequest(frame, frameType, data) {
  const source = Buffer.from(frame);
  const targetOffset = frameType === "4e" ? 6 : 2;
  const commandOffset = frameType === "4e" ? 15 : 11;
  const errorInfo = Buffer.alloc(9);
  source.copy(errorInfo, 0, targetOffset, targetOffset + 5);
  source.copy(errorInfo, 5, commandOffset, commandOffset + 4);
  return Buffer.concat([errorInfo, Buffer.from(data)]);
}

function requestPayload(frame, frameType) {
  const source = Buffer.from(frame);
  const dataOffset = frameType === "4e" ? 19 : 15;
  return source.subarray(dataOffset);
}

function readRequestTarget(frame) {
  return {
    network: frame.readUInt8(6),
    station: frame.readUInt8(7),
    moduleIO: frame.readUInt16LE(8),
    multidrop: frame.readUInt8(10),
  };
}

function make4EResponse(serial, data, endCode = 0) {
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
  buffer.writeUInt16LE(endCode, 13);
  payload.copy(buffer, 15);
  return buffer;
}

function make3EResponse(data, endCode = 0) {
  const payload = Buffer.from(data);
  const buffer = Buffer.alloc(11 + payload.length);
  buffer.writeUInt16LE(0x00d0, 0);
  buffer.writeUInt8(0x00, 2);
  buffer.writeUInt8(0xff, 3);
  buffer.writeUInt16LE(0x03ff, 4);
  buffer.writeUInt8(0x00, 6);
  buffer.writeUInt16LE(2 + payload.length, 7);
  buffer.writeUInt16LE(endCode, 9);
  payload.copy(buffer, 11);
  return buffer;
}
