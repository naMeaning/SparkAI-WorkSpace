import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  agentModelBindingFor,
  imageModelBindingFor,
  normalizeAgentModelBindings,
  normalizeImageModelBindings
} from "../src/core.ts";

import {
  AGENT_PROVIDER_OPTIONS,
  CONTEXT_STRATEGY_OPTIONS,
  DEFAULT_GLASS_BACKGROUND_BLUR,
  DEFAULT_GLASS_BACKGROUND_OVERLAY,
  DEFAULT_ACCOUNT_BASE_URL,
  DEFAULT_UPDATE_BASE_URL,
  REASONING_EFFORT_OPTIONS,
  STORAGE_IMAGE_STATS,
  STORAGE_SERVER_AUTH,
  STORAGE_SESSION,
  STORAGE_SETTINGS,
  THEME_PALETTE_VALUES,
  WORKSPACE_PLUGIN_DEFAULTS_VERSION,
  WORKSPACE_ASSET_RAIL_TAB_VALUES,
  defaultSettings,
  mergeSettings,
  normalizeCanvasToolShortcuts,
  normalizeDisabledCanvasToolCommands,
  normalizeGlassBackgroundSettings,
  normalizeCustomThemePreset,
  normalizeVisibleWorkspaceAssetRailTabs,
  readJson,
  writeJson
} from "../src/settings-persistence.ts";
const require = createRequire(import.meta.url);
const desktopGlassBackground = require("../desktop/glass-background-service.cjs") as {
  normalizeGlassBackgroundSettings(value: unknown): Record<string, unknown>;
};
assert.deepEqual(AGENT_PROVIDER_OPTIONS.map((option) => option.value), ["CODEX", "CUSTOM"]);
assert.deepEqual(REASONING_EFFORT_OPTIONS.map((option) => option.value), ["low", "medium", "high", "xhigh", "max", "ultra"]);
assert.deepEqual(CONTEXT_STRATEGY_OPTIONS.map((option) => option.value), ["auto", "codex", "claude", "naimage-balanced", "custom"]);
assert.deepEqual(THEME_PALETTE_VALUES, ["default", "anthropic", "simple-large", "underground", "rose-garden", "lake-view", "sunset-glow", "forest-whisper", "ocean-breeze", "lavender-dream", "custom"]);
assert.equal(defaultSettings.theme, "dark");
assert.equal(defaultSettings.themePalette, "anthropic");
assert.equal(defaultSettings.glassTheme, "dark-ember");
assert.equal(defaultSettings.agentModel, "gpt-5.6-terra");
assert.deepEqual(defaultSettings.agentModelPool, ["gpt-5.6-terra"]);
assert.equal(defaultSettings.imageModel, "gpt-image-2");
assert.deepEqual(defaultSettings.imageModelPool, ["gpt-image-2"]);
assert.equal(defaultSettings.customTheme, null);
assert.equal(normalizeCustomThemePreset(null), null);
assert.equal(defaultSettings.glassBackgroundEnabled, false);
assert.equal(defaultSettings.glassBackgroundAssetId, "");
assert.equal(defaultSettings.glassBackgroundAssetName, "");
assert.equal(defaultSettings.glassBackgroundAssetMetadata, null);
assert.equal(defaultSettings.glassBackgroundOverlay, DEFAULT_GLASS_BACKGROUND_OVERLAY);
assert.equal(defaultSettings.glassBackgroundBlur, DEFAULT_GLASS_BACKGROUND_BLUR);
assert.equal(defaultSettings.agentPanelPlacement, "right");
assert.equal(defaultSettings.agentPanelWidth, 390);
assert.equal(defaultSettings.imageBatchSize, 3);
assert.equal(defaultSettings.imageRatio, "1:1");
assert.equal(defaultSettings.imageResolution, "1K");
assert.equal(defaultSettings.imageSize, "1024x1024");
assert.equal(defaultSettings.contextStrategy, "auto");
assert.equal(defaultSettings.contextWindowTokens, 272_000);
assert.equal(defaultSettings.contextAutoCompactPercent, 90);
assert.deepEqual(defaultSettings.agentSkillAutoInstallTargets, []);
assert.equal(defaultSettings.workspacePluginDefaultsVersion, WORKSPACE_PLUGIN_DEFAULTS_VERSION);
assert.deepEqual(defaultSettings.pluginStates.map((state) => state.id), [
  "sparkai.commerce-toolkit",
  "sparkai.social-content",
  "sparkai.scientific-figure"
]);
assert.ok(defaultSettings.pluginStates.every((state) => state.enabled));
assert.equal(defaultSettings.canvasToolDockMode, "expanded");
assert.deepEqual(defaultSettings.disabledCanvasToolCommands, []);
assert.deepEqual(defaultSettings.canvasToolShortcuts, {});
assert.deepEqual(defaultSettings.visibleWorkspaceAssetRailTabs, ["results", "layers", "requirements", "templates", "history"]);
assert.deepEqual(WORKSPACE_ASSET_RAIL_TAB_VALUES, ["results", "layers", "requirements", "templates", "history"]);
assert.deepEqual(defaultSettings.agentModelBindings, []);
assert.deepEqual(defaultSettings.imageModelBindings, []);
assert.equal(defaultSettings.videoModel, "doubao-seedance-2-0-260128");
assert.deepEqual(defaultSettings.videoModelPool, ["doubao-seedance-2-0-260128"]);
assert.equal(STORAGE_SETTINGS, "naimage.settings.v1");
assert.equal(STORAGE_SESSION, "naimage.ideSession.v1");
assert.equal(STORAGE_IMAGE_STATS, "naimage.imageGenerationStats.v1");
assert.equal(STORAGE_SERVER_AUTH, "naimage.serverAuth.v1");

const migrated = mergeSettings({
  baseUrl: "https://legacy.example/v1",
  apiKey: "legacy-key",
  model: "agent-primary",
  agentModelPool: ["AGENT-PRIMARY", "agent-secondary", "agent-secondary"],
  agentModelBindings: [
    { model: " agent-primary ", customBaseUrl: " https://agent-primary.example/v1/ ", customApiKey: " agent-key-primary " },
    { model: "AGENT-PRIMARY", accountTokenId: "21" },
    { model: "agent-secondary", accountTokenId: "0" },
  ],
  imageModel: "image-primary",
  imageModelPool: ["IMAGE-PRIMARY", "image-secondary", ""],
  videoModel: "doubao-seedance-2-0-260128",
  videoModelPool: ["DOUBAO-SEEDANCE-2-0-260128", "sora-2", "sora-2"],
  imageModelBindings: [
    { model: " image-primary ", customBaseUrl: " https://image-primary.example/v1/ ", customApiKey: " key-primary " },
    { model: "IMAGE-PRIMARY", accountTokenId: "12" },
    { model: "image-secondary", accountTokenId: "0" },
  ],
  timeoutSeconds: 12.6,
  fastMode: "yes" as never,
  theme: "dark",
  themePalette: "lake-view"
});
assert.equal(migrated.agentBaseUrl, "https://legacy.example/v1");
assert.equal(migrated.imageBaseUrl, "https://legacy.example/v1");
assert.equal(migrated.agentApiKey, "legacy-key");
assert.equal(migrated.imageApiKey, "legacy-key");
assert.equal(migrated.agentModel, "agent-primary");
assert.deepEqual(migrated.agentModelPool, ["agent-primary", "agent-secondary"]);
assert.deepEqual(migrated.agentModelBindings, [
  { model: "agent-primary", customBaseUrl: "https://agent-primary.example/v1/", customApiKey: "agent-key-primary", accountTokenId: "21" },
  { model: "agent-secondary" },
]);
assert.deepEqual(agentModelBindingFor(migrated, "AGENT-PRIMARY"), {
  model: "agent-primary",
  customBaseUrl: "https://agent-primary.example/v1/",
  customApiKey: "agent-key-primary",
  accountTokenId: "21",
});
assert.deepEqual(normalizeAgentModelBindings([
  null,
  { model: "" },
  { model: " claude-private ", baseUrl: " https://agent.example/v1 ", customApiKey: " agent-private-key ", accountTokenId: "bad" },
]), [{ model: "claude-private", customBaseUrl: "https://agent.example/v1", customApiKey: "agent-private-key" }]);
assert.deepEqual(migrated.imageModelPool, ["image-primary", "image-secondary"]);
assert.equal(migrated.videoModel, "doubao-seedance-2-0-260128");
assert.deepEqual(migrated.videoModelPool, ["doubao-seedance-2-0-260128", "sora-2"]);
assert.deepEqual(migrated.imageModelBindings, [
  { model: "image-primary", customBaseUrl: "https://image-primary.example/v1/", customApiKey: "key-primary", accountTokenId: "12" },
  { model: "image-secondary" },
]);
assert.deepEqual(imageModelBindingFor(migrated, "IMAGE-PRIMARY"), {
  model: "image-primary",
  customBaseUrl: "https://image-primary.example/v1/",
  customApiKey: "key-primary",
  accountTokenId: "12",
});
assert.deepEqual(normalizeImageModelBindings([
  null,
  { model: "" },
  { model: " grok-image-latest ", baseUrl: " https://grok.example/v1 ", customApiKey: " grok-key ", accountTokenId: "not-an-id" },
]), [{ model: "grok-image-latest", customBaseUrl: "https://grok.example/v1", customApiKey: "grok-key" }]);
assert.deepEqual(mergeSettings({}).imageModelBindings, []);
assert.deepEqual(mergeSettings({}).agentModelBindings, []);
assert.deepEqual(mergeSettings({ videoModel: "", videoModelPool: ["sora-2"] }).videoModelPool, ["sora-2"]);
assert.equal(mergeSettings({ videoModel: "", videoModelPool: ["sora-2"] }).videoModel, "sora-2");
assert.equal(migrated.timeoutSeconds, 15);
assert.equal(migrated.fastMode, true);
assert.equal(migrated.theme, "dark");
assert.equal(migrated.themePalette, "lake-view");
assert.equal(migrated.accountBaseUrl, DEFAULT_ACCOUNT_BASE_URL);
assert.equal(migrated.relayBaseUrl, "");
assert.equal(migrated.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);
assert.equal(mergeSettings({ imageBatchSize: 0 }).imageBatchSize, 1);
assert.equal(mergeSettings({ imageBatchSize: 99 }).imageBatchSize, 10);
assert.deepEqual(
  (({ imageRatio, imageResolution, imageSize }) => ({ imageRatio, imageResolution, imageSize }))(
    mergeSettings({ imageRatio: "16:9", imageResolution: "2K" })
  ),
  { imageRatio: "16:9", imageResolution: "2K", imageSize: "2048x1152" }
);
assert.deepEqual(
  (({ imageRatio, imageResolution, imageSize }) => ({ imageRatio, imageResolution, imageSize }))(
    mergeSettings({ imageSize: "1920x1080" } as never)
  ),
  { imageRatio: "16:9", imageResolution: "1K", imageSize: "1280x720" },
  "Legacy imageSize values should migrate to the nearest supported ratio and clarity tier"
);
assert.equal(mergeSettings({ imageResolution: "1080P" } as never).imageResolution, "1K");
assert.equal(
  mergeSettings({ imageRatio: "4:5", imageResolution: "4K" }).imageSize,
  "2576x3216",
  "4K portrait output should remain available without exceeding the safe delivery pixel limit"
);
assert.equal(mergeSettings({}).canvasToolDockMode, "expanded");
assert.equal(mergeSettings({ canvasToolDockMode: "hover" }).canvasToolDockMode, "hover");
assert.equal(mergeSettings({ canvasToolDockMode: "invalid" as never }).canvasToolDockMode, "expanded");
assert.deepEqual(
  normalizeDisabledCanvasToolCommands([
    "sparkai.commerce-toolkit.generate-listing-set",
    " sparkai.commerce-toolkit.generate-listing-set ",
    "invalid",
    "future.plugin.command"
  ]),
  ["sparkai.commerce-toolkit.generate-listing-set", "future.plugin.command"]
);
assert.equal(
  normalizeDisabledCanvasToolCommands(Array.from({ length: 140 }, (_, index) => `future.plugin.tool-${index}`)).length,
  128
);
assert.deepEqual(
  mergeSettings({ disabledCanvasToolCommands: ["sparkai.commerce-toolkit.generate-listing-set", "invalid"] }).disabledCanvasToolCommands,
  ["sparkai.commerce-toolkit.generate-listing-set"]
);
assert.deepEqual(normalizeCanvasToolShortcuts({
  "sparkai.commerce-toolkit.translate-listing-set": "mod+alt+9",
  "unknown.plugin.command": "Mod+Alt+8"
}), {
  "sparkai.commerce-toolkit.translate-listing-set": "Mod+Alt+9"
});
assert.deepEqual(mergeSettings({ canvasToolShortcuts: {
  "sparkai.commerce-toolkit.translate-listing-set": "Mod+Alt+9"
} }).canvasToolShortcuts, {
  "sparkai.commerce-toolkit.translate-listing-set": "Mod+Alt+9"
});
assert.deepEqual(mergeSettings({ canvasToolShortcuts: {
  "sparkai.commerce-toolkit.translate-listing-set": "Mod+Shift+1"
} }).canvasToolShortcuts, {}, "Persisted shortcut conflicts must fall back to manifest defaults");
assert.deepEqual(mergeSettings({ canvasToolShortcuts: {
  "sparkai.commerce-toolkit.translate-listing-set": "Shift"
} }).canvasToolShortcuts, {}, "Modifier-only shortcuts must be ignored");
assert.deepEqual(normalizeVisibleWorkspaceAssetRailTabs(undefined), ["results", "layers", "requirements", "templates", "history"]);
assert.deepEqual(normalizeVisibleWorkspaceAssetRailTabs(["history", "results", "history", "invalid"]), ["results", "history"]);
assert.deepEqual(normalizeVisibleWorkspaceAssetRailTabs([]), ["results"]);
assert.deepEqual(normalizeVisibleWorkspaceAssetRailTabs(["invalid"]), ["results"]);
assert.deepEqual(mergeSettings({}).visibleWorkspaceAssetRailTabs, ["results", "layers", "requirements", "templates", "history"]);
assert.deepEqual(mergeSettings({ visibleWorkspaceAssetRailTabs: ["templates", "layers"] }).visibleWorkspaceAssetRailTabs, ["layers", "templates"]);

const glassAssetId = `glass-bg-${"a".repeat(64)}`;
const normalizedGlassBackground = normalizeGlassBackgroundSettings({
  glassBackgroundEnabled: true,
  glassBackgroundAssetId: ` ${glassAssetId.toUpperCase()} `,
  glassBackgroundAssetName: "C:\\catalog\\hero<summer>?.png",
  glassBackgroundAssetMetadata: {
    mimeType: "image/webp",
    width: 4_000,
    height: 123.6,
    bytes: 30 * 1024 * 1024
  },
  glassBackgroundOverlay: 99,
  glassBackgroundBlur: 99
});
assert.deepEqual(normalizedGlassBackground, {
  glassBackgroundEnabled: true,
  glassBackgroundAssetId: glassAssetId,
  glassBackgroundAssetName: "C catalog hero summer .png",
  glassBackgroundAssetMetadata: {
    mimeType: "image/webp",
    width: 3_840,
    height: 124,
    bytes: 24 * 1024 * 1024
  },
  glassBackgroundOverlay: 80,
  glassBackgroundBlur: 40
});
assert.deepEqual(
  desktopGlassBackground.normalizeGlassBackgroundSettings({
    glassBackgroundEnabled: true,
    glassBackgroundAssetId: ` ${glassAssetId.toUpperCase()} `,
    glassBackgroundAssetName: "C:\\catalog\\hero<summer>?.png",
    glassBackgroundAssetMetadata: { mimeType: "image/webp", width: 4_000, height: 123.6, bytes: 30 * 1024 * 1024 },
    glassBackgroundOverlay: 99,
    glassBackgroundBlur: 99
  }),
  normalizedGlassBackground,
  "Electron and Renderer must normalize persisted background fields identically"
);
assert.deepEqual(normalizeGlassBackgroundSettings({
  glassBackgroundEnabled: true,
  glassBackgroundAssetId: "../../settings.json",
  glassBackgroundAssetName: "secret.webp",
  glassBackgroundAssetMetadata: { mimeType: "image/webp", width: 100, height: 100, bytes: 20 }
}), {
  glassBackgroundEnabled: false,
  glassBackgroundAssetId: "",
  glassBackgroundAssetName: "",
  glassBackgroundAssetMetadata: null,
  glassBackgroundOverlay: DEFAULT_GLASS_BACKGROUND_OVERLAY,
  glassBackgroundBlur: DEFAULT_GLASS_BACKGROUND_BLUR
});
const persistedGlassBackground = mergeSettings({
  ...normalizedGlassBackground,
  glassBackgroundDataUrl: "data:image/webp;base64,AAAA",
  glassBackgroundPath: "C:\\private\\background.webp"
} as never);
assert.deepEqual(normalizeGlassBackgroundSettings(persistedGlassBackground), normalizedGlassBackground);
assert.equal("glassBackgroundDataUrl" in persistedGlassBackground, false, "Settings must never persist the temporary Base64 payload");
assert.equal("glassBackgroundPath" in persistedGlassBackground, false, "Settings must never persist a managed filesystem path");

const migratedLegacyServer = mergeSettings({ serverUrl: "https://legacy-new-api.example/" });
assert.equal(migratedLegacyServer.accountBaseUrl, "https://legacy-new-api.example");
assert.equal(migratedLegacyServer.relayBaseUrl, "");
assert.equal(migratedLegacyServer.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);
assert.equal((migratedLegacyServer as unknown as Record<string, unknown>).serverUrl, undefined);

const migratedRetiredUpdateHost = mergeSettings({ updateBaseUrl: "HTTPS://IMAGE.AIEYRA.CN/" });
assert.equal(migratedRetiredUpdateHost.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);
const retainedCustomUpdateHost = mergeSettings({ updateBaseUrl: "https://updates.example/" });
assert.equal(retainedCustomUpdateHost.updateBaseUrl, "https://updates.example");

const repaired = mergeSettings({
  agentProvider: "unsupported" as never,
  reasoningEffort: "extreme" as never,
  theme: "sepia" as never,
  themePalette: "not-a-palette" as never,
  timeoutSeconds: 900,
  serverUrl: "HTTP://LOCALHOST:17860/",
  serverToken: "token",
  serverSessionCookie: "cookie",
  serverUserId: "user"
});

const repairedAgentPanel = mergeSettings({
  agentPanelPlacement: "invalid" as never,
  agentPanelWidth: 4,
  agentPanelHeight: 99_999,
  agentPanelX: -80,
  agentPanelY: 99_999
});
assert.equal(repairedAgentPanel.agentPanelPlacement, "right");
assert.equal(repairedAgentPanel.agentPanelWidth, 320);
assert.equal(repairedAgentPanel.agentPanelHeight, 1_400);
assert.equal(repairedAgentPanel.agentPanelX, 0);
assert.equal(repairedAgentPanel.agentPanelY, 10_000);
assert.equal(mergeSettings({ agentPanelPlacement: "top" }).agentPanelPlacement, "top");
assert.equal(mergeSettings({ agentPanelPlacement: "bottom" }).agentPanelPlacement, "bottom");
assert.deepEqual(mergeSettings({ agentSkillAutoInstallTargets: ["codex", "unknown", "codex", "openclaw"] as never }).agentSkillAutoInstallTargets, ["codex", "openclaw"]);
const migratedPlugins = mergeSettings({ workspacePluginDefaultsVersion: WORKSPACE_PLUGIN_DEFAULTS_VERSION, pluginStates: [{
  id: "sparkai.commerce-toolkit",
  version: "0.0.1",
  enabled: true,
  grantedPermissions: ["canvas.read-selection", "agent.submit-task", "canvas.write-results", "unknown"]
}, { id: "unknown.plugin", enabled: true, grantedPermissions: [] }] as never });
assert.deepEqual(migratedPlugins.pluginStates, [{
  id: "sparkai.commerce-toolkit",
  version: "1.0.0",
  enabled: true,
  grantedPermissions: ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]
}]);
assert.equal(mergeSettings({ workspacePluginDefaultsVersion: WORKSPACE_PLUGIN_DEFAULTS_VERSION, pluginStates: [{ id: "sparkai.commerce-toolkit", enabled: true, grantedPermissions: ["canvas.read-selection"] }] as never }).pluginStates[0].enabled, false);
const migratedWorkspaceDefaults = mergeSettings({ workspacePluginDefaultsVersion: 0, pluginStates: [] });
assert.equal(migratedWorkspaceDefaults.workspacePluginDefaultsVersion, WORKSPACE_PLUGIN_DEFAULTS_VERSION);
assert.deepEqual(migratedWorkspaceDefaults.pluginStates.map((state) => state.id), [
  "sparkai.commerce-toolkit",
  "sparkai.social-content",
  "sparkai.scientific-figure"
]);
assert.deepEqual(
  mergeSettings({ workspacePluginDefaultsVersion: WORKSPACE_PLUGIN_DEFAULTS_VERSION, pluginStates: [] }).pluginStates,
  [],
  "A user removal after the one-time migration must remain removed"
);
const migratedDisabledWorkspacePlugin = mergeSettings({
  workspacePluginDefaultsVersion: 0,
  pluginStates: [{
    id: "sparkai.commerce-toolkit",
    enabled: false,
    grantedPermissions: ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]
  }]
});
assert.equal(migratedDisabledWorkspacePlugin.pluginStates.find((state) => state.id === "sparkai.commerce-toolkit")?.enabled, false);
assert.equal(migratedDisabledWorkspacePlugin.pluginStates.find((state) => state.id === "sparkai.social-content")?.enabled, true);
assert.equal(migratedDisabledWorkspacePlugin.pluginStates.find((state) => state.id === "sparkai.scientific-figure")?.enabled, true);
const toolbarPreferenceDoesNotChangePlugin = mergeSettings({
  workspacePluginDefaultsVersion: WORKSPACE_PLUGIN_DEFAULTS_VERSION,
  pluginStates: migratedPlugins.pluginStates,
  disabledCanvasToolCommands: ["sparkai.commerce-toolkit.generate-listing-set"]
});
assert.deepEqual(toolbarPreferenceDoesNotChangePlugin.pluginStates, migratedPlugins.pluginStates);
const repairedContext = mergeSettings({
  contextStrategy: "unsupported" as never,
  contextWindowTokens: 1,
  contextEffectiveWindowPercent: 200,
  contextAutoCompactPercent: 2,
  contextRetainedUserTokens: 999_999
});
assert.equal(repairedContext.contextStrategy, "auto");
assert.equal(repairedContext.contextWindowTokens, 8_000);
assert.equal(repairedContext.contextEffectiveWindowPercent, 99);
assert.equal(repairedContext.contextAutoCompactPercent, 50);
assert.equal(repairedContext.contextRetainedUserTokens, 50_000);
assert.equal(repaired.agentProvider, "CODEX");
assert.equal(repaired.reasoningEffort, "low");
assert.equal(repaired.theme, "dark");
assert.equal(repaired.themePalette, "anthropic");
assert.equal(repaired.customTheme, null);
assert.equal(repaired.timeoutSeconds, 600);
assert.equal(repaired.accountBaseUrl, defaultSettings.accountBaseUrl);
assert.equal(repaired.relayBaseUrl, "");
assert.equal(repaired.updateBaseUrl, defaultSettings.updateBaseUrl);
assert.equal(repaired.serverToken, "");
assert.equal(repaired.serverSessionCookie, "");
assert.equal(repaired.serverUserId, "");

const memory = new Map<string, string>();
let rejectWrites = false;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (rejectWrites) throw new Error("storage unavailable");
      memory.set(key, value);
    }
  }
});

try {
  assert.deepEqual(readJson("missing", { enabled: false }), { enabled: false });
  memory.set("object", JSON.stringify({ enabled: true, count: 3 }));
  assert.deepEqual(readJson("object", { enabled: false, name: "fallback" }), {
    enabled: true,
    name: "fallback",
    count: 3
  });
  memory.set("array", JSON.stringify(["one", "two"]));
  assert.deepEqual(readJson("array", [] as string[]), ["one", "two"]);
  memory.set("array-invalid", JSON.stringify({ one: true }));
  assert.deepEqual(readJson("array-invalid", ["fallback"]), ["fallback"]);
  memory.set("malformed", "{");
  assert.deepEqual(readJson("malformed", { safe: true }), { safe: true });

  memory.set("iiimage.settings.v1", JSON.stringify({ theme: "light", timeoutSeconds: 90 }));
  assert.deepEqual(readJson(STORAGE_SETTINGS, { theme: "system", themePalette: "default" }), { theme: "light", themePalette: "default", timeoutSeconds: 90 });
  assert.equal(memory.has(STORAGE_SETTINGS), false, "Compatibility reads must not rewrite legacy storage eagerly");
  memory.set("iiimage.ideSession.v1", JSON.stringify({ selectedNodeId: "legacy" }));
  memory.set(STORAGE_SESSION, JSON.stringify({ selectedNodeId: "canonical" }));
  assert.deepEqual(
    readJson(STORAGE_SESSION, { selectedNodeId: "" }),
    { selectedNodeId: "canonical" },
    "Existing canonical data must win over a legacy key",
  );

  writeJson(STORAGE_SETTINGS, { theme: "dark" });
  assert.equal(memory.get(STORAGE_SETTINGS), JSON.stringify({ theme: "dark" }));
  rejectWrites = true;
  assert.doesNotThrow(() => writeJson("blocked", { safe: true }));
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.doesNotThrow(() => writeJson("circular", circular));
} finally {
  if (originalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, cases: 124 })}\n`);
