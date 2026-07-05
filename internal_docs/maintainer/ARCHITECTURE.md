# Node-RED SLMP Architecture

This package has three layers:

1. `lib/slmp/core.js`
   Encodes and decodes SLMP frames, devices, and response payloads.

2. `lib/slmp/client.js` and `lib/slmp/high-level.js`
   Provide the transport client plus the high-level named read/write helpers used by the nodes.

3. `nodes/*.js` and `nodes/*.html`
   Expose the Node-RED config, read, and write nodes.

## Request policy

Requests are serialized on a single client connection, including 4E and send-only requests.
This follows the SLMP/MC protocol cautions for model-dependent same-connection in-flight command limits; see `REQUEST_SERIALIZATION_2026-07-05.md`.

## High-level behavior

- contiguous words and bits are coalesced into block reads when practical
- sparse word and dword reads use random read
- writes are batched where the protocol path supports it

## Runtime structure

- `slmp-connection` owns the reusable client instance
- `slmp-read` resolves addresses and writes results to `msg.payload`
- `slmp-write` resolves updates and applies them through `writeNamed`
