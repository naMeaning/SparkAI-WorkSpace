import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, CircleHelp, Download, Import, Languages, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { CommerceTemplateEntry } from "./commerce-template.ts";
import { hasSeenOneTimeUiHint, markOneTimeUiHintSeen } from "./settings-persistence.ts";
import { ActionButton, ButtonBase, DialogShell, InlineNotice, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import "./styles/04e-commerce-template-dialog.css";

export type CommerceTemplateDialogProps = {
  close: () => void;
  createTemplate: () => void;
  useTemplate: (entry: CommerceTemplateEntry & { plan: NonNullable<CommerceTemplateEntry["plan"]> }) => Promise<void>;
  focusTemplateId?: string;
};

const platformLabels: Record<CommerceTemplateEntry["platformTemplateId"], string> = {
  general: "通用",
  amazon: "Amazon",
  aliexpress: "速卖通"
};

export default function CommerceTemplateDialog({ close, createTemplate, useTemplate, focusTemplateId = "" }: CommerceTemplateDialogProps) {
  const [items, setItems] = useState<CommerceTemplateEntry[]>([]);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteArmedId, setDeleteArmedId] = useState("");
  const [highlightedId, setHighlightedId] = useState(focusTemplateId);
  const [showFirstVisitHint, setShowFirstVisitHint] = useState(() => !hasSeenOneTimeUiHint("commerce-template-market"));
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const load = useCallback(async () => {
    const bridge = window.naimageConfig;
    if (!bridge?.listCommerceTemplates) {
      setError("当前桌面运行时未提供套图模板市场，请重启应用后再试。");
      return;
    }
    setBusyAction("list");
    setError("");
    try {
      const result = await bridge.listCommerceTemplates();
      if (!result?.ok) throw new Error(result?.error || "读取套图模板市场失败。");
      setItems(result.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction("");
    }
  }, []);

  useEffect(() => {
    void load();
    return window.naimageConfig?.onCommerceTemplateChanged?.(() => { void load(); });
  }, [load]);

  useEffect(() => {
    if (showFirstVisitHint) markOneTimeUiHintSeen("commerce-template-market");
  }, [showFirstVisitHint]);

  useEffect(() => {
    if (!focusTemplateId || !items.some((entry) => entry.id === focusTemplateId)) return;
    setHighlightedId(focusTemplateId);
    const frame = window.requestAnimationFrame(() => {
      const row = rowRefs.current.get(focusTemplateId);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setHighlightedId((current) => current === focusTemplateId ? "" : current), 5_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusTemplateId, items]);

  const groups = useMemo(() => ({
    builtIn: items.filter((entry) => entry.source === "built-in"),
    personal: items.filter((entry) => entry.source === "personal")
  }), [items]);

  async function importTemplate() {
    const bridge = window.naimageConfig;
    if (!bridge?.importCommerceTemplate) return setError("当前桌面运行时不支持导入套图模板。");
    setBusyAction("import");
    setError("");
    setNotice("");
    try {
      const result = await bridge.importCommerceTemplate();
      if (!result?.ok) throw new Error(result?.error || "导入套图模板失败。");
      if (!result.canceled) {
        setNotice(`已导入“${result.entry?.title || result.sourceName || "套图模板"}”。`);
        await load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction("");
    }
  }

  async function exportTemplate(entry: CommerceTemplateEntry) {
    const bridge = window.naimageConfig;
    if (!bridge?.exportCommerceTemplate) return setError("当前桌面运行时不支持导出套图模板。");
    setBusyAction(`export:${entry.id}`);
    setError("");
    setNotice("");
    try {
      const result = await bridge.exportCommerceTemplate({
        id: entry.id,
        ...(entry.source === "personal" ? { expectedRevision: entry.revision } : {})
      });
      if (!result?.ok) throw new Error(result?.error || "导出套图模板失败。");
      if (!result.canceled) setNotice(`已导出“${entry.title}”。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction("");
    }
  }

  async function deleteTemplate(entry: CommerceTemplateEntry) {
    if (deleteArmedId !== entry.id) {
      setDeleteArmedId(entry.id);
      return;
    }
    const bridge = window.naimageConfig;
    if (!bridge?.deleteCommerceTemplate) return setError("当前桌面运行时不支持删除套图模板。");
    setBusyAction(`delete:${entry.id}`);
    setError("");
    setNotice("");
    try {
      const result = await bridge.deleteCommerceTemplate({ id: entry.id, expectedRevision: entry.revision, confirmed: true });
      if (!result?.ok) throw new Error(result?.error || "删除套图模板失败。");
      setDeleteArmedId("");
      setNotice(`已删除“${entry.title}”。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction("");
    }
  }

  async function applyTemplate(entry: CommerceTemplateEntry) {
    const bridge = window.naimageConfig;
    if (!bridge?.getCommerceTemplate) return setError("当前桌面运行时无法读取套图模板正文。");
    setBusyAction(`use:${entry.id}`);
    setError("");
    setNotice("");
    try {
      const result = await bridge.getCommerceTemplate({ id: entry.id });
      if (!result?.ok || !result.entry?.plan) throw new Error(result?.error || "套图模板正文不存在。");
      await useTemplate(result.entry as CommerceTemplateEntry & { plan: NonNullable<CommerceTemplateEntry["plan"]> });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction("");
    }
  }

  function renderGroup(title: string, entries: CommerceTemplateEntry[], emptyText: string) {
    return (
      <section className="commerce-template-group" aria-label={title}>
        <header><strong>{title}</strong><span>{entries.length}</span></header>
        {entries.length ? (
          <div className="commerce-template-list">
            {entries.map((entry) => {
              const pending = busyAction.endsWith(`:${entry.id}`);
              const deleteArmed = deleteArmedId === entry.id;
              return (
                <article
                  className="commerce-template-row"
                  key={entry.id}
                  data-source={entry.source}
                  data-highlighted={highlightedId === entry.id ? "true" : "false"}
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) rowRefs.current.set(entry.id, element);
                    else rowRefs.current.delete(entry.id);
                  }}
                >
                  <span className="commerce-template-icon" aria-hidden="true">
                    {entry.mode === "translate" ? <Languages size={18} /> : <Sparkles size={18} />}
                  </span>
                  <div className="commerce-template-copy">
                    <div><strong>{entry.title}</strong>{entry.source === "built-in" ? <small>内置</small> : null}</div>
                    <p>{entry.description || `${platformLabels[entry.platformTemplateId]} · ${entry.mode === "generate" ? `${entry.slotCount} 张套图` : `${entry.localeCount} 种语言`}`}</p>
                    <span>{platformLabels[entry.platformTemplateId]} · {entry.mode === "generate" ? `${entry.slotCount} 个槽位` : `${entry.localeCount} 种语言`}</span>
                  </div>
                  <div className="commerce-template-actions">
                    <ActionButton
                      variant="primary"
                      busy={busyAction === `use:${entry.id}`}
                      disabled={Boolean(busyAction)}
                      icon={<BookMarked size={14} />}
                      onClick={() => void applyTemplate(entry)}
                    >
                      使用
                    </ActionButton>
                    <ButtonBase
                      aria-label={`导出套图模板：${entry.title}`}
                      title="导出模板"
                      disabled={Boolean(busyAction)}
                      onClick={() => void exportTemplate(entry)}
                    >
                      {busyAction === `export:${entry.id}` ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                    </ButtonBase>
                    {entry.source === "personal" ? (
                      <ButtonBase
                        className={deleteArmed ? "is-danger-armed" : ""}
                        aria-label={deleteArmed ? `确认删除套图模板：${entry.title}` : `删除套图模板：${entry.title}`}
                        title={deleteArmed ? "再次点击确认删除" : "删除模板"}
                        disabled={Boolean(busyAction)}
                        onClick={() => void deleteTemplate(entry)}
                      >
                        {pending && busyAction.startsWith("delete:") ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                      </ButtonBase>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : <p className="commerce-template-empty">{emptyText}</p>}
      </section>
    );
  }

  return (
    <DialogShell surface="commerce-template" ariaLabel="套图模板市场" className="commerce-template-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader title="套图模板市场" description="Amazon 与速卖通套图计划" onClose={() => requestClose("close-button")}>
            <div className="commerce-template-header-actions">
              <ActionButton variant="primary" disabled={Boolean(busyAction)} icon={<Plus size={14} />} onClick={createTemplate}>新建</ActionButton>
              <ActionButton variant="secondary" busy={busyAction === "import"} disabled={Boolean(busyAction)} icon={<Import size={14} />} onClick={() => void importTemplate()}>导入</ActionButton>
              <ButtonBase aria-label="刷新套图模板" title="刷新" disabled={Boolean(busyAction)} onClick={() => void load()}>
                {busyAction === "list" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
              </ButtonBase>
            </div>
          </SurfaceHeader>
          <SurfaceBody className="commerce-template-body">
            {showFirstVisitHint ? (
              <InlineNotice className="commerce-template-first-hint" tone="info" icon={<CircleHelp size={15} />}>
                <span>点击“新建”，配置套图或多语言计划，再选择“保存到模板市场”。保存模板不会立即生成图片或产生费用。</span>
                <ButtonBase aria-label="关闭模板首次提示" title="知道了" onClick={() => setShowFirstVisitHint(false)}><X size={14} /></ButtonBase>
              </InlineNotice>
            ) : null}
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
            {renderGroup("平台内置", groups.builtIn, "内置模板暂不可用。")}
            {renderGroup("我的模板", groups.personal, "尚未保存个人套图模板。点击顶部“新建”开始配置。")}
          </SurfaceBody>
          <SurfaceFooter>
            <span className="commerce-template-footer-note"><BookMarked size={13} /> {items.length} 个模板</span>
            <ActionButton variant="ghost" onClick={() => requestClose("action")}>关闭</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
