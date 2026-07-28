import type { ProjectGraphDocument } from "../core.ts";

export const MAX_PROJECT_GRAPH_PROMPT_NODES = 600;
export const MAX_PROJECT_GRAPH_PROMPT_EDGES = 1_200;

function cleanText(value: unknown, maximum: number) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

export function projectGraphPromptPayload(graph: ProjectGraphDocument) {
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
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];
    return [{
      sourceId,
      targetId,
      label: cleanText(edge.label, 300),
      directed: edge.directed !== false,
      kind: cleanText(edge.kind, 60)
    }];
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

export function projectGraphVisualizationPrompt(graph: ProjectGraphDocument) {
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
    payload.promptTruncated
      ? "- GRAPH 已截断，只能使用所给内容。"
      : "- GRAPH 完整。",
    "GRAPH：",
    JSON.stringify(payload)
  ].join("\n");
}
