[![CI](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml/badge.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40fa_yoshinobu%2Fnode-red-contrib-plc-comm-slmp?logo=npm&color=CB3837)](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/LICENSE)

# Node-RED MELSEC SLMP Nodes

Node-RED nodes for MELSEC SLMP (Binary 3E/4E) PLC communication.

## PLC Comm Family

This library is part of the plc-comm family. See the [package matrix](https://plc-comm-docs-site.fa-labo.com/package-matrix/) for protocol, language, registry, and install-command mapping.

## Supported PLC profiles

The maintained profile table is in [PLC profiles](https://plc-comm-docs-site.fa-labo.com/slmp/nodered/PROFILES/). Choose one exact canonical PLC profile from that table.

## Profile enforcement

Every `slmp-connection` requires one concrete PLC profile. Operations known to be unavailable for that profile are rejected before sending; normal Node-RED flows do not expose a profile-enforcement bypass. Protocol investigation that needs raw PLC evidence belongs in the separate maintainer verification tooling.

## Request serialization

Requests sent through the same `slmp-connection` are serialized in FIFO order on that client connection. A queued request is not sent until the previous request has completed, timed out, or failed. Closing rejects active and queued work and prevents the old queue generation from reconnecting. This applies to 3E/4E and TCP/UDP requests, including send-only requests.

If a flow needs real parallel PLC communication, create separate `slmp-connection` config nodes so each path uses its own PLC connection.

## Supported device types

The maintained device and range tables are in the [SLMP Profile Reference](https://plc-comm-docs-site.fa-labo.com/slmp/profile-reference/). Use that page for supported device families, address syntax, and profile-specific notes.

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

The optional write button is only for controlled test addresses. It reads and saves the original
values, writes random valid values, restores the snapshot after confirmed acknowledgements, and
reads again. If any write or restore fails or has an unknown outcome, stop and reconcile the PLC
values manually; the automatic sequence does not retry.

Start with the basic flow before importing the device-matrix flow.

## Documentation

| Page | Use it for |
| --- | --- |
| [Full documentation site](https://plc-comm-docs-site.fa-labo.com/) | Unified docs for all PLC communication libraries. |
| [Getting started](https://plc-comm-docs-site.fa-labo.com/slmp/nodered/GETTING_STARTED/) | Install the nodes, configure a connection, and run your first SLMP read. |
| [Usage guide](https://plc-comm-docs-site.fa-labo.com/slmp/nodered/USAGE_GUIDE/) | Use read/write nodes, routing fields, typed values, and flow patterns. |
| [API reference](https://plc-comm-docs-site.fa-labo.com/slmp/nodered/API_REFERENCE/) | Find public client methods, helpers, profile APIs, and error types. |
| [SLMP profile reference](https://plc-comm-docs-site.fa-labo.com/slmp/profile-reference/) | Check profile parameters, device families, address syntax, and numbering rules. |
| [PLC profiles](https://plc-comm-docs-site.fa-labo.com/slmp/nodered/PROFILES/) | Choose the canonical MELSEC profile and frame behavior. |
| [Gotchas](https://plc-comm-docs-site.fa-labo.com/slmp/nodered/GOTCHAS/) | Check whether this library has any current library-specific caveats. |
| [Performance](https://plc-comm-docs-site.fa-labo.com/performance/) | See measured latency, throughput, and long-run soak results from real PLC hardware. |
| [Choosing a Language](https://plc-comm-docs-site.fa-labo.com/choosing-a-language/) | Compare the .NET, Python, Rust, C++, and Node-RED implementations before you pick one. |
| [Example flows](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/examples/flows/README.md) | Import maintained Node-RED example flows. |

For a zero-code connectivity check, see [PLC Scope](https://github.com/fa-yoshinobu/plc-scope-dotnet) (Windows).

## License and registry

| Item | Value |
| --- | --- |
| License | [MIT](https://github.com/fa-yoshinobu/node-red-contrib-plc-comm-slmp/blob/main/LICENSE) |
| Registry | [npm](https://www.npmjs.com/package/@fa_yoshinobu/node-red-contrib-plc-comm-slmp) |
| Package | `@fa_yoshinobu/node-red-contrib-plc-comm-slmp` |

## Commercial support

If you plan to embed this library in a paid or commercial product, please consider a separate support agreement or supporting the project as a sponsor.

Contact: <https://fa-labo.com/contact.html>

### PLC clock setting

Use `slmp-set-time` with the shared `slmp-connection`. Send a Date in `msg.payload` (for example `msg.payload = new Date(); return msg;` in a Function node), or a JSON array `[26, 10, 31, 12, 34, 56, 6]` (`YY, month, day, hour, minute, second, weekday`; Sunday = 0). Date inputs use the Node-RED host local timezone; arrays specify PLC wall-clock time. Invalid or missing input is rejected.

Uses SlmpClient.setTime(): SM210 OFF, clock words at SD210, SM210 ON, without interleaving other operations on this client. Supports iQ-R/iQ-F/iQ-L/MX-F/MX-R (seven BIN words) and Q/QnU/QnUDV/L (four packed BCD words), including their Ethernet module profiles. Unknown clock layouts fail before sending. Years 1980..2079 for Date inputs; array YY is 0..79. See the [clock layout table and manual references](docsrc/user/API_REFERENCE.md#plc-clock-setting).

The output preserves the input message and indicates write acknowledgements only, not a verified clock change. Use a Catch node for errors; do not automatically retry partial/uncertain writes. Coordinate SM210/SM213 and SD210 registers with the PLC program and other clients. Follow the target CPU's clock-processing requirements; Q/L and iQ-R/iQ-F require END processing to apply the request.

Import [`examples/flows/slmp-set-time.json`](examples/flows/slmp-set-time.json) for manual current-time setting with Catch handling and iQ-R readback through SM213 / SD210..SD216 (tested on R16CPU). It separates write acknowledgements from the clock comparison and includes a manual readback button. Configure the endpoint and follow the [clock sample prerequisites](examples/flows/README.md#clock-setting-and-readback) before use.
