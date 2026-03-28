# Node-RED SLMP Nodes for Mitsubishi PLCs

[![CI](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml/badge.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/node-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/node-red-contrib-plc-comm-slmp)
[![npm downloads](https://img.shields.io/npm/dm/node-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/node-red-contrib-plc-comm-slmp)
![Node-RED version](https://img.shields.io/badge/Node--RED-%E2%89%A53.0-B41F27?logo=nodered&logoColor=white)
![Node.js version](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)
![SLMP frame](https://img.shields.io/badge/SLMP-Binary%203E%20%2F%204E-005BAC)
![Transport](https://img.shields.io/badge/Transport-TCP%20%2F%20UDP-0A7D5C)
![License](https://img.shields.io/badge/License-MIT-1F6FEB)

![Node-RED SLMP hero](https://raw.githubusercontent.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/main/docsrc/assets/node-red-slmp.png)

Node-RED nodes for Mitsubishi PLC communication over SLMP binary 3E/4E frames.

This package uses the same named-device foundation as the SLMP libraries, extended here with Node-RED-friendly count and string forms:

- `D100`
- `D100,10`
- `D200:F`
- `D200:F,4`
- `D300:L`
- `D50.3`
- `M1000`
- `M1000,8`
- `D100:STR,10`
- `DSTR100,10`

## Quick start

1. Install the package into your Node-RED user directory and restart Node-RED.
2. Add one `slmp-connection` config node and set `host`, `port`, `transport`, `PLC series`, and `frame type`.
3. Add `slmp-read` for the first smoke test, using a safe address such as `D300`, `D300,4`, or `DSTR320,10`.
4. When read works, add `slmp-write` and use known-safe test devices before moving to production addresses.

If you are working from this repository, import one of the ready-to-run flows under [examples/flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md) first. The safest first choices are:

- [`slmp-basic-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-basic-read-write.json) for plain TCP scalar read/write
- [`slmp-array-string.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-array-string.json) for `,count` and string access
- [`slmp-device-matrix.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-device-matrix.json) for one-by-one high-level coverage across the matrix catalog
- [`slmp-udp-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-udp-read-write.json) for UDP validation

## Release information

- package name: `node-red-contrib-plc-comm-slmp`
- package version: `0.2.0`
- npm package: <https://www.npmjs.com/package/node-red-contrib-plc-comm-slmp>
- Node-RED requirement: `>=3.0.0`
- Node.js requirement: `>=18`
- changelog: <https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/CHANGELOG.md>

Install from npm:

```bash
cd ~/.node-red
npm install node-red-contrib-plc-comm-slmp
```

Install from this repository:

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-plc-comm-slmp
```

## Documentation

- [User Guide](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/user/USER_GUIDE.md)
- [Example Flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md)
- [Future Device Support](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/TODO.md)
- [Maintainer Notes](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/maintainer/ARCHITECTURE.md)
- [Validation Reports Directory](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/tree/main/docsrc/validation/reports)
- [Documentation Index](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/index.md)

## Current scope

- Binary 3E and 4E frames
- TCP and UDP transport
- Reusable `slmp-connection` config node
- `slmp-read` node powered by `readNamed`
- `slmp-write` node powered by `writeNamed`
- typed source selection for literal / `msg` / `flow` / `global` / `env`
- per-request routing via `msg.target` or configured route sources
- read output selection for object / array / single value
- metadata emission selection for `msg.slmp`: `full` / `minimal` / `off`
- configurable error handling with throw / `msg.error` / second output
- connection control via `connect` / `disconnect` / `reinitialize` messages
- editor-side validation for connection ranges, literal addresses, literal updates, and route JSON
- importable example flow under `examples/flows/`
- Local tests for codec and high-level helpers

Set `frame type` and `PLC series` explicitly for each connection.

Validated PLC models:

- `FX5UC-32MT/D`
- `Q06UDVCPU`
- `R08CPU`

## Supported devices

Supported bit devices:

- `SM`, `X`, `Y`, `M`, `L`, `F`, `V`, `B`
- `TS`, `TC`, `STS`, `STC`
- `CS`, `CC`
- `SB`, `DX`, `DY`

Supported word devices:

- `SD`, `D`, `W`
- `TN`, `LTN`, `STN`, `LSTN`
- `CN`, `LCN`
- `SW`
- `Z`
- `R`, `ZR`, `RD`

Address notes:

- `X`, `Y`, `B`, `W`, `SB`, `SW`, `DX`, and `DY` use hexadecimal device numbers
- most other devices use decimal numbers
- word devices support `.bit`, for example `D50.3`
- count and string forms work on supported devices, for example `D300,10`, `M1000,8`, and `DSTR320,10`
- `LTN`, `LSTN`, and `LCN` default to 32-bit current-value access in the high-level nodes
- future device support candidates such as `LTS`, `LTC`, `LSTS`, `LSTC`, `LCS`, `LCC`, `LZ`, `G`, and `HG` are tracked in the [Future Device Support list](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/TODO.md)

## Nodes

### `slmp-connection`

Holds the transport and SLMP profile settings:

- host / port
- transport: `tcp` or `udp`
- timeout in milliseconds
- PLC series: `ql` or `iqr`
- frame type: `3e` or `4e`
- target routing fields

### `slmp-read`

Reads one or more addresses and writes the result to `msg.payload`.

Configured addresses can be overridden by:

- `msg.addresses` as an array or string
- `msg.payload` as an array or string

Configured source modes:

- literal editor text
- `msg`
- `flow`
- `global`
- `env`

Examples:

```text
D100
D100,10
D200:F
D200:F,4
D50.3
M1000
M1000,8
D100:STR,10
DSTR100,10
```

Notes:

- `,count` returns an array for numeric and direct-bit reads
- `:STR,<length>` reads or writes a UTF-8 byte string packed two bytes per word
- `DSTR100,10` is accepted as a compatibility alias for `D100:STR,10`
- `LTN`, `LSTN`, and `LCN` use high-level 32-bit current values by default
- when you send multiple addresses as a string, newline-separated input is the clearest form
- per-request routing can be supplied as `msg.target`, `msg.slmp.target`, or a configured route source
- metadata mode can keep full `msg.slmp`, emit only `target` plus `itemCount`, or leave `msg.slmp` unchanged
- read errors can throw, attach to `msg.error`, or go to a second output
- output can be object, array, or single value when one address is requested
- send `msg.connect`, `msg.disconnect`, or `msg.reinitialize` as `true`, or use `msg.topic`, to control the shared connection

### `slmp-write`

Writes one or more addresses.

Preferred dynamic input:

```json
{
  "D100": 42,
  "D100,3": [10, 11, 12],
  "D200:F": 3.14,
  "D200:F,2": [1.25, -2.5],
  "D50.3": true,
  "D100:STR,10": "HELLO"
}
```

Accepted sources:

- `msg.updates`
- `msg.payload`
- `msg.address` + optional `msg.dtype` + `msg.value`
- static JSON or `address=value` lines in the editor
- configured `msg` / `flow` / `global` / `env` sources

Write errors can throw, attach to `msg.error`, or go to a second output.
Send `msg.connect`, `msg.disconnect`, or `msg.reinitialize` to control the shared connection from the write node too.
Route overrides use the same `target` object shape as reads.
Metadata mode can keep full `msg.slmp`, emit only `target` plus `itemCount`, or leave `msg.slmp` unchanged.

## Route overrides

Use a `target` object when one request needs a different route than the shared connection default:

```json
{
  "addresses": ["D300,4", "DSTR320,10"],
  "target": {
    "network": 0,
    "station": 255,
    "moduleIO": "03FF",
    "multidrop": 0
  }
}
```

The editor validates connection ranges, literal address lists, literal update payloads, and literal route JSON before save.

## Example flows

Read:

```json
{
  "addresses": ["D100", "D100,3", "D200:F", "D200:F,2", "D50.3", "D100:STR,10"]
}
```

Write:

```json
{
  "payload": {
    "D100": 42,
    "D100,3": [10, 11, 12],
    "D50.3": true,
    "D100:STR,10": "HELLO"
  }
}
```

Import one of the ready-to-run flows under [examples/flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md):

- [`slmp-demo.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-demo.json): combined demo
- [`slmp-basic-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-basic-read-write.json): scalar, float, and bit read/write over TCP
- [`slmp-array-string.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-array-string.json): array and string read/write over TCP
- [`slmp-control-error.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-control-error.json): control messages, `msg` source, and second-output errors
- [`slmp-device-matrix.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-device-matrix.json): one-by-one high-level read, write, and readback across the matrix catalog with completed-result history, run summary, and JSONL logging in `Node-RED userDir/logs/slmp-device-matrix-<session>.jsonl`
- [`slmp-routing.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-routing.json): per-request routing with `msg.target`
- [`slmp-udp-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-udp-read-write.json): basic UDP read/write

Recommended first import:

- start with [`slmp-basic-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-basic-read-write.json) if you only need to confirm a single PLC over TCP
- use [`slmp-array-string.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-array-string.json) when you want to validate `,count` and string handling immediately
- use [`slmp-device-matrix.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-device-matrix.json) when you need to step through the matrix catalog one by one from the high-level nodes and keep a persistent verification log
- use [`slmp-control-error.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-control-error.json) when you need `msg`-driven addresses, control messages, or second-output error routing

## Known limitations

- Set `frame type` and `PLC series` explicitly for each connection
- `.bit,count` is not supported
- A single client connection keeps requests serialized by default
- Future high-level device support candidates are tracked in the [Future Device Support list](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/TODO.md)

## Development

Run the local test suite:

```bash
cmd /c npm.cmd test
```

## Notes

- `.bit` notation is only valid for word devices such as `D50.3`
- Direct bit devices should be addressed directly as `M1000`, `X1F`, `Y20`
- Random read batching follows the Python helper layer for batchable word devices
