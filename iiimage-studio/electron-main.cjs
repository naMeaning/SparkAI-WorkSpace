const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeImage, net, protocol, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const { closeSync, copyFileSync, createReadStream, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const { createServer: createNetServer } = require("node:net");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { setTimeout: delay } = require("node:timers/promises");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { PNG } = require("pngjs");
const { createAgentRuntime } = require("./agent-runtime.cjs");
const { exportLayeredPsd, preparePsdRasterSource } = require("./psd-export.cjs");
const { createThumbnailCache } = require("./thumbnail-cache.cjs");
const { createImageImporter, ImageImportError, DEFAULT_MAX_FILES: maxImportedImageFiles } = require("./image-import.cjs");
const { refineSemanticLayers } = require("./semantic-matting.cjs");
const { createAidebugBackend } = require("./desktop/aidebug-backend.cjs");
const { createNewApiClient } = require("./desktop/new-api-client.cjs");
const { createNewApiTransport } = require("./desktop/new-api-transport.cjs");
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
const { createDesktopUpdaterService } = require("./desktop/updater-service.cjs");
const { registerDesktopIpc } = require("./desktop/ipc/register-desktop-ipc.cjs");
const {
  cachedModelSettings,
  createModelCacheKey,
  modelIdsFromResponse,
  preferredAgentModelFromList,
  preferredImageModelFromList,
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

function getDesktopVersion() {
  return String((app.isPackaged ? app.getVersion() : packageMetadata.version) || "0.0.0");
}

const applicationName = "iiimage Studio";
const applicationId = "cn.aieyra.iiimage-studio";
const windowsCurlPath = process.platform === "win32"
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe")
  : "";
app.setName(applicationName);

const devUrl = process.env.IIIMAGE_DEV_URL || "";
const rendererIndex = process.env.IIIMAGE_RENDERER_INDEX
  ? path.resolve(process.env.IIIMAGE_RENDERER_INDEX)
  : path.join(__dirname, "dist", "index.html");
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const desktopRoot = path.join(process.env.USERPROFILE || projectRoot, "Desktop");
const localServerEntryCandidates = [
  process.env.IIIMAGE_LOCAL_SERVER_ENTRY ? path.resolve(process.env.IIIMAGE_LOCAL_SERVER_ENTRY) : "",
  path.join(projectRoot, "services", "ai-gateway", "server.cjs"),
  path.join(workspaceRoot, "ai-native", "services", "ai-gateway", "server.cjs")
].filter(Boolean);
const localServerEntry = localServerEntryCandidates.find((candidate) => existsSync(candidate)) || localServerEntryCandidates[0];
const localServerRoot = path.dirname(localServerEntry);
const aidebugMode = process.env.IIIMAGE_AIDEBUG === "1";
const aidebugLiveImage = process.env.IIIMAGE_AIDEBUG_LIVE_IMAGE === "1";
const aidebugStatefulAuth = process.env.IIIMAGE_AIDEBUG_AUTH_SESSION === "1";
const aidebugMockAgent =
  process.env.IIIMAGE_AIDEBUG_MOCK_AGENT === "1" ||
  /^(mock|stub|fixture)$/i.test(String(process.env.IIIMAGE_AIDEBUG_AGENT_MODE || ""));
const aidebugImageFaultsEnabled =
  aidebugMode &&
  !aidebugLiveImage &&
  process.env.IIIMAGE_AIDEBUG_IMAGE_FAULTS === "1";
const agentModelForceEnabled = false;
const agentToolChoiceForceEnabled = false;
const agentToolArgCorrectionEnabled = false;
// A packaged ASAR is read-only. Keep user sessions, projects, FastMemory,
// caches and logs in Electron's per-user application directory while retaining
// the repository-local layout during development and isolated AIDebug runs.
const packagedDataRoot = app.isPackaged ? app.getPath("userData") : projectRoot;
const configDir = process.env.IIIMAGE_CONFIG_DIR
  ? path.resolve(process.env.IIIMAGE_CONFIG_DIR)
  : app.isPackaged
    ? path.join(packagedDataRoot, "data")
    : path.join(projectRoot, "config");
const agentWorkspaceRoot = app.isPackaged ? path.join(packagedDataRoot, "workspace") : projectRoot;
const debugDir = process.env.IIIMAGE_DEBUG_DIR
  ? path.resolve(process.env.IIIMAGE_DEBUG_DIR)
  : app.isPackaged
    ? path.join(app.getPath("logs"), "runtime")
    : path.join(projectRoot, ".diagnostics", "electron");
const electronLog = process.env.IIIMAGE_ELECTRON_LOG
  ? path.resolve(process.env.IIIMAGE_ELECTRON_LOG)
  : path.join(debugDir, "latest.log");
const settingsPath = path.join(configDir, "app-settings.json");
const sessionPath = path.join(configDir, "session.json");
const modelCachePath = path.join(configDir, "model-cache.json");
const projectListPath = path.join(configDir, "project-list.json");
const projectsDir = path.join(configDir, "projects");
const referencesDir = path.join(configDir, "references");
const projectMetaDirName = ".iiimage";
const projectManifestFileName = "project.json";
const exportSessionFileName = "start.iiimage";
const maxExportImageBytes = 128 * 1024 * 1024;
const projectIoSelftestMode = process.env.IIIMAGE_PROJECT_IO_SELFTEST === "1";
const agentProtocolSelftestMode = process.env.IIIMAGE_AGENT_PROTOCOL_SELFTEST === "1";
const lifecycleSelftestMode = process.env.IIIMAGE_LIFECYCLE_SELFTEST === "1";
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
const maximumConcurrentImageEditRequests = 3;
let activeImageEditRequests = 0;
const queuedImageEditRequests = [];

// Frameless Windows still loses roughly 12-16 px between the outer BrowserWindow
// width and renderer viewport. Keep at least the canonical 884 px workbench
// available to the canvas + fixed Agent panel.
// Production keeps the desktop workspace usable at its supported minimum.
// AIDebug deliberately exercises the responsive 540px layout in an isolated
// user-data directory, so its BrowserWindow must not clamp those captures.
const minWindowWidth = aidebugMode ? 540 : 900;
const minWindowHeight = 640;
const useCustomWindowFrame = process.platform !== "darwin";
const windowIconDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABA0lEQVR4nO3bsQ3CMBCF4cxARcEAiDkoqLIKLfMxAgMwBgUNKEiRkpNjB5Fw57s/0muiFH6fHBcnuWnEs7ucX54j+4YpnoXoXmzaU6iMEEID9FtCe0EaAB8EAAAAAAAAAABAfUEAAAAAAADUBHB/PkwFAC2A7WGvGgAAAAAA0wDH23WUUACy/BoIAAAAgF2AFMKS5asAWDsAAGAAYOqwm5NfirsA+BZhOANwAzAXQQ5BXAGUEFJTIHcAKYTcGMwlwBAhV77/ziVAl1J59wBTCHKnuAaQCKlfxT1A6axQB7ASAP4NUHsAAAAAAAAAAAAAAAAAAABiA4S/OAkAl6dj3SKXfd9DLus2WiDC0gAAAABJRU5ErkJggg==";

function createWindowIcon() {
  const iconPath = [
    path.join(projectRoot, "public", "iiimage-studio.png"),
    path.join(projectRoot, "dist", "iiimage-studio.png")
  ].find((candidate) => existsSync(candidate));
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createFromDataURL(windowIconDataUrl);
  return icon.isEmpty() ? undefined : icon;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "iiimage-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

const defaultSettings = {
  agentProvider: "CODEX",
  agentBaseUrl: "",
  agentApiKey: "",
  agentModel: "",
  agentModelPool: [],
  compactModel: "",
  reasoningEffort: "low",
  fastMode: false,
  timeoutSeconds: 180,
  imageBaseUrl: "",
  imageApiKey: "",
  imageModel: "",
  imageModelPool: [],
  imageCount: 1,
  imageSize: "1024x1024",
  imageQuality: "auto",
  serverUrl: "https://image.aieyra.cn",
  serverToken: "",
  serverSessionCookie: "",
  serverUserId: "",
  theme: "system"
};

const aidebugPublicSettings = {
  imageCostCents: 30,
  imageCostYuan: 0.3,
  trialImages: 10,
  imageModel: "gpt-image-2",
  models: [
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
    "imagen-4"
  ],
  imageModels: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "flux-1.1-pro", "imagen-4"],
  agentModels: ["gpt-5.6-sol", "gpt-5.6", "gpt-5.6-codex", "gpt-5.5", "gpt-5.5-mini", "gpt-5-codex", "gpt-5.4", "gpt-5.3", "gpt-5.2", "gpt-5.1", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "o3", "deepseek-v3.2", "deepseek-r1", "glm-4.6", "doubao-seed-1.8"],
  channelName: "AIDebug",
  serviceReady: true,
  keyManaged: true
};

const legacyLocalServerUrls = new Set([
  "http://127.0.0.1:17860",
  "http://localhost:17860",
  "http://[::1]:17860"
]);

function normalizeStoredServerUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function isLegacyLocalServerUrl(value) {
  return legacyLocalServerUrls.has(normalizeStoredServerUrl(value).toLowerCase());
}

function aidebugSettings() {
  return {
    ...defaultSettings,
    serverToken: "aidebug-token",
    serverSessionCookie: "aidebug-session",
    serverUserId: "aidebug-user",
    imageModel: aidebugPublicSettings.imageModel,
    imageModelPool: aidebugPublicSettings.imageModels,
    agentModel: aidebugPublicSettings.agentModels[0],
    agentModelPool: aidebugPublicSettings.agentModels
  };
}

function aidebugUser() {
  return {
    id: "aidebug-user",
    username: "aidebug",
    account: "aidebug",
    email: "aidebug@iiimage.local",
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

const defaultSession = {
  sessionRevision: 0,
  nodeSequence: 0,
  messages: [],
  nodes: [],
  selectedNodeId: ""
};

function ensureRuntimeFiles() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(agentWorkspaceRoot, { recursive: true });
  mkdirSync(debugDir, { recursive: true });
  mkdirSync(path.dirname(electronLog), { recursive: true });
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(referencesDir, { recursive: true });
  desktopUpdater.ensureRuntimeDirectories();
  if (!existsSync(settingsPath)) {
    writeJson(settingsPath, aidebugMode ? aidebugSettings() : defaultSettings);
  }
  if (!existsSync(sessionPath)) {
    writeJson(sessionPath, defaultSession);
  }
  if (!existsSync(projectListPath)) {
    writeJson(projectListPath, defaultProjectList());
  }
  const list = readProjectList();
  const activeProject = getActiveProject(list);
  if (activeProject && !existsSync(activeProject.sessionPath)) {
    ensureProjectFiles(activeProject, defaultSession);
  }
  writeFileSync(electronLog, `[${new Date().toISOString()}] IIimage electron boot\n`, "utf8");
  logBoot("runtime files ready");
}

function migrateSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = { ...defaultSettings };

  for (const key of Object.keys(defaultSettings)) {
    if (source[key] !== undefined) next[key] = source[key];
  }

  if (!source.agentBaseUrl && source.baseUrl) next.agentBaseUrl = source.baseUrl;
  if (!source.agentApiKey && source.apiKey) next.agentApiKey = source.apiKey;
  if (!source.agentModel && source.model) next.agentModel = source.model;
  if (!source.imageBaseUrl && source.baseUrl) next.imageBaseUrl = source.baseUrl;
  if (!source.imageApiKey && source.apiKey) next.imageApiKey = source.apiKey;
  next.imageModelPool = uniqueImageModels(Array.isArray(source.imageModelPool) ? source.imageModelPool : next.imageModelPool);
  if (!next.imageModel && next.imageModelPool.length) next.imageModel = next.imageModelPool[0];
  if (next.imageModel) next.imageModelPool = uniqueImageModels([next.imageModel, ...next.imageModelPool]);
  next.agentProvider = ["CODEX", "CUSTOM"].includes(String(next.agentProvider)) ? String(next.agentProvider) : "CODEX";
  next.reasoningEffort = ["low", "medium", "high", "xhigh", "max", "ultra"].includes(String(next.reasoningEffort)) ? String(next.reasoningEffort) : "low";
  const timeoutSeconds = Number(next.timeoutSeconds);
  next.timeoutSeconds = Number.isFinite(timeoutSeconds)
    ? Math.max(15, Math.min(600, Math.round(timeoutSeconds)))
    : defaultSettings.timeoutSeconds;
  next.fastMode = Boolean(next.fastMode);
  if (isLegacyLocalServerUrl(next.serverUrl)) {
    next.serverUrl = defaultSettings.serverUrl;
    next.serverToken = "";
    next.serverSessionCookie = "";
    next.serverUserId = "";
  }

  delete next.baseUrl;
  delete next.apiKey;
  delete next.model;
  return next;
}

function publicSettings(settings) {
  const next = { ...migrateSettings(settings) };
  delete next.serverSessionCookie;
  delete next.serverUserId;
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

const aidebugBackend = aidebugMode && aidebugMockAgent
  ? createAidebugBackend({ enabled: aidebugMode, log })
  : null;
const newApiTransport = createNewApiTransport({
  app,
  applicationName,
  windowsCurlPath,
  getDesktopVersion,
  getAuthEpoch: () => newApiAuthEpoch
});
const {
  activeNewApiCurlTransportCount,
  newApiTransportFetch,
  stopActiveNewApiCurlTransports
} = newApiTransport;
const newApiClient = createNewApiClient({
  defaultSettings,
  ensureLocalServer,
  isLocalServerUrl,
  log,
  migrateSettings,
  newApiTransportFetch,
  normalizeServerUrl,
  readJson,
  settingsPath,
  writeJson
});
const {
  extractSessionCookie,
  isNewApiAuthError,
  managedRelayEndpoint,
  newApiErrorMessage,
  newApiFetch,
  newApiRelayJson,
  newApiRelayStream,
  newApiRequest,
  newApiUserAuthHeaders,
  parseJsonText,
  persistNewApiSessionCookie,
  requireNewApiSession
} = newApiClient;
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
  normalizeServerUrl,
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
  try {
    if (!existsSync(filePath)) {
      writeJson(filePath, fallback);
      return fallback;
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return { ...fallback, ...parsed };
  } catch (error) {
    log(`read-json-failed ${filePath}: ${error.message}`);
    writeJson(filePath, fallback);
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

let projectAssetRepository = null;
const projectStore = createProjectStore({
  comparablePath,
  defaultSession,
  exportSessionFileName,
  isPathInside,
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
projectAssetRepository = createProjectAssetRepository({
  assetUrlFor,
  boundedImageRead,
  comparablePath,
  isComparablePathInside,
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
  sessionForProjectSave,
  sessionWithProjectAssets
} = projectAssetRepository;


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
  projectAssetRoots,
  projectRelativePath,
  projectSessionFromDisk,
  resolveProjectRelativePath,
  safeName,
  sanitizeSession,
  sessionForProjectSave,
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
  protocol.handle("iiimage-asset", async (request) => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/^\/+/, "");
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

      return net.fetch(pathToFileURL(resolved).toString());
    } catch (error) {
      log(`asset protocol failed: ${error.message}`);
      return new Response("asset protocol error", { status: 500 });
    }
  });
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
  return "application/octet-stream";
}

function assetUrlFor(filePath) {
  const resolved = path.resolve(filePath);
  if (isPathInside(resolved, projectRoot)) {
    const relativePath = path.relative(projectRoot, resolved).split(path.sep).map(encodeURIComponent).join("/");
    return `iiimage-asset://local/${relativePath}`;
  }
  return `iiimage-asset://local/abs/${encodeURIComponent(resolved)}`;
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
    path.join(projectPath, projectMetaDirName, "assets")
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
  if (typeof value !== "string" || !value.startsWith("iiimage-asset:")) return "";
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
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  return null;
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
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("远程图片协议不受支持。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await net.fetch(parsed.toString(), { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`远程图片下载失败（HTTP ${response.status}）。`);
    const finalUrl = new URL(response.url || parsed.toString());
    if (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") throw new Error("远程图片重定向到了不安全的协议。");
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxExportImageBytes) throw new Error("远程图片超过 128 MB，已取消导出。");
    if (!response.body) throw new Error("远程图片响应为空。");
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (received > maxExportImageBytes) {
        await reader.cancel();
        throw new Error("远程图片超过 128 MB，已取消导出。");
      }
      chunks.push(chunk);
    }
    if (received <= 0) throw new Error("远程图片数据为空。");
    return Buffer.concat(chunks, received);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("远程图片下载超时。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  const cacheDir = path.resolve(activeProjectTempDir(context.project.id), "export-sources");
  const resolved = path.resolve(source.path);
  const ownedNamePattern = new RegExp(`^[a-f0-9]{64}-${process.pid}\\.(?:png|jpe?g|webp)$`, "i");
  if (!ownedNamePattern.test(path.basename(resolved)) || !isComparablePathInside(resolved, cacheDir) || comparablePath(path.dirname(resolved)) !== comparablePath(cacheDir) || !existsSync(resolved)) return;
  try {
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

function safeExportStem(value, fallback = "iiimage-image") {
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

function preferredAssetName(asset, suggestedName, fallback = "iiimage-image") {
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

function exportFileName(source, suggestedName, fallback = "iiimage-image") {
  return `${safeExportStem(preferredAssetName(source.asset, suggestedName, fallback), fallback)}${source.extension}`;
}

function ensureMatchingExportExtension(filePath, extension) {
  const selectedExtension = path.extname(filePath).toLowerCase();
  if (!selectedExtension) return `${filePath}${extension}`;
  if (extension === ".jpg" && (selectedExtension === ".jpg" || selectedExtension === ".jpeg")) return filePath;
  if (selectedExtension === extension) return filePath;
  return path.join(path.dirname(filePath), `${path.parse(filePath).name}${extension}`);
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
  if (!path.basename(resolvedStaging).startsWith(".iiimage-export-") || !isComparablePathInside(resolvedStaging, resolvedParent)) return;
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

function sanitizeOutputBucket(value) {
  const normalized = String(value || "imagegen").trim().toLowerCase();
  return normalized === "post" || normalized === "imagegen" ? normalized : "imagegen";
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
    const assets = writeServerImageOutputs(extractServerImages(data), stem, runId, projectId, outputFormat);
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
  const hasNativeResponsesTool = Array.isArray(requestBody.tools) && requestBody.tools.some((tool) => String(tool?.type || "") === "web_search");
  const useResponsesApi = hasNativeResponsesTool || agentModelUsesResponsesApi(requestBody.model);
  const endpoint = useResponsesApi ? "/v1/responses" : "/v1/chat/completions";
  const relayBody = useResponsesApi ? responsesRequestFromChatRequest(requestBody) : requestBody;
  const imageToolChoiceName = String(requestBody.tool_choice?.function?.name || requestBody.toolChoice?.function?.name || "");
  const configuredTimeoutMs = Math.max(15, Number(settings.timeoutSeconds ?? 180)) * 1000;
  const reasoningModelFloorMs = useResponsesApi ? 180_000 : 0;
  const timeoutMs = imageToolChoiceName === "image_gen"
    ? Math.min(Math.max(configuredTimeoutMs, reasoningModelFloorMs), 300_000)
    : Math.max(configuredTimeoutMs, reasoningModelFloorMs);
  const controller = new AbortController();
  let timeoutError = null;
  let timeoutTimer = null;
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
          if (typeof payload.onStreamEvent === "function") payload.onStreamEvent(event);
        }, { signal: controller.signal, headersTimeoutMs: timeoutMs, connectTimeoutMs: 30_000 }),
        timeoutPromise
      ]);
      log(`agent new-api ${useResponsesApi ? "responses" : "chat"} stream chunks=${chunks.length} model=${payload.model || settings.agentModel || "server-selected"}`);
      return { stream: true, chunks, model: payload.model || settings.agentModel };
    }
    const data = await Promise.race([
      newApiRelayJson(settings, endpoint, relayBody, { signal: controller.signal }),
      timeoutPromise
    ]);
    log(`agent new-api ${useResponsesApi ? "responses" : "chat"} model=${data.model || payload.model || settings.agentModel || "server-selected"}`);
    return data;
  } catch (error) {
    if (error === timeoutError || controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    controller.abort();
  }
}

function currentAgentSettings() {
  return migrateSettings(readJson(settingsPath, defaultSettings));
}

function getAgentRuntime() {
  if (!agentRuntime) {
    agentRuntime = createAgentRuntime({
      projectRoot: agentWorkspaceRoot,
      configDir,
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
          const assets = writeServerImageOutputs(extractServerImages(data), stem, runId, projectId, outputFormat);
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
    sender.send("iiimage:agent:progress", {
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
  const settings = migrateSettings({ ...currentAgentSettings(), ...(incomingSettings || {}) });
  const target = provider === "image" ? "image" : "agent";
  const serverSettings = await newApiModelSettings(settings);
  const models = uniqueImageModels(target === "image" ? serverSettings.imageModels : serverSettings.agentModels);
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

function normalizeServerUrl(value) {
  return String(value || defaultSettings.serverUrl).trim().replace(/\/$/, "") || defaultSettings.serverUrl;
}

function isLocalServerUrl(value) {
  try {
    const url = new URL(normalizeServerUrl(value));
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function isLocalServerHealthy(serverUrl = defaultSettings.serverUrl) {
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

async function waitForLocalServer(serverUrl = defaultSettings.serverUrl) {
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
      IIIMAGE_SERVER_PORT: "17860",
      IIIMAGE_PARENT_PID: String(process.pid)
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

async function ensureLocalServer() {
  if (localServerEnsurePromise) return localServerEnsurePromise;
  const task = (async () => {
    const startedAt = Date.now();
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (!isLocalServerUrl(settings.serverUrl)) return;
    if (await isLocalServerHealthy(settings.serverUrl)) {
      log(`local server healthy in ${Date.now() - startedAt}ms`);
      return;
    }
    startLocalServerIfNeeded();
    if (!(await waitForLocalServer(settings.serverUrl))) {
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
  if (!isLocalServerUrl(settings.serverUrl)) {
    logBoot("local server monitor skipped for managed service");
    return;
  }
  void ensureLocalServer();
  localServerMonitor = setInterval(() => {
    void ensureLocalServer();
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
  cancelQueuedImageEditRequests();
  const localServerStop = stopLocalServer();
  const cleanup = Promise.allSettled([
    localServerStop,
    stopActiveNewApiCurlTransports(),
    recycleProjectImageImporter(false),
    imageThumbnailCache.close(),
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
  const username = String(userData.username || userData.email || userData.id || userData.crmUserId || "").trim();
  const displayName = String(userData.displayName || userData.display_name || userData.name || username || "IIimage User").trim();
  const agent = userData.agent && typeof userData.agent === "object" ? userData.agent : {};
  const quota = Number(userData.quota ?? userData.remain_quota ?? userData.balance ?? 0);
  const rmbBalance = Number(userData.rmbBalance);
  const balanceCents = Number.isFinite(rmbBalance)
    ? Math.max(0, Math.round(rmbBalance * 100))
    : Number.isFinite(quota)
      ? Math.max(0, Math.round((quota / newApiQuotaPerUnit) * 100))
      : 0;
  return {
    id: String(userData.id || userData.providerUserId || userData.crmUserId || ""),
    email: String(userData.email || username || ""),
    username,
    account: username,
    name: displayName,
    crmUserId: String(userData.crmUserId || ""),
    inviteCode: String(userData.inviteCode || agent.inviteCode || ""),
    agentLevel: String(userData.agentLevel || agent.level || ""),
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
  return createModelCacheKey(normalizeServerUrl(settings.serverUrl), settings.serverUserId);
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

async function fetchNewApiModelSettings(settings) {
  const collected = [];
  let successfulRequests = 0;
  let lastError = null;
  try {
    const userModels = await newApiRequest(settings, "/api/user/models", {
      headers: newApiUserAuthHeaders(settings),
      retries: 0
    });
    successfulRequests += 1;
    collected.push(...modelIdsFromResponse(userModels));
  } catch (error) {
    lastError = error;
    log(`new-api user models failed ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (settings.serverSessionCookie && settings.serverUserId) {
      const { response, data } = await newApiFetch(settings, managedRelayEndpoint("/v1/models"), {
        headers: newApiUserAuthHeaders(settings),
        timeoutMs: 20_000,
        retries: 0
      });
      persistNewApiSessionCookie(settings, response);
      if (response.ok && data.parseFailed !== true && !data.error) {
        successfulRequests += 1;
        collected.push(...modelIdsFromResponse(data));
      } else {
        lastError = new Error(newApiErrorMessage(data, response.status));
      }
    }
  } catch (error) {
    lastError = error;
        log(`managed relay models failed ${error instanceof Error ? error.message : String(error)}`);
  }
  if (successfulRequests === 0) throw lastError || new Error("模型服务暂时不可用。");
  return splitModelSettings(settings, collected);
}

async function newApiModelSettings(settings, options = {}) {
  const forceRefresh = options?.forceRefresh === true;
  const cacheWasAlreadyLoaded = modelCacheDiskLoaded;
  loadModelCacheFromDisk(settings);
  const key = modelCacheKey(settings);
  const now = Date.now();
  const memoryEntry = modelCacheMemory.get(key);
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
      const entry = { cachedAt: Date.now(), settings: cachedModelSettings(settings, loaded) };
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

function aidebugImageDimensions(size = "512x512") {
  const match = String(size || "").match(/(\d{2,5})\s*x\s*(\d{2,5})/i);
  const sourceWidth = Math.max(1, Number(match?.[1] || 512));
  const sourceHeight = Math.max(1, Number(match?.[2] || 512));
  const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(96, Math.round(sourceWidth * scale)),
    height: Math.max(96, Math.round(sourceHeight * scale))
  };
}

function aidebugLayerFixtureHint(payload = {}) {
  const prompt = String(payload.prompt || "");
  const explicitRole = String(payload.layerRole || "").trim().toLowerCase();
  const explicitId = String(payload.layerId || "").trim().toLowerCase();
  const layerTitle = prompt.match(/本次只输出图层[「"]([^」"]+)[」"]/u)?.[1]?.trim() || "";
  const isLayerPrompt = Boolean(layerTitle) && (
    /#ff00ff|色键背景|客户端会自动移除色键背景/i.test(prompt) ||
    /纯背景层|背景必须不透明/.test(prompt)
  );
  let role = explicitRole;
  if (!role && isLayerPrompt) {
    if (/纯背景层|背景必须不透明/.test(prompt)) role = "background";
    else {
      const roleText = `${layerTitle} ${payload.runId || ""}`.toLowerCase();
      if (/foreground|前景/.test(roleText)) role = "foreground";
      else if (/decor|prop|道具|装饰/.test(roleText)) role = "decoration";
      else if (/title|heading|headline|body-text|text|标题|文字|文案/.test(roleText)) role = "text";
      else if (/subject|character|人物|主体|角色|模特/.test(roleText)) role = "subject";
      else role = "fixture-layer";
    }
  }
  const id = explicitId || (isLayerPrompt
    ? String(layerTitle || payload.runId || role)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
    : "");
  const explicitComplete = Boolean(explicitRole && explicitId);
  return {
    role,
    id,
    isLayerPrompt,
    source: explicitComplete ? "explicit" : isLayerPrompt ? "prompt-compat" : "none"
  };
}

function aidebugImageBase64(index = 0, payload = {}) {
  const { width, height } = aidebugImageDimensions(payload.size);
  const png = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  const layerHint = aidebugLayerFixtureHint(payload);
  const layerRole = layerHint.role;
  const layerId = layerHint.id;
  const mode = String(payload.mode || payload.operation || "").trim().toLowerCase();
  const isLayerMask = String(payload.layerOutputMode || "").trim().toLowerCase() === "mask" && layerHint.role !== "background";
  // The recoverable-layer suite must compare two executions of the same
  // visual fixture. A random runtime group id changing the fixture palette
  // makes the local fidelity gate probabilistic and hides real regressions.
  const deterministicRecoverySeed = /AIDebug 分层恢复测试/i.test(String(payload.prompt || ""))
    ? "layers-1784503314030-cg8tf"
    : "";
  const layerGroupSeed = deterministicRecoverySeed || String(payload.layerGroupId || payload.runId || "").match(/layers-\d+-[a-z0-9]+/i)?.[0] || "";
  const signature = (layerGroupSeed
    ? [layerGroupSeed, index]
    : [payload.runId, payload.prompt, layerRole, layerId, index]
  ).map((value) => String(value || "")).join("|");
  const digest = createHash("sha256").update(signature).digest();
  const base = [
    34 + digest[0] % 92,
    48 + digest[1] % 104,
    72 + digest[2] % 116,
    255
  ];
  const accent = isLayerMask ? [255, 255, 255, 255] : [
    174 + digest[3] % 82,
    174 + digest[4] % 82,
    174 + digest[5] % 82,
    255
  ];
  const secondary = isLayerMask ? [255, 255, 255, 255] : [
    72 + digest[6] % 150,
    72 + digest[7] % 150,
    72 + digest[8] % 150,
    255
  ];
  const magenta = [255, 0, 255, 255];
  const clear = [0, 0, 0, 0];
  const transparentRequested = (
    payload.transparentPreferred === true ||
    String(payload.background || "").toLowerCase() === "transparent" ||
    mode === "cutout"
  );
  const transparentDirect = Boolean(
    transparentRequested && (!layerRole || (layerRole !== "background" && !isLayerMask))
  );
  // The mixed layer pipeline now asks the image service for genuine full-colour
  // transparent subject/product assets. Mock that native response directly so
  // GUI tests exercise the same existing-alpha path as production. Chroma-key
  // plates remain a compatibility fallback for non-transparent legacy hints.
  const isLayerChroma = Boolean(layerRole && layerRole !== "background" && !isLayerMask && !transparentDirect);
  const isLayerPreview = Boolean(layerGroupSeed && /-preview(?:-|$)/i.test(String(payload.runId || "")));

  const setPixel = (x, y, color) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const offset = (py * width + px) * 4;
    png.data[offset] = color[0];
    png.data[offset + 1] = color[1];
    png.data[offset + 2] = color[2];
    png.data[offset + 3] = (isLayerMask || (!transparentDirect && !isLayerChroma)) ? 255 : color[3] ?? 255;
  };
  const fill = (color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) setPixel(x, y, color);
    }
  };
  const rect = (x, y, w, h, color) => {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(width, Math.ceil(x + w));
    const bottom = Math.min(height, Math.ceil(y + h));
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) setPixel(px, py, color);
    }
  };
  const circle = (cx, cy, radius, color) => {
    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    const squared = radius * radius;
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        if ((px - cx) ** 2 + (py - cy) ** 2 <= squared) setPixel(px, py, color);
      }
    }
  };
  const diamond = (cx, cy, radius, color) => {
    const left = Math.max(0, Math.floor(cx - radius));
    const right = Math.min(width - 1, Math.ceil(cx + radius));
    const top = Math.max(0, Math.floor(cy - radius));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius));
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        if (Math.abs(px - cx) + Math.abs(py - cy) <= radius) setPixel(px, py, color);
      }
    }
  };
  const line = (x1, y1, x2, y2, thickness, color) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      circle(x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress, thickness / 2, color);
    }
  };
  const gradientBackground = () => {
    for (let y = 0; y < height; y += 1) {
      const mix = y / Math.max(1, height - 1);
      for (let x = 0; x < width; x += 1) {
        const checker = (Math.floor(x / Math.max(8, width / 16)) + Math.floor(y / Math.max(8, height / 16))) % 2 === 0 ? 8 : 0;
        setPixel(x, y, [
          Math.min(255, Math.round(base[0] * (1 - mix) + secondary[0] * mix) + checker),
          Math.min(255, Math.round(base[1] * (1 - mix) + secondary[1] * mix) + checker),
          Math.min(255, Math.round(base[2] * (1 - mix) + secondary[2] * mix) + checker),
          255
        ]);
      }
    }
  };
  const drawSubject = (overrideColor = null) => {
    const primary = overrideColor || accent;
    const detail = overrideColor || [255, 255, 255, 185];
    const centerX = width * (0.42 + (digest[9] % 17) / 100);
    circle(centerX, height * 0.32, Math.min(width, height) * 0.09, primary);
    rect(centerX - width * 0.11, height * 0.4, width * 0.22, height * 0.36, primary);
    rect(centerX - width * 0.055, height * 0.43, width * 0.04, height * 0.28, detail);
  };
  const drawBackground = () => {
    gradientBackground();
    circle(width * 0.78, height * 0.24, Math.min(width, height) * 0.13, [accent[0], accent[1], accent[2], 255]);
    line(width * 0.08, height * 0.84, width * 0.92, height * 0.62, Math.max(4, width * 0.012), [secondary[0], secondary[1], secondary[2], 255]);
  };
  const drawForeground = (overrideColor = null) => {
    const primary = overrideColor || accent;
    const secondaryColor = overrideColor || [secondary[0], secondary[1], secondary[2], 255];
    const pale = overrideColor || [255, 255, 255, 205];
    const paleSecondary = overrideColor || [255, 255, 255, 170];
    rect(0, height * 0.72, width, height * 0.28, secondaryColor);
    rect(width * 0.08, height * 0.68, width * 0.84, height * 0.07, primary);
    circle(width * 0.18, height * 0.72, width * 0.09, pale);
    circle(width * 0.78, height * 0.76, width * 0.12, paleSecondary);
  };
  const drawDecoration = (overrideColor = null) => {
    const primary = overrideColor || accent;
    const secondaryColor = overrideColor || secondary;
    line(width * 0.12, height * 0.78, width * 0.84, height * 0.22, Math.max(5, width * 0.018), primary);
    for (let marker = 0; marker < 5; marker += 1) {
      circle(width * (0.18 + marker * 0.15), height * (0.26 + (marker % 2) * 0.12), Math.max(5, width * (0.018 + marker * 0.002)), marker % 2 ? secondaryColor : primary);
    }
  };
  const drawTextLayer = (titleLayer, overrideColor = null) => {
    const primary = overrideColor || accent;
    const secondaryColor = overrideColor || [secondary[0], secondary[1], secondary[2], 255];
    const pale = overrideColor || [255, 255, 255, 230];
    const startY = titleLayer ? height * 0.12 : height * 0.79;
    const barHeight = Math.max(5, height * (titleLayer ? 0.035 : 0.018));
    rect(width * 0.12, startY, width * (titleLayer ? 0.62 : 0.46), barHeight, primary);
    rect(width * 0.12, startY + barHeight * 2.1, width * (titleLayer ? 0.42 : 0.58), barHeight, secondaryColor);
    rect(width * 0.12, startY + barHeight * 4.2, width * (titleLayer ? 0.24 : 0.34), barHeight, pale);
  };

  if (isLayerMask) fill([0, 0, 0, 255]);
  else if (isLayerChroma) fill(magenta);
  else if (transparentDirect) fill(clear);
  else gradientBackground();

  if (isLayerPreview) {
    drawBackground();
    drawForeground();
    drawSubject();
    drawDecoration();
    drawTextLayer(true);
    drawTextLayer(false);
  } else if (layerRole === "background") {
    drawBackground();
  } else if (layerRole === "foreground") {
    drawForeground();
    if (isLayerMask) {
      const erase = [0, 0, 0, 255];
      drawSubject(erase);
      drawDecoration(erase);
      drawTextLayer(true, erase);
      drawTextLayer(false, erase);
    }
  } else if (layerRole === "subject") {
    drawSubject();
    if (isLayerMask) {
      const erase = [0, 0, 0, 255];
      drawDecoration(erase);
      drawTextLayer(true, erase);
      drawTextLayer(false, erase);
    }
  } else if (layerRole === "decoration") {
    drawDecoration();
    if (isLayerMask) {
      const erase = [0, 0, 0, 255];
      drawTextLayer(true, erase);
      drawTextLayer(false, erase);
    }
  } else if (layerRole === "text") {
    const titleLayer = /title|heading|headline/i.test(layerId);
    drawTextLayer(titleLayer);
    if (isLayerMask && titleLayer) drawTextLayer(false, [0, 0, 0, 255]);
  } else if (layerRole) {
    diamond(width * 0.5, height * 0.5, Math.min(width, height) * 0.2, accent);
  } else if (transparentDirect) {
    drawSubject();
    circle(width * 0.7, height * 0.34, Math.min(width, height) * 0.055, secondary);
  } else {
    drawSubject();
    diamond(width * 0.74, height * 0.42, Math.min(width, height) * (0.08 + (index % 3) * 0.018), accent);
    line(width * 0.1, height * (0.78 - (index % 3) * 0.06), width * 0.9, height * (0.64 + (index % 2) * 0.08), Math.max(5, width * 0.016), [255, 255, 255, 210]);
    const markerSize = Math.max(18, Math.min(width, height) * 0.12);
    rect(width * 0.05, height * 0.05, markerSize, markerSize, [18, 24, 36, 220]);
    for (let bit = 0; bit < 4; bit += 1) {
      if (((index + 1 + digest[10]) >> bit) & 1) rect(width * 0.065 + bit * markerSize * 0.18, height * 0.07, markerSize * 0.1, markerSize * 0.62, accent);
    }
  }

  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true }).toString("base64");
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
    error.code = "IIIMAGE_SOURCE_DIMENSIONS_TOO_LARGE";
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
      error.code = "IIIMAGE_SOURCE_NOT_FILE";
      throw error;
    }
    if (info.size > safeMaximum) {
      const error = new Error(`${kind} ${name} 超过 ${Math.round(safeMaximum / 1024 / 1024)}MB。`);
      error.code = "IIIMAGE_SOURCE_TOO_LARGE";
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
      error.code = "IIIMAGE_SOURCE_TOO_LARGE";
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
    error.code = "IIIMAGE_SOURCE_DECODE_FAILED";
    throw error;
  }
  const dimensions = decoded.getSize();
  if (dimensions.width > 12_000 || dimensions.height > 12_000 || dimensions.width * dimensions.height > 64_000_000) {
    const error = new Error(`图片 ${image.name || path.basename(image.path)} 像素尺寸过大，请先缩小后再处理。`);
    error.code = "IIIMAGE_SOURCE_DIMENSIONS_TOO_LARGE";
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
      error.code = "IIIMAGE_SOURCE_UPLOAD_TOO_LARGE";
      throw error;
    }
    return { buffer: original, mimeType: image.mimeType || "image/png", name: image.name || path.basename(image.path) || "image.png", originalBytes: original.length, uploadBytes: original.length, compressed: false };
  }
  if (best.length > 16 * 1024 * 1024) {
    const error = new Error(`图片 ${image.name || path.basename(image.path)} 压缩后仍过大，请先缩小后再处理。`);
    error.code = "IIIMAGE_SOURCE_UPLOAD_TOO_LARGE";
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

async function callNewApiImage(settings, payload = {}) {
  requireNewApiSession(settings);
  const model = String(payload.model || settings.imageModel || "gpt-image-2").trim();
  const requestedCount = Math.floor(Number(payload.count || 1));
  const count = Math.max(1, Math.min(Number.isFinite(requestedCount) ? requestedCount : 1, 10));
  const size = String(payload.size || settings.imageSize || "1024x1024").trim();
  const quality = String(payload.quality || settings.imageQuality || "auto").trim();
  const imageControls = {
    outputFormat: payload.outputFormat ?? payload.output_format,
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
      error.code = "IIIMAGE_SOURCE_TOO_LARGE";
      throw error;
    }
    aggregateSourceBytes += info.size;
  }
  if (aggregateSourceBytes > 160 * 1024 * 1024) {
    const error = new Error("本次原图与参考图总大小超过 160MB，请分批处理。");
    error.code = "IIIMAGE_SOURCE_BATCH_TOO_LARGE";
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
    if (process.env.IIIMAGE_AIDEBUG_ASSERT_EXPLICIT_LAYER_HINT === "1" && fixtureHint.isLayerPrompt) {
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
        process.env.IIIMAGE_AIDEBUG_ASSERT_CLEAN_BACKGROUND_REFERENCE === "1" &&
        !referenceImages.some((image) => String(image.role || "").trim().toLowerCase() === "clean-background")
      ) {
        throw new Error("AIDebug semantic layer mask expected the generated clean-background reference.");
      }
    }
  }
  const imageTimeoutMs = 5 * 60 * 1000;
  const requestAttempts = Array.from({ length: count }, () => ({ attempts: 0, retries: 0, timeoutRetries: 0, transientRetries: 0, lastCategory: "" }));
  const idempotencyKeys = Array.from({ length: count }, (_item, index) => createHash("sha256")
    .update(`${settings.serverUserId}|${String(payload.runId || "")}|${index}|${model}|${promptForIndependentImage(payload.prompt, count, index)}`)
    .digest("hex"));

  function imageRequestErrorInfo(error) {
    const status = Number(error?.status || error?.data?.status || 0) || 0;
    const code = String(error?.code || error?.cause?.code || "").toLowerCase();
    const message = String(error?.message || error || "");
    const normalized = `${code} ${message}`.toLowerCase();
    if (error?.ambiguous === true) {
      return { category: "ambiguous", retryable: true, maxRetries: 1, status, message };
    }
    if (code === "iiimage_image_timeout" || error?.name === "AbortError" || /timeout|timed out|etimedout|超时|超过\s*300\s*秒/.test(normalized)) {
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
      error.code = "IIIMAGE_IMAGE_TIMEOUT";
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
    const timeoutError = new Error(`Image 2 第 ${index + 1}/${count} 张请求超过 300 秒，已中断。`);
    timeoutError.code = "IIIMAGE_IMAGE_TIMEOUT";
    timeoutError.errorCategory = "timeout";
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, imageTimeoutMs);
    });
    try {
      return await Promise.race([task(controller.signal), timeoutPromise]);
    } catch (error) {
      if (error === timeoutError || controller.signal.aborted) throw timeoutError;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }

  async function requestSingleImageAttempt(index) {
    const executeAttempt = () => withImageRequestTimeout(async (signal) => {
      const prompt = promptForIndependentImage(payload.prompt, count, index);
      const requestHeaders = {
        ...newApiUserAuthHeaders(settings),
        "Idempotency-Key": `iiimage-${idempotencyKeys[index]}`
      };
      if (aidebugMockImage) {
        await delay(45);
        const directive = aidebugImageFaultDirective(prompt);
        const attempt = requestAttempts[index].attempts;
        if (directive && attempt <= directive.failures) {
          throw aidebugImageFaultError(directive.category, attempt);
        }
        return {
          data: [{
            b64_json: aidebugImageBase64(index, { ...payload, prompt }),
            revised_prompt: `AIDebug mock image ${index + 1}/${count}${payload.layerId ? ` · layer=${payload.layerId}` : ""}`
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
        if (!isGptImageModel(model)) form.set("response_format", "b64_json");
        if (imageControls.outputFormat) form.set("output_format", String(imageControls.outputFormat));
        if (imageControls.outputCompression !== undefined) form.set("output_compression", String(imageControls.outputCompression));
        if (imageControls.background) form.set("background", String(imageControls.background));
        if (imageControls.moderation) form.set("moderation", String(imageControls.moderation));
        if (imageControls.inputFidelity) form.set("input_fidelity", String(imageControls.inputFidelity));
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
      let request = await newApiFetch(settings, managedRelayEndpoint("/v1/images/edits"), {
        method: "POST",
        headers: requestHeaders,
        body: buildForm(false),
        signal,
        headersTimeoutMs: imageTimeoutMs,
        connectTimeoutMs: 30_000,
        maxRequestBytes: 96 * 1024 * 1024,
        maxResponseBytes: 64 * 1024 * 1024
      });
      persistNewApiSessionCookie(settings, request.response);
      if (request.response.status === 413) {
        compressedSourceRetryCount += 1;
        request = await newApiFetch(settings, managedRelayEndpoint("/v1/images/edits"), {
          method: "POST",
          headers: { ...requestHeaders, "Idempotency-Key": `${requestHeaders["Idempotency-Key"]}-aggressive` },
          body: buildForm(true),
          signal,
          headersTimeoutMs: imageTimeoutMs,
          connectTimeoutMs: 30_000,
          maxRequestBytes: 96 * 1024 * 1024,
          maxResponseBytes: 64 * 1024 * 1024
        });
        persistNewApiSessionCookie(settings, request.response);
      }
      const { response, data } = request;
      if (!response.ok || data.error || data.success === false || data.ok === false) {
        const error = new Error(`image_gen edit ${response.status} 第 ${index + 1}/${count} 张: ${newApiErrorMessage(data, response.status)}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
      }

      const body = { model, prompt, size, quality, n: 1 };
      if (!isGptImageModel(model)) body.response_format = "b64_json";
      if (imageControls.outputFormat) body.output_format = imageControls.outputFormat;
      if (imageControls.outputCompression !== undefined) body.output_compression = imageControls.outputCompression;
      if (imageControls.background) body.background = imageControls.background;
      if (imageControls.moderation) body.moderation = imageControls.moderation;
      return newApiRelayJson(settings, "/v1/images/generations", body, {
        signal,
        headers: { "Idempotency-Key": `iiimage-${idempotencyKeys[index]}` },
        headersTimeoutMs: imageTimeoutMs,
        connectTimeoutMs: 30_000,
        maxResponseBytes: 64 * 1024 * 1024
      });
    }, index);
    return editRequested ? withImageEditRequestSlot(executeAttempt) : executeAttempt();
  }

  async function requestSingleImage(index) {
    const stats = requestAttempts[index];
    for (;;) {
      stats.attempts += 1;
      try {
        return await requestSingleImageAttempt(index);
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
        await delay(delayMs);
      }
    }
  }

  const settled = new Array(count);
  let nextImageIndex = 0;
  const worker = async () => {
    while (nextImageIndex < count) {
      const index = nextImageIndex;
      nextImageIndex += 1;
      try {
        settled[index] = { status: "fulfilled", value: await requestSingleImage(index) };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  };
  const requestConcurrency = editRequested ? Math.min(3, count) : count;
  await Promise.all(Array.from({ length: requestConcurrency }, () => worker()));
  const responses = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  const failed = settled
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "rejected");
  if (!responses.length && failed.length) {
    const first = failed[0].item;
    if (first.status === "rejected") throw first.reason;
    throw new Error("New API 生图失败。");
  }
  return {
    ok: true,
    model,
    size,
    quality,
    count,
    images: responses.flatMap((response) => extractServerImages(response)),
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
    summary: failed.length ? `New API 已返回 ${responses.length} 个生图结果，${failed.length} 张失败。` : `New API 已返回 ${count} 个生图结果。`
  };
}

async function completeNewApiLogin(settings, payload = {}) {
  const previousEpoch = newApiAuthEpoch;
  const authEpoch = ++newApiAuthEpoch;
  if (settings?.serverUserId) void stopActiveNewApiCurlTransports({ authEpoch: previousEpoch, userId: String(settings.serverUserId) });
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
  const sessionCookie = extractSessionCookie(login.response);
  const loginUser = login.data?.data || {};
  const serverUserId = String(loginUser.id || "").trim();
  if (!serverUserId) throw new Error("New API 登录成功但没有返回 user id。");
  if (!sessionCookie) throw new Error("New API 登录成功但没有返回 session cookie。");

  let nextSettings = migrateSettings({
    ...settings,
    serverSessionCookie: sessionCookie,
    serverUserId
  });
  if (authEpoch !== newApiAuthEpoch) {
    const error = new Error("登录请求已被更新的账户操作替代。");
    error.code = "NEW_API_SESSION_CHANGED";
    throw error;
  }
  // Commit the new account identity before follow-up profile/model requests so
  // late responses from the previous account cannot rotate this session.
  writeJson(settingsPath, nextSettings);

  let userData = loginUser;
  try {
    const self = await newApiRequest(nextSettings, "/api/user/self", {
      headers: newApiUserAuthHeaders(nextSettings)
    });
    userData = { ...loginUser, ...(self?.data || {}) };
  } catch (error) {
    log(`new-api self after login failed ${error instanceof Error ? error.message : String(error)}`);
  }

  let crmSession = null;
  try {
    const response = await newApiRequest(nextSettings, "/api/crm/session/self", {
      headers: newApiUserAuthHeaders(nextSettings)
    });
    crmSession = response?.data || response || null;
    if (crmSession?.currentUser) {
      userData = { ...userData, ...crmSession.currentUser };
    }
  } catch (error) {
    log(`crm session after login failed ${error instanceof Error ? error.message : String(error)}`);
  }

  nextSettings = migrateSettings({
    ...nextSettings,
    serverToken: ""
  });
  let modelSettings;
  try {
    modelSettings = await newApiModelSettings(nextSettings);
  } catch (error) {
    log(`new-api models after login failed ${error instanceof Error ? error.message : String(error)}`);
    modelSettings = modelSettingsWithCacheMeta(splitModelSettings(nextSettings, []), "settings", Date.now());
  }
  nextSettings = migrateSettings({
    ...nextSettings,
    imageModel: nextSettings.imageModel || modelSettings.imageModel || preferredImageModelFromList(modelSettings.imageModels),
    imageModelPool: nextSettings.imageModelPool?.length
      ? nextSettings.imageModelPool
      : [nextSettings.imageModel || modelSettings.imageModel || preferredImageModelFromList(modelSettings.imageModels)],
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
    user: normalizeNewApiUser(userData),
    wallet: walletFromNewApiUser(userData),
    crm: crmSession,
    settings: {
      ...modelSettings,
      imageModel: nextSettings.imageModel
    },
    imageCostCents: modelSettings.imageCostCents
  };
}

function clearNewApiAuth(settings) {
  const stored = migrateSettings(readJson(settingsPath, defaultSettings));
  const expectedUserId = String(settings?.serverUserId || "");
  const expectedCookie = String(settings?.serverSessionCookie || "");
  if (
    (expectedUserId && String(stored.serverUserId || "") !== expectedUserId) ||
    (expectedCookie && String(stored.serverSessionCookie || "") !== expectedCookie)
  ) {
    return stored;
  }
  const clearingEpoch = newApiAuthEpoch;
  newApiAuthEpoch += 1;
  if (expectedUserId) void stopActiveNewApiCurlTransports({ authEpoch: clearingEpoch, userId: expectedUserId });
  const next = migrateSettings({
    ...stored,
    serverToken: "",
    serverSessionCookie: "",
    serverUserId: ""
  });
  writeJson(settingsPath, next);
  return next;
}





async function callNewApiImageWithSession(settings, payload = {}) {
  return await callNewApiImage(settings, payload);
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
  const source = Array.isArray(data?.images) ? data.images : Array.isArray(data?.data) ? data.data : [];
  for (const item of source) {
    if (item?.b64_json) {
      images.push({ type: "base64", value: String(item.b64_json), revisedPrompt: item.revised_prompt || item.revisedPrompt || "" });
    }
    if (item?.image_base64) {
      images.push({ type: "base64", value: String(item.image_base64), revisedPrompt: item.revised_prompt || item.revisedPrompt || "" });
    }
    if (item?.base64) {
      images.push({ type: "base64", value: String(item.base64), revisedPrompt: item.revised_prompt || item.revisedPrompt || "" });
    }
    if (item?.url) {
      images.push({ type: "url", value: String(item.url), revisedPrompt: item.revised_prompt || item.revisedPrompt || "" });
    }
    if (item?.image_url?.url) {
      images.push({ type: "url", value: String(item.image_url.url), revisedPrompt: item.revised_prompt || item.revisedPrompt || "" });
    }
    if (item?.type === "base64" && item.value) images.push({ type: "base64", value: String(item.value), revisedPrompt: item.revisedPrompt || "" });
    if (item?.type === "url" && item.value) images.push({ type: "url", value: String(item.value), revisedPrompt: item.revisedPrompt || "" });
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const b64 = part?.image_base64 ?? part?.b64_json;
      const url = part?.image_url ?? part?.url;
      if (b64) images.push({ type: "base64", value: String(b64), revisedPrompt: part?.revised_prompt || "" });
      if (url) images.push({ type: "url", value: String(url), revisedPrompt: part?.revised_prompt || "" });
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

function writeServerImageOutputs(images, stem, runId = "", projectId = "", outputFormat = "png") {
  const outputDir = outputDirForProjectId(projectId);
  mkdirSync(outputDir, { recursive: true });
  const ext = outputExtensionForFormat(outputFormat);
  return images.map((image, index) => {
    if (image.type === "url") {
      return { index: index + 1, type: "url", url: image.value, revisedPrompt: image.revisedPrompt || "", runId };
    }
    const clean = image.value.replace(/^data:image\/\w+;base64,/, "");
    const filePath = path.join(outputDir, `${stem}-${String(index + 1).padStart(2, "0")}.${ext}`);
    const buffer = Buffer.from(clean, "base64");
    writeFileSync(filePath, buffer);
    const decoded = nativeImage.createFromBuffer(buffer);
    const dimensions = decoded.isEmpty() ? { width: 0, height: 0 } : decoded.getSize();
    return {
      index: index + 1,
      type: "file",
      path: filePath,
      assetUrl: assetUrlFor(filePath),
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      revisedPrompt: image.revisedPrompt || "",
      runId,
      width: dimensions.width > 0 ? dimensions.width : undefined,
      height: dimensions.height > 0 ? dimensions.height : undefined
    };
  });
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
    if (projectId === "__global__") {
      return normalizeSessionRevision(readJson(sessionPath, defaultSession)?.sessionRevision) ?? 0;
    }
    return projectSessionRevisionFromDisk(getProjectById(projectId, readProjectList()));
  }
});

function registerIpc() {
  registerDesktopIpc({
    ipcMain,
    desktopUpdater,
    migrateSettings,
    readJson,
    settingsPath,
    defaultSettings,
    log,
    publicSettings,
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
    getAgentRuntime,
    listAgentModels,
    emitAgentProgress,
    aidebugMode,
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
    projectForFolderOpen,
    projectRoot,
    configDir,
    projectsDir,
    isPathInside,
    app,
    importLocalImagesToProject,
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
    ensureMatchingExportExtension,
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
    callNewApiImageWithSession,
    clearNewApiAuth,
    completeNewApiLogin,
    extractServerImages,
    getNewApiAuthEpoch: () => newApiAuthEpoch,
    isNewApiAuthError,
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

function createWindow() {
  logBoot("create window start");
  const windowIcon = createWindowIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: minWindowWidth,
    minHeight: minWindowHeight,
    backgroundColor: "#0e1513",
    show: false,
    title: applicationName,
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...(useCustomWindowFrame ? { frame: false } : { titleBarStyle: "hiddenInset" }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: process.env.IIIMAGE_PERFORMANCE_GATE !== "1"
    }
  });
  window.setMinimumSize(minWindowWidth, minWindowHeight);

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
  });
  window.webContents.on("console-message", (details) => {
    log(`console level=${details.level} ${details.sourceId}:${details.lineNumber} ${details.message}`);
  });

  if (devUrl) {
    window.loadURL(devUrl);
  } else {
    window.loadFile(rendererIndex);
  }
}

if (projectIoSelftestMode || agentProtocolSelftestMode) {
  module.exports = {
    activeNewApiCurlTransportCount,
    agentImageRootsForContext,
    buildProjectAssetIndex,
    boundedImageRead,
    clearNewApiAuth,
    createProjectSaveCoordinator,
    defaultSession,
    encodedImageDimensions,
    imageEditRequestLimiterStatus,
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
    projectForFolderOpen,
    projectSessionFromDisk,
    readProjectManifest,
    agentModelUsesResponsesApi,
    managedRelayEndpoint,
    migrateSettings,
    newApiFetch,
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

  app.whenReady().then(() => {
    logBoot("app ready");
    app.setAppUserModelId(applicationId);
    ensureRuntimeFiles();
    desktopUpdater.recoverRollback();
    if (lifecycleSelftestMode) {
      startLocalServerIfNeeded();
      setTimeout(() => app.quit(), 420);
      return;
    }
    cleanupAbandonedExportSourceCaches();
    registerAssetProtocol();
    registerIpc();
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
