# SLMP Node-RED API Reference

This page is a user-facing index of the JavaScript SLMP client surface used by
the Node-RED nodes. Use the usage guide for flow examples, and this page when
you need to find the low-level operation name for a specific SLMP command
family.

The main low-level client type is `SlmpClient` from `lib/slmp/client.js`.

Construction requires `host`, `port`, `transport`, a concrete canonical
`plcProfile`, and exactly one complete `target` or `defaultTarget`. Timeout is
optional with a 3000 ms default. Monitoring timer is optional with a four-second
default (`16` in 250 ms units), accepts exact integers in `0..65535`, and uses
explicit `0` for PLC-side indefinite processing wait. It is independent from
the local communication timeout. TCP enables keepalive after 30 seconds idle.

`remotePassword` is optional. Omit it (or use explicit `undefined`) to disable
managed authentication. When present it must be a printable ASCII string with
the selected profile's exact length rule: 6–32 characters for iQ-R-family
profiles, or exactly 4 for Q/L-family profiles. Null, empty, non-string, and
invalid credentials fail during construction. The credential is private client
state and is not returned by metadata or serialization.

`connect()` accepts no options. If managed authentication is configured, every
new transport generation is unlocked before its first user command. The removed
authentication-bypass option is not part of the public surface; normal, raw,
and password request paths cannot skip the lifecycle. `close()` tries to lock the active authenticated generation,
always closes locally, and rejects when lock or local close fails.

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

`readDevices` and `writeDevices` require a Boolean `bitUnit`. Random and block
writes reject duplicate or overlapping destinations. Named random operations
must fit one protocol request; the library does not split an oversized call.

## Specialized Operations

| Operation | Public API |
| --- | --- |
| Memory command words | `memoryReadWords`, `memoryWriteWords` |
| Extend-unit command bytes | `extendUnitReadBytes`, `extendUnitWriteBytes` |
| Extend-unit command words | `extendUnitReadWords`, `extendUnitWriteWords` |
| Label array access | `readArrayLabels`, `writeArrayLabels` |
| Label random access | `readRandomLabels`, `writeRandomLabels` |
| Remote CPU control | `remoteRun`, `remoteStop`, `remotePause`, `remoteLatchClear`, `remoteReset` |
| Remote password | `remotePasswordUnlock`, `remotePasswordLock` |
| CPU operation state | `readCpuOperationState` |

Remote RUN is `remoteRun({ force, clearMode })`, where `force` is Boolean and
`clearMode` is one of `RemoteClearMode.NO_CLEAR`,
`RemoteClearMode.CLEAR_EXCEPT_LATCH`, or `RemoteClearMode.CLEAR_ALL`. Remote PAUSE is
`remotePause({ force })`. Both fields are required. Remote RESET accepts no
subcommand or response-wait override.

`remotePasswordUnlock` and `remotePasswordLock` are explicit low-level commands
for a client constructed without managed `remotePassword`. They are rejected on
a managed client so a manual lock cannot make its connection-generation state
incorrect. Managed clients use only automatic connect/close authentication.

Monitor registration/cycle APIs are not part of the current Node-RED
low-level client surface.

## High-Level Helpers

| Operation | Public API |
| --- | --- |
| Address parsing and formatting | `parseDevice`, `deviceToString`, `normalizeAddress`, `parseAddress`, `formatParsedAddress` |
| Extended-device model | `SlmpExtendedDevice`, `SlmpIndexZ`, `SlmpIndexLz`, `SlmpIndirect` |
| Typed values | `readTyped`, `writeTyped` |
| Named mixed snapshots | `compileReadPlan`, `readNamed`, `writeNamed` |
| Bit-in-word write | `writeBitInWord` |

All public address-to-number and number-to-address helpers require the
canonical `plcProfile`. `parseDevice` returns an immutable semantic object that
contains that profile. Passing the object to a client configured for another
profile is rejected before transport.

The supported dtype vocabulary is `BIT`, `U`, `S`, `D`, `L`, `F`, and `STR`.
Compatibility spellings `:I`, `:STRING`, and `DSTR...` are not accepted.

The raw request API requires command, subcommand, and an explicit byte payload.
Request `series` and 4E `serial` are not public options; both are derived or
assigned by the client. PLC errors expose the numeric end code, stable
`slmp_end_code_xxxx` key, and structured error information, not localized
manual-derived messages.

## Profile Selection

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
