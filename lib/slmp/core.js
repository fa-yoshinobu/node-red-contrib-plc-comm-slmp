"use strict";

const {
  DEVICE_CODES,
  FRAME_3E_REQUEST_SUBHEADER,
  FRAME_3E_RESPONSE_SUBHEADER,
  FRAME_4E_REQUEST_SUBHEADER,
  FRAME_4E_RESPONSE_SUBHEADER,
  FrameType,
  ModuleIONo,
  PLCSeries,
  SUBCOMMAND_DEVICE_BIT_IQR,
  SUBCOMMAND_DEVICE_BIT_IQR_EXT,
  SUBCOMMAND_DEVICE_BIT_QL,
  SUBCOMMAND_DEVICE_BIT_QL_EXT,
  SUBCOMMAND_DEVICE_WORD_IQR,
  SUBCOMMAND_DEVICE_WORD_IQR_EXT,
  SUBCOMMAND_DEVICE_WORD_QL,
  SUBCOMMAND_DEVICE_WORD_QL_EXT,
} = require("./constants");
const { SlmpError } = require("./errors");

const IQF_OCTAL_DEVICE_CODES = new Set(["X", "Y"]);
const PLC_FAMILIES = new Set(["iq-f", "iq-r", "iq-l", "mx-f", "mx-r", "qcpu", "lcpu", "qnu", "qnudv"]);
const PLC_FAMILY_DEFAULTS = Object.freeze({
  "iq-f": Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, deviceFamily: "iq-f", rangeFamily: "iq-f" }),
  "iq-r": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, deviceFamily: "iq-r", rangeFamily: "iq-r" }),
  "iq-l": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, deviceFamily: "iq-r", rangeFamily: "iq-r" }),
  "mx-f": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, deviceFamily: "mx-f", rangeFamily: "mx-f" }),
  "mx-r": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, deviceFamily: "mx-r", rangeFamily: "mx-r" }),
  qcpu: Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, deviceFamily: "qcpu", rangeFamily: "qcpu" }),
  lcpu: Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, deviceFamily: "lcpu", rangeFamily: "lcpu" }),
  qnu: Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, deviceFamily: "qnu", rangeFamily: "qnu" }),
  qnudv: Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, deviceFamily: "qnudv", rangeFamily: "qnudv" }),
});

function normalizeFrameType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === FrameType.FRAME_3E || normalized === FrameType.FRAME_4E) {
    return normalized;
  }
  throw new ValueError(`Unsupported frame type: ${value}`);
}

function normalizePlcSeries(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === PLCSeries.QL || normalized === PLCSeries.IQR) {
    return normalized;
  }
  throw new ValueError(`Unsupported PLC series: ${value}`);
}

function normalizePlcFamily(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (PLC_FAMILIES.has(normalized)) {
    return normalized;
  }
  throw new ValueError(`Unsupported plcFamily: ${value}`);
}

function resolveConnectionProfile({ plcFamily, plcSeries, frameType } = {}) {
  const normalizedFamily = normalizePlcFamily(plcFamily);
  if (normalizedFamily) {
    if (plcSeries !== undefined || frameType !== undefined) {
      throw new ValueError(
        "plcFamily already determines frameType, plcSeries, and address/range handling. Do not also pass plcSeries or frameType."
      );
    }
    return {
      plcFamily: normalizedFamily,
      plcSeries: PLC_FAMILY_DEFAULTS[normalizedFamily].plcSeries,
      frameType: PLC_FAMILY_DEFAULTS[normalizedFamily].frameType,
      deviceFamily: PLC_FAMILY_DEFAULTS[normalizedFamily].deviceFamily,
      rangeFamily: PLC_FAMILY_DEFAULTS[normalizedFamily].rangeFamily,
    };
  }
  return {
    plcFamily: null,
    plcSeries: plcSeries === undefined ? PLCSeries.QL : normalizePlcSeries(plcSeries),
    frameType: frameType === undefined ? FrameType.FRAME_4E : normalizeFrameType(frameType),
    deviceFamily: null,
    rangeFamily: null,
  };
}

function normalizeTransport(value) {
  const normalized = String(value || "tcp").trim().toLowerCase();
  if (normalized === "tcp" || normalized === "udp") {
    return normalized;
  }
  throw new ValueError(`Unsupported transport: ${value}`);
}

function parseNumber(value, name, options = {}) {
  const { defaultValue, base = 10 } = options;
  if (value === undefined || value === null || value === "") {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new ValueError(`${name} is required`);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValueError(`${name} must be finite`);
    }
    return Math.trunc(value);
  }

  const text = String(value).trim();
  if (!text) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new ValueError(`${name} is required`);
  }

  let radix = base;
  let normalized = text;
  if (/^0x/i.test(text)) {
    radix = 16;
    normalized = text.slice(2);
  } else if (/[a-f]/i.test(text)) {
    radix = 16;
  }

  const parsed = Number.parseInt(normalized, radix);
  if (!Number.isFinite(parsed)) {
    throw new ValueError(`${name} must be numeric: ${value}`);
  }
  return parsed;
}

function ensureRange(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValueError(`${name} out of range (${min}..${max}): ${value}`);
  }
  return value;
}

function normalizeTarget(target = {}) {
  const moduleIOSource = target.moduleIO ?? target.module_io ?? ModuleIONo.OWN_STATION;
  return {
    network: ensureRange(parseNumber(target.network, "target.network", { defaultValue: 0x00 }), 0, 0xff, "target.network"),
    station: ensureRange(parseNumber(target.station, "target.station", { defaultValue: 0xff }), 0, 0xff, "target.station"),
    moduleIO: ensureRange(
      parseNumber(moduleIOSource, "target.moduleIO", { defaultValue: ModuleIONo.OWN_STATION, base: 16 }),
      0,
      0xffff,
      "target.moduleIO"
    ),
    multidrop: ensureRange(parseNumber(target.multidrop, "target.multidrop", { defaultValue: 0x00 }), 0, 0xff, "target.multidrop"),
  };
}

function resolveDeviceRadix(code, family) {
  const normalizedFamily = normalizePlcFamily(family);
  if (normalizedFamily && PLC_FAMILY_DEFAULTS[normalizedFamily].deviceFamily === "iq-f" && IQF_OCTAL_DEVICE_CODES.has(code)) {
    return 8;
  }
  return DEVICE_CODES[code].radix;
}

function parseDeviceNumber(text, radix) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return Number.NaN;
  }
  const patterns = {
    8: /^[0-7]+$/,
    10: /^\d+$/,
    16: /^[0-9A-F]+$/i,
  };
  const pattern = patterns[radix];
  if (!pattern || !pattern.test(normalized)) {
    return Number.NaN;
  }
  return Number.parseInt(normalized, radix);
}

function parseDevice(value, options = {}) {
  if (value && typeof value === "object" && typeof value.code === "string" && Number.isInteger(value.number)) {
    return { code: value.code.toUpperCase(), number: value.number };
  }

  const text = String(value || "").trim().toUpperCase();
  const match = /^([A-Z]+)([0-9A-F]+)$/.exec(text);
  if (!match) {
    throw new ValueError(
      `Invalid SLMP device string ${JSON.stringify(value)}. Expected <DeviceCode><Number> such as D100 or X1F.`
    );
  }

  const [, code, numberText] = match;
  const deviceCode = DEVICE_CODES[code];
  if (!deviceCode) {
    throw new ValueError(`Unknown SLMP device code '${code}' in ${JSON.stringify(value)}`);
  }
  const radix = resolveDeviceRadix(code, options.family ?? options.plcFamily ?? null);
  const number = parseDeviceNumber(numberText, radix);
  if (!Number.isInteger(number)) {
    throw new ValueError(
      `Invalid SLMP device string ${JSON.stringify(value)}. Expected <DeviceCode><Number> such as D100 or X1F.`
    );
  }
  return {
    code,
    number,
  };
}

function requireExplicitDeviceFamilyForXY(value, family, ref) {
  if (typeof value !== "string") {
    return ref;
  }
  if (!IQF_OCTAL_DEVICE_CODES.has(ref.code)) {
    return ref;
  }
  if (normalizePlcFamily(family)) {
    return ref;
  }
  throw new ValueError(
    "X/Y string addresses require explicit plcFamily. Use 'iq-f' for FX/iQ-F targets, choose an explicit non-iQ-F family, or pass a numeric device object."
  );
}

function deviceToString(value, options = {}) {
  const ref = parseDevice(value, options);
  const info = DEVICE_CODES[ref.code];
  if (!info) {
    return `${ref.code}${ref.number}`;
  }
  const radix = resolveDeviceRadix(ref.code, options.family ?? options.plcFamily ?? null);
  if (radix === 8) {
    return `${ref.code}${ref.number.toString(8).toUpperCase()}`;
  }
  if (radix === 16) {
    return `${ref.code}${ref.number.toString(16).toUpperCase()}`;
  }
  return `${ref.code}${ref.number}`;
}

function encode3ERequest({ target, monitoringTimer, command, subcommand, data = Buffer.alloc(0) }) {
  const normalizedTarget = normalizeTarget(target);
  const payload = Buffer.from(data);
  ensureRange(monitoringTimer, 0, 0xffff, "monitoringTimer");
  ensureRange(command, 0, 0xffff, "command");
  ensureRange(subcommand, 0, 0xffff, "subcommand");

  const reqLength = 2 + 2 + 2 + payload.length;
  ensureRange(reqLength, 0, 0xffff, "requestDataLength");

  const header = Buffer.alloc(11);
  FRAME_3E_REQUEST_SUBHEADER.copy(header, 0);
  header.writeUInt8(normalizedTarget.network, 2);
  header.writeUInt8(normalizedTarget.station, 3);
  header.writeUInt16LE(normalizedTarget.moduleIO, 4);
  header.writeUInt8(normalizedTarget.multidrop, 6);
  header.writeUInt16LE(reqLength, 7);
  header.writeUInt16LE(monitoringTimer, 9);

  const commandBuffer = Buffer.alloc(4);
  commandBuffer.writeUInt16LE(command, 0);
  commandBuffer.writeUInt16LE(subcommand, 2);
  return Buffer.concat([header, commandBuffer, payload]);
}

function encode4ERequest({ serial, target, monitoringTimer, command, subcommand, data = Buffer.alloc(0) }) {
  const normalizedTarget = normalizeTarget(target);
  const payload = Buffer.from(data);
  ensureRange(serial, 0, 0xffff, "serial");
  ensureRange(monitoringTimer, 0, 0xffff, "monitoringTimer");
  ensureRange(command, 0, 0xffff, "command");
  ensureRange(subcommand, 0, 0xffff, "subcommand");

  const reqLength = 2 + 2 + 2 + payload.length;
  ensureRange(reqLength, 0, 0xffff, "requestDataLength");

  const header = Buffer.alloc(15);
  FRAME_4E_REQUEST_SUBHEADER.copy(header, 0);
  header.writeUInt16LE(serial, 2);
  header.writeUInt16LE(0x0000, 4);
  header.writeUInt8(normalizedTarget.network, 6);
  header.writeUInt8(normalizedTarget.station, 7);
  header.writeUInt16LE(normalizedTarget.moduleIO, 8);
  header.writeUInt8(normalizedTarget.multidrop, 10);
  header.writeUInt16LE(reqLength, 11);
  header.writeUInt16LE(monitoringTimer, 13);

  const commandBuffer = Buffer.alloc(4);
  commandBuffer.writeUInt16LE(command, 0);
  commandBuffer.writeUInt16LE(subcommand, 2);
  return Buffer.concat([header, commandBuffer, payload]);
}

function encodeRequest({ frameType, serial, target, monitoringTimer, command, subcommand, data = Buffer.alloc(0) }) {
  const normalizedFrameType = normalizeFrameType(frameType);
  if (normalizedFrameType === FrameType.FRAME_3E) {
    return encode3ERequest({ target, monitoringTimer, command, subcommand, data });
  }
  return encode4ERequest({ serial, target, monitoringTimer, command, subcommand, data });
}

function decode3EResponse(frame) {
  const buffer = Buffer.from(frame);
  if (buffer.length < 11) {
    throw new SlmpError(`response too short: ${buffer.length} bytes`);
  }
  if (!buffer.subarray(0, 2).equals(FRAME_3E_RESPONSE_SUBHEADER)) {
    throw new SlmpError(`unexpected 3E response subheader: ${buffer.subarray(0, 2).toString("hex")}`);
  }
  const responseDataLength = buffer.readUInt16LE(7);
  if (buffer.length !== 9 + responseDataLength) {
    throw new SlmpError(
      `response size mismatch: actual=${buffer.length}, expected=${9 + responseDataLength}, responseDataLength=${responseDataLength}`
    );
  }
  return {
    serial: 0,
    target: normalizeTarget({
      network: buffer.readUInt8(2),
      station: buffer.readUInt8(3),
      moduleIO: buffer.readUInt16LE(4),
      multidrop: buffer.readUInt8(6),
    }),
    endCode: buffer.readUInt16LE(9),
    data: buffer.subarray(11),
    raw: buffer,
  };
}

function decode4EResponse(frame) {
  const buffer = Buffer.from(frame);
  if (buffer.length < 15) {
    throw new SlmpError(`response too short: ${buffer.length} bytes`);
  }
  if (!buffer.subarray(0, 2).equals(FRAME_4E_RESPONSE_SUBHEADER)) {
    throw new SlmpError(`unexpected 4E response subheader: ${buffer.subarray(0, 2).toString("hex")}`);
  }
  const responseDataLength = buffer.readUInt16LE(11);
  if (buffer.length !== 13 + responseDataLength) {
    throw new SlmpError(
      `response size mismatch: actual=${buffer.length}, expected=${13 + responseDataLength}, responseDataLength=${responseDataLength}`
    );
  }
  return {
    serial: buffer.readUInt16LE(2),
    target: normalizeTarget({
      network: buffer.readUInt8(6),
      station: buffer.readUInt8(7),
      moduleIO: buffer.readUInt16LE(8),
      multidrop: buffer.readUInt8(10),
    }),
    endCode: buffer.readUInt16LE(13),
    data: buffer.subarray(15),
    raw: buffer,
  };
}

function decodeResponse(frame, options) {
  const normalizedFrameType = normalizeFrameType(options.frameType);
  if (normalizedFrameType === FrameType.FRAME_3E) {
    return decode3EResponse(frame);
  }
  return decode4EResponse(frame);
}

function resolveDeviceSubcommand({ bitUnit, series, extension = false }) {
  const normalizedSeries = normalizePlcSeries(series);
  if (extension) {
    if (normalizedSeries === PLCSeries.QL) {
      return bitUnit ? SUBCOMMAND_DEVICE_BIT_QL_EXT : SUBCOMMAND_DEVICE_WORD_QL_EXT;
    }
    return bitUnit ? SUBCOMMAND_DEVICE_BIT_IQR_EXT : SUBCOMMAND_DEVICE_WORD_IQR_EXT;
  }
  if (normalizedSeries === PLCSeries.QL) {
    return bitUnit ? SUBCOMMAND_DEVICE_BIT_QL : SUBCOMMAND_DEVICE_WORD_QL;
  }
  return bitUnit ? SUBCOMMAND_DEVICE_BIT_IQR : SUBCOMMAND_DEVICE_WORD_IQR;
}

function encodeDeviceSpec(device, options) {
  const ref = parseDevice(device);
  const info = DEVICE_CODES[ref.code];
  const normalizedSeries = normalizePlcSeries(options.series);
  if (!info) {
    throw new ValueError(`Unknown SLMP device code '${ref.code}'`);
  }
  if (ref.code === "R" && ref.number > 32767) {
    throw new ValueError(`R device number out of supported range (0..32767): ${ref.number}`);
  }
  if (normalizedSeries === PLCSeries.QL) {
    ensureRange(ref.number, 0, 0xffffff, "device.number");
    const buffer = Buffer.alloc(4);
    buffer.writeUIntLE(ref.number, 0, 3);
    buffer.writeUInt8(info.code & 0xff, 3);
    return buffer;
  }

  ensureRange(ref.number, 0, 0xffffffff, "device.number");
  const buffer = Buffer.alloc(6);
  buffer.writeUInt32LE(ref.number, 0);
  buffer.writeUInt16LE(info.code, 4);
  return buffer;
}

function decodeDeviceWords(data) {
  const buffer = Buffer.from(data);
  if (buffer.length % 2 !== 0) {
    throw new SlmpError(`word data length must be even: ${buffer.length}`);
  }
  const values = [];
  for (let index = 0; index < buffer.length; index += 2) {
    values.push(buffer.readUInt16LE(index));
  }
  return values;
}

function decodeDeviceDwords(data) {
  const buffer = Buffer.from(data);
  if (buffer.length % 4 !== 0) {
    throw new SlmpError(`dword data length must be multiple of 4: ${buffer.length}`);
  }
  const values = [];
  for (let index = 0; index < buffer.length; index += 4) {
    values.push(buffer.readUInt32LE(index));
  }
  return values;
}

function packBitValues(values) {
  const bits = Array.from(values, (value) => (value ? 1 : 0));
  const packed = [];
  for (let index = 0; index < bits.length; index += 2) {
    const hi = bits[index] & 0x1;
    const lo = index + 1 < bits.length ? bits[index + 1] & 0x1 : 0;
    packed.push((hi << 4) | lo);
  }
  return Buffer.from(packed);
}

function unpackBitValues(data, count) {
  const buffer = Buffer.from(data);
  const values = [];
  for (const byte of buffer) {
    values.push(Boolean((byte >> 4) & 0x1));
    if (values.length >= count) {
      return values;
    }
    values.push(Boolean(byte & 0x1));
    if (values.length >= count) {
      return values;
    }
  }
  if (values.length !== count) {
    throw new SlmpError(`bit data too short: needed ${count}, got ${values.length}`);
  }
  return values;
}

function extractFrameFromBuffer(buffer, options) {
  const normalizedFrameType = normalizeFrameType(options.frameType);
  const source = Buffer.from(buffer);
  const headSize = normalizedFrameType === FrameType.FRAME_4E ? 13 : 9;
  if (source.length < headSize) {
    return null;
  }
  const responseDataLength = source.readUInt16LE(headSize - 2);
  const totalLength = headSize + responseDataLength;
  if (source.length < totalLength) {
    return null;
  }
  return {
    frame: source.subarray(0, totalLength),
    rest: source.subarray(totalLength),
  };
}

class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValueError";
  }
}

module.exports = {
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
  parseNumber,
  requireExplicitDeviceFamilyForXY,
  resolveConnectionProfile,
  resolveDeviceSubcommand,
  unpackBitValues,
};
