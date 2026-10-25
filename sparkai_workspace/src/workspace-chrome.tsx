import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  Check,
  ChevronDown,
  Focus,
  Grid2X2,
  History,
  ImageIcon,
  Images,
  Import,
  Layers3,
  Loader2,
  Microscope,
  Pencil,
  Plus,
  Search,
  Save,
  Share2,
  Settings,
  ShoppingBag,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

import {
  imageAssetSrc,
  imageAssetThumbnailSrc,
  type AgentConversation,
  type WorkflowNode,
  type WorkspaceDomain,
} from "./core";
import { ButtonBase, IconActionButton, MenuItem, MenuSurface } from "./ui";
import { workspaceDomainDefinition, workspaceDomainDefinitions } from "./workspace-domain.ts";
import type { RequirementTemplate } from "../runtime/requirement-template-contract.mjs";
import type { RequirementTemplateUseOptions } from "./requirement-template-dialog";

const LazyRequirementTemplateDialog = React.lazy(() => import("./requirement-template-dialog"));

export type WorkspaceViewMode = "workbench" | "focus" | "review";
export type WorkspaceAssetRailTab = "results" | "layers" | "requirements" | "templates" | "history";

export type WorkspaceDomainTool = {
  command: string;
  label: string;
  description: string;
  icon: "images" | "languages" | "workflow" | "microscope" | "boxes" | "package-check" | "book-marked" | "columns-2";
  shortcut?: string;
  when?: "canvas.has-image-selection";
  availableDuringAgentRun?: boolean;
};

export type WorkspaceRequirementTemplate = {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  skill?: { name?: string; description?: string };
  socialPlan?: { platform?: "xiaohongshu" | "douyin" };
  template?: RequirementTemplate;
};

const workspaceViewModes: Array<{
  id: WorkspaceViewMode;
  label: string;
  title: string;
  icon: React.ReactNode;
}> = [
  { id: "workbench", label: "画布", title: "查看完整画布关系", icon: <Grid2X2 size={14} /> },
  { id: "focus", label: "专注", title: "专注查看当前图片成果", icon: <Focus size={14} /> },
  { id: "review", label: "评审", title: "并排评审最近四个图片成果", icon: <Images size={14} /> },
];

const railTabs: Array<{
  id: WorkspaceAssetRailTab;
  label: string;
  title?: string;
  icon: React.ReactNode;
}> = [
  { id: "results", label: "成果", icon: <Images size={15} /> },
  { id: "layers", label: "图层", title: "分层图片：定位、查看、合并与导出", icon: <Layers3 size={15} /> },
  { id: "requirements", label: "需求", icon: <WandSparkles size={15} /> },
  { id: "templates", label: "模板", title: "跨项目复用的本机需求模板库", icon: <BookMarked size={15} /> },
];
const defaultVisibleRailTabs = railTabs.map((item) => item.id);
const FOCUS_ASSET_MOUNT_LIMIT = 80;

function nodePreview(node: WorkflowNode | null | undefined, assetIndex?: number) {
  const asset = assetIndex === undefined
    ? node?.assets?.find((item) => item.status !== "error") ?? node?.assets?.[0]
    : node?.assets?.[assetIndex];
  return asset ? imageAssetThumbnailSrc(asset, 256) : "";
}

function nodeArtwork(node: WorkflowNode | null | undefined, maxEdge?: number) {
  const asset = node?.assets?.find((item) => item.status !== "error") ?? node?.assets?.[0];
  if (!asset) return "";
  return maxEdge ? imageAssetThumbnailSrc(asset, maxEdge) : imageAssetSrc(asset);
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

function workspaceDomainIcon(icon: string, size = 15) {
  if (icon === "shopping-bag") return <ShoppingBag size={size} />;
  if (icon === "share-2") return <Share2 size={size} />;
  if (icon === "microscope") return <Microscope size={size} />;
  return <Sparkles size={size} />;
}

export function WorkspaceDomainSwitcher({
  domain,
  onChange,
}: {
  domain: WorkspaceDomain;
  onChange: (domain: WorkspaceDomain) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = workspaceDomainDefinition(domain);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node | null)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`workspace-domain-switcher ${open ? "is-open" : ""}`}>
      <ButtonBase
        type="button"
        className="workspace-domain-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${current.description}（Ctrl/Cmd + ${workspaceDomainDefinitions.findIndex((item) => item.id === current.id) + 1}）`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-domain-switcher-icon" aria-hidden="true">{workspaceDomainIcon(current.icon)}</span>
        <span>{current.title}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </ButtonBase>
      {open ? (
        <div className="workspace-domain-menu" role="menu" aria-label="切换工作台">
          {workspaceDomainDefinitions.map((item, index) => (
            <ButtonBase
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === current.id}
              aria-keyshortcuts={`Control+${index + 1} Meta+${index + 1}`}
              title={`${item.description}（Ctrl/Cmd + ${index + 1}）`}
              className={item.id === current.id ? "is-active" : ""}
              onClick={() => {
                setOpen(false);
                if (item.id !== current.id) onChange(item.id);
              }}
            >
              <span className="workspace-domain-menu-icon" aria-hidden="true">{workspaceDomainIcon(item.icon, 17)}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              {item.id === current.id ? <Check size={14} aria-hidden="true" /> : null}
            </ButtonBase>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceDirectionSwitcher({
  mode,
  onChange,
}: {
  mode: WorkspaceViewMode;
  onChange: (mode: WorkspaceViewMode) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const triggerId = useId();
  const current = workspaceViewModes.find((item) => item.id === mode) ?? workspaceViewModes[0];
  return (
    <nav className="workspace-direction-switcher" aria-label="画布视图">
      <ButtonBase id={triggerId} type="button" className="workspace-view-trigger" aria-label={`画布视图：${current.label}`} aria-haspopup="menu" aria-expanded={Boolean(menu)}
        title={current.title} onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: rect.left, y: rect.bottom + 6 });
        }}>
        <span>{current.label}</span><ChevronDown size={14} aria-hidden="true" />
      </ButtonBase>
      {menu ? <MenuSurface {...menu} triggerId={triggerId} className="workspace-view-menu" ariaLabel="画布视图" onRequestClose={() => setMenu(null)}>
        {workspaceViewModes.map((item) => <MenuItem key={item.id} icon={item.icon} title={item.title} aria-current={mode === item.id ? "true" : undefined}
          onClick={() => { setMenu(null); onChange(item.id); }}>{item.label}{mode === item.id ? <Check size={14} aria-hidden="true" /> : null}</MenuItem>)}
      </MenuSurface> : null}
    </nav>
  );
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
  workspaceDomain?: WorkspaceDomain;
  domainTools?: WorkspaceDomainTool[];
  domainToolsLoading?: boolean;
  domainToolExecutionBusy?: boolean;
  domainToolHasImageSelection?: boolean;
  onExecuteDomainTool?: (command: string) => void;
  onOpenDomainToolsSettings?: () => void;
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
    const filtered = railTabs.filter((item) => visible.has(item.id));
    // History now lives in Agent. Legacy history-only rail preferences keep results accessible.
    return filtered.length ? filtered : railTabs.slice(0, 1);
  }, [visibleTabs]);
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
  mode,
  node,
}: {
  mode: WorkspaceViewMode;
  node: WorkflowNode | null;
}) {
  const modeLabel = workspaceViewModes.find((item) => item.id === mode)?.label ?? "画布";
  return (
    <section className="workspace-task-context" aria-label="当前任务">
      <span>当前任务</span>
      <strong>{node ? nodeRailLabel(node) : modeLabel}</strong>
      <small>{node?.prompt || (mode === "workbench" ? "查看素材、关系与 Agent 进度" : mode === "focus" ? "连续查看当前图片成果" : "并排比较最近图片成果")}</small>
    </section>
  );
}

function orderedImageNodes(nodes: WorkflowNode[], selectedNodeId: string) {
  const images = [...nodes].reverse().filter((node) => node.type === "image" && (node.assets?.length ?? 0) > 0);
  const selected = images.find((node) => node.id === selectedNodeId);
  return selected ? [selected, ...images.filter((node) => node.id !== selected.id)] : images;
}

type WorkspaceFocusAsset = {
  key: string;
  group: "original" | "generated";
  node: WorkflowNode;
  assetIndex: number;
  label: string;
  source: string;
  thumbnail: string;
};

function focusAssetsForNode(node: WorkflowNode, group: WorkspaceFocusAsset["group"]): WorkspaceFocusAsset[] {
  return (node.assets ?? []).flatMap((asset, assetIndex) => {
    const source = asset.status === "error" ? "" : imageAssetSrc(asset);
    if (!source) return [];
    const collectionItem = node.imageCollection?.items.find((item) => item.assetIndex === assetIndex + 1)
      ?? node.imageCollection?.items[assetIndex];
    return [{
      key: `${node.id}:${assetIndex}`,
      group,
      node,
      assetIndex,
      label: collectionItem?.title || asset.title || `${nodeRailLabel(node)} · ${assetIndex + 1}`,
      source,
      thumbnail: imageAssetThumbnailSrc(asset, 256),
    }];
  });
}

function focusAssetGroupForNode(imageNodes: WorkflowNode[], selected: WorkflowNode) {
  const explicitSourceId = selected.imageCollection?.sourceNodeId
    || selected.taskProvenance?.sourceNodeId
    || selected.parentId
    || "";
  const explicitSource = explicitSourceId
    ? imageNodes.find((node) => node.id === explicitSourceId) ?? null
    : null;
  const sourceNode = explicitSource || (selected.imageContainerRole === "source" ? selected : null);
  const relationSourceId = sourceNode?.id || selected.id;
  const relatedGeneratedNodes = imageNodes.filter((node) => node.id !== relationSourceId && (
    node.parentId === relationSourceId
    || node.imageCollection?.sourceNodeId === relationSourceId
    || node.taskProvenance?.sourceNodeId === relationSourceId
  ));
  if (selected.id !== relationSourceId && !relatedGeneratedNodes.some((node) => node.id === selected.id)) {
    relatedGeneratedNodes.unshift(selected);
  }

  let original = sourceNode ? focusAssetsForNode(sourceNode, "original") : [];
  let generated = relatedGeneratedNodes.flatMap((node) => focusAssetsForNode(node, "generated"));

  if (!sourceNode && selected.imageCollection) {
    generated = focusAssetsForNode(selected, "generated");
  } else if (!generated.length && selected === sourceNode && !selected.imageContainer && Number(selected.imageParams?.count || 0) > 1) {
    const entries = focusAssetsForNode(selected, "original");
    original = entries.slice(0, 1);
    generated = entries.slice(1).map((item) => ({ ...item, group: "generated" as const }));
  }

  if (!original.length && !generated.length) original = focusAssetsForNode(selected, "original");
  return { original, generated };
}

function uniqueFocusAssets(items: WorkspaceFocusAsset[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = workspaceAssetIdentity(item.node, item.assetIndex) || item.source;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function focusAssetGroups(nodes: WorkflowNode[], selectedNodeId: string, selectedNodeIds: string[]) {
  const imageNodes = nodes.filter((node) => node.type === "image" && (node.assets?.length ?? 0) > 0);
  const selectedIdSet = new Set(selectedNodeIds.filter(Boolean));
  const selectedNodes = selectedNodeIds
    .map((nodeId) => imageNodes.find((node) => node.id === nodeId) ?? null)
    .filter((node): node is WorkflowNode => Boolean(node));
  const primary = imageNodes.find((node) => node.id === selectedNodeId) ?? [...imageNodes].reverse()[0] ?? null;
  if (!selectedNodes.length && primary) selectedNodes.push(primary);
  if (!selectedNodes.length) {
    return { original: [] as WorkspaceFocusAsset[], generated: [] as WorkspaceFocusAsset[], originalTotal: 0, generatedTotal: 0, selectedCount: 0 };
  }
  if (primary && selectedIdSet.has(primary.id)) {
    selectedNodes.sort((left, right) => left.id === primary.id ? -1 : right.id === primary.id ? 1 : 0);
  }
  const combined = selectedNodes.map((node) => focusAssetGroupForNode(imageNodes, node));
  const original = uniqueFocusAssets(combined.flatMap((group) => group.original));
  const generated = uniqueFocusAssets(combined.flatMap((group) => group.generated));
  return {
    original: original.slice(0, FOCUS_ASSET_MOUNT_LIMIT),
    generated: generated.slice(0, FOCUS_ASSET_MOUNT_LIMIT),
    originalTotal: original.length,
    generatedTotal: generated.length,
    selectedCount: selectedNodes.length,
  };
}

export function WorkspaceFocusStage({
  nodes,
  selectedNodeId,
  selectedNodeIds = [],
  onSelectNode,
  onOpenNode,
  onContinueNode,
}: {
  nodes: WorkflowNode[];
  selectedNodeId: string;
  selectedNodeIds?: string[];
  onSelectNode: (nodeId: string) => void;
  onOpenNode: (nodeId: string, assetIndex?: number) => void;
  onContinueNode: (nodeId: string) => void;
}) {
  const selectedNodeIdsKey = selectedNodeIds.join("\n");
  const groups = useMemo(() => focusAssetGroups(nodes, selectedNodeId, selectedNodeIds), [nodes, selectedNodeId, selectedNodeIdsKey]);
  const entries = useMemo(() => [...groups.original, ...groups.generated], [groups.original, groups.generated]);
  const selectedEntry = entries.find((item) => item.node.id === selectedNodeId) ?? entries[0] ?? null;
  const [activeKey, setActiveKey] = useState(selectedEntry?.key || "");
  const active = entries.find((item) => item.key === activeKey) ?? selectedEntry;

  useEffect(() => {
    if (!entries.length) {
      if (activeKey) setActiveKey("");
      return;
    }
    if (!entries.some((item) => item.key === activeKey)) setActiveKey(selectedEntry?.key || entries[0].key);
  }, [activeKey, entries, selectedEntry?.key]);

  function choose(item: WorkspaceFocusAsset) {
    setActiveKey(item.key);
    if (groups.selectedCount <= 1) onSelectNode(item.node.id);
  }

  function renderGroup(title: string, group: WorkspaceFocusAsset["group"], items: WorkspaceFocusAsset[], total: number) {
    return (
      <section className={`workspace-focus-group is-${group}`} aria-label={title}>
        <header>
          <strong>{title}</strong>
          <small>{items.length ? `${total > items.length ? `${items.length}/${total}` : items.length} 张 · 点击切换` : "暂无图片"}</small>
        </header>
        <div className="workspace-focus-group-items">
          {items.map((item, index) => (
            <ButtonBase
              key={item.key}
              type="button"
              className={item.key === active?.key ? "active" : ""}
              aria-pressed={item.key === active?.key}
              onClick={() => choose(item)}
              onDoubleClick={() => onOpenNode(item.node.id, item.assetIndex)}
              title={`${item.label} · 单击切换，双击查看大图`}
              aria-label={`${title} ${index + 1}：${item.label}`}
            >
              <img src={item.thumbnail} alt="" draggable={false} loading="lazy" decoding="async" />
              <span>{String(index + 1).padStart(2, "0")}</span>
            </ButtonBase>
          ))}
          {!items.length ? (
            <div className="workspace-focus-group-empty">
              {group === "generated" ? "生成完成后会自动显示在这里" : "当前成果没有可识别的原图"}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-focus-stage" aria-label="专注画布">
      {active ? (
        <ButtonBase
          type="button"
          className="workspace-focus-card"
          onClick={() => onOpenNode(active.node.id, active.assetIndex)}
          aria-label={`查看大图：${active.label}`}
        >
          <img src={active.source} alt={active.label} draggable={false} decoding="async" />
          <span>
            <strong>{active.group === "original" ? "原图" : "生成图片组"} · {active.label}</strong>
            <small>{groups.selectedCount > 1 ? `已选 ${groups.selectedCount} 个图片节点 · 下方切换不会取消多选` : "点击查看大图 · 下方缩略图可直接切换"}</small>
          </span>
        </ButtonBase>
      ) : (
        <div className="workspace-mode-empty"><ImageIcon size={22} /><span>选择一个图片成果；原图和生成图片组会在下方分栏显示</span></div>
      )}
      <div className="workspace-focus-groups" aria-label="原图与生成图片组">
        {renderGroup("原图", "original", groups.original, groups.originalTotal)}
        {renderGroup("生成图片组", "generated", groups.generated, groups.generatedTotal)}
        <ButtonBase
          type="button"
          className="workspace-focus-add"
          disabled={!active}
          onClick={() => active && onContinueNode(active.node.id)}
          title="在成果编辑器中确认提示词后继续生成"
          aria-label="继续生成版本；先打开成果编辑器，不会立即生成"
        >
          <Plus size={17} />
          <span>继续生成</span>
        </ButtonBase>
      </div>
    </section>
  );
}

export function WorkspaceReviewGrid({
  nodes,
  selectedNodeId,
  onSelectNode,
  onOpenNode,
}: {
  nodes: WorkflowNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const images = useMemo(() => orderedImageNodes(nodes, selectedNodeId).slice(0, 4), [nodes, selectedNodeId]);
  return (
    <section className="workspace-review-grid" aria-label="版本评审">
      {images.map((node, index) => {
        const preview = nodeArtwork(node, 1024);
        return (
          <article key={node.id} className={`workspace-review-card ${node.id === selectedNodeId ? "active" : ""}`}>
            <ButtonBase
              type="button"
              data-node-id={node.id}
              aria-pressed={node.id === selectedNodeId}
              aria-label={`${node.id === selectedNodeId ? "当前方向" : "选择方向"}：${nodeRailLabel(node)}`}
              title={node.id === selectedNodeId ? "当前方向；双击查看大图" : "选择这个方向；双击查看大图"}
              onClick={() => onSelectNode(node.id)}
              onDoubleClick={() => onOpenNode(node.id)}
            >
              {preview ? <img src={preview} alt={nodeRailLabel(node)} draggable={false} decoding="async" /> : <ImageIcon size={20} />}
              <span><strong>{nodeRailLabel(node)}</strong><small>{node.id === selectedNodeId ? "当前方向" : "选择方向"} · V{index + 1}</small></span>
            </ButtonBase>
          </article>
        );
      })}
      {images.length === 0 ? <div className="workspace-mode-empty"><Images size={22} /><span>当前项目暂无可评审的图片成果</span></div> : null}
    </section>
  );
}
