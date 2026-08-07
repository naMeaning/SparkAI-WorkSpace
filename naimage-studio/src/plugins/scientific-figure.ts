import scientificFigureSchema from "../../plugins/scientific-figure-schema.json" with { type: "json" };
import type {
  ScientificDataSource,
  ScientificFigurePanel,
  ScientificFigurePlan,
  WorkflowNode
} from "../core";

const schema = scientificFigureSchema;

export const SCIENTIFIC_FIGURE_SCHEMA_VERSION = schema.schemaVersion;
export const SCIENTIFIC_FIGURE_START_COMMAND = "sparkai.scientific-figure.start-workflow";
export const SCIENTIFIC_FIGURE_IMPORT_COMMAND = "sparkai.scientific-figure.import-data";
export const SCIENTIFIC_FIGURE_CHART_COMMAND = "sparkai.scientific-figure.new-chart";
export const SCIENTIFIC_FIGURE_PANEL_COMMAND = "sparkai.scientific-figure.new-panel";
export const SCIENTIFIC_FIGURE_SCHEMATIC_COMMAND = "sparkai.scientific-figure.new-schematic";
export const SCIENTIFIC_FIGURE_RERENDER_COMMAND = "sparkai.scientific-figure.rerender";
export const SCIENTIFIC_FIGURE_EXPORT_COMMAND = "sparkai.scientific-figure.export";
export const SCIENTIFIC_FIGURE_BACKENDS = schema.backends.map((item) => ({ ...item }));
export const SCIENTIFIC_FIGURE_TYPES = schema.figureTypes.map((item) => ({ ...item }));
export const SCIENTIFIC_FIGURE_ARCHETYPES = schema.archetypes.map((item) => ({ ...item }));
export const SCIENTIFIC_FIGURE_CHART_TYPES = schema.chartTypes.map((item) => ({ ...item }));
export const SCIENTIFIC_FIGURE_OUTPUT_FORMATS = [...schema.outputFormats];
export const SCIENTIFIC_FIGURE_STYLE_PRESETS = schema.stylePresets.map((item) => ({ ...item }));
export const SCIENTIFIC_FIGURE_LIMITS = Object.freeze({ ...schema.limits });

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maximum);
}

function cleanFileLabel(value: unknown, maximum = 180): string {
  return cleanText(value, 2_000).replace(/\\/g, "/").split("/").pop()!.slice(0, maximum);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

function cleanStringList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  const result: string[] = [];
  const used = new Set<string>();
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as UnknownRecord;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableScientificMaterialHash(value: string): string {
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

export function normalizeScientificDataSource(value: unknown): ScientificDataSource | undefined {
  const source = record(value);
  const id = cleanText(source.id ?? source.dataId, 80).toLowerCase();
  const contentHash = cleanText(source.contentHash, 64).toLowerCase();
  if (!/^scientific-data-[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(contentHash)) return undefined;
  return {
    id,
    sourceName: cleanFileLabel(source.sourceName ?? source.name),
    contentHash,
    size: Math.max(0, Math.floor(Number(source.size) || 0)),
    rowCount: Math.max(0, Math.floor(Number(source.rowCount) || 0)),
    columnCount: Math.max(0, Math.floor(Number(source.columnCount) || 0)),
    fields: cleanStringList(source.fields, schema.limits.maxFieldsPerSource, schema.limits.maxFieldLength),
    delimiter: source.delimiter === "\t" ? "\t" : ","
  };
}

function normalizePanel(index: number, value: unknown, dataSourceIds: Set<string>): ScientificFigurePanel {
  const source = record(value);
  const fallbackId = `panel-${String.fromCharCode(97 + Math.min(25, index))}${index >= 26 ? `-${index + 1}` : ""}`;
  const requestedId = cleanText(source.id, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    id: requestedId || fallbackId,
    label: cleanText(source.label, 12) || String.fromCharCode(97 + Math.min(25, index)),
    title: cleanText(source.title, schema.limits.maxPanelTitleLength) || `Panel ${String.fromCharCode(65 + Math.min(25, index))}`,
    chartType: schema.chartTypes.some((item) => item.id === source.chartType)
      ? source.chartType as ScientificFigurePanel["chartType"]
      : schema.defaults.chartType as ScientificFigurePanel["chartType"],
    sourceBindings: cleanStringList(source.sourceBindings, schema.limits.maxDataSources, 80)
      .map((item) => item.toLowerCase())
      .filter((item) => dataSourceIds.has(item)),
    description: cleanText(source.description, schema.limits.maxTextLength),
    xField: cleanText(source.xField, schema.limits.maxFieldLength),
    yFields: cleanStringList(source.yFields, schema.limits.maxYFields, schema.limits.maxFieldLength),
    groupField: cleanText(source.groupField, schema.limits.maxFieldLength),
    status: source.status === "rendered" || source.status === "failed" ? source.status : "planned"
  };
}

function materialForIdentity(plan: Omit<ScientificFigurePlan, "workflowId" | "planHash">): unknown {
  return {
    ...plan,
    taskId: undefined,
    status: undefined,
    panels: plan.panels.map((panel) => ({ ...panel, status: undefined }))
  };
}

export function normalizeScientificFigurePlan(value: unknown = {}): ScientificFigurePlan {
  const source = record(value);
  const dataSources: ScientificDataSource[] = [];
  const dataSourceIds = new Set<string>();
  for (const candidate of Array.isArray(source.dataSources) ? source.dataSources : []) {
    const dataSource = normalizeScientificDataSource(candidate);
    if (!dataSource || dataSourceIds.has(dataSource.id)) continue;
    dataSourceIds.add(dataSource.id);
    dataSources.push(dataSource);
    if (dataSources.length >= schema.limits.maxDataSources) break;
  }
  const rawPanels = Array.isArray(source.panels) && source.panels.length ? source.panels : [{}];
  const panels = rawPanels.slice(0, schema.limits.maxPanels).map((panel, index) => normalizePanel(index, panel, dataSourceIds));
  const usedPanelIds = new Set<string>();
  panels.forEach((panel, index) => {
    if (usedPanelIds.has(panel.id)) panel.id = `panel-${index + 1}`;
    usedPanelIds.add(panel.id);
  });
  const formats = cleanStringList(source.outputFormats, schema.outputFormats.length, 12)
    .map((item) => item.toLowerCase())
    .filter((item): item is ScientificFigurePlan["outputFormats"][number] => schema.outputFormats.includes(item as never));
  const dimensions = record(source.dimensions);
  const base = {
    schemaVersion: SCIENTIFIC_FIGURE_SCHEMA_VERSION as 1,
    backend: source.backend === "python" || source.backend === "r" ? source.backend : null,
    figureType: schema.figureTypes.some((item) => item.id === source.figureType)
      ? source.figureType as ScientificFigurePlan["figureType"]
      : schema.defaults.figureType as ScientificFigurePlan["figureType"],
    archetype: schema.archetypes.some((item) => item.id === source.archetype)
      ? source.archetype as ScientificFigurePlan["archetype"]
      : schema.defaults.archetype as ScientificFigurePlan["archetype"],
    researchClaim: cleanText(source.researchClaim, schema.limits.maxResearchClaimLength),
    targetJournal: cleanText(source.targetJournal, 240) || schema.defaults.targetJournal,
    dimensions: {
      widthMm: boundedInteger(dimensions.widthMm, 40, 500, schema.defaults.widthMm),
      heightMm: boundedInteger(dimensions.heightMm, 40, 500, schema.defaults.heightMm),
      dpi: boundedInteger(dimensions.dpi, 150, 1200, schema.defaults.dpi)
    },
    dataSources,
    panels,
    outputFormats: formats.length ? formats : [...schema.defaults.outputFormats] as ScientificFigurePlan["outputFormats"],
    stylePreset: schema.stylePresets.some((item) => item.id === source.stylePreset) ? String(source.stylePreset) : schema.defaults.stylePreset,
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
    status: source.status === "rendered" || source.status === "failed" ? source.status : "planned" as const,
    taskId: /^scientific-task-[a-f0-9]{32}$/.test(cleanText(source.taskId, 80).toLowerCase()) ? cleanText(source.taskId, 80).toLowerCase() : ""
  } satisfies Omit<ScientificFigurePlan, "workflowId" | "planHash">;
  const digest = stableScientificMaterialHash(canonicalJson(materialForIdentity(base)));
  const requestedWorkflowId = cleanText(source.workflowId, 96).toLowerCase();
  return {
    ...base,
    workflowId: /^scientific-workflow-[a-f0-9]{32}$/.test(requestedWorkflowId) ? requestedWorkflowId : `scientific-workflow-${digest}`,
    planHash: `scientific-${digest}`
  };
}

export function scientificFigurePlanIssues(value: unknown, options: { forRender?: boolean } = {}): string[] {
  const plan = normalizeScientificFigurePlan(value);
  const issues: string[] = [];
  if (!plan.researchClaim) issues.push("缺少需要图件支撑的一句话研究结论");
  if (!plan.backend) issues.push("尚未选择 Python 或 R 后端");
  const quantitative = plan.figureType === "statistical-chart" || plan.figureType === "multi-panel";
  if (quantitative && !plan.dataSources.length && !plan.placeholderData) issues.push("定量图表缺少受管数据源");
  if (quantitative && plan.placeholderData && options.forRender) issues.push("占位数据计划只能生成模板，不能渲染成真实科研结果");
  if (quantitative) {
    for (const panel of plan.panels) {
      if (!panel.sourceBindings.length && !plan.placeholderData) issues.push(`${panel.label || panel.id} 缺少数据源绑定`);
      if (["scatter", "line", "bar", "box", "violin"].includes(panel.chartType) && (!panel.xField || !panel.yFields.length)) issues.push(`${panel.label || panel.id} 缺少 x/y 字段`);
      if (panel.chartType === "histogram" && !panel.xField) issues.push(`${panel.label || panel.id} 缺少数值字段`);
      if (panel.chartType === "heatmap" && panel.yFields.length < 2) issues.push(`${panel.label || panel.id} 的热图至少需要两个数值字段`);
    }
  }
  if (options.forRender && !quantitative) issues.push("示意图、流程图和图片比较应由 Agent 受控工作流生成，不交给数据 Runner");
  return [...new Set(issues)];
}

export function applyScientificPlanToRequirementNode(
  node: WorkflowNode,
  planValue: unknown,
  expectedRequirementRevision: number
): WorkflowNode | undefined {
  if (node.type !== "requirement" || !node.requirement?.scientificPlan) return undefined;
  if (node.requirement.revision !== expectedRequirementRevision) return undefined;
  const plan = normalizeScientificFigurePlan(planValue);
  if (plan.workflowId !== node.requirement.scientificPlan.workflowId) return undefined;
  return {
    ...node,
    requirement: {
      ...node.requirement,
      version: 2,
      revision: node.requirement.revision + 1,
      scientificPlan: plan,
      lastError: undefined
    },
    scientificFigure: {
      workflowId: plan.workflowId,
      planHash: plan.planHash,
      kind: "plan",
      status: plan.status,
      backend: plan.backend ?? undefined,
      taskId: plan.taskId || undefined
    }
  };
}
