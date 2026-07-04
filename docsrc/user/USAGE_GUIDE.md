# Usage guide

## Available nodes

| Node | Purpose |
| --- | --- |
| `slmp-connection` | Shared MELSEC SLMP connection profile for `slmp-read` and `slmp-write`. |
| `slmp-read` | Reads one or more device addresses and writes the result to `msg.payload`. |
| `slmp-write` | Writes one or more device values from static configuration or incoming messages. |

## slmp-connection config node

| Config field | Description |
| --- | --- |
| Name | Optional label shown in the Node-RED editor. |
| Host | PLC host name or IP address. For the examples, use `192.168.250.100`. |
| Port | TCP or UDP port. Use `1025` for TCP examples and `1035` for UDP examples. |
| Transport | `tcp` or `udp`. |
| Timeout ms | Communication timeout in milliseconds. |
| PLC profile | Required canonical PLC profile. The current editor options are `melsec:iq-f`, `melsec:iq-r`, `melsec:iq-l`, `melsec:mx-f`, `melsec:mx-r`, `melsec:qcpu`, `melsec:lcpu`, `melsec:qnu`, and `melsec:qnudv`. |
| Strict profile | Enabled by default. Rejects high-level features known unavailable on the selected built-in Ethernet profile before sending. |
| Remote password | Optional SLMP remote password credential. When set, the connection unlocks after opening and tries to lock before disconnecting. |
| Monitor timer | SLMP monitoring timer value sent in requests. |
| Network | Target network number, `0` to `255`. |
| Station | Target station number, `0` to `255`. |
| Module I/O | Target module I/O number, entered as hexadecimal such as `03FF`. |
| Multidrop | Target multidrop station number, `0` to `255`. |

## Remote password

Node-RED is the only SLMP package here with a connection-field remote password lifecycle.
When `Remote password` is set on `slmp-connection`, the node unlocks after opening
and tries to lock before disconnecting.

For `C200`-series password end codes, see the shared
[SLMP Troubleshooting & End Codes](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/troubleshooting-end-codes/)
page.

## Routing / target station

Most flows keep the route fields at their defaults, which target the directly
connected own station/control CPU. Change them only when your PLC network is
configured for another station, multi-CPU module I/O, or multidrop access.

Route fields control the SLMP destination header. They are not device family
selectors; routed devices such as `Un\Gn` and `Jn\...` still need their own
address syntax.

Per-request routing can be supplied from a message:

```json
{
  "target": {
    "network": 1,
    "station": 2,
    "moduleIO": "03FF",
    "multidrop": 0
  }
}
```

The same object can be placed in `msg.slmp.target`, or configured through the
Route source on `slmp-read` and `slmp-write`.

`slmp-read` and `slmp-write` use the public high-level address parser for normal
device addresses. They do not expose `Un\G`, `Un\HG`, or `Jn\...` extended
device access as user-facing address forms.

## slmp-read node

| Config field | Description |
| --- | --- |
| Name | Optional label shown in the editor. |
| Connection | The `slmp-connection` config node to use. |
| Source | Where to read the address list from: literal text, `msg`, `flow`, `global`, or `env`. |
| Addresses | Literal address list when Source is literal text. Use one address per line for clarity. |
| Route | Optional per-request route source: literal JSON, `msg`, `flow`, `global`, or `env`. |
| Route JSON | Literal route object with `network`, `station`, `moduleIO`, and `multidrop`. |
| Output | `object`, `array`, or `value` when exactly one address is requested. |
| Metadata | `full`, `minimal`, or `off` for `msg.slmp` output. |
| Errors | Throw, attach to `msg.error`, or send the failed message to a second output. |

| Msg field | Description |
| --- | --- |
| `msg.addresses` | Runtime address list. A string or array here takes priority over the configured Source. |
| `msg.target` | Per-request route override object. |
| `msg.slmp.target` | Per-request route override when `msg.target` is not set. |
| `msg.topic` | `connect`, `disconnect`, or `reinitialize` controls the shared connection instead of reading. |
| `msg.connect` | When `true`, opens the shared connection. |
| `msg.disconnect` | When `true`, closes the shared connection. |
| `msg.reinitialize` | When `true`, closes and reconnects the shared connection. |
| `msg.slmpSkipUnsupported` | When `true`, unsupported-device errors become skipped messages instead of failures. |
| `msg.slmp.skipUnsupported` | Same skip flag inside `msg.slmp`. |

| Output field | Description |
| --- | --- |
| `msg.payload` | Read result. Object mode is keyed by normalized address, array mode follows address order, and value mode returns a scalar for one address. |
| `msg.slmp.addresses` | Full metadata mode only: normalized address list. |
| `msg.slmp.connection` | Full metadata mode only: effective connection profile, strict profile setting, frame type, target, and remote password status. |
| `msg.slmp.target` | Full and minimal metadata modes: effective route target. |
| `msg.slmp.itemCount` | Minimal metadata mode only: number of requested addresses. |
| `msg.error` | Error object when Errors is `msg.error`, or on the second output when Errors is second output. |

## slmp-write node

| Config field | Description |
| --- | --- |
| Name | Optional label shown in the editor. |
| Connection | The `slmp-connection` config node to use. |
| Source | Where to read updates from: literal text, `msg`, `flow`, `global`, or `env`. |
| Static updates | Literal JSON object when Source is literal text. |
| Route | Optional per-request route source: literal JSON, `msg`, `flow`, `global`, or `env`. |
| Route JSON | Literal route object with `network`, `station`, `moduleIO`, and `multidrop`. |
| Metadata | `full`, `minimal`, or `off` for `msg.slmp` output. |
| Errors | Throw, attach to `msg.error`, or send the failed message to a second output. |

| Msg field | Description |
| --- | --- |
| `msg.updates` | Runtime update object, for example `{ "D300:U": 123, "M1000:BIT": true }`. |
| `msg.address` | Single-address write path. |
| `msg.dtype` | Data type for `msg.address` when the address has no suffix. |
| `msg.value` | Single-address write value. Required when `msg.address` is used. |
| `msg.target` | Per-request route override object. |
| `msg.slmp.target` | Per-request route override when `msg.target` is not set. |
| `msg.topic` | `connect`, `disconnect`, or `reinitialize` controls the shared connection instead of writing. |
| `msg.connect` | When `true`, opens the shared connection. |
| `msg.disconnect` | When `true`, closes the shared connection. |
| `msg.reinitialize` | When `true`, closes and reconnects the shared connection. |
| `msg.slmpSkipUnsupported` | When `true`, unsupported-device errors become skipped messages instead of failures. |
| `msg.slmp.skipUnsupported` | Same skip flag inside `msg.slmp`. |

| Output field | Description |
| --- | --- |
| `msg.payload` | The incoming payload is preserved unless your flow changes it before the write. |
| `msg.slmp.updates` | Full metadata mode only: normalized update object. |
| `msg.slmp.connection` | Full metadata mode only: effective connection profile, strict profile setting, frame type, target, and remote password status. |
| `msg.slmp.target` | Full and minimal metadata modes: effective route target. |
| `msg.slmp.itemCount` | Minimal metadata mode only: number of update addresses. |
| `msg.error` | Error object when Errors is `msg.error`, or on the second output when Errors is second output. |

## Address syntax

| Form | Example | Meaning |
| --- | --- | --- |
| Unsigned word | `D100:U` | Unsigned 16-bit word. |
| Signed word | `D100:S` | Signed 16-bit word. |
| Signed word alias | `D100:I` | Alias that normalizes to `D100:S`. |
| Unsigned dword | `D100:D` | Unsigned 32-bit value. |
| Signed dword | `D100:L` | Signed 32-bit value. |
| Float | `D100:F` | 32-bit float. |
| String | `D100:STR,10` | UTF-8 string with a 10-byte maximum, packed two bytes per word. |
| String alias | `DSTR100,10` | Compatibility alias for `D100:STR,10`. |
| Bit in word | `D50.3` | One bit inside a word device. |
| Direct bit | `M1000:BIT` | One bit device. |
| Counted bit | `M1000:BIT,8` | Eight consecutive bit devices. |
| Counted word | `D100:U,4` | Four consecutive word values. |

Named addresses must include the intended type suffix, for example `D100:U` or `M1000:BIT`. The `.bit` form, such as `D50.3`, already declares bit-in-word access.

## Long device families

Use explicit 32-bit forms for long current-value families:

| Family | Use |
| --- | --- |
| `LTN` | `LTN0:D` or `LTN0:L` |
| `LSTN` | `LSTN0:D` or `LSTN0:L` |
| `LCN` | `LCN0:D` or `LCN0:L` |
| `LZ` | `LZ0:D` or `LZ0:L` |

These are 32-bit families. Do not use direct plain word access for them; the lower-level direct word commands reject that shape. The explicit suffix also makes your flow portable and readable.

## Connection control messages

Send any of these fields to `slmp-read` or `slmp-write`:

| Msg field | Effect |
| --- | --- |
| `msg.topic = "connect"` | Opens the shared connection. |
| `msg.topic = "disconnect"` | Closes the shared connection. |
| `msg.topic = "reinitialize"` | Closes and opens the shared connection. |
| `msg.connect = true` | Same as `connect`. |
| `msg.disconnect = true` | Same as `disconnect`. |
| `msg.reinitialize = true` | Same as `reinitialize`. |

## Metadata output

When Metadata is `full`, `msg.slmp` includes:

| Field | Description |
| --- | --- |
| `msg.slmp.addresses` | Normalized read addresses. Present on `slmp-read`. |
| `msg.slmp.updates` | Normalized write updates. Present on `slmp-write`. |
| `msg.slmp.connection` | Connection profile with host, port, transport, PLC profile, strict profile setting, frame type, series, target, and remote password status. |
| `msg.slmp.target` | Effective request target after route overrides. |

When Metadata is `minimal`, `msg.slmp` includes only `target`, `itemCount`, and `metadataMode`.

When Metadata is `off`, the node leaves `msg.slmp` unchanged.

## Error handling

| Mode | Behavior |
| --- | --- |
| Throw | Calls Node-RED `done(error)` and lets the runtime route the error. |
| `msg.error` | Adds the error object to `msg.error` and sends the message on the normal output. |
| Second output | Sends the failed message with `msg.error` on output 2. |

For PLC response errors, read `msg.error.endCode`. When the PLC returned the structured error-information block, `msg.error.errorInfo` includes `command` and `subcommand`.

```javascript
if (msg.error && msg.error.endCode !== undefined) {
    node.warn(`SLMP end_code=0x${msg.error.endCode.toString(16).padStart(4, "0").toUpperCase()}`);
    if (msg.error.errorInfo) {
        node.warn(`command=0x${msg.error.errorInfo.command.toString(16).padStart(4, "0").toUpperCase()}`);
        node.warn(`subcommand=0x${msg.error.errorInfo.subcommand.toString(16).padStart(4, "0").toUpperCase()}`);
    }
}
```

Strict profile failures use `SlmpProfileFeatureError`. In normal flows, fix the selected PLC profile or use a supported operation. Disable Strict profile only for deliberate verification.

Unsupported device-code errors can be converted into skipped messages by sending `msg.slmpSkipUnsupported = true` or `msg.slmp.skipUnsupported = true`.
