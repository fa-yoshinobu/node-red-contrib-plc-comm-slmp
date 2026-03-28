# User Guide

See also:

- [Project README](../../README.md)
- [Changelog](../../CHANGELOG.md)
- [Future Device Support](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/TODO.md)
- [Documentation Index](../index.md)
- [Example Flows](../../examples/flows/README.md)

## Purpose

`node-red-contrib-plc-comm-slmp` provides Node-RED nodes for Mitsubishi PLC communication over binary SLMP 3E/4E.

## Quick start

1. Install the package into your Node-RED user directory and restart Node-RED.
2. Create one `slmp-connection` and set `host`, `port`, `transport`, `PLC series`, and `frame type`.
3. Drop in `slmp-read` and try a safe address such as `D300`, `D300,4`, or `DSTR320,10`.
4. Once reads work, add `slmp-write` and verify with known-safe test devices.

npm package:

- <https://www.npmjs.com/package/node-red-contrib-plc-comm-slmp>

If you are starting from the example flows in this repository, import these in this order:

- [`slmp-basic-read-write.json`](../../examples/flows/slmp-basic-read-write.json)
- [`slmp-array-string.json`](../../examples/flows/slmp-array-string.json)
- [`slmp-device-matrix.json`](../../examples/flows/slmp-device-matrix.json)
- [`slmp-control-error.json`](../../examples/flows/slmp-control-error.json)
- [`slmp-udp-read-write.json`](../../examples/flows/slmp-udp-read-write.json)

## Available nodes

- `slmp-connection`
- `slmp-read`
- `slmp-write`

The package also ships importable example flows:

- [`slmp-demo.json`](../../examples/flows/slmp-demo.json)
- [`slmp-basic-read-write.json`](../../examples/flows/slmp-basic-read-write.json)
- [`slmp-array-string.json`](../../examples/flows/slmp-array-string.json)
- [`slmp-control-error.json`](../../examples/flows/slmp-control-error.json)
- [`slmp-device-matrix.json`](../../examples/flows/slmp-device-matrix.json)
- [`slmp-routing.json`](../../examples/flows/slmp-routing.json)
- [`slmp-udp-read-write.json`](../../examples/flows/slmp-udp-read-write.json)

## Connection settings

Configure these explicitly on the connection node:

- host
- port
- transport: `tcp` or `udp`
- PLC series: `ql` or `iqr`
- frame type: `3e` or `4e`
- route fields: network, station, module I/O, multidrop

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

- `X`, `Y`, `B`, `W`, `SB`, `SW`, `DX`, and `DY` use hexadecimal numbering
- most other devices use decimal numbering
- word devices support `.bit`, for example `D50.3`
- count and string forms work on supported devices, for example `D300,10`, `M1000,8`, and `DSTR320,10`
- `LTN`, `LSTN`, and `LCN` default to 32-bit current-value access in the high-level nodes
- future device support candidates such as `LTS`, `LTC`, `LSTS`, `LSTC`, `LCS`, `LCC`, `LZ`, `G`, and `HG` are tracked in [`TODO.md`](../../TODO.md)

## Address model

The high-level address grammar keeps the same named-device foundation as the SLMP Python and .NET libraries, then extends it for Node-RED count and string inputs:

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

Rules:

- `,count` returns an array for direct-bit, word, and DWord reads
- `:STR,<length>` reads or writes a UTF-8 byte string packed two bytes per word
- `DSTR100,10` is accepted as a compatibility alias for `D100:STR,10`
- `.bit` stays scalar-only, so `.bit,count` is not supported
- `LTN`, `LSTN`, and `LCN` use high-level 32-bit current values by default

## Dynamic inputs

Read accepts:

- `msg.addresses`
- `msg.payload`
- `msg.target` or `msg.slmp.target` for per-request routing

Configured source modes:

- literal editor text
- `msg`
- `flow`
- `global`
- `env`

When a read input is a string, newline-separated addresses are the clearest form:

```text
D100
D100,10
D200:F,4
D100:STR,10
```

Write accepts:

- `msg.updates`
- `msg.payload`
- `msg.address` with optional `msg.dtype` and `msg.value`
- `msg.target` or `msg.slmp.target` for per-request routing
- configured `msg` / `flow` / `global` / `env` sources

Examples:

```json
{
  "D100": 42,
  "D100,3": [10, 11, 12],
  "D200:F,2": [1.25, -2.5],
  "M1000,4": [true, false, true, false],
  "D100:STR,10": "HELLO"
}
```

## Output and errors

Read output modes:

- `object`
- `array`
- `value` when exactly one address is requested

Metadata modes:

- `full`: emit `addresses` or `updates`, connection profile, and effective target in `msg.slmp`
- `minimal`: emit only the effective `target`, `itemCount`, and `metadataMode` in `msg.slmp`
- `off`: leave `msg.slmp` unchanged

Read and write error modes:

- throw
- attach the error to `msg.error`
- emit the failed message on the second output

## Per-request routing

Use a `target` object when one read or write must override the connection node route:

```json
{
  "target": {
    "network": 0,
    "station": 255,
    "moduleIO": "03FF",
    "multidrop": 0
  }
}
```

You can supply that object through:

- `msg.target`
- `msg.slmp.target`
- a configured route source using literal JSON, `msg`, `flow`, `global`, or `env`

## Connection control

Send any of these to `slmp-read` or `slmp-write`:

- `msg.connect = true`
- `msg.disconnect = true`
- `msg.reinitialize = true`
- or `msg.topic = "connect" | "disconnect" | "reinitialize"`

## Example flows

Import one of these into Node-RED, then update the connection host, port, transport, and safe device addresses before deploy:

- [`slmp-demo.json`](../../examples/flows/slmp-demo.json): combined demo
- [`slmp-basic-read-write.json`](../../examples/flows/slmp-basic-read-write.json): scalar, float, and bit read/write over TCP
- [`slmp-array-string.json`](../../examples/flows/slmp-array-string.json): array and string read/write over TCP
- [`slmp-control-error.json`](../../examples/flows/slmp-control-error.json): control messages, configured `msg` source, and second-output errors
- [`slmp-device-matrix.json`](../../examples/flows/slmp-device-matrix.json): one-by-one high-level read, write, and readback across the matrix catalog with completed-result history, run summary, and JSONL logging under `Node-RED userDir/logs/slmp-device-matrix-<session>.jsonl`
- [`slmp-routing.json`](../../examples/flows/slmp-routing.json): per-request routing with `msg.target`
- [`slmp-udp-read-write.json`](../../examples/flows/slmp-udp-read-write.json): basic UDP read/write

Recommended first import:

- start with [`slmp-basic-read-write.json`](../../examples/flows/slmp-basic-read-write.json) for plain TCP smoke testing
- move to [`slmp-array-string.json`](../../examples/flows/slmp-array-string.json) when you want to validate `,count` and string access
- move to [`slmp-device-matrix.json`](../../examples/flows/slmp-device-matrix.json) when you want one-by-one high-level coverage across the matrix catalog and a persistent verification log
- use [`slmp-control-error.json`](../../examples/flows/slmp-control-error.json) for `msg`-driven addresses, control messages, and second-output error routing

## Notes

- `.bit` notation is only valid on word devices such as `D50.3`
- `.bit,count` is not supported
- direct bit devices should be addressed directly as `M1000`, `X1F`, or `Y20`
- a single client connection keeps requests serialized by default
- read/write errors can throw, attach to `msg.error`, or go to a second output
- the editor validates connection ranges, literal address lists, literal update payloads, and literal route JSON before save
