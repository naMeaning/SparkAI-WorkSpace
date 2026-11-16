"use strict";

const {
  PORT_DATA_TYPES,
  isObject,
  text,
  optionalText,
  contentHashFor,
  parseResourceId,
  isSemver,
  isHash,
  isPortId,
  hasUnsafePublicString,
  addError,
  validationResult,
} = require("./sparkvas-contract-utils.cjs");

const TOOL_SCHEMA_VERSION = 1;
const TOOL_LIMITS = Object.freeze({
  maxDescription: 2_000,
  maxInputPorts: 16,
  maxOutputPorts: 16,
  maxLimitations: 24,
  maxTags: 16,
});
const TOOL_DISTRIBUTIONS = Object.freeze(["builtin", "controlled-adapter"]);
const TOOL_ADAPTERS = Object.freeze([
  "image-generation", "video-generation", "comfyui", "scientific-runner", "mcp", "language-model",
]);
const TOOL_PERMISSION_SCOPES = Object.freeze({
  network: Object.freeze(["none", "loopback", "lan", "public"]),
  filesystem: Object.freeze(["none", "project-read", "project-write", "managed-read", "managed-write"]),
  process: Object.freeze(["none", "managed-runner"]),
  models: Object.freeze(["none", "image-generation", "video-generation", "language-model"]),
  mcp: Object.freeze(["none", "approved-servers"]),
});

const TOOL_FIELDS = new Set([
  "schemaVersion", "id", "name", "description", "version", "minAppVersion", "license",
  "distribution", "adapter", "inputSlots", "outputSlots", "permissions", "limitations", "tags", "contentHash",
]);
const INPUT_PORT_FIELDS = new Set(["portId", "label", "dataType", "required"]);
const OUTPUT_PORT_FIELDS = new Set(["portId", "label", "dataType"]);
const PERMISSION_FIELDS = new Set(Object.keys(TOOL_PERMISSION_SCOPES));

function rejectUnknownFields(value, allowed, path, errors, prefix) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, `${prefix}_FIELD_UNKNOWN`, `Unknown ${prefix.toLowerCase()} field: ${key}.`);
  }
}

function publicText(value, maximum, path, errors, required = true) {
  const normalized = required ? text(value, maximum) : optionalText(value, maximum);
  if (required && !normalized) {
    addError(errors, path, "TOOL_TEXT_INVALID", `Tool text must be non-empty and at most ${maximum} characters.`);
    return "";
  }
  if (normalized && hasUnsafePublicString(normalized)) {
    addError(errors, path, "TOOL_PUBLIC_VALUE_UNSAFE", "Tool manifests must not contain absolute paths, file URLs or signed URLs.");
    return "";
  }
  return normalized;
}

function normalizeInputPort(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "TOOL_INPUT_PORT_INVALID", "Tool input ports must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, INPUT_PORT_FIELDS, path, errors, "TOOL");
  if (!isPortId(value.portId)) addError(errors, `${path}.portId`, "TOOL_PORT_ID_INVALID", "Port IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PORT_DATA_TYPES.includes(value.dataType)) addError(errors, `${path}.dataType`, "TOOL_PORT_TYPE_INVALID", "Unsupported tool port data type.");
  const required = value.required === undefined ? true : value.required;
  if (typeof required !== "boolean") addError(errors, `${path}.required`, "TOOL_PORT_REQUIRED_INVALID", "Input port required must be boolean.");
  return isPortId(value.portId) && label && PORT_DATA_TYPES.includes(value.dataType) && typeof required === "boolean"
    ? { portId: value.portId, label, dataType: value.dataType, required } : undefined;
}

function normalizeOutputPort(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "TOOL_OUTPUT_PORT_INVALID", "Tool output ports must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, OUTPUT_PORT_FIELDS, path, errors, "TOOL");
  if (!isPortId(value.portId)) addError(errors, `${path}.portId`, "TOOL_PORT_ID_INVALID", "Port IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PORT_DATA_TYPES.includes(value.dataType)) addError(errors, `${path}.dataType`, "TOOL_PORT_TYPE_INVALID", "Unsupported tool port data type.");
  return isPortId(value.portId) && label && PORT_DATA_TYPES.includes(value.dataType)
    ? { portId: value.portId, label, dataType: value.dataType } : undefined;
}

function parseToolPermissions(value) {
  const errors = [];
  if (!isObject(value)) {
    addError(errors, "$.permissions", "TOOL_PERMISSIONS_INVALID", "Tool permissions must be an object.");
    return validationResult(errors, undefined);
  }
  for (const key of Object.keys(value)) {
    if (!PERMISSION_FIELDS.has(key)) {
      addError(errors, `$.permissions.${key}`, "TOOL_PERMISSION_UNKNOWN", `Unknown tool permission scope: ${key}.`);
    }
  }
  const normalized = {};
  for (const [scope, allowed] of Object.entries(TOOL_PERMISSION_SCOPES)) {
    const current = value[scope];
    if (!Array.isArray(current) || current.length < 1 || current.length > 8) {
      addError(errors, `$.permissions.${scope}`, "TOOL_PERMISSION_SCOPE_INVALID", `Permission ${scope} requires an array of 1-8 scope values.`);
      continue;
    }
    const values = current.filter(item => typeof item === "string");
    if (values.length !== current.length || values.some(item => !allowed.includes(item))) {
      addError(errors, `$.permissions.${scope}`, "TOOL_PERMISSION_VALUE_INVALID", `Permission ${scope} contains an unsupported scope.`);
      continue;
    }
    if (new Set(values).size !== values.length) {
      addError(errors, `$.permissions.${scope}`, "TOOL_PERMISSION_DUPLICATE", `Permission ${scope} scopes must be unique.`);
      continue;
    }
    if (values.includes("none") && values.length !== 1) {
      addError(errors, `$.permissions.${scope}`, "TOOL_PERMISSION_NONE_MIXED", "Permission 'none' cannot be combined with other scopes.");
      continue;
    }
    normalized[scope] = values.includes("none") ? ["none"] : [...values].sort();
  }
  return errors.length ? validationResult(errors, undefined) : validationResult(errors, normalized);
}

function uniqueTextList(value, maximumItems, maximumCharacters, path, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    addError(errors, path, "TOOL_LIST_INVALID", `List must contain at most ${maximumItems} strings.`);
    return [];
  }
  const items = value.map((item, index) => publicText(item, maximumCharacters, `${path}[${index}]`, errors));
  if (new Set(items).size !== items.length) addError(errors, path, "TOOL_LIST_DUPLICATE", "List values must be unique.");
  return items.every(Boolean) ? items : [];
}

function normalizeToolMaterial(value, errors) {
  if (!isObject(value)) {
    addError(errors, "$", "TOOL_MANIFEST_OBJECT", "Tool manifest must be an object.");
    return undefined;
  }
  rejectUnknownFields(value, TOOL_FIELDS, "$", errors, "TOOL");
  if (value.schemaVersion !== TOOL_SCHEMA_VERSION) {
    addError(errors, "$.schemaVersion", "TOOL_SCHEMA_VERSION", "Tool manifest schemaVersion must be 1.");
  }
  if (!parseResourceId("tool", value.id)) {
    addError(errors, "$.id", "TOOL_ID_INVALID", "Tool ID must match tool.<publisher>.<slug>.");
  }
  const name = publicText(value.name, 120, "$.name", errors);
  const description = publicText(value.description, TOOL_LIMITS.maxDescription, "$.description", errors);
  if (!isSemver(value.version)) addError(errors, "$.version", "TOOL_VERSION_INVALID", "Tool version must be exact SemVer.");
  if (!isSemver(value.minAppVersion)) addError(errors, "$.minAppVersion", "TOOL_MIN_APP_VERSION_INVALID", "minAppVersion must be exact SemVer.");
  const license = publicText(value.license, 80, "$.license", errors);
  if (!TOOL_DISTRIBUTIONS.includes(value.distribution)) {
    addError(errors, "$.distribution", "TOOL_DISTRIBUTION_INVALID", "Tools may only be builtin or controlled-adapter in v1; third-party executables are rejected.");
  }
  if (!TOOL_ADAPTERS.includes(value.adapter)) {
    addError(errors, "$.adapter", "TOOL_ADAPTER_INVALID", `Unsupported controlled adapter: ${String(value.adapter)}.`);
  }

  if (!Array.isArray(value.inputSlots) || value.inputSlots.length < 1 || value.inputSlots.length > TOOL_LIMITS.maxInputPorts) {
    addError(errors, "$.inputSlots", "TOOL_INPUT_PORTS_INVALID", "Tool requires 1-16 input ports.");
  }
  const inputSlots = (Array.isArray(value.inputSlots) ? value.inputSlots : [])
    .slice(0, TOOL_LIMITS.maxInputPorts)
    .map((port, index) => normalizeInputPort(port, `$.inputSlots[${index}]`, errors))
    .filter(Boolean);
  if (!Array.isArray(value.outputSlots) || value.outputSlots.length < 1 || value.outputSlots.length > TOOL_LIMITS.maxOutputPorts) {
    addError(errors, "$.outputSlots", "TOOL_OUTPUT_PORTS_INVALID", "Tool requires 1-16 output ports.");
  }
  const outputSlots = (Array.isArray(value.outputSlots) ? value.outputSlots : [])
    .slice(0, TOOL_LIMITS.maxOutputPorts)
    .map((port, index) => normalizeOutputPort(port, `$.outputSlots[${index}]`, errors))
    .filter(Boolean);
  const portIds = [...inputSlots, ...outputSlots].map(port => port.portId);
  if (new Set(portIds).size !== portIds.length) addError(errors, "$.inputSlots", "TOOL_PORT_DUPLICATE", "Tool port IDs must be unique across inputs and outputs.");

  const permissionsResult = parseToolPermissions(value.permissions);
  errors.push(...permissionsResult.errors);
  const limitations = uniqueTextList(value.limitations, TOOL_LIMITS.maxLimitations, 500, "$.limitations", errors);
  const tags = uniqueTextList(value.tags, TOOL_LIMITS.maxTags, 40, "$.tags", errors);

  if (errors.length) return undefined;
  return {
    schemaVersion: TOOL_SCHEMA_VERSION,
    id: value.id,
    name,
    description,
    version: value.version,
    minAppVersion: value.minAppVersion,
    license,
    distribution: value.distribution,
    adapter: value.adapter,
    inputSlots,
    outputSlots,
    permissions: permissionsResult.value,
    limitations,
    tags,
  };
}

function parseToolManifest(value) {
  const errors = [];
  const material = normalizeToolMaterial(value, errors);
  if (!material) return validationResult(errors, undefined);
  if (!isHash(value.contentHash)) {
    addError(errors, "$.contentHash", "TOOL_HASH_INVALID", "Tool contentHash must be sha256:<64 lowercase hex>.");
    return validationResult(errors, undefined);
  }
  const expected = contentHashFor(material);
  if (value.contentHash !== expected) {
    addError(errors, "$.contentHash", "TOOL_HASH_MISMATCH", "Tool contentHash does not match the canonical manifest.");
    return validationResult(errors, undefined);
  }
  return validationResult(errors, { ...material, contentHash: expected });
}

function toolContentHash(value) {
  const errors = [];
  const material = normalizeToolMaterial(value, errors);
  return material ? contentHashFor(material) : "";
}

function sealToolManifest(value) {
  const errors = [];
  const material = normalizeToolMaterial(value, errors);
  return material ? { ...material, contentHash: contentHashFor(material) } : undefined;
}

const normalizeToolManifest = value => parseToolManifest(value).value;

module.exports = {
  TOOL_SCHEMA_VERSION,
  TOOL_LIMITS,
  TOOL_DISTRIBUTIONS,
  TOOL_ADAPTERS,
  TOOL_PERMISSION_SCOPES,
  parseToolPermissions,
  parseToolManifest,
  normalizeToolManifest,
  toolContentHash,
  sealToolManifest,
};
