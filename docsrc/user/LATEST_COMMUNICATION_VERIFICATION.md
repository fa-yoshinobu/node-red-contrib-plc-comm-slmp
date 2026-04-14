# Latest Communication Verification

This page keeps the current public summary only. Older detailed notes are not kept in the public documentation set.

## Current Retained Summary

- verified PLC models: `FX5UC-32MT/D`, `Q06UDVCPU`, `R08CPU`
- verified transports: `TCP`, `UDP`
- verified public nodes: `slmp-connection`, `slmp-read`, `slmp-write`
- retained first-run smoke path: `slmp-basic-read-write.json`

## Confirmed Public Register Scope

- bit devices: `SM`, `X`, `Y`, `M`, `L`, `F`, `V`, `B`, `TS`, `TC`, `STS`, `STC`, `CS`, `CC`, `SB`, `DX`, `DY`
- word devices: `SD`, `D`, `W`, `TN`, `LTN`, `STN`, `LSTN`, `CN`, `LCN`, `SW`, `Z`, `R`, `ZR`, `RD`
- typed forms: `:S`, `:D`, `:L`, `:F`
- high-level special forms: `.bit`, `,count`, `:STR`, `DSTR`

## Practical Cautions

- set one explicit `PLC family` for every connection
- start with `D` reads before using typed, counted, or string forms
- keep `slmp-device-matrix.json` for later verification, not for the first smoke test
- `.bit,count` is not part of the current public high-level surface

## Where Older Evidence Went

Public historical report clutter was removed. Maintainer-only retained evidence now belongs under `internal_docs/`.
