"use strict";

const { normalizeAddress, normalizeAddressList, normalizeTarget, readNamed } = require("../lib/slmp");
const { hasOwn, normalizeDisplayName, requireEnum, requireSourceType, validateOutputs } = require("./runtime-validation");

module.exports = function registerSlmpRead(RED) {
  function SlmpReadNode(config) {
    RED.nodes.createNode(this, config);

    this.name = normalizeDisplayName(config.name);
    this.connection = RED.nodes.getNode(config.connection);
    this.addresses = config.addresses || "";
    this.addressesType = requireSourceType(config, "addressesType");
    this.routeTarget = config.routeTarget || "";
    this.routeTargetType = this.routeTarget === "" ? config.routeTargetType : requireSourceType(config, "routeTargetType");
    this.outputMode = requireEnum(config, "outputMode", ["object", "array", "value"]);
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

        this.status({ fill: "blue", shape: "dot", text: "reading" });
        const profile = this.connection.getProfile();
        const addresses = validateAddressesForConnection(await resolveAddresses(RED, this, msg), profile);
        const target = await resolveTarget(RED, this, msg);
        if (addresses.length === 0) {
          throw new Error("No SLMP addresses were provided");
        }
        if (this.outputMode === "value" && addresses.length !== 1) {
          throw new Error("outputMode=value requires exactly one address");
        }

        const client = this.connection.getClient();
        const snapshot = await readNamed(client, addresses, target ? { target } : {});
        msg.payload = formatPayload(snapshot, addresses, this.outputMode);
        applyMetadata(msg, this.metadataMode, {
          addresses,
          connection: profile,
          target: target || profile.target,
          itemCount: addresses.length,
        });
        this.status({ fill: "green", shape: "dot", text: `${addresses.length} item(s)` });
        send(msg);
        done();
      } catch (error) {
        fail(this, msg, send, done, error);
      }
    });
  }

  RED.nodes.registerType("slmp-read", SlmpReadNode);
};

async function resolveAddresses(RED, node, msg) {
  if (hasOwn(msg, "addresses")) {
    if (!Array.isArray(msg.addresses) && typeof msg.addresses !== "string") {
      throw new Error("msg.addresses must be a non-empty string or array");
    }
    const addresses = normalizeAddressList(msg.addresses);
    if (addresses.length === 0) {
      throw new Error("msg.addresses must not be empty");
    }
    return addresses;
  }
  const configured = await evaluateConfiguredValue(RED, node, msg, node.addresses, node.addressesType, "addresses");
  return normalizeAddressList(configured);
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

function validateAddressesForConnection(addresses, profile) {
  const options = profile && profile.plcProfile ? { plcProfile: profile.plcProfile } : {};
  return addresses.map((address) => normalizeAddress(address, options));
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    operation: "read",
    metadataMode: "full",
    itemCount: metadata.itemCount,
    addresses: metadata.addresses,
    connection: metadata.connection,
    target: metadata.target,
  };
}

function buildMinimalMetadata(existing, metadata) {
  const next = clearOwnedMetadata(existing);
  next.operation = "read";
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

function formatPayload(snapshot, addresses, outputMode) {
  if (outputMode === "array") {
    return addresses.map((address) => snapshot[address]);
  }
  if (outputMode === "value") {
    return snapshot[addresses[0]];
  }
  return snapshot;
}
