import assert from "node:assert/strict";
import { locateCreationTarget, submitCreationRegionRevision, type CreationRegionRevisionDraft } from "../src/creation-region-revision.ts";
import type { WorkflowNode } from "../src/core.ts";
import type { CreationRevisionInput } from "../src/creation-session.ts";

const target = { assetId: "asset-original", occurrenceId: "occ-original", contentHash: "a".repeat(64) };
const mask = { assetId: "mask-region", occurrenceId: "occ-mask", contentHash: "b".repeat(64) };
const original = { ...target, path: "managed-original.png" };
const nodes = [{ id: "N1", type: "image", assets: [{ ...original, occurrenceId: "occ-other" }, original] }] as WorkflowNode[];
assert.equal(locateCreationTarget(nodes, target)?.assetIndex, 1);
nodes[0].assets!.reverse();
assert.equal(locateCreationTarget(nodes, target)?.assetIndex, 0);
nodes[0].id = "moved-container";
assert.equal(locateCreationTarget(nodes, target)?.node.id, "moved-container");
nodes[0].assets![0] = { ...original, contentHash: "c".repeat(64) };
assert.equal(locateCreationTarget(nodes, target), null);

const draft: CreationRegionRevisionDraft = { submissionId: "region-once", input: {
  expectedProjectId: "project", conversationId: "conversation", requirementId: "requirements", expectedRevision: 3,
  target, preserve: ["保留主体"], changes: []
} };
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
let saves = 0;
const requests: CreationRevisionInput[] = [];
const input = {
  projectId: "project", conversationId: "conversation", prompt: "只改变所涂背景", dataUrl: "managed-mask-fixture",
  saveMask: async () => { saves++; await gate; return { ok: true, mask }; },
  execute: async (request: CreationRevisionInput) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) throw new Error("local lost response");
    return { ok: true, accepted: true };
  }
};
const first = submitCreationRegionRevision(draft, input);
const repeated = submitCreationRegionRevision(draft, input);
assert.equal(first, repeated, "same click shares the admission, including managed mask identity");
await assert.rejects(submitCreationRegionRevision(draft, { ...input, prompt: "不同修改" }), /正在提交/);
release();
await assert.rejects(first, /lost response/);
assert.equal(saves, 1);
assert.equal(requests.length, 1);
await submitCreationRegionRevision(draft, input);
assert.equal(saves, 1, "lost response must not create another mask/submission");
assert.deepEqual(requests[0], requests[1]);
assert.equal(requests[1].submissionId, "region-once");
assert.deepEqual(requests[1].targets[0].mask, mask);
await assert.rejects(submitCreationRegionRevision(draft, { ...input, prompt: "偷偷改写原提交" }), /已冻结/);
await assert.rejects(submitCreationRegionRevision(draft, { ...input, projectId: "other" }), /已切换/);
assert.equal(requests.length, 2);
console.log(JSON.stringify({ ok: true, groups: 4, maskSaves: saves, sameSubmissionRetries: requests.length, realModelRequests: 0 }));
