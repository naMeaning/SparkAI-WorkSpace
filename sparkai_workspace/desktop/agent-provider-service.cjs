"use strict";

// Main owns endpoint configuration, credentials and live execution bindings.
// The public surface only projects stable identities and declared capabilities.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { createHash, randomUUID } = require("node:crypto");
const { createComfyUiCredentialStore } = require("./comfyui-credential-store.cjs");
const { assertManagedArtifactPath } = require("./managed-artifact-store.cjs");
const { normalizeComfyUiConnectionUrl, resolveComfyUiConnectionNetwork } = require("./comfyui-connection-service.cjs");
const { chatRequestFromRuntimeRequest } = require("./agent-responses-adapter.cjs");
const { messageFromResponse, responseFromStreamChunks } = require("../runtime/responses-parser.cjs");
const { assertAgentModelRequest } = require("../runtime/agent-provider-policy.cjs");

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_PROFILE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const PRIVATE_ERROR = Symbol("agent-provider-error");
const plain = value => value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, retriable: false, [PRIVATE_ERROR]: true, ...extra });
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : plain(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = value => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
const addressKey = value => String(value || "").replace(/^::ffff:/i, "").toLowerCase();
const contextLimitCode = value => typeof value === "string" && /^(?:context_length_exceeded|context_window_exceeded|context_limit_exceeded|max_context_length_exceeded|too_many_tokens|token_limit_exceeded)$/i.test(value);
const publicLabel = value => value.replace(/https?:\/\/\S+|\b[A-Za-z]:[\\/][^\s]+|\b(?:Bearer|Basic)\s+\S+/gi, "[private]");

function exact(value, names) {
  if (!plain(value) || Object.keys(value).some(key => !names.includes(key))) throw fail("AGENT_PROVIDER_PROFILE_INVALID", "本地 Agent 配置包含不支持的字段。");
}
function identity(value, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !ID.test(value)) throw fail("AGENT_PROVIDER_ID_INVALID", "Agent 配置身份无效。");
  return value;
}
function modelIdentity(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,159}$/.test(value) || value.includes("://") || /^[A-Za-z]:[\\/]/.test(value) || value.split("/").some(part => part === "." || part === "..")) throw fail("AGENT_PROVIDER_MODEL_INVALID", "请声明唯一、有效的本地模型身份，不能使用文件路径。");
  return value;
}
function normalizeCapabilities(value) {
  exact(value, ["tools", "vision", "contextWindowTokens", "maxOutputTokens"]);
  if (typeof value.tools !== "boolean" || typeof value.vision !== "boolean"
    || !Number.isSafeInteger(value.contextWindowTokens) || value.contextWindowTokens < 512 || value.contextWindowTokens > 2_000_000
    || !Number.isSafeInteger(value.maxOutputTokens) || value.maxOutputTokens < 1 || value.maxOutputTokens >= value.contextWindowTokens) {
    throw fail("AGENT_PROVIDER_CAPABILITIES_INVALID", "模型必须明确工具、视觉、上下文窗口与输出上限。");
  }
  return { tools: value.tools, vision: value.vision, contextWindowTokens: value.contextWindowTokens, maxOutputTokens: value.maxOutputTokens };
}
function normalizeEndpoint(value) {
  try {
    const normalized = normalizeComfyUiConnectionUrl(value, { networkScope: "local" });
    const url = new URL(normalized);
    if (!["/", "/v1/"].includes(url.pathname)) throw new Error();
    return `${url.origin}/v1`;
  } catch { throw fail("AGENT_PROVIDER_ENDPOINT_INVALID", "本地模型地址只允许回环 HTTP(S) 主机及 /v1 前缀。"); }
}
function normalizeDescriptor(raw) {
  exact(raw, ["label", "kind", "modelId", "capabilities", "baseUrl", "runtimeId", "credentialRef", "credentialFingerprint"]);
  if (typeof raw.label !== "string" || !raw.label.trim() || raw.label !== raw.label.trim() || raw.label.length > 120 || /[\u0000-\u001f\u007f]/.test(raw.label)) throw fail("AGENT_PROVIDER_PROFILE_INVALID", "Agent 配置名称无效。");
  if (!["local-openai-compatible", "managed-local"].includes(raw.kind)) throw fail("AGENT_PROVIDER_KIND_INVALID", "原生导入只接受本地兼容连接或托管本地模型。");
  const value = { label: raw.label, kind: raw.kind, modelId: modelIdentity(raw.modelId), capabilities: normalizeCapabilities(raw.capabilities) };
  if (raw.kind === "local-openai-compatible") {
    if (raw.runtimeId !== undefined) throw fail("AGENT_PROVIDER_PROFILE_INVALID", "兼容端点不能声明托管运行环境。");
    value.baseUrl = normalizeEndpoint(raw.baseUrl);
    if (raw.credentialRef?.mode === "none" || raw.credentialRef === undefined) {
      if (raw.credentialRef !== undefined) exact(raw.credentialRef, ["mode"]);
      if (raw.credentialFingerprint !== undefined) throw fail("AGENT_PROVIDER_CREDENTIAL_INVALID", "无认证连接不能携带凭据摘要。");
      value.credentialRef = { mode: "none" };
    }
    else {
      exact(raw.credentialRef, ["mode", "id"]);
      if (raw.credentialRef.mode !== "bearer" || !HASH.test(raw.credentialFingerprint || "")) throw fail("AGENT_PROVIDER_CREDENTIAL_INVALID", "本地 Agent 凭据引用无效。");
      value.credentialRef = { mode: "bearer", id: identity(raw.credentialRef.id) }; value.credentialFingerprint = raw.credentialFingerprint;
    }
  } else {
    if (raw.baseUrl !== undefined || raw.credentialRef !== undefined || raw.credentialFingerprint !== undefined) throw fail("AGENT_PROVIDER_PROFILE_INVALID", "托管本地模型的端点只能由 Main 运行环境提供。");
    value.runtimeId = identity(raw.runtimeId);
  }
  return value;
}
function safeError(error) {
  if (error?.[PRIVATE_ERROR]) return error;
  if (String(error?.code || "").startsWith("AGENT_") || String(error?.code || "").startsWith("MANAGED_LLM_")) {
    return fail(error.code, "Agent 配置或运行状态不允许此操作。", { status: Number(error.status) || 0, unsafeToRetry: error.unsafeToRetry === true });
  }
  if (String(error?.code || "").startsWith("COMFYUI_CREDENTIAL")) return fail("AGENT_PROVIDER_CREDENTIAL_UNAVAILABLE", "本地 Agent 受保护凭据不可用，请重新导入。");
  return fail("AGENT_PROVIDER_STORAGE_FAILED", "Agent 配置未能安全读取或保存。");
}

function createService(options = {}) {
  if (typeof options.rootDir !== "string" || !path.isAbsolute(options.rootDir) || options.rootDir.startsWith("\\\\")) throw fail("AGENT_PROVIDER_STORAGE_INVALID", "Agent 配置需要本机受管目录。");
  const root = assertManagedArtifactPath(options.rootDir), configFile = path.join(root, "profiles.json"), secretFile = path.join(root, "credentials.secrets.json");
  fs.mkdirSync(root, { recursive: true }); assertManagedArtifactPath(root, { allowMissing: false });
  const credentials = createComfyUiCredentialStore({ safeStorage: options.safeStorage, secretsPath: secretFile });
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 300_000) : 180_000;
  const bindings = new Map(); let selectionQueue = Promise.resolve(), cloudModel = "", disposed = false;
  let state = { schemaVersion: 1, profiles: [], selections: {} };
  function checkedFile(file, maximum, allowMissing = false) {
    assertManagedArtifactPath(file);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum) throw new Error();
      return stat;
    } catch (error) { if (allowMissing && error.code === "ENOENT") return null; throw fail("AGENT_PROVIDER_STORAGE_INVALID", "Agent 配置文件无效，原文件已保留。"); }
  }
  function save(next) {
    checkedFile(configFile, 4 * MAX_PROFILE_BYTES, true);
    const temporary = path.join(root, `profiles.${randomUUID()}.tmp`); let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      assertManagedArtifactPath(configFile); fs.renameSync(temporary, configFile); state = next;
    } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  if (checkedFile(configFile, 4 * MAX_PROFILE_BYTES, true)) {
    let loaded;
    try { loaded = JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { throw fail("AGENT_PROVIDER_STORAGE_INVALID", "Agent 配置记录损坏，原文件已保留。"); }
    exact(loaded, ["schemaVersion", "profiles", "selections"]);
    if (loaded.schemaVersion !== 1 || !Array.isArray(loaded.profiles) || loaded.profiles.length > 256 || !plain(loaded.selections) || Object.keys(loaded.selections).length > 4096) throw fail("AGENT_PROVIDER_STORAGE_INVALID", "Agent 配置记录无效。");
    const seen = new Set();
    for (const record of loaded.profiles) {
      exact(record, ["profileId", "profileHash", "descriptor"]);
      const descriptor = normalizeDescriptor(record.descriptor);
      if (record.profileHash !== digest(descriptor) || record.profileId !== `agent-${record.profileHash.slice(0, 32)}` || seen.has(record.profileId)) throw fail("AGENT_PROVIDER_STORAGE_INVALID", "Agent 配置身份或内容发生变化。");
      seen.add(record.profileId);
    }
    for (const [key, selection] of Object.entries(loaded.selections)) {
      if (key !== "default" && (!key.startsWith("project:") || !ID.test(key.slice(8)))) throw fail("AGENT_PROVIDER_STORAGE_INVALID", "Agent 项目选择记录无效。");
      normalizeSelection(selection);
    }
    state = loaded;
  }
  function assertActive() { if (disposed) throw fail("AGENT_PROVIDER_DISPOSED", "Agent provider 服务已退出。"); }
  function normalizeSelection(value) {
    exact(value, ["profileId", "modelId", "strictOffline"]);
    const profileId = identity(value.profileId), strictOffline = value.strictOffline === true;
    if (value.strictOffline !== undefined && typeof value.strictOffline !== "boolean") throw fail("AGENT_PROVIDER_SELECTION_INVALID", "严格离线选择必须是明确布尔值。");
    if (profileId === "cloud" && strictOffline) throw fail("AGENT_OFFLINE_BLOCKED", "严格离线模式不能选择云端 Agent。");
    return { profileId, ...(value.modelId ? { modelId: modelIdentity(value.modelId) } : {}), strictOffline };
  }
  function selectionKey(projectId) {
    let selectedProject = projectId;
    if (selectedProject === undefined && typeof options.getActiveProjectId === "function") selectedProject = options.getActiveProjectId();
    return selectedProject ? `project:${identity(selectedProject)}` : "default";
  }
  function currentSelection(projectId) { return state.selections[selectionKey(projectId)] || state.selections.default || { profileId: "cloud", strictOffline: false }; }
  function recordFor(profileId) {
    const record = state.profiles.find(item => item.profileId === identity(profileId));
    if (!record) throw fail("AGENT_PROVIDER_NOT_FOUND", "已选择的 Agent 配置不存在，请明确重新选择。");
    return record;
  }
  function profileSnapshot(profileId, selection = {}) {
    if (profileId === "cloud") return { providerKind: "cloud", profileId: "cloud", profileLabel: "云端 Agent", profileHash: digest({ kind: "cloud", policyVersion: 1 }), modelId: selection.modelId || cloudModel,
      capabilities: { tools: true, vision: true, contextWindowTokens: 272_000, maxOutputTokens: 8192 }, strictOffline: false, networkScope: "remote", availability: "unknown" };
    const record = recordFor(profileId), profile = record.descriptor;
    let availability = profile.kind === "managed-local" ? "not-running" : "configured";
    if (profile.kind === "managed-local" && typeof options.managedLocalLlmService?.status === "function") {
      const status = options.managedLocalLlmService.status({ runtimeId: profile.runtimeId });
      if (status?.runtime?.state === "running" || status?.state === "running") availability = "available";
    }
    return { providerKind: profile.kind, profileId: record.profileId, profileLabel: publicLabel(profile.label), profileHash: record.profileHash,
      modelId: profile.modelId, capabilities: clone(profile.capabilities), strictOffline: selection.strictOffline === true, networkScope: "local", availability };
  }
  const selectedSnapshot = projectId => { const selected = currentSelection(projectId); return profileSnapshot(selected.profileId, selected); };
  const publicSync = fn => (...args) => { try { assertActive(); return fn(...args); } catch (error) { const safe = safeError(error); return { ok: false, errorCode: safe.code, error: safe.message }; } };
  const publicAsync = fn => async (...args) => { try { assertActive(); return await fn(...args); } catch (error) { const safe = safeError(error); return { ok: false, errorCode: safe.code, error: safe.message }; } };

  async function importProfile(input = {}) {
    exact(input, []);
    if (typeof options.dialog?.showOpenDialog !== "function") throw fail("AGENT_PROVIDER_DIALOG_REQUIRED", "本地 Agent 配置必须通过 Main 原生文件选择导入。");
    const selection = await options.dialog.showOpenDialog({ title: "导入本地 Agent 配置 JSON", properties: ["openFile"], filters: [{ name: "本地 Agent 配置", extensions: ["json"] }] });
    assertActive();
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: true, canceled: true, profile: null };
    const file = selection.filePaths[0]; checkedFile(file, MAX_PROFILE_BYTES);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { throw fail("AGENT_PROVIDER_IMPORT_INVALID", "请选择有效的本地 Agent 配置 JSON。"); }
    exact(raw, ["schemaVersion", "label", "kind", "modelId", "capabilities", "baseUrl", "runtimeId", "credential"]);
    if (raw.schemaVersion !== 1) throw fail("AGENT_PROVIDER_PROFILE_INVALID", "本地 Agent 配置只支持版本 1。");
    const { schemaVersion: _version, credential, ...source } = raw;
    let token;
    if (credential !== undefined) {
      exact(credential, ["mode", "token"]);
      if (!["none", "bearer"].includes(credential.mode) || credential.mode === "none" && credential.token !== undefined || raw.kind !== "local-openai-compatible") throw fail("AGENT_PROVIDER_CREDENTIAL_INVALID", "本地凭据只支持明确的 none 或 bearer 声明。");
      if (credential.mode === "bearer") {
        token = credential.token;
        if (typeof token !== "string" || !token || token.length > 64 * 1024 || /[^\x21-\x7e]/.test(token)) throw fail("AGENT_PROVIDER_CREDENTIAL_INVALID", "本地 bearer 凭据内容无效。");
        source.credentialFingerprint = digest(token); source.credentialRef = { mode: "bearer", id: `agentcred-${source.credentialFingerprint.slice(0, 32)}` };
      }
    }
    const descriptor = normalizeDescriptor(source), profileHash = digest(descriptor), profileId = `agent-${profileHash.slice(0, 32)}`;
    const prior = state.profiles.find(item => item.profileId === profileId);
    if (!prior && state.profiles.length >= 256) throw fail("AGENT_PROVIDER_CAPACITY", "本地 Agent 配置已达到容量上限。");
    if (token) { checkedFile(secretFile, 8 * MAX_PROFILE_BYTES, true); credentials.set(descriptor.credentialRef, { token }); }
    if (!prior) save({ ...state, profiles: [...state.profiles, { profileId, profileHash, descriptor }] });
    return { ok: true, profile: profileSnapshot(profileId) };
  }
  async function select(input = {}) {
    exact(input, ["projectId", "profileId", "modelId", "strictOffline"]);
    const { projectId, ...candidate } = input, key = selectionKey(projectId), selected = normalizeSelection(candidate);
    if (selected.profileId !== "cloud") {
      const record = recordFor(selected.profileId);
      if (selected.modelId && selected.modelId !== record.descriptor.modelId) throw fail("AGENT_MODEL_CONFLICT", "该本地配置只允许其明确声明的模型。");
      selected.modelId = record.descriptor.modelId;
    }
    const commit = async () => {
      assertActive();
      const admission = options.beforeSelect?.({ projectId: key === "default" ? "" : key.slice(8), profileId: selected.profileId, strictOffline: selected.strictOffline });
      // Main's synchronous network admission and the persisted selection are
      // one turn. Awaiting undefined would open a microtask race after its
      // final network check. Explicit asynchronous hooks retain serialization.
      if (admission && typeof admission.then === "function") await admission;
      assertActive(); save({ ...state, selections: { ...state.selections, [key]: selected } });
      return { ok: true, selected: profileSnapshot(selected.profileId, selected) };
    };
    const result = selectionQueue.then(commit); selectionQueue = result.catch(() => {}); return result;
  }
  function isStrictOffline(projectId) { return currentSelection(projectId).strictOffline === true || [...bindings.values()].some(value => value.snapshot.strictOffline); }
  async function freeze({ projectId, runId, settings = {} } = {}) {
    assertActive(); identity(runId);
    if (bindings.size >= 256) throw fail("AGENT_PROVIDER_CAPACITY", "Agent 活动绑定已达到容量上限。");
    const selected = currentSelection(projectId), snapshot = selectedSnapshot(projectId), frozenSettings = clone(settings);
    let endpoint, release;
    if (snapshot.providerKind === "cloud") {
      if (isStrictOffline(projectId)) throw fail("AGENT_OFFLINE_BLOCKED", "严格离线模式不能创建云端 Agent 请求。");
      snapshot.modelId = modelIdentity(selected.modelId || settings.agentModel || settings.model || ""); cloudModel = snapshot.modelId;
      snapshot.capabilities.contextWindowTokens = Math.max(512, Math.min(2_000_000, Number(settings.contextWindowTokens) || 272_000));
      snapshot.capabilities.maxOutputTokens = Math.min(8192, snapshot.capabilities.contextWindowTokens - 1);
    } else {
      const profile = recordFor(snapshot.profileId).descriptor;
      if (profile.kind === "managed-local") {
        if (typeof options.managedLocalLlmService?.acquireBinding !== "function") throw fail("AGENT_PROVIDER_MANAGED_UNAVAILABLE", "托管本地模型服务尚不可用。");
        const acquired = options.managedLocalLlmService.acquireBinding({ runtimeId: profile.runtimeId, modelId: profile.modelId }, { taskId: `agent:${runId}` });
        release = acquired.release;
        try {
          const capabilities = normalizeCapabilities(acquired.binding.capabilities);
          if (acquired.binding.modelId !== snapshot.modelId || acquired.binding.networkScope !== "local" || typeof release !== "function") throw fail("AGENT_PROVIDER_MANAGED_INVALID", "托管模型绑定与声明不符。");
          snapshot.capabilities = { tools: snapshot.capabilities.tools && capabilities.tools, vision: snapshot.capabilities.vision && capabilities.vision,
            contextWindowTokens: Math.min(snapshot.capabilities.contextWindowTokens, capabilities.contextWindowTokens), maxOutputTokens: Math.min(snapshot.capabilities.maxOutputTokens, capabilities.maxOutputTokens) };
          snapshot.capabilities.maxOutputTokens = Math.min(snapshot.capabilities.maxOutputTokens, snapshot.capabilities.contextWindowTokens - 1);
          endpoint = { baseUrl: normalizeEndpoint(acquired.endpoint.baseUrl), requestModel: modelIdentity(acquired.endpoint.requestModel), headers: {} };
          snapshot.managedRevisionId = identity(acquired.binding.revisionId);
          if (!HASH.test(acquired.binding.bindingHash || "")) throw fail("AGENT_PROVIDER_MANAGED_INVALID", "托管模型缺少不可变运行身份。");
          snapshot.managedBindingHash = acquired.binding.bindingHash;
          snapshot.profileHash = digest({ profileHash: snapshot.profileHash, bindingHash: acquired.binding.bindingHash, capabilities: snapshot.capabilities }); snapshot.availability = "available";
        } catch (error) { if (typeof release === "function") release(); throw error; }
      } else {
        let headers = {};
        if (profile.credentialRef.mode === "bearer") { checkedFile(secretFile, 8 * MAX_PROFILE_BYTES); const secret = credentials.get(profile.credentialRef); if (digest(secret.token) !== profile.credentialFingerprint) throw fail("AGENT_PROVIDER_CREDENTIAL_INVALID", "本地 Agent 凭据与冻结配置不符。"); headers = { authorization: `Bearer ${secret.token}` }; }
        endpoint = { baseUrl: profile.baseUrl, requestModel: profile.modelId, headers };
      }
    }
    try {
      const expected = settings.agentExecution;
      if (expected !== undefined && (!plain(expected) || ["providerKind", "profileId", "profileHash", "modelId", "strictOffline", "networkScope"].some(key => expected[key] !== snapshot[key])
        || canonical(expected.capabilities) !== canonical(snapshot.capabilities)
        || snapshot.providerKind === "managed-local" && (expected.managedRevisionId !== snapshot.managedRevisionId || expected.managedBindingHash !== snapshot.managedBindingHash))) {
        throw fail("AGENT_PROVIDER_RECOVERY_CHANGED", "原 Agent 连接、模型、能力或托管版本已变化；旧任务不会自动继续，请明确创建新任务。");
      }
    } catch (error) { if (typeof release === "function") release(); throw error; }
    const bindingId = `agent-binding-${randomUUID()}`; snapshot.bindingId = bindingId;
    let releasedResolve;
    const releasedPromise = new Promise(resolve => { releasedResolve = resolve; });
    bindings.set(bindingId, { snapshot: clone(snapshot), settings: frozenSettings, ...(endpoint ? { endpoint } : {}), release, controllers: new Set(), released: false, releasedPromise, releasedResolve });
    return clone(snapshot);
  }
  function getBinding(bindingId) {
    const value = bindings.get(identity(bindingId));
    if (!value || value.released) throw fail("AGENT_PROVIDER_BINDING_MISSING", "Agent 运行绑定已结束或不存在，请明确重新开始。");
    return { snapshot: clone(value.snapshot), settings: clone(value.settings), ...(value.endpoint ? { endpoint: clone(value.endpoint) } : {}) };
  }
  function finalizeRelease(bindingId, value) {
    if (!value.released || value.controllers.size || bindings.get(bindingId) !== value) return;
    bindings.delete(bindingId);
    try { value.release?.(); } finally { value.releasedResolve(); }
  }
  async function releaseBinding(bindingId) {
    const value = bindings.get(identity(bindingId)); if (!value || value.released) return false;
    value.released = true; for (const controller of value.controllers) controller.abort();
    finalizeRelease(bindingId, value); await value.releasedPromise; return true;
  }
  function resolveNetwork(endpoint, signal) {
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); error ? reject(error) : resolve(value); };
      const abort = () => finish(fail("AGENT_PROVIDER_ABORTED", "本地 Agent 请求已取消。"));
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) return abort();
      timer = setTimeout(() => finish(fail("AGENT_PROVIDER_DNS_TIMEOUT", "本地 Agent 主机解析超时。")), Math.min(timeoutMs, 30_000));
      void resolveComfyUiConnectionNetwork({ id: "local-agent", label: "Local Agent", baseUrl: endpoint.baseUrl, networkScope: "local", credentialRef: { mode: "none" } }, { lookup: options.lookup })
        .then(value => finish(null, value), () => finish(fail("AGENT_PROVIDER_DNS_DENIED", "本地 Agent 主机解析必须全部为回环地址。")));
    });
  }
  function validateRequest(snapshot, payload, settings) {
    if (!plain(payload) || !Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 4096) throw fail("AGENT_PROVIDER_REQUEST_INVALID", "本地 Agent 请求消息无效。");
    const model = payload.model === undefined ? snapshot.modelId : payload.model;
    assertAgentModelRequest({ ...settings, agentExecution: snapshot }, { ...payload, model });
    if (model !== snapshot.modelId) throw fail("AGENT_MODEL_CONFLICT", "本轮 Agent 模型已冻结。");
    if (payload.tools !== undefined && (!Array.isArray(payload.tools) || payload.tools.length > 128 || payload.tools.some(tool => tool?.type !== "function" || !plain(tool.function) || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(tool.function.name || "")))) throw fail("AGENT_PROVIDER_TOOLS_INVALID", "本地兼容端点只支持明确的函数工具 schema。");
    if (new Set((payload.tools || []).map(tool => tool.function.name)).size !== (payload.tools || []).length) throw fail("AGENT_PROVIDER_TOOLS_INVALID", "本地 Agent 工具 schema 身份不能重复。");
    if (payload.stream !== undefined && typeof payload.stream !== "boolean") throw fail("AGENT_PROVIDER_REQUEST_INVALID", "本地 Agent 流式选项无效。");
    function images(value) {
      if (!value || typeof value !== "object") return;
      if (["input_image", "image_url"].includes(value.type)) {
        const url = typeof value.image_url === "string" ? value.image_url : value.image_url?.url;
        if (typeof url !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url)) throw fail("AGENT_PROVIDER_IMAGE_SOURCE_INVALID", "本地模型视觉输入只接受 Main 已准备的图片像素。");
      }
      for (const nested of Object.values(value)) if (nested && typeof nested === "object") images(nested);
    }
    images(payload.messages);
    const converted = chatRequestFromRuntimeRequest({ ...payload, model }), body = { model, messages: converted.messages, stream: payload.stream === true };
    for (const key of ["tools", "tool_choice", "temperature", "top_p", "stop", "seed", "parallel_tool_calls"]) if (converted[key] !== undefined) body[key] = converted[key];
    const outputTokens = payload.max_completion_tokens ?? payload.max_tokens ?? payload.max_output_tokens ?? snapshot.capabilities.maxOutputTokens;
    if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > snapshot.capabilities.maxOutputTokens) throw fail("AGENT_PROVIDER_CONTEXT_LIMIT", "请求输出上限超过模型明确声明的能力。");
    body.max_tokens = outputTokens;
    // This preflight is an estimate, not a model tokenizer: use a conservative
    // ASCII/CJK ratio plus message overhead, and account for visual inputs
    // separately from their base64 transport bytes. The selected server still
    // enforces its actual context window. Never truncate or replace the model.
    let imageTokens = 0;
    const tokenInput = JSON.stringify({ messages: body.messages, tools: body.tools }, (_key, value) => {
      if (plain(value) && value.type === "image_url") { imageTokens += value.image_url?.detail === "low" ? 256 : 8192; return { type: "image_url" }; }
      return value;
    });
    let ascii = 0, nonAscii = 0;
    for (const character of tokenInput) character.codePointAt(0) <= 127 ? ascii++ : nonAscii++;
    const estimatedInputTokens = Math.ceil(ascii / 3) + nonAscii * 2 + body.messages.length * 12 + (body.tools?.length || 0) * 16;
    if (estimatedInputTokens + imageTokens + outputTokens > snapshot.capabilities.contextWindowTokens) throw fail("AGENT_PROVIDER_CONTEXT_LIMIT", "当前上下文估计超过本地模型声明窗口，请先整理会话或明确选择更大窗口。");
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_REQUEST_BYTES) throw fail("AGENT_PROVIDER_REQUEST_TOO_LARGE", "本地 Agent 请求超过受控大小上限。");
    return body;
  }
  function validateResponse(value, snapshot, tools) {
    if (plain(value) && value.error) throw fail(contextLimitCode(value.error?.code) ? "AGENT_PROVIDER_CONTEXT_LIMIT" : "AGENT_PROVIDER_RESPONSE_FAILED", "本地 Agent 服务未能完成请求。");
    if (!plain(value) || !Array.isArray(value.choices) || value.choices.length !== 1 || !plain(value.choices[0]) || !plain(value.choices[0].message)
      || value.choices[0].index !== undefined && value.choices[0].index !== 0
      || value.choices[0].finish_reason !== undefined && value.choices[0].finish_reason !== null && !["stop", "tool_calls", "length", "content_filter"].includes(value.choices[0].finish_reason)
      || value.choices[0].message.role !== "assistant" || value.choices[0].message.function_call !== undefined) throw fail("AGENT_PROVIDER_RESPONSE_INVALID", "本地模型必须返回明确的单一 assistant 响应。");
    const message = messageFromResponse(value), calls = message.tool_calls || [];
    if (message.content !== undefined && message.content !== null && typeof message.content !== "string" || !Array.isArray(calls) || calls.length > 128) throw fail("AGENT_PROVIDER_RESPONSE_INVALID", "本地模型返回的文本或工具格式无效。");
    if (!snapshot.capabilities.tools && calls.length) throw fail("AGENT_TOOLS_UNAVAILABLE", "当前本地模型未声明工具能力，返回的工具调用未执行。");
    const allowed = new Set((tools || []).map(tool => tool.function.name));
    for (const call of calls) {
      if (!plain(call) || typeof call.id !== "string" || !ID.test(call.id) || call.type !== "function" || !allowed.has(call.function?.name) || typeof call.function?.arguments !== "string") throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型返回了未授权或不完整的工具调用。");
      let args; try { args = JSON.parse(call.function.arguments); } catch {}
      if (!plain(args)) throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型返回了无效工具参数。");
    }
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型返回了重复工具调用身份。");
    if (!String(message.content || "").trim() && !calls.length) throw fail("AGENT_PROVIDER_EMPTY_RESPONSE", "本地模型未返回文本或有效工具调用。");
  }
  async function complete(bindingId, payload = {}) {
    assertActive(); const record = bindings.get(identity(bindingId));
    if (!record || record.released) throw fail("AGENT_PROVIDER_BINDING_MISSING", "Agent 运行绑定已结束或不存在。");
    if (record.snapshot.providerKind === "cloud") throw fail("AGENT_PROVIDER_CLOUD_DELEGATED", "云端请求由原 Main 连接处理。");
    const body = validateRequest(record.snapshot, payload, record.settings), controller = new AbortController(), callerSignal = payload.signal;
    const abort = () => controller.abort(); callerSignal?.addEventListener("abort", abort, { once: true }); if (callerSignal?.aborted) abort();
    record.controllers.add(controller);
    let submitted = false, timeout;
    try {
      const network = await resolveNetwork(record.endpoint, controller.signal);
      if (controller.signal.aborted || record.released) throw fail("AGENT_PROVIDER_ABORTED", "本地 Agent 请求已取消。");
      timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
      const url = new URL(`${record.endpoint.baseUrl}/chat/completions`), encoded = Buffer.from(JSON.stringify({ ...body, model: record.endpoint.requestModel }));
      return await new Promise((resolve, reject) => {
        let settled = false, response, responseClosed, requestClosed, bytes = 0, buffer = "", streamDone = false, terminal = false;
        const chunks = [], jsonChunks = [], streamedCalls = new Map(), decoder = new TextDecoder("utf-8", { fatal: true });
        const transportFailure = () => fail(controller.signal.aborted ? controller.signal.reason === "timeout" ? "AGENT_PROVIDER_TIMEOUT" : "AGENT_PROVIDER_ABORTED" : "AGENT_PROVIDER_CONNECTION_FAILED", "本地 Agent 连接已中断、取消或超时。");
        const finish = (error, value) => {
          if (settled) return; settled = true;
          response?.destroy(); req.destroy();
          void Promise.all([requestClosed, responseClosed]).then(() => error ? reject(error) : resolve(value));
        };
        const consumeEvent = raw => {
          if (!raw.trim()) return;
          if (Buffer.byteLength(raw, "utf8") > MAX_EVENT_BYTES) throw fail("AGENT_PROVIDER_RESPONSE_TOO_LARGE", "本地 Agent 流式事件超过上限。");
          const data = raw.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
          if (!data.trim()) return;
          if (streamDone) throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型在完成事件后继续发送内容。");
          if (data.trim() === "[DONE]") { streamDone = true; return; }
          let value; try { value = JSON.parse(data); } catch { throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地 Agent 返回无效流式 JSON。"); }
          if (!plain(value)) throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型流式事件必须是兼容对象。");
          if (value.error) throw fail(contextLimitCode(value.error?.code) ? "AGENT_PROVIDER_CONTEXT_LIMIT" : "AGENT_PROVIDER_RESPONSE_FAILED", "本地 Agent 服务未能完成请求。");
          if (!Array.isArray(value.choices) || value.choices.length > 1 || value.choices.some(choice => !plain(choice) || choice.index !== 0 || !plain(choice.delta))) throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型流式事件缺少唯一兼容 choices。");
          if (!record.snapshot.capabilities.tools && value.choices.some(choice => choice.delta?.tool_calls?.length)) throw fail("AGENT_TOOLS_UNAVAILABLE", "模型未声明工具能力，工具调用未执行。");
          if (terminal && value.choices.length) throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型在终止标记后继续发送模型内容。");
          const choices = value.choices.map(choice => {
            const source = choice.delta, delta = {};
            if (source.role !== undefined && source.role !== "assistant" || source.function_call !== undefined) throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型流式角色或工具协议无效。");
            if (source.role) delta.role = source.role;
            for (const key of ["content", "reasoning_content", "reasoning", "reasoning_text", "thinking"]) {
              if (source[key] !== undefined && source[key] !== null && typeof source[key] !== "string") throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型流式文本格式无效。");
              if (source[key] !== undefined) delta[key] = source[key];
            }
            if (source.tool_calls !== undefined) {
              if (!Array.isArray(source.tool_calls) || source.tool_calls.length > 128) throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型流式工具格式无效。");
              delta.tool_calls = source.tool_calls.map(call => {
                if (!plain(call) || !Number.isSafeInteger(call.index) || call.index < 0 || call.index >= 128 || call.type !== undefined && call.type !== "function" || call.function !== undefined && !plain(call.function)) throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型流式工具身份无效。");
                const previous = streamedCalls.get(call.index) || { id: "", type: "function", function: { name: "", arguments: "" } };
                const fn = call.function || {}, result = { index: call.index };
                if (call.id !== undefined) {
                  if (typeof call.id !== "string" || !ID.test(call.id) || previous.id && previous.id !== call.id) throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型工具调用身份缺失或发生变化。");
                  previous.id = call.id; result.id = call.id;
                }
                if (call.type !== undefined) result.type = call.type;
                if (fn.name !== undefined) {
                  if (typeof fn.name !== "string" || !new Set((body.tools || []).map(tool => tool.function.name)).has(fn.name) || previous.function.name && previous.function.name !== fn.name) throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型返回了未授权工具。");
                  previous.function.name = fn.name;
                }
                if (fn.arguments !== undefined) {
                  if (typeof fn.arguments !== "string") throw fail("AGENT_PROVIDER_TOOL_RESPONSE_INVALID", "本地模型工具参数分片无效。");
                  previous.function.arguments += fn.arguments;
                }
                if (call.function !== undefined) result.function = { ...(fn.name !== undefined ? { name: fn.name } : {}), ...(fn.arguments !== undefined ? { arguments: fn.arguments } : {}) };
                streamedCalls.set(call.index, previous); return result;
              });
            }
            if (choice.finish_reason !== undefined && choice.finish_reason !== null && !["stop", "tool_calls", "length", "content_filter"].includes(choice.finish_reason)) throw fail("AGENT_PROVIDER_STREAM_INVALID", "本地模型终止标记无效。");
            terminal ||= Boolean(choice.finish_reason);
            return { index: 0, delta, finish_reason: choice.finish_reason ?? null };
          });
          // Only the Chat protocol crosses this boundary. In particular, do
          // not pass Responses-shaped output/items to a permissive parser.
          const event = { model: record.snapshot.modelId, choices };
          if (plain(value.usage)) event.usage = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter(key => Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0).map(key => [key, value.usage[key]]));
          chunks.push(event);
          if (chunks.length > 20_000) throw fail("AGENT_PROVIDER_RESPONSE_TOO_LARGE", "本地 Agent 流式事件数量超过上限。");
          try { payload.onStreamEvent?.(clone(event)); } catch { throw fail("AGENT_PROVIDER_STREAM_CALLBACK_FAILED", "本地 Agent 流式输出接收失败。"); }
        };
        const consumeBuffer = final => {
          while (true) {
            const match = /\r?\n\r?\n/.exec(buffer); if (!match) break;
            const event = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length); consumeEvent(event);
          }
          if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) throw fail("AGENT_PROVIDER_RESPONSE_TOO_LARGE", "本地 Agent 流式缓冲超过上限。");
          if (final && buffer.trim()) { consumeEvent(buffer); buffer = ""; }
        };
        const req = (url.protocol === "https:" ? https : http).request({ protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || undefined,
          path: url.pathname, method: "POST", headers: { "content-type": "application/json", accept: body.stream ? "text/event-stream" : "application/json", "accept-encoding": "identity", "content-length": encoded.length, ...record.endpoint.headers },
          lookup: network.lookup, agent: false, rejectUnauthorized: true, signal: controller.signal, maxHeaderSize: 32 * 1024 }, incoming => {
          response = incoming; responseClosed = new Promise(closed => incoming.once("close", closed));
          incoming.once("error", () => finish(transportFailure()));
          incoming.once("aborted", () => finish(transportFailure()));
          const status = incoming.statusCode || 0;
          if (status < 200 || status >= 300) {
            if (status >= 300 && status < 400) return finish(fail("AGENT_PROVIDER_REDIRECT_FORBIDDEN", "本地 Agent 连接禁止重定向。", { status }));
            const errorChunks = []; let errorBytes = 0;
            const rejectStatus = () => {
              let code;
              try { code = JSON.parse(Buffer.concat(errorChunks).toString("utf8"))?.error?.code; } catch {}
              finish(fail(status === 401 || status === 403 ? "AGENT_PROVIDER_AUTH_FAILED" : contextLimitCode(code) ? "AGENT_PROVIDER_CONTEXT_LIMIT" : status === 400 || status === 413 ? "AGENT_PROVIDER_REQUEST_REJECTED" : "AGENT_PROVIDER_HTTP_FAILED", "本地 Agent 服务拒绝请求。", { status }));
            };
            incoming.on("data", chunk => { if (settled) return; errorBytes += chunk.length; if (errorBytes > 64 * 1024) rejectStatus(); else errorChunks.push(chunk); });
            incoming.once("end", rejectStatus); return;
          }
          const type = String(incoming.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
          if (incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity") return finish(fail("AGENT_PROVIDER_ENCODING_INVALID", "本地 Agent 响应不允许传输压缩变换。"));
          if (type !== (body.stream ? "text/event-stream" : "application/json")) return finish(fail("AGENT_PROVIDER_RESPONSE_INVALID", "本地 Agent 返回了不匹配的响应类型。"));
          incoming.on("data", chunk => {
            if (settled) return;
            try { bytes += chunk.length; if (bytes > MAX_RESPONSE_BYTES) throw fail("AGENT_PROVIDER_RESPONSE_TOO_LARGE", "本地 Agent 响应超过大小上限。");
              if (body.stream) { buffer += decoder.decode(chunk, { stream: true }); consumeBuffer(false); } else jsonChunks.push(chunk);
            } catch (error) { finish(error?.code === "ERR_ENCODING_INVALID_ENCODED_DATA" ? fail("AGENT_PROVIDER_RESPONSE_INVALID", "本地 Agent 返回无效 UTF-8 编码。") : safeError(error)); }
          });
          incoming.once("end", () => {
            if (settled) return;
            try {
              let value;
              if (body.stream) {
                buffer += decoder.decode(); consumeBuffer(true);
                if (!streamDone && !terminal) throw fail("AGENT_PROVIDER_STREAM_INCOMPLETE", "本地 Agent 流在完成前结束，不会自动重发。");
                if (streamedCalls.size) validateResponse({ choices: [{ message: { role: "assistant", tool_calls: [...streamedCalls.values()] } }] }, record.snapshot, body.tools);
                validateResponse(responseFromStreamChunks(chunks), record.snapshot, body.tools);
                value = { stream: true, chunks, model: record.snapshot.modelId };
              } else {
                try { value = JSON.parse(decoder.decode(Buffer.concat(jsonChunks))); } catch { throw fail("AGENT_PROVIDER_RESPONSE_INVALID", "本地 Agent 返回无效 JSON。"); }
                validateResponse(value, record.snapshot, body.tools);
                const choice = value.choices[0], message = choice.message;
                value = { model: record.snapshot.modelId, choices: [{ index: 0, finish_reason: choice.finish_reason, message: { role: "assistant", content: message.content ?? "",
                  ...(typeof message.reasoning_content === "string" ? { reasoning_content: message.reasoning_content } : {}),
                  ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } })) } : {}) } }],
                  ...(plain(value.usage) ? { usage: Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].filter(key => Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0).map(key => [key, value.usage[key]])) } : {}) };
              }
              finish(null, value);
            } catch (error) { finish(error?.code === "ERR_ENCODING_INVALID_ENCODED_DATA" ? fail("AGENT_PROVIDER_RESPONSE_INVALID", "本地 Agent 返回无效 UTF-8 编码。") : safeError(error)); }
          });
        });
        requestClosed = new Promise(closed => req.once("close", closed));
        req.on("socket", socket => {
          const approved = new Set(network.addresses.map(item => addressKey(item.address)));
          socket.once(socket.encrypted ? "secureConnect" : "connect", () => { if (!approved.has(addressKey(socket.remoteAddress))) req.destroy(fail("AGENT_PROVIDER_DNS_DENIED", "本地 Agent socket 与已批准地址不符。")); });
        });
        req.once("error", error => finish(error?.[PRIVATE_ERROR] ? error : fail(controller.signal.aborted ? controller.signal.reason === "timeout" ? "AGENT_PROVIDER_TIMEOUT" : "AGENT_PROVIDER_ABORTED" : /CERT|TLS|SSL|SELF_SIGNED|EPROTO/.test(error.code || "") ? "AGENT_PROVIDER_TLS_FAILED" : "AGENT_PROVIDER_CONNECTION_FAILED", controller.signal.aborted ? "本地 Agent 请求已取消或超时。" : "本地 Agent 连接或 TLS 校验失败。")));
        submitted = true; req.end(encoded);
      });
    } catch (error) { const safe = safeError(error); if (submitted) safe.unsafeToRetry = true; throw safe; }
    finally { clearTimeout(timeout); callerSignal?.removeEventListener("abort", abort); controller.abort(); record.controllers.delete(controller); finalizeRelease(bindingId, record); }
  }
  function dispose() { disposed = true; return Promise.all([...bindings.keys()].map(bindingId => { const record = bindings.get(bindingId); return record.released ? record.releasedPromise : releaseBinding(bindingId); })); }
  const privateAsync = fn => async (...args) => { try { return await fn(...args); } catch (error) { throw safeError(error); } };
  return Object.freeze({
    list: publicSync((input = {}) => { exact(input, ["projectId"]); return { ok: true, profiles: [profileSnapshot("cloud"), ...state.profiles.map(item => profileSnapshot(item.profileId))], selected: selectedSnapshot(input.projectId) }; }),
    importProfile: publicAsync(importProfile), select: publicAsync(select),
    inspect: publicSync((input = {}) => { exact(input, ["profileId"]); return { ok: true, profile: profileSnapshot(identity(input.profileId)) }; }),
    status: publicSync((input = {}) => { exact(input, ["projectId"]); return { ok: true, selected: selectedSnapshot(input.projectId) }; }),
    freeze: privateAsync(freeze), getBinding, complete: privateAsync(complete), releaseBinding: privateAsync(releaseBinding), isStrictOffline, dispose
  });
}

function createAgentProviderService(options) {
  try { return createService(options); } catch (error) { throw safeError(error); }
}

module.exports = { createAgentProviderService };
