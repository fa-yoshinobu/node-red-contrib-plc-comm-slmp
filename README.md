[![CI](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml/badge.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# Node-RED MELSEC SLMP Nodes

Node-RED nodes for MELSEC SLMP (Binary 3E/4E) PLC communication.

## Supported PLC profiles

The maintained profile table is in [PLC profiles](docsrc/user/PROFILES.md). Choose one exact canonical PLC profile from that table.

## Strict profile capability guard

The `slmp-connection` node has a Strict profile option, enabled by default. It uses the built-in capability table imported from `plc-comm-slmp-profiles` `v1.0.0` and rejects high-level requests before transport when the selected built-in Ethernet profile is known not to support that feature.

Applied feature keys in this Node-RED package are `type_name`, `direct`, `random`, `block`, `monitor` payload validation and limits, `long_device_path`, and `lz_32bit_path`. The low-level raw request API is not feature-guarded.

The capability keys `ext_module_access`, `ext_link_direct`, and `hg_cpu_buffer` are outside the public Node-RED high-level node surface in this package, so they are not guarded here.

## Supported device types

The maintained device and range tables are in [Supported registers](docsrc/user/SUPPORTED_REGISTERS.md). Use that page for supported device families, address syntax, and profile-specific notes.

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
7. Set PLC profile to `melsec:iq-r`.
8. Deploy the flow.
9. Trigger the read inject node and check `msg.payload` in the debug sidebar.

Start with the basic flow before importing the device-matrix flow.

## Documentation

| Page | Use it for |
| --- | --- |
| [Full documentation site](https://fa-yoshinobu.github.io/plc-comm-docs-site/) | Unified docs for all PLC communication libraries. |
| [Getting started](docsrc/user/GETTING_STARTED.md) | Install the nodes, configure a connection, and run your first SLMP read. |
| [Usage guide](docsrc/user/USAGE_GUIDE.md) | Use read/write nodes, routing fields, typed values, and flow patterns. |
| [Supported registers](docsrc/user/SUPPORTED_REGISTERS.md) | Check device families, address syntax, and numbering rules. |
| [PLC profiles](docsrc/user/PROFILES.md) | Choose the canonical MELSEC profile and frame behavior. |
| [Example flows](examples/flows/README.md) | Import maintained Node-RED example flows. |

## Hardware verified

Live-device verification is maintained in [Latest communication verification](docsrc/user/LATEST_COMMUNICATION_VERIFICATION.md).
See that page for verified PLC models, transports, dates, limitations, and retained validation notes.

## License and registry

| Item | Value |
| --- | --- |
| License | [MIT](LICENSE) |
| Registry | [npm](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp) |
| Package | `@fa_yoshinobu/node-red-contrib-plc-comm-slmp` |

## Commercial support

If you plan to embed this library in a paid or commercial product, please consider a separate support agreement or supporting the project as a sponsor.

Contact: <https://fa-labo.com/contact.html>
