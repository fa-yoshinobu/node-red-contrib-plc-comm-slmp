"use strict";

const { SlmpClient } = require("../lib/slmp");

module.exports = function registerSlmpConnection(RED) {
  function SlmpConnectionNode(config) {
    RED.nodes.createNode(this, config);

    this.name = config.name;
    this.host = config.host;
    this.port = Number(config.port || 5000);
    this.transport = config.transport || "tcp";
    this.timeout = Number(config.timeout || 3000);
    this.plcFamily = config.plcFamily ? String(config.plcFamily).trim() : "";
    this.monitoringTimer = Number(config.monitoringTimer || 0x0010);
    this.target = {
      network: config.network,
      station: config.station,
      moduleIO: config.moduleIO,
      multidrop: config.multidrop,
    };

    if (!this.plcFamily) {
      throw new Error("slmp-connection requires plcFamily");
    }

    const clientOptions = {
      host: this.host,
      port: this.port,
      transport: this.transport,
      timeout: this.timeout,
      plcFamily: this.plcFamily,
      monitoringTimer: this.monitoringTimer,
      defaultTarget: this.target,
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
      plcFamily: this.client.plcFamily,
      frameType: this.client.frameType,
      plcSeries: this.client.plcSeries,
      target: this.client.defaultTarget,
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

  RED.nodes.registerType("slmp-connection", SlmpConnectionNode);
};
