# SLMP Manual Audit Reflection - 2026-06-13

This repository keeps the Node-RED-specific record of the SLMP manual audit so
the external memo repository is not required to understand the current state.

Audit basis:

- Manual: MELSEC SLMP reference manual SH-080931-R.
- Live target used for the final decisions: R120PCPU at `192.168.250.101:1025`.
- Q/L password check: `melsec-q` route with password `1234`.
- Cross-stack confirmation date: 2026-06-13.

## Decisions Reflected In This Repository

| ID | Decision | Node-RED status |
|---|---|---|
| A-1 Remote Reset `1006` | Use `1006/0000 + 01 00`. Payload-less reset returned `0xC061`; `01 00` reset succeeded when remote reset was allowed on the PLC. | Reflected in `remoteReset()` and shared vectors. |
| A-2 Random bit write `1402/0003` | Keep ON as `01 00`. The manual-like `00 01` returned success but did not turn the bit ON in live readback. | No code change. Existing behavior is retained. |
| A-3 Remote Stop `1002` | High-level Remote Stop sends only fixed `01 00`. The old force variant is not a manual branch. | `remoteStop({ force: true })` is rejected. |
| A-4 Remote Password `1630/1631` | iQ-R/iQ-L use little-endian length plus ASCII password, 6..32 bytes; Q/L uses `04 00 + 4 ASCII bytes`. | Reflected in password encoding. |
| A-5 ZR address radix | ZR device numbers are decimal. The manual table entry that looks hexadecimal is treated as unreliable. | No code change. |
| A-6 Step relay `S` | R120PCPU can read and monitor `S`, but write failed and GX Works cannot monitor it in the user workflow. | Not exposed as a public high-level device. |
| A-7 Self Test `0619` | High-level API follows the manual: 1..960 bytes and ASCII `0`-`9` / `A`-`F` only. | No new Node-RED Self Test user API is planned. |
| A-8 Link Direct `J` | Keep the current 11-byte layout and `0080/0081`; `0082/0083` failed with `0xC061` on iQ-R. | No code change. |
| A-9 `G` / `HG` extension layout | Keep the current capture-compatible layout. The manual order failed with `0xC061` on R120PCPU. | No code change. |
| A-10 point limits | Add manual preflight checks for continuous, random, block, memory, and helper-layer requests. | Reflected. |

## Verification Result

The cross-stack rerun recorded for the audit was:

```text
npm test
90 passed, 0 failed
```

The Node-RED implementation was also checked for:

- Remote Reset wire form `1006/0000/0001`.
- Rejection of non-manual `remoteStop({ force: true })`.
- Manual point-limit preflight checks.
- Existing TCP_NODELAY behavior.
- Canonical `plcProfile` strings using `melsec:...` only.

## Notes To Keep With This Repository

- A separate Node-RED Self Test API is intentionally not added. The Node-RED
  package remains focused on read/write, routing, and remote operations.
- `Self Test` payloads from 256 to 960 bytes are allowed by the lower-level
  manual-facing implementations, but R120PCPU live testing showed imperfect
  loopback data for that range.
- Q/L legacy point limits are based on the manual formulas and cross-stack
  reflection. They were not fully live-verified on every Q/L model.
- Remote Run and Remote Pause keep their manual force branches. Only Remote Stop
  lost force because the manual has no Remote Stop force branch.
