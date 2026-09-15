"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const {
  ACCESS_POLICY_FILENAME,
  ACCESS_VARIANT_DUAL,
  ACCESS_VARIANT_SPARKAPI,
  OFFICIAL_SPARKAPI_BASE_URL,
  WINDOWS_INSTALLER_ARCH,
  accessPolicyForVariant,
  applyAccessPolicyToSettings,
  buildAccessPolicy,
  loadDesktopAccessPolicy,
  normalizeAccessVariant,
  parseAccessPolicy,
  windowsCoreInstallerArtifactName,
  windowsInstallerArtifactName,
  windowsLegacyInstallerArtifactName
} = require(path.join(root, "runtime", "access-variant.cjs"));
const { registerServerIpc } = require(path.join(root, "desktop", "ipc", "server-ipc.cjs"));

assert.equal(normalizeAccessVariant("unrestricted"), ACCESS_VARIANT_DUAL);
assert.equal(normalizeAccessVariant("account-only"), ACCESS_VARIANT_SPARKAPI);
assert.equal(buildAccessPolicy({ SPARKAI_ACCOUNT_ONLY: "1" }).variant, ACCESS_VARIANT_SPARKAPI);
assert.equal(buildAccessPolicy({ SPARKAI_ACCOUNT_ONLY: "0" }).variant, ACCESS_VARIANT_DUAL);
assert.equal(buildAccessPolicy({ SPARKAI_ACCESS_VARIANT: "sparkapi-account", SPARKAI_ACCOUNT_ONLY: "0" }).variant, ACCESS_VARIANT_SPARKAPI);
assert.throws(() => buildAccessPolicy({ SPARKAI_ACCESS_VARIANT: "typo-would-be-unsafe" }), /Unsupported SPARKAI_ACCESS_VARIANT/);
assert.equal(parseAccessPolicy(accessPolicyForVariant(ACCESS_VARIANT_DUAL))?.variant, ACCESS_VARIANT_DUAL);
assert.equal(parseAccessPolicy({ ...accessPolicyForVariant(ACCESS_VARIANT_DUAL), customApiAccess: false }), null);
assert.equal(WINDOWS_INSTALLER_ARCH, "x64");
assert.equal(windowsInstallerArtifactName("1.2.3", ACCESS_VARIANT_DUAL), "SparkAI-WorkSpace-Unrestricted-Setup-1.2.3-x64.exe");
assert.equal(windowsInstallerArtifactName("1.2.3", ACCESS_VARIANT_SPARKAPI), "SparkAI-WorkSpace-SparkAPI-Setup-1.2.3-x64.exe");
assert.equal(windowsCoreInstallerArtifactName("1.2.3"), "naimage-Core-1.2.3-x64.exe");
assert.equal(windowsLegacyInstallerArtifactName("1.2.3"), "naimage-Setup-1.2.3-x64.exe");
assert.throws(() => windowsInstallerArtifactName("../unsafe", ACCESS_VARIANT_DUAL), /Invalid Windows installer version/);

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "sparkai-access-policy-"));
try {
  mkdirSync(path.join(temporaryRoot, "dist"), { recursive: true });
  writeFileSync(
    path.join(temporaryRoot, "dist", ACCESS_POLICY_FILENAME),
    JSON.stringify(accessPolicyForVariant(ACCESS_VARIANT_DUAL)),
    "utf8"
  );
  assert.equal(loadDesktopAccessPolicy({ projectRoot: temporaryRoot, manifestRequired: true }).variant, ACCESS_VARIANT_DUAL);
  writeFileSync(path.join(temporaryRoot, "dist", ACCESS_POLICY_FILENAME), "{}", "utf8");
  assert.equal(loadDesktopAccessPolicy({ projectRoot: temporaryRoot, manifestRequired: true }).variant, ACCESS_VARIANT_SPARKAPI);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

const locked = applyAccessPolicyToSettings({
  accessMode: "custom",
  accountBaseUrl: "https://another-relay.example",
  relayBaseUrl: "https://relay.example",
  updateBaseUrl: "https://updates.example",
  serverAuthProtocol: "bundle",
  serverAccessToken: "access-must-not-cross-origins",
  serverAccessExpiresAt: 123456,
  serverSessionCookie: "new_api_refresh=must-not-cross-origins",
  serverAuthSessionId: "sid-must-not-cross-origins",
  serverUserId: "7",
  selectedAccountTokenId: "12",
  agentBaseUrl: "https://custom.example/v1",
  agentApiKey: "preserved-but-inactive"
}, accessPolicyForVariant(ACCESS_VARIANT_SPARKAPI));
assert.equal(locked.accessMode, "account");
assert.equal(locked.accountBaseUrl, OFFICIAL_SPARKAPI_BASE_URL);
assert.equal(locked.relayBaseUrl, "");
assert.equal(locked.updateBaseUrl, OFFICIAL_SPARKAPI_BASE_URL);
assert.equal(locked.serverAuthProtocol, "");
assert.equal(locked.serverAccessToken, "");
assert.equal(locked.serverAccessExpiresAt, 0);
assert.equal(locked.serverSessionCookie, "");
assert.equal(locked.serverAuthSessionId, "");
assert.equal(locked.selectedAccountTokenId, "");
assert.equal(locked.agentBaseUrl, "https://custom.example/v1", "Inactive custom credentials should survive switching between the two official builds");

const officialSession = applyAccessPolicyToSettings({
  accessMode: "custom",
  accountBaseUrl: OFFICIAL_SPARKAPI_BASE_URL,
  serverAuthProtocol: "bundle",
  serverAccessToken: "access-official",
  serverAccessExpiresAt: 654321,
  serverSessionCookie: "new_api_refresh=official",
  serverAuthSessionId: "sid-official",
  serverUserId: "8"
}, accessPolicyForVariant(ACCESS_VARIANT_SPARKAPI));
assert.equal(officialSession.serverAuthProtocol, "bundle");
assert.equal(officialSession.serverAccessToken, "access-official");
assert.equal(officialSession.serverAccessExpiresAt, 654321);
assert.equal(officialSession.serverSessionCookie, "new_api_refresh=official", "An existing SparkAPI session should survive installing the account-only build");
assert.equal(officialSession.serverAuthSessionId, "sid-official");

const handlers = new Map();
registerServerIpc({
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  accessPolicy: accessPolicyForVariant(ACCESS_VARIANT_SPARKAPI)
});
Promise.resolve(handlers.get("naimage:server:configure-custom")({}, {
  baseUrl: "https://bypass.example/v1",
  apiKey: "sk-bypass"
})).then(async (result) => {
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "CUSTOM_API_ACCESS_DISABLED");

  let customSettingsWrites = 0;
  const unrestrictedHandlers = new Map();
  registerServerIpc({
    ipcMain: { handle: (channel, handler) => unrestrictedHandlers.set(channel, handler) },
    accessPolicy: accessPolicyForVariant(ACCESS_VARIANT_DUAL),
    defaultSettings: { accessMode: "account" },
    migrateSettings: (settings) => ({ ...settings }),
    readJson: () => ({ accessMode: "account" }),
    writeJson: () => { customSettingsWrites += 1; },
    settingsPath: "memory://settings.json",
    log: () => {},
    licenseService: {
      async requireActive(options) {
        assert.deepEqual(options, { scope: "custom" });
        const error = new Error("Pro License required");
        error.code = "NAIMAGE_PRO_LICENSE_REQUIRED";
        throw error;
      }
    }
  });
  const unlicensedCustom = await unrestrictedHandlers.get("naimage:server:configure-custom")({}, {
    baseUrl: "https://private.example/v1",
    apiKey: "sk-private"
  });
  assert.equal(unlicensedCustom.ok, false);
  assert.equal(unlicensedCustom.errorCode, "NAIMAGE_PRO_LICENSE_REQUIRED");
  assert.equal(customSettingsWrites, 0, "Unlicensed custom credentials must not be persisted before server-side License verification");

  const viteSource = readFileSync(path.join(root, "vite.config.ts"), "utf8");
  const mainSource = readFileSync(path.join(root, "electron-main.cjs"), "utf8");
  const authSource = readFileSync(path.join(root, "src", "auth-gate.tsx"), "utf8");
  const settingsSource = readFileSync(path.join(root, "src", "settings-drawer.tsx"), "utf8");
  const buildSource = readFileSync(path.join(root, "scripts", "release", "build-access-variants.mjs"), "utf8");
  const windowsBuildSource = readFileSync(path.join(root, "scripts", "release", "build-windows.mjs"), "utf8");
  const installerProjectSource = readFileSync(path.join(root, "tools", "windows-installer", "Installer", "naimage.Studio.Installer.csproj"), "utf8");
  const uninstallerProjectSource = readFileSync(path.join(root, "tools", "windows-installer", "Uninstaller", "naimage.Studio.Uninstaller.csproj"), "utf8");
  const packageMetadata = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(viteSource, /__SPARKAI_ACCESS_POLICY__/);
  assert.match(viteSource, /ACCESS_POLICY_FILENAME/);
  assert.match(mainSource, /applyAccessPolicyToSettings\(next, accessPolicy\)/);
  assert.match(authSource, /appAccessPolicy\.customApiAccess/);
  assert.match(authSource, /customNeedsActivation/);
  assert.doesNotMatch(authSource, /accountNeedsActivation/, "Account login must not be coupled to device License activation");
  assert.match(settingsSource, /accountBaseUrlLocked/);
  assert.match(readFileSync(path.join(root, "src", "model-config-dialog.tsx"), "utf8"), /自定义 API Key（可选）/, "The account-only build must retain per-model custom API Keys after login");
  assert.match(buildSource, /windowsInstallerArtifactName/);
  assert.match(buildSource, /windowsLegacyInstallerArtifactName/);
  assert.doesNotMatch(buildSource, /renameSync|naimage-Setup-/);
  assert.match(windowsBuildSource, /windowsInstallerArtifactName/);
  assert.match(windowsBuildSource, /windowsLegacyInstallerArtifactName/);
  assert.doesNotMatch(windowsBuildSource, /naimage-Setup-/);
  assert.match(windowsBuildSource, /function resolveWorkspaceDotnet\(/, "Windows packaging must locate the workspace .NET SDK instead of PATH");
  assert.match(windowsBuildSource, /join\(workspaceRoot, "\.tools"\)/, "Windows packaging must prefer the portable workspace tool root");
  assert.match(windowsBuildSource, /join\(toolRoot, "dotnet"/, "Windows packaging must prefer the portable .tools/dotnet SDK");
  assert.match(windowsBuildSource, /DOTNET_MULTILEVEL_LOOKUP/, "Windows packaging must disable mixed system/.NET SDK lookup");
  assert.match(installerProjectSource, /<AssemblyName>SparkAI WorkSpace Installer<\/AssemblyName>/);
  assert.match(uninstallerProjectSource, /<AssemblyName>SparkAI WorkSpace Uninstaller<\/AssemblyName>/);
  assert.equal(packageMetadata.build.win.artifactName, "naimage-Core-${version}-${arch}.${ext}");
  for (const documentationPath of ["README.md", path.join("docs", "INSTALLATION.md"), path.join("docs", "BRANDED_INSTALLER_ARCHITECTURE.md")]) {
    assert.doesNotMatch(readFileSync(path.join(root, documentationPath), "utf8"), /naimage-Setup-<version>|release\/naimage-Setup/);
  }
  console.log("access variant selftest passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
