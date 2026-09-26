import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { Check, Plus, Search } from "lucide-react";

import {
  agentModelBindingFor,
  imageModelBindingFor,
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
  type ModelCapabilityEvidence,
  type ModelProvider,
  type ImageGateway,
  type ImageModelCapabilities,
  type ImageModelConfig,
  type ImageProtocol,
  type ImageTransportMode,
} from "./core";
import { filterAgentPickerModels, filterImagePickerModels } from "./model-ux";
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

const EVIDENCE_PRIORITY: Record<ModelCapabilityEvidence, number> = {
  "name-inferred": 1,
  "upstream-declared": 2,
  "runtime-verified": 3,
};

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

function modelAccessSummary(accessProfiles: ModelAccessProfile[], kind: ModelProvider, model: string) {
  const key = model.toLowerCase();
  const candidates = accessProfiles.flatMap((profile) => {
    if (!profile.providers.includes(kind)) return [];
    const capability = profile.capabilities[key];
    return capability ? [{ profile, capability }] : [];
  }).sort((left, right) => {
    const evidenceDelta = EVIDENCE_PRIORITY[right.capability.evidence] - EVIDENCE_PRIORITY[left.capability.evidence];
    if (evidenceDelta) return evidenceDelta;
    const rightTime = Date.parse(right.capability.lastVerifiedAt || right.capability.lastCheckedAt || "") || 0;
    const leftTime = Date.parse(left.capability.lastVerifiedAt || left.capability.lastCheckedAt || "") || 0;
    return rightTime - leftTime;
  });
  const selected = candidates[0];
  if (!selected) return null;
  const evidence = selected.capability.evidence;
  const checkedAt = formatCapabilityTime(
    evidence === "runtime-verified" ? selected.capability.lastVerifiedAt : selected.capability.lastCheckedAt
  );
  const label = evidence === "runtime-verified"
    ? "真实验证"
    : evidence === "upstream-declared"
      ? "上游声明"
      : "名称推断";
  return {
    label: checkedAt ? `${label} · ${checkedAt}` : label,
    title: `${selected.profile.label}${selected.profile.baseUrl ? ` · ${selected.profile.baseUrl}` : ""} · ${label}`,
  };
}

export default function ModelConfigDialog({
  kind,
  settings,
  setSettings,
  selectedModels,
  models,
  accountTokens = [],
  accessProfiles = [],
  close,
}: {
  kind: ModelProvider;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  selectedModels: string[];
  models: string[];
  accountTokens?: AccountApiToken[];
  accessProfiles?: ModelAccessProfile[];
  close: () => void;
}) {
  const title = kind === "agent" ? "配置对话模型" : kind === "video" ? "配置视频模型" : "配置生图模型";
  const currentModel = kind === "agent" ? settings.agentModel : kind === "video" ? settings.videoModel : settings.imageModel;
  const storedBindings = kind === "agent" ? settings.agentModelBindings : kind === "image" ? settings.imageModelBindings : [];
  const [draftModels, setDraftModels] = useState<string[]>(() => uniqueModels(selectedModels));
  const [draftBindings, setDraftBindings] = useState(() => normalizeModelConnectionBindings(storedBindings));
  const [draftImageConfigs, setDraftImageConfigs] = useState(() => normalizeImageModelConfigs(settings.imageModelConfigs));
  const [query, setQuery] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const modelListRef = useRef<HTMLDivElement>(null);
  const [modelListScrollTop, setModelListScrollTop] = useState(0);
  const [modelListViewportHeight, setModelListViewportHeight] = useState(360);
  const draftSet = new Set(draftModels.map((model) => model.toLowerCase()));
  const serverModelSet = new Set(models.map((model) => model.toLowerCase()));
  const availableModels = (kind === "image"
    ? filterImagePickerModels
    : kind === "agent"
      ? filterAgentPickerModels
      : uniqueModels)([...models, ...draftModels]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = availableModels.filter((model) => model.toLowerCase().includes(normalizedQuery));
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

  function updateBinding(model: string, field: "customBaseUrl" | "customApiKey" | "accountTokenId", value: string) {
    setDraftBindings((current) => {
      const existing = modelConnectionBindingFor(current, model) ?? { model };
      const next = { ...existing };
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
    setDraftModels((current) => current.some((item) => item.toLowerCase() === clean.toLowerCase())
      ? current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      : uniqueModels([...current, clean]));
  }

  function addCustomModel() {
    const clean = String(customModel || "").trim();
    if (!clean) return;
    setDraftModels((current) => uniqueModels([...current, clean]));
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
    const access = modelAccessSummary(accessProfiles, kind, model);
    const typeLabel = serverModelSet.has(model.toLowerCase())
      ? (kind === "image" ? imageModelCapability(model).label : kind === "video" ? "视频模型" : "对话模型")
      : "自定义模型";
    const canTab = index === tabStopIndex || (!virtualTabStopVisible && index === virtualStartIndex);
    return (
      <ButtonBase
        key={`${kind}-${model}`}
        className={`ui-choice-row model-picker-option ${selected ? "selected" : ""} ${primary ? "current" : ""}`}
        style={virtualized ? { position: "absolute", top: index * MODEL_OPTION_HEIGHT + 2, left: 0, right: 0, height: MODEL_OPTION_HEIGHT - 4 } : undefined}
        type="button"
        role="option"
        data-ui-choice-layout="list"
        data-model-index={index}
        aria-selected={selected}
        tabIndex={canTab ? 0 : -1}
        onKeyDown={(event) => handleOptionKeyDown(event, index)}
        onClick={() => toggle(model)}
        title={access?.title || (kind === "image" ? imageModelCapability(model).label : model)}
      >
        <span className="model-picker-checkbox" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
        <span className="model-picker-option-copy">
          <strong>{model}</strong>
          <small>{typeLabel}{access ? ` · ${access.label}` : ""}</small>
        </span>
        {primary ? <em>当前</em> : selected ? <em>已选</em> : null}
      </ButtonBase>
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
      const imageModelBindings = normalizeImageModelBindings(nextPool.map((model) =>
        imageModelBindingFor({ imageModelBindings: draftBindings }, model) ?? { model }
      ));
      const imageModelConfigs = normalizeImageModelConfigs(draftImageConfigs.filter((config) =>
        nextPool.some((model) => model.toLowerCase() === config.model.toLowerCase())
      ));
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
          <SurfaceBody className="model-picker-body">
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
                <span>个已选 · 共 {availableModels.length} 个</span>
              </div>
            </div>
            <div className="model-picker-custom">
              <label htmlFor={`custom-${kind}-model`}>自定义模型</label>
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
              <small>适用于中转站尚未返回、但实际可请求的模型名称；添加后会自动选中并随设置保存。</small>
              {kind !== "video" ? (
                <>
                  <span className="model-picker-binding-title">逐模型连接</span>
                  <div className="model-picker-binding-list">
                    {draftModels.map((model) => {
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
                      return (
                        <section key={`binding-${model}`} className="model-picker-binding-card">
                          <strong title={model}>{model}</strong>
                          {imageConfig ? (
                            <div className="model-picker-binding-fields image-model-transport-fields">
                              <Field label="协议" hint="请求协议由配置决定，不根据模型名称猜测。">
                                <GlassSelect
                                  value={imageConfig.protocol}
                                  ariaLabel={`${model} 图片协议`}
                                  onChange={(value) => updateImageConfig(model, { protocol: value as ImageProtocol })}
                                  options={[
                                    { value: "openai-images", label: "OpenAI Images" },
                                    { value: "xai-images", label: "xAI Images" },
                                    { value: "gemini-native", label: "Gemini Native" },
                                  ]}
                                />
                              </Field>
                              <Field label="网关" hint="网关只负责传输与鉴权，和模型厂商分离。">
                                <GlassSelect
                                  value={imageConfig.gateway}
                                  ariaLabel={`${model} 图片网关`}
                                  onChange={(value) => updateImageConfig(model, { gateway: value as ImageGateway })}
                                  options={[
                                    { value: "newapi", label: "NewAPI" },
                                    { value: "sub2api", label: "Sub2API" },
                                    { value: "direct", label: "Direct API" },
                                  ]}
                                />
                              </Field>
                              <Field label="传输模式" hint="异步模式仅在网关提供任务接口时启用。">
                                <GlassSelect
                                  value={imageConfig.transportMode}
                                  ariaLabel={`${model} 图片传输模式`}
                                  onChange={(value) => updateImageConfig(model, { transportMode: value as ImageTransportMode })}
                                  options={[
                                    { value: "sync", label: "同步" },
                                    { value: "async", label: "异步任务" },
                                  ]}
                                />
                              </Field>
                              <Field label="Provider" hint="仅作模型目录标识，不决定请求协议。">
                                <input
                                  value={imageConfig.provider}
                                  maxLength={64}
                                  autoComplete="off"
                                  placeholder="openai / xai / google / custom"
                                  onChange={(event) => updateImageConfig(model, { provider: event.target.value })}
                                />
                              </Field>
                              <div className="model-picker-capability-toggles" role="group" aria-label={`${model} 图片能力`}>
                                {([
                                  ["generate", "文生图"],
                                  ["edit", "图像编辑"],
                                  ["referenceImages", "参考图"],
                                  ["multiReferenceImages", "多参考图"],
                                  ["mask", "蒙版"],
                                  ["multipleOutputs", "多张输出"],
                                  ["transparentBackground", "透明背景"],
                                ] as Array<[keyof ImageModelCapabilities, string]>).map(([key, label]) => (
                                  <label key={String(key)}>
                                    <input
                                      type="checkbox"
                                      checked={imageConfig.capabilities[key] === true}
                                      onChange={(event) => updateImageCapability(model, key, event.target.checked)}
                                    />
                                    <span>{label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div className="model-picker-binding-fields">
                            {appAccessPolicy.customApiAccess ? (
                              <Field label="Base URL" hint={accountMode ? "留空时使用账号地址；填写后仅此模型使用该地址。" : `留空时使用全局${providerLabel} Base URL。`}>
                                <input
                                  type="url"
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
                                      label: `${token.name} · ${token.group || "default"}${token.status !== 1 ? " · 已停用" : ""}`,
                                      disabled: token.status !== 1
                                    }))
                                  ]}
                                />
                              </Field>
                            ) : null}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <small>{settings.accessMode === "custom"
                    ? `每个${kind === "agent" ? "对话" : "图片"}模型可覆盖全局 Base URL 与 API Key；API Key 仍由操作系统安全存储加密。`
                    : appAccessPolicy.customApiAccess
                      ? "无限制版账号登录也支持逐模型 Base URL 与 API Key；填写自定义连接后优先使用该模型配置。"
                      : "此版本固定使用官方账号服务；可为模型选择账户密钥或填写逐模型 API Key。"}</small>
                </>
              ) : null}
            </div>
            <div
              ref={modelListRef}
              className={`model-picker-list ${virtualized ? "is-virtualized" : ""}`}
              role="listbox"
              aria-multiselectable="true"
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
