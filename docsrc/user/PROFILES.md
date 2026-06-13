# PLC profiles

## Intro

The `slmp-connection` node requires one PLC type string. The node uses that value to choose the SLMP frame, PLC series behavior, and address-numbering rules.

## Supported PLC types

| PLC type string | Hardware | Frame | Notes |
| --- | --- | --- | --- |
| `melsec:iq-f` | MELSEC iQ-F / FX5 | 3E | `X` and `Y` addresses use octal numbering. `DX` and `DY` are not valid. |
| `melsec:iq-r` | MELSEC iQ-R | 4E | Default profile used by the examples. |
| `melsec:iq-l` | MELSEC iQ-L | 4E | Uses the iQ-R address family rules in the current source. |
| `melsec:mx-f` | MELSEC MX-F profile | 4E | Uses the MX-F address family rules in the current source. |
| `melsec:mx-r` | MELSEC MX-R profile | 4E | Uses the MX-R address family rules in the current source. |
| `melsec:qcpu` | MELSEC QCPU | 3E | Q/L-series profile. |
| `melsec:lcpu` | MELSEC LCPU | 3E | Q/L-series profile. |
| `melsec:qnu` | MELSEC QnU | 3E | Q/L-series profile. |
| `melsec:qnudv` | MELSEC QnUDV | 3E | Q/L-series profile. |

## How to configure the connection node

| Field | Example value | Description |
| --- | --- | --- |
| Host | `192.168.250.100` | IP address or host name for your PLC. |
| Port | `1025` | Use `1025` for TCP examples or `1035` for UDP examples. |
| Transport | `tcp` | Select `tcp` or `udp`. |
| PLC type | `melsec:iq-r` | Select one exact PLC type string from the table above. |

Keep the default route fields unless your network requires a different target:

| Field | Default-style value | Description |
| --- | --- | --- |
| Network | `0` | Target network number. |
| Station | `255` | Target station number. |
| Module I/O | `03FF` | Own station or control CPU module I/O number. |
| Multidrop | `0` | Multidrop station number. |

## Profile-specific cautions

| PLC type | Caution |
| --- | --- |
| `melsec:iq-f` | Frame 3E. `DX` and `DY` are not valid. `X` and `Y` addressing is octal. |
| `melsec:iq-r` | Frame 4E. `X` and `Y` addressing is hexadecimal. |
| `melsec:iq-l` | Frame 4E. `X` and `Y` addressing is hexadecimal. |
| `melsec:mx-f` | Frame 4E. `G` and `HG` are not in the public high-level surface. |
| `melsec:mx-r` | Frame 4E. `G` and `HG` are not in the public high-level surface. |
| `melsec:qcpu` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. |
| `melsec:lcpu` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. |
| `melsec:qnu` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. |
| `melsec:qnudv` | Frame 3E. Long timer/counter and `LZ` families are not valid in the public profile. |
