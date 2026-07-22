import type { WorkflowNode } from "./core";
import type { ImageLayoutGroup } from "./image-layout";

export type CanvasSelectionExclusionReason = "layer" | "unsupported" | "empty" | "busy";

export type CanvasSelectionExclusion = {
  nodeId: string;
  reason: CanvasSelectionExclusionReason;
};

export type CanvasSelectionCapabilities = {
  layerVisibleCount: number;
  groupableNodeIds: string[];
  groupExcluded: CanvasSelectionExclusion[];
  deleteNodeIds: string[];
  deleteExcluded: CanvasSelectionExclusion[];
  selectedLayoutGroupIds: string[];
  selectedLayerGroupIds: string[];
  layerGroupRepresentativeIds: string[];
  preferredContainerHostId: string;
  canGroupIntoContainer: boolean;
  canDelete: boolean;
};

const uniqueIds = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const isLayerNode = (node: WorkflowNode): boolean => Boolean(node.layerGroup || node.layerComposition);

const isBusyNode = (node: WorkflowNode): boolean =>
  node.status === "working" || node.imageState === "generating";

const groupExclusionReason = (
  node: WorkflowNode,
  layoutGroup?: ImageLayoutGroup,
): CanvasSelectionExclusionReason | "" => {
  if (isLayerNode(node)) return "layer";
  if (node.type !== "image") return "unsupported";
  if ((node.assets?.length ?? 0) > 0 || node.imageContainer || node.imageCollection || layoutGroup) return "";
  return "empty";
};

export function analyzeCanvasSelection(
  nodes: readonly WorkflowNode[],
  layoutGroups: readonly ImageLayoutGroup[],
  selectedIds: readonly string[],
  primaryId = "",
): CanvasSelectionCapabilities {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layoutByHost = new Map(layoutGroups.map((group) => [group.hostNodeId, group]));
  const layoutByMember = new Map<string, ImageLayoutGroup>();
  for (const group of layoutGroups) {
    for (const nodeId of group.memberNodeIds) layoutByMember.set(nodeId, group);
  }

  const visibleIds = uniqueIds(selectedIds).filter((id) => nodeById.has(id) || layoutByHost.has(id));
  const expandedNodeIds = uniqueIds(visibleIds.flatMap((id) => {
    const group = layoutByHost.get(id) ?? layoutByMember.get(id);
    return group ? group.memberNodeIds : [id];
  })).filter((id) => nodeById.has(id));

  const selectedLayoutGroupIds = uniqueIds(visibleIds
    .map((id) => layoutByHost.get(id) ?? layoutByMember.get(id))
    .filter((group): group is ImageLayoutGroup => Boolean(group))
    .map((group) => group.id));

  const groupableNodeIds: string[] = [];
  const groupExcluded: CanvasSelectionExclusion[] = [];
  const deleteNodeIds: string[] = [];
  const deleteExcluded: CanvasSelectionExclusion[] = [];
  const selectedLayerGroupIds: string[] = [];
  const layerRepresentativeByGroup = new Map<string, WorkflowNode>();

  for (const nodeId of expandedNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const layoutGroup = layoutByMember.get(nodeId);
    const exclusion = groupExclusionReason(node, layoutGroup);
    if (exclusion) groupExcluded.push({ nodeId, reason: exclusion });
    else groupableNodeIds.push(nodeId);

    if (isBusyNode(node)) deleteExcluded.push({ nodeId, reason: "busy" });
    else deleteNodeIds.push(nodeId);

    const layerGroupId = String(node.layerGroup?.id || "").trim();
    if (layerGroupId) {
      selectedLayerGroupIds.push(layerGroupId);
      const current = layerRepresentativeByGroup.get(layerGroupId);
      if (!current || Number(node.layerGroup?.order || 0) > Number(current.layerGroup?.order || 0)) {
        layerRepresentativeByGroup.set(layerGroupId, node);
      }
    }
  }

  let layerVisibleCount = 0;
  for (const nodeId of visibleIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    if (isLayerNode(node)) layerVisibleCount += 1;
  }

  const selectedGroupById = new Map(
    selectedLayoutGroupIds
      .map((id) => layoutGroups.find((group) => group.id === id))
      .filter((group): group is ImageLayoutGroup => Boolean(group))
      .map((group) => [group.id, group]),
  );
  const primaryGroup = layoutByHost.get(primaryId) ?? layoutByMember.get(primaryId);
  const primaryNodeId = primaryGroup?.hostNodeId || primaryId;
  const preferredContainerHostId = groupableNodeIds.includes(primaryNodeId)
    ? primaryNodeId
    : [...selectedGroupById.values()].find((group) => groupableNodeIds.includes(group.hostNodeId))?.hostNodeId
      || groupableNodeIds[0]
      || "";

  const existingSingleGroup = selectedLayoutGroupIds.length === 1
    ? selectedGroupById.get(selectedLayoutGroupIds[0])
    : undefined;
  const sameAsExistingGroup = Boolean(
    existingSingleGroup &&
    groupableNodeIds.length === existingSingleGroup.memberNodeIds.length &&
    existingSingleGroup.memberNodeIds.every((id) => groupableNodeIds.includes(id)) &&
    existingSingleGroup.hostNodeId === preferredContainerHostId,
  );

  return {
    layerVisibleCount,
    groupableNodeIds,
    groupExcluded,
    deleteNodeIds,
    deleteExcluded,
    selectedLayoutGroupIds,
    selectedLayerGroupIds: uniqueIds(selectedLayerGroupIds),
    layerGroupRepresentativeIds: [...layerRepresentativeByGroup.values()].map((node) => node.id),
    preferredContainerHostId,
    canGroupIntoContainer: groupableNodeIds.length >= 2 && !sameAsExistingGroup,
    canDelete: deleteNodeIds.length > 0,
  };
}
