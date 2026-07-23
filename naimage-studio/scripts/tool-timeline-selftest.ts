import assert from "node:assert/strict";

import {
  collapseDuplicateToolTimelineMessages,
  resolveToolTimelineOperationId,
} from "../src/tool-timeline.ts";

const aliases = new Map<string, string>();
const scope = { runId: "run-1", projectId: "project-a", conversationId: "conversation-a", tool: "image_gen" };
const callId = resolveToolTimelineOperationId(aliases, { ...scope, phase: "tool-start", toolRunId: "call-1" });
assert.equal(callId, "call-1");
assert.equal(resolveToolTimelineOperationId(aliases, { ...scope, phase: "image-request" }), "call-1");
assert.equal(resolveToolTimelineOperationId(aliases, { ...scope, phase: "image-retry", toolRunId: "child-layer-2" }), "call-1");
assert.equal(resolveToolTimelineOperationId(aliases, { ...scope, phase: "image-response", toolRunId: "child-layer-3" }), "call-1");
assert.equal(resolveToolTimelineOperationId(aliases, { ...scope, phase: "tool-done", toolRunId: "call-1" }), "call-1");
assert.equal(
  resolveToolTimelineOperationId(aliases, { ...scope, phase: "tool-start", toolRunId: "call-2" }),
  "call-2",
  "a later image tool call in the same Agent run must replace the active alias",
);
assert.equal(
  resolveToolTimelineOperationId(aliases, { runId: "review-run", tool: "view_image", phase: "tool-start", toolRunId: "view-1" }),
  "review-run-view_image",
  "View Image calls in one Agent run should share one visible timeline operation",
);
assert.equal(
  resolveToolTimelineOperationId(aliases, { runId: "review-run", tool: "view_image", phase: "tool-done", toolRunId: "view-2" }),
  "review-run-view_image",
);

const trace = {
  stage: "start",
  name: "image_gen",
  brief: "生成分层 PNG。",
  prompts: [{ title: "生图提示词", prompt: "完整提示词" }],
};
const collapsedLegacy = collapseDuplicateToolTimelineMessages([
  { id: "progress-tool-call-1-start", meta: "progress", status: "done", createdAt: "05:00", toolTrace: trace },
  { id: "progress-tool-run-1-image-gen-start", meta: "progress", status: "done", createdAt: "05:00", toolTrace: { ...trace } },
]);
assert.equal(collapsedLegacy.length, 1);

const collapsedOperation = collapseDuplicateToolTimelineMessages([
  { id: "progress-tool-call-1-start", meta: "progress", status: "running", createdAt: "05:00", toolTrace: { ...trace, operationId: "call-1" } },
  { id: "progress-tool-call-1-start-update", meta: "progress", status: "running", createdAt: "05:01", toolTrace: { ...trace, operationId: "call-1", brief: "产品层正在重试 1/5。" } },
]);
assert.equal(collapsedOperation.length, 1);
assert.equal(collapsedOperation[0].toolTrace?.brief, "产品层正在重试 1/5。");

const distinct = collapseDuplicateToolTimelineMessages([
  { id: "progress-tool-call-1-start", meta: "progress", status: "done", createdAt: "05:00", toolTrace: trace },
  { id: "progress-tool-call-2-start", meta: "progress", status: "done", createdAt: "05:01", toolTrace: trace },
]);
assert.equal(distinct.length, 2, "sequential operations in different minutes must remain distinct");

const parallelViewImage = collapseDuplicateToolTimelineMessages([
  { id: "view-1-start", meta: "progress", status: "done", createdAt: "05:02", toolTrace: { stage: "start", name: "view_image", operationId: "review-run-view_image", brief: "查看第一张图片。" } },
  { id: "view-2-start", meta: "progress", status: "done", createdAt: "05:02", toolTrace: { stage: "start", name: "view_image", operationId: "review-run-view_image", brief: "查看第二张图片。" } },
  { id: "view-1-result", meta: "progress", status: "done", createdAt: "05:02", toolTrace: { stage: "result", name: "view_image", operationId: "review-run-view_image", completionText: "图片读取完成" } },
  { id: "view-2-result", meta: "progress", status: "done", createdAt: "05:02", toolTrace: { stage: "result", name: "view_image", operationId: "review-run-view_image", completionText: "图片读取完成" } },
]);
assert.equal(parallelViewImage.length, 2, "adjacent parallel View Image calls should render as one start and one completion card");
assert.equal(parallelViewImage[0].id, "view-2-start");
assert.equal(parallelViewImage[1].id, "view-2-result");

console.log(JSON.stringify({ ok: true, aliasCases: 8, collapseCases: 4 }));
