"use strict";

const builtinPluginManifests = require("../plugins/builtin-manifests.json");

const pluginManifestById = new Map(builtinPluginManifests.map((manifest) => [String(manifest.id), manifest]));

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

module.exports = {
  builtinPluginManifests,
  normalizePluginStates
};
