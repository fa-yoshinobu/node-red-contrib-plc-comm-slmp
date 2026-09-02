"use strict";

const { DEVICE_CODES, DeviceUnit, PLCSeries } = require("./constants");
const { getProfileLimit } = require("./capability-profiles");
const {
  ValueError,
  deviceToString,
  normalizeTarget,
  parseDevice,
  requireExplicitPlcProfileForXY,
  resolveConnectionProfile,
  _validateWireDeviceSpan: validateWireDeviceSpan,
} = require("./core");

const WORD_DTYPES = new Set(["U", "S"]);
const DWORD_DTYPES = new Set(["D", "L", "F"]);
const STRING_DTYPES = new Set(["STR"]);
const SUPPORTED_DTYPES = new Set(["BIT", ...WORD_DTYPES, ...DWORD_DTYPES, "STR"]);
const UNBATCHED_DEVICE_CODES = new Set(["G", "HG"]);
const PLAIN_BIT_WORD_BATCHABLE_CODES = new Set(["SM", "X", "Y", "M", "L", "F", "V", "B", "SB"]);
const RANDOM_DWORD_DEVICE_CODES = new Set(["LTN", "LSTN", "LCN", "LZ"]);
const ADDRESS_LIST_TOKEN_RE = /[A-Z][A-Z0-9]*(?:\.[0-9A-F]|:[A-Z]+)?(?:,\d+)?/iy;
const RANDOM_WRITE_WORD_WEIGHT = 12;
const RANDOM_WRITE_DWORD_WEIGHT = 14;
const LONG_TIMER_READ_FAMILIES = Object.freeze({
  LTN: { baseCode: "LTN", role: "current" },
  LTS: { baseCode: "LTN", role: "contact" },
  LTC: { baseCode: "LTN", role: "coil" },
  LSTN: { baseCode: "LSTN", role: "current" },
  LSTS: { baseCode: "LSTN", role: "contact" },
  LSTC: { baseCode: "LSTN", role: "coil" },
  LCN: { baseCode: "LCN", role: "current" },
  LCS: { baseCode: "LCS", role: "contact" },
  LCC: { baseCode: "LCC", role: "coil" },
});
const LONG_STATE_RANDOM_BIT_CODES = new Set(["LTC", "LTS", "LSTC", "LSTS", "LCS", "LCC"]);
const compiledReadPlanInternals = new WeakMap();
const compiledReadEntryInternals = new WeakMap();
const preparedNamedReadPlanInternals = new WeakMap();

async function readTyped(client, device, dtype, options = {}) {
  const key = requireDtype(dtype);
  if (isStringDtype(key)) {
    throw new ValueError("String reads require readNamed with '<device>:STR,<length>' or '<device>STR<number>,<length>'.");
  }
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  validateSemanticDtype(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, key);
  const longTimerRead = getLongTimerReadAccess(resolvedDevice.code);
  if (longTimerRead) {
    validateLongTimerDtype(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, key);
    if (longTimerRead.baseCode === "LCN" && longTimerRead.role === "current") {
      return readRandomDwordScalar(client, resolvedDevice, key, options);
    }
    if (isLongCounterStateDevice(resolvedDevice.code)) {
      const values = await client.readDevices(resolvedDevice, 1, { ...options, bitUnit: true });
      return Boolean(values[0]);
    }
    return readLongTimerScalar(client, resolvedDevice, key, longTimerRead, options);
  }
  validateDwordOnlyDtype(resolvedDevice, key);
  validateOrdinaryTypedWireSpan(client, resolvedDevice, key, 1, "readTyped");
  if (key === "BIT") {
    const values = await client.readDevices(resolvedDevice, 1, { ...options, bitUnit: true });
    return Boolean(values[0]);
  }
  if (isDwordDtype(key)) {
    if (isRandomDwordDevice(resolvedDevice.code)) {
      return readRandomDwordScalar(client, resolvedDevice, key, options);
    }
    const words = await client.readDevices(resolvedDevice, 2, { ...options, bitUnit: false });
    return decodeDwordWords(words, 0, key);
  }

  const words = await client.readDevices(resolvedDevice, 1, { ...options, bitUnit: false });
  return decodeWordValue(words[0], key);
}

async function writeTyped(client, device, dtype, value, options = {}) {
  const key = requireDtype(dtype);
  if (isStringDtype(key)) {
    throw new ValueError("String writes require writeNamed with '<device>:STR,<length>' or '<device>STR<number>,<length>'.");
  }
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  validateSemanticDtype(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, key);
  const longTimerRead = getLongTimerReadAccess(resolvedDevice.code);
  if (longTimerRead) {
    validateLongTimerDtype(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, key);
  }
  validateDwordOnlyDtype(resolvedDevice, key);
  validateOrdinaryTypedWireSpan(client, resolvedDevice, key, 1, "writeTyped");
  if (key === "BIT") {
    const normalizedValue = normalizeBooleanWriteValue(value, deviceToStringWithContext(resolvedDevice, options, client));
    if (LONG_STATE_RANDOM_BIT_CODES.has(resolvedDevice.code)) {
      await client.writeRandomBits({ ...options, bitValues: [[resolvedDevice, normalizedValue]] });
      return;
    }
    await client.writeDevices(resolvedDevice, [normalizedValue], { ...options, bitUnit: true });
    return;
  }
  if ((key === "D" || key === "L") && isRandomDwordDevice(resolvedDevice.code)) {
    await client.writeRandomWords({
      ...options,
      wordValues: [],
      dwordValues: [[resolvedDevice, encodeRandomWriteValue(key, value)]],
    });
    return;
  }
  await client.writeDevices(resolvedDevice, encodeWriteWords(key, value), { ...options, bitUnit: false });
}

async function readBitsSingleRequest(client, device, count, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  requireDeviceUnit(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, DeviceUnit.BIT, "bit access");
  validateSingleDirectPointCount(client, resolvedDevice, count, true, false, "readBitsSingleRequest");
  const values = await client.readDevices(resolvedDevice, count, { ...options, bitUnit: true });
  return values.map((value) => Boolean(value));
}

async function writeBitsSingleRequest(client, device, values, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  const address = deviceToStringWithContext(resolvedDevice, options, client);
  requireDeviceUnit(address, resolvedDevice, DeviceUnit.BIT, "bit access");
  const normalizedValues = Array.from(values || [], (value, index) =>
    normalizeBooleanWriteValue(value, `${address}[${index}]`)
  );
  validateSingleDirectPointCount(client, resolvedDevice, normalizedValues.length, true, true, "writeBitsSingleRequest");
  await client.writeDevices(resolvedDevice, normalizedValues, { ...options, bitUnit: true });
}

async function readWordsSingleRequest(client, device, count, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  requireDeviceUnit(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, DeviceUnit.WORD, "word access");
  validateSingleDirectPointCount(client, resolvedDevice, count, false, false, "readWordsSingleRequest");
  return Array.from(await client.readDevices(resolvedDevice, count, { ...options, bitUnit: false }));
}

async function writeWordsSingleRequest(client, device, values, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  const address = deviceToStringWithContext(resolvedDevice, options, client);
  requireDeviceUnit(address, resolvedDevice, DeviceUnit.WORD, "word access");
  const normalizedValues = Array.from(values || [], (value, index) =>
    encodeWriteWords("U", normalizeNumericWriteValue("U", value, `${address}[${index}]`))[0]
  );
  validateSingleDirectPointCount(client, resolvedDevice, normalizedValues.length, false, true, "writeWordsSingleRequest");
  await client.writeDevices(resolvedDevice, normalizedValues, { ...options, bitUnit: false });
}

/** @deprecated Use readBitsSingleRequest. */
async function readBits(client, device, count, options = {}) {
  return readBitsSingleRequest(client, device, count, options);
}

/** @deprecated Use writeBitsSingleRequest. */
async function writeBits(client, device, values, options = {}) {
  return writeBitsSingleRequest(client, device, values, options);
}

/**
 * Update one bit through an immutable direct or qualified Extended word route.
 * The mandatory read and write occupy one FIFO turn and one absolute
 * post-admission deadline. A successful read always proceeds to the write,
 * even when unchanged. The pair is not PLC-atomic, never retries, and a
 * possibly transmitted unconfirmed write is outcome unknown.
 */
async function writeBitInWord(client, device, bitIndex, value, options = {}) {
  if (!Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 15) {
    throw new ValueError(`bitIndex must be 0-15, got ${bitIndex}`);
  }
  const requestOptions = snapshotClientRequestOptions(client, options);
  const normalizedValue = normalizeBooleanWriteValue(value, String(device));
  if (typeof client?._preflightBitInWordRmw === "function" &&
      typeof client?._executeBitInWordRmw === "function") {
    const plan = client._preflightBitInWordRmw(device, requestOptions);
    return client._executeBitInWordRmw(plan, bitIndex, normalizedValue);
  }
  const resolvedDevice = parseDeviceWithContext(device, requestOptions, client);
  const address = deviceToStringWithContext(resolvedDevice, requestOptions, client);
  validateBitInWordTarget(address, resolvedDevice);
  const preparedDevice = typeof client?._preflightBitInWordRmw === "function"
    ? client._preflightBitInWordRmw(resolvedDevice, requestOptions)
    : resolvedDevice;
  if (typeof client?._executeBitInWordRmw === "function") {
    return client._executeBitInWordRmw(preparedDevice, bitIndex, normalizedValue);
  }
  const execute = async () => {
    const words = await client.readDevices(preparedDevice, 1, { ...requestOptions, bitUnit: false });
    let current = Number(words[0]) & 0xffff;
    if (normalizedValue) {
      current |= 1 << bitIndex;
    } else {
      current &= ~(1 << bitIndex);
    }
    await client.writeDevices(preparedDevice, [current & 0xffff], { ...requestOptions, bitUnit: false });
  };
  return typeof client?._runExclusive === "function"
    ? client._runExclusive(execute)
    : execute();
}

function canonicalizeDtype(dtype) {
  return String(dtype ?? "").trim().toUpperCase();
}

function requireDtype(dtype) {
  const key = canonicalizeDtype(dtype);
  if (!key) {
    throw new ValueError("dtype is required; specify BIT, U, S, D, L, F, or STR.");
  }
  if (!SUPPORTED_DTYPES.has(key)) {
    throw new ValueError(`Unsupported dtype '${key}'; specify BIT, U, S, D, L, F, or STR.`);
  }
  return key;
}

function normalizeBooleanWriteValue(value, address) {
  if (typeof value === "boolean") {
    return value;
  }
  throw new ValueError(`Address '${address}' expects boolean (native boolean values only).`);
}

function normalizeNumericWriteValue(dtype, value, address) {
  if (typeof value !== "number") {
    throw new ValueError(`Address '${address}' expects a numeric value as a native JavaScript Number.`);
  }
  const normalized = value;

  if (!Number.isFinite(normalized)) {
    throw new ValueError(`Address '${address}' expects a finite numeric value.`);
  }

  const key = requireDtype(dtype);
  if (key === "F") {
    if (!Number.isFinite(Math.fround(normalized))) {
      throw new ValueError(`Address '${address}' value is outside the finite 32-bit float range: ${value}.`);
    }
    return normalized;
  }

  if (!Number.isInteger(normalized)) {
    throw new ValueError(`Address '${address}' expects an integer value for ${key}: ${value}.`);
  }
  const ranges = {
    U: [0, 0xffff],
    S: [-0x8000, 0x7fff],
    D: [0, 0xffffffff],
    L: [-0x80000000, 0x7fffffff],
  };
  const [minimum, maximum] = ranges[key];
  if (normalized < minimum || normalized > maximum) {
    throw new ValueError(`Address '${address}' value out of range for ${key} (${minimum}..${maximum}): ${value}.`);
  }
  return normalized;
}

function normalizeWriteEntryValue(address, dtype, value, count, hasCount) {
  if (isStringDtype(dtype)) {
    encodeStringWords(address, value, count);
    return value;
  }
  const values = hasCount ? value : [value];
  if (!Array.isArray(values)) {
    throw new ValueError(`Address '${address}' expects an array with ${count} item(s).`);
  }
  if (values.length !== count) {
    throw new ValueError(`Address '${address}' expects ${count} item(s), got ${values.length}.`);
  }
  const normalized = values.map((item) =>
    dtype === "BIT" || dtype === "BIT_IN_WORD"
      ? normalizeBooleanWriteValue(item, address)
      : normalizeNumericWriteValue(dtype, item, address)
  );
  return hasCount ? normalized : normalized[0];
}

function isStringDtype(dtype) {
  return STRING_DTYPES.has(canonicalizeDtype(dtype));
}

function parsePositiveCountText(value, address) {
  if (!/^[0-9]+$/.test(value)) {
    throw new ValueError(`Address '${address}' has an invalid count suffix.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ValueError(`Address '${address}' count must be a positive safe integer.`);
  }
  return parsed;
}

function parseAddress(address) {
  const text = String(address || "").trim();
  if (text.includes(",")) {
    throw new ValueError(`Address '${address}' includes ',count'; public AddressSpec values are count-free.`);
  }
  const core = text;
  if (core.includes("\\") || core.includes("/")) {
    throw new ValueError(`Address '${address}' is a qualified route, not an AddressSpec.`);
  }

  if (core.includes(":")) {
    const parts = core.split(":");
    if (parts.length !== 2) {
      throw new ValueError(`Address '${address}' has more than one dtype separator ':'.`);
    }
    const [base, dtype] = parts;
    const canonicalDtype = canonicalizeDtype(dtype);
    if (!canonicalDtype) {
      throw new ValueError(`Address '${address}' requires a dtype after ':'.`);
    }
    if (canonicalDtype === "BIT_IN_WORD") {
      throw new ValueError(`Address '${address}' uses BIT_IN_WORD but no bit index was specified. Use '.0' through '.F' notation.`);
    }
    return { base: base.trim(), dtype: requireDtype(canonicalDtype), bitIndex: null, explicitDtype: true };
  }
  if (core.includes(".")) {
    const parts = core.split(".");
    if (parts.length !== 2) {
      throw new ValueError(`Address '${address}' has more than one bit-index separator '.'.`);
    }
    const [base, bitText] = parts;
    if (/^[0-9A-F]$/i.test(bitText.trim())) {
      const parsed = Number.parseInt(bitText, 16);
      return { base: base.trim(), dtype: "BIT_IN_WORD", bitIndex: parsed, explicitDtype: false };
    }
    throw new ValueError(`Address '${address}' has an invalid bit-in-word index.`);
  }
  throw new ValueError(`Address '${address}' requires an explicit dtype such as ':U', ':D', or ':BIT'.`);
}

async function readDWordsSingleRequest(client, device, count, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  const address = deviceToStringWithContext(resolvedDevice, options, client);
  requireDeviceUnit(address, resolvedDevice, DeviceUnit.WORD, "DWord access");
  if (isRandomDwordDevice(resolvedDevice.code) || getLongTimerReadAccess(resolvedDevice.code)) {
    throw new ValueError(`readDWordsSingleRequest does not support ${resolvedDevice.code}; use its explicit semantic route.`);
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new ValueError(`readDWordsSingleRequest count must be a positive safe integer: ${count}`);
  }
  validateSingleDirectPointCount(client, resolvedDevice, count * 2, false, false, "readDWordsSingleRequest");
  const words = await client.readDevices(resolvedDevice, count * 2, { ...options, bitUnit: false });
  return Array.from({ length: count }, (_unused, index) => decodeDwordWords(words, index * 2, "D"));
}

async function readFloat32s(client, device, count, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  const address = deviceToStringWithContext(resolvedDevice, options, client);
  requireDeviceUnit(address, resolvedDevice, DeviceUnit.WORD, "float32 access");
  if (isRandomDwordDevice(resolvedDevice.code) || getLongTimerReadAccess(resolvedDevice.code)) {
    throw new ValueError(`readFloat32s does not support ${resolvedDevice.code}; use its explicit semantic route.`);
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new ValueError(`readFloat32s count must be a positive safe integer: ${count}`);
  }
  validateSingleDirectPointCount(client, resolvedDevice, count * 2, false, false, "readFloat32s");
  const words = await client.readDevices(resolvedDevice, count * 2, { ...options, bitUnit: false });
  return Array.from({ length: count }, (_unused, index) => decodeDwordWords(words, index * 2, "F"));
}

async function readLongTimerLike(client, prefix, headNo, points, options = {}) {
  if (!Number.isSafeInteger(headNo) || headNo < 0) {
    throw new ValueError(`headNo must be a non-negative safe integer: ${headNo}`);
  }
  if (!Number.isSafeInteger(points) || points < 1) {
    throw new ValueError(`points must be a positive safe integer: ${points}`);
  }
  const wordPoints = points * 4;
  if (!Number.isSafeInteger(wordPoints)) {
    throw new ValueError(`points is too large: ${points}`);
  }
  const device = parseDeviceWithContext(`${prefix}${headNo}`, options, client);
  const maximum = effectiveProfileMaximum(client, "direct_word_read", 960);
  if (wordPoints > maximum) {
    throw new ValueError(`read${prefix} wire point count must be in range 1..${maximum}: ${wordPoints}`);
  }
  const words = Array.from(await client.readDevices(device, wordPoints, { ...options, bitUnit: false }));
  return Array.from({ length: points }, (_unused, index) => {
    const rawWords = words.slice(index * 4, index * 4 + 4);
    const statusWord = Number(rawWords[2]) & 0xffff;
    return {
      index: headNo + index,
      device: `${prefix}${headNo + index}`,
      currentValue: decodeDwordWords(rawWords, 0, "D"),
      contact: Boolean(statusWord & 0x0002),
      coil: Boolean(statusWord & 0x0001),
      statusWord,
      rawWords,
    };
  });
}

async function readLongTimer(client, headNo, points, options = {}) {
  return readLongTimerLike(client, "LTN", headNo, points, options);
}

async function readLongRetentiveTimer(client, headNo, points, options = {}) {
  return readLongTimerLike(client, "LSTN", headNo, points, options);
}

function parseNamedEntryAddress(address) {
  const text = String(address || "").trim();
  let core = text;
  let count = 1;
  let hasCount = false;
  const commaIndex = text.indexOf(",");
  if (commaIndex !== -1) {
    if (commaIndex !== text.lastIndexOf(",")) {
      throw new ValueError(`Address '${address}' has more than one count separator ','.`);
    }
    core = text.slice(0, commaIndex).trim();
    count = parsePositiveCountText(text.slice(commaIndex + 1), text);
    hasCount = true;
  }
  return { ...parseAddress(core), count, hasCount };
}

function requireStandalonePlcProfileOptions(options, operation) {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      !Object.prototype.hasOwnProperty.call(options, "plcProfile")) {
    throw new ValueError(`${operation} requires options.plcProfile`);
  }
  return { plcProfile: options.plcProfile };
}

function formatParsedAddress(parsed, options) {
  if (!parsed || typeof parsed !== "object") {
    throw new ValueError("parsed address must be an object");
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "count") ||
      Object.prototype.hasOwnProperty.call(parsed, "hasCount")) {
    throw new ValueError("formatParsedAddress accepts count-free AddressSpec values only");
  }
  const explicitOptions = requireStandalonePlcProfileOptions(options, "formatParsedAddress");
  const device = parseDevice(parsed.base, explicitOptions);
  const base = deviceToString(device, explicitOptions);
  if (parsed.bitIndex != null) {
    if (!Number.isInteger(parsed.bitIndex) || parsed.bitIndex < 0 || parsed.bitIndex > 15) {
      throw new ValueError(`bitIndex must be 0-15, got ${parsed.bitIndex}`);
    }
    return `${base}.${parsed.bitIndex.toString(16).toUpperCase()}`;
  }

  let text = base;
  const canonicalDtype = canonicalizeDtype(parsed.dtype);
  if (canonicalDtype === "BIT_IN_WORD") {
    throw new ValueError("BIT_IN_WORD requires an explicit bit index.");
  }
  const dtype = requireDtype(canonicalDtype);
  text += `:${dtype}`;
  return text;
}

function normalizeAddress(address, options) {
  requireStandalonePlcProfileOptions(options, "normalizeAddress");
  return formatParsedAddress(parseAddress(address), options);
}

function resolveEntryDtype(parsed) {
  if (parsed.dtype === "BIT_IN_WORD") {
    return "BIT_IN_WORD";
  }
  return requireDtype(parsed.dtype);
}

function getLongTimerReadAccess(deviceCode) {
  return LONG_TIMER_READ_FAMILIES[deviceCode] || null;
}

function validateBitInWordTarget(address, device) {
  const info = DEVICE_CODES[device.code];
  if (!info || info.unit !== DeviceUnit.WORD) {
    throw new ValueError(
      `Address '${address}' uses '.bit' notation, which is only valid for word devices. Use M1000 instead of M1000.0.`
    );
  }
}

function requireBitInWordIndex(address, bitIndex) {
  if (Number.isInteger(bitIndex) && bitIndex >= 0 && bitIndex <= 15) {
    return bitIndex;
  }
  throw new ValueError(`Address '${address}' uses BIT_IN_WORD but no bit index was specified. Use '.0' through '.F' notation.`);
}

function validateStringTarget(address, device) {
  const info = DEVICE_CODES[device.code];
  if (!info || info.unit !== DeviceUnit.WORD) {
    throw new ValueError(`Address '${address}' uses string notation, which is only valid for word devices.`);
  }
}

function requireDeviceUnit(address, device, unit, operation) {
  if (DEVICE_CODES[device.code]?.unit !== unit) {
    throw new ValueError(`Address '${address}' uses ${operation}, which requires a ${unit} device.`);
  }
}

function validateSemanticDtype(address, device, dtype) {
  if (dtype === "BIT") {
    requireDeviceUnit(address, device, DeviceUnit.BIT, "':BIT'");
    return;
  }
  requireDeviceUnit(address, device, DeviceUnit.WORD, `numeric type ':${dtype}'`);
}

function validateParsedEntry(address, device, dtype, parsed) {
  if (dtype === "BIT_IN_WORD") {
    validateBitInWordTarget(address, device);
    requireBitInWordIndex(address, parsed.bitIndex);
    if (parsed.hasCount) {
      throw new ValueError(`Address '${address}' does not support ',count' together with '.bit' notation.`);
    }
  }
  if (isStringDtype(dtype)) {
    validateStringTarget(address, device);
    if (!parsed.hasCount) {
      throw new ValueError(`Address '${address}' requires ',<length>' for string access.`);
    }
  }
  if (dtype !== "BIT_IN_WORD") {
    validateSemanticDtype(address, device, dtype);
  }
}

function validateLongTimerEntry(address, device, dtype) {
  validateLongTimerDtype(address, device, dtype);
}

function validateLongTimerDtype(address, device, dtype) {
  const access = getLongTimerReadAccess(device.code);
  if (!access) {
    return;
  }
  if (access.role === "current") {
    if (dtype !== "D" && dtype !== "L") {
      throw new ValueError(`Address '${address}' uses a 32-bit long current value. Use ':D' or ':L'.`);
    }
    return;
  }
  if (dtype !== "BIT") {
    throw new ValueError(`Address '${address}' is a long timer state device. Use ':BIT'.`);
  }
}

function validateDwordOnlyDtype(device, dtype) {
  if (device.code !== "LZ") {
    return;
  }
  if (dtype !== "D" && dtype !== "L") {
    throw new ValueError(`Address '${device.code}${device.number}' uses a 32-bit device. Use ':D' or ':L'.`);
  }
}

function isBatchableWordDevice(device) {
  const info = DEVICE_CODES[device.code];
  return Boolean(info && info.unit === DeviceUnit.WORD && !UNBATCHED_DEVICE_CODES.has(device.code));
}

function plainBitWordRead(device) {
  if (!PLAIN_BIT_WORD_BATCHABLE_CODES.has(device.code)) {
    return null;
  }
  const bitIndex = device.number % 16;
  return {
    device: makeDeviceRef(device.code, device.number - bitIndex, device.plcProfile),
    bitIndex,
  };
}

function isDwordDtype(dtype) {
  return DWORD_DTYPES.has(canonicalizeDtype(dtype));
}

function getScalarSpanLength(dtype) {
  return isDwordDtype(dtype) ? 2 : 1;
}

function getSpanLength(dtype, count) {
  if (isStringDtype(dtype)) {
    return Math.ceil(count / 2);
  }
  return getScalarSpanLength(dtype) * count;
}

function validateOrdinaryTypedWireSpan(client, device, dtype, count, label) {
  const info = DEVICE_CODES[device.code];
  if (!isDwordDtype(dtype) ||
      info?.unit !== DeviceUnit.WORD ||
      isRandomDwordDevice(device.code) ||
      getLongTimerReadAccess(device.code)) {
    return;
  }
  const plcSeries = client?.plcSeries ?? resolveConnectionProfile({ plcProfile: device.plcProfile }).plcSeries;
  validateWireDeviceSpan(device.number, getSpanLength(dtype, count), plcSeries, label);
}

function createReadEntry(address, index, options = {}) {
  const parsed = parseNamedEntryAddress(address);
  let device = parseDeviceWithContext(parsed.base, options, options.client);
  const dtype = resolveEntryDtype(parsed);
  validateParsedEntry(address, device, dtype, parsed);
  validateLongTimerEntry(address, device, dtype);
  validateDwordOnlyDtype(device, dtype);
  const longTimerRead = getLongTimerReadAccess(device.code);
  let entryDtype = dtype;
  let bitIndex = parsed.bitIndex;
  let plainBitWord = false;
  if (!parsed.hasCount && dtype === "BIT" && !longTimerRead) {
    const bitWord = plainBitWordRead(device);
    if (bitWord) {
      device = bitWord.device;
      entryDtype = "BIT_IN_WORD";
      bitIndex = bitWord.bitIndex;
      plainBitWord = true;
    }
  }
  const info = DEVICE_CODES[device.code];
  validateOrdinaryTypedWireSpan(options.client, device, entryDtype, parsed.count, `readNamed ${address}`);
  return {
    address,
    index,
    device,
    dtype: entryDtype,
    bitIndex,
    count: parsed.count,
    hasCount: parsed.hasCount,
    info,
    longTimerRead,
    plainBitWord,
    spanStart: device.number,
    spanLength: getSpanLength(entryDtype, parsed.count),
  };
}

function createWriteEntry(address, value, index, options = {}) {
  const parsed = parseNamedEntryAddress(address);
  const device = parseDeviceWithContext(parsed.base, options, options.client);
  const dtype = resolveEntryDtype(parsed);
  validateParsedEntry(address, device, dtype, parsed);
  validateLongTimerEntry(address, device, dtype);
  validateDwordOnlyDtype(device, dtype);
  const info = DEVICE_CODES[device.code];
  const longTimerRead = getLongTimerReadAccess(device.code);
  validateOrdinaryTypedWireSpan(options.client, device, dtype, parsed.count, `writeNamed ${address}`);
  const normalizedValue = normalizeWriteEntryValue(address, dtype, value, parsed.count, parsed.hasCount);
  return {
    address,
    value: normalizedValue,
    index,
    device,
    dtype,
    bitIndex: parsed.bitIndex,
    count: parsed.count,
    hasCount: parsed.hasCount,
    info,
    longTimerRead,
    spanStart: device.number,
    spanLength: getSpanLength(dtype, parsed.count),
  };
}

function isDirectBitEntry(entry) {
  return Boolean(entry.info && entry.info.unit === DeviceUnit.BIT && entry.dtype === "BIT");
}

function isPlainBitWordReadEntry(entry) {
  return Boolean(entry.plainBitWord && entry.dtype === "BIT_IN_WORD");
}

function isWordEntry(entry) {
  return Boolean(entry.info && entry.info.unit === DeviceUnit.WORD);
}

function isRandomWordEntry(entry) {
  return (
    isWordEntry(entry) &&
    (!entry.longTimerRead || isLongCounterCurrentEntry(entry)) &&
    !entry.hasCount &&
    entry.dtype !== "BIT_IN_WORD" &&
    !isStringDtype(entry.dtype) &&
    isBatchableWordDevice(entry.device)
  );
}

function isRandomReadWordEntry(entry) {
  return (
    isWordEntry(entry) &&
    (!entry.longTimerRead || isLongCounterCurrentEntry(entry)) &&
    isBatchableWordDevice(entry.device)
  );
}

function isRandomReadCompatibleEntry(entry) {
  if (isLongTimerReadEntry(entry) || isLongCounterStateDevice(entry.device.code)) {
    return false;
  }
  if (entry.dtype === "BIT") {
    return PLAIN_BIT_WORD_BATCHABLE_CODES.has(entry.device.code);
  }
  return isPlainBitWordReadEntry(entry)
    || isForcedRandomDwordReadEntry(entry)
    || isRandomReadWordEntry(entry);
}

function isLongTimerReadEntry(entry) {
  return Boolean(entry.longTimerRead && entry.longTimerRead.baseCode !== "LCN" && !isLongCounterStateDevice(entry.device.code));
}

function isLongTimerCurrentWriteEntry(entry) {
  return Boolean(entry.longTimerRead && entry.longTimerRead.role === "current");
}

function isLongCounterCurrentEntry(entry) {
  return Boolean(entry.longTimerRead && entry.longTimerRead.baseCode === "LCN" && entry.longTimerRead.role === "current");
}

function isForcedRandomDwordReadEntry(entry) {
  return Boolean(isDwordDtype(entry.dtype) && (isLongCounterCurrentEntry(entry) || entry.device.code === "LZ"));
}

function isForcedDwordRandomWriteEntry(entry) {
  return Boolean(isLongTimerCurrentWriteEntry(entry) || entry.device.code === "LZ");
}

function isLongStateRandomBitWriteEntry(entry) {
  return Boolean(entry.dtype === "BIT" && LONG_STATE_RANDOM_BIT_CODES.has(entry.device.code));
}

function isLongCounterStateDevice(code) {
  return code === "LCS" || code === "LCC";
}

function isRandomDwordDevice(code) {
  return RANDOM_DWORD_DEVICE_CODES.has(code);
}

function buildClusters(entries) {
  const byCode = new Map();
  for (const entry of entries) {
    const list = byCode.get(entry.device.code) || [];
    list.push(entry);
    byCode.set(entry.device.code, list);
  }

  const clusters = [];
  for (const [code, list] of byCode.entries()) {
    const sorted = [...list].sort((left, right) => left.spanStart - right.spanStart || left.index - right.index);
    let current = null;
    for (const entry of sorted) {
      const start = entry.spanStart;
      const end = entry.spanStart + entry.spanLength;
      if (!current || start > current.end) {
        if (current) {
          clusters.push(current);
        }
        current = { code, start, end, plcProfile: entry.device.plcProfile, entries: [entry] };
        continue;
      }
      current.end = Math.max(current.end, end);
      current.entries.push(entry);
    }
    if (current) {
      clusters.push(current);
    }
  }
  return clusters;
}

function compileReadPlan(addresses, options = {}) {
  const entries = addresses.map((address, index) => createReadEntry(address, index, options));
  const randomEntries = entries.filter(isRandomReadCompatibleEntry);
  if (randomEntries.length !== entries.length) {
    const unsupported = entries.find((entry) => !randomEntries.includes(entry));
    if (unsupported && isLongTimerReadEntry(unsupported)) {
      throw new ValueError(
        `readNamed does not route '${unsupported.address}' through a hidden long-timer Direct Read; use readTyped or an explicit long-timer helper`
      );
    }
    throw new ValueError(
      `readNamed entry '${unsupported?.address}' cannot fit the one Random Read contract; use an explicit typed/direct read`
    );
  }

  const randomPlan = compileRandomWirePlan(randomEntries, options);
  for (const entry of entries) {
    Object.freeze(entry.device);
    Object.freeze(entry);
  }
  Object.freeze(entries);
  Object.freeze(randomEntries);
  const plan = Object.freeze({ entries, randomEntries });
  compiledReadPlanInternals.set(plan, randomPlan);
  return plan;
}

function decodeWordValue(value, dtype) {
  const key = canonicalizeDtype(dtype);
  if (key === "S") {
    const raw = Buffer.alloc(2);
    raw.writeUInt16LE(Number(value) & 0xffff, 0);
    return raw.readInt16LE(0);
  }
  return Number(value);
}

function decodeDwordValue(value, dtype) {
  const key = canonicalizeDtype(dtype);
  const raw = Buffer.alloc(4);
  raw.writeUInt32LE(Number(value) >>> 0, 0);
  if (key === "F") {
    return raw.readFloatLE(0);
  }
  if (key === "L") {
    return raw.readInt32LE(0);
  }
  return raw.readUInt32LE(0);
}

function decodeDwordWords(words, offset, dtype) {
  const key = canonicalizeDtype(dtype);
  const raw = Buffer.alloc(4);
  raw.writeUInt16LE(Number(words[offset]) & 0xffff, 0);
  raw.writeUInt16LE(Number(words[offset + 1]) & 0xffff, 2);
  if (key === "F") {
    return raw.readFloatLE(0);
  }
  if (key === "L") {
    return raw.readInt32LE(0);
  }
  return raw.readUInt32LE(0);
}

function decodeLongTimerPoint(words, offset, entry) {
  const base = offset * 4;
  if (entry.longTimerRead.role === "current") {
    return decodeDwordWords(words, base, entry.dtype);
  }
  const statusWord = Number(words[base + 2] || 0) & 0xffff;
  return entry.longTimerRead.role === "contact" ? Boolean(statusWord & 0x0002) : Boolean(statusWord & 0x0001);
}

function decodeLongTimerEntry(words, clusterStart, entry) {
  const startOffset = entry.device.number - clusterStart;
  if (entry.hasCount) {
    const values = [];
    for (let index = 0; index < entry.count; index += 1) {
      values.push(decodeLongTimerPoint(words, startOffset + index, entry));
    }
    return values;
  }
  return decodeLongTimerPoint(words, startOffset, entry);
}

async function readLongTimerScalar(client, device, dtype, longTimerRead, options = {}) {
  const words = await client.readDevices(makeDeviceRef(longTimerRead.baseCode, device.number, device.plcProfile), 4, {
    ...options,
    bitUnit: false,
  });
  return decodeLongTimerEntry(
    words,
    device.number,
    {
      device,
      dtype,
      count: 1,
      hasCount: false,
      longTimerRead,
    }
  );
}

function encodeWriteWords(dtype, value) {
  const key = requireDtype(dtype);
  if (isStringDtype(key)) {
    throw new ValueError("String values require a length-qualified address such as 'D100:STR,10'.");
  }
  if (key === "F" || key === "L" || key === "D") {
    const normalizedValue = normalizeNumericWriteValue(key, value, "write value");
    const raw = Buffer.alloc(4);
    if (key === "F") {
      raw.writeFloatLE(normalizedValue, 0);
    } else if (key === "L") {
      raw.writeInt32LE(normalizedValue, 0);
    } else {
      raw.writeUInt32LE(normalizedValue, 0);
    }
    return [raw.readUInt16LE(0), raw.readUInt16LE(2)];
  }
  if (key === "S") {
    const normalizedValue = normalizeNumericWriteValue(key, value, "write value");
    const raw = Buffer.alloc(2);
    raw.writeInt16LE(normalizedValue, 0);
    return [raw.readUInt16LE(0)];
  }
  return [normalizeNumericWriteValue(key, value, "write value")];
}

function encodeRandomWriteValue(dtype, value) {
  const words = encodeWriteWords(dtype, value);
  if (words.length === 1) {
    return words[0];
  }
  const raw = Buffer.alloc(4);
  raw.writeUInt16LE(words[0], 0);
  raw.writeUInt16LE(words[1], 2);
  return raw.readUInt32LE(0);
}

function encodeStringWords(address, value, byteLength) {
  if (typeof value !== "string") {
    throw new ValueError(`Address '${address}' expects a string value.`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > byteLength) {
    throw new ValueError(`Address '${address}' accepts at most ${byteLength} UTF-8 byte(s), got ${bytes.length}.`);
  }
  const raw = Buffer.alloc(Math.ceil(byteLength / 2) * 2, 0);
  bytes.copy(raw, 0, 0, bytes.length);
  const words = [];
  for (let index = 0; index < raw.length; index += 2) {
    words.push(raw.readUInt16LE(index));
  }
  return words;
}

function normalizeArrayValue(entry) {
  if (entry.count === 1 && !Array.isArray(entry.value)) {
    return [entry.value];
  }
  if (!Array.isArray(entry.value)) {
    throw new ValueError(`Address '${entry.address}' expects an array with ${entry.count} item(s).`);
  }
  if (entry.value.length !== entry.count) {
    throw new ValueError(`Address '${entry.address}' expects ${entry.count} item(s), got ${entry.value.length}.`);
  }
  return entry.value;
}

function encodeEntryWords(entry) {
  if (isStringDtype(entry.dtype)) {
    return encodeStringWords(entry.address, entry.value, entry.count);
  }
  if (entry.hasCount) {
    const values = normalizeArrayValue(entry);
    const words = [];
    for (const value of values) {
      words.push(...encodeWriteWords(entry.dtype, value));
    }
    return words;
  }
  return encodeWriteWords(entry.dtype, entry.value);
}

function makeDeviceRef(code, number, plcProfile) {
  return Object.freeze({ code, number, plcProfile });
}

async function readRandomMaps(client, plan, options = {}) {
  const wordValues = {};
  const dwordValues = {};
  const words = plan.wordDevices || [];
  const dwords = plan.dwordDevices || [];
  const total = words.length + dwords.length;
  const maximum = randomReadMaximum(client);
  if (total < 1 || total > maximum) {
    throw new ValueError(
      `readNamed random device count must fit one request (1..${maximum}): word=${words.length}, dword=${dwords.length}`
    );
  }
  const response = await client.readRandom({ ...options, wordDevices: words, dwordDevices: dwords });
  Object.assign(wordValues, response.word);
  Object.assign(dwordValues, response.dword);
  return { wordValues, dwordValues };
}

async function readRandomDwordScalar(client, device, dtype, options = {}) {
  const result = await client.readRandom({ ...options, wordDevices: [], dwordDevices: [device] });
  const key = deviceToStringWithContext(device, options, client);
  return decodeDwordValue(result.dword[key], dtype);
}

function randomDwordStride(entry) {
  return isRandomDwordDevice(entry.device.code) ? 1 : 2;
}

function randomRequestDevicesForEntry(entry) {
  if (entry.dtype === "BIT_IN_WORD") {
    return { wordDevices: [entry.device], dwordDevices: [] };
  }
  if (entry.dtype === "BIT") {
    const first = entry.device.number - (entry.device.number % 16);
    const lastPoint = entry.device.number + entry.count - 1;
    const last = lastPoint - (lastPoint % 16);
    const wordDevices = [];
    for (let number = first; number <= last; number += 16) {
      wordDevices.push(makeDeviceRef(entry.device.code, number, entry.device.plcProfile));
    }
    return { wordDevices, dwordDevices: [] };
  }
  if (isDwordDtype(entry.dtype)) {
    const dwordDevices = [];
    const count = entry.hasCount ? entry.count : 1;
    const stride = randomDwordStride(entry);
    for (let index = 0; index < count; index += 1) {
      dwordDevices.push(makeDeviceRef(
        entry.device.code,
        entry.device.number + index * stride,
        entry.device.plcProfile
      ));
    }
    return { wordDevices: [], dwordDevices };
  }
  const count = isStringDtype(entry.dtype)
    ? Math.ceil(entry.count / 2)
    : entry.hasCount ? entry.count : 1;
  const wordDevices = [];
  for (let index = 0; index < count; index += 1) {
    wordDevices.push(makeDeviceRef(entry.device.code, entry.device.number + index, entry.device.plcProfile));
  }
  return { wordDevices, dwordDevices: [] };
}

function compileRandomWirePlan(entries, options) {
  const client = options.client;
  const wordDevices = [];
  const dwordDevices = [];
  const wordKeys = [];
  const dwordKeys = [];
  const wordIndexes = new Map();
  const dwordIndexes = new Map();

  const register = (device, devices, keys, indexes) => {
    const key = deviceToStringWithContext(device, options, client);
    if (!indexes.has(key)) {
      indexes.set(key, devices.length);
      devices.push(Object.freeze(device));
      keys.push(key);
    }
    return indexes.get(key);
  };

  for (const entry of entries) {
    const requests = randomRequestDevicesForEntry(entry);
    const entryPlan = {
      wordIndexes: requests.wordDevices.map((device) => register(device, wordDevices, wordKeys, wordIndexes)),
      dwordIndexes: requests.dwordDevices.map((device) => register(device, dwordDevices, dwordKeys, dwordIndexes)),
      bitSelections: [],
    };
    if (entry.dtype === "BIT") {
      for (let index = 0; index < entry.count; index += 1) {
        const number = entry.device.number + index;
        const head = number - (number % 16);
        const key = deviceToStringWithContext(
          makeDeviceRef(entry.device.code, head, entry.device.plcProfile),
          options,
          client,
        );
        entryPlan.bitSelections.push(Object.freeze({ wordIndex: wordIndexes.get(key), bitIndex: number - head }));
      }
    }
    Object.freeze(entryPlan.wordIndexes);
    Object.freeze(entryPlan.dwordIndexes);
    Object.freeze(entryPlan.bitSelections);
    compiledReadEntryInternals.set(entry, Object.freeze(entryPlan));
  }
  Object.freeze(wordDevices);
  Object.freeze(dwordDevices);
  Object.freeze(wordKeys);
  Object.freeze(dwordKeys);
  return Object.freeze({ wordDevices, dwordDevices, wordKeys, dwordKeys });
}

function decodeRandomString(words, byteLength) {
  const raw = Buffer.alloc(words.length * 2);
  words.forEach((word, index) => raw.writeUInt16LE(Number(word) & 0xffff, index * 2));
  const bytes = raw.subarray(0, byteLength);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

async function stageRandomReadPlan(client, plan, options = {}) {
  return readRandomMaps(client, compiledReadPlanInternals.get(plan), options);
}

function materializeRandomReadPlan(plan, staged) {
  const { wordValues, dwordValues } = staged;
  const wirePlan = compiledReadPlanInternals.get(plan);
  const wordValuesByIndex = wirePlan.wordKeys.map((key) => wordValues[key]);
  const dwordValuesByIndex = wirePlan.dwordKeys.map((key) => dwordValues[key]);
  const result = Object.fromEntries(plan.entries.map((entry) => [entry.address, undefined]));
  const entries = plan.randomEntries;
  for (const entry of entries) {
    const entryPlan = compiledReadEntryInternals.get(entry);
    if (isDwordDtype(entry.dtype)) {
      const values = entryPlan.dwordIndexes.map((index) => decodeDwordValue(dwordValuesByIndex[index], entry.dtype));
      result[entry.address] = entry.hasCount ? values : values[0];
      continue;
    }
    if (entry.dtype === "BIT_IN_WORD") {
      const word = wordValuesByIndex[entryPlan.wordIndexes[0]];
      result[entry.address] = Boolean((word >> requireBitInWordIndex(entry.address, entry.bitIndex)) & 0x1);
      continue;
    }
    if (entry.dtype === "BIT") {
      const values = entryPlan.bitSelections.map(({ wordIndex, bitIndex }) =>
        Boolean((Number(wordValuesByIndex[wordIndex]) >> bitIndex) & 0x1));
      result[entry.address] = entry.hasCount ? values : values[0];
      continue;
    }
    const values = entryPlan.wordIndexes.map((index) => wordValuesByIndex[index]);
    if (isStringDtype(entry.dtype)) {
      result[entry.address] = decodeRandomString(values, entry.count);
    } else {
      const decoded = values.map((value) => decodeWordValue(value, entry.dtype));
      result[entry.address] = entry.hasCount ? decoded : decoded[0];
    }
  }
  return result;
}

function snapshotAggregateOptions(options = {}) {
  const snapshot = { ...options };
  if (Object.prototype.hasOwnProperty.call(options, "target")) {
    snapshot.target = Object.freeze(normalizeTarget(options.target));
  }
  return Object.freeze(snapshot);
}

function snapshotClientRequestOptions(client, options = {}) {
  const snapshot = { ...options };
  if (Object.prototype.hasOwnProperty.call(options, "target")) {
    snapshot.target = Object.freeze(normalizeTarget(options.target));
  } else if (client?.defaultTarget != null) {
    snapshot.target = Object.freeze(normalizeTarget(client.defaultTarget));
  }
  if (!Object.prototype.hasOwnProperty.call(options, "monitoringTimer") && client?.monitoringTimer != null) {
    snapshot.monitoringTimer = client.monitoringTimer;
  }
  if (!Object.prototype.hasOwnProperty.call(options, "raiseOnError") && client?.raiseOnError != null) {
    snapshot.raiseOnError = client.raiseOnError;
  }
  return Object.freeze(snapshot);
}

function effectiveProfileMaximum(client, key, fallback) {
  const limit = getProfileLimit(client?.plcProfile, key);
  return limit && Number.isInteger(limit.maxPoints) ? limit.maxPoints : fallback;
}

function validateSingleDirectPointCount(client, device, points, bitUnit, write, label) {
  const fallback = bitUnit ? (client?.plcProfile === "melsec:iq-f" ? 3584 : 7168) : 960;
  const key = `direct_${bitUnit ? "bit" : "word"}_${write ? "write" : "read"}`;
  const maximum = effectiveProfileMaximum(client, key, fallback);
  if (!Number.isInteger(points) || points < 1 || points > maximum) {
    throw new ValueError(`${label} point count must be in range 1..${maximum}: ${points}`);
  }
  const plcSeries = client?.plcSeries ?? resolveConnectionProfile({ plcProfile: device.plcProfile }).plcSeries;
  validateWireDeviceSpan(device.number, points, plcSeries, label);
}

function randomReadMaximum(client) {
  const fallback = client?.plcSeries === PLCSeries.IQR || client?.plcProfile === "melsec:iq-r"
    ? 96
    : 192;
  return effectiveProfileMaximum(client, "random_read_word", fallback);
}

function randomWriteWordLimits(client) {
  const profileLimit = getProfileLimit(client?.plcProfile, "random_write_word");
  const iqrFallback = client?.plcSeries === PLCSeries.IQR || client?.plcProfile === "melsec:iq-r";
  return {
    count: profileLimit && Number.isInteger(profileLimit.maxPoints)
      ? profileLimit.maxPoints
      : iqrFallback ? 80 : 160,
    weighted: profileLimit && Number.isInteger(profileLimit.weightedMaxPoints)
      ? profileLimit.weightedMaxPoints
      : iqrFallback ? 960 : 1920,
  };
}

function validateRandomWriteWordPlan(client, wordCount, dwordCount, label) {
  const total = wordCount + dwordCount;
  const limits = randomWriteWordLimits(client);
  const weighted = wordCount * RANDOM_WRITE_WORD_WEIGHT + dwordCount * RANDOM_WRITE_DWORD_WEIGHT;
  if (total < 1 || total > limits.count || weighted > limits.weighted) {
    throw new ValueError(
      `${label} must fit one request: word=${wordCount}, dword=${dwordCount}, ` +
      `count=${total}, countLimit=${limits.count}, weighted=${weighted}, weightedLimit=${limits.weighted}`
    );
  }
}

function randomWriteBitMaximum(client) {
  const fallback = client?.plcSeries === PLCSeries.IQR || client?.plcProfile === "melsec:iq-r"
    ? 94
    : 188;
  return effectiveProfileMaximum(client, "random_write_bit", fallback);
}

function compileReadOperations(client, plan, options) {
  const randomMaximum = randomReadMaximum(client);
  const wirePlan = compiledReadPlanInternals.get(plan);
  const uniqueDeviceCount = wirePlan.wordDevices.length + wirePlan.dwordDevices.length;
  if (uniqueDeviceCount < 1 || uniqueDeviceCount > randomMaximum) {
    throw new ValueError(
      `readNamed random device count must fit one request (1..${randomMaximum}): ${uniqueDeviceCount}`
    );
  }
  if (typeof client?._ensureProfileFeatureAllowed === "function") {
    client._ensureProfileFeatureAllowed("random");
  }
  return Object.freeze([{ execute: () => stageRandomReadPlan(client, plan, options) }]);
}

function prepareReadNamed(client, addresses, options = {}) {
  if (client === null || typeof client !== "object"
      || typeof client._prepareRandomReadPlan !== "function"
      || typeof client._executeRandomReadPlan !== "function") {
    throw new ValueError("prepareReadNamed requires a SlmpClient instance");
  }
  if (Object.prototype.hasOwnProperty.call(options, "signal")) {
    throw new ValueError("prepareReadNamed accepts signal only in plan.execute({ signal })");
  }
  const list = normalizeAddressList(addresses);
  const requestOptions = snapshotAggregateOptions(options);
  const structuralPlan = compileReadPlan(list, { ...requestOptions, client });
  const wirePlan = compiledReadPlanInternals.get(structuralPlan);
  const preparedWirePlan = client._prepareRandomReadPlan({
    ...requestOptions,
    wordDevices: wirePlan.wordDevices,
    dwordDevices: wirePlan.dwordDevices,
  });
  const signature = snapshotPreparedClientSignature(client, requestOptions);
  const internals = {
    client,
    disposed: false,
    preparedWirePlan,
    signature,
    structuralPlan,
  };

  let publicPlan;
  publicPlan = Object.freeze({
    execute(executeOptions = {}) {
      if (this !== publicPlan || preparedNamedReadPlanInternals.get(publicPlan) !== internals) {
        return Promise.reject(new ValueError("prepared named-read plan is invalid or forged"));
      }
      if (internals.disposed) {
        return Promise.reject(new ValueError("prepared named-read plan is disposed"));
      }
      try {
        assertPreparedClientSignature(internals.client, internals.signature);
      } catch (error) {
        return Promise.reject(error);
      }
      const executionClient = internals.client;
      const executionWirePlan = internals.preparedWirePlan;
      const executionStructuralPlan = internals.structuralPlan;
      return executionClient._executeRandomReadPlan(executionWirePlan, executeOptions)
        .then((staged) => materializeRandomReadPlan(executionStructuralPlan, {
          wordValues: staged.word,
          dwordValues: staged.dword,
        }));
    },
    dispose() {
      if (this !== publicPlan || preparedNamedReadPlanInternals.get(publicPlan) !== internals) {
        throw new ValueError("prepared named-read plan is invalid or forged");
      }
      internals.disposed = true;
      internals.client = null;
      internals.preparedWirePlan = null;
      internals.signature = null;
      internals.structuralPlan = null;
    },
  });
  preparedNamedReadPlanInternals.set(publicPlan, internals);
  return publicPlan;
}

function snapshotPreparedClientSignature(client, requestOptions) {
  const usesDefaultTarget = !Object.prototype.hasOwnProperty.call(requestOptions, "target");
  const target = !usesDefaultTarget
    ? normalizeTarget(requestOptions.target)
    : normalizeTarget(client.defaultTarget);
  return Object.freeze({
    addressProfile: client.addressProfile,
    compatibility: client.compatibility ?? client.compat ?? null,
    frameType: client.frameType,
    plcProfile: client.plcProfile,
    plcSeries: client.plcSeries,
    target: Object.freeze(target),
    transportType: client.transportType,
    usesDefaultTarget,
  });
}

function assertPreparedClientSignature(client, signature) {
  if (client.addressProfile !== signature.addressProfile
      || (client.compatibility ?? client.compat ?? null) !== signature.compatibility
      || client.frameType !== signature.frameType
      || client.plcProfile !== signature.plcProfile
      || client.plcSeries !== signature.plcSeries
      || client.transportType !== signature.transportType) {
    throw new ValueError("prepared named-read plan no longer matches the client profile/frame/compatibility");
  }
  if (signature.usesDefaultTarget) {
    const target = normalizeTarget(client.defaultTarget);
    if (target.network !== signature.target.network
        || target.station !== signature.target.station
        || target.moduleIO !== signature.target.moduleIO
        || target.multidrop !== signature.target.multidrop) {
      throw new ValueError("prepared named-read plan no longer matches the client target");
    }
  }
}

async function readNamed(client, addresses, options = {}) {
  const list = normalizeAddressList(addresses);
  const requestOptions = snapshotAggregateOptions(options);
  const plan = compileReadPlan(list, { ...requestOptions, client });
  const operations = compileReadOperations(client, plan, requestOptions);
  const execute = async () => {
    let staged;
    for (const operation of operations) {
      staged = await operation.execute();
    }
    return staged;
  };
  const staged = await execute();
  return materializeRandomReadPlan(plan, staged);
}

async function executeRandomWrites(client, entries, options = {}) {
  const wordValues = [];
  const dwordValues = [];
  for (const entry of entries) {
    if (isDwordDtype(entry.dtype)) {
      dwordValues.push([entry.device, encodeRandomWriteValue(entry.dtype, entry.value)]);
      continue;
    }
    wordValues.push([entry.device, encodeWriteWords(entry.dtype, entry.value)[0]]);
  }

  validateRandomWriteWordPlan(client, wordValues.length, dwordValues.length, "writeNamed random word/dword values");
  await client.writeRandomWords({ ...options, wordValues, dwordValues });
}

function normalizeBitEntryValues(entry) {
  if (!entry.hasCount) {
    return [normalizeBooleanWriteValue(entry.value, entry.address)];
  }
  return normalizeArrayValue(entry).map((value) => normalizeBooleanWriteValue(value, entry.address));
}

async function executeBitWriteCluster(client, cluster, options = {}) {
  const values = new Array(cluster.end - cluster.start);
  const assigned = new Set();
  const entries = [...cluster.entries].sort((left, right) => left.index - right.index);
  for (const entry of entries) {
    const offset = entry.device.number - cluster.start;
    const entryValues = normalizeBitEntryValues(entry);
    for (let index = 0; index < entryValues.length; index += 1) {
      const slot = offset + index;
      if (assigned.has(slot)) {
        throw new ValueError(`writeNamed contains overlapping bit destination ${cluster.code}${cluster.start + slot}`);
      }
      assigned.add(slot);
      values[slot] = entryValues[index];
    }
  }
  requireFullySpecifiedCluster(cluster, values, "bit");
  await client.writeDevices(makeDeviceRef(cluster.code, cluster.start, cluster.plcProfile), values, { ...options, bitUnit: true });
}

function compileWordWriteCluster(cluster) {
  const words = new Array(cluster.end - cluster.start);
  const assigned = new Set();
  for (const entry of [...cluster.entries].sort((left, right) => left.index - right.index)) {
    if (entry.dtype === "BIT_IN_WORD") {
      throw new ValueError("writeNamed does not perform bit-in-word read-modify-write; use writeBitInWord explicitly");
    }
    const offset = entry.device.number - cluster.start;
    const encoded = encodeEntryWords(entry);
    for (let index = 0; index < encoded.length; index += 1) {
      const slot = offset + index;
      if (assigned.has(slot)) {
        throw new ValueError(`writeNamed contains overlapping destination ${cluster.code}${cluster.start + slot}`);
      }
      assigned.add(slot);
      words[slot] = encoded[index];
    }
  }
  requireFullySpecifiedCluster(cluster, words, "word");
  return [makeDeviceRef(cluster.code, cluster.start, cluster.plcProfile), words];
}

async function executeWordWriteClusters(client, clusters, options = {}) {
  const wordBlocks = clusters.map(compileWordWriteCluster);
  if (wordBlocks.length === 1) {
    const [device, values] = wordBlocks[0];
    await client.writeDevices(device, values, { ...options, bitUnit: false });
    return;
  }
  await client.writeBlock({ ...options, wordBlocks });
}

function requireFullySpecifiedCluster(cluster, values, unit) {
  const missing = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === undefined) {
      missing.push(cluster.start + index);
    }
  }
  if (missing.length > 0) {
    throw new ValueError(
      `Cannot block-write ${unit} cluster ${cluster.code}${cluster.start}..${cluster.code}${cluster.end - 1}: ` +
      `missing explicit value(s) at ${missing.map((number) => `${cluster.code}${number}`).join(", ")}. ` +
      "Use a contiguous update set or random/individual writes."
    );
  }
}

async function executeLongCurrentWrites(client, entries, options = {}) {
  const dwordValues = [];
  for (const entry of entries) {
    const values = entry.hasCount ? normalizeArrayValue(entry) : [entry.value];
    for (let index = 0; index < values.length; index += 1) {
      dwordValues.push([
        makeDeviceRef(entry.device.code, entry.device.number + index, entry.device.plcProfile),
        encodeRandomWriteValue(entry.dtype, values[index]),
      ]);
    }
  }

  validateRandomWriteWordPlan(client, 0, dwordValues.length, "writeNamed long-current values");
  await client.writeRandomWords({ ...options, wordValues: [], dwordValues });
}

async function executeRandomBitWrites(client, entries, options = {}) {
  const bitValues = [];
  for (const entry of entries) {
    const values = entry.hasCount
      ? normalizeArrayValue(entry).map((value) => normalizeBooleanWriteValue(value, entry.address))
      : [normalizeBooleanWriteValue(entry.value, entry.address)];
    for (let index = 0; index < values.length; index += 1) {
      bitValues.push([makeDeviceRef(entry.device.code, entry.device.number + index, entry.device.plcProfile), values[index]]);
    }
  }

  const bitLimit = randomWriteBitMaximum(client);
  if (bitValues.length > bitLimit) {
    throw new ValueError(
      `writeNamed random bit values must fit one request (1..${bitLimit}): ${bitValues.length}`
    );
  }
  await client.writeRandomBits({ ...options, bitValues });
}

async function writeNamed(client, updates, options = {}) {
  const requestOptions = snapshotAggregateOptions(options);
  const entries = Object.entries(updates || {}).map(([address, value], index) =>
    createWriteEntry(address, value, index, { ...requestOptions, client })
  );
  if (entries.length === 0) {
    throw new ValueError("writeNamed requires at least one update");
  }
  const unsupported = entries.filter((entry) => entry.dtype === "BIT_IN_WORD");
  if (unsupported.length > 0) {
    throw new ValueError(
      "writeNamed does not perform bit-in-word read-modify-write; use writeBitInWord explicitly"
    );
  }
  const forcedDwordRandomEntries = entries.filter(isForcedDwordRandomWriteEntry);
  const longStateRandomBitEntries = entries.filter(isLongStateRandomBitWriteEntry);
  const plainEntries = entries.filter((entry) => !isForcedDwordRandomWriteEntry(entry) && !isLongStateRandomBitWriteEntry(entry));
  const bitClusters = buildClusters(plainEntries.filter(isDirectBitEntry));
  const wordClusters = buildClusters(plainEntries.filter(isWordEntry));
  const randomEntries = [];
  const blockWordClusters = [];
  for (const cluster of wordClusters) {
    if (cluster.entries.length === 1 && isRandomWordEntry(cluster.entries[0])) {
      randomEntries.push(cluster.entries[0]);
    } else {
      blockWordClusters.push(cluster);
    }
  }

  const operationCount = (forcedDwordRandomEntries.length > 0 ? 1 : 0)
    + (longStateRandomBitEntries.length > 0 ? 1 : 0)
    + (randomEntries.length > 0 ? 1 : 0)
    + bitClusters.length
    + (blockWordClusters.length > 0 ? 1 : 0);
  if (operationCount !== 1) {
    throw new ValueError("writeNamed must fit exactly one protocol request; use explicit write calls for multiple routes");
  }
  if (forcedDwordRandomEntries.length > 0) {
    await executeLongCurrentWrites(client, forcedDwordRandomEntries, requestOptions);
  } else if (longStateRandomBitEntries.length > 0) {
    await executeRandomBitWrites(client, longStateRandomBitEntries, requestOptions);
  } else if (randomEntries.length > 0) {
    await executeRandomWrites(client, randomEntries, requestOptions);
  } else if (bitClusters.length === 1) {
    await executeBitWriteCluster(client, bitClusters[0], requestOptions);
  } else {
    await executeWordWriteClusters(client, blockWordClusters, requestOptions);
  }
}

function tokenizeAddressList(text) {
  const result = [];
  let index = 0;
  const source = String(text || "");

  while (index < source.length) {
    while (index < source.length && /[\s,;]+/.test(source[index])) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }
    ADDRESS_LIST_TOKEN_RE.lastIndex = index;
    const match = ADDRESS_LIST_TOKEN_RE.exec(source);
    if (!match || match.index !== index) {
      throw new ValueError(`Invalid address list near ${JSON.stringify(source.slice(index, index + 20))}.`);
    }
    result.push(match[0].trim());
    index = ADDRESS_LIST_TOKEN_RE.lastIndex;
  }

  return result;
}

function normalizeAddressList(addresses) {
  if (Array.isArray(addresses)) {
    return addresses.map((item) => String(item).trim()).filter(Boolean);
  }
  return tokenizeAddressList(addresses).filter(Boolean);
}

function resolveAddressProfile(options = {}, client = null) {
  if (Object.prototype.hasOwnProperty.call(options, "family")) {
    throw new ValueError("options.family is no longer supported; use plcProfile.");
  }
  if (options.plcProfile != null) {
    return options.plcProfile;
  }
  if (client && client.addressProfile != null) {
    return client.addressProfile;
  }
  return null;
}

function resolveExplicitPlcProfile(options = {}, client = null) {
  if (options.plcProfile != null) {
    return options.plcProfile;
  }
  if (client && client.plcProfile != null) {
    return client.plcProfile;
  }
  return resolveAddressProfile(options, client);
}

function parseDeviceWithContext(device, options = {}, client = null) {
  const addressProfile = resolveAddressProfile(options, client);
  const plcProfile = resolveExplicitPlcProfile(options, client);
  const ref = parseDevice(device, { addressProfile, plcProfile });
  return requireExplicitPlcProfileForXY(device, plcProfile, ref);
}

function deviceToStringWithContext(device, options = {}, client = null) {
  return deviceToString(device, { plcProfile: resolveExplicitPlcProfile(options, client) });
}

module.exports = {
  compileReadPlan,
  formatParsedAddress,
  normalizeAddress,
  normalizeAddressList,
  parseAddress,
  prepareReadNamed,
  readBits,
  readBitsSingleRequest,
  readDWordsSingleRequest,
  readFloat32s,
  readLongRetentiveTimer,
  readLongTimer,
  readNamed,
  readTyped,
  readWordsSingleRequest,
  writeBitInWord,
  writeBits,
  writeBitsSingleRequest,
  writeNamed,
  writeTyped,
  writeWordsSingleRequest,
};
