"use strict";

const { Command, FrameType, PLCSeries } = require("./constants");
const {
  ValueError,
  decodeDeviceDwords,
  decodeDeviceWords,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeRequest,
  normalizeFrameType,
  normalizePlcProfile,
  normalizeTarget,
  normalizeTransport,
  normalizePort,
  normalizeTimeout,
  normalizeMonitoringTimer,
  packBitValues,
  parseDevice,
  parseRawDevice,
  rawDeviceToString,
  requireExplicitPlcProfileForXY,
  resolveConnectionProfile,
  resolveDeviceSubcommand,
  _encodeResolvedExtendedDeviceSpec: encodeResolvedExtendedDeviceSpec,
  _resolveSemanticExtendedDevice: resolveSemanticExtendedDevice,
  unpackBitValues,
} = require("./core");
const {
  getProfileLimit,
  isProfileReadOnlyDevice,
} = require("./capability-profiles");
const { ensureProfileFeatureAllowedInternal } = require("./profile-guard-internal");
const { formatEndCodeHex } = require("./error-codes");
const { SlmpError } = require("./errors");
const { SlmpTransport } = require("./transport");

const LONG_TIMER_STATE_DIRECT_CODES = new Set(["LTS", "LTC", "LSTS", "LSTC"]);
const LONG_FAMILY_STATE_WRITE_DIRECT_CODES = new Set(["LTS", "LTC", "LSTS", "LSTC", "LCS", "LCC"]);
const LONG_TIMER_CURRENT_BLOCK_CODES = new Set(["LTN", "LSTN"]);
const LONG_CURRENT_VALUE_CODES = new Set(["LTN", "LSTN", "LCN"]);
const DWORD_ONLY_DIRECT_CODES = new Set(["LZ"]);
const LONG_COUNTER_CONTACT_CODES = new Set(["LCS", "LCC"]);
const RANDOM_DWORD_ONLY_CODES = new Set(["LCN", "LZ"]);
const QUALIFIED_ONLY_CODES = new Set(["G", "HG"]);
const DIRECT_WORD_POINT_LIMIT = 960;
const DIRECT_BIT_POINT_LIMIT = 7168;
const MEMORY_WORD_LIMIT = 480;
const EXTEND_UNIT_BYTE_LIMIT = 1920;
const remotePasswords = new WeakMap();
const MANAGED_REMOTE_PASSWORD_COMMAND = Symbol("managedRemotePasswordCommand");
const SlmpCpuOperationStatus = Object.freeze({
  Unknown: "Unknown",
  Run: "Run",
  Stop: "Stop",
  Pause: "Pause",
});

function profileLimitValue(plcProfile, key, fallback) {
  const limit = getProfileLimit(plcProfile, key);
  return limit && Number.isInteger(limit.max) ? limit.max : fallback;
}

function directAccessPointLimit(bitUnit, plcProfile, access) {
  const direction = access === "write" ? "write" : "read";
  if (!bitUnit) {
    return profileLimitValue(plcProfile, `direct_word_${direction}`, DIRECT_WORD_POINT_LIMIT);
  }
  return profileLimitValue(plcProfile, `direct_bit_${direction}`, DIRECT_BIT_POINT_LIMIT);
}

function validateDirectAccessPoints(points, bitUnit, label, plcProfile, access) {
  const limit = directAccessPointLimit(bitUnit, plcProfile, access);
  const unit = bitUnit ? "bit" : "word";
  if (!Number.isInteger(points) || points < 1 || points > limit) {
    throw new ValueError(`${label} ${unit} access points out of range (1..${limit}): ${points}`);
  }
}

function isExtendedRandomLimitKey(limitKey) {
  return String(limitKey || "").endsWith("_ext");
}

function validateRandomReadLikeCounts(wordPoints, dwordPoints, series, label, plcProfile, limitKey = "random_read_word") {
  const total = wordPoints + dwordPoints;
  const fallback = isExtendedRandomLimitKey(limitKey) || series === PLCSeries.IQR ? 96 : 192;
  const limit = profileLimitValue(plcProfile, limitKey, fallback);
  if (total < 1 || total > limit) {
    throw new ValueError(`${label} total access points out of range (1..${limit}): word=${wordPoints}, dword=${dwordPoints}`);
  }
}

function validateRandomWriteWordCounts(wordPoints, dwordPoints, series, label, plcProfile, limitKey = "random_write_word") {
  const total = wordPoints + dwordPoints;
  if (total < 1) {
    throw new ValueError(`${label} word/dword access points out of range: word=${wordPoints}, dword=${dwordPoints}`);
  }
  const profileLimit = getProfileLimit(plcProfile, limitKey);
  const countLimit = profileLimit && Number.isInteger(profileLimit.max) ? profileLimit.max : null;
  if (countLimit !== null && total > countLimit) {
    throw new ValueError(
      `${label} word/dword access points out of range (1..${countLimit}): word=${wordPoints}, dword=${dwordPoints}`
    );
  }
  const weighted = wordPoints * 12 + dwordPoints * 14;
  const limit =
    profileLimit && Number.isInteger(profileLimit.weighted_max)
      ? profileLimit.weighted_max
      : profileLimit
        ? null
        : isExtendedRandomLimitKey(limitKey) || series === PLCSeries.IQR ? 960 : 1920;
  if (limit === null) {
    return;
  }
  if (weighted > limit) {
    throw new ValueError(`${label} word/dword access points out of range: word=${wordPoints}, dword=${dwordPoints}, weighted=${weighted}, limit=${limit}`);
  }
}

function validateRandomBitWriteCount(points, series, label, plcProfile, limitKey = "random_write_bit") {
  const fallback = isExtendedRandomLimitKey(limitKey) || series === PLCSeries.IQR ? 94 : 188;
  const limit = profileLimitValue(plcProfile, limitKey, fallback);
  if (points < 1 || points > limit) {
    throw new ValueError(`${label} bit access points out of range (1..${limit}): ${points}`);
  }
}

function blockPointCount(points, label) {
  const count = Number(points);
  if (!Number.isInteger(count) || count < 1 || count > 0xffff) {
    throw new ValueError(`${label} block points out of range (1..65535): ${points}`);
  }
  return count;
}

function validateBlockReadLimits(wordBlocks, bitBlocks, series) {
  const totalBlocks = wordBlocks.length + bitBlocks.length;
  const blockLimit = series === PLCSeries.IQR ? 60 : 120;
  if (totalBlocks < 1 || totalBlocks > blockLimit) {
    throw new ValueError(`readBlock total block count out of range (1..${blockLimit}): ${totalBlocks}`);
  }
  const totalPoints =
    wordBlocks.reduce((total, block) => total + blockPointCount(block.points, "readBlock word"), 0) +
    bitBlocks.reduce((total, block) => total + blockPointCount(block.points, "readBlock bit"), 0);
  if (totalPoints > DIRECT_WORD_POINT_LIMIT) {
    throw new ValueError(`readBlock total device points out of range (<=960): total_points=${totalPoints}`);
  }
}

function validateBlockWriteLimits(wordBlocks, bitBlocks, series) {
  const totalBlocks = wordBlocks.length + bitBlocks.length;
  const blockLimit = series === PLCSeries.IQR ? 60 : 120;
  if (totalBlocks < 1 || totalBlocks > blockLimit) {
    throw new ValueError(`writeBlock total block count out of range (1..${blockLimit}): ${totalBlocks}`);
  }
  const totalPoints =
    wordBlocks.reduce((total, block) => total + blockPointCount(block.values.length, "writeBlock word"), 0) +
    bitBlocks.reduce((total, block) => total + blockPointCount(block.values.length, "writeBlock bit"), 0);
  const weighted = totalPoints + totalBlocks * (series === PLCSeries.IQR ? 9 : 4);
  if (weighted > DIRECT_WORD_POINT_LIMIT) {
    throw new ValueError(`writeBlock total device points out of range (<=960): weighted=${weighted}, total_points=${totalPoints}`);
  }
}

function validateBlockRouteForProfile(plcProfile, commandLabel) {
  void plcProfile;
  void commandLabel;
}

function validateMemoryWordLength(wordLength, label) {
  if (!Number.isInteger(wordLength) || wordLength < 1 || wordLength > MEMORY_WORD_LIMIT) {
    throw new ValueError(`${label} word length out of range (1..480): ${wordLength}`);
  }
}

function validateExtendUnitByteLength(byteLength, label) {
  if (!Number.isInteger(byteLength) || byteLength < 2 || byteLength > EXTEND_UNIT_BYTE_LIMIT) {
    throw new ValueError(`${label} byte length out of range (2..1920): ${byteLength}`);
  }
}

function validateExtendUnitWordLength(wordLength, label) {
  if (!Number.isInteger(wordLength) || wordLength < 1 || wordLength > DIRECT_WORD_POINT_LIMIT) {
    throw new ValueError(`${label} word length out of range (1..960): ${wordLength}`);
  }
}

function validateDirectReadDevice(ref, points, bitUnit) {
  if (QUALIFIED_ONLY_CODES.has(ref.code)) {
    throw new ValueError("Direct device access does not support standalone G/HG. Use U-qualified extended access.");
  }
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

function isReadOnlyCode(code, plcProfile) {
  const normalizedCode = String(code || "").toUpperCase();
  return isProfileReadOnlyDevice(plcProfile, normalizedCode);
}

function readOnlyMessage(code, plcProfile) {
  const normalizedCode = String(code || "").toUpperCase();
  if (isProfileReadOnlyDevice(plcProfile, normalizedCode)) {
    return `${normalizedCode} is read-only for plcProfile '${normalizePlcProfile(plcProfile)}' and cannot be written.`;
  }
  return `${normalizedCode} is read-only and cannot be written.`;
}

function randomReadOnlyMessage(code, plcProfile) {
  return `Write Random (0x1402) does not support read-only device ${String(code).toUpperCase()} for plcProfile '${normalizePlcProfile(plcProfile)}'.`;
}

function blockReadOnlyMessage(code, plcProfile) {
  return `Write Block (0x1406) does not support read-only device ${String(code).toUpperCase()} for plcProfile '${normalizePlcProfile(plcProfile)}'.`;
}

function validateDirectWriteDevice(ref, bitUnit, plcProfile) {
  if (QUALIFIED_ONLY_CODES.has(ref.code)) {
    throw new ValueError("Direct device access does not support standalone G/HG. Use U-qualified extended access.");
  }
  if (isReadOnlyCode(ref.code, plcProfile)) {
    throw new ValueError(readOnlyMessage(ref.code, plcProfile));
  }
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

function validateRandomReadDevices(wordDevices, dwordDevices, options = {}) {
  const commandLabel = options.commandLabel || "Read Random (0x0403)";
  if (!options.allowQualifiedOnly && [...wordDevices, ...dwordDevices].some((device) => QUALIFIED_ONLY_CODES.has(device.code))) {
    throw new ValueError(`${commandLabel} does not support standalone G/HG. Use U-qualified extended access.`);
  }
  if ([...wordDevices, ...dwordDevices].some((device) => LONG_TIMER_STATE_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      `${commandLabel} does not support LTS/LTC/LSTS/LSTC. Use readTyped/readNamed or the long timer status helpers instead.`
    );
  }
  if ([...wordDevices, ...dwordDevices].some((device) => LONG_COUNTER_CONTACT_CODES.has(device.code))) {
    throw new ValueError(
      `${commandLabel} does not support LCS/LCC. Use readTyped/readNamed so direct bit read is selected.`
    );
  }
  if (wordDevices.some((device) => LONG_CURRENT_VALUE_CODES.has(device.code) || DWORD_ONLY_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      `${commandLabel} does not support LTN/LSTN/LCN/LZ as word entries. Use dword entries or readTyped/readNamed with ':D' or ':L' instead.`
    );
  }
}

function validateRandomWriteWordDevices(wordDevices, dwordDevices = [], plcProfile, options = {}) {
  const readOnlyDevice = [...wordDevices, ...dwordDevices].find((device) => isReadOnlyCode(device.code, plcProfile));
  if (readOnlyDevice) {
    throw new ValueError(randomReadOnlyMessage(readOnlyDevice.code, plcProfile));
  }
  if (!options.allowQualifiedOnly && [...wordDevices, ...dwordDevices].some((device) => QUALIFIED_ONLY_CODES.has(device.code))) {
    throw new ValueError("Write Random (0x1402) does not support standalone G/HG. Use U-qualified extended access.");
  }
  if (wordDevices.some((device) => LONG_CURRENT_VALUE_CODES.has(device.code) || DWORD_ONLY_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      "Write Random (0x1402) does not support LTN/LSTN/LCN/LZ as word entries. Use dword entries or writeTyped/writeNamed with ':D' or ':L' instead."
    );
  }
}

function validateRandomWriteBitDevices(bitDevices, plcProfile) {
  const readOnlyDevice = bitDevices.find((device) => isReadOnlyCode(device.code, plcProfile));
  if (readOnlyDevice) {
    throw new ValueError(randomReadOnlyMessage(readOnlyDevice.code, plcProfile));
  }
  if (bitDevices.some((device) => QUALIFIED_ONLY_CODES.has(device.code))) {
    throw new ValueError("Write Random (0x1402) does not support standalone G/HG bit entries. Use U-qualified word access.");
  }
}

function validateBlockReadDevices(wordBlocks, bitBlocks) {
  if ([...wordBlocks, ...bitBlocks].some((block) => QUALIFIED_ONLY_CODES.has(block.device.code))) {
    throw new ValueError("Read Block (0x0406) does not support standalone G/HG. Use U-qualified extended access.");
  }
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

function validateBlockWriteDevices(wordBlocks, bitBlocks, plcProfile) {
  const readOnlyBlock = [...wordBlocks, ...bitBlocks].find((block) => isReadOnlyCode(block.device.code, plcProfile));
  if (readOnlyBlock) {
    throw new ValueError(blockReadOnlyMessage(readOnlyBlock.device.code, plcProfile));
  }
  if ([...wordBlocks, ...bitBlocks].some((block) => QUALIFIED_ONLY_CODES.has(block.device.code))) {
    throw new ValueError("Write Block (0x1406) does not support standalone G/HG. Use U-qualified extended access.");
  }
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

function validateMonitorRegisterRequest(command, subcommand, data, series, plcProfile) {
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
  validateRandomReadLikeCounts(wordCount, dwordCount, series, "monitorRegister", plcProfile, "monitor_register_word");
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
    if (code === 0x00ab || code === 0x002e) {
      throw new ValueError("Entry Monitor Device (0x0801) does not support standalone G/HG. Use U-qualified extended access.");
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

function parseEndCodeFromMessage(message) {
  const match = String(message || "").match(/end_code=0x([0-9a-f]{4})/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function formatRemotePasswordUnlockError(error) {
  const endCode = Number.isInteger(error?.endCode) ? error.endCode : parseEndCodeFromMessage(error?.message);
  if (endCode == null) {
    return error;
  }

  const message = `Remote password unlock failed. end_code=${formatEndCodeHex(endCode) || "unknown"}`;
  if (error instanceof SlmpError && error.message === message) {
    return error;
  }
  return new SlmpError(message, {
    endCode,
    data: error?.data,
    errorInfo: error?.errorInfo,
    cause: error,
  });
}

function formatRemotePasswordLockError(error) {
  const endCode = Number.isInteger(error?.endCode) ? error.endCode : parseEndCodeFromMessage(error?.message);
  const message = endCode == null
    ? "Remote password lock failed."
    : `Remote password lock failed. end_code=${formatEndCodeHex(endCode) || "unknown"}`;
  return new SlmpError(message, {
    endCode: endCode == null ? undefined : endCode,
    data: error?.data,
    errorInfo: error?.errorInfo,
    cause: error,
  });
}

function createSlmpResponseError(response, command, subcommand) {
  const normalizedCommand = Number(command);
  const normalizedSubcommand = Number(subcommand);
  const rawMessage = `SLMP error end_code=0x${response.endCode.toString(16).toUpperCase().padStart(4, "0")} command=0x${normalizedCommand
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")} subcommand=0x${normalizedSubcommand.toString(16).toUpperCase().padStart(4, "0")}`;
  return new SlmpError(rawMessage, {
    endCode: response.endCode,
    command: normalizedCommand,
    subcommand: normalizedSubcommand,
    data: response.data,
    errorInfo: response.errorInfo,
    rawMessage,
  });
}

class SlmpClient {
  constructor(options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("options is required and must be an object");
    }
    const source = options;
    this.host = String(source.host || "").trim();
    this.port = normalizePort(source.port);
    this.transportType = normalizeTransport(source.transport);
    this.timeout = Object.prototype.hasOwnProperty.call(source, "timeout") ? normalizeTimeout(source.timeout) : 3000;
    this._allowManualProfile = Boolean(source._allowManualProfile);
    const profile = resolveConnectionProfile({
      plcProfile: source.plcProfile,
      plcSeries: source.plcSeries,
      frameType: source.frameType,
    }, { allowManualProfile: this._allowManualProfile });
    this.plcProfile = profile.plcProfile;
    this.plcSeries = profile.plcSeries;
    this.frameType = profile.frameType;
    this.addressProfile = profile.addressProfile;
    this.rangeProfile = profile.rangeProfile;
    const hasDefaultTarget = Object.prototype.hasOwnProperty.call(source, "defaultTarget");
    const hasTarget = Object.prototype.hasOwnProperty.call(source, "target");
    if (hasDefaultTarget === hasTarget) {
      throw new ValueError("exactly one of defaultTarget or target is required");
    }
    Object.defineProperty(this, "defaultTarget", {
      value: Object.freeze(normalizeTarget(hasDefaultTarget ? source.defaultTarget : source.target)),
      enumerable: true,
      writable: false,
      configurable: false,
    });
    this.monitoringTimer = Object.prototype.hasOwnProperty.call(source, "monitoringTimer")
      ? normalizeMonitoringTimer(source.monitoringTimer)
      : 0x0010;
    if (Object.prototype.hasOwnProperty.call(source, "raiseOnError") && typeof source.raiseOnError !== "boolean") {
      throw new ValueError("raiseOnError must be a boolean");
    }
    this.raiseOnError = Object.prototype.hasOwnProperty.call(source, "raiseOnError") ? source.raiseOnError : true;
    const hasRemotePassword = Object.prototype.hasOwnProperty.call(source, "remotePassword")
      && source.remotePassword !== undefined;
    const remotePassword = hasRemotePassword
      ? validateRemotePassword(source.remotePassword, this.plcSeries)
      : null;
    remotePasswords.set(this, remotePassword);
    if (Object.prototype.hasOwnProperty.call(source, "strictProfile") || Object.prototype.hasOwnProperty.call(source, "strict_profile")) {
      throw new ValueError("strictProfile is no longer a public option; normal clients always enforce the selected profile");
    }
    if (Object.prototype.hasOwnProperty.call(source, "_maintainerStrictProfile") && typeof source._maintainerStrictProfile !== "boolean") {
      throw new ValueError("_maintainerStrictProfile must be a boolean");
    }
    this._strictProfile = source._maintainerStrictProfile !== false;

    if (!this.host) {
      throw new ValueError("host is required");
    }

    this._requestChain = Promise.resolve();
    this._transport = new SlmpTransport({
      host: this.host,
      port: this.port,
      transportType: this.transportType,
      frameType: this.frameType,
      timeout: this.timeout,
    });
    this._observedTransportGeneration = null;
    this._remotePasswordUnlockedGeneration = null;
    this._remotePasswordUnlockPromise = null;
  }

  _parseDevice(device) {
    if (this.plcProfile == null) {
      return parseRawDevice(device, { addressProfile: this.addressProfile });
    }
    const ref = parseDevice(device, { addressProfile: this.addressProfile, plcProfile: this.plcProfile });
    return requireExplicitPlcProfileForXY(device, this.plcProfile ?? this.addressProfile, ref);
  }

  _parseExtendedDevice(device) {
    const resolved = resolveSemanticExtendedDevice(device, {
      addressProfile: this.addressProfile,
      plcProfile: this.plcProfile,
      series: this.plcSeries,
    });
    return {
      device: requireExplicitPlcProfileForXY(resolved.address, this.plcProfile ?? this.addressProfile, resolved.ref),
      extension: resolved.extension,
      address: resolved.address,
    };
  }

  _deviceText(device) {
    if (this.plcProfile == null) {
      return rawDeviceToString(device, { addressProfile: this.addressProfile, allowQualifiedOnly: true });
    }
    return deviceToString(device, { plcProfile: this.plcProfile, allowQualifiedOnly: true });
  }

  _ensureProfileFeatureAllowed(featureKey) {
    ensureProfileFeatureAllowedInternal(this.plcProfile, featureKey, this._strictProfile);
  }

  _ensureExtendedProfileFeatureAllowed(device, extension) {
    if (extension.directMemorySpecification === 0xf9) {
      this._ensureProfileFeatureAllowed("ext_link_direct");
    } else if (device.code === "HG" || extension.directMemorySpecification === 0xfa) {
      this._ensureProfileFeatureAllowed("hg_cpu_buffer");
    } else if (device.code === "G" || extension.directMemorySpecification === 0xf8) {
      this._ensureProfileFeatureAllowed("ext_module_access");
    }
  }

  async connect() {
    if (arguments.length !== 0) {
      throw new ValueError("connect does not accept options");
    }
    await this._connectTransport();
    await this._unlockRemotePasswordIfConfigured();
  }

  trafficStats() {
    if (arguments.length !== 0) {
      throw new ValueError("trafficStats does not accept arguments");
    }
    return this._transport.trafficStats();
  }

  async close() {
    let lockError = null;
    let closeError = null;
    try {
      await this._lockRemotePasswordIfConfigured();
    } catch (error) {
      lockError = formatRemotePasswordLockError(error);
    }
    try {
      await this._closeTransport();
    } catch (error) {
      closeError = error instanceof SlmpError
        ? error
        : new SlmpError("Local SLMP transport close failed.", { cause: error });
    } finally {
      this._invalidateRemotePasswordState();
      this._observedTransportGeneration = null;
    }
    if (lockError && closeError) {
      throw new SlmpError("Remote password lock and local transport close both failed.", {
        cause: new AggregateError([lockError, closeError], "SLMP close failures"),
      });
    }
    if (lockError) {
      throw lockError;
    }
    if (closeError) {
      throw closeError;
    }
  }

  async _connectTransport() {
    await this._transport.connect();
    const generation = this._transport.connectionGeneration();
    if (this._observedTransportGeneration !== generation) {
      this._invalidateRemotePasswordState();
      this._observedTransportGeneration = generation;
    }
  }

  async _closeTransport() {
    await this._transport.close();
  }

  _hasRemotePassword() {
    return typeof remotePasswords.get(this) === "string";
  }

  _hasOpenTransport() {
    return this._transport.hasOpenTransport();
  }

  _currentTransportGeneration() {
    return this._transport.connectionGeneration();
  }

  _invalidateRemotePasswordState() {
    this._remotePasswordUnlockedGeneration = null;
    this._remotePasswordUnlockPromise = null;
  }

  async _unlockRemotePasswordIfConfigured() {
    if (!this._hasRemotePassword() || !this._hasOpenTransport()) {
      return;
    }
    const generation = this._currentTransportGeneration();
    if (this._remotePasswordUnlockedGeneration === generation) {
      return;
    }
    if (!this._remotePasswordUnlockPromise || this._remotePasswordUnlockPromise.generation !== generation) {
      const promise = (async () => {
        try {
          await this._sendManagedRemotePasswordCommand(Command.REMOTE_PASSWORD_UNLOCK, remotePasswords.get(this));
          if (!this._hasOpenTransport() || this._currentTransportGeneration() !== generation) {
            throw new SlmpError("SLMP transport changed while remote password unlock was in progress");
          }
          this._remotePasswordUnlockedGeneration = generation;
        } catch (error) {
          let closeError = null;
          try {
            await this._closeTransport();
          } catch (secondaryError) {
            closeError = secondaryError;
          }
          this._invalidateRemotePasswordState();
          const formatted = formatRemotePasswordUnlockError(error);
          if (closeError) formatted.closeError = closeError;
          throw formatted;
        } finally {
          if (this._remotePasswordUnlockPromise?.generation === generation) {
            this._remotePasswordUnlockPromise = null;
          }
        }
      })();
      this._remotePasswordUnlockPromise = { generation, promise };
    }
    await this._remotePasswordUnlockPromise.promise;
  }

  async _lockRemotePasswordIfConfigured() {
    if (!this._hasRemotePassword() || !this._hasOpenTransport()) {
      return;
    }
    const generation = this._currentTransportGeneration();
    if (this._remotePasswordUnlockedGeneration !== generation) {
      return;
    }
    try {
      await this._sendManagedRemotePasswordCommand(Command.REMOTE_PASSWORD_LOCK, remotePasswords.get(this));
    } finally {
      this._remotePasswordUnlockedGeneration = null;
    }
  }

  _request(command, subcommand, data, options = {}) {
    if (subcommand === undefined || subcommand === null) {
      throw new ValueError("subcommand is required for the raw request API");
    }
    if (data === undefined || data === null || (!Buffer.isBuffer(data) && !(data instanceof Uint8Array))) {
      throw new ValueError("data is required for the raw request API and must be a byte buffer");
    }
    if (Object.prototype.hasOwnProperty.call(options, "raiseOnError") && typeof options.raiseOnError !== "boolean") {
      throw new ValueError("raiseOnError must be a boolean when provided");
    }
    rejectRemovedRemotePasswordLifecycleOption(options, "request");
    rejectProfileDerivedOverrides(options, "request");
    validateMonitorRegisterRequest(Number(command), Number(subcommand), data, this.plcSeries, this.plcProfile);
    const requestOptions = {
      ...options,
      target: Object.prototype.hasOwnProperty.call(options, "target")
        ? normalizeTarget(options.target)
        : { ...this.defaultTarget },
      monitoringTimer: Object.prototype.hasOwnProperty.call(options, "monitoringTimer")
        ? normalizeMonitoringTimer(options.monitoringTimer)
        : this.monitoringTimer,
      raiseOnError: Object.prototype.hasOwnProperty.call(options, "raiseOnError")
        ? options.raiseOnError
        : this.raiseOnError,
    };
    const requestData = Buffer.from(data);
    const task = this._requestChain.then(() =>
      this._requestInternal(command, subcommand, requestData, requestOptions));
    this._requestChain = task.catch(() => undefined);
    return task;
  }

  async rawCommand(command, options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("rawCommand options are required");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "subcommand")) {
      throw new ValueError("rawCommand subcommand is required");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "payload")) {
      throw new ValueError("rawCommand payload is required; use an empty Buffer when the command has no payload");
    }
    return this._request(command, options.subcommand, options.payload, options);
  }

  async readDevices(device, points, options = {}) {
    rejectProfileDerivedOverrides(options, "readDevices");
    if (!Object.prototype.hasOwnProperty.call(options, "bitUnit") || typeof options.bitUnit !== "boolean") {
      throw new ValueError("readDevices bitUnit is required and must be a boolean");
    }
    const series = this.plcSeries;
    const bitUnit = options.bitUnit;
    this._ensureProfileFeatureAllowed("direct");
    validateDirectAccessPoints(points, bitUnit, "readDevices", this.plcProfile, "read");
    const ref = this._parseDevice(device);
    validateDirectReadDevice(ref, points, bitUnit);
    const payload = Buffer.concat([encodeDeviceSpec(ref, { series }), numberToBuffer(points, 2)]);
    const response = await this._request(
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
    rejectProfileDerivedOverrides(options, "writeDevices");
    if (!Object.prototype.hasOwnProperty.call(options, "bitUnit") || typeof options.bitUnit !== "boolean") {
      throw new ValueError("writeDevices bitUnit is required and must be a boolean");
    }
    const series = this.plcSeries;
    const bitUnit = options.bitUnit;
    const items = Array.from(values || []);
    if (items.length === 0) {
      throw new ValueError("values must not be empty");
    }
    this._ensureProfileFeatureAllowed("direct");
    validateDirectAccessPoints(items.length, bitUnit, "writeDevices", this.plcProfile, "write");
    const ref = this._parseDevice(device);
    validateDirectWriteDevice(ref, bitUnit, this.plcProfile);
    const parts = [encodeDeviceSpec(ref, { series }), numberToBuffer(items.length, 2)];
    if (bitUnit) {
      parts.push(packBitValues(items));
    } else {
      const body = Buffer.alloc(items.length * 2);
      items.forEach((value, index) => {
        body.writeUInt16LE(requireWireU16(value, `values[${index}]`), index * 2);
      });
      parts.push(body);
    }
    await this._request(
      Command.DEVICE_WRITE,
      resolveDeviceSubcommand({ bitUnit, series }),
      Buffer.concat(parts),
      options
    );
  }

  async readRandom({ wordDevices = [], dwordDevices = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("readRandom does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("random");
    const words = Array.from(wordDevices, (device) => this._parseDevice(device));
    const dwords = Array.from(dwordDevices, (device) => this._parseDevice(device));
    if (words.length === 0 && dwords.length === 0) {
      throw new ValueError("wordDevices and dwordDevices must not both be empty");
    }
    if (words.length > 0xff || dwords.length > 0xff) {
      throw new ValueError("wordDevices and dwordDevices must be <= 255 each");
    }
    const normalizedSeries = this.plcSeries;
    validateRandomReadLikeCounts(words.length, dwords.length, normalizedSeries, "readRandom", this.plcProfile);
    validateRandomReadDevices(words, dwords);
    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    dwords.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    const response = await this._request(
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

  async readRandomExt({ wordDevices = [], dwordDevices = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("readRandomExt does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("random");
    const wordItems = normalizeExtendedDeviceEntries(wordDevices, "wordDevices");
    const dwordItems = normalizeExtendedDeviceEntries(dwordDevices, "dwordDevices");
    if (wordItems.length === 0 && dwordItems.length === 0) {
      throw new ValueError("wordDevices and dwordDevices must not both be empty");
    }
    if (wordItems.length > 0xff || dwordItems.length > 0xff) {
      throw new ValueError("wordDevices and dwordDevices must be <= 255 each");
    }
    const normalizedSeries = this.plcSeries;
    validateRandomReadLikeCounts(
      wordItems.length,
      dwordItems.length,
      normalizedSeries,
      "readRandomExt",
      this.plcProfile,
      "random_read_word_ext"
    );
    const words = wordItems.map((device) => this._parseExtendedDevice(device));
    const dwords = dwordItems.map((device) => this._parseExtendedDevice(device));
    validateRandomReadDevices(
      words.map((entry) => entry.device),
      dwords.map((entry) => entry.device),
      { allowQualifiedOnly: true }
    );

    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((entry) => {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      parts.push(encodeResolvedExtendedDeviceSpec(entry.device, { series: normalizedSeries, extension: entry.extension }));
    });
    dwords.forEach((entry) => {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      parts.push(encodeResolvedExtendedDeviceSpec(entry.device, { series: normalizedSeries, extension: entry.extension }));
    });
    const response = await this._request(
      Command.DEVICE_READ_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries, extension: true }),
      Buffer.concat(parts),
      requestOptions
    );
    const expectedLength = words.length * 2 + dwords.length * 4;
    if (response.data.length !== expectedLength) {
      throw new SlmpError(`extended random read size mismatch: expected=${expectedLength}, actual=${response.data.length}`);
    }
    const wordValues = decodeDeviceWords(response.data.subarray(0, words.length * 2));
    const dwordValues = decodeDeviceDwords(response.data.subarray(words.length * 2));
    return {
      word: Object.fromEntries(words.map((entry, index) => [extendedResultKey(entry), wordValues[index]])),
      dword: Object.fromEntries(dwords.map((entry, index) => [extendedResultKey(entry), dwordValues[index]])),
    };
  }

  /** Register Word/DWord monitor devices with exactly one request. */
  async registerMonitorDevices({ wordDevices = [], dwordDevices = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("registerMonitorDevices does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("monitor");
    const words = Array.from(wordDevices, (device) => this._parseDevice(device));
    const dwords = Array.from(dwordDevices, (device) => this._parseDevice(device));
    if (words.length === 0 && dwords.length === 0) {
      throw new ValueError("wordDevices and dwordDevices must not both be empty");
    }
    const normalizedSeries = this.plcSeries;
    validateRandomReadLikeCounts(
      words.length,
      dwords.length,
      normalizedSeries,
      "registerMonitorDevices",
      this.plcProfile,
      "monitor_register_word"
    );
    validateRandomReadDevices(words, dwords, { commandLabel: "Entry Monitor Device (0x0801)" });
    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    dwords.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    await this._request(
      Command.MONITOR_REGISTER,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  /** Register qualified Extended Devices with exactly one request. */
  async registerMonitorDevicesExt({ wordDevices = [], dwordDevices = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("registerMonitorDevicesExt does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("monitor");
    const wordItems = normalizeExtendedDeviceEntries(wordDevices, "wordDevices");
    const dwordItems = normalizeExtendedDeviceEntries(dwordDevices, "dwordDevices");
    if (wordItems.length === 0 && dwordItems.length === 0) {
      throw new ValueError("wordDevices and dwordDevices must not both be empty");
    }
    const normalizedSeries = this.plcSeries;
    validateRandomReadLikeCounts(
      wordItems.length,
      dwordItems.length,
      normalizedSeries,
      "registerMonitorDevicesExt",
      this.plcProfile,
      "monitor_register_word_ext"
    );
    const words = wordItems.map((device) => this._parseExtendedDevice(device));
    const dwords = dwordItems.map((device) => this._parseExtendedDevice(device));
    validateRandomReadDevices(
      words.map((entry) => entry.device),
      dwords.map((entry) => entry.device),
      { allowQualifiedOnly: true, commandLabel: "Entry Monitor Device (0x0801)" }
    );
    const parts = [Buffer.from([words.length, dwords.length])];
    for (const entry of [...words, ...dwords]) {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      parts.push(encodeResolvedExtendedDeviceSpec(entry.device, { series: normalizedSeries, extension: entry.extension }));
    }
    await this._request(
      Command.MONITOR_REGISTER,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries, extension: true }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  /**
   * Execute one monitor cycle using explicit registered Word/DWord counts.
   * The combined count must be nonzero and within the active profile limit.
   * Registration is PLC state. This method never auto-registers, retries, or falls back.
   */
  async runMonitorCycle(options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("runMonitorCycle options are required");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "wordPoints") ||
        !Object.prototype.hasOwnProperty.call(options, "dwordPoints")) {
      throw new ValueError("runMonitorCycle wordPoints and dwordPoints are required");
    }
    const wordPoints = options.wordPoints;
    const dwordPoints = options.dwordPoints;
    if (!Number.isInteger(wordPoints) || wordPoints < 0 || wordPoints > 0xff ||
        !Number.isInteger(dwordPoints) || dwordPoints < 0 || dwordPoints > 0xff ||
        wordPoints + dwordPoints < 1) {
      throw new ValueError("runMonitorCycle point counts must be integers in range 0..255 and must not both be zero");
    }
    this._ensureProfileFeatureAllowed("monitor");
    validateRandomReadLikeCounts(
      wordPoints,
      dwordPoints,
      this.plcSeries,
      "runMonitorCycle",
      this.plcProfile,
      "monitor_register_word"
    );
    const { wordPoints: _wordPoints, dwordPoints: _dwordPoints, ...requestOptions } = options;
    const response = await this._request(Command.MONITOR, 0x0000, Buffer.alloc(0), requestOptions);
    const expectedLength = wordPoints * 2 + dwordPoints * 4;
    if (response.data.length !== expectedLength) {
      throw new SlmpError(`monitor response size mismatch: expected=${expectedLength}, actual=${response.data.length}`);
    }
    return {
      word: decodeDeviceWords(response.data.subarray(0, wordPoints * 2)),
      dword: decodeDeviceDwords(response.data.subarray(wordPoints * 2)),
    };
  }

  async readBlock({ wordBlocks = [], bitBlocks = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("readBlock does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("block");
    const normalizedSeries = this.plcSeries;
    const words = normalizeBlockItems(wordBlocks, "wordBlocks", this.addressProfile, this.plcProfile);
    const bits = normalizeBlockItems(bitBlocks, "bitBlocks", this.addressProfile, this.plcProfile);
    if (words.length === 0 && bits.length === 0) {
      throw new ValueError("wordBlocks and bitBlocks must not both be empty");
    }
    if (words.length > 0xff || bits.length > 0xff) {
      throw new ValueError("wordBlocks and bitBlocks must be <= 255 each");
    }
    validateBlockRouteForProfile(this.plcProfile, "Read Block (0x0406)");
    validateBlockReadLimits(words, bits, normalizedSeries);
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

    const response = await this._request(
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
    if (series !== undefined) throw new ValueError("writeBlock does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("block");
    const normalizedSeries = this.plcSeries;
    const words = normalizeBlockWriteItems(wordBlocks, "wordBlocks", this.addressProfile, this.plcProfile);
    const bits = normalizeBlockWriteItems(bitBlocks, "bitBlocks", this.addressProfile, this.plcProfile);
    if (words.length === 0 && bits.length === 0) {
      throw new ValueError("wordBlocks and bitBlocks must not both be empty");
    }
    if (words.length > 0xff || bits.length > 0xff) {
      throw new ValueError("wordBlocks and bitBlocks must be <= 255 each");
    }
    validateBlockRouteForProfile(this.plcProfile, "Write Block (0x1406)");
    validateBlockWriteLimits(words, bits, normalizedSeries);
    validateBlockWriteDevices(words, bits, this.plcProfile);
    validateNoBlockWriteOverlap(words, bits);

    const parts = [Buffer.from([words.length, bits.length])];
    // SLMP Write Block places each block's data immediately after that
    // block's device spec and point count. Batching all specs before all data
    // makes mixed and multi-block writes misparse on real PLCs.
    words.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.values.length, 2));
      block.values.forEach((value) => parts.push(numberToBuffer(value, 2)));
    });
    bits.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.values.length, 2));
      block.values.forEach((value) => parts.push(numberToBuffer(value, 2)));
    });

    await this._request(
      Command.DEVICE_WRITE_BLOCK,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async writeRandomWords({ wordValues = {}, dwordValues = {}, series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("writeRandomWords does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("random");
    const normalizedSeries = this.plcSeries;
    const wordItems = normalizeItems(wordValues, this.addressProfile, this.plcProfile);
    const dwordItems = normalizeItems(dwordValues, this.addressProfile, this.plcProfile);
    if (wordItems.length === 0 && dwordItems.length === 0) {
      throw new ValueError("wordValues and dwordValues must not both be empty");
    }
    if (wordItems.length > 0xff || dwordItems.length > 0xff) {
      throw new ValueError("wordValues and dwordValues must be <= 255 each");
    }
    validateRandomWriteWordCounts(wordItems.length, dwordItems.length, normalizedSeries, "writeRandomWords", this.plcProfile);
    validateRandomWriteWordDevices(
      wordItems.map(([device]) => device),
      dwordItems.map(([device]) => device),
      this.plcProfile
    );
    validateNoRandomWriteOverlap(
      wordItems.map(([device]) => device),
      dwordItems.map(([device]) => device),
      "writeRandomWords"
    );
    const parts = [Buffer.from([wordItems.length, dwordItems.length])];
    wordItems.forEach(([device, value]) => {
      parts.push(encodeDeviceSpec(device, { series: normalizedSeries }));
      parts.push(numberToBuffer(requireWireU16(value, "word value"), 2));
    });
    dwordItems.forEach(([device, value]) => {
      parts.push(encodeDeviceSpec(device, { series: normalizedSeries }));
      parts.push(numberToBuffer(requireWireU32(value, "dword value"), 4));
    });
    await this._request(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async writeRandomWordsExt({ wordValues = [], dwordValues = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("writeRandomWordsExt does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("random");
    const normalizedSeries = this.plcSeries;
    const wordItems = normalizeExtendedValueItems(wordValues, "wordValues");
    const dwordItems = normalizeExtendedValueItems(dwordValues, "dwordValues");
    if (wordItems.length === 0 && dwordItems.length === 0) {
      throw new ValueError("wordValues and dwordValues must not both be empty");
    }
    if (wordItems.length > 0xff || dwordItems.length > 0xff) {
      throw new ValueError("wordValues and dwordValues must be <= 255 each");
    }
    validateRandomWriteWordCounts(
      wordItems.length,
      dwordItems.length,
      normalizedSeries,
      "writeRandomWordsExt",
      this.plcProfile,
      "random_write_word_ext"
    );
    const words = wordItems.map((entry) => ({
      ...this._parseExtendedDevice(entry.device),
      value: entry.value,
    }));
    const dwords = dwordItems.map((entry) => ({
      ...this._parseExtendedDevice(entry.device),
      value: entry.value,
    }));
    validateRandomWriteWordDevices(
      words.map((entry) => entry.device),
      dwords.map((entry) => entry.device),
      this.plcProfile,
      { allowQualifiedOnly: true }
    );
    validateNoExtendedRandomWriteOverlap(words, dwords, "writeRandomWordsExt");

    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((entry) => {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      parts.push(encodeResolvedExtendedDeviceSpec(entry.device, { series: normalizedSeries, extension: entry.extension }));
      parts.push(numberToBuffer(requireWireU16(entry.value, "word value"), 2));
    });
    dwords.forEach((entry) => {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      parts.push(encodeResolvedExtendedDeviceSpec(entry.device, { series: normalizedSeries, extension: entry.extension }));
      parts.push(numberToBuffer(requireWireU32(entry.value, "dword value"), 4));
    });
    await this._request(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries, extension: true }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async writeRandomBits({ bitValues = {}, series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("writeRandomBits does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("random");
    const normalizedSeries = this.plcSeries;
    const items = normalizeItems(bitValues, this.addressProfile, this.plcProfile);
    if (items.length === 0) {
      throw new ValueError("bitValues must not be empty");
    }
    if (items.length > 0xff) {
      throw new ValueError("bitValues must be <= 255");
    }
    validateRandomBitWriteCount(items.length, normalizedSeries, "writeRandomBits", this.plcProfile);
    validateRandomWriteBitDevices(items.map(([device]) => device), this.plcProfile);
    validateNoBitWriteDuplicates(items.map(([device]) => device), "writeRandomBits");
    const parts = [Buffer.from([items.length])];
    items.forEach(([device, value]) => {
      parts.push(encodeDeviceSpec(device, { series: normalizedSeries }));
      const state = requireWireBit(value, "bit value");
      if (normalizedSeries === PLCSeries.IQR) {
        parts.push(numberToBuffer(state, 2));
      } else {
        parts.push(Buffer.from([state]));
      }
    });
    await this._request(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: true, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async writeRandomBitsExt({ bitValues = [], series, ...requestOptions } = {}) {
    if (series !== undefined) throw new ValueError("writeRandomBitsExt does not accept series; it is derived from plcProfile");
    this._ensureProfileFeatureAllowed("random");
    const normalizedSeries = this.plcSeries;
    const bitItems = normalizeExtendedValueItems(bitValues, "bitValues");
    if (bitItems.length === 0) {
      throw new ValueError("bitValues must not be empty");
    }
    if (bitItems.length > 0xff) {
      throw new ValueError("bitValues must be <= 255");
    }
    validateRandomBitWriteCount(
      bitItems.length,
      normalizedSeries,
      "writeRandomBitsExt",
      this.plcProfile,
      "random_write_bit_ext"
    );
    const bits = bitItems.map((entry) => ({
      ...this._parseExtendedDevice(entry.device),
      value: entry.value,
    }));
    validateRandomWriteBitDevices(bits.map((entry) => entry.device), this.plcProfile);
    validateNoExtendedBitWriteDuplicates(bits, "writeRandomBitsExt");

    const parts = [Buffer.from([bits.length])];
    bits.forEach((entry) => {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      parts.push(encodeResolvedExtendedDeviceSpec(entry.device, { series: normalizedSeries, extension: entry.extension }));
      const state = requireWireBit(entry.value, "bit value");
      if (normalizedSeries === PLCSeries.IQR) {
        parts.push(numberToBuffer(state, 2));
      } else {
        parts.push(Buffer.from([state]));
      }
    });
    await this._request(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: true, series: normalizedSeries, extension: true }),
      Buffer.concat(parts),
      requestOptions
    );
  }

  async readTypeName(options = {}) {
    this._ensureProfileFeatureAllowed("type_name");
    const response = await this._request(Command.READ_TYPE_NAME, 0x0000, Buffer.alloc(0), options);
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

  async remoteRun(options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("remoteRun options are required");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "force") || typeof options.force !== "boolean") {
      throw new ValueError("remoteRun force is required and must be a boolean");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "clearMode")) {
      throw new ValueError("remoteRun clearMode is required");
    }
    const clearMode = options.clearMode;
    if (![0, 1, 2].includes(clearMode)) {
      throw new ValueError(`clearMode must be one of 0,1,2: ${clearMode}`);
    }
    const mode = options.force ? 0x0003 : 0x0001;
    const payload = Buffer.concat([numberToBuffer(mode, 2), numberToBuffer(clearMode, 2)]);
    await this._request(Command.REMOTE_RUN, 0x0000, payload, options);
  }

  async remoteStop(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "force")) {
      throw new ValueError("remoteStop does not support force; Remote STOP request data is fixed to 01 00.");
    }
    await this._request(Command.REMOTE_STOP, 0x0000, numberToBuffer(0x0001, 2), options);
  }

  async remotePause(options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("remotePause options are required");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "force") || typeof options.force !== "boolean") {
      throw new ValueError("remotePause force is required and must be a boolean");
    }
    const mode = options.force ? 0x0003 : 0x0001;
    await this._request(Command.REMOTE_PAUSE, 0x0000, numberToBuffer(mode, 2), options);
  }

  async remoteLatchClear(options = {}) {
    await this._request(Command.REMOTE_LATCH_CLEAR, 0x0000, Buffer.from([0x01, 0x00]), options);
  }

  async remoteReset(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "subcommand") || Object.prototype.hasOwnProperty.call(options, "expectResponse")) {
      throw new ValueError("remoteReset does not accept subcommand or expectResponse; it always sends subcommand 0 and does not wait for a success response");
    }
    await this._request(Command.REMOTE_RESET, 0x0000, Buffer.from([0x01, 0x00]), { ...options, expectResponse: false });
  }

  async selfTestLoopback(data, options = {}) {
    if (!Buffer.isBuffer(data)) {
      throw new ValueError("selfTestLoopback data must be a Buffer");
    }
    if (data.length < 1 || data.length > 960) {
      throw new ValueError("selfTestLoopback data length must be in range 1..960");
    }
    for (const byte of data) {
      if (!((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46))) {
        throw new ValueError("selfTestLoopback data must contain only ASCII 0-9/A-F bytes");
      }
    }
    const expected = Buffer.from(data);
    const response = await this._request(
      Command.SELF_TEST,
      0x0000,
      Buffer.concat([numberToBuffer(expected.length, 2), expected]),
      options
    );
    if (response.data.length < 2) {
      throw new SlmpError("self-test response too short");
    }
    const declaredLength = response.data.readUInt16LE(0);
    if (declaredLength !== expected.length || response.data.length !== declaredLength + 2) {
      throw new SlmpError(
        `self-test response length mismatch: expected=${expected.length + 2}, declared=${declaredLength}, actual=${response.data.length}`
      );
    }
    const echoed = Buffer.from(response.data.subarray(2));
    if (!echoed.equals(expected)) {
      throw new SlmpError("self-test response payload mismatch");
    }
    return echoed;
  }

  /** Send the fixed Clear Error command as exactly one request. */
  async clearError(options = {}) {
    await this._request(Command.CLEAR_ERROR, 0x0000, Buffer.alloc(0), options);
  }

  async memoryReadWords(headAddress, wordLength, options = {}) {
    const count = normalizePoints(wordLength, "memoryReadWords");
    validateMemoryWordLength(count, "memoryReadWords");
    const response = await this._request(
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
    validateMemoryWordLength(items.length, "memoryWriteWords");
    const body = Buffer.alloc(items.length * 2);
    items.forEach((value, index) => body.writeUInt16LE(value, index * 2));
    await this._request(
      Command.MEMORY_WRITE,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(items.length, 2), body]),
      options
    );
  }

  async extendUnitReadBytes(headAddress, byteLength, moduleNo, options = {}) {
    const length = normalizePoints(byteLength, "extendUnitReadBytes");
    validateExtendUnitByteLength(length, "extendUnitReadBytes");
    const response = await this._request(
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
    validateExtendUnitWordLength(count, "extendUnitReadWords");
    const data = await this.extendUnitReadBytes(headAddress, count * 2, moduleNo, options);
    return decodeDeviceWords(data);
  }

  async extendUnitWriteBytes(headAddress, moduleNo, data, options = {}) {
    const raw = Buffer.from(data || Buffer.alloc(0));
    validateExtendUnitByteLength(raw.length, "extendUnitWriteBytes");
    await this._request(
      Command.EXTEND_UNIT_WRITE,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(raw.length, 2), numberToBuffer(moduleNo, 2), raw]),
      options
    );
  }

  async extendUnitWriteWords(headAddress, moduleNo, values, options = {}) {
    const items = normalizeWordValues(values, "extendUnitWriteWords");
    validateExtendUnitWordLength(items.length, "extendUnitWriteWords");
    const body = Buffer.alloc(items.length * 2);
    items.forEach((value, index) => body.writeUInt16LE(value, index * 2));
    await this.extendUnitWriteBytes(headAddress, moduleNo, body, options);
  }

  async readArrayLabels(points, options = {}) {
    const normalized = normalizeLabelArrayReadPoints(points);
    const response = await this._request(
      Command.LABEL_ARRAY_READ,
      0x0000,
      buildLabelArrayReadPayload(normalized, options.abbreviationLabels),
      options
    );
    return parseArrayLabelReadResponse(response.data, normalized.length);
  }

  async writeArrayLabels(points, options = {}) {
    await this._request(
      Command.LABEL_ARRAY_WRITE,
      0x0000,
      buildLabelArrayWritePayload(normalizeLabelArrayWritePoints(points), options.abbreviationLabels),
      options
    );
  }

  async readRandomLabels(labels, options = {}) {
    const normalized = normalizeLabelNames(labels);
    const response = await this._request(
      Command.LABEL_READ_RANDOM,
      0x0000,
      buildLabelRandomReadPayload(normalized, options.abbreviationLabels),
      options
    );
    return parseRandomLabelReadResponse(response.data, normalized.length);
  }

  async writeRandomLabels(points, options = {}) {
    await this._request(
      Command.LABEL_WRITE_RANDOM,
      0x0000,
      buildLabelRandomWritePayload(normalizeLabelRandomWritePoints(points), options.abbreviationLabels),
      options
    );
  }

  async remotePasswordUnlock(password, options = {}) {
    try {
      await this._sendRemotePasswordCommand(Command.REMOTE_PASSWORD_UNLOCK, password, options);
    } catch (error) {
      throw formatRemotePasswordUnlockError(error);
    }
  }

  async remotePasswordLock(password, options = {}) {
    await this._sendRemotePasswordCommand(Command.REMOTE_PASSWORD_LOCK, password, options);
  }

  async _sendRemotePasswordCommand(command, password, options = {}) {
    rejectProfileDerivedOverrides(options, "remote password command");
    rejectRemovedRemotePasswordLifecycleOption(options, "remote password command");
    if (this._hasRemotePassword()) {
      throw new ValueError("manual remote password commands are unavailable when managed remotePassword is configured");
    }
    await this._request(command, 0x0000, encodePassword(password, this.plcSeries), options);
  }

  async _sendManagedRemotePasswordCommand(command, password) {
    await this._requestInternal(
      command,
      0x0000,
      encodePassword(password, this.plcSeries),
      {},
      MANAGED_REMOTE_PASSWORD_COMMAND,
    );
  }

  _nextSerial() {
    return this._transport.nextSerial();
  }

  async _requestInternal(command, subcommand, data, options, internalContext = null) {
    rejectProfileDerivedOverrides(options, "request");
    const serial = this._nextSerial();
    const target = Object.prototype.hasOwnProperty.call(options, "target")
      ? normalizeTarget(options.target)
      : this.defaultTarget;
    const monitoringTimer = Object.prototype.hasOwnProperty.call(options, "monitoringTimer")
      ? normalizeMonitoringTimer(options.monitoringTimer)
      : this.monitoringTimer;
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
      await this._sendOnly(frame, options, internalContext);
      return { serial, target, endCode: 0, data: Buffer.alloc(0), raw: Buffer.alloc(0) };
    }
    const raw = await this._sendAndReceive(frame, serial, options, internalContext, target);
    const response = decodeResponse(raw, { frameType: this.frameType });
    const shouldRaise = Object.prototype.hasOwnProperty.call(options, "raiseOnError")
      ? options.raiseOnError
      : this.raiseOnError;
    if (shouldRaise && response.endCode !== 0) {
      throw createSlmpResponseError(response, command, subcommand);
    }
    return response;
  }

  async _sendOnly(frame, options = {}, internalContext = null) {
    if (internalContext !== MANAGED_REMOTE_PASSWORD_COMMAND) {
      await this.connect();
    }
    try {
      await this._transport.sendOnly(frame);
    } catch (error) {
      this._invalidateRemotePasswordState();
      throw error;
    }
    try {
      await this._closeTransport();
    } finally {
      this._invalidateRemotePasswordState();
    }
  }

  async _sendAndReceive(frame, serial, options = {}, internalContext = null, expectedTarget = null) {
    if (internalContext !== MANAGED_REMOTE_PASSWORD_COMMAND) {
      await this.connect();
    }
    try {
      return await this._transport.sendAndReceive(frame, serial, expectedTarget);
    } catch (error) {
      this._invalidateRemotePasswordState();
      throw error;
    }
  }

  _connectTcp() {
    return this._transport._connectTcp();
  }

  _connectUdp() {
    return this._transport._connectUdp();
  }

  _handleTcpData(chunk) {
    return this._transport.handleTcpData(chunk);
  }

  _awaitTcpFrame(serial, expectedTarget = null) {
    return this._transport.awaitTcpFrame(serial, expectedTarget);
  }

  _handleTcpFailure(error) {
    return this._transport.handleTcpFailure(error);
  }

  _rejectTcpPending(error) {
    return this._transport._rejectTcpPending(error);
  }

  _sendUdp(frame, serial, expectedTarget = null) {
    return this._transport.sendUdp(frame, serial, expectedTarget);
  }

  _handleUdpMessage(message) {
    return this._transport.handleUdpMessage(message);
  }

  _handleUdpFailure(error) {
    return this._transport.handleUdpFailure(error);
  }

  _rejectUdpPending(error) {
    return this._transport._rejectUdpPending(error);
  }
}

function normalizeItems(values, addressProfile, plcProfile) {
  if (Array.isArray(values)) {
    return values.map(([device, value]) => [
      requireExplicitPlcProfileForXY(device, plcProfile ?? addressProfile, parseDeviceForContext(device, addressProfile, plcProfile)),
      value,
    ]);
  }
  return Object.entries(values || {}).map(([device, value]) => [
    requireExplicitPlcProfileForXY(device, plcProfile ?? addressProfile, parseDeviceForContext(device, addressProfile, plcProfile)),
    value,
  ]);
}

function rejectProfileDerivedOverrides(options, label) {
  if (Object.prototype.hasOwnProperty.call(options, "series")) {
    throw new ValueError(`${label} does not accept series; it is derived from plcProfile`);
  }
  if (Object.prototype.hasOwnProperty.call(options, "serial")) {
    throw new ValueError(`${label} does not accept serial; 4E serial values are assigned internally`);
  }
}

function rejectRemovedRemotePasswordLifecycleOption(options, label) {
  if (Object.prototype.hasOwnProperty.call(options, "skipRemotePasswordLifecycle")) {
    throw new ValueError(`${label} does not accept skipRemotePasswordLifecycle`);
  }
}

function sameDeviceSpace(left, right) {
  return left.code === right.code && left.plcProfile === right.plcProfile;
}

function deviceRangesOverlap(left, leftPoints, right, rightPoints) {
  if (!sameDeviceSpace(left, right)) {
    return false;
  }
  const leftEnd = left.number + leftPoints - 1;
  const rightEnd = right.number + rightPoints - 1;
  return left.number <= rightEnd && right.number <= leftEnd;
}

function validateNoRandomWriteOverlap(wordDevices, dwordDevices, label) {
  for (let left = 0; left < wordDevices.length; left += 1) {
    for (let right = left + 1; right < wordDevices.length; right += 1) {
      if (deviceRangesOverlap(wordDevices[left], 1, wordDevices[right], 1)) {
        throw new ValueError(`${label} contains duplicate word destinations`);
      }
    }
    for (const dword of dwordDevices) {
      if (deviceRangesOverlap(wordDevices[left], 1, dword, 2)) {
        throw new ValueError(`${label} contains overlapping word/dword destinations`);
      }
    }
  }
  for (let left = 0; left < dwordDevices.length; left += 1) {
    for (let right = left + 1; right < dwordDevices.length; right += 1) {
      if (deviceRangesOverlap(dwordDevices[left], 2, dwordDevices[right], 2)) {
        throw new ValueError(`${label} contains overlapping dword destinations`);
      }
    }
  }
}

function validateNoBitWriteDuplicates(devices, label) {
  for (let left = 0; left < devices.length; left += 1) {
    for (let right = left + 1; right < devices.length; right += 1) {
      if (deviceRangesOverlap(devices[left], 1, devices[right], 1)) {
        throw new ValueError(`${label} contains duplicate bit destinations`);
      }
    }
  }
}

function validateNoBlockWriteOverlap(wordBlocks, bitBlocks) {
  const blocks = [...wordBlocks, ...bitBlocks];
  for (let left = 0; left < blocks.length; left += 1) {
    for (let right = left + 1; right < blocks.length; right += 1) {
      if (deviceRangesOverlap(blocks[left].device, blocks[left].values.length, blocks[right].device, blocks[right].values.length)) {
        throw new ValueError("writeBlock contains overlapping destinations");
      }
    }
  }
}

function sameExtension(left, right) {
  return [
    "extensionSpecification",
    "extensionSpecificationModification",
    "deviceModificationIndex",
    "deviceModificationFlags",
    "directMemorySpecification",
  ].every((key) => left[key] === right[key]);
}

function validateNoExtendedRandomWriteOverlap(words, dwords, label) {
  const sameRoute = (left, right) => sameExtension(left.extension, right.extension);
  for (let left = 0; left < words.length; left += 1) {
    for (let right = left + 1; right < words.length; right += 1) {
      if (sameRoute(words[left], words[right]) && deviceRangesOverlap(words[left].device, 1, words[right].device, 1)) {
        throw new ValueError(`${label} contains duplicate word destinations`);
      }
    }
    for (const dword of dwords) {
      if (sameRoute(words[left], dword) && deviceRangesOverlap(words[left].device, 1, dword.device, 2)) {
        throw new ValueError(`${label} contains overlapping word/dword destinations`);
      }
    }
  }
  for (let left = 0; left < dwords.length; left += 1) {
    for (let right = left + 1; right < dwords.length; right += 1) {
      if (sameRoute(dwords[left], dwords[right]) && deviceRangesOverlap(dwords[left].device, 2, dwords[right].device, 2)) {
        throw new ValueError(`${label} contains overlapping dword destinations`);
      }
    }
  }
}

function validateNoExtendedBitWriteDuplicates(bits, label) {
  for (let left = 0; left < bits.length; left += 1) {
    for (let right = left + 1; right < bits.length; right += 1) {
      if (sameExtension(bits[left].extension, bits[right].extension) &&
          deviceRangesOverlap(bits[left].device, 1, bits[right].device, 1)) {
        throw new ValueError(`${label} contains duplicate bit destinations`);
      }
    }
  }
}

function parseDeviceForContext(device, addressProfile, plcProfile) {
  if (plcProfile == null) {
    return parseRawDevice(device, { addressProfile });
  }
  return parseDevice(device, { addressProfile, plcProfile });
}

function normalizeExtendedDeviceEntries(values, label) {
  return Array.from(values || [], (entry) => {
    if (Array.isArray(entry) ||
        (entry && typeof entry === "object" &&
         (Object.prototype.hasOwnProperty.call(entry, "extension") || Object.prototype.hasOwnProperty.call(entry, "ext")))) {
      throw new ValueError(`${label} entries no longer accept raw extension fields; use a qualified address and SlmpExtendedDevice modification`);
    }
    if (entry === undefined || entry === null || entry === "") {
      throw new ValueError(`${label} entries must include a device`);
    }
    return entry;
  });
}

function normalizeExtendedValueItems(values, label) {
  if (!Array.isArray(values) && values && typeof values === "object") {
    return Object.entries(values).map(([device, value]) => ({ device, value }));
  }
  return Array.from(values || [], (entry) => {
    if (Array.isArray(entry)) {
      if (entry.length !== 2) {
        throw new ValueError(`${label} entries must be exact [device, value] tuples`);
      }
      const [device, value] = entry;
      return { device, value };
    }
    if (entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "device")) {
      if (Object.prototype.hasOwnProperty.call(entry, "extension") || Object.prototype.hasOwnProperty.call(entry, "ext")) {
        throw new ValueError(`${label} entries no longer accept raw extension fields; use SlmpExtendedDevice`);
      }
      return {
        device: entry.device,
        value: entry.value,
      };
    }
    throw new ValueError(`${label} entries must be [device, value] tuples or { device, value } objects`);
  });
}

function normalizeBlockItems(values, label, addressProfile, plcProfile) {
  return Array.from(values || [], (item) => {
    if (Array.isArray(item)) {
      const [device, points] = item;
      return {
        device: requireExplicitPlcProfileForXY(device, plcProfile ?? addressProfile, parseDeviceForContext(device, addressProfile, plcProfile)),
        points: normalizePoints(points, label),
      };
    }

    if (!item || typeof item !== "object") {
      throw new ValueError(`${label} entries must be [device, points] tuples or { device, points } objects`);
    }

    return {
      device: requireExplicitPlcProfileForXY(
        item.device,
        plcProfile ?? addressProfile,
        parseDeviceForContext(item.device, addressProfile, plcProfile)
      ),
      points: normalizePoints(item.points, label),
    };
  });
}

function normalizeBlockWriteItems(values, label, addressProfile, plcProfile) {
  return Array.from(values || [], (item) => {
    if (Array.isArray(item)) {
      const [device, rawValues] = item;
      return {
        device: requireExplicitPlcProfileForXY(device, plcProfile ?? addressProfile, parseDeviceForContext(device, addressProfile, plcProfile)),
        values: normalizeBlockValues(rawValues, label),
      };
    }

    if (!item || typeof item !== "object") {
      throw new ValueError(`${label} entries must be [device, values] tuples or { device, values } objects`);
    }

    return {
      device: requireExplicitPlcProfileForXY(
        item.device,
        plcProfile ?? addressProfile,
        parseDeviceForContext(item.device, addressProfile, plcProfile)
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
  return items.map((value, index) => requireWireU16(value, `${label}[${index}]`));
}

function normalizeWordValues(values, label) {
  const items = Array.from(values || []);
  if (items.length === 0) {
    throw new ValueError(`${label} values must not be empty`);
  }
  if (items.length > 0xffff) {
    throw new ValueError(`${label} values must be <= 65535`);
  }
  return items.map((value, index) => requireWireU16(value, `${label}[${index}]`));
}

function requireWireU16(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new ValueError(`${label} must be an integer in range 0..65535: ${String(value)}`);
  }
  return value;
}

function requireWireU32(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new ValueError(`${label} must be an integer in range 0..4294967295: ${String(value)}`);
  }
  return value;
}

function requireWireBit(value, label) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && (value === 0 || value === 1)) return value;
  throw new ValueError(`${label} must be boolean or the number 0 or 1: ${String(value)}`);
}

function extendedResultKey(entry) {
  const extension = entry.extension;
  const flags = extension.deviceModificationFlags;
  if (flags === 0) return entry.address;
  if (flags === 0x40) return `${entry.address}+Z${extension.deviceModificationIndex}`;
  if (flags === 0x80) return `${entry.address}+LZ${extension.deviceModificationIndex}`;
  if (flags === 0x08) return `${entry.address}+INDIRECT`;
  throw new ValueError(`unsupported Extended Device modification flags: ${flags}`);
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
  if (labels === undefined) {
    return [];
  }
  if (!Array.isArray(labels)) {
    throw new ValueError("abbreviationLabels must be an array of strings");
  }
  const items = labels;
  checkU16(items.length, "abbreviation label count");
  return items.map((label) => {
    if (typeof label !== "string") {
      throw new ValueError("abbreviation label must be a string");
    }
    const text = label;
    if (!text.trim()) {
      throw new ValueError("label must not be empty");
    }
    return text;
  });
}

function validateAbbreviationReferences(label, abbreviationCount) {
  const text = String(label);
  if (!text.trim()) {
    throw new ValueError("label must not be empty");
  }
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "%") {
      continue;
    }
    const digitStart = index + 1;
    let digitEnd = digitStart;
    while (digitEnd < text.length && text[digitEnd] >= "0" && text[digitEnd] <= "9") {
      digitEnd += 1;
    }
    const reference = digitEnd === digitStart ? 0 : Number(text.slice(digitStart, digitEnd));
    if (!Number.isSafeInteger(reference) || reference < 1 || reference > abbreviationCount) {
      throw new ValueError(
        `label contains an invalid abbreviation reference; use %1 through %${abbreviationCount}`
      );
    }
    index = digitEnd - 1;
  }
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
    validateAbbreviationReferences(point.label, abbrevs.length);
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
    validateAbbreviationReferences(point.label, abbrevs.length);
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
  labels.forEach((label) => {
    validateAbbreviationReferences(label, abbrevs.length);
    parts.push(encodeLabelName(label));
  });
  return Buffer.concat(parts);
}

function buildLabelRandomWritePayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    validateAbbreviationReferences(point.label, abbrevs.length);
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
  const normalized = validateRemotePassword(password, series);
  const raw = Buffer.from(normalized, "ascii");
  return Buffer.concat([numberToBuffer(raw.length, 2), raw]);
}

function validateRemotePassword(password, series) {
  if (typeof password !== "string" || password.length === 0) {
    throw new ValueError("password is required and must be a non-empty string");
  }
  if (!/^[\x20-\x7E]+$/u.test(password)) {
    throw new ValueError("password must contain printable ASCII characters only");
  }
  const length = Buffer.byteLength(password, "ascii");
  if (series === PLCSeries.IQR) {
    if (length < 6 || length > 32) {
      throw new ValueError(`iQ-R password length must be 6..32: ${length}`);
    }
    return password;
  }
  if (length !== 4) {
    throw new ValueError(`Q/L password length must be exactly 4: ${length}`);
  }
  return password;
}

function numberToBuffer(value, size) {
  const buffer = Buffer.alloc(size);
  if (size === 2) {
    buffer.writeUInt16LE(requireWireU16(value, "value"), 0);
    return buffer;
  }
  if (size === 4) {
    buffer.writeUInt32LE(requireWireU32(value, "value"), 0);
    return buffer;
  }
  throw new ValueError(`unsupported integer size: ${size}`);
}

module.exports = {
  decodeCpuOperationState,
  SlmpCpuOperationStatus,
  SlmpClient,
};
