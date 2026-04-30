"use strict";

const { ValueError, parseDevice } = require("./core");
const { SlmpError } = require("./errors");

const SlmpDeviceRangeFamily = Object.freeze({
  IqR: "IqR",
  MxF: "MxF",
  MxR: "MxR",
  IqF: "IqF",
  QCpu: "QCpu",
  LCpu: "LCpu",
  QnU: "QnU",
  QnUDV: "QnUDV",
});

const SlmpDeviceRangeCategory = Object.freeze({
  Bit: "Bit",
  Word: "Word",
  TimerCounter: "TimerCounter",
  Index: "Index",
  FileRefresh: "FileRefresh",
});

const SlmpDeviceRangeNotation = Object.freeze({
  Base10: "Base10",
  Base8: "Base8",
  Base16: "Base16",
});

const RANGE_KIND = Object.freeze({
  Unsupported: "unsupported",
  Undefined: "undefined",
  Fixed: "fixed",
  WordRegister: "word-register",
  DWordRegister: "dword-register",
  WordRegisterClipped: "word-register-clipped",
  DWordRegisterClipped: "dword-register-clipped",
});
const MAX_RUNTIME_RANGE_PROBE_COUNT = 1048576;
const ZR_RUNTIME_FAMILIES = new Set([
  SlmpDeviceRangeFamily.QCpu,
  SlmpDeviceRangeFamily.LCpu,
  SlmpDeviceRangeFamily.QnU,
  SlmpDeviceRangeFamily.QnUDV,
]);

const ORDERED_ITEMS = Object.freeze([
  "X",
  "Y",
  "M",
  "B",
  "SB",
  "F",
  "V",
  "L",
  "S",
  "D",
  "W",
  "SW",
  "R",
  "T",
  "ST",
  "C",
  "LT",
  "LST",
  "LC",
  "Z",
  "LZ",
  "ZR",
  "RD",
  "SM",
  "SD",
]);

const ROWS = Object.freeze({
  X: singleRow(SlmpDeviceRangeCategory.Bit, "X", true, SlmpDeviceRangeNotation.Base16),
  Y: singleRow(SlmpDeviceRangeCategory.Bit, "Y", true, SlmpDeviceRangeNotation.Base16),
  M: singleRow(SlmpDeviceRangeCategory.Bit, "M", true, SlmpDeviceRangeNotation.Base10),
  B: singleRow(SlmpDeviceRangeCategory.Bit, "B", true, SlmpDeviceRangeNotation.Base16),
  SB: singleRow(SlmpDeviceRangeCategory.Bit, "SB", true, SlmpDeviceRangeNotation.Base16),
  F: singleRow(SlmpDeviceRangeCategory.Bit, "F", true, SlmpDeviceRangeNotation.Base10),
  V: singleRow(SlmpDeviceRangeCategory.Bit, "V", true, SlmpDeviceRangeNotation.Base10),
  L: singleRow(SlmpDeviceRangeCategory.Bit, "L", true, SlmpDeviceRangeNotation.Base10),
  S: singleRow(SlmpDeviceRangeCategory.Bit, "S", true, SlmpDeviceRangeNotation.Base10),
  D: singleRow(SlmpDeviceRangeCategory.Word, "D", false, SlmpDeviceRangeNotation.Base10),
  W: singleRow(SlmpDeviceRangeCategory.Word, "W", false, SlmpDeviceRangeNotation.Base16),
  SW: singleRow(SlmpDeviceRangeCategory.Word, "SW", false, SlmpDeviceRangeNotation.Base16),
  R: singleRow(SlmpDeviceRangeCategory.Word, "R", false, SlmpDeviceRangeNotation.Base10),
  T: multiRow(
    SlmpDeviceRangeCategory.TimerCounter,
    SlmpDeviceRangeNotation.Base10,
    ["TS", true],
    ["TC", true],
    ["TN", false]
  ),
  ST: multiRow(
    SlmpDeviceRangeCategory.TimerCounter,
    SlmpDeviceRangeNotation.Base10,
    ["STS", true],
    ["STC", true],
    ["STN", false]
  ),
  C: multiRow(
    SlmpDeviceRangeCategory.TimerCounter,
    SlmpDeviceRangeNotation.Base10,
    ["CS", true],
    ["CC", true],
    ["CN", false]
  ),
  LT: multiRow(
    SlmpDeviceRangeCategory.TimerCounter,
    SlmpDeviceRangeNotation.Base10,
    ["LTS", true],
    ["LTC", true],
    ["LTN", false]
  ),
  LST: multiRow(
    SlmpDeviceRangeCategory.TimerCounter,
    SlmpDeviceRangeNotation.Base10,
    ["LSTS", true],
    ["LSTC", true],
    ["LSTN", false]
  ),
  LC: multiRow(
    SlmpDeviceRangeCategory.TimerCounter,
    SlmpDeviceRangeNotation.Base10,
    ["LCS", true],
    ["LCC", true],
    ["LCN", false]
  ),
  Z: singleRow(SlmpDeviceRangeCategory.Index, "Z", false, SlmpDeviceRangeNotation.Base10),
  LZ: singleRow(SlmpDeviceRangeCategory.Index, "LZ", false, SlmpDeviceRangeNotation.Base10),
  ZR: singleRow(SlmpDeviceRangeCategory.FileRefresh, "ZR", false, SlmpDeviceRangeNotation.Base10),
  RD: singleRow(SlmpDeviceRangeCategory.FileRefresh, "RD", false, SlmpDeviceRangeNotation.Base10),
  SM: singleRow(SlmpDeviceRangeCategory.Bit, "SM", true, SlmpDeviceRangeNotation.Base10),
  SD: singleRow(SlmpDeviceRangeCategory.Word, "SD", false, SlmpDeviceRangeNotation.Base10),
});

const CANONICAL_FAMILY_NAMES = Object.freeze({
  "iq-r": SlmpDeviceRangeFamily.IqR,
  "mx-f": SlmpDeviceRangeFamily.MxF,
  "mx-r": SlmpDeviceRangeFamily.MxR,
  "iq-f": SlmpDeviceRangeFamily.IqF,
  qcpu: SlmpDeviceRangeFamily.QCpu,
  lcpu: SlmpDeviceRangeFamily.LCpu,
  qnu: SlmpDeviceRangeFamily.QnU,
  qnudv: SlmpDeviceRangeFamily.QnUDV,
});

const PROFILES = Object.freeze({
  [SlmpDeviceRangeFamily.IqR]: profile(SlmpDeviceRangeFamily.IqR, 260, 50, {
    X: dword(260, "SD260-SD261 (32-bit)"),
    Y: dword(262, "SD262-SD263 (32-bit)"),
    M: dword(264, "SD264-SD265 (32-bit)"),
    B: dword(266, "SD266-SD267 (32-bit)"),
    SB: dword(268, "SD268-SD269 (32-bit)"),
    F: dword(270, "SD270-SD271 (32-bit)"),
    V: dword(272, "SD272-SD273 (32-bit)"),
    L: dword(274, "SD274-SD275 (32-bit)"),
    S: dword(276, "SD276-SD277 (32-bit)"),
    D: dword(280, "SD280-SD281 (32-bit)"),
    W: dword(282, "SD282-SD283 (32-bit)"),
    SW: dword(284, "SD284-SD285 (32-bit)"),
    R: dwordClipped(306, 32768, "SD306-SD307 (32-bit)", "Upper bound is clipped to 32768."),
    T: dword(288, "SD288-SD289 (32-bit)"),
    ST: dword(290, "SD290-SD291 (32-bit)"),
    C: dword(292, "SD292-SD293 (32-bit)"),
    LT: dword(294, "SD294-SD295 (32-bit)"),
    LST: dword(296, "SD296-SD297 (32-bit)"),
    LC: dword(298, "SD298-SD299 (32-bit)"),
    Z: word(300, "SD300"),
    LZ: word(302, "SD302"),
    ZR: dword(306, "SD306-SD307 (32-bit)"),
    RD: dword(308, "SD308-SD309 (32-bit)"),
    SM: fixed(4096, "Fixed family limit"),
    SD: fixed(4096, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.MxF]: profile(SlmpDeviceRangeFamily.MxF, 260, 50, {
    X: dword(260, "SD260-SD261 (32-bit)"),
    Y: dword(262, "SD262-SD263 (32-bit)"),
    M: dword(264, "SD264-SD265 (32-bit)"),
    B: dword(266, "SD266-SD267 (32-bit)"),
    SB: dword(268, "SD268-SD269 (32-bit)"),
    F: dword(270, "SD270-SD271 (32-bit)"),
    V: dword(272, "SD272-SD273 (32-bit)"),
    L: dword(274, "SD274-SD275 (32-bit)"),
    S: unsupported("Not supported on MX-F."),
    D: dword(280, "SD280-SD281 (32-bit)"),
    W: dword(282, "SD282-SD283 (32-bit)"),
    SW: dword(284, "SD284-SD285 (32-bit)"),
    R: dwordClipped(306, 32768, "SD306-SD307 (32-bit)", "Upper bound is clipped to 32768."),
    T: dword(288, "SD288-SD289 (32-bit)"),
    ST: dword(290, "SD290-SD291 (32-bit)"),
    C: dword(292, "SD292-SD293 (32-bit)"),
    LT: dword(294, "SD294-SD295 (32-bit)"),
    LST: dword(296, "SD296-SD297 (32-bit)"),
    LC: dword(298, "SD298-SD299 (32-bit)"),
    Z: word(300, "SD300"),
    LZ: word(302, "SD302"),
    ZR: dword(306, "SD306-SD307 (32-bit)"),
    RD: dword(308, "SD308-SD309 (32-bit)"),
    SM: fixed(10000, "Fixed family limit"),
    SD: fixed(10000, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.MxR]: profile(SlmpDeviceRangeFamily.MxR, 260, 50, {
    X: dword(260, "SD260-SD261 (32-bit)"),
    Y: dword(262, "SD262-SD263 (32-bit)"),
    M: dword(264, "SD264-SD265 (32-bit)"),
    B: dword(266, "SD266-SD267 (32-bit)"),
    SB: dword(268, "SD268-SD269 (32-bit)"),
    F: dword(270, "SD270-SD271 (32-bit)"),
    V: dword(272, "SD272-SD273 (32-bit)"),
    L: dword(274, "SD274-SD275 (32-bit)"),
    S: unsupported("Not supported on MX-R."),
    D: dword(280, "SD280-SD281 (32-bit)"),
    W: dword(282, "SD282-SD283 (32-bit)"),
    SW: dword(284, "SD284-SD285 (32-bit)"),
    R: dwordClipped(306, 32768, "SD306-SD307 (32-bit)", "Upper bound is clipped to 32768."),
    T: dword(288, "SD288-SD289 (32-bit)"),
    ST: dword(290, "SD290-SD291 (32-bit)"),
    C: dword(292, "SD292-SD293 (32-bit)"),
    LT: dword(294, "SD294-SD295 (32-bit)"),
    LST: dword(296, "SD296-SD297 (32-bit)"),
    LC: dword(298, "SD298-SD299 (32-bit)"),
    Z: word(300, "SD300"),
    LZ: word(302, "SD302"),
    ZR: dword(306, "SD306-SD307 (32-bit)"),
    RD: dword(308, "SD308-SD309 (32-bit)"),
    SM: fixed(4496, "Fixed family limit"),
    SD: fixed(4496, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.IqF]: profile(SlmpDeviceRangeFamily.IqF, 260, 46, {
    X: dword(260, "SD260-SD261 (32-bit)", "Manual addressing for iQ-F X devices is octal."),
    Y: dword(262, "SD262-SD263 (32-bit)", "Manual addressing for iQ-F Y devices is octal."),
    M: dword(264, "SD264-SD265 (32-bit)"),
    B: dword(266, "SD266-SD267 (32-bit)"),
    SB: dword(268, "SD268-SD269 (32-bit)"),
    F: dword(270, "SD270-SD271 (32-bit)"),
    V: unsupported("Not supported on iQ-F."),
    L: dword(274, "SD274-SD275 (32-bit)"),
    S: unsupported("Not supported on iQ-F."),
    D: dword(280, "SD280-SD281 (32-bit)"),
    W: dword(282, "SD282-SD283 (32-bit)"),
    SW: dword(284, "SD284-SD285 (32-bit)"),
    R: dword(304, "SD304-SD305 (32-bit)"),
    T: dword(288, "SD288-SD289 (32-bit)"),
    ST: dword(290, "SD290-SD291 (32-bit)"),
    C: dword(292, "SD292-SD293 (32-bit)"),
    LT: unsupported("Not supported on iQ-F."),
    LST: unsupported("Not supported on iQ-F."),
    LC: dword(298, "SD298-SD299 (32-bit)"),
    Z: word(300, "SD300"),
    LZ: word(302, "SD302"),
    ZR: unsupported("Not supported on iQ-F."),
    RD: unsupported("Not supported on iQ-F."),
    SM: fixed(10000, "Fixed family limit"),
    SD: fixed(12000, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.QCpu]: profile(SlmpDeviceRangeFamily.QCpu, 290, 15, {
    X: word(290, "SD290"),
    Y: word(291, "SD291"),
    M: wordClipped(292, 32768, "SD292", "Upper bound is clipped to 32768."),
    B: wordClipped(294, 32768, "SD294", "Upper bound is clipped to 32768."),
    SB: word(296, "SD296"),
    F: word(295, "SD295"),
    V: word(297, "SD297"),
    L: word(293, "SD293"),
    S: word(298, "SD298"),
    D: wordClipped(302, 32768, "SD302", "Upper bound is clipped to 32768 and excludes extended area."),
    W: wordClipped(303, 32768, "SD303", "Upper bound is clipped to 32768 and excludes extended area."),
    SW: word(304, "SD304"),
    R: fixed(32768, "Fixed family limit"),
    T: word(299, "SD299"),
    ST: word(300, "SD300"),
    C: word(301, "SD301"),
    LT: unsupported("Not supported on QCPU."),
    LST: unsupported("Not supported on QCPU."),
    LC: unsupported("Not supported on QCPU."),
    Z: fixed(10, "Fixed family limit"),
    LZ: unsupported("Not supported on QCPU."),
    ZR: undefinedValue("No finite upper-bound register is defined for QCPU ZR."),
    RD: unsupported("Not supported on QCPU."),
    SM: fixed(1024, "Fixed family limit"),
    SD: fixed(1024, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.LCpu]: profile(SlmpDeviceRangeFamily.LCpu, 286, 26, {
    X: word(290, "SD290"),
    Y: word(291, "SD291"),
    M: dword(286, "SD286-SD287 (32-bit)"),
    B: dword(288, "SD288-SD289 (32-bit)"),
    SB: word(296, "SD296"),
    F: word(295, "SD295"),
    V: word(297, "SD297"),
    L: word(293, "SD293"),
    S: word(298, "SD298"),
    D: dword(308, "SD308-SD309 (32-bit)"),
    W: dword(310, "SD310-SD311 (32-bit)"),
    SW: word(304, "SD304"),
    R: dwordClipped(306, 32768, "SD306-SD307 (32-bit)", "Upper bound is clipped to 32768."),
    T: word(299, "SD299"),
    ST: word(300, "SD300"),
    C: word(301, "SD301"),
    LT: unsupported("Not supported on LCPU."),
    LST: unsupported("Not supported on LCPU."),
    LC: unsupported("Not supported on LCPU."),
    Z: fixed(20, "Fixed family limit"),
    LZ: unsupported("Not supported on LCPU."),
    ZR: dword(306, "SD306-SD307 (32-bit)"),
    RD: unsupported("Not supported on LCPU."),
    SM: fixed(2048, "Fixed family limit"),
    SD: fixed(2048, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.QnU]: profile(SlmpDeviceRangeFamily.QnU, 286, 26, {
    X: word(290, "SD290"),
    Y: word(291, "SD291"),
    M: dword(286, "SD286-SD287 (32-bit)"),
    B: dword(288, "SD288-SD289 (32-bit)"),
    SB: word(296, "SD296"),
    F: word(295, "SD295"),
    V: word(297, "SD297"),
    L: word(293, "SD293"),
    S: word(298, "SD298"),
    D: dword(308, "SD308-SD309 (32-bit)"),
    W: dword(310, "SD310-SD311 (32-bit)"),
    SW: word(304, "SD304"),
    R: dwordClipped(306, 32768, "SD306-SD307 (32-bit)", "Upper bound is clipped to 32768."),
    T: word(299, "SD299"),
    ST: word(300, "SD300"),
    C: word(301, "SD301"),
    LT: unsupported("Not supported on QnU."),
    LST: unsupported("Not supported on QnU."),
    LC: unsupported("Not supported on QnU."),
    Z: fixed(20, "Fixed family limit"),
    LZ: unsupported("Not supported on QnU."),
    ZR: dword(306, "SD306-SD307 (32-bit)"),
    RD: unsupported("Not supported on QnU."),
    SM: fixed(2048, "Fixed family limit"),
    SD: fixed(2048, "Fixed family limit"),
  }),
  [SlmpDeviceRangeFamily.QnUDV]: profile(SlmpDeviceRangeFamily.QnUDV, 286, 26, {
    X: word(290, "SD290"),
    Y: word(291, "SD291"),
    M: dword(286, "SD286-SD287 (32-bit)"),
    B: dword(288, "SD288-SD289 (32-bit)"),
    SB: word(296, "SD296"),
    F: word(295, "SD295"),
    V: word(297, "SD297"),
    L: word(293, "SD293"),
    S: word(298, "SD298"),
    D: dword(308, "SD308-SD309 (32-bit)"),
    W: dword(310, "SD310-SD311 (32-bit)"),
    SW: word(304, "SD304"),
    R: dwordClipped(306, 32768, "SD306-SD307 (32-bit)", "Upper bound is clipped to 32768."),
    T: word(299, "SD299"),
    ST: word(300, "SD300"),
    C: word(301, "SD301"),
    LT: unsupported("Not supported on QnUDV."),
    LST: unsupported("Not supported on QnUDV."),
    LC: unsupported("Not supported on QnUDV."),
    Z: fixed(20, "Fixed family limit"),
    LZ: unsupported("Not supported on QnUDV."),
    ZR: dword(306, "SD306-SD307 (32-bit)"),
    RD: unsupported("Not supported on QnUDV."),
    SM: fixed(2048, "Fixed family limit"),
    SD: fixed(2048, "Fixed family limit"),
  }),
});

function singleRow(category, device, isBitDevice, notation) {
  return { category, devices: [[device, isBitDevice]], notation };
}

function multiRow(category, notation, ...devices) {
  return { category, devices, notation };
}

function fixed(value, source) {
  return { kind: RANGE_KIND.Fixed, register: 0, fixedValue: value, clipValue: 0, source, notes: null };
}

function word(register, source, notes = null) {
  return { kind: RANGE_KIND.WordRegister, register, fixedValue: 0, clipValue: 0, source, notes };
}

function dword(register, source, notes = null) {
  return { kind: RANGE_KIND.DWordRegister, register, fixedValue: 0, clipValue: 0, source, notes };
}

function wordClipped(register, clipValue, source, notes = null) {
  return { kind: RANGE_KIND.WordRegisterClipped, register, fixedValue: 0, clipValue, source, notes };
}

function dwordClipped(register, clipValue, source, notes = null) {
  return { kind: RANGE_KIND.DWordRegisterClipped, register, fixedValue: 0, clipValue, source, notes };
}

function unsupported(notes) {
  return { kind: RANGE_KIND.Unsupported, register: 0, fixedValue: 0, clipValue: 0, source: "Unsupported", notes };
}

function undefinedValue(notes) {
  return { kind: RANGE_KIND.Undefined, register: 0, fixedValue: 0, clipValue: 0, source: "Undefined", notes };
}

function profile(family, registerStart, registerCount, rules) {
  return { family, registerStart, registerCount, rules };
}

function normalizeDeviceRangeFamily(value) {
  if (Object.values(SlmpDeviceRangeFamily).includes(value)) {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CANONICAL_FAMILY_NAMES, normalized)) {
    return CANONICAL_FAMILY_NAMES[normalized];
  }
  throw new ValueError(`Unsupported PLC family: ${value}`);
}

function familyLabel(family) {
  switch (normalizeDeviceRangeFamily(family)) {
    case SlmpDeviceRangeFamily.IqR:
      return "IQ-R";
    case SlmpDeviceRangeFamily.MxF:
      return "MX-F";
    case SlmpDeviceRangeFamily.MxR:
      return "MX-R";
    case SlmpDeviceRangeFamily.IqF:
      return "IQ-F";
    case SlmpDeviceRangeFamily.QCpu:
      return "QCPU";
    case SlmpDeviceRangeFamily.LCpu:
      return "LCPU";
    case SlmpDeviceRangeFamily.QnU:
      return "QnU";
    case SlmpDeviceRangeFamily.QnUDV:
      return "QnUDV";
    default:
      throw new ValueError(`Unsupported PLC family: ${family}`);
  }
}

function buildDeviceRangeCatalogForFamily(family, registers) {
  const normalizedFamily = normalizeDeviceRangeFamily(family);
  const profileInfo = PROFILES[normalizedFamily];
  const entries = [];
  for (const item of ORDERED_ITEMS) {
    const row = ROWS[item];
    const spec = profileInfo.rules[item];
    const pointCount = evaluatePointCount(spec, registers);
    const upperBound = pointCount == null || pointCount <= 0 ? null : pointCount - 1;
    const supported = spec.kind !== RANGE_KIND.Unsupported;
    for (const [device, isBitDevice] of row.devices) {
      const notation = resolveNotation(profileInfo.family, device, row.notation);
      entries.push({
        device,
        category: row.category,
        isBitDevice,
        supported,
        lowerBound: 0,
        upperBound,
        pointCount,
        addressRange: formatAddressRange(device, notation, upperBound),
        notation,
        source: spec.source,
        notes: spec.notes,
      });
    }
  }
  return {
    model: familyLabel(normalizedFamily),
    modelCode: 0,
    hasModelCode: false,
    family: normalizedFamily,
    entries,
  };
}

async function readDeviceRangeCatalogForFamily(client, family, options = {}) {
  const normalizedFamily = normalizeDeviceRangeFamily(family);
  const profileInfo = PROFILES[normalizedFamily];
  const values = await client.readDevices(parseDevice(`SD${profileInfo.registerStart}`), profileInfo.registerCount, {
    ...options,
    bitUnit: false,
  });
  const registers = new Map(values.map((value, index) => [profileInfo.registerStart + index, Number(value) & 0xffff]));
  const catalog = buildDeviceRangeCatalogForFamily(normalizedFamily, registers);
  return resolveRuntimeLimits(client, normalizedFamily, catalog, options);
}

async function resolveRuntimeLimits(client, family, catalog, options) {
  if (!ZR_RUNTIME_FAMILIES.has(family)) {
    return catalog;
  }

  let result = catalog;
  if (family === SlmpDeviceRangeFamily.QCpu) {
    const zCount = (await canReadOneWord(client, "Z15", options)) ? 16 : 10;
    result = replaceFixedPointCount(
      result,
      "Z",
      zCount,
      "Runtime access check",
      "QCPU Z register count is selected by probing Z15."
    );
  }

  const zrCount = await resolveReadablePointCount(client, "ZR", options);
  result = replaceFixedPointCount(
    result,
    "ZR",
    zrCount,
    "Runtime access check",
    "ZR register count is selected by probing readable ZR addresses."
  );
  return replaceFixedPointCount(
    result,
    "R",
    Math.min(zrCount, 32768),
    "Runtime access check",
    "R register count follows the probed ZR count and is capped at R32767."
  );
}

async function resolveReadablePointCount(client, device, options) {
  if (!(await canReadOneWord(client, `${device}0`, options))) {
    return 0;
  }

  const upperLimit = MAX_RUNTIME_RANGE_PROBE_COUNT - 1;
  let low = 0;
  let high = 1;
  while (high < upperLimit && (await canReadOneWord(client, `${device}${high}`, options))) {
    low = high;
    high = Math.min(upperLimit, high * 2 + 1);
  }

  if (high === upperLimit && (await canReadOneWord(client, `${device}${high}`, options))) {
    return MAX_RUNTIME_RANGE_PROBE_COUNT;
  }

  let left = low + 1;
  let right = high - 1;
  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2);
    if (await canReadOneWord(client, `${device}${mid}`, options)) {
      low = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return low + 1;
}

async function canReadOneWord(client, address, options) {
  try {
    await client.readDevices(address, 1, { ...options, bitUnit: false });
    return true;
  } catch (error) {
    if (error instanceof SlmpError) {
      return false;
    }
    throw error;
  }
}

function replaceFixedPointCount(catalog, device, pointCount, source, note) {
  const upperBound = pointCount > 0 ? pointCount - 1 : null;
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => {
      if (entry.device !== device) {
        return entry;
      }
      return {
        ...entry,
        upperBound,
        pointCount,
        addressRange: formatAddressRange(entry.device, entry.notation, upperBound),
        source,
        notes: entry.notes ? `${entry.notes} ${note}` : note,
      };
    }),
  };
}

function evaluatePointCount(spec, registers) {
  switch (spec.kind) {
    case RANGE_KIND.Unsupported:
    case RANGE_KIND.Undefined:
      return null;
    case RANGE_KIND.Fixed:
      return spec.fixedValue;
    case RANGE_KIND.WordRegister:
      return readWord(registers, spec.register);
    case RANGE_KIND.DWordRegister:
      return readDword(registers, spec.register);
    case RANGE_KIND.WordRegisterClipped:
      return Math.min(readWord(registers, spec.register), spec.clipValue);
    case RANGE_KIND.DWordRegisterClipped:
      return Math.min(readDword(registers, spec.register), spec.clipValue);
    default:
      throw new ValueError(`Unsupported range kind: ${spec.kind}`);
  }
}

function readWord(registers, register) {
  const value = getRegisterValue(registers, register);
  if (value == null) {
    throw new SlmpError(`Device-range resolver is missing SD${register}.`);
  }
  return Number(value) & 0xffff;
}

function readDword(registers, register) {
  return readWord(registers, register) | (readWord(registers, register + 1) << 16);
}

function getRegisterValue(registers, register) {
  if (registers instanceof Map) {
    return registers.get(register);
  }
  if (registers && Object.prototype.hasOwnProperty.call(registers, register)) {
    return registers[register];
  }
  return undefined;
}

function resolveNotation(family, device, defaultNotation) {
  if (family === SlmpDeviceRangeFamily.IqF && (device === "X" || device === "Y")) {
    return SlmpDeviceRangeNotation.Base8;
  }
  return defaultNotation;
}

function formatAddressRange(device, notation, upperBound) {
  if (upperBound == null) {
    return null;
  }
  if (notation === SlmpDeviceRangeNotation.Base10) {
    return `${device}0-${device}${upperBound}`;
  }
  if (notation === SlmpDeviceRangeNotation.Base8) {
    const width = Math.max(3, upperBound.toString(8).length);
    return `${device}${formatRadix(0, 8, width)}-${device}${formatRadix(upperBound, 8, width)}`;
  }
  const width = Math.max(3, upperBound.toString(16).toUpperCase().length);
  return `${device}${formatRadix(0, 16, width)}-${device}${formatRadix(upperBound, 16, width)}`;
}

function formatRadix(value, radix, width) {
  const text = Number(value).toString(radix).toUpperCase();
  return text.padStart(width, "0");
}

module.exports = {
  SlmpDeviceRangeFamily,
  SlmpDeviceRangeCategory,
  SlmpDeviceRangeNotation,
  normalizeDeviceRangeFamily,
  familyLabel,
  buildDeviceRangeCatalogForFamily,
  readDeviceRangeCatalogForFamily,
};
