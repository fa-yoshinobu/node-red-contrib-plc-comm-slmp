# TODO

## Future device support

These device families are tracked as future high-level support targets.
Do not treat them as current released support in the README or user-facing guides.

### Device matrix follow-up

Observed from the high-level `slmp-device-matrix` verification flow:

- `LCS`
  - long counter contact remains a future support target
- `LCC`
  - long counter coil remains a future support target
- `G`
  - routed high-level access still needs stable released support guidance;
    QnUDV `U0\G10` read-only returned `0xC070` on the current target
- `HG`
  - routed high-level access still needs stable released support guidance;
    Q-series targets such as QnUDV do not have `HG`

## Notes

- This file tracks future device support work only.
- Validation logs remain the source of truth for observed runtime behavior.

## Cross-Stack Alignment

- [x] **Validate iQ-F X/Y octal handling on FX5 hardware**: FX5UC-32MT/D returned `X0000-X1777` and `Y0000-Y1777` as `Base8`; `X100` and `Y100` read successfully through iQ-F octal address parsing.
- [x] **Split iQ-L from iQ-R range rules**: `iq-l` now uses its own range family while keeping 4E/iQR communication and iQ-R-style address parsing. `L16HCPU` was live-validated in the sibling stacks with `SM0-SM4095`, `SD0-SD4095`, `D0-D18431`, `LZ0-LZ1`, `LTN0-LTN1023`, `LSTN0-LSTN31`, and `LCN0-LCN511`.
- [x] **Keep control-message behavior aligned**: `connect`, `disconnect`, and `reinitialize` control handling is exposed consistently through the shared connection node and the read/write nodes.
- [x] **Stabilize metadata schema**: The user-facing metadata modes now stay aligned around connection profile, effective target, and item-count summaries.
- [x] **Keep route options explicit**: Target-routing fields remain explicit connection or message-level options; there is no hidden route auto-detection layer.
- [x] **Preserve semantic atomicity by default**: Read and write nodes keep the caller-visible logical request shape. Protocol-defined segmentation, when it exists below the node surface, must stay documented and must not be hidden behind fallback semantic changes.
