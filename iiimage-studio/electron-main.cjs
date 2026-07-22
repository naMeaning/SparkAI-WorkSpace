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
const { createProjectSaveCoordinator, normalizeSessionRevision } = require("./desktop/project-save-coordinator.cjs");
const { createDesktopUpdaterService } = require("./desktop/updater-service.cjs");
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
const projectPackageMaximumFileBytes = 192 * 1024 * 1024;
const projectPackageMaximumAssetBytes = 32 * 1024 * 1024;
const projectPackageMaximumDecodedBytes = 128 * 1024 * 1024;
const projectPackageMaximumSessionBytes = 16 * 1024 * 1024;
const projectPackageMaximumAssets = 1_000;
const projectPackageMaximumNodes = 5_000;
const projectPackageMaximumMessages = 10_000;
const projectPackageMaximumConversations = 1_000;
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
let aidebugAuthenticated = true;
const bootStartedAt = Date.now();
const newApiQuotaPerUnit = 500000;
const newApiUserLogsEndpoint = "/api/log/self?p=1&page_size=20";
const modelCacheTtlMs = 60_000;
const modelCacheMemory = new Map();
const modelCacheInflight = new Map();
let modelCacheDiskLoaded = false;
let newApiMeInflight = null;
let newApiAuthEpoch = 0;
let thumbnailProjectRootsCache = null;
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

function defaultProjectList() {
  const defaultProjectId = "default";
  const defaultSessionPath = path.join(projectsDir, defaultProjectId, "session.json");
  return {
    activeProjectId: defaultProjectId,
    projects: [
      {
        id: defaultProjectId,
        name: "默认项目",
        path: path.dirname(defaultSessionPath),
        sessionPath: defaultSessionPath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        external: false
      }
    ]
  };
}

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

function safeName(value, fallback = "项目") {
  const name = String(value || "").trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").slice(0, 48);
  return name || fallback;
}

function projectId() {
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProjectList(raw) {
  const base = defaultProjectList();
  const source = raw && typeof raw === "object" ? raw : {};
  const projects = Array.isArray(source.projects) ? source.projects : base.projects;
  const normalized = projects
    .map((item) => {
      const id = String(item?.id || projectId());
      const projectPath = String(item?.path || path.join(projectsDir, id));
      return {
        id,
        name: id === "default" && String(item?.name || "").trim() === "默认画布" ? "默认项目" : safeName(item?.name, id),
        path: projectPath,
        sessionPath: String(item?.sessionPath || path.join(projectPath, "session.json")),
        createdAt: item?.createdAt || new Date().toISOString(),
        updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
        external: Boolean(item?.external)
      };
    })
    .filter((item) => item.id && item.sessionPath);

  if (!normalized.some((item) => item.id === "default")) {
    normalized.unshift(base.projects[0]);
  }

  const activeProjectId = normalized.some((item) => item.id === source.activeProjectId)
    ? source.activeProjectId
    : normalized[0].id;

  return { activeProjectId, projects: normalized };
}

function readProjectList() {
  return normalizeProjectList(readJson(projectListPath, defaultProjectList()));
}

function writeProjectList(list) {
  const next = normalizeProjectList(list);
  writeJson(projectListPath, next);
  updateThumbnailProjectRootsCache(next);
  return next;
}

function updateThumbnailProjectRootsCache(list) {
  thumbnailProjectRootsCache = (Array.isArray(list?.projects) ? list.projects : [])
    .filter((item) => item?.path)
    .map((item) => ({
      projectPath: path.resolve(item.path),
      cacheRoot: path.join(path.resolve(item.path), projectMetaDirName, "thumbnails")
    }));
}

function thumbnailProjectRoots() {
  if (!thumbnailProjectRootsCache) updateThumbnailProjectRootsCache(readProjectList());
  return thumbnailProjectRootsCache || [];
}

function getActiveProject(list = readProjectList()) {
  return list.projects.find((item) => item.id === list.activeProjectId) || list.projects[0];
}

function getProjectById(projectId, list = readProjectList()) {
  const id = String(projectId || "");
  if (!id) return getActiveProject(list);
  return list.projects.find((item) => item.id === id) || null;
}

function currentSessionPath() {
  return getActiveProject(readProjectList())?.sessionPath || sessionPath;
}

function createProjectRecord(name, externalPath = "") {
  const id = projectId();
  const now = new Date().toISOString();
  const projectPath = externalPath ? path.resolve(externalPath) : path.join(projectsDir, id);
  return {
    id,
    name: safeName(name, "未命名画布"),
    path: projectPath,
    sessionPath: path.join(projectPath, "session.json"),
    createdAt: now,
    updatedAt: now,
    external: Boolean(externalPath)
  };
}

function nextExternalProjectFolderPath(parentPath, name, list = readProjectList()) {
  const parent = path.resolve(parentPath);
  const baseName = safeName(name, "iiimage 项目");
  const occupied = new Set((Array.isArray(list?.projects) ? list.projects : [])
    .filter((item) => item?.path)
    .map((item) => comparablePath(item.path)));
  for (let index = 1; index <= 9999; index += 1) {
    const folderName = index === 1 ? baseName : `${baseName} (${index})`;
    const candidate = path.join(parent, folderName);
    if (!existsSync(candidate) && !occupied.has(comparablePath(candidate))) return candidate;
  }
  throw new Error("所选目录下同名项目过多，请更换项目名称或保存位置。");
}

function projectForFolderOpen(list, projectId = "") {
  const requestedId = String(projectId || "").trim();
  return requestedId ? getProjectById(requestedId, list) : getActiveProject(list);
}

function projectManifestPath(projectOrPath) {
  const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
  return path.join(path.resolve(projectPath || projectRoot), projectMetaDirName, projectManifestFileName);
}

function projectExportSessionPath(projectOrPath) {
  const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
  return path.join(path.resolve(projectPath || projectRoot), exportSessionFileName);
}

function readProjectManifest(projectOrPath) {
  const manifestPath = projectManifestPath(projectOrPath);
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    log(`project manifest read failed ${manifestPath}: ${error.message}`);
    return null;
  }
}

function projectRelativePath(projectPath, filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  const resolvedProject = path.resolve(projectPath || projectRoot);
  const resolvedFile = path.resolve(filePath);
  if (!isPathInside(resolvedFile, resolvedProject)) return "";
  return path.relative(resolvedProject, resolvedFile).split(path.sep).join("/");
}

function safeImageSourceRelativePath(value, maximum = 1000) {
  const source = typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
  if (!source || source.startsWith("/") || /^[a-z]:/i.test(source) || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (source.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return source.slice(0, maximum);
}

function resolveProjectRelativePath(projectPath, relativePath) {
  if (!relativePath || typeof relativePath !== "string") return "";
  const resolvedProject = path.resolve(projectPath || projectRoot);
  const resolved = path.resolve(resolvedProject, relativePath);
  if (!isPathInside(resolved, resolvedProject)) return "";
  return resolved;
}

function collectAssetFiles(rootDir, maxFiles = 5000) {
  const files = [];
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  function walk(dir) {
    if (files.length >= maxFiles || !existsSync(dir)) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(fullPath);
      } else if (entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  walk(rootDir);
  return files;
}

function projectAssetRoots(projectPath) {
  const resolvedProject = path.resolve(projectPath || projectRoot);
  return [
    path.join(resolvedProject, "output", "imagegen"),
    path.join(resolvedProject, "assets"),
    path.join(resolvedProject, projectMetaDirName, "assets")
  ];
}

function controlledProjectAssetFile(filePath, projectPath) {
  if (!filePath || !existsSync(filePath)) return "";
  try {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return "";
    const realProject = realPathIfPresent(projectPath);
    const realFile = realpathSync(filePath);
    const controlled = projectAssetRoots(projectPath).some((root) => {
      const realRoot = realPathIfPresent(root);
      return isComparablePathInside(realRoot, realProject) && isComparablePathInside(realFile, realRoot);
    });
    return controlled ? realFile : "";
  } catch {
    return "";
  }
}

function controlledRecordedAssetUrl(asset = {}) {
  for (const value of [asset.url, asset.assetUrl]) {
    const source = typeof value === "string" ? value.trim() : "";
    if (/^https?:\/\//i.test(source) || /^data:image\/(?:png|jpe?g|webp);base64,/i.test(source)) return source;
  }
  return "";
}

function buildProjectAssetIndex(projectPath) {
  const roots = projectAssetRoots(projectPath);
  const files = roots.flatMap((root) => collectAssetFiles(root));
  const byName = new Map();
  const byRunId = new Map();
  for (const filePath of files) {
    const basename = path.basename(filePath).toLowerCase();
    if (!byName.has(basename)) byName.set(basename, []);
    byName.get(basename).push(filePath);
    const runMatch = basename.match(/(gen-[a-z0-9_-]+|cutout-[a-z0-9_-]+|agent-[a-z0-9_-]+|basic-[a-z0-9_-]+)/i);
    if (runMatch) {
      const runKey = runMatch[1].toLowerCase();
      if (!byRunId.has(runKey)) byRunId.set(runKey, []);
      byRunId.get(runKey).push(filePath);
    }
  }
  return { files, byName, byRunId };
}

function hydrateAssetForProject(asset, project, assetIndex) {
  if (!asset || typeof asset !== "object") return null;
  const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
  const next = { ...asset };
  const expectedHash = sessionAssetContentHash(next);
  const candidates = [];
  if (typeof next.relativePath === "string") candidates.push({ path: resolveProjectRelativePath(projectPath, next.relativePath), source: "relative" });
  if (typeof next.path === "string") candidates.push({ path: path.resolve(next.path), source: "recorded" });
  if (typeof next.fileName === "string") {
    const named = assetIndex?.byName?.get(String(next.fileName).toLowerCase());
    if (named?.length && (expectedHash || named.length === 1)) candidates.push(...named.map((filePath) => ({ path: filePath, source: "name" })));
  }
  if (next.runId) {
    const byRun = assetIndex?.byRunId?.get(String(next.runId).toLowerCase());
    if (byRun?.length) {
      const ordered = expectedHash ? byRun : [byRun[Math.max(0, Number(next.index || 1) - 1)] || byRun[0]];
      candidates.push(...ordered.map((filePath) => ({ path: filePath, source: "run" })));
    }
    const looseRun = assetIndex?.files?.filter((filePath) => path.basename(filePath).toLowerCase().includes(String(next.runId).toLowerCase()));
    if (looseRun?.length) {
      const ordered = expectedHash ? looseRun : [looseRun[Math.max(0, Number(next.index || 1) - 1)] || looseRun[0]];
      candidates.push(...ordered.map((filePath) => ({ path: filePath, source: "run" })));
    }
  }

  const recordedControlledPath = typeof next.path === "string" ? controlledProjectAssetFile(next.path, projectPath) : "";
  const seenCandidates = new Set();
  const found = candidates.map((candidate) => {
    const controlled = controlledProjectAssetFile(candidate.path, projectPath);
    if (!controlled) return "";
    const key = comparablePath(controlled);
    if (seenCandidates.has(key)) return "";
    seenCandidates.add(key);
    const needsHashVerification = Boolean(
      expectedHash && (
        candidate.source === "name" || candidate.source === "run" ||
        !recordedControlledPath || comparablePath(recordedControlledPath) !== key
      )
    );
    if (needsHashVerification) {
      try {
        const actualHash = createHash("sha256").update(boundedImageRead(controlled, maxExportImageBytes, path.basename(controlled), "项目图片")).digest("hex");
        if (actualHash !== expectedHash) return "";
      } catch {
        return "";
      }
    }
    return controlled;
  }).find(Boolean);
  if (found) {
    next.type = "file";
    next.path = found;
    next.relativePath = projectRelativePath(projectPath, found);
    next.fileName = path.basename(found);
    next.assetUrl = assetUrlFor(found);
    return next;
  }
  const recordedUrl = controlledRecordedAssetUrl(next);
  if (recordedUrl) {
    next.type = "url";
    if (/^https?:\/\//i.test(recordedUrl)) next.url = recordedUrl;
    else next.assetUrl = recordedUrl;
    return next;
  }
  return null;
}

function recoverNodeAssets(node, project, assetIndex) {
  const assets = Array.isArray(node.assets)
    ? node.assets.map((asset) => hydrateAssetForProject(asset, project, assetIndex)).filter(Boolean)
    : [];
  if (assets.length > 0 || node.type !== "image") return assets;
  const runId = typeof node.generationRunId === "string" ? node.generationRunId.toLowerCase() : "";
  const byRun = runId ? assetIndex.byRunId.get(runId) : null;
  const looseRun = runId ? assetIndex.files.filter((filePath) => path.basename(filePath).toLowerCase().includes(runId)) : [];
  const files = byRun?.length
    ? byRun
    : looseRun.length
      ? looseRun
      : assetIndex.files.filter((filePath) => path.basename(filePath).toLowerCase().includes(String(node.id || "").toLowerCase()));
  return files.slice(0, Math.max(1, Number(node.outputs || 1))).map((filePath, index) => ({
    index: index + 1,
    type: "file",
    path: filePath,
    relativePath: projectRelativePath(project.path, filePath),
    fileName: path.basename(filePath),
    assetUrl: assetUrlFor(filePath),
    runId: node.generationRunId || ""
  }));
}

function mapMessageAssetReferences(messages, mapper) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== "object" || !message.attachments) return message;
    return {
      ...message,
      attachments: {
        ...message.attachments,
        sourceAssets: (Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets : []).map(mapper).filter(Boolean),
        referenceAssets: (Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets : []).map(mapper).filter(Boolean)
      }
    };
  });
}

function mapNestedNodeAssetReferences(node, mapper) {
  return {
    ...node,
    imageParams: node.imageParams ? {
      ...node.imageParams,
      referenceImages: (Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages : []).map(mapper).filter(Boolean)
    } : node.imageParams,
    layerGroup: node.layerGroup ? {
      ...node.layerGroup,
      previewAsset: node.layerGroup.previewAsset ? mapper(node.layerGroup.previewAsset) || undefined : undefined,
      mergedAsset: node.layerGroup.mergedAsset ? mapper(node.layerGroup.mergedAsset) || undefined : undefined
    } : node.layerGroup,
    layerComposition: node.layerComposition ? {
      ...node.layerComposition,
      previewAsset: node.layerComposition.previewAsset ? mapper(node.layerComposition.previewAsset) || undefined : undefined,
      mergedAsset: node.layerComposition.mergedAsset ? mapper(node.layerComposition.mergedAsset) || undefined : undefined,
      layers: (Array.isArray(node.layerComposition.layers) ? node.layerComposition.layers : []).map((layer) => ({
        ...layer,
        asset: layer?.asset ? mapper(layer.asset) || undefined : undefined
      }))
    } : node.layerComposition
  };
}

function nestedSessionAssetReferences(session) {
  const references = [];
  for (const node of Array.isArray(session?.nodes) ? session.nodes : []) {
    references.push(...(Array.isArray(node?.imageParams?.referenceImages) ? node.imageParams.referenceImages : []));
    if (node?.layerGroup?.previewAsset) references.push(node.layerGroup.previewAsset);
    if (node?.layerGroup?.mergedAsset) references.push(node.layerGroup.mergedAsset);
    if (node?.layerComposition?.previewAsset) references.push(node.layerComposition.previewAsset);
    if (node?.layerComposition?.mergedAsset) references.push(node.layerComposition.mergedAsset);
    for (const layer of Array.isArray(node?.layerComposition?.layers) ? node.layerComposition.layers : []) {
      if (layer?.asset) references.push(layer.asset);
    }
  }
  const messages = [
    ...(Array.isArray(session?.messages) ? session.messages : []),
    ...(Array.isArray(session?.conversations) ? session.conversations.flatMap((conversation) => Array.isArray(conversation?.messages) ? conversation.messages : []) : [])
  ];
  for (const message of messages) {
    references.push(...(Array.isArray(message?.attachments?.sourceAssets) ? message.attachments.sourceAssets : []));
    references.push(...(Array.isArray(message?.attachments?.referenceAssets) ? message.attachments.referenceAssets : []));
  }
  return references.filter((reference) => reference && typeof reference === "object");
}

function sessionWithProjectAssets(session, project, options = {}) {
  const source = sanitizeSession(session);
  const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
  const normalizedProject = { ...project, path: projectPath };
  const validatedNodes = source.nodes.map((node) => {
    const recordedAssets = Array.isArray(node.assets) ? node.assets : [];
    const assets = recordedAssets.map((asset) => hydrateAssetForProject(asset, normalizedProject, null));
    const missingRecordedAssets = assets.some((asset) => !asset);
    const missingExpectedAssets = node.type === "image" && recordedAssets.length === 0 && (
      Number(node.outputs || 0) > 0 || node.imageState === "done" || node.status === "done"
    );
    return { node, recordedAssets, assets, needsRecovery: missingRecordedAssets || missingExpectedAssets };
  });
  const nestedReferences = nestedSessionAssetReferences(source);
  const nestedMissingCount = nestedReferences.filter((reference) => !hydrateAssetForProject(reference, normalizedProject, null)).length;
  const needsRecovery = validatedNodes.some((item) => item.needsRecovery) || nestedMissingCount > 0;
  const assetIndex = needsRecovery
    ? (typeof options.buildAssetIndex === "function" ? options.buildAssetIndex(projectPath) : buildProjectAssetIndex(projectPath))
    : null;
  options.onAssetIndex?.({ projectPath, scanned: Boolean(assetIndex), missingNodeCount: validatedNodes.filter((item) => item.needsRecovery).length + nestedMissingCount });
  const hydrateReference = (reference) => hydrateAssetForProject(reference, normalizedProject, assetIndex);
  const nodes = validatedNodes.map(({ node, recordedAssets, assets: validatedAssets, needsRecovery: nodeNeedsRecovery }) => {
    let assets = validatedAssets.filter(Boolean);
    if (nodeNeedsRecovery && assetIndex) {
      if (recordedAssets.length > 0) {
        assets = recordedAssets
          .map((asset, index) => validatedAssets[index] || hydrateAssetForProject(asset, normalizedProject, assetIndex))
          .filter(Boolean);
      } else {
        assets = recoverNodeAssets({ ...node, assets: [] }, normalizedProject, assetIndex);
      }
    }
    if (node.type !== "image") return mapNestedNodeAssetReferences({ ...node, assets }, hydrateReference);
    const done = assets.length > 0;
    return mapNestedNodeAssetReferences({
      ...node,
      assets,
      imageState: done ? "done" : node.imageState,
      status: done ? "done" : node.status,
      outputs: Math.max(Number(node.outputs || 0), assets.length)
    }, hydrateReference);
  });
  const messages = mapMessageAssetReferences(source.messages, hydrateReference);
  const conversations = Array.isArray(source.conversations)
    ? source.conversations.map((conversation) => ({
        ...conversation,
        messages: mapMessageAssetReferences(conversation.messages, hydrateReference)
      }))
    : [];
  return sanitizeSession({ ...source, nodes, messages, conversations });
}

function assetForProjectSave(asset, projectPath) {
  if (!asset || typeof asset !== "object") return asset;
  const next = { ...asset };
  const controlledCurrent = typeof next.path === "string" ? controlledProjectAssetFile(next.path, projectPath) : "";
  const safeRelativeTarget = typeof next.relativePath === "string" ? resolveProjectRelativePath(projectPath, next.relativePath) : "";
  const controlledRelative = safeRelativeTarget ? controlledProjectAssetFile(safeRelativeTarget, projectPath) : "";
  const resolved = controlledCurrent || controlledRelative;
  if (resolved) {
    next.path = resolved;
    next.relativePath = projectRelativePath(projectPath, resolved);
    next.fileName = path.basename(resolved);
    next.assetUrl = assetUrlFor(resolved);
  } else {
    if (typeof next.path === "string" && next.path.trim()) next.path = path.resolve(next.path);
    if (safeRelativeTarget) next.relativePath = projectRelativePath(projectPath, safeRelativeTarget);
    else delete next.relativePath;
    if (typeof next.assetUrl === "string" && next.assetUrl.startsWith("iiimage-asset:")) delete next.assetUrl;
  }
  return next;
}

function sessionForProjectSave(session, project) {
  const source = sanitizeSession(session);
  const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
  const normalizeAsset = (asset) => assetForProjectSave(asset, projectPath);
  return {
    ...source,
    nodes: source.nodes.map((node) => mapNestedNodeAssetReferences({
      ...node,
      assets: Array.isArray(node.assets) ? node.assets.map(normalizeAsset).filter(Boolean) : []
    }, normalizeAsset)),
    messages: mapMessageAssetReferences(source.messages, normalizeAsset),
    conversations: Array.isArray(source.conversations)
      ? source.conversations.map((conversation) => ({
          ...conversation,
          messages: mapMessageAssetReferences(conversation.messages, normalizeAsset)
        }))
      : []
  };
}

function writeProjectManifest(project, session) {
  if (!project?.path) return;
  const projectPath = path.resolve(project.path);
  const normalizedSession = sessionForProjectSave(session, project);
  const assets = [];
  for (const node of normalizedSession.nodes) {
    for (const asset of node.assets || []) {
      assets.push({
        nodeId: node.id,
        assetId: asset.assetId || "",
        displayCode: asset.displayCode || "",
        contentHash: asset.contentHash || "",
        index: asset.index,
        type: asset.type,
        path: asset.relativePath || projectRelativePath(projectPath, asset.path),
        fileName: asset.fileName || (asset.path ? path.basename(asset.path) : ""),
        runId: asset.runId || "",
        revisedPrompt: asset.revisedPrompt || ""
      });
    }
  }
  const manifest = {
    format: "iiimage-project",
    version: 2,
    updatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    },
    sessionRevision: Math.max(0, Math.floor(Number(normalizedSession.sessionRevision || 0))),
    assets
  };
  writeJson(projectManifestPath(projectPath), manifest);
}

function projectSessionFromDisk(project) {
  const hasSessionFile = existsSync(project.sessionPath);
  const rawSession = hasSessionFile ? readJson(project.sessionPath, defaultSession) : defaultSession;
  const manifest = readProjectManifest(project);
  const legacyManifestSession = Number(manifest?.version || 1) < 2 && manifest?.session && typeof manifest.session === "object"
    ? manifest.session
    : null;
  const shouldMigrateLegacySession = Boolean(
    legacyManifestSession &&
    !sessionHasContent(rawSession) &&
    sessionHasContent(legacyManifestSession)
  );
  const sourceSession = shouldMigrateLegacySession ? legacyManifestSession : rawSession;
  const sourceRevision = shouldMigrateLegacySession
    ? sourceSession?.sessionRevision ?? manifest?.sessionRevision
    : hasSessionFile
      ? sourceSession?.sessionRevision ?? manifest?.sessionRevision
      : manifest?.sessionRevision;
  const sessionRevision = Math.max(
    0,
    Math.floor(Number(sourceRevision ?? 0) || 0)
  );
  // Hydrate against the current project root before normalizing paths for
  // persistence. Normalizing a moved project's stale absolute paths first
  // would erase its still-valid project-relative identities.
  const hydratedSession = sessionWithProjectAssets({ ...sourceSession, sessionRevision }, project);
  const normalizedSession = sessionForProjectSave(hydratedSession, project);
  if (shouldMigrateLegacySession || !hasSessionFile) {
    writeJson(project.sessionPath, normalizedSession);
    writeProjectManifest(project, normalizedSession);
  }
  return hydratedSession;
}

function projectSessionRevisionFromDisk(project) {
  if (!project) return 0;
  const hasSessionFile = existsSync(project.sessionPath);
  const rawSession = hasSessionFile ? readJson(project.sessionPath, defaultSession) : null;
  const sessionRevision = normalizeSessionRevision(rawSession?.sessionRevision);
  if (hasSessionFile && sessionRevision !== null) return sessionRevision;
  return normalizeSessionRevision(readProjectManifest(project)?.sessionRevision) ?? 0;
}

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

function projectPackageFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateProjectPackageSessionShape(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布项目包缺少有效会话数据。");
  }
  const nodes = Array.isArray(session.nodes) ? session.nodes : [];
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const conversations = Array.isArray(session.conversations) ? session.conversations : [];
  if (nodes.length > projectPackageMaximumNodes) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `画布节点超过 ${projectPackageMaximumNodes} 个，无法安全导入或导出。`);
  }
  if (messages.length > projectPackageMaximumMessages || conversations.length > projectPackageMaximumConversations) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "画布会话或消息数量过多，无法安全导入或导出。");
  }
  let conversationMessages = 0;
  for (const conversation of conversations) {
    conversationMessages += Array.isArray(conversation?.messages) ? conversation.messages.length : 0;
    if (conversationMessages > projectPackageMaximumMessages) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "画布历史消息数量过多，无法安全导入或导出。");
    }
  }
  let serialized;
  try {
    serialized = JSON.stringify(session);
  } catch {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布会话无法序列化。");
  }
  if (Buffer.byteLength(serialized, "utf8") > projectPackageMaximumSessionBytes) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "画布会话数据超过 16MB，无法安全导入或导出。");
  }
}

function estimatedBase64DecodedBytes(value) {
  const data = String(value || "");
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return -1;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function validateProjectPackageData(packageData) {
  if (!packageData || typeof packageData !== "object" || Array.isArray(packageData)) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布文件格式无效。");
  }
  if (packageData.format !== "iiimage-project-package" || ![1, 2].includes(Number(packageData.version))) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_UNSUPPORTED", "这不是受支持的 iiimage 画布项目包。");
  }
  validateProjectPackageSessionShape(packageData.session);
  const assets = Array.isArray(packageData.assets) ? packageData.assets : [];
  if (assets.length > projectPackageMaximumAssets) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `项目包图片超过 ${projectPackageMaximumAssets} 张，无法安全导入。`);
  }
  let decodedBytes = 0;
  for (const asset of assets) {
    if (!asset || typeof asset !== "object" || typeof asset.data !== "string") {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "项目包包含缺失图片数据的资产。");
    }
    const estimatedBytes = estimatedBase64DecodedBytes(asset.data);
    if (estimatedBytes <= 0 || estimatedBytes > projectPackageMaximumAssetBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_ASSET_TOO_LARGE", "项目包中的单张图片无效或超过 32MB。");
    }
    decodedBytes += estimatedBytes;
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > projectPackageMaximumDecodedBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "项目包图片总量超过 128MB，无法安全导入。");
    }
  }
  return { assets, decodedBytes };
}

function validateProjectPackageImageBuffer(buffer, label) {
  const format = detectImageFormat(buffer);
  const dimensions = encodedImageDimensions(buffer);
  if (!format || !dimensions) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”不是真实的 PNG、JPEG 或 WebP。`);
  }
  assertSafeEncodedImageDimensions(buffer, label);
  const decoded = nativeImage.createFromBuffer(buffer);
  if (decoded.isEmpty()) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”已经损坏或无法解码。`);
  }
  const decodedSize = decoded.getSize();
  if (decodedSize.width !== dimensions.width || decodedSize.height !== dimensions.height) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”的尺寸信息不一致。`);
  }
  return { ...format, width: dimensions.width, height: dimensions.height };
}

function writeProjectPackageFile(filePath, packageData) {
  const serialized = `${JSON.stringify(packageData)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > projectPackageMaximumFileBytes) {
    throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "导出的项目包超过 192MB，请减少画布图片后重试。");
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, serialized, { encoding: "utf8", flag: "wx" });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function packageProject(project) {
  const session = projectSessionFromDisk(project);
  const projectPath = path.resolve(project.path);
  const assets = [];
  let packagedDecodedBytes = 0;
  const readPackageAsset = (filePath) => {
    if (assets.length >= projectPackageMaximumAssets) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `画布图片超过 ${projectPackageMaximumAssets} 张，无法安全导出。`);
    }
    const label = path.basename(filePath);
    const buffer = boundedImageRead(filePath, projectPackageMaximumAssetBytes, label, "项目图片");
    const format = validateProjectPackageImageBuffer(buffer, label);
    packagedDecodedBytes += buffer.length;
    if (packagedDecodedBytes > projectPackageMaximumDecodedBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "画布图片总量超过 128MB，请减少图片后再导出。");
    }
    return { buffer, ...format };
  };
  for (const node of session.nodes) {
    for (const asset of node.assets || []) {
      if (asset.type !== "file" || !asset.path || !existsSync(asset.path)) continue;
      const controlledPath = controlledProjectAssetFile(asset.path, projectPath);
      if (!controlledPath || !/^image\/(png|jpeg|webp)$/i.test(mimeTypeForPath(controlledPath))) continue;
      const packagedImage = readPackageAsset(controlledPath);
      const { buffer, mimeType } = packagedImage;
      assets.push({
        nodeId: node.id,
        assetId: asset.assetId || "",
        displayCode: asset.displayCode || "",
        contentHash: createHash("sha256").update(buffer).digest("hex"),
        index: asset.index,
        type: "file",
        path: asset.relativePath || projectRelativePath(projectPath, controlledPath) || path.join("output", "imagegen", path.basename(controlledPath)).split(path.sep).join("/"),
        fileName: path.basename(controlledPath),
        mimeType,
        runId: asset.runId || "",
        revisedPrompt: asset.revisedPrompt || "",
        data: buffer.toString("base64")
      });
    }
  }
  const packagedAttachmentKeys = new Set(assets.map((asset) => asset.assetId || `${asset.nodeId}:${asset.index}:${asset.runId}`));
  const conversationMessages = [
    ...(Array.isArray(session.messages) ? session.messages : []),
    ...(Array.isArray(session.conversations) ? session.conversations.flatMap((conversation) => Array.isArray(conversation?.messages) ? conversation.messages : []) : [])
  ];
  for (const message of conversationMessages) {
    const attachmentItems = [
      ...(Array.isArray(message?.attachments?.sourceAssets) ? message.attachments.sourceAssets : []),
      ...(Array.isArray(message?.attachments?.referenceAssets) ? message.attachments.referenceAssets : [])
    ];
    for (const attachment of attachmentItems) {
      const attachmentPath = controlledProjectAssetFile(attachment?.path, projectPath);
      if (!attachmentPath) continue;
      if (!/^image\/(png|jpeg|webp)$/i.test(mimeTypeForPath(attachmentPath))) continue;
      const packageKey = String(attachment.assetId || "").trim() || `path:${comparablePath(attachmentPath)}`;
      if (packagedAttachmentKeys.has(packageKey)) continue;
      packagedAttachmentKeys.add(packageKey);
      const packagedImage = readPackageAsset(attachmentPath);
      const { buffer, mimeType } = packagedImage;
      assets.push({
        nodeId: attachment.nodeId || "",
        attachment: true,
        assetId: attachment.assetId || "",
        displayCode: attachment.displayCode || "",
        contentHash: createHash("sha256").update(buffer).digest("hex"),
        index: 1,
        type: "file",
        path: projectRelativePath(projectPath, attachmentPath) || path.join("assets", path.basename(attachmentPath)).split(path.sep).join("/"),
        fileName: path.basename(attachmentPath),
        mimeType,
        runId: "",
        revisedPrompt: "",
        data: buffer.toString("base64")
      });
    }
  }
  const packagedByPath = new Map();
  for (const packaged of assets) {
    const absolutePath = resolveProjectRelativePath(projectPath, packaged.path);
    if (absolutePath) packagedByPath.set(comparablePath(absolutePath), packaged);
  }
  const portableFileReference = (reference, nodeId = "", slot = "asset", index = 1) => {
    if (!reference || typeof reference !== "object") return reference;
    const controlledPath = controlledProjectAssetFile(reference.path, projectPath);
    if (!controlledPath) {
      return reference.type === "file" || reference.path
        ? { ...reference, path: undefined, assetUrl: undefined }
        : { ...reference };
    }
    const mimeType = mimeTypeForPath(controlledPath);
    if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) return { ...reference, path: undefined, assetUrl: undefined };
    const pathKey = comparablePath(controlledPath);
    let packaged = packagedByPath.get(pathKey);
    if (!packaged) {
      const relativePath = projectRelativePath(projectPath, controlledPath) || path.join("assets", path.basename(controlledPath)).split(path.sep).join("/");
      const packagedImage = readPackageAsset(controlledPath);
      const { buffer, mimeType: actualMimeType } = packagedImage;
      packaged = {
        nodeId,
        nested: true,
        assetId: reference.assetId || "",
        displayCode: reference.displayCode || "",
        contentHash: createHash("sha256").update(buffer).digest("hex"),
        index,
        type: "file",
        path: relativePath,
        fileName: path.basename(controlledPath),
        mimeType: actualMimeType,
        runId: reference.runId || "",
        revisedPrompt: reference.revisedPrompt || "",
        data: buffer.toString("base64")
      };
      assets.push(packaged);
      packagedByPath.set(pathKey, packaged);
    }
    const packageAssetKey = packaged.packageAssetKey || reference.assetId || `pkg-${createHash("sha256").update(`${nodeId}|${slot}|${packaged.path}`).digest("hex").slice(0, 24)}`;
    packaged.packageAssetKey = packageAssetKey;
    return {
      ...reference,
      packageAssetKey,
      path: undefined,
      assetUrl: undefined,
      relativePath: reference.relativePath || projectRelativePath(projectPath, controlledPath),
      fileName: reference.fileName || path.basename(controlledPath)
    };
  };
  const portableAttachment = (attachment, index, role) => portableFileReference(attachment, attachment?.nodeId || "", `message-${role}-${index}`, index + 1);
  const portableMessage = (message) => {
    if (!message || typeof message !== "object" || !message.attachments) return message;
    return {
      ...message,
      attachments: {
        ...message.attachments,
        sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map((item, index) => portableAttachment(item, index, "source")) : [],
        referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map((item, index) => portableAttachment(item, index, "reference")) : []
      }
    };
  };
  const portableSession = {
    ...session,
    // A pending AskUser continuation depends on local protocol history and
    // project identity. Exporting it would leak local paths and cannot resume
    // safely after import, so portable projects always start without it.
    pendingAgentExecution: null,
    nodes: session.nodes.map((node) => ({
      ...node,
      assets: (node.assets || []).map((asset, index) => portableFileReference(asset, node.id, `assets-${index}`, index + 1)),
      imageParams: node.imageParams ? {
        ...node.imageParams,
        referenceImages: Array.isArray(node.imageParams.referenceImages)
          ? node.imageParams.referenceImages.map((reference, index) => portableFileReference(reference, node.id, `image-params-reference-${index}`, index + 1))
          : []
      } : node.imageParams,
      layerGroup: node.layerGroup ? {
        ...node.layerGroup,
        previewAsset: portableFileReference(node.layerGroup.previewAsset, node.id, "layer-group-preview", 1),
        mergedAsset: portableFileReference(node.layerGroup.mergedAsset, node.id, "layer-group-merged", 1)
      } : node.layerGroup,
      layerComposition: node.layerComposition ? {
        ...node.layerComposition,
        previewAsset: portableFileReference(node.layerComposition.previewAsset, node.id, "layer-composition-preview", 1),
        mergedAsset: portableFileReference(node.layerComposition.mergedAsset, node.id, "layer-composition-merged", 1),
        layers: Array.isArray(node.layerComposition.layers)
          ? node.layerComposition.layers.map((layer, index) => ({ ...layer, asset: portableFileReference(layer.asset, node.id, `layer-${layer.id || index}`, index + 1) }))
          : []
      } : node.layerComposition
    })),
    messages: Array.isArray(session.messages) ? session.messages.map(portableMessage) : [],
    conversations: Array.isArray(session.conversations)
      ? session.conversations.map((conversation) => ({ ...conversation, messages: Array.isArray(conversation.messages) ? conversation.messages.map(portableMessage) : [] }))
      : []
  };
  validateProjectPackageSessionShape(portableSession);
  return {
    format: "iiimage-project-package",
    version: 2,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    },
    session: portableSession,
    assets
  };
}

function sessionFromPackage(packageData, targetProject) {
  const packageValidation = validateProjectPackageData(packageData);
  const projectPath = path.resolve(targetProject.path);
  const assetMap = new Map();
  const assetById = new Map();
  const assetByPackageKey = new Map();
  const assetByRelativePath = new Map();
  const ambiguousAssetIds = new Set();
  const ambiguousAssetMapKeys = new Set();
  const ambiguousPackageKeys = new Set();
  const ambiguousRelativePaths = new Set();
  const restoredByTargetPath = new Map();
  const existingTargetEntry = (filePath) => {
    const key = comparablePath(filePath);
    const known = restoredByTargetPath.get(key);
    if (known) return known;
    if (!existsSync(filePath)) return null;
    try {
      const stats = lstatSync(filePath);
      const contentHash = stats.isFile() && !stats.isSymbolicLink()
        ? createHash("sha256").update(boundedImageRead(filePath, projectPackageMaximumAssetBytes, path.basename(filePath), "已有项目图片")).digest("hex")
        : `occupied:${stats.isDirectory() ? "directory" : "non-file"}`;
      const entry = { path: filePath, contentHash };
      restoredByTargetPath.set(key, entry);
      return entry;
    } catch {
      const entry = { path: filePath, contentHash: "occupied:unreadable" };
      restoredByTargetPath.set(key, entry);
      return entry;
    }
  };
  const packageRelativeLookupKey = (value) => String(value || "").trim().replace(/\\/g, "/").toLowerCase();
  const setUniqueAssetLookup = (lookup, ambiguous, key, value) => {
    const cleanKey = String(key || "").trim();
    if (!cleanKey || ambiguous.has(cleanKey)) return;
    const existing = lookup.get(cleanKey);
    if (existing && existing.contentHash !== value.contentHash) {
      lookup.delete(cleanKey);
      ambiguous.add(cleanKey);
      return;
    }
    lookup.set(cleanKey, value);
  };
  const packageAssets = packageValidation.assets;
  let decodedBytes = 0;
  for (const asset of packageAssets) {
    if (!asset || typeof asset !== "object" || !asset.data) continue;
    const relative = String(asset.path || path.join("output", "imagegen", asset.fileName || `asset-${Date.now()}.png`)).replace(/\\/g, "/");
    const buffer = Buffer.from(String(asset.data), "base64");
    if (buffer.toString("base64") !== asset.data || buffer.length > projectPackageMaximumAssetBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${asset.fileName || relative}”的编码无效。`);
    }
    decodedBytes += buffer.length;
    if (decodedBytes > projectPackageMaximumDecodedBytes) {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_TOO_LARGE", "项目包图片总量超过 128MB，无法安全导入。");
    }
    const imageFormat = validateProjectPackageImageBuffer(buffer, asset.fileName || path.basename(relative));
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const declaredTarget = resolveProjectRelativePath(projectPath, relative);
    const allowedTarget = declaredTarget && projectAssetRoots(projectPath).some((root) => (
      comparablePath(declaredTarget) !== comparablePath(root) && isComparablePathInside(declaredTarget, root)
    ));
    let targetPath = allowedTarget
      ? declaredTarget
      : path.join(projectPath, "assets", "package-imports", safeName(asset.fileName || path.basename(relative), `asset-${contentHash.slice(0, 12)}${imageFormat.extension}`));
    if (path.extname(targetPath).toLowerCase() !== imageFormat.extension) {
      targetPath = path.join(path.dirname(targetPath), `${safeName(path.basename(targetPath, path.extname(targetPath)), "asset")}${imageFormat.extension}`);
    }
    let targetKey = comparablePath(targetPath);
    const existingTarget = existingTargetEntry(targetPath);
    if (existingTarget && existingTarget.contentHash !== contentHash) {
      const extension = path.extname(targetPath);
      const stem = safeName(path.basename(targetPath, extension), "asset");
      let attempt = 0;
      do {
        const suffix = attempt ? `${contentHash.slice(0, 12)}-${attempt}` : contentHash.slice(0, 12);
        targetPath = path.join(path.dirname(targetPath), `${stem}-${suffix}${extension}`);
        targetKey = comparablePath(targetPath);
        attempt += 1;
      } while (
        existingTargetEntry(targetPath) &&
        existingTargetEntry(targetPath).contentHash !== contentHash
      );
    }
    const reusableTarget = existingTargetEntry(targetPath);
    if (!reusableTarget) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      const temporaryTarget = path.join(path.dirname(targetPath), `.iiimage-package-${randomBytes(8).toString("hex")}.tmp`);
      try {
        writeFileSync(temporaryTarget, buffer, { flag: "wx" });
        renameSync(temporaryTarget, targetPath);
      } finally {
        rmSync(temporaryTarget, { force: true });
      }
      targetKey = comparablePath(targetPath);
      restoredByTargetPath.set(targetKey, { path: targetPath, contentHash });
    } else {
      targetPath = reusableTarget.path;
    }
    const declaredHash = String(asset.contentHash || "").trim().toLowerCase();
    if (declaredHash && declaredHash !== contentHash) {
      log(`project package content hash corrected ${relative}`);
    }
    const key = `${asset.nodeId || ""}:${asset.index || ""}:${asset.runId || ""}`;
    const restoredAsset = {
      assetId: asset.assetId || "",
      displayCode: asset.displayCode || "",
      contentHash,
      index: Number(asset.index || 1),
      type: "file",
      path: targetPath,
      relativePath: projectRelativePath(projectPath, targetPath),
      fileName: path.basename(targetPath),
      assetUrl: assetUrlFor(targetPath),
      runId: asset.runId || "",
      revisedPrompt: asset.revisedPrompt || ""
    };
    setUniqueAssetLookup(assetMap, ambiguousAssetMapKeys, key, restoredAsset);
    setUniqueAssetLookup(assetById, ambiguousAssetIds, restoredAsset.assetId, restoredAsset);
    setUniqueAssetLookup(assetByPackageKey, ambiguousPackageKeys, asset.packageAssetKey, restoredAsset);
    setUniqueAssetLookup(assetByRelativePath, ambiguousRelativePaths, packageRelativeLookupKey(relative), restoredAsset);
  }

  const packageAssetForReference = (reference, fallbackKey = "") => {
    if (!reference || typeof reference !== "object") return null;
    const portablePath = reference.relativePath || (
      typeof reference.path === "string" && !path.isAbsolute(reference.path) ? reference.path : ""
    );
    return (reference.packageAssetKey ? assetByPackageKey.get(String(reference.packageAssetKey)) : null) ||
      (reference.assetId ? assetById.get(String(reference.assetId)) : null) ||
      (fallbackKey ? assetMap.get(fallbackKey) : null) ||
      (portablePath ? assetByRelativePath.get(packageRelativeLookupKey(portablePath)) : null) ||
      null;
  };
  const restoredForReference = (reference) => {
    if (!reference || typeof reference !== "object") return reference;
    const restored = packageAssetForReference(reference);
    if (!restored) {
      const next = { ...reference };
      delete next.contentHash;
      delete next.sha256;
      return next;
    }
    const next = { ...reference, ...restored };
    delete next.packageAssetKey;
    return next;
  };
  const preparePackageMessage = (message) => {
    if (!message || typeof message !== "object" || !message.attachments) return message;
    return {
      ...message,
      attachments: {
        ...message.attachments,
        sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(restoredForReference) : [],
        referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(restoredForReference) : []
      }
    };
  };
  const portableSession = packageData?.session && typeof packageData.session === "object" ? packageData.session : defaultSession;
  const preparedSession = {
    ...portableSession,
    pendingAgentExecution: null,
    nodes: (Array.isArray(portableSession.nodes) ? portableSession.nodes : []).map((node) => ({
      ...node,
      assets: (Array.isArray(node?.assets) ? node.assets : []).map((asset) => {
        const key = `${node?.id || ""}:${asset?.index || ""}:${asset?.runId || ""}`;
        const restored = packageAssetForReference(asset, key);
        return restored ? restoredForReference({ ...asset, ...restored }) : restoredForReference(asset);
      }),
      imageParams: node?.imageParams ? {
        ...node.imageParams,
        referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : []
      } : node?.imageParams,
      layerGroup: node?.layerGroup ? {
        ...node.layerGroup,
        previewAsset: restoredForReference(node.layerGroup.previewAsset),
        mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
      } : node?.layerGroup,
      layerComposition: node?.layerComposition ? {
        ...node.layerComposition,
        previewAsset: restoredForReference(node.layerComposition.previewAsset),
        mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
        layers: Array.isArray(node.layerComposition.layers)
          ? node.layerComposition.layers.map((layer) => ({ ...layer, asset: restoredForReference(layer?.asset) }))
          : []
      } : node?.layerComposition
    })),
    messages: Array.isArray(portableSession.messages) ? portableSession.messages.map(preparePackageMessage) : [],
    conversations: Array.isArray(portableSession.conversations)
      ? portableSession.conversations.map((conversation) => ({
          ...conversation,
          messages: Array.isArray(conversation?.messages) ? conversation.messages.map(preparePackageMessage) : []
        }))
      : []
  };
  // The first identity reconciliation must only see hashes derived from the
  // decoded package bytes. Package/session metadata is untrusted and may be
  // stale, corrupt, or deliberately forged.
  const rawSession = sanitizeSession(preparedSession);
  const importedIndex = buildProjectAssetIndex(projectPath);
  const nodes = rawSession.nodes.map((node) => {
    const assets = (node.assets || []).map((asset) => {
      const key = `${node.id}:${asset.index || ""}:${asset.runId || ""}`;
      const restored = (asset.packageAssetKey ? assetByPackageKey.get(asset.packageAssetKey) : null) ||
        (asset.assetId ? assetById.get(asset.assetId) : null) ||
        assetMap.get(key);
      if (!restored) return hydrateAssetForProject(asset, targetProject, importedIndex);
      const next = { ...asset, ...restored };
      delete next.packageAssetKey;
      return next;
    }).filter(Boolean);
    if (!assets.length) {
      for (const [key, value] of assetMap.entries()) {
        if (key.startsWith(`${node.id}:`)) assets.push(value);
      }
    }
    return {
      ...node,
      assets,
      imageParams: node.imageParams ? {
        ...node.imageParams,
        referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : []
      } : node.imageParams,
      layerGroup: node.layerGroup ? {
        ...node.layerGroup,
        previewAsset: restoredForReference(node.layerGroup.previewAsset),
        mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
      } : node.layerGroup,
      layerComposition: node.layerComposition ? {
        ...node.layerComposition,
        previewAsset: restoredForReference(node.layerComposition.previewAsset),
        mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
        layers: Array.isArray(node.layerComposition.layers)
          ? node.layerComposition.layers.map((layer) => ({ ...layer, asset: restoredForReference(layer.asset) }))
          : []
      } : node.layerComposition,
      imageState: node.type === "image" && assets.length ? "done" : node.imageState,
      status: node.type === "image" && assets.length ? "done" : node.status,
      outputs: Math.max(Number(node.outputs || 0), assets.length)
    };
  });
  const rewriteAttachment = (attachment) => {
    if (!attachment || typeof attachment !== "object") return attachment;
    const restored = restoredForReference(attachment);
    if (restored === attachment) return attachment;
    return {
      ...restored,
      path: restored.path,
      assetUrl: restored.assetUrl,
      mimeType: attachment.mimeType || mimeTypeForPath(restored.path),
      name: attachment.name || restored.fileName
    };
  };
  const rewriteMessage = (message) => {
    if (!message || typeof message !== "object" || !message.attachments) return message;
    return {
      ...message,
      attachments: {
        ...message.attachments,
        sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(rewriteAttachment) : [],
        referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(rewriteAttachment) : []
      }
    };
  };
  const messages = Array.isArray(rawSession.messages) ? rawSession.messages.map(rewriteMessage) : [];
  const conversations = Array.isArray(rawSession.conversations)
    ? rawSession.conversations.map((conversation) => ({ ...conversation, messages: Array.isArray(conversation.messages) ? conversation.messages.map(rewriteMessage) : [] }))
    : [];
  return sanitizeSession({ ...rawSession, nodes, messages, conversations });
}

function importProjectPackage(packageData, targetPath) {
  validateProjectPackageData(packageData);
  const name = safeName(packageData.project?.name || path.basename(targetPath), "导入画布");
  const record = createProjectRecord(name, targetPath);
  const session = sessionFromPackage(packageData, record);
  writeJson(record.sessionPath, sessionForProjectSave(session, record));
  writeProjectManifest(record, session);
  return { record, session: projectSessionFromDisk(record) };
}

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

const maxExportImageBytes = 128 * 1024 * 1024;
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

function persistedNodeSequenceFromCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (/^[A-Z]$/.test(code)) return code.charCodeAt(0) - 64;
  const numbered = code.match(/^N(\d+)$/);
  return numbered ? Math.max(0, Number(numbered[1]) || 0) : 0;
}

function sessionAssetContentHash(asset) {
  const source = asset && typeof asset === "object" ? asset : {};
  const value = String(source.contentHash || source.sha256 || "").trim().toLowerCase();
  return /^[a-f0-9]{32,128}$/.test(value) ? value : "";
}

function sessionAssetOccurrenceId(asset, ownerId = "asset", assetIndex = 0) {
  const source = asset && typeof asset === "object" ? asset : {};
  const existing = String(source.occurrenceId || "").trim().toLowerCase();
  if (/^occ-[a-f0-9]{16,64}$/.test(existing)) return existing;
  const importBatchId = String(source.importBatchId || "").trim();
  const importRootId = String(source.importRootId || "").trim();
  const sourceRelativePath = safeImageSourceRelativePath(source.sourceRelativePath).toLowerCase();
  const runId = String(source.runId || "").trim().toLowerCase();
  const assetId = String(source.assetId || `asset-${sessionAssetFingerprint(source, assetIndex + 1, ownerId, assetIndex)}`).trim();
  const identity = importBatchId && importRootId && sourceRelativePath
    ? `import:${importBatchId}|root:${importRootId}|source:${sourceRelativePath}`
    : runId
      ? `run:${runId}|slot:${Math.max(0, Math.floor(Number(assetIndex) || 0))}|asset:${assetId}`
    : `owner:${ownerId}|asset:${assetId}`;
  return `occ-${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function sessionAssetIdentityLocators(asset) {
  const source = asset && typeof asset === "object" ? asset : {};
  const relativePath = String(source.relativePath || "").trim().replace(/\\/g, "/").toLowerCase();
  const localPath = String(source.path || "").trim().replace(/\\/g, "/").toLowerCase();
  const assetUrl = String(source.assetUrl || "").trim();
  const url = String(source.url || "").trim();
  const stableAssetUrl = /^(?:data|blob):/i.test(assetUrl) ? "" : assetUrl;
  const stableUrl = /^(?:data|blob):/i.test(url) ? "" : url;
  return [...new Set([
    relativePath ? `relative-path:${relativePath}` : "",
    localPath ? `path:${localPath}` : "",
    stableAssetUrl ? `asset-url:${stableAssetUrl}` : "",
    stableUrl ? `url:${stableUrl}` : ""
  ].filter(Boolean))];
}

function sessionAssetFingerprint(asset, fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null) {
  const source = asset && typeof asset === "object" ? asset : {};
  const contentHash = sessionAssetContentHash(source);
  const locators = sessionAssetIdentityLocators(source);
  const bridgedHashes = new Set();
  if (!contentHash && contentHashesByLocator) {
    for (const locator of locators) {
      const hashes = contentHashesByLocator.get(locator);
      if (hashes?.size === 1) bridgedHashes.add([...hashes][0]);
    }
  }
  const effectiveContentHash = contentHash || (bridgedHashes.size === 1 ? [...bridgedHashes][0] : "");
  const runId = String(source.runId || "").trim();
  const originalName = String(source.originalName || source.fileName || source.name || "").trim().toLowerCase();
  const index = Math.max(1, Number(source.index || fallbackIndex) || 1);
  let identity = effectiveContentHash
    ? `content:${effectiveContentHash}`
    : locators.length
      ? locators[0]
        : runId
          ? `run:${runId}|index:${index}`
          : originalName
            ? `name:${originalName}|index:${index}`
            : `index:${index}`;
  if (!effectiveContentHash && locators.length === 0 && !runId) {
    identity = `${identity}|owner:${String(ownerId || "")}|slot:${Math.max(0, Number(slot) || 0)}`;
  }
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function sessionAssetAliasFingerprints(asset, fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null) {
  const primary = sessionAssetFingerprint(asset, fallbackIndex, ownerId, slot, contentHashesByLocator);
  const contentHash = sessionAssetContentHash(asset);
  const locators = sessionAssetIdentityLocators(asset);
  const bridgedHashes = new Set();
  if (!contentHash && contentHashesByLocator) {
    for (const locator of locators) {
      const hashes = contentHashesByLocator.get(locator);
      if (hashes?.size === 1) bridgedHashes.add([...hashes][0]);
    }
  }
  if (contentHash || bridgedHashes.size === 1 || locators.length === 0) return [primary];
  return [...new Set([primary, ...locators.map((locator) => createHash("sha256").update(locator).digest("hex").slice(0, 32))])];
}

function repairSessionAssetIdentities(nodes) {
  const records = [];
  const pinCollectionAssetSlots = (collection, assets) => {
    if (!collection || typeof collection !== "object" || !Array.isArray(collection.items)) return collection;
    return {
      ...collection,
      items: collection.items.map((item, itemIndex) => {
        if (!item || typeof item !== "object" || item.status === "pending" || item.status === "error") return item;
        const explicit = Number(item.assetIndex);
        if (Number.isInteger(explicit) && explicit >= 1 && explicit <= assets.length) return item;
        const assetId = String(item.assetId || "").trim();
        const occurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(item.occurrenceId || "").trim())
          ? String(item.occurrenceId).trim().toLowerCase()
          : "";
        const requestIndex = Math.max(1, Math.floor(Number(item.requestIndex || itemIndex + 1) || itemIndex + 1));
        const occurrenceIndex = occurrenceId
          ? assets.findIndex((asset) => asset?.occurrenceId === occurrenceId)
          : -1;
        const matchingIdIndexes = assetId
          ? assets.map((asset, index) => String(asset?.assetId || "").trim() === assetId ? index : -1).filter((index) => index >= 0)
          : [];
        const matchedIndex = occurrenceIndex >= 0
          ? occurrenceIndex
          : matchingIdIndexes.length === 1
            ? matchingIdIndexes[0]
          : matchingIdIndexes.find((index) => Number(assets[index]?.index) === requestIndex) ??
            assets.findIndex((asset) => Number(asset?.index) === requestIndex);
        return matchedIndex >= 0 ? {
          ...item,
          assetIndex: matchedIndex + 1,
          occurrenceId: sessionAssetOccurrenceId(assets[matchedIndex], "image-collection", matchedIndex)
        } : item;
      })
    };
  };
  const register = (asset, nodeId, slot, apply, ownerId = nodeId) => {
    if (!asset || typeof asset !== "object") return asset;
    const next = { ...asset };
    delete next.inputRoot;
    delete next.sourcePath;
    if (typeof next.importBatchId === "string") next.importBatchId = next.importBatchId.trim().slice(0, 160) || undefined;
    if (typeof next.importRootId === "string") next.importRootId = next.importRootId.trim().slice(0, 80) || undefined;
    if (typeof next.sourceRootLabel === "string") next.sourceRootLabel = next.sourceRootLabel.trim().slice(0, 260) || undefined;
    if (next.sourceRootKind !== "directory" && next.sourceRootKind !== "file") delete next.sourceRootKind;
    if (typeof next.sourceRelativePath === "string") {
      next.sourceRelativePath = safeImageSourceRelativePath(next.sourceRelativePath) || undefined;
    }
    next.occurrenceId = sessionAssetOccurrenceId(next, ownerId, slot);
    apply(next);
    records.push({
      asset: next,
      nodeId,
      ownerId,
      slot,
      oldId: String(next.assetId || "").trim(),
      displayCode: String(next.displayCode || "").trim()
    });
    return next;
  };
  for (const node of nodes) {
    const rawAssets = Array.isArray(node.assets) ? node.assets : [];
    if (node.imageCollection) node.imageCollection = pinCollectionAssetSlots(node.imageCollection, rawAssets);
    if (node.imageContainerSpec?.collection) {
      node.imageContainerSpec = {
        ...node.imageContainerSpec,
        collection: pinCollectionAssetSlots(node.imageContainerSpec.collection, rawAssets)
      };
    }
    node.assets = (Array.isArray(node.assets) ? node.assets : []).map((asset, index) => register(asset, node.id, index, () => undefined));
    if (node.imageParams && Array.isArray(node.imageParams.referenceImages)) {
      node.imageParams = { ...node.imageParams, referenceImages: node.imageParams.referenceImages.map((asset, index) => register(asset, node.id, index, () => undefined, `${node.id}:imageParams`)) };
    }
    if (node.layerGroup) {
      node.layerGroup = { ...node.layerGroup };
      if (node.layerGroup.previewAsset) node.layerGroup.previewAsset = register(node.layerGroup.previewAsset, node.id, 0, () => undefined, `${node.id}:group-preview`);
      if (node.layerGroup.mergedAsset) node.layerGroup.mergedAsset = register(node.layerGroup.mergedAsset, node.id, 0, () => undefined, `${node.id}:group-merged`);
    }
    if (node.layerComposition) {
      node.layerComposition = { ...node.layerComposition };
      if (node.layerComposition.previewAsset) node.layerComposition.previewAsset = register(node.layerComposition.previewAsset, node.id, 0, () => undefined, `${node.id}:layer-preview`);
      if (node.layerComposition.mergedAsset) node.layerComposition.mergedAsset = register(node.layerComposition.mergedAsset, node.id, 0, () => undefined, `${node.id}:layer-merged`);
      if (Array.isArray(node.layerComposition.layers)) {
        node.layerComposition.layers = node.layerComposition.layers.map((layer, index) => ({
          ...layer,
          asset: layer?.asset ? register(layer.asset, node.id, index, () => undefined, `${node.id}:layer:${layer.id || index}`) : layer?.asset
        }));
      }
    }
  }
  const contentHashesByLocator = new Map();
  for (const record of records) {
    const contentHash = sessionAssetContentHash(record.asset);
    if (!contentHash) continue;
    for (const locator of sessionAssetIdentityLocators(record.asset)) {
      const hashes = contentHashesByLocator.get(locator) || new Set();
      hashes.add(contentHash);
      contentHashesByLocator.set(locator, hashes);
    }
  }
  for (const record of records) {
    record.fingerprint = sessionAssetFingerprint(record.asset, record.slot + 1, record.ownerId, record.slot, contentHashesByLocator);
    record.aliasFingerprints = sessionAssetAliasFingerprints(record.asset, record.slot + 1, record.ownerId, record.slot, contentHashesByLocator);
  }
  const recordsByOldId = new Map();
  const assigned = new Map();
  const canonicalByFingerprint = new Map();
  const canonicalReferenceByFingerprint = new Map();
  const allocations = new Map();
  const allocate = (record, preferred) => {
    let candidate = preferred;
    let salt = 0;
    while (assigned.has(candidate) && assigned.get(candidate) !== record.fingerprint) {
      candidate = `asset-${createHash("sha256").update(`${record.fingerprint}|${record.ownerId}|${record.slot}|${salt++}`).digest("hex").slice(0, 32)}`;
    }
    assigned.set(candidate, record.fingerprint);
    return candidate;
  };
  for (const record of records) {
    const oldId = record.oldId || `asset-${record.fingerprint}`;
    record.oldId = oldId;
    const sameOldId = recordsByOldId.get(oldId) || [];
    sameOldId.push(record);
    recordsByOldId.set(oldId, sameOldId);
    let assetId = record.aliasFingerprints.map((fingerprint) => canonicalByFingerprint.get(fingerprint)).find(Boolean);
    if (!assetId) {
      assetId = assigned.has(oldId) && assigned.get(oldId) !== record.fingerprint
        ? allocate(record, `asset-${record.fingerprint}`)
        : oldId;
      assigned.set(assetId, record.fingerprint);
    }
    record.aliasFingerprints.forEach((fingerprint) => canonicalByFingerprint.set(fingerprint, assetId));
    allocations.set(`${oldId}\n${record.fingerprint}`, assetId);
    record.asset.assetId = assetId;
  }
  const resolve = (reference, fallbackIndex = 1) => {
    if (!reference || typeof reference !== "object") return reference;
    const oldId = String(reference.assetId || "").trim();
    const nodeId = String(reference.nodeId || "").trim();
    const assetIndex = Number(reference.assetIndex);
    const fingerprint = sessionAssetFingerprint(
      reference,
      fallbackIndex,
      nodeId,
      Number.isInteger(assetIndex) ? assetIndex : Math.max(0, fallbackIndex - 1),
      contentHashesByLocator
    );
    const aliasFingerprints = sessionAssetAliasFingerprints(
      reference,
      fallbackIndex,
      nodeId,
      Number.isInteger(assetIndex) ? assetIndex : Math.max(0, fallbackIndex - 1),
      contentHashesByLocator
    );
    const canonical = aliasFingerprints.map((alias) => canonicalByFingerprint.get(alias)).find(Boolean);
    if (canonical) return { ...reference, assetId: canonical };
    const exact = oldId ? allocations.get(`${oldId}\n${fingerprint}`) : "";
    if (exact) return { ...reference, assetId: exact };
    const candidates = oldId ? recordsByOldId.get(oldId) || [] : [];
    const matched = candidates.find((record) => nodeId && record.nodeId === nodeId && Number.isInteger(assetIndex) && record.slot === assetIndex) ||
      candidates.find((record) => reference.displayCode && record.displayCode === reference.displayCode) ||
      (candidates.length === 1 ? candidates[0] : null);
    if (matched) return { ...reference, assetId: matched.asset.assetId };
    const knownReferenceId = aliasFingerprints.map((alias) => canonicalReferenceByFingerprint.get(alias)).find(Boolean);
    if (knownReferenceId) return { ...reference, assetId: knownReferenceId };
    let unresolvedId = candidates.length > 1 || !oldId ? `asset-${fingerprint}` : oldId;
    if (assigned.has(unresolvedId) && assigned.get(unresolvedId) !== fingerprint) unresolvedId = `asset-${fingerprint}`;
    assigned.set(unresolvedId, fingerprint);
    aliasFingerprints.forEach((alias) => canonicalReferenceByFingerprint.set(alias, unresolvedId));
    return { ...reference, assetId: unresolvedId };
  };
  return { resolve };
}

function repairSessionMessageAssetIds(messages, resolve) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== "object" || !message.attachments) return message;
    return {
      ...message,
      attachments: {
        ...message.attachments,
        sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map((asset, index) => resolve(asset, index + 1)) : [],
        referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map((asset, index) => resolve(asset, index + 1)) : []
      }
    };
  });
}

function sanitizePersistedCanvasRequirement(value, fallbackText = "") {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" && value.text.trim()
    ? value.text.trim().slice(0, 24_000)
    : typeof fallbackText === "string" && fallbackText.trim()
      ? fallbackText.trim().slice(0, 24_000)
      : "";
  if (!text) return null;
  const createdFrom = value.createdFrom === "container" || value.createdFrom === "layer" ? value.createdFrom : "node";
  const requirement = {
    version: 1,
    text,
    revision: Math.max(1, Math.floor(Number(value.revision || 1))),
    createdFrom,
  };
  if (typeof value.lastSourceSignature === "string" && value.lastSourceSignature.trim()) {
    requirement.lastSourceSignature = value.lastSourceSignature.trim().slice(0, 160);
  }
  if (typeof value.lastRunAt === "string" && value.lastRunAt.trim()) {
    requirement.lastRunAt = value.lastRunAt.trim().slice(0, 80);
  }
  const lastRunCount = Math.max(0, Math.floor(Number(value.lastRunCount || 0)));
  if (lastRunCount > 0) requirement.lastRunCount = lastRunCount;
  if (typeof value.lastError === "string" && value.lastError.trim()) {
    requirement.lastError = value.lastError.trim().slice(0, 500);
  }
  return requirement;
}

function sanitizePersistedImageTaskProvenance(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const snapshotHash = String(value.taskScopeSnapshotHash || "").trim().toLowerCase();
  const resultPolicies = new Set(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
  if (!/^scope-[a-f0-9]{32}$/.test(snapshotHash) || !resultPolicies.has(value.resultPolicy)) return null;
  const clean = (input, maximum) => typeof input === "string" && input.trim() ? input.trim().slice(0, maximum) : undefined;
  const revision = Number(value.requirementRevision);
  return {
    version: 1,
    taskScopeSnapshotHash: snapshotHash,
    resultPolicy: value.resultPolicy,
    ...(clean(value.sourceBindingId, 520) ? { sourceBindingId: clean(value.sourceBindingId, 520) } : {}),
    ...(clean(value.sourceAssetId, 160) ? { sourceAssetId: clean(value.sourceAssetId, 160) } : {}),
    ...(clean(value.sourceOccurrenceId, 80) ? { sourceOccurrenceId: clean(value.sourceOccurrenceId, 80) } : {}),
    ...(clean(value.sourceNodeId, 160) ? { sourceNodeId: clean(value.sourceNodeId, 160) } : {}),
    ...(clean(value.sourceContainerId, 160) ? { sourceContainerId: clean(value.sourceContainerId, 160) } : {}),
    ...(clean(value.sourceDisplayCode, 40) ? { sourceDisplayCode: clean(value.sourceDisplayCode, 40) } : {}),
    ...(clean(value.requirementNodeId, 160) ? { requirementNodeId: clean(value.requirementNodeId, 160) } : {}),
    ...(Number.isInteger(revision) && revision >= 1 ? { requirementRevision: Math.floor(revision) } : {})
  };
}

function sanitizePersistedImageCollection(value, assets = []) {
  if (!value || typeof value !== "object") return null;
  const source = value;
  const items = (Array.isArray(source.items) ? source.items : []).slice(0, 10).map((item, index) => {
    const candidate = item && typeof item === "object" ? item : {};
    const requestedStatus = candidate.status === "pending" || candidate.status === "error" ? candidate.status : "done";
    const rawAssetIndex = Number(candidate.assetIndex);
      const candidateAssetId = typeof candidate.assetId === "string" && candidate.assetId.trim()
        ? candidate.assetId.trim().slice(0, 160)
        : "";
    const candidateOccurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(candidate.occurrenceId || "").trim())
      ? String(candidate.occurrenceId).trim().toLowerCase()
      : "";
    const explicitAssetIndex = Number.isInteger(rawAssetIndex) && rawAssetIndex >= 1 && rawAssetIndex <= Math.min(10, assets.length)
      ? rawAssetIndex
      : undefined;
    const occurrenceIndex = explicitAssetIndex === undefined && candidateOccurrenceId
      ? assets.findIndex((asset) => asset?.occurrenceId === candidateOccurrenceId)
      : -1;
    const matchingAssetIdIndexes = explicitAssetIndex === undefined && occurrenceIndex < 0 && candidateAssetId
      ? assets.map((asset, assetIndex) => asset?.assetId === candidateAssetId ? assetIndex : -1).filter((assetIndex) => assetIndex >= 0)
      : [];
    const assetIdIndex = matchingAssetIdIndexes.length === 1
      ? matchingAssetIdIndexes[0]
      : -1;
    const legacyAssetIndex = explicitAssetIndex === undefined && occurrenceIndex < 0 && assetIdIndex < 0 && requestedStatus === "done" &&
      candidate.assetIndex === undefined && !candidateAssetId && Boolean(assets[index])
      ? index + 1
      : undefined;
    const assetIndex = requestedStatus === "done"
      ? explicitAssetIndex ?? (occurrenceIndex >= 0 ? occurrenceIndex + 1 : assetIdIndex >= 0 ? assetIdIndex + 1 : legacyAssetIndex)
      : undefined;
    const asset = assetIndex === undefined ? null : assets[assetIndex - 1];
    const status = requestedStatus === "done" && !asset ? "error" : requestedStatus;
    return {
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim().slice(0, 120) : `item-${index + 1}`,
      requestIndex: Math.max(1, Math.min(10, Math.floor(Number(candidate.requestIndex || index + 1) || index + 1))),
      ...(assetIndex === undefined ? {} : { assetIndex }),
      ...(status === "done" && asset?.assetId ? { assetId: asset.assetId } : {}),
      ...(status === "done" && asset ? { occurrenceId: sessionAssetOccurrenceId(asset, "image-collection", (assetIndex || 1) - 1) } : {}),
      prompt: typeof candidate.prompt === "string" && candidate.prompt.trim()
        ? candidate.prompt.trim().slice(0, 12_000)
        : String(asset?.prompt || asset?.revisedPrompt || "").slice(0, 12_000),
      ...(typeof candidate.title === "string" && candidate.title.trim() ? { title: candidate.title.trim().slice(0, 160) } : {}),
      status,
      ...(typeof candidate.error === "string" && candidate.error.trim()
        ? { error: candidate.error.trim().slice(0, 320) }
        : requestedStatus === "done" && !asset ? { error: "图片槽位缺少对应成果。" } : {})
    };
  });
  if (!items.length && !assets.length) return null;
  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 120) : "image-collection",
    kind: source.kind === "series" ? "series" : "batch",
    generationMode: source.generationMode === "sequential" ? "sequential" : "parallel",
    items: items.length ? items : assets.slice(0, 10).map((asset, index) => ({
      id: `item-${index + 1}`,
      requestIndex: index + 1,
      assetIndex: index + 1,
      assetId: asset.assetId,
      occurrenceId: sessionAssetOccurrenceId(asset, "image-collection", index),
      prompt: String(asset.prompt || asset.revisedPrompt || "").slice(0, 12_000),
      ...(asset.title ? { title: String(asset.title).slice(0, 160) } : {}),
      status: "done"
    })),
    ...(typeof source.sourceNodeId === "string" && source.sourceNodeId.trim() ? { sourceNodeId: source.sourceNodeId.trim().slice(0, 160) } : {}),
    ...(typeof source.createdAt === "string" && source.createdAt.trim() ? { createdAt: source.createdAt.trim().slice(0, 80) } : {}),
    autoFit: source.autoFit !== false
  };
}

function sanitizePersistedImageContainerSpec(value, node, fallbackCollection = null) {
  if (!value || typeof value !== "object") return null;
  const kinds = new Set(["manual", "folder", "batch-result", "container-group"]);
  if (!kinds.has(value.kind)) return null;
  const uniqueIds = (items) => [...new Set((Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" ? item.trim().slice(0, 160) : "")
    .filter((id) => id && id !== node.id))];
  const seenBindingIds = new Set();
  const memberBindings = (Array.isArray(value.memberBindings) ? value.memberBindings : []).slice(0, 2000).flatMap((binding, index) => {
    if (!binding || typeof binding !== "object") return [];
    const assetId = typeof binding.assetId === "string" ? binding.assetId.trim().slice(0, 160) : "";
    const ownerNodeId = typeof binding.nodeId === "string" && binding.nodeId.trim() ? binding.nodeId.trim().slice(0, 160) : node.id;
    const containerNodeId = typeof binding.containerNodeId === "string" && binding.containerNodeId.trim() ? binding.containerNodeId.trim().slice(0, 160) : node.id;
    if (!assetId) return [];
    const assetIndex = Math.max(0, Math.floor(Number(binding.assetIndex ?? index) || 0));
    const occurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(binding.occurrenceId || "").trim())
      ? String(binding.occurrenceId).trim().toLowerCase()
      : undefined;
    const requestedBindingId = typeof binding.bindingId === "string" && binding.bindingId.trim()
      ? binding.bindingId.trim().slice(0, 520)
      : "";
    const bindingSeed = occurrenceId || `${assetId}:${assetIndex}`;
    let bindingId = requestedBindingId && !seenBindingIds.has(requestedBindingId)
      ? requestedBindingId
      : `binding:${containerNodeId}:${ownerNodeId}:${bindingSeed}`;
    let suffix = 1;
    while (seenBindingIds.has(bindingId)) bindingId = `binding:${containerNodeId}:${ownerNodeId}:${bindingSeed}:${suffix++}`;
    seenBindingIds.add(bindingId);
    return [{
      bindingId,
      assetId,
      ...(occurrenceId ? { occurrenceId } : {}),
      nodeId: ownerNodeId,
      containerNodeId,
      assetIndex,
      ...(binding.role === "source" || binding.role === "reference" ? { role: binding.role } : {})
    }];
  });
  const collection = sanitizePersistedImageCollection(value.collection, node.assets) || fallbackCollection;
  return {
    version: 1,
    kind: value.kind,
    memberNodeIds: uniqueIds(value.memberNodeIds),
    childContainerNodeIds: uniqueIds(value.childContainerNodeIds),
    memberBindings,
    ...(value.hostContentKind === "manual" || value.hostContentKind === "folder" || value.hostContentKind === "batch-result" ? { hostContentKind: value.hostContentKind } : {}),
    ...(typeof value.sourceLabel === "string" && value.sourceLabel.trim() ? { sourceLabel: value.sourceLabel.trim().slice(0, 260) } : {}),
    ...(typeof value.importBatchId === "string" && value.importBatchId.trim() ? { importBatchId: value.importBatchId.trim().slice(0, 160) } : {}),
    ...(typeof value.layoutId === "string" && value.layoutId.trim() ? { layoutId: value.layoutId.trim().slice(0, 160) } : {}),
    layoutOrigin: value.layoutOrigin === "auto" || value.layoutOrigin === "generation" ? value.layoutOrigin : "manual",
    autoFit: value.autoFit !== false,
    ...(collection ? { collection } : {})
  };
}

function repairPersistedImageContainerSpecs(nodes) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const eligible = (id) => {
    const node = nodeById.get(id);
    return Boolean(node && node.type === "image" && !node.layerGroup);
  };
  const isContainer = (node) => Boolean(node && node.type === "image" && !node.layerGroup && (node.imageContainerSpec || node.imageContainer || node.imageCollection));
  const rawSpecs = new Map();
  for (const node of nodes) {
    if (node.type !== "image" || node.layerGroup) continue;
    const collection = sanitizePersistedImageCollection(node.imageCollection, node.assets);
    let spec = sanitizePersistedImageContainerSpec(node.imageContainerSpec, node, collection);
    if (!spec && collection) {
      spec = { version: 1, kind: "batch-result", memberNodeIds: [], childContainerNodeIds: [], memberBindings: [], layoutOrigin: "generation", autoFit: collection.autoFit !== false, collection };
    } else if (!spec && node.imageContainer) {
      spec = { version: 1, kind: "manual", memberNodeIds: [], childContainerNodeIds: [], memberBindings: [], layoutOrigin: "manual", autoFit: true };
    }
    if (spec) rawSpecs.set(node.id, spec);
  }
  const reaches = (startId, targetId, active = new Set(), depth = 0) => {
    if (startId === targetId) return true;
    if (depth >= 16 || active.has(startId)) return false;
    const spec = rawSpecs.get(startId);
    if (!spec) return false;
    const next = new Set(active).add(startId);
    return spec.childContainerNodeIds.some((childId) => reaches(childId, targetId, next, depth + 1));
  };
  const maxDepth = (nodeId, active = new Set()) => {
    if (active.has(nodeId)) return 17;
    const spec = rawSpecs.get(nodeId);
    if (!spec?.childContainerNodeIds?.length) return 1;
    const next = new Set(active).add(nodeId);
    return 1 + Math.max(...spec.childContainerNodeIds.map((childId) => maxDepth(childId, next)));
  };
  const descendantIds = (nodeId, active = new Set()) => {
    if (active.has(nodeId)) return new Set();
    const spec = rawSpecs.get(nodeId);
    const result = new Set();
    if (!spec) return result;
    const next = new Set(active).add(nodeId);
    for (const memberId of spec.memberNodeIds || []) result.add(memberId);
    for (const childId of spec.childContainerNodeIds || []) {
      result.add(childId);
      descendantIds(childId, next).forEach((id) => result.add(id));
    }
    return result;
  };
  const claimedParent = new Map();
  const ancestorDepth = (nodeId) => {
    let depth = 0;
    let current = nodeId;
    const seen = new Set();
    while (claimedParent.has(current) && !seen.has(current) && depth <= 16) {
      seen.add(current);
      current = claimedParent.get(current);
      depth += 1;
    }
    return depth;
  };
  const bindingForAssets = (owner, containerId, existing = []) => {
    const unused = new Set(existing.map((_item, index) => index));
    const usedBindingIds = new Set();
    return (Array.isArray(owner.assets) ? owner.assets : []).map((asset, assetIndex) => {
      const assetId = String(asset.assetId || `asset-${sessionAssetFingerprint(asset, assetIndex + 1, owner.id, assetIndex)}`).slice(0, 160);
      const occurrenceId = sessionAssetOccurrenceId(asset, owner.id, assetIndex);
      asset.occurrenceId = occurrenceId;
      const exact = existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.assetIndex === assetIndex && (binding.occurrenceId ? binding.occurrenceId === occurrenceId : binding.assetId === assetId));
      const sameOccurrence = exact >= 0 ? exact : existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.occurrenceId === occurrenceId);
      const fallback = sameOccurrence >= 0 ? sameOccurrence : existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.assetIndex === assetIndex);
      const previous = fallback >= 0 ? existing[fallback] : null;
      if (fallback >= 0) unused.delete(fallback);
      const bindingBase = `binding:${containerId}:${owner.id}:${occurrenceId}`;
      let bindingId = previous?.bindingId && !usedBindingIds.has(previous.bindingId) ? previous.bindingId : bindingBase;
      let bindingSuffix = 2;
      while (usedBindingIds.has(bindingId)) bindingId = `${bindingBase}:${bindingSuffix++}`;
      usedBindingIds.add(bindingId);
      return {
        bindingId,
        assetId,
        occurrenceId,
        nodeId: owner.id,
        containerNodeId: containerId,
        assetIndex,
        ...(asset.taskRole === "source" || asset.taskRole === "reference"
          ? { role: asset.taskRole }
          : owner.imageContainerRole === "source" || owner.imageContainerRole === "reference"
            ? { role: owner.imageContainerRole }
            : previous?.role ? { role: previous.role } : {})
      };
    });
  };

  for (const node of nodes) {
    const source = rawSpecs.get(node.id);
    if (!source) {
      delete node.imageContainerSpec;
      if (node.type !== "image" || node.layerGroup) {
        delete node.imageContainer;
        delete node.imageCollection;
      }
      continue;
    }
    const rawMembers = [...new Set((source.memberNodeIds || []).filter((id) => eligible(id) && id !== node.id))];
    const childCandidates = [...new Set([
      ...(source.childContainerNodeIds || []),
      ...rawMembers.filter((id) => isContainer(nodeById.get(id)))
    ])].filter((id) => eligible(id) && id !== node.id && isContainer(nodeById.get(id)));
    const requestedChildren = childCandidates.filter((candidateId) => !childCandidates.some((otherId) => (
      otherId !== candidateId && descendantIds(otherId).has(candidateId)
    )));
    const childContainerNodeIds = [];
    for (const childId of requestedChildren) {
      if (claimedParent.has(childId) || reaches(childId, node.id) || ancestorDepth(node.id) + 1 + maxDepth(childId) > 16) continue;
      claimedParent.set(childId, node.id);
      childContainerNodeIds.push(childId);
    }
    const memberNodeIds = [];
    for (const memberId of rawMembers) {
      if (childContainerNodeIds.includes(memberId) || claimedParent.has(memberId)) continue;
      claimedParent.set(memberId, node.id);
      memberNodeIds.push(memberId);
    }
    const hasChildren = childContainerNodeIds.length > 0;
    const kind = hasChildren ? "container-group" : source.kind === "container-group" ? source.hostContentKind || "manual" : source.kind;
    const ownBindings = bindingForAssets(node, node.id, source.memberBindings || []);
    const memberBindings = [
      ...ownBindings,
      ...memberNodeIds.flatMap((memberId) => {
        const member = nodeById.get(memberId);
        return bindingForAssets(member, node.id, (source.memberBindings || []).filter((binding) => binding.nodeId === memberId && binding.containerNodeId === node.id));
      })
    ].slice(0, 2000);
    const collection = sanitizePersistedImageCollection(source.collection || node.imageCollection, node.assets);
    if (collection) {
      collection.items = collection.items.map((item) => {
        const asset = Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 1 ? node.assets?.[Number(item.assetIndex) - 1] : null;
        return { ...item, ...(asset?.assetId ? { assetId: asset.assetId, occurrenceId: sessionAssetOccurrenceId(asset, node.id, Number(item.assetIndex) - 1) } : {}) };
      });
    }
    node.imageContainerSpec = {
      ...source,
      kind,
      ...(hasChildren ? { hostContentKind: source.kind === "container-group" ? source.hostContentKind : source.kind } : { hostContentKind: undefined }),
      memberNodeIds,
      childContainerNodeIds,
      memberBindings,
      ...((memberNodeIds.length || childContainerNodeIds.length) && source.layoutId ? { layoutId: source.layoutId } : { layoutId: undefined }),
      ...(collection ? { collection } : { collection: undefined })
    };
    node.imageContainer = kind !== "batch-result";
    if (collection) node.imageCollection = collection;
    else delete node.imageCollection;
  }
}

function sanitizePersistedPendingAgentExecution(value) {
  if (!value || typeof value !== "object") return null;
  const clean = (input, maximum) => typeof input === "string" ? input.trim().slice(0, maximum) : "";
  const cleanPath = (input) => {
    const candidate = typeof input === "string" ? input.trim() : "";
    return candidate && candidate.length <= 32767 && !candidate.includes("\u0000") ? candidate : "";
  };
  const requestId = clean(value.requestId, 180);
  const projectId = clean(value.projectId, 180);
  const conversationId = clean(value.conversationId, 180);
  const originalPrompt = clean(value.originalPrompt, 24_000);
  const question = clean(value.question, 4_000);
  const kinds = new Set(["clarify", "confirm", "source_images", "reference_images"]);
  const origins = new Set(["chat", "canvas", "node", "container", "layer", "requirement"]);
  const scopeTypes = new Set(["none", "single", "multi-source", "container", "container-group", "layer", "layer-group", "mixed"]);
  const resultPolicies = new Set(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
  const confirmationPolicies = new Set(["auto", "preview-3", "staged", "direct"]);
  if (!requestId || !projectId || !conversationId || !originalPrompt || !question || !kinds.has(value.kind)) return null;
  const rawScope = value.taskScope && typeof value.taskScope === "object" ? value.taskScope : null;
  if (!rawScope) return null;
  const normalizeAssets = (items, role, limit) => (Array.isArray(items) ? items : []).slice(0, limit).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const assetId = clean(item.assetId, 160);
    const localPath = cleanPath(item.path);
    const relativePath = cleanPath(item.relativePath).replace(/\\/g, "/");
    const assetUrl = clean(item.assetUrl, 4000);
    if (!assetId && !localPath && !relativePath && !assetUrl) return [];
    const containerSlot = Number.isInteger(Number(item.containerSlot)) && Number(item.containerSlot) >= 0
      ? Math.floor(Number(item.containerSlot))
      : Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 0
        ? Math.floor(Number(item.assetIndex))
        : undefined;
    const ownerAssetIndex = Number.isInteger(Number(item.ownerAssetIndex)) && Number(item.ownerAssetIndex) >= 0
      ? Math.floor(Number(item.ownerAssetIndex))
      : undefined;
    const sourceRelativePath = safeImageSourceRelativePath(item.sourceRelativePath);
    return [{
      ...(clean(item.bindingId, 520) ? { bindingId: clean(item.bindingId, 520) } : {}),
      assetId: assetId || `pending-${role}-${index + 1}`,
      ...(/^occ-[a-f0-9]{16,64}$/i.test(clean(item.occurrenceId, 80)) ? { occurrenceId: clean(item.occurrenceId, 80).toLowerCase() } : {}),
      ...(clean(item.importBatchId, 160) ? { importBatchId: clean(item.importBatchId, 160) } : {}),
      ...(clean(item.importRootId, 80) ? { importRootId: clean(item.importRootId, 80) } : {}),
      ...(sourceRelativePath ? { sourceRelativePath } : {}),
      ...(clean(item.sourceRootLabel, 260) ? { sourceRootLabel: clean(item.sourceRootLabel, 260) } : {}),
      ...(item.sourceRootKind === "directory" || item.sourceRootKind === "file" ? { sourceRootKind: item.sourceRootKind } : {}),
      displayCode: clean(item.displayCode, 40) || `${role === "source" ? "SRC" : "REF"}${index + 1}`,
      ...(/^[a-f0-9]{32,128}$/i.test(clean(item.contentHash, 128)) ? { contentHash: clean(item.contentHash, 128).toLowerCase() } : {}),
      role,
      name: clean(item.name, 260) || `${role === "source" ? "原图" : "参考图"} ${index + 1}`,
      ...(containerSlot === undefined ? {} : { assetIndex: containerSlot, containerSlot }),
      ...(ownerAssetIndex === undefined ? {} : { ownerAssetIndex }),
      ...(clean(item.ownerNodeId, 160) ? { ownerNodeId: clean(item.ownerNodeId, 160) } : {}),
      ...(clean(item.nodeId, 160) ? { nodeId: clean(item.nodeId, 160) } : {}),
      ...(clean(item.containerId, 160) ? { containerId: clean(item.containerId, 160) } : {}),
      ...(localPath ? { path: localPath } : {}),
      ...(relativePath ? { relativePath } : {}),
      ...(assetUrl ? { assetUrl } : {}),
      ...(clean(item.mimeType, 100) ? { mimeType: clean(item.mimeType, 100) } : {}),
      ...(clean(item.purpose, 400) ? { purpose: clean(item.purpose, 400) } : {}),
      ...(role === "reference" && clean(item.referenceRole, 80) ? { referenceRole: clean(item.referenceRole, 80) } : {})
    }];
  });
  const sourceAssets = normalizeAssets(rawScope.sourceAssets, "source", 200);
  const referenceAssets = normalizeAssets(rawScope.referenceAssets, "reference", 40);
  const normalizeOptions = (items) => {
    if (!Array.isArray(items)) return [];
    const usedIds = new Set();
    let recommendedClaimed = false;
    const options = items.slice(0, 3).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const label = clean(item.label, 80).replace(/\s+/g, " ");
      if (!label) return [];
      const fallbackId = `option-${index + 1}`;
      let id = clean(item.id, 80).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallbackId;
      let suffix = 2;
      const baseId = id;
      while (usedIds.has(id)) id = `${baseId}-${suffix++}`.slice(0, 80);
      usedIds.add(id);
      const recommended = item.recommended === true && !recommendedClaimed;
      if (recommended) recommendedClaimed = true;
      return [{
        id,
        label,
        ...(clean(item.description, 260) ? { description: clean(item.description, 260) } : {}),
        answer: clean(item.answer, 4_000) || label,
        ...(recommended ? { recommended: true } : {})
      }];
    });
    return options.length >= 2 ? options : [];
  };
  const options = normalizeOptions(value.options);
  const sourceNodeIds = [...new Set((Array.isArray(value.sourceNodeIds) ? value.sourceNodeIds : rawScope.sourceNodeIds || [])
    .map((id) => clean(id, 160)).filter(Boolean))].slice(0, 200);
  const origin = origins.has(value.taskOrigin) ? value.taskOrigin : origins.has(rawScope.origin) ? rawScope.origin : "chat";
  const cleanIds = (items, maximum) => [...new Set((Array.isArray(items) ? items : [])
    .map((id) => clean(id, 520))
    .filter(Boolean))].slice(0, maximum);
  const scopeType = scopeTypes.has(rawScope.scopeType)
    ? rawScope.scopeType
    : sourceAssets.length > 1 || sourceNodeIds.length > 1
      ? "multi-source"
      : sourceAssets.length === 1
        ? "single"
        : "none";
  const resultPolicy = resultPolicies.has(rawScope.resultPolicy)
    ? rawScope.resultPolicy
    : scopeType === "layer" || scopeType === "layer-group"
      ? "layer-variants"
      : scopeType === "container-group"
        ? "grouped-by-container"
        : sourceAssets.length > 1 || sourceNodeIds.length > 1
          ? "grouped-by-source"
          : "single";
  const confirmationPolicy = confirmationPolicies.has(rawScope.confirmationPolicy) ? rawScope.confirmationPolicy : "auto";
  const requirementNodeId = clean(value.requirementNodeId, 160) || clean(rawScope.requirement?.nodeId, 160);
  const requirementRevisionValue = Number(value.requirementRevision ?? rawScope.requirement?.revision);
  const requirementRevision = Number.isInteger(requirementRevisionValue) && requirementRevisionValue >= 1
    ? Math.floor(requirementRevisionValue)
    : undefined;
  const requirementSourceSignature = clean(value.requirementSourceSignature, 240) || clean(rawScope.requirement?.sourceSignature, 240);
  const snapshotHash = /^scope-[a-f0-9]{32}$/i.test(clean(rawScope.snapshotHash, 80))
    ? clean(rawScope.snapshotHash, 80).toLowerCase()
    : "";
  return {
    version: 2,
    requestId,
    projectId,
    conversationId,
    originalPrompt,
    sourceNodeIds,
    ...(clean(value.focusedNodeId, 160) ? { focusedNodeId: clean(value.focusedNodeId, 160) } : {}),
    taskOrigin: origin,
    taskScope: {
      version: 2,
      origin,
      scopeType,
      canvasRevision: Math.max(0, Math.floor(Number(rawScope.canvasRevision) || 0)),
      sourceNodeIds: [...new Set((Array.isArray(rawScope.sourceNodeIds) ? rawScope.sourceNodeIds : sourceNodeIds).map((id) => clean(id, 160)).filter(Boolean))].slice(0, 200),
      sourceContainerIds: cleanIds(rawScope.sourceContainerIds, 200),
      referenceContainerIds: cleanIds(rawScope.referenceContainerIds, 40),
      sourceBindingIds: cleanIds(
        Array.isArray(rawScope.sourceBindingIds) && rawScope.sourceBindingIds.length
          ? rawScope.sourceBindingIds
          : sourceAssets.map((asset) => asset.bindingId),
        200
      ),
      referenceBindingIds: cleanIds(
        Array.isArray(rawScope.referenceBindingIds) && rawScope.referenceBindingIds.length
          ? rawScope.referenceBindingIds
          : referenceAssets.map((asset) => asset.bindingId),
        40
      ),
      sourceAssets,
      referenceAssets,
      resultPolicy,
      confirmationPolicy,
      ...(requirementNodeId && requirementRevision !== undefined
        ? { requirement: { nodeId: requirementNodeId, revision: requirementRevision, ...(requirementSourceSignature ? { sourceSignature: requirementSourceSignature } : {}) } }
        : {}),
      snapshotHash,
      sourceAssetCount: Math.max(sourceAssets.length, Math.floor(Number(rawScope.sourceAssetCount || sourceAssets.length) || sourceAssets.length)),
      referenceAssetCount: Math.max(referenceAssets.length, Math.floor(Number(rawScope.referenceAssetCount || referenceAssets.length) || referenceAssets.length)),
      truncated: rawScope.truncated === true
    },
    ...(requirementNodeId ? { requirementNodeId } : {}),
    ...(requirementRevision === undefined ? {} : { requirementRevision }),
    ...(clean(value.requirementSourceNodeId, 160) ? { requirementSourceNodeId: clean(value.requirementSourceNodeId, 160) } : {}),
    ...(requirementSourceSignature ? { requirementSourceSignature } : {}),
    kind: value.kind,
    title: clean(value.title, 240) || (value.kind === "source_images" ? "添加原图" : value.kind === "reference_images" ? "添加参考图" : "需要你确认"),
    question,
    ...(clean(value.detail, 4_000) ? { detail: clean(value.detail, 4_000) } : {}),
    ...(clean(value.suggestedAnswer, 4_000) ? { suggestedAnswer: clean(value.suggestedAnswer, 4_000) } : {}),
    ...(options.length ? { options } : {}),
    maxImages: Math.max(1, Math.min(40, Math.floor(Number(value.maxImages || 9) || 9))),
    createdAt: clean(value.createdAt, 80) || new Date().toISOString()
  };
}

function sanitizeSession(session) {
  const source = session && typeof session === "object" ? session : {};
  const usedIds = new Set();
  const usedDisplayCodes = new Set();
  const nodes = Array.isArray(source.nodes)
    ? source.nodes
        .filter((node) => node && typeof node === "object")
        .map((node, index) => {
          const next = { ...node };
          const fallbackId = `N${index + 1}`;
          next.id = typeof next.id === "string" && next.id.trim() ? next.id.trim() : fallbackId;
          if (usedIds.has(next.id)) {
            let suffix = Math.max(27, index + 1);
            while (usedIds.has(`N${suffix}`)) suffix += 1;
            next.id = `N${suffix}`;
          }
          usedIds.add(next.id);
          next.displayCode = typeof next.displayCode === "string" && next.displayCode.trim()
            ? next.displayCode.trim().replace(/\s+/g, "").slice(0, 32)
            : next.id;
          if (usedDisplayCodes.has(next.displayCode)) {
            let suffix = Math.max(27, index + 1);
            while (usedDisplayCodes.has(`N${suffix}`)) suffix += 1;
            next.displayCode = `N${suffix}`;
          }
          usedDisplayCodes.add(next.displayCode);
          if (next.parentId === next.id || typeof next.parentId !== "string" || !next.parentId.trim()) delete next.parentId;
          if (next.agentOwnerId === next.id || typeof next.agentOwnerId !== "string" || !next.agentOwnerId.trim()) delete next.agentOwnerId;
          if (next.type === "image" && next.imageState === "queued") next.imageState = "empty";
          if (next.type === "image" && Array.isArray(next.assets) && next.assets.length > 0) {
            next.imageState = "done";
            next.status = "done";
            next.outputs = Math.max(Number(next.outputs ?? 0), next.assets.length);
          }
          if (next.type === "image") {
            next.taskProvenance = sanitizePersistedImageTaskProvenance(next.taskProvenance);
            if (!next.taskProvenance) delete next.taskProvenance;
          }
          if (next.type === "requirement") {
            next.requirement = sanitizePersistedCanvasRequirement(next.requirement, next.prompt);
            next.status = "done";
            next.outputs = 0;
            delete next.assets;
            delete next.imageState;
            delete next.imageProgress;
            delete next.imageParams;
            delete next.imageCollection;
            delete next.imageContainer;
            delete next.imageContainerSpec;
            delete next.layerGroup;
            delete next.layerComposition;
          }
          if (!Number.isFinite(Number(next.x))) next.x = 120 + index * 300;
          if (!Number.isFinite(Number(next.y))) next.y = 120 + index * 120;
          return next;
        })
    : [];
  const removedLegacyIds = new Set(
    nodes
      .filter((node) => node.type !== "image" && !(node.type === "requirement" && node.requirement) && (!Array.isArray(node.assets) || node.assets.length === 0))
      .map((node) => node.id)
  );
  const artifactNodes = nodes
    .filter((node) => node.type === "image" || (node.type === "requirement" && node.requirement) || (Array.isArray(node.assets) && node.assets.length > 0))
    .map((node) => node.type === "requirement" ? node : ({ ...node, type: "image" }));
  const ids = new Set(artifactNodes.map((node) => node.id));
  for (const node of artifactNodes) {
    if (node.parentId && !ids.has(node.parentId)) delete node.parentId;
    if (node.parentId && removedLegacyIds.has(node.parentId)) delete node.parentId;
    delete node.agentOwnerId;
    delete node.agentConversationId;
    delete node.agentInitState;
    delete node.agentLastMemoryEntryId;
  }
  const assetIdentity = repairSessionAssetIdentities(artifactNodes);
  repairPersistedImageContainerSpecs(artifactNodes);
  const nodeById = new Map(artifactNodes.map((node) => [node.id, node]));
  const claimedLayoutNodeIds = new Set();
  const usedLayoutGroupIds = new Set();
  const layoutGroups = [];
  for (const rawGroup of Array.isArray(source.layoutGroups) ? source.layoutGroups : []) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const id = typeof rawGroup.id === "string" ? rawGroup.id.trim().slice(0, 160) : "";
    if (!id || usedLayoutGroupIds.has(id)) continue;
    usedLayoutGroupIds.add(id);
    const requestedMembers = Array.isArray(rawGroup.memberNodeIds) ? rawGroup.memberNodeIds : [];
    const candidateIds = [];
    const hostCandidate = typeof rawGroup.hostNodeId === "string" ? rawGroup.hostNodeId.trim() : "";
    if (hostCandidate) candidateIds.push(hostCandidate);
    candidateIds.push(...requestedMembers.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean));
    const memberNodeIds = [];
    for (const memberId of candidateIds) {
      const member = nodeById.get(memberId);
      if (!member || member.type !== "image" || member.layerGroup || claimedLayoutNodeIds.has(memberId) || memberNodeIds.includes(memberId)) continue;
      memberNodeIds.push(memberId);
    }
    if (memberNodeIds.length < 2) continue;
    const hostNodeId = memberNodeIds.includes(hostCandidate) ? hostCandidate : memberNodeIds[0];
    memberNodeIds.forEach((memberId) => claimedLayoutNodeIds.add(memberId));
    layoutGroups.push({
      id,
      hostNodeId,
      memberNodeIds,
      origin: rawGroup.origin === "auto" || rawGroup.origin === "generation" ? rawGroup.origin : "manual",
      autoFit: rawGroup.autoFit !== false
    });
  }
  const selectedNodeId = ids.has(source.selectedNodeId) ? source.selectedNodeId : "";
  const conversations = Array.isArray(source.conversations)
    ? source.conversations
        .filter((item) => item && typeof item === "object")
        .map((item, index) => {
          const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `conv-${index + 1}`;
          const messages = repairSessionMessageAssetIds(item.messages, assetIdentity.resolve);
          const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString();
          return {
            id,
            title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 80) : `会话 ${index + 1}`,
            messages,
            createdAt: typeof item.createdAt === "string" ? item.createdAt : updatedAt,
            updatedAt
          };
        })
    : [];
  const activeConversationId =
    typeof source.activeConversationId === "string" && conversations.some((item) => item.id === source.activeConversationId)
      ? source.activeConversationId
      : conversations[0]?.id ?? "";
  const pendingAgentExecution = sanitizePersistedPendingAgentExecution(source.pendingAgentExecution);
  const validPendingAgentExecution = pendingAgentExecution && pendingAgentExecution.conversationId === activeConversationId
    ? pendingAgentExecution
    : null;
  return {
    schemaVersion: Math.max(0, Math.floor(Number(source.schemaVersion || 0))) >= 3 ? 3 : 2,
    sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || 0))),
    canvasRevision: Math.max(0, Math.floor(Number(source.canvasRevision || 0))),
    nodeSequence: Math.max(
      Math.max(0, Math.floor(Number(source.nodeSequence || 0))),
      ...artifactNodes.flatMap((node) => [persistedNodeSequenceFromCode(node.displayCode), persistedNodeSequenceFromCode(node.id)])
    ),
    messages: repairSessionMessageAssetIds(source.messages, assetIdentity.resolve),
    conversations,
    activeConversationId,
    nodes: artifactNodes,
    layoutGroups,
    selectedNodeId,
    pendingAgentExecution: validPendingAgentExecution
  };
}

function messageHasSessionContent(message) {
  if (!message || typeof message !== "object" || message.hidden) return false;
  return Boolean(String(message.content || "").trim() || message.toolTrace);
}

function sessionHasContent(session) {
  const source = sanitizeSession(session);
  if (source.nodes.length > 0) return true;
  if (source.messages.some(messageHasSessionContent)) return true;
  return source.conversations.some((conversation) => Array.isArray(conversation.messages) && conversation.messages.some(messageHasSessionContent));
}

function hydrateSessionAssets(session) {
  return sanitizeSession(session);
}

function ensureProjectFiles(project, session = defaultSession) {
  if (!project?.path || !project?.sessionPath) return;
  mkdirSync(project.path, { recursive: true });
  mkdirSync(path.dirname(project.sessionPath), { recursive: true });
  if (!existsSync(project.sessionPath)) writeJson(project.sessionPath, session);
  if (!existsSync(projectManifestPath(project))) {
    writeProjectManifest(project, existsSync(project.sessionPath) ? readJson(project.sessionPath, session) : session);
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
  ipcMain.handle("iiimage:config:load-settings", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("config load settings");
    return { ok: true, path: settingsPath, settings: publicSettings(settings) };
  });

  ipcMain.handle("iiimage:config:save-settings", (_event, settings) => {
    const current = migrateSettings(readJson(settingsPath, defaultSettings));
    const incomingSessionCookie = typeof settings?.serverSessionCookie === "string" ? settings.serverSessionCookie.trim() : "";
    const incomingServerUserId = typeof settings?.serverUserId === "string" ? settings.serverUserId.trim() : "";
    const next = migrateSettings({
      ...current,
      ...(settings || {}),
      serverSessionCookie: incomingSessionCookie || current.serverSessionCookie,
      serverUserId: incomingServerUserId || current.serverUserId
    });
    writeJson(settingsPath, next);
    log("config save settings");
    return { ok: true, path: settingsPath };
  });

  desktopUpdater.registerIpc(ipcMain);

  ipcMain.handle("iiimage:config:load-session", () => {
    const list = readProjectList();
    const activeProject = getActiveProject(list);
    const activeSessionPath = activeProject?.sessionPath || sessionPath;
    if (activeProject) ensureProjectFiles(activeProject, readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
    const session = activeProject ? projectSessionFromDisk(activeProject) : hydrateSessionAssets(readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
    if (activeProject) {
      writeJson(activeSessionPath, sessionForProjectSave(session, activeProject));
      writeProjectManifest(activeProject, session);
    }
    log("config load session");
    return { ok: true, path: activeSessionPath, project: activeProject, projects: list.projects, activeProjectId: list.activeProjectId, session };
  });

  ipcMain.handle("iiimage:config:save-session", async (_event, session) => {
    const list = readProjectList();
    const requestedProjectId = typeof session?.projectId === "string" ? session.projectId.trim() : "";
    const targetProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    if (requestedProjectId && !targetProject) {
      return { ok: false, error: "保存目标项目不存在或已被移除。", appliedRevision: 0, skippedStale: false };
    }
    const activeSessionPath = targetProject?.sessionPath || sessionPath;
    const requestedRevision = session?.revision ?? session?.sessionRevision;
    const saveResult = await projectSessionSaveCoordinator.enqueue(targetProject?.id || "__global__", requestedRevision, async (appliedRevision) => {
      const nextInput = { ...defaultSession, ...session, sessionRevision: appliedRevision };
      delete nextInput.revision;
      delete nextInput.projectId;
      const next = targetProject ? sessionForProjectSave(nextInput, targetProject) : sanitizeSession(nextInput);
      const existingRaw = readJson(activeSessionPath, defaultSession);
      if (targetProject && !sessionHasContent(next) && sessionHasContent(existingRaw)) {
        log(`config save session skipped empty overwrite ${targetProject.id}`);
        return { ok: true, path: activeSessionPath, skipped: true, applied: false, reason: "empty-session-overwrite" };
      }
      writeJson(activeSessionPath, next);
      if (targetProject?.id === "default" && activeSessionPath !== sessionPath) writeJson(sessionPath, next);
      if (targetProject) writeProjectManifest(targetProject, next);
      if (targetProject) {
        targetProject.updatedAt = new Date().toISOString();
        const latestList = readProjectList();
        writeProjectList({ ...latestList, projects: latestList.projects.map((item) => (item.id === targetProject.id ? targetProject : item)) });
      }
      log(`config save session project=${targetProject?.id || "global"} revision=${appliedRevision}`);
      return { ok: true, path: activeSessionPath, applied: true };
    });
    return { ...saveResult, path: saveResult.path || activeSessionPath };
  });

  ipcMain.handle("iiimage:agent:tools", () => {
    try {
      const settings = currentAgentSettings();
      return { ok: true, tools: getAgentRuntime().getToolSchemas(settings) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent tools failed ${message}`);
      return { ok: false, error: message, tools: [] };
    }
  });

  ipcMain.handle("iiimage:agent:list-models", async (_event, payload = {}) => {
    const provider = payload?.provider === "image" ? "image" : "agent";
    try {
      return await listAgentModels(provider, payload?.settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent list models fallback ${message}`);
      try {
        return await getAgentRuntime().listModels({ ...(payload || {}), provider, settings: currentAgentSettings() });
      } catch (fallbackError) {
        return {
          ok: false,
          provider,
          models: [],
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        };
      }
    }
  });

  ipcMain.handle("iiimage:agent:run-tool", async (event, payload = {}) => {
    const name = String(payload?.name || "").trim();
    const runId = String(payload?.runId || `agent-tool-${Date.now()}`);
    if (!name) return { envelope: { ok: false, summary: "缺少工具名称。", error: "missing tool name" }, actions: [] };
    if (name !== "image_gen" && !aidebugMode) {
      return {
        envelope: {
          ok: false,
          tool: name,
          summary: "当前工作台只允许执行图片生成与修改。",
          error: "unsupported public agent tool"
        },
        actions: []
      };
    }
    try {
      const settings = currentAgentSettings();
      const result = await getAgentRuntime().runTool(name, payload?.input ?? {}, {
        settings,
         nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
         selectedNodeId: payload?.selectedNodeId,
         selectedNodeIds: Array.isArray(payload?.selectedNodeIds) ? payload.selectedNodeIds : [],
         taskScope: payload?.taskScope && typeof payload.taskScope === "object" ? payload.taskScope : undefined,
         referenceImages: Array.isArray(payload?.referenceImages) ? payload.referenceImages : [],
        projectId: payload?.projectId,
        conversationId: payload?.conversationId,
        prompt: String(payload?.prompt || payload?.input?.prompt || ""),
        runId,
        operationId: runId,
        toolRunId: runId,
        progress: (progressPayload) => emitAgentProgress(event.sender, runId, progressPayload, payload)
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent run tool failed ${name} ${message}`);
      emitAgentProgress(event.sender, runId, { phase: "tool-error", tool: name, summary: message }, payload);
      return { envelope: { ok: false, tool: name, summary: message, error: message }, actions: [] };
    }
  });

  ipcMain.handle("iiimage:agent:compose-image-prompt", async (event, payload = {}) => {
    const runId = String(payload?.runId || `agent-compose-${Date.now()}`);
    try {
      return await getAgentRuntime().composeImagePrompt({
        ...(payload || {}),
        settings: currentAgentSettings(),
        runId,
        progress: (progressPayload) => emitAgentProgress(event.sender, runId, progressPayload, payload)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent compose image prompt failed ${message}`);
      emitAgentProgress(event.sender, runId, { phase: "runtime-error", tool: "image_gen", summary: message }, payload);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("iiimage:agent:chat", async (event, payload = {}) => {
    const runId = String(payload?.runId || `agent-chat-${Date.now()}`);
    try {
      const result = await getAgentRuntime().chat({
        ...(payload || {}),
        settings: currentAgentSettings(),
        runId,
        progress: (progressPayload) => emitAgentProgress(event.sender, runId, progressPayload, payload)
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`agent chat failed ${message}`);
      emitAgentProgress(event.sender, runId, { phase: "runtime-error", summary: message }, payload);
      return { ok: false, error: message, content: "" };
    }
  });

  ipcMain.handle("iiimage:agent:compact", (_event, payload = {}) => {
    try {
      return getAgentRuntime().compact(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:memory-check", (_event, payload = {}) => {
    try {
      return getAgentRuntime().memoryCheck(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:memory-read", (_event, payload = {}) => {
    try {
      return getAgentRuntime().memoryRead(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:main-prompt:get", () => {
    try {
      return getAgentRuntime().getMainPrompt();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:main-prompt:save", (_event, payload = {}) => {
    try {
      return getAgentRuntime().saveMainPrompt(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:main-prompt:reset", () => {
    try {
      return getAgentRuntime().resetMainPrompt();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:fast-memory:get", (_event, payload = {}) => {
    try {
      return getAgentRuntime().getFastMemory(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:fast-memory:save", (_event, payload = {}) => {
    try {
      return getAgentRuntime().saveFastMemory(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:fast-memory:reset", (_event, payload = {}) => {
    try {
      return getAgentRuntime().resetFastMemory(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:clear-conversation", (_event, payload = {}) => {
    try {
      return getAgentRuntime().clearConversationState(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:smoke", () => {
    try {
      return getAgentRuntime().smokeTest();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:agent:cancel-pending-execution", (_event, payload = {}) => {
    try {
      return getAgentRuntime().cancelPendingExecutionState(payload ?? {});
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:window:new", () => {
    createWindow();
    log("window new");
    return { ok: true };
  });

  ipcMain.handle("iiimage:window:control", (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "窗口不可用。" };
    const action = String((payload ?? {}).action || "");
    if (action === "minimize") {
      win.minimize();
      return { ok: true, action, maximized: win.isMaximized() };
    }
    if (action === "toggle-maximize") {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return { ok: true, action, maximized: win.isMaximized() };
    }
    if (action === "close") {
      win.close();
      return { ok: true, action };
    }
    if (action === "state") {
      return { ok: true, action, maximized: win.isMaximized(), minimized: win.isMinimized() };
    }
    return { ok: false, error: `未知窗口操作：${action}` };
  });

  ipcMain.handle("iiimage:debug:window-bounds", (event, payload = {}) => {
    if (!aidebugMode) return { ok: false, error: "仅 AIDebug 模式允许控制测试窗口。" };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return { ok: false, error: "GUI 窗口不可用。" };
    const width = Math.round(Number(payload?.width || 0));
    const height = Math.round(Number(payload?.height || 0));
    if (width > 0 && height > 0) {
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      const beforeBounds = win.getBounds();
      const beforeContentBounds = win.getContentBounds();
      const frameWidth = Math.max(0, beforeBounds.width - beforeContentBounds.width);
      const frameHeight = Math.max(0, beforeBounds.height - beforeContentBounds.height);
      const display = screen.getDisplayMatching(beforeBounds);
      const workArea = display?.workArea ?? { x: 0, y: 0, width, height };
      const targetWidth = Math.max(1, Math.min(width, Math.max(1, workArea.width - frameWidth)));
      const targetHeight = Math.max(1, Math.min(height, Math.max(1, workArea.height - frameHeight)));
      win.setContentSize(targetWidth, targetHeight, false);
      const resizedBounds = win.getBounds();
      const nextX = Math.min(
        Math.max(resizedBounds.x, workArea.x),
        Math.max(workArea.x, workArea.x + workArea.width - resizedBounds.width)
      );
      const nextY = Math.min(
        Math.max(resizedBounds.y, workArea.y),
        Math.max(workArea.y, workArea.y + workArea.height - resizedBounds.height)
      );
      if (nextX !== resizedBounds.x || nextY !== resizedBounds.y) win.setPosition(nextX, nextY, false);
    }
    return {
      ok: true,
      bounds: win.getBounds(),
      contentBounds: win.getContentBounds(),
      maximized: win.isMaximized(),
      minimized: win.isMinimized()
    };
  });

  ipcMain.handle("iiimage:debug:capture-gui", async (event, payload = {}) => {
    if (!aidebugMode) return { ok: false, error: "仅 AIDebug 模式允许捕获测试窗口。" };
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) throw new Error("GUI 窗口不可用。");
      mkdirSync(debugDir, { recursive: true });
      const label = sanitizeFileStem(payload?.label || "gui", "gui");
      let image = null;
      let sourceKind = "page";
      if (payload?.scope !== "page") {
        try {
          const bounds = win.getBounds();
          const display = screen.getDisplayMatching(bounds);
          const scaleFactor = Number(display?.scaleFactor || 1);
          const thumbnailSize = {
            width: Math.max(1, Math.round(bounds.width * scaleFactor)),
            height: Math.max(1, Math.round(bounds.height * scaleFactor))
          };
          const mediaSourceId = typeof win.getMediaSourceId === "function" ? win.getMediaSourceId() : "";
          const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize, fetchWindowIcons: false });
          const title = win.getTitle();
          const windowSource =
            sources.find((source) => source.id === mediaSourceId) ??
            sources.find((source) => source.name === title) ??
            sources.find((source) => source.name.includes(title) || title.includes(source.name));
          if (windowSource && !windowSource.thumbnail.isEmpty()) {
            image = windowSource.thumbnail;
            sourceKind = "window";
          }
        } catch (error) {
          log(`debug capture window fallback: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!image) image = await win.capturePage();
      const size = image.getSize();
      const filePath = path.join(debugDir, `${label}-${Date.now()}.png`);
      writeFileSync(filePath, image.toPNG());
      log(`debug capture gui ${sourceKind} ${filePath}`);
      return { ok: true, path: filePath, width: size.width, height: size.height, source: sourceKind };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:project:list", () => {
    const list = readProjectList();
    return { ok: true, ...list };
  });

  ipcMain.handle("iiimage:project:create", (_event, payload) => {
    const list = readProjectList();
    const record = createProjectRecord(payload?.name || `画布 ${list.projects.length + 1}`);
    ensureProjectFiles(record, defaultSession);
    const next = writeProjectList({ activeProjectId: record.id, projects: [record, ...list.projects] });
    log(`project create ${record.id}`);
    return { ok: true, project: record, projects: next.projects, activeProjectId: next.activeProjectId, session: defaultSession };
  });

  ipcMain.handle("iiimage:project:create-folder", async (_event, payload) => {
    const result = await dialog.showOpenDialog({
      title: "选择新项目保存位置",
      buttonLabel: "在这里创建",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    const list = readProjectList();
    const projectName = safeName(payload?.name, `项目 ${list.projects.length + 1}`);
    const selectedPath = nextExternalProjectFolderPath(result.filePaths[0], projectName, list);
    const record = createProjectRecord(projectName, selectedPath);
    list.projects.unshift(record);
    ensureProjectFiles(record, defaultSession);
    const next = writeProjectList({ ...list, activeProjectId: record.id });
    const session = projectSessionFromDisk(record);
    log(`project create folder ${selectedPath}`);
    return { ok: true, path: selectedPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  });

  ipcMain.handle("iiimage:project:switch", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    ensureProjectFiles(project, defaultSession);
    const next = writeProjectList({ ...list, activeProjectId: id });
    const session = projectSessionFromDisk(project);
    writeJson(project.sessionPath, sessionForProjectSave(session, project));
    writeProjectManifest(project, session);
    log(`project switch ${id}`);
    return { ok: true, project, projects: next.projects, activeProjectId: id, session };
  });

  ipcMain.handle("iiimage:project:rename", (_event, payload) => {
    const id = String(payload?.id || "");
    const name = safeName(payload?.name, "");
    if (!id || !name) return { ok: false, error: "画布名称不能为空。" };
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };

    const renamed = { ...project, name, updatedAt: new Date().toISOString() };
    const next = writeProjectList({
      ...list,
      projects: list.projects.map((item) => (item.id === id ? renamed : item))
    });
    ensureProjectFiles(renamed, defaultSession);
    const session = projectSessionFromDisk(renamed);
    writeJson(renamed.sessionPath, sessionForProjectSave(session, renamed));
    writeProjectManifest(renamed, session);
    log(`project rename ${id}`);
    return { ok: true, project: renamed, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });

  ipcMain.handle("iiimage:project:open", async () => {
    const result = await dialog.showOpenDialog({
      title: "打开 iiimage 画布",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      log("project open canceled");
      return { ok: true, canceled: true };
    }
    let selectedPath = result.filePaths[0];
    const list = readProjectList();
    let record = list.projects.find((item) => path.resolve(item.path) === path.resolve(selectedPath));
    if (!record) {
      record = createProjectRecord(path.basename(selectedPath), selectedPath);
      ensureProjectFiles(record, defaultSession);
      list.projects.unshift(record);
    }
    const next = writeProjectList({ ...list, activeProjectId: record.id });
    ensureProjectFiles(record, defaultSession);
    const session = projectSessionFromDisk(record);
    writeJson(record.sessionPath, sessionForProjectSave(session, record));
    writeProjectManifest(record, session);
    log(`project open ${selectedPath}`);
    return { ok: true, path: selectedPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  });

  ipcMain.handle("iiimage:project:export", async () => {
    const list = readProjectList();
    const project = getActiveProject(list);
    if (!project) return { ok: false, error: "当前没有可导出的画布。" };
    const result = await dialog.showSaveDialog({
      title: "导出 iiimage 画布",
      defaultPath: path.join(project.path || desktopRoot, `${safeName(project.name, "iiimage画布")}.iiimage`),
      filters: [{ name: "IIimage Project", extensions: ["iiimage"] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const packageData = packageProject(project);
    writeProjectPackageFile(result.filePath, packageData);
    writeProjectManifest(project, packageData.session);
    log(`project export ${result.filePath}`);
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle("iiimage:project:import", async () => {
    const open = await dialog.showOpenDialog({
      title: "导入 iiimage 画布",
      properties: ["openFile"],
      filters: [{ name: "IIimage Project", extensions: ["iiimage", "json"] }]
    });
    if (open.canceled || open.filePaths.length === 0) return { ok: true, canceled: true };
    const sourceFile = open.filePaths[0];
    const packageBuffer = boundedImageRead(sourceFile, projectPackageMaximumFileBytes, path.basename(sourceFile), "项目文件");
    let packageData;
    try {
      packageData = JSON.parse(packageBuffer.toString("utf8"));
    } catch {
      throw projectPackageFailure("IIIMAGE_PROJECT_PACKAGE_INVALID", "画布项目包不是有效的 JSON 文件。");
    }
    validateProjectPackageData(packageData);
    const target = await dialog.showOpenDialog({
      title: "选择导入画布的父目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (target.canceled || target.filePaths.length === 0) return { ok: true, canceled: true };
    const list = readProjectList();
    const targetPath = nextExternalProjectFolderPath(
      target.filePaths[0],
      safeName(packageData?.project?.name || path.basename(sourceFile, path.extname(sourceFile)), "导入画布"),
      list
    );
    const { record, session } = importProjectPackage(packageData, targetPath);
    const withoutSamePath = list.projects.filter((item) => path.resolve(item.path) !== path.resolve(record.path));
    const next = writeProjectList({ activeProjectId: record.id, projects: [record, ...withoutSamePath] });
    log(`project import ${sourceFile} -> ${targetPath}`);
    return { ok: true, path: targetPath, project: record, projects: next.projects, activeProjectId: record.id, session };
  });

  ipcMain.handle("iiimage:project:open-current-folder", async (_event, payload) => {
    const list = readProjectList();
    const requestedProjectId = String(payload?.id || "").trim();
    const project = projectForFolderOpen(list, requestedProjectId);
    if (requestedProjectId && !project) return { ok: false, error: "当前项目不存在或已经被移除。" };
    if (!project?.path) return { ok: false, error: "当前没有可打开的画布文件夹。" };
    if (!existsSync(project.path)) {
      if (project.external) return { ok: false, error: "当前外部画布文件夹不存在或已被移除。" };
      mkdirSync(project.path, { recursive: true });
    }
    const error = await shell.openPath(project.path);
    if (error) return { ok: false, error };
    log(`project folder open ${project.path}`);
    return { ok: true, path: project.path, projectId: project.id };
  });

  ipcMain.handle("iiimage:project:delete", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    if (project.id === "default") return { ok: false, error: "默认项目不能删除，可以创建或打开其他项目后切换使用。" };

    const remaining = list.projects.filter((item) => item.id !== id);
    if (!remaining.length) return { ok: false, error: "至少需要保留一个画布。" };
    const activeProjectId = list.activeProjectId === id ? remaining[0].id : list.activeProjectId;
    const next = writeProjectList({ activeProjectId, projects: remaining });
    const activeProject = getActiveProject(next);
    ensureProjectFiles(activeProject, defaultSession);
    const session = projectSessionFromDisk(activeProject);
    log(`project remove ${id}`);
    return { ok: true, project: activeProject, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });

  ipcMain.handle("iiimage:project:delete-folder", (_event, payload) => {
    const id = String(payload?.id || "");
    const list = readProjectList();
    const project = list.projects.find((item) => item.id === id);
    if (!project) return { ok: false, error: "画布不存在或已被移除。" };
    if (project.id === "default") return { ok: false, error: "默认项目文件夹不能删除。" };

    const projectPath = path.resolve(project.path || "");
    const protectedPaths = new Set([path.resolve(projectRoot), path.resolve(desktopRoot), path.resolve(configDir), path.resolve(projectsDir)]);
    if (!projectPath || protectedPaths.has(projectPath)) return { ok: false, error: "画布路径受保护，已取消删除。" };
    if (project.external || !isPathInside(projectPath, projectsDir)) {
      return { ok: false, error: "外部画布文件夹不会被 iiimage 删除。可以使用“移除”从画布列表移除，磁盘文件请在系统文件管理器中处理。" };
    }
    if (existsSync(projectPath)) {
      rmSync(projectPath, { recursive: true, force: true });
    }

    const remaining = list.projects.filter((item) => item.id !== id);
    if (!remaining.length) return { ok: false, error: "至少需要保留一个画布。" };
    const activeProjectId = list.activeProjectId === id ? remaining[0].id : list.activeProjectId;
    const next = writeProjectList({ activeProjectId, projects: remaining });
    const activeProject = getActiveProject(next);
    ensureProjectFiles(activeProject, defaultSession);
    const session = projectSessionFromDisk(activeProject);
    log(`project delete folder ${id}`);
    return { ok: true, project: activeProject, projects: next.projects, activeProjectId: next.activeProjectId, session };
  });

  ipcMain.handle("iiimage:asset:pick-local-images", async (_event, payload = {}) => {
    try {
      const maxFiles = Math.max(1, Math.min(Number(payload.maxFiles ?? 2000), 2000));
      const result = await dialog.showOpenDialog({
        title: "导入图片到画布",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true, assets: [] };
      const imported = await importLocalImagesToProject({ paths: result.filePaths, projectId: payload.projectId, maxFiles });
      return {
        ok: true,
        ...imported,
        selectedCount: result.filePaths.length,
        truncated: result.filePaths.length > maxFiles || imported.truncated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset pick local images failed ${message}`);
      return { ok: false, assets: [], errorCode: error?.code || "IMAGE_PICK_FAILED", error: message };
    }
  });

  async function pickReferenceImages(payload = {}) {
    const max = Math.max(1, Math.min(Number(payload.max ?? 9), 200));
    const result = await dialog.showOpenDialog({
      title: String(payload.title || "选择参考图").slice(0, 80),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    const imported = await importLocalImagesToProject({ paths: result.filePaths, projectId: payload.projectId, maxFiles: max });
    const images = imported.assets.map((asset) => ({
      occurrenceId: asset.occurrenceId,
      importBatchId: asset.importBatchId,
      importRootId: asset.importRootId,
      sourceRelativePath: asset.sourceRelativePath,
      sourceRootLabel: asset.sourceRootLabel,
      sourceRootKind: asset.sourceRootKind,
      contentHash: asset.contentHash || asset.sha256,
      name: asset.originalName || path.basename(asset.path || "reference.png"),
      path: asset.path,
      relativePath: asset.relativePath,
      mimeType: mimeTypeForPath(asset.path),
      assetUrl: asset.assetUrl
    }));
    return {
      ok: true,
      images,
      image: images[0],
      truncated: result.filePaths.length > max || imported.truncated,
      selectedCount: result.filePaths.length
    };
  }

  ipcMain.handle("iiimage:asset:pick-reference-images", async (_event, payload) => pickReferenceImages(payload ?? {}));

  ipcMain.handle("iiimage:asset:pick-reference-image", async () => {
    const result = await pickReferenceImages({ max: 1 });
    return { ...result, images: result.images?.slice(0, 1) };
  });

  ipcMain.handle("iiimage:asset:open-folder", async (_event, payload) => {
    const resolved = resolveOutputAsset((payload ?? {}).path);
    if (!resolved) {
      log("asset open folder denied");
      return { ok: false, error: "图片不在 IIimage output 目录内。" };
    }
    if (!existsSync(resolved)) {
      log(`asset open folder missing ${resolved}`);
      return { ok: false, error: "图片文件不存在。" };
    }
    shell.showItemInFolder(resolved);
    log(`asset open folder ${resolved}`);
    return { ok: true };
  });

  ipcMain.handle("iiimage:asset:read-data-url", async (_event, payload) => {
    try {
      const rawPath = (payload ?? {}).path;
      if (!rawPath || typeof rawPath !== "string") return { ok: false, error: "图片路径无效。" };
      const resolved = path.resolve(rawPath);
      if (!isAllowedAssetPath(resolved)) {
        log(`asset read data url denied ${resolved}`);
        return { ok: false, error: "图片不在 IIimage 可读取资产目录内。" };
      }
      if (!existsSync(resolved)) {
        log(`asset read data url missing ${resolved}`);
        return { ok: false, error: "图片文件不存在。" };
      }
      const mimeType = mimeTypeForPath(resolved);
      if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) return { ok: false, error: "只支持 PNG/JPG/WEBP 图片。" };
      const imageBuffer = boundedImageRead(resolved, maxExportImageBytes, path.basename(resolved));
      const actualFormat = validateProjectPackageImageBuffer(imageBuffer, path.basename(resolved));
      const dataUrl = `data:${actualFormat.mimeType};base64,${imageBuffer.toString("base64")}`;
      log(`asset read data url ${resolved}`);
      return {
        ok: true,
        dataUrl,
        mimeType: actualFormat.mimeType,
        name: path.basename(resolved)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset read data url failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("iiimage:asset:refine-semantic-layers", async (_event, payload = {}) => {
    try {
      const result = await refineSemanticLayers(payload ?? {});
      log(`asset semantic matting completed ${result.width}x${result.height} ${result.reports?.length || 0} report(s)`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = String(error?.code || "SEMANTIC_MATTING_FAILED");
      log(`asset semantic matting failed ${errorCode} ${message}`);
      return { ok: false, errorCode, error: message };
    }
  });

  ipcMain.handle("iiimage:asset:isolate-background", async (_event, payload = {}) => {
    try {
      const result = await refineSemanticLayers({ ...(payload || {}), mode: "background-removal" });
      log(`asset background isolation completed ${result.width}x${result.height} ${result.checkerboardDetected ? "checkerboard" : "key"}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = String(error?.code || "BACKGROUND_REMOVAL_FAILED");
      log(`asset background isolation failed ${errorCode} ${message}`);
      return { ok: false, errorCode, error: message };
    }
  });

  ipcMain.handle("iiimage:asset:thumbnail-stats", (_event, payload) => {
    try {
      const stats = payload?.reset === true ? imageThumbnailCache.resetStats() : imageThumbnailCache.stats();
      return { ok: true, stats };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("iiimage:asset:image-import-status", (_event, payload) => ({
    ok: true,
    status: imageImportStatus(payload?.reset === true)
  }));

  ipcMain.handle("iiimage:asset:cancel-image-imports", async () => {
    await recycleProjectImageImporter(true);
    return { ok: true, status: imageImportStatus(false) };
  });

  ipcMain.handle("iiimage:asset:import-local-images", async (_event, payload) => {
    try {
      return await importLocalImagesToProject(payload ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("asset batch import failed " + message);
      return { ok: false, assets: [], canceled: error?.code === "IMAGE_IMPORT_CLOSED", errorCode: error?.code || "IMAGE_IMPORT_FAILED", error: message };
    }
  });

  ipcMain.handle("iiimage:asset:import-local-image", async (_event, payload) => {
    try {
      const rawPath = (payload ?? {}).path;
      if (!rawPath || typeof rawPath !== "string") return { ok: false, error: "图片路径无效。" };
      const imported = await importLocalImagesToProject({ paths: [rawPath], projectId: (payload ?? {}).projectId, maxFiles: 1 });
      const asset = imported.assets[0];
      if (!asset) return { ok: false, error: "没有找到可导入的 PNG/JPG/WEBP 图片。" };
      log("asset import local image " + asset.path);
      return { ok: true, asset };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset import local image failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("iiimage:asset:save-output-image", async (_event, payload) => {
    try {
      const runId = String((payload ?? {}).runId || `asset-${Date.now()}`);
      const dataUrl = String((payload ?? {}).dataUrl || "");
      const identity = createHash("sha256").update(runId).update("\0").update(dataUrl).digest("hex").slice(0, 16);
      const stem = `${sanitizeFileStem((payload ?? {}).stem || "plugin").slice(0, 56)}-${identity}`;
      const asset = writeDataUrlOutput(dataUrl, stem, runId, (payload ?? {}).projectId, {
        bucket: (payload ?? {}).bucket,
        subdir: (payload ?? {}).subdir
      });
      log(`asset save output ${asset.path}`);
      return { ok: true, asset };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset save output failed ${message}`);
      return { ok: false, canceled: error?.code === "IMAGE_IMPORT_CLOSED", errorCode: error?.code || "IMAGE_IMPORT_FAILED", error: message };
    }
  });

  ipcMain.handle("iiimage:asset:save-as", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const source = await materializeManagedImageAsset(payload?.asset, context);
      transientSources.push(source);
      const defaultName = exportFileName(source, payload?.suggestedName);
      const owner = BrowserWindow.fromWebContents(event.sender);
      let selectedPath = "";
      if (aidebugMode && payload?.aidebugName) {
        selectedPath = aidebugExportFilePath(payload.aidebugName, source.extension, "aidebug-image");
      } else {
        const options = {
          title: "图片另存为",
          defaultPath: path.join(app.getPath("desktop") || desktopRoot, defaultName),
          buttonLabel: "保存",
          filters: [
            { name: source.mimeType === "image/png" ? "PNG 图片" : source.mimeType === "image/webp" ? "WEBP 图片" : "JPEG 图片", extensions: [source.extension.slice(1)] }
          ]
        };
        const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { ok: true, canceled: true };
        selectedPath = path.resolve(result.filePath);
      }
      const destinationPath = ensureMatchingExportExtension(selectedPath, source.extension);
      if (comparablePath(destinationPath) !== comparablePath(selectedPath) && existsSync(destinationPath)) {
        const confirmOptions = {
          type: "warning",
          title: "确认覆盖图片",
          message: `“${path.basename(destinationPath)}”已经存在，是否覆盖？`,
          buttons: ["覆盖", "取消"],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        };
        const confirmation = owner
          ? await dialog.showMessageBox(owner, confirmOptions)
          : await dialog.showMessageBox(confirmOptions);
        if (confirmation.response !== 0) return { ok: true, canceled: true };
      }
      if (comparablePath(destinationPath) !== comparablePath(source.path)) {
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        copyFileSync(source.path, destinationPath);
      }
      log(`asset save as project=${context.project.id} format=${source.extension} bytes=${source.size}`);
      return { ok: true, path: destinationPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset save as failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseTransientExportSources(transientSources, context);
    }
  });

  ipcMain.handle("iiimage:asset:export-folder", async (event, payload = {}) => {
    let stagingPath = "";
    let selectedParent = "";
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const rawItems = Array.isArray(payload?.assets) ? payload.assets : [];
      if (rawItems.length <= 0) return { ok: false, error: "没有可导出的图片或图层。" };
      if (rawItems.length > maxFolderExportAssets) return { ok: false, error: `单次最多导出 ${maxFolderExportAssets} 张图片。` };
      const items = rawItems
        .map(normalizedExportItem)
        .filter(Boolean)
        .sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);
      if (items.length <= 0) return { ok: false, error: "没有可导出的有效图片或图层。" };

      const group = exportGroupMetadata(payload?.group);
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (aidebugMode && payload?.aidebugName) {
        selectedParent = aidebugAssetExportRoot();
      } else {
        const options = {
          title: "选择图层文件夹的保存位置",
          buttonLabel: "导出到此处",
          properties: ["openDirectory", "createDirectory"]
        };
        const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
        if (selected.canceled || !selected.filePaths[0]) return { ok: true, canceled: true };
        selectedParent = realpathSync(selected.filePaths[0]);
      }

      const materializedItems = [];
      for (const item of items) {
        const source = await materializeManagedImageAsset(item.asset, context);
        transientSources.push(source);
        materializedItems.push({ ...item, source });
      }
      const previewSource = payload?.previewAsset
        ? await materializeManagedImageAsset(payload.previewAsset, context)
        : null;
      if (previewSource) transientSources.push(previewSource);
      const mergedSource = payload?.mergedAsset
        ? await materializeManagedImageAsset(payload.mergedAsset, context)
        : null;
      if (mergedSource) transientSources.push(mergedSource);

      const defaultFolderName = group.title ? `${group.title}-图层` : "iiimage-分层图片";
      const folderName = safeExportStem(payload?.aidebugName || payload?.folderName || defaultFolderName, "iiimage-分层图片");
      const targetPath = uniqueExportPath(selectedParent, folderName);
      stagingPath = path.join(selectedParent, `.iiimage-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
      if (!isComparablePathInside(stagingPath, selectedParent)) throw new Error("导出暂存目录无效。");
      mkdirSync(stagingPath, { recursive: false });

      const relativeFiles = [];
      let previewFileName = "";
      let mergedFileName = "";
      if (previewSource) {
        previewFileName = `00-合成预览${previewSource.extension}`;
        copyFileSync(previewSource.path, path.join(stagingPath, previewFileName));
        relativeFiles.push(previewFileName);
      }

      const orderWidth = Math.max(2, String(Math.max(...materializedItems.map((item) => item.order))).length);
      const manifestLayers = [];
      for (const item of materializedItems) {
        const orderLabel = String(item.order).padStart(orderWidth, "0");
        const desiredName = `${orderLabel}-${safeExportStem(item.title, `图层-${orderLabel}`)}${item.source.extension}`;
        const targetFile = uniqueExportPath(stagingPath, desiredName);
        copyFileSync(item.source.path, targetFile);
        const fileName = path.basename(targetFile);
        relativeFiles.push(fileName);
        manifestLayers.push({
          order: item.order,
          title: item.title,
          role: item.role,
          fileName,
          visible: item.visible,
          opacity: item.opacity,
          blendMode: item.blendMode,
          width: Number(item.asset.width) || group.width,
          height: Number(item.asset.height) || group.height
        });
      }

      if (mergedSource) {
        mergedFileName = `99-合成${mergedSource.extension}`;
        const mergedTarget = uniqueExportPath(stagingPath, mergedFileName);
        copyFileSync(mergedSource.path, mergedTarget);
        mergedFileName = path.basename(mergedTarget);
        relativeFiles.push(mergedFileName);
      }

      const manifest = {
        format: "iiimage-layer-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        group,
        composite: {
          previewFileName: previewFileName || undefined,
          mergedFileName: mergedFileName || undefined
        },
        layers: manifestLayers
      };
      writeJson(path.join(stagingPath, "layers.json"), manifest);
      relativeFiles.push("layers.json");
      renameSync(stagingPath, targetPath);
      stagingPath = "";
      const files = relativeFiles.map((fileName) => path.join(targetPath, fileName));
      log(`asset export folder project=${context.project.id} layers=${manifestLayers.length} preview=${Boolean(previewSource)} merged=${Boolean(mergedSource)}`);
      return { ok: true, path: targetPath, files, count: manifestLayers.length };
    } catch (error) {
      if (stagingPath && selectedParent) removeExportStagingFolder(stagingPath, selectedParent);
      const message = error instanceof Error ? error.message : String(error);
      log(`asset export folder failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseTransientExportSources(transientSources, context);
    }
  });

  ipcMain.handle("iiimage:asset:export-psd", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const asset = normalizedExportAsset(payload?.asset);
      if (!asset) return { ok: false, error: "没有可导出的图片。" };
      const assetIndex = Math.max(0, Math.floor(Number(payload?.assetIndex ?? 0) || 0));
      const nodeTitle = safeExportStem(payload?.nodeTitle || asset.title || "图片成果", "图片成果");
      const layerName = `${nodeTitle}｜图片 ${assetIndex + 1}`.slice(0, 255);
      const defaultStem = safeExportStem(payload?.suggestedName || `${nodeTitle}-图片-${assetIndex + 1}`, "iiimage-图片成果");
      const owner = BrowserWindow.fromWebContents(event.sender);
      let selectedPath = "";
      if (aidebugMode && payload?.aidebugCancelBeforeMaterialize) return { ok: true, canceled: true };
      if (aidebugMode && payload?.aidebugName) {
        selectedPath = aidebugExportFilePath(payload.aidebugName, ".psd", "aidebug-image-psd");
      } else {
        const options = {
          title: "导出 Photoshop PSD",
          defaultPath: path.join(app.getPath("desktop") || desktopRoot, `${defaultStem}.psd`),
          buttonLabel: "导出 PSD",
          filters: [{ name: "Adobe Photoshop 文档", extensions: ["psd"] }]
        };
        const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (selected.canceled || !selected.filePath) return { ok: true, canceled: true };
        selectedPath = path.resolve(selected.filePath);
      }

      const outputPath = path.extname(selectedPath).toLowerCase() === ".psd" ? selectedPath : `${selectedPath}.psd`;
      const source = await materializeManagedImageAsset(asset, context);
      transientSources.push(source);
      let psdSource = source;
      if (source.extension !== ".png") {
        const prepared = await preparePsdRasterSource({
          sourcePath: source.path,
          cacheDir: secureExportSourceCacheDir(context),
          ownerPid: process.pid
        });
        psdSource = { ...source, ...prepared, extension: ".png", mimeType: "image/png", transient: true };
        retainTransientExportSource(psdSource.path);
        transientSources.push(psdSource);
      }
      const exportResult = await exportLayeredPsd({
        outputPath,
        width: Number(asset.width) || Number(psdSource.width) || undefined,
        height: Number(asset.height) || Number(psdSource.height) || undefined,
        overwrite: true,
        layers: [{ name: layerName, path: psdSource.path }],
        onProgress: (progress) => {
          if (progress?.stage === "complete" || progress?.stage === "verify") {
            log(`asset single psd export ${progress.stage} ${progress.completed || 0}/${progress.total || 1}`);
          }
        }
      });
      log(`asset single psd export project=${context.project.id} assetIndex=${assetIndex} source=${source.extension} bytes=${exportResult.bytes || 0}`);
      return {
        ok: true,
        path: outputPath,
        files: [outputPath],
        count: 1,
        width: exportResult.width,
        height: exportResult.height,
        layerNames: exportResult.layerNames
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset single psd export failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseTransientExportSources(transientSources, context);
    }
  });

  ipcMain.handle("iiimage:asset:export-layer-psd", async (event, payload = {}) => {
    let context = null;
    const transientSources = [];
    try {
      context = createAssetExportContext(payload?.projectId);
      const rawItems = Array.isArray(payload?.assets) ? payload.assets : [];
      if (rawItems.length <= 0) return { ok: false, error: "没有可导出的 PNG 图层。" };
      if (rawItems.length > 64) return { ok: false, error: "单个 PSD 最多导出 64 个图层。请拆分图层组后重试。" };
      const items = rawItems
        .map(normalizedExportItem)
        .filter(Boolean)
        .sort((left, right) => right.order - left.order || right.sourceIndex - left.sourceIndex);
      if (items.length <= 0) return { ok: false, error: "没有可导出的有效 PNG 图层。" };
      const unsupportedBlend = items.find((item) => item.blendMode !== "normal" && item.blendMode !== "source-over");
      if (unsupportedBlend) {
        return {
          ok: false,
          error: `图层“${unsupportedBlend.title}”使用了 ${unsupportedBlend.blendMode} 混合模式。当前 PSD 导出不会静默改成普通模式，请先改为“正常”后再导出。`
        };
      }

      const group = exportGroupMetadata(payload?.group);
      const defaultStem = safeExportStem(
        payload?.suggestedName || (group.title ? `${group.title}-${String(group.groupNumber || 1).padStart(3, "0")}` : "iiimage-分层作品"),
        "iiimage-分层作品"
      );
      const owner = BrowserWindow.fromWebContents(event.sender);
      let selectedPath = "";
      if (aidebugMode && payload?.aidebugName) {
        selectedPath = aidebugExportFilePath(payload.aidebugName, ".psd", "aidebug-layers");
      } else {
        const options = {
          title: "导出 Photoshop PSD",
          defaultPath: path.join(app.getPath("desktop") || desktopRoot, `${defaultStem}.psd`),
          buttonLabel: "导出 PSD",
          filters: [{ name: "Adobe Photoshop 文档", extensions: ["psd"] }]
        };
        const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (selected.canceled || !selected.filePath) return { ok: true, canceled: true };
        selectedPath = path.resolve(selected.filePath);
      }
      const outputPath = path.extname(selectedPath).toLowerCase() === ".psd" ? selectedPath : `${selectedPath}.psd`;
      if (comparablePath(outputPath) !== comparablePath(selectedPath) && existsSync(outputPath)) {
        const confirmationOptions = {
          type: "warning",
          title: "确认覆盖 PSD",
          message: `“${path.basename(outputPath)}”已经存在，是否覆盖？`,
          buttons: ["覆盖", "取消"],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        };
        const confirmation = owner
          ? await dialog.showMessageBox(owner, confirmationOptions)
          : await dialog.showMessageBox(confirmationOptions);
        if (confirmation.response !== 0) return { ok: true, canceled: true };
      }

      const materializedItems = [];
      for (const item of items) {
        const source = await materializeManagedImageAsset(item.asset, context);
        transientSources.push(source);
        if (source.extension !== ".png") {
          throw new Error(`图层“${item.title}”不是 PNG。分层 PSD 只接受保留透明通道的 PNG 图层。`);
        }
        materializedItems.push({ ...item, source });
      }

      const exportResult = await exportLayeredPsd({
        outputPath,
        width: group.width,
        height: group.height,
        overwrite: true,
        layers: materializedItems.map((item) => ({
          name: item.title,
          path: item.source.path,
          visible: item.visible,
          opacity: item.opacity
        })),
        onProgress: (progress) => {
          if (progress?.stage === "complete" || progress?.stage === "verify") {
            log(`asset psd export ${progress.stage} ${progress.completed || 0}/${progress.total || materializedItems.length}`);
          }
        }
      });
      log(`asset psd export project=${context.project.id} layers=${materializedItems.length} bytes=${exportResult.bytes || 0}`);
      return { ok: true, path: outputPath, files: [outputPath], count: materializedItems.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`asset psd export failed ${message}`);
      return { ok: false, error: message };
    } finally {
      releaseTransientExportSources(transientSources, context);
    }
  });

  ipcMain.handle("iiimage:server:register", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      const username = String((payload ?? {}).username ?? (payload ?? {}).email ?? "").trim();
      const password = String((payload ?? {}).password ?? "");
      if (!username || !password) throw new Error("请输入用户名和密码。");
      if (aidebugMode && !aidebugLiveImage) {
        if (/error|invalid|wrong/i.test(username)) throw new Error("AIDebug 注册失败示例：用户名不可用。");
        if (aidebugStatefulAuth) aidebugAuthenticated = true;
        return {
          ok: true,
          user: { ...aidebugUser(), username, account: username, name: String((payload ?? {}).name || username) },
          wallet: aidebugWallet(),
          settings: aidebugPublicSettings
        };
      }
      await newApiRequest(settings, "/api/user/register", {
        method: "POST",
        body: {
          username,
          password,
          email: (payload ?? {}).email,
          display_name: (payload ?? {}).name || username
        }
      });
      const result = await completeNewApiLogin(settings, { username, password });
      log("new-api register");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`new-api register failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("iiimage:server:login", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) {
        const username = String((payload ?? {}).username ?? (payload ?? {}).email ?? "").trim();
        const password = String((payload ?? {}).password ?? "");
        if (!username || !password) throw new Error("请输入用户名和密码。");
        if (/error|invalid|wrong/i.test(username)) throw new Error("用户名或密码错误。");
        if (aidebugStatefulAuth) aidebugAuthenticated = true;
        return {
          ok: true,
          user: { ...aidebugUser(), username, account: username },
          wallet: aidebugWallet(),
          settings: aidebugPublicSettings
        };
      }
      const result = await completeNewApiLogin(settings, payload ?? {});
      log("new-api login");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`new-api login failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("iiimage:server:logout", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (aidebugMode && !aidebugLiveImage && aidebugStatefulAuth) aidebugAuthenticated = false;
    clearNewApiAuth(settings);
    log("new-api logout");
    return { ok: true };
  });

  ipcMain.handle("iiimage:server:me", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    const authEpoch = newApiAuthEpoch;
    const inflightKey = `${authEpoch}|${settings.serverUserId}|${settings.serverSessionCookie}`;
    if (newApiMeInflight?.key === inflightKey) return newApiMeInflight.promise;
    const task = (async () => {
      log("new-api me");
      if (aidebugMode && !aidebugLiveImage) {
        if (aidebugStatefulAuth && !aidebugAuthenticated) {
          return { ok: false, error: "登录会话已失效，请重新登录。" };
        }
        return {
          ok: true,
          user: aidebugUser(),
          wallet: aidebugWallet(),
          settings: aidebugPublicSettings
        };
      }
      try {
        if (!settings.serverSessionCookie || !settings.serverUserId) throw new Error("登录会话已失效，请重新登录。");
        let userData = { id: settings.serverUserId };
        try {
          const self = await newApiRequest(settings, "/api/user/self", {
            headers: newApiUserAuthHeaders(settings)
          });
          userData = self?.data || {};
        } catch (error) {
          if (isNewApiAuthError(error)) throw error;
          log(`new-api self in me failed ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          const session = await newApiRequest(settings, "/api/crm/session/self", {
            headers: newApiUserAuthHeaders(settings)
          });
          const crmSession = session?.data || session || {};
          if (crmSession?.currentUser) {
            userData = { ...userData, ...crmSession.currentUser };
          }
        } catch (error) {
          log(`crm session in me failed ${error instanceof Error ? error.message : String(error)}`);
        }
        let modelSettings;
        try {
          modelSettings = await newApiModelSettings(settings);
        } catch (error) {
          log(`new-api models in me failed ${error instanceof Error ? error.message : String(error)}`);
          modelSettings = modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now());
        }
        if (authEpoch !== newApiAuthEpoch) {
          return { ok: false, stale: true, error: "登录账户已切换，旧请求结果已丢弃。" };
        }
        return {
          ok: true,
          user: normalizeNewApiUser(userData),
          wallet: walletFromNewApiUser(userData),
          settings: modelSettings
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (authEpoch !== newApiAuthEpoch || error?.code === "NEW_API_SESSION_CHANGED") {
          return { ok: false, stale: true, error: message };
        }
        if (isNewApiAuthError(error)) clearNewApiAuth(settings);
        return { ok: false, error: message };
      }
    })();
    const wrapped = task.finally(() => {
      if (newApiMeInflight?.promise === wrapped) newApiMeInflight = null;
    });
    newApiMeInflight = { key: inflightKey, promise: wrapped };
    return wrapped;
  });

  ipcMain.handle("iiimage:server:logs", async () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api logs");
    if (aidebugMode && !aidebugLiveImage) return { ok: true, logs: aidebugLogs() };
    try {
      if (!settings.serverSessionCookie || !settings.serverUserId) return { ok: true, logs: [] };
      const response = await newApiRequest(settings, newApiUserLogsEndpoint, {
        headers: newApiUserAuthHeaders(settings)
      });
      return { ok: true, logs: tokenItemsFromNewApiPayload(response).map(mapNewApiLogEntry) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`new-api logs failed ${message}`);
      return { ok: false, error: message, logs: [] };
    }
  });

  ipcMain.handle("iiimage:server:models", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api models");
    try {
      const modelSettings = await newApiModelSettings(settings, { forceRefresh: payload?.forceRefresh === true });
      return { ok: true, settings: modelSettings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, settings: splitModelSettings(settings, []) };
    }
  });

  ipcMain.handle("iiimage:server:recharge", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api recharge requested");
    return {
      ok: false,
      error: "New API 充值需要走服务端支付/兑换流程，本地测试充值接口已移除。",
      user: settings.serverUserId ? { id: settings.serverUserId } : undefined
    };
  });

  ipcMain.handle("iiimage:server:generate-image", async (event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    const runId = String((payload ?? {}).runId || `run-${Date.now()}`);
    const projectId = (payload ?? {}).projectId;
    const ownedMaskImage = (payload ?? {}).maskDataUrl
      ? writeDataUrlTemp((payload ?? {}).maskDataUrl, `mask-${runId.replace(/[^a-z0-9_-]/gi, "-")}`, projectId)
      : null;
    try {
      const maskImage = ownedMaskImage || (payload ?? {}).maskImage;
      const data = await callNewApiImageWithSession(settings, {
        prompt: (payload ?? {}).prompt,
        model: (payload ?? {}).model,
        size: (payload ?? {}).size || settings.imageSize,
        quality: (payload ?? {}).quality || settings.imageQuality,
        count: (payload ?? {}).count || settings.imageCount,
        referenceImages: Array.isArray((payload ?? {}).referenceImages) ? (payload ?? {}).referenceImages : [],
        editImage: (payload ?? {}).editImage,
        maskImage,
        outputFormat: (payload ?? {}).outputFormat ?? (payload ?? {}).output_format,
        outputCompression: (payload ?? {}).outputCompression ?? (payload ?? {}).output_compression,
        background: (payload ?? {}).background,
        moderation: (payload ?? {}).moderation,
        inputFidelity: (payload ?? {}).inputFidelity ?? (payload ?? {}).input_fidelity,
        mode: (payload ?? {}).mode,
        runId,
        projectId,
        onRetry: (retry) => emitAgentProgress(event.sender, runId, {
          phase: "image-retry",
          tool: "image_gen",
          toolRunId: runId,
          summary: retry?.category === "timeout"
            ? "图片请求超时，正在进行唯一一次补试。"
            : `图片服务暂时不稳定，正在重试 ${retry?.retryCount || 1}/${retry?.maxRetries || 5}。`,
          detail: `第 ${Number(retry?.index || 0) + 1}/${retry?.count || 1} 张 · ${retry?.category || "transient"}`,
          retryCount: retry?.retryCount,
          maxRetries: retry?.maxRetries,
          errorCategory: retry?.category,
          projectId
        })
      });
      const stem = `basic-${runId.replace(/[^a-z0-9_-]/gi, "-")}`;
      const outputFormat = (payload ?? {}).outputFormat ?? (payload ?? {}).output_format ?? data.outputFormat ?? data.output_format ?? "png";
      const assets = writeServerImageOutputs(extractServerImages(data), stem, runId, projectId, outputFormat);
      log(`new-api generate image returned=${assets.length}`);
      return { ...data, assets, runId, returned: assets.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/invalid token|unauthorized|401/i.test(message)) {
        clearNewApiAuth(settings);
      }
      log(`new-api generate image failed ${message}`);
      const data = error && typeof error === "object" && error.data && typeof error.data === "object" ? error.data : {};
      return {
        ...data,
        ok: false,
        error: message,
        errorCategory: error && typeof error === "object" ? error.errorCategory : undefined,
        retryCount: error && typeof error === "object" ? error.retryCount : undefined,
        attempts: error && typeof error === "object" ? error.attempts : undefined,
        runId,
        assets: []
      };
    } finally {
      removeOwnedDataUrlTemp(ownedMaskImage, projectId);
    }
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
