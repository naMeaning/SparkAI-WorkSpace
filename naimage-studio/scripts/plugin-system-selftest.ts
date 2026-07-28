import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  COMMERCE_TRANSLATION_COMMAND,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PROJECT_GRAPH_VISUALIZATION_COMMAND,
  PluginCommandRegistry,
  activePluginToolbarItems,
  builtinPluginManifests,
  installBuiltinPlugin,
  normalizePluginStates,
  setBuiltinPluginEnabled,
  uninstallBuiltinPlugin
} from "../src/plugin-system.ts";
import {
  MAX_COMMERCE_TARGET_LANGUAGES,
  commerceTranslationPrompt,
  normalizeCommerceLanguageCodes
} from "../src/plugins/commerce-translation.ts";
import {
  projectGraphPromptPayload,
  projectGraphVisualizationPrompt
} from "../src/plugins/project-graph-visualization.ts";
import type { ProjectGraphDocument } from "../src/core.ts";

const require = createRequire(import.meta.url);
const cjsPluginState = require("../desktop/plugin-state.cjs") as {
  normalizePluginStates: (value: unknown) => unknown;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(builtinPluginManifests.length, 2);
const commerce = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.commerce-toolkit")!;
const projectGraph = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.project-graph")!;
assert.equal(commerce.schemaVersion, PLUGIN_MANIFEST_SCHEMA_VERSION);
assert.equal(commerce.id, "sparkai.commerce-toolkit");
assert.deepEqual(commerce.permissions, ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]);
assert.equal(commerce.contributes.commands[0].id, COMMERCE_TRANSLATION_COMMAND);
assert.equal(projectGraph.schemaVersion, PLUGIN_MANIFEST_SCHEMA_VERSION);
assert.deepEqual(projectGraph.permissions, ["project.read-graph", "agent.submit-task", "canvas.write-results"]);
assert.equal(projectGraph.contributes.commands[0].id, PROJECT_GRAPH_VISUALIZATION_COMMAND);
assert.deepEqual(normalizePluginStates(undefined), []);

const installed = installBuiltinPlugin([], commerce.id);
assert.equal(installed.length, 1);
assert.equal(installed[0].enabled, true);
assert.deepEqual(installed[0].grantedPermissions, commerce.permissions);
assert.equal(activePluginToolbarItems(installed)[0].command, COMMERCE_TRANSLATION_COMMAND);

const installedWithProjectGraph = installBuiltinPlugin(installed, projectGraph.id);
assert.equal(installedWithProjectGraph.length, 2);
assert.deepEqual(installedWithProjectGraph[1].grantedPermissions, projectGraph.permissions);
assert.deepEqual(
  activePluginToolbarItems(installedWithProjectGraph).map((item) => item.command),
  [COMMERCE_TRANSLATION_COMMAND, PROJECT_GRAPH_VISUALIZATION_COMMAND]
);

let executionCount = 0;
const registry = new PluginCommandRegistry();
const unregister = registry.register(commerce.id, COMMERCE_TRANSLATION_COMMAND, () => { executionCount += 1; });
const unregisterProjectGraph = registry.register(projectGraph.id, PROJECT_GRAPH_VISUALIZATION_COMMAND, () => { executionCount += 10; });
await registry.execute(COMMERCE_TRANSLATION_COMMAND, installed);
assert.equal(executionCount, 1);
await registry.execute(PROJECT_GRAPH_VISUALIZATION_COMMAND, installedWithProjectGraph);
assert.equal(executionCount, 11);
assert.throws(() => registry.register(commerce.id, COMMERCE_TRANSLATION_COMMAND, () => undefined), /已注册/);

const disabled = setBuiltinPluginEnabled(installed, commerce.id, false);
assert.equal(disabled[0].enabled, false);
assert.deepEqual(activePluginToolbarItems(disabled), []);
await assert.rejects(() => registry.execute(COMMERCE_TRANSLATION_COMMAND, disabled), /未启用/);

const incomplete = normalizePluginStates([{ id: commerce.id, enabled: true, grantedPermissions: ["canvas.read-selection"] }]);
assert.equal(incomplete[0].enabled, false, "Missing permissions must force the plugin into a disabled state");
assert.deepEqual(
  cjsPluginState.normalizePluginStates([{ id: commerce.id, enabled: true, grantedPermissions: ["canvas.read-selection"] }]),
  incomplete,
  "Electron and Renderer plugin-state sanitizers must remain mirrored"
);

const repaired = setBuiltinPluginEnabled(incomplete, commerce.id, true);
assert.equal(repaired[0].enabled, true);
assert.deepEqual(repaired[0].grantedPermissions, commerce.permissions);
assert.deepEqual(uninstallBuiltinPlugin(repaired, commerce.id), []);
unregister();
unregisterProjectGraph();
await assert.rejects(() => registry.execute(COMMERCE_TRANSLATION_COMMAND, installed), /尚未连接/);
await assert.rejects(() => registry.execute("unknown.command", installed), /未知插件命令/);

const normalizedLanguages = normalizeCommerceLanguageCodes(["en-US", "de-DE", "en-US", "invalid", ...Array(20).fill("fr-FR")]);
assert.deepEqual(normalizedLanguages, ["en-US", "de-DE", "fr-FR"]);
assert.ok(normalizeCommerceLanguageCodes(Array.from({ length: 20 }, (_, index) => ["en-US", "de-DE", "fr-FR", "es-ES", "ja-JP", "ko-KR", "it-IT", "pt-BR", "ar-SA", "ru-RU", "th-TH", "vi-VN", "id-ID", "en-GB"][index % 14])).length <= MAX_COMMERCE_TARGET_LANGUAGES);
const prompt = commerceTranslationPrompt(["en-US", "ar-SA"], 3);
assert.match(prompt, /当前选中的图片成果是本轮唯一 SOURCE/);
assert.match(prompt, /每种语言单独调用一次 image_gen/);
assert.match(prompt, /不同语言不得混在同一个结果组/);
assert.match(prompt, /阿拉伯语使用正确的从右到左排版/);
assert.match(prompt, /禁止用 generate 重画商品/);
assert.throws(() => commerceTranslationPrompt([], 1), /至少选择一种/);

const graph: ProjectGraphDocument = {
  schemaVersion: 1,
  sourceFormat: "project-graph-prg-v2",
  sourceName: "biology.prg",
  title: "光合作用",
  nodes: [
    { id: "root", label: "光合作用", kind: "section", sourceClass: "Section", parentIds: [] },
    { id: "input", label: "阳光、水和二氧化碳", kind: "concept", sourceClass: "TextNode", parentIds: ["root"] },
    { id: "output", label: "葡萄糖和氧气", kind: "concept", sourceClass: "TextNode", parentIds: ["root"] }
  ],
  edges: [{ id: "transform", sourceId: "input", targetId: "output", label: "转化为", directed: true, kind: "directed" }],
  rootIds: ["root"],
  warnings: [],
  stats: { nodeCount: 3, edgeCount: 1, sectionCount: 1 }
};
const graphPayload = projectGraphPromptPayload(graph);
assert.equal(graphPayload.nodes.length, 3);
assert.equal(graphPayload.edges.length, 1);
assert.equal(graphPayload.promptTruncated, false);
const graphPrompt = projectGraphVisualizationPrompt(graph);
assert.match(graphPrompt, /GRAPH 是本轮唯一的知识结构 SOURCE/);
assert.match(graphPrompt, /拆成 2–6 张独立学习图/);
assert.match(graphPrompt, /每张图单独调用一次 image_gen/);
assert.match(graphPrompt, /不要修改原 \.prg 文件或项目 session/);
assert.match(graphPrompt, /不得虚构 GRAPH 未提供的内容/);

const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const pluginPanelSource = fs.readFileSync(path.join(root, "src", "plugin-settings-panel.tsx"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.match(mainSource, /data-plugin-command=\{item\.command\}/, "Enabled plugin commands must render through the canvas toolbar contribution point");
assert.match(mainSource, /visibleContent: `为当前选中的商品图生成多语言套图/, "Plugin execution must keep the user-facing Agent message concise");
assert.match(mainSource, /window\.naimageConfig\?\.importProjectGraph/, "Project Graph must enter through the read-only preload bridge");
assert.match(mainSource, /sourceNodeIds: \[\],[\s\S]*useComposerAttachments: false,[\s\S]*visibleContent: `把思维导图/, "Project Graph execution must not inherit canvas or composer image sources");
assert.match(pluginPanelSource, /安装并授权/);
assert.match(pluginPanelSource, /setBuiltinPluginEnabled/);
assert.match(pluginPanelSource, /uninstallBuiltinPlugin/);
assert.ok(packageJson.build.files.includes("plugins/**/*"), "Packaged apps must include the canonical plugin manifests");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 48 })}\n`);
