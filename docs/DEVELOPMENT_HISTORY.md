# Development History

## 2026-06-11 Archived Refactor Plan

The previous `refactor-instructions.md` was archived into this history file.

### Scope

- Package: Node-RED node for SLMP communication.
- Primary task: add transport-layer characterization tests, then split TCP/UDP transport mechanics from `lib/slmp/client.js`.
- `nodes/*.js` and `lib/slmp/high-level.js` were explicitly excluded from edits.

### Contracts To Preserve

- `lib/slmp/*` `module.exports` names, signatures, and return values.
- Exact transmitted SLMP byte sequences covered by shared vectors.
- Node settings, `msg` schema, and control messages.
- TCP framing behavior: fragmented receive reassembly, serial-number response matching, timeout handling, and disconnect handling.
- Remote-password unlock/lock ordering during connect and disconnect.
- Dependency-free package metadata, package version, `files` list, and Node-RED registration.

### Debt Notes

- D1: transport state-machine behavior lacked direct tests for fragmented frames, combined frames, timeout, disconnect, and serial mismatch.
- D2: `client.js` mixed command API logic and socket/transport state in one large class.
- D3 and later high-level read-plan work were documented as report-only.

### Planned Verification

- Record a clean baseline and test counts.
- Add transport characterization tests first.
- Move UDP and TCP transport code into a new internal transport module only after tests were in place.
- Run `npm test` after each phase and record moved functions/state plus any skipped areas.

### Out Of Scope

- High-level API changes.
- Node UI/schema changes.
- Shared vector edits.
- Dependency or version changes.
