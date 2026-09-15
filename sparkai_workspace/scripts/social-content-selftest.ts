import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { builtinPluginManifests } from "../src/plugin-system.ts";
import { defaultSettings, mergeSettings, normalizeWorkflowOnboardingState } from "../src/settings-persistence.ts";
import {
  applySocialPlanToRequirementNode,
  normalizeDouyinPlan,
  normalizeSocialContentMetadata,
  normalizeXiaohongshuPlan
} from "../src/plugins/social-content.ts";

const require = createRequire(import.meta.url);
const runtime = require("../runtime/social-content-plan.cjs") as {
  mergeSocialContentWriteback(current: unknown, proposed: unknown): Record<string, unknown>;
  normalizeDouyinPlan(value: unknown): Record<string, unknown>;
  normalizeSocialContentMetadata(value: unknown): Record<string, unknown> | null;
  normalizeXiaohongshuPlan(value: unknown): Record<string, unknown>;
  composeSocialContentTask(value: unknown): { plan: Record<string, unknown>; prompt: string; visibleContent: string };
  socialContentWritebackIssues(value: unknown): string[];
};
const { composePluginTask } = require("../desktop/plugin-task-prompts.cjs") as {
  composePluginTask(value: unknown): { plan: Record<string, unknown>; prompt: string; visibleContent: string };
};
const { createAgentRuntime, socialContentForImageTask } = require("../agent-runtime.cjs") as {
  createAgentRuntime(value: Record<string, unknown>): {
    getToolSchemas(settings?: unknown): Array<{ function?: { name?: string; parameters?: { properties?: { operation?: { enum?: string[] } } } } }>;
    runTool(name: string, input: unknown, context: unknown): Promise<{ actions: Array<Record<string, unknown>>; envelope: Record<string, unknown> }>;
    dispose(): void;
  };
  socialContentForImageTask(taskScope: unknown, nodes: unknown[], args: unknown, outputCount: number): Record<string, unknown> | undefined;
};
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs") as {
  sanitizeSession(value: unknown): { nodes: Array<Record<string, unknown>> };
};

const xiaohongshuInput = {
  platform: "xiaohongshu",
  brief: "夏季通勤防晒经验",
  contentKind: "experience-share",
  ratio: "4:5",
  cardCount: 99,
  titleCandidates: ["通勤防晒这样做", "通勤防晒这样做", "夏天也不怕晒"],
  tags: ["防晒", "通勤", "防晒"]
};
const xiaohongshu = normalizeXiaohongshuPlan(xiaohongshuInput);
assert.equal(xiaohongshu.cardCount, 9);
assert.equal(xiaohongshu.cards.length, 9);
assert.deepEqual(xiaohongshu.titleCandidates, ["通勤防晒这样做", "夏天也不怕晒"]);
assert.deepEqual(xiaohongshu.tags, ["防晒", "通勤"]);
assert.match(xiaohongshu.workflowId, /^social-workflow-[a-f0-9]{32}$/);
assert.match(xiaohongshu.planHash, /^social-[a-f0-9]{32}$/);
assert.deepEqual(runtime.normalizeXiaohongshuPlan(xiaohongshuInput), xiaohongshu, "Renderer and runtime Xiaohongshu contracts must match");
const defaultXiaohongshu = normalizeXiaohongshuPlan({});
assert.equal(defaultXiaohongshu.cardCount, 7);
assert.deepEqual(runtime.normalizeXiaohongshuPlan({}), defaultXiaohongshu, "Renderer and runtime Xiaohongshu defaults must match");

const douyinInput = {
  platform: "douyin",
  brief: "30 秒展示新品咖啡杯",
  durationSeconds: 45,
  shotCount: 2,
  hooks: ["别再买错咖啡杯", "先看杯口", "再看保温", "超限"]
};
const douyin = normalizeDouyinPlan(douyinInput);
assert.equal(douyin.durationSeconds, 30);
assert.equal(douyin.shotCount, 5);
assert.equal(douyin.shots.length, 5);
assert.equal(douyin.hooks.length, 3);
assert.deepEqual(runtime.normalizeDouyinPlan(douyinInput), douyin, "Renderer and runtime Douyin contracts must match");
const defaultDouyin = normalizeDouyinPlan({});
assert.deepEqual({ ratio: defaultDouyin.ratio, durationSeconds: defaultDouyin.durationSeconds, shotCount: defaultDouyin.shotCount }, {
  ratio: "9:16",
  durationSeconds: 30,
  shotCount: 6
});
assert.deepEqual(runtime.normalizeDouyinPlan({}), defaultDouyin, "Renderer and runtime Douyin defaults must match");

const metadata = normalizeSocialContentMetadata({
  platform: "xiaohongshu",
  contentType: "card",
  workflowId: xiaohongshu.workflowId,
  slot: "card-2",
  variant: 1,
  status: "generated"
});
assert.deepEqual(runtime.normalizeSocialContentMetadata(metadata), metadata);
assert.equal(normalizeSocialContentMetadata({ platform: "xiaohongshu", contentType: "card", workflowId: "invalid" }), undefined);

const task = runtime.composeSocialContentTask({
  command: "sparkai.social-content.new-xiaohongshu",
  plan: xiaohongshuInput
});
assert.match(task.prompt, /workflow\(operation=update_social_content\)/);
assert.match(task.prompt, /SOCIAL_PLAN_JSON:/);
assert.equal(task.plan.planHash, xiaohongshu.planHash);
assert.equal(composePluginTask({ command: "sparkai.social-content.new-xiaohongshu", plan: xiaohongshuInput }).plan.planHash, xiaohongshu.planHash);

const completedXiaohongshu = runtime.mergeSocialContentWriteback(xiaohongshu, {
  platform: "xiaohongshu",
  workflowId: xiaohongshu.workflowId,
  titleCandidates: ["标题 1", "标题 2", "标题 3"],
  recommendedTitle: "标题 1",
  body: "可以直接发布的正文。",
  tags: ["通勤", "防晒"],
  cover: { title: "封面标题", prompt: "清爽通勤防晒封面" },
  cards: xiaohongshu.cards.map((card) => ({ ...card, copy: `${card.order} 页文案`, prompt: `${card.order} 页画面` }))
});
assert.deepEqual(runtime.socialContentWritebackIssues(completedXiaohongshu), []);
assert.equal(completedXiaohongshu.ratio, "4:5", "Agent writeback must preserve the configured ratio");
assert.equal(completedXiaohongshu.cardCount, 9, "Agent writeback must preserve the configured card count");

const sanitized = sanitizeSession({
  nodes: [{
    id: "SOCIAL-REQ",
    type: "requirement",
    title: "小红书图文",
    prompt: "夏季通勤防晒经验",
    status: "done",
    x: 100,
    y: 100,
    requirement: {
      version: 2,
      text: "夏季通勤防晒经验",
      revision: 1,
      createdFrom: "canvas",
      socialPlan: xiaohongshu
    }
  }]
});
const requirement = sanitized.nodes[0]?.requirement as { socialPlan?: { workflowId?: string } } | undefined;
assert.equal(requirement?.socialPlan?.workflowId, xiaohongshu.workflowId);
assert.deepEqual(sanitized.nodes[0]?.socialContent, {
  platform: "xiaohongshu",
  contentType: "brief",
  workflowId: xiaohongshu.workflowId,
  status: "draft"
});

const updatedRequirement = applySocialPlanToRequirementNode(
  sanitized.nodes[0] as never,
  completedXiaohongshu,
  1
);
assert.equal(updatedRequirement?.requirement?.revision, 2);
assert.equal(updatedRequirement?.requirement?.socialPlan?.planHash, completedXiaohongshu.planHash);
assert.equal(applySocialPlanToRequirementNode(sanitized.nodes[0] as never, completedXiaohongshu, 2), undefined, "stale writeback must be rejected");

const runtimeRoot = mkdtempSync(path.join(tmpdir(), "naimage-social-runtime-"));
const agentRuntime = createAgentRuntime({
  projectRoot: path.resolve(import.meta.dirname, ".."),
  configDir: path.join(runtimeRoot, "config")
});
try {
  const workflowSchema = agentRuntime.getToolSchemas({}).find((tool) => tool.function?.name === "workflow");
  assert.ok(workflowSchema?.function?.parameters?.properties?.operation?.enum?.includes("update_social_content"));
  const imageSchema = agentRuntime.getToolSchemas({}).find((tool) => tool.function?.name === "image_gen");
  assert.ok(imageSchema?.function?.parameters?.properties?.socialContentType);
  assert.ok(imageSchema?.function?.parameters?.properties?.socialSlot);
  const writeback = await agentRuntime.runTool("workflow", {
    operation: "update_social_content",
    socialPlan: completedXiaohongshu
  }, {
    nodes: sanitized.nodes,
    selectedNodeId: "SOCIAL-REQ",
    selectedNodeIds: ["SOCIAL-REQ"],
    taskScope: {
      version: 2,
      origin: "requirement",
      scopeType: "none",
      canvasRevision: 1,
      sourceNodeIds: [],
      sourceContainerIds: [],
      referenceContainerIds: [],
      sourceBindingIds: [],
      referenceBindingIds: [],
      sourceAssets: [],
      referenceAssets: [],
      resultPolicy: "single",
      confirmationPolicy: "auto",
      requirement: { nodeId: "SOCIAL-REQ", revision: 1 }
    }
  });
  assert.equal(writeback.actions[0]?.type, "workflow.node.social.update");
  assert.equal(writeback.actions[0]?.id, "SOCIAL-REQ");
  assert.equal(writeback.actions[0]?.expectedRequirementRevision, 1);
  assert.match(String(writeback.envelope.visibleOutput), /等待客户端原子提交/);
  assert.deepEqual(socialContentForImageTask(
    { requirement: { nodeId: "SOCIAL-REQ", revision: 1 } },
    sanitized.nodes,
    { socialContentType: "card", socialSlot: "card-set" },
    xiaohongshu.cardCount
  ), {
    platform: "xiaohongshu",
    contentType: "card",
    workflowId: xiaohongshu.workflowId,
    slot: "card-set",
    status: "generated"
  });
  assert.throws(
    () => socialContentForImageTask(
      { requirement: { nodeId: "SOCIAL-REQ", revision: 1 } },
      sanitized.nodes,
      { socialContentType: "card", socialSlot: "card-set" },
      2
    ),
    /9 张 card-set/
  );
  await assert.rejects(
    agentRuntime.runTool("workflow", {
      operation: "update_social_content",
      socialPlan: { ...completedXiaohongshu, workflowId: "social-workflow-00000000000000000000000000000000" }
    }, {
      nodes: sanitized.nodes,
      selectedNodeId: "SOCIAL-REQ",
      taskScope: { origin: "requirement", requirement: { nodeId: "SOCIAL-REQ", revision: 1 } }
    }),
    /workflowId/
  );
} finally {
  agentRuntime.dispose();
  rmSync(runtimeRoot, { recursive: true, force: true });
}

assert.deepEqual(defaultSettings.workflowOnboarding, {});
assert.deepEqual(normalizeWorkflowOnboardingState({ social: true, douyin: false, unknown: true }), { social: true });
assert.deepEqual(mergeSettings({ workflowOnboarding: { social: true, xiaohongshu: true, douyin: "yes" } as never }).workflowOnboarding, {
  social: true,
  xiaohongshu: true
});

const socialManifest = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.social-content");
assert.ok(socialManifest);
assert.deepEqual(socialManifest.contributes.commands.map((command) => command.id), [
  "sparkai.social-content.new-xiaohongshu",
  "sparkai.social-content.new-douyin",
  "sparkai.social-content.open-recent",
  "sparkai.social-content.open-templates",
  "sparkai.social-content.open-publish-export"
]);
assert.equal(socialManifest.contributes.toolbar.length, 5);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 55 })}\n`);
