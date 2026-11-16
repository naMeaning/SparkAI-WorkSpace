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
  isSlotId,
  isStepId,
  isEdgeId,
  isPortId,
  hasUnsafePublicString,
  addError,
  normalizePublicJson,
  validationResult,
} = require("./sparkvas-contract-utils.cjs");
const { RECIPE_NODE_TYPES, validateRecipeGraph } = require("./recipe-graph.cjs");

const RECIPE_SCHEMA_VERSION = 1;
const RECIPE_LIMITS = Object.freeze({
  maxDescription: 2_000,
  maxDependencies: 64,
  maxInputSlots: 16,
  maxOutputSlots: 16,
  maxNodes: 128,
  maxEdges: 512,
  maxTags: 24,
});
const RECIPE_FIELDS = new Set([
  "schemaVersion", "id", "name", "description", "version", "minAppVersion", "license",
  "dependencies", "inputSlots", "outputContract", "nodes", "edges", "tags", "contentHash",
]);
const SLOT_FIELDS = new Set(["slotId", "label", "dataType", "required"]);
const DEPENDENCY_FIELDS = new Set(["kind", "id", "version", "contentHash"]);
const NODE_FIELDS = new Set(["stepId", "type", "title", "ref", "inputPorts", "outputPorts", "config"]);
const INPUT_PORT_FIELDS = new Set(["portId", "label", "dataType", "required"]);
const OUTPUT_PORT_FIELDS = new Set(["portId", "label", "dataType"]);
const OUTPUT_CONTRACT_FIELDS = new Set(["schemaVersion", "outputs"]);
const EDGE_FIELDS = new Set(["edgeId", "fromStepId", "fromPortId", "toStepId", "toPortId"]);
const DEPENDENCY_KINDS = new Set(["skill", "tool"]);

function rejectUnknownFields(value, allowed, path, errors, code = "RECIPE_FIELD_UNKNOWN") {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, code, `Unknown Recipe field: ${key}.`);
  }
}

function publicText(value, maximum, path, errors, required = true) {
  const normalized = required ? text(value, maximum) : optionalText(value, maximum);
  if (required && !normalized) {
    addError(errors, path, "RECIPE_TEXT_INVALID", `Recipe text must be non-empty and at most ${maximum} characters.`);
    return "";
  }
  if (normalized && hasUnsafePublicString(normalized)) {
    addError(errors, path, "RECIPE_PUBLIC_VALUE_UNSAFE", "Recipe manifests must not contain absolute paths, file URLs or signed URLs.");
    return "";
  }
  return normalized;
}

function normalizeSlot(value, path, errors, output = false) {
  if (!isObject(value)) {
    addError(errors, path, output ? "RECIPE_OUTPUT_SLOT_INVALID" : "RECIPE_INPUT_SLOT_INVALID", "Recipe slots must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, SLOT_FIELDS, path, errors, "RECIPE_SLOT_FIELD_UNKNOWN");
  if (!isSlotId(value.slotId)) addError(errors, `${path}.slotId`, "RECIPE_SLOT_ID_INVALID", "Slot IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PORT_DATA_TYPES.includes(value.dataType)) addError(errors, `${path}.dataType`, "RECIPE_SLOT_TYPE_INVALID", "Unsupported recipe slot data type.");
  const required = value.required === undefined ? true : value.required;
  if (typeof required !== "boolean") addError(errors, `${path}.required`, "RECIPE_SLOT_REQUIRED_INVALID", "Slot required must be boolean.");
  return isSlotId(value.slotId) && label && PORT_DATA_TYPES.includes(value.dataType) && typeof required === "boolean"
    ? { slotId: value.slotId, label, dataType: value.dataType, required } : undefined;
}

function normalizeDependency(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RECIPE_DEPENDENCY_INVALID", "Recipe dependencies must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, DEPENDENCY_FIELDS, path, errors, "RECIPE_DEPENDENCY_FIELD_UNKNOWN");
  if (!DEPENDENCY_KINDS.has(value.kind) || !parseResourceId(value.kind, value.id)) {
    addError(errors, path, "RECIPE_DEPENDENCY_ID_INVALID", "Dependencies require a valid Skill or Tool ID.");
  }
  if (!isSemver(value.version)) addError(errors, `${path}.version`, "RECIPE_DEPENDENCY_VERSION_INVALID", "Dependency versions must be exact SemVer.");
  if (!isHash(value.contentHash)) addError(errors, `${path}.contentHash`, "RECIPE_DEPENDENCY_HASH_INVALID", "Dependencies require sha256:<64 lowercase hex> content hashes.");
  return DEPENDENCY_KINDS.has(value.kind) && parseResourceId(value.kind, value.id) && isSemver(value.version) && isHash(value.contentHash)
    ? { kind: value.kind, id: value.id, version: value.version, contentHash: value.contentHash } : undefined;
}

function normalizeNodeRef(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RECIPE_NODE_REF_INVALID", "Skill and Tool nodes require a dependency reference.");
    return undefined;
  }
  rejectUnknownFields(value, DEPENDENCY_FIELDS, path, errors, "RECIPE_NODE_REF_FIELD_UNKNOWN");
  if (!DEPENDENCY_KINDS.has(value.kind) || !parseResourceId(value.kind, value.id)) {
    addError(errors, path, "RECIPE_NODE_REF_ID_INVALID", "Node references require a valid Skill or Tool ID.");
  }
  if (!isSemver(value.version)) addError(errors, `${path}.version`, "RECIPE_NODE_REF_VERSION_INVALID", "Node reference versions must be exact SemVer.");
  if (!isHash(value.contentHash)) addError(errors, `${path}.contentHash`, "RECIPE_NODE_REF_HASH_INVALID", "Node references require sha256:<64 lowercase hex> content hashes.");
  return DEPENDENCY_KINDS.has(value.kind) && parseResourceId(value.kind, value.id) && isSemver(value.version) && isHash(value.contentHash)
    ? { kind: value.kind, id: value.id, version: value.version, contentHash: value.contentHash } : undefined;
}

function normalizeInputPort(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RECIPE_INPUT_PORT_INVALID", "Recipe input ports must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, INPUT_PORT_FIELDS, path, errors, "RECIPE_PORT_FIELD_UNKNOWN");
  if (!isPortId(value.portId)) addError(errors, `${path}.portId`, "RECIPE_PORT_ID_INVALID", "Port IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PORT_DATA_TYPES.includes(value.dataType)) addError(errors, `${path}.dataType`, "RECIPE_PORT_TYPE_INVALID", "Unsupported Recipe port data type.");
  const required = value.required === undefined ? true : value.required;
  if (typeof required !== "boolean") addError(errors, `${path}.required`, "RECIPE_PORT_REQUIRED_INVALID", "Input port required must be boolean.");
  return isPortId(value.portId) && label && PORT_DATA_TYPES.includes(value.dataType) && typeof required === "boolean"
    ? { portId: value.portId, label, dataType: value.dataType, required } : undefined;
}

function normalizeOutputPort(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RECIPE_OUTPUT_PORT_INVALID", "Recipe output ports must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, OUTPUT_PORT_FIELDS, path, errors, "RECIPE_PORT_FIELD_UNKNOWN");
  if (!isPortId(value.portId)) addError(errors, `${path}.portId`, "RECIPE_PORT_ID_INVALID", "Port IDs must be lowercase kebab-case identifiers.");
  const label = publicText(value.label, 120, `${path}.label`, errors);
  if (!PORT_DATA_TYPES.includes(value.dataType)) addError(errors, `${path}.dataType`, "RECIPE_PORT_TYPE_INVALID", "Unsupported Recipe port data type.");
  return isPortId(value.portId) && label && PORT_DATA_TYPES.includes(value.dataType)
    ? { portId: value.portId, label, dataType: value.dataType } : undefined;
}

function normalizeNode(value, path, errors, dependencyKeys, usedDependencies) {
  if (!isObject(value)) {
    addError(errors, path, "RECIPE_NODE_INVALID", "Recipe nodes must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, NODE_FIELDS, path, errors, "RECIPE_NODE_FIELD_UNKNOWN");
  if (!isStepId(value.stepId)) addError(errors, `${path}.stepId`, "RECIPE_STEP_ID_INVALID", "Nodes require a step.<slug> stepId.");
  if (!RECIPE_NODE_TYPES.includes(value.type)) {
    addError(errors, `${path}.type`, "RECIPE_NODE_TYPE_INVALID", "Unsupported semantic Recipe node type.");
  }
  const title = publicText(value.title, 120, `${path}.title`, errors);
  let ref;
  if (value.type === "Skill" || value.type === "Tool") {
    ref = normalizeNodeRef(value.ref, `${path}.ref`, errors);
    const expectedKind = value.type === "Skill" ? "skill" : "tool";
    if (ref && ref.kind !== expectedKind) addError(errors, `${path}.ref.kind`, "RECIPE_NODE_REF_KIND_MISMATCH", `${value.type} nodes must reference ${expectedKind} dependencies.`);
    const key = ref ? `${ref.kind}:${ref.id}:${ref.version}:${ref.contentHash}` : "";
    if (ref && !dependencyKeys.has(key)) addError(errors, `${path}.ref`, "RECIPE_NODE_REF_UNDECLARED", "Every Skill/Tool node reference must match a declared dependency.");
    if (ref && dependencyKeys.has(key)) usedDependencies.add(key);
  } else if (value.ref !== undefined) {
    addError(errors, `${path}.ref`, "RECIPE_NODE_REF_UNEXPECTED", "Only Skill and Tool nodes may declare a dependency reference.");
  }
  if (!Array.isArray(value.inputPorts) || value.inputPorts.length > 16) {
    addError(errors, `${path}.inputPorts`, "RECIPE_INPUT_PORTS_INVALID", "Nodes require an inputPorts array with at most 16 items.");
  }
  const inputPorts = (Array.isArray(value.inputPorts) ? value.inputPorts : [])
    .slice(0, 16).map((port, index) => normalizeInputPort(port, `${path}.inputPorts[${index}]`, errors)).filter(Boolean);
  if (!Array.isArray(value.outputPorts) || value.outputPorts.length > 16) {
    addError(errors, `${path}.outputPorts`, "RECIPE_OUTPUT_PORTS_INVALID", "Nodes require an outputPorts array with at most 16 items.");
  }
  const outputPorts = (Array.isArray(value.outputPorts) ? value.outputPorts : [])
    .slice(0, 16).map((port, index) => normalizeOutputPort(port, `${path}.outputPorts[${index}]`, errors)).filter(Boolean);
  let config;
  if (value.config !== undefined) {
    if (!isObject(value.config)) addError(errors, `${path}.config`, "RECIPE_NODE_CONFIG_INVALID", "Node config must be a JSON object.");
    else config = normalizePublicJson(value.config, `${path}.config`, errors);
  }
  if (!isStepId(value.stepId) || !RECIPE_NODE_TYPES.includes(value.type) || !title) return undefined;
  return {
    stepId: value.stepId,
    type: value.type,
    title,
    ...(ref ? { ref } : {}),
    inputPorts,
    outputPorts,
    ...(config !== undefined ? { config } : {}),
  };
}

function normalizeEdge(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RECIPE_EDGE_INVALID", "Recipe edges must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, EDGE_FIELDS, path, errors, "RECIPE_EDGE_FIELD_UNKNOWN");
  if (!isEdgeId(value.edgeId)) addError(errors, `${path}.edgeId`, "RECIPE_EDGE_ID_INVALID", "Edges require an edge.<slug> edgeId.");
  if (!isStepId(value.fromStepId)) addError(errors, `${path}.fromStepId`, "RECIPE_EDGE_STEP_INVALID", "fromStepId must be a step.<slug> identifier.");
  if (!isStepId(value.toStepId)) addError(errors, `${path}.toStepId`, "RECIPE_EDGE_STEP_INVALID", "toStepId must be a step.<slug> identifier.");
  if (!isPortId(value.fromPortId)) addError(errors, `${path}.fromPortId`, "RECIPE_EDGE_PORT_INVALID", "fromPortId must be a lowercase port identifier.");
  if (!isPortId(value.toPortId)) addError(errors, `${path}.toPortId`, "RECIPE_EDGE_PORT_INVALID", "toPortId must be a lowercase port identifier.");
  return isEdgeId(value.edgeId) && isStepId(value.fromStepId) && isStepId(value.toStepId) && isPortId(value.fromPortId) && isPortId(value.toPortId)
    ? { edgeId: value.edgeId, fromStepId: value.fromStepId, fromPortId: value.fromPortId, toStepId: value.toStepId, toPortId: value.toPortId } : undefined;
}

function normalizeRecipeMaterial(value, errors) {
  if (!isObject(value)) {
    addError(errors, "$", "RECIPE_DOCUMENT_OBJECT", "Recipe document must be an object.");
    return undefined;
  }
  rejectUnknownFields(value, RECIPE_FIELDS, "$", errors);
  if (value.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    addError(errors, "$.schemaVersion", "RECIPE_SCHEMA_VERSION", "Recipe schemaVersion must be 1.");
  }
  if (!parseResourceId("recipe", value.id)) addError(errors, "$.id", "RECIPE_ID_INVALID", "Recipe ID must match recipe.<publisher>.<slug>.");
  const name = publicText(value.name, 120, "$.name", errors);
  const description = publicText(value.description, RECIPE_LIMITS.maxDescription, "$.description", errors);
  if (!isSemver(value.version)) addError(errors, "$.version", "RECIPE_VERSION_INVALID", "Recipe version must be exact SemVer.");
  if (!isSemver(value.minAppVersion)) addError(errors, "$.minAppVersion", "RECIPE_MIN_APP_VERSION_INVALID", "minAppVersion must be exact SemVer.");
  const license = publicText(value.license, 80, "$.license", errors);

  if (!Array.isArray(value.dependencies) || value.dependencies.length < 1 || value.dependencies.length > RECIPE_LIMITS.maxDependencies) {
    addError(errors, "$.dependencies", "RECIPE_DEPENDENCIES_INVALID", "Recipe requires 1-64 Skill/Tool dependencies.");
  }
  const dependencies = (Array.isArray(value.dependencies) ? value.dependencies : [])
    .slice(0, RECIPE_LIMITS.maxDependencies)
    .map((dependency, index) => normalizeDependency(dependency, `$.dependencies[${index}]`, errors))
    .filter(Boolean);
  const dependencyKeys = new Set(dependencies.map(dependency =>
    `${dependency.kind}:${dependency.id}:${dependency.version}:${dependency.contentHash}`));
  if (dependencyKeys.size !== dependencies.length) addError(errors, "$.dependencies", "RECIPE_DEPENDENCY_DUPLICATE", "Recipe dependencies must be unique.");
  const dependencyIds = dependencies.map(dependency => `${dependency.kind}:${dependency.id}`);
  if (new Set(dependencyIds).size !== dependencyIds.length) addError(errors, "$.dependencies", "RECIPE_DEPENDENCY_ID_DUPLICATE", "A Recipe may pin only one version of each Skill or Tool.");

  if (!Array.isArray(value.inputSlots) || value.inputSlots.length < 1 || value.inputSlots.length > RECIPE_LIMITS.maxInputSlots) {
    addError(errors, "$.inputSlots", "RECIPE_INPUT_SLOTS_INVALID", "Recipe requires 1-16 input slots.");
  }
  const inputSlots = (Array.isArray(value.inputSlots) ? value.inputSlots : [])
    .slice(0, RECIPE_LIMITS.maxInputSlots)
    .map((slot, index) => normalizeSlot(slot, `$.inputSlots[${index}]`, errors))
    .filter(Boolean);
  if (new Set(inputSlots.map(slot => slot.slotId)).size !== inputSlots.length) addError(errors, "$.inputSlots", "RECIPE_INPUT_SLOT_DUPLICATE", "Input slot IDs must be unique.");

  if (!isObject(value.outputContract) || value.outputContract.schemaVersion !== 1 ||
    !Array.isArray(value.outputContract.outputs) || value.outputContract.outputs.length < 1 ||
    value.outputContract.outputs.length > RECIPE_LIMITS.maxOutputSlots) {
    addError(errors, "$.outputContract", "RECIPE_OUTPUT_CONTRACT_INVALID", "outputContract requires schemaVersion 1 and 1-16 outputs.");
  }
  if (isObject(value.outputContract)) {
    rejectUnknownFields(value.outputContract, OUTPUT_CONTRACT_FIELDS, "$.outputContract", errors, "RECIPE_OUTPUT_CONTRACT_FIELD_UNKNOWN");
  }
  const outputContract = {
    schemaVersion: 1,
    outputs: (Array.isArray(value.outputContract?.outputs) ? value.outputContract.outputs : [])
      .slice(0, RECIPE_LIMITS.maxOutputSlots)
      .map((slot, index) => normalizeSlot(slot, `$.outputContract.outputs[${index}]`, errors, true))
      .filter(Boolean),
  };
  if (new Set(outputContract.outputs.map(slot => slot.slotId)).size !== outputContract.outputs.length) {
    addError(errors, "$.outputContract.outputs", "RECIPE_OUTPUT_SLOT_DUPLICATE", "Output slot IDs must be unique.");
  }

  const usedDependencies = new Set();
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > RECIPE_LIMITS.maxNodes) {
    addError(errors, "$.nodes", "RECIPE_NODES_INVALID", "Recipe requires 1-128 semantic nodes.");
  }
  const nodes = (Array.isArray(value.nodes) ? value.nodes : [])
    .slice(0, RECIPE_LIMITS.maxNodes)
    .map((node, index) => normalizeNode(node, `$.nodes[${index}]`, errors, dependencyKeys, usedDependencies))
    .filter(Boolean);
  for (const dependency of dependencies) {
    const key = `${dependency.kind}:${dependency.id}:${dependency.version}:${dependency.contentHash}`;
    if (!usedDependencies.has(key)) addError(errors, "$.dependencies", "RECIPE_DEPENDENCY_UNUSED", "Every declared dependency must be referenced by at least one Skill or Tool node.");
  }
  if (!Array.isArray(value.edges) || value.edges.length > RECIPE_LIMITS.maxEdges) {
    addError(errors, "$.edges", "RECIPE_EDGES_INVALID", "Recipe edges must be an array with at most 512 items.");
  }
  const edges = (Array.isArray(value.edges) ? value.edges : [])
    .slice(0, RECIPE_LIMITS.maxEdges)
    .map((edge, index) => normalizeEdge(edge, `$.edges[${index}]`, errors))
    .filter(Boolean);
  let tags = [];
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > RECIPE_LIMITS.maxTags) {
      addError(errors, "$.tags", "RECIPE_TAGS_INVALID", "Recipe tags must be an array with at most 24 items.");
    } else {
      tags = value.tags.map((tag, index) => publicText(tag, 40, `$.tags[${index}]`, errors));
      if (new Set(tags).size !== tags.length) addError(errors, "$.tags", "RECIPE_TAG_DUPLICATE", "Recipe tags must be unique.");
      if (!tags.every(Boolean)) tags = [];
    }
  }
  if (errors.length) return undefined;
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: value.id,
    name,
    description,
    version: value.version,
    minAppVersion: value.minAppVersion,
    license,
    dependencies,
    inputSlots,
    outputContract,
    nodes,
    edges,
    tags,
  };
}

function parseRecipeDocument(value, { requireComplete = true } = {}) {
  const errors = [];
  const material = normalizeRecipeMaterial(value, errors);
  if (!material) return validationResult(errors, undefined);
  const graph = validateRecipeGraph(material, { requireComplete });
  errors.push(...graph.errors);
  if (!isHash(value.contentHash)) {
    addError(errors, "$.contentHash", "RECIPE_HASH_INVALID", "Recipe contentHash must be sha256:<64 lowercase hex>.");
    return validationResult(errors, undefined);
  }
  const expected = contentHashFor(material);
  if (value.contentHash !== expected) {
    addError(errors, "$.contentHash", "RECIPE_HASH_MISMATCH", "Recipe contentHash does not match the canonical document.");
    return validationResult(errors, undefined);
  }
  if (errors.length) return validationResult(errors, undefined);
  return validationResult(errors, { ...material, contentHash: expected });
}

function recipeContentHash(value) {
  const errors = [];
  const material = normalizeRecipeMaterial(value, errors);
  if (!material) return "";
  const graph = validateRecipeGraph(material, { requireComplete: false });
  return graph.ok ? contentHashFor(material) : "";
}

function sealRecipeDocument(value, options) {
  const errors = [];
  const material = normalizeRecipeMaterial(value, errors);
  if (!material) return undefined;
  const graph = validateRecipeGraph(material, { requireComplete: options?.requireComplete !== false });
  if (!graph.ok) return undefined;
  return { ...material, contentHash: contentHashFor(material) };
}

const normalizeRecipeDocument = (value, options) => parseRecipeDocument(value, options).value;

module.exports = {
  RECIPE_SCHEMA_VERSION,
  RECIPE_LIMITS,
  parseRecipeDocument,
  normalizeRecipeDocument,
  recipeContentHash,
  sealRecipeDocument,
};
