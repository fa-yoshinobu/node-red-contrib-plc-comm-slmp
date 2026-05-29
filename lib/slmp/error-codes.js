"use strict";

const END_CODE_MESSAGES_EN = require("./lang/slmp-end-code-messages-en.json");

const REMOTE_PASSWORD_END_CODES = new Set([
  0xc200,
  0xc201,
  0xc202,
  0xc203,
  0xc204,
  0xc205,
  0xc810,
  0xc811,
  0xc812,
  0xc813,
  0xc814,
  0xc815,
  0xc816,
]);

function normalizeEndCode(endCode) {
  if (!Number.isInteger(endCode)) {
    return null;
  }
  return endCode & 0xffff;
}

function formatEndCodeHex(endCode) {
  const normalized = normalizeEndCode(endCode);
  return normalized == null ? null : `0x${normalized.toString(16).toUpperCase().padStart(4, "0")}`;
}

function getEndCodeName(endCode) {
  const hex = formatEndCodeHex(endCode);
  if (hex == null || END_CODE_MESSAGES_EN[hex] === undefined) {
    return "unknown_plc_end_code";
  }
  return `slmp_end_code_${hex.slice(2).toLowerCase()}`;
}

function getEndCodeMessage(endCode) {
  const hex = formatEndCodeHex(endCode);
  return hex == null ? undefined : END_CODE_MESSAGES_EN[hex];
}

function isRemotePasswordEndCode(endCode) {
  const normalized = normalizeEndCode(endCode);
  return normalized != null && REMOTE_PASSWORD_END_CODES.has(normalized);
}

module.exports = {
  formatEndCodeHex,
  getEndCodeMessage,
  getEndCodeName,
  isRemotePasswordEndCode,
};
