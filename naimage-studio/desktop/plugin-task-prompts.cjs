"use strict";

const COMMERCE_TRANSLATION_COMMAND = "sparkai.commerce-toolkit.translate-listing-set";
const PROJECT_GRAPH_VISUALIZATION_COMMAND = "sparkai.project-graph.visualize-learning-map";
const MAX_COMMERCE_TARGET_LANGUAGES = 10;
const MAX_PROJECT_GRAPH_PROMPT_NODES = 600;
const MAX_PROJECT_GRAPH_PROMPT_EDGES = 1_200;

const commerceLanguages = [
  ["en-US", "英语（美国）", "English (US)"], ["en-GB", "英语（英国）", "English (UK)"],
  ["de-DE", "德语", "Deutsch"], ["fr-FR", "法语", "Français"], ["es-ES", "西班牙语", "Español"],
  ["it-IT", "意大利语", "Italiano"], ["pt-BR", "葡萄牙语（巴西）", "Português (Brasil)"],
  ["ja-JP", "日语", "日本語"], ["ko-KR", "韩语", "한국어"], ["ar-SA", "阿拉伯语", "العربية"],
  ["ru-RU", "俄语", "Русский"], ["th-TH", "泰语", "ไทย"], ["vi-VN", "越南语", "Tiếng Việt"],
  ["id-ID", "印度尼西亚语", "Bahasa Indonesia"]
];
const commerceLanguageByCode = new Map(commerceLanguages.map((language) => [language[0], language]));

function normalizeCommerceLanguageCodes(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter((code) => commerceLanguageByCode.has(code)))].slice(0, MAX_COMMERCE_TARGET_LANGUAGES);
}

function commerceTranslationPrompt(languageCodes, sourceCount) {
  const normalized = normalizeCommerceLanguageCodes(languageCodes);
  if (!normalized.length) throw new Error("请至少选择一种目标语言。");
  const languageLines = normalized.map((code, index) => {
    const language = commerceLanguageByCode.get(code);
    return `${index + 1}. ${language[1]} / ${language[2]}（${code}）`;
  }).join("\n");
  return [
    "执行跨境电商商品套图多语言本地化。当前选中的图片成果是本轮唯一 SOURCE，不要使用会话中的其他旧图片。",
    `SOURCE：${Math.max(1, Math.floor(Number(sourceCount) || 1))} 个已选成果或容器。目标语言：\n${languageLines}`,
    "规则：",
    "- 识别真实可见文字；品牌、商标、型号、SKU、尺寸、数字、单位和法律标识默认保持原文。禁止添加原图没有的功效、认证、折扣、承诺或卖点。",
    "- 只替换文字及必要排版；保持商品身份、轮廓、颜色、材质、背景、构图、画幅、Logo 和整体设计。",
    "- 每种语言单独调用一次 image_gen，并进入自己的结果组；不同语言不得混在同一个结果组。每个 SOURCE 每种语言生成一张。",
    "- 有 SOURCE 时使用 edit 或 replace，禁止用 generate 重画商品；总并发最多 10 路。阿拉伯语使用正确的从右到左排版。",
    "- 完成后按语言列出成功/失败数量；未识别到文字时保留原图并说明。用户已勾选语言并授权执行，不要再次询问。"
  ].join("\n");
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
  if (payload?.command !== COMMERCE_TRANSLATION_COMMAND) throw new Error("不支持的插件任务。");
  const languageCodes = normalizeCommerceLanguageCodes(payload.languageCodes);
  return {
    prompt: commerceTranslationPrompt(languageCodes, payload.sourceCount),
    languageCodes,
    visibleContent: `为当前选中的商品图生成多语言套图：${languageCodes.map((code) => commerceLanguageByCode.get(code)[1]).join("、")}`
  };
}

module.exports = {
  COMMERCE_TRANSLATION_COMMAND,
  PROJECT_GRAPH_VISUALIZATION_COMMAND,
  commerceLanguages,
  commerceTranslationPrompt,
  composePluginTask,
  normalizeCommerceLanguageCodes,
  projectGraphPromptPayload,
  projectGraphTask,
  projectGraphVisualizationPrompt
};
