"use strict";

const registrySource = require("./workspace-domains.json");

const WORKSPACE_DOMAIN_IDS = Object.freeze(["general", "commerce", "social", "research"]);
const workspaceDomainIdSet = new Set(WORKSPACE_DOMAIN_IDS);

function cleanList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];
}

function normalizeDefinition(value) {
  if (!value || typeof value !== "object") throw new Error("Workspace domain definition must be an object.");
  const id = String(value.id || "").trim();
  if (!workspaceDomainIdSet.has(id)) throw new Error(`Unknown workspace domain: ${id || "<empty>"}`);
  const title = String(value.title || "").trim();
  const description = String(value.description || "").trim();
  if (!title || !description) throw new Error(`Workspace domain ${id} requires a title and description.`);
  return Object.freeze({
    id,
    title,
    description,
    icon: String(value.icon || "sparkles").trim() || "sparkles",
    pluginIds: Object.freeze(cleanList(value.pluginIds)),
    defaultPrompt: String(value.defaultPrompt || "").trim(),
    availableTools: Object.freeze(cleanList(value.availableTools))
  });
}

const WORKSPACE_DOMAIN_DEFINITIONS = Object.freeze(
  (Array.isArray(registrySource.domains) ? registrySource.domains : []).map(normalizeDefinition)
);
if (WORKSPACE_DOMAIN_DEFINITIONS.length !== WORKSPACE_DOMAIN_IDS.length) {
  throw new Error("Workspace domain registry must define exactly four domains.");
}
if (new Set(WORKSPACE_DOMAIN_DEFINITIONS.map((item) => item.id)).size !== WORKSPACE_DOMAIN_IDS.length) {
  throw new Error("Workspace domain registry contains duplicate domain IDs.");
}
for (const id of WORKSPACE_DOMAIN_IDS) {
  if (!WORKSPACE_DOMAIN_DEFINITIONS.some((item) => item.id === id)) throw new Error(`Workspace domain registry is missing ${id}.`);
}

const DEFAULT_WORKSPACE_DOMAIN = workspaceDomainIdSet.has(String(registrySource.defaultDomain || ""))
  ? String(registrySource.defaultDomain)
  : "general";
const definitionById = new Map(WORKSPACE_DOMAIN_DEFINITIONS.map((item) => [item.id, item]));

function isWorkspaceDomain(value) {
  return workspaceDomainIdSet.has(String(value || "").trim());
}

function normalizeWorkspaceDomain(value) {
  const id = String(value || "").trim();
  return workspaceDomainIdSet.has(id) ? id : DEFAULT_WORKSPACE_DOMAIN;
}

function workspaceDomainDefinition(value) {
  return definitionById.get(normalizeWorkspaceDomain(value));
}

function workspaceDomainPrompt(value) {
  return workspaceDomainDefinition(value).defaultPrompt;
}

function publicWorkspaceDomainDefinition(value) {
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

module.exports = {
  DEFAULT_WORKSPACE_DOMAIN,
  WORKSPACE_DOMAIN_DEFINITIONS,
  WORKSPACE_DOMAIN_IDS,
  isWorkspaceDomain,
  normalizeWorkspaceDomain,
  publicWorkspaceDomainDefinition,
  workspaceDomainDefinition,
  workspaceDomainPrompt
};
