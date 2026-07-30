import assert from "node:assert/strict";
import type { CanvasRequirement, WorkflowNode } from "../src/core.ts";
import {
  primaryRequirementInputNodeId,
  removeRequirementInputBindings,
  requirementInputBindings,
  requirementInputRoleMap,
  sanitizeRequirementInputBindings,
  upsertRequirementInputBinding,
} from "../src/requirement-graph.ts";
import { stableRequirementInputSignature } from "../src/requirement-signature.ts";
import {
  connectCanvasRelations,
  disconnectCanvasRelations,
} from "../src/canvas-relation-graph.ts";

const image = (id: string, role?: "source" | "reference", content = id): WorkflowNode => ({
  id,
  title: id,
  prompt: "",
  type: "image",
  status: "done",
  x: 0,
  y: 0,
  branch: "test",
  outputs: 1,
  createdAt: "2026-07-20T00:00:00.000Z",
  imageContainer: true,
  imageContainerRole: role,
  assets: [{
    assetId: `${content}-asset`,
    contentHash: content.padEnd(64, "a").slice(0, 64),
    displayCode: `${id}1`,
    taskRole: role,
    type: "file",
    path: `C:/project/${content}.png`,
    status: "done",
  }],
});

const requirement = (inputBindings: CanvasRequirement["inputBindings"] = []): WorkflowNode => ({
  id: "REQ",
  title: "Reusable requirement",
  prompt: "Create a product variant",
  type: "requirement",
  status: "done",
  x: 400,
  y: 0,
  branch: "project-agent",
  outputs: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  requirement: {
    version: 2,
    text: "Create a product variant",
    revision: 1,
    createdFrom: "canvas",
    inputBindings,
  },
});

const source = image("SRC", "source", "source-one");
const reference = image("REF", "reference", "reference-one");
const legacy = { ...requirement(undefined), parentId: reference.id, requirement: { ...requirement(undefined).requirement!, version: 1 as const, inputBindings: undefined } };
assert.deepEqual(requirementInputBindings(legacy, [source, reference, legacy]), [{ nodeId: "REF", role: "reference" }]);

assert.deepEqual(sanitizeRequirementInputBindings([
  { nodeId: "SRC", role: "source" },
  { nodeId: "SRC", role: "reference" },
  { nodeId: "REF", role: "reference" },
  { nodeId: "", role: "source" },
]), [
  { nodeId: "SRC", role: "source" },
  { nodeId: "REF", role: "reference" },
]);

let model = requirement().requirement!;
model = upsertRequirementInputBinding(model, { nodeId: source.id, role: "source" });
model = upsertRequirementInputBinding(model, { nodeId: reference.id, role: "reference" });
const graph = { ...requirement(model.inputBindings), requirement: model };
assert.deepEqual(requirementInputBindings(graph, [source, reference, graph]), [
  { nodeId: "SRC", role: "source" },
  { nodeId: "REF", role: "reference" },
]);
assert.equal(primaryRequirementInputNodeId(model.inputBindings!), "SRC");
assert.deepEqual(requirementInputRoleMap(graph, [source, reference, graph]), { SRC: "source", REF: "reference" });

const signature = stableRequirementInputSignature(graph, [source, reference, graph]);
const roleChangedRequirement = { ...graph, requirement: upsertRequirementInputBinding(model, { nodeId: reference.id, role: "source" }) };
assert.notEqual(stableRequirementInputSignature(roleChangedRequirement, [source, reference, roleChangedRequirement]), signature);
const contentChangedSource = image("SRC", "source", "source-two");
assert.notEqual(stableRequirementInputSignature(graph, [contentChangedSource, reference, graph]), signature);

const removed = removeRequirementInputBindings(model, new Set([source.id]));
assert.deepEqual(removed.inputBindings, [{ nodeId: "REF", role: "reference" }]);
assert.equal(primaryRequirementInputNodeId(removed.inputBindings!), "REF");

const connected = connectCanvasRelations([source, reference, requirement([{ nodeId: "SRC", role: "source" }])], [{
  sourceId: "REF",
  targetId: "REQ",
  relationType: "referenced",
  inputRole: "reference",
}]);
const connectedRequirement = connected.nodes.find((node) => node.id === "REQ")!;
assert.equal(connectedRequirement.requirement?.revision, 2, "Relation edits participate in Requirement revision CAS");
assert.deepEqual(requirementInputBindings(connectedRequirement, connected.nodes), [
  { nodeId: "SRC", role: "source" },
  { nodeId: "REF", role: "reference" },
]);
const disconnected = disconnectCanvasRelations(connected.nodes, [{ sourceId: "SRC", targetId: "REQ" }]);
const disconnectedRequirement = disconnected.nodes.find((node) => node.id === "REQ")!;
assert.equal(disconnectedRequirement.requirement?.revision, 3);
assert.equal(disconnectedRequirement.parentId, "REF", "Primary compatibility parent must be recomputed after an exact disconnect");

const idempotent = connectCanvasRelations(connected.nodes, [{ sourceId: "REF", targetId: "REQ", relationType: "referenced", inputRole: "reference" }]);
assert.equal(idempotent.changed, false);
assert.equal(idempotent.nodes.find((node) => node.id === "REQ")?.requirement?.revision, 2);

assert.throws(
  () => connectCanvasRelations([source, reference, requirement()], [
    { sourceId: "SRC", targetId: "REQ", inputRole: "source" },
    { sourceId: "SRC", targetId: "REQ", inputRole: "reference" },
  ]),
  (error: unknown) => (error as { code?: string }).code === "INVALID_ARGUMENT",
  "Conflicting duplicate edges must fail instead of silently taking the first entry",
);
assert.throws(
  () => connectCanvasRelations([source, requirement()], [{ sourceId: "SRC", targetId: "REQ", relationType: "variant", inputRole: "source" }]),
  (error: unknown) => (error as { code?: string }).code === "INVALID_ARGUMENT",
  "Requirement inputs must not silently normalize an explicit incompatible relation type",
);

const cycleRequirement = requirement([{ nodeId: "SRC", role: "source" }]);
const cycleChild = image("CHILD", "source", "child");
cycleChild.parentId = "REQ";
cycleChild.relationType = "derived-from";
const cycleSnapshot = JSON.stringify([source, cycleChild, cycleRequirement]);
assert.throws(
  () => connectCanvasRelations([source, cycleChild, cycleRequirement], [{ sourceId: "CHILD", targetId: "REQ", inputRole: "source" }]),
  (error: unknown) => (error as { code?: string }).code === "GRAPH_CYCLE",
  "Cycle detection must include every Requirement input, not only its primary compatibility parent",
);
assert.equal(JSON.stringify([source, cycleChild, cycleRequirement]), cycleSnapshot, "A failed batch must not mutate its source snapshot");
const stagedBatchSource = [source, reference, cycleChild, cycleRequirement];
const stagedBatchSnapshot = JSON.stringify(stagedBatchSource);
assert.throws(
  () => connectCanvasRelations(stagedBatchSource, [
    { sourceId: "REF", targetId: "SRC", relationType: "referenced" },
    { sourceId: "CHILD", targetId: "REQ", inputRole: "source" },
  ]),
  (error: unknown) => (error as { code?: string }).code === "GRAPH_CYCLE",
  "A later invalid edge must roll back an earlier valid edge in the same staged batch",
);
assert.equal(JSON.stringify(stagedBatchSource), stagedBatchSnapshot);
assert.equal(source.parentId, undefined);

const ordinaryTarget = image("TARGET", "source", "target");
ordinaryTarget.parentId = "SRC";
ordinaryTarget.relationType = "derived-from";
assert.throws(
  () => connectCanvasRelations([source, reference, ordinaryTarget], [{ sourceId: "REF", targetId: "TARGET" }]),
  (error: unknown) => (error as { code?: string }).code === "RELATION_CONFLICT",
);
const replaced = connectCanvasRelations(
  [source, reference, ordinaryTarget],
  [{ sourceId: "REF", targetId: "TARGET", relationType: "referenced" }],
  { replaceExisting: true },
);
assert.equal(replaced.nodes.find((node) => node.id === "TARGET")?.parentId, "REF");

console.log(JSON.stringify({
  ok: true,
  legacyFallback: true,
  duplicateProtection: true,
  multiInputRoles: true,
  roleSensitiveSignature: true,
  contentSensitiveSignature: true,
  removalStable: true,
  relationRevisionCas: true,
  exactDisconnect: true,
  atomicCycleRejection: true,
}));
