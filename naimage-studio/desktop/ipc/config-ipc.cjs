"use strict";

function registerSettingsIpc({
  ipcMain,
  migrateSettings,
  readJson,
  settingsPath,
  defaultSettings,
  log,
  onNewApiAccountBaseUrlChanged,
  publicSettings,
  validateNewApiServiceSettings,
  writeJson
}) {
  ipcMain.handle("naimage:config:load-settings", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("config load settings");
    return { ok: true, path: settingsPath, settings: publicSettings(settings) };
  });

  ipcMain.handle("naimage:config:save-settings", (_event, settings) => {
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
    log("config save settings");
    return { ok: true, path: settingsPath, accountChanged };
  });
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
  ipcMain.handle("naimage:config:load-session", () => {
    const list = readProjectList();
    const activeProject = getActiveProject(list);
    const activeSessionPath = activeProject?.sessionPath || sessionPath;
    if (activeProject) ensureProjectFiles(activeProject, readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
    const session = activeProject ? projectSessionFromDisk(activeProject) : hydrateSessionAssets(readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
    if (activeProject) {
      writeJson(activeSessionPath, sessionForProjectSave(session, activeProject));
      writeProjectManifest(activeProject, session);
    }
    log("config load session");
    return { ok: true, path: activeSessionPath, project: activeProject, projects: list.projects, activeProjectId: list.activeProjectId, session };
  });

  ipcMain.handle("naimage:config:save-session", async (_event, session) => {
    const list = readProjectList();
    const requestedProjectId = typeof session?.projectId === "string" ? session.projectId.trim() : "";
    const targetProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    if (requestedProjectId && !targetProject) {
      return { ok: false, error: "保存目标项目不存在或已被移除。", appliedRevision: 0, skippedStale: false };
    }
    const activeSessionPath = targetProject?.sessionPath || sessionPath;
    const requestedRevision = session?.revision ?? session?.sessionRevision;
    const saveResult = await projectSessionSaveCoordinator.enqueue(targetProject?.id || "__global__", requestedRevision, async (appliedRevision) => {
      const nextInput = { ...defaultSession, ...session, sessionRevision: appliedRevision };
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
      log(`config save session project=${targetProject?.id || "global"} revision=${appliedRevision}`);
      return { ok: true, path: activeSessionPath, applied: true };
    });
    return { ...saveResult, path: saveResult.path || activeSessionPath };
  });
}

module.exports = {
  registerSettingsIpc,
  registerSessionIpc
};
