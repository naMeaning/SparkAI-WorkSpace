import assert from "node:assert/strict";

import { imageModelBindingFor, normalizeImageModelBindings } from "../src/core.ts";

import {
  AGENT_PROVIDER_OPTIONS,
  CONTEXT_STRATEGY_OPTIONS,
  DEFAULT_ACCOUNT_BASE_URL,
  DEFAULT_UPDATE_BASE_URL,
  REASONING_EFFORT_OPTIONS,
  STORAGE_IMAGE_STATS,
  STORAGE_SERVER_AUTH,
  STORAGE_SESSION,
  STORAGE_SETTINGS,
  THEME_PALETTE_VALUES,
  defaultSettings,
  mergeSettings,
  normalizeDisabledCanvasToolCommands,
  normalizeCustomThemePreset,
  readJson,
  writeJson
} from "../src/settings-persistence.ts";
assert.deepEqual(AGENT_PROVIDER_OPTIONS.map((option) => option.value), ["CODEX", "CUSTOM"]);
assert.deepEqual(REASONING_EFFORT_OPTIONS.map((option) => option.value), ["low", "medium", "high", "xhigh", "max", "ultra"]);
assert.deepEqual(CONTEXT_STRATEGY_OPTIONS.map((option) => option.value), ["auto", "codex", "claude", "naimage-balanced", "custom"]);
assert.deepEqual(THEME_PALETTE_VALUES, ["default", "anthropic", "simple-large", "underground", "rose-garden", "lake-view", "sunset-glow", "forest-whisper", "ocean-breeze", "lavender-dream", "custom"]);
assert.equal(defaultSettings.theme, "light");
assert.equal(defaultSettings.themePalette, "anthropic");
assert.equal(defaultSettings.customTheme, null);
assert.equal(normalizeCustomThemePreset(null), null);
assert.equal(defaultSettings.agentPanelPlacement, "right");
assert.equal(defaultSettings.agentPanelWidth, 390);
assert.equal(defaultSettings.imageBatchSize, 3);
assert.equal(defaultSettings.contextStrategy, "auto");
assert.equal(defaultSettings.contextWindowTokens, 272_000);
assert.equal(defaultSettings.contextAutoCompactPercent, 90);
assert.deepEqual(defaultSettings.agentSkillAutoInstallTargets, []);
assert.deepEqual(defaultSettings.pluginStates, []);
assert.equal(defaultSettings.canvasToolDockMode, "expanded");
assert.deepEqual(defaultSettings.disabledCanvasToolCommands, []);
assert.deepEqual(defaultSettings.imageModelBindings, []);
assert.equal(STORAGE_SETTINGS, "naimage.settings.v1");
assert.equal(STORAGE_SESSION, "naimage.ideSession.v1");
assert.equal(STORAGE_IMAGE_STATS, "naimage.imageGenerationStats.v1");
assert.equal(STORAGE_SERVER_AUTH, "naimage.serverAuth.v1");

const migrated = mergeSettings({
  baseUrl: "https://legacy.example/v1",
  apiKey: "legacy-key",
  model: "agent-primary",
  agentModelPool: ["AGENT-PRIMARY", "agent-secondary", "agent-secondary"],
  imageModel: "image-primary",
  imageModelPool: ["IMAGE-PRIMARY", "image-secondary", ""],
  imageModelBindings: [
    { model: " image-primary ", customApiKey: " key-primary " },
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
assert.deepEqual(migrated.imageModelPool, ["image-primary", "image-secondary"]);
assert.deepEqual(migrated.imageModelBindings, [
  { model: "image-primary", customApiKey: "key-primary", accountTokenId: "12" },
  { model: "image-secondary" },
]);
assert.deepEqual(imageModelBindingFor(migrated, "IMAGE-PRIMARY"), {
  model: "image-primary",
  customApiKey: "key-primary",
  accountTokenId: "12",
});
assert.deepEqual(normalizeImageModelBindings([
  null,
  { model: "" },
  { model: " grok-image-latest ", customApiKey: " grok-key ", accountTokenId: "not-an-id" },
]), [{ model: "grok-image-latest", customApiKey: "grok-key" }]);
assert.deepEqual(mergeSettings({}).imageModelBindings, []);
assert.equal(migrated.timeoutSeconds, 15);
assert.equal(migrated.fastMode, true);
assert.equal(migrated.theme, "dark");
assert.equal(migrated.themePalette, "lake-view");
assert.equal(migrated.accountBaseUrl, DEFAULT_ACCOUNT_BASE_URL);
assert.equal(migrated.relayBaseUrl, "");
assert.equal(migrated.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);
assert.equal(mergeSettings({ imageBatchSize: 0 }).imageBatchSize, 1);
assert.equal(mergeSettings({ imageBatchSize: 99 }).imageBatchSize, 10);
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
const migratedPlugins = mergeSettings({ pluginStates: [{
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
assert.equal(mergeSettings({ pluginStates: [{ id: "sparkai.commerce-toolkit", enabled: true, grantedPermissions: ["canvas.read-selection"] }] as never }).pluginStates[0].enabled, false);
const toolbarPreferenceDoesNotChangePlugin = mergeSettings({
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
assert.equal(repaired.theme, "light");
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

process.stdout.write(`${JSON.stringify({ ok: true, cases: 72 })}\n`);
