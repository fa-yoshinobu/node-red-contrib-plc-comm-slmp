"use strict";

const capabilityDocument = require("./capability/slmp_ethernet_profiles.json");
const { normalizePlcProfile } = require("./core");
const { ValueError } = require("./errors");
const { ensureProfileFeatureAllowedInternal } = require("./profile-guard-internal");

function getCapabilityProfile(plcProfile) {
  const normalized = normalizePlcProfile(plcProfile);
  if (!normalized) {
    return null;
  }
  return capabilityDocument.profiles[normalized] || null;
}

function displayName(plcProfile) {
  const profile = getCapabilityProfile(plcProfile);
  if (!profile) {
    throw new ValueError("plcProfile is required.");
  }
  return profile.display_name;
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

function getProfileFeature(plcProfile, featureKey) {
  const profile = getCapabilityProfile(plcProfile);
  if (!profile) {
    return null;
  }
  return profile.features && profile.features[featureKey] ? profile.features[featureKey] : null;
}

function getProfileLimit(plcProfile, limitKey) {
  const profile = getCapabilityProfile(plcProfile);
  if (!profile) {
    return null;
  }
  return profile.limits && profile.limits[limitKey] ? profile.limits[limitKey] : null;
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
  displayName,
  ensureProfileFeatureAllowed,
  getCapabilityProfile,
  getProfileFeature,
  getProfileLimit,
  isProfileReadOnlyDevice,
  profileDescriptors,
};
