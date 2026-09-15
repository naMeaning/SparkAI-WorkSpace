import type { AppSettings } from "./core";

export type AgentPanelLayout = Pick<
  AppSettings,
  "agentPanelPlacement" | "agentPanelWidth" | "agentPanelHeight" | "agentPanelX" | "agentPanelY"
>;

export type AgentPanelPointerMode = "move" | "resize-dock" | "resize-width" | "resize-height" | "resize-corner";

export type AgentPanelBounds = Pick<DOMRect, "width" | "height">;

const previewProperties = [
  "--agent-panel-preview-width",
  "--agent-panel-preview-height",
  "--agent-panel-preview-x",
  "--agent-panel-preview-y"
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function agentPanelLayoutFromSettings(settings: AppSettings): AgentPanelLayout {
  return {
    agentPanelPlacement: settings.agentPanelPlacement,
    agentPanelWidth: clamp(Math.round(Number(settings.agentPanelWidth) || 390), 320, 720),
    agentPanelHeight: clamp(Math.round(Number(settings.agentPanelHeight) || 680), 420, 1_400),
    agentPanelX: Math.max(0, Math.round(Number(settings.agentPanelX) || 0)),
    agentPanelY: Math.max(0, Math.round(Number(settings.agentPanelY) || 0))
  };
}

export function clampAgentPanelLayout(layout: AgentPanelLayout, bounds: AgentPanelBounds): AgentPanelLayout {
  const sideDocked = layout.agentPanelPlacement === "left" || layout.agentPanelPlacement === "right";
  const horizontalDocked = layout.agentPanelPlacement === "top" || layout.agentPanelPlacement === "bottom";
  const widthReserve = sideDocked ? 160 : 24;
  const heightReserve = horizontalDocked ? 160 : 24;
  const width = clamp(Math.round(layout.agentPanelWidth), 320, Math.min(720, Math.max(320, bounds.width - widthReserve)));
  const height = clamp(Math.round(layout.agentPanelHeight), 420, Math.min(1_400, Math.max(420, bounds.height - heightReserve)));
  const x = clamp(Math.round(layout.agentPanelX), 8, Math.max(8, Math.round(bounds.width - width - 8)));
  const y = clamp(Math.round(layout.agentPanelY), 8, Math.max(8, Math.round(bounds.height - height - 8)));
  return { ...layout, agentPanelWidth: width, agentPanelHeight: height, agentPanelX: x, agentPanelY: y };
}

export function agentPanelLayoutFromPointer(
  start: AgentPanelLayout,
  mode: AgentPanelPointerMode,
  dx: number,
  dy: number,
  bounds: AgentPanelBounds
) {
  const next = { ...start };
  if (mode === "move") {
    next.agentPanelX += dx;
    next.agentPanelY += dy;
  } else if (mode === "resize-dock") {
    if (start.agentPanelPlacement === "right") next.agentPanelWidth -= dx;
    if (start.agentPanelPlacement === "left") next.agentPanelWidth += dx;
    if (start.agentPanelPlacement === "top") next.agentPanelHeight += dy;
    if (start.agentPanelPlacement === "bottom") next.agentPanelHeight -= dy;
  } else {
    if (mode === "resize-width" || mode === "resize-corner") next.agentPanelWidth += dx;
    if (mode === "resize-height" || mode === "resize-corner") next.agentPanelHeight += dy;
  }
  return clampAgentPanelLayout(next, bounds);
}

export function agentPanelLayoutForPlacement(
  current: AgentPanelLayout,
  placement: AgentPanelLayout["agentPanelPlacement"],
  bounds: AgentPanelBounds
) {
  const next = { ...current, agentPanelPlacement: placement };
  if ((placement === "top" || placement === "bottom") && current.agentPanelPlacement !== placement) {
    next.agentPanelHeight = Math.max(420, Math.round(bounds.height * 0.42));
  }
  return clampAgentPanelLayout(next, bounds);
}

export function applyAgentPanelLayoutPreview(workspace: HTMLElement, layout: AgentPanelLayout) {
  workspace.style.setProperty(previewProperties[0], `${layout.agentPanelWidth}px`);
  workspace.style.setProperty(previewProperties[1], `${layout.agentPanelHeight}px`);
  workspace.style.setProperty(previewProperties[2], `${layout.agentPanelX}px`);
  workspace.style.setProperty(previewProperties[3], `${layout.agentPanelY}px`);
}

export function clearAgentPanelLayoutPreview(workspace: HTMLElement) {
  for (const property of previewProperties) workspace.style.removeProperty(property);
  workspace.classList.remove("agent-panel-interacting");
}
