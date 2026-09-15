"use strict";

const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

function createProjectStore(options = {}) {
  const {
    comparablePath,
    defaultSession,
    exportSessionFileName,
    isPathInside,
    legacyExportSessionFileNames = [],
    legacyProjectMetaDirNames = [],
    legacyProjectPathMappings = [],
    log = () => {},
    normalizeSessionRevision,
    projectListPath,
    projectManifestFileName,
    projectMetaDirName,
    projectRoot,
    projectsDir,
    readJson,
    sessionForProjectSave,
    sessionHasContent,
    sessionPath,
    sessionWithProjectAssets,
    writeJson
  } = options;

  let thumbnailProjectRootsCache = null;
  const readableProjectMetaDirNames = [projectMetaDirName, ...legacyProjectMetaDirNames]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const readableExportSessionFileNames = [exportSessionFileName, ...legacyExportSessionFileNames]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);

  function migratedManagedPath(value) {
    const resolved = path.resolve(String(value || ""));
    for (const mapping of legacyProjectPathMappings) {
      if (!mapping?.from || !mapping?.to) continue;
      const from = path.resolve(mapping.from);
      const resolvedKey = comparablePath(resolved);
      const fromKey = comparablePath(from);
      if (resolvedKey !== fromKey && !resolvedKey.startsWith(`${fromKey}${path.sep}`)) continue;
      return path.resolve(mapping.to, path.relative(from, resolved));
    }
    return resolved;
  }

  function safeName(value, fallback = "项目") {
    const name = String(value || "").trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").slice(0, 48);
    return name || fallback;
  }

  function projectId() {
    return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultProjectList() {
    return { activeProjectId: "", projects: [] };
  }

  function normalizeProjectList(raw) {
    const base = defaultProjectList();
    const source = raw && typeof raw === "object" ? raw : {};
    const projects = Array.isArray(source.projects) ? source.projects : base.projects;
    const normalized = projects
      .map((item) => {
        const id = String(item?.id || projectId());
        const projectPath = migratedManagedPath(item?.path || path.join(projectsDir, id));
        return {
          id,
          name: id === "default" && String(item?.name || "").trim() === "默认画布" ? "默认项目" : safeName(item?.name, id),
          path: projectPath,
          sessionPath: migratedManagedPath(item?.sessionPath || path.join(projectPath, "session.json")),
          createdAt: item?.createdAt || new Date().toISOString(),
          updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
          external: Boolean(item?.external)
        };
      })
      .filter((item) => item.id && item.sessionPath);

    const activeProjectId = normalized.some((item) => item.id === source.activeProjectId)
      ? source.activeProjectId
      : normalized[0]?.id || "";

    return { activeProjectId, projects: normalized };
  }

  function readProjectList() {
    return normalizeProjectList(readJson(projectListPath, defaultProjectList()));
  }

  function updateThumbnailProjectRootsCache(list) {
    thumbnailProjectRootsCache = (Array.isArray(list?.projects) ? list.projects : [])
      .filter((item) => item?.path)
      .map((item) => ({
        projectPath: path.resolve(item.path),
        cacheRoot: path.join(path.resolve(item.path), projectMetaDirName, "thumbnails")
      }));
  }

  function writeProjectList(list) {
    const next = normalizeProjectList(list);
    writeJson(projectListPath, next);
    updateThumbnailProjectRootsCache(next);
    return next;
  }

  function thumbnailProjectRoots() {
    if (!thumbnailProjectRootsCache) updateThumbnailProjectRootsCache(readProjectList());
    return thumbnailProjectRootsCache || [];
  }

  function getActiveProject(list = readProjectList()) {
    return list.projects.find((item) => item.id === list.activeProjectId) || list.projects[0] || null;
  }

  function getProjectById(projectIdValue, list = readProjectList()) {
    const id = String(projectIdValue || "");
    if (!id) return getActiveProject(list);
    return list.projects.find((item) => item.id === id) || null;
  }

  function currentSessionPath() {
    return getActiveProject(readProjectList())?.sessionPath || "";
  }

  function createProjectRecord(name, externalPath = "") {
    if (!String(externalPath || "").trim()) {
      const error = new Error("创建项目时必须先选择保存位置。");
      error.code = "PROJECT_PATH_REQUIRED";
      throw error;
    }
    const id = projectId();
    const now = new Date().toISOString();
    const projectPath = path.resolve(externalPath);
    return {
      id,
      name: safeName(name, "未命名画布"),
      path: projectPath,
      sessionPath: path.join(projectPath, "session.json"),
      createdAt: now,
      updatedAt: now,
      external: true
    };
  }

  function nextExternalProjectFolderPath(parentPath, name, list = readProjectList()) {
    const parent = path.resolve(parentPath);
    const baseName = safeName(name, "SparkAI WorkSpace 项目");
    const occupied = new Set((Array.isArray(list?.projects) ? list.projects : [])
      .filter((item) => item?.path)
      .map((item) => comparablePath(item.path)));
    for (let index = 1; index <= 9999; index += 1) {
      const folderName = index === 1 ? baseName : `${baseName} (${index})`;
      const candidate = path.join(parent, folderName);
      if (!existsSync(candidate) && !occupied.has(comparablePath(candidate))) return candidate;
    }
    throw new Error("所选目录下同名项目过多，请更换项目名称或保存位置。");
  }

  function projectForFolderOpen(list, projectIdValue = "") {
    const requestedId = String(projectIdValue || "").trim();
    return requestedId ? getProjectById(requestedId, list) : getActiveProject(list);
  }

  function projectManifestPath(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    return path.join(path.resolve(projectPath || projectRoot), projectMetaDirName, projectManifestFileName);
  }

  function projectCommerceCatalogPath(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    return path.join(path.resolve(projectPath || projectRoot), projectMetaDirName, "commerce-catalog.json");
  }

  function projectExportSessionPath(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    return path.join(path.resolve(projectPath || projectRoot), exportSessionFileName);
  }

  function projectExportSessionCandidates(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    const resolvedProject = path.resolve(projectPath || projectRoot);
    return readableExportSessionFileNames.map((fileName) => path.join(resolvedProject, fileName));
  }

  function readProjectExportSession(projectOrPath) {
    const exportPath = projectExportSessionCandidates(projectOrPath).find((candidate) => existsSync(candidate));
    if (!exportPath) return null;
    try {
      const parsed = JSON.parse(readFileSync(exportPath, "utf8"));
      const session = parsed?.session && typeof parsed.session === "object" ? parsed.session : parsed;
      return session && typeof session === "object" ? session : null;
    } catch (error) {
      log(`project export session read failed ${exportPath}: ${error.message}`);
      return null;
    }
  }

  function readProjectManifest(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    const resolvedProject = path.resolve(projectPath || projectRoot);
    const manifestPath = readableProjectMetaDirNames
      .map((dirName) => path.join(resolvedProject, dirName, projectManifestFileName))
      .find((candidate) => existsSync(candidate));
    if (!manifestPath) return null;
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      log(`project manifest read failed ${manifestPath}: ${error.message}`);
      return null;
    }
  }

  function projectRelativePath(projectPathValue, filePath) {
    if (!filePath || typeof filePath !== "string") return "";
    const resolvedProject = path.resolve(projectPathValue || projectRoot);
    const resolvedFile = path.resolve(filePath);
    if (!isPathInside(resolvedFile, resolvedProject)) return "";
    return path.relative(resolvedProject, resolvedFile).split(path.sep).join("/");
  }

  function resolveProjectRelativePath(projectPathValue, relativePath) {
    if (!relativePath || typeof relativePath !== "string") return "";
    const resolvedProject = path.resolve(projectPathValue || projectRoot);
    const resolved = path.resolve(resolvedProject, relativePath);
    if (!isPathInside(resolved, resolvedProject)) return "";
    return resolved;
  }

  function writeProjectManifest(project, session) {
    if (!project?.path) return;
    const projectPath = path.resolve(project.path);
    const normalizedSession = sessionForProjectSave(session, project);
    const assets = [];
    const videos = [];
    for (const node of normalizedSession.nodes) {
      for (const asset of node.assets || []) {
        assets.push({
          nodeId: node.id,
          assetId: asset.assetId || "",
          displayCode: asset.displayCode || "",
          contentHash: asset.contentHash || "",
          index: asset.index,
          type: asset.type,
          path: asset.relativePath || projectRelativePath(projectPath, asset.path),
          fileName: asset.fileName || (asset.path ? path.basename(asset.path) : ""),
          runId: asset.runId || "",
          revisedPrompt: asset.revisedPrompt || ""
        });
      }
      if (node.type === "video" && node.videoAsset) {
        videos.push({
          nodeId: node.id,
          assetId: node.videoAsset.assetId || "",
          contentHash: node.videoAsset.contentHash || "",
          path: node.videoAsset.relativePath || projectRelativePath(projectPath, node.videoAsset.path),
          fileName: node.videoAsset.originalName || (node.videoAsset.path ? path.basename(node.videoAsset.path) : ""),
          mimeType: node.videoAsset.mimeType || "",
          width: node.videoAsset.width,
          height: node.videoAsset.height,
          durationMs: node.videoAsset.durationMs,
          model: node.videoModel || ""
        });
      }
    }
    const manifest = {
      format: "naimage-project",
      version: 2,
      updatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      },
      sessionRevision: Math.max(0, Math.floor(Number(normalizedSession.sessionRevision || 0))),
      assets,
      videos
    };
    writeJson(projectManifestPath(projectPath), manifest);
  }

  function projectSessionFromDisk(project) {
    const hasSessionFile = existsSync(project.sessionPath);
    const exportSession = hasSessionFile ? null : readProjectExportSession(project);
    const rawSession = hasSessionFile ? readJson(project.sessionPath, defaultSession) : exportSession || defaultSession;
    const manifest = readProjectManifest(project);
    const legacyManifestSession = Number(manifest?.version || 1) < 2 && manifest?.session && typeof manifest.session === "object"
      ? manifest.session
      : null;
    const shouldMigrateLegacySession = Boolean(
      legacyManifestSession &&
      !sessionHasContent(rawSession) &&
      sessionHasContent(legacyManifestSession)
    );
    const sourceSession = shouldMigrateLegacySession ? legacyManifestSession : rawSession;
    const sourceRevision = shouldMigrateLegacySession
      ? sourceSession?.sessionRevision ?? manifest?.sessionRevision
      : hasSessionFile
        ? sourceSession?.sessionRevision ?? manifest?.sessionRevision
        : manifest?.sessionRevision;
    const sessionRevision = Math.max(0, Math.floor(Number(sourceRevision ?? 0) || 0));
    const hydratedSession = sessionWithProjectAssets({ ...sourceSession, sessionRevision }, project);
    const normalizedSession = sessionForProjectSave(hydratedSession, project);
    if (shouldMigrateLegacySession || exportSession || !hasSessionFile) {
      writeJson(project.sessionPath, normalizedSession);
      writeProjectManifest(project, normalizedSession);
    }
    return hydratedSession;
  }

  function projectSessionRevisionFromDisk(project) {
    if (!project) return 0;
    const hasSessionFile = existsSync(project.sessionPath);
    const rawSession = hasSessionFile ? readJson(project.sessionPath, defaultSession) : null;
    const sessionRevision = normalizeSessionRevision(rawSession?.sessionRevision);
    if (hasSessionFile && sessionRevision !== null) return sessionRevision;
    return normalizeSessionRevision(readProjectManifest(project)?.sessionRevision) ?? 0;
  }

  function ensureProjectFiles(project, session = defaultSession) {
    if (!project?.path || !project?.sessionPath) return;
    mkdirSync(project.path, { recursive: true });
    mkdirSync(path.dirname(project.sessionPath), { recursive: true });
    const canonicalManifestPath = projectManifestPath(project);
    const hasSessionFile = existsSync(project.sessionPath);
    const exportSession = hasSessionFile ? null : readProjectExportSession(project);
    const manifest = readProjectManifest(project);
    const legacyManifestSession = Number(manifest?.version || 1) < 2 && manifest?.session && typeof manifest.session === "object"
      ? manifest.session
      : null;
    const rawSession = hasSessionFile ? readJson(project.sessionPath, session) : exportSession || session;
    const shouldMigrateLegacySession = Boolean(
      legacyManifestSession &&
      !sessionHasContent(rawSession) &&
      sessionHasContent(legacyManifestSession)
    );
    const normalizedSession = sessionForProjectSave(
      shouldMigrateLegacySession ? legacyManifestSession : rawSession,
      project
    );
    if (!hasSessionFile || shouldMigrateLegacySession) {
      writeJson(project.sessionPath, normalizedSession);
    }
    if (!existsSync(canonicalManifestPath) || !hasSessionFile || exportSession || shouldMigrateLegacySession) {
      writeProjectManifest(project, normalizedSession);
    }
  }

  return {
    createProjectRecord,
    currentSessionPath,
    defaultProjectList,
    ensureProjectFiles,
    getActiveProject,
    getProjectById,
    nextExternalProjectFolderPath,
    normalizeProjectList,
    projectExportSessionPath,
    projectCommerceCatalogPath,
    projectForFolderOpen,
    projectManifestPath,
    projectRelativePath,
    projectSessionFromDisk,
    projectSessionRevisionFromDisk,
    readProjectList,
    readProjectExportSession,
    readProjectManifest,
    resolveProjectRelativePath,
    safeName,
    thumbnailProjectRoots,
    writeProjectList,
    writeProjectManifest
  };
}

module.exports = {
  createProjectStore
};
