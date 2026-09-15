# SparkAI WorkSpace Transparent Glass Migration

## Scope and source of truth

The visual source of truth is the checked-in prototype at
`../ui-concepts/liquid-glass-probe/`. Its `styles.css` defines the semantic
glass and color tokens, while `app.js` defines material preset behavior and
the live-setting ranges. Screenshots are review references, not token inputs.

This migration is visual and configuration-only. It must not change canvas
node identity, project persistence, Image 2 requests, Agent execution, or the
relationship graph.

## Current architecture map

- Renderer theme state: `src/core.ts` (`AppSettings`).
- Defaults and browser persistence: `src/settings-persistence.ts`.
- Live DOM application: `src/settings-runtime.ts`.
- Electron defaults and migration: `electron-main.cjs`.
- Settings surface: lazy `src/settings-drawer.tsx`.
- Shell: `.ide-shell`, `.ide-topbar`, `.ide-main.canvas-only` in
  `src/main.tsx`.
- Canvas: `.canvas-panel > .workflow-canvas`; canvas commerce/plugin dock:
  `.canvas-plugin-toolbar`.
- Sole project control center: `ProjectAgentPanel` / `.project-agent-panel`.
- Shared overlays: `.ui-surface`, `.project-menu-popover`,
  `.canvas-context-menu`.
- The current production shell has no permanent left asset rail. The user has
  explicitly expanded the migration to add the prototype rail as a real
  project-data navigator: results, layers, requirements, history, import, and
  settings. It remains a narrow left navigation surface; Project Agent remains
  the sole right-side control center.

## Migration layers

1. A shared preset registry owns six themes, light/dark metadata, base color
   tokens, five optional accents, and light/dark material values.
2. A Renderer model normalizes settings and writes only semantic CSS custom
   properties plus root data attributes. A provider applies those properties
   without replacing the canvas subtree.
3. A final CSS cascade layer maps the semantic tokens to approved chrome only:
   top bar, Agent, canvas dock, menus, dialogs, settings, controls, and floating
   actions.
4. Glass Lab edits a settings draft live and persists through the existing app
   settings bridge. A safe appearance-only local snapshot is used before React
   starts so the boot shell does not flash the wrong theme. Electron seeds the
   first React settings frame from that same safe subset while the complete
   settings file loads, preventing a saved theme from bouncing through the
   default appearance during startup.
5. Electron derives its native window background from the same saved theme so
   the native surface and boot document agree.
6. Prototype workspace affordances are mapped to real state: the left asset
   rail reads project nodes/history, Workbench/Focus/Review preserve the same
   canvas instance, the task context reflects selection, and the focus
   filmstrip selects existing results rather than mock assets.

## Hard visual boundaries

- `.flow-node` remains a solid content card.
- `.node-image-preview`, `.node-image-tile`, their `img` descendants, canvas
  compositions, and image viewers stay opaque, sharp, and free of CSS filters.
- Nested sections inside an already-glass panel use quiet separators or solid
  controls, not another full glass shadow stack.
- Project Agent remains the only permanent right-side control center.
- Theme/material changes update CSS variables only; they must not mutate or
  remount canvas nodes.

## QA inventory

| Claim or control | Functional check | Visual state/evidence |
| --- | --- | --- |
| Default is light-sky + Frosted | Fresh config and normalized legacy config resolve to defaults | As-launched desktop screenshot before resize |
| Six themes | Activate every theme through Glass Lab | Six settled 1280x720 screenshots/contact sheet |
| Three presets | Cycle Clear, Frosted, Dense and return to Frosted | Same theme/same canvas comparison frames |
| Custom mix | Select light-sky, coral accent, custom ranges | Glass Lab open screenshot and computed token snapshot |
| Live controls | Move every range and toggle noise/motion, then restore recommended values | DOM tokens change without Save; all nine values and the reset are asserted |
| Persistence | Save, close the BrowserWindow, exit Electron, then relaunch with the same config and user-data directories | Bootstrap state, disk settings, local snapshot, controls and screenshots match |
| No flash/jump | Rapidly alternate light/dark themes while nodes are present | First React appearance matches bootstrap; canvas/node DOM identity, geometry, node IDs and viewport remain unchanged |
| Image fidelity | Compare image element pixels/style before and after theme switch | `opacity=1`, `filter=none`, `backdrop-filter=none`; screenshot review |
| Shell hierarchy | Agent stays the sole right control center; left rail only navigates project material | Full desktop screenshot with settings closed/open |
| Asset rail | Results/layers/requirements/history read live project data; import and settings use existing actions | Every rail tab plus selected-node focus evidence |
| Workspace modes | Workbench/Focus/Review change presentation without recreating nodes | Three screenshots and stable node/viewport identity |
| Minimum window | Resize to the supported 884 x 640 minimum | Shell, selected node, settings footer/scroll body and menu remain inside the viewport with no page overflow |
| Overlay coverage | Open menu, dialog, settings, input focus and floating action | Focused screenshots for each surface family |
| Runtime health | Collect console errors and unhandled rejections | Empty error list in AIDEBUG report |

Exploratory checks include rapid alternating light/dark switches while an
editor is open, and relaunching with a custom high-radius/zero-blur preset.

## Completed verification

The final focused Electron run is
`.diagnostics/electron/glass-workspace-2026-07-30T12-50-53-462Z/report.json`.
It records 25 passing functional checks, 30 verified screenshots, zero
application-level Renderer errors, a graceful Electron close and cold restart,
and zero image-generation network requests. The custom restart fixture is
`light-sky + custom + coral`, with `blur=0`, `radius=24`, noise disabled and
reduced motion enabled.

The same run covers the production 884 x 640 minimum window with the shell,
Glass Lab and file menu. Runtime probes retain the exact canonical canvas and
node DOM objects and their geometry across rapid theme switching. The minimum
window probe binds its single selected DOM node to the canonical
`selectedNodeId`. The cold-restart trace retains the bootstrap entry plus the
seven most recent React layout projections and verifies every glass
field without an intermediate fallback. Light-theme muted tokens are also held
to at least 4.5:1 contrast against their solid surfaces, with main CSS, HTML and
independent Agent fallbacks locked to the registry by `test:glass-theme`.

## Existing changes to preserve

The working tree already contains substantial uncommitted work in
`src/main.tsx`, `src/core.ts`, `electron-main.cjs`, canvas/dialog/Agent CSS,
settings extraction, AIDEBUG, and CLI integration. Glass changes therefore use
new files and narrow patches; they must never reset, replace, or reformat those
unrelated edits.
