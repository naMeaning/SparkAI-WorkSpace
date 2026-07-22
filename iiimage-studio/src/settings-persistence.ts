import type {
  AgentProviderChoice,
  AppSettings,
  ReasoningEffort
} from "./core.ts";

export const AGENT_PROVIDER_OPTIONS: { value: AgentProviderChoice; label: string; detail: string }[] = [
  { value: "CODEX", label: "CODEX", detail: "支持推理强度与 Fast 模式。" },
  { value: "CUSTOM", label: "自定义", detail: "仅透传模型与基础参数。" }
];

export const REASONING_EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" }
];

export const defaultSettings: AppSettings = {
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

const LEGACY_LOCAL_SERVER_URLS = new Set([
  "http://127.0.0.1:17860",
  "http://localhost:17860",
  "http://[::1]:17860"
]);

function uniqueStoredModels(models: unknown[] = []) {
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

function normalizeStoredServerUrl(value: unknown) {
  return String(value || "").trim().replace(/\/$/, "");
}

function isLegacyLocalServerUrl(value: unknown) {
  return LEGACY_LOCAL_SERVER_URLS.has(normalizeStoredServerUrl(value).toLowerCase());
}

export function mergeSettings(value?: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const source = value ?? {};
  const next = { ...defaultSettings };

  for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) {
    if (source[key] !== undefined) {
      next[key] = source[key] as never;
    }
  }

  if (!source.agentBaseUrl && typeof source.baseUrl === "string") next.agentBaseUrl = source.baseUrl;
  if (!source.agentApiKey && typeof source.apiKey === "string") next.agentApiKey = source.apiKey;
  if (!source.agentModel && typeof source.model === "string") next.agentModel = source.model;
  if (!source.imageBaseUrl && typeof source.baseUrl === "string") next.imageBaseUrl = source.baseUrl;
  if (!source.imageApiKey && typeof source.apiKey === "string") next.imageApiKey = source.apiKey;
  next.agentModelPool = uniqueStoredModels(Array.isArray(source.agentModelPool) ? source.agentModelPool : next.agentModelPool);
  if (!next.agentModel && next.agentModelPool.length) next.agentModel = next.agentModelPool[0];
  if (next.agentModel) next.agentModelPool = uniqueStoredModels([next.agentModel, ...next.agentModelPool]);
  next.imageModelPool = uniqueStoredModels(Array.isArray(source.imageModelPool) ? source.imageModelPool : next.imageModelPool);
  if (!next.imageModel && next.imageModelPool.length) next.imageModel = next.imageModelPool[0];
  if (next.imageModel) next.imageModelPool = uniqueStoredModels([next.imageModel, ...next.imageModelPool]);
  if (!["CODEX", "CUSTOM"].includes(String(next.agentProvider))) next.agentProvider = "CODEX";
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(String(next.reasoningEffort))) next.reasoningEffort = "low";
  const timeoutSeconds = Number(next.timeoutSeconds);
  next.timeoutSeconds = Number.isFinite(timeoutSeconds) ? Math.max(15, Math.min(600, Math.round(timeoutSeconds))) : defaultSettings.timeoutSeconds;
  next.fastMode = Boolean(next.fastMode);
  if (isLegacyLocalServerUrl(next.serverUrl)) {
    next.serverUrl = defaultSettings.serverUrl;
    next.serverToken = "";
    next.serverSessionCookie = "";
    next.serverUserId = "";
  }

  return next as AppSettings;
}

export const STORAGE_SETTINGS = "iiimage.settings.v1";
export const STORAGE_SESSION = "iiimage.ideSession.v1";
export const STORAGE_IMAGE_STATS = "iiimage.imageGenerationStats.v1";

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) return (Array.isArray(parsed) ? parsed : fallback) as T;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...(fallback as Record<string, unknown>), ...parsed } as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser fallback only. Electron persists through the config bridge.
  }
}
