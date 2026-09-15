"use strict";

const builtinPluginManifests = require("../plugins/builtin-manifests.json");

const pluginManifestById = new Map(builtinPluginManifests.map((manifest) => [String(manifest.id), manifest]));
const WORKSPACE_PLUGIN_DEFAULTS_VERSION = 1;
const DEFAULT_WORKSPACE_PLUGIN_IDS = Object.freeze([
  "sparkai.commerce-toolkit",
  "sparkai.social-content",
  "sparkai.scientific-figure"
]);
const canvasToolShortcutModifierOrder = ["Mod", "Ctrl", "Alt", "Shift"];
const canvasToolShortcutModifierAliases = new Map([
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

function normalizeCanvasToolShortcutKey(value) {
  const key = String(value || "").trim().toUpperCase();
  if (/^[A-Z0-9]$/.test(key)) return key;
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return key;
  return "";
}

function normalizeCanvasToolShortcut(value) {
  const parts = String(value || "").split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) return undefined;
  if (parts.length < 2) return undefined;
  const key = normalizeCanvasToolShortcutKey(parts[parts.length - 1]);
  if (!key) return undefined;
  const modifiers = new Set();
  for (const part of parts.slice(0, -1)) {
    const modifier = canvasToolShortcutModifierAliases.get(part.toLowerCase());
    if (!modifier || modifiers.has(modifier)) return undefined;
    modifiers.add(modifier);
  }
  if (!modifiers.size || (modifiers.has("Mod") && modifiers.has("Ctrl"))) return undefined;
  return [...canvasToolShortcutModifierOrder.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function canvasToolShortcutCollisionKey(value) {
  const shortcut = normalizeCanvasToolShortcut(value);
  if (!shortcut) return "";
  return shortcut.split("+").map((part) => part === "Ctrl" ? "Mod" : part).join("+");
}

const canvasToolEntries = builtinPluginManifests.flatMap((manifest) => {
  const toolbar = Array.isArray(manifest?.contributes?.toolbar) ? manifest.contributes.toolbar : [];
  return toolbar.flatMap((item) => {
    const command = String(item?.command || "").trim();
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(command)) return [];
    return [{ command, shortcut: normalizeCanvasToolShortcut(item?.shortcut) }];
  });
});
const canvasToolCommandSet = new Set(canvasToolEntries.map((entry) => entry.command));
const canvasToolDefaultShortcutByCommand = new Map(canvasToolEntries.flatMap((entry) => entry.shortcut
  ? [[entry.command, entry.shortcut]]
  : []));

function defaultCanvasToolShortcut(command) {
  return canvasToolDefaultShortcutByCommand.get(String(command || "").trim());
}

function normalizeCanvasToolShortcuts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidates = new Map();
  for (const { command } of canvasToolEntries) {
    if (!Object.prototype.hasOwnProperty.call(value, command) || candidates.has(command)) continue;
    const shortcut = normalizeCanvasToolShortcut(value[command]);
    if (!shortcut || shortcut === defaultCanvasToolShortcut(command)) continue;
    candidates.set(command, shortcut);
  }

  for (let pass = 0; pass <= canvasToolEntries.length; pass += 1) {
    const commandsByShortcut = new Map();
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

function normalizePluginStates(value) {
  if (!Array.isArray(value)) return [];
  const stateById = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    const manifest = pluginManifestById.get(id);
    if (!manifest || stateById.has(id)) continue;
    const requestedPermissions = Array.isArray(manifest.permissions) ? manifest.permissions.map(String) : [];
    const grantedPermissions = [...new Set(
      (Array.isArray(item.grantedPermissions) ? item.grantedPermissions : [])
        .map(String)
        .filter((permission) => requestedPermissions.includes(permission))
    )];
    const permissionComplete = requestedPermissions.every((permission) => grantedPermissions.includes(permission));
    stateById.set(id, {
      id,
      version: String(manifest.version || "0.0.0"),
      enabled: item.enabled !== false && permissionComplete,
      grantedPermissions
    });
  }
  return builtinPluginManifests.flatMap((manifest) => {
    const state = stateById.get(String(manifest.id));
    return state ? [state] : [];
  });
}

function defaultWorkspacePluginStates(value) {
  const normalized = normalizePluginStates(value);
  const existingIds = new Set(normalized.map((state) => state.id));
  return normalizePluginStates([
    ...normalized,
    ...DEFAULT_WORKSPACE_PLUGIN_IDS.flatMap((id) => {
      if (existingIds.has(id)) return [];
      const manifest = pluginManifestById.get(id);
      return manifest ? [{
        id,
        version: String(manifest.version || "0.0.0"),
        enabled: true,
        grantedPermissions: Array.isArray(manifest.permissions) ? [...manifest.permissions] : []
      }] : [];
    })
  ]);
}

module.exports = {
  DEFAULT_WORKSPACE_PLUGIN_IDS,
  WORKSPACE_PLUGIN_DEFAULTS_VERSION,
  builtinPluginManifests,
  defaultWorkspacePluginStates,
  defaultCanvasToolShortcut,
  normalizeCanvasToolShortcut,
  normalizeCanvasToolShortcuts,
  normalizePluginStates
};
