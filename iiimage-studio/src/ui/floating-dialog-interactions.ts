import { useEffect } from "react";

declare const __IIIMAGE_AIDEBUG__: boolean;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const FLOATING_DIALOG_SELECTOR = ".image-viewer, .reference-picker-dialog:not([data-ui-surface]), .ask-user-dialog:not([data-ui-surface]), .node-editor-dialog, .region-redraw-dialog, .layer-group-viewer";
const FLOATING_DIALOG_HANDLE_SELECTOR = ".image-viewer > header, .reference-picker-dialog > header, .ask-user-dialog > header, .node-editor-dialog > header, .region-redraw-dialog > header, .layer-group-viewer > header";
const FLOATING_DIALOG_INTERACTIVE_SELECTOR = "button, input, textarea, select, a, [role='button']";
const FLOATING_DIALOG_MIN_SIZES = [
  { selector: ".node-editor-dialog", width: 920 },
  { selector: ".region-redraw-dialog", width: 760 },
  { selector: ".layer-group-viewer", width: 680 },
  { selector: ".reference-picker-dialog", width: 620 },
  { selector: ".ask-user-dialog", width: 480 },
  { selector: ".image-viewer", width: 640 }
];

function floatingDialogMinimumSize(dialog: HTMLElement) {
  const rule = FLOATING_DIALOG_MIN_SIZES.find((item) => dialog.matches(item.selector)) ?? FLOATING_DIALOG_MIN_SIZES[FLOATING_DIALOG_MIN_SIZES.length - 1];
  const maxWidth = Math.max(1, window.innerWidth - 16);
  const maxHeight = Math.max(1, window.innerHeight - 16);
  return {
    width: Math.min(rule.width, maxWidth),
    maxWidth,
    maxHeight
  };
}

function enforceFloatingDialogMinimumSize(dialog: HTMLElement) {
  const minimum = floatingDialogMinimumSize(dialog);
  const resizable = window.getComputedStyle(dialog).resize !== "none";
  if (!resizable && dialog.dataset.uiClampH === "1") {
    dialog.style.removeProperty("height");
    delete dialog.dataset.uiClampH;
  }
  const rect = dialog.getBoundingClientRect();
  const nextWidth = clamp(rect.width, minimum.width, minimum.maxWidth);
  const nextHeight = Math.min(rect.height, minimum.maxHeight);
  let changed = false;

  if (Math.abs(rect.width - nextWidth) > 0.5) {
    dialog.style.width = `${Math.round(nextWidth)}px`;
    changed = true;
  }

  if (rect.height > minimum.maxHeight + 0.5) {
    dialog.style.height = `${Math.round(nextHeight)}px`;
    if (!resizable) dialog.dataset.uiClampH = "1";
    changed = true;
  }

  if (dialog.style.position === "fixed") {
    const nextLeft = clamp(rect.left, 8, Math.max(8, window.innerWidth - nextWidth - 8));
    const nextTop = clamp(rect.top, 8, Math.max(8, window.innerHeight - nextHeight - 8));
    if (Math.abs(nextLeft - rect.left) > 0.5) {
      dialog.style.left = `${Math.round(nextLeft)}px`;
      changed = true;
    }
    if (Math.abs(nextTop - rect.top) > 0.5) {
      dialog.style.top = `${Math.round(nextTop)}px`;
      changed = true;
    }
  }

  return changed;
}

export function useFloatingDialogInteractions() {
  useEffect(() => {
    let activeCleanup: (() => void) | null = null;
    let resizeFrame = 0;
    const observedDialogs = new Set<HTMLElement>();
    const pendingResizeDialogs = new Set<HTMLElement>();
    const resizeMetrics = __IIIMAGE_AIDEBUG__
      ? (window.__iiimageResizeObserverMetrics ??= {
          created: 0,
          disconnected: 0,
          callbacks: 0,
          observed: 0,
          unobserved: 0,
          activeObservers: 0,
          activeDialogs: 0,
          maxActiveDialogs: 0
        })
      : null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            if (resizeMetrics) resizeMetrics.callbacks += 1;
            for (const entry of entries) {
              if (entry.target instanceof HTMLElement) pendingResizeDialogs.add(entry.target);
            }
            if (resizeFrame) return;
            resizeFrame = window.requestAnimationFrame(() => {
              resizeFrame = 0;
              const dialogs = [...pendingResizeDialogs];
              pendingResizeDialogs.clear();
              dialogs.forEach((dialog) => {
                if (dialog.isConnected) enforceFloatingDialogMinimumSize(dialog);
              });
            });
          });
    if (resizeObserver && resizeMetrics) {
      resizeMetrics.created += 1;
      resizeMetrics.activeObservers += 1;
    }

    function observeFloatingDialog(dialog: HTMLElement) {
      if (observedDialogs.has(dialog)) return;
      observedDialogs.add(dialog);
      resizeObserver?.observe(dialog);
      if (resizeMetrics) {
        resizeMetrics.observed += 1;
        resizeMetrics.activeDialogs += 1;
        resizeMetrics.maxActiveDialogs = Math.max(resizeMetrics.maxActiveDialogs, resizeMetrics.activeDialogs);
      }
    }

    function unobserveFloatingDialog(dialog: HTMLElement) {
      if (!observedDialogs.delete(dialog)) return;
      pendingResizeDialogs.delete(dialog);
      resizeObserver?.unobserve(dialog);
      if (resizeMetrics) {
        resizeMetrics.unobserved += 1;
        resizeMetrics.activeDialogs = Math.max(0, resizeMetrics.activeDialogs - 1);
      }
    }

    function unobserveRemovedDialogs(node: Node) {
      if (!(node instanceof Element)) return;
      if (node instanceof HTMLElement && node.matches(FLOATING_DIALOG_SELECTOR)) unobserveFloatingDialog(node);
      node.querySelectorAll<HTMLElement>(FLOATING_DIALOG_SELECTOR).forEach(unobserveFloatingDialog);
    }

    function enforceAllFloatingDialogs() {
      document.querySelectorAll<HTMLElement>(FLOATING_DIALOG_SELECTOR).forEach((dialog) => {
        enforceFloatingDialogMinimumSize(dialog);
        observeFloatingDialog(dialog);
      });
    }

    function beginFloatingDrag(event: PointerEvent) {
      const rawTarget = event.target instanceof Element ? event.target : null;
      if (__IIIMAGE_AIDEBUG__) {
        window.__iiimageLastFloatingDrag = {
          phase: "down",
          source: "pointer",
          button: event.button,
          targetTag: rawTarget?.tagName ?? "",
          targetClass: rawTarget ? String(rawTarget.getAttribute("class") ?? "") : "",
          targetText: rawTarget?.textContent?.slice(0, 80) ?? ""
        };
      }
      if (event.button !== 0) {
        if (__IIIMAGE_AIDEBUG__) window.__iiimageLastFloatingDrag = { ...window.__iiimageLastFloatingDrag, phase: "ignored", reason: "non-primary-button" };
        return;
      }
      const target = rawTarget instanceof HTMLElement ? rawTarget : rawTarget?.parentElement ?? null;
      if (!target) {
        if (__IIIMAGE_AIDEBUG__) window.__iiimageLastFloatingDrag = { ...window.__iiimageLastFloatingDrag, phase: "ignored", reason: "target-missing" };
        return;
      }
      if (target.closest(FLOATING_DIALOG_INTERACTIVE_SELECTOR)) {
        if (__IIIMAGE_AIDEBUG__) window.__iiimageLastFloatingDrag = { ...window.__iiimageLastFloatingDrag, phase: "ignored", reason: "interactive-target" };
        return;
      }
      const handle = target.closest(FLOATING_DIALOG_HANDLE_SELECTOR) as HTMLElement | null;
      if (!handle) {
        if (__IIIMAGE_AIDEBUG__) window.__iiimageLastFloatingDrag = { ...window.__iiimageLastFloatingDrag, phase: "ignored", reason: "handle-missing" };
        return;
      }
      const dialog = handle.closest(FLOATING_DIALOG_SELECTOR) as HTMLElement | null;
      if (!dialog) {
        if (__IIIMAGE_AIDEBUG__) window.__iiimageLastFloatingDrag = { ...window.__iiimageLastFloatingDrag, phase: "ignored", reason: "dialog-missing" };
        return;
      }
      const activeDialog = dialog;

      activeCleanup?.();

      const rect = activeDialog.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const clampLeft = (left: number) => clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
      const clampTop = (top: number) => clamp(top, 8, Math.max(8, window.innerHeight - rect.height - 8));

      event.preventDefault();
      activeDialog.classList.add("floating-dialog-moving");
      document.body.classList.add("floating-dialog-dragging");
      activeDialog.style.position = "fixed";
      activeDialog.style.left = `${Math.round(clampLeft(rect.left))}px`;
      activeDialog.style.top = `${Math.round(clampTop(rect.top))}px`;
      activeDialog.style.width = `${Math.round(rect.width)}px`;
      if (window.getComputedStyle(activeDialog).resize !== "none") {
        activeDialog.style.height = `${Math.round(rect.height)}px`;
      }
      activeDialog.style.margin = "0";
      activeDialog.style.transform = "none";
      activeDialog.style.removeProperty("z-index");
      enforceFloatingDialogMinimumSize(activeDialog);
      if (__IIIMAGE_AIDEBUG__) {
        window.__iiimageLastFloatingDrag = {
          ...window.__iiimageLastFloatingDrag,
          phase: "start",
          source: "pointer",
          clientX: Math.round(event.clientX),
          clientY: Math.round(event.clientY),
          offsetX: Math.round(offsetX),
          offsetY: Math.round(offsetY),
          left: Math.round(rect.left),
          top: Math.round(rect.top)
        };
      }

      function move(moveEvent: Event) {
        const dragEvent = moveEvent as PointerEvent;
        moveEvent.preventDefault();
        activeDialog.style.left = `${Math.round(clampLeft(dragEvent.clientX - offsetX))}px`;
        activeDialog.style.top = `${Math.round(clampTop(dragEvent.clientY - offsetY))}px`;
        if (__IIIMAGE_AIDEBUG__) {
          window.__iiimageLastFloatingDrag = {
            ...window.__iiimageLastFloatingDrag,
            phase: "move",
            source: "pointer",
            clientX: Math.round(dragEvent.clientX),
            clientY: Math.round(dragEvent.clientY),
            rawLeft: Math.round(dragEvent.clientX - offsetX),
            rawTop: Math.round(dragEvent.clientY - offsetY),
            left: activeDialog.style.left,
            top: activeDialog.style.top
          };
        }
      }

      function end() {
        activeDialog.classList.remove("floating-dialog-moving");
        document.body.classList.remove("floating-dialog-dragging");
        if (__IIIMAGE_AIDEBUG__) window.__iiimageLastFloatingDrag = { ...window.__iiimageLastFloatingDrag, phase: "end", source: "pointer", left: activeDialog.style.left, top: activeDialog.style.top };
        window.removeEventListener(moveEventName, move);
        window.removeEventListener(endEventName, end);
        window.removeEventListener(cancelEventName, end);
        activeCleanup = null;
      }

      const moveEventName = "pointermove";
      const endEventName = "pointerup";
      const cancelEventName = "pointercancel";
      activeCleanup = end;

      window.addEventListener(moveEventName, move, { passive: false });
      window.addEventListener(endEventName, end);
      window.addEventListener(cancelEventName, end);
    }

    function beginPointerDrag(event: PointerEvent) {
      beginFloatingDrag(event);
    }

    document.addEventListener("pointerdown", beginPointerDrag, true);
    enforceAllFloatingDialogs();
    const mutationObserver = new MutationObserver((records) => {
      records.forEach((record) => record.removedNodes.forEach(unobserveRemovedDialogs));
      const migratedSurfaceOnly = records.every((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return Boolean(target?.closest("[data-ui-surface]"));
      });
      if (!migratedSurfaceOnly) enforceAllFloatingDialogs();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", enforceAllFloatingDialogs);
    return () => {
      activeCleanup?.();
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      pendingResizeDialogs.clear();
      if (resizeMetrics && observedDialogs.size > 0) {
        resizeMetrics.unobserved += observedDialogs.size;
        resizeMetrics.activeDialogs = Math.max(0, resizeMetrics.activeDialogs - observedDialogs.size);
      }
      observedDialogs.clear();
      resizeObserver?.disconnect();
      if (resizeObserver && resizeMetrics) {
        resizeMetrics.disconnected += 1;
        resizeMetrics.activeObservers = Math.max(0, resizeMetrics.activeObservers - 1);
      }
      mutationObserver.disconnect();
      window.removeEventListener("resize", enforceAllFloatingDialogs);
      document.removeEventListener("pointerdown", beginPointerDrag, true);
    };
  }, []);
}
