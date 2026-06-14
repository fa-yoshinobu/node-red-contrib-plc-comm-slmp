# Changelog

## Unreleased

- fix the default SLMP port from `5000` to `1025` in `slmp-connection` and direct `SlmpClient` construction

## 0.8.0 - 2026-06-14

- bump the package revision to 0.8.0 for the unified PLC communication library release

## 0.2.14 - 2026-06-12

- add an optional `Remote password` credential to `slmp-connection`; configured connections unlock remote-password protection after opening SLMP transport and try to lock it before disconnecting
- add SLMP end-code name/message helpers backed by the full English communication error-code table, and expose remote-password end-code classification on `SlmpError`
- reject the non-manual `remoteStop({ force: true })` option; Remote STOP now exposes only the manual fixed request data `01 00`
- restrict `plcProfile` text parsing to canonical `melsec:...` profile names; short aliases such as `iq-r`, `iqr`, `q`, and `qnudvcpu` are now rejected
- add manual point-limit preflight checks for continuous, random, block, memory, and helper-layer requests so oversized requests fail before transport
- fix `writeBlock()` payload layout so each `1406` block writes its data immediately after that block's device spec and point count
- add maintainer notes for the resolved mixed `1406` layout root cause and current no-fallback behavior
- clarify that `G` and `HG` are intentionally unsupported in the public Node-RED high-level surface, not pending TODO items
- reject direct `G` and `HG` device names even when no `plcProfile` is supplied, keeping the public surface from sending unitless Extended Specification-only devices

## 0.2.12 - 2026-05-02

- bump the release revision for npm and Node-RED Flow Library publishing; the Flow Library currently shows `0.2.3` as the public baseline
- refresh README, user-guide, latest-verification, and example-flow docs with compatibility notes from the published Flow Library version
- document the public compatibility change from separate `PLC series` / `frame type` fields to one PLC profile selector
- document the public device-scope changes since Flow Library `0.2.3`: `LTS`, `LTC`, `LSTS`, `LSTC`, `LCS`, `LCC`, and `LZ` are now in the high-level surface where the selected PLC profile supports them
- document the current device-matrix flow behavior: one-click run-all read/write buttons, status-lamp feedback, JSONL result logging, `plcProfile` records, and skip/error summary counts

## 0.2.11 - 2026-05-02

- remove the interim device-range catalog helper from the Node-RED package
- keep ordinary Node-RED read/write validation to address format and protocol constraints, leaving actual device-range errors to the PLC response
- reject device codes that the selected `plcProfile` does not expose in the public high-level table, aligned with the .NET `DEVICE_RANGES.md` support matrix

- remove stale user-guide and TODO wording that still described `LCS` and `LCC`
  as future support; the high-level helpers route reads through direct bit read
  and writes through random bit write (`0x1402`)
- keep `G` and `HG` out of the default public device-matrix flow because they
  are not part of the public high-level surface

## 0.2.10 - 2026-04-27

- tighten SLMP device-name parsing to split by known device code instead of a greedy letter regex, so hexadecimal addresses such as `XFF` and `SWFF` parse correctly
- fail matched-device invalid numbers as that device code instead of treating them as a different unknown code shape

## 0.2.9 - 2026-04-27

- add packaged helper support for remote control, memory read/write, extend-unit read/write, and label array/random read/write commands
- add low-level tests for the new helper payloads and response parsing
- expand Node-RED wrapper participation in the shared cross-library parity suite

## 0.2.8 - 2026-04-27

- tighten long-device route guards so `LTN/LSTN/LCN/LZ` avoid unsupported direct/raw word and dword paths, while supported random/named dword paths remain available
- align `LCS/LCC` writes with the random/named bit route policy

## 0.2.7 - 2026-04-14

- require explicit `plcProfile` on the standard packaged client and connection-node route, while keeping manual frame/profile selection only for internal diagnostic paths
- switch the standard device-range example to the interim catalog helper so the high-level Node surface consistently derives frame, profile, address, and range handling from one profile selection

## 0.2.6 - 2026-04-14

- replace connection-node `plcSeries` / `frameType` selection with one explicit `plcProfile` that derives the fixed frame, access profile, address profile, and range profile defaults
- make high-level `X/Y` string addresses require explicit `plcProfile`, treat `iq-f` `X/Y` as octal, and refresh tests, docs, and example flows for the stricter profile-driven model

## 0.2.5 - 2026-04-14

- add interim device-range catalog helpers and CPU operation-state support to the packaged SLMP client surface
- add regression tests and README coverage for the new device-range and CPU-state helpers

## 0.2.4 - 2026-04-13

- add client-side guard logic for unsupported long-timer direct reads and unsupported `LCS/LCC` random, block, and monitor-registration commands
- align long-counter helper behavior and core tests with the shared cross-library consistency rules

## 0.2.3 - 2026-04-13

- CI now checks out `plc-comm-slmp-cross-verify/specs/shared` before running the shared-vector tests, so the Node package validates against the canonical cross-library parity vectors.

## 0.2.2 - 2026-04-01

- add an optional `npm run smoke:editor` script that installs the local package into an isolated userDir, starts a temporary Node-RED runtime, imports `slmp-basic-read-write.json`, and verifies the flow starts cleanly
- refresh README, user guide, and example-flow docs with the editor-smoke command and the current canonical-address helper exports

## 0.2.1 - 2026-03-28

- move npm package publishing to the scoped name `@fa_yoshinobu/node-red-contrib-plc-comm-slmp`
- refresh README and user documentation for Flow Library submission, npm badges, and scoped install commands

## 0.2.0 - 2026-03-28

- add `slmp-connection`, `slmp-read`, and `slmp-write` nodes for binary 3E/4E over TCP and UDP
- add named address helpers including `,count`, string access, route overrides, and connection control messages
- add editor validation, example flows, README improvements, and user/maintainer documentation
- add local test coverage and package dry-run validation
