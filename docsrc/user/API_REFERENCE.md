# SLMP Node-RED API Reference

This page is a user-facing index of the JavaScript SLMP client surface used by
the Node-RED nodes. Use the usage guide for flow examples, and this page when
you need to find the low-level operation name for a specific SLMP command
family.

The main low-level client type is `SlmpClient` from `lib/slmp/client.js`.

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
such as `U1\G0`, `U3E0\HG0`, or `J2\SW10` where the route requires it.

The current Node-RED low-level client does not expose separate extended direct
device helpers. Use the extended random APIs for routed random access.

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

Monitor registration/cycle APIs are not part of the current Node-RED
low-level client surface.

## High-Level Helpers

| Operation | Public API |
| --- | --- |
| Address parsing and formatting | `parseDevice`, `deviceToString`, `normalizeAddress`, `parseAddress`, `formatParsedAddress` |
| Extended-device helpers | `normalizeExtensionSpec`, `resolveExtendedDeviceAndExtension`, `encodeExtendedDeviceSpec` |
| Typed values | `readTyped`, `writeTyped` |
| Named mixed snapshots | `compileReadPlan`, `readNamed`, `writeNamed` |
| Bit-in-word write | `writeBitInWord` |

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
