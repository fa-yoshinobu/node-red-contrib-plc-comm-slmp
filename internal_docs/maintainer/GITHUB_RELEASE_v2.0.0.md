# v2.0.0

## BREAKING

Short `ModuleIONo` aliases were removed in favor of canonical module I/O names.

| Old name | New name |
| --- | --- |
| `CONTROL_CPU`, `CONNECTED_CPU`, `DEFAULT` | `OWN_STATION` |
| `ACTIVE_CPU` | `CONTROL_SYSTEM_CPU` |
| `STANDBY_CPU` | `STANDBY_SYSTEM_CPU` |
| `TYPE_A_CPU` | `SYSTEM_A_CPU` |
| `TYPE_B_CPU` | `SYSTEM_B_CPU` |
| `CPU_1` to `CPU_4` | `MULTIPLE_CPU_1` to `MULTIPLE_CPU_4` |

## Package Name

| Registry | Package |
| --- | --- |
| npm | `@fa_yoshinobu/node-red-contrib-plc-comm-slmp` unchanged |

## Highlights

- npm package metadata bumped to 2.0.0.
- Added 008x extended random APIs and refreshed SLMP profile data.
- README links to the plc-comm package matrix.

Package matrix: https://fa-yoshinobu.github.io/plc-comm-docs-site/package-matrix/
