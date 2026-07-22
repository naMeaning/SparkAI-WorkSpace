import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { Check, Search } from "lucide-react";

import {
  imageModelCapability,
  normalizeAgentModelPoolSelection,
  normalizeImageModelPoolSelection,
  type AppSettings,
} from "./core";

import {
  ActionButton,
  ButtonBase,
  DialogShell,
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

export default function ModelConfigDialog({
  kind,
  settings,
  setSettings,
  selectedModels,
  models,
  close,
}: {
  kind: "agent" | "image";
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  selectedModels: string[];
  models: string[];
  close: () => void;
}) {
  const title = kind === "agent" ? "配置对话模型" : "配置生图模型";
  const currentModel = kind === "agent" ? settings.agentModel : settings.imageModel;
  const [draftModels, setDraftModels] = useState<string[]>(() => uniqueModels(selectedModels));
  const [query, setQuery] = useState("");
  const draftSet = new Set(draftModels.map((model) => model.toLowerCase()));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = models.filter((model) => model.toLowerCase().includes(normalizedQuery));
  const tabStopModel = filteredModels.find((model) => model.toLowerCase() === String(currentModel || "").toLowerCase()) ||
    filteredModels.find((model) => draftSet.has(model.toLowerCase())) ||
    filteredModels[0] || "";
  const dirty = uniqueModels(selectedModels).map((model) => model.toLowerCase()).sort().join("\n") !==
    uniqueModels(draftModels).map((model) => model.toLowerCase()).sort().join("\n");

  function toggle(model: string) {
    const clean = String(model || "").trim();
    if (!clean) return;
    setDraftModels((current) => current.some((item) => item.toLowerCase() === clean.toLowerCase())
      ? current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      : uniqueModels([...current, clean]));
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
      if (kind === "agent") {
        const agentModel = nextPool.some((model) => model.toLowerCase() === current.agentModel.toLowerCase()) ? current.agentModel : nextPool[0];
        return normalizeAgentModelPoolSelection({ ...current, agentModel, agentModelPool: nextPool }, models);
      }
      const imageModel = nextPool.some((model) => model.toLowerCase() === current.imageModel.toLowerCase()) ? current.imageModel : nextPool[0];
      return normalizeImageModelPoolSelection({ ...current, imageModel, imageModelPool: nextPool }, models);
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
                <span>个已选 · 共 {models.length} 个</span>
              </div>
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
                      <small>{kind === "image" ? imageModelCapability(model).label : "对话模型"}</small>
                    </span>
                    {primary ? <em>当前</em> : selected ? <em>已选</em> : null}
                  </ButtonBase>
                );
              }) : (
                <div className="model-picker-empty">{models.length ? "没有匹配的模型。" : "暂无可用模型，请返回设置页获取模型。"}</div>
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
