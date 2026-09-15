"use strict";

const assert = require("node:assert/strict");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { registerSessionIpc } = require("../desktop/ipc/config-ipc.cjs");
const { createProjectSaveCoordinator } = require("../desktop/project-save-coordinator.cjs");
const {
  hydrateSessionAssets,
  sanitizeSession,
  sessionHasContent
} = require("../desktop/project-session-normalizer.cjs");

const repoRoot = path.resolve(__dirname, "..");
const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-dual-renderer-"));
const userDataRoot = path.join(testRoot, "user-data");
const preloadPath = path.join(repoRoot, "preload.cjs");
const windows = new Set();
let atomicWriteSequence = 0;
let projectList = { activeProjectId: "", projects: [] };
let acknowledgementGate = null;

mkdirSync(userDataRoot, { recursive: true });
app.setPath("userData", userDataRoot);
app.disableHardwareAcceleration();

const defaultSession = sanitizeSession({
  schemaVersion: 5,
  sessionRevision: 0,
  canvasRevision: 0,
  nodeSequence: 0,
  messages: [],
  conversations: [],
  activeConversationId: "",
  nodes: [],
  nodeMutationJournal: [],
  nodeMutationWriterCheckpoints: [],
  nodeMutationBarriers: [],
  layoutGroups: [],
  selectedNodeId: "",
  pendingAgentExecution: null
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
    })
  ]);
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return clone(fallback);
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteSequence += 1;
  const temporaryPath = `${filePath}.${process.pid}.${atomicWriteSequence}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function imageNode(id, persistenceOriginId, extra = {}) {
  return {
    id,
    displayCode: id,
    persistenceOriginId,
    title: `Node ${id}`,
    prompt: "dual renderer fixture",
    type: "image",
    status: "done",
    x: 10,
    y: 20,
    branch: "basic",
    outputs: 0,
    createdAt: "2026-07-29T00:00:00.000Z",
    assets: [],
    imageState: "empty",
    ...extra
  };
}

function initialSession(projectId) {
  return sanitizeSession({
    ...defaultSession,
    schemaVersion: 5,
    sessionRevision: 1,
    canvasRevision: 1,
    nodeSequence: 2,
    nodes: [
      imageNode("A", `${projectId}:target`),
      imageNode("B", `${projectId}:guard`, { x: 420, title: "Guard node" })
    ],
    selectedNodeId: "A"
  });
}

function addProject(projectId) {
  const projectPath = path.join(testRoot, "projects", projectId);
  const project = {
    id: projectId,
    name: projectId,
    path: projectPath,
    sessionPath: path.join(projectPath, "session.json"),
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    external: true
  };
  writeJson(project.sessionPath, initialSession(projectId));
  projectList.projects.push(project);
  if (!projectList.activeProjectId) projectList.activeProjectId = projectId;
  return project;
}

function projectById(projectId, list = projectList) {
  return (Array.isArray(list?.projects) ? list.projects : []).find((project) => project.id === projectId) || null;
}

function sessionDraft(snapshot, {
  projectId,
  nodes
}) {
  return {
    ...clone(snapshot),
    projectId,
    schemaVersion: 5,
    nodes: clone(nodes)
  };
}

function targetNode(session) {
  return session.nodes.find((node) => node.persistenceOriginId.endsWith(":target"));
}

function replaceTarget(nodes, update) {
  return nodes.map((node) => node.id === "A" ? { ...node, ...update } : node);
}

async function createRenderer(name) {
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    title: `dual-renderer-${name}`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  windows.add(window);
  window.once("closed", () => windows.delete(window));
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<title>${name}</title><main>${name}</main>`)}`);
  const bridgeReady = await window.webContents.executeJavaScript(
    "Boolean(window.naimageConfig && typeof window.naimageConfig.loadSession === 'function' && typeof window.naimageConfig.saveSession === 'function')",
    true
  );
  assert.equal(bridgeReady, true, `${name} must receive the production naimageConfig preload bridge.`);
  return window;
}

function bridgeCall(window, method, args) {
  assert(window && !window.isDestroyed(), `${method} requires a live Renderer window.`);
  const serializedArgs = JSON.stringify(JSON.stringify(args));
  return window.webContents.executeJavaScript(
    `window.naimageConfig[${JSON.stringify(method)}](...JSON.parse(${serializedArgs}))`,
    true
  );
}

async function loadSession(window, projectId) {
  const result = await withTimeout(
    bridgeCall(window, "loadSession", [{ projectId }]),
    8_000,
    `loadSession(${projectId})`
  );
  assert.equal(result.ok, true);
  assert.equal(result.project.id, projectId);
  return result.session;
}

function saveSession(window, session, revision, writerId, baselineNodes, observedRevision = revision - 1) {
  return withTimeout(
    bridgeCall(window, "saveSession", [session, {
      revision,
      nodeMutation: {
        writerId,
        observedRevision,
        baselineNodes: clone(baselineNodes)
      }
    }]),
    8_000,
    `saveSession(${session.projectId}, ${revision})`
  );
}

function assertConcurrentRevisions(results, expected) {
  assert.deepEqual(
    results.map((result) => result.appliedRevision).sort((left, right) => left - right),
    expected
  );
  assert.equal(results.filter((result) => result.mergedStale === true).length, expected.length - 1);
}

async function testEditEdit(rendererA, rendererB) {
  const projectId = "edit-edit";
  const [snapshotA, snapshotB] = await Promise.all([
    loadSession(rendererA, projectId),
    loadSession(rendererB, projectId)
  ]);
  const draftA = sessionDraft(snapshotA, {
    projectId,
    nodes: replaceTarget(snapshotA.nodes, { x: 111 })
  });
  const draftB = sessionDraft(snapshotB, {
    projectId,
    nodes: replaceTarget(snapshotB.nodes, { y: 222 })
  });
  const firstResults = await Promise.all([
    saveSession(rendererA, draftA, 2, "renderer-a", snapshotA.nodes),
    saveSession(rendererB, draftB, 2, "renderer-b", snapshotB.nodes)
  ]);
  assertConcurrentRevisions(firstResults, [2, 3]);
  const merged = await loadSession(rendererA, projectId);
  assert.equal(targetNode(merged).x, 111, "A persisted x edit must survive B's concurrent y edit.");
  assert.equal(targetNode(merged).y, 222, "B's independent y edit must be applied.");

  const [secondA, secondB] = await Promise.all([
    loadSession(rendererA, projectId),
    loadSession(rendererB, projectId)
  ]);
  const titleDraftA = sessionDraft(secondA, {
    projectId,
    nodes: replaceTarget(secondA.nodes, { title: "Title from A" })
  });
  const titleDraftB = sessionDraft(secondB, {
    projectId,
    nodes: replaceTarget(secondB.nodes, { title: "Title from B" })
  });
  const titleResults = await Promise.all([
    saveSession(rendererA, titleDraftA, 4, "renderer-a", secondA.nodes),
    saveSession(rendererB, titleDraftB, 4, "renderer-b", secondB.nodes)
  ]);
  assertConcurrentRevisions(titleResults, [4, 5]);
  const winningTitle = titleResults[0].appliedRevision > titleResults[1].appliedRevision
    ? "Title from A"
    : "Title from B";
  const finalSession = await loadSession(rendererB, projectId);
  assert.equal(targetNode(finalSession).title, winningTitle, "The later Main-serialized write must win a same-field edit conflict.");
}

async function testEditDelete(rendererA, rendererB) {
  const projectId = "edit-delete";
  const [snapshotA, snapshotB] = await Promise.all([
    loadSession(rendererA, projectId),
    loadSession(rendererB, projectId)
  ]);
  const editDraft = sessionDraft(snapshotA, {
    projectId,
    nodes: replaceTarget(snapshotA.nodes, { x: 333 })
  });
  const deleteDraft = sessionDraft(snapshotB, {
    projectId,
    nodes: snapshotB.nodes.filter((node) => node.id !== "A")
  });
  const results = await Promise.all([
    saveSession(rendererA, editDraft, 2, "renderer-a", snapshotA.nodes),
    saveSession(rendererB, deleteDraft, 2, "renderer-b", snapshotB.nodes)
  ]);
  assertConcurrentRevisions(results, [2, 3]);
  const finalSession = await loadSession(rendererA, projectId);
  assert.equal(targetNode(finalSession), undefined, "A concurrent delete must dominate an edit from the old generation.");
  assert.equal(finalSession.nodes.some((node) => node.id === "B"), true, "Unrelated nodes must survive the conflict.");
  assert.deepEqual(finalSession.nodeMutationJournal.map((event) => event.kind), ["delete"]);
}

async function testDeleteUndo(rendererA, rendererB) {
  const projectId = "delete-undo";
  const beforeDelete = await loadSession(rendererB, projectId);
  const originalTarget = clone(targetNode(beforeDelete));
  const deleteDraft = sessionDraft(beforeDelete, {
    projectId,
    nodes: beforeDelete.nodes.filter((node) => node.id !== "A")
  });
  const deleteResult = await saveSession(rendererB, deleteDraft, 2, "renderer-b", beforeDelete.nodes);
  assert.equal(deleteResult.appliedRevision, 2);

  const observedDelete = await loadSession(rendererA, projectId);
  assert.equal(targetNode(observedDelete), undefined);
  assert(observedDelete.nodeMutationJournal.some((event) => event.kind === "delete"), "The undoing Renderer must observe the persisted tombstone.");
  const restoreDraft = sessionDraft(observedDelete, {
    projectId,
    nodes: [...observedDelete.nodes, { ...originalTarget, x: 444 }]
  });
  const restoreResult = await saveSession(rendererA, restoreDraft, 3, "renderer-a", observedDelete.nodes);
  assert.equal(restoreResult.appliedRevision, 3);
  const restored = await loadSession(rendererB, projectId);
  assert.equal(targetNode(restored).x, 444, "Undo must restore the explicitly observed deleted generation.");
  assert.deepEqual(restored.nodeMutationJournal.map((event) => event.kind), ["delete", "restore"]);
}

async function testRapidConsecutiveSaves(rendererA, rendererB) {
  const projectId = "rapid-saves";
  const [snapshotA, snapshotB] = await Promise.all([
    loadSession(rendererA, projectId),
    loadSession(rendererB, projectId)
  ]);
  assert.equal(snapshotB.sessionRevision, 1, "The second Renderer must hold the same old baseline during rapid saves.");
  const firstDraft = sessionDraft(snapshotA, {
    projectId,
    nodes: replaceTarget(snapshotA.nodes, { x: 555 })
  });
  const secondDraft = sessionDraft(snapshotA, {
    projectId,
    nodes: replaceTarget(snapshotA.nodes, { x: 555, y: 666 })
  });
  const firstSave = saveSession(rendererA, firstDraft, 2, "renderer-a", snapshotA.nodes);
  const secondSave = saveSession(rendererA, secondDraft, 3, "renderer-a", firstDraft.nodes, 2);
  const results = await Promise.all([firstSave, secondSave]);
  assert.deepEqual(results.map((result) => result.appliedRevision), [2, 3], "IPC ordering must preserve rapid saves from one Renderer.");
  assert.equal(results.every((result) => result.mergedStale !== true), true);
  const finalSession = await loadSession(rendererB, projectId);
  assert.equal(targetNode(finalSession).x, 555);
  assert.equal(targetNode(finalSession).y, 666);
  assert.equal(finalSession.sessionRevision, 3);
}

async function testDestroyedAroundAcknowledgement(rendererA, rendererB) {
  const projectId = "destroyed-around-ack";
  const snapshotA = await loadSession(rendererA, projectId);
  const draft = sessionDraft(snapshotA, {
    projectId,
    nodes: replaceTarget(snapshotA.nodes, { x: 777 })
  });
  const applied = deferred();
  const releaseAcknowledgement = deferred();
  acknowledgementGate = {
    projectId,
    entered: false,
    applied,
    release: releaseAcknowledgement
  };
  const pendingSave = saveSession(rendererA, draft, 2, "renderer-a", snapshotA.nodes);
  await withTimeout(applied.promise, 8_000, "Main save before Renderer destruction");
  const onDiskBeforeAcknowledgement = sanitizeSession(readJson(projectById(projectId).sessionPath, defaultSession));
  assert.equal(onDiskBeforeAcknowledgement.sessionRevision, 2);
  assert.equal(targetNode(onDiskBeforeAcknowledgement).x, 777, "Main must commit before the invoke acknowledgement is released.");

  rendererA.destroy();
  releaseAcknowledgement.resolve();
  const destroyedOutcome = await Promise.allSettled([pendingSave]);
  assert.equal(destroyedOutcome[0].status, "rejected", "A destroyed Renderer cannot receive the pending save acknowledgement.");
  acknowledgementGate = null;

  const survivorSnapshot = await loadSession(rendererB, projectId);
  assert.equal(survivorSnapshot.sessionRevision, 2);
  assert.equal(targetNode(survivorSnapshot).x, 777, "Destroying the caller must not roll back Main's committed save.");
  const survivorDraft = sessionDraft(survivorSnapshot, {
    projectId,
    nodes: replaceTarget(survivorSnapshot.nodes, { y: 888 })
  });
  const acknowledgedSave = await saveSession(rendererB, survivorDraft, 3, "renderer-b", survivorSnapshot.nodes);
  assert.equal(acknowledgedSave.appliedRevision, 3, "The surviving Renderer must continue the project revision sequence.");
  rendererB.destroy();
  const onDiskAfterAcknowledgement = sanitizeSession(readJson(projectById(projectId).sessionPath, defaultSession));
  assert.equal(onDiskAfterAcknowledgement.sessionRevision, 3);
  assert.equal(targetNode(onDiskAfterAcknowledgement).x, 777);
  assert.equal(targetNode(onDiskAfterAcknowledgement).y, 888, "Destroying after acknowledgement must leave the acknowledged save durable.");
}

async function run() {
  for (const projectId of [
    "edit-edit",
    "edit-delete",
    "delete-undo",
    "rapid-saves",
    "destroyed-around-ack"
  ]) addProject(projectId);

  const baseCoordinator = createProjectSaveCoordinator({
    initialRevision(projectId) {
      const project = projectById(projectId);
      return project ? readJson(project.sessionPath, defaultSession).sessionRevision : 0;
    }
  });
  const projectSessionSaveCoordinator = {
    enqueue(projectId, requestedRevision, apply) {
      return baseCoordinator.enqueue(projectId, requestedRevision, async (...args) => {
        const result = await apply(...args);
        if (acknowledgementGate && acknowledgementGate.projectId === projectId && !acknowledgementGate.entered) {
          acknowledgementGate.entered = true;
          acknowledgementGate.applied.resolve(result);
          await acknowledgementGate.release.promise;
        }
        return result;
      });
    },
    pendingProjectCount: () => baseCoordinator.pendingProjectCount(),
    revision: (projectId) => baseCoordinator.revision(projectId)
  };

  registerSessionIpc({
    ipcMain,
    readProjectList: () => clone(projectList),
    getActiveProject: (list) => projectById(list.activeProjectId, list),
    sessionPath: path.join(testRoot, "fallback-session.json"),
    ensureProjectFiles(project, fallback) {
      if (!existsSync(project.sessionPath)) writeJson(project.sessionPath, fallback);
    },
    readJson,
    defaultSession,
    projectSessionFromDisk: (project) => sanitizeSession(readJson(project.sessionPath, defaultSession)),
    hydrateSessionAssets,
    writeJson,
    sessionForProjectSave: (session) => sanitizeSession(session),
    writeProjectManifest: () => undefined,
    log: () => undefined,
    getProjectById: projectById,
    projectSessionSaveCoordinator,
    sanitizeSession,
    sessionHasContent,
    writeProjectList(nextList) {
      projectList = clone(nextList);
    }
  });

  await app.whenReady();
  const rendererA = await createRenderer("A");
  const rendererB = await createRenderer("B");
  const rendererIds = [rendererA.webContents.id, rendererB.webContents.id];
  assert.notEqual(rendererIds[0], rendererIds[1], "The test must use two distinct Renderer webContents.");

  await testEditEdit(rendererA, rendererB);
  await testEditDelete(rendererA, rendererB);
  await testDeleteUndo(rendererA, rendererB);
  await testRapidConsecutiveSaves(rendererA, rendererB);
  await testDestroyedAroundAcknowledgement(rendererA, rendererB);
  assert.equal(projectSessionSaveCoordinator.pendingProjectCount(), 0, "No save queue may remain after Renderer destruction.");

  return {
    ok: true,
    rendererWindows: 2,
    rendererWebContents: rendererIds,
    cases: [
      "edit/edit",
      "edit/delete",
      "delete/undo",
      "rapid consecutive saves",
      "destroyed around save acknowledgement"
    ]
  };
}

async function cleanup() {
  if (acknowledgementGate) acknowledgementGate.release.resolve();
  for (const window of [...windows]) {
    if (!window.isDestroyed()) window.destroy();
  }
  ipcMain.removeHandler("naimage:config:load-session");
  ipcMain.removeHandler("naimage:config:save-session");
  rmSync(path.join(testRoot, "projects"), { recursive: true, force: true });
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } catch (error) {
    // Chromium keeps profile files open until Electron has fully exited on
    // Windows. Project/session fixtures have already been removed above.
    if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
  }
}

run().then(async (report) => {
  await cleanup();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  app.quit();
}).catch(async (error) => {
  await cleanup();
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
