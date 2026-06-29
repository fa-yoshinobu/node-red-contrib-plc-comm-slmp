# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Entry labels**

- `Release`: Package/version metadata and publishing preparation.
- `Library`: Runtime behavior, public API, protocol handling, or validation in the distributed library.
- `Node-RED editor`: Node-RED node editor or runtime UI behavior.
- `Docs`: README, user guides, generated API docs, or other documentation-only changes.
- `Samples`: Examples, sample flows, sample scripts, or sample applications.
- `Tests`: Test suites, test fixtures, golden vectors, or verification data.
- `Tooling`: Developer/operator command-line tools and helper utilities.
- `CI`: Release checks, workflow scripts, or automation-only changes.

## [1.1.1] - 2026-06-29

### Changed

- Release: Bumped npm package metadata to `1.1.1`.
- Node-RED editor: Updated read/write address validators and placeholders to require explicit dtype suffixes such as `:U` and `:BIT`.
- Docs: Documented explicit SLMP address dtype requirements in existing user docs.
- Samples: Updated example flows to use explicit dtype suffixes.

## [1.1.0] - 2026-06-29

### Changed

- Release: Bumped npm package metadata to `1.1.0` for stricter Node-RED input validation changes.
- Library: Made named-address parsing require explicit dtype suffixes such as `:U`, `:S`, `:D`, `:L`, `:F`, or `:BIT`; bare devices no longer default to `U`, `BIT`, or long-timer `D`.
- Library: Removed `msg.payload` fallback for read/write parameters; read messages must use `msg.addresses`, and write messages must use `msg.updates` or `msg.address` plus `msg.value`.
- Node-RED editor: Static write updates now require a JSON object; `address=value` line parsing and scalar value fallback are no longer accepted.
- Library: Write clustering now validates that every clustered slot has an explicit source value instead of filling unspecified bit/word slots with `false` or `0`.
- Library: Removed embedded SLMP end-code message text; end-code helpers now return stable code-derived keys while message lookup hooks return `undefined`.
- Docs: Updated SLMP Node-RED usage guidance for explicit message fields, JSON-only static updates, and explicit dtype suffixes.

### Fixed

- Library: Reject unknown dtype suffixes such as `:BOGUS` instead of treating them as word values.
- Library: Made `BIT_IN_WORD` helper addresses require an explicit bit index such as `D100.0` through `D100.F`; `D100:BIT_IN_WORD` now fails in `parseAddress`, `readNamed`, and `writeNamed` instead of silently reading or writing bit 0.
- Tests: Added coverage for rejecting `BIT_IN_WORD` addresses without an explicit bit index.
- Tests: Updated high-level and node tests for explicit dtype requirements, unknown dtype rejection, no `msg.payload` fallback, JSON-only static updates, write-cluster slot validation, and non-embedded end-code messages.

## [1.0.1] - 2026-06-25

### Changed

- Release: Bumped npm package metadata to `1.0.1`.
- Library: Removed the legacy `family` profile alias from SLMP device parsing and high-level helper options; callers should use `plcProfile` or `addressProfile`.
- Node-RED editor: Made the SLMP connection editor require an explicit PLC type selection instead of defaulting to `melsec:iq-r`.

### Fixed

- Samples: Aligned the UDP read/write example flow with the current SLMP UDP sample port (`1035`).
- CI: Updated npm duplicate package version checks to use registry metadata instead of requiring the local npm CLI.

## [1.0.0] - 2026-06-24

### Changed
- Release: Bumped package metadata to `1.0.0` for the first stable release line.

### Fixed
- Library: Fixed the default SLMP port from `5000` to `1025` in `slmp-connection` and direct `SlmpClient` construction.
