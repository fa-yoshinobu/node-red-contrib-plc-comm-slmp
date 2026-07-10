# PLC profiles

## Intro

The `slmp-connection` node requires one canonical PLC profile. The node uses that value to choose the SLMP frame, PLC series behavior, and address-numbering rules.
Use `profileDescriptors()` from `lib/slmp/capability-profiles` when an editor
or configuration schema needs the canonical name, display name, connection
availability, and base-profile relationship in one list. The abstract
`melsec:qcpu` entry is included with `connectable: false`. This descriptor list
is the stable source for selectors; store `canonicalName`, not `displayName`.

For cross-profile capability and device-range details, see the [SLMP Profile Reference](https://fa-yoshinobu.github.io/plc-comm-docs-site/slmp/profile-reference/).

The node intentionally does not infer this value from `ReadTypeName`, model
text, or model code. Some PLCs or communication paths cannot return a reliable
type name, and a wrong inference can select the wrong address grammar or range
catalog. Keep the PLC profile as an explicit human/configuration choice.

## Supported PLC profiles

| Canonical profile | Display name | Frame | Notes |
| --- | --- | --- | --- |
| `melsec:iq-f` | MELSEC iQ-F (built-in) | 3E | `X` and `Y` addresses use octal numbering. `DX` and `DY` are not valid. |
| `melsec:iq-r` | MELSEC iQ-R (built-in) | 4E | Default profile used by the examples. |
| `melsec:iq-r:rj71en71` | MELSEC iQ-R (RJ71EN71) | 4E | Ethernet-unit profile using iQ-R compatibility. |
| `melsec:iq-l` | MELSEC iQ-L (built-in) | 4E | Use for MELSEC iQ-L targets. |
| `melsec:mx-f` | MELSEC MX-F (built-in) | 4E | Use for MELSEC MX-F targets. |
| `melsec:mx-r` | MELSEC MX-R (built-in) | 4E | Use for MELSEC MX-R targets. |
| `melsec:lcpu` | MELSEC-L (built-in) | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |
| `melsec:lcpu:lj71e71-100` | MELSEC-L (LJ71E71-100) | 4E | Ethernet unit profile using Q/L compatibility. |
| `melsec:qcpu:qj71e71-100` | MELSEC-Q (QJ71E71-100) | 4E | Ethernet unit profile for QCPU connections. |
| `melsec:qnu` | MELSEC QnU (built-in) | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |
| `melsec:qnu:qj71e71-100` | MELSEC QnU (QJ71E71-100) | 4E | Ethernet unit profile using Q/L compatibility. |
| `melsec:qnudv` | MELSEC QnUDV (built-in) | 3E | Q/L-series profile. Use normal read/write flows for typical device access. |
| `melsec:qnudv:qj71e71-100` | MELSEC QnUDV (QJ71E71-100) | 4E | Ethernet unit profile using Q/L compatibility. |

`melsec:qcpu` is base-only and is not selectable in the editor. Use
`melsec:qcpu:qj71e71-100` for QCPU Ethernet unit connections.

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
| Module I/O | `03FF` | Own station module I/O number. |
| Multidrop | `0` | Multidrop station number. |
