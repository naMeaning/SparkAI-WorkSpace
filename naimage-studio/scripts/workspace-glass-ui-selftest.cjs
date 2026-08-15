"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const workspaceSource = read("src", "workspace-chrome.tsx");
const mainSource = read("src", "main.tsx");
const imageViewerSource = read("src", "image-viewer.tsx");
const stylesEntrySource = read("src", "styles.css");
const baseControlsSource = read("src", "styles", "01-base-controls.css");
const glassTokenSource = read("src", "styles", "01-liquid-glass-tokens.css");
const glassSurfaceSource = read("src", "styles", "07j-liquid-glass-surfaces.css");
const canvasWorkspaceSource = read("src", "styles", "02-canvas-workspace.css");
const workbenchRepairSource = read("src", "styles", "07c-module-and-editor-repair.css");
const dialogViewerSource = read("src", "styles", "04-dialogs-viewers.css");
const editorDialogSource = read("src", "styles", "07f-editor-dialog-overrides.css");
const imageGenerationMetadataSource = read("src", "image-generation-metadata.ts");
const agentPanelSource = read("src", "styles", "07g-agent-panel-overrides.css");
const settingsAppearanceSource = read("src", "styles", "04-settings-appearance.css");
const settingsDrawerSource = read("src", "settings-drawer.tsx");
const canvasToolsSettingsSource = read("src", "canvas-tools-settings-panel.tsx");
const settingsPersistenceSource = read("src", "settings-persistence.ts");
const electronMainSource = read("electron-main.cjs");
const glassLabSource = read("src", "styles", "04b-glass-lab.css");
const glassLabComponentSource = read("src", "glass-lab.tsx");
const glassBackgroundSource = read("src", "glass-background.ts");
const glassThemeProviderSource = read("src", "glass-theme-provider.tsx");
const scientificDialogSource = read("src", "scientific-figure-dialog.tsx");
const scientificDialogStyleSource = read("src", "styles", "04h-scientific-figure-dialog.css");
const preloadSource = read("preload.cjs");
const projectIpcSource = read("desktop", "ipc", "project-ipc.cjs");
const registry = JSON.parse(read("runtime", "glass-theme-presets.json"));

const expectedThemes = [
  "dark-rose",
  "dark-ember",
  "dark-emerald",
  "light-silver",
  "light-lemon",
  "light-sky",
  "light-blush"
];
const expectedMaterials = ["clear", "frosted", "dense"];

assert.deepEqual(registry.themeOrder, expectedThemes, "The glass registry must expose exactly the seven supported themes in UI order");
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
assert.match(workspaceSource, /保存方法/, "The Templates rail must explain how to save a requirement before selection");
assert.match(workspaceSource, /可以保存/, "The Templates rail must visibly acknowledge when the selected requirement can be saved");
assert.match(workspaceSource, /onClick=\{\(\) => onUseRequirementTemplate\?\.\(template\.id\)\}/, "Template selection must invoke the real insertion action with a stable template id");
assert.match(workspaceSource, /if \(!deleteArmed\)[\s\S]{0,180}setDeleteArmedTemplateId\(template\.id\)[\s\S]{0,220}onDeleteRequirementTemplate\?\.\(template\.id\)/, "Template deletion must require a second confirming click");
assert.match(workspaceSource, /data-node-id=\{node\.id\}[\s\S]{0,350}onSelectNode\(node\.id\)/, "Node tabs must invoke the real node selection action with stable node ids");
assert.match(workspaceSource, /onClick=\{tab === "templates" \? onSaveRequirementTemplate : onImport\}/, "The asset rail header must keep the real import action outside the Templates tab");
assert.match(workspaceSource, /onClick=\{onOpenSettings\}/, "The asset rail settings button must invoke the real settings action");
assert.match(workspaceSource, /visibleTabs\s*=\s*defaultVisibleRailTabs/, "The asset rail must default legacy callers to all five visible tabs");
assert.match(workspaceSource, /const visibleRailTabs = useMemo[\s\S]{0,320}railTabs\.filter\(\(item\) => visible\.has\(item\.id\)\)/, "The asset rail must render only tabs enabled by settings");
assert.match(workspaceSource, /const tab = visibleRailTabs\.some[\s\S]{0,220}visibleRailTabs\[0\]\.id/, "The active asset tab must fall back to the first visible tab");
assert.match(workspaceSource, /useEffect\(\(\) => \{\s*if \(selectedTab !== tab\) setSelectedTab\(tab\);\s*\}, \[selectedTab, tab\]\)/, "Hiding the active asset tab must commit the visible fallback");
assert.match(workspaceSource, /\{visibleRailTabs\.map\(\(item\) => \(/, "Hidden asset tabs must not remain mounted in the rail navigation");
assert.match(workspaceSource, /key: `\$\{node\.id\}:result-group`[\s\S]{0,180}groupAssetIndices/, "Each multi-image result must occupy one compact asset-rail entry");
assert.match(workspaceSource, /createPortal\(\([\s\S]{0,240}data-asset-group-preview/, "Image-group previews must render through a portal outside the clipped asset rail");
assert.match(workspaceSource, /data-domain-tools-launcher[\s\S]{0,420}setDomainToolsAnchor/, "The asset rail must expose one expandable domain-tools launcher");
assert.match(workspaceSource, /createPortal\(\([\s\S]{0,260}data-domain-tools-menu/, "The domain-tools menu must render through a readable portal");
assert.match(workspaceSource, /data-domain-tool-command=\{tool\.command\}[\s\S]{0,420}onExecuteDomainTool\?\.\(tool\.command\)/, "The domain menu must reuse the canonical tool executor");
assert.match(workspaceSource, /export function WorkspaceSearch[\s\S]{0,1800}nodeResults[\s\S]{0,1200}conversationResults/, "Project search must derive results from live nodes and conversations");
assert.match(workspaceSource, /event\.key\.toLowerCase\(\) !== "k"[\s\S]{0,180}setOpen\(true\)/, "Project search must expose the Ctrl or Command K shortcut");
assert.match(workspaceSource, /if \(result\.kind === "node"\) onSelectNode\(result\.id\);[\s\S]{0,120}else onSelectConversation\(result\.id\);/, "Project search results must invoke real node or conversation selection");
assert.match(workspaceSource, /normalizedLabel === query[\s\S]{0,180}normalizedLabel\.startsWith\(query\)[\s\S]{0,180}searchText\.includes\(query\)/, "Project search must rank exact labels ahead of prefix and content matches");
assert.match(workspaceSource, /className="workspace-focus-add"[\s\S]{0,220}onContinueNode\(active\.node\.id\)/, "Focus mode must expose a real continue-version action for the active result asset");
assert.match(workspaceSource, /selectedNodeIds\s*=\s*\[\][\s\S]{0,900}focusAssetGroups\(nodes, selectedNodeId, selectedNodeIds\)/, "Focus mode must derive its image groups from the full current multi-selection");
assert.match(workspaceSource, /groups\.selectedCount <= 1[\s\S]{0,100}onSelectNode\(item\.node\.id\)/, "Switching a Focus thumbnail must preserve an existing multi-selection");
assert.match(workspaceSource, /aria-pressed=\{node\.id === selectedNodeId\}[\s\S]{0,220}onSelectNode\(node\.id\)/, "Review cards must persist the chosen direction through the canonical selection action");

assert.match(mainSource, /<LazyWorkspaceAssetRail[\s\S]{0,650}nodes=\{canvasNodes\}[\s\S]{0,650}conversations=\{conversations\}[\s\S]{0,650}onSelectConversation=\{switchProjectConversation\}[\s\S]{0,650}onImport=\{importWorkspaceAssets\}/, "The async shell must bind the asset rail to live canvas, conversation and import state");
assert.match(mainSource, /node\.scientificFigure \? "scientific-figure-node" : ""/, "Scientific plans, figures and Panel previews must receive the shared scientific Glass node class");
assert.match(mainSource, /visibleTabs=\{settings\.visibleWorkspaceAssetRailTabs\}/, "The live asset rail must consume the persisted visibility preference");
assert.match(mainSource, /保存为个人需求模板/, "Requirement context menus must expose a direct personal-template save action");
assert.match(mainSource, /保存 Skill 到个人模板/, "Skill context menus must expose a direct personal-template save action");
assert.match(mainSource, /canvasMenu\.kind === "canvas"[\s\S]{0,2400}setCanvasMenu\(null\);[\s\S]{0,160}openCurrentProjectFolder\(\);[\s\S]{0,180}打开当前项目文件夹/, "The blank canvas context menu must expose the real current-project-folder action");
assert.match(settingsDrawerSource, /visibleAssetRailTabs=\{draftSettings\.visibleWorkspaceAssetRailTabs\}[\s\S]{0,650}update\("visibleWorkspaceAssetRailTabs", visibleWorkspaceAssetRailTabs\)/, "The Tools settings page must update asset rail visibility through the normal settings draft");
assert.match(settingsDrawerSource, /shortcuts=\{draftSettings\.canvasToolShortcuts\}[\s\S]{0,520}update\("canvasToolShortcuts", canvasToolShortcuts\)/, "The Tools settings page must update shortcut overrides through the normal settings draft");
for (const [id, label] of [["results", "成果"], ["layers", "图层"], ["requirements", "需求"], ["templates", "模板"], ["history", "历史"]]) {
  assert.match(canvasToolsSettingsSource, new RegExp(`\\{ id: "${id}", label: "${label}"`), `The Tools settings page must expose the ${id} visibility checkbox`);
}
assert.match(canvasToolsSettingsSource, /if \(!visible && visibleAssetRailTabs\.length <= 1\) return;/, "The Tools settings handler must reject hiding the final visible asset module");
assert.match(canvasToolsSettingsSource, /disabled=\{lastVisible\}/, "The final visible asset module checkbox must explain the invariant before the user clicks it");
assert.match(canvasToolsSettingsSource, /data-shortcut-recorder/, "Each enabled canvas tool must expose a focused shortcut recorder");
assert.match(canvasToolsSettingsSource, /canvasToolShortcutsConflict\(tool\.shortcut, shortcut\)/, "Shortcut recording must reject collisions with another declared canvas tool");
assert.match(canvasToolsSettingsSource, /delete next\[command\]/, "Each customized tool shortcut must support an independent reset to its manifest default");
assert.match(settingsPersistenceSource, /visibleWorkspaceAssetRailTabs:\s*\[\.\.\.WORKSPACE_ASSET_RAIL_TAB_VALUES\]/, "Legacy Renderer settings must default all asset modules to visible");
assert.match(settingsPersistenceSource, /canvasToolShortcuts:\s*\{\}/, "Legacy Renderer settings must default to manifest shortcuts without storing overrides");
assert.match(settingsPersistenceSource, /next\.canvasToolShortcuts = normalizeCanvasToolShortcuts\(source\.canvasToolShortcuts\)/, "Renderer settings migration must sanitize shortcut overrides");
assert.match(settingsPersistenceSource, /return visible\.length \? visible : \["results"\]/, "Renderer settings normalization must retain at least one asset module");
assert.match(electronMainSource, /visibleWorkspaceAssetRailTabs:\s*\["results", "layers", "requirements", "templates", "history"\]/, "Electron settings must mirror the five default visible asset modules");
assert.match(electronMainSource, /canvasToolShortcuts:\s*\{\}/, "Electron settings must mirror the empty shortcut override default");
assert.match(electronMainSource, /next\.canvasToolShortcuts = normalizeCanvasToolShortcuts\(source\.canvasToolShortcuts\)/, "Electron settings migration must sanitize shortcut overrides before persistence");
assert.match(electronMainSource, /next\.visibleWorkspaceAssetRailTabs = defaultSettings\.visibleWorkspaceAssetRailTabs\.filter[\s\S]{0,240}next\.visibleWorkspaceAssetRailTabs = \["results"\]/, "Electron settings migration must sanitize asset modules and retain one visible module");
assert.match(mainSource, /loadWorkspaceChrome\(\)[\s\S]{0,180}module\.WorkspaceAssetRail/, "Workspace chrome must stay behind one natural async module boundary");
assert.match(mainSource, /<LazyWorkspaceSearch[\s\S]{0,520}nodes=\{canvasNodes\}[\s\S]{0,520}conversations=\{conversations\}[\s\S]{0,520}onSelectNode=\{selectWorkspaceNavigatorNode\}[\s\S]{0,520}onSelectConversation=\{switchProjectConversation\}/, "The async project search must bind live project state and navigation actions");
assert.match(mainSource, /function selectWorkspaceNavigatorNode[\s\S]{0,420}requiresWorkbenchProjection[\s\S]{0,420}replaceSelectedNodeId\(node\.id\)[\s\S]{0,520}setWorkspaceViewMode\("workbench"\)[\s\S]{0,220}focusWorkflowNode\(node, \{ revealInspector: false, recordEvent: false, selectNode: false \}\)/, "Workspace navigation must replace the canonical selection and return non-projectable targets to the Workbench before focusing them");
assert.match(mainSource, /function changeWorkspaceViewMode[\s\S]{0,480}replaceSelectedNodeId\(nextImage\.id\)/, "Entering a projected workspace mode must replace a non-image selection with a real image result");
assert.match(mainSource, /function continueWorkspaceImageNode[\s\S]{0,420}replaceSelectedNodeId\(node\.id\)[\s\S]{0,180}openNodeEditor\(node, 0\)/, "Focus continuation must select the result canonically and open its existing confirmation editor instead of dispatching generation immediately");
assert.match(mainSource, /<LazyWorkspaceFocusStage[\s\S]{0,360}onContinueNode=\{continueWorkspaceImageNode\}/, "The Focus projection must bind its continue action to the confirmation editor");
assert.match(mainSource, /<LazyWorkspaceFocusStage[\s\S]{0,220}selectedNodeIds=\{selectedNodeIds\}/, "The Focus projection must receive the canonical multi-selection");
assert.match(mainSource, /async function startProjectDataMigration\(\)[\s\S]{0,900}previewProjectDataMigration[\s\S]{0,1200}openConfirmDialog\(\{[\s\S]{0,500}action: "migrate-project-data"/, "The File menu migration flow must preview legacy data before it can request confirmation");
assert.match(mainSource, /async function confirmProjectDataMigration\(\)[\s\S]{0,700}migrateProjectData[\s\S]{0,900}previewToken: preview\.previewToken[\s\S]{0,220}candidateIds:[\s\S]{0,220}confirmed: true/, "Project migration must submit the confirmed preview token and candidate ids through preload");
assert.match(projectIpcSource, /ipcMain\.handle\("naimage:project:migrate"[\s\S]{0,900}dialog\.showOpenDialog\(\{[\s\S]{0,240}properties: \["openDirectory", "createDirectory"\][\s\S]{0,500}targetParent: target\.filePaths\[0\]/, "Electron Main must own migration destination selection instead of accepting a Renderer path");
assert.match(mainSource, /async function confirmCleanupMigratedProjectData\(migrationId: string\)[\s\S]{0,500}cleanupMigratedProjectData[\s\S]{0,500}confirmedCleanup: true/, "Legacy source cleanup must use a separate explicit confirmation path");
assert.match(mainSource, /async function exportImageCollectionsFromUi\(collectionIds: readonly string\[\]\)[\s\S]{0,900}previewImageCollectionsForExport\([\s\S]{0,500}setImageCollectionExportDialog/, "GUI image-collection export must open from a Main-backed preview instead of exporting immediately");
assert.match(mainSource, /async function confirmImageCollectionExport\(\)[\s\S]{0,700}previewToken: draft\.preview\.previewToken[\s\S]{0,180}confirmed: true[\s\S]{0,900}IMAGE_COLLECTION_EXPORT_PREVIEW_STALE[\s\S]{0,500}previewImageCollectionsForExport/, "A stale image-collection preview must be refreshed and confirmed again before export");
assert.match(mainSource, /const \[availableImageModels, setAvailableImageModels\][\s\S]{0,850}selectedImageModelsFromSettings\(settings\)[\s\S]{0,850}settings\.imageModelBindings/, "Composer model availability must retain selected and credential-bound image models independently of the active checkbox pool");
assert.match(mainSource, /const composerImageModels = useMemo\([\s\S]{0,320}\.\.\.availableImageModels[\s\S]{0,320}\.\.\.selectedComposerImageModels/, "Composer chips must be driven by the persistent available-model catalog, not only the current selection");
assert.match(mainSource, /function openWorkspaceLayerNode[\s\S]{0,260}node\?\.layerGroup[\s\S]{0,180}openLayerGroupViewer\(node\.id\)[\s\S]{0,220}node\?\.layerComposition[\s\S]{0,120}openNodeEditor\(node\)/, "The layer rail must open modern groups in the viewer and legacy compositions in their supported editor");
assert.match(workspaceSource, /node\.layerComposition[\s\S]{0,220}双击打开图层编辑器/, "Legacy layer compositions must advertise the editor they actually open");
assert.match(mainSource, /className="unified-node-editor-image-specs"[\s\S]{0,260}editorAssetRatio[\s\S]{0,160}editorAssetPixels/, "The result editor preview must expose the final image ratio and pixel dimensions beside the artwork");
assert.match(mainSource, /className="node-editor-generation-details"[\s\S]{0,260}data-generation-source=\{generationSource\}[\s\S]{0,700}data-generation-param=\{row\.key\}/, "The result editor must render per-image generation parameters with an observable source contract");
assert.match(mainSource, /row\.actualSource === "api" \? "响应" : row\.actualSource === "asset" \? "成图" : "本次"/, "Requested, API response, final asset and runtime values must remain visibly distinct");
assert.match(mainSource, /data-node-editor-action="toggle-maximize"[\s\S]{0,420}setNodeEditorMaximized\(\(current\) => !current\)[\s\S]{0,220}Minimize2/, "The result editor must expose an accessible maximize and restore control in its header");
assert.match(imageGenerationMetadataSource, /export function sanitizeImageAssetGenerationMetadata[\s\S]{0,2400}version:\s*1/, "Persisted image-generation metadata must pass through a versioned whitelist sanitizer");
assert.match(imageGenerationMetadataSource, /export function actualImageAspectRatio[\s\S]{0,520}greatestCommonDivisor/, "Displayed aspect ratios must derive from final pixel dimensions instead of inferred provider defaults");
assert.match(editorDialogSource, /\.node-editor-generation-grid[\s\S]{0,220}grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, "Generation parameters must use a stable compact grid in the result editor");
assert.match(editorDialogSource, /\.unified-node-editor\.is-maximized\s*\{[\s\S]{0,260}width:\s*calc\(100vw - 24px\);[\s\S]{0,160}height:\s*calc\(100dvh - 24px\);/, "The result editor maximize state must expand both axes to the available viewport");
assert.match(editorDialogSource, /\.node-editor-generation-grid dt\s*\{[\s\S]{0,180}font-size:\s*12px;[\s\S]{0,420}\.node-editor-generation-grid dd\s*\{[\s\S]{0,220}font-size:\s*12px;/, "Generation parameter labels and values must keep a readable 12 px minimum");

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
assert.match(glassTokenSource, /--glass-menu-surface:\s*color-mix\(in srgb, var\(--glass-surface-solid\) 88%, rgb\(var\(--glass-rgb\)\)\);/, "Glass menus must use a dedicated near-opaque surface token");
assert.match(glassSurfaceSource, /\.canvas-context-menu\.canvas-context-menu[\s\S]{0,220}background-color:\s*var\(--glass-menu-surface\);/, "Canvas menus must win the generic glass surface specificity and paint the opaque menu token");
assert.match(baseControlsSource, /--font-xs:\s*12px;[\s\S]{0,80}--font-sm:\s*13px;[\s\S]{0,80}--font-ui:\s*14px;[\s\S]{0,80}--font-title:\s*15px;/, "The shared UI typography scale must remain one readable step above the former micro-text baseline");
assert.match(baseControlsSource, /body\s*\{[\s\S]{0,260}font-size:\s*14px;/, "The application body must use the readable 14 px desktop baseline");
assert.match(agentPanelSource, /\.project-agent-panel \.markdown-body\s*\{[\s\S]{0,220}font-size:\s*13px;/, "Agent prose must remain readable at 13 px");
assert.match(agentPanelSource, /\.project-agent-status span\s*\{[\s\S]{0,240}font-size:\s*12px;/, "Agent status text must not fall back to micro text");
assert.match(agentPanelSource, /\.project-agent-model-row\s*\{[\s\S]{0,300}font-size:\s*13px;/, "Agent model choices must use a readable desktop size");
assert.match(glassSurfaceSource, /:root\.glass-theme-active \.workspace-search-popover\.workspace-search-popover,[\s\S]{0,320}background-color:\s*var\(--glass-menu-surface\);[\s\S]{0,160}backdrop-filter:\s*none;/, "Project search must match the generic glass surface specificity and paint a dedicated near-opaque menu surface without background bleed");
assert.match(glassSurfaceSource, /\.workspace-search-popover input\s*\{[\s\S]{0,260}font-size:\s*12px;[\s\S]{0,5000}\.workspace-search-result strong\s*\{[\s\S]{0,120}font-size:\s*11px;[\s\S]{0,240}font-size:\s*10px;/, "Project search input, titles and details must use the raised readable type scale");
assert.match(glassSurfaceSource, /@media \(max-width: 1000px\)[\s\S]{0,700}\.project-actions > \.project-menu:not\(\.file-command-menu\)[\s\S]{0,180}flex:\s*1 1 auto;[\s\S]{0,180}overflow:\s*hidden;[\s\S]{0,320}max-width:\s*100%;/, "The project name control must shrink without internal overflow at the supported minimum window width");
assert.match(mainSource, /function openImageViewer[\s\S]{0,360}asset\.status !== "pending" && entry\.asset\.status !== "error" && imageAssetSrc\(entry\.asset\)/, "The image viewer must reject pending and failed assets before rendering its final list");
assert.match(imageViewerSource, /aria-label="最终图片列表"[\s\S]{0,180}data-final-asset-count=\{viewer\.assets\.length\}[\s\S]{0,420}data-final-asset="true"/, "The image viewer must expose an explicit final-only thumbnail list");
assert.match(dialogViewerSource, /\.image-viewer-strip\s*\{[\s\S]{0,260}display:\s*flex;[\s\S]{0,120}flex-wrap:\s*nowrap;[\s\S]{0,180}overflow-x:\s*auto;[\s\S]{0,80}overflow-y:\s*hidden;/, "Viewer thumbnails must stay in one horizontally scrollable row");
assert.match(mainSource, /style\.setProperty\("--node-drag-x"[\s\S]{0,180}style\.setProperty\("--node-drag-y"[\s\S]{0,2600}style\.willChange = "transform"/, "Ordinary node drags must update compositor variables and promote transform instead of left/top per frame");
assert.match(canvasWorkspaceSource, /\.flow-node\.dragging,[\s\S]{0,320}transform:\s*translate3d\(var\(--node-drag-x, 0px\), var\(--node-drag-y, 0px\), 0\);[\s\S]{0,160}transition:\s*none;/, "Dragging nodes must consume compositor translations without transition lag");
assert.match(workbenchRepairSource, /\.flow-node\.dragging\s*\{[\s\S]{0,180}transform:\s*translate3d\(var\(--node-drag-x, 0px\), var\(--node-drag-y, 0px\), 0\);[\s\S]{0,180}will-change:\s*transform;/, "The later workbench repair cascade must preserve the compositor drag transform");
assert.match(glassSurfaceSource, /:root\[data-glass-reduce-motion="true"\] \.flow-node:is\(\.dragging, \.resizing\),[\s\S]{0,320}transition-property:\s*none !important;[\s\S]{0,120}transition-duration:\s*0s !important;/, "Reduced-motion Glass settings must not delay the first compositor drag frame");
const imageContainerRule = canvasWorkspaceSource.match(/\.flow-node\.image-container\s*\{[^}]*\}/)?.[0] || "";
const imageCollectionRule = canvasWorkspaceSource.match(/\.flow-node\.image-collection\s*\{[^}]*\}/)?.[0] || "";
assert(imageContainerRule && imageCollectionRule, "Image container surface rules must remain defined");
assert.doesNotMatch(imageContainerRule, /animation\s*:/, "Directly manipulated image containers must not replay an entry animation after drag release");
assert.doesNotMatch(imageCollectionRule, /animation\s*:/, "Directly manipulated image collections must not replay an entry animation after drag release");
assert.doesNotMatch(canvasWorkspaceSource, /@keyframes image-layout-settle/, "The obsolete image-container settle animation must stay removed");
assert.match(mainSource, /selectNodeFromPlainClick\(node\.id, "node-drag-start"\)/, "Node selection must settle before the drag release frame");
assert.match(mainSource, /commitImageLayout\(workingNodes, workingGroups, selectedId, \{ animate: false \}\)/, "Container image reordering must suppress completion animation");
assert.match(mainSource, /commitImageLayout\(workingNodes, workingGroups, memberNodeId, \{ animate: false \}\)/, "Container image extraction must suppress completion animation");
assert.match(glassSurfaceSource, /\.canvas-context-menu \.ui-menu-item:not\(:disabled\)[\s\S]{0,180}color:\s*var\(--ink\);/, "Enabled canvas menu items must use the primary readable ink color");
assert.match(glassSurfaceSource, /\.canvas-context-menu \.ui-menu-item:disabled[\s\S]{0,220}color:\s*var\(--muted\);[\s\S]{0,80}opacity:\s*1;/, "Disabled canvas menu items must remain readable without whole-row transparency");
assert.match(glassSurfaceSource, /\.canvas-context-menu \.ui-menu-item-danger:not\(:disabled\)[\s\S]{0,420}color:\s*var\(--danger\);/, "Danger menu actions must retain their semantic color under glass themes");
assert.match(canvasWorkspaceSource, /\.ui-menu-item-label[\s\S]{0,180}font-size:\s*13px;/, "Canvas menu labels must remain at a readable desktop size");
assert.match(canvasWorkspaceSource, /\.ui-menu-item-shortcut[\s\S]{0,360}font-size:\s*10px;/, "Canvas menu shortcuts must remain legible");
assert.match(canvasWorkspaceSource, /\.canvas-context-menu \.ui-menu-item:disabled[\s\S]{0,120}opacity:\s*1;/, "Disabled canvas menu rows must not reduce the opacity of their text");
assert.match(canvasWorkspaceSource, /\.canvas-plugin-toolbar\s*\{[\s\S]{0,180}width:\s*max-content;/, "The bottom toolbar must size to its commands before falling back to horizontal overflow");
assert.match(canvasWorkspaceSource, /\.canvas-plugin-toolbar-actions\s*\{[\s\S]{0,120}flex:\s*0 1 auto;/, "Toolbar actions must not collapse into a scrollbar when their labels fit the canvas");
assert.match(canvasWorkspaceSource, /\.node-port\.provenance-port\s*\{[\s\S]{0,160}top:\s*50%;[\s\S]{0,80}margin-top:\s*-7px;/, "Canvas connection ports must remain centered on the left and right node borders");
assert.match(mainSource, /canvasToolShortcutMatchesEvent\(event, candidate\.shortcut\)/, "Canvas shortcut dispatch must use each active tool's resolved shortcut");
assert.match(mainSource, /aria-keyshortcuts=\{canvasToolAriaShortcut\(item\.shortcut\)\}/, "Toolbar accessibility metadata must follow the resolved shortcut");
assert.doesNotMatch(mainSource, /<kbd aria-hidden="true">\{shortcut\}<\/kbd>/, "Canvas toolbar buttons must keep shortcut text in hover metadata instead of visible button content");
assert.match(settingsAppearanceSource, /\.settings-canvas-tool-shortcut-recorder\s*\{[\s\S]{0,220}min-width:\s*128px;/, "Shortcut recording controls must keep a stable width while their label changes");
assert.match(settingsAppearanceSource, /\.settings-section-tab[\s\S]{0,220}font-size:\s*13px;/, "Settings navigation labels must remain readable");
assert.match(glassLabSource, /\.glass-lab \.settings-section-header h4[\s\S]{0,180}font-size:\s*14px;/, "Appearance section headings must remain readable");
assert.match(glassLabSource, /\.glass-theme-card strong,[\s\S]{0,160}font-size:\s*12px;/, "Appearance option titles must remain readable");
assert.match(glassLabSource, /\.glass-theme-card small,[\s\S]{0,180}font-size:\s*11px;/, "Appearance option descriptions must not use micro text");
assert.match(glassLabSource, /\.glass-accent-swatch > small[\s\S]{0,120}font-size:\s*10px;/, "Accent labels must remain readable");
assert.match(glassLabComponentSource, /data-glass-section="background"/, "Glass Lab must expose one managed workspace-background section");
assert.match(glassLabComponentSource, /pickGlassBackground\(\)[\s\S]{0,520}primeGlassBackgroundDataUrl\(result\.asset\.assetId, result\.dataUrl\)/, "A picked background must enter through the managed bridge and prime only the temporary Renderer cache");
assert.match(glassLabComponentSource, /glassBackgroundAssetMetadata:\s*\{[\s\S]{0,180}mimeType:\s*result\.asset\.mimeType[\s\S]{0,180}bytes:\s*result\.asset\.bytes/, "Glass Lab must persist bounded metadata instead of a path or Base64 payload");
assert.match(glassLabComponentSource, /clearGlassBackground\?\.\(\{ assetId \}\)/, "Removing a background must notify the managed asset service");
assert.match(glassLabComponentSource, /id="glass-background-mask"[\s\S]{0,220}max=\{GLASS_BACKGROUND_OVERLAY_MAX\}/, "The readability mask must remain a bounded range control");
assert.match(glassLabComponentSource, /id="glass-background-blur"[\s\S]{0,220}max=\{GLASS_BACKGROUND_BLUR_MAX\}/, "Background softening must remain a bounded range control");
assert.match(preloadSource, /pickGlassBackground:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("naimage:glass-background:pick"\)/, "The background picker must use its explicit preload channel");
assert.match(preloadSource, /loadGlassBackground:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("naimage:glass-background:load", payload\)/, "Managed backgrounds must be loaded by asset id through preload");
assert.match(preloadSource, /clearGlassBackground:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("naimage:glass-background:clear", payload\)/, "Managed backgrounds must expose recoverable clear through preload");
assert.match(settingsPersistenceSource, /\.\.\.defaultGlassBackgroundSettings/, "Legacy settings must receive the shared safe background defaults");
assert.match(settingsPersistenceSource, /Object\.assign\(next, normalizeGlassBackgroundSettings\(source\)\)/, "Settings migration must use the shared background normalizer");
assert.doesNotMatch(settingsPersistenceSource, /glassBackground(?:DataUrl|Path)/, "Persistent settings must not own Base64 data or filesystem paths");
assert.match(glassBackgroundSource, /while \(dataUrlCache\.size > 2\)/, "The temporary decoded background cache must stay bounded");
assert.match(glassBackgroundSource, /const requestId = \(rootRequestIds\.get\(root\) \|\| 0\) \+ 1[\s\S]{0,900}rootRequestIds\.get\(root\) !== requestId/, "Slow background loads must not overwrite a newer setting");
assert.match(glassBackgroundSource, /Math\.max\(requestedSurfaceAlpha, mode === "dark" \? 0\.46 : 0\.5\)/, "Custom backgrounds must retain a minimum readable glass surface alpha");
assert.match(glassBackgroundSource, /--glass-background-mask[\s\S]{0,180}rgba\(3, 7, 9,[\s\S]{0,180}rgba\(250, 252, 255,/, "Dark and light themes must use mode-aware readability masks");
assert.match(glassBackgroundSource, /--glass-workspace-background-image", "none"/, "Disabled or failed backgrounds must clear the CSS image token");
assert.match(glassThemeProviderSource, /void applyGlassBackgroundToRoot\(settings, target\)/, "The theme provider must project the background independently of the synchronous glass appearance");
assert.match(glassSurfaceSource, /:root\[data-glass-background="ready"\] \.ide-shell::before[\s\S]{0,420}var\(--glass-workspace-background-image\)[\s\S]{0,220}filter:\s*blur\(var\(--glass-background-blur\)\)/, "Only the isolated Shell background layer may receive background softening");
assert.match(glassSurfaceSource, /:root\[data-glass-background="ready"\] :is\([\s\S]{0,320}\.project-agent-panel[\s\S]{0,420}background-color:\s*var\(--glass-readable-surface-fill\);/, "Primary text surfaces must use the readability fill over custom images");
assert.match(glassSurfaceSource, /\.ui-surface\[data-ui-surface\][\s\S]{0,180}background-color:\s*var\(--glass-readable-surface-fill-strong\);/, "Dialogs and tooltips must use the stronger readability fill over custom images");
const protectionStart = glassSurfaceSource.indexOf("Canvas content protection");
const protectionEnd = glassSurfaceSource.indexOf("Explicit preference", protectionStart);
assert.ok(protectionStart >= 0 && protectionEnd > protectionStart, "The glass stylesheet must keep an explicit canvas content-protection section");
const protectionSource = glassSurfaceSource.slice(protectionStart, protectionEnd);
for (const selector of [
  ".flow-node .node-image-preview img",
  ".flow-node .node-image-tile img",
  ".flow-node .container-image-tile img",
  ".flow-node .node-video-player",
  ".workspace-focus-card img",
  ".workspace-focus-group-items img",
  ".workspace-review-card img"
]) {
  assert.ok(protectionSource.includes(selector), `${selector} must be protected from glass compositing`);
}
assert.match(protectionSource, /opacity:\s*1\s*!important;/, "Rendered images must stay fully opaque");
assert.match(protectionSource, /filter:\s*none\s*!important;/, "Rendered images must not inherit visual filters");
assert.match(protectionSource, /-webkit-backdrop-filter:\s*none\s*!important;/, "Rendered images must disable WebKit backdrop filtering");
assert.match(protectionSource, /backdrop-filter:\s*none\s*!important;/, "Rendered images must disable backdrop filtering");
assert.match(glassSurfaceSource, /\.flow-node\s*\{[\s\S]{0,900}background-color:\s*var\(--glass-surface-fill-strong\);/, "Canvas node shells must use the shared translucent Glass fill");
assert.match(glassSurfaceSource, /\.flow-node\s*\{[\s\S]{0,900}border-radius:\s*clamp\(10px,\s*var\(--glass-radius\),\s*18px\);/, "Canvas node shells must follow the shared rounded Glass radius");
assert.match(glassSurfaceSource, /\.flow-node\s*\{[\s\S]{0,1200}box-shadow:[\s\S]{0,260}var\(--glass-highlight\)/, "Canvas node shells must retain a readable Glass edge highlight");
assert.match(glassSurfaceSource, /\.flow-node:is\(\.image-container, \.image-collection\)[\s\S]{0,180}--node-glass-accent:\s*var\(--accent\);/, "Image containers and image collections must retain an explicit Glass shell treatment");
assert.match(glassSurfaceSource, /\.flow-node\.video[\s\S]{0,180}--node-glass-accent:\s*var\(--rose\);/, "Video results must retain an explicit Glass shell treatment");
assert.match(scientificDialogSource, /<DialogShell[\s\S]{0,160}surface="scientific-figure"[\s\S]{0,160}className="scientific-figure-dialog"/, "The scientific workbench must use the shared Glass dialog shell");
assert.match(scientificDialogStyleSource, /\.scientific-hero,[\s\S]{0,120}\.scientific-glass-section[\s\S]{0,420}var\(--glass-surface-raised\)/, "Scientific sections must use the shared translucent Glass tokens instead of an opaque parallel theme");
assert.match(protectionSource, /mix-blend-mode:\s*normal\s*!important;/, "Rendered images must keep normal color blending");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 155 })}\n`);
