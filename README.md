[![CI](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml/badge.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
[![npm downloads](https://img.shields.io/npm/dm/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
![Node-RED version](https://img.shields.io/badge/Node--RED-%E2%89%A53.0-B41F27?logo=nodered&logoColor=white)
![Node.js version](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)
![SLMP frame](https://img.shields.io/badge/SLMP-Binary%203E%20%2F%204E-005BAC)
![Transport](https://img.shields.io/badge/Transport-TCP%20%2F%20UDP-0A7D5C)
![License](https://img.shields.io/badge/License-MIT-1F6FEB)

# Node-RED SLMP Nodes for Mitsubishi PLCs

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

This package is documented for the high-level Node-RED workflow only:

- `slmp-connection`
- `slmp-read`
- `slmp-write`

## Quick Start

1. Install the package into your Node-RED user directory and restart Node-RED.
2. Add one `slmp-connection` config node and set `host`, `port`, `transport`, and `PLC family`.
3. Add `slmp-read` for the first smoke test, using a safe address such as `D300`, `D300,4`, or `DSTR320,10`.
4. When read works, add `slmp-write` and use known-safe test devices before moving to production addresses.

If you are working from this repository, import one of the ready-to-run flows under [examples/flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md) first. The safest first choices are:

- [`slmp-basic-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-basic-read-write.json) for plain TCP scalar read/write
- [`slmp-array-string.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-array-string.json) for `,count` and string access
- [`slmp-device-matrix.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-device-matrix.json) for one-by-one high-level coverage across the matrix catalog
- [`slmp-udp-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-udp-read-write.json) for UDP validation

Start with `D` word devices for the first smoke test. Do not start with `slmp-device-matrix.json`.

## Release Information

- package name: `@fa_yoshinobu/node-red-contrib-plc-comm-slmp`
- package version: `0.2.10`
- npm package: <https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp>
- Node-RED requirement: `>=3.0.0`
- Node.js requirement: `>=18`
- changelog: <https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/CHANGELOG.md>

Install from npm:

```bash
cd ~/.node-red
npm install @fa_yoshinobu/node-red-contrib-plc-comm-slmp
```

Install from this repository:

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-plc-comm-slmp
```

Optional local editor smoke test from the repository root:

```bash
npm run smoke:editor
```

This command installs the local package into an isolated temporary userDir, starts a temporary Node-RED runtime, imports `slmp-basic-read-write.json`, verifies the flow starts, and then shuts the runtime down again.

Legacy note:

- the original unscoped `node-red-contrib-plc-comm-slmp@0.2.0` remains on npm, but new releases move to the scoped package name above

## Supported PLC Registers

Start with these register/device families first:

- word devices: `D`, `SD`, `R`, `ZR`, `TN`, `CN`
- bit devices: `M`, `X`, `Y`, `SM`, `B`
- typed forms: `D200:F`, `D300:L`
- special Node-RED forms: `D100,10`, `M1000,8`, `D100:STR,10`, `DSTR100,10`
- bit-in-word form: `D50.3`

See the full public table in [Supported PLC Registers](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/user/SUPPORTED_REGISTERS.md).

## Documentation

- [Getting Started](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/user/GETTING_STARTED.md)
- [Supported PLC Registers](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/user/SUPPORTED_REGISTERS.md)
- [Latest Communication Verification](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/user/LATEST_COMMUNICATION_VERIFICATION.md)
- [User Guide](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/user/USER_GUIDE.md)
- [Example Flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md)
- [Documentation Index](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/docsrc/index.md)

Maintainer-only notes and retained evidence live under `internal_docs/`.

## What You Can Do

- Binary 3E and 4E frames
- TCP and UDP transport
- reusable `slmp-connection`
- high-level reads and writes through `slmp-read` and `slmp-write`
- typed source selection for literal / `msg` / `flow` / `global` / `env`
- per-request routing via `msg.target` or configured route sources
- read output selection for object / array / single value
- metadata emission selection for `msg.slmp`
- configurable error handling with throw / `msg.error` / second output
- connection control via `connect` / `disconnect` / `reinitialize` messages

Set one explicit `plcFamily` for each connection. The node derives `frameType`, access profile, `X/Y` string-address rules, and device-range rules from that family.

Supported canonical `plcFamily` values:

- `iq-f`
- `iq-r`
- `iq-l`
- `mx-f`
- `mx-r`
- `qcpu`
- `lcpu`
- `qnu`
- `qnudv`

## Underlying JS Helper

The package also exports the underlying SLMP helper library. For device-range reads, choose the PLC family explicitly and read one family SD block:

```js
const { SlmpClient } = require("@fa_yoshinobu/node-red-contrib-plc-comm-slmp/lib/slmp");

async function main() {
  const client = new SlmpClient({
    host: "192.168.250.100",
    port: 1025,
    plcFamily: "qnu",
  });
  const catalog = await client.readDeviceRangeCatalog();
  for (const entry of catalog.entries) {
    console.log(entry.device, entry.pointCount, entry.addressRange);
  }
}
```

This path does not call `readTypeName()`. The caller chooses the family such as `iq-f`, `qnu`, `qnudv`, or `lcpu`, and the standard client derives the rest.

## Current Public Register Scope

- bit devices: `SM`, `X`, `Y`, `M`, `L`, `F`, `V`, `B`, `TS`, `TC`, `LTS`, `LTC`, `STS`, `STC`, `LSTS`, `LSTC`, `CS`, `CC`, `LCS`, `LCC`, `SB`, `DX`, `DY`
- word devices: `SD`, `D`, `W`, `TN`, `LTN`, `STN`, `LSTN`, `CN`, `LCN`, `SW`, `Z`, `LZ`, `R`, `ZR`, `RD`
- typed views: `:S`, `:D`, `:L`, `:F`
- string/count views: `,count`, `:STR`, `DSTR`
- word-bit view: `.bit`

Validated public hardware summary:

- `FX5UC-32MT/D`
- `Q06UDVCPU`
- `R08CPU`

## Example Flows

- [`slmp-demo.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-demo.json): combined demo
- [`slmp-basic-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-basic-read-write.json): scalar, float, and bit read/write over TCP
- [`slmp-array-string.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-array-string.json): array and string read/write over TCP
- [`slmp-control-error.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-control-error.json): control messages, `msg` source, and second-output errors
- [`slmp-device-matrix.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-device-matrix.json): one-by-one high-level read, write, and readback across the matrix catalog with completed-result history, run summary, and JSONL logging in `Node-RED userDir/logs/slmp-device-matrix-<session>.jsonl`
- [`slmp-routing.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-routing.json): per-request routing with `msg.target`
- [`slmp-udp-read-write.json`](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/slmp-udp-read-write.json): basic UDP read/write

## Known Limitations

- the high-level Node-RED surface requires explicit `plcFamily`
- `.bit,count` is not supported
- a single client connection keeps requests serialized by default
- the read and write nodes keep the caller-visible logical request shape and do not silently retry with a different fallback split semantics
- `G` and `HG` are not part of the current public high-level register table

## Development

Run the local test suite:

```bash
cmd /c npm.cmd test
```

## Notes

- `.bit` notation is only valid for word devices such as `D50.3`
- direct bit devices should be addressed directly as `M1000`, `X1F`, `Y20`
- `LTN`, `LSTN`, `LCN`, and `LZ` default to 32-bit `:D` access in high-level helpers
- `LCN` current-value reads and writes use random dword access in the high-level helpers
- `LTS`, `LTC`, `LSTS`, and `LSTC` state reads use the long timer 4-word decode helpers
- `LCS` and `LCC` state reads use direct bit read; high-level state writes use random bit write (`0x1402`)
- low-level direct bit writes are guarded for `LTS`/`LTC`/`LSTS`/`LSTC`/`LCS`/`LCC`
- `X/Y` string addresses require explicit `plcFamily`
- `iq-f` interprets `X/Y` string addresses in octal, while other supported families use hexadecimal `X/Y`
- random read batching follows the Python helper layer for batchable word devices
