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
const { SlmpError, parseSlmpErrorInfo } = require("./errors");

const IQF_OCTAL_DEVICE_CODES = new Set(["X", "Y"]);
const DEVICE_CODE_CANDIDATES = Object.keys(DEVICE_CODES).sort((left, right) => right.length - left.length || left.localeCompare(right));
const PLC_PROFILES = new Set([
  "melsec:iq-f",
  "melsec:iq-r",
  "melsec:iq-r:rj71en71",
  "melsec:iq-l",
  "melsec:mx-f",
  "melsec:mx-r",
  "melsec:qcpu",
  "melsec:qcpu:qj71e71-100",
  "melsec:lcpu",
  "melsec:lcpu:lj71e71-100",
  "melsec:qnu",
  "melsec:qnu:qj71e71-100",
  "melsec:qnudv",
  "melsec:qnudv:qj71e71-100",
]);
const CONNECTION_PROFILES = Object.freeze([
  "melsec:iq-f",
  "melsec:iq-r",
  "melsec:iq-r:rj71en71",
  "melsec:iq-l",
  "melsec:mx-f",
  "melsec:mx-r",
  "melsec:qcpu:qj71e71-100",
  "melsec:lcpu",
  "melsec:lcpu:lj71e71-100",
  "melsec:qnu",
  "melsec:qnu:qj71e71-100",
  "melsec:qnudv",
  "melsec:qnudv:qj71e71-100",
]);
const BASE_PROFILE_SUCCESSORS = Object.freeze({
  "melsec:qcpu": "melsec:qcpu:qj71e71-100",
});
const QL_UNSUPPORTED_DEVICE_CODES = Object.freeze(["LTS", "LTC", "LTN", "LSTS", "LSTC", "LSTN", "LCS", "LCC", "LCN", "LZ", "RD"]);
const PROFILE_UNSUPPORTED_DEVICE_CODES = Object.freeze({
  "melsec:iq-f": new Set(["V", "LTS", "LTC", "LTN", "LSTS", "LSTC", "LSTN", "DX", "DY", "ZR", "RD"]),
  "melsec:iq-r": new Set(),
  "melsec:iq-r:rj71en71": new Set(),
  "melsec:iq-l": new Set(),
  "melsec:mx-f": new Set(),
  "melsec:mx-r": new Set(),
  "melsec:qcpu": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:qcpu:qj71e71-100": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:lcpu": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:lcpu:lj71e71-100": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:qnu": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:qnu:qj71e71-100": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:qnudv": new Set(QL_UNSUPPORTED_DEVICE_CODES),
  "melsec:qnudv:qj71e71-100": new Set(QL_UNSUPPORTED_DEVICE_CODES),
});
const PUBLIC_HIGH_LEVEL_UNSUPPORTED_DEVICE_CODES = new Set(["G", "HG"]);
const DIRECT_MEMORY_NORMAL = 0x00;
const DIRECT_MEMORY_MODULE_ACCESS = 0xf8;
const DIRECT_MEMORY_LINK_DIRECT = 0xf9;
const DIRECT_MEMORY_CPU_BUFFER = 0xfa;
const HG_VALID_EXTENSION_SPECIFICATIONS = new Set([0x03e0, 0x03e1, 0x03e2, 0x03e3]);
const PLC_PROFILE_DEFAULTS = Object.freeze({
  "melsec:iq-f": Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, addressProfile: "melsec:iq-f", rangeProfile: "melsec:iq-f" }),
  "melsec:iq-r": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, addressProfile: "melsec:iq-r", rangeProfile: "melsec:iq-r" }),
  "melsec:iq-r:rj71en71": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, addressProfile: "melsec:iq-r", rangeProfile: "melsec:iq-r:rj71en71" }),
  "melsec:iq-l": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, addressProfile: "melsec:iq-l", rangeProfile: "melsec:iq-l" }),
  "melsec:mx-f": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, addressProfile: "melsec:mx-f", rangeProfile: "melsec:mx-f" }),
  "melsec:mx-r": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.IQR, addressProfile: "melsec:mx-r", rangeProfile: "melsec:mx-r" }),
  "melsec:qcpu": Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, addressProfile: "melsec:qcpu", rangeProfile: "melsec:qcpu" }),
  "melsec:qcpu:qj71e71-100": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.QL, addressProfile: "melsec:qcpu", rangeProfile: "melsec:qcpu:qj71e71-100" }),
  "melsec:lcpu": Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, addressProfile: "melsec:lcpu", rangeProfile: "melsec:lcpu" }),
  "melsec:lcpu:lj71e71-100": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.QL, addressProfile: "melsec:lcpu", rangeProfile: "melsec:lcpu:lj71e71-100" }),
  "melsec:qnu": Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, addressProfile: "melsec:qnu", rangeProfile: "melsec:qnu" }),
  "melsec:qnu:qj71e71-100": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.QL, addressProfile: "melsec:qnu", rangeProfile: "melsec:qnu:qj71e71-100" }),
  "melsec:qnudv": Object.freeze({ frameType: FrameType.FRAME_3E, plcSeries: PLCSeries.QL, addressProfile: "melsec:qnudv", rangeProfile: "melsec:qnudv" }),
  "melsec:qnudv:qj71e71-100": Object.freeze({ frameType: FrameType.FRAME_4E, plcSeries: PLCSeries.QL, addressProfile: "melsec:qnudv", rangeProfile: "melsec:qnudv:qj71e71-100" }),
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

function normalizePlcProfile(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (PLC_PROFILES.has(normalized)) {
    return normalized;
  }
  throw new ValueError(`Unsupported plcProfile: ${value}`);
}

function availablePlcProfiles() {
  return CONNECTION_PROFILES.slice();
}

function normalizePlcProfileContext(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (PLC_PROFILES.has(normalized)) {
    return {
      plcProfile: normalized,
      label: normalized,
    };
  }
  throw new ValueError(`Unsupported plcProfile: ${value}`);
}

function resolveConnectionProfile({ plcProfile, plcSeries, frameType } = {}, options = {}) {
  const allowManualProfile = Boolean(options.allowManualProfile);
  const normalizedProfile = normalizePlcProfile(plcProfile);
  if (normalizedProfile) {
    if (BASE_PROFILE_SUCCESSORS[normalizedProfile]) {
      throw new ValueError(
        `${normalizedProfile} is a base profile; use ${BASE_PROFILE_SUCCESSORS[normalizedProfile]}.`
      );
    }
    if (plcSeries !== undefined || frameType !== undefined) {
      throw new ValueError(
        "plcProfile already determines frameType, plcSeries, and address handling. Do not also pass plcSeries or frameType."
      );
    }
    return {
      plcProfile: normalizedProfile,
      plcSeries: PLC_PROFILE_DEFAULTS[normalizedProfile].plcSeries,
      frameType: PLC_PROFILE_DEFAULTS[normalizedProfile].frameType,
      addressProfile: PLC_PROFILE_DEFAULTS[normalizedProfile].addressProfile,
      rangeProfile: PLC_PROFILE_DEFAULTS[normalizedProfile].rangeProfile,
    };
  }
  if (!allowManualProfile) {
    throw new ValueError(
      "plcProfile is required for the standard client profile. The normal route derives frameType, plcSeries, and address handling from that explicit profile."
    );
  }
  return {
    plcProfile: null,
    plcSeries: plcSeries === undefined ? PLCSeries.QL : normalizePlcSeries(plcSeries),
    frameType: frameType === undefined ? FrameType.FRAME_4E : normalizeFrameType(frameType),
    addressProfile: null,
    rangeProfile: null,
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

function resolveDeviceRadix(code, plcProfile) {
  const normalizedProfile = normalizePlcProfileContext(plcProfile);
  if (normalizedProfile && normalizedProfile.plcProfile === "melsec:iq-f" && IQF_OCTAL_DEVICE_CODES.has(code)) {
    return 8;
  }
  return DEVICE_CODES[code].radix;
}

function isDeviceCodeSupportedForPlcProfile(code, plcProfile) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!DEVICE_CODES[normalizedCode]) {
    return false;
  }
  if (PUBLIC_HIGH_LEVEL_UNSUPPORTED_DEVICE_CODES.has(normalizedCode)) {
    return false;
  }
  const normalizedProfile = normalizePlcProfileContext(plcProfile);
  if (!normalizedProfile) {
    return true;
  }
  const unsupported = PROFILE_UNSUPPORTED_DEVICE_CODES[normalizedProfile.plcProfile];
  return !(unsupported && unsupported.has(normalizedCode));
}

function assertDeviceCodeSupportedForPlcProfile(code, plcProfile, options = {}) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!DEVICE_CODES[normalizedCode]) {
    throw new ValueError(`Unknown SLMP device code '${normalizedCode}'`);
  }
  const normalizedProfile = normalizePlcProfileContext(plcProfile);
  if (PUBLIC_HIGH_LEVEL_UNSUPPORTED_DEVICE_CODES.has(normalizedCode) && !options.allowQualifiedOnly) {
    throw new ValueError(
      `SLMP device code '${normalizedCode}' is not supported in the Node-RED public high-level surface.`
    );
  }
  const unsupported = normalizedProfile ? PROFILE_UNSUPPORTED_DEVICE_CODES[normalizedProfile.plcProfile] : null;
  if (unsupported && unsupported.has(normalizedCode)) {
    throw new ValueError(`SLMP device code '${normalizedCode}' is not supported for plcProfile '${normalizedProfile.label}'.`);
  }
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

function rejectLegacyFamilyOption(options) {
  if (Object.prototype.hasOwnProperty.call(options, "family")) {
    throw new ValueError("options.family is no longer supported; use plcProfile.");
  }
}

function parseDevice(value, options = {}) {
  rejectLegacyFamilyOption(options);
  const radixProfile = options.addressProfile ?? options.plcProfile ?? null;
  const supportProfile = options.plcProfile ?? options.addressProfile ?? null;
  if (value && typeof value === "object" && typeof value.code === "string" && Number.isInteger(value.number)) {
    const code = value.code.toUpperCase();
    assertDeviceCodeSupportedForPlcProfile(code, supportProfile, options);
    return { code, number: value.number };
  }

  const text = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]+[0-9A-F]+$/.test(text)) {
    throw new ValueError(
      `Invalid SLMP device string ${JSON.stringify(value)}. Expected <DeviceCode><Number> such as D100 or X1F.`
    );
  }

  let code = null;
  let numberText = null;
  for (const candidate of DEVICE_CODE_CANDIDATES) {
    if (text.startsWith(candidate)) {
      code = candidate;
      numberText = text.slice(candidate.length);
      break;
    }
  }
  if (!code) {
    const match = /^([A-Z]+)([0-9A-F]+)$/.exec(text);
    const unknownCode = match ? match[1] : text;
    throw new ValueError(`Unknown SLMP device code '${unknownCode}' in ${JSON.stringify(value)}`);
  }
  assertDeviceCodeSupportedForPlcProfile(code, supportProfile, options);
  const radix = resolveDeviceRadix(code, radixProfile);
  const number = parseDeviceNumber(numberText, radix);
  if (!Number.isInteger(number)) {
    throw new ValueError(
      `Invalid SLMP device number '${numberText}' for device code '${code}' in ${JSON.stringify(value)}.`
    );
  }
  return {
    code,
    number,
  };
}

function requireExplicitPlcProfileForXY(value, plcProfile, ref) {
  if (typeof value !== "string") {
    return ref;
  }
  if (!IQF_OCTAL_DEVICE_CODES.has(ref.code)) {
    return ref;
  }
  if (normalizePlcProfile(plcProfile)) {
    return ref;
  }
  throw new ValueError(
    "X/Y string addresses require explicit plcProfile. Use 'melsec:iq-f' for FX/iQ-F targets, choose an explicit non-iQ-F profile, or pass a numeric device object."
  );
}

function deviceToString(value, options = {}) {
  rejectLegacyFamilyOption(options);
  const ref = parseDevice(value, options);
  const info = DEVICE_CODES[ref.code];
  if (!info) {
    return `${ref.code}${ref.number}`;
  }
  const radix = resolveDeviceRadix(ref.code, options.addressProfile ?? options.plcProfile ?? null);
  if (radix === 8) {
    return `${ref.code}${ref.number.toString(8).toUpperCase()}`;
  }
  if (radix === 16) {
    return `${ref.code}${ref.number.toString(16).toUpperCase()}`;
  }
  return `${ref.code}${ref.number}`;
}

function normalizeExtensionSpec(extension = {}) {
  const source = extension || {};
  return {
    extensionSpecification: ensureRange(
      parseNumber(
        source.extensionSpecification ?? source.extension_specification,
        "extension.extensionSpecification",
        { defaultValue: 0 }
      ),
      0,
      0xffff,
      "extension.extensionSpecification"
    ),
    extensionSpecificationModification: ensureRange(
      parseNumber(
        source.extensionSpecificationModification ?? source.extension_specification_modification,
        "extension.extensionSpecificationModification",
        { defaultValue: 0 }
      ),
      0,
      0xff,
      "extension.extensionSpecificationModification"
    ),
    deviceModificationIndex: ensureRange(
      parseNumber(
        source.deviceModificationIndex ?? source.device_modification_index,
        "extension.deviceModificationIndex",
        { defaultValue: 0 }
      ),
      0,
      0xff,
      "extension.deviceModificationIndex"
    ),
    deviceModificationFlags: ensureRange(
      parseNumber(
        source.deviceModificationFlags ?? source.device_modification_flags,
        "extension.deviceModificationFlags",
        { defaultValue: 0 }
      ),
      0,
      0xff,
      "extension.deviceModificationFlags"
    ),
    directMemorySpecification: ensureRange(
      parseNumber(
        source.directMemorySpecification ?? source.direct_memory_specification,
        "extension.directMemorySpecification",
        { defaultValue: DIRECT_MEMORY_NORMAL }
      ),
      0,
      0xff,
      "extension.directMemorySpecification"
    ),
  };
}

function validateHgExtensionSpecification(extensionSpecification) {
  if (!HG_VALID_EXTENSION_SPECIFICATIONS.has(extensionSpecification)) {
    throw new ValueError("HG Extended Device access is valid only for U3E0\\HG through U3E3\\HG.");
  }
}

function parseExtendedDevice(value, options = {}) {
  rejectLegacyFamilyOption(options);
  if (value && typeof value === "object" && typeof value.code === "string" && Number.isInteger(value.number)) {
    return {
      ref: parseDevice(value, { ...options, allowQualifiedOnly: true }),
      extensionSpecification: null,
      directMemorySpecification: null,
      qualifier: null,
    };
  }

  const text = String(value || "").trim().toUpperCase();
  const jQualified = /^J(\d+)[\\/](.+)$/.exec(text);
  if (jQualified) {
    const extensionSpecification = ensureRange(
      parseNumber(jQualified[1], "extendedDevice.jNetwork"),
      0,
      0xff,
      "extendedDevice.jNetwork"
    );
    return {
      ref: parseDevice(jQualified[2], { ...options, allowQualifiedOnly: true }),
      extensionSpecification,
      directMemorySpecification: DIRECT_MEMORY_LINK_DIRECT,
      qualifier: "J",
    };
  }

  const uQualified = /^U([0-9A-F]+)[\\/](.+)$/i.exec(text);
  if (uQualified) {
    const extensionSpecification = ensureRange(
      parseNumber(uQualified[1], "extendedDevice.extensionSpecification", { base: 16 }),
      0,
      0xffff,
      "extendedDevice.extensionSpecification"
    );
    const ref = parseDevice(uQualified[2], { ...options, allowQualifiedOnly: true });
    let directMemorySpecification = null;
    if (ref.code === "G") {
      directMemorySpecification = DIRECT_MEMORY_MODULE_ACCESS;
    } else if (ref.code === "HG") {
      validateHgExtensionSpecification(extensionSpecification);
      directMemorySpecification = DIRECT_MEMORY_CPU_BUFFER;
    }
    return {
      ref,
      extensionSpecification,
      directMemorySpecification,
      qualifier: "U",
    };
  }

  return {
    ref: parseDevice(value, { ...options, allowQualifiedOnly: true }),
    extensionSpecification: null,
    directMemorySpecification: null,
    qualifier: null,
  };
}

function resolveExtendedDeviceAndExtension(device, extension = {}, options = {}) {
  const qualified = parseExtendedDevice(device, options);
  const result = normalizeExtensionSpec(extension);

  if (qualified.ref.code === "G" && qualified.qualifier !== "U") {
    throw new ValueError("G Extended Device access requires U-qualified module access such as U1\\G0.");
  }
  if (qualified.ref.code === "HG") {
    if (qualified.qualifier !== "U") {
      throw new ValueError("HG Extended Device access requires U-qualified CPU-buffer access U3E0\\HG through U3E3\\HG.");
    }
    validateHgExtensionSpecification(qualified.extensionSpecification);
  }

  if (qualified.extensionSpecification !== null) {
    result.extensionSpecification = qualified.extensionSpecification;
  }
  if (qualified.directMemorySpecification !== null) {
    if (result.directMemorySpecification === DIRECT_MEMORY_NORMAL) {
      result.directMemorySpecification = qualified.directMemorySpecification;
    } else if (result.directMemorySpecification !== qualified.directMemorySpecification) {
      throw new ValueError(
        `${qualified.ref.code} Extended Device access requires directMemorySpecification=0x${qualified.directMemorySpecification.toString(16).toUpperCase().padStart(2, "0")}; got 0x${result.directMemorySpecification.toString(16).toUpperCase().padStart(2, "0")}`
      );
    }
  }

  return { ref: qualified.ref, extension: result };
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
  const endCode = buffer.readUInt16LE(9);
  const data = buffer.subarray(11);
  return {
    serial: 0,
    target: normalizeTarget({
      network: buffer.readUInt8(2),
      station: buffer.readUInt8(3),
      moduleIO: buffer.readUInt16LE(4),
      multidrop: buffer.readUInt8(6),
    }),
    endCode,
    data,
    errorInfo: endCode === 0 ? undefined : parseSlmpErrorInfo(data),
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
  const endCode = buffer.readUInt16LE(13);
  const data = buffer.subarray(15);
  return {
    serial: buffer.readUInt16LE(2),
    target: normalizeTarget({
      network: buffer.readUInt8(6),
      station: buffer.readUInt8(7),
      moduleIO: buffer.readUInt16LE(8),
      multidrop: buffer.readUInt8(10),
    }),
    endCode,
    data,
    errorInfo: endCode === 0 ? undefined : parseSlmpErrorInfo(data),
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
  const ref = parseDevice(device, options);
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

function encodeResolvedExtendedDeviceSpec(ref, options) {
  const extension = normalizeExtensionSpec(options.extension);
  if (extension.directMemorySpecification === DIRECT_MEMORY_LINK_DIRECT) {
    const info = DEVICE_CODES[ref.code];
    if (!info) {
      throw new ValueError(`Unknown SLMP device code '${ref.code}'`);
    }
    ensureRange(ref.number, 0, 0xffffff, "device.number");
    const buffer = Buffer.alloc(11);
    buffer.writeUIntLE(ref.number, 2, 3);
    buffer.writeUInt8(info.code & 0xff, 5);
    buffer.writeUInt8(extension.extensionSpecification & 0xff, 8);
    buffer.writeUInt8(DIRECT_MEMORY_LINK_DIRECT, 10);
    return buffer;
  }

  const deviceSpec = encodeDeviceSpec(ref, { series: options.series, allowQualifiedOnly: true });
  return Buffer.concat([
    Buffer.from([extension.deviceModificationIndex, extension.deviceModificationFlags]),
    deviceSpec,
    Buffer.from([extension.extensionSpecificationModification, 0x00]),
    numberToBufferCore(extension.extensionSpecification, 2),
    Buffer.from([extension.directMemorySpecification]),
  ]);
}

function encodeExtendedDeviceSpec(device, options = {}) {
  const { ref, extension } = resolveExtendedDeviceAndExtension(device, options.extension || {}, options);
  return encodeResolvedExtendedDeviceSpec(ref, { series: options.series, extension });
}

function numberToBufferCore(value, size) {
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
  availablePlcProfiles,
  decodeDeviceDwords,
  decodeDeviceWords,
  decodeResponse,
  deviceToString,
  encodeDeviceSpec,
  encodeExtendedDeviceSpec,
  encodeRequest,
  encodeResolvedExtendedDeviceSpec,
  extractFrameFromBuffer,
  isDeviceCodeSupportedForPlcProfile,
  normalizeFrameType,
  normalizeExtensionSpec,
  normalizePlcProfile,
  normalizePlcSeries,
  normalizeTarget,
  normalizeTransport,
  packBitValues,
  parseDevice,
  parseNumber,
  requireExplicitPlcProfileForXY,
  resolveConnectionProfile,
  resolveDeviceSubcommand,
  resolveExtendedDeviceAndExtension,
  unpackBitValues,
};
