import socialContentSchema from "../../plugins/social-content-schema.json" with { type: "json" };
import type {
  DouyinSocialPlan,
  SocialContentMetadata,
  SocialContentPlan,
  SocialContentStatus,
  WorkflowNode,
  XiaohongshuSocialPlan
} from "../core";

type SocialContentSchema = typeof socialContentSchema;
const schema = socialContentSchema as SocialContentSchema;

export const SOCIAL_CONTENT_SCHEMA_VERSION = schema.schemaVersion;
export const SOCIAL_XIAOHONGSHU_COMMAND = "sparkai.social-content.new-xiaohongshu";
export const SOCIAL_DOUYIN_COMMAND = "sparkai.social-content.new-douyin";
export const SOCIAL_RECENT_COMMAND = "sparkai.social-content.open-recent";
export const SOCIAL_TEMPLATE_COMMAND = "sparkai.social-content.open-templates";
export const SOCIAL_EXPORT_COMMAND = "sparkai.social-content.open-publish-export";
export const SOCIAL_CONTENT_KINDS = schema.xiaohongshu.contentKinds.map((item) => ({ ...item }));
export const SOCIAL_DOUYIN_FORMATS = schema.douyin.formats.map((item) => ({ ...item }));
export const SOCIAL_XIAOHONGSHU_RATIOS = [...schema.xiaohongshu.ratios];
export const SOCIAL_DOUYIN_DURATIONS = [...schema.douyin.durations];
export const SOCIAL_CONTENT_LIMITS = Object.freeze({ ...schema.limits });

const contentKindIds = new Set(SOCIAL_CONTENT_KINDS.map((item) => item.id));
const douyinFormatIds = new Set(SOCIAL_DOUYIN_FORMATS.map((item) => item.id));
const xiaohongshuRatios = new Set<string>(SOCIAL_XIAOHONGSHU_RATIOS);
const douyinDurations = new Set<number>(SOCIAL_DOUYIN_DURATIONS);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maximum);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

function cleanStringList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  const result: string[] = [];
  const used = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const text = cleanText(item, maximumLength);
    const key = text.toLocaleLowerCase();
    if (!text || used.has(key)) continue;
    used.add(key);
    result.push(text);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function normalizeStatus(value: unknown): SocialContentStatus {
  return value === "approved" || value === "generated" || value === "exported" ? value : "draft";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableSocialMaterialHash(value: string): string {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ (code + index), 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ (code + hashes[0]), 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ (code + hashes[1]), 668265263);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

function withIdentity<T extends Record<string, unknown>>(plan: T, suppliedWorkflowId: unknown): T & { workflowId: string; planHash: string } {
  const material = { ...plan };
  delete material.planHash;
  delete material.workflowId;
  const digest = stableSocialMaterialHash(canonicalJson(material));
  const requested = cleanText(suppliedWorkflowId, 96).toLowerCase();
  return {
    ...plan,
    workflowId: /^social-workflow-[a-f0-9]{32}$/.test(requested) ? requested : `social-workflow-${digest}`,
    planHash: `social-${digest}`
  };
}

export function normalizeSocialContentMetadata(value: unknown): SocialContentMetadata | undefined {
  const source = record(value);
  const platform = source.platform === "douyin" ? "douyin" : source.platform === "xiaohongshu" ? "xiaohongshu" : undefined;
  const validContentTypes = new Set(["brief", "title", "post", "cover", "card", "script", "shot", "video", "publish-package"]);
  const contentType = validContentTypes.has(String(source.contentType)) ? source.contentType as SocialContentMetadata["contentType"] : undefined;
  const workflowId = cleanText(source.workflowId, 96).toLowerCase();
  const slot = cleanText(source.slot, 80);
  const variant = Number(source.variant);
  if (!platform || !contentType || !/^social-workflow-[a-f0-9]{32}$/.test(workflowId)) return undefined;
  return {
    platform,
    contentType,
    workflowId,
    ...(slot ? { slot } : {}),
    ...(Number.isInteger(variant) && variant >= 0 && variant < 100 ? { variant } : {}),
    status: normalizeStatus(source.status)
  };
}

export function normalizeXiaohongshuPlan(value: unknown = {}): XiaohongshuSocialPlan {
  const source = record(value);
  const cards = Array.isArray(source.cards) ? source.cards : [];
  const cardCount = boundedInteger(
    source.cardCount ?? (Array.isArray(source.cards) ? cards.length : undefined),
    schema.limits.minXiaohongshuCards,
    schema.limits.maxXiaohongshuCards,
    schema.xiaohongshu.defaultCardCount
  );
  const plan = {
    schemaVersion: SOCIAL_CONTENT_SCHEMA_VERSION as 1,
    platform: "xiaohongshu" as const,
    contentKind: contentKindIds.has(String(source.contentKind)) ? String(source.contentKind) as XiaohongshuSocialPlan["contentKind"] : schema.xiaohongshu.defaultContentKind,
    brief: cleanText(source.brief, schema.limits.maxBriefLength),
    audience: cleanText(source.audience, schema.limits.maxAudienceLength),
    objective: cleanText(source.objective, schema.limits.maxObjectiveLength),
    language: cleanText(source.language, 80) || "跟随用户",
    ratio: xiaohongshuRatios.has(String(source.ratio)) ? String(source.ratio) as XiaohongshuSocialPlan["ratio"] : schema.xiaohongshu.defaultRatio,
    cardCount,
    titleCandidateCount: boundedInteger(source.titleCandidateCount, 1, schema.limits.maxTitleCandidates, schema.xiaohongshu.defaultTitleCandidateCount),
    titleCandidates: cleanStringList(source.titleCandidates, schema.limits.maxTitleCandidates, schema.limits.maxTitleLength),
    recommendedTitle: cleanText(source.recommendedTitle, schema.limits.maxTitleLength),
    body: cleanText(source.body, schema.limits.maxBodyLength),
    tags: cleanStringList(source.tags, schema.limits.maxTags, schema.limits.maxTagLength),
    cover: {
      enabled: record(source.cover).enabled === undefined ? schema.xiaohongshu.defaultCoverEnabled : record(source.cover).enabled !== false,
      title: cleanText(record(source.cover).title, schema.limits.maxTitleLength),
      prompt: cleanText(record(source.cover).prompt, schema.limits.maxPromptLength),
      status: normalizeStatus(record(source.cover).status)
    },
    cards: Array.from({ length: cardCount }, (_, index) => {
      const card = record(cards[index]);
      return {
        id: `card-${index + 1}`,
        order: index + 1,
        title: cleanText(card.title, schema.limits.maxTitleLength) || `第 ${index + 1} 页`,
        copy: cleanText(card.copy, 1200),
        prompt: cleanText(card.prompt, schema.limits.maxPromptLength),
        status: normalizeStatus(card.status)
      };
    }),
    status: normalizeStatus(source.status)
  };
  return withIdentity(plan, source.workflowId) as XiaohongshuSocialPlan;
}

export function normalizeDouyinPlan(value: unknown = {}): DouyinSocialPlan {
  const source = record(value);
  const shots = Array.isArray(source.shots) ? source.shots : [];
  const shotCount = boundedInteger(
    source.shotCount ?? (Array.isArray(source.shots) ? shots.length : undefined),
    schema.limits.minDouyinShots,
    schema.limits.maxDouyinShots,
    schema.douyin.defaultShotCount
  );
  const cover = record(source.cover);
  const duration = Number(source.durationSeconds);
  const plan = {
    schemaVersion: SOCIAL_CONTENT_SCHEMA_VERSION as 1,
    platform: "douyin" as const,
    format: douyinFormatIds.has(String(source.format)) ? String(source.format) as DouyinSocialPlan["format"] : schema.douyin.defaultFormat,
    brief: cleanText(source.brief, schema.limits.maxBriefLength),
    audience: cleanText(source.audience, schema.limits.maxAudienceLength),
    objective: cleanText(source.objective, schema.limits.maxObjectiveLength),
    language: cleanText(source.language, 80) || "跟随用户",
    ratio: "9:16" as const,
    durationSeconds: douyinDurations.has(duration) ? duration as 15 | 30 | 60 : schema.douyin.defaultDuration,
    subtitlesEnabled: source.subtitlesEnabled === undefined ? schema.douyin.defaultSubtitlesEnabled : source.subtitlesEnabled !== false,
    shotCount,
    hooks: cleanStringList(source.hooks, 3, 240),
    title: cleanText(source.title, schema.limits.maxTitleLength),
    script: cleanText(source.script, schema.limits.maxBodyLength),
    subtitleText: cleanText(source.subtitleText, schema.limits.maxBodyLength),
    tags: cleanStringList(source.tags, schema.limits.maxTags, schema.limits.maxTagLength),
    shots: Array.from({ length: shotCount }, (_, index) => {
      const shot = record(shots[index]);
      return {
        id: `shot-${index + 1}`,
        order: index + 1,
        durationSeconds: boundedInteger(shot.durationSeconds, 1, 60, 5),
        narration: cleanText(shot.narration, 1200),
        visual: cleanText(shot.visual, 1200),
        prompt: cleanText(shot.prompt, schema.limits.maxPromptLength),
        status: normalizeStatus(shot.status)
      };
    }),
    cover: {
      title: cleanText(cover.title, schema.limits.maxTitleLength),
      prompt: cleanText(cover.prompt, schema.limits.maxPromptLength),
      status: normalizeStatus(cover.status)
    },
    videoTaskId: cleanText(source.videoTaskId, 180),
    videoNodeId: cleanText(source.videoNodeId, 160),
    status: normalizeStatus(source.status)
  };
  return withIdentity(plan, source.workflowId) as DouyinSocialPlan;
}

export function normalizeSocialContentPlan(value: unknown = {}): SocialContentPlan {
  return record(value).platform === "douyin" ? normalizeDouyinPlan(value) : normalizeXiaohongshuPlan(value);
}

export function socialContentWritebackIssues(planValue: unknown): string[] {
  const plan = normalizeSocialContentPlan(planValue);
  if (plan.platform === "xiaohongshu") {
    return [
      plan.titleCandidates.length < plan.titleCandidateCount ? `至少需要 ${plan.titleCandidateCount} 个标题候选` : "",
      !plan.recommendedTitle ? "缺少推荐标题" : "",
      !plan.body ? "缺少正文" : "",
      !plan.tags.length ? "缺少标签" : "",
      plan.cover.enabled && (!plan.cover.title || !plan.cover.prompt) ? "封面缺少标题或画面 Prompt" : "",
      plan.cards.some((card) => !card.copy || !card.prompt) ? "图文卡片缺少文案或画面 Prompt" : ""
    ].filter(Boolean);
  }
  return [
    plan.hooks.length < 3 ? "至少需要 3 个开场 Hook" : "",
    !plan.title ? "缺少发布标题" : "",
    !plan.script ? "缺少口播文案" : "",
    plan.subtitlesEnabled && !plan.subtitleText ? "已开启字幕但缺少字幕文本" : "",
    !plan.tags.length ? "缺少标签" : "",
    !plan.cover.title || !plan.cover.prompt ? "封面缺少标题或画面 Prompt" : "",
    plan.shots.some((shot) => !shot.narration || !shot.visual || !shot.prompt) ? "分镜缺少旁白、画面说明或素材 Prompt" : ""
  ].filter(Boolean);
}

export function composeDouyinVideoPrompt(planValue: unknown): string {
  const plan = normalizeDouyinPlan(planValue);
  const issues = socialContentWritebackIssues(plan);
  if (issues.length) throw new Error(`抖音视频计划尚未补齐：${issues.join("；")}。`);
  return [
    `制作一条 ${plan.durationSeconds} 秒、9:16 竖屏的抖音短视频。`,
    `主题：${plan.brief}`,
    `发布标题：${plan.title}`,
    `内容形式：${plan.format}`,
    `口播文案：${plan.script}`,
    `开场 Hook：${plan.hooks.join(" / ")}`,
    "按以下分镜顺序连续呈现，保持主体、风格、光线与产品外观一致：",
    ...plan.shots.map((shot) => `${shot.order}. ${shot.visual}；旁白：${shot.narration}`),
    "画面中不要生成不可读的长段字幕；字幕文本由发布包单独提供。"
  ].join("\n").slice(0, 20_000);
}

export function applySocialPlanToRequirementNode(
  node: WorkflowNode,
  planValue: unknown,
  expectedRequirementRevision: number
): WorkflowNode | undefined {
  if (node.type !== "requirement" || !node.requirement?.socialPlan) return undefined;
  if (node.requirement.revision !== expectedRequirementRevision) return undefined;
  const plan = normalizeSocialContentPlan(planValue);
  const current = node.requirement.socialPlan;
  if (plan.platform !== current.platform || plan.workflowId !== current.workflowId) return undefined;
  return {
    ...node,
    requirement: {
      ...node.requirement,
      version: 2,
      revision: node.requirement.revision + 1,
      socialPlan: plan,
      lastError: undefined
    },
    socialContent: {
      platform: plan.platform,
      contentType: "brief",
      workflowId: plan.workflowId,
      status: plan.status
    }
  };
}
