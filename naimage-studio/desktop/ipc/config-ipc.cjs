"use strict";

const {
  mergeProjectSessions,
  prepareIncomingNodeMutationSession
} = require("../project-session-merge.cjs");

function registerSettingsIpc({
  ipcMain,
  migrateSettings,
  readJson,
  settingsPath,
  defaultSettings,
  log,
  onNewApiAccountBaseUrlChanged,
  onSettingsSaved,
  publicSettings,
  restoreSettingsSecrets,
  themePresetService,
  validateNewApiServiceSettings,
  writeJson
}) {
  ipcMain.handle("naimage:config:load-settings", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("config load settings");
    return { ok: true, path: settingsPath, settings: publicSettings(settings) };
  });

  ipcMain.handle("naimage:config:save-settings", (event, settings) => {
    const current = migrateSettings(readJson(settingsPath, defaultSettings));
    const restoredSettings = restoreSettingsSecrets?.(settings, current) || settings;
    let next = migrateSettings({
      ...current,
      ...(restoredSettings || {}),
      // Account credentials are Main-owned and omitted from Renderer settings.
      // A stale settings draft must never clear, replace, or downgrade them.
      serverAuthProtocol: current.serverAuthProtocol,
      serverAccessToken: current.serverAccessToken,
      serverAccessExpiresAt: current.serverAccessExpiresAt,
      serverSessionCookie: current.serverSessionCookie,
      serverAuthSessionId: current.serverAuthSessionId,
      serverUserId: current.serverUserId,
      // License identity and tokens are Main-owned secrets. They are omitted
      // from load-settings and Renderer saves must never clear or replace them.
      licenseDeviceId: current.licenseDeviceId,
      licenseToken: current.licenseToken,
      licensePlan: current.licensePlan,
      licenseExpiresAt: current.licenseExpiresAt,
      licenseLastVerifiedAt: current.licenseLastVerifiedAt,
      // The selected token is updated through the account-token IPC after
      // ownership validation. A stale Renderer settings draft must not replace it.
      selectedAccountTokenId: current.selectedAccountTokenId,
      selectedAccountTokenName: current.selectedAccountTokenName,
      selectedAccountTokenGroup: current.selectedAccountTokenGroup
    });
    validateNewApiServiceSettings?.(next);
    const accountChanged = String(current.accountBaseUrl || "").toLowerCase() !== String(next.accountBaseUrl || "").toLowerCase();
    if (accountChanged) {
      next = migrateSettings({
        ...next,
        serverToken: "",
        serverAuthProtocol: "",
        serverAccessToken: "",
        serverAccessExpiresAt: 0,
        serverSessionCookie: "",
        serverAuthSessionId: "",
        serverUserId: "",
        selectedAccountTokenId: "",
        selectedAccountTokenName: "",
        selectedAccountTokenGroup: ""
      });
      onNewApiAccountBaseUrlChanged?.(current, next);
    }
    writeJson(settingsPath, next);
    try {
      onSettingsSaved?.(event, next, current);
    } catch (error) {
      log(`config saved callback failed ${error instanceof Error ? error.message : String(error)}`);
    }
    log("config save settings");
    return { ok: true, path: settingsPath, accountChanged };
  });

  ipcMain.handle("naimage:theme:import", () => themePresetService.importPreset());
  ipcMain.handle("naimage:theme:export", (_event, theme) => themePresetService.exportPreset(theme));
}

function registerGlassBackgroundIpc({
  ipcMain,
  glassBackgroundService,
  BrowserWindow,
  getReferencedGlassBackgroundAssetIds = () => []
}) {
  const unavailable = () => ({
    ok: false,
    errorCode: "GLASS_BACKGROUND_UNAVAILABLE",
    error: "Managed workspace backgrounds are unavailable in this runtime."
  });

  ipcMain.handle("naimage:glass-background:pick", async (event) => {
    if (!glassBackgroundService) return unavailable();
    const owner = BrowserWindow?.fromWebContents?.(event.sender) || null;
    const result = await glassBackgroundService.pick(owner);
    if (result?.ok && result.asset?.assetId) {
      glassBackgroundService.cleanup({
        referencedAssetIds: [
          ...getReferencedGlassBackgroundAssetIds(),
          result.asset.assetId
        ]
      });
    }
    return result;
  });

  ipcMain.handle("naimage:glass-background:load", (_event, payload = {}) => {
    if (!glassBackgroundService) return unavailable();
    return glassBackgroundService.load(payload);
  });

  ipcMain.handle("naimage:glass-background:clear", (_event, payload = {}) => {
    if (!glassBackgroundService) return unavailable();
    return glassBackgroundService.clear(payload, getReferencedGlassBackgroundAssetIds());
  });
}

function registerRequirementLibraryIpc({ ipcMain, requirementLibraryService }) {
  const invoke = (operation) => {
    if (!requirementLibraryService) {
      return { ok: false, errorCode: "REQUIREMENT_LIBRARY_UNAVAILABLE", error: "当前桌面运行时未提供个人需求模板库。" };
    }
    try {
      return operation();
    } catch (error) {
      return {
        ok: false,
        errorCode: typeof error?.code === "string" ? error.code : "REQUIREMENT_LIBRARY_FAILED",
        error: error instanceof Error ? error.message : String(error),
        ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
      };
    }
  };

  ipcMain.handle("naimage:requirement-library:list", (_event, payload = {}) => invoke(() => requirementLibraryService.list(payload)));
  ipcMain.handle("naimage:requirement-library:get", (_event, payload = {}) => invoke(() => requirementLibraryService.get(payload)));
  ipcMain.handle("naimage:requirement-library:save", (_event, payload = {}) => invoke(() => requirementLibraryService.save(payload)));
  ipcMain.handle("naimage:requirement-library:delete", (_event, payload = {}) => invoke(() => requirementLibraryService.remove(payload)));
}

function registerSessionIpc({
  ipcMain,
  readProjectList,
  getActiveProject,
  sessionPath,
  ensureProjectFiles,
  readJson,
  defaultSession,
  projectSessionFromDisk,
  hydrateSessionAssets,
  writeJson,
  sessionForProjectSave,
  writeProjectManifest,
  log,
  getProjectById,
  projectSessionSaveCoordinator,
  sanitizeSession,
  sessionHasContent,
  writeProjectList,
  projectsDir,
  isPathInside
}) {
  ipcMain.handle("naimage:config:load-session", (_event, payload = {}) => {
    const list = readProjectList();
    const requestedProjectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
    const activeProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    if (requestedProjectId && !activeProject) {
      return { ok: false, errorCode: "PROJECT_NOT_FOUND", error: "要加载的项目不存在或已经被移除。" };
    }
    if (!activeProject) {
      log("config load session without project");
      return { ok: true, path: "", project: null, projects: list.projects, activeProjectId: "", session: sanitizeSession(defaultSession) };
    }
    const activeSessionPath = activeProject.sessionPath;
    const isLegacyManagedProject = Boolean(
      activeProject.external === false &&
      projectsDir &&
      typeof isPathInside === "function" &&
      isPathInside(activeProject.path, projectsDir)
    );
    const legacyFallback = isLegacyManagedProject ? readJson(sessionPath, defaultSession) : defaultSession;
    ensureProjectFiles(activeProject, readJson(activeSessionPath, legacyFallback));
    const session = projectSessionFromDisk(activeProject);
    writeJson(activeSessionPath, sessionForProjectSave(session, activeProject));
    writeProjectManifest(activeProject, session);
    log("config load session");
    return { ok: true, path: activeSessionPath, project: activeProject, projects: list.projects, activeProjectId: activeProject.id, session };
  });

  ipcMain.handle("naimage:config:save-session", async (_event, session, saveOptions = {}) => {
    const list = readProjectList();
    const requestedProjectId = typeof session?.projectId === "string" ? session.projectId.trim() : "";
    const targetProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    if (requestedProjectId && !targetProject) {
      return { ok: false, errorCode: "PROJECT_NOT_FOUND", error: "保存目标项目不存在或已被移除。", appliedRevision: 0, skippedStale: false };
    }
    if (!targetProject) {
      return { ok: false, errorCode: "PROJECT_REQUIRED", error: "请先创建或打开项目，再保存画布。", appliedRevision: 0, skippedStale: false };
    }
    const activeSessionPath = targetProject.sessionPath;
    const requestedRevision = saveOptions?.revision ?? session?.revision ?? session?.sessionRevision;
    const nodeMutationOptions = saveOptions?.nodeMutation && typeof saveOptions.nodeMutation === "object"
      ? saveOptions.nodeMutation
      : {};
    const prepareIncomingSession = (latestRaw) => prepareIncomingNodeMutationSession(latestRaw, session, {
      writerId: nodeMutationOptions.writerId,
      baselineNodes: nodeMutationOptions.baselineNodes,
      nextWriterSequence: nodeMutationOptions.writerSequence,
      observedRevision: nodeMutationOptions.observedRevision
    });
    const projectKey = targetProject.id;
    const applySession = async (appliedRevision, inputSession, mergedStale = false) => {
      const nextInput = { ...defaultSession, ...inputSession, sessionRevision: appliedRevision };
      delete nextInput.revision;
      delete nextInput.projectId;
      const next = sessionForProjectSave(nextInput, targetProject);
      const existingRaw = readJson(activeSessionPath, defaultSession);
      if (targetProject && !sessionHasContent(next) && sessionHasContent(existingRaw)) {
        log(`config save session skipped empty overwrite ${targetProject.id}`);
        return { ok: true, path: activeSessionPath, skipped: true, applied: false, reason: "empty-session-overwrite" };
      }
      writeJson(activeSessionPath, next);
      writeProjectManifest(targetProject, next);
      targetProject.updatedAt = new Date().toISOString();
      const latestList = readProjectList();
      writeProjectList({ ...latestList, projects: latestList.projects.map((item) => (item.id === targetProject.id ? targetProject : item)) });
      log(`config save session project=${targetProject.id} revision=${appliedRevision}${mergedStale ? " merged-stale" : ""}`);
      return {
        ok: true,
        path: activeSessionPath,
        applied: true,
        mergedStale,
        nodeMutationJournal: Array.isArray(next.nodeMutationJournal) ? next.nodeMutationJournal : [],
        nodeMutationWriterCheckpoints: Array.isArray(next.nodeMutationWriterCheckpoints) ? next.nodeMutationWriterCheckpoints : [],
        nodeMutationBarriers: Array.isArray(next.nodeMutationBarriers) ? next.nodeMutationBarriers : []
      };
    };
    let saveResult = await projectSessionSaveCoordinator.enqueue(projectKey, requestedRevision, async (appliedRevision) => {
      const latestRaw = readJson(activeSessionPath, defaultSession);
      const prepared = prepareIncomingSession(latestRaw);
      const reconciled = mergeProjectSessions(latestRaw, prepared.session, {
        nextRevision: appliedRevision,
        incomingOwnsNonNodeState: true,
        incomingWriterId: nodeMutationOptions.writerId
      });
      const applied = await applySession(appliedRevision, reconciled.session, false);
      return {
        ...applied,
        remappedNodeIds: reconciled.remappedNodeIds,
        nodeMutationJournal: reconciled.nodeMutationJournal,
        nodeMutationWriterCheckpoints: reconciled.nodeMutationWriterCheckpoints,
        nodeMutationBarriers: reconciled.nodeMutationBarriers,
        nodeMutationWriterSequence: prepared.nextWriterSequence
      };
    });
    if (saveResult?.skippedStale) {
      const staleRequestedRevision = saveResult.requestedRevision;
      saveResult = await projectSessionSaveCoordinator.enqueue(projectKey, null, async (appliedRevision) => {
        const latestRaw = readJson(activeSessionPath, defaultSession);
        const prepared = prepareIncomingSession(latestRaw);
        const merged = mergeProjectSessions(latestRaw, prepared.session, {
          nextRevision: appliedRevision,
          incomingWriterId: nodeMutationOptions.writerId
        });
        const applied = await applySession(appliedRevision, merged.session, true);
        return {
          ...applied,
          remappedNodeIds: merged.remappedNodeIds,
          mergedConversationCount: merged.mergedConversationCount,
          nodeMutationJournal: merged.nodeMutationJournal,
          nodeMutationWriterCheckpoints: merged.nodeMutationWriterCheckpoints,
          nodeMutationBarriers: merged.nodeMutationBarriers,
          nodeMutationWriterSequence: prepared.nextWriterSequence,
          staleRequestedRevision
        };
      });
    }
    return { ...saveResult, path: saveResult.path || activeSessionPath };
  });
}

module.exports = {
  registerGlassBackgroundIpc,
  registerRequirementLibraryIpc,
  registerSettingsIpc,
  registerSessionIpc
};
