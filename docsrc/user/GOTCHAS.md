# Gotchas

## slmp-read returns nothing

PLC type is not set on the connection node. It is required, and there is no runtime default.

Fix: open the `slmp-connection` node and select the correct PLC type.

## Mixed word+bit write in one slmp-write node fails

The PLC rejects command `0x1406` for word + bit combinations.

Fix: use separate `slmp-write` nodes for word writes and bit writes.

## G or HG address is rejected

`G` and `HG` are not in the high-level node surface.

Fix: use a function node with the low-level JS API if raw access is needed.

## DX or DY fails on melsec:iq-f

`DX` and `DY` are not valid for `melsec:iq-f`.

Fix: use `X` and `Y` instead.

## LTN/LSTN/LCN/LZ reads return wrong data

These are 32-bit families. Plain direct word access is rejected by the lower-level commands and can make a flow unclear.

Fix: address them as `LTN0:D`, `LSTN0:D`, `LCN0:D`, or `LZ0:D`. Use `:L` when you need signed 32-bit values.

## X or Y address works on one PLC type but fails on another

`melsec:iq-f` uses octal numbering for `X` and `Y`. Other supported profiles use hexadecimal numbering.

Fix: check the PLC type on `slmp-connection` before copying `X` or `Y` addresses between flows.

## D50.3,count is rejected

`.bit` notation is scalar-only. It is for one bit inside a word.

Fix: use `D50.3` for one bit, or use direct bit devices such as `M1000,8` when you need consecutive bit arrays.

## First test uses the device-matrix flow

`slmp-device-matrix.json` is a broad verification flow. It is useful after the connection works, but it is noisy for a first test.

Fix: import `slmp-basic-read-write.json` first and verify a simple `D300` read.
