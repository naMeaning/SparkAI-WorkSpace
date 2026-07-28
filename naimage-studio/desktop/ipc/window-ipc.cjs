"use strict";

function registerWindowIpc({ ipcMain, createWindow, log = () => {}, BrowserWindow, agentWindowService }) {
  ipcMain.handle("naimage:window:new", () => {
    createWindow();
    log("window new");
    return { ok: true };
  });

  ipcMain.handle("naimage:window:control", (event, payload) => {
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

  ipcMain.handle("naimage:agent-window:open", (event) => {
    if (!agentWindowService) return { ok: false, error: "Agent 独立窗口服务不可用。" };
    return agentWindowService.open(event.sender);
  });

  ipcMain.handle("naimage:agent-window:close", (event) => {
    if (!agentWindowService) return { ok: false, error: "Agent 独立窗口服务不可用。" };
    return agentWindowService.close(event.sender);
  });

  ipcMain.handle("naimage:agent-window:status", (event) => {
    if (!agentWindowService) return { ok: false, open: false, error: "Agent 独立窗口服务不可用。" };
    return agentWindowService.status(event.sender);
  });

  ipcMain.on("naimage:agent-window:publish-state", (event, payload) => {
    agentWindowService?.publishState(event.sender, payload);
  });

  ipcMain.on("naimage:agent-window:command", (event, payload) => {
    agentWindowService?.forwardCommand(event.sender, payload);
  });

  ipcMain.on("naimage:agent-window:ready", (event) => {
    agentWindowService?.surfaceReady(event.sender);
  });
}

module.exports = {
  registerWindowIpc
};
