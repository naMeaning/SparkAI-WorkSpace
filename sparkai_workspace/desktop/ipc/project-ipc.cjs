"use strict";

const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const {
  MAX_SKILL_MARKDOWN_BYTES,
  parseSkillResult,
  readSkillMarkdownFile
} = require("../skill-import.cjs");
const { normalizeWorkspaceDomain } = require("../../runtime/workspace-domain.cjs");

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
    projectDataMigrationService,
    projectRoot,
    configDir,
    projectsDir,
    isPathInside
  } = options;

  ipcMain.handle("naimage:project:list", () => {
    const list = readProjectList();
    return { ok: true, ...list };
  });

  const migrationUnavailable = () => ({
    ok: false,
    errorCode: "PROJECT_MIGRATION_UNAVAILABLE",
    error: "当前桌面运行时未提供旧项目数据迁移服务，请重启应用后再试。"
  });

  function migrationFailure(error, fallbackMessage) {
    const errorCode = String(error?.code || "PROJECT_MIGRATION_FAILED");
    const expected = errorCode.startsWith("PROJECT_MIGRATION_");
    log(`project migration failed code=${errorCode}`);
    return {
      ok: false,
      errorCode,
      error: expected && error instanceof Error ? error.message : fallbackMessage,
      ...(error?.details?.candidateId ? { details: { candidateId: String(error.details.candidateId) } } : {})
    };
  }

  ipcMain.handle("naimage:project:migration-preview", async () => {
    if (!projectDataMigrationService) return migrationUnavailable();
    try {
      const preview = await projectDataMigrationService.previewLegacyData();
      return projectDataMigrationService.publicMigrationPreview(preview);
    } catch (error) {
      return migrationFailure(error, "旧项目数据预检失败，未修改任何文件。");
    }
  });

  ipcMain.handle("naimage:project:migrate", async (_event, payload = {}) => {
    if (!projectDataMigrationService) return migrationUnavailable();
    if (payload?.confirmed !== true) {
      return {
        ok: false,
        errorCode: "PROJECT_MIGRATION_CONFIRMATION_REQUIRED",
        error: "迁移前必须明确确认预检结果。"
      };
    }
    try {
      const target = await dialog.showOpenDialog({
        title: "选择迁移后的项目父目录",
        buttonLabel: "迁移到这里",
        properties: ["openDirectory", "createDirectory"]
      });
      if (target.canceled || target.filePaths.length === 0) return { ok: true, canceled: true };
      const migrated = await projectDataMigrationService.migrateLegacyProjects({
        confirmed: true,
        previewToken: payload?.previewToken,
        candidateIds: payload?.candidateIds,
        targetParent: target.filePaths[0]
      });
      const list = readProjectList();
      const project = getActiveProject(list);
      if (project) ensureProjectFiles(project, defaultSession);
      const session = project ? projectSessionFromDisk(project) : { ...defaultSession };
      return {
        ...migrated,
        project,
        projects: list.projects,
        activeProjectId: list.activeProjectId,
        session
      };
    } catch (error) {
      return migrationFailure(error, "旧项目数据迁移失败，C 盘源数据保持不变。");
    }
  });

  ipcMain.handle("naimage:project:migration-cleanup", async (_event, payload = {}) => {
    if (!projectDataMigrationService) return migrationUnavailable();
    try {
      return await projectDataMigrationService.cleanupMigratedSource({
        migrationId: payload?.migrationId,
        confirmedCleanup: payload?.confirmedCleanup === true
      });
    } catch (error) {
      return migrationFailure(error, "C 盘旧数据清理失败，未继续删除其他源数据。");
    }
  });

  async function createProjectInSelectedParent(payload) {
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
    const initialSession = { ...defaultSession, workspaceDomain: normalizeWorkspaceDomain(payload?.workspaceDomain) };
    ensureProjectFiles(record, initialSession);
    const next = writeProjectList({ ...list, activeProjectId: record.id });
    const session = projectSessionFromDisk(record);
    log(`project create folder ${selectedPath}`);
    return { ok: true, path: selectedPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  }

  ipcMain.handle("naimage:project:create", (_event, payload) => createProjectInSelectedParent(payload));
  ipcMain.handle("naimage:project:create-folder", (_event, payload) => createProjectInSelectedParent(payload));

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
      title: "打开 SparkAI WorkSpace 画布",
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
      title: "导出 SparkAI WorkSpace 画布",
      defaultPath: path.join(project.path || desktopRoot, `${safeName(project.name, "naimage画布")}.naimage`),
      filters: [{ name: "SparkAI WorkSpace Project", extensions: ["naimage"] }]
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
      title: "导入 SparkAI WorkSpace 画布",
      properties: ["openFile"],
      filters: [{ name: "SparkAI WorkSpace Project", extensions: ["naimage", LEGACY_PROJECT_PACKAGE_EXTENSION, "json"] }]
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
    const remaining = list.projects.filter((item) => item.id !== id);
    const activeProjectId = list.activeProjectId === id ? remaining[0]?.id || "" : list.activeProjectId;
    const next = writeProjectList({ activeProjectId, projects: remaining });
    const activeProject = getActiveProject(next);
    if (activeProject) ensureProjectFiles(activeProject, defaultSession);
    const session = activeProject ? projectSessionFromDisk(activeProject) : { ...defaultSession };
    log(`project remove ${id}`);
    return { ok: true, project: activeProject, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });

  ipcMain.handle("naimage:project:delete-folder", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    return {
      ok: false,
      errorCode: "PROJECT_FOLDER_DELETE_UNSUPPORTED",
      error: "SparkAI WorkSpace 不会删除项目文件夹。请先从项目列表移除，再在系统文件管理器中自行处理磁盘文件。"
    };
  });
}

module.exports = { MAX_SKILL_MARKDOWN_BYTES, readSkillMarkdownFile, registerProjectIpc };
