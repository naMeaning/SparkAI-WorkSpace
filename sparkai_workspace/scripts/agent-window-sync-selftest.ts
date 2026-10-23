import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creationResultStatus } from "../src/creation-session.ts";
import type { CreationSessionSnapshot } from "../src/creation-session.ts";
import { creationRequirementsDraft, creationRequirementsFromDraft } from "../runtime/creation-requirements-form.mjs";

import {
  agentWindowStatusText,
  buildAgentWindowSnapshot,
  normalizeAgentWindowCommand
} from "../src/agent-window-sync.ts";

const base = {
  ready: true,
  projectName: "跨境商品图",
  workspaceDomain: "commerce" as const,
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
assert.deepEqual(snapshot.workspaceDomain, { id: "commerce", title: "电商创作" });
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
assert.equal("trialImagesUsed" in snapshot.goal, false);
assert.equal("paidImages" in snapshot.goal, false);
assert.equal("estimatedMaxCostCents" in snapshot.goal, false);
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
const localProfile = {
  providerKind: "local-openai-compatible" as const, profileId: "agent-fixture", profileLabel: "fixture-private-label", modelId: "fixture-local",
  capabilities: { tools: true, vision: false, contextWindowTokens: 8192, maxOutputTokens: 1024 }, strictOffline: true,
  networkScope: "local" as const, availability: "configured" as const,
  baseUrl: "https://synthetic-private-endpoint.invalid", credentialRef: "synthetic-private-credential", bindingId: "synthetic-private-binding", token: "synthetic-private-token"
};
const localSnapshot = buildAgentWindowSnapshot({ ...base, modelName: "fixture-local", providerStatus: localProfile });
assert.equal(localSnapshot.providerSummary, "本地 Agent · 严格离线 · 仅本机连接 · 工具 可用 · 视觉 关闭 · 上下文 8192");
assert.equal("providerStatus" in localSnapshot, false, "Detached windows receive only the bounded provider summary");
assert.doesNotMatch(JSON.stringify(localSnapshot), /synthetic-private|fixture-private-label/, "Private provider metadata is never copied into the window snapshot");
const managedSnapshot = buildAgentWindowSnapshot({ ...base, providerStatus: { ...localProfile, providerKind: "managed-local", strictOffline: false } });
assert.match(managedSnapshot.providerSummary || "", /^托管本地 Agent · 本机服务 · 可用网络工具/);
assert.equal(agentWindowStatusText({ ...base, busy: false, runElapsedSeconds: 0, agentStatus: "error", agentProgress: [{ phase: "error" }] }), "Agent 遇到问题");
assert.equal(agentWindowStatusText({ ...base, messages: [], busy: false, runElapsedSeconds: 0, agentStatus: "idle", agentProgress: [{ phase: "runtime-partial" }] }), "图片成果已保留，后续对话未完成");
assert.equal(agentWindowStatusText({ ...base, messages: [], busy: false, runElapsedSeconds: 0, agentStatus: "error", agentProgress: [{ phase: "runtime-partial" }] }), "Agent 遇到问题", "Tool failures must remain failures");
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
    probeContainerCount: 9
  }
});
assert.equal(unavailableGoalSnapshot.goal.available, false);
assert.equal(unavailableGoalSnapshot.goal.active, false);
assert.equal(unavailableGoalSnapshot.goal.snapshotHash, "");
assert.equal(unavailableGoalSnapshot.goal.probeContainerCount, 2);
assert.equal("estimatedMaxCostCents" in unavailableGoalSnapshot.goal, false);

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
assert.doesNotMatch(surfaceHtml, /id="(?:standard-mode|goal-mode)"/);
assert.match(surfaceHtml, /id="composer-commands"/);
assert.match(surfaceHtml, /type="module"/);
assert.deepEqual(normalizeAgentWindowCommand({ type: "edit-image-config" }), { type: "edit-image-config" });
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
assert.match(surfaceCss, /grid-template-rows: auto auto auto auto minmax\(0, 1fr\) auto auto/);
assert.match(surfaceHtml, /id="agent-task-card"/);
const taskAnswer = { type: "task-answer", taskId: "task-1", projectId: "project-1", conversationId: "conv-1", questionId: "question-1", expectedVersion: 7, answer: "红色" };
assert.deepEqual(normalizeAgentWindowCommand(taskAnswer), taskAnswer);
assert.equal(normalizeAgentWindowCommand({ ...taskAnswer, expectedVersion: -1 }), null);
assert.equal(normalizeAgentWindowCommand({ ...taskAnswer, questionId: "" }), null);
const taskCard = { title: "确认颜色", phase: "等待回答", savedCount: 0, question: "请选择", error: "", action: "answer" as const };
assert.deepEqual(buildAgentWindowSnapshot({ ...base, taskCard }).taskCard, taskCard);
assert.match(surfaceCss, /:root\.glass-theme-active \.agent-header/);
assert.match(surfaceCss, /--glass-backdrop-filter: blur\(var\(--glass-blur\)\)/);
assert.match(surfaceCss, /backdrop-filter: var\(--glass-backdrop-filter\)/);
for (const glassTheme of ["light-silver", "light-classic", "dark-classic"] as const) {
  const themeSnapshot = buildAgentWindowSnapshot({ ...base, glassTheme });
  assert.equal(themeSnapshot.glassAppearance.glassTheme, glassTheme);
  assert(surfaceRenderer.includes(`"${glassTheme}"`), `Independent Agent must accept ${glassTheme}`);
}

const creation: CreationSessionSnapshot = {
  projectId: "project-1", conversationId: "conv-1",
  requirements: { requirementId: "requirement-1", conversationId: "conv-1", revision: 2, fingerprint: "a".repeat(64),
    goal: { text: "七张商品图", source: "user" }, usage: { text: "商品页面", source: "assumption" },
    slots: [{ slotId: "slot-2", label: "细节图", source: "user" }], preserve: [], adjustable: [], conditions: [] },
  results: Array.from({ length: 7 }, (_, index) => ({ target: { assetId: `asset-${index + 1}`, occurrenceId: `occurrence-${index + 1}`, contentHash: String(index + 1).repeat(64) },
    label: `成果 ${index + 1}`, generated: true, saved: true, current: true, invalidReasons: [], decision: { state: "candidate" as const },
    previewUrl: index === 0 ? "https://untrusted.invalid/result?token=synthetic" : `naimage-asset://managed/${index + 1}`,
    fileCheck: { status: "passed" as const, checkedAt: "2026-10-20", contentHash: String(index + 1).repeat(64), issues: [] } }))
};
creation.results[1].visualReview = { reviewId: "review-2", verdict: "revise", reviewedAt: "2026-10-20", summary: "背景需调整", findings: [], modelRoundId: "round-2", runId: "run-2" };
creation.results[1].decision.state = "approved";
const injectedCreation = structuredClone(creation) as CreationSessionSnapshot & { privatePath?: string };
injectedCreation.privatePath = "synthetic-private-path";
const creationProjection = buildAgentWindowSnapshot({ ...base, creationSession: injectedCreation });
assert.equal(creationProjection.creationSession?.results.length, 7);
assert.equal(creationProjection.creationSession?.results[0].previewUrl, undefined, "Detached snapshots cannot expose upstream/signed image URLs");
assert.equal(creationProjection.creationSession?.results[1].previewUrl, "naimage-asset://managed/2");
assert.equal(JSON.stringify(creationProjection).includes("synthetic-private-path"), false);
assert.equal(creationResultStatus(creation.results[1]).ai, "AI 建议修改");
assert.equal(creationResultStatus(creation.results[1]).decision, "用户已采用", "User adoption never changes the AI verdict");
const requirementsWithSource = structuredClone(creation.requirements!);
requirementsWithSource.conditions.push({ criterionId: "identity-rule", text: "保留原商品", source: "assumption", kind: "source_consistency", sourceTargets: [creation.results[1].target], slotIds: ["slot-2"] });
requirementsWithSource.fileRules = { minWidth: 768, minHeight: 768, alpha: "any" };
const editedDraft = creationRequirementsDraft(requirementsWithSource);
editedDraft.slots[0].label = "新的细节图名称";
editedDraft.slots[0].source = "user";
editedDraft.conditions[0].text = "完整保留原商品的形状与品牌";
editedDraft.conditions[0].source = "user";
const editedRequirements = creationRequirementsFromDraft(editedDraft);
assert.equal(editedRequirements.slots[0].slotId, "slot-2", "Renaming a deliverable preserves its stable identity");
assert.equal(editedRequirements.conditions[0].criterionId, "identity-rule");
assert.equal(editedRequirements.conditions[0].kind, "source_consistency");
assert.deepEqual(editedRequirements.conditions[0].sourceTargets, [creation.results[1].target], "Editing requirement text preserves its exact source baseline");
assert.equal(editedRequirements.usage.source, "assumption", "Editing one field does not convert other Agent assumptions into user requirements");
assert.equal(editedRequirements.fileRules?.minWidth, 768);
assert.equal(requirementsWithSource.conditions[0].text, "保留原商品", "Form edits do not mutate the authoritative snapshot");
assert.equal(requirementsWithSource.slots[0].label, "细节图");
const emptySlotDraft = creationRequirementsDraft(requirementsWithSource); emptySlotDraft.slots[0].label = "";
assert.throws(() => creationRequirementsFromDraft(emptySlotDraft), /明确移除/, "An empty label cannot silently remove a stable deliverable");
const creationRevision = { type: "creation-revision", input: { expectedProjectId: creation.projectId, conversationId: creation.conversationId,
  requirementId: "requirement-1", expectedRevision: 2, submissionId: "revise-2-5", preserve: ["保留主体"], changes: [],
  targets: [ { ...creation.results[1].target, changes: ["改浅色背景"] }, { ...creation.results[4].target, changes: ["减少文字密度"] } ] } };
assert.deepEqual(normalizeAgentWindowCommand(creationRevision), creationRevision);
assert.equal(normalizeAgentWindowCommand({ ...creationRevision, input: { ...creationRevision.input, targets: [{ ...creation.results[1].target, assetId: "../private" }] } }), null);
assert.equal(normalizeAgentWindowCommand({ ...creationRevision, input: { ...creationRevision.input, targets: [creation.results[1].target] } }), null, "Every target needs common or individual changes");
assert.equal(normalizeAgentWindowCommand({ type: "creation-check", input: creationRevision.input }), null, "File-check targets cannot contain edit instructions");
assert.deepEqual(normalizeAgentWindowCommand({ type: "creation-decision", input: { expectedProjectId: "project-1", conversationId: "conv-1", expectedRevision: 2, target: creation.results[1].target, decision: "adopt" } }),
  { type: "creation-decision", input: { expectedProjectId: "project-1", conversationId: "conv-1", expectedRevision: 2, target: creation.results[1].target, decision: "adopt" } });
assert.equal(normalizeAgentWindowCommand({ type: "creation-decision", input: { expectedProjectId: "project-1", conversationId: "conv-1", expectedRevision: 2, target: creation.results[1].target, decision: "pass" } }), null);
const regionRevision = { type: "creation-region-revision", input: { expectedProjectId: creation.projectId, conversationId: creation.conversationId,
  requirementId: "requirement-1", expectedRevision: 2, target: { ...creation.results[1].target, changes: ["改浅色背景"] }, preserve: ["保留主体"], changes: [] } };
assert.deepEqual(normalizeAgentWindowCommand(regionRevision), regionRevision, "A single stable target can open the existing paint editor");
assert.equal(normalizeAgentWindowCommand({ ...regionRevision, input: { ...regionRevision.input, target: { ...regionRevision.input.target, path: "private.png" } } }), null);
assert.equal(normalizeAgentWindowCommand({ ...regionRevision, input: { ...regionRevision.input, targets: [regionRevision.input.target] } }), null, "Region transport cannot add a second target list");
const maskedRevision = { ...creationRevision, input: { ...creationRevision.input, targets: [{ ...creationRevision.input.targets[0], mask: creation.results[4].target }] } };
assert.deepEqual(normalizeAgentWindowCommand(maskedRevision), maskedRevision);
assert.equal(normalizeAgentWindowCommand({ ...maskedRevision, input: { ...maskedRevision.input, targets: [{ ...maskedRevision.input.targets[0], mask: { ...creation.results[4].target, path: "private.png" } }] } }), null);
assert.equal(normalizeAgentWindowCommand({ ...maskedRevision, input: { ...maskedRevision.input, targets: [...maskedRevision.input.targets, creationRevision.input.targets[1]] } }), null, "Masked revisions cannot include more than one target");
assert.match(surfaceHtml, /id="agent-creation-session"/);
assert.match(surfaceRenderer, /creationView\.render\(state\)/);
process.stdout.write(`${JSON.stringify({ ok: true, cases: 101 })}\n`);
