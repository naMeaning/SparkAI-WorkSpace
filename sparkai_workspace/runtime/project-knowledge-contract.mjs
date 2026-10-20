export const PROJECT_KNOWLEDGE_LIMITS = Object.freeze({ maxEntries: 24, maxCharacters: 12_000,
  maxContentCharacters: 4_000, maxTitleCharacters: 120, maxAssetsPerEntry: 8, maxObjects: 32 });
export const PROJECT_KNOWLEDGE_TYPES = Object.freeze(["brand_rule", "product_fact", "prohibited_expression", "style_reference", "preference"]);
export const PROJECT_KNOWLEDGE_STATUSES = Object.freeze(["active", "suggested", "inactive", "deleted"]);

const object = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = value => typeof value === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value) ? value : "";
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const text = (value, maximum) => typeof value === "string" && value.trim() && value.length <= maximum && !value.includes("\0") ? value.trim() : "";
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;

// The same deterministic checksum runs in Main, Renderer and session cleaning.
// It is an identity checksum; Main additionally checks refs against its history.
function checksum(value) {
  const input = JSON.stringify(canonical(value));
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067); h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213); h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ h1 >>> 18, 597399067); h2 = Math.imul(h4 ^ h2 >>> 22, 2869860233);
  h3 = Math.imul(h1 ^ h3 >>> 17, 951274213); h4 = Math.imul(h2 ^ h4 >>> 19, 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map(part => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

export function normalizeProjectKnowledgeScope(value) {
  if (!object(value)) return undefined;
  if (value.type === "project" && !value.productId && !value.variantId && !value.skuId) return { type: "project" };
  const productId = id(value.productId);
  if (!productId) return undefined;
  if (value.type === "product" && !value.variantId && !value.skuId) return { type: "product", productId };
  if (value.type === "variant" && id(value.variantId) && !value.skuId) return { type: "variant", productId, variantId: value.variantId };
  if (value.type === "sku" && id(value.skuId) && !value.variantId) return { type: "sku", productId, skuId: value.skuId };
  return undefined;
}

export function normalizeProjectKnowledgeAsset(value) {
  return object(value) && id(value.assetId) && id(value.occurrenceId) && /^[a-f0-9]{64}$/.test(value.contentHash || "")
    ? { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash } : undefined;
}

function catalogReference(value) {
  if (!object(value) || !id(value.catalogId) || !id(value.productId) || !integer(value.catalogRevision) ||
    !integer(value.productRevision, 1) || !["product", "brandStyle", "variant", "sku"].includes(value.field)) return undefined;
  if (value.ownerRevision !== undefined && !integer(value.ownerRevision, 1)) return undefined;
  return { catalogId: value.catalogId, catalogRevision: value.catalogRevision, productId: value.productId,
    productRevision: value.productRevision, field: value.field, ...(value.ownerRevision ? { ownerRevision: value.ownerRevision } : {}) };
}

function entryMaterial(value) {
  if (!object(value) || !id(value.knowledgeId) || !integer(value.revision, 1) || !PROJECT_KNOWLEDGE_TYPES.includes(value.type) ||
    !["user", "assumption"].includes(value.source) || !PROJECT_KNOWLEDGE_STATUSES.includes(value.status)) return undefined;
  if (value.source === "assumption" && value.status === "active") return undefined;
  const title = text(value.title, PROJECT_KNOWLEDGE_LIMITS.maxTitleCharacters);
  const content = text(value.content, PROJECT_KNOWLEDGE_LIMITS.maxContentCharacters);
  const scope = normalizeProjectKnowledgeScope(value.scope);
  if (!title || !content || !scope || !["project_knowledge", "commerce_catalog"].includes(value.authority)) return undefined;
  if (!Array.isArray(value.assetRefs) || value.assetRefs.length > PROJECT_KNOWLEDGE_LIMITS.maxAssetsPerEntry) return undefined;
  const assetRefs = value.assetRefs.map(normalizeProjectKnowledgeAsset);
  if (assetRefs.some(asset => !asset) || new Set(assetRefs.map(asset => JSON.stringify(asset))).size !== assetRefs.length) return undefined;
  const catalogRef = value.authority === "commerce_catalog" ? catalogReference(value.catalogRef) : undefined;
  if (value.authority === "commerce_catalog" && (!catalogRef || value.source !== "user")) return undefined;
  return { knowledgeId: value.knowledgeId, revision: value.revision, type: value.type, title, content, scope, source: value.source,
    status: value.status, authority: value.authority, assetRefs, ...(catalogRef ? { catalogRef, readOnly: true } : {}) };
}

export function projectKnowledgeEntryFingerprint(value) {
  const material = entryMaterial(value);
  return material ? `knowledge-entry-${checksum(material)}` : "";
}

export function normalizeProjectKnowledgeEntry(value) {
  const material = entryMaterial(value);
  return material && value.fingerprint === projectKnowledgeEntryFingerprint(material) ? { ...material, fingerprint: value.fingerprint } : undefined;
}

function snapshotMaterial(value) {
  if (!object(value) || value.version !== 1 || !id(value.projectId) || !integer(value.revision) ||
    !Array.isArray(value.objects) || value.objects.length > PROJECT_KNOWLEDGE_LIMITS.maxObjects ||
    !Array.isArray(value.entries) || value.entries.length > PROJECT_KNOWLEDGE_LIMITS.maxEntries) return undefined;
  const objects = value.objects.map(normalizeProjectKnowledgeScope), entries = value.entries.map(normalizeProjectKnowledgeEntry);
  if (objects.some(scope => !scope || scope.type === "project") || new Set(objects.map(scope => JSON.stringify(scope))).size !== objects.length ||
    entries.some(entry => !entry || entry.status !== "active" || entry.source !== "user") ||
    new Set(entries.map(entry => entry.knowledgeId)).size !== entries.length) return undefined;
  const budget = value.budget;
  const usedCharacters = entries.reduce((total, entry) => total + entry.title.length + entry.content.length, 0);
  if (!object(budget) || !integer(budget.maxEntries, 0, PROJECT_KNOWLEDGE_LIMITS.maxEntries) ||
    !integer(budget.maxCharacters, 0, PROJECT_KNOWLEDGE_LIMITS.maxCharacters) || !integer(budget.omittedEntries) ||
    entries.length > budget.maxEntries || usedCharacters > budget.maxCharacters || budget.usedCharacters !== usedCharacters) return undefined;
  const summary = entries.map(entry => entry.title).join("；").slice(0, 400);
  if (value.summary !== summary) return undefined;
  return { version: 1, projectId: value.projectId, revision: value.revision, objects, entries,
    budget: { maxEntries: budget.maxEntries, maxCharacters: budget.maxCharacters, usedCharacters, omittedEntries: budget.omittedEntries }, summary };
}

export function projectKnowledgeSnapshotFingerprint(value) {
  const material = snapshotMaterial(value);
  return material ? `knowledge-${checksum(material)}` : "";
}

export function normalizeProjectKnowledgeSnapshot(value, { expectedProjectId } = {}) {
  const material = snapshotMaterial(value);
  return material && (!expectedProjectId || material.projectId === expectedProjectId) &&
    value.fingerprint === projectKnowledgeSnapshotFingerprint(material) ? { ...material, fingerprint: value.fingerprint } : undefined;
}

export function projectKnowledgeReceipt(value) {
  const snapshot = normalizeProjectKnowledgeSnapshot(value);
  if (!snapshot) return undefined;
  return { version: 1, projectId: snapshot.projectId, revision: snapshot.revision, fingerprint: snapshot.fingerprint,
    objects: snapshot.objects, entries: snapshot.entries.map(({ knowledgeId, revision, fingerprint, authority, catalogRef }) =>
      ({ knowledgeId, revision, fingerprint, authority, ...(catalogRef ? { catalogRef } : {}) })),
    summary: snapshot.summary, omittedEntries: snapshot.budget.omittedEntries };
}

export function normalizeProjectKnowledgeReceipt(value) {
  if (!object(value) || value.version !== 1 || !id(value.projectId) || !integer(value.revision) || !/^knowledge-[a-f0-9]{32}$/.test(value.fingerprint || "") ||
    typeof value.summary !== "string" || value.summary.length > 400 || !integer(value.omittedEntries) ||
    !Array.isArray(value.objects) || value.objects.length > PROJECT_KNOWLEDGE_LIMITS.maxObjects ||
    !Array.isArray(value.entries) || value.entries.length > PROJECT_KNOWLEDGE_LIMITS.maxEntries) return undefined;
  const objects = value.objects.map(normalizeProjectKnowledgeScope);
  if (objects.some(scope => !scope || scope.type === "project")) return undefined;
  const entries = value.entries.map(entry => {
    if (!object(entry) || !id(entry.knowledgeId) || !integer(entry.revision, 1) || !/^knowledge-entry-[a-f0-9]{32}$/.test(entry.fingerprint || "") ||
      !["project_knowledge", "commerce_catalog"].includes(entry.authority)) return undefined;
    const catalogRef = entry.authority === "commerce_catalog" ? catalogReference(entry.catalogRef) : undefined;
    if (entry.authority === "commerce_catalog" && !catalogRef) return undefined;
    return { knowledgeId: entry.knowledgeId, revision: entry.revision, fingerprint: entry.fingerprint, authority: entry.authority,
      ...(catalogRef ? { catalogRef } : {}) };
  });
  if (entries.some(entry => !entry) || new Set(entries.map(entry => entry.knowledgeId)).size !== entries.length) return undefined;
  return { version: 1, projectId: value.projectId, revision: value.revision, fingerprint: value.fingerprint, objects, entries,
    summary: value.summary, omittedEntries: value.omittedEntries };
}

export function projectKnowledgePromptText(value) {
  const snapshot = normalizeProjectKnowledgeSnapshot(value);
  if (!snapshot?.entries.length) return "";
  const scopeLabels = { project: "本项目", product: "指定商品", variant: "指定变体", sku: "指定 SKU" };
  return ["本次采用的项目长期要求（已冻结）", "优先级：用户本次明确要求 > 项目长期偏好 > 当前会话经验。商品事实和品牌来源须保留；若明确要求与事实矛盾，解释冲突并按需要使用 ask_user，不得编造或静默改写事实。",
    ...snapshot.entries.map(entry => `- ${entry.title}（${scopeLabels[entry.scope.type]}；${entry.authority === "commerce_catalog" ? "商品库已保存资料" : "用户明确保存"}）：${entry.content}${entry.assetRefs.length ? ` [已绑定基准 ${entry.assetRefs.length} 项；仍须沿素材 owner 校验及使用]` : ""}`),
    ...(snapshot.budget.omittedEntries ? [`上下文预算省略了 ${snapshot.budget.omittedEntries} 项；本次只采用以上内容。`] : [])].join("\n");
}
