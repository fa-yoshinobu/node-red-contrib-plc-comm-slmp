# Getting started

## Start here

Use this page to make your first MELSEC SLMP read from Node-RED. Start with one simple TCP flow, then move to arrays, strings, UDP, routing, or broader verification.

## Prerequisites

| Requirement | Value |
| --- | --- |
| Node-RED | 3.0 or later |
| PLC | MELSEC PLC reachable from your Node-RED host |
| First TCP target | `192.168.250.100:1025` |
| Starting PLC profile | `melsec:iq-r` |

## Install

1. Open the Node-RED editor.
2. Open Manage palette.
3. Open the Install tab.
4. Search for `@fa_yoshinobu/node-red-contrib-plc-comm-slmp`.
5. Install the package.
6. Restart Node-RED if your environment requires it.

## Create a connection node

Create or open a `slmp-connection` config node and set these fields:

| `slmp-connection` field | Example value | Description |
| --- | --- | --- |
| Host | `192.168.250.100` | PLC IP address or host name. |
| Port | `1025` | TCP port for the first example. |
| Transport | `TCP` | Use TCP for the first run. |
| PLC profile | `melsec:iq-r` | Required canonical PLC profile. |

Confirm all route fields initialized by the editor. Use the own-station values
unless your PLC network needs a different target.

## Import the basic flow

1. Open the Node-RED import dialog.
2. Import `examples/flows/slmp-basic-read-write.json`.
3. Open its `slmp-connection` node.
4. Confirm Host is `192.168.250.100`.
5. Confirm Port is `1025`.
6. Confirm Transport is `TCP`.
7. Confirm the PLC profile is `melsec:iq-r`.
8. Deploy.
9. Trigger the read inject node.
10. Open the debug sidebar and verify `msg.payload`.

In object output mode, a successful read looks like this shape:

```json
{
  "D300:U": 123
}
```

The value depends on your PLC memory.

## Read your first value

To build the first read manually, add an `slmp-read` node and set:

| `slmp-read` field | Example value | Description |
| --- | --- | --- |
| Connection | Your `slmp-connection` node | Shared PLC connection. |
| Source | Literal text | The address list is entered in the editor. |
| Addresses | `D300:U` | First safe word register to read. |
| Output | Object payload | Returns an object keyed by address. |
| Metadata | Full `msg.slmp` | Includes connection and target metadata. |
| Errors | Throw | Lets Node-RED route runtime errors normally. |

Trigger the node with any message. A successful response sets `msg.payload["D300:U"]` to the current value.

## Confirm success

1. The flow deploys without editor validation errors.
2. The `slmp-connection` node has PLC profile `melsec:iq-r`.
3. The PLC-side communication data code is Binary and the port/open setting matches your transport; see the [MELSEC SLMP PLC Setup Guide](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/).
4. PLC-side RUN-time write permission is enabled before you run a write flow where the PLC exposes that setting.
5. The read inject node produces a debug message.
6. `msg.payload` contains a `D300:U` key.
7. The connection status does not stay red after repeated reads.

## If it does not work

| Symptom | Check |
| --- | --- |
| The read returns nothing or errors immediately | PLC profile on `slmp-connection` must be set. It is required, and there is no runtime default. |
| Connection opens but all requests fail | Confirm Binary communication data code in the PLC setup guide. |
| Reads work but writes fail | Confirm RUN-time write permission in the PLC setup guide and the selected profile write policy. |
| The first flow feels too busy | Import `slmp-basic-read-write.json` first, not `slmp-device-matrix.json`. |
| Address validation fails on the first run | Start with `D300:U`. Do not test with `G` or `HG` on the first run. |
| TCP does not connect | Confirm the PLC is reachable at `192.168.250.100:1025` from the Node-RED host. |
| UDP is your target | Move to the UDP example after TCP works, and set the UDP port to `1035`. |
