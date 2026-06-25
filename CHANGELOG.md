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
