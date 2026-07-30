import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(repoRoot, "AIDEBUG", "catalog.json"), "utf8"));
const agentTextUiSource = readFileSync(join(repoRoot, "scripts", "agent-text-ui-aidebug.mjs"), "utf8");
const glassWorkspaceSource = readFileSync(join(repoRoot, "scripts", "aidebug-glass-workspace-suite.mjs"), "utf8");

const stableScripts = {
  "aidebug:auth-gate": "node scripts/aidebug-gui.mjs --auth-gate-suite --mock-agent",
  "aidebug:image": "node scripts/aidebug-gui.mjs --image-only --mock-agent",
  "aidebug:image-collection": "node scripts/aidebug-gui.mjs --image-collection-suite --mock-agent",
  "aidebug:ask-user": "node scripts/aidebug-gui.mjs --ask-user-continuation-suite --mock-agent",
  "aidebug:agent-text-ui": "node scripts/agent-text-ui-aidebug.mjs",
  "aidebug:glass-workspace": "node scripts/aidebug-glass-workspace-suite.mjs"
};

for (const [name, command] of Object.entries(stableScripts)) {
  assert.equal(packageJson.scripts?.[name], command, `${name} must remain a stable package entry`);
}
assert.deepEqual(catalog.tasks?.["aidebug-catalog"], {
  label: "AIDebug stable command and catalog registration contract",
  kind: "logic",
  runner: "pnpm",
  script: "test:aidebug-catalog",
  timeoutMs: 120000,
  resources: [],
  requiresNetwork: false
}, "The catalog contract must remain runnable through AIDEBUG itself");

const expectedTasks = {
  "gui-auth-gate": { script: "aidebug:auth-gate", timeoutMs: 600000 },
  "gui-image": { script: "aidebug:image", timeoutMs: 600000 },
  "gui-image-collection": { script: "aidebug:image-collection", timeoutMs: 900000 },
  "gui-ask-user": { script: "aidebug:ask-user", timeoutMs: 600000 },
  "gui-agent-text-ui": { script: "aidebug:agent-text-ui", timeoutMs: 1200000 },
  "gui-glass-workspace": { script: "aidebug:glass-workspace", timeoutMs: 900000 }
};

for (const [taskId, expected] of Object.entries(expectedTasks)) {
  const task = catalog.tasks?.[taskId];
  assert(task, `${taskId} must be registered in AIDEBUG/catalog.json`);
  assert.equal(task.kind, "gui", `${taskId} must require real GUI evidence`);
  assert.equal(task.runner, "pnpm", `${taskId} must run through its stable package script`);
  assert.equal(task.script, expected.script, `${taskId} package script`);
  assert.equal(task.timeoutMs, expected.timeoutMs, `${taskId} timeout`);
  assert.deepEqual(task.resources, ["electron-ui"], `${taskId} must share the Electron UI lock`);
  assert.equal(task.requiresNetwork, false, `${taskId} must stay offline/mock-safe`);
}

const expectedSpecialists = {
  "auth-gate-ui-agent": "gui-auth-gate",
  "image-ui-agent": "gui-image",
  "image-collection-ui-agent": "gui-image-collection",
  "ask-user-ui-agent": "gui-ask-user",
  "agent-text-ui-agent": "gui-agent-text-ui",
  "glass-workspace-ui-agent": "gui-glass-workspace"
};
const uiSpecialists = catalog.profiles?.["ui-specialists"];
assert.equal(uiSpecialists?.requireAgentSelection, true, "ui-specialists must stay explicitly selected");
for (const [agentId, taskId] of Object.entries(expectedSpecialists)) {
  const agent = uiSpecialists.agents.find((item) => item.id === agentId);
  assert(agent, `${agentId} must be available in ui-specialists`);
  assert.deepEqual(agent.tasks, [taskId], `${agentId} must own only ${taskId}`);
}

assert.match(agentTextUiSource, /createAidebugReporting/, "Agent Text UI must use the shared AIDEBUG reporter");
assert.match(agentTextUiSource, /captureStableCdpScene/, "Agent Text UI screenshots must use stable dual-frame evidence");
assert.match(agentTextUiSource, /createObservationLog/, "Agent Text UI must retain timestamped observations");
assert.match(agentTextUiSource, /label:\s*"bootstrap:prepare-run"/, "Agent Text UI must emit the bootstrap checkpoint");
assert.match(agentTextUiSource, /reporting\.finishSuiteRun\(\{[\s\S]*?results:\s*evidenceResults/, "Agent Text UI must finish through the collectable GUI report path");
assert.match(agentTextUiSource, /NAIMAGE_AIDEBUG_MOCK_AGENT:\s*"1"/, "Agent Text UI must keep its mock-only provider boundary");
assert.match(glassWorkspaceSource, /createAidebugReporting/, "Glass workspace UI must use the shared AIDEBUG reporter");
assert.match(glassWorkspaceSource, /captureStableCdpScene/, "Glass workspace screenshots must use stable dual-frame evidence");
assert.match(glassWorkspaceSource, /NAIMAGE_AIDEBUG_LIVE_IMAGE:\s*"0"/, "Glass workspace UI must disable live image providers");
assert.match(glassWorkspaceSource, /seedSelectionCanvas\(\)/, "Glass workspace UI must use the local canvas fixture");

console.log(`AIDEBUG catalog self-test passed (${Object.keys(stableScripts).length} stable commands, ${Object.keys(expectedTasks).length} GUI tasks).`);
