"use strict";

const { existsSync, mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");
const {
  MAX_SKILL_MARKDOWN_BYTES,
  parseSkillResult,
  readSkillMarkdownFile
} = require("../skill-import.cjs");

const LEGACY_PROJECT_PACKAGE_EXTENSION = "iiimage";

function registerProjectIpc(options = {}) {
  const {
    ipcMain,
    dialog,
    shell,
    log,
    defaultSession,
    readProjectList,
    createProjectRecord,
    ensureProjectFiles,
    writeProjectList,
    safeName,
    nextExternalProjectFolderPath,
    projectSessionFromDisk,
    writeJson,
    sessionForProjectSave,
    writeProjectManifest,
    getActiveProject,
    desktopRoot,
    packageProject,
    writeProjectPackageFile,
    boundedImageRead,
    projectPackageMaximumFileBytes,
    projectPackageFailure,
    validateProjectPackageData,
    importProjectPackage,
    parseProjectGraphFile,
    projectGraphTask,
    projectForFolderOpen,
    projectRoot,
    configDir,
    projectsDir,
    isPathInside
  } = options;

  ipcMain.handle("naimage:project:list", () => {
    const list = readProjectList();
    return { ok: true, ...list };
  });

  ipcMain.handle("naimage:project:create", (_event, payload) => {
    const list = readProjectList();
    const record = createProjectRecord(payload?.name || `画布 ${list.projects.length + 1}`);
    ensureProjectFiles(record, defaultSession);
    const next = writeProjectList({ activeProjectId: record.id, projects: [record, ...list.projects] });
    log(`project create ${record.id}`);
    return { ok: true, project: record, projects: next.projects, activeProjectId: next.activeProjectId, session: defaultSession };
  });

  ipcMain.handle("naimage:project:create-folder", async (_event, payload) => {
    const result = await dialog.showOpenDialog({
      title: "选择新项目保存位置",
      buttonLabel: "在这里创建",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    const list = readProjectList();
    const projectName = safeName(payload?.name, `项目 ${list.projects.length + 1}`);
    const selectedPath = nextExternalProjectFolderPath(result.filePaths[0], projectName, list);
    const record = createProjectRecord(projectName, selectedPath);
    list.projects.unshift(record);
    ensureProjectFiles(record, defaultSession);
    const next = writeProjectList({ ...list, activeProjectId: record.id });
    const session = projectSessionFromDisk(record);
    log(`project create folder ${selectedPath}`);
    return { ok: true, path: selectedPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  });

  ipcMain.handle("naimage:project:switch", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    ensureProjectFiles(project, defaultSession);
    const next = writeProjectList({ ...list, activeProjectId: id });
    const session = projectSessionFromDisk(project);
    writeJson(project.sessionPath, sessionForProjectSave(session, project));
    writeProjectManifest(project, session);
    log(`project switch ${id}`);
    return { ok: true, project, projects: next.projects, activeProjectId: id, session };
  });

  ipcMain.handle("naimage:project:rename", (_event, payload) => {
    const id = String(payload?.id || "");
    const name = safeName(payload?.name, "");
    if (!id || !name) return { ok: false, error: "画布名称不能为空。" };
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };

    const renamed = { ...project, name, updatedAt: new Date().toISOString() };
    const next = writeProjectList({
      ...list,
      projects: list.projects.map((item) => (item.id === id ? renamed : item))
    });
    ensureProjectFiles(renamed, defaultSession);
    const session = projectSessionFromDisk(renamed);
    writeJson(renamed.sessionPath, sessionForProjectSave(session, renamed));
    writeProjectManifest(renamed, session);
    log(`project rename ${id}`);
    return { ok: true, project: renamed, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });

  ipcMain.handle("naimage:project:open", async () => {
    const result = await dialog.showOpenDialog({
      title: "打开 naimage 画布",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      log("project open canceled");
      return { ok: true, canceled: true };
    }
    let selectedPath = result.filePaths[0];
    const list = readProjectList();
    let record = list.projects.find((item) => path.resolve(item.path) === path.resolve(selectedPath));
    if (!record) {
      record = createProjectRecord(path.basename(selectedPath), selectedPath);
      ensureProjectFiles(record, defaultSession);
      list.projects.unshift(record);
    }
    const next = writeProjectList({ ...list, activeProjectId: record.id });
    ensureProjectFiles(record, defaultSession);
    const session = projectSessionFromDisk(record);
    writeJson(record.sessionPath, sessionForProjectSave(session, record));
    writeProjectManifest(record, session);
    log(`project open ${selectedPath}`);
    return { ok: true, path: selectedPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  });

  ipcMain.handle("naimage:project:export", async () => {
    const list = readProjectList();
    const project = getActiveProject(list);
    if (!project) return { ok: false, error: "当前没有可导出的画布。" };
    const result = await dialog.showSaveDialog({
      title: "导出 naimage 画布",
      defaultPath: path.join(project.path || desktopRoot, `${safeName(project.name, "naimage画布")}.naimage`),
      filters: [{ name: "naimage Project", extensions: ["naimage"] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const packageData = packageProject(project);
    writeProjectPackageFile(result.filePath, packageData);
    writeProjectManifest(project, packageData.session);
    log(`project export ${result.filePath}`);
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle("naimage:project:import", async () => {
    const open = await dialog.showOpenDialog({
      title: "导入 naimage 画布",
      properties: ["openFile"],
      filters: [{ name: "naimage Project", extensions: ["naimage", LEGACY_PROJECT_PACKAGE_EXTENSION, "json"] }]
    });
    if (open.canceled || open.filePaths.length === 0) return { ok: true, canceled: true };
    const sourceFile = open.filePaths[0];
    const packageBuffer = boundedImageRead(sourceFile, projectPackageMaximumFileBytes, path.basename(sourceFile), "项目文件");
    let packageData;
    try {
      packageData = JSON.parse(packageBuffer.toString("utf8"));
    } catch {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "画布项目包不是有效的 JSON 文件。");
    }
    validateProjectPackageData(packageData);
    const target = await dialog.showOpenDialog({
      title: "选择导入画布的父目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (target.canceled || target.filePaths.length === 0) return { ok: true, canceled: true };
    const list = readProjectList();
    const targetPath = nextExternalProjectFolderPath(
      target.filePaths[0],
      safeName(packageData?.project?.name || path.basename(sourceFile, path.extname(sourceFile)), "导入画布"),
      list
    );
    const { record, session } = importProjectPackage(packageData, targetPath);
    const withoutSamePath = list.projects.filter((item) => path.resolve(item.path) !== path.resolve(record.path));
    const next = writeProjectList({ activeProjectId: record.id, projects: [record, ...withoutSamePath] });
    log(`project import ${sourceFile} -> ${targetPath}`);
    return { ok: true, path: targetPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  });

  ipcMain.handle("naimage:project-graph:import", async () => {
    const open = await dialog.showOpenDialog({
      title: "导入 Project Graph 思维导图",
      properties: ["openFile"],
      filters: [{ name: "Project Graph", extensions: ["prg", "json"] }]
    });
    if (open.canceled || open.filePaths.length === 0) return { ok: true, canceled: true };
    const sourceFile = open.filePaths[0];
    try {
      const graph = parseProjectGraphFile(sourceFile);
      log(`project graph import ${path.basename(sourceFile)} nodes=${graph.stats.nodeCount} edges=${graph.stats.edgeCount}`);
      return { ok: true, graph, task: projectGraphTask(graph) };
    } catch (error) {
      const errorCode = String(error?.code || "PROJECT_GRAPH_IMPORT_FAILED");
      const message = error instanceof Error ? error.message : String(error);
      log(`project graph import failed code=${errorCode}`);
      return { ok: false, errorCode, error: message };
    }
  });

  ipcMain.handle("naimage:project-skill:import", async () => {
    const open = await dialog.showOpenDialog({
      title: "导入 SKILL.md",
      buttonLabel: "导入 Skill",
      properties: ["openFile"],
      filters: [{ name: "Agent Skill Markdown", extensions: ["md"] }]
    });
    if (open.canceled || open.filePaths.length === 0) return { ok: true, canceled: true };
    const sourceFile = open.filePaths[0];
    const result = readSkillMarkdownFile(sourceFile);
    if (result.ok) log(`skill markdown selected name=${result.sourceName} bytes=${result.byteLength}`);
    else log(`skill markdown read failed name=${path.basename(sourceFile).slice(0, 180) || "SKILL.md"} code=${result.errorCode}`);
    if (!result.ok) return result;
    const parsed = parseSkillResult(result.markdown, result.sourceName);
    if (!parsed.ok) log(`skill markdown parse failed name=${result.sourceName} code=${parsed.errorCode}`);
    return parsed;
  });

  ipcMain.handle("naimage:project-skill:parse", (_event, payload = {}) => {
    const parsed = parseSkillResult(payload?.markdown, payload?.sourceName);
    log(`skill markdown parse ${parsed.ok ? "ok" : `failed code=${parsed.errorCode}`}`);
    return parsed;
  });

  ipcMain.handle("naimage:project:open-current-folder", async (_event, payload) => {
    const list = readProjectList();
    const requestedProjectId = String(payload?.id || "").trim();
    const project = projectForFolderOpen(list, requestedProjectId);
    if (requestedProjectId && !project) return { ok: false, error: "当前项目不存在或已经被移除。" };
    if (!project?.path) return { ok: false, error: "当前没有可打开的画布文件夹。" };
    if (!existsSync(project.path)) {
      if (project.external) return { ok: false, error: "当前外部画布文件夹不存在或已被移除。" };
      mkdirSync(project.path, { recursive: true });
    }
    const error = await shell.openPath(project.path);
    if (error) return { ok: false, error };
    log(`project folder open ${project.path}`);
    return { ok: true, path: project.path, projectId: project.id };
  });

  ipcMain.handle("naimage:project:delete", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    if (project.id === "default") return { ok: false, error: "默认项目不能删除，可以创建或打开其他项目后切换使用。" };

    const remaining = list.projects.filter((item) => item.id !== id);
    if (!remaining.length) return { ok: false, error: "至少需要保留一个画布。" };
    const activeProjectId = list.activeProjectId === id ? remaining[0].id : list.activeProjectId;
    const next = writeProjectList({ activeProjectId, projects: remaining });
    const activeProject = getActiveProject(next);
    ensureProjectFiles(activeProject, defaultSession);
    const session = projectSessionFromDisk(activeProject);
    log(`project remove ${id}`);
    return { ok: true, project: activeProject, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });

  ipcMain.handle("naimage:project:delete-folder", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    if (project.id === "default") return { ok: false, error: "默认项目文件夹不能删除。" };

    const projectPath = path.resolve(project.path || "");
    const protectedPaths = new Set([path.resolve(projectRoot), path.resolve(desktopRoot), path.resolve(configDir), path.resolve(projectsDir)]);
    if (!projectPath || protectedPaths.has(projectPath)) return { ok: false, error: "画布路径受保护，已取消删除。" };
    if (project.external || !isPathInside(projectPath, projectsDir)) {
      return { ok: false, error: "外部画布文件夹不会被 naimage 删除。可以使用“移除”从画布列表移除，磁盘文件请在系统文件管理器中处理。" };
    }
    if (existsSync(projectPath)) {
      rmSync(projectPath, { recursive: true, force: true });
    }

    const remaining = list.projects.filter((item) => item.id !== id);
    if (!remaining.length) return { ok: false, error: "至少需要保留一个画布。" };
    const activeProjectId = list.activeProjectId === id ? remaining[0].id : list.activeProjectId;
    const next = writeProjectList({ activeProjectId, projects: remaining });
    const activeProject = getActiveProject(next);
    ensureProjectFiles(activeProject, defaultSession);
    const session = projectSessionFromDisk(activeProject);
    log(`project delete folder ${id}`);
    return { ok: true, project: activeProject, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });
}

module.exports = { MAX_SKILL_MARKDOWN_BYTES, readSkillMarkdownFile, registerProjectIpc };
