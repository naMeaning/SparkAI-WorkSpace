import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  DEFAULT_WORKSPACE_DOMAIN,
  WORKSPACE_DOMAIN_IDS,
  isWorkspaceDomain,
  normalizeWorkspaceDomain,
  publicWorkspaceDomainDefinition,
  workspaceDomainDefinitions,
  workspaceDomainOwnsPlugin,
  workspaceDomainPrompt,
} from "../src/workspace-domain.ts";
import { defaultSettings } from "../src/settings-persistence.ts";

const require = createRequire(import.meta.url);
const runtimeDomains = require("../runtime/workspace-domain.cjs") as typeof import("../runtime/workspace-domain.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs") as {
  sanitizeSession: (value: unknown) => { workspaceDomain: string };
};
const { registerProjectIpc } = require("../desktop/ipc/project-ipc.cjs") as {
  registerProjectIpc: (options: Record<string, unknown>) => void;
};

const expectedIds = ["general", "commerce", "social", "research"];
assert.deepEqual([...WORKSPACE_DOMAIN_IDS], expectedIds);
assert.equal(DEFAULT_WORKSPACE_DOMAIN, "general");
assert.equal(workspaceDomainDefinitions.length, 4);
assert.deepEqual(workspaceDomainDefinitions.map((item) => item.id), expectedIds);
assert.equal(new Set(workspaceDomainDefinitions.map((item) => item.id)).size, 4);
assert.ok(workspaceDomainDefinitions.every((item) => item.title && item.description && item.icon));
assert.ok(workspaceDomainDefinitions.every((item) => item.availableTools.includes("ask_user")));
assert.equal(normalizeWorkspaceDomain(undefined), "general");
assert.equal(normalizeWorkspaceDomain("social"), "social");
assert.equal(normalizeWorkspaceDomain("unknown"), "general");
assert.equal(isWorkspaceDomain("research"), true);
assert.equal(isWorkspaceDomain("RESEARCH"), false);
assert.match(workspaceDomainPrompt("research"), /不虚构研究结果/);
assert.equal("defaultPrompt" in publicWorkspaceDomainDefinition("commerce"), false);

assert.deepEqual([...runtimeDomains.WORKSPACE_DOMAIN_IDS], expectedIds);
assert.equal(runtimeDomains.DEFAULT_WORKSPACE_DOMAIN, DEFAULT_WORKSPACE_DOMAIN);
assert.deepEqual(
  expectedIds.map((id) => runtimeDomains.publicWorkspaceDomainDefinition(id)),
  expectedIds.map((id) => publicWorkspaceDomainDefinition(id)),
  "Renderer and runtime must expose the same public domain registry"
);

assert.equal(workspaceDomainOwnsPlugin("general", "sparkai.commerce-toolkit"), true);
assert.equal(workspaceDomainOwnsPlugin("commerce", "sparkai.commerce-toolkit"), true);
assert.equal(workspaceDomainOwnsPlugin("commerce", "sparkai.scientific-figure"), false);
assert.equal(workspaceDomainOwnsPlugin("social", "sparkai.social-content"), true);
assert.equal(workspaceDomainOwnsPlugin("commerce", "sparkai.social-content"), false);
assert.equal(workspaceDomainOwnsPlugin("research", "sparkai.scientific-figure"), true);
assert.equal(workspaceDomainOwnsPlugin("social", "sparkai.unassigned-global"), true);
assert.deepEqual(defaultSettings.pluginStates.map((state) => state.id), [
  "sparkai.commerce-toolkit",
  "sparkai.social-content",
  "sparkai.scientific-figure"
]);
assert.ok(defaultSettings.pluginStates.every((state) => state.enabled));

const workspaceChromeSource = readFileSync(new URL("../src/workspace-chrome.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const glassSurfaceSource = readFileSync(new URL("../src/styles/07j-liquid-glass-surfaces.css", import.meta.url), "utf8");
assert.match(workspaceChromeSource, /workspaceDomain === "commerce" \|\| workspaceDomain === "social" \|\| workspaceDomain === "research"/, "The asset rail must render all specialized workspace quick sections");
assert.match(workspaceChromeSource, /data-domain-tool-command=\{tool\.command\}/, "Domain rail actions must retain their plugin command identity");
assert.match(workspaceChromeSource, /onExecuteDomainTool\?\.\(tool\.command\)/, "Domain rail actions must delegate instead of duplicating business logic");
assert.match(workspaceChromeSource, /workspaceDomain === "research" \? "科研" : workspaceDomain === "social" \? "社媒" : "电商"/, "A missing or disabled projected plugin must have a domain-specific recovery path");
assert.match(mainSource, /domainTools=\{workspaceDomain === "commerce" \|\| workspaceDomain === "social" \|\| workspaceDomain === "research" \? pluginToolbarItems : \[\]\}/, "The asset rail must reuse the active toolbar projection");
assert.match(mainSource, /projectedPluginEnabled \? "tools" : "plugins"/, "The recovery path must open the relevant settings section");
assert.match(mainSource, /useState<SettingsSection>\("access"\)/, "Workspace shortcuts must be able to open every existing settings section");
assert.doesNotMatch(glassSurfaceSource, /\.workspace-domain-switcher-trigger > span:nth-child\(2\),\s*\.workspace-domain-switcher-trigger > svg:last-child/, "Compact workspaces must keep the current domain text visible");

const emptySession = { schemaVersion: 5, nodes: [], messages: [], conversations: [] };
assert.equal(sanitizeSession(emptySession).workspaceDomain, "general", "Old sessions must default to general");
assert.equal(sanitizeSession({ ...emptySession, workspaceDomain: "commerce" }).workspaceDomain, "commerce");
assert.equal(sanitizeSession({ ...emptySession, workspaceDomain: "invalid" }).workspaceDomain, "general");

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const sessionsByProjectId = new Map<string, Record<string, unknown>>();
let projectSequence = 0;
registerProjectIpc({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["C:\\Projects"] }) },
  shell: {},
  log: () => undefined,
  defaultSession: emptySession,
  readProjectList: () => ({ activeProjectId: "", projects: [] }),
  createProjectRecord: (name: string, projectPath?: string) => ({ id: `project-${++projectSequence}`, name, path: projectPath || `C:\\Projects\\${projectSequence}` }),
  ensureProjectFiles: (record: { id: string }, session: Record<string, unknown>) => sessionsByProjectId.set(record.id, session),
  writeProjectList: (value: unknown) => value,
  safeName: (value: unknown, fallback: string) => String(value || fallback),
  nextExternalProjectFolderPath: (parent: string, name: string) => `${parent}\\${name}`,
  projectSessionFromDisk: (record: { id: string }) => sessionsByProjectId.get(record.id),
});

const createProject = handlers.get("naimage:project:create")!;
const researchProject = createProject(undefined, { name: "Research", workspaceDomain: "research" }) as { session: { workspaceDomain: string } };
assert.equal(researchProject.session.workspaceDomain, "research");
const legacyProject = createProject(undefined, { name: "Legacy" }) as { session: { workspaceDomain: string } };
assert.equal(legacyProject.session.workspaceDomain, "general");
const createProjectFolder = handlers.get("naimage:project:create-folder")!;
const socialFolder = await createProjectFolder(undefined, { name: "Social", workspaceDomain: "social" }) as { session: { workspaceDomain: string } };
assert.equal(socialFolder.session.workspaceDomain, "social");

process.stdout.write(`${JSON.stringify({ ok: true, domains: expectedIds, cases: 47 })}\n`);
