"use strict";

const {
  COMMERCE_GENERATE_SET_COMMAND,
  COMMERCE_TRANSLATION_COMMAND,
  composeCommerceSetTask,
  normalizeCommerceSetPlan
} = require("../runtime/commerce-set-plan.cjs");
const {
  SOCIAL_DOUYIN_COMMAND,
  SOCIAL_XIAOHONGSHU_COMMAND,
  composeSocialContentTask
} = require("../runtime/social-content-plan.cjs");
const PROJECT_GRAPH_VISUALIZATION_COMMAND = "sparkai.project-graph.visualize-learning-map";
const {
  SCIENTIFIC_FIGURE_START_COMMAND: SCIENTIFIC_FIGURE_COMMAND,
  composeScientificFigureTask
} = require("../runtime/scientific-figure-plan.cjs");
const commerceSetSchema = require("../plugins/commerce-set-schema.json");
const MAX_COMMERCE_TARGET_LANGUAGES = commerceSetSchema.limits.maxTargetLanguages;
const MAX_PROJECT_GRAPH_PROMPT_NODES = 600;
const MAX_PROJECT_GRAPH_PROMPT_EDGES = 1_200;

const commerceLanguages = commerceSetSchema.languages.map((language) => [language.code, language.label, language.nativeLabel]);
const commerceLanguageByCode = new Map(commerceLanguages.map((language) => [language[0], language]));

function normalizeCommerceLanguageCodes(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter((code) => commerceLanguageByCode.has(code)))].slice(0, MAX_COMMERCE_TARGET_LANGUAGES);
}

function withCommerceGoalRuntimeContract(task) {
  const planHash = cleanText(task?.planHash, 48);
  const mode = task?.plan?.mode === "translate" ? "translate" : "generate";
  const outputsPerSource = Math.max(1, Math.floor(Number(task?.counts?.outputsPerSource) || 1));
  const firstSlot = task?.plan?.slots?.[0];
  const firstLocale = task?.plan?.targetLocales?.[0];
  const itemContract = outputsPerSource === 1
    ? mode === "translate"
      ? `本计划每个 SOURCE 只输出一张：省略 items，并在顶层设置 slotId=translation、slotIndex=0、localeCode=${cleanText(firstLocale?.code, 32)}。`
      : `本计划每个 SOURCE 只输出一张：省略 items，并在顶层设置 slotId=${cleanText(firstSlot?.id, 80) || "image-1"}、slotIndex=0、localeCode=${cleanText(firstLocale?.code, 32) || "source-language"}。`
    : mode === "translate"
      ? "items 按 targetLocales 顺序排列；每项设置 slotId=translation、slotIndex=0、localeCode=对应语言代码。"
      : "items 按 targetLocales（没有目标语言时使用 source-language）外层、slots 内层展开；每项复制准确的 slotId、零基 slotIndex 和 localeCode。";
  return {
    ...task,
    prompt: [
      task.prompt,
      "GOAL_RUNTIME_METADATA_CONTRACT:",
      `- image_gen.commercePlanHash 必须严格等于 ${planHash}，不得省略、改写或写进画面 Prompt。`,
      `- ${itemContract}`,
      "- 这些字段只用于成果溯源；每项 title/prompt 仍必须对应当前槽位与语言的真实成品。"
    ].join("\n")
  };
}

function commerceTranslationPrompt(languageCodes, sourceCount, sourceNodeIds = []) {
  return withCommerceGoalRuntimeContract(composeCommerceSetTask({
    command: COMMERCE_TRANSLATION_COMMAND,
    sourceCount,
    sourceNodeIds,
    plan: normalizeCommerceSetPlan({ mode: "translate", languageCodes })
  })).prompt;
}

function cleanText(value, maximum) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function projectGraphPromptPayload(graph) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : []).slice(0, MAX_PROJECT_GRAPH_PROMPT_NODES).map((node) => ({
    id: cleanText(node.id, 180),
    label: cleanText(node.label, 500),
    kind: cleanText(node.kind, 60),
    parentIds: (Array.isArray(node.parentIds) ? node.parentIds : []).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 24)
  })).filter((node) => node.id && node.label);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(graph?.edges) ? graph.edges : []).slice(0, MAX_PROJECT_GRAPH_PROMPT_EDGES).flatMap((edge) => {
    const sourceId = cleanText(edge.sourceId, 180);
    const targetId = cleanText(edge.targetId, 180);
    return nodeIds.has(sourceId) && nodeIds.has(targetId) ? [{
      sourceId,
      targetId,
      label: cleanText(edge.label, 300),
      directed: edge.directed !== false,
      kind: cleanText(edge.kind, 60)
    }] : [];
  });
  return {
    title: cleanText(graph?.title, 160) || "Project Graph",
    sourceName: cleanText(graph?.sourceName, 180),
    rootIds: (Array.isArray(graph?.rootIds) ? graph.rootIds : []).map((item) => cleanText(item, 180)).filter((item) => nodeIds.has(item)).slice(0, 100),
    nodes,
    edges,
    sourceStats: graph?.stats,
    promptTruncated: graph.nodes.length > nodes.length || graph.edges.length > edges.length,
    warnings: (Array.isArray(graph?.warnings) ? graph.warnings : []).map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 20)
  };
}

function projectGraphVisualizationPrompt(graph) {
  const payload = projectGraphPromptPayload(graph);
  if (!payload.nodes.length) throw new Error("Project Graph 中没有可用于生成图片的概念节点。");
  return [
    "GRAPH 是本轮唯一的知识结构 SOURCE。只读导入；不要修改原 .prg 文件或项目 session。",
    "目标：把概念关系具体化为准确、易记的学习图片，不要照抄导图布局。规则：",
    "- 识别根主题、分支及先后/因果/包含/对比关系；不得虚构 GRAPH 未提供的内容。",
    "- 节点少时生成 1 张总览；节点多时按主题拆成 2–6 张独立学习图，每张讲清一个中心结论。",
    "- 每张图单独调用一次 image_gen（generate）；提示词写明主题、概念、关系、视觉隐喻、构图、必要文字和禁止项。",
    "- 采用适合关系的场景、过程、剖面、对比或时间线，不要都画成节点连线图。",
    "- 保留名称、方向和层级；文字简短可读，不确定的关系省略或标明。每张结果独立成组，最后列出覆盖范围。",
    payload.promptTruncated ? "- GRAPH 已截断，只能使用所给内容。" : "- GRAPH 完整。",
    "GRAPH：",
    JSON.stringify(payload)
  ].join("\n");
}

function projectGraphTask(graph) {
  const title = cleanText(graph?.title || graph?.sourceName, 160) || "Project Graph";
  return {
    prompt: projectGraphVisualizationPrompt(graph),
    visibleContent: `把思维导图「${title}」转成视觉学习图片（${Number(graph?.stats?.nodeCount) || 0} 个概念，${Number(graph?.stats?.edgeCount) || 0} 条关系）`
  };
}

function composePluginTask(payload) {
  if (payload?.command === COMMERCE_GENERATE_SET_COMMAND || payload?.command === COMMERCE_TRANSLATION_COMMAND) {
    return withCommerceGoalRuntimeContract(composeCommerceSetTask({
      ...payload,
      plan: payload.plan ?? (payload.command === COMMERCE_TRANSLATION_COMMAND
        ? { mode: "translate", languageCodes: payload.languageCodes }
        : { mode: "generate" })
    }));
  }
  if (payload?.command === SOCIAL_XIAOHONGSHU_COMMAND || payload?.command === SOCIAL_DOUYIN_COMMAND) {
    return composeSocialContentTask(payload);
  }
  if (payload?.command === SCIENTIFIC_FIGURE_COMMAND) {
    return composeScientificFigureTask(payload);
  }
  throw new Error("不支持的插件任务。");
}

module.exports = {
  COMMERCE_GENERATE_SET_COMMAND,
  COMMERCE_TRANSLATION_COMMAND,
  PROJECT_GRAPH_VISUALIZATION_COMMAND,
  SCIENTIFIC_FIGURE_COMMAND,
  SOCIAL_DOUYIN_COMMAND,
  SOCIAL_XIAOHONGSHU_COMMAND,
  commerceLanguages,
  composeCommerceSetTask,
  commerceTranslationPrompt,
  composePluginTask,
  normalizeCommerceSetPlan,
  normalizeCommerceLanguageCodes,
  projectGraphPromptPayload,
  projectGraphTask,
  projectGraphVisualizationPrompt
};
