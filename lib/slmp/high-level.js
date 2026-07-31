"use strict";

const { DEVICE_CODES, DeviceUnit, PLCSeries } = require("./constants");
const { getProfileLimit } = require("./capability-profiles");
const { SlmpProfileFeatureError } = require("./errors");
const {
  ValueError,
  deviceToString,
  normalizeTarget,
  parseDevice,
  requireExplicitPlcProfileForXY,
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
const RANDOM_WRITE_WEIGHT_LIMIT = 960;
const RANDOM_WRITE_BIT_BATCH_LIMIT = 94;
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

async function readTyped(client, device, dtype, options = {}) {
  const key = requireDtype(dtype);
  if (isStringDtype(key)) {
    throw new ValueError("String reads require readNamed with '<device>:STR,<length>' or '<device>STR<number>,<length>'.");
  }
  const resolvedDevice = parseDeviceWithContext(device, options, client);
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
  const longTimerRead = getLongTimerReadAccess(resolvedDevice.code);
  if (longTimerRead) {
    validateLongTimerDtype(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, key);
  }
  validateDwordOnlyDtype(resolvedDevice, key);
  if (key === "BIT") {
    const normalizedValue = normalizeBooleanWriteValue(value, deviceToStringWithContext(resolvedDevice, options, client));
    if (LONG_STATE_RANDOM_BIT_CODES.has(resolvedDevice.code)) {
      await client.writeRandomBits({ bitValues: [[resolvedDevice, normalizedValue]], ...options });
      return;
    }
    await client.writeDevices(resolvedDevice, [normalizedValue], { ...options, bitUnit: true });
    return;
  }
  if ((key === "D" || key === "L") && isRandomDwordDevice(resolvedDevice.code)) {
    await client.writeRandomWords({
      wordValues: [],
      dwordValues: [[resolvedDevice, encodeRandomWriteValue(key, value)]],
      ...options,
    });
    return;
  }
  await client.writeDevices(resolvedDevice, encodeWriteWords(key, value), { ...options, bitUnit: false });
}

async function readBits(client, device, count, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  const values = await client.readDevices(resolvedDevice, count, { ...options, bitUnit: true });
  return values.map((value) => Boolean(value));
}

async function writeBits(client, device, values, options = {}) {
  const resolvedDevice = parseDeviceWithContext(device, options, client);
  const address = deviceToStringWithContext(resolvedDevice, options, client);
  const normalizedValues = Array.from(values || [], (value, index) =>
    normalizeBooleanWriteValue(value, `${address}[${index}]`)
  );
  await client.writeDevices(resolvedDevice, normalizedValues, { ...options, bitUnit: true });
}

async function writeBitInWord(client, device, bitIndex, value, options = {}) {
  if (!Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 15) {
    throw new ValueError(`bitIndex must be 0-15, got ${bitIndex}`);
  }
  const requestOptions = snapshotClientRequestOptions(client, options);
  const resolvedDevice = parseDeviceWithContext(device, requestOptions, client);
  const address = deviceToStringWithContext(resolvedDevice, requestOptions, client);
  validateBitInWordTarget(address, resolvedDevice);
  const normalizedValue = normalizeBooleanWriteValue(value, address);
  const preparedDevice = typeof client?._preflightBitInWordRmw === "function"
    ? client._preflightBitInWordRmw(resolvedDevice, requestOptions)
    : resolvedDevice;
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
  let normalized;
  if (typeof value === "number") {
    normalized = value;
  } else if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    normalized = Number(value.trim());
  } else {
    throw new ValueError(`Address '${address}' expects a numeric value.`);
  }

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

function parsePositiveCount(value, address) {
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValueError(`Address '${address}' has an invalid count: ${value}`);
  }
  return parsed;
}

function parseAddress(address) {
  const text = String(address || "").trim();
  let core = text;
  let count = 1;
  let hasCount = false;
  const countMatch = /^(.*?),\s*(\d+)$/.exec(text);
  if (countMatch) {
    core = countMatch[1].trim();
    count = parsePositiveCount(countMatch[2], text);
    hasCount = true;
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
    return { base: base.trim(), dtype: requireDtype(canonicalDtype), bitIndex: null, count, hasCount, explicitDtype: true };
  }
  if (core.includes(".")) {
    const parts = core.split(".");
    if (parts.length !== 2) {
      throw new ValueError(`Address '${address}' has more than one bit-index separator '.'.`);
    }
    const [base, bitText] = parts;
    if (/^[0-9A-F]$/i.test(bitText.trim())) {
      const parsed = Number.parseInt(bitText, 16);
      return { base: base.trim(), dtype: "BIT_IN_WORD", bitIndex: parsed, count, hasCount, explicitDtype: false };
    }
    throw new ValueError(`Address '${address}' has an invalid bit-in-word index.`);
  }
  throw new ValueError(`Address '${address}' requires an explicit dtype such as ':U', ':D', or ':BIT'.`);
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
  const explicitOptions = requireStandalonePlcProfileOptions(options, "formatParsedAddress");
  const device = parseDevice(parsed.base, explicitOptions);
  const base = deviceToString(device, explicitOptions);
  if (parsed.bitIndex != null) {
    if (parsed.hasCount) {
      throw new ValueError("bit-in-word addresses do not support ',count'.");
    }
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
  if (parsed.hasCount) {
    text += `,${parsePositiveCount(parsed.count, base)}`;
  }
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

function validateParsedEntry(address, device, dtype, parsed) {
  const info = DEVICE_CODES[device.code];
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
  if (parsed.bitIndex == null && info && info.unit === DeviceUnit.BIT && dtype !== "BIT") {
    throw new ValueError(`Address '${address}' is a bit device. Use ':BIT'.`);
  }
  if (dtype === "BIT" && (!info || info.unit !== DeviceUnit.BIT)) {
    throw new ValueError(`Address '${address}' uses ':BIT', which is only valid for bit devices. Use '.0' through '.F' for bit-in-word access.`);
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

function createReadEntry(address, index, options = {}) {
  const parsed = parseAddress(address);
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
  const parsed = parseAddress(address);
  const device = parseDeviceWithContext(parsed.base, options, options.client);
  const dtype = resolveEntryDtype(parsed);
  validateParsedEntry(address, device, dtype, parsed);
  validateLongTimerEntry(address, device, dtype);
  validateDwordOnlyDtype(device, dtype);
  const info = DEVICE_CODES[device.code];
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
    longTimerRead: getLongTimerReadAccess(device.code),
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
    !entry.hasCount &&
    !isStringDtype(entry.dtype) &&
    isBatchableWordDevice(entry.device)
  );
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

function buildLongTimerClusters(entries) {
  const byBaseCode = new Map();
  for (const entry of entries) {
    const baseCode = entry.longTimerRead.baseCode;
    const list = byBaseCode.get(baseCode) || [];
    list.push(entry);
    byBaseCode.set(baseCode, list);
  }

  const clusters = [];
  for (const [baseCode, list] of byBaseCode.entries()) {
    const sorted = [...list].sort((left, right) => left.device.number - right.device.number || left.index - right.index);
    let current = null;
    for (const entry of sorted) {
      const start = entry.device.number;
      const end = entry.device.number + entry.count;
      if (!current || start > current.end) {
        if (current) {
          clusters.push(current);
        }
        current = { baseCode, start, end, plcProfile: entry.device.plcProfile, entries: [entry] };
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
  const longTimerClusters = buildLongTimerClusters(entries.filter(isLongTimerReadEntry));
  const plainEntries = entries.filter((entry) => !isLongTimerReadEntry(entry));
  const forcedRandomEntries = plainEntries.filter(isForcedRandomDwordReadEntry);
  const plainBitWordEntries = plainEntries.filter(isPlainBitWordReadEntry);
  const clusteredEntries = plainEntries.filter((entry) => !isForcedRandomDwordReadEntry(entry) && !isPlainBitWordReadEntry(entry));
  const bitClusters = buildClusters(clusteredEntries.filter(isDirectBitEntry));
  const wordClusters = buildClusters(clusteredEntries.filter(isWordEntry));
  const randomEntries = [...forcedRandomEntries, ...plainBitWordEntries];
  const blockWordClusters = [];

  for (const cluster of wordClusters) {
    if (cluster.entries.length === 1 && isRandomReadWordEntry(cluster.entries[0])) {
      randomEntries.push(cluster.entries[0]);
    } else {
      blockWordClusters.push(cluster);
    }
  }

  return {
    entries,
    longTimerClusters,
    bitClusters,
    blockWordClusters,
    randomEntries,
  };
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

function decodeStringWords(words, offset, byteLength) {
  const raw = Buffer.alloc(Math.ceil(byteLength / 2) * 2, 0);
  for (let index = 0; index < raw.length; index += 2) {
    raw.writeUInt16LE(Number(words[offset + index / 2]) & 0xffff, index);
  }
  const bytes = raw.subarray(0, byteLength);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

function decodeRepeatedValues(words, offset, entry) {
  const values = [];
  const stride = getScalarSpanLength(entry.dtype);
  for (let index = 0; index < entry.count; index += 1) {
    const itemOffset = offset + index * stride;
    if (isDwordDtype(entry.dtype)) {
      values.push(decodeDwordWords(words, itemOffset, entry.dtype));
    } else {
      values.push(decodeWordValue(words[itemOffset], entry.dtype));
    }
  }
  return values;
}

function decodeBlockWordEntry(words, clusterStart, entry) {
  const offset = entry.device.number - clusterStart;
  if (entry.dtype === "BIT_IN_WORD") {
    return Boolean((Number(words[offset]) >> requireBitInWordIndex(entry.address, entry.bitIndex)) & 0x1);
  }
  if (isStringDtype(entry.dtype)) {
    return decodeStringWords(words, offset, entry.count);
  }
  if (entry.hasCount) {
    return decodeRepeatedValues(words, offset, entry);
  }
  if (isDwordDtype(entry.dtype)) {
    return decodeDwordWords(words, offset, entry.dtype);
  }
  return decodeWordValue(words[offset], entry.dtype);
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
  const response = await client.readRandom({ wordDevices: words, dwordDevices: dwords, ...options });
  Object.assign(wordValues, response.word);
  Object.assign(dwordValues, response.dword);
  return { wordValues, dwordValues };
}

async function readRandomDwordScalar(client, device, dtype, options = {}) {
  const result = await client.readRandom({ wordDevices: [], dwordDevices: [device], ...options });
  const key = deviceToStringWithContext(device, options, client);
  return decodeDwordValue(result.dword[key], dtype);
}

async function executeRandomReadEntries(client, entries, result, options = {}) {
  const wordDevices = [];
  const dwordDevices = [];
  const seenWords = new Set();
  const seenDwords = new Set();

  for (const entry of entries) {
    const key = deviceToStringWithContext(entry.device, options, client);
    if (isDwordDtype(entry.dtype)) {
      if (!seenDwords.has(key)) {
        seenDwords.add(key);
        dwordDevices.push(entry.device);
      }
      continue;
    }
    if (!seenWords.has(key)) {
      seenWords.add(key);
      wordDevices.push(entry.device);
    }
  }

  const { wordValues, dwordValues } = await readRandomMaps(client, { wordDevices, dwordDevices }, options);
  for (const entry of entries) {
    const key = deviceToStringWithContext(entry.device, options, client);
    if (isDwordDtype(entry.dtype)) {
      result[entry.address] = decodeDwordValue(dwordValues[key], entry.dtype);
      continue;
    }
    if (entry.dtype === "BIT_IN_WORD") {
      const word = wordValues[key];
      result[entry.address] = Boolean((word >> requireBitInWordIndex(entry.address, entry.bitIndex)) & 0x1);
      continue;
    }
    result[entry.address] = decodeWordValue(wordValues[key], entry.dtype);
  }
}

async function executeBitReadCluster(client, cluster, result, options = {}) {
  const values = await client.readDevices(makeDeviceRef(cluster.code, cluster.start, cluster.plcProfile), cluster.end - cluster.start, {
    ...options,
    bitUnit: true,
  });
  for (const entry of cluster.entries) {
    const offset = entry.device.number - cluster.start;
    if (entry.hasCount) {
      result[entry.address] = values.slice(offset, offset + entry.count).map((value) => Boolean(value));
      continue;
    }
    result[entry.address] = Boolean(values[offset]);
  }
}

async function executeWordReadCluster(client, cluster, result, options = {}) {
  const words = await client.readDevices(makeDeviceRef(cluster.code, cluster.start, cluster.plcProfile), cluster.end - cluster.start, {
    ...options,
    bitUnit: false,
  });
  for (const entry of cluster.entries) {
    result[entry.address] = decodeBlockWordEntry(words, cluster.start, entry);
  }
}

async function executeLongTimerReadCluster(client, cluster, result, options = {}) {
  const pointCount = cluster.end - cluster.start;
  const words = await client.readDevices(makeDeviceRef(cluster.baseCode, cluster.start, cluster.plcProfile), pointCount * 4, {
    ...options,
    bitUnit: false,
  });
  for (const entry of cluster.entries) {
    result[entry.address] = decodeLongTimerEntry(words, cluster.start, entry);
  }
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
  return limit && Number.isInteger(limit.max) ? limit.max : fallback;
}

function randomReadMaximum(client) {
  const fallback = client?.plcSeries === PLCSeries.IQR || client?.plcProfile === "melsec:iq-r"
    ? 96
    : 192;
  return effectiveProfileMaximum(client, "random_read_word", fallback);
}

function splitClusterAtEntryBoundaries(cluster, maximumSpan, spanStart, spanEnd, label) {
  const entries = [...cluster.entries].sort((left, right) => left.index - right.index);
  const result = [];
  let current = null;
  for (const entry of entries) {
    const start = spanStart(entry);
    const end = spanEnd(entry);
    if (end - start > maximumSpan) {
      throw new ValueError(
        `${label} logical entry '${entry.address}' cannot fit one request: required=${end - start}, maximum=${maximumSpan}`
      );
    }
    if (!current || Math.max(current.end, end) - Math.min(current.start, start) > maximumSpan) {
      if (current) result.push(current);
      current = {
        ...cluster,
        start,
        end,
        entries: [entry],
      };
      continue;
    }
    current.start = Math.min(current.start, start);
    current.end = Math.max(current.end, end);
    current.entries.push(entry);
  }
  if (current) result.push(current);
  return result;
}

function splitClusterAtDeclaredOrderGaps(cluster, spanStart, spanEnd) {
  const entries = [...cluster.entries].sort((left, right) => left.index - right.index);
  const result = [];
  let current = null;
  for (const entry of entries) {
    const start = spanStart(entry);
    const end = spanEnd(entry);
    const previous = current?.entries[current.entries.length - 1];
    if (!current || entry.index !== previous.index + 1) {
      if (current) result.push(current);
      current = { ...cluster, start, end, entries: [entry] };
      continue;
    }
    current.start = Math.min(current.start, start);
    current.end = Math.max(current.end, end);
    current.entries.push(entry);
  }
  if (current) result.push(current);
  return result;
}

function splitEntriesAtDeclaredOrderGaps(entries) {
  const result = [];
  let current = [];
  for (const entry of [...entries].sort((left, right) => left.index - right.index)) {
    const previous = current[current.length - 1];
    if (previous && entry.index !== previous.index + 1) {
      result.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) result.push(current);
  return result;
}

function randomEntryKey(entry, options, client) {
  return `${isDwordDtype(entry.dtype) ? "d" : "w"}:${deviceToStringWithContext(entry.device, options, client)}`;
}

function chunkRandomReadEntries(entries, maximum, options, client) {
  const chunks = [];
  let current = [];
  let keys = new Set();
  for (const entry of [...entries].sort((left, right) => left.index - right.index)) {
    const key = randomEntryKey(entry, options, client);
    if (!keys.has(key) && keys.size >= maximum) {
      chunks.push(current);
      current = [];
      keys = new Set();
    }
    current.push(entry);
    keys.add(key);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function compileReadOperations(client, plan, options) {
  const randomMaximum = randomReadMaximum(client);
  const directWordMaximum = effectiveProfileMaximum(client, "direct_word_read", 960);
  const directBitMaximum = effectiveProfileMaximum(client, "direct_bit_read", 7168);
  const longTimerMaximum = Math.floor(directWordMaximum / 4);
  const operations = [];

  if (plan.randomEntries.length > 0) {
    if (typeof client?._ensureProfileFeatureAllowed === "function") {
      client._ensureProfileFeatureAllowed("random");
    }
    for (const run of splitEntriesAtDeclaredOrderGaps(plan.randomEntries)) {
      for (const entries of chunkRandomReadEntries(run, randomMaximum, options, client)) {
        operations.push({
          index: Math.min(...entries.map((entry) => entry.index)),
          execute: (result) => executeRandomReadEntries(client, entries, result, options),
        });
      }
    }
  }

  const hasDirectOperations = plan.longTimerClusters.length > 0
    || plan.bitClusters.length > 0
    || plan.blockWordClusters.length > 0;
  if (hasDirectOperations && typeof client?._ensureProfileFeatureAllowed === "function") {
    client._ensureProfileFeatureAllowed("direct");
  }

  for (const cluster of plan.longTimerClusters) {
    for (const run of splitClusterAtDeclaredOrderGaps(
      cluster,
      (entry) => entry.device.number,
      (entry) => entry.device.number + entry.count,
    )) {
      for (const part of splitClusterAtEntryBoundaries(
        run,
        longTimerMaximum,
        (entry) => entry.device.number,
        (entry) => entry.device.number + entry.count,
        "readNamed long-timer read",
      )) {
        operations.push({
          index: Math.min(...part.entries.map((entry) => entry.index)),
          execute: (result) => executeLongTimerReadCluster(client, part, result, options),
        });
      }
    }
  }

  for (const cluster of plan.bitClusters) {
    for (const run of splitClusterAtDeclaredOrderGaps(
      cluster,
      (entry) => entry.spanStart,
      (entry) => entry.spanStart + entry.spanLength,
    )) {
      for (const part of splitClusterAtEntryBoundaries(
        run,
        directBitMaximum,
        (entry) => entry.spanStart,
        (entry) => entry.spanStart + entry.spanLength,
        "readNamed bit read",
      )) {
        operations.push({
          index: Math.min(...part.entries.map((entry) => entry.index)),
          execute: (result) => executeBitReadCluster(client, part, result, options),
        });
      }
    }
  }

  const wordParts = [];
  for (const cluster of plan.blockWordClusters) {
    for (const run of splitClusterAtDeclaredOrderGaps(
      cluster,
      (entry) => entry.spanStart,
      (entry) => entry.spanStart + entry.spanLength,
    )) {
      wordParts.push(...splitClusterAtEntryBoundaries(
        run,
        directWordMaximum,
        (entry) => entry.spanStart,
        (entry) => entry.spanStart + entry.spanLength,
        "readNamed word read",
      ));
    }
  }

  let blockReadAvailable = wordParts.length > 1 && typeof client?.readBlock === "function";
  if (blockReadAvailable && typeof client?._ensureProfileFeatureAllowed === "function") {
    try {
      client._ensureProfileFeatureAllowed("block");
    } catch (error) {
      if (!(error instanceof SlmpProfileFeatureError) || error.featureKey !== "block") {
        throw error;
      }
      blockReadAvailable = false;
    }
  }
  for (const part of wordParts) {
    operations.push({
      kind: "word",
      cluster: part,
      index: Math.min(...part.entries.map((entry) => entry.index)),
    });
  }

  const ordered = operations.sort((left, right) => left.index - right.index);
  const result = [];
  const blockMaximum = client?.plcSeries === PLCSeries.IQR ? 60 : 120;
  for (let index = 0; index < ordered.length;) {
    const operation = ordered[index];
    if (operation.kind !== "word") {
      result.push(operation);
      index += 1;
      continue;
    }
    const batch = [];
    let batchPoints = 0;
    while (index < ordered.length && ordered[index].kind === "word") {
      const candidate = ordered[index].cluster;
      const points = candidate.end - candidate.start;
      if (batch.length > 0 && (batch.length >= blockMaximum || batchPoints + points > 960)) break;
      batch.push(candidate);
      batchPoints += points;
      index += 1;
      if (!blockReadAvailable) break;
    }
    result.push({
      index: Math.min(...batch.flatMap((part) => part.entries.map((entry) => entry.index))),
      execute: batch.length > 1
        ? (readResult) => executeWordReadClusters(client, batch, readResult, options)
        : (readResult) => executeWordReadCluster(client, batch[0], readResult, options),
    });
  }
  return result;
}

async function readNamed(client, addresses, options = {}) {
  const list = normalizeAddressList(addresses);
  const requestOptions = snapshotAggregateOptions(options);
  const plan = compileReadPlan(list, { ...requestOptions, client });
  const result = Object.fromEntries(plan.entries.map((entry) => [entry.address, undefined]));
  const operations = compileReadOperations(client, plan, requestOptions);
  const execute = async () => {
    for (const operation of operations) {
      await operation.execute(result);
    }
    return result;
  };
  return typeof client?._runExclusive === "function"
    ? client._runExclusive(execute)
    : execute();
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

  const weighted = wordValues.length * RANDOM_WRITE_WORD_WEIGHT + dwordValues.length * RANDOM_WRITE_DWORD_WEIGHT;
  if (weighted > RANDOM_WRITE_WEIGHT_LIMIT) {
    throw new ValueError(
      `writeNamed random word/dword values must fit one request: word=${wordValues.length}, dword=${dwordValues.length}, weighted=${weighted}, limit=${RANDOM_WRITE_WEIGHT_LIMIT}`
    );
  }
  await client.writeRandomWords({ wordValues, dwordValues, ...options });
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

  const weighted = dwordValues.length * RANDOM_WRITE_DWORD_WEIGHT;
  if (weighted > RANDOM_WRITE_WEIGHT_LIMIT) {
    throw new ValueError(
      `writeNamed long-current values must fit one request: dword=${dwordValues.length}, weighted=${weighted}, limit=${RANDOM_WRITE_WEIGHT_LIMIT}`
    );
  }
  await client.writeRandomWords({ wordValues: [], dwordValues, ...options });
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

  if (bitValues.length > RANDOM_WRITE_BIT_BATCH_LIMIT) {
    throw new ValueError(
      `writeNamed random bit values must fit one request (1..${RANDOM_WRITE_BIT_BATCH_LIMIT}): ${bitValues.length}`
    );
  }
  await client.writeRandomBits({ bitValues, ...options });
}

async function writeNamed(client, updates, options = {}) {
  const entries = Object.entries(updates || {}).map(([address, value], index) =>
    createWriteEntry(address, value, index, { ...options, client })
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
    await executeLongCurrentWrites(client, forcedDwordRandomEntries, options);
  } else if (longStateRandomBitEntries.length > 0) {
    await executeRandomBitWrites(client, longStateRandomBitEntries, options);
  } else if (randomEntries.length > 0) {
    await executeRandomWrites(client, randomEntries, options);
  } else if (bitClusters.length === 1) {
    await executeBitWriteCluster(client, bitClusters[0], options);
  } else {
    await executeWordWriteClusters(client, blockWordClusters, options);
  }
}

async function executeWordReadClusters(client, clusters, result, options = {}) {
  if (clusters.length === 1) {
    await executeWordReadCluster(client, clusters[0], result, options);
    return;
  }
  const response = await client.readBlock({
    ...options,
    wordBlocks: clusters.map((cluster) => [
      makeDeviceRef(cluster.code, cluster.start, cluster.plcProfile),
      cluster.end - cluster.start,
    ]),
  });
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index];
    const words = response.wordBlocks[index].values;
    for (const entry of cluster.entries) {
      result[entry.address] = decodeBlockWordEntry(words, cluster.start, entry);
    }
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
  readBits,
  readNamed,
  readTyped,
  writeBitInWord,
  writeBits,
  writeNamed,
  writeTyped,
};
