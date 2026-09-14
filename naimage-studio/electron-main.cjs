const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeImage, net, protocol, safeStorage, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const { closeSync, constants: fsConstants, copyFileSync, createReadStream, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const { createServer: createNetServer } = require("node:net");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { setTimeout: delay } = require("node:timers/promises");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { createAgentRuntime } = require("./agent-runtime.cjs");
const { exportLayeredPsd, preparePsdRasterSource } = require("./psd-export.cjs");
const { createThumbnailCache } = require("./thumbnail-cache.cjs");
const { createImageImporter, ImageImportError, DEFAULT_MAX_FILES: maxImportedImageFiles } = require("./image-import.cjs");
const { importVideoFiles, DEFAULT_MAX_FILES: maxImportedVideoFiles } = require("./desktop/video-import.cjs");
const { createVideoTaskService } = require("./desktop/video-task-service.cjs");
const { refineSemanticLayers } = require("./semantic-matting.cjs");
const { createAidebugBackend } = require("./desktop/aidebug-backend.cjs");
const { aidebugImageBase64, aidebugLayerFixtureHint } = require("./desktop/aidebug-image-fixture.cjs");
const { createNewApiClient } = require("./desktop/new-api-client.cjs");
const { createNewApiTransport } = require("./desktop/new-api-transport.cjs");
const { createLicenseService } = require("./desktop/license-service.cjs");
const { createProjectAssetRepository } = require("./desktop/project-asset-repository.cjs");
const {
  createProjectPackageService,
  projectPackageMaximumAssetBytes,
  projectPackageMaximumAssets,
  projectPackageMaximumDecodedBytes,
  projectPackageMaximumFileBytes
} = require("./desktop/project-package-service.cjs");
const { createProjectSaveCoordinator, normalizeSessionRevision } = require("./desktop/project-save-coordinator.cjs");
const {
  hydrateSessionAssets,
  safeImageSourceRelativePath,
  sanitizeSession,
  sessionAssetContentHash,
  sessionHasContent
} = require("./desktop/project-session-normalizer.cjs");
const { createProjectStore } = require("./desktop/project-store.cjs");
const { createProjectDataMigrationService } = require("./desktop/project-data-migration.cjs");
const {
  createProjectCommerceCatalogService,
  sanitizeCommerceCatalogDocument
} = require("./desktop/project-commerce-catalog.cjs");
const { createProjectCommerceExportService } = require("./desktop/project-commerce-export.cjs");
const { createProjectSocialExportService } = require("./desktop/project-social-export.cjs");
const { createImageCollectionExportService } = require("./desktop/image-collection-export-service.cjs");
const { createExportCenterStateService } = require("./desktop/export-center-state-service.cjs");
const { createScientificRunnerService } = require("./desktop/scientific-runner-service.cjs");
const { createRequirementLibraryService } = require("./desktop/requirement-library.cjs");
const { createCommerceTemplateLibraryService } = require("./desktop/commerce-template-library.cjs");
const {
  createGlassBackgroundService,
  defaultGlassBackgroundSettings,
  normalizeGlassBackgroundSettings
} = require("./desktop/glass-background-service.cjs");
const {
  createPublicHttpDownloadAdmission,
  requestPublicHttpTarget,
  resolvePublicHttpTarget
} = require("./desktop/public-http-resource.cjs");
const { loadRecordedRemoteAssetProxy } = require("./desktop/remote-asset-proxy.cjs");
const { createDesktopUpdaterService } = require("./desktop/updater-service.cjs");
const { registerDesktopIpc } = require("./desktop/ipc/register-desktop-ipc.cjs");
const { createAutomationService } = require("./desktop/automation-service.cjs");
const { createDebugCommandService } = require("./desktop/debug-command-service.cjs");
const { createAgentIntegrationService } = require("./desktop/agent-integration-service.cjs");
const { createAgentWindowService } = require("./desktop/agent-window-service.cjs");
const { createAgentRunControl, createAbortError } = require("./desktop/agent-run-control.cjs");
const { createGoalProbeAdmission } = require("./runtime/goal-probe-admission.cjs");
const { detectEncodedImageFormat, normalizeEncodedImageFormat, requireEncodedImageFormat } = require("./runtime/encoded-image-format.cjs");
const { imagePromptRatios, normalizeImagePromptResolution, parseImageSizeValue } = require("./runtime/image-frame.cjs");
const {
  buildImageAssetGenerationMetadata,
  mergeImageGenerationResponseMetadata,
  normalizeImageGenerationParameters,
  pickImageGenerationResponseMetadata
} = require("./runtime/image-generation-metadata.cjs");
const { applyAccessPolicyToSettings, loadDesktopAccessPolicy } = require("./runtime/access-variant.cjs");
const {
  defaultGlassAppearance,
  nativeWindowBackgroundColor,
  normalizeGlassThemeSettings: normalizeElectronGlassThemeSettings
} = require("./runtime/glass-theme-settings.cjs");
const { createAccountTokenService } = require("./desktop/account-token-service.cjs");
const {
  defaultWorkspacePluginStates,
  normalizeCanvasToolShortcuts,
  normalizePluginStates,
  WORKSPACE_PLUGIN_DEFAULTS_VERSION
} = require("./desktop/plugin-state.cjs");
const { parseProjectGraphFile } = require("./desktop/project-graph-adapter.cjs");
const { createThemePresetService, normalizeCustomThemePreset } = require("./desktop/theme-preset-service.cjs");
const { createSettingsSecretStore } = require("./desktop/settings-secret-store.cjs");
const { composePluginTask, projectGraphTask } = require("./desktop/plugin-task-prompts.cjs");
const sharp = require("sharp");
const {
  cachedModelSettings,
  createModelAccessProfile,
  createModelCacheKey,
  modelBindingCacheFingerprint,
  markModelAccessProfilesVerified,
  mergeModelCapabilities,
  mergeModelAccessProfiles,
  modelCapabilitiesFromResponse,
  modelGroupsFromResponse,
  modelIdsFromResponse,
  preferredAgentModelFromList,
  preferredImageModelFromList,
  preferredVideoModelFromList,
  preserveRuntimeVerifiedModelAccessProfiles,
  splitModelSettings
} = require("./desktop/model-catalog.cjs");
const {
  agentModelUsesResponsesApi,
  responsesContentPartFromChat,
  responsesInputFromChatMessages,
  responsesInputItemFromOutput,
  responsesRequestFromChatRequest,
  responsesToolChoiceFromChat,
  responsesToolsFromChatTools
} = require("./desktop/agent-responses-adapter.cjs");
const packageMetadata = require("./package.json");

const agentRunControl = createAgentRunControl({
  onChange() {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("naimage:agent:run-state", agentRunControl.snapshot("", String(window.webContents.id)));
      }
    }
  }
});
const goalProbeAdmission = createGoalProbeAdmission();
const remoteImageDownloads = createPublicHttpDownloadAdmission({ maxConcurrent: 2, maxQueued: 256 });

function getDesktopVersion() {
  return String((app.isPackaged ? app.getVersion() : packageMetadata.version) || "0.0.0");
}

const applicationName = "SparkAI WorkSpace";
const internalApplicationName = "naimage";
const applicationId = "org.sparkai.naimage";
const legacyApplicationNames = ["iiimage Studio", "IIimage Studio", "iiimage-studio"];
const legacyUserDataMigrationMarker = ".naimage-user-data-migration-v1.json";
const localAssetSchemes = ["naimage-asset", "iiimage-asset"];

function desktopEnvironment(name) {
  return process.env[name];
}

function copyLegacyUserDataEntry(sourcePath, targetPath, counters) {
  if (!existsSync(sourcePath)) return;
  const sourceStats = lstatSync(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    counters.skippedSymlinks += 1;
    return;
  }
  if (sourceStats.isDirectory()) {
    if (existsSync(targetPath) && !lstatSync(targetPath).isDirectory()) {
      counters.skippedExisting += 1;
      return;
    }
    mkdirSync(targetPath, { recursive: true });
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      copyLegacyUserDataEntry(path.join(sourcePath, entry.name), path.join(targetPath, entry.name), counters);
    }
    return;
  }
  if (!sourceStats.isFile() || existsSync(targetPath)) {
    counters.skippedExisting += 1;
    return;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    copyFileSync(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
    counters.copiedFiles += 1;
  } catch (error) {
    if (error?.code === "EEXIST") {
      counters.skippedExisting += 1;
      return;
    }
    throw error;
  }
}

function migrateLegacyUserData(options = {}) {
  if (typeof options.targetRoot !== "string" || !options.targetRoot.trim()) {
    throw new TypeError("A canonical naimage userData target is required.");
  }
  const targetRoot = path.resolve(options.targetRoot);
  const markerPath = path.join(targetRoot, options.markerName || legacyUserDataMigrationMarker);
  if (existsSync(markerPath)) return { status: "already-complete", markerPath, copiedFiles: 0, skippedExisting: 0, skippedSymlinks: 0 };
  const comparable = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const seen = new Set();
  const legacyRoots = (Array.isArray(options.legacyRoots) ? options.legacyRoots : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => path.resolve(value))
    .filter((value) => {
      const key = comparable(value);
      if (!value || key === comparable(targetRoot) || seen.has(key)) return false;
      seen.add(key);
      if (!existsSync(value)) return false;
      const stats = lstatSync(value);
      return stats.isDirectory() && !stats.isSymbolicLink();
    });
  if (!legacyRoots.length) return { status: "not-found", markerPath, copiedFiles: 0, skippedExisting: 0, skippedSymlinks: 0 };

  const counters = { copiedFiles: 0, skippedExisting: 0, skippedSymlinks: 0 };
  const ownedEntries = Array.isArray(options.ownedEntries) && options.ownedEntries.length
    ? options.ownedEntries
    : ["data", "workspace", "Local Storage"];
  for (const legacyRoot of legacyRoots) {
    for (const entryName of ownedEntries) {
      copyLegacyUserDataEntry(path.join(legacyRoot, entryName), path.join(targetRoot, entryName), counters);
    }
  }
  mkdirSync(targetRoot, { recursive: true });
  try {
    writeFileSync(markerPath, `${JSON.stringify({
      version: 1,
      migratedAt: new Date().toISOString(),
      sources: legacyRoots,
      ownedEntries,
      ...counters
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return { status: "migrated", markerPath, ...counters };
}
const windowsCurlPath = process.platform === "win32"
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe")
  : "";
const canonicalUserDataPath = path.join(app.getPath("appData"), internalApplicationName);
const explicitUserDataPath = String(app.commandLine.getSwitchValue("user-data-dir") || "").trim();
const resolvedExplicitUserDataPath = explicitUserDataPath ? path.resolve(explicitUserDataPath) : "";
app.setName(applicationName);
app.setPath("userData", resolvedExplicitUserDataPath || canonicalUserDataPath);

const devUrl = desktopEnvironment("NAIMAGE_DEV_URL") || "";
const rendererIndexOverride = desktopEnvironment("NAIMAGE_RENDERER_INDEX");
const rendererIndex = rendererIndexOverride
  ? path.resolve(rendererIndexOverride)
  : path.join(__dirname, "dist", "index.html");
const agentWindowHtml = path.join(__dirname, "agent-window.html");
const agentWindowPreload = path.join(__dirname, "agent-window-preload.cjs");
const projectRoot = __dirname;
const accessPolicy = loadDesktopAccessPolicy({
  projectRoot,
  preferManifest: app.isPackaged || !rendererIndexOverride,
  manifestRequired: app.isPackaged,
  environment: process.env
});
const workspaceRoot = path.resolve(projectRoot, "..");
const desktopRoot = path.join(process.env.USERPROFILE || projectRoot, "Desktop");
const localServerEntryCandidates = [
  desktopEnvironment("NAIMAGE_LOCAL_SERVER_ENTRY")
    ? path.resolve(desktopEnvironment("NAIMAGE_LOCAL_SERVER_ENTRY"))
    : "",
  path.join(projectRoot, "services", "ai-gateway", "server.cjs"),
  path.join(workspaceRoot, "sparkai-extension", "services", "ai-gateway", "server.cjs")
].filter(Boolean);
const localServerEntry = localServerEntryCandidates.find((candidate) => existsSync(candidate)) || localServerEntryCandidates[0];
const localServerRoot = path.dirname(localServerEntry);
const aidebugMode = desktopEnvironment("NAIMAGE_AIDEBUG") === "1";
const performanceGateMode = desktopEnvironment("NAIMAGE_PERFORMANCE_GATE") === "1";
if (aidebugMode && !performanceGateMode) app.disableHardwareAcceleration();
const aidebugLiveImage = desktopEnvironment("NAIMAGE_AIDEBUG_LIVE_IMAGE") === "1";
const aidebugStatefulAuth = desktopEnvironment("NAIMAGE_AIDEBUG_AUTH_SESSION") === "1";
const aidebugMockAgent =
  desktopEnvironment("NAIMAGE_AIDEBUG_MOCK_AGENT") === "1" ||
  /^(mock|stub|fixture)$/i.test(String(desktopEnvironment("NAIMAGE_AIDEBUG_AGENT_MODE") || ""));
const aidebugImageFaultsEnabled =
  aidebugMode &&
  !aidebugLiveImage &&
  desktopEnvironment("NAIMAGE_AIDEBUG_IMAGE_FAULTS") === "1";
const aidebugStopFixtureMode = aidebugMode
  ? String(desktopEnvironment("NAIMAGE_AIDEBUG_AGENT_STOP_FIXTURE") || "").trim().toLowerCase()
  : "";
const aidebugStopFixtureDelayMs = Math.min(
  10_000,
  Math.max(0, Number(desktopEnvironment("NAIMAGE_AIDEBUG_AGENT_STOP_DELAY_MS")) || 0)
);
let aidebugStopFixtureAttempts = 0;
const aidebugAgentStopFixture = aidebugStopFixtureMode === "fail-once"
  ? async ({ invokeStop }) => {
      aidebugStopFixtureAttempts += 1;
      if (aidebugStopFixtureDelayMs > 0) await delay(aidebugStopFixtureDelayMs);
      if (aidebugStopFixtureAttempts === 1) {
        return { ok: false, error: "AIDebug 注入的结束失败：底层暂未确认停止。" };
      }
      return invokeStop();
    }
  : null;
const agentModelForceEnabled = false;
const agentToolChoiceForceEnabled = false;
const agentToolArgCorrectionEnabled = false;
// A packaged ASAR is read-only. Keep user sessions, projects, FastMemory,
// caches and logs in Electron's per-user application directory while retaining
// the repository-local layout during development and isolated AIDebug runs.
const packagedDataRoot = app.isPackaged ? app.getPath("userData") : projectRoot;
const legacyPackagedDataRoots = app.isPackaged
  ? legacyApplicationNames.map((name) => path.join(app.getPath("appData"), name))
  : [];
const configDirOverride = desktopEnvironment("NAIMAGE_CONFIG_DIR");
const configDir = configDirOverride
  ? path.resolve(configDirOverride)
  : app.isPackaged || resolvedExplicitUserDataPath
    ? path.join(app.getPath("userData"), "data")
    : path.join(projectRoot, "config");
const aidebugIsolationRootOverride = String(desktopEnvironment("NAIMAGE_AIDEBUG_ISOLATION_ROOT") || "").trim();
const aidebugIsolationRoot = aidebugIsolationRootOverride
  ? path.resolve(aidebugIsolationRootOverride)
  : resolvedExplicitUserDataPath
    ? configDirOverride
      ? path.dirname(resolvedExplicitUserDataPath)
      : resolvedExplicitUserDataPath
    : "";
const aidebugConfigIsolated = (() => {
  if (!aidebugMode || !resolvedExplicitUserDataPath || !aidebugIsolationRoot) return false;
  const resolvedConfigDir = realPathIfPresent(configDir);
  const resolvedIsolationRoot = realPathIfPresent(aidebugIsolationRoot);
  const resolvedUserDataDir = realPathIfPresent(resolvedExplicitUserDataPath);
  const resolvedRepositoryConfig = realPathIfPresent(path.join(projectRoot, "config"));
  const resolvedCanonicalUserData = realPathIfPresent(canonicalUserDataPath);
  if (isComparablePathInside(resolvedConfigDir, resolvedRepositoryConfig)) return false;
  if (isComparablePathInside(resolvedConfigDir, resolvedCanonicalUserData)) return false;
  if (isComparablePathInside(resolvedUserDataDir, resolvedCanonicalUserData)) return false;
  return isComparablePathInside(resolvedConfigDir, resolvedIsolationRoot);
})();
if (aidebugMode && !aidebugConfigIsolated) {
  process.stderr.write(
    "AIDebug refused to start without an isolated --user-data-dir and config directory. " +
    "Use the repository AIDebug CLI so tests cannot modify real projects.\n"
  );
  process.exit(1);
}
const aidebugRendererArguments = aidebugConfigIsolated
  ? ["--naimage-aidebug-enabled=1", "--naimage-aidebug-isolated-config=1"]
  : [];
const agentWorkspaceRoot = app.isPackaged ? path.join(packagedDataRoot, "workspace") : projectRoot;
const debugDirOverride = desktopEnvironment("NAIMAGE_DEBUG_DIR");
const debugDir = debugDirOverride
  ? path.resolve(debugDirOverride)
  : app.isPackaged
    ? path.join(app.getPath("logs"), "runtime")
    : path.join(projectRoot, ".diagnostics", "electron");
const electronLogOverride = desktopEnvironment("NAIMAGE_ELECTRON_LOG");
const electronLog = electronLogOverride
  ? path.resolve(electronLogOverride)
  : path.join(debugDir, "latest.log");
const settingsPath = path.join(configDir, "app-settings.json");
const settingsSecretsPath = path.join(configDir, "app-settings.secrets.json");
const requirementLibraryPath = path.join(configDir, "requirement-library.json");
const commerceTemplateLibraryPath = path.join(configDir, "commerce-template-library.json");
const sessionPath = path.join(configDir, "session.json");
const modelCachePath = path.join(configDir, "model-cache.json");
const accountTokenCachePath = path.join(configDir, "account-token-cache.json");
const projectListPath = path.join(configDir, "project-list.json");
const projectsDir = path.join(configDir, "projects");
const referencesDir = path.join(configDir, "references");
const glassBackgroundAssetsDir = path.join(configDir, "glass-backgrounds");
const settingsSecretStore = createSettingsSecretStore({
  safeStorage,
  secretsPath: settingsSecretsPath,
  log: (message) => log(message)
});
const projectMetaDirName = ".naimage";
const legacyProjectMetaDirNames = [".iiimage"];
const projectManifestFileName = "project.json";
const exportSessionFileName = "start.naimage";
const legacyExportSessionFileNames = ["start.iiimage"];
const maxExportImageBytes = 128 * 1024 * 1024;
const projectIoSelftestMode = desktopEnvironment("NAIMAGE_PROJECT_IO_SELFTEST") === "1";
const agentProtocolSelftestMode = desktopEnvironment("NAIMAGE_AGENT_PROTOCOL_SELFTEST") === "1";
const lifecycleSelftestMode = desktopEnvironment("NAIMAGE_LIFECYCLE_SELFTEST") === "1";
let localServerProcess = null;
let localServerMonitor = null;
let localServerEnsurePromise = null;
let agentRuntime = null;
let quitting = false;
let applicationShutdownPromise = null;
let applicationShutdownComplete = false;
let applicationShutdownStartedAt = 0;
const bootStartedAt = Date.now();
const newApiQuotaPerUnit = 500000;
const newApiUserLogsEndpoint = "/api/log/self?p=1&page_size=20";
const modelCacheTtlMs = 60_000;
const modelCacheMemory = new Map();
const modelCacheInflight = new Map();
let modelCacheDiskLoaded = false;
let newApiAuthEpoch = 0;
const managedImageIdempotencyPrefix = "naimage-";
const maximumConcurrentImageEditRequests = 10;
let activeImageEditRequests = 0;
const queuedImageEditRequests = [];

// Frameless Windows still loses roughly 12-16 px between the outer BrowserWindow
// width and renderer viewport. Keep at least the canonical 884 px workbench
// available to the canvas + fixed Agent panel.
// Production keeps the desktop workspace usable at its supported minimum.
// AIDebug deliberately exercises the responsive 540px layout in an isolated
// user-data directory, so its BrowserWindow must not clamp those captures.
const minWindowWidth = aidebugMode ? 540 : 884;
const minWindowHeight = 640;
const useCustomWindowFrame = process.platform !== "darwin";
const windowIconDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABA0lEQVR4nO3bsQ3CMBCF4cxARcEAiDkoqLIKLfMxAgMwBgUNKEiRkpNjB5Fw57s/0muiFH6fHBcnuWnEs7ucX54j+4YpnoXoXmzaU6iMEEID9FtCe0EaAB8EAAAAAAAAAABAfUEAAAAAAADUBHB/PkwFAC2A7WGvGgAAAAAA0wDH23WUUACy/BoIAAAAgF2AFMKS5asAWDsAAGAAYOqwm5NfirsA+BZhOANwAzAXQQ5BXAGUEFJTIHcAKYTcGMwlwBAhV77/ziVAl1J59wBTCHKnuAaQCKlfxT1A6axQB7ASAP4NUHsAAAAAAAAAAAAAAAAAAABiA4S/OAkAl6dj3SKXfd9DLus2WiDC0gAAAABJRU5ErkJggg==";

function createWindowIcon() {
  const iconPath = [
    path.join(projectRoot, "public", "naimage.png"),
    path.join(projectRoot, "dist", "naimage.png")
  ].find((candidate) => existsSync(candidate));
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createFromDataURL(windowIconDataUrl);
  return icon.isEmpty() ? undefined : icon;
}

protocol.registerSchemesAsPrivileged(localAssetSchemes.map((scheme) => ({
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  })));

const defaultSettings = {
  accessMode: "account",
  agentProvider: "CODEX",
  agentBaseUrl: "",
  agentApiKey: "",
  agentModel: "gpt-5.6-terra",
  agentModelPool: ["gpt-5.6-terra"],
  agentModelBindings: [],
  compactModel: "",
  contextStrategy: "auto",
  contextWindowTokens: 272_000,
  contextEffectiveWindowPercent: 95,
  contextAutoCompactPercent: 90,
  contextRetainedUserTokens: 20_000,
  reasoningEffort: "low",
  fastMode: false,
  timeoutSeconds: 180,
  imageBaseUrl: "",
  imageApiKey: "",
  imageModel: "gpt-image-2",
  imageModelPool: ["gpt-image-2"],
  imageModelBindings: [],
  videoModel: "doubao-seedance-2-0-260128",
  videoModelPool: ["doubao-seedance-2-0-260128"],
  imageCount: 1,
  imageBatchSize: 3,
  imageRatio: "1:1",
  imageResolution: "1K",
  imageSize: "1024x1024",
  imageQuality: "auto",
  accountBaseUrl: "https://sparkapi.org",
  relayBaseUrl: "",
  updateBaseUrl: "https://sparkapi.org",
  networkProxyUrl: "",
  serverToken: "",
  serverAuthProtocol: "",
  serverAccessToken: "",
  serverAccessExpiresAt: 0,
  serverSessionCookie: "",
  serverAuthSessionId: "",
  serverUserId: "",
  selectedAccountTokenId: "",
  selectedAccountTokenName: "",
  selectedAccountTokenGroup: "",
  licenseDeviceId: "",
  licenseToken: "",
  licensePlan: "",
  licenseExpiresAt: 0,
  licenseLastVerifiedAt: 0,
  modelGroup: "",
  theme: "dark",
  themePalette: "anthropic",
  customTheme: null,
  ...defaultGlassAppearance,
  ...defaultGlassBackgroundSettings,
  agentPanelPlacement: "right",
  agentPanelWidth: 390,
  agentPanelHeight: 680,
  agentPanelX: 56,
  agentPanelY: 56,
  agentSkillAutoInstallTargets: [],
  workspacePluginDefaultsVersion: WORKSPACE_PLUGIN_DEFAULTS_VERSION,
  pluginStates: defaultWorkspacePluginStates(),
  canvasToolDockMode: "expanded",
  disabledCanvasToolCommands: [],
  canvasToolShortcuts: {},
  visibleWorkspaceAssetRailTabs: ["results", "layers", "requirements", "templates", "history"],
  workflowOnboarding: {}
};

const themePaletteValues = new Set([
  "default",
  "anthropic",
  "simple-large",
  "underground",
  "rose-garden",
  "lake-view",
  "sunset-glow",
  "forest-whisper",
  "ocean-breeze",
  "lavender-dream",
  "custom"
]);

const aidebugPublicSettings = {
  imageCostCents: 30,
  imageCostYuan: 0.3,
  trialImages: 10,
  imageModel: "gpt-image-2",
  videoModel: "doubao-seedance-2-0-260128",
  models: [
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.6",
    "gpt-5.6-codex",
    "gpt-5.5",
    "gpt-5.5-mini",
    "gpt-5-codex",
    "gpt-5.4",
    "gpt-5.3",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o4-mini",
    "o3",
    "deepseek-v3.2",
    "deepseek-r1",
    "glm-4.6",
    "doubao-seed-1.8",
    "gpt-image-2",
    "gpt-image-1.5",
    "gpt-image-1",
    "flux-1.1-pro",
    "imagen-4",
    "doubao-seedance-2-0-260128"
  ],
  imageModels: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "flux-1.1-pro", "imagen-4"],
  videoModels: ["doubao-seedance-2-0-260128"],
  agentModels: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6", "gpt-5.6-codex", "gpt-5.5", "gpt-5.5-mini", "gpt-5-codex", "gpt-5.4", "gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3", "deepseek-v3.2", "deepseek-r1", "glm-4.6", "doubao-seed-1.8"],
  channelName: "AIDebug",
  serviceReady: true,
  keyManaged: true
};

const legacyLocalServerUrls = new Set([
  "http://127.0.0.1:17860",
  "http://localhost:17860",
  "http://[::1]:17860"
]);

// The retired AIEYRA update host must never remain active after settings
// migration. Custom update hosts are still allowed for self-hosted gateways.
const retiredUpdateServiceUrls = new Set([
  "https://image.aieyra.cn"
]);

function normalizeStoredServerUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function isLegacyLocalServerUrl(value) {
  return legacyLocalServerUrls.has(normalizeStoredServerUrl(value).toLowerCase());
}

function isRetiredUpdateServiceUrl(value) {
  return retiredUpdateServiceUrls.has(normalizeStoredServerUrl(value).toLowerCase());
}

function aidebugSettings() {
  return {
    ...defaultSettings,
    serverToken: "aidebug-token",
    serverAuthProtocol: "legacy",
    serverSessionCookie: "aidebug-session",
    serverUserId: "aidebug-user",
    imageModel: aidebugPublicSettings.imageModel,
    imageModelPool: aidebugPublicSettings.imageModels,
    videoModel: aidebugPublicSettings.videoModel,
    videoModelPool: aidebugPublicSettings.videoModels,
    agentModel: aidebugPublicSettings.agentModels[0],
    agentModelPool: aidebugPublicSettings.agentModels
  };
}

function aidebugUser() {
  return {
    id: "aidebug-user",
    username: "aidebug",
    account: "aidebug",
    email: "aidebug@naimage.local",
    name: "AIDebug",
    balanceCents: 1200,
    trialImagesRemaining: 8,
    createdAt: new Date(0).toISOString()
  };
}

function aidebugWallet() {
  return {
    balanceCents: 1200,
    balanceYuan: 12,
    imageCostCents: aidebugPublicSettings.imageCostCents,
    imageCostYuan: aidebugPublicSettings.imageCostYuan
  };
}

function aidebugLogs() {
  return [
    {
      id: "aidebug-consume-1",
      type: "consume",
      createdAt: String(Math.floor(Date.parse("2026-07-09T16:08:00.000Z") / 1000)),
      detail: {
        count: 1,
        returned: 1,
        chargedCents: 30,
        costCents: 30,
        model: aidebugPublicSettings.imageModel,
        message: "AIDebug 生图损耗"
      }
    },
    {
      id: "aidebug-error-1",
      type: "error",
      createdAt: String(Math.floor(Date.parse("2026-07-09T16:09:30.000Z") / 1000)),
      detail: {
        success: false,
        status: "failed",
        model: aidebugPublicSettings.imageModel,
        promptTokens: 120,
        completionTokens: 18,
        responseTimeMs: 2450,
        rmbCost: 0.02,
        message: "AIDebug 上游失败 token=aidebug-sensitive-token sk-aidebug12345678"
      }
    }
  ];
}

function uniqueImageModels(models = []) {
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

function normalizeModelConnectionBindings(value) {
  if (!Array.isArray(value)) return [];
  const bindings = [];
  const bindingByModel = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const model = String(item.model || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 180);
    if (!model) continue;
    const modelKey = model.toLowerCase();
    let binding = bindingByModel.get(modelKey);
    if (!binding) {
      binding = { model };
      bindingByModel.set(modelKey, binding);
      bindings.push(binding);
    }
    const customBaseUrl = typeof (item.customBaseUrl ?? item.baseUrl) === "string"
      ? String(item.customBaseUrl ?? item.baseUrl)
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 2_048)
      : "";
    const customApiKey = typeof item.customApiKey === "string"
      ? item.customApiKey.trim().slice(0, 8_192)
      : "";
    const accountTokenId = String(item.accountTokenId || "").trim();
    if (customBaseUrl) binding.customBaseUrl = customBaseUrl;
    if (customApiKey) binding.customApiKey = customApiKey;
    if (/^[1-9]\d{0,31}$/.test(accountTokenId)) binding.accountTokenId = accountTokenId;
  }
  return bindings;
}

function normalizeAgentModelBindings(value) {
  return normalizeModelConnectionBindings(value);
}

function normalizeImageModelBindings(value) {
  return normalizeModelConnectionBindings(value);
}

const defaultSession = {
  schemaVersion: 5,
  workspaceDomain: "general",
  sessionRevision: 0,
  nodeSequence: 0,
  messages: [],
  nodes: [],
  nodeMutationJournal: [],
  nodeMutationWriterCheckpoints: [],
  nodeMutationBarriers: [],
  selectedNodeId: ""
};

function ensureRuntimeFiles() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(agentWorkspaceRoot, { recursive: true });
  mkdirSync(debugDir, { recursive: true });
  mkdirSync(path.dirname(electronLog), { recursive: true });
  mkdirSync(referencesDir, { recursive: true });
  desktopUpdater.ensureRuntimeDirectories();
  if (!existsSync(settingsPath)) {
    writeJson(settingsPath, aidebugMode ? aidebugSettings() : defaultSettings);
  } else {
    try {
      writeJson(settingsPath, migrateSettings(readJson(settingsPath, defaultSettings)));
    } catch (error) {
      log(`settings secret migration deferred: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!existsSync(projectListPath)) {
    writeJson(projectListPath, defaultProjectList());
  }
  if (existsSync(glassBackgroundAssetsDir)) {
    try {
      const backgroundAssetId = String(migrateSettings(readJson(settingsPath, defaultSettings)).glassBackgroundAssetId || "").trim();
      glassBackgroundService.cleanup({ referencedAssetIds: backgroundAssetId ? [backgroundAssetId] : [] });
    } catch (error) {
      log(`glass background startup cleanup failed code=${String(error?.code || "CLEANUP_FAILED")}`);
    }
  }
  const list = readProjectList();
  const activeProject = getActiveProject(list);
  if (activeProject && !existsSync(activeProject.sessionPath)) {
    ensureProjectFiles(activeProject, defaultSession);
  }
  writeFileSync(electronLog, `[${new Date().toISOString()}] naimage electron boot\n`, "utf8");
  logBoot("runtime files ready");
}

function migrateSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = { ...defaultSettings };
  const legacyServerUrl = normalizeStoredServerUrl(source.serverUrl);

  for (const key of Object.keys(defaultSettings)) {
    if (source[key] !== undefined) next[key] = source[key];
  }

  if (!source.agentBaseUrl && source.baseUrl) next.agentBaseUrl = source.baseUrl;
  if (!source.agentApiKey && source.apiKey) next.agentApiKey = source.apiKey;
  if (!source.agentModel && source.model) next.agentModel = source.model;
  if (!source.imageBaseUrl && source.baseUrl) next.imageBaseUrl = source.baseUrl;
  if (!source.imageApiKey && source.apiKey) next.imageApiKey = source.apiKey;
  if (!normalizeStoredServerUrl(source.accountBaseUrl) && legacyServerUrl && !isLegacyLocalServerUrl(legacyServerUrl)) {
    next.accountBaseUrl = legacyServerUrl;
  }
  next.accountBaseUrl = normalizeServerUrl(next.accountBaseUrl, defaultSettings.accountBaseUrl);
  next.relayBaseUrl = normalizeServerUrl(next.relayBaseUrl, "");
  next.updateBaseUrl = isRetiredUpdateServiceUrl(next.updateBaseUrl)
    ? defaultSettings.updateBaseUrl
    : normalizeServerUrl(next.updateBaseUrl, defaultSettings.updateBaseUrl);
  next.networkProxyUrl = normalizeStoredServerUrl(next.networkProxyUrl).slice(0, 2_048);
  next.agentModelPool = uniqueImageModels(Array.isArray(source.agentModelPool) ? source.agentModelPool : next.agentModelPool);
  if (!next.agentModel && next.agentModelPool.length) next.agentModel = next.agentModelPool[0];
  if (next.agentModel) next.agentModelPool = uniqueImageModels([next.agentModel, ...next.agentModelPool]);
  next.agentModelBindings = normalizeAgentModelBindings(source.agentModelBindings ?? next.agentModelBindings);
  next.imageModelPool = uniqueImageModels(Array.isArray(source.imageModelPool) ? source.imageModelPool : next.imageModelPool);
  if (!next.imageModel && next.imageModelPool.length) next.imageModel = next.imageModelPool[0];
  if (next.imageModel) next.imageModelPool = uniqueImageModels([next.imageModel, ...next.imageModelPool]);
  next.videoModelPool = uniqueImageModels(Array.isArray(source.videoModelPool) ? source.videoModelPool : next.videoModelPool);
  if (!next.videoModel && next.videoModelPool.length) next.videoModel = next.videoModelPool[0];
  if (next.videoModel) next.videoModelPool = uniqueImageModels([next.videoModel, ...next.videoModelPool]);
  next.imageModelBindings = normalizeImageModelBindings(source.imageModelBindings ?? next.imageModelBindings);
  const legacyImageDimensions = parseImageSizeValue(String(source.imageSize || next.imageSize || ""));
  const inferredLegacyRatio = (() => {
    if (!legacyImageDimensions) return defaultSettings.imageRatio;
    const target = legacyImageDimensions.width / legacyImageDimensions.height;
    let nearest = defaultSettings.imageRatio;
    let distance = Number.POSITIVE_INFINITY;
    for (const ratio of imagePromptRatios) {
      const [width, height] = ratio.split(":").map(Number);
      const nextDistance = Math.abs((width / height) - target);
      if (nextDistance >= distance) continue;
      nearest = ratio;
      distance = nextDistance;
    }
    return distance <= 0.035 ? nearest : defaultSettings.imageRatio;
  })();
  const requestedImageRatio = source.imageRatio === undefined ? inferredLegacyRatio : String(next.imageRatio || "").trim();
  next.imageRatio = imagePromptRatios.has(requestedImageRatio) ? requestedImageRatio : defaultSettings.imageRatio;
  const inferredLegacyResolution = (() => {
    const text = String(source.imageSize || next.imageSize || "").trim().toUpperCase();
    if (text === "4K" || text.includes("3840") || text.includes("2160")) return "4K";
    if (text === "2K" || text.includes("2048")) return "2K";
    return "1K";
  })();
  const storedImageResolution = String(source.imageResolution === undefined ? inferredLegacyResolution : next.imageResolution || "").trim().toUpperCase();
  next.imageResolution = storedImageResolution === "720P" || storedImageResolution === "1080P"
    ? "1K"
    : normalizeImagePromptResolution(storedImageResolution, defaultSettings.imageResolution);
  next.modelGroup = String(next.modelGroup || "").trim().slice(0, 120);
  next.serverAccessToken = String(next.serverAccessToken || "").trim().slice(0, 8_192);
  next.serverAccessExpiresAt = Math.max(0, Math.floor(Number(next.serverAccessExpiresAt) || 0));
  next.serverSessionCookie = String(next.serverSessionCookie || "").trim().slice(0, 8_192);
  next.serverAuthSessionId = String(next.serverAuthSessionId || "").trim().slice(0, 512);
  next.serverUserId = String(next.serverUserId || "").trim().slice(0, 128);
  const inferredAuthProtocol = next.serverAccessToken || next.serverAuthSessionId || /^new_api_refresh=/i.test(next.serverSessionCookie)
    ? "bundle"
    : next.serverSessionCookie && next.serverUserId
      ? "legacy"
      : "";
  next.serverAuthProtocol = ["bundle", "legacy"].includes(String(next.serverAuthProtocol || "").toLowerCase())
    ? String(next.serverAuthProtocol).toLowerCase()
    : inferredAuthProtocol;
  next.selectedAccountTokenId = /^\d+$/.test(String(next.selectedAccountTokenId || "")) ? String(next.selectedAccountTokenId) : "";
  next.selectedAccountTokenName = String(next.selectedAccountTokenName || "").trim().slice(0, 50);
  next.selectedAccountTokenGroup = String(next.selectedAccountTokenGroup || "").trim().slice(0, 120);
  next.accessMode = String(next.accessMode || "account") === "custom" ? "custom" : "account";
  next.licenseDeviceId = String(next.licenseDeviceId || "").trim().slice(0, 128);
  if (!next.licenseDeviceId) next.licenseDeviceId = `device-${randomBytes(24).toString("hex")}`;
  next.licenseToken = String(next.licenseToken || "").trim().slice(0, 256);
  next.licensePlan = String(next.licensePlan || "").trim().slice(0, 40);
  next.licenseExpiresAt = Math.max(0, Math.floor(Number(next.licenseExpiresAt) || 0));
  next.licenseLastVerifiedAt = Math.max(0, Math.floor(Number(next.licenseLastVerifiedAt) || 0));
  next.theme = ["system", "light", "dark"].includes(String(next.theme)) ? String(next.theme) : defaultSettings.theme;
  next.themePalette = themePaletteValues.has(String(next.themePalette)) ? String(next.themePalette) : defaultSettings.themePalette;
  next.customTheme = normalizeCustomThemePreset(source.customTheme);
  if (next.themePalette === "custom" && !next.customTheme) next.themePalette = defaultSettings.themePalette;
  const glassAppearance = normalizeElectronGlassThemeSettings({
    glassTheme: source.glassTheme ?? (source.theme === "dark" ? "dark-rose" : defaultSettings.glassTheme),
    glassMaterial: source.glassMaterial,
    glassParameters: source.glassParameters
  });
  next.glassTheme = glassAppearance.glassTheme;
  next.glassMaterial = glassAppearance.glassMaterial;
  next.glassParameters = glassAppearance.glassParameters;
  Object.assign(next, normalizeGlassBackgroundSettings(source));
  next.agentPanelPlacement = ["right", "left", "top", "bottom", "floating"].includes(String(next.agentPanelPlacement))
    ? String(next.agentPanelPlacement)
    : defaultSettings.agentPanelPlacement;
  next.agentPanelWidth = Math.max(320, Math.min(720, Math.round(Number(next.agentPanelWidth) || defaultSettings.agentPanelWidth)));
  next.agentPanelHeight = Math.max(420, Math.min(1_400, Math.round(Number(next.agentPanelHeight) || defaultSettings.agentPanelHeight)));
  next.agentPanelX = Math.max(0, Math.min(10_000, Math.round(Number(next.agentPanelX) || 0)));
  next.agentPanelY = Math.max(0, Math.min(10_000, Math.round(Number(next.agentPanelY) || 0)));
  next.agentSkillAutoInstallTargets = Array.isArray(source.agentSkillAutoInstallTargets)
    ? [...new Set(source.agentSkillAutoInstallTargets.map((item) => String(item)).filter((item) => ["codex", "claude-code", "opencode", "openclaw"].includes(item)))]
    : [];
  const storedWorkspacePluginDefaultsVersion = Math.max(0, Math.floor(Number(source.workspacePluginDefaultsVersion) || 0));
  next.workspacePluginDefaultsVersion = WORKSPACE_PLUGIN_DEFAULTS_VERSION;
  next.pluginStates = storedWorkspacePluginDefaultsVersion < WORKSPACE_PLUGIN_DEFAULTS_VERSION
    ? defaultWorkspacePluginStates(source.pluginStates)
    : normalizePluginStates(source.pluginStates);
  next.canvasToolDockMode = source.canvasToolDockMode === "hover" ? "hover" : "expanded";
  next.workflowOnboarding = {};
  if (source.workflowOnboarding && typeof source.workflowOnboarding === "object" && !Array.isArray(source.workflowOnboarding)) {
    for (const key of ["social", "xiaohongshu", "douyin", "research", "commerce"]) {
      if (source.workflowOnboarding[key] === true) next.workflowOnboarding[key] = true;
    }
  }
  next.disabledCanvasToolCommands = [];
  if (Array.isArray(source.disabledCanvasToolCommands)) {
    const seenCanvasToolCommands = new Set();
    for (const item of source.disabledCanvasToolCommands) {
      const command = String(item || "").trim().slice(0, 160);
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(command) || seenCanvasToolCommands.has(command)) continue;
      seenCanvasToolCommands.add(command);
      next.disabledCanvasToolCommands.push(command);
      if (next.disabledCanvasToolCommands.length >= 128) break;
    }
  }
  next.canvasToolShortcuts = normalizeCanvasToolShortcuts(source.canvasToolShortcuts);
  const visibleWorkspaceAssetRailTabSet = new Set(Array.isArray(source.visibleWorkspaceAssetRailTabs)
    ? source.visibleWorkspaceAssetRailTabs.map((item) => String(item))
    : defaultSettings.visibleWorkspaceAssetRailTabs);
  next.visibleWorkspaceAssetRailTabs = defaultSettings.visibleWorkspaceAssetRailTabs.filter((tab) => visibleWorkspaceAssetRailTabSet.has(tab));
  if (!next.visibleWorkspaceAssetRailTabs.length) next.visibleWorkspaceAssetRailTabs = ["results"];
  next.agentProvider = ["CODEX", "CUSTOM"].includes(String(next.agentProvider)) ? String(next.agentProvider) : "CODEX";
  next.contextStrategy = ["auto", "codex", "claude", "naimage-balanced", "custom"].includes(String(next.contextStrategy))
    ? String(next.contextStrategy)
    : defaultSettings.contextStrategy;
  const contextWindowTokens = Number(next.contextWindowTokens);
  next.contextWindowTokens = Number.isFinite(contextWindowTokens)
    ? Math.max(8_000, Math.min(2_000_000, Math.round(contextWindowTokens)))
    : defaultSettings.contextWindowTokens;
  const contextEffectiveWindowPercent = Number(next.contextEffectiveWindowPercent);
  next.contextEffectiveWindowPercent = Number.isFinite(contextEffectiveWindowPercent)
    ? Math.max(50, Math.min(99, Math.round(contextEffectiveWindowPercent)))
    : defaultSettings.contextEffectiveWindowPercent;
  const contextAutoCompactPercent = Number(next.contextAutoCompactPercent);
  next.contextAutoCompactPercent = Number.isFinite(contextAutoCompactPercent)
    ? Math.max(50, Math.min(Math.min(98, next.contextEffectiveWindowPercent), Math.round(contextAutoCompactPercent)))
    : defaultSettings.contextAutoCompactPercent;
  const contextRetainedUserTokens = Number(next.contextRetainedUserTokens);
  next.contextRetainedUserTokens = Number.isFinite(contextRetainedUserTokens)
    ? Math.max(0, Math.min(50_000, Math.round(contextRetainedUserTokens)))
    : defaultSettings.contextRetainedUserTokens;
  next.reasoningEffort = ["low", "medium", "high", "xhigh", "max", "ultra"].includes(String(next.reasoningEffort)) ? String(next.reasoningEffort) : "low";
  const timeoutSeconds = Number(next.timeoutSeconds);
  next.timeoutSeconds = Number.isFinite(timeoutSeconds)
    ? Math.max(15, Math.min(600, Math.round(timeoutSeconds)))
    : defaultSettings.timeoutSeconds;
  const imageBatchSize = Number(next.imageBatchSize);
  next.imageBatchSize = Number.isFinite(imageBatchSize)
    ? Math.max(1, Math.min(10, Math.round(imageBatchSize)))
    : defaultSettings.imageBatchSize;
  next.fastMode = Boolean(next.fastMode);
  if (isLegacyLocalServerUrl(legacyServerUrl)) {
    next.accountBaseUrl = defaultSettings.accountBaseUrl;
    next.relayBaseUrl = defaultSettings.relayBaseUrl;
    next.serverToken = "";
    next.serverAuthProtocol = "";
    next.serverAccessToken = "";
    next.serverAccessExpiresAt = 0;
    next.serverSessionCookie = "";
    next.serverAuthSessionId = "";
    next.serverUserId = "";
    next.selectedAccountTokenId = "";
    next.selectedAccountTokenName = "";
    next.selectedAccountTokenGroup = "";
  }
  Object.assign(next, applyAccessPolicyToSettings(next, accessPolicy));

  delete next.baseUrl;
  delete next.apiKey;
  delete next.model;
  delete next.serverUrl;
  return next;
}

function publicSettings(settings) {
  const next = settingsSecretStore.publicSettings({ ...migrateSettings(settings) });
  delete next.serverSessionCookie;
  delete next.serverAuthProtocol;
  delete next.serverAccessToken;
  delete next.serverAccessExpiresAt;
  delete next.serverAuthSessionId;
  delete next.serverUserId;
  delete next.licenseDeviceId;
  delete next.licenseToken;
  return next;
}

function log(message) {
  try {
    writeFileSync(electronLog, `[${new Date().toISOString()}] ${message}\n`, {
      flag: "a",
      encoding: "utf8"
    });
  } catch {
    // Logging must never prevent app startup.
  }
}

function logBoot(stage) {
  log(`boot +${Date.now() - bootStartedAt}ms ${stage}`);
}

let automationService = null;
const debugCommandService = createDebugCommandService({
  appRoot: projectRoot,
  debugDir,
  electronLog,
  commandSchemaPath: path.join(projectRoot, "integrations", "naimage-control", "references", "commands.schema.json"),
  BrowserWindow,
  ipcMain,
  version: getDesktopVersion(),
  packaged: app.isPackaged,
  enabled: aidebugMode || !app.isPackaged,
  getRendererState: () => automationService?.dispatch("app.state", {}, 5_000),
  log
});
automationService = createAutomationService({
  BrowserWindow,
  configDir,
  version: getDesktopVersion(),
  executablePath: process.execPath,
  log,
  serviceCommandHandler: debugCommandService.execute,
  serviceCommandNames: debugCommandService.commands
});
const agentIntegrationService = createAgentIntegrationService({
  appRoot: projectRoot,
  endpointPath: automationService.endpointPath,
  executablePath: process.execPath,
  log
});
const agentWindowService = createAgentWindowService({
  BrowserWindow,
  htmlPath: agentWindowHtml,
  preloadPath: agentWindowPreload,
  applicationName,
  icon: createWindowIcon(),
  getBackgroundColor: () => nativeWindowBackgroundColor(migrateSettings(readJson(settingsPath, defaultSettings))),
  log
});
const themePresetService = createThemePresetService({ dialog, readFileSync, statSync, writeFileSync });
const glassBackgroundService = createGlassBackgroundService({
  assetsDir: glassBackgroundAssetsDir,
  dialog,
  sharp,
  log
});
const requirementLibraryService = createRequirementLibraryService({
  libraryPath: requirementLibraryPath,
  readJson,
  writeJson
});
const commerceTemplateLibraryService = createCommerceTemplateLibraryService({
  libraryPath: commerceTemplateLibraryPath,
  readJson,
  writeJson,
  dialog,
  readFileSync,
  writeFileSync,
  statSync
});

const aidebugBackend = aidebugMode && aidebugMockAgent
  ? createAidebugBackend({ enabled: aidebugMode, log })
  : null;
const newApiTransport = createNewApiTransport({
  app,
  applicationName: internalApplicationName,
  windowsCurlPath,
  getDesktopVersion,
  getAuthEpoch: () => newApiAuthEpoch
});
const {
  activeNewApiCurlTransportCount,
  newApiTransportFetch,
  stopActiveNewApiCurlTransports
} = newApiTransport;
let accountTokenService = null;
const newApiClient = createNewApiClient({
  defaultSettings,
  ensureLocalServer,
  isLocalServerUrl,
  log,
  migrateSettings,
  newApiTransportFetch,
  normalizeServerUrl,
  readJson,
  resolveAccountApiCredentials: (settings, tokenId) => accountTokenService.credentials(settings, tokenId),
  settingsPath,
  writeJson
});
const {
  customApiCredentials,
  customApiUrl,
  directApiUrl,
  isNewApiAuthError,
  isCustomApiMode,
  logoutNewApiSession,
  managedRelayEndpoint,
  newApiErrorMessage,
  newApiFetch,
  newApiRelayImage,
  newApiRelayImageTask,
  newApiRelayJson,
  newApiRelayResponsesImage,
  newApiRelayStream,
  newApiRequest,
  newApiUserAuthHeaders,
  parseNewApiLoginAuth,
  parseJsonText,
  persistNewApiSessionCookie,
  requireNewApiSession,
  resolveNewApiBaseUrl,
  validateNewApiServiceSettings
} = newApiClient;
accountTokenService = createAccountTokenService({
  defaultSettings,
  log,
  migrateSettings,
  newApiRequest,
  newApiUserAuthHeaders,
  readJson,
  requireNewApiSession,
  resolveNewApiBaseUrl,
  tokenCachePath: accountTokenCachePath,
  settingsPath,
  writeJson
});
const licenseService = createLicenseService({
  defaultSettings,
  licenseBaseUrl: accessPolicy.officialAccountBaseUrl,
  log,
  migrateSettings,
  newApiRequest,
  readJson,
  settingsPath,
  writeJson
});
const desktopUpdater = createDesktopUpdaterService({
  app,
  BrowserWindow,
  configDir,
  projectRoot,
  packageMetadata,
  settingsPath,
  defaultSettings,
  aidebugMode,
  aidebugLiveImage,
  migrateSettings,
  readJson,
  writeJson,
  isPathInside,
  log,
  requireNewApiSession,
  newApiRequest,
  newApiUserAuthHeaders,
  resolveNewApiBaseUrl,
  newApiTransportFetch,
  parseJsonText,
  newApiErrorMessage,
  shutdownApplicationServices
});

const imageThumbnailCache = createThumbnailCache({
  workerPath: path.join(projectRoot, "image-thumbnail-worker.cjs"),
  log: (message) => log(`thumbnail ${message}`)
});

function newProjectImageImporter() {
  return createImageImporter({
    workerPath: path.join(projectRoot, "image-import-worker.cjs"),
    maxConcurrentFiles: 4,
    log: (message) => log(`image-import ${message}`)
  });
}

let projectImageImporter = newProjectImageImporter();
let imageImporterRecyclePromise = null;
let imageImportCounters = {
  requests: 0,
  completed: 0,
  canceled: 0,
  errors: 0,
  active: 0,
  maxActiveRequests: 0,
  cancelRequests: 0,
  lastDurationMs: 0,
  lastSelectedCount: 0,
  lastImportedCount: 0,
  lastSkippedCount: 0,
  lastMaxActiveFiles: 0,
  lastWorkerPid: 0,
  lastErrorCode: ""
};

function imageImportStatus(reset = false) {
  if (reset && imageImportCounters.active === 0) {
    imageImportCounters = {
      requests: 0,
      completed: 0,
      canceled: 0,
      errors: 0,
      active: 0,
      maxActiveRequests: 0,
      cancelRequests: 0,
      lastDurationMs: 0,
      lastSelectedCount: 0,
      lastImportedCount: 0,
      lastSkippedCount: 0,
      lastMaxActiveFiles: 0,
      lastWorkerPid: 0,
      lastErrorCode: ""
    };
  }
  return {
    ...imageImportCounters,
    maxConcurrentFiles: 4,
    mainProcessPid: process.pid,
    recycling: Boolean(imageImporterRecyclePromise),
    available: Boolean(projectImageImporter),
    quitting
  };
}

async function currentProjectImageImporter() {
  if (imageImporterRecyclePromise) await imageImporterRecyclePromise;
  if (!projectImageImporter) {
    if (quitting) throw new ImageImportError("IMAGE_IMPORT_CLOSED", "应用正在退出，图片导入已经关闭。");
    projectImageImporter = newProjectImageImporter();
  }
  return projectImageImporter;
}

function recycleProjectImageImporter(reopen = true) {
  imageImportCounters.cancelRequests += 1;
  if (imageImporterRecyclePromise) return imageImporterRecyclePromise;
  const current = projectImageImporter;
  projectImageImporter = null;
  const closePromise = current ? current.close() : Promise.resolve();
  const task = Promise.resolve(closePromise)
    .catch((error) => log(`image-import close failed ${error instanceof Error ? error.message : String(error)}`))
    .then(() => {
      if (reopen && !quitting) projectImageImporter = newProjectImageImporter();
    })
    .finally(() => {
      if (imageImporterRecyclePromise === task) imageImporterRecyclePromise = null;
    });
  imageImporterRecyclePromise = task;
  return task;
}

function readJson(filePath, fallback) {
  const settingsDocument = isSettingsJsonPath(filePath);
  try {
    if (!existsSync(filePath)) {
      if (settingsDocument) {
        const recovered = settingsSecretStore.recover(fallback);
        writeJsonDocument(filePath, recovered.persisted);
        return recovered.settings;
      }
      writeJson(filePath, fallback);
      return fallback;
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const merged = { ...fallback, ...parsed };
    return settingsDocument ? settingsSecretStore.hydrate(merged) : merged;
  } catch (error) {
    log(`read-json-failed ${filePath}: ${error.message}`);
    if (settingsDocument) {
      const recovered = settingsSecretStore.recover(fallback);
      writeJsonDocument(filePath, recovered.persisted);
      return recovered.settings;
    }
    writeJson(filePath, fallback);
    return fallback;
  }
}

function writeJsonDocument(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function writeJson(filePath, value) {
  const persistedValue = isSettingsJsonPath(filePath) ? settingsSecretStore.persist(value) : value;
  writeJsonDocument(filePath, persistedValue);
}

function isSettingsJsonPath(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const expected = path.resolve(settingsPath);
  return process.platform === "win32" ? resolved.toLowerCase() === expected.toLowerCase() : resolved === expected;
}

let projectAssetRepository = null;
const projectStore = createProjectStore({
  comparablePath,
  defaultSession,
  exportSessionFileName,
  isPathInside,
  legacyExportSessionFileNames,
  legacyProjectMetaDirNames,
  legacyProjectPathMappings: legacyPackagedDataRoots.map((legacyRoot) => ({
    from: path.join(legacyRoot, "data"),
    to: path.join(packagedDataRoot, "data")
  })),
  log,
  normalizeSessionRevision,
  projectListPath,
  projectManifestFileName,
  projectMetaDirName,
  projectRoot,
  projectsDir,
  readJson,
  sessionForProjectSave: (...args) => projectAssetRepository.sessionForProjectSave(...args),
  sessionHasContent,
  sessionPath,
  sessionWithProjectAssets: (...args) => projectAssetRepository.sessionWithProjectAssets(...args),
  writeJson
});
const {
  createProjectRecord,
  currentSessionPath,
  defaultProjectList,
  ensureProjectFiles,
  getActiveProject,
  getProjectById,
  nextExternalProjectFolderPath,
  projectExportSessionPath,
  projectCommerceCatalogPath,
  projectForFolderOpen,
  projectManifestPath,
  projectRelativePath,
  projectSessionFromDisk,
  projectSessionRevisionFromDisk,
  readProjectList,
  readProjectManifest,
  resolveProjectRelativePath,
  safeName,
  thumbnailProjectRoots,
  writeProjectList,
  writeProjectManifest
} = projectStore;
const projectDataMigrationService = createProjectDataMigrationService({
  configDir,
  projectsDir,
  sessionPath,
  installRoot: projectRoot,
  projectMetaDirName,
  readProjectList,
  writeProjectList,
  sessionHasContent,
  log
});
projectAssetRepository = createProjectAssetRepository({
  assetPathFromUrl: decodeLocalAssetUrl,
  assetUrlFor,
  boundedImageRead,
  comparablePath,
  isComparablePathInside,
  legacyProjectMetaDirNames,
  maxExportImageBytes,
  projectMetaDirName,
  projectRelativePath,
  projectRoot,
  realPathIfPresent,
  resolveProjectRelativePath,
  sanitizeSession,
  sessionAssetContentHash,
  sessionPath
});
const {
  buildProjectAssetIndex,
  controlledProjectAssetFile,
  hydrateAssetForProject,
  projectAssetRoots,
  projectWritableAssetRoots,
  sessionForProjectSave,
  sessionWithProjectAssets
} = projectAssetRepository;

const commerceCatalogService = createProjectCommerceCatalogService({
  getProjectById,
  projectCommerceCatalogPath,
  projectRelativePath,
  resolveProjectRelativePath,
  projectSessionFromDisk,
  readProjectList
});
const commerceExportService = createProjectCommerceExportService({
  getProjectById,
  readProjectList,
  readCommerceCatalog: (project) => commerceCatalogService.readDocument(project),
  resolveProjectRelativePath
});
const socialExportService = createProjectSocialExportService({
  getProjectById,
  projectSessionFromDisk,
  readProjectList,
  resolveProjectRelativePath
});
const imageCollectionExportService = createImageCollectionExportService({
  controlledProjectAssetFile,
  getProjectById,
  projectSessionFromDisk,
  readProjectList,
  resolveProjectRelativePath
});
const exportCenterStateService = createExportCenterStateService({
  getProjectById,
  readProjectList
});
const scientificRunnerService = createScientificRunnerService({
  assetUrlFor,
  getProjectById,
  log: (message) => log(`scientific runner ${message}`),
  onTaskChanged(task) {
    for (const targetWindow of BrowserWindow.getAllWindows()) {
      if (!targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
        targetWindow.webContents.send("naimage:scientific:changed", task);
      }
    }
  },
  projectMetaDirName,
  projectRelativePath,
  readProjectList,
  resolveProjectRelativePath
});

async function resolveVideoTaskCredentials({ model, credentialRef } = {}) {
  const settings = currentAgentSettings();
  if (isCustomApiMode(settings)) {
    const credentials = customApiCredentials(settings, "image", model);
    return {
      ...credentials,
      mode: "custom",
      tokenId: "",
      label: "自定义 API Key"
    };
  }
  const tokenId = String(credentialRef?.tokenId || settings.selectedAccountTokenId || "").trim();
  const credentials = await accountTokenService.credentials(settings, tokenId || undefined);
  return {
    ...credentials,
    mode: "account",
    tokenId: String(credentials?.id || tokenId || settings.selectedAccountTokenId || "").trim(),
    label: String(credentials?.name || settings.selectedAccountTokenName || (tokenId ? `Token #${tokenId}` : "账户 Token")).trim()
  };
}

async function requestVideoTaskJson({ credentials, endpoint, method = "GET", body, headers = {}, timeoutMs = 30_000, retries = 0 } = {}) {
  const settings = currentAgentSettings();
  const request = await newApiFetch(settings, endpoint, {
    method,
    body,
    absoluteUrl: directApiUrl(credentials.baseUrl, endpoint),
    requestBaseUrl: credentials.baseUrl,
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      ...headers
    },
    timeoutMs,
    retries,
    maxResponseBytes: 8 * 1024 * 1024
  });
  const bodyRejected = Boolean(request.data?.error) || request.data?.success === false || request.data?.ok === false;
  if (!request.response.ok || request.data?.parseFailed === true || bodyRejected) {
    const error = new Error(newApiErrorMessage(request.data, request.response.status));
    error.status = request.response.status;
    error.data = request.data;
    error.responseReceived = true;
    error.explicitRejection = bodyRejected && request.response.status < 500;
    throw error;
  }
  return { data: request.data, status: request.response.status };
}

function videoDownloadUrl(credentials, endpointOrUrl) {
  const source = String(endpointOrUrl || "").trim();
  const absolute = /^https?:\/\//i.test(source) ? source : directApiUrl(credentials.baseUrl, source);
  const parsed = new URL(absolute);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("视频结果只允许通过 HTTP 或 HTTPS 下载。");
  if (parsed.username || parsed.password) throw new Error("视频结果地址不能包含用户名或密码。");
  return parsed;
}

function nodeVideoDownloadResponse(response) {
  const status = Number(response?.statusCode || 0);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const value = response?.headers?.[String(name || "").toLowerCase()];
        return Array.isArray(value) ? value[0] : value === undefined ? null : String(value);
      }
    },
    body: response
  };
}

async function fetchVideoTaskBinary({ credentials, endpointOrUrl, timeoutMs = 5 * 60_000, maxResponseBytes } = {}) {
  const settings = currentAgentSettings();
  const credentialOrigin = new URL(credentials.baseUrl).origin;
  let target = videoDownloadUrl(credentials, endpointOrUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("视频结果下载超时。")), Math.max(1_000, Number(timeoutMs) || 5 * 60_000));
    let response;
    try {
      if (target.origin === credentialOrigin) {
        response = await newApiTransportFetch(target.toString(), {
          method: "GET",
          headers: { authorization: `Bearer ${credentials.apiKey}` },
          signal: controller.signal,
          headersTimeoutMs: Math.min(60_000, Math.max(5_000, Number(timeoutMs) || 30_000)),
          connectTimeoutMs: 20_000,
          proxyUrl: settings.networkProxyUrl,
          maxResponseBytes
        });
      } else {
        const publicTarget = await resolvePublicHttpTarget(target, { signal: controller.signal });
        const incoming = await requestPublicHttpTarget(publicTarget, {
          signal: controller.signal,
          accept: "video/mp4,video/webm,video/quicktime,application/octet-stream,*/*;q=0.1"
        });
        response = nodeVideoDownloadResponse(incoming);
      }
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    const clearTimer = () => clearTimeout(timer);
    response.body?.once?.("end", clearTimer);
    response.body?.once?.("close", clearTimer);
    response.body?.once?.("error", clearTimer);
    if (![301, 302, 303, 307, 308].includes(Number(response.status))) return response;
    const location = String(response.headers?.get?.("location") || "").trim();
    response.body?.resume?.();
    clearTimer();
    if (!location) return response;
    if (redirect >= 5) throw new Error("视频结果下载重定向次数过多。");
    target = videoDownloadUrl(credentials, new URL(location, target).toString());
  }
  throw new Error("视频结果下载失败。");
}

const videoTaskService = createVideoTaskService({
  assetUrlFor,
  fetchBinary: fetchVideoTaskBinary,
  getProjectById,
  log: (message) => log(`video task ${message}`),
  markRuntimeVerified({ model, endpointType }) {
    markModelRuntimeVerified(currentAgentSettings(), "video", model, endpointType);
  },
  onTaskChanged(task) {
    for (const targetWindow of BrowserWindow.getAllWindows()) {
      if (!targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
        targetWindow.webContents.send("naimage:video-task:changed", task);
      }
    }
  },
  projectMetaDirName,
  projectRelativePath,
  readJson,
  readProjectList,
  requestJson: requestVideoTaskJson,
  resolveProjectRelativePath,
  resolveCredentials: resolveVideoTaskCredentials,
  writeJson
});


function copyDirectory(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) return;
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

const projectPackageService = createProjectPackageService({
  assertSafeEncodedImageDimensions,
  assetUrlFor,
  boundedImageRead,
  buildProjectAssetIndex,
  comparablePath,
  controlledProjectAssetFile,
  createProjectRecord,
  defaultSession,
  detectImageFormat,
  encodedImageDimensions,
  hydrateAssetForProject,
  isComparablePathInside,
  log,
  mimeTypeForPath,
  nativeImage,
  readCommerceCatalog: (project) => commerceCatalogService.readDocument(project),
  projectWritableAssetRoots,
  projectRelativePath,
  projectSessionFromDisk,
  resolveProjectRelativePath,
  safeName,
  sanitizeCommerceCatalogDocument,
  sanitizeSession,
  sessionForProjectSave,
  writeCommerceCatalog: (project, catalog) => commerceCatalogService.replaceCatalogForProject(project, catalog),
  writeJson,
  writeProjectManifest
});
const {
  estimatedBase64DecodedBytes,
  importProjectPackage,
  packageProject,
  projectPackageFailure,
  sessionFromPackage,
  validateProjectPackageData,
  validateProjectPackageImageBuffer,
  validateProjectPackageSessionShape,
  writeProjectPackageFile
} = projectPackageService;

function registerAssetProtocol() {
  const handleLocalAssetRequest = async (request) => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/^\/+/, "");
      if (url.hostname === "remote") {
        try {
          const loaded = await loadRecordedRemoteAssetProxy(url, {
            isRecorded(remoteUrl) {
              const list = readProjectList();
              const project = getActiveProject(list);
              return Boolean(project?.path && recordedAssetSourcesForProject(project).urls.has(remoteUrl));
            },
            download: (remoteUrl) => remoteImageDownloads.download(remoteUrl, {
              maxBytes: maxExportImageBytes,
              timeoutMs: 30_000,
              maxRedirects: 5
            }),
            detectFormat: detectImageFormat,
            validateDimensions: (buffer) => assertSafeEncodedImageDimensions(buffer, "remote project image"),
            isDecodable: (buffer) => !nativeImage.createFromBuffer(buffer).isEmpty()
          });
          return new Response(loaded.buffer, {
            status: 200,
            headers: {
              "cache-control": "private, max-age=300",
              "content-type": loaded.mimeType,
              "x-content-type-options": "nosniff"
            }
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "remote asset request failed", { status: Number(error?.status) || 500 });
        }
      }
      const resolved = pathname.startsWith("abs/")
        ? path.resolve(decodeURIComponent(pathname.slice(4)))
        : path.resolve(projectRoot, decodeURIComponent(pathname));

      if (!isAllowedAssetPath(resolved) || !existsSync(resolved)) {
        return new Response("asset not found", { status: 404 });
      }

      if (url.searchParams.get("preview") === "thumbnail") {
        const requestedMax = Number(url.searchParams.get("max") || 512);
        const maxEdge = Number.isFinite(requestedMax) ? Math.max(128, Math.min(Math.round(requestedMax), 1024)) : 512;
        const cacheRoot = thumbnailCacheRootForAsset(resolved);
        if (cacheRoot) {
          try {
            const thumbnail = await imageThumbnailCache.ensure({ sourcePath: resolved, cacheRoot, maxEdge });
            if (thumbnail?.path && existsSync(thumbnail.path)) {
              return net.fetch(pathToFileURL(thumbnail.path).toString());
            }
          } catch (error) {
            log(`thumbnail fallback ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      const forwardedHeaders = {};
      for (const headerName of ["range", "if-range", "if-modified-since", "if-none-match"]) {
        const value = request.headers.get(headerName);
        if (value) forwardedHeaders[headerName] = value;
      }
      return net.fetch(pathToFileURL(resolved).toString(), { headers: forwardedHeaders });
    } catch (error) {
      log(`asset protocol failed: ${error.message}`);
      return new Response("asset protocol error", { status: 500 });
    }
  };
  for (const scheme of localAssetSchemes) protocol.handle(scheme, handleLocalAssetRequest);
}

function outputRoots() {
  const list = readProjectList();
  const roots = new Set([path.resolve(projectRoot, "output")]);
  for (const project of list.projects) {
    if (project?.path) roots.add(path.resolve(project.path, "output"));
  }
  return [...roots];
}

function isPathInside(resolvedPath, rootPath) {
  const root = path.resolve(rootPath);
  return resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`);
}

function isAllowedAssetPath(filePath) {
  const resolved = path.resolve(filePath);
  if (isPathInside(resolved, referencesDir)) return true;
  return outputRoots().some((root) => isPathInside(resolved, root));
}

function isAllowedOutputPath(filePath) {
  const resolved = path.resolve(filePath);
  return outputRoots().some((root) => isPathInside(resolved, root));
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "application/octet-stream";
}

function assetUrlFor(filePath) {
  const resolved = path.resolve(filePath);
  if (isPathInside(resolved, projectRoot)) {
    const relativePath = path.relative(projectRoot, resolved).split(path.sep).map(encodeURIComponent).join("/");
    return `naimage-asset://local/${relativePath}`;
  }
  return `naimage-asset://local/abs/${encodeURIComponent(resolved)}`;
}

function resolveOutputAsset(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const resolved = path.resolve(filePath);
  if (!isAllowedOutputPath(resolved)) return null;
  return resolved;
}

const maxFolderExportAssets = 200;
const exportImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const exportBlendModes = new Set(["normal", "source-over", "multiply", "screen", "overlay"]);
const transientExportSourceRefs = new Map();

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isComparablePathInside(filePath, rootPath) {
  const resolved = comparablePath(filePath);
  const root = comparablePath(rootPath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function realPathIfPresent(filePath) {
  const resolved = path.resolve(filePath);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function managedRootsForProject(project) {
  const projectPath = path.resolve(project?.path || "");
  if (!projectPath) return [];
  return [
    path.join(projectPath, "output"),
    path.join(projectPath, "assets"),
    path.join(projectPath, projectMetaDirName, "assets"),
    ...legacyProjectMetaDirNames.map((dirName) => path.join(projectPath, dirName, "assets"))
  ];
}

function agentImageRootsForContext(context = {}) {
  const list = readProjectList();
  const requestedProjectId = String(context?.projectId || "").trim();
  if (requestedProjectId && requestedProjectId !== list.activeProjectId) return [];
  const project = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
  if (!project?.path) return [];
  const realProjectPath = realPathIfPresent(project.path);
  return managedRootsForProject(project)
    .map(realPathIfPresent)
    .filter((root) => isComparablePathInside(root, realProjectPath));
}

function addRecordedAssetSources(target, asset, project) {
  if (!asset || typeof asset !== "object") return;
  for (const key of ["url", "assetUrl"]) {
    const value = typeof asset[key] === "string" ? asset[key].trim() : "";
    if (value) target.urls.add(value);
  }
  for (const value of [asset.path, asset.relativePath ? resolveProjectRelativePath(project.path, asset.relativePath) : ""]) {
    if (typeof value !== "string" || !value.trim()) continue;
    target.paths.add(comparablePath(value));
  }
}

function recordedAssetSourcesForProject(project) {
  const recorded = { paths: new Set(), urls: new Set() };
  let session;
  try {
    session = projectSessionFromDisk(project);
  } catch (error) {
    log(`asset export session scan failed project=${project?.id || "unknown"} ${error instanceof Error ? error.message : String(error)}`);
    return recorded;
  }
  for (const node of Array.isArray(session?.nodes) ? session.nodes : []) {
    for (const asset of Array.isArray(node?.assets) ? node.assets : []) addRecordedAssetSources(recorded, asset, project);
    addRecordedAssetSources(recorded, node?.layerGroup?.previewAsset, project);
    addRecordedAssetSources(recorded, node?.layerGroup?.mergedAsset, project);
    addRecordedAssetSources(recorded, node?.layerComposition?.previewAsset, project);
    addRecordedAssetSources(recorded, node?.layerComposition?.mergedAsset, project);
    for (const layer of Array.isArray(node?.layerComposition?.layers) ? node.layerComposition.layers : []) {
      addRecordedAssetSources(recorded, layer?.asset, project);
    }
    for (const reference of Array.isArray(node?.imageParams?.referenceImages) ? node.imageParams.referenceImages : []) {
      addRecordedAssetSources(recorded, { path: reference?.path, assetUrl: reference?.assetUrl }, project);
    }
  }
  return recorded;
}

function createAssetExportContext(projectId) {
  const list = readProjectList();
  const activeProject = getActiveProject(list);
  const requestedId = typeof projectId === "string" ? projectId.trim() : "";
  if (requestedId && requestedId !== list.activeProjectId) {
    throw new Error("当前项目已切换，请重新选择需要导出的图片。");
  }
  const project = requestedId ? getProjectById(requestedId, list) : activeProject;
  if (!project?.path) throw new Error("当前没有可用的项目图片库。");
  ensureProjectFiles(project, defaultSession);
  const realProjectPath = realPathIfPresent(project.path);
  const realProjectRoot = realPathIfPresent(projectRoot);
  const realConfigDir = realPathIfPresent(configDir);
  const managedRoots = managedRootsForProject(project)
    .map(realPathIfPresent)
    .filter((root) => isComparablePathInside(root, realProjectPath));
  const legacyRoots = [path.join(projectRoot, "output"), referencesDir]
    .map(realPathIfPresent)
    .filter((root) => isComparablePathInside(root, realProjectRoot) || isComparablePathInside(root, realConfigDir));
  return {
    project,
    managedRoots,
    legacyRoots,
    recorded: recordedAssetSourcesForProject(project)
  };
}

function decodeLocalAssetUrl(value) {
  if (typeof value !== "string" || !/^(?:naimage|iiimage)-asset:/i.test(value)) return "";
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/^\/+/, "");
    return pathname.startsWith("abs/")
      ? path.resolve(decodeURIComponent(pathname.slice(4)))
      : path.resolve(projectRoot, decodeURIComponent(pathname));
  } catch {
    return "";
  }
}

function isRecordedAssetPath(context, filePath) {
  return context.recorded.paths.has(comparablePath(filePath));
}

function resolveManagedAssetFile(asset, context) {
  const rawPath = typeof asset?.path === "string" && asset.path.trim()
    ? asset.path
    : decodeLocalAssetUrl(asset?.assetUrl) || decodeLocalAssetUrl(asset?.url);
  if (!rawPath) return "";
  const resolved = path.resolve(rawPath);
  if (!existsSync(resolved)) throw new Error("图片文件不存在，无法导出。");
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("图片路径不是受支持的普通文件。");
  const realFile = realpathSync(resolved);
  const managed = context.managedRoots.some((root) => isComparablePathInside(realFile, root));
  const recordedLegacy = context.legacyRoots.some((root) => isComparablePathInside(realFile, root)) && isRecordedAssetPath(context, resolved);
  if (!managed && !recordedLegacy) throw new Error("图片不属于当前项目管理的资产目录，已拒绝导出。");
  return realFile;
}

function detectImageFormat(buffer) {
  const detected = detectEncodedImageFormat(buffer);
  return detected ? { extension: detected.extension, mimeType: detected.mimeType } : null;
}

function inspectImageFile(filePath) {
  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size <= 0) throw new Error("图片文件为空或不可读取。");
  if (stats.size > maxExportImageBytes) throw new Error("图片文件超过 128 MB，已取消导出。");
  const descriptor = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(Math.min(32, stats.size));
    readSync(descriptor, header, 0, header.length, 0);
    const format = detectImageFormat(header);
    if (!format) throw new Error("只支持真实的 PNG、JPG 或 WEBP 图片文件。");
    return { path: filePath, size: stats.size, ...format };
  } finally {
    closeSync(descriptor);
  }
}

function normalizedExportAsset(input) {
  if (!input || typeof input !== "object") return null;
  return input.asset && typeof input.asset === "object" ? input.asset : input;
}

function remoteOrDataAssetSource(asset) {
  for (const value of [asset?.url, asset?.assetUrl]) {
    const source = typeof value === "string" ? value.trim() : "";
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(source)) return { kind: "data", value: source };
    if (/^https?:\/\//i.test(source)) return { kind: "remote", value: source };
  }
  return null;
}

function isRecordedRemoteOrDataSource(context, source) {
  return context.recorded.urls.has(source);
}

function imageBufferFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("图片 Data URL 格式无效。");
  const encoded = match[2].replace(/\s+/g, "");
  if (encoded.length > Math.ceil(maxExportImageBytes / 3) * 4 + 8) throw new Error("图片数据超过 128 MB，已取消导出。");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length <= 0 || buffer.length > maxExportImageBytes) throw new Error("图片数据大小无效。");
  return buffer;
}

async function imageBufferFromRemoteUrl(remoteUrl) {
  return remoteImageDownloads.download(remoteUrl, {
    maxBytes: maxExportImageBytes,
    timeoutMs: 30_000,
    maxRedirects: 5
  });
}

function secureExportSourceCacheDir(context) {
  const projectPath = path.resolve(context?.project?.path || "");
  const projectOutput = path.resolve(projectPath, "output");
  const realProject = realPathIfPresent(projectPath);
  const realOutput = realPathIfPresent(projectOutput);
  if (!isComparablePathInside(realOutput, realProject)) throw new Error("项目导出缓存目录越过了项目边界。");
  const requested = path.resolve(activeProjectTempDir(context.project.id), "export-sources");
  mkdirSync(requested, { recursive: true });
  const stats = lstatSync(requested);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("项目导出缓存目录不是安全的普通目录。");
  const realCache = realpathSync(requested);
  if (!isComparablePathInside(realCache, realOutput) || path.basename(realCache) !== "export-sources") {
    throw new Error("项目导出缓存目录包含不安全的链接。");
  }
  return realCache;
}

function materializedExportSourcePath(context, buffer, extension) {
  const digest = createHash("sha256").update(buffer).digest("hex");
  const cacheDir = secureExportSourceCacheDir(context);
  const filePath = path.join(cacheDir, `${digest}-${process.pid}${extension}`);
  if (!existsSync(filePath)) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, buffer);
    try {
      renameSync(tempPath, filePath);
    } catch (error) {
      if (existsSync(filePath)) rmSync(tempPath, { force: true });
      else throw error;
    }
  }
  return filePath;
}

function retainTransientExportSource(filePath) {
  const key = comparablePath(filePath);
  transientExportSourceRefs.set(key, (transientExportSourceRefs.get(key) || 0) + 1);
}

function releaseTransientExportSource(source, context) {
  if (!source?.transient || !source.path || !context?.project?.id) return;
  const key = comparablePath(source.path);
  const next = Math.max(0, (transientExportSourceRefs.get(key) || 1) - 1);
  if (next > 0) {
    transientExportSourceRefs.set(key, next);
    return;
  }
  transientExportSourceRefs.delete(key);
  try {
    const cacheDir = path.resolve(activeProjectTempDir(context.project.id), "export-sources");
    const resolved = path.resolve(source.path);
    const ownedNamePattern = new RegExp(`^[a-f0-9]{64}-${process.pid}\\.(?:png|jpe?g|webp)$`, "i");
    if (!ownedNamePattern.test(path.basename(resolved)) || !isComparablePathInside(resolved, cacheDir) || comparablePath(path.dirname(resolved)) !== comparablePath(cacheDir) || !existsSync(resolved)) return;
    const stats = lstatSync(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) return;
    const realCache = realpathSync(cacheDir);
    const realSource = realpathSync(resolved);
    if (!isComparablePathInside(realSource, realCache) || comparablePath(path.dirname(realSource)) !== comparablePath(realCache)) return;
    rmSync(realSource, { force: true });
  } catch (error) {
    log(`asset transient source cleanup failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

function releaseTransientExportSources(sources, context) {
  for (const source of Array.isArray(sources) ? sources : []) releaseTransientExportSource(source, context);
}

function cleanupAbandonedExportSourceCaches() {
  const list = readProjectList();
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const project of list.projects) {
    if (!project?.path) continue;
    const projectOutput = path.resolve(project.path, "output");
    const cacheDir = path.resolve(project.path, "output", "imagegen", "_plugin-temp", "export-sources");
    if (!isComparablePathInside(cacheDir, projectOutput) || path.basename(cacheDir) !== "export-sources" || !existsSync(cacheDir)) continue;
    try {
      const stats = lstatSync(cacheDir);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
      const realProject = realPathIfPresent(project.path);
      const realOutput = realPathIfPresent(projectOutput);
      const realCache = realpathSync(cacheDir);
      if (!isComparablePathInside(realOutput, realProject) || !isComparablePathInside(realCache, realOutput)) continue;
      let removed = 0;
      for (const entry of readdirSync(realCache, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        const candidate = path.join(realCache, entry.name);
        const candidateStats = lstatSync(candidate);
        if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) continue;
        const ownerMatch = entry.name.match(/^[a-f0-9]{64}-(\d+)\.(?:png|jpe?g|webp)(?:\.convert-\d+\.tmp)?$/i);
        const ownerPid = ownerMatch ? Number(ownerMatch[1]) : 0;
        if (ownerPid ? isProcessAlive(ownerPid) : candidateStats.mtimeMs >= cutoff) continue;
        const realCandidate = realpathSync(candidate);
        if (!isComparablePathInside(realCandidate, realCache) || comparablePath(path.dirname(realCandidate)) !== comparablePath(realCache)) continue;
        rmSync(realCandidate, { force: true });
        removed += 1;
      }
      if (removed > 0) log(`asset abandoned export cache cleared project=${project.id} count=${removed}`);
    } catch (error) {
      log(`asset abandoned export cache cleanup failed project=${project.id} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function materializeManagedImageAsset(input, context) {
  const asset = normalizedExportAsset(input);
  if (!asset) throw new Error("没有可导出的图片资产。");
  const localFile = resolveManagedAssetFile(asset, context);
  if (localFile) return { ...inspectImageFile(localFile), asset };

  const source = remoteOrDataAssetSource(asset);
  if (!source) throw new Error("图片缺少可用的项目文件或受支持的 URL。");
  if (!isRecordedRemoteOrDataSource(context, source.value)) {
    throw new Error("远程或内嵌图片未记录在当前项目中，已拒绝导出。");
  }
  const buffer = source.kind === "data" ? imageBufferFromDataUrl(source.value) : await imageBufferFromRemoteUrl(source.value);
  const format = detectImageFormat(buffer);
  if (!format) throw new Error("下载或内嵌的数据不是真实的 PNG、JPG 或 WEBP 图片。");
  const filePath = materializedExportSourcePath(context, buffer, format.extension);
  retainTransientExportSource(filePath);
  return { path: filePath, size: buffer.length, ...format, asset, transient: true };
}

function safeExportStem(value, fallback = "naimage-image") {
  const raw = path.parse(path.basename(String(value || ""))).name.normalize("NFKC");
  let stem = raw
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 96);
  if (!stem) stem = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`;
  return stem;
}

function aidebugAssetExportRoot() {
  if (!aidebugMode) throw new Error("AIDebug 导出路径只允许在 AIDebug 模式使用。");
  mkdirSync(debugDir, { recursive: true });
  const debugRoot = realpathSync(debugDir);
  const requested = path.join(debugRoot, "asset-export-tests");
  mkdirSync(requested, { recursive: true });
  const exportRoot = realpathSync(requested);
  if (!isComparablePathInside(exportRoot, debugRoot)) throw new Error("AIDebug 导出目录越过了诊断目录。");
  return exportRoot;
}

function aidebugExportFilePath(name, extension, fallback) {
  const root = aidebugAssetExportRoot();
  const filePath = path.join(root, `${safeExportStem(name, fallback)}${extension}`);
  if (!isComparablePathInside(filePath, root)) throw new Error("AIDebug 导出文件路径无效。");
  return filePath;
}

function preferredAssetName(asset, suggestedName, fallback = "naimage-image") {
  if (suggestedName) return suggestedName;
  if (asset?.title) return asset.title;
  if (asset?.originalName) return asset.originalName;
  if (asset?.path) return path.basename(asset.path);
  if (/^https?:\/\//i.test(String(asset?.url || ""))) {
    try {
      return decodeURIComponent(path.basename(new URL(asset.url).pathname));
    } catch {
      // Use the fallback below.
    }
  }
  return fallback;
}

function exportFileName(source, suggestedName, fallback = "naimage-image") {
  return `${safeExportStem(preferredAssetName(source.asset, suggestedName, fallback), fallback)}${source.extension}`;
}

function uniqueExportPath(parentDir, name) {
  const parsed = path.parse(name);
  let candidate = path.join(parentDir, name);
  for (let index = 2; existsSync(candidate); index += 1) {
    candidate = path.join(parentDir, `${parsed.name} (${index})${parsed.ext}`);
  }
  return candidate;
}

function normalizedExportItem(input, index) {
  const asset = normalizedExportAsset(input);
  if (!asset) return null;
  const requestedOrder = Number(input?.order ?? asset.index ?? index + 1);
  const opacityValue = Number(input?.opacity);
  const blendModeValue = String(input?.blendMode || "normal");
  return {
    asset,
    order: Number.isFinite(requestedOrder) ? Math.max(1, Math.round(requestedOrder)) : index + 1,
    sourceIndex: index,
    title: String(input?.title || asset.title || `图层 ${index + 1}`).trim().slice(0, 120) || `图层 ${index + 1}`,
    role: String(input?.role || "layer").trim().slice(0, 80) || "layer",
    visible: input?.visible !== false,
    opacity: Number.isFinite(opacityValue) ? Math.max(0, Math.min(1, opacityValue)) : 1,
    blendMode: exportBlendModes.has(blendModeValue) ? blendModeValue : "normal"
  };
}

function exportGroupMetadata(group = {}) {
  const groupNumber = Number(group.groupNumber);
  const width = Number(group.width);
  const height = Number(group.height);
  return {
    id: String(group.id || "").trim().slice(0, 120),
    title: String(group.title || "").trim().slice(0, 160),
    groupNumber: Number.isFinite(groupNumber) ? Math.max(1, Math.round(groupNumber)) : undefined,
    width: Number.isFinite(width) ? Math.max(1, Math.round(width)) : undefined,
    height: Number.isFinite(height) ? Math.max(1, Math.round(height)) : undefined
  };
}

function removeExportStagingFolder(stagingPath, parentPath) {
  const resolvedStaging = path.resolve(stagingPath);
  const resolvedParent = path.resolve(parentPath);
  if (!path.basename(resolvedStaging).startsWith(".naimage-export-") || !isComparablePathInside(resolvedStaging, resolvedParent)) return;
  if (existsSync(resolvedStaging)) rmSync(resolvedStaging, { recursive: true, force: true });
}

function outputDirForProjectId(projectId) {
  return outputBucketDirForProjectId(projectId, "imagegen");
}

async function importLocalImagesToProject(payload = {}) {
  const requestedProjectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  const outputDir = path.join(outputDirForProjectId(requestedProjectId), "imports");
  const projectPath = path.resolve(outputDir, "..", "..", "..");
  const requestedLimit = Number(payload.maxFiles);
  const maxFiles = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, maxImportedImageFiles))
    : maxImportedImageFiles;
  const importer = await currentProjectImageImporter();
  const startedAt = Date.now();
  imageImportCounters.requests += 1;
  imageImportCounters.active += 1;
  imageImportCounters.maxActiveRequests = Math.max(imageImportCounters.maxActiveRequests, imageImportCounters.active);
  try {
    const imported = await importer.importImages({
      inputPaths: Array.isArray(payload.paths) ? payload.paths : [],
      outputDir,
      maxFiles
    });
    const assets = imported.assets.map((asset, index) => ({
      contentHash: String(asset.sha256 || "").toLowerCase(),
      occurrenceId: String(asset.occurrenceId || "").slice(0, 80),
      importBatchId: String(asset.importBatchId || imported.importBatchId || "").slice(0, 160),
      importRootId: String(asset.importRootId || "").slice(0, 80),
      sourceRelativePath: safeImageSourceRelativePath(asset.sourceRelativePath),
      sourceRootLabel: String(asset.sourceRootLabel || "").slice(0, 260),
      sourceRootKind: asset.sourceRootKind === "directory" ? "directory" : "file",
      index: index + 1,
      type: "file",
      path: asset.path,
      relativePath: projectRelativePath(projectPath, asset.path),
      assetUrl: assetUrlFor(asset.path),
      originalName: asset.originalName || path.basename(asset.path),
      revisedPrompt: "",
      runId: "import-" + asset.sha256.slice(0, 16),
      width: Number(asset.width) || undefined,
      height: Number(asset.height) || undefined
    }));
    imageImportCounters.completed += 1;
    imageImportCounters.lastDurationMs = Date.now() - startedAt;
    imageImportCounters.lastSelectedCount = Number(imported.selectedCount) || 0;
    imageImportCounters.lastImportedCount = assets.length;
    imageImportCounters.lastSkippedCount = Number(imported.skippedCount) || 0;
    imageImportCounters.lastMaxActiveFiles = Number(imported.maxActiveFiles) || 0;
    imageImportCounters.lastWorkerPid = Number(imported.workerPid) || 0;
    imageImportCounters.lastErrorCode = "";
    log(`asset batch import project=${requestedProjectId || "active"} files=${assets.length} skipped=${imported.skippedCount} duration=${imageImportCounters.lastDurationMs}ms worker=${imported.workerPid}`);
    return {
      ok: true,
      assets,
      roots: (Array.isArray(imported.roots) ? imported.roots : []).map((root) => ({
        importBatchId: String(root.importBatchId || imported.importBatchId || "").slice(0, 160),
        importRootIndex: Math.max(0, Math.floor(Number(root.importRootIndex) || 0)),
        importRootId: String(root.importRootId || "").slice(0, 80),
        sourceRootLabel: String(root.sourceRootLabel || "").slice(0, 260),
        sourceRootKind: root.sourceRootKind === "directory" ? "directory" : "file"
      })),
      importBatchId: String(imported.importBatchId || "").slice(0, 160),
      selectedCount: imported.selectedCount,
      uniqueAssetCount: imported.uniqueAssetCount,
      occurrenceCount: imported.occurrenceCount,
      skippedCount: imported.skippedCount,
      truncated: imported.truncated,
      duplicateCount: imported.duplicateCount,
      reusedCount: imported.reusedCount,
      durationMs: imageImportCounters.lastDurationMs,
      maxActiveFiles: imported.maxActiveFiles,
      workerPid: imported.workerPid
    };
  } catch (error) {
    const code = String(error?.code || "IMAGE_IMPORT_FAILED");
    imageImportCounters.lastDurationMs = Date.now() - startedAt;
    imageImportCounters.lastErrorCode = code;
    if (code === "IMAGE_IMPORT_CLOSED") imageImportCounters.canceled += 1;
    else imageImportCounters.errors += 1;
    throw error;
  } finally {
    imageImportCounters.active = Math.max(0, imageImportCounters.active - 1);
  }
}

async function importLocalVideosToProject(payload = {}) {
  const requestedProjectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  const outputDir = outputBucketDirForProjectId(requestedProjectId, "video", "imports");
  const projectPath = path.resolve(outputDir, "..", "..", "..");
  const requestedLimit = Number(payload.maxFiles);
  const maxFiles = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, maxImportedVideoFiles))
    : maxImportedVideoFiles;
  const imported = await importVideoFiles({
    inputPaths: Array.isArray(payload.paths) ? payload.paths : [],
    outputDir,
    maxFiles
  });
  const assets = (imported.assets || []).map((asset) => ({
    ...asset,
    relativePath: projectRelativePath(projectPath, asset.path),
    assetUrl: assetUrlFor(asset.path)
  }));
  log(`asset video import project=${requestedProjectId || "active"} files=${assets.length} skipped=${imported.skippedCount || 0}`);
  return { ...imported, assets };
}

function sanitizeOutputBucket(value) {
  const normalized = String(value || "imagegen").trim().toLowerCase();
  return normalized === "post" || normalized === "imagegen" || normalized === "video" ? normalized : "imagegen";
}

function sanitizeOutputSubdir(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .split(/[\\/]+/)
    .map((part) => sanitizeFileStem(part, ""))
    .filter(Boolean)
    .slice(0, 4)
    .join(path.sep);
}

function outputBucketDirForProjectId(projectId, bucket = "imagegen", subdir = "") {
  const list = readProjectList();
  const requestedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  const project = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
  if (requestedProjectId && !project) throw new Error("输出目标项目不存在或已被移除。");
  if (!project?.path) throw new Error("当前没有可用的项目输出目录。");
  const projectPath = path.resolve(project?.path || path.dirname(currentSessionPath()) || projectRoot);
  const baseDir = path.join(projectPath, "output", sanitizeOutputBucket(bucket));
  const cleanSubdir = sanitizeOutputSubdir(subdir);
  return cleanSubdir ? path.join(baseDir, cleanSubdir) : baseDir;
}

function activeProjectOutputDir() {
  return outputDirForProjectId();
}

function activeProjectTempDir(projectId) {
  return path.join(outputDirForProjectId(projectId), "_plugin-temp");
}

function isTrustedRendererUrl(url) {
  try {
    const parsed = new URL(url);
    if (devUrl && url.startsWith(devUrl)) return true;
    if (parsed.protocol === "file:" && path.resolve(fileURLToPath(parsed)) === path.resolve(rendererIndex)) return true;
    return false;
  } catch {
    return false;
  }
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      shell.openExternal(url);
      return true;
    }
  } catch {
    // Invalid URLs are denied.
  }
  return false;
}

async function serverGenerateImage(payload = {}) {
  const settings = migrateSettings(readJson(settingsPath, defaultSettings));
  const runId = String(payload.runId || `agent-${Date.now()}`);
  const projectId = payload.projectId;
  const ownedMaskImage = payload.maskDataUrl
    ? writeDataUrlTemp(payload.maskDataUrl, `mask-${runId.replace(/[^a-z0-9_-]/gi, "-")}`, projectId)
    : null;
  const maskImage = ownedMaskImage || payload.maskImage;
  try {
    const data = await callNewApiImageWithSession(settings, {
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size || settings.imageSize,
      quality: payload.quality || settings.imageQuality,
      count: payload.count || settings.imageCount,
      referenceImages: Array.isArray(payload.referenceImages) ? payload.referenceImages : [],
      editImage: payload.editImage,
      maskImage,
      outputFormat: payload.outputFormat ?? payload.output_format,
      outputCompression: payload.outputCompression ?? payload.output_compression,
      background: payload.background,
      moderation: payload.moderation,
      inputFidelity: payload.inputFidelity ?? payload.input_fidelity,
      mode: payload.mode,
      runId,
      projectId
    });
    const stem = `agent-${runId.replace(/[^a-z0-9_-]/gi, "-")}`;
    const outputFormat = payload.outputFormat ?? payload.output_format ?? data.outputFormat ?? data.output_format ?? "png";
    const assets = await writeServerImageOutputs(
      extractServerImages(data),
      stem,
      runId,
      projectId,
      outputFormat,
      imageGenerationContext(payload, data, outputFormat)
    );
    log(`agent server generate image returned=${assets.length}`);
    return { ...data, assets, runId, returned: assets.length };
  } finally {
    removeOwnedDataUrlTemp(ownedMaskImage, projectId);
  }
}

async function serverChatCompletion(payload = {}) {
  if (aidebugBackend) {
    const startedAt = Date.now();
    log(`aidebug model start messages=${Array.isArray(payload.messages) ? payload.messages.length : 0} tools=${Array.isArray(payload.tools) ? payload.tools.length : 0} stream=${Boolean(payload.stream)}`);
    const result = aidebugBackend.chatCompletion(payload);
    log(`aidebug model done durationMs=${Date.now() - startedAt}`);
    return result;
  }
  const settings = migrateSettings(readJson(settingsPath, defaultSettings));
  await licenseService.requireActive();
  const callerSignal = payload.signal;
  const requestBody = {
    ...payload,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    model: payload.model || settings.agentModel,
    reasoning_effort: payload.reasoning_effort || payload.reasoningEffort || settings.reasoningEffort,
    service_tier: payload.service_tier || payload.serviceTier || (settings.fastMode ? "fast" : undefined),
    stream: Boolean(payload.stream ?? false)
  };
  if (!requestBody.service_tier) delete requestBody.service_tier;
  delete requestBody.reasoningEffort;
  delete requestBody.serviceTier;
  delete requestBody.fastMode;
  delete requestBody.signal;
  delete requestBody.onStreamEvent;
  delete requestBody._forceChatFallback;
  const hasNativeResponsesTool = Array.isArray(requestBody.tools) && requestBody.tools.some((tool) => String(tool?.type || "") === "web_search");
  const useResponsesApi = !payload._forceChatFallback && (hasNativeResponsesTool || agentModelUsesResponsesApi(requestBody.model));
  const endpoint = useResponsesApi ? "/v1/responses" : "/v1/chat/completions";
  const relayBody = useResponsesApi ? responsesRequestFromChatRequest(requestBody) : requestBody;
  const imageToolChoiceName = String(requestBody.tool_choice?.function?.name || requestBody.toolChoice?.function?.name || "");
  const configuredTimeoutMs = Math.max(15, Number(settings.timeoutSeconds ?? 180)) * 1000;
  const reasoningModelFloorMs = useResponsesApi ? 180_000 : 0;
  const timeoutMs = imageToolChoiceName === "image_gen"
    ? Math.min(Math.max(configuredTimeoutMs, reasoningModelFloorMs), 300_000)
    : Math.max(configuredTimeoutMs, reasoningModelFloorMs);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason || createAbortError("用户结束了当前任务。"));
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener?.("abort", abortFromCaller, { once: true });
  let timeoutError = null;
  let timeoutTimer = null;
  let streamOutputObserved = false;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutError = new Error(`Agent 模型请求超过 ${Math.round(timeoutMs / 1000)} 秒，已中断。`);
    timeoutTimer = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    if (requestBody.stream) {
      const chunks = [];
      await Promise.race([
        newApiRelayStream(settings, endpoint, relayBody, (event) => {
          chunks.push(event);
          const eventType = String(event?.type || "");
          if (/output_text|tool_call|function_call|response.completed|response.failed/i.test(eventType)) streamOutputObserved = true;
          if (typeof payload.onStreamEvent === "function") payload.onStreamEvent(event);
        }, { signal: controller.signal, headersTimeoutMs: timeoutMs, connectTimeoutMs: 30_000 }),
        timeoutPromise
      ]);
      markModelRuntimeVerified(settings, "agent", requestBody.model, useResponsesApi ? "openai-response" : "openai");
      log(`agent new-api ${useResponsesApi ? "responses" : "chat"} stream chunks=${chunks.length} model=${payload.model || settings.agentModel || "server-selected"}`);
      return { stream: true, chunks, model: payload.model || settings.agentModel };
    }
    const data = await Promise.race([
      newApiRelayJson(settings, endpoint, relayBody, { signal: controller.signal }),
      timeoutPromise
    ]);
    markModelRuntimeVerified(settings, "agent", requestBody.model, useResponsesApi ? "openai-response" : "openai");
    log(`agent new-api ${useResponsesApi ? "responses" : "chat"} model=${data.model || payload.model || settings.agentModel || "server-selected"}`);
    return data;
  } catch (error) {
    if (callerSignal?.aborted) throw createAbortError(callerSignal.reason);
    if (error === timeoutError || controller.signal.aborted) throw timeoutError;
    if (shouldFallbackResponsesToChat({
      hasNativeResponsesTool,
      forceChatFallback: payload._forceChatFallback === true,
      streamOutputObserved,
      error
    })) {
      log(`Responses chat unsupported; retrying once with Chat Completions model=${requestBody.model || "server-selected"}`);
      return serverChatCompletion({ ...payload, _forceChatFallback: true });
    }
    throw error;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    callerSignal?.removeEventListener?.("abort", abortFromCaller);
    controller.abort();
  }
}

function responsesChatUnsupportedError(error) {
  const status = Number(error?.status);
  if ([404, 405, 501].includes(status)) return true;
  if (![400, 422].includes(status)) return false;
  const payload = error?.data;
  const message = String(payload?.error?.message || payload?.message || error?.message || "").toLowerCase();
  return /(responses?|endpoint|route|tool|parameter|model)/.test(message)
    && /(unsupported|not supported|unknown|unrecognized|not found|no route|invalid|does not exist)/.test(message);
}

function shouldFallbackResponsesToChat({
  hasNativeResponsesTool = false,
  forceChatFallback = false,
  streamOutputObserved = false,
  error = null
} = {}) {
  // Chat Completions does not define the Responses-native web_search tool.
  // Never replay a request containing it against the Chat endpoint.
  return !forceChatFallback
    && !hasNativeResponsesTool
    && !streamOutputObserved
    && !error?.ambiguous
    && !error?.unsafeToRetry
    && responsesChatUnsupportedError(error);
}

function currentAgentSettings() {
  return migrateSettings(readJson(settingsPath, defaultSettings));
}

function getAgentRuntime() {
  if (!agentRuntime) {
    agentRuntime = createAgentRuntime({
      projectRoot: agentWorkspaceRoot,
      configDir,
      projectMetaDirName,
      resolveProjectRoot(projectId) {
        const project = getProjectById(String(projectId || "").trim(), readProjectList());
        return project?.path || "";
      },
      goalProbeAdmission,
      imageRoots: [referencesDir],
      includeProjectRootImageRoot: false,
      resolveImageRoots: agentImageRootsForContext,
      log: (message) => log(`agent ${message}`),
      allowModelForce: agentModelForceEnabled,
      allowToolChoiceForce: agentToolChoiceForceEnabled,
      allowToolArgCorrection: agentToolArgCorrectionEnabled,
      serverChatCompletion,
      serverGenerateImage: async (payload = {}) => {
        const settings = currentAgentSettings();
        const runId = String(payload.runId || `agent-${Date.now()}`);
        const projectId = payload.projectId;
        const ownedMaskImage = payload.maskDataUrl
          ? writeDataUrlTemp(payload.maskDataUrl, `mask-${runId.replace(/[^a-z0-9_-]/gi, "-")}`, projectId)
          : null;
        try {
          const data = await callNewApiImageWithSession(settings, {
            ...payload,
            maskImage: ownedMaskImage || payload.maskImage,
            maskDataUrl: undefined,
            runId
          });
          const outputFormat = payload.outputFormat ?? payload.output_format ?? data.outputFormat ?? data.output_format ?? "png";
          const stem = `agent-${runId.replace(/[^a-z0-9_-]/gi, "-")}`;
          const assets = await writeServerImageOutputs(
            extractServerImages(data),
            stem,
            runId,
            projectId,
            outputFormat,
            imageGenerationContext(payload, data, outputFormat)
          );
          return {
            ...data,
            ok: data.ok !== false,
            runId,
            assets,
            returned: assets.length
          };
        } finally {
          removeOwnedDataUrlTemp(ownedMaskImage, projectId);
        }
      }
    });
  }
  return agentRuntime;
}

function emitAgentProgress(sender, runId, payload = {}, scope = {}) {
  try {
    if (!sender || sender.isDestroyed?.()) return;
    sender.send("naimage:agent:progress", {
      ...payload,
      runId: payload.runId || runId,
      projectId: payload.projectId || scope.projectId || undefined,
      conversationId: payload.conversationId || scope.conversationId || undefined,
      createdAt: payload.createdAt || new Date().toISOString()
    });
  } catch (error) {
    log(`agent progress emit failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listAgentModels(provider, incomingSettings = {}) {
  const currentSettings = currentAgentSettings();
  const restoredSettings = settingsSecretStore.restorePlaceholders({
    ...currentSettings,
    ...(incomingSettings || {})
  }, currentSettings);
  const settings = migrateSettings(restoredSettings);
  const target = provider === "image" ? "image" : provider === "video" ? "video" : "agent";
  const serverSettings = await newApiModelSettings(settings);
  const models = uniqueImageModels(target === "image"
    ? serverSettings.imageModels
    : target === "video"
      ? serverSettings.videoModels
      : serverSettings.agentModels);
  return {
    ok: true,
    provider: target,
    models,
    count: models.length,
    cacheSource: serverSettings.cacheSource,
    cacheAgeMs: serverSettings.cacheAgeMs,
    cacheTtlMs: serverSettings.cacheTtlMs
  };
}

function normalizeServerUrl(value, fallback = defaultSettings.accountBaseUrl) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized || String(fallback || "").trim().replace(/\/+$/, "");
}

function isLocalServerUrl(value) {
  try {
    const url = new URL(normalizeServerUrl(value));
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function isLocalServerHealthy(serverUrl = defaultSettings.accountBaseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    for (const endpoint of ["/api/status", "/"]) {
      const response = await newApiTransportFetch(`${normalizeServerUrl(serverUrl)}${endpoint}`, {
        method: "GET",
        signal: controller.signal
      });
      // A paused IncomingMessage retains its socket. Health checks run every
      // eight seconds, so always consume the tiny response before returning or
      // trying the fallback endpoint.
      await response.text();
      if (response.ok) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLocalServer(serverUrl = defaultSettings.accountBaseUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isLocalServerHealthy(serverUrl)) return true;
    await delay(250);
  }
  return false;
}

function createLocalServerSpawnOptions() {
  return {
    cwd: localServerRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NAIMAGE_SERVER_PORT: "17860",
      NAIMAGE_PARENT_PID: String(process.pid)
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  };
}

function startLocalServerIfNeeded() {
  if (!existsSync(localServerEntry)) {
    log(`local server missing ${localServerEntry}`);
    return;
  }
  if (localServerProcess && !localServerProcess.killed) return;

  logBoot("local server spawn requested");
  localServerProcess = spawn(process.execPath, [localServerEntry], createLocalServerSpawnOptions());
  log(`local server start pid=${localServerProcess.pid}`);
  localServerProcess.stdout?.on("data", (chunk) => log(`server stdout ${String(chunk).trim()}`));
  localServerProcess.stderr?.on("data", (chunk) => log(`server stderr ${String(chunk).trim()}`));
  localServerProcess.on("error", (error) => {
    log(`local server spawn error ${error instanceof Error ? error.message : String(error)}`);
    localServerProcess = null;
  });
  localServerProcess.on("exit", (code, signal) => {
    log(`local server exit code=${code} signal=${signal}`);
    localServerProcess = null;
    if (!quitting) {
      setTimeout(() => {
        void ensureLocalServer();
      }, 1200);
    }
  });
}

async function ensureLocalServer(requestedBaseUrl = "") {
  if (localServerEnsurePromise) return localServerEnsurePromise;
  const task = (async () => {
    const startedAt = Date.now();
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    const accountBaseUrl = resolveNewApiBaseUrl(settings, "account");
    const relayBaseUrl = resolveNewApiBaseUrl(settings, "relay");
    const serverUrl = normalizeServerUrl(requestedBaseUrl, "") || [accountBaseUrl, relayBaseUrl].find(isLocalServerUrl) || "";
    if (!isLocalServerUrl(serverUrl)) return;
    if (await isLocalServerHealthy(serverUrl)) {
      log(`local server healthy in ${Date.now() - startedAt}ms`);
      return;
    }
    startLocalServerIfNeeded();
    if (!(await waitForLocalServer(serverUrl))) {
      log(`local server health timeout after ${Date.now() - startedAt}ms`);
      return;
    }
    log(`local server ready in ${Date.now() - startedAt}ms`);
  })();
  const wrapped = task.finally(() => {
    if (localServerEnsurePromise === wrapped) localServerEnsurePromise = null;
  });
  localServerEnsurePromise = wrapped;
  return wrapped;
}

function startLocalServerMonitor() {
  if (localServerMonitor) return;
  const settings = migrateSettings(readJson(settingsPath, defaultSettings));
  const monitoredBaseUrl = [resolveNewApiBaseUrl(settings, "account"), resolveNewApiBaseUrl(settings, "relay")].find(isLocalServerUrl) || "";
  if (!monitoredBaseUrl) {
    logBoot("local server monitor skipped for managed service");
    return;
  }
  void ensureLocalServer(monitoredBaseUrl);
  localServerMonitor = setInterval(() => {
    void ensureLocalServer(monitoredBaseUrl);
  }, 8000);
}

function stopLocalServer() {
  quitting = true;
  if (localServerMonitor) {
    clearInterval(localServerMonitor);
    localServerMonitor = null;
  }
  const child = localServerProcess;
  localServerProcess = null;
  if (child && child.exitCode === null && child.signalCode === null) {
    const pid = child.pid;
    const exited = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        clearTimeout(fallbackTimer);
        resolve(true);
      };
      const forceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may have exited between the timeout and this signal.
        }
      }, 2_000);
      const fallbackTimer = setTimeout(() => finish(), 3_000);
      child.once("exit", finish);
      child.once("close", finish);
    });
    try {
      if (typeof child.send === "function") {
        child.send("shutdown");
      }
      child.kill();
      log(`local server stop pid=${pid}`);
    } catch (error) {
      log(`local server stop failed pid=${pid} ${error instanceof Error ? error.message : String(error)}`);
    }
    return exited;
  }
  return Promise.resolve(true);
}

function shutdownApplicationServices() {
  if (applicationShutdownPromise) return applicationShutdownPromise;
  applicationShutdownStartedAt = Date.now();
  quitting = true;
  const stoppedRuns = agentRunControl.stopAll("SparkAI WorkSpace 正在退出，所有 Agent 运行已停止。");
  log(`shutdown agent runs stopped=${stoppedRuns.stopped}`);
  cancelQueuedImageEditRequests();
  const localServerStop = stopLocalServer();
  const cleanup = Promise.allSettled([
    localServerStop,
    automationService.stop(),
    stopActiveNewApiCurlTransports(),
    recycleProjectImageImporter(false),
    imageThumbnailCache.close(),
    Promise.resolve(agentWindowService.close()),
    Promise.resolve().then(() => goalProbeAdmission.dispose("Application shutdown.")),
    Promise.resolve().then(() => videoTaskService.dispose()),
    Promise.resolve().then(() => scientificRunnerService.dispose()),
    Promise.resolve().then(() => agentRuntime?.dispose?.())
  ]).then((results) => {
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        log(`shutdown service ${index} failed ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }
    return { timedOut: false };
  });
  const timeout = delay(5_000).then(() => ({ timedOut: true }));
  applicationShutdownPromise = Promise.race([cleanup, timeout])
    .then((result) => {
      applicationShutdownComplete = true;
      log(`shutdown complete duration=${Date.now() - applicationShutdownStartedAt}ms timedOut=${result.timedOut === true}`);
      return result;
    })
    .catch((error) => {
      applicationShutdownComplete = true;
      log(`shutdown failed duration=${Date.now() - applicationShutdownStartedAt}ms ${error instanceof Error ? error.message : String(error)}`);
      return { timedOut: false, error: error instanceof Error ? error.message : String(error) };
    });
  return applicationShutdownPromise;
}



function imageEditRequestLimiterStatus() {
  return {
    active: activeImageEditRequests,
    queued: queuedImageEditRequests.length,
    maximum: maximumConcurrentImageEditRequests
  };
}

function acquireImageEditRequestSlot() {
  if (quitting) return Promise.reject(Object.assign(new Error("应用正在退出，图片任务已取消。"), { code: "APP_SHUTDOWN" }));
  if (activeImageEditRequests < maximumConcurrentImageEditRequests) {
    activeImageEditRequests += 1;
    return Promise.resolve(releaseImageEditRequestSlot);
  }
  return new Promise((resolve, reject) => queuedImageEditRequests.push({ resolve, reject }));
}

function releaseImageEditRequestSlot() {
  activeImageEditRequests = Math.max(0, activeImageEditRequests - 1);
  while (queuedImageEditRequests.length) {
    const next = queuedImageEditRequests.shift();
    if (quitting) {
      next.reject(Object.assign(new Error("应用正在退出，图片任务已取消。"), { code: "APP_SHUTDOWN" }));
      continue;
    }
    activeImageEditRequests += 1;
    next.resolve(releaseImageEditRequestSlot);
    break;
  }
}

async function withImageEditRequestSlot(task) {
  const release = await acquireImageEditRequestSlot();
  try {
    return await task();
  } finally {
    release();
  }
}

function cancelQueuedImageEditRequests() {
  const error = Object.assign(new Error("应用正在退出，图片任务已取消。"), { code: "APP_SHUTDOWN" });
  for (const pending of queuedImageEditRequests.splice(0)) pending.reject(error);
}































function normalizeNewApiUser(userData = {}) {
  const username = String(userData.username || userData.email || userData.id || "").trim();
  const displayName = String(userData.displayName || userData.display_name || userData.name || username || "SparkAI WorkSpace User").trim();
  const quota = Number(userData.quota ?? userData.remain_quota ?? userData.balance ?? 0);
  const balanceCents = Number.isFinite(quota)
    ? Math.max(0, Math.round((quota / newApiQuotaPerUnit) * 100))
    : 0;
  return {
    id: String(userData.id || ""),
    email: String(userData.email || username || ""),
    username,
    account: username,
    name: displayName,
    balanceCents,
    trialImagesRemaining: 0,
    trialUsed: true,
    createdAt: userData.createdAt || (userData.created_time ? new Date(Number(userData.created_time) * 1000).toISOString() : undefined)
  };
}

function walletFromNewApiUser(userData = {}) {
  const user = normalizeNewApiUser(userData);
  return {
    balanceCents: user.balanceCents,
    balanceYuan: user.balanceCents / 100,
    imageCostCents: 0,
    imageCostYuan: 0
  };
}

function tokenItemsFromNewApiPayload(payload) {
  const source = payload?.data ?? payload;
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.items)) return source.items;
  if (Array.isArray(source?.Items)) return source.Items;
  if (Array.isArray(source?.data)) return source.data;
  return [];
}

function modelCacheKey(settings) {
  const bindingFingerprint = modelBindingCacheFingerprint(settings);
  let credentialIdentity = isCustomApiMode(settings)
    ? `custom-api:${bindingFingerprint}`
    : `${settings.serverUserId || "anonymous"}:${bindingFingerprint}`;
  if (isCustomApiMode(settings)) {
    const fingerprints = [];
    for (const provider of ["agent", "image"]) {
      try {
        const credentials = customApiCredentials(settings, provider);
        fingerprints.push(`${provider}:${createHash("sha256")
          .update(`${credentials.baseUrl.toLowerCase()}\n${credentials.apiKey}`)
          .digest("hex")}`);
      } catch {
        fingerprints.push(`${provider}:unavailable`);
      }
    }
    credentialIdentity = `custom-api:${createHash("sha256").update(`${fingerprints.join("\n")}\n${bindingFingerprint}`).digest("hex")}`;
  }
  return createModelCacheKey(
    isCustomApiMode(settings) ? settings.agentBaseUrl : resolveNewApiBaseUrl(settings, "account"),
    isCustomApiMode(settings) ? settings.imageBaseUrl : directApiUrl(resolveNewApiBaseUrl(settings, "account"), "/v1"),
    credentialIdentity,
    isCustomApiMode(settings) ? settings.modelGroup : settings.selectedAccountTokenId
  );
}

function loadModelCacheFromDisk(settings) {
  if (modelCacheDiskLoaded) return;
  modelCacheDiskLoaded = true;
  const stored = readJson(modelCachePath, { version: 1, entries: {} });
  const entries = stored && typeof stored.entries === "object" && stored.entries ? stored.entries : {};
  for (const [key, entry] of Object.entries(entries)) {
    const cachedAt = Number(entry?.cachedAt || 0);
    if (!cachedAt || !entry?.settings) continue;
    modelCacheMemory.set(key, {
      cachedAt,
      settings: cachedModelSettings(settings, entry.settings)
    });
  }
}

function persistModelCache() {
  const entries = {};
  const sorted = [...modelCacheMemory.entries()]
    .sort((left, right) => Number(right[1]?.cachedAt || 0) - Number(left[1]?.cachedAt || 0))
    .slice(0, 20);
  for (const [key, entry] of sorted) {
    entries[key] = { cachedAt: entry.cachedAt, settings: entry.settings };
  }
  writeJson(modelCachePath, { version: 1, ttlMs: modelCacheTtlMs, entries });
}

function modelSettingsWithCacheMeta(settings, cacheSource, cachedAt) {
  return {
    ...settings,
    cacheSource,
    cacheAgeMs: Math.max(0, Date.now() - Number(cachedAt || Date.now())),
    cacheTtlMs: modelCacheTtlMs
  };
}

function markModelRuntimeVerified(settings, provider, model, endpointType) {
  const targetModel = String(model || "").trim();
  if (!targetModel) return false;
  loadModelCacheFromDisk(settings);
  const key = modelCacheKey(settings);
  const entry = modelCacheMemory.get(key);
  if (!entry?.settings) return false;
  const profiles = markModelAccessProfilesVerified(entry.settings.modelAccessProfiles, {
    provider,
    model: targetModel,
    endpointType,
    verifiedAt: new Date().toISOString()
  });
  if (JSON.stringify(profiles) === JSON.stringify(entry.settings.modelAccessProfiles || [])) return false;
  entry.settings = cachedModelSettings(settings, { ...entry.settings, modelAccessProfiles: profiles });
  modelCacheMemory.set(key, entry);
  persistModelCache();
  return true;
}

function modelAccessProfileId(baseUrl, credentialIdentity) {
  return `model-access-${createHash("sha256")
    .update(`${String(baseUrl || "").trim().toLowerCase()}\n${String(credentialIdentity || "anonymous")}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function providerModelSettings(settings, payload, provider) {
  const split = splitModelSettings(settings, payload.modelIds, [], payload.modelCapabilities);
  if (provider === "agent") return split.agentModels;
  if (provider === "video") return split.videoModels;
  return split.imageModels;
}

function serviceStatus(state, profileIds, error, lastCheckedAt) {
  return {
    state,
    profileIds: [...new Set((profileIds || []).filter(Boolean))],
    ...(error ? { error: String(error).slice(0, 1_000) } : {}),
    lastCheckedAt
  };
}

async function fetchNewApiModelSettings(settings) {
  const lastCheckedAt = new Date().toISOString();
  if (isCustomApiMode(settings)) {
    const grouped = new Map();
    const providerErrors = {};
    const providerPayloads = {};
    const profiles = [];
    for (const provider of ["agent", "image", "video"]) {
      try {
        const credentialProvider = provider === "agent" ? "agent" : "image";
        const credentials = customApiCredentials(settings, credentialProvider);
        const credentialFingerprint = createHash("sha256")
          .update(`${credentials.baseUrl.toLowerCase()}\n${credentials.apiKey}`)
          .digest("hex");
        const existing = grouped.get(credentialFingerprint) || {
          credentialFingerprint,
          credentials,
          providers: []
        };
        existing.providers.push(provider);
        grouped.set(credentialFingerprint, existing);
      } catch (error) {
        providerErrors[provider] = error instanceof Error ? error.message : String(error);
      }
    }

    for (const group of grouped.values()) {
      const profileId = modelAccessProfileId(group.credentials.baseUrl, group.credentialFingerprint);
      try {
        const request = await newApiFetch(settings, "/v1/models", {
          method: "GET",
          absoluteUrl: directApiUrl(group.credentials.baseUrl, "/v1/models"),
          requestBaseUrl: group.credentials.baseUrl,
          headers: { authorization: `Bearer ${group.credentials.apiKey}` },
          timeoutMs: 20_000,
          retries: 1
        });
        if (!request.response.ok || request.data?.error || request.data?.parseFailed) {
          throw new Error(newApiErrorMessage(request.data, request.response.status));
        }
        const modelIds = modelIdsFromResponse(request.data);
        const modelCapabilities = modelCapabilitiesFromResponse(request.data);
        const payload = { modelIds, modelCapabilities, profileId };
        for (const provider of group.providers) providerPayloads[provider] = payload;
        profiles.push(createModelAccessProfile({
          id: profileId,
          label: group.providers.includes("agent") && group.providers.some((provider) => provider !== "agent")
            ? "自定义统一接入"
            : group.providers.includes("agent")
              ? "自定义 Agent 接入"
              : "自定义图片 / 视频接入",
          baseUrl: group.credentials.baseUrl,
          credentialLabel: "自定义 API Key",
          providers: group.providers,
          modelIds,
          modelCapabilities,
          lastCheckedAt
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const provider of group.providers) providerErrors[provider] = message;
        profiles.push(createModelAccessProfile({
          id: profileId,
          label: group.providers.includes("agent") && group.providers.some((provider) => provider !== "agent")
            ? "自定义统一接入"
            : group.providers.includes("agent")
              ? "自定义 Agent 接入"
              : "自定义图片 / 视频接入",
          baseUrl: group.credentials.baseUrl,
          credentialLabel: "自定义 API Key",
          providers: group.providers,
          lastCheckedAt,
          error: message
        }));
      }
    }

    const collected = Object.values(providerPayloads).flatMap((payload) => payload.modelIds || []);
    const modelCapabilities = mergeModelCapabilities(...Object.values(providerPayloads).map((payload) => payload.modelCapabilities));
    const profileIdsFor = (provider) => profiles.filter((profile) => profile?.providers?.includes(provider)).map((profile) => profile.id);
    const serviceStatuses = Object.fromEntries(["agent", "image", "video"].map((provider) => [
      provider,
      serviceStatus(providerPayloads[provider] ? "ready" : "unavailable", profileIdsFor(provider), providerErrors[provider], lastCheckedAt)
    ]));
    const split = splitModelSettings(settings, collected, [], modelCapabilities, {
      modelAccessProfiles: profiles,
      serviceStatuses
    });
    return {
      ...split,
      agentModels: providerPayloads.agent ? providerModelSettings(settings, providerPayloads.agent, "agent") : splitModelSettings(settings, []).agentModels,
      imageModels: providerPayloads.image ? providerModelSettings(settings, providerPayloads.image, "image") : splitModelSettings(settings, []).imageModels,
      videoModels: providerPayloads.video ? providerModelSettings(settings, providerPayloads.video, "video") : splitModelSettings(settings, []).videoModels
    };
  }
  const collected = [];
  let modelCapabilities = {};
  let modelGroups = [];
  let groupsLoaded = false;
  let successfulRequests = 0;
  let lastError = null;
  let directoryPayload = null;
  let relayPayload = null;
  const profiles = [];
  try {
    const groupsResponse = await newApiRequest(settings, "/api/user/self/groups", {
      headers: newApiUserAuthHeaders(settings),
      userAuth: true,
      retries: 0
    });
    groupsLoaded = true;
    modelGroups = modelGroupsFromResponse(groupsResponse);
  } catch (error) {
    log(`new-api user groups failed ${error instanceof Error ? error.message : String(error)}`);
  }
  const requestedGroup = String(settings.selectedAccountTokenGroup || settings.modelGroup || "").trim();
  const selectedGroup = groupsLoaded && requestedGroup && !modelGroups.some((group) => group.id === requestedGroup)
    ? ""
    : requestedGroup;
  const groupQuery = selectedGroup ? `?group=${encodeURIComponent(selectedGroup)}` : "";
  try {
    const userModels = await newApiRequest(settings, `/api/user/models${groupQuery}`, {
      headers: newApiUserAuthHeaders(settings),
      userAuth: true,
      retries: 0
    });
    successfulRequests += 1;
    const modelIds = modelIdsFromResponse(userModels);
    const capabilities = modelCapabilitiesFromResponse(userModels);
    directoryPayload = { modelIds, modelCapabilities: capabilities };
    collected.push(...modelIds);
    modelCapabilities = mergeModelCapabilities(modelCapabilities, capabilities);
    profiles.push(createModelAccessProfile({
      id: modelAccessProfileId(resolveNewApiBaseUrl(settings, "account"), `directory:${settings.serverUserId || "anonymous"}:${selectedGroup || "default"}`),
      label: "账户模型目录",
      baseUrl: resolveNewApiBaseUrl(settings, "account"),
      credentialLabel: selectedGroup ? `分组 ${selectedGroup}` : "默认分组",
      providers: ["agent", "image", "video"],
      modelIds,
      modelCapabilities: capabilities,
      lastCheckedAt
    }));
  } catch (error) {
    lastError = error;
    log(`new-api user models failed ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (settings.serverSessionCookie && settings.serverUserId) {
      const credentials = await accountTokenService.credentials(settings);
      const { response, data } = await newApiFetch(settings, "/v1/models", {
        absoluteUrl: directApiUrl(credentials.baseUrl, "/v1/models"),
        requestBaseUrl: credentials.baseUrl,
        headers: { authorization: `Bearer ${credentials.apiKey}` },
        timeoutMs: 20_000,
        retries: 0
      });
      if (response.ok && data.parseFailed !== true && !data.error) {
        successfulRequests += 1;
        const modelIds = modelIdsFromResponse(data);
        const capabilities = modelCapabilitiesFromResponse(data);
        relayPayload = { modelIds, modelCapabilities: capabilities };
        collected.push(...modelIds);
        modelCapabilities = mergeModelCapabilities(modelCapabilities, capabilities);
        profiles.push(createModelAccessProfile({
          id: modelAccessProfileId(credentials.baseUrl, `token:${settings.selectedAccountTokenId || credentials.id || "selected"}`),
          label: "所选账户 Token",
          baseUrl: credentials.baseUrl,
          credentialLabel: settings.selectedAccountTokenName
            ? `${settings.selectedAccountTokenName}${settings.selectedAccountTokenGroup ? ` · ${settings.selectedAccountTokenGroup}` : ""}`
            : settings.selectedAccountTokenId
              ? `Token #${settings.selectedAccountTokenId}`
              : "账户 Token",
          providers: ["agent", "image", "video"],
          modelIds,
          modelCapabilities: capabilities,
          lastCheckedAt
        }));
      } else {
        lastError = new Error(newApiErrorMessage(data, response.status));
        profiles.push(createModelAccessProfile({
          id: modelAccessProfileId(credentials.baseUrl, `token:${settings.selectedAccountTokenId || credentials.id || "selected"}`),
          label: "所选账户 Token",
          baseUrl: credentials.baseUrl,
          credentialLabel: settings.selectedAccountTokenName || (settings.selectedAccountTokenId ? `Token #${settings.selectedAccountTokenId}` : "账户 Token"),
          providers: ["agent", "image", "video"],
          lastCheckedAt,
          error: lastError.message
        }));
      }
    }
  } catch (error) {
    lastError = error;
    const message = error instanceof Error ? error.message : String(error);
    const baseUrl = resolveNewApiBaseUrl(settings, "account");
    profiles.push(createModelAccessProfile({
      id: modelAccessProfileId(baseUrl, `token:${settings.selectedAccountTokenId || "selected"}`),
      label: "所选账户 Token",
      baseUrl,
      credentialLabel: settings.selectedAccountTokenName
        ? `${settings.selectedAccountTokenName}${settings.selectedAccountTokenGroup ? ` · ${settings.selectedAccountTokenGroup}` : ""}`
        : settings.selectedAccountTokenId
          ? `Token #${settings.selectedAccountTokenId}`
          : "账户 Token",
      providers: ["agent", "image", "video"],
      lastCheckedAt,
      error: message
    }));
    log(`managed relay models failed ${message}`);
  }
  const relayError = relayPayload ? "" : lastError instanceof Error ? lastError.message : lastError ? String(lastError) : "";
  const state = relayPayload ? "ready" : directoryPayload ? "catalog-only" : "unavailable";
  const profileIds = profiles.map((profile) => profile?.id).filter(Boolean);
  const serviceStatuses = Object.fromEntries(["agent", "image", "video"].map((provider) => [
    provider,
    serviceStatus(state, profileIds, relayError, lastCheckedAt)
  ]));
  const split = splitModelSettings({ ...settings, modelGroup: selectedGroup }, collected, modelGroups, modelCapabilities, {
    modelAccessProfiles: profiles,
    serviceStatuses
  });
  return successfulRequests === 0 ? { ...split, modelCatalogUnavailable: true } : split;
}

async function newApiModelSettings(settings, options = {}) {
  const forceRefresh = options?.forceRefresh === true;
  const cacheOnly = options?.cacheOnly === true;
  const cacheWasAlreadyLoaded = modelCacheDiskLoaded;
  loadModelCacheFromDisk(settings);
  const key = modelCacheKey(settings);
  const now = Date.now();
  const memoryEntry = modelCacheMemory.get(key);
  if (cacheOnly) {
    if (memoryEntry) {
      return modelSettingsWithCacheMeta(memoryEntry.settings, cacheWasAlreadyLoaded ? "memory" : "disk", memoryEntry.cachedAt);
    }
    const fallbackModels = [
      ...(Array.isArray(settings.agentModelPool) ? settings.agentModelPool : []),
      ...(Array.isArray(settings.imageModelPool) ? settings.imageModelPool : []),
      ...(Array.isArray(settings.videoModelPool) ? settings.videoModelPool : []),
      settings.agentModel,
      settings.imageModel,
      settings.videoModel
    ];
    return modelSettingsWithCacheMeta(
      cachedModelSettings(settings, { models: fallbackModels }),
      "settings",
      now
    );
  }
  if (!forceRefresh && memoryEntry && now - memoryEntry.cachedAt < modelCacheTtlMs) {
    return modelSettingsWithCacheMeta(memoryEntry.settings, cacheWasAlreadyLoaded ? "memory" : "disk", memoryEntry.cachedAt);
  }

  if (modelCacheInflight.has(key)) {
    const pending = await modelCacheInflight.get(key);
    if (!forceRefresh) return pending;
  }
  const request = (async () => {
    try {
      const loaded = aidebugMode && !aidebugLiveImage
        ? cachedModelSettings(settings, aidebugPublicSettings)
        : await fetchNewApiModelSettings(settings);
      if (loaded.modelCatalogUnavailable === true) {
        const base = memoryEntry?.settings || loaded;
        const entry = {
          cachedAt: memoryEntry?.cachedAt || Date.now(),
          settings: cachedModelSettings(settings, {
            ...base,
            modelAccessProfiles: mergeModelAccessProfiles(base.modelAccessProfiles, loaded.modelAccessProfiles),
            serviceStatuses: loaded.serviceStatuses
          })
        };
        modelCacheMemory.set(key, entry);
        persistModelCache();
        return modelSettingsWithCacheMeta(entry.settings, memoryEntry ? "stale" : "network", entry.cachedAt);
      }
      const preservedProfiles = preserveRuntimeVerifiedModelAccessProfiles(
        loaded.modelAccessProfiles,
        memoryEntry?.settings?.modelAccessProfiles
      );
      const entry = {
        cachedAt: Date.now(),
        settings: cachedModelSettings(settings, { ...loaded, modelAccessProfiles: preservedProfiles })
      };
      modelCacheMemory.set(key, entry);
      persistModelCache();
      return modelSettingsWithCacheMeta(entry.settings, "network", entry.cachedAt);
    } catch (error) {
      if (memoryEntry) {
        log(`model cache stale fallback ${error instanceof Error ? error.message : String(error)}`);
        return modelSettingsWithCacheMeta(memoryEntry.settings, "stale", memoryEntry.cachedAt);
      }
      throw error;
    } finally {
      modelCacheInflight.delete(key);
    }
  })();
  modelCacheInflight.set(key, request);
  return request;
}

function normalizeServerImageInput(value, fallbackName = "image.png") {
  if (!value) return null;
  if (typeof value === "string") {
    const imagePath = value.trim();
    if (!imagePath || !existsSync(imagePath)) return null;
    return { path: imagePath, mimeType: mimeTypeForPath(imagePath), name: path.basename(imagePath) || fallbackName };
  }
  if (typeof value === "object") {
    if (typeof value.path === "string" && existsSync(value.path)) {
      return {
        path: value.path,
        mimeType: value.mimeType || mimeTypeForPath(value.path),
        name: value.name || path.basename(value.path) || fallbackName,
        role: value.role ? String(value.role).replace(/\s+/g, " ").trim().slice(0, 80) : undefined,
        purpose: value.purpose ? String(value.purpose).replace(/\s+/g, " ").trim().slice(0, 320) : undefined
      };
    }
    if (typeof value.dataUrl === "string" && /^data:image\//i.test(value.dataUrl)) {
      const temporary = writeDataUrlTemp(value.dataUrl, `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      return temporary ? {
        ...temporary,
        role: value.role ? String(value.role).replace(/\s+/g, " ").trim().slice(0, 80) : undefined,
        purpose: value.purpose ? String(value.purpose).replace(/\s+/g, " ").trim().slice(0, 320) : undefined
      } : null;
    }
  }
  return null;
}

function normalizeServerReferenceImages(value, limit = 6) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item, index) => normalizeServerImageInput(item, `reference-${index + 1}.png`))
    .filter(Boolean)
    .slice(0, limit);
}

function isGptImageModel(model) {
  return /^gpt-image-/i.test(String(model || "")) || /^chatgpt-image-latest$/i.test(String(model || ""));
}

function explicitCollageRequested(prompt) {
  return /(拼接|拼图|合并成一张|同一张图|同一画布|九宫格|三联图|四宫格|分镜|拼贴|长图|contact\s*sheet|collage|diptych|triptych)/i.test(
    String(prompt || "")
  );
}

function stripMultiImageCountDirective(prompt) {
  return String(prompt || "")
    .replace(/(请|帮我|给我|麻烦)?\s*(生成|画|出|做|绘制|创作)\s*([一二两三四五六七八九十\d]{1,3})\s*(张|版|个版本|个方案)\s*/gi, "")
    .replace(/([一二两三四五六七八九十\d]{1,3})\s*(张|版|个版本|个方案)\s*(不同)?\s*(风格|版本|方案|图片|图像)?/gi, "")
    .replace(/\b(count|n)\s*[:=]\s*\d{1,2}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function promptForIndependentImage(prompt, count, index) {
  const raw = String(prompt || "").trim();
  if (count <= 1 || explicitCollageRequested(raw)) return raw;
  const singlePrompt = stripMultiImageCountDirective(raw) || raw;
  return [
    singlePrompt,
    "",
    `独立图片 ${index + 1}/${count}：只生成一张完整画面。不要把多张图片拼接到同一张画布中；不要三联图、九宫格、分镜、拼贴、contact sheet、before/after 对比图。`
  ].join("\n");
}

function encodedImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      if (sofMarkers.has(marker) && offset + 7 < buffer.length) {
        return { height: buffer.readUInt16BE(offset + 4), width: buffer.readUInt16BE(offset + 6) };
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 1;
        continue;
      }
      if (offset + 2 >= buffer.length) break;
      const length = buffer.readUInt16BE(offset + 1);
      if (length < 2) break;
      offset += 1 + length;
    }
  }
  if (buffer.length >= 20 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const chunkType = buffer.subarray(offset, offset + 4).toString("ascii");
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const dataOffset = offset + 8;
      if (chunkSize > buffer.length - dataOffset) break;
      if (chunkType === "VP8X" && chunkSize >= 10) {
        return {
          width: buffer.readUIntLE(dataOffset + 4, 3) + 1,
          height: buffer.readUIntLE(dataOffset + 7, 3) + 1
        };
      }
      if (chunkType === "VP8L" && chunkSize >= 5 && buffer[dataOffset] === 0x2f) {
        const b1 = buffer[dataOffset + 1];
        const b2 = buffer[dataOffset + 2];
        const b3 = buffer[dataOffset + 3];
        const b4 = buffer[dataOffset + 4];
        return {
          width: 1 + b1 + ((b2 & 0x3f) << 8),
          height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
        };
      }
      if (
        chunkType === "VP8 " &&
        chunkSize >= 10 &&
        buffer[dataOffset + 3] === 0x9d &&
        buffer[dataOffset + 4] === 0x01 &&
        buffer[dataOffset + 5] === 0x2a
      ) {
        return {
          width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
          height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
        };
      }
      const paddedSize = chunkSize + (chunkSize % 2);
      if (paddedSize > Number.MAX_SAFE_INTEGER - dataOffset) break;
      offset = dataOffset + paddedSize;
    }
  }
  return null;
}

function assertSafeEncodedImageDimensions(buffer, name) {
  const dimensions = encodedImageDimensions(buffer);
  if (!dimensions) return;
  if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > 12_000 || dimensions.height > 12_000 || dimensions.width * dimensions.height > 64_000_000) {
    const error = new Error(`图片 ${name} 像素尺寸过大或无效，请先缩小后再处理。`);
    error.code = "NAIMAGE_SOURCE_DIMENSIONS_TOO_LARGE";
    throw error;
  }
}

function boundedImageRead(filePath, maximumBytes, name, kind = "图片") {
  const safeMaximum = Math.max(1, Math.floor(Number(maximumBytes) || 0));
  const descriptor = openSync(filePath, "r");
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile()) {
      const error = new Error(`${kind} ${name} 不是有效文件。`);
      error.code = "NAIMAGE_SOURCE_NOT_FILE";
      throw error;
    }
    if (info.size > safeMaximum) {
      const error = new Error(`${kind} ${name} 超过 ${Math.round(safeMaximum / 1024 / 1024)}MB。`);
      error.code = "NAIMAGE_SOURCE_TOO_LARGE";
      throw error;
    }

    // The descriptor is authoritative: never trust a path-level stat followed
    // by readFileSync, because the file can be replaced or grow between both
    // calls. Read at most maximumBytes + 1 so a racing writer cannot force an
    // unbounded allocation or hide that the upload crossed the hard limit.
    const ceiling = safeMaximum + 1;
    let capacity = Math.min(ceiling, Math.max(64 * 1024, Number(info.size || 0) + 1));
    let buffer = Buffer.allocUnsafe(capacity);
    let offset = 0;
    while (offset < ceiling) {
      if (offset === buffer.length) {
        const nextCapacity = Math.min(ceiling, Math.max(offset + 64 * 1024, buffer.length * 2));
        if (nextCapacity <= buffer.length) break;
        const expanded = Buffer.allocUnsafe(nextCapacity);
        buffer.copy(expanded, 0, 0, offset);
        buffer = expanded;
      }
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > safeMaximum) {
      const error = new Error(`${kind} ${name} 在读取期间发生变化或超过 ${Math.round(safeMaximum / 1024 / 1024)}MB。`);
      error.code = "NAIMAGE_SOURCE_TOO_LARGE";
      throw error;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

function prepareImageUploadPart(image, aggressive = false) {
  const imageName = image.name || path.basename(image.path);
  const original = boundedImageRead(image.path, 32 * 1024 * 1024, imageName);
  assertSafeEncodedImageDimensions(original, imageName);
  const softLimit = aggressive ? 900_000 : 1_350_000;
  if (!aggressive && original.length <= softLimit) {
    return { buffer: original, mimeType: image.mimeType || "image/png", name: image.name || path.basename(image.path) || "image.png", originalBytes: original.length, uploadBytes: original.length, compressed: false };
  }
  const decoded = nativeImage.createFromBuffer(original);
  if (decoded.isEmpty()) {
    const error = new Error(`图片 ${image.name || path.basename(image.path)} 无法解码，请重新导入有效的 PNG、JPEG 或 WebP。`);
    error.code = "NAIMAGE_SOURCE_DECODE_FAILED";
    throw error;
  }
  const dimensions = decoded.getSize();
  if (dimensions.width > 12_000 || dimensions.height > 12_000 || dimensions.width * dimensions.height > 64_000_000) {
    const error = new Error(`图片 ${image.name || path.basename(image.path)} 像素尺寸过大，请先缩小后再处理。`);
    error.code = "NAIMAGE_SOURCE_DIMENSIONS_TOO_LARGE";
    throw error;
  }
  const qualities = aggressive ? [68, 58, 48] : [88, 80, 72];
  let best = original;
  for (const quality of qualities) {
    const candidate = decoded.toJPEG(quality);
    if (candidate.length > 0 && candidate.length < best.length) best = candidate;
    if (best.length <= softLimit) break;
  }
  if (best === original) {
    if (original.length > 16 * 1024 * 1024) {
      const error = new Error(`图片 ${image.name || path.basename(image.path)} 无法压缩到安全上传大小，请先缩小后再处理。`);
      error.code = "NAIMAGE_SOURCE_UPLOAD_TOO_LARGE";
      throw error;
    }
    return { buffer: original, mimeType: image.mimeType || "image/png", name: image.name || path.basename(image.path) || "image.png", originalBytes: original.length, uploadBytes: original.length, compressed: false };
  }
  if (best.length > 16 * 1024 * 1024) {
    const error = new Error(`图片 ${image.name || path.basename(image.path)} 压缩后仍过大，请先缩小后再处理。`);
    error.code = "NAIMAGE_SOURCE_UPLOAD_TOO_LARGE";
    throw error;
  }
  const originalName = image.name || path.basename(image.path) || "image.png";
  return {
    buffer: best,
    mimeType: "image/jpeg",
    name: originalName.replace(/\.[^.]+$/, "") + ".jpg",
    originalBytes: original.length,
    uploadBytes: best.length,
    compressed: true
  };
}

const completedUsageNumberFields = [
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "prompt_tokens",
  "completion_tokens",
  "image_tokens",
  "images",
  "cost",
  "cost_cents",
  "charged_cents",
  "quota"
];

function normalizeCompletedProviderUsage(value, requestIndex) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = { requestIndex };
  for (const field of completedUsageNumberFields) {
    const numeric = Number(value[field]);
    if (Number.isFinite(numeric) && numeric >= 0) usage[field] = numeric;
  }
  return Object.keys(usage).length > 1 ? usage : null;
}

function imageEditRequestHeaders(requestHeaders = {}, customMode = false, credentials = null) {
  const next = { ...(requestHeaders && typeof requestHeaders === "object" ? requestHeaders : {}) };
  if (!customMode) return next;
  for (const key of Object.keys(next)) {
    if (String(key).toLowerCase() === "authorization") delete next[key];
  }
  const apiKey = String(credentials?.apiKey || "").trim();
  if (apiKey) next.authorization = `Bearer ${apiKey}`;
  return next;
}

function completedImageAccounting(responses) {
  const providerUsage = [];
  let costCents = 0;
  let hasCost = false;
  for (const [index, response] of responses.entries()) {
    const usage = normalizeCompletedProviderUsage(response?.usage, index + 1);
    if (usage) providerUsage.push(usage);
    const rawCost = response?.costCents ?? response?.chargedCents ?? response?.usage?.cost_cents ?? response?.usage?.charged_cents;
    const numericCost = Number(rawCost);
    if (Number.isFinite(numericCost) && numericCost >= 0) {
      costCents += numericCost;
      hasCost = true;
    }
  }
  return {
    ...(providerUsage.length ? { providerUsage } : {}),
    ...(hasCost ? { costCents } : {})
  };
}

async function callNewApiImage(settings, payload = {}) {
  if (payload.signal?.aborted) throw createAbortError(payload.signal.reason);
  const rawOutputFormat = payload.outputFormat ?? payload.output_format;
  const outputFormat = normalizeEncodedImageFormat(rawOutputFormat);
  if (String(rawOutputFormat ?? "").trim() && !outputFormat) {
    const error = new Error(`不支持的生图格式：${String(rawOutputFormat).trim()}。仅支持 PNG、JPEG 和 WebP。`);
    error.code = "NAIMAGE_IMAGE_OUTPUT_FORMAT_UNSUPPORTED";
    error.failureKind = "validation";
    throw error;
  }
  if (!aidebugMode) await licenseService.requireActive();
  const customMode = isCustomApiMode(settings);
  if (!customMode) requireNewApiSession(settings);
  const model = String(payload.model || settings.imageModel || "gpt-image-2").trim();
  const customImageBinding = customMode
    ? normalizeImageModelBindings(settings.imageModelBindings).find((binding) => binding.model.toLowerCase() === model.toLowerCase())
    : null;
  const preferDirectImageTransport = Boolean(customMode && (customImageBinding?.customBaseUrl || customImageBinding?.customApiKey));
  const customImageCredentials = customMode ? customApiCredentials(settings, "image", model) : null;
  const requestedCount = Math.floor(Number(payload.count || 1));
  const count = Math.max(1, Math.min(Number.isFinite(requestedCount) ? requestedCount : 1, 10));
  const size = String(payload.size || settings.imageSize || "1024x1024").trim();
  const quality = String(payload.quality || settings.imageQuality || "auto").trim();
  const imageControls = {
    outputFormat: outputFormat || undefined,
    outputCompression: payload.outputCompression ?? payload.output_compression,
    background: payload.background,
    moderation: payload.moderation,
    inputFidelity: payload.inputFidelity ?? payload.input_fidelity
  };
  const referenceImages = normalizeServerReferenceImages(payload.referenceImages, 9);
  const editImage = normalizeServerImageInput(payload.editImage, "source.png");
  const maskImage = normalizeServerImageInput(payload.maskImage, "mask.png");
  const editRequested = Boolean(editImage || referenceImages.length || maskImage || ["edit", "redraw", "cutout"].includes(String(payload.mode || "")));
  const uniqueInputs = new Map();
  for (const image of [editImage, ...referenceImages, maskImage].filter(Boolean)) {
    uniqueInputs.set(path.resolve(image.path), image);
  }
  let aggregateSourceBytes = 0;
  for (const image of uniqueInputs.values()) {
    const info = statSync(image.path);
    if (!info.isFile()) throw new Error(`图片来源不是有效文件：${image.name || path.basename(image.path)}`);
    const limit = image === maskImage ? 20 * 1024 * 1024 : 32 * 1024 * 1024;
    if (info.size > limit) {
      const error = new Error(`${image === maskImage ? "蒙版" : "图片"} ${image.name || path.basename(image.path)} 超过 ${Math.round(limit / 1024 / 1024)}MB。`);
      error.code = "NAIMAGE_SOURCE_TOO_LARGE";
      throw error;
    }
    aggregateSourceBytes += info.size;
  }
  if (aggregateSourceBytes > 160 * 1024 * 1024) {
    const error = new Error("本次原图与参考图总大小超过 160MB，请分批处理。");
    error.code = "NAIMAGE_SOURCE_BATCH_TOO_LARGE";
    throw error;
  }
  let maskBufferCache;
  function preparedMaskBuffer() {
    if (!maskImage) return null;
    if (maskBufferCache === undefined) {
      maskBufferCache = boundedImageRead(maskImage.path, 20 * 1024 * 1024, maskImage.name || path.basename(maskImage.path), "蒙版");
      assertSafeEncodedImageDimensions(maskBufferCache, maskImage.name || path.basename(maskImage.path));
    }
    return maskBufferCache;
  }
  const preparedUploadCache = new Map();
  let compressedSourceUploadCount = 0;
  let compressedSourceRetryCount = 0;

  function preparedUpload(image, aggressive = false) {
    const cacheKey = `${image.path}|${aggressive ? "aggressive" : "normal"}`;
    if (!preparedUploadCache.has(cacheKey)) preparedUploadCache.set(cacheKey, prepareImageUploadPart(image, aggressive));
    return preparedUploadCache.get(cacheKey);
  }

  const aidebugMockImage = aidebugMode && !aidebugLiveImage;
  if (aidebugMockImage) {
    const fixtureHint = aidebugLayerFixtureHint(payload);
    if (desktopEnvironment("NAIMAGE_AIDEBUG_ASSERT_EXPLICIT_LAYER_HINT") === "1" && fixtureHint.isLayerPrompt) {
      const isMaskLayer = String(payload.layerOutputMode || "").trim().toLowerCase() === "mask";
      const expectedTransparent = fixtureHint.role !== "background" && !isMaskLayer;
      const expectedBackground = expectedTransparent ? "transparent" : "opaque";
      if (
        fixtureHint.source !== "explicit" ||
        !fixtureHint.role ||
        !fixtureHint.id ||
        payload.transparentPreferred !== expectedTransparent ||
        String(payload.background || "").trim().toLowerCase() !== expectedBackground
      ) {
        throw new Error(
          `AIDebug image fixture expected explicit layer metadata: source=${fixtureHint.source} role=${fixtureHint.role || "missing"} id=${fixtureHint.id || "missing"} transparentPreferred=${String(payload.transparentPreferred)} layerOutputMode=${String(payload.layerOutputMode || "direct")} background=${String(payload.background || "")}`
        );
      }
      if (
        isMaskLayer &&
        desktopEnvironment("NAIMAGE_AIDEBUG_ASSERT_CLEAN_BACKGROUND_REFERENCE") === "1" &&
        !referenceImages.some((image) => String(image.role || "").trim().toLowerCase() === "clean-background")
      ) {
        throw new Error("AIDebug semantic layer mask expected the generated clean-background reference.");
      }
    }
  }
  const imageTimeoutMs = 5 * 60 * 1000;
  const imageTaskTimeoutMs = 15 * 60 * 1000;
  const requestAttempts = Array.from({ length: count }, () => ({
    attempts: 0,
    retries: 0,
    timeoutRetries: 0,
    transientRetries: 0,
    lastCategory: "",
    taskAccepted: false,
    taskId: ""
  }));
  const idempotencyKeys = Array.from({ length: count }, (_item, index) => createHash("sha256")
    .update(`${settings.serverUserId || settings.licenseDeviceId}|${String(payload.runId || "")}|${index}|${model}|${promptForIndependentImage(payload.prompt, count, index)}`)
    .digest("hex"));

  function imageRequestErrorInfo(error) {
    const status = Number(error?.status || error?.data?.status || 0) || 0;
    const code = String(error?.code || error?.cause?.code || "").toLowerCase();
    const message = String(error?.message || error || "");
    const normalized = `${code} ${message}`.toLowerCase();
    if (code === "naimage_run_cancelled" || (payload.signal?.aborted && error?.name === "AbortError")) {
      return { category: "cancelled", retryable: false, maxRetries: 0, status, message };
    }
    if (error?.unsafeToRetry === true) {
      return { category: "ambiguous", retryable: false, maxRetries: 0, status, message };
    }
    if (error?.ambiguous === true) {
      return { category: "ambiguous", retryable: true, maxRetries: 1, status, message };
    }
    if (
      (code === "etimedout" && String(error?.phase || error?.cause?.phase || "").toLowerCase() === "connect") ||
      /ssl\/tls connection timeout|connect(?:ion)? timeout|tls handshake|建立连接超时/.test(normalized)
    ) {
      return { category: "network", retryable: true, maxRetries: 2, status, message };
    }
    if (code === "naimage_image_timeout" || error?.name === "AbortError" || /timeout|timed out|etimedout|超时|超过\s*300\s*秒/.test(normalized)) {
      return { category: "timeout", retryable: true, maxRetries: 1, status, message };
    }
    if (status === 401 || status === 403 || /invalid token|unauthorized|forbidden|登录已失效|会话已失效/.test(normalized)) {
      return { category: "auth", retryable: false, maxRetries: 0, status, message };
    }
    if (/quota|insufficient|balance|payment required|余额不足|额度不足|配额/.test(normalized)) {
      return { category: "quota", retryable: false, maxRetries: 0, status, message };
    }
    if (status === 402) {
      return { category: "upstream_402", retryable: true, maxRetries: 5, status, message };
    }
    if (/policy|safety|moderation|content[_ -]?policy|审核|安全策略|违规/.test(normalized)) {
      return { category: "policy", retryable: false, maxRetries: 0, status, message };
    }
    if (status === 429 || /rate.?limit|too many requests|限流|频率过高/.test(normalized)) {
      return { category: "rate_limit", retryable: true, maxRetries: 5, status, message };
    }
    if (status === 408 || status === 425) {
      return { category: "transient", retryable: true, maxRetries: 5, status, message };
    }
    if (status >= 500 && status <= 599) {
      return { category: "upstream_5xx", retryable: true, maxRetries: 5, status, message };
    }
    if (status === 400 || status === 404 || status === 409 || status === 413 || status === 422 || /invalid[_ -]?input|invalid request|missing reference|参数|尺寸|格式不支持/.test(normalized)) {
      return { category: "invalid_input", retryable: false, maxRetries: 0, status, message };
    }
    if (/fetch failed|network|socket hang up|econnreset|econnrefused|enotfound|eai_again|und_err_socket|terminated|premature close|other side closed|connection (?:closed|terminated)|连接中断|网络/.test(normalized)) {
      return { category: "network", retryable: true, maxRetries: 5, status, message };
    }
    return { category: "unknown", retryable: false, maxRetries: 0, status, message };
  }

  function imageRetryDelayMs(retryNumber, category) {
    if (category === "timeout") return 800;
    return Math.min(6000, 500 * 2 ** Math.max(0, retryNumber - 1));
  }

  function aidebugImageFaultDirective(prompt) {
    if (!aidebugImageFaultsEnabled) return null;
    const match = String(prompt || "").match(/\[AIDebug image-fault=([a-z0-9_-]+)(?::(\d+))?\]/i);
    if (!match) return null;
    const category = String(match[1] || "").trim().toLowerCase();
    const requestedFailures = Number(match[2] || 1);
    return {
      category,
      failures: category.startsWith("always_")
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.min(requestedFailures, 20))
    };
  }

  function aidebugImageFaultError(category, attempt) {
    const normalized = String(category || "").replace(/^always_/, "");
    const error = new Error(`AIDebug image fault ${normalized} attempt ${attempt}`);
    if (normalized === "timeout") {
      error.code = "NAIMAGE_IMAGE_TIMEOUT";
      error.errorCategory = "timeout";
      error.message = "Image 2 AIDebug 请求超过 300 秒，已中断。";
    } else if (normalized === "rate_limit") {
      error.status = 429;
      error.message = "AIDebug 429 too many requests";
    } else if (normalized === "upstream_5xx") {
      error.status = 503;
      error.message = "AIDebug 503 upstream unavailable";
    } else if (normalized === "upstream_402") {
      error.status = 402;
      error.message = "AIDebug 402 openai_error";
    } else if (normalized === "network") {
      error.code = "ECONNRESET";
      error.message = "AIDebug network connection reset";
    } else if (normalized === "terminated") {
      error.code = "UND_ERR_SOCKET";
      error.message = "terminated";
    } else if (normalized === "transient") {
      error.status = 408;
      error.message = "AIDebug 408 request timeout";
    } else if (normalized === "auth") {
      error.status = 401;
      error.message = "AIDebug unauthorized";
    } else if (normalized === "invalid_input") {
      error.status = 400;
      error.message = "AIDebug invalid input";
    }
    return error;
  }

  async function withImageRequestTimeout(task, index) {
    const controller = new AbortController();
    let timer = null;
    let timedOut = false;
    const abortFromCaller = () => controller.abort(payload.signal?.reason || createAbortError("用户结束了当前任务。"));
    if (payload.signal?.aborted) abortFromCaller();
    else payload.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    const requestTimeoutMs = editRequested ? imageTimeoutMs : imageTaskTimeoutMs;
    const timeoutError = new Error(`Image 2 第 ${index + 1}/${count} 张请求超过 ${Math.round(requestTimeoutMs / 1000)} 秒，已中断。`);
    timeoutError.code = "NAIMAGE_IMAGE_TIMEOUT";
    timeoutError.errorCategory = "timeout";
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        if (requestAttempts[index]?.taskAccepted) {
          timeoutError.unsafeToRetry = true;
          timeoutError.taskId = requestAttempts[index].taskId;
        }
        controller.abort();
        reject(timeoutError);
      }, requestTimeoutMs);
    });
    const transportPromise = Promise.resolve().then(() => task(controller.signal));
    try {
      payload.onTransportPromise?.(transportPromise, {
        index,
        count,
        attempt: requestAttempts[index]?.attempts || 1
      });
    } catch {
      // Admission tracking must never affect the provider request.
    }
    try {
      return await Promise.race([transportPromise, timeoutPromise]);
    } catch (error) {
      if (payload.signal?.aborted) throw createAbortError(payload.signal.reason);
      if (error === timeoutError || timedOut) throw timeoutError;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      payload.signal?.removeEventListener?.("abort", abortFromCaller);
      controller.abort();
    }
  }

  async function requestSingleImageAttempt(index) {
    const executeAttempt = () => withImageRequestTimeout(async (signal) => {
      const prompt = promptForIndependentImage(payload.prompt, count, index);
      const requestHeaders = {
        "Idempotency-Key": `${managedImageIdempotencyPrefix}${idempotencyKeys[index]}`
      };
      const onPartialImage = (partial) => {
        try {
          payload.onPartialImage?.({
            ...partial,
            requestIndex: index + 1,
            requestNumber: index + 1,
            requestCount: count
          });
        } catch {
          // Preview telemetry must never break the billable image request.
        }
      };
      if (aidebugMockImage) {
        await delay(45);
        const directive = aidebugImageFaultDirective(prompt);
        const attempt = requestAttempts[index].attempts;
        if (directive && attempt <= directive.failures) {
          throw aidebugImageFaultError(directive.category, attempt);
        }
        const previewCount = Math.max(0, Math.min(3, Math.floor(Number(
          desktopEnvironment("NAIMAGE_AIDEBUG_IMAGE_PARTIALS") || 0
        ) || 0)));
        for (let previewIndex = 0; previewIndex < previewCount; previewIndex += 1) {
          await delay(140);
          const b64Json = aidebugImageBase64(index + previewIndex + 1, { ...payload, prompt });
          onPartialImage({
            b64Json,
            dataUrl: `data:image/png;base64,${b64Json}`,
            partialImageIndex: previewIndex,
            index: previewIndex + 1,
            total: previewCount,
            eventType: "aidebug.image_generation.partial_image"
          });
        }
        return {
          created: Math.floor(Date.now() / 1000),
          model,
          data: [{
            b64_json: aidebugImageBase64(index, { ...payload, prompt }),
            revised_prompt: `AIDebug mock image ${index + 1}/${count}${payload.layerId ? ` · layer=${payload.layerId}` : ""}`,
            size,
            quality: quality === "auto" ? "high" : quality,
            output_format: imageControls.outputFormat || "png",
            ...(imageControls.outputCompression === undefined ? {} : { output_compression: imageControls.outputCompression }),
            ...(imageControls.background ? { background: imageControls.background } : {}),
            ...(imageControls.moderation ? { moderation: imageControls.moderation } : {}),
            ...(imageControls.inputFidelity ? { input_fidelity: imageControls.inputFidelity } : {})
          }]
        };
      }
      if (editRequested) {
      if (typeof FormData === "undefined" || typeof Blob === "undefined") {
        throw new Error("当前运行时不支持 New API 图片编辑上传。");
      }
      const buildForm = (aggressive = false) => {
        const form = new FormData();
        form.set("model", model);
        form.set("prompt", prompt);
        form.set("size", size);
        form.set("quality", quality);
        form.set("n", "1");
        if (!customMode && settings.modelGroup) form.set("group", settings.modelGroup);
        if (!isGptImageModel(model)) form.set("response_format", "b64_json");
        if (isGptImageModel(model)) {
          if (imageControls.outputFormat) form.set("output_format", String(imageControls.outputFormat));
          if (imageControls.outputCompression !== undefined) form.set("output_compression", String(imageControls.outputCompression));
          if (imageControls.background) form.set("background", String(imageControls.background));
          if (imageControls.moderation) form.set("moderation", String(imageControls.moderation));
          if (imageControls.inputFidelity) form.set("input_fidelity", String(imageControls.inputFidelity));
        }
        const imageField = isGptImageModel(model) ? "image[]" : "image";
        for (const image of [editImage, ...referenceImages].filter(Boolean)) {
          const upload = preparedUpload(image, aggressive);
          if (upload.compressed) compressedSourceUploadCount += 1;
          form.append(imageField, new Blob([upload.buffer], { type: upload.mimeType }), upload.name);
        }
        if (maskImage) {
          const maskBuffer = preparedMaskBuffer();
          form.set("mask", new Blob([maskBuffer], { type: maskImage.mimeType || "image/png" }), maskImage.name || path.basename(maskImage.path) || "mask.png");
        }
        return form;
      };
      let aggressive = false;
      // A custom OpenAI-compatible image endpoint is not guaranteed to
      // implement Images SSE. Several New API deployments acknowledge
      // stream=true with HTTP 200 but return an empty event stream. Keep the
      // original AIEYRA-compatible JSON transport for custom credentials;
      // managed Session Relay remains stream-first and can provide previews.
      let streamEnabled = !customMode;
      for (;;) {
        const idempotencySuffix = `${aggressive ? "-aggressive" : ""}${streamEnabled ? "" : "-nonstream"}`;
        try {
          if (streamEnabled) {
            return await newApiRelayImage(settings, "/v1/images/edits", buildForm(aggressive), onPartialImage, {
              provider: "image",
              signal,
              headers: { ...requestHeaders, "Idempotency-Key": `${requestHeaders["Idempotency-Key"]}${idempotencySuffix}` },
              headersTimeoutMs: imageTimeoutMs,
              connectTimeoutMs: 60_000,
              maxRequestBytes: 96 * 1024 * 1024,
              maxResponseBytes: 96 * 1024 * 1024,
              partialImages: 3
            });
          }
          const request = await newApiFetch(settings, customMode ? "/v1/images/edits" : managedRelayEndpoint("/v1/images/edits"), {
            service: "relay",
            absoluteUrl: customMode ? customApiUrl(settings, "/v1/images/edits", "image", model) : undefined,
            requestBaseUrl: customImageCredentials?.baseUrl,
            method: "POST",
            headers: imageEditRequestHeaders({
              ...requestHeaders,
              "Idempotency-Key": `${requestHeaders["Idempotency-Key"]}${idempotencySuffix}`
            }, customMode, customImageCredentials),
            body: buildForm(aggressive),
            signal,
            headersTimeoutMs: imageTimeoutMs,
            connectTimeoutMs: 60_000,
            maxRequestBytes: 96 * 1024 * 1024,
            maxResponseBytes: 96 * 1024 * 1024
          });
          if (!customMode) persistNewApiSessionCookie(settings, request.response);
          if (!request.response.ok || request.data.error || request.data.success === false || request.data.ok === false) {
            const error = new Error(newApiErrorMessage(request.data, request.response.status));
            error.status = request.response.status;
            error.data = request.data;
            throw error;
          }
          return request.data;
        } catch (error) {
          if (streamEnabled && error?.code === "NEW_API_IMAGE_STREAM_UNSUPPORTED") {
            streamEnabled = false;
            continue;
          }
          if (!aggressive && Number(error?.status) === 413) {
            compressedSourceRetryCount += 1;
            aggressive = true;
            continue;
          }
          const wrapped = new Error(`image_gen edit ${Number(error?.status || 0) || "request"} 第 ${index + 1}/${count} 张: ${error?.message || String(error)}`);
          wrapped.status = Number(error?.status || 0) || undefined;
          wrapped.data = error?.data;
          wrapped.code = error?.code;
          wrapped.phase = error?.phase;
          wrapped.ambiguous = error?.ambiguous === true;
          wrapped.cause = error;
          throw wrapped;
        }
      }
      }

      const body = { model, prompt, size, quality, n: 1 };
      if (!isGptImageModel(model)) body.response_format = "b64_json";
      if (isGptImageModel(model)) {
        if (imageControls.outputFormat) body.output_format = imageControls.outputFormat;
        if (imageControls.outputCompression !== undefined) body.output_compression = imageControls.outputCompression;
        if (imageControls.background) body.background = imageControls.background;
        if (imageControls.moderation) body.moderation = imageControls.moderation;
      }
      const responsesImageModel = String(settings.agentModel || "gpt-5.6-terra").trim() || "gpt-5.6-terra";
      log(`image request metadata ${JSON.stringify({
        endpoint: "/v1/responses",
        accessMode: customMode ? "custom" : "account",
        transport: "responses-sse",
        model: responsesImageModel,
        configuredImageModel: model,
        size,
        quality,
        count: 1,
        promptChars: Array.from(prompt).length,
        promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
        bodyKeys: Object.keys(body).sort()
      })}`);
      const idempotencyKey = `${managedImageIdempotencyPrefix}${idempotencyKeys[index]}`;
      const outputFormat = String(imageControls.outputFormat || "png").trim().toLowerCase() || "png";
      const imageTool = {
        type: "image_generation",
        action: "generate",
        size,
        output_format: outputFormat,
        moderation: String(imageControls.moderation || "auto"),
        quality,
        partial_images: 3
      };
      if (outputFormat !== "png" && imageControls.outputCompression !== undefined) {
        imageTool.output_compression = imageControls.outputCompression;
      }
      const responsesBody = {
        model: responsesImageModel,
        input: prompt,
        tools: [imageTool],
        tool_choice: "required"
      };
      try {
        return await newApiRelayImageTask(settings, body, {
          signal,
          headers: { "Idempotency-Key": idempotencyKey },
          connectTimeoutMs: 30_000,
          createHeadersTimeoutMs: 30_000,
          pollHeadersTimeoutMs: 30_000,
          pollIntervalMs: 2500,
          maxResponseBytes: 96 * 1024 * 1024,
          onAccepted: ({ taskId, status }) => {
            requestAttempts[index].taskAccepted = true;
            requestAttempts[index].taskId = taskId;
            try {
              payload.onImageTaskStatus?.({
                taskId,
                status,
                requestIndex: index + 1,
                requestCount: count
              });
            } catch {
              // Task telemetry must never affect the accepted generation.
            }
          },
          onStatus: ({ taskId, status }) => {
            try {
              payload.onImageTaskStatus?.({
                taskId,
                status,
                requestIndex: index + 1,
                requestCount: count
              });
            } catch {
              // Task telemetry must never affect polling.
            }
          }
        });
      } catch (error) {
        if (error?.code !== "NEW_API_IMAGE_TASK_UNSUPPORTED") throw error;
        log(`Image task endpoint unsupported for ${customMode ? "custom" : "account"} access; falling back to the compatible synchronous image transports`);
      }
      if (isGptImageModel(model) && !preferDirectImageTransport) {
        try {
          return await newApiRelayResponsesImage(settings, responsesBody, onPartialImage, {
            provider: "image",
            signal,
            headers: { "Idempotency-Key": idempotencyKey },
            headersTimeoutMs: imageTimeoutMs,
            connectTimeoutMs: 60_000,
            idleTimeoutMs: imageTimeoutMs,
            maxResponseBytes: 256 * 1024 * 1024,
            partialImages: 3
          });
        } catch (error) {
          if (error?.code !== "NEW_API_RESPONSES_IMAGE_UNSUPPORTED") throw error;
          log(`Responses image generation unsupported for ${customMode ? "custom" : "account"} access; falling back to Images API (${error?.message || "unknown"})`);
        }
      } else {
        log(`image model ${model} has custom credentials; using its direct Images transport for streaming previews`);
      }
      try {
        return await newApiRelayImage(settings, "/v1/images/generations", body, onPartialImage, {
          provider: "image",
          signal,
          headers: { "Idempotency-Key": idempotencyKey },
          headersTimeoutMs: imageTimeoutMs,
          connectTimeoutMs: 60_000,
          maxResponseBytes: 96 * 1024 * 1024,
          partialImages: 3
        });
      } catch (error) {
        if (error?.code !== "NEW_API_IMAGE_STREAM_UNSUPPORTED") throw error;
      }
      return newApiRelayJson(settings, "/v1/images/generations", body, {
        provider: "image",
        signal,
        headers: { "Idempotency-Key": `${idempotencyKey}-nonstream` },
        headersTimeoutMs: imageTimeoutMs,
        connectTimeoutMs: 60_000,
        maxResponseBytes: 96 * 1024 * 1024
      });
    }, index);
    return editRequested ? withImageEditRequestSlot(executeAttempt) : executeAttempt();
  }

  async function requestSingleImage(index) {
    const stats = requestAttempts[index];
    const startedAtMs = Date.now();
    for (;;) {
      if (payload.signal?.aborted) throw createAbortError(payload.signal.reason);
      stats.attempts += 1;
      try {
        const response = await requestSingleImageAttempt(index);
        const completedAtMs = Date.now();
        return {
          response,
          requestIndex: index + 1,
          startedAt: new Date(startedAtMs).toISOString(),
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: completedAtMs - startedAtMs
        };
      } catch (error) {
        const info = imageRequestErrorInfo(error);
        stats.lastCategory = info.category;
        const categoryRetries = info.category === "timeout" ? stats.timeoutRetries : stats.transientRetries;
        if (!info.retryable || categoryRetries >= info.maxRetries) {
          if (error && typeof error === "object") {
            error.errorCategory = info.category;
            error.retryCount = stats.retries;
            error.attempts = stats.attempts;
          }
          throw error;
        }
        stats.retries += 1;
        if (info.category === "timeout") stats.timeoutRetries += 1;
        else stats.transientRetries += 1;
        const delayMs = imageRetryDelayMs(info.category === "timeout" ? stats.timeoutRetries : stats.transientRetries, info.category);
        try {
          payload.onRetry?.({
            index,
            count,
            attempt: stats.attempts + 1,
            retryCount: stats.retries,
            maxRetries: info.maxRetries,
            category: info.category,
            delayMs,
            status: info.status || undefined
          });
        } catch {
          // Retry telemetry must never break the image request itself.
        }
        await delay(delayMs, undefined, payload.signal ? { signal: payload.signal } : undefined).catch((error) => {
          if (payload.signal?.aborted) throw createAbortError(payload.signal.reason);
          throw error;
        });
      }
    }
  }

  const settled = new Array(count);
  let nextImageIndex = 0;
  const worker = async () => {
    while (nextImageIndex < count) {
      if (payload.signal?.aborted) break;
      const index = nextImageIndex;
      nextImageIndex += 1;
      try {
        settled[index] = { status: "fulfilled", value: await requestSingleImage(index) };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  };
  const requestConcurrency = Math.min(10, count);
  await Promise.all(Array.from({ length: requestConcurrency }, () => worker()));
  const successfulResponses = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  const responses = successfulResponses.map((item) => item.response);
  const failed = settled
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "rejected");
  if (!responses.length && failed.length) {
    const first = failed[0].item;
    if (first.status === "rejected") throw first.reason;
    throw new Error("New API 生图失败。");
  }
  const accounting = completedImageAccounting(responses);
  return {
    ok: true,
    model,
    size,
    quality,
    count,
    images: successfulResponses.flatMap((entry) => extractServerImages(entry.response).map((image) => ({
      ...image,
      requestIndex: entry.requestIndex,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      durationMs: entry.durationMs
    }))),
    failed: failed.length,
    errors: failed.map(({ item, index }) => `第 ${index + 1}/${count} 张：${item.status === "rejected" ? item.reason?.message || String(item.reason) : "生图失败。"}`),
    retryCount: requestAttempts.reduce((total, item) => total + item.retries, 0),
    retryAttempts: requestAttempts.map((item, index) => ({ image: index + 1, ...item })),
    referenceImageCount: referenceImages.length,
    referenceImageDescriptors: referenceImages.map((image) => ({ name: image.name, role: image.role, purpose: image.purpose })),
    editImageDescriptor: editImage ? { name: editImage.name, role: editImage.role, purpose: editImage.purpose } : undefined,
    editImage: Boolean(editImage),
    maskImage: Boolean(maskImage),
    outputFormat: imageControls.outputFormat || "png",
    outputCompression: imageControls.outputCompression,
    background: imageControls.background,
    moderation: imageControls.moderation,
    inputFidelity: imageControls.inputFidelity,
    sourceUploadCompressed: compressedSourceUploadCount > 0,
    sourceUploadRetryCount: compressedSourceRetryCount,
    mode: editRequested ? payload.mode || "edit" : "generate",
    ...accounting,
    summary: failed.length ? `New API 已返回 ${responses.length} 个生图结果，${failed.length} 张失败。` : `New API 已返回 ${count} 个生图结果。`
  };
}

async function completeNewApiLogin(settings, payload = {}) {
  const previousEpoch = newApiAuthEpoch;
  const authEpoch = ++newApiAuthEpoch;
  if (settings?.serverUserId) void stopActiveNewApiCurlTransports({ authEpoch: previousEpoch });
  const login = await newApiFetch(settings, "/api/user/login", {
    method: "POST",
    timeoutMs: 20_000,
    retries: 0,
    body: {
      username: String(payload.username ?? payload.email ?? "").trim(),
      password: String(payload.password ?? "")
    }
  });
  if (!login.response.ok || login.data.parseFailed === true || login.data.error || login.data.success === false || login.data.ok === false) {
    const error = new Error(newApiErrorMessage(login.data, login.response.status));
    error.status = login.response.status;
    error.data = login.data;
    throw error;
  }
  const loginAuth = parseNewApiLoginAuth(login.response, login.data);
  const loginUser = loginAuth.user;
  const serverUserId = loginAuth.serverUserId;

  let nextSettings = migrateSettings({
    ...settings,
    serverAuthProtocol: loginAuth.protocol,
    serverAccessToken: loginAuth.serverAccessToken,
    serverAccessExpiresAt: loginAuth.serverAccessExpiresAt,
    serverSessionCookie: loginAuth.serverSessionCookie,
    serverAuthSessionId: loginAuth.serverAuthSessionId,
    serverUserId,
    serverToken: "",
    selectedAccountTokenId: "",
    selectedAccountTokenName: "",
    selectedAccountTokenGroup: ""
  });
  const storedAfterLogin = migrateSettings(readJson(settingsPath, defaultSettings));
  if (resolveNewApiBaseUrl(storedAfterLogin, "account").toLowerCase() !== resolveNewApiBaseUrl(settings, "account").toLowerCase()) {
    const error = new Error("账户服务地址已切换，旧登录结果已丢弃。");
    error.code = "NEW_API_SESSION_CHANGED";
    throw error;
  }
  if (authEpoch !== newApiAuthEpoch) {
    const error = new Error("登录请求已被更新的账户操作替代。");
    error.code = "NEW_API_SESSION_CHANGED";
    throw error;
  }
  // Commit the new account identity before follow-up profile/model requests so
  // late responses from the previous account cannot rotate this session. The
  // login response must not wait for profile, token, quota, or model catalog
  // requests; those are refreshed by the renderer after the workspace opens.
  accountTokenService.clearKeyCache();
  writeJson(settingsPath, nextSettings);

  // Use only local settings and an already-loaded cache entry for the first
  // workspace paint. `refreshServerState()` performs the authoritative
  // profile/token/model warm-up in the background after login succeeds.
  const modelSettings = await newApiModelSettings(nextSettings, { cacheOnly: true });
  nextSettings = migrateSettings({
    ...nextSettings,
    imageModel: nextSettings.imageModel || modelSettings.imageModel || preferredImageModelFromList(modelSettings.imageModels),
    imageModelPool: nextSettings.imageModelPool?.length
      ? nextSettings.imageModelPool
      : [nextSettings.imageModel || modelSettings.imageModel || preferredImageModelFromList(modelSettings.imageModels)],
    videoModel: nextSettings.videoModel || modelSettings.videoModel || preferredVideoModelFromList(modelSettings.videoModels),
    videoModelPool: nextSettings.videoModelPool?.length
      ? nextSettings.videoModelPool
      : [nextSettings.videoModel || modelSettings.videoModel || preferredVideoModelFromList(modelSettings.videoModels)],
    agentModel: nextSettings.agentModel || preferredAgentModelFromList(modelSettings.agentModels),
    agentModelPool: nextSettings.agentModelPool?.length ? nextSettings.agentModelPool : [nextSettings.agentModel || preferredAgentModelFromList(modelSettings.agentModels)]
  });
  if (authEpoch !== newApiAuthEpoch) {
    const error = new Error("登录账户已切换，旧登录结果已丢弃。");
    error.code = "NEW_API_SESSION_CHANGED";
    throw error;
  }
  writeJson(settingsPath, nextSettings);
  return {
    ok: true,
    sessionId: serverUserId,
    user: normalizeNewApiUser(loginUser),
    wallet: walletFromNewApiUser(loginUser),
    settings: {
      ...modelSettings,
      imageModel: nextSettings.imageModel,
      videoModel: nextSettings.videoModel
    },
    imageCostCents: modelSettings.imageCostCents
  };
}

function clearNewApiAuth(settings) {
  const stored = migrateSettings(readJson(settingsPath, defaultSettings));
  const expectedUserId = String(settings?.serverUserId || "");
  const expectedAccessToken = String(settings?.serverAccessToken || "");
  const expectedCookie = String(settings?.serverSessionCookie || "");
  const expectedAuthSessionId = String(settings?.serverAuthSessionId || "");
  if (
    (expectedUserId && String(stored.serverUserId || "") !== expectedUserId) ||
    (expectedAccessToken && String(stored.serverAccessToken || "") !== expectedAccessToken) ||
    (expectedCookie && String(stored.serverSessionCookie || "") !== expectedCookie) ||
    (expectedAuthSessionId && String(stored.serverAuthSessionId || "") !== expectedAuthSessionId)
  ) {
    return stored;
  }
  const clearingEpoch = newApiAuthEpoch;
  newApiAuthEpoch += 1;
  if (expectedUserId) void stopActiveNewApiCurlTransports({ authEpoch: clearingEpoch });
  const next = migrateSettings({
    ...stored,
    serverToken: "",
    serverAuthProtocol: "",
    serverAccessToken: "",
    serverAccessExpiresAt: 0,
    serverSessionCookie: "",
    serverAuthSessionId: "",
    serverUserId: "",
    selectedAccountTokenId: "",
    selectedAccountTokenName: "",
    selectedAccountTokenGroup: ""
  });
  accountTokenService?.clearKeyCache();
  writeJson(settingsPath, next);
  return next;
}





async function callNewApiImageWithSession(settings, payload = {}) {
  const result = await callNewApiImage(settings, payload);
  markModelRuntimeVerified(settings, "image", payload.model || settings.imageModel, "image-generation");
  return result;
}

function mapNewApiLogType(type) {
  const value = Number(type);
  if (value === 1) return "topup";
  if (value === 2) return "consume";
  if (value === 3) return "manage";
  if (value === 4) return "system";
  if (value === 5) return "error";
  if (value === 6) return "refund";
  if (value === 7) return "login";
  return "log";
}

function mapNewApiLogEntry(logEntry) {
  let detail = {};
  try {
    detail = logEntry?.other ? JSON.parse(logEntry.other) : {};
  } catch {
    detail = {};
  }
  const createdAtRaw = logEntry?.createdAt || logEntry?.created_at;
  const createdAtNumber = Number(createdAtRaw);
  const createdAt = typeof createdAtRaw === "string" && Number.isNaN(createdAtNumber)
    ? new Date(createdAtRaw).toISOString()
    : createdAtRaw
      ? new Date(createdAtNumber * 1000).toISOString()
      : new Date().toISOString();
  return {
    id: String(logEntry?.id ?? `${logEntry?.created_at ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    type: logEntry?.rmbCost !== undefined || logEntry?.modelName ? "consume" : mapNewApiLogType(logEntry?.type),
    createdAt,
    detail: {
      ...detail,
      message: logEntry?.content || detail.message,
      model: logEntry?.modelName || logEntry?.model_name || detail.model,
      quota: logEntry?.quota,
      rmbCost: logEntry?.rmbCost,
      promptTokens: logEntry?.prompt_tokens,
      completionTokens: logEntry?.completion_tokens
    }
  };
}

function extractServerImages(data) {
  const images = [];
  const parentActualParams = Array.isArray(data?.images)
    ? pickImageGenerationResponseMetadata(data?.actualParams)
    : pickImageGenerationResponseMetadata(data);
  const append = (type, value, source, inheritedActualParams = parentActualParams) => {
    const cleanValue = String(value || "").trim();
    if (!cleanValue) return;
    const actualParams = mergeImageGenerationResponseMetadata(inheritedActualParams, source?.actualParams, source);
    images.push({
      type,
      value: cleanValue,
      revisedPrompt: source?.revised_prompt || source?.revisedPrompt || "",
      ...(Object.keys(actualParams).length ? { actualParams } : {}),
      ...(source?.requestIndex === undefined ? {} : { requestIndex: source.requestIndex }),
      ...(source?.startedAt ? { startedAt: source.startedAt } : {}),
      ...(source?.completedAt ? { completedAt: source.completedAt } : {}),
      ...(Number.isFinite(Number(source?.durationMs)) ? { durationMs: Number(source.durationMs) } : {})
    });
  };
  const source = Array.isArray(data?.images) ? data.images : Array.isArray(data?.data) ? data.data : [];
  for (const item of source) {
    if (item?.b64_json) append("base64", item.b64_json, item);
    if (item?.image_base64) append("base64", item.image_base64, item);
    if (item?.base64) append("base64", item.base64, item);
    if (item?.url) append("url", item.url, item);
    if (item?.image_url?.url) append("url", item.image_url.url, item);
    if (item?.type === "base64" && item.value) append("base64", item.value, item);
    if (item?.type === "url" && item.value) append("url", item.value, item);
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const itemActualParams = mergeImageGenerationResponseMetadata(parentActualParams, item?.actualParams, item);
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const b64 = part?.image_base64 ?? part?.b64_json;
      const url = part?.image_url ?? part?.url;
      if (b64) append("base64", b64, part, itemActualParams);
      if (url) append("url", url, part, itemActualParams);
    }
  }
  return images;
}

function outputExtensionForFormat(format) {
  const normalized = String(format || "png").trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "jpg";
  if (normalized === "webp") return "webp";
  return "png";
}

async function writeServerImageOutputs(images, stem, runId = "", projectId = "", outputFormat = "png", generationContext = {}) {
  const outputDir = outputDirForProjectId(projectId);
  mkdirSync(outputDir, { recursive: true });
  return Promise.all(images.map(async (image, index) => {
    const buffer = image.type === "url"
      ? await remoteImageDownloads.download(image.value, {
          maxBytes: maxExportImageBytes,
          timeoutMs: 30_000,
          maxRedirects: 5
        })
      : Buffer.from(image.value.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (buffer.length <= 0 || buffer.length > maxExportImageBytes) {
      const error = new Error(`Generated image ${index + 1} exceeds the managed asset byte limit.`);
      error.code = "NAIMAGE_IMAGE_OUTPUT_SIZE_INVALID";
      error.failureKind = "validation";
      throw error;
    }
    const detected = requireEncodedImageFormat(buffer, outputFormat);
    assertSafeEncodedImageDimensions(buffer, `generated image ${index + 1}`);
    const decoded = nativeImage.createFromBuffer(buffer);
    if (decoded.isEmpty()) {
      const error = new Error(`Generated image ${index + 1} could not be fully decoded.`);
      error.code = "NAIMAGE_IMAGE_OUTPUT_DECODE_FAILED";
      error.failureKind = "validation";
      throw error;
    }
    const dimensions = decoded.getSize();
    const filePath = path.join(outputDir, `${stem}-${String(index + 1).padStart(2, "0")}${detected.extension}`);
    writeFileSync(filePath, buffer);
    const generation = buildImageAssetGenerationMetadata({
      request: generationContext.request,
      response: image.actualParams,
      startedAt: image.startedAt || generationContext.startedAt,
      completedAt: image.completedAt || generationContext.completedAt,
      durationMs: image.durationMs ?? generationContext.durationMs
    });
    return {
      index: Number.isFinite(Number(image.requestIndex)) ? Math.max(1, Math.round(Number(image.requestIndex))) : index + 1,
      type: "file",
      path: filePath,
      assetUrl: assetUrlFor(filePath),
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      mimeType: detected.mimeType,
      outputFormat: detected.format,
      revisedPrompt: image.revisedPrompt || "",
      runId,
      width: dimensions.width > 0 ? dimensions.width : undefined,
      height: dimensions.height > 0 ? dimensions.height : undefined,
      ...(generation ? { generation } : {})
    };
  }));
}

function imageGenerationContext(payload = {}, data = {}, outputFormat = "png") {
  return {
    request: normalizeImageGenerationParameters({
      model: payload.model || data.model,
      ratio: payload.ratio,
      resolution: payload.resolution,
      size: payload.size || data.size,
      quality: payload.quality || data.quality,
      outputFormat: payload.outputFormat ?? payload.output_format ?? data.outputFormat ?? data.output_format ?? outputFormat,
      outputCompression: payload.outputCompression ?? payload.output_compression ?? data.outputCompression ?? data.output_compression,
      background: payload.background ?? data.background,
      moderation: payload.moderation ?? data.moderation,
      inputFidelity: payload.inputFidelity ?? payload.input_fidelity ?? data.inputFidelity ?? data.input_fidelity
    })
  };
}

function sanitizeFileStem(value, fallback = "image") {
  return String(value || fallback).replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || fallback;
}

function writeDataUrlOutput(dataUrl, stem, runId = "", projectId = "", options = {}) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) throw new Error("invalid image data url");
  const outputDir = outputBucketDirForProjectId(projectId, options.bucket, options.subdir);
  mkdirSync(outputDir, { recursive: true });
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const filePath = path.join(outputDir, `${sanitizeFileStem(stem)}.${ext}`);
  const buffer = Buffer.from(match[2], "base64");
  writeFileSync(filePath, buffer);
  return {
    index: 1,
    type: "file",
    path: filePath,
    assetUrl: assetUrlFor(filePath),
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    revisedPrompt: "",
    runId
  };
}

function writeDataUrlTemp(dataUrl, stem, projectId = "") {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) throw new Error("invalid image data url");
  const outputDir = activeProjectTempDir(projectId);
  mkdirSync(outputDir, { recursive: true });
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const filePath = path.join(outputDir, `${sanitizeFileStem(stem)}.${ext}`);
  writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return {
    path: filePath,
    mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
    name: path.basename(filePath),
    assetUrl: assetUrlFor(filePath)
  };
}

function removeOwnedDataUrlTemp(image, projectId = "") {
  const filePath = typeof image?.path === "string" ? path.resolve(image.path) : "";
  if (!filePath) return;
  const tempRoot = path.resolve(activeProjectTempDir(projectId));
  if (!isComparablePathInside(filePath, tempRoot) || comparablePath(path.dirname(filePath)) !== comparablePath(tempRoot)) return;
  try {
    if (!existsSync(filePath)) return;
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return;
    rmSync(filePath, { force: true });
  } catch (error) {
    log(`temporary image cleanup failed ${error instanceof Error ? error.message : String(error)}`);
  }
}


const projectSessionSaveCoordinator = createProjectSaveCoordinator({
  initialRevision(projectId) {
    return projectSessionRevisionFromDisk(getProjectById(projectId, readProjectList()));
  }
});

function registerIpc() {
  registerDesktopIpc({
    ipcMain,
    accessPolicy,
    automationService,
    agentIntegrationService,
    agentWindowService,
    desktopUpdater,
    themePresetService,
    glassBackgroundService,
    getReferencedGlassBackgroundAssetIds() {
      const assetId = String(migrateSettings(readJson(settingsPath, defaultSettings)).glassBackgroundAssetId || "").trim();
      return assetId ? [assetId] : [];
    },
    requirementLibraryService,
    commerceTemplateLibraryService,
    commerceCatalogService,
    commerceExportService,
    socialExportService,
    imageCollectionExportService,
    exportCenterStateService,
    projectDataMigrationService,
    videoTaskService,
    scientificRunnerService,
    composePluginTask,
    migrateSettings,
    readJson,
    settingsPath,
    defaultSettings,
    log,
    publicSettings,
    restoreSettingsSecrets: settingsSecretStore.restorePlaceholders,
    validateNewApiServiceSettings,
    onNewApiAccountBaseUrlChanged(current) {
      const previousEpoch = newApiAuthEpoch;
      newApiAuthEpoch += 1;
      accountTokenService.clearKeyCache();
      if (current?.serverUserId) void stopActiveNewApiCurlTransports({ authEpoch: previousEpoch });
    },
    onSettingsSaved(_event, next) {
      const backgroundColor = nativeWindowBackgroundColor(next);
      for (const targetWindow of BrowserWindow.getAllWindows()) {
        if (!targetWindow.isDestroyed?.()) targetWindow.setBackgroundColor?.(backgroundColor);
      }
      glassBackgroundService.cleanup({
        referencedAssetIds: next.glassBackgroundAssetId ? [next.glassBackgroundAssetId] : []
      });
    },
    writeJson,
    readProjectList,
    getActiveProject,
    sessionPath,
    ensureProjectFiles,
    projectSessionFromDisk,
    hydrateSessionAssets,
    sessionForProjectSave,
    writeProjectManifest,
    getProjectById,
    projectSessionSaveCoordinator,
    sanitizeSession,
    sessionHasContent,
    writeProjectList,
    currentAgentSettings,
    customApiCredentials,
    getAgentRuntime,
    licenseService,
    listAgentModels,
    emitAgentProgress,
    agentRunControl,
    aidebugMode,
    aidebugAgentStopFixture,
    createWindow,
    BrowserWindow,
    screen,
    desktopCapturer,
    debugDir,
    sanitizeFileStem,
    dialog,
    shell,
    createProjectRecord,
    safeName,
    nextExternalProjectFolderPath,
    desktopRoot,
    packageProject,
    writeProjectPackageFile,
    boundedImageRead,
    projectPackageMaximumFileBytes,
    projectPackageFailure,
    validateProjectPackageData,
    importProjectPackage,
    parseProjectGraphFile,
    projectGraphTask,
    projectForFolderOpen,
    projectRoot,
    configDir,
    projectsDir,
    isPathInside,
    app,
    importLocalImagesToProject,
    importLocalVideosToProject,
    mimeTypeForPath,
    resolveOutputAsset,
    isAllowedAssetPath,
    maxExportImageBytes,
    validateProjectPackageImageBuffer,
    refineSemanticLayers,
    imageThumbnailCache,
    imageImportStatus,
    recycleProjectImageImporter,
    writeDataUrlOutput,
    createAssetExportContext,
    materializeManagedImageAsset,
    exportFileName,
    aidebugExportFilePath,
    comparablePath,
    releaseTransientExportSources,
    maxFolderExportAssets,
    normalizedExportItem,
    exportGroupMetadata,
    aidebugAssetExportRoot,
    safeExportStem,
    uniqueExportPath,
    isComparablePathInside,
    removeExportStagingFolder,
    normalizedExportAsset,
    preparePsdRasterSource,
    secureExportSourceCacheDir,
    retainTransientExportSource,
    exportLayeredPsd,
    aidebugLogs,
    aidebugLiveImage,
    aidebugPublicSettings,
    aidebugStatefulAuth,
    aidebugUser,
    aidebugWallet,
    accountTokenService,
    callNewApiImageWithSession,
    clearNewApiAuth,
    completeNewApiLogin,
    extractServerImages,
    getNewApiAuthEpoch: () => newApiAuthEpoch,
    isNewApiAuthError,
    logoutNewApiSession,
    mapNewApiLogEntry,
    modelSettingsWithCacheMeta,
    newApiModelSettings,
    newApiRequest,
    newApiUserAuthHeaders,
    newApiUserLogsEndpoint,
    normalizeNewApiUser,
    removeOwnedDataUrlTemp,
    splitModelSettings,
    tokenItemsFromNewApiPayload,
    walletFromNewApiUser,
    writeDataUrlTemp,
    writeServerImageOutputs
  });
}

function createWindow(launch = {}) {
  logBoot("create window start");
  const windowIcon = createWindowIcon();
  const startupSettings = migrateSettings(readJson(settingsPath, defaultSettings));
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: minWindowWidth,
    minHeight: minWindowHeight,
    backgroundColor: nativeWindowBackgroundColor(startupSettings),
    show: false,
    title: applicationName,
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...(useCustomWindowFrame ? { frame: false } : { titleBarStyle: "hiddenInset" }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: aidebugRendererArguments,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: !performanceGateMode
    }
  });
  window.setMinimumSize(minWindowWidth, minWindowHeight);
  const rendererOwnerId = String(window.webContents.id);
  const stopRendererOwnedWork = (reason) => {
    const runs = agentRunControl.stopOwner({ ownerId: rendererOwnerId, reason });
    const automation = automationService.rendererGone(rendererOwnerId, reason);
    if (runs.stopped || automation.rejected) {
      log(`renderer owner=${rendererOwnerId} stoppedRuns=${runs.stopped} rejectedAutomation=${automation.rejected}`);
    }
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
    log(`blocked navigation ${url}`);
  });

  window.once("ready-to-show", () => {
    logBoot("window ready-to-show");
    if (!window.isVisible()) window.show();
  });
  window.webContents.once("dom-ready", () => logBoot("renderer dom-ready"));
  window.webContents.on("did-start-loading", () => {
    logBoot(`load start ${devUrl || rendererIndex}`);
    log(`load start ${devUrl || rendererIndex}`);
  });
  window.webContents.on("did-finish-load", () => {
    logBoot(`load finish ${window.webContents.getURL()}`);
    log(`load finish ${window.webContents.getURL()}`);
    if (!window.isVisible()) window.show();
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    log(`load failed ${code} ${description} ${url}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log(`render gone ${JSON.stringify(details)}`);
    stopRendererOwnedWork("SparkAI WorkSpace 界面进程已退出，相关 Agent 运行和自动化命令已取消。");
  });
  window.webContents.once("destroyed", () => {
    stopRendererOwnedWork("SparkAI WorkSpace 窗口已关闭，相关 Agent 运行和自动化命令已取消。");
  });
  window.webContents.on("console-message", (details) => {
    log(`console level=${details.level} ${details.sourceId}:${details.lineNumber} ${details.message}`);
  });

  const query = {
    ...(launch?.projectId ? { projectId: String(launch.projectId) } : {}),
    ...(launch?.newConversation ? { newConversation: "1" } : {})
  };
  if (devUrl) {
    const target = new URL(devUrl);
    Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, value));
    window.loadURL(target.toString());
  } else {
    window.loadFile(rendererIndex, { query });
  }
}

if (projectIoSelftestMode || agentProtocolSelftestMode) {
  module.exports = {
    applicationId,
    applicationName,
    activeNewApiCurlTransportCount,
    agentImageRootsForContext,
    buildProjectAssetIndex,
    boundedImageRead,
    completedImageAccounting,
    assetUrlFor,
    decodeLocalAssetUrl,
    clearNewApiAuth,
    completeNewApiLogin,
    createProjectSaveCoordinator,
    defaultSession,
    encodedImageDimensions,
    ensureProjectFiles,
    imageEditRequestLimiterStatus,
    imageEditRequestHeaders,
    importProjectPackage,
    nextExternalProjectFolderPath,
    normalizeSessionRevision,
    outputBucketDirForProjectId,
    packageProject,
    projectAssetRepository,
    projectAssetRepositoryOwner: projectAssetRepository.owner,
    projectPackageService,
    projectPackageServiceOwner: projectPackageService.owner,
    projectPackageMaximumAssetBytes,
    projectPackageMaximumAssets,
    projectPackageMaximumDecodedBytes,
    projectPackageMaximumFileBytes,
    validateProjectPackageData,
    projectManifestPath,
    projectExportSessionPath,
    projectForFolderOpen,
    projectSessionFromDisk,
    readProjectManifest,
    agentModelUsesResponsesApi,
    managedRelayEndpoint,
    migrateSettings,
    migrateLegacyUserData,
    newApiFetch,
    resolveNewApiBaseUrl,
    newApiRelayJson,
    newApiRelayImage,
    newApiRelayResponsesImage,
    newApiRelayStream,
    newApiTransportFetch,
    newApiUserLogsEndpoint,
    currentDesktopVersion: desktopUpdater.currentDesktopVersion,
    compareDesktopVersions: desktopUpdater.compareDesktopVersions,
    desktopUpdaterFailure: desktopUpdater.desktopUpdaterFailure,
    desktopUpdaterStatus: desktopUpdater.desktopUpdaterStatus,
    pendingDesktopUpdate: desktopUpdater.pendingDesktopUpdate,
    publicPendingDesktopUpdate: desktopUpdater.publicPendingDesktopUpdate,
    persistNewApiSessionCookie,
    normalizeDesktopUpdateArtifact: desktopUpdater.normalizeDesktopUpdateArtifact,
    verifyDesktopReleasePayload: desktopUpdater.verifyDesktopReleasePayload,
    responsesInputFromChatMessages,
    responsesInputItemFromOutput,
    responsesRequestFromChatRequest,
    responsesToolsFromChatTools,
    shouldFallbackResponsesToChat,
    tokenItemsFromNewApiPayload,
    withImageEditRequestSlot,
    sessionForProjectSave,
    sessionFromPackage,
    sessionWithProjectAssets,
    writeProjectManifest
  };
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    logBoot("app ready");
    app.setAppUserModelId(applicationId);
    if (app.isPackaged) {
      try {
        const migration = migrateLegacyUserData({
          targetRoot: packagedDataRoot,
          legacyRoots: legacyPackagedDataRoots
        });
        logBoot(`legacy userData migration ${migration.status} copied=${migration.copiedFiles}`);
      } catch (error) {
        logBoot(`legacy userData migration failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    ensureRuntimeFiles();
    await automationService.start();
    const autoInstallTargets = migrateSettings(readJson(settingsPath, defaultSettings)).agentSkillAutoInstallTargets;
    if (autoInstallTargets.length) {
      const integrationResult = agentIntegrationService.install(autoInstallTargets);
      if (!integrationResult.ok) log(`agent skill auto-install warnings=${integrationResult.errors.join(" | ")}`);
    }
    desktopUpdater.recoverRollback();
    if (lifecycleSelftestMode) {
      const lifecycleRun = agentRunControl.begin({
        runId: "lifecycle-shutdown-probe",
        ownerId: "lifecycle-selftest",
        projectId: "lifecycle-selftest",
        conversationId: "lifecycle-selftest"
      });
      lifecycleRun.signal.addEventListener("abort", () => log("lifecycle agent run aborted before transport shutdown"), { once: true });
      startLocalServerIfNeeded();
      setTimeout(() => app.quit(), 420);
      return;
    }
    cleanupAbandonedExportSourceCaches();
    registerAssetProtocol();
    registerIpc();
    void videoTaskService.resumeAll()
      .then((result) => log(`video task resume projects=${result.projects} resumed=${result.resumed} ambiguous=${result.ambiguous}`))
      .catch((error) => log(`video task resume failed ${error instanceof Error ? error.message : String(error)}`));
    void scientificRunnerService.recoverAll()
      .then((result) => log(`scientific runner recovery projects=${result.projects} interrupted=${result.interrupted}`))
      .catch((error) => log(`scientific runner recovery failed ${error instanceof Error ? error.message : String(error)}`));
    startLocalServerMonitor();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("before-quit", (event) => {
    if (applicationShutdownComplete) return;
    event.preventDefault();
    void shutdownApplicationServices().finally(() => {
      if (!app.isReady()) return;
      app.quit();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

function thumbnailCacheRootForAsset(filePath) {
  const resolved = path.resolve(filePath);
  const project = thumbnailProjectRoots().find((item) => isPathInside(resolved, item.projectPath));
  if (project) return project.cacheRoot;
  if (isPathInside(resolved, referencesDir)) return path.join(configDir, projectMetaDirName, "thumbnails");
  return null;
}
