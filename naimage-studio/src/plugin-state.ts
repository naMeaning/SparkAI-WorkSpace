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

const permissionValues = new Set<PluginPermission>(PLUGIN_PERMISSION_VALUES);
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
