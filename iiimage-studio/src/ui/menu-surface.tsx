import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

import { ButtonBase, joinClassNames } from "./primitives";

export function MenuItem({
  tone = "default",
  busy = false,
  icon,
  shortcut,
  className,
  children,
  disabled,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "danger";
  busy?: boolean;
  icon?: React.ReactNode;
  shortcut?: React.ReactNode;
}) {
  return (
    <ButtonBase
      {...buttonProps}
      className={joinClassNames("ui-menu-item", tone === "danger" && "ui-menu-item-danger", className)}
      disabled={disabled || busy}
      role={buttonProps.role ?? "menuitem"}
      tabIndex={buttonProps.tabIndex ?? -1}
      aria-busy={busy || undefined}
      data-ui-menu-item="true"
      data-ui-tone={tone}
    >
      <span className="ui-menu-item-icon" aria-hidden="true">
        {busy ? <Loader2 size={15} className="spin" /> : icon}
      </span>
      <span className="ui-menu-item-label">{children}</span>
      {shortcut ? <kbd className="ui-menu-item-shortcut">{shortcut}</kbd> : <span className="ui-menu-item-trailing" />}
    </ButtonBase>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <div className={joinClassNames("ui-menu-separator", className)} role="separator" />;
}

export function MenuSummary({
  title,
  className,
  children
}: {
  title: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={joinClassNames("ui-menu-summary", className)} data-ui-menu-summary="true">
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </div>
  );
}

export type MenuSurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  x: number;
  y: number;
  ariaLabel: string;
  onRequestClose: () => void;
  viewportGap?: number;
};

/**
 * Global context-menu infrastructure. Menus render in a document-level portal
 * so canvas node z-order can never cover them, then clamp from their measured
 * dimensions instead of relying on feature-specific height estimates.
 */
export function MenuSurface({
  x,
  y,
  ariaLabel,
  onRequestClose,
  viewportGap = 12,
  className,
  children,
  style,
  onKeyDown,
  ...surfaceProps
}: MenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState(() => ({ left: x, top: y, maxHeight: 320 }));

  const placeFromMeasurement = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const width = Math.max(1, menu.offsetWidth);
    const height = Math.max(1, menu.scrollHeight);
    const availableWidth = Math.max(1, window.innerWidth - viewportGap * 2);
    const availableHeight = Math.max(1, window.innerHeight - viewportGap * 2);
    const left = Math.round(Math.min(Math.max(viewportGap, x), viewportGap + Math.max(0, availableWidth - width)));
    const top = Math.round(Math.min(Math.max(viewportGap, y), viewportGap + Math.max(0, availableHeight - Math.min(height, availableHeight))));
    const maxHeight = Math.max(120, Math.floor(window.innerHeight - top - viewportGap));
    setPlacement((current) => current.left === left && current.top === top && current.maxHeight === maxHeight
      ? current
      : { left, top, maxHeight });
  }, [viewportGap, x, y]);

  useLayoutEffect(() => {
    placeFromMeasurement();
  }, [children, placeFromMeasurement]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
    const focusFrame = window.requestAnimationFrame(() => buttons[0]?.focus({ preventScroll: true }));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(placeFromMeasurement);
    observer?.observe(menu);
    window.addEventListener("resize", placeFromMeasurement);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      observer?.disconnect();
      window.removeEventListener("resize", placeFromMeasurement);
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
    };
  }, [placeFromMeasurement]);

  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      onRequestClose();
    }
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [onRequestClose]);

  function focusMenuItem(targetIndex: number) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const index = (targetIndex + items.length) % items.length;
    items[index]?.focus({ preventScroll: true });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onRequestClose();
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(currentIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(items.length - 1);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      {...surfaceProps}
      ref={menuRef}
      className={joinClassNames("ui-menu-surface", className)}
      role="menu"
      aria-label={ariaLabel}
      data-ui-menu-surface="true"
      style={{ ...style, left: placement.left, top: placement.top, maxHeight: placement.maxHeight }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
}
