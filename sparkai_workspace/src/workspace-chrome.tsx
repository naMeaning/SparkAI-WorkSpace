import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  Check,
  History,
  ImageIcon,
  Images,
  Import,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Search,
  Save,
  Settings,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

import {
  imageAssetThumbnailSrc,
  type AgentConversation,
  type WorkflowNode,
} from "./core";
import { ButtonBase, IconActionButton } from "./ui";
import type { RequirementTemplate } from "../runtime/requirement-template-contract.mjs";
import type { RequirementTemplateUseOptions } from "./requirement-template-dialog";

const LazyRequirementTemplateDialog = React.lazy(() => import("./requirement-template-dialog"));

export type WorkspaceAssetRailTab = "results" | "layers" | "requirements" | "templates" | "history";

export type WorkspaceRequirementTemplate = {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  skill?: { name?: string; description?: string };
  socialPlan?: { platform?: "xiaohongshu" | "douyin" };
  template?: RequirementTemplate;
};

const railTabs: Array<{
  id: WorkspaceAssetRailTab;
  label: string;
  title?: string;
  icon: React.ReactNode;
}> = [
  { id: "results", label: "成果", icon: <Images size={15} /> },
  { id: "layers", label: "图层", title: "分层图片：定位、查看、合并与导出", icon: <Layers3 size={15} /> },
  { id: "requirements", label: "需求", icon: <WandSparkles size={15} /> },
  { id: "templates", label: "旧需求模板", title: "打开旧需求模板库", icon: <BookMarked size={15} /> },
];
const defaultVisibleRailTabs = railTabs.map((item) => item.id);

function nodePreview(node: WorkflowNode | null | undefined, assetIndex?: number) {
  const asset = assetIndex === undefined
    ? node?.assets?.find((item) => item.status !== "error") ?? node?.assets?.[0]
    : node?.assets?.[assetIndex];
  return asset ? imageAssetThumbnailSrc(asset, 256) : "";
}

function nodeRailLabel(node: WorkflowNode) {
  if (node.requirement?.skill) return node.requirement.skill.name || node.title;
  return node.title || node.prompt || node.displayCode || node.id;
}

function nodeContainsImportedArtwork(node: WorkflowNode) {
  return (node.assets ?? []).some((asset) => (
    /^import-/i.test(String(asset.runId || "")) ||
    /[\\/]imports[\\/]/i.test(String(asset.path || "")) ||
    Boolean(asset.originalName || asset.importBatchId)
  ));
}

function workspaceAssetIdentity(node: WorkflowNode, assetIndex: number) {
  const asset = node.assets?.[assetIndex];
  if (!asset) return `${node.id}:${assetIndex}`;
  return String(
    asset.assetId
    || asset.contentHash
    || asset.assetUrl
    || asset.url
    || asset.path
    || `${node.id}:${assetIndex}`
  ).trim().toLowerCase();
}

type WorkspaceRailItem = {
  key: string;
  node: WorkflowNode;
  assetIndex?: number;
  groupAssetIndices?: number[];
  assetOrdinal?: number;
  assetTotal?: number;
  generating?: boolean;
};

type WorkspacePopoverAnchor = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function workspacePopoverAnchor(element: HTMLElement): WorkspacePopoverAnchor {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
}

function workspacePopoverPosition(anchor: WorkspacePopoverAnchor, width: number, maximumHeight: number) {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.max(8, Math.min(anchor.right + 10, viewportWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.top, viewportHeight - maximumHeight - 8));
  return { left, top };
}

function layerRailBadge(node: WorkflowNode) {
  if (node.layerGroup) return `${node.layerGroup.order}/${node.layerGroup.total}`;
  if (node.layerComposition) return `${node.layerComposition.layers.length}层`;
  return "";
}

function layerRailTitle(node: WorkflowNode, opensViewer: boolean) {
  if (node.layerGroup) {
    const action = opensViewer ? "双击打开分层查看器" : "在画布中右键查看和管理";
    const groupNumber = String(node.layerGroup.groupNumber ?? 0).padStart(3, "0");
    return `分层 PNG #${groupNumber} · 第 ${node.layerGroup.order}/${node.layerGroup.total} 层 · ${node.layerGroup.layerTitle || nodeRailLabel(node)}；${action}`;
  }
  if (node.layerComposition) {
    const action = opensViewer ? "双击打开图层编辑器" : "在画布中右键查看和管理";
    const groupNumber = String(node.layerComposition.groupNumber ?? 0).padStart(3, "0");
    return `分层 PNG #${groupNumber} · ${node.layerComposition.layers.length} 层；${action}`;
  }
  const action = opensViewer ? "双击打开图层" : "在画布中右键查看和管理";
  return `${nodeRailLabel(node)}；${action}`;
}

type WorkspaceSearchResult =
  | { kind: "node"; id: string; node: WorkflowNode; label: string; detail: string; searchText: string }
  | { kind: "conversation"; id: string; conversation: AgentConversation; label: string; detail: string; searchText: string };

function normalizedSearchText(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function workspaceNodeSearchText(node: WorkflowNode) {
  return normalizedSearchText([
    node.title,
    node.prompt,
    node.displayCode,
    node.requirement?.skill?.name,
    node.requirement?.skill?.description,
  ].filter(Boolean).join(" "));
}

function workspaceConversationSearchText(conversation: AgentConversation) {
  return normalizedSearchText([
    conversation.title,
    ...conversation.messages.slice(-8).map((message) => message.content),
  ].filter(Boolean).join(" "));
}

function workspaceSearchRank(label: string, searchText: string, query: string) {
  if (!query) return 0;
  const normalizedLabel = normalizedSearchText(label);
  if (normalizedLabel === query) return 0;
  if (normalizedLabel.startsWith(query)) return 1;
  return searchText.includes(query) ? 2 : 3;
}

export function WorkspaceSearch({
  projectContextView,
  nodes,
  conversations,
  activeConversationId,
  onSelectNode,
  onSelectConversation,
}: {
  projectContextView?: React.ReactNode;
  nodes: WorkflowNode[];
  conversations: AgentConversation[];
  activeConversationId: string;
  onSelectNode: (nodeId: string) => void;
  onSelectConversation: (conversationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = normalizedSearchText(query);
  const results = useMemo<WorkspaceSearchResult[]>(() => {
    const nodeResults = [...nodes]
      .reverse()
      .filter((node) => node.type === "image" || node.type === "requirement")
      .map((node) => ({
        kind: "node" as const,
        id: node.id,
        node,
        label: nodeRailLabel(node),
        detail: node.type === "requirement" ? "需求节点" : "图片成果",
        searchText: workspaceNodeSearchText(node),
      }))
      .filter((item) => workspaceSearchRank(item.label, item.searchText, normalizedQuery) < 3)
      .sort((left, right) => workspaceSearchRank(left.label, left.searchText, normalizedQuery) - workspaceSearchRank(right.label, right.searchText, normalizedQuery));
    const searchableConversations = conversations.some((conversation) => conversation.id === activeConversationId)
      ? [...conversations]
      : [{
          id: activeConversationId,
          title: "当前会话",
          messages: [],
          createdAt: "",
          updatedAt: new Date().toISOString(),
        }, ...conversations];
    const conversationResults = searchableConversations
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((conversation) => ({
        kind: "conversation" as const,
        id: conversation.id,
        conversation,
        label: conversation.title || "未命名会话",
        detail: conversation.id === activeConversationId ? "当前会话" : "历史会话",
        searchText: workspaceConversationSearchText(conversation),
      }))
      .filter((item) => workspaceSearchRank(item.label, item.searchText, normalizedQuery) < 3)
      .sort((left, right) => workspaceSearchRank(left.label, left.searchText, normalizedQuery) - workspaceSearchRank(right.label, right.searchText, normalizedQuery));
    return [...nodeResults.slice(0, 8), ...conversationResults.slice(0, 6)];
  }, [activeConversationId, conversations, nodes, normalizedQuery]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const choose = (result: WorkspaceSearchResult) => {
    setOpen(false);
    setQuery("");
    if (result.kind === "node") onSelectNode(result.id);
    else onSelectConversation(result.id);
  };

  return (
    <div ref={rootRef} className={`workspace-search ${open ? "is-open" : ""}`}>
      <ButtonBase
        type="button"
        className="workspace-search-trigger"
        aria-label="搜索当前项目"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="搜索图片、需求与会话（Ctrl/⌘ K）"
        onClick={() => setOpen((current) => !current)}
      >
        <Search size={14} />
        <span>搜索</span>
        <kbd>Ctrl K</kbd>
      </ButtonBase>
      {open ? (
        <section className="workspace-search-popover" role="dialog" aria-label="搜索当前项目">
          <header>
            <Search size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              placeholder="搜索图片、需求或会话"
              aria-label="搜索图片、需求或会话"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !results[0]) return;
                event.preventDefault();
                choose(results[0]);
              }}
            />
            <ButtonBase type="button" aria-label="关闭搜索" title="关闭搜索" onClick={() => setOpen(false)}>
              <X size={14} />
            </ButtonBase>
          </header>
          <div className="workspace-search-results" aria-live="polite">
            {results.map((result) => {
              const preview = result.kind === "node" && result.node.type === "image" ? nodePreview(result.node) : "";
              return (
                <ButtonBase
                  key={`${result.kind}:${result.id}`}
                  type="button"
                  className="workspace-search-result"
                  data-search-kind={result.kind}
                  data-search-id={result.id}
                  onClick={() => choose(result)}
                  title={result.label}
                >
                  <span className="workspace-search-result-icon">
                    {preview ? <img src={preview} alt="" draggable={false} /> : result.kind === "conversation" ? <History size={14} /> : result.node.type === "requirement" ? <WandSparkles size={14} /> : <ImageIcon size={14} />}
                  </span>
                  <span><strong>{result.label}</strong><small>{result.detail}</small></span>
                  {result.kind === "conversation" && result.id === activeConversationId ? <Check size={12} aria-label="当前会话" /> : null}
                </ButtonBase>
              );
            })}
            {results.length === 0 ? <p>没有匹配的图片、需求或会话</p> : null}
          </div>
          {projectContextView}
        </section>
      ) : null}
    </div>
  );
}

export function WorkspaceAssetRail({
  projectId = "",
  nodes,
  conversations,
  activeConversationId,
  selectedNodeId,
  requirementTemplates = [],
  requirementTemplatesLoading = false,
  canSaveRequirementTemplate = false,
  onSelectNode,
  onOpenLayer,
  onSelectConversation,
  onLoadRequirementTemplates,
  onUseRequirementTemplate,
  onSaveRequirementTemplate,
  onDeleteRequirementTemplate,
  onImport,
  onOpenSettings,
  settingsUpdateAvailable = false,
  visibleTabs = defaultVisibleRailTabs,
  requestedTab,
}: {
  projectId?: string;
  nodes: WorkflowNode[];
  conversations: AgentConversation[];
  activeConversationId: string;
  selectedNodeId: string;
  requirementTemplates?: WorkspaceRequirementTemplate[];
  requirementTemplatesLoading?: boolean;
  canSaveRequirementTemplate?: boolean;
  onSelectNode: (nodeId: string) => void;
  onOpenLayer?: (nodeId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onLoadRequirementTemplates?: (force?: boolean) => void;
  onUseRequirementTemplate?: (templateId: string, options?: RequirementTemplateUseOptions) => Promise<unknown>;
  onSaveRequirementTemplate?: () => void;
  onDeleteRequirementTemplate?: (templateId: string) => void;
  onImport: () => void;
  onOpenSettings: () => void;
  settingsUpdateAvailable?: boolean;
  visibleTabs?: WorkspaceAssetRailTab[];
  requestedTab?: { tab: WorkspaceAssetRailTab; nonce: number };
}) {
  const [selectedTab, setSelectedTab] = useState<WorkspaceAssetRailTab>("results");
  const [deleteArmedTemplateId, setDeleteArmedTemplateId] = useState("");
  const [templateDialog, setTemplateDialog] = useState<{ id: string; mode: "use" | "edit" } | null>(null);
  const [templateActionError, setTemplateActionError] = useState("");
  const [templateImportBusy, setTemplateImportBusy] = useState(false);
  const [assetGroupPreview, setAssetGroupPreview] = useState<{
    nodeId: string;
    anchor: WorkspacePopoverAnchor;
    locked: boolean;
  } | null>(null);
  const assetGroupPreviewTimerRef = useRef<number | null>(null);
  const loadRequirementTemplatesRef = useRef(onLoadRequirementTemplates);
  loadRequirementTemplatesRef.current = onLoadRequirementTemplates;
  const visibleRailTabs = useMemo(() => {
    const visible = new Set(visibleTabs);
    if (requestedTab?.tab === "templates") visible.add("templates");
    const filtered = railTabs.filter((item) => visible.has(item.id));
    // History now lives in Agent. Legacy history-only rail preferences keep results accessible.
    return filtered.length ? filtered : railTabs.slice(0, 1);
  }, [visibleTabs, requestedTab?.tab]);
  const tab = visibleRailTabs.some((item) => item.id === selectedTab)
    ? selectedTab
    : visibleRailTabs[0].id;
  useEffect(() => { setTemplateDialog(null); setTemplateActionError(""); }, [projectId]);

  async function importTemplate() {
    if (templateImportBusy) return;
    setTemplateImportBusy(true); setTemplateActionError("");
    try {
      const result = await window.naimageConfig?.importRequirementLibraryEntry?.();
      if (!result?.ok) throw new Error(result?.error || "无法导入模板。");
      if (!result.canceled) onLoadRequirementTemplates?.(true);
    } catch (error) { setTemplateActionError(error instanceof Error ? error.message : String(error)); }
    finally { setTemplateImportBusy(false); }
  }

  useEffect(() => {
    if (!assetGroupPreview) return undefined;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-asset-group-trigger], [data-asset-group-preview]")) return;
      setAssetGroupPreview(null);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAssetGroupPreview(null);
    };
    const closeOnResize = () => {
      setAssetGroupPreview(null);
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeWithEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeWithEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [assetGroupPreview]);

  useEffect(() => () => {
    if (assetGroupPreviewTimerRef.current !== null) window.clearTimeout(assetGroupPreviewTimerRef.current);
  }, []);

  const cancelAssetGroupPreviewClose = () => {
    if (assetGroupPreviewTimerRef.current === null) return;
    window.clearTimeout(assetGroupPreviewTimerRef.current);
    assetGroupPreviewTimerRef.current = null;
  };
  const scheduleAssetGroupPreviewClose = () => {
    cancelAssetGroupPreviewClose();
    assetGroupPreviewTimerRef.current = window.setTimeout(() => {
      setAssetGroupPreview((current) => current?.locked ? current : null);
      assetGroupPreviewTimerRef.current = null;
    }, 140);
  };

  useEffect(() => {
    if (selectedTab !== tab) setSelectedTab(tab);
  }, [selectedTab, tab]);

  useEffect(() => {
    if (tab === "templates") loadRequirementTemplatesRef.current?.();
    else setDeleteArmedTemplateId("");
  }, [tab]);

  useEffect(() => {
    if (!requestedTab || !visibleRailTabs.some((item) => item.id === requestedTab.tab)) return;
    setSelectedTab(requestedTab.tab);
  }, [requestedTab?.nonce, requestedTab?.tab, visibleRailTabs]);

  const nodeItems = useMemo<WorkspaceRailItem[]>(() => {
    if (tab === "templates" || tab === "history") return [];
    if (tab === "layers") {
      return [...nodes]
        .reverse()
        .filter((node) => Boolean(node.layerGroup || node.layerComposition))
        .slice(0, 40)
        .map((node) => ({ key: node.id, node }));
    }
    if (tab === "requirements") {
      return [...nodes]
        .reverse()
        .filter((node) => node.type === "requirement")
        .slice(0, 40)
        .map((node) => ({ key: node.id, node }));
    }
    const seenAssetKeys = new Set<string>();
    return [...nodes]
      .reverse()
      .filter((node) => node.type === "image" && ((node.assets?.length ?? 0) > 0 || node.imageState === "generating"))
      .flatMap((node) => {
        const assetTotal = Math.max(1, ...[
          node.assets?.length ?? 0,
          Number(node.imageProgress?.total ?? 0),
          Number(node.imageParams?.count ?? 0),
        ].filter(Number.isFinite));
        const groupAssetIndices = (node.assets ?? []).flatMap((asset, assetIndex): number[] => {
          if (asset.status === "error" || asset.status === "pending") return [];
          const assetKey = workspaceAssetIdentity(node, assetIndex);
          if (seenAssetKeys.has(assetKey)) return [];
          seenAssetKeys.add(assetKey);
          return [assetIndex];
        });
        if (!groupAssetIndices.length && node.imageState !== "generating") return [];
        const requestedActiveIndex = Number(node.imageProgress?.activeIndex ?? groupAssetIndices.length + 1);
        const activeIndex = Math.max(0, Math.min(assetTotal - 1, Number.isFinite(requestedActiveIndex) ? requestedActiveIndex - 1 : groupAssetIndices.length));
        const previewIndex = groupAssetIndices[0] ?? activeIndex;
        return [{
          key: `${node.id}:result-group`,
          node,
          assetIndex: previewIndex,
          groupAssetIndices,
          assetOrdinal: previewIndex + 1,
          assetTotal,
          generating: node.imageState === "generating",
        }];
      })
      .slice(0, 80);
  }, [nodes, tab]);
  const historyItems = useMemo(() => {
    const items = [...conversations].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    if (!items.some((item) => item.id === activeConversationId)) {
      items.unshift({
        id: activeConversationId,
        title: "当前会话",
        messages: [],
        createdAt: "",
        updatedAt: new Date().toISOString(),
      });
    }
    return items.slice(0, 40);
  }, [activeConversationId, conversations]);

  const previewNode = assetGroupPreview
    ? nodes.find((node) => node.id === assetGroupPreview.nodeId)
    : undefined;
  const previewAssetIndices = previewNode
    ? (previewNode.assets ?? []).flatMap((asset, index) => asset.status === "error" || asset.status === "pending" ? [] : [index])
    : [];

  return (
    <>
    <aside className="workspace-asset-rail" aria-label="项目素材与导航" data-active-tab={tab}>
      <header className="workspace-asset-rail-header">
        <IconActionButton
          label="添加图片素材"
          icon={<Plus size={17} />}
          onClick={onImport}
          title="导入图片素材"
        />
      </header>

      <nav className="workspace-asset-rail-tabs" aria-label="素材视图">
        {visibleRailTabs.map((item) => (
          <IconActionButton
            key={item.id}
            label={item.label}
            icon={item.icon}
            className={tab === item.id ? "active" : ""}
            aria-pressed={tab === item.id}
            title={item.title || item.label}
            onClick={() => setSelectedTab(item.id)}
          />
        ))}
      </nav>

      <div className="workspace-asset-rail-list" aria-live="polite">
        {tab === "layers" && nodeItems.length > 0 ? (
          <div className="workspace-asset-rail-note" role="note" tabIndex={0} aria-label="分层成果，画布右键可管理"
            data-ui-tooltip="这里只显示真实分层 PNG；可在画布中右键显隐、合并或导出。">
            <Layers3 size={16} />
          </div>
        ) : null}
        {tab === "templates" ? (
          <div
            className="workspace-asset-rail-note"
            role="note"
            tabIndex={0}
            aria-label={canSaveRequirementTemplate ? "可以保存当前方法" : "模板保存说明"}
            data-ui-tooltip={canSaveRequirementTemplate
              ? "保存选中的需求或当前成功任务的方法；使用模板时重新选择本项目素材。"
              : "先选择需求或完成一次创作任务，再保存模板；已有模板可编辑变量并跨项目复用。"}
          >
            <BookMarked size={16} />
          </div>
        ) : null}
        {tab === "templates" ? <>
          <IconActionButton label="保存当前需求到模板库" icon={<Save size={16} />} className="workspace-asset-rail-template-import"
            onClick={onSaveRequirementTemplate} disabled={!canSaveRequirementTemplate}
            title={canSaveRequirementTemplate ? "保存选中的需求，或保存当前成功任务的方法" : "请选择需求节点，或完成并保存一次创作任务"} />
          <IconActionButton label="导入创作模板" icon={templateImportBusy ? <Loader2 className="spin" size={16} /> : <Import size={16} />}
            className="workspace-asset-rail-template-import" title="从本机文件导入可复用创作模板" disabled={templateImportBusy} onClick={() => { void importTemplate(); }} />
          {templateActionError ? <p className="workspace-asset-rail-template-error" role="alert" title={templateActionError}>{templateActionError}</p> : null}
        </> : null}
        {tab === "templates" ? (
          requirementTemplatesLoading ? (
            <span className="workspace-asset-rail-template-loading" title="正在读取本机需求模板库"><Loader2 className="spin" size={16} /></span>
          ) : requirementTemplates.length ? requirementTemplates.slice(0, 200).map((template) => {
            const deleteArmed = deleteArmedTemplateId === template.id;
            const label = template.skill?.name || template.title;
            return (
              <div key={template.id} className="workspace-asset-rail-template">
                <ButtonBase
                  type="button"
                  className="workspace-asset-rail-item workspace-asset-rail-template-use"
                  data-template-id={template.id}
                  aria-label={`使用需求模板：${label}`}
                  title={`${label} · 点击插入当前画布，不会自动执行或扣费`}
                  onClick={() => {
                    setTemplateActionError("");
                    if (template.template?.variables.length) { setTemplateDialog({ id: template.id, mode: "use" }); return; }
                    void onUseRequirementTemplate?.(template.id).catch(error => setTemplateActionError(error instanceof Error ? error.message : String(error)));
                  }}
                >
                  {template.skill ? <BookMarked size={16} /> : <WandSparkles size={16} />}
                  <span className="workspace-asset-rail-template-mark">{label.trim().slice(0, 1) || "需"}</span>
                </ButtonBase>
                <ButtonBase type="button" className="workspace-asset-rail-template-edit" data-template-edit={template.id} aria-label={`编辑需求模板：${label}`} title="编辑要求和变量；导出模板" onClick={() => setTemplateDialog({ id: template.id, mode: "edit" })}>
                  <Pencil size={9} />
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className={`workspace-asset-rail-template-delete ${deleteArmed ? "is-armed" : ""}`}
                  aria-label={deleteArmed ? `确认删除需求模板：${label}` : `删除需求模板：${label}`}
                  title={deleteArmed ? "再次点击确认删除" : "删除模板"}
                  onClick={() => {
                    if (!deleteArmed) {
                      setDeleteArmedTemplateId(template.id);
                      return;
                    }
                    setDeleteArmedTemplateId("");
                    onDeleteRequirementTemplate?.(template.id);
                  }}
                >
                  <Trash2 size={9} />
                </ButtonBase>
              </div>
            );
          }) : (
            <div className="workspace-asset-rail-empty is-explained" role="note" tabIndex={0} aria-label="暂无模板"
              data-ui-tooltip="暂无模板。选择需求或完成创作任务后保存模板，也可以导入模板文件；使用模板只插入需求。">
              <BookMarked size={16} />
            </div>
          )
        ) : tab === "history" ? historyItems.map((conversation) => (
          <ButtonBase
            key={conversation.id}
            type="button"
            className={`workspace-asset-rail-item history-item ${conversation.id === activeConversationId ? "active" : ""}`}
            aria-label={`切换会话：${conversation.title || "未命名会话"}`}
            title={conversation.title || "未命名会话"}
            onClick={() => onSelectConversation(conversation.id)}
          >
            <History size={14} />
            {conversation.id === activeConversationId ? <Check className="workspace-asset-rail-check" size={10} /> : null}
          </ButtonBase>
        )) : nodeItems.map((item) => {
          const node = item.node;
          const preview = nodePreview(node, item.assetIndex);
          const active = selectedNodeId === node.id;
          const layerBadge = tab === "layers" ? layerRailBadge(node) : "";
          const resultGroupCount = tab === "results" ? Math.max(item.groupAssetIndices?.length ?? 0, item.assetTotal ?? 0) : 0;
          const resultIsGroup = resultGroupCount > 1;
          const resultIsOriginal = tab === "results" && (node.imageContainerRole === "source" || nodeContainsImportedArtwork(node));
          const resultBadge = resultIsGroup ? `组 ${resultGroupCount}` : resultIsOriginal ? "原" : "";
          const title = tab === "results"
            ? `${nodeRailLabel(node)} · ${resultIsGroup ? `${resultIsOriginal ? "原图组" : "图片组"} ${resultGroupCount} 张` : resultIsOriginal ? "原图" : "图片成果"}${item.generating ? " · 生成中" : ""}`
            : tab === "layers"
              ? layerRailTitle(node, Boolean(onOpenLayer))
              : nodeRailLabel(node);
          return (
            <ButtonBase
              key={item.key}
              type="button"
              className={`workspace-asset-rail-item ${active ? "active" : ""}`}
              data-node-id={node.id}
              data-asset-index={tab === "results" ? item.assetIndex : undefined}
              data-asset-group-trigger={resultIsGroup ? node.id : undefined}
              aria-label={`定位${tab === "layers" ? "图层" : tab === "requirements" ? "需求" : "成果"}：${nodeRailLabel(node)}`}
              title={title}
              onMouseEnter={resultIsGroup ? (event) => {
                cancelAssetGroupPreviewClose();
                setAssetGroupPreview({ nodeId: node.id, anchor: workspacePopoverAnchor(event.currentTarget), locked: false });
              } : undefined}
              onMouseLeave={resultIsGroup ? scheduleAssetGroupPreviewClose : undefined}
              onClick={(event) => {
                onSelectNode(node.id);
                if (!resultIsGroup) return;
                cancelAssetGroupPreviewClose();
                setAssetGroupPreview({ nodeId: node.id, anchor: workspacePopoverAnchor(event.currentTarget), locked: true });
              }}
              onDoubleClick={tab === "layers" && onOpenLayer ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenLayer(node.id);
              } : undefined}
            >
              {preview ? <img src={preview} alt="" draggable={false} loading="lazy" decoding="async" /> : tab === "requirements" ? <WandSparkles size={15} /> : tab === "layers" ? <Layers3 size={15} /> : <ImageIcon size={15} />}
              {layerBadge ? <span className="workspace-asset-rail-layer-index">{layerBadge}</span> : null}
              {resultBadge ? <span className={`workspace-asset-rail-kind ${resultIsGroup ? "is-group" : "is-original"}`}>{resultBadge}</span> : null}
              {item.generating ? <Loader2 className="workspace-asset-rail-generating spin" size={11} aria-label="生成中" /> : null}
              {active ? <Check className="workspace-asset-rail-check" size={10} /> : null}
            </ButtonBase>
          );
        })}
        {tab !== "history" && tab !== "templates" && nodeItems.length === 0 ? (
          tab === "layers" ? (
            <div className="workspace-asset-rail-empty is-explained" role="note" tabIndex={0} aria-label="暂无分层"
              data-ui-tooltip="普通图片没有独立图层；使用分层生图后会在这里显示。">
              <Layers3 size={16} />
            </div>
          ) : <span className="workspace-asset-rail-empty" title="当前项目暂无对应内容">—</span>
        ) : null}
      </div>

      <footer className="workspace-asset-rail-footer">
        <IconActionButton id="workspace-settings-trigger" label={settingsUpdateAvailable ? "打开设置，发现新版本" : "打开设置"}
          icon={<><Settings size={16} />{settingsUpdateAvailable ? <i className="workspace-settings-update-dot" aria-hidden="true" /> : null}</>}
          onClick={onOpenSettings} title={settingsUpdateAvailable ? "发现新版本，打开设置查看更新" : "设置与界面主题"} />
      </footer>
    </aside>
    {templateDialog && onUseRequirementTemplate ? <React.Suspense fallback={null}>
      <LazyRequirementTemplateDialog templateId={templateDialog.id} mode={templateDialog.mode} projectId={projectId} nodes={nodes} selectedNodeId={selectedNodeId}
        onClose={() => setTemplateDialog(null)} onChanged={() => onLoadRequirementTemplates?.(true)} onUse={onUseRequirementTemplate} />
    </React.Suspense> : null}
    {assetGroupPreview && previewNode && previewAssetIndices.length > 1 && typeof document !== "undefined" ? createPortal((
      <section
        className="workspace-asset-group-preview"
        data-asset-group-preview
        aria-label={`${nodeRailLabel(previewNode)}图片组预览`}
        style={workspacePopoverPosition(assetGroupPreview.anchor, 304, 430)}
        onMouseEnter={cancelAssetGroupPreviewClose}
        onMouseLeave={scheduleAssetGroupPreviewClose}
      >
        <header>
          <span><strong>{nodeContainsImportedArtwork(previewNode) ? "原图组" : "图片组"}</strong><small>{previewAssetIndices.length} 张 · {nodeRailLabel(previewNode)}</small></span>
          <ButtonBase type="button" aria-label="关闭图片组预览" title="关闭" onClick={() => setAssetGroupPreview(null)}><X size={14} /></ButtonBase>
        </header>
        <div className="workspace-asset-group-preview-grid">
          {previewAssetIndices.slice(0, 12).map((assetIndex, ordinal) => (
            <ButtonBase
              key={`${previewNode.id}:${assetIndex}`}
              type="button"
              data-node-id={previewNode.id}
              data-asset-index={assetIndex}
              aria-label={`定位图片 ${ordinal + 1}`}
              title={`图片 ${ordinal + 1}/${previewAssetIndices.length}`}
              onClick={() => onSelectNode(previewNode.id)}
            >
              <img src={nodePreview(previewNode, assetIndex)} alt="" draggable={false} loading="lazy" decoding="async" />
              <span>{ordinal + 1}</span>
            </ButtonBase>
          ))}
          {previewAssetIndices.length > 12 ? <span className="workspace-asset-group-preview-more">+{previewAssetIndices.length - 12}</span> : null}
        </div>
      </section>
    ), document.body) : null}
    </>
  );
}

export function WorkspaceTaskContext({
  node,
}: {
  node: WorkflowNode | null;
}) {
  return (
    <section className="workspace-task-context" aria-label="当前任务">
      <span>当前任务</span>
      <strong>{node ? nodeRailLabel(node) : "画布"}</strong>
      <small>{node?.prompt || "查看素材、关系与 Agent 进度"}</small>
    </section>
  );
}
