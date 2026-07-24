"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { registerDesktopIpc } = require("../desktop/ipc/register-desktop-ipc.cjs");
const { registerSettingsIpc } = require("../desktop/ipc/config-ipc.cjs");
const { registerServerIpc } = require("../desktop/ipc/server-ipc.cjs");

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
  ...expectedUpdaterChannels,
  "naimage:config:load-session",
  "naimage:config:save-session",
  "naimage:agent:tools",
  "naimage:agent:list-models",
  "naimage:agent:run-tool",
  "naimage:agent:compose-image-prompt",
  "naimage:agent:chat",
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
  "naimage:debug:window-bounds",
  "naimage:debug:capture-gui",
  "naimage:project:list",
  "naimage:project:create",
  "naimage:project:create-folder",
  "naimage:project:switch",
  "naimage:project:rename",
  "naimage:project:open",
  "naimage:project:export",
  "naimage:project:import",
  "naimage:project:open-current-folder",
  "naimage:project:delete",
  "naimage:project:delete-folder",
  "naimage:asset:pick-local-images",
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
  "naimage:asset:import-local-image",
  "naimage:asset:save-output-image",
  "naimage:asset:save-as",
  "naimage:asset:export-folder",
  "naimage:asset:export-psd",
  "naimage:asset:export-layer-psd",
  "naimage:server:register",
  "naimage:server:login",
  "naimage:server:logout",
  "naimage:server:me",
  "naimage:server:logs",
  "naimage:server:models",
  "naimage:server:recharge",
  "naimage:server:generate-image"
];

const internalChannels = new Set([
  "naimage:agent:compact",
  "naimage:agent:memory-check",
  "naimage:agent:memory-read"
]);
const expectedProgressChannels = [
  "naimage:update:progress",
  "naimage:agent:progress"
];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function assertSettingsAccountBoundary() {
  const handlers = new Map();
  const defaults = {
    accountBaseUrl: "https://sparkapi.org",
    relayBaseUrl: "",
    updateBaseUrl: "https://sparkapi.org",
    serverToken: "",
    serverSessionCookie: "",
    serverUserId: ""
  };
  let stored = { ...defaults, serverSessionCookie: "session=old", serverUserId: "7" };
  let boundaryCalls = 0;
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
    writeJson: (_path, value) => { stored = value; }
  });
  const save = handlers.get("naimage:config:save-settings");
  const relayOnly = await save(null, { relayBaseUrl: "https://relay.example" });
  assert.equal(relayOnly.accountChanged, false);
  assert.equal(stored.serverSessionCookie, "session=old");
  assert.equal(stored.serverUserId, "7");
  const accountChange = await save(null, { accountBaseUrl: "https://account.example" });
  assert.equal(accountChange.accountChanged, true);
  assert.equal(stored.serverSessionCookie, "");
  assert.equal(stored.serverUserId, "");
  assert.equal(boundaryCalls, 1);
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

async function main() {
  const registrations = [];
  const duplicateChannels = [];
  const seenChannels = new Set();
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(typeof channel, "string", "IPC channel must be a string.");
      assert.equal(typeof handler, "function", `IPC handler must be a function: ${channel}`);
      if (seenChannels.has(channel)) duplicateChannels.push(channel);
      seenChannels.add(channel);
      registrations.push(channel);
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

  registerDesktopIpc({ ipcMain, desktopUpdater });

  assert.equal(expectedChannels.length, 69, "The registration contract must contain exactly 69 channels.");
  assert.equal(new Set(expectedChannels).size, 69, "The expected registration contract must be unique.");
  assert.deepEqual(duplicateChannels, [], "Duplicate IPC registrations were detected.");
  assert.deepEqual(registrations, expectedChannels, "IPC registration order or membership changed.");

  const preloadPath = path.resolve(__dirname, "..", "preload.cjs");
  const preloadSource = readFileSync(preloadPath, "utf8");
  const invokeChannels = [...preloadSource.matchAll(/ipcRenderer\s*\.\s*invoke\s*\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);
  const progressChannels = [...preloadSource.matchAll(/ipcRenderer\s*\.\s*on\s*\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);

  assert.equal(invokeChannels.length, 66, "preload must expose exactly 66 invoke calls.");
  assert.equal(new Set(invokeChannels).size, 66, "preload invoke channels must be unique.");
  assert.deepEqual(progressChannels, expectedProgressChannels, "preload progress listeners changed.");

  const publicRegistrations = registrations.filter((channel) => !internalChannels.has(channel));
  assert.equal(publicRegistrations.length, 66, "Exactly three registered channels must remain internal.");
  assert.deepEqual(
    sorted(publicRegistrations),
    sorted(invokeChannels),
    "Registered public IPC channels must match preload invokes."
  );
  await assertSettingsAccountBoundary();
  await assertBestEffortRemoteLogout();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    registeredChannels: registrations.length,
    preloadInvokeChannels: invokeChannels.length,
    internalChannels: [...internalChannels],
    progressChannels
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
