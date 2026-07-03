# Latest communication verification

This page keeps the current public summary only.

## Current Retained Summary

- current public target: `0.2.12`
- verified PLC models: `FX5UC-32MT/D`, `Q06UDVCPU`, `R08CPU`
- verified transports: `TCP`, `UDP`
- verified public nodes: `slmp-connection`, `slmp-read`, `slmp-write`
- retained first-run smoke path: `slmp-basic-read-write.json`
- current examples use explicit PLC profile selection

## Confirmed Public Register Scope

- bit devices: `SM`, `X`, `Y`, `M`, `L`, `F`, `V`, `S`, `B`, `TS`, `TC`, `LTS`, `LTC`, `STS`, `STC`, `LSTS`, `LSTC`, `CS`, `CC`, `LCS`, `LCC`, `SB`, `DX`, `DY`
- word devices: `SD`, `D`, `W`, `TN`, `LTN`, `STN`, `LSTN`, `CN`, `LCN`, `SW`, `Z`, `LZ`, `R`, `ZR`, `RD`
- typed forms: `:S`, `:D`, `:L`, `:F`
- high-level special forms: `.bit`, `,count`, `:STR`, `DSTR`

## Practical Cautions

- set one explicit PLC profile for every connection
- older flows using `PLC series` / `frame type` should be updated to the current PLC profile selector
- start with `D:U` reads before using counted or string forms
- treat `S` according to the selected profile's write policy
- keep `slmp-device-matrix.json` for later verification, not for the first smoke test
- do not rely on Node-RED for PLC model-specific range or upper-bound checks; range errors come from the PLC/runtime response
- `.bit,count` is not part of the current public high-level surface
