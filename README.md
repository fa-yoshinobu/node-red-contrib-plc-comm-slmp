[![CI](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml/badge.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/LICENSE)

# Node-RED MELSEC SLMP Nodes

Node-RED nodes for MELSEC SLMP (Binary 3E/4E) PLC communication.

## PLC Comm Family

This library is part of the plc-comm family. See the [package matrix](https://fa-yoshinobu.github.io/plc-comm-docs-site/package-matrix/) for protocol, language, registry, and install-command mapping.

## Supported PLC profiles

The maintained profile table is in [PLC profiles](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/nodered/PROFILES/). Choose one exact canonical PLC profile from that table.

## Profile enforcement

Every `slmp-connection` requires one concrete PLC profile. Operations known to be unavailable for that profile are rejected before sending; normal Node-RED flows do not expose a profile-enforcement bypass. Protocol investigation that needs raw PLC evidence belongs in the separate maintainer verification tooling.

## Request serialization

Requests sent through the same `slmp-connection` are serialized on that client connection. A queued request is not sent until the previous request has completed, timed out, or failed. This applies to 3E/4E and TCP/UDP requests, including send-only requests.

If a flow needs real parallel PLC communication, create separate `slmp-connection` config nodes so each path uses its own PLC connection.

## Supported device types

The maintained device and range tables are in the [SLMP Profile Reference](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/). Use that page for supported device families, address syntax, and profile-specific notes.

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
| [Getting started](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/nodered/GETTING_STARTED/) | Install the nodes, configure a connection, and run your first SLMP read. |
| [Usage guide](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/nodered/USAGE_GUIDE/) | Use read/write nodes, routing fields, typed values, and flow patterns. |
| [SLMP profile reference](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/) | Check profile parameters, device families, address syntax, and numbering rules. |
| [PLC profiles](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/nodered/PROFILES/) | Choose the canonical MELSEC profile and frame behavior. |
| [Example flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md) | Import maintained Node-RED example flows. |

## License and registry

| Item | Value |
| --- | --- |
| License | [MIT](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/LICENSE) |
| Registry | [npm](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp) |
| Package | `@fa_yoshinobu/node-red-contrib-plc-comm-slmp` |

## Commercial support

If you plan to embed this library in a paid or commercial product, please consider a separate support agreement or supporting the project as a sponsor.

Contact: <https://fa-labo.com/contact.html>
