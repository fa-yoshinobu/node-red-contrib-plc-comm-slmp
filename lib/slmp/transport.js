"use strict";

const dgram = require("dgram");
const net = require("net");

const { FrameType } = require("./constants");
const { extractFrameFromBuffer } = require("./core");
const { SlmpError } = require("./errors");

class SlmpTransport {
  constructor(options) {
    this.host = options.host;
    this.port = options.port;
    this.transportType = options.transportType;
    this.frameType = options.frameType;
    this.timeout = options.timeout;

    this._serial = 0;
    this._tcpSocket = null;
    this._tcpConnectPromise = null;
    this._tcpBuffer = Buffer.alloc(0);
    this._tcpPending = null;
    this._tcpPendingBySerial = new Map();
    this._udpSocket = null;
    this._udpConnectPromise = null;
    this._udpPending = null;
    this._udpPendingBySerial = new Map();
  }

  connect() {
    if (this.transportType === "tcp") {
      return this._connectTcp();
    }
    return this._connectUdp();
  }

  async close() {
    const pending = [];
    if (this._tcpSocket) {
      pending.push(
        new Promise((resolve) => {
          const socket = this._tcpSocket;
          this._tcpSocket = null;
          this._tcpConnectPromise = null;
          this._rejectTcpPending(new SlmpError("TCP connection closed"));
          socket.once("close", resolve);
          socket.destroy();
        })
      );
    }
    if (this._udpSocket) {
      pending.push(
        new Promise((resolve) => {
          const socket = this._udpSocket;
          this._udpSocket = null;
          this._udpConnectPromise = null;
          this._rejectUdpPending(new SlmpError("UDP socket closed"));
          socket.once("close", resolve);
          socket.close();
        })
      );
    }
    await Promise.allSettled(pending);
  }

  hasOpenTransport() {
    if (this.transportType === "tcp") {
      return Boolean(this._tcpSocket && !this._tcpSocket.destroyed);
    }
    return Boolean(this._udpSocket);
  }

  nextSerial() {
    if (this.frameType !== FrameType.FRAME_4E) {
      const serial = this._serial;
      this._serial = (this._serial + 1) & 0xffff;
      return serial;
    }

    for (let attempt = 0; attempt <= 0xffff; attempt += 1) {
      const serial = this._serial;
      this._serial = (this._serial + 1) & 0xffff;
      if (!this._tcpPendingBySerial.has(serial) && !this._udpPendingBySerial.has(serial)) {
        return serial;
      }
    }

    throw new SlmpError("no free 4E serial values are available");
  }

  async sendOnly(frame) {
    if (this.transportType === "tcp") {
      if (!this._tcpSocket) {
        throw new SlmpError("TCP socket is not connected");
      }
      await new Promise((resolve, reject) => {
        this._tcpSocket.write(frame, (error) => {
          if (error) {
            reject(new SlmpError(`TCP write failed: ${error.message}`, { cause: error }));
            return;
          }
          resolve();
        });
      });
      return;
    }

    await new Promise((resolve, reject) => {
      if (!this._udpSocket) {
        reject(new SlmpError("UDP socket is not connected"));
        return;
      }
      this._udpSocket.send(frame, (error) => {
        if (error) {
          reject(new SlmpError(`UDP send failed: ${error.message}`, { cause: error }));
          return;
        }
        resolve();
      });
    });
  }

  async sendAndReceive(frame, serial) {
    if (this.transportType === "tcp") {
      if (!this._tcpSocket) {
        throw new SlmpError("TCP socket is not connected");
      }
      const responsePromise = this.awaitTcpFrame(serial);
      try {
        await new Promise((resolve, reject) => {
          this._tcpSocket.write(frame, (error) => {
            if (error) {
              reject(new SlmpError(`TCP write failed: ${error.message}`, { cause: error }));
              return;
            }
            resolve();
          });
        });
      } catch (error) {
        this._failTcpAndDestroy(error);
        await responsePromise.catch(() => undefined);
        throw error;
      }
      return responsePromise;
    }
    return this.sendUdp(frame, serial);
  }

  _connectTcp() {
    if (this._tcpSocket && !this._tcpSocket.destroyed) {
      return Promise.resolve();
    }
    if (this._tcpConnectPromise) {
      return this._tcpConnectPromise;
    }

    this._tcpConnectPromise = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new SlmpError(`TCP connection timed out to ${this.host}:${this.port}`));
        }
      }, this.timeout);

      const finalizeResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        this._tcpSocket = socket;
        this._tcpBuffer = Buffer.alloc(0);
        socket.setNoDelay(true);
        socket.on("data", (chunk) => this.handleTcpData(chunk));
        socket.on("error", (error) => this.handleTcpFailure(error));
        socket.on("close", () => this.handleTcpFailure(new SlmpError("TCP connection closed")));
        resolve();
      };

      const finalizeReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        reject(new SlmpError(`TCP connection failed: ${error.message}`, { cause: error }));
      };

      socket.once("connect", finalizeResolve);
      socket.once("error", finalizeReject);
    }).finally(() => {
      this._tcpConnectPromise = null;
    });

    return this._tcpConnectPromise;
  }

  _connectUdp() {
    if (this._udpSocket) {
      return Promise.resolve();
    }
    if (this._udpConnectPromise) {
      return this._udpConnectPromise;
    }

    this._udpConnectPromise = new Promise((resolve, reject) => {
      const family = net.isIP(this.host) === 6 ? "udp6" : "udp4";
      const socket = dgram.createSocket(family);
      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new SlmpError(`UDP connect timed out for ${this.host}:${this.port}`));
        }
      }, this.timeout);

      socket.once("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          reject(new SlmpError(`UDP connection failed: ${error.message}`, { cause: error }));
          return;
        }
        this.handleUdpFailure(error);
      });

      socket.connect(this.port, this.host, () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        this._udpSocket = socket;
        socket.on("error", (error) => this.handleUdpFailure(error));
        socket.on("message", (message) => this.handleUdpMessage(message));
        resolve();
      });
    }).finally(() => {
      this._udpConnectPromise = null;
    });

    return this._udpConnectPromise;
  }

  handleTcpData(chunk) {
    this._tcpBuffer = Buffer.concat([this._tcpBuffer, Buffer.from(chunk)]);
    while (true) {
      const extracted = extractFrameFromBuffer(this._tcpBuffer, { frameType: this.frameType });
      if (!extracted) {
        return;
      }
      this._tcpBuffer = Buffer.from(extracted.rest);
      const frame = Buffer.from(extracted.frame);
      if (this.frameType === FrameType.FRAME_4E) {
        const serial = readResponseSerial(frame);
        const pending = this._tcpPendingBySerial.get(serial);
        if (pending) {
          this._tcpPendingBySerial.delete(serial);
          clearTimeout(pending.timeoutHandle);
          pending.resolve(frame);
          continue;
        }
        continue;
      }

      if (this._tcpPending) {
        const pending = this._tcpPending;
        this._tcpPending = null;
        clearTimeout(pending.timeoutHandle);
        pending.resolve(frame);
      } else {
        // A frame without a waiter is stale or unsolicited. Never carry it into a later request.
      }
    }
  }

  awaitTcpFrame(serial) {
    if (this.frameType === FrameType.FRAME_4E) {
      if (this._tcpPendingBySerial.has(serial)) {
        return Promise.reject(new SlmpError(`another TCP request is already waiting for serial ${serial}`));
      }
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._failTcpAndDestroy(new SlmpError("TCP communication timeout"));
        }, this.timeout);
        this._tcpPendingBySerial.set(serial, { resolve, reject, timeoutHandle });
      });
    }

    if (this._tcpPending) {
      return Promise.reject(new SlmpError("another TCP request is already waiting for a response"));
    }
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._failTcpAndDestroy(new SlmpError("TCP communication timeout"));
      }, this.timeout);
      this._tcpPending = { resolve, reject, timeoutHandle };
    });
  }

  handleTcpFailure(error) {
    this._tcpSocket = null;
    this._tcpBuffer = Buffer.alloc(0);
    this._rejectTcpPending(
      error instanceof SlmpError ? error : new SlmpError(`TCP transport failure: ${error.message}`, { cause: error })
    );
  }

  _failTcpAndDestroy(error) {
    const socket = this._tcpSocket;
    this.handleTcpFailure(error);
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  }

  _rejectTcpPending(error) {
    if (this._tcpPending) {
      const pending = this._tcpPending;
      this._tcpPending = null;
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    for (const [serial, pending] of this._tcpPendingBySerial.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
      this._tcpPendingBySerial.delete(serial);
    }
  }

  sendUdp(frame, serial) {
    return new Promise((resolve, reject) => {
      if (!this._udpSocket) {
        reject(new SlmpError("UDP socket is not connected"));
        return;
      }

      if (this.frameType === FrameType.FRAME_4E) {
        if (this._udpPendingBySerial.has(serial)) {
          reject(new SlmpError(`another UDP request is already waiting for serial ${serial}`));
          return;
        }
      } else if (this._udpPending) {
        reject(new SlmpError("another UDP request is already waiting for a response"));
        return;
      }

      const socket = this._udpSocket;
      const timeoutHandle = setTimeout(() => {
        if (this.frameType === FrameType.FRAME_4E) {
          const pending = this._udpPendingBySerial.get(serial);
          if (!pending) {
            return;
          }
          this._udpPendingBySerial.delete(serial);
          reject(new SlmpError("UDP communication timeout"));
          return;
        }
        if (!this._udpPending) {
          return;
        }
        this._udpPending = null;
        reject(new SlmpError("UDP communication timeout"));
      }, this.timeout);

      if (this.frameType === FrameType.FRAME_4E) {
        this._udpPendingBySerial.set(serial, { resolve, reject, timeoutHandle });
      } else {
        this._udpPending = { resolve, reject, timeoutHandle };
      }

      socket.send(frame, (error) => {
        if (!error) {
          return;
        }
        if (this.frameType === FrameType.FRAME_4E) {
          if (this._udpPendingBySerial.has(serial)) {
            this._udpPendingBySerial.delete(serial);
            clearTimeout(timeoutHandle);
          }
        } else if (this._udpPending) {
          this._udpPending = null;
          clearTimeout(timeoutHandle);
        }
        reject(new SlmpError(`UDP send failed: ${error.message}`, { cause: error }));
      });
    });
  }

  handleUdpMessage(message) {
    if (this.frameType === FrameType.FRAME_4E) {
      const serial = readResponseSerial(message);
      const pending = this._udpPendingBySerial.get(serial);
      if (!pending) {
        return;
      }
      this._udpPendingBySerial.delete(serial);
      clearTimeout(pending.timeoutHandle);
      pending.resolve(Buffer.from(message));
      return;
    }

    if (!this._udpPending) {
      return;
    }

    const pending = this._udpPending;
    this._udpPending = null;
    clearTimeout(pending.timeoutHandle);
    pending.resolve(Buffer.from(message));
  }

  handleUdpFailure(error) {
    this._udpSocket = null;
    this._rejectUdpPending(
      error instanceof SlmpError ? error : new SlmpError(`UDP transport failure: ${error.message}`, { cause: error })
    );
  }

  _rejectUdpPending(error) {
    if (this._udpPending) {
      const pending = this._udpPending;
      this._udpPending = null;
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    for (const [serial, pending] of this._udpPendingBySerial.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
      this._udpPendingBySerial.delete(serial);
    }
  }
}

function readResponseSerial(frame) {
  return Buffer.from(frame).readUInt16LE(2);
}

module.exports = {
  SlmpTransport,
};
