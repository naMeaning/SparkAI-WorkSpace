import {
  promptForIndependentImage
} from "./core";
import {
  DEFAULT_ACCOUNT_BASE_URL,
  DEFAULT_UPDATE_BASE_URL,
  STORAGE_SERVER_AUTH,
  STORAGE_SETTINGS,
  defaultSettings,
  mergeSettings,
  normalizeServiceBaseUrl,
  readJson,
  writeJson
} from "./settings-persistence";
import type {
  AppSettings,
  ImageAsset,
  ReferenceImage,
  ServerBridge,
  ServerLogEntry,
  ServerPublicSettings,
  ServerUser,
  ServerWallet
} from "./core";

type BrowserAuthState = {
  accountBaseUrl: string;
  serverUserId: string;
};

type NewApiService = "account" | "relay" | "update";

type JsonRecord = Record<string, unknown>;

const LOCAL_NEW_API_PROXY = "/__naimage_new_api";
const NEW_API_QUOTA_PER_UNIT = 500000;

function readSettings() {
  return mergeSettings(readJson<Partial<AppSettings> & JsonRecord>(STORAGE_SETTINGS, defaultSettings));
}

function saveSettingsPatch(patch: Partial<AppSettings>) {
  const current = readSettings();
  const next = mergeSettings({ ...current, ...patch });
  validateServiceBaseUrls(next);
  if (current.accountBaseUrl.toLowerCase() !== next.accountBaseUrl.toLowerCase()) clearAuthState();
  writeJson(STORAGE_SETTINGS, next);
  return next;
}

function readAuthState(settings = readSettings()): BrowserAuthState {
  const raw = readJson<Partial<BrowserAuthState> & JsonRecord>(STORAGE_SERVER_AUTH, { accountBaseUrl: "", serverUserId: "" });
  const accountBaseUrl = normalizeServiceBaseUrl(settings.accountBaseUrl, DEFAULT_ACCOUNT_BASE_URL);
  const storedBaseUrl = normalizeServiceBaseUrl(raw.accountBaseUrl || raw.serverUrl);
  return {
    accountBaseUrl,
    serverUserId: !storedBaseUrl || storedBaseUrl.toLowerCase() === accountBaseUrl.toLowerCase() ? String(raw.serverUserId || "") : ""
  };
}

function saveAuthState(settings: AppSettings, serverUserId: string) {
  writeJson(STORAGE_SERVER_AUTH, {
    accountBaseUrl: serviceBaseUrl(settings, "account"),
    serverUserId
  });
}

function clearAuthState() {
  writeJson(STORAGE_SERVER_AUTH, { accountBaseUrl: "", serverUserId: "" });
}

function parsedServiceUrl(value: string, label: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${label}不是有效的 URL。`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label}只允许 HTTP 或 HTTPS 地址。`);
  return parsed;
}

function resolvedRelayBaseUrl(settings: AppSettings) {
  return normalizeServiceBaseUrl(settings.relayBaseUrl, settings.accountBaseUrl);
}

function validateServiceBaseUrls(settings: AppSettings) {
  const account = parsedServiceUrl(settings.accountBaseUrl, "账户服务地址");
  parsedServiceUrl(settings.updateBaseUrl, "更新服务地址");
  if (!settings.relayBaseUrl) return;
  const relay = parsedServiceUrl(settings.relayBaseUrl, "Relay 服务地址");
  const loopback = relay.hostname === "localhost" || relay.hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(relay.hostname);
  if (relay.origin !== account.origin && relay.protocol !== "https:" && !loopback) throw new Error("异源 Relay 服务必须使用 HTTPS 或 localhost/loopback 地址。");
}

function serviceBaseUrl(settings: AppSettings, service: NewApiService) {
  validateServiceBaseUrls(settings);
  if (service === "relay") return resolvedRelayBaseUrl(settings);
  if (service === "update") return normalizeServiceBaseUrl(settings.updateBaseUrl, DEFAULT_UPDATE_BASE_URL);
  return normalizeServiceBaseUrl(settings.accountBaseUrl, DEFAULT_ACCOUNT_BASE_URL);
}

function isLocalServerUrl(value?: string) {
  try {
    const url = new URL(String(value || ""));
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function usesLocalProxy(settings: AppSettings, service: NewApiService) {
  return isLocalServerUrl(serviceBaseUrl(settings, service));
}

function newApiUrl(settings: AppSettings, endpoint: string, service: NewApiService) {
  const pathPart = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${usesLocalProxy(settings, service) ? LOCAL_NEW_API_PROXY : serviceBaseUrl(settings, service)}${pathPart}`;
}

function userAuthHeaders(settings: AppSettings): Record<string, string> {
  const authState = readAuthState(settings);
  return authState.serverUserId ? { "New-Api-User": authState.serverUserId } : {};
}

function parseJsonText(text: string) {
  try {
    return text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    return { error: text || "" };
  }
}

function errorText(data: JsonRecord, status?: number) {
  const error = data.error;
  if (error && typeof error === "object" && "message" in error) return String((error as JsonRecord).message || "");
  return (
    String(data.message || "") ||
    String(data.error || "") ||
    String(data.msg || "") ||
    (status ? `New API ${status}` : "New API request failed")
  );
}

async function newApiFetch(settings: AppSettings, endpoint: string, options: { service?: NewApiService; method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const body = options.body;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const service = options.service || "account";
  const baseUrl = serviceBaseUrl(settings, service);
  const relayIsCrossOrigin = service === "relay" && new URL(baseUrl).origin !== new URL(serviceBaseUrl(settings, "account")).origin;
  const response = await fetch(newApiUrl(settings, endpoint, service), {
    method: options.method || "GET",
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      ...(options.headers || {})
    },
    credentials: usesLocalProxy(settings, service) || relayIsCrossOrigin ? "same-origin" : "include",
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
  });
  const text = await response.text();
  return { response, data: parseJsonText(text) };
}

async function newApiRequest(settings: AppSettings, endpoint: string, options: { service?: NewApiService; method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const { response, data } = await newApiFetch(settings, endpoint, options);
  if (!response.ok || data.success === false || data.ok === false) {
    const error = new Error(errorText(data, response.status)) as Error & { status?: number; data?: JsonRecord };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function isAuthError(error: unknown) {
  const status = Number((error as { status?: number } | null)?.status);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return status === 401 || status === 403 || /invalid token|unauthorized|forbidden|登录已失效|401|403/i.test(message);
}

function normalizeUser(userData: JsonRecord = {}): ServerUser {
  const username = String(userData.username || userData.email || userData.id || "").trim();
  const displayName = String(userData.displayName || userData.display_name || userData.name || username || "SparkAI WorkSpace User").trim();
  const quota = Number(userData.quota ?? userData.remain_quota ?? userData.balance ?? 0);
  const balanceCents = Number.isFinite(quota)
    ? Math.max(0, Math.round((quota / NEW_API_QUOTA_PER_UNIT) * 100))
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
    createdAt: typeof userData.createdAt === "string" ? userData.createdAt : userData.created_time ? new Date(Number(userData.created_time) * 1000).toISOString() : undefined
  };
}

function walletFromUser(userData: JsonRecord = {}): ServerWallet {
  const user = normalizeUser(userData);
  return {
    balanceCents: user.balanceCents,
    balanceYuan: user.balanceCents / 100,
    imageCostCents: 0,
    imageCostYuan: 0
  };
}

function tokenItemsFromPayload(payload: JsonRecord) {
  const source = (payload.data ?? payload) as unknown;
  if (Array.isArray(source)) return source as JsonRecord[];
  if (source && typeof source === "object") {
    const record = source as JsonRecord;
    if (Array.isArray(record.items)) return record.items as JsonRecord[];
    if (Array.isArray(record.Items)) return record.Items as JsonRecord[];
    if (Array.isArray(record.data)) return record.data as JsonRecord[];
  }
  return [];
}

const MODEL_ID_KEYS = ["id", "name", "model", "modelName", "model_name", "modelId", "model_id", "Model", "value"];
const MODEL_LIST_KEYS = ["data", "items", "Items", "models", "Models", "modelList", "model_list", "availableModels", "available_models", "result", "results", "rows", "list"];
const MODEL_META_KEYS = new Set(["success", "ok", "message", "msg", "error", "code", "total", "count", "page", "limit", "object", "created", "owned_by", "permission", "permissions", "capabilities", "type", "label", "description", "desc", "price", "quota"]);

function uniqueModelIds(modelIds: unknown[] = []) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const modelId of modelIds) {
    const clean = String(modelId || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function looksLikeModelId(value: string) {
  const clean = value.trim();
  return /^[a-z0-9][a-z0-9._:/+-]{1,}$/i.test(clean) && (
    /[0-9.\/:+-]/.test(clean) ||
    /^(gpt|chatgpt|claude|gemini|imagen|image|flux|dall|midjourney|mj|stable|sd|sora|veo|kling|runway|qwen|glm|deepseek|llama|mistral|recraft|ideogram|seedream|doubao|hunyuan|minimax|ernie|baichuan|moonshot|pixverse|hailuo|wanx|wanxiang|hidream|grok|xai)/i.test(clean)
  );
}

function isExplicitImageModelId(value: unknown) {
  const clean = String(value || "").trim();
  if (!clean) return false;
  return /(?:^|[\/:._+-])(?:image|images|imagen|flux|dall(?:[._+-]?e)?|midjourney|mj|stable[._+-]?diffusion|sdxl|sd3|recraft|ideogram|seedream|cogview|kolors|hidream|nano[._+-]?banana|grok[._+-]?imagine|wanx|wanxiang|jimeng)(?=$|[\/:._+-]|\d)/i.test(clean);
}

function isExplicitChatModelId(value: unknown) {
  const clean = String(value || "").trim();
  if (!clean || isExplicitImageModelId(clean)) return false;
  return /(?:^|[\/:._+-])(?:gpt|chatgpt|claude|gemini|grok|xai|deepseek|qwen|qwq|glm|llama|meta[._+-]?llama|mistral|mixtral|gemma|moonshot|kimi|ernie|baichuan|command[._+-]?r|cohere|doubao|hunyuan|minimax|codex|o[134])(?=$|[\/:._+-]|\d)/i.test(clean);
}

function configuredImageModelIds(settings: AppSettings) {
  return uniqueModelIds([
    settings.imageModel,
    ...(Array.isArray(settings.imageModelPool) ? settings.imageModelPool : []),
    ...(Array.isArray(settings.imageModelBindings)
      ? settings.imageModelBindings.map((binding) => binding?.model)
      : [])
  ]).filter((model) => !isExplicitChatModelId(model));
}

function configuredAgentModelIds(settings: AppSettings) {
  return uniqueModelIds([
    settings.agentModel,
    ...(Array.isArray(settings.agentModelPool) ? settings.agentModelPool : []),
    ...(Array.isArray(settings.agentModelBindings)
      ? settings.agentModelBindings.map((binding) => binding?.model)
      : [])
  ]).filter((model) => !isExplicitImageModelId(model));
}

function isModelMapEntry(key: string, value: unknown, depth: number) {
  const clean = key.trim();
  if (depth <= 0 || MODEL_META_KEYS.has(clean) || /\s/.test(clean) || clean.length < 2) return false;
  if (!(value === true || typeof value === "number" || typeof value === "string" || (value && typeof value === "object"))) return false;
  return looksLikeModelId(clean);
}

function collectModelIdsFromValue(value: unknown, output: string[], depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModelIdsFromValue(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const record = value as JsonRecord;
  const hasDirectModelId = MODEL_ID_KEYS.some((key) => {
    const modelId = record[key];
    return typeof modelId === "string";
  });
  for (const key of MODEL_ID_KEYS) {
    const modelId = record[key];
    if (typeof modelId === "string") {
      output.push(modelId);
      break;
    }
  }

  for (const key of MODEL_LIST_KEYS) {
    if (key in record) collectModelIdsFromValue(record[key], output, depth + 1);
  }

  for (const [key, nested] of Object.entries(record)) {
    if (hasDirectModelId || MODEL_LIST_KEYS.includes(key) || MODEL_ID_KEYS.includes(key)) continue;
    if (Array.isArray(nested)) {
      collectModelIdsFromValue(nested, output, depth + 1);
      continue;
    }
    if (isModelMapEntry(key, nested, depth)) {
      output.push(key);
    }
  }
}

function modelIdsFromResponse(payload: JsonRecord) {
  const modelIds: string[] = [];
  collectModelIdsFromValue(payload, modelIds);
  return uniqueModelIds(modelIds);
}

function modelGroupsFromResponse(payload: unknown): NonNullable<ServerPublicSettings["modelGroups"]> {
  const container = payload && typeof payload === "object" && "data" in payload
    ? (payload as JsonRecord).data
    : payload;
  const entries: Array<[string, unknown]> = Array.isArray(container)
    ? container.map((item) => {
        if (typeof item === "string") return [item, {}];
        const info = item && typeof item === "object" ? item as JsonRecord : {};
        return [String(info.id || info.name || info.value || ""), info];
      })
    : container && typeof container === "object"
      ? Object.entries(container as JsonRecord)
      : [];
  const seen = new Set<string>();
  return entries
    .map(([rawId, rawInfo]) => {
      const id = String(rawId || "").trim();
      const info = rawInfo && typeof rawInfo === "object" ? rawInfo as JsonRecord : {};
      return {
        id,
        label: String(info.label || info.name || id).trim() || id,
        description: String(info.desc || info.description || "").trim(),
        ratio: typeof info.ratio === "string" || typeof info.ratio === "number" ? info.ratio : undefined
      };
    })
    .filter((group) => {
      const key = group.id.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const priority = (value: string) => value === "default" ? 0 : value === "auto" ? 1 : 2;
      return priority(left.id) - priority(right.id) || left.label.localeCompare(right.label, "zh-CN");
    });
}

function splitModelSettings(
  settings: AppSettings,
  modelIds: string[] = [],
  modelGroups: NonNullable<ServerPublicSettings["modelGroups"]> = []
): ServerPublicSettings {
  const unique = uniqueModelIds(modelIds);
  const configuredImageModels = configuredImageModelIds(settings);
  const configuredAgentModels = configuredAgentModelIds(settings);
  // Most model APIs omit capability metadata, so unknown custom IDs stay visible in both catalogs.
  // Only an explicit opposite-purpose family is filtered out.
  const imageModels = uniqueModelIds([
    ...unique.filter((model) => !isExplicitChatModelId(model)),
    ...configuredImageModels
  ]);
  const agentModels = uniqueModelIds([
    ...unique.filter((model) => !isExplicitImageModelId(model)),
    ...configuredAgentModels
  ]);
  return {
    imageCostCents: 0,
    imageCostYuan: 0,
    trialImages: 0,
    models: unique,
    imageModel: configuredImageModels[0] || imageModels[0] || "",
    imageModels,
    agentModels,
    modelGroup: String(settings.modelGroup || "").trim(),
    modelGroups,
    channelName: /(?:^|\.)sparkapi\.org$/i.test(new URL(settings.accountBaseUrl).hostname) ? "SparkAPI" : "New API",
    serviceReady: true,
    keyManaged: true
  };
}

function preferredAgentModelFromList(models: string[] = []) {
  return models.find((model) => /^gpt-5\.6-terra(?:[-.:]|$)/i.test(model)) ??
    models.find((model) => /^gpt-5\.6-sol(?:[-.:]|$)/i.test(model)) ??
    models.find((model) => /^gpt-5\.6\b/i.test(model)) ??
    models.find((model) => /^gpt-5\.5\b/i.test(model)) ??
    models[0] ?? "";
}

function preferredImageModelFromList(models: string[] = []) {
  return models.find((model) => /^gpt-image-2\b/i.test(model)) ?? models[0] ?? "";
}

async function modelSettings(settings: AppSettings, requestedGroup = settings.modelGroup): Promise<ServerPublicSettings> {
  const collected: string[] = [];
  let modelGroups: NonNullable<ServerPublicSettings["modelGroups"]> = [];
  let groupsLoaded = false;
  try {
    const groups = await newApiRequest(settings, "/api/user/self/groups", {
      headers: userAuthHeaders(settings)
    });
    groupsLoaded = true;
    modelGroups = modelGroupsFromResponse(groups);
  } catch (error) {
    console.warn("new-api user groups failed", error);
  }
  const normalizedRequestedGroup = String(requestedGroup || "").trim().slice(0, 120);
  const selectedGroup = groupsLoaded && normalizedRequestedGroup && !modelGroups.some((group) => group.id === normalizedRequestedGroup)
    ? ""
    : normalizedRequestedGroup;
  const groupQuery = selectedGroup ? `?group=${encodeURIComponent(selectedGroup)}` : "";
  const groupedSettings = { ...settings, modelGroup: selectedGroup };
  try {
    const userModels = await newApiRequest(settings, `/api/user/models${groupQuery}`, {
      headers: userAuthHeaders(settings)
    });
    collected.push(...modelIdsFromResponse(userModels));
  } catch (error) {
    console.warn("new-api user models failed", error);
  }
  try {
    if (readAuthState(settings).serverUserId) {
      const { response, data } = await newApiFetch(settings, `/naimage/v1/models${groupQuery}`, {
        service: "relay",
        headers: userAuthHeaders(settings)
      });
      if (response.ok) {
        collected.push(...modelIdsFromResponse(data));
      }
    }
  } catch (error) {
    console.warn("managed relay models failed", error);
  }
  return splitModelSettings(groupedSettings, collected, modelGroups);
}

async function completeLogin(payload: { username?: string; email?: string; password?: string }) {
  let settings = readSettings();
  const login = await newApiFetch(settings, "/api/user/login", {
    method: "POST",
    body: {
      username: String(payload.username ?? payload.email ?? "").trim(),
      password: String(payload.password ?? "")
    }
  });
  if (!login.response.ok || login.data.success === false || login.data.ok === false) {
    throw new Error(errorText(login.data, login.response.status));
  }
  const loginUser = login.data.data && typeof login.data.data === "object" ? (login.data.data as JsonRecord) : {};
  const serverUserId = String(loginUser.id || "").trim();
  if (!serverUserId) throw new Error("New API 登录成功但没有返回 user id。");
  const latestSettings = readSettings();
  if (serviceBaseUrl(latestSettings, "account").toLowerCase() !== serviceBaseUrl(settings, "account").toLowerCase()) {
    throw new Error("账户服务地址已切换，旧登录结果已丢弃。");
  }
  saveAuthState(latestSettings, serverUserId);
  settings = latestSettings;

  let userData = loginUser;
  try {
    const self = await newApiRequest(settings, "/api/user/self", {
      headers: userAuthHeaders(settings)
    });
    userData = { ...loginUser, ...((self.data && typeof self.data === "object" ? self.data : {}) as JsonRecord) };
  } catch (error) {
    console.warn("new-api self after login failed", error);
  }

  settings = saveSettingsPatch({ serverToken: "" });
  const publicSettings = await modelSettings(settings);
  settings = saveSettingsPatch({
    imageModel: settings.imageModel || publicSettings.imageModel || preferredImageModelFromList(publicSettings.imageModels ?? []),
    imageModelPool: settings.imageModelPool?.length
      ? settings.imageModelPool
      : [settings.imageModel || publicSettings.imageModel || preferredImageModelFromList(publicSettings.imageModels ?? [])],
    agentModel: settings.agentModel || preferredAgentModelFromList(publicSettings.agentModels ?? []),
    agentModelPool: settings.agentModelPool?.length ? settings.agentModelPool : [settings.agentModel || preferredAgentModelFromList(publicSettings.agentModels ?? [])]
  });
  return {
    ok: true,
    sessionId: serverUserId,
    user: normalizeUser(userData),
    wallet: walletFromUser(userData),
    settings: {
      ...publicSettings,
      imageModel: settings.imageModel
    },
    imageCostCents: publicSettings.imageCostCents
  };
}

function mapLogType(type: unknown) {
  const value = Number(type);
  if (value === 0) return "unknown";
  if (value === 1) return "topup";
  if (value === 2) return "consume";
  if (value === 3) return "manage";
  if (value === 4) return "system";
  if (value === 5) return "error";
  if (value === 6) return "refund";
  if (value === 7) return "login";
  return "log";
}

function mapLogEntry(logEntry: JsonRecord): ServerLogEntry {
  let detail: JsonRecord = {};
  try {
    detail = logEntry.other ? (JSON.parse(String(logEntry.other)) as JsonRecord) : {};
  } catch {
    detail = {};
  }
  return {
    id: String(logEntry.id ?? `${logEntry.created_at ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    type: mapLogType(logEntry.type),
    createdAt: logEntry.created_at ? new Date(Number(logEntry.created_at) * 1000).toISOString() : new Date().toISOString(),
    detail: {
      ...detail,
      message: logEntry.content || detail.message,
      model: logEntry.model_name || detail.model,
      quota: logEntry.quota,
      promptTokens: logEntry.prompt_tokens,
      completionTokens: logEntry.completion_tokens
    }
  };
}

function isGptImageModel(model: string) {
  return /^gpt-image-/i.test(model) || /^chatgpt-image-latest$/i.test(model);
}

function extractImages(data: JsonRecord) {
  const images: { type: "base64" | "url"; value: string; revisedPrompt?: string }[] = [];
  const source = Array.isArray(data.images) ? data.images : Array.isArray(data.data) ? data.data : [];
  for (const item of source as JsonRecord[]) {
    if (item?.b64_json) images.push({ type: "base64", value: String(item.b64_json), revisedPrompt: String(item.revised_prompt || item.revisedPrompt || "") });
    if (item?.image_base64) images.push({ type: "base64", value: String(item.image_base64), revisedPrompt: String(item.revised_prompt || item.revisedPrompt || "") });
    if (item?.base64) images.push({ type: "base64", value: String(item.base64), revisedPrompt: String(item.revised_prompt || item.revisedPrompt || "") });
    if (item?.url) images.push({ type: "url", value: String(item.url), revisedPrompt: String(item.revised_prompt || item.revisedPrompt || "") });
    const imageUrl = item?.image_url;
    if (imageUrl && typeof imageUrl === "object" && "url" in imageUrl) {
      images.push({ type: "url", value: String((imageUrl as JsonRecord).url), revisedPrompt: String(item.revised_prompt || item.revisedPrompt || "") });
    }
    if (item?.type === "base64" && item.value) images.push({ type: "base64", value: String(item.value), revisedPrompt: String(item.revisedPrompt || "") });
    if (item?.type === "url" && item.value) images.push({ type: "url", value: String(item.value), revisedPrompt: String(item.revisedPrompt || "") });
  }
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output as JsonRecord[]) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content as JsonRecord[]) {
      const b64 = part?.image_base64 ?? part?.b64_json;
      const url = part?.image_url ?? part?.url;
      if (b64) images.push({ type: "base64", value: String(b64), revisedPrompt: String(part?.revised_prompt || "") });
      if (url) images.push({ type: "url", value: String(url), revisedPrompt: String(part?.revised_prompt || "") });
    }
  }
  return images;
}

function outputMime(format: unknown) {
  const normalized = String(format || "png").trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  return "image/png";
}

function base64ImageMime(value: string) {
  const encoded = String(value || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  let header = "";
  try {
    header = atob(encoded.slice(0, 24));
  } catch {
    throw new Error("图片服务返回了无效的 base64 图片数据。");
  }
  const bytes = Array.from(header, (character) => character.charCodeAt(0));
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP") return "image/webp";
  throw new Error("图片服务返回的数据不是有效的 PNG、JPEG 或 WebP。");
}

function imagesToAssets(images: ReturnType<typeof extractImages>, runId: string, outputFormat: unknown): ImageAsset[] {
  const requestedMime = outputMime(outputFormat);
  return images.map((image, index) => {
    let url = image.value;
    if (image.type === "base64") {
      const mime = base64ImageMime(image.value);
      if (mime !== requestedMime) {
        throw new Error(`图片服务返回 ${mime}，与请求的 ${requestedMime} 格式不一致。`);
      }
      const encoded = image.value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
      url = `data:${mime};base64,${encoded}`;
    }
    return {
      index: index + 1,
      type: "url",
      url,
      assetUrl: url,
      revisedPrompt: image.revisedPrompt || "",
      runId
    };
  });
}

function hasReferencePayload(payload: { referenceImages?: ReferenceImage[]; editImage?: ReferenceImage; maskDataUrl?: string }) {
  return Boolean(payload.editImage || payload.maskDataUrl || (Array.isArray(payload.referenceImages) && payload.referenceImages.length));
}

async function generateImage(payload: Parameters<ServerBridge["generateImage"]>[0]) {
  const settings = readSettings();
  if (!readAuthState(settings).serverUserId) throw new Error("登录会话已失效，请重新登录。");
  if (hasReferencePayload(payload)) {
    throw new Error("网页版暂不支持本地参考图/蒙版上传，请用桌面版执行编辑类生图。");
  }
  const runId = String(payload.runId || `run-${Date.now()}`);
  const model = String(payload.model || settings.imageModel || "gpt-image-2").trim();
  const count = Math.max(1, Math.min(Number(payload.count || 1), 16));
  const size = String(payload.size || settings.imageSize || "1024x1024").trim();
  const quality = String(payload.quality || settings.imageQuality || "auto").trim();
  const outputFormat = payload.outputFormat || "png";

  const requestSingle = async (index: number) => {
    const body: JsonRecord = {
      model,
      prompt: promptForIndependentImage(payload.prompt, count, index),
      size,
      quality,
      n: 1
    };
    if (!isGptImageModel(model)) body.response_format = "b64_json";
    if (isGptImageModel(model)) {
      body.output_format = outputFormat || "png";
      if (body.output_format !== "png" && payload.outputCompression !== undefined) {
        body.output_compression = payload.outputCompression;
      }
      if (payload.background) body.background = payload.background;
      if (payload.moderation) body.moderation = payload.moderation;
    }
    return newApiRequest(settings, "/v1/images/generations", {
      service: "relay",
      method: "POST",
      headers: userAuthHeaders(settings),
      body
    });
  };

  const settled = await Promise.allSettled(Array.from({ length: count }, (_item, index) => requestSingle(index)));
  const responses = settled.filter((item): item is PromiseFulfilledResult<JsonRecord> => item.status === "fulfilled").map((item) => item.value);
  const failed = settled
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "rejected");
  if (!responses.length && failed.length) {
    const first = failed[0].item;
    throw new Error(first.status === "rejected" ? first.reason?.message || String(first.reason) : "New API 生图失败。");
  }
  const assets = imagesToAssets(responses.flatMap((response) => extractImages(response)), runId, outputFormat);
  return {
    ok: true,
    model,
    size,
    quality,
    count,
    assets,
    runId,
    returned: assets.length,
    failed: failed.length,
    errors: failed.map(({ item, index }) => `第 ${index + 1}/${count} 张：${item.status === "rejected" ? item.reason?.message || String(item.reason) : "生图失败。"}`),
    outputFormat,
    mode: "generate",
    message: failed.length ? `New API 已返回 ${assets.length} 个生图结果，${failed.length} 张失败。` : `New API 已返回 ${assets.length} 个生图结果。`
  };
}

function createBrowserServerBridge(): ServerBridge {
  return {
    async register(payload) {
      const settings = readSettings();
      try {
        const username = String(payload.username ?? payload.email ?? "").trim();
        const password = String(payload.password ?? "");
        if (!username || !password) throw new Error("请输入用户名和密码。");
        await newApiRequest(settings, "/api/user/register", {
          method: "POST",
          body: {
            username,
            password,
            email: payload.email,
            display_name: payload.name || username
          }
        });
        return await completeLogin({ username, password });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async login(payload) {
      try {
        return await completeLogin(payload);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async logout() {
      const settings = readSettings();
      let remoteLogout = false;
      try {
        if (readAuthState(settings).serverUserId) {
          await newApiRequest(settings, "/api/user/logout", { method: "POST", headers: userAuthHeaders(settings) });
          remoteLogout = true;
        }
      } catch (error) {
        console.warn("new-api remote logout failed", error);
      } finally {
        clearAuthState();
        saveSettingsPatch({ serverToken: "" });
      }
      return { ok: true, remoteLogout };
    },
    async me(payload = {}) {
      const settings = readSettings();
      try {
        const authState = readAuthState(settings);
        if (payload.preferCached === true && authState.serverUserId) {
          return {
            ok: true,
            cached: true,
            user: normalizeUser({ id: authState.serverUserId, username: "SparkAI 用户", display_name: "SparkAI 用户" }),
            wallet: walletFromUser({ id: authState.serverUserId }),
            settings: splitModelSettings(settings, [])
          };
        }
        if (!readAuthState(settings).serverUserId) throw new Error("登录会话已失效，请重新登录。");
        let data: JsonRecord = { id: readAuthState(settings).serverUserId };
        try {
          const self = await newApiRequest(settings, "/api/user/self", {
            headers: userAuthHeaders(settings)
          });
          data = self.data && typeof self.data === "object" ? (self.data as JsonRecord) : data;
        } catch (error) {
          if (isAuthError(error)) throw error;
          console.warn("new-api self in me failed", error);
        }
        return {
          ok: true,
          user: normalizeUser(data),
          wallet: walletFromUser(data),
          settings: await modelSettings(settings)
        };
      } catch (error) {
        clearAuthState();
        saveSettingsPatch({ serverToken: "" });
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async logs() {
      const settings = readSettings();
      try {
        if (!readAuthState(settings).serverUserId) return { ok: true, logs: [] };
        const response = await newApiRequest(settings, "/api/log/self?p=1&page_size=20", {
          headers: userAuthHeaders(settings)
        });
        return { ok: true, logs: tokenItemsFromPayload(response).map(mapLogEntry) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), logs: [] };
      }
    },
    async models(payload = {}) {
      const settings = readSettings();
      try {
        return { ok: true, settings: await modelSettings(settings, payload.group) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), settings: splitModelSettings(settings, []) };
      }
    },
    async recharge() {
      return { ok: false, error: "New API 充值需要走服务端支付/兑换流程，本地测试充值接口已移除。" };
    },
    async generateImage(payload) {
      try {
        return await generateImage(payload);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async licenseStatus(payload = {}) {
      const settings = readSettings();
      const scope = payload.scope === "custom" ? "custom" : payload.scope === "account" ? "account" : settings.accessMode;
      if (scope === "account") {
        return { ok: true, active: true, required: false, supported: true, scope: "account" as const };
      }
      try {
        const response = await newApiRequest(settings, "/api/naimage/license");
        const supported = (response as { data?: { supports_custom_api_mode?: boolean } })?.data?.supports_custom_api_mode !== false;
        const active = supported && Boolean(settings.licenseToken) && String(settings.licensePlan || "").toLowerCase() === "pro";
        return { ok: true, active, required: true, supported, scope: "custom" as const, plan: settings.licensePlan, requiredPlan: "pro" };
      } catch (error) {
        return { ok: false, active: false, required: true, supported: false, scope: "custom" as const, requiredPlan: "pro", error: error instanceof Error ? error.message : String(error) };
      }
    },
    async activateLicense() {
      return { ok: false, active: false, required: true, error: "激活码核销仅支持 SparkAI WorkSpace 桌面版。" };
    },
    async configureCustom() {
      return { ok: false, error: "自定义 API Key 模式仅支持 SparkAI WorkSpace 桌面版。" };
    }
  };
}

export function installBrowserServerBridge() {
  if (window.naimageServer) return;
  window.naimageServer = createBrowserServerBridge();
}
