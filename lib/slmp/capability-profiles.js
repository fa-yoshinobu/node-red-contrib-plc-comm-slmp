"use strict";

const capabilityDocument = require("./capability/slmp_ethernet_profiles.json");
const { normalizePlcProfile } = require("./core");
const { SlmpProfileFeatureError, ValueError } = require("./errors");

const GUARDED_STATES = new Set(["blocked", "unverified"]);
const DISABLE_HINT = "Set strictProfile=false to send the request anyway.";
const PROFILE_DESCRIPTOR_IDS = Object.freeze([
  "melsec:iq-f",
  "melsec:iq-r",
  "melsec:iq-r:rj71en71",
  "melsec:iq-l",
  "melsec:mx-f",
  "melsec:mx-r",
  "melsec:qcpu",
  "melsec:qcpu:qj71e71-100",
  "melsec:lcpu",
  "melsec:lcpu:lj71e71-100",
  "melsec:qnu",
  "melsec:qnu:qj71e71-100",
  "melsec:qnudv",
  "melsec:qnudv:qj71e71-100",
]);

function normalizeStrictProfile(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !(normalized === "false" || normalized === "0" || normalized === "off");
  }
  return value !== false;
}

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
  return PROFILE_DESCRIPTOR_IDS.map((canonicalName) => {
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

function ensureProfileFeatureAllowed(plcProfile, featureKey, strictProfile) {
  const feature = getProfileFeature(plcProfile, featureKey);
  if (!feature || !GUARDED_STATES.has(feature.state) || !normalizeStrictProfile(strictProfile)) {
    return;
  }
  const profileId = normalizePlcProfile(plcProfile);
  throw new SlmpProfileFeatureError({
    profileId,
    featureKey,
    state: feature.state,
    evidence: feature.evidence || feature.note,
    disableHint: DISABLE_HINT,
  });
}

module.exports = {
  BUILTIN_CAPABILITY_PROFILES: capabilityDocument,
  displayName,
  ensureProfileFeatureAllowed,
  getCapabilityProfile,
  getProfileFeature,
  getProfileLimit,
  isProfileReadOnlyDevice,
  normalizeStrictProfile,
  profileDescriptors,
};
