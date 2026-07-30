"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const {
  defaultGlassAppearance,
  glassMaterialParameters,
  glassThemeRegistry,
  nativeWindowBackgroundColor,
  normalizeGlassThemeSettings
} = require("../runtime/glass-theme-settings.cjs");

assert.deepEqual(defaultGlassAppearance, {
  glassTheme: "light-sky",
  glassMaterial: "frosted",
  glassParameters: {
    opacity: 44,
    blur: 28,
    saturation: 128,
    highlight: 70,
    shadow: 18,
    radius: 14,
    accent: "theme",
    noise: true,
    reduceMotion: false
  }
});

for (const theme of glassThemeRegistry.themeOrder) {
  for (const material of glassThemeRegistry.materialOrder) {
    const normalized = normalizeGlassThemeSettings({
      glassTheme: theme,
      glassMaterial: material,
      glassParameters: { accent: "coral", noise: false, reduceMotion: true }
    });
    assert.equal(normalized.glassTheme, theme);
    assert.equal(normalized.glassMaterial, material);
    assert.deepEqual(
      normalized.glassParameters,
      glassMaterialParameters(theme, material, { accent: "coral", noise: false, reduceMotion: true })
    );
    assert.equal(nativeWindowBackgroundColor(normalized), glassThemeRegistry.themes[theme].tokens.canvas);
  }
}

const custom = normalizeGlassThemeSettings({
  glassTheme: "dark-emerald",
  glassMaterial: "custom",
  glassParameters: {
    opacity: -999,
    blur: 999,
    saturation: 145.4,
    highlight: "bad",
    shadow: -1,
    radius: 99,
    accent: "mint",
    noise: false,
    reduceMotion: true
  }
});
assert.deepEqual(custom, {
  glassTheme: "dark-emerald",
  glassMaterial: "custom",
  glassParameters: {
    opacity: 8,
    blur: 48,
    saturation: 145,
    highlight: 34,
    shadow: 0,
    radius: 24,
    accent: "mint",
    noise: false,
    reduceMotion: true
  }
});

const invalid = normalizeGlassThemeSettings({
  glassTheme: "__proto__",
  glassMaterial: "external",
  glassParameters: { accent: "url(https://invalid.example)", noise: "yes", reduceMotion: 1 }
});
assert.deepEqual(invalid, defaultGlassAppearance);
assert.notEqual(invalid, defaultGlassAppearance, "normalization must return an isolated settings object");
assert.notEqual(invalid.glassParameters, defaultGlassAppearance.glassParameters);

const electronSource = readFileSync(path.join(__dirname, "..", "electron-main.cjs"), "utf8");
assert.match(electronSource, /require\("\.\/runtime\/glass-theme-settings\.cjs"\)/);
assert.match(electronSource, /\.\.\.defaultGlassAppearance/);
assert.match(electronSource, /normalizeElectronGlassThemeSettings\(\{/);
assert.match(electronSource, /backgroundColor: nativeWindowBackgroundColor\(startupSettings\)/);
assert.match(electronSource, /const minWindowWidth = aidebugMode \? 540 : 884;/);
assert.doesNotMatch(electronSource, /function normalizeElectronGlassThemeSettings\(/,
  "Electron entrypoint must remain orchestration-only");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 38 })}\n`);
