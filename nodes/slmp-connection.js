"use strict";

const {
  SlmpClient,
  normalizeMonitoringTimer,
  normalizePort,
  normalizeTimeout,
  normalizeTransport,
  profileDescriptors,
} = require("../lib/slmp");

module.exports = function registerSlmpConnection(RED) {
  if (RED.httpAdmin && typeof RED.httpAdmin.get === "function") {
    const needsPermission =
      RED.auth && typeof RED.auth.needsPermission === "function"
        ? RED.auth.needsPermission("flows.read")
        : (_request, _response, next) => next();
    RED.httpAdmin.get(
      "/plc-comm/slmp/profiles",
      needsPermission,
      (_request, response) => {
        response.json(profileDescriptors());
      },
    );
  }

  function SlmpConnectionNode(config) {
    RED.nodes.createNode(this, config);

    this.name = typeof config.name === "string" ? config.name.trim() : "";
    this.host = config.host;
    this.port = normalizePort(config.port);
    this.transport = normalizeTransport(config.transport);
    this.timeout = Object.prototype.hasOwnProperty.call(config, "timeout") ? normalizeTimeout(config.timeout) : 3000;
    this.plcProfile = config.plcProfile ? String(config.plcProfile).trim() : "";
    if (config.strictProfile === false || config.strictProfile === "false" || config.strictProfile === 0 || config.strictProfile === "0") {
      throw new Error("strictProfile=false is no longer supported by normal Node-RED flows; remove it and review the profile selection");
    }
    this.monitoringTimer = Object.prototype.hasOwnProperty.call(config, "monitoringTimer")
      ? normalizeMonitoringTimer(config.monitoringTimer)
      : 0x0010;
    if (typeof config.useRemotePassword !== "boolean") {
      throw new Error("slmp-connection useRemotePassword is required and must be a boolean");
    }
    this.useRemotePassword = config.useRemotePassword === true;
    const configuredPassword = this.credentials && this.credentials.remotePassword != null
      ? String(this.credentials.remotePassword)
      : "";
    if (this.useRemotePassword && configuredPassword.length === 0) {
      throw new Error("slmp-connection remotePassword is required when useRemotePassword is enabled");
    }
    this.remotePassword = this.useRemotePassword ? configuredPassword : "";
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
      frameType: this.client.frameType,
      plcSeries: this.client.plcSeries,
      target: this.client.defaultTarget,
      remotePasswordConfigured: this.useRemotePassword,
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
