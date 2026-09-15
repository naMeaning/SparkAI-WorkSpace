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
assert.match(dialog, /while \(true\)[\s\S]*status === "queued"/, "renderer queue must drain jobs serially");
assert.match(dialog, /recordExportCenterHistory/, "terminal jobs must persist project history");
assert.match(dialog, /saveExportCenterPreset/, "project presets must be persisted through Main");
assert.match(dialog, /exportManagedAsset/, "ordinary images must use the managed image export IPC");
assert.match(dialog, /previewImageCollectionExport[\s\S]*exportImageCollections/, "image groups must retain preview-token export");
assert.match(dialog, /exportPsd\(source, suggestedName\)/, "PSD jobs must call the separate PSD callback");

assert.match(core, /exportManagedAsset\?\(payload: ExportManagedAssetPayload\)/, "typed preload contract must include managed export");
assert.match(core, /filenameTemplate\?: string;[\s\S]*conflictPolicy\?: ExportConflictPolicy;[\s\S]*incremental\?: boolean;/, "typed collection contract must expose enhanced options");
assert.match(preload, /exportManagedAsset: \(payload\) => ipcRenderer\.invoke\("naimage:asset:export-managed", payload\)/, "preload must expose managed export without a destination path");
assert.match(assetIpc, /projectExportDirectory\(context, "images"\)/, "Main must own the ordinary image export root");
assert.match(collectionIpc, /payload\.filenameTemplate[\s\S]*payload\.conflictPolicy[\s\S]*payload\.incremental/, "collection IPC must forward enhanced options");
assert.doesNotMatch(dialog, /destinationPath|outputPath|absolutePath/, "renderer dialog must not submit an arbitrary destination path");

assert.match(styles, /--ui-surface-width: min\(1180px, calc\(100vw - 32px\)\)/, "dialog must have a bounded desktop width");
assert.match(styles, /@media \(max-width: 980px\)/, "dialog must define a compact desktop layout");
assert.match(styles, /@media \(max-width: 760px\)/, "dialog must define a narrow fallback layout");
assert.match(styles, /overflow: auto/, "dense lists must scroll inside the dialog instead of clipping");

console.log("export center UI selftest passed (27 contracts)");
