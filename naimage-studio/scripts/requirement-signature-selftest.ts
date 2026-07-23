import assert from "node:assert/strict";

import {
  validatePendingRequirementContinuation,
  type ImageAsset,
  type ImageLayerNodeGroup,
  type PendingAgentExecution,
  type WorkflowNode,
} from "../src/core.ts";
import { stableRequirementInputSignature, stableRequirementSourceSignature } from "../src/requirement-signature.ts";

const asset = (id: string, role: "source" | "reference" = "source"): ImageAsset => ({
  assetId: id,
  contentHash: id.padEnd(64, "a").slice(0, 64),
  taskRole: role,
  index: 1,
  type: "file",
  path: `C:/project/${id}.png`,
});

const node = (id: string, assets: ImageAsset[], extra: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  title: id,
  prompt: id,
  type: "image",
  status: "done",
  x: 0,
  y: 0,
  branch: "basic",
  outputs: assets.length,
  createdAt: "2026-07-19T00:00:00.000Z",
  assets,
  imageState: "done",
  ...extra,
});

const layer = (id: string, order: number, overrides: Partial<ImageLayerNodeGroup> = {}): ImageLayerNodeGroup => ({
  id: "layer-group",
  groupNumber: 1,
  total: 2,
  order,
  layerId: id,
  layerTitle: id,
  role: "foreground",
  compositionWidth: 1024,
  compositionHeight: 1024,
  anchorX: 0,
  anchorY: 0,
  detached: false,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  ...overrides,
});

const copiedA = node("A", [asset("content-one")]);
const copiedB = node("totally-different-host-id", [asset("content-one")]);
assert.equal(
  stableRequirementSourceSignature(copiedA),
  stableRequirementSourceSignature(copiedB),
  "Copying the same source to another node must not bypass unchanged-input confirmation",
);

const containerA = node("HOST-A", [asset("content-one"), asset("content-two")], {
  imageContainer: true,
  imageContainerSpec: { version: 1, kind: "folder", memberNodeIds: ["member-a"], childContainerNodeIds: [], memberBindings: [], layoutOrigin: "manual", autoFit: true },
});
const containerB = node("HOST-B", [asset("content-one"), asset("content-two")], {
  imageContainer: true,
  imageContainerSpec: { version: 1, kind: "folder", memberNodeIds: ["member-b"], childContainerNodeIds: [], memberBindings: [], layoutOrigin: "manual", autoFit: true },
});
assert.equal(stableRequirementSourceSignature(containerA), stableRequirementSourceSignature(containerB));
assert.notEqual(
  stableRequirementSourceSignature(containerA),
  stableRequirementSourceSignature({ ...containerB, assets: [...containerB.assets!].reverse() }),
  "Changing container presentation order must change the reusable input fingerprint",
);
assert.notEqual(
  stableRequirementSourceSignature(containerA),
  stableRequirementSourceSignature({ ...containerB, assets: [asset("content-one"), asset("content-two", "reference")] }),
  "Changing SOURCE/REFERENCE roles must change the reusable input fingerprint",
);

const folderNode = (id: string, assets: ImageAsset[]): WorkflowNode => node(id, assets, {
  imageContainer: true,
  imageContainerSpec: {
    version: 1,
    kind: "folder",
    memberNodeIds: [],
    childContainerNodeIds: [],
    memberBindings: [],
    layoutOrigin: "manual",
    autoFit: true,
  },
});
const superContainer = (id: string, childContainerNodeIds: string[]): WorkflowNode => node(id, [], {
  imageContainer: true,
  imageContainerSpec: {
    version: 1,
    kind: "container-group",
    memberNodeIds: [],
    childContainerNodeIds,
    memberBindings: [],
    layoutOrigin: "manual",
    autoFit: true,
  },
});
const folderA1 = folderNode("folder-a1", [asset("content-one"), asset("content-two")]);
const folderA2 = folderNode("folder-a2", [asset("content-three"), asset("content-four")]);
const groupedA = superContainer("super-a", [folderA1.id, folderA2.id]);
const folderCopy1 = folderNode("copied-folder-1", [asset("content-one"), asset("content-two")]);
const folderCopy2 = folderNode("copied-folder-2", [asset("content-three"), asset("content-four")]);
const groupedCopy = superContainer("copied-super", [folderCopy1.id, folderCopy2.id]);
assert.equal(
  stableRequirementSourceSignature(groupedA, [groupedA, folderA1, folderA2]),
  stableRequirementSourceSignature(groupedCopy, [groupedCopy, folderCopy1, folderCopy2]),
  "Copying the same nested folder structure must preserve the reusable input fingerprint",
);
const regrouped1 = folderNode("regrouped-1", [asset("content-one"), asset("content-three")]);
const regrouped2 = folderNode("regrouped-2", [asset("content-two"), asset("content-four")]);
const regrouped = superContainer("regrouped-super", [regrouped1.id, regrouped2.id]);
assert.notEqual(
  stableRequirementSourceSignature(groupedA, [groupedA, folderA1, folderA2]),
  stableRequirementSourceSignature(regrouped, [regrouped, regrouped1, regrouped2]),
  "Redistributing identical flat assets across child folders must count as a changed source",
);
const reorderedGroupedA: WorkflowNode = {
  ...groupedA,
  imageContainerSpec: { ...groupedA.imageContainerSpec!, childContainerNodeIds: [folderA2.id, folderA1.id] },
};
assert.notEqual(
  stableRequirementSourceSignature(groupedA, [groupedA, folderA1, folderA2]),
  stableRequirementSourceSignature(reorderedGroupedA, [reorderedGroupedA, folderA1, folderA2]),
  "Changing child-folder execution order must count as a changed source",
);

const background = node("L1", [asset("layer-background")], { layerGroup: layer("background", 1) });
const foreground = node("L2", [asset("layer-foreground")], { layerGroup: layer("foreground", 2) });
const baseLayerSignature = stableRequirementSourceSignature(background, [background, foreground]);
assert.notEqual(
  baseLayerSignature,
  stableRequirementSourceSignature(background, [background, { ...foreground, layerGroup: { ...foreground.layerGroup!, visible: false } }]),
);
assert.notEqual(
  baseLayerSignature,
  stableRequirementSourceSignature(background, [background, { ...foreground, layerGroup: { ...foreground.layerGroup!, opacity: 0.5 } }]),
);
assert.notEqual(
  baseLayerSignature,
  stableRequirementSourceSignature(background, [background, { ...foreground, layerGroup: { ...foreground.layerGroup!, blendMode: "multiply" } }]),
);
assert.notEqual(
  baseLayerSignature,
  stableRequirementSourceSignature(background, [
    { ...background, layerGroup: { ...background.layerGroup!, order: 2 } },
    { ...foreground, layerGroup: { ...foreground.layerGroup!, order: 1 } },
  ]),
);

const requirementNode: WorkflowNode = {
  id: "REQ",
  title: "Reusable requirement",
  prompt: "Replace the product color",
  type: "requirement",
  status: "done",
  x: 0,
  y: 0,
  parentId: "A",
  branch: "project-agent",
  outputs: 0,
  createdAt: "2026-07-19T00:00:00.000Z",
  requirement: {
    version: 1,
    text: "Replace the product color",
    revision: 3,
    createdFrom: "node",
  },
};
const pending: PendingAgentExecution = {
  version: 2,
  requestId: "ask-1",
  projectId: "project-1",
  conversationId: "conversation-1",
  originalPrompt: requirementNode.requirement!.text,
  sourceNodeIds: ["A"],
  focusedNodeId: "A",
  taskOrigin: "requirement",
  taskScope: {
    version: 2,
    origin: "requirement",
    sourceNodeIds: ["A"],
    sourceAssets: [{
      bindingId: "binding:A:A:content-one:1",
      assetId: "content-one",
      displayCode: "A1",
      role: "source",
      name: "source",
      nodeId: "A",
      ownerNodeId: "A",
      ownerAssetIndex: 0,
      containerSlot: 0,
      assetIndex: 0,
      path: "C:/project/content-one.png",
    }],
    referenceAssets: [],
  },
  requirementNodeId: "REQ",
  requirementRevision: 3,
  requirementSourceNodeId: "A",
  requirementSourceSignature: stableRequirementSourceSignature(copiedA),
  kind: "reference_images",
  title: "Add references",
  question: "Add a reference image",
  createdAt: "2026-07-19T00:00:00.000Z",
};
assert.deepEqual(
  validatePendingRequirementContinuation(pending, requirementNode, "A", pending.requirementSourceSignature!),
  { ok: true },
);
assert.deepEqual(
  validatePendingRequirementContinuation(pending, null, "A", pending.requirementSourceSignature!),
  { ok: false, issue: "missing-requirement" },
);
assert.deepEqual(
  validatePendingRequirementContinuation({ ...pending, requirementRevision: undefined }, requirementNode, "A", pending.requirementSourceSignature!),
  { ok: false, issue: "missing-snapshot" },
);
assert.deepEqual(
  validatePendingRequirementContinuation(pending, { ...requirementNode, requirement: { ...requirementNode.requirement!, revision: 4 } }, "A", pending.requirementSourceSignature!),
  { ok: false, issue: "revision-changed" },
);
assert.deepEqual(
  validatePendingRequirementContinuation(pending, { ...requirementNode, parentId: "B" }, "B", pending.requirementSourceSignature!),
  { ok: false, issue: "source-binding-changed" },
);
assert.deepEqual(
  validatePendingRequirementContinuation(pending, requirementNode, "A", stableRequirementSourceSignature(node("A", [asset("changed-content")]))),
  { ok: false, issue: "source-content-changed" },
);

const referenceNode = node("REF", [asset("reference-content", "reference")]);
const multiRequirementNode: WorkflowNode = {
  ...requirementNode,
  requirement: {
    ...requirementNode.requirement!,
    version: 2,
    inputBindings: [
      { nodeId: copiedA.id, role: "source" },
      { nodeId: referenceNode.id, role: "reference" },
    ],
  },
};
const multiNodes = [copiedA, referenceNode, multiRequirementNode];
const multiSignature = stableRequirementInputSignature(multiRequirementNode, multiNodes);
const multiPending: PendingAgentExecution = {
  ...pending,
  sourceNodeIds: [copiedA.id, referenceNode.id],
  requirementInputNodeIds: [copiedA.id, referenceNode.id],
  requirementInputSignature: multiSignature,
  requirementSourceNodeId: undefined,
  requirementSourceSignature: undefined,
};
assert.deepEqual(
  validatePendingRequirementContinuation(multiPending, multiRequirementNode, [copiedA.id, referenceNode.id], multiSignature),
  { ok: true },
);
assert.deepEqual(
  validatePendingRequirementContinuation(multiPending, multiRequirementNode, [referenceNode.id, copiedA.id], multiSignature),
  { ok: false, issue: "source-binding-changed" },
);
const changedReference = node("REF", [asset("changed-reference", "reference")]);
assert.deepEqual(
  validatePendingRequirementContinuation(
    multiPending,
    multiRequirementNode,
    [copiedA.id, changedReference.id],
    stableRequirementInputSignature(multiRequirementNode, [copiedA, changedReference, multiRequirementNode]),
  ),
  { ok: false, issue: "source-content-changed" },
);

console.log("requirement-signature selftest passed (host, order, role, folder-boundary, layer-state, single-and-multi-input-pending-continuation)");
