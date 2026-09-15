/**
 * Pure image-layout state machine.
 *
 * Layout groups describe how image artifacts are presented together on the
 * canvas. They deliberately do not own artifacts and must never be used as a
 * substitute for WorkflowNode.parentId/relationType generation causality.
 */

export type ImageLayoutOrigin = "manual" | "auto" | "generation";

export type ImageGridPlan = {
  columns: number;
  rows: number;
};

export type ImageGridVariant = "grid" | "triple-row" | "triple-mosaic-left" | "triple-mosaic-top";

export type ImageGridPresentation = ImageGridPlan & {
  variant: ImageGridVariant;
  order: number[];
  representativeRatio: number;
  columnFr?: number[];
  rowFr?: number[];
};

/**
 * Shared presentation plan for every image-result container. Keeping the
 * count-to-grid decision beside the container state machine prevents manual
 * containers and Agent-created batches from drifting into separate layouts.
 */
export const imageGridPlanForCount = (assetCount: number): ImageGridPlan => {
  const count = Math.max(1, Math.min(10, Math.round(Number(assetCount) || 1)));
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count === 3) return { columns: 2, rows: 2 };
  if (count === 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  if (count <= 8) return { columns: 4, rows: 2 };
  if (count === 9) return { columns: 3, rows: 3 };
  return { columns: 5, rows: 2 };
};

const normalizedImageRatio = (value: unknown, fallback: number): number => {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0 ? Math.max(0.32, Math.min(3.2, ratio)) : fallback;
};

const medianRatio = (ratios: readonly number[]): number => {
  const sorted = [...ratios].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const ratioGroupedGridOrder = (ratios: readonly number[], columns: number): number[] => {
  const sorted = ratios
    .map((ratio, index) => ({ ratio, index }))
    .sort((left, right) => left.ratio - right.ratio || left.index - right.index);
  const order: number[] = [];
  for (let offset = 0, row = 0; offset < sorted.length; offset += columns, row += 1) {
    const members = sorted.slice(offset, offset + columns).map((item) => item.index);
    // A serpentine scan keeps neighbouring rows visually connected without
    // mixing portrait and landscape extremes into every comparison row.
    if (row % 2 === 1) members.reverse();
    order.push(...members);
  }
  return order;
};

const ratioAwareRowWeights = (
  ratios: readonly number[],
  order: readonly number[],
  columns: number,
  rows: number,
): number[] | undefined => {
  const weights = Array.from({ length: rows }, (_item, row) => {
    const rowRatios = order
      .slice(row * columns, (row + 1) * columns)
      .map((index) => ratios[index])
      .filter((ratio) => Number.isFinite(ratio) && ratio > 0);
    if (!rowRatios.length) return 1;
    return Math.max(0.5, Math.min(2.2, 1 / medianRatio(rowRatios)));
  });
  const spread = Math.max(...weights) / Math.max(0.01, Math.min(...weights));
  return spread >= 1.18 ? weights : undefined;
};

/**
 * Refines the count-only grid with the images' real proportions. Similar
 * three-image batches stay as an even comparison row; a genuine landscape or
 * portrait outlier becomes the large tile. Mixed larger grids group similar
 * proportions into comparison rows and weight each row by its representative
 * aspect ratio, reducing the empty bands produced by equal-height mixed grids.
 * The returned order is presentation-only and never changes asset identity.
 */
export const imageGridPresentationForRatios = (
  assetCount: number,
  assetRatios: readonly number[] = [],
  fallbackRatio = 1,
): ImageGridPresentation => {
  const count = Math.max(1, Math.min(10, Math.round(Number(assetCount) || 1)));
  const fallback = normalizedImageRatio(fallbackRatio, 1);
  const ratios = Array.from({ length: count }, (_item, index) => normalizedImageRatio(assetRatios[index], fallback));
  const representativeRatio = medianRatio(ratios);
  const originalOrder = Array.from({ length: count }, (_item, index) => index);
  const base = imageGridPlanForCount(count);

  if (count !== 3) {
    const spread = Math.max(...ratios) / Math.max(0.01, Math.min(...ratios));
    const order = count >= 4 && spread >= 1.45
      ? ratioGroupedGridOrder(ratios, base.columns)
      : originalOrder;
    return {
      ...base,
      variant: "grid",
      order,
      representativeRatio,
      ...(order === originalOrder
        ? {}
        : { rowFr: ratioAwareRowWeights(ratios, order, base.columns, base.rows) }),
    };
  }

  const sorted = ratios.map((ratio, index) => ({ ratio, index })).sort((left, right) => left.ratio - right.ratio);
  const tall = sorted[0];
  const middle = sorted[1];
  const wide = sorted[2];
  const spread = wide.ratio / Math.max(0.01, tall.ratio);
  if (spread < 1.35) {
    return { columns: 3, rows: 1, variant: "triple-row", order: originalOrder, representativeRatio };
  }

  const wideOutlierScore = wide.ratio / Math.max(0.01, (tall.ratio + middle.ratio) / 2);
  const tallOutlierScore = ((middle.ratio + wide.ratio) / 2) / Math.max(0.01, tall.ratio);
  const wideOutlier = wide.ratio >= 1.15 && wideOutlierScore >= 1.35;
  const tallOutlier = tall.ratio <= 0.9 && tallOutlierScore >= 1.35;
  if (wideOutlier && (!tallOutlier || wideOutlierScore >= tallOutlierScore)) {
    const secondary = originalOrder.filter((index) => index !== wide.index).sort((left, right) => ratios[left] - ratios[right]);
    const order = [wide.index, ...secondary];
    const [primaryRatio, leftRatio, rightRatio] = order.map((index) => ratios[index]);
    return {
      columns: 2,
      rows: 2,
      variant: "triple-mosaic-top",
      order,
      representativeRatio,
      columnFr: [leftRatio, rightRatio],
      rowFr: [1 / primaryRatio, 1 / Math.max(0.01, leftRatio + rightRatio)],
    };
  }
  if (tallOutlier) {
    const secondary = originalOrder.filter((index) => index !== tall.index).sort((left, right) => ratios[left] - ratios[right]);
    const order = [tall.index, ...secondary];
    const [primaryRatio, upperRatio, lowerRatio] = order.map((index) => ratios[index]);
    return {
      columns: 2,
      rows: 2,
      variant: "triple-mosaic-left",
      order,
      representativeRatio,
      columnFr: [primaryRatio * (1 / upperRatio + 1 / lowerRatio), 1],
      rowFr: [1 / upperRatio, 1 / lowerRatio],
    };
  }

  return { columns: 3, rows: 1, variant: "triple-row", order: originalOrder, representativeRatio };
};

export type ImageLayoutGroup = {
  id: string;
  hostNodeId: string;
  memberNodeIds: string[];
  origin: ImageLayoutOrigin;
  autoFit?: boolean;
};

export type ImageLayoutNodeLike = {
  id: string;
  type?: unknown;
  layerGroup?: unknown;
  parentId?: unknown;
  relationType?: unknown;
};

export type ImageLayoutState<N extends ImageLayoutNodeLike> = {
  nodes: readonly N[];
  groups: readonly ImageLayoutGroup[];
};

export type ImageLayoutMutationReason =
  | "created"
  | "moved"
  | "reordered"
  | "extracted"
  | "duplicate"
  | "layer-member-forbidden"
  | "unsupported-node"
  | "node-not-found"
  | "group-not-found"
  | "same-position"
  | "normalized"
  | "group-id-conflict"
  | "member-not-found"
  | "invalid-input";

export type ImageLayoutMutationResult<N extends ImageLayoutNodeLike> = {
  ok: boolean;
  changed: boolean;
  reason: ImageLayoutMutationReason;
  nodes: N[];
  groups: ImageLayoutGroup[];
  removedGroupIds?: string[];
  exposedNodeIds?: string[];
};

export type CreateManualImageLayoutGroupInput = {
  groupId: string;
  hostNodeId: string;
  memberNodeIds: readonly string[];
};

export type MergeImageLayoutSelectionInput = CreateManualImageLayoutGroupInput & {
  replaceGroupIds?: readonly string[];
};

export type MoveImageLayoutMemberInput = {
  memberNodeId: string;
  targetGroupId: string;
  targetIndex?: number;
};

export type ReorderImageLayoutMemberInput = {
  groupId: string;
  memberNodeId: string;
  targetIndex: number;
};

export type ExtractImageLayoutMemberInput = {
  groupId: string;
  memberNodeId: string;
};

type SanitizedState<N extends ImageLayoutNodeLike> = {
  nodes: N[];
  groups: ImageLayoutGroup[];
  changed: boolean;
  removedGroupIds: string[];
  exposedNodeIds: string[];
};

const isLayoutOrigin = (value: unknown): value is ImageLayoutOrigin =>
  value === "manual" || value === "auto" || value === "generation";

const isLayerNode = (node: ImageLayoutNodeLike): boolean => node.layerGroup != null;

const isEligibleImageNode = (node: ImageLayoutNodeLike): boolean => node.type === "image" && !isLayerNode(node);

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const cloneNodes = <N extends ImageLayoutNodeLike>(nodes: readonly N[]): N[] =>
  nodes.map((node) => ({ ...node }));

const cloneGroups = (groups: readonly ImageLayoutGroup[]): ImageLayoutGroup[] =>
  groups.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));

const groupsEqual = (
  left: readonly ImageLayoutGroup[],
  right: readonly ImageLayoutGroup[],
): boolean => {
  if (left.length !== right.length) return false;
  return left.every((group, index) => {
    const candidate = right[index];
    return (
      candidate != null &&
      group.id === candidate.id &&
      group.hostNodeId === candidate.hostNodeId &&
      group.origin === candidate.origin &&
      group.autoFit === candidate.autoFit &&
      group.memberNodeIds.length === candidate.memberNodeIds.length &&
      group.memberNodeIds.every((nodeId, memberIndex) => nodeId === candidate.memberNodeIds[memberIndex])
    );
  });
};

const sanitizeState = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
): SanitizedState<N> => {
  const nodes = cloneNodes(state.nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const claimedNodeIds = new Set<string>();
  const seenGroupIds = new Set<string>();
  const groups: ImageLayoutGroup[] = [];
  const removedGroupIds: string[] = [];
  const referencedNodeIds = new Set<string>();

  for (const rawGroup of state.groups) {
    const rawGroupId = typeof rawGroup.id === "string" ? rawGroup.id : "";
    if (rawGroupId.length === 0 || seenGroupIds.has(rawGroupId)) {
      if (rawGroupId.length > 0) removedGroupIds.push(rawGroupId);
      continue;
    }
    seenGroupIds.add(rawGroupId);

    const rawMembers = Array.isArray(rawGroup.memberNodeIds) ? rawGroup.memberNodeIds : [];
    const candidateIds = uniqueStrings(rawMembers);
    if (typeof rawGroup.hostNodeId === "string" && rawGroup.hostNodeId.length > 0) {
      if (!candidateIds.includes(rawGroup.hostNodeId)) candidateIds.unshift(rawGroup.hostNodeId);
    }

    const memberNodeIds: string[] = [];
    for (const nodeId of candidateIds) {
      const node = nodeById.get(nodeId);
      if (node == null || !isEligibleImageNode(node)) continue;
      referencedNodeIds.add(nodeId);
      if (claimedNodeIds.has(nodeId)) continue;
      memberNodeIds.push(nodeId);
    }

    if (memberNodeIds.length < 2) {
      removedGroupIds.push(rawGroupId);
      continue;
    }

    const hostNodeId = memberNodeIds.includes(rawGroup.hostNodeId)
      ? rawGroup.hostNodeId
      : memberNodeIds[0];
    const origin = isLayoutOrigin(rawGroup.origin) ? rawGroup.origin : "manual";
    groups.push({ id: rawGroupId, hostNodeId, memberNodeIds, origin, autoFit: rawGroup.autoFit !== false });
    memberNodeIds.forEach((nodeId) => claimedNodeIds.add(nodeId));
  }

  const exposedNodeIds = [...referencedNodeIds].filter((nodeId) => !claimedNodeIds.has(nodeId));
  const changed = !groupsEqual(state.groups, groups);
  return {
    nodes,
    groups,
    changed,
    removedGroupIds: uniqueStrings(removedGroupIds),
    exposedNodeIds: uniqueStrings(exposedNodeIds),
  };
};

const optionalList = (values: readonly string[]): string[] | undefined => {
  const unique = uniqueStrings(values);
  return unique.length > 0 ? unique : undefined;
};

const resultFrom = <N extends ImageLayoutNodeLike>(
  state: Pick<SanitizedState<N>, "nodes" | "groups">,
  options: {
    ok: boolean;
    changed: boolean;
    reason: ImageLayoutMutationReason;
    removedGroupIds?: readonly string[];
    exposedNodeIds?: readonly string[];
  },
): ImageLayoutMutationResult<N> => ({
  ok: options.ok,
  changed: options.changed,
  reason: options.reason,
  nodes: cloneNodes(state.nodes),
  groups: cloneGroups(state.groups),
  ...(optionalList(options.removedGroupIds ?? []) != null
    ? { removedGroupIds: optionalList(options.removedGroupIds ?? []) }
    : {}),
  ...(optionalList(options.exposedNodeIds ?? []) != null
    ? { exposedNodeIds: optionalList(options.exposedNodeIds ?? []) }
    : {}),
});

const failedResult = <N extends ImageLayoutNodeLike>(
  state: SanitizedState<N>,
  reason: ImageLayoutMutationReason,
  ok = false,
): ImageLayoutMutationResult<N> =>
  resultFrom(state, {
    ok,
    changed: state.changed,
    reason,
    removedGroupIds: state.removedGroupIds,
    exposedNodeIds: state.exposedNodeIds,
  });

const findMembership = (
  groups: readonly ImageLayoutGroup[],
  nodeId: string,
): ImageLayoutGroup | undefined => groups.find((group) => group.memberNodeIds.includes(nodeId));

const normalizeInsertIndex = (index: number | undefined, length: number): number => {
  if (index == null) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
};

/**
 * Repairs persisted layout data and removes groups that cannot visually group
 * at least two ordinary image nodes. First valid membership wins when legacy
 * data contains a node in more than one group.
 */
export const sanitizeImageLayoutGroups = <N extends ImageLayoutNodeLike>(
  nodes: readonly N[],
  groups: readonly ImageLayoutGroup[],
): ImageLayoutMutationResult<N> => {
  const sanitized = sanitizeState({ nodes, groups });
  return resultFrom(sanitized, {
    ok: true,
    changed: sanitized.changed,
    reason: "normalized",
    removedGroupIds: sanitized.removedGroupIds,
    exposedNodeIds: sanitized.exposedNodeIds,
  });
};

export const createManualImageLayoutGroup = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
  input: CreateManualImageLayoutGroupInput,
): ImageLayoutMutationResult<N> => {
  const base = sanitizeState(state);
  if (input.groupId.length === 0 || input.hostNodeId.length === 0) {
    return failedResult(base, "invalid-input");
  }
  if (base.groups.some((group) => group.id === input.groupId)) {
    return failedResult(base, "group-id-conflict");
  }

  const requestedNodeIds = uniqueStrings([input.hostNodeId, ...input.memberNodeIds]);
  if (requestedNodeIds.length < 2) return failedResult(base, "invalid-input");
  const nodeById = new Map(base.nodes.map((node) => [node.id, node]));
  if (requestedNodeIds.some((nodeId) => !nodeById.has(nodeId))) {
    return failedResult(base, "node-not-found");
  }
  if (requestedNodeIds.some((nodeId) => isLayerNode(nodeById.get(nodeId)!))) {
    return failedResult(base, "layer-member-forbidden");
  }
  if (requestedNodeIds.some((nodeId) => !isEligibleImageNode(nodeById.get(nodeId)!))) {
    return failedResult(base, "unsupported-node");
  }
  if (requestedNodeIds.some((nodeId) => findMembership(base.groups, nodeId) != null)) {
    return failedResult(base, "duplicate", true);
  }

  const groups = [
    ...base.groups,
    {
      id: input.groupId,
      hostNodeId: input.hostNodeId,
      memberNodeIds: requestedNodeIds,
      origin: "manual" as const,
      autoFit: true,
    },
  ];
  return resultFrom({ nodes: base.nodes, groups }, {
    ok: true,
    changed: true,
    reason: "created",
    removedGroupIds: base.removedGroupIds,
    exposedNodeIds: base.exposedNodeIds,
  });
};

/**
 * Atomically replaces any selected visual containers with one unified image
 * layout group. Artifact nodes and parent/relation causality are untouched;
 * layer nodes remain explicitly ineligible.
 */
export const mergeImageLayoutSelection = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
  input: MergeImageLayoutSelectionInput,
): ImageLayoutMutationResult<N> => {
  const base = sanitizeState(state);
  const replaceGroupIds = new Set(uniqueStrings(input.replaceGroupIds ?? []));
  const groups = base.groups.filter((group) => !replaceGroupIds.has(group.id));
  const requestedNodeIds = uniqueStrings([input.hostNodeId, ...input.memberNodeIds]);
  if (!input.groupId || !input.hostNodeId || requestedNodeIds.length < 2) {
    return failedResult(base, "invalid-input");
  }
  if (groups.some((group) => group.id === input.groupId)) {
    return failedResult(base, "group-id-conflict");
  }
  const nodeById = new Map(base.nodes.map((node) => [node.id, node]));
  if (requestedNodeIds.some((nodeId) => !nodeById.has(nodeId))) {
    return failedResult(base, "node-not-found");
  }
  if (requestedNodeIds.some((nodeId) => isLayerNode(nodeById.get(nodeId)!))) {
    return failedResult(base, "layer-member-forbidden");
  }
  if (requestedNodeIds.some((nodeId) => !isEligibleImageNode(nodeById.get(nodeId)!))) {
    return failedResult(base, "unsupported-node");
  }
  if (requestedNodeIds.some((nodeId) => findMembership(groups, nodeId) != null)) {
    return failedResult(base, "duplicate", true);
  }
  const nextGroups = [
    ...groups,
    {
      id: input.groupId,
      hostNodeId: input.hostNodeId,
      memberNodeIds: requestedNodeIds,
      origin: "manual" as const,
      autoFit: true,
    },
  ];
  return resultFrom({ nodes: base.nodes, groups: nextGroups }, {
    ok: true,
    changed: true,
    reason: "created",
    removedGroupIds: [...base.removedGroupIds, ...replaceGroupIds],
    exposedNodeIds: base.exposedNodeIds,
  });
};

export const moveImageLayoutMember = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
  input: MoveImageLayoutMemberInput,
): ImageLayoutMutationResult<N> => {
  const base = sanitizeState(state);
  const node = base.nodes.find((candidate) => candidate.id === input.memberNodeId);
  if (node == null) return failedResult(base, "node-not-found");
  if (isLayerNode(node)) return failedResult(base, "layer-member-forbidden");
  if (!isEligibleImageNode(node)) return failedResult(base, "unsupported-node");
  const targetGroup = base.groups.find((group) => group.id === input.targetGroupId);
  if (targetGroup == null) return failedResult(base, "group-not-found");
  if (targetGroup.memberNodeIds.includes(input.memberNodeId)) {
    return failedResult(base, "duplicate", true);
  }
  if (input.targetIndex != null && !Number.isFinite(input.targetIndex)) {
    return failedResult(base, "invalid-input");
  }

  const sourceGroup = findMembership(base.groups, input.memberNodeId);
  const removedGroupIds = [...base.removedGroupIds];
  const exposedNodeIds = [...base.exposedNodeIds];
  const groups = base.groups.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));

  if (sourceGroup != null) {
    const source = groups.find((group) => group.id === sourceGroup.id)!;
    source.memberNodeIds = source.memberNodeIds.filter((nodeId) => nodeId !== input.memberNodeId);
    source.autoFit = true;
    if (source.hostNodeId === input.memberNodeId && source.memberNodeIds.length > 0) {
      source.hostNodeId = source.memberNodeIds[0];
    }
  }

  const target = groups.find((group) => group.id === input.targetGroupId)!;
  const targetIndex = normalizeInsertIndex(input.targetIndex, target.memberNodeIds.length);
  target.memberNodeIds.splice(targetIndex, 0, input.memberNodeId);
  target.autoFit = true;

  const normalized = sanitizeState({ nodes: base.nodes, groups });
  removedGroupIds.push(...normalized.removedGroupIds);
  if (sourceGroup != null && !normalized.groups.some((group) => group.id === sourceGroup.id)) {
    const sourceRemainder = sourceGroup.memberNodeIds.filter((nodeId) => nodeId !== input.memberNodeId);
    exposedNodeIds.push(...sourceRemainder);
  }

  return resultFrom(normalized, {
    ok: true,
    changed: true,
    reason: "moved",
    removedGroupIds,
    exposedNodeIds,
  });
};

export const reorderImageLayoutMember = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
  input: ReorderImageLayoutMemberInput,
): ImageLayoutMutationResult<N> => {
  const base = sanitizeState(state);
  const groupIndex = base.groups.findIndex((group) => group.id === input.groupId);
  if (groupIndex < 0) return failedResult(base, "group-not-found");
  const node = base.nodes.find((candidate) => candidate.id === input.memberNodeId);
  if (node == null) return failedResult(base, "node-not-found");
  if (isLayerNode(node)) return failedResult(base, "layer-member-forbidden");
  if (!isEligibleImageNode(node)) return failedResult(base, "unsupported-node");
  const group = base.groups[groupIndex];
  const currentIndex = group.memberNodeIds.indexOf(input.memberNodeId);
  if (currentIndex < 0) return failedResult(base, "member-not-found");
  if (!Number.isFinite(input.targetIndex)) return failedResult(base, "invalid-input");
  const targetIndex = Math.max(0, Math.min(Math.trunc(input.targetIndex), group.memberNodeIds.length - 1));
  if (targetIndex === currentIndex) return failedResult(base, "same-position", true);

  const groups = cloneGroups(base.groups);
  const memberNodeIds = groups[groupIndex].memberNodeIds;
  memberNodeIds.splice(currentIndex, 1);
  memberNodeIds.splice(targetIndex, 0, input.memberNodeId);
  return resultFrom({ nodes: base.nodes, groups }, {
    ok: true,
    changed: true,
    reason: "reordered",
    removedGroupIds: base.removedGroupIds,
    exposedNodeIds: base.exposedNodeIds,
  });
};

export const extractImageLayoutMember = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
  input: ExtractImageLayoutMemberInput,
): ImageLayoutMutationResult<N> => {
  const base = sanitizeState(state);
  const groupIndex = base.groups.findIndex((group) => group.id === input.groupId);
  if (groupIndex < 0) return failedResult(base, "group-not-found");
  const node = base.nodes.find((candidate) => candidate.id === input.memberNodeId);
  if (node == null) return failedResult(base, "node-not-found");
  if (isLayerNode(node)) return failedResult(base, "layer-member-forbidden");
  if (!isEligibleImageNode(node)) return failedResult(base, "unsupported-node");
  const source = base.groups[groupIndex];
  if (!source.memberNodeIds.includes(input.memberNodeId)) {
    return failedResult(base, "member-not-found");
  }

  const groups = cloneGroups(base.groups);
  const group = groups[groupIndex];
  group.memberNodeIds = group.memberNodeIds.filter((nodeId) => nodeId !== input.memberNodeId);
  group.autoFit = true;
  if (group.hostNodeId === input.memberNodeId && group.memberNodeIds.length > 0) {
    group.hostNodeId = group.memberNodeIds[0];
  }

  const removedGroupIds = [...base.removedGroupIds];
  const exposedNodeIds = [...base.exposedNodeIds, input.memberNodeId];
  if (group.memberNodeIds.length < 2) {
    groups.splice(groupIndex, 1);
    removedGroupIds.push(group.id);
    exposedNodeIds.push(...group.memberNodeIds);
  }

  return resultFrom({ nodes: base.nodes, groups }, {
    ok: true,
    changed: true,
    reason: "extracted",
    removedGroupIds,
    exposedNodeIds,
  });
};

export const normalizeImageLayoutState = <N extends ImageLayoutNodeLike>(
  state: ImageLayoutState<N>,
): ImageLayoutMutationResult<N> => {
  const normalized = sanitizeState(state);
  return resultFrom(normalized, {
    ok: true,
    changed: normalized.changed,
    reason: "normalized",
    removedGroupIds: normalized.removedGroupIds,
    exposedNodeIds: normalized.exposedNodeIds,
  });
};
