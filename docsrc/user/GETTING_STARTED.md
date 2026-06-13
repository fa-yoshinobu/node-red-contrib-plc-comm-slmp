# Getting started

## Start here

Use this page to make your first Mitsubishi SLMP read from Node-RED. Start with one simple TCP flow, then move to arrays, strings, UDP, routing, or broader verification.

## Prerequisites

| Requirement | Value |
| --- | --- |
| Node-RED | 3.0 or later |
| PLC | Mitsubishi PLC reachable from your Node-RED host |
| First TCP target | `192.168.250.100:1025` |
| Starting PLC type | `melsec:iq-r` |

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
| PLC type | `melsec:iq-r` | Required PLC profile string. |

Leave the route fields at their defaults unless your PLC network needs a different target.

## Import the basic flow

1. Open the Node-RED import dialog.
2. Import `examples/flows/slmp-basic-read-write.json`.
3. Open its `slmp-connection` node.
4. Confirm Host is `192.168.250.100`.
5. Confirm Port is `1025`.
6. Confirm Transport is `TCP`.
7. Confirm PLC type is `melsec:iq-r`.
8. Deploy.
9. Trigger the read inject node.
10. Open the debug sidebar and verify `msg.payload`.

In object output mode, a successful read looks like this shape:

```json
{
  "D300": 123
}
```

The value depends on your PLC memory.

## Read your first value

To build the first read manually, add an `slmp-read` node and set:

| `slmp-read` field | Example value | Description |
| --- | --- | --- |
| Connection | Your `slmp-connection` node | Shared PLC connection. |
| Source | Literal text | The address list is entered in the editor. |
| Addresses | `D300` | First safe word register to read. |
| Output | Object payload | Returns an object keyed by address. |
| Metadata | Full `msg.slmp` | Includes connection and target metadata. |
| Errors | Throw | Lets Node-RED route runtime errors normally. |

Trigger the node with any message. A successful response sets `msg.payload.D300` to the current value.

## Confirm success

1. The flow deploys without editor validation errors.
2. The `slmp-connection` node has PLC type `melsec:iq-r`.
3. The read inject node produces a debug message.
4. `msg.payload` contains a `D300` key.
5. The connection status does not stay red after repeated reads.

## If it does not work

| Symptom | Check |
| --- | --- |
| The read returns nothing or errors immediately | PLC type on `slmp-connection` must be set. It is required, and there is no runtime default. |
| The first flow feels too busy | Import `slmp-basic-read-write.json` first, not `slmp-device-matrix.json`. |
| Address validation fails on the first run | Start with `D300`. Do not test with `G` or `HG` on the first run. |
| TCP does not connect | Confirm the PLC is reachable at `192.168.250.100:1025` from the Node-RED host. |
| UDP is your target | Move to the UDP example after TCP works, and set the UDP port to `1035`. |

## Next pages

- [Usage guide](./USAGE_GUIDE.md)
- [Supported registers](./SUPPORTED_REGISTERS.md)
