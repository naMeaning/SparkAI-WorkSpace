"use strict";

const path = require("node:path");

const THEME_PRESET_SCHEMA_VERSION = 1;
const THEME_PRESET_MAXIMUM_FILE_BYTES = 64 * 1024;
const CUSTOM_THEME_COLOR_KEYS = Object.freeze([
  "--theme-bg",
  "--theme-canvas",
  "--theme-surface",
  "--theme-surface-raised",
  "--theme-ink",
  "--theme-muted",
  "--theme-line",
  "--theme-accent",
  "--theme-rose",
  "--theme-green"
]);

function themePresetFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedHexColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`;
  return "";
}

function normalizeCustomThemeMode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value;
  const mode = {};
  for (const key of CUSTOM_THEME_COLOR_KEYS) {
    const color = normalizedHexColor(source[key]);
    if (!color) return null;
    mode[key] = color;
  }
  return mode;
}

function normalizeCustomThemePreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.schemaVersion) !== THEME_PRESET_SCHEMA_VERSION || value.type !== "naimage-theme") return null;
  const light = normalizeCustomThemeMode(value.light);
  const dark = normalizeCustomThemeMode(value.dark);
  if (!light || !dark) return null;
  const name = String(value.name || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 48) || "自定义主题";
  return { schemaVersion: THEME_PRESET_SCHEMA_VERSION, type: "naimage-theme", name, light, dark };
}

function parseThemePresetJson(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!bytes.length) throw themePresetFailure("NAIMAGE_THEME_EMPTY", "主题配置文件为空。");
  if (bytes.length > THEME_PRESET_MAXIMUM_FILE_BYTES) throw themePresetFailure("NAIMAGE_THEME_TOO_LARGE", "主题配置文件超过 64 KiB 上限。");
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw themePresetFailure("NAIMAGE_THEME_JSON_INVALID", "主题配置不是有效的 JSON。");
  }
  const theme = normalizeCustomThemePreset(parsed);
  if (!theme) throw themePresetFailure("NAIMAGE_THEME_SCHEMA_INVALID", "主题配置字段不完整；只接受 naimage-theme v1 和十六进制颜色。");
  return theme;
}

function serializeThemePreset(value) {
  const theme = normalizeCustomThemePreset(value);
  if (!theme) throw themePresetFailure("NAIMAGE_THEME_SCHEMA_INVALID", "当前自定义主题字段不完整，无法导出。");
  return `${JSON.stringify(theme, null, 2)}\n`;
}

function safeThemeFileName(value) {
  const name = String(value || "自定义主题").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
  return `${name || "自定义主题"}.naimage-theme.json`;
}

function createThemePresetService({ dialog, readFileSync, statSync, writeFileSync }) {
  return {
    async importPreset() {
      const selected = await dialog.showOpenDialog({
        title: "导入 naimage 自定义主题",
        properties: ["openFile"],
        filters: [{ name: "naimage Theme", extensions: ["json"] }]
      });
      if (selected.canceled || !selected.filePaths.length) return { ok: true, canceled: true };
      try {
        const sourceFile = selected.filePaths[0];
        const stats = statSync(sourceFile);
        if (!stats.isFile()) throw themePresetFailure("NAIMAGE_THEME_FILE_INVALID", "选择的主题配置不是文件。");
        if (stats.size > THEME_PRESET_MAXIMUM_FILE_BYTES) throw themePresetFailure("NAIMAGE_THEME_TOO_LARGE", "主题配置文件超过 64 KiB 上限。");
        return { ok: true, theme: parseThemePresetJson(readFileSync(sourceFile)), sourceName: path.basename(sourceFile) };
      } catch (error) {
        return {
          ok: false,
          errorCode: String(error?.code || "NAIMAGE_THEME_IMPORT_FAILED"),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async exportPreset(value) {
      try {
        const theme = normalizeCustomThemePreset(value);
        if (!theme) throw themePresetFailure("NAIMAGE_THEME_SCHEMA_INVALID", "当前自定义主题字段不完整，无法导出。");
        const selected = await dialog.showSaveDialog({
          title: "导出 naimage 自定义主题",
          defaultPath: safeThemeFileName(theme.name),
          filters: [{ name: "naimage Theme", extensions: ["json"] }]
        });
        if (selected.canceled || !selected.filePath) return { ok: true, canceled: true };
        writeFileSync(selected.filePath, serializeThemePreset(theme), "utf8");
        return { ok: true, fileName: path.basename(selected.filePath) };
      } catch (error) {
        return {
          ok: false,
          errorCode: String(error?.code || "NAIMAGE_THEME_EXPORT_FAILED"),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

module.exports = {
  CUSTOM_THEME_COLOR_KEYS,
  THEME_PRESET_MAXIMUM_FILE_BYTES,
  THEME_PRESET_SCHEMA_VERSION,
  createThemePresetService,
  normalizeCustomThemePreset,
  parseThemePresetJson,
  serializeThemePreset
};
