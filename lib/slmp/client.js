"use strict";

const dgram = require("dgram");
const net = require("net");

const { Command, FrameType, PLCSeries } = require("./constants");
const {
  ValueError,
  decodeDeviceDwords,
  decodeDeviceWords,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeRequest,
  extractFrameFromBuffer,
  normalizeFrameType,
  normalizePlcFamily,
  normalizePlcSeries,
  normalizeTarget,
  normalizeTransport,
  packBitValues,
  parseDevice,
  requireExplicitDeviceFamilyForXY,
  resolveConnectionProfile,
  resolveDeviceSubcommand,
  unpackBitValues,
} = require("./core");
const { SlmpError } = require("./errors");

const LONG_TIMER_STATE_DIRECT_CODES = new Set(["LTS", "LTC", "LSTS", "LSTC"]);
const LONG_FAMILY_STATE_WRITE_DIRECT_CODES = new Set(["LTS", "LTC", "LSTS", "LSTC", "LCS", "LCC"]);
const LONG_TIMER_CURRENT_BLOCK_CODES = new Set(["LTN", "LSTN"]);
const LONG_CURRENT_VALUE_CODES = new Set(["LTN", "LSTN", "LCN"]);
const DWORD_ONLY_DIRECT_CODES = new Set(["LZ"]);
const LONG_COUNTER_CONTACT_CODES = new Set(["LCS", "LCC"]);
const RANDOM_DWORD_ONLY_CODES = new Set(["LCN", "LZ"]);
const SlmpCpuOperationStatus = Object.freeze({
  Unknown: "Unknown",
  Run: "Run",
  Stop: "Stop",
  Pause: "Pause",
});

function validateDirectReadDevice(ref, points, bitUnit) {
  if (bitUnit && LONG_TIMER_STATE_DIRECT_CODES.has(ref.code)) {
    throw new ValueError(
      `Direct bit read is not supported for ${ref.code}. Use readTyped/readNamed or the 4-word status block helpers instead.`
    );
  }
  if (!bitUnit && LONG_TIMER_CURRENT_BLOCK_CODES.has(ref.code) && points % 4 !== 0) {
    throw new ValueError(
      `Direct read of ${ref.code} requires 4-word blocks. Requested points=${points}; use a multiple of 4 or the long timer helpers.`
    );
  }
  if (!bitUnit && RANDOM_DWORD_ONLY_CODES.has(ref.code)) {
    throw new ValueError(`Direct word read is not supported for ${ref.code}. Use readTyped/readNamed for 32-bit access.`);
  }
}

function validateDirectWriteDevice(ref, bitUnit) {
  if (bitUnit && LONG_FAMILY_STATE_WRITE_DIRECT_CODES.has(ref.code)) {
    throw new ValueError(
      `Direct bit write is not supported for ${ref.code}. Use writeTyped/writeNamed so random bit write (0x1402) is selected.`
    );
  }
  if (!bitUnit && (LONG_CURRENT_VALUE_CODES.has(ref.code) || DWORD_ONLY_DIRECT_CODES.has(ref.code))) {
    throw new ValueError(
      `Direct word write is not supported for ${ref.code}. Use writeTyped/writeNamed for 32-bit access.`
    );
  }
}

function validateRandomReadDevices(wordDevices, dwordDevices) {
  if ([...wordDevices, ...dwordDevices].some((device) => LONG_TIMER_STATE_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      "Read Random (0x0403) does not support LTS/LTC/LSTS/LSTC. Use readTyped/readNamed or the long timer status helpers instead."
    );
  }
  if ([...wordDevices, ...dwordDevices].some((device) => LONG_COUNTER_CONTACT_CODES.has(device.code))) {
    throw new ValueError(
      "Read Random (0x0403) does not support LCS/LCC. Use readTyped/readNamed so direct bit read is selected."
    );
  }
  if (wordDevices.some((device) => LONG_CURRENT_VALUE_CODES.has(device.code) || DWORD_ONLY_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      "Read Random (0x0403) does not support LTN/LSTN/LCN/LZ as word entries. Use dword entries or readTyped/readNamed with ':D' or ':L' instead."
    );
  }
}

function validateRandomWriteWordDevices(wordDevices) {
  if (wordDevices.some((device) => LONG_CURRENT_VALUE_CODES.has(device.code) || DWORD_ONLY_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      "Write Random (0x1402) does not support LTN/LSTN/LCN/LZ as word entries. Use dword entries or writeTyped/writeNamed with ':D' or ':L' instead."
    );
  }
}

function validateBlockReadDevices(wordBlocks, bitBlocks) {
  const invalidLongCurrentBlock = wordBlocks.find((block) => LONG_TIMER_CURRENT_BLOCK_CODES.has(block.device.code) && block.points % 4 !== 0);
  if (invalidLongCurrentBlock) {
    throw new ValueError(
      `Read Block (0x0406) direct read of ${invalidLongCurrentBlock.device.code} requires 4-word blocks. Requested points=${invalidLongCurrentBlock.points}; use readTyped/readNamed for 32-bit current values.`
    );
  }
  if ([...wordBlocks, ...bitBlocks].some((block) => RANDOM_DWORD_ONLY_CODES.has(block.device.code))) {
    throw new ValueError(
      "Read Block (0x0406) does not support LCN/LZ as word or bit blocks. Use readTyped/readNamed so random dword read is selected."
    );
  }
  if ([...wordBlocks, ...bitBlocks].some((block) => LONG_COUNTER_CONTACT_CODES.has(block.device.code))) {
    throw new ValueError(
      "Read Block (0x0406) does not support LCS/LCC. Use readTyped/readNamed so direct bit read is selected."
    );
  }
}

function validateBlockWriteDevices(wordBlocks, bitBlocks) {
  if ([...wordBlocks, ...bitBlocks].some((block) => LONG_CURRENT_VALUE_CODES.has(block.device.code) || DWORD_ONLY_DIRECT_CODES.has(block.device.code))) {
    throw new ValueError(
      "Write Block (0x1406) does not support LTN/LSTN/LCN/LZ as word or bit blocks. Use writeTyped/writeNamed with ':D' or ':L' instead."
    );
  }
  if ([...wordBlocks, ...bitBlocks].some((block) => LONG_COUNTER_CONTACT_CODES.has(block.device.code))) {
    throw new ValueError(
      "Write Block (0x1406) does not support LCS/LCC. Use writeTyped/writeNamed so random bit write (0x1402) is selected."
    );
  }
}

function validateMonitorRegisterRequest(command, subcommand, data, series) {
  if (command !== Command.MONITOR_REGISTER || ![0x0000, 0x0002].includes(subcommand)) {
    return;
  }

  const payload = Buffer.from(data || Buffer.alloc(0));
  if (payload.length < 2) {
    return;
  }

  const specSize = series === PLCSeries.IQR ? 6 : 4;
  const wordCount = payload.readUInt8(0);
  const dwordCount = payload.readUInt8(1);
  const totalCount = wordCount + dwordCount;
  const expectedLength = 2 + totalCount * specSize;
  if (payload.length < expectedLength) {
    return;
  }

  let offset = 2;
  for (let index = 0; index < totalCount; index += 1) {
    const code = series === PLCSeries.IQR ? payload.readUInt16LE(offset + 4) : payload.readUInt8(offset + 3);
    if (code === 0x0054 || code === 0x0055) {
      throw new ValueError(
        "Entry Monitor Device (0x0801) does not support LCS/LCC. Use readTyped/readNamed so direct bit read is selected."
      );
    }
    offset += specSize;
  }
}

function decodeCpuOperationState(statusWord) {
  const rawStatusWord = Number(statusWord) & 0xffff;
  const rawCode = rawStatusWord & 0x000f;
  let status = SlmpCpuOperationStatus.Unknown;
  if (rawCode === 0x00) {
    status = SlmpCpuOperationStatus.Run;
  } else if (rawCode === 0x02) {
    status = SlmpCpuOperationStatus.Stop;
  } else if (rawCode === 0x03) {
    status = SlmpCpuOperationStatus.Pause;
  }
  return {
    status,
    rawStatusWord,
    rawCode,
  };
}

class SlmpClient {
  constructor(options) {
    const source = options || {};
    this.host = String(source.host || "").trim();
    this.port = source.port === undefined ? 5000 : Number(source.port);
    this.transportType = normalizeTransport(source.transport || "tcp");
    this.timeout = Number(source.timeout ?? 3000);
    this._allowManualProfile = Boolean(source._allowManualProfile);
    const profile = resolveConnectionProfile({
      plcFamily: source.plcFamily,
      plcSeries: source.plcSeries,
      frameType: source.frameType,
    }, { allowManualProfile: this._allowManualProfile });
    this.plcFamily = profile.plcFamily;
    this.plcSeries = profile.plcSeries;
    this.frameType = profile.frameType;
    this.deviceFamily = profile.deviceFamily;
    this.defaultTarget = normalizeTarget(source.defaultTarget || source.target);
    this.monitoringTimer = Number(source.monitoringTimer ?? 0x0010);
    this.raiseOnError = source.raiseOnError !== false;
    this.allowConcurrentRequests = Boolean(source.allowConcurrentRequests);

    if (!this.host) {
      throw new ValueError("host is required");
    }
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      throw new ValueError(`port out of range (1..65535): ${this.port}`);
    }
    if (!Number.isFinite(this.timeout) || this.timeout <= 0) {
      throw new ValueError(`timeout must be > 0: ${this.timeout}`);
    }

    this._serial = 0;
    this._requestChain = Promise.resolve();
    this._tcpSocket = null;
    this._tcpConnectPromise = null;
    this._tcpBuffer = Buffer.alloc(0);
    this._tcpPending = null;
    this._tcpFrames = [];
    this._tcpPendingBySerial = new Map();
    this._tcpFramesBySerial = new Map();
    this._udpSocket = null;
    this._udpConnectPromise = null;
    this._udpPending = null;
    this._udpPendingBySerial = new Map();
  }

  _parseDevice(device) {
    const ref = parseDevice(device, { family: this.deviceFamily, plcFamily: this.plcFamily });
    return requireExplicitDeviceFamilyForXY(device, this.plcFamily ?? this.deviceFamily, ref);
  }

  _deviceText(device) {
    return deviceToString(device, { family: this.deviceFamily });
  }

  async connect() {
    if (this.transportType === "tcp") {
      return this._connectTcp();
    }
    return this._connectUdp();
  }

  async close() {
    const pending = [];
    if (this._tcpSocket) {
      pending.push(
        new Promise((resolve) => {
          const socket = this._tcpSocket;
          this._tcpSocket = null;
          this._tcpConnectPromise = null;
          this._rejectTcpPending(new SlmpError("TCP connection closed"));
          socket.once("close", resolve);
          socket.destroy();
        })
      );
    }
    if (this._udpSocket) {
      pending.push(
        new Promise((resolve) => {
          const socket = this._udpSocket;
          this._udpSocket = null;
          this._udpConnectPromise = null;
          this._rejectUdpPending(new SlmpError("UDP socket closed"));
          socket.once("close", resolve);
          socket.close();
        })
      );
    }
    await Promise.allSettled(pending);
  }

  request(command, subcommand = 0x0000, data = Buffer.alloc(0), options = {}) {
    const normalizedSeries = options.series ? normalizePlcSeries(options.series) : this.plcSeries;
    validateMonitorRegisterRequest(Number(command), Number(subcommand), data, normalizedSeries);
    const allowConcurrent =
      this.frameType === FrameType.FRAME_4E &&
      (options.allowConcurrentRequests === undefined
        ? this.allowConcurrentRequests
        : Boolean(options.allowConcurrentRequests));

    if (allowConcurrent) {
      return this._requestInternal(command, subcommand, data, options);
    }
    const task = this._requestChain.then(() => this._requestInternal(command, subcommand, data, options));
    this._requestChain = task.catch(() => undefined);
    return task;
  }

  async rawCommand(command, options = {}) {
    return this.request(command, options.subcommand ?? 0x0000, options.payload ?? Buffer.alloc(0), options);
  }

  async readDevices(device, points, options = {}) {
    if (!Number.isInteger(points) || points < 1 || points > 0xffff) {
      throw new ValueError(`points out of range (1..65535): ${points}`);
    }
    const series = options.series ? normalizePlcSeries(options.series) : this.plcSeries;
    const bitUnit = Boolean(options.bitUnit);
    const ref = this._parseDevice(device);
    validateDirectReadDevice(ref, points, bitUnit);
    const payload = Buffer.concat([encodeDeviceSpec(ref, { series }), numberToBuffer(points, 2)]);
    const response = await this.request(
      Command.DEVICE_READ,
      resolveDeviceSubcommand({ bitUnit, series }),
      payload,
      options
    );
    if (bitUnit) {
      return unpackBitValues(response.data, points);
    }
    const words = decodeDeviceWords(response.data);
    if (words.length !== points) {
      throw new SlmpError(`word count mismatch: expected=${points}, actual=${words.length}`);
    }
    return words;
  }

  async writeDevices(device, values, options = {}) {
    const series = options.series ? normalizePlcSeries(options.series) : this.plcSeries;
    const bitUnit = Boolean(options.bitUnit);
    const items = Array.from(values || []);
    if (items.length === 0) {
      throw new ValueError("values must not be empty");
    }
    const ref = this._parseDevice(device);
    validateDirectWriteDevice(ref, bitUnit);
    const parts = [encodeDeviceSpec(ref, { series }), numberToBuffer(items.length, 2)];
    if (bitUnit) {
      parts.push(packBitValues(items));
    } else {
      const body = Buffer.alloc(items.length * 2);
      items.forEach((value, index) => {
        body.writeUInt16LE(Number(value) & 0xffff, index * 2);
      });
      parts.push(body);
    }
    await this.request(
      Command.DEVICE_WRITE,
      resolveDeviceSubcommand({ bitUnit, series }),
      Buffer.concat(parts),
      options
    );
  }

  async readRandom({ wordDevices = [], dwordDevices = [], series, ...requestOptions } = {}) {
    const words = Array.from(wordDevices, (device) => this._parseDevice(device));
    const dwords = Array.from(dwordDevices, (device) => this._parseDevice(device));
    if (words.length === 0 && dwords.length === 0) {
      throw new ValueError("wordDevices and dwordDevices must not both be empty");
    }
    if (words.length > 0xff || dwords.length > 0xff) {
      throw new ValueError("wordDevices and dwordDevices must be <= 255 each");
    }
    validateRandomReadDevices(words, dwords);
    const normalizedSeries = series ? normalizePlcSeries(series) : this.plcSeries;
    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    dwords.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    const response = await this.request(
      Command.DEVICE_READ_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
    const expectedLength = words.length * 2 + dwords.length * 4;
    if (response.data.length !== expectedLength) {
      throw new SlmpError(`random read size mismatch: expected=${expectedLength}, actual=${response.data.length}`);
    }
    const wordValues = decodeDeviceWords(response.data.subarray(0, words.length * 2));
    const dwordValues = decodeDeviceDwords(response.data.subarray(words.length * 2));
    return {
      word: Object.fromEntries(words.map((device, index) => [this._deviceText(device), wordValues[index]])),
      dword: Object.fromEntries(dwords.map((device, index) => [this._deviceText(device), dwordValues[index]])),
    };
  }

  async readBlock({ wordBlocks = [], bitBlocks = [], series, ...requestOptions } = {}) {
    const normalizedSeries = series ? normalizePlcSeries(series) : this.plcSeries;
    const words = normalizeBlockItems(wordBlocks, "wordBlocks", this.deviceFamily, this.plcFamily);
    const bits = normalizeBlockItems(bitBlocks, "bitBlocks", this.deviceFamily, this.plcFamily);
    if (words.length === 0 && bits.length === 0) {
      throw new ValueError("wordBlocks and bitBlocks must not both be empty");
    }
    if (words.length > 0xff || bits.length > 0xff) {
      throw new ValueError("wordBlocks and bitBlocks must be <= 255 each");
    }
    validateBlockReadDevices(words, bits);

    const parts = [Buffer.from([words.length, bits.length])];
    words.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.points, 2));
    });
    bits.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.points, 2));
    });

    const response = await this.request(
      Command.DEVICE_READ_BLOCK,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );

    const expectedLength =
      words.reduce((total, block) => total + block.points, 0) * 2 +
      bits.reduce((total, block) => total + block.points, 0) * 2;
    if (response.data.length !== expectedLength) {
      throw new SlmpError(`block read size mismatch: expected=${expectedLength}, actual=${response.data.length}`);
    }

    let offset = 0;
    const wordValues = [];
    const bitWordValues = [];
    const wordResults = words.map((block) => {
      const size = block.points * 2;
      const values = decodeDeviceWords(response.data.subarray(offset, offset + size));
      if (values.length !== block.points) {
        throw new SlmpError(`word block size mismatch for ${this._deviceText(block.device)}`);
      }
      offset += size;
      wordValues.push(...values);
      return { device: this._deviceText(block.device), values };
    });
    const bitResults = bits.map((block) => {
      const size = block.points * 2;
      const values = decodeDeviceWords(response.data.subarray(offset, offset + size));
      if (values.length !== block.points) {
        throw new SlmpError(`bit block size mismatch for ${this._deviceText(block.device)}`);
      }
      offset += size;
      bitWordValues.push(...values);
      return { device: this._deviceText(block.device), values };
    });

    if (offset !== response.data.length) {
      throw new SlmpError(`block read trailing data: ${response.data.length - offset}`);
    }

    return {
      wordValues,
      bitWordValues,
      wordBlocks: wordResults,
      bitBlocks: bitResults,
    };
  }

  async writeBlock({ wordBlocks = [], bitBlocks = [], series, ...requestOptions } = {}) {
    const normalizedSeries = series ? normalizePlcSeries(series) : this.plcSeries;
    const words = normalizeBlockWriteItems(wordBlocks, "wordBlocks", this.deviceFamily, this.plcFamily);
    const bits = normalizeBlockWriteItems(bitBlocks, "bitBlocks", this.deviceFamily, this.plcFamily);
    if (words.length === 0 && bits.length === 0) {
      throw new ValueError("wordBlocks and bitBlocks must not both be empty");
    }
    if (words.length > 0xff || bits.length > 0xff) {
      throw new ValueError("wordBlocks and bitBlocks must be <= 255 each");
    }
    validateBlockWriteDevices(words, bits);

    const parts = [Buffer.from([words.length, bits.length])];
    words.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.values.length, 2));
    });
    bits.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.values.length, 2));
    });
    words.forEach((block) => {
      block.values.forEach((value) => parts.push(numberToBuffer(Number(value) & 0xffff, 2)));
    });
    bits.forEach((block) => {
      block.values.forEach((value) => parts.push(numberToBuffer(Number(value) & 0xffff, 2)));
    });

    await this.request(
      Command.DEVICE_WRITE_BLOCK,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async writeRandomWords({ wordValues = {}, dwordValues = {}, series, ...requestOptions } = {}) {
    const normalizedSeries = series ? normalizePlcSeries(series) : this.plcSeries;
    const wordItems = normalizeItems(wordValues, this.deviceFamily, this.plcFamily);
    const dwordItems = normalizeItems(dwordValues, this.deviceFamily, this.plcFamily);
    if (wordItems.length === 0 && dwordItems.length === 0) {
      throw new ValueError("wordValues and dwordValues must not both be empty");
    }
    if (wordItems.length > 0xff || dwordItems.length > 0xff) {
      throw new ValueError("wordValues and dwordValues must be <= 255 each");
    }
    validateRandomWriteWordDevices(wordItems.map(([device]) => device));
    const parts = [Buffer.from([wordItems.length, dwordItems.length])];
    wordItems.forEach(([device, value]) => {
      parts.push(encodeDeviceSpec(device, { series: normalizedSeries }));
      parts.push(numberToBuffer(Number(value) & 0xffff, 2));
    });
    dwordItems.forEach(([device, value]) => {
      parts.push(encodeDeviceSpec(device, { series: normalizedSeries }));
      parts.push(numberToBuffer(Number(value) >>> 0, 4));
    });
    await this.request(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async writeRandomBits({ bitValues = {}, series, ...requestOptions } = {}) {
    const normalizedSeries = series ? normalizePlcSeries(series) : this.plcSeries;
    const items = normalizeItems(bitValues, this.deviceFamily, this.plcFamily);
    if (items.length === 0) {
      throw new ValueError("bitValues must not be empty");
    }
    if (items.length > 0xff) {
      throw new ValueError("bitValues must be <= 255");
    }
    const parts = [Buffer.from([items.length])];
    items.forEach(([device, value]) => {
      parts.push(encodeDeviceSpec(device, { series: normalizedSeries }));
      if (normalizedSeries === PLCSeries.IQR) {
        parts.push(numberToBuffer(Boolean(value) ? 1 : 0, 2));
      } else {
        parts.push(Buffer.from([Boolean(value) ? 1 : 0]));
      }
    });
    await this.request(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: true, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async readTypeName(options = {}) {
    const response = await this.request(Command.READ_TYPE_NAME, 0x0000, Buffer.alloc(0), options);
    const text = response.data.subarray(0, 16).toString("ascii").replace(/\0+$/g, "").trim();
    const modelCode = response.data.length >= 18 ? response.data.readUInt16LE(16) : null;
    return {
      raw: response.data,
      model: text,
      modelCode,
    };
  }

  async readCpuOperationState(options = {}) {
    const values = await this.readDevices("SD203", 1, {
      ...options,
      bitUnit: false,
    });
    return decodeCpuOperationState(values[0]);
  }

  async remoteRun(options = {}) {
    const clearMode = options.clearMode ?? 2;
    if (![0, 1, 2].includes(Number(clearMode))) {
      throw new ValueError(`clearMode must be one of 0,1,2: ${clearMode}`);
    }
    const mode = options.force ? 0x0003 : 0x0001;
    const payload = Buffer.concat([numberToBuffer(mode, 2), numberToBuffer(clearMode, 2)]);
    await this.request(Command.REMOTE_RUN, 0x0000, payload, options);
  }

  async remoteStop(options = {}) {
    await this.request(Command.REMOTE_STOP, 0x0000, Buffer.from([0x01, 0x00]), options);
  }

  async remotePause(options = {}) {
    const mode = options.force ? 0x0003 : 0x0001;
    await this.request(Command.REMOTE_PAUSE, 0x0000, numberToBuffer(mode, 2), options);
  }

  async remoteLatchClear(options = {}) {
    await this.request(Command.REMOTE_LATCH_CLEAR, 0x0000, Buffer.from([0x01, 0x00]), options);
  }

  async remoteReset(options = {}) {
    const subcommand = options.subcommand ?? 0x0000;
    if (![0x0000, 0x0001].includes(Number(subcommand))) {
      throw new ValueError(`remote reset subcommand must be 0x0000 or 0x0001: 0x${Number(subcommand).toString(16).toUpperCase().padStart(4, "0")}`);
    }
    const expectResponse = options.expectResponse === undefined ? Number(subcommand) !== 0x0000 : Boolean(options.expectResponse);
    await this.request(Command.REMOTE_RESET, subcommand, Buffer.alloc(0), { ...options, expectResponse });
  }

  async memoryReadWords(headAddress, wordLength, options = {}) {
    const count = normalizePoints(wordLength, "memoryReadWords");
    const response = await this.request(
      Command.MEMORY_READ,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(count, 2)]),
      options
    );
    const words = decodeDeviceWords(response.data);
    if (words.length !== count) {
      throw new SlmpError(`memory read size mismatch: expected=${count}, actual=${words.length}`);
    }
    return words;
  }

  async memoryWriteWords(headAddress, values, options = {}) {
    const items = normalizeWordValues(values, "memoryWriteWords");
    const body = Buffer.alloc(items.length * 2);
    items.forEach((value, index) => body.writeUInt16LE(value, index * 2));
    await this.request(
      Command.MEMORY_WRITE,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(items.length, 2), body]),
      options
    );
  }

  async extendUnitReadBytes(headAddress, byteLength, moduleNo, options = {}) {
    const length = normalizePoints(byteLength, "extendUnitReadBytes");
    const response = await this.request(
      Command.EXTEND_UNIT_READ,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(length, 2), numberToBuffer(moduleNo, 2)]),
      options
    );
    if (response.data.length !== length) {
      throw new SlmpError(`extend unit read size mismatch: expected=${length}, actual=${response.data.length}`);
    }
    return Buffer.from(response.data);
  }

  async extendUnitReadWords(headAddress, wordLength, moduleNo, options = {}) {
    const count = normalizePoints(wordLength, "extendUnitReadWords");
    const data = await this.extendUnitReadBytes(headAddress, count * 2, moduleNo, options);
    return decodeDeviceWords(data);
  }

  async extendUnitWriteBytes(headAddress, moduleNo, data, options = {}) {
    const raw = Buffer.from(data || Buffer.alloc(0));
    if (raw.length === 0 || raw.length > 0xffff) {
      throw new ValueError(`extendUnitWriteBytes data length out of range (1..65535): ${raw.length}`);
    }
    await this.request(
      Command.EXTEND_UNIT_WRITE,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(raw.length, 2), numberToBuffer(moduleNo, 2), raw]),
      options
    );
  }

  async extendUnitWriteWords(headAddress, moduleNo, values, options = {}) {
    const items = normalizeWordValues(values, "extendUnitWriteWords");
    const body = Buffer.alloc(items.length * 2);
    items.forEach((value, index) => body.writeUInt16LE(value, index * 2));
    await this.extendUnitWriteBytes(headAddress, moduleNo, body, options);
  }

  async readArrayLabels(points, options = {}) {
    const normalized = normalizeLabelArrayReadPoints(points);
    const response = await this.request(
      Command.LABEL_ARRAY_READ,
      0x0000,
      buildLabelArrayReadPayload(normalized, options.abbreviationLabels || []),
      options
    );
    return parseArrayLabelReadResponse(response.data, normalized.length);
  }

  async writeArrayLabels(points, options = {}) {
    await this.request(
      Command.LABEL_ARRAY_WRITE,
      0x0000,
      buildLabelArrayWritePayload(normalizeLabelArrayWritePoints(points), options.abbreviationLabels || []),
      options
    );
  }

  async readRandomLabels(labels, options = {}) {
    const normalized = normalizeLabelNames(labels);
    const response = await this.request(
      Command.LABEL_READ_RANDOM,
      0x0000,
      buildLabelRandomReadPayload(normalized, options.abbreviationLabels || []),
      options
    );
    return parseRandomLabelReadResponse(response.data, normalized.length);
  }

  async writeRandomLabels(points, options = {}) {
    await this.request(
      Command.LABEL_WRITE_RANDOM,
      0x0000,
      buildLabelRandomWritePayload(normalizeLabelRandomWritePoints(points), options.abbreviationLabels || []),
      options
    );
  }

  async remotePasswordUnlock(password, options = {}) {
    const normalizedSeries = options.series ? normalizePlcSeries(options.series) : this.plcSeries;
    await this.request(Command.REMOTE_PASSWORD_UNLOCK, 0x0000, encodePassword(password, normalizedSeries), options);
  }

  async remotePasswordLock(password, options = {}) {
    const normalizedSeries = options.series ? normalizePlcSeries(options.series) : this.plcSeries;
    await this.request(Command.REMOTE_PASSWORD_LOCK, 0x0000, encodePassword(password, normalizedSeries), options);
  }

  _nextSerial() {
    if (this.frameType !== FrameType.FRAME_4E) {
      const serial = this._serial;
      this._serial = (this._serial + 1) & 0xffff;
      return serial;
    }

    for (let attempt = 0; attempt <= 0xffff; attempt += 1) {
      const serial = this._serial;
      this._serial = (this._serial + 1) & 0xffff;
      if (!this._tcpPendingBySerial.has(serial) && !this._udpPendingBySerial.has(serial)) {
        return serial;
      }
    }

    throw new SlmpError("no free 4E serial values are available");
  }

  async _requestInternal(command, subcommand, data, options) {
    const serial = options.serial ?? this._nextSerial();
    const target = normalizeTarget(options.target || this.defaultTarget);
    const monitoringTimer = options.monitoringTimer ?? this.monitoringTimer;
    const frame = encodeRequest({
      frameType: this.frameType,
      serial,
      target,
      monitoringTimer,
      command: Number(command),
      subcommand: Number(subcommand),
      data: Buffer.from(data || Buffer.alloc(0)),
    });
    if (options.expectResponse === false) {
      await this._sendOnly(frame);
      return { serial, target, endCode: 0, data: Buffer.alloc(0), raw: Buffer.alloc(0) };
    }
    const raw = await this._sendAndReceive(frame, serial);
    const response = decodeResponse(raw, { frameType: this.frameType });
    const shouldRaise = options.raiseOnError === undefined ? this.raiseOnError : Boolean(options.raiseOnError);
    if (shouldRaise && response.endCode !== 0) {
      throw new SlmpError(
        `SLMP error end_code=0x${response.endCode.toString(16).toUpperCase().padStart(4, "0")} command=0x${Number(command)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")} subcommand=0x${Number(subcommand)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}`,
        { endCode: response.endCode, data: response.data }
      );
    }
    return response;
  }

  async _sendOnly(frame) {
    await this.connect();
    if (this.transportType === "tcp") {
      if (!this._tcpSocket) {
        throw new SlmpError("TCP socket is not connected");
      }
      await new Promise((resolve, reject) => {
        this._tcpSocket.write(frame, (error) => {
          if (error) {
            reject(new SlmpError(`TCP write failed: ${error.message}`, { cause: error }));
            return;
          }
          resolve();
        });
      });
      return;
    }

    await new Promise((resolve, reject) => {
      if (!this._udpSocket) {
        reject(new SlmpError("UDP socket is not connected"));
        return;
      }
      this._udpSocket.send(frame, (error) => {
        if (error) {
          reject(new SlmpError(`UDP send failed: ${error.message}`, { cause: error }));
          return;
        }
        resolve();
      });
    });
  }

  async _sendAndReceive(frame, serial) {
    await this.connect();
    if (this.transportType === "tcp") {
      if (!this._tcpSocket) {
        throw new SlmpError("TCP socket is not connected");
      }
      const responsePromise = this._awaitTcpFrame(serial);
      await new Promise((resolve, reject) => {
        this._tcpSocket.write(frame, (error) => {
          if (error) {
            reject(new SlmpError(`TCP write failed: ${error.message}`, { cause: error }));
            return;
          }
          resolve();
        });
      });
      return responsePromise;
    }
    return this._sendUdp(frame, serial);
  }

  _connectTcp() {
    if (this._tcpSocket && !this._tcpSocket.destroyed) {
      return Promise.resolve();
    }
    if (this._tcpConnectPromise) {
      return this._tcpConnectPromise;
    }

    this._tcpConnectPromise = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new SlmpError(`TCP connection timed out to ${this.host}:${this.port}`));
        }
      }, this.timeout);

      const finalizeResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        this._tcpSocket = socket;
        this._tcpBuffer = Buffer.alloc(0);
        socket.setNoDelay(true);
        socket.on("data", (chunk) => this._handleTcpData(chunk));
        socket.on("error", (error) => this._handleTcpFailure(error));
        socket.on("close", () => this._handleTcpFailure(new SlmpError("TCP connection closed")));
        resolve();
      };

      const finalizeReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        reject(new SlmpError(`TCP connection failed: ${error.message}`, { cause: error }));
      };

      socket.once("connect", finalizeResolve);
      socket.once("error", finalizeReject);
    }).finally(() => {
      this._tcpConnectPromise = null;
    });

    return this._tcpConnectPromise;
  }

  _connectUdp() {
    if (this._udpSocket) {
      return Promise.resolve();
    }
    if (this._udpConnectPromise) {
      return this._udpConnectPromise;
    }

    this._udpConnectPromise = new Promise((resolve, reject) => {
      const family = net.isIP(this.host) === 6 ? "udp6" : "udp4";
      const socket = dgram.createSocket(family);
      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new SlmpError(`UDP connect timed out for ${this.host}:${this.port}`));
        }
      }, this.timeout);

      socket.once("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          reject(new SlmpError(`UDP connection failed: ${error.message}`, { cause: error }));
          return;
        }
        this._handleUdpFailure(error);
      });

      socket.connect(this.port, this.host, () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        this._udpSocket = socket;
        socket.on("error", (error) => this._handleUdpFailure(error));
        socket.on("message", (message) => this._handleUdpMessage(message));
        resolve();
      });
    }).finally(() => {
      this._udpConnectPromise = null;
    });

    return this._udpConnectPromise;
  }

  _handleTcpData(chunk) {
    this._tcpBuffer = Buffer.concat([this._tcpBuffer, Buffer.from(chunk)]);
    while (true) {
      const extracted = extractFrameFromBuffer(this._tcpBuffer, { frameType: this.frameType });
      if (!extracted) {
        return;
      }
      this._tcpBuffer = Buffer.from(extracted.rest);
      const frame = Buffer.from(extracted.frame);
      if (this.frameType === FrameType.FRAME_4E) {
        const serial = readResponseSerial(frame);
        const pending = this._tcpPendingBySerial.get(serial);
        if (pending) {
          this._tcpPendingBySerial.delete(serial);
          clearTimeout(pending.timeoutHandle);
          pending.resolve(frame);
          continue;
        }
        const queue = this._tcpFramesBySerial.get(serial) || [];
        queue.push(frame);
        this._tcpFramesBySerial.set(serial, queue);
        continue;
      }

      if (this._tcpPending) {
        const pending = this._tcpPending;
        this._tcpPending = null;
        clearTimeout(pending.timeoutHandle);
        pending.resolve(frame);
      } else {
        this._tcpFrames.push(frame);
      }
    }
  }

  _awaitTcpFrame(serial) {
    if (this.frameType === FrameType.FRAME_4E) {
      const queued = shiftQueuedFrame(this._tcpFramesBySerial, serial);
      if (queued) {
        return Promise.resolve(queued);
      }
      if (this._tcpPendingBySerial.has(serial)) {
        return Promise.reject(new SlmpError(`another TCP request is already waiting for serial ${serial}`));
      }
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._tcpPendingBySerial.delete(serial);
          reject(new SlmpError("TCP communication timeout"));
        }, this.timeout);
        this._tcpPendingBySerial.set(serial, { resolve, reject, timeoutHandle });
      });
    }

    if (this._tcpFrames.length > 0) {
      return Promise.resolve(this._tcpFrames.shift());
    }
    if (this._tcpPending) {
      return Promise.reject(new SlmpError("another TCP request is already waiting for a response"));
    }
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._tcpPending = null;
        reject(new SlmpError("TCP communication timeout"));
      }, this.timeout);
      this._tcpPending = { resolve, reject, timeoutHandle };
    });
  }

  _handleTcpFailure(error) {
    this._tcpSocket = null;
    this._tcpBuffer = Buffer.alloc(0);
    this._rejectTcpPending(
      error instanceof SlmpError ? error : new SlmpError(`TCP transport failure: ${error.message}`, { cause: error })
    );
  }

  _rejectTcpPending(error) {
    if (this._tcpPending) {
      const pending = this._tcpPending;
      this._tcpPending = null;
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    for (const [serial, pending] of this._tcpPendingBySerial.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
      this._tcpPendingBySerial.delete(serial);
    }
    this._tcpFrames = [];
    this._tcpFramesBySerial.clear();
  }

  _sendUdp(frame, serial) {
    return new Promise((resolve, reject) => {
      if (!this._udpSocket) {
        reject(new SlmpError("UDP socket is not connected"));
        return;
      }

      if (this.frameType === FrameType.FRAME_4E) {
        if (this._udpPendingBySerial.has(serial)) {
          reject(new SlmpError(`another UDP request is already waiting for serial ${serial}`));
          return;
        }
      } else if (this._udpPending) {
        reject(new SlmpError("another UDP request is already waiting for a response"));
        return;
      }

      const socket = this._udpSocket;
      const timeoutHandle = setTimeout(() => {
        if (this.frameType === FrameType.FRAME_4E) {
          const pending = this._udpPendingBySerial.get(serial);
          if (!pending) {
            return;
          }
          this._udpPendingBySerial.delete(serial);
          reject(new SlmpError("UDP communication timeout"));
          return;
        }
        if (!this._udpPending) {
          return;
        }
        this._udpPending = null;
        reject(new SlmpError("UDP communication timeout"));
      }, this.timeout);

      if (this.frameType === FrameType.FRAME_4E) {
        this._udpPendingBySerial.set(serial, { resolve, reject, timeoutHandle });
      } else {
        this._udpPending = { resolve, reject, timeoutHandle };
      }

      socket.send(frame, (error) => {
        if (!error) {
          return;
        }
        if (this.frameType === FrameType.FRAME_4E) {
          if (this._udpPendingBySerial.has(serial)) {
            this._udpPendingBySerial.delete(serial);
            clearTimeout(timeoutHandle);
          }
        } else if (this._udpPending) {
          this._udpPending = null;
          clearTimeout(timeoutHandle);
        }
        reject(new SlmpError(`UDP send failed: ${error.message}`, { cause: error }));
      });
    });
  }

  _handleUdpMessage(message) {
    if (this.frameType === FrameType.FRAME_4E) {
      const serial = readResponseSerial(message);
      const pending = this._udpPendingBySerial.get(serial);
      if (!pending) {
        return;
      }
      this._udpPendingBySerial.delete(serial);
      clearTimeout(pending.timeoutHandle);
      pending.resolve(Buffer.from(message));
      return;
    }

    if (!this._udpPending) {
      return;
    }

    const pending = this._udpPending;
    this._udpPending = null;
    clearTimeout(pending.timeoutHandle);
    pending.resolve(Buffer.from(message));
  }

  _handleUdpFailure(error) {
    this._udpSocket = null;
    this._rejectUdpPending(
      error instanceof SlmpError ? error : new SlmpError(`UDP transport failure: ${error.message}`, { cause: error })
    );
  }

  _rejectUdpPending(error) {
    if (this._udpPending) {
      const pending = this._udpPending;
      this._udpPending = null;
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    for (const [serial, pending] of this._udpPendingBySerial.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
      this._udpPendingBySerial.delete(serial);
    }
  }
}

function readResponseSerial(frame) {
  return Buffer.from(frame).readUInt16LE(2);
}

function shiftQueuedFrame(map, serial) {
  const queue = map.get(serial);
  if (!queue || queue.length === 0) {
    return null;
  }
  const frame = queue.shift();
  if (queue.length === 0) {
    map.delete(serial);
  }
  return frame;
}

function normalizeItems(values, deviceFamily, plcFamily) {
  if (Array.isArray(values)) {
    return values.map(([device, value]) => [
      requireExplicitDeviceFamilyForXY(device, plcFamily ?? deviceFamily, parseDevice(device, { family: deviceFamily, plcFamily })),
      value,
    ]);
  }
  return Object.entries(values || {}).map(([device, value]) => [
    requireExplicitDeviceFamilyForXY(device, plcFamily ?? deviceFamily, parseDevice(device, { family: deviceFamily, plcFamily })),
    value,
  ]);
}

function normalizeBlockItems(values, label, deviceFamily, plcFamily) {
  return Array.from(values || [], (item) => {
    if (Array.isArray(item)) {
      const [device, points] = item;
      return {
        device: requireExplicitDeviceFamilyForXY(device, plcFamily ?? deviceFamily, parseDevice(device, { family: deviceFamily, plcFamily })),
        points: normalizePoints(points, label),
      };
    }

    if (!item || typeof item !== "object") {
      throw new ValueError(`${label} entries must be [device, points] tuples or { device, points } objects`);
    }

    return {
      device: requireExplicitDeviceFamilyForXY(
        item.device,
        plcFamily ?? deviceFamily,
        parseDevice(item.device, { family: deviceFamily, plcFamily })
      ),
      points: normalizePoints(item.points, label),
    };
  });
}

function normalizeBlockWriteItems(values, label, deviceFamily, plcFamily) {
  return Array.from(values || [], (item) => {
    if (Array.isArray(item)) {
      const [device, rawValues] = item;
      return {
        device: requireExplicitDeviceFamilyForXY(device, plcFamily ?? deviceFamily, parseDevice(device, { family: deviceFamily, plcFamily })),
        values: normalizeBlockValues(rawValues, label),
      };
    }

    if (!item || typeof item !== "object") {
      throw new ValueError(`${label} entries must be [device, values] tuples or { device, values } objects`);
    }

    return {
      device: requireExplicitDeviceFamilyForXY(
        item.device,
        plcFamily ?? deviceFamily,
        parseDevice(item.device, { family: deviceFamily, plcFamily })
      ),
      values: normalizeBlockValues(item.values, label),
    };
  });
}

function normalizePoints(value, label) {
  const points = Number(value);
  if (!Number.isInteger(points) || points < 1 || points > 0xffff) {
    throw new ValueError(`${label} points out of range (1..65535): ${value}`);
  }
  return points;
}

function normalizeBlockValues(values, label) {
  const items = Array.from(values || []);
  if (items.length === 0) {
    throw new ValueError(`${label} values must not be empty`);
  }
  return items.map((value) => {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0 || normalized > 0xffff) {
      throw new ValueError(`${label} value out of range (0..65535): ${value}`);
    }
    return normalized;
  });
}

function normalizeWordValues(values, label) {
  const items = Array.from(values || []);
  if (items.length === 0) {
    throw new ValueError(`${label} values must not be empty`);
  }
  if (items.length > 0xffff) {
    throw new ValueError(`${label} values must be <= 65535`);
  }
  return items.map((value) => {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0 || normalized > 0xffff) {
      throw new ValueError(`${label} value out of range (0..65535): ${value}`);
    }
    return normalized;
  });
}

function checkU16(value, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 0xffff) {
    throw new ValueError(`${name} out of range (0..65535): ${value}`);
  }
  return normalized;
}

function checkLabelUnitSpecification(value, name) {
  const normalized = Number(value);
  if (![0, 1].includes(normalized)) {
    throw new ValueError(`${name} must be 0(word) or 1(byte): ${value}`);
  }
  return normalized;
}

function labelArrayDataBytes(unitSpecification, arrayDataLength) {
  const unit = checkLabelUnitSpecification(unitSpecification, "unitSpecification");
  const length = checkU16(arrayDataLength, "arrayDataLength");
  return unit === 0 ? length * 2 : length;
}

function normalizeLabelNames(labels) {
  const items = typeof labels === "string" ? [labels] : Array.from(labels || []);
  if (items.length === 0) {
    throw new ValueError("labels must not be empty");
  }
  checkU16(items.length, "label count");
  return items.map((label) => {
    const text = String(label);
    if (!text) {
      throw new ValueError("label must not be empty");
    }
    return text;
  });
}

function normalizeAbbreviationLabels(labels) {
  const items = Array.from(labels || []);
  checkU16(items.length, "abbreviation label count");
  return items.map((label) => {
    const text = String(label);
    if (!text) {
      throw new ValueError("label must not be empty");
    }
    return text;
  });
}

function normalizeLabelArrayReadPoints(points) {
  const items = Array.from(points || []);
  if (items.length === 0) {
    throw new ValueError("points must not be empty");
  }
  checkU16(items.length, "array label point count");
  return items.map((point) => {
    const source = Array.isArray(point)
      ? { label: point[0], unitSpecification: point[1], arrayDataLength: point[2] }
      : point || {};
    return {
      label: String(source.label || ""),
      unitSpecification: checkLabelUnitSpecification(source.unitSpecification ?? source.unit_specification, "unitSpecification"),
      arrayDataLength: checkU16(source.arrayDataLength ?? source.array_data_length, "arrayDataLength"),
    };
  });
}

function normalizeLabelArrayWritePoints(points) {
  const items = Array.from(points || []);
  if (items.length === 0) {
    throw new ValueError("points must not be empty");
  }
  checkU16(items.length, "array label point count");
  return items.map((point) => {
    const source = Array.isArray(point)
      ? { label: point[0], unitSpecification: point[1], arrayDataLength: point[2], data: point[3] }
      : point || {};
    const label = String(source.label || "");
    if (!label) {
      throw new ValueError("label must not be empty");
    }
    const unitSpecification = checkLabelUnitSpecification(source.unitSpecification ?? source.unit_specification, "unitSpecification");
    const arrayDataLength = checkU16(source.arrayDataLength ?? source.array_data_length, "arrayDataLength");
    const data = Buffer.from(source.data || Buffer.alloc(0));
    const expected = labelArrayDataBytes(unitSpecification, arrayDataLength);
    if (data.length !== expected) {
      throw new ValueError(
        `array label write data size mismatch: expected=${expected}, actual=${data.length}, unitSpecification=${unitSpecification}, arrayDataLength=${arrayDataLength}`
      );
    }
    return { label, unitSpecification, arrayDataLength, data };
  });
}

function normalizeLabelRandomWritePoints(points) {
  const items = Array.from(points || []);
  if (items.length === 0) {
    throw new ValueError("points must not be empty");
  }
  checkU16(items.length, "random label point count");
  return items.map((point) => {
    const source = Array.isArray(point) ? { label: point[0], data: point[1] } : point || {};
    const label = String(source.label || "");
    if (!label) {
      throw new ValueError("label must not be empty");
    }
    const data = Buffer.from(source.data || Buffer.alloc(0));
    checkU16(data.length, "write data length");
    return { label, data };
  });
}

function encodeLabelName(label) {
  const text = String(label);
  if (!text) {
    throw new ValueError("label must not be empty");
  }
  const raw = Buffer.from(text, "utf16le");
  const charCount = raw.length / 2;
  checkU16(charCount, "label name length");
  return Buffer.concat([numberToBuffer(charCount, 2), raw]);
}

function buildLabelArrayReadPayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    if (!point.label) {
      throw new ValueError("label must not be empty");
    }
    parts.push(encodeLabelName(point.label));
    parts.push(Buffer.from([point.unitSpecification, 0x00]));
    parts.push(numberToBuffer(point.arrayDataLength, 2));
  });
  return Buffer.concat(parts);
}

function buildLabelArrayWritePayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    parts.push(encodeLabelName(point.label));
    parts.push(Buffer.from([point.unitSpecification, 0x00]));
    parts.push(numberToBuffer(point.arrayDataLength, 2));
    parts.push(Buffer.from(point.data));
  });
  return Buffer.concat(parts);
}

function buildLabelRandomReadPayload(labels, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  const parts = [numberToBuffer(labels.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  labels.forEach((label) => parts.push(encodeLabelName(label)));
  return Buffer.concat(parts);
}

function buildLabelRandomWritePayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    parts.push(encodeLabelName(point.label));
    parts.push(numberToBuffer(point.data.length, 2));
    parts.push(Buffer.from(point.data));
  });
  return Buffer.concat(parts);
}

function parseArrayLabelReadResponse(data, expectedPoints) {
  const payload = Buffer.from(data || Buffer.alloc(0));
  if (payload.length < 2) {
    throw new SlmpError(`array label read response too short: ${payload.length}`);
  }
  const count = payload.readUInt16LE(0);
  if (expectedPoints !== undefined && count !== expectedPoints) {
    throw new SlmpError(`array label read point count mismatch: expected=${expectedPoints}, actual=${count}`);
  }
  let offset = 2;
  const results = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > payload.length) {
      throw new SlmpError("array label read response truncated before metadata");
    }
    const dataTypeId = payload[offset];
    const unitSpecification = checkLabelUnitSpecification(payload[offset + 1], "response unitSpecification");
    const arrayDataLength = payload.readUInt16LE(offset + 2);
    offset += 4;
    const size = labelArrayDataBytes(unitSpecification, arrayDataLength);
    if (offset + size > payload.length) {
      throw new SlmpError(`array label read response truncated in data payload: needed=${size}, remaining=${payload.length - offset}`);
    }
    results.push({
      dataTypeId,
      unitSpecification,
      arrayDataLength,
      data: Buffer.from(payload.subarray(offset, offset + size)),
    });
    offset += size;
  }
  if (offset !== payload.length) {
    throw new SlmpError(`array label read response has trailing bytes: ${payload.length - offset}`);
  }
  return results;
}

function parseRandomLabelReadResponse(data, expectedPoints) {
  const payload = Buffer.from(data || Buffer.alloc(0));
  if (payload.length < 2) {
    throw new SlmpError(`label random read response too short: ${payload.length}`);
  }
  const count = payload.readUInt16LE(0);
  if (expectedPoints !== undefined && count !== expectedPoints) {
    throw new SlmpError(`label random read point count mismatch: expected=${expectedPoints}, actual=${count}`);
  }
  let offset = 2;
  const results = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > payload.length) {
      throw new SlmpError("label random read response truncated before metadata");
    }
    const dataTypeId = payload[offset];
    const spare = payload[offset + 1];
    const readDataLength = payload.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + readDataLength > payload.length) {
      throw new SlmpError(
        `label random read response truncated in data payload: needed=${readDataLength}, remaining=${payload.length - offset}`
      );
    }
    results.push({
      dataTypeId,
      spare,
      readDataLength,
      data: Buffer.from(payload.subarray(offset, offset + readDataLength)),
    });
    offset += readDataLength;
  }
  if (offset !== payload.length) {
    throw new SlmpError(`label random read response has trailing bytes: ${payload.length - offset}`);
  }
  return results;
}

function encodePassword(password, series) {
  if (password === null || password === undefined) {
    throw new ValueError("password is required");
  }

  const raw = Buffer.from(String(password), "ascii");
  if (series === PLCSeries.IQR) {
    if (raw.length < 6 || raw.length > 32) {
      throw new ValueError(`iQ-R password length must be 6..32: ${raw.length}`);
    }
    return Buffer.concat([numberToBuffer(raw.length, 2), raw]);
  }

  if (raw.length < 6 || raw.length > 8) {
    throw new ValueError(`Q/L password length must be 6..8: ${raw.length}`);
  }

  const padded = Buffer.alloc(8);
  raw.copy(padded);
  return padded;
}

function numberToBuffer(value, size) {
  const buffer = Buffer.alloc(size);
  if (size === 2) {
    buffer.writeUInt16LE(Number(value) & 0xffff, 0);
    return buffer;
  }
  if (size === 4) {
    buffer.writeUInt32LE(Number(value) >>> 0, 0);
    return buffer;
  }
  throw new ValueError(`unsupported integer size: ${size}`);
}

module.exports = {
  decodeCpuOperationState,
  SlmpCpuOperationStatus,
  SlmpClient,
};
