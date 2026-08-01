# Node-RED SLMP Quality Overhaul

This maintainer record preserves approved target contracts, compatibility impact, acceptance criteria, and verification evidence. User pages describe only the resulting supported behavior.

## NR-SLMP-OH-001 — Explicit connection and route identity

Scope: `SlmpClient`, `slmp-connection`, saved example flows, and route overrides.

Approved decision mapping: D-111 covers port, D-112 covers transport, D-113 covers timeout, and
D-115 covers connection/request routes. The editor may seed a new node with `1025`, TCP, 3000 ms,
and the four own-station route values; saved/runtime port and transport have no fallback, timeout
defaults only when its property is absent, and all saved connection route fields remain required.

Target contract: port, transport, concrete PLC profile, and all four route fields are explicit. Editor defaults initialize a new node only; missing runtime or saved values are not silently repaired. Timeout is optional and defaults to 3000 ms only when absent; an explicitly supplied timeout must be an integer in `1..2147483647`. Monitoring timer defaults to `0x0010`.

Compatibility impact: implicit TCP/port/profile/partial-target construction is removed.

Acceptance criteria:

1. Missing, null, blank, Boolean, zero, negative, fractional, non-finite, above-65535, or non-scalar
   port values fail before client/transport creation. Decimal ports `1..65535` are accepted, and
   editor `1025` is only a required new-node initial value. Missing transport/profile, partial
   target, alias conflict, and invalid integer shapes also fail before transport.
2. Missing, null, blank, non-string, or unknown transport fails before client/transport creation.
   Explicit TCP/UDP is normalized only for surrounding whitespace and case; communication failure
   never switches to the other transport.
3. An absent timeout becomes exactly 3000 ms. Explicit null, blank, Boolean, zero, negative,
   fractional, non-finite, above-2147483647, or non-scalar values fail before socket creation. The
   same normalizer is used by the direct client and configuration node, and the accepted value is
   forwarded unchanged to the transport timer.
4. Connection targets require network, station, module I/O, and multidrop. All 14 partial shapes,
   missing/non-object inputs, invalid field values, and alias conflicts fail before socket or frame
   creation. Explicit zero and maximum field values remain valid.
5. A complete connection target is inherited only when the request target property is absent. A
   present request target must itself be complete and is never merged with connection or own-station
   values. The connection target cannot be mutated or replaced after construction. A queued request
   validates and snapshots its effective target and payload when submitted, so later mutation of the
   caller's objects cannot change the route or wire data.
6. Example flows contain explicit connection settings and deploy through editor smoke validation.

## NR-SLMP-OH-002 — Profile-derived wire behavior

Scope: semantic device objects, device parsers, direct/random/block APIs, raw request options, and 4E transport.

Approved decision mapping: D-114 removes public profile-guard disablement. Normal clients, saved
flows, public helpers, message overrides, and the editor cannot turn the selected profile guard off.
The only bypass is an underscore-prefixed maintainer constructor input that accepts an actual
Boolean and is intentionally absent from user documentation and the package index.

Target contract: semantic devices retain canonical `plcProfile`; client/device mismatch fails before transport. Series comes from the profile and 4E serial is assigned and matched internally. Raw command requires command, subcommand, and explicit byte payload.

Compatibility impact: request `series`/`serial`, profileless semantic addresses, implicit raw subcommand/payload, and public strict-profile option are removed.

Acceptance criteria:

1. Profile-sensitive X/Y parsing and formatting retain their profile and reject cross-profile reuse.
2. User-supplied series/serial and missing raw fields produce zero requests.
3. Concurrent calls preserve FIFO send order, 4E responses match serial, and timeout/failure releases or destroys transport state safely.
4. `strictProfile`, `strict_profile`, the old public normalizer, editor checkbox, user instructions,
   and public helper bypass are absent. Old Node-RED `strictProfile: true` is safely ignored during
   migration; false, aliases, null, blank, and unknown values produce a migration error before
   client creation.
5. The maintainer-only bypass accepts only Boolean false and bypasses only blocked/unverified
   capability state. Point limits, write policy, address, route, command, and request validation
   remain enforced.

## NR-SLMP-OH-003 — One-request boundaries and write identity

Scope: named random reads/writes and low-level random/extended-random/block writes.

Target contract: each named read/write emits one protocol request or is rejected before transport. Compatible random or multi-block word entries may share that request; mixed command families, bit-in-word writes, and oversized operations never become hidden follow-up requests. Random and block writes reject duplicate or overlapping destinations, including DWord spans and equal extended routes.

Compatibility impact: hidden random chunking is removed; previously accepted ambiguous overlapping writes fail.

Acceptance criteria:

1. A 97-device iQ-R named random read, an 81-word named random write, and every incompatible named route issue zero requests.
2. Word/DWord overlap, DWord/DWord overlap, duplicate bits, block overlap, and equal-route extended overlap issue zero requests.
3. A bit-in-word that can join a random read is included in that single random request rather than causing a second direct read.
4. Compatible word/DWord named values use one random request; compatible named bits use one random-bit request.

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
2. TCP calls `setKeepAlive(true, 30000)`. If no-delay or keepalive setup throws, it destroys the socket, rejects connection, and retains no TCP socket. UDP ignores delayed data from a timed-out generation and never receives TCP keepalive configuration.
3. Removed skip flags cannot bypass the selected error mode.

## NR-SLMP-OH-006 — Canonical Node-RED runtime contract

Scope: connection/read/write editor definitions, runtime overrides, output shape, metadata ownership, and examples.

Approved decision mapping: D-116 requires saved `addressesType` and `updatesType`, D-117 applies the
same exact source-type contract to a configured route override, and D-118 fixes read
`object`/`array`/`value` payload shapes, while D-119 fixes metadata ownership and current-operation
identity. D-120 fixes error routing and its derived terminal count, D-123 makes present runtime
inputs authoritative, D-124 removes public unsupported-device skip overrides, D-125 requires
single-write dtype to come from exactly one complete source, and D-126 separates optional display
names from every runtime identity and communication field. Editor defaults
initialize new nodes only; opening an old flow does not silently fill a missing field.

Target contract: required source types and enum fields are validated exactly. `msg.addresses`, `msg.updates`, and single-write fields are mutually consistent. Bare single-write addresses require one exact dtype. Metadata full/minimal/off modes own and clear a defined field set.

Compatibility impact: inferred source types, unknown enum fallback, scalar/payload fallback, dtype
aliases, stale owned metadata, and successful unsupported-device skip messages are removed.

Acceptance criteria:

1. Invalid source/enum/output-count/runtime-override combinations fail deterministically.
2. Missing, null, blank, non-string, case-changed, or unknown read/write source types fail during
   node construction. Every supported non-literal type is evaluated through Node-RED; a missing
   reference, evaluation error, or unavailable evaluator fails without treating the property name
   as a literal PLC address/update.
3. Route override may be absent as a whole. When configured, its source type is required and every
   selected source must yield one complete route. Missing references, null/blank/non-object values,
   invalid JSON, and partial routes fail without trying a lower-priority source or the connection
   route. `msg.target`, `msg.slmp.target`, configured source, and connection inheritance have a fixed
   priority, and metadata records both the effective target and selected source.
4. Read object mode always returns an address-keyed object, array mode always returns an array, and
   value mode accepts exactly one address. Zero/multiple addresses in value mode fail before the
   client call and produce no output; dynamic address count never changes the selected mode.
5. Full/minimal metadata first removes every library-owned field, preserves custom fields, and then
   writes only the current operation. Both modes include operation, effective target, target source,
   item count, and mode; full alone includes connection plus current addresses or updates. Off does
   not create or mutate metadata and therefore does not claim existing values describe this result.
6. Single write dtype is specified exactly once and is one of `BIT/U/S/D/L/F/STR`. A complete
   address dtype/count or word-bit selector permits `msg.dtype` omission; bare addresses require an
   exact uppercase `msg.dtype`. Double specification, explicit undefined/null/empty/non-string,
   lowercase/alias/unknown values, and incomplete/conflicting colon or period selectors fail with
   zero client calls and never fall back or complement one another.
7. Error handling is exactly `throw`, `msg`, or `output2`. Throw calls `done(error)` with no output;
   msg sends the current error on output 1; output2 sends it only on output 2. Success always uses
   output 1. Terminal count is derived as 1/1/2, and a present saved count must be that exact integer
   rather than a coercible string/Boolean or a conflicting value.
8. Editor smoke and all example flow validation pass.
9. A present `msg.addresses`, `msg.updates`, `msg.address`, `msg.value`, or `msg.dtype` is validated
   as the selected runtime source. Null, empty, wrong-type, conflicting, and isolated fields fail
   with zero client calls and never execute configured addresses or updates.
10. `msg.slmpSkipUnsupported` and `msg.slmp.skipUnsupported` never change error handling. Their
    presence emits a migration warning for every former value shape, while capability errors retain
    their structured fields and follow throw/msg/output2 exactly; no skipped-success marker exists.
11. Connection/read/write `name` is optional display-only state. Missing/null/blank/non-string values
    normalize to empty, normal strings are trimmed, and duplicates are allowed. Changing a name
    does not change the runtime node ID, connection reference, profile, route, request arguments,
    request bytes, output metadata, or editor fallback label behavior.

## NR-SLMP-OH-007 — Monitoring timer omission and transport lifetime

Scope: direct client construction, connection-node configuration, request overrides, 3E/4E frame
encoding, and TCP/UDP timeout generations.

Approved decision mapping: D-121 distinguishes an omitted monitoring timer from explicit zero and
implements B-82 together with the delayed-response isolation required by B-83. The editor may seed
a new connection with `16`; runtime omission alone selects that default.

Target contract: connection omission becomes `16` (four seconds), request omission inherits the
validated connection value, and explicit exact integers `0..65535` are encoded unchanged. Zero means
PLC-side indefinite processing wait and does not disable the independent client communication
timeout. Queue submission snapshots the effective timer, so later mutation of the caller's options
cannot change the frame. Invalid explicit values never become zero, 16, or inheritance. A timed-out unsequenced UDP
generation is closed and detached so a delayed response cannot satisfy a later request.

Compatibility impact: null, blank, Boolean, fractional, negative, non-finite, non-scalar, and
out-of-range monitoring timer values now fail instead of being coerced or treated as omitted.

Acceptance criteria:

1. A missing connection timer becomes 16; a missing request timer inherits the validated connection
   timer. Explicit 0, 1, 16, and 65535 are accepted and encoded unchanged in both 3E and 4E frames.
2. Explicit undefined, null, blank, Boolean, negative, fractional, non-finite, non-scalar, and
   out-of-range values fail before any frame is sent in the direct client, connection node, and
   request override paths.
3. A monitoring timer of zero leaves the default communication timeout at 3000 ms and leaves the
   transport timer unchanged; user/editor documentation explains the distinction and zero meaning.
4. The editor supplies required new-node value 16 and validates only exact integers in `0..65535`.
5. A 3E UDP timeout closes and detaches the old socket generation. A delayed datagram from that
   generation cannot complete the next request; 4E serial matching and TCP timeout cleanup remain
   covered by transport regression tests.

## NR-SLMP-OH-008 — D-048 explicit remote-password configuration

Scope: direct `SlmpClient` construction, Node-RED connection credentials, editor validation, metadata,
serialization, logs, and errors.

Target contract: omitting `remotePassword` or supplying explicit `undefined` means authentication is
unused. Any present null, empty, non-string, non-printable-ASCII, or profile-invalid credential fails
during construction. The Node-RED checkbox is required Boolean state: OFF disables and omits the
credential; ON requires a non-empty credential. Password text is private state and never appears in
client properties, JSON serialization, profile metadata, status, log, or error text.

Compatibility impact: explicit null/empty values no longer disable authentication, credential-like
values are no longer string-coerced, and code reading `client.remotePassword` must be removed.

Acceptance criteria:

1. Omission and explicit undefined create an unauthenticated client; explicit null, empty, Boolean,
   number, object, array, control/non-ASCII text, and invalid profile length fail before transport.
2. iQ-R 6–32 and Q/L exact-4 printable ASCII values are accepted and encoded unchanged.
3. Checkbox OFF never forwards a stored credential; ON plus an empty credential fails in editor and
   runtime. Metadata exposes only `remotePasswordConfigured`.
4. Password text is absent from own properties, serialization, warnings, and errors.

- [x] Implementation completed.
- [x] Tests added or updated for every acceptance criterion.
- [x] Full repository checks and package inspection passed.
- [x] Codex self-review completed.
- [x] Claude source review completed through the authorized SLMP review batches; findings are preserved in the archived workspace instruction records.
- [x] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for this deterministic configuration/privacy contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [x] Final acceptance completed.

## NR-SLMP-OH-009 — D-049 no public authentication bypass

Scope: `connect`, all normal request options, raw command options, public password commands, and the
managed lifecycle's recursion guard.

Target contract: `connect()` accepts no options and every public occurrence of
`skipRemotePasswordLifecycle` is rejected before transport. Managed unlock/lock uses a module-private
symbol and direct internal request context that normal callers cannot obtain. Public manual unlock/lock
commands are accepted only on a client without managed `remotePassword`, preventing manual lock from
leaving the managed generation falsely marked unlocked.

Compatibility impact: callers using the former skip flag must either use managed authentication or
construct a client without `remotePassword` for an explicit maintainer-controlled password command.

Acceptance criteria:

1. `connect`, normal/raw request, and password command occurrences of the removed flag produce zero
   requests and an explicit migration error.
2. Managed unlock and lock complete without recursion or request-gate deadlock.
3. Manual password commands on a managed client fail before transport; an unconfigured maintainer
   client can still send an explicit command.
4. No user/API documentation advertises the removed flag.

- [x] Implementation completed.
- [x] Tests added or updated for every acceptance criterion.
- [x] Full repository checks and package inspection passed.
- [x] Codex self-review completed.
- [x] Claude source review completed through the authorized SLMP review batches; findings are preserved in the archived workspace instruction records.
- [x] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for this API-boundary contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [x] Final acceptance completed.

## NR-SLMP-OH-010 — D-050 connection-generation authentication lifecycle

Scope: TCP/UDP connection creation, managed unlock state, request failure, reconnect, explicit close,
and stale transport events.

Target contract: authentication state is the successfully unlocked transport generation, not a
client-lifetime Boolean. Each new generation performs `connect -> unlock -> user command`; repeated
commands on that generation do not unlock again. Transport failure/timeout/close invalidates state.
The failed user command is returned once and is never replayed. Old TCP/UDP events are ignored when
their socket identity no longer matches the active generation.

Compatibility impact: no unlocked state carries across reconnect, and code cannot force a generation
to skip authentication.

Acceptance criteria:

1. First request unlocks once; later requests on the same generation do not.
2. Same-socket timeout state loss and a newly created TCP/UDP generation both unlock before the next
   user command, while the failed command appears exactly once.
3. Concurrent initial requests share one unlock promise and preserve the request gate.
4. A stale old-socket event cannot detach a newer TCP/UDP connection.

- [x] Implementation completed.
- [x] Tests added or updated for every acceptance criterion.
- [x] Full repository checks and package inspection passed.
- [x] Codex self-review completed.
- [x] Claude source review completed through the authorized SLMP review batches; findings are preserved in the archived workspace instruction records.
- [x] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for the local state-machine and mock-frame contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [x] Final acceptance completed.

## NR-SLMP-OH-011 — D-051 observable lock failure with guaranteed local close

Scope: managed lock, `SlmpClient.close`, Node-RED disconnect/reinitialize/shutdown, error aggregation,
and credential-safe reporting.

Target contract: close attempts lock only for the authenticated active generation and always attempts
local transport closure. Lock failure is returned as `SlmpError`; simultaneous lock and close failures
are retained in an `AggregateError` cause. The local state becomes closed/unknown, never presumed PLC
locked. Node-RED reports a sanitized warning and always completes its shutdown callback.

Compatibility impact: callers must handle `close()` rejection even though local resources have been
released; silent lock-failure success is removed.

Acceptance criteria:

1. Lock success closes normally. PLC end code, timeout, and transport error still close locally and
   reject with a password-free diagnostic.
2. Lock plus local-close failure preserves both errors.
3. Node-RED disconnect/reinitialize observe the failure; shutdown warns and calls `done` exactly once.
4. State after every close attempt is local closed and remote authentication unknown.

- [x] Implementation completed.
- [x] Tests added or updated for every acceptance criterion.
- [x] Full repository checks and package inspection passed.
- [x] Codex self-review completed.
- [x] Claude source review completed through the authorized SLMP review batches; findings are preserved in the archived workspace instruction records.
- [x] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for the deterministic close/error contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [x] Final acceptance completed.

### D-007 — PLC end-code handling

Normal client construction omits `raiseOnError` and therefore reports every non-zero PLC end code as `SlmpError`. Controlled evidence code may use the actual Boolean `false` to receive the structured NG response. Constructor and request overrides reject non-Boolean aliases before transport; they never coerce strings, numbers, null, empty values, objects, or arrays into an error policy. Queue submission snapshots the inherited or explicit Boolean, so later mutation cannot change the response decision for an already submitted request. This setting does not convert connection failures or communication timeouts into successful responses.

### D-019 — Random-read category omission

Normal and Extended Device random reads may omit either `wordDevices` or `dwordDevices`. At least one valid device is required across both categories. All-empty input and explicit non-collection or malformed collections fail before request submission; they never become a zero-point request. The result always contains `word` and `dword` objects, with the unused category represented by an empty object.

### D-020 — Random-word-write category omission

Normal and Extended Device random word writes may omit either `wordValues` or `dwordValues`. At least one valid address/value pair is required across both categories. All-empty, explicit non-collection, malformed, invalid, duplicate, and overlapping destinations fail before request submission. Random bit write remains a separate API with required bit values.

All low-level write values are validated without JavaScript coercion. Word and
DWord values must be exact finite integers in their unsigned wire ranges; bit
values must be Booleans or the numbers 0/1. `writeNamed` additionally rejects
overlapping cluster slots and Node-RED rejects address keys that collide after
canonical normalization.

`readNamed` and `writeNamed` are single-request-or-reject APIs. Count/string
word entries may share one multi-block request. Random, direct-bit, long-device,
and block families are never mixed into hidden follow-up requests; bit-in-word
writes remain explicit read-modify-write operations. Callers use explicit APIs
when more than one command is required.

Send-only remote reset closes the transport generation after transmission so
a possible NG response cannot satisfy the next 3E request. TCP pending-slot
conflicts are rejected before `socket.write`. Extended random-read result keys
include semantic Z/LZ/indirect modifiers, and LZ indexes are limited to 0/1.

### D-021 / D-022 — Block category omission

Block read and write may omit either `wordBlocks` or `bitBlocks`. At least one valid block is required. All-empty, explicit non-collection, malformed, wrong-unit, point-limit, and overlapping write-range inputs fail before request submission. Read results always contain both arrays, with the unused category empty. Mixed block operations remain one request.

### D-024 / D-025 / D-026 — Explicit Remote RUN and PAUSE intent

Remote RUN requires an actual Boolean `force` and one `RemoteClearMode` value; Remote PAUSE requires the Boolean `force`. Omission, null, strings, numbers, objects, arrays, and undefined clear modes fail before request submission. `RemoteClearMode.NO_CLEAR`, `CLEAR_EXCEPT_LATCH`, and `CLEAR_ALL` expose wire values 0, 1, and 2 without requiring undocumented magic numbers. Normal/force wire mode is 1/3 for both RUN and PAUSE.

### D-042 — Extended Device fields derive from semantic input

- Scope: `readRandomExt`, `writeRandomWordsExt`, `writeRandomBitsExt`, public helpers, examples, and API reference.
- Target contract: route fields derive from qualified addresses such as `U1\G0`, `U3E0\HG0`, and `J2\SW10`. Optional Z, LZ, and indirect behavior uses `SlmpExtendedDevice` with one typed modifier. Normal callers cannot supply the five raw extension wire fields.
- Compatibility impact: `[device, extension]`, `[device, value, extension]`, `{ extension }`, `normalizeExtensionSpec`, `resolveExtendedDeviceAndExtension`, and public raw extended encoders are removed. Writes use exact `[device, value]` pairs.
- Acceptance criteria: iQ-R and Q/L semantic vectors encode exact qualified routes; raw field shapes fail before transport; invalid modifier indexes, Q/L LZ, and link-direct modification fail; public export scan exposes only the semantic model.
- [x] Implementation completed.
- [x] Acceptance tests completed.
- [x] User API reference, changelog, and migration note updated.

### NR-SLMP-RMW-001 — Explicit bit-in-word read-modify-write turn

Scope: `writeBitInWord`, ordinary `SlmpClient` FIFO admission, public usage/API
documentation, and package-consumer behavior.

Target contract: validate and snapshot the complete word target, bit index,
Boolean value, route, request policy, and both direct requests before queue
admission. Hold one ordinary-client FIFO turn across the word read and word
write, without deadlocking on the re-entrant request path. This prevents another
operation on the same client from interleaving, but does not make the two SLMP
requests atomic at the PLC. Other connections and PLC program logic can race,
the requests can occur in different PLC scans, a possibly-sent write remains
outcome-unknown, and no automatic retry is allowed.

Compatibility impact: the public helper remains available with the same call
shape. Invalid write-side arguments now fail before the read, and concurrent
operations on the same client wait until both requests finish.

Acceptance criteria:

1. Invalid bit index/value, non-word targets, unsupported direct routes, write
   policy, response-wait override, and request options fail before transport.
2. The normal-client request order is read, write, then any later queued
   operation; caller option mutation after invocation cannot change either RMW
   request.
3. Read and write keep their normal timeout/error classification, with a
   possibly-sent write using `SlmpOperationOutcomeUnknownError` and no retry.
4. Public API/usage docs and changelog state the two-request/non-atomic race and
   same-client-only exclusion.
5. The Node.js 18 source gate and installed npm-tarball consumer reproduce the
   FIFO ordering contract.

- [x] Implementation completed in this repository.
- [x] Tests added or updated for every acceptance criterion.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Live PLC checks are not required for this deterministic queue/validation contract; existing direct read/write protocol behavior is unchanged.
- [x] Documentation, migration notes, changelog, and generated API reference agree.
- [x] Final acceptance criteria verified and the item marked complete.

Verification evidence:

- Node.js 18.20.8 and the current Node.js environment passed all 218 tests.
- The consumer-only npm package contract passed with 34 files, and an installed
  Node.js 18 tarball consumer reproduced read/write/later-request FIFO ordering.
- A synthetic Git tree containing the complete uncommitted worktree passed the
  64-file source-archive gate, including archive extraction, dependency install,
  all tests, and package dry-run.
- The no-auto-publish guard and `git diff --check` passed.

Self-review disposition:

- Accepted: public RMW previously used two independently queued operations, so a
  same-client request could run between read and write. One re-entrant exclusive
  turn now owns both requests.
- Accepted: write-side request-policy and response-wait validation initially
  remained after the read boundary. Complete preflight now rejects those inputs
  before queue admission or transport.
- Accepted: the first documentation wording claimed all oversized calls never
  split, contradicting the approved read-only aggregate exception. The wording
  now applies to single-request and label builders only.
- Accepted: diff review found and corrected an accidental neighboring
  `writeBits` variable reference before final verification.
- No rejected, duplicate, or deferred finding changes this contract.

## Verification checklist

- [x] Implementation completed for NR-SLMP-OH-001 through NR-SLMP-OH-011 in this repository.
- [x] Tests added or updated for the machine-verifiable acceptance criteria.
- [x] `npm test` passes the repository-local contract tests with zero skip, including
  D-007 Boolean-only PLC end-code policy, D-111/D-112/D-113 direct-client, normalizer, editor, runtime, and exact transport-timeout
  boundaries, D-115 connection/request route coverage, D-116 source-type/evaluator coverage, and
  D-117 route-source priority/fallback/metadata coverage, D-118 fixed output shapes, and D-119
  metadata-mode/ownership/operation-transition coverage, D-120 error/output routing, and D-121
  monitoring-timer omission/boundary/frame/timeout-generation coverage plus D-123 authoritative
  runtime-property/no-fallback coverage plus D-124 legacy-flag warning, structured-error, and all
  configured error-route coverage, plus D-125 exact-one dtype, invalid-selector, and no-client-call
  coverage, plus D-126 all-node display-name/identity/request-invariance coverage, and D-014
  immutable connection-route plus queue-submission target/payload snapshot coverage, and D-019
  one-category/empty-result plus all-empty/invalid-collection coverage, and D-020 one-category
  write-payload counts plus all-empty/invalid-collection coverage, and D-021/D-022 one-category
  block result/payload counts plus all-empty/invalid-collection coverage, and D-024/D-025/D-026
  required-intent, named clear-mode, invalid-input, and exact wire-value coverage, plus D-042
  qualified-route, typed-modifier, raw-field rejection, and exact iQ-R/Q/L payload coverage.
  D-048 through D-051 add configuration/privacy, removed public bypass, transport-generation
  authentication, non-replay, guaranteed local close, aggregate failure, and Node-RED warning coverage.
- [x] Node-RED editor smoke test passes.
- [x] `npm pack --dry-run` succeeds and contains only intended user/runtime/package files.
- [x] Codex self-review completed for public API, validation order, serial/response handling, timeout/UDP state, write overlap, Node runtime modes, docs, examples, and package contents.
- [x] Claude source review completed and findings recorded through `CLAUDE-SLMP-20260712-01` and `CLAUDE-SLMP-20260712-02`.
- [x] Codex resolved or dispositioned every Claude finding and reran affected checks.
- [x] No new live-PLC result is required to decide these API/validation/transport-generation contracts; existing profile capability evidence was not changed to pass.
- [x] Documentation, migration notes, changelog, examples, and API reference agree with implementation.
- [x] Final acceptance completed; the cross-library comparison is preserved in the archived workspace record `slmp_cross_implementation_final_comparison_20260712.md`.

## Live verification disposition

The changed acceptance criteria are fully observable through parser, mock transport, local TCP socket, editor, and package tests. No command in this batch requires a PLC response to distinguish pass from fail. Existing profile capability rows and hardware-specific compatibility remain unchanged and retain their prior verified/unverified state.

## Claude review status

The user ran both authorized SLMP Claude batches. Codex accepted, corrected, and reverified every applicable finding; canonical results are preserved in the archived workspace instruction records.

## 2026-07-12 D-128, D-129, D-131, and D-132 delta

### D-128 — Public low-level monitor APIs

- Scope: `registerMonitorDevices`, `registerMonitorDevicesExt`, and `runMonitorCycle`.
- Target: typed Word/DWord registration and explicit, nonzero, profile-bounded cycle counts, one request per call, no auto-registration, split, retry, or fallback.
- Compatibility: additive low-level surface; these are not new Node-RED node types.
- Acceptance: normal/qualified registration, exact cycle decoding, invalid counts, PLC error, response mismatch, and one-request boundaries are covered.

### D-129 — Public exact self-test API

- Scope: `selfTestLoopback(Buffer)`.
- Target: 1–960 ASCII `0-9/A-F`; exact declared length, response size, and echo equality against the transmitted Buffer snapshot.
- Compatibility: additive semantic API; malformed echoes fail rather than returning bytes.
- Acceptance: exact request, invalid inputs, short/trailing/wrong-length/wrong-echo responses are covered.

### D-131 — Public Clear Error API

- Scope: `clearError()`.
- Target: one fixed `0x1617/0x0000` empty-payload request and normal PLC-error propagation.
- Compatibility: additive replacement for raw command numbers.
- Acceptance: exact request and one-error/no-fallback behavior are covered.

### D-132 — HG target ownership

- Scope: low-level qualified HG operations and request target overrides.
- Target: preserve the connection or complete request override exactly; never infer from `U3En`, retry another target, or read back automatically. Cross-CPU reads remain valid.
- Compatibility: applications explicitly provide CPU No.2 target when required.
- Acceptance: `U3E1\HG` uses Own Station without an override and `0x03E1` only with the explicit CPU No.2 override.

- [x] Local implementation and regression tests completed.
- [x] 171 tests, editor smoke, package contents, and release check passed.
- [x] User API, migration, changelog, and shared target guidance updated.
- [x] Claude review of this delta completed through `CLAUDE-SLMP-20260712-02`; all findings were dispositioned and affected checks rerun.
- [x] New public-API verification completed through deterministic regression coverage and the approved live D-128/D-129/D-131 checks.
- [x] D-132 Extend Unit versus HG physical-area classification completed and recorded in the closed cross-implementation comparison.

## NR-006: Lifetime traffic statistics

Scope: low-level `SlmpClient.trafficStats()`, next release.

Target contract: the method returns a frozen client-lifetime snapshot. A request and its full frame
bytes count only after the complete socket send callback succeeds. Every complete received frame or
UDP datagram counts on receipt; both count before serial, end-code, or payload validation.
Unrecognized TCP subheaders, partial/failed sends, and pre-send failures do not count.
Close/reconnect does not reset counters; no reset API is exposed.

Acceptance criteria:

- [x] Implementation and deterministic boundary tests completed.
- [x] API reference, usage guide, and Unreleased changelog agree.
- [x] Live PLC verification is unnecessary because deterministic transports observe every boundary.
- [x] Final next-release package and cross-language API comparison completed. Evidence: the `v4.0.0`
  tag equals repository HEAD, the GitHub Release and npm
  `@fa_yoshinobu/node-red-contrib-plc-comm-slmp` `4.0.0` package are public, tag-commit checks passed,
  and the final five-implementation source/API comparison was completed on 2026-07-18.

## QREV-20260714-002: Response target-route correlation

Implementation scope: low-level `SlmpTransport` TCP and UDP receive paths for 3E and 4E responses,
including per-request target overrides snapshotted by `SlmpClient`.

Target contract: after complete-frame structural validation, a response is eligible for a pending
request only when its network, station, module I/O, and multidrop fields exactly match that request's
snapshotted target. A structurally valid foreign-route response is discarded while the pending
request's original timer remains active. A malformed response is a protocol error and invalidates
the transport generation.

Compatibility impact: a gateway or peer that returns route fields different from the requested
target no longer has its payload or PLC end code accepted; the request waits for a matching response
and otherwise times out at its original deadline.

Acceptance criteria:

1. TCP and UDP, in both 3E and 4E, discard a response that differs in each individual route field and accept a subsequent exact match.
2. A continuous foreign-route response stream cannot extend the request deadline.
3. Recognized but structurally malformed responses reject pending work and close the transport generation.
4. The public request path passes a copy of the effective target to transport correlation, and received-byte accounting remains before correlation filtering.

- [x] Implementation completed in this repository.
- [x] Tests added for every acceptance criterion.
- [x] Full static checks, 186-test suite, editor smoke test, and package check passed.
- [x] Codex source self-review completed against the target contract and cross-language field mapping.
- [x] Claude source review completed in the user-authorized 2026-07-14 batch; findings are preserved in the archived workspace record `claude_review_findings_20260714.md`.
- [x] Codex dispositioned every applicable Claude finding and reran affected checks; details are recorded below.
- [x] Live-PLC verification is not required because every correlation and invalidation boundary is deterministically observable with local/fake TCP and UDP peers.
- [x] Changelog and maintainer contract agree with the implementation; no public API reference changed.
- [x] Final acceptance verified and the item marked complete after family-wide comparison.

## QREV-20260714-003: One absolute 4E response-correlation deadline

Implementation scope: low-level `SlmpTransport` TCP and UDP 4E pending-response timers.

Target contract: the timer created once when a request becomes pending remains the only
communication deadline while wrong-serial and foreign-route responses are discarded. No discarded
response may restart, replace, or extend that timer.

Compatibility impact: none; this records and regression-locks the existing absolute-deadline
behavior while extending it to route correlation.

Acceptance criteria:

1. Continuous wrong-serial responses cannot extend the configured TCP or UDP timeout.
2. A matching serial and route received before the deadline completes normally.
3. Route filtering leaves the original pending timer unchanged.

- [x] Implementation behavior verified in this repository.
- [x] Deterministic TCP and UDP deadline regression tests added.
- [x] Full static checks, 186-test suite, editor smoke test, and package check passed.
- [x] Codex source self-review confirmed one timer per pending exchange.
- [x] Claude source review completed in the user-authorized 2026-07-14 batch; findings are preserved in the archived workspace record `claude_review_findings_20260714.md`.
- [x] Codex dispositioned every applicable Claude finding and reran affected checks; details are recorded below.
- [x] Live-PLC verification is not required because the deadline is a local transport state-machine contract.
- [x] Changelog and maintainer contract agree; no public API or migration action changed.
- [x] Final acceptance verified and the item marked complete after family-wide comparison.

### 2026-07-14 Claude finding disposition and re-verification

| Finding | Disposition and evidence |
|---|---|
| N-1 / F-X1 | Accepted. The pinned import ref is `v2.1.0`; the root-only `-FailIfChanged` check downloaded that tag and reported all four runtime/test fixtures unchanged. |
| N-2 / F-X2 | Accepted. `PROFILES.md` and the editor-option list in `USAGE_GUIDE.md` include `melsec:mx-r:rj71en71`. |
| N-3 | Accepted. A direct resolver test locks frame `4e`, series `iqr`, MX-R address behavior, and the RJ71EN71 range profile. |
| N-4 | Accepted. TCP/UDP and 3E/4E tests now run a foreign-route timeout, prove the old socket is retired, inject delayed matching data from that old socket, and accept only the response from a fresh generation. Self-review additionally found and fixed 4E UDP timeout retaining its old socket. |
| N-5 | Accepted. The 40 ms deadline regressions require at least 30 ms elapsed and passed five consecutive focused runs. |
| N-6 | Accepted. TCP tests split both the complete foreign response and the subsequent matching response across arbitrary chunk boundaries for 3E and 4E. |
| N-7 | Accepted. Actual TCP data callbacks carry their socket identity; data from a retired socket is ignored before buffering or byte accounting. |
| N-8 | Accepted as a documented private-transport consequence. A timeout retires the shared TCP generation and rejects every pending entry; the public client serializes requests, so normal callers have only one exchange in flight. |
| N-9 | Accepted as the bounded 4E wire contract. Serial allocation never duplicates an active pending serial; reuse is possible only after the 16-bit space wraps and the earlier exchange has completed. |
| N-10 | Accepted as architecture evidence. The distributed range-rules JSON is synchronized and package-tested but is not exposed as a runtime range-catalog API; runtime device-family decisions are covered against the pinned fixture. |
| F-X5 | Not applicable. The profile addition was already classified as a `Library` change, not only fixture tooling. |

Additional Codex self-review made short UDP datagrams and non-zero 4E reserved bytes explicit malformed-response cases for both transport implementations where applicable.

Re-verification evidence on Node.js `v24.14.1` / npm `11.12.1`:

- `scripts/update_slmp_profile_jsons.ps1 -FailIfChanged`: four files unchanged at `v2.1.0`.
- `run_ci.bat`: dependency audit clean, 186/186 tests passed, and the 39-file npm package dry-run passed.
- `npm run smoke:editor`: passed.
- Deadline/chunk/reconnect focused tests: four tests passed in five consecutive runs.
- `scripts/check_no_auto_publish.ps1` and `git diff --check`: passed.
- No live PLC communication was required or performed; these are deterministic local state-machine boundaries.

## BH-LIVE-SLMP-20260729 — Supplemental bug-hunt live verification

Scope: commit `00ff556cfefc438a17c51b6d2676f385e46ceeee`, profile `melsec:iq-r`, TCP
`192.168.250.100:1025`.

Target contract: the runtime client communicates with the selected profile and sends
profile-catalog range exceedances that fit the wire format instead of imposing the catalog as a
pre-send upper bound.

Acceptance evidence:

- [x] `D100` one-word read succeeded with value `0` through the current runtime client.
- [x] `R32768` reached the PLC and surfaced `SlmpError` end code `0x4031` for command `0x0401`,
  subcommand `0x0002`; no pre-send profile-range rejection occurred.
- [x] The repository working tree was clean after the live probes.

Disposition: all applicable supplemental live checks passed. J link-direct random/monitor layout
was not part of this repository's bug-hunt delta. The `R32768` result remains PLC-side address
evidence and does not authorize a communication-library profile-range guard.

## NODERED-LABEL-001 — Deterministic label-command wire contract

Scope: `readArrayLabels`, `writeArrayLabels`, `readRandomLabels`, and `writeRandomLabels`.

Target contract: implement `GOAL-SLMP-LABEL-001` from the workspace decision record. Unit `0` is a
logical bit count padded per 16 bits, unit `1` is a logical byte count padded per two bytes, caller
write buffers are exact and even, and response count/metadata/length/trailing data are validated.

Compatibility impact: zero lengths, odd random-label data, unpadded array data, and malformed or
uncorrelated responses that were previously tolerated now fail before transport or as `SlmpError`.

Acceptance criteria:

1. The shared boundary vectors produce `2,2,2,4,4` bytes for bit lengths `1,6,16,17,32` and
   `2,2,4,4` bytes for byte lengths `1,2,3,4`.
2. Invalid caller data produces no request.
3. Response count, array metadata, positive/even length, truncation, and full consumption are checked.
4. Unknown data type IDs and random spare values remain observable.

- [x] Implementation completed in this repository.
- [x] Tests added for every local acceptance criterion.
- [x] Full static, test, editor-smoke, and package checks passed.
- [x] Codex self-review completed and accepted findings corrected.
- [x] Live PLC verification is not required for deterministic arithmetic and injected response vectors.
- [x] Documentation, migration note, changelog, and package contents agree.
- [x] Final acceptance verified.

Verification evidence:

- `run_ci.bat` passed 192 tests and the npm package-content check; the tests were rerun directly
  after the final source edit and again passed 192/192.
- The Node-RED editor smoke check and no-auto-publish guard passed.
- Boundary, official six-bit, invalid-input/no-transport, correlation, truncation, trailing-data,
  unknown-type, and nonzero-spare vectors passed.
- `git diff --check` passed.

Self-review disposition:

- Accepted: request and response code duplicated the same wire-length arithmetic. One pure
  calculator now owns the formula and both paths use it.
- Accepted: invalid request-unit and truncated item-header cases were missing from the first test
  draft. Those cases were added and reverified.
- No rejected, duplicate, or deferred finding changes this contract.

## NODERED-REQUEST-001 — Representable and transport-safe request payloads

Scope: low-level request submission plus Array/Random Label Read/Write payload construction.

Target contract: implement `GOAL-SLMP-REQUEST-001` from the workspace decision record. TCP command
payloads are limited to 65,529 bytes. UDP 3E/4E payloads are limited to 65,492/65,488 bytes so the
complete frame is at most 65,507 bytes. Rejection precedes connection, send, counters, trace state,
and 4E serial allocation. Label aggregate length is validated before `Buffer.concat`.

Compatibility impact: oversized inputs now raise `ValueError` deterministically and are never
truncated or split automatically.

Acceptance criteria:

1. TCP 3E/4E and UDP 3E/4E boundary frames encode the exact request-data length and UDP datagram size.
2. Boundary-plus-one rejection preserves serial and traffic state and performs no transport action.
3. All four label builders accept 65,528 bytes and reject 65,530-byte aggregates, including
   abbreviation, multiple-point, and write-data cases.
4. Random Label Write rejects individual data lengths above the 16-bit field before encoding.

- [x] Implementation completed in this repository.
- [x] Tests added for every local acceptance criterion.
- [x] Relevant static, test, editor-smoke, and package checks passed.
- [x] Codex self-review completed and accepted findings corrected.
- [x] Live PLC verification is not required for deterministic field/datagram arithmetic.
- [x] Documentation, migration note, changelog, and generated API agree.
- [x] Final acceptance verified.

Verification evidence:

- `run_ci.bat` passed 194/194 tests, the Node-RED editor smoke, and npm package inspection.
- Canonical profile drift, the no-auto-publish guard, and `git diff --check` passed.
- Exact TCP 3E/4E and UDP 3E/4E limits, rejected-state invariants, all four label builders,
  abbreviation, multiple-point, write-data, and individual random-data limits passed.

Self-review disposition:

- Accepted: validation is required both before request queueing and inside the internal request path
  so neither public nor internal callers can consume serial/state before rejection. Both guards are
  retained and share one limit calculator.
- Rejected: selecting a larger IPv6-only UDP ceiling would make the pre-connect contract depend on
  deferred hostname resolution. The uniform 65,507-byte UDP frame ceiling is conservative for IPv6
  and preserves one predictable no-connect validation boundary.
- No duplicate or deferred finding changes this contract.

## NR-SLMP-PACKAGE-001 — Consumer-real package and worktree source gates

Scope: npm package construction/inspection, isolated consumer validation,
Node-RED flow validation, and self-contained source-archive validation.

Target contract: package evidence must come from a real npm tarball installed
into an isolated consumer and imported only by the declared package name. The
source-archive script must be able to construct its own synthetic Git tree from
the current worktree, including modified, untracked, and deleted paths, and the
extracted result must pass both the full repository gate and the installed
package-consumer gate.

Compatibility impact: no runtime or public API behavior changes. Maintainer and
CI failures are stricter because a checkout-relative import, dry-run-only pack,
invalid packaged flow, or incomplete current-worktree archive can no longer
serve as release evidence.

Acceptance criteria:

1. `npm pack` creates one real tarball whose consumer-only inventory is checked,
   including negative guards for root maintainer/runner files, credential-like
   files, caches, and build/release output without excluding intended examples.
2. A fresh isolated project installs that tarball, imports it by
   `@fa_yoshinobu/node-red-contrib-plc-comm-slmp`, validates the installed flow
   JSON, and reproduces public read/write/later-operation FIFO ordering from a
   generated UTF-8 JavaScript smoke file.
3. `check_source_archive.ps1 -IncludeWorktree` internally creates a synthetic
   tree covering modified, untracked, and deleted Git worktree paths without
   changing the real index.
4. The extracted source runs the full repository gate and real package-consumer
   gate under supported Node versions.

- [x] Implementation completed in this repository.
- [x] Tests and gates cover every acceptance criterion.
- [x] Node 18/current repository, package, and source-archive gates passed.
- [x] Codex self-review completed against artifact boundaries and the actual diff.
- [x] Live PLC verification is not required for deterministic packaging and archive mechanics.
- [x] Maintainer notes, changelog, CI, and gate behavior agree.
- [x] Final acceptance criteria verified and the item marked complete.

Verification evidence:

- Node.js 18.20.8 and 24.14.1 each passed the 64-file current-worktree
  source-archive gate after extraction, including all 218 tests and the real
  installed-tarball consumer gate.
- The tarball contained 34 consumer files; the isolated consumer imported the
  scoped package from its own `node_modules`, reproduced read/write/later-call
  FIFO ordering, and parsed all eight installed Node-RED flow JSON files.
- The no-auto-publish guard, `git diff --check`, temporary-index cleanup, and
  overhaul-branch check passed.

Self-review disposition:

- Accepted: `npm pack --dry-run` plus `require('./')` only proved checkout
  behavior. The gate now installs the produced tarball and resolves only the
  package name from an isolated consumer.
- Accepted: example-flow validation previously read checkout files. It now
  parses every installed package flow.
- Accepted: caller-built synthetic tree state was not an enforceable archive
  mode. The archive script now creates and removes its own temporary index.
- Accepted: extracted-source validation did not execute the installed-package
  contract. It now runs the package gate after the full source gate.
- Accepted: passing a here-string directly to native `node -e` on Windows did
  not preserve the JavaScript quoting, so process success did not prove the
  intended assertions ran. The gate now writes UTF-8 JavaScript under its
  disposable work root, executes that file, and emits an assertion-end marker.
- Accepted: the package inventory guard covered tests and maintainer tooling but
  did not cover all AC9/DIST AC7 negative categories. It now also rejects root
  maintainer/runner files, credential-like files, caches, and build/release
  output while retaining intended Node-RED examples.
- No rejected, duplicate, or deferred finding remains for this item.

## NR-SLMP-LIVE-001 — Completed interrupted managed-password close disposition

Scope: managed-password clients closed while active or queued work exists.

Target contract: `close()` retires the local generation immediately, performs no automatic
reconnect, resend, or managed-lock command, returns `SlmpOperationOutcomeUnknownError`, and
does not record an unconfirmed PLC lock state as locked.

Compatibility impact: none beyond the approved outcome-unknown contract.

Acceptance criteria:

1. Deterministic mock and local-socket tests verify local retirement and outcome-unknown behavior.
2. Controlled `melsec:iq-r` CPU built-in-Ethernet evidence verifies the tested path and restoration.
3. No PLC-specific result is claimed for another profile, and profile-by-profile live confirmation is not a publication requirement.
4. The release disposition is final and creates no open implementation or verification task.

- [x] Implementation and deterministic tests completed.
- [x] `melsec:iq-r` evidence completed at `192.168.250.100:1025` using a read-only `D0` probe; the final authentication state was verified locked.
- [x] Additional profile-by-profile live confirmation classified as not required.
- [x] Documentation and release-scope records agree.
- [x] Final acceptance verified; no follow-up TODO remains.

## GOAL-NODE-EDITOR-SMOKE-001 — Required package-installed Editor smoke

Implementation scope: the normal GitHub Actions CI workflow and the
repository-only Node-RED Editor smoke runner.

Target contract: one dedicated representative Linux/Node job installs an
explicit Node-RED version, supplies its exact executable through
`NODE_RED_CMD`, packs this repository, installs the tarball into an isolated
Node-RED user directory, starts the editor, imports and reads back the
maintained example, and proves registration of the connection, read, and write
node types. The consumer package manifest gains no test or smoke script.

Compatibility impact: none. This is a stricter CI and packaging acceptance
gate without a runtime or package-manifest API change.

Machine-verifiable acceptance criteria:

1. Normal CI contains one independent Ubuntu/Node 20 Editor smoke job pinned to
   Node-RED 4.1.11.
2. The job passes the exact existing `red.js` path through `NODE_RED_CMD`;
   an invalid explicit path fails instead of falling back to a global command.
3. The runner creates the npm tarball, installs it into an isolated user
   directory, imports and reads back `slmp-basic-read-write.json`, and finds
   `slmp-connection`, `slmp-read`, and `slmp-write`.
4. `package.json` contains no `test`, `check`, or Editor-smoke script.

- [x] Implementation completed in this repository.
- [x] Tests use the repository-only runner and the package-installed artifact.
- [x] Relevant local static, unit, Editor-smoke, package, and source-archive gates passed for the final source state.
- [x] Codex self-review completed against the approved CI/package boundary.
- [x] Live PLC verification is not required for package installation and editor registration.
- [x] Changelog and maintainer documentation agree with the implementation.
- [ ] The GitHub-hosted Ubuntu/Node 20 Editor-smoke job passed for the final source state.
- [ ] Final acceptance criteria verified and the item marked complete.

Local verification evidence on the final source state:

- The complete 219-test suite, real npm-tarball consumer, and current-worktree
  source-archive validation passed on Windows/Node 24.14.1.
- The package-installed Editor smoke passed with Node-RED 4.1.11 and the exact
  `red.js` path supplied through `NODE_RED_CMD`.
- The workflow-pinned Ubuntu/Node 20 execution was not reproduced locally and
  remains unchecked GitHub-hosted evidence.

Self-review disposition:

- Accepted: an explicit but missing `NODE_RED_CMD` previously fell back to a
  global executable, so the smoke could pass without using the CI-selected
  runtime. An explicit invalid path now fails immediately.
- Accepted: the SLMP smoke used an OS temporary path instead of the workspace
  diagnostics area. Its isolated user directory now uses a package-specific
  sibling under the workspace and is removed on success.
- Rejected: adding an npm manifest smoke script would duplicate the
  repository-only runner in a consumer artifact and conflicts with the
  approved package boundary.
- No duplicate or deferred finding remains for this item.

## GOAL-NODE-STATUS-DOC-001 — Exact node status and diagnosis contract

Implementation scope: connection/read/write runtime status tests and the
Node-RED usage guide collected by `plc-comm-docs-site`.

Target contract: stable lifecycle, operation, count, and control status values
match the runtime exactly. A failure is a red ring containing the actual
`error.message`; diagnosis uses the selected Node-RED error route and
structured Error type/fields. Timeout, operation-outcome-unknown, and
profile-capability classifications are not fixed status strings.

Compatibility impact: none. Existing runtime values are locked by tests and
documented without inventing new status values.

Machine-verifiable acceptance criteria:

1. Connection status tests cover `ready`, `connecting`, `connected`,
   `disconnecting`, `disconnected`, `reinitializing`, and `closed`
   with exact fill and shape.
2. Read/write tests cover `reading`, `writing`, successful `N item(s)`,
   all three control-action transitions, and dynamic red-ring error text.
3. Error-route tests retain the Error object and its structured classification.
4. The source usage guide and generated docs-site copy contain one matching
   status table and direct diagnosis to the selected error route.
5. Outcome-unknown writes are not described as retryable and local profile
   rejection is not described as PLC evidence.

- [x] Implementation completed in this repository.
- [x] Tests cover every local status and error-route acceptance criterion.
- [x] Relevant static, unit, package, source-archive, and docs checks passed for the final source state.
- [x] Codex self-review completed against runtime values, tests, docs, and cross-library consistency.
- [x] Live PLC verification is not required; status transitions and routing are deterministic runtime behavior.
- [x] Usage guide, generated site copy, changelog, and maintainer record agree.
- [x] Final acceptance criteria verified and the item marked complete.

Verification and self-review disposition:

- Runtime source, exact-status assertions, and both Node-RED source usage guides
  were compared field by field. The generated docs-site paths are ignored
  build output by design; their local copies contain the same status contract
  and deployment recollects the tracked source guide.
- Accepted: prior control tests covered only the final reinitialize status.
  They now cover all exact intermediate and completion values for every
  control action.
- Accepted: second-output tests now assert dynamic red-ring error text as well
  as the selected message route.
- No rejected, duplicate, or deferred finding remains for this item.

## GOAL-CROSS-OS-CI-001 — Bounded Windows socket-lifecycle contract smoke

Implementation scope: the normal GitHub Actions CI workflow, the focused
repository-only Windows smoke selector, and one deterministic connection-
failure test in the existing core test source.

Target contract: the authoritative complete gate remains the existing Ubuntu
Node 18/20/22 matrix. One independent Windows/Node 20 job runs only the
applicable socket-lifecycle contract subset: fragmented TCP receive,
TCP/UDP connection failure and timeout, close while connecting, transport
retirement and reconnect, rejection of late-generation data, and UDP route and
4E serial association. The selection uses fake or loopback transports and does
not communicate with a PLC.

Compatibility impact: none. This is CI and deterministic test coverage only;
it does not change the runtime API, package payload, supported protocol, or
user migration contract.

Machine-verifiable acceptance criteria:

1. CI has exactly one `windows-latest` socket-lifecycle smoke job using Node 20
   without a Node.js version matrix and with an explicit ten-minute upper bound.
2. The Ubuntu Node 18/20/22 complete test gate remains unchanged and
   authoritative.
3. The Windows selector executes only the eight named core lifecycle tests and
   fails when any selected test fails or cannot be started.
4. The selected tests cover fragmented receive, connection failure, connection
   and request timeout, close during connect, retirement/reconnect, ignored
   late data, and UDP route/serial association.
5. The Windows job does not execute the Node-RED Editor smoke, package/source
   validation, unrelated samples, or a full Node.js version matrix.
6. All selected tests use deterministic fake or IPv4 loopback peers and send no
   live PLC traffic.

- [x] Implementation completed in this repository.
- [x] Focused test selection covers every applicable lifecycle criterion.
- [x] The exact eight-test Windows selector passed locally on Windows with Node 24.14.1.
- [ ] Existing Linux complete gates and the Windows smoke passed on the same reviewed source state.
- [x] Codex self-review completed after the local representative and complete verification runs.
- [x] Live PLC verification is not required; the selected tests use fake or loopback transports only.
- [x] Maintainer documentation agrees with the implemented CI behavior; no changelog or user migration entry is required.
- [ ] Final acceptance criteria verified and the item marked complete.

Verification disposition: the exact selector and the complete 219-test local
gate passed on the same Windows/Node 24.14.1 source state. Package consumer,
current-worktree source archive, Node-RED 4.1.11 Editor smoke, canonical profile,
and no-auto-publish checks also passed. Node 18/20/22 and the GitHub-hosted Linux
and Windows jobs were not available locally, so no hosted matrix result is claimed.

Self-review disposition:

- Accepted: the existing lifecycle suite had no direct candidate-socket
  retirement assertion for TCP/UDP connection refusal. One deterministic fake-
  socket test now covers the shared failure contract and is included in both
  the Linux complete gate and Windows smoke.
- Reused: existing focused tests already cover all other accepted lifecycle and
  UDP-association behaviors, so the Windows job selects them rather than
  duplicating test implementations.
- Rejected: copying the full Linux gate, Editor process smoke, package/source
  validation, or Node version matrix to Windows would exceed the approved
  bounded contract.
- No deferred finding remains for this repository implementation.

## NR-SLMP-R1-20260801 — One Random Read named-read contract

Implementation scope: `compileReadPlan`, `readNamed`, the Node-RED read wrapper,
named-read tests, examples, and user documentation.

Target contract: one `readNamed` call emits exactly one canonical Random Read
request or rejects the complete operation before transport. Counted words,
strings, DWord arrays, and packable bit entries may be expanded and deduplicated
inside that request. A long-timer route that requires Direct Read is never
selected as a hidden fallback.

Compatibility impact: named reads that previously issued Direct, Block, or
several sequential requests now reject. Callers must use `readTyped`, an
explicit route helper, or application-defined separate operations.

Machine-verifiable acceptance criteria:

1. Every accepted `readNamed` call and Node-RED read operation invokes
   `readRandom` exactly once and invokes no Direct or Block read helper.
2. Counted word/string/DWord and packable bit entries decode from that one
   response, including aligned packed-bit word heads and device-specific DWord
   stride.
3. Mixed Random/Direct plans, `LTN`/`LSTN` Direct routes, and expanded plans over
   the profile limit reject before queue admission, transport, counters, or
   serial allocation.
4. The complete plan and route target are validated and snapshotted before the
   client FIFO turn; no partial result is exposed.
5. Examples and user documentation state the exact one-Random-Read boundary and
   the explicit migration route.

- [x] Implementation completed in this affected repository.
- [x] Tests added or updated for every acceptance criterion.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Live PLC verification is not required for this deterministic planning and pre-transport contract.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## NR-SLMP-N1-20260801 — Exact semantic device-unit enforcement

Implementation scope: direct, random-bit, Block, typed, named, and bit
convenience APIs plus their Node-RED wrappers.

Target contract: every semantic bit or bit-entry operation accepts only a
canonical bit device. Typed and named `BIT` accepts only bit devices; numeric
and string dtypes accept only word devices. Explicit low-level word-unit packed
access to a bit-device family remains supported. Standalone `G` and `HG` remain
word-only qualified routes.

Compatibility impact: calls that relied on a dtype, bit flag, or collection
name to reinterpret the wrong device unit now reject before transport.

Machine-verifiable acceptance criteria:

1. Every canonical device family is checked across Direct bit, random-bit, and
   both Block collection directions before transport.
2. Typed, named, and convenience helpers reject `BIT` on word devices and
   numeric/string types on bit devices before client I/O.
3. Explicit `bitUnit: false` packed word access to a bit device still encodes
   the word-unit subcommand and can read or write one packed word.
4. `G`/`HG` cannot pass a semantic bit route, and their existing qualified
   word-route requirements remain intact.

- [x] Implementation completed in this affected repository.
- [x] Tests added or updated for every acceptance criterion.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Live PLC verification is not required for deterministic device-metadata validation.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## NR-SLMP-N3-20260801 — Strict numeric runtime route and extension fields

Implementation scope: core target/extension normalization, connection-node
saved values, read/write route sources, examples, and documentation.

Target contract: runtime route and extension numeric fields accept only
primitive finite safe integer Numbers in range. Strings, Booleans, boxed
Numbers, coercible objects, and explicit `null` reject. An optional extension
field uses its documented default only when the property is omitted. Saved
connection fields and literal Route JSON are configuration syntax parsed by
field-specific radix before the strict client boundary. Visible editor defaults
remain `0`, `255`, `03FF`, and `0`. Qualified `Jn\...` and `Un\...` device syntax
is unchanged.

Compatibility impact: programmatic and dynamic route/extension objects must
replace numeric strings with Numbers. Existing editor display values and saved
literal configuration continue to work through explicit conversion.

Machine-verifiable acceptance criteria:

1. Every route field rejects decimal/hex/blank strings, Booleans, boxed values,
   non-finite/fractional/unsafe Numbers, coercible objects, negatives, and
   values above its range, naming the failing field.
2. Every extension numeric field and camel/snake alias applies the same
   primitive finite safe integer contract, rejects explicit `null` and alias
   conflicts, and preserves documented defaults only on omission.
3. Connection configuration and literal Route JSON parse decimal
   network/station/multidrop and hexadecimal module I/O into Numbers.
4. `msg`, `msg.slmp`, flow, global, environment, and direct client route objects
   remain strict and never parse JSON or numeric strings.
5. Qualified device syntax continues to parse J-network decimal and U-extension
   hexadecimal components without exposing a coercive numeric helper.

- [x] Implementation completed in this affected repository.
- [x] Tests added or updated for every acceptance criterion.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Live PLC verification is not required for deterministic input normalization.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## NR-SLMP-D1-20260801 — Definitive result precedence under concurrent close

Implementation scope: client lifecycle generation and deadline checks,
protocol and command-specific response decoding, deterministic TCP/UDP
lifecycle tests, and documentation.

Target contract: after response decode completes, success, write
acknowledgement, and PLC end-code error are definitive even if `close()` runs
concurrently. An incomplete state-changing request that may have been sent is
closed with outcome unknown. An incomplete non-state-changing read reports
`SLMP_CLOSED`. Active and queued work that has no definitive result still
follows deterministic close cancellation. The absolute deadline is enforced
through protocol decode and immediately before command-specific result
materialization. A result that becomes definitive is not replaced by a later
deadline observation.

Compatibility impact: a close that wins before protocol and command-specific
decode now deterministically replaces any later-arriving success bytes with
the closed classification. Once decoding is definitive, the result is unchanged.

Machine-verifiable acceptance criteria:

1. Explicit lifecycle barriers prove a close before definitive decode wins and
   a close after definitive decode preserves a successful read value.
2. Deterministic TCP and UDP schedules prove a materialized read value,
   acknowledged write, and nonzero PLC end code win over a later deadline.
3. Valid, malformed, and command-length-mismatched bytes arriving after close
   retain `SLMP_CLOSED`; a possibly sent incomplete write retains
   `SLMP_OPERATION_OUTCOME_UNKNOWN` with reason `closed`.
4. User documentation distinguishes definitive decoded results from incomplete
   state-changing operations.

- [x] Implementation completed in this affected repository.
- [x] Tests added or updated for every acceptance criterion.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Live PLC verification is not required for deterministic mocked lifecycle ordering.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

## NR-SLMP-R1-20260801 — High-level compiled-plan ownership

Implementation scope: typed, named, bit convenience, Random, Block, and Direct
high-level helper option construction plus deterministic tests and user docs.

Target contract: high-level helpers compile the device/value lists, block
lists, point counts, and bit/word route required by the requested semantic
operation. Caller options may supply request-scoped values such as `target`, but
same-named fields cannot replace or redirect that compiled plan.

Compatibility impact: callers that attempted to inject internal helper fields
through the options object no longer redirect the operation. Supported
request-scoped options continue to be forwarded.

Machine-verifiable acceptance criteria:

1. Opposite caller `bitUnit` values cannot change typed or bit-convenience
   Direct read/write routes.
2. Caller `wordDevices` and `dwordDevices` cannot replace named or typed Random
   Read destinations.
3. Caller `wordValues`, `dwordValues`, and `bitValues` cannot replace typed or
   named Random Write destinations or values.
4. Compiled Block lists remain authoritative, while a complete caller `target`
   reaches every resulting client request unchanged.

- [x] Implementation completed in this affected repository.
- [x] Tests added or updated for every acceptance criterion.
- [x] Relevant static checks, unit tests, integration tests, examples, and package/build checks passed.
- [x] Codex self-review completed against the approved contract and cross-language consistency requirements.
- [x] Live PLC verification is not required for deterministic request construction.
- [x] Documentation, migration notes, changelog, and generated API reference agree with the implementation.
- [x] Final acceptance criteria verified and the item marked complete.

### 2026-08-01 verification evidence and self-review disposition

The final current-worktree source-archive gate passed and, inside the extracted
archive, ran the complete 232-test suite, `npm ci`, and `npm pack --dry-run`.
The independent installed-package consumer gate passed with 34 files and all
eight maintained flow JSON files. Canonical profile fixtures were unchanged;
the no-auto-publish workflow guard, JavaScript syntax checks, example JSON
parsing, and `git diff --check` also passed. No live PLC traffic was sent.

Self-review inspected the actual runtime/API diff, validation order,
pre-transport behavior, request planning, route snapshots, definitive-result
lifecycle ordering, tests, examples, documentation, package contents, and the
approved cross-language target contracts.

- Accepted and corrected: low-level validation messages still recommended
  `readNamed` for long Direct routes that the new contract rejects. They now
  direct callers to `readTyped` or the explicit long-timer helper.
- Accepted and corrected: the initial expanded-read coverage did not prove a
  packed-bit boundary crossing or the different ordinary/long DWord strides.
  One deterministic one-request vector now covers both.
- Accepted and corrected: the routing flow supplied a dynamic string
  `moduleIO`; it now supplies numeric `1023`, while saved editor configuration
  retains the visible `03FF` default.
- Accepted and corrected: explicit `null` in an extension field was treated as
  omission by nullish fallback. Presence-based alias selection now rejects it,
  rejects a non-object extension container, and defaults only omitted fields.
- Accepted and corrected: the original concurrent-close regression scheduled
  close before response decode while asserting a definitive result. Lifecycle
  generation now remains authoritative through protocol and command-specific
  decode, and explicit before/after barriers cover valid, malformed, and
  length-mismatched responses plus possibly-sent writes.
- Accepted and corrected: caller options could overwrite high-level compiled
  Random device/value lists. Internal Direct, Random, and Block plan fields now
  win while supported request-scoped options such as `target` still propagate.
- Accepted and corrected during cross-library self-review: a post-materialization
  deadline check could replace an already-definitive decoded result with
  `SLMP_TIMEOUT`, contrary to D1. Deadline expiry is now checked immediately
  before command-specific materialization; decoded reads, write ACKs, and PLC
  end codes retain precedence over later expiry in deterministic TCP/UDP tests.
- Duplicate: the API and usage wording that omitted incomplete-read
  `SLMP_CLOSED` behavior was the documentation expression of D1 and was corrected
  under that item rather than tracked as a separate contract decision.
- Rejected: changing the editor's visible route defaults would conflict with
  the approved configuration/runtime boundary; explicit configuration parsing
  is retained instead.
- Deferred: none. No accepted finding remains open.
