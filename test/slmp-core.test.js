"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Command,
  getEndCodeMessage,
  getEndCodeName,
  isRemotePasswordEndCode,
  SlmpError,
  SlmpClient,
  ValueError,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeRequest,
  isDeviceCodeSupportedForFamily,
  packBitValues,
  parseDevice,
  resolveConnectionProfile,
  unpackBitValues,
} = require("../lib/slmp");

test("parseDevice handles decimal and hex devices", () => {
  assert.deepEqual(parseDevice("D100"), { code: "D", number: 100 });
  assert.deepEqual(parseDevice("X1F"), { code: "X", number: 31 });
  assert.deepEqual(parseDevice("XFF"), { code: "X", number: 0xff });
  assert.deepEqual(parseDevice("SWFF"), { code: "SW", number: 0xff });
  assert.equal(deviceToString({ code: "X", number: 31 }), "X1F");
  assert.throws(() => parseDevice("DFFFF"), /device code 'D'/);
});

test("parseDevice uses octal X/Y numbering for iq-f when plcFamily is explicit", () => {
  assert.deepEqual(parseDevice("X217", { plcFamily: "iq-f" }), { code: "X", number: 0x8f });
  assert.equal(deviceToString({ code: "Y", number: 0x90 }, { plcFamily: "iq-f" }), "Y220");
});

test("parseDevice rejects device codes that are unsupported by the explicit PLC family", () => {
  assert.deepEqual(parseDevice("LZ0", { plcFamily: "iq-f" }), { code: "LZ", number: 0 });
  assert.deepEqual(parseDevice("LTS10", { plcFamily: "iq-r" }), { code: "LTS", number: 10 });
  assert.throws(() => parseDevice("V10", { plcFamily: "iq-f" }), /not supported for plcFamily 'iq-f'/);
  assert.throws(() => parseDevice("DX10", { plcFamily: "iq-f" }), /not supported for plcFamily 'iq-f'/);
  assert.throws(() => parseDevice("DY10", { plcFamily: "iq-f" }), /not supported for plcFamily 'iq-f'/);
  assert.throws(() => parseDevice("LCS10", { plcFamily: "lcpu" }), /not supported for plcFamily 'lcpu'/);
  assert.throws(() => parseDevice("RD10", { plcFamily: "qnudv" }), /not supported for plcFamily 'qnudv'/);
  assert.throws(() => parseDevice("LZ0", { plcFamily: "qnu" }), /not supported for plcFamily 'qnu'/);
  assert.throws(() => parseDevice("G10", { plcFamily: "iq-r" }), /not supported for plcFamily 'iq-r'/);
  assert.equal(isDeviceCodeSupportedForFamily("LZ", "qnudv"), false);
  assert.equal(isDeviceCodeSupportedForFamily("G", "qnu"), false);
});

test("resolveConnectionProfile derives fixed defaults from plcFamily", () => {
  const profile = resolveConnectionProfile({ plcFamily: "iq-l" });
  assert.deepEqual(profile, {
    plcFamily: "iq-l",
    plcSeries: "iqr",
    frameType: "4e",
    deviceFamily: "iq-r",
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

  const raw = await client._sendAndReceive(request, 0x2222, { skipRemotePasswordLifecycle: true });
  const decoded = decodeResponse(raw, { frameType: "4e" });

  assert.deepEqual([...writes[0]], [...request]);
  assert.equal(decoded.serial, 0x2222);
  assert.deepEqual([...decoded.data], [0x44, 0x55]);
});

test("3E TCP frame extraction queues combined response chunks in order", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });

  client._handleTcpData(Buffer.concat([make3EResponse([0x11, 0x11]), make3EResponse([0x22, 0x22])]));

  const first = decodeResponse(await client._awaitTcpFrame(0), { frameType: "3e" });
  const second = decodeResponse(await client._awaitTcpFrame(1), { frameType: "3e" });
  assert.deepEqual([...first.data], [0x11, 0x11]);
  assert.deepEqual([...second.data], [0x22, 0x22]);
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

test("4E TCP response matching queues unmatched serials for later waits", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", _allowManualProfile: true });

  client._handleTcpData(make4EResponse(0x1002, [0x22, 0x22]));

  const queued = await client._awaitTcpFrame(0x1002);
  const decoded = decodeResponse(queued, { frameType: "4e" });
  assert.equal(decoded.serial, 0x1002);
  assert.deepEqual([...decoded.data], [0x22, 0x22]);
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

test("remote and memory helpers build expected commands", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "3e", _allowManualProfile: true });
  const calls = [];
  client.request = async (command, subcommand, data, options = {}) => {
    calls.push({ command, subcommand, data: Buffer.from(data), expectResponse: options.expectResponse });
    return { endCode: 0, data: Buffer.from([0x64, 0x00, 0xc8, 0x00]) };
  };

  await client.remoteRun();
  await client.remoteStop();
  await client.remoteStop({ force: true });
  await client.remoteReset();
  const values = await client.memoryReadWords(0x100, 2);
  await client.memoryWriteWords(0x100, [100, 200]);

  assert.deepEqual(values, [100, 200]);
  assert.deepEqual(
    calls.map((call) => [call.command, call.subcommand, call.data.toString("hex"), call.expectResponse]),
    [
      [Command.REMOTE_RUN, 0x0000, "01000000", undefined],
      [Command.REMOTE_STOP, 0x0000, "0100", undefined],
      [Command.REMOTE_STOP, 0x0000, "0300", undefined],
      [Command.REMOTE_RESET, 0x0000, "", false],
      [Command.MEMORY_READ, 0x0000, "000100000200", undefined],
      [Command.MEMORY_WRITE, 0x0000, "0001000002006400c800", undefined],
    ]
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
  client._sendAndReceive = async (frame, _serial, options = {}) => {
    await client.connect({ skipRemotePasswordLifecycle: Boolean(options.skipRemotePasswordLifecycle) });
    calls.push({
      kind: "request",
      command: frame.readUInt16LE(11),
      subcommand: frame.readUInt16LE(13),
      data: frame.subarray(15).toString("hex"),
      skipRemotePasswordLifecycle: Boolean(options.skipRemotePasswordLifecycle),
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
      skipRemotePasswordLifecycle: true,
    },
    {
      kind: "request",
      command: Command.REMOTE_STOP,
      subcommand: 0x0000,
      data: "0100",
      skipRemotePasswordLifecycle: false,
    },
    {
      kind: "request",
      command: Command.REMOTE_PASSWORD_LOCK,
      subcommand: 0x0000,
      data: "070073656372657431",
      skipRemotePasswordLifecycle: true,
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
    allowConcurrentRequests: true,
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
  client._sendAndReceive = async (frame, serial, options = {}) => {
    await client.connect({ skipRemotePasswordLifecycle: Boolean(options.skipRemotePasswordLifecycle) });
    const command = frame.readUInt16LE(15);
    commands.push(command);
    if (command === Command.REMOTE_PASSWORD_UNLOCK) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const response = Buffer.from("d4000000000000ffff030002000000", "hex");
    response.writeUInt16LE(serial, 2);
    return response;
  };

  await Promise.all([client.remoteStop(), client.remotePause()]);

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
  client._sendAndReceive = async (frame, _serial, options = {}) => {
    await client.connect({ skipRemotePasswordLifecycle: Boolean(options.skipRemotePasswordLifecycle) });
    assert.equal(frame.readUInt16LE(11), Command.REMOTE_PASSWORD_UNLOCK);
    return Buffer.from("d00000ffff0300020010c8", "hex");
  };

  await assert.rejects(
    () => client.remoteStop(),
    (error) =>
      error instanceof SlmpError &&
      error.endCode === 0xc810 &&
      error.endCodeName === "slmp_end_code_c810" &&
      /Remote password authentication has failed/.test(error.message) &&
      /Set a correct password and retry/.test(error.endCodeMessage) &&
      error.isRemotePasswordError &&
      /end_code=0xC810/.test(error.rawMessage)
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
      /remote password status/.test(error.message) &&
      /lock status/.test(error.endCodeMessage) &&
      error.isRemotePasswordError &&
      /end_code=0xC201/.test(error.rawMessage)
  );
});

test("remote password end-code helper classifies password codes", () => {
  assert.equal(getEndCodeName(0xc201), "slmp_end_code_c201");
  assert.equal(getEndCodeName(0xc810), "slmp_end_code_c810");
  assert.equal(getEndCodeName(0xd913), "slmp_end_code_d913");
  assert.equal(getEndCodeName(0xdead), "unknown_plc_end_code");
  assert.equal(
    getEndCodeMessage(0xc810),
    "Remote password authentication has failed when required. Set a correct password and retry."
  );
  assert.equal(getEndCodeMessage(0xd913), "An error was detected in the network module.");
  assert.equal(getEndCodeMessage(0xdead), undefined);
  assert.equal(isRemotePasswordEndCode(0xc201), true);
  assert.equal(isRemotePasswordEndCode(0xc810), true);
  assert.equal(isRemotePasswordEndCode(0xc814), true);
  assert.equal(isRemotePasswordEndCode(0xc051), false);
});

test("remote password authentication retry delay messages are code-specific", async () => {
  const client = new SlmpClient({
    host: "127.0.0.1",
    frameType: "3e",
    plcSeries: "iqr",
    _allowManualProfile: true,
  });

  client._connectTransport = async () => {};
  client._hasOpenTransport = () => true;

  const cases = [
    [0xc811, /retry after 1 minute/],
    [0xc812, /retry after 5 minutes/],
    [0xc813, /retry after 15 minutes/],
    [0xc814, /retry after 60 minutes/],
    [0xc815, /retry after 60 minutes/],
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
  client.request = async (command, subcommand, data) => {
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
  client.request = async (command, subcommand, data) => {
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

test("writeBlock inlines each block's data after its own spec", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", frameType: "4e", plcSeries: "iqr", _allowManualProfile: true });
  let captured;
  client.request = async (command, subcommand, data) => {
    captured = { command, subcommand, data: Buffer.from(data) };
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.writeBlock({
    wordBlocks: [["D300", [0x1111, 0x2222]]],
    bitBlocks: [["M200", [0x00ff]]],
    series: "iqr",
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

function make3EResponse(data) {
  const payload = Buffer.from(data);
  const buffer = Buffer.alloc(11 + payload.length);
  buffer.writeUInt16LE(0x00d0, 0);
  buffer.writeUInt8(0x00, 2);
  buffer.writeUInt8(0xff, 3);
  buffer.writeUInt16LE(0x03ff, 4);
  buffer.writeUInt8(0x00, 6);
  buffer.writeUInt16LE(2 + payload.length, 7);
  buffer.writeUInt16LE(0x0000, 9);
  payload.copy(buffer, 11);
  return buffer;
}
