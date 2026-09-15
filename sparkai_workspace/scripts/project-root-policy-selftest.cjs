"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectStore } = require("../desktop/project-store.cjs");
const { registerProjectIpc } = require("../desktop/ipc/project-ipc.cjs");
const { registerSessionIpc } = require("../desktop/ipc/config-ipc.cjs");

const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-project-root-policy-"));
const configDir = path.join(testRoot, "user-data");
const projectsDir = path.join(configDir, "projects");
const projectListPath = path.join(configDir, "project-list.json");
const globalSessionPath = path.join(configDir, "session.json");
const selectedParent = path.join(testRoot, "selected-parent");
const defaultSession = { schemaVersion: 5, workspaceDomain: "general", sessionRevision: 0, nodes: [], messages: [] };

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function comparablePath(value) {
  return path.resolve(String(value || "")).toLowerCase();
}

function isPathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const store = createProjectStore({
  comparablePath,
  defaultSession,
  exportSessionFileName: "start.naimage",
  isPathInside,
  normalizeSessionRevision: (value) => Number.isFinite(Number(value)) ? Number(value) : null,
  projectListPath,
  projectManifestFileName: "project.json",
  projectMetaDirName: ".naimage",
  projectRoot: testRoot,
  projectsDir,
  readJson,
  sessionForProjectSave: (session) => ({ ...defaultSession, ...(session || {}) }),
  sessionHasContent: (session) => Boolean(session?.nodes?.length || session?.messages?.length),
  sessionPath: globalSessionPath,
  sessionWithProjectAssets: (session) => session,
  writeJson
});

async function run() {
  assert.deepEqual(store.defaultProjectList(), { activeProjectId: "", projects: [] });
  assert.deepEqual(store.normalizeProjectList(undefined), { activeProjectId: "", projects: [] });
  assert.equal(store.getActiveProject({ activeProjectId: "", projects: [] }), null);
  assert.equal(store.currentSessionPath(), "");
  assert.throws(
    () => store.createProjectRecord("No path"),
    (error) => error?.code === "PROJECT_PATH_REQUIRED"
  );

  const legacyProjectPath = path.join(projectsDir, "default");
  const legacyList = store.normalizeProjectList({
    activeProjectId: "default",
    projects: [{ id: "default", name: "默认项目", path: legacyProjectPath, external: false }]
  });
  assert.equal(legacyList.projects.length, 1, "Existing AppData projects must remain readable");
  assert.equal(legacyList.projects[0].path, path.resolve(legacyProjectPath));
  assert.equal(legacyList.projects[0].external, false);

  mkdirSync(selectedParent, { recursive: true });
  let projectList = store.defaultProjectList();
  let dialogCanceled = true;
  let ensureCount = 0;
  let listWriteCount = 0;
  const projectHandlers = new Map();
  registerProjectIpc({
    ipcMain: { handle: (channel, handler) => projectHandlers.set(channel, handler) },
    dialog: {
      showOpenDialog: async () => dialogCanceled
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [selectedParent] }
    },
    shell: { openPath: async () => "" },
    log: () => undefined,
    defaultSession,
    readProjectList: () => projectList,
    createProjectRecord: store.createProjectRecord,
    ensureProjectFiles: () => { ensureCount += 1; },
    writeProjectList: (value) => {
      listWriteCount += 1;
      projectList = store.normalizeProjectList(value);
      return projectList;
    },
    safeName: store.safeName,
    nextExternalProjectFolderPath: store.nextExternalProjectFolderPath,
    projectSessionFromDisk: () => ({ ...defaultSession }),
    writeJson: () => undefined,
    sessionForProjectSave: (session) => session,
    writeProjectManifest: () => undefined,
    getActiveProject: store.getActiveProject,
    projectForFolderOpen: store.projectForFolderOpen
  });

  const canceled = await projectHandlers.get("naimage:project:create")(undefined, { name: "Canceled" });
  assert.equal(canceled.canceled, true);
  assert.equal(ensureCount, 0, "Canceling the directory picker must not initialize project files");
  assert.equal(listWriteCount, 0, "Canceling the directory picker must not update the recent-project index");
  assert.equal(existsSync(projectsDir), false, "Canceling project creation must not create the AppData projects directory");

  dialogCanceled = false;
  const created = await projectHandlers.get("naimage:project:create")(undefined, { name: "Root policy" });
  assert.equal(created.ok, true);
  assert.equal(isPathInside(created.project.path, selectedParent), true);
  assert.equal(isPathInside(created.project.sessionPath, created.project.path), true);
  assert.equal(isPathInside(created.project.path, configDir), false);
  assert.equal(created.project.external, true);

  projectList = { activeProjectId: created.project.id, projects: [created.project] };
  const removed = projectHandlers.get("naimage:project:delete")(undefined, { id: created.project.id });
  assert.equal(removed.ok, true);
  assert.equal(removed.activeProjectId, "");
  assert.deepEqual(removed.projects, []);
  assert.equal(removed.project, null);
  assert.deepEqual(removed.session, defaultSession);

  const guardedFolder = path.join(selectedParent, "guarded-folder");
  mkdirSync(guardedFolder, { recursive: true });
  const guardedProject = store.createProjectRecord("Guarded", guardedFolder);
  projectList = { activeProjectId: guardedProject.id, projects: [guardedProject] };
  const rejectedDelete = projectHandlers.get("naimage:project:delete-folder")(undefined, { id: guardedProject.id });
  assert.equal(rejectedDelete.errorCode, "PROJECT_FOLDER_DELETE_UNSUPPORTED");
  assert.equal(existsSync(guardedFolder), true, "The app must never delete a user-owned project directory");

  const sessionHandlers = new Map();
  let sessionWriteCount = 0;
  projectList = store.defaultProjectList();
  registerSessionIpc({
    ipcMain: { handle: (channel, handler) => sessionHandlers.set(channel, handler) },
    readProjectList: () => projectList,
    getActiveProject: store.getActiveProject,
    sessionPath: globalSessionPath,
    ensureProjectFiles: () => assert.fail("No-project load must not initialize project files"),
    readJson,
    defaultSession,
    projectSessionFromDisk: () => assert.fail("No-project load must not read a project session"),
    hydrateSessionAssets: (session) => session,
    writeJson: () => { sessionWriteCount += 1; },
    sessionForProjectSave: (session) => session,
    writeProjectManifest: () => undefined,
    log: () => undefined,
    getProjectById: store.getProjectById,
    projectSessionSaveCoordinator: { enqueue: () => assert.fail("No-project save must not enter the save coordinator") },
    sanitizeSession: (session) => ({ ...defaultSession, ...(session || {}) }),
    sessionHasContent: () => false,
    writeProjectList: () => undefined
  });

  const loaded = sessionHandlers.get("naimage:config:load-session")(undefined, {});
  assert.equal(loaded.ok, true);
  assert.equal(loaded.path, "");
  assert.equal(loaded.activeProjectId, "");
  const rejectedSave = await sessionHandlers.get("naimage:config:save-session")(undefined, { nodes: [{ id: "memory-only" }] });
  assert.equal(rejectedSave.ok, false);
  assert.equal(rejectedSave.errorCode, "PROJECT_REQUIRED");
  assert.equal(sessionWriteCount, 0);
  assert.equal(existsSync(globalSessionPath), false, "No-project work must never create a global Session file");

  const isolatedProjectPath = path.join(selectedParent, "isolated-session-project");
  const isolatedProject = store.createProjectRecord("Isolated", isolatedProjectPath);
  projectList = { activeProjectId: isolatedProject.id, projects: [isolatedProject] };
  writeJson(globalSessionPath, { ...defaultSession, messages: [{ role: "user", content: "GLOBAL_SESSION_MUST_NOT_LEAK" }] });
  const isolatedHandlers = new Map();
  let isolatedFallback = null;
  registerSessionIpc({
    ipcMain: { handle: (channel, handler) => isolatedHandlers.set(channel, handler) },
    readProjectList: () => projectList,
    getActiveProject: store.getActiveProject,
    sessionPath: globalSessionPath,
    ensureProjectFiles: (project, fallback) => {
      isolatedFallback = fallback;
      if (!existsSync(project.sessionPath)) writeJson(project.sessionPath, fallback);
    },
    readJson,
    defaultSession,
    projectSessionFromDisk: (project) => readJson(project.sessionPath, defaultSession),
    hydrateSessionAssets: (session) => session,
    writeJson,
    sessionForProjectSave: (session) => session,
    writeProjectManifest: () => undefined,
    log: () => undefined,
    getProjectById: store.getProjectById,
    projectSessionSaveCoordinator: { enqueue: () => assert.fail("Load must not enter the save coordinator") },
    sanitizeSession: (session) => ({ ...defaultSession, ...(session || {}) }),
    sessionHasContent: () => false,
    writeProjectList: () => undefined,
    projectsDir,
    isPathInside
  });
  const isolatedLoad = isolatedHandlers.get("naimage:config:load-session")(undefined, {});
  assert.equal(isolatedFallback.messages.length, 0, "A user-selected project must not inherit the old global AppData Session");
  assert.equal(isolatedLoad.session.messages.length, 0);

  const packagedSmokeSource = readFileSync(path.join(__dirname, "release", "packaged-smoke.mjs"), "utf8");
  const restartUpdateSource = readFileSync(path.join(__dirname, "release", "restart-update-e2e.mjs"), "utf8");
  assert.match(packagedSmokeSource, /activeProjectId: smokeProjectId[\s\S]{0,500}external: true/, "Packaged smoke must seed an explicit isolated project");
  assert.doesNotMatch(packagedSmokeSource, /projectId:\s*"default"/, "Packaged smoke must not revive the removed virtual default project");
  assert.match(restartUpdateSource, /activeProjectId: updateProjectId[\s\S]{0,500}external: true/, "Restart-update E2E must seed an explicit isolated project");
  assert.doesNotMatch(restartUpdateSource, /\|\|\s*"default"/, "Restart-update E2E must fail instead of falling back to a virtual default project");

  return {
    ok: true,
    cases: 19,
    emptyProjectState: true,
    explicitProjectRootRequired: true,
    legacyAppDataProjectReadable: true,
    userProjectDeletionBlocked: true,
    globalSessionWriteBlocked: true,
    externalProjectGlobalSessionLeakBlocked: true,
    releaseFixturesUseExplicitProjects: true
  };
}

run()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    try { rmSync(testRoot, { recursive: true, force: true }); } catch {}
  });
