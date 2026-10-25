import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Compass, Focus, Hand, HelpCircle, Maximize2, Minus, MoreHorizontal, MousePointer2, Plus, RotateCcw } from "lucide-react";

import type { CanvasViewport, WorkflowNode } from "./core";
import { ButtonBase, IconActionButton, MenuItem, MenuSurface } from "./ui";

const MAP_WIDTH = 220;
const MAP_HEIGHT = 144;
const MAP_PADDING = 260;
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.4;

type CanvasNavigationControlsProps = {
  tools?: ReactNode;
  nodes: WorkflowNode[];
  viewport: CanvasViewport;
  viewportSize: { width: number; height: number };
  selectedCount?: number;
  selectedNodeIds?: string[];
  canvasTool?: "select" | "pan";
  onCanvasToolChange?: (tool: "select" | "pan") => void;
  canUndo?: boolean;
  onUndo?: () => void;
  onViewportChange: (viewport: CanvasViewport) => void;
  onScaleChange: (scale: number) => void;
  onFit: () => void;
  onFocusSelection?: () => void;
};

type MapBounds = { left: number; top: number; width: number; height: number };

function nodeSize(node: WorkflowNode) {
  return {
    width: Math.max(132, Number(node.width) || 280),
    height: Math.max(92, Number(node.height) || 190),
  };
}

function nodeColor(node: WorkflowNode) {
  if (node.type === "requirement") return "var(--blue)";
  if (node.type === "video") return "var(--rose)";
  if (node.type === "image") return "var(--accent)";
  return "var(--muted)";
}

function boundsForNodes(nodes: WorkflowNode[]): MapBounds {
  if (!nodes.length) return { left: -MAP_PADDING, top: -MAP_PADDING, width: MAP_PADDING * 2, height: MAP_PADDING * 2 };
  const left = Math.min(...nodes.map((node) => Number(node.x) || 0)) - MAP_PADDING;
  const top = Math.min(...nodes.map((node) => Number(node.y) || 0)) - MAP_PADDING;
  const right = Math.max(...nodes.map((node) => (Number(node.x) || 0) + nodeSize(node).width)) + MAP_PADDING;
  const bottom = Math.max(...nodes.map((node) => (Number(node.y) || 0) + nodeSize(node).height)) + MAP_PADDING;
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function stopCanvasEvent(event: ReactPointerEvent) {
  event.stopPropagation();
}

export function CanvasNavigationControls({
  tools,
  nodes,
  viewport,
  viewportSize,
  selectedCount = 0,
  selectedNodeIds = [],
  canvasTool = "select",
  onCanvasToolChange,
  canUndo = false,
  onUndo,
  onViewportChange,
  onScaleChange,
  onFit,
  onFocusSelection,
}: CanvasNavigationControlsProps) {
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const moreTriggerId = useId();
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const draggingMapRef = useRef(false);
  useEffect(() => {
    if (!miniMapOpen && !shortcutsOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || moreMenu) return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = dockRef.current?.querySelector<HTMLButtonElement>('button[aria-label="画布更多操作"]');
      setMiniMapOpen(false);
      setShortcutsOpen(false);
      trigger?.focus({ preventScroll: true });
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || dockRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".canvas-navigation-menu")) return;
      setMiniMapOpen(false);
      setShortcutsOpen(false);
    };
    document.addEventListener("keydown", dismiss, true);
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => {
      document.removeEventListener("keydown", dismiss, true);
      document.removeEventListener("pointerdown", dismissOutside, true);
    };
  }, [miniMapOpen, moreMenu, shortcutsOpen]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const bounds = useMemo(() => boundsForNodes(nodes), [nodes]);
  const mapScale = Math.min(MAP_WIDTH / bounds.width, MAP_HEIGHT / bounds.height);
  const mapOffsetX = (MAP_WIDTH - bounds.width * mapScale) / 2;
  const mapOffsetY = (MAP_HEIGHT - bounds.height * mapScale) / 2;
  const viewportRect = useMemo(() => {
    const scale = Math.max(MIN_ZOOM, Number(viewport.scale) || 1);
    const left = (-viewport.x / scale - bounds.left) * mapScale + mapOffsetX;
    const top = (-viewport.y / scale - bounds.top) * mapScale + mapOffsetY;
    return {
      left,
      top,
      width: Math.max(8, (viewportSize.width / scale) * mapScale),
      height: Math.max(8, (viewportSize.height / scale) * mapScale),
    };
  }, [bounds.left, bounds.top, mapOffsetX, mapOffsetY, mapScale, viewport.scale, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);

  function updateViewportFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mapX = Math.max(0, Math.min(MAP_WIDTH, event.clientX - rect.left));
    const mapY = Math.max(0, Math.min(MAP_HEIGHT, event.clientY - rect.top));
    const worldX = (mapX - mapOffsetX) / mapScale + bounds.left;
    const worldY = (mapY - mapOffsetY) / mapScale + bounds.top;
    const scale = Math.max(MIN_ZOOM, Number(viewport.scale) || 1);
    onViewportChange({
      x: viewportSize.width / 2 - worldX * scale,
      y: viewportSize.height / 2 - worldY * scale,
      scale,
    });
  }

  return (
    <div ref={dockRef} className={`canvas-navigation-dock ${viewportSize.width < 560 ? "is-compact" : ""}`} data-canvas-no-zoom="true" onPointerDown={stopCanvasEvent}>
      {miniMapOpen ? (
        <div className="canvas-mini-map" role="dialog" aria-label="画布导航小地图">
          <div className="canvas-mini-map-heading">
            <strong>画布导航</strong>
            <span>{nodes.length ? `${nodes.length} 个成果` : "暂无成果"}</span>
          </div>
          <div
            ref={mapRef}
            className={`canvas-mini-map-stage ${nodes.length ? "has-nodes" : "empty"}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingMapRef.current = true;
              updateViewportFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (draggingMapRef.current) updateViewportFromPointer(event);
            }}
            onPointerUp={(event) => {
              draggingMapRef.current = false;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => { draggingMapRef.current = false; }}
          >
            {nodes.map((node) => {
              const size = nodeSize(node);
              return (
                <span
                  key={node.id}
                  className={`canvas-mini-map-node ${selectedNodeIdSet.has(node.id) ? "is-selected" : ""}`}
                  style={{
                    left: (node.x - bounds.left) * mapScale + mapOffsetX,
                    top: (node.y - bounds.top) * mapScale + mapOffsetY,
                    width: Math.max(3, size.width * mapScale),
                    height: Math.max(3, size.height * mapScale),
                    background: nodeColor(node),
                  }}
                  aria-hidden="true"
                />
              );
            })}
            <span
              className="canvas-mini-map-viewport"
              style={viewportRect}
              aria-hidden="true"
            />
            {!nodes.length ? <span className="canvas-mini-map-empty-label">导入或生成图片后显示</span> : null}
          </div>
        </div>
      ) : null}
      <div className="canvas-navigation-bar" role="toolbar" aria-label="画布导航">
        {onCanvasToolChange ? <div className="canvas-navigation-group" role="group" aria-label="画布工具">
          <IconActionButton label="选择工具" icon={<MousePointer2 size={16} aria-hidden="true" />}
            className={canvasTool === "select" ? "is-active" : ""} aria-pressed={canvasTool === "select"} onClick={() => onCanvasToolChange("select")} />
          <IconActionButton label="平移工具" icon={<Hand size={16} aria-hidden="true" />}
            className={canvasTool === "pan" ? "is-active" : ""} aria-pressed={canvasTool === "pan"} onClick={() => onCanvasToolChange("pan")} />
        </div> : null}
        <div className="canvas-navigation-group" role="group" aria-label="画布缩放">
          <IconActionButton label="缩小画布" icon={<Minus size={16} aria-hidden="true" />} disabled={viewport.scale <= MIN_ZOOM}
            onClick={() => onScaleChange(Math.max(MIN_ZOOM, viewport.scale - 0.08))} />
          <ButtonBase type="button" className="canvas-navigation-zoom" aria-label="恢复画布为 100%" title="恢复画布为 100%"
            onClick={() => onScaleChange(1)}>{Math.round(viewport.scale * 100)}%</ButtonBase>
          <IconActionButton label="放大画布" icon={<Plus size={16} aria-hidden="true" />} disabled={viewport.scale >= MAX_ZOOM}
            onClick={() => onScaleChange(Math.min(MAX_ZOOM, viewport.scale + 0.08))} />
          <IconActionButton label="适配全部成果" title={`适配全部成果（${nodes.length}）`} icon={<Maximize2 size={16} aria-hidden="true" />} onClick={onFit} />
        </div>
        {tools ? <div className="canvas-navigation-group canvas-navigation-tools" role="group" aria-label="创作工具">{tools}</div> : null}
        <IconActionButton id={moreTriggerId} label="画布更多操作" icon={<MoreHorizontal size={16} aria-hidden="true" />} aria-haspopup="menu" aria-expanded={Boolean(moreMenu)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMoreMenu(moreMenu ? null : { x: rect.left, y: rect.top - 220 });
          }} />
      </div>
      {moreMenu ? <MenuSurface {...moreMenu} triggerId={moreTriggerId} ariaLabel="画布更多操作" className="canvas-context-menu canvas-navigation-menu" data-canvas-no-zoom="true" onRequestClose={() => setMoreMenu(null)}>
        {onUndo ? <MenuItem icon={<RotateCcw size={16} />} disabled={!canUndo} shortcut="Ctrl / ⌘ Z"
          title={canUndo ? "撤销画布操作" : "暂无可撤销的画布操作"} onClick={() => { setMoreMenu(null); onUndo(); }}>撤销画布操作</MenuItem> : null}
        {selectedCount > 0 && onFocusSelection ? <MenuItem icon={<Focus size={16} />} onClick={() => { setMoreMenu(null); onFocusSelection(); }}>定位当前选中</MenuItem> : null}
        <MenuItem icon={<Compass size={16} />} onClick={() => { setMoreMenu(null); setShortcutsOpen(false); setMiniMapOpen((current) => !current); }}>{miniMapOpen ? "关闭画布导航" : "打开画布导航"}</MenuItem>
        <MenuItem icon={<HelpCircle size={16} />} onClick={() => { setMoreMenu(null); setMiniMapOpen(false); setShortcutsOpen((current) => !current); }}>查看画布快捷键</MenuItem>
      </MenuSurface> : null}
      {shortcutsOpen ? (
        <div className="canvas-shortcuts-popover" role="dialog" aria-label="画布快捷键">
          <strong>画布快捷键</strong>
          <span>滚轮按设置缩放/平移；<kbd>Ctrl</kbd> + 滚轮缩放，<kbd>空格</kbd> + 拖动平移</span>
          <span>选择工具：左键拖空白框选；中键拖动平移</span>
          <span><kbd>Ctrl / Cmd</kbd> + 点击增减选择；空白轻点保留选择</span>
          <span><kbd>0</kbd> 适配全部，<kbd>Esc</kbd> 取消手势/关闭菜单</span>
          <span><kbd>Ctrl / Cmd + C/V</kbd> 复制/粘贴，<kbd>Delete</kbd> 删除</span>
        </div>
      ) : null}
    </div>
  );
}
