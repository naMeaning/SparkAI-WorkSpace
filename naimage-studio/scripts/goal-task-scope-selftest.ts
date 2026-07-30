import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  agentTaskScopeSnapshotHash,
  type AgentTaskScope,
  type ImageAsset,
  type ImageContainerSpec,
  type WorkflowNode,
} from "../src/core.ts";
import {
  buildGoalTaskScopeFromNodes,
  MAX_GOAL_TASK_SCOPE_BINDINGS,
  preflightGoalTaskScope,
} from "../src/goal-task-scope.ts";
import {
  cloneAgentTaskScope,
  mergeAgentTaskScopes,
  resolveAgentTaskScopeContinuation,
  withAgentTaskScopeConfirmationPolicy,
} from "../src/task-scope.ts";
import {
  createGoalConfirmationLedger,
  createGoalModePreview,
  goalModeAuthorizationFingerprint,
  publicGoalModePreview,
} from "../src/goal-mode.ts";

const require = createRequire(import.meta.url);
const { composeCommerceSetTask } = require("../runtime/commerce-set-plan.cjs") as {
  composeCommerceSetTask: (value: unknown) => { prompt: string; planHash: string; counts: { outputsPerSource: number; totalRequests: number } };
};

const occurrence = (value: string): string => `occ-${value.repeat(32).slice(0, 32)}`;

const asset = (
  assetId: string,
  slot = 0,
  overrides: Partial<ImageAsset> = {},
): ImageAsset => ({
  assetId,
  occurrenceId: occurrence((slot % 10).toString()),
  index: slot + 1,
  type: "file",
  path: `E:/projects/goal/assets/${assetId}-${slot + 1}.png`,
  originalName: `${assetId}-${slot + 1}.png`,
  width: 1024,
  height: 1024,
  ...overrides,
});

const spec = (
  kind: ImageContainerSpec["kind"] = "manual",
  memberNodeIds: string[] = [],
  childContainerNodeIds: string[] = [],
  overrides: Partial<ImageContainerSpec> = {},
): ImageContainerSpec => ({
  version: 1,
  kind,
  memberNodeIds,
  childContainerNodeIds,
  memberBindings: [],
  layoutOrigin: "manual",
  autoFit: true,
  ...overrides,
});

const container = (
  id: string,
  assets: ImageAsset[] = [],
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  displayCode: id,
  title: id,
  prompt: `${id} prompt`,
  type: "image",
  status: "done",
  x: 0,
  y: 0,
  branch: "basic",
  outputs: assets.length,
  createdAt: "2026-07-29T00:00:00.000Z",
  assets,
  imageState: assets.length ? "done" : "empty",
  imageContainer: true,
  imageContainerSpec: spec(),
  ...overrides,
});

const sharedA = asset("shared-blob", 1, { occurrenceId: occurrence("a"), path: "E:/projects/goal/assets/shared.png" });
const sharedB = asset("shared-blob", 2, { occurrenceId: occurrence("b"), path: "E:/projects/goal/assets/shared.png" });
const childA = container("CHILD-A", [sharedA, sharedB]);
const childB = container("CHILD-B", [asset("child-b", 3, { occurrenceId: occurrence("c") })]);
const superContainer = container("SUPER", [], {
  imageState: "done",
  imageContainerSpec: spec("container-group", [], [childA.id, childB.id]),
});
const solo = container("SOLO", [asset("solo", 4, { occurrenceId: occurrence("d") })]);
const referenceOnly = container("REFERENCE", [asset("reference", 5, {
  occurrenceId: occurrence("e"),
  taskRole: "reference",
})], { imageContainerRole: "reference" });
const empty = container("EMPTY");
const generating = container("GENERATING", [asset("generating", 6, { occurrenceId: occurrence("f") })], {
  imageState: "generating",
  status: "working",
  generationRunId: "run-active",
});
const plainImage = container("PLAIN", [asset("plain", 7)], {
  imageContainer: false,
  imageContainerSpec: undefined,
});

const projectedNodes = [
  superContainer,
  childA,
  childB,
  solo,
  referenceOnly,
  empty,
  generating,
  plainImage,
];

const preflight = preflightGoalTaskScope(projectedNodes, {
  canvasRevision: 41,
  configuredConcurrency: 8,
  probeContainerCount: 2,
  projectAsset: () => ({ mimeType: "image/png", purpose: "adapter metadata" }),
});
assert.equal(preflight.ok, true);
assert.deepEqual(preflight.eligibleContainerIds, ["SUPER", "SOLO"], "Only top-level eligible containers enter the frozen Goal");
assert.equal(preflight.eligibleBindingCount, 4);
assert.equal(preflight.probeContainerCount, 2);
assert.deepEqual(preflight.excludedContainers, [
  { containerId: "REFERENCE", reason: "reference-only", bindingCount: 1 },
  { containerId: "EMPTY", reason: "empty", bindingCount: 0 },
  { containerId: "GENERATING", reason: "generating", bindingCount: 1 },
]);
assert.equal(preflight.sourceAssets.filter((item) => item.assetId === "shared-blob").length, 2, "One blob in two slots must remain two Goal bindings");
assert.equal(new Set(preflight.eligibleBindingIds).size, 4);
assert.deepEqual(preflight.sourceAssets.slice(0, 3).map((item) => item.containerSlot), [0, 1, 2], "Nested bindings retain flattened top-container slots");
assert.deepEqual(preflight.sourceAssets.slice(0, 3).map((item) => item.ownerNodeId), ["CHILD-A", "CHILD-A", "CHILD-B"]);
assert.ok(preflight.sourceAssets.every((item) => item.mimeType === "image/png"));
assert.ok(preflight.sourceAssets.every((item) => item.role === "source"));

const built = buildGoalTaskScopeFromNodes(projectedNodes, {
  canvasRevision: 41,
  configuredConcurrency: 8,
  probeContainerCount: 2,
});
assert.equal(built.ok, true);
if (!built.ok) throw new Error("Valid Goal fixture failed preflight");
const goalScope = built.scope;
assert.equal(goalScope.origin, "goal");
assert.equal(goalScope.scopeType, "container-group");
assert.equal(goalScope.resultPolicy, "grouped-by-container");
assert.equal(goalScope.confirmationPolicy, "staged");
assert.deepEqual(goalScope.sourceContainerIds, ["SUPER", "SOLO"]);
assert.deepEqual(goalScope.goal, {
  version: 1,
  target: "all-image-containers",
  frozen: true,
  containerIds: ["SUPER", "SOLO"],
  bindingIds: goalScope.sourceBindingIds,
  containerCount: 2,
  bindingCount: 4,
  configuredConcurrency: 8,
  probeContainerCount: 2,
  operationsPerAsset: 1,
  requestCount: 4,
});
assert.equal(goalScope.snapshotHash, agentTaskScopeSnapshotHash(goalScope));

const explicitPlain = buildGoalTaskScopeFromNodes(projectedNodes, {
  canvasRevision: 42,
  configuredConcurrency: 4,
  targetNodeIds: [plainImage.id],
});
assert.equal(explicitPlain.ok, true, "An explicitly selected ordinary image must be a valid Goal boundary");
if (!explicitPlain.ok) throw new Error("Explicit ordinary image failed Goal preflight");
assert.deepEqual(explicitPlain.scope.sourceContainerIds, [plainImage.id]);
assert.deepEqual(explicitPlain.scope.sourceNodeIds, [plainImage.id]);
assert.equal(explicitPlain.scope.sourceAssets.length, 1);
assert.ok(!explicitPlain.scope.sourceNodeIds.includes(solo.id), "Unselected images must not leak into an explicit Goal");

const explicitChild = buildGoalTaskScopeFromNodes(projectedNodes, {
  canvasRevision: 43,
  configuredConcurrency: 4,
  targetNodeIds: [childA.id],
});
assert.equal(explicitChild.ok, true, "An explicitly selected nested container must freeze only its own image slots");
if (!explicitChild.ok) throw new Error("Explicit child container failed Goal preflight");
assert.deepEqual(explicitChild.scope.sourceContainerIds, [childA.id]);
assert.equal(explicitChild.scope.sourceAssets.length, 2);
assert.equal(explicitChild.scope.goal?.probeContainerCount, 2, "Two mother images in one container should both be sampled before ramp-up");
assert.ok(explicitChild.scope.sourceAssets.every((item) => item.ownerNodeId === childA.id));

const invalidExplicitTarget = preflightGoalTaskScope(projectedNodes, {
  canvasRevision: 44,
  configuredConcurrency: 4,
  targetNodeIds: [plainImage.id, "MISSING-NODE"],
});
assert.equal(invalidExplicitTarget.ok, false, "A mixed valid/stale explicit target list must fail atomically");
assert.ok(invalidExplicitTarget.issues.some((issue) => issue.code === "invalid-target" && issue.nodeId === "MISSING-NODE"));

const commercePreview = createGoalModePreview({
  prompt: "为选中的母图分别生成三张商品图",
  nodes: projectedNodes,
  canvasRevision: 45,
  configuredConcurrency: 8,
  targetNodeIds: [childA.id, solo.id],
  operationsPerAsset: 3,
  trialImagesRemaining: 2,
  imageCostCents: 10,
});
assert.equal(commercePreview.assetCount, 3);
assert.equal(commercePreview.operationsPerAsset, 3);
assert.equal(commercePreview.requestCount, 9);
assert.equal(commercePreview.taskScope.goal?.operationsPerAsset, 3);
assert.equal(commercePreview.taskScope.goal?.requestCount, 9);
assert.equal(commercePreview.taskScope.goal?.commercePlanHash, undefined);
assert.deepEqual(commercePreview.targetNodeIds, [childA.id, solo.id]);
assert.equal(commercePreview.trialImagesUsed, 2);
assert.equal(commercePreview.paidImages, 7);
assert.equal(commercePreview.estimatedMaxCostCents, 70);
const changedCommerceOperations = createGoalModePreview({
  prompt: commercePreview.prompt,
  nodes: projectedNodes,
  canvasRevision: 45,
  configuredConcurrency: 8,
  targetNodeIds: [childA.id, solo.id],
  operationsPerAsset: 2,
  trialImagesRemaining: 2,
  imageCostCents: 10,
});
assert.notEqual(
  goalModeAuthorizationFingerprint(commercePreview),
  goalModeAuthorizationFingerprint(changedCommerceOperations),
  "Changing operationsPerAsset must invalidate a Goal confirmation"
);
assert.notEqual(commercePreview.snapshotHash, changedCommerceOperations.snapshotHash, "The frozen fee matrix must be material to TaskScope snapshotHash");

const trustedCommerceTask = composeCommerceSetTask({
  sourceCount: 3,
  sourceNodeIds: [childA.id, solo.id],
  plan: { mode: "generate", setSize: 3, targetLocales: [] },
});
const trustedCommercePreview = createGoalModePreview({
  prompt: trustedCommerceTask.prompt,
  nodes: projectedNodes,
  canvasRevision: 45,
  configuredConcurrency: 8,
  targetNodeIds: [childA.id, solo.id],
  operationsPerAsset: trustedCommerceTask.counts.outputsPerSource,
});
assert.equal(trustedCommercePreview.taskScope.goal?.commercePlanHash, trustedCommerceTask.planHash);
assert.equal(trustedCommercePreview.taskScope.goal?.operationsPerAsset, 3);
assert.equal(trustedCommercePreview.taskScope.goal?.requestCount, trustedCommerceTask.counts.totalRequests);
assert.throws(
  () => createGoalModePreview({
    prompt: trustedCommerceTask.prompt,
    nodes: projectedNodes,
    canvasRevision: 45,
    configuredConcurrency: 8,
    targetNodeIds: [childA.id, solo.id],
    operationsPerAsset: 2,
  }),
  /计划要求每张母图 3 个输出|重新预览/,
  "A commerce Goal must derive its frozen operation count from the trusted plan",
);
assert.throws(
  () => createGoalModePreview({
    prompt: trustedCommerceTask.prompt.replace('"outputsPerSource":3', '"outputsPerSource":2'),
    nodes: projectedNodes,
    canvasRevision: 45,
    configuredConcurrency: 8,
    targetNodeIds: [childA.id, solo.id],
    operationsPerAsset: 3,
  }),
  /结构化计划已损坏/,
  "A tampered commerce plan must fail before Goal confirmation",
);
assert.throws(
  () => createGoalModePreview({
    prompt: "超过安全上限",
    nodes: projectedNodes,
    canvasRevision: 45,
    configuredConcurrency: 8,
    targetNodeIds: [superContainer.id, solo.id],
    operationsPerAsset: 51,
  }),
  /最多允许 200 个图片请求|当前计划为 204/,
  "SOURCE×operationsPerAsset must enforce the 200-request ceiling"
);

const concurrencyChanged = structuredClone(goalScope);
if (!concurrencyChanged.goal) throw new Error("Goal metadata missing");
concurrencyChanged.goal.configuredConcurrency = 7;
assert.notEqual(agentTaskScopeSnapshotHash(concurrencyChanged), goalScope.snapshotHash, "Goal execution strategy is material to its hash");
const operationCountChanged = structuredClone(goalScope);
if (!operationCountChanged.goal) throw new Error("Goal metadata missing");
operationCountChanged.goal.operationsPerAsset = 2;
operationCountChanged.goal.requestCount = operationCountChanged.goal.bindingCount * 2;
assert.notEqual(agentTaskScopeSnapshotHash(operationCountChanged), goalScope.snapshotHash, "Frozen operation and request counts are material to the hash");

const clone = cloneAgentTaskScope(goalScope);
if (!clone.goal) throw new Error("Cloned Goal metadata missing");
clone.goal.containerIds.push("MUTATED");
clone.goal.bindingIds.push("binding:mutated");
assert.deepEqual(goalScope.goal?.containerIds, ["SUPER", "SOLO"], "Goal metadata arrays must be deep-cloned");
assert.equal(mergeAgentTaskScopes(goalScope, structuredClone(goalScope)).snapshotHash, goalScope.snapshotHash, "An idempotent same-snapshot merge is allowed");

const ordinaryScope: AgentTaskScope = {
  ...structuredClone(goalScope),
  origin: "canvas",
  goal: undefined,
  snapshotHash: "",
};
ordinaryScope.snapshotHash = agentTaskScopeSnapshotHash(ordinaryScope);
assert.throws(
  () => mergeAgentTaskScopes(goalScope, ordinaryScope),
  /Goal TaskScope 是冻结的全画布容器快照/,
  "A frozen Goal must reject implicit live-scope extension",
);
assert.equal(resolveAgentTaskScopeContinuation(goalScope, ordinaryScope, false).snapshotHash, goalScope.snapshotHash);
assert.throws(
  () => resolveAgentTaskScopeContinuation(goalScope, ordinaryScope, true),
  /不能隐式合并或追加素材/,
  "Explicit attachments require a newly confirmed Goal instead of mutating its boundary",
);
const directGoal = withAgentTaskScopeConfirmationPolicy(goalScope, "direct");
assert.equal(directGoal.goal?.containerIds.join(","), "SUPER,SOLO");
assert.notEqual(directGoal.snapshotHash, goalScope.snapshotHash);

const authorizedPreview = createGoalModePreview({
  prompt: "统一所有商品图的背景与光线",
  nodes: projectedNodes,
  canvasRevision: 41,
  configuredConcurrency: 8,
});
const changedPromptPreview = createGoalModePreview({
  prompt: "把所有商品改成完全不同的主体",
  nodes: projectedNodes,
  canvasRevision: 41,
  configuredConcurrency: 8,
});
assert.equal(authorizedPreview.snapshotHash, changedPromptPreview.snapshotHash, "The frozen canvas scope is unchanged in this fixture");
assert.notEqual(goalModeAuthorizationFingerprint(authorizedPreview), goalModeAuthorizationFingerprint(changedPromptPreview), "Goal authorization must bind the normalized prompt");
let tokenSequence = 1;
const nextToken = () => `goal-${(tokenSequence++).toString(16).padStart(32, "0")}`;
const ledger = createGoalConfirmationLedger(4, { tokenFactory: nextToken });
const confirmationContext = { projectId: "project-goal", conversationId: "conversation-goal", issuerId: "automation" };
const publicAuthorization = ledger.issue(authorizedPreview, confirmationContext);
const publicPreview = publicGoalModePreview({ ...authorizedPreview, confirmationHash: publicAuthorization });
assert.equal(publicPreview.snapshot.snapshotHash, publicAuthorization);
assert.equal(publicPreview.snapshot.taskScopeSnapshotHash, authorizedPreview.snapshotHash);
let authorizedDispatches = 0;
const firstAuthorization = ledger.issue(authorizedPreview, confirmationContext);
assert.notEqual(firstAuthorization, publicAuthorization, "Every preview must receive a fresh bearer even for identical prompt/scope material");
assert.throws(
  () => {
    ledger.consume(changedPromptPreview, firstAuthorization, confirmationContext);
    authorizedDispatches += 1;
  },
  /失效|prompt|不一致/,
  "A confirmation obtained for prompt A must not execute prompt B",
);
assert.equal(authorizedDispatches, 0);
assert.throws(
  () => ledger.consume(authorizedPreview, firstAuthorization, confirmationContext),
  /失效|已使用/,
  "A failed changed-prompt attempt burns the authorization",
);
const validAuthorization = ledger.issue(authorizedPreview, confirmationContext);
ledger.consume(authorizedPreview, validAuthorization, confirmationContext);
authorizedDispatches += 1;
assert.equal(authorizedDispatches, 1);
const reissuedAuthorization = ledger.issue(authorizedPreview, confirmationContext);
assert.notEqual(reissuedAuthorization, validAuthorization, "Re-previewing must never resurrect a consumed bearer");
assert.throws(
  () => ledger.consume(authorizedPreview, validAuthorization, confirmationContext),
  /失效|已使用/,
  "A consumed Goal confirmation cannot be replayed",
);
assert.throws(
  () => ledger.consume(authorizedPreview, reissuedAuthorization, confirmationContext),
  /失效|已使用/,
  "A replay attempt must revoke the issuer's current matching preview",
);
const crossProjectAuthorization = ledger.issue(authorizedPreview, confirmationContext);
assert.throws(
  () => ledger.consume(authorizedPreview, crossProjectAuthorization, { ...confirmationContext, projectId: "other-project" }),
  /失效|不一致/,
  "A Goal confirmation cannot cross the project boundary",
);
assert.equal(ledger.size(), 0);

const changedCostPreview = createGoalModePreview({
  prompt: authorizedPreview.prompt,
  nodes: projectedNodes,
  canvasRevision: 41,
  configuredConcurrency: 8,
  trialImagesRemaining: 0,
  imageCostCents: 25,
});
const quotedPreview = createGoalModePreview({
  prompt: authorizedPreview.prompt,
  nodes: projectedNodes,
  canvasRevision: 41,
  configuredConcurrency: 8,
  trialImagesRemaining: changedCostPreview.assetCount,
  imageCostCents: 25,
});
assert.equal(changedCostPreview.snapshotHash, quotedPreview.snapshotHash);
assert.notEqual(goalModeAuthorizationFingerprint(changedCostPreview), goalModeAuthorizationFingerprint(quotedPreview));
const quoteAuthorization = ledger.issue(quotedPreview, confirmationContext);
assert.throws(
  () => ledger.consume(changedCostPreview, quoteAuthorization, confirmationContext),
  /费用报价|变化/,
  "A changed paid/trial quote must require a new confirmation",
);

let clock = 1_000;
const ttlLedger = createGoalConfirmationLedger(4, {
  ttlMs: 50,
  now: () => clock,
  tokenFactory: () => "goal-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
});
const ttlAuthorization = ttlLedger.issue(authorizedPreview, confirmationContext);
clock += 51;
assert.throws(
  () => ttlLedger.consume(authorizedPreview, ttlAuthorization, confirmationContext),
  /失效|过期/,
  "Expired Goal confirmations must not execute",
);

const canceledLedger = createGoalConfirmationLedger(4, { tokenFactory: () => "goal-cccccccccccccccccccccccccccccccc" });
const canceledAuthorization = canceledLedger.issue(authorizedPreview, confirmationContext);
canceledLedger.invalidate(canceledAuthorization);
assert.throws(
  () => canceledLedger.consume(authorizedPreview, canceledAuthorization, confirmationContext),
  /失效|已使用/,
  "Closing/canceling a preview must revoke its bearer",
);

const rendererALedger = createGoalConfirmationLedger(4, { tokenFactory: () => "goal-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
const rendererBLedger = createGoalConfirmationLedger(4, { tokenFactory: () => "goal-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
const rendererAToken = rendererALedger.issue(authorizedPreview, confirmationContext);
const rendererBToken = rendererBLedger.issue(authorizedPreview, confirmationContext);
assert.notEqual(rendererAToken, rendererBToken, "Separate Renderers must not mint the same executable bearer");
assert.throws(
  () => rendererBLedger.consume(authorizedPreview, rendererAToken, confirmationContext),
  /失效|已使用/,
  "A bearer issued by Renderer A must not execute in Renderer B",
);
rendererALedger.consume(authorizedPreview, rendererAToken, confirmationContext);

const overLimitNodes = Array.from({ length: MAX_GOAL_TASK_SCOPE_BINDINGS + 1 }, (_item, index) => container(
  `LIMIT-${index + 1}`,
  [asset(`limit-${index + 1}`, index, {
    occurrenceId: undefined,
    path: `E:/projects/goal/assets/limit-${index + 1}.png`,
  })],
));
const overLimit = buildGoalTaskScopeFromNodes(overLimitNodes, { canvasRevision: 1, configuredConcurrency: 10 });
assert.equal(overLimit.ok, false);
assert.ok(overLimit.preflight.issues.some((issue) => issue.code === "too-many-bindings"));
assert.equal(overLimit.preflight.eligibleBindingCount, MAX_GOAL_TASK_SCOPE_BINDINGS + 1, "The preflight must count instead of truncating before rejection");

const missingIdentity = container("MISSING-ID", [{
  type: "file",
  path: "E:/projects/goal/assets/missing-id.png",
  index: 1,
}]);
const missingLocator = container("MISSING-PATH", [asset("missing-path", 1, {
  path: undefined,
  relativePath: undefined,
  assetUrl: undefined,
  url: undefined,
})]);
const invalidAssets = preflightGoalTaskScope([missingIdentity, missingLocator], {
  canvasRevision: 1,
  configuredConcurrency: 2,
});
assert.equal(invalidAssets.ok, false);
assert.ok(invalidAssets.issues.some((issue) => issue.code === "missing-asset-identity" && issue.containerId === "MISSING-ID"));
assert.ok(invalidAssets.issues.some((issue) => issue.code === "missing-asset-locator" && issue.containerId === "MISSING-PATH"));

const duplicateBindingId = "binding:duplicate-across-containers";
const duplicateAAsset = asset("duplicate-a", 0, { occurrenceId: occurrence("1") });
const duplicateBAsset = asset("duplicate-b", 0, { occurrenceId: occurrence("2") });
const duplicateA = container("DUPLICATE-A", [duplicateAAsset], {
  imageContainerSpec: spec("manual", [], [], { memberBindings: [{
    bindingId: duplicateBindingId,
    assetId: duplicateAAsset.assetId!,
    occurrenceId: duplicateAAsset.occurrenceId,
    nodeId: "DUPLICATE-A",
    containerNodeId: "DUPLICATE-A",
    assetIndex: 0,
  }] }),
});
const duplicateB = container("DUPLICATE-B", [duplicateBAsset], {
  imageContainerSpec: spec("manual", [], [], { memberBindings: [{
    bindingId: duplicateBindingId,
    assetId: duplicateBAsset.assetId!,
    occurrenceId: duplicateBAsset.occurrenceId,
    nodeId: "DUPLICATE-B",
    containerNodeId: "DUPLICATE-B",
    assetIndex: 0,
  }] }),
});
const duplicate = preflightGoalTaskScope([duplicateA, duplicateB], { canvasRevision: 1, configuredConcurrency: 2 });
assert.equal(duplicate.ok, false);
assert.ok(duplicate.issues.some((issue) => issue.code === "duplicate-binding-id"));
assert.equal(duplicate.eligibleBindingCount, 2, "A binding collision is rejected, never silently deduplicated");

const invalidStrategy = preflightGoalTaskScope([solo], {
  canvasRevision: 1,
  configuredConcurrency: 11,
  probeContainerCount: 2,
});
assert.equal(invalidStrategy.ok, false);
assert.ok(invalidStrategy.issues.some((issue) => issue.code === "invalid-concurrency"));
assert.ok(invalidStrategy.issues.some((issue) => issue.code === "invalid-probe-count"));

process.stdout.write(`${JSON.stringify({
  ok: true,
  topLevelContainerDeduplication: true,
  excludedUnsafeContainers: true,
  bindingSlotsPreserved: true,
  goalHashMaterial: true,
  promptBoundOneTimeConfirmation: true,
  frozenMergeGuard: true,
  hardLimitRejected: true,
  missingIdentityAndLocatorRejected: true,
  duplicateBindingRejected: true,
})}\n`);
