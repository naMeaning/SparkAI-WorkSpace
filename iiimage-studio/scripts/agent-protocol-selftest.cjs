"use strict";

process.env.IIIMAGE_AGENT_PROTOCOL_SELFTEST = "1";

const assert = require("node:assert/strict");
const { app } = require("electron");
const {
  agentModelUsesResponsesApi,
  managedRelayEndpoint,
  responsesInputFromChatMessages,
  responsesRequestFromChatRequest,
  responsesToolsFromChatTools,
} = require("../electron-main.cjs");
const { normalizedTaskScope, taskScopeSnapshotHash, taskScopeForPrompt, validateImageOperationSourcePolicy } = require("../agent-runtime.cjs");

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
process.on("unhandledRejection", (error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});

const customViewImage = {
  type: "function",
  function: {
    name: "view_image",
    description: "View a local image file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        detail: { type: "string", enum: ["high", "original"] },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

const tools = responsesToolsFromChatTools([
  customViewImage,
  { type: "web_search" },
]);

assert.equal(tools[0].type, "function");
assert.equal(tools[0].name, "view_image");
assert.deepEqual(Object.keys(tools[0].parameters.properties), ["path", "detail"]);
assert.deepEqual(tools[1], { type: "web_search" });

const input = responsesInputFromChatMessages([
  { role: "system", content: "SYSTEM_TO_DEVELOPER" },
  {
    role: "responses_items",
    items: [
      { type: "reasoning", id: "reasoning-1", summary: [], encrypted_content: "encrypted" },
      { type: "web_search_call", id: "search-1", status: "completed", action: { type: "search", query: "Codex tools" } },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "searched" }] },
      { type: "function_call", call_id: "view-1", name: "view_image", arguments: "{\"path\":\"fixture.png\"}" },
    ],
  },
  {
    role: "tool",
    tool_call_id: "view-1",
    content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "high" }],
  },
]);

assert.equal(input[0].role, "developer");
assert.equal(input[1].type, "reasoning");
assert.equal(input[1].encrypted_content, "encrypted");
assert.equal(input[2].type, "web_search_call");
assert.equal(input[3].type, "message");
assert.equal(input[4].type, "function_call");
assert.equal(input[5].type, "function_call_output");
assert.equal(input[5].output[0].type, "input_image");
assert.equal(input[5].output[0].detail, "high");

const request = responsesRequestFromChatRequest({
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "probe" }],
  tools: [customViewImage, { type: "web_search" }],
  tool_choice: "auto",
  reasoning_effort: "medium",
  stream: true,
});

assert.equal(request.store, false);
assert.equal(request.parallel_tool_calls, true);
assert.deepEqual(request.include, ["reasoning.encrypted_content"]);
assert.equal(request.tools[1].type, "web_search");
assert.equal(request.tool_choice, "auto");
assert.equal(request.reasoning.effort, "medium");
assert.equal(agentModelUsesResponsesApi("gpt-5.5"), true);
assert.equal(agentModelUsesResponsesApi("gpt-5.6-sol"), true);
assert.equal(agentModelUsesResponsesApi("gpt-4.1"), false);
assert.equal(managedRelayEndpoint("/v1/responses"), "/naimage/v1/responses");
assert.equal(managedRelayEndpoint("/v1/images/generations"), "/naimage/v1/images/generations");
assert.equal(managedRelayEndpoint("/iiimage/v1/models"), "/naimage/v1/models");
assert.deepEqual(validateImageOperationSourcePolicy("image_gen", "generate", 0, "single"), {
  operation: "generate",
  sourceCount: 0,
  multiSourceResultTask: false,
});
assert.deepEqual(validateImageOperationSourcePolicy("image_gen", "edit", 1, "single"), {
  operation: "edit",
  sourceCount: 1,
  multiSourceResultTask: false,
});
assert.throws(
  () => validateImageOperationSourcePolicy("image_gen", "generate", 1, "single"),
  /generate 不会读取原图/,
);
assert.throws(
  () => validateImageOperationSourcePolicy("image_gen", "generate", 2, "grouped-by-source"),
  /sourceBindingId/,
);

const taskScope = normalizedTaskScope({
  selectedNodeId: "A",
  taskScope: {
    version: 2,
    origin: "chat",
    scopeType: "container",
    canvasRevision: 17,
    sourceNodeIds: ["A"],
    sourceContainerIds: ["A"],
    referenceContainerIds: ["B"],
    sourceBindingIds: ["binding:A:A:0"],
    referenceBindingIds: ["binding:REF:1", "binding:REF:2"],
    sourceAssets: [{ bindingId: "binding:A:A:0", assetId: "asset-source", occurrenceId: `occ-${"1".repeat(32)}`, importBatchId: "batch-source", importRootId: `root-${"1".repeat(24)}`, sourceRelativePath: "商品/主图.png", sourceRootLabel: "商品目录", sourceRootKind: "directory", displayCode: "A1", contentHash: "a".repeat(64), role: "source", name: "待修改商品图", nodeId: "A", containerId: "A", containerSlot: 0, ownerNodeId: "A", ownerAssetIndex: 0, path: "project/source.png", relativePath: "assets/source.png" }],
    referenceAssets: [
      { bindingId: "binding:REF:1", assetId: "asset-ref-1", displayCode: "B1", role: "reference", name: "颜色参考", path: "project/reference-color.png" },
      { bindingId: "binding:REF:2", assetId: "asset-ref-2", displayCode: "B2", role: "reference", name: "材质参考", path: "project/reference-material.png" },
    ],
    resultPolicy: "grouped-by-source",
    confirmationPolicy: "preview-3",
    requirement: { nodeId: "REQ", revision: 4, sourceSignature: "source-signature-4" },
  },
});
assert.deepEqual(taskScope.sourceNodeIds, ["A"]);
assert.equal(taskScope.scopeType, "container");
assert.equal(taskScope.canvasRevision, 17);
assert.deepEqual(taskScope.sourceContainerIds, ["A"]);
assert.deepEqual(taskScope.referenceContainerIds, ["B"]);
assert.deepEqual(taskScope.sourceBindingIds, ["binding:A:A:0"]);
assert.equal(taskScope.resultPolicy, "grouped-by-source");
assert.equal(taskScope.confirmationPolicy, "preview-3");
assert.deepEqual(taskScope.requirement, { nodeId: "REQ", revision: 4, sourceSignature: "source-signature-4" });
assert.match(taskScope.snapshotHash, /^scope-[a-f0-9]{32}$/);
assert.equal(taskScope.snapshotHash, taskScopeSnapshotHash(taskScope));
assert.equal(taskScope.sourceAssets[0].role, "source");
assert.equal(taskScope.sourceAssets[0].contentHash, "a".repeat(64));
assert.equal(taskScope.sourceAssets[0].relativePath, "assets/source.png");
assert.equal(taskScope.sourceAssets[0].occurrenceId, `occ-${"1".repeat(32)}`);
assert.equal(taskScope.sourceAssets[0].importRootId, `root-${"1".repeat(24)}`);
assert.equal(taskScope.sourceAssets[0].sourceRelativePath, "商品/主图.png");
assert.equal(taskScope.sourceAssets[0].sourceRootKind, "directory");
assert.equal(taskScope.sourceAssets[0].bindingId, "binding:A:A:0");
assert.equal(taskScope.sourceAssets[0].containerSlot, 0);
assert.equal(taskScope.sourceAssets[0].ownerNodeId, "A");
assert.equal(taskScope.referenceAssets.length, 2);
const taskScopePrompt = taskScopeForPrompt({ taskScope }).text;
assert.match(taskScopePrompt, /SOURCE（需要处理）/);
assert.match(taskScopePrompt, /scopeType=container/);
assert.match(taskScopePrompt, /canvasRevision=17/);
assert.match(taskScopePrompt, /resultPolicy=grouped-by-source/);
assert.match(taskScopePrompt, /confirmationPolicy=preview-3/);
assert.match(taskScopePrompt, /snapshotHash=scope-[a-f0-9]{32}/);
assert.match(taskScopePrompt, /requirement=REQ@4 sourceSignature=source-signature-4/);
assert.match(taskScopePrompt, /A1 \| bindingId=binding:A:A:0 \| assetId=asset-source \| 待修改商品图/);
assert.match(taskScopePrompt, /containerSlot=0 \| owner=A:0/);
assert.match(taskScopePrompt, /source=商品\/主图.png/);
assert.match(taskScopePrompt, /REFERENCE（仅作参考，不决定输出数量）/);
assert.match(taskScopePrompt, /B1 \| bindingId=binding:REF:1 \| assetId=asset-ref-1 \| 颜色参考/);

const changedRevisionScope = normalizedTaskScope({ taskScope: { ...taskScope, canvasRevision: 18 } });
assert.notEqual(changedRevisionScope.snapshotHash, taskScope.snapshotHash, "Canvas revision changes must produce a new immutable dispatch snapshot");
const changedBindingScope = normalizedTaskScope({
  taskScope: {
    ...taskScope,
    sourceBindingIds: ["binding:A:A:changed"],
    sourceAssets: taskScope.sourceAssets.map((asset) => ({ ...asset, bindingId: "binding:A:A:changed" })),
  },
});
assert.notEqual(changedBindingScope.snapshotHash, taskScope.snapshotHash, "Source binding changes must invalidate the task snapshot");
const untrustedHashScope = normalizedTaskScope({ taskScope: { ...taskScope, snapshotHash: `scope-${"0".repeat(32)}` } });
assert.equal(untrustedHashScope.snapshotHash, taskScope.snapshotHash, "Runtime must recompute TaskScope hashes instead of trusting persisted input");

const unsafePathScope = normalizedTaskScope({
  taskScope: {
    version: 2,
    sourceAssets: [{ assetId: "unsafe-source", sourceRelativePath: "C:\\Users\\private\\source.png", role: "source", path: "project/source.png" }],
    referenceAssets: [{ assetId: "unsafe-reference", sourceRelativePath: "../private/reference.png", role: "reference", path: "project/reference.png" }],
  },
});
assert.equal(unsafePathScope.sourceAssets[0].sourceRelativePath, "");
assert.equal(unsafePathScope.referenceAssets[0].sourceRelativePath, "");
assert.doesNotMatch(taskScopeForPrompt({ taskScope: unsafePathScope }).text, /Users\/private|\.\.\/private/);

const exactSpacedPath = "E:\\项目\\有  两个空格\\商品主图.png";
const longTaskPath = `E:\\项目\\${Array.from({ length: 180 }, (_item, index) => `深层目录 ${index + 1}`).join("\\")}\\商品主图.png`;
assert.ok(longTaskPath.length > 1000);
const exactPathScope = normalizedTaskScope({
  taskScope: {
    version: 2,
    sourceAssets: [{ assetId: "spaced-path", role: "source", path: exactSpacedPath }],
    referenceAssets: [{ assetId: "long-path", role: "reference", path: longTaskPath }],
  },
});
assert.equal(exactPathScope.sourceAssets[0].path, exactSpacedPath, "TaskScope paths must preserve repeated spaces");
assert.equal(exactPathScope.referenceAssets[0].path, longTaskPath, "TaskScope paths must not be truncated or gain ellipses");

process.stdout.write(`${JSON.stringify({
  ok: true,
  nativeWebSearch: true,
  viewImageContentOutput: true,
  rawResponseItemsPreserved: true,
  codexRequestEnvelope: true,
  managedSessionRelay: true,
  sourceGenerateFalseCausalityRejected: true,
  explicitTaskScopeRoles: true,
  taskScopeV2PolicySnapshot: true,
  taskScopeSnapshotIntegrity: true,
  taskScopeIdentityMetadataPreserved: true,
  unsafeSourceRelativePathsRejected: true,
  exactTaskScopePathsPreserved: true,
})}\n`);

// Requiring electron-main.cjs in self-test mode intentionally skips the normal
// app lifecycle. Explicitly quit so a successful protocol test cannot leave an
// idle Electron process behind and hang CI or the convergence test suite.
app.exit(0);
