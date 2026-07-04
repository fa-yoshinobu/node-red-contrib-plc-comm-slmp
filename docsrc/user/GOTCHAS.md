# Gotchas

Use this page as a short symptom index for the editor, debug sidebar, and node
status. For PLC response codes, use the shared
[SLMP Troubleshooting & End Codes](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/troubleshooting-end-codes/)
page. For profile limits and device availability, use the shared
[SLMP Profile Parameters](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/parameters/)
page.
For PLC-side Ethernet settings, use the shared
[MELSEC SLMP PLC Setup Guide](https://fa-yoshinobu.github.io/plc-comm-docs-site/plc-setup/slmp/).
Check Binary communication data code, port/open settings, and RUN-time write permission there before debugging flows.

## slmp-read returns nothing

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `slmp-read` produces no useful payload. | The connection node, endpoint, deploy state, or message address is wrong. | Open the `slmp-connection` config node, confirm the endpoint, and check the node status/debug sidebar. Use the shared end-code page when the PLC returns an SLMP end code. |

## Large requests fail with point-limit end codes

| Symptom | Root cause | Fix |
| --- | --- | --- |
| A large read/write flow fails with `C051`, `C052`, `C053`, or `C054`. | The request exceeds the selected profile's per-request point limit. | Split the address list across multiple nodes/messages. Check the shared profile parameter table for the limit. |

## Mixed word and bit write fails

| Symptom | Root cause | Fix |
| --- | --- | --- |
| One `slmp-write` node that writes word addresses and bit addresses returns a PLC error. | Some PLCs reject mixed word and bit block writes. | Use one `slmp-write` node/message for word updates and another for bit updates. |

## iQ-F X/Y or DX/DY addresses fail

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `X`/`Y` points look shifted, or `DX`/`DY` fails on `melsec:iq-f`. | iQ-F uses octal text for `X`/`Y`, and the iQ-F profile does not support `DX`/`DY`. | Use `X` and `Y` with the iQ-F profile and review addresses when copying flows between profiles. |

## Long timer/counter/index values look wrong

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Long timer, long counter, or long index values look truncated or are rejected. | `LTN`, `LSTN`, `LCN`, and `LZ` are 32-bit current-value families. | Address them as `LTN0:D`, `LSTN0:D`, `LCN0:D`, or `LZ0:D`; use `:L` for signed 32-bit values. |
| `LCS` or `LCC` does not behave like a word value. | Long counter state devices are bits. | Use `LCS0:BIT` or `LCC0:BIT`. |

## D50.3,count is rejected

| Symptom | Root cause | Fix |
| --- | --- | --- |
| An address such as `D50.3,8` is rejected. | `.bit` notation is scalar-only and means one bit inside one word. | Use `D50.3` for one bit, or use a direct bit range such as `M1000:BIT,8` for consecutive bit devices. |

## Device-matrix flow is noisy as a first test

| Symptom | Root cause | Fix |
| --- | --- | --- |
| The first imported flow produces many skipped or failed entries. | `slmp-device-matrix.json` is a broad verification flow, not the smallest connection smoke test. | Import `slmp-basic-read-write.json` first and verify a simple `D300:U` read before using the matrix flow. |
