"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BUILTIN_CAPABILITY_PROFILES,
  Command,
  SlmpClient,
  SlmpProfileFeatureError,
  ValueError,
  ensureProfileFeatureAllowed,
} = require("../lib/slmp");
const fixture = require("./fixtures/slmp_builtin_ethernet_profiles.json");

test("built-in capability profile table matches the canonical fixture", () => {
  assert.deepEqual(BUILTIN_CAPABILITY_PROFILES, fixture);
});

test("blocked profile features fail before transport with a dedicated error", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv" });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(4) };
  };

  await assert.rejects(
    () => client.readBlock({ wordBlocks: [["D100", 1]], bitBlocks: [["M100", 1]] }),
    (error) =>
      error instanceof SlmpProfileFeatureError &&
      error.profileId === "melsec:qnudv" &&
      error.featureKey === "block" &&
      error.state === "blocked" &&
      /strictProfile=false/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("strictProfile=false sends blocked high-level requests", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv", strictProfile: false });
  const calls = [];
  client.request = async (command, subcommand, data) => {
    calls.push({ command, subcommand, data: Buffer.from(data) });
    return { endCode: 0, data: Buffer.alloc(4) };
  };

  await client.readBlock({ wordBlocks: [["D100", 1]], bitBlocks: [["M100", 1]] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, Command.DEVICE_READ_BLOCK);
});

test("supported, config-dependent, and delegated features are not profile-guarded", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv" });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.from([0x34, 0x12]) };
  };

  await client.readDevices("D100", 1);
  ensureProfileFeatureAllowed("melsec:iq-f", "ext_module_access", true);
  ensureProfileFeatureAllowed("melsec:lcpu", "long_device_path", true);

  assert.equal(calls, 1);
});

test("blocked link-direct features use the same strict profile guard semantics", () => {
  assert.throws(
    () => ensureProfileFeatureAllowed("melsec:iq-f", "ext_link_direct", true),
    (error) =>
      error instanceof SlmpProfileFeatureError &&
      error.profileId === "melsec:iq-f" &&
      error.featureKey === "ext_link_direct" &&
      error.state === "blocked"
  );
  assert.doesNotThrow(() => ensureProfileFeatureAllowed("melsec:iq-f", "ext_link_direct", false));
});

test("raw request API is not feature-guarded", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv" });
  let calls = 0;
  client._requestInternal = async (command, subcommand, data) => {
    calls += 1;
    assert.equal(command, Command.DEVICE_READ_BLOCK);
    assert.equal(subcommand, 0x0000);
    assert.deepEqual(Buffer.from(data), Buffer.alloc(0));
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await client.request(Command.DEVICE_READ_BLOCK, 0x0000, Buffer.alloc(0));

  assert.equal(calls, 1);
});

test("profile point limits are enforced independently of strictProfile", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r", strictProfile: false });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(96 * 2) };
  };

  const maxDevices = Array.from({ length: 96 }, (_, index) => `D${index}`);
  await client.readRandom({ wordDevices: maxDevices });
  await assert.rejects(
    () => client.readRandom({ wordDevices: [...maxDevices, "D200"] }),
    (error) => error instanceof ValueError && /1\.\.96/.test(error.message)
  );
  await assert.rejects(
    () => client.writeRandomWords({ wordValues: Object.fromEntries(Array.from({ length: 81 }, (_, index) => [`D${index}`, 0])) }),
    (error) => error instanceof ValueError && /1\.\.80/.test(error.message)
  );

  const iql = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-l", strictProfile: false });
  iql.request = async () => {
    throw new Error("unexpected transport call");
  };
  await assert.rejects(
    () =>
      iql.writeRandomWords({
        wordValues: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`D${8100 + index}`, 0])),
        dwordValues: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`D${8200 + index * 2}`, 0])),
      }),
    (error) => error instanceof ValueError && /limit=960/.test(error.message)
  );

  const iqf = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-f", strictProfile: false });
  iqf.request = async () => {
    throw new Error("unexpected transport call");
  };
  await assert.rejects(
    () =>
      iqf.writeRandomWords({
        dwordValues: Object.fromEntries(Array.from({ length: 138 }, (_, index) => [`D${9000 + index * 2}`, 0])),
      }),
    (error) => error instanceof ValueError && /limit=1920/.test(error.message)
  );

  assert.equal(calls, 1);
});

test("profile write_policy is enforced independently of strictProfile", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r", strictProfile: false });
  let calls = 0;
  client.request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeDevices("S0", [true], { bitUnit: true }),
    (error) => error instanceof ValueError && /S is read-only for plcProfile 'melsec:iq-r'/.test(error.message)
  );
  assert.equal(calls, 0);
});
