"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const MIGRATION_RECEIPT_VERSION = 1;
const MIGRATION_DISK_RESERVE_BYTES = 8 * 1024 * 1024;
const SENSITIVE_APP_FILES = new Set([
  "account-token-cache.json",
  "app-settings.json",
  "app-settings.secrets.json",
  "cookies",
  "model-cache.json",
  "network persistent state",
  "transportsecurity"
]);

class ProjectDataMigrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ProjectDataMigrationError";
    this.code = code;
    this.details = details;
  }
}

function comparablePath(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function migrationError(code, message, details) {
  return new ProjectDataMigrationError(code, message, details);
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function compactScopeId(value = "default") {
  return String(value || "default").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 96) || "default";
}

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16)}`;
}

function normalizedFolderName(value, fallback = "旧项目") {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 72);
  const name = normalized || fallback;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `${name}-project` : name;
}

function sensitiveProjectRelativePath(relativePath) {
  const segments = String(relativePath || "").split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) => SENSITIVE_APP_FILES.has(segment.toLowerCase()));
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function directoryInventory(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const rootStats = await fs.lstat(root);
  if (rootStats.isSymbolicLink()) {
    throw migrationError("PROJECT_MIGRATION_SYMLINK", "旧项目目录是符号链接或目录联接，已停止迁移。", { relativePath: "." });
  }
  if (!rootStats.isDirectory()) {
    throw migrationError("PROJECT_MIGRATION_SOURCE_INVALID", "旧项目来源不是可读取的项目目录。");
  }

  const files = [];
  const directories = [""];
  for (let index = 0; index < directories.length; index += 1) {
    const relativeDirectory = directories[index];
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(root, relativePath);
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw migrationError("PROJECT_MIGRATION_SYMLINK", "旧项目包含符号链接或目录联接，已停止迁移。", {
          relativePath: relativePath.split(path.sep).join("/")
        });
      }
      if (stats.isDirectory()) {
        directories.push(relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw migrationError("PROJECT_MIGRATION_SPECIAL_FILE", "旧项目包含不受支持的特殊文件，已停止迁移。", {
          relativePath: relativePath.split(path.sep).join("/")
        });
      }
      const portableRelativePath = relativePath.split(path.sep).join("/");
      if (sensitiveProjectRelativePath(portableRelativePath)) {
        throw migrationError("PROJECT_MIGRATION_SENSITIVE_FILE", "旧项目目录混入了应用密钥或账号文件，已停止迁移以防泄露。", {
          relativePath: portableRelativePath
        });
      }
      files.push({
        relativePath: portableRelativePath,
        sourcePath: absolutePath,
        size: stats.size,
        modifiedAtMs: Math.floor(stats.mtimeMs)
      });
    }
  }

  if (options.hashes === true) {
    await mapLimit(files, Number(options.hashConcurrency || 2), async (file) => {
      file.sha256 = await hashFile(file.sourcePath);
      return file;
    });
  }
  return files;
}

async function fileInventory(filePath, relativePath = "session.json", options = {}) {
  const resolved = path.resolve(filePath);
  const stats = await fs.lstat(resolved);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw migrationError("PROJECT_MIGRATION_SOURCE_INVALID", "旧全局画布文件不是可迁移的普通文件。");
  }
  const file = {
    relativePath,
    sourcePath: resolved,
    size: stats.size,
    modifiedAtMs: Math.floor(stats.mtimeMs)
  };
  if (options.hashes === true) file.sha256 = await hashFile(resolved);
  return [file];
}

function inventorySummary(files) {
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
    latestModifiedAtMs: files.reduce((latest, file) => Math.max(latest, Number(file.modifiedAtMs || 0)), 0)
  };
}

function availableBytesFromStatfs(stats) {
  const blockSize = Number(stats?.bsize || stats?.frsize || 0);
  const availableBlocks = Number(stats?.bavail ?? stats?.bfree ?? 0);
  if (!Number.isFinite(blockSize) || blockSize <= 0 || !Number.isFinite(availableBlocks) || availableBlocks < 0) {
    return null;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(blockSize * availableBlocks));
}

function inventoriesEqual(left, right) {
  if (left.length !== right.length) return false;
  const rightByPath = new Map(right.map((file) => [file.relativePath, file]));
  return left.every((file) => {
    const match = rightByPath.get(file.relativePath);
    return Boolean(match && Number(match.size) === Number(file.size) && String(match.sha256) === String(file.sha256));
  });
}

function publicMigrationPreview(preview) {
  return {
    ok: true,
    previewToken: preview.previewToken,
    candidateCount: preview.candidates.length,
    migratableCount: preview.candidates.filter((candidate) => !candidate.blockedReason).length,
    blockedCount: preview.candidates.filter((candidate) => candidate.blockedReason).length,
    fileCount: preview.candidates.reduce((sum, candidate) => sum + Number(candidate.fileCount || 0), 0),
    totalBytes: preview.candidates.reduce((sum, candidate) => sum + Number(candidate.totalBytes || 0), 0),
    memoryEntryCount: preview.candidates.reduce((sum, candidate) => sum + Number(candidate.memoryEntryCount || 0), 0),
    pendingCleanupCount: preview.pendingCleanup?.length || 0,
    pendingCleanup: (preview.pendingCleanup || []).map((receipt) => ({
      migrationId: receipt.migrationId,
      createdAt: receipt.createdAt,
      projectCount: receipt.projectCount,
      fileCount: receipt.fileCount
    })),
    candidates: preview.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      projectId: candidate.projectId,
      name: candidate.name,
      sourceKind: candidate.sourceKind,
      fileCount: candidate.fileCount,
      totalBytes: candidate.totalBytes,
      memoryEntryCount: candidate.memoryEntryCount,
      blockedReason: candidate.blockedReason || ""
    }))
  };
}

function createProjectDataMigrationService(options = {}) {
  const configDir = path.resolve(String(options.configDir || ""));
  const projectsDir = path.resolve(String(options.projectsDir || path.join(configDir, "projects")));
  const legacySessionPath = path.resolve(String(options.sessionPath || path.join(configDir, "session.json")));
  const installRoot = options.installRoot ? path.resolve(options.installRoot) : "";
  const projectMetaDirName = String(options.projectMetaDirName || ".naimage");
  const readProjectList = options.readProjectList;
  const writeProjectList = options.writeProjectList;
  const sessionHasContent = typeof options.sessionHasContent === "function"
    ? options.sessionHasContent
    : (session) => Boolean(session?.nodes?.length || session?.messages?.length || session?.conversations?.length);
  const log = typeof options.log === "function" ? options.log : () => {};
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const idFactory = typeof options.idFactory === "function"
    ? options.idFactory
    : (prefix) => `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const hashConcurrency = Math.max(1, Math.min(4, Number(options.hashConcurrency || 2)));
  const availableDiskBytes = typeof options.availableDiskBytes === "function"
    ? options.availableDiskBytes
    : async (targetPath) => {
      if (typeof fs.statfs !== "function") return null;
      return availableBytesFromStatfs(await fs.statfs(targetPath));
    };
  const receiptDir = path.join(configDir, "migration-receipts");
  const memoryDir = path.join(configDir, "memory");
  const fastMemoryPath = path.join(memoryDir, "fastmemory.json");
  const memoryDatabasePaths = [
    path.join(memoryDir, "naimage-memory.db"),
    path.join(memoryDir, "iiimage-memory.db")
  ];

  if (!String(options.configDir || "").trim() || typeof readProjectList !== "function" || typeof writeProjectList !== "function") {
    throw new TypeError("createProjectDataMigrationService requires configDir, readProjectList and writeProjectList");
  }

  function sourceIsManagedProject(sourcePath) {
    const resolved = comparablePath(sourcePath);
    const root = comparablePath(projectsDir);
    return resolved !== root && isPathInside(resolved, root);
  }

  function existingProjectIdSet(list) {
    return new Set((Array.isArray(list?.projects) ? list.projects : []).map((project) => String(project?.id || "")).filter(Boolean));
  }

  function uniqueDerivedProjectId(list, seed) {
    const occupied = existingProjectIdSet(list);
    const base = stableId("legacy-project", seed);
    if (!occupied.has(base)) return base;
    for (let index = 2; index <= 9999; index += 1) {
      const candidate = `${base}-${index}`;
      if (!occupied.has(candidate)) return candidate;
    }
    throw migrationError("PROJECT_MIGRATION_ID_EXHAUSTED", "无法为旧项目分配安全的项目标识。");
  }

  function legacyFastMemoryEntries(projectId) {
    const id = String(projectId || "").trim();
    if (!id || !existsSync(fastMemoryPath)) return [];
    const store = safeReadJson(fastMemoryPath, { entries: [] });
    return (Array.isArray(store?.entries) ? store.entries : [])
      .filter((entry) => String(entry?.projectId || "").trim() === id)
      .map((entry) => ({ ...entry }));
  }

  function legacyConversationState(projectId) {
    if (!DatabaseSync || !projectId) return { summaries: {}, protocols: {} };
    const databasePath = memoryDatabasePaths.find((candidate) => existsSync(candidate));
    if (!databasePath) return { summaries: {}, protocols: {} };
    const projectScope = compactScopeId(projectId);
    const summaries = {};
    const protocols = {};
    let database = null;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const rows = database.prepare(
        "SELECT key, value FROM runtime_meta WHERE key LIKE ? OR key LIKE ?"
      ).all(`conversation_summary:${projectScope}:%`, `conversation_protocol:${projectScope}:%`);
      for (const row of rows) {
        const key = String(row?.key || "");
        const conversationId = key.split(":").slice(2).join(":");
        if (!conversationId) continue;
        let value;
        try { value = JSON.parse(String(row.value || "null")); } catch { value = null; }
        if (!value || typeof value !== "object") continue;
        if (key.startsWith("conversation_summary:")) summaries[conversationId] = value;
        if (key.startsWith("conversation_protocol:")) protocols[conversationId] = value;
      }
    } catch (error) {
      log(`project migration memory preview skipped code=${String(error?.code || "MEMORY_READ_FAILED")}`);
    } finally {
      try { database?.close(); } catch {}
    }
    return { summaries, protocols };
  }

  function memorySnapshot(projectId) {
    const fastMemoryEntries = legacyFastMemoryEntries(projectId);
    const conversations = legacyConversationState(projectId);
    return {
      fastMemoryEntries,
      conversations,
      entryCount: fastMemoryEntries.length + Object.keys(conversations.summaries).length + Object.keys(conversations.protocols).length
    };
  }

  async function pendingCleanupReceipts() {
    if (!existsSync(receiptDir)) return [];
    const entries = await fs.readdir(receiptDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^project-migration-[a-z0-9-]{6,120}\.json$/i.test(entry.name))
      .map((entry) => safeReadJson(path.join(receiptDir, entry.name), null))
      .filter((receipt) => receipt && receipt.version === MIGRATION_RECEIPT_VERSION && !receipt.cleanedAt && Array.isArray(receipt.projects))
      .map((receipt) => ({
        migrationId: String(receipt.migrationId || ""),
        createdAt: String(receipt.createdAt || ""),
        projectCount: receipt.projects.length,
        fileCount: receipt.projects.reduce((sum, item) => sum + (Array.isArray(item?.sourceFiles) ? item.sourceFiles.length : 0), 0),
        sourcePaths: receipt.projects.map((item) => String(item?.sourcePath || "").trim()).filter(Boolean).map((sourcePath) => path.resolve(sourcePath))
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async function candidateInventory(candidate, hashes = false) {
    return candidate.sourceKind === "global-session"
      ? fileInventory(candidate.sourcePath, "session.json", { hashes })
      : directoryInventory(candidate.sourcePath, { hashes, hashConcurrency });
  }

  async function previewLegacyData() {
    const list = readProjectList();
    const projects = Array.isArray(list?.projects) ? list.projects : [];
    const pendingCleanup = await pendingCleanupReceipts();
    const pendingSourcePaths = new Set(pendingCleanup.flatMap((receipt) => receipt.sourcePaths).map(comparablePath));
    const candidates = [];
    const indexedSources = new Set();

    for (const project of projects) {
      const sourcePath = path.resolve(String(project?.path || ""));
      if (!project?.id || !sourceIsManagedProject(sourcePath)) continue;
      indexedSources.add(comparablePath(sourcePath));
      const memory = memorySnapshot(project.id);
      candidates.push({
        candidateId: stableId("legacy", `project:${sourcePath}`),
        projectId: String(project.id),
        memoryProjectId: String(project.id),
        name: normalizedFolderName(project.name, path.basename(sourcePath)),
        sourceKind: "managed-project",
        sourcePath,
        project: { ...project },
        memory
      });
    }

    if (existsSync(projectsDir)) {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const sourcePath = path.join(projectsDir, entry.name);
        if (indexedSources.has(comparablePath(sourcePath))) continue;
        if (pendingSourcePaths.has(comparablePath(sourcePath))) continue;
        const projectId = uniqueDerivedProjectId(list, sourcePath);
        const memoryProjectId = entry.name;
        candidates.push({
          candidateId: stableId("legacy", `directory:${sourcePath}`),
          projectId,
          memoryProjectId,
          name: normalizedFolderName(entry.name, "旧项目"),
          sourceKind: "unindexed-project",
          sourcePath,
          project: null,
          memory: memorySnapshot(memoryProjectId)
        });
      }
    }

    const sessionIsAlreadyIndexed = projects.some((project) => comparablePath(project?.sessionPath || "") === comparablePath(legacySessionPath));
    if (!sessionIsAlreadyIndexed && !pendingSourcePaths.has(comparablePath(legacySessionPath)) && existsSync(legacySessionPath)) {
      const session = safeReadJson(legacySessionPath, null);
      if (session && sessionHasContent(session)) {
        const projectId = uniqueDerivedProjectId(list, legacySessionPath);
        const defaultMemoryOwnerExists = candidates.some((candidate) => candidate.memoryProjectId === "default");
        candidates.push({
          candidateId: stableId("legacy", `global-session:${legacySessionPath}`),
          projectId,
          memoryProjectId: defaultMemoryOwnerExists ? "" : "default",
          name: "旧版全局画布",
          sourceKind: "global-session",
          sourcePath: legacySessionPath,
          project: null,
          memory: defaultMemoryOwnerExists ? memorySnapshot("") : memorySnapshot("default")
        });
      }
    }

    for (const candidate of candidates) {
      try {
        const files = await candidateInventory(candidate, false);
        Object.assign(candidate, inventorySummary(files), {
          memoryEntryCount: candidate.memory.entryCount,
          blockedReason: ""
        });
      } catch (error) {
        candidate.fileCount = 0;
        candidate.totalBytes = 0;
        candidate.latestModifiedAtMs = 0;
        candidate.memoryEntryCount = candidate.memory.entryCount;
        candidate.blockedReason = error instanceof Error ? error.message : String(error);
        candidate.blockedCode = String(error?.code || "PROJECT_MIGRATION_PREVIEW_FAILED");
      }
    }

    const previewToken = createHash("sha256").update(JSON.stringify(candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      projectId: candidate.projectId,
      fileCount: candidate.fileCount,
      totalBytes: candidate.totalBytes,
      latestModifiedAtMs: candidate.latestModifiedAtMs,
      blockedCode: candidate.blockedCode || ""
    })))).digest("hex");
    return { ok: true, previewToken, candidates, list, pendingCleanup };
  }

  async function validateTargetParent(targetParent, candidates) {
    const resolved = path.resolve(String(targetParent || ""));
    if (!String(targetParent || "").trim()) {
      throw migrationError("PROJECT_MIGRATION_TARGET_REQUIRED", "请先选择迁移后的项目父目录。");
    }
    const stats = await fs.lstat(resolved);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw migrationError("PROJECT_MIGRATION_TARGET_INVALID", "迁移目标必须是普通文件夹，不能是符号链接或目录联接。");
    }
    const realTarget = realpathSync(resolved);
    for (const candidate of candidates) {
      if (candidate.sourceKind !== "global-session" && isPathInside(realTarget, candidate.sourcePath)) {
        throw migrationError("PROJECT_MIGRATION_TARGET_SOURCE", "迁移目标不能位于旧项目目录内部。");
      }
    }
    if (isPathInside(realTarget, configDir)) {
      throw migrationError("PROJECT_MIGRATION_TARGET_APPDATA", "迁移目标不能位于应用配置目录中，请选择项目所在的其他文件夹。");
    }
    if (installRoot && isPathInside(realTarget, installRoot)) {
      throw migrationError("PROJECT_MIGRATION_TARGET_INSTALL", "项目数据不能放入软件安装目录；升级或卸载可能导致数据丢失。");
    }
    return realTarget;
  }

  async function validateTargetCapacity(targetParent, sourceBytes) {
    const copiedBytes = Math.max(0, Number(sourceBytes || 0));
    const reserveBytes = Math.max(MIGRATION_DISK_RESERVE_BYTES, Math.ceil(copiedBytes * 0.05));
    const requiredBytes = copiedBytes + reserveBytes;
    let availableBytes;
    try {
      availableBytes = await availableDiskBytes(targetParent);
    } catch (error) {
      throw migrationError(
        "PROJECT_MIGRATION_SPACE_CHECK_FAILED",
        "无法确认迁移目标的可用空间，请检查磁盘状态后重试。",
        { causeCode: String(error?.code || "STATFS_FAILED") }
      );
    }
    if (availableBytes == null) return;
    const normalizedAvailable = Math.max(0, Number(availableBytes || 0));
    if (!Number.isFinite(normalizedAvailable) || normalizedAvailable < requiredBytes) {
      throw migrationError(
        "PROJECT_MIGRATION_INSUFFICIENT_SPACE",
        "迁移目标的可用空间不足，请释放空间或选择其他磁盘。",
        { availableBytes: normalizedAvailable, requiredBytes }
      );
    }
  }

  function uniqueDestinationPath(targetParent, name, occupied) {
    const baseName = normalizedFolderName(name, "旧项目");
    for (let index = 1; index <= 9999; index += 1) {
      const folderName = index === 1 ? baseName : `${baseName} (${index})`;
      const candidate = path.join(targetParent, folderName);
      const key = comparablePath(candidate);
      if (!existsSync(candidate) && !occupied.has(key)) {
        occupied.add(key);
        return candidate;
      }
    }
    throw migrationError("PROJECT_MIGRATION_TARGET_EXHAUSTED", "目标目录中的同名项目过多，请选择其他目录。");
  }

  async function writeProjectMemory(stagePath, candidate, destinationProjectId, migratedAt) {
    const agentDir = path.join(stagePath, projectMetaDirName, "agent");
    const generated = [];
    const sourceEntries = candidate.memory.fastMemoryEntries.map((entry) => ({ ...entry, projectId: destinationProjectId }));
    if (sourceEntries.length) {
      const destination = path.join(agentDir, "fastmemory.json");
      const current = safeReadJson(destination, { version: 1, entries: [] });
      const byIdentity = new Map();
      for (const entry of [...(Array.isArray(current.entries) ? current.entries : []), ...sourceEntries]) {
        const identity = `${entry.entry_id || ""}:${entry.projectId || ""}:${entry.conversationId || ""}`;
        byIdentity.set(identity, entry);
      }
      await atomicWriteJson(destination, { version: 1, entries: [...byIdentity.values()] });
      generated.push(destination);
    }

    const summaries = candidate.memory.conversations.summaries;
    const protocols = candidate.memory.conversations.protocols;
    if (Object.keys(summaries).length || Object.keys(protocols).length) {
      const destination = path.join(agentDir, "conversations.json");
      const current = safeReadJson(destination, { version: 1, summaries: {}, protocols: {} });
      await atomicWriteJson(destination, {
        version: 1,
        projectId: destinationProjectId,
        summaries: { ...(current.summaries || {}), ...summaries },
        protocols: { ...(current.protocols || {}), ...protocols },
        migratedAt
      });
      generated.push(destination);
    }
    return generated;
  }

  async function copyAndVerifyPlan(plan, migrationId, nonce, migratedAt) {
    await fs.mkdir(plan.stagePath, { recursive: false });
    await mapLimit(plan.sourceFiles, hashConcurrency, async (file) => {
      const destination = path.join(plan.stagePath, ...file.relativePath.split("/"));
      if (!isPathInside(destination, plan.stagePath)) {
        throw migrationError("PROJECT_MIGRATION_PATH_ESCAPE", "旧项目包含越界文件路径，已停止迁移。");
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file.sourcePath, destination);
      const destinationStats = await fs.lstat(destination);
      if (destinationStats.isSymbolicLink() || !destinationStats.isFile() || destinationStats.size !== file.size) {
        throw migrationError("PROJECT_MIGRATION_COPY_MISMATCH", "迁移副本的文件大小校验失败，旧数据保持不变。");
      }
      const destinationHash = await hashFile(destination);
      if (destinationHash !== file.sha256) {
        throw migrationError("PROJECT_MIGRATION_HASH_MISMATCH", "迁移副本的 SHA-256 校验失败，旧数据保持不变。");
      }
    });

    const generatedPaths = await writeProjectMemory(plan.stagePath, plan.candidate, plan.record.id, migratedAt);
    const generatedFiles = await mapLimit(generatedPaths, hashConcurrency, async (filePath) => {
      const stats = await fs.lstat(filePath);
      return {
        relativePath: path.relative(plan.stagePath, filePath).split(path.sep).join("/"),
        size: stats.size,
        sha256: await hashFile(filePath)
      };
    });
    const markerPath = path.join(plan.stagePath, projectMetaDirName, "migrations", `${migrationId}.json`);
    await atomicWriteJson(markerPath, {
      version: MIGRATION_RECEIPT_VERSION,
      migrationId,
      nonce,
      projectId: plan.record.id,
      migratedAt,
      copiedFileCount: plan.sourceFiles.length,
      copiedBytes: plan.sourceFiles.reduce((sum, file) => sum + file.size, 0)
    });
    plan.generatedFiles = generatedFiles;
  }

  function nextProjectList(previousList, plans, migratedAt) {
    const planByProjectId = new Map(plans.map((plan) => [plan.record.id, plan]));
    const migratedExisting = new Set(plans.filter((plan) => plan.candidate.project).map((plan) => plan.record.id));
    const existing = (Array.isArray(previousList?.projects) ? previousList.projects : []).map((project) => {
      const plan = planByProjectId.get(project.id);
      return plan ? plan.record : project;
    });
    const additions = plans.filter((plan) => !migratedExisting.has(plan.record.id)).map((plan) => plan.record);
    const projects = [...additions, ...existing];
    const activeProjectId = projects.some((project) => project.id === previousList?.activeProjectId)
      ? previousList.activeProjectId
      : plans[0]?.record.id || projects[0]?.id || "";
    return { activeProjectId, projects, migratedAt };
  }

  async function rollbackPublishedPlans(plans) {
    for (const plan of [...plans].reverse()) {
      try {
        if (existsSync(plan.finalPath)) await fs.rename(plan.finalPath, plan.stagePath);
      } catch (error) {
        log(`project migration publish rollback failed code=${String(error?.code || "ROLLBACK_FAILED")}`);
      }
    }
  }

  async function removePlanArtifacts(plans) {
    for (const plan of plans) {
      try {
        if (existsSync(plan.stagePath)) await fs.rm(plan.stagePath, { recursive: true, force: true });
      } catch (error) {
        log(`project migration staging cleanup failed code=${String(error?.code || "CLEANUP_FAILED")}`);
      }
    }
  }

  async function migrateLegacyProjects(input = {}) {
    if (input.confirmed !== true) {
      throw migrationError("PROJECT_MIGRATION_CONFIRMATION_REQUIRED", "迁移前必须明确确认预检结果。");
    }
    const preview = await previewLegacyData();
    if (String(input.previewToken || "").trim() && String(input.previewToken) !== preview.previewToken) {
      throw migrationError("PROJECT_MIGRATION_PREVIEW_STALE", "旧项目数据在预检后发生了变化，请重新预检后再试。");
    }
    const requestedIds = new Set((Array.isArray(input.candidateIds) ? input.candidateIds : []).map(String).filter(Boolean));
    const selected = requestedIds.size
      ? preview.candidates.filter((candidate) => requestedIds.has(candidate.candidateId))
      : preview.candidates;
    if (!selected.length) throw migrationError("PROJECT_MIGRATION_NOTHING_TO_DO", "没有找到可迁移的旧项目数据。");
    if (requestedIds.size !== selected.length) {
      throw migrationError("PROJECT_MIGRATION_PREVIEW_STALE", "迁移预检已经变化，请重新预检后再试。");
    }
    const blocked = selected.find((candidate) => candidate.blockedReason);
    if (blocked) {
      throw migrationError(blocked.blockedCode || "PROJECT_MIGRATION_PRECHECK_FAILED", blocked.blockedReason, {
        candidateId: blocked.candidateId
      });
    }
    const targetParent = await validateTargetParent(input.targetParent, selected);
    const occupied = new Set((Array.isArray(preview.list?.projects) ? preview.list.projects : []).map((project) => comparablePath(project.path)));
    const migrationId = idFactory("project-migration");
    const nonce = randomBytes(24).toString("hex");
    const migratedAt = now().toISOString();
    const plans = [];

    for (const candidate of selected) {
      const sourceFiles = await candidateInventory(candidate, true);
      const finalPath = uniqueDestinationPath(targetParent, candidate.name, occupied);
      const record = {
        ...(candidate.project || {}),
        id: candidate.projectId,
        name: normalizedFolderName(candidate.name, "旧项目"),
        path: finalPath,
        sessionPath: path.join(finalPath, "session.json"),
        createdAt: candidate.project?.createdAt || migratedAt,
        updatedAt: migratedAt,
        external: true
      };
      plans.push({
        candidate,
        sourceFiles,
        finalPath,
        stagePath: path.join(targetParent, `.${path.basename(finalPath)}.${migrationId}.staging`),
        record,
        generatedFiles: []
      });
    }

    await validateTargetCapacity(
      targetParent,
      plans.reduce((sum, plan) => sum + plan.sourceFiles.reduce((fileSum, file) => fileSum + file.size, 0), 0)
    );

    const published = [];
    let listWasUpdated = false;
    try {
      for (const plan of plans) await copyAndVerifyPlan(plan, migrationId, nonce, migratedAt);
      for (const plan of plans) {
        await fs.rename(plan.stagePath, plan.finalPath);
        published.push(plan);
      }
      const nextList = nextProjectList(preview.list, plans, migratedAt);
      const persistedList = writeProjectList({ activeProjectId: nextList.activeProjectId, projects: nextList.projects });
      listWasUpdated = true;
      const receipt = {
        version: MIGRATION_RECEIPT_VERSION,
        migrationId,
        nonce,
        createdAt: migratedAt,
        cleanedAt: "",
        projects: plans.map((plan) => ({
          candidateId: plan.candidate.candidateId,
          projectId: plan.record.id,
          memoryProjectId: plan.candidate.memoryProjectId,
          sourceKind: plan.candidate.sourceKind,
          sourcePath: plan.candidate.sourcePath,
          destinationPath: plan.finalPath,
          sourceFiles: plan.sourceFiles.map(({ relativePath, size, sha256 }) => ({ relativePath, size, sha256 })),
          generatedFiles: plan.generatedFiles
        }))
      };
      await atomicWriteJson(path.join(receiptDir, `${migrationId}.json`), receipt);
      log(`project migration complete projects=${plans.length} files=${plans.reduce((sum, plan) => sum + plan.sourceFiles.length, 0)}`);
      return {
        ok: true,
        migrationId,
        cleanupAvailable: true,
        migratedAt,
        migratedProjectCount: plans.length,
        copiedFileCount: plans.reduce((sum, plan) => sum + plan.sourceFiles.length, 0),
        copiedBytes: plans.reduce((sum, plan) => sum + plan.sourceFiles.reduce((fileSum, file) => fileSum + file.size, 0), 0),
        projects: persistedList.projects,
        activeProjectId: persistedList.activeProjectId
      };
    } catch (error) {
      if (listWasUpdated) {
        try { writeProjectList(preview.list); } catch (rollbackError) {
          log(`project migration index rollback failed code=${String(rollbackError?.code || "ROLLBACK_FAILED")}`);
        }
      }
      await rollbackPublishedPlans(published);
      await removePlanArtifacts(plans);
      throw error;
    }
  }

  async function validateCleanupReceipt(receipt) {
    for (const item of receipt.projects) {
      if (item.sourceKind !== "global-session" && !sourceIsManagedProject(item.sourcePath)) {
        throw migrationError("PROJECT_MIGRATION_CLEANUP_SOURCE_REJECTED", "清理记录中的旧项目来源不在受管目录内，已拒绝删除。");
      }
      if (item.sourceKind === "global-session" && comparablePath(item.sourcePath) !== comparablePath(legacySessionPath)) {
        throw migrationError("PROJECT_MIGRATION_CLEANUP_SOURCE_REJECTED", "清理记录中的旧画布文件不受信任，已拒绝删除。");
      }
      const markerPath = path.join(item.destinationPath, projectMetaDirName, "migrations", `${receipt.migrationId}.json`);
      const marker = safeReadJson(markerPath, null);
      if (!marker || marker.nonce !== receipt.nonce || marker.projectId !== item.projectId) {
        throw migrationError("PROJECT_MIGRATION_DESTINATION_UNVERIFIED", "迁移后的项目校验标记不存在或已变化，C 盘旧数据保持不变。");
      }
      if (!existsSync(item.sourcePath)) continue;
      const currentFiles = item.sourceKind === "global-session"
        ? await fileInventory(item.sourcePath, "session.json", { hashes: true })
        : await directoryInventory(item.sourcePath, { hashes: true, hashConcurrency });
      if (!inventoriesEqual(item.sourceFiles, currentFiles)) {
        throw migrationError("PROJECT_MIGRATION_SOURCE_CHANGED", "迁移后旧项目又发生了变化，已停止清理以避免遗漏新数据。");
      }
    }
  }

  async function removeLegacyMemoryScopes(projectIds) {
    const ids = new Set(projectIds.map((value) => String(value || "").trim()).filter(Boolean));
    const warnings = [];
    if (ids.size && existsSync(fastMemoryPath)) {
      try {
        const store = safeReadJson(fastMemoryPath, { version: 1, entries: [] });
        const entries = (Array.isArray(store.entries) ? store.entries : []).filter((entry) => !ids.has(String(entry?.projectId || "").trim()));
        await atomicWriteJson(fastMemoryPath, { ...store, version: 1, entries });
      } catch (error) {
        warnings.push(`FastMemory 旧索引清理失败：${String(error?.code || "WRITE_FAILED")}`);
      }
    }
    const databasePath = memoryDatabasePaths.find((candidate) => existsSync(candidate));
    if (ids.size && DatabaseSync && databasePath) {
      let database = null;
      try {
        database = new DatabaseSync(databasePath);
        const remove = database.prepare("DELETE FROM runtime_meta WHERE key LIKE ? OR key LIKE ?");
        for (const projectId of ids) {
          const scope = compactScopeId(projectId);
          remove.run(`conversation_summary:${scope}:%`, `conversation_protocol:${scope}:%`);
        }
      } catch (error) {
        warnings.push(`会话摘要旧索引清理失败：${String(error?.code || "DATABASE_FAILED")}`);
      } finally {
        try { database?.close(); } catch {}
      }
    }
    return warnings;
  }

  async function cleanupMigratedSource(input = {}) {
    if (input.confirmedCleanup !== true) {
      throw migrationError("PROJECT_MIGRATION_CLEANUP_CONFIRMATION_REQUIRED", "删除 C 盘旧数据前必须再次明确确认。");
    }
    const migrationId = String(input.migrationId || "").trim();
    if (!/^project-migration-[a-z0-9-]{6,120}$/i.test(migrationId)) {
      throw migrationError("PROJECT_MIGRATION_RECEIPT_INVALID", "迁移清理凭据无效，未删除任何旧数据。");
    }
    const receiptPath = path.join(receiptDir, `${migrationId}.json`);
    const receipt = safeReadJson(receiptPath, null);
    if (!receipt || receipt.version !== MIGRATION_RECEIPT_VERSION || receipt.migrationId !== migrationId || !Array.isArray(receipt.projects)) {
      throw migrationError("PROJECT_MIGRATION_RECEIPT_MISSING", "找不到完整迁移凭据，未删除任何旧数据。");
    }
    if (receipt.cleanedAt) {
      return { ok: true, migrationId, alreadyCleaned: true, removedProjectCount: 0, removedFileCount: 0, cleanupWarnings: receipt.cleanupWarnings || [] };
    }
    await validateCleanupReceipt(receipt);

    const quarantineRoot = path.join(receiptDir, "cleanup-staging", migrationId);
    if (existsSync(quarantineRoot)) {
      throw migrationError("PROJECT_MIGRATION_CLEANUP_STAGING_EXISTS", "检测到上次未完成的清理暂存区，未继续删除旧数据。");
    }
    await fs.mkdir(quarantineRoot, { recursive: true });
    const moved = [];
    try {
      for (let index = 0; index < receipt.projects.length; index += 1) {
        const item = receipt.projects[index];
        if (!existsSync(item.sourcePath)) continue;
        const quarantinePath = path.join(quarantineRoot, `${String(index + 1).padStart(3, "0")}-${path.basename(item.sourcePath)}`);
        await fs.rename(item.sourcePath, quarantinePath);
        moved.push({ sourcePath: item.sourcePath, quarantinePath });
      }
    } catch (error) {
      for (const item of [...moved].reverse()) {
        try { await fs.rename(item.quarantinePath, item.sourcePath); } catch (rollbackError) {
          log(`project migration cleanup rollback failed code=${String(rollbackError?.code || "ROLLBACK_FAILED")}`);
        }
      }
      try { await fs.rm(quarantineRoot, { recursive: true, force: true }); } catch {}
      throw error;
    }

    const cleanupWarnings = await removeLegacyMemoryScopes(receipt.projects.map((item) => item.memoryProjectId));
    try {
      await fs.rm(quarantineRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupWarnings.push(`旧数据已移入清理暂存区但暂存区删除失败：${String(error?.code || "REMOVE_FAILED")}`);
    }
    const cleanedAt = now().toISOString();
    await atomicWriteJson(receiptPath, { ...receipt, cleanedAt, cleanupWarnings });
    log(`project migration source cleanup complete projects=${moved.length}`);
    return {
      ok: true,
      migrationId,
      cleanedAt,
      removedProjectCount: moved.length,
      removedFileCount: receipt.projects.reduce((sum, item) => sum + item.sourceFiles.length, 0),
      cleanupWarnings
    };
  }

  return {
    cleanupMigratedSource,
    migrateLegacyProjects,
    previewLegacyData,
    publicMigrationPreview
  };
}

module.exports = {
  MIGRATION_RECEIPT_VERSION,
  ProjectDataMigrationError,
  createProjectDataMigrationService,
  directoryInventory,
  publicMigrationPreview
};
