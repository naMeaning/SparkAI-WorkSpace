import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  COMMERCE_GENERATE_SET_COMMAND,
  COMMERCE_TRANSLATION_COMMAND,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PROJECT_GRAPH_VISUALIZATION_COMMAND,
  SCIENTIFIC_FIGURE_COMMAND,
  PluginCommandRegistry,
  activePluginToolbarItems,
  builtinPluginManifests,
  installBuiltinPlugin,
  normalizePluginStates,
  setBuiltinPluginEnabled,
  uninstallBuiltinPlugin
} from "../src/plugin-system.ts";
import {
  COMMERCE_LANGUAGES,
  MAX_COMMERCE_TARGET_LANGUAGES,
  normalizeCommerceLanguageCodes
} from "../src/plugins/commerce-translation.ts";
import type { ProjectGraphDocument } from "../src/core.ts";

const require = createRequire(import.meta.url);
const cjsPluginState = require("../desktop/plugin-state.cjs") as {
  normalizePluginStates: (value: unknown) => unknown;
};
const pluginPrompts = require("../desktop/plugin-task-prompts.cjs") as {
  commerceLanguages: string[][];
  commerceTranslationPrompt: (languageCodes: unknown, sourceCount: number) => string;
  projectGraphPromptPayload: (graph: ProjectGraphDocument) => { nodes: unknown[]; edges: unknown[]; promptTruncated: boolean };
  projectGraphVisualizationPrompt: (graph: ProjectGraphDocument) => string;
  composePluginTask: (payload: { command: string; sourceCount?: number; sourceNodeIds?: string[]; plan?: unknown }) => {
    prompt: string;
    visibleContent: string;
    planHash?: string;
    counts?: { outputsPerSource?: number; totalRequests?: number };
  };
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(builtinPluginManifests.length, 3);
const commerce = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.commerce-toolkit")!;
const projectGraph = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.project-graph")!;
const scientificFigure = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.scientific-figure")!;
assert.equal(commerce.schemaVersion, PLUGIN_MANIFEST_SCHEMA_VERSION);
assert.equal(commerce.id, "sparkai.commerce-toolkit");
assert.deepEqual(commerce.permissions, ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]);
assert.deepEqual(
  commerce.contributes.commands.map((command) => command.id),
  [COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(commerce.contributes.toolbar.map((item) => item.icon), ["images", "languages"]);
assert.deepEqual(commerce.contributes.toolbar.map((item) => item.shortcut), ["Mod+Shift+1", "Mod+Shift+2"]);
assert.equal(
  new Set(builtinPluginManifests.flatMap((manifest) => manifest.contributes.toolbar.map((item) => item.shortcut).filter(Boolean))).size,
  builtinPluginManifests.flatMap((manifest) => manifest.contributes.toolbar.map((item) => item.shortcut).filter(Boolean)).length,
  "Canvas tool shortcuts must be unique"
);
assert.equal(projectGraph.schemaVersion, PLUGIN_MANIFEST_SCHEMA_VERSION);
assert.deepEqual(projectGraph.permissions, ["project.read-graph", "agent.submit-task", "canvas.write-results"]);
assert.equal(projectGraph.contributes.commands[0].id, PROJECT_GRAPH_VISUALIZATION_COMMAND);
assert.deepEqual(scientificFigure.permissions, ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]);
assert.equal(scientificFigure.contributes.commands[0].id, SCIENTIFIC_FIGURE_COMMAND);
assert.deepEqual(normalizePluginStates(undefined), []);

const installed = installBuiltinPlugin([], commerce.id);
assert.equal(installed.length, 1);
assert.equal(installed[0].enabled, true);
assert.deepEqual(installed[0].grantedPermissions, commerce.permissions);
assert.deepEqual(
  activePluginToolbarItems(installed).map((item) => item.command),
  [COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(
  activePluginToolbarItems(installed, [COMMERCE_GENERATE_SET_COMMAND]).map((item) => item.command),
  [COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(installed[0].grantedPermissions, commerce.permissions, "Toolbar visibility must not change plugin authorization");
assert.deepEqual(activePluginToolbarItems(installed, [COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]), []);

const installedWithProjectGraph = installBuiltinPlugin(installed, projectGraph.id);
assert.equal(installedWithProjectGraph.length, 2);
assert.deepEqual(installedWithProjectGraph[1].grantedPermissions, projectGraph.permissions);
assert.deepEqual(
  activePluginToolbarItems(installedWithProjectGraph).map((item) => item.command),
  [COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND, PROJECT_GRAPH_VISUALIZATION_COMMAND]
);
const installedWithScientificFigure = installBuiltinPlugin(installedWithProjectGraph, scientificFigure.id);
assert.equal(installedWithScientificFigure.length, 3);
assert.deepEqual(
  activePluginToolbarItems(installedWithScientificFigure).map((item) => item.command),
  [COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND, PROJECT_GRAPH_VISUALIZATION_COMMAND, SCIENTIFIC_FIGURE_COMMAND]
);

let executionCount = 0;
const registry = new PluginCommandRegistry();
const unregisterGenerate = registry.register(commerce.id, COMMERCE_GENERATE_SET_COMMAND, () => { executionCount += 1; });
const unregister = registry.register(commerce.id, COMMERCE_TRANSLATION_COMMAND, () => { executionCount += 2; });
const unregisterProjectGraph = registry.register(projectGraph.id, PROJECT_GRAPH_VISUALIZATION_COMMAND, () => { executionCount += 10; });
const unregisterScientificFigure = registry.register(scientificFigure.id, SCIENTIFIC_FIGURE_COMMAND, () => { executionCount += 100; });
await registry.execute(COMMERCE_GENERATE_SET_COMMAND, installed);
await registry.execute(COMMERCE_TRANSLATION_COMMAND, installed);
assert.equal(executionCount, 3);
await registry.execute(PROJECT_GRAPH_VISUALIZATION_COMMAND, installedWithProjectGraph);
assert.equal(executionCount, 13);
await registry.execute(SCIENTIFIC_FIGURE_COMMAND, installedWithScientificFigure);
assert.equal(executionCount, 113);
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
unregisterGenerate();
unregisterProjectGraph();
unregisterScientificFigure();
await assert.rejects(() => registry.execute(COMMERCE_TRANSLATION_COMMAND, installed), /尚未连接/);
await assert.rejects(() => registry.execute("unknown.command", installed), /未知插件命令/);

const normalizedLanguages = normalizeCommerceLanguageCodes(["en-US", "de-DE", "en-US", "invalid", ...Array(20).fill("fr-FR")]);
assert.deepEqual(normalizedLanguages, ["en-US", "de-DE", "fr-FR"]);
assert.ok(normalizeCommerceLanguageCodes(Array.from({ length: 20 }, (_, index) => ["en-US", "de-DE", "fr-FR", "es-ES", "ja-JP", "ko-KR", "it-IT", "pt-BR", "ar-SA", "ru-RU", "th-TH", "vi-VN", "id-ID", "en-GB"][index % 14])).length <= MAX_COMMERCE_TARGET_LANGUAGES);
const prompt = pluginPrompts.commerceTranslationPrompt(["en-US", "ar-SA"], 3);
assert.match(prompt, /\[NAIMAGE_COMMERCE_SET_V1\]/);
assert.match(prompt, /PLAN_HASH: commerce-[a-f0-9]{32}/);
assert.match(prompt, /仅调用一次 image_gen/);
assert.match(prompt, /scopeExecution=all-goal-sources/);
assert.match(prompt, /count 等于语言数/);
assert.match(prompt, /localeCode/);
assert.match(prompt, /从右到左布局/);
assert.match(prompt, /不得用 generate 重画商品/);
assert.match(prompt, /成功、失败和未派发数量/);
assert.throws(() => pluginPrompts.commerceTranslationPrompt([], 1), /至少选择一种/);
assert.deepEqual(pluginPrompts.commerceLanguages.map((language) => language[0]), COMMERCE_LANGUAGES.map((language) => language.code));

const commerceGenerationTask = pluginPrompts.composePluginTask({
  command: COMMERCE_GENERATE_SET_COMMAND,
  sourceCount: 2,
  sourceNodeIds: ["SOURCE-A", "SOURCE-B"],
  plan: {
    mode: "generate",
    setSize: 3,
    languageCodes: ["en-US"],
    slots: [
      { id: "hero", title: "主图", prompt: "保持商品准确，制作干净主图。" },
      { id: "detail", title: "细节", prompt: "展示真实材质和结构细节。" },
      { id: "usage", title: "场景", prompt: "展示合理且不夸大的使用场景。" }
    ]
  }
});
assert.match(commerceGenerationTask.prompt, /\[NAIMAGE_COMMERCE_SET_V1\]/);
assert.match(commerceGenerationTask.prompt, /PLAN_HASH: commerce-[a-f0-9]{32}/);
assert.match(commerceGenerationTask.prompt, /operation=variants/);
assert.match(commerceGenerationTask.prompt, /items 必须与下方展开顺序一一对应/);
assert.match(commerceGenerationTask.prompt, /COMMERCE_SET_PLAN_JSON:/);
assert.equal(commerceGenerationTask.counts?.outputsPerSource, 3);
assert.equal(commerceGenerationTask.counts?.totalRequests, 6);
assert.match(String(commerceGenerationTask.planHash), /^commerce-[a-f0-9]{32}$/);

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
const graphPayload = pluginPrompts.projectGraphPromptPayload(graph);
assert.equal(graphPayload.nodes.length, 3);
assert.equal(graphPayload.edges.length, 1);
assert.equal(graphPayload.promptTruncated, false);
const graphPrompt = pluginPrompts.projectGraphVisualizationPrompt(graph);
assert.match(graphPrompt, /GRAPH 是本轮唯一的知识结构 SOURCE/);
assert.match(graphPrompt, /拆成 2–6 张独立学习图/);
assert.match(graphPrompt, /每张图单独调用一次 image_gen/);
assert.match(graphPrompt, /不要修改原 \.prg 文件或项目 session/);
assert.match(graphPrompt, /不得虚构 GRAPH 未提供的内容/);

const scientificTask = pluginPrompts.composePluginTask({ command: SCIENTIFIC_FIGURE_COMMAND });
assert.match(scientificTask.prompt, /Python 还是 R/);
assert.match(scientificTask.prompt, /全程只使用该后端/);
assert.match(scientificTask.prompt, /不得虚构实验值/);
assert.match(scientificTask.prompt, /SVG\/PDF\/TIFF/);
assert.match(scientificTask.prompt, /当前画布选择/);
assert.equal(scientificTask.visibleContent, "创建投稿级科研图");
const scientificPackage = JSON.parse(fs.readFileSync(path.join(root, "plugins", "builtin", "sparkai.scientific-figure", "plugin-package.json"), "utf8"));
assert.equal(scientificPackage.delivery, "builtin");
assert.equal(scientificPackage.onlineCatalog.detachable, true);
assert.equal(scientificPackage.runtime.entry, "resources/agent-workflow.json");
for (const licenseFile of scientificPackage.licenseFiles) {
  assert.ok(fs.existsSync(path.join(root, "plugins", "builtin", "sparkai.scientific-figure", licenseFile)));
}

const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const pluginPanelSource = fs.readFileSync(path.join(root, "src", "plugin-settings-panel.tsx"), "utf8");
const canvasToolsPanelSource = fs.readFileSync(path.join(root, "src", "canvas-tools-settings-panel.tsx"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.match(mainSource, /data-plugin-command=\{item\.command\}/, "Enabled plugin commands must render through the canvas toolbar contribution point");
assert.match(mainSource, /sparkai\.commerce-toolkit\.generate-listing-set/);
assert.match(mainSource, /sparkai\.commerce-toolkit\.translate-listing-set/);
assert.match(mainSource, /composePluginTask\?\.\(\{[\s\S]*command: payload\.plan\.mode/, "Commerce execution must request its trusted task prompt through preload using the dialog's final mode");
assert.match(mainSource, /window\.naimageConfig\?\.importProjectGraph/, "Project Graph must enter through the read-only preload bridge");
assert.match(mainSource, /sendPrompt\(result\.task\.prompt,[\s\S]*sourceNodeIds: \[\],[\s\S]*useComposerAttachments: false,[\s\S]*visibleContent: result\.task\.visibleContent/, "Project Graph execution must not inherit canvas or composer image sources");
assert.match(mainSource, /sparkai\.scientific-figure\.start-workflow/);
assert.match(mainSource, /composePluginTask\?\.\(\{[\s\S]*sparkai\.scientific-figure\.start-workflow/);
assert.match(pluginPanelSource, /安装并授权/);
assert.match(pluginPanelSource, /setBuiltinPluginEnabled/);
assert.match(pluginPanelSource, /uninstallBuiltinPlugin/);
assert.match(canvasToolsPanelSource, /canvasToolDockMode|onModeChange/);
assert.match(canvasToolsPanelSource, /disabledCommands/);
assert.match(mainSource, /data-toolbar-mode=\{settings\.canvasToolDockMode\}/);
assert.match(mainSource, /aria-keyshortcuts=\{canvasToolAriaShortcut\(item\.shortcut\)\}/);
assert.ok(packageJson.build.files.includes("plugins/**/*"), "Packaged apps must include the canonical plugin manifests");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 77 })}\n`);
