"use strict";

const actions = Object.freeze({
  list: ["provider", "list", [], ["projectId"]],
  import: ["provider", "importProfile", [], []],
  select: ["provider", "select", ["profileId", "strictOffline"], ["projectId", "modelId"]],
  inspect: ["provider", "inspect", ["profileId"], []],
  status: ["provider", "status", [], ["projectId"]],
  "local-runtime-list": ["local", "list", [], []],
  "local-manifest-import": ["local", "importManifest", [], []],
  "local-runtime-plan": ["local", "plan", ["manifestId"], ["runtimeId"]],
  "local-runtime-install": ["local", "install", ["planId"], []],
  "local-runtime-pause": ["local", "pause", ["jobId"], []],
  "local-runtime-resume": ["local", "resume", ["jobId"], []],
  "local-runtime-start": ["local", "start", ["runtimeId"], []],
  "local-runtime-stop": ["local", "stop", ["runtimeId"], []],
  "local-runtime-rollback": ["local", "rollback", ["runtimeId", "revisionId"], []],
  "local-runtime-remove": ["local", "remove", ["runtimeId"], []],
  "local-runtime-status": ["local", "status", [], ["runtimeId", "jobId"]]
});
const commandActions = Object.freeze(Object.fromEntries([
  ...["list", "import", "select", "inspect", "status"].map(action => [`agent.provider.${action}`, action]),
  ["agent.local.manifest.import", "local-manifest-import"],
  ...["list", "plan", "install", "pause", "resume", "start", "stop", "rollback", "remove", "status"].map(action => [`agent.local.runtime.${action}`, `local-runtime-${action}`])
]));
const AGENT_PROVIDER_COMMANDS = Object.freeze(Object.keys(commandActions));
const id = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const text = (value, limit = 256) => typeof value === "string" ? value.replace(/https?:\/\/\S+|\b[A-Za-z]:[\\/][^\s]+|\b(?:Bearer|Basic)\s+\S+/gi, "[private]").slice(0, limit) : "";
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const list = (value, project) => Array.isArray(value) ? value.slice(0, 500).map(project).filter(Boolean) : [];
const capabilities = value => ({ tools: value?.tools === true, vision: value?.vision === true,
  contextWindowTokens: count(value?.contextWindowTokens), maxOutputTokens: count(value?.maxOutputTokens) });
function publicProfile(value) {
  if (!value || !id(value.profileId) || !["cloud", "local-openai-compatible", "managed-local"].includes(value.providerKind)) return undefined;
  return { providerKind: value.providerKind, profileId: value.profileId, profileLabel: text(value.profileLabel),
    modelId: text(value.modelId), capabilities: capabilities(value.capabilities), strictOffline: value.strictOffline === true,
    networkScope: value.networkScope === "local" ? "local" : "remote", availability: ["configured", "not-running", "available", "unknown"].includes(value.availability) ? value.availability : "unknown",
    ...(typeof value.profileHash === "string" && /^[a-f0-9]{64}$/.test(value.profileHash) ? { profileHash: value.profileHash } : {}) };
}
function publicManifest(value) {
  if (!value || !id(value.manifestId)) return undefined;
  return { manifestId: value.manifestId, label: text(value.label), version: text(value.version), manifestHash: text(value.manifestHash, 64),
    adapter: text(value.adapter, 80), trust: text(value.trust, 80), reviewStatus: text(value.reviewStatus, 80),
    installable: value.installable === true, artifactCount: count(value.artifactCount), modelOnly: false };
}
function publicRuntime(value) {
  if (!value || !id(value.runtimeId)) return undefined;
  return { runtimeId: value.runtimeId, label: text(value.label), mode: "managed", state: text(value.state, 32),
    activeRevisionId: id(value.activeRevisionId) ? value.activeRevisionId : "", modelId: text(value.modelId), capabilities: capabilities(value.capabilities),
    revisions: list(value.revisions, revision => id(revision?.revisionId) ? { revisionId: revision.revisionId, manifestId: id(revision.manifestId) ? revision.manifestId : "",
      manifestHash: text(revision.manifestHash, 64), version: text(revision.version), state: text(revision.state, 32), createdAt: text(revision.createdAt, 64),
      modelId: text(revision.modelId), capabilities: capabilities(revision.capabilities) } : undefined),
    createdAt: text(value.createdAt, 64), updatedAt: text(value.updatedAt, 64) };
}
function publicJob(value) {
  if (!value || !id(value.jobId)) return undefined;
  return { jobId: value.jobId, planId: id(value.planId) ? value.planId : "", manifestHash: text(value.manifestHash, 64), manifestId: id(value.manifestId) ? value.manifestId : "", runtimeId: id(value.runtimeId) ? value.runtimeId : "",
    state: text(value.state, 32), downloadedBytes: count(value.downloadedBytes), totalBytes: count(value.totalBytes),
    ...(value.errorCode ? { errorCode: /^[A-Z0-9_]{1,100}$/.test(value.errorCode) ? value.errorCode : "LOCAL_RUNTIME_FAILED" } : {}),
    createdAt: text(value.createdAt, 64), updatedAt: text(value.updatedAt, 64) };
}
function publicPlan(value) {
  if (!value || !id(value.planId)) return undefined;
  const requirements = value.requirements || {};
  return { planId: value.planId, manifestId: id(value.manifestId) ? value.manifestId : "", manifestHash: text(value.manifestHash, 64),
    ...(id(value.runtimeId) ? { runtimeId: value.runtimeId } : {}), label: text(value.label), version: text(value.version),
    downloadBytes: count(value.downloadBytes), expandedBytes: count(value.expandedBytes), requiredDiskBytes: count(value.requiredDiskBytes), availableDiskBytes: count(value.availableDiskBytes), canInstall: value.canInstall === true,
    modelOnly: false, requirements: { os: list(requirements.os, item => text(item, 64)), arch: list(requirements.arch, item => text(item, 64)), gpu: list(requirements.gpu, item => text(item, 128)), vramBytes: count(requirements.vramBytes), diskBytes: count(requirements.diskBytes) },
    artifacts: list(value.artifacts, item => id(item?.artifactId) ? { artifactId: item.artifactId, label: text(item.label), kind: text(item.kind, 64), sourceLabel: text(item.sourceLabel), bytes: count(item.bytes), expandedBytes: count(item.expandedBytes),
      license: { id: text(item.license?.id, 128) }, dependencies: list(item.dependencies, dependency => id(dependency) ? dependency : undefined) } : undefined) };
}
function publicResult(value) {
  if (!value || value.ok === false) return { ok: false, errorCode: /^[A-Z0-9_]{1,100}$/.test(value?.errorCode || value?.code || "") ? value.errorCode || value.code : "AGENT_PROVIDER_FAILED", error: "本地 Agent 操作未完成，请检查配置和运行状态。" };
  const result = { ok: true };
  if (value.canceled === true) result.canceled = true;
  for (const [key, project] of [["profiles", publicProfile], ["manifests", publicManifest], ["runtimes", publicRuntime], ["jobs", publicJob]]) if (Array.isArray(value[key])) result[key] = list(value[key], project);
  for (const [key, project] of [["selected", publicProfile], ["profile", publicProfile], ["manifest", publicManifest], ["runtime", publicRuntime], ["job", publicJob]]) if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = project(value[key]) || null;
  if (value.plan || value.planId) result.plan = publicPlan(value.plan || value);
  return result;
}
function createAgentProviderControl({ agentProviderService, managedLocalLlmService } = {}) {
  const control = async (payload = {}) => {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Object.assign(new Error(), { code: "AGENT_PROVIDER_REQUEST_INVALID" });
      const action = actions[payload.action];
      if (!action) throw Object.assign(new Error(), { code: "AGENT_PROVIDER_REQUEST_INVALID" });
      const [owner, method, required, optional] = action;
      const fields = [...required, ...optional];
      if (Object.keys(payload).some(key => key !== "action" && !fields.includes(key)) || required.some(key => payload[key] === undefined)) throw Object.assign(new Error(), { code: "AGENT_PROVIDER_REQUEST_INVALID" });
      const input = {};
      for (const key of fields) if (payload[key] !== undefined) {
        const valid = key === "strictOffline" ? typeof payload[key] === "boolean" : key === "modelId" ? typeof payload[key] === "string" && payload[key].length > 0 && payload[key].length <= 256 && !/[\x00-\x1f]/.test(payload[key]) && !/https?:\/\/|^[A-Za-z]:[\\/]/i.test(payload[key]) : id(payload[key]);
        if (!valid) throw Object.assign(new Error(), { code: "AGENT_PROVIDER_REQUEST_INVALID" });
        input[key] = payload[key];
      }
      const service = owner === "provider" ? agentProviderService : managedLocalLlmService;
      if (typeof service?.[method] !== "function") throw Object.assign(new Error(), { code: "AGENT_PROVIDER_UNAVAILABLE" });
      return publicResult(await service[method](input));
    } catch (error) { return publicResult({ ok: false, errorCode: error?.code }); }
  };
  control.command = async (command, args = {}) => {
    if (!Object.prototype.hasOwnProperty.call(commandActions, command) || !args || typeof args !== "object" || Array.isArray(args) || Object.prototype.hasOwnProperty.call(args, "action")) return publicResult({ ok: false, errorCode: "AGENT_PROVIDER_REQUEST_INVALID" });
    return control({ action: commandActions[command], ...args });
  };
  return control;
}
function registerAgentProviderIpc(dependencies = {}) {
  const control = dependencies.control || createAgentProviderControl(dependencies);
  dependencies.ipcMain.handle("naimage:agent:provider", (_event, payload) => control(payload));
  return control;
}
module.exports = { createAgentProviderControl, registerAgentProviderIpc, publicProfile, publicResult, AGENT_PROVIDER_COMMANDS };
