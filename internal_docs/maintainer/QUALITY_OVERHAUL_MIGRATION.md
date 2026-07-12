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
- [ ] Claude source review completed — pending explicit user authorization.
- [ ] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for this deterministic configuration/privacy contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [ ] Final acceptance completed.

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
- [ ] Claude source review completed — pending explicit user authorization.
- [ ] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for this API-boundary contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [ ] Final acceptance completed.

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
- [ ] Claude source review completed — pending explicit user authorization.
- [ ] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for the local state-machine and mock-frame contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [ ] Final acceptance completed.

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
- [ ] Claude source review completed — pending explicit user authorization.
- [ ] Claude findings dispositioned and affected checks rerun.
- [x] No live-PLC check is required for the deterministic close/error contract.
- [x] User documentation, changelog, and migration notes agree with implementation.
- [ ] Final acceptance completed.

### D-007 — PLC end-code handling

Normal client construction omits `raiseOnError` and therefore reports every non-zero PLC end code as `SlmpError`. Controlled evidence code may use the actual Boolean `false` to receive the structured NG response. Constructor and request overrides reject non-Boolean aliases before transport; they never coerce strings, numbers, null, empty values, objects, or arrays into an error policy. Queue submission snapshots the inherited or explicit Boolean, so later mutation cannot change the response decision for an already submitted request. This setting does not convert connection failures or communication timeouts into successful responses.

### D-019 — Random-read category omission

Normal and Extended Device random reads may omit either `wordDevices` or `dwordDevices`. At least one valid device is required across both categories. All-empty input and explicit non-collection or malformed collections fail before request submission; they never become a zero-point request. The result always contains `word` and `dword` objects, with the unused category represented by an empty object.

### D-020 — Random-word-write category omission

Normal and Extended Device random word writes may omit either `wordValues` or `dwordValues`. At least one valid address/value pair is required across both categories. All-empty, explicit non-collection, malformed, invalid, duplicate, and overlapping destinations fail before request submission. Random bit write remains a separate API with required bit values.

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

## Verification checklist

- [x] Implementation completed for NR-SLMP-OH-001 through NR-SLMP-OH-011 in this repository.
- [x] Tests added or updated for the machine-verifiable acceptance criteria.
- [x] `npm test` passes 161 tests with zero skip, including four vendored shared-vector groups and
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
- [ ] Claude source review completed and findings recorded — pending user authorization; Claude has not been invoked.
- [ ] Codex resolved or dispositioned every Claude finding and reran affected checks — pending Claude review.
- [x] No new live-PLC result is required to decide these API/validation/transport-generation contracts; existing profile capability evidence was not changed to pass.
- [x] Documentation, migration notes, changelog, examples, and API reference agree with implementation.
- [ ] Final acceptance completed — pending Claude review and cross-library final consistency review.

## Live verification disposition

The changed acceptance criteria are fully observable through parser, mock transport, local TCP socket, editor, shared-vector, and package tests. No command in this batch requires a PLC response to distinguish pass from fail. Existing profile capability rows and hardware-specific compatibility remain unchanged and retain their prior verified/unverified state.

## Claude review status

Pending user authorization. Before invoking Claude, present this repository and diff scope, NR-SLMP-OH decisions, test/package evidence, supplied review material, and expected finding format, then wait for explicit authorization for that batch.
