"use strict";

const schema = require("../plugins/scientific-figure-schema.json");

const SCIENTIFIC_FIGURE_SCHEMA_VERSION = schema.schemaVersion;
const SCIENTIFIC_FIGURE_MARKER = "[NAIMAGE_SCIENTIFIC_FIGURE_V1]";
const SCIENTIFIC_FIGURE_START_COMMAND = "sparkai.scientific-figure.start-workflow";
const SCIENTIFIC_FIGURE_IMPORT_COMMAND = "sparkai.scientific-figure.import-data";
const SCIENTIFIC_FIGURE_CHART_COMMAND = "sparkai.scientific-figure.new-chart";
const SCIENTIFIC_FIGURE_PANEL_COMMAND = "sparkai.scientific-figure.new-panel";
const SCIENTIFIC_FIGURE_SCHEMATIC_COMMAND = "sparkai.scientific-figure.new-schematic";
const SCIENTIFIC_FIGURE_RERENDER_COMMAND = "sparkai.scientific-figure.rerender";
const SCIENTIFIC_FIGURE_EXPORT_COMMAND = "sparkai.scientific-figure.export";

const backendIds = new Set(schema.backends.map((item) => item.id));
const figureTypeIds = new Set(schema.figureTypes.map((item) => item.id));
const archetypeIds = new Set(schema.archetypes.map((item) => item.id));
const chartTypeIds = new Set(schema.chartTypes.map((item) => item.id));
const outputFormatIds = new Set(schema.outputFormats);
const stylePresetIds = new Set(schema.stylePresets.map((item) => item.id));

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

function cleanFileLabel(value, maximum = 180) {
  return cleanText(value, 2_000).replace(/\\/g, "/").split("/").pop().slice(0, maximum);
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

function stableScientificMaterialHash(value) {
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
  for (const candidate of Array.isArray(value) ? value : []) {
    const text = cleanText(candidate, maximumLength);
    const key = text.toLocaleLowerCase();
    if (!text || used.has(key)) continue;
    used.add(key);
    result.push(text);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function normalizeScientificDataSource(value) {
  const source = record(value);
  const id = cleanText(source.id || source.dataId, 80).toLowerCase();
  const contentHash = cleanText(source.contentHash, 64).toLowerCase();
  if (!/^scientific-data-[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(contentHash)) return null;
  return {
    id,
    sourceName: cleanFileLabel(source.sourceName || source.name),
    contentHash,
    size: Math.max(0, Math.floor(Number(source.size) || 0)),
    rowCount: Math.max(0, Math.floor(Number(source.rowCount) || 0)),
    columnCount: Math.max(0, Math.floor(Number(source.columnCount) || 0)),
    fields: cleanStringList(source.fields, schema.limits.maxFieldsPerSource, schema.limits.maxFieldLength),
    delimiter: source.delimiter === "\t" ? "\t" : ","
  };
}

function defaultPanel(index) {
  return {
    id: `panel-${String.fromCharCode(97 + Math.min(25, index))}${index >= 26 ? `-${index + 1}` : ""}`,
    label: String.fromCharCode(97 + Math.min(25, index)),
    title: `Panel ${String.fromCharCode(65 + Math.min(25, index))}`,
    chartType: schema.defaults.chartType,
    sourceBindings: [],
    description: "",
    xField: "",
    yFields: [],
    groupField: "",
    status: "planned"
  };
}

function normalizePanel(index, value, dataSourceIds) {
  const source = record(value);
  const fallback = defaultPanel(index);
  const requestedId = cleanText(source.id, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const sourceBindings = cleanStringList(source.sourceBindings, schema.limits.maxDataSources, 80)
    .map((item) => item.toLowerCase())
    .filter((item) => dataSourceIds.has(item));
  return {
    id: requestedId || fallback.id,
    label: cleanText(source.label, 12) || fallback.label,
    title: cleanText(source.title, schema.limits.maxPanelTitleLength) || fallback.title,
    chartType: chartTypeIds.has(source.chartType) ? source.chartType : fallback.chartType,
    sourceBindings,
    description: cleanText(source.description, schema.limits.maxTextLength),
    xField: cleanText(source.xField, schema.limits.maxFieldLength),
    yFields: cleanStringList(source.yFields, schema.limits.maxYFields, schema.limits.maxFieldLength),
    groupField: cleanText(source.groupField, schema.limits.maxFieldLength),
    status: source.status === "rendered" || source.status === "failed" ? source.status : "planned"
  };
}

function materialForIdentity(plan) {
  return {
    ...plan,
    workflowId: undefined,
    planHash: undefined,
    taskId: undefined,
    status: undefined,
    panels: plan.panels.map((panel) => ({ ...panel, status: undefined }))
  };
}

function withIdentity(plan, suppliedWorkflowId) {
  const digest = stableScientificMaterialHash(canonicalJson(materialForIdentity(plan)));
  const requested = cleanText(suppliedWorkflowId, 96).toLowerCase();
  return {
    ...plan,
    workflowId: /^scientific-workflow-[a-f0-9]{32}$/.test(requested) ? requested : `scientific-workflow-${digest}`,
    planHash: `scientific-${digest}`
  };
}

function normalizeScientificFigurePlan(value = {}) {
  const source = record(value);
  const dataSources = [];
  const usedDataIds = new Set();
  for (const candidate of Array.isArray(source.dataSources) ? source.dataSources : []) {
    const dataSource = normalizeScientificDataSource(candidate);
    if (!dataSource || usedDataIds.has(dataSource.id)) continue;
    usedDataIds.add(dataSource.id);
    dataSources.push(dataSource);
    if (dataSources.length >= schema.limits.maxDataSources) break;
  }
  const rawPanels = Array.isArray(source.panels) && source.panels.length ? source.panels : [{}];
  const panels = rawPanels.slice(0, schema.limits.maxPanels).map((panel, index) => normalizePanel(index, panel, usedDataIds));
  const usedPanelIds = new Set();
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    if (!usedPanelIds.has(panel.id)) {
      usedPanelIds.add(panel.id);
      continue;
    }
    panel.id = `panel-${index + 1}`;
    usedPanelIds.add(panel.id);
  }
  const outputFormats = cleanStringList(source.outputFormats, schema.outputFormats.length, 12)
    .map((item) => item.toLowerCase())
    .filter((item) => outputFormatIds.has(item));
  const plan = {
    schemaVersion: SCIENTIFIC_FIGURE_SCHEMA_VERSION,
    backend: backendIds.has(source.backend) ? source.backend : null,
    figureType: figureTypeIds.has(source.figureType) ? source.figureType : schema.defaults.figureType,
    archetype: archetypeIds.has(source.archetype) ? source.archetype : schema.defaults.archetype,
    researchClaim: cleanText(source.researchClaim, schema.limits.maxResearchClaimLength),
    targetJournal: cleanText(source.targetJournal, 240) || schema.defaults.targetJournal,
    dimensions: {
      widthMm: boundedInteger(record(source.dimensions).widthMm, 40, 500, schema.defaults.widthMm),
      heightMm: boundedInteger(record(source.dimensions).heightMm, 40, 500, schema.defaults.heightMm),
      dpi: boundedInteger(record(source.dimensions).dpi, 150, 1200, schema.defaults.dpi)
    },
    dataSources,
    panels,
    outputFormats: outputFormats.length ? outputFormats : [...schema.defaults.outputFormats],
    stylePreset: stylePresetIds.has(source.stylePreset) ? source.stylePreset : schema.defaults.stylePreset,
    evidenceHierarchy: {
      heroEvidence: cleanText(record(source.evidenceHierarchy).heroEvidence, schema.limits.maxTextLength),
      validationEvidence: cleanText(record(source.evidenceHierarchy).validationEvidence, schema.limits.maxTextLength),
      controlsRobustness: cleanText(record(source.evidenceHierarchy).controlsRobustness, schema.limits.maxTextLength)
    },
    statisticsNotes: cleanText(source.statisticsNotes, schema.limits.maxTextLength),
    sourceDataNotes: cleanText(source.sourceDataNotes, schema.limits.maxTextLength),
    imageIntegrityNotes: cleanText(source.imageIntegrityNotes, schema.limits.maxTextLength),
    reviewerRisks: cleanStringList(source.reviewerRisks, schema.limits.maxReviewerRisks, schema.limits.maxTextLength),
    placeholderData: source.placeholderData === true,
    status: source.status === "rendered" || source.status === "failed" ? source.status : "planned",
    taskId: /^scientific-task-[a-f0-9]{32}$/.test(cleanText(source.taskId, 80).toLowerCase())
      ? cleanText(source.taskId, 80).toLowerCase()
      : ""
  };
  return withIdentity(plan, source.workflowId);
}

function scientificFigurePlanIssues(value, options = {}) {
  const plan = normalizeScientificFigurePlan(value);
  const issues = [];
  if (!plan.researchClaim) issues.push("缺少需要图件支撑的一句话研究结论");
  if (!plan.backend) issues.push("尚未选择 Python 或 R 后端");
  if (!plan.panels.length) issues.push("至少需要一个 Panel");
  const quantitative = plan.figureType === "statistical-chart" || plan.figureType === "multi-panel";
  if (quantitative && !plan.dataSources.length && !plan.placeholderData) issues.push("定量图表缺少受管数据源");
  if (quantitative && plan.placeholderData && options.forRender === true) issues.push("占位数据计划只能生成模板，不能渲染成真实科研结果");
  if (quantitative) {
    for (const panel of plan.panels) {
      if (!panel.sourceBindings.length && !plan.placeholderData) issues.push(`${panel.label || panel.id} 缺少数据源绑定`);
      if (["scatter", "line", "bar", "box", "violin"].includes(panel.chartType) && (!panel.xField || !panel.yFields.length)) {
        issues.push(`${panel.label || panel.id} 缺少 x/y 字段`);
      }
      if (panel.chartType === "histogram" && !panel.xField) issues.push(`${panel.label || panel.id} 缺少数值字段`);
      if (panel.chartType === "heatmap" && panel.yFields.length < 2) issues.push(`${panel.label || panel.id} 的热图至少需要两个数值字段`);
    }
  }
  if (options.forRender === true && !quantitative) issues.push("示意图、流程图和图片比较应由 Agent 受控工作流生成，不交给数据 Runner");
  return [...new Set(issues)];
}

function composeScientificFigureTask(payload = {}) {
  const plan = normalizeScientificFigurePlan(payload.plan);
  const issues = scientificFigurePlanIssues(plan, { forRender: false });
  if (issues.includes("缺少需要图件支撑的一句话研究结论")) throw new Error("请先填写这张科研图需要支撑的核心结论。");
  if (issues.includes("尚未选择 Python 或 R 后端") && !["schematic", "workflow", "image-comparison"].includes(plan.figureType)) {
    throw new Error("请先明确选择 Python 或 R；同一科研任务不会混用后端。");
  }
  const visibleType = schema.figureTypes.find((item) => item.id === plan.figureType)?.label || "科研图";
  return {
    plan,
    planHash: plan.planHash,
    workflowId: plan.workflowId,
    visibleContent: `规划${visibleType}：${plan.researchClaim}`,
    prompt: [
      SCIENTIFIC_FIGURE_MARKER,
      `WORKFLOW_ID: ${plan.workflowId}`,
      `PLAN_HASH: ${plan.planHash}`,
      `核心结论：${plan.researchClaim}`,
      `图件原型：${plan.archetype}`,
      `后端：${plan.backend || "仅示意图路线，尚未选择代码后端"}`,
      "这是当前 Requirement 中的结构化科研计划。不得创建第二套画布、计划节点或数据库。",
      "不得虚构实验数据、样本量、误差、显著性、机制、文献结论或方法参数。缺少真实数据时只能交付明确标记的模板或非定量示意图。",
      "如果是定量图表，绘制、预览、导出和视觉 QA 必须全程只使用计划中的同一个 Python/R 后端；缺少运行时或依赖时明确失败，不得切换后端。",
      "先核对结论、证据层级、Panel 映射、统计说明、source-data、图像完整性与审稿风险，再执行或建议修改。",
      "SCIENTIFIC_PLAN_JSON:",
      JSON.stringify(plan)
    ].join("\n")
  };
}

module.exports = {
  SCIENTIFIC_FIGURE_CHART_COMMAND,
  SCIENTIFIC_FIGURE_EXPORT_COMMAND,
  SCIENTIFIC_FIGURE_IMPORT_COMMAND,
  SCIENTIFIC_FIGURE_MARKER,
  SCIENTIFIC_FIGURE_PANEL_COMMAND,
  SCIENTIFIC_FIGURE_RERENDER_COMMAND,
  SCIENTIFIC_FIGURE_SCHEMA_VERSION,
  SCIENTIFIC_FIGURE_SCHEMATIC_COMMAND,
  SCIENTIFIC_FIGURE_START_COMMAND,
  composeScientificFigureTask,
  normalizeScientificDataSource,
  normalizeScientificFigurePlan,
  scientificFigurePlanIssues,
  stableScientificMaterialHash
};
