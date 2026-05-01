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
