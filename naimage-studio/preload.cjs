const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("naimageConfig", {
  loadSettings: () => ipcRenderer.invoke("naimage:config:load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("naimage:config:save-settings", settings),
  loadSession: () => ipcRenderer.invoke("naimage:config:load-session"),
  saveSession: (session, options = {}) => ipcRenderer.invoke(
    "naimage:config:save-session",
    Number.isSafeInteger(options?.revision) ? { ...(session || {}), revision: options.revision } : session
  ),
  newWindow: () => ipcRenderer.invoke("naimage:window:new"),
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
  deleteProject: (payload) => ipcRenderer.invoke("naimage:project:delete", payload),
  deleteProjectFolder: (payload) => ipcRenderer.invoke("naimage:project:delete-folder", payload),
  pickReferenceImage: () => ipcRenderer.invoke("naimage:asset:pick-reference-image"),
  pickReferenceImages: (payload) => ipcRenderer.invoke("naimage:asset:pick-reference-images", payload),
  pickLocalImages: (payload) => ipcRenderer.invoke("naimage:asset:pick-local-images", payload),
  pathForDroppedFile: (file) => webUtils.getPathForFile(file),
  readAssetDataUrl: (payload) => ipcRenderer.invoke("naimage:asset:read-data-url", payload),
  refineSemanticLayers: (payload) => ipcRenderer.invoke("naimage:asset:refine-semantic-layers", payload),
  isolateImageBackground: (payload) => ipcRenderer.invoke("naimage:asset:isolate-background", payload),
  thumbnailStats: (payload) => ipcRenderer.invoke("naimage:asset:thumbnail-stats", payload),
  imageImportStatus: (payload) => ipcRenderer.invoke("naimage:asset:image-import-status", payload),
  cancelImageImports: () => ipcRenderer.invoke("naimage:asset:cancel-image-imports"),
  importLocalImage: (payload) => ipcRenderer.invoke("naimage:asset:import-local-image", payload),
  importLocalImages: (payload) => ipcRenderer.invoke("naimage:asset:import-local-images", payload),
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
  smoke: () => ipcRenderer.invoke("naimage:agent:smoke"),
  onProgress: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("naimage:agent:progress", listener);
    return () => ipcRenderer.removeListener("naimage:agent:progress", listener);
  }
});
