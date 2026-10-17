import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { ChevronRight, Plus, RefreshCw, Search } from "lucide-react";

import {
  accountApiTokenExpired,
  accountApiTokenUsable,
  agentModelBindingFor,
  imageModelCapability,
  modelConnectionBindingFor,
  normalizeAgentModelBindings,
  normalizeImageModelConfigs,
  normalizeAgentModelPoolSelection,
  normalizeModelConnectionBindings,
  normalizeImageModelBindings,
  normalizeImageModelPoolSelection,
  normalizeVideoModelPoolSelection,
  type AccountApiToken,
  type AppSettings,
  type ModelAccessProfile,
  type ModelConnectionSummary,
  type ModelProvider,
  type ServerModelProbeResult,
  type ImageGateway,
  type ImageModelCapabilities,
  type ImageModelConfig,
  type ImageProtocol,
  type ImageTransportMode,
} from "./core";
import { filterAgentPickerModels, filterImagePickerModels, modelAccessSummary } from "./model-ux";
import { appAccessPolicy } from "./access-policy";

import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  GlassSelect,
  SearchField,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog,
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;
const MODEL_OPTION_HEIGHT = 58;
const MODEL_LIST_OVERSCAN = 5;
const MODEL_LIST_VIRTUAL_THRESHOLD = 80;

type DiscoverModels = (payload: {
  provider: ModelProvider;
  baseUrl: string;
  apiKey: string;
}) => Promise<ServerModelProbeResult>;

type ChannelCacheSource = NonNullable<ServerModelProbeResult["source"]>["cacheSource"];

function uniqueModels(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const model = String(value || "").trim();
    const key = model.toLowerCase();
    if (!model || seen.has(key)) return [];
    seen.add(key);
    return [model];
  });
}

function bindingSignature(value: unknown) {
  return JSON.stringify(normalizeModelConnectionBindings(value)
    .sort((left, right) => left.model.toLowerCase().localeCompare(right.model.toLowerCase())));
}

function imageConfigSignature(value: unknown) {
  return JSON.stringify(normalizeImageModelConfigs(value)
    .sort((left, right) => left.model.toLowerCase().localeCompare(right.model.toLowerCase())));
}

function defaultImageCapabilities(): ImageModelCapabilities {
  return {
    generate: true,
    edit: false,
    referenceImages: false,
    multiReferenceImages: false,
    mask: false,
    supportedAspectRatios: [],
    supportedResolutions: [],
    supportedQualities: [],
    transparentBackground: false,
    multipleOutputs: false,
    outputFormats: ["png", "jpeg", "webp"],
  };
}

function defaultImageModelConfig(model: string, accessMode: AppSettings["accessMode"]): ImageModelConfig {
  return {
    id: model,
    displayName: model,
    provider: "custom",
    protocol: "openai-images",
    gateway: accessMode === "account" ? "newapi" : "direct",
    model,
    transportMode: "sync",
    pollIntervalMs: 2_500,
    maxWaitMs: 600_000,
    capabilities: defaultImageCapabilities(),
  };
}

function formatCapabilityTime(value?: string) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatChannelCache(source?: ChannelCacheSource, ageMs?: number) {
  if (source === "network") return "刚刚读取";
  if (source === "memory" || source === "disk" || source === "stale") {
    const age = Number(ageMs);
    if (Number.isFinite(age) && age >= 60_000) return `缓存 ${Math.floor(age / 60_000)} 分钟`;
    return "缓存已命中";
  }
  return "";
}

export default function ModelConfigDialog({
  kind,
  settings,
  setSettings,
  selectedModels,
  models,
  accountTokens = [],
  accessProfiles = [],
  connectionSummaries = {},
  refreshModels,
  discoverModels,
  close,
}: {
  kind: ModelProvider;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  selectedModels: string[];
  models: string[];
  accountTokens?: AccountApiToken[];
  accessProfiles?: ModelAccessProfile[];
  connectionSummaries?: Record<string, ModelConnectionSummary>;
  refreshModels?: (forceRefresh?: boolean) => void | Promise<void>;
  discoverModels?: DiscoverModels;
  close: () => void;
}) {
  const title = kind === "agent" ? "配置对话模型" : kind === "video" ? "配置视频模型" : "配置生图模型";
  const currentModel = kind === "agent" ? settings.agentModel : kind === "video" ? settings.videoModel : settings.imageModel;
  const storedBindings = kind === "agent" ? settings.agentModelBindings : kind === "image" ? settings.imageModelBindings : [];
  const [draftModels, setDraftModels] = useState<string[]>(() => uniqueModels(selectedModels));
  const [activeModel, setActiveModel] = useState(() => currentModel || selectedModels[0] || models[0] || "");
  const [draftBindings, setDraftBindings] = useState(() => normalizeModelConnectionBindings(storedBindings));
  const [draftImageConfigs, setDraftImageConfigs] = useState(() => normalizeImageModelConfigs(settings.imageModelConfigs));
  const [query, setQuery] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [channelBaseUrl, setChannelBaseUrl] = useState(() => kind === "agent" ? settings.agentBaseUrl : settings.imageBaseUrl);
  const [channelApiKey, setChannelApiKey] = useState("");
  const [channelModels, setChannelModels] = useState<string[]>([]);
  const [channelConnection, setChannelConnection] = useState<{
    baseUrl: string;
    apiKey: string;
    models: string[];
    sourceId?: string;
    sourceLabel?: string;
    cacheSource?: ChannelCacheSource;
    cacheAgeMs?: number;
  } | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [showAllChannelModels, setShowAllChannelModels] = useState(false);
  const modelListRef = useRef<HTMLDivElement>(null);
  const [modelListScrollTop, setModelListScrollTop] = useState(0);
  const [modelListViewportHeight, setModelListViewportHeight] = useState(360);
  const draftSet = new Set(draftModels.map((model) => model.toLowerCase()));
  const serverModelSet = new Set([...models, ...channelModels].map((model) => model.toLowerCase()));
  const allPickerModels = uniqueModels([
    ...models, ...draftModels, ...draftBindings.map((binding) => binding.model),
    ...(kind === "image" ? draftImageConfigs.map((config) => config.model) : []), ...channelModels
  ]);
  const detailModel = allPickerModels.find((model) => model.toLowerCase() === activeModel.toLowerCase()) || allPickerModels[0] || "";
  const availableModels = (kind === "image"
    ? filterImagePickerModels
    : kind === "agent"
      ? filterAgentPickerModels
      : uniqueModels)(allPickerModels);
  const pickerModels = showAllChannelModels ? allPickerModels : availableModels;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = pickerModels.filter((model) => model.toLowerCase().includes(normalizedQuery));
  const visibleSelectedCount = filteredModels.filter((model) => draftSet.has(model.toLowerCase())).length;
  const tabStopModel = filteredModels.find((model) => model.toLowerCase() === String(currentModel || "").toLowerCase()) ||
    filteredModels.find((model) => draftSet.has(model.toLowerCase())) ||
    filteredModels[0] || "";
  const tabStopIndex = filteredModels.indexOf(tabStopModel);
  const virtualized = filteredModels.length > MODEL_LIST_VIRTUAL_THRESHOLD;
  const virtualStartIndex = virtualized
    ? Math.max(0, Math.floor(modelListScrollTop / MODEL_OPTION_HEIGHT) - MODEL_LIST_OVERSCAN)
    : 0;
  const virtualEndIndex = virtualized
    ? Math.min(
      filteredModels.length,
      Math.ceil((modelListScrollTop + modelListViewportHeight) / MODEL_OPTION_HEIGHT) + MODEL_LIST_OVERSCAN
    )
    : filteredModels.length;
  const virtualTabStopVisible = tabStopIndex >= virtualStartIndex && tabStopIndex < virtualEndIndex;
  const dirty = uniqueModels(selectedModels).map((model) => model.toLowerCase()).sort().join("\n") !==
    uniqueModels(draftModels).map((model) => model.toLowerCase()).sort().join("\n") ||
    (kind !== "video" && bindingSignature(storedBindings) !== bindingSignature(draftBindings)) ||
    (kind === "image" && imageConfigSignature(settings.imageModelConfigs) !== imageConfigSignature(draftImageConfigs));

  useEffect(() => {
    const element = modelListRef.current;
    if (!element) return;
    const syncHeight = () => setModelListViewportHeight(Math.max(MODEL_OPTION_HEIGHT, element.clientHeight));
    syncHeight();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(syncHeight) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const element = modelListRef.current;
    if (element) element.scrollTop = 0;
    setModelListScrollTop(0);
  }, [query]);

  function updateBinding(model: string, field: "customBaseUrl" | "customApiKey" | "accountTokenId" | "protocol" | "gateway" | "transportMode", value: string) {
    setDraftBindings((current) => {
      const existing = modelConnectionBindingFor(current, model) ?? { model };
      const next: Record<string, unknown> = { ...existing };
      if (value) next[field] = value;
      else delete next[field];
      return normalizeModelConnectionBindings([
        ...current.filter((binding) => binding.model.toLowerCase() !== model.toLowerCase()),
        next,
      ]);
    });
  }

  function imageConfigFor(model: string) {
    return draftImageConfigs.find((config) => config.model.toLowerCase() === model.toLowerCase()) ??
      defaultImageModelConfig(model, settings.accessMode);
  }

  function updateImageConfig(model: string, patch: Partial<ImageModelConfig>) {
    setDraftImageConfigs((current) => {
      const existing = current.find((config) => config.model.toLowerCase() === model.toLowerCase()) ??
        defaultImageModelConfig(model, settings.accessMode);
      return normalizeImageModelConfigs([
        ...current.filter((config) => config.model.toLowerCase() !== model.toLowerCase()),
        { ...existing, ...patch, model, id: existing.id || model },
      ]);
    });
  }

  function updateImageCapability(model: string, key: keyof ImageModelCapabilities, value: boolean) {
    const config = imageConfigFor(model);
    updateImageConfig(model, { capabilities: { ...config.capabilities, [key]: value } });
  }

  function toggle(model: string) {
    const clean = String(model || "").trim();
    if (!clean) return;
    const selected = draftSet.has(clean.toLowerCase());
    const channelMatch = channelConnection?.models.some((item) => item.toLowerCase() === clean.toLowerCase())
      ? channelConnection
      : null;
    setDraftModels((current) => selected
      ? current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      : uniqueModels([...current, clean]));
    // Selecting a model returned by this channel is the explicit user action
    // that assigns its transient connection to the draft. Existing bindings
    // remain untouched until that action happens.
    if (!selected) setActiveModel(clean);
    if (!selected && channelMatch) {
      setDraftBindings((current) => {
        const existing = modelConnectionBindingFor(current, clean) ?? { model: clean };
        return normalizeModelConnectionBindings([
          ...current.filter((binding) => binding.model.toLowerCase() !== clean.toLowerCase()),
          {
            ...existing,
            model: clean,
            customBaseUrl: channelMatch.baseUrl,
            customApiKey: channelMatch.apiKey,
            ...(channelMatch.sourceId ? { channelId: channelMatch.sourceId } : {}),
            ...(channelMatch.sourceLabel ? { channelLabel: channelMatch.sourceLabel } : {})
          },
        ]);
      });
    }
  }

  function setVisibleSelection(checked: boolean) {
    const visible = filteredModels;
    if (!visible.length) return;
    const visibleKeys = new Set(visible.map((model) => model.toLowerCase()));
    setDraftModels((current) => checked
      ? uniqueModels([...current, ...visible])
      : current.filter((model) => !visibleKeys.has(model.toLowerCase())));
    if (!checked || !channelConnection) return;
    const channelKeys = new Set(channelConnection.models.map((model) => model.toLowerCase()));
    const fetchedVisible = visible.filter((model) => channelKeys.has(model.toLowerCase()));
    if (!fetchedVisible.length) return;
    setDraftBindings((current) => normalizeModelConnectionBindings([
      ...current.filter((binding) => !fetchedVisible.some((model) => binding.model.toLowerCase() === model.toLowerCase())),
      ...fetchedVisible.map((model) => ({
        ...(modelConnectionBindingFor(current, model) ?? { model }),
        model,
        customBaseUrl: channelConnection.baseUrl,
        customApiKey: channelConnection.apiKey,
        ...(channelConnection.sourceId ? { channelId: channelConnection.sourceId } : {}),
        ...(channelConnection.sourceLabel ? { channelLabel: channelConnection.sourceLabel } : {})
      }))
    ]));
  }

  function addCustomModel() {
    const clean = String(customModel || "").trim();
    if (!clean) return;
    setDraftModels((current) => uniqueModels([...current, clean]));
    setActiveModel(clean);
    setCustomModel("");
    setQuery("");
  }

  function focusModelAt(index: number) {
    if (!filteredModels.length) return;
    const targetIndex = Math.max(0, Math.min(filteredModels.length - 1, index));
    const list = modelListRef.current;
    if (list && virtualized) {
      const optionTop = targetIndex * MODEL_OPTION_HEIGHT;
      const optionBottom = optionTop + MODEL_OPTION_HEIGHT;
      if (optionTop < list.scrollTop) list.scrollTop = optionTop;
      else if (optionBottom > list.scrollTop + list.clientHeight) list.scrollTop = optionBottom - list.clientHeight;
      setModelListScrollTop(list.scrollTop);
    }
    const focusTarget = () => {
      const target = modelListRef.current
        ?.querySelector<HTMLButtonElement>(`[data-model-index="${targetIndex}"]`);
      if (!target) return false;
      target.focus({ preventScroll: true });
      return true;
    };
    if (focusTarget()) return;
    requestAnimationFrame(() => {
      if (focusTarget()) return;
      requestAnimationFrame(() => { focusTarget(); });
    });
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const last = filteredModels.length - 1;
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? last
        : event.key === "ArrowDown" ? (currentIndex + 1) % filteredModels.length
          : event.key === "ArrowUp" ? (currentIndex + last) % filteredModels.length
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    focusModelAt(nextIndex);
  }

  function renderModelOption(model: string, index: number) {
    const selected = draftSet.has(model.toLowerCase());
    const primary = model.toLowerCase() === String(currentModel || "").toLowerCase();
    const binding = modelConnectionBindingFor(draftBindings, model);
    const savedBinding = modelConnectionBindingFor(storedBindings, model);
    const activeConnection = connectionSummaries[`${kind}:${model.toLowerCase()}`] || {
      model, provider: kind, connectionId: "", protocol: "", transport: "", addressSource: "global", credentialSource: "global-token"
    } as ModelConnectionSummary;
    const draftChanged = bindingSignature(binding ? [binding] : []) !== bindingSignature(savedBinding ? [savedBinding] : [])
      || kind === "image" && imageConfigSignature(draftImageConfigs.filter(config => config.model.toLowerCase() === model.toLowerCase())) !== imageConfigSignature(settings.imageModelConfigs.filter(config => config.model.toLowerCase() === model.toLowerCase()));
    const access = modelAccessSummary(accessProfiles, kind, model, draftChanged ? { ...activeConnection, connectionId: "" } : activeConnection);
    const discoveredFromChannel = channelConnection?.models.some((item) => item.toLowerCase() === model.toLowerCase());
    const sourceLabel = discoveredFromChannel
      ? channelConnection?.sourceLabel || "本次读取渠道"
      : binding?.channelLabel || access?.sourceLabel;
    const accessLabel = access
      ? `${access.status}${access.observedAt ? ` · ${formatCapabilityTime(access.observedAt)}` : ""}`
      : "";
    const accessTitle = access
      ? [access.sourceLabel, access.baseUrl, accessLabel, access.detail].filter(Boolean).join(" · ")
      : model;
    const typeLabel = serverModelSet.has(model.toLowerCase())
      ? (kind === "image" ? imageModelCapability(model).label : kind === "video" ? "视频模型" : "对话模型")
      : "自定义模型";
    const canTab = index === tabStopIndex || (!virtualTabStopVisible && index === virtualStartIndex);
    return (
      <div
        key={`${kind}-${model}`}
        className={`model-picker-option ${selected ? "selected" : ""} ${detailModel === model ? "is-active" : ""}`}
        style={virtualized ? { position: "absolute", top: index * MODEL_OPTION_HEIGHT + 2, left: 0, right: 0, height: MODEL_OPTION_HEIGHT - 4 } : undefined}
        role="listitem"
      >
        <Field className="model-picker-checkbox-hit" label={`启用 ${model}`}>
          <input type="checkbox" checked={selected} aria-label={`启用 ${model}`} onChange={() => toggle(model)} />
        </Field>
        <ButtonBase
          className="model-picker-option-open"
          type="button"
          data-model-index={index}
          aria-label={kind === "video" ? `${selected ? "停用" : "启用"} ${model}` : `查看 ${model} 连接`}
          aria-pressed={kind === "video" ? selected : detailModel === model}
          tabIndex={canTab ? 0 : -1}
          onKeyDown={(event) => handleOptionKeyDown(event, index)}
          onClick={() => kind === "video" ? toggle(model) : setActiveModel(model)}
          title={accessTitle}
        >
          <span className="model-picker-option-copy">
            <strong>{model}</strong>
            <small>{typeLabel}{sourceLabel ? ` · ${sourceLabel}` : ""}{access ? ` · ${accessLabel}` : ""}</small>
          </span>
          {primary ? <em>当前</em> : null}
          {kind !== "video" ? <ChevronRight size={14} aria-hidden="true" /> : null}
        </ButtonBase>
      </div>
    );
  }

  function renderBindingDetails(model: string) {
    const binding = modelConnectionBindingFor(draftBindings, model);
    const imageConfig = kind === "image" ? imageConfigFor(model) : null;
    const providerLabel = kind === "agent" ? "对话" : "图片";
    const globalBaseUrl = kind === "agent" ? settings.agentBaseUrl : settings.imageBaseUrl;
    const globalApiKey = kind === "agent" ? settings.agentApiKey : settings.imageApiKey;
    const accountMode = settings.accessMode === "account";
    const boundTokenId = binding?.accountTokenId || "";
    const boundTokenLoaded = accountTokens.some((token) => token.id === boundTokenId);
    const globalTokenLabel = settings.selectedAccountTokenName
      ? `${settings.selectedAccountTokenName}${settings.selectedAccountTokenGroup ? ` · ${settings.selectedAccountTokenGroup}` : ""}`
      : settings.selectedAccountTokenId
        ? `密钥 #${settings.selectedAccountTokenId}`
        : "尚未选择";
    const summary = connectionSummaries[`${kind}:${model.toLowerCase()}`];
    const changed = bindingSignature(draftBindings) !== bindingSignature(storedBindings)
      || kind === "image" && imageConfigSignature(draftImageConfigs) !== imageConfigSignature(settings.imageModelConfigs);
    const access = summary ? modelAccessSummary(accessProfiles, kind, model, changed ? { ...summary, connectionId: "" } : summary) : null;
    return (
      <section className="model-picker-binding-card" aria-label={model + " 连接配置"}>
        <div className="model-picker-binding-status">
          <span>{changed ? "连接草稿 · 保存后确认有效连接" : "当前有效连接"}</span>
          {binding?.channelLabel ? <small className="model-picker-binding-source">来源：{binding.channelLabel}</small> : null}
        </div>
        <div className="model-picker-binding-summary" aria-label="当前有效连接摘要">
          {summary && !changed ? <>
            <p>地址：{summary.addressSource === "model" ? "逐模型覆盖" : "全局继承"} · 凭据：{{ "model-key": "独立 Key", "model-token": "模型账户 Token", "global-key": "全局 Key", "global-token": "全局账户 Token" }[summary.credentialSource]}</p>
            <p>协议：{summary.protocol} · 结果：{summary.transport === "async" ? "Sub2API Images 任务合同" : summary.transport === "sse" ? "流式" : "同步"}</p>
          </> : <p>连接保存后从 Main 解析实际地址、凭据来源与协议。</p>}
          <p>{access?.operationSummary || "目录与当前操作待验证"}</p>
          {access ? <small title={access.detail}>{access.status}{access.observedAt ? ` · ${formatCapabilityTime(access.observedAt)}` : ""}</small> : null}
          {binding?.connectionSource === "legacy-migration" ? <small>已保留旧连接出口；原地址推断不作为协议验证证据。</small> : null}
        </div>
        <div className="model-picker-binding-fields">
          {appAccessPolicy.customApiAccess ? (
            <Field label="Base URL" hint={accountMode ? "留空时使用账号地址；填写后仅此模型使用该地址。" : `留空时使用全局${providerLabel} Base URL。`}>
              <input
                type="url"
                aria-label={`${model} Base URL`}
                value={binding?.customBaseUrl || ""}
                maxLength={2_048}
                autoComplete="url"
                placeholder={globalBaseUrl || `使用全局${providerLabel} Base URL`}
                onChange={(event) => updateBinding(model, "customBaseUrl", event.target.value)}
              />
            </Field>
          ) : null}
          <Field
            label={accountMode ? "自定义 API Key（可选）" : "API Key"}
            hint={accountMode
              ? `填写后仅此模型优先使用该 Key；留空时使用账户密钥（${globalTokenLabel}）。`
              : `留空时使用全局${providerLabel} API Key。`}
          >
            <input
              type="password"
              aria-label={`${model} API Key`}
              value={binding?.customApiKey || ""}
              maxLength={8_192}
              autoComplete="off"
              placeholder={accountMode
                ? "留空时使用账户密钥"
                : globalApiKey ? `使用全局${providerLabel} API Key` : `全局${providerLabel} API Key 尚未设置`}
              onChange={(event) => updateBinding(model, "customApiKey", event.target.value)}
            />
          </Field>
          {accountMode ? (
            <Field label="账户密钥" hint={`自定义 API Key 留空时回退到这里，再回退到全局密钥（${globalTokenLabel}）。`}>
              <GlassSelect
                value={boundTokenId}
                ariaLabel={`${model} 账户密钥`}
                onChange={(value) => updateBinding(model, "accountTokenId", value)}
                options={[
                  { value: "", label: "使用全局选中密钥" },
                  ...(boundTokenId && !boundTokenLoaded
                    ? [{ value: boundTokenId, label: `密钥 #${boundTokenId} · 元数据未加载` }]
                    : []),
                  ...accountTokens.map((token) => ({
                    value: token.id,
                    label: `${token.name} · ${token.group || "default"}${token.status !== 1 ? " · 已停用" : accountApiTokenExpired(token) ? " · 已过期" : ""}`,
                    disabled: !accountApiTokenUsable(token)
                  }))
                ]}
              />
            </Field>
          ) : null}
        </div>
        {imageConfig ? (
          <details className="model-picker-advanced" key={model}>
            <summary>接口与结果设置</summary>
            <div className="model-picker-binding-fields">
              <Field label="接口格式" hint="以渠道支持的接口为准，独立于模型名称。">
                <GlassSelect
                  value={binding?.protocol || draftImageConfigs.find((config) => config.model.toLowerCase() === model.toLowerCase())?.protocol || "auto"}
                  ariaLabel={`${model} 接口格式`}
                  onChange={(value) => updateBinding(model, "protocol", value)}
                  options={[
                    { value: "auto", label: "自动（沿用默认）" },
                    { value: "openai-images", label: "OpenAI Compatible" },
                    { value: "xai-images", label: "xAI / Grok 原生" },
                    { value: "gemini-native", label: "Google Gemini 原生" }
                  ]}
                />
              </Field>
              <Field label="服务渠道" hint="渠道与接口格式分别设置，Base URL 和密钥沿用下方配置。">
                <GlassSelect
                  value={binding?.gateway || draftImageConfigs.find((config) => config.model.toLowerCase() === model.toLowerCase())?.gateway || "auto"}
                  ariaLabel={`${model} 服务渠道`}
                  onChange={(value) => updateBinding(model, "gateway", value)}
                  options={[
                    { value: "auto", label: "自动（沿用当前连接）" },
                    { value: "direct", label: "官方 / 其他中转站" },
                    { value: "newapi", label: "NewAPI" },
                    { value: "sub2api", label: "Sub2API" }
                  ]}
                />
              </Field>
              <Field label="结果获取" hint="同步直接返回图片；异步创建任务后查询结果，适用于支持该流程的渠道。">
                <GlassSelect
                  value={binding?.transportMode || draftImageConfigs.find((config) => config.model.toLowerCase() === model.toLowerCase())?.transportMode || "auto"}
                  ariaLabel={`${model} 结果获取`}
                  onChange={(value) => updateBinding(model, "transportMode", value)}
                  options={[
                    { value: "auto", label: "自动（沿用渠道默认）" },
                    { value: "sync", label: "同步返回" },
                    { value: "async", label: "异步任务" }
                  ]}
                />
              </Field>
            </div>
          </details>
        ) : null}
        {channelConnection?.models.some((item) => item.toLowerCase() === model.toLowerCase()) ? (
          <ActionButton variant="secondary" onClick={() => setDraftBindings((current) => normalizeModelConnectionBindings([
            ...current.filter((item) => item.model.toLowerCase() !== model.toLowerCase()),
            {
              ...(modelConnectionBindingFor(current, model) ?? { model }),
              customBaseUrl: channelConnection.baseUrl,
              customApiKey: channelConnection.apiKey,
              ...(channelConnection.sourceId ? { channelId: channelConnection.sourceId } : {}),
              ...(channelConnection.sourceLabel ? { channelLabel: channelConnection.sourceLabel } : {})
            }
          ]))}>应用读取的渠道</ActionButton>
        ) : null}
        <small className="model-picker-connection-hint">{settings.accessMode === "custom"
          ? "留空即可继承全局连接。此处修改只对当前模型生效，密钥由系统安全存储加密。"
          : appAccessPolicy.customApiAccess
            ? "无限制版账号登录也支持逐模型 Base URL 与 API Key；自定义 Key 优先，其次账户密钥，再回退全局密钥。"
            : "可为此模型选择账户密钥或填写专用 API Key。"}</small>
      </section>
    );
  }

  function commit() {
    const nextPool = uniqueModels(draftModels);
    if (!nextPool.length) return;
    setSettings((current) => {
      const normalizedAvailableModels = uniqueModels([...models, ...nextPool]);
      if (kind === "agent") {
        const agentModel = nextPool.some((model) => model.toLowerCase() === current.agentModel.toLowerCase()) ? current.agentModel : nextPool[0];
        const agentModelBindings = normalizeAgentModelBindings(nextPool.map((model) =>
          agentModelBindingFor({ agentModelBindings: draftBindings }, model) ?? { model }
        ));
        return normalizeAgentModelPoolSelection({ ...current, agentModel, agentModelPool: nextPool, agentModelBindings }, normalizedAvailableModels);
      }
      if (kind === "video") {
        const videoModel = nextPool.some((model) => model.toLowerCase() === current.videoModel.toLowerCase()) ? current.videoModel : nextPool[0];
        return normalizeVideoModelPoolSelection({ ...current, videoModel, videoModelPool: nextPool }, normalizedAvailableModels);
      }
      const imageModel = nextPool.some((model) => model.toLowerCase() === current.imageModel.toLowerCase()) ? current.imageModel : nextPool[0];
      const imageModelBindings = normalizeImageModelBindings(draftBindings);
      const imageModelConfigs = normalizeImageModelConfigs(draftImageConfigs);
      return normalizeImageModelPoolSelection({ ...current, imageModel, imageModelPool: nextPool, imageModelBindings, imageModelConfigs }, normalizedAvailableModels);
    });
    setClosePromptOpen(false);
    close();
  }

  function requestConfigClose() {
    if (dirty) {
      setClosePromptOpen(true);
      return;
    }
    close();
  }

  async function requestModelRefresh(forceRefresh = false) {
    if (!refreshModels || refreshing) return;
    setRefreshing(true);
    try {
      await refreshModels(forceRefresh);
    } finally {
      setRefreshing(false);
    }
  }

  async function requestChannelModels() {
    if (!discoverModels || kind === "video" || channelLoading) return;
    const baseUrl = channelBaseUrl.trim();
    const apiKey = channelApiKey.trim();
    if (!baseUrl || !apiKey) {
      setChannelError("请输入渠道 Base URL 和 API Key。已配置的全局渠道可直接点击上方“获取模型”。");
      return;
    }
    setChannelLoading(true);
    setChannelError("");
    try {
      const result = await discoverModels({ provider: kind, baseUrl, apiKey });
      if (!result.ok) throw new Error(result.error || "渠道模型目录暂时不可用。");
      const nextModels = uniqueModels(result.models || []);
      setChannelModels(nextModels);
      setChannelConnection({
        baseUrl,
        apiKey,
        models: nextModels,
        sourceId: result.source?.id,
        sourceLabel: result.source?.label,
        cacheSource: result.source?.cacheSource,
        cacheAgeMs: result.source?.cacheAgeMs
      });
      setShowAllChannelModels(false);
      setQuery("");
      if (!nextModels.length) setChannelError("渠道返回了空模型目录，请检查地址、权限或接口兼容性。");
    } catch (error) {
      setChannelModels([]);
      setChannelConnection(null);
      setChannelError(error instanceof Error ? error.message : "读取渠道模型失败。");
    } finally {
      setChannelLoading(false);
    }
  }

  // Hydrate the cached catalog when opening the picker. The toolbar action is
  // the explicit path that asks Main for a fresh directory.
  useEffect(() => {
    if (!refreshModels) return;
    void requestModelRefresh(false);
  }, []);

  return (
    <>
      <DialogShell
        surface={`model-picker-${kind}`}
        ariaLabel={title}
        className="model-picker-dialog"
        layerClassName="model-picker-layer"
        layerLevel="nested"
        dirty={dirty}
        closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }}
        onRequestClose={requestConfigClose}
      >
        {({ requestClose }) => (
          <>
          <SurfaceHeader
            className="model-picker-head"
            title={title}
            description={currentModel ? `当前使用 ${currentModel}` : "当前未配置模型"}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭模型配置"
            closeClassName="model-picker-close"
          />
          <SurfaceBody className={`model-picker-body ${discoverModels && kind !== "video" ? "has-channel-discovery" : ""}`}>
            {discoverModels && kind !== "video" ? (
              <details className="model-picker-channel-discovery">
                <summary className="model-picker-channel-heading">
                  <strong>从渠道读取模型</strong>
                  <span>兼容 NewAPI、Sub2API 和 OpenAI Compatible</span>
                </summary>
                <div className="model-picker-channel-content">
                {channelModels.length ? (
                  <Field className="model-picker-channel-all" label="显示渠道返回的全部模型（当前按用途筛选）">
                    <input
                      type="checkbox"
                      checked={showAllChannelModels}
                      onChange={(event) => setShowAllChannelModels(event.target.checked)}
                    />
                  </Field>
                ) : null}
                <div className="model-picker-channel-fields">
                  <input
                    type="url"
                    value={channelBaseUrl}
                    disabled={channelLoading}
                    maxLength={2_048}
                    autoComplete="url"
                    placeholder="https://你的渠道/v1"
                    aria-label="渠道 Base URL"
                    onChange={(event) => {
                      setChannelBaseUrl(event.target.value);
                      setChannelModels([]);
                      setChannelConnection(null);
                      setChannelError("");
                    }}
                  />
                  <input
                    type="password"
                    value={channelApiKey}
                    disabled={channelLoading}
                    maxLength={8_192}
                    autoComplete="off"
                    placeholder="渠道 API Key"
                    aria-label="渠道 API Key"
                    onChange={(event) => {
                      setChannelApiKey(event.target.value);
                      setChannelModels([]);
                      setChannelConnection(null);
                      setChannelError("");
                    }}
                  />
                  <ActionButton
                    type="button"
                    variant="secondary"
                    busy={channelLoading}
                    disabled={channelLoading || !channelBaseUrl.trim() || !channelApiKey.trim()}
                    onClick={() => void requestChannelModels()}
                  >
                    读取 /v1/models
                  </ActionButton>
                </div>
                <small>
                  读取成功后勾选模型并保存，连接会随所选模型保存；手动补充仍可用于没有目录接口的渠道。
                  {channelConnection ? ` 已读取 ${channelConnection.sourceLabel || "自定义渠道"} · ${channelModels.length} 个模型${formatChannelCache(channelConnection.cacheSource, channelConnection.cacheAgeMs) ? ` · ${formatChannelCache(channelConnection.cacheSource, channelConnection.cacheAgeMs)}` : ""}。` : ""}
                </small>
                {channelError ? <small className="model-picker-channel-error" role="alert">{channelError}</small> : null}
                </div>
              </details>
            ) : null}
            <div className={kind === "video" ? "model-picker-workbench catalog-only" : "model-picker-workbench"}>
              <section className="model-picker-catalog" aria-label="模型目录">
                <div className="model-picker-toolbar">
                  <SearchField
                    className="model-picker-search"
                    label="搜索模型"
                    icon={<Search size={15} />}
                    inputProps={{
                      value: query,
                      onChange: (event) => setQuery(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key !== "ArrowDown" || !filteredModels.length) return;
                        event.preventDefault();
                        focusModelAt(tabStopIndex >= 0 ? tabStopIndex : 0);
                      },
                      placeholder: "搜索完整模型名称",
                      autoFocus: true,
                    }}
                  />
                  <div className="model-picker-count" aria-live="polite">
                    <strong>{draftModels.length}</strong>
                    <span>个已选 · 共 {pickerModels.length} 个</span>
                  </div>
                  {refreshModels ? (
                    <ActionButton
                      type="button"
                      variant="secondary"
                      busy={refreshing}
                      disabled={refreshing}
                      icon={<RefreshCw size={14} />}
                      onClick={() => void requestModelRefresh(true)}
                    >
                      获取模型
                    </ActionButton>
                  ) : null}
                  <div className="model-picker-bulk-actions">
                    <span aria-live="polite">当前结果已选 {visibleSelectedCount} / {filteredModels.length}</span>
                    <ActionButton
                      type="button"
                      variant="secondary"
                      disabled={!filteredModels.length || visibleSelectedCount === filteredModels.length}
                      onClick={() => setVisibleSelection(true)}
                    >
                      全选当前结果
                    </ActionButton>
                    <ActionButton
                      type="button"
                      variant="secondary"
                      disabled={!visibleSelectedCount}
                      onClick={() => setVisibleSelection(false)}
                    >
                      清除当前结果
                    </ActionButton>
                  </div>
                </div>
                <div
                  ref={modelListRef}
                  className={`model-picker-list ${virtualized ? "is-virtualized" : ""}`}
                  role="list"
                  aria-label="可用模型目录"
                  onScroll={(event) => setModelListScrollTop(event.currentTarget.scrollTop)}
                >
                  {filteredModels.length ? virtualized ? (
                    <div className="model-picker-virtual-spacer" style={{ height: filteredModels.length * MODEL_OPTION_HEIGHT }}>
                      {filteredModels.slice(virtualStartIndex, virtualEndIndex).map((model, offset) => renderModelOption(model, virtualStartIndex + offset))}
                    </div>
                  ) : filteredModels.map((model, index) => renderModelOption(model, index)) : (
                    <div className="model-picker-empty">{availableModels.length ? "没有匹配的模型。" : "暂无可用模型，可在上方填写自定义模型名称。"}</div>
                  )}
                </div>
                <div className="model-picker-custom">
                  <label htmlFor={`custom-${kind}-model`}>手动补充模型（可选）</label>
                  <div>
                    <input
                      id={`custom-${kind}-model`}
                      value={customModel}
                      onChange={(event) => setCustomModel(event.target.value.slice(0, 180))}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addCustomModel();
                      }}
                      placeholder={kind === "agent" ? "例如 gpt-5.6-custom" : kind === "video" ? "例如 doubao-seedance-2-0-260128" : "例如 gpt-image-custom"}
                      autoComplete="off"
                    />
                    <ActionButton onClick={addCustomModel} disabled={!customModel.trim()} icon={<Plus size={14} />}>添加</ActionButton>
                  </div>
                  <small>目录未返回的模型可在这里添加，添加后自动启用。</small>
                </div>
              </section>
              {kind !== "video" ? (
                <section className="model-picker-detail" aria-label="逐模型连接">
                  <header className="model-picker-detail-head">
                    <span>逐模型连接</span>
                    <strong title={detailModel}>{detailModel || "选择一个模型"}</strong>
                    <small>勾选框控制启用，点击模型名称查看连接。</small>
                  </header>
                  <div className="model-picker-detail-scroll" key={detailModel}>
                    {detailModel && draftSet.has(detailModel.toLowerCase()) ? renderBindingDetails(detailModel) : (
                      <div className="model-picker-detail-empty">
                        <strong>{detailModel ? "此模型尚未启用" : "暂无模型"}</strong>
                        <p>{detailModel ? "加入可用模型后，即可配置专用地址与密钥。" : "获取模型目录或手动添加一个模型。"}</p>
                        {detailModel ? <ActionButton variant="primary" onClick={() => toggle(detailModel)}>加入可用模型</ActionButton> : null}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </SurfaceBody>
          <SurfaceFooter className="model-picker-actions" leading={<span>保存后，第一个已选模型会在当前模型不可用时接替。</span>}>
            <ActionButton onClick={() => requestClose("action")}>取消</ActionButton>
            <ActionButton variant="primary" onClick={commit} disabled={!draftModels.length}>保存</ActionButton>
          </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface={`model-picker-${kind}-unsaved`}
          ariaLabel={`保存${title}修改`}
          title={`关闭前要保存${title.replace("配置", "")}修改吗？`}
          description="模型勾选、默认模型或逐模型连接仍在当前草稿中。"
          detail={<p>保存后会回到设置页；还需要点击设置页的“保存设置”才会写入本机。</p>}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={() => {
            setClosePromptOpen(false);
            close();
          }}
          onSave={commit}
          saveDisabled={!draftModels.length}
        />
      ) : null}
    </>
  );
}
