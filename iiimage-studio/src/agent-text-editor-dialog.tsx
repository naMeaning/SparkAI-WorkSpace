import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  ActionButton,
  CodeField,
  DialogShell,
  StatusLine,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
} from "./ui";

declare const __IIIMAGE_AIDEBUG__: boolean;

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;
const WHEN_IDLE_AND_CLEAN = "when-idle-and-clean" as const;

function mergeConcurrentFastMemory(baseText: string, localText: string, remoteText: string) {
  const base = baseText.trim();
  const local = localText.trim();
  const remote = remoteText.trim();
  if (local === base) return remote;
  if (remote === base || !remote) return local;
  const chunks = (value: string) => value.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  const baseChunks = new Set(chunks(base));
  const localChunks = new Set(chunks(local));
  const remoteAdditions = chunks(remote).filter((item) => !baseChunks.has(item) && !localChunks.has(item));
  return [local, ...remoteAdditions].filter(Boolean).join("\n\n");
}

export default function AgentTextEditorDialog({
  kind,
  projectId = "",
  conversationId = "",
  close,
}: {
  kind: "prompt" | "fastmemory";
  projectId?: string;
  conversationId?: string;
  close: () => void;
}) {
  const isPrompt = kind === "prompt";
  const [draft, setDraft] = useState("");
  const [savedText, setSavedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [maxChars, setMaxChars] = useState(isPrompt ? 120_000 : 80_000);
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const dirty = draft !== savedText;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setMessage("");
      setMessageError(false);
      setConfirmReset(false);
      setDiscardArmed(false);
      try {
        if (!window.iiimageAgent) throw new Error("Agent 配置服务未就绪。");
        const result = isPrompt
          ? await window.iiimageAgent.getMainPrompt()
          : await window.iiimageAgent.getFastMemory({ projectId, conversationId });
        if (!result.ok) throw new Error(result.error || (isPrompt ? "提示词读取失败。" : "Agent 记忆读取失败。"));
        if (cancelled) return;
        const text = String(result.text || "");
        setDraft(text);
        setSavedText(text);
        setMaxChars(Math.max(1, Number(result.maxChars || (isPrompt ? 120_000 : 80_000))));
        setLoadedUpdatedAt(isPrompt ? "" : String("updatedAt" in result ? result.updatedAt || "" : ""));
        setIsDefault(isPrompt && "isDefault" in result ? result.isDefault === true : false);
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : String(error));
        setMessageError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, isPrompt, projectId]);

  async function save() {
    const text = draft.trim();
    if (!text || saving || !window.iiimageAgent) return;
    setSaving(true);
    setMessage("");
    setMessageError(false);
    try {
      if (__IIIMAGE_AIDEBUG__) {
        const debugDelay = Math.max(0, Math.min(5_000, Number(window.__iiimageDebugSurfaceSaveDelayMs || 0)));
        if (debugDelay) await new Promise((resolve) => window.setTimeout(resolve, debugDelay));
      }
      const result = isPrompt
        ? await window.iiimageAgent.saveMainPrompt({ text: draft })
        : await window.iiimageAgent.saveFastMemory({ projectId, conversationId, text: draft, expectedUpdatedAt: loadedUpdatedAt });
      if (!isPrompt && "conflict" in result && result.conflict) {
        const remoteText = String(result.text || "");
        const mergedText = mergeConcurrentFastMemory(savedText, draft, remoteText).slice(0, maxChars);
        setDraft(mergedText);
        setSavedText(remoteText);
        setLoadedUpdatedAt(String(result.updatedAt || ""));
        setMessage(mergedText === remoteText
          ? "Agent 在编辑期间更新了记忆，已载入最新内容。"
          : "Agent 在编辑期间新增了记忆，新增内容已合并；请检查后再次保存。"
        );
        setMessageError(false);
        return;
      }
      if (!result.ok) throw new Error(result.error || (isPrompt ? "提示词保存失败。" : "Agent 记忆保存失败。"));
      const nextText = String(result.text ?? draft);
      setDraft(nextText);
      setSavedText(nextText);
      if (!isPrompt) setLoadedUpdatedAt(String("updatedAt" in result ? result.updatedAt || "" : ""));
      setIsDefault(isPrompt && "isDefault" in result ? result.isDefault === true : false);
      setDiscardArmed(false);
      setMessage(isPrompt ? "提示词已保存，下一轮 Agent 请求开始生效。" : "当前会话的 Agent 记忆已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageError(true);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      setMessage(isPrompt ? "再次点击“恢复默认”确认覆盖当前提示词。" : "再次点击“清空记忆”确认只清空当前会话的 Agent 记忆。" );
      setMessageError(false);
      return;
    }
    if (saving || !window.iiimageAgent) return;
    setSaving(true);
    setMessage("");
    setMessageError(false);
    try {
      const result = isPrompt
        ? await window.iiimageAgent.resetMainPrompt()
        : await window.iiimageAgent.resetFastMemory({ projectId, conversationId, expectedUpdatedAt: loadedUpdatedAt });
      if (!isPrompt && "conflict" in result && result.conflict) {
        const remoteText = String(result.text || "");
        const mergedText = mergeConcurrentFastMemory(savedText, draft, remoteText).slice(0, maxChars);
        setDraft(mergedText);
        setSavedText(remoteText);
        setLoadedUpdatedAt(String(result.updatedAt || ""));
        setConfirmReset(false);
        setMessage("Agent 在编辑期间更新了记忆，已合并最新内容；请检查后再次清空。");
        setMessageError(false);
        return;
      }
      if (!result.ok) throw new Error(result.error || (isPrompt ? "默认提示词恢复失败。" : "Agent 记忆清空失败。"));
      const nextText = String(result.text || "");
      setDraft(nextText);
      setSavedText(nextText);
      setIsDefault(isPrompt);
      if (!isPrompt) setLoadedUpdatedAt("");
      setConfirmReset(false);
      setDiscardArmed(false);
      setMessage(isPrompt ? "已恢复默认提示词。" : "已清空当前会话的 Agent 记忆。其他会话不受影响。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageError(true);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function closeBlocked() {
    if (saving) {
      setMessage("正在保存，请稍候。");
      setMessageError(false);
      return;
    }
    if (dirty && !discardArmed) {
      setDiscardArmed(true);
      setMessage("有未保存修改。再次关闭将放弃这些修改。");
      setMessageError(true);
    }
  }

  return (
    <DialogShell
      surface={isPrompt ? "agent-prompt-editor" : "agent-memory-editor"}
      ariaLabel={isPrompt ? "编辑 Agent 提示词" : "编辑 Agent 记忆"}
      className="agent-text-editor-dialog"
      layerClassName="agent-text-editor-layer"
      layerLevel="nested"
      busy={loading || saving}
      dirty={dirty}
      closePolicy={{
        escape: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
        backdrop: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
        [CLOSE_BUTTON_REASON]: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
        action: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
      }}
      onRequestClose={close}
      onCloseBlocked={closeBlocked}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={isPrompt ? "编辑 Agent 提示词" : "编辑 Agent 记忆"}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭编辑器"
            closeDisabled={loading || saving}
          />
          <SurfaceBody className="agent-text-editor-body">
            <div className="agent-text-editor-meta">
              <span>{isPrompt ? (isDefault ? "当前为默认提示词" : "当前为自定义提示词") : (savedText ? "当前会话已有记忆" : "当前会话暂无记忆")}</span>
              <em>{draft.length.toLocaleString()} / {maxChars.toLocaleString()}</em>
            </div>
            <CodeField
              label={isPrompt ? "Agent 提示词正文" : "Agent 记忆正文"}
              labelHidden
              fill
              fieldClassName="agent-text-editor-code-field"
              className="agent-text-editor-code-control"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value.slice(0, maxChars));
                setConfirmReset(false);
                setDiscardArmed(false);
                setMessage("");
              }}
              maxLength={maxChars}
              disabled={loading || saving}
              placeholder={isPrompt ? "编辑主 Agent 提示词…" : "编辑当前会话已有的 Agent 记忆…"}
              autoFocus
              spellCheck={false}
            />
            {message ? (
              <StatusLine tone={messageError ? "danger" : "success"} live={messageError ? "assertive" : "polite"}>
                {message}
              </StatusLine>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter
            className="agent-text-editor-footer"
            leading={
              <>
                <ActionButton
                  variant={confirmReset ? "danger" : "secondary"}
                  onClick={() => void reset()}
                  disabled={loading || saving}
                  icon={<RotateCcw size={15} />}
                >
                  {isPrompt ? (confirmReset ? "确认恢复默认" : "恢复默认") : (confirmReset ? "确认清空记忆" : "清空记忆")}
                </ActionButton>
                <span className="agent-text-editor-dirty">{dirty ? "有未保存修改" : "已同步"}</span>
              </>
            }
          >
            <ActionButton onClick={() => requestClose("action")} disabled={loading || saving}>
              {discardArmed && dirty ? "确认放弃" : "关闭"}
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={() => void save()}
              busy={saving}
              disabled={loading || !draft.trim() || !dirty}
              icon={<Check size={15} />}
            >
              保存
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
