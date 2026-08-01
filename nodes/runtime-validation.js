"use strict";

const SOURCE_TYPES = Object.freeze(["str", "msg", "flow", "global", "env"]);
const { normalizeTarget } = require("../lib/slmp");

function hasOwn(value, key) {
  return value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(value, key);
}

function requireEnum(config, key, allowed) {
  const value = config[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${key} is required and must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function requireSourceType(config, key) {
  return requireEnum(config, key, SOURCE_TYPES);
}

function validateOutputs(config, errorHandling) {
  const expected = errorHandling === "output2" ? 2 : 1;
  if (hasOwn(config, "outputs") && config.outputs !== expected) {
    throw new Error(`outputs=${config.outputs} conflicts with errorHandling=${errorHandling}; review the node wiring and save it again`);
  }
  return expected;
}

function normalizeDisplayName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseConfiguredRouteInteger(value, name, radix, min, max) {
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const text = value.trim();
    const pattern = radix === 16 ? /^(?:0x)?[0-9a-f]+$/i : /^[0-9]+$/;
    if (!pattern.test(text)) {
      throw new Error(`${name} must be a complete base-${radix} integer`);
    }
    parsed = Number.parseInt(radix === 16 ? text.replace(/^0x/i, "") : text, radix);
  } else {
    throw new Error(`${name} must be a primitive number or configuration string`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} out of range (${min}..${max}): ${String(value)}`);
  }
  return parsed;
}

function normalizeConfiguredRouteTarget(value) {
  let source = value;
  if (typeof source === "string") {
    const text = source.trim();
    if (!text) throw new Error("Routing target must not be empty");
    try {
      source = JSON.parse(text);
    } catch (error) {
      throw new Error(`Unable to parse target: ${error.message}`);
    }
  }
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Routing target must be an object");
  }
  const hasModuleIO = Object.prototype.hasOwnProperty.call(source, "moduleIO");
  const hasModuleIOAlias = Object.prototype.hasOwnProperty.call(source, "module_io");
  const allowed = new Set(["network", "station", "moduleIO", "module_io", "multidrop"]);
  for (const field of Object.keys(source)) {
    if (!allowed.has(field)) throw new Error(`target contains an unexpected field: ${field}`);
  }
  if (hasModuleIO === hasModuleIOAlias) {
    throw new Error("target must specify exactly one of moduleIO or module_io");
  }
  for (const field of ["network", "station", "multidrop"]) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      throw new Error(`target.${field} is required`);
    }
  }
  return normalizeTarget({
    network: parseConfiguredRouteInteger(source.network, "target.network", 10, 0, 0xff),
    station: parseConfiguredRouteInteger(source.station, "target.station", 10, 0, 0xff),
    moduleIO: parseConfiguredRouteInteger(
      hasModuleIO ? source.moduleIO : source.module_io,
      "target.moduleIO",
      16,
      0,
      0xffff
    ),
    multidrop: parseConfiguredRouteInteger(source.multidrop, "target.multidrop", 10, 0, 0xff),
  });
}

module.exports = {
  hasOwn,
  normalizeConfiguredRouteTarget,
  normalizeDisplayName,
  requireEnum,
  requireSourceType,
  validateOutputs,
};
