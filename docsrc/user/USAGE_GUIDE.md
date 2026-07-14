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
| Name | Optional display-only label. Empty/whitespace/non-string values mean no custom label; duplicate labels are allowed and never identify a connection or PLC route. |
| Host | PLC host name or IP address. For the examples, use `192.168.250.100`. |
| Port | TCP or UDP port. Use `1025` for TCP examples and `1035` for UDP examples. |
| Transport | `tcp` or `udp`. |
| Timeout ms | Communication timeout in milliseconds. |
| PLC profile | Required canonical PLC profile. The current editor options are `melsec:iq-f`, `melsec:iq-r`, `melsec:iq-r:rj71en71`, `melsec:iq-l`, `melsec:mx-f`, `melsec:mx-r`, `melsec:mx-r:rj71en71`, `melsec:lcpu`, `melsec:lcpu:lj71e71-100`, `melsec:qcpu:qj71e71-100`, `melsec:qnu`, `melsec:qnu:qj71e71-100`, `melsec:qnudv`, and `melsec:qnudv:qj71e71-100`. |
| Use remote password | Explicitly enables the remote-password lifecycle. Leave unchecked when the PLC route does not use it. |
| Remote password | Required and non-empty when Use remote password is checked. Disabled otherwise. |
| Monitor timer | SLMP monitoring timer field in 250 ms units, `0` to `65535`. A new node starts at `16` (four seconds). An explicit `0` requests an indefinite PLC-side processing wait. |
| Network | Target network number, `0` to `255`. |
| Station | Target station number, `0` to `255`. |
| Module I/O | Target module I/O number, entered as hexadecimal such as `03FF`. |
| Multidrop | Target multidrop station number, `0` to `255`. |

Requests that share one `slmp-connection` are sent in FIFO order. The next
request waits until the previous request has received a response, timed out, or
failed. This is intentional for SLMP compatibility because PLCs have
model-dependent limits for commands sent before earlier responses arrive.

TCP connections enable keepalive after 30 seconds idle. UDP timeouts discard
the timed-out socket generation before a later request can open a new one.

The monitor timer and `Timeout ms` control different waits. The monitor timer
is sent to the PLC. `Timeout ms` is the local communication deadline. Therefore,
even when the monitor timer is explicitly `0`, the client can still end the
request when its communication timeout expires. Missing monitor timer settings
use `16`; null, blank, Boolean, fractional, negative, non-finite, and
out-of-range values are configuration errors rather than defaults.

For parallel communication, use separate `slmp-connection` config nodes. Each
config node owns its own client connection and therefore its own request queue.

## Remote password

Node-RED is the only SLMP package here with a connection-field remote password lifecycle.
When `Use remote password` is checked and a non-empty credential is set, the node unlocks after opening
and tries to lock before disconnecting. The field is disabled and not forwarded when the checkbox is
off. When it is on, iQ-R credentials must be 6–32 printable ASCII characters and Q/L credentials must
be exactly 4 printable ASCII characters.

Authentication belongs to one concrete TCP/UDP connection. A reconnect unlocks again before the first
normal command; a failed normal command is never replayed automatically. Disconnect always closes the
local transport. If the PLC rejects the final lock or the lock times out, the disconnect operation
reports that failure and does not claim that the PLC is locked.

For `C200`-series password end codes, see the shared
[SLMP Troubleshooting & Codes](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/troubleshooting-codes/)
page.

## Routing / target station

Every saved connection explicitly contains all four route fields. The editor
initializes a new connection for the directly connected own station. Change
those values only when your PLC network is configured for another station,
multi-CPU module I/O, or multidrop access.

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

Route priority is `msg.target`, `msg.slmp.target`, configured Route source, then
the connection route when no override is present. If a higher-priority property
or configured source exists but is invalid or missing its referenced value, the
operation fails; it does not continue to a different PLC route.

JavaScript code that calls the low-level client can use `ModuleIONo` constants
for `moduleIO`, for example `ModuleIONo.MULTIPLE_CPU_2`. Low-level clients must
receive a complete route; a missing or partial route is rejected.

For low-level iQ-R multi-CPU `U3En\HG...` access, the qualified device never
changes the request target. The application must explicitly select the target
CPU when a write must be reflected there. A write can return a normal end code
without changing the intended CPU buffer when the selected request target
identifies a different CPU or Own Station; cross-CPU reads remain valid. No
automatic target fallback, resend, readback, or retry is performed. See the
shared [iQ-R target guidance](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/iq-r/#multi-cpu-cpu-buffer-target).

Low-level `SlmpClient` users can register Word/DWord monitor devices with
`registerMonitorDevices` or `registerMonitorDevicesExt`, then execute one cycle
with explicit `wordPoints` and `dwordPoints`. `selfTestLoopback(Buffer)` and
`clearError()` provide fixed semantic system commands without raw command
numbers. The combined monitor count must be nonzero and cannot exceed the
selected profile's monitor-registration limit. These low-level operations are
not additional Node-RED node types.

`slmp-read` and `slmp-write` use the public high-level address parser for normal
device addresses. They do not expose `Un\G`, `Un\HG`, or `Jn\...` extended
device access as user-facing address forms.

## slmp-read node

| Config field | Description |
| --- | --- |
| Name | Optional display-only label; it is not sent, emitted as metadata, or used as the connection identity. |
| Connection | The `slmp-connection` config node to use. |
| Source | Where to read the address list from: literal text, `msg`, `flow`, `global`, or `env`. |
| Addresses | Literal address list when Source is literal text. Use one address per line for clarity. |
| Route | Optional per-request route source: literal JSON, `msg`, `flow`, `global`, or `env`. |
| Route JSON | Literal route object with `network`, `station`, `moduleIO`, and `multidrop`. |
| Output | `object` always returns an address-keyed object, `array` always returns an array, and `value` requires exactly one address. |
| Metadata | `full`, `minimal`, or `off` for `msg.slmp` output. |
| Errors | Throw, attach to `msg.error`, or send the failed message to a second output. |

| Msg field | Description |
| --- | --- |
| `msg.addresses` | When present, a non-empty string or an array containing only non-empty address strings. Invalid input fails and never falls back to the configured Source. |
| `msg.target` | Per-request route override object. |
| `msg.slmp.target` | Per-request route override when `msg.target` is not set. |
| `msg.topic` | `connect`, `disconnect`, or `reinitialize` controls the shared connection instead of reading. |
| `msg.connect` | When `true`, opens the shared connection. |
| `msg.disconnect` | When `true`, closes the shared connection. |
| `msg.reinitialize` | When `true`, closes and reconnects the shared connection. |

| Output field | Description |
| --- | --- |
| `msg.payload` | Read result. Object mode is keyed by normalized address, array mode follows address order, and value mode returns a scalar for one address. |
| `msg.slmp.addresses` | Full metadata mode only: normalized address list. |
| `msg.slmp.connection` | Full metadata mode only: effective connection profile, frame type, target, and remote password status. |
| `msg.slmp.target` | Full and minimal metadata modes: effective route target. |
| `msg.slmp.targetSource` | Full and minimal metadata modes: `msg.target`, `msg.slmp.target`, `configured.<type>`, or `connection`. |
| `msg.slmp.itemCount` | Minimal metadata mode only: number of requested addresses. |
| `msg.error` | Error object when Errors is `msg.error`, or on the second output when Errors is second output. |

## slmp-write node

| Config field | Description |
| --- | --- |
| Name | Optional display-only label; it is not sent, emitted as metadata, or used as the connection identity. |
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
| `msg.dtype` | Required for a bare single-write address. Use exactly `BIT`, `U`, `S`, `D`, `L`, `F`, or `STR`. Omit it when the address already contains a complete dtype or word-bit selector; specifying both is an error. |
| `msg.value` | Single-address write value. Required when `msg.address` is used. |
| `msg.target` | Per-request route override object. |
| `msg.slmp.target` | Per-request route override when `msg.target` is not set. |
| `msg.topic` | `connect`, `disconnect`, or `reinitialize` controls the shared connection instead of writing. |
| `msg.connect` | When `true`, opens the shared connection. |
| `msg.disconnect` | When `true`, closes the shared connection. |
| `msg.reinitialize` | When `true`, closes and reconnects the shared connection. |

Runtime write fields are authoritative when present. `msg.updates` and
`msg.address` are mutually exclusive, and `msg.value`/`msg.dtype` are valid only
with `msg.address`. Invalid, empty, conflicting, or isolated runtime fields fail;
the node does not execute configured updates as a fallback.
Single-write dtype must come from exactly one source. A colon or period in
`msg.address` must form a complete supported dtype/count or word-bit selector;
an incomplete or conflicting selector is not completed from `msg.dtype`.

| Output field | Description |
| --- | --- |
| `msg.payload` | The incoming payload is preserved unless your flow changes it before the write. |
| `msg.slmp.updates` | Full metadata mode only: normalized update object. |
| `msg.slmp.connection` | Full metadata mode only: effective connection profile, frame type, target, and remote password status. |
| `msg.slmp.target` | Full and minimal metadata modes: effective route target. |
| `msg.slmp.targetSource` | Full and minimal metadata modes: selected route source. |
| `msg.slmp.itemCount` | Minimal metadata mode only: number of update addresses. |
| `msg.error` | Error object when Errors is `msg.error`, or on the second output when Errors is second output. |

## Address syntax

| Form | Example | Meaning |
| --- | --- | --- |
| Unsigned word | `D100:U` | Unsigned 16-bit word. |
| Signed word | `D100:S` | Signed 16-bit word. |
| Unsigned dword | `D100:D` | Unsigned 32-bit value. |
| Signed dword | `D100:L` | Signed 32-bit value. |
| Float | `D100:F` | 32-bit float. |
| String | `D100:STR,10` | UTF-8 string with a 10-byte maximum, packed two bytes per word. |
| Bit in word | `D50.3` | One bit inside a word device. |
| Direct bit | `M1000:BIT` | One bit device. |
| Counted bit | `M1000:BIT,8` | One contiguous bit request. |
| Counted word | `D100:U,4` | One word block inside a single block request. |

Named addresses must include the intended type suffix, for example `D100:U` or `M1000:BIT`. The `.bit` form, such as `D50.3`, already declares bit-in-word access.

Use only `BIT`, `U`, `S`, `D`, `L`, `F`, and `STR`. The removed compatibility
spellings `:I`, `:STRING`, and `DSTR...` are rejected. `readNamed` and
`writeNamed` accept only update sets that compile to one protocol request.
Compatible word blocks, including counted and string entries, may share one
block request. Mixed command families and bit-in-word read-modify-write are
rejected before transport. Use explicit APIs when multiple commands are required.

Direct write values are not coerced: word/DWord values must be exact in-range
integers and bits must be Boolean or numeric 0/1. Named writes also reject
overlapping destinations. Extended random-read result keys append `+Zn`,
`+LZn`, or `+INDIRECT` when a modifier is present.

`remoteReset` confirms that the request frame was transmitted, closes the
current transport generation, and does not confirm PLC execution. Reconnect
and verify PLC state before issuing another operation.

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

## Operational recipes

The `examples/flows/slmp-multi-plc-monitor.json` flow is a read-only multi-PLC monitor. It polls `D100:U`, emits long-form rows shaped as `timestamp,plc,tag,value`, and uses `connected`, `lost`, `reconnecting`, and `recovered` state transitions with a 1 second to 30 second backoff.

For config-driven polling, keep a JSON config in an Inject or Function node and feed `msg.addresses` into `slmp-read`; no extra node type is required.

To persist CSV-equivalent rows, route the long-form row messages through a CSV node with `timestamp`, `plc`, `tag`, and `value` columns, then into a File node in append mode.

## Metadata output

When Metadata is `full`, `msg.slmp` includes:

| Field | Description |
| --- | --- |
| `msg.slmp.addresses` | Normalized read addresses. Present on `slmp-read`. |
| `msg.slmp.updates` | Normalized write updates. Present on `slmp-write`. |
| `msg.slmp.connection` | Connection profile with host, port, transport, PLC profile, frame type, series, target, and remote password status. |
| `msg.slmp.target` | Effective request target after route overrides. |
| `msg.slmp.targetSource` | Selected route source and therefore why that target was used. |

When Metadata is `minimal`, `msg.slmp` includes `operation`, `target`,
`targetSource`, `itemCount`, and `metadataMode`.

When Metadata is `off`, the node leaves `msg.slmp` unchanged. Any pre-existing
value is not guaranteed to describe the current operation or result.

## Error handling

Success is always sent through output 1. The selected error mode determines the
only failure route and therefore the saved terminal count: `throw` and `msg`
have one terminal, while `output2` has two. A flow whose saved count conflicts
with the selected mode is rejected for migration review.

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

Profile capability failures use `SlmpProfileFeatureError`. Select the exact PLC
profile and use a supported operation. Normal public APIs do not provide a
profile-check bypass or an unsupported-device skip switch.

Older Function nodes may still add `msg.slmpSkipUnsupported` or
`msg.slmp.skipUnsupported`. These inputs have been removed and produce a runtime
migration warning. They never change the selected error route. To continue a
flow after a specific capability error, select `msg.error` or the second output
and make that decision explicitly in the application flow.
## Traffic statistics

The low-level `SlmpClient.trafficStats()` method returns a frozen client-lifetime snapshot with
`requestCount`, `txBytes`, and `rxBytes`. Complete sends and complete received frames are counted;
close and reconnect do not reset the snapshot.
