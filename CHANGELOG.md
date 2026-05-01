# Changelog

## Unreleased

- remove stale user-guide and TODO wording that still described `LCS` and `LCC`
  as future support; the high-level helpers route reads through direct bit read
  and writes through random bit write (`0x1402`)
- keep `G` and `HG` out of the default public device-matrix flow while they
  remain routed-device follow-up items

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

- require explicit `plcFamily` on the standard packaged client and connection-node route, while keeping manual frame/profile selection only for internal diagnostic paths
- switch the standard device-range example to `readDeviceRangeCatalog()` so the high-level Node surface consistently derives frame, profile, address, and range handling from one family selection

## 0.2.6 - 2026-04-14

- replace connection-node `plcSeries` / `frameType` selection with one explicit `plcFamily` that derives the fixed frame, access profile, address-family, and range-family defaults
- make high-level `X/Y` string addresses require explicit `plcFamily`, treat `iq-f` `X/Y` as octal, and refresh tests, docs, and example flows for the stricter family-driven model

## 0.2.5 - 2026-04-14

- add public device-range catalog helpers and CPU operation-state support to the packaged SLMP client surface
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
