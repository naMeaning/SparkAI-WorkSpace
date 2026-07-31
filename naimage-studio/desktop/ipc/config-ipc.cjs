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
    const incomingSessionCookie = typeof settings?.serverSessionCookie === "string" ? settings.serverSessionCookie.trim() : "";
    const incomingServerUserId = typeof settings?.serverUserId === "string" ? settings.serverUserId.trim() : "";
    let next = migrateSettings({
      ...current,
      ...(settings || {}),
      serverSessionCookie: incomingSessionCookie || current.serverSessionCookie,
      serverUserId: incomingServerUserId || current.serverUserId,
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
        serverSessionCookie: "",
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
  writeProjectList
}) {
  ipcMain.handle("naimage:config:load-session", (_event, payload = {}) => {
    const list = readProjectList();
    const requestedProjectId = typeof payload?.projectId === "string" ? payload.projectId.trim() : "";
    const activeProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    const activeSessionPath = activeProject?.sessionPath || sessionPath;
    if (activeProject) ensureProjectFiles(activeProject, readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
    const session = activeProject ? projectSessionFromDisk(activeProject) : hydrateSessionAssets(readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
    if (activeProject) {
      writeJson(activeSessionPath, sessionForProjectSave(session, activeProject));
      writeProjectManifest(activeProject, session);
    }
    log("config load session");
    return { ok: true, path: activeSessionPath, project: activeProject, projects: list.projects, activeProjectId: activeProject?.id || list.activeProjectId, session };
  });

  ipcMain.handle("naimage:config:save-session", async (_event, session, saveOptions = {}) => {
    const list = readProjectList();
    const requestedProjectId = typeof session?.projectId === "string" ? session.projectId.trim() : "";
    const targetProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    if (requestedProjectId && !targetProject) {
      return { ok: false, error: "保存目标项目不存在或已被移除。", appliedRevision: 0, skippedStale: false };
    }
    const activeSessionPath = targetProject?.sessionPath || sessionPath;
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
    const projectKey = targetProject?.id || "__global__";
    const applySession = async (appliedRevision, inputSession, mergedStale = false) => {
      const nextInput = { ...defaultSession, ...inputSession, sessionRevision: appliedRevision };
      delete nextInput.revision;
      delete nextInput.projectId;
      const next = targetProject ? sessionForProjectSave(nextInput, targetProject) : sanitizeSession(nextInput);
      const existingRaw = readJson(activeSessionPath, defaultSession);
      if (targetProject && !sessionHasContent(next) && sessionHasContent(existingRaw)) {
        log(`config save session skipped empty overwrite ${targetProject.id}`);
        return { ok: true, path: activeSessionPath, skipped: true, applied: false, reason: "empty-session-overwrite" };
      }
      writeJson(activeSessionPath, next);
      if (targetProject?.id === "default" && activeSessionPath !== sessionPath) writeJson(sessionPath, next);
      if (targetProject) writeProjectManifest(targetProject, next);
      if (targetProject) {
        targetProject.updatedAt = new Date().toISOString();
        const latestList = readProjectList();
        writeProjectList({ ...latestList, projects: latestList.projects.map((item) => (item.id === targetProject.id ? targetProject : item)) });
      }
      log(`config save session project=${targetProject?.id || "global"} revision=${appliedRevision}${mergedStale ? " merged-stale" : ""}`);
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
  registerRequirementLibraryIpc,
  registerSettingsIpc,
  registerSessionIpc
};
