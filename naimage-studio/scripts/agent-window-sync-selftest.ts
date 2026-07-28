import assert from "node:assert/strict";

import {
  agentWindowStatusText,
  buildAgentWindowSnapshot,
  normalizeAgentWindowCommand
} from "../src/agent-window-sync.ts";

const base = {
  ready: true,
  projectName: "跨境商品图",
  modelName: "gpt-5.6-sol",
  agentStatus: "thinking" as const,
  busy: true,
  runElapsedSeconds: 12,
  prompt: "生成六张商品详情图",
  messages: [
    {
      id: "user-1",
      role: "user" as const,
      content: "生成六张商品详情图",
      createdAt: "10:00",
      status: "done" as const,
      attachments: { sourceCount: 1, referenceCount: 2 }
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      content: "正在生成",
      createdAt: "10:01",
      status: "running" as const,
      meta: "assistant-stream",
      toolTrace: {
        stage: "start" as const,
        label: "Image Gen",
        name: "image_gen",
        operation: "generate",
        params: "1:1",
        brief: "生成商品主图",
        prompts: [{ title: "商品图", prompt: "高品质商品主图" }],
        partialImage: { dataUrl: "data:image/png;base64,AAAA", index: 1, total: 3 }
      }
    }
  ],
  conversations: [{ id: "conv-1", title: "商品详情图", messages: [], createdAt: "", updatedAt: "10:01" }],
  activeConversationId: "conv-1",
  selectedArtifactCount: 3,
  sourceImageCount: 1,
  referenceImageCount: 2,
  agentProgress: [{ phase: "image-request", summary: "生成图片" }],
  theme: "light" as const,
  themePalette: "terracotta" as const
};

const snapshot = buildAgentWindowSnapshot(base);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.statusText, "Agent 正在输出 12s");
assert.equal(snapshot.messages.length, 2);
assert.equal(snapshot.messages[0].sourceCount, 1);
assert.equal(snapshot.messages[1].toolTrace?.partialImage?.total, 3);
assert.equal(snapshot.conversations[0].active, true);
assert.equal(snapshot.selectedArtifactCount, 3);
assert.equal(agentWindowStatusText({ ...base, busy: false, runElapsedSeconds: 0, agentStatus: "error", agentProgress: [{ phase: "error" }] }), "Agent 遇到问题");

assert.deepEqual(normalizeAgentWindowCommand({ type: "send", prompt: "测试" }), { type: "send", prompt: "测试" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "stop" }), { type: "stop" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "switch-conversation", conversationId: "conv-2" }), { type: "switch-conversation", conversationId: "conv-2" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "dock", placement: "top" }), { type: "dock", placement: "top" });
assert.equal(normalizeAgentWindowCommand({ type: "dock", placement: "external" }), null);
assert.equal(normalizeAgentWindowCommand({ type: "switch-conversation", conversationId: "" }), null);
assert.equal(normalizeAgentWindowCommand({ type: "unknown" }), null);
assert.equal(normalizeAgentWindowCommand(null), null);

const largePartial = `data:image/png;base64,${"A".repeat(2_400_000)}`;
const boundedSnapshot = buildAgentWindowSnapshot({
  ...base,
  prompt: "长".repeat(200_000),
  messages: Array.from({ length: 40 }, (_item, index) => ({
    id: `heavy-${index}`,
    role: "assistant" as const,
    content: "文".repeat(16_000),
    createdAt: "10:00",
    status: "running" as const,
    toolTrace: {
      label: "Image Gen",
      name: "image_gen",
      operation: "generate",
      params: "1:1",
      brief: "预览",
      prompts: [
        { title: "提示词 1", prompt: "图".repeat(12_000) },
        { title: "提示词 2", prompt: "图".repeat(12_000) }
      ],
      partialImage: { dataUrl: largePartial, index: 1, total: 3 }
    }
  }))
});
assert.equal(boundedSnapshot.messages.filter((message) => message.toolTrace?.partialImage).length, 3);
assert(Buffer.byteLength(JSON.stringify(boundedSnapshot), "utf8") < 16 * 1024 * 1024, "Worst-case Renderer snapshot must fit the Main service boundary");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 18 })}\n`);
