import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export const DIALOG_RESIZE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type ResizeDirection = typeof DIALOG_RESIZE_DIRECTIONS[number];
type DialogRect = { left: number; top: number; width: number; height: number };
type ResizeBounds = { left: number; top: number; right: number; bottom: number; minWidth: number; minHeight: number; maxWidth: number; maxHeight: number };

const GEOMETRY_PROPERTIES = ["position", "left", "top", "width", "height", "margin", "transform"] as const;
type GeometryStyle = Record<typeof GEOMETRY_PROPERTIES[number], string>;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pixels(value: string, fallback: number) {
  return /^-?(?:\d*\.)?\d+(?:px)?$/.test(value.trim()) ? parseFloat(value) : fallback;
}

function resizeBounds(dialog: HTMLElement): ResizeBounds {
  const style = window.getComputedStyle(dialog);
  const layer = dialog.closest<HTMLElement>(".ui-surface-layer");
  const layerStyle = layer ? window.getComputedStyle(layer) : null;
  const left = Math.max(0, pixels(layerStyle?.paddingLeft ?? "", 8));
  const top = Math.max(0, pixels(layerStyle?.paddingTop ?? "", 8));
  const right = Math.max(left + 1, window.innerWidth - pixels(layerStyle?.paddingRight ?? "", 8));
  const bottom = Math.max(top + 1, window.innerHeight - pixels(layerStyle?.paddingBottom ?? "", 8));
  const maxWidth = Math.max(1, Math.min(right - left, pixels(style.maxWidth, right - left)));
  const maxHeight = Math.max(1, Math.min(bottom - top, pixels(style.maxHeight, bottom - top)));
  return {
    left, top, right, bottom, maxWidth, maxHeight,
    minWidth: clamp(pixels(style.minWidth, 0) || pixels(style.getPropertyValue("--ui-surface-min-width"), 360), 1, maxWidth),
    minHeight: clamp(pixels(style.minHeight, 0) || pixels(style.getPropertyValue("--ui-surface-min-height"), 260), 1, maxHeight)
  };
}

function boundedRect(rect: DialogRect, bounds: ResizeBounds): DialogRect {
  const width = clamp(rect.width, bounds.minWidth, bounds.maxWidth);
  const height = clamp(rect.height, bounds.minHeight, bounds.maxHeight);
  return {
    width, height,
    left: clamp(rect.left, bounds.left, bounds.right - width),
    top: clamp(rect.top, bounds.top, bounds.bottom - height)
  };
}

// The edge opposite the active handle stays anchored, including at minimum
// size. Bounds are read again on each move so a viewport change cannot strand
// a captured pointer or push the dialog outside its surface layer.
function resizedRect(start: DialogRect, direction: ResizeDirection, dx: number, dy: number, bounds: ResizeBounds): DialogRect {
  const rect = boundedRect(start, bounds);
  let { left, top, width, height } = rect;
  if (direction.includes("w")) {
    const right = left + width;
    left = clamp(start.left + dx, Math.max(bounds.left, right - bounds.maxWidth), right - bounds.minWidth);
    width = right - left;
  } else if (direction.includes("e")) {
    width = clamp(start.width + dx, bounds.minWidth, Math.min(bounds.maxWidth, bounds.right - left));
  }
  if (direction.includes("n")) {
    const bottom = top + height;
    top = clamp(start.top + dy, Math.max(bounds.top, bottom - bounds.maxHeight), bottom - bounds.minHeight);
    height = bottom - top;
  } else if (direction.includes("s")) {
    height = clamp(start.height + dy, bounds.minHeight, Math.min(bounds.maxHeight, bounds.bottom - top));
  }
  return { left, top, width, height };
}

function dialogRect(dialog: HTMLElement): DialogRect {
  const rect = dialog.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: dialog.offsetWidth || rect.width, height: dialog.offsetHeight || rect.height };
}

function applyRect(dialog: HTMLElement, rect: DialogRect) {
  dialog.style.position = "fixed";
  dialog.style.left = `${rect.left}px`;
  dialog.style.top = `${rect.top}px`;
  dialog.style.width = `${rect.width}px`;
  dialog.style.height = `${rect.height}px`;
  dialog.style.margin = "0";
  dialog.style.transform = "none";
}

export function useDialogResize(dialogRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const initialStyleRef = useRef<GeometryStyle | null>(null);
  const dragRef = useRef<{
    pointerId: number; handle: HTMLElement; dialog: HTMLElement; direction: ResizeDirection;
    x: number; y: number; rect: DialogRect; cursor: string;
  } | null>(null);

  function finishResize() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.dialog.classList.remove("ui-surface-resizing");
    drag.dialog.style.cursor = drag.cursor;
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  }

  function prepareResize(dialog: HTMLElement) {
    if (!initialStyleRef.current) {
      initialStyleRef.current = Object.fromEntries(GEOMETRY_PROPERTIES.map((property) => [property, dialog.style[property]])) as GeometryStyle;
    }
    // Entrance scale must never become a stored dimension or alter an anchor.
    // Keep it disabled after Home so restoring size does not replay entrance.
    dialog.dataset.uiSizeAdjusted = "true";
  }

  useEffect(() => {
    if (!enabled) return;
    function clampToViewport() {
      finishResize();
      const dialog = dialogRef.current;
      if (dialog?.style.position === "fixed" && !dialog.classList.contains("is-maximized")) {
        applyRect(dialog, boundedRect(dialogRect(dialog), resizeBounds(dialog)));
      }
    }
    window.addEventListener("blur", finishResize);
    window.addEventListener("resize", clampToViewport);
    return () => {
      finishResize();
      window.removeEventListener("blur", finishResize);
      window.removeEventListener("resize", clampToViewport);
    };
  }, [enabled, dialogRef]);

  function onPointerDown(event: PointerEvent<HTMLElement>, direction: ResizeDirection) {
    const dialog = dialogRef.current;
    if (!enabled || event.button !== 0 || dragRef.current || !dialog || dialog.classList.contains("is-maximized")) return;
    event.preventDefault();
    event.stopPropagation();
    prepareResize(dialog);
    const rect = boundedRect(dialogRect(dialog), resizeBounds(dialog));
    applyRect(dialog, rect);
    dragRef.current = {
      pointerId: event.pointerId, handle: event.currentTarget, dialog, direction,
      x: event.clientX, y: event.clientY, rect, cursor: dialog.style.cursor
    };
    dialog.style.cursor = `${direction}-resize`;
    dialog.classList.add("ui-surface-resizing");
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer can be cancelled while its surface is being removed.
      finishResize();
    }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    applyRect(drag.dialog, resizedRect(drag.rect, drag.direction, event.clientX - drag.x, event.clientY - drag.y, resizeBounds(drag.dialog)));
  }

  function onPointerEnd(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishResize();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const dialog = dialogRef.current;
    if (!enabled || !dialog || dialog.classList.contains("is-maximized") || event.isDefaultPrevented() || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finishResize();
    if (event.key === "Home") {
      const initial = initialStyleRef.current;
      if (!initial) return;
      for (const property of GEOMETRY_PROPERTIES) dialog.style[property] = initial[property];
      initialStyleRef.current = null;
      if (dialog.style.position === "fixed") applyRect(dialog, boundedRect(dialogRect(dialog), resizeBounds(dialog)));
      return;
    }
    prepareResize(dialog);
    const step = event.shiftKey ? 64 : 24;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    applyRect(dialog, resizedRect(dialogRect(dialog), "se", dx, dy, resizeBounds(dialog)));
  }

  return { onPointerDown, onPointerMove, onPointerEnd, onKeyDown };
}
