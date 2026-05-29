"use strict";

const { getEndCodeMessage, getEndCodeName, isRemotePasswordEndCode } = require("./error-codes");

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

module.exports = {
  getEndCodeMessage,
  getEndCodeName,
  isRemotePasswordEndCode,
  SlmpError,
};
