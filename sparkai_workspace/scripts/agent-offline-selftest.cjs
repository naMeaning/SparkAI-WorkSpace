"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createAgentRuntime } = require("../agent-runtime.cjs");
const { createAgentProviderService } = require("../desktop/agent-provider-service.cjs");
const { contextStrategyForSettings } = require("../runtime/context-strategy.cjs");
const { agentToolSchemas } = require("../runtime/tool-schemas.cjs");
const { imageConfigSnapshot, settingsWithImageConfig } = require("../runtime/image-config-snapshot.mjs");
const { assertAgentToolAllowed } = require("../runtime/agent-provider-policy.cjs");

const runDir = path.resolve(__dirname, "../.diagnostics", `agent-offline-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const reports = [], requests = [], scope = { projectId: "offline-project", conversationId: "offline-conversation" };
let mode = "text", onRequest, service, runtime, picker;
const settings = { agentModel: "cloud-sentinel", compactModel: "cloud-compact-sentinel", imageModel: "gpt-image-2" };
const server = http.createServer(async (req, res) => {
  const buffers = []; for await (const chunk of req) buffers.push(chunk);
  const body = JSON.parse(Buffer.concat(buffers).toString()); requests.push({ path: req.url, body, authorization: req.headers.authorization });
  await onRequest?.();
  res.writeHead(200, { "content-type": "text/event-stream" });
  const event = value => res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, ...value }] })}\n\n`);
  if (mode === "malicious" || mode === "tool" && !body.messages.some(message => message.role === "tool")) {
    event({ delta: { role: "assistant", tool_calls: [{ index: 0, id: "offline-experience-once", type: "function", function: { name: "experience", arguments: '{"action":' } }] } });
    event({ delta: { tool_calls: [{ index: 0, function: { arguments: '"read"}' } }] } });
    event({ delta: {}, finish_reason: "tool_calls" });
  } else {
    event({ delta: { role: "assistant", content: "本地" } }); event({ delta: { content: "回复。" } }); event({ delta: {}, finish_reason: "stop" });
  }
  res.end("data: [DONE]\n\n");
});
const test = async (name, fn) => { await fn(); reports.push({ name, ok: true }); };

async function importLocal(tools, vision = false, contextWindowTokens = 200000) {
  picker = path.join(runDir, `profile-${tools}-${vision}-${contextWindowTokens}.json`);
  fs.writeFileSync(picker, JSON.stringify({ schemaVersion: 1, kind: "local-openai-compatible", label: "Loopback fixture", baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    modelId: "gpt-5.6-local-fixture", capabilities: { tools, vision, contextWindowTokens, maxOutputTokens: 1024 } }));
  const imported = await service.importProfile(); assert.equal(imported.ok, true, imported.error);
  const selected = await service.select({ projectId: scope.projectId, profileId: imported.profile.profileId, strictOffline: true }); assert.equal(selected.ok, true, selected.error);
  return imported.profile;
}
async function boundChat(runId, extra = {}) {
  const execution = await service.freeze({ ...scope, runId, settings });
  try {
    return await runtime.chat({ ...scope, runId, prompt: "仅回复本地夹具文本。", nodes: [], messages: [], ...extra,
      settings: { ...settings, agentModel: execution.modelId, agentExecution: execution } });
  } finally { service.releaseBinding(execution.bindingId); }
}
function makeRuntime() {
  return createAgentRuntime({ projectRoot: runDir, configDir: path.join(runDir, "runtime"),
    serverChatCompletion: request => service.complete(request.agentBindingId, request),
    serverGenerateImage() { throw new Error("A cloud/image request is forbidden in this fixture"); } });
}
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  service = createAgentProviderService({ rootDir: path.join(runDir, "profiles"), dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [picker] }) } });
  runtime = makeRuntime();
  await test("single runtime streams local text with an empty tool set and no cloud credentials", async () => {
    await importLocal(false); const result = await boundChat("offline-text"); assert.equal(result.content, "本地回复。");
    assert.equal(requests.length, 1); assert.equal(requests[0].path, "/v1/chat/completions"); assert.equal(requests[0].authorization, undefined);
    assert.equal(requests[0].body.tools, undefined); assert.equal(requests[0].body.reasoning_effort, undefined); assert.equal(requests[0].body.service_tier, undefined);
  });
  await test("GPT-like local model names never infer Responses, native web search or a cloud compact model", async () => {
    const execution = await service.freeze({ ...scope, runId: "offline-policy", settings });
    try {
      const local = { ...settings, agentModel: execution.modelId, agentExecution: execution }, strategy = contextStrategyForSettings(local);
      assert.equal(strategy.useResponsesProtocol, false); assert.equal(strategy.useNativeWebSearch, false); assert.equal(strategy.family, "local");
      assert.deepEqual(agentToolSchemas(local), []);
      const before = requests.length; const compose = await runtime.composeImagePrompt({ ...scope, settings: local, request: "fixture" });
      assert.equal(compose.errorCode, "AGENT_TOOLS_UNAVAILABLE"); assert.equal(requests.length, before);
      await assert.rejects(runtime.runTool("view_image", { path: "missing.png" }, { settings: local }), { code: "AGENT_TOOLS_UNAVAILABLE" });
    } finally { service.releaseBinding(execution.bindingId); }
  });
  await test("undeclared tool calls are rejected without executing a tool or replaying POST", async () => {
    mode = "malicious"; const before = requests.length;
    await assert.rejects(boundChat("offline-malicious"), { code: "AGENT_TOOLS_UNAVAILABLE" }); assert.equal(requests.length, before + 1); mode = "text";
  });
  await test("declared streaming tool arguments execute once while a mid-run selection change preserves the original binding", async () => {
    await importLocal(true); mode = "tool"; const before = requests.length;
    onRequest = async () => { onRequest = null; const changed = await service.select({ projectId: scope.projectId, profileId: "cloud", strictOffline: false }); assert.equal(changed.ok, true); };
    const result = await boundChat("offline-tools"); assert.equal(result.content, "本地回复。"); assert.equal(result.toolResults.filter(tool => tool.tool === "experience").length, 1);
    assert.equal(requests.length, before + 2); for (const request of requests.slice(before)) assert.equal(request.body.model, "gpt-5.6-local-fixture"); mode = "text";
  });
  await test("vision, Shell, web search and cloud image execution are blocked at runtime entry", async () => {
    await importLocal(true); const execution = await service.freeze({ ...scope, runId: "offline-vision", settings });
    const local = { ...settings, agentModel: execution.modelId, agentExecution: execution }, before = requests.length;
    try {
      const names = agentToolSchemas(local).map(tool => tool.function?.name || tool.type);
      for (const name of ["view_image", "web_search", "shell_command", "image_gen"]) assert.equal(names.includes(name), false);
      await assert.rejects(runtime.runTool("view_image", { path: "missing.png" }, { settings: local }), { code: "AGENT_VISION_UNAVAILABLE" });
      assert.throws(() => assertAgentToolAllowed(local, "shell_command"), { code: "AGENT_OFFLINE_BLOCKED" });
      await assert.rejects(service.complete(execution.bindingId, { model: execution.modelId, messages: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AA==" }] }] }), { code: "AGENT_VISION_UNAVAILABLE" });
      assert.equal(requests.length, before);
    } finally { service.releaseBinding(execution.bindingId); }
  });
  await test("frozen image configuration contains explicit IDs and parameters without URL or material paths", async () => {
    const snapshot = imageConfigSnapshot({ ...settings, imageProvider: "comfyui", comfyui: { connectionId: "local-test", templateId: "stock-generate", templateHash: "a".repeat(64), baseUrl: "http://private.example", checkpoint: "fixture.safetensors", seed: 42, width: 512, height: 768, steps: 12 } });
    assert.equal(snapshot.comfyui.connectionId, "local-test"); assert.equal(snapshot.comfyui.baseUrl, undefined); assert.equal(snapshot.model, "fixture.safetensors");
    assert.equal(settingsWithImageConfig({}, snapshot).comfyui.steps, 12);
    assert.deepEqual(imageConfigSnapshot(settings).provider, undefined);
  });
  await test("runtime restart preserves the same project Prompt and FastMemory without inference or downloads", async () => {
    runtime.saveMainPrompt({ text: "OFFLINE_PROMPT_SENTINEL" }); runtime.saveFastMemory({ ...scope, text: "OFFLINE_MEMORY_SENTINEL" });
    runtime.dispose?.(); runtime = makeRuntime();
    assert.ok(JSON.stringify(runtime.getMainPrompt()).includes("OFFLINE_PROMPT_SENTINEL")); assert.ok(JSON.stringify(runtime.getFastMemory(scope)).includes("OFFLINE_MEMORY_SENTINEL"));
    const before = requests.length; const result = await boundChat("offline-restart"); assert.equal(result.content, "本地回复。");
    assert.equal(requests.length, before + 1); assert.ok(JSON.stringify(requests.at(-1).body).includes("OFFLINE_MEMORY_SENTINEL"));
  });
  const report = { ok: true, cases: reports.length, results: reports, loopbackPosts: requests.length, realModelRequests: 0, realDownloads: 0, realDependencyInstalls: 0 };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, results: undefined, report: path.join(runDir, "report.json") }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { runtime?.dispose?.(); await service?.dispose?.(); await new Promise(resolve => server.close(resolve)); });
