import type { AgentMessage, AgentRuntimeAction, MessageRole } from "../core";

type AgentFixtureSeedPayload = {
  messages?: Partial<AgentMessage>[];
  append?: boolean;
  clear?: boolean;
  maxMessages?: number;
  streamDelta?: { id: string; delta: string; status?: AgentMessage["status"] };
};

type AgentFixtureBridgeOptions = {
  applyActions: (actions: AgentRuntimeAction[]) => void;
  readMessages: () => AgentMessage[];
  stageMessages: (messages: AgentMessage[]) => void;
  publishMessages: (messages: AgentMessage[]) => void;
  nowLabel: () => string;
};

declare global {
  interface Window {
    __iiimageDebugApplyAgentActions?: (actions: AgentRuntimeAction[]) => boolean;
    __iiimageDebugSeedAgentMessages?: (payload?: AgentFixtureSeedPayload | null) => boolean;
  }
}

export function installAgentFixtureBridge({
  applyActions,
  readMessages,
  stageMessages,
  publishMessages,
  nowLabel,
}: AgentFixtureBridgeOptions) {
  let streamFlushTimer: number | null = null;
  const streamAccumulator = new Map<string, { content: string; status?: AgentMessage["status"] }>();

  const cancelStreamFlush = () => {
    if (streamFlushTimer === null) return;
    window.clearTimeout(streamFlushTimer);
    streamFlushTimer = null;
  };
  const flushStream = () => {
    streamFlushTimer = null;
    publishMessages([...readMessages()]);
  };
  const replaceMessages = (messages: AgentMessage[]) => {
    stageMessages(messages);
    publishMessages(messages);
  };

  window.__iiimageDebugApplyAgentActions = (actions: AgentRuntimeAction[]) => {
    if (!Array.isArray(actions)) return false;
    applyActions(actions);
    return true;
  };
  window.__iiimageDebugSeedAgentMessages = (payload) => {
    if (payload?.clear === true) {
      cancelStreamFlush();
      streamAccumulator.clear();
      replaceMessages([]);
      return true;
    }
    const streamDelta = payload?.streamDelta;
    if (streamDelta && typeof streamDelta.id === "string" && streamDelta.id && typeof streamDelta.delta === "string") {
      const currentMessage = readMessages().find((message) => message.id === streamDelta.id);
      if (!currentMessage) return false;
      const accumulated = streamAccumulator.get(streamDelta.id) ?? {
        content: currentMessage.content || "",
        status: currentMessage.status,
      };
      const nextAccumulated = {
        content: `${accumulated.content}${streamDelta.delta}`,
        status: streamDelta.status === "running" || streamDelta.status === "error" || streamDelta.status === "done"
          ? streamDelta.status
          : accumulated.status,
      };
      streamAccumulator.set(streamDelta.id, nextAccumulated);
      const next = readMessages().map((message) => {
        if (message.id !== streamDelta.id) return message;
        return {
          ...message,
          content: nextAccumulated.content,
          status: nextAccumulated.status,
        };
      });
      stageMessages(next);
      if (streamDelta.status === "done" || streamDelta.status === "error") {
        cancelStreamFlush();
        publishMessages([...next]);
        streamAccumulator.delete(streamDelta.id);
      } else if (streamFlushTimer === null) {
        // A 30fps diagnostic stream is close to perceived live output while
        // avoiding hundreds of React commits that would measure the probe
        // itself instead of the Agent feed.
        streamFlushTimer = window.setTimeout(flushStream, 32);
      }
      return true;
    }
    const sourceMessages = Array.isArray(payload?.messages) ? payload.messages : [];
    if (sourceMessages.length === 0) return false;
    cancelStreamFlush();
    streamAccumulator.clear();
    const requestedLimit = Number.isFinite(Number(payload?.maxMessages))
      ? Math.min(1000, Math.max(1, Math.round(Number(payload?.maxMessages))))
      : 12;
    const seededMessages: AgentMessage[] = sourceMessages.slice(0, requestedLimit).map((message, index) => {
      const role: MessageRole = message.role === "assistant" || message.role === "system" || message.role === "user" ? message.role : "assistant";
      const pasteBlocks = Array.isArray(message.pasteBlocks)
        ? message.pasteBlocks
            .filter((block) => block && typeof block.text === "string")
            .map((block, blockIndex) => ({
              id: typeof block.id === "string" && block.id ? block.id : `debug-paste-${index}-${blockIndex}`,
              text: String(block.text),
              createdAt: typeof block.createdAt === "string" ? block.createdAt : nowLabel(),
            }))
            .slice(0, 4)
        : undefined;
      const trace = message.toolTrace;
      return {
        id: typeof message.id === "string" && message.id ? message.id : `debug-message-${index}-${Date.now()}`,
        role,
        content: typeof message.content === "string" ? message.content : "",
        createdAt: typeof message.createdAt === "string" ? message.createdAt : nowLabel(),
        status: message.status === "running" || message.status === "error" ? message.status : "done",
        meta: typeof message.meta === "string" ? message.meta : "aidebug fixture",
        hidden: message.hidden === true,
        collapsed: message.collapsed === true,
        pasteBlocks,
        toolTrace: trace
          ? {
              stage: trace.stage === "result" ? "result" : "start",
              label: String(trace.label || "工具"),
              name: String(trace.name || "debug_tool"),
              operation: String(trace.operation || "测试操作"),
              params: String(trace.params || ""),
              brief: String(trace.brief || ""),
              prompts: Array.isArray(trace.prompts)
                ? trace.prompts
                    .filter((item) => item && typeof item.prompt === "string")
                    .map((item) => ({ title: typeof item.title === "string" ? item.title : "", prompt: String(item.prompt) }))
                    .slice(0, 10)
                : undefined,
              completionText: typeof trace.completionText === "string" ? trace.completionText : undefined,
            }
          : undefined,
      };
    });
    const retainedLimit = Math.max(120, requestedLimit);
    const next = payload?.append === true ? [...readMessages(), ...seededMessages].slice(-retainedLimit) : seededMessages;
    for (const message of next) {
      if (message.status === "running") {
        streamAccumulator.set(message.id, { content: message.content || "", status: message.status });
      }
    }
    replaceMessages(next);
    return true;
  };

  return () => {
    cancelStreamFlush();
    streamAccumulator.clear();
    delete window.__iiimageDebugApplyAgentActions;
    delete window.__iiimageDebugSeedAgentMessages;
  };
}
