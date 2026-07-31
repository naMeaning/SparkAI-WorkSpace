import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  Check,
  Focus,
  Grid2X2,
  History,
  ImageIcon,
  Images,
  Layers3,
  Loader2,
  Plus,
  Search,
  Save,
  Settings,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

import {
  imageAssetSrc,
  imageAssetThumbnailSrc,
  type AgentConversation,
  type WorkflowNode,
} from "./core";
import { ButtonBase } from "./ui";

export type WorkspaceViewMode = "workbench" | "focus" | "review";
export type WorkspaceAssetRailTab = "results" | "layers" | "requirements" | "templates" | "history";

export type WorkspaceRequirementTemplate = {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  skill?: { name?: string; description?: string };
};

const workspaceViewModes: Array<{
  id: WorkspaceViewMode;
  label: string;
  title: string;
  icon: React.ReactNode;
}> = [
  { id: "workbench", label: "工作台", title: "查看完整画布关系", icon: <Grid2X2 size={14} /> },
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
  { id: "history", label: "历史", icon: <History size={15} /> },
];

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

type WorkspaceRailItem = {
  key: string;
  node: WorkflowNode;
  assetIndex?: number;
  assetOrdinal?: number;
  assetTotal?: number;
  generating?: boolean;
};

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

export function WorkspaceDirectionSwitcher({
  mode,
  onChange,
}: {
  mode: WorkspaceViewMode;
  onChange: (mode: WorkspaceViewMode) => void;
}) {
  return (
    <nav className="workspace-direction-switcher" aria-label="画布视图">
      {workspaceViewModes.map((item) => (
        <ButtonBase
          key={item.id}
          type="button"
          className={mode === item.id ? "active" : ""}
          aria-pressed={mode === item.id}
          title={item.title}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </ButtonBase>
      ))}
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
  nodes,
  conversations,
  activeConversationId,
  onSelectNode,
  onSelectConversation,
}: {
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
        </section>
      ) : null}
    </div>
  );
}

export function WorkspaceAssetRail({
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
}: {
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
  onLoadRequirementTemplates?: () => void;
  onUseRequirementTemplate?: (templateId: string) => void;
  onSaveRequirementTemplate?: () => void;
  onDeleteRequirementTemplate?: (templateId: string) => void;
  onImport: () => void;
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<WorkspaceAssetRailTab>("results");
  const [deleteArmedTemplateId, setDeleteArmedTemplateId] = useState("");
  const loadRequirementTemplatesRef = useRef(onLoadRequirementTemplates);
  loadRequirementTemplatesRef.current = onLoadRequirementTemplates;

  useEffect(() => {
    if (tab === "templates") loadRequirementTemplatesRef.current?.();
    else setDeleteArmedTemplateId("");
  }, [tab]);

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
    return [...nodes]
      .reverse()
      .filter((node) => node.type === "image" && ((node.assets?.length ?? 0) > 0 || node.imageState === "generating"))
      .flatMap((node) => {
        const assetTotal = Math.max(1, ...[
          node.assets?.length ?? 0,
          Number(node.imageProgress?.total ?? 0),
          Number(node.imageParams?.count ?? 0),
        ].filter(Number.isFinite));
        const completedItems = (node.assets ?? []).flatMap((asset, assetIndex): WorkspaceRailItem[] => (
          asset.status === "error" || asset.status === "pending"
            ? []
            : [{
                key: `${node.id}:asset:${assetIndex}`,
                node,
                assetIndex,
                assetOrdinal: assetIndex + 1,
                assetTotal,
              }]
        ));
        if (node.imageState !== "generating") return completedItems;
        const requestedActiveIndex = Number(node.imageProgress?.activeIndex ?? completedItems.length + 1);
        const activeIndex = Math.max(0, Math.min(assetTotal - 1, Number.isFinite(requestedActiveIndex) ? requestedActiveIndex - 1 : completedItems.length));
        return [
          ...completedItems,
          {
            key: `${node.id}:generating`,
            node,
            assetIndex: activeIndex,
            assetOrdinal: activeIndex + 1,
            assetTotal,
            generating: true,
          },
        ];
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

  return (
    <aside className="workspace-asset-rail" aria-label="项目素材与导航" data-active-tab={tab}>
      <header className="workspace-asset-rail-header">
        <ButtonBase
          type="button"
          onClick={tab === "templates" ? onSaveRequirementTemplate : onImport}
          disabled={tab === "templates" && !canSaveRequirementTemplate}
          aria-label={tab === "templates" ? "保存当前需求到模板库" : "导入图片素材"}
          title={tab === "templates"
            ? canSaveRequirementTemplate ? "保存当前选中的需求节点到本机模板库" : "请先在画布中选择一个需求节点"
            : "导入图片素材"}
        >
          {tab === "templates" ? <Save size={16} /> : <Plus size={17} />}
        </ButtonBase>
      </header>

      <nav className="workspace-asset-rail-tabs" aria-label="素材视图">
        {railTabs.map((item) => (
          <ButtonBase
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            aria-pressed={tab === item.id}
            title={item.title || item.label}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </ButtonBase>
        ))}
      </nav>

      <div className="workspace-asset-rail-list" aria-live="polite">
        {tab === "layers" && nodeItems.length > 0 ? (
          <div className="workspace-asset-rail-note" title="这里只显示真实分层 PNG；可在画布中右键显隐、合并或导出">
            <strong>分层成果</strong>
            <small>画布右键管理</small>
          </div>
        ) : null}
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
                  onClick={() => onUseRequirementTemplate?.(template.id)}
                >
                  {template.skill ? <BookMarked size={16} /> : <WandSparkles size={16} />}
                  <span className="workspace-asset-rail-template-mark">{label.trim().slice(0, 1) || "需"}</span>
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
            <div className="workspace-asset-rail-empty is-explained" title="选择画布中的需求节点，再点击上方保存按钮">
              <BookMarked size={15} />
              <strong>暂无模板</strong>
              <small>先保存需求</small>
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
          const preview = item.generating ? "" : nodePreview(node, item.assetIndex);
          const active = selectedNodeId === node.id;
          const layerBadge = tab === "layers" ? layerRailBadge(node) : "";
          const title = tab === "results"
            ? `${nodeRailLabel(node)} · 图片 ${item.assetOrdinal ?? 1}/${item.assetTotal ?? 1}${item.generating ? " · 生成中" : ""}`
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
              aria-label={`定位${tab === "layers" ? "图层" : tab === "requirements" ? "需求" : "成果"}：${nodeRailLabel(node)}`}
              title={title}
              onClick={() => onSelectNode(node.id)}
              onDoubleClick={tab === "layers" && onOpenLayer ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenLayer(node.id);
              } : undefined}
            >
              {preview ? <img src={preview} alt="" draggable={false} loading="lazy" decoding="async" /> : tab === "requirements" ? <WandSparkles size={15} /> : tab === "layers" ? <Layers3 size={15} /> : <ImageIcon size={15} />}
              {layerBadge ? <span className="workspace-asset-rail-layer-index">{layerBadge}</span> : null}
              {active ? <Check className="workspace-asset-rail-check" size={10} /> : null}
            </ButtonBase>
          );
        })}
        {tab !== "history" && tab !== "templates" && nodeItems.length === 0 ? (
          tab === "layers" ? (
            <div className="workspace-asset-rail-empty is-explained" title="普通图片没有独立图层；使用分层生图后会在这里显示">
              <Layers3 size={15} />
              <strong>暂无分层</strong>
              <small>分层生图后显示</small>
            </div>
          ) : <span className="workspace-asset-rail-empty" title="当前项目暂无对应内容">—</span>
        ) : null}
      </div>

      <footer className="workspace-asset-rail-footer">
        <ButtonBase type="button" onClick={onOpenSettings} aria-label="打开设置" title="设置与 Glass Lab">
          <Settings size={16} />
          <span>设置</span>
        </ButtonBase>
      </footer>
    </aside>
  );
}

export function WorkspaceTaskContext({
  mode,
  node,
}: {
  mode: WorkspaceViewMode;
  node: WorkflowNode | null;
}) {
  const modeLabel = workspaceViewModes.find((item) => item.id === mode)?.label ?? "工作台";
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

export function WorkspaceFocusStage({
  nodes,
  selectedNodeId,
  onSelectNode,
  onOpenNode,
  onContinueNode,
}: {
  nodes: WorkflowNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  onContinueNode: (nodeId: string) => void;
}) {
  const images = useMemo(() => orderedImageNodes(nodes, selectedNodeId), [nodes, selectedNodeId]);
  const active = images[0] ?? null;
  const preview = nodeArtwork(active);
  return (
    <section className="workspace-focus-stage" aria-label="专注画布">
      {active && preview ? (
        <ButtonBase
          type="button"
          className="workspace-focus-card"
          onClick={() => onOpenNode(active.id)}
          aria-label={`查看大图：${nodeRailLabel(active)}`}
        >
          <img src={preview} alt={nodeRailLabel(active)} draggable={false} decoding="async" />
          <span><strong>{nodeRailLabel(active)}</strong><small>点击查看大图</small></span>
        </ButtonBase>
      ) : (
        <div className="workspace-mode-empty"><ImageIcon size={22} /><span>选择一个图片成果进入专注视图</span></div>
      )}
      <div className="workspace-focus-filmstrip" aria-label="图片成果胶片条">
        {images.slice(0, 20).map((node, index) => {
          const source = nodePreview(node);
          return (
            <ButtonBase
              key={node.id}
              type="button"
              className={node.id === active?.id ? "active" : ""}
              onClick={() => onSelectNode(node.id)}
              title={nodeRailLabel(node)}
              aria-label={`选择成果 ${index + 1}：${nodeRailLabel(node)}`}
            >
              {source ? <img src={source} alt="" draggable={false} loading="lazy" decoding="async" /> : <ImageIcon size={14} />}
              <span>{String(index + 1).padStart(2, "0")}</span>
            </ButtonBase>
          );
        })}
        <ButtonBase
          type="button"
          className="workspace-focus-add"
          disabled={!active}
          onClick={() => active && onContinueNode(active.id)}
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
