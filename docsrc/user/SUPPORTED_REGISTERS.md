# Supported PLC Registers

This page is the canonical public register/device table for the Node-RED high-level nodes.

## Supported Bit Devices

| Family | Kind | Example | Numbering |
| --- | --- | --- | --- |
| `SM` | bit | `SM400` | decimal |
| `X` | bit | `X20` | `iq-f`: octal, otherwise hexadecimal |
| `Y` | bit | `Y20` | `iq-f`: octal, otherwise hexadecimal |
| `M` | bit | `M1000` | decimal |
| `L` | bit | `L100` | decimal |
| `F` | bit | `F10` | decimal |
| `V` | bit | `V10` | decimal |
| `B` | bit | `B20` | hexadecimal |
| `TS` | bit | `TS10` | decimal |
| `TC` | bit | `TC10` | decimal |
| `LTS` | bit | `LTS10` | decimal |
| `LTC` | bit | `LTC10` | decimal |
| `STS` | bit | `STS10` | decimal |
| `STC` | bit | `STC10` | decimal |
| `LSTS` | bit | `LSTS10` | decimal |
| `LSTC` | bit | `LSTC10` | decimal |
| `CS` | bit | `CS10` | decimal |
| `CC` | bit | `CC10` | decimal |
| `LCS` | bit | `LCS10` | decimal |
| `LCC` | bit | `LCC10` | decimal |
| `SB` | bit | `SB20` | hexadecimal |
| `DX` | bit | `DX20` | hexadecimal |
| `DY` | bit | `DY20` | hexadecimal |

## Supported Word Devices

| Family | Kind | Example | Numbering |
| --- | --- | --- | --- |
| `SD` | word | `SD100` | decimal |
| `D` | word | `D100` | decimal |
| `W` | word | `W20` | hexadecimal |
| `TN` | word | `TN10` | decimal |
| `LTN` | word | `LTN10` | decimal |
| `STN` | word | `STN10` | decimal |
| `LSTN` | word | `LSTN10` | decimal |
| `CN` | word | `CN10` | decimal |
| `LCN` | word | `LCN10` | decimal |
| `SW` | word | `SW20` | hexadecimal |
| `Z` | word | `Z10` | decimal |
| `LZ` | dword | `LZ0` / `LZ1` | decimal |
| `R` | word | `R100` | decimal |
| `ZR` | word | `ZR100` | decimal |
| `RD` | word | `RD100` | decimal |

## High-Level Address Forms

| Form | Example | Meaning |
| --- | --- | --- |
| plain word | `D100` | unsigned 16-bit word |
| signed view | `D100:S` or `D100:I` | signed 16-bit value (`I` normalizes to `S`) |
| dword view | `D200:D` | unsigned 32-bit value |
| long view | `D300:L` | signed 32-bit value |
| float view | `D200:F` | float32 value |
| bit in word | `D50.3` | one bit inside a word |
| counted word read | `D100,10` | 10 consecutive values |
| counted bit read | `M1000,8` | 8 consecutive bits |
| string view | `D100:STR,10` | UTF-8 string packed into words |
| compatibility alias | `DSTR100,10` | alias for `D100:STR,10` |

## Addressing Notes

- Start with `D` for the first smoke test.
- `B`, `W`, `SB`, `SW`, `DX`, and `DY` use hexadecimal device numbers.
- `X` and `Y` require explicit `plcFamily`.
- `iq-f` interprets string `X/Y` addresses in octal.
- all other supported families interpret string `X/Y` addresses in hexadecimal.
- Most other families use decimal numbers.
- `.bit` is valid only on word devices such as `D50.3`.
- `LTN`, `LSTN`, and `LCN` default to 32-bit current-value access in the public high-level nodes.
- `LTS`, `LTC`, `LSTS`, and `LSTC` state reads use the long timer 4-word decode helpers.
- `LCS` and `LCC` state reads use direct bit read; high-level state writes use random bit write (`0x1402`).
- `LZ` defaults to 32-bit random DWord access in the public high-level nodes. On iQ-F, use `LZ0` or `LZ1`.

## Family-Specific Unsupported Devices

These are device-code support rules only. The editor and helper APIs use them to reject or skip device codes that the selected family does not expose in the public surface; they are not address upper-bound checks.

| PLC type | Unsupported device codes in the public Node-RED surface |
| --- | --- |
| all families | `G`, `HG` |
| `iq-r`, `iq-l`, `mx-f`, `mx-r` | none beyond `G`, `HG` |
| `iq-f` | `V`, `LTS`, `LTC`, `LTN`, `LSTS`, `LSTC`, `LSTN`, `DX`, `DY`, `ZR`, `RD` |
| `qcpu` | `LTS`, `LTC`, `LTN`, `LSTS`, `LSTC`, `LSTN`, `LCS`, `LCC`, `LCN`, `LZ`, `RD` |
| `lcpu`, `qnu`, `qnudv` | `LTS`, `LTC`, `LTN`, `LSTS`, `LSTC`, `LSTN`, `LCS`, `LCC`, `LCN`, `LZ`, `RD` |

This table follows only the supported/unsupported device-code portion of the .NET library's `DEVICE_RANGES.md`; Node-RED does not use it for PLC range or upper-bound validation.

## iQ-R SD Range Maximum Reference

For iQ-R-series targets, the PLC-configured current point count is read from
the family-specific `SD` range registers by libraries that expose a device range
catalog. The maximum below is the cap for that SD-derived point count:

`point_count = min(SD point count, max_point_count)`

The displayed upper bound is then `point_count - 1`. Node-RED keeps this as a
reference table only; it still does not pre-check PLC model-specific address
upper bounds. If an address exceeds the connected PLC's actual configured
range, the PLC response is returned as the runtime error.

| Item | Node-RED device codes | Max address | max_point_count | Setting unit |
| --- | --- | --- | --- | --- |
| `X` | `X` | `X2FFF` | `12288` (`0x3000`) | n/a |
| `Y` | `Y` | `Y2FFF` | `12288` (`0x3000`) | n/a |
| `M` | `M` | `M94674943` | `94674944` (`0x5A4A000`) | 64 points |
| `B` | `B` | `B5A49FFF` | `94674944` (`0x5A4A000`) | 64 points |
| `F` | `F` | `F32767` | `32768` | 64 points |
| `SB` | `SB` | `SB5A49FFF` | `94674944` (`0x5A4A000`) | 64 points |
| `V` | `V` | `V32767` | `32768` | 64 points |
| `L` | `L` | `L32767` | `32768` | 64 points |
| `T` | `TS`, `TC`, `TN` | `T5259711` | `5259712` | 32 points |
| `ST` | `STS`, `STC`, `STN` | `ST5259711` | `5259712` | 32 points |
| `LT` | `LTS`, `LTC`, `LTN` | `LT1479295` | `1479296` | 1 point |
| `LST` | `LSTS`, `LSTC`, `LSTN` | `LST1479295` | `1479296` | 1 point |
| `C` | `CS`, `CC`, `CN` | `C5259711` | `5259712` | 32 points |
| `LC` | `LCS`, `LCC`, `LCN` | `LC2784543` | `2784544` | 32 points |
| `D` | `D` | `D5917183` | `5917184` (`0x5A4A00`) | 4 points |
| `W` | `W` | `W5A49FF` | `5917184` (`0x5A4A00`) | 4 points |
| `SW` | `SW` | `SW5A49FF` | `5917184` (`0x5A4A00`) | 4 points |

## Not Currently in the Public Surface

- `G`
- `HG`

If a family is not listed above, do not treat it as publicly supported by the current Node-RED package.
