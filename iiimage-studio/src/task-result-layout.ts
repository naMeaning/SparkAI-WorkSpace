import {
  cloneImageCollection,
  cloneImageContainerSpec,
  stableImageOccurrenceId,
} from "./core.ts";
import type {
  AgentTaskScope,
  ImageCollection,
  WorkflowNode,
} from "./core.ts";
import {
  applyImageContainerCompatibility,
  deriveImageLayoutGroupsFromContainerSpecs,
  imageContainerSpecForNode,
  planTaskResultLayout,
  synchronizeImageContainerSpecs,
} from "./image-container.ts";
import type { TaskResultLayoutPlan } from "./image-container.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";

export type TaskResultLayoutMutation = {
  plan: TaskResultLayoutPlan;
  applied: boolean;
  resultNodeIds: string[];
  partitionHostNodeIds: string[];
  containerGroupNodeId?: string;
  removedContainerGroupNodeIds?: string[];
  nodes?: WorkflowNode[];
  groups?: ImageLayoutGroup[];
  warning?: string;
  error?: string;
  eventSummary?: string;
};

type TaskResultLayoutMutationInput = {
  nodes: WorkflowNode[];
  groups: ImageLayoutGroup[];
  taskScope: AgentTaskScope;
  resultNodeIds: string[];
  allocateNodeId: (nodes: WorkflowNode[]) => string;
  createdAt: string;
  nextZOrder: number;
  containerWidth: number;
  containerHeight: number;
};

type TaskResultWaitInput = {
  existingNodeIds: ReadonlySet<string>;
  taskScope: AgentTaskScope;
  nodes: () => readonly WorkflowNode[];
  active: () => boolean;
};

export async function waitForTaskResultNodeIds(input: TaskResultWaitInput): Promise<string[] | null> {
  let result: string[] = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (!input.active()) return null;
    const matches = input.nodes().filter((node) => (
      !input.existingNodeIds.has(node.id) &&
      node.type === "image" &&
      node.taskProvenance?.taskScopeSnapshotHash === input.taskScope.snapshotHash
    ));
    result = matches.map((node) => node.id);
    if (!matches.some((node) => node.imageState === "generating") && (result.length || attempt >= 2)) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 24));
  }
  return input.active() ? result : null;
}

const warningForPlan = (plan: TaskResultLayoutPlan): string => {
  if (plan.ok || plan.reason === "not-grouped" || plan.reason === "no-results") return "";
  if (plan.reason === "scope-truncated") {
    return "本轮素材范围超过安全快照上限，成果已保留但未自动归组。请拆成更小批次后继续。";
  }
  if (plan.reason === "missing-provenance") {
    return `本轮有 ${plan.missingResultNodeIds.length} 个成果缺少可靠来源标记。为避免错图，已保留图片但没有强行归组。`;
  }
  if (plan.reason === "missing-source-results") {
    return `本轮仍有 ${plan.missingSourceKeys.length} 个原图没有可验证的对应成果。已有成果已保留，请只重试缺失来源。`;
  }
  return "";
};

const resultCollection = (node: WorkflowNode): ImageCollection => cloneImageCollection(node.imageCollection) ?? ({
  id: `task-result-${node.id}`,
  kind: "batch",
  generationMode: "parallel",
  items: (node.assets ?? []).slice(0, 10).map((asset, assetIndex) => ({
    id: `item-${assetIndex + 1}`,
    requestIndex: assetIndex + 1,
    assetIndex: assetIndex + 1,
    assetId: asset.assetId,
    occurrenceId: asset.occurrenceId || stableImageOccurrenceId(asset, node.id, assetIndex),
    prompt: asset.prompt || asset.revisedPrompt || node.prompt,
    title: asset.title,
    status: "done" as const,
  })),
  sourceNodeId: node.taskProvenance?.sourceNodeId,
  createdAt: new Date().toISOString(),
  autoFit: true,
});

export function buildTaskResultLayoutMutation(input: TaskResultLayoutMutationInput): TaskResultLayoutMutation {
  const accumulationMode = input.taskScope.confirmationPolicy === "preview-3" || input.taskScope.confirmationPolicy === "staged";
  const effectiveResultNodeIds = accumulationMode
    ? input.nodes.filter((node) => (
        node.type === "image" && !node.layerGroup && node.imageState !== "error" &&
        (node.assets?.length ?? 0) > 0 && node.taskProvenance?.taskScopeSnapshotHash === input.taskScope.snapshotHash
      )).map((node) => node.id)
    : input.resultNodeIds;
  const plan = planTaskResultLayout(input.nodes, effectiveResultNodeIds, input.taskScope);
  const base: TaskResultLayoutMutation = {
    plan,
    applied: false,
    resultNodeIds: [...plan.orderedNodeIds],
    partitionHostNodeIds: [],
    warning: warningForPlan(plan) || undefined,
  };
  if (!plan.ok || !plan.partitions.length) return base;

  try {
    const resultIds = new Set(plan.orderedNodeIds);
    const taskImportBatchId = `task-${input.taskScope.snapshotHash.slice(-16)}`;
    const removedContainerGroupNodeIds = accumulationMode
      ? input.nodes.filter((node) => {
          const spec = imageContainerSpecForNode(node);
          return spec?.kind === "container-group" && spec.importBatchId === taskImportBatchId;
        }).map((node) => node.id)
      : [];
    const removedGroupIds = new Set(removedContainerGroupNodeIds);
    let nodes: WorkflowNode[] = input.nodes.filter((node) => !removedGroupIds.has(node.id)).map((node): WorkflowNode => ({
      ...node,
      assets: node.assets?.map((asset) => ({ ...asset })),
      imageCollection: cloneImageCollection(node.imageCollection),
      imageContainerSpec: cloneImageContainerSpec(node.imageContainerSpec),
      taskProvenance: node.taskProvenance ? { ...node.taskProvenance } : undefined,
    }));
    const groups: ImageLayoutGroup[] = input.groups
      .filter((group) => !removedGroupIds.has(group.hostNodeId) && !group.memberNodeIds.some((nodeId) => resultIds.has(nodeId) || removedGroupIds.has(nodeId)))
      .map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
    const usedLayoutIds = new Set(groups.map((group) => group.id));
    const partitionHostNodeIds: string[] = [];

    for (const [partitionIndex, partition] of plan.partitions.entries()) {
      const memberNodeIds = [...new Set(partition.nodeIds)].filter((nodeId) => resultIds.has(nodeId));
      const hostNodeId = memberNodeIds[0] || "";
      const host = nodes.find((node) => node.id === hostNodeId && node.type === "image" && !node.layerGroup);
      if (!host || !(host.assets?.length)) throw new Error(`成果分区 ${partition.key} 缺少可用宿主节点。`);
      const collection = resultCollection(host);
      const currentSpec = imageContainerSpecForNode(host);
      const sourceLabel = partition.sourceDisplayCode
        ? `${partition.sourceDisplayCode} 的成果`
        : input.taskScope.resultPolicy === "grouped-by-container"
          ? `来源容器 ${partitionIndex + 1} 的成果`
          : `来源 ${partitionIndex + 1} 的成果`;
      nodes = nodes.map((node) => node.id === host.id
        ? applyImageContainerCompatibility({
            ...node,
            imageCollection: collection,
            imageContainerSpec: {
              version: 1,
              kind: "batch-result",
              memberNodeIds: [],
              childContainerNodeIds: [],
              memberBindings: [],
              sourceLabel,
              layoutId: currentSpec?.layoutId,
              layoutOrigin: "generation",
              autoFit: true,
              collection,
            },
          })
        : node
      );
      partitionHostNodeIds.push(host.id);
      if (memberNodeIds.length > 1) {
        const baseId = `task-result-layout-${host.id}`;
        let layoutId = baseId;
        let suffix = 2;
        while (usedLayoutIds.has(layoutId)) layoutId = `${baseId}-${suffix++}`;
        usedLayoutIds.add(layoutId);
        groups.push({ id: layoutId, hostNodeId: host.id, memberNodeIds, origin: "generation", autoFit: true });
      }
    }

    nodes = synchronizeImageContainerSpecs(nodes, groups);
    let finalGroups = deriveImageLayoutGroupsFromContainerSpecs(nodes);
    let containerGroupNodeId = "";
    if (input.taskScope.resultPolicy === "grouped-by-container" && partitionHostNodeIds.length > 1) {
      const firstHost = nodes.find((node) => node.id === partitionHostNodeIds[0]);
      containerGroupNodeId = input.allocateNodeId(nodes);
      nodes.push({
        id: containerGroupNodeId,
        displayCode: containerGroupNodeId,
        title: "批量成果",
        prompt: "按原始文件夹或来源容器保持边界的批量图片成果。",
        type: "image",
        status: "done",
        x: firstHost?.x ?? 180,
        y: firstHost?.y ?? 160,
        branch: "image-container-group",
        outputs: 0,
        createdAt: input.createdAt,
        assets: [],
        imageState: "empty",
        imageContainer: true,
        imageContainerSpec: {
          version: 1,
          kind: "container-group",
          memberNodeIds: [],
          childContainerNodeIds: [...partitionHostNodeIds],
          memberBindings: [],
          sourceLabel: "本轮批量成果",
          importBatchId: taskImportBatchId,
          layoutOrigin: "generation",
          autoFit: true,
        },
        width: input.containerWidth,
        height: input.containerHeight,
        zOrder: input.nextZOrder,
      });
      finalGroups = deriveImageLayoutGroupsFromContainerSpecs(nodes);
      nodes = synchronizeImageContainerSpecs(nodes, finalGroups);
      finalGroups = deriveImageLayoutGroupsFromContainerSpecs(nodes);
    }

    return {
      ...base,
      applied: true,
      partitionHostNodeIds,
      containerGroupNodeId: containerGroupNodeId || undefined,
      removedContainerGroupNodeIds,
      nodes,
      groups: finalGroups,
      warning: undefined,
      eventSummary: input.taskScope.resultPolicy === "grouped-by-container"
        ? `按 ${plan.partitions.length} 个来源容器归组 ${plan.orderedNodeIds.length} 个成果`
        : `按 ${plan.partitions.length} 个来源归组 ${plan.orderedNodeIds.length} 个成果`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      error: message,
      warning: `成果图片已经保留，但自动归组未完全完成：${message}`,
    };
  }
}
