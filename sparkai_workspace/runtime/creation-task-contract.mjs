const clean = (value, maximum = 160) => typeof value === "string" ? value.replace(/[\r\n\0]/g, " ").trim().slice(0, maximum) : "";
const strings = (value, maximum = 40) => (Array.isArray(value) ? value : []).map(item => clean(item, 2000)).filter(Boolean).slice(0, maximum);
const identity = value => ({ assetId: clean(value?.assetId), occurrenceId: clean(value?.occurrenceId, 80), contentHash: clean(value?.contentHash, 128).toLowerCase() });

export function normalizeCreationMaskAssets(value) {
  return (Array.isArray(value) ? value : []).slice(0, 200).map(mask => ({
    ...identity(mask), target: identity(mask?.target), path: clean(mask?.path, 32767),
    relativePath: clean(mask?.relativePath, 1000).replace(/\\/g, "/"),
    mimeType: clean(mask?.mimeType, 100).toLowerCase(), name: "区域修改蒙版",
    width: Number(mask?.width), height: Number(mask?.height)
  })).filter(mask => mask.assetId && mask.occurrenceId && /^[a-f0-9]{64}$/.test(mask.contentHash) &&
    mask.target.assetId && mask.target.occurrenceId && /^[a-f0-9]{64}$/.test(mask.target.contentHash) && mask.path &&
    mask.relativePath && !/^(?:[a-z]:|\/)/i.test(mask.relativePath) && !mask.relativePath.split("/").some(part => !part || part === "." || part === "..") &&
    mask.mimeType === "image/png" && Number.isSafeInteger(mask.width) && mask.width > 0 && Number.isSafeInteger(mask.height) && mask.height > 0);
}

export function normalizeCreationTaskContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const requirementId = clean(value.requirementId);
  const revision = Number(value.revision);
  if (!requirementId || !Number.isSafeInteger(revision) || revision < 1) return undefined;
  const result = { requirementId, revision, fingerprint: clean(value.fingerprint, 128) };
  const plan = value.revisionPlan;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    result.revisionPlan = {
      revisionId: clean(plan.revisionId),
      baselineReviewIds: strings(plan.baselineReviewIds, 200),
      preserve: strings(plan.preserve),
      changes: strings(plan.changes),
      targets: (Array.isArray(plan.targets) ? plan.targets : []).slice(0, 200).map(target => ({
        assetId: clean(target?.assetId), occurrenceId: clean(target?.occurrenceId, 80),
        contentHash: clean(target?.contentHash, 128).toLowerCase(), nodeId: clean(target?.nodeId),
        ...(target?.mask && typeof target.mask === "object" ? { mask: identity(target.mask) } : {}),
        ...(clean(target?.label, 200) ? { label: clean(target.label, 200) } : {}),
        ...(Array.isArray(target?.preserve) ? { preserve: strings(target.preserve) } : {}),
        ...(Array.isArray(target?.changes) ? { changes: strings(target.changes) } : {}),
        ...(clean(target?.slotId) ? { slotId: clean(target.slotId) } : {}),
        ...(Number.isSafeInteger(target?.expectedRevision) && target.expectedRevision >= 1 ? { expectedRevision: target.expectedRevision } : {})
      }))
    };
  }
  return result;
}
