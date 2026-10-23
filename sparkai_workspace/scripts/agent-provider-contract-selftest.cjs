"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAgentProviderControl, registerAgentProviderIpc, AGENT_PROVIDER_COMMANDS } = require("../desktop/agent-provider-ipc.cjs");
const schema = require("../integrations/naimage-control/references/commands.schema.json");

async function main() {
  const calls = [];
  const privateFields = { baseUrl: "https://private.invalid", token: "synthetic-private-token", credentialRef: "synthetic-private-ref", bindingId: "private-binding", path: "C:/private/model.gguf" };
  const profile = { providerKind: "local-openai-compatible", profileId: "local-fixture", profileLabel: "Fixture", modelId: "fixture-model", profileHash: "a".repeat(64),
    capabilities: { tools: true, vision: false, contextWindowTokens: 8192, maxOutputTokens: 1024, ...privateFields }, strictOffline: true, networkScope: "local", availability: "configured", ...privateFields };
  const runtime = { runtimeId: "runtime-fixture", label: "Fixture runtime", mode: "managed", state: "stopped", activeRevisionId: "revision-fixture", modelId: "fixture-model", capabilities: profile.capabilities,
    revisions: [{ revisionId: "revision-fixture", manifestId: "manifest-fixture", manifestHash: "b".repeat(64), version: "1", state: "ready", modelId: "fixture-model", capabilities: profile.capabilities, ...privateFields }], ...privateFields };
  const manifest = { manifestId: "manifest-fixture", label: "Fixture manifest", version: "1", adapter: "llama.cpp-portable", reviewStatus: "user-import", trust: "user-import", installable: true, artifactCount: 1, ...privateFields };
  const plan = { planId: "plan-fixture", manifestId: manifest.manifestId, runtimeId: runtime.runtimeId, label: "Fixture plan", version: "1", downloadBytes: 8, expandedBytes: 16, requiredDiskBytes: 32, availableDiskBytes: 64, canInstall: true,
    artifacts: [{ artifactId: "artifact-fixture", label: "Tiny fixture", kind: "llm", sourceLabel: "Fixture registry", bytes: 8, expandedBytes: 16, license: { id: "MIT", ...privateFields }, dependencies: [], ...privateFields }], requirements: { os: ["win32"], arch: ["x64"], gpu: ["cpu"], vramBytes: 0, ...privateFields }, ...privateFields };
  const job = { jobId: "job-fixture", runtimeId: runtime.runtimeId, planId: plan.planId, manifestId: manifest.manifestId, state: "paused", downloadedBytes: 4, totalBytes: 8, ...privateFields };
  const provider = Object.fromEntries(["list", "importProfile", "select", "inspect", "status"].map(method => [method, async input => {
    calls.push({ owner: "provider", method, input });
    return { ok: true, profiles: [profile], selected: profile, profile, ...privateFields };
  }]));
  const managed = Object.fromEntries(["list", "importManifest", "plan", "install", "pause", "resume", "start", "stop", "rollback", "remove", "status"].map(method => [method, async input => {
    calls.push({ owner: "managed", method, input });
    return method === "plan" ? { ok: true, ...plan } : { ok: true, manifests: [manifest], manifest, runtimes: [runtime], runtime, jobs: [job], job, ...privateFields };
  }]));
  const control = createAgentProviderControl({ agentProviderService: provider, managedLocalLlmService: managed });
  const commands = schema.sections.flatMap(section => section.commands).filter(command => /^agent\.(?:provider|local)\./.test(command.name));
  assert.deepEqual(commands.map(command => command.name).sort(), [...AGENT_PROVIDER_COMMANDS].sort());
  for (const command of commands) {
    assert.equal(command.surface, "service"); assert.equal(command.parameters.additionalProperties, false);
    for (const forbidden of ["url", "baseUrl", "path", "directory", "token", "credentialRef", "bindingId", "capabilities", "script", "confirmed", "manifest"]) assert.equal(command.parameters.properties[forbidden], undefined, `${command.name}: ${forbidden}`);
    const args = Object.fromEntries(command.parameters.required.map(key => [key, key === "strictOffline" ? true : `${key.replace(/Id$/, "")}-fixture`]));
    const result = await control.command(command.name, args);
    assert.equal(result.ok, true, command.name);
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(privateFields)) assert.equal(serialized.includes(secret), false, `${command.name} leaked private content`);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "bindingId"), false);
  }
  assert.equal(calls.length, 16);
  assert.deepEqual(calls.find(call => call.method === "select").input, { profileId: "profile-fixture", strictOffline: true });
  const planned = await control.command("agent.local.runtime.plan", { manifestId: "manifest-fixture" });
  assert.equal(planned.plan.planId, "plan-fixture"); assert.equal(planned.plan.artifacts[0].license.id, "MIT");
  const before = calls.length;
  for (const payload of [
    { action: "select", profileId: "local-fixture", strictOffline: true, url: "http://127.0.0.1" },
    { action: "select", profileId: "local-fixture", strictOffline: "yes" },
    { action: "select", profileId: "local-fixture" },
    { action: "import", path: "C:/private/profile.json" },
    { action: "inspect", profileId: "C:/private" },
    { action: "local-runtime-install", planId: "plan-fixture", confirmed: true },
    { action: "local-runtime-start", runtimeId: "runtime-fixture", script: "shell" },
    { action: "local-runtime-rollback", runtimeId: "runtime-fixture" },
    { action: "unknown" }, [], null
  ]) assert.equal((await control(payload)).ok, false);
  assert.equal((await control.command("agent.provider.list", { action: "import" })).ok, false);
  assert.equal((await control.command("agent.provider.unknown", {})).ok, false);
  assert.equal(calls.length, before, "Invalid input must be rejected before a service, download or process boundary");
  let registered;
  const returned = registerAgentProviderIpc({ control, ipcMain: { handle(channel, handler) { assert.equal(channel, "naimage:agent:provider"); registered = handler; } } });
  assert.equal(returned, control); assert.equal((await registered({}, { action: "status" })).selected.profileId, profile.profileId);
  provider.status = () => { throw Object.assign(new Error(`Bearer synthetic-private-token ${privateFields.path}`), { code: "AGENT_LOCAL_OFFLINE" }); };
  const failure = await control({ action: "status" }); assert.equal(failure.errorCode, "AGENT_LOCAL_OFFLINE"); assert.equal(JSON.stringify(failure).includes("synthetic-private"), false);
  const report = { ok: true, publicCommands: commands.length, rejectedInputs: 13, serviceCalls: calls.length, networkRequests: 0, realModelRequests: 0, checks: ["schema-service parity", "bounded public projection", "pre-dispatch input rejection", "native authorization cannot be forged", "IPC shared control", "error privacy"] };
  const dir = path.join(__dirname, "..", ".diagnostics", "agent-provider-contract"); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
