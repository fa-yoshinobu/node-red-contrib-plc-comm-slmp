"use strict";

const capabilityDocument = require("./capability/slmp_ethernet_profiles.json");
const { normalizePlcProfile, ValueError } = require("./core");
const { ensureProfileFeatureAllowedInternal } = require("./profile-guard-internal");

const SlmpProfileLimitKey = Object.freeze({
  DirectWordRead: "direct_word_read",
  DirectWordWrite: "direct_word_write",
  DirectBitRead: "direct_bit_read",
  DirectBitWrite: "direct_bit_write",
  RandomReadWord: "random_read_word",
  RandomWriteWord: "random_write_word",
  RandomWriteBit: "random_write_bit",
  MonitorRegisterWord: "monitor_register_word",
  RandomReadWordExt: "random_read_word_ext",
  RandomWriteWordExt: "random_write_word_ext",
  RandomWriteBitExt: "random_write_bit_ext",
  MonitorRegisterWordExt: "monitor_register_word_ext",
});

function getCapabilityProfile(plcProfile) {
  const normalized = normalizePlcProfile(plcProfile);
  if (!normalized) {
    return null;
  }
  return capabilityDocument.profiles[normalized] || null;
}

function plcProfileDisplayName(plcProfile) {
  const profile = getCapabilityProfile(plcProfile);
  if (!profile) {
    throw new ValueError("plcProfile is required.");
  }
  return profile.display_name;
}

/** @deprecated Use plcProfileDisplayName. */
function displayName(plcProfile) {
  return plcProfileDisplayName(plcProfile);
}

function profileDescriptors() {
  return Object.keys(capabilityDocument.profiles).map((canonicalName) => {
    const profile = capabilityDocument.profiles[canonicalName];
    return Object.freeze({
      canonicalName,
      displayName: profile.display_name,
      connectable: profile.role !== "base",
      baseProfile: profile.base_profile || null,
    });
  });
}

function getProfileLimit(plcProfile, limitKey) {
  const profile = getCapabilityProfile(plcProfile);
  if (!profile) {
    return null;
  }
  const limit = profile.limits && profile.limits[limitKey] ? profile.limits[limitKey] : null;
  if (!limit) {
    return null;
  }
  return Object.freeze({
    maxPoints: limit.max,
    weightedMaxPoints: Number.isInteger(limit.weighted_max) ? limit.weighted_max : null,
  });
}

function isProfileReadOnlyDevice(plcProfile, code) {
  const profile = getCapabilityProfile(plcProfile);
  if (!profile || !profile.write_policy) {
    return false;
  }
  return profile.write_policy[String(code || "").toUpperCase()] === "read-only";
}

function ensureProfileFeatureAllowed(plcProfile, featureKey) {
  return ensureProfileFeatureAllowedInternal(plcProfile, featureKey, true);
}

module.exports = {
  BUILTIN_CAPABILITY_PROFILES: capabilityDocument,
  SlmpProfileLimitKey,
  displayName,
  ensureProfileFeatureAllowed,
  getCapabilityProfile,
  getProfileLimit,
  isProfileReadOnlyDevice,
  plcProfileDisplayName,
  profileDescriptors,
};
