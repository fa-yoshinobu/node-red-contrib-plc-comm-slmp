# Quality Overhaul Decisions — 2026-08-02

This maintainer record preserves approved target-state decisions before implementation. A checked
acceptance box requires recorded evidence; approval or intent alone is not completion evidence.

## Repository-local verification evidence

- Targeted core and high-level tests: `node --test test/slmp-core.test.js test/slmp-high-level.test.js`,
  248 passed, 0 failed after the final UDP traffic-accounting correction.
- Full repository gate on the final source state: `run_ci.bat`, 260 passed, 0 failed; npm audit
  reported 0 findings and package construction/content validation passed.
- Current-worktree source archive: 66 files passed. Installed-package consumer: 34 files and eight
  flows passed. All tracked JavaScript syntax and example-flow JSON checks passed.
- Diff review: `git diff --check` passed. Codex inspected the public API surface, validation order,
  response identity, ACK decoding, lifecycle generations, concurrent close state, UDP races,
  traffic counters, tests, user/API documentation, migration notes, changelog, and package evidence.
- Live PLC: not required for these items. Their response vectors, race schedules, validation order,
  socket retirement, and local-port release are deterministically observable with fake or local
  peers and no hardware-dependent fact is being asserted.

Self-review dispositions: accepted and corrected an unapproved public malformed-response code, stale
ACK test doubles, numeric-string success expectations, a fake-socket close event, and provisional UDP
receive-byte publication. Rejected exact-nine-byte error-info enforcement, `rawCommand()` empty-ACK
enforcement, and compatibility numeric coercion because each conflicts with the approved contract.
Duplicate: none. Deferred: none.

## SLMP-ERROR-INFO-CORRELATION-001 — Correlate present PLC error information with the active request

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

All Node.js SLMP 3E/4E TCP and UDP response paths that receive a non-zero end code and at least the
9-byte PLC error-information prefix, including state-changing and read-only command paths, error
objects, transport invalidation, tests, user documentation, migration notes, and changelog entries.
The cross-language contract applies to the Node.js, Python, Rust, C++, and .NET SLMP implementations.

### Target contract

When a non-zero-end-code response contains the 9-byte PLC error-information prefix, the embedded
network, station, module I/O, multidrop, command, and subcommand must match the active request's
wire identity. A mismatch is a malformed, uncorrelated response rather than a definitive PLC error.
The transport is invalidated so that the response cannot affect a later request. A read-only
operation reports the implementation's malformed/protocol response error. A state-changing
operation reports `SlmpOperationOutcomeUnknownError` with malformed-response reason.

Bytes following the 9-byte prefix remain permitted and are preserved as PLC-supplied additional
error data. This decision does not define the handling of a non-zero-end-code response whose error
information is absent or shorter than 9 bytes; that remains a separate specification item.

### Compatibility and operational impact

Responses whose outer route or 4E serial previously matched, but whose embedded error information
identified another request, no longer surface as definitive PLC errors and no longer leave the
transport reusable. Valid PLC errors with matching embedded request identity are unchanged. This is
an intentional behavioral break with no compatibility fallback.

### Machine-verifiable acceptance criteria

1. For 3E and 4E over TCP and UDP, each embedded route-field mismatch is rejected as malformed and
   invalidates the transport.
2. For 3E and 4E over TCP and UDP, embedded command and subcommand mismatches are rejected as
   malformed and invalidate the transport.
3. A mismatched error-information response for a state-changing request produces
   `SlmpOperationOutcomeUnknownError` with malformed-response reason.
4. The same mismatch for a read-only request produces the documented malformed/protocol error and
   never a definitive PLC error.
5. A matching 9-byte prefix still produces the existing structured PLC error, and additional bytes
   after that prefix are retained without imposing an exact 9-byte response length.
6. Existing outer route, frame type, complete-length, reserved-field, and 4E serial correlation
   checks continue to pass.
7. Cross-language contract tests use equivalent vectors in Node.js, Python, Rust, C++, and .NET.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete. Evidence: an independent cross-language audit confirmed equivalent six-field error-information correlation, additional-data retention, invalidation, and read/write classification; the final Rust and .NET full gates passed after their accepted findings were corrected.

## SLMP-NODE-ADDRESS-COUNT-001 — Preserve exact safe-integer counts in public address helpers

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

The Node.js SLMP public `parseAddress()`, `formatParsedAddress()`, and `normalizeAddress()` count
contract, including canonical parsed-object shape, error messages, tests, user/API documentation,
migration notes, and changelog. Per-command and per-profile point limits remain separate validation.

### Target contract

An address count is a positive JavaScript safe integer. Text parsed by `parseAddress()` must contain
one or more ASCII decimal digits for the complete count suffix and must convert without precision
loss. A hand-built object passed to `formatParsedAddress()` must provide `count` as a native
JavaScript number satisfying `Number.isSafeInteger(count)` and `count > 0`; strings and all other
coercible values are rejected without invoking conversion hooks. The helpers preserve the exact
accepted count. Command/profile validation subsequently decides whether that exact count fits a
specific operation.

### Compatibility and operational impact

Oversized counts that previously rounded, partial strings such as `"2junk"`, numeric strings in a
hand-built parsed object, exponent notation, fractions, zero, and negative values now fail instead
of being normalized to another address. Objects produced by `parseAddress()` and ordinary valid
count suffixes retain their canonical output.

### Machine-verifiable acceptance criteria

1. `parseAddress()` accepts exact decimal counts from `1` through `Number.MAX_SAFE_INTEGER` and
   round-trips each accepted value unchanged through `formatParsedAddress()`.
2. `parseAddress()` rejects `Number.MAX_SAFE_INTEGER + 1` and larger decimal text instead of
   returning a rounded count.
3. Count text rejects signs, whitespace within digits, exponent notation, fractions, suffix junk,
   empty values, zero, and non-ASCII digit forms.
4. `formatParsedAddress()` accepts only a native positive safe-integer `count` when `hasCount` is
   true and rejects strings, boxed numbers, `BigInt`, and objects without coercing them.
5. `hasCount == false` retains the existing count-free canonical format and cannot accidentally
   append an unvalidated count.
6. Named read/write planning still applies its command/profile limit to the exact parsed count and
   rejects oversized operations before transport.
7. Public API documentation distinguishes syntax/safe-integer validation from command/profile
   point limits.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## PERF-008D — Two-phase Node SLMP response decoding

Decision status: approved on 2026-08-02; implementation and final acceptance are complete for the
Node SLMP scope in the overhaul worktree.

### Implementation scope

`SlmpClient` response decoding for Direct, Random, Block, Monitor, Memory, Extend Unit, Type Name,
Self Test, Label, and named-read operations; malformed-response retirement; wire FIFO and public
completion sequencing.

### Target contract

Transport identity, PLC status, acknowledgement shape, exact command-data size and structure, bit
encoding, label boundaries, and self-test echo validation finish inside the wire FIFO turn. A
malformed body retires the supplying generation before another already queued request can send;
state-changing requests retain outcome-unknown classification and PLC end codes remain PLC errors.
Pure array, object, string, and Buffer materialization runs after the wire turn. Public Promises
settle in admission order, and lifecycle generation is checked before materialization and before
publication. One absolute transaction deadline ends after the validation phase and is not restarted
for materialization. ACK and RMW-dependent decoding remain inside their exclusive turns.

### Compatibility and operational impact

Public methods, wire frames, request counts, successful values, admission-order settlement, and
timeout duration do not change. Command-specific malformed read bodies now retire the connection
generation instead of remaining reusable. No public signature migration is required.

### Machine-verifiable acceptance criteria

1. Every semantic response decoder has an in-FIFO validation phase and any allocation-heavy pure
   result construction occurs after that phase.
2. A malformed command body retires its exact generation and prevents the next old-generation
   queued request from sending; a newly admitted generation can proceed without retrying the failure.
3. Concurrent valid reads start the next wire request after validation while their public Promises
   settle in admission order.
4. PLC errors, state-changing malformed outcomes, close races, ACKs, labels, self-test, and exact
   payload boundaries retain their approved classifications.

### Acceptance tracking

Full local release-gate and self-review evidence is recorded below.

- [x] Implementation completed in `node-red-contrib-plc-comm-slmp` for the full scope above.
- [x] Tests were added or updated for every acceptance criterion; the response-phase and
  malformed-generation coverage passed in the 257/257 targeted run and the full suite passed.
- [x] Relevant full checks passed: no-auto-publish and profile-fixture freshness, unit/runtime tests,
  example-flow load, Windows socket lifecycle smoke, package/source-archive checks, `npm pack
  --dry-run`, and the Node-RED editor smoke test.
- [x] Codex self-review covered the actual diff, decoder surface, validation/materialization boundary,
  malformed-generation retirement, FIFO/public completion order, timeout/cancellation behavior,
  tests, packaging, and applicable cross-library consistency; all accepted findings were corrected
  and reverified.
- [x] Live PLC verification is not required for PERF-008D: the changed response scheduling,
  malformed-body retirement, and generation behavior are deterministic client-side contracts
  verified with exact response vectors and local fake transports, with no PLC capability or wire
  request change.
- [x] `CHANGELOG.md`, user usage and API references, locally collected docs, package-symbol checks,
  and the strict docs-site build agree with the implementation; no migration note is required
  because no public signature changed.
- [x] All numbered acceptance criteria were verified and PERF-008D is complete for Node SLMP.

## PERF-008E — Prepared two-request `writeBitInWord` RMW

Decision status: approved on 2026-08-02; implementation and final acceptance are complete for the
Node SLMP scope in the overhaul worktree.

### Implementation scope

The explicit Node SLMP `writeBitInWord` helper, its Direct Read/Write prepared request metadata,
exclusive FIFO execution, response decoding, and shared deadline.

### Target contract

Admission validates and snapshots the device, bit/value, profile, read/write route, request capacity,
command metadata, and both fixed payload shapes before FIFO acquisition. Execution uses one exclusive
turn and one absolute procedure deadline for exactly one word read followed by one word write. Only
the final 16-bit word is inserted after the read. The write is not skipped when the bit already has
the requested value. There is no retry, readback inference, or resend.

### Compatibility and operational impact

The public signature, two-request count, same-client exclusion, non-atomic PLC semantics, and
outcome-unknown behavior do not change. Repeated preflight and payload construction are removed. No
public signature migration is required.

### Machine-verifiable acceptance criteria

1. Invalid input and both read/write route or capacity failures occur before FIFO, serial, or send.
2. One FIFO turn and one absolute deadline cover the read, final-word calculation, write, and ACK.
3. Every bit index, ON/OFF, and an already-equal bit still produce exactly two requests with the
   expected final 16-bit word.
4. Read failure produces zero writes; a possibly-sent write failure retains outcome-unknown and is
   never retried.

### Acceptance tracking

- [x] Implementation completed in `node-red-contrib-plc-comm-slmp` for the full scope above.
- [x] Tests were added or updated for every acceptance criterion; RMW preflight, deadline, payload,
  every bit index, unchanged-bit, and failure coverage passed in the 257/257 targeted run and the
  full suite passed.
- [x] Relevant full checks passed: no-auto-publish and profile-fixture freshness, unit/runtime tests,
  example-flow load, Windows socket lifecycle smoke, package/source-archive checks, `npm pack
  --dry-run`, and the Node-RED editor smoke test.
- [x] Codex self-review covered the actual diff, public helper contract, two-request wire sequence,
  validation order, exclusive FIFO state, shared deadline, outcome-unknown errors, tests, packaging,
  and applicable cross-library consistency; all accepted findings were corrected and reverified.
- [x] Live PLC verification is not required for PERF-008E: preflight ordering, exactly-two-request
  execution, final-word construction, shared deadline, and failure classification are deterministic
  client-side contracts verified with exact frames and local fake transports; no PLC capability or
  wire-contract claim changed.
- [x] `CHANGELOG.md`, user usage and API references, locally collected docs, package-symbol checks,
  and the strict docs-site build agree with the implementation; no migration note is required
  because no public signature changed.
- [x] All numbered acceptance criteria were verified and PERF-008E is complete for Node SLMP.

## PERF-010A — Single-snapshot prepared Node SLMP requests

Decision status: approved on 2026-08-02; implementation and final acceptance are complete for the
Node SLMP scope in the overhaul worktree.

### Implementation scope

General `SlmpClient` request preparation and private execution, including managed remote-password
commands and the existing private-method override compatibility path.

### Target contract

The public/internal admission path copies a Buffer or Uint8Array payload exactly once, snapshots the
effective target and request options, and validates payload capacity before FIFO acquisition. A
module-private branded prepared request is consumed by the execution core without copying or
revalidating the same payload. Managed-password commands use the same preparation boundary, and
unbranded values cannot enter the prepared core. Existing private override behavior remains usable.

### Compatibility and operational impact

Public API, accepted input types, caller-mutation isolation, validation order, error classes, frames,
request counts, FIFO order, and results remain unchanged. Only duplicate Buffer allocation and
validation work is removed. No public migration is required.

### Machine-verifiable acceptance criteria

1. Normal and managed-password requests enter preparation once and pass the same snapshotted Buffer
   reference to the private execution boundary.
2. Caller mutation after admission cannot change the transmitted frame.
3. Oversized payloads still fail before serial allocation or transport with the existing error type.
4. Private override, 3E/4E, TCP/UDP, close, and FIFO behavior remain unchanged.

### Acceptance tracking

- [x] Implementation completed in `node-red-contrib-plc-comm-slmp` for the full scope above.
- [x] Tests were added or updated for every acceptance criterion; queued snapshots, prepared-reference
  identity, managed-password, mutation isolation, oversize preflight, and transport/FIFO coverage
  passed in the 257/257 targeted run and the full suite passed.
- [x] Relevant full checks passed: no-auto-publish and profile-fixture freshness, unit/runtime tests,
  example-flow load, Windows socket lifecycle smoke, package/source-archive checks, `npm pack
  --dry-run`, and the Node-RED editor smoke test.
- [x] Codex self-review covered the actual diff, request/prepared boundary, public input ownership,
  validation order, private override behavior, transport/FIFO state, tests, packaging, and applicable
  cross-library consistency; all accepted findings were corrected and reverified.
- [x] Live PLC verification is not required for PERF-010A: snapshot ownership, single-copy identity,
  preflight ordering, private branding, and mutation isolation are deterministic client-side
  contracts verified locally with exact frames across supported transports; no PLC capability or
  wire behavior changed.
- [x] `CHANGELOG.md`, user usage and API references, locally collected docs, package-symbol checks,
  and the strict docs-site build agree with the implementation; no migration note is required
  because no public signature changed.
- [x] All numbered acceptance criteria were verified and PERF-010A is complete for Node SLMP.

## PERF-010B — Immutable prepared Node SLMP named-read wire plan

Decision status: approved on 2026-08-02; implementation and final acceptance are complete for the
Node SLMP scope in the overhaul worktree.

### Implementation scope

High-level `compileReadPlan` and `readNamed` Random Read expansion, deduplication, response indexing,
and result materialization.

### Target contract

Each public entry is expanded to its word/DWord wire devices exactly once at compile time. The
private immutable plan stores deduplicated send arrays plus entry-specific word/DWord indexes and bit
selection metadata. Send and decode reuse that plan without re-expanding entries. Private wire
metadata is held in module-owned weak maps and is neither returned nor mutably shared with callers.

### Compatibility and operational impact

The one-Random-Read-or-reject contract, frames, device deduplication, input-order result mapping,
dtype conversion, preflight errors, FIFO behavior, and all-or-error semantics remain unchanged. No
public migration is required.

### Machine-verifiable acceptance criteria

1. Scalar, counted Word/DWord, STRING, BIT, BIT_IN_WORD, and DWord-stride vectors use the same one
   wire request and return the same values.
2. Shared wire devices are sent once and mapped to every referring public entry correctly.
3. Capacity and invalid-entry failures remain pre-FIFO and zero-send.
4. The exported compile result is immutable and does not expose wire arrays or entry decode indexes.

### Acceptance tracking

- [x] Implementation completed in `node-red-contrib-plc-comm-slmp` for the full scope above.
- [x] Tests were added or updated for every acceptance criterion; immutable-plan, private-metadata,
  deduplication, all dtype mappings, capacity/invalid preflight, and one-request coverage passed in
  the 257/257 targeted run and the full suite passed.
- [x] Relevant full checks passed: no-auto-publish and profile-fixture freshness, unit/runtime tests,
  example-flow load, Windows socket lifecycle smoke, package/source-archive checks, `npm pack
  --dry-run`, and the Node-RED editor smoke test.
- [x] Codex self-review covered the actual diff, public compile result, private weak-map wire plan,
  expansion/deduplication/index mapping, validation order, FIFO behavior, tests, packaging, and
  applicable cross-library consistency; all accepted findings were corrected and reverified.
- [x] Live PLC verification is not required for PERF-010B: plan immutability, metadata privacy,
  deduplication, result indexing, and preflight are deterministic client-side planner contracts
  verified locally with exact request frames and response vectors; no PLC capability or wire
  behavior changed.
- [x] `CHANGELOG.md`, user usage and API references, locally collected docs, package-symbol checks,
  and the strict docs-site build agree with the implementation; no migration note is required
  because no public signature changed.
- [x] All numbered acceptance criteria were verified and PERF-010B is complete for Node SLMP.

## SLMP-NODE-NUMERIC-NO-COERCION-001 — Require native numeric values in high-level writes

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

Node.js SLMP high-level typed and named write normalization for `U`, `S`, `D`, `L`, and `F`,
including arrays, preflight behavior, error messages, tests, examples, user documentation, migration
notes, and changelog. Low-level encoded payload APIs and the explicit `STR`/`BIT` type contracts are
not converted into numeric inputs.

### Target contract

Numeric SLMP dtypes accept only JavaScript values whose `typeof` is `"number"`. Numeric strings,
boxed numbers, `BigInt`, booleans, and other coercible values are rejected before queue admission or
transport activity. Every accepted number must be finite; integer dtypes additionally require an
exact integer within their existing wire range, and `F` must remain finite after float32 conversion.
`STR` continues to require a string and `BIT` continues to require a native Boolean. The library
provides no compatibility coercion; callers that start with textual configuration data must convert
it explicitly before invoking the write API.

### Compatibility and operational impact

Code that passed values such as `"123"`, `"1.5"`, or scientific-notation strings to numeric writes
now receives a validation error instead of a PLC write. Native numeric callers and explicit string
or Boolean dtypes are unchanged. This aligns implementation with the existing no-coercion user
contract.

### Machine-verifiable acceptance criteria

1. Every numeric dtype rejects valid-looking decimal, signed, fractional, and exponent strings
   before queue admission, trace emission, serial allocation, connection, or send.
2. Numeric dtypes reject boxed numbers, `BigInt`, booleans, `null`, arrays, and objects without
   invoking their coercion hooks.
3. `NaN`, positive/negative infinity, integer fractions, out-of-range integers, and float32 overflow
   retain deterministic preflight rejection.
4. Valid boundary native numbers for `U`, `S`, `D`, `L`, and `F` retain their current wire encoding.
5. Scalar and counted-array forms use the same exact-type policy and fail atomically before any
   internal request.
6. `STR` strings and native-Boolean `BIT` values retain their existing supported behavior.
7. Typed and named high-level APIs, examples, and generated API documentation state the same policy.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## SLMP-NODE-UDP-ERROR-CLOSE-001 — Close and retire the current UDP socket after an error

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

The Node.js SLMP UDP socket error path, connection-generation retirement, connect-promise state,
pending request rejection, socket event handling, local-port release, tests, user documentation,
migration notes, and changelog.

### Target contract

An error from the current UDP socket retires that generation exactly once, clears any connect
promise owned by it, rejects every pending request exactly once with the existing classified error,
and closes the detached socket. Closing an already-closing or closed socket is best-effort and a
resulting local close exception does not replace the original transport error. Events from a socket
that no longer owns the current generation are ignored. A later reconnect creates a new socket and
must not reuse listeners, pending state, or ownership from the retired socket.

### Compatibility and operational impact

UDP errors now release the operating-system socket, bound local port, and listeners instead of
dropping the last client reference. Reconnect continues through a new generation. Public APIs and
the established read-only/state-changing error classification do not change.

### Machine-verifiable acceptance criteria

1. An error from the current UDP socket calls its close operation exactly once after detaching it
   from current generation ownership.
2. The same error clears the generation's connect promise and rejects each serial/non-serial pending
   request exactly once.
3. A local close exception cannot mask the original transport failure or cause duplicate rejection.
4. A late error, message, send callback, or close event from the retired socket cannot mutate the
   current generation or settle a later request.
5. Explicit client close after an error remains safe even though the failed socket has already been
   detached and closed.
6. A fixed local UDP port can be bound by a new generation after the failed socket is retired.
7. Existing state-changing outcome-unknown and read-only transport-error classifications remain
   unchanged.
8. Node.js HostLink and SLMP TCP behavior remain unchanged.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## SLMP-NODE-CLOSE-SINGLE-FLIGHT-001 — Serialize concurrent close calls through one lifecycle result

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

The Node.js SLMP client lifecycle around `close()`, managed remote-password locking, client and
transport generations, connect admission while close is active, close error aggregation, tests,
user documentation, migration notes, and changelog.

### Target contract

The first `close()` call creates the sole in-flight close promise. Every concurrent `close()` returns
that same logical operation and observes the same success or failure. One close flight performs one
client-generation retirement, at most one managed password-lock attempt, and one transport close.
The client remains in closing state and rejects new connection/operation admission until the entire
flight, including error aggregation and state invalidation, has settled. The in-flight marker is
cleared only by the flight that installed it. A sequential `close()` after settlement remains safe
and idempotent.

### Compatibility and operational impact

Concurrent callers no longer start independent password or transport work and no longer receive
different results based on completion order. Code that observed multiple generation increments or
multiple password-lock attempts from overlapping close calls loses that accidental behavior. A
normal single close and a later sequential close retain their public signatures and supported use.

### Machine-verifiable acceptance criteria

1. Two or more overlapping `close()` calls invoke managed password locking and transport close no
   more than once and complete with the same result.
2. Client generation is retired exactly once for one close flight.
3. An earlier or later concurrent caller cannot clear closing state while the shared transport close
   remains pending.
4. `connect()` and normal operation admission remain unavailable until the shared close flight fully
   settles.
5. A close failure, password-lock failure, or aggregate failure is observed consistently by every
   concurrent caller.
6. A late completion from the retired close generation cannot close, authenticate, or mutate a newly
   opened transport generation.
7. Sequential close, close-after-failure, and close-after-success behavior remains deterministic and
   documented.
8. Node.js HostLink's existing single-flight close behavior remains unchanged.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## SLMP-NODE-UDP-SEND-GATE-001 — Require both UDP send completion and a matching response

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

The Node.js SLMP UDP transport's send callback, response waiter, timeout, traffic accounting,
transport invalidation, state-changing failure classification, tests, user documentation, migration
notes, and changelog. TCP and the Node.js HostLink transport are outside the implementation scope.

### Target contract

A UDP exchange can publish its response only after both the `socket.send()` callback has reported
success and a complete response matching the active request has arrived. A response that arrives
first is held provisionally without resolving the request. A later successful send callback releases
that response for normal protocol decoding.

If the send callback reports an error, any provisional response is discarded and the UDP transport
is invalidated. A state-changing request reports `SlmpOperationOutcomeUnknownError` with transport-
failure reason. If either half of the gate never completes, the one absolute operation deadline
remains authoritative and the existing read-only/state-changing timeout classification applies.
Traffic statistics must not publish a completed request before the send callback succeeds.

### Compatibility and operational impact

UDP completion may occur slightly later because a fast response no longer resolves the request
before the operating system reports send completion. Socket substitutes, simulators, and test
doubles must invoke the send callback exactly once. There is no compatibility path that treats a
response alone as proof of a completed local send.

### Machine-verifiable acceptance criteria

1. A matching response delivered before the send callback remains provisional and does not resolve
   the request or publish successful request/byte accounting.
2. A later successful send callback releases the provisional response exactly once.
3. A send callback error after a provisional response discards that response, invalidates the UDP
   transport, and reports a transport failure for read-only requests.
4. The same send-error race for state-changing requests reports
   `SlmpOperationOutcomeUnknownError` with transport-failure reason.
5. Send-first and response-first orderings produce the same successful result when both halves
   succeed, without duplicate completion, trace, or traffic accounting.
6. A missing send callback or missing response expires at the same absolute deadline with the
   existing timeout classification.
7. Close and transport error paths safely discard any provisional response and cannot allow a late
   callback to settle a retired request generation.
8. Existing TCP behavior and the already gated Node.js HostLink UDP behavior remain unchanged.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## SLMP-EMPTY-ACK-001 — Reject response data on standard acknowledgement-only APIs

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

Every standard Node.js SLMP API whose successful response is acknowledgement-only, including direct,
random, block, extended, memory, extend-unit, and label writes; monitor registration; remote CPU
control; error clearing; and password lock/unlock. The maintainer-level `rawCommand()` API is
excluded because arbitrary response data is part of its intended contract.

### Target contract

A standard acknowledgement-only API accepts a successful response only when the end code is zero
and the response data is completely empty. A zero-end-code response containing any data is malformed
and does not prove the outcome of a state-changing request. The client invalidates the transport and
throws `SlmpOperationOutcomeUnknownError` with malformed-response reason. No extra-data tolerance,
silent truncation, or compatibility fallback remains on the standard API surface.

### Compatibility and operational impact

A PLC, gateway, simulator, or test double that returns non-standard data after a successful
acknowledgement will now fail and require reconnection instead of being treated as success. Method
signatures remain unchanged. `rawCommand()` continues to return arbitrary successful response data.
The target behavior matches the existing .NET, C++, and Rust SLMP implementations.

### Machine-verifiable acceptance criteria

1. Each standard acknowledgement-only command family rejects a zero-end-code response containing
   one or more data bytes.
2. The rejection is `SlmpOperationOutcomeUnknownError` with malformed-response reason and invalidates
   both TCP and UDP transports.
3. Empty successful acknowledgements retain their current behavior over 3E/4E and TCP/UDP.
4. Non-zero-end-code handling continues through the structured PLC-error path and is not replaced by
   the empty-acknowledgement check.
5. `rawCommand()` continues to return arbitrary successful response data unchanged.
6. Equivalent Node.js and Python contract vectors pass, and .NET, C++, and Rust remain consistent.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Required live-PLC checks passed, or each unavailable check has an explicit release disposition.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete. Evidence: an independent Node.js/Python audit confirmed empty standard semantic ACKs, malformed non-empty outcome handling, transport retirement, arbitrary-data raw command behavior, and send-only Remote RESET semantics.

## SLMP-NODE-001 — Canonical profile limits for high-level named random writes

Decision status: implemented and verified on 2026-08-02.

### Implementation scope

Node.js high-level `writeNamed` random word/dword, long-current, and random-bit planning, tests,
maintainer documentation, and changelog. The low-level client and canonical profile JSON are unchanged.

### Target contract

High-level named random-write preflight obtains point and weighted limits from the selected canonical
PLC profile and applies the same limits as the low-level client. It does not use iQ-R constants for
Q/L profiles or split one named write into multiple requests.

### Compatibility and operational impact

Valid Q/L requests above the iQ-R ceiling are now accepted. Requests beyond the selected profile's
point or weighted limit still fail before transport. Method signatures and wire encoding are unchanged.

### Machine-verifiable acceptance criteria

1. An iQ-R plan with 81 random word destinations is rejected before client I/O.
2. A Q/L plan with 160 random word destinations is accepted as one request.
3. A Q/L plan with 161 destinations is rejected with the canonical 160-point/1920-weight limits.
4. Long-current and random-bit named writes obtain their corresponding canonical profile limits.
5. The low-level client remains the final independent validator.

### Acceptance tracking

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion in this repository.
- [x] The targeted high-level suite passed 90/90 and the full local gate passed 264/264 with npm audit and package validation.
- [x] Codex self-review covered profile selection, point/weighted calculations, validation order, no-send behavior, and low-level consistency.
- [x] Live PLC is not required because the change is deterministic pre-transport validation against canonical profile data.
- [x] Changelog and maintainer documentation agree with implementation; no user API signature changed.
- [x] Final acceptance criteria verified and the item marked complete.
