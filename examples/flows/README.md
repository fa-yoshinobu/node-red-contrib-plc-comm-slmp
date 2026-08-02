# Example flows

## What is in this directory

This directory contains importable Node-RED JSON flow files for the public `slmp-connection`, `slmp-read`, and `slmp-write` nodes. Start with the basic TCP flow, then use the other flows for arrays, strings, error routing, UDP, route overrides, and broader device coverage.

Write controls are manual and opt-in. Use only controlled test addresses. The basic, array/string,
UDP, and combined demo flows save the original values, write random format-valid values, restore
after confirmed acknowledgements, and read again. Restoration is best effort: a transport failure,
PLC error, or outcome-unknown result stops the sequence. Do not retry automatically; inspect and
reconcile the target values manually.

## How to import

1. Open the Node-RED editor.
2. Open the import menu.
3. Paste the JSON from one flow file.
4. Import the flow.
5. Open the `slmp-connection` config node.
6. Set Host to `192.168.250.100`.
7. Set the TCP Port to `1025`, or set the UDP Port to `1035`.
8. Select the correct PLC profile, such as `melsec:iq-r`.
9. Deploy.

## Polling reconnect

The `slmp-connection` config node does not run a background reconnect timer by itself. It keeps one shared client and lets `slmp-read` / `slmp-write` send `connect`, `disconnect`, or `reinitialize` control messages through `msg.topic` or `msg.reinitialize`.

For a 24-hour polling flow, use an Inject node for the read interval, route the read node's error output or a Catch node to a Delay node, then send `msg.topic = "reinitialize"` back to the same read node before the next read. Start with a 1 second delay and cap the retry delay around 30 seconds. Keep the polling path read-only unless the flow is deliberately testing writes.

## Operational recipes

`slmp-multi-plc-monitor.json` is the read-only multi-PLC monitor recipe. It polls two connection config nodes, emits long-form rows shaped as `timestamp,plc,tag,value`, and uses `connected`, `lost`, `reconnecting`, and `recovered` state transitions with a 1 second to 30 second backoff.

For config-driven polling, keep the config in an Inject or Function node and feed `msg.addresses` into `slmp-read`. A compact JSON shape is:

```json
{"plcs":[{"name":"line-a","connection":"cfg-slmp-monitor-a","tags":[{"name":"d100","address":"D100:U"}]}],"interval":1,"initialBackoffMs":1000,"maxBackoffMs":30000}
```

To persist CSV-equivalent rows, route the long-form row messages through a CSV node with `timestamp`, `plc`, `tag`, and `value` columns, then into a File node in append mode.

## Flow index

| File | What it demonstrates | Recommended first-use order |
| --- | --- | --- |
| [`slmp-basic-read-write.json`](slmp-basic-read-write.json) | Basic TCP read plus an optional random write/restore check. Word/float and bit-in-word writes are separate supported operations. | 1 |
| [`slmp-multi-plc-monitor.json`](slmp-multi-plc-monitor.json) | Read-only multi-PLC monitor with long-form row output and reconnect backoff. | 1 after connection settings are known |
| [`slmp-array-string.json`](slmp-array-string.json) | TCP array access with `,count`, float arrays, and `:STR` plus an optional random write/restore check. | 2 |
| [`slmp-control-error.json`](slmp-control-error.json) | Connection control messages, `msg`-provided addresses, and second-output error routing. | 3 |
| [`slmp-routing.json`](slmp-routing.json) | Per-request route override with `msg.target`. | 4 |
| [`slmp-udp-read-write.json`](slmp-udp-read-write.json) | UDP read plus an optional random write/restore check. Set port `1035`; an unknown UDP write outcome requires manual reconciliation. | 5 |
| [`slmp-device-matrix.json`](slmp-device-matrix.json) | Read-only one-by-one and run-all high-level coverage with status feedback, explicit error routing, timeout tracking, and JSONL logging. Broad writes are disabled; use a dedicated restore flow. | 6 |
| [`slmp-demo.json`](slmp-demo.json) | Combined demo with connection controls, reads, an optional random write/restore check, and error outputs. | 7 |

The device-matrix flow is for verification after your first simple read works. Do not use it as the first smoke test.
