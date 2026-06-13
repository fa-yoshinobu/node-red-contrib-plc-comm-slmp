# Example flows

## What is in this directory

This directory contains importable Node-RED JSON flow files for the public `slmp-connection`, `slmp-read`, and `slmp-write` nodes. Start with the basic TCP flow, then use the other flows for arrays, strings, error routing, UDP, route overrides, and broader device coverage.

## How to import

1. Open the Node-RED editor.
2. Open the import menu.
3. Paste the JSON from one flow file.
4. Import the flow.
5. Open the `slmp-connection` config node.
6. Set Host to `192.168.250.100`.
7. Set the TCP Port to `1025`, or set the UDP Port to `1035`.
8. Select the correct PLC type, such as `melsec:iq-r`.
9. Deploy.

## Flow index

| File | What it demonstrates | Recommended first-use order |
| --- | --- | --- |
| [`slmp-basic-read-write.json`](slmp-basic-read-write.json) | Basic TCP read and write with scalar words, float values, and bit-in-word access. | 1 |
| [`slmp-array-string.json`](slmp-array-string.json) | TCP array access with `,count`, float arrays, and `:STR` string access. | 2 |
| [`slmp-control-error.json`](slmp-control-error.json) | Connection control messages, `msg`-provided addresses, and second-output error routing. | 3 |
| [`slmp-routing.json`](slmp-routing.json) | Per-request route override with `msg.target`. | 4 |
| [`slmp-udp-read-write.json`](slmp-udp-read-write.json) | Basic UDP read and write. Set the UDP port to `1035` before deploy. | 5 |
| [`slmp-device-matrix.json`](slmp-device-matrix.json) | One-by-one and run-all high-level read/write coverage with status feedback, skipped unsupported devices, timeout tracking, and JSONL logging. | 6 |
| [`slmp-demo.json`](slmp-demo.json) | Combined demo with connection controls, array read, string read, write, and error output examples. | 7 |

The device-matrix flow is for verification after your first simple read works. Do not use it as the first smoke test.
