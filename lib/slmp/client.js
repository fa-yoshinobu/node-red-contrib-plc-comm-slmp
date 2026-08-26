"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");

const { Command, DEVICE_CODES, DeviceUnit, FrameType, PLCSeries } = require("./constants");
const {
  ValueError,
  _decodeOwnedResponse: decodeOwnedResponse,
  decodeDeviceDwords,
  decodeDeviceWords,
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
  _prepareResolvedExtendedDeviceSpec: prepareResolvedExtendedDeviceSpec,
  _resolveSemanticExtendedDevice: resolveSemanticExtendedDevice,
  _validateWireDeviceSpan: validateWireDeviceSpan,
  _writePreparedExtendedDeviceSpec: writePreparedExtendedDeviceSpec,
  unpackBitValues,
} = require("./core");
const {
  getProfileLimit,
  isProfileReadOnlyDevice,
} = require("./capability-profiles");
const { ensureProfileFeatureAllowedInternal } = require("./profile-guard-internal");
const { formatEndCodeHex } = require("./error-codes");
const {
  SlmpClosedError,
  SlmpError,
  SlmpNotConnectedError,
  SlmpOperationOutcomeUnknownError,
  SlmpTimeoutError,
} = require("./errors");
const { normalizeIpv4Host } = require("./network");
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
const MAX_REQUEST_PAYLOAD_LENGTH = 0xffff - 6;
const MAX_IPV4_UDP_DATAGRAM_LENGTH = 65507;
const remotePasswords = new WeakMap();
const MANAGED_REMOTE_PASSWORD_COMMAND = Symbol("managedRemotePasswordCommand");
const malformedResponses = new WeakSet();
const preparedRequests = new WeakMap();
const responsePhases = new WeakSet();
const preparedBitInWordPlans = new WeakMap();
const preparedRandomReadPlans = new WeakMap();
const STATE_CHANGING_COMMANDS = new Set([
  Command.DEVICE_WRITE,
  Command.DEVICE_WRITE_RANDOM,
  Command.DEVICE_WRITE_BLOCK,
  Command.MONITOR_REGISTER,
  Command.LABEL_ARRAY_WRITE,
  Command.LABEL_WRITE_RANDOM,
  Command.MEMORY_WRITE,
  Command.EXTEND_UNIT_WRITE,
  Command.REMOTE_RUN,
  Command.REMOTE_STOP,
  Command.REMOTE_PAUSE,
  Command.REMOTE_LATCH_CLEAR,
  Command.REMOTE_RESET,
  Command.CLEAR_ERROR,
  Command.REMOTE_PASSWORD_UNLOCK,
  Command.REMOTE_PASSWORD_LOCK,
]);
const READ_ONLY_COMMANDS = new Set([
  Command.DEVICE_READ,
  Command.DEVICE_READ_RANDOM,
  Command.DEVICE_READ_BLOCK,
  Command.MONITOR,
  Command.LABEL_ARRAY_READ,
  Command.LABEL_READ_RANDOM,
  Command.MEMORY_READ,
  Command.EXTEND_UNIT_READ,
  Command.SELF_TEST,
  Command.READ_TYPE_NAME,
]);
const SlmpCpuOperationStatus = Object.freeze({
  Unknown: "Unknown",
  Run: "Run",
  Stop: "Stop",
  Pause: "Pause",
});

function profileLimitValue(plcProfile, key, fallback) {
  const limit = getProfileLimit(plcProfile, key);
  return limit && Number.isInteger(limit.maxPoints) ? limit.maxPoints : fallback;
}

function directAccessPointLimit(bitUnit, plcProfile, access) {
  const direction = access === "write" ? "write" : "read";
  if (!bitUnit) {
    return profileLimitValue(plcProfile, `direct_word_${direction}`, DIRECT_WORD_POINT_LIMIT);
  }
  return profileLimitValue(plcProfile, `direct_bit_${direction}`, DIRECT_BIT_POINT_LIMIT);
}

function selectExtendedEntrySeries(entries, series, operation) {
  const hasLinkDirect = entries.some((entry) => entry.extension.directMemorySpecification === 0xf9);
  const hasOtherLayout = entries.some((entry) => entry.extension.directMemorySpecification !== 0xf9);
  if (series === PLCSeries.IQR && hasLinkDirect && hasOtherLayout) {
    throw new ValueError(
      `${operation} cannot mix J link-direct Q/L entries with 13-byte iQ-R extended entries in one request`
    );
  }
  return hasLinkDirect ? PLCSeries.QL : series;
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
  const countLimit = profileLimit && Number.isInteger(profileLimit.maxPoints) ? profileLimit.maxPoints : null;
  if (countLimit !== null && total > countLimit) {
    throw new ValueError(
      `${label} word/dword access points out of range (1..${countLimit}): word=${wordPoints}, dword=${dwordPoints}`
    );
  }
  const weighted = wordPoints * 12 + dwordPoints * 14;
  const limit =
    profileLimit && Number.isInteger(profileLimit.weightedMaxPoints)
      ? profileLimit.weightedMaxPoints
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

function maxRequestPayloadLength(transportType, frameType) {
  if (transportType !== "udp") {
    return MAX_REQUEST_PAYLOAD_LENGTH;
  }
  const requestHeaderSize = frameType === FrameType.FRAME_4E ? 19 : 15;
  return MAX_IPV4_UDP_DATAGRAM_LENGTH - requestHeaderSize;
}

function validateRequestPayloadLength(payloadLength, maximum = MAX_REQUEST_PAYLOAD_LENGTH) {
  if (!Number.isSafeInteger(payloadLength) || payloadLength < 0 || payloadLength > maximum) {
    throw new ValueError(
      `request payload length out of range: actual=${payloadLength}, maximum=${maximum}`
    );
  }
}

function addRequestPayloadLength(current, addition) {
  const total = current + addition;
  validateRequestPayloadLength(total);
  return total;
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

function requireBitDevice(device, operation) {
  if (DEVICE_CODES[device.code]?.unit !== DeviceUnit.BIT) {
    throw new ValueError(`${operation} requires a bit device; received ${device.code}`);
  }
}

function requireWordDevice(device, operation) {
  if (DEVICE_CODES[device.code]?.unit !== DeviceUnit.WORD) {
    throw new ValueError(`${operation} requires a word device; received ${device.code}`);
  }
}

function validateDirectReadDevice(ref, points, bitUnit) {
  if (QUALIFIED_ONLY_CODES.has(ref.code)) {
    throw new ValueError("Direct device access does not support standalone G/HG. Use U-qualified extended access.");
  }
  if (bitUnit) {
    requireBitDevice(ref, "Direct bit read");
  }
  if (bitUnit && LONG_TIMER_STATE_DIRECT_CODES.has(ref.code)) {
    throw new ValueError(
      `Direct bit read is not supported for ${ref.code}. Use readTyped or an explicit 4-word long-timer status helper instead.`
    );
  }
  if (!bitUnit && LONG_TIMER_CURRENT_BLOCK_CODES.has(ref.code) && points % 4 !== 0) {
    throw new ValueError(
      `Direct read of ${ref.code} requires 4-word blocks. Requested points=${points}; use a multiple of 4 or the long timer helpers.`
    );
  }
  if (!bitUnit && RANDOM_DWORD_ONLY_CODES.has(ref.code)) {
    throw new ValueError(`Direct word read is not supported for ${ref.code}. Use readTyped for explicit 32-bit access.`);
  }
}

function directConsumedDeviceNumbers(ref, wirePoints, bitUnit) {
  if (bitUnit) {
    return wirePoints;
  }
  if (LONG_TIMER_CURRENT_BLOCK_CODES.has(ref.code)) {
    return wirePoints / 4;
  }
  if (DEVICE_CODES[ref.code]?.unit === DeviceUnit.BIT) {
    const consumed = wirePoints * 16;
    if (!Number.isSafeInteger(consumed)) {
      throw new ValueError(`Direct word access consumed device span is too large: ${wirePoints}`);
    }
    return consumed;
  }
  return wirePoints;
}

function randomConsumedDeviceNumbers(ref, dword) {
  if (dword && (LONG_CURRENT_VALUE_CODES.has(ref.code) || DWORD_ONLY_DIRECT_CODES.has(ref.code))) {
    return 1;
  }
  const wordPoints = dword ? 2 : 1;
  if (DEVICE_CODES[ref.code]?.unit === DeviceUnit.BIT) {
    return wordPoints * 16;
  }
  return wordPoints;
}

function validateRandomLikeDeviceSpans(wordDevices, dwordDevices, series, label) {
  wordDevices.forEach((device) => {
    validateWireDeviceSpan(device.number, randomConsumedDeviceNumbers(device, false), series, `${label} word`);
  });
  dwordDevices.forEach((device) => {
    validateWireDeviceSpan(device.number, randomConsumedDeviceNumbers(device, true), series, `${label} dword`);
  });
}

function validateBitDeviceSpans(devices, series, label) {
  devices.forEach((device) => {
    validateWireDeviceSpan(device.number, 1, series, `${label} bit`);
  });
}

function validateBlockDeviceSpans(wordBlocks, bitBlocks, series, label, getWirePoints) {
  wordBlocks.forEach((block) => {
    const wirePoints = getWirePoints(block);
    validateWireDeviceSpan(
      block.device.number,
      directConsumedDeviceNumbers(block.device, wirePoints, false),
      series,
      `${label} word block`
    );
  });
  bitBlocks.forEach((block) => {
    const wirePoints = getWirePoints(block);
    validateWireDeviceSpan(
      block.device.number,
      directConsumedDeviceNumbers(block.device, wirePoints, false),
      series,
      `${label} bit block`
    );
  });
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
  if (bitUnit) {
    requireBitDevice(ref, "Direct bit write");
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
      `${commandLabel} does not support LTS/LTC/LSTS/LSTC. Use readTyped or an explicit long-timer status helper instead.`
    );
  }
  if ([...wordDevices, ...dwordDevices].some((device) => LONG_COUNTER_CONTACT_CODES.has(device.code))) {
    throw new ValueError(
      `${commandLabel} does not support LCS/LCC. Use readTyped for the explicit Direct bit route.`
    );
  }
  if (wordDevices.some((device) => LONG_CURRENT_VALUE_CODES.has(device.code) || DWORD_ONLY_DIRECT_CODES.has(device.code))) {
    throw new ValueError(
      `${commandLabel} does not support LTN/LSTN/LCN/LZ as word entries. Use dword entries or readTyped with 'D' or 'L' instead.`
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
  for (const device of bitDevices) {
    requireBitDevice(device, "Write Random (0x1402) bitValues");
  }
  const readOnlyDevice = bitDevices.find((device) => isReadOnlyCode(device.code, plcProfile));
  if (readOnlyDevice) {
    throw new ValueError(randomReadOnlyMessage(readOnlyDevice.code, plcProfile));
  }
  if (bitDevices.some((device) => QUALIFIED_ONLY_CODES.has(device.code))) {
    throw new ValueError("Write Random (0x1402) does not support standalone G/HG bit entries. Use U-qualified word access.");
  }
}

function validateBlockReadDevices(wordBlocks, bitBlocks) {
  wordBlocks.forEach((block) => requireWordDevice(block.device, "Read Block (0x0406) wordBlocks"));
  bitBlocks.forEach((block) => requireBitDevice(block.device, "Read Block (0x0406) bitBlocks"));
  if ([...wordBlocks, ...bitBlocks].some((block) => QUALIFIED_ONLY_CODES.has(block.device.code))) {
    throw new ValueError("Read Block (0x0406) does not support standalone G/HG. Use U-qualified extended access.");
  }
  const invalidLongCurrentBlock = wordBlocks.find((block) => LONG_TIMER_CURRENT_BLOCK_CODES.has(block.device.code) && block.points % 4 !== 0);
  if (invalidLongCurrentBlock) {
    throw new ValueError(
      `Read Block (0x0406) direct read of ${invalidLongCurrentBlock.device.code} requires 4-word blocks. Requested points=${invalidLongCurrentBlock.points}; use readTyped or an explicit long-timer helper for 32-bit current values.`
    );
  }
  if ([...wordBlocks, ...bitBlocks].some((block) => RANDOM_DWORD_ONLY_CODES.has(block.device.code))) {
    throw new ValueError(
      "Read Block (0x0406) does not support LCN/LZ as word or bit blocks. Use readTyped/readNamed so random dword read is selected."
    );
  }
  if ([...wordBlocks, ...bitBlocks].some((block) => LONG_COUNTER_CONTACT_CODES.has(block.device.code))) {
    throw new ValueError(
      "Read Block (0x0406) does not support LCS/LCC. Use readTyped for the explicit Direct bit route."
    );
  }
}

function validateBlockWriteDevices(wordBlocks, bitBlocks, plcProfile) {
  wordBlocks.forEach((block) => requireWordDevice(block.device, "Write Block (0x1406) wordBlocks"));
  bitBlocks.forEach((block) => requireBitDevice(block.device, "Write Block (0x1406) bitBlocks"));
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

  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data || Buffer.alloc(0));
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
        "Entry Monitor Device (0x0801) does not support LCS/LCC. Use readTyped for the explicit Direct bit route."
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
  if (error instanceof SlmpOperationOutcomeUnknownError) {
    return error;
  }
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

function createMalformedResponseError(message, response = null) {
  const error = new SlmpError(`Malformed SLMP response: ${message}`, response
    ? { data: response.data, errorInfo: response.errorInfo }
    : {});
  malformedResponses.add(error);
  return error;
}

function errorInformationMatchesRequest(errorInfo, target, command, subcommand) {
  return errorInfo.network === target.network
    && errorInfo.station === target.station
    && errorInfo.moduleIO === target.moduleIO
    && errorInfo.multidrop === target.multidrop
    && errorInfo.command === Number(command)
    && errorInfo.subcommand === Number(subcommand);
}

function decodeEmptyAcknowledgement(response) {
  if (response.endCode === 0 && response.data.length !== 0) {
    throw createMalformedResponseError(
      `acknowledgement contained ${response.data.length} unexpected data byte(s)`,
      response,
    );
  }
  return undefined;
}

function checkedPayloadLength(current, addition, label) {
  const total = current + addition;
  if (!Number.isSafeInteger(total)) {
    throw new ValueError(`${label} payload length is outside the supported integer range`);
  }
  return total;
}

function validatePreparedPayloadLength(length, maximumLength, label) {
  if (length > maximumLength) {
    throw new ValueError(`${label} payload length exceeds the protocol limit`);
  }
}

function prepareExtendedLayouts(
  entries,
  series,
  initialLength,
  label,
  valueSize = 0,
  valueValidator = null,
) {
  let length = initialLength;
  const layouts = entries.map((entry) => {
    const specification = prepareResolvedExtendedDeviceSpec(entry.device, {
      series,
      extension: entry.extension,
    });
    const value = valueValidator ? valueValidator(entry.value) : undefined;
    length = checkedPayloadLength(length, specification.length + valueSize, label);
    return Object.freeze({ specification, value });
  });
  return Object.freeze({ layouts: Object.freeze(layouts), length });
}

function writeExtendedLayouts(payload, offset, prepared, valueSize = 0) {
  let cursor = offset;
  for (const entry of prepared.layouts) {
    cursor = writePreparedExtendedDeviceSpec(payload, cursor, entry.specification);
    if (valueSize === 2) {
      payload.writeUInt16LE(entry.value, cursor);
      cursor += 2;
    } else if (valueSize === 4) {
      payload.writeUInt32LE(entry.value, cursor);
      cursor += 4;
    } else if (valueSize === 1) {
      payload.writeUInt8(entry.value, cursor);
      cursor += 1;
    }
  }
  return cursor;
}

function encodeExtendedDeviceListPayload(words, dwords, series, maximumLength, label) {
  const entries = [...words, ...dwords];
  const prepared = prepareExtendedLayouts(entries, series, 2, label);
  validatePreparedPayloadLength(prepared.length, maximumLength, label);
  const payload = Buffer.alloc(prepared.length);
  payload.writeUInt8(words.length, 0);
  payload.writeUInt8(dwords.length, 1);
  writeExtendedLayouts(payload, 2, prepared);
  return payload;
}

function encodeExtendedWordWritePayload(words, dwords, series, maximumLength, label) {
  const preparedWords = prepareExtendedLayouts(
    words,
    series,
    2,
    label,
    2,
    (value) => requireWireU16(value, "word value"),
  );
  const preparedDwords = prepareExtendedLayouts(
    dwords,
    series,
    preparedWords.length,
    label,
    4,
    (value) => requireWireU32(value, "dword value"),
  );
  validatePreparedPayloadLength(preparedDwords.length, maximumLength, label);
  const payload = Buffer.alloc(preparedDwords.length);
  payload.writeUInt8(words.length, 0);
  payload.writeUInt8(dwords.length, 1);
  let cursor = writeExtendedLayouts(payload, 2, preparedWords, 2);
  writeExtendedLayouts(payload, cursor, preparedDwords, 4);
  return payload;
}

function encodeExtendedBitWritePayload(bits, series, maximumLength, label) {
  const valueSize = series === PLCSeries.IQR ? 2 : 1;
  const prepared = prepareExtendedLayouts(
    bits,
    series,
    1,
    label,
    valueSize,
    (value) => requireWireBit(value, "bit value"),
  );
  validatePreparedPayloadLength(prepared.length, maximumLength, label);
  const payload = Buffer.alloc(prepared.length);
  payload.writeUInt8(bits.length, 0);
  writeExtendedLayouts(payload, 1, prepared, valueSize);
  return payload;
}

function createResponsePhases(validate, materialize) {
  const phases = Object.freeze({ validate, materialize });
  responsePhases.add(phases);
  return phases;
}

function decodeWithResponsePhases(decoder, response) {
  if (!responsePhases.has(decoder)) return decoder(response);
  return decoder.materialize(decoder.validate(response));
}

function validateExactResponseData(response, expectedLength, label) {
  if (response.data.length !== expectedLength) {
    throw createMalformedResponseError(
      `${label}: expected=${expectedLength}, actual=${response.data.length}`,
      response,
    );
  }
  return response.data;
}

function createAbortError(reason) {
  const error = reason === undefined
    ? new Error("SLMP prepared read was aborted")
    : new Error("SLMP prepared read was aborted", { cause: reason });
  error.name = "AbortError";
  return error;
}

function validateBitResponseData(response, count) {
  const data = validateExactResponseData(response, Math.ceil(count / 2), "bit data length mismatch");
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;
    if (high > 1 || (index * 2 + 1 < count && low > 1)) {
      throw createMalformedResponseError(
        `bit data contains an invalid nibble: 0x${byte.toString(16).padStart(2, "0")}`,
        response,
      );
    }
  }
  return data;
}

class SlmpClient {
  constructor(options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("options is required and must be an object");
    }
    const source = options;
    this.host = normalizeIpv4Host(source.host);
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

    this._requestChain = Promise.resolve();
    this._completionChain = Promise.resolve();
    this._exclusiveContext = new AsyncLocalStorage();
    this._clientGeneration = 0;
    this._closing = false;
    this._closePromise = null;
    this._activeOperationCount = 0;
    this._queuedOperationCount = 0;
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
    return this._enqueueOperation(async (generation) => {
      await this._connectTransport();
      this._requireLifecycleGeneration(generation, false, false);
      await this._unlockRemotePasswordIfConfigured(null, generation);
      this._requireLifecycleGeneration(generation, false, false);
    });
  }

  trafficStats() {
    if (arguments.length !== 0) {
      throw new ValueError("trafficStats does not accept arguments");
    }
    return this._transport.trafficStats();
  }

  close() {
    if (this._closePromise) {
      return this._closePromise;
    }
    const closePromise = this._performClose();
    this._closePromise = closePromise;
    closePromise.then(
      () => {
        if (this._closePromise === closePromise) this._closePromise = null;
      },
      () => {
        if (this._closePromise === closePromise) this._closePromise = null;
      },
    );
    return closePromise;
  }

  async _performClose() {
    const skippedManagedPasswordLock = this._hasRemotePassword()
      && (this._activeOperationCount > 0 || this._queuedOperationCount > 0);
    this._closing = true;
    this._clientGeneration += 1;
    let lockError = null;
    let closeError = null;
    if (this._activeOperationCount === 0 && this._queuedOperationCount === 0) {
      try {
        await this._lockRemotePasswordIfConfigured();
      } catch (error) {
        lockError = formatRemotePasswordLockError(error);
      }
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
      this._closing = false;
    }
    if (skippedManagedPasswordLock) {
      const skippedLockError = new SlmpClosedError(
        "Managed remote password lock was not sent because close cancelled active or queued work"
      );
      throw new SlmpOperationOutcomeUnknownError(
        "Managed remote password lock outcome is unknown after close",
        "closed",
        {
          cause: closeError
            ? new AggregateError([skippedLockError, closeError], "SLMP managed-password close failures")
            : skippedLockError,
        }
      );
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

  async _connectTransport(deadline = null) {
    await this._transport.connect(deadline);
    const generation = this._transport.connectionGeneration();
    if (this._observedTransportGeneration !== generation) {
      this._invalidateRemotePasswordState();
      this._observedTransportGeneration = generation;
    }
  }

  async _closeTransport() {
    await this._transport.close();
  }

  async _requireTransactionTimeRemaining(deadline, phase) {
    if (deadline === null || deadline === undefined || performance.now() < deadline) {
      return;
    }
    const error = new SlmpTimeoutError(`SLMP transaction deadline expired ${phase}`);
    try {
      await this._closeTransport();
    } catch (closeError) {
      error.closeError = closeError;
    }
    this._invalidateRemotePasswordState();
    this._observedTransportGeneration = null;
    throw error;
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

  async _unlockRemotePasswordIfConfigured(deadline = null, lifecycleGeneration = null) {
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
          await this._sendManagedRemotePasswordCommand(
            Command.REMOTE_PASSWORD_UNLOCK,
            remotePasswords.get(this),
            deadline,
            lifecycleGeneration,
          );
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

  _prepareRequest(command, subcommand, data, options = {}) {
    if (subcommand === undefined || subcommand === null) {
      throw new ValueError("subcommand is required for the raw request API");
    }
    if (data === undefined || data === null || (!Buffer.isBuffer(data) && !(data instanceof Uint8Array))) {
      throw new ValueError("data is required for the raw request API and must be a byte buffer");
    }
    if (Object.prototype.hasOwnProperty.call(options, "raiseOnError") && typeof options.raiseOnError !== "boolean") {
      throw new ValueError("raiseOnError must be a boolean when provided");
    }
    if (Object.prototype.hasOwnProperty.call(options, "stateChanging") && typeof options.stateChanging !== "boolean") {
      throw new ValueError("stateChanging must be a boolean when provided");
    }
    rejectRemovedRemotePasswordLifecycleOption(options, "request");
    rejectProfileDerivedOverrides(options, "request");
    const normalizedCommand = Number(command);
    const normalizedSubcommand = Number(subcommand);
    const requestData = Buffer.from(data);
    validateMonitorRegisterRequest(normalizedCommand, normalizedSubcommand, requestData, this.plcSeries, this.plcProfile);
    const requestOptions = {
      ...options,
      target: Object.freeze(Object.prototype.hasOwnProperty.call(options, "target")
        ? normalizeTarget(options.target)
        : { ...this.defaultTarget }),
      monitoringTimer: Object.prototype.hasOwnProperty.call(options, "monitoringTimer")
        ? normalizeMonitoringTimer(options.monitoringTimer)
        : this.monitoringTimer,
      raiseOnError: Object.prototype.hasOwnProperty.call(options, "raiseOnError")
        ? options.raiseOnError
        : this.raiseOnError,
      stateChanging: classifyStateChangingCommand(normalizedCommand, options),
    };
    validateRequestPayloadLength(
      requestData.length,
      maxRequestPayloadLength(this.transportType, this.frameType)
    );
    Object.freeze(requestOptions);
    const prepared = Object.freeze({
      command: normalizedCommand,
      subcommand: normalizedSubcommand,
      requestData,
      requestOptions,
    });
    preparedRequests.set(prepared, this);
    return prepared;
  }

  _request(command, subcommand, data, options = {}) {
    return this._dispatchPreparedRequest(this._prepareRequest(command, subcommand, data, options), null);
  }

  _requestAcknowledged(command, subcommand, data, options = {}) {
    return this._requestDecoded(command, subcommand, data, options, decodeEmptyAcknowledgement);
  }

  _requestDecoded(command, subcommand, data, options, responseDecoder) {
    if (typeof responseDecoder !== "function" && !responsePhases.has(responseDecoder)) {
      throw new ValueError("responseDecoder must be a function or internal response phase descriptor");
    }
    if (this._request !== SlmpClient.prototype._request ||
        this._requestInternal !== SlmpClient.prototype._requestInternal) {
      return Promise.resolve(this._request(command, subcommand, data, options))
        .then((response) => decodeWithResponsePhases(responseDecoder, response));
    }
    return this._dispatchPreparedRequest(this._prepareRequest(command, subcommand, data, options), responseDecoder);
  }

  _dispatchPreparedRequest(prepared, responseDecoder) {
    const context = this._exclusiveContext.getStore();
    if (context?.client === this) {
      if (this._closing || context.generation !== this._clientGeneration) {
        return Promise.reject(new SlmpClosedError("SLMP client was closed before the queued operation could send"));
      }
      return this._executePreparedRequest(prepared, null, null, context.generation, responseDecoder)
        .then((token) => responsePhases.has(responseDecoder) ? responseDecoder.materialize(token) : token);
    }
    return this._enqueueOperation(
      (generation) => this._executePreparedRequest(prepared, null, null, generation, responseDecoder),
      responsePhases.has(responseDecoder) ? responseDecoder.materialize : null,
    );
  }

  _enqueueOperation(operation, materialize = null, admission = null) {
    if (this._closing) {
      return Promise.reject(new SlmpClosedError("SLMP client is closing"));
    }
    const generation = this._clientGeneration;
    this._queuedOperationCount += 1;
    if (admission) admission.countedAsQueued = true;
    const wireTask = this._requestChain.then(async () => {
      if (!admission || admission.countedAsQueued) {
        this._queuedOperationCount -= 1;
        if (admission) admission.countedAsQueued = false;
      }
      if (this._closing || generation !== this._clientGeneration) {
        throw new SlmpClosedError("SLMP client was closed before the queued operation could send");
      }
      this._activeOperationCount += 1;
      try {
        return await operation(generation);
      } finally {
        this._activeOperationCount -= 1;
      }
    });
    this._requestChain = wireTask.catch(() => undefined);
    const completionTask = this._completionChain.then(async () => {
      const token = await wireTask;
      if (materialize) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      this._requireLifecycleGeneration(generation, false, false);
      const value = materialize ? materialize(token) : token;
      this._requireLifecycleGeneration(generation, false, false);
      return value;
    });
    this._completionChain = completionTask.catch(() => undefined);
    return completionTask;
  }

  _runExclusive(operation) {
    if (typeof operation !== "function") {
      throw new ValueError("exclusive operation must be a function");
    }
    return this._enqueueOperation((generation) => {
      const context = { client: this, generation };
      return this._exclusiveContext.run(context, operation);
    });
  }

  _requireLifecycleGeneration(generation, stateChanging, possiblySent) {
    if (generation === null || generation === undefined) {
      return;
    }
    if (!this._closing && generation === this._clientGeneration) {
      return;
    }
    const error = new SlmpClosedError(
      possiblySent
        ? "SLMP client closed before the response became definitive"
        : "SLMP client closed before the operation could send"
    );
    if (stateChanging && possiblySent) {
      throw asOutcomeUnknown(error);
    }
    throw error;
  }

  _preflightBitInWordRmw(device, options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "expectResponse")) {
      throw new ValueError("writeBitInWord does not accept expectResponse; both read and write responses are required");
    }
    rejectProfileDerivedOverrides(options, "writeBitInWord");
    const qualified = (typeof device === "string" && (device.includes("\\") || device.includes("/"))) ||
      (device && typeof device === "object" && Object.prototype.hasOwnProperty.call(device, "address"));
    if (qualified) {
      this._ensureProfileFeatureAllowed("random");
      const entry = this._parseExtendedDevice(device);
      if (DEVICE_CODES[entry.device.code]?.unit !== DeviceUnit.WORD) {
        throw new ValueError("writeBitInWord is only valid for word devices");
      }
      validateRandomReadLikeCounts(
        1, 0, this.plcSeries, "writeBitInWord read", this.plcProfile, "random_read_word_ext"
      );
      validateRandomWriteWordCounts(
        1, 0, this.plcSeries, "writeBitInWord write", this.plcProfile, "random_write_word_ext"
      );
      validateRandomReadDevices([entry.device], [], { allowQualifiedOnly: true });
      validateRandomWriteWordDevices([entry.device], [], this.plcProfile, { allowQualifiedOnly: true });
      const extendedSeries = selectExtendedEntrySeries([entry], this.plcSeries, "writeBitInWord");
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
      validateRandomLikeDeviceSpans([entry.device], [], extendedSeries, "writeBitInWord");
      const readPayload = encodeExtendedDeviceListPayload(
        [entry], [], extendedSeries,
        maxRequestPayloadLength(this.transportType, this.frameType),
        "writeBitInWord read",
      );
      const writePayload = encodeExtendedWordWritePayload(
        [{ ...entry, value: 0 }], [], extendedSeries,
        maxRequestPayloadLength(this.transportType, this.frameType),
        "writeBitInWord write",
      );
      const subcommand = resolveDeviceSubcommand({
        bitUnit: false,
        series: extendedSeries,
        extension: true,
      });
      const readPrepared = this._prepareRequest(
        Command.DEVICE_READ_RANDOM,
        subcommand,
        readPayload,
        { ...options, bitUnit: false },
      );
      const writePrepared = this._prepareRequest(
        Command.DEVICE_WRITE_RANDOM,
        subcommand,
        writePayload,
        { ...options, bitUnit: false },
      );
      const plan = Object.freeze({ ref: entry.device, readPrepared, writePrepared });
      preparedBitInWordPlans.set(plan, this);
      return plan;
    }
    this._ensureProfileFeatureAllowed("direct");
    validateDirectAccessPoints(1, false, "writeBitInWord read", this.plcProfile, "read");
    validateDirectAccessPoints(1, false, "writeBitInWord write", this.plcProfile, "write");
    const ref = this._parseDevice(device);
    if (DEVICE_CODES[ref.code]?.unit !== DeviceUnit.WORD) {
      throw new ValueError("writeBitInWord is only valid for word devices");
    }
    validateDirectReadDevice(ref, 1, false);
    validateDirectWriteDevice(ref, false, this.plcProfile);
    const spec = encodeDeviceSpec(ref, { series: this.plcSeries });
    const readPayload = Buffer.concat([spec, numberToBuffer(1, 2)]);
    const writePayload = Buffer.concat([spec, numberToBuffer(1, 2), numberToBuffer(0, 2)]);
    const readPrepared = this._prepareRequest(
      Command.DEVICE_READ,
      resolveDeviceSubcommand({ bitUnit: false, series: this.plcSeries }),
      readPayload,
      { ...options, bitUnit: false },
    );
    const writePrepared = this._prepareRequest(
      Command.DEVICE_WRITE,
      resolveDeviceSubcommand({ bitUnit: false, series: this.plcSeries }),
      writePayload,
      { ...options, bitUnit: false },
    );
    const plan = Object.freeze({ ref, readPrepared, writePrepared });
    preparedBitInWordPlans.set(plan, this);
    return plan;
  }

  _executeBitInWordRmw(plan, bitIndex, value) {
    if (preparedBitInWordPlans.get(plan) !== this) {
      return Promise.reject(new ValueError("bit-in-word plan was not prepared by this client"));
    }
    return this._runExclusive(async () => {
      const context = this._exclusiveContext.getStore();
      const deadline = performance.now() + this.timeout;
      const current = await this._executePreparedRequest(
        plan.readPrepared,
        null,
        deadline,
        context.generation,
        (response) => {
          if (response.data.length !== 2) {
            throw createMalformedResponseError(
              `bit-in-word read size mismatch: expected=2, actual=${response.data.length}`,
              response,
            );
          }
          return response.data.readUInt16LE(0);
        },
      );
      const mask = 1 << bitIndex;
      const next = value ? (current | mask) : (current & ~mask);
      plan.writePrepared.requestData.writeUInt16LE(next & 0xffff, plan.writePrepared.requestData.length - 2);
      await this._executePreparedRequest(
        plan.writePrepared,
        null,
        deadline,
        context.generation,
        decodeEmptyAcknowledgement,
      );
    });
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
    validateWireDeviceSpan(
      ref.number,
      directConsumedDeviceNumbers(ref, points, bitUnit),
      series,
      `readDevices ${bitUnit ? "bit" : "word"}`
    );
    const payload = Buffer.concat([encodeDeviceSpec(ref, { series }), numberToBuffer(points, 2)]);
    return this._requestDecoded(
      Command.DEVICE_READ,
      resolveDeviceSubcommand({ bitUnit, series }),
      payload,
      options,
      createResponsePhases(
        (response) => bitUnit
          ? validateBitResponseData(response, points)
          : validateExactResponseData(response, points * 2, "word data length mismatch"),
        (validatedData) => bitUnit
          ? unpackBitValues(validatedData, points)
          : decodeDeviceWords(validatedData),
      ),
    );
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
    validateWireDeviceSpan(
      ref.number,
      directConsumedDeviceNumbers(ref, items.length, bitUnit),
      series,
      `writeDevices ${bitUnit ? "bit" : "word"}`
    );
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
    await this._requestAcknowledged(
      Command.DEVICE_WRITE,
      resolveDeviceSubcommand({ bitUnit, series }),
      Buffer.concat(parts),
      options
    );
  }

  _prepareRandomReadPlan({ wordDevices = [], dwordDevices = [], series, ...requestOptions } = {}) {
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
    validateRandomLikeDeviceSpans(words, dwords, normalizedSeries, "readRandom");
    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    dwords.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    const wordKeys = Object.freeze(words.map((device) => this._deviceText(device)));
    const dwordKeys = Object.freeze(dwords.map((device) => this._deviceText(device)));
    const responseDecoder = createResponsePhases(
      (response) => validateExactResponseData(
        response,
        words.length * 2 + dwords.length * 4,
        "random read size mismatch",
      ),
      (validatedData) => {
        const wordValues = decodeDeviceWords(validatedData.subarray(0, words.length * 2));
        const dwordValues = decodeDeviceDwords(validatedData.subarray(words.length * 2));
        return {
          word: Object.fromEntries(wordKeys.map((key, index) => [key, wordValues[index]])),
          dword: Object.fromEntries(dwordKeys.map((key, index) => [key, dwordValues[index]])),
        };
      },
    );
    const prepared = this._prepareRequest(
      Command.DEVICE_READ_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions,
    );
    const plan = Object.freeze({ prepared, responseDecoder });
    preparedRandomReadPlans.set(plan, this);
    return plan;
  }

  _executeRandomReadPlan(plan, options = {}) {
    if (preparedRandomReadPlans.get(plan) !== this) {
      return Promise.reject(new ValueError("random read plan was not prepared by this client"));
    }
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      return Promise.reject(new ValueError("prepared read execution options must be an object"));
    }
    const extraOption = Object.keys(options).find((key) => key !== "signal");
    if (extraOption !== undefined) {
      return Promise.reject(new ValueError(`prepared read execute does not accept '${extraOption}'`));
    }
    const signal = options.signal;
    if (signal !== undefined && (signal === null
        || typeof signal !== "object"
        || typeof signal.aborted !== "boolean"
        || typeof signal.addEventListener !== "function"
        || typeof signal.removeEventListener !== "function")) {
      return Promise.reject(new ValueError("signal must be an AbortSignal when provided"));
    }
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }

    let active = false;
    const admission = { countedAsQueued: false };
    const operation = this._enqueueOperation(
      async (generation) => {
        if (signal?.aborted) throw createAbortError(signal.reason);
        const deadline = performance.now() + this.timeout;
        active = true;
        try {
          return await this._executePreparedRequest(
            plan.prepared,
            null,
            deadline,
            generation,
            plan.responseDecoder,
          );
        } finally {
          active = false;
        }
      },
      this._requestInternal === SlmpClient.prototype._requestInternal
        ? plan.responseDecoder.materialize
        : null,
      admission,
    );
    if (!signal) return operation;

    let abortListener;
    const aborted = new Promise((_resolve, reject) => {
      abortListener = () => {
        if (!active && admission.countedAsQueued) {
          admission.countedAsQueued = false;
          this._queuedOperationCount -= 1;
        }
        if (active) {
          void this._closeTransport().catch(() => undefined);
          this._invalidateRemotePasswordState();
          this._observedTransportGeneration = null;
        }
        reject(createAbortError(signal.reason));
      };
      signal.addEventListener("abort", abortListener, { once: true });
    });
    return Promise.race([operation, aborted]).finally(() => {
      signal.removeEventListener("abort", abortListener);
    });
  }

  async readRandom(options = {}) {
    const plan = this._prepareRandomReadPlan(options);
    if (this._request !== SlmpClient.prototype._request) {
      return this._requestDecoded(
        plan.prepared.command,
        plan.prepared.subcommand,
        plan.prepared.requestData,
        plan.prepared.requestOptions,
        plan.responseDecoder,
      );
    }
    return this._executeRandomReadPlan(plan);
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
    const extendedSeries = selectExtendedEntrySeries([...words, ...dwords], normalizedSeries, "readRandomExt");

    for (const entry of [...words, ...dwords]) {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
    }
    validateRandomLikeDeviceSpans(
      words.map((entry) => entry.device),
      dwords.map((entry) => entry.device),
      extendedSeries,
      "readRandomExt"
    );

    const payload = encodeExtendedDeviceListPayload(
      words,
      dwords,
      extendedSeries,
      maxRequestPayloadLength(this.transportType, this.frameType),
      "readRandomExt",
    );
    return this._requestDecoded(
      Command.DEVICE_READ_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: extendedSeries, extension: true }),
      payload,
      requestOptions,
      createResponsePhases(
        (response) => validateExactResponseData(
          response,
          words.length * 2 + dwords.length * 4,
          "extended random read size mismatch",
        ),
        (validatedData) => {
          const wordValues = decodeDeviceWords(validatedData.subarray(0, words.length * 2));
          const dwordValues = decodeDeviceDwords(validatedData.subarray(words.length * 2));
          return {
            word: Object.fromEntries(words.map((entry, index) => [extendedResultKey(entry), wordValues[index]])),
            dword: Object.fromEntries(dwords.map((entry, index) => [extendedResultKey(entry), dwordValues[index]])),
          };
        },
      ),
    );
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
    validateRandomLikeDeviceSpans(words, dwords, normalizedSeries, "registerMonitorDevices");
    const parts = [Buffer.from([words.length, dwords.length])];
    words.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    dwords.forEach((device) => parts.push(encodeDeviceSpec(device, { series: normalizedSeries })));
    await this._requestAcknowledged(
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
    const extendedSeries = selectExtendedEntrySeries(
      [...words, ...dwords],
      normalizedSeries,
      "registerMonitorDevicesExt"
    );
    for (const entry of [...words, ...dwords]) {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
    }
    validateRandomLikeDeviceSpans(
      words.map((entry) => entry.device),
      dwords.map((entry) => entry.device),
      extendedSeries,
      "registerMonitorDevicesExt"
    );
    const payload = encodeExtendedDeviceListPayload(
      words,
      dwords,
      extendedSeries,
      maxRequestPayloadLength(this.transportType, this.frameType),
      "registerMonitorDevicesExt",
    );
    await this._requestAcknowledged(
      Command.MONITOR_REGISTER,
      resolveDeviceSubcommand({ bitUnit: false, series: extendedSeries, extension: true }),
      payload,
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
    return this._requestDecoded(
      Command.MONITOR,
      0x0000,
      Buffer.alloc(0),
      requestOptions,
      createResponsePhases(
        (response) => validateExactResponseData(
          response,
          wordPoints * 2 + dwordPoints * 4,
          "monitor response size mismatch",
        ),
        (validatedData) => ({
          word: decodeDeviceWords(validatedData.subarray(0, wordPoints * 2)),
          dword: decodeDeviceDwords(validatedData.subarray(wordPoints * 2)),
        }),
      ),
    );
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
    validateBlockDeviceSpans(words, bits, normalizedSeries, "readBlock", (block) => block.points);

    const parts = [Buffer.from([words.length, bits.length])];
    words.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.points, 2));
    });
    bits.forEach((block) => {
      parts.push(encodeDeviceSpec(block.device, { series: normalizedSeries }));
      parts.push(numberToBuffer(block.points, 2));
    });

    return this._requestDecoded(
      Command.DEVICE_READ_BLOCK,
      resolveDeviceSubcommand({ bitUnit: false, series: normalizedSeries }),
      Buffer.concat(parts),
      requestOptions,
      createResponsePhases(
        (response) => validateExactResponseData(
          response,
          words.reduce((total, block) => total + block.points, 0) * 2
            + bits.reduce((total, block) => total + block.points, 0) * 2,
          "block read size mismatch",
        ),
        (validatedData) => {
          let offset = 0;
          const wordValues = [];
          const bitWordValues = [];
          const wordResults = words.map((block) => {
            const size = block.points * 2;
            const values = decodeDeviceWords(validatedData.subarray(offset, offset + size));
            offset += size;
            wordValues.push(...values);
            return { device: this._deviceText(block.device), values };
          });
          const bitResults = bits.map((block) => {
            const size = block.points * 2;
            const values = decodeDeviceWords(validatedData.subarray(offset, offset + size));
            offset += size;
            bitWordValues.push(...values);
            return { device: this._deviceText(block.device), values };
          });

          return {
            wordValues,
            bitWordValues,
            wordBlocks: wordResults,
            bitBlocks: bitResults,
          };
        },
      ),
    );
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
    validateBlockDeviceSpans(words, bits, normalizedSeries, "writeBlock", (block) => block.values.length);
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

    await this._requestAcknowledged(
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
    validateRandomLikeDeviceSpans(
      wordItems.map(([device]) => device),
      dwordItems.map(([device]) => device),
      normalizedSeries,
      "writeRandomWords"
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
    await this._requestAcknowledged(
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
    const extendedSeries = selectExtendedEntrySeries(
      [...words, ...dwords],
      normalizedSeries,
      "writeRandomWordsExt"
    );
    for (const entry of [...words, ...dwords]) {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
    }
    validateRandomLikeDeviceSpans(
      words.map((entry) => entry.device),
      dwords.map((entry) => entry.device),
      extendedSeries,
      "writeRandomWordsExt"
    );
    validateNoExtendedRandomWriteOverlap(words, dwords, "writeRandomWordsExt");

    const payload = encodeExtendedWordWritePayload(
      words,
      dwords,
      extendedSeries,
      maxRequestPayloadLength(this.transportType, this.frameType),
      "writeRandomWordsExt",
    );
    await this._requestAcknowledged(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: false, series: extendedSeries, extension: true }),
      payload,
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
    validateBitDeviceSpans(items.map(([device]) => device), normalizedSeries, "writeRandomBits");
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
    await this._requestAcknowledged(
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
    const extendedSeries = selectExtendedEntrySeries(bits, normalizedSeries, "writeRandomBitsExt");

    for (const entry of bits) {
      this._ensureExtendedProfileFeatureAllowed(entry.device, entry.extension);
    }
    validateBitDeviceSpans(bits.map((entry) => entry.device), extendedSeries, "writeRandomBitsExt");
    validateNoExtendedBitWriteDuplicates(bits, "writeRandomBitsExt");

    const payload = encodeExtendedBitWritePayload(
      bits,
      extendedSeries,
      maxRequestPayloadLength(this.transportType, this.frameType),
      "writeRandomBitsExt",
    );
    await this._requestAcknowledged(
      Command.DEVICE_WRITE_RANDOM,
      resolveDeviceSubcommand({ bitUnit: true, series: extendedSeries, extension: true }),
      payload,
      requestOptions
    );
  }

  async readTypeName(options = {}) {
    this._ensureProfileFeatureAllowed("type_name");
    return this._requestDecoded(
      Command.READ_TYPE_NAME,
      0x0000,
      Buffer.alloc(0),
      options,
      createResponsePhases(
        (response) => validateExactResponseData(response, 18, "type name response size mismatch"),
        (validatedData) => {
          const raw = Buffer.from(validatedData);
          const text = raw.subarray(0, 16).toString("ascii").replace(/\0+$/g, "").trim();
          return {
            raw,
            model: text,
            modelCode: raw.readUInt16LE(16),
          };
        },
      ),
    );
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
    await this._requestAcknowledged(Command.REMOTE_RUN, 0x0000, payload, options);
  }

  async remoteStop(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "force")) {
      throw new ValueError("remoteStop does not support force; Remote STOP request data is fixed to 01 00.");
    }
    await this._requestAcknowledged(Command.REMOTE_STOP, 0x0000, numberToBuffer(0x0001, 2), options);
  }

  async remotePause(options) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ValueError("remotePause options are required");
    }
    if (!Object.prototype.hasOwnProperty.call(options, "force") || typeof options.force !== "boolean") {
      throw new ValueError("remotePause force is required and must be a boolean");
    }
    const mode = options.force ? 0x0003 : 0x0001;
    await this._requestAcknowledged(Command.REMOTE_PAUSE, 0x0000, numberToBuffer(mode, 2), options);
  }

  async remoteLatchClear(options = {}) {
    await this._requestAcknowledged(Command.REMOTE_LATCH_CLEAR, 0x0000, Buffer.from([0x01, 0x00]), options);
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
    return this._requestDecoded(
      Command.SELF_TEST,
      0x0000,
      Buffer.concat([numberToBuffer(expected.length, 2), expected]),
      options,
      createResponsePhases(
        (response) => {
          if (response.data.length < 2) {
            throw createMalformedResponseError("self-test response too short", response);
          }
          const declaredLength = response.data.readUInt16LE(0);
          if (declaredLength !== expected.length || response.data.length !== declaredLength + 2) {
            throw createMalformedResponseError(
              `self-test response length mismatch: expected=${expected.length + 2}, declared=${declaredLength}, actual=${response.data.length}`,
              response,
            );
          }
          const echoed = response.data.subarray(2);
          if (!echoed.equals(expected)) {
            throw createMalformedResponseError("self-test response payload mismatch", response);
          }
          return echoed;
        },
        (echoed) => Buffer.from(echoed),
      ),
    );
  }

  /** Send the fixed Clear Error command as exactly one request. */
  async clearError(options = {}) {
    await this._requestAcknowledged(Command.CLEAR_ERROR, 0x0000, Buffer.alloc(0), options);
  }

  async memoryReadWords(headAddress, wordLength, options = {}) {
    const count = normalizePoints(wordLength, "memoryReadWords");
    validateMemoryWordLength(count, "memoryReadWords");
    return this._requestDecoded(
      Command.MEMORY_READ,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(count, 2)]),
      options,
      createResponsePhases(
        (response) => validateExactResponseData(response, count * 2, "memory read size mismatch"),
        (validatedData) => decodeDeviceWords(validatedData),
      ),
    );
  }

  async memoryWriteWords(headAddress, values, options = {}) {
    const items = normalizeWordValues(values, "memoryWriteWords");
    validateMemoryWordLength(items.length, "memoryWriteWords");
    const body = Buffer.alloc(items.length * 2);
    items.forEach((value, index) => body.writeUInt16LE(value, index * 2));
    await this._requestAcknowledged(
      Command.MEMORY_WRITE,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(items.length, 2), body]),
      options
    );
  }

  async extendUnitReadBytes(headAddress, byteLength, moduleNo, options = {}) {
    const length = normalizePoints(byteLength, "extendUnitReadBytes");
    validateExtendUnitByteLength(length, "extendUnitReadBytes");
    return this._requestDecoded(
      Command.EXTEND_UNIT_READ,
      0x0000,
      Buffer.concat([numberToBuffer(headAddress, 4), numberToBuffer(length, 2), numberToBuffer(moduleNo, 2)]),
      options,
      createResponsePhases(
        (response) => validateExactResponseData(response, length, "extend unit read size mismatch"),
        (validatedData) => Buffer.from(validatedData),
      ),
    );
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
    await this._requestAcknowledged(
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
    return this._requestDecoded(
      Command.LABEL_ARRAY_READ,
      0x0000,
      buildLabelArrayReadPayload(normalized, options.abbreviationLabels),
      options,
      createResponsePhases(
        (response) => validateArrayLabelReadResponse(response, normalized),
        materializeLabelReadResponse,
      ),
    );
  }

  async writeArrayLabels(points, options = {}) {
    await this._requestAcknowledged(
      Command.LABEL_ARRAY_WRITE,
      0x0000,
      buildLabelArrayWritePayload(normalizeLabelArrayWritePoints(points), options.abbreviationLabels),
      options
    );
  }

  async readRandomLabels(labels, options = {}) {
    const normalized = normalizeLabelNames(labels);
    return this._requestDecoded(
      Command.LABEL_READ_RANDOM,
      0x0000,
      buildLabelRandomReadPayload(normalized, options.abbreviationLabels),
      options,
      createResponsePhases(
        (response) => validateRandomLabelReadResponse(response, normalized.length),
        materializeLabelReadResponse,
      ),
    );
  }

  async writeRandomLabels(points, options = {}) {
    await this._requestAcknowledged(
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
    await this._requestAcknowledged(command, 0x0000, encodePassword(password, this.plcSeries), options);
  }

  async _sendManagedRemotePasswordCommand(command, password, deadline = null, lifecycleGeneration = null) {
    await this._requestInternal(
      command,
      0x0000,
      encodePassword(password, this.plcSeries),
      {},
      MANAGED_REMOTE_PASSWORD_COMMAND,
      deadline,
      lifecycleGeneration,
      decodeEmptyAcknowledgement,
    );
  }

  _nextSerial() {
    return this._transport.nextSerial();
  }

  async _requestInternal(
    command,
    subcommand,
    data,
    options,
    internalContext = null,
    inheritedDeadline = null,
    lifecycleGeneration = null,
    responseDecoder = null,
  ) {
    const prepared = this._prepareRequest(command, subcommand, data, options);
    return this._requestPreparedInternal(
      prepared,
      internalContext,
      inheritedDeadline,
      lifecycleGeneration,
      responseDecoder,
    );
  }

  _executePreparedRequest(
    prepared,
    internalContext = null,
    inheritedDeadline = null,
    lifecycleGeneration = null,
    responseDecoder = null,
  ) {
    if (preparedRequests.get(prepared) !== this) {
      return Promise.reject(new ValueError("prepared request was not created by this module"));
    }
    if (this._requestInternal !== SlmpClient.prototype._requestInternal) {
      return Promise.resolve(this._requestInternal(
        prepared.command,
        prepared.subcommand,
        prepared.requestData,
        prepared.requestOptions,
        internalContext,
        inheritedDeadline,
        lifecycleGeneration,
        null,
      )).then((response) => responseDecoder === null
        ? response
        : decodeWithResponsePhases(responseDecoder, response));
    }
    return this._requestPreparedInternal(
      prepared,
      internalContext,
      inheritedDeadline,
      lifecycleGeneration,
      responseDecoder,
    );
  }

  async _requestPreparedInternal(
    prepared,
    internalContext = null,
    inheritedDeadline = null,
    lifecycleGeneration = null,
    responseDecoder = null,
  ) {
    if (preparedRequests.get(prepared) !== this) {
      throw new ValueError("prepared request was not created by this module");
    }
    const {
      command, subcommand, requestData, requestOptions: options,
    } = prepared;
    const stateChanging = options.stateChanging;
    this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, false);
    const serial = this._nextSerial();
    const target = options.target;
    const monitoringTimer = options.monitoringTimer;
    const frame = encodeRequest({
      frameType: this.frameType,
      serial,
      target,
      monitoringTimer,
      command: Number(command),
      subcommand: Number(subcommand),
      data: requestData,
    });
    const deadline = inheritedDeadline ?? (performance.now() + this.timeout);
    if (options.expectResponse === false) {
      await this._sendOnly(
        frame,
        options,
        internalContext,
        deadline,
        stateChanging,
        lifecycleGeneration,
      );
      return { serial, target, endCode: 0, data: Buffer.alloc(0), raw: Buffer.alloc(0) };
    }
    const raw = await this._sendAndReceive(
      frame,
      serial,
      options,
      internalContext,
      target,
      deadline,
      stateChanging,
      lifecycleGeneration,
    );
    this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, true);
    let response;
    try {
      response = decodeOwnedResponse(raw, { frameType: this.frameType });
    } catch (error) {
      await this._rejectMalformedResponse(
        createMalformedResponseError(error instanceof Error ? error.message : String(error)),
        stateChanging,
      );
    }
    if (performance.now() >= deadline) {
      const timeoutError = new SlmpTimeoutError("SLMP transaction deadline expired during response decoding");
      try {
        await this._closeTransport();
      } catch (closeError) {
        timeoutError.closeError = closeError;
      }
      this._invalidateRemotePasswordState();
      throw stateChanging ? asOutcomeUnknown(timeoutError) : timeoutError;
    }
    if (response.endCode !== 0 && response.errorInfo
        && !errorInformationMatchesRequest(response.errorInfo, target, command, subcommand)) {
      await this._rejectMalformedResponse(
        createMalformedResponseError("PLC error information does not match the active request", response),
        stateChanging,
      );
    }
    const shouldRaise = options.raiseOnError;
    if (shouldRaise && response.endCode !== 0) {
      throw createSlmpResponseError(response, command, subcommand);
    }
    if (responseDecoder === null) {
      return response;
    }
    try {
      const decoded = responsePhases.has(responseDecoder)
        ? responseDecoder.validate(response)
        : responseDecoder(response);
      if (performance.now() >= deadline) {
        const timeoutError = new SlmpTimeoutError("SLMP transaction deadline expired during response validation");
        try {
          await this._closeTransport();
        } catch (closeError) {
          timeoutError.closeError = closeError;
        }
        this._invalidateRemotePasswordState();
        throw stateChanging ? asOutcomeUnknown(timeoutError) : timeoutError;
      }
      return decoded;
    } catch (error) {
      if (malformedResponses.has(error)) {
        await this._rejectMalformedResponse(error, stateChanging);
      }
      throw error;
    }
  }

  async _rejectMalformedResponse(error, stateChanging) {
    this._clientGeneration += 1;
    try {
      await this._closeTransport();
    } catch (closeError) {
      error.closeError = closeError;
    }
    this._invalidateRemotePasswordState();
    this._observedTransportGeneration = null;
    if (stateChanging) {
      throw asOutcomeUnknown(error, "malformed-response");
    }
    throw error;
  }

  async _sendOnly(
    frame,
    options = {},
    internalContext = null,
    deadline = null,
    stateChanging = false,
    lifecycleGeneration = null,
  ) {
    if (internalContext !== MANAGED_REMOTE_PASSWORD_COMMAND) {
      await this._connectTransport(deadline);
      await this._requireTransactionTimeRemaining(deadline, "before managed authentication");
      this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, false);
      await this._unlockRemotePasswordIfConfigured(deadline, lifecycleGeneration);
    }
    await this._requireTransactionTimeRemaining(deadline, "before send");
    this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, false);
    try {
      await this._transport.sendOnly(frame, deadline);
    } catch (error) {
      this._invalidateRemotePasswordState();
      if (stateChanging && !(error instanceof SlmpNotConnectedError)) {
        throw asOutcomeUnknown(error);
      }
      throw error;
    }
    this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, true);
    try {
      await this._closeTransport();
      if (deadline !== null && deadline !== undefined && performance.now() >= deadline) {
        throw new SlmpTimeoutError("SLMP transaction deadline expired while retiring the send-only transport");
      }
    } catch (error) {
      if (stateChanging && !(error instanceof SlmpNotConnectedError)) {
        throw asOutcomeUnknown(error);
      }
      throw error;
    } finally {
      this._invalidateRemotePasswordState();
    }
  }

  async _sendAndReceive(
    frame,
    serial,
    options = {},
    internalContext = null,
    expectedTarget = null,
    deadline = null,
    stateChanging = false,
    lifecycleGeneration = null,
  ) {
    if (internalContext !== MANAGED_REMOTE_PASSWORD_COMMAND) {
      await this._connectTransport(deadline);
      await this._requireTransactionTimeRemaining(deadline, "before managed authentication");
      this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, false);
      await this._unlockRemotePasswordIfConfigured(deadline, lifecycleGeneration);
    }
    await this._requireTransactionTimeRemaining(deadline, "before send");
    this._requireLifecycleGeneration(lifecycleGeneration, stateChanging, false);
    try {
      return await this._transport.sendAndReceive(frame, serial, expectedTarget, deadline);
    } catch (error) {
      this._invalidateRemotePasswordState();
      if (stateChanging && !(error instanceof SlmpNotConnectedError)) {
        throw asOutcomeUnknown(error);
      }
      throw error;
    }
  }

  _connectTcp(deadline = null) {
    return this._transport._connectTcp(deadline);
  }

  _connectUdp(deadline = null) {
    return this._transport._connectUdp(deadline);
  }

  _handleTcpData(chunk) {
    return this._transport.handleTcpData(chunk);
  }

  _awaitTcpFrame(serial, expectedTarget = null, deadline = null) {
    return this._transport.awaitTcpFrame(serial, expectedTarget, deadline);
  }

  _handleTcpFailure(error) {
    return this._transport.handleTcpFailure(error);
  }

  _rejectTcpPending(error) {
    return this._transport._rejectTcpPending(error);
  }

  _sendUdp(frame, serial, expectedTarget = null, deadline = null) {
    return this._transport.sendUdp(frame, serial, expectedTarget, deadline);
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
  if (![left.number, leftPoints, right.number, rightPoints].every(Number.isSafeInteger) ||
      left.number < 0 || right.number < 0 || leftPoints < 1 || rightPoints < 1) {
    throw new ValueError("overlap validation requires non-negative safe-integer starts and positive safe-integer spans");
  }
  const leftEnd = left.number + leftPoints - 1;
  const rightEnd = right.number + rightPoints - 1;
  if (!Number.isSafeInteger(leftEnd) || !Number.isSafeInteger(rightEnd)) {
    throw new ValueError("overlap validation range exceeds JavaScript safe-integer arithmetic");
  }
  return left.number <= rightEnd && right.number <= leftEnd;
}

function validateNoRandomWriteOverlap(wordDevices, dwordDevices, label) {
  for (let left = 0; left < wordDevices.length; left += 1) {
    for (let right = left + 1; right < wordDevices.length; right += 1) {
      if (deviceRangesOverlap(
        wordDevices[left],
        randomConsumedDeviceNumbers(wordDevices[left], false),
        wordDevices[right],
        randomConsumedDeviceNumbers(wordDevices[right], false)
      )) {
        throw new ValueError(`${label} contains duplicate word destinations`);
      }
    }
    for (const dword of dwordDevices) {
      if (deviceRangesOverlap(
        wordDevices[left],
        randomConsumedDeviceNumbers(wordDevices[left], false),
        dword,
        randomConsumedDeviceNumbers(dword, true)
      )) {
        throw new ValueError(`${label} contains overlapping word/dword destinations`);
      }
    }
  }
  for (let left = 0; left < dwordDevices.length; left += 1) {
    for (let right = left + 1; right < dwordDevices.length; right += 1) {
      if (deviceRangesOverlap(
        dwordDevices[left],
        randomConsumedDeviceNumbers(dwordDevices[left], true),
        dwordDevices[right],
        randomConsumedDeviceNumbers(dwordDevices[right], true)
      )) {
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
  const blocks = [
    ...wordBlocks.map((block) => ({
      ...block,
      destinationSpan: directConsumedDeviceNumbers(block.device, block.values.length, false),
    })),
    ...bitBlocks.map((block) => ({
      ...block,
      destinationSpan: directConsumedDeviceNumbers(block.device, block.values.length, false),
    })),
  ];
  for (let left = 0; left < blocks.length; left += 1) {
    for (let right = left + 1; right < blocks.length; right += 1) {
      if (deviceRangesOverlap(
        blocks[left].device,
        blocks[left].destinationSpan,
        blocks[right].device,
        blocks[right].destinationSpan
      )) {
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
      if (sameRoute(words[left], words[right]) && deviceRangesOverlap(
        words[left].device,
        randomConsumedDeviceNumbers(words[left].device, false),
        words[right].device,
        randomConsumedDeviceNumbers(words[right].device, false)
      )) {
        throw new ValueError(`${label} contains duplicate word destinations`);
      }
    }
    for (const dword of dwords) {
      if (sameRoute(words[left], dword) && deviceRangesOverlap(
        words[left].device,
        randomConsumedDeviceNumbers(words[left].device, false),
        dword.device,
        randomConsumedDeviceNumbers(dword.device, true)
      )) {
        throw new ValueError(`${label} contains overlapping word/dword destinations`);
      }
    }
  }
  for (let left = 0; left < dwords.length; left += 1) {
    for (let right = left + 1; right < dwords.length; right += 1) {
      if (sameRoute(dwords[left], dwords[right]) && deviceRangesOverlap(
        dwords[left].device,
        randomConsumedDeviceNumbers(dwords[left].device, true),
        dwords[right].device,
        randomConsumedDeviceNumbers(dwords[right].device, true)
      )) {
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
  throw new ValueError(`${label} must be boolean: ${String(value)}`);
}

function classifyStateChangingCommand(command, options = {}) {
  const normalized = Number(command);
  const hasExplicitClassification = Object.prototype.hasOwnProperty.call(options, "stateChanging");
  if (STATE_CHANGING_COMMANDS.has(normalized)) {
    if (hasExplicitClassification && options.stateChanging === false) {
      throw new ValueError(`command 0x${normalized.toString(16)} is state-changing and cannot be classified as read-only`);
    }
    return true;
  }
  if (READ_ONLY_COMMANDS.has(normalized)) {
    return hasExplicitClassification ? options.stateChanging : false;
  }
  // Unknown raw commands are conservative by default. A caller that knows a
  // vendor-specific command is read-only can make that assertion explicitly.
  return hasExplicitClassification ? options.stateChanging : true;
}

function outcomeUnknownReason(error) {
  if (error instanceof SlmpTimeoutError) return "timeout";
  if (error instanceof SlmpClosedError) return "closed";
  return "transport";
}

function asOutcomeUnknown(error, reason = outcomeUnknownReason(error)) {
  if (error instanceof SlmpOperationOutcomeUnknownError) return error;
  return new SlmpOperationOutcomeUnknownError(
    `SLMP state-changing operation outcome is unknown after send (${reason})`,
    reason,
    { cause: error },
  );
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
    throw new ValueError(`${name} must be 0(bit) or 1(byte): ${value}`);
  }
  return normalized;
}

function labelArrayDataBytes(unitSpecification, arrayDataLength) {
  const unit = checkLabelUnitSpecification(unitSpecification, "unitSpecification");
  const length = checkU16(arrayDataLength, "arrayDataLength");
  if (length === 0) {
    throw new ValueError("arrayDataLength must be in range 1..65535");
  }
  return labelArrayWireDataBytes(unit, length);
}

function labelArrayWireDataBytes(unitSpecification, arrayDataLength) {
  return unitSpecification === 0
    ? Math.ceil(arrayDataLength / 16) * 2
    : Math.ceil(arrayDataLength / 2) * 2;
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
    const unitSpecification = checkLabelUnitSpecification(
      source.unitSpecification ?? source.unit_specification,
      "unitSpecification"
    );
    const arrayDataLength = checkU16(source.arrayDataLength ?? source.array_data_length, "arrayDataLength");
    labelArrayDataBytes(unitSpecification, arrayDataLength);
    return {
      label: String(source.label || ""),
      unitSpecification,
      arrayDataLength,
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
    if (data.length === 0 || data.length % 2 !== 0) {
      throw new ValueError(`write data length must be positive and even: ${data.length}`);
    }
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

function labelNameSize(label) {
  const text = String(label);
  if (!text) {
    throw new ValueError("label must not be empty");
  }
  checkU16(text.length, "label name length");
  return 2 + text.length * 2;
}

function buildBoundedLabelPayload(parts, payloadLength) {
  validateRequestPayloadLength(payloadLength);
  return Buffer.concat(parts, payloadLength);
}

function buildLabelArrayReadPayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  let payloadLength = 4;
  abbrevs.forEach((label) => {
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(label));
  });
  points.forEach((point) => {
    validateAbbreviationReferences(point.label, abbrevs.length);
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(point.label));
    payloadLength = addRequestPayloadLength(payloadLength, 4);
  });
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    parts.push(encodeLabelName(point.label));
    parts.push(Buffer.from([point.unitSpecification, 0x00]));
    parts.push(numberToBuffer(point.arrayDataLength, 2));
  });
  return buildBoundedLabelPayload(parts, payloadLength);
}

function buildLabelArrayWritePayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  let payloadLength = 4;
  abbrevs.forEach((label) => {
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(label));
  });
  points.forEach((point) => {
    validateAbbreviationReferences(point.label, abbrevs.length);
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(point.label));
    payloadLength = addRequestPayloadLength(payloadLength, 4 + point.data.length);
  });
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    parts.push(encodeLabelName(point.label));
    parts.push(Buffer.from([point.unitSpecification, 0x00]));
    parts.push(numberToBuffer(point.arrayDataLength, 2));
    parts.push(Buffer.from(point.data));
  });
  return buildBoundedLabelPayload(parts, payloadLength);
}

function buildLabelRandomReadPayload(labels, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  let payloadLength = 4;
  abbrevs.forEach((label) => {
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(label));
  });
  labels.forEach((label) => {
    validateAbbreviationReferences(label, abbrevs.length);
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(label));
  });
  const parts = [numberToBuffer(labels.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  labels.forEach((label) => {
    parts.push(encodeLabelName(label));
  });
  return buildBoundedLabelPayload(parts, payloadLength);
}

function buildLabelRandomWritePayload(points, abbreviationLabels) {
  const abbrevs = normalizeAbbreviationLabels(abbreviationLabels);
  let payloadLength = 4;
  abbrevs.forEach((label) => {
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(label));
  });
  points.forEach((point) => {
    validateAbbreviationReferences(point.label, abbrevs.length);
    payloadLength = addRequestPayloadLength(payloadLength, labelNameSize(point.label));
    payloadLength = addRequestPayloadLength(payloadLength, 2 + point.data.length);
  });
  const parts = [numberToBuffer(points.length, 2), numberToBuffer(abbrevs.length, 2)];
  abbrevs.forEach((label) => parts.push(encodeLabelName(label)));
  points.forEach((point) => {
    parts.push(encodeLabelName(point.label));
    parts.push(numberToBuffer(point.data.length, 2));
    parts.push(Buffer.from(point.data));
  });
  return buildBoundedLabelPayload(parts, payloadLength);
}

function validateArrayLabelReadResponse(response, requestedPoints) {
  const payload = response.data;
  const malformed = (message) => createMalformedResponseError(message, response);
  if (payload.length < 2) {
    throw malformed(`array label read response too short: ${payload.length}`);
  }
  const count = payload.readUInt16LE(0);
  if (count !== requestedPoints.length) {
    throw malformed(`array label read point count mismatch: expected=${requestedPoints.length}, actual=${count}`);
  }
  let offset = 2;
  const items = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > payload.length) {
      throw malformed("array label read response truncated before metadata");
    }
    const dataTypeId = payload[offset];
    const unitSpecification = payload[offset + 1];
    const arrayDataLength = payload.readUInt16LE(offset + 2);
    offset += 4;
    if (![0, 1].includes(unitSpecification)) {
      throw malformed(`array label read response has invalid unitSpecification: ${unitSpecification}`);
    }
    if (arrayDataLength === 0) {
      throw malformed("array label read response has zero arrayDataLength");
    }
    const requested = requestedPoints[index];
    if (
      unitSpecification !== requested.unitSpecification ||
      arrayDataLength !== requested.arrayDataLength
    ) {
      throw malformed(
        `array label read metadata mismatch at index ${index}: ` +
        `expected unit=${requested.unitSpecification}, length=${requested.arrayDataLength}; ` +
        `actual unit=${unitSpecification}, length=${arrayDataLength}`
      );
    }
    const size = labelArrayWireDataBytes(unitSpecification, arrayDataLength);
    if (offset + size > payload.length) {
      throw malformed(`array label read response truncated in data payload: needed=${size}, remaining=${payload.length - offset}`);
    }
    items.push(Object.freeze({
      dataTypeId,
      unitSpecification,
      arrayDataLength,
      dataStart: offset,
      dataLength: size,
    }));
    offset += size;
  }
  if (offset !== payload.length) {
    throw malformed(`array label read response has trailing bytes: ${payload.length - offset}`);
  }
  return Object.freeze({ payload, items: Object.freeze(items) });
}

function validateRandomLabelReadResponse(response, expectedPoints) {
  const payload = response.data;
  const malformed = (message) => createMalformedResponseError(message, response);
  if (payload.length < 2) {
    throw malformed(`label random read response too short: ${payload.length}`);
  }
  const count = payload.readUInt16LE(0);
  if (count !== expectedPoints) {
    throw malformed(`label random read point count mismatch: expected=${expectedPoints}, actual=${count}`);
  }
  let offset = 2;
  const items = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > payload.length) {
      throw malformed("label random read response truncated before metadata");
    }
    const dataTypeId = payload[offset];
    const spare = payload[offset + 1];
    const readDataLength = payload.readUInt16LE(offset + 2);
    offset += 4;
    if (readDataLength === 0 || readDataLength % 2 !== 0) {
      throw malformed(`label random read response data length must be positive and even: ${readDataLength}`);
    }
    if (offset + readDataLength > payload.length) {
      throw malformed(
        `label random read response truncated in data payload: needed=${readDataLength}, remaining=${payload.length - offset}`
      );
    }
    items.push(Object.freeze({
      dataTypeId,
      spare,
      readDataLength,
      dataStart: offset,
      dataLength: readDataLength,
    }));
    offset += readDataLength;
  }
  if (offset !== payload.length) {
    throw malformed(`label random read response has trailing bytes: ${payload.length - offset}`);
  }
  return Object.freeze({ payload, items: Object.freeze(items) });
}

function materializeLabelReadResponse(token) {
  return token.items.map((item) => {
    const result = { ...item, data: Buffer.from(token.payload.subarray(item.dataStart, item.dataStart + item.dataLength)) };
    delete result.dataStart;
    delete result.dataLength;
    return result;
  });
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
