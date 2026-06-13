# TODO

No active TODO is currently tracked for `G` / `HG`.

## Scope Notes

`G` and `HG` are intentionally unsupported in the public Node-RED high-level surface.
Keep them out of the public register table and the default `slmp-device-matrix` flow.
Do not track them as future high-level support unless a new public support policy is
approved.

## Notes

- This file tracks future device support work only. Unsupported-by-policy items do not need
  TODO entries.
- Validation logs remain the source of truth for observed runtime behavior.

## Cross-Stack API Alignment

- [x] **Finalize `PlcProfile` naming alignment**: The connection selector is `plcProfile`, frame type and PLC series are derived from that profile on the standard route, and profile text accepts only canonical lowercase values such as `melsec:iq-r`. Short labels such as `iq-r`, `iqr`, `q`, `l`, and `qnudvcpu` are rejected.
