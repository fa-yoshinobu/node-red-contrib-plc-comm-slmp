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
| Editor/runtime status | `slmp-read` produces no useful payload. | Open the `slmp-connection` config node, confirm the endpoint, and check the node status/debug sidebar. Use the shared end-code page when the PLC returns an SLMP end code. |
| Starter workflow | The first imported flow produces many failed entries. | Import `slmp-basic-read-write.json` first and verify a simple `D300:U` read before using the matrix flow. Unsupported profile/device combinations follow the selected error route rather than becoming successful skipped messages. |
| Remote-password disconnect | Disconnect reports an error even though the local socket is closed. | The final PLC lock failed or its result is unknown. Treat the local client as closed, but do not assume the PLC is locked; verify configuration before reconnecting. |
