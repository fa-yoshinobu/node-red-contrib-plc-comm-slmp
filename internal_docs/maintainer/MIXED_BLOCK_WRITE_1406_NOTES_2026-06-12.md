# Mixed Block Write 1406 Layout Notes

Date: 2026-06-12

## Summary

`SlmpClient.writeBlock` must encode SLMP `0x1406` Write Block payloads with
each block's write data immediately after that block's own device spec and
point count:

```text
[word block count][bit block count][block spec + point count + block data]...
```

The invalid shape is:

```text
[word block count][bit block count][all block specs][all word data][all bit data]
```

That invalid shape can appear to work for a single word-only or bit-only block
because there is only one spec/data pair. Mixed word+bit and multi-block
requests make the PLC consume later bytes as the wrong field.

## Verification Result

The cross-library root cause was closed on 2026-06-12. Fixed Python/Rust/.NET
clients were live-verified with one-request mixed `0x1406` writes returning
`0x0000` and readback match. Node-RED now emits the same corrected layout and
passes the shared cross-verify block cases.

Historical end codes from the malformed layout:

| Target/path | Old layout result | Fixed layout result |
| --- | --- | --- |
| R08CPU built-in Ethernet | `0xC05B` mixed, `0xC051` multi-word | `0x0000`, readback match |
| L02SCPU via LJ71E71-100 | `0xC056` | `0x0000`, readback match |
| Q06UDVCPU via QJ71E71-100 | `0xC056` | `0x0000`, readback match |
| L16HCPU built-in Ethernet | `0xC05B` mixed, `0xC051` multi-word | `0x0000`, readback match |
| FX5UC-32MT/D, 3E path | `0xC061` | `0x0000`, readback match |
| QnUDV built-in Ethernet | `0xC059` for block commands | still `0xC059`; use non-block commands |

`0xC059` on the QnUDV built-in Ethernet path is separate from this bug. That
path rejects block commands themselves, so use normal or random read/write
commands instead of `0x0406`/`0x1406`.

## Current Node-RED Behavior

- `lib/slmp/client.js` encodes each block's data inline after its spec.
- There is no automatic mixed-write fallback in this package.
- If the PLC rejects the request, the original PLC end code should surface to
  the caller.

Manual references used for the fix:

- English manual, PDF pages 76-78,
  `Write Block (command: 1406)`.
- Japanese manual, PDF pages 75-77,
  `Write Block(コマンド: 1406)`.
