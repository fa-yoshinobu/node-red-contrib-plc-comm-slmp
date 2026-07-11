"use strict";

const { normalizeAddress, normalizeTarget, writeNamed } = require("../lib/slmp");
const { hasOwn, normalizeDisplayName, requireEnum, requireSourceType, validateOutputs } = require("./runtime-validation");
const SINGLE_WRITE_DTYPES = new Set(["BIT", "U", "S", "D", "L", "F", "STR"]);

module.exports = function registerSlmpWrite(RED) {
  function SlmpWriteNode(config) {
    RED.nodes.createNode(this, config);

    this.name = normalizeDisplayName(config.name);
    this.connection = RED.nodes.getNode(config.connection);
    this.updates = config.updates || "";
    this.updatesType = requireSourceType(config, "updatesType");
    this.routeTarget = config.routeTarget || "";
    this.routeTargetType = this.routeTarget === "" ? config.routeTargetType : requireSourceType(config, "routeTargetType");
    this.errorHandling = requireEnum(config, "errorHandling", ["throw", "msg", "output2"]);
    this.metadataMode = requireEnum(config, "metadataMode", ["full", "minimal", "off"]);
    this.outputs = validateOutputs(config, this.errorHandling);

    this.on("input", async (msg, send, done) => {
      send = send || ((message) => this.send(message));

      if (!this.connection) {
        fail(this, msg, send, done, new Error("SLMP connection config is missing"));
        return;
      }

      try {
        const controlAction = getControlAction(msg);
        if (controlAction) {
          this.status({ fill: "yellow", shape: "ring", text: controlAction });
          await this.connection[controlAction]();
          this.status({ fill: controlAction === "disconnect" ? "red" : "green", shape: "dot", text: controlAction });
          done();
          return;
        }

        this.status({ fill: "blue", shape: "dot", text: "writing" });
        const profile = this.connection.getProfile();
        const updates = validateUpdatesForConnection(await resolveUpdates(RED, this, msg), profile);
        const target = await resolveTarget(RED, this, msg);
        const keys = Object.keys(updates);
        if (keys.length === 0) {
          throw new Error("No SLMP updates were provided");
        }

        const client = this.connection.getClient();
        await writeNamed(client, updates, target ? { target } : {});
        applyMetadata(msg, this.metadataMode, {
          updates,
          connection: profile,
          target: target || profile.target,
          itemCount: keys.length,
        });
        this.status({ fill: "green", shape: "dot", text: `${keys.length} item(s)` });
        send(msg);
        done();
      } catch (error) {
        fail(this, msg, send, done, error);
      }
    });
  }

  RED.nodes.registerType("slmp-write", SlmpWriteNode);
};

async function resolveUpdates(RED, node, msg) {
  const hasUpdates = hasOwn(msg, "updates");
  const hasAddress = hasOwn(msg, "address");
  const hasValue = hasOwn(msg, "value");
  const hasDtype = hasOwn(msg, "dtype");
  if (hasUpdates && hasAddress) {
    throw new Error("msg.updates and msg.address are mutually exclusive");
  }
  if (hasUpdates) {
    const updates = normalizeUpdatesSource(msg.updates, "msg.updates");
    if (Object.keys(updates).length === 0) {
      throw new Error("msg.updates must not be empty");
    }
    if (hasValue || hasDtype) {
      throw new Error("msg.value and msg.dtype may only be used with msg.address");
    }
    return updates;
  }
  if (hasAddress) {
    if (typeof msg.address !== "string" || !msg.address.trim()) {
      throw new Error("msg.address must be a non-empty string");
    }
    if (!hasValue) {
      throw new Error("msg.value is required when msg.address is used");
    }
    return {
      [withDtype(msg.address, msg.dtype)]: msg.value,
    };
  }
  if (hasValue || hasDtype) {
    throw new Error("msg.value and msg.dtype require msg.address");
  }
  const configured = await evaluateConfiguredValue(RED, node, msg, node.updates, node.updatesType, "updates");
  return normalizeUpdatesSource(configured);
}

async function resolveTarget(RED, node, msg) {
  if (hasOwn(msg, "target")) {
    if (!isPlainObject(msg.target)) {
      throw new Error("msg.target must be a complete routing object");
    }
    return normalizeTarget(msg.target);
  }
  if (isPlainObject(msg.slmp) && hasOwn(msg.slmp, "target")) {
    if (!isPlainObject(msg.slmp.target)) {
      throw new Error("msg.slmp.target must be a complete routing object");
    }
    return normalizeTarget(msg.slmp.target);
  }
  if (node.routeTarget === "") {
    return undefined;
  }
  const configured = await evaluateConfiguredValue(RED, node, msg, node.routeTarget, node.routeTargetType, "target");
  return normalizeTargetSource(configured);
}

function withDtype(address, dtype) {
  const trimmed = String(address).trim();
  const embedded = trimmed.includes(":") || trimmed.includes(".") || /^[A-Z]+STR[0-9A-F]+\s*,\s*\d+$/i.test(trimmed);
  const hasDtype = dtype !== undefined;
  if (embedded && hasDtype) {
    throw new Error("dtype must be specified exactly once: either in msg.address or msg.dtype");
  }
  if (embedded) {
    return trimmed;
  }
  if (!hasDtype || typeof dtype !== "string" || !SINGLE_WRITE_DTYPES.has(dtype)) {
    throw new Error("msg.dtype is required for a bare address and must be exactly BIT, U, S, D, L, F, or STR");
  }
  const normalizedDtype = dtype;
  const countMatch = /^(.*?)(,\s*\d+)$/.exec(trimmed);
  if (countMatch) {
    return `${countMatch[1]}:${normalizedDtype}${countMatch[2]}`;
  }
  return `${trimmed}:${normalizedDtype}`;
}

function evaluateConfiguredValue(RED, node, msg, value, type, label) {
  if (!RED.util || typeof RED.util.evaluateNodeProperty !== "function" || !type || type === "str") {
    return Promise.resolve(value);
  }
  return new Promise((resolve, reject) => {
    RED.util.evaluateNodeProperty(value, type, node, msg, (error, resolved) => {
      if (error) {
        reject(new Error(`Unable to evaluate ${label}`));
        return;
      }
      resolve(resolved);
    });
  });
}

function normalizeUpdatesSource(value, label = "updates") {
  if (isPlainObject(value)) {
    return value;
  }
  if (typeof value === "string") {
    return parseConfiguredUpdates(value);
  }
  throw new Error(`${label} must be a JSON object or JSON object string`);
}

function normalizeTargetSource(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        throw new Error("Routing target must be an object");
      }
      return normalizeTarget(parsed);
    } catch (error) {
      throw new Error(`Unable to parse target: ${error.message}`);
    }
  }
  if (!isPlainObject(value)) {
    throw new Error("Routing target must be an object");
  }
  return normalizeTarget(value);
}

function parseConfiguredUpdates(value) {
  const text = String(value || "").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed)) {
      return parsed;
    }
    throw new Error("Static updates must be a JSON object");
  } catch (error) {
    throw new Error(`Unable to parse updates JSON: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUpdateSource(value) {
  return isPlainObject(value) || typeof value === "string";
}

function applyMetadata(msg, mode, metadata) {
  if (mode === "off") {
    return;
  }
  if (mode === "minimal") {
    msg.slmp = buildMinimalMetadata(msg.slmp, metadata);
    return;
  }
  const next = clearOwnedMetadata(msg.slmp);
  msg.slmp = {
    ...next,
    operation: "write",
    metadataMode: "full",
    itemCount: metadata.itemCount,
    updates: metadata.updates,
    connection: metadata.connection,
    target: metadata.target,
  };
}

function buildMinimalMetadata(existing, metadata) {
  const next = clearOwnedMetadata(existing);
  next.operation = "write";
  next.target = metadata.target;
  next.itemCount = metadata.itemCount;
  next.metadataMode = "minimal";
  return next;
}

function clearOwnedMetadata(existing) {
  const next = isPlainObject(existing) ? { ...existing } : {};
  for (const key of ["addresses", "updates", "connection", "target", "itemCount", "metadataMode", "operation"]) {
    delete next[key];
  }
  return next;
}

function fail(node, msg, send, done, error) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  node.status({ fill: "red", shape: "ring", text: normalized.message });
  if (node.errorHandling === "msg") {
    msg.error = normalized;
    send(msg);
    done();
    return;
  }
  if (node.errorHandling === "output2") {
    send([null, { ...msg, error: normalized }]);
    done();
    return;
  }
  done(normalized);
}

function validateUpdatesForConnection(updates, profile) {
  const options = profile && profile.plcProfile ? { plcProfile: profile.plcProfile } : {};
  const normalized = {};
  for (const [address, value] of Object.entries(updates || {})) {
    normalized[normalizeAddress(address, options)] = value;
  }
  return normalized;
}

function getControlAction(msg) {
  if (msg.disconnect === true || String(msg.topic || "").toLowerCase() === "disconnect") {
    return "disconnect";
  }
  if (msg.connect === true || String(msg.topic || "").toLowerCase() === "connect") {
    return "connect";
  }
  if (msg.reinitialize === true || String(msg.topic || "").toLowerCase() === "reinitialize") {
    return "reinitialize";
  }
  return null;
}
