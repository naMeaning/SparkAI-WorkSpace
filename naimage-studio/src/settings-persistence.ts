import type {
  AgentProviderChoice,
  AppSettings,
  ContextStrategyId,
  CustomThemeMode,
  CustomThemePreset,
  ReasoningEffort,
  ThemePaletteChoice
} from "./core.ts";
import { normalizePluginStates } from "./plugin-state.ts";

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

export const CONTEXT_STRATEGY_OPTIONS: { value: ContextStrategyId; label: string; detail: string }[] = [
  { value: "auto", label: "自动匹配", detail: "GPT/Codex、Claude 和其他模型自动使用各自的上下文策略。" },
  { value: "codex", label: "Codex", detail: "使用长上下文、Responses 历史和 checkpoint compaction。" },
  { value: "claude", label: "Claude Code", detail: "使用 Claude 消息历史和模型窗口感知的摘要压缩。" },
  { value: "naimage-balanced", label: "naimage 平衡", detail: "为未知兼容模型使用保守的 128K 上下文策略。" },
  { value: "custom", label: "自定义", detail: "手动设置上下文窗口、有效比例、压缩点和保留用户消息预算。" }
];

export const THEME_PALETTE_VALUES: ThemePaletteChoice[] = [
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
];

function normalizeCustomThemeMode(value: unknown): CustomThemeMode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const mode = {} as CustomThemeMode;
  const entries = Object.entries(source);
  if (entries.length !== 10) return null;
  for (const [key, rawColor] of entries) {
    if (!/^--theme-(?:bg|canvas|surface|surface-raised|ink|muted|line|accent|rose|green)$/.test(key)) return null;
    let color = String(rawColor || "").trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(color)) color = `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`;
    if (!/^#[0-9a-f]{6}$/.test(color)) return null;
    mode[key as keyof CustomThemeMode] = color;
  }
  return mode;
}

export function normalizeCustomThemePreset(value: unknown): CustomThemePreset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const light = normalizeCustomThemeMode(source.light);
  const dark = normalizeCustomThemeMode(source.dark);
  if (Number(source.schemaVersion) !== 1 || source.type !== "naimage-theme" || !light || !dark) return null;
  const name = String(source.name || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 48) || "自定义主题";
  return { schemaVersion: 1, type: "naimage-theme", name, light, dark };
}

export const DEFAULT_ACCOUNT_BASE_URL = "https://sparkapi.org";
export const DEFAULT_UPDATE_BASE_URL = "https://sparkapi.org";

export const defaultSettings: AppSettings = {
  accessMode: "account",
  agentProvider: "CODEX",
  agentBaseUrl: "",
  agentApiKey: "",
  agentModel: "",
  agentModelPool: [],
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
  imageModel: "",
  imageModelPool: [],
  imageCount: 1,
  imageBatchSize: 3,
  imageSize: "1024x1024",
  imageQuality: "auto",
  accountBaseUrl: DEFAULT_ACCOUNT_BASE_URL,
  relayBaseUrl: "",
  updateBaseUrl: DEFAULT_UPDATE_BASE_URL,
  networkProxyUrl: "",
  serverToken: "",
  serverSessionCookie: "",
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
  theme: "light",
  themePalette: "anthropic",
  customTheme: null,
  agentPanelPlacement: "right",
  agentPanelWidth: 390,
  agentPanelHeight: 680,
  agentPanelX: 56,
  agentPanelY: 56,
  agentSkillAutoInstallTargets: [],
  pluginStates: []
};

const LEGACY_LOCAL_SERVER_URLS = new Set([
  "http://127.0.0.1:17860",
  "http://localhost:17860",
  "http://[::1]:17860"
]);

const RETIRED_UPDATE_SERVICE_URLS = new Set([
  "https://image.aieyra.cn"
]);

function uniqueStoredModels(models: unknown[] = []) {
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, list) => list.findIndex((item) => item.toLowerCase() === model.toLowerCase()) === index);
}

export function normalizeServiceBaseUrl(value: unknown, fallback = "") {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized || String(fallback || "").trim().replace(/\/+$/, "");
}

function isLegacyLocalServerUrl(value: unknown) {
  return LEGACY_LOCAL_SERVER_URLS.has(normalizeServiceBaseUrl(value).toLowerCase());
}

function isRetiredUpdateServiceUrl(value: unknown) {
  return RETIRED_UPDATE_SERVICE_URLS.has(normalizeServiceBaseUrl(value).toLowerCase());
}

export function mergeSettings(value?: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const source = value ?? {};
  const next = { ...defaultSettings };
  const legacyServerUrl = normalizeServiceBaseUrl(source.serverUrl);

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
  if (!normalizeServiceBaseUrl(source.accountBaseUrl) && legacyServerUrl && !isLegacyLocalServerUrl(legacyServerUrl)) {
    next.accountBaseUrl = legacyServerUrl;
  }
  next.accountBaseUrl = normalizeServiceBaseUrl(next.accountBaseUrl, defaultSettings.accountBaseUrl);
  next.relayBaseUrl = normalizeServiceBaseUrl(next.relayBaseUrl);
  next.updateBaseUrl = isRetiredUpdateServiceUrl(next.updateBaseUrl)
    ? defaultSettings.updateBaseUrl
    : normalizeServiceBaseUrl(next.updateBaseUrl, defaultSettings.updateBaseUrl);
  next.networkProxyUrl = normalizeServiceBaseUrl(next.networkProxyUrl).slice(0, 2_048);
  next.agentModelPool = uniqueStoredModels(Array.isArray(source.agentModelPool) ? source.agentModelPool : next.agentModelPool);
  if (!next.agentModel && next.agentModelPool.length) next.agentModel = next.agentModelPool[0];
  if (next.agentModel) next.agentModelPool = uniqueStoredModels([next.agentModel, ...next.agentModelPool]);
  next.imageModelPool = uniqueStoredModels(Array.isArray(source.imageModelPool) ? source.imageModelPool : next.imageModelPool);
  if (!next.imageModel && next.imageModelPool.length) next.imageModel = next.imageModelPool[0];
  if (next.imageModel) next.imageModelPool = uniqueStoredModels([next.imageModel, ...next.imageModelPool]);
  next.modelGroup = String(next.modelGroup || "").trim().slice(0, 120);
  next.selectedAccountTokenId = /^\d+$/.test(String(next.selectedAccountTokenId || "")) ? String(next.selectedAccountTokenId) : "";
  next.selectedAccountTokenName = String(next.selectedAccountTokenName || "").trim().slice(0, 50);
  next.selectedAccountTokenGroup = String(next.selectedAccountTokenGroup || "").trim().slice(0, 120);
  next.accessMode = next.accessMode === "custom" ? "custom" : "account";
  next.licenseDeviceId = String(next.licenseDeviceId || "").trim().slice(0, 128);
  next.licenseToken = String(next.licenseToken || "").trim().slice(0, 256);
  next.licensePlan = String(next.licensePlan || "").trim().slice(0, 40);
  next.licenseExpiresAt = Math.max(0, Math.floor(Number(next.licenseExpiresAt) || 0));
  next.licenseLastVerifiedAt = Math.max(0, Math.floor(Number(next.licenseLastVerifiedAt) || 0));
  if (!["system", "light", "dark"].includes(String(next.theme))) next.theme = defaultSettings.theme;
  if (!THEME_PALETTE_VALUES.includes(next.themePalette)) next.themePalette = defaultSettings.themePalette;
  next.customTheme = normalizeCustomThemePreset(source.customTheme);
  if (next.themePalette === "custom" && !next.customTheme) next.themePalette = defaultSettings.themePalette;
  if (!["right", "left", "top", "bottom", "floating"].includes(String(next.agentPanelPlacement))) next.agentPanelPlacement = defaultSettings.agentPanelPlacement;
  next.agentPanelWidth = Math.max(320, Math.min(720, Math.round(Number(next.agentPanelWidth) || defaultSettings.agentPanelWidth)));
  next.agentPanelHeight = Math.max(420, Math.min(1_400, Math.round(Number(next.agentPanelHeight) || defaultSettings.agentPanelHeight)));
  next.agentPanelX = Math.max(0, Math.min(10_000, Math.round(Number(next.agentPanelX) || 0)));
  next.agentPanelY = Math.max(0, Math.min(10_000, Math.round(Number(next.agentPanelY) || 0)));
  next.agentSkillAutoInstallTargets = Array.isArray(source.agentSkillAutoInstallTargets)
    ? [...new Set(source.agentSkillAutoInstallTargets.map((item) => String(item)).filter((item) => ["codex", "claude-code", "opencode", "openclaw"].includes(item)))] as AppSettings["agentSkillAutoInstallTargets"]
    : [];
  next.pluginStates = normalizePluginStates(source.pluginStates);
  if (!["CODEX", "CUSTOM"].includes(String(next.agentProvider))) next.agentProvider = "CODEX";
  if (!["auto", "codex", "claude", "naimage-balanced", "custom"].includes(String(next.contextStrategy))) next.contextStrategy = "auto";
  const contextWindowTokens = Number(next.contextWindowTokens);
  next.contextWindowTokens = Number.isFinite(contextWindowTokens) ? Math.max(8_000, Math.min(2_000_000, Math.round(contextWindowTokens))) : defaultSettings.contextWindowTokens;
  const contextEffectiveWindowPercent = Number(next.contextEffectiveWindowPercent);
  next.contextEffectiveWindowPercent = Number.isFinite(contextEffectiveWindowPercent) ? Math.max(50, Math.min(99, Math.round(contextEffectiveWindowPercent))) : defaultSettings.contextEffectiveWindowPercent;
  const contextAutoCompactPercent = Number(next.contextAutoCompactPercent);
  next.contextAutoCompactPercent = Number.isFinite(contextAutoCompactPercent)
    ? Math.max(50, Math.min(Math.min(98, next.contextEffectiveWindowPercent), Math.round(contextAutoCompactPercent)))
    : defaultSettings.contextAutoCompactPercent;
  const contextRetainedUserTokens = Number(next.contextRetainedUserTokens);
  next.contextRetainedUserTokens = Number.isFinite(contextRetainedUserTokens) ? Math.max(0, Math.min(50_000, Math.round(contextRetainedUserTokens))) : defaultSettings.contextRetainedUserTokens;
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(String(next.reasoningEffort))) next.reasoningEffort = "low";
  const timeoutSeconds = Number(next.timeoutSeconds);
  next.timeoutSeconds = Number.isFinite(timeoutSeconds) ? Math.max(15, Math.min(600, Math.round(timeoutSeconds))) : defaultSettings.timeoutSeconds;
  const imageBatchSize = Number(next.imageBatchSize);
  next.imageBatchSize = Number.isFinite(imageBatchSize) ? Math.max(1, Math.min(10, Math.round(imageBatchSize))) : defaultSettings.imageBatchSize;
  next.fastMode = Boolean(next.fastMode);
  if (isLegacyLocalServerUrl(legacyServerUrl)) {
    next.accountBaseUrl = defaultSettings.accountBaseUrl;
    next.relayBaseUrl = defaultSettings.relayBaseUrl;
    next.serverToken = "";
    next.serverSessionCookie = "";
    next.serverUserId = "";
    next.selectedAccountTokenId = "";
    next.selectedAccountTokenName = "";
    next.selectedAccountTokenGroup = "";
  }

  return next as AppSettings;
}

export const STORAGE_SETTINGS = "naimage.settings.v1";
export const STORAGE_SESSION = "naimage.ideSession.v1";
export const STORAGE_IMAGE_STATS = "naimage.imageGenerationStats.v1";
export const STORAGE_SERVER_AUTH = "naimage.serverAuth.v1";

export function readJson<T>(key: string, fallback: T): T {
  try {
    let raw = localStorage.getItem(key);
    if (raw === null && key.startsWith("naimage.")) raw = localStorage.getItem(`iiimage.${key.slice(8)}`);
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
