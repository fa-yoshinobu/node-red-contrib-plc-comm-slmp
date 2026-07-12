"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicApi = require("../lib/slmp");
const {
  BUILTIN_CAPABILITY_PROFILES,
  Command,
  SlmpClient: StrictSlmpClient,
  SlmpProfileFeatureError,
  ValueError,
  displayName,
  ensureProfileFeatureAllowed,
  profileDescriptors,
} = publicApi;
const fixture = require("./fixtures/slmp_ethernet_profiles.json");
const TEST_TARGET = Object.freeze({ network: 0, station: 0xff, moduleIO: 0x03ff, multidrop: 0 });

function SlmpClient(options) {
  const client = new StrictSlmpClient({ port: 1025, transport: "tcp", target: TEST_TARGET, ...options });
  const readDevices = client.readDevices.bind(client);
  client.readDevices = (device, points, requestOptions = {}) => readDevices(device, points, { bitUnit: false, ...requestOptions });
  return client;
}

test("built-in capability profile table matches the canonical fixture", () => {
  assert.deepEqual(BUILTIN_CAPABILITY_PROFILES, fixture);
  for (const [profileId, profile] of Object.entries(fixture.profiles)) {
    assert.equal(displayName(profileId), profile.display_name);
  }
});

test("profile descriptors match canonical profile metadata", () => {
  const descriptors = profileDescriptors();
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.canonicalName),
    Object.keys(fixture.profiles),
  );
  for (const descriptor of descriptors) {
    const profile = fixture.profiles[descriptor.canonicalName];
    assert.equal(descriptor.displayName, profile.display_name);
    assert.equal(descriptor.connectable, profile.role !== "base");
    assert.equal(descriptor.baseProfile, profile.base_profile || null);
  }
});

test("Node-RED editor shows display_name labels and keeps canonical PLC profile values", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "nodes", "slmp-connection.html"), "utf8");
  assert.match(html, /getJSON\("plc-comm\/slmp\/profiles"/);
  assert.match(html, /\.filter\(function \(profile\) \{ return profile\.connectable; \}\)/);
  assert.match(html, /\.val\(profile\.canonicalName\)/);
  assert.match(html, /\.text\(profile\.displayName\)/);
});

test("blocked profile features fail before transport with a dedicated error", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv" });
  let calls = 0;
  client._request = async () => {
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
      /profile and feature combination/.test(error.message)
  );
  assert.equal(calls, 0);
});

test("the maintainer-only boolean profile bypass sends blocked high-level requests", async () => {
  assert.equal(Object.prototype.hasOwnProperty.call(publicApi, "normalizeStrictProfile"), false);
  for (const value of [true, false, "true", "false", "0", "off", 0, null, "", "unknown", {}, []]) {
    assert.throws(
      () => new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv", strictProfile: value }),
      /no longer a public option/,
    );
    assert.throws(
      () => new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv", strict_profile: value }),
      /no longer a public option/,
    );
  }
  for (const value of ["false", "0", "off", 0, null, "", "unknown", {}, []]) {
    assert.throws(
      () => new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv", _maintainerStrictProfile: value }),
      /must be a boolean/,
    );
  }
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:qnudv", _maintainerStrictProfile: false });
  const calls = [];
  client._request = async (command, subcommand, data) => {
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
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.from([0x34, 0x12]) };
  };

  await client.readDevices("D100", 1);
  ensureProfileFeatureAllowed("melsec:iq-f", "ext_module_access");
  ensureProfileFeatureAllowed("melsec:lcpu", "long_device_path");

  assert.equal(calls, 1);
});

test("public profile guard cannot be disabled with an extra argument", () => {
  assert.throws(
    () => ensureProfileFeatureAllowed("melsec:iq-f", "ext_link_direct"),
    (error) =>
      error instanceof SlmpProfileFeatureError &&
      error.profileId === "melsec:iq-f" &&
      error.featureKey === "ext_link_direct" &&
      error.state === "blocked"
  );
  assert.throws(
    () => ensureProfileFeatureAllowed("melsec:iq-f", "ext_link_direct", false),
    (error) => error instanceof SlmpProfileFeatureError,
  );
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

  await client._request(Command.DEVICE_READ_BLOCK, 0x0000, Buffer.alloc(0));

  assert.equal(calls, 1);
});

test("profile point limits are enforced independently of strictProfile", async () => {
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r", _maintainerStrictProfile: false });
  let calls = 0;
  client._request = async () => {
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

  const iql = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-l", _maintainerStrictProfile: false });
  iql._request = async () => {
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

  const iqf = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-f", _maintainerStrictProfile: false });
  iqf._request = async () => {
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
  const client = new SlmpClient({ host: "127.0.0.1", plcProfile: "melsec:iq-r", _maintainerStrictProfile: false });
  let calls = 0;
  client._request = async () => {
    calls += 1;
    return { endCode: 0, data: Buffer.alloc(0) };
  };

  await assert.rejects(
    () => client.writeDevices("S0", [true], { bitUnit: true }),
    (error) => error instanceof ValueError && /S is read-only for plcProfile 'melsec:iq-r'/.test(error.message)
  );
  assert.equal(calls, 0);
});
