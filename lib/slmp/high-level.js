"use strict";

const { DEVICE_CODES, DeviceUnit } = require("./constants");
const { ValueError, deviceToString, parseDevice, requireExplicitDeviceFamilyForXY } = require("./core");

const WORD_DTYPES = new Set(["U", "S"]);
const DWORD_DTYPES = new Set(["D", "L", "F"]);
const STRING_DTYPES = new Set(["STR", "STRING"]);
const UNBATCHED_DEVICE_CODES = new Set(["G", "HG"]);
const DEFAULT_DWORD_DEVICE_CODES = new Set(["LTN", "LSTN", "LCN", "LZ"]);
const LEGACY_STRING_DEVICE_CODES = Object.keys(DEVICE_CODES).sort((left, right) => right.length - left.length);
const ADDRESS_LIST_TOKEN_RE = /[A-Z][A-Z0-9]*(?:\.[0-9A-F]+|:[A-Z]+)?(?:,\d+)?/iy;
const LONG_TIMER_READ_FAMILIES = Object.freeze({
  LTN: { baseCode: "LTN", role: "current" },
  LTS: { baseCode: "LTN", role: "contact" },
  LTC: { baseCode: "LTN", role: "coil" },
  LSTN: { baseCode: "LSTN", role: "current" },
  LSTS: { baseCode: "LSTN", role: "contact" },
  LSTC: { baseCode: "LSTN", role: "coil" },
  LCN: { baseCode: "LCN", role: "current" },
  LCS: { baseCode: "LCN", role: "contact" },
  LCC: { baseCode: "LCN", role: "coil" },
});
const LONG_STATE_RANDOM_BIT_CODES = new Set(["LTC", "LTS", "LSTC", "LSTS", "LCS", "LCC"]);

async function readTyped(client, device, dtype, options = {}) {
  const key = canonicalizeDtype(dtype || "U");
  if (isStringDtype(key)) {
    throw new ValueError("String reads require readNamed with '<device>:STR,<length>' or '<device>STR<number>,<length>'.");
  }
  const resolvedDevice = typeof device === "string" ? parseDeviceWithContext(device, options, client) : device;
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
  const key = canonicalizeDtype(dtype || "U");
  if (isStringDtype(key)) {
    throw new ValueError("String writes require writeNamed with '<device>:STR,<length>' or '<device>STR<number>,<length>'.");
  }
  const resolvedDevice = typeof device === "string" ? parseDeviceWithContext(device, options, client) : device;
  const longTimerRead = getLongTimerReadAccess(resolvedDevice.code);
  if (longTimerRead) {
    validateLongTimerDtype(deviceToStringWithContext(resolvedDevice, options, client), resolvedDevice, key);
  }
  validateDwordOnlyDtype(resolvedDevice, key);
  if (key === "BIT") {
    if (LONG_STATE_RANDOM_BIT_CODES.has(resolvedDevice.code)) {
      await client.writeRandomBits({ bitValues: [[resolvedDevice, Boolean(value)]], ...options });
      return;
    }
    await client.writeDevices(resolvedDevice, [Boolean(value)], { ...options, bitUnit: true });
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
  const values = await client.readDevices(device, count, { ...options, bitUnit: true });
  return values.map((value) => Boolean(value));
}

async function writeBits(client, device, values, options = {}) {
  await client.writeDevices(device, Array.from(values || [], (value) => Boolean(value)), { ...options, bitUnit: true });
}

async function writeBitInWord(client, device, bitIndex, value, options = {}) {
  if (!Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 15) {
    throw new ValueError(`bitIndex must be 0-15, got ${bitIndex}`);
  }
  const words = await client.readDevices(device, 1, { ...options, bitUnit: false });
  let current = Number(words[0]) & 0xffff;
  if (value) {
    current |= 1 << bitIndex;
  } else {
    current &= ~(1 << bitIndex);
  }
  await client.writeDevices(device, [current & 0xffff], { ...options, bitUnit: false });
}

function canonicalizeDtype(dtype) {
  const key = String(dtype || "U").trim().toUpperCase();
  if (key === "STRING") {
    return "STR";
  }
  return key === "I" ? "S" : key;
}

function addressHasExplicitDtype(address) {
  const text = String(address || "").trim();
  const countMatch = /^(.*?),\s*(\d+)$/.exec(text);
  const core = countMatch ? countMatch[1].trim() : text;
  return core.includes(":");
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

function parseLegacyStringAddress(text) {
  const normalized = String(text || "").trim().toUpperCase();
  for (const code of LEGACY_STRING_DEVICE_CODES) {
    const prefix = `${code}STR`;
    if (!normalized.startsWith(prefix)) {
      continue;
    }
    const match = /^([0-9A-F]+)\s*,\s*(\d+)$/.exec(normalized.slice(prefix.length));
    if (!match) {
      continue;
    }
    return {
      base: `${code}${match[1]}`,
      dtype: "STR",
      bitIndex: null,
      count: parsePositiveCount(match[2], text),
      hasCount: true,
      explicitDtype: true,
    };
  }
  return null;
}

function parseAddress(address) {
  const text = String(address || "").trim();
  const legacyString = parseLegacyStringAddress(text);
  if (legacyString) {
    return legacyString;
  }

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
    const [base, dtype] = core.split(":", 2);
    return { base: base.trim(), dtype: canonicalizeDtype(dtype), bitIndex: null, count, hasCount, explicitDtype: true };
  }
  if (core.includes(".")) {
    const [base, bitText] = core.split(".", 2);
    const parsed = Number.parseInt(bitText, 16);
    if (!Number.isNaN(parsed)) {
      return { base: base.trim(), dtype: "BIT_IN_WORD", bitIndex: parsed, count, hasCount, explicitDtype: false };
    }
  }
  return { base: core, dtype: "U", bitIndex: null, count, hasCount, explicitDtype: false };
}

function formatParsedAddress(parsed, options = {}) {
  if (!parsed || typeof parsed !== "object") {
    throw new ValueError("parsed address must be an object");
  }
  const client = options.client || null;
  const device = parseDeviceWithContext(parsed.base, options, client);
  const base = deviceToStringWithContext(device, options, client);
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
  const dtype = canonicalizeDtype(parsed.dtype || "U");
  if (parsed.explicitDtype) {
    text += `:${dtype}`;
  }
  if (parsed.hasCount) {
    text += `,${parsePositiveCount(parsed.count, base)}`;
  }
  return text;
}

function normalizeAddress(address, options = {}) {
  return formatParsedAddress(parseAddress(address), options);
}

function normalizeDtypeForDevice(device, dtype) {
  const info = DEVICE_CODES[device.code];
  const key = canonicalizeDtype(dtype);
  if (info && info.unit === DeviceUnit.BIT && key === "U") {
    return "BIT";
  }
  return key;
}

function resolveEntryDtype(address, device, parsed) {
  const normalized = normalizeDtypeForDevice(device, parsed.dtype || "U");
  if (!addressHasExplicitDtype(address) && parsed.bitIndex == null && DEFAULT_DWORD_DEVICE_CODES.has(device.code)) {
    return "D";
  }
  return normalized;
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

function validateStringTarget(address, device) {
  const info = DEVICE_CODES[device.code];
  if (!info || info.unit !== DeviceUnit.WORD) {
    throw new ValueError(`Address '${address}' uses string notation, which is only valid for word devices.`);
  }
}

function validateParsedEntry(address, device, dtype, parsed) {
  if (dtype === "BIT_IN_WORD") {
    validateBitInWordTarget(address, device);
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
      throw new ValueError(`Address '${address}' uses a 32-bit long current value. Use the default form or ':D' / ':L'.`);
    }
    return;
  }
  if (dtype !== "BIT") {
    throw new ValueError(`Address '${address}' is a long timer state device. Use the plain device form without a dtype override.`);
  }
}

function validateDwordOnlyDtype(device, dtype) {
  if (device.code !== "LZ") {
    return;
  }
  if (dtype !== "D" && dtype !== "L") {
    throw new ValueError(`Address '${device.code}${device.number}' uses a 32-bit device. Use the default form or ':D' / ':L'.`);
  }
}

function isBatchableWordDevice(device) {
  const info = DEVICE_CODES[device.code];
  return Boolean(info && info.unit === DeviceUnit.WORD && !UNBATCHED_DEVICE_CODES.has(device.code));
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
  const device = parseDeviceWithContext(parsed.base, options, options.client);
  const dtype = resolveEntryDtype(address, device, parsed);
  validateParsedEntry(address, device, dtype, parsed);
  validateLongTimerEntry(address, device, dtype);
  validateDwordOnlyDtype(device, dtype);
  const info = DEVICE_CODES[device.code];
  return {
    address,
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

function createWriteEntry(address, value, index, options = {}) {
  const parsed = parseAddress(address);
  const device = parseDeviceWithContext(parsed.base, options, options.client);
  const dtype = resolveEntryDtype(address, device, parsed);
  validateParsedEntry(address, device, dtype, parsed);
  validateLongTimerEntry(address, device, dtype);
  validateDwordOnlyDtype(device, dtype);
  const info = DEVICE_CODES[device.code];
  return {
    address,
    value,
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

function isLongTimerReadEntry(entry) {
  return Boolean(entry.longTimerRead && entry.longTimerRead.baseCode !== "LCN");
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
  return DEFAULT_DWORD_DEVICE_CODES.has(code);
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
        current = { code, start, end, entries: [entry] };
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
        current = { baseCode, start, end, entries: [entry] };
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
  const clusteredEntries = plainEntries.filter((entry) => !isForcedRandomDwordReadEntry(entry));
  const bitClusters = buildClusters(clusteredEntries.filter(isDirectBitEntry));
  const wordClusters = buildClusters(clusteredEntries.filter(isWordEntry));
  const randomEntries = [...forcedRandomEntries];
  const blockWordClusters = [];

  for (const cluster of wordClusters) {
    if (cluster.entries.length === 1 && isRandomWordEntry(cluster.entries[0])) {
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
    return Boolean((Number(words[offset]) >> (entry.bitIndex || 0)) & 0x1);
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
  const words = await client.readDevices(makeDeviceRef(longTimerRead.baseCode, device.number), 4, {
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
  const key = canonicalizeDtype(dtype || "U");
  if (isStringDtype(key)) {
    throw new ValueError("String values require a length-qualified address such as 'D100:STR,10'.");
  }
  if (key === "F" || key === "L" || key === "D") {
    const raw = Buffer.alloc(4);
    if (key === "F") {
      raw.writeFloatLE(Number(value), 0);
    } else if (key === "L") {
      raw.writeInt32LE(Number(value), 0);
    } else {
      raw.writeUInt32LE(Number(value) >>> 0, 0);
    }
    return [raw.readUInt16LE(0), raw.readUInt16LE(2)];
  }
  if (key === "S") {
    const raw = Buffer.alloc(2);
    raw.writeInt16LE(Number(value), 0);
    return [raw.readUInt16LE(0)];
  }
  return [Number(value) & 0xffff];
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

function makeDeviceRef(code, number) {
  return { code, number };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function readRandomMaps(client, plan, options = {}) {
  const wordValues = {};
  const dwordValues = {};
  const wordChunks = chunkArray(plan.wordDevices || [], 0xff);
  const dwordChunks = chunkArray(plan.dwordDevices || [], 0xff);
  const chunkCount = Math.max(wordChunks.length, dwordChunks.length);
  const tasks = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const wordChunk = wordChunks[index] || [];
    const dwordChunk = dwordChunks[index] || [];
    if (wordChunk.length === 0 && dwordChunk.length === 0) {
      continue;
    }
    tasks.push(
      client.readRandom({ wordDevices: wordChunk, dwordDevices: dwordChunk, ...options }).then((result) => {
        Object.assign(wordValues, result.word);
        Object.assign(dwordValues, result.dword);
      })
    );
  }

  await Promise.all(tasks);
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
      result[entry.address] = Boolean((word >> (entry.bitIndex || 0)) & 0x1);
      continue;
    }
    result[entry.address] = decodeWordValue(wordValues[key], entry.dtype);
  }
}

async function executeBitReadCluster(client, cluster, result, options = {}) {
  const values = await client.readDevices(makeDeviceRef(cluster.code, cluster.start), cluster.end - cluster.start, {
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
  const words = await client.readDevices(makeDeviceRef(cluster.code, cluster.start), cluster.end - cluster.start, {
    ...options,
    bitUnit: false,
  });
  for (const entry of cluster.entries) {
    result[entry.address] = decodeBlockWordEntry(words, cluster.start, entry);
  }
}

async function executeLongTimerReadCluster(client, cluster, result, options = {}) {
  const pointCount = cluster.end - cluster.start;
  const words = await client.readDevices(makeDeviceRef(cluster.baseCode, cluster.start), pointCount * 4, {
    ...options,
    bitUnit: false,
  });
  for (const entry of cluster.entries) {
    result[entry.address] = decodeLongTimerEntry(words, cluster.start, entry);
  }
}

async function readNamed(client, addresses, options = {}) {
  const list = normalizeAddressList(addresses);
  const plan = compileReadPlan(list, { ...options, client });
  const result = Object.fromEntries(plan.entries.map((entry) => [entry.address, undefined]));
  const tasks = [];

  if (plan.randomEntries.length > 0) {
    tasks.push(executeRandomReadEntries(client, plan.randomEntries, result, options));
  }
  tasks.push(...plan.longTimerClusters.map((cluster) => executeLongTimerReadCluster(client, cluster, result, options)));
  tasks.push(...plan.bitClusters.map((cluster) => executeBitReadCluster(client, cluster, result, options)));
  tasks.push(...plan.blockWordClusters.map((cluster) => executeWordReadCluster(client, cluster, result, options)));

  await Promise.all(tasks);
  return result;
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

  const wordChunks = chunkArray(wordValues, 0xff);
  const dwordChunks = chunkArray(dwordValues, 0xff);
  const chunkCount = Math.max(wordChunks.length, dwordChunks.length);
  const tasks = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const wordChunk = wordChunks[index] || [];
    const dwordChunk = dwordChunks[index] || [];
    if (wordChunk.length === 0 && dwordChunk.length === 0) {
      continue;
    }
    tasks.push(client.writeRandomWords({ wordValues: wordChunk, dwordValues: dwordChunk, ...options }));
  }

  await Promise.all(tasks);
}

function normalizeBitEntryValues(entry) {
  if (!entry.hasCount) {
    return [Boolean(entry.value)];
  }
  return normalizeArrayValue(entry).map((value) => Boolean(value));
}

async function executeBitWriteCluster(client, cluster, options = {}) {
  const values = new Array(cluster.end - cluster.start).fill(false);
  const entries = [...cluster.entries].sort((left, right) => left.index - right.index);
  for (const entry of entries) {
    const offset = entry.device.number - cluster.start;
    const entryValues = normalizeBitEntryValues(entry);
    for (let index = 0; index < entryValues.length; index += 1) {
      values[offset + index] = entryValues[index];
    }
  }
  await client.writeDevices(makeDeviceRef(cluster.code, cluster.start), values, { ...options, bitUnit: true });
}

async function executeWordWriteCluster(client, cluster, options = {}) {
  const entries = [...cluster.entries].sort((left, right) => left.index - right.index);
  const wordCount = cluster.end - cluster.start;
  const needsRead = entries.some((entry) => entry.dtype === "BIT_IN_WORD");
  const words = needsRead
    ? Array.from(
        await client.readDevices(makeDeviceRef(cluster.code, cluster.start), wordCount, { ...options, bitUnit: false })
      )
    : new Array(wordCount).fill(0);

  for (const entry of entries) {
    const offset = entry.device.number - cluster.start;
    if (entry.dtype === "BIT_IN_WORD") {
      let current = Number(words[offset]) & 0xffff;
      if (entry.value) {
        current |= 1 << (entry.bitIndex || 0);
      } else {
        current &= ~(1 << (entry.bitIndex || 0));
      }
      words[offset] = current;
      continue;
    }

    const encoded = encodeEntryWords(entry);
    for (let index = 0; index < encoded.length; index += 1) {
      words[offset + index] = encoded[index];
    }
  }

  await client.writeDevices(makeDeviceRef(cluster.code, cluster.start), words, { ...options, bitUnit: false });
}

async function executeLongCurrentWrites(client, entries, options = {}) {
  const dwordValues = [];
  for (const entry of entries) {
    const values = entry.hasCount ? normalizeArrayValue(entry) : [entry.value];
    for (let index = 0; index < values.length; index += 1) {
      dwordValues.push([
        makeDeviceRef(entry.device.code, entry.device.number + index),
        encodeRandomWriteValue(entry.dtype, values[index]),
      ]);
    }
  }

  for (const chunk of chunkArray(dwordValues, 0xff)) {
    if (chunk.length === 0) {
      continue;
    }
    await client.writeRandomWords({ wordValues: [], dwordValues: chunk, ...options });
  }
}

async function executeRandomBitWrites(client, entries, options = {}) {
  const bitValues = [];
  for (const entry of entries) {
    const values = entry.hasCount ? normalizeArrayValue(entry).map((value) => Boolean(value)) : [Boolean(entry.value)];
    for (let index = 0; index < values.length; index += 1) {
      bitValues.push([makeDeviceRef(entry.device.code, entry.device.number + index), values[index]]);
    }
  }

  for (const chunk of chunkArray(bitValues, 0xff)) {
    if (chunk.length === 0) {
      continue;
    }
    await client.writeRandomBits({ bitValues: chunk, ...options });
  }
}

async function writeNamed(client, updates, options = {}) {
  const entries = Object.entries(updates || {}).map(([address, value], index) =>
    createWriteEntry(address, value, index, { ...options, client })
  );
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

  const tasks = [];
  if (forcedDwordRandomEntries.length > 0) {
    tasks.push(executeLongCurrentWrites(client, forcedDwordRandomEntries, options));
  }
  if (longStateRandomBitEntries.length > 0) {
    tasks.push(executeRandomBitWrites(client, longStateRandomBitEntries, options));
  }
  if (randomEntries.length > 0) {
    tasks.push(executeRandomWrites(client, randomEntries, options));
  }
  tasks.push(...bitClusters.map((cluster) => executeBitWriteCluster(client, cluster, options)));
  tasks.push(...blockWordClusters.map((cluster) => executeWordWriteCluster(client, cluster, options)));

  await Promise.all(tasks);
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

function resolveDeviceFamily(options = {}, client = null) {
  if (options.family != null) {
    return options.family;
  }
  if (options.plcFamily != null) {
    return options.plcFamily;
  }
  if (client && client.deviceFamily != null) {
    return client.deviceFamily;
  }
  return null;
}

function resolveExplicitPlcFamily(options = {}, client = null) {
  if (options.plcFamily != null) {
    return options.plcFamily;
  }
  if (client && client.plcFamily != null) {
    return client.plcFamily;
  }
  return resolveDeviceFamily(options, client);
}

function parseDeviceWithContext(device, options = {}, client = null) {
  const family = resolveDeviceFamily(options, client);
  const plcFamily = resolveExplicitPlcFamily(options, client);
  const ref = parseDevice(device, { family, plcFamily });
  return requireExplicitDeviceFamilyForXY(device, plcFamily, ref);
}

function deviceToStringWithContext(device, options = {}, client = null) {
  return deviceToString(device, { family: resolveDeviceFamily(options, client) });
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
