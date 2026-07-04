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

## [Unreleased]

### Changed

- Library: Added non-breaking SLMP specification-audit updates for point-limit guards and PLC error diagnostics.
- Library: Exposed structured PLC error information on decoded responses and `SlmpError.errorInfo` when a non-zero end-code response carries the 9-byte error information block.
- Library: Enforced the documented iQ-F direct bit access limit of 3584 points before transport while keeping the existing 7168-point limit for non-iQ-F profiles.
- Library: Embedded the `plc-comm-slmp-profiles` `v1.1.0` built-in Ethernet capability table and added strict profile guards for high-level `type_name`, `direct`, `random`, and `block` routes.
- Library: Added `SlmpProfileFeatureError` for profile feature guards, including profile ID, feature key, state, evidence, and the `strictProfile=false` escape hatch.
- Library: Replaced series-only random/direct point-limit guards with capability-table limits when a measured profile is selected; limits and write policy remain enforced even when strict profile is disabled.
- Library: Added canonical weighted random-word write limits for `melsec:iq-l` and `melsec:iq-f`, so mixed word/dword random writes are guarded before transport.
- Library: Refreshed capability data with explicit 008x extended random/monitor limit keys.
- Library: Added SLMP `S` step relay device-code support for reads and profile-specific write policy enforcement.
- Tooling: Changed the canonical profile update script default ref from `v1.0.0` to `v1.1.0`.
- Library: Enforced capability write policies independently of `strictProfile`; `S` is read-only on iQ-R/iQ-L/MX/Q/L profiles and read-write on iQ-F.
- Library: Separated profile-unsupported device families from standalone `G/HG` public high-level rejection so route-only devices are not reported as profile-unsupported.
- Library: Rejected standalone `G/HG` access on direct, random, block, and monitor-register routes; callers should use U-qualified extended access.
- Library: Rejected `G/HG` random bit writes and aligned long counter state metadata so `LCS/LCC` remain long-helper entries while using their direct bit-read route internally.
- Library: Moved Q/L profile Read Block (`0x0406`) and Write Block (`0x1406`) rejection to the capability profile guard so `strictProfile=false` can intentionally send the request and let the PLC answer.
- Library: Batched named plain-bit reads through random word-read only for `SM/X/Y/M/L/F/V/B/SB`; `TS/TC/STS/STC/CS/CC/DX/DY` stay on direct bit reads.
- Node-RED editor: Added a Strict profile checkbox to `slmp-connection`, enabled by default.
- Docs: Documented profile-specific `S` write policy and clarified `G/HG` guidance in the public Node-RED docs.
- Docs: Documented strict profile behavior, applied feature keys, and Node-RED out-of-scope capability keys.
- Docs: Removed the duplicated SLMP supported-register user page and linked users to the shared SLMP Profile Reference.
- Docs: Added a Usage Guide example showing how to read `msg.error.endCode` and structured `msg.error.errorInfo`.
- Docs: Clarified that public read/write nodes do not expose `Un\G`, `Un\HG`, or `Jn\...` extended device address forms.
- Docs: Removed the manual page-navigation block from Getting Started and rely on site navigation instead.
- Docs: Moved shared SLMP gotcha items to the common troubleshooting page and kept Gotchas focused on Node-RED-specific behavior.
- Docs: Slimmed Gotchas to Node-RED-specific items and moved shared setup/end-code symptoms to the PLC Setup Guide.
- Docs: Standardized the Gotchas page structure with KV Host Link so library-specific caveats have the same destination across protocols.
- Docs: Cleaned up maintainer notes and normalized the root TODO.
- Release: Excluded maintainer-only files, scripts, and tests from generated source archives via `.gitattributes`.
- Tooling: Changed the canonical profile update script default ref from `main` to fixed tag `v1.0.0`; `SLMP_PROFILES_REF` can still override it.
- Tests: Added a canonical capability JSON fixture comparison and strict profile guard coverage.
- Tests: Added guard coverage for `S` read-only writes and monitor-register `G/HG` rejection.
- Tests: Added guard coverage that QCPU/QnU/QnUDV use the dedicated strict profile error for blocked routes.
- Tests: Added named-read coverage for random-word-safe plain bit families versus direct-bit-only families.

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
