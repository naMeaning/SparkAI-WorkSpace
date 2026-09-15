import builtinManifestData from "../plugins/builtin-manifests.json" with { type: "json" };
import type { WorkspaceDomain } from "./core";
import { workspaceDomainOwnsPlugin } from "./workspace-domain.ts";
import {
  canvasToolShortcutAria,
  canvasToolShortcutForCommand,
  canvasToolShortcutFromKeyboardEvent,
  canvasToolShortcutLabel,
  canvasToolShortcutsConflict,
  DEFAULT_WORKSPACE_PLUGIN_IDS,
  defaultWorkspacePluginStates,
  defaultCanvasToolShortcut,
  normalizeCanvasToolShortcut,
  normalizeCanvasToolShortcuts,
  normalizePluginPermissions,
  normalizePluginStates,
  WORKSPACE_PLUGIN_DEFAULTS_VERSION,
  type CanvasToolShortcut,
  type CanvasToolShortcutEvent,
  type CanvasToolShortcuts,
  type PluginInstallationState,
  type PluginPermission
} from "./plugin-state.ts";

export {
  canvasToolShortcutAria,
  canvasToolShortcutForCommand,
  canvasToolShortcutFromKeyboardEvent,
  canvasToolShortcutLabel,
  canvasToolShortcutsConflict,
  DEFAULT_WORKSPACE_PLUGIN_IDS,
  defaultWorkspacePluginStates,
  defaultCanvasToolShortcut,
  normalizeCanvasToolShortcut,
  normalizeCanvasToolShortcuts,
  normalizePluginStates,
  WORKSPACE_PLUGIN_DEFAULTS_VERSION
} from "./plugin-state.ts";
export type {
  CanvasToolShortcut,
  CanvasToolShortcutEvent,
  CanvasToolShortcuts,
  PluginInstallationState,
  PluginPermission
} from "./plugin-state.ts";

export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;

export type PluginCommandContribution = {
  id: string;
  requiredPermissions: PluginPermission[];
};

export type PluginToolbarContribution = {
  command: string;
  label: string;
  description: string;
  order: number;
  icon: "images" | "languages" | "workflow" | "microscope" | "boxes" | "package-check" | "book-marked" | "columns-2";
  shortcut?: CanvasToolShortcut;
  when?: "canvas.has-image-selection";
  availableDuringAgentRun?: boolean;
};

export type PluginManifest = {
  schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  permissions: PluginPermission[];
  contributes: {
    commands: PluginCommandContribution[];
    toolbar: PluginToolbarContribution[];
  };
};

export type ActivePluginToolbarItem = PluginToolbarContribution & { pluginId: string };

function normalizeBuiltinManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("插件 manifest 必须是对象。");
  const source = value as Record<string, unknown>;
  const id = String(source.id || "").trim();
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) throw new Error(`插件 ID 无效：${id || "<empty>"}`);
  if (Number(source.schemaVersion) !== PLUGIN_MANIFEST_SCHEMA_VERSION) throw new Error(`插件 ${id} 的 manifest 版本不受支持。`);
  const permissions = normalizePluginPermissions(source.permissions);
  const contributes = source.contributes && typeof source.contributes === "object"
    ? source.contributes as Record<string, unknown>
    : {};
  const commands = (Array.isArray(contributes.commands) ? contributes.commands : []).map((item) => {
    const command = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const commandId = String(command.id || "").trim();
    if (!commandId.startsWith(`${id}.`)) throw new Error(`插件命令 ${commandId || "<empty>"} 必须以 ${id}. 开头。`);
    return {
      id: commandId,
      requiredPermissions: command.requiredPermissions === undefined ? permissions : normalizePluginPermissions(command.requiredPermissions)
    };
  });
  if (new Set(commands.map((command) => command.id)).size !== commands.length) throw new Error(`插件 ${id} 存在重复命令。`);
  const commandIds = new Set(commands.map((command) => command.id));
  const toolbar = (Array.isArray(contributes.toolbar) ? contributes.toolbar : []).map((item) => {
    const contribution = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const command = String(contribution.command || "").trim();
    if (!commandIds.has(command)) throw new Error(`插件 ${id} 的工具栏引用了未声明命令 ${command || "<empty>"}。`);
    const icon = ["images", "languages", "workflow", "microscope", "boxes", "package-check", "book-marked", "columns-2"].includes(String(contribution.icon))
      ? String(contribution.icon) as PluginToolbarContribution["icon"]
      : "workflow";
    const shortcut = normalizeCanvasToolShortcut(contribution.shortcut);
    return {
      command,
      label: String(contribution.label || command).trim().slice(0, 40),
      description: String(contribution.description || "").trim().slice(0, 160),
      order: Math.max(-10_000, Math.min(10_000, Math.round(Number(contribution.order) || 0))),
      icon,
      shortcut,
      when: contribution.when === "canvas.has-image-selection" ? "canvas.has-image-selection" as const : undefined,
      availableDuringAgentRun: contribution.availableDuringAgentRun === true
    };
  });
  return {
    schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    id,
    name: String(source.name || id).trim().slice(0, 80),
    version: String(source.version || "0.0.0").trim().slice(0, 32),
    publisher: String(source.publisher || "Unknown").trim().slice(0, 80),
    description: String(source.description || "").trim().slice(0, 320),
    permissions,
    contributes: { commands, toolbar }
  };
}

export const builtinPluginManifests = Object.freeze((builtinManifestData as unknown[]).map(normalizeBuiltinManifest));
const pluginManifestById = new Map(builtinPluginManifests.map((manifest) => [manifest.id, manifest]));
const commandOwnerById = new Map(
  builtinPluginManifests.flatMap((manifest) => manifest.contributes.commands.map((command) => [command.id, { manifest, command }] as const))
);

export function builtinPluginManifest(pluginId: string) {
  return pluginManifestById.get(String(pluginId || "").trim());
}

export function installBuiltinPlugin(states: unknown, pluginId: string): PluginInstallationState[] {
  const manifest = builtinPluginManifest(pluginId);
  if (!manifest) throw new Error(`找不到内置插件 ${pluginId}。`);
  return normalizePluginStates([
    ...normalizePluginStates(states).filter((state) => state.id !== manifest.id),
    { id: manifest.id, version: manifest.version, enabled: true, grantedPermissions: manifest.permissions }
  ]);
}

export function setBuiltinPluginEnabled(states: unknown, pluginId: string, enabled: boolean): PluginInstallationState[] {
  const manifest = builtinPluginManifest(pluginId);
  if (!manifest) throw new Error(`找不到内置插件 ${pluginId}。`);
  const normalized = normalizePluginStates(states);
  const current = normalized.find((state) => state.id === pluginId);
  if (!current) throw new Error(`插件 ${pluginId} 尚未安装。`);
  return normalizePluginStates(normalized.map((state) => state.id === pluginId
    ? { ...state, enabled, grantedPermissions: enabled ? manifest.permissions : state.grantedPermissions }
    : state));
}

export function uninstallBuiltinPlugin(states: unknown, pluginId: string): PluginInstallationState[] {
  return normalizePluginStates(states).filter((state) => state.id !== pluginId);
}

export function availablePluginToolbarItems(
  states: unknown,
  shortcutOverrides: unknown = {},
  workspaceDomain?: WorkspaceDomain
): ActivePluginToolbarItem[] {
  const stateById = new Map(normalizePluginStates(states).map((state) => [state.id, state]));
  const shortcuts = normalizeCanvasToolShortcuts(shortcutOverrides);
  return builtinPluginManifests
    .flatMap((manifest) => {
      const state = stateById.get(manifest.id);
      const permissionComplete = Boolean(state && manifest.permissions.every((permission) => state.grantedPermissions.includes(permission)));
      if (!state?.enabled || !permissionComplete) return [];
      return manifest.contributes.toolbar
        .map((item) => ({ ...item, pluginId: manifest.id, shortcut: shortcuts[item.command] ?? item.shortcut }));
    })
    .filter((item) => workspaceDomain === undefined || workspaceDomainOwnsPlugin(workspaceDomain, item.pluginId))
    .sort((left, right) => left.order - right.order || left.command.localeCompare(right.command));
}

export function activePluginToolbarItems(
  states: unknown,
  hiddenCommands: unknown = [],
  shortcutOverrides: unknown = {},
  workspaceDomain?: WorkspaceDomain
): ActivePluginToolbarItem[] {
  const hidden = new Set((Array.isArray(hiddenCommands) ? hiddenCommands : []).map((item) => String(item || "").trim()));
  return availablePluginToolbarItems(states, shortcutOverrides, workspaceDomain)
    .filter((item) => !hidden.has(item.command));
}

export type PluginCommandHandler = (payload?: unknown) => void | Promise<void>;

export class PluginCommandRegistry {
  private handlers = new Map<string, { pluginId: string; handler: PluginCommandHandler }>();

  register(pluginId: string, commandId: string, handler: PluginCommandHandler) {
    const owner = commandOwnerById.get(commandId);
    if (!owner || owner.manifest.id !== pluginId) throw new Error(`插件 ${pluginId} 不能注册命令 ${commandId}。`);
    if (this.handlers.has(commandId)) throw new Error(`命令 ${commandId} 已注册。`);
    const record = { pluginId, handler };
    this.handlers.set(commandId, record);
    return () => {
      if (this.handlers.get(commandId) === record) this.handlers.delete(commandId);
    };
  }

  async execute(commandId: string, states: unknown, payload?: unknown) {
    const owner = commandOwnerById.get(commandId);
    if (!owner) throw new Error(`未知插件命令 ${commandId}。`);
    const state = normalizePluginStates(states).find((item) => item.id === owner.manifest.id);
    if (!state?.enabled) throw new Error(`插件 ${owner.manifest.name} 未启用。`);
    const missingPermissions = owner.command.requiredPermissions.filter((permission) => !state.grantedPermissions.includes(permission));
    if (missingPermissions.length) throw new Error(`插件缺少权限：${missingPermissions.join("、")}`);
    const record = this.handlers.get(commandId);
    if (!record || record.pluginId !== owner.manifest.id) throw new Error(`命令 ${commandId} 尚未连接到应用。`);
    await record.handler(payload);
  }
}

export const pluginPermissionLabels: Record<PluginPermission, string> = {
  "canvas.read-selection": "读取当前选中的图片成果",
  "agent.submit-task": "向当前项目 Agent 提交任务",
  "canvas.write-results": "通过 Agent 写入新的图片成果",
  "project.read-graph": "读取受控的项目关系图"
};

export const COMMERCE_TRANSLATION_COMMAND = "sparkai.commerce-toolkit.translate-listing-set";
export const COMMERCE_GENERATE_SET_COMMAND = "sparkai.commerce-toolkit.generate-listing-set";
export const COMMERCE_SKU_LIBRARY_COMMAND = "sparkai.commerce-toolkit.open-sku-library";
export const COMMERCE_EXPORT_CENTER_COMMAND = "sparkai.commerce-toolkit.open-export-center";
export const COMMERCE_TEMPLATE_MARKET_COMMAND = "sparkai.commerce-toolkit.open-template-market";
export const COMMERCE_AB_COMPARISON_COMMAND = "sparkai.commerce-toolkit.open-ab-comparison";
export const SOCIAL_XIAOHONGSHU_COMMAND = "sparkai.social-content.new-xiaohongshu";
export const SOCIAL_DOUYIN_COMMAND = "sparkai.social-content.new-douyin";
export const SOCIAL_RECENT_COMMAND = "sparkai.social-content.open-recent";
export const SOCIAL_TEMPLATE_COMMAND = "sparkai.social-content.open-templates";
export const SOCIAL_EXPORT_COMMAND = "sparkai.social-content.open-publish-export";
export const PROJECT_GRAPH_VISUALIZATION_COMMAND = "sparkai.project-graph.visualize-learning-map";
export const SCIENTIFIC_FIGURE_COMMAND = "sparkai.scientific-figure.start-workflow";
export const SCIENTIFIC_FIGURE_IMPORT_COMMAND = "sparkai.scientific-figure.import-data";
export const SCIENTIFIC_FIGURE_CHART_COMMAND = "sparkai.scientific-figure.new-chart";
export const SCIENTIFIC_FIGURE_PANEL_COMMAND = "sparkai.scientific-figure.new-panel";
export const SCIENTIFIC_FIGURE_SCHEMATIC_COMMAND = "sparkai.scientific-figure.new-schematic";
export const SCIENTIFIC_FIGURE_RERENDER_COMMAND = "sparkai.scientific-figure.rerender";
export const SCIENTIFIC_FIGURE_EXPORT_COMMAND = "sparkai.scientific-figure.export";
