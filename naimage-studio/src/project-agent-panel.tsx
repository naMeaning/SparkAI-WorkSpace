import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChevronDown,
  Loader2,
  Move,
  PanelBottom,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  PanelsTopLeft,
  Plus,
  Trash2
} from "lucide-react";
import type {
  AgentConversation,
  AgentMessage,
  AgentProgress,
  AgentStatus,
  AgentSteerTaskScopeMode,
  AppSettings,
  ReferenceImage
} from "./core";
import type { AgentComposerTaskMode } from "./project-agent-composer";
import {
  agentPanelLayoutForPlacement,
  agentPanelLayoutFromPointer,
  applyAgentPanelLayoutPreview,
  clampAgentPanelLayout,
  clearAgentPanelLayoutPreview,
  type AgentPanelLayout,
  type AgentPanelPointerMode
} from "./agent-panel-layout";
import { ButtonBase, IconActionButton } from "./ui";

declare const __NAIMAGE_AIDEBUG__: boolean;
declare const __NAIMAGE_PERF_PROBE__: boolean;

const NAIMAGE_RUNTIME_METRICS = (
  __NAIMAGE_AIDEBUG__ &&
  window.naimageRuntime?.aidebugEnabled === true &&
  window.naimageRuntime?.isolatedConfig === true
) || __NAIMAGE_PERF_PROBE__;
const PROJECT_AGENT_WELCOME = "描述想要的画面即可直接生图；也可以添加参考图，或选中画布图片后替换元素、设计多款和制作分层 PNG。";
const LazyAgentMessageContent = React.lazy(() => import("./agent-message-content"));
let projectAgentComposerPromise: Promise<typeof import("./project-agent-composer")> | null = null;
const loadProjectAgentComposer = () => projectAgentComposerPromise ??= import("./project-agent-composer");
const LazyProjectAgentComposerContent = React.lazy(() => loadProjectAgentComposer().then((module) => ({ default: module.default })));

type DebugRenderCommitArea = "agentFeed" | "composer";
export type ProjectAgentArtifact = { id: string; name: string };

function DebugCommitProbe({ area, record }: { area: DebugRenderCommitArea; record: (area: DebugRenderCommitArea) => void }) {
  useEffect(() => {
    if (NAIMAGE_RUNTIME_METRICS) record(area);
  });
  return null;
}

const PROJECT_AGENT_MESSAGE_PAGE_SIZE = 80;
const PROJECT_AGENT_FOLLOW_DISTANCE = 72;
const PROJECT_AGENT_HISTORY_ID = "project-agent-history";
const PROJECT_AGENT_HISTORY_TOGGLE_ID = "project-agent-history-toggle";
const PROJECT_AGENT_PLACEMENT_TOGGLE_ID = "project-agent-placement-toggle";

function ProjectAgentFeedView({
  messages,
  agentProgressCount,
  endRef,
  debugCommit
}: {
  messages: AgentMessage[];
  agentProgressCount: number;
  endRef: React.MutableRefObject<HTMLDivElement | null>;
  debugCommit: (area: DebugRenderCommitArea) => void;
}) {
  const messagePageSize = PROJECT_AGENT_MESSAGE_PAGE_SIZE;
  const [visibleMessageCount, setVisibleMessageCount] = useState(messagePageSize);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const lastMessageIdRef = useRef("");
  const renderedMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleMessageCount)),
    [messages, visibleMessageCount]
  );
  const hiddenMessageCount = Math.max(0, messages.length - renderedMessages.length);

  useEffect(() => {
    if (messages.length === 0) return;
    const latestMessage = messages[messages.length - 1];
    const userStartedTask = latestMessage?.role === "user" && latestMessage.id !== lastMessageIdRef.current;
    lastMessageIdRef.current = latestMessage?.id || "";
    if (!followBottomRef.current && !userStartedTask) return;
    followBottomRef.current = true;
    const settleBottom = () => {
      const feed = feedRef.current;
      if (!feed) return;
      feed.scrollTop = feed.scrollHeight;
    };
    settleBottom();
    const frame = window.requestAnimationFrame(settleBottom);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [agentProgressCount, endRef, messages]);

  function revealEarlierMessages() {
    const feed = feedRef.current;
    const previousScrollHeight = feed?.scrollHeight ?? 0;
    const previousScrollTop = feed?.scrollTop ?? 0;
    setVisibleMessageCount((current) => Math.min(messages.length, current + messagePageSize));
    window.requestAnimationFrame(() => {
      if (!feed) return;
      feed.scrollTop = previousScrollTop + Math.max(0, feed.scrollHeight - previousScrollHeight);
    });
  }

  return (
    <>
      {NAIMAGE_RUNTIME_METRICS ? <DebugCommitProbe area="agentFeed" record={debugCommit} /> : null}
      <div
        ref={feedRef}
        className={`project-agent-feed ${messages.length === 0 ? "is-empty" : ""}`}
        onScroll={(event) => {
          const feed = event.currentTarget;
          followBottomRef.current = feed.scrollHeight - feed.clientHeight - feed.scrollTop <= PROJECT_AGENT_FOLLOW_DISTANCE;
        }}
      >
        {messages.length === 0 ? (
          <div className="project-agent-empty">
            <Brain size={22} />
            <strong>Agent 已接手当前项目</strong>
            <span>{PROJECT_AGENT_WELCOME}</span>
          </div>
        ) : null}
        {hiddenMessageCount > 0 ? (
          <ButtonBase
            className="project-agent-load-earlier"
            type="button"
            onClick={revealEarlierMessages}
            aria-label={`显示更早的 ${Math.min(messagePageSize, hiddenMessageCount)} 条消息`}
          >
            显示更早消息
            <small>还有 {hiddenMessageCount} 条</small>
          </ButtonBase>
        ) : null}
        {renderedMessages.map((message) => (
          <article key={message.id} className={`agent-message ${message.role} ${message.status ?? "done"}`}>
            <span className="agent-message-node" aria-hidden="true" />
            <React.Suspense fallback={<div className="markdown-body agent-plain-text">{message.content}</div>}>
              <LazyAgentMessageContent message={message} />
            </React.Suspense>
          </article>
        ))}
        <div ref={endRef} />
      </div>
    </>
  );
}

const ProjectAgentFeed = React.memo(ProjectAgentFeedView);

function ProjectAgentComposerView({
  selectedArtifacts,
  sourceImages,
  referenceImages,
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
  regenerateImage,
  imageModels,
  selectedImageModels,
  onSelectedImageModelsChange,
  requestImageModels,
  imageRatio,
  imageResolution,
  onImageFrameChange,
  debugCommit
}: {
  selectedArtifacts: ProjectAgentArtifact[];
  sourceImages: ReferenceImage[];
  referenceImages: ReferenceImage[];
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
  sendPrompt: (prompt?: string, taskScopeMode?: AgentSteerTaskScopeMode | "auto", taskMode?: AgentComposerTaskMode) => void | Promise<unknown>;
  pauseAgentRun: () => void;
  resumeAgentRun: () => void;
  stopAgentRun: () => void;
  clearSelection: () => void;
  editSourceImages: () => void;
  editReferenceImages: () => void;
  regenerateImage?: () => void;
  imageModels: string[];
  selectedImageModels: string[];
  onSelectedImageModelsChange: (models: string[]) => void;
  requestImageModels: () => void | Promise<void>;
  imageRatio: AppSettings["imageRatio"];
  imageResolution: AppSettings["imageResolution"];
  onImageFrameChange: (ratio: AppSettings["imageRatio"], resolution: AppSettings["imageResolution"]) => void;
  debugCommit: (area: DebugRenderCommitArea) => void;
}) {
  return (
    <>
      {NAIMAGE_RUNTIME_METRICS ? <DebugCommitProbe area="composer" record={debugCommit} /> : null}
      <React.Suspense fallback={<div className="project-agent-composer" aria-busy="true" />}>
        <LazyProjectAgentComposerContent
          selectedArtifacts={selectedArtifacts}
          sourceImageCount={sourceImages.length}
          referenceImageCount={referenceImages.length}
          selectionReferenceCount={selectionReferenceCount}
          prompt={prompt}
          executionBusy={executionBusy}
          paused={paused}
          stopPending={stopPending}
          goalActive={goalActive}
          goalContainerCount={goalContainerCount}
          goalAssetCount={goalAssetCount}
          inputRef={inputRef}
          setPrompt={setPrompt}
          sendPrompt={sendPrompt}
          pauseAgentRun={pauseAgentRun}
          resumeAgentRun={resumeAgentRun}
          stopAgentRun={stopAgentRun}
          clearSelection={clearSelection}
          editSourceImages={editSourceImages}
          editReferenceImages={editReferenceImages}
          regenerateImage={regenerateImage}
          imageModels={imageModels}
          selectedImageModels={selectedImageModels}
          onSelectedImageModelsChange={onSelectedImageModelsChange}
          requestImageModels={requestImageModels}
          imageRatio={imageRatio}
          imageResolution={imageResolution}
          onImageFrameChange={onImageFrameChange}
        />
      </React.Suspense>
    </>
  );
}

function ProjectAgentPanelView({
  projectName,
  messages,
  conversations,
  activeConversationId,
  selectedArtifacts,
  sourceImages,
  referenceImages,
  selectionReferenceCount = 0,
  prompt,
  agentStatus,
  executionBusy,
  paused,
  stopPending,
  goalActive,
  goalContainerCount,
  goalAssetCount,
  conversationBoundaryBusy,
  agentProgress,
  runElapsedSeconds,
  modelName,
  inputRef,
  endRef,
  setPrompt,
  sendPrompt,
  pauseAgentRun,
  resumeAgentRun,
  stopAgentRun,
  clearSelection,
 editSourceImages,
 editReferenceImages,
  regenerateImage,
  imageModels,
  selectedImageModels,
  onSelectedImageModelsChange,
  requestImageModels,
  imageRatio,
  imageResolution,
  onImageFrameChange,
  dropReferenceFiles,
 requestNewConversation,
 requestClearConversation,
  editFastMemory,
  switchConversation,
  openAgentWindow,
  collapsed,
  toggleCollapsed,
  panelLayout,
  commitPanelLayout,
  debugCommit
}: {
  projectName: string;
  messages: AgentMessage[];
  conversations: AgentConversation[];
  activeConversationId: string;
  selectedArtifacts: ProjectAgentArtifact[];
  sourceImages: ReferenceImage[];
  referenceImages: ReferenceImage[];
  selectionReferenceCount?: number;
  prompt: string;
  agentStatus: AgentStatus;
  executionBusy: boolean;
  paused: boolean;
  stopPending: boolean;
  goalActive: boolean;
  goalContainerCount: number;
  goalAssetCount: number;
  conversationBoundaryBusy: boolean;
  agentProgress: AgentProgress[];
  runElapsedSeconds: number;
  modelName: string;
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  endRef: React.MutableRefObject<HTMLDivElement | null>;
  setPrompt: (value: string) => void;
  sendPrompt: (prompt?: string, taskScopeMode?: AgentSteerTaskScopeMode | "auto", taskMode?: AgentComposerTaskMode) => void | Promise<unknown>;
  pauseAgentRun: () => void;
  resumeAgentRun: () => void;
  stopAgentRun: () => void;
  clearSelection: () => void;
 editSourceImages: () => void;
 editReferenceImages: () => void;
  regenerateImage?: () => void;
  imageModels: string[];
  selectedImageModels: string[];
  onSelectedImageModelsChange: (models: string[]) => void;
  requestImageModels: () => void | Promise<void>;
  imageRatio: AppSettings["imageRatio"];
  imageResolution: AppSettings["imageResolution"];
  onImageFrameChange: (ratio: AppSettings["imageRatio"], resolution: AppSettings["imageResolution"]) => void;
  dropReferenceFiles: (files: File[]) => void | Promise<unknown>;
 requestNewConversation: () => void;
  requestClearConversation: () => void;
  editFastMemory: () => void;
  switchConversation: (conversationId: string) => void;
  openAgentWindow: () => void | Promise<void>;
  collapsed: boolean;
  toggleCollapsed: () => void;
  panelLayout: AgentPanelLayout;
  commitPanelLayout: (layout: AgentPanelLayout) => void;
  debugCommit: (area: DebugRenderCommitArea) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [referenceDropActive, setReferenceDropActive] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const restoreHistoryToggleFocusRef = useRef(false);
  const panelDragRef = useRef<{
    pointerId: number;
    mode: AgentPanelPointerMode;
    startClientX: number;
    startClientY: number;
    start: AgentPanelLayout;
    preview: AgentPanelLayout;
    bounds: DOMRect;
    workspace: HTMLElement;
    frame: number;
  } | null>(null);
  const panelLayoutRef = useRef(panelLayout);
  if (!panelDragRef.current) panelLayoutRef.current = panelLayout;
  const conversationBusy = conversationBoundaryBusy;
  const agentActivityBusy = conversationBoundaryBusy;
  const visibleMessages = useMemo(() => messages.filter((message) => !message.hidden), [messages]);
  const latestProgress = agentProgress[agentProgress.length - 1];
  const latestRunningMessage = [...visibleMessages].reverse().find((message) => message.status === "running");
  const progressPhase = String(latestProgress?.phase || "");
  const progressActive = [
    "runtime-request",
    "runtime-start",
    "model-request",
    "model-thinking-delta",
    "assistant-message-delta",
    "steer-queued",
    "steer-applied",
    "tool-start",
    "tool-poll",
    "image-request",
    "image-retry",
    "memory-start"
  ].includes(progressPhase);
  const activityActive = stopPending || (!paused && (agentActivityBusy || progressActive));
  const currentTitle = useMemo(() => {
    const userMessage = visibleMessages.find((message) => message.role === "user" && message.content.trim());
    return userMessage?.content.replace(/\s+/g, " ").trim().slice(0, 28) || "当前会话";
  }, [visibleMessages]);
  const historyItems = useMemo(() => {
    const current = {
      id: activeConversationId,
      title: conversations.find((conversation) => conversation.id === activeConversationId)?.title || currentTitle,
      updatedAt: conversations.find((conversation) => conversation.id === activeConversationId)?.updatedAt || ""
    };
    return [current, ...conversations.filter((conversation) => conversation.id !== activeConversationId)]
      .filter((conversation, index, items) => items.findIndex((item) => item.id === conversation.id) === index)
      .slice(0, 24);
  }, [activeConversationId, conversations, currentTitle]);
  const statusBase = stopPending
    ? "Agent 正在确认结束"
    : paused
    ? "Agent 已暂停"
    : agentStatus === "error" || /error|失败/i.test(progressPhase)
    ? "Agent 遇到问题"
    : latestRunningMessage?.meta === "assistant-stream"
      ? "Agent 正在输出"
      : latestRunningMessage?.meta === "thinking" || progressPhase === "model-request" || progressPhase === "model-thinking-delta"
        ? "Agent 正在思考"
        : progressActive || agentActivityBusy
          ? "Agent 正在工作"
          : agentProgress.length > 0
            ? "Agent 思考完成"
            : "等待指令";
  const statusText = !stopPending && activityActive && runElapsedSeconds ? `${statusBase} ${runElapsedSeconds}s` : statusBase;

  function beginPanelPointer(
    event: React.PointerEvent<HTMLElement>,
    mode: AgentPanelPointerMode
  ) {
    if (mode === "move" && panelLayout.agentPanelPlacement !== "floating") return;
    if (mode === "move" && (event.target as HTMLElement).closest("button, input, select, textarea, .project-agent-history, .agent-placement-menu")) return;
    const workspace = event.currentTarget.closest<HTMLElement>(".ide-main");
    if (!workspace) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { ...panelLayoutRef.current };
    workspace.classList.add("agent-panel-interacting");
    panelDragRef.current = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start,
      preview: start,
      bounds: workspace.getBoundingClientRect(),
      workspace,
      frame: 0
    };
  }

  function movePanelPointer(event: React.PointerEvent<HTMLElement>) {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    const next = agentPanelLayoutFromPointer(drag.start, drag.mode, dx, dy, drag.bounds);
    drag.preview = next;
    panelLayoutRef.current = next;
    if (drag.frame) return;
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = 0;
      if (panelDragRef.current !== drag) return;
      applyAgentPanelLayoutPreview(drag.workspace, drag.preview);
    });
  }

  function endPanelPointer(event: React.PointerEvent<HTMLElement>) {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (drag.frame) window.cancelAnimationFrame(drag.frame);
    const finalLayout = clampAgentPanelLayout(drag.preview, drag.bounds);
    applyAgentPanelLayoutPreview(drag.workspace, finalLayout);
    panelLayoutRef.current = finalLayout;
    panelDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commitPanelLayout(finalLayout);
    window.requestAnimationFrame(() => clearAgentPanelLayoutPreview(drag.workspace));
  }

  function setPanelPlacement(placement: AgentPanelLayout["agentPanelPlacement"]) {
    const workspace = document.querySelector<HTMLElement>(".ide-main");
    const bounds = workspace?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const next = agentPanelLayoutForPlacement(panelLayoutRef.current, placement, bounds);
    setPlacementOpen(false);
    commitPanelLayout(next);
  }

  useEffect(() => {
    return () => {
      const drag = panelDragRef.current;
      if (!drag) return;
      if (drag.frame) window.cancelAnimationFrame(drag.frame);
      clearAgentPanelLayoutPreview(drag.workspace);
      panelDragRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (collapsed) {
      setHistoryOpen(false);
      setPlacementOpen(false);
    }
  }, [collapsed]);

  useLayoutEffect(() => {
    if (!historyOpen) return;
    const closeHistory = (restoreFocus = false) => {
      restoreHistoryToggleFocusRef.current = restoreFocus;
      setHistoryOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const toggle = document.getElementById(PROJECT_AGENT_HISTORY_TOGGLE_ID);
      if (target && (historyRef.current?.contains(target) || toggle?.contains(target))) return;
      closeHistory();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeHistory(true);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [historyOpen]);

  useLayoutEffect(() => {
    if (historyOpen || !restoreHistoryToggleFocusRef.current) return;
    restoreHistoryToggleFocusRef.current = false;
    document.getElementById(PROJECT_AGENT_HISTORY_TOGGLE_ID)?.focus();
  }, [historyOpen]);

  useEffect(() => {
    if (!placementOpen) return;
    const closePlacement = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".agent-placement-menu") || target?.closest(`#${PROJECT_AGENT_PLACEMENT_TOGGLE_ID}`)) return;
      setPlacementOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPlacementOpen(false);
      window.requestAnimationFrame(() => document.getElementById(PROJECT_AGENT_PLACEMENT_TOGGLE_ID)?.focus());
    };
    document.addEventListener("pointerdown", closePlacement, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePlacement, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [placementOpen]);

  if (collapsed) {
    return (
      <aside className={`project-agent-panel is-collapsed placement-${panelLayout.agentPanelPlacement}`} aria-label="已折叠的项目 Agent 对话栏">
        <ButtonBase className="project-agent-collapsed-rail agent-collapse-button" type="button" onClick={toggleCollapsed} aria-label="展开项目 Agent" title="展开项目 Agent">
          {panelLayout.agentPanelPlacement === "left"
            ? <PanelLeftOpen size={17} />
            : panelLayout.agentPanelPlacement === "top"
              ? <PanelTop size={17} />
              : panelLayout.agentPanelPlacement === "bottom"
                ? <PanelBottom size={17} />
                : <PanelRightOpen size={17} />}
          <span className={activityActive ? "busy" : ""}>{activityActive ? <Loader2 size={14} className="spin" /> : <Brain size={14} />}</span>
          <strong>Agent</strong>
          {selectedArtifacts.length > 0 ? <i aria-label="已选择成果" /> : null}
        </ButtonBase>
      </aside>
    );
  }

 return (
    <aside
      className={`project-agent-panel placement-${panelLayout.agentPanelPlacement} ${referenceDropActive ? "reference-drop-active" : ""}`}
      aria-label="项目 Agent 对话栏"
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file")) return;
        event.preventDefault();
        setReferenceDropActive(true);
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setReferenceDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setReferenceDropActive(false);
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        setReferenceDropActive(false);
        void dropReferenceFiles(files);
      }}
    >
      <header
        className={`project-agent-header ${panelLayout.agentPanelPlacement === "floating" ? "is-drag-handle" : ""}`}
        onPointerDown={(event) => beginPanelPointer(event, "move")}
        onPointerMove={movePanelPointer}
        onPointerUp={endPanelPointer}
        onPointerCancel={endPanelPointer}
      >
        <div>
          <h2>Agent</h2>
          <p title={projectName}>{projectName}</p>
        </div>
        <div className="project-agent-header-actions">
          <IconActionButton
            id={PROJECT_AGENT_PLACEMENT_TOGGLE_ID}
            className={placementOpen ? "active" : ""}
            label="调整对话框位置"
            aria-expanded={placementOpen}
            onClick={() => setPlacementOpen((current) => !current)}
            icon={<Move size={16} />}
          />
          <IconActionButton
            className="agent-collapse-button"
            label="折叠项目 Agent"
            onClick={toggleCollapsed}
            icon={panelLayout.agentPanelPlacement === "left"
              ? <PanelLeftClose size={16} />
              : panelLayout.agentPanelPlacement === "top"
                ? <PanelTop size={16} />
                : panelLayout.agentPanelPlacement === "bottom"
                  ? <PanelBottom size={16} />
                  : <PanelRightClose size={16} />}
          />
          <IconActionButton
            id={PROJECT_AGENT_HISTORY_TOGGLE_ID}
            className={historyOpen ? "active" : ""}
            onClick={() => setHistoryOpen((current) => !current)}
            label="会话历史"
            aria-expanded={historyOpen}
            aria-controls={PROJECT_AGENT_HISTORY_ID}
            icon={<ChevronDown size={16} />}
          />
          <IconActionButton label="编辑 Agent 记忆" title="编辑当前会话的 Agent 记忆" onClick={editFastMemory} icon={<Brain size={16} />} />
          <IconActionButton label="清理聊天" title="清理当前聊天和绘画经验" onClick={requestClearConversation} disabled={conversationBusy} icon={<Trash2 size={16} />} />
          <IconActionButton label={executionBusy ? "在新窗口新建并行会话" : "新建会话"} onClick={requestNewConversation} icon={<Plus size={16} />} />
        </div>
        {placementOpen ? (
          <div className="agent-placement-menu" role="menu" aria-label="对话框位置">
            <ButtonBase className={panelLayout.agentPanelPlacement === "right" ? "active" : ""} type="button" role="menuitem" onClick={() => setPanelPlacement("right")}>
              <PanelRight size={15} />
              <span>停靠右侧</span>
            </ButtonBase>
            <ButtonBase className={panelLayout.agentPanelPlacement === "left" ? "active" : ""} type="button" role="menuitem" onClick={() => setPanelPlacement("left")}>
              <PanelLeft size={15} />
              <span>停靠左侧</span>
            </ButtonBase>
            <ButtonBase className={panelLayout.agentPanelPlacement === "top" ? "active" : ""} type="button" role="menuitem" onClick={() => setPanelPlacement("top")}>
              <PanelTop size={15} />
              <span>停靠上方</span>
            </ButtonBase>
            <ButtonBase className={panelLayout.agentPanelPlacement === "bottom" ? "active" : ""} type="button" role="menuitem" onClick={() => setPanelPlacement("bottom")}>
              <PanelBottom size={15} />
              <span>停靠下方</span>
            </ButtonBase>
            <ButtonBase className={panelLayout.agentPanelPlacement === "floating" ? "active" : ""} type="button" role="menuitem" onClick={() => setPanelPlacement("floating")}>
              <PanelsTopLeft size={15} />
              <span>应用内浮动</span>
            </ButtonBase>
            <ButtonBase type="button" role="menuitem" onClick={() => {
              setPlacementOpen(false);
              void openAgentWindow();
            }}>
              <PanelRightOpen size={15} />
              <span>独立浮动窗口</span>
            </ButtonBase>
          </div>
        ) : null}
        {historyOpen ? (
          <div ref={historyRef} id={PROJECT_AGENT_HISTORY_ID} className="project-agent-history" aria-label="Agent 会话历史">
            <strong>会话历史</strong>
            <div>
              {historyItems.map((conversation) => (
                <ButtonBase
                  key={conversation.id}
                  className={conversation.id === activeConversationId ? "active" : ""}
                  type="button"
                  onClick={() => {
                    switchConversation(conversation.id);
                    setHistoryOpen(false);
                  }}
                  disabled={conversationBusy}
                >
                  <span>{conversation.title || "未命名会话"}</span>
                  <small>{conversation.id === activeConversationId ? "当前" : "历史"}</small>
                </ButtonBase>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <div className="project-agent-status">
        <span className={activityActive ? "busy" : ""}>
          {activityActive ? <Loader2 size={13} className="spin" /> : <Brain size={13} />}
          {statusText}
        </span>
        <em>{modelName || "未配置模型"}</em>
      </div>

      <ProjectAgentFeed
        key={activeConversationId}
        messages={visibleMessages}
        agentProgressCount={agentProgress.length}
        endRef={endRef}
        debugCommit={debugCommit}
      />

      <ProjectAgentComposer
        selectedArtifacts={selectedArtifacts}
        sourceImages={sourceImages}
        referenceImages={referenceImages}
        selectionReferenceCount={selectionReferenceCount}
        prompt={prompt}
        executionBusy={executionBusy}
        paused={paused}
        stopPending={stopPending}
        goalActive={goalActive}
        goalContainerCount={goalContainerCount}
        goalAssetCount={goalAssetCount}
        inputRef={inputRef}
        setPrompt={setPrompt}
        sendPrompt={sendPrompt}
        pauseAgentRun={pauseAgentRun}
        resumeAgentRun={resumeAgentRun}
        stopAgentRun={stopAgentRun}
        clearSelection={clearSelection}
        editSourceImages={editSourceImages}
        editReferenceImages={editReferenceImages}
        regenerateImage={regenerateImage}
        imageModels={imageModels}
        selectedImageModels={selectedImageModels}
        onSelectedImageModelsChange={onSelectedImageModelsChange}
        requestImageModels={requestImageModels}
        imageRatio={imageRatio}
        imageResolution={imageResolution}
        onImageFrameChange={onImageFrameChange}
        debugCommit={debugCommit}
      />
      {panelLayout.agentPanelPlacement === "floating" ? (
        <>
          <span
            className="agent-panel-resize-handle resize-width"
            aria-label="调整对话框宽度"
            role="separator"
            onPointerDown={(event) => beginPanelPointer(event, "resize-width")}
            onPointerMove={movePanelPointer}
            onPointerUp={endPanelPointer}
            onPointerCancel={endPanelPointer}
          />
          <span
            className="agent-panel-resize-handle resize-height"
            aria-label="调整对话框高度"
            role="separator"
            onPointerDown={(event) => beginPanelPointer(event, "resize-height")}
            onPointerMove={movePanelPointer}
            onPointerUp={endPanelPointer}
            onPointerCancel={endPanelPointer}
          />
          <span
            className="agent-panel-resize-handle resize-corner"
            aria-label="调整对话框大小"
            role="separator"
            onPointerDown={(event) => beginPanelPointer(event, "resize-corner")}
            onPointerMove={movePanelPointer}
            onPointerUp={endPanelPointer}
            onPointerCancel={endPanelPointer}
          />
        </>
      ) : (
        <span
          className={`agent-panel-resize-handle resize-dock resize-${panelLayout.agentPanelPlacement}`}
          aria-label={panelLayout.agentPanelPlacement === "top" || panelLayout.agentPanelPlacement === "bottom" ? "调整对话框高度" : "调整对话框宽度"}
          role="separator"
          onPointerDown={(event) => beginPanelPointer(event, "resize-dock")}
          onPointerMove={movePanelPointer}
          onPointerUp={endPanelPointer}
          onPointerCancel={endPanelPointer}
        />
      )}
    </aside>
  );
}

function sameProjectAgentSelection(left: ProjectAgentArtifact[], right: ProjectAgentArtifact[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((node, index) => {
    const other = right[index];
    return Boolean(other && node.id === other.id && node.name === other.name);
  });
}

const ProjectAgentComposer = React.memo(ProjectAgentComposerView, (left, right) =>
  sameProjectAgentSelection(left.selectedArtifacts, right.selectedArtifacts) &&
  left.sourceImages === right.sourceImages &&
  left.referenceImages === right.referenceImages &&
  left.selectionReferenceCount === right.selectionReferenceCount &&
  left.prompt === right.prompt &&
  left.executionBusy === right.executionBusy &&
  left.paused === right.paused &&
  left.stopPending === right.stopPending &&
  left.goalActive === right.goalActive &&
  left.goalContainerCount === right.goalContainerCount &&
  left.goalAssetCount === right.goalAssetCount &&
  left.inputRef === right.inputRef &&
  left.setPrompt === right.setPrompt &&
  left.sendPrompt === right.sendPrompt &&
  left.pauseAgentRun === right.pauseAgentRun &&
  left.resumeAgentRun === right.resumeAgentRun &&
  left.stopAgentRun === right.stopAgentRun &&
  left.clearSelection === right.clearSelection &&
  left.editSourceImages === right.editSourceImages &&
  left.editReferenceImages === right.editReferenceImages &&
  left.regenerateImage === right.regenerateImage &&
  left.imageModels === right.imageModels &&
  left.selectedImageModels === right.selectedImageModels &&
  left.onSelectedImageModelsChange === right.onSelectedImageModelsChange &&
  left.requestImageModels === right.requestImageModels &&
  left.imageRatio === right.imageRatio &&
  left.imageResolution === right.imageResolution &&
  left.onImageFrameChange === right.onImageFrameChange &&
  left.debugCommit === right.debugCommit
);

const ProjectAgentPanel = React.memo(ProjectAgentPanelView, (left, right) =>
  left.projectName === right.projectName &&
  left.messages === right.messages &&
  left.conversations === right.conversations &&
  left.activeConversationId === right.activeConversationId &&
  sameProjectAgentSelection(left.selectedArtifacts, right.selectedArtifacts) &&
  left.sourceImages === right.sourceImages &&
  left.referenceImages === right.referenceImages &&
  left.selectionReferenceCount === right.selectionReferenceCount &&
  left.prompt === right.prompt &&
  left.agentStatus === right.agentStatus &&
  left.executionBusy === right.executionBusy &&
  left.paused === right.paused &&
  left.stopPending === right.stopPending &&
  left.goalActive === right.goalActive &&
  left.goalContainerCount === right.goalContainerCount &&
  left.goalAssetCount === right.goalAssetCount &&
  left.conversationBoundaryBusy === right.conversationBoundaryBusy &&
  left.agentProgress === right.agentProgress &&
  left.runElapsedSeconds === right.runElapsedSeconds &&
  left.modelName === right.modelName &&
  left.inputRef === right.inputRef &&
  left.endRef === right.endRef &&
  left.setPrompt === right.setPrompt &&
  left.sendPrompt === right.sendPrompt &&
  left.pauseAgentRun === right.pauseAgentRun &&
  left.resumeAgentRun === right.resumeAgentRun &&
  left.stopAgentRun === right.stopAgentRun &&
  left.clearSelection === right.clearSelection &&
  left.editSourceImages === right.editSourceImages &&
  left.editReferenceImages === right.editReferenceImages &&
  left.regenerateImage === right.regenerateImage &&
  left.imageModels === right.imageModels &&
  left.selectedImageModels === right.selectedImageModels &&
  left.onSelectedImageModelsChange === right.onSelectedImageModelsChange &&
  left.requestImageModels === right.requestImageModels &&
  left.imageRatio === right.imageRatio &&
  left.imageResolution === right.imageResolution &&
  left.onImageFrameChange === right.onImageFrameChange &&
  left.dropReferenceFiles === right.dropReferenceFiles &&
  left.requestNewConversation === right.requestNewConversation &&
  left.requestClearConversation === right.requestClearConversation &&
  left.editFastMemory === right.editFastMemory &&
  left.switchConversation === right.switchConversation &&
  left.openAgentWindow === right.openAgentWindow &&
  left.collapsed === right.collapsed &&
  left.toggleCollapsed === right.toggleCollapsed &&
  left.panelLayout === right.panelLayout &&
  left.commitPanelLayout === right.commitPanelLayout &&
  left.debugCommit === right.debugCommit
);
export default ProjectAgentPanel;
