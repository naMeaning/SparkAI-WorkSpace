import {
  uniqueImageModels,
  type AppSettings,
  type ServerPublicSettings,
  type ThemeChoice,
  type ThemePaletteChoice,
} from "./core.ts";
import {
  applyGlassAppearanceToRoot,
  type GlassThemeSettings
} from "./glass-theme.ts";
import { readGlassThemeBootstrapSnapshot } from "./settings-persistence.ts";

export async function fetchServerModelSettings(forceRefresh = false, group = "", cacheOnly = false): Promise<ServerPublicSettings> {
  if (!window.naimageServer?.models) throw new Error("账户服务暂未提供模型列表。");
  const result = await window.naimageServer.models({ forceRefresh, cacheOnly, group });
  if (!result.ok) throw new Error(result.error ?? "模型列表拉取失败。");
  return result.settings ?? {};
}

export function fullServerModelList(serverSettings: ServerPublicSettings) {
  return uniqueImageModels([
    ...(serverSettings.models ?? []),
    ...(serverSettings.imageModels ?? []),
    ...(serverSettings.agentModels ?? []),
  ]);
}

export function preferredAgentModelFromList(models: string[] = []) {
  return models.find((model) => /^gpt-5\.6\b/i.test(model)) ?? models.find((model) => /^gpt-5\.5\b/i.test(model)) ?? models[0] ?? "";
}

export function preferredImageModelFromList(models: string[] = []) {
  return models.find((model) => /^gpt-image-2\b/i.test(model)) ?? models[0] ?? "";
}

/** Applies appearance to the document root without touching React or canvas state. */
export function applyGlassAppearance(
  settings: GlassThemeSettings,
  root: HTMLElement = document.documentElement
) {
  return applyGlassAppearanceToRoot(settings, root);
}

/** Safe early-render fallback; the dedicated snapshot contains appearance only. */
export function applyGlassBootstrapAppearance(
  storage?: Pick<Storage, "getItem"> | null,
  root: HTMLElement = document.documentElement
) {
  const snapshot = storage === undefined
    ? readGlassThemeBootstrapSnapshot()
    : readGlassThemeBootstrapSnapshot(storage);
  return applyGlassAppearanceToRoot(snapshot, root);
}

let appliedCustomThemeKeys: string[] = [];

export function applyTheme(choice: ThemeChoice, palette: ThemePaletteChoice = "default", customTheme: AppSettings["customTheme"] = null) {
  const resolved = choice === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : choice;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.themePreset = palette;
  for (const key of appliedCustomThemeKeys) document.documentElement.style.removeProperty(key);
  appliedCustomThemeKeys = [];
  if (palette === "custom" && customTheme) {
    for (const [key, value] of Object.entries(customTheme[resolved])) {
      document.documentElement.style.setProperty(key, value);
      appliedCustomThemeKeys.push(key);
    }
  }
  document.documentElement.classList.toggle("theme-dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-light", resolved === "light");
}
