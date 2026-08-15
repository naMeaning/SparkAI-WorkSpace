"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { registerDesktopIpc } = require("../desktop/ipc/register-desktop-ipc.cjs");
const { registerAgentIpc } = require("../desktop/ipc/agent-ipc.cjs");
const { registerCommerceCatalogIpc } = require("../desktop/ipc/commerce-catalog-ipc.cjs");
const { registerCommerceExportIpc } = require("../desktop/ipc/commerce-export-ipc.cjs");
const { registerCommerceTemplateIpc } = require("../desktop/ipc/commerce-template-ipc.cjs");
const { registerGlassBackgroundIpc, registerRequirementLibraryIpc, registerSettingsIpc } = require("../desktop/ipc/config-ipc.cjs");
const { registerImageCollectionIpc } = require("../desktop/ipc/image-collection-ipc.cjs");
const { registerServerIpc } = require("../desktop/ipc/server-ipc.cjs");
const { normalizedTaskScope } = require("../agent-runtime.cjs");

const expectedUpdaterChannels = [
  "naimage:update:status",
  "naimage:update:renderer-ready",
  "naimage:update:check",
  "naimage:update:installer-captcha",
  "naimage:update:download-restart",
  "naimage:update:download-installer",
  "naimage:update:apply-restart",
  "naimage:update:launch-installer"
];

const expectedChannels = [
  "naimage:config:load-settings",
  "naimage:config:save-settings",
  "naimage:theme:import",
  "naimage:theme:export",
  "naimage:glass-background:pick",
  "naimage:glass-background:load",
  "naimage:glass-background:clear",
  "naimage:requirement-library:list",
  "naimage:requirement-library:get",
  "naimage:requirement-library:save",
  "naimage:requirement-library:delete",
  "naimage:commerce-template:list",
  "naimage:commerce-template:get",
  "naimage:commerce-template:save",
  "naimage:commerce-template:delete",
  "naimage:commerce-template:import",
  "naimage:commerce-template:export",
  "naimage:commerce-catalog:list",
  "naimage:commerce-catalog:save-product",
  "naimage:commerce-catalog:archive-product",
  "naimage:commerce-catalog:assign-assets",
  "naimage:commerce-catalog:remove-asset",
  "naimage:commerce-catalog:update-result-state",
  "naimage:commerce-catalog:list-comparisons",
  "naimage:commerce-catalog:select-comparison",
  "naimage:commerce-catalog:reconcile-goal-results",
  "naimage:commerce-export:preview",
  "naimage:commerce-export:package",
  "naimage:social-export:preview",
  "naimage:social-export:package",
  "naimage:scientific:import-data",
  "naimage:scientific:list-data",
  "naimage:scientific:render",
  "naimage:scientific:list",
  "naimage:scientific:get",
  "naimage:scientific:cancel",
  "naimage:scientific:export",
  "naimage:plugin:compose-task",
  "naimage:automation:renderer-ready",
  "naimage:integration:detect",
  "naimage:integration:install",
  "naimage:integration:remove",
  ...expectedUpdaterChannels,
  "naimage:config:load-session",
  "naimage:config:save-session",
  "naimage:agent:tools",
  "naimage:agent:list-models",
  "naimage:agent:run-tool",
  "naimage:agent:compose-image-prompt",
  "naimage:agent:chat",
  "naimage:agent:pause",
  "naimage:agent:resume",
  "naimage:agent:stop",
  "naimage:agent:steer",
  "naimage:agent:run-status",
  "naimage:agent:compact",
  "naimage:agent:memory-check",
  "naimage:agent:memory-read",
  "naimage:agent:main-prompt:get",
  "naimage:agent:main-prompt:save",
  "naimage:agent:main-prompt:reset",
  "naimage:agent:fast-memory:get",
  "naimage:agent:fast-memory:save",
  "naimage:agent:fast-memory:reset",
  "naimage:agent:clear-conversation",
  "naimage:agent:smoke",
  "naimage:agent:cancel-pending-execution",
  "naimage:window:new",
  "naimage:window:control",
  "naimage:agent-window:open",
  "naimage:agent-window:close",
  "naimage:agent-window:status",
  "naimage:debug:window-bounds",
  "naimage:debug:capture-gui",
  "naimage:project:list",
  "naimage:project:migration-preview",
  "naimage:project:migrate",
  "naimage:project:migration-cleanup",
  "naimage:project:create",
  "naimage:project:create-folder",
  "naimage:project:switch",
  "naimage:project:rename",
  "naimage:project:open",
  "naimage:project:export",
  "naimage:project:import",
  "naimage:project-graph:import",
  "naimage:project-skill:import",
  "naimage:project-skill:parse",
  "naimage:project:open-current-folder",
  "naimage:project:delete",
  "naimage:project:delete-folder",
  "naimage:image-collection:export-preview",
  "naimage:image-collection:export",
  "naimage:image-collection:open-folder",
  "naimage:asset:pick-local-images",
  "naimage:asset:pick-local-videos",
  "naimage:asset:pick-reference-images",
  "naimage:asset:pick-reference-image",
  "naimage:asset:open-folder",
  "naimage:asset:read-data-url",
  "naimage:asset:refine-semantic-layers",
  "naimage:asset:isolate-background",
  "naimage:asset:thumbnail-stats",
  "naimage:asset:image-import-status",
  "naimage:asset:cancel-image-imports",
  "naimage:asset:import-local-images",
  "naimage:asset:import-local-videos",
  "naimage:asset:import-local-image",
  "naimage:asset:save-output-image",
  "naimage:asset:save-as",
  "naimage:asset:export-folder",
  "naimage:asset:export-psd",
  "naimage:asset:export-layer-psd",
  "naimage:server:license-status",
  "naimage:server:activate-license",
  "naimage:server:configure-custom",
  "naimage:server:register",
  "naimage:server:login",
  "naimage:server:logout",
  "naimage:server:me",
  "naimage:server:logs",
  "naimage:server:models",
  "naimage:server:tokens",
  "naimage:server:select-token",
  "naimage:server:create-token",
  "naimage:server:update-token",
  "naimage:server:delete-token",
  "naimage:server:recharge",
  "naimage:server:generate-image",
  "naimage:video-task:create",
  "naimage:video-task:list",
  "naimage:video-task:get",
  "naimage:video-task:poll",
  "naimage:video-task:retry-download"
];

const internalChannels = new Set([
  "naimage:agent:compact",
  "naimage:agent:memory-check",
  "naimage:agent:memory-read"
]);
const expectedProgressChannels = [
  "naimage:commerce-template:changed",
  "naimage:commerce-catalog:changed",
  "naimage:video-task:changed",
  "naimage:scientific:changed",
  "naimage:automation:request",
  "naimage:agent-window:command",
  "naimage:update:progress",
  "naimage:agent:run-state",
  "naimage:agent:progress"
];
const expectedPreloadSendChannels = [
  "naimage:automation:response",
  "naimage:agent-window:publish-state"
];
const expectedRegisteredSendChannels = [
  "naimage:automation:response",
  "naimage:agent-window:publish-state",
  "naimage:agent-window:command",
  "naimage:agent-window:ready"
];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function assertPreloadMigrationConfirmationBoundary(preloadSource, preloadPath) {
  const exposed = new Map();
  const invocations = [];
  const ipcRenderer = {
    invoke(channel, ...args) {
      invocations.push({ channel, args });
      return Promise.resolve({ ok: true });
    },
    on() {},
    removeListener() {},
    send() {}
  };
  vm.runInNewContext(preloadSource, {
    console,
    process: { argv: [] },
    require(request) {
      if (request !== "electron") throw new Error(`Unexpected preload dependency: ${request}`);
      return {
        contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
        ipcRenderer,
        webUtils: { getPathForFile: () => "" }
      };
    }
  }, { filename: preloadPath });
  const config = exposed.get("naimageConfig");
  assert(config, "preload must expose naimageConfig");

  async function forwarded(method, payload, channel) {
    invocations.length = 0;
    await config[method](payload);
    assert.equal(invocations.length, 1, `${method} must make exactly one IPC call`);
    assert.equal(invocations[0].channel, channel);
    return invocations[0].args[0];
  }

  const bundledMigrationPayload = { previewToken: "preview-fixture", candidateIds: ["candidate-a"], confirmed: 1 };
  const numericMigration = await forwarded("migrateProjectData", bundledMigrationPayload, "naimage:project:migrate");
  assert.equal(numericMigration.confirmed, true, "production-bundled confirmed=1 must cross preload as boolean true");
  assert.equal(bundledMigrationPayload.confirmed, 1, "preload normalization must not mutate the Renderer object");
  assert.equal((await forwarded("migrateProjectData", { confirmed: true }, "naimage:project:migrate")).confirmed, true);
  assert.equal((await forwarded("migrateProjectData", { confirmed: "1" }, "naimage:project:migrate")).confirmed, "1");
  assert.equal((await forwarded("migrateProjectData", { confirmed: 2 }, "naimage:project:migrate")).confirmed, 2);
  assert.equal((await forwarded("migrateProjectData", { confirmed: false }, "naimage:project:migrate")).confirmed, false);
  assert.equal(Object.hasOwn(await forwarded("migrateProjectData", {}, "naimage:project:migrate"), "confirmed"), false);

  const bundledCleanupPayload = { migrationId: "migration-fixture", confirmedCleanup: 1 };
  const numericCleanup = await forwarded("cleanupMigratedProjectData", bundledCleanupPayload, "naimage:project:migration-cleanup");
  assert.equal(numericCleanup.confirmedCleanup, true, "production-bundled confirmedCleanup=1 must cross preload as boolean true");
  assert.equal(bundledCleanupPayload.confirmedCleanup, 1);
  assert.equal((await forwarded("cleanupMigratedProjectData", { confirmedCleanup: "1" }, "naimage:project:migration-cleanup")).confirmedCleanup, "1");

  const projectIpcSource = readFileSync(path.resolve(__dirname, "..", "desktop", "ipc", "project-ipc.cjs"), "utf8");
  assert.match(projectIpcSource, /payload\?\.confirmed\s*!==\s*true/, "Main migration handler must keep strict boolean confirmation");
  assert.match(projectIpcSource, /confirmedCleanup:\s*payload\?\.confirmedCleanup\s*===\s*true/, "Main cleanup handler must keep strict boolean confirmation");
}

async function assertSettingsAccountBoundary() {
  const handlers = new Map();
  const defaults = {
    accountBaseUrl: "https://sparkapi.org",
    relayBaseUrl: "",
    updateBaseUrl: "https://sparkapi.org",
    serverToken: "",
    serverSessionCookie: "",
    serverUserId: "",
    selectedAccountTokenId: "",
    selectedAccountTokenName: "",
    selectedAccountTokenGroup: "",
    licenseDeviceId: "device-main-owned",
    licenseToken: "license-main-owned",
    licensePlan: "standard",
    licenseExpiresAt: 123456,
    licenseLastVerifiedAt: 123000
  };
  let stored = {
    ...defaults,
    serverSessionCookie: "session=old",
    serverUserId: "7",
    selectedAccountTokenId: "11",
    selectedAccountTokenName: "fixture",
    selectedAccountTokenGroup: "image"
  };
  let boundaryCalls = 0;
  const settingsSavedCalls = [];
  registerSettingsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    migrateSettings: (value) => ({ ...defaults, ...(value || {}) }),
    readJson: () => stored,
    settingsPath: "fixture-settings.json",
    defaultSettings: defaults,
    log: () => {},
    publicSettings: (settings) => settings,
    validateNewApiServiceSettings: () => true,
    onNewApiAccountBaseUrlChanged: () => { boundaryCalls += 1; },
    onSettingsSaved: (event, next, previous) => settingsSavedCalls.push({ event, next, previous }),
    writeJson: (_path, value) => { stored = value; }
  });
  const save = handlers.get("naimage:config:save-settings");
  const event = { sender: { id: 91 } };
  const relayOnly = await save(event, {
    relayBaseUrl: "https://relay.example",
    licenseDeviceId: "device-renderer-tampered",
    licenseToken: "license-renderer-tampered",
    licensePlan: "tampered",
    licenseExpiresAt: 1,
    licenseLastVerifiedAt: 1
  });
  assert.equal(relayOnly.accountChanged, false);
  assert.equal(stored.serverSessionCookie, "session=old");
  assert.equal(stored.serverUserId, "7");
  assert.equal(stored.selectedAccountTokenId, "11");
  assert.equal(stored.licenseDeviceId, "device-main-owned");
  assert.equal(stored.licenseToken, "license-main-owned");
  assert.equal(stored.licensePlan, "standard");
  assert.equal(stored.licenseExpiresAt, 123456);
  assert.equal(stored.licenseLastVerifiedAt, 123000);
  assert.equal(settingsSavedCalls.length, 1);
  assert.equal(settingsSavedCalls[0].event, event);
  assert.equal(settingsSavedCalls[0].next.relayBaseUrl, "https://relay.example");
  assert.equal(settingsSavedCalls[0].previous.serverSessionCookie, "session=old");
  const accountChange = await save(event, { accountBaseUrl: "https://account.example" });
  assert.equal(accountChange.accountChanged, true);
  assert.equal(stored.serverSessionCookie, "");
  assert.equal(stored.serverUserId, "");
  assert.equal(stored.selectedAccountTokenId, "");
  assert.equal(boundaryCalls, 1);
  assert.equal(settingsSavedCalls.length, 2);
}

async function assertGlassBackgroundIpcBoundary() {
  const handlers = new Map();
  const calls = [];
  const owner = { id: "owner-window" };
  registerGlassBackgroundIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow: { fromWebContents: (sender) => sender?.owner || null },
    getReferencedGlassBackgroundAssetIds: () => ["glass-bg-referenced"],
    glassBackgroundService: {
      pick: async (target) => {
        calls.push({ command: "pick", target });
        return { ok: true, asset: { assetId: "glass-bg-picked" } };
      },
      load: async (payload) => {
        calls.push({ command: "load", payload });
        return { ok: true, asset: { assetId: payload.assetId } };
      },
      clear: (payload, referencedAssetIds) => {
        calls.push({ command: "clear", payload, referencedAssetIds });
        return { ok: true, cleared: true };
      },
      cleanup: (payload) => {
        calls.push({ command: "cleanup", payload });
        return { ok: true, removed: 0 };
      }
    }
  });

  assert.deepEqual([...handlers.keys()], [
    "naimage:glass-background:pick",
    "naimage:glass-background:load",
    "naimage:glass-background:clear"
  ]);
  const pick = await handlers.get("naimage:glass-background:pick")({ sender: { owner } });
  assert.equal(pick.asset.assetId, "glass-bg-picked");
  assert.deepEqual(calls[0], { command: "pick", target: owner });
  assert.deepEqual(calls[1], {
    command: "cleanup",
    payload: { referencedAssetIds: ["glass-bg-referenced", "glass-bg-picked"] }
  });
  const loadPayload = { assetId: "glass-bg-picked", name: "workspace.webp" };
  await handlers.get("naimage:glass-background:load")({}, loadPayload);
  assert.deepEqual(calls[2], { command: "load", payload: loadPayload });
  const clearPayload = { assetId: "glass-bg-picked" };
  await handlers.get("naimage:glass-background:clear")({}, clearPayload);
  assert.deepEqual(calls[3], {
    command: "clear",
    payload: clearPayload,
    referencedAssetIds: ["glass-bg-referenced"]
  });

  const unavailableHandlers = new Map();
  registerGlassBackgroundIpc({
    ipcMain: { handle: (channel, handler) => unavailableHandlers.set(channel, handler) }
  });
  for (const channel of [
    "naimage:glass-background:pick",
    "naimage:glass-background:load",
    "naimage:glass-background:clear"
  ]) {
    assert.deepEqual(
      await unavailableHandlers.get(channel)({ sender: {} }, {}),
      {
        ok: false,
        errorCode: "GLASS_BACKGROUND_UNAVAILABLE",
        error: "Managed workspace backgrounds are unavailable in this runtime."
      }
    );
  }
}

async function assertRequirementLibraryIpcBoundary() {
  const handlers = new Map();
  const calls = [];
  registerRequirementLibraryIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    requirementLibraryService: {
      list: (payload) => { calls.push({ command: "list", payload }); return { ok: true, items: [] }; },
      get: (payload) => { calls.push({ command: "get", payload }); return { ok: true, entry: { id: payload.id } }; },
      save: (payload) => { calls.push({ command: "save", payload }); return { ok: true, entry: { id: "reqtpl-fixture" } }; },
      remove: (payload) => {
        calls.push({ command: "delete", payload });
        if (payload.expectedRevision === 9) {
          const error = new Error("模板已更新。");
          error.code = "TEMPLATE_REVISION_CONFLICT";
          error.details = { currentRevision: 10 };
          throw error;
        }
        return { ok: true, id: payload.id };
      }
    }
  });
  assert.deepEqual(await handlers.get("naimage:requirement-library:list")({}, { includeText: false }), { ok: true, items: [] });
  assert.equal((await handlers.get("naimage:requirement-library:get")({}, { id: "reqtpl-a" })).entry.id, "reqtpl-a");
  assert.equal((await handlers.get("naimage:requirement-library:save")({}, { title: "Hero", text: "Keep product" })).ok, true);
  assert.equal((await handlers.get("naimage:requirement-library:delete")({}, { id: "reqtpl-a", expectedRevision: 1, confirmed: true })).id, "reqtpl-a");
  const conflict = await handlers.get("naimage:requirement-library:delete")({}, { id: "reqtpl-a", expectedRevision: 9, confirmed: true });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errorCode, "TEMPLATE_REVISION_CONFLICT");
  assert.deepEqual(conflict.details, { currentRevision: 10 });
  assert.deepEqual(calls.map((call) => call.command), ["list", "get", "save", "delete", "delete"]);
}

async function assertCommerceTemplateIpcBoundary() {
  const handlers = new Map();
  const calls = [];
  const broadcasts = [];
  const owner = { id: "owner-window" };
  const personalId = `commerce-template-${"a".repeat(32)}`;
  registerCommerceTemplateIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow: {
      fromWebContents: (sender) => sender?.id === 77 ? owner : null,
      getAllWindows: () => [{
        isDestroyed: () => false,
        webContents: { send: (channel, payload) => broadcasts.push({ channel, payload }) }
      }, { isDestroyed: () => true, webContents: { send: () => assert.fail("Destroyed windows must not receive template events") } }]
    },
    commerceTemplateLibraryService: {
      list: () => { calls.push({ command: "list" }); return { ok: true, libraryRevision: 1, items: [] }; },
      get: (payload) => { calls.push({ command: "get", payload }); return { ok: true, entry: { id: payload.id } }; },
      save: (payload) => {
        calls.push({ command: "save", payload });
        return { ok: true, changed: true, libraryRevision: 2, entry: { id: personalId, revision: 1 } };
      },
      remove: (payload) => {
        calls.push({ command: "delete", payload });
        if (payload.expectedRevision === 9) {
          const error = new Error("template changed");
          error.code = "COMMERCE_TEMPLATE_REVISION_CONFLICT";
          error.details = { currentRevision: 10 };
          throw error;
        }
        return { ok: true, changed: true, libraryRevision: 3, id: payload.id };
      },
      importTemplate: (window) => {
        calls.push({ command: "import", owner: window });
        return { ok: true, changed: true, libraryRevision: 4, entry: { id: `commerce-template-${"b".repeat(32)}`, revision: 1 } };
      },
      exportTemplate: (payload, window) => {
        calls.push({ command: "export", payload, owner: window });
        return { ok: true, canceled: false, fileName: "template.json" };
      }
    }
  });
  assert.deepEqual([...handlers.keys()], [
    "naimage:commerce-template:list",
    "naimage:commerce-template:get",
    "naimage:commerce-template:save",
    "naimage:commerce-template:delete",
    "naimage:commerce-template:import",
    "naimage:commerce-template:export"
  ]);
  const event = { sender: { id: 77 } };
  assert.equal((await handlers.get("naimage:commerce-template:list")()).libraryRevision, 1);
  assert.equal((await handlers.get("naimage:commerce-template:get")({}, { id: personalId })).entry.id, personalId);
  assert.equal((await handlers.get("naimage:commerce-template:save")({}, { title: "Amazon" })).libraryRevision, 2);
  assert.equal((await handlers.get("naimage:commerce-template:delete")({}, { id: personalId, expectedRevision: 1, confirmed: true })).libraryRevision, 3);
  const conflict = await handlers.get("naimage:commerce-template:delete")({}, { id: personalId, expectedRevision: 9, confirmed: true });
  assert.equal(conflict.errorCode, "COMMERCE_TEMPLATE_REVISION_CONFLICT");
  assert.deepEqual(conflict.details, { currentRevision: 10 });
  assert.equal((await handlers.get("naimage:commerce-template:import")(event)).libraryRevision, 4);
  assert.equal((await handlers.get("naimage:commerce-template:export")(event, { id: "commerce-builtin-amazon" })).fileName, "template.json");
  assert.deepEqual(calls.map((call) => call.command), ["list", "get", "save", "delete", "delete", "import", "export"]);
  assert.equal(calls[5].owner, owner, "The native import picker must belong to the invoking Renderer window");
  assert.equal(calls[6].owner, owner, "The native export picker must belong to the invoking Renderer window");
  assert.deepEqual(broadcasts, [{
    channel: "naimage:commerce-template:changed",
    payload: { libraryRevision: 2, id: personalId }
  }, {
    channel: "naimage:commerce-template:changed",
    payload: { libraryRevision: 3, id: personalId }
  }, {
    channel: "naimage:commerce-template:changed",
    payload: { libraryRevision: 4, id: `commerce-template-${"b".repeat(32)}` }
  }]);
}

async function assertCommerceCatalogIpcBoundary() {
  const handlers = new Map();
  const calls = [];
  const broadcasts = [];
  const product = { productId: "product-a", revision: 2 };
  registerCommerceCatalogIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow: {
      getAllWindows: () => [{
        isDestroyed: () => false,
        webContents: { send: (channel, payload) => broadcasts.push({ channel, payload }) }
      }]
    },
    commerceCatalogService: {
      list: (payload) => { calls.push({ command: "list", payload }); return { ok: true, projectId: "project-a", catalogRevision: 1, catalog: { products: [] } }; },
      saveProduct: (payload) => { calls.push({ command: "save", payload }); return { ok: true, changed: true, projectId: "project-a", catalogRevision: 2, product }; },
      archiveProduct: (payload) => { calls.push({ command: "archive", payload }); return { ok: true, changed: false, projectId: "project-a", catalogRevision: 2, product }; },
      assignAssets: (payload) => { calls.push({ command: "assign", payload }); return { ok: true, changed: true, projectId: "project-a", catalogRevision: 3, product }; },
      removeAsset: (payload) => {
        calls.push({ command: "remove", payload });
        const error = new Error("catalog changed");
        error.code = "CATALOG_REVISION_CONFLICT";
        error.details = { currentRevision: 4 };
        throw error;
      },
      updateResultState: (payload) => { calls.push({ command: "state", payload }); return { ok: true, changed: false, projectId: "project-a", catalogRevision: 3, product }; },
      listComparisons: (payload) => { calls.push({ command: "compare", payload }); return { ok: true, projectId: "project-a", catalogRevision: 3, groups: [{ groupKey: "comparison-a" }] }; },
      selectComparisonWinner: (payload) => { calls.push({ command: "select", payload }); return { ok: true, changed: true, projectId: "project-a", catalogRevision: 4, product }; },
      reconcileGoalResults: (payload) => { calls.push({ command: "reconcile", payload }); return { ok: true, changed: true, projectId: "project-a", catalogRevision: 4, details: { added: 2 } }; }
    }
  });
  assert.deepEqual([...handlers.keys()], [
    "naimage:commerce-catalog:list",
    "naimage:commerce-catalog:save-product",
    "naimage:commerce-catalog:archive-product",
    "naimage:commerce-catalog:assign-assets",
    "naimage:commerce-catalog:remove-asset",
    "naimage:commerce-catalog:update-result-state",
    "naimage:commerce-catalog:list-comparisons",
    "naimage:commerce-catalog:select-comparison",
    "naimage:commerce-catalog:reconcile-goal-results"
  ]);
  assert.equal((await handlers.get("naimage:commerce-catalog:list")({}, { expectedProjectId: "project-a" })).ok, true);
  assert.equal((await handlers.get("naimage:commerce-catalog:save-product")({}, { expectedCatalogRevision: 1 })).catalogRevision, 2);
  assert.equal((await handlers.get("naimage:commerce-catalog:archive-product")({}, { expectedCatalogRevision: 2 })).changed, false);
  assert.equal((await handlers.get("naimage:commerce-catalog:assign-assets")({}, { expectedCatalogRevision: 2 })).catalogRevision, 3);
  const conflict = await handlers.get("naimage:commerce-catalog:remove-asset")({}, { expectedCatalogRevision: 2 });
  assert.equal(conflict.errorCode, "CATALOG_REVISION_CONFLICT");
  assert.deepEqual(conflict.details, { currentRevision: 4 });
  assert.equal((await handlers.get("naimage:commerce-catalog:update-result-state")({}, { expectedCatalogRevision: 3 })).changed, false);
  assert.equal((await handlers.get("naimage:commerce-catalog:list-comparisons")({}, { expectedProjectId: "project-a" })).groups[0].groupKey, "comparison-a");
  assert.equal((await handlers.get("naimage:commerce-catalog:select-comparison")({}, { expectedCatalogRevision: 3 })).catalogRevision, 4);
  assert.equal((await handlers.get("naimage:commerce-catalog:reconcile-goal-results")({}, { taskScopeSnapshotHash: `scope-${"a".repeat(32)}` })).details.added, 2);
  assert.deepEqual(calls.map((call) => call.command), ["list", "save", "archive", "assign", "remove", "state", "compare", "select", "reconcile"]);
  assert.deepEqual(broadcasts, [{
    channel: "naimage:commerce-catalog:changed",
    payload: { projectId: "project-a", catalogRevision: 2 }
  }, {
    channel: "naimage:commerce-catalog:changed",
    payload: { projectId: "project-a", catalogRevision: 3 }
  }, {
    channel: "naimage:commerce-catalog:changed",
    payload: { projectId: "project-a", catalogRevision: 4 }
  }, {
    channel: "naimage:commerce-catalog:changed",
    payload: { projectId: "project-a", catalogRevision: 4 }
  }]);
}

async function assertCommerceExportIpcBoundary() {
  const handlers = new Map();
  const calls = [];
  const pickerResults = [
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: ["D:/picked-commerce-export"] }
  ];
  let pickerCalls = 0;
  registerCommerceExportIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {
      async showOpenDialog(options) {
        pickerCalls += 1;
        assert.deepEqual(options.properties, ["openDirectory", "createDirectory"]);
        return pickerResults.shift();
      }
    },
    commerceExportService: {
      async preview(payload) {
        calls.push({ command: "preview", payload });
        return { ok: true, catalogRevision: payload.expectedCatalogRevision, summary: { packages: 1 } };
      },
      async exportPackage(payload) {
        calls.push({ command: "package", payload });
        if (payload.confirmed !== true) {
          const error = new Error("confirmation required");
          error.code = "EXPORT_CONFIRMATION_REQUIRED";
          throw error;
        }
        return { ok: true, path: `${payload.destinationParent}/naimage-amazon-export` };
      }
    }
  });
  assert.deepEqual([...handlers.keys()], ["naimage:commerce-export:preview", "naimage:commerce-export:package"]);
  const preview = await handlers.get("naimage:commerce-export:preview")({}, { expectedProjectId: "project-a", expectedCatalogRevision: 4 });
  assert.equal(preview.catalogRevision, 4);
  const unconfirmed = await handlers.get("naimage:commerce-export:package")({}, { confirmed: false, destinationParent: "C:/forbidden" });
  assert.equal(unconfirmed.errorCode, "EXPORT_CONFIRMATION_REQUIRED");
  assert.equal(pickerCalls, 0, "Unconfirmed export must fail before opening the directory picker");
  const canceled = await handlers.get("naimage:commerce-export:package")({}, { confirmed: true, destinationParent: "C:/forbidden" });
  assert.deepEqual(canceled, { ok: true, canceled: true });
  assert.equal(calls.filter((call) => call.command === "package").length, 1, "Canceled picker must not call the export service");
  const exported = await handlers.get("naimage:commerce-export:package")({}, { confirmed: true, destinationParent: "C:/forbidden" });
  assert.equal(exported.path, "D:/picked-commerce-export/naimage-amazon-export");
  assert.equal(calls.at(-1).payload.destinationParent, "D:/picked-commerce-export", "Renderer destination input must be replaced by the native picker result");
}

async function assertImageCollectionIpcBoundary() {
  const handlers = new Map();
  const calls = [];
  const opened = [];
  registerImageCollectionIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    imageCollectionExportService: {
      async previewCollections(payload) {
        calls.push({ command: "preview", payload });
        return { ok: true, projectId: payload.expectedProjectId, format: payload.format, previewToken: "preview-token", collectionCount: payload.collectionIds.length };
      },
      async exportCollections(payload) {
        calls.push({ command: "export", payload });
        if (payload.confirmed !== true) {
          const error = new Error("confirmation required");
          error.code = "IMAGE_COLLECTION_EXPORT_CONFIRMATION_REQUIRED";
          throw error;
        }
        return { ok: true, projectId: payload.expectedProjectId, exported: payload.collectionIds.map((collectionId) => ({ collectionId })) };
      },
      async resolveExportedCollectionFolder(payload) {
        calls.push({ command: "resolve", payload });
        if (payload.collectionId === "missing") {
          const error = new Error("not exported");
          error.code = "IMAGE_COLLECTION_NOT_EXPORTED";
          throw error;
        }
        return { projectId: payload.expectedProjectId, collectionId: payload.collectionId, directoryName: "组 A", folderPath: "D:/managed/project/exports/image-groups/组 A" };
      }
    },
    shell: { openPath: async (folderPath) => { opened.push(folderPath); return ""; } }
  });
  assert.deepEqual([...handlers.keys()], ["naimage:image-collection:export-preview", "naimage:image-collection:export", "naimage:image-collection:open-folder"]);
  const preview = await handlers.get("naimage:image-collection:export-preview")({}, {
    expectedProjectId: "project-a",
    collectionIds: ["collection-a", "collection-b"],
    format: "webp",
    destinationPath: "C:/renderer-path-must-be-ignored"
  });
  assert.equal(preview.previewToken, "preview-token");
  assert.deepEqual(calls[0].payload, {
    expectedProjectId: "project-a",
    collectionIds: ["collection-a", "collection-b"],
    format: "webp"
  });
  const unconfirmed = await handlers.get("naimage:image-collection:export")({}, {
    expectedProjectId: "project-a",
    collectionIds: ["collection-a"],
    format: "png",
    previewToken: "preview-token",
    confirmed: false,
    destinationPath: "C:/renderer-path-must-be-ignored"
  });
  assert.equal(unconfirmed.errorCode, "IMAGE_COLLECTION_EXPORT_CONFIRMATION_REQUIRED");
  const exported = await handlers.get("naimage:image-collection:export")({}, {
    expectedProjectId: "project-a",
    collectionIds: ["collection-a", "collection-b"],
    format: "avif",
    previewToken: "preview-token",
    confirmed: true,
    destinationPath: "C:/renderer-path-must-be-ignored"
  });
  assert.equal(exported.exported.length, 2);
  assert.deepEqual(calls[2].payload, {
    expectedProjectId: "project-a",
    collectionIds: ["collection-a", "collection-b"],
    format: "avif",
    previewToken: "preview-token",
    confirmed: true
  });
  const missing = await handlers.get("naimage:image-collection:open-folder")({}, {
    expectedProjectId: "project-a",
    collectionId: "missing",
    path: "C:/renderer-path-must-be-ignored"
  });
  assert.equal(missing.errorCode, "IMAGE_COLLECTION_NOT_EXPORTED");
  assert.equal(opened.length, 0);
  const folder = await handlers.get("naimage:image-collection:open-folder")({}, {
    expectedProjectId: "project-a",
    collectionId: "collection-a",
    path: "C:/renderer-path-must-be-ignored"
  });
  assert.equal(folder.ok, true);
  assert.deepEqual(calls.at(-1).payload, { expectedProjectId: "project-a", collectionId: "collection-a" });
  assert.deepEqual(opened, ["D:/managed/project/exports/image-groups/组 A"]);
}

async function assertBestEffortRemoteLogout() {
  const handlers = new Map();
  let clearCalls = 0;
  let failRemote = false;
  const remoteCalls = [];
  registerServerIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    aidebugMode: false,
    aidebugLiveImage: false,
    aidebugStatefulAuth: false,
    defaultSettings: {},
    settingsPath: "fixture-settings.json",
    migrateSettings: (value) => value,
    readJson: () => ({ serverSessionCookie: "session=fixture", serverUserId: "7" }),
    newApiUserAuthHeaders: () => ({ cookie: "session=fixture", "New-Api-User": "7" }),
    newApiRequest: async (_settings, endpoint, options) => {
      remoteCalls.push({ endpoint, options });
      if (failRemote) throw new Error("offline");
      return { success: true };
    },
    clearNewApiAuth: () => { clearCalls += 1; },
    log: () => {}
  });
  const logout = handlers.get("naimage:server:logout");
  const succeeded = await logout();
  assert.equal(succeeded.remoteLogout, true);
  assert.equal(remoteCalls[0].endpoint, "/api/user/logout");
  assert.equal(remoteCalls[0].options.method, "POST");
  assert.equal(clearCalls, 1);
  failRemote = true;
  const failedRemote = await logout();
  assert.equal(failedRemote.ok, true);
  assert.equal(failedRemote.remoteLogout, false);
  assert.equal(clearCalls, 2, "Local auth must clear even when remote logout fails");
}

async function assertInvalidGoalFailsBeforeRunAdmission() {
  const handlers = new Map();
  let beginCalls = 0;
  let runToolCalls = 0;
  registerAgentIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    currentAgentSettings: () => ({}),
    getAgentRuntime: () => ({
      normalizeTaskScope: normalizedTaskScope,
      runTool: async () => {
        runToolCalls += 1;
        return { envelope: { ok: true }, actions: [] };
      }
    }),
    log: () => {},
    listAgentModels: async () => ({ ok: true, models: [] }),
    emitAgentProgress: () => {},
    agentRunControl: {
      begin: () => {
        beginCalls += 1;
        return { signal: undefined };
      },
      finish: () => {}
    },
    aidebugMode: false,
    aidebugAgentStopFixture: false
  });

  const response = await handlers.get("naimage:agent:run-tool")(
    { sender: { id: 77, once: () => {}, isDestroyed: () => false } },
    {
      name: "image_gen",
      runId: "invalid-legacy-goal",
      projectId: "fixture-project",
      conversationId: "fixture-conversation",
      taskScope: {
        origin: "goal",
        goal: {
          version: 1,
          target: "all-image-containers",
          frozen: true
        }
      },
      input: { operation: "variants" }
    }
  );

  assert.equal(response.envelope?.ok, false);
  assert.equal(beginCalls, 0, "An invalid legacy Goal must be rejected before run admission");
  assert.equal(runToolCalls, 0, "An invalid legacy Goal must cause zero runtime/provider dispatch");

  const missingProject = await handlers.get("naimage:agent:run-tool")(
    { sender: { id: 77, once: () => {}, isDestroyed: () => false } },
    { name: "image_gen", runId: "missing-project", input: { prompt: "must not run" } }
  );
  assert.equal(missingProject.envelope?.errorCode, "PROJECT_REQUIRED");
  assert.equal(beginCalls, 0, "A missing project must be rejected before run admission");
  assert.equal(runToolCalls, 0, "A missing project must cause zero runtime/provider dispatch");
}

async function assertSettingsSnapshotPayloads() {
  const handlers = new Map();
  const modelCalls = [];
  const tokenCalls = [];
  registerServerIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    aidebugMode: false,
    aidebugLiveImage: false,
    defaultSettings: {},
    settingsPath: "fixture-settings.json",
    migrateSettings: (value) => value,
    readJson: () => ({ accessMode: "account", serverSessionCookie: "session=fixture", serverUserId: "7" }),
    accountTokenService: {
      list: async (_settings, options) => {
        tokenCalls.push(options);
        return { ok: true, tokens: [] };
      }
    },
    newApiModelSettings: async (_settings, options) => {
      modelCalls.push(options);
      return { models: [] };
    },
    splitModelSettings: () => ({ models: [] }),
    log: () => {}
  });
  const models = await handlers.get("naimage:server:models")(null, { cacheOnly: true, forceRefresh: false, group: "image" });
  const tokens = await handlers.get("naimage:server:tokens")(null, { preferCached: true });
  assert.equal(models.ok, true);
  assert.equal(tokens.ok, true);
  assert.deepEqual(modelCalls, [{ forceRefresh: false, cacheOnly: true }]);
  assert.deepEqual(tokenCalls, [{ preferCached: true }]);
}

async function main() {
  const registrations = [];
  const eventRegistrations = [];
  const duplicateChannels = [];
  const seenChannels = new Set();
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(typeof channel, "string", "IPC channel must be a string.");
      assert.equal(typeof handler, "function", `IPC handler must be a function: ${channel}`);
      if (seenChannels.has(channel)) duplicateChannels.push(channel);
      seenChannels.add(channel);
      registrations.push(channel);
    },
    on(channel, handler) {
      assert.equal(typeof handler, "function", `IPC event handler must be a function: ${channel}`);
      eventRegistrations.push(channel);
    }
  };
  const desktopUpdater = {
    applyDesktopRestartUpdate: async () => undefined,
    checkDesktopUpdate: async () => undefined,
    createDesktopInstallerCaptcha: async () => undefined,
    desktopUpdaterFailure: () => undefined,
    desktopUpdaterStatus: () => undefined,
    downloadDesktopInstallerUpdate: async () => undefined,
    downloadDesktopRestartUpdate: async () => undefined,
    launchDesktopInstallerUpdate: async () => undefined,
    markRestartUpdateHealthy: () => true,
    publishDesktopUpdateProgress: () => undefined
  };

  registerDesktopIpc({
    ipcMain,
    desktopUpdater,
    automationService: {},
    agentIntegrationService: {},
    videoTaskService: {}
  });

  assert.equal(expectedChannels.length, 141, "The registration contract must contain exactly 141 invoke channels.");
  assert.equal(new Set(expectedChannels).size, 141, "The expected registration contract must be unique.");
  assert.deepEqual(duplicateChannels, [], "Duplicate IPC registrations were detected.");
  assert.deepEqual(registrations, expectedChannels, "IPC registration order or membership changed.");
  assert.deepEqual(eventRegistrations, expectedRegisteredSendChannels, "IPC send channel registration changed.");

  const preloadPath = path.resolve(__dirname, "..", "preload.cjs");
  const preloadSource = readFileSync(preloadPath, "utf8");
  await assertPreloadMigrationConfirmationBoundary(preloadSource, preloadPath);
  const invokeChannels = [...preloadSource.matchAll(/ipcRenderer\s*\.\s*invoke\s*\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);
  const progressChannels = [...preloadSource.matchAll(/ipcRenderer\s*\.\s*on\s*\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);
  const sendChannels = [...preloadSource.matchAll(/ipcRenderer\s*\.\s*send\s*\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);

  assert.equal(invokeChannels.length, 138, "preload must expose exactly 138 invoke calls.");
  assert.equal(new Set(invokeChannels).size, 138, "preload invoke channels must be unique.");
  assert.deepEqual(progressChannels, expectedProgressChannels, "preload progress listeners changed.");
  assert.deepEqual(sendChannels, expectedPreloadSendChannels, "preload send channels changed.");

  const publicRegistrations = registrations.filter((channel) => !internalChannels.has(channel));
  assert.equal(publicRegistrations.length, 138, "Exactly three registered invoke channels must remain internal.");
  assert.deepEqual(
    sorted(publicRegistrations),
    sorted(invokeChannels),
    "Registered public IPC channels must match preload invokes."
  );
  const agentWindowPreloadSource = readFileSync(path.resolve(__dirname, "..", "agent-window-preload.cjs"), "utf8");
  const agentWindowListeners = [...agentWindowPreloadSource.matchAll(/ipcRenderer\s*\.\s*on\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  const agentWindowSends = [...agentWindowPreloadSource.matchAll(/ipcRenderer\s*\.\s*send\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(agentWindowListeners, ["naimage:agent-window:state"], "Agent window preload listeners changed.");
  assert.deepEqual(agentWindowSends, ["naimage:agent-window:ready", "naimage:agent-window:command"], "Agent window preload sends changed.");
  await assertSettingsAccountBoundary();
  await assertGlassBackgroundIpcBoundary();
  await assertRequirementLibraryIpcBoundary();
  await assertCommerceTemplateIpcBoundary();
  await assertCommerceCatalogIpcBoundary();
  await assertCommerceExportIpcBoundary();
  await assertImageCollectionIpcBoundary();
  await assertBestEffortRemoteLogout();
  await assertSettingsSnapshotPayloads();
  await assertInvalidGoalFailsBeforeRunAdmission();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    registeredChannels: registrations.length,
    preloadInvokeChannels: invokeChannels.length,
    internalChannels: [...internalChannels],
    progressChannels,
    sendChannels
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
