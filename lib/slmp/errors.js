"use strict";

const { getEndCodeMessage, getEndCodeName, isRemotePasswordEndCode } = require("./error-codes");

function parseSlmpErrorInfo(data) {
  if (data === undefined || data === null) {
    return undefined;
  }
  const buffer = Buffer.from(data);
  if (buffer.length < 9) {
    return undefined;
  }
  const raw = Buffer.from(buffer.subarray(0, 9));
  return {
    network: raw.readUInt8(0),
    station: raw.readUInt8(1),
    moduleIO: raw.readUInt16LE(2),
    multidrop: raw.readUInt8(4),
    command: raw.readUInt16LE(5),
    subcommand: raw.readUInt16LE(7),
    raw,
  };
}

class SlmpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SlmpError";
    if (options.endCode !== undefined) {
      this.endCode = options.endCode;
    }
    if (options.command !== undefined) {
      this.command = options.command;
    }
    if (options.subcommand !== undefined) {
      this.subcommand = options.subcommand;
    }
    if (options.rawMessage !== undefined) {
      this.rawMessage = options.rawMessage;
    }
    if (options.data !== undefined) {
      this.data = options.data;
    }
    const errorInfo = options.errorInfo !== undefined ? options.errorInfo : parseSlmpErrorInfo(options.data);
    if (errorInfo !== undefined) {
      this.errorInfo = errorInfo;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  get endCodeName() {
    return this.endCode === undefined ? undefined : getEndCodeName(this.endCode);
  }

  get endCodeMessage() {
    return this.endCode === undefined ? undefined : getEndCodeMessage(this.endCode);
  }

  get isRemotePasswordError() {
    return this.endCode !== undefined && isRemotePasswordEndCode(this.endCode);
  }
}

class SlmpProfileFeatureError extends Error {
  constructor({ profileId, featureKey, state, evidence, disableHint } = {}) {
    const hint = disableHint || "Set strictProfile=false to send the request anyway.";
    const evidenceText = evidence ? ` Evidence: ${evidence}.` : "";
    super(
      `Feature '${featureKey}' is ${state} for plcProfile '${profileId}'.${evidenceText} ${hint}`
    );
    this.name = "SlmpProfileFeatureError";
    this.code = "SLMP_PROFILE_FEATURE";
    this.profileId = profileId;
    this.featureKey = featureKey;
    this.state = state;
    this.evidence = evidence;
    this.disableHint = hint;
  }
}

module.exports = {
  getEndCodeMessage,
  getEndCodeName,
  isRemotePasswordEndCode,
  parseSlmpErrorInfo,
  SlmpError,
  SlmpProfileFeatureError,
};
