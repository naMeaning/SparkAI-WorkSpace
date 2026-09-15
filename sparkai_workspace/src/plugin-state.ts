import builtinManifestData from "../plugins/builtin-manifests.json" with { type: "json" };

export const PLUGIN_PERMISSION_VALUES = [
  "canvas.read-selection",
  "agent.submit-task",
  "canvas.write-results",
  "project.read-graph"
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSION_VALUES)[number];

export type PluginInstallationState = {
  id: string;
  version: string;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
};

export type CanvasToolShortcut = string;
export type CanvasToolShortcuts = Record<string, CanvasToolShortcut>;
export type CanvasToolShortcutEvent = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const canvasToolShortcutModifierOrder = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const canvasToolShortcutModifierAliases = new Map<string, (typeof canvasToolShortcutModifierOrder)[number]>([
  ["mod", "Mod"],
  ["meta", "Mod"],
  ["cmd", "Mod"],
  ["command", "Mod"],
  ["ctrl", "Ctrl"],
  ["control", "Ctrl"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"]
]);

function normalizeCanvasToolShortcutKey(value: unknown) {
  const key = String(value || "").trim().toUpperCase();
  if (/^[A-Z0-9]$/.test(key)) return key;
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return key;
  return "";
}

export function normalizeCanvasToolShortcut(value: unknown): CanvasToolShortcut | undefined {
  const parts = String(value || "").split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) return undefined;
  if (parts.length < 2) return undefined;
  const key = normalizeCanvasToolShortcutKey(parts[parts.length - 1]);
  if (!key) return undefined;
  const modifiers = new Set<(typeof canvasToolShortcutModifierOrder)[number]>();
  for (const part of parts.slice(0, -1)) {
    const modifier = canvasToolShortcutModifierAliases.get(part.toLowerCase());
    if (!modifier || modifiers.has(modifier)) return undefined;
    modifiers.add(modifier);
  }
  if (!modifiers.size || (modifiers.has("Mod") && modifiers.has("Ctrl"))) return undefined;
  return [...canvasToolShortcutModifierOrder.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function canvasToolShortcutCollisionKey(value: unknown) {
  const shortcut = normalizeCanvasToolShortcut(value);
  if (!shortcut) return "";
  return shortcut.split("+").map((part) => part === "Ctrl" ? "Mod" : part).join("+");
}

export function canvasToolShortcutsConflict(left: unknown, right: unknown) {
  const leftKey = canvasToolShortcutCollisionKey(left);
  return Boolean(leftKey && leftKey === canvasToolShortcutCollisionKey(right));
}

export function canvasToolShortcutLabel(value: unknown) {
  const shortcut = normalizeCanvasToolShortcut(value);
  if (!shortcut) return "";
  return shortcut.split("+").map((part) => part === "Mod" ? "Ctrl/⌘" : part).join(" + ");
}

export function canvasToolShortcutAria(value: unknown) {
  const shortcut = normalizeCanvasToolShortcut(value);
  if (!shortcut) return undefined;
  const parts = shortcut.split("+");
  const ariaParts = (primary: "Control" | "Meta") => parts.map((part) => {
    if (part === "Mod") return primary;
    if (part === "Ctrl") return "Control";
    return part;
  }).join("+");
  return parts.includes("Mod") ? `${ariaParts("Control")} ${ariaParts("Meta")}` : ariaParts("Control");
}

export function canvasToolShortcutFromKeyboardEvent(event: CanvasToolShortcutEvent) {
  const code = String(event.code || "");
  const key = /^Key([A-Z])$/.exec(code)?.[1]
    ?? /^Digit([0-9])$/.exec(code)?.[1]
    ?? /^(F(?:[1-9]|1[0-2]))$/.exec(code)?.[1]
    ?? normalizeCanvasToolShortcutKey(event.key);
  if (!key) return undefined;
  const modifiers = [
    event.ctrlKey || event.metaKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : ""
  ].filter(Boolean);
  return normalizeCanvasToolShortcut([...modifiers, key].join("+"));
}

const permissionValues = new Set<PluginPermission>(PLUGIN_PERMISSION_VALUES);
const canvasToolEntries = (builtinManifestData as unknown[]).flatMap((value) => {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  const contributes = source.contributes && typeof source.contributes === "object"
    ? source.contributes as Record<string, unknown>
    : {};
  return (Array.isArray(contributes.toolbar) ? contributes.toolbar : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const toolbar = item as Record<string, unknown>;
    const command = String(toolbar.command || "").trim();
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(command)) return [];
    return [{ command, shortcut: normalizeCanvasToolShortcut(toolbar.shortcut) }];
  });
});
const canvasToolCommandSet = new Set(canvasToolEntries.map((entry) => entry.command));
const canvasToolDefaultShortcutByCommand = new Map(canvasToolEntries.flatMap((entry) => entry.shortcut
  ? [[entry.command, entry.shortcut] as const]
  : []));
const stateManifests = (builtinManifestData as unknown[]).flatMap((value) => {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  const id = String(source.id || "").trim();
  if (!id) return [];
  return [{
    id,
    version: String(source.version || "0.0.0").trim().slice(0, 32),
    permissions: normalizePluginPermissions(source.permissions)
  }];
});
const stateManifestById = new Map(stateManifests.map((manifest) => [manifest.id, manifest]));

export const WORKSPACE_PLUGIN_DEFAULTS_VERSION = 1;
export const DEFAULT_WORKSPACE_PLUGIN_IDS = [
  "sparkai.commerce-toolkit",
  "sparkai.social-content",
  "sparkai.scientific-figure"
] as const;

export function defaultWorkspacePluginStates(value?: unknown): PluginInstallationState[] {
  const normalized = normalizePluginStates(value);
  const existingIds = new Set(normalized.map((state) => state.id));
  return normalizePluginStates([
    ...normalized,
    ...DEFAULT_WORKSPACE_PLUGIN_IDS.flatMap((id) => {
      if (existingIds.has(id)) return [];
      const manifest = stateManifestById.get(id);
      return manifest ? [{
        id,
        version: manifest.version,
        enabled: true,
        grantedPermissions: [...manifest.permissions]
      }] : [];
    })
  ]);
}

export function defaultCanvasToolShortcut(command: unknown) {
  return canvasToolDefaultShortcutByCommand.get(String(command || "").trim());
}

export function normalizeCanvasToolShortcuts(value: unknown): CanvasToolShortcuts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const candidates = new Map<string, CanvasToolShortcut>();
  for (const { command } of canvasToolEntries) {
    if (!Object.prototype.hasOwnProperty.call(source, command) || candidates.has(command)) continue;
    const shortcut = normalizeCanvasToolShortcut(source[command]);
    if (!shortcut || shortcut === defaultCanvasToolShortcut(command)) continue;
    candidates.set(command, shortcut);
  }

  for (let pass = 0; pass <= canvasToolEntries.length; pass += 1) {
    const commandsByShortcut = new Map<string, string[]>();
    for (const command of canvasToolCommandSet) {
      const shortcut = candidates.get(command) ?? defaultCanvasToolShortcut(command);
      const collisionKey = canvasToolShortcutCollisionKey(shortcut);
      if (!collisionKey) continue;
      commandsByShortcut.set(collisionKey, [...(commandsByShortcut.get(collisionKey) ?? []), command]);
    }
    let repaired = false;
    for (const commands of commandsByShortcut.values()) {
      if (commands.length < 2) continue;
      for (const command of commands) {
        if (!candidates.delete(command)) continue;
        repaired = true;
      }
    }
    if (!repaired) break;
  }

  return Object.fromEntries(canvasToolEntries.flatMap(({ command }) => {
    const shortcut = candidates.get(command);
    return shortcut ? [[command, shortcut]] : [];
  }));
}

export function canvasToolShortcutForCommand(command: unknown, shortcuts: unknown) {
  const normalizedCommand = String(command || "").trim();
  if (!canvasToolCommandSet.has(normalizedCommand)) return undefined;
  return normalizeCanvasToolShortcuts(shortcuts)[normalizedCommand] ?? defaultCanvasToolShortcut(normalizedCommand);
}

export function normalizePluginPermissions(value: unknown): PluginPermission[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter((permission): permission is PluginPermission => permissionValues.has(permission as PluginPermission)))];
}

export function normalizePluginStates(value: unknown): PluginInstallationState[] {
  if (!Array.isArray(value)) return [];
  const stateById = new Map<string, PluginInstallationState>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = String(source.id || "").trim();
    const manifest = stateManifestById.get(id);
    if (!manifest || stateById.has(id)) continue;
    const grantedPermissions = normalizePluginPermissions(source.grantedPermissions).filter((permission) => manifest.permissions.includes(permission));
    const permissionComplete = manifest.permissions.every((permission) => grantedPermissions.includes(permission));
    stateById.set(id, {
      id,
      version: manifest.version,
      enabled: source.enabled !== false && permissionComplete,
      grantedPermissions
    });
  }
  return stateManifests.flatMap((manifest) => {
    const state = stateById.get(manifest.id);
    return state ? [state] : [];
  });
}
