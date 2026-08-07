import workspaceDomainRegistry from "../runtime/workspace-domains.json" with { type: "json" };
import type { WorkspaceDomain, WorkspaceDomainDefinition } from "./core";

export const WORKSPACE_DOMAIN_IDS = ["general", "commerce", "social", "research"] as const satisfies readonly WorkspaceDomain[];
const workspaceDomainIds = new Set<string>(WORKSPACE_DOMAIN_IDS);

function cleanList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];
}

function normalizeDefinition(value: unknown): WorkspaceDomainDefinition {
  if (!value || typeof value !== "object") throw new Error("Workspace domain definition must be an object.");
  const source = value as Record<string, unknown>;
  const id = String(source.id ?? "").trim();
  if (!workspaceDomainIds.has(id)) throw new Error(`Unknown workspace domain: ${id || "<empty>"}`);
  const title = String(source.title ?? "").trim();
  const description = String(source.description ?? "").trim();
  if (!title || !description) throw new Error(`Workspace domain ${id} requires a title and description.`);
  return Object.freeze({
    id: id as WorkspaceDomain,
    title,
    description,
    icon: String(source.icon ?? "sparkles").trim() || "sparkles",
    pluginIds: cleanList(source.pluginIds),
    defaultPrompt: String(source.defaultPrompt ?? "").trim() || undefined,
    availableTools: cleanList(source.availableTools)
  });
}

export const workspaceDomainDefinitions = Object.freeze(
  (Array.isArray(workspaceDomainRegistry.domains) ? workspaceDomainRegistry.domains : []).map(normalizeDefinition)
);
if (workspaceDomainDefinitions.length !== WORKSPACE_DOMAIN_IDS.length) {
  throw new Error("Workspace domain registry must define exactly four domains.");
}
if (new Set(workspaceDomainDefinitions.map((item) => item.id)).size !== WORKSPACE_DOMAIN_IDS.length) {
  throw new Error("Workspace domain registry contains duplicate domain IDs.");
}
for (const id of WORKSPACE_DOMAIN_IDS) {
  if (!workspaceDomainDefinitions.some((item) => item.id === id)) throw new Error(`Workspace domain registry is missing ${id}.`);
}

export const DEFAULT_WORKSPACE_DOMAIN: WorkspaceDomain = workspaceDomainIds.has(String(workspaceDomainRegistry.defaultDomain ?? ""))
  ? workspaceDomainRegistry.defaultDomain as WorkspaceDomain
  : "general";
const workspaceDomainById = new Map(workspaceDomainDefinitions.map((item) => [item.id, item]));

export function isWorkspaceDomain(value: unknown): value is WorkspaceDomain {
  return workspaceDomainIds.has(String(value ?? "").trim());
}

export function normalizeWorkspaceDomain(value: unknown): WorkspaceDomain {
  const id = String(value ?? "").trim();
  return isWorkspaceDomain(id) ? id : DEFAULT_WORKSPACE_DOMAIN;
}

export function workspaceDomainDefinition(value: unknown): WorkspaceDomainDefinition {
  return workspaceDomainById.get(normalizeWorkspaceDomain(value))!;
}

export function workspaceDomainPrompt(value: unknown) {
  return workspaceDomainDefinition(value).defaultPrompt ?? "";
}

export function publicWorkspaceDomainDefinition(value: unknown) {
  const definition = workspaceDomainDefinition(value);
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    icon: definition.icon,
    pluginIds: [...definition.pluginIds],
    availableTools: [...definition.availableTools]
  };
}

export function workspaceDomainOwnsPlugin(domain: unknown, pluginId: string) {
  const normalized = normalizeWorkspaceDomain(domain);
  if (normalized === "general") return true;
  const assignedPluginIds = new Set(workspaceDomainDefinitions.flatMap((item) => item.pluginIds));
  return workspaceDomainDefinition(normalized).pluginIds.includes(pluginId) || !assignedPluginIds.has(pluginId);
}
