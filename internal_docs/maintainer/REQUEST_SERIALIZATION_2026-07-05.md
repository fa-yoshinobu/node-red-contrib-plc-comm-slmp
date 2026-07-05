# SLMP Single-Connection Request Serialization

Date: 2026-07-05

## Source Basis

Mitsubishi SLMP reference SH-080931 section 3.3 and MC protocol reference
SH-080003 section 3.2 both warn about sending multiple request messages with
serial numbers before receiving the earlier response messages.

The manuals define a model-dependent limit for the number of commands that can
be processed on one connection. Relevant examples from the goal investigation:

| Equipment class | One-connection command limit formula |
| --- | --- |
| RCPU built-in Ethernet | `1 + (32 / used connections)` |
| LHCPU built-in Ethernet | `1 + (32 / used connections)` |
| QJ71E71-100 / LJ71E71-100 | `1 + (57 / used connections)` |
| QJ71E71-B2 / QJ71E71-B5 | `1 + (10 / used connections)` |

When the limit is exceeded, the PLC may report an error or may not return a
response. That second outcome appears to the Node-RED runtime as timeouts and
can cascade across queued flow messages.

## Decision

`SlmpClient.request()` serializes requests on a single client instance. The next
request does not enter the transport exchange until the previous request has
completed, timed out, failed due to transport closure, or failed with a PLC
end-code response.

This applies to:

- 3E and 4E frames
- TCP and UDP transports
- normal request/response commands
- `expectResponse: false` send-only commands
- remote password unlock/lock sequences

The transport keeps 4E serial response matching because it still protects
against delayed or unmatched responses, but normal public requests no longer use
multiple in-flight serials on one connection.

## Reasoning

The library cannot safely calculate the manual limit at runtime. The effective
limit depends on PLC model and on how many connections are currently used by
other clients, which this Node-RED package cannot know.

Using in-flight `1` is therefore the only model-independent behavior that
honors the manuals for every supported PLC. Users who need parallelism should
create separate `slmp-connection` config nodes so each path uses a separate PLC
connection.

## Regression Coverage

`test/slmp-core.test.js` covers:

- 4E TCP second request frame does not reach the mock server until the first
  response is sent
- FIFO order for three concurrently issued 4E requests
- gate release after timeout, transport close, and PLC end-code error
- FIFO order with an `expectResponse:false` send-only request in the middle
- 3E concurrent requests wait and both complete instead of failing on a second
  pending request
- remote password unlock does not deadlock behind the serialization gate
