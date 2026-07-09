"use strict";

const { SlmpClient, availablePlcProfiles, displayName } = require("../lib/slmp");

const DEFAULT_PORT = 1025;

function parseRequiredInteger(value, name, min, max, fallback) {
  const source = value === undefined || value === null ? fallback : value;
  if (String(source).trim() === "") {
    throw new Error(`slmp-connection ${name} is required`);
  }
  const parsed = Number(source);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`slmp-connection ${name} out of range (${min}..${max}): ${source}`);
  }
  return parsed;
}

module.exports = function registerSlmpConnection(RED) {
  if (RED.httpAdmin && typeof RED.httpAdmin.get === "function") {
    RED.httpAdmin.get("/plc-comm/slmp/profiles", (_request, response) => {
      response.json(availablePlcProfiles().map((name) => ({ name, displayName: displayName(name) })));
    });
  }

  function SlmpConnectionNode(config) {
    RED.nodes.createNode(this, config);

    this.name = config.name;
    this.host = config.host;
    this.port = parseRequiredInteger(config.port, "port", 1, 65535, DEFAULT_PORT);
    this.transport = config.transport || "tcp";
    this.timeout = Number(config.timeout || 3000);
    this.plcProfile = config.plcProfile ? String(config.plcProfile).trim() : "";
    this.strictProfile = config.strictProfile === undefined ? true : config.strictProfile !== false && config.strictProfile !== "false";
    this.monitoringTimer = Number(config.monitoringTimer || 0x0010);
    this.remotePassword = this.credentials && this.credentials.remotePassword ? String(this.credentials.remotePassword) : "";
    this.target = {
      network: config.network,
      station: config.station,
      moduleIO: config.moduleIO,
      multidrop: config.multidrop,
    };

    if (!this.plcProfile) {
      throw new Error("slmp-connection requires plcProfile");
    }

    const clientOptions = {
      host: this.host,
      port: this.port,
      transport: this.transport,
      timeout: this.timeout,
      plcProfile: this.plcProfile,
      strictProfile: this.strictProfile,
      monitoringTimer: this.monitoringTimer,
      defaultTarget: this.target,
      remotePassword: this.remotePassword,
    };

    this.client = new SlmpClient(clientOptions);

    this._setState = (fill, shape, text) => {
      this.status({ fill, shape, text });
    };
    this.getClient = () => this.client;
    this.getProfile = () => ({
      host: this.host,
      port: this.port,
      transport: this.transport,
      plcProfile: this.client.plcProfile,
      strictProfile: this.client.strictProfile,
      frameType: this.client.frameType,
      plcSeries: this.client.plcSeries,
      target: this.client.defaultTarget,
      remotePasswordConfigured: this.remotePassword.length > 0,
    });
    this.connect = async () => {
      this._setState("yellow", "ring", "connecting");
      await this.client.connect();
      this._setState("green", "dot", "connected");
    };
    this.disconnect = async () => {
      this._setState("yellow", "ring", "disconnecting");
      await this.client.close();
      this._setState("red", "ring", "disconnected");
    };
    this.reinitialize = async () => {
      this._setState("yellow", "ring", "reinitializing");
      await this.client.close();
      await this.client.connect();
      this._setState("green", "dot", "connected");
    };

    this._setState("grey", "ring", "ready");

    this.on("close", (_removed, done) => {
      this.client
        .close()
        .catch(() => undefined)
        .finally(() => {
          this._setState("grey", "ring", "closed");
          done();
        });
    });
  }

  RED.nodes.registerType("slmp-connection", SlmpConnectionNode, {
    credentials: {
      remotePassword: { type: "password" },
    },
  });
};
