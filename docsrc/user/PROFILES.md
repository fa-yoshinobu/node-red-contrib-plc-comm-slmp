# PLC profiles

## Intro

The `slmp-connection` node requires one canonical PLC profile. The node uses that value to choose the SLMP frame, PLC series behavior, and address-numbering rules.

The node intentionally does not infer this value from `ReadTypeName`, model
text, or model code. Some PLCs or communication paths cannot return a reliable
type name, and a wrong inference can select the wrong address grammar or range
catalog. Keep the PLC profile as an explicit human/configuration choice.

## Supported PLC profiles

| Canonical profile | Human label | Frame | Notes |
| --- | --- | --- | --- |
| `melsec:iq-f` | MELSEC iQ-F | 3E | `X` and `Y` addresses use octal numbering. `DX` and `DY` are not valid. |
| `melsec:iq-r` | MELSEC iQ-R | 4E | Default profile used by the examples. |
| `melsec:iq-l` | MELSEC iQ-L | 4E | Use for MELSEC iQ-L targets. |
| `melsec:mx-f` | MELSEC MX-F | 4E | Use for MELSEC MX-F targets. |
| `melsec:mx-r` | MELSEC MX-R | 4E | Use for MELSEC MX-R targets. |
| `melsec:qcpu` | MELSEC QCPU | 3E | Q/L-series profile. Read Block (`0x0406`) and Write Block (`0x1406`) are rejected; use normal read/write flows instead of block access. |
| `melsec:lcpu` | MELSEC LCPU | 3E | Q/L-series profile. Strict profile rejects measured unavailable block and type-name routes. |
| `melsec:qnu` | MELSEC QnU | 3E | Q/L-series profile. Read Block (`0x0406`) and Write Block (`0x1406`) are rejected; use normal read/write flows instead of block access. |
| `melsec:qnudv` | MELSEC QnUDV | 3E | Q/L-series profile. Strict profile rejects measured unavailable block and type-name routes. |

## How to configure the connection node

| Field | Example value | Description |
| --- | --- | --- |
| Host | `192.168.250.100` | IP address or host name for your PLC. |
| Port | `1025` | Use `1025` for TCP examples or `1035` for UDP examples. |
| Transport | `tcp` | Select `tcp` or `udp`. |
| PLC profile | `melsec:iq-r` | Select one exact canonical PLC profile from the table above. |
| Strict profile | enabled | Rejects high-level features known unavailable on the selected built-in Ethernet profile before sending. |

## Strict profile capability guard

Strict profile is enabled by default and uses the built-in capability table imported from `plc-comm-slmp-profiles` `v1.0.0`.

The Node-RED high-level surface applies capability guards and limits to `type_name`, `direct`, `random`, `block`, monitor payload validation and limits, `long_device_path`, and `lz_32bit_path`. Raw request calls are not feature-guarded.

The keys `ext_module_access`, `ext_link_direct`, and `hg_cpu_buffer` are outside the public Node-RED high-level node surface in this package. They are not guarded by the Node-RED nodes.

Keep the default route fields unless your network requires a different target:

| Field | Default-style value | Description |
| --- | --- | --- |
| Network | `0` | Target network number. |
| Station | `255` | Target station number. |
| Module I/O | `03FF` | Own station or control CPU module I/O number. |
| Multidrop | `0` | Multidrop station number. |

## Profile-specific cautions

| Canonical profile | Caution |
| --- | --- |
| `melsec:iq-f` | Frame 3E. `DX` and `DY` are not valid. `X` and `Y` addressing is octal. |
| `melsec:iq-r` | Frame 4E. `X` and `Y` addressing is hexadecimal. |
| `melsec:iq-l` | Frame 4E. `X` and `Y` addressing is hexadecimal. |
| `melsec:mx-f` | Frame 4E. `G` and `HG` are not in the public high-level surface. |
| `melsec:mx-r` | Frame 4E. `G` and `HG` are not in the public high-level surface. |
| `melsec:qcpu` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. Block commands `0x0406` / `0x1406` are rejected. |
| `melsec:lcpu` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. Strict profile rejects Read Type Name (`0x0101`) and block commands `0x0406` / `0x1406`; disabling strict profile sends them and lets the PLC respond. |
| `melsec:qnu` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. Block commands `0x0406` / `0x1406` are rejected. |
| `melsec:qnudv` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. Strict profile rejects Read Type Name (`0x0101`) and block commands `0x0406` / `0x1406`; disabling strict profile sends them and lets the PLC respond. |
