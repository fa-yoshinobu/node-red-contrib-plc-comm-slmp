"use strict";

const {
  SlmpClient,
  normalizeMonitoringTimer,
  normalizePort,
  normalizeTimeout,
  normalizeTransport,
  profileDescriptors,
} = require("../lib/slmp");
const { normalizeDisplayName } = require("./runtime-validation");

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

    this.name = normalizeDisplayName(config.name);
    this.host = config.host;
    this.port = normalizePort(config.port);
    this.transport = normalizeTransport(config.transport);
    this.timeout = Object.prototype.hasOwnProperty.call(config, "timeout") ? normalizeTimeout(config.timeout) : 3000;
    this.plcProfile = config.plcProfile ? String(config.plcProfile).trim() : "";
    if (Object.prototype.hasOwnProperty.call(config, "strict_profile")) {
      throw new Error("strict_profile is not a supported Node-RED connection property; remove it and review the profile selection");
    }
    if (Object.prototype.hasOwnProperty.call(config, "strictProfile") && config.strictProfile !== true) {
      throw new Error("strictProfile is no longer configurable by normal Node-RED flows; remove it and review the profile selection");
    }
    this.monitoringTimer = Object.prototype.hasOwnProperty.call(config, "monitoringTimer")
      ? normalizeMonitoringTimer(config.monitoringTimer)
      : 0x0010;
    if (typeof config.useRemotePassword !== "boolean") {
      throw new Error("slmp-connection useRemotePassword is required and must be a boolean");
    }
    this.useRemotePassword = config.useRemotePassword === true;
    let configuredPassword;
    if (this.useRemotePassword) {
      configuredPassword = this.credentials && this.credentials.remotePassword;
      if (typeof configuredPassword !== "string" || configuredPassword.length === 0) {
        throw new Error("slmp-connection remotePassword is required when useRemotePassword is enabled");
      }
    }
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
    };
    if (this.useRemotePassword) {
      clientOptions.remotePassword = configuredPassword;
    }

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
      try {
        await this.client.close();
      } finally {
        this._setState("red", "ring", "disconnected");
      }
    };
    this.reinitialize = async () => {
      this._setState("yellow", "ring", "reinitializing");
      try {
        await this.client.close();
      } catch (error) {
        this._setState("red", "ring", "disconnected");
        throw error;
      }
      await this.client.connect();
      this._setState("green", "dot", "connected");
    };

    this._setState("grey", "ring", "ready");

    this.on("close", (_removed, done) => {
      this.client
        .close()
        .catch((error) => {
          const endCode = Number.isInteger(error?.endCode)
            ? ` end_code=0x${error.endCode.toString(16).toUpperCase().padStart(4, "0")}`
            : "";
          const message = `SLMP close completed with an authentication or transport error.${endCode}`;
          if (typeof this.warn === "function") {
            this.warn(message);
          } else if (typeof this.error === "function") {
            this.error(message);
          }
        })
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
