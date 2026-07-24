"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cssPath = path.join(root, "src", "styles.css");
const uiPath = path.join(root, "src", "ui.tsx");
const uiModulePaths = [
  "dialog-shell.tsx",
  "primitives.tsx",
  "menu-surface.tsx",
  "overflow-tooltip.tsx",
  "floating-dialog-interactions.ts",
].map((file) => path.join(root, "src", "ui", file));
const mainPath = path.join(root, "src", "main.tsx");
const accountDrawerPath = path.join(root, "src", "account-drawer.tsx");
const modelConfigDialogPath = path.join(root, "src", "model-config-dialog.tsx");
const agentTextEditorDialogPath = path.join(root, "src", "agent-text-editor-dialog.tsx");
const authGatePath = path.join(root, "src", "auth-gate.tsx");
const imageViewerPath = path.join(root, "src", "image-viewer.tsx");
const referencePickerDialogPath = path.join(root, "src", "reference-picker-dialog.tsx");
const themePalettePickerPath = path.join(root, "src", "theme-palette-picker.tsx");

function readCssGraph(entryPath, seen = new Set()) {
  const resolved = path.resolve(entryPath);
  if (seen.has(resolved)) throw new Error(`circular CSS import: ${resolved}`);
  seen.add(resolved);
  const source = fs.readFileSync(resolved, "utf8");
  const expanded = source.replace(/@import\s+["']([^"']+)["']\s*;/g, (_match, request) => {
    if (!request.startsWith(".")) throw new Error(`non-local CSS import in ${resolved}: ${request}`);
    return readCssGraph(path.resolve(path.dirname(resolved), request), seen);
  });
  seen.delete(resolved);
  return expanded;
}

const cssSource = readCssGraph(cssPath);
const uiFacadeSource = fs.readFileSync(uiPath, "utf8");
const uiSource = [uiFacadeSource, ...uiModulePaths.map((file) => fs.readFileSync(file, "utf8"))].join("\n");
const mainSource = fs.readFileSync(mainPath, "utf8");
const businessUiSource = [
  accountDrawerPath,
  modelConfigDialogPath,
  agentTextEditorDialogPath,
  authGatePath,
  imageViewerPath,
  referencePickerDialogPath,
  themePalettePickerPath,
].map((file) => fs.readFileSync(file, "utf8")).concat(mainSource).join("\n");
const activeCss = cssSource.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
const failures = [];

function check(label, condition, detail = "") {
  if (!condition) failures.push(detail ? `${label}: ${detail}` : label);
}

function topLevelComma(value) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) return index;
  }
  return -1;
}

function customPropertyUses(source) {
  const uses = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("var(", cursor);
    if (start < 0) break;
    let depth = 1;
    let end = start + 4;
    while (end < source.length && depth > 0) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") depth -= 1;
      end += 1;
    }
    if (depth !== 0) {
      failures.push(`unclosed var() expression near byte ${start}`);
      break;
    }
    const body = source.slice(start + 4, end - 1);
    const name = body.match(/^\s*--([A-Za-z0-9-]+)/)?.[1];
    if (name) uses.push({ name, hasFallback: topLevelComma(body) >= 0 });
    cursor = end;
  }
  return uses;
}

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return activeCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))?.[1] || "";
}

const definitions = new Set(
  Array.from(activeCss.matchAll(/--([A-Za-z0-9-]+)\s*:/g), (match) => match[1])
);
const unresolved = customPropertyUses(activeCss)
  .filter((use) => !definitions.has(use.name) && !use.hasFallback)
  .map((use) => use.name)
  .filter((name, index, all) => all.indexOf(name) === index)
  .sort();

check("all CSS custom properties resolve or provide a fallback", unresolved.length === 0, unresolved.join(", "));
check(
  "CSS comments do not swallow rule blocks",
  !/\/\*[^\r\n]*\{/.test(cssSource),
  "found a comment opener containing a CSS rule brace"
);

const bareRootBlocks = Array.from(activeCss.matchAll(/^:root\s*\{/gm)).length;
check("theme has one bare :root authority", bareRootBlocks === 1, `found ${bareRootBlocks}`);
const canonicalThemeTokens = [
  "bg", "canvas", "surface", "surface-solid", "surface-raised", "ink", "ink-soft", "muted",
  "line", "line-strong", "accent", "accent-strong", "control-bg", "hover-bg", "active-bg"
];
for (const token of canonicalThemeTokens) {
  const declarations = Array.from(activeCss.matchAll(new RegExp(`--${token}\\s*:`, "g"))).length;
  check(`theme token --${token} has only light and dark declarations`, declarations === 2, `found ${declarations}`);
}

const requiredTokens = [
  "danger",
  "surface-2",
  "surface-strong",
  "text",
  "z-canvas",
  "z-menu",
  "z-popover",
  "z-dialog",
  "z-dialog-nested",
  "z-tooltip"
];
for (const token of requiredTokens) {
  check(`required token --${token} is defined`, definitions.has(token));
}

const focusBody = ruleBody(".ui-button-base:focus-visible");
check("ButtonBase has a focus-visible rule", Boolean(focusBody));
check("ButtonBase focus-visible uses the shared focus ring", /box-shadow\s*:\s*var\(--focus-ring\)/.test(focusBody));

const surfaceLayerBody = ruleBody(".ui-surface-layer.dialog-layer");
check(
  "DialogShell resolves its layer through the shared z contract",
  /z-index\s*:\s*var\(--ui-surface-z\s*,\s*var\(--z-dialog\)\)/.test(surfaceLayerBody)
);
check(
  "nested DialogShell level maps to the nested z token",
  /\.ui-surface-layer\.dialog-layer\[data-ui-layer-level="nested"\][\s\S]*?--ui-surface-z\s*:\s*var\(--z-dialog-nested\)/.test(activeCss)
);

const layerContracts = [
  [".canvas-stage", "z-index", "z-canvas"],
  [".canvas-context-menu", "z-index", "z-menu"],
  [".asset-context-menu", "z-index", "z-menu"],
  [".project-menu-popover", "z-index", "z-popover"],
  [".overflow-tooltip", "z-index", "z-tooltip"]
];
for (const [selector, property, token] of layerContracts) {
  const body = ruleBody(selector);
  check(`${selector} exists`, Boolean(body));
  check(
    `${selector} uses --${token}`,
    new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*var\\(--${token}\\)`).test(body)
  );
}

check("DialogShell exposes a typed layer level", /export type DialogLayerLevel = "dialog" \| "nested";/.test(uiSource));
check("DialogShell writes its layer level to the DOM", /data-ui-layer-level=\{layerLevel\}/.test(uiSource));

const publicUiSymbols = [
  "DialogShell", "DrawerShell", "SurfaceBody", "SurfaceFooter", "SurfaceHeader", "SurfaceSection",
  "ActionButton", "ButtonBase", "CodeField", "ErrorBoundary", "Field", "IconActionButton", "InlineNotice",
  "SearchField", "SegmentButton", "SegmentedControl", "StatusLine", "MenuItem", "MenuSeparator", "MenuSummary",
  "MenuSurface", "OverflowTooltipLayer", "useFloatingDialogInteractions",
];
for (const symbol of publicUiSymbols) {
  check(`${symbol} stays on the ui.tsx compatibility facade`, new RegExp(`\\b${symbol}\\b`).test(uiFacadeSource));
}

for (const primitive of ["SurfaceSection", "Field", "CodeField", "InlineNotice", "StatusLine", "MenuSurface", "MenuItem", "MenuSeparator", "MenuSummary", "SegmentedControl", "SegmentButton", "SearchField"]) {
  check(`${primitive} primitive is exported`, new RegExp(`export function ${primitive}\\b`).test(uiSource));
}
for (const selector of [".ui-surface-section", ".ui-field[data-ui-field]", ".ui-inline-notice", ".ui-status-line", ".ui-menu-surface"]) {
  check(`${selector} foundation style exists`, Boolean(ruleBody(selector)));
}

check("MenuSurface renders through the global portal", /return createPortal\(/.test(uiSource));
check("MenuSurface clamps from measured dimensions", /menu\.offsetWidth/.test(uiSource) && /menu\.scrollHeight/.test(uiSource));
check("MenuSurface exposes menu semantics", /role="menu"/.test(uiSource) && /data-ui-menu-surface="true"/.test(uiSource));
check("MenuItem exposes a fixed semantic menu contract", /data-ui-menu-item="true"/.test(uiSource) && /data-ui-tone=\{tone\}/.test(uiSource));
check("MenuItem uses icon, label, and shortcut columns", /grid-template-columns:\s*17px minmax\(0, 1fr\) max-content/.test(activeCss));
check("MenuItem danger tone has a dedicated visual rule", Boolean(ruleBody(".canvas-context-menu .ui-menu-item-danger")));
check("MenuSeparator exposes separator semantics", /role="separator"/.test(uiSource));

check(
  "Field child controls use a low-specificity foundation selector",
  /:where\(\.ui-field\[data-ui-field\]\)\s*>\s*:where\(/.test(activeCss)
);
check(
  "Field foundation does not raise specificity through :is()",
  !/\.ui-field\[data-ui-field\]\s*>\s*:is\(/.test(activeCss)
);
check(
  "business UI does not declare raw button elements",
  !/<button\b/.test(businessUiSource)
);
check(
  "business UI labels are provided by shared field/search primitives",
  !/<label\b/.test(businessUiSource)
);
check(
  "interactive non-button surfaces use the shared focus contract",
  /\[data-ui-interactive="true"\]:focus-visible/.test(activeCss) &&
    (businessUiSource.match(/data-ui-interactive="true"/g) || []).length >= 2
);
check(
  "drag-only layer handles do not claim button semantics",
  !/className="node-layer-handle"[\s\S]{0,220}?role="button"/.test(businessUiSource) &&
    !/role="button"[\s\S]{0,220}?className="node-layer-handle"/.test(businessUiSource)
);
check(
  "node editor preview keeps image open and save actions as sibling buttons",
  /className="unified-node-editor-preview-open"/.test(mainSource) &&
    /className="unified-node-editor-preview-open"[\s\S]{0,100}?data-ui-control="preview"/.test(mainSource) &&
    /className="unified-node-editor-save-image"/.test(mainSource) &&
    !/className="unified-node-editor-preview"[\s\S]{0,180}?role="button"/.test(mainSource)
);
check(
  "image viewer and floating dialogs use one pointer interaction path",
  !/beginMousePan|moveMousePan|endMousePan/.test(businessUiSource) &&
    !/beginMouseDrag|addEventListener\("mousedown",\s*beginMouseDrag/.test(uiSource)
);
check(
  "Agent history exposes state and controlled-region semantics",
  /aria-expanded=\{historyOpen\}/.test(mainSource) &&
    /aria-controls=\{PROJECT_AGENT_HISTORY_ID\}/.test(mainSource) &&
    /event\.key !== "Escape"/.test(mainSource)
);
check(
  "Agent feed follows only from the bottom or a fresh user task",
  /followBottomRef\.current/.test(mainSource) &&
    /latestMessage\?\.role === "user"/.test(mainSource) &&
    /PROJECT_AGENT_FOLLOW_DISTANCE/.test(mainSource)
);
check(
  "floating dialogs clamp previously persisted inline sizes to the viewport",
  /clamp\(rect\.width,\s*minimum\.width,\s*minimum\.maxWidth\)/.test(uiSource) &&
    /rect\.height\s*>\s*minimum\.maxHeight/.test(uiSource)
);
check(
  "non-resizable floating dialogs restore CSS height after viewport clamps",
  /dataset\.uiClampH/.test(uiSource) &&
    /style\.removeProperty\("height"\)/.test(uiSource)
);
check(
  "moving a non-resizable dialog does not freeze its content height",
  /getComputedStyle\(activeDialog\)\.resize !== "none"/.test(uiSource)
);
check(
  "floating dialogs do not write a hard-coded z-index",
  !/style\.zIndex\s*=/.test(uiSource)
);
check(
  "shared dialog layer restores compact padding on narrow viewports",
  /@media\s*\(max-width:\s*680px\)[\s\S]*?\.ui-surface-layer\.dialog-layer\s*\{[\s\S]*?padding:\s*8px/.test(activeCss)
);
check(
  "migrated dialogs do not retain the legacy image-task shell",
  !/(?:["'`\s])image-task-dialog(?:["'`\s])/.test(businessUiSource)
);
check(
  "nested model and Agent editors use DialogShell layerLevel instead of local z overrides",
  (businessUiSource.match(/layerLevel="nested"/g) || []).length >= 2 &&
    !/\.model-picker-layer\.dialog-layer\s*\{[\s\S]*?--ui-surface-z/.test(activeCss) &&
    !/\.agent-text-editor-layer\s*\{[\s\S]*?--ui-surface-z/.test(activeCss)
);
check(
  "model cache bypass happens on the sixth consecutive manual refresh",
  /manualModelRefreshCountRef\.current\s*>=\s*6/.test(businessUiSource)
);

const removedFeatureSelectors = [
  "post-preview",
  "post-live-preview",
  "plugin-",
  "repaint-",
  "experience-dialog",
  "prompt-entry-",
  "filter-list-toolbar"
];
for (const selector of removedFeatureSelectors) {
  check(`removed feature selector ${selector} stays out of active CSS`, !activeCss.includes(selector));
}

if (failures.length > 0) {
  console.error("UI foundation selftest failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`UI foundation selftest passed (${requiredTokens.length} required tokens, ${layerContracts.length} layer contracts).`);
