import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Goal, ImageIcon, Import, Pause, Play, RefreshCw, Send, Settings2, ShieldCheck, X } from "lucide-react";

import {
  clipboardHasImage,
  type AgentSteerTaskScopeMode
} from "./core";
import { ActionButton, ButtonBase, DialogShell, GlassSelect, IconActionButton, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import { idleComposerPrimaryAction } from "./model-ux";
import { composerCommands, composerCommandSuggestions, composerCommandError, parseComposerInput, type ComposerCommand } from "../runtime/composer-commands.mjs";
import type { ComposerMaterialItem, ComposerMaterialRole } from "./selection-reference-images";

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
  selectionReferenceCount?: number;
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
  materials?: ComposerMaterialItem[];
  onMaterialSequenceChange?: (key: string, sequence: number) => void;
  onMaterialRoleChange?: (key: string, role: ComposerMaterialRole) => void;
  onRemoveMaterial?: (key: string) => void;
  regenerateImage?: () => void;
  editImageConfig: () => void;
  requestNewConversation: () => void;
};

export default function ProjectAgentComposer({
  selectedArtifacts,
  sourceImageCount,
  referenceImageCount,
  selectionReferenceCount = 0,
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
  materials = [],
  onMaterialSequenceChange,
  onMaterialRoleChange,
  onRemoveMaterial,
  regenerateImage,
  editImageConfig,
  requestNewConversation
}: ProjectAgentComposerProps) {
  const [taskScopeMode, setTaskScopeMode] = useState<AgentSteerTaskScopeMode | "auto">("auto");
  const [materialsMenuOpen, setMaterialsMenuOpen] = useState(false);
  const [commandNotice, setCommandNotice] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const materialsPickerRef = useRef<HTMLDivElement | null>(null);
  const suggestions = composerCommandSuggestions(prompt);
  const visibleCommands = helpOpen ? composerCommands : commandsDismissed ? [] : suggestions;
  const parsedInput = parseComposerInput(prompt);
  const goalSelected = !executionBusy && parsedInput.kind === "command" && parsedInput.name === "goal";

  useEffect(() => {
    setCommandIndex(0);
    setCommandsDismissed(false);
    setCommandNotice("");
    setHelpOpen(false);
  }, [prompt]);

  useEffect(() => {
    if (!visibleCommands.length) return;
    document.getElementById(`composer-command-${visibleCommands[commandIndex]?.name}`)?.scrollIntoView({ block: "nearest" });
  }, [commandIndex, prompt, helpOpen, commandsDismissed]);

  useEffect(() => {
    if (!executionBusy) setTaskScopeMode("auto");
  }, [executionBusy]);

  useEffect(() => {
    if (!materialsMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && materialsPickerRef.current?.contains(event.target)) return;
      setMaterialsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaterialsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [materialsMenuOpen]);

  async function dispatchPrompt(value = prompt) {
    if (stopPending) return;
    const content = value.trim();
    if (!content) return;
    setMaterialsMenuOpen(false);
    const parsed = parseComposerInput(content);
    const error = composerCommandError(parsed, { busy: executionBusy, paused, stopPending, goalActive, goalAvailable: goalContainerCount > 0 && goalAssetCount > 0 });
    if (error) { setCommandNotice(error); setCommandsDismissed(true); return; }
    if (parsed.kind === "unknown") return;
    if (parsed.kind === "command") {
      if (parsed.name === "goal") {
        await sendPrompt(parsed.argument, goalActive ? "keep" : "auto", goalActive ? "standard" : "goal");
        return;
      }
      if (!["help", "status"].includes(parsed.name)) setPrompt("");
      setCommandsDismissed(true);
      switch (parsed.name) {
        case "config": editImageConfig(); break;
        case "help": setHelpOpen(true); break;
        case "status": setCommandNotice(`${stopPending ? "正在结束" : paused ? "已暂停" : executionBusy ? "任务运行中" : "当前空闲"}${goalActive ? ` · Goal 范围 ${goalContainerCount} 个容器 / ${goalAssetCount} 张图` : ` · ${effectiveSourceCount} 张原图 / ${effectiveReferenceCount} 张参考图`}`); break;
        case "new": requestNewConversation(); break;
        case "pause": pauseAgentRun(); break;
        case "resume": resumeAgentRun(); break;
        case "stop": stopAgentRun(); break;
      }
      return;
    }
    await sendPrompt(parsed.text, goalActive ? "keep" : taskScopeMode, "standard");
    if (executionBusy) setTaskScopeMode("auto");
  }

  function chooseCommand(command: ComposerCommand) {
    setHelpOpen(false);
    if (command.takesArgument) {
      setPrompt(`/${command.name} `);
      setCommandsDismissed(true);
      inputRef.current?.focus();
    } else void dispatchPrompt(`/${command.name}`);
  }

  function dispatchGenerate() {
    if (stopPending || !regenerateImage) return;
    setMaterialsMenuOpen(false);
    regenerateImage();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (primaryAction === "generate") {
      dispatchGenerate();
      return;
    }
    if (!prompt.trim()) return;
    void dispatchPrompt();
  }

  const selectionLabel = selectedArtifacts.length === 1
    ? selectedArtifacts[0].name
    : `${selectedArtifacts.length} 个选中成果`;
  const canGenerate = Boolean(regenerateImage) && !prompt.trimStart().startsWith("/");
  const primaryAction = idleComposerPrimaryAction({
    executionBusy,
    goalSelected,
    canGenerate
  });
  const materialSourceCount = materials.filter((item) => item.role === "source").length;
  const materialReferenceCount = materials.filter((item) => item.role === "reference").length;
  const effectiveSourceCount = materials.length ? materialSourceCount : sourceImageCount;
  const effectiveReferenceCount = materials.length ? materialReferenceCount : referenceImageCount + selectionReferenceCount;

  return (
    <form className="project-agent-composer" onSubmit={submit} aria-busy={stopPending || undefined}>
      <div className="project-agent-composer-toolbar">
        {!goalSelected && !goalActive ? (
          <div ref={materialsPickerRef} className={`project-agent-materials-picker${materialsMenuOpen ? " is-open" : ""}`}>
            <ButtonBase
              type="button"
              className="project-agent-materials-trigger"
              aria-haspopup="menu"
              aria-expanded={materialsMenuOpen}
              disabled={stopPending}
              title={`当前素材：${effectiveSourceCount} 张原图，${effectiveReferenceCount} 张参考图。选中画布图片即可使用，序号可改。`}
              onClick={() => {
                setMaterialsMenuOpen((current) => !current);
              }}
            >
              <ImageIcon size={14} />
              <strong>素材</strong>
              {effectiveSourceCount + effectiveReferenceCount ? <small>{effectiveSourceCount + effectiveReferenceCount}</small> : null}
              <ChevronDown size={13} aria-hidden="true" />
            </ButtonBase>
            {materialsMenuOpen ? (
              <div className="project-agent-materials-menu" role="menu" aria-label="管理输入素材">
                <ButtonBase type="button" role="menuitem" onClick={() => { setMaterialsMenuOpen(false); editSourceImages(); }}>
                  <Import size={14} />
                  <span><strong>添加原图</strong><small>从本地文件或画布选取要处理的图片</small></span>
                </ButtonBase>
                <ButtonBase type="button" role="menuitem" onClick={() => { setMaterialsMenuOpen(false); editReferenceImages(); }}>
                  <ImageIcon size={14} />
                  <span><strong>添加参考图</strong><small>从本地文件或画布选取风格/内容参考</small></span>
                </ButtonBase>
              </div>
            ) : null}
          </div>
        ) : null}
        <ButtonBase type="button" className="project-agent-config-trigger" aria-label="图片配置" disabled={stopPending} onClick={() => { setMaterialsMenuOpen(false); editImageConfig(); }} title="配置生图模型、比例、清晰度、数量与质量">
          <Settings2 size={14} /><strong>图片配置</strong>
        </ButtonBase>
      </div>
      {goalSelected || goalActive || materials.length || selectedArtifacts.length ? (
        <div className={`project-agent-composer-meta${goalSelected || goalActive ? " goal" : ""}`}>
          {goalSelected || goalActive ? (
            <div className="project-agent-goal-context" aria-label={`Goal 范围 ${goalContainerCount} 个容器 ${goalAssetCount} 张图`}>
              <Goal size={14} />
              <strong>{goalActive ? "Goal 运行中" : "全部图片容器"}</strong>
              <span>{goalContainerCount} 个容器 · {goalAssetCount} 张图</span>
            </div>
          ) : materials.length ? (
            <div
              className="project-agent-material-strip"
              data-selection-kind={selectedArtifacts.length > 1 ? "multiple" : selectedArtifacts.length ? "single" : "none"}
              data-selection-count={selectedArtifacts.length}
              data-selection-ids={selectedArtifacts.map((artifact) => artifact.id).join(" ")}
              aria-label={`当前素材，可改序号和原图/参考角色${selectedArtifacts.length ? `；当前选中 ${selectionLabel}` : ""}`}
            >
              {materials.map((item) => (
                <label key={item.key} className={`project-agent-material-chip role-${item.role}`} title={`${item.sequence}. ${item.role === "source" ? "原图" : "参考"} ${item.name}`}>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={item.sequence}
                    disabled={stopPending}
                    aria-label={`${item.name} 的序号`}
                    onChange={(event) => onMaterialSequenceChange?.(item.key, Number(event.target.value))}
                  />
                  <ButtonBase
                    type="button"
                    className="project-agent-material-role"
                    disabled={stopPending || !onMaterialRoleChange}
                    onClick={() => onMaterialRoleChange?.(item.key, item.role === "source" ? "reference" : "source")}
                  >
                    {item.role === "source" ? "原图" : "参考"}
                  </ButtonBase>
                  <strong>{item.name}</strong>
                  {onRemoveMaterial ? (
                    <IconActionButton label={`移除 ${item.name}`} onClick={() => onRemoveMaterial(item.key)} disabled={stopPending} icon={<X size={11} />} />
                  ) : null}
                </label>
              ))}
            </div>
          ) : selectedArtifacts.length ? (
          <div
            className="project-agent-composer-context has-artifact"
            data-selection-kind={selectedArtifacts.length > 1 ? "multiple" : "single"}
            data-selection-count={selectedArtifacts.length}
            data-selection-ids={selectedArtifacts.map((artifact) => artifact.id).join(" ")}
            title={selectedArtifacts.map((artifact) => artifact.name).join("、")}
            aria-label={`当前选中 ${selectionLabel}`}
          >
            <ImageIcon size={13} />
            <span>当前选中</span>
            <strong>{selectionLabel}</strong>
            <IconActionButton label="取消当前选中" onClick={clearSelection} disabled={stopPending} icon={<X size={12} />} />
          </div>
          ) : null}
        </div>
      ) : null}
      <div className="project-agent-command-input">
        {visibleCommands.length ? <div id="composer-commands" className="project-agent-command-menu" role="listbox" aria-label="斜杠命令">
          <div className="project-agent-command-heading"><span>命令 · ↑↓ 选择 · Enter 执行</span><IconActionButton label="收起命令" onClick={() => { setHelpOpen(false); setCommandsDismissed(true); }} icon={<X size={12} />} /></div>
          {visibleCommands.map((command, index) => <ButtonBase type="button" role="option" id={`composer-command-${command.name}`} key={command.name} className={index === commandIndex ? "active" : ""} aria-selected={index === commandIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCommand(command)}><code>{command.usage}</code><small>{command.description}</small></ButtonBase>)}
        </div> : null}
      <textarea
        ref={inputRef}
        value={prompt}
        disabled={stopPending}
        aria-label="Agent 指令"
        aria-expanded={visibleCommands.length > 0}
        aria-controls={visibleCommands.length ? "composer-commands" : undefined}
        aria-activedescendant={visibleCommands[commandIndex] ? `composer-command-${visibleCommands[commandIndex].name}` : undefined}
        onChange={(event) => setPrompt(event.target.value.slice(0, 36000))}
        onPaste={(event) => {
          if (clipboardHasImage(event)) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (visibleCommands.length && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setCommandIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + visibleCommands.length) % visibleCommands.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              chooseCommand(visibleCommands[commandIndex] || visibleCommands[0]);
              return;
            }
          }
          if (event.key === "Escape") {
            setCommandsDismissed(true);
            setHelpOpen(false);
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (primaryAction === "generate") dispatchGenerate();
            else void dispatchPrompt();
          }
        }}
        placeholder={executionBusy
          ? goalActive ? "修改 Goal 的处理要求，冻结容器范围保持不变..." : "输入修改要求，发送后 Agent 会停止旧计划并重新规划..."
          : goalSelected ? "描述要对画布全部图片容器执行的操作..."
            : materials.some((item) => item.role === "source") ? "描述如何处理这些原图；参考图会按序号一起送出..."
            : materials.length ? "描述要用这些参考图生成什么..."
            : "告诉 Agent 你想完成什么，输入 / 使用命令..."}
        rows={4}
      />
      </div>
      {commandNotice ? <p className="project-agent-command-notice" role="status">{commandNotice}</p> : null}
      {executionBusy ? (
        <label className="project-agent-steer-mode">
          <span>本次修改使用的图片</span>
          {goalActive ? <strong>保持全部图片范围，只修改要求</strong> : (
            <GlassSelect
              value={taskScopeMode}
              disabled={stopPending}
              ariaLabel="本次修改使用的图片"
              onChange={(value) => setTaskScopeMode(value as AgentSteerTaskScopeMode | "auto")}
              options={[
                { value: "auto", label: "自动处理（推荐）" },
                { value: "keep", label: "只修改要求，保留现有图片" },
                { value: "replace-source", label: "更换处理图片" }
              ]}
            />
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
        <span>{stopPending ? "正在等待底层确认；当前任务状态保持不变" : paused ? "已暂停，可先发送修改要求" : executionBusy ? "Ctrl + Enter 修改当前任务" : goalSelected ? "发送前确认冻结范围与费用" : primaryAction === "generate" ? "Ctrl + Enter 生成 · / 命令" : "Ctrl + Enter 发送 · / 命令"}</span>
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
              {prompt.trimStart().startsWith("/") ? "执行命令" : "修改"}
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
          <div className="project-agent-send-group" data-primary-action={primaryAction}>
            {canGenerate ? (
              <ActionButton
                className="project-agent-regenerate"
                variant={primaryAction === "generate" ? "primary" : "secondary"}
                type={primaryAction === "generate" ? "submit" : "button"}
                disabled={stopPending}
                onClick={primaryAction === "generate" ? undefined : dispatchGenerate}
                aria-label="生成"
                data-composer-primary={primaryAction === "generate" ? "true" : undefined}
                title={effectiveReferenceCount
                  ? "使用当前提示词和参考图直接生图，不经过 Agent"
                  : "使用当前提示词直接生图；选中图片容器时会按顺序当作参考图"}
                icon={<RefreshCw size={15} />}
              >
                生成
              </ActionButton>
            ) : null}
            <ActionButton
              className="project-agent-send"
              variant={primaryAction === "send" ? "primary" : "secondary"}
              type="button"
              disabled={stopPending || !prompt.trim()}
              onClick={() => void dispatchPrompt()}
              aria-label="发送"
              data-composer-primary={primaryAction === "send" ? "true" : undefined}
              title="把当前要求发给项目 Agent"
              icon={<Send size={16} />}
            >
              {prompt.trimStart().startsWith("/") ? "执行命令" : "发送给 Agent"}
            </ActionButton>
          </div>
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
