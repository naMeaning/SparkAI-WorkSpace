import assert from "node:assert/strict";
import {
  agentTaskScopeSnapshotHash,
  type AgentTaskScope
} from "../src/core.ts";
import {
  resolveAgentTaskScopeContinuation,
  withAgentTaskScopeConfirmationPolicy
} from "../src/task-scope.ts";

type ScopeInput = Omit<AgentTaskScope, "snapshotHash"> & {
  diagnosticCanvasPosition?: { x: number; y: number };
};

const base: ScopeInput = {
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
  structuredPolicyApplied: true
})}\n`);
