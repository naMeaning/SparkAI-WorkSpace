import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  normalizeCustomThemePreset as normalizeRendererTheme
} from "../src/settings-persistence.ts";

const require = createRequire(import.meta.url);
const desktopTheme = require("../desktop/theme-preset-service.cjs") as {
  CUSTOM_THEME_COLOR_KEYS: string[];
  THEME_PRESET_MAXIMUM_FILE_BYTES: number;
  createThemePresetService(options: Record<string, unknown>): {
    importPreset(): Promise<Record<string, unknown>>;
    exportPreset(value: unknown): Promise<Record<string, unknown>>;
  };
  normalizeCustomThemePreset(value: unknown): unknown;
  parseThemePresetJson(value: Buffer): unknown;
  serializeThemePreset(value: unknown): string;
};

const colorKeys = desktopTheme.CUSTOM_THEME_COLOR_KEYS;
function colors(seed: number) {
  return Object.fromEntries(colorKeys.map((key, index) => [key, `#${((seed + index * 7919) & 0xffffff).toString(16).padStart(6, "0")}`]));
}

const input = {
  schemaVersion: 1,
  type: "naimage-theme",
  name: "  跨境暖色  ",
  light: colors(0x123456),
  dark: colors(0x101010),
  ignored: "removed"
};
const normalized = normalizeRendererTheme(input)!;
assert.equal(normalized.name, "跨境暖色");
assert.equal(normalized.schemaVersion, 1);
assert.equal((normalized as unknown as Record<string, unknown>).ignored, undefined);
assert.deepEqual(desktopTheme.normalizeCustomThemePreset(input), normalized, "Electron and Renderer theme schema must remain mirrored");

const shorthand = structuredClone(input);
shorthand.light["--theme-accent"] = "#AbC";
assert.equal(normalizeRendererTheme(shorthand)?.light["--theme-accent"], "#aabbcc");
assert.equal(normalizeRendererTheme({ ...input, schemaVersion: 2 }), null);
assert.equal(normalizeRendererTheme({ ...input, type: "css" }), null);
assert.equal(normalizeRendererTheme({ ...input, light: { ...input.light, "--theme-bg": "url(javascript:alert(1))" } }), null);
assert.equal(normalizeRendererTheme({ ...input, dark: { ...input.dark, "--theme-canvas": "" } }), null);

const serialized = desktopTheme.serializeThemePreset(input);
assert.ok(serialized.endsWith("\n"));
assert.deepEqual(JSON.parse(serialized), normalized);
assert.deepEqual(desktopTheme.parseThemePresetJson(Buffer.from(serialized)), normalized);
assert.throws(() => desktopTheme.parseThemePresetJson(Buffer.from("{")), /有效的 JSON/);
assert.throws(() => desktopTheme.parseThemePresetJson(Buffer.alloc(desktopTheme.THEME_PRESET_MAXIMUM_FILE_BYTES + 1)), /64 KiB/);

let exportedPath = "";
let exportedContent = "";
const service = desktopTheme.createThemePresetService({
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: ["C:/themes/shop.json"] }),
    showSaveDialog: async () => ({ canceled: false, filePath: "C:/themes/exported.json" })
  },
  statSync: () => ({ isFile: () => true, size: Buffer.byteLength(serialized) }),
  readFileSync: () => Buffer.from(serialized),
  writeFileSync: (filePath: string, content: string) => {
    exportedPath = filePath;
    exportedContent = content;
  }
});
const imported = await service.importPreset();
assert.equal(imported.ok, true);
assert.equal(imported.sourceName, "shop.json");
assert.deepEqual(imported.theme, normalized);
const exported = await service.exportPreset(normalized);
assert.equal(exported.ok, true);
assert.equal(exported.fileName, "exported.json");
assert.equal(exportedPath, "C:/themes/exported.json");
assert.deepEqual(JSON.parse(exportedContent), normalized);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 24, colorsPerMode: colorKeys.length })}\n`);
