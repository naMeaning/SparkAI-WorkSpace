import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import {
  GLASS_ACCENT_IDS,
  GLASS_MATERIAL_PRESET_IDS,
  GLASS_THEME_IDS,
  glassAppearanceProjection,
  glassMaterialParameters,
  glassThemeRegistry,
  normalizeGlassThemeSettings,
  withGlassMaterial,
  withGlassParameters,
  withGlassTheme
} from "../src/glass-theme.ts";
import {
  STORAGE_GLASS_THEME_BOOTSTRAP,
  defaultSettings,
  glassThemeBootstrapSnapshot,
  mergeSettings,
  readGlassThemeBootstrapSnapshot,
  settingsWithGlassBootstrap,
  writeGlassThemeBootstrapSnapshot
} from "../src/settings-persistence.ts";
import { applyGlassAppearance } from "../src/settings-runtime.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FakeClassList {
  readonly active = new Set<string>();

  toggle(name: string, force?: boolean) {
    const enabled = force ?? !this.active.has(name);
    if (enabled) this.active.add(name);
    else this.active.delete(name);
    return enabled;
  }

  contains(name: string) {
    return this.active.has(name);
  }
}

class FakeStyle {
  readonly values = new Map<string, string>();
  colorScheme = "";

  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }

  getPropertyValue(name: string) {
    return this.values.get(name) ?? "";
  }
}

const expectedThemes = ["dark-rose", "dark-ember", "dark-emerald", "light-lemon", "light-sky", "light-blush"];
assert.deepEqual([...GLASS_THEME_IDS], expectedThemes);
assert.deepEqual(glassThemeRegistry.themeOrder, expectedThemes);
assert.deepEqual([...GLASS_MATERIAL_PRESET_IDS], ["clear", "frosted", "dense"]);
assert.deepEqual(glassThemeRegistry.materialOrder, ["clear", "frosted", "dense"]);
assert.deepEqual([...GLASS_ACCENT_IDS], ["theme", "rose", "mint", "coral", "amber", "ice"]);
assert.deepEqual(glassThemeRegistry.accentOrder, [...GLASS_ACCENT_IDS]);
assert.deepEqual(
  Object.fromEntries(expectedThemes.map((id) => [id, glassThemeRegistry.themes[id as keyof typeof glassThemeRegistry.themes].name])),
  {
    "dark-rose": "绯樱夜光",
    "dark-ember": "蜜橙熔光",
    "dark-emerald": "翡翠黑曜",
    "light-lemon": "柠檬晶糖",
    "light-sky": "天青冰璃",
    "light-blush": "蜜桃珍珠"
  }
);

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left: string, right: string) {
  const luminances = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function scopedCssVariable(source: string, selector: string, variable: string) {
  const blockStart = source.indexOf(`${selector} {`);
  assert(blockStart >= 0, `Missing CSS selector: ${selector}`);
  const blockEnd = source.indexOf("}", blockStart);
  assert(blockEnd > blockStart, `Unterminated CSS selector: ${selector}`);
  const block = source.slice(blockStart, blockEnd);
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escapedVariable}\\s*:\\s*([^;]+);`, "u"));
  assert(match, `Missing ${variable} in ${selector}`);
  return match[1].trim();
}

const liquidGlassCss = readFileSync(new URL("../src/styles/01-liquid-glass-tokens.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const agentWindowCss = readFileSync(new URL("../agent-window.css", import.meta.url), "utf8");

for (const themeId of ["light-lemon", "light-sky", "light-blush"] as const) {
  const tokens = glassThemeRegistry.themes[themeId].tokens;
  assert(
    contrastRatio(tokens.muted, tokens.surfaceSolid) >= 4.5,
    `${themeId} muted text must retain 4.5:1 contrast on its solid surface`
  );
  assert.equal(
    scopedCssVariable(liquidGlassCss, `:root[data-glass-theme="${themeId}"]`, "--glass-muted"),
    tokens.muted,
    `${themeId} first-frame CSS muted token must match the registry`
  );
}
assert.equal(scopedCssVariable(liquidGlassCss, ":root", "--glass-muted"), glassThemeRegistry.themes["light-sky"].tokens.muted);
assert.equal(scopedCssVariable(indexHtml, ":root", "--theme-muted"), glassThemeRegistry.themes["light-sky"].tokens.muted);
assert.equal(scopedCssVariable(agentWindowCss, ":root", "--muted"), glassThemeRegistry.themes["light-sky"].tokens.muted);

const defaults = normalizeGlassThemeSettings();
assert.deepEqual(defaults, {
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
assert.deepEqual(defaultSettings.glassParameters, defaults.glassParameters);

const darkFrosted = withGlassTheme(defaults, "dark-rose");
assert.equal(darkFrosted.glassMaterial, "frosted");
assert.deepEqual(darkFrosted.glassParameters, {
  opacity: 22,
  blur: 26,
  saturation: 138,
  highlight: 34,
  shadow: 40,
  radius: 14,
  accent: "theme",
  noise: true,
  reduceMotion: false
});
assert.deepEqual(
  withGlassMaterial(darkFrosted, "clear").glassParameters,
  glassMaterialParameters("dark-rose", "clear")
);
assert.equal(withGlassTheme(withGlassMaterial(defaults, "dense"), "dark-emerald").glassParameters.opacity, 62);

const customized = withGlassParameters(defaults, { blur: 47, radius: 22 });
assert.equal(customized.glassMaterial, "custom");
assert.equal(customized.glassParameters.blur, 47);
assert.equal(customized.glassParameters.radius, 22);
assert.equal(withGlassTheme(customized, "dark-ember").glassParameters.blur, 47, "custom material survives a theme switch");
assert.equal(withGlassParameters(defaults, { accent: "coral" }).glassMaterial, "frosted", "accent does not change material");
assert.equal(withGlassParameters(defaults, { noise: false }).glassMaterial, "frosted", "noise does not change material");

const clamped = normalizeGlassThemeSettings({
  glassTheme: "invalid",
  glassMaterial: "custom",
  glassParameters: {
    opacity: -99,
    blur: 999,
    saturation: "bad",
    highlight: 999,
    shadow: -5,
    radius: 999,
    accent: "invalid",
    noise: "yes",
    reduceMotion: 1
  }
});
assert.equal(clamped.glassTheme, "light-sky");
assert.deepEqual(clamped.glassParameters, {
  opacity: 8,
  blur: 48,
  saturation: 128,
  highlight: 70,
  shadow: 0,
  radius: 24,
  accent: "theme",
  noise: true,
  reduceMotion: false
});

const legacyDark = mergeSettings({ theme: "dark", themePalette: "anthropic" });
assert.equal(legacyDark.theme, "dark", "legacy field remains readable");
assert.equal(legacyDark.themePalette, "anthropic", "legacy palette remains readable");
assert.equal(legacyDark.glassTheme, "dark-rose", "legacy dark settings migrate conservatively");
assert.equal(mergeSettings({ glassTheme: "light-blush", glassMaterial: "clear" }).glassParameters.opacity, 24);

const safeSnapshot = glassThemeBootstrapSnapshot({
  ...defaultSettings,
  glassTheme: "dark-emerald",
  glassMaterial: "dense",
  agentApiKey: "must-not-leak",
  serverToken: "must-not-leak"
});
assert.deepEqual(Object.keys(safeSnapshot).sort(), [
  "glassMaterial",
  "glassParameters",
  "glassTheme",
  "mode",
  "schemaVersion",
  "type",
  "variables"
]);
assert.equal(safeSnapshot.mode, "dark");
assert.equal(safeSnapshot.variables["--theme-canvas"], "#07100d");
assert.equal(safeSnapshot.variables["--glass-accent-coral"], "#ff8b78");
assert.equal(safeSnapshot.variables["--glass-swatch-light-sky-canvas"], "#e8f2f6");
assert.equal(JSON.stringify(safeSnapshot).includes("must-not-leak"), false);

const storage = new MemoryStorage();
assert.equal(writeGlassThemeBootstrapSnapshot(safeSnapshot, storage), true);
const persistedRaw = storage.getItem(STORAGE_GLASS_THEME_BOOTSTRAP) ?? "";
assert.equal(persistedRaw.includes("must-not-leak"), false);
assert.deepEqual(readGlassThemeBootstrapSnapshot(storage), safeSnapshot);
const firstReactSettings = settingsWithGlassBootstrap({
  ...defaultSettings,
  agentApiKey: "preserve-main-setting",
  glassTheme: "light-sky",
  glassMaterial: "frosted"
}, storage);
assert.equal(firstReactSettings.glassTheme, "dark-emerald", "the first React frame must match the pre-React bootstrap theme");
assert.equal(firstReactSettings.glassMaterial, "dense", "the first React frame must match the pre-React bootstrap material");
assert.deepEqual(firstReactSettings.glassParameters, safeSnapshot.glassParameters);
assert.equal(firstReactSettings.agentApiKey, "preserve-main-setting", "the bootstrap must not replace non-appearance settings");
storage.setItem(STORAGE_GLASS_THEME_BOOTSTRAP, JSON.stringify({
  schemaVersion: 1,
  type: "naimage-glass-theme-bootstrap",
  glassTheme: "light-blush",
  glassMaterial: "clear",
  glassParameters: { ...defaults.glassParameters }
}));
const upgradedSnapshot = readGlassThemeBootstrapSnapshot(storage);
assert.equal(upgradedSnapshot.mode, "light");
assert.equal(upgradedSnapshot.variables["--theme-canvas"], "#f8ebee", "old snapshots rebuild variables");
storage.setItem(STORAGE_GLASS_THEME_BOOTSTRAP, "{broken");
assert.deepEqual(readGlassThemeBootstrapSnapshot(storage), glassThemeBootstrapSnapshot(defaultSettings));

const fakeRoot = {
  dataset: {} as DOMStringMap,
  classList: new FakeClassList(),
  style: new FakeStyle()
} as unknown as HTMLElement;
const applied = applyGlassAppearance({
  ...defaults,
  glassTheme: "dark-ember",
  glassMaterial: "custom",
  glassParameters: {
    ...defaults.glassParameters,
    opacity: 31,
    blur: 17,
    saturation: 145,
    highlight: 29,
    shadow: 36,
    radius: 19,
    accent: "mint",
    noise: false,
    reduceMotion: true
  }
}, fakeRoot);
assert.equal(applied.glassTheme, "dark-ember");
assert.equal(fakeRoot.dataset.glassTheme, "dark-ember");
assert.equal(fakeRoot.dataset.glassMaterial, "custom");
assert.equal(fakeRoot.dataset.theme, "dark");
assert.equal(fakeRoot.dataset.glassAccent, "mint");
assert.equal(fakeRoot.classList.contains("theme-dark"), true);
assert.equal(fakeRoot.classList.contains("theme-light"), false);
assert.equal(fakeRoot.classList.contains("glass-no-noise"), true);
assert.equal(fakeRoot.classList.contains("glass-reduce-motion"), true);
assert.equal(fakeRoot.style.getPropertyValue("--glass-alpha"), "0.31");
assert.equal(fakeRoot.style.getPropertyValue("--glass-blur"), "17px");
assert.equal(fakeRoot.style.getPropertyValue("--glass-saturation"), "145%");
assert.equal(fakeRoot.style.getPropertyValue("--glass-radius"), "19px");
assert.equal(fakeRoot.style.getPropertyValue("--noise-opacity"), "0");
assert.equal(fakeRoot.style.getPropertyValue("--theme-accent"), "#73e3af");
assert.equal(fakeRoot.style.getPropertyValue("--theme-canvas"), "#110c08");
assert.equal(fakeRoot.style.colorScheme, "dark");

type BootstrapWindow = {
  __naimageGlassBootState?: Record<string, unknown>;
};

const glassBootstrapSource = readFileSync(new URL("../public/glass-theme-bootstrap.js", import.meta.url), "utf8");

function runBootstrap(storage: MemoryStorage) {
  const classList = new FakeClassList();
  const style = new FakeStyle();
  const root = { dataset: {}, classList, style } as unknown as HTMLElement;
  const bootWindow: BootstrapWindow = {};
  runInNewContext(glassBootstrapSource, {
    document: { documentElement: root },
    localStorage: storage,
    window: bootWindow
  });
  return { root, classList, style, bootWindow };
}

const bootstrapStorage = new MemoryStorage();
bootstrapStorage.setItem(STORAGE_GLASS_THEME_BOOTSTRAP, JSON.stringify(safeSnapshot));
const bootstrapped = runBootstrap(bootstrapStorage);
assert.equal(bootstrapped.root.dataset.glassTheme, "dark-emerald");
assert.equal(bootstrapped.root.dataset.glassMode, "dark");
assert.equal(bootstrapped.root.dataset.glassMaterial, "dense");
assert.equal(bootstrapped.root.dataset.glassAccentResolved, "mint");
assert.equal(bootstrapped.root.dataset.glassNoise, "on");
assert.equal(bootstrapped.style.getPropertyValue("--theme-canvas"), "#07100d");
assert.equal(bootstrapped.style.getPropertyValue("--glass-accent-coral"), "#ff8b78");
assert.equal(bootstrapped.style.colorScheme, "dark");
assert.equal(bootstrapped.classList.contains("glass-theme-active"), true);
assert.equal(bootstrapped.bootWindow.__naimageGlassBootState?.schema, "v1");
assert.deepEqual(JSON.parse(JSON.stringify(bootstrapped.bootWindow.__naimageGlassBootState?.appearanceTrace)), [{
  source: "bootstrap",
  glassTheme: safeSnapshot.glassTheme,
  mode: safeSnapshot.mode,
  glassMaterial: safeSnapshot.glassMaterial,
  accent: safeSnapshot.glassParameters.accent,
  opacity: safeSnapshot.glassParameters.opacity,
  blur: safeSnapshot.glassParameters.blur,
  saturation: safeSnapshot.glassParameters.saturation,
  highlight: safeSnapshot.glassParameters.highlight,
  shadow: safeSnapshot.glassParameters.shadow,
  radius: safeSnapshot.glassParameters.radius,
  noise: safeSnapshot.glassParameters.noise,
  reduceMotion: safeSnapshot.glassParameters.reduceMotion
}]);

for (const glassTheme of GLASS_THEME_IDS) {
  for (const glassMaterial of GLASS_MATERIAL_PRESET_IDS) {
    const settings = normalizeGlassThemeSettings({ glassTheme, glassMaterial });
    const expected = glassAppearanceProjection(settings);
    const matrixStorage = new MemoryStorage();
    matrixStorage.setItem(STORAGE_GLASS_THEME_BOOTSTRAP, JSON.stringify({
      schemaVersion: 1,
      type: "naimage-glass-theme-bootstrap",
      ...settings,
      // Persisted projection data is deliberately ignored by the bootstrap.
      variables: { "--theme-canvas": "#000000" }
    }));
    const matrixBoot = runBootstrap(matrixStorage);
    assert.equal(matrixBoot.root.dataset.glassTheme, glassTheme);
    assert.equal(matrixBoot.root.dataset.glassMaterial, glassMaterial);
    assert.deepEqual(Object.fromEntries(matrixBoot.style.values), expected.variables);
  }
}

for (const accent of GLASS_ACCENT_IDS) {
  const settings = normalizeGlassThemeSettings({
    glassTheme: "light-blush",
    glassMaterial: "custom",
    glassParameters: {
      opacity: 37,
      blur: 23,
      saturation: 151,
      highlight: 41,
      shadow: 27,
      radius: 21,
      accent,
      noise: false,
      reduceMotion: true
    }
  });
  const expected = glassAppearanceProjection(settings);
  const accentStorage = new MemoryStorage();
  accentStorage.setItem(STORAGE_GLASS_THEME_BOOTSTRAP, JSON.stringify({
    schemaVersion: 1,
    type: "naimage-glass-theme-bootstrap",
    ...settings,
    variables: {
      "--theme-accent": "url(https://invalid.example/leak)",
      "--theme-accent-strong": "#000000"
    }
  }));
  const accentBoot = runBootstrap(accentStorage);
  assert.equal(accentBoot.root.dataset.glassAccent, accent);
  assert.equal(accentBoot.style.getPropertyValue("--theme-accent"), expected.variables["--theme-accent"]);
  assert.equal(accentBoot.style.getPropertyValue("--theme-accent-strong"), expected.variables["--theme-accent-strong"]);
  assert.deepEqual(Object.fromEntries(accentBoot.style.values), expected.variables);
}

const poisonedStorage = new MemoryStorage();
poisonedStorage.setItem(STORAGE_GLASS_THEME_BOOTSTRAP, JSON.stringify({
  ...safeSnapshot,
  variables: {
    ...safeSnapshot.variables,
    "--theme-canvas": "url(https://invalid.example/leak)",
    "--unregistered-token": "#ff0000"
  }
}));
const poisonedBootstrap = runBootstrap(poisonedStorage);
assert.equal(poisonedBootstrap.style.getPropertyValue("--theme-canvas"), "#07100d", "startup variables are rebuilt from glass fields");
assert.equal(poisonedBootstrap.style.getPropertyValue("--unregistered-token"), "");

const legacyBootstrapStorage = new MemoryStorage();
legacyBootstrapStorage.setItem("naimage.glassAppearance.v1", JSON.stringify({
  theme: "light-blush",
  material: "clear",
  accent: "rose",
  noise: false,
  reduceMotion: true,
  variables: { "--theme-canvas": "#f8ebee" }
}));
const legacyBootstrap = runBootstrap(legacyBootstrapStorage);
assert.equal(legacyBootstrap.root.dataset.glassTheme, "light-blush");
assert.equal(legacyBootstrap.root.dataset.glassMaterial, "clear");
assert.equal(legacyBootstrap.root.dataset.glassNoise, "off");
assert.equal(legacyBootstrap.classList.contains("glass-reduce-motion"), true);
assert.equal(legacyBootstrap.bootWindow.__naimageGlassBootState?.schema, "legacy");

const require = createRequire(import.meta.url);
const electronGlassRuntime = require("../runtime/glass-theme-settings.cjs") as {
  defaultGlassAppearance: typeof defaults;
  nativeWindowBackgroundColor(settings: unknown): string;
  normalizeGlassThemeSettings(settings: unknown): typeof defaults;
};
const electronCustom = electronGlassRuntime.normalizeGlassThemeSettings({
  glassTheme: "dark-emerald",
  glassMaterial: "custom",
  glassParameters: {
    opacity: -20,
    blur: 999,
    saturation: 145,
    highlight: 29,
    shadow: 36,
    radius: 19,
    accent: "coral",
    noise: false,
    reduceMotion: true
  }
});
assert.deepEqual(electronGlassRuntime.defaultGlassAppearance, defaults);
assert.equal(electronGlassRuntime.nativeWindowBackgroundColor({ glassTheme: "dark-ember" }), "#110c08");
assert.equal(electronCustom.glassParameters.opacity, 8);
assert.equal(electronCustom.glassParameters.blur, 48);
assert.equal(electronCustom.glassParameters.accent, "coral");
assert.equal(electronCustom.glassParameters.noise, false);
const electronSource = readFileSync(new URL("../electron-main.cjs", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../src/glass-theme-provider.tsx", import.meta.url), "utf8");
const agentWindowRendererSource = readFileSync(new URL("../agent-window-renderer.js", import.meta.url), "utf8");
const agentWindowHtmlSource = readFileSync(new URL("../agent-window.html", import.meta.url), "utf8");
assert.match(electronSource, /require\("\.\/runtime\/glass-theme-settings\.cjs"\)/);
assert.match(electronSource, /backgroundColor: nativeWindowBackgroundColor\(startupSettings\)/);
assert.match(electronSource, /glassTheme: source\.glassTheme \?\? \(source\.theme === "dark" \? "dark-rose"/);
assert.match(mainSource, /window\.naimageConfig\s*\?\s*settingsWithGlassBootstrap\(defaultSettings\)/, "Electron must seed the first React appearance from the same safe bootstrap snapshot");
assert.match(providerSource, /appendReactAppearanceTrace\(appearance, target\)/, "React layout effects must extend the bounded startup appearance trace");
assert.match(agentWindowRendererSource, /"--muted":\s*"--theme-muted"/, "Agent runtime muted text must follow the shared theme token");
assert.match(agentWindowHtmlSource, /<link\s+rel="stylesheet"\s+href="\.\/agent-window\.css"\s*\/?>/, "Agent HTML must load the locked default appearance fallback");

console.log("glass theme self-test passed");
