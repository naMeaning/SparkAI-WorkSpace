import type {
  ImageContainerKind,
  ImageContainerMemberBinding,
  ImageContainerSpec,
  WorkflowNode,
} from "./core.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";
import {
  applyImageContainerCompatibility,
  cloneImageContainerCollection,
  imageContainerBindingsForNodeAssets,
  imageContainerSpecForNode,
  nodeUsesImageContainer,
  sanitizeImageContainerCollection,
  uniqueImageContainerIds,
} from "./image-container-spec.ts";

/**
 * Canonical image-container topology and canvas projection.
 *
 * ImageContainerSpec remains the persisted source of truth. Layout groups are
 * a presentation state machine and may only write back through the explicit
 * synchronization entry point in this module.
 */

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
    const requestedDirect = uniqueImageContainerIds(source.memberNodeIds, node.id).filter(eligible);
    const childCandidates = uniqueImageContainerIds([
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
      ...imageContainerBindingsForNodeAssets(node, node.id, source.memberBindings),
      ...memberNodeIds.flatMap((memberId) => {
        const member = nodeById.get(memberId);
        return member ? imageContainerBindingsForNodeAssets(
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
    const requested = uniqueImageContainerIds(group.memberNodeIds, host.id).filter((id) => {
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
      collection: cloneImageContainerCollection(base?.collection ?? host.imageCollection),
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
    const directBindings = imageContainerBindingsForNodeAssets(node, nodeId, spec?.memberBindings ?? []);
    if (!spec) return directBindings;
    const memberBindings = spec.memberNodeIds.flatMap((memberId) => {
      const member = nodeById.get(memberId);
      return member ? imageContainerBindingsForNodeAssets(
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
      ? sanitizeImageContainerCollection(spec.collection, undefined, node.assets ?? [])
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
  sourceNodeById?: ReadonlyMap<string, WorkflowNode>,
): ImageContainerMemberBinding[] {
  const nodeById = sourceNodeById ?? new Map(sourceNodes.map((node) => [node.id, node]));
  const collect = (nodeId: string, active = new Set<string>()): ImageContainerMemberBinding[] => {
    if (active.has(nodeId)) return [];
    const node = nodeById.get(nodeId);
    if (!node || node.type !== "image" || node.layerGroup) return [];
    const nextActive = new Set(active).add(nodeId);
    const spec = imageContainerSpecForNode(node);
    const direct = [
      ...imageContainerBindingsForNodeAssets(node, nodeId, spec?.memberBindings ?? []),
      ...(spec?.memberNodeIds ?? []).flatMap((memberId) => {
        const member = nodeById.get(memberId);
        return member && member.type === "image" && !member.layerGroup
          ? imageContainerBindingsForNodeAssets(
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
    const requested = uniqueImageContainerIds([legacy.hostNodeId, ...(legacy.memberNodeIds ?? [])]).filter(eligible);
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
    return uniqueImageContainerIds([
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
