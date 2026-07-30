"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createAgentRuntime,
  normalizedTaskScope,
  normalizedSteerTaskScopeUpdate
} = require("../agent-runtime.cjs");
const { createAgentRunControl } = require("../desktop/agent-run-control.cjs");

function streamedResponsesText(text) {
  return {
    chunks: [{
      type: "response.completed",
      response: {
        model: "gpt-5.6-sol",
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }]
      }
    }]
  };
}

function streamedResponsesToolCall(name, args, callId = "call-1") {
  return {
    chunks: [{
      type: "response.completed",
      response: {
        model: "gpt-5.6-sol",
        status: "completed",
        output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }]
      }
    }]
  };
}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "naimage-agent-steer-"));
  const control = createAgentRunControl();
  const scope = ({ revision, sources = [], references = [] }) => normalizedTaskScope({ taskScope: {
    version: 2,
    origin: "chat",
    canvasRevision: revision,
    sourceAssets: sources,
    referenceAssets: references
  } });
  const oldSourceScope = scope({
    revision: 1,
    sources: [{ assetId: "old-product", displayCode: "SRC1", name: "old-product.png", role: "source", nodeId: "OLD" }]
  });
  const newSourceScope = scope({
    revision: 2,
    sources: [{ assetId: "new-product", displayCode: "SRC2", name: "new-product.png", role: "source", nodeId: "NEW" }]
  });
  const addedSourceScope = scope({
    revision: 3,
    sources: [{ assetId: "side-product", displayCode: "SRC3", name: "side-product.png", role: "source", nodeId: "SIDE" }]
  });
  const initialReferenceScope = scope({
    revision: 3,
    references: [{ assetId: "white-reference", displayCode: "REF1", name: "white-reference.png", role: "reference", nodeId: "REF-A" }]
  });
  const addedReferenceScope = scope({
    revision: 4,
    references: [{ assetId: "dark-reference", displayCode: "REF2", name: "dark-lighting-reference.png", role: "reference", nodeId: "REF-B" }]
  });
  const keptScope = normalizedSteerTaskScopeUpdate(oldSourceScope, { sourceMode: "keep", referenceMode: "keep" });
  assert.equal(keptScope.taskScope.snapshotHash, oldSourceScope.snapshotHash);
  const replacedReferences = normalizedSteerTaskScopeUpdate(initialReferenceScope, {
    sourceMode: "keep",
    referenceMode: "replace",
    taskScope: { ...addedReferenceScope, snapshotHash: `scope-${"f".repeat(32)}` }
  });
  assert.deepEqual(replacedReferences.taskScope.referenceAssets.map((item) => item.assetId), ["dark-reference"]);
  assert.notEqual(replacedReferences.taskScope.snapshotHash, `scope-${"f".repeat(32)}`, "Main must recompute an untrusted Renderer hash");
  const mergedSources = normalizedSteerTaskScopeUpdate(oldSourceScope, {
    sourceMode: "merge",
    referenceMode: "keep",
    taskScope: addedSourceScope
  });
  assert.deepEqual(mergedSources.taskScope.sourceAssets.map((item) => item.assetId), ["old-product", "side-product"]);
  assert.equal(mergedSources.taskScope.scopeType, "multi-source");
  assert.equal(mergedSources.taskScope.resultPolicy, "grouped-by-source");
  const clearedScope = normalizedSteerTaskScopeUpdate(replacedReferences.taskScope, { sourceMode: "clear", referenceMode: "clear" });
  assert.equal(clearedScope.taskScope.sourceAssets.length, 0);
  assert.equal(clearedScope.taskScope.referenceAssets.length, 0);
  assert.equal(clearedScope.taskScope.scopeType, "none");
  assert.throws(
    () => normalizedSteerTaskScopeUpdate(oldSourceScope, { sourceMode: "replace", referenceMode: "keep" }),
    /必须提供新的 TaskScope/
  );
  const queueSteer = (payload) => control.steer(
    payload,
    (currentTaskScope, update) => normalizedSteerTaskScopeUpdate(currentTaskScope, update)
  );
  const controlledRun = control.begin({
    runId: "steer-run",
    projectId: "project-a",
    conversationId: "conversation-a",
    nodeIds: ["A"],
    steerable: true,
    taskScope: oldSourceScope
  });
  const requests = [];
  const progress = [];
  let requestCount = 0;
  let secondControlledRun = null;
  const runtime = createAgentRuntime({
    projectRoot: path.resolve(__dirname, ".."),
    configDir: path.join(tempRoot, "config"),
    serverChatCompletion: async (request) => {
      requestCount += 1;
      requests.push(request);
      if (requestCount === 1) {
        setImmediate(() => queueSteer({
          runId: "steer-run",
          prompt: "Keep the product, replace the background with warm yellow.",
          taskScopeUpdate: { sourceMode: "replace", referenceMode: "keep", taskScope: newSourceScope }
        }));
        return await new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      }
      if (requestCount === 2) return streamedResponsesText("Replanned with the revised requirement.");
      if (requestCount === 3) {
        return streamedResponsesToolCall("image_gen", {
          operation: "generate",
          prompt: "A clean product photo on a white background.",
          count: 1,
          ratio: "1:1",
          resolution: "1080P",
          generationMode: "parallel",
          brief: "Generate the initial product image."
        }, "image-call-before-steer");
      }
      return streamedResponsesText("Stopped the old image request and replanned the task.");
    },
    serverGenerateImage: async (request) => {
      setImmediate(() => queueSteer({
        runId: "steer-tool-run",
        prompt: "Do not generate yet; use the darker background reference.",
        taskScopeUpdate: { sourceMode: "keep", referenceMode: "merge", taskScope: addedReferenceScope }
      }));
      return await new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    }
  });

  try {
    const result = await runtime.chat({
      settings: { agentModel: "gpt-5.6-sol", imageModel: "gpt-image-2", reasoningEffort: "low" },
      projectId: "project-a",
      conversationId: "conversation-a",
      runId: "steer-run",
      prompt: "Create a product image.",
      messages: [],
      nodes: [],
      selectedNodeIds: ["A"],
      taskScope: oldSourceScope,
      signal: controlledRun.signal,
      waitUntilRunnable: (signal) => control.waitUntilRunnable(controlledRun, signal),
      beginPhase: (meta) => control.beginPhase(controlledRun, meta),
      consumeSteers: () => control.consumeSteers(controlledRun),
      progress: (event) => progress.push(event)
    });
    assert.equal(result.ok, true);
    assert.equal(result.content, "Replanned with the revised requirement.");
    assert.equal(requestCount, 2);
    assert.equal(controlledRun.signal.aborted, false, "Steer must keep the parent run alive");
    assert.match(JSON.stringify(requests[1].messages), /warm yellow/);
    assert.match(JSON.stringify(requests[1].messages), /TASK SCOPE UPDATE: SOURCE=REPLACE, REFERENCE=KEEP/);
    assert.match(JSON.stringify(requests[1].messages), /new-product\.png/);
    assert.ok(progress.some((event) => event.phase === "steer-applied"));
    assert.ok(progress.some((event) => event.detail?.taskScopeSnapshotHash === newSourceScope.snapshotHash));
    assert.equal(control.consumeSteers(controlledRun).length, 0);

    secondControlledRun = control.begin({
      runId: "steer-tool-run",
      projectId: "project-a",
      conversationId: "conversation-b",
      steerable: true,
      taskScope: initialReferenceScope
    });
    const toolSteerResult = await runtime.chat({
      settings: { agentModel: "gpt-5.6-sol", imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], reasoningEffort: "low" },
      projectId: "project-a",
      conversationId: "conversation-b",
      runId: "steer-tool-run",
      prompt: "Generate one product image.",
      messages: [],
      nodes: [],
      taskScope: initialReferenceScope,
      signal: secondControlledRun.signal,
      waitUntilRunnable: (signal) => control.waitUntilRunnable(secondControlledRun, signal),
      beginPhase: (meta) => control.beginPhase(secondControlledRun, meta),
      consumeSteers: () => control.consumeSteers(secondControlledRun),
      progress: (event) => progress.push(event)
    });
    assert.equal(toolSteerResult.ok, true);
    assert.equal(toolSteerResult.content, "Stopped the old image request and replanned the task.");
    assert.equal(secondControlledRun.signal.aborted, false);
    assert.match(JSON.stringify(requests[3].messages), /darker background reference/);
    assert.match(JSON.stringify(requests[3].messages), /TASK SCOPE UPDATE: SOURCE=KEEP, REFERENCE=MERGE/);
    assert.match(JSON.stringify(requests[3].messages), /white-reference\.png/);
    assert.match(JSON.stringify(requests[3].messages), /dark-lighting-reference\.png/);
  } finally {
    control.finish({ runId: "steer-run" });
    if (secondControlledRun) control.finish({ runId: "steer-tool-run" });
    runtime.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, cases: 24 })}\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
