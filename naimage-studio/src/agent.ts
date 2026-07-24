/*
naimage Agent Map

File Contract
- agent.ts owns front-end Agent-facing helpers: progress text, streaming message merge, thinking-state settlement, and the main-to-Agent bridge call.
- It may call window.naimageAgent and normalize Agent runtime results.
- It must not render UI and must not own image generation UI state.

Region Index
01 Agent Progress Labels
   Tool names, structured tool traces, timeline summaries, retry/phase messages, and compact status text.
02 Streaming Message Reducers
   Append assistant deltas and close thinking messages without mutating state.
03 Agent Bridge
   requestAgent: the single browser-side call into the Agent runtime bridge.
*/

import { sanitizeAgentVisibleText } from "./core";
import type { AgentMessage, AgentProgress, AgentRuntimeResult, AgentTaskScope, AgentToolTrace, ReferenceImage, WorkflowNode } from "./core";

// -----------------------------------------------------------------------------
// AGENT 01 Agent Progress Labels
// -----------------------------------------------------------------------------

export function agentToolLabel(tool?: string, phase?: string) {
  const value = String(tool || "");
  if (value === "image_gen") return "Image Gen";
  if (value === "experience") return "Experience";
  if (value === "workflow") return "成果画布";
  if (value === "context_manage") return "Context Manage";
  if (value === "memory") return "Memory";
  if (value === "ask_user") return "Ask User";
  if (value === "view_image") return "View Image";
  if (value === "web_search") return "Web Search";
  if (value === "shell_command") return "Command";
  if (value === "command") return "Command";
  if (value) return value;
  if (String(phase || "").includes("memory")) return "Memory";
  return "Agent";
}

function traceCategoryForTool(tool?: string, phase?: string) {
  const value = String(tool || "");
  if (value === "workflow") return "成果";
  if (value === "image_gen" || value === "view_image") return "图像";
  if (value === "context_manage" || value === "memory" || value === "experience") return "记忆";
  if (value === "ask_user") return "问询";
  if (String(phase || "").startsWith("model-")) return "模型";
  return "工具";
}

function inputObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shortValue(value: unknown, maxChars = 52) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

function publicTraceText(value: unknown, maxChars = 220) {
  return cleanTimelineText(sanitizeAgentVisibleText(value), maxChars);
}

function operationFromProgress(payload: AgentProgress) {
  if (payload.operation) return cleanTimelineText(payload.operation, 48);
  const tool = String(payload.tool || "");
  const input = inputObject(payload.input);
  const mode = String(input.mode || input.operation || "").trim();
  if (tool === "workflow") return operationLabel(mode || "list_nodes");
  if (tool === "image_gen") return operationLabel(mode || "generate");
  if (tool === "view_image") return "查看图片";
  if (tool === "context_manage") return "上下文管理";
  if (tool === "memory") return operationLabel(mode || "记忆");
  if (tool === "ask_user") return "请求用户";
  return agentToolLabel(tool, payload.phase);
}

function operationLabel(value: string) {
  const map: Record<string, string> = {
    compose: "整理提示词",
    generate: "绘图",
    edit: "图像编辑",
    redraw: "AI 重绘",
    cutout: "AI 抠图",
    layer_merge: "图层合成",
    add: "写入记忆",
    check: "检索记忆",
    read: "读取记忆",
    list_nodes: "成果列表",
    describe_node: "成果详情",
    focus_node: "定位成果",
    connect_nodes: "关联成果",
    disconnect_node: "移除关系",
    delete_node: "删除成果",
    update_node: "更新成果",
    continue_node: "继续生图",
    redraw_node: "基于节点重绘",
    cutout_node: "基于节点抠图"
  };
  return map[value] || value || "执行";
}

function paramsFromProgress(payload: AgentProgress) {
  if (payload.params) return cleanTimelineText(payload.params, 92);
  const input = inputObject(payload.input);
  const parts = [
    input.nodeId ? `节点 ${shortValue(input.nodeId)}` : "",
    input.sourceId || input.targetId ? `${shortValue(input.sourceId)} -> ${shortValue(input.targetId)}` : "",
    input.parentId ? `父节点 ${shortValue(input.parentId)}` : "",
    input.mode ? `模式 ${shortValue(input.mode)}` : "",
    input.count ? `${shortValue(input.count)} 张` : "",
    input.ratio ? String(input.ratio) : "",
    input.resolution ? String(input.resolution) : "",
    input.model ? shortValue(input.model, 32) : "",
    input.prompt ? `prompt ${shortValue(input.prompt, 34)}` : "",
    input.query ? `查询 ${shortValue(input.query, 42)}` : "",
    input.title ? `标题 ${shortValue(input.title, 34)}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "参数已记录";
}

function promptsFromProgress(payload: AgentProgress) {
  if (String(payload.tool || "") !== "image_gen" && !String(payload.phase || "").startsWith("image-")) return undefined;
  const input = inputObject(payload.input);
  const items = Array.isArray(input.batchItems) && input.batchItems.length
    ? input.batchItems
    : Array.isArray(input.items)
      ? input.items
      : [];
  const prompts = items
    .map((item, index) => {
      const value = inputObject(item);
      const prompt = String(value.prompt || "").trim();
      return prompt ? { title: String(value.title || `提示词 ${index + 1}`).trim(), prompt } : null;
    })
    .filter((item): item is { title: string; prompt: string } => Boolean(item));
  if (prompts.length) return prompts;
  const prompt = String(input.prompt || "").trim();
  return prompt ? [{ title: "生图提示词", prompt }] : undefined;
}

function partialImageFromProgress(payload: AgentProgress) {
  const candidate = payload.partialImage;
  const dataUrl = String(candidate?.dataUrl || "");
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) return undefined;
  return {
    dataUrl,
    index: Math.max(1, Math.floor(Number(candidate?.index || 1))),
    total: Math.max(1, Math.floor(Number(candidate?.total || 3)))
  };
}

function completionTextForProgress(payload: AgentProgress) {
  const phase = String(payload.phase || "");
  if (phase === "tool-error" || phase === "image-error") {
    const summary = publicTraceText(payload.summary || payload.detail || "执行失败", 120);
    return summary ? `执行失败：${summary}` : "执行失败";
  }
  if (phase !== "tool-done" && phase !== "tool-skip") return undefined;
  const tool = String(payload.tool || "");
  const input = inputObject(payload.input);
  if (tool === "experience") {
    const action = String(input.action || "");
    if (action === "add" || action === "write") return "记录经验成功";
    if (action === "read") return "绘画经验读取成功";
    if (action === "replace") return "绘画经验更新成功";
    if (action === "compact") return "绘画经验整理成功";
    return "经验处理完成";
  }
  if (tool === "image_gen") return "图片生成完成";
  if (tool === "workflow") return "画布操作完成";
  if (tool === "view_image") return "图片读取完成";
  if (tool === "web_search") return "搜索完成";
  if (tool === "shell_command") return "检查完成";
  if (tool === "command") return "检查完成";
  return `${agentToolLabel(tool, phase)} 已完成`;
}

export function toolTraceForProgress(payload: AgentProgress): AgentToolTrace | null {
  const phase = String(payload.phase || "");
  const tool = String(payload.tool || "");
  if (!tool && !phase.startsWith("image-")) return null;
  if (!phase.startsWith("tool-") && !phase.startsWith("image-")) return null;
  const name = tool || (phase.startsWith("image-") ? "image_gen" : "");
  const brief = publicTraceText(payload.brief || payload.summary || payload.detail || operationFromProgress(payload), 118);
  return {
    operationId: String(payload.operationId || payload.toolRunId || "").trim() || undefined,
    label: traceCategoryForTool(name, phase),
    name,
    operation: operationFromProgress(payload),
    params: paramsFromProgress(payload),
    brief,
    prompts: promptsFromProgress(payload),
    partialImage: partialImageFromProgress(payload),
    completionText: completionTextForProgress(payload)
  };
}

export function cleanTimelineText(value?: unknown, maxChars = 220) {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? JSON.stringify(value)
      : String(value ?? "");
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

export function timelineTextForProgress(payload: AgentProgress) {
  const phase = String(payload.phase || "");
  const tool = String(payload.tool || "");
  const summary = publicTraceText(payload.summary || payload.detail || "");
  const label = agentToolLabel(tool, phase);

  if (phase === "model-thinking-delta" || phase === "assistant-message-delta") return "";
  if (phase === "model-thinking-done") return "";
  // The same assistant content is already delivered through assistant-message-delta.
  // Rendering the terminal assistant-message phase as another timeline entry duplicates
  // the model's pre-tool brief in streamed conversations.
  if (phase === "assistant-message") return "";
  if (phase === "runtime-start" || phase === "runtime-request") return "";
  if (phase === "model-route" || phase === "model-route-fallback") return "";
  if (phase === "model-request-detail" || phase === "model-response-detail") return "";
  // The persistent Agent activity indicator already represents model request /
  // thinking state. Adding another timeline message here creates a second
  // competing status for the same work and leaves stale noise after the run.
  if (phase === "model-request") return "";
  if (phase === "model-force" || phase === "model-tool-choice" || phase === "model-arg-correct") return "";
  if (phase === "model-response") return "";
  if (phase === "model-retry") return summary || "Agent 协议返回异常。";
  if (phase === "tool-start" && tool === "image_gen") return "Image Gen 正在绘图。";
  if (phase === "tool-poll" && tool === "image_gen") return "Image Gen 正在绘图。";
  if (phase === "tool-start") return `正在使用工具 · ${label}`;
  if (phase === "tool-poll") return `${label} 执行中。`;
  if (phase === "tool-done" && tool === "experience") return "记录经验成功";
  if (phase === "tool-done" && tool === "image_gen") return "图片生成完成";
  if (phase === "tool-done") return `${label} 已完成`;
  if (phase === "tool-error") return `${label} 失败${summary ? `：${summary}` : ""}`;
  if (phase === "tool-skip") return `${label} 跳过${summary ? `：${summary}` : ""}`;
  if (phase === "image-request") return "Image Gen 正在绘图。";
  if (phase === "image-response") return "";
  if (phase === "image-dry-run") return "Image Gen 模拟执行完成。";
  if (phase === "image-error" || phase === "runtime-error" || phase === "server-error") return `${label} 失败${summary ? `：${summary}` : ""}`;
  if (phase === "memory-start") return summary || `正在${tool === "context_manage" ? "整理上下文" : "写日记"}。`;
  if (phase === "memory-done") return summary || "记忆整理完成。";
  if (phase === "memory-warning") return summary || "记忆整理遇到问题。";
  if (phase.startsWith("server-")) return summary;
  return summary;
}

// -----------------------------------------------------------------------------
// AGENT 02 Streaming Message Reducers
// -----------------------------------------------------------------------------

export function appendStreamingAgentMessage(messages: AgentMessage[], nextMessage: AgentMessage) {
  const index = messages.findIndex((message) => message.id === nextMessage.id);
  if (index < 0) return [...messages, nextMessage].slice(-120);
  return messages
    .map((message) =>
      message.id === nextMessage.id
        ? {
            ...message,
            ...nextMessage,
            content: `${message.content || ""}${nextMessage.content || ""}`
          }
        : message
    )
    .slice(-120);
}

export function finishThinkingMessages(messages: AgentMessage[], runId?: string, modelRound?: number) {
  const exactId = runId && modelRound ? `thinking-${runId}-round-${modelRound}` : "";
  const prefix = runId ? `thinking-${runId}` : "";
  return messages.map((message) =>
    message.meta === "thinking" && (!runId || (exactId ? message.id === exactId : message.id.startsWith(prefix)))
      ? { ...message, status: "done" as const, collapsed: true }
      : message
  );
}

export function finishRunStreamingMessages(messages: AgentMessage[], runId?: string) {
  const streamPrefix = runId ? `assistant-stream-${runId}` : "";
  const thinkingPrefix = runId ? `thinking-${runId}` : "";
  return messages.map((message) => {
    if (message.meta === "thinking" && (!thinkingPrefix || message.id.startsWith(thinkingPrefix))) {
      return { ...message, status: "done" as const, collapsed: true };
    }
    if (message.meta === "assistant-stream" && (!streamPrefix || message.id.startsWith(streamPrefix))) {
      return { ...message, status: "done" as const };
    }
    if (message.meta === "progress" && message.status === "running") {
      return { ...message, status: "done" as const };
    }
    return message;
  });
}

// -----------------------------------------------------------------------------
// AGENT 03 Agent Bridge
// -----------------------------------------------------------------------------

export async function requestAgent(
  messages: AgentMessage[],
  nodes: WorkflowNode[],
  prompt: string,
  runId?: string,
  referenceImages: ReferenceImage[] = [],
  projectId?: string,
  conversationId?: string,
  selectedNodeId?: string,
  selectedNodeIds: string[] = [],
  taskScope?: AgentTaskScope
) {
  if (!window.naimageAgent) {
    throw new Error("Agent 桥接不可用，请重启桌面端。");
  }

  const result = await window.naimageAgent.chat({ runId, prompt, messages, nodes, referenceImages, taskScope, projectId, conversationId, selectedNodeId, selectedNodeIds });
  if (!result.ok) {
    throw new Error(result.error ?? "Agent runtime 请求失败。");
  }

  return {
    ...result,
    content: result.content ?? ""
  } satisfies AgentRuntimeResult;
}
