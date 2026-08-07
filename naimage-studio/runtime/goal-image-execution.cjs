"use strict";

const { statSync } = require("node:fs");
const path = require("node:path");
const commerceCatalogSchema = require("../plugins/commerce-catalog-schema.json");

const maximumGoalBindings = 200;
const maximumGoalConcurrency = 10;
const goalScopeExecutionValue = "all-goal-sources";
const maximumBrandReferencesPerSource = commerceCatalogSchema.limits.maxBrandReferencesPerSource;
const maximumBrandColors = commerceCatalogSchema.limits.maxBrandColors;
const maximumBrandFontLength = commerceCatalogSchema.limits.maxBrandFontLength;
const maximumBrandRuleLength = commerceCatalogSchema.limits.maxBrandRuleLength;
const brandReferenceRoles = new Set(commerceCatalogSchema.brandStyle.referenceRoles);

function cleanId(value, maximum = 520) {
  return String(value || "").trim().slice(0, maximum);
}

function cleanIds(items, maximum = maximumGoalBindings) {
  return (Array.isArray(items) ? items : [])
    .map((value) => cleanId(value))
    .filter(Boolean)
    .slice(0, maximum);
}

function normalizeCommerceBrandStyle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || value.enabled !== true) return undefined;
  const rawColors = Array.isArray(value.colors) ? value.colors : [];
  const colors = [...new Set(rawColors.map((item) => cleanId(item, 7).toLowerCase()))];
  const rawReferences = Array.isArray(value.references) ? value.references : [];
  const references = rawReferences.map((reference) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) return undefined;
    const linkId = cleanId(reference.linkId, 48).toLowerCase();
    const assetId = cleanId(reference.assetId, 160);
    const contentHash = cleanId(reference.contentHash, 128).toLowerCase();
    const nodeId = cleanId(reference.nodeId, 160);
    const assetIndex = Number(reference.assetIndex);
    const role = cleanId(reference.role, 32).toLowerCase();
    const purpose = cleanId(reference.purpose, 320);
    if (
      !/^material-[a-f0-9]{32}$/.test(linkId) || !assetId || !/^[a-f0-9]{32,128}$/.test(contentHash) || !nodeId ||
      !Number.isInteger(assetIndex) || assetIndex < 0 || !brandReferenceRoles.has(role) || !purpose
    ) return undefined;
    return { linkId, assetId, contentHash, nodeId, assetIndex, role, purpose };
  });
  if (
    colors.length !== rawColors.length || colors.length > maximumBrandColors || colors.some((item) => !/^#[a-f0-9]{6}$/.test(item)) ||
    references.some((item) => !item) || references.length > maximumBrandReferencesPerSource ||
    new Set(references.map((item) => item?.linkId)).size !== references.length
  ) return undefined;
  const fontFamily = cleanId(value.fontFamily, maximumBrandFontLength);
  const logoUsage = cleanId(value.logoUsage, maximumBrandRuleLength);
  const modelAppearance = cleanId(value.modelAppearance, maximumBrandRuleLength);
  const productAppearance = cleanId(value.productAppearance, maximumBrandRuleLength);
  const visualStyle = cleanId(value.visualStyle, maximumBrandRuleLength);
  return {
    version: 1,
    enabled: true,
    ...(fontFamily ? { fontFamily } : {}),
    colors,
    ...(logoUsage ? { logoUsage } : {}),
    ...(modelAppearance ? { modelAppearance } : {}),
    ...(productAppearance ? { productAppearance } : {}),
    ...(visualStyle ? { visualStyle } : {}),
    references
  };
}

function commerceBrandStylePrompt(value) {
  const style = normalizeCommerceBrandStyle(value);
  if (!style) return "";
  return [
    "品牌风格锁定（来自可信 SKU 商品素材库，必须逐项遵守）：",
    style.fontFamily ? `- 字体规范：${style.fontFamily}` : "",
    style.colors.length ? `- 品牌色板：${style.colors.join("、")}；除必要的商品真实色与中性色外，不得擅自替换主品牌色。` : "",
    style.logoUsage ? `- Logo：${style.logoUsage}` : "",
    style.modelAppearance ? `- 模特一致性：${style.modelAppearance}` : "",
    style.productAppearance ? `- 商品外观：${style.productAppearance}` : "",
    style.visualStyle ? `- 整体视觉语言：${style.visualStyle}` : "",
    style.references.length ? `- 本请求附带 ${style.references.length} 张已冻结品牌参考素材；只按各自 role/purpose 使用，不得互相替代。` : "",
    "- 槽位、语言或场景变化不得重新设计上述品牌身份与商品不变量。"
  ].filter(Boolean).join("\n");
}

function normalizeCommerceCatalogGoalTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const bindingId = cleanId(value.bindingId);
  const catalogId = cleanId(value.catalogId, 48).toLowerCase();
  const productId = cleanId(value.productId, 48).toLowerCase();
  const ownerType = cleanId(value.ownerType, 24).toLowerCase();
  const ownerId = cleanId(value.ownerId, 48).toLowerCase();
  const sourceLinkId = cleanId(value.sourceLinkId, 48).toLowerCase();
  const catalogRevision = Number(value.catalogRevision);
  const productRevision = Number(value.productRevision);
  const rawBrandStyle = value.brandStyle;
  const brandStyle = rawBrandStyle === undefined ? undefined : normalizeCommerceBrandStyle(rawBrandStyle);
  const ownerIdValid = ownerType === "product"
    ? /^product-[a-f0-9]{32}$/.test(ownerId) && ownerId === productId
    : ownerType === "variant"
      ? /^variant-[a-f0-9]{32}$/.test(ownerId)
      : ownerType === "sku" && /^sku-[a-f0-9]{32}$/.test(ownerId);
  if (
    !bindingId || !/^catalog-[a-f0-9]{32}$/.test(catalogId) || !/^product-[a-f0-9]{32}$/.test(productId) ||
    !ownerIdValid || !/^material-[a-f0-9]{32}$/.test(sourceLinkId) ||
    !Number.isSafeInteger(catalogRevision) || catalogRevision < 0 ||
    !Number.isSafeInteger(productRevision) || productRevision < 1 || (rawBrandStyle !== undefined && !brandStyle)
  ) return undefined;
  return {
    bindingId,
    catalogId,
    catalogRevision,
    productId,
    productRevision,
    ownerType,
    ownerId,
    sourceLinkId,
    ...(brandStyle ? { brandStyle } : {})
  };
}

function normalizeGoalTaskScopeMetadata(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackBindingIds = cleanIds(fallback.bindingIds);
  const fallbackContainerIds = cleanIds(fallback.containerIds);
  const bindingIds = fallbackBindingIds.length ? fallbackBindingIds : cleanIds(source.bindingIds);
  const containerIds = fallbackContainerIds.length ? fallbackContainerIds : cleanIds(source.containerIds);
  const rawOperationsPerAsset = Number(source.operationsPerAsset);
  const fallbackOperationsPerAsset = Number(fallback.operationsPerAsset);
  const operationsPerAsset = Number.isSafeInteger(rawOperationsPerAsset) && rawOperationsPerAsset >= 1 && rawOperationsPerAsset <= maximumGoalBindings
    ? rawOperationsPerAsset
    : Number.isSafeInteger(fallbackOperationsPerAsset) && fallbackOperationsPerAsset >= 1 && fallbackOperationsPerAsset <= maximumGoalBindings
      ? fallbackOperationsPerAsset
      : 1;
  const configuredConcurrency = Math.max(1, Math.min(
    maximumGoalConcurrency,
    Math.floor(Number(source.configuredConcurrency || fallback.configuredConcurrency) || 1)
  ));
  const maximumProbeCount = Math.max(1, Math.min(2, configuredConcurrency, bindingIds.length || 1));
  const probeContainerCount = Math.max(1, Math.min(
    maximumProbeCount,
    Math.floor(Number(source.probeContainerCount || fallback.probeContainerCount) || maximumProbeCount)
  ));
  const requestCount = bindingIds.length * operationsPerAsset;
  const rawCommercePlanHash = String(fallback.commercePlanHash || source.commercePlanHash || "").trim().toLowerCase();
  const commercePlanHash = /^commerce-[a-f0-9]{32}$/.test(rawCommercePlanHash) ? rawCommercePlanHash : undefined;
  const normalizedTargets = Array.isArray(source.commerceCatalogTargets)
    ? source.commerceCatalogTargets.map(normalizeCommerceCatalogGoalTarget).filter(Boolean)
    : [];
  const targetsByBindingId = new Map();
  for (const target of normalizedTargets) {
    if (!bindingIds.includes(target.bindingId) || targetsByBindingId.has(target.bindingId)) continue;
    targetsByBindingId.set(target.bindingId, target);
  }
  const commerceCatalogTargets = commercePlanHash
    ? bindingIds.flatMap((bindingId) => targetsByBindingId.has(bindingId) ? [targetsByBindingId.get(bindingId)] : [])
    : [];
  return {
    version: 1,
    target: "all-image-containers",
    frozen: true,
    containerIds,
    bindingIds,
    containerCount: containerIds.length,
    bindingCount: bindingIds.length,
    configuredConcurrency,
    probeContainerCount,
    operationsPerAsset,
    requestCount,
    ...(commercePlanHash ? { commercePlanHash } : {}),
    ...(commerceCatalogTargets.length ? { commerceCatalogTargets } : {})
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
  const commerceCatalogTargets = Array.isArray(goal.commerceCatalogTargets) ? goal.commerceCatalogTargets : [];
  const commerceTargetBindings = commerceCatalogTargets.map((target) => target.bindingId);
  if (
    commerceCatalogTargets.length > goal.bindingCount ||
    new Set(commerceTargetBindings).size !== commerceTargetBindings.length ||
    commerceTargetBindings.some((bindingId) => !goal.bindingIds.includes(bindingId)) ||
    commerceTargetBindings.some((bindingId, index) => bindingId !== goal.bindingIds.filter((id) => commerceTargetBindings.includes(id))[index]) ||
    (commerceCatalogTargets.length > 0 && !goal.commercePlanHash)
  ) {
    throw goalScopeError("Goal TaskScope 的 Commerce Catalog 目标与冻结 SOURCE binding 不一致。", "NAIMAGE_COMMERCE_CATALOG_TARGET_INVALID");
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
  maximumBrandReferencesPerSource,
  normalizeGoalTaskScopeMetadata,
  normalizeCommerceCatalogGoalTarget,
  normalizeCommerceBrandStyle,
  commerceBrandStylePrompt,
  validateFrozenGoalTaskScope,
  goalSourceJobs
};
