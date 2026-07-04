# Gotchas

Use this page only for library-specific caveats.

Shared SLMP setup, profile, point-limit, and end-code symptoms live in the shared
[SLMP Troubleshooting & End Codes](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/troubleshooting-end-codes/)
page. For profile limits and device availability, use the shared
[SLMP Profile Parameters](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/parameters/)
page.

## Current library-specific caveats

| Area | Symptom | Guidance |
| --- | --- | --- |
| Editor/runtime status | `slmp-read` produces no useful payload. | Open the `slmp-connection` config node, confirm the endpoint, and check the node status/debug sidebar. Use the shared end-code page when the PLC returns an SLMP end code. |
| Starter workflow | The first imported flow produces many skipped or failed entries. | Import `slmp-basic-read-write.json` first and verify a simple `D300:U` read before using the matrix flow. |
