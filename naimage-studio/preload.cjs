const { contextBridge, ipcRenderer, webUtils } = require("electron");

const runtimeArguments = new Set(process.argv);
contextBridge.exposeInMainWorld("naimageRuntime", Object.freeze({
  aidebugEnabled: runtimeArguments.has("--naimage-aidebug-enabled=1"),
  isolatedConfig: runtimeArguments.has("--naimage-aidebug-isolated-config=1")
}));

contextBridge.exposeInMainWorld("naimageConfig", {
  loadSettings: () => ipcRenderer.invoke("naimage:config:load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("naimage:config:save-settings", settings),
  listRequirementLibrary: (payload) => ipcRenderer.invoke("naimage:requirement-library:list", payload),
  getRequirementLibraryEntry: (payload) => ipcRenderer.invoke("naimage:requirement-library:get", payload),
  saveRequirementLibraryEntry: (payload) => ipcRenderer.invoke("naimage:requirement-library:save", payload),
  deleteRequirementLibraryEntry: (payload) => ipcRenderer.invoke("naimage:requirement-library:delete", payload),
  listCommerceTemplates: () => ipcRenderer.invoke("naimage:commerce-template:list"),
  getCommerceTemplate: (payload) => ipcRenderer.invoke("naimage:commerce-template:get", payload),
  saveCommerceTemplate: (payload) => ipcRenderer.invoke("naimage:commerce-template:save", payload),
  deleteCommerceTemplate: (payload) => ipcRenderer.invoke("naimage:commerce-template:delete", payload),
  importCommerceTemplate: () => ipcRenderer.invoke("naimage:commerce-template:import"),
  exportCommerceTemplate: (payload) => ipcRenderer.invoke("naimage:commerce-template:export", payload),
  onCommerceTemplateChanged: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:commerce-template:changed", listener);
    return () => ipcRenderer.removeListener("naimage:commerce-template:changed", listener);
  },
  listCommerceCatalog: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:list", payload),
  saveCommerceCatalogProduct: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:save-product", payload),
  archiveCommerceCatalogProduct: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:archive-product", payload),
  assignCommerceCatalogAssets: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:assign-assets", payload),
  removeCommerceCatalogAsset: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:remove-asset", payload),
  updateCommerceCatalogResultState: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:update-result-state", payload),
  listCommerceCatalogComparisons: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:list-comparisons", payload),
  selectCommerceCatalogComparisonWinner: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:select-comparison", payload),
  reconcileCommerceCatalogGoalResults: (payload) => ipcRenderer.invoke("naimage:commerce-catalog:reconcile-goal-results", payload),
  previewCommerceExport: (payload) => ipcRenderer.invoke("naimage:commerce-export:preview", payload),
  exportCommercePackage: (payload) => ipcRenderer.invoke("naimage:commerce-export:package", payload),
  previewSocialExport: (payload) => ipcRenderer.invoke("naimage:social-export:preview", payload),
  exportSocialPackage: (payload) => ipcRenderer.invoke("naimage:social-export:package", payload),
  onCommerceCatalogChanged: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:commerce-catalog:changed", listener);
    return () => ipcRenderer.removeListener("naimage:commerce-catalog:changed", listener);
  },
  loadSession: (payload) => ipcRenderer.invoke("naimage:config:load-session", payload),
  saveSession: (session, options = {}) => ipcRenderer.invoke("naimage:config:save-session", session, options),
  newWindow: (payload) => ipcRenderer.invoke("naimage:window:new", payload),
  windowControl: (payload) => ipcRenderer.invoke("naimage:window:control", payload),
  listProjects: () => ipcRenderer.invoke("naimage:project:list"),
  createProject: (payload) => ipcRenderer.invoke("naimage:project:create", payload),
  createProjectFolder: (payload) => ipcRenderer.invoke("naimage:project:create-folder", payload),
  switchProject: (payload) => ipcRenderer.invoke("naimage:project:switch", payload),
  renameProject: (payload) => ipcRenderer.invoke("naimage:project:rename", payload),
  openProject: () => ipcRenderer.invoke("naimage:project:open"),
  openCurrentProjectFolder: (payload) => ipcRenderer.invoke("naimage:project:open-current-folder", payload),
  exportProject: () => ipcRenderer.invoke("naimage:project:export"),
  importProject: () => ipcRenderer.invoke("naimage:project:import"),
  importProjectGraph: () => ipcRenderer.invoke("naimage:project-graph:import"),
  importSkill: () => ipcRenderer.invoke("naimage:project-skill:import"),
  parseSkill: (payload) => ipcRenderer.invoke("naimage:project-skill:parse", payload),
  importThemePreset: () => ipcRenderer.invoke("naimage:theme:import"),
  exportThemePreset: (theme) => ipcRenderer.invoke("naimage:theme:export", theme),
  pickGlassBackground: () => ipcRenderer.invoke("naimage:glass-background:pick"),
  loadGlassBackground: (payload) => ipcRenderer.invoke("naimage:glass-background:load", payload),
  clearGlassBackground: (payload) => ipcRenderer.invoke("naimage:glass-background:clear", payload),
  composePluginTask: (payload) => ipcRenderer.invoke("naimage:plugin:compose-task", payload),
  deleteProject: (payload) => ipcRenderer.invoke("naimage:project:delete", payload),
  deleteProjectFolder: (payload) => ipcRenderer.invoke("naimage:project:delete-folder", payload),
  pickReferenceImage: () => ipcRenderer.invoke("naimage:asset:pick-reference-image"),
  pickReferenceImages: (payload) => ipcRenderer.invoke("naimage:asset:pick-reference-images", payload),
  pickLocalImages: (payload) => ipcRenderer.invoke("naimage:asset:pick-local-images", payload),
  pickLocalVideos: (payload) => ipcRenderer.invoke("naimage:asset:pick-local-videos", payload),
  pathForDroppedFile: (file) => webUtils.getPathForFile(file),
  readAssetDataUrl: (payload) => ipcRenderer.invoke("naimage:asset:read-data-url", payload),
  refineSemanticLayers: (payload) => ipcRenderer.invoke("naimage:asset:refine-semantic-layers", payload),
  isolateImageBackground: (payload) => ipcRenderer.invoke("naimage:asset:isolate-background", payload),
  thumbnailStats: (payload) => ipcRenderer.invoke("naimage:asset:thumbnail-stats", payload),
  imageImportStatus: (payload) => ipcRenderer.invoke("naimage:asset:image-import-status", payload),
  cancelImageImports: () => ipcRenderer.invoke("naimage:asset:cancel-image-imports"),
  importLocalImage: (payload) => ipcRenderer.invoke("naimage:asset:import-local-image", payload),
  importLocalImages: (payload) => ipcRenderer.invoke("naimage:asset:import-local-images", payload),
  importLocalVideos: (payload) => ipcRenderer.invoke("naimage:asset:import-local-videos", payload),
  saveOutputImage: (payload) => ipcRenderer.invoke("naimage:asset:save-output-image", payload),
  saveAssetAs: (payload) => ipcRenderer.invoke("naimage:asset:save-as", payload),
  exportAssetPsd: (payload) => ipcRenderer.invoke("naimage:asset:export-psd", payload),
  exportAssetsToFolder: (payload) => ipcRenderer.invoke("naimage:asset:export-folder", payload),
  exportLayerGroupPsd: (payload) => ipcRenderer.invoke("naimage:asset:export-layer-psd", payload),
  openAssetFolder: (payload) => ipcRenderer.invoke("naimage:asset:open-folder", payload),
  debugWindowBounds: (payload) => ipcRenderer.invoke("naimage:debug:window-bounds", payload),
  captureGuiScreenshot: (payload) => ipcRenderer.invoke("naimage:debug:capture-gui", payload)
});

contextBridge.exposeInMainWorld("naimageAgentIntegrations", {
  detect: () => ipcRenderer.invoke("naimage:integration:detect"),
  install: (payload) => ipcRenderer.invoke("naimage:integration:install", payload),
  remove: (payload) => ipcRenderer.invoke("naimage:integration:remove", payload)
});

contextBridge.exposeInMainWorld("naimageVideo", {
  create: (payload) => ipcRenderer.invoke("naimage:video-task:create", payload),
  list: (payload) => ipcRenderer.invoke("naimage:video-task:list", payload),
  get: (payload) => ipcRenderer.invoke("naimage:video-task:get", payload),
  poll: (payload) => ipcRenderer.invoke("naimage:video-task:poll", payload),
  retryDownload: (payload) => ipcRenderer.invoke("naimage:video-task:retry-download", payload),
  onChanged: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:video-task:changed", listener);
    return () => ipcRenderer.removeListener("naimage:video-task:changed", listener);
  }
});

contextBridge.exposeInMainWorld("naimageScientific", {
  importData: (payload) => ipcRenderer.invoke("naimage:scientific:import-data", payload),
  listData: (payload) => ipcRenderer.invoke("naimage:scientific:list-data", payload),
  render: (payload) => ipcRenderer.invoke("naimage:scientific:render", payload),
  list: (payload) => ipcRenderer.invoke("naimage:scientific:list", payload),
  get: (payload) => ipcRenderer.invoke("naimage:scientific:get", payload),
  cancel: (payload) => ipcRenderer.invoke("naimage:scientific:cancel", payload),
  export: (payload) => ipcRenderer.invoke("naimage:scientific:export", payload),
  onChanged: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:scientific:changed", listener);
    return () => ipcRenderer.removeListener("naimage:scientific:changed", listener);
  }
});

contextBridge.exposeInMainWorld("naimageAutomation", {
  ready: () => ipcRenderer.invoke("naimage:automation:renderer-ready"),
  respond: (payload) => ipcRenderer.send("naimage:automation:response", payload),
  onRequest: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:automation:request", listener);
    return () => ipcRenderer.removeListener("naimage:automation:request", listener);
  }
});

contextBridge.exposeInMainWorld("naimageAgentWindow", {
  open: () => ipcRenderer.invoke("naimage:agent-window:open"),
  close: () => ipcRenderer.invoke("naimage:agent-window:close"),
  status: () => ipcRenderer.invoke("naimage:agent-window:status"),
  publishState: (payload) => ipcRenderer.send("naimage:agent-window:publish-state", payload),
  onCommand: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:agent-window:command", listener);
    return () => ipcRenderer.removeListener("naimage:agent-window:command", listener);
  }
});

contextBridge.exposeInMainWorld("naimageServer", {
  register: (payload) => ipcRenderer.invoke("naimage:server:register", payload),
  login: (payload) => ipcRenderer.invoke("naimage:server:login", payload),
  logout: () => ipcRenderer.invoke("naimage:server:logout"),
  me: (payload) => ipcRenderer.invoke("naimage:server:me", payload),
  logs: () => ipcRenderer.invoke("naimage:server:logs"),
  models: (payload) => ipcRenderer.invoke("naimage:server:models", payload),
  tokens: (payload) => ipcRenderer.invoke("naimage:server:tokens", payload),
  selectToken: (payload) => ipcRenderer.invoke("naimage:server:select-token", payload),
  createToken: (payload) => ipcRenderer.invoke("naimage:server:create-token", payload),
  updateToken: (payload) => ipcRenderer.invoke("naimage:server:update-token", payload),
  deleteToken: (payload) => ipcRenderer.invoke("naimage:server:delete-token", payload),
  recharge: (payload) => ipcRenderer.invoke("naimage:server:recharge", payload),
  generateImage: (payload) => ipcRenderer.invoke("naimage:server:generate-image", payload),
  licenseStatus: (payload) => ipcRenderer.invoke("naimage:server:license-status", payload),
  activateLicense: (payload) => ipcRenderer.invoke("naimage:server:activate-license", payload),
  configureCustom: (payload) => ipcRenderer.invoke("naimage:server:configure-custom", payload)
});

contextBridge.exposeInMainWorld("naimageUpdater", {
  status: () => ipcRenderer.invoke("naimage:update:status"),
  ready: () => ipcRenderer.invoke("naimage:update:renderer-ready"),
  check: () => ipcRenderer.invoke("naimage:update:check"),
  createInstallerCaptcha: () => ipcRenderer.invoke("naimage:update:installer-captcha"),
  downloadRestart: () => ipcRenderer.invoke("naimage:update:download-restart"),
  downloadInstaller: (payload) => ipcRenderer.invoke("naimage:update:download-installer", payload),
  applyRestart: () => ipcRenderer.invoke("naimage:update:apply-restart"),
  launchInstaller: () => ipcRenderer.invoke("naimage:update:launch-installer"),
  onProgress: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:update:progress", listener);
    return () => ipcRenderer.removeListener("naimage:update:progress", listener);
  }
});

contextBridge.exposeInMainWorld("naimageAgent", {
  tools: () => ipcRenderer.invoke("naimage:agent:tools"),
  listModels: (payload) => ipcRenderer.invoke("naimage:agent:list-models", payload),
  runTool: (payload) => ipcRenderer.invoke("naimage:agent:run-tool", payload),
  composeImagePrompt: (payload) => ipcRenderer.invoke("naimage:agent:compose-image-prompt", payload),
  chat: (payload) => ipcRenderer.invoke("naimage:agent:chat", payload),
  getMainPrompt: () => ipcRenderer.invoke("naimage:agent:main-prompt:get"),
  saveMainPrompt: (payload) => ipcRenderer.invoke("naimage:agent:main-prompt:save", payload),
  resetMainPrompt: () => ipcRenderer.invoke("naimage:agent:main-prompt:reset"),
  getFastMemory: (payload) => ipcRenderer.invoke("naimage:agent:fast-memory:get", payload),
  saveFastMemory: (payload) => ipcRenderer.invoke("naimage:agent:fast-memory:save", payload),
  resetFastMemory: (payload) => ipcRenderer.invoke("naimage:agent:fast-memory:reset", payload),
  clearConversation: (payload) => ipcRenderer.invoke("naimage:agent:clear-conversation", payload),
  cancelPendingExecution: (payload) => ipcRenderer.invoke("naimage:agent:cancel-pending-execution", payload),
  pause: (payload) => ipcRenderer.invoke("naimage:agent:pause", payload),
  resume: (payload) => ipcRenderer.invoke("naimage:agent:resume", payload),
  stop: (payload) => ipcRenderer.invoke("naimage:agent:stop", payload),
  steer: (payload) => ipcRenderer.invoke("naimage:agent:steer", payload),
  runStatus: (payload) => ipcRenderer.invoke("naimage:agent:run-status", payload),
  smoke: () => ipcRenderer.invoke("naimage:agent:smoke"),
  onRunState: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:agent:run-state", listener);
    return () => ipcRenderer.removeListener("naimage:agent:run-state", listener);
  },
  onProgress: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:agent:progress", listener);
    return () => ipcRenderer.removeListener("naimage:agent:progress", listener);
  }
});
