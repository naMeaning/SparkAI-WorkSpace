"use strict";

const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

function createProjectStore(options = {}) {
  const {
    comparablePath,
    defaultSession,
    exportSessionFileName,
    isPathInside,
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

  function safeName(value, fallback = "项目") {
    const name = String(value || "").trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").slice(0, 48);
    return name || fallback;
  }

  function projectId() {
    return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultProjectList() {
    const defaultProjectId = "default";
    const defaultSessionPath = path.join(projectsDir, defaultProjectId, "session.json");
    return {
      activeProjectId: defaultProjectId,
      projects: [
        {
          id: defaultProjectId,
          name: "默认项目",
          path: path.dirname(defaultSessionPath),
          sessionPath: defaultSessionPath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          external: false
        }
      ]
    };
  }

  function normalizeProjectList(raw) {
    const base = defaultProjectList();
    const source = raw && typeof raw === "object" ? raw : {};
    const projects = Array.isArray(source.projects) ? source.projects : base.projects;
    const normalized = projects
      .map((item) => {
        const id = String(item?.id || projectId());
        const projectPath = String(item?.path || path.join(projectsDir, id));
        return {
          id,
          name: id === "default" && String(item?.name || "").trim() === "默认画布" ? "默认项目" : safeName(item?.name, id),
          path: projectPath,
          sessionPath: String(item?.sessionPath || path.join(projectPath, "session.json")),
          createdAt: item?.createdAt || new Date().toISOString(),
          updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
          external: Boolean(item?.external)
        };
      })
      .filter((item) => item.id && item.sessionPath);

    if (!normalized.some((item) => item.id === "default")) {
      normalized.unshift(base.projects[0]);
    }

    const activeProjectId = normalized.some((item) => item.id === source.activeProjectId)
      ? source.activeProjectId
      : normalized[0].id;

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
    return list.projects.find((item) => item.id === list.activeProjectId) || list.projects[0];
  }

  function getProjectById(projectIdValue, list = readProjectList()) {
    const id = String(projectIdValue || "");
    if (!id) return getActiveProject(list);
    return list.projects.find((item) => item.id === id) || null;
  }

  function currentSessionPath() {
    return getActiveProject(readProjectList())?.sessionPath || sessionPath;
  }

  function createProjectRecord(name, externalPath = "") {
    const id = projectId();
    const now = new Date().toISOString();
    const projectPath = externalPath ? path.resolve(externalPath) : path.join(projectsDir, id);
    return {
      id,
      name: safeName(name, "未命名画布"),
      path: projectPath,
      sessionPath: path.join(projectPath, "session.json"),
      createdAt: now,
      updatedAt: now,
      external: Boolean(externalPath)
    };
  }

  function nextExternalProjectFolderPath(parentPath, name, list = readProjectList()) {
    const parent = path.resolve(parentPath);
    const baseName = safeName(name, "iiimage 项目");
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

  function projectExportSessionPath(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    return path.join(path.resolve(projectPath || projectRoot), exportSessionFileName);
  }

  function readProjectManifest(projectOrPath) {
    const manifestPath = projectManifestPath(projectOrPath);
    if (!existsSync(manifestPath)) return null;
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
    }
    const manifest = {
      format: "iiimage-project",
      version: 2,
      updatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      },
      sessionRevision: Math.max(0, Math.floor(Number(normalizedSession.sessionRevision || 0))),
      assets
    };
    writeJson(projectManifestPath(projectPath), manifest);
  }

  function projectSessionFromDisk(project) {
    const hasSessionFile = existsSync(project.sessionPath);
    const rawSession = hasSessionFile ? readJson(project.sessionPath, defaultSession) : defaultSession;
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
    if (shouldMigrateLegacySession || !hasSessionFile) {
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
    if (!existsSync(project.sessionPath)) writeJson(project.sessionPath, session);
    if (!existsSync(projectManifestPath(project))) {
      writeProjectManifest(project, existsSync(project.sessionPath) ? readJson(project.sessionPath, session) : session);
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
    projectForFolderOpen,
    projectManifestPath,
    projectRelativePath,
    projectSessionFromDisk,
    projectSessionRevisionFromDisk,
    readProjectList,
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
