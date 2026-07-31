"use strict";

const dgram = require("dgram");
const net = require("net");
const { performance } = require("node:perf_hooks");

const { FrameType } = require("./constants");
const { extractFrameFromBuffer } = require("./core");
const {
  SlmpClosedError,
  SlmpError,
  SlmpNotConnectedError,
  SlmpTimeoutError,
} = require("./errors");
const { normalizeIpv4Host } = require("./network");

function remainingMilliseconds(deadline, fallback) {
  if (deadline === null || deadline === undefined) return fallback;
  return Math.max(0, Math.min(fallback, Math.ceil(deadline - performance.now())));
}

class SlmpTransport {
  constructor(options) {
    this.host = normalizeIpv4Host(options.host);
    this.port = options.port;
    this.transportType = options.transportType;
    this.frameType = options.frameType;
    this.timeout = options.timeout;

    this._serial = 0;
    this._connectionGeneration = 0;
    this._localCloseEpoch = 0;
    this._tcpSocket = null;
    this._tcpConnecting = null;
    this._tcpConnectPromise = null;
    this._tcpBuffer = Buffer.alloc(0);
    this._tcpPending = null;
    this._tcpPendingBySerial = new Map();
    this._udpSocket = null;
    this._udpConnecting = null;
    this._udpConnectPromise = null;
    this._udpPending = null;
    this._udpPendingBySerial = new Map();
    this._requestCount = 0;
    this._txBytes = 0;
    this._rxBytes = 0;
  }

  trafficStats() {
    return Object.freeze({
      requestCount: this._requestCount,
      txBytes: this._txBytes,
      rxBytes: this._rxBytes,
    });
  }

  _recordSend(frame) {
    this._requestCount += 1;
    this._txBytes += frame.length;
  }

  _recordReceive(frame) {
    this._rxBytes += frame.length;
  }

  connect(deadline = null) {
    if (this.transportType === "tcp") {
      return this._connectTcp(deadline);
    }
    return this._connectUdp(deadline);
  }

  _createTcpSocket() {
    return net.createConnection({ host: this.host, port: this.port, family: 4 });
  }

  _createUdpSocket() {
    return dgram.createSocket("udp4");
  }

  async close() {
    this._localCloseEpoch += 1;
    this._connectionGeneration += 1;
    const pending = [];
    if (this._tcpConnecting) {
      const connecting = this._tcpConnecting;
      this._tcpConnecting = null;
      this._tcpConnectPromise = null;
      clearTimeout(connecting.timeoutHandle);
      connecting.settled = true;
      connecting.socket.removeListener("connect", connecting.onConnect);
      connecting.socket.removeListener("error", connecting.onError);
      connecting.reject(new SlmpClosedError("SLMP transport closed while TCP connection was in progress"));
      if (!connecting.socket.destroyed) {
        connecting.socket.destroy();
      }
    }
    if (this._udpConnecting) {
      const connecting = this._udpConnecting;
      this._udpConnecting = null;
      this._udpConnectPromise = null;
      clearTimeout(connecting.timeoutHandle);
      connecting.settled = true;
      connecting.socket.removeListener("error", connecting.onError);
      connecting.reject(new SlmpClosedError("SLMP transport closed while UDP connection was in progress"));
      try {
        connecting.socket.close();
      } catch (_error) {
        // An unbound connecting UDP socket can already be closed. Its generation is invalidated.
      }
    }
    if (this._tcpSocket) {
      pending.push(
        new Promise((resolve) => {
          const socket = this._tcpSocket;
          this._tcpSocket = null;
          this._tcpConnectPromise = null;
          this._rejectTcpPending(new SlmpClosedError("TCP connection closed"));
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
          this._rejectUdpPending(new SlmpClosedError("UDP socket closed"));
          socket.once("close", resolve);
          socket.close();
        })
      );
    }
    const results = await Promise.allSettled(pending);
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length === 1) {
      throw new SlmpError("SLMP transport close failed", { cause: failures[0] });
    }
    if (failures.length > 1) {
      throw new SlmpError("Multiple SLMP transport close operations failed", {
        cause: new AggregateError(failures, "SLMP transport close failures"),
      });
    }
  }

  hasOpenTransport() {
    if (this.transportType === "tcp") {
      return Boolean(this._tcpSocket && !this._tcpSocket.destroyed);
    }
    return Boolean(this._udpSocket);
  }

  connectionGeneration() {
    return this._connectionGeneration;
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

  async sendOnly(frame, deadline = null) {
    if (this.transportType === "tcp") {
      if (!this._tcpSocket) {
        throw new SlmpNotConnectedError("TCP socket is not connected");
      }
      await this._writeTcpFrame(frame, deadline);
      return;
    }
    await this._sendUdpFrameOnly(frame, deadline);
  }

  async sendAndReceive(frame, serial, expectedTarget = null, deadline = null) {
    if (this.transportType === "tcp") {
      if (!this._tcpSocket) {
        throw new SlmpNotConnectedError("TCP socket is not connected");
      }
      if (this.frameType === FrameType.FRAME_4E && this._tcpPendingBySerial.has(serial)) {
        throw new SlmpError(`another TCP request is already waiting for serial ${serial}`);
      }
      if (this.frameType !== FrameType.FRAME_4E && this._tcpPending) {
        throw new SlmpError("another TCP request is already waiting for a response");
      }
      const responsePromise = this.awaitTcpFrame(serial, expectedTarget, deadline);
      let observedResponseError = null;
      responsePromise.catch((error) => {
        observedResponseError = error;
      });
      try {
        await this._writeTcpFrame(frame, deadline);
      } catch (error) {
        await responsePromise.catch(() => undefined);
        throw observedResponseError instanceof SlmpTimeoutError ? observedResponseError : error;
      }
      return responsePromise;
    }
    return this.sendUdp(frame, serial, expectedTarget, deadline);
  }

  _writeTcpFrame(frame, deadline = null) {
    return new Promise((resolve, reject) => {
      const socket = this._tcpSocket;
      if (!socket) {
        reject(new SlmpNotConnectedError("TCP socket is not connected"));
        return;
      }
      let settled = false;
      const closeEpoch = this._localCloseEpoch;
      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new SlmpTimeoutError("TCP communication timeout");
        this._failTcpAndDestroy(error, socket);
        reject(error);
      }, remainingMilliseconds(deadline, this.timeout));
      socket.write(frame, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (error) {
          if (closeEpoch !== this._localCloseEpoch) {
            reject(new SlmpClosedError("TCP write was interrupted by local close", { cause: error }));
            return;
          }
          const wrapped = new SlmpError(`TCP write failed: ${error.message}`, { cause: error });
          this._failTcpAndDestroy(wrapped, socket);
          reject(wrapped);
          return;
        }
        this._recordSend(frame);
        resolve();
      });
    });
  }

  _sendUdpFrameOnly(frame, deadline = null) {
    return new Promise((resolve, reject) => {
      const socket = this._udpSocket;
      if (!socket) {
        reject(new SlmpNotConnectedError("UDP socket is not connected"));
        return;
      }
      let settled = false;
      const closeEpoch = this._localCloseEpoch;
      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new SlmpTimeoutError("UDP communication timeout");
        this._failUdpAndClose(error, socket);
        reject(error);
      }, remainingMilliseconds(deadline, this.timeout));
      socket.send(frame, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (error) {
          if (closeEpoch !== this._localCloseEpoch) {
            reject(new SlmpClosedError("UDP send was interrupted by local close", { cause: error }));
            return;
          }
          const wrapped = new SlmpError(`UDP send failed: ${error.message}`, { cause: error });
          this._failUdpAndClose(wrapped, socket);
          reject(wrapped);
          return;
        }
        this._recordSend(frame);
        resolve();
      });
    });
  }

  _connectTcp(deadline = null) {
    if (this._tcpSocket && !this._tcpSocket.destroyed) {
      return Promise.resolve();
    }
    if (this._tcpConnectPromise) {
      this._tightenConnectDeadline(this._tcpConnecting, deadline, "TCP");
      return this._tcpConnectPromise;
    }

    const generation = this._connectionGeneration + 1;
    this._connectionGeneration = generation;
    const socket = this._createTcpSocket();
    let connectPromise;
    connectPromise = new Promise((resolve, reject) => {
      const connecting = {
        generation,
        socket,
        reject,
        settled: false,
        timeoutHandle: null,
        onConnect: null,
        onError: null,
        cancel: null,
        deadline: deadline ?? (performance.now() + this.timeout),
      };
      this._tcpConnecting = connecting;

      const finalizeReject = (error) => {
        if (connecting.settled) {
          return;
        }
        connecting.settled = true;
        clearTimeout(connecting.timeoutHandle);
        if (this._tcpConnecting === connecting) {
          this._tcpConnecting = null;
        }
        socket.removeListener("connect", connecting.onConnect);
        socket.removeListener("error", connecting.onError);
        if (!socket.destroyed) {
          socket.destroy();
        }
        reject(error instanceof SlmpError
          ? error
          : new SlmpError(`TCP connection failed: ${error.message}`, { cause: error }));
      };

      const finalizeResolve = () => {
        if (connecting.settled || this._tcpConnecting !== connecting || this._connectionGeneration !== generation) {
          return;
        }
        try {
          socket.setNoDelay(true);
          socket.setKeepAlive(true, 30000);
        } catch (error) {
          finalizeReject(new SlmpError(`TCP keepalive configuration failed: ${error.message}`, { cause: error }));
          return;
        }
        connecting.settled = true;
        clearTimeout(connecting.timeoutHandle);
        this._tcpConnecting = null;
        socket.removeListener("connect", connecting.onConnect);
        socket.removeListener("error", connecting.onError);
        this._tcpSocket = socket;
        this._tcpBuffer = Buffer.alloc(0);
        socket.on("data", (chunk) => this.handleTcpData(chunk, socket));
        socket.on("error", (error) => this.handleTcpFailure(error, socket));
        socket.on("close", () => this.handleTcpFailure(new SlmpError("TCP connection closed"), socket));
        resolve();
      };

      connecting.onConnect = finalizeResolve;
      connecting.onError = finalizeReject;
      connecting.cancel = finalizeReject;
      connecting.timeoutHandle = setTimeout(() => {
        finalizeReject(new SlmpTimeoutError(`TCP connection timed out to ${this.host}:${this.port}`));
      }, remainingMilliseconds(connecting.deadline, this.timeout));
      socket.once("connect", connecting.onConnect);
      socket.once("error", connecting.onError);
    });
    this._tcpConnectPromise = connectPromise.finally(() => {
      if (this._tcpConnectPromise === connectPromise || this._tcpConnectPromise === wrappedPromise) {
        this._tcpConnectPromise = null;
      }
    });
    const wrappedPromise = this._tcpConnectPromise;
    return wrappedPromise;
  }

  _connectUdp(deadline = null) {
    if (this._udpSocket) {
      return Promise.resolve();
    }
    if (this._udpConnectPromise) {
      this._tightenConnectDeadline(this._udpConnecting, deadline, "UDP");
      return this._udpConnectPromise;
    }

    const generation = this._connectionGeneration + 1;
    this._connectionGeneration = generation;
    const socket = this._createUdpSocket();
    let connectPromise;
    connectPromise = new Promise((resolve, reject) => {
      const connecting = {
        generation,
        socket,
        reject,
        settled: false,
        timeoutHandle: null,
        onError: null,
        cancel: null,
        deadline: deadline ?? (performance.now() + this.timeout),
      };
      this._udpConnecting = connecting;

      const finalizeReject = (error) => {
        if (connecting.settled) {
          return;
        }
        connecting.settled = true;
        clearTimeout(connecting.timeoutHandle);
        if (this._udpConnecting === connecting) {
          this._udpConnecting = null;
        }
        socket.removeListener("error", connecting.onError);
        try {
          socket.close();
        } catch (_closeError) {
          // Preserve the connection diagnosis.
        }
        reject(error instanceof SlmpError
          ? error
          : new SlmpError(`UDP connection failed: ${error.message}`, { cause: error }));
      };

      connecting.onError = (error) => finalizeReject(error);
      connecting.cancel = finalizeReject;
      connecting.timeoutHandle = setTimeout(() => {
        finalizeReject(new SlmpTimeoutError(`UDP connect timed out for ${this.host}:${this.port}`));
      }, remainingMilliseconds(connecting.deadline, this.timeout));
      socket.once("error", connecting.onError);
      socket.connect(this.port, this.host, () => {
        if (connecting.settled || this._udpConnecting !== connecting || this._connectionGeneration !== generation) {
          return;
        }
        connecting.settled = true;
        clearTimeout(connecting.timeoutHandle);
        this._udpConnecting = null;
        socket.removeListener("error", connecting.onError);
        this._udpSocket = socket;
        socket.on("error", (error) => this.handleUdpFailure(error, socket));
        socket.on("message", (message) => this.handleUdpMessage(message, socket));
        resolve();
      });
    });
    this._udpConnectPromise = connectPromise.finally(() => {
      if (this._udpConnectPromise === wrappedPromise) {
        this._udpConnectPromise = null;
      }
    });
    const wrappedPromise = this._udpConnectPromise;
    return wrappedPromise;
  }

  _tightenConnectDeadline(connecting, deadline, label) {
    if (!connecting || connecting.settled || deadline === null || deadline === undefined) return;
    if (deadline >= connecting.deadline) return;
    connecting.deadline = deadline;
    clearTimeout(connecting.timeoutHandle);
    connecting.timeoutHandle = setTimeout(
      () => connecting.cancel(new SlmpTimeoutError(`${label} connection timed out to ${this.host}:${this.port}`)),
      remainingMilliseconds(deadline, this.timeout),
    );
  }

  handleTcpData(chunk, socket = null) {
    if (socket && socket !== this._tcpSocket) {
      return;
    }
    this._tcpBuffer = Buffer.concat([this._tcpBuffer, Buffer.from(chunk)]);
    while (true) {
      const expectedSubheader = this.frameType === FrameType.FRAME_4E ? 0x00d4 : 0x00d0;
      if (this._tcpBuffer.length >= 2 && this._tcpBuffer.readUInt16LE(0) !== expectedSubheader) {
        this._failTcpAndDestroy(new SlmpError("unexpected response frame type"));
        return;
      }
      const extracted = extractFrameFromBuffer(this._tcpBuffer, { frameType: this.frameType });
      if (!extracted) {
        return;
      }
      this._tcpBuffer = Buffer.from(extracted.rest);
      const frame = Buffer.from(extracted.frame);
      this._recordReceive(frame);
      let metadata;
      try {
        metadata = readResponseMetadata(frame, this.frameType);
      } catch (error) {
        this._failTcpAndDestroy(asProtocolError(error));
        return;
      }
      if (this.frameType === FrameType.FRAME_4E) {
        const pending = this._tcpPendingBySerial.get(metadata.serial);
        if (pending) {
          if (!targetsMatch(metadata.target, pending.expectedTarget)) {
            continue;
          }
          this._tcpPendingBySerial.delete(metadata.serial);
          clearTimeout(pending.timeoutHandle);
          pending.resolve(frame);
          continue;
        }
        continue;
      }

      if (this._tcpPending) {
        if (!targetsMatch(metadata.target, this._tcpPending.expectedTarget)) {
          continue;
        }
        const pending = this._tcpPending;
        this._tcpPending = null;
        clearTimeout(pending.timeoutHandle);
        pending.resolve(frame);
      } else {
        // A frame without a waiter is stale or unsolicited. Never carry it into a later request.
      }
    }
  }

  awaitTcpFrame(serial, expectedTarget = null, deadline = null) {
    if (this.frameType === FrameType.FRAME_4E) {
      if (this._tcpPendingBySerial.has(serial)) {
        return Promise.reject(new SlmpError(`another TCP request is already waiting for serial ${serial}`));
      }
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this._failTcpAndDestroy(new SlmpTimeoutError("TCP communication timeout"));
        }, remainingMilliseconds(deadline, this.timeout));
        this._tcpPendingBySerial.set(serial, {
          resolve,
          reject,
          timeoutHandle,
          expectedTarget: snapshotTarget(expectedTarget),
        });
      });
    }

    if (this._tcpPending) {
      return Promise.reject(new SlmpError("another TCP request is already waiting for a response"));
    }
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._failTcpAndDestroy(new SlmpTimeoutError("TCP communication timeout"));
      }, remainingMilliseconds(deadline, this.timeout));
      this._tcpPending = {
        resolve,
        reject,
        timeoutHandle,
        expectedTarget: snapshotTarget(expectedTarget),
      };
    });
  }

  handleTcpFailure(error, socket = this._tcpSocket) {
    if (socket !== this._tcpSocket) {
      return;
    }
    this._tcpSocket = null;
    this._connectionGeneration += 1;
    this._tcpBuffer = Buffer.alloc(0);
    this._rejectTcpPending(
      error instanceof SlmpError ? error : new SlmpError(`TCP transport failure: ${error.message}`, { cause: error })
    );
  }

  _failTcpAndDestroy(error, socket = this._tcpSocket) {
    this.handleTcpFailure(error, socket);
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

  sendUdp(frame, serial, expectedTarget = null, deadline = null) {
    return new Promise((resolve, reject) => {
      if (!this._udpSocket) {
        reject(new SlmpNotConnectedError("UDP socket is not connected"));
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
        } else if (!this._udpPending) {
          return;
        }
        this._failUdpAndClose(new SlmpTimeoutError("UDP communication timeout"), socket);
      }, remainingMilliseconds(deadline, this.timeout));

      if (this.frameType === FrameType.FRAME_4E) {
        this._udpPendingBySerial.set(serial, {
          resolve,
          reject,
          timeoutHandle,
          expectedTarget: snapshotTarget(expectedTarget),
        });
      } else {
        this._udpPending = {
          resolve,
          reject,
          timeoutHandle,
          expectedTarget: snapshotTarget(expectedTarget),
        };
      }

      socket.send(frame, (error) => {
        if (socket !== this._udpSocket) {
          return;
        }
        if (!error) {
          this._recordSend(frame);
          return;
        }
        this._failUdpAndClose(new SlmpError(`UDP send failed: ${error.message}`, { cause: error }), socket);
      });
    });
  }

  handleUdpMessage(message, socket = this._udpSocket) {
    if (socket !== this._udpSocket) {
      return;
    }
    this._recordReceive(message);
    let metadata;
    try {
      metadata = readResponseMetadata(message, this.frameType);
    } catch (error) {
      this._failUdpAndClose(asProtocolError(error), socket);
      return;
    }
    if (this.frameType === FrameType.FRAME_4E) {
      const pending = this._udpPendingBySerial.get(metadata.serial);
      if (!pending) {
        return;
      }
      if (!targetsMatch(metadata.target, pending.expectedTarget)) {
        return;
      }
      this._udpPendingBySerial.delete(metadata.serial);
      clearTimeout(pending.timeoutHandle);
      pending.resolve(Buffer.from(message));
      return;
    }

    if (!this._udpPending) {
      return;
    }
    if (!targetsMatch(metadata.target, this._udpPending.expectedTarget)) {
      return;
    }

    const pending = this._udpPending;
    this._udpPending = null;
    clearTimeout(pending.timeoutHandle);
    pending.resolve(Buffer.from(message));
  }

  handleUdpFailure(error, socket = this._udpSocket) {
    if (socket !== this._udpSocket) {
      return;
    }
    this._udpSocket = null;
    this._connectionGeneration += 1;
    this._rejectUdpPending(
      error instanceof SlmpError ? error : new SlmpError(`UDP transport failure: ${error.message}`, { cause: error })
    );
  }

  _failUdpAndClose(error, socket = this._udpSocket) {
    if (socket !== this._udpSocket) {
      return;
    }
    this._udpSocket = null;
    this._connectionGeneration += 1;
    this._udpConnectPromise = null;
    this._rejectUdpPending(error);
    try {
      socket.close();
    } catch (_error) {
      // The socket may already be closing. Its generation is already detached.
    }
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

function readResponseMetadata(frame, frameType) {
  const buffer = Buffer.from(frame);
  const is4E = frameType === FrameType.FRAME_4E;
  const headerSize = is4E ? 13 : 9;
  const expectedSubheader = is4E ? 0x00d4 : 0x00d0;
  if (buffer.length < headerSize) {
    throw new SlmpError("malformed response");
  }
  if (buffer.readUInt16LE(0) !== expectedSubheader) {
    throw new SlmpError("unexpected response frame type");
  }
  if (is4E && (buffer.readUInt8(4) !== 0 || buffer.readUInt8(5) !== 0)) {
    throw new SlmpError("malformed response");
  }
  const responseDataLength = buffer.readUInt16LE(headerSize - 2);
  if (responseDataLength < 2 || buffer.length !== headerSize + responseDataLength) {
    throw new SlmpError("malformed response");
  }
  const routeOffset = is4E ? 6 : 2;
  return {
    serial: is4E ? buffer.readUInt16LE(2) : 0,
    target: {
      network: buffer.readUInt8(routeOffset),
      station: buffer.readUInt8(routeOffset + 1),
      moduleIO: buffer.readUInt16LE(routeOffset + 2),
      multidrop: buffer.readUInt8(routeOffset + 4),
    },
  };
}

function snapshotTarget(target) {
  if (!target) {
    return null;
  }
  return {
    network: target.network,
    station: target.station,
    moduleIO: target.moduleIO,
    multidrop: target.multidrop,
  };
}

function targetsMatch(actual, expected) {
  return !expected || (
    actual.network === expected.network
    && actual.station === expected.station
    && actual.moduleIO === expected.moduleIO
    && actual.multidrop === expected.multidrop
  );
}

function asProtocolError(error) {
  return error instanceof SlmpError
    ? error
    : new SlmpError(`malformed response: ${error.message}`, { cause: error });
}

module.exports = {
  SlmpTransport,
};
