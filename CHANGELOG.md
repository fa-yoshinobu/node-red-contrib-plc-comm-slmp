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

- Library: Added public monitor registration/cycle, self-test loopback, and fixed Clear Error semantic APIs to the low-level `SlmpClient`.
- Library: Monitor cycle expected counts must total at least one and stay within the selected profile's monitor-registration limit.
- Library: Monitor cycles require explicit registered counts and never auto-register or retry; self-test verifies declared length, actual length, and exact echo against the transmitted Buffer snapshot.
- Docs: Clarified that `U3En\HG` never changes or retries the explicitly selected request target.
- Tests: Removed vendored cross-repository vector JSON and its dedicated runner. Cross-implementation comparison is executed independently of this Node-RED package.
### BREAKING

- Library: `SlmpClient` now requires explicit `port`, `transport`, concrete `plcProfile`, and one complete `target` or `defaultTarget`; raw request `subcommand` and payload are required.
- Node-RED editor: Port `1025` and TCP remain only required initial values for a new connection
  node; saved/runtime port and transport are mandatory, and invalid values fail before client
  creation without fallback or transport switching.
- Node-RED editor: The four displayed own-station route values are initial values only. Saved
  connections require all four route fields, and a request route may be omitted as a whole or must
  provide all four fields; partial routes are never merged with defaults.
- Library: Removed public `strictProfile`, `strict_profile`, `normalizeStrictProfile`, profile-helper bypass, user-selected request `series` and 4E `serial`, localized end-code message hooks, and the `:I`, `:STRING`, and `DSTR...` address aliases. Profile-guard bypass remains only as a Boolean maintainer-internal constructor input.
- Node-RED: Removed the profile-guard checkbox. Old saved `strictProfile: true` is ignored safely, while false, aliases, null, blank, and unknown values fail with a migration error before client creation.
- Library: `readDevices` and `writeDevices` require Boolean `bitUnit`; Remote RUN requires Boolean `force` plus a discoverable `RemoteClearMode` value, and Remote PAUSE requires Boolean `force`.
- Library: Extended random APIs now derive route fields from qualified device text and accept only typed `SlmpExtendedDevice` Z/LZ/indirect modifiers. Raw extension objects, public raw extended encoders, and three-element write tuples are removed.
- Node-RED: Read/write source types, output/metadata/error modes, output count, runtime override shapes, and single-write dtype are now explicit and strictly validated. Single-write dtype must appear exactly once, either in the address or as an exact uppercase `msg.dtype`; double, missing, invalid, or incomplete selector forms fail before a client call. A present invalid runtime read/write property never falls back to configured addresses or updates.
- Node-RED: Connection/read/write `name` is optional display-only state. It is trimmed, non-string/blank input means no custom label, duplicates are allowed, and it never changes node identity, connection selection, routing, request bytes, or metadata.
- Node-RED editor: `str` remains the initial source type for a new read/write node, but missing or
  invalid saved `addressesType`/`updatesType` values are no longer silently repaired. Non-literal
  sources fail if their reference cannot be evaluated and never fall back to a literal address or
  update.
- Node-RED: A request route override may be omitted as a whole, but a configured route requires an
  explicit source type and one complete route object. Invalid message/configured routes no longer
  fall back to another source or the connection route; metadata records `targetSource` alongside
  the effective target.
- Node-RED: Read output shapes are fixed: `object` is always address-keyed, `array` is always an
  array, and `value` requires exactly one address; zero/multiple address values fail before the
  client call.
- Node-RED: Metadata modes are exact required values. Full/minimal output clears stale owned fields,
  identifies the current read/write operation, and preserves custom fields; off leaves existing
  `msg.slmp` untouched and does not represent it as current-result metadata.
- Node-RED: Error mode now uniquely defines the route and terminal count: `throw` uses no message,
  `msg` uses output 1, and `output2` uses output 2. Saved terminal counts must be exact integers and
  coercible strings/Booleans are rejected as migration conflicts.
- Node-RED: Removed `msg.slmpSkipUnsupported` and `msg.slmp.skipUnsupported`. Legacy occurrences emit
  a migration warning but cannot turn a structured capability error into a successful skipped
  message or override the configured error route.
- Node-RED: Remote password use now requires the `Use remote password` checkbox; when enabled, the credential must be non-empty.
- Library: `remotePassword` omission or explicit `undefined` disables managed authentication. Explicit null, empty, non-string, non-printable-ASCII, or profile-invalid credentials now fail during construction; the password is no longer retained as a public client property.
- Library: Removed the public `skipRemotePasswordLifecycle` connection/request option. Managed unlock/lock uses a private command path and cannot be bypassed through normal or raw request options.
- Library: Explicit `remotePasswordUnlock`/`remotePasswordLock` commands are rejected on a client configured for managed authentication; use an unconfigured maintainer client for deliberate manual password commands.
- Library: Managed remote-password state is bound to the concrete TCP/UDP connection generation. A new connection unlocks before its first user command, transport failure invalidates authentication state without replaying the failed command, and an old TCP socket event cannot clear a newer connection.
- Library: `close()` always attempts local transport closure and now reports password-lock failure. Simultaneous lock and local-close failures are preserved through an aggregate cause; Node-RED shutdown logs the sanitized failure and still completes its close callback.

### Changed

- Library: Random read keeps the unused word or DWord device list optional, rejects all-empty or invalid supplied collections before transport, and returns an explicit empty object for the unused result category.
- Library: Random word write keeps the unused word or DWord value list optional while rejecting all-empty, malformed, duplicate, overlapping, or invalid values before transport; random bit write remains a separate required-input API.
- Library: Block read/write keeps the unused word or bit block list optional, rejects all-empty or malformed inputs before transport, returns an explicit empty array for the unused read category, and rejects overlapping write ranges.
- Library: Communication timeout defaults to 3000 ms only when omitted; explicitly supplied timeout values must be integers in `1..2147483647` and invalid values are rejected without fallback. The monitoring timer defaults to four seconds (`0x0010`) only when omitted, accepts exact integers in `0..65535`, and preserves explicit zero as PLC-side indefinite processing wait. It remains independent from the client communication timeout. TCP sockets enable keepalive after 30 seconds idle.
- Library: TCP connection setup now fails closed if no-delay or required keepalive configuration throws. The socket is destroyed, the connect promise rejects, and the transport never retains the partially configured socket.
- Library: `raiseOnError` now defaults to `true` only when absent and accepts actual Booleans only at connection and request scope. Strings, numbers, null, empty values, objects, and arrays are rejected before transport instead of being coerced.
- Library: The complete connection target is immutable for the client lifetime. Each queued request now validates and snapshots its effective target, monitoring timer, end-code policy, and payload at call time, so later caller mutation cannot change the destination or request bytes.
- Library: `readNamed` and `writeNamed` emit one protocol request or reject the complete operation before transport. Compatible random or multi-block word entries may share that request; mixed command families and bit-in-word writes no longer create hidden follow-up requests.
- Library: Remote RESET uses fixed subcommand `0x0000` and payload `0x0001`, and completes after sending without waiting for a success response.
- Library: 4E serials are assigned internally and requests sharing one client are serialized.
- Library: UDP timeout detaches and closes the socket generation so delayed datagrams cannot satisfy a later request.

### Fixed

- Library: Random, extended-random, and block writes reject duplicate or overlapping destinations before transport.
- Library: Direct, random, extended-random, block, memory, and extend-unit write paths reject coercible strings, fractional values, Boolean-as-word values, truthy bit values, and out-of-range integers instead of masking or converting them.
- Library: `writeNamed` rejects overlapping word/DWord and normalized-address destinations; Extended Device random-read keys include Z/LZ/indirect modification so distinct operands cannot overwrite each other.
- Library: Send-only remote reset closes its transport generation after the frame is written, TCP busy rejection occurs before socket write, unlock failure preserves the primary error even when local close also fails, and LZ modifiers accept only index 0 or 1.
- Library: Removed inert end-code message properties; numeric end code, stable end-code key, structured error information, and password classification remain.
- Node-RED: Removed unsupported-device skip overrides and made metadata ownership deterministic across full, minimal, and off modes.
- Docs: Updated user pages and examples to the explicit overhaul contract.
- Tests: Added transport-state, keepalive, overlap, required-option, and one-request-limit coverage.

## [3.1.0] - 2026-07-10

### Added
- Library: Added `profileDescriptors()` for canonical SLMP profile metadata.

### Changed
- Release: Bumped npm package and lockfile metadata to `3.1.0`.
- Tooling: Pinned canonical SLMP profile imports to immutable profile commit `e7e8f071ff1819a6b088b6a793e6f08029c54e38`.

### Fixed
- Library: Rejected unknown boolean tokens and non-finite, fractional, signed-width, or out-of-range integer writes before transport instead of coercing them.
- Library: Required complete integer route values for message target overrides instead of accepting partial strings.
- Node-RED editor: Preserved an explicit monitoring timer value of zero in the connection node.
- Docs: Removed hand-maintained page navigation from `GETTING_STARTED.md`.
- Tests: Added regression coverage for write coercion, message route parsing, and zero monitoring timers.

## [3.0.0] - 2026-07-10

### Changed
- Release: Bumped npm package and lockfile metadata to `3.0.0`.
- Security: Protected the profile metadata admin endpoint with the `flows.read` permission.
- Docs: Replaced relative README links with absolute URLs so they resolve on package registry pages.

### Added
- Library: Added `availablePlcProfiles()` for connection-selectable canonical profile enumeration.
- Node-RED editor: Added a runtime profile metadata endpoint for the connection editor dropdown.

### Changed
- Node-RED editor: Removed hand-maintained profile-specific unsupported-device policy from read/write editor validation; runtime policy is now authoritative.
- Docs: Documented the connection profile list and base-profile exclusion.

## [2.0.0] - 2026-07-06

### BREAKING
- Library: Removed short `ModuleIONo` aliases in favor of the canonical module I/O vocabulary.

| Removed name | Use instead |
| --- | --- |
| `CONTROL_CPU`, `CONNECTED_CPU`, `DEFAULT` | `OWN_STATION` |
| `ACTIVE_CPU` | `CONTROL_SYSTEM_CPU` |
| `STANDBY_CPU` | `STANDBY_SYSTEM_CPU` |
| `TYPE_A_CPU` | `SYSTEM_A_CPU` |
| `TYPE_B_CPU` | `SYSTEM_B_CPU` |
| `CPU_1` to `CPU_4` | `MULTIPLE_CPU_1` to `MULTIPLE_CPU_4` |

### Changed
- Release: Bumped npm package metadata to `2.0.0`.
- Library: Added `ModuleIONo` named constants, structured mock error-data coverage, and low-level 008x extended random APIs.
- Library: Synced the SLMP capability JSON to `plc-comm-slmp-profiles` `v1.2.2`.
- Docs: Added the plc-comm family package matrix link to the README.
- Tooling: Changed the canonical profile update script default ref to `v1.2.2`.

## [1.2.0] - 2026-07-05

### Changed
- Release: Bumped package metadata to `1.2.0`.
- Tooling: Normalized line-ending handling in the canonical profile JSON update script so `-SourceRoot` runs no longer report false changes.

- Library: Synced the embedded SLMP capability fixture to `plc-comm-slmp-profiles` `v1.2.1`, including `display_name` labels and Ethernet unit profiles for RJ71EN71, LJ71E71-100, and QJ71E71-100 variants.
- Library: Added `displayName(plcProfile)` as the public UI-label helper while keeping stored PLC profile values canonical.
- Node-RED editor: Updated the `slmp-connection` PLC profile selector to show canonical `display_name` labels, preserve canonical option values, and omit the base-only QCPU profile from new selections.
- Docs: Documented the profile display-name helper and canonical-ID storage guidance.
- Tests: Added canonical fixture parity and editor-option coverage for profile `display_name` values.
- Samples: Added a read-only `slmp-multi-plc-monitor.json` operational flow with long-form row output and reconnect backoff guidance.
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
- Library: Serialized all requests on a single `SlmpClient` connection, including 4E and send-only requests. Concurrent 3E calls now wait instead of failing with a second-pending-request error, and 4E calls keep their results while sending one request at a time.
- Node-RED editor: Added a Strict profile checkbox to `slmp-connection`, enabled by default.
- Docs: Documented profile-specific `S` write policy and clarified `G/HG` guidance in the public Node-RED docs.
- Docs: Documented strict profile behavior, applied feature keys, and Node-RED out-of-scope capability keys.
- Docs: Removed the duplicated SLMP supported-register user page and linked users to the shared SLMP Profile Reference.
- Docs: Added a Usage Guide example showing how to read `msg.error.endCode` and structured `msg.error.errorInfo`.
- Docs: Documented single-connection request serialization and the separate-connection pattern for parallel communication.
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
