"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const workspaceSource = read("src", "workspace-chrome.tsx");
const mainSource = read("src", "main.tsx");
const stylesEntrySource = read("src", "styles.css");
const glassSurfaceSource = read("src", "styles", "07j-liquid-glass-surfaces.css");
const registry = JSON.parse(read("runtime", "glass-theme-presets.json"));

const expectedThemes = [
  "dark-rose",
  "dark-ember",
  "dark-emerald",
  "light-lemon",
  "light-sky",
  "light-blush"
];
const expectedMaterials = ["clear", "frosted", "dense"];

assert.deepEqual(registry.themeOrder, expectedThemes, "The glass registry must expose exactly the six supported themes in UI order");
assert.deepEqual(Object.keys(registry.themes), expectedThemes, "Every ordered glass theme must have one authored token record");
assert.deepEqual(registry.materialOrder, expectedMaterials, "The glass registry must expose Clear, Frosted and Dense presets");
assert.deepEqual(Object.keys(registry.materialPresets.dark), expectedMaterials, "Dark themes must define all three material presets");
assert.deepEqual(Object.keys(registry.materialPresets.light), expectedMaterials, "Light themes must define all three material presets");

assert.match(workspaceSource, /export type WorkspaceAssetRailTab\s*=\s*"results"\s*\|\s*"layers"\s*\|\s*"requirements"\s*\|\s*"templates"\s*\|\s*"history"/, "The asset rail must keep the five product tabs as a closed contract");
for (const [id, label] of [["results", "成果"], ["layers", "图层"], ["requirements", "需求"], ["templates", "模板"], ["history", "历史"]]) {
  assert.match(workspaceSource, new RegExp(`\\{ id: "${id}", label: "${label}"`), `The ${id} asset tab must remain visible and labelled`);
}
assert.match(workspaceSource, /tab === "layers"[\s\S]{0,180}node\.layerGroup \|\| node\.layerComposition/, "The layers tab must derive from real layer nodes");
assert.match(workspaceSource, /tab === "requirements"[\s\S]{0,140}node\.type === "requirement"/, "The requirements tab must derive from real requirement nodes");
assert.match(workspaceSource, /node\.type === "image"[\s\S]{0,180}node\.assets\?\.length[\s\S]{0,100}node\.imageState === "generating"/, "The results tab must derive from real image results and in-flight image nodes");
assert.match(workspaceSource, /tab === "history" \? historyItems\.map\(\(conversation\)[\s\S]{0,650}onSelectConversation\(conversation\.id\)/, "The history tab must invoke the real conversation selection action");
assert.match(workspaceSource, /if \(tab === "templates"\) loadRequirementTemplatesRef\.current\?\.\(\)/, "Opening Templates must lazily load the personal requirement library");
assert.match(workspaceSource, /requirementTemplates\.slice\(0, 200\)/, "The Templates rail must expose the complete 200-item local library contract");
assert.match(workspaceSource, /onClick=\{tab === "templates" \? onSaveRequirementTemplate : onImport\}/, "The Templates header action must save the selected requirement instead of importing an image");
assert.match(workspaceSource, /onClick=\{\(\) => onUseRequirementTemplate\?\.\(template\.id\)\}/, "Template selection must invoke the real insertion action with a stable template id");
assert.match(workspaceSource, /if \(!deleteArmed\)[\s\S]{0,180}setDeleteArmedTemplateId\(template\.id\)[\s\S]{0,220}onDeleteRequirementTemplate\?\.\(template\.id\)/, "Template deletion must require a second confirming click");
assert.match(workspaceSource, /data-node-id=\{node\.id\}[\s\S]{0,350}onSelectNode\(node\.id\)/, "Node tabs must invoke the real node selection action with stable node ids");
assert.match(workspaceSource, /onClick=\{tab === "templates" \? onSaveRequirementTemplate : onImport\}/, "The asset rail header must keep the real import action outside the Templates tab");
assert.match(workspaceSource, /onClick=\{onOpenSettings\}/, "The asset rail settings button must invoke the real settings action");
assert.match(workspaceSource, /export function WorkspaceSearch[\s\S]{0,1800}nodeResults[\s\S]{0,1200}conversationResults/, "Project search must derive results from live nodes and conversations");
assert.match(workspaceSource, /event\.key\.toLowerCase\(\) !== "k"[\s\S]{0,180}setOpen\(true\)/, "Project search must expose the Ctrl or Command K shortcut");
assert.match(workspaceSource, /if \(result\.kind === "node"\) onSelectNode\(result\.id\);[\s\S]{0,120}else onSelectConversation\(result\.id\);/, "Project search results must invoke real node or conversation selection");
assert.match(workspaceSource, /normalizedLabel === query[\s\S]{0,180}normalizedLabel\.startsWith\(query\)[\s\S]{0,180}searchText\.includes\(query\)/, "Project search must rank exact labels ahead of prefix and content matches");
assert.match(workspaceSource, /className="workspace-focus-add"[\s\S]{0,180}onContinueNode\(active\.id\)/, "Focus mode must expose a real continue-version action for the active result");
assert.match(workspaceSource, /aria-pressed=\{node\.id === selectedNodeId\}[\s\S]{0,220}onSelectNode\(node\.id\)/, "Review cards must persist the chosen direction through the canonical selection action");

assert.match(mainSource, /<LazyWorkspaceAssetRail[\s\S]{0,650}nodes=\{canvasNodes\}[\s\S]{0,650}conversations=\{conversations\}[\s\S]{0,650}onSelectConversation=\{switchProjectConversation\}[\s\S]{0,650}onImport=\{importWorkspaceAssets\}/, "The async shell must bind the asset rail to live canvas, conversation and import state");
assert.match(mainSource, /loadWorkspaceChrome\(\)[\s\S]{0,180}module\.WorkspaceAssetRail/, "Workspace chrome must stay behind one natural async module boundary");
assert.match(mainSource, /<LazyWorkspaceSearch[\s\S]{0,520}nodes=\{canvasNodes\}[\s\S]{0,520}conversations=\{conversations\}[\s\S]{0,520}onSelectNode=\{selectWorkspaceNavigatorNode\}[\s\S]{0,520}onSelectConversation=\{switchProjectConversation\}/, "The async project search must bind live project state and navigation actions");
assert.match(mainSource, /function selectWorkspaceNavigatorNode[\s\S]{0,420}requiresWorkbenchProjection[\s\S]{0,420}replaceSelectedNodeId\(node\.id\)[\s\S]{0,520}setWorkspaceViewMode\("workbench"\)[\s\S]{0,220}focusWorkflowNode\(node, \{ revealInspector: false, recordEvent: false, selectNode: false \}\)/, "Workspace navigation must replace the canonical selection and return non-projectable targets to the Workbench before focusing them");
assert.match(mainSource, /function changeWorkspaceViewMode[\s\S]{0,480}replaceSelectedNodeId\(nextImage\.id\)/, "Entering a projected workspace mode must replace a non-image selection with a real image result");
assert.match(mainSource, /function continueWorkspaceImageNode[\s\S]{0,420}replaceSelectedNodeId\(node\.id\)[\s\S]{0,180}openNodeEditor\(node, 0\)/, "Focus continuation must select the result canonically and open its existing confirmation editor instead of dispatching generation immediately");
assert.match(mainSource, /<LazyWorkspaceFocusStage[\s\S]{0,360}onContinueNode=\{continueWorkspaceImageNode\}/, "The Focus projection must bind its continue action to the confirmation editor");
assert.match(mainSource, /const \[availableImageModels, setAvailableImageModels\][\s\S]{0,850}selectedImageModelsFromSettings\(settings\)[\s\S]{0,850}settings\.imageModelBindings/, "Composer model availability must retain selected and credential-bound image models independently of the active checkbox pool");
assert.match(mainSource, /const composerImageModels = useMemo\([\s\S]{0,320}\.\.\.availableImageModels[\s\S]{0,320}\.\.\.selectedComposerImageModels/, "Composer chips must be driven by the persistent available-model catalog, not only the current selection");
assert.match(mainSource, /function openWorkspaceLayerNode[\s\S]{0,260}node\?\.layerGroup[\s\S]{0,180}openLayerGroupViewer\(node\.id\)[\s\S]{0,220}node\?\.layerComposition[\s\S]{0,120}openNodeEditor\(node\)/, "The layer rail must open modern groups in the viewer and legacy compositions in their supported editor");
assert.match(workspaceSource, /node\.layerComposition[\s\S]{0,220}双击打开图层编辑器/, "Legacy layer compositions must advertise the editor they actually open");

const renderMarker = mainSource.indexOf("MAIN 11 Main Workspace Render Tree");
const renderSource = mainSource.slice(renderMarker);
const canvasPanelIndex = renderSource.indexOf('<section className="canvas-panel">');
const canvasMountIndex = renderSource.indexOf("ref={bindCanvasRef}", canvasPanelIndex);
const focusStageIndex = renderSource.indexOf('<LazyWorkspaceFocusStage', canvasMountIndex);
const reviewStageIndex = renderSource.indexOf('<LazyWorkspaceReviewGrid', canvasMountIndex);
assert.ok(renderMarker >= 0 && canvasPanelIndex >= 0 && canvasMountIndex > canvasPanelIndex, "The canonical workflow canvas must remain mounted in the workspace render tree");
assert.doesNotMatch(renderSource.slice(canvasPanelIndex, canvasMountIndex), /workspaceViewMode\s*===/, "No workspace mode may conditionally mount the canonical canvas");
assert.ok(focusStageIndex > canvasMountIndex && reviewStageIndex > canvasMountIndex, "Focus and Review must remain sibling projections after the canonical canvas mount");
assert.match(renderSource, /workspaceViewMode === "focus"[\s\S]{0,260}<LazyWorkspaceFocusStage/, "Focus mode must use the focus projection");
assert.match(renderSource, /workspaceViewMode === "review"[\s\S]{0,260}<LazyWorkspaceReviewGrid/, "Review mode must use the review projection");

assert.match(stylesEntrySource, /@import "\.\/styles\/01-liquid-glass-tokens\.css";/, "The glass token bridge must be part of the ordered stylesheet entry");
assert.match(stylesEntrySource, /@import "\.\/styles\/07j-liquid-glass-surfaces\.css";/, "The final glass surface contract must be part of the ordered stylesheet entry");
const protectionStart = glassSurfaceSource.indexOf("Canvas content protection");
const protectionEnd = glassSurfaceSource.indexOf("Explicit preference", protectionStart);
assert.ok(protectionStart >= 0 && protectionEnd > protectionStart, "The glass stylesheet must keep an explicit canvas content-protection section");
const protectionSource = glassSurfaceSource.slice(protectionStart, protectionEnd);
for (const selector of [
  ".flow-node .node-image-preview img",
  ".flow-node .node-image-tile img",
  ".flow-node .container-image-tile img",
  ".workspace-focus-card img",
  ".workspace-focus-filmstrip img",
  ".workspace-review-card img"
]) {
  assert.ok(protectionSource.includes(selector), `${selector} must be protected from glass compositing`);
}
assert.match(protectionSource, /opacity:\s*1\s*!important;/, "Rendered images must stay fully opaque");
assert.match(protectionSource, /filter:\s*none\s*!important;/, "Rendered images must not inherit visual filters");
assert.match(protectionSource, /-webkit-backdrop-filter:\s*none\s*!important;/, "Rendered images must disable WebKit backdrop filtering");
assert.match(protectionSource, /backdrop-filter:\s*none\s*!important;/, "Rendered images must disable backdrop filtering");
assert.match(protectionSource, /mix-blend-mode:\s*normal\s*!important;/, "Rendered images must keep normal color blending");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 59 })}\n`);
