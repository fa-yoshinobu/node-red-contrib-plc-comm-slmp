# Gotchas

Each entry starts with the symptom you will see in the editor, debug sidebar, or node status. The fixes refer to the public `slmp-connection`, `slmp-read`, and `slmp-write` nodes.

## slmp-read returns nothing

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `slmp-read` produces no useful payload or errors immediately. | The selected `slmp-connection` has no PLC profile at runtime. The runtime requires one explicit canonical PLC profile. | Open the `slmp-connection` config node and select the correct PLC profile, such as `melsec:iq-r`. |

## Mixed word+bit write fails

| Symptom | Root cause | Fix |
| --- | --- | --- |
| One `slmp-write` node that writes word addresses and bit addresses returns a PLC error. | Some PLCs reject mixed word and bit block writes. | Use one `slmp-write` node for word updates and another `slmp-write` node for bit updates. |

## Some profiles reject block commands

| Symptom | Root cause | Fix |
| --- | --- | --- |
| A flow or function-node call that uses block access fails when the connection profile is `melsec:qcpu`, `melsec:qnu`, `melsec:lcpu`, or `melsec:qnudv`. | These profiles do not use block access for normal high-level flows. | Use normal read/write flows or separate direct/random operations for those profiles. Only disable Strict profile when you intentionally want to send the command and inspect the PLC response. |

## S write is rejected

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `S10:BIT` can be read but `slmp-write` rejects it. | The selected profile marks `S` as read-only. iQ-F profiles allow `S` writes. | Follow the selected profile's write policy. |

## G/HG rejected

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `G` or `HG` addresses are rejected by `slmp-read` or `slmp-write`. | Module buffer access is not exposed through the high-level Node-RED node surface. | Keep `G` and `HG` out of high-level flows, or use a function node with the lower-level JavaScript API for qualified extend-unit access. |

## DX/DY fails on melsec:iq-f

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `DX` or `DY` fails when the connection PLC profile is `melsec:iq-f`. | The iQ-F profile does not support `DX` and `DY`. | Use `X` and `Y` for iQ-F, and remember that iQ-F `X`/`Y` text uses octal numbering. |

## LTN/LSTN/LCN/LZ reads return wrong data

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Long timer, long counter, or long index values look truncated or are rejected. | `LTN`, `LSTN`, `LCN`, and `LZ` are 32-bit current-value families, not normal 16-bit word values. | Address them as `LTN0:D`, `LSTN0:D`, `LCN0:D`, or `LZ0:D`; use `:L` for signed 32-bit values. |

## Non-canonical PLC profile rejected

| Symptom | Root cause | Fix |
| --- | --- | --- |
| A hand-edited flow or environment-provided PLC profile is rejected. | The node accepts only exact canonical PLC profiles. Short names and aliases are not normalized. | Use one of the canonical profiles shown in the `slmp-connection` dropdown, such as `melsec:iq-r`. |

## X/Y works on one PLC profile but fails on another

| Symptom | Root cause | Fix |
| --- | --- | --- |
| An `X` or `Y` address works after changing PLC profile but points at a different I/O point. | `melsec:iq-f` uses octal `X`/`Y` text, while the other supported profiles use hexadecimal text. | Review `X` and `Y` addresses whenever you copy a flow between PLC profiles. |

## D50.3,count is rejected

| Symptom | Root cause | Fix |
| --- | --- | --- |
| An address such as `D50.3,8` is rejected. | `.bit` notation is scalar-only and means one bit inside one word. | Use `D50.3` for one bit, or use a direct bit range such as `M1000:BIT,8` for consecutive bit devices. |

## Device-matrix flow is noisy as a first test

| Symptom | Root cause | Fix |
| --- | --- | --- |
| The first imported flow produces many skipped or failed entries. | `slmp-device-matrix.json` is a broad verification flow, not the smallest connection smoke test. | Import `slmp-basic-read-write.json` first and verify a simple `D300:U` read before using the matrix flow. |
