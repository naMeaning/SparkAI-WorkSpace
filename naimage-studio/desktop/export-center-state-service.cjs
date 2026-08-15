"use strict";

const { randomBytes } = require("node:crypto");
const { lstat, mkdir, readFile, realpath, rename, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

const EXPORT_CENTER_STATE_RELATIVE_PATH = path.join(".naimage", "export-center.json");
const EXPORT_CENTER_STATE_FORMAT = "sparkai-export-center";
const EXPORT_CENTER_STATE_VERSION = 1;
const MAX_PRESETS = 24;
const MAX_HISTORY = 100;
const MAX_STATE_BYTES = 512 * 1024;
const TARGETS = new Set(["image", "collection", "psd"]);
const FORMATS = new Set(["png", "jpeg", "webp", "avif", "tiff", "psd"]);
const CONFLICT_POLICIES = new Set(["overwrite", "keep-both", "skip"]);
const HISTORY_STATUSES = new Set(["succeeded", "failed", "skipped"]);

class ExportCenterStateError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ExportCenterStateError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

function positiveInteger(value, fallback = 0, maximum = 100_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, maximum) : fallback;
}

function safeId(value, prefix) {
  const id = cleanText(value, 120);
  return /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(id)
    ? id
    : `${prefix}-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
}

function safeRelativePath(value) {
  const normalized = cleanText(value, 500).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return "";
  return segments.join("/");
}

function normalizePreset(value = {}, existing, touch = true) {
  const target = TARGETS.has(value.target) ? value.target : "image";
  const format = FORMATS.has(value.format) ? value.format : target === "psd" ? "psd" : "png";
  const conflictPolicy = CONFLICT_POLICIES.has(value.conflictPolicy) ? value.conflictPolicy : "overwrite";
  const name = cleanText(value.name, 80);
  if (!name) throw new ExportCenterStateError("EXPORT_PRESET_NAME_REQUIRED", "请输入导出预设名称。", { field: "name" });
  const now = new Date().toISOString();
  return {
    id: safeId(value.id || existing?.id, "export-preset"),
    name,
    target,
    format,
    filenameTemplate: cleanText(value.filenameTemplate, 160) || "{title}-{index}",
    conflictPolicy,
    incremental: value.incremental === true,
    createdAt: cleanText(existing?.createdAt || value.createdAt, 80) || now,
    updatedAt: touch ? now : cleanText(value.updatedAt, 80) || now
  };
}

function normalizeHistoryEntry(value = {}) {
  const target = TARGETS.has(value.target) ? value.target : "image";
  const status = HISTORY_STATUSES.has(value.status) ? value.status : "failed";
  const format = FORMATS.has(value.format) ? value.format : target === "psd" ? "psd" : "png";
  return {
    id: safeId(value.id, "export-history"),
    jobId: safeId(value.jobId, "export-job"),
    target,
    status,
    format,
    label: cleanText(value.label, 160) || (target === "collection" ? "图片组导出" : target === "psd" ? "PSD 导出" : "图片导出"),
    itemCount: positiveInteger(value.itemCount),
    exportedCount: positiveInteger(value.exportedCount),
    skippedCount: positiveInteger(value.skippedCount),
    totalBytes: positiveInteger(value.totalBytes, 0, Number.MAX_SAFE_INTEGER),
    relativePaths: Array.isArray(value.relativePaths)
      ? [...new Set(value.relativePaths.map(safeRelativePath).filter(Boolean))].slice(0, 200)
      : [],
    errorCode: cleanText(value.errorCode, 120) || undefined,
    error: cleanText(value.error, 500) || undefined,
    startedAt: cleanText(value.startedAt, 80) || undefined,
    finishedAt: cleanText(value.finishedAt, 80) || new Date().toISOString()
  };
}

function emptyState() {
  return {
    format: EXPORT_CENTER_STATE_FORMAT,
    version: EXPORT_CENTER_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    presets: [],
    history: []
  };
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const presets = [];
  for (const item of Array.isArray(source.presets) ? source.presets : []) {
    try {
      const preset = normalizePreset(item, item, false);
      if (!presets.some((candidate) => candidate.id === preset.id)) presets.push(preset);
    } catch {
      // Invalid user-edited presets are ignored without losing valid entries.
    }
  }
  const history = (Array.isArray(source.history) ? source.history : [])
    .map(normalizeHistoryEntry)
    .slice(-MAX_HISTORY);
  return {
    format: EXPORT_CENTER_STATE_FORMAT,
    version: EXPORT_CENTER_STATE_VERSION,
    updatedAt: cleanText(source.updatedAt, 80) || new Date().toISOString(),
    presets: presets.slice(0, MAX_PRESETS),
    history
  };
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(candidate, root) {
  const candidatePath = comparablePath(candidate);
  const rootPath = comparablePath(root);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function createExportCenterStateService({ getProjectById, readProjectList } = {}) {
  if (typeof getProjectById !== "function" || typeof readProjectList !== "function") {
    throw new TypeError("export center project services are required");
  }
  let writeQueue = Promise.resolve();

  function projectForId(value) {
    const projectId = cleanText(value, 160);
    const list = readProjectList();
    if (!projectId || projectId !== cleanText(list?.activeProjectId, 160)) {
      throw new ExportCenterStateError("PROJECT_CHANGED", "当前项目已切换，请重新打开导出中心。", { projectId });
    }
    const project = getProjectById(projectId, list);
    if (!project?.path) throw new ExportCenterStateError("PROJECT_NOT_FOUND", "当前项目不存在或已被移除。", { projectId });
    return project;
  }

  async function statePath(project, create = false) {
    const declaredRoot = path.resolve(project.path);
    const rootStats = await lstat(declaredRoot).catch(() => null);
    if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
      throw new ExportCenterStateError("PROJECT_PATH_INVALID", "当前项目目录不可用。");
    }
    const realRoot = await realpath(declaredRoot);
    const metaRoot = path.join(realRoot, ".naimage");
    if (create) await mkdir(metaRoot, { recursive: true });
    const metaStats = await lstat(metaRoot).catch(() => null);
    if (metaStats && (!metaStats.isDirectory() || metaStats.isSymbolicLink())) {
      throw new ExportCenterStateError("EXPORT_CENTER_PATH_INVALID", "项目导出配置目录不安全。");
    }
    if (metaStats) {
      const realMetaRoot = await realpath(metaRoot);
      if (!isPathInside(realMetaRoot, realRoot)) throw new ExportCenterStateError("EXPORT_CENTER_PATH_INVALID", "项目导出配置目录越过了项目边界。");
    }
    return path.join(metaRoot, "export-center.json");
  }

  async function loadForProject(project) {
    const filePath = await statePath(project, false);
    const stats = await lstat(filePath).catch(() => null);
    if (!stats) return emptyState();
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_STATE_BYTES) {
      throw new ExportCenterStateError("EXPORT_CENTER_STATE_INVALID", "项目导出中心配置文件无效。");
    }
    try {
      return normalizeState(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (error instanceof ExportCenterStateError) throw error;
      throw new ExportCenterStateError("EXPORT_CENTER_STATE_INVALID", "项目导出中心配置文件无法解析。");
    }
  }

  async function saveForProject(project, state) {
    const filePath = await statePath(project, true);
    const normalized = { ...normalizeState(state), updatedAt: new Date().toISOString() };
    const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return normalized;
  }

  function serialized(operation) {
    const run = writeQueue.then(operation, operation);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function load(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    return { ok: true, projectId: project.id, state: await loadForProject(project) };
  }

  async function savePreset(payload = {}) {
    return serialized(async () => {
      const project = projectForId(payload.expectedProjectId ?? payload.projectId);
      const state = await loadForProject(project);
      const requestedId = cleanText(payload.preset?.id, 120);
      const existingIndex = requestedId ? state.presets.findIndex((item) => item.id === requestedId) : -1;
      let preset = normalizePreset(payload.preset, existingIndex >= 0 ? state.presets[existingIndex] : undefined);
      if (existingIndex >= 0) state.presets.splice(existingIndex, 1, preset);
      else {
        const sameName = state.presets.findIndex((item) => item.name.toLocaleLowerCase("zh-CN") === preset.name.toLocaleLowerCase("zh-CN"));
        if (sameName >= 0) {
          preset = { ...preset, id: state.presets[sameName].id, createdAt: state.presets[sameName].createdAt };
          state.presets.splice(sameName, 1, preset);
        }
        else state.presets.push(preset);
      }
      state.presets = state.presets.slice(-MAX_PRESETS);
      return { ok: true, projectId: project.id, preset, state: await saveForProject(project, state) };
    });
  }

  async function deletePreset(payload = {}) {
    return serialized(async () => {
      const project = projectForId(payload.expectedProjectId ?? payload.projectId);
      const presetId = cleanText(payload.presetId, 120);
      if (!presetId) throw new ExportCenterStateError("EXPORT_PRESET_ID_REQUIRED", "请选择要删除的导出预设。");
      const state = await loadForProject(project);
      const before = state.presets.length;
      state.presets = state.presets.filter((item) => item.id !== presetId);
      return { ok: true, projectId: project.id, deleted: before - state.presets.length, state: await saveForProject(project, state) };
    });
  }

  async function recordHistory(payload = {}) {
    return serialized(async () => {
      const project = projectForId(payload.expectedProjectId ?? payload.projectId);
      const state = await loadForProject(project);
      const entry = normalizeHistoryEntry(payload.entry);
      state.history = [...state.history.filter((item) => item.id !== entry.id), entry].slice(-MAX_HISTORY);
      return { ok: true, projectId: project.id, entry, state: await saveForProject(project, state) };
    });
  }

  async function clearHistory(payload = {}) {
    return serialized(async () => {
      const project = projectForId(payload.expectedProjectId ?? payload.projectId);
      const state = await loadForProject(project);
      const cleared = state.history.length;
      state.history = [];
      return { ok: true, projectId: project.id, cleared, state: await saveForProject(project, state) };
    });
  }

  return { load, savePreset, deletePreset, recordHistory, clearHistory };
}

module.exports = {
  EXPORT_CENTER_STATE_FORMAT,
  EXPORT_CENTER_STATE_RELATIVE_PATH,
  EXPORT_CENTER_STATE_VERSION,
  ExportCenterStateError,
  createExportCenterStateService,
  normalizeHistoryEntry,
  normalizePreset,
  normalizeState,
  safeRelativePath
};
