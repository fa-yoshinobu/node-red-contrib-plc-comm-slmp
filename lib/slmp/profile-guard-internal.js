"use strict";

const capabilityDocument = require("./capability/slmp_ethernet_profiles.json");
const { normalizePlcProfile } = require("./core");
const { SlmpProfileFeatureError, ValueError } = require("./errors");

const GUARDED_STATES = new Set(["blocked", "unverified"]);
const DISABLE_HINT = "Use a profile and feature combination whose capability state permits this request.";

function ensureProfileFeatureAllowedInternal(plcProfile, featureKey, strictProfile) {
  if (typeof strictProfile !== "boolean") {
    throw new ValueError("internal strictProfile state must be a boolean");
  }
  const profileId = normalizePlcProfile(plcProfile);
  const profile = profileId ? capabilityDocument.profiles[profileId] : null;
  const feature = profile && profile.features ? profile.features[featureKey] : null;
  if (!feature || !GUARDED_STATES.has(feature.state) || !strictProfile) {
    return;
  }
  throw new SlmpProfileFeatureError({
    profileId,
    featureKey,
    state: feature.state,
    evidence: feature.evidence || feature.note,
    disableHint: DISABLE_HINT,
  });
}

module.exports = { ensureProfileFeatureAllowedInternal };
