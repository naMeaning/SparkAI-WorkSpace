"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { registerDesktopIpc } = require("../desktop/ipc/register-desktop-ipc.cjs");
const { registerSettingsIpc } = require("../desktop/ipc/config-ipc.cjs");
const { registerServerIpc } = require("../desktop/ipc/server-ipc.cjs");

const expectedUpdaterChannels = [
  "iiimage:update:status",
  "iiimage:update:renderer-ready",
  "iiimage:update:check",
  "iiimage:update:installer-captcha",
  "iiimage:update:download-restart",
  "iiimage:update:download-installer",
  "iiimage:update:apply-restart",
  "iiimage:update:launch-installer"
];

const expectedChannels = [
  "iiimage:config:load-settings",
  "iiimage:config:save-settings",
  ...expectedUpdaterChannels,
  "iiimage:config:load-session",
  "iiimage:config:save-session",
  "iiimage:agent:tools",
  "iiimage:agent:list-models",
  "iiimage:agent:run-tool",
  "iiimage:agent:compose-image-prompt",
  "iiimage:agent:chat",
  "iiimage:agent:compact",
  "iiimage:agent:memory-check",
  "iiimage:agent:memory-read",
  "iiimage:agent:main-prompt:get",
  "iiimage:agent:main-prompt:save",
  "iiimage:agent:main-prompt:reset",
  "iiimage:agent:fast-memory:get",
  "iiimage:agent:fast-memory:save",
  "iiimage:agent:fast-memory:reset",
  "iiimage:agent:clear-conversation",
  "iiimage:agent:smoke",
  "iiimage:agent:cancel-pending-execution",
  "iiimage:window:new",
  "iiimage:window:control",
  "iiimage:debug:window-bounds",
  "iiimage:debug:capture-gui",
  "iiimage:project:list",
  "iiimage:project:create",
  "iiimage:project:create-folder",
  "iiimage:project:switch",
  "iiimage:project:rename",
  "iiimage:project:open",
  "iiimage:project:export",
  "iiimage:project:import",
  "iiimage:project:open-current-folder",
  "iiimage:project:delete",
  "iiimage:project:delete-folder",
  "iiimage:asset:pick-local-images",
  "iiimage:asset:pick-reference-images",
  "iiimage:asset:pick-reference-image",
  "iiimage:asset:open-folder",
  "iiimage:asset:read-data-url",
  "iiimage:asset:refine-semantic-layers",
  "iiimage:asset:isolate-background",
  "iiimage:asset:thumbnail-stats",
  "iiimage:asset:image-import-status",
  "iiimage:asset:cancel-image-imports",
  "iiimage:asset:import-local-images",
  "iiimage:asset:import-local-image",
  "iiimage:asset:save-output-image",
  "iiimage:asset:save-as",
  "iiimage:asset:export-folder",
  "iiimage:asset:export-psd",
  "iiimage:asset:export-layer-psd",
  "iiimage:server:register",
  "iiimage:server:login",
  "iiimage:server:logout",
  "iiimage:server:me",
  "iiimage:server:logs",
  "iiimage:server:models",
  "iiimage:server:recharge",
  "iiimage:server:generate-image"
];

const internalChannels = new Set([
  "iiimage:agent:compact",
  "iiimage:agent:memory-check",
  "iiimage:agent:memory-read"
]);
const expectedProgressChannels = [
  "iiimage:update:progress",
  "iiimage:agent:progress"
];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function assertSettingsAccountBoundary() {
  const handlers = new Map();
  const defaults = {
    accountBaseUrl: "https://sparkapi.org",
    relayBaseUrl: "",
    updateBaseUrl: "https://image.aieyra.cn",
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
  const save = handlers.get("iiimage:config:save-settings");
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
  const logout = handlers.get("iiimage:server:logout");
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
