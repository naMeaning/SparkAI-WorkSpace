import { normalizeProjectKnowledgeAsset, normalizeProjectKnowledgeEntry, normalizeProjectKnowledgeScope, normalizeProjectKnowledgeSnapshot } from "./project-knowledge-contract.mjs";
import { normalizeRequirementTemplateSnapshot } from "./requirement-template-contract.mjs";

export const contextTargetKey = target => JSON.stringify([target?.assetId, target?.occurrenceId, target?.contentHash]);
export const knowledgeTypeLabel = type => ({ brand_rule: "品牌规范", product_fact: "商品事实", prohibited_expression: "禁用表达", style_reference: "风格基准", preference: "创作偏好" })[type] || "项目知识";
export const knowledgeStatusLabel = status => ({ active: "已生效", suggested: "待确认建议", inactive: "已停用", deleted: "已删除" })[status] || "待确认";
export const knowledgeScopeLabel = scope => ({ project: "本项目", product: "商品", variant: "变体", sku: "SKU" })[scope?.type] || "本项目";
const scopeKey = scope => JSON.stringify([scope.type, scope.productId, scope.variantId, scope.skuId]);
export function knowledgeScopeOptions(snapshot) {
  const options = new Map([[scopeKey({ type: "project" }), { scope: { type: "project" }, label: "本项目" }]]);
  for (const option of snapshot?.scopeOptions || []) options.set(scopeKey(option.scope), option);
  for (const entry of snapshot?.entries || []) if (!options.has(scopeKey(entry.scope))) options.set(scopeKey(entry.scope), { scope: entry.scope, label: `${knowledgeScopeLabel(entry.scope)} · ${entry.title}` });
  return [...options.values()];
}
export const emptyKnowledgeDraft = () => ({ title: "", content: "", type: "brand_rule", scope: { type: "project" }, source: "user", assetRefs: [] });
export function knowledgeDraftFor(entry) {
  return entry ? { title: entry.title, content: entry.content, type: entry.type, scope: { ...entry.scope }, source: entry.source, assetRefs: entry.assetRefs.map(target => ({ ...target })) } : emptyKnowledgeDraft();
}
export function knowledgeInputFromDraft(draft, { projectId, revision, entry }) {
  const title = draft.title.trim(), content = draft.content.trim();
  if (!title || !content) throw new Error("请填写知识名称和内容。");
  if (title.length > 120 || content.length > 4000) throw new Error("知识名称最多 120 字，内容最多 4000 字。");
  if (draft.type === "style_reference" && !draft.assetRefs.length) throw new Error("请先检索并选择已采用成果，作为风格基准。");
  if (draft.assetRefs.length > 8) throw new Error("风格基准最多选择 8 项已采用成果。");
  return { expectedProjectId: projectId, expectedRevision: revision, ...(entry ? { knowledgeId: entry.knowledgeId, expectedEntryRevision: entry.revision } : {}),
    entry: { title, content, type: draft.type, scope: draft.scope, source: draft.source, assetRefs: draft.assetRefs } };
}
export const emptyResultSearchDraft = () => ({ text: "", usage: "", objectId: "", adoption: "any", descriptionText: "", descriptionSource: "any", source: null, sort: "relevance" });
export function resultSearchInput(draft, projectId, offset = 0) {
  const query = {};
  for (const key of ["text", "usage", "objectId"]) if (draft[key]?.trim()) query[key] = draft[key].trim();
  if (draft.adoption !== "any") query.adoption = draft.adoption;
  if (draft.descriptionText.trim()) query.description = { text: draft.descriptionText.trim(), source: draft.descriptionSource };
  if (draft.source) query.source = { assetId: draft.source.assetId, occurrenceId: draft.source.occurrenceId, contentHash: draft.source.contentHash };
  return { expectedProjectId: projectId, query, offset, limit: 20, sort: draft.sort };
}
export const resultObservationLabel = value => ({ observed: "AI 已观察", unobserved: "尚未观察", stale: "观察已过期" })[value?.status] || "尚未观察";
export const resultAdoptionLabel = value => value?.recordedState === "approved" && !value.current ? "采用待复核" : ({ approved: "已采用", candidate: "候选", rejected: "已拒绝" })[value?.state] || "候选";
export function resultReasonText(reason) {
  const label = ({ observed: "AI 观察描述", intended: "原创作要求", label: "成果名称", "user-label": "用户标签", requirements: "用途要求", catalog: "商品资料", provenance: "来源关系", metadata: "本地成果" })[reason.source] || "匹配信息";
  const value = reason.field === "adoption" ? ({ approved: "已采用", candidate: "候选", rejected: "已拒绝" })[reason.value] || "候选" : reason.value;
  return `${label}：${value}`;
}

const identifier = value => typeof value === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value) ? value : "";
const displayText = (value, maximum = 4000) => typeof value === "string" ? value.slice(0, maximum).replace(/\u0000/g, "")
  .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]")
  .replace(/\/(?:Users|home|tmp|private|mnt|var|workspace)\/[^\s<>"']+/g, "[路径已隐藏]")
  .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]")
  .replace(/\b(?:sk-[a-z0-9_-]{12,}|Bearer\s+[^\s<>"']+)/gi, "[凭据已隐藏]") : "";
const count = (value, maximum, fallback = 0) => Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback;
const strings = (value, limit, maximum) => Array.isArray(value) ? value.slice(0, limit).map(item => displayText(item, maximum)).filter(Boolean) : [];
function projectedEntry(value) {
  const entry = normalizeProjectKnowledgeEntry(value);
  // Fingerprints retain the owner's exact content; refuse unsafe forged entries
  // rather than inventing another knowledge revision for a display snapshot.
  if (!entry || displayText(entry.title, 120) !== entry.title || displayText(entry.content) !== entry.content) return undefined;
  return { ...entry, ...(typeof value.usable === "boolean" ? { usable: value.usable } : {}),
    ...(Array.isArray(value.invalidReasons) ? { invalidReasons: value.invalidReasons.slice(0, 12).map(identifier).filter(Boolean) } : {}) };
}
function projectedResult(value) {
  const target = normalizeProjectKnowledgeAsset(value?.target), nodeId = identifier(value?.nodeId);
  if (!target || !nodeId || !Number.isSafeInteger(value.assetIndex) || value.assetIndex < 0) return undefined;
  const observationStatus = ["observed", "unobserved", "stale"].includes(value.observation?.status) ? value.observation.status : "unobserved";
  const observationSummary = observationStatus === "observed" ? displayText(value.observation?.summary) : "";
  const adoptionState = ["approved", "candidate", "rejected"].includes(value.adoption?.state) ? value.adoption.state : "candidate";
  return { target, nodeId, assetIndex: value.assetIndex,
    locations: (Array.isArray(value.locations) ? value.locations : []).slice(0, 8).flatMap(item => identifier(item?.nodeId) && Number.isSafeInteger(item.assetIndex) && item.assetIndex >= 0 ? [{ nodeId: item.nodeId, assetIndex: item.assetIndex }] : []),
    name: displayText(value.name, 180) || "项目成果", tags: strings(value.tags, 40, 120), usage: strings(value.usage, 40, 240),
    objects: (Array.isArray(value.objects) ? value.objects : []).slice(0, 40).flatMap(item => identifier(item?.id) && identifier(item?.productId) && ["product", "variant", "sku"].includes(item.type) ? [{ type: item.type, id: item.id, productId: item.productId, label: displayText(item.label, 180) }] : []),
    sources: (Array.isArray(value.sources) ? value.sources : []).slice(0, 40).flatMap(item => { const source = normalizeProjectKnowledgeAsset(item?.target); return source ? [{ target: source, ...(identifier(item.nodeId) ? { nodeId: item.nodeId } : {}), relation: displayText(item.relation, 80) }] : []; }),
    intended: displayText(value.intended), observation: { status: observationStatus, ...(observationSummary ? { summary: observationSummary } : {}) },
    adoption: { state: adoptionState, current: value.adoption?.current === true, ...(value.adoption?.recordedState === "approved" ? { recordedState: "approved" } : {}) },
    summary: displayText(value.summary), ...(value.width > 0 ? { width: count(value.width, 1_000_000) } : {}), ...(value.height > 0 ? { height: count(value.height, 1_000_000) } : {}), createdAt: displayText(value.createdAt, 40),
    matchReasons: (Array.isArray(value.matchReasons) ? value.matchReasons : []).slice(0, 12).map(item => ({ field: identifier(item?.field), source: identifier(item?.source), value: displayText(item?.value, 180) })) };
}

/** A bounded display DTO shared by the primary and detached Agent windows. */
export function projectContextWindowProjection(value) {
  if (!value || !identifier(value.projectId) || !identifier(value.conversationId) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.entries)) return null;
  const entries = value.entries.slice(0, 500).map(projectedEntry).filter(Boolean);
  const normalizedUsed = normalizeProjectKnowledgeSnapshot(value.usedKnowledge, { expectedProjectId: value.projectId });
  const usedKnowledge = normalizedUsed && normalizedUsed.entries.every(entry => projectedEntry(entry)) ? normalizedUsed : undefined;
  const usedTemplate = normalizeRequirementTemplateSnapshot(value.usedTemplate);
  const search = value.search?.projectId === value.projectId && Array.isArray(value.search.results) ? {
    projectId: value.projectId, total: count(value.search.total, 20_000), offset: count(value.search.offset, 20_000), limit: count(value.search.limit, 50, 20) || 20,
    hasMore: value.search.hasMore === true, results: value.search.results.slice(0, 50).map(projectedResult).filter(Boolean) } : undefined;
  return { projectId: value.projectId, conversationId: value.conversationId, revision: value.revision, entries, total: count(value.total, 20_000, entries.length),
    objects: (Array.isArray(value.objects) ? value.objects : []).slice(0, 40).map(normalizeProjectKnowledgeScope).filter(Boolean),
    ...(Number.isSafeInteger(value.nextOffset) && value.nextOffset >= 0 ? { nextOffset: Math.min(20_000, value.nextOffset) } : {}),
    scopeOptions: (Array.isArray(value.scopeOptions) ? value.scopeOptions : []).slice(0, 200).flatMap(option => { const scope = normalizeProjectKnowledgeScope(option?.scope); return scope ? [{ scope, label: displayText(option.label, 180) || knowledgeScopeLabel(scope) }] : []; }),
    scopeOptionsTruncated: value.scopeOptionsTruncated === true, ...(usedKnowledge ? { usedKnowledge } : {}),
    ...(usedTemplate ? { usedTemplate: { ...usedTemplate, variableValues: Object.fromEntries(Object.entries(usedTemplate.variableValues).map(([key, val]) => [key, typeof val === "number" ? val : displayText(val)])) } } : {}), ...(search ? { search } : {}) };
}
