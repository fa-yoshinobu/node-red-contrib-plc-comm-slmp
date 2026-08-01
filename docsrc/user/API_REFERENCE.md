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

Each activated transaction has one monotonic absolute deadline covering lazy
connect, managed unlock, send completion, response framing/correlation, and
protocol response decode through the boundary immediately before
command-specific result materialization. Partial frames, wrong serials, and
foreign routes do not restart it. An explicit `connect()` has its own connection
deadline. A timeout before that boundary retires the current transport
generation; no timed-out operation is retried or resent automatically.
Once a response has decoded to success, a write acknowledgement, or a PLC end
code, that result is definitive even if `close()` runs concurrently or the
deadline passes afterward. An
incomplete non-state-changing read is reported as `SlmpClosedError`. An
incomplete state-changing request that may have been sent is instead reported
as outcome unknown with reason `closed`.

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
selected profile's one-request limit. A long-timer route that requires Direct
Read is never selected implicitly; use `readTyped` or an explicit long-timer
helper. `writeNamed` also must fit exactly one request and rejects the complete
update before I/O otherwise.

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
| Named one-request reads and writes | `compileReadPlan`, `readNamed`, `writeNamed` |
| Bit-in-word write | `writeBitInWord` |

`writeBitInWord` validates and snapshots the complete operation before it enters
the client queue. It then holds one ordinary-client FIFO turn while it sends one
word read followed by one word write. This prevents another operation on the
same client from interleaving between those requests, but it is not an atomic
PLC operation: another connection or PLC program logic can change the word in
the race window, and the read and write can occur in different PLC scans. A
failure after the write may have been sent is outcome-unknown. The helper never
retries automatically; verify PLC state before deciding whether to issue a new
operation.

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

Timeout and lifecycle errors are machine-readable: `SlmpTimeoutError`
(`SLMP_TIMEOUT`), `SlmpClosedError` (`SLMP_CLOSED`), and
`SlmpNotConnectedError` (`SLMP_NOT_CONNECTED`). If a state-changing request may
have been sent before timeout, close, or transport failure, the result is
`SlmpOperationOutcomeUnknownError` (`SLMP_OPERATION_OUTCOME_UNKNOWN`). Its
`reason` is `timeout`, `closed`, or `transport`, and `cause` retains the original
error. Do not automatically retry outcome-unknown operations; first verify PLC
state.

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
