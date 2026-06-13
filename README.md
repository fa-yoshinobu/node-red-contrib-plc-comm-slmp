[![CI](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml/badge.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
[![npm downloads](https://img.shields.io/npm/dm/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
![Node-RED version](https://img.shields.io/badge/Node--RED-%E2%89%A53.0-B41F27?logo=nodered&logoColor=white)
![Node.js version](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)
![SLMP frame](https://img.shields.io/badge/SLMP-Binary%203E%20%2F%204E-005BAC)
![Transport](https://img.shields.io/badge/Transport-TCP%20%2F%20UDP-0A7D5C)
![License](https://img.shields.io/badge/License-MIT-1F6FEB)

# Node-RED SLMP Nodes for Mitsubishi PLCs

Node-RED nodes for Mitsubishi SLMP (Binary 3E/4E) PLC communication.

## Supported PLC types

Select one PLC type on every `slmp-connection` node.

| PLC type string | Hardware | Frame | Notes |
| --- | --- | --- | --- |
| `melsec:iq-f` | MELSEC iQ-F / FX5 | 3E | `X` and `Y` addresses use octal numbering. |
| `melsec:iq-r` | MELSEC iQ-R | 4E | Recommended starting point for the example flows. |
| `melsec:iq-l` | MELSEC iQ-L | 4E | Keeps its own iQ-L profile with iQ-R-equivalent address rules. |
| `melsec:mx-f` | MELSEC MX-F profile | 4E | Uses MX-F profile behavior in the current source. |
| `melsec:mx-r` | MELSEC MX-R profile | 4E | Uses MX-R profile behavior in the current source. |
| `melsec:qcpu` | MELSEC QCPU | 3E | Q/L-series profile. |
| `melsec:lcpu` | MELSEC LCPU | 3E | Q/L-series profile. |
| `melsec:qnu` | MELSEC QnU | 3E | Q/L-series profile. |
| `melsec:qnudv` | MELSEC QnUDV | 3E | Q/L-series profile. |

## Supported device types

Start with simple devices, then move into typed, counted, and string forms after the first read succeeds. See the full table in [Supported registers](docsrc/user/SUPPORTED_REGISTERS.md).

| Family | Use |
| --- | --- |
| `D` | Data registers for the first word read and write tests. |
| `M` | Internal relays for bit reads and writes. |
| `X` | Inputs. iQ-F uses octal numbering; other profiles use hexadecimal. |
| `Y` | Outputs. iQ-F uses octal numbering; other profiles use hexadecimal. |
| `W` | Link registers with hexadecimal numbering. |
| `R` | File registers where supported by your PLC. |
| `LTN` | Long timer current values, where supported. Use `:D` or `:L`. |
| `LCN` | Long counter current values, where supported. Use `:D` or `:L`. |

## Installation

In the Node-RED editor:

1. Open Manage palette.
2. Open the Install tab.
3. Search for `@fa_yoshinobu/node-red-contrib-plc-comm-slmp`.
4. Install the package.
5. Restart Node-RED if your environment requires it.

## Quick start

1. Open the Node-RED import dialog.
2. Import `examples/flows/slmp-basic-read-write.json`.
3. Open the `slmp-connection` config node.
4. Set Host to `192.168.250.100`.
5. Set Port to `1025`.
6. Set Transport to `TCP`.
7. Set PLC type to `melsec:iq-r`.
8. Deploy the flow.
9. Trigger the read inject node and check `msg.payload` in the debug sidebar.

Start with the basic flow before importing the device-matrix flow.

## Documentation

- [Getting started](docsrc/user/GETTING_STARTED.md)
- [Usage guide](docsrc/user/USAGE_GUIDE.md)
- [Supported registers](docsrc/user/SUPPORTED_REGISTERS.md)
- [PLC profiles](docsrc/user/PROFILES.md)
- [Example flows](examples/flows/README.md)

## Hardware verified

The retained public verification notes list these PLC models:

| PLC model | Notes |
| --- | --- |
| `FX5UC-32MT/D` | iQ-F / FX5-class hardware. |
| `Q06UDVCPU` | Q-series hardware. |
| `R08CPU` | iQ-R hardware. A 2026-05-01 TCP check at `192.168.250.100:1025` returned `LCS10=false` and `LCC10=false` through `readNamed`. |

Verified transports include TCP and UDP. See [Latest communication verification](docsrc/user/LATEST_COMMUNICATION_VERIFICATION.md) for the retained summary.

## License and registry

| Item | Value |
| --- | --- |
| Package | `@fa_yoshinobu/node-red-contrib-plc-comm-slmp` |
| Registry | <https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp> |
| License | MIT |
