"use strict";

class SlmpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SlmpError";
    if (options.endCode !== undefined) {
      this.endCode = options.endCode;
    }
    if (options.data !== undefined) {
      this.data = options.data;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

module.exports = {
  SlmpError,
};
