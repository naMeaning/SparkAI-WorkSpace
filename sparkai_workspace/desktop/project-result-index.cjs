"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { redactText } = require("./debug-command-service.cjs");
const catalogSchema = require("../plugins/commerce-catalog-schema.json");
const roleLabels = new Map(catalogSchema.assetKinds.flatMap(kind => kind.roles.map(role => [role.id, role.label])));

const INDEX_VERSION = 1;
const MAX_RESULTS = 50;
const MAX_ASSETS = 20_000;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const digest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const identifier = value => typeof value === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value) ? value : "";
const identity = value => value && identifier(value.assetId) && identifier(value.occurrenceId) && /^[a-f0-9]{64}$/i.test(value.contentHash || "")
  ? { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash.toLowerCase() } : null;
const targetKey = value => JSON.stringify([value.assetId, value.occurrenceId, value.contentHash]);
const refKey = value => value ? JSON.stringify([value.requirementId, value.revision, value.fingerprint]) : "";
const text = (value, limit = 240) => redactText(String(value || "")).normalize("NFKC").replace(/\u0000/g, "")
  .replace(/https?:\/\/[^\s<>"')]+/gi, "[链接已隐藏]")
  .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]")
  .replace(/\/(?:Users|home|tmp|private|mnt|var|workspace)\/[^\s<>"']+/g, "[路径已隐藏]")
  .replace(/\s+/g, " ").trim().slice(0, limit);
const uniqueText = values => [...new Set(values.map(value => text(value)).filter(Boolean))].slice(0, 32);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (code, message) => Object.assign(Error(message), { code });

async function mapLimit(values, callback, limit = 8) {
  const result = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= values.length) return; result[index] = await callback(values[index], index); }
  }));
  return result;
}

/** Rebuildable metadata only. Session/assets, catalog and creation remain owners. */
function createProjectResultIndex({ projectFor, readSession, catalogService, creationService, controlledProjectAssetFile, createProjectAssetFileValidator,
  resolveProjectRelativePath = (directory, relative) => path.resolve(directory, relative), metaDir = ".naimage" } = {}) {
  if (typeof projectFor !== "function" || typeof readSession !== "function" || typeof catalogService?.list !== "function" || typeof creationService?.searchSnapshot !== "function") {
    throw TypeError("result index requires project/session/catalog/creation owners");
  }
  const caches = new Map(), pending = new Map();
  const counters = { searches: 0, builds: 0, fileReads: 0, cacheLoads: 0, cacheRebuilds: 0 };
  const projectOf = input => {
    const id = String(input?.expectedProjectId || input?.projectId || "");
    if (!id || input?.expectedProjectId && input?.projectId && input.expectedProjectId !== input.projectId) throw fail("PROJECT_NOT_FOUND", "请指定当前成果所属项目。");
    const project = projectFor(id);
    if (!project?.path || project.id !== id) throw fail("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。");
    return project;
  };
  const cachePath = project => path.join(project.path, metaDir, "result-index.json");
  const validationPassFor = project => ({ files: new Map(), validate: typeof createProjectAssetFileValidator === "function"
    ? createProjectAssetFileValidator(project.path) : controlledProjectAssetFile });
  function loadCache(project) {
    if (caches.has(project.id)) return caches.get(project.id);
    const cache = { files: new Map(), fingerprint: "", rows: [] };
    try {
      const file = cachePath(project), info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CACHE_BYTES) throw Error();
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      if (stored.schemaVersion !== INDEX_VERSION || stored.projectId !== project.id || !Array.isArray(stored.files) || stored.files.length > MAX_ASSETS || stored.checksum !== digest(stored.files)) throw Error();
      for (const item of stored.files) {
        if (!/^[a-f0-9]{64}$/.test(item.key || "") || !/^[a-f0-9]{64}$/.test(item.hash || "") || typeof item.stamp !== "string" || item.stamp.length > 400) throw Error();
        cache.files.set(item.key, { hash: item.hash, stamp: item.stamp });
      }
      counters.cacheLoads++;
    } catch { counters.cacheRebuilds++; }
    caches.set(project.id, cache); return cache;
  }
  function saveCache(project, cache) {
    const file = cachePath(project), temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const files = [...cache.files].map(([key, value]) => ({ key, ...value }));
    // Nothing in this cache is a new fact or an asset locator. It can be deleted.
    const bytes = JSON.stringify({ schemaVersion: INDEX_VERSION, projectId: project.id, checksum: digest(files), files });
    if (Buffer.byteLength(bytes) > MAX_CACHE_BYTES) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); }
    catch { /* Search remains available if its disposable cache is unwritable. */ }
    finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
  }
  async function fileState(project, asset, cache, validationPass) {
    try {
      let file = asset.relativePath ? resolveProjectRelativePath(project.path, asset.relativePath) : asset.path;
      if (!file || typeof file !== "string") throw Error();
      const relative = path.relative(project.path, file).replace(/\\/g, "/");
      if (!relative || relative.startsWith("../") || path.isAbsolute(relative) || !["assets/", "output/imagegen/", "output/post/", `${metaDir}/assets/`].some(prefix => relative.startsWith(prefix))) throw Error();
      const locator = process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
      let operation = validationPass?.files.get(locator);
      if (!operation) {
        operation = (async () => {
          const validate = validationPass?.validate || controlledProjectAssetFile;
          if (typeof validate === "function") {
            file = validate(file, project.path); if (!file) throw Error();
          } else {
            let current = project.path;
            for (const component of relative.split("/")) { current = path.join(current, component); if ((await fs.promises.lstat(current)).isSymbolicLink()) throw Error(); }
          }
          const stat = await fs.promises.stat(file, { bigint: true });
          if (!stat.isFile() || stat.size < 1n || stat.size > 128n * 1024n * 1024n) throw Error();
          const key = digest(relative), stamp = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
          let saved = cache.files.get(key);
          if (!saved || saved.stamp !== stamp) {
            counters.fileReads++;
            const hash = createHash("sha256"); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
            const after = await fs.promises.stat(file, { bigint: true });
            if ([after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(":") !== stamp) throw Error();
            saved = { stamp, hash: hash.digest("hex") }; cache.files.set(key, saved);
          }
          return { key, stamp, hash: saved.hash };
        })();
        // One query can contain many independent occurrences of the same file.
        // Share its fresh path/stat/hash work only for this pass. The expected
        // content hash is still checked separately for every occurrence, and
        // the next query or explicit use starts another validation pass.
        validationPass?.files.set(locator, operation);
      }
      const state = await operation;
      return { ...state, valid: state.hash === asset.contentHash };
    } catch { return { key: "", stamp: "missing", hash: "", valid: false }; }
  }
  function collect(session) {
    const rows = new Map();
    for (const node of session?.nodes || []) {
      if (node.type !== "image") continue;
      for (const [assetIndex, asset] of (node.assets || []).entries()) {
        const target = identity(asset); if (!target || asset.status === "error" || asset.status === "pending") continue;
        const key = targetKey(target), location = { nodeId: String(node.id), assetIndex };
        const previous = rows.get(key);
        if (previous) { previous.locations.push(location); continue; }
        const collection = node.imageCollection?.items || node.imageContainerSpec?.collection?.items || [];
        const member = collection.find(value => value.assetId === target.assetId && value.occurrenceId === target.occurrenceId) || collection.find(value => value.assetIndex === assetIndex + 1);
        rows.set(key, { target, node, asset, assetIndex, locations: [location], provenance: member?.taskProvenance || (node.assets.length === 1 ? node.taskProvenance : null) });
        if (rows.size > MAX_ASSETS) throw fail("RESULT_INDEX_LIMIT", "本项目成果数量超过本地检索上限。");
      }
    }
    return [...rows.values()];
  }
  async function refresh(project) {
    if (pending.has(project.id)) return pending.get(project.id);
    const operation = (async () => {
      const cache = loadCache(project), session = readSession(project.id);
      const catalog = typeof catalogService.readDocument === "function" ? catalogService.readDocument(project, { create: false }) : catalogService.list({ expectedProjectId: project.id }).catalog;
      const creation = creationService.searchSnapshot({ expectedProjectId: project.id }, session);
      const entries = collect(session), validationPass = validationPassFor(project);
      const states = await mapLimit(entries, entry => fileState(project, entry.asset, cache, validationPass));
      const sources = entries.map((entry, index) => ({ target: entry.target, nodeId: entry.node.id, assetIndex: entry.assetIndex,
        locations: entry.locations, name: [entry.asset.title, entry.asset.originalName, entry.node.title],
        tags: [entry.asset.tags, entry.node.tags], prompt: entry.asset.prompt || entry.asset.revisedPrompt || entry.node.prompt,
        provenance: entry.provenance, parentId: entry.node.parentId, relationType: entry.node.relationType, state: states[index] }));
      const fingerprint = digest({ sources, edges: session?.edges || [], catalog, creation });
      if (cache.fingerprint === fingerprint) return cache.rows;
      const currentFiles = new Map(entries.map((entry, index) => [targetKey(entry.target), states[index].valid]));
      const entriesByNode = new Map();
      for (const entry of entries) { const group = entriesByNode.get(entry.node.id) || []; group.push(entry); entriesByNode.set(entry.node.id, group); }
      const entriesByAsset = new Map();
      for (const entry of entries) {
        const key = `${entry.target.assetId}|${entry.target.contentHash}`, group = entriesByAsset.get(key) || [];
        group.push(entry); entriesByAsset.set(key, group);
      }
      const latestRequirements = new Map();
      for (const requirement of creation.requirements || []) {
        const previous = latestRequirements.get(requirement.requirementId);
        if (!previous || previous.revision < requirement.revision) latestRequirements.set(requirement.requirementId, requirement);
      }
      const requirementsByRef = new Map((creation.requirements || []).map(value => [refKey(value), value]));
      const recordsByTarget = new Map();
      for (const record of creation.results || []) {
        const target = identity(record.target); if (!target) continue;
        const key = targetKey(target), rows = recordsByTarget.get(key) || [];
        rows.push(record); recordsByTarget.set(key, rows);
      }
      const linksByTarget = new Map();
      for (const product of catalog?.products || []) for (const link of product.assets || []) {
        const candidates = entriesByAsset.get(`${link.assetId}|${link.contentHash}`) || [];
        const candidate = link.occurrenceId ? candidates.find(value => value.target.occurrenceId === link.occurrenceId) : candidates.length === 1 ? candidates[0] : null;
        if (!candidate) continue; // A legacy blob-only link must not claim two imports.
        const key = targetKey(candidate.target), rows = linksByTarget.get(key) || [];
        rows.push({ product, link }); linksByTarget.set(key, rows);
      }
      cache.rows = entries.flatMap((entry, index) => {
        if (!states[index].valid) return [];
        const { target, node, asset, provenance } = entry, key = targetKey(target);
        const records = recordsByTarget.get(key) || [], links = linksByTarget.get(key) || [];
        const validRecord = record => refKey(record.requirementRef) === refKey(latestRequirements.get(record.requirementRef?.requirementId));
        const relevant = records.filter(validRecord);
        const reviews = relevant.filter(record => record.visualReview?.modelRoundId && record.visualReview?.reviewedAt &&
          (record.visualReview.sourceTargets || []).every(source => currentFiles.get(targetKey(source)) === true));
        const review = [...reviews].sort((a, b) => compare(b.visualReview.reviewedAt, a.visualReview.reviewedAt))[0]?.visualReview;
        const observedSummary = review ? text([review.summary, ...(review.findings || []).map(value => value.note)].filter(Boolean).join(" "), 600) : "";
        const requirement = requirementsByRef.get(refKey(provenance?.creation));
        const usages = uniqueText([requirement?.usage?.text, ...relevant.map(value => requirementsByRef.get(refKey(value.requirementRef))?.usage?.text), ...links.flatMap(value => [value.link.role, roleLabels.get(value.link.role)])]);
        const tags = uniqueText([...(Array.isArray(asset.tags) ? asset.tags : []), ...(Array.isArray(node.tags) ? node.tags : [])]);
        const objects = new Map();
        for (const { product, link } of links) {
          objects.set(product.productId, { type: "product", id: product.productId, productId: product.productId, label: text(product.title, 160) });
          const sku = link.ownerType === "sku" ? product.skus?.find(value => value.skuId === link.ownerId) : null;
          const variant = product.variants?.find(value => value.variantId === (sku?.variantId || (link.ownerType === "variant" ? link.ownerId : "")));
          if (variant) objects.set(variant.variantId, { type: "variant", id: variant.variantId, productId: product.productId, label: text([variant.title, ...(variant.optionValues || []).map(value => value.value)].join(" "), 160) });
          if (sku) objects.set(sku.skuId, { type: "sku", id: sku.skuId, productId: product.productId, label: text(`${sku.title || ""} ${sku.skuCode}`, 160) });
        }
        const linkedResults = links.filter(value => value.link.kind === "result");
        const recordedState = linkedResults.some(value => value.link.state === "approved") ? "approved" : linkedResults.some(value => value.link.state === "rejected") ? "rejected" : "candidate";
        const evidenceCurrent = !records.length || relevant.some(value => value.fileCheck?.status === "passed") && (!records.some(value => value.visualReview) || Boolean(review));
        const adoption = { state: recordedState === "approved" && !evidenceCurrent ? "candidate" : recordedState, current: evidenceCurrent,
          ...(recordedState !== "candidate" && !evidenceCurrent ? { recordedState } : {}) };
        const sourceTargets = [];
        const addSource = (value, sourceNodeId, relation) => {
          const source = identity(value);
          if (source && !sourceTargets.some(row => targetKey(row.target) === targetKey(source))) sourceTargets.push({ target: source, ...(sourceNodeId ? { nodeId: String(sourceNodeId) } : {}), relation: relation || "derived-from" });
        };
        if (provenance?.sourceAssetId && provenance.sourceOccurrenceId && provenance.sourceContentHash) addSource({ assetId: provenance.sourceAssetId, occurrenceId: provenance.sourceOccurrenceId, contentHash: provenance.sourceContentHash }, provenance.sourceNodeId);
        for (const record of records) if (record.baseline) addSource(record.baseline, "", "derived-from");
        const sourceNodeIds = new Set([node.parentId, ...(session?.edges || []).filter(edge => (edge.target || edge.targetId) === node.id).map(edge => edge.source || edge.sourceId)].filter(Boolean));
        for (const sourceNodeId of sourceNodeIds) for (const source of entriesByNode.get(sourceNodeId) || []) addSource(source.target, source.node.id, node.relationType);
        const name = text(asset.title || asset.originalName || node.title || "图片成果", 160);
        const intended = text(asset.prompt || asset.revisedPrompt || node.prompt, 600);
        const locations = entry.locations.sort((a, b) => compare(a.nodeId, b.nodeId) || a.assetIndex - b.assetIndex);
        return [{ target, ...locations[0], locations: locations.slice(0, 8), name, tags, usage: usages, objects: [...objects.values()], sources: sourceTargets.slice(0, 40),
          intended, observation: { status: review ? "observed" : records.some(value => value.visualReview) ? "stale" : "unobserved", ...(observedSummary ? { summary: observedSummary } : {}) },
          adoption, summary: observedSummary || intended || name,
          ...(Number(asset.width) > 0 ? { width: Math.floor(Number(asset.width)) } : {}), ...(Number(asset.height) > 0 ? { height: Math.floor(Number(asset.height)) } : {}),
          createdAt: text(asset.generation?.completedAt || asset.generation?.startedAt || node.imageCollection?.createdAt || "", 40) }];
      });
      cache.fingerprint = fingerprint; counters.builds++;
      const activeFileKeys = new Set(states.map(value => value.key));
      for (const key of cache.files.keys()) if (!activeFileKeys.has(key)) cache.files.delete(key);
      saveCache(project, cache); return cache.rows;
    })();
    pending.set(project.id, operation);
    try { return await operation; } finally { if (pending.get(project.id) === operation) pending.delete(project.id); }
  }
  function normalizeQuery(input) {
    const query = input.query || {};
    if (!query || typeof query !== "object" || Array.isArray(query)) throw fail("RESULT_QUERY_INVALID", "检索条件必须是对象。");
    const bounded = value => { if (value !== undefined && (typeof value !== "string" || value.length > 500)) throw fail("RESULT_QUERY_INVALID", "检索文字不能超过500字。"); return text(value, 500).toLocaleLowerCase(); };
    const normalized = { text: bounded(query.text), usage: bounded(query.usage), objectId: bounded(query.objectId), source: query.source || {},
      adoption: query.adoption || "any", description: { text: bounded(query.description?.text), source: query.description?.source || "any" } };
    if (!["any", "approved", "candidate", "rejected"].includes(normalized.adoption) || !["any", "observed", "intended"].includes(normalized.description.source)) throw fail("RESULT_QUERY_INVALID", "未知的采用或描述来源条件。");
    if (query.source && (!query.source || typeof query.source !== "object" || Array.isArray(query.source))) throw fail("RESULT_QUERY_INVALID", "来源条件必须是资产定位对象。");
    for (const key of Object.keys(normalized.source)) if (!["assetId", "occurrenceId", "contentHash", "nodeId"].includes(key) || typeof normalized.source[key] !== "string" || normalized.source[key].length > 180) throw fail("RESULT_QUERY_INVALID", "来源条件无效。");
    const limit = input.limit ?? 20, offset = input.offset ?? 0, sort = input.sort || "relevance";
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS || !Number.isInteger(offset) || offset < 0 || offset > MAX_ASSETS || !["relevance", "name", "newest"].includes(sort)) throw fail("RESULT_QUERY_INVALID", "分页或排序条件无效。");
    return { query: normalized, limit, offset, sort };
  }
  async function search(input = {}) {
    const project = projectOf(input), { query, limit, offset, sort } = normalizeQuery(input);
    counters.searches++;
    const rows = await refresh(project), matches = [];
    for (const row of rows) {
      const reasons = [], includes = (value, wanted) => String(value || "").toLocaleLowerCase().includes(wanted);
      const reason = (field, source, value) => reasons.push({ field, source, value: text(value, 180) });
      if (query.adoption !== "any" && row.adoption.state !== query.adoption) continue;
      if (query.adoption !== "any") reason("adoption", "catalog", row.adoption.state);
      if (query.objectId && !row.objects.some(value => includes(value.id, query.objectId) || includes(value.label, query.objectId))) continue;
      if (query.objectId) reason("object", "catalog", row.objects.filter(value => includes(value.id, query.objectId) || includes(value.label, query.objectId)).map(value => value.label).join(" "));
      if (query.usage && !row.usage.some(value => includes(value, query.usage))) continue;
      if (query.usage) reason("usage", "requirements", row.usage.filter(value => includes(value, query.usage)).join(" "));
      if (Object.keys(query.source).length && !row.sources.some(source => Object.entries(query.source).every(([key, value]) => (key === "nodeId" ? source.nodeId : source.target[key]) === value))) continue;
      if (Object.keys(query.source).length) reason("source", "provenance", "来源关系匹配");
      const descriptions = [{ source: "observed", value: row.observation.summary || "" }, { source: "intended", value: row.intended }];
      if (query.description.text) {
        const found = descriptions.filter(value => (query.description.source === "any" || value.source === query.description.source) && includes(value.value, query.description.text));
        if (!found.length) continue;
        for (const value of found) reason("description", value.source, value.value);
      }
      if (query.text) {
        const tokens = query.text.split(/\s+/).filter(Boolean), fields = [
          { field: "name", source: "label", value: row.name }, { field: "tags", source: "user-label", value: row.tags.join(" ") },
          { field: "usage", source: "requirements", value: row.usage.join(" ") }, { field: "object", source: "catalog", value: row.objects.map(value => value.label).join(" ") },
          ...descriptions.map(value => ({ field: "description", ...value }))];
        if (!tokens.every(token => fields.some(field => includes(field.value, token)))) continue;
        for (const field of fields) if (tokens.some(token => includes(field.value, token))) reason(field.field, field.source, field.value);
      }
      if (!reasons.length) reason("available", "metadata", "当前项目中的真实成果");
      matches.push({ ...row, matchReasons: reasons.slice(0, 12), score: reasons.reduce((sum, value) => sum + (value.source === "observed" ? 4 : value.field === "name" ? 3 : 1), 0) });
    }
    matches.sort((a, b) => (sort === "relevance" ? b.score - a.score : sort === "newest" ? compare(b.createdAt, a.createdAt) : compare(a.name, b.name)) || compare(targetKey(a.target), targetKey(b.target)));
    return { ok: true, projectId: project.id, total: matches.length, offset, limit, hasMore: offset + limit < matches.length,
      results: matches.slice(offset, offset + limit).map(({ score, ...row }) => row) };
  }
  async function resolveUse(input = {}) {
    const project = projectOf(input);
    if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 40) throw fail("RESULT_TARGET_INVALID", "明确使用需要1至40个稳定成果身份。");
    const targets = input.targets.map(identity);
    if (targets.some(value => !value) || new Set(targets.map(targetKey)).size !== targets.length) throw fail("RESULT_TARGET_INVALID", "成果身份无效或重复。");
    const rows = await refresh(project), session = readSession(project.id), entries = collect(session), cache = loadCache(project);
    const validationPass = validationPassFor(project);
    const materials = await mapLimit(targets, async target => {
      const row = rows.find(value => targetKey(value.target) === targetKey(target));
      const entry = entries.find(value => targetKey(value.target) === targetKey(target));
      if (!row || !entry || !(await fileState(project, entry.asset, cache, validationPass)).valid) throw fail("RESULT_TARGET_STALE", "指定成果已变化或不可用，请重新检索。");
      const file = entry.asset.relativePath ? resolveProjectRelativePath(project.path, entry.asset.relativePath) : entry.asset.path;
      return { ...target, nodeId: entry.node.id, assetIndex: entry.assetIndex, role: "source", name: row.name,
        path: file, relativePath: path.relative(project.path, file).replace(/\\/g, "/"),
        ...(row.width ? { width: row.width } : {}), ...(row.height ? { height: row.height } : {}) };
    });
    // Private Main return only. Facades expose targets/labels; path-bearing
    // materials go straight to the existing asset/TaskScope admission owner.
    return { ok: true, projectId: project.id, targets, materials };
  }
  function invalidate(input = {}) { const project = projectOf(input); caches.delete(project.id); return { ok: true, projectId: project.id }; }
  async function rebuild(input = {}) {
    const project = projectOf(input); if (pending.has(project.id)) await pending.get(project.id);
    caches.delete(project.id); try { fs.rmSync(cachePath(project), { force: true }); } catch {}
    const rows = await refresh(project); return { ok: true, projectId: project.id, count: rows.length };
  }
  return { search, resolveUse, invalidate, rebuild, diagnostics: () => ({ ...counters }) };
}

module.exports = { createProjectResultIndex, INDEX_VERSION, MAX_RESULTS };
