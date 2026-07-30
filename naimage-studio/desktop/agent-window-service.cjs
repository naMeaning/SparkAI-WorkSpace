"use strict";

const stateChannel = "naimage:agent-window:state";
const commandChannel = "naimage:agent-window:command";
const maximumStateBytes = 16 * 1024 * 1024;
const maximumCommandBytes = 512 * 1024;

function serializablePayload(payload, maximumBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(payload ?? null);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) return null;
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function createAgentWindowService({
  BrowserWindow,
  htmlPath,
  preloadPath,
  applicationName = "naimage",
  icon,
  getBackgroundColor = () => "#f6eadf",
  log = () => {}
}) {
  let agentWindow = null;
  let ownerWebContents = null;
  let latestState = null;
  let ownerDestroyedListener = null;

  function windowAvailable() {
    return Boolean(agentWindow && !agentWindow.isDestroyed());
  }

  function ownerAvailable() {
    return Boolean(ownerWebContents && !ownerWebContents.isDestroyed?.());
  }

  function sendOwnerCommand(payload) {
    if (!ownerAvailable()) return false;
    ownerWebContents.send(commandChannel, payload);
    return true;
  }

  function detachOwner() {
    if (ownerWebContents && ownerDestroyedListener && typeof ownerWebContents.removeListener === "function") {
      ownerWebContents.removeListener("destroyed", ownerDestroyedListener);
    }
    ownerWebContents = null;
    ownerDestroyedListener = null;
  }

  function attachOwner(nextOwner) {
    if (!nextOwner || nextOwner.isDestroyed?.()) return false;
    if (ownerWebContents === nextOwner) return true;
    detachOwner();
    ownerWebContents = nextOwner;
    ownerDestroyedListener = () => {
      detachOwner();
      if (windowAvailable()) agentWindow.close();
    };
    if (typeof ownerWebContents.once === "function") ownerWebContents.once("destroyed", ownerDestroyedListener);
    return true;
  }

  function publishState(sender, payload) {
    if (sender !== ownerWebContents || !ownerAvailable()) return { ok: false, error: "Agent 主窗口不匹配。" };
    const normalized = serializablePayload(payload, maximumStateBytes);
    if (!normalized) return { ok: false, error: "Agent 浮窗状态过大或无法序列化。" };
    latestState = normalized;
    if (windowAvailable() && !agentWindow.webContents.isDestroyed?.()) {
      agentWindow.webContents.send(stateChannel, latestState);
    }
    return { ok: true, open: windowAvailable() };
  }

  function focusOwner() {
    if (!ownerAvailable() || typeof BrowserWindow.fromWebContents !== "function") return false;
    const ownerWindow = BrowserWindow.fromWebContents(ownerWebContents);
    if (!ownerWindow || ownerWindow.isDestroyed?.()) return false;
    if (ownerWindow.isMinimized?.()) ownerWindow.restore?.();
    ownerWindow.show?.();
    ownerWindow.focus?.();
    return true;
  }

  function forwardCommand(sender, payload) {
    if (!windowAvailable() || sender !== agentWindow.webContents) return { ok: false, error: "Agent 浮窗来源无效。" };
    const normalized = serializablePayload(payload, maximumCommandBytes);
    if (!normalized || typeof normalized !== "object") return { ok: false, error: "Agent 浮窗命令无效。" };
    if (["edit-sources", "edit-references", "edit-memory"].includes(String(normalized.type || ""))) focusOwner();
    return sendOwnerCommand(normalized)
      ? { ok: true }
      : { ok: false, error: "Agent 主窗口不可用。" };
  }

  function surfaceReady(sender) {
    if (!windowAvailable() || sender !== agentWindow.webContents) return { ok: false };
    if (latestState) agentWindow.webContents.send(stateChannel, latestState);
    sendOwnerCommand({ type: "request-state" });
    return { ok: true };
  }

  function open(nextOwner) {
    if (!attachOwner(nextOwner)) return { ok: false, error: "Agent 主窗口不可用。" };
    if (windowAvailable()) {
      if (agentWindow.isMinimized?.()) agentWindow.restore?.();
      agentWindow.show?.();
      agentWindow.focus?.();
      sendOwnerCommand({ type: "request-state" });
      return { ok: true, open: true, reused: true, windowId: agentWindow.id };
    }

    latestState = null;
    let backgroundColor = "#f6eadf";
    try {
      const resolvedBackgroundColor = String(getBackgroundColor() || "").trim();
      if (resolvedBackgroundColor) backgroundColor = resolvedBackgroundColor;
    } catch (error) {
      log(`agent window background resolution failed ${error instanceof Error ? error.message : String(error)}`);
    }
    agentWindow = new BrowserWindow({
      width: 480,
      height: 760,
      minWidth: 360,
      minHeight: 480,
      show: false,
      title: `${applicationName} Agent`,
      backgroundColor,
      autoHideMenuBar: true,
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    const createdWindow = agentWindow;
    createdWindow.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
    createdWindow.webContents.on?.("will-navigate", (event) => event.preventDefault());
    createdWindow.webContents.on?.("render-process-gone", (_event, details) => {
      log(`agent window renderer gone ${JSON.stringify(details || {})}`);
    });
    createdWindow.once?.("ready-to-show", () => {
      if (!createdWindow.isDestroyed()) createdWindow.show();
    });
    createdWindow.on?.("closed", () => {
      if (agentWindow !== createdWindow) return;
      agentWindow = null;
      latestState = null;
      sendOwnerCommand({ type: "closed" });
      detachOwner();
    });
    Promise.resolve(createdWindow.loadFile(htmlPath)).catch((error) => {
      log(`agent window load failed ${error instanceof Error ? error.message : String(error)}`);
      if (!createdWindow.isDestroyed()) createdWindow.close();
    });
    return { ok: true, open: true, reused: false, windowId: createdWindow.id };
  }

  function close(sender) {
    if (sender && sender !== ownerWebContents && (!windowAvailable() || sender !== agentWindow.webContents)) {
      return { ok: false, error: "Agent 浮窗关闭来源无效。" };
    }
    if (windowAvailable()) agentWindow.close();
    return { ok: true, open: false };
  }

  function status(sender) {
    return {
      ok: true,
      open: windowAvailable(),
      owner: Boolean(sender && sender === ownerWebContents),
      windowId: windowAvailable() ? agentWindow.id : undefined
    };
  }

  return {
    open,
    close,
    status,
    publishState,
    forwardCommand,
    surfaceReady,
    focusOwner,
    channels: { state: stateChannel, command: commandChannel }
  };
}

module.exports = {
  commandChannel,
  createAgentWindowService,
  maximumCommandBytes,
  maximumStateBytes,
  serializablePayload,
  stateChannel
};
