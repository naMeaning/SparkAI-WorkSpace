/** Explicitly authorized stable materials. Call the shared scope hasher after merging. */
export function bindProjectContextMaterials(scope, materials, role = "reference") {
  if (!scope || !["source", "reference"].includes(role) || !Array.isArray(materials) || materials.length > 40) throw new Error("项目素材绑定无效。");
  const identity = item => JSON.stringify([item.assetId, item.occurrenceId, item.contentHash]);
  const current = scope.materials || [...scope.sourceAssets, ...scope.referenceAssets];
  if (materials.some(item => current.some(existing => identity(existing) === identity(item) && existing.role !== role)))
    throw new Error("该成果已按另一用途冻结，请在新任务中明确调整素材用途。");
  const known = new Set(current.map(identity));
  const added = materials.filter(item => !known.has(identity(item))).map((item, index) => ({ ...item, role,
    displayCode: `${role === "source" ? "M" : "R"}${current.length + index + 1}`, ownerNodeId: item.nodeId, ownerAssetIndex: item.assetIndex, bindingId: `result:${item.assetId}:${item.occurrenceId}`, name: item.name || "项目成果" }));
  if (scope.origin === "goal" && added.length) throw new Error("运行中的Goal不能扩展素材范围。");
  const sources = [...scope.sourceAssets, ...(role === "source" ? added : [])], references = [...scope.referenceAssets, ...(role === "reference" ? added : [])];
  if (sources.length > 200 || references.length > 40) throw new Error("素材数量超过当前任务上限。");
  return { ...scope, materials: [...current, ...added], sourceAssets: sources, referenceAssets: references,
    sourceNodeIds: [...new Set([...scope.sourceNodeIds, ...(role === "source" ? added.map(item => item.nodeId) : [])])],
    sourceBindingIds: sources.map(item => item.bindingId).filter(Boolean), referenceBindingIds: references.map(item => item.bindingId).filter(Boolean),
    sourceAssetCount: sources.length, referenceAssetCount: references.length,
    scopeType: sources.length > 1 ? "multi-source" : sources.length === 1 ? "single" : scope.scopeType,
    resultPolicy: sources.length > 1 ? "grouped-by-source" : scope.resultPolicy };
}
