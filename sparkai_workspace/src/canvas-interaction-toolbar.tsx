import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { IconActionButton, MenuItem, MenuSurface } from "./ui";

export type CanvasInteractionBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasInteractionAction = {
  id: string;
  label: string;
  title?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type CanvasInteractionToolbarProps = {
  bounds: CanvasInteractionBounds | null;
  canvasSize: { width: number; height: number };
  actions: CanvasInteractionAction[];
  ariaLabel: string;
  title?: string;
  className?: string;
  primaryActionIds?: string[];
  nodeKey?: string;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
};

function stopCanvasPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}

function intersectsCanvas(bounds: CanvasInteractionBounds, canvasSize: { width: number; height: number }) {
  return bounds.left < canvasSize.width && bounds.top < canvasSize.height
    && bounds.left + bounds.width > 0 && bounds.top + bounds.height > 0;
}

function ActionBar({
  bounds,
  canvasSize,
  actions,
  ariaLabel,
  title,
  className,
  primaryActionIds,
  nodeKey,
  onPointerEnter,
  onPointerLeave,
}: CanvasInteractionToolbarProps & { bounds: CanvasInteractionBounds }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const moreTriggerId = useId();
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const primaryActions = primaryActionIds ? primaryActionIds.flatMap((id) => actions.filter((action) => action.id === id)) : actions;
  const secondaryActions = primaryActionIds ? actions.filter((action) => !primaryActionIds.includes(action.id)) : [];
  useEffect(() => { setMoreMenu(null); }, [nodeKey]);
  const closeMoreMenu = () => { setMoreMenu(null); onPointerEnter?.(); };
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    // Only the visible toolbar is measured. Include wrapped rows and align the
    // whole rectangle to device pixels, rather than translating its centre.
    const place = () => {
      const { width, height } = anchor.getBoundingClientRect();
      const margin = 8;
      const canvas = anchor.closest(".workflow-canvas");
      const canvasRect = canvas?.getBoundingClientRect();
      const canvasLeft = canvasRect?.left ?? 0;
      const canvasTop = canvasRect?.top ?? 0;
      const docks = [...(canvas?.querySelectorAll<HTMLElement>(".canvas-navigation-bar, .canvas-plugin-toolbar") ?? [])];
      const dockTops = docks.map((dock) => dock.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => rect.top - canvasTop - margin);
      const bottom = Math.max(margin * 2, Math.min(canvasSize.height - margin, ...dockTops));
      const dpr = window.devicePixelRatio || 1;
      const align = (value: number, origin: number) => Math.round((value + origin) * dpr) / dpr - origin;
      const above = bounds.top - height - margin;
      const below = bounds.top + bounds.height + margin;
      const preferredTop = above >= margin ? above : below + height <= bottom ? below : above;
      const next = {
        left: align(Math.max(margin, Math.min(canvasSize.width - width - margin, bounds.left + bounds.width / 2 - width / 2)), canvasLeft),
        top: align(Math.max(margin, Math.min(bottom - height, preferredTop)), canvasTop),
        maxHeight: bottom - margin,
      };
      setPosition((current) => current?.left === next.left && current?.top === next.top && current?.maxHeight === next.maxHeight ? current : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    anchor.closest(".workflow-canvas")?.querySelectorAll(".canvas-navigation-bar, .canvas-plugin-toolbar").forEach((dock) => observer.observe(dock));
    return () => observer.disconnect();
  }, [bounds.left, bounds.top, bounds.width, bounds.height, canvasSize.width, canvasSize.height]);
  const anchorStyle: CSSProperties = {
    ...position,
    maxWidth: Math.max(0, canvasSize.width - 16),
    maxHeight: position?.maxHeight ?? Math.max(0, canvasSize.height - 16),
    visibility: position ? "visible" : "hidden",
  };
  return (
    <div
      ref={anchorRef}
      className="canvas-interaction-toolbar-anchor"
      style={anchorStyle}
      data-canvas-no-zoom="true"
      onPointerDown={stopCanvasPointer}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(event) => { if (!moreMenu && !event.currentTarget.contains(document.activeElement)) onPointerLeave?.(); }}
      onFocusCapture={onPointerEnter}
      onBlurCapture={(event) => {
        if (moreMenu || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.canvas-interaction-menu')) return;
        onPointerLeave?.();
      }}
    >
      <div className={`canvas-interaction-toolbar ${className || ""}`} role="toolbar" aria-label={ariaLabel}>
        {title ? <div className="canvas-interaction-title" title={title}>{title}</div> : null}
        <div className="canvas-interaction-actions">
          {primaryActions.map((action) => (
            <IconActionButton
              key={action.id}
              label={action.label}
              icon={<span className="canvas-interaction-action-icon" aria-hidden="true">{action.icon}</span>}
              className={`canvas-interaction-action ${action.danger ? "is-danger" : ""}`}
              disabled={action.disabled}
              title={action.title || action.label}
              aria-label={action.title || action.label}
              onPointerDown={stopCanvasPointer}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                action.onClick();
              }}
            />
          ))}
          {secondaryActions.length ? <IconActionButton id={moreTriggerId} label="更多成果操作" icon={<MoreHorizontal size={16} aria-hidden="true" />}
            className="canvas-interaction-action" aria-haspopup="menu" aria-expanded={Boolean(moreMenu)} onPointerDown={stopCanvasPointer}
            onClick={(event) => {
              event.preventDefault(); event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              if (moreMenu) closeMoreMenu();
              else { onPointerEnter?.(); setMoreMenu({ x: rect.left, y: rect.bottom + 6 }); }
            }} /> : null}
        </div>
      </div>
      {moreMenu ? <MenuSurface {...moreMenu} triggerId={moreTriggerId} ariaLabel="更多成果操作" className="canvas-context-menu canvas-interaction-menu" data-canvas-no-zoom="true"
        onRequestClose={closeMoreMenu} onPointerEnter={onPointerEnter} onPointerLeave={() => { /* Keep the node mounted while its portal menu is open. */ }}
        onPointerDown={stopCanvasPointer} onKeyDown={(event) => event.stopPropagation()}>
        {secondaryActions.map((action) => <MenuItem key={action.id} icon={action.icon} disabled={action.disabled} title={action.title || action.label}
          tone={action.danger ? "danger" : "default"} onClick={(event) => {
            event.preventDefault(); event.stopPropagation(); closeMoreMenu(); action.onClick();
          }}>{action.label}</MenuItem>)}
      </MenuSurface> : null}
    </div>
  );
}

export function CanvasSelectionToolbar({
  bounds,
  canvasSize,
  actions,
  ariaLabel,
  title,
  onPointerEnter,
  onPointerLeave,
}: Omit<CanvasInteractionToolbarProps, "className">) {
  if (!bounds || !actions.length || !intersectsCanvas(bounds, canvasSize)) return null;
  const frameStyle: CSSProperties = {
    left: Math.max(4, bounds.left - 10),
    top: Math.max(4, bounds.top - 10),
    width: Math.max(0, Math.min(canvasSize.width - 4, bounds.left + bounds.width + 10) - Math.max(4, bounds.left - 10)),
    height: Math.max(0, Math.min(canvasSize.height - 4, bounds.top + bounds.height + 10) - Math.max(4, bounds.top - 10)),
  };
  return (
    <>
      <div className="canvas-selection-frame" style={frameStyle} aria-hidden="true" />
      <ActionBar
        bounds={bounds}
        canvasSize={canvasSize}
        actions={actions}
        ariaLabel={ariaLabel}
        title={title}
        className="is-selection"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
    </>
  );
}

export function CanvasNodeHoverToolbar({
  bounds,
  canvasSize,
  actions,
  ariaLabel,
  title,
  primaryActionIds,
  nodeKey,
  onPointerEnter,
  onPointerLeave,
}: Omit<CanvasInteractionToolbarProps, "className">) {
  if (!bounds || !actions.length || !intersectsCanvas(bounds, canvasSize)) return null;
  return (
      <ActionBar
        bounds={bounds}
        canvasSize={canvasSize}
        actions={actions}
        ariaLabel={ariaLabel}
        title={title}
        className="is-node-hover"
        primaryActionIds={primaryActionIds}
        nodeKey={nodeKey}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
  );
}
