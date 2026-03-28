# Example Flows

See also:

- [Project README](../../README.md)
- [User Guide](../../docsrc/user/USER_GUIDE.md)
- [Documentation Index](../../docsrc/index.md)

Import one of these files into Node-RED, then update the connection host, port, transport, and safe device addresses for the target PLC before deploy.

Start here:

- [`slmp-basic-read-write.json`](slmp-basic-read-write.json) for the first TCP smoke test
- [`slmp-array-string.json`](slmp-array-string.json) when you want to check `,count` and `DSTR`
- [`slmp-device-matrix.json`](slmp-device-matrix.json) when you want one-by-one high-level coverage across the matrix catalog with persistent JSONL logging, pending tracking, and timeout detection
- [`slmp-udp-read-write.json`](slmp-udp-read-write.json) when you need UDP first

- [`slmp-demo.json`](slmp-demo.json): combined demo with control messages, array read, string read, and error second output
- [`slmp-basic-read-write.json`](slmp-basic-read-write.json): basic TCP read and write with scalar, float, and word-bit examples
- [`slmp-array-string.json`](slmp-array-string.json): TCP array and string read/write examples using `,count` and `DSTR`
- [`slmp-control-error.json`](slmp-control-error.json): connection control, configured `msg` source, and second-output error routing
- [`slmp-device-matrix.json`](slmp-device-matrix.json): one-by-one high-level read, write, and readback across the matrix catalog with completed-result history, run summary, and `logs/slmp-device-matrix-<session>.jsonl`
- [`slmp-routing.json`](slmp-routing.json): per-request routing using `msg.lookup` and `msg.target`
- [`slmp-udp-read-write.json`](slmp-udp-read-write.json): basic UDP read and write example
