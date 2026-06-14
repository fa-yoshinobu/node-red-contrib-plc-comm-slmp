# Supported registers

This page lists the public device families and address forms accepted by the Node-RED high-level nodes.

## Bit device families

| Family | Example | Numbering | Notes |
| --- | --- | --- | --- |
| `SM` | `SM400` | Decimal | Special relay. |
| `X` | `X20` | Octal on `melsec:iq-f`, hexadecimal on other profiles | Input. |
| `Y` | `Y20` | Octal on `melsec:iq-f`, hexadecimal on other profiles | Output. |
| `M` | `M1000` | Decimal | Internal relay. |
| `L` | `L100` | Decimal | Latch relay. |
| `F` | `F10` | Decimal | Annunciator. |
| `V` | `V10` | Decimal | Edge relay where supported. Not valid for `melsec:iq-f`. |
| `B` | `B20` | Hexadecimal | Link relay. |
| `TS` | `TS10` | Decimal | Timer contact. |
| `TC` | `TC10` | Decimal | Timer coil. |
| `LTS` | `LTS10` | Decimal | Long timer contact where supported. |
| `LTC` | `LTC10` | Decimal | Long timer coil where supported. |
| `STS` | `STS10` | Decimal | Retentive timer contact. |
| `STC` | `STC10` | Decimal | Retentive timer coil. |
| `LSTS` | `LSTS10` | Decimal | Long retentive timer contact where supported. |
| `LSTC` | `LSTC10` | Decimal | Long retentive timer coil where supported. |
| `CS` | `CS10` | Decimal | Counter contact. |
| `CC` | `CC10` | Decimal | Counter coil. |
| `LCS` | `LCS10` | Decimal | Long counter contact where supported. |
| `LCC` | `LCC10` | Decimal | Long counter coil where supported. |
| `SB` | `SB20` | Hexadecimal | Link special relay. |
| `DX` | `DX20` | Hexadecimal | Direct input. Not valid for `melsec:iq-f`. |
| `DY` | `DY20` | Hexadecimal | Direct output. Not valid for `melsec:iq-f`. |

## Word device families

| Family | Example | Numbering | Notes |
| --- | --- | --- | --- |
| `SD` | `SD100` | Decimal | Special register. |
| `D` | `D100` | Decimal | Data register. Recommended for the first read. |
| `W` | `W20` | Hexadecimal | Link register. |
| `TN` | `TN10` | Decimal | Timer current value. |
| `LTN` | `LTN10:D` | Decimal | Long timer current value where supported. Use `:D` or `:L`. |
| `STN` | `STN10` | Decimal | Retentive timer current value. |
| `LSTN` | `LSTN10:D` | Decimal | Long retentive timer current value where supported. Use `:D` or `:L`. |
| `CN` | `CN10` | Decimal | Counter current value. |
| `LCN` | `LCN10:D` | Decimal | Long counter current value where supported. Use `:D` or `:L`. |
| `SW` | `SW20` | Hexadecimal | Link special register. |
| `Z` | `Z10` | Decimal | Index register. |
| `LZ` | `LZ0:D` | Decimal | Long index register where supported. Use `:D` or `:L`. |
| `R` | `R100` | Decimal | File register where supported. |
| `ZR` | `ZR100` | Decimal | Extended file register where supported. Not valid for `melsec:iq-f`. |
| `RD` | `RD100` | Decimal | Refresh data register where supported. Not valid for `melsec:iq-f`, `melsec:qcpu`, `melsec:lcpu`, `melsec:qnu`, or `melsec:qnudv`. |

## Address syntax

| Form | Example | Meaning |
| --- | --- | --- |
| Plain word | `D100` | Unsigned 16-bit word. |
| Signed word | `D100:S` | Signed 16-bit word. |
| Signed word alias | `D100:I` | Alias that normalizes to `D100:S`. |
| Unsigned dword | `D100:D` | Unsigned 32-bit value. |
| Signed dword | `D100:L` | Signed 32-bit value. |
| Float | `D100:F` | 32-bit float. |
| String | `D100:STR,10` | UTF-8 string with a 10-byte maximum, packed two bytes per word. |
| String alias | `DSTR100,10` | Compatibility alias for `D100:STR,10`. |
| Bit in word | `D50.3` | One bit inside a word device. |
| Counted word | `D100,4` | Four consecutive word values. |
| Direct bit | `M1000` | One bit device. |
| Counted bit | `M1000,8` | Eight consecutive bit values. |

## Addressing notes

- `LTN`, `LSTN`, `LCN`, and `LZ` are 32-bit families. Use `:D` or `:L`, for example `LTN0:D` or `LCN0:L`.
- `G` and `HG` are not in the public node surface.
- `DX` and `DY` are not valid for `melsec:iq-f`.
- `X` and `Y` numbering is octal for `melsec:iq-f` and hexadecimal for all other profiles.
- `.bit` notation is only valid on word devices, for example `D50.3`.
- `.bit,count` is not supported.
- String forms require a length, for example `D100:STR,10`.
- The editor validates address format and PLC-profile support. It does not validate your PLC model's configured upper address range.

## Profile pointer

See [PLC profiles](./PROFILES.md) for the exact canonical profiles, frame mapping, and profile-specific cautions.
