const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("iiimageConfig", {
  loadSettings: () => ipcRenderer.invoke("iiimage:config:load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("iiimage:config:save-settings", settings),
  loadSession: () => ipcRenderer.invoke("iiimage:config:load-session"),
  saveSession: (session, options = {}) => ipcRenderer.invoke(
    "iiimage:config:save-session",
    Number.isSafeInteger(options?.revision) ? { ...(session || {}), revision: options.revision } : session
  ),
  newWindow: () => ipcRenderer.invoke("iiimage:window:new"),
  windowControl: (payload) => ipcRenderer.invoke("iiimage:window:control", payload),
  listProjects: () => ipcRenderer.invoke("iiimage:project:list"),
  createProject: (payload) => ipcRenderer.invoke("iiimage:project:create", payload),
  createProjectFolder: (payload) => ipcRenderer.invoke("iiimage:project:create-folder", payload),
  switchProject: (payload) => ipcRenderer.invoke("iiimage:project:switch", payload),
  renameProject: (payload) => ipcRenderer.invoke("iiimage:project:rename", payload),
  openProject: () => ipcRenderer.invoke("iiimage:project:open"),
  openCurrentProjectFolder: (payload) => ipcRenderer.invoke("iiimage:project:open-current-folder", payload),
  exportProject: () => ipcRenderer.invoke("iiimage:project:export"),
  importProject: () => ipcRenderer.invoke("iiimage:project:import"),
  deleteProject: (payload) => ipcRenderer.invoke("iiimage:project:delete", payload),
  deleteProjectFolder: (payload) => ipcRenderer.invoke("iiimage:project:delete-folder", payload),
  pickReferenceImage: () => ipcRenderer.invoke("iiimage:asset:pick-reference-image"),
  pickReferenceImages: (payload) => ipcRenderer.invoke("iiimage:asset:pick-reference-images", payload),
  pickLocalImages: (payload) => ipcRenderer.invoke("iiimage:asset:pick-local-images", payload),
  pathForDroppedFile: (file) => webUtils.getPathForFile(file),
  readAssetDataUrl: (payload) => ipcRenderer.invoke("iiimage:asset:read-data-url", payload),
  refineSemanticLayers: (payload) => ipcRenderer.invoke("iiimage:asset:refine-semantic-layers", payload),
  isolateImageBackground: (payload) => ipcRenderer.invoke("iiimage:asset:isolate-background", payload),
  thumbnailStats: (payload) => ipcRenderer.invoke("iiimage:asset:thumbnail-stats", payload),
  imageImportStatus: (payload) => ipcRenderer.invoke("iiimage:asset:image-import-status", payload),
  cancelImageImports: () => ipcRenderer.invoke("iiimage:asset:cancel-image-imports"),
  importLocalImage: (payload) => ipcRenderer.invoke("iiimage:asset:import-local-image", payload),
  importLocalImages: (payload) => ipcRenderer.invoke("iiimage:asset:import-local-images", payload),
  saveOutputImage: (payload) => ipcRenderer.invoke("iiimage:asset:save-output-image", payload),
  saveAssetAs: (payload) => ipcRenderer.invoke("iiimage:asset:save-as", payload),
  exportAssetPsd: (payload) => ipcRenderer.invoke("iiimage:asset:export-psd", payload),
  exportAssetsToFolder: (payload) => ipcRenderer.invoke("iiimage:asset:export-folder", payload),
  exportLayerGroupPsd: (payload) => ipcRenderer.invoke("iiimage:asset:export-layer-psd", payload),
  openAssetFolder: (payload) => ipcRenderer.invoke("iiimage:asset:open-folder", payload),
  debugWindowBounds: (payload) => ipcRenderer.invoke("iiimage:debug:window-bounds", payload),
  captureGuiScreenshot: (payload) => ipcRenderer.invoke("iiimage:debug:capture-gui", payload)
});

contextBridge.exposeInMainWorld("iiimageServer", {
  register: (payload) => ipcRenderer.invoke("iiimage:server:register", payload),
  login: (payload) => ipcRenderer.invoke("iiimage:server:login", payload),
  logout: () => ipcRenderer.invoke("iiimage:server:logout"),
  me: () => ipcRenderer.invoke("iiimage:server:me"),
  logs: () => ipcRenderer.invoke("iiimage:server:logs"),
  models: (payload) => ipcRenderer.invoke("iiimage:server:models", payload),
  recharge: (payload) => ipcRenderer.invoke("iiimage:server:recharge", payload),
  generateImage: (payload) => ipcRenderer.invoke("iiimage:server:generate-image", payload)
});

contextBridge.exposeInMainWorld("iiimageUpdater", {
  status: () => ipcRenderer.invoke("iiimage:update:status"),
  ready: () => ipcRenderer.invoke("iiimage:update:renderer-ready"),
  check: () => ipcRenderer.invoke("iiimage:update:check"),
  createInstallerCaptcha: () => ipcRenderer.invoke("iiimage:update:installer-captcha"),
  downloadRestart: () => ipcRenderer.invoke("iiimage:update:download-restart"),
  downloadInstaller: (payload) => ipcRenderer.invoke("iiimage:update:download-installer", payload),
  applyRestart: () => ipcRenderer.invoke("iiimage:update:apply-restart"),
  launchInstaller: () => ipcRenderer.invoke("iiimage:update:launch-installer"),
  onProgress: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("iiimage:update:progress", listener);
    return () => ipcRenderer.removeListener("iiimage:update:progress", listener);
  }
});

contextBridge.exposeInMainWorld("iiimageAgent", {
  tools: () => ipcRenderer.invoke("iiimage:agent:tools"),
  listModels: (payload) => ipcRenderer.invoke("iiimage:agent:list-models", payload),
  runTool: (payload) => ipcRenderer.invoke("iiimage:agent:run-tool", payload),
  composeImagePrompt: (payload) => ipcRenderer.invoke("iiimage:agent:compose-image-prompt", payload),
  chat: (payload) => ipcRenderer.invoke("iiimage:agent:chat", payload),
  getMainPrompt: () => ipcRenderer.invoke("iiimage:agent:main-prompt:get"),
  saveMainPrompt: (payload) => ipcRenderer.invoke("iiimage:agent:main-prompt:save", payload),
  resetMainPrompt: () => ipcRenderer.invoke("iiimage:agent:main-prompt:reset"),
  getFastMemory: (payload) => ipcRenderer.invoke("iiimage:agent:fast-memory:get", payload),
  saveFastMemory: (payload) => ipcRenderer.invoke("iiimage:agent:fast-memory:save", payload),
  resetFastMemory: (payload) => ipcRenderer.invoke("iiimage:agent:fast-memory:reset", payload),
  clearConversation: (payload) => ipcRenderer.invoke("iiimage:agent:clear-conversation", payload),
  cancelPendingExecution: (payload) => ipcRenderer.invoke("iiimage:agent:cancel-pending-execution", payload),
  smoke: () => ipcRenderer.invoke("iiimage:agent:smoke"),
  onProgress: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("iiimage:agent:progress", listener);
    return () => ipcRenderer.removeListener("iiimage:agent:progress", listener);
  }
});
