# PLC profiles

## Intro

The `slmp-connection` node requires one canonical PLC profile. The node uses that value to choose the SLMP frame, PLC series behavior, and address-numbering rules.

For cross-profile capability and device-range details, see the [SLMP Profile Reference](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/).

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
| `melsec:qcpu` | MELSEC QCPU | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |
| `melsec:lcpu` | MELSEC LCPU | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |
| `melsec:qnu` | MELSEC QnU | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |
| `melsec:qnudv` | MELSEC QnUDV | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |

## How to configure the connection node

| Field | Example value | Description |
| --- | --- | --- |
| Host | `192.168.250.100` | IP address or host name for your PLC. |
| Port | `1025` | Use `1025` for TCP examples or `1035` for UDP examples. |
| Transport | `tcp` | Select `tcp` or `udp`. |
| PLC profile | `melsec:iq-r` | Select one exact canonical PLC profile from the table above. |
| Strict profile | enabled | Rejects operations known unavailable on the selected PLC profile before sending. |

## Strict profile

Strict profile is enabled by default. With a selected profile, operations known to be unavailable for that PLC are rejected before sending. Leave this enabled for normal flows.

Disable Strict profile only for deliberate verification where you want the PLC to answer directly.

Keep the default route fields unless your network requires a different target:

| Field | Default-style value | Description |
| --- | --- | --- |
| Network | `0` | Target network number. |
| Station | `255` | Target station number. |
| Module I/O | `03FF` | Own station or control CPU module I/O number. |
| Multidrop | `0` | Multidrop station number. |
