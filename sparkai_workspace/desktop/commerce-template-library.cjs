"use strict";

const { randomBytes } = require("node:crypto");
const path = require("node:path");
const templateSchema = require("../plugins/commerce-template-schema.json");
const commerceSetSchema = require("../plugins/commerce-set-schema.json");
const { normalizeCommerceSetPlan } = require("../runtime/commerce-set-plan.cjs");

const COMMERCE_TEMPLATE_SCHEMA_VERSION = templateSchema.schemaVersion;
const COMMERCE_TEMPLATE_PORTABLE_TYPE = templateSchema.portableType;
const COMMERCE_TEMPLATE_ID_PATTERN = /^commerce-template-[a-f0-9]{32}$/;
const COMMERCE_TEMPLATE_MAX_ITEMS = templateSchema.limits.maxItems;
const COMMERCE_TEMPLATE_MAX_FILE_BYTES = templateSchema.limits.maxPortableFileBytes;
const portablePlanKeys = new Set([
  "schemaVersion",
  "mode",
  "platformTemplateId",
  "title",
  "slots",
  "targetLocales",
  "translatePrompt"
]);

class CommerceTemplateLibraryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CommerceTemplateLibraryError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, maximum) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maximum)
    : "";
}

function templateTitleKey(value) {
  return cleanText(value, templateSchema.limits.maxTitleLength)
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

function uniqueCopyTitle(title, entries) {
  const clean = cleanText(title, templateSchema.limits.maxTitleLength);
  const stemMatch = clean.match(/^(.*?)(?:\s+\((\d+)\))?$/);
  const stem = cleanText(stemMatch?.[1] || clean, templateSchema.limits.maxTitleLength) || "套图模板";
  const used = new Set((entries || []).map((entry) => templateTitleKey(entry?.title)).filter(Boolean));
  for (let copy = 2; copy < 10_000; copy += 1) {
    const suffix = ` (${copy})`;
    const candidate = `${stem.slice(0, Math.max(1, templateSchema.limits.maxTitleLength - suffix.length)).trimEnd()}${suffix}`;
    if (!used.has(templateTitleKey(candidate))) return candidate;
  }
  throw new CommerceTemplateLibraryError("TEMPLATE_NAME_ALLOCATION_FAILED", "无法为套图模板生成不重复的副本名称。");
}

function normalizedTimestamp(value, fallback) {
  const candidate = cleanText(value, 80);
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : fallback;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function reusableCommerceTemplatePlan(value) {
  const normalized = normalizeCommerceSetPlan(value);
  return {
    ...normalized,
    translationItems: [],
    saveTarget: "none",
    reusableName: normalized.title
  };
}

function portableCommerceTemplatePlan(value) {
  const normalized = reusableCommerceTemplatePlan(value);
  return {
    schemaVersion: normalized.schemaVersion,
    mode: normalized.mode,
    platformTemplateId: normalized.platformTemplateId,
    title: normalized.title,
    slots: normalized.slots.map((slot) => ({ ...slot })),
    targetLocales: normalized.targetLocales.map((locale) => ({ ...locale })),
    translatePrompt: normalized.translatePrompt
  };
}

function strictPortablePlan(value) {
  const source = record(value);
  if (
    Object.keys(source).some((key) => !portablePlanKeys.has(key)) ||
    source.schemaVersion !== commerceSetSchema.schemaVersion ||
    (source.mode !== "generate" && source.mode !== "translate")
  ) return null;
  const normalized = portableCommerceTemplatePlan(source);
  return canonicalJson(source) === canonicalJson(normalized) ? normalized : null;
}

function sanitizeCommerceTemplateEntry(value, fallbackNow = new Date().toISOString()) {
  const source = record(value);
  if (source.version !== 1) return null;
  const id = cleanText(source.id, 64).toLowerCase();
  const title = cleanText(source.title, templateSchema.limits.maxTitleLength);
  const description = cleanText(source.description, templateSchema.limits.maxDescriptionLength);
  const plan = strictPortablePlan(source.plan);
  if (!COMMERCE_TEMPLATE_ID_PATTERN.test(id) || !title || !plan) return null;
  const createdAt = normalizedTimestamp(source.createdAt, fallbackNow);
  const updatedAt = normalizedTimestamp(source.updatedAt, createdAt);
  return {
    version: 1,
    id,
    title,
    ...(description ? { description } : {}),
    plan,
    revision: Math.max(1, Math.floor(Number(source.revision) || 1)),
    createdAt,
    updatedAt
  };
}

function sanitizeCommerceTemplateDocument(value, fallbackNow = new Date().toISOString()) {
  const source = record(value);
  const items = [];
  const seen = new Set();
  for (const candidate of Array.isArray(source.items) ? source.items : []) {
    const entry = sanitizeCommerceTemplateEntry(candidate, fallbackNow);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push(entry);
    if (items.length >= COMMERCE_TEMPLATE_MAX_ITEMS) break;
  }
  return {
    schemaVersion: COMMERCE_TEMPLATE_SCHEMA_VERSION,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    items
  };
}

function builtInCommerceTemplates() {
  const platformById = new Map(commerceSetSchema.platformTemplates.map((entry) => [entry.id, entry]));
  return templateSchema.builtIns.map((definition) => {
    const platform = platformById.get(definition.platformTemplateId);
    if (!platform) throw new CommerceTemplateLibraryError("BUILTIN_TEMPLATE_INVALID", `内置套图模板 ${definition.id} 缺少平台计划。`);
    const plan = reusableCommerceTemplatePlan({
      mode: "generate",
      platformTemplateId: definition.platformTemplateId,
      title: definition.title,
      slots: platform.slots
    });
    return {
      version: 1,
      id: definition.id,
      source: "built-in",
      title: definition.title,
      description: definition.description,
      revision: 1,
      mode: plan.mode,
      platformTemplateId: plan.platformTemplateId,
      slotCount: plan.slots.length,
      localeCount: plan.targetLocales.length,
      plan
    };
  });
}

function publicCommerceTemplateEntry(entry, includePlan = false) {
  const plan = reusableCommerceTemplatePlan(entry.plan);
  return {
    version: 1,
    id: entry.id,
    source: entry.source === "built-in" ? "built-in" : "personal",
    title: entry.title,
    ...(entry.description ? { description: entry.description } : {}),
    revision: entry.revision,
    mode: plan.mode,
    platformTemplateId: plan.platformTemplateId,
    slotCount: plan.slots.length,
    localeCount: plan.targetLocales.length,
    ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(includePlan ? { plan } : {})
  };
}

function strictPortableTemplate(value) {
  const source = record(value);
  const allowed = new Set(["type", "schemaVersion", "title", "description", "plan"]);
  if (
    Object.keys(source).some((key) => !allowed.has(key)) ||
    source.type !== COMMERCE_TEMPLATE_PORTABLE_TYPE ||
    source.schemaVersion !== COMMERCE_TEMPLATE_SCHEMA_VERSION
  ) return null;
  const title = cleanText(source.title, templateSchema.limits.maxTitleLength);
  const description = cleanText(source.description, templateSchema.limits.maxDescriptionLength);
  const plan = strictPortablePlan(source.plan);
  if (!title || title !== source.title || description !== (source.description || "") || !plan) return null;
  return { title, ...(description ? { description } : {}), plan };
}

function portableTemplateDocument(entry) {
  return {
    type: COMMERCE_TEMPLATE_PORTABLE_TYPE,
    schemaVersion: COMMERCE_TEMPLATE_SCHEMA_VERSION,
    title: entry.title,
    description: entry.description || "",
    plan: portableCommerceTemplatePlan(entry.plan)
  };
}

function createCommerceTemplateLibraryService({
  libraryPath,
  readJson,
  writeJson,
  dialog,
  readFileSync,
  writeFileSync,
  statSync,
  now = () => new Date().toISOString(),
  createId = () => `commerce-template-${randomBytes(16).toString("hex")}`
} = {}) {
  if (typeof libraryPath !== "string" || !libraryPath.trim()) throw new TypeError("commerce template libraryPath is required");
  if (typeof readJson !== "function" || typeof writeJson !== "function") throw new TypeError("commerce template library JSON IO is required");
  const builtIns = builtInCommerceTemplates();
  const builtInById = new Map(builtIns.map((entry) => [entry.id, entry]));
  let cachedDocument = null;

  function readDocument() {
    if (cachedDocument) return cachedDocument;
    cachedDocument = sanitizeCommerceTemplateDocument(readJson(libraryPath, { schemaVersion: 1, revision: 0, items: [] }), now());
    return cachedDocument;
  }

  function persistDocument(document) {
    const sanitized = sanitizeCommerceTemplateDocument(document, now());
    writeJson(libraryPath, sanitized);
    cachedDocument = sanitized;
    return sanitized;
  }

  function nextId(document) {
    const used = new Set(document.items.map((entry) => entry.id));
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = cleanText(createId(), 64).toLowerCase();
      if (COMMERCE_TEMPLATE_ID_PATTERN.test(candidate) && !used.has(candidate)) return candidate;
    }
    throw new CommerceTemplateLibraryError("ID_ALLOCATION_FAILED", "无法为套图模板分配唯一 ID。");
  }

  function list() {
    const document = readDocument();
    const personal = [...document.items]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map((entry) => publicCommerceTemplateEntry({ ...entry, source: "personal" }));
    return {
      ok: true,
      schemaVersion: COMMERCE_TEMPLATE_SCHEMA_VERSION,
      libraryRevision: document.revision,
      items: [...builtIns.map((entry) => publicCommerceTemplateEntry(entry)), ...personal]
    };
  }

  function get(payload = {}) {
    const id = cleanText(payload.id, 64).toLowerCase();
    const builtIn = builtInById.get(id);
    if (builtIn) return { ok: true, schemaVersion: 1, libraryRevision: readDocument().revision, entry: publicCommerceTemplateEntry(builtIn, true) };
    const document = readDocument();
    const entry = document.items.find((candidate) => candidate.id === id);
    if (!entry) throw new CommerceTemplateLibraryError("TEMPLATE_NOT_FOUND", "套图模板不存在或已被删除。", { id });
    return { ok: true, schemaVersion: 1, libraryRevision: document.revision, entry: publicCommerceTemplateEntry({ ...entry, source: "personal" }, true) };
  }

  function save(payload = {}) {
    const document = readDocument();
    let title = cleanText(payload.title, templateSchema.limits.maxTitleLength);
    const description = cleanText(payload.description, templateSchema.limits.maxDescriptionLength);
    const plan = portableCommerceTemplatePlan(payload.plan);
    if (!title) throw new CommerceTemplateLibraryError("INVALID_TEMPLATE", "套图模板名称不能为空。", { field: "title" });
    const conflictPolicy = cleanText(payload.conflictPolicy, 20).toLowerCase();
    if (conflictPolicy && conflictPolicy !== "overwrite" && conflictPolicy !== "copy") {
      throw new CommerceTemplateLibraryError("INVALID_CONFLICT_POLICY", "同名模板处理方式只能是 overwrite 或 copy。", {
        field: "conflictPolicy"
      });
    }
    const id = cleanText(payload.id, 64).toLowerCase();
    if (id && builtInById.has(id)) throw new CommerceTemplateLibraryError("BUILTIN_TEMPLATE_READ_ONLY", "内置套图模板不能覆盖。", { id });
    if (id && conflictPolicy === "copy") {
      throw new CommerceTemplateLibraryError("INVALID_CONFLICT_POLICY", "另存为副本时不能同时指定要覆盖的模板 ID。", {
        fields: ["id", "conflictPolicy"]
      });
    }
    const currentIndex = id ? document.items.findIndex((entry) => entry.id === id) : -1;
    if (id && currentIndex < 0) throw new CommerceTemplateLibraryError("TEMPLATE_NOT_FOUND", "要覆盖的套图模板不存在或已被删除。", { id });
    const titleKey = templateTitleKey(title);
    const conflictingEntry = [
      ...builtIns,
      ...document.items.map((entry) => ({ ...entry, source: "personal" }))
    ].find((entry) => entry.id !== id && templateTitleKey(entry.title) === titleKey);
    if (conflictingEntry) {
      const suggestedCopyTitle = uniqueCopyTitle(title, [...builtIns, ...document.items]);
      if (!id && conflictPolicy === "copy") {
        title = suggestedCopyTitle;
      } else {
        throw new CommerceTemplateLibraryError("TEMPLATE_NAME_CONFLICT", `已存在同名套图模板“${conflictingEntry.title}”。`, {
          id: conflictingEntry.id,
          title: conflictingEntry.title,
          source: conflictingEntry.source === "built-in" ? "built-in" : "personal",
          currentRevision: conflictingEntry.revision,
          suggestedCopyTitle,
          allowedPolicies: conflictingEntry.source === "built-in" ? ["copy"] : ["overwrite", "copy"]
        });
      }
    } else if (!id && conflictPolicy === "overwrite") {
      throw new CommerceTemplateLibraryError("TEMPLATE_NAME_CONFLICT_MISSING", "没有找到可覆盖的同名个人模板，请刷新模板市场后重试。", {
        title
      });
    }
    if (currentIndex >= 0) {
      const current = document.items[currentIndex];
      const expectedRevision = Math.floor(Number(payload.expectedRevision) || 0);
      if (expectedRevision !== current.revision) {
        throw new CommerceTemplateLibraryError("TEMPLATE_REVISION_CONFLICT", "套图模板已发生变化，请刷新后重试。", {
          id,
          expectedRevision,
          currentRevision: current.revision
        });
      }
      const unchanged = current.title === title && (current.description || "") === description && canonicalJson(current.plan) === canonicalJson(plan);
      if (unchanged) return { ok: true, changed: false, libraryRevision: document.revision, entry: publicCommerceTemplateEntry({ ...current, source: "personal" }, true) };
      const updated = {
        ...current,
        title,
        ...(description ? { description } : {}),
        plan,
        revision: current.revision + 1,
        updatedAt: now()
      };
      if (!description) delete updated.description;
      const items = [...document.items];
      items[currentIndex] = updated;
      const next = persistDocument({ ...document, revision: document.revision + 1, items });
      return { ok: true, changed: true, libraryRevision: next.revision, entry: publicCommerceTemplateEntry({ ...updated, source: "personal" }, true) };
    }
    if (document.items.length >= COMMERCE_TEMPLATE_MAX_ITEMS) {
      throw new CommerceTemplateLibraryError("LIBRARY_LIMIT_REACHED", `个人套图模板最多保存 ${COMMERCE_TEMPLATE_MAX_ITEMS} 项。`);
    }
    const timestamp = now();
    const entry = {
      version: 1,
      id: nextId(document),
      title,
      ...(description ? { description } : {}),
      plan,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const next = persistDocument({ ...document, revision: document.revision + 1, items: [...document.items, entry] });
    return { ok: true, changed: true, libraryRevision: next.revision, entry: publicCommerceTemplateEntry({ ...entry, source: "personal" }, true) };
  }

  function remove(payload = {}) {
    if (payload.confirmed !== true) throw new CommerceTemplateLibraryError("CONFIRMATION_REQUIRED", "删除个人套图模板需要 confirmed=true。");
    const id = cleanText(payload.id, 64).toLowerCase();
    if (builtInById.has(id)) throw new CommerceTemplateLibraryError("BUILTIN_TEMPLATE_READ_ONLY", "内置套图模板不能删除。", { id });
    const document = readDocument();
    const index = document.items.findIndex((entry) => entry.id === id);
    if (index < 0) throw new CommerceTemplateLibraryError("TEMPLATE_NOT_FOUND", "套图模板不存在或已被删除。", { id });
    const current = document.items[index];
    const expectedRevision = Math.floor(Number(payload.expectedRevision) || 0);
    if (expectedRevision !== current.revision) {
      throw new CommerceTemplateLibraryError("TEMPLATE_REVISION_CONFLICT", "套图模板已发生变化，请刷新后重试。", {
        id,
        expectedRevision,
        currentRevision: current.revision
      });
    }
    const next = persistDocument({ ...document, revision: document.revision + 1, items: document.items.filter((entry) => entry.id !== id) });
    return { ok: true, changed: true, id, deletedRevision: current.revision, libraryRevision: next.revision };
  }

  async function importTemplate(owner = null) {
    if (!dialog || typeof dialog.showOpenDialog !== "function" || typeof readFileSync !== "function" || typeof statSync !== "function") {
      throw new CommerceTemplateLibraryError("IMPORT_UNAVAILABLE", "当前桌面运行时不支持导入套图模板。");
    }
    const options = {
      title: "导入套图模板",
      properties: ["openFile"],
      filters: [{ name: "SparkAI WorkSpace 套图模板", extensions: ["json"] }]
    };
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: true, canceled: true };
    const filePath = selection.filePaths[0];
    const stat = statSync(filePath);
    if (!stat?.isFile?.() || stat.size <= 0 || stat.size > COMMERCE_TEMPLATE_MAX_FILE_BYTES) {
      throw new CommerceTemplateLibraryError("IMPORT_FILE_INVALID", `套图模板文件必须是小于 ${Math.floor(COMMERCE_TEMPLATE_MAX_FILE_BYTES / 1024)} KiB 的普通 JSON 文件。`);
    }
    let parsed;
    try {
      parsed = JSON.parse(String(readFileSync(filePath, "utf8")).replace(/^\uFEFF/, ""));
    } catch {
      throw new CommerceTemplateLibraryError("IMPORT_JSON_INVALID", "套图模板不是有效 JSON 文件。");
    }
    const portable = strictPortableTemplate(parsed);
    if (!portable) throw new CommerceTemplateLibraryError("IMPORT_SCHEMA_INVALID", "套图模板格式或字段不符合 SparkAI WorkSpace v1 规范。");
    const result = save({ ...portable, conflictPolicy: "copy" });
    return { ...result, canceled: false, imported: true, sourceName: path.basename(filePath) };
  }

  async function exportTemplate(payload = {}, owner = null) {
    if (!dialog || typeof dialog.showSaveDialog !== "function" || typeof writeFileSync !== "function") {
      throw new CommerceTemplateLibraryError("EXPORT_UNAVAILABLE", "当前桌面运行时不支持导出套图模板。");
    }
    const result = get(payload);
    const entry = result.entry;
    if (entry.source === "personal") {
      const expectedRevision = Math.floor(Number(payload.expectedRevision) || 0);
      if (expectedRevision !== entry.revision) {
        throw new CommerceTemplateLibraryError("TEMPLATE_REVISION_CONFLICT", "套图模板已发生变化，请刷新后重试。", {
          id: entry.id,
          expectedRevision,
          currentRevision: entry.revision
        });
      }
    }
    const fileStem = entry.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 80) || "commerce-template";
    const options = {
      title: "导出套图模板",
      defaultPath: `${fileStem}.naimage-commerce-template.json`,
      filters: [{ name: "SparkAI WorkSpace 套图模板", extensions: ["json"] }]
    };
    const selection = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { ok: true, canceled: true };
    const document = portableTemplateDocument(entry);
    writeFileSync(selection.filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return { ok: true, canceled: false, path: selection.filePath, entry };
  }

  return { exportTemplate, get, importTemplate, list, remove, save };
}

module.exports = {
  COMMERCE_TEMPLATE_ID_PATTERN,
  COMMERCE_TEMPLATE_MAX_FILE_BYTES,
  COMMERCE_TEMPLATE_MAX_ITEMS,
  COMMERCE_TEMPLATE_PORTABLE_TYPE,
  COMMERCE_TEMPLATE_SCHEMA_VERSION,
  CommerceTemplateLibraryError,
  builtInCommerceTemplates,
  createCommerceTemplateLibraryService,
  portableCommerceTemplatePlan,
  portableTemplateDocument,
  publicCommerceTemplateEntry,
  reusableCommerceTemplatePlan,
  sanitizeCommerceTemplateDocument,
  sanitizeCommerceTemplateEntry,
  strictPortableTemplate
};
