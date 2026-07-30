"use strict";

const { statSync } = require("node:fs");
const path = require("node:path");

const maximumGoalBindings = 200;
const maximumGoalConcurrency = 10;
const goalScopeExecutionValue = "all-goal-sources";

function cleanId(value, maximum = 520) {
  return String(value || "").trim().slice(0, maximum);
}

function cleanIds(items, maximum = maximumGoalBindings) {
  return (Array.isArray(items) ? items : [])
    .map((value) => cleanId(value))
    .filter(Boolean)
    .slice(0, maximum);
}

function normalizeGoalTaskScopeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const operationsPerAsset = Number(value.operationsPerAsset);
  const requestCount = Number(value.requestCount);
  const rawCommercePlanHash = value.commercePlanHash;
  const commercePlanHash = typeof rawCommercePlanHash === "string" && /^commerce-[a-f0-9]{32}$/.test(rawCommercePlanHash)
    ? rawCommercePlanHash
    : undefined;
  if (
    value.version !== 1 || value.target !== "all-image-containers" || value.frozen !== true ||
    typeof value.operationsPerAsset !== "number" || !Number.isSafeInteger(operationsPerAsset) || operationsPerAsset < 1 || operationsPerAsset > maximumGoalBindings ||
    typeof value.requestCount !== "number" || !Number.isSafeInteger(requestCount) || requestCount < 1 || requestCount > maximumGoalBindings ||
    (rawCommercePlanHash !== undefined && !commercePlanHash)
  ) return undefined;
  return {
    version: Number(value.version),
    target: cleanId(value.target, 80),
    frozen: value.frozen === true,
    containerIds: cleanIds(value.containerIds),
    bindingIds: cleanIds(value.bindingIds),
    containerCount: Math.max(0, Math.floor(Number(value.containerCount) || 0)),
    bindingCount: Math.max(0, Math.floor(Number(value.bindingCount) || 0)),
    configuredConcurrency: Math.max(1, Math.floor(Number(value.configuredConcurrency) || 1)),
    probeContainerCount: Math.max(1, Math.floor(Number(value.probeContainerCount) || 1)),
    operationsPerAsset,
    requestCount,
    ...(commercePlanHash ? { commercePlanHash } : {})
  };
}

function sameOrderedIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueIds(items) {
  return new Set(items).size === items.length;
}

function goalScopeError(message, code = "NAIMAGE_GOAL_SCOPE_INVALID") {
  const error = new Error(message);
  error.code = code;
  error.failureKind = "validation";
  return error;
}

function validateFrozenGoalTaskScope(scope, rawScope = scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw goalScopeError("Goal 执行缺少 TaskScope。", "NAIMAGE_GOAL_SCOPE_MISSING");
  }
  if (scope.origin !== "goal") {
    throw goalScopeError("scopeExecution=all-goal-sources 只允许用于 Goal TaskScope。", "NAIMAGE_GOAL_SCOPE_REQUIRED");
  }
  const goal = scope.goal;
  if (
    !goal || goal.version !== 1 || goal.target !== "all-image-containers" ||
    goal.frozen !== true
  ) {
    throw goalScopeError("Goal TaskScope 必须是 frozen=true 的 all-image-containers v1 快照。", "NAIMAGE_GOAL_SCOPE_NOT_FROZEN");
  }
  if (scope.scopeType !== "container-group" || scope.resultPolicy !== "grouped-by-container") {
    throw goalScopeError("Goal TaskScope 必须使用 container-group 与 grouped-by-container。", "NAIMAGE_GOAL_SCOPE_POLICY_INVALID");
  }
  if (scope.truncated === true) {
    throw goalScopeError("Goal TaskScope 已截断，禁止派发可能漏图的批量任务。", "NAIMAGE_GOAL_SCOPE_TRUNCATED");
  }

  const sources = Array.isArray(scope.sourceAssets) ? scope.sourceAssets : [];
  const sourceNodeIds = Array.isArray(scope.sourceNodeIds) ? scope.sourceNodeIds.map((value) => cleanId(value, 160)) : [];
  const sourceBindingIds = Array.isArray(scope.sourceBindingIds) ? scope.sourceBindingIds : [];
  const sourceContainerIds = Array.isArray(scope.sourceContainerIds) ? scope.sourceContainerIds : [];
  const referenceAssets = Array.isArray(scope.referenceAssets) ? scope.referenceAssets : [];
  const referenceBindingIds = Array.isArray(scope.referenceBindingIds) ? scope.referenceBindingIds : [];
  const referenceContainerIds = Array.isArray(scope.referenceContainerIds) ? scope.referenceContainerIds : [];
  if (!sources.length || sources.length > maximumGoalBindings) {
    throw goalScopeError(`Goal TaskScope 必须包含 1-${maximumGoalBindings} 个 SOURCE binding。`, "NAIMAGE_GOAL_BINDING_COUNT_INVALID");
  }
  if (referenceAssets.length || referenceBindingIds.length || referenceContainerIds.length) {
    throw goalScopeError("Goal v1 不接受额外 REFERENCE；运行时只展开冻结的 SOURCE binding。", "NAIMAGE_GOAL_REFERENCE_UNSUPPORTED");
  }
  if (!sourceContainerIds.length || sourceContainerIds.length > maximumGoalBindings || !uniqueIds(sourceContainerIds)) {
    throw goalScopeError("Goal TaskScope 的容器 ID 必须非空且唯一。", "NAIMAGE_GOAL_CONTAINER_IDS_INVALID");
  }
  if (!sourceNodeIds.length || sourceNodeIds.some((value) => !value) || !uniqueIds(sourceNodeIds)) {
    throw goalScopeError("Goal TaskScope 的 SOURCE 节点 ID 必须非空且唯一。", "NAIMAGE_GOAL_NODE_IDS_INVALID");
  }
  const bindingIds = sources.map((source) => cleanId(source?.bindingId));
  if (bindingIds.some((value) => !value) || !uniqueIds(bindingIds)) {
    throw goalScopeError("Goal TaskScope 的每个 SOURCE 都必须有唯一 bindingId。", "NAIMAGE_GOAL_BINDING_IDS_INVALID");
  }
  if (!sameOrderedIds(bindingIds, sourceBindingIds) || !sameOrderedIds(bindingIds, goal.bindingIds)) {
    throw goalScopeError("Goal metadata、sourceBindingIds 与 SOURCE binding 顺序不一致。", "NAIMAGE_GOAL_BINDING_MISMATCH");
  }
  if (!sameOrderedIds(sourceContainerIds, goal.containerIds)) {
    throw goalScopeError("Goal metadata 与 sourceContainerIds 不一致。", "NAIMAGE_GOAL_CONTAINER_MISMATCH");
  }
  if (
    goal.bindingCount !== sources.length || goal.containerCount !== sourceContainerIds.length ||
    Number(scope.sourceAssetCount) !== sources.length || Number(scope.referenceAssetCount || 0) !== 0
  ) {
    throw goalScopeError("Goal TaskScope 的冻结计数与实际素材不一致。", "NAIMAGE_GOAL_COUNT_MISMATCH");
  }
  if (
    !Number.isInteger(goal.configuredConcurrency) || goal.configuredConcurrency < 1 ||
    goal.configuredConcurrency > maximumGoalConcurrency
  ) {
    throw goalScopeError(`Goal 并发必须是 1-${maximumGoalConcurrency} 的整数。`, "NAIMAGE_GOAL_CONCURRENCY_INVALID");
  }
  if (
    !Number.isInteger(goal.probeContainerCount) || goal.probeContainerCount < 1 ||
    goal.probeContainerCount > 2 || goal.probeContainerCount > goal.configuredConcurrency ||
    goal.probeContainerCount > goal.bindingCount
  ) {
    throw goalScopeError("Goal 探针必须是 1-2 个母图代表项，且不能超过并发或 SOURCE 数量。", "NAIMAGE_GOAL_PROBE_INVALID");
  }
  if (
    !Number.isSafeInteger(goal.operationsPerAsset) || goal.operationsPerAsset < 1 ||
    goal.operationsPerAsset > maximumGoalBindings ||
    !Number.isSafeInteger(goal.requestCount) || goal.requestCount < 1 ||
    goal.requestCount > maximumGoalBindings ||
    goal.requestCount !== goal.bindingCount * goal.operationsPerAsset
  ) {
    throw goalScopeError("Goal TaskScope 的冻结操作数或请求总数无效。", "NAIMAGE_GOAL_REQUEST_COUNT_INVALID");
  }
  if (goal.commercePlanHash !== undefined && !/^commerce-[a-f0-9]{32}$/.test(goal.commercePlanHash)) {
    throw goalScopeError("Goal TaskScope 的 commercePlanHash 无效。", "NAIMAGE_COMMERCE_PLAN_HASH_INVALID");
  }

  const representedContainers = new Set();
  const representedNodeIds = [];
  const representedNodes = new Set();
  for (const source of sources) {
    const assetId = cleanId(source?.assetId, 160);
    const nodeId = cleanId(source?.nodeId, 160);
    const ownerNodeId = cleanId(source?.ownerNodeId, 160);
    const containerId = cleanId(source?.containerId, 160);
    const localPath = String(source?.path || "").trim();
    if (!assetId || !nodeId || !ownerNodeId || nodeId !== ownerNodeId || !containerId || !localPath || localPath.includes("\u0000")) {
      throw goalScopeError(
        `Goal SOURCE ${cleanId(source?.bindingId) || "<missing>"} 缺少一致的 assetId、nodeId、ownerNodeId、containerId 或本地路径。`,
        "NAIMAGE_GOAL_SOURCE_INCOMPLETE"
      );
    }
    let validLocalFile = false;
    try {
      validLocalFile = path.isAbsolute(localPath) && statSync(localPath).isFile();
    } catch {
      validLocalFile = false;
    }
    if (!validLocalFile) {
      throw goalScopeError(`Goal SOURCE ${source.bindingId} 的本地文件不可读。`, "NAIMAGE_GOAL_SOURCE_PATH_INVALID");
    }
    if (!sourceNodeIds.includes(nodeId)) {
      throw goalScopeError(`Goal SOURCE ${source.bindingId} 指向未冻结的节点 ${nodeId}。`, "NAIMAGE_GOAL_SOURCE_NODE_INVALID");
    }
    if (!sourceContainerIds.includes(containerId)) {
      throw goalScopeError(`Goal SOURCE ${source.bindingId} 指向未冻结的容器 ${containerId}。`, "NAIMAGE_GOAL_SOURCE_CONTAINER_INVALID");
    }
    if (!representedNodes.has(nodeId)) {
      representedNodes.add(nodeId);
      representedNodeIds.push(nodeId);
    }
    representedContainers.add(containerId);
  }
  if (!sameOrderedIds(sourceNodeIds, representedNodeIds)) {
    throw goalScopeError("Goal TaskScope 的 sourceNodeIds 与 SOURCE 节点顺序不一致。", "NAIMAGE_GOAL_NODE_MISMATCH");
  }
  if (representedContainers.size !== sourceContainerIds.length) {
    throw goalScopeError("Goal TaskScope 中存在没有 SOURCE binding 的冻结容器。", "NAIMAGE_GOAL_CONTAINER_EMPTY");
  }

  const rawSnapshotHash = cleanId(rawScope?.snapshotHash, 96).toLowerCase();
  const normalizedSnapshotHash = cleanId(scope.snapshotHash, 96).toLowerCase();
  if (!/^scope-[a-f0-9]{32}$/.test(rawSnapshotHash) || rawSnapshotHash !== normalizedSnapshotHash) {
    throw goalScopeError("Goal TaskScope snapshotHash 缺失或与冻结材料不一致。", "NAIMAGE_GOAL_HASH_MISMATCH");
  }
  return { goal, sources };
}

function goalSourceJobs(scope) {
  const { goal, sources } = validateFrozenGoalTaskScope(scope);
  const selectedIndexes = new Set();
  const jobs = [];
  for (const containerId of goal.containerIds) {
    if (jobs.length >= goal.probeContainerCount) break;
    const index = sources.findIndex((source, sourceIndex) => (
      !selectedIndexes.has(sourceIndex) && source.containerId === containerId
    ));
    if (index < 0) {
      throw goalScopeError(`Goal 探针容器 ${containerId} 没有可执行 SOURCE。`, "NAIMAGE_GOAL_PROBE_SOURCE_MISSING");
    }
    selectedIndexes.add(index);
    jobs.push({ source: sources[index], sourceIndex: index, probeRepresentative: true });
  }
  for (let sourceIndex = 0; jobs.length < goal.probeContainerCount && sourceIndex < sources.length; sourceIndex += 1) {
    if (selectedIndexes.has(sourceIndex)) continue;
    selectedIndexes.add(sourceIndex);
    jobs.push({ source: sources[sourceIndex], sourceIndex, probeRepresentative: true });
  }
  sources.forEach((source, sourceIndex) => {
    if (selectedIndexes.has(sourceIndex)) return;
    jobs.push({ source, sourceIndex, probeRepresentative: false });
  });
  return jobs;
}

module.exports = {
  goalScopeExecutionValue,
  maximumGoalBindings,
  maximumGoalConcurrency,
  normalizeGoalTaskScopeMetadata,
  validateFrozenGoalTaskScope,
  goalSourceJobs
};
