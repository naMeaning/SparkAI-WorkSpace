import { agentTaskScopeSnapshotHash } from "./core.ts";
import type {
  AgentTaskConfirmationPolicy,
  AgentTaskScope,
  ImageAsset,
  ImageContainerMemberBinding,
  TaskAssetReference,
  WorkflowNode,
} from "./core.ts";
import {
  imageContainerBindingsForNodeAssets,
  imageContainerSpecForNode,
  nodeUsesImageContainer,
} from "./image-container-spec.ts";
import {
  normalizeCommerceCatalogGoalTarget,
  type CommerceCatalogGoalTarget,
} from "./commerce-catalog.ts";

export const MAX_GOAL_TASK_SCOPE_BINDINGS = 200;
export const MAX_GOAL_TASK_SCOPE_CONCURRENCY = 10;

export type GoalTaskScopeExcludedReason = "reference-only" | "empty" | "generating";

export type GoalTaskScopeExcludedContainer = {
  containerId: string;
  reason: GoalTaskScopeExcludedReason;
  bindingCount: number;
};

export type GoalTaskScopeIssueCode =
  | "invalid-concurrency"
  | "invalid-probe-count"
  | "invalid-operation-count"
  | "invalid-commerce-plan-hash"
  | "invalid-target"
  | "invalid-container-graph"
  | "no-eligible-containers"
  | "too-many-bindings"
  | "too-many-requests"
  | "duplicate-binding-id"
  | "missing-binding-identity"
  | "missing-asset-identity"
  | "missing-asset-locator"
  | "binding-asset-mismatch"
  | "asset-adapter-failed";

export type GoalTaskScopeIssue = {
  code: GoalTaskScopeIssueCode;
  message: string;
  containerId?: string;
  bindingId?: string;
  nodeId?: string;
  assetIndex?: number;
};

export type GoalTaskAssetProjectionInput = {
  containerNode: WorkflowNode;
  ownerNode: WorkflowNode;
  asset: ImageAsset;
  binding: ImageContainerMemberBinding;
  containerSlot: number;
};

export type GoalTaskScopeOptions = {
  canvasRevision: number;
  configuredConcurrency: number;
  /** Optional explicit image/container boundaries. Omit to target every canvas container. */
  targetNodeIds?: readonly string[];
  /** One or two SOURCE representatives. Defaults to two, bounded by configured concurrency. */
  probeContainerCount?: number;
  /** User-confirmed output count for each frozen SOURCE binding. */
  operationsPerAsset?: number;
  /** Trusted commerce plan identity, omitted for ordinary Goal tasks. */
  commercePlanHash?: string;
  confirmationPolicy?: AgentTaskConfirmationPolicy;
  /** Optional Renderer adapter for labels/MIME metadata; frozen identities are enforced here. */
  projectAsset?: (input: GoalTaskAssetProjectionInput) => Partial<TaskAssetReference>;
};

export type GoalTaskScopePreflight = {
  ok: boolean;
  target: "all-image-containers";
  discoveredContainerIds: string[];
  topLevelContainerIds: string[];
  eligibleContainerIds: string[];
  eligibleBindingIds: string[];
  discoveredContainerCount: number;
  eligibleContainerCount: number;
  eligibleBindingCount: number;
  excludedContainers: GoalTaskScopeExcludedContainer[];
  sourceAssets: TaskAssetReference[];
  configuredConcurrency: number;
  probeContainerCount: number;
  operationsPerAsset: number;
  requestCount: number;
  commercePlanHash?: string;
  issues: GoalTaskScopeIssue[];
};

export type GoalTaskScopeBuildResult =
  | { ok: true; scope: AgentTaskScope; preflight: GoalTaskScopePreflight }
  | { ok: false; preflight: GoalTaskScopePreflight };

type ProjectedBinding = {
  containerNode: WorkflowNode;
  ownerNode: WorkflowNode;
  asset?: ImageAsset;
  binding: ImageContainerMemberBinding;
  containerSlot: number;
};

const cleanId = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const uniqueProjectedNodes = (nodes: readonly WorkflowNode[]): WorkflowNode[] => {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const id = cleanId(node.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const effectiveBindingRole = (
  binding: ImageContainerMemberBinding,
  ownerNode: WorkflowNode | undefined,
): "source" | "reference" => {
  if (binding.role === "reference" || binding.role === "source") return binding.role;
  const asset = ownerNode?.assets?.[binding.assetIndex];
  if (asset?.taskRole === "reference" || asset?.taskRole === "source") return asset.taskRole;
  return ownerNode?.imageContainerRole === "reference" ? "reference" : "source";
};

const assetMatchesBinding = (asset: ImageAsset, binding: ImageContainerMemberBinding): boolean => {
  const occurrenceId = cleanId(asset.occurrenceId).toLowerCase();
  const assetId = cleanId(asset.assetId);
  if (binding.occurrenceId && occurrenceId) return binding.occurrenceId.toLowerCase() === occurrenceId;
  if (binding.assetId && assetId) return binding.assetId === assetId;
  return false;
};

const assetForBinding = (
  ownerNode: WorkflowNode | undefined,
  binding: ImageContainerMemberBinding,
): ImageAsset | undefined => {
  const assets = ownerNode?.assets ?? [];
  const exactSlot = assets[binding.assetIndex];
  if (exactSlot && (assetMatchesBinding(exactSlot, binding) || (!exactSlot.assetId && !exactSlot.occurrenceId))) {
    return exactSlot;
  }
  if (binding.occurrenceId) {
    const occurrenceMatches = assets.filter((asset) => cleanId(asset.occurrenceId).toLowerCase() === binding.occurrenceId?.toLowerCase());
    if (occurrenceMatches.length === 1) return occurrenceMatches[0];
  }
  const assetMatches = assets.filter((asset) => cleanId(asset.assetId) === binding.assetId);
  return assetMatches.length === 1 ? assetMatches[0] : undefined;
};

const durableAssetLocator = (asset: ImageAsset): string => {
  const localPath = cleanId(asset.path);
  if (localPath && !localPath.includes("\u0000")) return localPath;
  const relativePath = cleanId(asset.relativePath);
  if (relativePath && !relativePath.includes("\u0000")) return relativePath;
  const url = cleanId(asset.assetUrl || asset.url);
  return url && !/^(?:blob|data):/i.test(url) && !url.includes("\u0000") ? url : "";
};

const projectedAssetReference = (
  projected: ProjectedBinding,
  adapter?: GoalTaskScopeOptions["projectAsset"],
): TaskAssetReference => {
  const { asset, binding, containerNode, ownerNode, containerSlot } = projected;
  if (!asset) throw new Error("Cannot project a missing Goal asset");
  const adapted = adapter?.({ containerNode, ownerNode, asset, binding, containerSlot }) ?? {};
  const ownerCode = cleanId(ownerNode.displayCode || ownerNode.id) || "IMG";
  return {
    ...adapted,
    bindingId: binding.bindingId,
    assetId: binding.assetId,
    occurrenceId: binding.occurrenceId || asset.occurrenceId,
    importBatchId: asset.importBatchId,
    importRootId: asset.importRootId,
    sourceRelativePath: asset.sourceRelativePath,
    sourceRootLabel: asset.sourceRootLabel,
    sourceRootKind: asset.sourceRootKind,
    displayCode: cleanId(adapted.displayCode || asset.displayCode) || `${ownerCode}${binding.assetIndex + 1}`,
    contentHash: asset.contentHash,
    role: "source",
    name: cleanId(adapted.name || asset.title || asset.originalName) || `${ownerCode}${binding.assetIndex + 1}`,
    assetIndex: binding.assetIndex,
    containerSlot,
    ownerAssetIndex: binding.assetIndex,
    ownerNodeId: ownerNode.id,
    nodeId: ownerNode.id,
    containerId: containerNode.id,
    path: asset.path,
    relativePath: asset.relativePath,
    assetUrl: asset.assetUrl || asset.url,
  };
};

const containerDescendantNodes = (
  containerId: string,
  nodeById: ReadonlyMap<string, WorkflowNode>,
  active = new Set<string>(),
): WorkflowNode[] => {
  if (active.has(containerId)) return [];
  const node = nodeById.get(containerId);
  if (!node) return [];
  const spec = imageContainerSpecForNode(node);
  const nextActive = new Set(active).add(containerId);
  return [
    node,
    ...(spec?.memberNodeIds ?? []).map((id) => nodeById.get(id)).filter((member): member is WorkflowNode => Boolean(member)),
    ...(spec?.childContainerNodeIds ?? []).flatMap((id) => containerDescendantNodes(id, nodeById, nextActive)),
  ];
};

const rawContainerBindings = (
  containerId: string,
  nodeById: ReadonlyMap<string, WorkflowNode>,
  active = new Set<string>(),
): ImageContainerMemberBinding[] => {
  if (active.has(containerId)) return [];
  const node = nodeById.get(containerId);
  if (!node || node.type !== "image" || node.layerGroup) return [];
  const spec = imageContainerSpecForNode(node);
  const nextActive = new Set(active).add(containerId);
  const direct = imageContainerBindingsForNodeAssets(node, node.id, spec?.memberBindings ?? []);
  const memberBindings = (spec?.memberNodeIds ?? []).flatMap((memberId) => {
    const member = nodeById.get(memberId);
    return member && member.type === "image" && !member.layerGroup
      ? imageContainerBindingsForNodeAssets(
          member,
          node.id,
          (spec?.memberBindings ?? []).filter((binding) => binding.nodeId === memberId && binding.containerNodeId === node.id),
        )
      : [];
  });
  const childBindings = (spec?.childContainerNodeIds ?? []).flatMap((childId) => (
    rawContainerBindings(childId, nodeById, nextActive)
  ));
  // Deliberately do not deduplicate by asset identity: every presentation slot
  // is an independent Goal operation, even when multiple slots share one blob.
  return [...direct, ...memberBindings, ...childBindings];
};

const topLevelContainers = (nodes: readonly WorkflowNode[], targetNodeIds?: readonly string[]): {
  discovered: WorkflowNode[];
  topLevel: WorkflowNode[];
  invalidGraph: boolean;
} => {
  const requestedIds = new Set((targetNodeIds ?? []).map(cleanId).filter(Boolean));
  const explicitTarget = requestedIds.size > 0;
  const discovered = uniqueProjectedNodes(nodes).filter((node) => (
    node.type === "image" && !node.layerGroup &&
    (explicitTarget
      ? requestedIds.has(node.id) && ((node.assets?.length ?? 0) > 0 || nodeUsesImageContainer(node))
      : nodeUsesImageContainer(node))
  ));
  const discoveredIds = new Set(discovered.map((node) => node.id));
  const nestedIds = new Set<string>();
  for (const node of discovered) {
    const spec = imageContainerSpecForNode(node);
    for (const childId of spec?.childContainerNodeIds ?? []) {
      if (discoveredIds.has(childId)) nestedIds.add(childId);
    }
    for (const memberId of spec?.memberNodeIds ?? []) {
      if (discoveredIds.has(memberId)) nestedIds.add(memberId);
    }
  }
  const topLevel = discovered.filter((node) => !nestedIds.has(node.id));
  return { discovered, topLevel, invalidGraph: discovered.length > 0 && topLevel.length === 0 };
};

export function preflightGoalTaskScope(
  projectedNodes: readonly WorkflowNode[],
  options: GoalTaskScopeOptions,
): GoalTaskScopePreflight {
  const issues: GoalTaskScopeIssue[] = [];
  const requestedConcurrency = Number(options.configuredConcurrency);
  const concurrencyIsValid = Number.isInteger(requestedConcurrency) && requestedConcurrency >= 1 && requestedConcurrency <= MAX_GOAL_TASK_SCOPE_CONCURRENCY;
  const configuredConcurrency = concurrencyIsValid ? requestedConcurrency : 1;
  if (!concurrencyIsValid) {
    issues.push({
      code: "invalid-concurrency",
      message: `Goal 并发必须是 1-${MAX_GOAL_TASK_SCOPE_CONCURRENCY} 的整数。`,
    });
  }
  const requestedProbeCount = options.probeContainerCount ?? Math.min(2, configuredConcurrency);
  const probeIsValid = Number.isInteger(requestedProbeCount) && requestedProbeCount >= 1 && requestedProbeCount <= 2 && requestedProbeCount <= configuredConcurrency;
  if (!probeIsValid) {
    issues.push({
      code: "invalid-probe-count",
      message: "Goal 探测批次必须包含 1-2 个母图代表项，且不能超过配置并发。",
    });
  }
  const requestedOperationsPerAsset = options.operationsPerAsset ?? 1;
  const operationsPerAssetIsValid = Number.isInteger(requestedOperationsPerAsset) && requestedOperationsPerAsset >= 1 && requestedOperationsPerAsset <= MAX_GOAL_TASK_SCOPE_BINDINGS;
  const operationsPerAsset = operationsPerAssetIsValid ? requestedOperationsPerAsset : 1;
  if (!operationsPerAssetIsValid) {
    issues.push({
      code: "invalid-operation-count",
      message: `Goal 每张母图的操作数必须是 1-${MAX_GOAL_TASK_SCOPE_BINDINGS} 的整数。`,
    });
  }
  const rawCommercePlanHash = String(options.commercePlanHash || "").trim();
  const commercePlanHash = /^commerce-[a-f0-9]{32}$/.test(rawCommercePlanHash) ? rawCommercePlanHash : undefined;
  if (rawCommercePlanHash && !commercePlanHash) {
    issues.push({
      code: "invalid-commerce-plan-hash",
      message: "跨境电商 Goal 缺少有效的 commercePlanHash。",
    });
  }

  const nodes = uniqueProjectedNodes(projectedNodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const topology = topLevelContainers(nodes, options.targetNodeIds);
  const requestedTargetIds = [...new Set((options.targetNodeIds ?? []).map(cleanId).filter(Boolean))];
  if (requestedTargetIds.length) {
    const discoveredTargetIds = new Set(topology.discovered.map((node) => node.id));
    for (const nodeId of requestedTargetIds) {
      if (discoveredTargetIds.has(nodeId)) continue;
      issues.push({
        code: "invalid-target",
        message: `Goal 指定的节点 ${nodeId} 不是可用的图片成果或图片容器。`,
        nodeId,
      });
    }
  }
  if (topology.invalidGraph) {
    issues.push({
      code: "invalid-container-graph",
      message: "图片容器图没有可识别的顶层边界，请先修复循环或重复父级。",
    });
  }

  const eligibleContainerIds: string[] = [];
  const eligibleBindingIds: string[] = [];
  const sourceAssets: TaskAssetReference[] = [];
  const excludedContainers: GoalTaskScopeExcludedContainer[] = [];
  const seenBindingIds = new Map<string, string>();

  for (const containerNode of topology.topLevel) {
    const descendants = containerDescendantNodes(containerNode.id, nodeById);
    const bindings = rawContainerBindings(containerNode.id, nodeById);
    if (descendants.some((node) => node.imageState === "generating" || Boolean(node.generationRunId && node.status === "working"))) {
      excludedContainers.push({ containerId: containerNode.id, reason: "generating", bindingCount: bindings.length });
      continue;
    }
    if (!bindings.length) {
      excludedContainers.push({ containerId: containerNode.id, reason: "empty", bindingCount: 0 });
      continue;
    }
    const sourceBindings = bindings
      .map((binding, containerSlot) => ({ binding, containerSlot, ownerNode: nodeById.get(binding.nodeId) }))
      .filter(({ binding, ownerNode }) => effectiveBindingRole(binding, ownerNode) === "source");
    if (!sourceBindings.length) {
      excludedContainers.push({ containerId: containerNode.id, reason: "reference-only", bindingCount: bindings.length });
      continue;
    }

    eligibleContainerIds.push(containerNode.id);
    for (const { binding, containerSlot, ownerNode } of sourceBindings) {
      const bindingId = cleanId(binding.bindingId);
      const ownerNodeId = cleanId(ownerNode?.id || binding.nodeId);
      if (!bindingId) {
        issues.push({
          code: "missing-binding-identity",
          message: `容器 ${containerNode.id} 的槽位 ${containerSlot + 1} 缺少 bindingId。`,
          containerId: containerNode.id,
          nodeId: ownerNodeId || undefined,
          assetIndex: binding.assetIndex,
        });
      } else {
        const previousContainerId = seenBindingIds.get(bindingId);
        if (previousContainerId) {
          issues.push({
            code: "duplicate-binding-id",
            message: `binding ${bindingId} 同时出现在容器 ${previousContainerId} 与 ${containerNode.id}。`,
            containerId: containerNode.id,
            bindingId,
            nodeId: ownerNodeId || undefined,
            assetIndex: binding.assetIndex,
          });
        } else {
          seenBindingIds.set(bindingId, containerNode.id);
        }
      }

      const asset = assetForBinding(ownerNode, binding);
      if (!ownerNode || !asset) {
        issues.push({
          code: "binding-asset-mismatch",
          message: `binding ${bindingId || `${containerNode.id}:${containerSlot + 1}`} 无法定位到画布素材槽位。`,
          containerId: containerNode.id,
          bindingId: bindingId || undefined,
          nodeId: ownerNodeId || undefined,
          assetIndex: binding.assetIndex,
        });
        continue;
      }
      if (!cleanId(asset.assetId) || !cleanId(binding.assetId)) {
        issues.push({
          code: "missing-asset-identity",
          message: `binding ${bindingId || `${containerNode.id}:${containerSlot + 1}`} 的素材缺少持久 assetId。`,
          containerId: containerNode.id,
          bindingId: bindingId || undefined,
          nodeId: ownerNode.id,
          assetIndex: binding.assetIndex,
        });
      }
      if (!durableAssetLocator(asset)) {
        issues.push({
          code: "missing-asset-locator",
          message: `binding ${bindingId || `${containerNode.id}:${containerSlot + 1}`} 缺少可重开的 path、relativePath 或 URL。`,
          containerId: containerNode.id,
          bindingId: bindingId || undefined,
          nodeId: ownerNode.id,
          assetIndex: binding.assetIndex,
        });
      }

      eligibleBindingIds.push(bindingId);
      try {
        sourceAssets.push(projectedAssetReference({
          containerNode,
          ownerNode,
          asset,
          binding,
          containerSlot,
        }, options.projectAsset));
      } catch (error) {
        issues.push({
          code: "asset-adapter-failed",
          message: `binding ${bindingId || `${containerNode.id}:${containerSlot + 1}`} 的项目素材投影失败：${error instanceof Error ? error.message : String(error)}`,
          containerId: containerNode.id,
          bindingId: bindingId || undefined,
          nodeId: ownerNode.id,
          assetIndex: binding.assetIndex,
        });
      }
    }
  }

  if (!eligibleContainerIds.length) {
    issues.push({
      code: "no-eligible-containers",
      message: "当前画布没有可进入 Goal 的非空 SOURCE 图片容器。",
    });
  }
  if (eligibleBindingIds.length > MAX_GOAL_TASK_SCOPE_BINDINGS) {
    issues.push({
      code: "too-many-bindings",
      message: `Goal 最多冻结 ${MAX_GOAL_TASK_SCOPE_BINDINGS} 个图片槽位，当前为 ${eligibleBindingIds.length} 个。`,
    });
  }
  const requestCount = eligibleBindingIds.length * operationsPerAsset;
  if (requestCount > MAX_GOAL_TASK_SCOPE_BINDINGS) {
    issues.push({
      code: "too-many-requests",
      message: `Goal 最多允许 ${MAX_GOAL_TASK_SCOPE_BINDINGS} 个图片请求，当前计划为 ${requestCount} 个。`,
    });
  }

  const effectiveProbeCount = eligibleContainerIds.length > 0
    ? Math.min(probeIsValid ? requestedProbeCount : 1, eligibleBindingIds.length)
    : 0;
  return {
    ok: issues.length === 0,
    target: "all-image-containers",
    discoveredContainerIds: topology.discovered.map((node) => node.id),
    topLevelContainerIds: topology.topLevel.map((node) => node.id),
    eligibleContainerIds,
    eligibleBindingIds,
    discoveredContainerCount: topology.discovered.length,
    eligibleContainerCount: eligibleContainerIds.length,
    eligibleBindingCount: eligibleBindingIds.length,
    excludedContainers,
    sourceAssets,
    configuredConcurrency,
    probeContainerCount: effectiveProbeCount,
    operationsPerAsset,
    requestCount,
    ...(commercePlanHash ? { commercePlanHash } : {}),
    issues,
  };
}

export function buildGoalTaskScopeFromNodes(
  projectedNodes: readonly WorkflowNode[],
  options: GoalTaskScopeOptions,
): GoalTaskScopeBuildResult {
  const preflight = preflightGoalTaskScope(projectedNodes, options);
  if (!preflight.ok) return { ok: false, preflight };
  const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
    version: 2,
    origin: "goal",
    scopeType: "container-group",
    canvasRevision: Math.max(0, Math.floor(Number(options.canvasRevision) || 0)),
    sourceNodeIds: [...new Set(preflight.sourceAssets.map((asset) => asset.ownerNodeId || asset.nodeId || "").filter(Boolean))],
    sourceContainerIds: [...preflight.eligibleContainerIds],
    referenceContainerIds: [],
    sourceBindingIds: [...preflight.eligibleBindingIds],
    referenceBindingIds: [],
    materials: preflight.sourceAssets.map((asset) => ({ ...asset })),
    sourceAssets: preflight.sourceAssets.map((asset) => ({ ...asset })),
    referenceAssets: [],
    resultPolicy: "grouped-by-container",
    confirmationPolicy: options.confirmationPolicy ?? "staged",
    goal: {
      version: 1,
      target: "all-image-containers",
      frozen: true,
      containerIds: [...preflight.eligibleContainerIds],
      bindingIds: [...preflight.eligibleBindingIds],
      containerCount: preflight.eligibleContainerCount,
      bindingCount: preflight.eligibleBindingCount,
      configuredConcurrency: preflight.configuredConcurrency,
      probeContainerCount: preflight.probeContainerCount,
      operationsPerAsset: preflight.operationsPerAsset,
      requestCount: preflight.requestCount,
      ...(preflight.commercePlanHash ? { commercePlanHash: preflight.commercePlanHash } : {}),
    },
    sourceAssetCount: preflight.eligibleBindingCount,
    referenceAssetCount: 0,
    truncated: false,
  };
  return {
    ok: true,
    scope: { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) },
    preflight,
  };
}

export function withGoalCommerceCatalogTargets(
  scope: AgentTaskScope,
  values: readonly CommerceCatalogGoalTarget[],
): AgentTaskScope {
  if (!values.length) return scope;
  if (scope.origin !== "goal" || !scope.goal?.commercePlanHash) {
    throw new Error("Catalog targets are only valid for a trusted Commerce Goal.");
  }
  const allowedBindings = new Set(scope.goal.bindingIds);
  const byBinding = new Map<string, CommerceCatalogGoalTarget>();
  for (const value of values) {
    const target = normalizeCommerceCatalogGoalTarget(value);
    if (!target || !allowedBindings.has(target.bindingId) || byBinding.has(target.bindingId)) {
      throw new Error("Commerce Goal Catalog targets contain an invalid, duplicate, or unknown SOURCE binding.");
    }
    byBinding.set(target.bindingId, target);
  }
  const commerceCatalogTargets = scope.goal.bindingIds.flatMap((bindingId) => {
    const target = byBinding.get(bindingId);
    return target ? [{
      ...target,
      ...(target.brandStyle ? {
        brandStyle: {
          ...target.brandStyle,
          colors: [...target.brandStyle.colors],
          references: target.brandStyle.references.map((reference) => ({ ...reference }))
        }
      } : {})
    }] : [];
  });
  const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
    ...scope,
    goal: {
      ...scope.goal,
      containerIds: [...scope.goal.containerIds],
      bindingIds: [...scope.goal.bindingIds],
      commerceCatalogTargets,
    },
  };
  delete (scopeWithoutHash as Partial<AgentTaskScope>).snapshotHash;
  return { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) };
}
