"use strict";

const assert = require("node:assert/strict");
const { normalizedTaskScope, taskScopeForPrompt } = require("../agent-runtime.cjs");

const materials = [
  { bindingId: "bind-a", assetId: "asset-a", nodeId: "node-a", name: "portrait", role: "source", purpose: "edit target" },
  { bindingId: "bind-b", assetId: "asset-b", nodeId: "node-b", name: "style", role: "reference", purpose: "visual language" },
  { bindingId: "bind-c", assetId: "asset-c", nodeId: "node-c", name: "product", role: "source", purpose: "geometry" }
];

const scope = normalizedTaskScope({
  taskScope: { origin: "chat", scopeType: "multi-source", materials, sourceNodeIds: ["node-a", "node-b", "node-c"] }
});
assert.equal(scope.materials.length, 3);
assert.deepEqual(scope.materials.map((item) => item.assetId), ["asset-a", "asset-b", "asset-c"]);
assert.equal(scope.sourceAssets.length, 3, "ordinary tasks expose all materials for model selection");
assert.equal(scope.referenceAssets.length, 1, "legacy reference projection remains compatible");
const prompt = taskScopeForPrompt({ taskScope: { origin: "chat", materials } }).text;
assert.match(prompt, /materials \(model decides each role\)/);
assert.doesNotMatch(prompt, /SOURCE[^(]*\(needs processing\)/);
assert.match(prompt, /asset-a/);

const legacy = normalizedTaskScope({
  taskScope: { origin: "chat", sourceAssets: [materials[0]], referenceAssets: [materials[1]] }
});
assert.equal(legacy.materials.length, 2, "legacy sessions migrate into canonical materials");
assert.equal(legacy.sourceAssets.length, 2);
assert.equal(legacy.referenceAssets.length, 1);

const goal = normalizedTaskScope({
  taskScope: { origin: "goal", sourceAssets: [materials[0]], referenceAssets: [materials[1]], goal: { target: "all-image-containers", frozen: true, containerIds: ["container-a"], bindingIds: ["bind-a"], operationsPerAsset: 1, requestCount: 1 } }
});
assert.equal(goal.sourceAssets.length, 1);
assert.equal(goal.materials.length, 2);
assert.equal(goal.referenceAssets.length, 1);
console.log(JSON.stringify({ ok: true, cases: 10, canonicalMaterials: true, legacyProjection: true, goalFreezeProjection: true }));
