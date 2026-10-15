import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Compass, Focus, Hand, HelpCircle, Maximize2, Minus, MousePointer2, Plus, RotateCcw } from "lucide-react";

import type { CanvasViewport, WorkflowNode } from "./core";
import { ButtonBase } from "./ui";

const MAP_WIDTH = 220;
const MAP_HEIGHT = 144;
const MAP_PADDING = 260;
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.4;

type CanvasNavigationControlsProps = {
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const draggingMapRef = useRef(false);
  useEffect(() => {
    if (!miniMapOpen && !shortcutsOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = dockRef.current?.querySelector<HTMLButtonElement>(shortcutsOpen
        ? 'button[aria-label="查看画布快捷键"]'
        : 'button[aria-label="关闭画布导航"]');
      setMiniMapOpen(false);
      setShortcutsOpen(false);
      trigger?.focus({ preventScroll: true });
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || dockRef.current?.contains(event.target)) return;
      setMiniMapOpen(false);
      setShortcutsOpen(false);
    };
    document.addEventListener("keydown", dismiss, true);
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => {
      document.removeEventListener("keydown", dismiss, true);
      document.removeEventListener("pointerdown", dismissOutside, true);
    };
  }, [miniMapOpen, shortcutsOpen]);
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
        <div className="canvas-navigation-group" role="group" aria-label="画布工具">
          {onCanvasToolChange ? (
            <ButtonBase
              type="button"
              className={canvasTool === "pan" ? "is-active" : ""}
              aria-pressed={canvasTool === "pan"}
              aria-label={canvasTool === "pan" ? "切换到选择工具" : "切换到平移工具"}
              title={canvasTool === "pan" ? "当前为平移工具，点击切换选择" : "切换平移工具"}
              onClick={() => onCanvasToolChange(canvasTool === "pan" ? "select" : "pan")}
            >
              {canvasTool === "pan" ? <Hand size={14} aria-hidden="true" /> : <MousePointer2 size={14} aria-hidden="true" />}
            </ButtonBase>
          ) : null}
          {onUndo ? (
            <ButtonBase
              type="button"
              aria-label="撤销画布操作"
              title={canUndo ? "撤销画布操作（Ctrl / Cmd + Z）" : "暂无可撤销的画布操作"}
              disabled={!canUndo}
              onClick={onUndo}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </ButtonBase>
          ) : null}
        </div>
        <div className="canvas-navigation-group" role="group" aria-label="画布定位">
          <ButtonBase
            type="button"
            className={miniMapOpen ? "is-active" : ""}
            aria-expanded={miniMapOpen}
            aria-label={miniMapOpen ? "关闭画布导航" : "打开画布导航"}
            title={miniMapOpen ? "关闭画布导航" : "打开画布导航"}
            onClick={() => { setShortcutsOpen(false); setMiniMapOpen((current) => !current); }}
          >
            <Compass size={14} aria-hidden="true" />
          </ButtonBase>
          <ButtonBase type="button" aria-label="适配全部成果" title={`适配全部成果（${nodes.length}）`} onClick={onFit}>
            <Maximize2 size={14} aria-hidden="true" />
          </ButtonBase>
          {selectedCount > 0 && onFocusSelection ? (
            <ButtonBase type="button" aria-label="定位当前选中" title="定位当前选中" onClick={onFocusSelection}>
              <Focus size={14} aria-hidden="true" />
            </ButtonBase>
          ) : null}
        </div>
        <div className="canvas-navigation-group" role="group" aria-label="画布缩放">
          <ButtonBase type="button" aria-label="缩小画布" title="缩小画布" disabled={viewport.scale <= MIN_ZOOM} onClick={() => onScaleChange(Math.max(MIN_ZOOM, viewport.scale - 0.08))}>
            <Minus size={14} aria-hidden="true" />
          </ButtonBase>
          <input
            className="canvas-navigation-range"
            type="range"
            min={MIN_ZOOM * 100}
            max={MAX_ZOOM * 100}
            step="1"
            value={Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.scale)) * 100)}
            aria-label="画布缩放比例"
            onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
          />
          <ButtonBase type="button" className="canvas-navigation-zoom" aria-label="恢复画布为 100%" title="恢复画布为 100%" onClick={() => onScaleChange(1)}>{Math.round(viewport.scale * 100)}%</ButtonBase>
          <ButtonBase type="button" aria-label="放大画布" title="放大画布" disabled={viewport.scale >= MAX_ZOOM} onClick={() => onScaleChange(Math.min(MAX_ZOOM, viewport.scale + 0.08))}>
            <Plus size={14} aria-hidden="true" />
          </ButtonBase>
        </div>
        <ButtonBase
          type="button"
          className={shortcutsOpen ? "is-active" : ""}
          aria-expanded={shortcutsOpen}
          aria-label="查看画布快捷键"
          title="查看画布快捷键"
          onClick={() => { setMiniMapOpen(false); setShortcutsOpen((current) => !current); }}
        >
          <HelpCircle size={14} aria-hidden="true" />
        </ButtonBase>
      </div>
      {shortcutsOpen ? (
        <div className="canvas-shortcuts-popover" role="dialog" aria-label="画布快捷键">
          <strong>画布快捷键</strong>
          <span><kbd>滚轮</kbd> 缩放，<kbd>空格</kbd> + 拖动平移</span>
          <span><kbd>Ctrl / Cmd</kbd> + 拖动框选，<kbd>Shift</kbd> + 点击追加选择</span>
          <span><kbd>0</kbd> 适配全部，<kbd>Esc</kbd> 清除选择/关闭菜单</span>
          <span><kbd>Ctrl / Cmd + C/V</kbd> 复制/粘贴，<kbd>Delete</kbd> 删除</span>
        </div>
      ) : null}
    </div>
  );
}
