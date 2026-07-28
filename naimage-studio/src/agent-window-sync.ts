import type {
  AgentConversation,
  AgentMessage,
  AgentProgress,
  AgentStatus,
  AppSettings
} from "./core";

const maximumPromptChars = 200_000;
const maximumMessageChars = 16_000;
const maximumToolPromptChars = 12_000;

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

export type AgentWindowSnapshot = {
  version: 1;
  ready: boolean;
  projectName: string;
  modelName: string;
  statusText: string;
  busy: boolean;
  prompt: string;
  messages: AgentWindowMessage[];
  conversations: { id: string; title: string; updatedAt: string; active: boolean }[];
  activeConversationId: string;
  selectedArtifactCount: number;
  sourceImageCount: number;
  referenceImageCount: number;
  theme: AppSettings["theme"];
  themePalette: AppSettings["themePalette"];
  updatedAt: number;
};

export type AgentWindowCommand =
  | { type: "request-state" | "closed" | "stop" | "new-conversation-confirmed" | "clear-conversation-confirmed" | "edit-sources" | "edit-references" | "edit-memory" }
  | { type: "set-prompt" | "send"; prompt: string }
  | { type: "switch-conversation"; conversationId: string }
  | { type: "dock"; placement: "right" | "left" | "top" | "bottom" | "floating" };

export type AgentWindowSnapshotInput = {
  ready: boolean;
  projectName: string;
  modelName: string;
  agentStatus: AgentStatus;
  busy: boolean;
  runElapsedSeconds: number;
  prompt: string;
  messages: AgentMessage[];
  conversations: AgentConversation[];
  activeConversationId: string;
  selectedArtifactCount: number;
  sourceImageCount: number;
  referenceImageCount: number;
  agentProgress: AgentProgress[];
  theme: AppSettings["theme"];
  themePalette: AppSettings["themePalette"];
};

function boundedText(value: unknown, maximumChars: number) {
  const text = String(value ?? "");
  if (text.length <= maximumChars) return text;
  return `${text.slice(0, maximumChars)}\n…内容已在独立窗口截断，请回到主窗口查看完整记录。`;
}

function boundedCount(value: unknown, maximum = 999) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
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
  runElapsedSeconds
}: Pick<AgentWindowSnapshotInput, "messages" | "agentProgress" | "agentStatus" | "busy" | "runElapsedSeconds">) {
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
    "tool-start",
    "tool-poll",
    "image-request",
    "image-retry",
    "memory-start"
  ].includes(progressPhase);
  const base = agentStatus === "error" || /error|失败/i.test(progressPhase)
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
  return (busy || progressActive) && runElapsedSeconds > 0 ? `${base} ${Math.floor(runElapsedSeconds)}s` : base;
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
  return {
    version: 1,
    ready: Boolean(input.ready),
    projectName: boundedText(input.projectName || "项目", 256),
    modelName: boundedText(input.modelName, 256),
    statusText: agentWindowStatusText(input),
    busy: Boolean(input.busy),
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
    theme: input.theme,
    themePalette: input.themePalette,
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
    "stop",
    "new-conversation-confirmed",
    "clear-conversation-confirmed",
    "edit-sources",
    "edit-references",
    "edit-memory"
  ].includes(type)) return { type } as AgentWindowCommand;
  if (type === "set-prompt" || type === "send") {
    return { type, prompt: boundedText(payload.prompt, maximumPromptChars) };
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
