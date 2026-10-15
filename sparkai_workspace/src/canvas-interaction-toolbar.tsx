import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { ButtonBase } from "./ui";

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
  onPointerEnter,
  onPointerLeave,
}: CanvasInteractionToolbarProps & { bounds: CanvasInteractionBounds }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
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
      onPointerLeave={onPointerLeave}
    >
      <div className={`canvas-interaction-toolbar ${className || ""}`} role="toolbar" aria-label={ariaLabel}>
        {title ? <div className="canvas-interaction-title" title={title}>{title}</div> : null}
        <div className="canvas-interaction-actions">
          {actions.map((action) => (
            <ButtonBase
              key={action.id}
              type="button"
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
            >
              <span className="canvas-interaction-action-icon" aria-hidden="true">{action.icon}</span>
              <span>{action.label}</span>
            </ButtonBase>
          ))}
        </div>
      </div>
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
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
  );
}
