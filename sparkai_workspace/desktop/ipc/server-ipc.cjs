"use strict";
const { normalizeComfyUiConnectionReference } = require("../../runtime/comfyui-options.mjs");
const { WORKFLOW_CAPABILITIES, MAPPING_PORTS } = require("../../runtime/image-generation/comfyui-template-registry.cjs");

let aidebugAuthenticated = true;
let newApiMeInflight = null;

function registerServerIpc({
  ipcMain,
  accessPolicy,
  aidebugLogs,
  aidebugLiveImage,
  aidebugMode,
  aidebugPublicSettings,
  aidebugStatefulAuth,
  aidebugUser,
  aidebugWallet,
  accountTokenService,
  newApiAccountService,
  agentRunControl,
  callNewApiImageWithSession,
  deliverGeneratedImageResult,
  imageOperationJournal,
  imageGenerationService,
  comfyUiTemplateService,
  comfyUiMaskService,
  comfyUiConnectionService,
  comfyUiCredentialStore,
  comfyUiRuntimeService,
  clearNewApiAuth,
  completeNewApiLogin,
  customApiCredentials,
  defaultSettings,
  emitAgentProgress,
  extractServerImages,
  getNewApiAuthEpoch,
  isNewApiAuthError,
  log,
  licenseService,
  logoutNewApiSession,
  migrateSettings,
  modelSettingsWithCacheMeta,
  newApiModelSettings,
  probeModelChannel,
  newApiRequest,
  newApiUserAuthHeaders,
  normalizeNewApiUser,
  readProjectList,
  getProjectById,
  readJson,
  removeOwnedDataUrlTemp,
  settingsPath,
  splitModelSettings,
  walletFromNewApiUser,
  writeDataUrlTemp,
  writeJson,
  writeServerImageOutputs
}) {
  // Connection profiles are Main-owned.  IPC only projects the stable,
  // redacted summary; credential values and protected-store payloads never
  // cross into Renderer, automation or MCP results.
  const connectionService = comfyUiConnectionService || comfyUiTemplateService?.connectionService || comfyUiTemplateService?.connections;
  const safeConnectionId = value => {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text) ? text : "";
  };
  const safeConnectionUrl = value => {
    if (typeof value !== "string" || value.length > 2048) return undefined;
    try {
      const parsed = new URL(value);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
      return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
    } catch { return undefined; }
  };
  const publicConnection = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const connectionId = safeConnectionId(value.connectionId || value.profileId || value.id);
    if (!connectionId) return undefined;
    const result = { connectionId };
    for (const key of ["label", "networkScope", "credentialType", "credentialMode", "authorizedHost", "tlsMode", "status"]) {
      if (typeof value[key] === "string" && value[key].length <= 180 && !/token|secret|password|cookie|authorization|key/i.test(key)) result[key] = value[key];
    }
    for (const key of ["credentialConfigured", "tlsConfigured", "legacy"]) if (typeof value[key] === "boolean") result[key] = value[key];
    for (const key of ["createdAt", "updatedAt"]) if (typeof value[key] === "string" && value[key].length <= 64) result[key] = value[key];
    const baseUrl = safeConnectionUrl(value.baseUrl);
    if (baseUrl) result.baseUrl = baseUrl;
    if (typeof value.enabled === "boolean") result.enabled = value.enabled;
    return result;
  };
  const publicConnectionResult = value => {
    if (Array.isArray(value)) return value.map(publicConnection).filter(Boolean);
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const result = { ...value };
    for (const key of Object.keys(result)) if (/token|secret|password|cookie|authorization|apiKey|accessKey|privateKey|certificate|credentialValue|credentialRef|credentials/i.test(key)) delete result[key];
    if (result.id && result.connectionId) delete result.id;
    if (typeof result.baseUrl === "string") result.baseUrl = safeConnectionUrl(result.baseUrl);
    if (Array.isArray(result.connections)) result.connections = result.connections.map(publicConnection).filter(Boolean);
    for (const key of ["connection", "profile"]) if (result[key]) result[key] = publicConnection(result[key]);
    return result;
  };
  const requireConnectionService = () => {
    if (!connectionService) throw Object.assign(new Error("ComfyUI 连接配置服务不可用。"), { code: "COMFYUI_CONNECTION_SERVICE_UNAVAILABLE" });
    return connectionService;
  };
  const connectionReference = normalizeComfyUiConnectionReference;
  const requireConfirmed = payload => {
    if (payload?.confirmed !== true) throw Object.assign(new Error("连接操作需要 confirmed=true。"), { code: "COMFYUI_CONNECTION_CONFIRMATION_REQUIRED" });
  };
  const controlInvalid = () => Object.assign(new Error("ComfyUI 控制参数无效。"), { code: "COMFYUI_REQUEST_INVALID" });
  const safeControlId = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
  const publicMappings = mappings => (Array.isArray(mappings) ? mappings : []).flatMap(mapping => {
    if (!mapping || !safeControlId(mapping.nodeId) || typeof mapping.inputName !== "string" || !/^[A-Za-z0-9_]{1,100}$/.test(mapping.inputName) || !Object.prototype.hasOwnProperty.call(MAPPING_PORTS, mapping.kind)) return [];
    return [{ nodeId: mapping.nodeId, inputName: mapping.inputName, kind: mapping.kind,
      ...(Number.isInteger(mapping.index) && mapping.index >= 0 && mapping.index <= 3 ? { index: mapping.index } : {}) }];
  });
  const publicTemplate = value => {
    if (!value || typeof value !== "object" || !safeControlId(value.id)) return undefined;
    const result = { id: value.id, inputMappings: publicMappings(value.inputMappings) };
    for (const key of ["label", "templateHash", "outputNodeId", "modelFamily", "policyVersion"]) if (["string", "number"].includes(typeof value[key])) result[key] = value[key];
    for (const key of ["version", "imageInputs", "schemaVersion"]) if (Number.isSafeInteger(value[key])) result[key] = value[key];
    for (const key of ["builtIn", "requiresCheckpoint", "alphaRequired"]) if (typeof value[key] === "boolean") result[key] = value[key];
    for (const key of ["operation", "capability"]) if (WORKFLOW_CAPABILITIES.includes(value[key])) result[key] = value[key];
    if (Array.isArray(value.exposedInputs)) result.exposedInputs = value.exposedInputs.filter(kind => Object.prototype.hasOwnProperty.call(MAPPING_PORTS, kind));
    if (value.defaults && typeof value.defaults === "object") result.defaults = Object.fromEntries(["steps", "cfg", "sampler", "scheduler", "denoise"].filter(key => ["number", "string"].includes(typeof value.defaults[key])).map(key => [key, value.defaults[key]]));
    if (value.parameterRanges && typeof value.parameterRanges === "object") result.parameterRanges = Object.fromEntries(["steps", "cfg", "denoise"].filter(key => value.parameterRanges[key]).map(key => [key,
      Object.fromEntries(["min", "max", "step"].filter(field => Number.isFinite(value.parameterRanges[key][field])).map(field => [field, value.parameterRanges[key][field]]))]));
    if (value.inputRoles && typeof value.inputRoles === "object") result.inputRoles = Object.fromEntries(["sourceImage", "maskImage", "referenceImages"].filter(role => value.inputRoles[role]).map(role => [role, {
      required: value.inputRoles[role].required === true, maxCount: Math.max(0, Math.min(4, Number(value.inputRoles[role].maxCount) || 0)), ...(role === "maskImage" ? { managed: true } : {})
    }]));
    return result;
  };
  const publicTemplateResult = value => {
    const result = { ok: value?.ok === true };
    if (value?.canceled === true) result.canceled = true;
    if (Array.isArray(value?.templates)) result.templates = value.templates.map(publicTemplate).filter(Boolean);
    if (value?.template) result.template = publicTemplate(value.template);
    if (Array.isArray(value?.connections)) result.connections = value.connections.map(publicConnection).filter(Boolean);
    const baseUrl = safeConnectionUrl(value?.baseUrl); if (baseUrl) result.baseUrl = baseUrl;
    return result;
  };
  const publicWorkflowPreview = value => {
    const result = { ok: value?.ok === true };
    if (value?.canceled === true) return { ...result, canceled: true };
    if (safeControlId(value?.draftId)) result.draftId = value.draftId;
    result.blocked = value?.blocked === true;
    result.issues = (Array.isArray(value?.issues) ? value.issues : []).slice(0, 256).flatMap(issue => safeControlId(issue?.code) ? [{ code: issue.code,
      ...(safeControlId(issue.nodeId) ? { nodeId: issue.nodeId } : {}), ...(safeControlId(issue.classType) ? { classType: issue.classType } : {}) }] : []);
    result.nodes = (Array.isArray(value?.nodes) ? value.nodes : []).slice(0, 256).flatMap(node => safeControlId(node?.nodeId) && safeControlId(node?.classType) ? [{
      nodeId: node.nodeId, classType: node.classType, approved: node.approved === true, outputNode: node.outputNode === true,
      outputTypes: (Array.isArray(node.outputTypes) ? node.outputTypes : []).filter(safeControlId),
      inputs: (Array.isArray(node.inputs) ? node.inputs : []).flatMap(input => safeControlId(input?.inputName) && safeControlId(input?.type) ? [{ inputName: input.inputName, type: input.type,
        allowedKinds: (Array.isArray(input.allowedKinds) ? input.allowedKinds : []).filter(kind => Object.prototype.hasOwnProperty.call(MAPPING_PORTS, kind)) }] : [])
    }] : []);
    result.candidateCapabilities = (Array.isArray(value?.candidateCapabilities) ? value.candidateCapabilities : []).filter(capability => WORKFLOW_CAPABILITIES.includes(capability));
    return result;
  };
  const stableImageIdentity = value => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["assetId", "occurrenceId", "contentHash"].includes(key)) ||
      !["assetId", "occurrenceId"].every(key => typeof value[key] === "string" && /^[\p{L}\p{N}_.:@-]{1,180}$/u.test(value[key])) || !/^[a-f0-9]{64}$/.test(value.contentHash || "")) throw controlInvalid();
    return { assetId: value.assetId, occurrenceId: value.occurrenceId, contentHash: value.contentHash };
  };
  const publicMask = value => {
    try {
      const identity = stableImageIdentity({ assetId: value?.assetId, occurrenceId: value?.occurrenceId, contentHash: value?.contentHash });
      if (!Number.isSafeInteger(value.revision) || value.revision < 1 || ![value.width, value.height].every(dimension => Number.isInteger(dimension) && dimension > 0)) return undefined;
      const sourceImage = stableImageIdentity({ assetId: value.sourceImage?.assetId, occurrenceId: value.sourceImage?.occurrenceId, contentHash: value.sourceImage?.contentHash });
      return { ...identity, revision: value.revision, width: value.width, height: value.height, sourceImage };
    } catch { return undefined; }
  };
  const runtimeText = (value, max = 180) => typeof value === "string" ? value
    .replace(/\b(?:https?|wss?|file|ftp):\/\/[^\s]+/gi, "[受保护来源]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,;]+/g, "[受保护路径]")
    .replace(/(^|\s)\/(?:[^/\s]+\/)*[^/\s,;)]+/g, "$1[受保护路径]")
    .replace(/\b(?:Bearer\s+\S+|(?:token|password|secret|apiKey|authorization|cookie)\s*[:=]\s*\S+)/gi, "[受保护凭据]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";
  const runtimeBytes = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const runtimeHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  const runtimeStrings = value => (Array.isArray(value) ? value : []).slice(0, 128).map(item => runtimeText(item)).filter(Boolean);
  const publicRuntimeManifest = value => {
    if (!safeControlId(value?.manifestId)) return undefined;
    return { manifestId: value.manifestId, label: runtimeText(value.label), version: runtimeText(value.version), adapter: runtimeText(value.adapter),
      ...(runtimeHash(value.manifestHash) ? { manifestHash: value.manifestHash } : {}),
      ...(["user-import", "reviewed-registry"].includes(value.trust) ? { trust: value.trust } : {}),
      ...(["needs-review", "reviewed", "user-import"].includes(value.reviewStatus) ? { reviewStatus: value.reviewStatus } : {}),
      artifactCount: runtimeBytes(value.artifactCount), modelOnly: value.modelOnly === true,
      installable: value.installable === true && value.reviewStatus !== "needs-review" && ["user-import", "reviewed-registry"].includes(value.trust) };
  };
  const publicRuntimeRevision = value => {
    if (!safeControlId(value?.revisionId) || !["ready", "failed"].includes(value.state)) return undefined;
    return { revisionId: value.revisionId, ...(safeControlId(value.manifestId) ? { manifestId: value.manifestId } : {}), ...(runtimeHash(value.manifestHash) ? { manifestHash: value.manifestHash } : {}), version: runtimeText(value.version), state: value.state, createdAt: runtimeText(value.createdAt) };
  };
  const publicRuntime = value => {
    if (!safeControlId(value?.runtimeId) || !["managed", "existing"].includes(value.mode) || !["ready", "running", "stopped", "failed", "removed"].includes(value.state)) return undefined;
    return { runtimeId: value.runtimeId, label: runtimeText(value.label), mode: value.mode, state: value.state,
      ...(safeControlId(value.connectionId) ? { connectionId: value.connectionId } : {}),
      ...(safeControlId(value.activeRevisionId) ? { activeRevisionId: value.activeRevisionId } : {}),
      revisions: (Array.isArray(value.revisions) ? value.revisions : []).map(publicRuntimeRevision).filter(Boolean), createdAt: runtimeText(value.createdAt), updatedAt: runtimeText(value.updatedAt) };
  };
  const publicRuntimeJob = value => {
    if (!["jobId", "planId", "runtimeId", "manifestId"].every(key => safeControlId(value?.[key])) || !runtimeHash(value.manifestHash) || !["authorized", "downloading", "paused", "installing", "validating", "completed", "failed"].includes(value.state)) return undefined;
    return { jobId: value.jobId, planId: value.planId, runtimeId: value.runtimeId, manifestId: value.manifestId, manifestHash: value.manifestHash,
      state: value.state, downloadedBytes: runtimeBytes(value.downloadedBytes), totalBytes: runtimeBytes(value.totalBytes),
      ...(typeof value.errorCode === "string" && /^[A-Z][A-Z0-9_]{0,159}$/.test(value.errorCode) ? { errorCode: value.errorCode } : {}),
      createdAt: runtimeText(value.createdAt), updatedAt: runtimeText(value.updatedAt) };
  };
  const publicRuntimePlan = value => {
    if (!safeControlId(value?.planId) || !safeControlId(value.manifestId) || !runtimeHash(value.manifestHash)) return undefined;
    const artifacts = (Array.isArray(value.artifacts) ? value.artifacts : []).flatMap(artifact => safeControlId(artifact?.artifactId) ? [{
      artifactId: artifact.artifactId, label: runtimeText(artifact.label), kind: runtimeText(artifact.kind), sourceLabel: runtimeText(artifact.sourceLabel),
      license: { id: runtimeText(artifact.license?.id) }, bytes: runtimeBytes(artifact.bytes), expandedBytes: runtimeBytes(artifact.expandedBytes),
      dependencies: (Array.isArray(artifact.dependencies) ? artifact.dependencies : []).filter(safeControlId)
    }] : []);
    return { planId: value.planId, manifestId: value.manifestId, manifestHash: value.manifestHash,
      ...(safeControlId(value.runtimeId) ? { runtimeId: value.runtimeId } : {}), label: runtimeText(value.label), version: runtimeText(value.version), artifacts,
      requirements: { os: runtimeStrings(value.requirements?.os), arch: runtimeStrings(value.requirements?.arch), gpu: runtimeStrings(value.requirements?.gpu), vramBytes: runtimeBytes(value.requirements?.vramBytes), diskBytes: runtimeBytes(value.requirements?.diskBytes) },
      downloadBytes: runtimeBytes(value.downloadBytes), expandedBytes: runtimeBytes(value.expandedBytes), requiredDiskBytes: runtimeBytes(value.requiredDiskBytes), availableDiskBytes: runtimeBytes(value.availableDiskBytes),
      modelOnly: value.modelOnly === true, canInstall: value.canInstall === true && artifacts.length > 0 && artifacts.length === value.artifacts?.length };
  };
  const publicRuntimeResult = value => {
    const result = { ok: value?.ok === true };
    if (value?.canceled === true) return { ...result, canceled: true };
    if (!result.ok) return { ok: false, errorCode: /^COMFYUI_RUNTIME_[A-Z0-9_]+$/.test(value?.errorCode || "") ? value.errorCode : "COMFYUI_RUNTIME_CONTROL_FAILED", error: runtimeText(value?.error, 500) || "本机运行环境操作未完成。" };
    for (const [key, project] of [["manifests", publicRuntimeManifest], ["runtimes", publicRuntime], ["jobs", publicRuntimeJob]]) if (Array.isArray(value?.[key])) result[key] = value[key].map(project).filter(Boolean);
    for (const [key, project] of [["manifest", publicRuntimeManifest], ["runtime", publicRuntime], ["job", publicRuntimeJob]]) if (value?.[key]) result[key] = project(value[key]);
    if (value?.plan || value?.planId) result.plan = publicRuntimePlan(value.plan || value);
    return result;
  };
  const runtimeActions = { "runtime-list": ["list", [], []], "manifest-import": ["importManifest", [], []], "runtime-plan": ["plan", ["manifestId"], ["runtimeId"]],
    "runtime-install": ["install", ["planId"], []], "runtime-pause": ["pause", ["jobId"], []], "runtime-resume": ["resume", ["jobId"], []],
    "runtime-existing-import": ["registerExisting", [], []], "runtime-rollback": ["rollback", ["runtimeId"], ["revisionId"]], "runtime-remove": ["remove", ["runtimeId"], []],
    "runtime-start": ["start", ["runtimeId"], []], "runtime-stop": ["stop", ["runtimeId"], []], "runtime-status": ["status", [], ["runtimeId", "jobId"]] };

  ipcMain.handle("naimage:server:license-status", async (_event, payload = {}) => {
    return await licenseService.verify({
      force: payload?.force === true,
      scope: payload?.scope === "custom" ? "custom" : payload?.scope === "account" ? "account" : undefined
    });
  });

  ipcMain.handle("naimage:server:activate-license", async (_event, payload = {}) => {
    return await licenseService.activate(payload?.code);
  });

  ipcMain.handle("naimage:server:configure-custom", async (_event, payload = {}) => {
    if (accessPolicy?.customApiAccess === false) {
      return {
        ok: false,
        errorCode: "CUSTOM_API_ACCESS_DISABLED",
        error: "此发行版仅支持 SparkAPI 账号登录，不能配置其他 Base URL 或 API Key。"
      };
    }
    const current = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      const next = migrateSettings({
        ...current,
        accessMode: "custom",
        agentBaseUrl: String(payload?.baseUrl || "").trim(),
        agentApiKey: String(payload?.apiKey || "").trim(),
        imageBaseUrl: String(payload?.baseUrl || "").trim(),
        imageApiKey: String(payload?.apiKey || "").trim(),
        modelGroup: "",
        serverToken: "",
        agentModel: String(payload?.agentModel || current.agentModel || "").trim(),
        agentModelPool: String(payload?.agentModel || current.agentModel || "").trim() ? [String(payload?.agentModel || current.agentModel).trim()] : current.agentModelPool,
        imageModel: String(payload?.imageModel || current.imageModel || "").trim(),
        imageModelPool: String(payload?.imageModel || current.imageModel || "").trim() ? [String(payload?.imageModel || current.imageModel).trim()] : current.imageModelPool
      });
      customApiCredentials(next, "agent");
      writeJson(settingsPath, next);
      let modelSettings;
      let warning = "";
      try {
        modelSettings = await newApiModelSettings(next, { forceRefresh: true });
      } catch (error) {
        warning = error instanceof Error ? error.message : String(error);
        if (!next.agentModel && !next.imageModel) throw error;
        modelSettings = await modelSettingsWithCacheMeta(splitModelSettings(next, [...next.agentModelPool, ...next.imageModelPool, ...next.videoModelPool]), "settings", Date.now());
      }
      return {
        ok: true,
        user: { id: "custom-api", username: "自定义接口", account: "自定义接口", name: "自定义 API" },
        settings: modelSettings,
        license: { ok: true, active: true, required: false, supported: true, scope: "custom", plan: "free" },
        warning
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`custom API configuration failed ${message}`);
      return { ok: false, errorCode: error?.code, error: message };
    }
  });

  ipcMain.handle("naimage:server:register", async (_event, payload) => {
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

  ipcMain.handle("naimage:server:login", async (_event, payload) => {
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

  ipcMain.handle("naimage:server:logout", async () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (aidebugMode && !aidebugLiveImage && aidebugStatefulAuth) aidebugAuthenticated = false;
    let remoteLogout = false;
    try {
      if (!(aidebugMode && !aidebugLiveImage) && settings.serverSessionCookie && settings.serverUserId) {
        await logoutNewApiSession(settings);
        remoteLogout = true;
      }
    } catch (error) {
      log(`new-api remote logout failed ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearNewApiAuth(settings);
    }
    log("new-api logout");
    return { ok: true, remoteLogout };
  });

  ipcMain.handle("naimage:server:me", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (settings.accessMode === "custom") {
      if (!settings.agentBaseUrl || !settings.agentApiKey) return { ok: false, error: "请先配置自定义 Base URL 和 API Key。" };
      const user = { id: "custom-api", username: "自定义接口", account: "自定义接口", name: "自定义 API" };
      if (payload?.preferCached === true) {
        return {
          ok: true,
          cached: true,
          user,
          settings: await modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now())
        };
      }
      return newApiModelSettings(settings).then((modelSettings) => ({ ok: true, user, settings: modelSettings })).catch(async (error) => ({
        ok: true,
        user,
        settings: await modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now()),
        warning: error instanceof Error ? error.message : String(error)
      }));
    }
    if (payload?.preferCached === true && settings.serverSessionCookie && settings.serverUserId && !(aidebugMode && !aidebugLiveImage)) {
      const cachedUser = normalizeNewApiUser({
        id: settings.serverUserId,
        username: "SparkAI 用户",
        display_name: "SparkAI 用户"
      });
      return {
        ok: true,
        cached: true,
        user: cachedUser,
        wallet: walletFromNewApiUser(cachedUser),
        settings: await modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now())
      };
    }
    const authEpoch = getNewApiAuthEpoch();
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
            headers: newApiUserAuthHeaders(settings),
            userAuth: true
          });
          userData = self?.data || {};
        } catch (error) {
          if (isNewApiAuthError(error)) throw error;
          log(`new-api self in me failed ${error instanceof Error ? error.message : String(error)}`);
        }
        let modelSettings;
        try {
          modelSettings = await newApiModelSettings(settings);
        } catch (error) {
          log(`new-api models in me failed ${error instanceof Error ? error.message : String(error)}`);
          modelSettings = await modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now());
        }
        const accountSummary = await newApiAccountService.summary(settings, userData);
        if (authEpoch !== getNewApiAuthEpoch()) {
          return { ok: false, stale: true, error: "登录账户已切换，旧请求结果已丢弃。" };
        }
        return {
          ok: true,
          ...accountSummary,
          settings: modelSettings
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (authEpoch !== getNewApiAuthEpoch() || error?.code === "NEW_API_SESSION_CHANGED") {
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

  ipcMain.handle("naimage:server:logs", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api logs");
    if (settings.accessMode === "custom") return { ok: true, logs: [] };
    if (aidebugMode && !aidebugLiveImage) {
      const { normalizeLogQuery } = require("../new-api-account.cjs");
      const query = normalizeLogQuery(payload);
      const types = { 1: "topup", 2: "consume", 3: "manage", 4: "system", 5: "error", 6: "refund", 7: "login" };
      const logs = aidebugLogs().filter((entry) => (!query.type || entry.type === types[query.type])
        && (!query.model || String(entry.detail?.model || "").includes(query.model))
        && (!query.tokenName || String(entry.detail?.tokenName || "").includes(query.tokenName))
        && (!query.startTime || Date.parse(entry.createdAt) / 1000 >= query.startTime)
        && (!query.endTime || Date.parse(entry.createdAt) / 1000 <= query.endTime));
      return { ok: true, logs: logs.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), page: query.page, pageSize: query.pageSize, total: logs.length, hasMore: query.page * query.pageSize < logs.length };
    }
    try {
      return await newApiAccountService.logs(settings, payload);
    } catch (error) {
      const { safeAccountText } = require("../new-api-account.cjs");
      const message = safeAccountText(error instanceof Error ? error.message : String(error));
      log(`new-api logs failed ${message}`);
      return { ok: false, error: message, logs: [] };
    }
  });

  ipcMain.handle("naimage:server:models", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (typeof payload?.group === "string") settings.modelGroup = payload.group.trim().slice(0, 120);
    log("new-api models");
    try {
      const modelSettings = await newApiModelSettings(settings, {
        forceRefresh: payload?.forceRefresh === true,
        cacheOnly: payload?.cacheOnly === true
      });
      return { ok: true, settings: modelSettings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, settings: splitModelSettings(settings, []) };
    }
  });

  ipcMain.handle("naimage:server:probe-models", async (_event, payload = {}) => {
    if (accessPolicy?.customApiAccess === false) {
      return { ok: false, error: "此发行版不允许读取自定义渠道模型目录。", models: [] };
    }
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      const result = await probeModelChannel(settings, payload);
      return {
        ok: true,
        models: result.models || [],
        ...(result.source && typeof result.source === "object" ? {
          source: {
            ...(result.source.id ? { id: String(result.source.id).slice(0, 160) } : {}),
            ...(result.source.label ? { label: String(result.source.label).slice(0, 160) } : {}),
            ...(result.source.baseUrl ? { baseUrl: String(result.source.baseUrl).slice(0, 2_048) } : {}),
            ...(result.source.cacheSource ? { cacheSource: result.source.cacheSource } : {}),
            ...(Number.isFinite(Number(result.source.cacheAgeMs)) ? { cacheAgeMs: Math.max(0, Number(result.source.cacheAgeMs)) } : {})
          }
        } : {})
      };
    } catch (error) {
      const { safeAccountText } = require("../new-api-account.cjs");
      const message = safeAccountText(error instanceof Error ? error.message : String(error));
      log(`model channel probe failed ${message}`);
      return { ok: false, error: message, models: [] };
    }
  });

  ipcMain.handle("naimage:server:tokens", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (settings.accessMode === "custom") throw new Error("自定义接口模式不使用 SparkAPI 账户密钥。");
      if (aidebugMode && !aidebugLiveImage) {
        const { normalizeAccountQuotaPolicy, accountTokenQuotaFields } = require("../account-token-quota.cjs");
        const quotaPolicy = normalizeAccountQuotaPolicy({ quota_per_unit: 500_000, usd_exchange_rate: 7.3, quota_display_type: "USD" });
        return {
          ok: true,
          cached: payload?.preferCached === true,
          cacheAvailable: true,
          cacheUpdatedAt: Date.now(),
          selectedTokenId: "1",
          baseUrl: "https://sparkapi.org/v1",
          quotaPolicy,
          tokens: [{
            id: "1",
            name: "AIDebug 密钥",
            status: 1,
            remainQuota: 5_000_000,
            usedQuota: 500_000,
            unlimitedQuota: false,
            expiredTime: -1,
            createdTime: 0,
            accessedTime: 0,
            group: "default",
            modelLimitsEnabled: payload?.preferCached !== true,
            modelLimits: payload?.preferCached === true ? "" : "gpt-image-2",
            allowIps: payload?.preferCached === true ? "" : "203.0.113.7",
            crossGroupRetry: true,
            ...accountTokenQuotaFields(5_000_000, false, quotaPolicy)
          }]
        };
      }
      return await accountTokenService.list(settings, { preferCached: payload?.preferCached === true });
    } catch (error) {
      return { ok: false, tokens: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:select-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) return { ok: true, selectedTokenId: String(payload.id || "1"), baseUrl: "https://sparkapi.org/v1" };
      return await accountTokenService.select(settings, payload.id);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:create-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) throw new Error("AIDebug 不会修改远端密钥。");
      return await accountTokenService.create(settings, payload);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:update-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) throw new Error("AIDebug 不会修改远端密钥。");
      return await accountTokenService.update(settings, payload);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:delete-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) throw new Error("AIDebug 不会修改远端密钥。");
      return await accountTokenService.remove(settings, payload.id);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:recharge", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api recharge requested");
    return {
      ok: false,
      error: "New API 充值需要走服务端支付/兑换流程，本地测试充值接口已移除。",
      user: settings.serverUserId ? { id: settings.serverUserId } : undefined
    };
  });

  ipcMain.handle("naimage:server:comfyui", async (_event, payload = {}) => {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !["action", "baseUrl", "connectionId", "profileId", "label", "outputNodeId", "inputMappings", "projectId", "conversationId", "sourceImage", "draftId", "capability", "key", "networkScope", "credentialType", "enabled", "confirmed", "manifestId", "planId", "runtimeId", "jobId", "revisionId"].includes(key))) throw controlInvalid();
      if (Object.prototype.hasOwnProperty.call(runtimeActions, payload.action)) {
        const [method, required, optional] = runtimeActions[payload.action];
        if (Object.keys(payload).some(key => !["action", ...required, ...optional].includes(key)) || required.some(key => !safeControlId(payload[key])) || optional.some(key => payload[key] !== undefined && !safeControlId(payload[key]))) throw controlInvalid();
        if (typeof comfyUiRuntimeService?.[method] !== "function") throw Object.assign(new Error("ComfyUI 本机运行环境管理不可用。"), { code: "COMFYUI_RUNTIME_SERVICE_UNAVAILABLE" });
        const input = Object.fromEntries([...required, ...optional].filter(key => payload[key] !== undefined).map(key => [key, payload[key]]));
        return publicRuntimeResult(await (required.length + optional.length ? comfyUiRuntimeService[method](input) : comfyUiRuntimeService[method]()));
      }
      if (payload.action === "list") return publicTemplateResult(await comfyUiTemplateService.list());
      if (["import", "workflow-preview-import"].includes(payload.action)) {
        if (Object.keys(payload).some(key => !["action", "label"].includes(key)) || (payload.label !== undefined && (typeof payload.label !== "string" || !payload.label.trim() || payload.label.length > 100))) throw controlInvalid();
        if (typeof comfyUiTemplateService?.previewImport !== "function") throw Object.assign(new Error("ComfyUI 工作流预检不可用。"), { code: "COMFYUI_TEMPLATE_IMPORT_UNAVAILABLE" });
        return publicWorkflowPreview(await comfyUiTemplateService.previewImport(payload.label === undefined ? {} : { label: payload.label }));
      }
      if (payload.action === "workflow-approve-import") {
        if (payload.confirmed !== true) throw Object.assign(new Error("批准 ComfyUI 工作流需要 confirmed=true。"), { code: "COMFYUI_WORKFLOW_CONFIRMATION_REQUIRED" });
        if (Object.keys(payload).some(key => !["action", "draftId", "label", "capability", "outputNodeId", "inputMappings", "confirmed"].includes(key)) || !safeControlId(payload.draftId) || !safeControlId(payload.outputNodeId) ||
          !WORKFLOW_CAPABILITIES.includes(payload.capability) || (payload.label !== undefined && (typeof payload.label !== "string" || !payload.label.trim() || payload.label.length > 100)) ||
          !Array.isArray(payload.inputMappings) || payload.inputMappings.length < 1 || payload.inputMappings.length > 64 || payload.inputMappings.some(mapping => !mapping || typeof mapping !== "object" ||
            Object.keys(mapping).some(key => !["nodeId", "inputName", "kind", "index"].includes(key)) || !safeControlId(mapping.nodeId) || typeof mapping.inputName !== "string" || !/^[A-Za-z0-9_]{1,100}$/.test(mapping.inputName) ||
            !Object.prototype.hasOwnProperty.call(MAPPING_PORTS, mapping.kind) || mapping.kind === "image" || (mapping.kind === "referenceImages" ? !Number.isInteger(mapping.index) || mapping.index < 0 || mapping.index > 3 : mapping.index !== undefined))) throw controlInvalid();
        if (typeof comfyUiTemplateService?.approveImport !== "function") throw Object.assign(new Error("ComfyUI 工作流批准不可用。"), { code: "COMFYUI_TEMPLATE_IMPORT_UNAVAILABLE" });
        return publicTemplateResult(await comfyUiTemplateService.approveImport({ draftId: payload.draftId, capability: payload.capability, outputNodeId: payload.outputNodeId,
          inputMappings: publicMappings(payload.inputMappings), ...(payload.label === undefined ? {} : { label: payload.label }) }));
      }
      if (["masks-list", "masks-import"].includes(payload.action)) {
        if (Object.keys(payload).some(key => !["action", "projectId", "conversationId", "sourceImage", ...(payload.action === "masks-import" ? ["confirmed"] : [])].includes(key)) ||
          ![payload.projectId, payload.conversationId].every(value => typeof value === "string" && value.trim() && value.length <= 180)) throw controlInvalid();
        const sourceImage = stableImageIdentity(payload.sourceImage);
        const importing = payload.action === "masks-import";
        if (importing && payload.confirmed !== true) throw Object.assign(new Error("导入 ComfyUI 蒙版需要 confirmed=true。"), { code: "COMFYUI_MASK_CONFIRMATION_REQUIRED" });
        if (typeof comfyUiMaskService?.[importing ? "importMask" : "list"] !== "function") throw Object.assign(new Error("ComfyUI 受管蒙版服务不可用。"), { code: "COMFYUI_MASK_SERVICE_UNAVAILABLE" });
        const value = await comfyUiMaskService[importing ? "importMask" : "list"]({ projectId: payload.projectId, conversationId: payload.conversationId, sourceImage, ...(importing ? { confirmed: true } : {}) });
        if (value?.canceled === true) return { ok: true, canceled: true };
        if (importing) {
          const mask = publicMask(value?.mask);
          if (value?.ok !== true || !mask) throw Object.assign(new Error("ComfyUI 蒙版导入未完成。"), { code: "COMFYUI_MASK_IMPORT_FAILED" });
          return { ok: true, mask };
        }
        return { ok: value?.ok === true, masks: (Array.isArray(value?.masks) ? value.masks : []).map(publicMask).filter(Boolean) };
      }
      if (["connections-list", "connection-list", "connections"].includes(payload.action)) {
        const service = requireConnectionService();
        if (typeof service.list !== "function") throw Object.assign(new Error("ComfyUI 连接列表不可用。"), { code: "COMFYUI_CONNECTION_SERVICE_UNAVAILABLE" });
        const listed = await service.list();
        return { ok: true, connections: publicConnectionResult(Array.isArray(listed) ? listed : listed?.connections || []) };
      }
      if (["connections-save", "connection-save"].includes(payload.action)) {
        requireConfirmed(payload);
        const service = requireConnectionService();
        const connectionId = connectionReference(payload);
        if (payload.credentialType !== undefined && !["none", "bearer", "basic", "mtls"].includes(payload.credentialType)) throw Object.assign(new Error("ComfyUI 凭据类型无效。"), { code: "COMFYUI_CREDENTIAL_MODE_INVALID" });
        if (payload.credentialType && payload.credentialType !== "none") {
          const existing = connectionId && typeof service.get === "function" ? service.get(connectionId) : null;
          if (!existing || payload.credentialType !== (existing.credentialMode || existing.credentialType)) throw Object.assign(new Error("请先保存连接，再通过原生文件选择导入所选类型的凭据。"), { code: "COMFYUI_CREDENTIAL_IMPORT_REQUIRED" });
        }
        const input = {
          ...(connectionId ? { connectionId, id: connectionId } : {}), label: String(payload.label || ""),
          networkScope: String(payload.networkScope || "local"), baseUrl: String(payload.baseUrl || ""),
          ...(payload.credentialType !== undefined ? { credentialType: String(payload.credentialType) } : {}),
          ...(payload.enabled !== undefined ? { enabled: payload.enabled === true } : {}), confirmed: true
        };
        const result = typeof service.upsert === "function"
          ? await service.upsert(input)
          : connectionId && typeof service.update === "function"
          ? await service.update(connectionId, input)
          : !connectionId && typeof service.create === "function"
            ? await service.create(input)
            : (() => { throw Object.assign(new Error("ComfyUI 连接保存不可用。"), { code: "COMFYUI_CONNECTION_SERVICE_UNAVAILABLE" }); })();
        const connection = result?.connection || result?.profile || result;
        const connections = Array.isArray(result?.connections) ? result.connections : typeof service.list === "function" ? await service.list() : [];
        return { ok: true, connection: publicConnection(connection), connections: publicConnectionResult(connections) };
      }
      if (payload.action === "connections-update-metadata") {
        requireConfirmed(payload);
        if (Object.keys(payload).some(key => !["action", "connectionId", "label", "enabled", "confirmed"].includes(key))) throw Object.assign(new Error("连接元数据更新只允许名称和启用状态。"), { code: "COMFYUI_REQUEST_INVALID" });
        const service = requireConnectionService();
        const connectionId = connectionReference(payload);
        if (!connectionId) throw Object.assign(new Error("缺少 ComfyUI connectionId。"), { code: "COMFYUI_CONNECTION_REQUIRED" });
        if (typeof service.get !== "function" || !service.get(connectionId)) throw Object.assign(new Error("ComfyUI 连接不存在，请先在连接设置中配置。"), { code: "COMFYUI_CONNECTION_NOT_FOUND" });
        const changes = {};
        if (payload.label !== undefined) {
          if (typeof payload.label !== "string" || !payload.label.trim() || payload.label.length > 100) throw Object.assign(new Error("ComfyUI 连接名称无效。"), { code: "COMFYUI_REQUEST_INVALID" });
          changes.label = payload.label;
        }
        if (payload.enabled !== undefined) {
          if (typeof payload.enabled !== "boolean") throw Object.assign(new Error("ComfyUI 连接启用状态无效。"), { code: "COMFYUI_REQUEST_INVALID" });
          changes.enabled = payload.enabled;
        }
        if (!Object.keys(changes).length) throw Object.assign(new Error("请提供连接名称或启用状态。"), { code: "COMFYUI_REQUEST_INVALID" });
        const connection = await service.update(connectionId, changes);
        const connections = typeof service.list === "function" ? await service.list() : [];
        return { ok: true, connection: publicConnection(connection), connections: publicConnectionResult(connections) };
      }
      if (["connections-delete", "connection-delete"].includes(payload.action)) {
        requireConfirmed(payload);
        const service = requireConnectionService();
        if (typeof service.remove !== "function") throw Object.assign(new Error("ComfyUI 连接删除不可用。"), { code: "COMFYUI_CONNECTION_SERVICE_UNAVAILABLE" });
        const connectionId = connectionReference(payload);
        if (!connectionId) throw Object.assign(new Error("缺少 ComfyUI connectionId。"), { code: "COMFYUI_CONNECTION_REQUIRED" });
        const removed = await service.remove(connectionId, { confirmed: true });
        const connections = typeof service.list === "function" ? await service.list() : [];
        return { ok: true, removed: removed === true || removed?.removed === true, connections: publicConnectionResult(connections) };
      }
      if (["connections-credential-import", "connection-credential-import"].includes(payload.action)) {
        requireConfirmed(payload);
        const service = requireConnectionService();
        const connectionId = connectionReference(payload);
        if (!connectionId) throw Object.assign(new Error("缺少 ComfyUI connectionId。"), { code: "COMFYUI_CONNECTION_REQUIRED" });
        const mode = payload.credentialType;
        if (!["bearer", "basic", "mtls"].includes(mode)) throw Object.assign(new Error("请选择 ComfyUI 凭据类型。"), { code: "COMFYUI_CREDENTIAL_MODE_INVALID" });
        const existing = typeof service.get === "function" ? service.get(connectionId) : service.resolve({ connectionId });
        if (!existing) throw Object.assign(new Error("ComfyUI 连接不存在。"), { code: "COMFYUI_CONNECTION_NOT_FOUND" });
        if (typeof comfyUiCredentialStore?.importCredential !== "function" || typeof service.update !== "function") throw Object.assign(new Error("ComfyUI 受保护凭据导入不可用。"), { code: "COMFYUI_CREDENTIAL_IMPORT_UNAVAILABLE" });
        const imported = await comfyUiCredentialStore.importCredential({ mode });
        if (imported?.canceled === true) return { ok: true, canceled: true };
        if (imported?.ok !== true || imported?.credentialRef?.mode !== mode) throw Object.assign(new Error("ComfyUI 凭据导入失败。"), { code: "COMFYUI_CREDENTIAL_IMPORT_INVALID" });
        let connection;
        try { connection = await service.update(connectionId, { credentialRef: imported.credentialRef }); }
        catch (error) {
          try { (comfyUiCredentialStore.remove || comfyUiCredentialStore.delete)?.(imported.credentialRef); } catch {}
          throw error;
        }
        const connections = typeof service.list === "function" ? await service.list() : [];
        return { ok: true, connection: publicConnection(connection), connections: publicConnectionResult(connections) };
      }
      if (["connections-test", "connection-test"].includes(payload.action)) {
        requireConfirmed(payload);
        const service = requireConnectionService();
        const connectionId = connectionReference(payload);
        if (!connectionId) throw Object.assign(new Error("缺少 ComfyUI connectionId。"), { code: "COMFYUI_CONNECTION_REQUIRED" });
        let result;
        if (typeof service.test === "function") result = await service.test({ connectionId, confirmed: true });
        else if (typeof service.inspect === "function") result = await service.inspect({ connectionId, confirmed: true, test: true });
        else if (typeof comfyUiTemplateService?.inspect === "function") result = await comfyUiTemplateService.inspect({ connectionId, confirmed: true, test: true });
        else throw Object.assign(new Error("ComfyUI 连接测试不可用。"), { code: "COMFYUI_CONNECTION_SERVICE_UNAVAILABLE" });
        return publicConnectionResult(result);
      }
      if (payload.action === "inspect") {
        const connectionId = connectionReference(payload);
        if (connectionId && connectionService && typeof connectionService.inspect === "function") return publicConnectionResult(await connectionService.inspect({ connectionId, confirmed: payload.confirmed === true }));
        if (connectionId && !connectionService) throw Object.assign(new Error("ComfyUI 连接配置服务不可用。"), { code: "COMFYUI_CONNECTION_SERVICE_UNAVAILABLE" });
        return await comfyUiTemplateService.inspect(payload);
      }
      if (payload.action === "cancel") {
        const projectId = String(payload.projectId || ""), key = String(payload.key || ""), connectionId = connectionReference(payload);
        return await imageOperationJournal.cancel(projectId, key, connectionId ? { connectionId } : undefined);
      }
      throw Object.assign(new Error("未知的本地生图动作。"), { code: "COMFYUI_REQUEST_INVALID" });
    } catch (error) {
      const runtimeAction = Object.prototype.hasOwnProperty.call(runtimeActions, payload?.action);
      const known = /^COMFYUI_|^IMAGE_/.test(error?.code) || runtimeAction && /^MANAGED_ARTIFACT_/.test(error?.code);
      return { ok: false, errorCode: known ? error.code : runtimeAction ? "COMFYUI_RUNTIME_CONTROL_FAILED" : "COMFYUI_CONTROL_FAILED",
        error: runtimeAction ? known ? runtimeText(error.message, 500) : "本机运行环境操作未完成。" : known ? error.message : "本机 ComfyUI 服务未连接或模板处理失败。" };
    }
  });

  ipcMain.handle("naimage:server:image-operations", (_event, payload = {}) => {
    try { return { ok: true, operations: imageOperationJournal.list(String(payload.projectId || "")) }; }
    catch { return { ok: false, operations: [], error: "图片恢复记录读取失败。" }; }
  });
  ipcMain.handle("naimage:server:recover-image", async (_event, payload = {}) => {
    try {
      const result = await imageOperationJournal.recover(String(payload.projectId || ""), String(payload.key || ""));
      if (!result.assets.length && (result.pending || result.unknown || result.failed)) return { ok: false, assets: [],
        errorCode: result.unknown ? "IMAGE_OPERATION_UNCERTAIN" : result.failed ? "IMAGE_OPERATION_TERMINAL" : "IMAGE_OPERATION_PENDING",
        error: result.unknown ? "原本地任务结果仍未知，未重新提交。" : result.failed ? "原本地任务已经执行失败。" : "原本地任务仍在排队或运行，请稍后恢复。" };
      return { ok: true, assets: result.assets, operation: { key: result.operation.key, targetNodeId: result.operation.targetNodeId,
        sourceNodeIds: result.operation.sourceNodeIds, operationId: result.operation.operationId, requestIndex: result.operation.requestIndex,
        state: result.operation.state, resultCount: result.operation.resultCount } };
    } catch (error) {
      const known = String(error.code || "").startsWith("IMAGE_");
      return { ok: false, assets: [], errorCode: known ? error.code : "IMAGE_RECOVERY_FAILED", error: known ? error.message : "原结果获取或本地保存未完成，请稍后恢复原操作；不会重新生图。" };
    }
  });

  ipcMain.handle("naimage:server:generate-image", async (event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    const runId = String((payload ?? {}).runId || `run-${Date.now()}`);
    const operationId = String((payload ?? {}).operationId || runId);
    const requestIndex = Math.max(1, Math.min(10_000, Math.floor(Number((payload ?? {}).requestIndex || 1) || 1)));
    const projectId = String((payload ?? {}).projectId || "").trim();
    const conversationId = String((payload ?? {}).conversationId || "").trim();
    if (!projectId) return { ok: false, errorCode: "PROJECT_REQUIRED", error: "请先创建或打开项目，再生成图片。" };
    if (typeof getProjectById === "function" && typeof readProjectList === "function" && !getProjectById(projectId, readProjectList())) {
      return { ok: false, errorCode: "PROJECT_NOT_FOUND", error: "当前项目不存在或已经被移除，请重新打开项目。" };
    }
    if (!conversationId) return { ok: false, errorCode: "CONVERSATION_REQUIRED", error: "请先创建或选择一个对话，再生成图片。" };
    const isComfyUi = String((payload ?? {}).provider || "").toLowerCase() === "comfyui";
    if (isComfyUi && ((payload ?? {}).maskImage !== undefined || (payload ?? {}).maskDataUrl !== undefined)) {
      return { ok: false, errorCode: "COMFYUI_INPUT_INVALID", error: "ComfyUI 蒙版只能由受管 maskImage 身份引用，不能传路径或内联数据。", assets: [], runId };
    }
    let controlledRun;
    const ownedMaskImage = (payload ?? {}).maskDataUrl
      ? writeDataUrlTemp((payload ?? {}).maskDataUrl, `mask-${runId.replace(/[^a-z0-9_-]/gi, "-")}`, projectId)
      : null;
    try {
      controlledRun = agentRunControl?.begin({
        runId,
        ownerId: String(event?.sender?.id ?? ""),
        projectId,
        conversationId,
        nodeIds: Array.isArray((payload ?? {}).nodeIds) ? (payload ?? {}).nodeIds : []
      });
      if (controlledRun) {
        await agentRunControl?.waitUntilRunnable(controlledRun, controlledRun.signal);
      }
      const maskImage = ownedMaskImage || (payload ?? {}).maskImage;
      if (isComfyUi && ["workflow", "inputs", "inputMappings", "baseUrl"].some(key => Object.prototype.hasOwnProperty.call(payload, key))) throw Object.assign(new Error("本地生图必须使用 Main 已审核的模板和项目素材。"), { code: "COMFYUI_REQUEST_INVALID" });
      const comfyui = isComfyUi ? comfyUiTemplateService.resolve(payload?.comfyui) : undefined;
      const data = await callNewApiImageWithSession(settings, {
        ...(isComfyUi ? { provider: "comfyui", comfyui } : {}),
        prompt: (payload ?? {}).prompt,
        model: (payload ?? {}).model,
        size: (payload ?? {}).size || settings.imageSize,
        ratio: (payload ?? {}).ratio || (payload ?? {}).aspectRatio,
        resolution: (payload ?? {}).resolution,
        quality: (payload ?? {}).quality || settings.imageQuality,
        count: (payload ?? {}).count || settings.imageCount,
        referenceImages: Array.isArray((payload ?? {}).referenceImages) ? (payload ?? {}).referenceImages : [],
        editImage: (payload ?? {}).editImage,
        ...(isComfyUi ? {} : { maskImage }),
        outputFormat: (payload ?? {}).outputFormat ?? (payload ?? {}).output_format,
        outputCompression: (payload ?? {}).outputCompression ?? (payload ?? {}).output_compression,
        background: (payload ?? {}).background,
        moderation: (payload ?? {}).moderation,
        inputFidelity: (payload ?? {}).inputFidelity ?? (payload ?? {}).input_fidelity,
        mode: (payload ?? {}).mode,
        editOperation: (payload ?? {}).editOperation,
        regions: (payload ?? {}).regions,
        requireAlpha: (payload ?? {}).requireAlpha,
        layerOutputMode: (payload ?? {}).layerOutputMode,
        runId, operationId, requestIndex, nodeIds: payload?.nodeIds, targetNodeId: payload?.targetNodeId,
        projectId, conversationId,
        signal: controlledRun?.signal,
        ...(isComfyUi ? { onStatus: status => emitAgentProgress(event.sender, runId, { phase: "image-progress", tool: "image_gen", summary: "ComfyUI 本地任务进度", progress: status, projectId }) } : {}),
        onPartialImage: (partial) => emitAgentProgress(event.sender, runId, {
          phase: "image-preview",
          tool: "image_gen",
          operationId,
          toolRunId: operationId,
          childTaskId: runId,
          summary: `已收到第 ${Math.max(1, Number(partial?.index || 1))}/${Math.max(1, Number(partial?.total || 3))} 张中间预览。`,
          partialImage: {
            dataUrl: String(partial?.dataUrl || ""),
            index: Math.max(1, Number(partial?.index || 1)),
            total: Math.max(1, Number(partial?.total || 3)),
            requestIndex
          },
          projectId
        }),
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
      const assets = await deliverGeneratedImageResult(settings, data, { ...payload, runId, projectId });
      log(`new-api generate image returned=${assets.length}`);
      return { ok: true, model: data.model, protocol: data.protocol, gateway: data.gateway,
        ...(isComfyUi && data.actualParams ? { size: `${data.actualParams.width}x${data.actualParams.height}` } : {}), assets, runId, returned: assets.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (String(payload?.provider || "").toLowerCase() !== "comfyui" && /invalid token|unauthorized|401/i.test(message)) {
        clearNewApiAuth(settings);
      }
      log(`new-api generate image failed ${message}`);
      const data = error && typeof error === "object" && error.data && typeof error.data === "object" ? error.data : {};
      return {
        ...data,
        ok: false,
        error: message,
        errorCode: error && typeof error === "object" ? error.code : undefined,
        errorCategory: error && typeof error === "object" ? (error.category || error.errorCategory) : undefined,
        status: error && typeof error === "object" ? error.status : undefined,
        provider: error && typeof error === "object" ? error.provider : undefined,
        protocol: error && typeof error === "object" ? error.protocol : undefined,
        gateway: error && typeof error === "object" ? error.gateway : undefined,
        taskId: error && typeof error === "object" ? error.taskId : undefined,
        ambiguous: error && typeof error === "object" ? error.ambiguous === true : undefined,
        unsafeToRetry: error && typeof error === "object" ? error.unsafeToRetry === true : undefined,
        retryCount: error && typeof error === "object" ? error.retryCount : undefined,
        attempts: error && typeof error === "object" ? error.attempts : undefined,
        runId,
        assets: []
      };
    } finally {
      if (controlledRun) agentRunControl?.finish({ runId });
      removeOwnedDataUrlTemp(ownedMaskImage, projectId);
    }
  });
}

module.exports = { registerServerIpc };
