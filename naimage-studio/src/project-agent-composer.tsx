import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Goal, ImageIcon, Import, Loader2, MessageSquare, Pause, Play, Search, Send, ShieldCheck, Star, X } from "lucide-react";

import {
  clipboardHasImage,
  computedSizeFor,
  frameOptionsForModel,
  normalizeImageFrameRatio,
  normalizeImageResolutionPreset,
  sizePresetsForModel,
  uniqueImageModels,
  type AgentSteerTaskScopeMode,
  type ImageFrameRatio,
  type ImageResolutionPreset
} from "./core";
import { ActionButton, ButtonBase, DialogShell, IconActionButton, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export type ProjectAgentComposerArtifact = {
  id: string;
  name: string;
};

export type AgentComposerTaskMode = "standard" | "goal";

export type GoalConfirmationDraft = {
  prompt: string;
  snapshotHash: string;
  containerCount: number;
  assetCount: number;
  requestCount: number;
  skipped: string[];
  probeContainerCount: number;
  concurrencyCap: number;
};

export type ProjectAgentComposerProps = {
  selectedArtifacts: ProjectAgentComposerArtifact[];
  sourceImageCount: number;
  referenceImageCount: number;
  prompt: string;
  executionBusy: boolean;
  paused: boolean;
  stopPending: boolean;
  goalActive: boolean;
  goalContainerCount: number;
  goalAssetCount: number;
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  setPrompt: (value: string) => void;
  sendPrompt: (
    prompt?: string,
    taskScopeMode?: AgentSteerTaskScopeMode | "auto",
    taskMode?: AgentComposerTaskMode
  ) => void | Promise<unknown>;
  pauseAgentRun: () => void;
  resumeAgentRun: () => void;
  stopAgentRun: () => void;
  clearSelection: () => void;
  editSourceImages: () => void;
  editReferenceImages: () => void;
  imageModels?: string[];
  selectedImageModels?: string[];
  onSelectedImageModelsChange?: (models: string[]) => void;
  requestImageModels?: () => void | Promise<void>;
  imageRatio?: string;
  imageResolution?: string;
  onImageFrameChange?: (ratio: ImageFrameRatio, resolution: ImageResolutionPreset) => void;
};

export default function ProjectAgentComposer({
  selectedArtifacts,
  sourceImageCount,
  referenceImageCount,
  prompt,
  executionBusy,
  paused,
  stopPending,
  goalActive,
  goalContainerCount,
  goalAssetCount,
  inputRef,
  setPrompt,
  sendPrompt,
  pauseAgentRun,
  resumeAgentRun,
  stopAgentRun,
  clearSelection,
  editSourceImages,
  editReferenceImages,
  imageModels = [],
  selectedImageModels = [],
  onSelectedImageModelsChange,
  requestImageModels,
  imageRatio = "1:1",
  imageResolution = "1K",
  onImageFrameChange
}: ProjectAgentComposerProps) {
  const [taskScopeMode, setTaskScopeMode] = useState<AgentSteerTaskScopeMode | "auto">("auto");
  const [taskMode, setTaskMode] = useState<AgentComposerTaskMode>("standard");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuLoading, setModelMenuLoading] = useState(false);
  const [modelMenuError, setModelMenuError] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [materialsMenuOpen, setMaterialsMenuOpen] = useState(false);
  const [frameMenuOpen, setFrameMenuOpen] = useState<"ratio" | "resolution" | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const materialsPickerRef = useRef<HTMLDivElement | null>(null);
  const framePickerRef = useRef<HTMLDivElement | null>(null);
  const modePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!executionBusy) setTaskScopeMode("auto");
  }, [executionBusy]);

  useEffect(() => {
    if (!modelMenuOpen && !materialsMenuOpen && !frameMenuOpen && !modeMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && [modelPickerRef, materialsPickerRef, framePickerRef, modePickerRef]
        .some((ref) => ref.current?.contains(target))) return;
      setModelMenuOpen(false);
      setMaterialsMenuOpen(false);
      setFrameMenuOpen(null);
      setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const shouldRestoreModelFocus = modelMenuOpen;
      setModelMenuOpen(false);
      setMaterialsMenuOpen(false);
      setFrameMenuOpen(null);
      setModeMenuOpen(false);
      if (shouldRestoreModelFocus) {
        window.requestAnimationFrame(() => modelPickerRef.current?.querySelector<HTMLButtonElement>(".project-agent-model-trigger")?.focus());
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [frameMenuOpen, materialsMenuOpen, modeMenuOpen, modelMenuOpen]);

  useEffect(() => {
    if (!executionBusy && !stopPending) return;
    setModelMenuOpen(false);
    setMaterialsMenuOpen(false);
    setFrameMenuOpen(null);
    setModeMenuOpen(false);
  }, [executionBusy, stopPending]);

  async function dispatchPrompt() {
    if (stopPending) return;
    setModelMenuOpen(false);
    setMaterialsMenuOpen(false);
    setFrameMenuOpen(null);
    setModeMenuOpen(false);
    await sendPrompt(undefined, goalActive ? "keep" : taskScopeMode, taskMode);
    if (executionBusy) setTaskScopeMode("auto");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    void dispatchPrompt();
  }

  const selectionLabel = selectedArtifacts.length === 1
    ? selectedArtifacts[0].name
    : `${selectedArtifacts.length} 个选中成果`;
  const goalAvailable = goalContainerCount > 0 && goalAssetCount > 0;
  const goalSelected = !executionBusy && taskMode === "goal";
  const availableModels = uniqueImageModels([...imageModels, ...selectedImageModels]);
  const configuredModels = uniqueImageModels(selectedImageModels);
  const activeModels = configuredModels.length ? configuredModels : availableModels.slice(0, 1);
  const activeModelKeys = new Set(activeModels.map((model) => model.toLowerCase()));
  const defaultImageModel = activeModels[0] || "";
  const defaultImageModelKey = defaultImageModel.toLowerCase();
  const activeImageRatio = normalizeImageFrameRatio(imageRatio);
  const activeImageResolution = normalizeImageResolutionPreset(imageResolution);
  const ratioOptions = frameOptionsForModel(activeImageResolution, defaultImageModel);
  const resolutionOptions = sizePresetsForModel(activeImageRatio, defaultImageModel);
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const filteredModels = normalizedModelQuery
    ? availableModels.filter((model) => model.toLowerCase().includes(normalizedModelQuery))
    : availableModels;
  const selectedModelSummary = defaultImageModel || "选择模型";

  function toggleImageModel(model: string) {
    if (!onSelectedImageModelsChange) return;
    const key = model.toLowerCase();
    if (activeModelKeys.has(key)) {
      if (activeModels.length <= 1) return;
      onSelectedImageModelsChange(activeModels.filter((item) => item.toLowerCase() !== key));
      return;
    }
    onSelectedImageModelsChange([...activeModels, model]);
  }

  function setDefaultImageModel(model: string) {
    if (!onSelectedImageModelsChange) return;
    const key = model.toLowerCase();
    onSelectedImageModelsChange([model, ...activeModels.filter((item) => item.toLowerCase() !== key)]);
  }

  function changeImageRatio(ratio: string) {
    if (!onImageFrameChange) return;
    const nextRatio = normalizeImageFrameRatio(ratio, activeImageRatio);
    const availableResolutions = sizePresetsForModel(nextRatio, defaultImageModel);
    const nextResolution = availableResolutions.some((option) => option.resolution === activeImageResolution)
      ? activeImageResolution
      : availableResolutions[0]?.resolution || activeImageResolution;
    onImageFrameChange(nextRatio, nextResolution);
    setFrameMenuOpen(null);
  }

  function changeImageResolution(resolution: string) {
    if (!onImageFrameChange) return;
    const nextResolution = normalizeImageResolutionPreset(resolution, activeImageResolution);
    const availableRatios = frameOptionsForModel(nextResolution, defaultImageModel);
    const nextRatio = availableRatios.some((option) => option.ratio === activeImageRatio)
      ? activeImageRatio
      : availableRatios[0]?.ratio || activeImageRatio;
    onImageFrameChange(nextRatio, nextResolution);
    setFrameMenuOpen(null);
  }

  function selectTaskMode(nextMode: AgentComposerTaskMode) {
    if (nextMode === "goal" && !goalAvailable) return;
    setTaskMode(nextMode);
    setModeMenuOpen(false);
  }

  async function toggleModelMenu() {
    if (modelMenuOpen) {
      setModelMenuOpen(false);
      return;
    }
    setModelMenuOpen(true);
    setModelQuery("");
    setModelMenuError("");
    if (!requestImageModels) return;
    setModelMenuLoading(true);
    try {
      await requestImageModels();
    } catch (error) {
      setModelMenuError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelMenuLoading(false);
    }
  }

  return (
    <form className="project-agent-composer" onSubmit={submit} aria-busy={stopPending || undefined}>
      <div className="project-agent-composer-toolbar">
        {!executionBusy ? (
          <div
            ref={modePickerRef}
            className={`project-agent-mode-picker${modeMenuOpen ? " is-open" : ""}`}
            onMouseEnter={() => setModeMenuOpen(true)}
            onMouseLeave={(event) => {
              if (event.currentTarget.contains(document.activeElement)) return;
              setModeMenuOpen(false);
            }}
            onFocusCapture={() => setModeMenuOpen(true)}
            onBlurCapture={(event) => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
              setModeMenuOpen(false);
            }}
          >
            <ButtonBase
              type="button"
              className={`project-agent-mode-trigger${taskMode === "goal" ? " is-goal" : ""}`}
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title={taskMode === "goal" ? "Goal：作用于画布全部合格图片容器" : "普通：向 Agent 发送当前任务"}
              onClick={() => setModeMenuOpen(true)}
            >
              {taskMode === "goal" ? <Goal size={14} /> : <MessageSquare size={14} />}
              <strong>{taskMode === "goal" ? "Goal" : "普通"}</strong>
              <ChevronDown size={13} aria-hidden="true" />
            </ButtonBase>
            <div className="project-agent-mode-fan" role="menu" aria-label="选择 Agent 任务模式">
              <ButtonBase
                type="button"
                role="menuitemradio"
                className={`project-agent-mode-option standard${taskMode === "standard" ? " active" : ""}`}
                aria-checked={taskMode === "standard"}
                onClick={() => selectTaskMode("standard")}
              >
                <MessageSquare size={13} />
                <span>普通</span>
              </ButtonBase>
              <ButtonBase
                type="button"
                role="menuitemradio"
                className={`project-agent-mode-option goal${taskMode === "goal" ? " active" : ""}`}
                aria-checked={taskMode === "goal"}
                disabled={!goalAvailable}
                title={goalAvailable ? `${goalContainerCount} 个容器 · ${goalAssetCount} 张图` : "画布暂无可执行图片容器"}
                onClick={() => selectTaskMode("goal")}
              >
                <Goal size={13} />
                <span>Goal</span>
              </ButtonBase>
            </div>
          </div>
        ) : null}
        {!goalSelected && !goalActive ? (
          <div ref={materialsPickerRef} className={`project-agent-materials-picker${materialsMenuOpen ? " is-open" : ""}`}>
            <ButtonBase
              type="button"
              className="project-agent-materials-trigger"
              aria-haspopup="menu"
              aria-expanded={materialsMenuOpen}
              disabled={stopPending}
              title={`素材：${sourceImageCount} 张原图，${referenceImageCount} 张参考图`}
              onClick={() => setMaterialsMenuOpen((current) => !current)}
            >
              <ImageIcon size={14} />
              <strong>素材</strong>
              {sourceImageCount + referenceImageCount ? <small>{sourceImageCount + referenceImageCount}</small> : null}
              <ChevronDown size={13} aria-hidden="true" />
            </ButtonBase>
            {materialsMenuOpen ? (
              <div className="project-agent-materials-menu" role="menu" aria-label="管理输入素材">
                <ButtonBase type="button" role="menuitem" onClick={() => { setMaterialsMenuOpen(false); editSourceImages(); }}>
                  <Import size={14} />
                  <span><strong>{sourceImageCount ? `${sourceImageCount} 张原图` : "添加原图"}</strong><small>作为当前任务的来源</small></span>
                </ButtonBase>
                <ButtonBase type="button" role="menuitem" onClick={() => { setMaterialsMenuOpen(false); editReferenceImages(); }}>
                  <ImageIcon size={14} />
                  <span><strong>{referenceImageCount ? `${referenceImageCount} 张参考图` : "添加参考图"}</strong><small>提供风格或内容参考</small></span>
                </ButtonBase>
              </div>
            ) : null}
          </div>
        ) : null}
        {availableModels.length || requestImageModels ? (
          <div ref={modelPickerRef} className={`project-agent-model-picker${modelMenuOpen ? " is-open" : ""}`} role="group" aria-label="可用生图模型">
            <ButtonBase
              type="button"
              className="project-agent-model-trigger"
              aria-haspopup="dialog"
              aria-expanded={modelMenuOpen}
              disabled={stopPending || !onSelectedImageModelsChange}
              title={defaultImageModel ? `默认模型：${defaultImageModel}；已选 ${activeModels.length} 个` : "选择生图模型"}
              onClick={() => void toggleModelMenu()}
            >
              <ImageIcon size={13} />
              <strong>{selectedModelSummary}</strong>
              <small>{activeModels.length}</small>
              <ChevronDown size={14} />
            </ButtonBase>
            {modelMenuOpen ? (
              <section className="project-agent-model-menu" role="dialog" aria-label="选择生图模型">
                <label className="project-agent-model-search">
                  <Search size={13} />
                  <input
                    type="search"
                    value={modelQuery}
                    placeholder="搜索上游模型"
                    aria-label="搜索生图模型"
                    autoFocus
                    onChange={(event) => setModelQuery(event.target.value.slice(0, 160))}
                  />
                  {modelMenuLoading ? <Loader2 className="spin" size={13} aria-label="正在刷新上游模型" /> : null}
                </label>
                <div className="project-agent-model-options" role="listbox" aria-label="上游生图模型" aria-multiselectable="true">
                  {filteredModels.map((model) => {
                    const selected = activeModelKeys.has(model.toLowerCase());
                    const isDefault = model.toLowerCase() === defaultImageModelKey;
                    const lastSelected = selected && activeModels.length === 1;
                    return (
                      <div
                        key={model.toLowerCase()}
                        className={`project-agent-model-row${selected ? " active" : ""}${lastSelected ? " is-required" : ""}`}
                        role="option"
                        aria-selected={selected}
                      >
                        <label className="project-agent-model-option" title={lastSelected ? "至少保留一个生图模型" : model}>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={lastSelected}
                            onChange={() => toggleImageModel(model)}
                          />
                          <span>{model}</span>
                          {selected ? <Check size={13} aria-hidden="true" /> : null}
                        </label>
                        <ButtonBase
                          type="button"
                          className={`project-agent-model-default${isDefault ? " is-default" : ""}`}
                          aria-label={isDefault ? `默认生图模型：${model}` : `设为默认生图模型：${model}`}
                          title={isDefault ? "默认生图模型" : "设为默认生图模型"}
                          onClick={() => setDefaultImageModel(model)}
                        >
                          <Star size={14} fill={isDefault ? "currentColor" : "none"} aria-hidden="true" />
                        </ButtonBase>
                      </div>
                    );
                  })}
                  {!filteredModels.length ? <p>没有匹配的模型</p> : null}
                </div>
                {modelMenuError ? <small className="project-agent-model-error">刷新失败，已显示缓存模型：{modelMenuError}</small> : null}
              </section>
            ) : null}
          </div>
        ) : null}
        <div ref={framePickerRef} className="project-agent-image-frame" role="group" aria-label="默认生图比例与清晰度">
          <div className={`project-agent-frame-picker ratio${frameMenuOpen === "ratio" ? " is-open" : ""}`}>
            <ButtonBase
              type="button"
              className="project-agent-frame-trigger"
              aria-haspopup="listbox"
              aria-expanded={frameMenuOpen === "ratio"}
              aria-label="默认生图比例"
              title="比例"
              disabled={executionBusy || stopPending || !onImageFrameChange}
              onClick={() => setFrameMenuOpen((current) => current === "ratio" ? null : "ratio")}
            >
              <strong>{activeImageRatio}</strong>
              <ChevronDown size={13} aria-hidden="true" />
            </ButtonBase>
            {frameMenuOpen === "ratio" ? (
              <div className="project-agent-frame-menu" role="listbox" aria-label="选择默认生图比例">
                {ratioOptions.map((option) => (
                  <ButtonBase
                    key={option.ratio}
                    type="button"
                    role="option"
                    className={option.ratio === activeImageRatio ? "active" : ""}
                    aria-selected={option.ratio === activeImageRatio}
                    onClick={() => changeImageRatio(option.ratio)}
                  >
                    <strong>{option.ratio}</strong>
                    <small>{option.label}</small>
                  </ButtonBase>
                ))}
              </div>
            ) : null}
          </div>
          <div className={`project-agent-frame-picker resolution${frameMenuOpen === "resolution" ? " is-open" : ""}`}>
            <ButtonBase
              type="button"
              className="project-agent-frame-trigger"
              aria-haspopup="listbox"
              aria-expanded={frameMenuOpen === "resolution"}
              aria-label="默认生图清晰度"
              title="清晰度"
              disabled={executionBusy || stopPending || !onImageFrameChange}
              onClick={() => setFrameMenuOpen((current) => current === "resolution" ? null : "resolution")}
            >
              <strong>{activeImageResolution}</strong>
              <ChevronDown size={13} aria-hidden="true" />
            </ButtonBase>
            {frameMenuOpen === "resolution" ? (
              <div className="project-agent-frame-menu" role="listbox" aria-label="选择默认生图清晰度">
                {resolutionOptions.map((option) => (
                  <ButtonBase
                    key={option.resolution}
                    type="button"
                    role="option"
                    className={option.resolution === activeImageResolution ? "active" : ""}
                    aria-selected={option.resolution === activeImageResolution}
                    onClick={() => changeImageResolution(option.resolution)}
                  >
                    <strong>{option.resolution}</strong>
                  </ButtonBase>
                ))}
              </div>
            ) : null}
          </div>
          <small className="project-agent-frame-size" title="按当前比例与清晰度计算的实际交付尺寸">
            {computedSizeFor(activeImageRatio, activeImageResolution)}
          </small>
        </div>
      </div>
      {goalSelected || goalActive || selectedArtifacts.length ? (
        <div className={`project-agent-composer-meta${goalSelected || goalActive ? " goal" : ""}`}>
          {goalSelected || goalActive ? (
            <div className="project-agent-goal-context" aria-label={`Goal 范围 ${goalContainerCount} 个容器 ${goalAssetCount} 张图`}>
              <Goal size={14} />
              <strong>{goalActive ? "Goal 运行中" : "全部图片容器"}</strong>
              <span>{goalContainerCount} 个容器 · {goalAssetCount} 张图</span>
            </div>
          ) : selectedArtifacts.length ? (
          <div
            className="project-agent-composer-context has-artifact"
            data-selection-kind={selectedArtifacts.length > 1 ? "multiple" : "single"}
            data-selection-count={selectedArtifacts.length}
            data-selection-ids={selectedArtifacts.map((artifact) => artifact.id).join(" ")}
            title={selectedArtifacts.length > 1 ? selectedArtifacts.map((artifact) => artifact.name).join("、") : undefined}
            aria-label={`将基于 ${selectionLabel}`}
          >
            <ImageIcon size={13} />
            <span>将基于</span>
            <strong>{selectionLabel}</strong>
            <IconActionButton label="取消当前选中" onClick={clearSelection} disabled={stopPending} icon={<X size={12} />} />
          </div>
          ) : null}
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        value={prompt}
        disabled={stopPending}
        onChange={(event) => setPrompt(event.target.value.slice(0, 36000))}
        onPaste={(event) => {
          if (clipboardHasImage(event)) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void dispatchPrompt();
          }
        }}
        placeholder={executionBusy
          ? goalActive ? "修改 Goal 的处理要求，冻结容器范围保持不变..." : "输入修改要求，发送后 Agent 会停止旧计划并重新规划..."
          : goalSelected ? "描述要对画布全部图片容器执行的操作..." : selectedArtifacts.length ? "描述如何继续处理选中的成果..." : "告诉 Agent 你想完成什么..."}
        rows={4}
      />
      {executionBusy ? (
        <label className="project-agent-steer-mode">
          <span>本次修改使用的图片</span>
          {goalActive ? <strong>保持全部图片范围，只修改要求</strong> : (
            <select
              value={taskScopeMode}
              disabled={stopPending}
              onChange={(event) => setTaskScopeMode(event.target.value as AgentSteerTaskScopeMode | "auto")}
              aria-label="本次修改使用的图片"
            >
              <option value="auto">自动处理（推荐）</option>
              <option value="keep">只修改要求，保留现有图片</option>
              <option value="replace-source">更换处理图片</option>
            </select>
          )}
          <small>{goalActive
            ? "Goal 运行中不会悄悄扩大或更换图片范围。"
            : taskScopeMode === "keep"
              ? "只调整文字要求，不替换当前处理图片。"
              : taskScopeMode === "replace-source"
                ? "用当前选中的图片替换原处理图片。"
                : "有新选中图片时用于处理；没有时沿用当前图片。"}</small>
        </label>
      ) : null}
      <footer>
        <span>{stopPending ? "正在等待底层确认；当前任务状态保持不变" : paused ? "已暂停，可先发送修改要求" : executionBusy ? "Ctrl + Enter 修改当前任务" : goalSelected ? "发送前确认冻结范围与费用" : "Ctrl + Enter 发送"}</span>
        {executionBusy ? (
          <div className="project-agent-run-controls">
            <ActionButton
              className="project-agent-steer"
              variant="primary"
              type="submit"
              disabled={stopPending || !prompt.trim()}
              aria-label="修改当前任务"
              title="中断当前阶段并按新要求重新规划"
              icon={<Send size={15} />}
            >
              修改
            </ActionButton>
            <ActionButton
              className="project-agent-pause"
              variant="secondary"
              type="button"
              onClick={paused ? resumeAgentRun : pauseAgentRun}
              disabled={stopPending}
              aria-label={paused ? "恢复处理" : "暂停处理"}
              title={paused ? "恢复后继续派发下一批" : "确认后暂停后续批次"}
              icon={paused ? <Play size={15} /> : <Pause size={15} />}
            >
              {paused ? "恢复" : "暂停"}
            </ActionButton>
            <ActionButton
              className="project-agent-stop"
              variant="danger"
              type="button"
              onClick={stopAgentRun}
              busy={stopPending}
              aria-label={stopPending ? "正在确认结束" : "结束处理"}
              title={stopPending ? "正在等待底层确认；当前任务状态保持不变" : "确认后取消思考、生图和未开始批次"}
              icon={<X size={16} />}
            >
              {stopPending ? "正在结束" : "结束"}
            </ActionButton>
          </div>
        ) : (
          <ActionButton
            className="project-agent-send"
            variant="primary"
            type="submit"
            disabled={!prompt.trim()}
            aria-label="发送"
            title="发送"
            icon={<Send size={16} />}
          >
            发送
          </ActionButton>
        )}
      </footer>
    </form>
  );
}

export function GoalConfirmationDialog({
  draft,
  busy,
  notice,
  close,
  submit
}: {
  draft: GoalConfirmationDraft;
  busy: boolean;
  notice?: string;
  close: () => void;
  submit: () => void | Promise<void>;
}) {
  return (
    <DialogShell
      surface="goal-confirmation"
      ariaLabel="确认 Goal 批量执行"
      className="goal-confirmation-dialog"
      busy={busy}
      closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle" }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            eyebrow="GOAL"
            title="确认批量图片任务"
            description="确认本次处理范围后直接执行；后续新增或变化的图片不会自动加入。"
            onClose={() => requestClose("close-button")}
            closeDisabled={busy}
          />
          <SurfaceBody className="goal-confirmation-body">
            <div className="goal-confirmation-scope">
              <Goal size={18} />
              <div>
                <strong>{draft.containerCount} 个来源边界 · {draft.assetCount} 张母图</strong>
                <span>最多 {draft.requestCount} 次图片请求</span>
              </div>
              <code>范围已确认</code>
            </div>
            {notice ? (
              <div className="goal-confirmation-notice" role="status">
                <AlertTriangle size={15} />
                <span>{notice}</span>
              </div>
            ) : null}
            <ul className="goal-confirmation-policy">
              <li><ShieldCheck size={15} /><span>先小批量测试 {draft.probeContainerCount} 个不同母图代表项，通过后再逐步增加任务量。</span></li>
              <li><Check size={15} /><span>请求、落盘和技术校验通过后公平共享最高 {draft.concurrencyCap} 路；服务重试会暂停新波次，保护性失败会跨 Goal 熔断。</span></li>
              <li><AlertTriangle size={15} /><span>软件不要求预估费用；上游若在任务完成后返回实际用量或费用，将按返回值记录。</span></li>
            </ul>
            {draft.skipped.length ? (
              <details className="goal-confirmation-skipped">
                <summary>{draft.skipped.length} 个容器不会执行</summary>
                <p>{draft.skipped.slice(0, 12).join("；")}</p>
              </details>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton variant="primary" onClick={submit} busy={busy} icon={<Goal size={16} />}>
              开始执行
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
