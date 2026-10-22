"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const dialog = read("src/export-center-dialog.tsx");
const styles = read("src/styles/04j-export-center-dialog.css");
const main = read("src/main.tsx");
const core = read("src/core.ts");
const preload = read("preload.cjs");
const assetIpc = read("desktop/ipc/asset-ipc.cjs");
const collectionIpc = read("desktop/ipc/image-collection-ipc.cjs");
const queueOwner = read("desktop/export-queue-service.cjs");

assert.match(main, /React\.lazy\(\(\) => import\("\.\/export-center-dialog"\)\)/, "export center must stay in a lazy renderer chunk");
assert.match(main, />导出中心<\/span>/, "file menu must expose the export center");
assert.match(main, /openExportCenterForCollections\(collectionIds\)/, "multi-collection context menu must enter the export center");
assert.match(main, /openExportCenterForAsset\(targetNode\.id, assetContextMenu\.assetIndex\)/, "asset context menu must enter the export center");

for (const label of ["图片", "图片组", "PSD", "配置", "队列", "历史", "预检", "加入导出队列"]) {
  assert.ok(dialog.includes(label), `export center is missing visible control: ${label}`);
}
for (const token of ["{title}", "{index}", "{asset}", "{group}", "{request}"]) {
  assert.ok(dialog.includes(token), `export center is missing filename token: ${token}`);
}
assert.doesNotMatch(dialog, /drainQueue|executeImageJob|executeCollectionJob|executePsdJob|recordExportCenterHistory/, "Renderer must only submit and project Main jobs");
assert.match(queueOwner, /async function pump\(\)[\s\S]*if \(active/, "Main owns serial execution");
assert.match(assetIpc, /exportCenterStateService\.recordHistory/, "Main persists the actual terminal outcome");
assert.match(dialog, /saveExportCenterPreset/, "project presets must be persisted through Main");
assert.match(dialog, /queue\.start\([\s\S]*target: snapshot\.target|target: snapshot\.target[\s\S]*queue\.start\(/, "all targets must use Main queue admission");
assert.match(dialog, /previewImageCollectionExport[\s\S]*previewToken: prepared\.previewToken/, "image groups retain preview-token admission");
assert.match(assetIpc, /freezePsdSource[\s\S]*exportQueuedPsd/, "Main freezes and exports authoritative PSD sources");
assert.match(dialog, /const closeBlocked = submitting;/, "accepted jobs must continue after closing the panel");
assert.match(dialog, /terminalRevisionsRef/, "history must refresh only when a terminal job changes");
assert.match(dialog, /conflictPolicy: "keep-both",[\s\S]*incremental: false/, "safe defaults preserve both exports and start without incremental skipping");
assert.match(dialog, /value: "original"/, "original bytes must be available");
assert.match(dialog, /value="zip"/, "ZIP container must be selectable");
assert.match(dialog, /authorizeExportDirectory/, "external targets must use native Main directory authorization");
assert.match(dialog, /export-center-source-thumbnail[\s\S]*imageAssetSrc/, "image preview must use the managed asset URL");

assert.match(core, /exportManagedAsset\?\(payload: ExportManagedAssetPayload\)/, "typed preload contract must include managed export");
assert.match(core, /filenameTemplate\?: string;[\s\S]*conflictPolicy\?: ExportConflictPolicy;[\s\S]*incremental\?: boolean;/, "typed collection contract must expose enhanced options");
assert.match(preload, /exportManagedAsset: \(payload\) => ipcRenderer\.invoke\("naimage:asset:export-managed", payload\)/, "preload must expose managed export without a destination path");
assert.match(assetIpc, /projectExportDirectory\(context, "images"\)/, "Main must own the ordinary image export root");
assert.match(collectionIpc, /payload\.filenameTemplate[\s\S]*payload\.conflictPolicy[\s\S]*payload\.incremental/, "collection IPC must forward enhanced options");
assert.doesNotMatch(dialog, /destinationPath|outputPath|absolutePath/, "renderer dialog must not submit an arbitrary destination path");

assert.match(styles, /--ui-surface-width: min\(1180px, calc\(100vw - 32px\)\)/, "dialog must have a bounded desktop width");
assert.match(styles, /@media \(max-width: 980px\)/, "dialog must define a compact desktop layout");
assert.match(styles, /@container ui-resizable-dialog \(max-width: 760px\)/, "dialog must respond to the actual resized surface width");
assert.match(styles, /overflow: auto/, "dense lists must scroll inside the dialog instead of clipping");

console.log("export center UI static contracts passed (Main queue, all targets, original/ZIP, directory authority, transparent preview; no exercised UI claim)");
