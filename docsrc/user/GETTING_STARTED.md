# Getting Started

## Start Here

Use this package when you want the shortest Node-RED path to Mitsubishi SLMP communication through the public high-level nodes.

Recommended first path:

1. Install the package into your Node-RED user directory.
2. Restart Node-RED.
3. Add one `slmp-connection` config node.
4. Set `host`, `port`, `transport`, and `PLC family`.
5. Import `examples/flows/slmp-basic-read-write.json`.
6. Replace the host and safe test addresses.
7. Deploy and confirm that one `D` read succeeds.

## First PLC Registers To Try

Start with these first:

- `D100`
- `D100,4`
- `D200:F`
- `D300:L`
- `D50.3`
- `M1000`

These stay on the public high-level surface and avoid the more complex routing and validation cases.

Do not start with these:

- `slmp-device-matrix.json`
- routed or multi-station requests
- future-tracked families such as `G`, `HG`, `LTS`, `LTC`, `LSTS`, `LSTC`, `LCS`, `LCC`, `LZ`

## First Connection Checklist

Set these fields explicitly on `slmp-connection`:

- `host`
- `port`
- `transport`
- `PLC family`
- timeout

Canonical `PLC family` values:

- `iq-f`
- `iq-r`
- `iq-l`
- `mx-f`
- `mx-r`
- `qcpu`
- `lcpu`
- `qnu`
- `qnudv`

If you do not already know a safe writable area, start with reads only.

## First Successful Run

The easiest sequence is:

1. Import `slmp-basic-read-write.json`.
2. Use a safe word address such as `D100`.
3. Deploy.
4. Confirm that `msg.payload` returns a scalar word value.
5. Move to `slmp-array-string.json` only after the first read is stable.

Expected result:

- the flow deploys without editor validation errors
- the read node returns a value in `msg.payload`
- the connection node remains stable across repeated injects

## What To Try Next

After the basic flow succeeds:

- import `slmp-array-string.json` for `,count` and string handling
- use `slmp-udp-read-write.json` when you want to confirm UDP
- use `slmp-device-matrix.json` only when you need one-by-one coverage across the public matrix

## Common Beginner Checks

If the first read fails, check these in order:

- correct `PLC family`
- correct `tcp` or `udp` selection
- a simple `D` address instead of a typed, count, or string form
- editor validation messages before deploy

## Next Pages

- [Supported PLC Registers](./SUPPORTED_REGISTERS.md)
- [Latest Communication Verification](./LATEST_COMMUNICATION_VERIFICATION.md)
- [User Guide](./USER_GUIDE.md)
