# Gotchas

Use this page only for library-specific caveats.

Shared SLMP setup, profile, point-limit, and end-code symptoms live in the shared
[SLMP Troubleshooting & Codes](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/troubleshooting-codes/)
page. For profile limits and device availability, use the shared
[SLMP Profile Parameters](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/parameters/)
page.

## Current library-specific caveats

| Area | Symptom | Guidance |
| --- | --- | --- |
| IPv6 endpoint | The connection node rejects an IPv6 literal, or a hostname has no usable address. | TCP and UDP are IPv4-only. Use an IPv4 literal or a hostname with an IPv4 result; connections never select or fall back to IPv6. |
| Editor/runtime status | `slmp-read` produces no useful payload. | Open the `slmp-connection` config node, confirm the endpoint, and check the node status/debug sidebar. Use the shared end-code page when the PLC returns an SLMP end code. |
| Starter workflow | The first imported flow produces many failed entries. | Import `slmp-basic-read-write.json` first and verify a simple `D300:U` read before using the matrix flow. Unsupported profile/device combinations follow the selected error route rather than becoming successful skipped messages. |
| Remote-password disconnect | Disconnect reports an error even though the local socket is closed. | The final PLC lock failed or its result is unknown. Treat the local client as closed, but do not assume the PLC is locked; verify configuration before reconnecting. |
| Outcome unknown | A write fails with `SLMP_OPERATION_OUTCOME_UNKNOWN`. | Bytes may have reached the PLC before timeout, close, or transport failure. Do not retry automatically; verify PLC state first and inspect `reason` and `cause`. |
| Named read rejected before send | A mixed or large `readNamed` plan fails without PLC traffic. | One call must fit exactly one Random Read after counted/string/bit expansion. Use explicit typed/direct helpers or split the operation in application code. Long-timer Direct routes are never selected implicitly. |
| Dynamic route rejected | A route works as literal editor configuration but fails when supplied from `msg`, flow, global, or environment context. | Dynamic route objects require primitive integer Numbers in all four fields. The editor converts only saved connection values and literal Route JSON. |
| Device unit rejected | `:BIT`, a random bit entry, or a bit block rejects a word device, or a numeric/string dtype rejects a bit device. | Semantic bit operations require bit devices and semantic numeric/string operations require word devices. Use `.0` through `.F` for a word bit; explicit low-level packed word access is separate. |
