"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAgentRuntime } = require("../agent-runtime.cjs");

function streamedResponsesOutput(output, model = "gpt-5.6-sol") {
  return {
    chunks: [{ type: "response.completed", response: { model, status: "completed", output } }]
  };
}

function streamedResponsesText(text, sequence) {
  return streamedResponsesOutput([
    {
      type: "reasoning",
      id: `reasoning-before-checkpoint-${sequence}`,
      summary: [],
      encrypted_content: `encrypted-before-checkpoint-${sequence}`
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }]
    }
  ]);
}

function streamedChatText(text, model = "claude-sonnet-4") {
  return {
    chunks: [
      { model, choices: [{ delta: { role: "assistant", content: text } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] }
    ]
  };
}

function message(id, role, content) {
  return { id, role, content, createdAt: new Date().toISOString(), status: "done" };
}

function dynamicImageContext() {
  return {
    nodes: [{
      id: "canvas-product-42",
      displayCode: "IMG42",
      title: "当前商品原图",
      type: "image",
      status: "review",
      imageState: "ready",
      outputs: 1,
      assets: [{ assetId: "asset-product-42", index: 0, path: "C:\\fixtures\\product-42.png", type: "image" }]
    }],
    selectedNodeId: "canvas-product-42",
    selectedNodeIds: ["canvas-product-42"],
    taskScope: {
      version: 2,
      origin: "canvas",
      scopeType: "single",
      canvasRevision: 42,
      sourceNodeIds: ["canvas-product-42"],
      sourceAssets: [{
        bindingId: "binding-product-42",
        assetId: "asset-product-42",
        displayCode: "SRC1",
        name: "商品原图 42",
        nodeId: "canvas-product-42",
        assetIndex: 0,
        path: "C:\\fixtures\\product-42.png",
        mimeType: "image/png"
      }],
      referenceAssets: [],
      resultPolicy: "single",
      confirmationPolicy: "direct"
    }
  };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "naimage-context-checkpoint-"));
  const requests = [];
  let responseSequence = 0;
  const runtime = createAgentRuntime({
    projectRoot: path.resolve(__dirname, ".."),
    configDir: path.join(tempRoot, "config"),
    serverChatCompletion: async (request) => {
      requests.push(request);
      if (request.stream === false) {
        return {
          choices: [{
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "CHECKPOINT_HANDOFF_SUMMARY：保留商品图目标、画布来源与尚未完成的下一步。",
                keywords: ["checkpoint", "canvas", "image"]
              })
            }
          }]
        };
      }
      responseSequence += 1;
      return /^claude/i.test(String(request.model || ""))
        ? streamedChatText("Claude 普通消息历史测试完成。", request.model)
        : streamedResponsesText("Codex Responses 历史测试完成。", responseSequence);
    }
  });

  try {
    const codexSettings = {
      contextStrategy: "auto",
      agentModel: "gpt-5.6-sol",
      imageModel: "gpt-image-2",
      reasoningEffort: "low"
    };

    const modestProgress = [];
    requests.length = 0;
    await runtime.chat({
      ...dynamicImageContext(),
      settings: codexSettings,
      projectId: "project-context",
      conversationId: "conversation-32k",
      messages: [message("u-32k", "user", `CONTEXT_32K_MUST_NOT_COMPACT\n${"a".repeat(128_000)}`)],
      prompt: "继续当前商品图任务。",
      progress: (event) => modestProgress.push(event)
    });
    assert.equal(modestProgress.some((event) => event.phase === "context-compact-start"), false, "GPT/Codex must not compact around the former 32K threshold");
    const modestRequest = requests.find((request) => request.stream !== false);
    assert(modestRequest, "Expected a GPT model request");
    assert(modestRequest.messages.some((item) => item.role === "responses_items"), "GPT 5.6 should use persisted Responses items");
    assert(modestRequest.tools.some((tool) => tool.type === "web_search"), "GPT Responses mode should expose native web_search");

    const retainedIntent = "IMPORTANT_USER_INTENT_KEEP_PRODUCT_IDENTITY_AND_BACKGROUND_LOCKED";
    const largePriorPrompt = `${retainedIntent}\n${"x".repeat(980_000)}`;
    requests.length = 0;
    await runtime.chat({
      settings: codexSettings,
      projectId: "project-context",
      conversationId: "conversation-checkpoint",
      messages: [],
      prompt: largePriorPrompt,
      progress: () => {}
    });

    const checkpointProgress = [];
    requests.length = 0;
    await runtime.chat({
      ...dynamicImageContext(),
      settings: codexSettings,
      projectId: "project-context",
      conversationId: "conversation-checkpoint",
      messages: [
        message("u-before-checkpoint", "user", largePriorPrompt),
        message("a-before-checkpoint", "assistant", "先前响应已完成，等待继续。")
      ],
      prompt: "在新窗口继续，并保持当前画布和原图范围。",
      progress: (event) => checkpointProgress.push(event)
    });

    const compactStart = checkpointProgress.find((event) => event.phase === "context-compact-start");
    const compactDone = checkpointProgress.find((event) => event.phase === "context-compact-done");
    assert(compactStart, "Expected the large GPT history to create a checkpoint");
    assert.equal(compactStart.detail?.autoCompactTokenLimit, 244_800, "Codex automatic checkpoint must use the 90% model-window limit");
    assert(compactDone, "Expected checkpoint completion progress");
    const compactRequest = requests.find((request) => request.stream === false);
    const resumedRequest = [...requests].reverse().find((request) => request.stream !== false);
    assert(compactRequest, "Expected a dedicated compact-model request");
    assert(resumedRequest, "Expected the resumed main-model request");

    const resumedJson = JSON.stringify(resumedRequest.messages);
    assert(resumedJson.includes("CHECKPOINT_HANDOFF_SUMMARY"), "The checkpoint summary must be injected into the new window");
    assert(resumedJson.includes(retainedIntent), "Recent user intent must survive checkpoint compaction");
    assert(resumedJson.includes("canvas-product-42"), "Current canvas state must be re-injected after checkpoint");
    assert(resumedJson.includes("binding-product-42"), "Current TaskScope bindings must be re-injected after checkpoint");
    assert.equal(resumedJson.includes("reasoning-before-checkpoint"), false, "Old encrypted reasoning/protocol history must be removed at the checkpoint boundary");
    const resumedProtocol = resumedRequest.messages.find((item) => item.role === "responses_items");
    assert(resumedProtocol, "The new Codex window should retain a bounded Responses foundation");
    assert(resumedProtocol.items.every((item) => item.type === "message" && item.role === "user"), "Checkpoint protocol foundation must contain only retained user intent");

    requests.length = 0;
    await runtime.chat({
      ...dynamicImageContext(),
      settings: {
        contextStrategy: "auto",
        agentModel: "claude-sonnet-4",
        imageModel: "gpt-image-2",
        reasoningEffort: "low"
      },
      projectId: "project-context",
      conversationId: "conversation-claude",
      messages: [message("u-claude-history", "user", "CLAUDE_PLAIN_HISTORY_SENTINEL")],
      prompt: "继续普通消息历史测试。",
      progress: () => {}
    });
    const claudeRequest = requests.find((request) => request.stream !== false);
    assert(claudeRequest, "Expected a Claude model request");
    assert.equal(claudeRequest.messages.some((item) => item.role === "responses_items"), false, "Claude must never receive OpenAI Responses protocol items");
    assert.equal(claudeRequest.tools.some((tool) => tool.type === "web_search"), false, "Claude must not be forced onto Responses by the native web_search tool");
    assert(JSON.stringify(claudeRequest.messages).includes("CLAUDE_PLAIN_HISTORY_SENTINEL"), "Claude should receive ordinary message history");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cases: 16,
      codexAutoCompactTokenLimit: compactStart.detail.autoCompactTokenLimit,
      contextWindowNumber: compactDone.detail?.contextWindowNumber
    })}\n`);
  } finally {
    runtime.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
