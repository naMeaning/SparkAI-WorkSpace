"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createAgentRuntime, defaultPromptText, normalizeImageToolFrame, toolSchemas } = require("../agent-runtime.cjs");
const { agentToolSchemas: ownedAgentToolSchemas, toolSchemas: ownedToolSchemas } = require("../runtime/tool-schemas.cjs");
const { createMemoryStore: ownedCreateMemoryStore } = require("../runtime/memory-store.cjs");
const { createImageBatchNormalization: ownedCreateImageBatchNormalization } = require("../runtime/image-batch-normalization.cjs");
const {
  messageFromResponse: ownedMessageFromResponse,
  responseFromStreamChunks: ownedResponseFromStreamChunks,
  responseToolCallFromItem: ownedResponseToolCallFromItem,
} = require("../runtime/responses-parser.cjs");

const LEGACY_MEMORY_DATABASE_NAME = "iiimage-memory.db";
const forbiddenPublicMetadata = /\bfmem(?:-[a-z0-9_-]+)?\b|\bentry[_ ]?id\b|\bentryId\b|\bselector\b|\bkeywords\b/i;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertOk(result, label) {
  assert.equal(result?.ok, true, `${label}: ${result?.error || JSON.stringify(result)}`);
  return result;
}

function providerPromptBase(request) {
  return String(request?.prompt || "").split("\n\n交付规格：")[0];
}

function assertProviderPromptIncludesDeliverySpecification(request, originalPrompt) {
  const prompt = String(request?.prompt || "");
  assert.equal(providerPromptBase(request), originalPrompt);
  assert.equal(prompt.startsWith(`${originalPrompt}\n\n交付规格：`), true);
  assert.match(prompt, /画面比例 [0-9]+:[0-9]+，清晰度 (?:1K|2K|4K|720P|1080P)，最终像素 [0-9]+×[0-9]+/);
  assert.equal((prompt.match(/交付规格：/g) || []).length, 1);
}

function assertRejected(result, label) {
  assert.equal(result?.ok, false, `${label} should be rejected`);
  assert.equal(typeof result.error, "string", `${label} should return an error message`);
  assert(result.error.trim(), `${label} should return a non-empty error message`);
}

function assertPublicMemoryResponse(result, label) {
  assert.equal(
    forbiddenPublicMetadata.test(JSON.stringify(result)),
    false,
    `${label} leaked internal FastMemory metadata: ${JSON.stringify(result)}`,
  );
}

function summaryKey(projectId, conversationId) {
  const compact = (value) => String(value || "default").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 96) || "default";
  return `conversation_summary:${compact(projectId)}:${compact(conversationId)}`;
}

function writeConversationSummary(dbPath, key, value) {
  const database = new DatabaseSync(dbPath);
  try {
    database
      .prepare("INSERT INTO runtime_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  } finally {
    database.close();
  }
}

function readConversationSummary(dbPath, key) {
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return database.prepare("SELECT value FROM runtime_meta WHERE key = ?").get(key)?.value;
  } finally {
    database.close();
  }
}

function streamedText(content) {
  return {
    chunks: [
      {
        model: "selftest-agent-model",
        choices: [{ delta: { role: "assistant", content } }],
      },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ],
  };
}

function streamedToolCall(name, argumentsObject) {
  return {
    chunks: [
      {
        model: "selftest-agent-model",
        choices: [
          {
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `selftest-${name}-call`,
                  type: "function",
                  function: { name, arguments: JSON.stringify(argumentsObject) },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  };
}

function streamedToolCalls(calls) {
  return {
    chunks: [
      {
        model: "selftest-agent-model",
        choices: [
          {
            delta: {
              role: "assistant",
              tool_calls: calls.map((call, index) => ({
                index,
                id: `selftest-${call.name}-call-${index + 1}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
              })),
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  };
}

function streamedResponsesOutput(output) {
  return {
    chunks: [
      {
        type: "response.completed",
        response: {
          model: "selftest-agent-model",
          status: "completed",
          output,
        },
      },
    ],
  };
}

function assertImageBatchNormalizationContract() {
  let cleanOneLineCalls = 0;
  let stripPastedBlockMarkerCalls = 0;
  const cleanOneLine = (text, maxChars = 140) => {
    cleanOneLineCalls += 1;
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
  };
  const stripPastedBlockMarkers = (prompt) => {
    stripPastedBlockMarkerCalls += 1;
    return String(prompt || "")
      .replace(/^\s*\[Pasted Block \d+:\s*\d+\s+lines?,\s*\d+\s+chars?\]\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };
  const {
    normalizeImageBatchItems,
    normalizeSingleImageItemCompatibility,
  } = ownedCreateImageBatchNormalization({ cleanOneLine, stripPastedBlockMarkers });

  assert.equal(typeof normalizeImageBatchItems, "function");
  assert.equal(typeof normalizeSingleImageItemCompatibility, "function");

  const promotedSingle = normalizeSingleImageItemCompatibility({
    prompt: "PRODUCT_POSTER",
    count: 2,
    items: [
      { prompt: "PRODUCT_POSTER", ratio: "4:5", resolution: "2K", quality: "high" },
      { title: "temp", prompt: "temp" },
    ],
  });
  assert.equal(promotedSingle.prompt, "PRODUCT_POSTER");
  assert.equal(promotedSingle.count, 1);
  assert.equal(promotedSingle.items, undefined);
  assert.equal(promotedSingle.ratio, "4:5");
  assert.equal(promotedSingle.resolution, "2K");
  assert.equal(promotedSingle.quality, "high");

  const repeatedSingle = normalizeSingleImageItemCompatibility({
    count: 3,
    items: [{ prompt: "REPEATED_PRODUCT_POSTER", ratio: "1:1" }],
  });
  assert.equal(repeatedSingle.prompt, "REPEATED_PRODUCT_POSTER");
  assert.equal(repeatedSingle.count, 3);
  assert.equal(repeatedSingle.items, undefined);

  assert.throws(
    () => normalizeSingleImageItemCompatibility({
      prompt: "FIRST_SCENE",
      items: [{ prompt: "SECOND_SCENE" }],
    }),
    /无法无损确定/,
    "Conflicting single-item prompts must remain rejected",
  );

  const batch = normalizeImageBatchItems({
    model: "gpt-image-2",
    items: [
      { title: "  Front   view  ", prompt: "FRONT_VIEW", ratio: "1:1", resolution: "2K", quality: "high" },
      { title: "todo", prompt: "todo" },
      { prompt: "SIDE_VIEW", ratio: "4:5" },
    ],
  }, {
    imageModel: "gpt-image-2",
    imageResolution: "1080P",
    imageQuality: "medium",
  });
  assert.deepEqual(
    batch.map(({ title, prompt, ratio, resolution, quality }) => ({ title, prompt, ratio, resolution, quality })),
    [
      { title: "Front view", prompt: "FRONT_VIEW", ratio: "1:1", resolution: "2K", quality: "high" },
      { title: "方案 2", prompt: "SIDE_VIEW", ratio: "4:5", resolution: "1080P", quality: "medium" },
    ],
  );
  assert(cleanOneLineCalls >= 2, "Image batch titles must use the injected one-line cleaner");
  assert(stripPastedBlockMarkerCalls >= 6, "Image prompts must use the injected pasted-block sanitizer");
}

function assertResponsesParserContract() {
  const chatMessage = { role: "assistant", content: "Chat completion response", tool_calls: [] };
  assert.equal(
    ownedMessageFromResponse({ choices: [{ message: chatMessage }] }),
    chatMessage,
    "Chat Completions messages must pass through unchanged",
  );

  const responsesOutput = [
    {
      id: "responses-message-1",
      type: "message",
      content: [
        { type: "output_text", text: "Responses text " },
        { type: "refusal", refusal: "and refusal" },
      ],
    },
    {
      id: "responses-call-item-1",
      call_id: "responses-call-1",
      type: "function_call",
      name: "image_gen",
      arguments: { prompt: "product poster" },
    },
  ];
  assert.deepEqual(
    ownedMessageFromResponse({ output_text: "unused fallback", output: responsesOutput }),
    {
      role: "assistant",
      content: "Responses text and refusal",
      tool_calls: [
        {
          id: "responses-call-1",
          type: "function",
          function: { name: "image_gen", arguments: '{"prompt":"product poster"}' },
        },
      ],
      responses_output: responsesOutput,
    },
    "Responses output messages and function calls must normalize to the Chat message contract",
  );
  assert.deepEqual(
    ownedMessageFromResponse({ output_text: "Responses output_text fallback", output: [] }),
    {
      role: "assistant",
      content: "Responses output_text fallback",
      tool_calls: [],
      responses_output: [],
    },
  );

  const circularArguments = {};
  circularArguments.self = circularArguments;
  assert.equal(
    ownedResponseToolCallFromItem({ type: "function_call", name: "image_gen", arguments: circularArguments })
      .function.arguments,
    '{"error":"json stringify failed"}',
    "Non-serializable Responses arguments must preserve the runtime safe-JSON fallback",
  );

  const chatStream = ownedResponseFromStreamChunks([
    {
      model: "chat-stream-model",
      choices: [
        {
          delta: {
            content: "Hel",
            reasoning_content: "think ",
            tool_calls: [
              {
                index: 0,
                id: "chat-stream-call-1",
                type: "function",
                function: { name: "image_gen", arguments: '{"prompt":"' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            content: "lo",
            reasoning: "step",
            tool_calls: [{ index: 0, function: { arguments: 'poster"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ]);
  assert.deepEqual(chatStream, {
    model: "chat-stream-model",
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: "Hello",
          reasoning_content: "think step",
          tool_calls: [
            {
              id: "chat-stream-call-1",
              type: "function",
              function: { name: "image_gen", arguments: '{"prompt":"poster"}' },
            },
          ],
          responses_output: [],
        },
      },
    ],
  });

  const addedCallItem = {
    id: "responses-stream-item-1",
    call_id: "responses-stream-call-1",
    type: "function_call",
    name: "image_gen",
    arguments: "",
  };
  const doneCallItem = { ...addedCallItem, arguments: '{"prompt":"stream poster"}' };
  const doneMessageItem = {
    id: "responses-stream-message-1",
    type: "message",
    content: [{ type: "output_text", text: "Hello world" }],
  };
  const responsesStream = ownedResponseFromStreamChunks([
    { type: "response.output_text.delta", model: "responses-stream-model", delta: "Hello " },
    { type: "response.content_part.delta", part: { type: "output_text", text: "world" } },
    { type: "response.reasoning_text.delta", reasoning: "plan " },
    { type: "response.output_item.added", output_index: 0, item: addedCallItem },
    {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      item_id: "responses-stream-call-1",
      delta: '{"prompt":"stream ',
    },
    {
      type: "response.function_call_arguments.done",
      output_index: 0,
      item_id: "responses-stream-call-1",
      arguments: '{"prompt":"stream poster"}',
    },
    { type: "response.output_item.done", output_index: 0, item: doneCallItem },
    { type: "response.output_item.done", output_index: 1, item: doneMessageItem },
  ]);
  assert.deepEqual(responsesStream, {
    model: "responses-stream-model",
    choices: [
      {
        finish_reason: undefined,
        message: {
          role: "assistant",
          content: "Hello world",
          reasoning_content: "plan ",
          tool_calls: [
            {
              id: "responses-stream-call-1",
              type: "function",
              function: { name: "image_gen", arguments: '{"prompt":"stream poster"}' },
            },
          ],
          responses_output: [doneCallItem, doneMessageItem],
        },
      },
    ],
  });

  const completedOutput = [
    {
      id: "web-search-1",
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "2026 design trend" },
    },
    {
      id: "responses-final-message-1",
      type: "message",
      content: [{ type: "output_text", text: "Final response" }],
    },
    {
      id: "responses-final-call-item-1",
      call_id: "responses-final-call-1",
      type: "function_call",
      name: "image_gen",
      arguments: '{"prompt":"final poster"}',
    },
  ];
  const completedStream = ownedResponseFromStreamChunks([
    { type: "response.output_text.delta", model: "responses-fallback-model", delta: "Partial response" },
    { type: "response.reasoning_text.delta", reasoning_content: "final reasoning" },
    {
      type: "response.completed",
      response: {
        model: "responses-final-model",
        status: "completed",
        output: completedOutput,
      },
    },
  ]);
  assert.deepEqual(completedStream, {
    model: "responses-final-model",
    choices: [
      {
        finish_reason: "completed",
        message: {
          role: "assistant",
          content: "Final response",
          reasoning_content: "final reasoning",
          tool_calls: [
            {
              id: "responses-final-call-1",
              type: "function",
              function: { name: "image_gen", arguments: '{"prompt":"final poster"}' },
            },
          ],
          responses_output: completedOutput,
        },
      },
    ],
  });
}

async function runSelftest(directory) {
  assertImageBatchNormalizationContract();
  assertResponsesParserContract();
  const configDir = path.join(directory, "config");
  const memoryDir = path.join(configDir, "memory");
  const promptPath = path.join(memoryDir, "promptcontext.json");
  const fastMemoryPath = path.join(memoryDir, "fastmemory.json");
  const dbPath = path.join(memoryDir, "naimage-memory.db");
  const legacyDbPath = path.join(memoryDir, LEGACY_MEMORY_DATABASE_NAME);
  const capturedModelRequests = [];
  const capturedImageRequests = [];
  let activeLayerImageRequests = 0;
  let maximumLayerImageConcurrency = 0;
  let activeParallelImageRequests = 0;
  let maximumParallelImageConcurrency = 0;
  const parallelImageCompletionOrder = [];
  const fixtureOutputDir = path.join(directory, "output", "imagegen");
  const fixtureImagePath = path.join(fixtureOutputDir, "autonomy-fixture.png");
  const fixtureImagePathB = path.join(fixtureOutputDir, "autonomy-fixture-b.png");

  try {
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(fixtureOutputDir, { recursive: true });
    const legacyDatabase = new DatabaseSync(legacyDbPath);
    legacyDatabase.exec("CREATE TABLE runtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    legacyDatabase.prepare("INSERT INTO runtime_meta(key, value) VALUES(?, ?)").run("legacy_brand_migration", '"preserved"');
    legacyDatabase.close();
    writeFileSync(
      fixtureImagePath,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
    );
    writeFileSync(
      fixtureImagePathB,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
    );
    writeJson(promptPath, {
      version: 1,
      entries: [
        {
          entry_id: "prompt-legacy-main-second",
          order_index: 20,
          section: "main",
          title: "Metadata title must not be exposed",
          text: "LEGACY_MAIN_SECOND",
          status: "active",
        },
        {
          entry_id: "prompt-legacy-memory",
          order_index: 5,
          section: "memory",
          title: "Legacy memory title",
          text: "LEGACY_MEMORY_PROMPT",
          status: "active",
        },
        {
          entry_id: "prompt-legacy-main-first",
          order_index: 10,
          section: "main",
          title: "Another hidden metadata title",
          text: [
            "LEGACY_MAIN_FIRST",
            "selector: all",
            "entryId: pmt-20260712-000001",
            "memoryRef: ent-20260712-000002",
          ].join("\n"),
          status: "active",
        },
        {
          entry_id: "prompt-legacy-inactive",
          order_index: 1,
          section: "main",
          title: "Inactive",
          text: "INACTIVE_PROMPT_MUST_NOT_MIGRATE",
          status: "archived",
        },
      ],
    });

    const runtime = createAgentRuntime({
      projectRoot: path.resolve(__dirname, ".."),
      configDir,
      imageRoots: [directory],
      // These legacy switches are deliberately enabled in the regression fixture:
      // the runtime must remain autonomous even if an old caller still passes them.
      allowModelForce: true,
      allowToolArgCorrection: true,
      serverChatCompletion: async (request) => {
        capturedModelRequests.push(request);
        const requestMessages = request.messages || [];
        const serializedMessages = JSON.stringify(requestMessages);
        const currentIntent = [...serializedMessages.matchAll(/\bSELFTEST_[A-Z0-9_]+\b/g)].at(-1)?.[0] || "";
        const toolResultCount = (toolName) => requestMessages.filter((message) => {
          if (message?.role !== "tool") return false;
          if (String(message?.name || "") === toolName || String(message?.tool_call_id || "").includes(toolName)) return true;
          try {
            return JSON.parse(String(message.content || "{}"))?.tool === toolName;
          } catch {
            return false;
          }
        }).length;
        if (currentIntent === "SELFTEST_VIEW_IMAGE_HISTORY_COMPACT") {
          const viewCount = toolResultCount("view_image");
          const imageCount = toolResultCount("image_gen");
          if (viewCount >= 2) return streamedText("多轮图片观察上下文已保持轻量。 ");
          if (imageCount > 0) return streamedToolCall("view_image", { path: fixtureImagePathB, detail: "original" });
          if (viewCount > 0) {
            return streamedToolCall("image_gen", {
              operation: "generate",
              prompt: "VIEW_IMAGE_HISTORY_COMPACT_PROMPT",
              count: 1,
              ratio: "1:1",
              resolution: "1080P",
              brief: "生成第二轮待检查图片。",
            });
          }
          return streamedToolCall("view_image", { path: fixtureImagePath, detail: "original" });
        }
        if (currentIntent === "SELFTEST_VIEW_IMAGE_TO_IMAGE_FINAL") {
          if (toolResultCount("image_gen") > 0) return streamedText("我已基于观察结果完成图片并同步到画布。");
          if (toolResultCount("view_image") > 0) {
            return streamedToolCall("image_gen", {
              operation: "generate",
              prompt: "VIEW_IMAGE_CHAIN_PROMPT",
              count: 1,
              ratio: "1:1",
              resolution: "1080P",
              brief: "基于已观察的参考图生成新图。",
            });
          }
          return streamedToolCall("view_image", { path: fixtureImagePath, detail: "high" });
        }
        if (currentIntent === "SELFTEST_WEB_SEARCH_TO_IMAGE_FINAL") {
          if (toolResultCount("image_gen") > 0) return streamedText("我已结合检索结果完成图片并同步到画布。");
          const streamed = streamedResponsesOutput([
            {
              type: "web_search_call",
              id: "selftest-native-web-search",
              status: "completed",
              action: { type: "search", query: "2026 跨境电商 商品图 版式趋势" },
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "我已检索相关趋势，接下来生成主视觉。" }],
            },
            {
              type: "function_call",
              call_id: "selftest-image-after-web-search",
              name: "image_gen",
              arguments: JSON.stringify({
              operation: "generate",
              prompt: "WEB_SEARCH_CHAIN_PROMPT",
              count: 1,
              ratio: "4:5",
              resolution: "1080P",
              brief: "结合检索到的电商趋势生成商品主视觉。",
              }),
            },
          ]);
          for (const chunk of streamed.chunks) request.onStreamEvent?.(chunk);
          return streamed;
        }
        if (currentIntent === "SELFTEST_EXPERIENCE_TO_IMAGE_FINAL") {
          if (toolResultCount("image_gen") > 0) return streamedText("我已记录经验并按新原则完成一版图片。");
          if (toolResultCount("experience") > 0) {
            return streamedToolCall("image_gen", {
              operation: "generate",
              prompt: "EXPERIENCE_CHAIN_PROMPT",
              count: 1,
              ratio: "3:4",
              resolution: "1080P",
              brief: "按刚记录的构图经验生成新版图片。",
            });
          }
          return streamedToolCall("experience", {
            action: "add",
            title: "近景构图经验",
            text: "人物近景应让脸部与上半身占据画面主要区域，并控制零碎装饰数量。",
            rating: "good",
          });
        }
        if (currentIntent === "SELFTEST_EXACT_DUPLICATE_TOOL_CALLS") {
          if (toolResultCount("image_gen") > 0) return streamedText("两组不同参数的图片调用均已完成。");
          return streamedToolCalls([
            {
              name: "image_gen",
              arguments: {
                operation: "generate",
                prompt: "EXACT_DUPLICATE_PROMPT_A",
                count: 1,
                ratio: "1:1",
                resolution: "1080P",
                brief: "生成精确重复防护测试图。",
              },
            },
            {
              name: "image_gen",
              arguments: {
                brief: "生成精确重复防护测试图。",
                resolution: "1080P",
                ratio: "1:1",
                count: 1,
                prompt: "EXACT_DUPLICATE_PROMPT_A",
                operation: "generate",
              },
            },
            {
              name: "image_gen",
              arguments: {
                operation: "generate",
                prompt: "EXACT_DUPLICATE_PROMPT_B",
                count: 1,
                ratio: "1:1",
                resolution: "1080P",
                brief: "使用不同参数生成第二张测试图。",
              },
            },
          ]);
        }
        if (currentIntent === "SELFTEST_SINGLE_ITEM_COMPAT_TOP") {
          if (toolResultCount("image_gen") > 0) return streamedText("单图兼容测试完成。");
          return streamedToolCall("image_gen", {
            operation: "generate",
            prompt: "SINGLE_ITEM_TOP_PROMPT",
            count: 1,
            items: [{ title: "单图", prompt: "SINGLE_ITEM_TOP_PROMPT" }],
            ratio: "3:4",
            resolution: "1080P",
            brief: "生成一张单图兼容测试图片。",
          });
        }
        if (currentIntent === "SELFTEST_SINGLE_ITEM_PROMOTE") {
          if (toolResultCount("image_gen") > 0) return streamedText("单项提示词提升测试完成。");
          return streamedToolCall("image_gen", {
            operation: "generate",
            count: 1,
            items: [{ title: "单图", prompt: "SINGLE_ITEM_PROMOTED_PROMPT", ratio: "4:5", quality: "high" }],
            resolution: "1080P",
            brief: "兼容单项 items 并生成图片。",
          });
        }
        if (currentIntent === "SELFTEST_SINGLE_ITEM_AMBIGUOUS") {
          if (toolResultCount("image_gen") > 1) return streamedText("图片已完成生成。");
          return toolResultCount("image_gen") > 0
            ? streamedToolCall("image_gen", {
                operation: "generate",
                prompt: "AMBIGUOUS_TOP_PROMPT",
                count: 1,
                ratio: "1:1",
                resolution: "1080P",
                brief: "修正参数后生成单张图片。",
              })
            : streamedToolCalls([
                {
                  name: "image_gen",
                  arguments: {
                    operation: "generate",
                    prompt: "AMBIGUOUS_TOP_PROMPT",
                    count: 1,
                    items: [{ title: "冲突单图", prompt: "DIFFERENT_ITEM_PROMPT" }],
                    ratio: "1:1",
                    resolution: "1080P",
                    brief: "生成一张存在参数冲突的测试图片。",
                  },
                },
                {
                  name: "workflow",
                  arguments: { operation: "list_nodes", brief: "读取当前成果。" },
                },
              ]);
        }
        if (currentIntent === "SELFTEST_LAYER_ARGUMENT_INVALID") {
          const hasToolResult = (request.messages || []).some((message) => message?.role === "tool");
          return hasToolResult
            ? streamedText("已在内部重新规划分层请求。")
            : streamedToolCall("image_gen", {
                operation: "layers",
                prompt: "LAYER_INVALID_PROMPT",
                count: 1,
                parentId: "missing-layer-source",
                layerPlan: [
                  { id: "background", title: "背景", role: "background", prompt: "纯背景", transparent: false },
                  { id: "subject", title: "主体", role: "subject", prompt: "主体", transparent: true },
                ],
                brief: "生成分层 PNG。",
              });
        }
        if (currentIntent === "SELFTEST_REDRAW_OPEN_INVALID") {
          const hasToolResult = (request.messages || []).some((message) => message?.role === "tool");
          return hasToolResult
            ? streamedText("已在内部重新规划区域重绘请求。")
            : streamedToolCall("image_gen", {
                operation: "redraw",
                prompt: "REDRAW_INVALID_PROMPT",
                count: 1,
                parentId: "missing-redraw-source",
                brief: "打开区域重绘。",
              });
        }
        if (currentIntent === "SELFTEST_REDRAW_OPEN_VALID") {
          if (toolResultCount("image_gen") > 0) return streamedText("区域重绘编辑器已打开。");
          return streamedToolCall("image_gen", {
            operation: "redraw",
            prompt: "REDRAW_VALID_PROMPT",
            count: 1,
            brief: "打开区域重绘。",
          });
        }
        if (currentIntent === "SELFTEST_LAYER_HINT_PASSTHROUGH") {
          if (toolResultCount("image_gen") > 0) return streamedText("分层图像已生成并完成参数透传。");
          return streamedToolCall("image_gen", {
            operation: "layers",
            prompt: "LAYER_HINT_PASSTHROUGH_PROMPT",
            count: 1,
            layerPlan: [
              { id: "background", title: "背景", role: "background", prompt: "深青背景", transparent: false },
              { id: "subject", title: "主体", role: "subject", prompt: "青色主体", transparent: true },
            ],
            brief: "生成两层 PNG。",
          });
        }
        if (currentIntent === "SELFTEST_LAYER_CONCURRENCY") {
          if (toolResultCount("image_gen") > 0) return streamedText("分层并发自测完成。");
          return streamedToolCall("image_gen", {
            operation: "layers",
            prompt: "LAYER_CONCURRENCY_PROMPT",
            count: 1,
            layerPlan: [
              { id: "background", title: "背景", role: "background", prompt: "背景", transparent: false },
              { id: "subject", title: "人物", role: "subject", prompt: "人物", transparent: true },
              { id: "product", title: "商品", role: "decoration", prompt: "商品", transparent: true },
              { id: "foreground", title: "前景", role: "foreground", prompt: "前景", transparent: true },
              { id: "title", title: "标题", role: "text", prompt: "标题", text: "标题", transparent: true },
              { id: "copy", title: "正文", role: "text", prompt: "正文", text: "正文", transparent: true },
            ],
            brief: "验证分层图片请求并发上限。",
          });
        }
        if (currentIntent === "SELFTEST_AUTONOMY_TEXT_ONLY") {
          return streamedText("模型自主选择直接回复，没有调用工具。");
        }
        if (currentIntent === "SELFTEST_AUTONOMY_ARGS") {
          if (toolResultCount("image_gen") > 0) return streamedText("模型自主参数生图完成。");
          return streamedToolCall("image_gen", {
            operation: "generate",
            prompt: "MODEL_OWN_PROMPT 保持模型给出的画面语义。",
            count: 2,
            generationMode: "sequential",
            ratio: "4:5",
            resolution: "1080P",
            quality: "high",
            parentId: "node-b",
            brief: "按模型自主决定生成两张图片。",
          });
        }
        if (currentIntent === "SELFTEST_TASK_SCOPE_BINDING") {
          if (toolResultCount("image_gen") > 0) return streamedText("TaskScope 素材角色绑定已完成。");
          return streamedToolCall("image_gen", {
            operation: "edit",
            prompt: "只修改 A1 商品原图，参考 B1 的蓝金配色，输出一张。",
            parentId: "node-a",
            sourceAssetId: "scope-source-a1",
            referenceImages: [{ assetId: "scope-reference-b1", role: "style", purpose: "仅参考蓝金配色。" }],
            count: 1,
          });
        }
        if (currentIntent === "SELFTEST_INTERNAL_TOOL_PROBE") {
          return streamedToolCall("context_manage", {
            action: "add",
            target: "fastmemory",
            text: "MUST_NOT_WRITE_INTERNAL_TOOL_PROBE",
          });
        }
        if (currentIntent === "SELFTEST_TOOL_ENVELOPE_PROBE") {
          const hasToolResult = (request.messages || []).some((message) => message?.role === "tool");
          return hasToolResult
            ? streamedText("工具回执隔离自测完成。")
            : streamedToolCall("experience", {
                action: "read",
                selector: "fmem-20260712-999999",
                keywords: ["MUST_NOT_REACH_PROGRESS"],
                sourceEntryIds: ["ent-20260712-999998"],
              });
        }
        if (currentIntent === "SELFTEST_SILENT_FINAL_FALLBACK") {
          return toolResultCount("experience") > 0
            ? streamedText("")
            : streamedToolCall("experience", { action: "read" });
        }
        if (currentIntent === "SELFTEST_TOOL_FAILURE_PROBE") {
          const hasToolResult = (request.messages || []).some((message) => message?.role === "tool");
          return hasToolResult
            ? streamedText("工具失败隔离自测完成。")
            : streamedToolCall("view_image", { path: "missing-selftest-image.png", detail: "high" });
        }
        if (currentIntent === "SELFTEST_TERMINATED_IMAGE_ERROR") {
          return toolResultCount("image_gen") > 0
            ? streamedText("已识别为可恢复的上游连接中断。")
            : streamedToolCall("image_gen", {
                operation: "generate",
                prompt: "SELFTEST_TERMINATED_IMAGE_ERROR",
                ratio: "1:1",
                resolution: "720P",
                count: 1,
              });
        }
        return streamedText("自测回复完成。");
      },
      serverGenerateImage: async (request) => {
        capturedImageRequests.push(request);
        const trackedLayerRequest = Boolean(request.layerGroupId && request.layerId);
        const requestPromptBase = providerPromptBase(request);
        const trackedParallelRequest = requestPromptBase === "EXPLICIT_PARALLEL_PROMPT";
        const parallelRequestIndex = trackedParallelRequest
          ? Math.max(1, Number(String(request.runId || "").match(/-(\d+)$/)?.[1] || 1))
          : 0;
        if (trackedLayerRequest) {
          activeLayerImageRequests += 1;
          maximumLayerImageConcurrency = Math.max(maximumLayerImageConcurrency, activeLayerImageRequests);
        }
        if (trackedParallelRequest) {
          activeParallelImageRequests += 1;
          maximumParallelImageConcurrency = Math.max(maximumParallelImageConcurrency, activeParallelImageRequests);
        }
        try {
          if (trackedLayerRequest) await new Promise((resolve) => setTimeout(resolve, 18));
          if (trackedParallelRequest) {
            await new Promise((resolve) => setTimeout(resolve, parallelRequestIndex === 1 ? 24 : 4));
            parallelImageCompletionOrder.push(parallelRequestIndex);
          }
          if (requestPromptBase === "SELFTEST_TERMINATED_IMAGE_ERROR") throw new Error("terminated");
          if (request.layerRole === "subject" && typeof request.onRetry === "function") {
            request.onRetry({ category: "transient", retryCount: 1, maxRetries: 5, index: 0, count: 1 });
          }
          return {
            ok: true,
            model: request.model,
            size: request.size,
            quality: request.quality,
            assets: [{
              path: fixtureImagePath,
              name: trackedParallelRequest ? `parallel-${parallelRequestIndex}.png` : "autonomy-fixture.png",
              mimeType: "image/png"
            }],
          };
        } finally {
          if (trackedLayerRequest) activeLayerImageRequests -= 1;
          if (trackedParallelRequest) activeParallelImageRequests -= 1;
        }
      },
    });

    const migratedPrompt = assertOk(runtime.getMainPrompt(), "get migrated Main Agent Prompt");
    assert.equal(existsSync(dbPath), true, "Legacy memory database must migrate to the canonical naimage filename");
    assert.equal(existsSync(legacyDbPath), true, "Legacy memory migration must retain the source database");
    assert.equal(readConversationSummary(dbPath, "legacy_brand_migration"), '"preserved"');
    assert.equal(migratedPrompt.text, "LEGACY_MAIN_FIRST\n\nLEGACY_MAIN_SECOND");
    assert.equal(migratedPrompt.defaultUpdateAvailable, true, "Legacy custom Prompt should be marked as not based on the current default");
    assert.equal(migratedPrompt.baseDefaultPromptRevision, 0);
    assert.equal(migratedPrompt.baseDefaultPromptHash, "");
    assert.match(migratedPrompt.currentPromptHash, /^[a-f0-9]{64}$/);
    assert.match(migratedPrompt.defaultPromptHash, /^[a-f0-9]{64}$/);
    assert.equal(migratedPrompt.text.includes("prompt-legacy"), false, "Legacy prompt IDs must not decorate prompt text");
    assert.equal(migratedPrompt.text.includes("Metadata title"), false, "Legacy titles must not decorate prompt text");
    assert.equal(migratedPrompt.text.includes("INACTIVE_PROMPT_MUST_NOT_MIGRATE"), false);
    assert.equal(forbiddenPublicMetadata.test(migratedPrompt.text), false, "Legacy Prompt migration must remove internal metadata lines");

    const migratedStore = readJson(promptPath);
    assert.equal(migratedStore.version, 2);
    assert.equal(migratedStore.format, "plain-text");
    assert.equal(migratedStore.contractRevision, 14);
    assert.equal(migratedStore.baseDefaultPromptRevision, 0);
    assert.equal(migratedStore.baseDefaultPromptHash, "");
    assert.equal(Object.prototype.hasOwnProperty.call(migratedStore, "entries"), false, "Prompt v2 must not retain entries");
    assert.equal(migratedStore.mainPrompt, migratedPrompt.text);
    assert.equal(migratedStore.memoryPrompt, "LEGACY_MEMORY_PROMPT");

    writeJson(promptPath, {
      version: 2,
      format: "plain-text",
      mainPrompt: [
        "LEGACY_V2_KEEP_FIRST",
        "",
        "memory/context_manage 属于内部维护，不主动调用。",
        "",
        "用户要求查看有哪些 Agent、列出子 Agent 或检查 Agent 状态时，调用 workflow(operation=list_agents)。创建子 Agent 时调用 workflow(operation=create_agent_node)，parentId 指向母 Agent。",
        "",
        "entryId: ent-20260712-000001",
        "LEGACY_V2_KEEP_LAST",
      ].join("\n"),
      memoryPrompt: [
        "LEGACY_MEMORY_KEEP",
        "维护任务会一次性给出 datememorycontext 或需要 compact 的 entries。只处理本轮 payload，不主动展开主 Agent 的完整上下文。",
        "压缩后写入 fastmemory。",
      ].join("\n"),
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    const migratedLegacyV2 = assertOk(runtime.getMainPrompt(), "migrate stale plain-text Prompt contract");
    assert(migratedLegacyV2.text.includes("LEGACY_V2_KEEP_FIRST"));
    assert(migratedLegacyV2.text.includes("LEGACY_V2_KEEP_LAST"));
    assert(migratedLegacyV2.text.includes("后台上下文维护由运行时自动完成"));
    assert.equal(/create_agent_node|list_agents|manage_agent|子\s*Agent|母\s*Agent|context_manage|entryId/i.test(migratedLegacyV2.text), false);
    assert.equal(migratedLegacyV2.defaultUpdateAvailable, true);
    const migratedLegacyV2Store = readJson(promptPath);
    assert.equal(migratedLegacyV2Store.contractRevision, 14);
    assert.equal(migratedLegacyV2Store.memoryPrompt.includes("需要 compact 的 entries"), false);
    assert(migratedLegacyV2Store.memoryPrompt.includes("当前项目当前会话的 fastmemory"));

    const schemaSettings = {
      agentModel: "selftest-agent-model",
      imageModel: "gpt-image-2",
      imageModelPool: ["gpt-image-2", "gpt-image-1.5"],
    };
    assert.deepEqual(
      normalizeImageToolFrame({ model: "gpt-image-2", ratio: "4:5", resolution: "4K" }, schemaSettings),
      { ratio: "4:5", resolution: "4K", size: "2576x3216", requestSize: "1024x1536" },
      "Image 2 4K portrait delivery must preserve 4:5 instead of falling back to square",
    );
    assert.deepEqual(
      normalizeImageToolFrame({ model: "gpt-image-2", ratio: "16:9", resolution: "4K" }, schemaSettings),
      { ratio: "16:9", resolution: "4K", size: "3840x2160", requestSize: "1536x1024" },
      "Image 2 4K landscape delivery must preserve 16:9 within the pixel budget",
    );
    const schemasBeforePromptSave = runtime.getToolSchemas(schemaSettings);
    const schemasBeforePromptSaveJson = JSON.stringify(schemasBeforePromptSave);
    assert.equal(toolSchemas, ownedToolSchemas, "agent-runtime facade must re-export the owned internal tool schema factory");
    assert.deepEqual(schemasBeforePromptSave, ownedAgentToolSchemas(schemaSettings), "Runtime public schemas must come from the dedicated schema owner");
    assert(schemasBeforePromptSave.length > 0, "Expected public Agent tool schemas");
    assert.equal(
      /\b(?:selector|entryId|entry_id|memoryRef|sourceEntryIds|selectedEntryIds)\b|\b(?:fmem|ent|pmt|mctx)-[a-z0-9_-]+\b/i.test(schemasBeforePromptSaveJson),
      false,
      `Public Agent tool schemas leaked internal metadata: ${schemasBeforePromptSaveJson}`,
    );
    const contextManageSchema = toolSchemas(schemaSettings).find((tool) => tool.function?.name === "context_manage");
    assert(contextManageSchema, "Expected internal context_manage schema");
    assert.equal(
      contextManageSchema.function.parameters.properties.target.enum.includes("prompt"),
      false,
      "Prompt must be managed only through its dedicated plain-text configuration API",
    );
    const publicExperienceSchema = schemasBeforePromptSave.find((tool) => tool.function?.name === "experience");
    assert(publicExperienceSchema, "Expected public Experience schema");
    const publicExperienceProperties = publicExperienceSchema.function.parameters.properties || {};
    assert.equal(Object.prototype.hasOwnProperty.call(publicExperienceProperties, "selector"), false, "Public Experience schema must not expose selector");
    assert.equal(Object.prototype.hasOwnProperty.call(publicExperienceProperties, "sourceEntryIds"), false, "Public Experience schema must not expose source entry IDs");
    assert.equal(Object.prototype.hasOwnProperty.call(publicExperienceProperties, "keywords"), false, "Public Experience schema must not expose internal keywords");
    assert.equal(publicExperienceSchema.function.parameters.additionalProperties, false, "Public Experience schema must reject unknown internal fields");
    assert.equal(schemasBeforePromptSave.some((tool) => ["context_manage", "memory"].includes(tool.function?.name)), false, "Main model must not receive internal memory tools");
    const publicImageSchema = schemasBeforePromptSave.find((tool) => tool.function?.name === "image_gen");
    const publicImageProperties = publicImageSchema?.function?.parameters?.properties || {};
    const internalImageSchema = toolSchemas(schemaSettings).find((tool) => tool.function?.name === "image_gen");
    assert.deepEqual(
      internalImageSchema?.function?.parameters?.properties?.scopeExecution?.enum,
      ["all-goal-sources"],
      "Internal image_gen must accept only the runtime-expanded Goal scope mode",
    );
    assert(publicImageProperties.sourceAssetId, "Public image_gen must bind SOURCE by TaskScope assetId");
    assert.deepEqual(
      publicImageProperties.scopeExecution?.enum,
      ["all-goal-sources"],
      "Public image_gen must expose the single Goal scope execution mode",
    );
    assert.match(publicImageProperties.scopeExecution?.description || "", /frozen=true.*完整.*Goal TaskScope/);
    assert.match(publicImageProperties.scopeExecution?.description || "", /运行时.*SOURCE bindingId.*逐绑定展开/);
    assert.match(publicImageProperties.scopeExecution?.description || "", /模型.*Goal.*只调用一次 image_gen/);
    assert.match(publicImageProperties.scopeExecution?.description || "", /普通或不完整 TaskScope.*省略/);
    assert.equal(Object.prototype.hasOwnProperty.call(publicImageProperties, "sourcePath"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(publicImageProperties, "maskImage"), false, "Public model must not bypass the painted-region editor with a local mask path");
    assert.equal(Object.prototype.hasOwnProperty.call(publicImageProperties, "maskDataUrl"), false, "Public model must not inject a mask payload");
    assert.deepEqual(publicImageProperties.sourceImage?.required, ["bindingId"]);
    assert.equal(Object.prototype.hasOwnProperty.call(publicImageProperties.sourceImage?.properties || {}, "path"), false);
    assert.deepEqual(publicImageProperties.referenceImages?.items?.required, ["bindingId"]);
    assert.equal(Object.prototype.hasOwnProperty.call(publicImageProperties.referenceImages?.items?.properties || {}, "path"), false);
    assert.equal(publicImageProperties.referenceImages?.items?.properties?.role?.enum?.includes("source"), false);
    assert.equal(publicImageProperties.referenceImages?.items?.properties?.role?.enum?.includes("edit_target"), false);
    const nativeWebSearchSchema = schemasBeforePromptSave.find((tool) => tool?.type === "web_search");
    assert(nativeWebSearchSchema, "Main model must receive native Responses web_search");
    assert.equal(Object.prototype.hasOwnProperty.call(nativeWebSearchSchema, "function"), false, "Native web_search must not be wrapped as a custom function");
    const viewImageSchema = schemasBeforePromptSave.find((tool) => tool.function?.name === "view_image");
    assert.deepEqual(Object.keys(viewImageSchema?.function?.parameters?.properties || {}), ["path", "detail"]);
    assert.deepEqual(viewImageSchema?.function?.parameters?.properties?.detail?.enum, ["high", "original"]);
    assert.match(viewImageSchema?.function?.description || "", /detail=high.*multiple images/i);
    assert.match(viewImageSchema?.function?.parameters?.properties?.detail?.description || "", /high.*multi-image.*original.*single image/i);
    assert.equal(Object.prototype.hasOwnProperty.call(viewImageSchema?.function?.parameters?.properties || {}, "brief"), false, "Codex-native view_image schema must not gain naimage-only fields");
    const askUserSchema = schemasBeforePromptSave.find((tool) => tool.function?.name === "ask_user");
    assert(askUserSchema, "Main model must receive ask_user");
    assert.deepEqual(
      askUserSchema.function.parameters.properties.kind.enum,
      ["clarify", "confirm", "source_images", "reference_images"],
      "AskUser must distinguish editable SOURCE images from REFERENCE images",
    );
    assert.equal(askUserSchema.function.parameters.properties.maxSourceImages.maximum, 40);
    assert.equal(askUserSchema.function.parameters.properties.maxReferenceImages.maximum, 9);
    assert.equal(askUserSchema.function.parameters.properties.options.minItems, 2);
    assert.equal(askUserSchema.function.parameters.properties.options.maxItems, 3);
    assert.deepEqual(askUserSchema.function.parameters.properties.options.items.required, ["id", "label", "answer"]);
    assert.equal(askUserSchema.function.parameters.properties.options.items.properties.recommended.type, "boolean");
    assert.match(askUserSchema.function.description || "", /普通任务已有 materials.*source_images.*reference_images/);
    assert.match(publicImageProperties.sourceImage?.description || "", /普通任务通常省略.*Current Task Scope materials/);
    assert.match(publicImageProperties.referenceImages?.description || "", /Current Task Scope materials.*普通任务通常省略/);
    const structuredAskUser = await runtime.runTool("ask_user", {
      kind: "confirm",
      title: "确认批量策略",
      question: "这次容器组任务采用哪种批量方式？",
      options: [
        { id: "preview-3", label: "先做 3 版", description: "先核对方向。", answer: "先生成 3 版供我核对。", recommended: true },
        { id: "staged", label: "阶段性批量", description: "分批处理。", answer: "按阶段分批处理。", recommended: true },
        { id: "direct", label: "直接批量", answer: "我确认直接批量处理。" },
      ],
    }, { projectId: "project-ask-options", conversationId: "conversation-ask-options", nodes: [] });
    assert.equal(structuredAskUser.envelope?.ok, true, "Structured AskUser options must execute");
    assert.equal(structuredAskUser.actions?.[0]?.request?.options?.length, 3);
    assert.equal(structuredAskUser.actions?.[0]?.request?.options?.[0]?.recommended, true);
    assert.equal(structuredAskUser.actions?.[0]?.request?.options?.[1]?.recommended, false, "Only the first recommended option may remain recommended");
    assert.match(structuredAskUser.envelope?.visibleOutput || "", /preview-3: 先做 3 版 \(recommended\)/);
    const shellCommandSchema = schemasBeforePromptSave.find((tool) => tool.function?.name === "shell_command");
    assert(shellCommandSchema, "Main model must receive Codex-aligned shell_command");
    assert.deepEqual(Object.keys(shellCommandSchema.function.parameters.properties || {}), ["command", "workdir", "timeout_ms", "login"]);
    assert.equal(Object.prototype.hasOwnProperty.call(shellCommandSchema.function.parameters.properties || {}, "brief"), false, "Codex-native shell_command schema must not gain naimage-only fields");
    assert(publicImageSchema, "Expected public Image Gen schema");
    assert.deepEqual(
      publicImageSchema.function.parameters.properties.generationMode?.enum,
      ["parallel", "sequential"],
      "Public Image Gen schema must expose explicit parallel/sequential generation mode",
    );
    assert.match(
      publicImageSchema.function.parameters.properties.generationMode?.description || "",
      /基于这张继续给 N 版.*parallel/,
      "Public Image Gen schema must keep same-turn continuation variants parallel",
    );
    assert.match(
      publicImageSchema.function.parameters.properties.generationMode?.description || "",
      /sequential 仅用于.*一次一张/,
      "Public Image Gen schema must reserve sequential mode for genuinely ordered series",
    );
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /顶层.*prompt/);
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /count=1.*不要填写 items/);
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /AIDebug\/SELFTEST.*文件路径.*节点或调用 ID/);
    assert.match(publicImageSchema.function.parameters.properties.items?.items?.properties?.prompt?.description || "", /测试标记.*文件路径.*节点\/调用\/记忆 ID/);
    assert.match(publicImageSchema.function.parameters.properties.items?.description || "", /count=1.*省略 items.*顶层 prompt/);
    assert.match(publicImageSchema.function.parameters.properties.items?.description || "", /逐一列出.*必须.*items/);
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /多个互斥方案.*顶层 prompt/);
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /用途、主体与身份或商品.*参考图分工.*保留项与禁改项/);
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /只改变 X，保持 Y 不变/);
    assert.match(publicImageSchema.function.parameters.properties.prompt?.description || "", /参考图 purpose.*FastMemory.*通用风格/);
    assert.equal(publicImageSchema.function.parameters.properties.items?.minItems, undefined, "Optional public items must not force the model to synthesize placeholder entries");
    assert.match(publicImageSchema.function.parameters.properties.items?.description || "", /省略整个 items 字段/);
    assert.match(publicImageSchema.function.parameters.properties.operation?.description || "", /模型调用 cutout\/redraw 只会打开编辑器/);
    assert.match(publicImageSchema.function.parameters.properties.parentId?.description || "", /省略时自动使用当前选中/);
    assert.match(publicImageSchema.function.parameters.properties.sourceImage?.description || "", /Current Task Scope.*bindingId/);
    assert.equal(publicImageSchema.function.parameters.properties.assetIndex?.minimum, 0, "Public Image Gen schema must expose container source assetIndex");
    assert.match(publicImageSchema.function.parameters.properties.operation?.description || "", /cutout=.*透明 PNG/, "Public Image Gen schema must describe native transparent cutout output");
    const publicLayerRoleDescription = publicImageSchema.function.parameters.properties.layerPlan?.items?.properties?.role?.description || "";
    assert.match(publicLayerRoleDescription, /subject=.*人物.*动物.*生命主体/, "Layer role schema must reserve subject for living primary subjects");
    assert.match(publicLayerRoleDescription, /decoration=.*商品.*香水瓶.*服装单品.*手持物/, "Layer role schema must route products and props to decoration");
    assert.match(
      publicImageSchema.function.parameters.properties.resumeLayerGroupId?.description || "",
      /Current Workbench Snapshot.*真实组 ID.*复用.*成功图层/,
      "Public Image Gen schema must expose recoverable layer-group identity without asking the model to guess it",
    );
    assert.match(
      publicImageSchema.function.parameters.properties.retryLayerIds?.description || "",
      /完整复制.*failed.*绝不能包含 successful/,
      "Public Image Gen schema must restrict targeted retries to the complete failed-layer set",
    );
    const currentDefaultPrompt = defaultPromptText("main");
    assert.match(currentDefaultPrompt, /role=subject 只用于.*人物.*动物.*有生命主体/);
    assert.match(currentDefaultPrompt, /香水瓶.*商品.*服装单品.*role=decoration/);
    assert.match(currentDefaultPrompt, /layerRecovery.*resumeLayerGroupId.*retryLayerIds.*successful 图层/);
    assert(publicImageSchema.function.parameters.properties.referenceImages?.items?.properties?.role, "Reference images must expose an optional role");
    assert(publicImageSchema.function.parameters.properties.referenceImages?.items?.properties?.purpose, "Reference images must expose an optional purpose");
    assert.deepEqual(
      publicImageSchema.function.parameters.properties.referenceImages?.items?.properties?.role?.enum,
      ["identity", "subject", "garment", "product", "style", "composition", "scene"],
      "Reference role schema must exclude SOURCE/edit-target roles",
    );
    assert.match(publicImageSchema.function.parameters.properties.referenceImages?.description || "", /普通任务通常省略.*参考用途.*不决定输出数量/);
    assert.match(publicImageSchema.function.parameters.properties.inputFidelity?.description || "", /人物身份.*商品结构.*服装版型.*high/);
    const publicWorkflowSchema = schemasBeforePromptSave.find((tool) => tool.function?.name === "workflow");
    assert(publicWorkflowSchema?.function?.parameters?.properties?.offset, "Public workflow schema must expose list_nodes offset");
    assert(publicWorkflowSchema?.function?.parameters?.properties?.limit, "Public workflow schema must expose list_nodes limit");
    assert(publicWorkflowSchema?.function?.parameters?.properties?.query, "Public workflow schema must expose list_nodes query");
    assert(publicWorkflowSchema?.function?.parameters?.properties?.type, "Public workflow schema must expose list_nodes type filter");
    assert(publicWorkflowSchema?.function?.parameters?.properties?.relation, "Public workflow schema must expose list_nodes relation filter");

    const promptBeforeRejectedSaves = runtime.getMainPrompt().text;
    assertRejected(runtime.saveMainPrompt({ text: "   \n\t" }), "empty Main Agent Prompt");
    assertRejected(runtime.saveMainPrompt({ text: "valid\0invalid" }), "NUL Main Agent Prompt");
    assertRejected(
      runtime.saveMainPrompt({ text: "x".repeat(migratedPrompt.maxChars + 1) }),
      "oversized Main Agent Prompt",
    );
    assert.equal(runtime.getMainPrompt().text, promptBeforeRejectedSaves, "Rejected prompt saves must not mutate storage");

    const legacyPhraseAsUserText = [
      "USER_AUTHORED_LEGACY_PHRASE",
      "工具输出可能被截断，回执会带 entryId 或 memoryRef。",
      "不暴露路径、entry id、内部参数。",
    ].join("\n");
    const legacyPhraseRoundTrip = assertOk(
      runtime.saveMainPrompt({ text: legacyPhraseAsUserText }),
      "round-trip user-authored v2 Prompt text",
    );
    assert.equal(legacyPhraseRoundTrip.text, legacyPhraseAsUserText);
    assert.equal(runtime.getMainPrompt().text, legacyPhraseAsUserText, "Prompt v2 reads must not rerun legacy phrase migration");

    const customPromptText = [
      "SELFTEST_MAIN_PROMPT_MARKER",
      "Answer ordinary questions directly and choose tools from the separately supplied schema.",
    ].join("\n");
    const savedPrompt = assertOk(runtime.saveMainPrompt({ text: customPromptText }), "save Main Agent Prompt");
    assert.equal(savedPrompt.text, customPromptText);
    assert.equal(savedPrompt.isDefault, false);
    assert.equal(savedPrompt.defaultUpdateAvailable, true);
    assert.equal(savedPrompt.defaultText, defaultPromptText("main"));
    assert.equal(runtime.getMainPrompt().text, customPromptText);
    assert.equal(JSON.stringify(runtime.getToolSchemas(schemaSettings)), schemasBeforePromptSaveJson, "Saving Prompt must not alter tool schemas");
    const savedPromptStore = readJson(promptPath);
    assert.equal(savedPromptStore.mainPrompt, customPromptText);
    assert.equal(savedPromptStore.baseDefaultPromptRevision, 0);
    assert.equal(savedPromptStore.baseDefaultPromptHash, "");
    assert.equal(Object.prototype.hasOwnProperty.call(savedPromptStore, "entries"), false);
    const rejectedContextPromptWrite = await runtime.runTool(
      "context_manage",
      { target: "prompt", action: "add", text: "MUST_NOT_REACH_PROMPT" },
      { settings: schemaSettings, nodes: [] },
    );
    assert.equal(rejectedContextPromptWrite.envelope?.ok, false, "context_manage(target=prompt) must be rejected");
    assert.equal(runtime.getMainPrompt().text, customPromptText, "Rejected context_manage Prompt write must not mutate Prompt text");
    assert.equal(JSON.stringify(rejectedContextPromptWrite.envelope).includes("MUST_NOT_REACH_PROMPT"), false, "Rejected Prompt write must not echo attempted text as visible output");

    const sourceImageRequest = await runtime.runTool(
      "ask_user",
      { kind: "source_images", title: "补充原图", question: "请上传需要处理的原图。", maxSourceImages: 18 },
      { settings: schemaSettings, nodes: [], toolRunId: "ask-source-selftest" },
    );
    assert.equal(sourceImageRequest.actions?.[0]?.type, "ui.source_images.open");
    assert.equal(sourceImageRequest.actions?.[0]?.request?.requestId, "ask-source-selftest");
    assert.equal(sourceImageRequest.actions?.[0]?.request?.maxSourceImages, 18);
    assert.equal(sourceImageRequest.actions?.[0]?.request?.kind, "source_images");
    const referenceImageRequest = await runtime.runTool(
      "ask_user",
      { kind: "reference_images", question: "请上传风格参考图。", maxReferenceImages: 6 },
      { settings: schemaSettings, nodes: [], toolRunId: "ask-reference-selftest" },
    );
    assert.equal(referenceImageRequest.actions?.[0]?.type, "ui.reference_images.open");
    assert.equal(referenceImageRequest.actions?.[0]?.request?.maxReferenceImages, 6);
    assert.equal(referenceImageRequest.actions?.[0]?.request?.kind, "reference_images");

    const scopeA = { projectId: "project-shared", conversationId: "conversation-a" };
    const scopeB = { projectId: "project-shared", conversationId: "conversation-b" };
    const crossProjectScope = { projectId: "project-other", conversationId: "conversation-a" };
    const scopeAInput = [
      "rating: excellent",
      "source: ent-20260712-000001",
      "selector: all",
      "keywords: portrait, lighting",
      "inline note entry_id: fmem-20260712-000009 selector: all keywords: hidden",
      '{"entry_id":"fmem-20260712-000010","selector":"all","keywords":["hidden"],"text":"internal"}',
      "A_VISIBLE_MEMORY",
      "Internal token fmem-20260712-000002 must disappear.",
      "Standalone fmem marker must disappear.",
    ].join("\n");
    const scopeBText = "B_VISIBLE_MEMORY";

    assertRejected(runtime.saveFastMemory({ ...scopeA, text: "  " }), "empty scoped FastMemory");
    assertRejected(runtime.saveFastMemory({ ...scopeA, text: "valid\0invalid" }), "NUL scoped FastMemory");
    const emptyScopeResult = runtime.saveFastMemory({ projectId: "", conversationId: "conversation-a", text: "text" });
    assertRejected(emptyScopeResult, "missing scoped FastMemory projectId");
    assertRejected(
      runtime.saveFastMemory({ projectId: "p".repeat(161), conversationId: "conversation-a", text: "text" }),
      "oversized scoped FastMemory projectId",
    );

    const fastMemoryLimit = runtime.getFastMemory(scopeA).maxChars;
    assertRejected(
      runtime.saveFastMemory({ ...scopeA, text: "x".repeat(fastMemoryLimit + 1) }),
      "oversized scoped FastMemory",
    );

    const savedA = assertOk(runtime.saveFastMemory({ ...scopeA, text: scopeAInput }), "save FastMemory scope A");
    const savedB = assertOk(runtime.saveFastMemory({ ...scopeB, text: scopeBText }), "save FastMemory scope B");
    assertPublicMemoryResponse(savedA, "save FastMemory scope A");
    assertPublicMemoryResponse(savedB, "save FastMemory scope B");
    assert.equal(savedA.text, "A_VISIBLE_MEMORY\nInternal token  must disappear.\nStandalone  marker must disappear.");
    assert.equal(savedB.text, scopeBText);

    const readA = assertOk(runtime.getFastMemory(scopeA), "get FastMemory scope A");
    const readB = assertOk(runtime.getFastMemory(scopeB), "get FastMemory scope B");
    const readCrossProject = assertOk(runtime.getFastMemory(crossProjectScope), "get cross-project FastMemory scope");
    assert.equal(readA.text, savedA.text);
    assert.equal(readB.text, scopeBText);
    assert.equal(readA.text.includes(scopeBText), false);
    assert.equal(readB.text.includes("A_VISIBLE_MEMORY"), false);
    assert.equal(readCrossProject.text, "");
    assert.equal(readCrossProject.isEmpty, true);
    assertPublicMemoryResponse(readA, "get FastMemory scope A");
    assertPublicMemoryResponse(readB, "get FastMemory scope B");
    assertPublicMemoryResponse(readCrossProject, "get cross-project FastMemory scope");

    const experienceRead = await runtime.runTool(
      "experience",
      { action: "read" },
      { settings: {}, nodes: [], ...scopeA },
    );
    assertOk(experienceRead.envelope, "read scoped FastMemory through model-visible Experience tool");
    assertPublicMemoryResponse(experienceRead.envelope, "Experience tool scoped FastMemory response");
    assert.equal(experienceRead.envelope.text, savedA.text);

    const rawFastMemory = readJson(fastMemoryPath);
    assert.equal(rawFastMemory.entries.length, 2);
    assert(
      rawFastMemory.entries.every((entry) => /^fmem-[a-z0-9_-]+$/i.test(String(entry.entry_id || ""))),
      "Raw internal FastMemory may retain generated fmem entry IDs",
    );
    assert(rawFastMemory.entries.some((entry) => entry.conversationId === scopeA.conversationId));
    assert(rawFastMemory.entries.some((entry) => entry.conversationId === scopeB.conversationId));

    await runtime.chat({
      ...scopeA,
      prompt: "只回复一句普通问候。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
    });
    assert.equal(capturedModelRequests.length, 1, "Expected one captured main-model request");
    const capturedRequest = capturedModelRequests[0];
    assert.equal(capturedRequest.messages[0].role, "developer");
    assert.equal(capturedRequest.messages[0].content, customPromptText, "Main model must receive the exact editable Prompt text");
    assert.equal(capturedRequest.messages[0].content.includes("prompt-main"), false, "Main model Prompt must not contain generated prompt IDs");
    assert.deepEqual(
      capturedRequest.tools,
      ownedAgentToolSchemas(schemaSettings, { includeNativeWebSearch: false }),
      "The active model must receive the schema-owned tool set after capability filtering",
    );
    const runtimeContextText = String(capturedRequest.messages[1]?.content || "");
    assert(runtimeContextText.includes("A_VISIBLE_MEMORY"), "Main model should receive scoped FastMemory text");
    assert.equal(runtimeContextText.includes(scopeBText), false, "Main model must not receive another conversation's FastMemory");
    assert.equal(/\bfmem-[a-z0-9_-]+\b|\bentry[_ ]?id\b|\bselector\s*:|\bkeywords\s*[:=]/i.test(runtimeContextText), false);
    assert.match(runtimeContextText, /Current Selected Node:\n暂无选中节点。/);
    assert.match(runtimeContextText, /Current Selected Nodes:\n暂无选中成果。/);
    assert.equal(/Current Selected Nodes:\nundefined\b/i.test(runtimeContextText), false, "An empty canvas selection must not become a literal undefined node ID");

    const runtimeSource = readFileSync(path.resolve(__dirname, "..", "agent-runtime.cjs"), "utf8");
    const memoryStoreSource = readFileSync(path.resolve(__dirname, "..", "runtime", "memory-store.cjs"), "utf8");
    const imageBatchNormalizationSource = readFileSync(path.resolve(__dirname, "..", "runtime", "image-batch-normalization.cjs"), "utf8");
    assert(runtimeSource.includes('require("./runtime/tool-schemas.cjs")'), "Agent runtime must consume the dedicated tool schema owner");
    assert.equal(/function\s+(?:normalizeToolSchemas|imageModelToolProperty|toolSchemas|agentToolSchemas)\s*\(/.test(runtimeSource), false, "Agent runtime facade must not duplicate tool schema implementations");
    assert(runtimeSource.includes('require("./runtime/responses-parser.cjs")'), "Agent runtime must consume the dedicated Responses parser owner");
    assert.equal(
      /function\s+(?:responsesTextPart|responseToolCallFromItem|messageFromResponsesOutput|messageFromResponse|reasoningDeltaFromChunk|contentDeltaFromChunk|mergeToolCallDelta|upsertResponsesToolCall|mergeResponsesToolCallEvent|responseFromStreamChunks)\s*\(/.test(runtimeSource),
      false,
      "Agent runtime facade must not duplicate Responses parsing or stream aggregation implementations",
    );
    assert.equal(typeof ownedCreateMemoryStore, "function", "Memory persistence must expose a dedicated store factory");
    assert(runtimeSource.includes('require("./runtime/memory-store.cjs")'), "Agent runtime must consume the dedicated memory store owner");
    assert(memoryStoreSource.includes("function createMemoryStore"), "The memory owner must retain the store factory implementation");
    assert.match(memoryStoreSource, /CREATE TABLE IF NOT EXISTS runtime_meta/);
    assert.equal(
      /CREATE TABLE IF NOT EXISTS|new DatabaseSync|naimage-memory\.db|datememorycontext\.json|promptcontext\.json|fastmemory\.json|memorycontext\.json/.test(runtimeSource),
      false,
      "Agent runtime facade must not own SQLite or JSON memory persistence",
    );
    assert.equal(
      /function\s+(?:ensureMemory|readPromptTextStore|writePromptTextStore|readExternalStore|writeExternalStore|recordContextEntry|getMainPrompt|saveMainPrompt|resetMainPrompt|getFastMemory|saveFastMemory|resetFastMemory|clearConversationState|contextManage|experienceManage|memoryAdd|memoryCheck|memoryRead|compactStateForPayload|protocolStateForPayload|appendConversationProtocolTurn)\s*\(/.test(runtimeSource),
      false,
      "Agent runtime facade must not duplicate memory CRUD or conversation persistence implementations",
    );
    assert(runtimeSource.includes('require("./runtime/image-batch-normalization.cjs")'), "Agent runtime must consume the dedicated image batch normalization owner");
    assert.match(imageBatchNormalizationSource, /function\s+createImageBatchNormalization\s*\(/);
    assert.equal(
      /const\s+imageBatchPlaceholderPattern\b|function\s+(?:isImageBatchPlaceholder|comparableSingleItemField|normalizedVisualPrompt|resolveCompatibleSinglePrompt|normalizeSingleImageItemCompatibility|normalizeImageBatchItems)\s*\(/.test(runtimeSource),
      false,
      "Agent runtime facade must not duplicate image batch compatibility normalization implementations",
    );
    assert.equal(
      /require\(["'][^"']*agent-runtime\.cjs["']\)/.test(imageBatchNormalizationSource),
      false,
      "Image batch normalization must not import back from the Agent runtime facade",
    );
    assert.equal(/intentSystemMessage|Current Image Intent|model-force|model-arg-correct/.test(runtimeSource), false, "Runtime source must not retain hidden intent injection or argument-force phases");
    assert.equal(/requestOptions\.tools\s*\?\?\s*toolSchemas/.test(runtimeSource), false, "callModel must not fall back to the complete internal tool schema");
    assert(runtimeSource.includes("必须显式提供 tools 数组"), "callModel should enforce explicit tool exposure at every caller");

    const autonomyNodes = [
      {
        id: "node-a",
        title: "当前选中的来源 A",
        type: "image",
        status: "done",
        assets: [{ path: fixtureImagePath, name: "a.png", mimeType: "image/png" }],
        imageParams: { prompt: "SOURCE_A_PROMPT", ratio: "3:4", resolution: "1080P" },
      },
      {
        id: "node-b",
        title: "模型自主选择的来源 B",
        type: "image",
        status: "done",
        assets: [{ path: fixtureImagePath, name: "b.png", mimeType: "image/png" }],
        imageParams: { prompt: "SOURCE_B_PROMPT", ratio: "1:1", resolution: "2K" },
      },
      {
        id: "node-container",
        title: "双图来源容器",
        type: "image",
        status: "done",
        imageContainer: true,
        assets: [
          { path: fixtureImagePath, name: "container-a.png", mimeType: "image/png" },
          { path: fixtureImagePathB, name: "container-b.png", mimeType: "image/png" },
        ],
        imageParams: { prompt: "CONTAINER_SOURCE_PROMPT", ratio: "1:1", resolution: "1080P" },
      },
    ];

    const singleItemTopProgress = [];
    const singleItemTopBefore = capturedImageRequests.length;
    const singleItemTop = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_SINGLE_ITEM_COMPAT_TOP 生成一张单图。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
      progress: (event) => singleItemTopProgress.push(event),
    });
    assertOk(singleItemTop, "single-item items compatibility with matching top-level prompt");
    assert.equal(capturedImageRequests.length, singleItemTopBefore + 1);
    assertProviderPromptIncludesDeliverySpecification(capturedImageRequests.at(-1), "SINGLE_ITEM_TOP_PROMPT");
    const singleItemTopInput = singleItemTopProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(singleItemTopInput?.prompt, "SINGLE_ITEM_TOP_PROMPT");
    assert.equal(singleItemTopInput?.count, 1);
    assert.equal(singleItemTopInput?.items, undefined);
    assert.equal(singleItemTopProgress.some((event) => event?.phase === "tool-error" || event?.phase === "image-error"), false);

    const singleItemPromoteProgress = [];
    const singleItemPromoteBefore = capturedImageRequests.length;
    const singleItemPromote = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_SINGLE_ITEM_PROMOTE 兼容只有单项 items.prompt 的单图调用。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
      progress: (event) => singleItemPromoteProgress.push(event),
    });
    assertOk(singleItemPromote, "single-item items prompt promotion");
    assert.equal(capturedImageRequests.length, singleItemPromoteBefore + 1);
    assertProviderPromptIncludesDeliverySpecification(capturedImageRequests.at(-1), "SINGLE_ITEM_PROMOTED_PROMPT");
    const singleItemPromoteInput = singleItemPromoteProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(singleItemPromoteInput?.prompt, "SINGLE_ITEM_PROMOTED_PROMPT");
    assert.equal(singleItemPromoteInput?.ratio, "4:5");
    assert.equal(singleItemPromoteInput?.quality, "high");
    assert.equal(singleItemPromoteInput?.items, undefined);
    assert.equal(singleItemPromoteProgress.some((event) => event?.phase === "tool-error" || event?.phase === "image-error"), false);

    const ambiguousProgress = [];
    const ambiguousImageBefore = capturedImageRequests.length;
    const ambiguousResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_SINGLE_ITEM_AMBIGUOUS 验证冲突单项 items 在模型内部修正。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
      progress: (event) => ambiguousProgress.push(event),
    });
    assertOk(ambiguousResult, "ambiguous single-item internal correction");
    assert.equal(capturedImageRequests.length, ambiguousImageBefore + 1, "Ambiguous first call must not reach the image API");
    assertProviderPromptIncludesDeliverySpecification(capturedImageRequests.at(-1), "AMBIGUOUS_TOP_PROMPT");
    const ambiguousRequests = capturedModelRequests.filter((request) => JSON.stringify(request.messages || []).includes("SELFTEST_SINGLE_ITEM_AMBIGUOUS"));
    assert.equal(ambiguousRequests.length, 3, "Ambiguous model arguments should be returned internally, corrected, then followed by a native model final response");
    assert.equal(ambiguousProgress.filter((event) => event?.phase === "tool-start" && event?.tool === "image_gen").length, 1, "Only the corrected, executable image call should create a visible tool-start state");
    assert.equal(ambiguousProgress.filter((event) => event?.phase === "image-request").length, 1);
    assert.equal(
      ambiguousProgress.some((event) => event?.phase === "tool-error" || event?.phase === "image-error"),
      false,
      "Internal argument normalization failures must not create user-visible failure cards",
    );
    assert.equal(
      ambiguousProgress.some((event) => event?.phase === "tool-skip"),
      false,
      "Tools following an internal-only argument failure must be acknowledged to the model without creating a visible skip card",
    );
    assert.equal(JSON.stringify(ambiguousResult.toolResults || []).includes("invalid_tool_arguments"), false, "Internal validation failures must not leak through public chat toolResults");
    assert.equal(JSON.stringify(ambiguousResult.toolResults || []).includes("上一工具失败"), false, "Internal pending-tool skips must not leak through public chat toolResults");
    assert.equal(/顶层 prompt|items\[0\]|参数.*修正/.test(String(ambiguousResult.content || "")), false, "Internal validation details must not become assistant chat正文");

    const invalidLayerProgress = [];
    const invalidLayerImageBefore = capturedImageRequests.length;
    const invalidLayerResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_LAYER_ARGUMENT_INVALID 验证分层参数在工具卡出现前内部拒绝。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => invalidLayerProgress.push(event),
    });
    assertOk(invalidLayerResult, "invalid layered-image arguments remain internal");
    assert.equal(capturedImageRequests.length, invalidLayerImageBefore, "Invalid layered-image arguments must not reach the image service");
    assert.equal(invalidLayerProgress.some((event) => event?.phase === "tool-start" && event?.tool === "image_gen"), false);
    assert.equal(invalidLayerProgress.some((event) => ["tool-error", "image-error", "tool-skip"].includes(event?.phase)), false);
    assert.equal(JSON.stringify(invalidLayerResult.toolResults || []).includes("invalid_tool_arguments"), false);
    assert.equal(/missing-layer-source|parentId=.*不存在|参数.*修正/.test(String(invalidLayerResult.content || "")), false);

    const invalidRedrawProgress = [];
    const invalidRedrawResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_REDRAW_OPEN_INVALID 验证无效区域重绘来源在工具卡出现前内部拒绝。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => invalidRedrawProgress.push(event),
    });
    assertOk(invalidRedrawResult, "invalid redraw-editor arguments remain internal");
    assert.equal(invalidRedrawProgress.some((event) => event?.phase === "tool-start" && event?.tool === "image_gen"), false);
    assert.equal(invalidRedrawProgress.some((event) => ["tool-error", "image-error", "tool-skip"].includes(event?.phase)), false);
    assert.equal(JSON.stringify(invalidRedrawResult.toolResults || []).includes("invalid_tool_arguments"), false);
    assert.equal(/missing-redraw-source|parentId=.*有效|参数.*修正/.test(String(invalidRedrawResult.content || "")), false);

    const validRedrawProgress = [];
    const validRedrawResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_REDRAW_OPEN_VALID 打开当前来源图的区域重绘编辑器。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      selectedNodeId: "node-a",
      referenceImages: [],
      progress: (event) => validRedrawProgress.push(event),
    });
    assertOk(validRedrawResult, "valid redraw-editor open request");
    assert(validRedrawResult.actions?.some((action) => action.type === "workflow.node.redraw" && action.id === "node-a"));
    assert.equal(validRedrawProgress.filter((event) => event?.phase === "tool-start" && event?.tool === "image_gen").length, 1);
    assert.equal(validRedrawProgress.some((event) => event?.phase === "tool-error" || event?.phase === "image-error"), false);

    const layerHintImageBefore = capturedImageRequests.length;
    const layerHintProgress = [];
    const layerHintResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_LAYER_HINT_PASSTHROUGH 验证分层语义无损传给图片服务。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => layerHintProgress.push(event),
    });
    assertOk(layerHintResult, "layer hint passthrough");
    const layerHintRequests = capturedImageRequests.slice(layerHintImageBefore);
    assert.equal(layerHintRequests.length, 3, "A two-layer task must request one preview and two independent layer assets");
    const backgroundLayerRequest = layerHintRequests.find((request) => request.layerId === "background");
    const subjectLayerRequest = layerHintRequests.find((request) => request.layerId === "subject");
    assert(backgroundLayerRequest, "Background layer request must preserve layerId");
    assert(subjectLayerRequest, "Subject layer request must preserve layerId");
    assert.equal(backgroundLayerRequest.layerRole, "background");
    assert.equal(backgroundLayerRequest.transparentPreferred, false);
    assert.equal(backgroundLayerRequest.background, "opaque");
    assert.equal(backgroundLayerRequest.layerOutputMode, "direct");
    assert.equal(subjectLayerRequest.layerRole, "subject");
    assert.equal(subjectLayerRequest.transparentPreferred, true);
    assert.equal(subjectLayerRequest.background, "transparent");
    assert.equal(subjectLayerRequest.layerOutputMode, "direct");
    assert(subjectLayerRequest.editImage?.path || subjectLayerRequest.editImage?.url, "Direct subject reconstruction must use the composed preview as its primary edit image");
    assert.match(subjectLayerRequest.prompt, /真正透明的完整人物 PNG 图层/);
    assert.match(subjectLayerRequest.prompt, /合理补全被商品、前景、文字或其他图层遮挡的身体与服装/);
    assert.match(subjectLayerRequest.prompt, /不得留下商品形状的透明洞/);
    assert.match(subjectLayerRequest.prompt, /目标外全部使用真实 alpha 透明/);
    assert.doesNotMatch(subjectLayerRequest.prompt, /输出与合成预览完全相同画布尺寸的二值语义蒙版/);
    assert.equal(typeof subjectLayerRequest.layerGroupId, "string");
    assert(subjectLayerRequest.layerGroupId && subjectLayerRequest.layerGroupId === backgroundLayerRequest.layerGroupId);
    assert(layerHintResult.actions?.some((action) => action.type === "workflow.layer.group"));
    const layerHintToolResults = JSON.stringify(layerHintResult.toolResults || []);
    assert.match(layerHintToolResults, /localCommit: pending/, "Layer tool result must report pending client commit until renderer validation finishes");
    assert.equal(/recomposed: yes|canvas: complete/i.test(layerHintToolResults), false, "Layer tool result must not claim renderer-side completion early");
    assert.equal(layerHintProgress.some((event) => event?.phase === "tool-error" || event?.phase === "image-error"), false);
    const layerToolStart = layerHintProgress.find((event) => event?.phase === "tool-start" && event?.tool === "image_gen");
    assert(layerToolStart?.operationId, "Layered image tool-start must expose one stable operationId");
    const layerVisibleProgress = layerHintProgress.filter((event) =>
      event?.tool === "image_gen" && ["tool-start", "tool-poll", "image-request", "image-retry", "image-response", "tool-done"].includes(event?.phase),
    );
    assert(
      layerVisibleProgress.every((event) => event.operationId === layerToolStart.operationId && event.toolRunId === layerToolStart.operationId),
      "All visible layered-image phases must share the parent tool operationId",
    );
    const layerRetry = layerVisibleProgress.find((event) => event.phase === "image-retry");
    assert(layerRetry?.childTaskId && layerRetry.childTaskId.includes("subject"), "Layer retry must retain its child task identity without becoming a second tool operation");
    const firstLayerAction = layerHintResult.actions?.find((action) => action.type === "workflow.layer.group");
    const firstLayerGroupNumber = Number(firstLayerAction?.node?.layerComposition?.groupNumber || firstLayerAction?.composition?.groupNumber || 0);
    assert(firstLayerGroupNumber > 0, "First layered result must reserve a positive group number");

    maximumLayerImageConcurrency = 0;
    const layerConcurrencyBefore = capturedImageRequests.length;
    const layerConcurrencyResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_LAYER_CONCURRENCY 验证六层图片请求并发。",
      settings: schemaSettings,
      messages: [],
      nodes: [
        ...autonomyNodes,
        {
          id: "persisted-layer-member",
          type: "image",
          title: "既有 PNG 图层",
          prompt: "既有 PNG 图层",
          status: "done",
          assets: [{ index: 1, path: fixtureImagePath }],
          layerGroup: { id: "existing-layer-group", groupNumber: firstLayerGroupNumber, order: 1, total: 2, layerId: "existing", layerTitle: "既有图层", visible: true, opacity: 1, detached: false },
        },
      ],
      referenceImages: [],
    });
    assertOk(layerConcurrencyResult, "layer image concurrency");
    assert.equal(capturedImageRequests.length, layerConcurrencyBefore + 7, "Six-layer task must request one preview and six layer assets");
    const secondLayerAction = layerConcurrencyResult.actions?.find((action) => action.type === "workflow.layer.group");
    assert.equal(Number(secondLayerAction?.node?.layerComposition?.groupNumber || secondLayerAction?.composition?.groupNumber || 0), firstLayerGroupNumber + 1, "Independent layer nodes must advance the next group number");
    assert.equal(maximumLayerImageConcurrency, 3, "Layer edit requests must be limited to three concurrent upstream uploads");
    const layerConcurrencyRequests = capturedImageRequests.slice(layerConcurrencyBefore);
    const productLayerRequest = layerConcurrencyRequests.find((request) => request.layerId === "product");
    const foregroundLayerRequest = layerConcurrencyRequests.find((request) => request.layerId === "foreground");
    const titleLayerRequest = layerConcurrencyRequests.find((request) => request.layerId === "title");
    assert(productLayerRequest && foregroundLayerRequest && titleLayerRequest, "Six-layer task must preserve product, foreground and title metadata");
    assert.equal(productLayerRequest.layerRole, "decoration");
    assert.equal(productLayerRequest.transparentPreferred, true);
    assert.equal(productLayerRequest.background, "transparent");
    assert.equal(productLayerRequest.layerOutputMode, "direct");
    assert.match(productLayerRequest.prompt, /透明或半透明材质必须重建为可独立移动的物件本体/);
    assert.match(productLayerRequest.prompt, /不得把人物手指、手掌、皮肤、衣服/);
    assert.match(productLayerRequest.prompt, /背景建筑、水面、花枝、台面、文字或其他图层烘焙进透明区域/);
    for (const maskLayerRequest of [foregroundLayerRequest, titleLayerRequest]) {
      assert.equal(maskLayerRequest.transparentPreferred, false);
      assert.equal(maskLayerRequest.background, "opaque");
      assert.equal(maskLayerRequest.layerOutputMode, "mask");
      assert.match(maskLayerRequest.prompt, /二值语义蒙版/);
      assert.match(maskLayerRequest.prompt, /纯白色/);
      assert.match(maskLayerRequest.prompt, /纯黑色/);
    }

    const nativeLoopScope = { projectId: "selftest-native-loop", conversationId: "conversation-native-loop" };
    const viewImageChainProgress = [];
    const viewImageChainBefore = capturedImageRequests.length;
    const viewImageChain = await runtime.chat({
      ...nativeLoopScope,
      prompt: "SELFTEST_VIEW_IMAGE_TO_IMAGE_FINAL 先观察参考图，再生成图片并由模型总结。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => viewImageChainProgress.push(event),
    });
    assertOk(viewImageChain, "view_image to image_gen native loop");
    assert.equal(viewImageChain.content, "我已基于观察结果完成图片并同步到画布。");
    assert.equal(capturedImageRequests.length, viewImageChainBefore + 1);
    assertProviderPromptIncludesDeliverySpecification(capturedImageRequests.at(-1), "VIEW_IMAGE_CHAIN_PROMPT");
    const viewImageChainRequests = capturedModelRequests.filter((request) =>
      JSON.stringify(request.messages || []).includes("SELFTEST_VIEW_IMAGE_TO_IMAGE_FINAL")
    );
    assert.equal(viewImageChainRequests.length, 3, "view_image → image_gen → final should require three native model decisions");
    const viewImageToolOutput = viewImageChainRequests[1].messages.find((message) => message?.role === "tool" && message?.name === "view_image")?.content;
    assert(Array.isArray(viewImageToolOutput), "view_image must return Responses-compatible content items");
    assert.equal(viewImageToolOutput[0]?.type, "input_image");
    assert.match(String(viewImageToolOutput[0]?.image_url || ""), /^data:image\/png;base64,/);
    assert.equal(viewImageToolOutput[0]?.detail, "high");
    const imageGenToolMessage = viewImageChainRequests[2].messages.find((message) => message?.role === "tool" && message?.name === "image_gen");
    assert(
      imageGenToolMessage,
      "The successful image_gen result must be returned to the model before its final response",
    );
    assert.equal(typeof imageGenToolMessage.content, "string", "image_gen must return a compact text result to the model");
    assert.match(imageGenToolMessage.content, /project-local output_paths ready for view_image:/);
    assert.match(imageGenToolMessage.content, /output[\\/]imagegen[\\/]/);
    assert.match(imageGenToolMessage.content, /do not call workflow or shell_command/i);
    assert.deepEqual(
      viewImageChainProgress.filter((event) => event?.phase === "tool-start").map((event) => event.tool),
      ["view_image", "image_gen"],
    );

    const viewImageHistory = await runtime.chat({
      projectId: "selftest-view-image-history",
      conversationId: "conversation-view-image-history",
      prompt: "SELFTEST_VIEW_IMAGE_HISTORY_COMPACT 连续观察两张图片并保持上下文健康。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
    });
    assertOk(viewImageHistory, "view_image history compaction loop");
    assert.equal(viewImageHistory.content.trim(), "多轮图片观察上下文已保持轻量。");
    const viewImageHistoryRequests = capturedModelRequests.filter((request) =>
      JSON.stringify(request.messages || []).includes("SELFTEST_VIEW_IMAGE_HISTORY_COMPACT")
    );
    assert.equal(viewImageHistoryRequests.length, 4, "Two image observations around one generation should require four model decisions");
    const inputImageCount = (request) => (request.messages || []).reduce((total, message) =>
      total + (Array.isArray(message?.content)
        ? message.content.filter((item) => item?.type === "input_image" && /^data:image\//.test(String(item?.image_url || ""))).length
        : 0), 0);
    assert.deepEqual(
      viewImageHistoryRequests.map(inputImageCount),
      [0, 1, 0, 1],
      "Only the current tool round may retain image pixels; already-consumed view_image payloads must be compacted",
    );
    assert.match(
      JSON.stringify(viewImageHistoryRequests[2].messages || []),
      /Local image pixels were already consumed in an earlier model round/,
    );

    const webSearchChainProgress = [];
    const webSearchChainBefore = capturedImageRequests.length;
    const webSearchChain = await runtime.chat({
      ...nativeLoopScope,
      conversationId: "conversation-web-search-loop",
      prompt: "SELFTEST_WEB_SEARCH_TO_IMAGE_FINAL 检索电商趋势后生成主视觉。",
      settings: { ...schemaSettings, agentModel: "gpt-5.6-terra" },
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => webSearchChainProgress.push(event),
    });
    assertOk(webSearchChain, "web_search to image_gen native loop");
    assert.equal(webSearchChain.content, "我已结合检索结果完成图片并同步到画布。");
    assert.equal(capturedImageRequests.length, webSearchChainBefore + 1);
    assertProviderPromptIncludesDeliverySpecification(capturedImageRequests.at(-1), "WEB_SEARCH_CHAIN_PROMPT");
    const webSearchChainRequests = capturedModelRequests.filter((request) =>
      JSON.stringify(request.messages || []).includes("SELFTEST_WEB_SEARCH_TO_IMAGE_FINAL")
    );
    assert.equal(webSearchChainRequests.length, 2, "native web_search should execute inside the Responses turn before image_gen");
    assert(
      webSearchChainRequests[0].tools.some((tool) => tool?.type === "web_search" && !tool?.function),
      "web_search must be exposed as a native Responses tool rather than a custom function",
    );
    assert.deepEqual(
      webSearchChainProgress.filter((event) => event?.phase === "tool-start").map((event) => event.tool),
      ["web_search", "image_gen"],
    );

    const experienceChainProgress = [];
    const experienceChainBefore = capturedImageRequests.length;
    const experienceChain = await runtime.chat({
      ...nativeLoopScope,
      conversationId: "conversation-experience-loop",
      prompt: "SELFTEST_EXPERIENCE_TO_IMAGE_FINAL 记录反馈经验后生成新版图片。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => experienceChainProgress.push(event),
    });
    assertOk(experienceChain, "experience to image_gen native loop");
    assert.equal(experienceChain.content, "我已记录经验并按新原则完成一版图片。");
    assert.equal(capturedImageRequests.length, experienceChainBefore + 1);
    assertProviderPromptIncludesDeliverySpecification(capturedImageRequests.at(-1), "EXPERIENCE_CHAIN_PROMPT");
    const experienceChainRequests = capturedModelRequests.filter((request) =>
      JSON.stringify(request.messages || []).includes("SELFTEST_EXPERIENCE_TO_IMAGE_FINAL")
    );
    assert.equal(experienceChainRequests.length, 3, "experience → image_gen → final should remain in the native tool loop");
    assert.deepEqual(
      experienceChainProgress.filter((event) => event?.phase === "tool-start").map((event) => event.tool),
      ["experience", "image_gen"],
    );

    const exactDuplicateProgress = [];
    const exactDuplicateImageBefore = capturedImageRequests.length;
    const exactDuplicateResult = await runtime.chat({
      ...nativeLoopScope,
      conversationId: "conversation-exact-duplicate",
      prompt: "SELFTEST_EXACT_DUPLICATE_TOOL_CALLS 验证精确重复防护。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      referenceImages: [],
      progress: (event) => exactDuplicateProgress.push(event),
    });
    assertOk(exactDuplicateResult, "same-round exact duplicate tool protection");
    assert.equal(exactDuplicateResult.content, "两组不同参数的图片调用均已完成。");
    assert.equal(exactDuplicateResult.toolResults?.length, 2, "One exact duplicate should be hidden while a different argument set remains executable");
    assert.equal(capturedImageRequests.length, exactDuplicateImageBefore + 2, "The exact duplicate image call must be blocked while the different prompt remains executable");
    assert.deepEqual(
      capturedImageRequests.slice(exactDuplicateImageBefore).map(providerPromptBase),
      ["EXACT_DUPLICATE_PROMPT_A", "EXACT_DUPLICATE_PROMPT_B"],
    );
    assert.deepEqual(
      exactDuplicateProgress.filter((event) => event?.phase === "tool-start" && event?.tool === "image_gen").map((event) => event.tool),
      ["image_gen", "image_gen"],
      "Canonical key ordering must block only the exact duplicate image call and allow the different image arguments",
    );
    assert.equal(exactDuplicateProgress.some((event) => event?.phase === "tool-skip"), false, "Exact duplicate protection is an internal protocol guard, not a user-visible failure card");

    const largeCanvasTypes = ["intent", "image", "review", "export", "branch", "post"];
    const largeCanvasRelations = ["derived-from", "referenced", "variant", "grouped"];
    const largeCanvasNodes = Array.from({ length: 500 }, (_, index) => {
      const hasParent = index > 0 && index % 3 !== 0;
      return {
        id: `large-node-${index}`,
        title: `商品节点 ${String(index).padStart(3, "0")}`,
        prompt: `LARGE_CANVAS_NODE_${index} 商品多角度视觉要求`,
        type: largeCanvasTypes[index % largeCanvasTypes.length],
        status: "done",
        ...(hasParent ? {
          parentId: `large-node-${index - 1}`,
          relationType: largeCanvasRelations[index % largeCanvasRelations.length],
        } : {}),
        assets: index % 10 === 0 ? [{ path: fixtureImagePath, name: `asset-${index}.png`, mimeType: "image/png" }] : [],
      };
    });
    const largeCanvasScope = { projectId: "selftest-large-canvas-project", conversationId: "selftest-large-canvas-conversation" };
    await runtime.chat({
      ...largeCanvasScope,
      prompt: "SELFTEST_LARGE_CANVAS_SCOPE_A 只确认当前选中成果。",
      settings: schemaSettings,
      messages: [],
      nodes: largeCanvasNodes,
      selectedNodeId: "large-node-499",
      selectedNodeIds: ["large-node-10", "large-node-499"],
      referenceImages: [{
        path: fixtureImagePath,
        name: "large-canvas-style.png",
        mimeType: "image/png",
        role: "style",
        purpose: "只参考蓝金电商视觉风格。",
      }],
    });
    const largeCanvasRequest = capturedModelRequests.find((request) =>
      JSON.stringify(request.messages || []).includes("SELFTEST_LARGE_CANVAS_SCOPE_A")
    );
    assert(largeCanvasRequest, "Expected a captured 500-node model request");
    const largeCanvasContext = String(largeCanvasRequest.messages?.[1]?.content || "");
    assert.match(largeCanvasContext, /snapshotBudgetChars=16000.*total=500/s);
    assert(largeCanvasContext.includes("large-node-499"), "The 499th selected node must always be included");
    assert(largeCanvasContext.includes("LARGE_CANVAS_NODE_499"), "The selected node summary must preserve its prompt context");
    assert(largeCanvasContext.includes("large-node-10"), "Multi-selection outside the recent window must always be included");
    assert.equal(largeCanvasContext.includes("large-node-0 "), false, "The full 500-node canvas must not be injected into the system message");
    assert(largeCanvasContext.includes("role=style"));
    assert(largeCanvasContext.includes("purpose=只参考蓝金电商视觉风格。"));
    const workbenchSection = largeCanvasContext.split("Current Workbench Snapshot:\n")[1]?.split("\n\nCurrent Task Scope:")[0] || "";
    assert(workbenchSection.length <= 16000, `Bounded workbench snapshot exceeded its explicit budget: ${workbenchSection.length}`);

    const pagedNodeIds = [];
    for (let offset = 0; offset < largeCanvasNodes.length; offset += 10) {
      const pageResult = await runtime.runTool(
        "workflow",
        { operation: "list_nodes", offset, limit: 10 },
        { settings: schemaSettings, nodes: largeCanvasNodes, ...largeCanvasScope },
      );
      assertOk(pageResult.envelope, `large canvas page offset ${offset}`);
      const pageText = String(pageResult.envelope.visibleOutput || "");
      assert.match(pageText, /canvasTotal: 500/);
      assert.match(pageText, /total: 500/);
      const ids = [...pageText.matchAll(/^large-node-(\d+)\s/gm)].map((match) => `large-node-${match[1]}`);
      assert.equal(ids.length, Math.min(10, largeCanvasNodes.length - offset), `Unexpected page size at offset ${offset}`);
      pagedNodeIds.push(...ids);
    }
    assert.equal(new Set(pagedNodeIds).size, 500, "Paginated list_nodes must not return duplicate nodes");
    assert.deepEqual(pagedNodeIds, largeCanvasNodes.map((node) => node.id), "Paginated list_nodes must not omit or reorder nodes");

    const filteredType = await runtime.runTool(
      "workflow",
      { operation: "list_nodes", type: "image", offset: 0, limit: 100 },
      { settings: schemaSettings, nodes: largeCanvasNodes, ...largeCanvasScope },
    );
    assertOk(filteredType.envelope, "large canvas type filter");
    const filteredTypeText = String(filteredType.envelope.visibleOutput || "");
    assert.match(filteredTypeText, /total: 84/);
    assert.equal([...filteredTypeText.matchAll(/^large-node-(\d+)\s/gm)].every((match) => Number(match[1]) % 6 === 1), true);
    const filteredQuery = await runtime.runTool(
      "workflow",
      { operation: "list_nodes", query: "商品节点 499", offset: 0, limit: 10 },
      { settings: schemaSettings, nodes: largeCanvasNodes, ...largeCanvasScope },
    );
    assertOk(filteredQuery.envelope, "large canvas query filter");
    assert.match(String(filteredQuery.envelope.visibleOutput || ""), /total: 1[\s\S]*large-node-499 /);
    const expectedVariantCount = largeCanvasNodes.filter((node) => node.parentId && node.relationType === "variant").length;
    const filteredRelation = await runtime.runTool(
      "workflow",
      { operation: "list_nodes", relation: "variant", offset: 0, limit: 100 },
      { settings: schemaSettings, nodes: largeCanvasNodes, ...largeCanvasScope },
    );
    assertOk(filteredRelation.envelope, "large canvas relation filter");
    assert.match(String(filteredRelation.envelope.visibleOutput || ""), new RegExp(`total: ${expectedVariantCount}`));

    const imageCollectionNodes = [
      {
        id: "collection-node",
        title: "商品主图组",
        prompt: "商品主图",
        type: "image",
        status: "done",
        imageState: "done",
        assets: [{ assetId: "asset-original", path: fixtureImagePath, status: "done" }],
        imageCollection: {
          id: "collection-results",
          name: "商品主图组",
          kind: "batch",
          collectionRole: "results",
          generationMode: "parallel",
          items: [{
            id: "collection-item-1",
            requestIndex: 1,
            assetIndex: 1,
            assetId: "asset-original",
            prompt: "正面主图",
            status: "done",
          }],
        },
      },
      {
        id: "replacement-node",
        title: "候选替换图",
        prompt: "候选替换图",
        type: "image",
        status: "done",
        imageState: "done",
        assets: [{ assetId: "asset-replacement", path: fixtureImagePath, status: "done" }],
      },
    ];
    const imageCollectionContext = {
      settings: schemaSettings,
      nodes: imageCollectionNodes,
      projectId: "selftest-image-collection-project",
      conversationId: "selftest-image-collection-conversation",
      canvasRevision: 27,
      operationId: "selftest-image-collection-operation",
      toolRunId: "selftest-image-collection-operation",
    };
    const describedCollection = await runtime.runTool(
      "workflow",
      { operation: "describe_node", nodeId: "collection-node" },
      imageCollectionContext,
    );
    assert.match(String(describedCollection.envelope.visibleOutput || ""), /imageCollection=collection-results:商品主图组:role=results/);
    assert.match(String(describedCollection.envelope.visibleOutput || ""), /collection-item-1,slot=1,asset=asset-original,status=done,prompt=正面主图/);

    const renameCollection = await runtime.runTool(
      "workflow",
      {
        operation: "rename_image_collections",
        expectedProjectId: imageCollectionContext.projectId,
        expectedCanvasRevision: 27,
        requests: [{ collectionId: "collection-results", name: "秋季新品主图" }],
      },
      imageCollectionContext,
    );
    assert.deepEqual(renameCollection.actions?.[0], {
      type: "workflow.image-collection.rename",
      operationId: imageCollectionContext.operationId,
      toolRunId: imageCollectionContext.toolRunId,
      imageCollection: {
        operation: "rename",
        expectedProjectId: imageCollectionContext.projectId,
        expectedCanvasRevision: 27,
        requests: [{ collectionId: "collection-results", name: "秋季新品主图" }],
      },
    });
    assert.match(String(renameCollection.envelope.visibleOutput || ""), /等待客户端提交/);

    const replaceCollectionItem = await runtime.runTool(
      "workflow",
      {
        operation: "replace_image_collection_item",
        expectedProjectId: imageCollectionContext.projectId,
        expectedCanvasRevision: 27,
        requests: [{
          sourceCollectionId: "collection-results",
          requestIndex: 1,
          replacementNodeId: "replacement-node",
          replacementAssetIndex: 0,
          defectReason: "主体边缘存在瑕疵",
        }],
      },
      imageCollectionContext,
    );
    assert.equal(replaceCollectionItem.actions?.[0]?.type, "workflow.image-collection.replace");
    assert.equal(replaceCollectionItem.actions?.[0]?.imageCollection?.requests?.[0]?.itemId, "collection-item-1");
    assert.equal(replaceCollectionItem.actions?.[0]?.imageCollection?.requests?.[0]?.replacementNodeId, "replacement-node");
    assert.match(String(replaceCollectionItem.envelope.visibleOutput || ""), /等待客户端提交/);

    const exportCollections = await runtime.runTool(
      "workflow",
      {
        operation: "export_image_collections",
        expectedProjectId: imageCollectionContext.projectId,
        expectedCanvasRevision: 27,
        collectionIds: ["collection-results"],
        format: "webp",
        confirmed: true,
      },
      imageCollectionContext,
    );
    assert.equal(exportCollections.actions?.[0]?.type, "workflow.image-collection.export");
    assert.deepEqual(exportCollections.actions?.[0]?.imageCollection?.collectionIds, ["collection-results"]);
    assert.equal(exportCollections.actions?.[0]?.imageCollection?.confirmed, true);
    assert.equal(exportCollections.actions?.[0]?.imageCollection?.format, "webp");
    assert.match(String(exportCollections.envelope.visibleOutput || ""), /等待客户端提交/);
    await assert.rejects(
      runtime.runTool(
        "workflow",
        { operation: "export_image_collections", collectionIds: ["collection-results"], format: "png", confirmed: false },
        imageCollectionContext,
      ),
      /confirmed=true/,
    );
    await assert.rejects(
      runtime.runTool(
        "workflow",
        { operation: "export_image_collections", collectionIds: ["collection-results"], confirmed: true },
        imageCollectionContext,
      ),
      /显式选择/,
    );
    await assert.rejects(
      runtime.runTool(
        "workflow",
        {
          operation: "rename_image_collections",
          expectedCanvasRevision: 26,
          requests: [{ collectionId: "collection-results", name: "过期名称" }],
        },
        imageCollectionContext,
      ),
      /画布已发生变化/,
    );

    await runtime.chat({
      projectId: largeCanvasScope.projectId,
      conversationId: "selftest-large-canvas-other-conversation",
      prompt: "SELFTEST_LARGE_CANVAS_SCOPE_B 只读取本会话画布。",
      settings: schemaSettings,
      messages: [],
      nodes: [{ ...largeCanvasNodes[0], id: "scope-b-node", title: "SCOPE_B_ONLY", prompt: "SCOPE_B_ONLY_PROMPT" }],
      selectedNodeId: "scope-b-node",
      referenceImages: [],
    });
    await runtime.chat({
      projectId: "selftest-large-canvas-other-project",
      conversationId: largeCanvasScope.conversationId,
      prompt: "SELFTEST_LARGE_CANVAS_SCOPE_C 只读取本项目画布。",
      settings: schemaSettings,
      messages: [],
      nodes: [{ ...largeCanvasNodes[0], id: "scope-c-node", title: "SCOPE_C_ONLY", prompt: "SCOPE_C_ONLY_PROMPT" }],
      selectedNodeId: "scope-c-node",
      referenceImages: [],
    });
    const scopeBRequest = capturedModelRequests.find((request) => JSON.stringify(request.messages || []).includes("SELFTEST_LARGE_CANVAS_SCOPE_B"));
    const scopeCRequest = capturedModelRequests.find((request) => JSON.stringify(request.messages || []).includes("SELFTEST_LARGE_CANVAS_SCOPE_C"));
    assert(scopeBRequest && scopeCRequest);
    assert.equal(JSON.stringify(scopeBRequest.messages || []).includes("LARGE_CANVAS_NODE_499"), false, "Canvas context must not cross conversation scope");
    assert.equal(JSON.stringify(scopeCRequest.messages || []).includes("LARGE_CANVAS_NODE_499"), false, "Canvas context must not cross project scope");
    assert(JSON.stringify(scopeBRequest.messages || []).includes("SCOPE_B_ONLY_PROMPT"));
    assert(JSON.stringify(scopeCRequest.messages || []).includes("SCOPE_C_ONLY_PROMPT"));

    const textOnlyProgress = [];
    const imageRequestsBeforeTextOnly = capturedImageRequests.length;
    const textOnly = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_AUTONOMY_TEXT_ONLY 请生成三张 3:4 图片，但本次模型自主选择只回复文本。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      selectedNodeId: "node-a",
      referenceImages: [],
      progress: (event) => textOnlyProgress.push(event),
    });
    assertOk(textOnly, "natural-language autonomous text response");
    assert.equal(textOnly.content, "模型自主选择直接回复，没有调用工具。");
    assert.equal(capturedImageRequests.length, imageRequestsBeforeTextOnly, "Image-like keywords must not make the runtime synthesize an image tool call");
    assert.equal(
      textOnlyProgress.some((event) => ["model-force", "model-arg-correct", "model-contract-failed"].includes(event?.phase)),
      false,
      "Text-only autonomy probe must not emit hidden routing/correction phases",
    );
    const textOnlyRequest = capturedModelRequests.find((request) => JSON.stringify(request.messages || []).includes("SELFTEST_AUTONOMY_TEXT_ONLY"));
    assert(textOnlyRequest, "Expected captured text-only autonomy request");
    const textOnlyContext = JSON.stringify(textOnlyRequest.messages || []);
    assert.equal(/Current Image Intent|imagePromptGuidance|runtime generated for the latest user message/i.test(textOnlyContext), false, "Natural-language request must not receive a hidden intent system message");
    assert.equal(textOnlyRequest.tools.some((tool) => ["memory", "context_manage"].includes(tool?.function?.name)), false, "Main-model request must expose only public tools");

    const argsProgress = [];
    const imageRequestsBeforeArgs = capturedImageRequests.length;
    const autonomousArgs = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_AUTONOMY_ARGS 请把当前 node-a 替换并生成七张 3:4 图片；模型将自主选择另一组合法参数。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      selectedNodeId: "node-a",
      referenceImages: [],
      progress: (event) => argsProgress.push(event),
    });
    assertOk(autonomousArgs, "model-owned image arguments");
    assert.equal(capturedImageRequests.length, imageRequestsBeforeArgs + 2, "The model's legal count=2 must be executed without keyword-derived count rewriting");
    assert(
      capturedImageRequests.slice(imageRequestsBeforeArgs).every((request) => providerPromptBase(request) === "MODEL_OWN_PROMPT 保持模型给出的画面语义。" && /交付规格：/.test(request.prompt)),
      "The image API must preserve the model's legal prompt and append the delivery specification for every count item",
    );
    const normalizedImageRequest = argsProgress.find((event) => event?.phase === "image-request" && event?.tool === "image_gen")?.input;
    assert(normalizedImageRequest, "Expected normalized image-request progress input");
    assert.equal(normalizedImageRequest.operation, "generate");
    assert.equal(normalizedImageRequest.prompt, "MODEL_OWN_PROMPT 保持模型给出的画面语义。");
    assert.equal(normalizedImageRequest.count, 2);
    assert.equal(normalizedImageRequest.generationMode, "sequential");
    assert.equal(normalizedImageRequest.ratio, "4:5");
    assert.equal(normalizedImageRequest.parentId, "node-b");
    assert.equal(
      argsProgress.some((event) => ["model-force", "model-arg-correct"].includes(event?.phase)),
      false,
      "Legal model arguments must not produce force/correction events",
    );
    const createdImageNode = autonomousArgs.actions?.find((action) => action?.type === "workflow.node.create")?.node;
    assert(createdImageNode, "Expected image result workflow action");
    assert.equal(createdImageNode.parentId, "node-b", "Selected node A must not overwrite model-supplied parentId B");
    assert.equal(createdImageNode.imageParams?.prompt, "MODEL_OWN_PROMPT 保持模型给出的画面语义。");
    assert.equal(createdImageNode.imageParams?.count, 2);
    assert.equal(createdImageNode.imageParams?.ratio, "4:5");
    assert.equal(createdImageNode.imageParams?.batchMode, "sequential");
    assert.equal(createdImageNode.imageCollection?.kind, "series");
    assert.equal(createdImageNode.imageCollection?.generationMode, "sequential");

    const taskScopeChatBefore = capturedImageRequests.length;
    const taskScopeChat = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_TASK_SCOPE_BINDING 让模型按 Current Task Scope 的 assetId 修改原图。",
      settings: schemaSettings,
      messages: [],
      nodes: autonomyNodes,
      selectedNodeId: "node-a",
      selectedNodeIds: ["node-a"],
      referenceImages: [],
      taskScope: {
        version: 1,
        origin: "chat",
        sourceNodeIds: ["node-a"],
        sourceAssets: [{ assetId: "scope-source-a1", displayCode: "A1", role: "source", name: "商品原图", nodeId: "node-a", path: fixtureImagePath }],
        referenceAssets: [{ assetId: "scope-reference-b1", displayCode: "B1", role: "reference", name: "配色参考", path: fixtureImagePathB }],
      },
    });
    assertOk(taskScopeChat, "model-authored TaskScope asset binding");
    assert.equal(capturedImageRequests.length, taskScopeChatBefore + 1);
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePath);
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.[0]?.path, fixtureImagePathB);
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.[0]?.role, "style");
    const taskScopeModelRequest = capturedModelRequests.find((request) => JSON.stringify(request.messages || []).includes("SELFTEST_TASK_SCOPE_BINDING"));
    assert.match(JSON.stringify(taskScopeModelRequest?.messages || []), /assetId=scope-source-a1/);
    assert.match(JSON.stringify(taskScopeModelRequest?.messages || []), /assetId=scope-reference-b1/);

    const runToolContext = { settings: schemaSettings, nodes: autonomyNodes, selectedNodeId: "node-a", ...scopeA };
    const referenceRoleProgress = [];
    const referenceRoleBefore = capturedImageRequests.length;
    const referenceRoleResult = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "保留来源商品结构，并参考附图的克制蓝金配色。",
      parentId: "node-container",
      assetIndex: 1,
      count: 1,
      referenceImages: [{
        path: fixtureImagePath,
        name: "style-reference.png",
        mimeType: "image/png",
        role: "style",
        purpose: "仅参考蓝金配色和留白比例，不替换商品主体。",
      }],
    }, { ...runToolContext, progress: (event) => referenceRoleProgress.push(event) });
    assertOk(referenceRoleResult.envelope, "container assetIndex and reference role/purpose passthrough");
    assert.equal(capturedImageRequests.length, referenceRoleBefore + 1);
    const referenceRoleRequest = capturedImageRequests.at(-1);
    assert.equal(referenceRoleRequest?.editImage?.path, fixtureImagePathB, "assetIndex=1 must choose the second container asset");
    assert.equal(referenceRoleRequest?.referenceImages?.[0]?.role, "style");
    assert.equal(referenceRoleRequest?.referenceImages?.[0]?.purpose, "仅参考蓝金配色和留白比例，不替换商品主体。");
    const referenceRoleNode = referenceRoleResult.actions?.find((action) => action?.type === "workflow.node.create")?.node;
    assert.equal(referenceRoleNode?.imageParams?.referenceImages?.[0]?.role, "style");
    assert.equal(referenceRoleNode?.imageParams?.referenceImages?.[0]?.purpose, "仅参考蓝金配色和留白比例，不替换商品主体。");
    assert.equal(referenceRoleProgress.some((event) => event?.phase === "tool-error" || event?.phase === "image-error"), false);

    const duplicateSlotNode = {
      id: "node-duplicate-slots",
      title: "包含重复来源的三图容器",
      type: "image",
      status: "done",
      imageContainer: true,
      assets: [
        { assetId: "legacy-duplicate-a", path: fixtureImagePath, name: "duplicate-a-1.png", mimeType: "image/png" },
        { assetId: "legacy-duplicate-a", path: fixtureImagePath, name: "duplicate-a-2.png", mimeType: "image/png" },
        { assetId: "source-b-slot-2", path: fixtureImagePathB, name: "source-b.png", mimeType: "image/png" },
      ],
    };
    const duplicateSlotContext = {
      ...runToolContext,
      nodes: [duplicateSlotNode],
      selectedNodeId: duplicateSlotNode.id,
      taskScope: {
        version: 1,
        origin: "container",
        sourceNodeIds: [duplicateSlotNode.id],
        sourceAssets: [
          { assetId: "legacy-duplicate-a", displayCode: "A1", role: "source", name: "重复 A 之一", nodeId: duplicateSlotNode.id, assetIndex: 0, path: fixtureImagePath },
          { assetId: "legacy-duplicate-a", displayCode: "A2", role: "source", name: "重复 A 之二", nodeId: duplicateSlotNode.id, assetIndex: 1, path: fixtureImagePath },
          { assetId: "source-b-slot-2", displayCode: "A3", role: "source", name: "目标 B", nodeId: duplicateSlotNode.id, assetIndex: 2, path: fixtureImagePathB },
        ],
        referenceAssets: [],
      },
    };
    const duplicateSlotByIdBefore = capturedImageRequests.length;
    const duplicateSlotById = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "明确修改第三张 B 图。",
      parentId: duplicateSlotNode.id,
      sourceAssetId: "source-b-slot-2",
      count: 1,
    }, duplicateSlotContext);
    assertOk(duplicateSlotById.envelope, "sourceAssetId must preserve the original node slot");
    assert.equal(capturedImageRequests.length, duplicateSlotByIdBefore + 1);
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePathB, "sourceAssetId for B must not shift left after duplicate A de-duplication");
    const duplicateSlotByIndex = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "按原始零基槽位修改第三张 B 图。",
      parentId: duplicateSlotNode.id,
      assetIndex: 2,
      count: 1,
    }, duplicateSlotContext);
    assertOk(duplicateSlotByIndex.envelope, "parentId + raw assetIndex must bind the original node slot");
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePathB);
    const duplicateSlotCutout = await runtime.runTool("image_gen", {
      operation: "cutout",
      prompt: "在第三张 B 图上打开主体选区。",
      parentId: duplicateSlotNode.id,
      sourceAssetId: "source-b-slot-2",
      count: 1,
    }, duplicateSlotContext);
    assertOk(duplicateSlotCutout.envelope, "region editor must preserve sourceAssetId raw slot");
    assert(duplicateSlotCutout.actions?.some((action) => action?.type === "workflow.node.cutout" && action.assetIndex === 2));
    await assert.rejects(
      runtime.runTool("image_gen", { operation: "edit", prompt: "越界槽位必须失败。", parentId: duplicateSlotNode.id, assetIndex: 999, count: 1 }, duplicateSlotContext),
      /不存在 assetIndex=999/,
      "Out-of-range TaskScope assetIndex must fail instead of clamping to the last image",
    );
    await assert.rejects(
      runtime.runTool("image_gen", { operation: "edit", prompt: "冲突绑定必须失败。", parentId: duplicateSlotNode.id, sourceAssetId: "source-b-slot-2", assetIndex: 0, count: 1 }, duplicateSlotContext),
      /指向不同 SOURCE/,
      "sourceAssetId and parentId + assetIndex disagreement must fail closed",
    );

    const requirementNode = {
      id: "requirement-reuse-1",
      title: "复用蓝金商品海报需求",
      prompt: "只替换商品主色，保留构图、标签和版式。",
      type: "requirement",
      status: "done",
      parentId: "node-a",
      relationType: "referenced",
      requirement: {
        version: 1,
        text: "只替换商品主色，保留构图、标签和版式。",
        revision: 1,
        createdFrom: "node",
      },
    };
    const requirementContext = {
      ...runToolContext,
      nodes: [...autonomyNodes, requirementNode],
      selectedNodeId: requirementNode.id,
      taskScope: {
        version: 1,
        origin: "requirement",
        sourceNodeIds: [requirementNode.id, "node-a"],
        sourceAssets: [{ assetId: "scope-source-a1", displayCode: "A1", role: "source", name: "商品原图", nodeId: "node-a", assetIndex: 0, path: fixtureImagePath }],
        referenceAssets: [],
      },
    };
    const requirementBefore = capturedImageRequests.length;
    const requirementResult = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "把商品主色改成克制的蓝金配色，其他内容保持不变。",
      parentId: requirementNode.id,
      sourceAssetId: "scope-source-a1",
      count: 1,
    }, requirementContext);
    assertOk(requirementResult.envelope, "requirement node must resolve its connected image source");
    assert.equal(capturedImageRequests.length, requirementBefore + 1);
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePath);
    assert.equal(
      requirementResult.actions?.find((action) => action?.type === "workflow.node.create")?.node?.parentId,
      requirementNode.id,
      "Requirement output must stay connected after the reusable requirement node",
    );

    const selectedEditBefore = capturedImageRequests.length;
    const selectedEditResult = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "基于当前选中成果生成更克制的蓝金商品海报。",
      count: 1,
    }, runToolContext);
    assertOk(selectedEditResult.envelope, "selected canvas result must be the implicit image source");
    assert.equal(capturedImageRequests.length, selectedEditBefore + 1);
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePath);
    assert.equal(
      selectedEditResult.actions?.find((action) => action?.type === "workflow.node.create")?.node?.parentId,
      "node-a",
    );

    const scopedEditBefore = capturedImageRequests.length;
    const scopedEditResult = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "只处理 SOURCE 商品图，参考两张 REFERENCE 的颜色与材质，输出一张。",
      sourceAssetId: "source-asset",
      referenceImages: [
        { assetId: "reference-1", role: "style", purpose: "只参考蓝金配色。" },
        { assetId: "reference-2", role: "composition", purpose: "只参考版式；它与 SOURCE 同路径，必须去重。" },
      ],
      count: 1,
    }, {
      ...runToolContext,
      nodes: [],
      selectedNodeId: "",
      taskScope: {
        version: 1,
        origin: "chat",
        sourceNodeIds: [],
        sourceAssets: [{ assetId: "source-asset", displayCode: "A1", role: "source", name: "商品原图", path: fixtureImagePath }],
        referenceAssets: [
          { assetId: "reference-1", displayCode: "B1", role: "reference", name: "颜色参考", path: fixtureImagePathB },
          { assetId: "reference-2", displayCode: "B2", role: "reference", name: "材质参考", path: fixtureImagePath },
        ],
      },
    });
    assertOk(scopedEditResult.envelope, "TaskScope SOURCE must drive edit while REFERENCE stays referential");
    assert.equal(capturedImageRequests.length, scopedEditBefore + 1, "Two references must not imply two outputs");
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePath);
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.length, 1, "SOURCE path must be removed from REFERENCE uploads");
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.[0]?.path, fixtureImagePathB);
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.[0]?.role, "style");
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.[0]?.purpose, "只参考蓝金配色。");
    await assert.rejects(
      runtime.runTool("image_gen", {
        operation: "edit",
        prompt: "未知素材 ID 不得静默回退为全部参考图。",
        sourceAssetId: "source-asset",
        referenceImages: [{ assetId: "not-in-scope", role: "style" }],
        count: 1,
      }, {
        ...runToolContext,
        nodes: [],
        selectedNodeId: "",
        taskScope: {
          version: 1,
          origin: "chat",
          sourceNodeIds: [],
          sourceAssets: [{ assetId: "source-asset", displayCode: "A1", role: "source", name: "商品原图", path: fixtureImagePath }],
          referenceAssets: [{ assetId: "reference-1", displayCode: "B1", role: "reference", name: "颜色参考", path: fixtureImagePathB }],
        },
      }),
      /REFERENCE 不属于 Current Task Scope/,
      "Unknown scoped reference assetId must fail closed",
    );
    const multiMaterialResult = await runtime.runTool("image_gen", {
      operation: "replace",
      prompt: "根据素材内容自主判断编辑目标，不要求手工标注素材角色。",
      count: 1,
    }, {
      ...runToolContext,
      nodes: [],
      selectedNodeId: "",
      taskScope: {
        version: 1,
        origin: "chat",
        sourceNodeIds: [],
        sourceAssets: [
          { assetId: "source-a", displayCode: "A1", role: "source", name: "原图 A", path: fixtureImagePath },
          { assetId: "source-b", displayCode: "A2", role: "source", name: "原图 B", path: fixtureImagePathB },
        ],
        referenceAssets: [],
      },
    });
    assertOk(multiMaterialResult.envelope, "Multiple materials must use a stable implicit edit target");
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePath);
    const referenceOnlyEdit = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "根据唯一素材自主判断修改目标，不要求手工标注 SOURCE/REFERENCE。",
      count: 1,
    }, {
      ...runToolContext,
      nodes: [],
      selectedNodeId: "",
      taskScope: {
        version: 1,
        origin: "chat",
        sourceNodeIds: [],
        sourceAssets: [],
        referenceAssets: [{ assetId: "reference-only", displayCode: "B1", role: "reference", name: "仅参考", path: fixtureImagePathB }],
      },
    });
    assertOk(referenceOnlyEdit.envelope, "A unified material may be selected as an edit target when context indicates editing");
    assert.equal(capturedImageRequests.at(-1)?.editImage?.path, fixtureImagePathB);

    const referenceOnlyGenerateBefore = capturedImageRequests.length;
    const referenceOnlyGenerate = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: "融合两张参考图的配色与构图语言，生成一张新的商品视觉。",
      count: 1,
    }, {
      ...runToolContext,
      nodes: [],
      selectedNodeId: "",
      taskScope: {
        version: 2,
        origin: "container",
        sourceNodeIds: [],
        sourceAssets: [],
        referenceAssets: [
          { bindingId: "binding:reference-container:a", assetId: "reference-a", displayCode: "B1", role: "reference", name: "配色参考", path: fixtureImagePath },
          { bindingId: "binding:reference-container:b", assetId: "reference-b", displayCode: "B2", role: "reference", name: "构图参考", path: fixtureImagePathB },
        ],
      },
    });
    assertOk(referenceOnlyGenerate.envelope, "Reference-only TaskScope must remain valid for generate");
    assert.equal(capturedImageRequests.length, referenceOnlyGenerateBefore + 1);
    assert.equal(capturedImageRequests.at(-1)?.referenceImages?.length, 2, "All scoped REFERENCE assets must reach Image 2 exactly once");
    assert.equal(capturedImageRequests.at(-1)?.editImage, null, "REFERENCE-only generate must not invent an edit SOURCE");

    const cutoutEditorBefore = capturedImageRequests.length;
    const cutoutEditorResult = await runtime.runTool("image_gen", {
      operation: "cutout",
      prompt: "保留商品主体和自然边缘，移除背景。",
      count: 1,
    }, runToolContext);
    assertOk(cutoutEditorResult.envelope, "cutout without mask must open the selection editor");
    assert.equal(capturedImageRequests.length, cutoutEditorBefore, "Cutout must not generate before the user paints a keep region");
    assert(cutoutEditorResult.actions?.some((action) => action?.type === "workflow.node.cutout" && action.id === "node-a"));

    const cutoutBefore = capturedImageRequests.length;
    const cutoutMaskDataUrl = `data:image/png;base64,${readFileSync(fixtureImagePath).toString("base64")}`;
    const cutoutResult = await runtime.runTool("image_gen", {
      operation: "cutout",
      prompt: "完整保留商品主体和自然边缘，移除背景并输出透明 PNG。",
      parentId: "node-a",
      assetIndex: 0,
      count: 1,
      maskDataUrl: cutoutMaskDataUrl,
      inputFidelity: "high",
    }, runToolContext);
    assertOk(cutoutResult.envelope, "cutout must request native transparent PNG output");
    assert.equal(capturedImageRequests.length, cutoutBefore + 1);
    const cutoutRequest = capturedImageRequests.at(-1);
    assert.equal(cutoutRequest?.background, "transparent", "Cutout must ask Image 2 for transparency instead of relying on opaque post-processing");
    assert.equal(cutoutRequest?.outputFormat, "png");
    assert.equal(cutoutRequest?.editImage?.path, fixtureImagePath);
    assert.equal(cutoutRequest?.maskDataUrl, cutoutMaskDataUrl);
    const cutoutNode = cutoutResult.actions?.find((action) => action?.type === "workflow.node.create")?.node;
    assert.equal(cutoutNode?.imageParams?.background, "transparent");
    assert.equal(cutoutNode?.imageParams?.outputFormat, "png");

    await assert.rejects(
      runtime.runTool("image_gen", { operation: "generate", prompt: "VALID_PROMPT", count: 201 }, runToolContext),
      /1-200/,
      "Out-of-range count must fail explicitly",
    );
    await assert.rejects(
      runtime.runTool("image_gen", { operation: "generate", prompt: "VALID_PROMPT", ratio: "5:7" }, runToolContext),
      /ratio=.*不受支持/,
      "Unsupported ratio must fail explicitly",
    );
    await assert.rejects(
      runtime.runTool("image_gen", { operation: "generate", prompt: "VALID_PROMPT", count: 2, generationMode: "series" }, runToolContext),
      /generationMode=.*无效/,
      "Unknown generationMode must not be inferred as sequential",
    );
    await assert.rejects(
      runtime.runTool("image_gen", { operation: "generate_forced", prompt: "VALID_PROMPT" }, runToolContext),
      /operation=.*无效/,
      "Unknown operation must not fall back to generate",
    );
    await assert.rejects(
      runtime.runTool("image_gen", { prompt: "VALID_PROMPT" }, runToolContext),
      /operation=<missing>.*无效/,
      "Missing operation must not fall back to generate",
    );
    await assert.rejects(
      runtime.runTool("image_gen", { operation: "generate", prompt: "VALID_PROMPT", parentId: "missing-node" }, runToolContext),
      /parentId=.*不存在/,
      "Unknown parentId must not fall back to the selected node",
    );
    const strictPaddedGenerateProgress = [];
    const strictPaddedGenerateBefore = capturedImageRequests.length;
    const strictPaddedGenerate = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: "STRICT_SCHEMA_PADDED_GENERATE",
      ratio: "3:4",
      resolution: "2K",
      quality: "high",
      count: 1,
      generationMode: "parallel",
      parentId: "",
      assetIndex: 0,
      sourceBindingId: "",
      sourceAssetId: "",
      sourceImage: { bindingId: "", assetId: "", role: "edit_target", purpose: "" },
      referenceImages: [],
      items: [],
      layerPlan: [],
    }, {
      ...runToolContext,
      selectedNodeId: "",
      selectedNodeIds: [],
      taskScope: {
        version: 2,
        origin: "chat",
        sourceNodeIds: [],
        sourceAssets: [],
        referenceAssets: [],
        resultPolicy: "single",
      },
      progress: (event) => strictPaddedGenerateProgress.push(event),
    });
    assertOk(strictPaddedGenerate.envelope, "strict-schema padded text-only generate compatibility");
    assert.equal(capturedImageRequests.length, strictPaddedGenerateBefore + 1);
    const strictPaddedGenerateInput = strictPaddedGenerateProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(strictPaddedGenerateInput?.prompt, "STRICT_SCHEMA_PADDED_GENERATE");
    assert.equal(strictPaddedGenerateInput?.editImage, null);
    const placeholderSingleProgress = [];
    const placeholderSingleBefore = capturedImageRequests.length;
    const placeholderSingle = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: "VALID_ITEM",
      count: 2,
      items: [{ prompt: "VALID_ITEM", ratio: "1:1" }, { title: "temp", prompt: "temp" }],
    }, { ...runToolContext, progress: (event) => placeholderSingleProgress.push(event) });
    assertOk(placeholderSingle.envelope, "placeholder filtering with one valid item promotion");
    assert.equal(capturedImageRequests.length, placeholderSingleBefore + 1);
    const placeholderSingleInput = placeholderSingleProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(placeholderSingleInput?.count, 1);
    assert.equal(placeholderSingleInput?.items, undefined);
    assert.equal(placeholderSingleInput?.prompt, "VALID_ITEM");

    const singletonObjectProgress = [];
    const singletonObjectBefore = capturedImageRequests.length;
    const singletonObject = await runtime.runTool("image_gen", {
      operation: "generate",
      count: 1,
      items: { prompt: "SINGLETON_OBJECT_PROMPT", ratio: "4:5", quality: "high" },
    }, { ...runToolContext, progress: (event) => singletonObjectProgress.push(event) });
    assertOk(singletonObject.envelope, "single object items compatibility");
    assert.equal(capturedImageRequests.length, singletonObjectBefore + 1);
    const singletonObjectInput = singletonObjectProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(singletonObjectInput?.prompt, "SINGLETON_OBJECT_PROMPT");
    assert.equal(singletonObjectInput?.ratio, "4:5");
    assert.equal(singletonObjectInput?.quality, "high");
    assert.equal(singletonObjectInput?.items, undefined);

    const paddedSingleEditProgress = [];
    const paddedSingleEditBefore = capturedImageRequests.length;
    const paddedSingleEdit = await runtime.runTool("image_gen", {
      operation: "edit",
      prompt: "PADDED_SINGLE_EDIT_PROMPT",
      count: 1,
      generationMode: "parallel",
      items: [
        { title: "真实单图", prompt: "PADDED_SINGLE_EDIT_PROMPT", ratio: "3:4", resolution: "2K", quality: "high" },
        { title: "unused", prompt: "unused", ratio: "3:4", resolution: "2K", quality: "high" },
      ],
      layerPlan: [
        { id: "unused1", title: "unused", role: "background", prompt: "unused", transparent: false },
        { id: "unused2", title: "unused", role: "subject", prompt: "unused", transparent: true },
      ],
      maskImage: { path: "", mimeType: "", name: "", role: "", purpose: "" },
      sourceImage: { path: fixtureImagePath, mimeType: "image/png", name: "source.png" },
      ratio: "3:4",
      resolution: "2K",
      quality: "high",
    }, { ...runToolContext, progress: (event) => paddedSingleEditProgress.push(event) });
    assertOk(paddedSingleEdit.envelope, "schema-padded single edit compatibility");
    assert.equal(capturedImageRequests.length, paddedSingleEditBefore + 1);
    const paddedSingleEditInput = paddedSingleEditProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(paddedSingleEditInput?.operation, "edit");
    assert.equal(paddedSingleEditInput?.count, 1);
    assert.equal(paddedSingleEditInput?.items, undefined);
    assert.equal(paddedSingleEditInput?.batchItems?.length, 0);
    assert.equal(paddedSingleEditInput?.prompt, "PADDED_SINGLE_EDIT_PROMPT");

    const repeatedSingletonProgress = [];
    const repeatedSingletonBefore = capturedImageRequests.length;
    const repeatedSingleton = await runtime.runTool("image_gen", {
      operation: "generate",
      count: 3,
      generationMode: "parallel",
      items: [{ prompt: "REPEATED_SINGLETON_PROMPT", ratio: "1:1" }],
    }, { ...runToolContext, progress: (event) => repeatedSingletonProgress.push(event) });
    assertOk(repeatedSingleton.envelope, "single item with repeated count compatibility");
    assert.equal(capturedImageRequests.length, repeatedSingletonBefore + 3);
    const repeatedSingletonInput = repeatedSingletonProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(repeatedSingletonInput?.prompt, "REPEATED_SINGLETON_PROMPT");
    assert.equal(repeatedSingletonInput?.count, 3);
    assert.equal(repeatedSingletonInput?.generationMode, "parallel");
    assert.equal(repeatedSingletonInput?.items, undefined);

    const expandedSingletonProgress = [];
    const expandedSingletonBefore = capturedImageRequests.length;
    const expandedSingleton = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: "成年东方女性 Java 娘化竖版近景主视觉",
      count: 1,
      items: [{ prompt: "成年东方女性 Java 娘化竖版近景主视觉，融合 JVM 字节码、咖啡热流与跨平台意象，高级二次元设计" }],
    }, { ...runToolContext, progress: (event) => expandedSingletonProgress.push(event) });
    assertOk(expandedSingleton.envelope, "expanded single item prompt compatibility");
    assert.equal(capturedImageRequests.length, expandedSingletonBefore + 1);
    assert.equal(
      expandedSingletonProgress.find((event) => event?.phase === "image-request")?.input?.prompt,
      "成年东方女性 Java 娘化竖版近景主视觉，融合 JVM 字节码、咖啡热流与跨平台意象，高级二次元设计",
    );

    const placeholderOnlyProgress = [];
    const placeholderOnlyBefore = capturedImageRequests.length;
    const placeholderOnly = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: "PLACEHOLDER_ONLY_TOP_PROMPT",
      count: 2,
      generationMode: "parallel",
      items: ["temp", { title: "todo", prompt: "todo" }],
    }, { ...runToolContext, progress: (event) => placeholderOnlyProgress.push(event) });
    assertOk(placeholderOnly.envelope, "pure placeholder items are discarded without losing top-level count");
    assert.equal(capturedImageRequests.length, placeholderOnlyBefore + 2);
    assert.equal(placeholderOnlyProgress.find((event) => event?.phase === "image-request")?.input?.count, 2);

    const placeholderBatchProgress = [];
    const placeholderBatchBefore = capturedImageRequests.length;
    const placeholderBatch = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: "共享商品系列要求",
      count: 4,
      generationMode: "parallel",
      items: [
        { title: "正面", prompt: "商品正面主视觉", ratio: "1:1" },
        { title: "placeholder", prompt: "placeholder" },
        { title: "侧面", prompt: "商品侧面主视觉", ratio: "4:5" },
        { title: "todo", prompt: "todo" },
      ],
    }, { ...runToolContext, progress: (event) => placeholderBatchProgress.push(event) });
    assertOk(placeholderBatch.envelope, "placeholder filtering with effective multi-item count");
    assert.equal(capturedImageRequests.length, placeholderBatchBefore + 2);
    const placeholderBatchInput = placeholderBatchProgress.find((event) => event?.phase === "image-request")?.input;
    assert.equal(placeholderBatchInput?.count, 2);
    assert.equal(placeholderBatchInput?.batchItems?.length, 2);
    assert.deepEqual(placeholderBatchInput?.batchItems?.map((item) => item.prompt), ["商品正面主视觉", "商品侧面主视觉"]);

    await assert.rejects(
      runtime.runTool("image_gen", {
        operation: "generate",
        prompt: "TOP_LEVEL_MEANING_A",
        count: 1,
        items: [{ prompt: "SINGLE_ITEM_MEANING_B" }, { prompt: "temp" }],
      }, runToolContext),
      /无法无损确定/,
      "A genuine single-image prompt conflict must still be returned for internal model correction",
    );

    const parallelProgress = [];
    const explicitParallel = await runtime.runTool(
      "image_gen",
      {
        operation: "generate",
        prompt: "EXPLICIT_PARALLEL_PROMPT",
        count: 2,
        generationMode: "parallel",
        ratio: "1:1",
        resolution: "1080P",
      },
      { ...runToolContext, progress: (event) => parallelProgress.push(event) },
    );
    assertOk(explicitParallel.envelope, "explicit parallel generation mode");
    const parallelRequest = parallelProgress.find((event) => event?.phase === "image-request" && event?.tool === "image_gen")?.input;
    assert.equal(parallelRequest?.generationMode, "parallel");
    const parallelNode = explicitParallel.actions?.find((action) => action?.type === "workflow.node.create")?.node;
    assert.equal(parallelNode?.imageParams?.batchMode, "parallel");
    assert.equal(parallelNode?.imageCollection?.kind, "batch");
    assert.equal(parallelNode?.imageCollection?.generationMode, "parallel");
    assert.equal(maximumParallelImageConcurrency, 2, "Parallel generation must start both requests before either one settles");
    assert.deepEqual(parallelImageCompletionOrder, [2, 1], "The fixture must complete out of request order");
    const parallelResultProgress = parallelProgress.filter((event) => event?.phase === "image-result");
    assert.deepEqual(
      parallelResultProgress.map((event) => event?.partialImage?.requestIndex),
      [2, 1],
      "Each completed image must be emitted immediately in completion order",
    );
    const parallelOperationIds = new Set(parallelProgress
      .filter((event) => ["image-request", "image-result", "image-response"].includes(event?.phase))
      .map((event) => event?.operationId));
    assert.equal(parallelOperationIds.size, 1, "Incremental and terminal actions must update one image-group operation");
    assert.deepEqual(
      parallelResultProgress.map((event) => event?.workflowAction?.node?.assets?.length),
      [1, 2],
      "The same image group must grow as each request completes",
    );
    assert(
      parallelResultProgress.every((event) => event?.workflowAction?.node?.imageCollection?.id === parallelNode?.imageCollection?.id),
      "Every incremental action must target the final image collection",
    );
    assert.deepEqual(
      parallelNode?.assets?.map((asset) => asset.name),
      ["parallel-2.png", "parallel-1.png"],
      "Final image-group assets must preserve actual completion order",
    );

    const nonLayerVariantsProgress = [];
    const nonLayerVariantsBefore = capturedImageRequests.length;
    const nonLayerVariants = await runtime.runTool(
      "image_gen",
      {
        operation: "variants",
        prompt: "基于当前东方审美角色图生成三张独立候选，保持黑长直公主切和克制微海报设计。",
        count: 3,
        generationMode: "parallel",
        layerPlan: [
          { id: "x", title: "无关图层 X", role: "background", prompt: "不应进入普通多版请求", transparent: false },
          { id: "y", title: "无关图层 Y", role: "subject", prompt: "不应进入普通多版请求", transparent: true },
        ],
        layer_plan: [
          { id: "snake-x", title: "无关蛇形图层 X", role: "background", prompt: "同样不应泄漏", transparent: false },
          { id: "snake-y", title: "无关蛇形图层 Y", role: "subject", prompt: "同样不应泄漏", transparent: true },
        ],
      },
      { ...runToolContext, progress: (event) => nonLayerVariantsProgress.push(event) },
    );
    assertOk(nonLayerVariants.envelope, "three parallel variants with non-layer field isolation");
    assert.equal(capturedImageRequests.length, nonLayerVariantsBefore + 3);
    const nonLayerVariantsRequest = nonLayerVariantsProgress.find((event) => event?.phase === "image-request" && event?.tool === "image_gen")?.input;
    assert(nonLayerVariantsRequest, "Expected normalized variants image request");
    assert.equal(nonLayerVariantsRequest.operation, "variants");
    assert.equal(nonLayerVariantsRequest.count, 3);
    assert.equal(nonLayerVariantsRequest.generationMode, "parallel");
    assert.equal(Object.prototype.hasOwnProperty.call(nonLayerVariantsRequest, "layerPlan"), false, "Non-layer requests must discard camelCase layerPlan");
    assert.equal(Object.prototype.hasOwnProperty.call(nonLayerVariantsRequest, "layer_plan"), false, "Non-layer requests must discard snake_case layer_plan");
    assert(
      capturedImageRequests.slice(nonLayerVariantsBefore).every((request) =>
        !Object.prototype.hasOwnProperty.call(request, "layerPlan") &&
        !Object.prototype.hasOwnProperty.call(request, "layer_plan")
      ),
      "Layer-only plans must not reach the image service for ordinary variants",
    );
    const nonLayerVariantsNode = nonLayerVariants.actions?.find((action) => action?.type === "workflow.node.create")?.node;
    assert(nonLayerVariantsNode, "Expected a three-asset variants result node");
    assert.equal(nonLayerVariantsNode.parentId, "node-a");
    assert.equal(nonLayerVariantsNode.relationType, "variant");
    assert.equal(nonLayerVariantsNode.assets?.length, 3);
    assert.equal(nonLayerVariantsNode.imageCollection?.kind, "batch");
    assert.equal(nonLayerVariantsNode.imageCollection?.generationMode, "parallel");

    const fastMemoryBeforeInternalProbe = runtime.getFastMemory(scopeA).text;
    await assert.rejects(
      runtime.chat({
        ...scopeA,
        prompt: "SELFTEST_INTERNAL_TOOL_PROBE 尝试调用未公开内部工具。",
        settings: schemaSettings,
        messages: [],
        nodes: autonomyNodes,
        referenceImages: [],
      }),
      /未公开工具 context_manage/,
      "A hallucinated internal tool call must be rejected even though runTool supports internal maintenance",
    );
    assert.equal(runtime.getFastMemory(scopeA).text, fastMemoryBeforeInternalProbe, "Rejected internal tool calls must not mutate FastMemory");

    const fillerParagraphs = Array.from({ length: 28 }, (_, index) =>
      `通用经验段落 ${index + 1}：${"保持主体轮廓稳定、控制背景噪声、统一光线方向与材质层次。".repeat(28)}`
    );
    const longFastMemoryText = [
      "LONG_MEMORY_HEAD_SENTINEL：这是人工编辑记忆的开头规则，必须保持可见。",
      ...fillerParagraphs.slice(0, 14),
      "靛青玻璃光带需要保持冷色半透明边缘、单一主光方向与近景主体聚焦。LONG_MEMORY_RELEVANT_SENTINEL",
      ...fillerParagraphs.slice(14),
      "LONG_MEMORY_TAIL_SENTINEL：这是最近补充的尾部规则，也必须保持可见。",
    ].join("\n\n");
    assert(longFastMemoryText.length > 20000 && longFastMemoryText.length < 64000, "Long FastMemory fixture must exceed the model injection budget but remain editable");
    const longMemorySave = assertOk(
      runtime.saveFastMemory({ ...scopeA, text: longFastMemoryText }),
      "save long editable FastMemory",
    );
    assert.equal(longMemorySave.text, longFastMemoryText);
    await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_LONG_MEMORY_CONTEXT_PROBE 请只复述靛青玻璃光带的记忆原则，不调用工具。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
    });
    const longMemoryRequest = capturedModelRequests.find((request) =>
      JSON.stringify(request.messages || []).includes("SELFTEST_LONG_MEMORY_CONTEXT_PROBE")
    );
    assert(longMemoryRequest, "Expected a captured request for long FastMemory context selection");
    const longRuntimeContext = String(longMemoryRequest.messages?.[1]?.content || "");
    const longMemoryMatch = longRuntimeContext.match(/Internal image preference context:\n([\s\S]*?)\n\nConversation Summary:/);
    assert(longMemoryMatch, "Runtime context should expose a separately bounded FastMemory section");
    const injectedLongMemory = longMemoryMatch[1];
    assert(injectedLongMemory.length > 700, "Long editable FastMemory must inject substantially more than the legacy 700-character cap");
    assert(injectedLongMemory.length <= 20000, "FastMemory injection must respect the total context budget");
    assert(injectedLongMemory.includes("LONG_MEMORY_HEAD_SENTINEL"), "Long FastMemory selection should preserve the current entry head");
    assert(injectedLongMemory.includes("LONG_MEMORY_RELEVANT_SENTINEL"), "Long FastMemory selection should include the query-relevant segment");
    assert(injectedLongMemory.includes("LONG_MEMORY_TAIL_SENTINEL"), "Long FastMemory selection should preserve recent tail edits");
    assert.equal(injectedLongMemory.includes(scopeBText), false, "Long FastMemory selection must remain conversation-scoped");
    assert.equal(forbiddenPublicMetadata.test(injectedLongMemory), false, `Long FastMemory context leaked internal metadata: ${injectedLongMemory}`);
    assertOk(runtime.saveFastMemory({ ...scopeA, text: savedA.text }), "restore scope A FastMemory after long-context probe");

    const toolProbeProgress = [];
    const toolProbe = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_TOOL_ENVELOPE_PROBE 请读取当前绘画经验。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
      progress: (event) => toolProbeProgress.push(event),
    });
    assertOk(toolProbe, "model-visible tool envelope probe");
    assert.equal(forbiddenPublicMetadata.test(JSON.stringify(toolProbe.toolResults || [])), false, `Public chat toolResults leaked internal metadata: ${JSON.stringify(toolProbe.toolResults)}`);
    assert.equal(Object.prototype.hasOwnProperty.call(toolProbe, "entryId"), false, "Public chat response must not expose a legacy entryId field");
    const toolProbeRequests = capturedModelRequests.filter((request) => JSON.stringify(request.messages || []).includes("SELFTEST_TOOL_ENVELOPE_PROBE"));
    assert.equal(toolProbeRequests.length, 2, "Tool probe should make one tool-call request and one follow-up request");
    const toolFollowupRequest = toolProbeRequests[1];
    const modelToolMessages = (toolFollowupRequest.messages || []).filter((message) => message?.role === "tool");
    assert.equal(modelToolMessages.length, 1, "Tool follow-up request should contain exactly one role=tool result");
    const modelToolContext = JSON.stringify(modelToolMessages);
    assert.equal(forbiddenPublicMetadata.test(modelToolContext), false, `Main model tool context leaked internal metadata: ${modelToolContext}`);
    assert.equal(/\bmemoryRef\b|\btoolmemoryEntryId\b|\bsourceEntryIds\b|\bselectedEntryIds\b/i.test(modelToolContext), false, `Main model tool context leaked an internal reference field: ${modelToolContext}`);
    assert.equal(
      forbiddenPublicMetadata.test(JSON.stringify(toolProbeProgress)),
      false,
      `Public Agent progress leaked internal metadata: ${JSON.stringify(toolProbeProgress)}`,
    );
    const silentFinalFallback = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_SILENT_FINAL_FALLBACK 读取绘画经验后保持空正文。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
    });
    assertOk(silentFinalFallback, "silent final response fallback");
    assert(String(silentFinalFallback.content || "").trim(), "A silent model response after tools must still produce a short user-readable summary");
    assert.equal(String(silentFinalFallback.content || "").trim().startsWith("{"), false, "Silent final fallback must not expose a raw tool envelope JSON object");
    assert.equal(forbiddenPublicMetadata.test(String(silentFinalFallback.content || "")), false, "Silent final fallback must not expose internal memory metadata");
    const failureProbeProgress = [];
    const failureProbe = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_TOOL_FAILURE_PROBE 请观察缺失图片并根据失败结果重新决策。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
      progress: (event) => failureProbeProgress.push(event),
    });
    assertOk(failureProbe, "model-visible tool failure probe");
    assert.equal(forbiddenPublicMetadata.test(JSON.stringify(failureProbe.toolResults || [])), false, `Public failed toolResults leaked internal metadata: ${JSON.stringify(failureProbe.toolResults)}`);
    const failureProbeRequests = capturedModelRequests.filter((request) => JSON.stringify(request.messages || []).includes("SELFTEST_TOOL_FAILURE_PROBE"));
    assert.equal(failureProbeRequests.length, 2, "Failure probe should return to the model for a second decision");
    const failureFollowupContext = JSON.stringify(failureProbeRequests[1].messages || []);
    assert.equal(forbiddenPublicMetadata.test(failureFollowupContext), false, `Failure follow-up leaked internal metadata: ${failureFollowupContext}`);
    assert.equal(/\bmemoryRef\b|\btoolmemoryEntryId\b|\bsourceEntryIds\b|\bselectedEntryIds\b/i.test(failureFollowupContext), false);
    assert.deepEqual(
      failureProbeRequests[1].messages.filter((message) => message?.role === "user"),
      failureProbeRequests[0].messages.filter((message) => message?.role === "user"),
      "Tool failure recovery must not inject a synthetic user correction message",
    );
    const failureToolMessage = failureProbeRequests[1].messages.find((message) => message?.role === "tool");
    assert(failureToolMessage, "Failure recovery must return the failure as role=tool");
    assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(String(failureToolMessage.content || "{}")), "nextInstruction"), false);
    assert(
      failureProbeProgress.some((event) => event?.phase === "tool-error" && event?.tool === "view_image"),
      "A non-throwing ok=false tool result must be reported as tool-error",
    );
    assert.equal(
      failureProbeProgress.some((event) => event?.phase === "tool-done" && event?.tool === "view_image"),
      false,
      "A non-throwing ok=false tool result must not be reported as tool-done",
    );
    assert.equal(forbiddenPublicMetadata.test(JSON.stringify(failureProbeProgress)), false, `Failed tool progress leaked internal metadata: ${JSON.stringify(failureProbeProgress)}`);
    const terminatedProgress = [];
    const terminatedResult = await runtime.chat({
      ...scopeA,
      prompt: "SELFTEST_TERMINATED_IMAGE_ERROR 验证上游连接中断分类。",
      settings: schemaSettings,
      messages: [],
      nodes: [],
      referenceImages: [],
      progress: (event) => terminatedProgress.push(event),
    });
    assertOk(terminatedResult, "terminated image error classification");
    assert.match(JSON.stringify(terminatedResult.toolResults || []), /upstream_5xx/);
    assert(terminatedProgress.some((event) => event?.phase === "tool-error" && event?.tool === "image_gen" && event?.errorCategory === "upstream_5xx"));
    const addedExperience = await runtime.runTool(
      "experience",
      { action: "add", text: "SECOND_VISIBLE_EXPERIENCE", rating: "good" },
      { settings: schemaSettings, nodes: [], ...scopeA },
    );
    assertOk(addedExperience.envelope, "add a second scoped Experience entry");
    assertPublicMemoryResponse(addedExperience.envelope, "Experience add public response");
    const compactedExperience = await runtime.runTool(
      "experience",
      { action: "compact" },
      { settings: schemaSettings, nodes: [], ...scopeA },
    );
    assertOk(compactedExperience.envelope, "compact scoped Experience without a selector");
    assertPublicMemoryResponse(compactedExperience.envelope, "Experience compact public response");
    const compactedExperienceText = assertOk(runtime.getFastMemory(scopeA), "read compacted scoped Experience");
    assertPublicMemoryResponse(compactedExperienceText, "compacted FastMemory public response");
    assert(compactedExperienceText.text.includes("A_VISIBLE_MEMORY"));
    assert(compactedExperienceText.text.includes("SECOND_VISIBLE_EXPERIENCE"));

    const legacySummaryProbeKey = summaryKey(scopeB.projectId, scopeB.conversationId);
    writeConversationSummary(dbPath, legacySummaryProbeKey, JSON.stringify({
      version: 1,
      summary: [
        "LEGACY_VISIBLE_SUMMARY",
        "selector: all",
        "entryId: ent-20260712-000020",
        "memoryRef: fmem-20260712-000021",
      ].join("\n"),
      messageCount: 0,
      updatedAt: "2026-07-12T00:00:00.000Z",
    }));
    await runtime.chat({
      ...scopeB,
      prompt: "SELFTEST_LEGACY_SUMMARY_PROBE 只回复完成。",
      settings: schemaSettings,
      messages: [
        {
          role: "assistant",
          content: "LEGACY_ASSISTANT_VISIBLE\nselector: all\nentryId: ent-20260712-000022\nmemoryRef: fmem-20260712-000023",
        },
      ],
      nodes: [],
      referenceImages: [],
    });
    const legacySummaryRequest = capturedModelRequests.find((request) => JSON.stringify(request.messages || []).includes("SELFTEST_LEGACY_SUMMARY_PROBE"));
    assert(legacySummaryRequest, "Expected a captured request for legacy summary sanitation");
    const legacyModelContext = JSON.stringify(legacySummaryRequest.messages || []);
    assert(legacyModelContext.includes("LEGACY_VISIBLE_SUMMARY"));
    assert(legacyModelContext.includes("LEGACY_ASSISTANT_VISIBLE"));
    assert.equal(forbiddenPublicMetadata.test(legacyModelContext), false, `Persisted legacy model context leaked internal metadata: ${legacyModelContext}`);
    assert.equal(/\bmemoryRef\b|\bsourceEntryIds\b|\bselectedEntryIds\b/i.test(legacyModelContext), false);

    const compactSummaryKey = summaryKey(scopeA.projectId, scopeA.conversationId);
    const compactSummaryValue = JSON.stringify({
      version: 1,
      summary: "COMPACT_SUMMARY_MUST_SURVIVE_FAST_MEMORY_EDITS",
      messageCount: 42,
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    const compactSummaryKeyB = summaryKey(scopeB.projectId, scopeB.conversationId);
    const compactSummaryValueB = JSON.stringify({
      version: 1,
      summary: "CONVERSATION_B_SUMMARY_MUST_SURVIVE_SCOPE_A_CLEAR",
      messageCount: 9,
      updatedAt: "2026-07-12T00:00:01.000Z",
    });
    writeConversationSummary(dbPath, compactSummaryKey, compactSummaryValue);
    writeConversationSummary(dbPath, compactSummaryKeyB, compactSummaryValueB);

    const replacedA = assertOk(
      runtime.saveFastMemory({ ...scopeA, text: "A_REPLACED_VISIBLE_MEMORY" }),
      "replace exact FastMemory scope A",
    );
    assertPublicMemoryResponse(replacedA, "replace FastMemory scope A");
    assert.equal(readConversationSummary(dbPath, compactSummaryKey), compactSummaryValue, "FastMemory save must preserve compact summary");
    assert.equal(runtime.getFastMemory(scopeA).text, "A_REPLACED_VISIBLE_MEMORY");
    assert.equal(runtime.getFastMemory(scopeB).text, scopeBText, "Replacing scope A must preserve scope B");

    const resetA = assertOk(runtime.resetFastMemory(scopeA), "reset FastMemory scope A");
    assertPublicMemoryResponse(resetA, "reset FastMemory scope A");
    assert.equal(resetA.cleared, 1);
    assert.equal(runtime.getFastMemory(scopeA).text, "");
    assert.equal(runtime.getFastMemory(scopeA).isEmpty, true);
    assert.equal(runtime.getFastMemory(scopeB).text, scopeBText, "Resetting scope A must preserve scope B");
    assert.equal(readConversationSummary(dbPath, compactSummaryKey), compactSummaryValue, "FastMemory reset must preserve compact summary");

    assertOk(runtime.saveFastMemory({ ...scopeA, text: "A_MEMORY_BEFORE_CLEAR_CHAT" }), "restore scope A before clear chat");
    const clearedConversation = assertOk(runtime.clearConversationState(scopeA), "clear current conversation context and FastMemory");
    assert.equal(clearedConversation.clearedFastMemory, 1);
    assert.equal(runtime.getFastMemory(scopeA).text, "");
    assert.equal(runtime.getFastMemory(scopeB).text, scopeBText, "Clearing scope A must preserve scope B");
    assert.equal(readConversationSummary(dbPath, compactSummaryKey), undefined, "Clear chat must remove the scoped compact summary");
    assert.equal(readConversationSummary(dbPath, compactSummaryKeyB), compactSummaryValueB, "Clear chat must preserve other conversation summaries");

    const coreModuleUrl = `${pathToFileURL(path.resolve(__dirname, "../src/core.ts")).href}?selftest=${Date.now()}`;
    const { sanitizeAgentVisibleText, validMessages } = await import(coreModuleUrl);
    const storedUserText = "用户原文必须保留 fmem-20260711-000015 和 entryId: ent-20260711-000016。";
    const migratedMessages = validMessages([
      {
        id: "stored-user",
        role: "user",
        content: storedUserText,
        createdAt: "00:00",
        status: "done",
      },
      {
        id: "stored-experience-result",
        role: "assistant",
        content: "experience 完成：fastmemory 已写入 fmem-20260711-000015。",
        createdAt: "00:01",
        status: "done",
        toolTrace: {
          label: "工具",
          name: "experience",
          operation: "写入绘画经验",
          params: "entryId: ent-20260711-000016",
          brief: "fastmemory 已写入 fmem-20260711-000015。",
        },
      },
      {
        id: "stored-visible-assistant",
        role: "assistant",
        content: "保留这句可见正文。\nselector: all\nentryId: ent-20260711-000017\n内部引用 fmem-20260711-000018 已处理。",
        createdAt: "00:02",
        status: "done",
      },
    ]);
    assert.equal(migratedMessages[0].content, storedUserText, "Stored-message migration must never rewrite user-authored text");
    assert.equal(migratedMessages[1].content, "记录经验成功。");
    assert.equal(forbiddenPublicMetadata.test(JSON.stringify(migratedMessages[1])), false, "Stored Experience result must hide legacy internal metadata");
    assert(migratedMessages[2].content.includes("保留这句可见正文。"));
    assert(migratedMessages[2].content.includes("内部引用  已处理。"));
    assert.equal(forbiddenPublicMetadata.test(migratedMessages[2].content), false, "Stored assistant message migration must remove internal metadata-only lines and IDs");

    const liveExperienceText = sanitizeAgentVisibleText(
      "我需要记录经验 fmem-20260711-000015。\nentryId: ent-20260711-000016\nfastmemory 已写入 fmem-20260711-000017。"
    );
    assert.equal(forbiddenPublicMetadata.test(liveExperienceText), false, "Live tool traces must hide internal FastMemory metadata before persistence");

    const cancelledScope = { projectId: "cancelled-project", conversationId: "cancelled-conversation" };
    const cancelledPending = assertOk(runtime.cancelPendingExecutionState({
      ...cancelledScope,
      requestId: "ask-cancelled-selftest",
    }), "cancel pending Agent execution");
    assert.equal(cancelledPending.requestId, "ask-cancelled-selftest");
    const cancelledRequestOffset = capturedModelRequests.length;
    await runtime.chat({
      ...cancelledScope,
      prompt: "这是取消后的新任务。",
      settings: { ...schemaSettings, agentModel: "gpt-5.6-terra" },
      messages: [],
      nodes: [],
      referenceImages: [],
    });
    const cancelledProtocolRequest = capturedModelRequests[cancelledRequestOffset];
    assert(cancelledProtocolRequest, "Expected a model request after cancelling a pending execution");
    assert.match(JSON.stringify(cancelledProtocolRequest), /用户已取消补充请求 ask-cancelled-selftest/);
    assert.match(JSON.stringify(cancelledProtocolRequest), /后续消息必须作为新的独立请求处理/);

    const runtimeSmoke = assertOk(runtime.smokeTest(), "Agent runtime smoke test");
    assert.equal(runtimeSmoke.plainTextPromptVisibleOk, true);
    assert.equal(runtimeSmoke.fastMemorySanitizationOk, true);
    assert.equal(runtimeSmoke.publicExperienceSchemaMetadataHiddenOk, true);
    assert.equal(runtimeSmoke.modelToolEnvelopeMetadataHiddenOk, true);
    assert.equal(runtimeSmoke.modelToolFailureMetadataHiddenOk, true);
    assert.equal(runtimeSmoke.explicitSelectedImageModelOk, true);
    assert.equal(runtimeSmoke.unselectedImageModelFallbackOk, true);
    assert.equal(runtimeSmoke.singleModelDefaultSelectionOk, true);

    const resetPrompt = assertOk(runtime.resetMainPrompt(), "reset Main Agent Prompt");
    const expectedDefaultPrompt = defaultPromptText("main");
    assert.equal(/\bprompt-main-[a-z0-9_-]+\b|\bentry[_ ]?id\b|\bselector\b/i.test(expectedDefaultPrompt), false);
    assert.match(expectedDefaultPrompt, /默认交付商业级高质量图片/);
    assert.match(expectedDefaultPrompt, /image_gen 成功返回真实图片后.*view_image/);
    assert.match(expectedDefaultPrompt, /最多主动修正并重新生成一次/);
    assert.match(expectedDefaultPrompt, /正常构图、文字和一致性质检使用 detail=high/);
    assert.match(expectedDefaultPrompt, /多张图片不得在同一轮全部请求 original/);
    assert.match(expectedDefaultPrompt, /同一个 assistant 回合并行调用所需的 view_image/);
    assert.match(expectedDefaultPrompt, /不得重复打开/);
    assert.match(expectedDefaultPrompt, /审美决策按用户当前明确要求、参考图角色与用途、当前选中成果、当前会话 FastMemory/);
    assert.match(expectedDefaultPrompt, /用途、主体及身份或商品、场景、风格与媒介、构图与景别/);
    assert.match(expectedDefaultPrompt, /只改变目标变量，其他成功要素保持不变/);
    assert.match(expectedDefaultPrompt, /宽高占整幅画面的比例.*10%/);
    assert.match(expectedDefaultPrompt, /未展示的背面结构只能作为推断/);
    assert.match(expectedDefaultPrompt, /明确报告部分失败/);
    assert.match(expectedDefaultPrompt, /服装上身优先锁定模特身份.*服装版型/);
    assert.match(expectedDefaultPrompt, /Logo 任务.*栅格概念图.*不得声称是可编辑矢量文件/);
    assert.match(expectedDefaultPrompt, /角色定制和游戏原画.*同一角色/);
    assert.equal(resetPrompt.text, expectedDefaultPrompt);
    assert.equal(resetPrompt.isDefault, true);
    assert.equal(resetPrompt.defaultUpdateAvailable, false);
    assert.equal(resetPrompt.currentPromptHash, resetPrompt.defaultPromptHash);
    assert.equal(resetPrompt.baseDefaultPromptRevision, resetPrompt.defaultPromptRevision);
    assert.equal(resetPrompt.baseDefaultPromptHash, resetPrompt.defaultPromptHash);
    assert.equal(runtime.getMainPrompt().text, expectedDefaultPrompt);
    assert.equal(JSON.stringify(runtime.getToolSchemas(schemaSettings)), schemasBeforePromptSaveJson, "Resetting Prompt must not alter tool schemas");

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        legacyPromptMigrated: true,
        legacyV2PromptContractMigrated: true,
        promptV2PlainText: true,
        promptValidation: true,
        toolSchemasIndependent: true,
        scopedFastMemoryIsolated: true,
        emptyCanvasSelectionOmitted: true,
        publicMetadataHidden: true,
        modelPromptMetadataHidden: true,
        modelToolMetadataHidden: true,
        publicExperienceSchemaSanitized: true,
        contextManagePromptRejected: true,
        compactSummaryPreserved: true,
        clearConversationIsolated: true,
        longFastMemoryContextSelected: true,
        storedAssistantMetadataMigrated: true,
        promptDefaultRevisionTracked: true,
        naturalLanguageToolChoiceAutonomous: true,
        imageArgumentsPreserved: true,
        explicitGenerationModePreserved: true,
        singleItemItemsCompatible: true,
        singletonObjectItemsCompatible: true,
        repeatedSingletonCountPreserved: true,
        expandedSingletonPromptCompatible: true,
        internalArgumentErrorsHidden: true,
        internalPendingSkipsHidden: true,
        imagePreflightValidationHidden: true,
        layerHintsPassedToImageService: true,
        nativeMultiToolLoop: true,
        silentToolFallbackReadable: true,
        imageToolResultReturnedToModel: true,
        viewImageHistoryCompacted: true,
        failureRecoveryUsesToolRoleOnly: true,
        exactDuplicateToolCallsBlocked: true,
        differentToolArgumentsAllowed: true,
        placeholderImageItemsTolerated: true,
        effectiveImageItemCountPreserved: true,
        genuineSingleItemConflictsRejected: true,
        containerAssetIndexPassed: true,
        requirementNodeReusePassed: true,
        selectedCanvasSourceFallback: true,
        taskScopeSourceReferenceIsolation: true,
        referenceRolePurposePassed: true,
        cutoutRequiresPaintedRegion: true,
        nativeCutoutTransparencyPassed: true,
        boundedLargeCanvasContext: true,
        selectedCanvasArtifactsPreserved: true,
        workflowPaginationComplete: true,
        workflowFiltersPassed: true,
        canvasScopeIsolationPassed: true,
        invalidImageArgumentsRejected: true,
        internalToolsIsolated: true,
        explicitModelToolSets: true,
        runtimeSmokePassed: true,
      })}\n`,
    );
  } finally {
    // The parent process removes this directory after this worker exits and
    // releases the runtime's private SQLite connection on Windows.
  }
}

function launchSelftestWorker() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "naimage-agent-text-config-selftest-"));
  const result = spawnSync(process.execPath, [__filename, "--worker", directory], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  rmSync(directory, { recursive: true, force: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

if (process.argv[2] === "--worker") {
  const directory = path.resolve(String(process.argv[3] || ""));
  runSelftest(directory).catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
} else {
  try {
    launchSelftestWorker();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
