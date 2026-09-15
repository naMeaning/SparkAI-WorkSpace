export type ToolTimelineProgressLike = {
  runId?: string;
  projectId?: string;
  conversationId?: string;
  phase?: string;
  tool?: string;
  toolRunId?: string;
  operationId?: string;
};

type ToolTraceLike = {
  stage?: string;
  name?: string;
  operationId?: string;
  brief?: string;
  completionText?: string;
  prompts?: { title?: string; prompt?: string }[];
};

type ToolTimelineMessageLike = {
  id: string;
  meta?: string;
  status?: string;
  createdAt?: string;
  toolTrace?: ToolTraceLike;
};

const clean = (value: unknown): string => String(value ?? "").trim();

const operationScopeKey = (payload: ToolTimelineProgressLike): string => [
  clean(payload.projectId) || "project",
  clean(payload.conversationId) || "conversation",
  clean(payload.runId) || "active",
  clean(payload.tool) || (clean(payload.phase).startsWith("image-") ? "image_gen" : "tool"),
].join("::");

export const resolveToolTimelineOperationId = (
  aliases: Map<string, string>,
  payload: ToolTimelineProgressLike,
): string => {
  const phase = clean(payload.phase);
  const tool = clean(payload.tool) || (phase.startsWith("image-") ? "image_gen" : "");
  const explicitOperationId = clean(payload.operationId);
  const explicitToolRunId = clean(payload.toolRunId);
  const fallback = `${clean(payload.runId) || "active"}-${tool || "tool"}`;
  if (tool !== "image_gen") return fallback;

  const scopeKey = operationScopeKey({ ...payload, tool });
  if (explicitOperationId) {
    aliases.set(scopeKey, explicitOperationId);
    return explicitOperationId;
  }
  if (phase === "tool-start" && explicitToolRunId) {
    aliases.set(scopeKey, explicitToolRunId);
    return explicitToolRunId;
  }
  const existing = aliases.get(scopeKey);
  if (existing) return existing;
  const operationId = explicitToolRunId || fallback;
  aliases.set(scopeKey, operationId);
  return operationId;
};

const promptSignature = (trace?: ToolTraceLike): string => JSON.stringify(
  (trace?.prompts ?? []).map((item) => ({ title: clean(item.title), prompt: clean(item.prompt) })),
);

const exactTraceSignature = (trace?: ToolTraceLike): string => [
  clean(trace?.stage),
  clean(trace?.name),
  clean(trace?.brief),
  clean(trace?.completionText),
  promptSignature(trace),
].join("\u0000");

export const collapseDuplicateToolTimelineMessages = <T extends ToolTimelineMessageLike>(messages: T[]): T[] => {
  const result: T[] = [];
  for (const message of messages) {
    const previous = result[result.length - 1];
    const currentTrace = message.toolTrace;
    const previousTrace = previous?.toolTrace;
    const bothProgress = message.meta === "progress" && previous?.meta === "progress" && currentTrace && previousTrace;
    if (!bothProgress || clean(currentTrace.stage) !== clean(previousTrace.stage) || clean(currentTrace.name) !== clean(previousTrace.name)) {
      result.push(message);
      continue;
    }
    const currentOperationId = clean(currentTrace.operationId);
    const previousOperationId = clean(previousTrace.operationId);
    if (currentOperationId && currentOperationId === previousOperationId) {
      result[result.length - 1] = message;
      continue;
    }
    const legacyExactDuplicate =
      !currentOperationId &&
      !previousOperationId &&
      clean(message.createdAt) === clean(previous.createdAt) &&
      clean(message.status) === clean(previous.status) &&
      exactTraceSignature(currentTrace) === exactTraceSignature(previousTrace) &&
      /^progress-tool-/.test(message.id) &&
      /^progress-tool-/.test(previous.id);
    if (legacyExactDuplicate) continue;
    result.push(message);
  }
  return result;
};
