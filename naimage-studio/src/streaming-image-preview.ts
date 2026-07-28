import type { AgentProgress, WorkflowNode } from "./core";

export type StreamingImagePreview = {
  key: string;
  operationId: string;
  runId: string;
  requestIndex: number;
  dataUrl: string;
  index: number;
  total: number;
};

export function upsertStreamingImagePreviewState(
  current: Record<string, StreamingImagePreview>,
  payload: AgentProgress,
  operationId: string
): Record<string, StreamingImagePreview> {
  const partial = payload.partialImage;
  const dataUrl = String(partial?.dataUrl || "");
  const normalizedOperationId = String(operationId || "").trim();
  if (!normalizedOperationId || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) return current;
  const requestIndex = Math.max(1, Math.min(10, Math.floor(Number(partial?.requestIndex || 1) || 1)));
  const key = `${normalizedOperationId}:${requestIndex}`;
  const existing = current[key];
  return {
    ...current,
    [key]: {
      key,
      operationId: normalizedOperationId,
      runId: String(payload.runId || existing?.runId || ""),
      requestIndex,
      dataUrl,
      index: Math.max(1, Math.floor(Number(partial?.index || existing?.index || 1) || 1)),
      total: Math.max(1, Math.floor(Number(partial?.total || existing?.total || 3) || 3))
    }
  };
}

function previewMatchesGenerationRun(preview: StreamingImagePreview, generationRunId: string) {
  if (!generationRunId) return false;
  return [preview.operationId, preview.runId].some((candidate) => (
    candidate === generationRunId || candidate.startsWith(`${generationRunId}-`)
  ));
}

export function groupStreamingImagePreviewsByNode(
  previews: Record<string, StreamingImagePreview>,
  nodes: WorkflowNode[],
  toolNodeIds: Record<string, string>
): Record<string, StreamingImagePreview[]> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const grouped: Record<string, StreamingImagePreview[]> = {};
  for (const preview of Object.values(previews)) {
    const mappedId = toolNodeIds[preview.operationId] || toolNodeIds[preview.runId] || "";
    const nodeId = nodeIds.has(mappedId)
      ? mappedId
      : nodes.find((node) => previewMatchesGenerationRun(preview, String(node.generationRunId || "")))?.id || "";
    if (!nodeId) continue;
    grouped[nodeId] = [...(grouped[nodeId] || []), preview];
  }
  for (const items of Object.values(grouped)) {
    items.sort((left, right) => left.requestIndex - right.requestIndex || left.index - right.index);
  }
  return grouped;
}
