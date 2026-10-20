"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { redactText } = require("./debug-command-service.cjs");
const { PROJECT_KNOWLEDGE_LIMITS: LIMITS, PROJECT_KNOWLEDGE_TYPES, normalizeProjectKnowledgeScope,
  normalizeProjectKnowledgeAsset, normalizeProjectKnowledgeEntry, projectKnowledgeEntryFingerprint,
  normalizeProjectKnowledgeSnapshot, projectKnowledgeSnapshotFingerprint, projectKnowledgeReceipt,
  normalizeProjectKnowledgeReceipt } = require("../runtime/project-knowledge-contract.mjs");

const MAX_STORE_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 500, MAX_HISTORY = 5_000;
const fail = (code, message) => Object.assign(new Error(message), { code });
const copy = value => JSON.parse(JSON.stringify(value));
const key = value => JSON.stringify(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const clean = value => redactText(String(value ?? "")).replace(/\u0000/g, "")
  .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]")
  .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]")
  .replace(/\/(?:Users|home|tmp|private|mnt|var|workspace)\/[^\s<>"']+/g, "[路径已隐藏]").trim();
const latest = document => [...new Map(document.history.map(entry => [entry.knowledgeId, entry])).values()];
const sameAsset = (left, right) => ["assetId", "occurrenceId", "contentHash"].every(field => left?.[field] === right?.[field]);
const specificity = scope => ({ project: 0, product: 1, variant: 2, sku: 3 })[scope.type];
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Long-term custom knowledge owns this file; Commerce facts remain in Catalog. */
function createProjectKnowledgeService({ projectFor, readSession, catalogService = null, projectRelativePath,
  resolveProjectRelativePath, onChange = () => {}, now = () => new Date().toISOString(),
  fileSystem = fs, metaDir = ".naimage" } = {}) {
  if (![projectFor, readSession, projectRelativePath, resolveProjectRelativePath].every(value => typeof value === "function"))
    throw new TypeError("project knowledge services are required");
  let taskResolver = () => null;
  const setTaskResolver = resolver => { taskResolver = typeof resolver === "function" ? resolver : () => null; };
  const projectOf = input => {
    const requested = input.expectedProjectId || input.projectId;
    if (!requested || input.expectedProjectId && input.projectId && input.expectedProjectId !== input.projectId)
      throw fail("KNOWLEDGE_PROJECT_MISMATCH", "项目知识必须属于当前明确项目。");
    const project = projectFor(requested);
    if (!project?.id || !project.path || project.id !== requested) throw fail("PROJECT_NOT_FOUND", "项目知识所属项目不存在。");
    return project;
  };
  const location = project => path.join(project.path, metaDir, "project-knowledge.json");
  const empty = project => ({ schemaVersion: 1, projectId: project.id, revision: 0, history: [] });
  function read(project) {
    if (!fileSystem.existsSync(location(project))) return empty(project);
    try {
      const bytes = fileSystem.readFileSync(location(project));
      if (bytes.length > MAX_STORE_BYTES) throw Error();
      const document = JSON.parse(bytes.toString("utf8"));
      if (document.schemaVersion !== 1 || document.projectId !== project.id || !Array.isArray(document.history) ||
        document.history.length > MAX_HISTORY || document.revision !== document.history.length) throw Error();
      const versions = new Map();
      for (const [index, entry] of document.history.entries()) {
        const normalized = normalizeProjectKnowledgeEntry(entry), previous = versions.get(entry.knowledgeId);
        if (!normalized || normalized.authority !== "project_knowledge" || entry.storeRevision !== index + 1 ||
          entry.revision !== (previous?.revision || 0) + 1 || !timestamp(entry.createdAt) || !timestamp(entry.updatedAt) ||
          previous?.status === "deleted" || previous?.source === "user" && entry.source !== "user") throw Error();
        versions.set(entry.knowledgeId, entry);
      }
      if (versions.size > MAX_ENTRIES) throw Error();
      return document;
    } catch { throw fail("KNOWLEDGE_STORE_INVALID", "项目知识无法读取，原记录已保留；没有执行或覆盖。"); }
  }
  function write(project, document) {
    const file = location(project), temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const bytes = JSON.stringify(document);
      if (document.history.length > MAX_HISTORY || Buffer.byteLength(bytes) > MAX_STORE_BYTES)
        throw fail("KNOWLEDGE_STORE_FULL", "项目知识历史已达本地容量上限，原记录未改变。");
      fileSystem.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fileSystem.openSync(temporary, "wx", 0o600);
      try { fileSystem.writeFileSync(fd, bytes); fileSystem.fsyncSync(fd); } finally { fileSystem.closeSync(fd); }
      fileSystem.renameSync(temporary, file);
    } catch (error) { error.knowledgePersistenceFailed = true; error.phase = "knowledge_save"; throw error; }
    finally { try { fileSystem.rmSync(temporary, { force: true }); } catch {} }
    try { onChange(project.id, document.revision); } catch {}
  }
  function catalogFor(project) {
    const catalog = catalogService?.readDocument ? catalogService.readDocument(project, { create: false })
      : catalogService?.list?.({ expectedProjectId: project.id })?.catalog;
    return catalog || { catalogId: "catalog-empty", revision: 0, products: [] };
  }
  function assertRevision(document, input) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== document.revision)
      throw fail("KNOWLEDGE_REVISION_CONFLICT", "项目知识已在其他窗口变化，请刷新后重试。");
  }
  function entryFor(document, input) {
    const entry = latest(document).find(value => value.knowledgeId === input.knowledgeId);
    if (!entry) throw fail("KNOWLEDGE_NOT_FOUND", "这条项目知识不存在。");
    if (input.expectedEntryRevision !== undefined && input.expectedEntryRevision !== entry.revision)
      throw fail("KNOWLEDGE_ENTRY_CONFLICT", "这条项目知识已有更新，请刷新后重试。");
    if (entry.status === "deleted") throw fail("KNOWLEDGE_DELETED", "这条知识已删除，旧保存不能恢复它。");
    return entry;
  }
  function checkObject(catalog, value) {
    const scope = normalizeProjectKnowledgeScope(value);
    if (!scope) throw fail("KNOWLEDGE_SCOPE_INVALID", "知识适用范围无效。");
    if (scope.type === "project") return scope;
    const product = catalog.products.find(product => product.productId === scope.productId && product.status !== "archived" && !product.creationResultOwner);
    if (!product || scope.type === "variant" && !product.variants.some(value => value.variantId === scope.variantId) ||
      scope.type === "sku" && !product.skus.some(value => value.skuId === scope.skuId))
      throw fail("KNOWLEDGE_OBJECT_NOT_FOUND", "知识适用的商品、变体或 SKU 不在当前项目。");
    return scope;
  }
  function locate(project, target, session) {
    const identity = normalizeProjectKnowledgeAsset(target);
    if (!identity) throw fail("KNOWLEDGE_ASSET_INVALID", "基准素材需要完整的资产、出现身份和内容指纹。");
    const candidates = (session.nodes || []).flatMap(node => (node.assets || []).map(asset => ({ node, asset })))
      .filter(value => sameAsset(value.asset, identity));
    if (!candidates.length) throw fail("KNOWLEDGE_ASSET_STALE", "已绑定基准素材不在当前项目，或内容已改变。");
    const found = candidates[0], relativePath = found.asset.relativePath || projectRelativePath(project.path, found.asset.path);
    if (typeof relativePath !== "string" || !/^(?:assets\/|output\/(?:imagegen|post)\/|\.naimage\/assets\/)/i.test(relativePath.replace(/\\/g, "/")) ||
      /^(?:[a-z]:|\/)/i.test(relativePath) || relativePath.replace(/\\/g, "/").split("/").some(part => !part || part === "." || part === ".."))
      throw fail("KNOWLEDGE_ASSET_INVALID", "基准素材必须由当前项目管理。");
    const file = resolveProjectRelativePath(project.path, relativePath), stat = fileSystem.lstatSync(file);
    const realRoot = fileSystem.realpathSync(project.path), realFile = fileSystem.realpathSync(file);
    const relativeReal = path.relative(realRoot, realFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024 || relativeReal.startsWith("..") || path.isAbsolute(relativeReal) ||
      sha(fileSystem.readFileSync(file)) !== identity.contentHash) throw fail("KNOWLEDGE_ASSET_STALE", "已绑定基准素材的文件身份或内容已改变。");
    return { ...found, target: identity };
  }
  function assetAvailability(project, entry, catalog, session) {
    const invalidReasons = [];
    try { checkObject(catalog, entry.scope); } catch { invalidReasons.push("object_unavailable"); }
    for (const target of entry.assetRefs) {
      try {
        locate(project, target, session);
        if (entry.type === "style_reference" && !catalog.products.some(product => product.status !== "archived" && product.assets.some(link =>
          link.kind === "result" && link.state === "approved" && link.assetId === target.assetId && link.contentHash === target.contentHash &&
          (!link.occurrenceId || link.occurrenceId === target.occurrenceId)))) invalidReasons.push("reference_not_adopted");
      } catch { invalidReasons.push("asset_unavailable"); }
    }
    return { usable: !invalidReasons.length, invalidReasons: [...new Set(invalidReasons)] };
  }
  function append(project, document, value, previous) {
    const entry = { ...value, knowledgeId: previous?.knowledgeId || `knowledge-${randomUUID()}`, revision: (previous?.revision || 0) + 1,
      authority: "project_knowledge" };
    entry.fingerprint = projectKnowledgeEntryFingerprint(entry);
    if (!entry.fingerprint) throw fail("KNOWLEDGE_ENTRY_INVALID", "项目知识内容、来源或状态无效。");
    const at = now(), saved = { ...entry, storeRevision: document.revision + 1, createdAt: previous?.createdAt || at, updatedAt: at };
    document.history.push(saved); document.revision++;
    write(project, document);
    return { ok: true, projectId: project.id, revision: document.revision, entry: copy(saved) };
  }
  function save(input = {}) {
    const project = projectOf(input), document = read(project); assertRevision(document, input);
    const previous = input.knowledgeId ? entryFor(document, input) : null;
    if (!previous && latest(document).length >= MAX_ENTRIES) throw fail("KNOWLEDGE_LIMIT", "项目知识条数已达本地上限。");
    const value = input.entry;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(field =>
      !["title", "content", "type", "scope", "source", "assetRefs"].includes(field))) throw fail("KNOWLEDGE_ENTRY_INVALID", "知识只接受明确的内容、类型、来源、范围和基准身份。");
    const source = value.source ?? previous?.source;
    if (!["user", "assumption"].includes(source) || previous && source !== previous.source)
      throw fail("KNOWLEDGE_SOURCE_INVALID", "Agent 建议只能通过明确提升变为长期要求。");
    const scope = checkObject(catalogFor(project), value.scope ?? previous?.scope ?? { type: "project" });
    const title = clean(value.title ?? previous?.title), content = clean(value.content ?? previous?.content);
    const type = value.type ?? previous?.type;
    if (!title || title.length > LIMITS.maxTitleCharacters || !content || content.length > LIMITS.maxContentCharacters || !PROJECT_KNOWLEDGE_TYPES.includes(type))
      throw fail("KNOWLEDGE_ENTRY_INVALID", "请提供有界的知识名称、内容和类型。");
    const assetRefs = value.assetRefs ?? previous?.assetRefs ?? [];
    if (!Array.isArray(assetRefs) || assetRefs.length > LIMITS.maxAssetsPerEntry || assetRefs.some(asset => !normalizeProjectKnowledgeAsset(asset)))
      throw fail("KNOWLEDGE_ASSET_INVALID", "知识基准必须使用有界的精确素材身份。");
    const normalizedAssets = assetRefs.map(normalizeProjectKnowledgeAsset);
    if (new Set(normalizedAssets.map(key)).size !== normalizedAssets.length || type === "style_reference" && !normalizedAssets.length)
      throw fail("KNOWLEDGE_ASSET_INVALID", "风格基准需要至少一项不重复的已采用素材。");
    const next = { type, title, content, scope, source, status: previous?.status || (source === "user" ? "active" : "suggested"), assetRefs: normalizedAssets };
    const availability = assetAvailability(project, next, catalogFor(project), readSession(project) || {});
    if (!availability.usable) throw fail("KNOWLEDGE_ASSET_STALE", "知识范围或基准素材已失效，请重新选择当前项目的已采用成果。");
    return append(project, document, next, previous);
  }
  function setStatus(input = {}) {
    const project = projectOf(input), document = read(project); assertRevision(document, input);
    const previous = entryFor(document, input), status = input.status;
    if (!["active", "inactive", "deleted"].includes(status) || status === "active" && previous.source !== "user")
      throw fail("KNOWLEDGE_STATUS_INVALID", "建议必须明确提升后才能长期生效。");
    if (previous.status === status) return { ok: true, changed: false, projectId: project.id, revision: document.revision, entry: copy(previous) };
    return append(project, document, { ...normalizeProjectKnowledgeEntry(previous), status }, previous);
  }
  function promote(input = {}) {
    const project = projectOf(input), document = read(project); assertRevision(document, input);
    const previous = entryFor(document, input);
    if (previous.source !== "assumption") throw fail("KNOWLEDGE_NOT_SUGGESTION", "只有建议需要明确提升。");
    const availability = assetAvailability(project, previous, catalogFor(project), readSession(project) || {});
    if (!availability.usable) throw fail("KNOWLEDGE_ASSET_STALE", "建议的范围或基准已失效，请先编辑。");
    return append(project, document, { ...normalizeProjectKnowledgeEntry(previous), source: "user", status: "active" }, previous);
  }
  function resolveObjects(project, input, catalog, session) {
    const chosen = new Map();
    for (const value of input.objects || []) {
      const scope = checkObject(catalog, value);
      if (scope.type !== "project") chosen.set(key(scope), scope);
    }
    const scope = input.taskScope || {};
    const materials = input.sourceAssets || scope.sourceAssets || scope.materials?.filter(asset => asset.role === "source") || [];
    const selectedNodes = new Set(input.sourceNodeIds || []);
    const sources = [...materials.filter(asset => asset.role !== "reference"), ...(session.nodes || []).filter(node => selectedNodes.has(node.id)).flatMap(node => node.assets || [])];
    for (const asset of sources) {
      const target = normalizeProjectKnowledgeAsset(asset);
      if (!target) continue;
      const candidates = catalog.products.filter(product => product.status !== "archived" && !product.creationResultOwner).flatMap(product => product.assets
        .filter(link => link.kind !== "brand" && link.assetId === target.assetId && link.contentHash === target.contentHash &&
          (link.occurrenceId ? link.occurrenceId === target.occurrenceId : (session.nodes || []).some(node => node.id === link.nodeId && sameAsset(node.assets?.[link.assetIndex], target))))
        .map(link => ({ type: link.ownerType, productId: product.productId, ...(link.ownerType === "variant" ? { variantId: link.ownerId } : link.ownerType === "sku" ? { skuId: link.ownerId } : {}) })));
      const highest = Math.max(-1, ...candidates.map(specificity));
      const preferred = [...new Map(candidates.filter(candidate => specificity(candidate) === highest).map(candidate => [key(candidate), candidate])).values()];
      if (preferred.length === 1) chosen.set(key(preferred[0]), preferred[0]);
    }
    if (chosen.size > LIMITS.maxObjects) throw fail("KNOWLEDGE_OBJECT_LIMIT", "本次知识适用对象过多，请缩小明确素材范围。");
    return [...chosen.values()].sort((left, right) => key(left).localeCompare(key(right)));
  }
  function objectClosure(objects, catalog) {
    const scopes = new Map();
    for (const scope of objects) {
      scopes.set(key({ type: "product", productId: scope.productId }), { type: "product", productId: scope.productId });
      if (scope.type === "sku") {
        const variantId = catalog.products.find(product => product.productId === scope.productId)?.skus.find(sku => sku.skuId === scope.skuId)?.variantId;
        if (variantId) scopes.set(key({ type: "variant", productId: scope.productId, variantId }), { type: "variant", productId: scope.productId, variantId });
      }
      scopes.set(key(scope), scope);
    }
    return [...scopes.values()];
  }
  function catalogEntries(project, objects, catalog, session) {
    const scopes = objectClosure(objects, catalog), entries = [];
    const add = (product, scope, field, title, content, ownerRevision, assetRefs = []) => {
      if (!content) return;
      const entry = { knowledgeId: `commerce:${product.productId}:${scope.variantId || scope.skuId || "product"}:${field}`,
        revision: product.revision, type: field === "brandStyle" ? "brand_rule" : "product_fact", title: clean(title).slice(0, LIMITS.maxTitleCharacters),
        content: clean(content).slice(0, LIMITS.maxContentCharacters), scope, source: "user", status: "active", authority: "commerce_catalog", assetRefs,
        catalogRef: { catalogId: catalog.catalogId, catalogRevision: catalog.revision, productId: product.productId, productRevision: product.revision,
          field, ...(ownerRevision ? { ownerRevision } : {}) }, readOnly: true };
      entry.fingerprint = projectKnowledgeEntryFingerprint(entry); entries.push(entry);
    };
    for (const scope of scopes) {
      const product = catalog.products.find(product => product.productId === scope.productId);
      if (!product) continue;
      if (scope.type === "product") {
        add(product, scope, "product", `${product.title} · 商品资料`, [`商品：${product.title}`, product.brand && `品牌：${product.brand}`,
          product.productCode && `商品编码：${product.productCode}`].filter(Boolean).join("\n"));
        const style = product.brandStyle;
        if (style?.enabled) {
          const allowed = new Set(scopes.filter(scope => scope.productId === product.productId).map(scope => scope.skuId || scope.variantId || scope.productId));
          const refs = [];
          for (const role of ["logo", "packaging", "style-reference"]) {
            const links = product.assets.filter(link => link.kind === "brand" && link.role === role && allowed.has(link.ownerId));
            const priority = Math.max(-1, ...links.map(link => specificity({ type: link.ownerType })));
            for (const link of links.filter(link => specificity({ type: link.ownerType }) === priority).sort((left, right) => left.linkId.localeCompare(right.linkId))) {
              const node = (session.nodes || []).find(node => node.id === link.nodeId), asset = node?.assets?.[link.assetIndex];
              const target = normalizeProjectKnowledgeAsset(asset);
              if (!target || target.assetId !== link.assetId || target.contentHash !== link.contentHash || link.occurrenceId && target.occurrenceId !== link.occurrenceId) continue;
              try { locate(project, target, session); if (!refs.some(ref => sameAsset(ref, target))) refs.push(target); } catch {}
            }
          }
          add(product, scope, "brandStyle", `${product.title} · 品牌规范`, [style.colors?.length && `品牌色：${style.colors.join("、")}`,
            style.fontFamily && `字体：${style.fontFamily}`, style.logoUsage && `Logo：${style.logoUsage}`, style.productAppearance && `商品外观：${style.productAppearance}`,
            style.modelAppearance && `人物外观：${style.modelAppearance}`, style.visualStyle && `视觉风格：${style.visualStyle}`].filter(Boolean).join("\n"), undefined, refs.slice(0, LIMITS.maxAssetsPerEntry));
        }
      } else if (scope.type === "variant") {
        const variant = product.variants.find(value => value.variantId === scope.variantId);
        if (variant) add(product, scope, "variant", `${variant.title} · 变体资料`, [variant.title,
          ...variant.optionValues.map(value => `${value.name}：${value.value}`)].join("\n"), variant.revision);
      } else {
        const sku = product.skus.find(value => value.skuId === scope.skuId);
        if (sku) add(product, scope, "sku", `${sku.title || sku.skuCode} · SKU资料`, [`SKU：${sku.skuCode}`, sku.title,
          sku.platforms?.length && `适用平台：${sku.platforms.join("、")}`].filter(Boolean).join("\n"), sku.revision);
      }
    }
    return entries;
  }
  function list(input = {}) {
    const project = projectOf(input), document = read(project), catalog = catalogFor(project), session = readSession(project) || {};
    const objects = resolveObjects(project, input, catalog, session), closure = objectClosure(objects, catalog);
    const filtered = latest(document).filter(entry => (input.includeDeleted || entry.status !== "deleted") &&
      (input.includeInactive !== false || entry.status !== "inactive") && (input.includeSuggestions !== false || entry.status !== "suggested") &&
      (!input.objects || entry.scope.type === "project" || closure.some(scope => key(scope) === key(entry.scope))))
      .map(entry => ({ ...entry, ...assetAvailability(project, entry, catalog, session) }));
    if (input.includeCommerce !== false) filtered.push(...catalogEntries(project, objects, catalog, session).map(entry => ({ ...entry, usable: true, invalidReasons: [] })));
    filtered.sort((left, right) => (right.storeRevision || 0) - (left.storeRevision || 0) || left.knowledgeId.localeCompare(right.knowledgeId));
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
    const limit = Number.isSafeInteger(input.limit) ? Math.max(1, Math.min(100, input.limit)) : 100;
    const scopeOptions = [{ scope: { type: "project" }, label: "本项目" }];
    for (const product of catalog.products.filter(product => product.status !== "archived" && !product.creationResultOwner)
      .sort((left, right) => left.title.localeCompare(right.title) || left.productId.localeCompare(right.productId))) {
      const label = clean(product.title).slice(0, 120);
      scopeOptions.push({ scope: { type: "product", productId: product.productId }, label: `商品 · ${label}` });
      for (const variant of product.variants) scopeOptions.push({ scope: { type: "variant", productId: product.productId, variantId: variant.variantId }, label: `${label} · ${clean(variant.title).slice(0, 120)}` });
      for (const sku of product.skus) scopeOptions.push({ scope: { type: "sku", productId: product.productId, skuId: sku.skuId }, label: `${label} · SKU ${clean(sku.skuCode).slice(0, 120)}` });
    }
    return { ok: true, projectId: project.id, revision: document.revision, objects, total: filtered.length,
      scopeOptions: scopeOptions.slice(0, 200), ...(scopeOptions.length > 200 ? { scopeOptionsTruncated: true } : {}),
      entries: copy(filtered.slice(offset, offset + limit)), ...(offset + limit < filtered.length ? { nextOffset: offset + limit } : {}) };
  }
  function history(input = {}) {
    const project = projectOf(input), document = read(project);
    return { ok: true, projectId: project.id, revision: document.revision,
      versions: copy(document.history.filter(entry => entry.knowledgeId === input.knowledgeId)) };
  }
  function freezeForTask(input = {}) {
    const project = projectOf(input), document = read(project), catalog = catalogFor(project), session = readSession(project) || {};
    const objects = resolveObjects(project, input, catalog, session), closure = objectClosure(objects, catalog);
    const applicable = [...latest(document).filter(entry => entry.source === "user" && entry.status === "active" &&
      (entry.scope.type === "project" || closure.some(scope => key(scope) === key(entry.scope)))), ...catalogEntries(project, objects, catalog, session)]
      .filter(entry => assetAvailability(project, entry, catalog, session).usable)
      .sort((left, right) => specificity(right.scope) - specificity(left.scope) ||
        Number(right.type === "product_fact") - Number(left.type === "product_fact") || left.knowledgeId.localeCompare(right.knowledgeId));
    const maxEntries = Number.isSafeInteger(input.budget?.maxEntries) ? Math.max(0, Math.min(LIMITS.maxEntries, input.budget.maxEntries)) : LIMITS.maxEntries;
    const maxCharacters = Number.isSafeInteger(input.budget?.maxCharacters) ? Math.max(0, Math.min(LIMITS.maxCharacters, input.budget.maxCharacters)) : LIMITS.maxCharacters;
    const entries = []; let usedCharacters = 0;
    for (const entry of applicable) {
      const needed = entry.title.length + entry.content.length;
      if (entries.length >= maxEntries || usedCharacters + needed > maxCharacters) continue;
      entries.push(normalizeProjectKnowledgeEntry(entry)); usedCharacters += needed;
    }
    const snapshot = { version: 1, projectId: project.id, revision: document.revision, objects, entries,
      budget: { maxEntries, maxCharacters, usedCharacters, omittedEntries: applicable.length - entries.length },
      summary: entries.map(entry => entry.title).join("；").slice(0, 400) };
    snapshot.fingerprint = projectKnowledgeSnapshotFingerprint(snapshot);
    if (!snapshot.fingerprint) throw fail("KNOWLEDGE_SNAPSHOT_INVALID", "项目知识无法形成有效的冻结上下文。");
    return snapshot;
  }
  function resolveFrozen(input = {}) {
    const project = projectOf(input), snapshot = normalizeProjectKnowledgeSnapshot(input.snapshot, { expectedProjectId: project.id });
    if (!snapshot) throw fail("KNOWLEDGE_SNAPSHOT_INVALID", "项目知识快照的项目或内容指纹无效。");
    const task = input.taskId ? taskResolver(project.id, input.taskId, input.conversationId) : null;
    const trusted = normalizeProjectKnowledgeReceipt(task?.projectKnowledge || task?.scope?.projectKnowledge);
    if (trusted && key(trusted) === key(projectKnowledgeReceipt(snapshot))) {
      const document = read(project);
      if (snapshot.entries.some(entry => entry.authority === "project_knowledge" && !document.history.some(stored =>
        stored.knowledgeId === entry.knowledgeId && stored.revision === entry.revision && stored.fingerprint === entry.fingerprint)))
        throw fail("KNOWLEDGE_HISTORY_MISSING", "原任务的知识历史缺失，不能替换成当前规则续跑。");
      return snapshot;
    }
    // New admissions cannot supply a self-authored snapshot or reactivate old
    // rules. Only a durable task receipt authorizes historical catalog content.
    const fresh = freezeForTask({ ...input, objects: input.objects || snapshot.objects,
      budget: { maxEntries: snapshot.budget.maxEntries, maxCharacters: snapshot.budget.maxCharacters } });
    if (fresh.fingerprint !== snapshot.fingerprint) throw fail("KNOWLEDGE_SNAPSHOT_STALE", "项目知识已变化，请为新任务刷新；已有任务请使用原冻结版本。");
    return snapshot;
  }
  return { list, save, setStatus, promote, history, freezeForTask, resolveFrozen, validateFrozen: resolveFrozen, setTaskResolver };
}

module.exports = { createProjectKnowledgeService, PROJECT_KNOWLEDGE_MAX_STORE_BYTES: MAX_STORE_BYTES };
