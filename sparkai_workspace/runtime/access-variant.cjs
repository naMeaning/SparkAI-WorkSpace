"use strict";

const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

const ACCESS_POLICY_FILENAME = "sparkai-access-policy.json";
const ACCESS_VARIANT_DUAL = "dual-access";
const ACCESS_VARIANT_SPARKAPI = "sparkapi-account";
const OFFICIAL_SPARKAPI_BASE_URL = "https://sparkapi.org";
const WINDOWS_INSTALLER_ARCH = "x64";
const WINDOWS_INSTALLER_BRAND_STEM = "SparkAI-WorkSpace";

function normalizeAccessVariant(value, fallback = ACCESS_VARIANT_DUAL) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["sparkapi", "sparkapi-account", "account", "account-only", "managed", "locked", "1", "true", "on"].includes(normalized)) {
    return ACCESS_VARIANT_SPARKAPI;
  }
  if (["dual", "dual-access", "unrestricted", "custom", "0", "false", "off"].includes(normalized)) {
    return ACCESS_VARIANT_DUAL;
  }
  return fallback;
}

function artifactSegment(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[0-9A-Za-z._+-]+$/.test(normalized)) {
    throw new Error(`Invalid Windows installer ${label}: ${normalized || "<empty>"}`);
  }
  return normalized;
}

function windowsInstallerArtifactName(version, variant = ACCESS_VARIANT_DUAL, arch = WINDOWS_INSTALLER_ARCH) {
  const normalizedVariant = normalizeAccessVariant(variant, "");
  if (!normalizedVariant) throw new Error(`Unsupported Windows installer access variant: ${variant}`);
  const variantLabel = normalizedVariant === ACCESS_VARIANT_SPARKAPI ? "SparkAPI" : "Unrestricted";
  return `${WINDOWS_INSTALLER_BRAND_STEM}-${variantLabel}-Setup-${artifactSegment(version, "version")}-${artifactSegment(arch, "architecture")}.exe`;
}

function windowsCoreInstallerArtifactName(version, arch = WINDOWS_INSTALLER_ARCH) {
  return `naimage-Core-${artifactSegment(version, "version")}-${artifactSegment(arch, "architecture")}.exe`;
}

function windowsLegacyInstallerArtifactName(version, arch = WINDOWS_INSTALLER_ARCH) {
  return `naimage-Setup-${artifactSegment(version, "version")}-${artifactSegment(arch, "architecture")}.exe`;
}

function accessPolicyForVariant(value) {
  const variant = normalizeAccessVariant(value);
  const sparkApiOnly = variant === ACCESS_VARIANT_SPARKAPI;
  return Object.freeze({
    schemaVersion: 1,
    variant,
    customApiAccess: !sparkApiOnly,
    accountBaseUrlLocked: sparkApiOnly,
    officialAccountBaseUrl: OFFICIAL_SPARKAPI_BASE_URL
  });
}

function buildAccessPolicy(environment = process.env) {
  const explicitVariant = String(environment?.SPARKAI_ACCESS_VARIANT || "").trim();
  if (explicitVariant) {
    const variant = normalizeAccessVariant(explicitVariant, "");
    if (!variant) throw new Error(`Unsupported SPARKAI_ACCESS_VARIANT: ${explicitVariant}`);
    return accessPolicyForVariant(variant);
  }
  const accountOnlySwitch = String(environment?.SPARKAI_ACCOUNT_ONLY || "").trim();
  if (!accountOnlySwitch) return accessPolicyForVariant(ACCESS_VARIANT_DUAL);
  const variant = normalizeAccessVariant(accountOnlySwitch, "");
  if (!variant) throw new Error(`Unsupported SPARKAI_ACCOUNT_ONLY value: ${accountOnlySwitch}`);
  return accessPolicyForVariant(variant);
}

function parseAccessPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.schemaVersion) !== 1) return null;
  const variant = normalizeAccessVariant(value.variant, "");
  if (!variant) return null;
  const expected = accessPolicyForVariant(variant);
  if (
    value.customApiAccess !== expected.customApiAccess
    || value.accountBaseUrlLocked !== expected.accountBaseUrlLocked
    || String(value.officialAccountBaseUrl || "").replace(/\/+$/, "") !== OFFICIAL_SPARKAPI_BASE_URL
  ) return null;
  return expected;
}

function loadDesktopAccessPolicy(options = {}) {
  const projectRoot = path.resolve(String(options.projectRoot || "."));
  const manifestPath = path.join(projectRoot, "dist", ACCESS_POLICY_FILENAME);
  if (options.preferManifest !== false && existsSync(manifestPath)) {
    try {
      const parsed = parseAccessPolicy(JSON.parse(readFileSync(manifestPath, "utf8")));
      if (parsed) return parsed;
    } catch {
      // A packaged policy must fail closed below. Development may still use
      // its explicit environment switch when no valid build output exists.
    }
  }
  if (options.manifestRequired === true) return accessPolicyForVariant(ACCESS_VARIANT_SPARKAPI);
  return buildAccessPolicy(options.environment || process.env);
}

function applyAccessPolicyToSettings(settings, policy) {
  const source = settings && typeof settings === "object" ? settings : {};
  if (policy?.accountBaseUrlLocked !== true) return source;
  const officialBaseUrl = String(policy.officialAccountBaseUrl || OFFICIAL_SPARKAPI_BASE_URL).replace(/\/+$/, "");
  const accountChanged = String(source.accountBaseUrl || "").replace(/\/+$/, "").toLowerCase() !== officialBaseUrl.toLowerCase();
  const next = {
    ...source,
    accessMode: "account",
    accountBaseUrl: officialBaseUrl,
    relayBaseUrl: "",
    updateBaseUrl: officialBaseUrl
  };
  if (accountChanged) {
    next.serverToken = "";
    next.serverAuthProtocol = "";
    next.serverAccessToken = "";
    next.serverAccessExpiresAt = 0;
    next.serverSessionCookie = "";
    next.serverAuthSessionId = "";
    next.serverUserId = "";
    next.selectedAccountTokenId = "";
    next.selectedAccountTokenName = "";
    next.selectedAccountTokenGroup = "";
  }
  return next;
}

module.exports = {
  ACCESS_POLICY_FILENAME,
  ACCESS_VARIANT_DUAL,
  ACCESS_VARIANT_SPARKAPI,
  OFFICIAL_SPARKAPI_BASE_URL,
  WINDOWS_INSTALLER_ARCH,
  WINDOWS_INSTALLER_BRAND_STEM,
  accessPolicyForVariant,
  applyAccessPolicyToSettings,
  buildAccessPolicy,
  loadDesktopAccessPolicy,
  normalizeAccessVariant,
  parseAccessPolicy,
  windowsCoreInstallerArtifactName,
  windowsInstallerArtifactName,
  windowsLegacyInstallerArtifactName
};
