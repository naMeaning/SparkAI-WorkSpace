import { stableImageAssetId, stableImageOccurrenceId } from "./core.ts";
import type {
  AgentTaskScope,
  AssetTaskRole,
  ImageAsset,
  ImageCollection,
  ImageContainerKind,
  ImageContainerMemberBinding,
  ImageContainerSpec,
  WorkflowNode,
} from "./core.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";

/**
 * Canonical image-container state helpers.
 *
 * Canvas layout groups remain a presentation state machine. These helpers
 * make them a deterministic projection of ImageContainerSpec instead of a
 * second persisted source of truth.
 */

const CONTAINER_KINDS = new Set<ImageContainerKind>([
  "manual",
  "folder",
  "batch-result",
  "container-group",
]);

const uniqueIds = (values: readonly unknown[], excludedId = ""): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = typeof value === "string" ? value.trim().slice(0, 160) : "";
    if (!id || id === excludedId || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const cleanText = (value: unknown, maximum: number): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maximum) : undefined;
};

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

  const requestedIds = new Set(uniqueIds(newNodeIds));
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

const cloneCollection = (collection?: ImageCollection): ImageCollection | undefined => {
  if (!collection) return undefined;
  return {
    ...collection,
    items: collection.items.map((item) => ({ ...item })),
  };
};

const sanitizeCollection = (
  value: unknown,
  fallback?: ImageCollection,
  assets: readonly ImageAsset[] = [],
): ImageCollection | undefined => {
  const source = value && typeof value === "object" ? value as Partial<ImageCollection> : fallback;
  if (!source) return undefined;
  const items = (Array.isArray(source.items) ? source.items : fallback?.items ?? [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as ImageCollection["items"][number];
      const requestedStatus = candidate.status === "pending" || candidate.status === "error" ? candidate.status : "done";
      const rawAssetIndex = Number(candidate.assetIndex);
      const candidateAssetId = cleanText(candidate.assetId, 160);
      const candidateOccurrenceId = cleanText(candidate.occurrenceId, 80)?.toLowerCase();
      const explicitAssetIndex = Number.isInteger(rawAssetIndex) && rawAssetIndex >= 1 && rawAssetIndex <= Math.min(10, assets.length)
        ? rawAssetIndex
        : undefined;
      const occurrenceIndex = explicitAssetIndex === undefined && candidateOccurrenceId
        ? assets.findIndex((asset) => asset.occurrenceId === candidateOccurrenceId)
        : -1;
      const matchingAssetIdIndexes = explicitAssetIndex === undefined && occurrenceIndex < 0 && candidateAssetId
        ? assets.map((asset, assetIndex) => asset.assetId === candidateAssetId ? assetIndex : -1).filter((assetIndex) => assetIndex >= 0)
        : [];
      const assetIdIndex = matchingAssetIdIndexes.length === 1
        ? matchingAssetIdIndexes[0]
        : -1;
      const legacyAssetIndex = explicitAssetIndex === undefined && occurrenceIndex < 0 && assetIdIndex < 0 && requestedStatus === "done" &&
        candidate.assetIndex === undefined && !candidateAssetId && Boolean(assets[index])
        ? index + 1
        : undefined;
      const assetIndex = requestedStatus === "done"
        ? explicitAssetIndex ?? (occurrenceIndex >= 0 ? occurrenceIndex + 1 : assetIdIndex >= 0 ? assetIdIndex + 1 : legacyAssetIndex)
        : undefined;
      const asset = assetIndex === undefined ? undefined : assets[assetIndex - 1];
      const status = requestedStatus === "done" && !asset ? "error" as const : requestedStatus;
      return {
        id: cleanText(candidate.id, 120) || `item-${index + 1}`,
        assetId: status === "done" && asset
          ? asset.assetId || stableImageAssetId(asset, assetIndex)
          : undefined,
        occurrenceId: status === "done" && asset
          ? stableImageOccurrenceId(asset, "image-collection", (assetIndex ?? 1) - 1)
          : undefined,
        assetIndex,
        requestIndex: Math.max(1, Math.min(10, Math.floor(Number(candidate.requestIndex ?? index + 1) || index + 1))),
        prompt: cleanText(candidate.prompt, 12000) || cleanText(asset?.prompt || asset?.revisedPrompt, 12000) || "",
        title: cleanText(candidate.title, 160),
        status,
        error: cleanText(candidate.error, 320) || (
          requestedStatus === "done" && !asset ? "图片槽位缺少对应成果。" : undefined
        ),
      } satisfies ImageCollection["items"][number];
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 10);
  if (!items.length && !(fallback?.items.length)) return undefined;
  return {
    id: cleanText(source.id, 120) || cleanText(fallback?.id, 120) || "image-collection",
    kind: source.kind === "series" ? "series" : "batch",
    generationMode: source.generationMode === "sequential" ? "sequential" : "parallel",
    items: items.length ? items : cloneCollection(fallback)?.items ?? [],
    sourceNodeId: cleanText(source.sourceNodeId, 160),
    createdAt: cleanText(source.createdAt, 80),
    autoFit: source.autoFit !== false,
  };
};

const sanitizeBindings = (value: unknown, hostNodeId: string): ImageContainerMemberBinding[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const seenBindingIds = new Set<string>();
  const result: ImageContainerMemberBinding[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<ImageContainerMemberBinding>;
    const assetId = cleanText(source.assetId, 160);
    const nodeId = cleanText(source.nodeId, 160) || hostNodeId;
    const containerNodeId = cleanText(source.containerNodeId, 160) || hostNodeId;
    if (!assetId || !nodeId || !containerNodeId) continue;
    const assetIndex = Math.max(0, Math.floor(Number(source.assetIndex ?? index) || 0));
    const occurrenceId = cleanText(source.occurrenceId, 80)?.toLowerCase();
    const key = `${nodeId}:${assetIndex}:${occurrenceId || assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const requestedBindingId = cleanText(source.bindingId, 520);
    const bindingSeed = occurrenceId || `${assetId}:${assetIndex}`;
    let bindingId = requestedBindingId && !seenBindingIds.has(requestedBindingId)
      ? requestedBindingId
      : `binding:${containerNodeId}:${nodeId}:${bindingSeed}`;
    let suffix = 1;
    while (seenBindingIds.has(bindingId)) bindingId = `binding:${containerNodeId}:${nodeId}:${bindingSeed}:${suffix++}`;
    seenBindingIds.add(bindingId);
    result.push({
      bindingId,
      assetId,
      occurrenceId,
      nodeId,
      containerNodeId,
      assetIndex,
      role: source.role === "reference" ? "reference" : source.role === "source" ? "source" : undefined,
    });
  }
  return result.slice(0, 2000);
};

type ContainerNodeInput = Pick<WorkflowNode,
  "id" | "branch" | "imageContainer" | "imageCollection" | "imageContainerSpec"
> & Partial<Pick<WorkflowNode, "type" | "assets" | "imageContainerRole" | "layerGroup">>;

const bindingsForNodeAssets = (
  node: ContainerNodeInput,
  containerNodeId = node.id,
  existingBindings: readonly ImageContainerMemberBinding[] = [],
): ImageContainerMemberBinding[] => {
  const unused = new Set(existingBindings.map((_binding, index) => index));
  const usedBindingIds = new Set<string>();
  return (node.assets ?? []).map((asset, assetIndex) => {
    const assetId = asset.assetId || stableImageAssetId(asset, assetIndex + 1);
    const occurrenceId = stableImageOccurrenceId(asset, node.id, assetIndex);
    const exactIndex = existingBindings.findIndex((binding, index) => (
      unused.has(index) &&
      binding.nodeId === node.id &&
      binding.containerNodeId === containerNodeId &&
      binding.assetIndex === assetIndex &&
      (binding.occurrenceId ? binding.occurrenceId === occurrenceId : binding.assetId === assetId)
    ));
    const occurrenceMatchIndex = exactIndex >= 0 ? exactIndex : existingBindings.findIndex((binding, index) => (
      unused.has(index) &&
      binding.nodeId === node.id &&
      binding.containerNodeId === containerNodeId &&
      binding.occurrenceId === occurrenceId
    ));
    const slotMatchIndex = occurrenceMatchIndex >= 0 ? occurrenceMatchIndex : existingBindings.findIndex((binding, index) => (
      unused.has(index) &&
      binding.nodeId === node.id &&
      binding.containerNodeId === containerNodeId &&
      binding.assetIndex === assetIndex
    ));
    const existing = slotMatchIndex >= 0 ? existingBindings[slotMatchIndex] : undefined;
    if (slotMatchIndex >= 0) unused.delete(slotMatchIndex);
    const bindingBase = `binding:${containerNodeId}:${node.id}:${occurrenceId}`;
    let bindingId = existing?.bindingId && !usedBindingIds.has(existing.bindingId) ? existing.bindingId : bindingBase;
    let bindingSuffix = 2;
    while (usedBindingIds.has(bindingId)) bindingId = `${bindingBase}:${bindingSuffix++}`;
    usedBindingIds.add(bindingId);
    return {
      bindingId,
      assetId,
      occurrenceId,
      nodeId: node.id,
      containerNodeId,
      assetIndex,
      role: asset.taskRole ?? (
        node.imageContainerRole === "source" || node.imageContainerRole === "reference"
          ? node.imageContainerRole
          : existing?.role
      ),
    };
  });
};

export function sanitizeImageContainerSpec(
  value: unknown,
  nodeId: string,
  fallbackCollection?: ImageCollection,
  assets: readonly ImageAsset[] = [],
): ImageContainerSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<ImageContainerSpec>;
  const kind = CONTAINER_KINDS.has(source.kind as ImageContainerKind)
    ? source.kind as ImageContainerKind
    : undefined;
  if (!kind) return undefined;
  const hostContentKind = source.hostContentKind === "manual" || source.hostContentKind === "folder" || source.hostContentKind === "batch-result"
    ? source.hostContentKind
    : undefined;
  const collection = sanitizeCollection(source.collection, fallbackCollection, assets);
  return {
    version: 1,
    kind,
    memberNodeIds: uniqueIds(Array.isArray(source.memberNodeIds) ? source.memberNodeIds : [], nodeId),
    childContainerNodeIds: uniqueIds(Array.isArray(source.childContainerNodeIds) ? source.childContainerNodeIds : [], nodeId),
    memberBindings: sanitizeBindings(source.memberBindings, nodeId),
    hostContentKind,
    sourceLabel: cleanText(source.sourceLabel, 260),
    importBatchId: cleanText(source.importBatchId, 160),
    layoutId: cleanText(source.layoutId, 160),
    layoutOrigin: source.layoutOrigin === "auto" || source.layoutOrigin === "generation" ? source.layoutOrigin : "manual",
    autoFit: source.autoFit !== false,
    collection,
  };
}

export function imageContainerSpecForNode(node: ContainerNodeInput): ImageContainerSpec | undefined {
  if ((node.type !== undefined && node.type !== "image") || node.layerGroup) return undefined;
  const explicit = sanitizeImageContainerSpec(node.imageContainerSpec, node.id, node.imageCollection, node.assets ?? []);
  if (explicit) {
    if (!explicit.collection && node.imageCollection) explicit.collection = cloneCollection(node.imageCollection);
    if (!explicit.memberNodeIds.length && !explicit.childContainerNodeIds.length) {
      explicit.memberBindings = bindingsForNodeAssets(node, node.id, explicit.memberBindings);
    } else if (!explicit.memberBindings.length) {
      explicit.memberBindings = bindingsForNodeAssets(node);
    }
    return explicit;
  }
  if (node.imageCollection) {
    return {
      version: 1,
      kind: "batch-result",
      memberNodeIds: [],
      childContainerNodeIds: [],
      memberBindings: bindingsForNodeAssets(node),
      layoutOrigin: "generation",
      autoFit: node.imageCollection.autoFit !== false,
      collection: cloneCollection(node.imageCollection),
    };
  }
  if (node.imageContainer) {
    const folderLike = /(?:^|[-_])folder(?:[-_]|$)/i.test(String(node.branch || ""));
    return {
      version: 1,
      kind: folderLike ? "folder" : "manual",
      memberNodeIds: [],
      childContainerNodeIds: [],
      memberBindings: bindingsForNodeAssets(node),
      layoutOrigin: "manual",
      autoFit: true,
    };
  }
  return undefined;
}

export function nodeUsesImageContainer(node: ContainerNodeInput): boolean {
  return Boolean(imageContainerSpecForNode(node));
}

export function imageContainerKindForNode(node: ContainerNodeInput): ImageContainerKind | undefined {
  return imageContainerSpecForNode(node)?.kind;
}

export function applyImageContainerCompatibility(node: WorkflowNode): WorkflowNode {
  if (node.type !== "image" || node.layerGroup) {
    return {
      ...node,
      imageContainer: false,
      imageContainerSpec: undefined,
      imageCollection: undefined,
    };
  }
  const spec = imageContainerSpecForNode(node);
  if (!spec) return node;
  const collection = cloneCollection(spec.collection ?? node.imageCollection);
  return {
    ...node,
    imageContainerSpec: spec,
    imageContainer: spec.kind !== "batch-result",
    imageCollection: collection,
  };
}

const nodeIsContainerBoundary = (node: WorkflowNode | undefined): boolean => Boolean(
  node && node.type === "image" && !node.layerGroup && nodeUsesImageContainer(node)
);

const containerDescendantIds = (
  nodeId: string,
  specsByNodeId: ReadonlyMap<string, ImageContainerSpec>,
  active = new Set<string>(),
): Set<string> => {
  if (active.has(nodeId)) return new Set();
  const nextActive = new Set(active).add(nodeId);
  const spec = specsByNodeId.get(nodeId);
  const descendants = new Set<string>();
  if (!spec) return descendants;
  for (const memberId of spec.memberNodeIds) descendants.add(memberId);
  for (const childId of spec.childContainerNodeIds) {
    descendants.add(childId);
    containerDescendantIds(childId, specsByNodeId, nextActive).forEach((id) => descendants.add(id));
  }
  return descendants;
};

const sanitizeImageContainerGraphInternal = (sourceNodes: readonly WorkflowNode[]): WorkflowNode[] => {
  const nodes = sourceNodes.map((node) => applyImageContainerCompatibility({ ...node }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rawSpecs = new Map<string, ImageContainerSpec>();
  for (const node of nodes) {
    const spec = imageContainerSpecForNode(node);
    if (spec) rawSpecs.set(node.id, spec);
  }
  const eligible = (id: string) => {
    const node = nodeById.get(id);
    return Boolean(node && node.type === "image" && !node.layerGroup);
  };
  const reaches = (startId: string, targetId: string, active = new Set<string>(), depth = 0): boolean => {
    if (startId === targetId) return true;
    if (depth >= 16 || active.has(startId)) return false;
    const spec = rawSpecs.get(startId);
    if (!spec) return false;
    const nextActive = new Set(active).add(startId);
    return spec.childContainerNodeIds.some((childId) => reaches(childId, targetId, nextActive, depth + 1));
  };
  const maxDepth = (nodeId: string, active = new Set<string>()): number => {
    if (active.has(nodeId)) return 17;
    const spec = rawSpecs.get(nodeId);
    if (!spec?.childContainerNodeIds.length) return 1;
    const nextActive = new Set(active).add(nodeId);
    return 1 + Math.max(...spec.childContainerNodeIds.map((childId) => maxDepth(childId, nextActive)));
  };
  const claimedParent = new Map<string, string>();
  const sanitizedSpecs = new Map<string, ImageContainerSpec>();
  const ancestorDepth = (nodeId: string): number => {
    let depth = 0;
    let current = nodeId;
    const seen = new Set<string>();
    while (claimedParent.has(current) && !seen.has(current) && depth <= 16) {
      seen.add(current);
      current = claimedParent.get(current)!;
      depth += 1;
    }
    return depth;
  };

  for (const node of nodes) {
    const source = rawSpecs.get(node.id);
    if (!source || node.type !== "image" || node.layerGroup) continue;
    const requestedDirect = uniqueIds(source.memberNodeIds, node.id).filter(eligible);
    const childCandidates = uniqueIds([
      ...source.childContainerNodeIds,
      ...requestedDirect.filter((id) => nodeIsContainerBoundary(nodeById.get(id))),
    ], node.id).filter((id) => eligible(id) && nodeIsContainerBoundary(nodeById.get(id)));
    const requestedChildren = childCandidates.filter((candidateId) => !childCandidates.some((otherId) => (
      otherId !== candidateId && containerDescendantIds(otherId, rawSpecs).has(candidateId)
    )));
    const childContainerNodeIds: string[] = [];
    for (const childId of requestedChildren) {
      if (claimedParent.has(childId) || reaches(childId, node.id) || ancestorDepth(node.id) + 1 + maxDepth(childId) > 16) continue;
      claimedParent.set(childId, node.id);
      childContainerNodeIds.push(childId);
    }
    const memberNodeIds: string[] = [];
    for (const memberId of requestedDirect) {
      if (childContainerNodeIds.includes(memberId) || claimedParent.has(memberId)) continue;
      claimedParent.set(memberId, node.id);
      memberNodeIds.push(memberId);
    }
    const hasChildren = childContainerNodeIds.length > 0;
    const kind: ImageContainerKind = hasChildren
      ? "container-group"
      : source.kind === "container-group"
        ? source.hostContentKind || "manual"
        : source.kind;
    const hostContentKind = hasChildren
      ? source.kind === "container-group" ? source.hostContentKind : source.kind
      : undefined;
    const directBindings = [
      ...bindingsForNodeAssets(node, node.id, source.memberBindings),
      ...memberNodeIds.flatMap((memberId) => {
        const member = nodeById.get(memberId);
        return member ? bindingsForNodeAssets(
          member,
          node.id,
          source.memberBindings.filter((binding) => binding.nodeId === memberId && binding.containerNodeId === node.id)
        ) : [];
      }),
    ];
    sanitizedSpecs.set(node.id, {
      ...source,
      kind,
      hostContentKind,
      memberNodeIds,
      childContainerNodeIds,
      memberBindings: directBindings.slice(0, 2000),
      layoutId: memberNodeIds.length || childContainerNodeIds.length ? source.layoutId : undefined,
    });
  }

  return nodes.map((node) => {
    const spec = sanitizedSpecs.get(node.id);
    return spec
      ? applyImageContainerCompatibility({ ...node, imageContainerSpec: spec })
      : applyImageContainerCompatibility({ ...node, imageContainerSpec: undefined });
  });
};

export function sanitizeImageContainerGraph(sourceNodes: readonly WorkflowNode[]): WorkflowNode[] {
  return sanitizeImageContainerGraphInternal(sourceNodes);
}

/**
 * Applies a user-visible layout mutation to canonical container specs. This is
 * the only direction in which layoutGroups are allowed to modify persistence.
 */
export function synchronizeImageContainerSpecs(
  sourceNodes: readonly WorkflowNode[],
  groups: readonly ImageLayoutGroup[],
): WorkflowNode[] {
  const nodes = sourceNodes.map((node) => applyImageContainerCompatibility({ ...node }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const specsByNodeId = new Map<string, ImageContainerSpec>();
  for (const node of nodes) {
    const spec = imageContainerSpecForNode(node);
    if (spec) specsByNodeId.set(node.id, spec);
  }
  const canonicalChildIds = new Set<string>();

  const nextSpecs = new Map<string, ImageContainerSpec>();
  for (const group of groups) {
    const host = nodeById.get(group.hostNodeId);
    if (!host) continue;
    const base = specsByNodeId.get(host.id);
    const requested = uniqueIds(group.memberNodeIds, host.id).filter((id) => {
      const node = nodeById.get(id);
      return Boolean(node && node.type === "image" && !node.layerGroup);
    });
    const childCandidates = requested.filter((id) => nodeIsContainerBoundary(nodeById.get(id)));
    const descendantIdsByCandidate = new Map(
      childCandidates.map((childId) => [childId, containerDescendantIds(childId, specsByNodeId)])
    );
    const childContainerNodeIds = childCandidates.filter((candidateId) => !childCandidates.some((otherId) => (
      otherId !== candidateId && descendantIdsByCandidate.get(otherId)?.has(candidateId)
    )));
    const descendantIds = new Set<string>();
    for (const childId of childContainerNodeIds) {
      canonicalChildIds.add(childId);
      containerDescendantIds(childId, specsByNodeId).forEach((id) => descendantIds.add(id));
    }
    const memberNodeIds = requested.filter((id) => !childContainerNodeIds.includes(id) && !descendantIds.has(id));
    const hostContentKind = childContainerNodeIds.length
      ? base?.kind === "container-group"
        ? base.hostContentKind
        : base?.kind
      : undefined;
    const kind: ImageContainerKind = childContainerNodeIds.length
      ? "container-group"
      : base?.kind === "container-group"
        ? base.hostContentKind || "manual"
        : base?.kind || "manual";
    nextSpecs.set(host.id, {
      version: 1,
      kind,
      memberNodeIds,
      childContainerNodeIds,
      memberBindings: base?.memberBindings.map((binding) => ({ ...binding })) ?? [],
      hostContentKind,
      sourceLabel: base?.sourceLabel,
      importBatchId: base?.importBatchId,
      layoutId: group.id,
      layoutOrigin: group.origin,
      autoFit: group.autoFit !== false,
      collection: cloneCollection(base?.collection ?? host.imageCollection),
    });
  }

  const finalSpecs = new Map<string, ImageContainerSpec>();
  for (const node of nodes) {
    const groupSpec = nextSpecs.get(node.id);
    if (groupSpec) {
      finalSpecs.set(node.id, groupSpec);
      continue;
    }
    const current = specsByNodeId.get(node.id);
    if (!current) continue;
    if (canonicalChildIds.has(node.id)) {
      finalSpecs.set(node.id, current);
      continue;
    }
    const hadLayoutMembership = Boolean(
      current.memberNodeIds.length || current.childContainerNodeIds.length || current.layoutId
    );
    const cleared: ImageContainerSpec = hadLayoutMembership
      ? {
          ...current,
          kind: current.kind === "container-group" ? current.hostContentKind || "manual" : current.kind,
          hostContentKind: undefined,
          memberNodeIds: [],
          childContainerNodeIds: [],
          layoutId: undefined,
        }
      : current;
    const shouldDowngradeDissolvedManualContainer = Boolean(
      hadLayoutMembership &&
      cleared.kind === "manual" &&
      cleared.memberNodeIds.length === 0 &&
      cleared.childContainerNodeIds.length === 0 &&
      !cleared.collection &&
      !cleared.sourceLabel &&
      !cleared.importBatchId &&
      !node.imageContainerRole &&
      (node.assets?.length ?? 0) === 1
    );
    if (shouldDowngradeDissolvedManualContainer) continue;
    finalSpecs.set(node.id, cleared);
  }

  const collectDirectBindings = (nodeId: string): ImageContainerMemberBinding[] => {
    const node = nodeById.get(nodeId);
    if (!node) return [];
    const spec = finalSpecs.get(nodeId);
    const directBindings = bindingsForNodeAssets(node, nodeId, spec?.memberBindings ?? []);
    if (!spec) return directBindings;
    const memberBindings = spec.memberNodeIds.flatMap((memberId) => {
      const member = nodeById.get(memberId);
      return member ? bindingsForNodeAssets(
        member,
        nodeId,
        spec.memberBindings.filter((binding) => binding.nodeId === memberId && binding.containerNodeId === nodeId)
      ) : [];
    });
    return [...directBindings, ...memberBindings].slice(0, 2000);
  };

  for (const [nodeId, spec] of finalSpecs) {
    const node = nodeById.get(nodeId);
    const collection = node
      ? sanitizeCollection(spec.collection, undefined, node.assets ?? [])
      : undefined;
    finalSpecs.set(nodeId, {
      ...spec,
      memberBindings: collectDirectBindings(nodeId),
      collection,
    });
  }

  const synchronized = nodes.map((node) => {
    const spec = finalSpecs.get(node.id);
    return spec
      ? applyImageContainerCompatibility({ ...node, imageContainerSpec: spec })
      : { ...node, imageContainer: false, imageContainerSpec: undefined };
  });
  return sanitizeImageContainerGraphInternal(synchronized);
}

/** Runtime-only flattened bindings for rendering and TaskScope. */
export function flattenImageContainerBindings(
  sourceNodes: readonly WorkflowNode[],
  hostNodeId: string,
): ImageContainerMemberBinding[] {
  const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const collect = (nodeId: string, active = new Set<string>()): ImageContainerMemberBinding[] => {
    if (active.has(nodeId)) return [];
    const node = nodeById.get(nodeId);
    if (!node || node.type !== "image" || node.layerGroup) return [];
    const nextActive = new Set(active).add(nodeId);
    const spec = imageContainerSpecForNode(node);
    const direct = [
      ...bindingsForNodeAssets(node, nodeId, spec?.memberBindings ?? []),
      ...(spec?.memberNodeIds ?? []).flatMap((memberId) => {
        const member = nodeById.get(memberId);
        return member && member.type === "image" && !member.layerGroup
          ? bindingsForNodeAssets(
              member,
              nodeId,
              (spec?.memberBindings ?? []).filter((binding) => binding.nodeId === memberId && binding.containerNodeId === nodeId)
            )
          : [];
      }),
    ];
    const children = (spec?.childContainerNodeIds ?? []).flatMap((childId) => collect(childId, nextActive));
    return [...direct, ...children];
  };
  const seen = new Set<string>();
  return collect(hostNodeId).filter((binding) => {
    if (seen.has(binding.bindingId)) return false;
    seen.add(binding.bindingId);
    return true;
  }).slice(0, 4000);
}

/** Merges v1/v2 layoutGroups into already-canonical spec groups one group at a time. */
export function mergeLegacyImageLayoutGroups(
  sourceNodes: readonly WorkflowNode[],
  canonicalGroups: readonly ImageLayoutGroup[],
  legacyGroups: readonly ImageLayoutGroup[],
): ImageLayoutGroup[] {
  const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const eligible = (id: string) => {
    const node = nodeById.get(id);
    return Boolean(node && node.type === "image" && !node.layerGroup);
  };
  const result = canonicalGroups.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
  const claimedBy = new Map<string, string>();
  result.forEach((group) => group.memberNodeIds.forEach((id) => claimedBy.set(id, group.id)));

  for (const legacy of legacyGroups) {
    const requested = uniqueIds([legacy.hostNodeId, ...(legacy.memberNodeIds ?? [])]).filter(eligible);
    const target = result.find((group) => group.hostNodeId === legacy.hostNodeId || group.id === legacy.id);
    if (target) {
      for (const id of requested) {
        const owner = claimedBy.get(id);
        if (owner && owner !== target.id) continue;
        if (!target.memberNodeIds.includes(id)) target.memberNodeIds.push(id);
        claimedBy.set(id, target.id);
      }
      if (!target.memberNodeIds.includes(target.hostNodeId)) target.memberNodeIds.unshift(target.hostNodeId);
      target.autoFit = target.autoFit !== false && legacy.autoFit !== false;
      continue;
    }
    if (!eligible(legacy.hostNodeId) || claimedBy.has(legacy.hostNodeId)) continue;
    const members = requested.filter((id) => !claimedBy.has(id));
    if (!members.includes(legacy.hostNodeId)) members.unshift(legacy.hostNodeId);
    if (members.length < 2) continue;
    const id = result.some((group) => group.id === legacy.id)
      ? `legacy-${legacy.id}-${result.length + 1}`
      : legacy.id;
    const group = {
      id,
      hostNodeId: legacy.hostNodeId,
      memberNodeIds: members,
      origin: legacy.origin === "auto" || legacy.origin === "generation" ? legacy.origin : "manual" as const,
      autoFit: legacy.autoFit !== false,
    };
    result.push(group);
    members.forEach((memberId) => claimedBy.set(memberId, id));
  }
  return result;
}

/**
 * Rebuilds the in-memory canvas presentation from canonical container specs.
 * Nested boundaries are flattened only for rendering; the specs remain
 * hierarchical and therefore available to TaskScope and future editors.
 */
export function deriveImageLayoutGroupsFromContainerSpecs(
  sourceNodes: readonly WorkflowNode[],
): ImageLayoutGroup[] {
  const nodes = sanitizeImageContainerGraphInternal(sourceNodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const specsByNodeId = new Map<string, ImageContainerSpec>();
  for (const node of nodes) {
    const spec = imageContainerSpecForNode(node);
    if (spec) specsByNodeId.set(node.id, spec);
  }
  const nestedIds = new Set<string>();
  specsByNodeId.forEach((spec) => spec.childContainerNodeIds.forEach((id) => nestedIds.add(id)));
  const claimed = new Set<string>();
  const usedGroupIds = new Set<string>();
  const result: ImageLayoutGroup[] = [];

  const collect = (nodeId: string, active = new Set<string>()): string[] => {
    if (active.has(nodeId)) return [];
    const node = nodeById.get(nodeId);
    if (!node || node.type !== "image" || node.layerGroup) return [];
    const nextActive = new Set(active).add(nodeId);
    const spec = specsByNodeId.get(nodeId);
    if (!spec) return [nodeId];
    return uniqueIds([
      nodeId,
      ...spec.memberNodeIds,
      ...spec.childContainerNodeIds.flatMap((childId) => collect(childId, nextActive)),
    ]).filter((id) => Boolean(nodeById.get(id)) && !nodeById.get(id)?.layerGroup);
  };

  for (const node of nodes) {
    const spec = specsByNodeId.get(node.id);
    if (!spec || nestedIds.has(node.id)) continue;
    const members = collect(node.id).filter((id) => !claimed.has(id));
    if (members.length < 2 || members[0] !== node.id) continue;
    let groupId = spec.layoutId || `image-layout-${node.id}`;
    if (usedGroupIds.has(groupId)) {
      let suffix = 2;
      while (usedGroupIds.has(`${groupId}-${suffix}`)) suffix += 1;
      groupId = `${groupId}-${suffix}`;
    }
    usedGroupIds.add(groupId);
    members.forEach((id) => claimed.add(id));
    result.push({
      id: groupId,
      hostNodeId: node.id,
      memberNodeIds: members,
      origin: spec.layoutOrigin === "auto" || spec.layoutOrigin === "generation" ? spec.layoutOrigin : "manual",
      autoFit: spec.autoFit !== false,
    });
  }
  return result;
}

export function containerBoundarySummary(node: WorkflowNode): {
  kind?: ImageContainerKind;
  directMemberCount: number;
  childContainerCount: number;
  sourceLabel?: string;
  importBatchId?: string;
} {
  const spec = imageContainerSpecForNode(node);
  return {
    kind: spec?.kind,
    directMemberCount: spec?.memberNodeIds.length ?? 0,
    childContainerCount: spec?.childContainerNodeIds.length ?? 0,
    sourceLabel: spec?.sourceLabel,
    importBatchId: spec?.importBatchId,
  };
}
