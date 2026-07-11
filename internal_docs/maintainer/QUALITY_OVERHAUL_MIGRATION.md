# Node-RED SLMP Quality Overhaul

This maintainer record preserves approved target contracts, compatibility impact, acceptance criteria, and verification evidence. User pages describe only the resulting supported behavior.

## NR-SLMP-OH-001 — Explicit connection and route identity

Scope: `SlmpClient`, `slmp-connection`, saved example flows, and route overrides.

Target contract: port, transport, concrete PLC profile, and all four route fields are explicit. Editor defaults initialize a new node only; missing runtime or saved values are not silently repaired. Timeout defaults to 3000 ms and monitoring timer to `0x0010`.

Compatibility impact: implicit TCP/port/profile/partial-target construction is removed.

Acceptance criteria:

1. Missing/blank port, missing transport/profile, partial target, alias conflict, and invalid integer shapes fail before transport.
2. Complete connection targets are inherited when a request target is omitted; a request override must itself be complete.
3. Example flows contain explicit connection settings and deploy through editor smoke validation.

## NR-SLMP-OH-002 — Profile-derived wire behavior

Scope: semantic device objects, device parsers, direct/random/block APIs, raw request options, and 4E transport.

Target contract: semantic devices retain canonical `plcProfile`; client/device mismatch fails before transport. Series comes from the profile and 4E serial is assigned and matched internally. Raw command requires command, subcommand, and explicit byte payload.

Compatibility impact: request `series`/`serial`, profileless semantic addresses, implicit raw subcommand/payload, and public strict-profile option are removed.

Acceptance criteria:

1. Profile-sensitive X/Y parsing and formatting retain their profile and reject cross-profile reuse.
2. User-supplied series/serial and missing raw fields produce zero requests.
3. Concurrent calls preserve FIFO send order, 4E responses match serial, and timeout/failure releases or destroys transport state safely.

## NR-SLMP-OH-003 — One-request boundaries and write identity

Scope: named random reads/writes and low-level random/extended-random/block writes.

Target contract: an operation that exceeds one request is rejected before transport rather than chunked. Random and block writes reject duplicate or overlapping destinations, including DWord spans and equal extended routes.

Compatibility impact: hidden random chunking is removed; previously accepted ambiguous overlapping writes fail.

Acceptance criteria:

1. A 97-device iQ-R named random read and an 81-word named random write issue zero requests.
2. Word/DWord overlap, DWord/DWord overlap, duplicate bits, block overlap, and equal-route extended overlap issue zero requests.
3. A bit-in-word that can join a random read is included in that single random request rather than causing a second direct read.

## NR-SLMP-OH-004 — Explicit control and authentication intent

Scope: Remote RUN/PAUSE/RESET and Node-RED remote-password configuration.

Target contract: RUN requires Boolean `force` and clear mode `0..2`; PAUSE requires Boolean `force`; RESET fixes subcommand/payload/no-response behavior. Node-RED remote password requires an explicit enable checkbox and a non-empty credential when enabled.

Compatibility impact: defaulted control intent and password-text-presence enablement are removed.

Acceptance criteria:

1. Missing/null/wrong-type RUN/PAUSE fields fail with zero requests.
2. RESET rejects public wire overrides and sends its fixed request without response wait.
3. A missing/non-Boolean password-enable field or an enabled empty credential fails during node construction; disabled authentication never forwards a stored credential.

## NR-SLMP-OH-005 — Stable errors and transport generations

Scope: end-code surface, TCP keepalive, UDP timeout, and Node-RED error modes.

Target contract: errors retain numeric code, stable key, structured fields, and password classification without localized message hooks. TCP keepalive begins after 30 seconds idle. UDP timeout closes and detaches the old socket generation. Node error handling follows only the configured throw/message/second-output mode.

Compatibility impact: `getEndCodeMessage`, `endCodeMessage`, unsupported-device skip overrides, and hidden transport reuse are removed.

Acceptance criteria:

1. Removed end-code message symbols are absent from exports and error instances.
2. TCP calls `setKeepAlive(true, 30000)` and UDP ignores delayed data from a timed-out generation.
3. Removed skip flags cannot bypass the selected error mode.

## NR-SLMP-OH-006 — Canonical Node-RED runtime contract

Scope: connection/read/write editor definitions, runtime overrides, output shape, metadata ownership, and examples.

Target contract: required source types and enum fields are validated exactly. `msg.addresses`, `msg.updates`, and single-write fields are mutually consistent. Bare single-write addresses require one exact dtype. Metadata full/minimal/off modes own and clear a defined field set.

Compatibility impact: inferred source types, unknown enum fallback, scalar/payload fallback, dtype aliases, and stale owned metadata are removed.

Acceptance criteria:

1. Invalid source/enum/output-count/runtime-override combinations fail deterministically.
2. Single write dtype is specified exactly once and is one of `BIT/U/S/D/L/F/STR`.
3. Editor smoke and all example flow validation pass.

## Verification checklist

- [x] Implementation completed for NR-SLMP-OH-001 through NR-SLMP-OH-006 in this repository.
- [x] Tests added or updated for the machine-verifiable acceptance criteria.
- [x] `npm test` passes 132 tests with zero skip, including four vendored shared-vector groups.
- [x] Node-RED editor smoke test passes.
- [x] `npm pack --dry-run` succeeds and contains only intended user/runtime/package files.
- [x] Codex self-review completed for public API, validation order, serial/response handling, timeout/UDP state, write overlap, Node runtime modes, docs, examples, and package contents.
- [ ] Claude source review completed and findings recorded — pending user authorization; Claude has not been invoked.
- [ ] Codex resolved or dispositioned every Claude finding and reran affected checks — pending Claude review.
- [x] No new live-PLC result is required to decide these API/validation/transport-generation contracts; existing profile capability evidence was not changed to pass.
- [x] Documentation, migration notes, changelog, examples, and API reference agree with implementation.
- [ ] Final acceptance completed — pending Claude review and cross-library final consistency review.

## Live verification disposition

The changed acceptance criteria are fully observable through parser, mock transport, local TCP socket, editor, shared-vector, and package tests. No command in this batch requires a PLC response to distinguish pass from fail. Existing profile capability rows and hardware-specific compatibility remain unchanged and retain their prior verified/unverified state.

## Claude review status

Pending user authorization. Before invoking Claude, present this repository and diff scope, NR-SLMP-OH decisions, test/package evidence, supplied review material, and expected finding format, then wait for explicit authorization for that batch.
