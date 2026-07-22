"use strict";

function registerWindowIpc({ ipcMain, createWindow, log, BrowserWindow }) {
  ipcMain.handle("iiimage:window:new", () => {
    createWindow();
    log("window new");
    return { ok: true };
  });

  ipcMain.handle("iiimage:window:control", (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "窗口不可用。" };
    const action = String((payload ?? {}).action || "");
    if (action === "minimize") {
      win.minimize();
      return { ok: true, action, maximized: win.isMaximized() };
    }
    if (action === "toggle-maximize") {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return { ok: true, action, maximized: win.isMaximized() };
    }
    if (action === "close") {
      win.close();
      return { ok: true, action };
    }
    if (action === "state") {
      return { ok: true, action, maximized: win.isMaximized(), minimized: win.isMinimized() };
    }
    return { ok: false, error: `未知窗口操作：${action}` };
  });
}

module.exports = {
  registerWindowIpc
};
