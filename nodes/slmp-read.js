"use strict";

const { normalizeAddressList, normalizeTarget, readNamed } = require("../lib/slmp");

module.exports = function registerSlmpRead(RED) {
  function SlmpReadNode(config) {
    RED.nodes.createNode(this, config);

    this.name = config.name;
    this.connection = RED.nodes.getNode(config.connection);
    this.addresses = config.addresses || "";
    this.addressesType = config.addressesType || "str";
    this.routeTarget = config.routeTarget || "";
    this.routeTargetType = config.routeTargetType || "str";
    this.outputMode = config.outputMode || "object";
    this.errorHandling = config.errorHandling || "throw";
    this.metadataMode = normalizeMetadataMode(config.metadataMode);
    this.outputs = this.errorHandling === "output2" ? 2 : 1;

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
        const addresses = await resolveAddresses(RED, this, msg);
        const target = await resolveTarget(RED, this, msg);
        if (addresses.length === 0) {
          throw new Error("No SLMP addresses were provided");
        }

        const client = this.connection.getClient();
        const snapshot = await readNamed(client, addresses, target ? { target } : {});
        const profile = this.connection.getProfile();
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
  if (Array.isArray(msg.addresses) || typeof msg.addresses === "string") {
    return normalizeAddressList(msg.addresses);
  }
  if (Array.isArray(msg.payload) || typeof msg.payload === "string") {
    return normalizeAddressList(msg.payload);
  }
  const configured = await evaluateConfiguredValue(RED, node, msg, node.addresses, node.addressesType, "addresses");
  return normalizeAddressList(configured);
}

async function resolveTarget(RED, node, msg) {
  if (isPlainObject(msg.target)) {
    return normalizeTarget(msg.target);
  }
  if (isPlainObject(msg.slmp && msg.slmp.target)) {
    return normalizeTarget(msg.slmp.target);
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

function normalizeMetadataMode(value) {
  const normalized = String(value || "full").trim().toLowerCase();
  if (normalized === "minimal" || normalized === "off") {
    return normalized;
  }
  return "full";
}

function applyMetadata(msg, mode, metadata) {
  const normalizedMode = normalizeMetadataMode(mode);
  if (normalizedMode === "off") {
    return;
  }
  if (normalizedMode === "minimal") {
    msg.slmp = buildMinimalMetadata(msg.slmp, metadata);
    return;
  }
  msg.slmp = {
    ...(isPlainObject(msg.slmp) ? msg.slmp : {}),
    addresses: metadata.addresses,
    connection: metadata.connection,
    target: metadata.target,
  };
}

function buildMinimalMetadata(existing, metadata) {
  const next = isPlainObject(existing) ? { ...existing } : {};
  delete next.addresses;
  delete next.updates;
  delete next.connection;
  next.target = metadata.target;
  next.itemCount = metadata.itemCount;
  next.metadataMode = "minimal";
  return next;
}

function formatPayload(snapshot, addresses, outputMode) {
  if (outputMode === "array") {
    return addresses.map((address) => snapshot[address]);
  }
  if (outputMode === "value" && addresses.length === 1) {
    return snapshot[addresses[0]];
  }
  return snapshot;
}
