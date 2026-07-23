import {
  cloneImageCollection,
  cloneImageContainerSpec,
} from "./core.ts";
import type {
  AgentTaskScope,
  ImageCollection,
  WorkflowNode,
} from "./core.ts";
import { stableImageOccurrenceId } from "./asset-identity.ts";
import {
  applyImageContainerCompatibility,
  imageContainerSpecForNode,
} from "./image-container-spec.ts";
import {
  deriveImageLayoutGroupsFromContainerSpecs,
  synchronizeImageContainerSpecs,
} from "./image-container-graph.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";

export type TaskResultLayoutPartition = {
  key: string;
  sourceContainerId?: string;
  sourceDisplayCode?: string;
  nodeIds: string[];
};

export type TaskResultLayoutPlan = {
  ok: boolean;
  needed: boolean;
  reason: "not-grouped" | "no-results" | "scope-truncated" | "missing-provenance" | "missing-source-results" | "ready-partial" | "ready";
  orderedNodeIds: string[];
  partitions: TaskResultLayoutPartition[];
  missingResultNodeIds: string[];
  missingSourceKeys: string[];
};

const cleanText = (value: unknown, maximum: number): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maximum) : undefined;
};

const uniqueNodeIds = (values: readonly unknown[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = typeof value === "string" ? value.trim().slice(0, 160) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const taskAssetBindingKey = (asset: AgentTaskScope["sourceAssets"][number]): string => (
  cleanText(asset.bindingId, 520) ||
  cleanText(asset.occurrenceId, 80) ||
  cleanText(asset.assetId, 160) ||
  `${cleanText(asset.nodeId, 160) || "source"}:${Number.isInteger(asset.assetIndex) ? asset.assetIndex : 0}`
);

/**
 * Plans deterministic presentation for the image nodes produced by one frozen
 * TaskScope. The plan is intentionally pure: the renderer owns the visual
 * container mutation, while this function proves that every expected SOURCE
 * or source-container has at least one matching persisted result.
 */
export function planTaskResultLayout(
  nodes: readonly WorkflowNode[],
  newNodeIds: readonly string[],
  taskScope: AgentTaskScope,
): TaskResultLayoutPlan {
  if (taskScope.resultPolicy !== "grouped-by-source" && taskScope.resultPolicy !== "grouped-by-container") {
    return { ok: true, needed: false, reason: "not-grouped", orderedNodeIds: [], partitions: [], missingResultNodeIds: [], missingSourceKeys: [] };
  }
  if (taskScope.truncated) {
    return { ok: false, needed: true, reason: "scope-truncated", orderedNodeIds: [], partitions: [], missingResultNodeIds: [], missingSourceKeys: [] };
  }

  const requestedIds = new Set(uniqueNodeIds(newNodeIds));
  const resultNodes = nodes.filter((node) => (
    requestedIds.has(node.id) &&
    node.type === "image" &&
    !node.layerGroup &&
    node.imageState !== "generating" &&
    node.imageState !== "error" &&
    (node.assets?.length ?? 0) > 0
  ));
  if (!resultNodes.length) {
    return { ok: false, needed: true, reason: "no-results", orderedNodeIds: [], partitions: [], missingResultNodeIds: [], missingSourceKeys: [] };
  }

  const sourceByBinding = new Map(taskScope.sourceAssets.map((asset) => [taskAssetBindingKey(asset), asset] as const));
  const expectedSourceKeys = [...new Set(taskScope.sourceAssets.map(taskAssetBindingKey).filter(Boolean))];
  const expectedPartitionKeys = [...new Set(taskScope.sourceAssets.map((asset) => (
    taskScope.resultPolicy === "grouped-by-container"
      ? asset.containerId || asset.nodeId || taskAssetBindingKey(asset)
      : taskAssetBindingKey(asset)
  )).filter(Boolean))];
  const expectedOrder = new Map(expectedPartitionKeys.map((key, index) => [key, index]));
  const missingResultNodeIds: string[] = [];
  const partitionMap = new Map<string, TaskResultLayoutPartition>();
  const coveredSourceKeys = new Set<string>();

  for (const node of resultNodes) {
    const provenance = node.taskProvenance;
    const bindingId = cleanText(provenance?.sourceBindingId, 520) || "";
    const source = bindingId ? sourceByBinding.get(bindingId) : undefined;
    const snapshotMatches = provenance?.version === 1 && provenance.taskScopeSnapshotHash === taskScope.snapshotHash;
    if (!snapshotMatches || !source) {
      missingResultNodeIds.push(node.id);
      continue;
    }
    coveredSourceKeys.add(bindingId);
    const key = taskScope.resultPolicy === "grouped-by-container"
      ? provenance.sourceContainerId || source.containerId || source.nodeId || bindingId
      : bindingId;
    if (!expectedOrder.has(key)) {
      missingResultNodeIds.push(node.id);
      continue;
    }
    const partition = partitionMap.get(key) || {
      key,
      sourceContainerId: provenance.sourceContainerId || source.containerId,
      sourceDisplayCode: provenance.sourceDisplayCode || source.displayCode,
      nodeIds: [],
    };
    partition.nodeIds.push(node.id);
    partitionMap.set(key, partition);
  }

  const partitions = [...partitionMap.values()].sort((left, right) => (
    Number(expectedOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) - Number(expectedOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER)
  ));
  // A grouped-by-container presentation may intentionally collapse several
  // SOURCE results into one visual partition. It must still prove that every
  // frozen SOURCE binding produced a result; merely seeing one result in the
  // same source container is not sufficient.
  const missingSourceKeys = expectedSourceKeys.filter((key) => !coveredSourceKeys.has(key));
  const orderedNodeIds = partitions.flatMap((partition) => partition.nodeIds);
  if (missingResultNodeIds.length) {
    return { ok: false, needed: true, reason: "missing-provenance", orderedNodeIds, partitions, missingResultNodeIds, missingSourceKeys };
  }
  if (missingSourceKeys.length) {
    if (taskScope.confirmationPolicy === "preview-3" || taskScope.confirmationPolicy === "staged") {
      return { ok: true, needed: true, reason: "ready-partial", orderedNodeIds, partitions, missingResultNodeIds, missingSourceKeys };
    }
    return { ok: false, needed: true, reason: "missing-source-results", orderedNodeIds, partitions, missingResultNodeIds, missingSourceKeys };
  }
  return {
    ok: true,
    needed: orderedNodeIds.length > 1 || partitions.length > 1,
    reason: "ready",
    orderedNodeIds,
    partitions,
    missingResultNodeIds,
    missingSourceKeys,
  };
}

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
