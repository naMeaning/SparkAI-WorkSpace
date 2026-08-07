"use strict";

const { randomBytes } = require("node:crypto");
const { normalizeSocialContentPlan } = require("../runtime/social-content-plan.cjs");
const { normalizeScientificFigurePlan } = require("../runtime/scientific-figure-plan.cjs");

const REQUIREMENT_LIBRARY_SCHEMA_VERSION = 1;
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

function sanitizeRequirementLibrarySkill(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const name = cleanText(value.name, 120);
  const description = cleanText(value.description, 2_000);
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
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const id = cleanText(value.id, 48).toLowerCase();
  const text = cleanText(value.text, REQUIREMENT_LIBRARY_MAX_TEXT);
  if (!REQUIREMENT_LIBRARY_ID_PATTERN.test(id) || !text) return null;
  const title = cleanText(value.title, REQUIREMENT_LIBRARY_MAX_TITLE)
    || cleanText(text.split(/\r?\n/, 1)[0], REQUIREMENT_LIBRARY_MAX_TITLE)
    || "图片处理需求";
  const createdAt = normalizedTimestamp(value.createdAt, fallbackNow);
  const updatedAt = normalizedTimestamp(value.updatedAt, createdAt);
  const skill = sanitizeRequirementLibrarySkill(value.skill);
  const socialPlan = value.socialPlan && typeof value.socialPlan === "object" &&
    (value.socialPlan.platform === "xiaohongshu" || value.socialPlan.platform === "douyin")
    ? normalizeSocialContentPlan(value.socialPlan)
    : null;
  const scientificPlan = value.scientificPlan && typeof value.scientificPlan === "object" && value.scientificPlan.schemaVersion === 1
    ? normalizeScientificFigurePlan(value.scientificPlan)
    : null;
  return {
    version: 1,
    id,
    title,
    text,
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
    createdAt,
    updatedAt,
    ...(skill ? { skill } : {}),
    ...(socialPlan?.brief ? { socialPlan } : {}),
    ...(scientificPlan?.researchClaim ? { scientificPlan } : {})
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
    version: 1,
    id: entry.id,
    title: entry.title,
    revision: entry.revision,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    summary: entry.text.replace(/\s+/g, " ").trim().slice(0, 240),
    ...(includeText ? { text: entry.text } : {}),
    ...(entry.skill ? { skill: { ...entry.skill } } : {}),
    ...(entry.socialPlan ? { socialPlan: structuredClone(entry.socialPlan) } : {}),
    ...(entry.scientificPlan ? { scientificPlan: structuredClone(entry.scientificPlan) } : {})
  };
}

function createRequirementLibraryService({
  libraryPath,
  readJson,
  writeJson,
  now = () => new Date().toISOString(),
  createId = () => `reqtpl-${randomBytes(16).toString("hex")}`
} = {}) {
  if (typeof libraryPath !== "string" || !libraryPath.trim()) throw new TypeError("requirement libraryPath is required");
  if (typeof readJson !== "function" || typeof writeJson !== "function") throw new TypeError("requirement library JSON IO is required");

  const emptyDocument = () => ({ schemaVersion: REQUIREMENT_LIBRARY_SCHEMA_VERSION, revision: 0, items: [] });
  let cachedDocument = null;

  function readDocument() {
    if (cachedDocument) return cachedDocument;
    cachedDocument = sanitizeRequirementLibraryDocument(readJson(libraryPath, emptyDocument()), now());
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
    const text = cleanText(payload.text, REQUIREMENT_LIBRARY_MAX_TEXT);
    if (!text) throw new RequirementLibraryError("INVALID_TEMPLATE", "需求模板正文不能为空。", { field: "text" });
    const title = cleanText(payload.title, REQUIREMENT_LIBRARY_MAX_TITLE)
      || cleanText(text.split(/\r?\n/, 1)[0], REQUIREMENT_LIBRARY_MAX_TITLE)
      || "图片处理需求";
    let skill;
    if (payload.skill !== undefined && payload.skill !== null) {
      skill = sanitizeRequirementLibrarySkill(payload.skill);
      if (!skill) throw new RequirementLibraryError("INVALID_TEMPLATE", "需求模板包含无效的 Skill 身份。", { field: "skill" });
    }
    let socialPlan;
    if (payload.socialPlan !== undefined && payload.socialPlan !== null) {
      socialPlan = normalizeSocialContentPlan(payload.socialPlan);
      if (!socialPlan.brief) throw new RequirementLibraryError("INVALID_TEMPLATE", "社媒模板缺少内容 Brief。", { field: "socialPlan.brief" });
    }
    let scientificPlan;
    if (payload.scientificPlan !== undefined && payload.scientificPlan !== null) {
      scientificPlan = normalizeScientificFigurePlan(payload.scientificPlan);
      if (!scientificPlan.researchClaim) {
        throw new RequirementLibraryError("INVALID_TEMPLATE", "科研模板缺少需要图件支撑的核心结论。", { field: "scientificPlan.researchClaim" });
      }
      if (!scientificPlan.backend) {
        throw new RequirementLibraryError("INVALID_TEMPLATE", "科研模板必须明确选择 Python 或 R 后端。", { field: "scientificPlan.backend" });
      }
    }
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
      if (current.title === title && current.text === text && sameSkill && sameSocialPlan && sameScientificPlan) {
        return {
          ok: true,
          changed: false,
          libraryRevision: document.revision,
          entry: publicRequirementLibraryEntry(current, true)
        };
      }
      const updated = {
        ...current,
        title,
        text,
        revision: current.revision + 1,
        updatedAt: now(),
        ...(skill ? { skill } : {}),
        ...(socialPlan ? { socialPlan } : {}),
        ...(scientificPlan ? { scientificPlan } : {})
      };
      if (!skill) delete updated.skill;
      if (!socialPlan) delete updated.socialPlan;
      if (!scientificPlan) delete updated.scientificPlan;
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
      version: 1,
      id: nextId(document),
      title,
      text,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(skill ? { skill } : {}),
      ...(socialPlan ? { socialPlan } : {}),
      ...(scientificPlan ? { scientificPlan } : {})
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

  return { get, list, remove, save };
}

module.exports = {
  REQUIREMENT_LIBRARY_ID_PATTERN,
  REQUIREMENT_LIBRARY_MAX_ITEMS,
  REQUIREMENT_LIBRARY_SCHEMA_VERSION,
  RequirementLibraryError,
  createRequirementLibraryService,
  publicRequirementLibraryEntry,
  sanitizeRequirementLibraryDocument,
  sanitizeRequirementLibraryEntry,
  sanitizeRequirementLibrarySkill
};
