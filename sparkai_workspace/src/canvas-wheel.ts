import type { CanvasViewport } from "./core";

/** Explicit input policy, never guessed from a device's delta magnitude. */
export function canvasWheelViewport(current: CanvasViewport, event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "shiftKey">, pointer: { x: number; y: number }, pageHeight: number, mode: "zoom" | "pan", minimum: number, maximum: number): CanvasViewport {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const dx = event.deltaX * unit, dy = event.deltaY * unit;
  if (!event.ctrlKey && !event.metaKey && (mode === "pan" || event.shiftKey)) {
    return { ...current, x: current.x - (event.shiftKey && !dx ? dy : dx), y: current.y - (event.shiftKey && !dx ? 0 : dy) };
  }
  const scale = Math.max(minimum, Math.min(maximum, current.scale * Math.exp(-Math.max(-600, Math.min(600, dy)) * 0.0015)));
  return { x: pointer.x - (pointer.x - current.x) / current.scale * scale, y: pointer.y - (pointer.y - current.y) / current.scale * scale, scale };
}
