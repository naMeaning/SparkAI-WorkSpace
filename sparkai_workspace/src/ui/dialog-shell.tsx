import React, { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { ButtonBase, joinClassNames } from "./primitives";
import { DIALOG_RESIZE_DIRECTIONS, useDialogResize } from "./dialog-resize";

declare const __NAIMAGE_AIDEBUG__: boolean;

export type DialogCloseReason = "escape" | "backdrop" | "close-button" | "action";
export type DialogClosePolicy = "always" | "when-idle" | "when-clean" | "when-idle-and-clean" | "never";

export type DialogCloseState = {
  busy: boolean;
  dirty: boolean;
};

export type DialogLayerLevel = "dialog" | "nested";

export type DialogShellControls = {
  requestClose: (reason?: DialogCloseReason) => boolean;
};

export type DialogShellProps = {
  surface: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  layerClassName?: string;
  backdropClassName?: string;
  busy?: boolean;
  dirty?: boolean;
  /** Allow content-heavy dialogs to be resized from every edge and corner. */
  resizable?: boolean;
  layerLevel?: DialogLayerLevel;
  closePolicy?: Partial<Record<DialogCloseReason, DialogClosePolicy>>;
  onRequestClose: (reason: DialogCloseReason) => void;
  onCloseBlocked?: (reason: DialogCloseReason, state: DialogCloseState) => void;
  portal?: boolean;
  children: React.ReactNode | ((controls: DialogShellControls) => React.ReactNode);
};

export type DrawerShellProps = DialogShellProps;

// One module-level stack coordinates every surface created through the public
// facade. Nested dialogs retain priority even when a parent re-renders.
const dialogStack: Array<{ token: symbol; layerLevel: DialogLayerLevel }> = [];

function topDialogToken() {
  for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
    if (dialogStack[index]?.layerLevel === "nested") return dialogStack[index]?.token;
  }
  return dialogStack[dialogStack.length - 1]?.token;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function closePolicyAllows(policy: DialogClosePolicy, state: DialogCloseState) {
  if (policy === "always") return true;
  if (policy === "when-idle") return !state.busy;
  if (policy === "when-clean") return !state.dirty;
  if (policy === "when-idle-and-clean") return !state.busy && !state.dirty;
  return false;
}

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
  });
}

export function DialogShell({
  surface,
  ariaLabel,
  ariaLabelledBy,
  className,
  layerClassName,
  backdropClassName,
  busy = false,
  dirty = false,
  resizable = true,
  layerLevel = "dialog",
  closePolicy,
  onRequestClose,
  onCloseBlocked,
  portal = true,
  children
}: DialogShellProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const resize = useDialogResize(dialogRef, resizable);
  const stackTokenRef = useRef(Symbol(surface));
  const openedAtRef = useRef(Date.now());
  // Capture the opener during render, before a nested surface's autoFocus
  // control can take focus during the portal commit.
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const focusRestoredRef = useRef(false);
  const latestRef = useRef({ busy, dirty, closePolicy, onRequestClose, onCloseBlocked });
  latestRef.current = { busy, dirty, closePolicy, onRequestClose, onCloseBlocked };

  const requestClose = useCallback((reason: DialogCloseReason = "action") => {
    const latest = latestRef.current;
    const state = { busy: latest.busy, dirty: latest.dirty };
    const fallbackPolicy: DialogClosePolicy = reason === "action" ? "always" : "when-idle";
    const policy = latest.closePolicy?.[reason] ?? fallbackPolicy;
    const allowed = closePolicyAllows(policy, state);
    if (__NAIMAGE_AIDEBUG__) window.__naimageDebugLastSurfaceClose = { surface, reason, policy, ...state, allowed };
    if (!allowed) {
      latest.onCloseBlocked?.(reason, state);
      return false;
    }
    // Restore focus before the parent unmounts the surface. Relying only on
    // passive-effect cleanup leaves keyboard closes briefly focused inside a
    // removed portal, which makes Chromium fall back to <body>. The cleanup
    // below remains as a safety net for callers that close the surface
    // directly after a successful action.
    const restoreTarget = restoreFocusRef.current;
    if (restoreTarget?.isConnected) {
      restoreTarget.focus({ preventScroll: true });
      focusRestoredRef.current = true;
    }
    latest.onRequestClose(reason);
    return true;
  }, []);

  useEffect(() => {
    const token = stackTokenRef.current;
    dialogStack.push({ token, layerLevel });

    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || topDialogToken() !== token) return;
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
      const target = preferred ?? focusableElements(dialog)[0] ?? dialog;
      target.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (topDialogToken() !== token) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      // Portalled select/tool menus own their Escape/Tab before the dialog.
      if ((event.key === "Escape" || event.key === "Tab") && event.target instanceof Element && event.target.closest("[data-ui-menu-surface]")) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose("escape");
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const currentIndex = focusable.indexOf(active as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
        : currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
      if (currentIndex < 0 || (event.shiftKey && currentIndex === 0) || (!event.shiftKey && currentIndex === focusable.length - 1)) {
        event.preventDefault();
        focusable[nextIndex]?.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = dialogStack.findIndex((entry) => entry.token === token);
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      const restoreTarget = restoreFocusRef.current;
      const closingDialog = dialogRef.current;
      window.requestAnimationFrame(() => {
        if (focusRestoredRef.current || !restoreTarget?.isConnected) return;
        const active = document.activeElement;
        const focusNeedsRestore = !(active instanceof HTMLElement) ||
          active === document.body ||
          !active.isConnected ||
          Boolean(closingDialog?.contains(active));
        if (focusNeedsRestore) restoreTarget.focus({ preventScroll: true });
      });
    };
  }, [layerLevel, requestClose]);

  const content = (
    <div
      className={joinClassNames("dialog-layer", "ui-surface-layer", layerClassName)}
      data-ui-surface-layer={surface}
      data-ui-layer-level={layerLevel}
      data-ui-busy={busy ? "true" : "false"}
      data-ui-dirty={dirty ? "true" : "false"}
    >
      <div
        className={joinClassNames("ui-surface-backdrop", backdropClassName)}
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.currentTarget !== event.target) return;
          if (Date.now() - openedAtRef.current < 200) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose("backdrop");
        }}
      />
      <section
        ref={dialogRef}
        className={joinClassNames("ui-surface", resizable && "ui-surface-resizable", className)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-busy={busy || undefined}
        data-ui-surface={surface}
        data-ui-resizable={resizable ? "true" : undefined}
        data-ui-busy={busy ? "true" : "false"}
        data-ui-dirty={dirty ? "true" : "false"}
        tabIndex={-1}
      >
        {typeof children === "function" ? children({ requestClose }) : children}
        {resizable ? DIALOG_RESIZE_DIRECTIONS.map((direction) => {
          const handleProps = {
            className: "ui-dialog-resize-handle",
            "data-ui-resize-handle": direction,
            onPointerDown: (event: React.PointerEvent<HTMLElement>) => resize.onPointerDown(event, direction),
            onPointerMove: resize.onPointerMove,
            onPointerUp: resize.onPointerEnd,
            onPointerCancel: resize.onPointerEnd,
            onLostPointerCapture: resize.onPointerEnd,
            onClick: (event: React.MouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); }
          };
          return direction === "se"
            ? <ButtonBase
                key={direction}
                {...handleProps}
                aria-label={`调整${ariaLabel || "弹窗"}尺寸`}
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
                title="拖动边缘或角落调整大小；方向键调整，Shift 加快，Home 还原"
                onKeyDown={resize.onKeyDown}
              />
            : <span key={direction} {...handleProps} aria-hidden="true" />;
        }) : null}
      </section>
    </div>
  );

  return portal ? createPortal(content, document.body) : content;
}

export function DrawerShell({
  className,
  layerClassName,
  backdropClassName,
  resizable = true,
  children,
  ...props
}: DrawerShellProps) {
  const dragRef = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  function setDrawerWidth(handle: HTMLElement, width: number) {
    const drawer = handle.closest<HTMLElement>(".ui-drawer");
    if (!drawer) return;
    const style = window.getComputedStyle(drawer);
    const min = Math.min(parseFloat(style.getPropertyValue("--ui-drawer-min-width")) || 320, window.innerWidth);
    const max = Math.min(900, window.innerWidth);
    drawer.style.setProperty("--ui-drawer-width", `${Math.round(Math.max(min, Math.min(max, width)))}px`);
  }
  return (
    <DialogShell
      {...props}
      resizable={false}
      className={joinClassNames("ui-drawer", resizable && "ui-drawer-resizable", className)}
      layerClassName={joinClassNames("ui-drawer-layer", layerClassName)}
      backdropClassName={joinClassNames("ui-drawer-backdrop", backdropClassName)}
    >
      {(controls) => <>
        {typeof children === "function" ? children(controls) : children}
        {resizable ? <ButtonBase
          type="button"
          className="ui-drawer-resize-handle"
          aria-label={`调整${props.ariaLabel || "侧栏"}宽度`}
          title="拖动调整宽度；← / → 调整，Home 还原"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const drawer = event.currentTarget.closest<HTMLElement>(".ui-drawer");
            if (!drawer) return;
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, width: drawer.getBoundingClientRect().width };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            setDrawerWidth(event.currentTarget, drag.width + drag.x - event.clientX);
          }}
          onPointerUp={(event) => {
            dragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => { dragRef.current = null; }}
          onKeyDown={(event) => {
            const drawer = event.currentTarget.closest<HTMLElement>(".ui-drawer");
            if (!drawer || !["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Home") drawer.style.removeProperty("--ui-drawer-width");
            else setDrawerWidth(event.currentTarget, drawer.getBoundingClientRect().width + (event.key === "ArrowLeft" ? 24 : -24));
          }}
        /> : null}
      </>}
    </DialogShell>
  );
}

export function SurfaceHeader({
  title,
  titleId,
  eyebrow,
  description,
  onClose,
  closeLabel = "关闭",
  closeDisabled = false,
  closeClassName,
  className,
  children
}: {
  title: React.ReactNode;
  titleId?: string;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  closeClassName?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const generatedId = useId();
  return (
    <header className={joinClassNames("ui-surface-header", className)}>
      <div className="ui-surface-heading">
        {eyebrow ? <span className="ui-surface-eyebrow">{eyebrow}</span> : null}
        <h2 id={titleId ?? generatedId}>{title}</h2>
        {description ? <p className="ui-surface-description">{description}</p> : null}
      </div>
      {children ? <div className="ui-surface-header-actions">{children}</div> : null}
      {onClose ? (
        <ButtonBase
          className={joinClassNames("ui-surface-close", closeClassName)}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          disabled={closeDisabled}
        >
          <X size={18} />
        </ButtonBase>
      ) : null}
    </header>
  );
}

export function SurfaceBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={joinClassNames("ui-surface-body", className)}>{children}</div>;
}

export function SurfaceFooter({
  className,
  leading,
  children
}: {
  className?: string;
  leading?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <footer className={joinClassNames("ui-surface-footer", className)}>
      {leading ? <div className="ui-surface-footer-leading">{leading}</div> : <span className="ui-surface-footer-spacer" />}
      <div className="ui-surface-footer-actions">{children}</div>
    </footer>
  );
}

export function SurfaceSection({
  className,
  ...sectionProps
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...sectionProps}
      className={joinClassNames("ui-surface-section", className)}
      data-ui-section="true"
    />
  );
}
