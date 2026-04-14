# Changelog

## Unreleased

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
