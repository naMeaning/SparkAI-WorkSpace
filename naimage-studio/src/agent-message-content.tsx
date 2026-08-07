import React, { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, ImageIcon, Loader2 } from "lucide-react";

import {
  imageAssetSrc,
  type AgentMessage,
  type AgentToolTrace,
  type TaskAssetReference,
} from "./core";
import { IconActionButton } from "./ui";

declare const __NAIMAGE_AIDEBUG__: boolean;

const RichMarkdownMessage = React.lazy(() => import("./markdown"));

function AgentMessageAttachmentGroup({ label, items, count }: { label: "原图" | "参考图"; items: TaskAssetReference[]; count: number }) {
  if (!count) return null;
  const columnClass = items.length <= 1 ? "is-single" : items.length === 2 ? "is-double" : "";
  return (
    <details className="agent-message-attachment-group">
      <summary>{count} 张{label}</summary>
      <div className={`agent-message-attachment-grid ${columnClass}`}>
        {items.map((item, index) => (
          <span className="agent-message-attachment-preview" key={`${item.assetId}-${index}`}>
            <img src={imageAssetSrc({ type: item.assetUrl ? "url" : "file", path: item.path, assetUrl: item.assetUrl })} alt={item.displayCode} title={item.name} loading="lazy" />
          </span>
        ))}
        {count > items.length ? <small>{items.length}/{count}</small> : null}
      </div>
    </details>
  );
}

export default function AgentMessageContent({ message }: { message: AgentMessage }) {
  const content = String(message.content || "").trim();
  const isThinking = message.meta === "thinking";
  const showToolTrace = Boolean(message.toolTrace);

  if (isThinking) {
    return (
      <details className="agent-thinking-block" open={!message.collapsed}>
        <summary>THOUGHTS</summary>
        <div className="agent-thinking-body">
          <MarkdownMessage content={content || (message.status === "running" ? "模型响应中。" : "已折叠。")} />
        </div>
      </details>
    );
  }

  const externalToolBrief = showToolTrace && message.toolTrace && message.toolTrace.stage !== "result"
    ? String(message.toolTrace.brief || "").trim()
    : "";

  return (
    <>
      {externalToolBrief ? <p className="agent-tool-brief-outside">{externalToolBrief}</p> : null}
      {showToolTrace && message.toolTrace ? <AgentToolTraceCard trace={message.toolTrace} status={message.status ?? "done"} /> : null}
      {content ? <MarkdownMessage content={content} /> : null}
      {message.attachments ? (
        <div className="agent-message-attachments">
          <AgentMessageAttachmentGroup label="原图" items={message.attachments.sourceAssets ?? []} count={message.attachments.sourceCount ?? message.attachments.sourceAssets?.length ?? 0} />
          <AgentMessageAttachmentGroup label="参考图" items={message.attachments.referenceAssets ?? []} count={message.attachments.referenceCount ?? message.attachments.referenceAssets?.length ?? 0} />
        </div>
      ) : null}
    </>
  );
}

function AgentToolTraceCard({ trace, status }: { trace: AgentToolTrace; status: AgentMessage["status"] }) {
  const [seconds, setSeconds] = useState(0);
  const [copiedPromptIndex, setCopiedPromptIndex] = useState(-1);
  const isImageGen = trace.name === "image_gen";
  const isResult = trace.stage === "result" || (trace.stage !== "start" && Boolean(trace.completionText));
  const toolName = agentToolTraceDisplayName(trace);

  useEffect(() => {
    if (!isImageGen || isResult || status !== "running") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [isImageGen, isResult, status]);

  async function copyPrompt(prompt: string, index: number) {
    const value = String(prompt || "");
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedPromptIndex(index);
    window.setTimeout(() => setCopiedPromptIndex((current) => current === index ? -1 : current), 1_600);
  }

  return (
    <div
      className={`agent-tool-trace ${isImageGen ? "is-image-gen" : ""} ${trace.prompts?.length ? "has-prompts" : ""}`}
      data-tool-stage={isResult ? "result" : "start"}
      data-tool-operation={__NAIMAGE_AIDEBUG__ ? trace.operationId : undefined}
      aria-label="Agent 工具调用"
    >
      {isImageGen && !isResult ? (
        <span className="agent-tool-imagegen-timer">
          {status === "running" ? <Loader2 size={13} className="spin" /> : <ImageIcon size={13} />}
          {status === "running" ? `Image Gen 正在绘图 ${seconds}s` : `Image Gen 绘图请求 · ${seconds}s`}
        </span>
      ) : (
        <strong className="agent-tool-trace-title">
          <span>{isResult ? (status === "error" ? "工具调用失败 · " : "工具已完成 · ") : "正在使用工具 · "}</span>
          <b>{toolName}</b>
        </strong>
      )}
      {!isResult && trace.prompts?.length ? (
        <div className="agent-tool-prompt-list" aria-label="Agent 生图提示词">
          {trace.prompts.map((item, index) => (
            <details key={`${item.title || "prompt"}-${index}`} className="agent-tool-prompt-block">
              <summary>
                <span>{trace.prompts!.length > 1 ? (item.title || `提示词 ${index + 1}`) : "查看生图提示词"}</span>
                <small>{item.prompt.replace(/\s+/g, " ").slice(0, 48)}{item.prompt.length > 48 ? "…" : ""}</small>
                <ChevronDown size={13} />
              </summary>
              <div className="agent-tool-prompt-content">
                <div className="agent-tool-prompt-actions">
                  <IconActionButton
                    className="agent-tool-prompt-copy"
                    label={copiedPromptIndex === index ? "提示词已复制" : "复制生图提示词"}
                    title={copiedPromptIndex === index ? "已复制" : "复制提示词"}
                    onClick={() => void copyPrompt(item.prompt, index)}
                    icon={copiedPromptIndex === index ? <Check size={13} /> : <Copy size={13} />}
                  />
                </div>
                <pre>{item.prompt}</pre>
              </div>
            </details>
          ))}
        </div>
      ) : null}
      {isResult && trace.completionText ? <span className={`agent-tool-trace-completion ${status === "error" ? "is-error" : ""}`}><Check size={13} />{trace.completionText}</span> : null}
    </div>
  );
}

function agentToolTraceDisplayName(trace: AgentToolTrace) {
  const raw = String(trace.name || trace.label || "tool").trim();
  const normalized = raw.toLowerCase();
  const map: Record<string, string> = {
    workflow: "Canvas",
    image_gen: "Image Gen",
    view_image: "View Image",
    context_manage: "Context Manage",
    memory: "Memory",
    ask_user: "Ask User",
    web_search: "Web Search",
    command: "Command",
    experience: "Experience",
  };
  if (map[normalized]) return map[normalized];
  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ") || "Tool";
}

function messageNeedsMarkdown(content: string) {
  return /(^|\n)\s{0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s|```|~~~)|(?:\*\*|__|~~|`|\[[^\]]+\]\(|\[\^[^\]]+\]|https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})|(^|\n)\s*\|.+\|\s*(?:\n|$)/im.test(content);
}

function MarkdownMessage({ content }: { content: string }) {
  if (!messageNeedsMarkdown(content)) {
    return <div className="markdown-body agent-plain-text">{content}</div>;
  }
  return (
    <div className="markdown-body">
      <React.Suspense fallback={<div className="agent-plain-text">{content}</div>}>
        <RichMarkdownMessage content={content} />
      </React.Suspense>
    </div>
  );
}
