"use strict";

function registerUpdateIpc({ ipcMain, desktopUpdater, log = () => {} }) {
  function operationFailure(operation, error, publishProgress = false) {
    const message = error instanceof Error ? error.message : String(error);
    log(`desktop ${operation} failed ${message}`);
    if (publishProgress) desktopUpdater.publishDesktopUpdateProgress({ stage: "error", message });
    return desktopUpdater.desktopUpdaterFailure(error);
  }

  ipcMain.handle("iiimage:update:status", () => desktopUpdater.desktopUpdaterStatus());

  ipcMain.handle("iiimage:update:renderer-ready", () => ({
    ok: true,
    acknowledged: desktopUpdater.markRestartUpdateHealthy()
  }));

  ipcMain.handle("iiimage:update:check", async () => {
    try {
      return await desktopUpdater.checkDesktopUpdate();
    } catch (error) {
      return operationFailure("update check", error, true);
    }
  });

  ipcMain.handle("iiimage:update:installer-captcha", async () => {
    try {
      return await desktopUpdater.createDesktopInstallerCaptcha();
    } catch (error) {
      return operationFailure("update captcha", error);
    }
  });

  ipcMain.handle("iiimage:update:download-restart", async () => {
    try {
      return await desktopUpdater.downloadDesktopRestartUpdate();
    } catch (error) {
      return operationFailure("restart update download", error, true);
    }
  });

  ipcMain.handle("iiimage:update:download-installer", async (_event, payload) => {
    try {
      return await desktopUpdater.downloadDesktopInstallerUpdate(payload);
    } catch (error) {
      return operationFailure("installer update download", error, true);
    }
  });

  ipcMain.handle("iiimage:update:apply-restart", async () => {
    try {
      return await desktopUpdater.applyDesktopRestartUpdate();
    } catch (error) {
      return operationFailure("restart update apply", error, true);
    }
  });

  ipcMain.handle("iiimage:update:launch-installer", async () => {
    try {
      return await desktopUpdater.launchDesktopInstallerUpdate();
    } catch (error) {
      return operationFailure("installer launch", error, true);
    }
  });
}

module.exports = { registerUpdateIpc };
