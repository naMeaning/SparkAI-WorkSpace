import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  COMMERCE_AB_COMPARISON_COMMAND,
  COMMERCE_EXPORT_CENTER_COMMAND,
  COMMERCE_GENERATE_SET_COMMAND,
  COMMERCE_SKU_LIBRARY_COMMAND,
  COMMERCE_TEMPLATE_MARKET_COMMAND,
  COMMERCE_TRANSLATION_COMMAND,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PROJECT_GRAPH_VISUALIZATION_COMMAND,
  SCIENTIFIC_FIGURE_CHART_COMMAND,
  SCIENTIFIC_FIGURE_COMMAND,
  SCIENTIFIC_FIGURE_EXPORT_COMMAND,
  SCIENTIFIC_FIGURE_IMPORT_COMMAND,
  SCIENTIFIC_FIGURE_PANEL_COMMAND,
  SCIENTIFIC_FIGURE_RERENDER_COMMAND,
  SCIENTIFIC_FIGURE_SCHEMATIC_COMMAND,
  SOCIAL_DOUYIN_COMMAND,
  SOCIAL_EXPORT_COMMAND,
  SOCIAL_RECENT_COMMAND,
  SOCIAL_TEMPLATE_COMMAND,
  SOCIAL_XIAOHONGSHU_COMMAND,
  PluginCommandRegistry,
  activePluginToolbarItems,
  availablePluginToolbarItems,
  builtinPluginManifests,
  canvasToolShortcutAria,
  canvasToolShortcutForCommand,
  canvasToolShortcutFromKeyboardEvent,
  canvasToolShortcutLabel,
  canvasToolShortcutsConflict,
  DEFAULT_WORKSPACE_PLUGIN_IDS,
  defaultWorkspacePluginStates,
  installBuiltinPlugin,
  normalizeCanvasToolShortcut,
  normalizeCanvasToolShortcuts,
  normalizePluginStates,
  setBuiltinPluginEnabled,
  uninstallBuiltinPlugin,
  WORKSPACE_PLUGIN_DEFAULTS_VERSION
} from "../src/plugin-system.ts";
import {
  COMMERCE_LANGUAGES,
  MAX_COMMERCE_TARGET_LANGUAGES,
  normalizeCommerceLanguageCodes
} from "../src/plugins/commerce-translation.ts";
import type { ProjectGraphDocument } from "../src/core.ts";

const require = createRequire(import.meta.url);
const cjsPluginState = require("../desktop/plugin-state.cjs") as {
  DEFAULT_WORKSPACE_PLUGIN_IDS: string[];
  WORKSPACE_PLUGIN_DEFAULTS_VERSION: number;
  defaultWorkspacePluginStates: (value?: unknown) => unknown;
  normalizePluginStates: (value: unknown) => unknown;
  normalizeCanvasToolShortcuts: (value: unknown) => Record<string, string>;
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

assert.equal(builtinPluginManifests.length, 4);
const commerce = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.commerce-toolkit")!;
const social = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.social-content")!;
const projectGraph = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.project-graph")!;
const scientificFigure = builtinPluginManifests.find((manifest) => manifest.id === "sparkai.scientific-figure")!;
assert.equal(commerce.schemaVersion, PLUGIN_MANIFEST_SCHEMA_VERSION);
assert.equal(commerce.id, "sparkai.commerce-toolkit");
assert.deepEqual(commerce.permissions, ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]);
assert.deepEqual(
  commerce.contributes.commands.map((command) => command.id),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(commerce.contributes.toolbar.map((item) => item.icon), ["boxes", "package-check", "book-marked", "columns-2", "images", "languages"]);
assert.deepEqual(commerce.contributes.toolbar.map((item) => item.shortcut), ["Mod+Shift+5", "Mod+Shift+6", "Mod+Shift+7", "Mod+Shift+8", "Mod+Shift+1", "Mod+Shift+2"]);
assert.equal(commerce.contributes.commands[0].requiredPermissions.length, 0);
assert.equal(commerce.contributes.commands[1].requiredPermissions.length, 0);
assert.equal(commerce.contributes.commands[2].requiredPermissions.length, 0);
assert.equal(commerce.contributes.commands[3].requiredPermissions.length, 0);
assert.equal(commerce.contributes.toolbar[0].availableDuringAgentRun, true);
assert.equal(commerce.contributes.toolbar[1].availableDuringAgentRun, true);
assert.equal(commerce.contributes.toolbar[2].availableDuringAgentRun, true);
assert.equal(commerce.contributes.toolbar[3].availableDuringAgentRun, true);
assert.equal(commerce.contributes.toolbar[0].when, undefined);
assert.deepEqual(social.permissions, ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]);
assert.deepEqual(social.contributes.commands.map((command) => command.id), [
  SOCIAL_XIAOHONGSHU_COMMAND,
  SOCIAL_DOUYIN_COMMAND,
  SOCIAL_RECENT_COMMAND,
  SOCIAL_TEMPLATE_COMMAND,
  SOCIAL_EXPORT_COMMAND
]);
assert.deepEqual(social.contributes.toolbar.map((item) => item.icon), ["images", "workflow", "columns-2", "book-marked", "package-check"]);
assert.equal(
  new Set(builtinPluginManifests.flatMap((manifest) => manifest.contributes.toolbar.map((item) => item.shortcut).filter(Boolean))).size,
  builtinPluginManifests.flatMap((manifest) => manifest.contributes.toolbar.map((item) => item.shortcut).filter(Boolean)).length,
  "Canvas tool shortcuts must be unique"
);
assert.equal(normalizeCanvasToolShortcut(" ctrl + alt + k "), "Ctrl+Alt+K");
assert.equal(normalizeCanvasToolShortcut("Meta+Shift+f12"), "Mod+Shift+F12");
assert.equal(normalizeCanvasToolShortcut("K"), undefined);
assert.equal(normalizeCanvasToolShortcut("Mod+Ctrl+K"), undefined);
assert.equal(normalizeCanvasToolShortcut("Mod++K"), undefined);
assert.equal(canvasToolShortcutLabel("Mod+Alt+9"), "Ctrl/⌘ + Alt + 9");
assert.equal(canvasToolShortcutAria("Mod+Alt+9"), "Control+Alt+9 Meta+Alt+9");
assert.equal(canvasToolShortcutFromKeyboardEvent({
  key: "9",
  code: "Digit9",
  ctrlKey: true,
  metaKey: false,
  altKey: true,
  shiftKey: false
}), "Mod+Alt+9");
assert.equal(canvasToolShortcutsConflict("Mod+Shift+1", "Ctrl+Shift+1"), true);

const customToolbarShortcuts = normalizeCanvasToolShortcuts({
  [COMMERCE_TRANSLATION_COMMAND]: "Mod+Alt+9",
  "unknown.plugin.command": "Mod+Alt+8"
});
assert.deepEqual(customToolbarShortcuts, { [COMMERCE_TRANSLATION_COMMAND]: "Mod+Alt+9" });
assert.equal(canvasToolShortcutForCommand(COMMERCE_TRANSLATION_COMMAND, customToolbarShortcuts), "Mod+Alt+9");
assert.deepEqual(
  normalizeCanvasToolShortcuts({ [COMMERCE_TRANSLATION_COMMAND]: "Mod+Shift+1" }),
  {},
  "A custom shortcut that collides with another manifest default must be ignored"
);
const swappedToolbarShortcuts = normalizeCanvasToolShortcuts({
  [COMMERCE_GENERATE_SET_COMMAND]: "Mod+Shift+2",
  [COMMERCE_TRANSLATION_COMMAND]: "Mod+Shift+1"
});
assert.deepEqual(swappedToolbarShortcuts, {
  [COMMERCE_GENERATE_SET_COMMAND]: "Mod+Shift+2",
  [COMMERCE_TRANSLATION_COMMAND]: "Mod+Shift+1"
});
assert.deepEqual(cjsPluginState.normalizeCanvasToolShortcuts(customToolbarShortcuts), customToolbarShortcuts);
assert.equal(projectGraph.schemaVersion, PLUGIN_MANIFEST_SCHEMA_VERSION);
assert.deepEqual(projectGraph.permissions, ["project.read-graph", "agent.submit-task", "canvas.write-results"]);
assert.equal(projectGraph.contributes.commands[0].id, PROJECT_GRAPH_VISUALIZATION_COMMAND);
assert.deepEqual(scientificFigure.permissions, ["canvas.read-selection", "agent.submit-task", "canvas.write-results"]);
assert.equal(scientificFigure.contributes.commands[0].id, SCIENTIFIC_FIGURE_COMMAND);
const scientificToolbarCommands = [
  SCIENTIFIC_FIGURE_IMPORT_COMMAND,
  SCIENTIFIC_FIGURE_CHART_COMMAND,
  SCIENTIFIC_FIGURE_PANEL_COMMAND,
  SCIENTIFIC_FIGURE_SCHEMATIC_COMMAND,
  SCIENTIFIC_FIGURE_RERENDER_COMMAND,
  SCIENTIFIC_FIGURE_EXPORT_COMMAND
];
assert.deepEqual(scientificFigure.contributes.toolbar.map((item) => item.command), scientificToolbarCommands);
assert.deepEqual(normalizePluginStates(undefined), []);
assert.equal(WORKSPACE_PLUGIN_DEFAULTS_VERSION, 1);
assert.deepEqual([...DEFAULT_WORKSPACE_PLUGIN_IDS], [commerce.id, social.id, scientificFigure.id]);
const defaultWorkspacePlugins = defaultWorkspacePluginStates();
assert.deepEqual(defaultWorkspacePlugins.map((state) => state.id), [...DEFAULT_WORKSPACE_PLUGIN_IDS]);
assert.ok(defaultWorkspacePlugins.every((state) => state.enabled));
assert.deepEqual(cjsPluginState.DEFAULT_WORKSPACE_PLUGIN_IDS, [...DEFAULT_WORKSPACE_PLUGIN_IDS]);
assert.equal(cjsPluginState.WORKSPACE_PLUGIN_DEFAULTS_VERSION, WORKSPACE_PLUGIN_DEFAULTS_VERSION);
assert.deepEqual(cjsPluginState.defaultWorkspacePluginStates(), defaultWorkspacePlugins);
assert.equal(defaultWorkspacePluginStates([{
  id: commerce.id,
  enabled: false,
  grantedPermissions: commerce.permissions
}]).find((state) => state.id === commerce.id)?.enabled, false);

const installed = installBuiltinPlugin([], commerce.id);
assert.equal(installed.length, 1);
assert.equal(installed[0].enabled, true);
assert.deepEqual(installed[0].grantedPermissions, commerce.permissions);
assert.deepEqual(
  activePluginToolbarItems(installed).map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(
  activePluginToolbarItems(installed, [COMMERCE_GENERATE_SET_COMMAND]).map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(
  availablePluginToolbarItems(installed).map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND],
  "Toolbar visibility must not remove executable plugin commands"
);
assert.equal(
  activePluginToolbarItems(installed, [], customToolbarShortcuts).find((item) => item.command === COMMERCE_TRANSLATION_COMMAND)?.shortcut,
  "Mod+Alt+9"
);
assert.deepEqual(installed[0].grantedPermissions, commerce.permissions, "Toolbar visibility must not change plugin authorization");
assert.deepEqual(activePluginToolbarItems(installed, [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]), []);

const installedSocial = installBuiltinPlugin([], social.id);
assert.deepEqual(installedSocial[0].grantedPermissions, social.permissions);
assert.deepEqual(
  activePluginToolbarItems(installedSocial, [], {}, "social").map((item) => item.command),
  [SOCIAL_XIAOHONGSHU_COMMAND, SOCIAL_DOUYIN_COMMAND, SOCIAL_RECENT_COMMAND, SOCIAL_TEMPLATE_COMMAND, SOCIAL_EXPORT_COMMAND]
);
assert.deepEqual(activePluginToolbarItems(installedSocial, [], {}, "commerce"), []);

const installedWithProjectGraph = installBuiltinPlugin(installed, projectGraph.id);
assert.equal(installedWithProjectGraph.length, 2);
assert.deepEqual(installedWithProjectGraph[1].grantedPermissions, projectGraph.permissions);
assert.deepEqual(
  activePluginToolbarItems(installedWithProjectGraph).map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND, PROJECT_GRAPH_VISUALIZATION_COMMAND]
);
const installedWithScientificFigure = installBuiltinPlugin(installedWithProjectGraph, scientificFigure.id);
assert.equal(installedWithScientificFigure.length, 3);
assert.deepEqual(
  activePluginToolbarItems(installedWithScientificFigure).map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND, PROJECT_GRAPH_VISUALIZATION_COMMAND, ...scientificToolbarCommands]
);
assert.deepEqual(
  activePluginToolbarItems(installedWithScientificFigure, [], {}, "general").map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND, PROJECT_GRAPH_VISUALIZATION_COMMAND, ...scientificToolbarCommands],
  "General mode must preserve the complete enabled toolbar for backward compatibility"
);
assert.deepEqual(
  activePluginToolbarItems(installedWithScientificFigure, [], {}, "commerce").map((item) => item.command),
  [COMMERCE_SKU_LIBRARY_COMMAND, COMMERCE_EXPORT_CENTER_COMMAND, COMMERCE_TEMPLATE_MARKET_COMMAND, COMMERCE_AB_COMPARISON_COMMAND, COMMERCE_GENERATE_SET_COMMAND, COMMERCE_TRANSLATION_COMMAND]
);
assert.deepEqual(activePluginToolbarItems(installedWithScientificFigure, [], {}, "social"), []);
assert.deepEqual(
  activePluginToolbarItems(installedWithScientificFigure, [], {}, "research").map((item) => item.command),
  scientificToolbarCommands
);

let executionCount = 0;
const registry = new PluginCommandRegistry();
const unregisterSkuLibrary = registry.register(commerce.id, COMMERCE_SKU_LIBRARY_COMMAND, () => { executionCount += 4; });
const unregisterExport = registry.register(commerce.id, COMMERCE_EXPORT_CENTER_COMMAND, () => { executionCount += 8; });
const unregisterTemplateMarket = registry.register(commerce.id, COMMERCE_TEMPLATE_MARKET_COMMAND, () => { executionCount += 16; });
const unregisterAbComparison = registry.register(commerce.id, COMMERCE_AB_COMPARISON_COMMAND, () => { executionCount += 32; });
const unregisterGenerate = registry.register(commerce.id, COMMERCE_GENERATE_SET_COMMAND, () => { executionCount += 1; });
const unregister = registry.register(commerce.id, COMMERCE_TRANSLATION_COMMAND, () => { executionCount += 2; });
const unregisterProjectGraph = registry.register(projectGraph.id, PROJECT_GRAPH_VISUALIZATION_COMMAND, () => { executionCount += 10; });
const unregisterScientificFigure = registry.register(scientificFigure.id, SCIENTIFIC_FIGURE_COMMAND, () => { executionCount += 100; });
await registry.execute(COMMERCE_GENERATE_SET_COMMAND, installed);
await registry.execute(COMMERCE_TRANSLATION_COMMAND, installed);
assert.equal(executionCount, 3);
await registry.execute(COMMERCE_SKU_LIBRARY_COMMAND, installed);
assert.equal(executionCount, 7);
await registry.execute(COMMERCE_EXPORT_CENTER_COMMAND, installed);
assert.equal(executionCount, 15);
await registry.execute(COMMERCE_TEMPLATE_MARKET_COMMAND, installed);
assert.equal(executionCount, 31);
await registry.execute(COMMERCE_AB_COMPARISON_COMMAND, installed);
assert.equal(executionCount, 63);
await registry.execute(PROJECT_GRAPH_VISUALIZATION_COMMAND, installedWithProjectGraph);
assert.equal(executionCount, 73);
await registry.execute(SCIENTIFIC_FIGURE_COMMAND, installedWithScientificFigure);
assert.equal(executionCount, 173);
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
unregisterSkuLibrary();
unregisterExport();
unregisterTemplateMarket();
unregisterAbComparison();
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

const scientificTask = pluginPrompts.composePluginTask({
  command: SCIENTIFIC_FIGURE_COMMAND,
  plan: {
    backend: "python",
    figureType: "schematic",
    researchClaim: "处理组通过已验证机制提高目标表型。"
  }
});
assert.match(scientificTask.prompt, /核心结论：处理组通过已验证机制提高目标表型/);
assert.match(scientificTask.prompt, /同一个 Python\/R 后端/);
assert.match(scientificTask.prompt, /不得虚构实验数据/);
assert.match(scientificTask.prompt, /SCIENTIFIC_PLAN_JSON/);
assert.equal(scientificTask.visibleContent, "规划科研示意图：处理组通过已验证机制提高目标表型。");
const scientificPackage = JSON.parse(fs.readFileSync(path.join(root, "plugins", "builtin", "sparkai.scientific-figure", "plugin-package.json"), "utf8"));
assert.equal(scientificPackage.delivery, "builtin");
assert.equal(scientificPackage.onlineCatalog.detachable, true);
assert.equal(scientificPackage.runtime.entry, "resources/agent-workflow.json");
for (const licenseFile of scientificPackage.licenseFiles) {
  assert.ok(fs.existsSync(path.join(root, "plugins", "builtin", "sparkai.scientific-figure", licenseFile)));
}

const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const workspaceChromeSource = fs.readFileSync(path.join(root, "src", "workspace-chrome.tsx"), "utf8");
const pluginPanelSource = fs.readFileSync(path.join(root, "src", "plugin-settings-panel.tsx"), "utf8");
const canvasToolsPanelSource = fs.readFileSync(path.join(root, "src", "canvas-tools-settings-panel.tsx"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.match(mainSource, /data-plugin-command=\{item\.command\}/, "Enabled plugin commands must render through the canvas toolbar contribution point");
assert.match(workspaceChromeSource, /data-domain-tool-command=\{tool\.command\}/, "Domain rail tools must preserve the same plugin command id");
assert.doesNotMatch(workspaceChromeSource, /from "\.\/plugin-system/, "Workspace chrome must consume a lightweight DTO instead of importing the plugin runtime");
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
assert.match(canvasToolsPanelSource, /hiddenCommands/);
assert.match(canvasToolsPanelSource, /底部工具栏/);
assert.match(canvasToolsPanelSource, /disabled=\{!tool\.available\}/, "Hidden tools must keep their shortcut recorder available");
assert.match(canvasToolsPanelSource, /data-shortcut-recorder/);
assert.match(canvasToolsPanelSource, /canvasToolShortcutsConflict/);
assert.match(canvasToolsPanelSource, /默认快捷键/);
assert.match(mainSource, /data-toolbar-mode=\{settings\.canvasToolDockMode\}/);
assert.match(mainSource, /settings\.canvasToolShortcuts/);
assert.match(mainSource, /pluginShortcutItemsRef\.current\.find\(\(candidate\) => canvasToolShortcutMatchesEvent\(event, candidate\.shortcut\)\)/);
assert.match(mainSource, /pluginCommandItemsRef\.current = module\.availablePluginToolbarItems/);
assert.match(mainSource, /pluginShortcutItemsRef\.current = module\.availablePluginToolbarItems/);
assert.match(mainSource, /pluginCommandItemsRef\.current\.find\(\(candidate\) => candidate\.command === commandId\)/);
assert.match(mainSource, /aria-keyshortcuts=\{canvasToolAriaShortcut\(item\.shortcut\)\}/);
assert.match(mainSource, /title=\{`\$\{needsSelection[\s\S]{0,260}\$\{shortcut \? ` · \$\{shortcut\}` : ""\}`\}/, "Toolbar shortcuts must remain available from the hover title");
assert.doesNotMatch(mainSource, /<kbd aria-hidden="true">\{shortcut\}<\/kbd>/, "Toolbar buttons must not render shortcut text inside the button");
assert.ok(packageJson.build.files.includes("plugins/**/*"), "Packaged apps must include the canonical plugin manifests");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 115 })}\n`);
