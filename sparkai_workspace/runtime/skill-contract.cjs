"use strict";

const {
  PORT_DATA_TYPES,
  isObject,
  isFiniteNumber,
  text,
  optionalText,
  contentHashFor,
  parseResourceId,
  isSemver,
  isHash,
  isSlotId,
  isPortId,
  hasUnsafePublicString,
  addError,
  validationResult,
} = require("./sparkvas-contract-utils.cjs");

const SKILL_SCHEMA_VERSION = 1;
const SKILL_LIMITS = Object.freeze({
  maxDescription: 2_000,
  maxInstructions: 24_000,
  maxInputSlots: 16,
  maxParameters: 32,
  maxExamples: 12,
  maxLimitations: 24,
  maxTags: 16,
});

const SKILL_FIELDS = new Set([
  "schemaVersion", "id", "name", "description", "version", "minAppVersion", "license",
  "instructions", "inputSlots", "parameters", "examples", "limitations", "tags", "contentHash",
]);
const SLOT_FIELDS = new Set(["slotId", "label", "dataType", "required"]);
const PARAMETER_FIELDS = new Set(["parameterId", "label", "type", "required", "defaultValue", "values"]);
const EXAMPLE_FIELDS = new Set(["title", "description"]);
const PARAMETER_TYPES = Object.freeze(["string", "number", "boolean", "enum"]);

function rejectUnknownFields(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, "SKILL_FIELD_UNKNOWN", `Unknown Skill field: ${key}.`);
  }
}

function publicText(value, maximum, path, errors, required = true) {
  const normalized = required ? text(value, maximum) : optionalText(value, maximum);
  if (required && !normalized) {
    addError(errors, path, "SKILL_TEXT_INVALID", `Skill text must be non-empty and at most ${maximum} characters.`);
    return "";
  }
  if (normalized && hasUnsafePublicString(normalized)) {
    addError(errors, path, "SKILL_PUBLIC_VALUE_UNSAFE", "Skill manifests must not contain absolute paths, file URLs or signed URLs.");
    return "";
  }
  return normalized;
}

function normalizeInputSlot(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "SKILL_SLOT_INVALID", "Skill input slots must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, SLOT_FIELDS, path, errors);
  if (!isSlotId(value.slotId)) addError(errors, `${path}.slotId`, "SKILL_SLOT_ID_INVALID", "Slot IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PORT_DATA_TYPES.includes(value.dataType)) {
    addError(errors, `${path}.dataType`, "SKILL_SLOT_TYPE_INVALID", `Unsupported Skill port data type: ${String(value.dataType)}.`);
  }
  const required = value.required === undefined ? true : value.required;
  if (typeof required !== "boolean") addError(errors, `${path}.required`, "SKILL_SLOT_REQUIRED_INVALID", "Slot required must be boolean.");
  return isSlotId(value.slotId) && label && PORT_DATA_TYPES.includes(value.dataType) && typeof required === "boolean"
    ? { slotId: value.slotId, label, dataType: value.dataType, required } : undefined;
}

function normalizeParameter(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "SKILL_PARAMETER_INVALID", "Skill parameters must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, PARAMETER_FIELDS, path, errors);
  if (!isPortId(value.parameterId)) addError(errors, `${path}.parameterId`, "SKILL_PARAMETER_ID_INVALID", "Parameter IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PARAMETER_TYPES.includes(value.type)) {
    addError(errors, `${path}.type`, "SKILL_PARAMETER_TYPE_INVALID", `Unsupported Skill parameter type: ${String(value.type)}.`);
  }
  const required = value.required === undefined ? false : value.required;
  if (typeof required !== "boolean") addError(errors, `${path}.required`, "SKILL_PARAMETER_REQUIRED_INVALID", "Parameter required must be boolean.");

  let values;
  if (value.type === "enum") {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 32) {
      addError(errors, `${path}.values`, "SKILL_PARAMETER_VALUES_INVALID", "Enum parameters require 1-32 values.");
    } else {
      values = value.values.map((item, index) => publicText(item, 120, `${path}.values[${index}]`, errors));
      if (new Set(values).size !== values.length) addError(errors, `${path}.values`, "SKILL_PARAMETER_VALUES_DUPLICATE", "Enum parameter values must be unique.");
    }
  } else if (value.values !== undefined) {
    addError(errors, `${path}.values`, "SKILL_PARAMETER_VALUES_UNEXPECTED", "Only enum parameters may declare values.");
  }

  const hasDefault = Object.hasOwn(value, "defaultValue");
  let defaultValue;
  if (hasDefault) {
    if (value.type === "string") {
      if (typeof value.defaultValue !== "string" || value.defaultValue.length > 2_000 || hasUnsafePublicString(value.defaultValue)) {
        addError(errors, `${path}.defaultValue`, "SKILL_PARAMETER_DEFAULT_INVALID", "String parameter defaults must be safe strings up to 2000 characters.");
      } else {
        defaultValue = value.defaultValue;
      }
    } else if (value.type === "number") {
      if (!isFiniteNumber(value.defaultValue)) addError(errors, `${path}.defaultValue`, "SKILL_PARAMETER_DEFAULT_INVALID", "Number parameter defaults must be finite numbers.");
      else defaultValue = value.defaultValue;
    } else if (value.type === "boolean") {
      if (typeof value.defaultValue !== "boolean") addError(errors, `${path}.defaultValue`, "SKILL_PARAMETER_DEFAULT_INVALID", "Boolean parameter defaults must be boolean.");
      else defaultValue = value.defaultValue;
    } else if (value.type === "enum") {
      if (typeof value.defaultValue !== "string" || !values?.includes(value.defaultValue)) {
        addError(errors, `${path}.defaultValue`, "SKILL_PARAMETER_DEFAULT_INVALID", "Enum parameter defaults must be one of the declared values.");
      } else {
        defaultValue = value.defaultValue;
      }
    }
  }

  if (!isPortId(value.parameterId) || !label || !PARAMETER_TYPES.includes(value.type) || typeof required !== "boolean") return undefined;
  return {
    parameterId: value.parameterId,
    label,
    type: value.type,
    required,
    ...(hasDefault && defaultValue !== undefined ? { defaultValue } : {}),
    ...(value.type === "enum" ? { values } : {}),
  };
}

function normalizeExample(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "SKILL_EXAMPLE_INVALID", "Skill examples must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, EXAMPLE_FIELDS, path, errors);
  const title = publicText(value.title, 160, `${path}.title`, errors);
  const description = value.description === undefined ? "" : publicText(value.description, 1_000, `${path}.description`, errors, false);
  return title ? { title, ...(description ? { description } : {}) } : undefined;
}

function uniqueTextList(value, maximumItems, maximumCharacters, path, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    addError(errors, path, "SKILL_LIST_INVALID", `List must contain at most ${maximumItems} strings.`);
    return [];
  }
  const items = value.map((item, index) => publicText(item, maximumCharacters, `${path}[${index}]`, errors));
  if (new Set(items).size !== items.length) addError(errors, path, "SKILL_LIST_DUPLICATE", "List values must be unique.");
  return items.every(Boolean) ? items : [];
}

function normalizeSkillMaterial(value, errors) {
  if (!isObject(value)) {
    addError(errors, "$", "SKILL_MANIFEST_OBJECT", "Skill manifest must be an object.");
    return undefined;
  }
  rejectUnknownFields(value, SKILL_FIELDS, "$", errors);
  if (value.schemaVersion !== SKILL_SCHEMA_VERSION) {
    addError(errors, "$.schemaVersion", "SKILL_SCHEMA_VERSION", "Skill manifest schemaVersion must be 1.");
  }
  if (!parseResourceId("skill", value.id)) {
    addError(errors, "$.id", "SKILL_ID_INVALID", "Skill ID must match skill.<publisher>.<slug>.");
  }
  const name = publicText(value.name, 120, "$.name", errors);
  const description = publicText(value.description, SKILL_LIMITS.maxDescription, "$.description", errors);
  if (!isSemver(value.version)) addError(errors, "$.version", "SKILL_VERSION_INVALID", "Skill version must be exact SemVer.");
  if (!isSemver(value.minAppVersion)) addError(errors, "$.minAppVersion", "SKILL_MIN_APP_VERSION_INVALID", "minAppVersion must be exact SemVer.");
  const license = publicText(value.license, 80, "$.license", errors);
  const instructions = publicText(value.instructions, SKILL_LIMITS.maxInstructions, "$.instructions", errors);

  if (!Array.isArray(value.inputSlots) || value.inputSlots.length < 1 || value.inputSlots.length > SKILL_LIMITS.maxInputSlots) {
    addError(errors, "$.inputSlots", "SKILL_SLOTS_INVALID", "Skill requires 1-16 input slots.");
  }
  const inputSlots = (Array.isArray(value.inputSlots) ? value.inputSlots : [])
    .slice(0, SKILL_LIMITS.maxInputSlots)
    .map((slot, index) => normalizeInputSlot(slot, `$.inputSlots[${index}]`, errors))
    .filter(Boolean);
  if (new Set(inputSlots.map(slot => slot.slotId)).size !== inputSlots.length) {
    addError(errors, "$.inputSlots", "SKILL_SLOT_DUPLICATE", "Skill input slot IDs must be unique.");
  }

  if (value.parameters !== undefined && (!Array.isArray(value.parameters) || value.parameters.length > SKILL_LIMITS.maxParameters)) {
    addError(errors, "$.parameters", "SKILL_PARAMETERS_INVALID", "Skill parameters must be an array with at most 32 items.");
  }
  const parameters = (Array.isArray(value.parameters) ? value.parameters : [])
    .slice(0, SKILL_LIMITS.maxParameters)
    .map((parameter, index) => normalizeParameter(parameter, `$.parameters[${index}]`, errors))
    .filter(Boolean);
  if (new Set(parameters.map(parameter => parameter.parameterId)).size !== parameters.length) {
    addError(errors, "$.parameters", "SKILL_PARAMETER_DUPLICATE", "Skill parameter IDs must be unique.");
  }

  if (value.examples !== undefined && (!Array.isArray(value.examples) || value.examples.length > SKILL_LIMITS.maxExamples)) {
    addError(errors, "$.examples", "SKILL_EXAMPLES_INVALID", "Skill examples must be an array with at most 12 items.");
  }
  const examples = (Array.isArray(value.examples) ? value.examples : [])
    .slice(0, SKILL_LIMITS.maxExamples)
    .map((example, index) => normalizeExample(example, `$.examples[${index}]`, errors))
    .filter(Boolean);
  const limitations = uniqueTextList(value.limitations, SKILL_LIMITS.maxLimitations, 500, "$.limitations", errors);
  const tags = uniqueTextList(value.tags, SKILL_LIMITS.maxTags, 40, "$.tags", errors);

  if (errors.length) return undefined;
  return {
    schemaVersion: SKILL_SCHEMA_VERSION,
    id: value.id,
    name,
    description,
    version: value.version,
    minAppVersion: value.minAppVersion,
    license,
    instructions,
    inputSlots,
    parameters,
    examples,
    limitations,
    tags,
  };
}

function parseSkillManifest(value) {
  const errors = [];
  const material = normalizeSkillMaterial(value, errors);
  if (!material) return validationResult(errors, undefined);
  if (!isHash(value.contentHash)) {
    addError(errors, "$.contentHash", "SKILL_HASH_INVALID", "Skill contentHash must be sha256:<64 lowercase hex>.");
    return validationResult(errors, undefined);
  }
  const expected = contentHashFor(material);
  if (value.contentHash !== expected) {
    addError(errors, "$.contentHash", "SKILL_HASH_MISMATCH", "Skill contentHash does not match the canonical manifest.");
    return validationResult(errors, undefined);
  }
  return validationResult(errors, { ...material, contentHash: expected });
}

function skillContentHash(value) {
  const errors = [];
  const material = normalizeSkillMaterial(value, errors);
  return material ? contentHashFor(material) : "";
}

function sealSkillManifest(value) {
  const errors = [];
  const material = normalizeSkillMaterial(value, errors);
  return material ? { ...material, contentHash: contentHashFor(material) } : undefined;
}

const normalizeSkillManifest = value => parseSkillManifest(value).value;

module.exports = {
  SKILL_SCHEMA_VERSION,
  SKILL_LIMITS,
  PARAMETER_TYPES,
  parseSkillManifest,
  normalizeSkillManifest,
  skillContentHash,
  sealSkillManifest,
};
