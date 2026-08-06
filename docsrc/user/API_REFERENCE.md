# SLMP Node-RED API Reference

This page is a user-facing index of the JavaScript SLMP client surface used by
the Node-RED nodes. Use the usage guide for flow examples, and this page when
you need to find the low-level operation name for a specific SLMP command
family.

The main low-level client type is `SlmpClient` from `lib/slmp/client.js`.

Construction requires an IPv4 literal or hostname that resolves to IPv4 in
`host`, plus `port`, `transport`, a concrete canonical
`plcProfile`, and exactly one complete `target` or `defaultTarget`. Timeout is
optional with a 3000 ms default. Monitoring timer is optional with a four-second
default (`16` in 250 ms units), accepts exact integers in `0..65535`, and uses
explicit `0` for PLC-side indefinite processing wait. It is independent from
the local communication timeout. TCP enables keepalive after 30 seconds idle.
IPv6 literals and hostnames without an IPv4 result are rejected; the client
never selects or falls back to IPv6.

Every runtime target field (`network`, `station`, `moduleIO`, and `multidrop`)
must be a primitive finite safe integer Number within its field range. Decimal
or hexadecimal strings, Booleans, boxed Numbers, and coercible objects are not
runtime values. The Node-RED editor separately converts saved connection fields
and literal Route JSON using the displayed field radix.

`remotePassword` is optional. Omit it (or use explicit `undefined`) to disable
managed authentication. When present it must be a printable ASCII string with
the selected profile's exact length rule: 6–32 characters for iQ-R-family
profiles, or exactly 4 for Q/L-family profiles. Null, empty, non-string, and
invalid credentials fail during construction. The credential is private client
state and is not returned by metadata or serialization.

`connect()` accepts no options. If managed authentication is configured, every
new transport generation is unlocked before its first user command. The removed
authentication-bypass option is not part of the public surface; normal, raw,
and password request paths cannot skip the lifecycle. Ordinary client operations
are admitted in FIFO order and only one wire transaction is active at a time.
`close()` invalidates the active queue generation, rejects active and queued
work, and closes the exact transport generation. If the client is idle it first
tries to lock an authenticated generation. If work is active or queued, local
close takes priority and the PLC lock state must be treated as unknown. In that
case `close()` reports `SLMP_OPERATION_OUTCOME_UNKNOWN` with reason `closed`;
the local transport is still closed.
Overlapping `close()` calls share one in-flight promise and therefore one
generation retirement, at most one managed lock attempt, one transport close,
and one success or failure result. Closing state remains active until that
shared operation settles, so `connect()` and normal operations cannot enter
between concurrent close callers. A later sequential close is idempotent.

Each activated transaction has one monotonic absolute deadline covering lazy
connect, managed unlock, send completion, response framing/correlation, and
protocol response decode through the boundary immediately before
command-specific result materialization. Partial frames, wrong serials, and
foreign routes do not restart it. An explicit `connect()` has its own connection
deadline. A timeout before that boundary retires the current transport
generation; no timed-out operation is retried or resent automatically.
Once the public Promise has settled with a successful value, write
acknowledgement, or PLC end code, a later `close()` or deadline cannot replace
that result. Before publication, an incomplete non-state-changing read is
reported as `SlmpClosedError`. An incomplete state-changing request that may
have been sent is instead reported as outcome unknown with reason `closed`.

The FIFO response phase validates the complete transport identity and the
command-specific body shape, including exact lengths, acknowledgement emptiness,
bit nibbles, label boundaries, and self-test echo data. A malformed body retires
that transport generation before another queued wire request can send; a
possibly-sent state change remains outcome-unknown. After validation, pure
array/object/string/Buffer construction may run outside the wire FIFO. Public
Promises still settle in admission order, and `close()` is checked before
materialization and again before publication.

UDP completion additionally requires both a successful `socket.send()`
callback and a matching complete response. Either may arrive first; a response
that arrives first is provisional until send success. Send failure discards it,
retires and closes the UDP socket generation, and preserves the normal
read-only transport or state-changing outcome-unknown classification. Traffic
counters are not updated for a provisional matching response. A socket
error releases the detached socket and ignores all later callbacks and messages
from that generation. Missing send completion or response expires at the one
absolute transaction deadline.

## Direct And Random Device Operations

| Operation | Public API |
| --- | --- |
| Direct device read/write | `readDevices`, `writeDevices` |
| Random read | `readRandom` |
| Extended random read | `readRandomExt` |
| Random word/dword write | `writeRandomWords` |
| Extended random word/dword write | `writeRandomWordsExt` |
| Random bit write | `writeRandomBits` |
| Extended random bit write | `writeRandomBitsExt` |
| Block read/write | `readBlock`, `writeBlock` |
| Type name | `readTypeName` |

Extended random APIs use the 008x subcommands. Use qualified device notation
such as `U1\G0`, `U3E0\HG0`, or `J2\SW10` where the route requires it. Raw
extension fields are not public. When index or indirect modification is needed,
wrap the address in `new SlmpExtendedDevice(address, modification)` with
`SlmpIndexZ`, `SlmpIndexLz`, or `SlmpIndirect`. Extended write tuples are exact
`[device, value]` pairs; the device may be a qualified string or the typed wrapper.

The current Node-RED low-level client does not expose separate extended direct
device helpers. Use the extended random APIs for routed random access.

`readDevices` and `writeDevices` require a Boolean `bitUnit`. With
`bitUnit: true`, the device must be a canonical bit device. Explicit
`bitUnit: false` access may still read or write a packed 16-bit word through a
bit-device family. Random bit entries and Block `bitBlocks` require bit devices;
Block `wordBlocks` require word devices. Random and block writes reject
duplicate or overlapping destinations. Every bit write value is a native
JavaScript Boolean; numeric and string spellings such as `0`, `1`, `"ON"`, and
`"OFF"` are rejected before transport.
Every object-form DeviceRef used by direct, typed, random, block, or monitor
helpers must carry the exact client `plcProfile`; a missing or different
identity is rejected before serial allocation or transport.

Structured device operations must also fit their complete consumed span in the
selected wire device-number field. The exact protocol boundaries are 24 bits
for Q/L and 32 bits for ordinary iQ-R entries. A link-direct `J`-qualified
entry always uses the 24-bit Q/L device specification, including on an iQ-R
client. A normal word or bit consumes one device number,
an ordinary DWord or float consumes two word-device numbers, and a packed
bit-device word or Block bit point consumes 16 bit-device numbers; a low-level
packed bit-device DWord consumes 32. Native long devices keep their
command-specific stride. Direct, Random, Monitor
registration, Block, typed, and named helpers reject a crossing span before
request framing, serial allocation, connection, or traffic accounting. This is
a wire-format check only; profile-catalog practical device ranges are not used
as pre-transport address guards.
Random word/DWord write overlap checks use the same ordinary, packed-bit, and
native long-device widths, so overlapping destinations are rejected without
rejecting valid adjacent native DWords.

`readNamed` emits exactly one Random Read request or rejects the complete plan
before transport. Counted word values, strings, DWord arrays, and packable bit
entries are expanded into Random Read entries and deduplicated within the
selected profile's one-request limit. That expansion and each result index are
compiled once into a private immutable plan reused by send and result mapping;
the plan is not exposed for caller mutation. A long-timer route that requires Direct
Read is never selected implicitly; use `readTyped` or an explicit long-timer
helper. `writeNamed` also must fit exactly one request and rejects the complete
update before I/O otherwise.

For a fixed repeated read, call `prepareReadNamed(client, addresses, options)`
once and retain the returned opaque plan. `await plan.execute({ signal })`
reuses the owned request payload and result indexes while still assigning a new
serial, entering the normal FIFO, enforcing a new absolute deadline, and
checking the current client lifecycle on every execution. An aborted active
execution retires its transport generation so a late response cannot satisfy a
later request. Call `plan.dispose()` when the plan is no longer needed. Disposal
rejects future executions and releases the retained client, payload, and decode
plan references; an execution that was already admitted completes normally.

The prepared plan is bound to the exact `SlmpClient` and its profile, frame,
compatibility, and target signature. It may be reused after an explicit
close/reopen of that same unchanged client, but not with another client or after
a configuration-signature change. `compileReadPlan` remains the inspectable
structural address-expansion API; it is not a send-ready client-bound plan.
`readNamed` remains the one-shot convenience API and does not accept a prepared
plan in place of addresses. The Node-RED read node applies the same API
internally with a one-entry exact-match cache, including for dynamic addresses
and targets.

Numeric high-level writes for `U`, `S`, `D`, `L`, and `F` accept primitive
JavaScript Numbers only. Numeric strings, boxed Numbers, `BigInt`, Booleans,
null, arrays, and coercible objects fail before queue admission. Accepted
integers must retain the existing exact wire range, and `F` must remain finite
after Float32 conversion. Scalar and counted-array forms use the same policy;
`STR` remains string-only and `BIT` remains Boolean-only.

High-level helper options may supply request-scoped values such as `target`.
The helper-generated device lists, value lists, block lists, point counts, and
`bitUnit` route are authoritative and cannot be replaced through that options
object.

## Specialized Operations

| Operation | Public API |
| --- | --- |
| Memory command words | `memoryReadWords`, `memoryWriteWords` |
| Extend-unit command bytes | `extendUnitReadBytes`, `extendUnitWriteBytes` |
| Extend-unit command words | `extendUnitReadWords`, `extendUnitWriteWords` |
| Monitor registration/cycle | `registerMonitorDevices`, `registerMonitorDevicesExt`, `runMonitorCycle` |
| Label array access | `readArrayLabels`, `writeArrayLabels` |
| Label random access | `readRandomLabels`, `writeRandomLabels` |
| Remote CPU control | `remoteRun`, `remoteStop`, `remotePause`, `remoteLatchClear`, `remoteReset` |
| Remote password | `remotePasswordUnlock`, `remotePasswordLock` |
| CPU operation state | `readCpuOperationState` |
| Self-test loopback | `selfTestLoopback` |
| Clear PLC error | `clearError` |

Array label `unitSpecification` is `0` for a logical bit count and `1` for a
logical byte count. Both forms occupy whole two-byte wire units: bit counts use
`ceil(arrayDataLength / 16) * 2` bytes and byte counts use
`ceil(arrayDataLength / 2) * 2` bytes. The logical length must be positive, and
`writeArrayLabels` requires the exact padded buffer length. Random label read
and write data lengths must also be positive and even. Read responses must
match the requested count and, for array labels, each requested unit and
logical length; malformed or trailing data raises `SlmpError`.

Remote RUN is `remoteRun({ force, clearMode })`, where `force` is Boolean and
`clearMode` is one of `RemoteClearMode.NO_CLEAR`,
`RemoteClearMode.CLEAR_EXCEPT_LATCH`, or `RemoteClearMode.CLEAR_ALL`. Remote PAUSE is
`remotePause({ force })`. Both fields are required. Remote RESET accepts no
subcommand or response-wait override.

`remotePasswordUnlock` and `remotePasswordLock` are explicit low-level commands
for a client constructed without managed `remotePassword`. They are rejected on
a managed client so a manual lock cannot make its connection-generation state
incorrect. Managed clients use only automatic connect/close authentication.

Monitor registration and each `runMonitorCycle` call are separate one-request
operations. The cycle requires explicit registered Word and DWord counts. It
does not auto-register, retry, or infer them; the PLC defines the error when a
cycle is requested before registration. `selfTestLoopback` accepts a 1–960 byte
Buffer containing only ASCII `0-9/A-F` and verifies declared length, actual
length, and exact echo. `clearError` always uses the fixed empty payload.

## High-Level Helpers

| Operation | Public API |
| --- | --- |
| Address parsing and formatting | `parseDevice`, `deviceToString`, `normalizeAddress`, `parseAddress`, `formatParsedAddress` |
| Extended-device model | `SlmpExtendedDevice`, `SlmpIndexZ`, `SlmpIndexLz`, `SlmpIndirect` |
| Typed values | `readTyped`, `writeTyped` |
| Named one-request reads and writes | `compileReadPlan`, `prepareReadNamed`, `readNamed`, `writeNamed` |
| Bit-in-word write | `writeBitInWord` (direct or qualified U/J Extended Device route) |

`writeBitInWord` validates and snapshots the complete operation before it enters
the client queue, including both request routes and capacity. It then holds one
ordinary-client FIFO turn and one absolute procedure deadline while it sends one
word read followed by one word write. The write is still sent when the requested
bit already has the desired value. This prevents another operation on the
same client from interleaving between those requests, but it is not an atomic
PLC operation: another connection or PLC program logic can change the word in
the race window, and the read and write can occur in different PLC scans. A
failure after the write may have been sent is outcome-unknown. The helper never
retries automatically; verify PLC state before deciding whether to issue a new
operation.
Direct words use Direct Read/Write. Qualified U module-buffer and J link-direct
words use Extended Random Read/Write, with the exact same qualified route in
both requests. Unsupported profile/route combinations fail before the read.

All public address-to-number and number-to-address helpers require the
canonical `plcProfile`. `parseDevice` returns an immutable semantic object that
contains that profile. Passing the object to a client configured for another
profile is rejected before serial allocation, counters, or transport. This exact
match also applies inside direct, random, block, monitor-registration, and
unit-specific word/bit collections.

The supported dtype vocabulary is `BIT`, `U`, `S`, `D`, `L`, `F`, and `STR`.
Compatibility spellings `:I`, `:STRING`, and `DSTR...` are not accepted.
`:BIT` is valid only for canonical bit devices. Numeric and string dtypes are
valid only for canonical word devices; use the `.0` through `.F` selector for a
semantic bit inside a word device. This semantic rule is separate from explicit
low-level packed word-unit access to a bit-device family.

Public address counts are positive safe integers. `parseAddress()` accepts a
complete ASCII-decimal suffix from `1` through `Number.MAX_SAFE_INTEGER` with
no sign, whitespace, fraction, exponent, non-ASCII digit, or trailing text and
preserves the exact Number. `formatParsedAddress()` accepts a count on a
hand-built object only when `hasCount` is true and `count` is a primitive
positive safe-integer Number; it performs no coercion. Syntax/safe-integer
validation precedes and is separate from each command/profile point limit.

Numeric fields in runtime extension objects also require primitive finite safe
integer Numbers. An explicitly present `null` is invalid; only an omitted
optional field selects its documented default. String qualification in
`Jn\...` and `Un\...` device syntax is unchanged; it is parsed as address syntax
rather than runtime numeric coercion.

The raw request API requires command, subcommand, and an explicit byte payload.
Known commands have a fixed read-only/state-changing classification. Unknown
vendor commands are conservatively state-changing unless the caller supplies
the Boolean `stateChanging: false` assertion.
Request `series` and 4E `serial` are not public options; both are derived or
assigned by the client. PLC errors expose the numeric end code, stable
`slmp_end_code_xxxx` key, and structured error information, not localized
manual-derived messages.

When a non-zero response contains structured error information, its network,
station, module I/O, multidrop, command, and subcommand must match the active
wire request. A mismatch raises a malformed `SlmpError`, closes the supplying
transport generation, and is not a definitive PLC error. A possibly sent
state-changing operation is instead `SlmpOperationOutcomeUnknownError` with
reason `malformed-response`. Bytes after a matching nine-byte prefix remain
available as additional PLC error data. Standard acknowledgement-only APIs
also require an empty data body after end code zero; unexpected data is the
same malformed/outcome-unknown failure. `rawCommand()` is excluded and
continues to return arbitrary successful response data.

Timeout and lifecycle errors are machine-readable: `SlmpTimeoutError`
(`SLMP_TIMEOUT`), `SlmpClosedError` (`SLMP_CLOSED`), and
`SlmpNotConnectedError` (`SLMP_NOT_CONNECTED`). If a state-changing request may
have been sent before timeout, close, or transport failure, the result is
`SlmpOperationOutcomeUnknownError` (`SLMP_OPERATION_OUTCOME_UNKNOWN`). Its
`reason` is `timeout`, `closed`, `transport`, or `malformed-response`, and
`cause` retains the original error. Do not automatically retry outcome-unknown
operations; first verify PLC state.

TCP command payloads are limited to 65,529 bytes. UDP command payloads are
limited to 65,492 bytes for 3E and 65,488 bytes for 4E so the complete frame
fits one datagram. Single-request command builders reject oversized inputs
before transport or serial allocation and never truncate or split them. Label
builders additionally enforce their aggregate payload size; their largest
protocol-representable even payload is 65,528 bytes. `readNamed` never splits a
plan: its expanded Random Read entry count must fit the selected profile limit.

## Profile Selection

`availablePlcProfiles()` returns a new array of canonical, connection-selectable
profile IDs. It excludes `Unspecified` and the base-only `melsec:qcpu` profile;
modifying the returned array does not change the library's profile registry.

`profileDescriptors()` returns canonical name, display name, connection
availability, and base-profile metadata for every profile. The base-only
`melsec:qcpu` entry is included with `connectable: false`; the editor filters
that entry from connection selections.

## Target Module I/O Constants

`ModuleIONo` provides named request-header module I/O numbers for multi-CPU
and routed CPU targets. Use these values in the route object's `moduleIO`
field; omitted route targets still use the own-station route `0x03FF`.

| Constant | Value |
| --- | --- |
| `ModuleIONo.CONTROL_SYSTEM_CPU` | `0x03D0` |
| `ModuleIONo.STANDBY_SYSTEM_CPU` | `0x03D1` |
| `ModuleIONo.SYSTEM_A_CPU` | `0x03D2` |
| `ModuleIONo.SYSTEM_B_CPU` | `0x03D3` |
| `ModuleIONo.MULTIPLE_CPU_1` .. `ModuleIONo.MULTIPLE_CPU_4` | `0x03E0` .. `0x03E3` |
| `ModuleIONo.REMOTE_HEAD_1` / `ModuleIONo.REMOTE_HEAD_2` | `0x03E0` / `0x03E1` |
| `ModuleIONo.CONTROL_SYSTEM_REMOTE_HEAD` / `ModuleIONo.STANDBY_SYSTEM_REMOTE_HEAD` | `0x03D0` / `0x03D1` |
| `ModuleIONo.OWN_STATION` | `0x03FF` |

## Traffic Statistics

`SlmpClient.trafficStats()` returns a frozen `{ requestCount, txBytes, rxBytes }` snapshot.
Counters are cumulative for the client lifetime and are not reset by close or reconnect.
