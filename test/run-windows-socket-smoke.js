"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const selectedTests = [
  "close deterministically cancels connecting TCP and ignores late success",
  "close deterministically cancels connecting UDP and ignores late callback",
  "TCP and UDP connect deadlines expose the dedicated timeout classification",
  "TCP and UDP connection failures reject and retire the candidate socket",
  "4E TCP timeout destroys its generation and a separately queued request reconnects",
  "TCP chunk assembly consumes a complete foreign route before accepting a split matching response",
  "foreign-route timeout retires the generation and the next exchange ignores delayed old data",
  "TCP and UDP 4E discard a wrong serial and accept the matching response within the deadline",
];

const exactSelection = `^(?:${selectedTests.map(escapeRegExp).join("|")})$`;
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-name-pattern",
    exactSelection,
    path.join(__dirname, "slmp-core.test.js"),
  ],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
