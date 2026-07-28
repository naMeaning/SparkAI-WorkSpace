import type { WorkflowNode } from "./core";

export type CanvasClipboardPayload = {
  version: 1;
  copiedAt: number;
  nodes: WorkflowNode[];
};

export type CanvasClipboardPasteResult = {
  nodes: WorkflowNode[];
  pastedNodes: WorkflowNode[];
  pastedNodeIds: string[];
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const uniqueIds = (values: Iterable<string>) => [...new Set([...values].map((value) => String(value || "").trim()).filter(Boolean))];

export function copyCanvasNodes(nodes: readonly WorkflowNode[], selectedIds: readonly string[]): CanvasClipboardPayload | null {
  const selected = new Set(uniqueIds(selectedIds));
  const copied = nodes.filter((node) => selected.has(node.id)).map((node) => deepClone(node));
  if (!copied.length) return null;
  return { version: 1, copiedAt: Date.now(), nodes: copied };
}

export function canvasClipboardSummary(payload: CanvasClipboardPayload | null) {
  if (!payload?.nodes.length) return "";
  const labels = payload.nodes.slice(0, 4).map((node) => node.title?.trim() || node.id);
  return `naimage 画布：已复制 ${payload.nodes.length} 个成果${labels.length ? `（${labels.join("、")}${payload.nodes.length > labels.length ? "…" : ""}）` : ""}`;
}

export function pasteCanvasNodes(
  payload: CanvasClipboardPayload,
  existingNodes: readonly WorkflowNode[],
  allocateNodeId: (nodes: WorkflowNode[]) => string,
  anchor?: { x: number; y: number },
  offset = 36,
): CanvasClipboardPasteResult {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.nodes) || !payload.nodes.length) {
    return { nodes: [...existingNodes], pastedNodes: [], pastedNodeIds: [] };
  }

  const sourceNodes = payload.nodes.map((node) => deepClone(node));
  const selectedSourceIds = new Set(sourceNodes.map((node) => node.id));
  const sourceMinX = Math.min(...sourceNodes.map((node) => Number(node.x) || 0));
  const sourceMinY = Math.min(...sourceNodes.map((node) => Number(node.y) || 0));
  const working = existingNodes.map((node) => deepClone(node));
  const idMap = new Map<string, string>();
  for (const node of sourceNodes) {
    const nextId = allocateNodeId(working);
    idMap.set(node.id, nextId);
    working.push({ ...node, id: nextId });
  }

  const layerGroupIdMap = new Map<string, string>();
  const pastedNodes = sourceNodes.map((source, sourceIndex): WorkflowNode => {
    const nextId = idMap.get(source.id)!;
    const next = deepClone(source);
    next.id = nextId;
    next.displayCode = nextId;
    next.x = Math.round((anchor ? anchor.x + (Number(source.x) - sourceMinX) : Number(source.x) + offset));
    next.y = Math.round((anchor ? anchor.y + (Number(source.y) - sourceMinY) : Number(source.y) + offset));
    next.parentId = source.parentId && idMap.has(source.parentId) ? idMap.get(source.parentId) : undefined;
    next.relationType = next.parentId ? source.relationType : undefined;
    next.agentConversationId = undefined;
    next.generationRunId = undefined;
    next.createdAt = new Date().toISOString();
    if (next.status === "working") next.status = (next.assets?.length ?? 0) > 0 ? "done" : "review";
    if (next.imageState === "generating") next.imageState = (next.assets?.length ?? 0) > 0 ? "done" : "empty";
    if (next.imageProgress) next.imageProgress = { ...next.imageProgress, stopped: undefined, activeIndex: undefined, message: "复制的画布成果" };
    next.assets = next.assets?.map((asset, assetIndex) => ({
      ...asset,
      occurrenceId: `copy-${nextId}-${assetIndex + 1}-${payload.copiedAt}`,
      displayCode: `${nextId}${assetIndex + 1}`,
      runId: undefined,
    }));

    if (next.requirement) {
      const inputBindings = (next.requirement.inputBindings ?? [])
        .filter((binding) => selectedSourceIds.has(binding.nodeId))
        .map((binding) => ({ ...binding, nodeId: idMap.get(binding.nodeId)! }));
      next.requirement = {
        ...next.requirement,
        inputBindings,
        lastSourceSignature: undefined,
        lastRunAt: undefined,
        lastRunCount: undefined,
        lastError: undefined,
      };
      next.parentId = inputBindings[0]?.nodeId;
      next.relationType = inputBindings.length ? "referenced" : undefined;
    }

    if (next.imageContainerSpec) {
      next.imageContainerSpec = {
        ...next.imageContainerSpec,
        memberNodeIds: next.imageContainerSpec.memberNodeIds.flatMap((id) => idMap.has(id) ? [idMap.get(id)!] : []),
        childContainerNodeIds: next.imageContainerSpec.childContainerNodeIds.flatMap((id) => idMap.has(id) ? [idMap.get(id)!] : []),
        memberBindings: next.imageContainerSpec.memberBindings.map((binding, bindingIndex) => ({
          ...binding,
          bindingId: `copy-${nextId}-${bindingIndex + 1}`,
          nodeId: idMap.get(binding.nodeId) || nextId,
          containerNodeId: idMap.get(binding.containerNodeId) || nextId,
          occurrenceId: next.assets?.[Math.max(0, Number(binding.assetIndex || 1) - 1)]?.occurrenceId || binding.occurrenceId,
        })),
        layoutId: undefined,
      };
    }

    if (next.layerGroup) {
      const groupMembers = sourceNodes.filter((node) => node.layerGroup?.id === next.layerGroup?.id);
      const completeGroup = groupMembers.length === next.layerGroup.total;
      if (!completeGroup) {
        next.layerGroup = undefined;
      } else {
        const sourceGroupId = next.layerGroup.id;
        if (!layerGroupIdMap.has(sourceGroupId)) layerGroupIdMap.set(sourceGroupId, `copy-${nextId}-${sourceIndex + 1}`);
        next.layerGroup = {
          ...next.layerGroup,
          id: layerGroupIdMap.get(sourceGroupId)!,
          toolRunId: undefined,
          sourceParentId: next.layerGroup.sourceParentId && idMap.has(next.layerGroup.sourceParentId)
            ? idMap.get(next.layerGroup.sourceParentId)
            : undefined,
          mergedAsset: undefined,
        };
      }
    }

    if (next.layerComposition) {
      next.layerComposition = {
        ...next.layerComposition,
        id: `copy-${nextId}`,
        layers: next.layerComposition.layers.map((layer, layerIndex) => ({
          ...layer,
          id: `copy-${nextId}-layer-${layerIndex + 1}`,
          groupId: `copy-${nextId}`,
          sourceNodeId: layer.sourceNodeId && idMap.has(layer.sourceNodeId) ? idMap.get(layer.sourceNodeId) : undefined,
        })),
      };
    }
    return next;
  });

  return {
    nodes: [...existingNodes.map((node) => deepClone(node)), ...pastedNodes],
    pastedNodes,
    pastedNodeIds: pastedNodes.map((node) => node.id),
  };
}
