export const creationLines = value => String(value || "").split(/\r?\n/).map(item => item.trim()).filter(Boolean);
export const newCreationRowId = () => `user-${crypto.randomUUID()}`;
export function creationRequirementsDraft(value) {
  const rows = items => (items || []).map(item => ({ ...item, ...(item.slotIds ? { slotIds: [...item.slotIds] } : {}), ...(item.sourceTargets ? { sourceTargets: item.sourceTargets.map(target => ({ ...target })) } : {}) }));
  return { goal: { ...(value?.goal || { text: "", source: "user" }) }, usage: { ...(value?.usage || { text: "", source: "user" }) }, slots: rows(value?.slots),
    preserve: rows(value?.preserve), adjustable: rows(value?.adjustable), conditions: rows(value?.conditions),
    formats: value?.fileRules?.formats?.join(", ") || "", width: String(value?.fileRules?.width || ""), height: String(value?.fileRules?.height || ""),
    minWidth: String(value?.fileRules?.minWidth || ""), minHeight: String(value?.fileRules?.minHeight || ""), alpha: value?.fileRules?.alpha || "any" };
}
export function creationRequirementsFromDraft(draft) {
  const formats = draft.formats.split(/[,，\s]+/).map(value => value.toLowerCase()).filter(Boolean);
  if (formats.some(value => !["png", "jpeg", "webp", "avif", "tiff"].includes(value))) throw new Error("文件格式支持 png、jpeg、webp、avif、tiff。");
  for (const value of [draft.width, draft.height, draft.minWidth, draft.minHeight]) if (value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) throw new Error("尺寸须为 1 到 65535 的整数。");
  if (!draft.goal.text.trim()) throw new Error("请填写创作目标。");
  if (draft.slots.some(slot => !slot.label.trim() || slot.label.trim().length > 120)) throw new Error("交付项名称须为 1 到 120 字；不需要的交付项请明确移除。");
  const lists = [draft.preserve, draft.adjustable, draft.conditions];
  if (lists.some(list => list.length > 200) || lists.reduce((sum, list) => sum + list.length, 0) > 400) throw new Error("每类最多 200 条，全部条件合计最多 400 条。");
  if (lists.some(list => list.some(item => !item.text.trim() || item.text.trim().length > 4000))) throw new Error("每条要求须为 1 到 4000 字；不需要的要求请明确移除。");
  const criterion = values => values.map(value => ({ ...value, text: value.text.trim() }));
  return { goal: { ...draft.goal, text: draft.goal.text.trim() }, usage: { ...draft.usage, text: draft.usage.text.trim() },
    slots: draft.slots.map(slot => ({ ...slot, label: slot.label.trim() })), preserve: criterion(draft.preserve), adjustable: criterion(draft.adjustable), conditions: criterion(draft.conditions),
    fileRules: { formats: [...new Set(formats)], width: draft.width ? Number(draft.width) : undefined, height: draft.height ? Number(draft.height) : undefined,
      minWidth: draft.minWidth ? Number(draft.minWidth) : undefined, minHeight: draft.minHeight ? Number(draft.minHeight) : undefined, alpha: draft.alpha } };
}
export const creationDraftSignature = draft => JSON.stringify(creationRequirementsFromDraft(draft));
