"use strict";

const schema = require("../plugins/social-content-schema.json");

const SOCIAL_CONTENT_SCHEMA_VERSION = schema.schemaVersion;
const SOCIAL_XIAOHONGSHU_COMMAND = "sparkai.social-content.new-xiaohongshu";
const SOCIAL_DOUYIN_COMMAND = "sparkai.social-content.new-douyin";
const SOCIAL_CONTENT_MARKER = "[NAIMAGE_SOCIAL_CONTENT_V1]";

const contentKindIds = new Set(schema.xiaohongshu.contentKinds.map((item) => item.id));
const douyinFormatIds = new Set(schema.douyin.formats.map((item) => item.id));
const xiaohongshuRatios = new Set(schema.xiaohongshu.ratios);
const douyinDurations = new Set(schema.douyin.durations);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, maximum) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableMaterialHash(value) {
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

function cleanStringList(value, maximumItems, maximumLength) {
  const result = [];
  const used = new Set();
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

function normalizeStatus(value) {
  return ["draft", "approved", "generated", "exported"].includes(value) ? value : "draft";
}

function normalizeSocialContentMetadata(value, fallback = {}) {
  const source = { ...record(fallback), ...record(value) };
  const platform = source.platform === "douyin" ? "douyin" : source.platform === "xiaohongshu" ? "xiaohongshu" : "";
  const contentTypes = new Set(["brief", "title", "post", "cover", "card", "script", "shot", "video", "publish-package"]);
  const contentType = contentTypes.has(source.contentType) ? source.contentType : "";
  const workflowId = cleanText(source.workflowId, 96).toLowerCase();
  const slot = cleanText(source.slot, 80);
  const variant = Number(source.variant);
  if (!platform || !contentType || !/^social-workflow-[a-f0-9]{32}$/.test(workflowId)) return null;
  return {
    platform,
    contentType,
    workflowId,
    ...(slot ? { slot } : {}),
    ...(Number.isInteger(variant) && variant >= 0 && variant < 100 ? { variant } : {}),
    status: normalizeStatus(source.status)
  };
}

function xiaohongshuCard(index, value) {
  const source = record(value);
  return {
    id: `card-${index + 1}`,
    order: index + 1,
    title: cleanText(source.title, schema.limits.maxTitleLength) || `第 ${index + 1} 页`,
    copy: cleanText(source.copy, 1200),
    prompt: cleanText(source.prompt, schema.limits.maxPromptLength),
    status: normalizeStatus(source.status)
  };
}

function douyinShot(index, value) {
  const source = record(value);
  return {
    id: `shot-${index + 1}`,
    order: index + 1,
    durationSeconds: boundedInteger(source.durationSeconds, 1, 60, 5),
    narration: cleanText(source.narration, 1200),
    visual: cleanText(source.visual, 1200),
    prompt: cleanText(source.prompt, schema.limits.maxPromptLength),
    status: normalizeStatus(source.status)
  };
}

function withIdentity(plan, suppliedWorkflowId) {
  const material = { ...plan };
  delete material.planHash;
  delete material.workflowId;
  const digest = stableMaterialHash(canonicalJson(material));
  const workflowId = /^social-workflow-[a-f0-9]{32}$/.test(cleanText(suppliedWorkflowId, 96).toLowerCase())
    ? cleanText(suppliedWorkflowId, 96).toLowerCase()
    : `social-workflow-${digest}`;
  return { ...plan, workflowId, planHash: `social-${digest}` };
}

function normalizeXiaohongshuPlan(value = {}) {
  const source = record(value);
  const cardCount = boundedInteger(
    source.cardCount ?? (Array.isArray(source.cards) ? source.cards.length : undefined),
    schema.limits.minXiaohongshuCards,
    schema.limits.maxXiaohongshuCards,
    schema.xiaohongshu.defaultCardCount
  );
  const ratio = xiaohongshuRatios.has(source.ratio) ? source.ratio : schema.xiaohongshu.defaultRatio;
  const plan = {
    schemaVersion: SOCIAL_CONTENT_SCHEMA_VERSION,
    platform: "xiaohongshu",
    contentKind: contentKindIds.has(source.contentKind) ? source.contentKind : schema.xiaohongshu.defaultContentKind,
    brief: cleanText(source.brief, schema.limits.maxBriefLength),
    audience: cleanText(source.audience, schema.limits.maxAudienceLength),
    objective: cleanText(source.objective, schema.limits.maxObjectiveLength),
    language: cleanText(source.language, 80) || "跟随用户",
    ratio,
    cardCount,
    titleCandidateCount: boundedInteger(source.titleCandidateCount, 1, schema.limits.maxTitleCandidates, schema.xiaohongshu.defaultTitleCandidateCount),
    titleCandidates: cleanStringList(source.titleCandidates, schema.limits.maxTitleCandidates, schema.limits.maxTitleLength),
    recommendedTitle: cleanText(source.recommendedTitle, schema.limits.maxTitleLength),
    body: cleanText(source.body, schema.limits.maxBodyLength),
    tags: cleanStringList(source.tags, schema.limits.maxTags, schema.limits.maxTagLength),
    cover: {
      enabled: source.cover?.enabled === undefined ? schema.xiaohongshu.defaultCoverEnabled : source.cover.enabled !== false,
      title: cleanText(source.cover?.title, schema.limits.maxTitleLength),
      prompt: cleanText(source.cover?.prompt, schema.limits.maxPromptLength),
      status: normalizeStatus(source.cover?.status)
    },
    cards: Array.from({ length: cardCount }, (_, index) => xiaohongshuCard(index, Array.isArray(source.cards) ? source.cards[index] : undefined)),
    status: normalizeStatus(source.status)
  };
  return withIdentity(plan, source.workflowId);
}

function normalizeDouyinPlan(value = {}) {
  const source = record(value);
  const shotCount = boundedInteger(
    source.shotCount ?? (Array.isArray(source.shots) ? source.shots.length : undefined),
    schema.limits.minDouyinShots,
    schema.limits.maxDouyinShots,
    schema.douyin.defaultShotCount
  );
  const durationSeconds = douyinDurations.has(Number(source.durationSeconds)) ? Number(source.durationSeconds) : schema.douyin.defaultDuration;
  const plan = {
    schemaVersion: SOCIAL_CONTENT_SCHEMA_VERSION,
    platform: "douyin",
    format: douyinFormatIds.has(source.format) ? source.format : schema.douyin.defaultFormat,
    brief: cleanText(source.brief, schema.limits.maxBriefLength),
    audience: cleanText(source.audience, schema.limits.maxAudienceLength),
    objective: cleanText(source.objective, schema.limits.maxObjectiveLength),
    language: cleanText(source.language, 80) || "跟随用户",
    ratio: schema.douyin.defaultRatio,
    durationSeconds,
    subtitlesEnabled: source.subtitlesEnabled === undefined ? schema.douyin.defaultSubtitlesEnabled : source.subtitlesEnabled !== false,
    shotCount,
    hooks: cleanStringList(source.hooks, 3, 240),
    title: cleanText(source.title, schema.limits.maxTitleLength),
    script: cleanText(source.script, schema.limits.maxBodyLength),
    subtitleText: cleanText(source.subtitleText, schema.limits.maxBodyLength),
    tags: cleanStringList(source.tags, schema.limits.maxTags, schema.limits.maxTagLength),
    shots: Array.from({ length: shotCount }, (_, index) => douyinShot(index, Array.isArray(source.shots) ? source.shots[index] : undefined)),
    cover: {
      title: cleanText(source.cover?.title, schema.limits.maxTitleLength),
      prompt: cleanText(source.cover?.prompt, schema.limits.maxPromptLength),
      status: normalizeStatus(source.cover?.status)
    },
    videoTaskId: cleanText(source.videoTaskId, 180),
    videoNodeId: cleanText(source.videoNodeId, 160),
    status: normalizeStatus(source.status)
  };
  return withIdentity(plan, source.workflowId);
}

function normalizeSocialContentPlan(value = {}) {
  return record(value).platform === "douyin" ? normalizeDouyinPlan(value) : normalizeXiaohongshuPlan(value);
}

function mergeSocialContentWriteback(currentValue, proposedValue = {}) {
  const current = normalizeSocialContentPlan(currentValue);
  const proposed = record(proposedValue);
  if (proposed.platform && proposed.platform !== current.platform) {
    throw new Error("社媒结构化回写不能改变当前工作流平台。");
  }
  if (proposed.workflowId && cleanText(proposed.workflowId, 96).toLowerCase() !== current.workflowId) {
    throw new Error("社媒结构化回写的 workflowId 与当前 Requirement 不一致。");
  }
  if (current.platform === "xiaohongshu") {
    const proposedCover = record(proposed.cover);
    const proposedCards = Array.isArray(proposed.cards) ? proposed.cards : [];
    return normalizeXiaohongshuPlan({
      ...current,
      ...proposed,
      schemaVersion: SOCIAL_CONTENT_SCHEMA_VERSION,
      platform: "xiaohongshu",
      workflowId: current.workflowId,
      contentKind: current.contentKind,
      brief: current.brief,
      audience: current.audience || proposed.audience,
      objective: current.objective || proposed.objective,
      language: current.language,
      ratio: current.ratio,
      cardCount: current.cardCount,
      titleCandidateCount: current.titleCandidateCount,
      cover: {
        ...current.cover,
        ...proposedCover,
        enabled: current.cover.enabled
      },
      cards: Array.from({ length: current.cardCount }, (_, index) => ({
        ...current.cards[index],
        ...record(proposedCards[index])
      }))
    });
  }
  const proposedCover = record(proposed.cover);
  const proposedShots = Array.isArray(proposed.shots) ? proposed.shots : [];
  return normalizeDouyinPlan({
    ...current,
    ...proposed,
    schemaVersion: SOCIAL_CONTENT_SCHEMA_VERSION,
    platform: "douyin",
    workflowId: current.workflowId,
    format: current.format,
    brief: current.brief,
    audience: current.audience || proposed.audience,
    objective: current.objective || proposed.objective,
    language: current.language,
    ratio: current.ratio,
    durationSeconds: current.durationSeconds,
    subtitlesEnabled: current.subtitlesEnabled,
    shotCount: current.shotCount,
    cover: { ...current.cover, ...proposedCover },
    shots: Array.from({ length: current.shotCount }, (_, index) => ({
      ...current.shots[index],
      ...record(proposedShots[index])
    })),
    videoTaskId: current.videoTaskId,
    videoNodeId: current.videoNodeId
  });
}

function socialContentWritebackIssues(planValue) {
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

function composeSocialContentTask(payload = {}) {
  const plan = payload.command === SOCIAL_DOUYIN_COMMAND || record(payload.plan).platform === "douyin"
    ? normalizeDouyinPlan(payload.plan)
    : normalizeXiaohongshuPlan(payload.plan);
  if (!plan.brief) throw new Error("请先填写这次社媒内容主要介绍什么。");
  const common = [
    SOCIAL_CONTENT_MARKER,
    `WORKFLOW_ID: ${plan.workflowId}`,
    `PLAN_HASH: ${plan.planHash}`,
    "这是已有 Requirement 中的结构化社媒计划。不要创建计划节点、Prompt 节点或第二套工作流。",
    "先使用当前 TaskScope 的 SOURCE/REFERENCE；只有真正缺少方向性信息时才调用 ask_user，并且一次只问一个维度。",
    "文案必须可直接发布，不虚构产品功效、价格、认证、体验或数据。图片必须使用 image_gen，并作为该 Requirement 的衍生成果。"
  ];
  if (plan.platform === "xiaohongshu") {
    return {
      plan,
      planHash: plan.planHash,
      workflowId: plan.workflowId,
      visibleContent: `制作小红书图文：${plan.brief}`,
      prompt: [...common,
        `平台：小红书；类型：${plan.contentKind}；画幅：${plan.ratio}；卡片：${plan.cardCount} 页；标题候选：${plan.titleCandidateCount} 个。`,
        "完成 Brief、标题候选、推荐标题、正文、标签、封面和有序图文卡片。封面与每页卡片文字要短、可读、互不重复。",
        "完成文案后必须调用 workflow(operation=update_social_content) 把完整结构化 plan 写回当前 Requirement；随后生成封面和卡片。封面单独调用 image_gen 并填写 socialContentType=cover、socialSlot=cover；全部卡片可在一次批量调用中填写 socialContentType=card、socialSlot=card-set、count=卡片数和逐页 items。存在 SOURCE 时使用 variants，否则使用 generate。",
        "SOCIAL_PLAN_JSON:",
        JSON.stringify(plan)
      ].join("\n")
    };
  }
  return {
    plan,
    planHash: plan.planHash,
    workflowId: plan.workflowId,
    visibleContent: `制作抖音短视频：${plan.brief}`,
    prompt: [...common,
      `平台：抖音；形式：${plan.format}；时长：${plan.durationSeconds} 秒；画幅：9:16；分镜：${plan.shotCount} 个；字幕：${plan.subtitlesEnabled ? "开启" : "关闭"}。`,
      "完成 3 个开场 Hook、口播文案、分镜表、字幕文本、封面、发布标题和标签。",
      "完成文案后必须调用 workflow(operation=update_social_content) 把完整结构化 plan 写回当前 Requirement；封面单独调用 image_gen 并填写 socialContentType=cover、socialSlot=cover；全部分镜素材可在一次批量调用中填写 socialContentType=shot、socialSlot=shot-set、count=分镜数和逐镜 items。存在 SOURCE 时使用 variants，否则使用 generate。最终视频只通过现有独立视频任务创建/轮询/恢复，创建结果不明时绝不重发。",
      "SOCIAL_PLAN_JSON:",
      JSON.stringify(plan)
    ].join("\n")
  };
}

module.exports = {
  SOCIAL_CONTENT_MARKER,
  SOCIAL_CONTENT_SCHEMA_VERSION,
  SOCIAL_DOUYIN_COMMAND,
  SOCIAL_XIAOHONGSHU_COMMAND,
  composeSocialContentTask,
  mergeSocialContentWriteback,
  normalizeDouyinPlan,
  normalizeSocialContentMetadata,
  normalizeSocialContentPlan,
  normalizeXiaohongshuPlan,
  socialContentWritebackIssues,
  stableMaterialHash
};
