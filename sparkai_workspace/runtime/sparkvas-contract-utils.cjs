"use strict";

const { createHash } = require("node:crypto");

const RESOURCE_KINDS = Object.freeze(["skill", "tool", "recipe"]);
const PORT_DATA_TYPES = Object.freeze(["asset", "image", "video", "text", "brief", "review", "bundle", "any"]);
const RESOURCE_COMPONENT = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SLOT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STEP_ID = /^step\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EDGE_ID = /^edge\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PORT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RUN_ID = /^run\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/;
const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,179}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|credential|entry[_-]?id|fmem[_-]?id|private[_-]?key|token)$/i;
const ABSOLUTE_PATH = /(?:^|[\s"'`(=])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)|(?:^|[\s"'`(=])\/(?:Users|home|root|var|tmp|etc|opt|private|Volumes|mnt|srv)\//;
const POSIX_ROOT = /^\s*\/\s*$/;
const POSIX_ABSOLUTE_PATH = /(?:^|[\s"'`(=])\/(?!v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?\/?(?=$|[\s#?"'`(),;:!?，。；：！？]|\.(?=$|[\s"'`(),;:!?，。；：！？])))[^\s"'`()]+/;
const SIGNED_URL = /(?:[?&](?:X-Amz-Signature|X-Goog-Signature|sig|signature|token|access_token)=)|file:(?:\/|[A-Za-z]:[\\/])/i;

const isObject = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isFiniteNumber = value => typeof value === "number" && Number.isFinite(value);

function text(value, maximum) {
  return typeof value === "string" && value.trim() && value.length <= maximum && !value.includes("\0")
    ? value.trim() : "";
}

function optionalText(value, maximum) {
  if (value === undefined) return "";
  return text(value, maximum);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => [key, canonicalJson(value[key])]));
}

function digestCanonical(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex")}`;
}

function contentHashFor(value) {
  const material = { ...value };
  delete material.contentHash;
  return digestCanonical(material);
}

function parseResourceId(kind, value) {
  if (!RESOURCE_KINDS.includes(kind) || typeof value !== "string") return undefined;
  const prefix = `${kind}.`;
  if (!value.startsWith(prefix) || value.length > 86) return undefined;
  const parts = value.slice(prefix.length).split(".");
  if (parts.length !== 2 || !RESOURCE_COMPONENT.test(parts[0]) || !RESOURCE_COMPONENT.test(parts[1])) return undefined;
  return { kind, id: value, publisher: parts[0], slug: parts[1] };
}

const isResourceId = (kind, value) => Boolean(parseResourceId(kind, value));
function isSemver(value) {
  if (typeof value !== "string" || !SEMVER.test(value)) return false;
  const prerelease = value.split("+", 1)[0].split("-").slice(1).join("-");
  return !prerelease || prerelease.split(".").every(part => !/^\d+$/.test(part) || part === "0" || !part.startsWith("0"));
}
const isHash = value => typeof value === "string" && CONTENT_HASH.test(value);
const isSlotId = value => typeof value === "string" && value.length <= 64 && SLOT_ID.test(value);
const isStepId = value => typeof value === "string" && value.length <= 68 && STEP_ID.test(value);
const isEdgeId = value => typeof value === "string" && value.length <= 68 && EDGE_ID.test(value);
const isPortId = value => typeof value === "string" && value.length <= 40 && PORT_ID.test(value);
const isRunId = value => typeof value === "string" && RUN_ID.test(value);
const isPublicId = value => typeof value === "string" && PUBLIC_ID.test(value);

function isIsoTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
}

function hasUnsafePublicString(value) {
  return typeof value === "string" && (POSIX_ROOT.test(value) || ABSOLUTE_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value) || SIGNED_URL.test(value));
}

function addError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function normalizePublicJson(value, path, errors, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!isFiniteNumber(value)) {
      addError(errors, path, "PUBLIC_JSON_NUMBER_INVALID", "Public JSON numbers must be finite.");
      return undefined;
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4_000) {
      addError(errors, path, "PUBLIC_JSON_STRING_TOO_LONG", "Public JSON strings are limited to 4000 characters.");
      return undefined;
    }
    if (hasUnsafePublicString(value)) {
      addError(errors, path, "PUBLIC_JSON_SENSITIVE_VALUE", "Public JSON must not contain absolute paths, file URLs or signed URLs.");
      return undefined;
    }
    return value;
  }
  if (depth >= 6) {
    addError(errors, path, "PUBLIC_JSON_DEPTH", "Public JSON nesting is limited to six levels.");
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) {
      addError(errors, path, "PUBLIC_JSON_ITEMS", "Public JSON arrays are limited to 64 items.");
      return undefined;
    }
    const before = errors.length;
    const items = value.map((item, index) => normalizePublicJson(item, `${path}[${index}]`, errors, depth + 1));
    return errors.length > before ? undefined : items;
  }
  if (!isObject(value)) {
    addError(errors, path, "PUBLIC_JSON_TYPE", "Public JSON must contain only objects, arrays and scalar values.");
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length > 64) {
    addError(errors, path, "PUBLIC_JSON_KEYS", "Public JSON objects are limited to 64 keys.");
    return undefined;
  }
  const before = errors.length;
  const normalized = {};
  for (const key of keys) {
    if (SENSITIVE_KEY.test(key)) {
      addError(errors, `${path}.${key}`, "PUBLIC_JSON_SENSITIVE_KEY", "Public JSON must not contain credentials or internal entry IDs.");
      continue;
    }
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      addError(errors, `${path}.${key}`, "PUBLIC_JSON_KEY_INVALID", "Public JSON keys must be stable identifiers.");
      continue;
    }
    normalized[key] = normalizePublicJson(value[key], `${path}.${key}`, errors, depth + 1);
  }
  return errors.length > before ? undefined : normalized;
}

function validationResult(errors, value) {
  return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : undefined };
}

module.exports = {
  RESOURCE_KINDS,
  PORT_DATA_TYPES,
  isObject,
  isFiniteNumber,
  text,
  optionalText,
  canonicalJson,
  digestCanonical,
  contentHashFor,
  parseResourceId,
  isResourceId,
  isSemver,
  isHash,
  isSlotId,
  isStepId,
  isEdgeId,
  isPortId,
  isRunId,
  isPublicId,
  isIsoTimestamp,
  hasUnsafePublicString,
  addError,
  normalizePublicJson,
  validationResult,
};
