import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  paused: false,
  stopPending: false,
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
        prompts: [{ title: "商品图", prompt: "高品质商品主图" }]
      }
    }
  ],
  conversations: [{ id: "conv-1", title: "商品详情图", messages: [], createdAt: "", updatedAt: "10:01" }],
  activeConversationId: "conv-1",
  selectedArtifactCount: 3,
  sourceImageCount: 1,
  referenceImageCount: 2,
  goal: {
    available: true,
    active: false,
    snapshotHash: `goal-${"a".repeat(32)}`,
    containerCount: 4,
    assetCount: 6,
    operationsPerAsset: 1,
    requestCount: 6,
    skippedContainerCount: 1,
    probeContainerCount: 2,
    concurrencyCap: 6,
    trialImagesUsed: 2,
    paidImages: 4,
    estimatedMaxCostCents: 80,
    warning: "Dispatched requests may still incur charges."
  },
  agentProgress: [{ phase: "image-request", summary: "生成图片" }],
  theme: "light" as const,
  themePalette: "anthropic" as const,
  customTheme: null,
  glassTheme: "dark-emerald" as const,
  glassMaterial: "custom" as const,
  glassParameters: {
    opacity: 31,
    blur: 17,
    saturation: 145,
    highlight: 29,
    shadow: 36,
    radius: 19,
    accent: "coral" as const,
    noise: false,
    reduceMotion: true
  }
};

const snapshot = buildAgentWindowSnapshot(base);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.statusText, "Agent 正在输出 12s");
assert.equal(snapshot.messages.length, 2);
assert.equal(snapshot.messages[0].sourceCount, 1);
assert.equal(snapshot.messages[1].toolTrace?.prompts.length, 1);
assert.equal(snapshot.conversations[0].active, true);
assert.equal(snapshot.selectedArtifactCount, 3);
assert.equal(snapshot.goal.available, true);
assert.equal(snapshot.goal.snapshotHash, `goal-${"a".repeat(32)}`);
assert.equal(snapshot.goal.containerCount, 4);
assert.equal(snapshot.goal.assetCount, 6);
assert.equal(snapshot.goal.operationsPerAsset, 1);
assert.equal(snapshot.goal.requestCount, 6);
assert.equal(snapshot.goal.probeContainerCount, 2);
assert.equal(snapshot.goal.concurrencyCap, 6);
assert.equal(snapshot.goal.estimatedMaxCostCents, 80);
assert.equal(snapshot.stopPending, false);
assert.equal(snapshot.glassAppearance.glassTheme, "dark-emerald");
assert.equal(snapshot.glassAppearance.glassMaterial, "custom");
assert.equal(snapshot.glassAppearance.mode, "dark");
assert.equal(snapshot.glassAppearance.resolvedAccent, "coral");
assert.equal(snapshot.glassAppearance.variables["--glass-alpha"], "0.31");
assert.equal(snapshot.glassAppearance.variables["--glass-blur"], "17px");
assert.equal(snapshot.glassAppearance.variables["--theme-canvas"], "#07100d");
assert.equal(snapshot.glassAppearance.variables["--theme-accent"], "#ff8b78");
assert.equal(JSON.stringify(snapshot.glassAppearance).includes("agentApiKey"), false);
assert.equal(agentWindowStatusText({ ...base, busy: false, runElapsedSeconds: 0, agentStatus: "error", agentProgress: [{ phase: "error" }] }), "Agent 遇到问题");
assert.equal(agentWindowStatusText({ ...base, stopPending: true }), "Agent 正在确认结束");

const stopPendingSnapshot = buildAgentWindowSnapshot({ ...base, stopPending: true });
assert.equal(stopPendingSnapshot.busy, true, "Stop confirmation must not publish a false idle state");
assert.equal(stopPendingSnapshot.stopPending, true);

assert.deepEqual(normalizeAgentWindowCommand({ type: "send", prompt: "测试" }), { type: "send", prompt: "测试", taskScopeMode: "auto", taskMode: "standard" });
assert.deepEqual(
  normalizeAgentWindowCommand({ type: "send", prompt: "追加来源", taskScopeMode: "merge-source" }),
  { type: "send", prompt: "追加来源", taskScopeMode: "merge-source", taskMode: "standard" }
);
assert.deepEqual(
  normalizeAgentWindowCommand({ type: "send", prompt: "无效模式", taskScopeMode: "invalid" }),
  { type: "send", prompt: "无效模式", taskScopeMode: "auto", taskMode: "standard" }
);
const goalSnapshotHash = `goal-${"b".repeat(32)}`;
assert.deepEqual(
  normalizeAgentWindowCommand({
    type: "send",
    prompt: "apply to every container",
    taskScopeMode: "merge-source",
    taskMode: "goal",
    goalConfirmed: true,
    expectedSnapshotHash: goalSnapshotHash.toUpperCase()
  }),
  {
    type: "send",
    prompt: "apply to every container",
    taskScopeMode: "auto",
    taskMode: "goal",
    goalConfirmed: true,
    expectedSnapshotHash: goalSnapshotHash
  }
);
assert.equal(normalizeAgentWindowCommand({ type: "send", prompt: "goal", taskMode: "goal", expectedSnapshotHash: goalSnapshotHash }), null);
assert.equal(normalizeAgentWindowCommand({ type: "send", prompt: "goal", taskMode: "goal", goalConfirmed: true }), null);
assert.equal(normalizeAgentWindowCommand({ type: "send", prompt: "goal", taskMode: "goal", goalConfirmed: true, expectedSnapshotHash: "stale" }), null);
assert.equal(
  normalizeAgentWindowCommand({ type: "send", prompt: "goal", taskMode: "goal", goalConfirmed: true, expectedSnapshotHash: `scope-${"b".repeat(32)}` }),
  null,
  "A TaskScope hash is not a prompt-bound Goal confirmation"
);
assert.deepEqual(normalizeAgentWindowCommand({ type: "pause-confirmed" }), { type: "pause-confirmed" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "resume" }), { type: "resume" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "stop-confirmed" }), { type: "stop-confirmed" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "switch-conversation", conversationId: "conv-2" }), { type: "switch-conversation", conversationId: "conv-2" });
assert.deepEqual(normalizeAgentWindowCommand({ type: "dock", placement: "top" }), { type: "dock", placement: "top" });
assert.equal(normalizeAgentWindowCommand({ type: "dock", placement: "external" }), null);
assert.equal(normalizeAgentWindowCommand({ type: "switch-conversation", conversationId: "" }), null);
assert.equal(normalizeAgentWindowCommand({ type: "unknown" }), null);
assert.equal(normalizeAgentWindowCommand(null), null);

const unavailableGoalSnapshot = buildAgentWindowSnapshot({
  ...base,
  goal: {
    ...base.goal,
    available: true,
    active: true,
    snapshotHash: "invalid",
    probeContainerCount: 9,
    estimatedMaxCostCents: -1
  }
});
assert.equal(unavailableGoalSnapshot.goal.available, false);
assert.equal(unavailableGoalSnapshot.goal.active, false);
assert.equal(unavailableGoalSnapshot.goal.snapshotHash, "");
assert.equal(unavailableGoalSnapshot.goal.probeContainerCount, 2);
assert.equal(unavailableGoalSnapshot.goal.estimatedMaxCostCents, undefined);

const activeGoalSnapshot = buildAgentWindowSnapshot({
  ...base,
  goal: { ...base.goal, active: true, snapshotHash: `scope-${"c".repeat(32)}` }
});
assert.equal(activeGoalSnapshot.goal.available, true);
assert.equal(activeGoalSnapshot.goal.active, true);
assert.equal(activeGoalSnapshot.goal.snapshotHash, `scope-${"c".repeat(32)}`);

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
      ]
    }
  }))
});
assert(Buffer.byteLength(JSON.stringify(boundedSnapshot), "utf8") < 16 * 1024 * 1024, "Worst-case Renderer snapshot must fit the Main service boundary");

const surfaceHtml = readFileSync(new URL("../agent-window.html", import.meta.url), "utf8");
const surfaceRenderer = readFileSync(new URL("../agent-window-renderer.js", import.meta.url), "utf8");
const surfaceCss = readFileSync(new URL("../agent-window.css", import.meta.url), "utf8");
assert.match(surfaceHtml, /id="standard-mode"/);
assert.match(surfaceHtml, /id="goal-mode"/);
assert.match(surfaceHtml, /id="goal-summary"/);
assert.match(surfaceHtml, /id="goal-steer-lock"/);
assert.match(surfaceRenderer, /window\.confirm\(goalConfirmationText\(goal\)\)/);
assert.match(surfaceRenderer, /taskMode: "goal"/);
assert.match(surfaceRenderer, /goalConfirmed: true/);
assert.match(surfaceRenderer, /expectedSnapshotHash: goal\.snapshotHash/);
assert.match(surfaceRenderer, /command\(\{ type: "send", prompt, taskScopeMode: "keep" \}\)/,
  "An active Goal must submit a text-only keep steer");
assert.match(surfaceRenderer, /steerModeField\.hidden = !state\.busy \|\| activeGoal/);
assert.match(surfaceRenderer, /stopButton\.disabled = stopPending/);
assert.match(surfaceRenderer, /stopButton\.textContent = stopPending \? "正在结束" : "结束"/);
assert.match(surfaceRenderer, /if \(!currentState\?\.busy \|\| currentState\.stopPending\) return/,
  "The detached window must not dispatch a second stop while confirmation is pending");
assert.match(surfaceRenderer, /applyGlassAppearance\(state\)/);
assert.match(surfaceRenderer, /root\.dataset\.glassTheme = appearance\.glassTheme/);
assert.match(surfaceRenderer, /glassVariableNamePattern\.test\(name\)/);
assert.match(surfaceCss, /grid-template-rows: auto auto auto minmax\(0, 1fr\) auto auto/);
assert.match(surfaceCss, /:root\.glass-theme-active \.agent-header/);
assert.match(surfaceCss, /backdrop-filter: blur\(var\(--glass-blur\)\)/);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 68 })}\n`);
