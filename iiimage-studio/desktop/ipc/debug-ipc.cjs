"use strict";

const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

function registerDebugIpc({
  ipcMain,
  aidebugMode,
  BrowserWindow,
  screen,
  desktopCapturer,
  debugDir,
  sanitizeFileStem,
  log
}) {
  ipcMain.handle("iiimage:debug:window-bounds", (event, payload = {}) => {
    if (!aidebugMode) return { ok: false, error: "仅 AIDebug 模式允许控制测试窗口。" };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "GUI 窗口不可用。" };
    const width = Math.round(Number(payload?.width || 0));
    const height = Math.round(Number(payload?.height || 0));
    if (width > 0 && height > 0) {
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      const beforeBounds = win.getBounds();
      const beforeContentBounds = win.getContentBounds();
      const frameWidth = Math.max(0, beforeBounds.width - beforeContentBounds.width);
      const frameHeight = Math.max(0, beforeBounds.height - beforeContentBounds.height);
      const display = screen.getDisplayMatching(beforeBounds);
      const workArea = display?.workArea ?? { x: 0, y: 0, width, height };
      const targetWidth = Math.max(1, Math.min(width, Math.max(1, workArea.width - frameWidth)));
      const targetHeight = Math.max(1, Math.min(height, Math.max(1, workArea.height - frameHeight)));
      win.setContentSize(targetWidth, targetHeight, false);
      const resizedBounds = win.getBounds();
      const nextX = Math.min(
        Math.max(resizedBounds.x, workArea.x),
        Math.max(workArea.x, workArea.x + workArea.width - resizedBounds.width)
      );
      const nextY = Math.min(
        Math.max(resizedBounds.y, workArea.y),
        Math.max(workArea.y, workArea.y + workArea.height - resizedBounds.height)
      );
      if (nextX !== resizedBounds.x || nextY !== resizedBounds.y) win.setPosition(nextX, nextY, false);
    }
    return {
      ok: true,
      bounds: win.getBounds(),
      contentBounds: win.getContentBounds(),
      maximized: win.isMaximized(),
      minimized: win.isMinimized()
    };
  });

  ipcMain.handle("iiimage:debug:capture-gui", async (event, payload = {}) => {
    if (!aidebugMode) return { ok: false, error: "仅 AIDebug 模式允许捕获测试窗口。" };
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) throw new Error("GUI 窗口不可用。");
      mkdirSync(debugDir, { recursive: true });
      const label = sanitizeFileStem(payload?.label || "gui", "gui");
      let image = null;
      let sourceKind = "page";
      if (payload?.scope !== "page") {
        try {
          const bounds = win.getBounds();
          const display = screen.getDisplayMatching(bounds);
          const scaleFactor = Number(display?.scaleFactor || 1);
          const thumbnailSize = {
            width: Math.max(1, Math.round(bounds.width * scaleFactor)),
            height: Math.max(1, Math.round(bounds.height * scaleFactor))
          };
          const mediaSourceId = typeof win.getMediaSourceId === "function" ? win.getMediaSourceId() : "";
          const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize, fetchWindowIcons: false });
          const title = win.getTitle();
          const windowSource =
            sources.find((source) => source.id === mediaSourceId) ??
            sources.find((source) => source.name === title) ??
            sources.find((source) => source.name.includes(title) || title.includes(source.name));
          if (windowSource && !windowSource.thumbnail.isEmpty()) {
            image = windowSource.thumbnail;
            sourceKind = "window";
          }
        } catch (error) {
          log(`debug capture window fallback: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!image) image = await win.capturePage();
      const size = image.getSize();
      const filePath = path.join(debugDir, `${label}-${Date.now()}.png`);
      writeFileSync(filePath, image.toPNG());
      log(`debug capture gui ${sourceKind} ${filePath}`);
      return { ok: true, path: filePath, width: size.width, height: size.height, source: sourceKind };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = {
  registerDebugIpc
};
