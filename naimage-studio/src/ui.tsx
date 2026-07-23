/*
naimage UI Compatibility Facade

Stable ownership lives under src/ui/:
- dialog-shell.tsx: dialog/drawer focus, close, portal, and surface regions.
- primitives.tsx: error boundary, fields, feedback, and shared buttons.
- menu-surface.tsx: menu primitives, placement, focus, and dismissal.
- overflow-tooltip.tsx: delayed global overflow-tooltip discovery.
- floating-dialog-interactions.ts: legacy floating-dialog drag and clamping.

Existing feature modules should continue importing from "./ui". The facade is
the public compatibility boundary; submodules remain implementation details.
*/

export {
  DialogShell,
  DrawerShell,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceSection
} from "./ui/dialog-shell";
export type {
  DialogClosePolicy,
  DialogCloseReason,
  DialogCloseState,
  DialogLayerLevel,
  DialogShellControls,
  DialogShellProps,
  DrawerShellProps
} from "./ui/dialog-shell";

export {
  ActionButton,
  ButtonBase,
  CodeField,
  ErrorBoundary,
  Field,
  IconActionButton,
  InlineNotice,
  SearchField,
  SegmentButton,
  SegmentedControl,
  StatusLine
} from "./ui/primitives";
export type { UiFeedbackTone } from "./ui/primitives";

export {
  MenuItem,
  MenuSeparator,
  MenuSummary,
  MenuSurface
} from "./ui/menu-surface";
export type { MenuSurfaceProps } from "./ui/menu-surface";

export { OverflowTooltipLayer } from "./ui/overflow-tooltip";
export { useFloatingDialogInteractions } from "./ui/floating-dialog-interactions";
