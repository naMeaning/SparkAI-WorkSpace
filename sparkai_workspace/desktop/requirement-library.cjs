"use strict";

const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { normalizeSocialContentPlan } = require("../runtime/social-content-plan.cjs");
const { normalizeScientificFigurePlan } = require("../runtime/scientific-figure-plan.cjs");
const { normalizeRequirementTemplate, expandRequirementTemplate, reusableRequirementTemplateFromTask, reusableRequirementText } = require("../runtime/requirement-template-contract.mjs");

const REQUIREMENT_LIBRARY_SCHEMA_VERSION = 2;
const REQUIREMENT_TEMPLATE_PORTABLE_TYPE = "naimage-requirement-template";
const REQUIREMENT_TEMPLATE_MAX_FILE_BYTES = 1024 * 1024;
const REQUIREMENT_LIBRARY_MAX_ITEMS = 200;
const REQUIREMENT_LIBRARY_MAX_TITLE = 120;
const REQUIREMENT_LIBRARY_MAX_TEXT = 24_000;
const REQUIREMENT_LIBRARY_ID_PATTERN = /^reqtpl-[a-f0-9]{32}$/;

class RequirementLibraryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RequirementLibraryError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, maximum)
    : "";
}

function normalizedTimestamp(value, fallback) {
  const candidate = cleanText(value, 80);
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : fallback;
}

function cleanPlan(value) {
  if (typeof value === "string") return reusableRequirementText(value);
  if (Array.isArray(value)) return value.map(cleanPlan);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanPlan(item)]));
  return value;
}

function reusableSocialPlan(value) {
  const plan = cleanPlan(normalizeSocialContentPlan(value));
  delete plan.workflowId; delete plan.planHash; delete plan.videoTaskId; delete plan.videoNodeId;
  plan.status = "draft";
  if (plan.cover) plan.cover.status = "draft";
  for (const card of plan.cards || []) card.status = "draft";
  for (const shot of plan.shots || []) shot.status = "draft";
  return plan;
}

function reusableScientificPlan(value) {
  const plan = cleanPlan(normalizeScientificFigurePlan({ ...value, dataSources: [] }));
  delete plan.workflowId; delete plan.planHash; delete plan.taskId;
  plan.dataSources = []; plan.status = "planned";
  for (const panel of plan.panels || []) { panel.sourceBindings = []; panel.status = "planned"; }
  return plan;
}

function sanitizeRequirementLibrarySkill(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const name = reusableRequirementText(value.name, 120);
  const description = reusableRequirementText(value.description, 2_000);
  const sourceName = cleanText(cleanText(value.sourceName, 1_000).replace(/\\/g, "/").split("/").pop(), 180);
  const contentFingerprint = cleanText(value.contentFingerprint, 48).toLowerCase();
  const importedAt = cleanText(value.importedAt, 80);
  const locallyModifiedAt = cleanText(value.locallyModifiedAt, 80);
  if (!name || !/^skill-[a-f0-9]{32}$/.test(contentFingerprint) || !importedAt) return null;
  return {
    version: 1,
    name,
    ...(description ? { description } : {}),
    ...(sourceName ? { sourceName } : {}),
    contentFingerprint,
    importedAt,
    ...(locallyModifiedAt ? { locallyModifiedAt } : {})
  };
}

function sanitizeRequirementLibraryEntry(value, fallbackNow = new Date().toISOString()) {
  if (!value || typeof value !== "object" || ![1, 2].includes(value.version)) return null;
  const id = cleanText(value.id, 48).toLowerCase();
  const text = reusableRequirementText(value.text, REQUIREMENT_LIBRARY_MAX_TEXT);
  if (!REQUIREMENT_LIBRARY_ID_PATTERN.test(id) || !text) return null;
  const title = reusableRequirementText(value.title, REQUIREMENT_LIBRARY_MAX_TITLE)
    || cleanText(text.split(/\r?\n/, 1)[0], REQUIREMENT_LIBRARY_MAX_TITLE)
    || "图片处理需求";
  const createdAt = normalizedTimestamp(value.createdAt, fallbackNow);
  const updatedAt = normalizedTimestamp(value.updatedAt, createdAt);
  const skill = sanitizeRequirementLibrarySkill(value.skill);
  const socialPlan = value.socialPlan && typeof value.socialPlan === "object" &&
    (value.socialPlan.platform === "xiaohongshu" || value.socialPlan.platform === "douyin")
    ? reusableSocialPlan(value.socialPlan)
    : null;
  const scientificPlan = value.scientificPlan && typeof value.scientificPlan === "object" && value.scientificPlan.schemaVersion === 1
    ? reusableScientificPlan(value.scientificPlan)
    : null;
  let template;
  try { if (value.template !== undefined) template = normalizeRequirementTemplate(value.template, text); } catch { return null; }
  if (value.version === 2 && !template) return null;
  return {
    version: template ? 2 : 1,
    id,
    title,
    text,
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
    createdAt,
    updatedAt,
    ...(skill ? { skill } : {}),
    ...(socialPlan?.brief ? { socialPlan } : {}),
    ...(scientificPlan?.researchClaim ? { scientificPlan } : {}),
    ...(template ? { template } : {})
  };
}

function sanitizeRequirementLibraryDocument(value, fallbackNow = new Date().toISOString()) {
  const source = value && typeof value === "object" ? value : {};
  const entries = [];
  const seen = new Set();
  for (const candidate of Array.isArray(source.items) ? source.items : []) {
    const entry = sanitizeRequirementLibraryEntry(candidate, fallbackNow);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= REQUIREMENT_LIBRARY_MAX_ITEMS) break;
  }
  return {
    schemaVersion: REQUIREMENT_LIBRARY_SCHEMA_VERSION,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    items: entries
  };
}

function publicRequirementLibraryEntry(entry, includeText = false) {
  return {
    version: entry.version,
    id: entry.id,
    title: entry.title,
    revision: entry.revision,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    summary: entry.text.replace(/\s+/g, " ").trim().slice(0, 240),
    ...(includeText ? { text: entry.text } : {}),
    ...(entry.skill ? { skill: { ...entry.skill } } : {}),
    ...(entry.socialPlan ? { socialPlan: structuredClone(entry.socialPlan) } : {}),
    ...(entry.scientificPlan ? { scientificPlan: structuredClone(entry.scientificPlan) } : {}),
    ...(entry.template ? { template: structuredClone(entry.template) } : {})
  };
}

function portableRequirementTemplate(entry) {
  return { type: REQUIREMENT_TEMPLATE_PORTABLE_TYPE, schemaVersion: entry.template ? 2 : 1,
    title: entry.title, text: entry.text, ...(entry.skill ? { skill: structuredClone(entry.skill) } : {}),
    ...(entry.socialPlan ? { socialPlan: reusableSocialPlan(entry.socialPlan) } : {}),
    ...(entry.scientificPlan ? { scientificPlan: reusableScientificPlan(entry.scientificPlan) } : {}),
    ...(entry.template ? { template: normalizeRequirementTemplate(entry.template, entry.text) } : {}) };
}

function strictPortableRequirementTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.type !== REQUIREMENT_TEMPLATE_PORTABLE_TYPE || ![1, 2].includes(value.schemaVersion)) return null;
  if (Object.keys(value).some(key => !["type", "schemaVersion", "title", "text", "skill", "socialPlan", "scientificPlan", "template"].includes(key)) || (value.schemaVersion === 2) !== Boolean(value.template)) return null;
  const entry = sanitizeRequirementLibraryEntry({ ...value, id: `reqtpl-${"0".repeat(32)}`, version: value.schemaVersion }, "2000-01-01T00:00:00.000Z");
  if (!entry) return null;
  const normalized = portableRequirementTemplate(entry);
  const canonical = candidate => Array.isArray(candidate) ? `[${candidate.map(canonical).join(",")}]` : candidate && typeof candidate === "object" ? `{${Object.keys(candidate).sort().map(key => `${JSON.stringify(key)}:${canonical(candidate[key])}`).join(",")}}` : JSON.stringify(candidate);
  return canonical(value) === canonical(normalized) ? normalized : null;
}

function createRequirementLibraryService({
  libraryPath,
  readJson,
  writeJson,
  dialog,
  readFileSync,
  writeFileSync,
  statSync,
  now = () => new Date().toISOString(),
  createId = () => `reqtpl-${randomBytes(16).toString("hex")}`
} = {}) {
  if (typeof libraryPath !== "string" || !libraryPath.trim()) throw new TypeError("requirement libraryPath is required");
  if (typeof readJson !== "function" || typeof writeJson !== "function") throw new TypeError("requirement library JSON IO is required");

  const emptyDocument = () => ({ schemaVersion: REQUIREMENT_LIBRARY_SCHEMA_VERSION, revision: 0, items: [] });
  let cachedDocument = null;

  function readDocument() {
    if (cachedDocument) return cachedDocument;
    const source = readJson(libraryPath, emptyDocument());
    if (source?.schemaVersion !== undefined && ![1, 2].includes(source.schemaVersion)) throw new RequirementLibraryError("LIBRARY_SCHEMA_UNSUPPORTED", "需求模板库版本暂不受支持，原文件已保留。");
    cachedDocument = sanitizeRequirementLibraryDocument(source, now());
    return cachedDocument;
  }

  function persistDocument(document) {
    const sanitized = sanitizeRequirementLibraryDocument(document, now());
    writeJson(libraryPath, sanitized);
    cachedDocument = sanitized;
    return sanitized;
  }

  function nextId(document) {
    const used = new Set(document.items.map((entry) => entry.id));
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = cleanText(createId(), 48).toLowerCase();
      if (REQUIREMENT_LIBRARY_ID_PATTERN.test(candidate) && !used.has(candidate)) return candidate;
    }
    throw new RequirementLibraryError("ID_ALLOCATION_FAILED", "无法为需求模板分配唯一 ID。");
  }

  function list(options = {}) {
    const document = readDocument();
    const includeText = options?.includeText === true;
    const items = [...document.items]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map((entry) => publicRequirementLibraryEntry(entry, includeText));
    return { ok: true, schemaVersion: REQUIREMENT_LIBRARY_SCHEMA_VERSION, libraryRevision: document.revision, items };
  }

  function get(payload = {}) {
    const id = cleanText(payload.id, 48).toLowerCase();
    const document = readDocument();
    const entry = document.items.find((candidate) => candidate.id === id);
    if (!entry) throw new RequirementLibraryError("TEMPLATE_NOT_FOUND", "需求模板不存在或已被删除。", { id });
    return {
      ok: true,
      schemaVersion: REQUIREMENT_LIBRARY_SCHEMA_VERSION,
      libraryRevision: document.revision,
      entry: publicRequirementLibraryEntry(entry, true)
    };
  }

  function save(payload = {}) {
    const document = readDocument();
    if (typeof payload.text !== "string" || payload.text.length > REQUIREMENT_LIBRARY_MAX_TEXT) throw new RequirementLibraryError("INVALID_TEMPLATE", "需求正文必须是不超过 24000 字的文本。", { field: "text" });
    const text = reusableRequirementText(payload.text, REQUIREMENT_LIBRARY_MAX_TEXT);
    if (!text) throw new RequirementLibraryError("INVALID_TEMPLATE", "需求模板正文不能为空。", { field: "text" });
    const title = reusableRequirementText(payload.title, REQUIREMENT_LIBRARY_MAX_TITLE)
      || cleanText(text.split(/\r?\n/, 1)[0], REQUIREMENT_LIBRARY_MAX_TITLE)
      || "图片处理需求";
    let skill;
    if (payload.skill !== undefined && payload.skill !== null) {
      skill = sanitizeRequirementLibrarySkill(payload.skill);
      if (!skill) throw new RequirementLibraryError("INVALID_TEMPLATE", "需求模板包含无效的 Skill 身份。", { field: "skill" });
    }
    let socialPlan;
    if (payload.socialPlan !== undefined && payload.socialPlan !== null) {
      socialPlan = reusableSocialPlan(payload.socialPlan);
      if (!socialPlan.brief) throw new RequirementLibraryError("INVALID_TEMPLATE", "社媒模板缺少内容 Brief。", { field: "socialPlan.brief" });
    }
    let scientificPlan;
    if (payload.scientificPlan !== undefined && payload.scientificPlan !== null) {
      scientificPlan = reusableScientificPlan(payload.scientificPlan);
      if (!scientificPlan.researchClaim) {
        throw new RequirementLibraryError("INVALID_TEMPLATE", "科研模板缺少需要图件支撑的核心结论。", { field: "scientificPlan.researchClaim" });
      }
      if (!scientificPlan.backend) {
        throw new RequirementLibraryError("INVALID_TEMPLATE", "科研模板必须明确选择 Python 或 R 后端。", { field: "scientificPlan.backend" });
      }
    }
    const template = payload.template === undefined ? undefined : normalizeRequirementTemplate(payload.template, text);
    const id = cleanText(payload.id, 48).toLowerCase();
    const currentIndex = id ? document.items.findIndex((entry) => entry.id === id) : -1;
    if (id && currentIndex < 0) {
      throw new RequirementLibraryError("TEMPLATE_NOT_FOUND", "要覆盖的需求模板不存在或已被删除。", { id });
    }
    if (currentIndex >= 0) {
      const current = document.items[currentIndex];
      const expectedRevision = Math.floor(Number(payload.expectedRevision) || 0);
      if (expectedRevision !== current.revision) {
        throw new RequirementLibraryError("TEMPLATE_REVISION_CONFLICT", "需求模板已发生变化，请刷新模板库后重试。", {
          id: current.id,
          expectedRevision,
          currentRevision: current.revision
        });
      }
      const sameSkill = JSON.stringify(current.skill || null) === JSON.stringify(skill || null);
      const sameSocialPlan = JSON.stringify(current.socialPlan || null) === JSON.stringify(socialPlan || null);
      const sameScientificPlan = JSON.stringify(current.scientificPlan || null) === JSON.stringify(scientificPlan || null);
      const sameTemplate = JSON.stringify(current.template || null) === JSON.stringify(template || null);
      if (current.title === title && current.text === text && sameSkill && sameSocialPlan && sameScientificPlan && sameTemplate) {
        return {
          ok: true,
          changed: false,
          libraryRevision: document.revision,
          entry: publicRequirementLibraryEntry(current, true)
        };
      }
      const updated = {
        ...current,
        version: template ? 2 : 1,
        title,
        text,
        revision: current.revision + 1,
        updatedAt: now(),
        ...(skill ? { skill } : {}),
        ...(socialPlan ? { socialPlan } : {}),
        ...(scientificPlan ? { scientificPlan } : {}),
        ...(template ? { template } : {})
      };
      if (!skill) delete updated.skill;
      if (!socialPlan) delete updated.socialPlan;
      if (!scientificPlan) delete updated.scientificPlan;
      if (!template) delete updated.template;
      const nextItems = [...document.items];
      nextItems[currentIndex] = updated;
      const nextDocument = persistDocument({ ...document, revision: document.revision + 1, items: nextItems });
      return {
        ok: true,
        changed: true,
        libraryRevision: nextDocument.revision,
        entry: publicRequirementLibraryEntry(updated, true)
      };
    }

    if (document.items.length >= REQUIREMENT_LIBRARY_MAX_ITEMS) {
      throw new RequirementLibraryError("LIBRARY_LIMIT_REACHED", `个人需求模板库最多保存 ${REQUIREMENT_LIBRARY_MAX_ITEMS} 项。`, {
        maximum: REQUIREMENT_LIBRARY_MAX_ITEMS
      });
    }
    const timestamp = now();
    const entry = {
      version: template ? 2 : 1,
      id: nextId(document),
      title,
      text,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(skill ? { skill } : {}),
      ...(socialPlan ? { socialPlan } : {}),
      ...(scientificPlan ? { scientificPlan } : {}),
      ...(template ? { template } : {})
    };
    const nextDocument = persistDocument({ ...document, revision: document.revision + 1, items: [...document.items, entry] });
    return {
      ok: true,
      changed: true,
      libraryRevision: nextDocument.revision,
      entry: publicRequirementLibraryEntry(entry, true)
    };
  }

  function remove(payload = {}) {
    if (payload.confirmed !== true) {
      throw new RequirementLibraryError("CONFIRMATION_REQUIRED", "删除个人需求模板需要 confirmed=true。", { field: "confirmed" });
    }
    const id = cleanText(payload.id, 48).toLowerCase();
    const document = readDocument();
    const currentIndex = document.items.findIndex((entry) => entry.id === id);
    if (currentIndex < 0) throw new RequirementLibraryError("TEMPLATE_NOT_FOUND", "需求模板不存在或已被删除。", { id });
    const current = document.items[currentIndex];
    const expectedRevision = Math.floor(Number(payload.expectedRevision) || 0);
    if (expectedRevision !== current.revision) {
      throw new RequirementLibraryError("TEMPLATE_REVISION_CONFLICT", "需求模板已发生变化，请刷新模板库后重试。", {
        id,
        expectedRevision,
        currentRevision: current.revision
      });
    }
    const nextDocument = persistDocument({
      ...document,
      revision: document.revision + 1,
      items: document.items.filter((entry) => entry.id !== id)
    });
    return { ok: true, changed: true, id, deletedRevision: current.revision, libraryRevision: nextDocument.revision };
  }

  function apply(payload = {}) {
    const detail = get(payload);
    const application = expandRequirementTemplate(detail.entry, payload);
    return { ...detail, application };
  }

  function saveFromTask(payload = {}) {
    const reusable = reusableRequirementTemplateFromTask(payload);
    return save({ ...reusable, ...(payload.id ? { id: payload.id, expectedRevision: payload.expectedRevision } : {}) });
  }

  async function importTemplate(owner = null) {
    if (!dialog?.showOpenDialog || typeof readFileSync !== "function" || typeof statSync !== "function") throw new RequirementLibraryError("IMPORT_UNAVAILABLE", "当前桌面运行时不支持导入需求模板。");
    const options = { title: "导入需求模板", properties: ["openFile"], filters: [{ name: "SparkAI WorkSpace 需求模板", extensions: ["json"] }] };
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: true, canceled: true };
    const file = selection.filePaths[0], stat = statSync(file);
    if (!stat?.isFile?.() || stat.size <= 0 || stat.size > REQUIREMENT_TEMPLATE_MAX_FILE_BYTES) throw new RequirementLibraryError("IMPORT_FILE_INVALID", "需求模板必须是不超过 1 MiB 的普通 JSON 文件。");
    let parsed;
    try { parsed = JSON.parse(String(readFileSync(file, "utf8")).replace(/^\uFEFF/, "")); } catch { throw new RequirementLibraryError("IMPORT_JSON_INVALID", "需求模板不是有效 JSON。"); }
    const portable = strictPortableRequirementTemplate(parsed);
    if (!portable) throw new RequirementLibraryError("IMPORT_SCHEMA_INVALID", "需求模板版本或字段不符合已支持的 v1/v2 格式。");
    return { ...save(portable), imported: true, canceled: false, sourceName: path.basename(file) };
  }

  async function exportTemplate(payload = {}, owner = null) {
    if (!dialog?.showSaveDialog || typeof writeFileSync !== "function") throw new RequirementLibraryError("EXPORT_UNAVAILABLE", "当前桌面运行时不支持导出需求模板。");
    const result = get(payload), entry = result.entry;
    if (payload.expectedRevision !== entry.revision) throw new RequirementLibraryError("TEMPLATE_REVISION_CONFLICT", "模板版本已变化，请刷新后导出。", { currentRevision: entry.revision });
    const stem = entry.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 80) || "requirement-template";
    const options = { title: "导出需求模板", defaultPath: `${stem}.naimage-requirement-template.json`, filters: [{ name: "SparkAI WorkSpace 需求模板", extensions: ["json"] }] };
    const selection = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { ok: true, canceled: true };
    const document = portableRequirementTemplate(entry);
    if (!strictPortableRequirementTemplate(document)) throw new RequirementLibraryError("EXPORT_SCHEMA_INVALID", "模板无法通过可移植格式检查，未写入文件。");
    writeFileSync(selection.filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return { ok: true, canceled: false, fileName: path.basename(selection.filePath), entry };
  }

  return { apply, exportTemplate, get, importTemplate, list, remove, save, saveFromTask };
}

module.exports = {
  REQUIREMENT_LIBRARY_ID_PATTERN,
  REQUIREMENT_LIBRARY_MAX_ITEMS,
  REQUIREMENT_LIBRARY_SCHEMA_VERSION,
  REQUIREMENT_TEMPLATE_MAX_FILE_BYTES,
  REQUIREMENT_TEMPLATE_PORTABLE_TYPE,
  RequirementLibraryError,
  createRequirementLibraryService,
  publicRequirementLibraryEntry,
  portableRequirementTemplate,
  strictPortableRequirementTemplate,
  reusableScientificPlan,
  reusableSocialPlan,
  sanitizeRequirementLibraryDocument,
  sanitizeRequirementLibraryEntry,
  sanitizeRequirementLibrarySkill
};
