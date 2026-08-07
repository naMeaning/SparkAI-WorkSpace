import { agentTaskScopeSnapshotHash } from "./core.ts";
import type {
  AgentTaskConfirmationPolicy,
  AgentTaskResultPolicy,
  AgentTaskScope,
  AgentTaskScopeType,
  TaskAssetReference
} from "./core.ts";

export function cloneAgentTaskScope(scope: AgentTaskScope): AgentTaskScope {
  return {
    ...scope,
    sourceNodeIds: [...scope.sourceNodeIds],
    sourceContainerIds: [...scope.sourceContainerIds],
    referenceContainerIds: [...scope.referenceContainerIds],
    sourceBindingIds: [...scope.sourceBindingIds],
    referenceBindingIds: [...scope.referenceBindingIds],
    sourceAssets: scope.sourceAssets.map((asset) => ({ ...asset })),
    referenceAssets: scope.referenceAssets.map((asset) => ({ ...asset })),
    requirement: scope.requirement ? { ...scope.requirement } : undefined,
    goal: scope.goal
      ? {
          ...scope.goal,
          containerIds: [...scope.goal.containerIds],
          bindingIds: [...scope.goal.bindingIds],
          commerceCatalogTargets: scope.goal.commerceCatalogTargets?.map((target) => ({
            ...target,
            ...(target.brandStyle ? {
              brandStyle: {
                ...target.brandStyle,
                colors: [...target.brandStyle.colors],
                references: target.brandStyle.references.map((reference) => ({ ...reference }))
              }
            } : {})
          }))
        }
      : undefined
  };
}

export function isFrozenGoalTaskScope(scope: AgentTaskScope | undefined): boolean {
  return Boolean(scope && (
    scope.origin === "goal" ||
    scope.goal?.target === "all-image-containers"
  ));
}

export function mergeAgentTaskScopes(base: AgentTaskScope | undefined, added: AgentTaskScope): AgentTaskScope {
  if (!base) return cloneAgentTaskScope(added);
  if (isFrozenGoalTaskScope(base) || isFrozenGoalTaskScope(added)) {
    const baseMaterialHash = agentTaskScopeSnapshotHash(base);
    const addedMaterialHash = agentTaskScopeSnapshotHash(added);
    if (
      isFrozenGoalTaskScope(base) &&
      isFrozenGoalTaskScope(added) &&
      baseMaterialHash === addedMaterialHash
    ) {
      return { ...cloneAgentTaskScope(base), snapshotHash: baseMaterialHash };
    }
    throw new Error("Goal TaskScope 是冻结的全画布容器快照，不能隐式合并或追加素材；请显式创建新的 Goal。");
  }
  const mergeAssets = (left: TaskAssetReference[], right: TaskAssetReference[], limit: number) => {
    const seen = new Set<string>();
    return [...left, ...right].filter((item, index) => {
      const key = item.bindingId
        ? `binding:${item.bindingId}`
        : item.occurrenceId
          ? `occurrence:${item.occurrenceId}`
          : item.contentHash
            ? `content:${item.contentHash}`
            : item.relativePath
              ? `relative:${item.relativePath.replace(/\\/g, "/").toLowerCase()}`
              : item.path
                ? `path:${item.path.replace(/\\/g, "/").toLowerCase()}`
                : item.assetId
                  ? `asset:${item.assetId}`
                  : `slot:${item.nodeId || item.containerId || item.role}:${item.containerSlot ?? item.assetIndex ?? index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit).map((item) => ({ ...item }));
  };
  const sourceAssets = mergeAssets(base.sourceAssets, added.sourceAssets, 200);
  const referenceAssets = mergeAssets(base.referenceAssets, added.referenceAssets, 40);
  const mergeIds = (left: string[], right: string[], limit: number) => [...new Set([...left, ...right])].slice(0, limit);
  const scopeType: AgentTaskScopeType = base.scopeType === "none"
    ? added.scopeType
    : added.scopeType === "none" || base.scopeType === added.scopeType
      ? base.scopeType
      : base.scopeType === "container-group" || added.scopeType === "container-group"
        ? "container-group"
        : base.scopeType === "layer-group" || added.scopeType === "layer-group"
          ? "layer-group"
          : base.scopeType === "layer" || added.scopeType === "layer"
            ? "mixed"
            : sourceAssets.length > 1 ? "multi-source" : "single";
  const resultPolicy: AgentTaskResultPolicy = base.resultPolicy === "layer-variants" || added.resultPolicy === "layer-variants"
    ? "layer-variants"
    : base.resultPolicy === "grouped-by-container" || added.resultPolicy === "grouped-by-container"
      ? "grouped-by-container"
      : sourceAssets.length > 1 || base.resultPolicy === "grouped-by-source" || added.resultPolicy === "grouped-by-source"
        ? "grouped-by-source"
        : "single";
  const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
    version: 2,
    origin: base.origin,
    scopeType,
    canvasRevision: Math.max(base.canvasRevision, added.canvasRevision),
    sourceNodeIds: [...new Set([...base.sourceNodeIds, ...added.sourceNodeIds])].slice(0, 200),
    sourceContainerIds: mergeIds(base.sourceContainerIds, added.sourceContainerIds, 200),
    referenceContainerIds: mergeIds(base.referenceContainerIds, added.referenceContainerIds, 40),
    sourceBindingIds: mergeIds(base.sourceBindingIds, added.sourceBindingIds, 200),
    referenceBindingIds: mergeIds(base.referenceBindingIds, added.referenceBindingIds, 40),
    sourceAssets,
    referenceAssets,
    resultPolicy,
    confirmationPolicy: base.confirmationPolicy !== "auto" ? base.confirmationPolicy : added.confirmationPolicy,
    requirement: base.requirement ? { ...base.requirement } : added.requirement ? { ...added.requirement } : undefined,
    sourceAssetCount: Math.max(sourceAssets.length, Number(base.sourceAssetCount || 0), Number(added.sourceAssetCount || 0)),
    referenceAssetCount: Math.max(referenceAssets.length, Number(base.referenceAssetCount || 0), Number(added.referenceAssetCount || 0)),
    truncated: base.truncated === true || added.truncated === true
  };
  return { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) };
}

export function resolveAgentTaskScopeContinuation(
  frozen: AgentTaskScope | undefined,
  live: AgentTaskScope,
  addsAssets: boolean
): AgentTaskScope {
  // AskUser clarification/confirmation resumes the exact immutable task even
  // if earlier preview results or unrelated user actions advanced the canvas.
  // Only an explicit SOURCE/REFERENCE upload is allowed to extend and re-hash
  // that scope.
  return frozen && !addsAssets
    ? cloneAgentTaskScope(frozen)
    : mergeAgentTaskScopes(frozen, live);
}

export function withAgentTaskScopeConfirmationPolicy(
  scope: AgentTaskScope,
  policy: AgentTaskConfirmationPolicy | undefined
): AgentTaskScope {
  if (!policy || policy === "auto" || scope.confirmationPolicy === policy) return cloneAgentTaskScope(scope);
  const clone = cloneAgentTaskScope(scope);
  const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
    ...clone,
    confirmationPolicy: policy
  };
  delete (scopeWithoutHash as Partial<AgentTaskScope>).snapshotHash;
  return { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) };
}
