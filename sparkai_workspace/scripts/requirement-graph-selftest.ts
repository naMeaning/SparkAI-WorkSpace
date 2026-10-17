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
  canvasRelationCurvePath,
  canvasRelationCurveIntersectsRect,
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

const ordinaryMismatchSnapshot = JSON.stringify([source, reference, ordinaryTarget]);
assert.throws(
  () => disconnectCanvasRelations(
    [source, reference, ordinaryTarget],
    [{ sourceId: "SRC", targetId: "TARGET", relationType: "referenced" }],
  ),
  (error: unknown) => (error as { code?: string }).code === "RELATION_CONFLICT",
  "An exact ordinary-edge disconnect must reject a stale relation type",
);
assert.equal(
  JSON.stringify([source, reference, ordinaryTarget]),
  ordinaryMismatchSnapshot,
  "A relation-type mismatch must not mutate the source snapshot",
);

const requirementMismatchSnapshot = JSON.stringify(connected.nodes);
assert.throws(
  () => disconnectCanvasRelations(connected.nodes, [{
    sourceId: "REF",
    targetId: "REQ",
    relationType: "referenced",
    inputRole: "source",
  }]),
  (error: unknown) => (error as { code?: string }).code === "RELATION_CONFLICT",
  "A Requirement disconnect must reject a stale input role",
);
assert.equal(
  JSON.stringify(connected.nodes),
  requirementMismatchSnapshot,
  "An input-role mismatch must not mutate the source snapshot",
);

const replacedSnapshot = JSON.stringify(replaced.nodes);
assert.throws(
  () => disconnectCanvasRelations(replaced.nodes, [{
    sourceId: "SRC",
    targetId: "TARGET",
    relationType: "derived-from",
  }]),
  (error: unknown) => (error as { code?: string }).code === "RELATION_CONFLICT",
  "A menu opened for an old edge must not delete the replacement edge",
);
assert.equal(JSON.stringify(replaced.nodes), replacedSnapshot, "A stale menu edge must leave the replacement snapshot untouched");
assert.deepEqual(
  replaced.nodes.find((node) => node.id === "TARGET"),
  { ...ordinaryTarget, parentId: "REF", relationType: "referenced" },
);

const exactOrdinaryDisconnect = disconnectCanvasRelations(replaced.nodes, [{
  sourceId: "REF",
  targetId: "TARGET",
  relationType: "referenced",
}]);
assert.equal(exactOrdinaryDisconnect.changed, true);
assert.equal(exactOrdinaryDisconnect.nodes.find((node) => node.id === "TARGET")?.parentId, undefined);
assert.equal(exactOrdinaryDisconnect.nodes.find((node) => node.id === "TARGET")?.relationType, undefined);

assert.equal(canvasRelationCurvePath({ x: 0, y: 10 }, { x: 100, y: 30 }, 20), "M 0 10 C 50 30, 50 50, 100 30");
const curveHits = canvasRelationCurveIntersectsRect;
assert.equal(curveHits({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, { x: 40, y: 95, width: 20, height: 5 }), false, "control hull intersection alone does not imply a visible curve");
assert.equal(curveHits({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, { x: 40, y: 70, width: 20, height: 10 }), true, "curve enters the viewport with both endpoints offscreen");
assert.equal(curveHits({ x: 100, y: 0 }, { x: 0, y: 0 }, -100, { x: 40, y: -76, width: 20, height: 6 }), true, "reverse-X and negative lane");
assert.equal(curveHits({ x: 50, y: -100 }, { x: 50, y: 100 }, 200, { x: 49, y: 150, width: 2, height: 1 }), true, "vertical curve includes its Y extrema");
assert.equal(curveHits({ x: 50, y: -100 }, { x: 50, y: 100 }, 200, { x: 51, y: 150, width: 2, height: 1 }), false, "vertical curve outside viewport X");
let randomState = 17, sampledVisibleCurves = 0;
const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
for (let caseIndex = 0; caseIndex < 3000; caseIndex++) {
  const source = { x: random() * 20000 - 10000, y: random() * 20000 - 10000 };
  const target = { x: caseIndex % 13 ? random() * 20000 - 10000 : source.x, y: random() * 20000 - 10000 };
  const lane = random() * 34000 - 17000;
  const rect = { x: random() * 16000 - 8000, y: random() * 16000 - 8000, width: 20 + random() * 4000, height: 20 + random() * 4000 };
  // Independent Bernstein sampling checks that visible points are never culled.
  for (let index = 0; index <= 512; index++) {
    const t = index / 512, u = 1 - t, mid = (source.x + target.x) / 2;
    const x = u ** 3 * source.x + 3 * u * u * t * mid + 3 * u * t * t * mid + t ** 3 * target.x;
    const y = u ** 3 * source.y + 3 * u * u * t * (source.y + lane) + 3 * u * t * t * (target.y + lane) + t ** 3 * target.y;
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      assert.equal(curveHits(source, target, lane, rect), true, `visible curve ${caseIndex} must remain rendered`);
      sampledVisibleCurves++; break;
    }
  }
}
assert.ok(sampledVisibleCurves > 200);

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
  exactDisconnectConflictProtection: true,
  staleMenuProtection: true,
  atomicCycleRejection: true,
  curveVisibility: true,
  sampledVisibleCurves,
}));
