"use strict";

const {
  isObject,
  isFiniteNumber,
  text,
  optionalText,
  digestCanonical,
  parseResourceId,
  isSemver,
  isHash,
  isSlotId,
  isStepId,
  isRunId,
  isPublicId,
  isIsoTimestamp,
  hasUnsafePublicString,
  addError,
  validationResult,
} = require("./sparkvas-contract-utils.cjs");
const { parseToolPermissions } = require("./tool-contract.cjs");
const { parseRecipeDocument } = require("./recipe-contract.cjs");

const RECIPE_RUN_SCHEMA_VERSION = 1;
const RECIPE_RUN_STATUSES = Object.freeze([
  "queued", "running", "waiting_approval", "paused", "succeeded", "failed", "cancelled", "interrupted",
]);
const RECIPE_STEP_STATUSES = Object.freeze([
  "pending", "ready", "running", "waiting_approval", "succeeded", "failed", "cancelled", "interrupted",
]);
const RECIPE_STEP_SUBMISSION_STATES = Object.freeze([
  "not_submitted", "prepared", "submitted", "accepted", "unknown",
]);
const RECIPE_ERROR_CATEGORIES = Object.freeze([
  "input", "dependency", "permission", "execution", "network", "cancelled", "unknown",
]);
const RECIPE_OUTPUT_KINDS = Object.freeze(["image", "video", "bundle"]);
const RECIPE_REQUESTERS = Object.freeze(["user", "agent", "cli"]);
const OUTPUT_KINDS_BY_SLOT_TYPE = Object.freeze({
  image: new Set(["image"]),
  video: new Set(["video"]),
  bundle: new Set(["bundle"]),
  asset: new Set(["image", "video", "bundle"]),
  any: new Set(["image", "video", "bundle"]),
});

const RUN_FIELDS = new Set([
  "schemaVersion", "runId", "recipeId", "recipeVersion", "recipeHash", "projectId", "conversationId",
  "requestedBy", "status", "createdAt", "updatedAt", "scopeHash", "idempotencyKey", "inputAssetIdentity",
  "permissionSnapshot", "steps", "outputs", "error",
]);
const INPUT_ASSET_FIELDS = new Set(["slotId", "assetId", "occurrenceId", "contentHash"]);
const PERMISSION_SNAPSHOT_FIELDS = new Set(["schemaVersion", "approvedBy", "approvedAt", "tools"]);
const PERMISSION_TOOL_FIELDS = new Set(["toolId", "version", "contentHash", "permissions"]);
const STEP_FIELDS = new Set([
  "stepId", "status", "submissionState", "attempt", "startedAt", "finishedAt", "operationId", "outputs", "error",
]);
const OUTPUT_FIELDS = new Set([
  "slotId", "assetId", "occurrenceId", "contentHash", "kind", "mimeType", "width", "height", "durationMs",
]);
const ERROR_FIELDS = new Set(["code", "category", "message", "retryable", "at"]);
const MIME_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const RUN_RECORDED_NODE_TYPES = new Set(["Skill", "Transform", "Tool", "Review"]);

function compareStable(left, right) {
  const normalizedLeft = String(left ?? "");
  const normalizedRight = String(right ?? "");
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function compareByFields(fields) {
  return (left, right) => {
    for (const field of fields) {
      const compared = compareStable(left?.[field], right?.[field]);
      if (compared) return compared;
    }
    return 0;
  };
}

function sortedInputAssets(assets) {
  if (!Array.isArray(assets)) return assets;
  return [...assets].sort(compareByFields(["slotId", "assetId", "occurrenceId", "contentHash"]));
}

function sortedPermissionTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map(tool => {
    if (!isObject(tool?.permissions)) return tool;
    return {
      ...tool,
      permissions: Object.fromEntries(Object.entries(tool.permissions).map(([scope, values]) => [
        scope,
        Array.isArray(values) ? [...values].sort(compareStable) : values,
      ])),
    };
  }).sort(compareByFields(["toolId", "version", "contentHash"]));
}

function rejectUnknownFields(value, allowed, path, errors, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, code, `Unknown Run field: ${key}.`);
  }
}

function publicText(value, maximum, path, errors, required = true) {
  const normalized = required ? text(value, maximum) : optionalText(value, maximum);
  if (required && !normalized) {
    addError(errors, path, "RUN_TEXT_INVALID", `Run text must be non-empty and at most ${maximum} characters.`);
    return "";
  }
  if (normalized && hasUnsafePublicString(normalized)) {
    addError(errors, path, "RUN_PUBLIC_VALUE_UNSAFE", "Run data must not contain absolute paths, file URLs or signed URLs.");
    return "";
  }
  return normalized;
}

function normalizeTimestamp(value, path, errors, required = false) {
  if (!required && value === undefined) return undefined;
  if (!isIsoTimestamp(value)) {
    addError(errors, path, "RUN_TIMESTAMP_INVALID", "Timestamps must be canonical ISO-8601 UTC strings.");
    return undefined;
  }
  return value;
}

function normalizeAssetIdentity(value, path, errors, includeSlot = true, rejectUnknown = true) {
  if (!isObject(value)) {
    addError(errors, path, "RUN_ASSET_INVALID", "Asset identity must be an object.");
    return undefined;
  }
  if (rejectUnknown) rejectUnknownFields(value, INPUT_ASSET_FIELDS, path, errors, "RUN_ASSET_FIELD_UNKNOWN");
  if (includeSlot && !isSlotId(value.slotId)) addError(errors, `${path}.slotId`, "RUN_SLOT_ID_INVALID", "slotId must be a lowercase identifier.");
  if (!isPublicId(value.assetId)) addError(errors, `${path}.assetId`, "RUN_ASSET_ID_INVALID", "assetId must be a stable public identifier.");
  if (!isPublicId(value.occurrenceId)) addError(errors, `${path}.occurrenceId`, "RUN_OCCURRENCE_ID_INVALID", "occurrenceId must be a stable public identifier.");
  if (!isHash(value.contentHash)) addError(errors, `${path}.contentHash`, "RUN_ASSET_HASH_INVALID", "contentHash must be sha256:<64 lowercase hex>.");
  if ((includeSlot && !isSlotId(value.slotId)) || !isPublicId(value.assetId) || !isPublicId(value.occurrenceId) || !isHash(value.contentHash)) return undefined;
  return {
    ...(includeSlot ? { slotId: value.slotId } : {}),
    assetId: value.assetId,
    occurrenceId: value.occurrenceId,
    contentHash: value.contentHash,
  };
}

function normalizeOutput(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RUN_OUTPUT_INVALID", "Run outputs must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, OUTPUT_FIELDS, path, errors, "RUN_OUTPUT_FIELD_UNKNOWN");
  const identity = normalizeAssetIdentity(value, path, errors, true, false);
  if (!RECIPE_OUTPUT_KINDS.includes(value.kind)) addError(errors, `${path}.kind`, "RUN_OUTPUT_KIND_INVALID", "Output kind must be image, video or bundle.");
  if (typeof value.mimeType !== "string" || !MIME_TYPE.test(value.mimeType)) {
    addError(errors, `${path}.mimeType`, "RUN_OUTPUT_MIME_INVALID", "Outputs require a valid MIME type.");
  } else if (value.kind === "image" && !value.mimeType.startsWith("image/")) {
    addError(errors, `${path}.mimeType`, "RUN_OUTPUT_MIME_KIND_MISMATCH", "Image outputs require an image/* MIME type.");
  } else if (value.kind === "video" && !value.mimeType.startsWith("video/")) {
    addError(errors, `${path}.mimeType`, "RUN_OUTPUT_MIME_KIND_MISMATCH", "Video outputs require a video/* MIME type.");
  }
  for (const [key, minimum] of [["width", 1], ["height", 1], ["durationMs", 0]]) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < minimum)) {
      addError(errors, `${path}.${key}`, "RUN_OUTPUT_DIMENSION_INVALID", `${key} must be a safe integer of at least ${minimum}.`);
    }
  }
  if (!identity || !RECIPE_OUTPUT_KINDS.includes(value.kind) || typeof value.mimeType !== "string" || !MIME_TYPE.test(value.mimeType)) return undefined;
  return {
    ...identity,
    kind: value.kind,
    mimeType: value.mimeType,
    ...(value.width !== undefined && Number.isSafeInteger(value.width) && value.width >= 1 ? { width: value.width } : {}),
    ...(value.height !== undefined && Number.isSafeInteger(value.height) && value.height >= 1 ? { height: value.height } : {}),
    ...(value.durationMs !== undefined && Number.isSafeInteger(value.durationMs) && value.durationMs >= 0 ? { durationMs: value.durationMs } : {}),
  };
}

function normalizeRunError(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RUN_ERROR_INVALID", "Run errors must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, ERROR_FIELDS, path, errors, "RUN_ERROR_FIELD_UNKNOWN");
  if (typeof value.code !== "string" || !ERROR_CODE.test(value.code)) addError(errors, `${path}.code`, "RUN_ERROR_CODE_INVALID", "Error codes must be stable uppercase identifiers.");
  if (!RECIPE_ERROR_CATEGORIES.includes(value.category)) addError(errors, `${path}.category`, "RUN_ERROR_CATEGORY_INVALID", "Unsupported run error category.");
  const message = publicText(value.message, 500, `${path}.message`, errors);
  if (typeof value.retryable !== "boolean") addError(errors, `${path}.retryable`, "RUN_ERROR_RETRYABLE_INVALID", "Error retryable must be boolean.");
  const at = normalizeTimestamp(value.at, `${path}.at`, errors, true);
  if (!message || !RECIPE_ERROR_CATEGORIES.includes(value.category) || typeof value.retryable !== "boolean" || !at) return undefined;
  return { code: value.code, category: value.category, message, retryable: value.retryable, at };
}

function outputKindMatchesSlotType(kind, dataType) {
  return OUTPUT_KINDS_BY_SLOT_TYPE[dataType]?.has(kind) === true;
}

function normalizePermissionSnapshot(value, path, errors) {
  const before = errors.length;
  if (!isObject(value)) {
    addError(errors, path, "RUN_PERMISSION_SNAPSHOT_INVALID", "permissionSnapshot must be an object.");
    return undefined;
  }
  rejectUnknownFields(value, PERMISSION_SNAPSHOT_FIELDS, path, errors, "RUN_PERMISSION_FIELD_UNKNOWN");
  if (value.schemaVersion !== 1) addError(errors, `${path}.schemaVersion`, "RUN_PERMISSION_SCHEMA", "permissionSnapshot schemaVersion must be 1.");
  if (value.approvedBy !== "user") addError(errors, `${path}.approvedBy`, "RUN_PERMISSION_APPROVER", "Only an explicit user approval may create a Run permission snapshot.");
  const approvedAt = normalizeTimestamp(value.approvedAt, `${path}.approvedAt`, errors, true);
  if (!Array.isArray(value.tools) || value.tools.length > 64) {
    addError(errors, `${path}.tools`, "RUN_PERMISSION_TOOLS_INVALID", "permissionSnapshot tools must be an array with at most 64 items.");
    return undefined;
  }
  const tools = value.tools.map((tool, index) => {
    const toolPath = `${path}.tools[${index}]`;
    if (!isObject(tool)) {
      addError(errors, toolPath, "RUN_PERMISSION_TOOL_INVALID", "Permission tools must be objects.");
      return undefined;
    }
    rejectUnknownFields(tool, PERMISSION_TOOL_FIELDS, toolPath, errors, "RUN_PERMISSION_TOOL_FIELD_UNKNOWN");
    if (!parseResourceId("tool", tool.toolId)) addError(errors, `${toolPath}.toolId`, "RUN_PERMISSION_TOOL_ID_INVALID", "Permission tool IDs must match tool.<publisher>.<slug>.");
    if (!isSemver(tool.version)) addError(errors, `${toolPath}.version`, "RUN_PERMISSION_TOOL_VERSION_INVALID", "Permission tool versions must be exact SemVer.");
    if (!isHash(tool.contentHash)) addError(errors, `${toolPath}.contentHash`, "RUN_PERMISSION_TOOL_HASH_INVALID", "Permission tools require content hashes.");
    const permissions = parseToolPermissions(tool.permissions);
    errors.push(...permissions.errors.map(error => ({ ...error, path: error.path.replace("$.permissions", `${toolPath}.permissions`) })));
    if (!parseResourceId("tool", tool.toolId) || !isSemver(tool.version) || !isHash(tool.contentHash) || !permissions.value) return undefined;
    return { toolId: tool.toolId, version: tool.version, contentHash: tool.contentHash, permissions: permissions.value };
  }).filter(Boolean);
  if (new Set(tools.map(tool => tool.toolId)).size !== tools.length) addError(errors, `${path}.tools`, "RUN_PERMISSION_TOOL_DUPLICATE", "Permission tools must have unique IDs.");
  if (errors.length > before || value.schemaVersion !== 1 || value.approvedBy !== "user" || !approvedAt) return undefined;
  return { schemaVersion: 1, approvedBy: "user", approvedAt, tools: tools.sort((left, right) => left.toolId.localeCompare(right.toolId)) };
}

function normalizeStep(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "RUN_STEP_INVALID", "Run steps must be objects.");
    return undefined;
  }
  rejectUnknownFields(value, STEP_FIELDS, path, errors, "RUN_STEP_FIELD_UNKNOWN");
  if (!isStepId(value.stepId)) addError(errors, `${path}.stepId`, "RUN_STEP_ID_INVALID", "Run steps require a step.<slug> stepId.");
  if (!RECIPE_STEP_STATUSES.includes(value.status)) addError(errors, `${path}.status`, "RUN_STEP_STATUS_INVALID", "Unsupported step status.");
  if (!RECIPE_STEP_SUBMISSION_STATES.includes(value.submissionState)) {
    addError(errors, `${path}.submissionState`, "RUN_STEP_SUBMISSION_STATE_INVALID", "Unsupported step submission state.");
  }
  if (!Number.isSafeInteger(value.attempt) || value.attempt < 0 || value.attempt > 100) {
    addError(errors, `${path}.attempt`, "RUN_STEP_ATTEMPT_INVALID", "Step attempt must be an integer from 0 to 100.");
  }
  const startedAt = normalizeTimestamp(value.startedAt, `${path}.startedAt`, errors);
  const finishedAt = normalizeTimestamp(value.finishedAt, `${path}.finishedAt`, errors);
  if (startedAt && finishedAt && Date.parse(finishedAt) < Date.parse(startedAt)) {
    addError(errors, `${path}.finishedAt`, "RUN_STEP_TIME_ORDER", "finishedAt cannot precede startedAt.");
  }
  let operationId;
  if (value.operationId !== undefined) {
    if (!isPublicId(value.operationId)) addError(errors, `${path}.operationId`, "RUN_OPERATION_ID_INVALID", "operationId must be a stable public identifier.");
    else operationId = value.operationId;
  }
  if (!Array.isArray(value.outputs) || value.outputs.length > 32) {
    addError(errors, `${path}.outputs`, "RUN_STEP_OUTPUTS_INVALID", "Step outputs must be an array with at most 32 items.");
  }
  const outputs = (Array.isArray(value.outputs) ? value.outputs : [])
    .slice(0, 32).map((output, index) => normalizeOutput(output, `${path}.outputs[${index}]`, errors)).filter(Boolean);
  if (new Set(outputs.map(output => output.slotId)).size !== outputs.length) {
    addError(errors, `${path}.outputs`, "RUN_STEP_OUTPUT_DUPLICATE", "Step output slot IDs must be unique.");
  }
  const error = value.error === undefined ? undefined : normalizeRunError(value.error, `${path}.error`, errors);
  if (value.submissionState === "unknown" && error?.retryable) {
    addError(errors, `${path}.error.retryable`, "RUN_UNKNOWN_SUBMISSION_RETRYABLE", "Unknown submissions must be reconciled and cannot be marked retryable.");
  }
  if (!isStepId(value.stepId) || !RECIPE_STEP_STATUSES.includes(value.status) ||
    !RECIPE_STEP_SUBMISSION_STATES.includes(value.submissionState) ||
    !Number.isSafeInteger(value.attempt) || value.attempt < 0 || value.attempt > 100) return undefined;
  return {
    stepId: value.stepId,
    status: value.status,
    submissionState: value.submissionState,
    attempt: value.attempt,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(operationId ? { operationId } : {}),
    outputs,
    ...(error ? { error } : {}),
  };
}

function normalizeRunCore(value, errors) {
  if (!isObject(value)) {
    addError(errors, "$", "RUN_DOCUMENT_OBJECT", "Recipe Run must be an object.");
    return undefined;
  }
  rejectUnknownFields(value, RUN_FIELDS, "$", errors, "RUN_FIELD_UNKNOWN");
  if (value.schemaVersion !== RECIPE_RUN_SCHEMA_VERSION) addError(errors, "$.schemaVersion", "RUN_SCHEMA_VERSION", "Recipe Run schemaVersion must be 1.");
  if (!isRunId(value.runId)) addError(errors, "$.runId", "RUN_ID_INVALID", "runId must match run.<uuid>.");
  if (!parseResourceId("recipe", value.recipeId)) addError(errors, "$.recipeId", "RUN_RECIPE_ID_INVALID", "recipeId must match recipe.<publisher>.<slug>.");
  if (!isSemver(value.recipeVersion)) addError(errors, "$.recipeVersion", "RUN_RECIPE_VERSION_INVALID", "recipeVersion must be exact SemVer.");
  if (!isHash(value.recipeHash)) addError(errors, "$.recipeHash", "RUN_RECIPE_HASH_INVALID", "recipeHash must be sha256:<64 lowercase hex>.");
  if (!isPublicId(value.projectId)) addError(errors, "$.projectId", "RUN_PROJECT_ID_INVALID", "projectId must be a stable public identifier.");
  let conversationId;
  if (value.conversationId !== undefined) {
    if (!isPublicId(value.conversationId)) addError(errors, "$.conversationId", "RUN_CONVERSATION_ID_INVALID", "conversationId must be a stable public identifier.");
    else conversationId = value.conversationId;
  }
  if (!RECIPE_REQUESTERS.includes(value.requestedBy)) addError(errors, "$.requestedBy", "RUN_REQUESTER_INVALID", "requestedBy must be user, agent or cli.");
  if (!RECIPE_RUN_STATUSES.includes(value.status)) addError(errors, "$.status", "RUN_STATUS_INVALID", "Unsupported Recipe Run status.");
  const createdAt = normalizeTimestamp(value.createdAt, "$.createdAt", errors, true);
  const updatedAt = normalizeTimestamp(value.updatedAt, "$.updatedAt", errors, true);
  if (createdAt && updatedAt && Date.parse(updatedAt) < Date.parse(createdAt)) {
    addError(errors, "$.updatedAt", "RUN_TIME_ORDER", "updatedAt cannot precede createdAt.");
  }
  if (!Array.isArray(value.inputAssetIdentity) || value.inputAssetIdentity.length < 1 || value.inputAssetIdentity.length > 32) {
    addError(errors, "$.inputAssetIdentity", "RUN_INPUT_ASSETS_INVALID", "inputAssetIdentity requires 1-32 asset identities.");
  }
  const inputAssetIdentity = (Array.isArray(value.inputAssetIdentity) ? value.inputAssetIdentity : [])
    .slice(0, 32).map((asset, index) => normalizeAssetIdentity(asset, `$.inputAssetIdentity[${index}]`, errors)).filter(Boolean);
  if (new Set(inputAssetIdentity.map(asset => asset.slotId)).size !== inputAssetIdentity.length) {
    addError(errors, "$.inputAssetIdentity", "RUN_INPUT_ASSET_DUPLICATE", "Input asset slot IDs must be unique.");
  }
  const permissionSnapshot = normalizePermissionSnapshot(value.permissionSnapshot, "$.permissionSnapshot", errors);
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 128) {
    addError(errors, "$.steps", "RUN_STEPS_INVALID", "Recipe Run requires 1-128 steps.");
  }
  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .slice(0, 128).map((step, index) => normalizeStep(step, `$.steps[${index}]`, errors)).filter(Boolean);
  if (new Set(steps.map(step => step.stepId)).size !== steps.length) addError(errors, "$.steps", "RUN_STEP_DUPLICATE", "Run step IDs must be unique.");
  if (!Array.isArray(value.outputs) || value.outputs.length > 32) {
    addError(errors, "$.outputs", "RUN_OUTPUTS_INVALID", "Run outputs must be an array with at most 32 items.");
  }
  const outputs = (Array.isArray(value.outputs) ? value.outputs : [])
    .slice(0, 32).map((output, index) => normalizeOutput(output, `$.outputs[${index}]`, errors)).filter(Boolean);
  if (new Set(outputs.map(output => output.slotId)).size !== outputs.length) addError(errors, "$.outputs", "RUN_OUTPUT_DUPLICATE", "Run output slot IDs must be unique.");
  const error = value.error === undefined ? undefined : normalizeRunError(value.error, "$.error", errors);
  if (error?.retryable && steps.some(step => step.submissionState === "unknown")) {
    addError(errors, "$.error.retryable", "RUN_UNKNOWN_SUBMISSION_RETRYABLE", "A Run with an unknown submission cannot carry a retryable terminal error.");
  }

  if (value.status === "succeeded") {
    if (!outputs.length) addError(errors, "$.outputs", "RUN_SUCCEEDED_WITHOUT_OUTPUT", "A succeeded Run requires at least one output.");
    if (steps.some(step => step.status !== "succeeded")) addError(errors, "$.steps", "RUN_SUCCEEDED_STEP_STATE", "A succeeded Run requires every step to be succeeded.");
    if (error) addError(errors, "$.error", "RUN_SUCCEEDED_WITH_ERROR", "A succeeded Run cannot carry a terminal error.");
  }
  if (value.status === "failed" && !error && !steps.some(step => step.status === "failed")) {
    addError(errors, "$.error", "RUN_FAILED_WITHOUT_ERROR", "A failed Run requires a top-level or step error.");
  }
  if (value.status === "queued" && steps.some(step => step.status !== "pending")) {
    addError(errors, "$.steps", "RUN_QUEUED_STEP_STATE", "A queued Run may only contain pending steps.");
  }
  if (errors.length) return undefined;
  return {
    schemaVersion: RECIPE_RUN_SCHEMA_VERSION,
    runId: value.runId,
    recipeId: value.recipeId,
    recipeVersion: value.recipeVersion,
    recipeHash: value.recipeHash,
    projectId: value.projectId,
    ...(conversationId ? { conversationId } : {}),
    requestedBy: value.requestedBy,
    status: value.status,
    createdAt,
    updatedAt,
    inputAssetIdentity: sortedInputAssets(inputAssetIdentity),
    permissionSnapshot,
    steps,
    outputs,
    ...(error ? { error } : {}),
  };
}

function recipeRunScopeHash(value) {
  return digestCanonical({
    schemaVersion: 1,
    recipeId: value.recipeId,
    recipeVersion: value.recipeVersion,
    recipeHash: value.recipeHash,
    projectId: value.projectId,
    inputAssetIdentity: sortedInputAssets(value.inputAssetIdentity),
    permissionSnapshot: isObject(value.permissionSnapshot) ? {
      ...value.permissionSnapshot,
      tools: sortedPermissionTools(value.permissionSnapshot.tools),
    } : value.permissionSnapshot,
  });
}

function recipeRunIdempotencyKey(runId, scopeHash) {
  return digestCanonical({ schemaVersion: 1, runId, scopeHash });
}

function sealRecipeRun(value) {
  const errors = [];
  const core = normalizeRunCore(value, errors);
  if (!core) return undefined;
  const scopeHash = recipeRunScopeHash(core);
  return { ...core, scopeHash, idempotencyKey: recipeRunIdempotencyKey(core.runId, scopeHash) };
}

function parseRecipeRun(value) {
  const errors = [];
  const core = normalizeRunCore(value, errors);
  if (!core) return validationResult(errors, undefined);
  if (!isHash(value.scopeHash)) {
    addError(errors, "$.scopeHash", "RUN_SCOPE_HASH_INVALID", "scopeHash must be sha256:<64 lowercase hex>.");
  } else if (value.scopeHash !== recipeRunScopeHash(core)) {
    addError(errors, "$.scopeHash", "RUN_SCOPE_HASH_MISMATCH", "scopeHash does not match the frozen recipe inputs and permissions.");
  }
  if (!isHash(value.idempotencyKey)) {
    addError(errors, "$.idempotencyKey", "RUN_IDEMPOTENCY_KEY_INVALID", "idempotencyKey must be sha256:<64 lowercase hex>.");
  } else if (value.idempotencyKey !== recipeRunIdempotencyKey(core.runId, value.scopeHash)) {
    addError(errors, "$.idempotencyKey", "RUN_IDEMPOTENCY_KEY_MISMATCH", "idempotencyKey does not match runId and scopeHash.");
  }
  if (errors.length) return validationResult(errors, undefined);
  return validationResult(errors, { ...core, scopeHash: value.scopeHash, idempotencyKey: value.idempotencyKey });
}

const normalizeRecipeRun = value => parseRecipeRun(value).value;

function validateRecipeRunAgainstRecipe(runValue, recipeValue) {
  const errors = [];
  const runResult = parseRecipeRun(runValue);
  const recipeResult = parseRecipeDocument(recipeValue);
  errors.push(...runResult.errors, ...recipeResult.errors);
  if (!runResult.value || !recipeResult.value) return validationResult(errors, undefined);
  const run = runResult.value;
  const recipe = recipeResult.value;

  if (run.recipeId !== recipe.id) {
    addError(errors, "$.recipeId", "RUN_RECIPE_ID_MISMATCH", "Run recipeId must match the referenced Recipe.");
  }
  if (run.recipeVersion !== recipe.version) {
    addError(errors, "$.recipeVersion", "RUN_RECIPE_VERSION_MISMATCH", "Run recipeVersion must match the referenced Recipe.");
  }
  if (run.recipeHash !== recipe.contentHash) {
    addError(errors, "$.recipeHash", "RUN_RECIPE_HASH_MISMATCH", "Run recipeHash must match the referenced Recipe content hash.");
  }

  const inputSlots = new Map(recipe.inputSlots.map(slot => [slot.slotId, slot]));
  const runInputSlots = new Set(run.inputAssetIdentity.map(asset => asset.slotId));
  for (const asset of run.inputAssetIdentity) {
    if (!inputSlots.has(asset.slotId)) {
      addError(errors, "$.inputAssetIdentity", "RUN_INPUT_SLOT_UNDECLARED", `Run input slot ${asset.slotId} is not declared by the Recipe.`);
    }
  }
  for (const slot of recipe.inputSlots) {
    if (slot.required !== false && !runInputSlots.has(slot.slotId)) {
      addError(errors, "$.inputAssetIdentity", "RUN_REQUIRED_INPUT_MISSING", `Run is missing required Recipe input slot ${slot.slotId}.`);
    }
  }

  const outputSlots = new Map(recipe.outputContract.outputs.map(slot => [slot.slotId, slot]));
  const runOutputSlots = new Set(run.outputs.map(output => output.slotId));
  for (const output of run.outputs) {
    const slot = outputSlots.get(output.slotId);
    if (!slot) {
      addError(errors, "$.outputs", "RUN_OUTPUT_SLOT_UNDECLARED", `Run output slot ${output.slotId} is not declared by the Recipe outputContract.`);
    } else if (!outputKindMatchesSlotType(output.kind, slot.dataType)) {
      addError(errors, "$.outputs", "RUN_OUTPUT_TYPE_MISMATCH", `Run output ${output.slotId} kind ${output.kind} cannot satisfy Recipe slot type ${slot.dataType}.`);
    }
  }
  if (run.status === "succeeded") {
    for (const slot of recipe.outputContract.outputs) {
      if (!runOutputSlots.has(slot.slotId)) {
        addError(errors, "$.outputs", "RUN_REQUIRED_OUTPUT_MISSING", `A succeeded Run is missing Recipe output slot ${slot.slotId}.`);
      }
    }
  }

  const nodes = new Map(recipe.nodes.map(node => [node.stepId, node]));
  const runSteps = new Set(run.steps.map(step => step.stepId));
  for (const step of run.steps) {
    const node = nodes.get(step.stepId);
    if (!node) {
      addError(errors, "$.steps", "RUN_STEP_UNDECLARED", `Run step ${step.stepId} is not declared by the Recipe.`);
    } else if (!RUN_RECORDED_NODE_TYPES.has(node.type)) {
      addError(errors, "$.steps", "RUN_STEP_NOT_EXECUTABLE", `Recipe node ${step.stepId} does not own a Run step.`);
    } else {
      const stepOutputSlots = new Map(node.outputPorts.map(port => [port.portId, port]));
      for (const output of step.outputs) {
        const slot = stepOutputSlots.get(output.slotId);
        if (!slot) {
          addError(errors, "$.steps", "RUN_STEP_OUTPUT_SLOT_UNDECLARED", `Step output ${output.slotId} is not declared by Recipe step ${step.stepId}.`);
        } else if (!outputKindMatchesSlotType(output.kind, slot.dataType)) {
          addError(errors, "$.steps", "RUN_STEP_OUTPUT_TYPE_MISMATCH", `Step output ${output.slotId} kind ${output.kind} cannot satisfy Recipe port type ${slot.dataType}.`);
        }
      }
    }
  }
  for (const node of recipe.nodes) {
    if (RUN_RECORDED_NODE_TYPES.has(node.type) && !runSteps.has(node.stepId)) {
      addError(errors, "$.steps", "RUN_EXECUTABLE_STEP_MISSING", `Run is missing executable Recipe step ${node.stepId}.`);
    }
  }

  const expectedTools = new Map();
  for (const node of recipe.nodes) {
    if (node.type !== "Tool" || !node.ref) continue;
    expectedTools.set(node.ref.id, {
      toolId: node.ref.id,
      version: node.ref.version,
      contentHash: node.ref.contentHash,
    });
  }
  const actualTools = new Map(run.permissionSnapshot.tools.map(tool => [tool.toolId, tool]));
  for (const [toolId, expected] of expectedTools) {
    const actual = actualTools.get(toolId);
    if (!actual) {
      addError(errors, "$.permissionSnapshot.tools", "RUN_TOOL_PERMISSION_MISSING", `Run permission snapshot is missing Tool ${toolId}.`);
      continue;
    }
    if (actual.version !== expected.version || actual.contentHash !== expected.contentHash) {
      addError(errors, "$.permissionSnapshot.tools", "RUN_TOOL_PERMISSION_MISMATCH", `Run permission snapshot does not match the pinned Tool ${toolId}.`);
    }
  }
  for (const toolId of actualTools.keys()) {
    if (!expectedTools.has(toolId)) {
      addError(errors, "$.permissionSnapshot.tools", "RUN_TOOL_PERMISSION_UNDECLARED", `Run permission snapshot includes Tool ${toolId} that is not used by the Recipe.`);
    }
  }

  return validationResult(errors, errors.length === 0 ? run : undefined);
}

const RUN_TRANSITIONS = Object.freeze({
  queued: new Set(["running", "cancelled", "interrupted"]),
  running: new Set(["waiting_approval", "paused", "succeeded", "failed", "cancelled", "interrupted"]),
  waiting_approval: new Set(["running", "failed", "cancelled", "interrupted"]),
  paused: new Set(["running", "failed", "cancelled", "interrupted"]),
  interrupted: new Set(["queued", "running", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

function canTransitionRecipeRunStatus(from, to) {
  return RECIPE_RUN_STATUSES.includes(from) && RUN_TRANSITIONS[from]?.has(to) === true;
}

function recipeStepRetryDisposition(step) {
  if (!isObject(step) || !RECIPE_STEP_SUBMISSION_STATES.includes(step.submissionState)) return "not_retryable";
  if (step.submissionState === "unknown") return "blocked";
  if (step.status !== "failed" && step.status !== "interrupted") return "not_retryable";
  if (step.submissionState === "not_submitted" || step.submissionState === "prepared") return "allowed";
  if (step.submissionState === "submitted" || step.submissionState === "accepted") return "reconcile";
  return "not_retryable";
}

const canRetryRecipeStep = step => recipeStepRetryDisposition(step) === "allowed";

module.exports = {
  RECIPE_RUN_SCHEMA_VERSION,
  RECIPE_RUN_STATUSES,
  RECIPE_STEP_STATUSES,
  RECIPE_STEP_SUBMISSION_STATES,
  RECIPE_ERROR_CATEGORIES,
  RECIPE_OUTPUT_KINDS,
  RECIPE_REQUESTERS,
  outputKindMatchesSlotType,
  recipeRunScopeHash,
  recipeRunIdempotencyKey,
  sealRecipeRun,
  parseRecipeRun,
  normalizeRecipeRun,
  validateRecipeRunAgainstRecipe,
  canTransitionRecipeRunStatus,
  recipeStepRetryDisposition,
  canRetryRecipeStep,
};
