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

console.log(JSON.stringify({
  ok: true,
  legacyFallback: true,
  duplicateProtection: true,
  multiInputRoles: true,
  roleSensitiveSignature: true,
  contentSensitiveSignature: true,
  removalStable: true,
}));
