import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  imageConfigSnapshot,
  normalizeImageConfigSnapshot,
  settingsWithImageConfig,
} from "../runtime/image-config-snapshot.mjs";
import {
  agentTaskScopeSnapshotHash,
  type AgentTaskScope
} from "../src/core.ts";
import {
  cloneAgentTaskScope,
  mergeAgentTaskScopes,
  resolveAgentTaskScopeContinuation,
  withAgentTaskScopeConfirmationPolicy
} from "../src/task-scope.ts";

const require = createRequire(import.meta.url);
const { normalizedTaskScope, normalizedSteerTaskScopeUpdate, taskScopeSnapshotHash } = require("../agent-runtime.cjs");
const { resolveImageModelConfig, normalizeImageGenerationRequest } = require("../runtime/image-generation/types.cjs");
const { agentToolSchemas, imageModelPoolFromSettings } = require("../runtime/tool-schemas.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");

const imageSettings = {
  imageModel: "grok-imagine-image-2.0",
  imageModelPool: ["GROK-IMAGINE-IMAGE-2.0", "gpt-image-2"],
  imageRatio: "4:3", imageResolution: "2K", imageQuality: "medium", imageCount: 3, imageOutputFormat: "webp",
  imageApiKey: "global-key-must-not-persist", cookie: "cookie-must-not-persist",
  imageModelConfigs: [{
    model: "GROK-IMAGINE-IMAGE-2.0", protocol: "openai-images", gateway: "newapi", transportMode: "async",
    pollIntervalMs: 600, maxWaitMs: 45_000, baseUrl: "https://private.example.test", apiKey: "config-key-must-not-persist",
    capabilities: { edit: true, referenceImages: true, supportedQualities: ["auto", "low", "medium"], token: "cap-token-must-not-persist" },
  }, { model: "disabled-image", capabilities: { supportedQualities: ["high"] } }],
  imageModelBindings: [{ model: "GROK-IMAGINE-IMAGE-2.0", protocol: "openai-images", gateway: "newapi", transportMode: "async",
    customApiKey: "binding-key-must-not-persist", customBaseUrl: "https://private.example.test", accountTokenId: "token-id-must-not-persist" },
  { model: "disabled-image", protocol: "gemini-native" }],
};
const imageConfig = imageConfigSnapshot(imageSettings);
assert.deepEqual(imageConfig.models, ["grok-imagine-image-2.0", "gpt-image-2"], "The explicit image pool is case-insensitively canonical; saved disabled connections do not enable models");
assert.deepEqual(imageConfig.models, imageModelPoolFromSettings(imageSettings), "Snapshot and runtime must read the same explicit model pool");
assert.equal(imageConfig.configs[0].transportMode, "async");
assert.equal(imageConfig.configs[0].pollIntervalMs, 600);
assert.equal(imageConfig.configs[0].maxWaitMs, 45_000);
assert.doesNotMatch(JSON.stringify(imageConfig), /must-not-persist|private\.example|apiKey|ApiKey|BaseUrl|baseUrl|cookie|Token|token/,
  "Frozen scopes contain request preferences and capabilities, never credentials or connection addresses");
assert.deepEqual(normalizeImageConfigSnapshot(JSON.parse(JSON.stringify(imageConfig))), imageConfig, "The credential-free snapshot is stable through JSON persistence");
assert.equal(imageConfigSnapshot({ imageCount: 2.9 }).count, 2);
assert.equal(imageConfigSnapshot({ imageCount: Infinity }).count, 1);
const largeImagePool = Array.from({ length: 120 }, (_, index) => `custom-image-${index + 1}`);
const largePoolSettings = {
  imageModel: largeImagePool[0], imageModelPool: largeImagePool,
  imageModelConfigs: largeImagePool.map(model => ({ model, protocol: "openai-images", capabilities: { supportedQualities: ["medium"] } })),
  imageModelBindings: largeImagePool.map(model => ({ model, protocol: "openai-images", transportMode: "async" })),
};
const largePoolSnapshot = imageConfigSnapshot(largePoolSettings);
assert.deepEqual(largePoolSnapshot.models, imageModelPoolFromSettings(largePoolSettings), "Frozen model pools preserve every explicitly selected model beyond 80 entries");
assert.equal(largePoolSnapshot.configs.length, 120, "Every selected model retains its capability configuration");
assert.equal(largePoolSnapshot.bindings.length, 120, "Every selected model retains its protocol and transport preference");
assert.deepEqual(normalizeImageConfigSnapshot(JSON.parse(JSON.stringify(largePoolSnapshot))), largePoolSnapshot,
  "A large frozen model pool survives serialization without silent truncation");
assert.equal(imageConfigSnapshot({ imageModel: "bounded-capabilities", imageModelConfigs: [{ model: "bounded-capabilities",
  capabilities: { supportedQualities: Array.from({ length: 100 }, (_, index) => `quality-${index}`) } }] }).configs[0].capabilities!.supportedQualities?.length, 80,
  "Capability lists remain bounded independently of the complete selected model pool");

type ScopeInput = Omit<AgentTaskScope, "snapshotHash"> & {
  diagnosticCanvasPosition?: { x: number; y: number };
};

const base: ScopeInput = {
  imageConfig,
  version: 2,
  origin: "requirement",
  scopeType: "container",
  canvasRevision: 12,
  sourceNodeIds: ["A"],
  sourceContainerIds: ["A"],
  referenceContainerIds: ["B"],
  sourceBindingIds: ["binding:A:A:source-occurrence"],
  referenceBindingIds: ["binding:B:B:reference-occurrence"],
  sourceAssets: [{
    bindingId: "binding:A:A:source-occurrence",
    assetId: "asset-source",
    occurrenceId: `occ-${"1".repeat(32)}`,
    contentHash: "a".repeat(64),
    displayCode: "A1",
    role: "source",
    name: "待修改商品图",
    assetIndex: 0,
    containerSlot: 0,
    ownerAssetIndex: 0,
    ownerNodeId: "A",
    nodeId: "A",
    containerId: "A",
    path: "E:/projects/one/assets/source.png",
    relativePath: "assets/source.png"
  }],
  referenceAssets: [{
    bindingId: "binding:B:B:reference-occurrence",
    assetId: "asset-reference",
    occurrenceId: `occ-${"2".repeat(32)}`,
    contentHash: "b".repeat(64),
    displayCode: "B1",
    role: "reference",
    name: "颜色参考",
    assetIndex: 0,
    containerSlot: 0,
    ownerAssetIndex: 0,
    ownerNodeId: "B",
    nodeId: "B",
    containerId: "B",
    path: "E:/projects/one/assets/reference.png",
    relativePath: "assets/reference.png",
    referenceRole: "style",
    purpose: "只参考配色"
  }],
  resultPolicy: "grouped-by-source",
  confirmationPolicy: "preview-3",
  requirement: { nodeId: "REQ", revision: 3, sourceSignature: "signature-v3" },
  sourceAssetCount: 1,
  referenceAssetCount: 1,
  truncated: false
};

const hash = agentTaskScopeSnapshotHash(base);
assert.match(hash, /^scope-[a-f0-9]{32}$/);
assert.equal(agentTaskScopeSnapshotHash(structuredClone(base)), hash, "Equivalent scopes must hash identically");
assert.equal(taskScopeSnapshotHash(base), hash, "Renderer and Runtime hash the same frozen image configuration");
for (const change of [
  { ...imageConfig, ratio: "9:16" },
  { ...imageConfig, resolution: "1K" },
  { ...imageConfig, quality: "low" },
  { ...imageConfig, count: 1 },
  { ...imageConfig, model: "gpt-image-2" },
  { ...imageConfig, configs: imageConfig.configs.map(item => ({ ...item, transportMode: "sync" })) },
  { ...imageConfig, configs: imageConfig.configs.map(item => ({ ...item, capabilities: { supportedQualities: ["high"] } })) },
]) {
  const changed = { ...base, imageConfig: change };
  assert.notEqual(agentTaskScopeSnapshotHash(changed), hash, "Changing an effective image preference invalidates the frozen scope");
  assert.equal(agentTaskScopeSnapshotHash(changed), taskScopeSnapshotHash(changed), "Both hash mirrors include each effective image preference");
}
assert.equal(agentTaskScopeSnapshotHash({ ...base, imageConfig: { ...imageConfig, apiKey: "injected-secret" } as typeof imageConfig }), hash,
  "Unknown fields are excluded from the image configuration hash");

const creationScope: AgentTaskScope = { ...base, snapshotHash: hash, creation: { requirementId: "requirement-creation", revision: 1, fingerprint: `creation-${"a".repeat(64)}`,
  revisionPlan: { revisionId: "revision-targets", baselineReviewIds: ["review-one"], preserve: ["保留主体"], changes: [], targets: [
    { assetId: "asset-one", occurrenceId: "occ-1111111111111111", contentHash: "b".repeat(64), nodeId: "one", changes: ["白色背景"] },
    { assetId: "asset-two", occurrenceId: "occ-2222222222222222", contentHash: "c".repeat(64), nodeId: "two", changes: ["精简文字"] }
  ] } } };
creationScope.snapshotHash = agentTaskScopeSnapshotHash(creationScope);
assert.equal(creationScope.snapshotHash, taskScopeSnapshotHash(creationScope), "Creation refs and exact revision targets share one hash projection");
const clonedCreation = cloneAgentTaskScope(creationScope);
clonedCreation.creation!.revisionPlan!.targets[0].changes!.push("增加留白");
assert.deepEqual(creationScope.creation!.revisionPlan!.targets[0].changes, ["白色背景"], "Cloning never aliases per-target revision deltas");
assert.notEqual(agentTaskScopeSnapshotHash(clonedCreation), creationScope.snapshotHash);
const revisedRequirements = { ...creationScope, creation: { ...creationScope.creation!, revision: 2 } };
assert.notEqual(agentTaskScopeSnapshotHash(revisedRequirements), creationScope.snapshotHash, "Requirements revision changes invalidate the frozen hash");
assert.equal(agentTaskScopeSnapshotHash(revisedRequirements), taskScopeSnapshotHash(revisedRequirements));
assert.throws(() => normalizedSteerTaskScopeUpdate(creationScope, { sourceMode: "clear", referenceMode: "clear" }), /素材范围已经冻结/, "Creation steer cannot replace the original frozen material scope");
const creationSteer = normalizedSteerTaskScopeUpdate(creationScope, { sourceMode: "keep", referenceMode: "keep" }).taskScope;
assert.deepEqual(creationSteer.creation, creationScope.creation, "Text-only steer retains the complete creation contract association");

const frozenMaskIdentity = { assetId: "mask-one", occurrenceId: "occ-3333333333333333", contentHash: "d".repeat(64) };
const maskedCreationScope: AgentTaskScope = { ...creationScope,
  creation: { ...creationScope.creation!, revisionPlan: { ...creationScope.creation!.revisionPlan!, targets: [{ ...creationScope.creation!.revisionPlan!.targets[0], mask: frozenMaskIdentity }] } },
  maskAssets: [{ ...frozenMaskIdentity, target: { assetId: "asset-one", occurrenceId: "occ-1111111111111111", contentHash: "b".repeat(64) },
    path: "C:/fixture/.naimage/creation-masks/mask-one.png", relativePath: ".naimage/creation-masks/mask-one.png", mimeType: "image/png", name: "区域修改蒙版", width: 1024, height: 768 }]
};
maskedCreationScope.snapshotHash = agentTaskScopeSnapshotHash(maskedCreationScope);
assert.equal(maskedCreationScope.snapshotHash, taskScopeSnapshotHash(maskedCreationScope), "Runtime and Renderer hash the same mask identity, target binding and dimensions");
const maskedSteer = normalizedSteerTaskScopeUpdate(maskedCreationScope, { sourceMode: "keep", referenceMode: "keep" }).taskScope;
assert.deepEqual(maskedSteer.maskAssets, maskedCreationScope.maskAssets, "Text-only steer preserves the complete frozen mask material");
assert.deepEqual(maskedSteer.creation.revisionPlan.targets[0].mask, frozenMaskIdentity);
const clonedMaskScope = cloneAgentTaskScope(maskedCreationScope);
clonedMaskScope.maskAssets![0].target.assetId = "changed-target";
clonedMaskScope.creation!.revisionPlan!.targets[0].mask!.assetId = "changed-mask";
assert.equal(maskedCreationScope.maskAssets![0].target.assetId, "asset-one", "Mask clones never alias the original target binding");
assert.equal(maskedCreationScope.creation!.revisionPlan!.targets[0].mask!.assetId, frozenMaskIdentity.assetId);
assert.notEqual(agentTaskScopeSnapshotHash(clonedMaskScope), maskedCreationScope.snapshotHash);
assert.equal(agentTaskScopeSnapshotHash(clonedMaskScope), taskScopeSnapshotHash(clonedMaskScope));
const relocatedMaskScope = cloneAgentTaskScope(maskedCreationScope);
relocatedMaskScope.maskAssets![0].path = "D:/moved-project/.naimage/creation-masks/mask-one.png";
assert.equal(agentTaskScopeSnapshotHash(relocatedMaskScope), maskedCreationScope.snapshotHash, "Absolute mask paths are excluded from the logical scope hash");
const resizedMaskScope = cloneAgentTaskScope(maskedCreationScope);
resizedMaskScope.maskAssets![0].width = 512;
assert.notEqual(agentTaskScopeSnapshotHash(resizedMaskScope), maskedCreationScope.snapshotHash, "Mask pixel dimensions participate in the frozen hash");
assert.equal(agentTaskScopeSnapshotHash(resizedMaskScope), taskScopeSnapshotHash(resizedMaskScope));

const movedOnly: ScopeInput = {
  ...structuredClone(base),
  diagnosticCanvasPosition: { x: 1200, y: -850 }
};
assert.equal(
  agentTaskScopeSnapshotHash(movedOnly),
  hash,
  "Transient canvas coordinates must not alter the material TaskScope snapshot"
);

const relocatedProject = structuredClone(base);
relocatedProject.sourceAssets[0].path = "D:/moved-project/assets/source.png";
relocatedProject.referenceAssets[0].path = "D:/moved-project/assets/reference.png";
assert.equal(
  agentTaskScopeSnapshotHash(relocatedProject),
  hash,
  "Absolute project relocation must not invalidate logical asset bindings"
);

const nextRevision = structuredClone(base);
nextRevision.canvasRevision += 1;
assert.notEqual(agentTaskScopeSnapshotHash(nextRevision), hash, "A later dispatch revision must create a new frozen scope");

const changedSourceBinding = structuredClone(base);
changedSourceBinding.sourceBindingIds[0] = "binding:A:A:new-occurrence";
changedSourceBinding.sourceAssets[0].bindingId = "binding:A:A:new-occurrence";
assert.notEqual(agentTaskScopeSnapshotHash(changedSourceBinding), hash, "Changing the SOURCE occurrence must invalidate the scope");

const changedRole = structuredClone(base);
changedRole.sourceAssets[0].role = "reference";
assert.notEqual(agentTaskScopeSnapshotHash(changedRole), hash, "Changing an asset role must invalidate the scope");

const changedRequirement = structuredClone(base);
if (!changedRequirement.requirement) throw new Error("Fixture requirement missing");
changedRequirement.requirement.revision += 1;
assert.notEqual(agentTaskScopeSnapshotHash(changedRequirement), hash, "Editing a reusable requirement must invalidate the frozen scope");

const frozen: AgentTaskScope = { ...structuredClone(base), snapshotHash: hash };
const clonedScope = cloneAgentTaskScope(frozen);
(clonedScope.imageConfig!.configs[0].capabilities!.supportedQualities as string[]).push("high");
clonedScope.imageConfig!.models.push("another-model");
assert.equal(frozen.imageConfig!.models.length, 2, "A task-scope clone owns its model pool");
assert.deepEqual(frozen.imageConfig!.configs[0].capabilities!.supportedQualities, ["auto", "low", "medium"], "A task-scope clone owns nested capability arrays");
const persistedScope = normalizedTaskScope({ taskScope: JSON.parse(JSON.stringify(frozen)) });
assert.equal(persistedScope.snapshotHash, hash, "A pending task restored through the Runtime normalizer keeps the same scope hash");
assert.deepEqual(persistedScope.imageConfig, frozen.imageConfig);
const orderedPendingScope = normalizedTaskScope({ taskScope: { ...frozen, materials: [...base.referenceAssets, ...base.sourceAssets] } });
const pendingSessionInput = {
  schemaVersion: 5, nodes: [], messages: [], activeConversationId: "frozen-config-conversation",
  conversations: [{ id: "frozen-config-conversation", title: "Pending config fixture", messages: [] }],
  pendingAgentExecution: {
    version: 2, requestId: "frozen-config-request", projectId: "frozen-config-project", conversationId: "frozen-config-conversation",
    originalPrompt: "Continue this exact frozen task", imageRatio: "4:3", imageResolution: "2K", sourceNodeIds: ["A"], taskOrigin: "requirement",
    taskScope: { ...orderedPendingScope, imageConfig: { ...orderedPendingScope.imageConfig, apiKey: "injected-secret" } },
    kind: "confirm", question: "Continue the selected plan?", options: [{ id: "yes", label: "Continue" }, { id: "no", label: "Revise" }],
  },
};
const serializedPending = sanitizeSession(pendingSessionInput).pendingAgentExecution;
const restoredPending = sanitizeSession(JSON.parse(JSON.stringify({ ...pendingSessionInput, pendingAgentExecution: serializedPending }))).pendingAgentExecution;
assert.deepEqual(restoredPending.taskScope.imageConfig, imageConfig, "Main session persistence keeps all frozen image preferences");
assert.deepEqual(restoredPending.taskScope.materials.map((asset: { role: string }) => asset.role), ["reference", "source"],
  "Main session persistence keeps the ordered canonical materials and their roles");
assert.equal(restoredPending.imageRatio, "4:3");
assert.equal(restoredPending.imageResolution, "2K");
assert.equal(normalizedTaskScope({ taskScope: restoredPending.taskScope }).snapshotHash, orderedPendingScope.snapshotHash,
  "The persisted pending task keeps its Runtime/Renderer scope identity");
assert.doesNotMatch(JSON.stringify(restoredPending.taskScope.imageConfig), /injected-secret|must-not-persist|apiKey|customApiKey|cookie/);
const laterCanvas: AgentTaskScope = {
  ...structuredClone(frozen),
  canvasRevision: frozen.canvasRevision + 9,
  snapshotHash: ""
};
laterCanvas.snapshotHash = agentTaskScopeSnapshotHash(laterCanvas);
const firstContinuation = resolveAgentTaskScopeContinuation(frozen, laterCanvas, false);
const secondContinuation = resolveAgentTaskScopeContinuation(firstContinuation, {
  ...structuredClone(laterCanvas),
  canvasRevision: laterCanvas.canvasRevision + 4,
  snapshotHash: agentTaskScopeSnapshotHash({ ...laterCanvas, canvasRevision: laterCanvas.canvasRevision + 4 })
}, false);
assert.equal(firstContinuation.snapshotHash, frozen.snapshotHash, "AskUser continuation must retain its original frozen snapshot hash");
assert.equal(firstContinuation.canvasRevision, frozen.canvasRevision, "Preview results must not advance the frozen task revision");
assert.equal(secondContinuation.snapshotHash, frozen.snapshotHash, "Multiple staged AskUser rounds must accumulate under one task snapshot");
const driftedSettings = {
  ...imageSettings, imageModel: "gpt-image-2", imageModelPool: ["disabled-image"], imageRatio: "9:16", imageQuality: "low", imageCount: 1,
  imageModelConfigs: [{ ...imageSettings.imageModelConfigs[0], protocol: "xai-images", gateway: "direct", transportMode: "sync", pollIntervalMs: 3_000,
    maxWaitMs: 120_000, apiKey: "current-secret", capabilities: { supportedQualities: ["high"] } }],
};
const effectiveSettings = settingsWithImageConfig(driftedSettings, firstContinuation.imageConfig);
assert.deepEqual(imageConfigSnapshot(effectiveSettings), frozen.imageConfig, "Live settings edits cannot alter a pending task's effective request preferences");
assert.equal(effectiveSettings.imageModelConfigs[0].apiKey, "current-secret", "Main retains the current credential lookup without copying credentials into TaskScope");
const effectiveModel = resolveImageModelConfig(effectiveSettings, imageConfig.model);
assert.equal(effectiveModel.protocol, "openai-images");
assert.equal(effectiveModel.transportMode, "async");
assert.deepEqual(effectiveModel.capabilities.supportedQualities, ["auto", "low", "medium"]);
assert.equal(normalizeImageGenerationRequest({ prompt: "local fixture", quality: "high" }, effectiveModel).quality, "medium",
  "Grok parameters are normalized by frozen connection capabilities before dispatch");
const imageTool = agentToolSchemas(effectiveSettings).find((tool: { function?: { name?: string } }) => tool.function?.name === "image_gen");
assert.deepEqual(imageTool.function.parameters.properties.model.enum, imageConfig.models, "Public tools expose the same frozen selected model pool");

const addedReference = structuredClone(laterCanvas);
addedReference.referenceAssets.push({
  bindingId: "binding:C:C:reference-occurrence",
  assetId: "asset-reference-added",
  occurrenceId: `occ-${"3".repeat(32)}`,
  contentHash: "c".repeat(64),
  displayCode: "C1",
  role: "reference",
  name: "新增参考图",
  assetIndex: 0,
  containerSlot: 0,
  ownerAssetIndex: 0,
  ownerNodeId: "C",
  nodeId: "C",
  containerId: "C",
  relativePath: "assets/reference-added.png"
});
addedReference.referenceBindingIds.push("binding:C:C:reference-occurrence");
addedReference.referenceContainerIds.push("C");
addedReference.referenceAssetCount += 1;
addedReference.snapshotHash = agentTaskScopeSnapshotHash(addedReference);
const extendedContinuation = resolveAgentTaskScopeContinuation(frozen, addedReference, true);
assert.notEqual(extendedContinuation.snapshotHash, frozen.snapshotHash, "An explicit attachment must create a new extended snapshot");
assert.equal(extendedContinuation.sourceBindingIds[0], frozen.sourceBindingIds[0], "Extending REFERENCE must preserve the frozen SOURCE binding");
assert.equal(extendedContinuation.referenceAssets.length, 2, "The explicit REFERENCE upload must be included exactly once");
assert.deepEqual(extendedContinuation.imageConfig, frozen.imageConfig, "Adding an explicit reference preserves the task's initial image configuration");

const liveWithNewConfig = { ...addedReference, imageConfig: imageConfigSnapshot(driftedSettings) };
for (const sourceMode of ["keep", "replace", "merge", "clear"] as const) {
  for (const referenceMode of ["keep", "replace", "merge", "clear"] as const) {
    const updated = normalizedSteerTaskScopeUpdate(frozen, { sourceMode, referenceMode, taskScope: liveWithNewConfig }).taskScope;
    assert.deepEqual(updated.imageConfig, frozen.imageConfig, `Steer ${sourceMode}/${referenceMode} changes materials while retaining initial image settings`);
    assert.equal(updated.snapshotHash, agentTaskScopeSnapshotHash(updated), "Steered Runtime and Renderer hashes remain aligned");
    assert.deepEqual(normalizedTaskScope({ taskScope: JSON.parse(JSON.stringify(updated)) }).imageConfig, frozen.imageConfig,
      "Steer image preferences survive session serialization");
  }
}

const goalScope: AgentTaskScope = {
  ...cloneAgentTaskScope(frozen), origin: "goal", scopeType: "container-group",
  goal: { version: 1, target: "all-image-containers", frozen: true, containerIds: ["A"], bindingIds: [...frozen.sourceBindingIds],
    containerCount: 1, bindingCount: 1, configuredConcurrency: 2, probeContainerCount: 1, operationsPerAsset: 1, requestCount: 1 },
};
goalScope.snapshotHash = agentTaskScopeSnapshotHash(goalScope);
assert.deepEqual(resolveAgentTaskScopeContinuation(goalScope, laterCanvas, false).imageConfig, frozen.imageConfig, "A Goal clarification retains its frozen image settings");
assert.deepEqual(normalizedSteerTaskScopeUpdate(goalScope, { sourceMode: "keep", referenceMode: "keep" }).taskScope.imageConfig, frozen.imageConfig,
  "A Goal accepts text steering without losing its image settings");
assert.throws(() => normalizedSteerTaskScopeUpdate(goalScope, { sourceMode: "replace", referenceMode: "keep", taskScope: liveWithNewConfig }), /Goal/);
assert.throws(() => mergeAgentTaskScopes(goalScope, { ...cloneAgentTaskScope(goalScope), imageConfig: imageConfigSnapshot(driftedSettings) }), /Goal/,
  "A Goal with changed request configuration cannot silently merge into an already frozen scope");

const stagedContinuation = withAgentTaskScopeConfirmationPolicy(frozen, "staged");
assert.equal(stagedContinuation.confirmationPolicy, "staged", "The user's structured batch choice must become the resumed task policy");
assert.notEqual(stagedContinuation.snapshotHash, frozen.snapshotHash, "Changing the confirmed execution policy must create one new immutable strategy snapshot");
assert.equal(withAgentTaskScopeConfirmationPolicy(stagedContinuation, "staged").snapshotHash, stagedContinuation.snapshotHash, "Repeating the same staged choice must keep the strategy snapshot stable");

process.stdout.write(`${JSON.stringify({
  ok: true,
  stableClone: true,
  canvasCoordinatesExcluded: true,
  projectRelocationStable: true,
  revisionSensitive: true,
  bindingSensitive: true,
  roleSensitive: true,
  requirementSensitive: true,
  stagedContinuationStable: true,
  explicitAttachmentRehashes: true,
  structuredPolicyApplied: true,
  frozenConfigHashMirror: true,
  credentialFreePersistence: true,
  mainPendingSessionPersistence: true,
  liveSettingsDriftIsolated: true,
  steerConfigCases: 16,
  goalConfigPreserved: true,
  modelPoolAndCapabilityContract: true,
  completeSelectedModelPool: 120
})}\n`);
