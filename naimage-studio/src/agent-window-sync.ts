import type {
  AgentConversation,
  AgentMessage,
  AgentProgress,
  AgentSteerTaskScopeMode,
  AgentStatus,
  AppSettings
} from "./core";
import {
  glassAppearanceProjection,
  type GlassAccentId,
  type GlassThemeMode,
  type GlassThemeSettings
} from "./glass-theme.ts";

const maximumPromptChars = 200_000;
const maximumMessageChars = 16_000;
const maximumToolPromptChars = 12_000;
const taskScopeSnapshotHashPattern = /^scope-[a-f0-9]{32}$/;
const goalConfirmationHashPattern = /^goal-[a-f0-9]{32}$/;

export type AgentWindowGoalState = {
  available: boolean;
  active: boolean;
  snapshotHash: string;
  containerCount: number;
  assetCount: number;
  operationsPerAsset: number;
  requestCount: number;
  skippedContainerCount: number;
  probeContainerCount: number;
  concurrencyCap: number;
  trialImagesUsed: number;
  paidImages: number;
  estimatedMaxCostCents?: number;
  warning: string;
};

export type AgentWindowMessage = {
  id: string;
  role: AgentMessage["role"];
  content: string;
  createdAt: string;
  status: AgentMessage["status"];
  meta?: string;
  sourceCount: number;
  referenceCount: number;
  toolTrace?: {
    stage?: "start" | "result";
    label: string;
    operation: string;
    params: string;
    brief: string;
    prompts: { title: string; prompt: string }[];
    completionText?: string;
  };
};

export type AgentWindowGlassAppearance = GlassThemeSettings & {
  mode: GlassThemeMode;
  resolvedAccent: Exclude<GlassAccentId, "theme">;
  variables: Record<string, string>;
};

export type AgentWindowSnapshot = {
  version: 1;
  ready: boolean;
  projectName: string;
  modelName: string;
  statusText: string;
  busy: boolean;
  paused: boolean;
  stopPending: boolean;
  prompt: string;
  messages: AgentWindowMessage[];
  conversations: { id: string; title: string; updatedAt: string; active: boolean }[];
  activeConversationId: string;
  selectedArtifactCount: number;
  sourceImageCount: number;
  referenceImageCount: number;
  goal: AgentWindowGoalState;
  theme: AppSettings["theme"];
  themePalette: AppSettings["themePalette"];
  customTheme: AppSettings["customTheme"];
  glassAppearance: AgentWindowGlassAppearance;
  updatedAt: number;
};

export type AgentWindowCommand =
  | { type: "request-state" | "closed" | "pause-confirmed" | "resume" | "stop-confirmed" | "new-conversation-confirmed" | "clear-conversation-confirmed" | "edit-sources" | "edit-references" | "edit-memory" }
  | { type: "set-prompt"; prompt: string }
  | { type: "send"; prompt: string; taskScopeMode: AgentSteerTaskScopeMode | "auto"; taskMode: "standard" }
  | { type: "send"; prompt: string; taskScopeMode: "auto"; taskMode: "goal"; goalConfirmed: true; expectedSnapshotHash: string }
  | { type: "switch-conversation"; conversationId: string }
  | { type: "dock"; placement: "right" | "left" | "top" | "bottom" | "floating" };

export type AgentWindowSnapshotInput = {
  ready: boolean;
  projectName: string;
  modelName: string;
  agentStatus: AgentStatus;
  busy: boolean;
  paused: boolean;
  stopPending: boolean;
  runElapsedSeconds: number;
  prompt: string;
  messages: AgentMessage[];
  conversations: AgentConversation[];
  activeConversationId: string;
  selectedArtifactCount: number;
  sourceImageCount: number;
  referenceImageCount: number;
  goal: AgentWindowGoalState;
  agentProgress: AgentProgress[];
  theme: AppSettings["theme"];
  themePalette: AppSettings["themePalette"];
  customTheme: AppSettings["customTheme"];
  glassTheme?: AppSettings["glassTheme"];
  glassMaterial?: AppSettings["glassMaterial"];
  glassParameters?: AppSettings["glassParameters"];
};

function boundedText(value: unknown, maximumChars: number) {
  const text = String(value ?? "");
  if (text.length <= maximumChars) return text;
  return `${text.slice(0, maximumChars)}\n…内容已在独立窗口截断，请回到主窗口查看完整记录。`;
}

function boundedCount(value: unknown, maximum = 999) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function boundedCost(value: unknown) {
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(cost))
    : undefined;
}

function agentWindowGoalState(value: AgentWindowGoalState): AgentWindowGoalState {
  const snapshotHash = boundedText(value?.snapshotHash, 80).trim().toLowerCase();
  const active = Boolean(value?.active);
  const hashIsValid = active
    ? taskScopeSnapshotHashPattern.test(snapshotHash)
    : goalConfirmationHashPattern.test(snapshotHash);
  const containerCount = boundedCount(value?.containerCount, 200);
  const assetCount = boundedCount(value?.assetCount, 200);
  const operationsPerAsset = boundedCount(value?.operationsPerAsset, 200);
  const requestCount = boundedCount(value?.requestCount, 200);
  const probeContainerCount = boundedCount(value?.probeContainerCount, 2);
  const concurrencyCap = boundedCount(value?.concurrencyCap, 10);
  const estimatedMaxCostCents = boundedCost(value?.estimatedMaxCostCents);
  const available = Boolean(
    value?.available &&
    containerCount > 0 &&
    assetCount > 0 &&
    operationsPerAsset > 0 &&
    requestCount === assetCount * operationsPerAsset &&
    probeContainerCount > 0 &&
    concurrencyCap >= probeContainerCount &&
    hashIsValid
  );
  return {
    available,
    active: Boolean(active && taskScopeSnapshotHashPattern.test(snapshotHash)),
    snapshotHash: hashIsValid ? snapshotHash : "",
    containerCount,
    assetCount,
    operationsPerAsset,
    requestCount,
    skippedContainerCount: boundedCount(value?.skippedContainerCount, 200),
    probeContainerCount,
    concurrencyCap,
    trialImagesUsed: boundedCount(value?.trialImagesUsed, 200),
    paidImages: boundedCount(value?.paidImages, 200),
    ...(estimatedMaxCostCents !== undefined
      ? { estimatedMaxCostCents }
      : {}),
    warning: boundedText(value?.warning, 1_000)
  };
}

function agentWindowMessage(message: AgentMessage): AgentWindowMessage {
  const trace = message.toolTrace;
  const sourceCount = message.attachments?.sourceAssets?.length ?? message.attachments?.sourceCount ?? 0;
  const referenceCount = message.attachments?.referenceAssets?.length ?? message.attachments?.referenceCount ?? 0;
  return {
    id: boundedText(message.id, 256),
    role: message.role,
    content: boundedText(message.content, maximumMessageChars),
    createdAt: boundedText(message.createdAt, 128),
    status: message.status,
    meta: message.meta ? boundedText(message.meta, 128) : undefined,
    sourceCount: boundedCount(sourceCount),
    referenceCount: boundedCount(referenceCount),
    toolTrace: trace ? {
      stage: trace.stage,
      label: boundedText(trace.label, 256),
      operation: boundedText(trace.operation, 256),
      params: boundedText(trace.params, 2_000),
      brief: boundedText(trace.brief, 8_000),
      prompts: (trace.prompts ?? []).slice(0, 2).map((item, index) => ({
        title: boundedText(item.title || `提示词 ${index + 1}`, 256),
        prompt: boundedText(item.prompt, maximumToolPromptChars)
      })),
      completionText: trace.completionText ? boundedText(trace.completionText, 8_000) : undefined
    } : undefined
  };
}

export function agentWindowStatusText({
  messages,
  agentProgress,
  agentStatus,
  busy,
  paused,
  stopPending,
  runElapsedSeconds
}: Pick<AgentWindowSnapshotInput, "messages" | "agentProgress" | "agentStatus" | "busy" | "paused" | "stopPending" | "runElapsedSeconds">) {
  const visibleMessages = messages.filter((message) => !message.hidden);
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
  const base = stopPending
    ? "Agent 正在确认结束"
    : paused
    ? "Agent 已暂停"
    : agentStatus === "error" || /error|失败/i.test(progressPhase)
    ? "Agent 遇到问题"
    : latestRunningMessage?.meta === "assistant-stream"
      ? "Agent 正在输出"
      : latestRunningMessage?.meta === "thinking" || progressPhase === "model-request" || progressPhase === "model-thinking-delta"
        ? "Agent 正在思考"
        : progressActive || busy
          ? "Agent 正在工作"
          : agentProgress.length > 0
            ? "Agent 思考完成"
            : "等待指令";
  return !paused && !stopPending && (busy || progressActive) && runElapsedSeconds > 0 ? `${base} ${Math.floor(runElapsedSeconds)}s` : base;
}

export function buildAgentWindowSnapshot(input: AgentWindowSnapshotInput): AgentWindowSnapshot {
  const messages = input.messages
    .filter((message) => !message.hidden)
    .slice(-40)
    .map(agentWindowMessage);
  const conversations = [
    {
      id: input.activeConversationId,
      title: input.conversations.find((item) => item.id === input.activeConversationId)?.title || "当前会话",
      updatedAt: input.conversations.find((item) => item.id === input.activeConversationId)?.updatedAt || ""
    },
    ...input.conversations.filter((item) => item.id !== input.activeConversationId)
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 24);
  const appearance = glassAppearanceProjection({
    glassTheme: input.glassTheme ?? (input.theme === "dark" ? "dark-rose" : undefined),
    glassMaterial: input.glassMaterial,
    glassParameters: input.glassParameters
  });
  return {
    version: 1,
    ready: Boolean(input.ready),
    projectName: boundedText(input.projectName || "项目", 256),
    modelName: boundedText(input.modelName, 256),
    statusText: agentWindowStatusText(input),
    busy: Boolean(input.busy),
    paused: Boolean(input.paused),
    stopPending: Boolean(input.stopPending),
    prompt: boundedText(input.prompt, maximumPromptChars),
    messages,
    conversations: conversations.map((item) => ({
      id: boundedText(item.id, 256),
      title: boundedText(item.title || "未命名会话", 512),
      updatedAt: boundedText(item.updatedAt, 128),
      active: item.id === input.activeConversationId
    })),
    activeConversationId: boundedText(input.activeConversationId, 256),
    selectedArtifactCount: boundedCount(input.selectedArtifactCount),
    sourceImageCount: boundedCount(input.sourceImageCount),
    referenceImageCount: boundedCount(input.referenceImageCount),
    goal: agentWindowGoalState(input.goal),
    theme: input.theme,
    themePalette: input.themePalette,
    customTheme: input.customTheme,
    glassAppearance: {
      ...appearance.settings,
      mode: appearance.mode,
      resolvedAccent: appearance.resolvedAccent,
      variables: appearance.variables
    },
    updatedAt: Date.now()
  };
}

export function normalizeAgentWindowCommand(value: unknown): AgentWindowCommand | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const type = String(payload.type || "");
  if ([
    "request-state",
    "closed",
    "pause-confirmed",
    "resume",
    "stop-confirmed",
    "new-conversation-confirmed",
    "clear-conversation-confirmed",
    "edit-sources",
    "edit-references",
    "edit-memory"
  ].includes(type)) return { type } as AgentWindowCommand;
  if (type === "set-prompt") {
    return { type, prompt: boundedText(payload.prompt, maximumPromptChars) };
  }
  if (type === "send") {
    const allowedModes = new Set<AgentSteerTaskScopeMode | "auto">([
      "auto",
      "keep",
      "replace-source",
      "merge-source",
      "replace-reference",
      "merge-reference",
      "clear-attachments"
    ]);
    const taskScopeMode = String(payload.taskScopeMode || "auto") as AgentSteerTaskScopeMode | "auto";
    const taskMode = payload.taskMode === "goal" ? "goal" : "standard";
    if (taskMode === "goal") {
      const expectedSnapshotHash = boundedText(payload.expectedSnapshotHash, 80).trim().toLowerCase();
      if (payload.goalConfirmed !== true || !goalConfirmationHashPattern.test(expectedSnapshotHash)) return null;
      return {
        type,
        prompt: boundedText(payload.prompt, maximumPromptChars),
        taskScopeMode: "auto",
        taskMode,
        goalConfirmed: true,
        expectedSnapshotHash
      };
    }
    return {
      type,
      prompt: boundedText(payload.prompt, maximumPromptChars),
      taskScopeMode: allowedModes.has(taskScopeMode) ? taskScopeMode : "auto",
      taskMode
    };
  }
  if (type === "switch-conversation") {
    const conversationId = boundedText(payload.conversationId, 256).trim();
    return conversationId ? { type, conversationId } : null;
  }
  if (type === "dock" && ["right", "left", "top", "bottom", "floating"].includes(String(payload.placement || ""))) {
    return { type, placement: String(payload.placement) as Extract<AgentWindowCommand, { type: "dock" }>["placement"] };
  }
  return null;
}
