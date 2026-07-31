"use strict";

const net = require("net");

const { ValueError } = require("./core");

function normalizeIpv4Host(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValueError("host is required and must be an IPv4 address or hostname");
  }
  const normalized = value.trim();
  const literalText = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
  const family = net.isIP(literalText);
  if (family === 6) {
    throw new ValueError("host must be an IPv4 address or a hostname that resolves to IPv4; IPv6 is unsupported");
  }
  return family === 4 ? literalText : normalized;
}

module.exports = { normalizeIpv4Host };
