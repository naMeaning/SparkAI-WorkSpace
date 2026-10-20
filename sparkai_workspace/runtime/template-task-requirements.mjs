/** Resolve portable source variables only against this task's frozen materials. */
export function templateTaskRequirements(draft, scope) {
  if (!draft) return undefined;
  if (draft.unboundImages?.some(variable => variable.required !== false)) throw new Error("模板图片变量尚未绑定，请选择本项目素材后执行。");
  if (!draft.creationRequirements) return undefined;
  const materials = scope.materials || [...scope.sourceAssets, ...scope.referenceAssets];
  const criteria = values => (values || []).map(value => {
    const { sourceVariables, ...criterion } = value;
    if (!sourceVariables?.length) return criterion;
    const sources = sourceVariables.flatMap(key => {
      const binding = draft.imageBindings.find(item => item.key === key);
      const found = binding && materials.filter(item => item.nodeId === binding.nodeId || item.ownerNodeId === binding.nodeId);
      if (!found?.length || found.some(item => !item.assetId || !item.occurrenceId || !/^[a-f0-9]{64}$/.test(item.contentHash || ""))) throw new Error("模板来源变量未绑定到本次冻结的受管图片。");
      return found.map(({ assetId, occurrenceId, contentHash }) => ({ assetId, occurrenceId, contentHash }));
    });
    return { ...criterion, sourceTargets: [...new Map(sources.map(item => [JSON.stringify(item), item])).values()] };
  });
  return { ...draft.creationRequirements, preserve: criteria(draft.creationRequirements.preserve), adjustable: criteria(draft.creationRequirements.adjustable), conditions: criteria(draft.creationRequirements.conditions) };
}
