import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { Check, Plus, Search } from "lucide-react";

import {
  imageModelBindingFor,
  imageModelCapability,
  normalizeAgentModelPoolSelection,
  normalizeImageModelBindings,
  normalizeImageModelPoolSelection,
  type AccountApiToken,
  type AppSettings,
} from "./core";

import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  SearchField,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;

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
  return JSON.stringify(normalizeImageModelBindings(value)
    .sort((left, right) => left.model.toLowerCase().localeCompare(right.model.toLowerCase())));
}

export default function ModelConfigDialog({
  kind,
  settings,
  setSettings,
  selectedModels,
  models,
  accountTokens = [],
  close,
}: {
  kind: "agent" | "image";
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  selectedModels: string[];
  models: string[];
  accountTokens?: AccountApiToken[];
  close: () => void;
}) {
  const title = kind === "agent" ? "配置对话模型" : "配置生图模型";
  const currentModel = kind === "agent" ? settings.agentModel : settings.imageModel;
  const [draftModels, setDraftModels] = useState<string[]>(() => uniqueModels(selectedModels));
  const [draftBindings, setDraftBindings] = useState(() => normalizeImageModelBindings(settings.imageModelBindings));
  const [query, setQuery] = useState("");
  const [customModel, setCustomModel] = useState("");
  const draftSet = new Set(draftModels.map((model) => model.toLowerCase()));
  const serverModelSet = new Set(models.map((model) => model.toLowerCase()));
  const availableModels = uniqueModels([...models, ...draftModels]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = availableModels.filter((model) => model.toLowerCase().includes(normalizedQuery));
  const tabStopModel = filteredModels.find((model) => model.toLowerCase() === String(currentModel || "").toLowerCase()) ||
    filteredModels.find((model) => draftSet.has(model.toLowerCase())) ||
    filteredModels[0] || "";
  const dirty = uniqueModels(selectedModels).map((model) => model.toLowerCase()).sort().join("\n") !==
    uniqueModels(draftModels).map((model) => model.toLowerCase()).sort().join("\n") ||
    (kind === "image" && bindingSignature(settings.imageModelBindings) !== bindingSignature(draftBindings));

  function updateBinding(model: string, field: "customApiKey" | "accountTokenId", value: string) {
    setDraftBindings((current) => {
      const existing = imageModelBindingFor({ imageModelBindings: current }, model) ?? { model };
      const next = { ...existing };
      if (value) next[field] = value;
      else delete next[field];
      return normalizeImageModelBindings([
        ...current.filter((binding) => binding.model.toLowerCase() !== model.toLowerCase()),
        next,
      ]);
    });
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

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") || []);
    const currentIndex = options.indexOf(event.currentTarget);
    const last = options.length - 1;
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? last
        : event.key === "ArrowDown" ? (currentIndex + 1) % options.length
          : event.key === "ArrowUp" ? (currentIndex + last) % options.length
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const target = options[nextIndex];
    event.currentTarget.tabIndex = -1;
    target.tabIndex = 0;
    target.focus({ preventScroll: true });
  }

  function commit() {
    const nextPool = uniqueModels(draftModels);
    if (!nextPool.length) return;
    setSettings((current) => {
      const normalizedAvailableModels = uniqueModels([...models, ...nextPool]);
      if (kind === "agent") {
        const agentModel = nextPool.some((model) => model.toLowerCase() === current.agentModel.toLowerCase()) ? current.agentModel : nextPool[0];
        return normalizeAgentModelPoolSelection({ ...current, agentModel, agentModelPool: nextPool }, normalizedAvailableModels);
      }
      const imageModel = nextPool.some((model) => model.toLowerCase() === current.imageModel.toLowerCase()) ? current.imageModel : nextPool[0];
      const imageModelBindings = normalizeImageModelBindings(nextPool.map((model) =>
        imageModelBindingFor({ imageModelBindings: draftBindings }, model) ?? { model }
      ));
      return normalizeImageModelPoolSelection({ ...current, imageModel, imageModelPool: nextPool, imageModelBindings }, normalizedAvailableModels);
    });
    close();
  }

  return (
    <DialogShell
      surface={`model-picker-${kind}`}
      ariaLabel={title}
      className="model-picker-dialog"
      layerClassName="model-picker-layer"
      layerLevel="nested"
      dirty={dirty}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={close}
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
                    const options = Array.from(document.querySelectorAll<HTMLButtonElement>(".model-picker-option"));
                    const option = options.find((item) => item.tabIndex === 0) || options[0];
                    option?.focus({ preventScroll: true });
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
                  placeholder={kind === "agent" ? "例如 gpt-5.6-custom" : "例如 gpt-image-custom"}
                  autoComplete="off"
                />
                <ActionButton onClick={addCustomModel} disabled={!customModel.trim()} icon={<Plus size={14} />}>添加</ActionButton>
              </div>
              <small>适用于中转站尚未返回、但实际可请求的模型名称；添加后会自动选中并随设置保存。</small>
              {kind === "image" ? (
                <>
                  <label>逐模型凭证</label>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, maxHeight: 190, overflowY: "auto", paddingRight: 4 }}>
                    {draftModels.map((model) => {
                      const binding = imageModelBindingFor({ imageModelBindings: draftBindings }, model);
                      if (settings.accessMode === "custom") {
                        return (
                          <Field key={`binding-${model}`} label={model} hint="留空时回退到全局图片 API Key。">
                            <input
                              type="password"
                              value={binding?.customApiKey || ""}
                              maxLength={8_192}
                              autoComplete="off"
                              placeholder={settings.imageApiKey ? "使用全局图片 API Key" : "全局图片 API Key 尚未设置"}
                              onChange={(event) => updateBinding(model, "customApiKey", event.target.value)}
                            />
                          </Field>
                        );
                      }
                      const boundTokenId = binding?.accountTokenId || "";
                      const boundTokenLoaded = accountTokens.some((token) => token.id === boundTokenId);
                      const globalTokenLabel = settings.selectedAccountTokenName
                        ? `${settings.selectedAccountTokenName}${settings.selectedAccountTokenGroup ? ` · ${settings.selectedAccountTokenGroup}` : ""}`
                        : settings.selectedAccountTokenId
                          ? `密钥 #${settings.selectedAccountTokenId}`
                          : "尚未选择";
                      return (
                        <Field key={`binding-${model}`} label={model} hint={`留空时回退到全局密钥（${globalTokenLabel}）。`}>
                          <select value={boundTokenId} onChange={(event) => updateBinding(model, "accountTokenId", event.target.value)}>
                            <option value="">使用全局选中密钥</option>
                            {boundTokenId && !boundTokenLoaded ? <option value={boundTokenId}>密钥 #{boundTokenId} · 元数据未加载</option> : null}
                            {accountTokens.map((token) => (
                              <option key={token.id} value={token.id} disabled={token.status !== 1}>
                                {token.name} · {token.group || "default"}{token.status !== 1 ? " · 已停用" : ""}
                              </option>
                            ))}
                          </select>
                        </Field>
                      );
                    })}
                  </div>
                  <small>所有图片模型共享同一 Base URL；这里只保存自定义 Key 或账户 Token ID，账户完整 Key 不会进入界面进程。</small>
                </>
              ) : null}
            </div>
            <div className="model-picker-list" role="listbox" aria-multiselectable="true">
              {filteredModels.length ? filteredModels.map((model) => {
                const selected = draftSet.has(model.toLowerCase());
                const primary = model.toLowerCase() === String(currentModel || "").toLowerCase();
                return (
                  <ButtonBase
                    key={`${kind}-${model}`}
                    className={`ui-choice-row model-picker-option ${selected ? "selected" : ""} ${primary ? "current" : ""}`}
                    type="button"
                    role="option"
                    data-ui-choice-layout="list"
                    aria-selected={selected}
                    tabIndex={model === tabStopModel ? 0 : -1}
                    onKeyDown={handleOptionKeyDown}
                    onClick={() => toggle(model)}
                    title={kind === "image" ? imageModelCapability(model).label : model}
                  >
                    <span className="model-picker-checkbox" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                    <span className="model-picker-option-copy">
                      <strong>{model}</strong>
                      <small>{serverModelSet.has(model.toLowerCase()) ? (kind === "image" ? imageModelCapability(model).label : "对话模型") : "自定义模型"}</small>
                    </span>
                    {primary ? <em>当前</em> : selected ? <em>已选</em> : null}
                  </ButtonBase>
                );
              }) : (
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
  );
}
