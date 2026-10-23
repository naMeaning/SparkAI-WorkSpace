"use strict";

// Entirely throwaway native imports, loopback HTTP/TLS fixtures and managed
// process stubs. No real model, provider, download or dependency is contacted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { createAgentProviderService } = require("../desktop/agent-provider-service.cjs");
const { responseFromStreamChunks, messageFromResponse } = require("../runtime/responses-parser.cjs");
const { fixtureTls } = require("./comfyui-credential-store-selftest.cjs");

const repo = path.resolve(__dirname, ".."), results = [], services = new Set(), servers = new Set();
const runId = new Date().toISOString().replace(/[:.]/g, "-"), work = path.join(repo, ".diagnostics", `agent-provider-${runId}`);
const temporary = path.join(work, "fixtures"); fs.mkdirSync(temporary, { recursive: true });
const secretValue = `fixture-${crypto.randomBytes(24).toString("hex")}`, encryptionKey = crypto.randomBytes(32);
const clone = value => JSON.parse(JSON.stringify(value));
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv); const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
  decryptString(value) { const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8"); }
};
const capabilities = { tools: true, vision: true, contextWindowTokens: 32768, maxOutputTokens: 1024 };
const sourceProfile = (baseUrl = "http://127.0.0.1:9/v1", extra = {}) => ({ schemaVersion: 1, label: "Local fixture", kind: "local-openai-compatible", modelId: "fixture-model:local", capabilities: clone(capabilities), baseUrl, ...extra });
const tool = { type: "function", function: { name: "experience", description: "Fixture tool", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } };
const payload = extra => ({ model: "fixture-model:local", messages: [{ role: "user", content: "fixture ping" }], max_tokens: 128, ...extra });
const reply = (content = "fixture pong", calls) => ({ model: "server-alias", choices: [{ index: 0, finish_reason: calls ? "tool_calls" : "stop", message: { role: "assistant", content, ...(calls ? { tool_calls: calls } : {}) } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const call = (extra = {}) => ({ id: "call-fixture-1", type: "function", function: { name: "experience", arguments: '{"query":"fixture"}' }, ...extra });
const streamEvent = (delta, finish_reason = null) => ({ model: "server-alias", choices: [{ index: 0, delta, finish_reason }] });
function json(res, body, status = 200, headers = {}) { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); }
function publicOnly(value) {
  const text = JSON.stringify(value);
  assert(!text.includes(secretValue));
  assert(!/"(?:bindingId|baseUrl|endpoint|credentialRef|credentialFingerprint|authorization|token|runtimePath|runtimeId|filePath|rootDir)"\s*:/.test(text));
  assert(!text.includes("127.0.0.1") && !text.includes("localhost") && !text.includes(temporary));
}
async function rejection(promise, codes) {
  const accepted = Array.isArray(codes) ? codes : [codes];
  let error; try { await promise; } catch (value) { error = value; }
  assert(error, `Expected ${accepted.join(" / ")}`); assert(accepted.includes(error.code), `Expected ${accepted.join(" / ")}, got ${error.code}`);
  assert(!String(error.message).includes(secretValue) && !String(error.message).includes(temporary)); return error;
}
async function test(name, fn) {
  const start = Date.now(); await fn(); results.push({ name, ok: true, durationMs: Date.now() - start });
}
let serial = 0;
function harness(options = {}) {
  const rootDir = options.rootDir || path.join(temporary, `provider-${++serial}`); fs.mkdirSync(rootDir, { recursive: true });
  let selectedFile, chooserCalls = 0;
  const opts = { rootDir, safeStorage, dialog: { async showOpenDialog() { chooserCalls++; return selectedFile ? { canceled: false, filePaths: [selectedFile] } : { canceled: true, filePaths: [] }; } }, ...options };
  const service = createAgentProviderService(opts); services.add(service);
  return { service, rootDir, opts, chooserCalls: () => chooserCalls,
    async add(profile) { selectedFile = path.join(temporary, `import-${++serial}.json`); fs.writeFileSync(selectedFile, JSON.stringify(profile)); return service.importProfile(); },
    async bind(profile = sourceProfile(), settings = {}, strictOffline = false) {
      const imported = await this.add(profile); assert.equal(imported.ok, true, imported.error);
      const selected = await service.select({ profileId: imported.profile.profileId, strictOffline }); assert.equal(selected.ok, true, selected.error);
      return service.freeze({ runId: `fixture-${++serial}`, settings });
    }
  };
}
let totalRequests = 0;
async function fakeServer(handler, options = {}) {
  const requests = [], sockets = new Set(); let current = handler;
  const listener = async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch {}
    const request = { method: req.method, path: req.url, headers: req.headers, body, socket: req.socket };
    requests.push(request); totalRequests++;
    try { await current(request, res); } catch { if (!res.headersSent) json(res, { error: { code: "fixture_failed" } }, 500); else res.destroy(); }
  };
  const server = options.tls ? https.createServer(options.tls, listener) : http.createServer(listener);
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("tlsClientError", () => {});
  server.listen(options.port || 0, "127.0.0.1"); await once(server, "listening"); servers.add(server);
  return { server, requests, sockets, port: server.address().port, baseUrl: `${options.tls ? "https" : "http"}://127.0.0.1:${server.address().port}/v1`,
    setHandler(fn) { current = fn; },
    async close() { if (!server.listening) return; const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; servers.delete(server); }
  };
}
async function sse(res, events, { done = true, fragmented = false, crlf = false } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
  const newline = crlf ? "\r\n" : "\n", text = events.map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}${newline}${newline}`).join("") + (done ? `data: [DONE]${newline}${newline}` : "");
  const bytes = Buffer.from(text);
  if (fragmented) for (let index = 0; index < bytes.length && !res.destroyed; index += 1) { res.write(bytes.subarray(index, index + 1)); await tick(); }
  else res.write(bytes);
  res.end();
}

async function main() {
  await test("native-only import and zero-network public inspection", async () => {
    const h = harness({ lookup: () => { throw Error("unexpected lookup"); } });
    assert.equal((await h.service.importProfile({ filePath: "untrusted" })).ok, false); assert.equal(h.chooserCalls(), 0);
    const canceled = await h.service.importProfile(); assert.equal(canceled.canceled, true);
    const imported = await h.add(sourceProfile()); assert.equal(imported.ok, true); publicOnly(imported);
    publicOnly(h.service.list()); publicOnly(h.service.inspect({ profileId: imported.profile.profileId })); publicOnly(h.service.status());
    assert.equal(h.service.inspect({ profileId: imported.profile.profileId, baseUrl: "untrusted" }).ok, false);
  });
  await test("reject external, LAN, credential, query, fragment, escaped and arbitrary-prefix endpoints", async () => {
    const h = harness();
    for (const baseUrl of ["https://example.test/v1", "http://192.168.1.8:1234/v1", "http://169.254.1.8/v1", "http://user:pass@127.0.0.1/v1", "http://127.0.0.1/v1?secret=x", "http://127.0.0.1/v1#x", "file:///model", "http://127.0.0.1/api/v1", "http://127.0.0.1/%76%31", "http://127.0.0.1/v1/../arbitrary", "http://127.0.0.1\\@example.test/v1"]) {
      const result = await h.add(sourceProfile(baseUrl)); assert.equal(result.ok, false, baseUrl); assert.equal(result.errorCode, "AGENT_PROVIDER_ENDPOINT_INVALID"); publicOnly(result);
    }
    assert.equal(h.service.list().profiles.length, 1);
  });
  await test("strict schema rejects paths, scripts, cloud imports and undeclared capabilities", async () => {
    const h = harness();
    for (const profile of [sourceProfile(undefined, { script: "run" }), sourceProfile(undefined, { path: "arbitrary" }), sourceProfile(undefined, { kind: "cloud" }), sourceProfile(undefined, { modelId: "https://example.test/model" }), sourceProfile(undefined, { modelId: "C:/private/model.gguf" }), sourceProfile(undefined, { modelId: "alias/../private" }), sourceProfile(undefined, { capabilities: { tools: true, vision: false } }), sourceProfile(undefined, { capabilities: { ...capabilities, maxOutputTokens: capabilities.contextWindowTokens } }), sourceProfile(undefined, { credential: { mode: "basic", username: "x", password: "y" } }), sourceProfile(undefined, { credential: { mode: "bearer", token: "bad\nheader" } }), sourceProfile(undefined, { credential: { mode: "bearer", token: "非ASCII" } }), sourceProfile(undefined, { kind: "managed-local", runtimeId: "runtime-fixture" })]) {
      assert.equal((await h.add(profile)).ok, false);
    }
  });
  await test("public labels redact imported endpoint, path and bearer text", async () => {
    const h = harness(), result = await h.add(sourceProfile(undefined, { label: "Local https://private.invalid/a C:/private/file Bearer private-value" })); assert.equal(result.ok, true); assert.equal(result.profile.profileLabel, "Local [private] [private] [private]"); publicOnly(result);
  });
  await test("content-addressed profiles canonicalize and survive service restart", async () => {
    const h = harness(), first = await h.add(sourceProfile("http://LOCALHOST:1234/v1/")); assert.equal(first.ok, true);
    const second = await h.add({ ...sourceProfile("http://localhost:1234/v1"), capabilities: { maxOutputTokens: 1024, contextWindowTokens: 32768, vision: true, tools: true } });
    assert.equal(second.profile.profileId, first.profile.profileId); assert.equal(h.service.list().profiles.length, 2);
    await h.service.select({ profileId: first.profile.profileId, strictOffline: true }); h.service.dispose();
    const reopened = harness({ rootDir: h.rootDir }); assert.equal(reopened.service.status().selected.profileId, first.profile.profileId); assert.equal(reopened.service.isStrictOffline(), true); publicOnly(reopened.service.status());
  });
  await test("encrypted bearer sidecar and public projection exclude credentials and endpoint", async () => {
    const h = harness(), imported = await h.add(sourceProfile(undefined, { credential: { mode: "bearer", token: secretValue } })); assert.equal(imported.ok, true);
    publicOnly(imported); publicOnly(h.service.list());
    for (const filename of ["profiles.json", "credentials.secrets.json"]) assert(!fs.readFileSync(path.join(h.rootDir, filename), "utf8").includes(secretValue));
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.rootDir, "credentials.secrets.json"))).type, "sparkai-comfyui-credentials");
    const frozen = await h.bind(sourceProfile(undefined, { credential: { mode: "bearer", token: secretValue } }));
    assert.equal(h.service.getBinding(frozen.bindingId).endpoint.headers.authorization, `Bearer ${secretValue}`);
    publicOnly(h.service.status());
  });
  await test("credential import fails closed without OS encryption", async () => {
    const h = harness({ safeStorage: { isEncryptionAvailable: () => false } }), result = await h.add(sourceProfile(undefined, { credential: { mode: "bearer", token: secretValue } }));
    assert.equal(result.ok, false); assert.equal(result.errorCode, "AGENT_PROVIDER_CREDENTIAL_UNAVAILABLE"); assert(!fs.existsSync(path.join(h.rootDir, "profiles.json"))); assert(!fs.existsSync(path.join(h.rootDir, "credentials.secrets.json")));
  });
  await test("persisted profile content tampering is rejected without overwrite", async () => {
    const h = harness(); await h.add(sourceProfile()); h.service.dispose(); const filename = path.join(h.rootDir, "profiles.json"), state = JSON.parse(fs.readFileSync(filename)); state.profiles[0].descriptor.modelId = "altered"; fs.writeFileSync(filename, JSON.stringify(state));
    assert.throws(() => harness({ rootDir: h.rootDir }), error => error.code === "AGENT_PROVIDER_STORAGE_INVALID"); assert.equal(JSON.parse(fs.readFileSync(filename)).profiles[0].descriptor.modelId, "altered");
  });
  await test("project/default selection, active project lookup and strict binding scope", async () => {
    let project = "project-one"; const h = harness({ getActiveProjectId: () => project }), imported = await h.add(sourceProfile());
    await h.service.select({ projectId: "", profileId: imported.profile.profileId, strictOffline: true }); assert.equal(h.service.status().selected.strictOffline, true);
    await h.service.select({ projectId: "project-two", profileId: "cloud", modelId: "cloud-fixture", strictOffline: false });
    assert.equal(h.service.isStrictOffline("project-two"), false);
    const binding = await h.service.freeze({ projectId: "project-one", runId: "strict-one" });
    assert.equal(h.service.isStrictOffline("project-two"), true); await h.service.releaseBinding(binding.bindingId); assert.equal(h.service.isStrictOffline("project-two"), false);
    project = "project-two"; assert.equal(h.service.status().selected.profileId, "cloud");
    assert.equal(h.service.status({ projectId: "" }).selected.profileId, imported.profile.profileId);
  });
  await test("beforeSelect atomic rejection and serialized transitions preserve selection", async () => {
    const gate = deferred(), entered = deferred(), transitions = []; let deny = true, blockedId;
    const h = harness({ async beforeSelect(value) { transitions.push(value.profileId); if (value.profileId === blockedId) { entered.resolve(); await gate.promise; } if (deny && value.strictOffline) throw Object.assign(Error(secretValue), { code: "AGENT_OFFLINE_BUSY" }); } });
    const a = await h.add(sourceProfile()), b = await h.add(sourceProfile(undefined, { label: "Second fixture" }));
    const rejected = await h.service.select({ profileId: a.profile.profileId, strictOffline: true }); assert.equal(rejected.errorCode, "AGENT_OFFLINE_BUSY"); publicOnly(rejected); assert.equal(h.service.status().selected.profileId, "cloud");
    deny = false; blockedId = a.profile.profileId;
    const first = h.service.select({ profileId: a.profile.profileId, strictOffline: false }); await entered.promise;
    const second = h.service.select({ profileId: b.profile.profileId, strictOffline: false }); await tick(); assert.equal(transitions.length, 2);
    gate.resolve(); assert.equal((await first).selected.profileId, a.profile.profileId); assert.equal((await second).selected.profileId, b.profile.profileId);
  });
  await test("synchronous selection admission persists before queued network microtasks", async () => {
    let observedAtQueuedMicrotask;
    const h = harness({ beforeSelect() { queueMicrotask(() => { observedAtQueuedMicrotask = h.service.status().selected.profileId; }); } });
    const imported = await h.add(sourceProfile());
    const selected = await h.service.select({ profileId: imported.profile.profileId, strictOffline: true }); assert.equal(selected.ok, true); assert.equal(observedAtQueuedMicrotask, imported.profile.profileId);
  });
  await test("frozen provider and cloud settings do not follow later settings or selections", async () => {
    const h = harness(), settings = { agentModel: "cloud-fixture", token: secretValue, nested: { value: "frozen" } };
    const cloud = await h.service.freeze({ runId: "cloud-run", settings }); settings.nested.value = "changed"; settings.token = "changed";
    assert.equal(h.service.getBinding(cloud.bindingId).settings.nested.value, "frozen"); assert.equal(h.service.getBinding(cloud.bindingId).settings.token, secretValue);
    const local = await h.bind(sourceProfile()); await h.service.select({ profileId: "cloud", modelId: "another-cloud", strictOffline: false });
    assert.equal(h.service.getBinding(local.bindingId).snapshot.modelId, "fixture-model:local"); assert.equal(h.service.getBinding(cloud.bindingId).snapshot.modelId, "cloud-fixture");
    await rejection(h.service.complete(cloud.bindingId, payload()), "AGENT_PROVIDER_CLOUD_DELEGATED"); publicOnly(h.service.list());
    assert.equal(await h.service.releaseBinding(local.bindingId), true); assert.equal(await h.service.releaseBinding(local.bindingId), false); assert.throws(() => h.service.getBinding(local.bindingId), error => error.code === "AGENT_PROVIDER_BINDING_MISSING");
  });
  await test("strict cloud selection and model substitution are rejected", async () => {
    const h = harness(), result = await h.service.select({ profileId: "cloud", strictOffline: true }); assert.equal(result.errorCode, "AGENT_OFFLINE_BLOCKED");
    const imported = await h.add(sourceProfile()); assert.equal((await h.service.select({ profileId: imported.profile.profileId, modelId: "different", strictOffline: false })).errorCode, "AGENT_MODEL_CONFLICT");
  });
  await test("restored local receipt accepts identical identity and rejects every frozen-field drift", async () => {
    const h = harness(), original = await h.bind(sourceProfile(), {}, true); await h.service.releaseBinding(original.bindingId);
    const restored = await h.service.freeze({ runId: "restored-same", settings: { agentExecution: original } }); assert.equal(restored.profileHash, original.profileHash); assert.notEqual(restored.bindingId, original.bindingId); await h.service.releaseBinding(restored.bindingId);
    for (const change of [{ providerKind: "cloud" }, { profileId: "another" }, { profileHash: "b".repeat(64) }, { modelId: "another-model" }, { strictOffline: false }, { networkScope: "remote" }, { capabilities: { ...original.capabilities, vision: false } }, { capabilities: undefined }]) {
      await rejection(h.service.freeze({ runId: "restored-drift", settings: { agentExecution: { ...original, ...change } } }), "AGENT_PROVIDER_RECOVERY_CHANGED");
    }
    const next = await h.add(sourceProfile(undefined, { label: "Changed explicit selection" })); await h.service.select({ profileId: next.profile.profileId, strictOffline: true });
    await rejection(h.service.freeze({ runId: "restored-new-profile", settings: { agentExecution: original } }), "AGENT_PROVIDER_RECOVERY_CHANGED");
  });

  const remote = await fakeServer((_req, res) => json(res, reply())), h = harness();
  const binding = await h.bind(sourceProfile(remote.baseUrl), { token: secretValue, baseUrl: "https://cloud.invalid", agentModel: "cloud-fixture" });
  const complete = extra => h.service.complete(binding.bindingId, payload(extra));
  await test("explicit local JSON protocol has no inherited cloud key or settings", async () => {
    const value = await complete({ reasoning_effort: "high", service_tier: "priority", web_search: true });
    assert.equal(messageFromResponse(value).content, "fixture pong"); assert.equal(value.model, "fixture-model:local");
    const request = remote.requests.at(-1); assert.equal(request.path, "/v1/chat/completions"); assert.equal(request.method, "POST"); assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.cookie, undefined);
    assert.equal(request.body.model, "fixture-model:local"); assert.equal(request.body.reasoning_effort, undefined); assert.equal(request.body.service_tier, undefined); assert(!JSON.stringify(request.body).includes(secretValue));
  });
  await test("encrypted bearer is sent only on its frozen local binding", async () => {
    const authenticated = harness(), selected = await authenticated.bind(sourceProfile(remote.baseUrl, { credential: { mode: "bearer", token: secretValue } }));
    await authenticated.service.complete(selected.bindingId, payload()); assert.equal(remote.requests.at(-1).headers.authorization, `Bearer ${secretValue}`);
    authenticated.service.dispose(); publicOnly(authenticated.service.status());
  });
  await test("fragmented UTF-8 SSE LF and CRLF preserve text and callbacks", async () => {
    for (const crlf of [false, true]) {
      remote.setHandler((_req, res) => sse(res, [streamEvent({ role: "assistant", content: "本地" }), streamEvent({ content: "🙂回复" }, "stop")], { fragmented: true, crlf }));
      const seen = [], value = await complete({ stream: true, onStreamEvent: event => { seen.push(clone(event)); event.choices.length = 0; } });
      assert.equal(messageFromResponse(responseFromStreamChunks(value.chunks)).content, "本地🙂回复"); assert.equal(seen.length, 2); assert.equal(value.chunks[0].choices.length, 1);
    }
  });
  await test("SSE multi-line data and explicit finish without DONE are compatible", async () => {
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end('data: {"choices":\ndata: [{"index":0,"delta":{"content":"multi"},"finish_reason":"stop"}]}\n\n'); });
    const result = await complete({ stream: true }); assert.equal(messageFromResponse(responseFromStreamChunks(result.chunks)).content, "multi");
  });
  await test("real streamed tool ID and argument fragments survive exactly once", async () => {
    remote.setHandler((_req, res) => sse(res, [streamEvent({ tool_calls: [{ index: 0, id: "call-real", type: "function", function: { name: "experience", arguments: '{"query":' } }] }), streamEvent({ tool_calls: [{ index: 0, function: { arguments: '"fixture"}' } }] }, "tool_calls")]));
    const value = await complete({ stream: true, tools: [tool] }), result = messageFromResponse(responseFromStreamChunks(value.chunks));
    assert.equal(result.tool_calls.length, 1); assert.equal(result.tool_calls[0].id, "call-real"); assert.deepEqual(JSON.parse(result.tool_calls[0].function.arguments), { query: "fixture" });
  });
  await test("JSON tool calls require actual ID, allowed name and object arguments", async () => {
    remote.setHandler((_req, res) => json(res, reply(null, [call()]))); assert.equal(messageFromResponse(await complete({ tools: [tool] })).tool_calls[0].id, "call-fixture-1");
    for (const candidate of [call({ id: "" }), call({ id: 123 }), call({ function: { name: "shell_command", arguments: "{}" } }), call({ function: { name: "experience", arguments: "[]" } }), call({ type: "invented" }), call({ function: { name: "experience", arguments: "{" } })]) {
      remote.setHandler((_req, res) => json(res, reply(null, [candidate]))); await rejection(complete({ tools: [tool] }), "AGENT_PROVIDER_TOOL_RESPONSE_INVALID");
    }
    remote.setHandler((_req, res) => json(res, reply(null, [call(), call()]))); await rejection(complete({ tools: [tool] }), "AGENT_PROVIDER_TOOL_RESPONSE_INVALID");
  });
  await test("SSE never invents missing IDs or hides malformed or changing tool calls", async () => {
    for (const events of [
      [streamEvent({ tool_calls: [{ index: 0, function: { name: "experience", arguments: "{}" } }] }, "tool_calls")],
      [streamEvent({ tool_calls: [{ index: 0, id: 123, function: { name: "experience", arguments: "{}" } }] }, "tool_calls")],
      [streamEvent({ tool_calls: [{ index: 0, id: "call-one", function: { arguments: "{}" } }] }, "tool_calls")],
      [streamEvent({ tool_calls: [{ index: 0, id: "call-one", function: { name: "experience", arguments: "{" } }] }, "tool_calls")],
      [streamEvent({ tool_calls: [{ index: 0, id: "call-one", function: { name: "experience", arguments: "{" } }] }), streamEvent({ tool_calls: [{ index: 0, id: "call-two", function: { arguments: "}" } }] }, "tool_calls")],
      [streamEvent({ tool_calls: [{ index: 0, id: "call-one", function: { name: "unrequested", arguments: "{}" } }] }, "tool_calls")],
      [streamEvent({ tool_calls: [{ index: -1, id: "call-one", function: { name: "experience", arguments: "{}" } }] }, "tool_calls")]
    ]) { remote.setHandler((_req, res) => sse(res, events)); await rejection(complete({ stream: true, tools: [tool] }), "AGENT_PROVIDER_TOOL_RESPONSE_INVALID"); }
  });
  await test("no-tools capability rejects schema before network and malicious JSON/SSE calls", async () => {
    const limited = harness(), selected = await limited.bind(sourceProfile(remote.baseUrl, { capabilities: { ...capabilities, tools: false } })), start = remote.requests.length;
    await rejection(limited.service.complete(selected.bindingId, payload({ tools: [tool] })), "AGENT_TOOLS_UNAVAILABLE"); assert.equal(remote.requests.length, start);
    remote.setHandler((_req, res) => json(res, reply(null, [call()]))); await rejection(limited.service.complete(selected.bindingId, payload()), "AGENT_TOOLS_UNAVAILABLE");
    remote.setHandler((_req, res) => sse(res, [streamEvent({ tool_calls: [{ index: 0, ...call() }] }, "tool_calls")]));
    await rejection(limited.service.complete(selected.bindingId, payload({ stream: true })), "AGENT_TOOLS_UNAVAILABLE");
  });
  await test("no-vision and unprepared remote/file image pixels reject before network", async () => {
    const limited = harness(), selected = await limited.bind(sourceProfile(remote.baseUrl, { capabilities: { ...capabilities, vision: false } })), start = remote.requests.length;
    await rejection(limited.service.complete(selected.bindingId, payload({ messages: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] }] })), "AGENT_VISION_UNAVAILABLE");
    await rejection(limited.service.complete(selected.bindingId, payload({ tools: [{ ...tool, function: { ...tool.function, name: "view_image" } }] })), "AGENT_VISION_UNAVAILABLE");
    for (const url of ["https://example.test/private.png", "file:///private.png", "http://127.0.0.1:1/img"]) await rejection(complete({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] }), "AGENT_PROVIDER_IMAGE_SOURCE_INVALID");
    assert.equal(remote.requests.length, start);
  });
  await test("Responses-style tool observation image stays on the same compatible request", async () => {
    remote.setHandler((_req, res) => json(res, reply("vision fixture")));
    const image = `data:image/png;base64,${Buffer.alloc(100_000, 7).toString("base64")}`;
    await complete({ messages: [{ role: "assistant", tool_calls: [{ id: "observed-one", type: "function", function: { name: "view_image", arguments: "{}" } }] }, { role: "tool", tool_call_id: "observed-one", content: [{ type: "input_text", text: "fixture observation" }, { type: "input_image", image_url: image }] }] });
    const messages = remote.requests.at(-1).body.messages; assert.equal(messages.at(-2).role, "tool"); assert.equal(messages.at(-1).role, "user"); assert.equal(messages.at(-1).content.at(-1).image_url.url, image);
  });
  await test("context/output/model conflict preflight makes zero network requests", async () => {
    const start = remote.requests.length;
    await rejection(complete({ model: "cloud-fallback" }), "AGENT_MODEL_CONFLICT");
    await rejection(complete({ max_tokens: 99999 }), "AGENT_PROVIDER_CONTEXT_LIMIT");
    await rejection(complete({ max_output_tokens: 99999, max_tokens: undefined }), "AGENT_PROVIDER_CONTEXT_LIMIT");
    await rejection(complete({ messages: [{ role: "user", content: "x".repeat(300000) }] }), "AGENT_PROVIDER_CONTEXT_LIMIT");
    await rejection(complete({ tools: [tool, tool] }), "AGENT_PROVIDER_TOOLS_INVALID"); assert.equal(remote.requests.length, start);
  });
  await test("oversized visual transport is rejected independently of context estimate", async () => {
    const start = remote.requests.length, image = `data:image/png;base64,${"A".repeat(17 * 1024 * 1024)}`;
    await rejection(complete({ messages: [{ role: "user", content: [{ type: "input_image", image_url: image }] }] }), "AGENT_PROVIDER_REQUEST_TOO_LARGE"); assert.equal(remote.requests.length, start);
  });
  await test("ordinary ASCII prompt fits explicit window without UTF-8 byte false rejection", async () => {
    const limited = harness(), selected = await limited.bind(sourceProfile(remote.baseUrl, { capabilities: { ...capabilities, contextWindowTokens: 8192, maxOutputTokens: 1024 } }));
    await limited.service.complete(selected.bindingId, payload({ messages: [{ role: "system", content: "Prompt fixture ".repeat(900) }, { role: "user", content: "ping" }] }));
  });
  await test("strict offline local image schema keeps frozen explicit Comfy configuration", async () => {
    const local = harness(), selected = await local.bind(sourceProfile(remote.baseUrl), { imageProvider: "comfyui", comfyui: { connectionId: "comfyui-local", workflowId: "workflow-fixture" } }, true);
    const imageTool = { ...tool, function: { ...tool.function, name: "image_gen" } };
    await local.service.complete(selected.bindingId, payload({ tools: [imageTool] }));
    const start = remote.requests.length;
    await rejection(local.service.complete(selected.bindingId, payload({ tools: [{ ...tool, function: { ...tool.function, name: "web_search" } }] })), "AGENT_OFFLINE_BLOCKED");
    await rejection(local.service.complete(selected.bindingId, payload({ tools: [{ ...tool, function: { ...tool.function, name: "shell_command" } }] })), "AGENT_OFFLINE_BLOCKED"); assert.equal(remote.requests.length, start);
  });
  await test("upstream context error code is explicit and body secrets are redacted", async () => {
    remote.setHandler((_req, res) => json(res, { error: { code: "context_length_exceeded", message: `${secretValue} https://private.invalid/path` } }, 400));
    const error = await rejection(complete(), "AGENT_PROVIDER_CONTEXT_LIMIT"); assert.equal(error.status, 400); assert.equal(error.unsafeToRetry, true); assert(!JSON.stringify(error).includes(secretValue));
  });
  await test("HTTP auth/rejection/server status and redirect never retry or follow Location", async () => {
    for (const [status, code] of [[401, "AGENT_PROVIDER_AUTH_FAILED"], [403, "AGENT_PROVIDER_AUTH_FAILED"], [400, "AGENT_PROVIDER_REQUEST_REJECTED"], [413, "AGENT_PROVIDER_REQUEST_REJECTED"], [503, "AGENT_PROVIDER_HTTP_FAILED"], [302, "AGENT_PROVIDER_REDIRECT_FORBIDDEN"]]) {
      remote.setHandler((_req, res) => json(res, { error: { message: secretValue } }, status, { location: "http://127.0.0.1:1/never" })); const start = remote.requests.length;
      const error = await rejection(complete(), code); assert.equal(error.status, status); assert.equal(error.unsafeToRetry, true); assert.equal(remote.requests.length, start + 1);
    }
  });
  await test("TLS certificate verification stays enabled", async () => {
    const tls = await fakeServer((_req, res) => json(res, reply()), { tls: fixtureTls() }), local = harness(), selected = await local.bind(sourceProfile(tls.baseUrl));
    await rejection(local.service.complete(selected.bindingId, payload()), "AGENT_PROVIDER_TLS_FAILED"); assert.equal(tls.requests.length, 0); await tls.close();
  });
  await test("invalid JSON, incompatible Response objects and false tool text are never tool calls", async () => {
    for (const body of [null, [], { output_text: "not chat" }, { choices: [{ message: { content: "missing role" } }] }, { choices: [{ message: { role: "assistant", content: {} } }] }]) {
      remote.setHandler((_req, res) => json(res, body)); await rejection(complete(), "AGENT_PROVIDER_RESPONSE_INVALID");
    }
    remote.setHandler((_req, res) => json(res, reply('tool_call: experience {"query":"text only"}'))); const value = await complete({ tools: [tool] }); assert(!messageFromResponse(value).tool_calls);
  });
  await test("mismatched response media type and compression fail closed", async () => {
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("fixture"); }); await rejection(complete(), "AGENT_PROVIDER_RESPONSE_INVALID");
    remote.setHandler((_req, res) => json(res, reply(), 200, { "content-encoding": "gzip" })); await rejection(complete(), "AGENT_PROVIDER_ENCODING_INVALID");
    remote.setHandler((_req, res) => json(res, reply())); await rejection(complete({ stream: true }), "AGENT_PROVIDER_RESPONSE_INVALID");
  });
  await test("malformed, incomplete, post-DONE and Responses-injection streams are rejected", async () => {
    for (const events of [["null"], ["{"], [{ choices: [{}] }], [streamEvent({ content: "first" }, "stop"), streamEvent({ content: "after finish" })], ["[DONE]", streamEvent({ content: "after done" })]]) {
      remote.setHandler((_req, res) => sse(res, events)); await rejection(complete({ stream: true }), "AGENT_PROVIDER_STREAM_INVALID");
    }
    remote.setHandler((_req, res) => sse(res, [streamEvent({ content: "partial" })], { done: false })); await rejection(complete({ stream: true }), "AGENT_PROVIDER_STREAM_INCOMPLETE");
    remote.setHandler((_req, res) => sse(res, [{ choices: [], response: { output: [{ type: "function_call", name: "experience", arguments: "{}" }] } }])); await rejection(complete({ stream: true, tools: [tool] }), "AGENT_PROVIDER_EMPTY_RESPONSE");
  });
  await test("response and per-event limits close transport without retry", async () => {
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`data: ${"x".repeat(2 * 1024 * 1024 + 1)}\n\n`); }); const start = remote.requests.length;
    await rejection(complete({ stream: true }), "AGENT_PROVIDER_RESPONSE_TOO_LARGE"); assert.equal(remote.requests.length, start + 1);
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(Buffer.alloc(24 * 1024 * 1024 + 1, 32)); });
    await rejection(complete(), "AGENT_PROVIDER_RESPONSE_TOO_LARGE"); assert.equal(remote.requests.length, start + 2);
  });
  await test("fatal UTF-8 decoding rejects malformed stream and JSON bytes", async () => {
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(Buffer.from([0xff])); }); await rejection(complete({ stream: true }), ["AGENT_PROVIDER_RESPONSE_INVALID", "AGENT_PROVIDER_STREAM_INVALID"]);
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(Buffer.from([0xff])); }); await rejection(complete(), "AGENT_PROVIDER_RESPONSE_INVALID");
  });
  await test("stream callback failure closes one submitted request", async () => {
    remote.setHandler((_req, res) => sse(res, [streamEvent({ content: "fixture" }, "stop")])); const start = remote.requests.length;
    await rejection(complete({ stream: true, onStreamEvent() { throw Error(secretValue); } }), "AGENT_PROVIDER_STREAM_CALLBACK_FAILED"); assert.equal(remote.requests.length, start + 1);
  });
  await test("disconnect after partial SSE is unknown, never resubmitted", async () => {
    remote.setHandler(async (_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify(streamEvent({ content: "partial" }))}\n\n`); await tick(); res.destroy(); }); const start = remote.requests.length;
    const error = await rejection(complete({ stream: true }), ["AGENT_PROVIDER_CONNECTION_FAILED", "AGENT_PROVIDER_STREAM_INCOMPLETE"]); assert.equal(error.unsafeToRetry, true); await tick(); assert.equal(remote.requests.length, start + 1);
  });
  await test("pre-aborted request resolves without DNS or socket submission", async () => {
    let lookups = 0; const local = harness({ lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; } }), selected = await local.bind(sourceProfile(remote.baseUrl.replace("127.0.0.1", "localhost")));
    const controller = new AbortController(); controller.abort(); const start = remote.requests.length;
    await rejection(local.service.complete(selected.bindingId, payload({ signal: controller.signal })), "AGENT_PROVIDER_ABORTED"); assert.equal(lookups, 0); assert.equal(remote.requests.length, start);
  });
  await test("pending DNS cancel consumes late rejection with zero socket", async () => {
    const lookup = deferred(), entered = deferred(), unhandled = [], onUnhandled = error => unhandled.push(error); process.on("unhandledRejection", onUnhandled);
    try {
      const local = harness({ lookup: () => { entered.resolve(); return lookup.promise; } }), selected = await local.bind(sourceProfile(remote.baseUrl.replace("127.0.0.1", "localhost"))), controller = new AbortController(), start = remote.requests.length;
      const request = local.service.complete(selected.bindingId, payload({ signal: controller.signal })); await entered.promise; controller.abort(); await rejection(request, "AGENT_PROVIDER_ABORTED"); lookup.reject(Error(secretValue)); await tick(); await tick(); assert.equal(unhandled.length, 0); assert.equal(remote.requests.length, start);
    } finally { process.removeListener("unhandledRejection", onUnhandled); }
  });
  await test("DNS timeout is bounded and late approval creates no socket", async () => {
    const lookup = deferred(), local = harness({ timeoutMs: 40, lookup: () => lookup.promise }), selected = await local.bind(sourceProfile(remote.baseUrl.replace("127.0.0.1", "localhost"))), start = remote.requests.length;
    await rejection(local.service.complete(selected.bindingId, payload()), "AGENT_PROVIDER_DNS_TIMEOUT"); lookup.resolve([{ address: "127.0.0.1", family: 4 }]); await tick(); await tick(); assert.equal(remote.requests.length, start);
  });
  await test("DNS all-address validation pins one approved loopback resolution", async () => {
    let count = 0; remote.setHandler((_req, res) => json(res, reply()));
    const local = harness({ lookup: async () => { count++; return [{ address: "127.0.0.1", family: 4 }]; } }), selected = await local.bind(sourceProfile(remote.baseUrl.replace("127.0.0.1", "localhost")));
    await local.service.complete(selected.bindingId, payload()); assert.equal(count, 1);
    for (const records of [[{ address: "192.168.1.2", family: 4 }], [{ address: "127.0.0.1", family: 4 }, { address: "203.0.113.5", family: 4 }], [{ address: "::ffff:192.168.1.2", family: 6 }], []]) {
      const denied = harness({ lookup: async () => records }), deniedBinding = await denied.bind(sourceProfile(remote.baseUrl.replace("127.0.0.1", "localhost"))), start = remote.requests.length;
      await rejection(denied.service.complete(deniedBinding.bindingId, payload()), "AGENT_PROVIDER_DNS_DENIED"); assert.equal(remote.requests.length, start);
    }
  });
  await test("cancel after headers and during stream closes transport once", async () => {
    for (const writeChunk of [false, true]) {
      const entered = deferred(), controller = new AbortController(); remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); if (writeChunk) res.write(`data: ${JSON.stringify(streamEvent({ content: "partial" }))}\n\n`); entered.resolve(); });
      const start = remote.requests.length, pending = complete({ stream: true, signal: controller.signal }); await entered.promise; controller.abort(); await rejection(pending, "AGENT_PROVIDER_ABORTED"); assert.equal(remote.requests.length, start + 1);
    }
  });
  await test("HTTP timeout closes request and never retries", async () => {
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); }); const local = harness({ timeoutMs: 50 }), selected = await local.bind(sourceProfile(remote.baseUrl)), start = remote.requests.length;
    const error = await rejection(local.service.complete(selected.bindingId, payload({ stream: true })), "AGENT_PROVIDER_TIMEOUT"); assert.equal(error.unsafeToRetry, true); assert.equal(remote.requests.length, start + 1);
  });
  await test("managed acquisition intersects capabilities and uses private request alias", async () => {
    let leases = 0, releases = 0; remote.setHandler((_req, res) => json(res, reply()));
    const managed = { status: () => ({ ok: true, runtime: { state: "running" } }), acquireBinding(input, context) { assert.equal(input.modelId, "fixture-model:local"); assert(context.taskId.startsWith("agent:")); leases++; return { binding: { runtimeId: "runtime-fixture", revisionId: "revision-one", modelId: "fixture-model:local", bindingHash: "a".repeat(64), networkScope: "local", capabilities: { tools: false, vision: false, contextWindowTokens: 16384, maxOutputTokens: 512 } }, endpoint: { baseUrl: remote.baseUrl, requestModel: "sha256-private-fixture" }, release() { leases--; releases++; } }; } };
    const local = harness({ managedLocalLlmService: managed }), selected = await local.bind({ schemaVersion: 1, label: "Managed fixture", kind: "managed-local", modelId: "fixture-model:local", runtimeId: "runtime-fixture", capabilities });
    assert.equal(leases, 1); assert.equal(selected.capabilities.tools, false); assert.equal(selected.capabilities.vision, false); assert.equal(selected.capabilities.contextWindowTokens, 16384); assert.equal(selected.capabilities.maxOutputTokens, 512); publicOnly(local.service.status());
    const value = await local.service.complete(selected.bindingId, payload()); assert.equal(remote.requests.at(-1).body.model, "sha256-private-fixture"); assert.equal(value.model, "fixture-model:local"); assert.equal(leases, 1);
    await local.service.releaseBinding(selected.bindingId); await local.service.releaseBinding(selected.bindingId); assert.equal(leases, 0); assert.equal(releases, 1);
  });
  await test("managed availability is zero-network and unstarted acquisition fails closed", async () => {
    let acquisitions = 0;
    const local = harness({ managedLocalLlmService: { status: () => ({ ok: true, runtime: { state: "ready" } }), acquireBinding() { acquisitions++; throw Object.assign(Error(secretValue), { code: "MANAGED_LLM_NOT_RUNNING" }); } } });
    const imported = await local.add({ schemaVersion: 1, label: "Managed fixture", kind: "managed-local", modelId: "fixture-model:local", runtimeId: "runtime-fixture", capabilities }); assert.equal(imported.profile.availability, "not-running");
    publicOnly(local.service.list()); assert.equal(acquisitions, 0); await local.service.select({ profileId: imported.profile.profileId, strictOffline: false });
    await rejection(local.service.freeze({ runId: "not-running" }), "MANAGED_LLM_NOT_RUNNING"); assert.equal(acquisitions, 1);
  });
  await test("managed recovery requires original revision and binding hash and releases rejected acquisitions", async () => {
    let revisionId = "revision-one", bindingHash = "a".repeat(64), released = 0, active = 0;
    const managed = { acquireBinding() { active++; return { binding: { runtimeId: "runtime-fixture", revisionId, modelId: "fixture-model:local", bindingHash, networkScope: "local", capabilities }, endpoint: { baseUrl: remote.baseUrl, requestModel: "private-alias" }, release() { active--; released++; } }; } };
    const local = harness({ managedLocalLlmService: managed }), original = await local.bind({ schemaVersion: 1, label: "Managed recovery", kind: "managed-local", modelId: "fixture-model:local", runtimeId: "runtime-fixture", capabilities }); await local.service.releaseBinding(original.bindingId);
    assert.equal(original.managedRevisionId, revisionId); assert.equal(original.managedBindingHash, bindingHash); publicOnly(local.service.status());
    const same = await local.service.freeze({ runId: "managed-restore-same", settings: { agentExecution: original } }); await local.service.releaseBinding(same.bindingId);
    revisionId = "revision-two"; await rejection(local.service.freeze({ runId: "managed-revision-drift", settings: { agentExecution: original } }), "AGENT_PROVIDER_RECOVERY_CHANGED"); assert.equal(active, 0);
    revisionId = "revision-one"; bindingHash = "b".repeat(64); await rejection(local.service.freeze({ runId: "managed-binding-drift", settings: { agentExecution: original } }), "AGENT_PROVIDER_RECOVERY_CHANGED"); assert.equal(active, 0);
    bindingHash = "a".repeat(64); const legacy = clone(original); delete legacy.managedRevisionId; delete legacy.managedBindingHash;
    await rejection(local.service.freeze({ runId: "managed-missing-recovery", settings: { agentExecution: legacy } }), "AGENT_PROVIDER_RECOVERY_CHANGED"); assert.equal(active, 0); assert.equal(released, 5);
  });
  await test("invalid managed binding endpoint cannot escape loopback and releases lease", async () => {
    let released = 0;
    const local = harness({ managedLocalLlmService: { acquireBinding() { return { binding: { runtimeId: "runtime-fixture", revisionId: "revision-one", modelId: "fixture-model:local", bindingHash: "a".repeat(64), networkScope: "local", capabilities }, endpoint: { baseUrl: "https://external.invalid/v1", requestModel: "private-alias" }, release() { released++; } }; } } });
    const imported = await local.add({ schemaVersion: 1, label: "Managed endpoint", kind: "managed-local", modelId: "fixture-model:local", runtimeId: "runtime-fixture", capabilities }); await local.service.select({ profileId: imported.profile.profileId, strictOffline: false });
    await rejection(local.service.freeze({ runId: "invalid-managed-endpoint" }), "AGENT_PROVIDER_ENDPOINT_INVALID"); assert.equal(released, 1);
  });
  await test("managed lease survives cancellation until client request close barrier", async () => {
    const entered = deferred(), clientRequests = []; let releases = 0, closedAtRelease = false;
    remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); entered.resolve(); });
    const original = http.request; http.request = function (...args) { const req = original.apply(this, args); clientRequests.push(req); return req; };
    try {
      const managed = { acquireBinding() { return { binding: { runtimeId: "runtime-fixture", revisionId: "revision-one", modelId: "fixture-model:local", bindingHash: "a".repeat(64), networkScope: "local", capabilities }, endpoint: { baseUrl: remote.baseUrl, requestModel: "private-alias" }, release() { releases++; closedAtRelease = clientRequests.length === 1 && clientRequests.every(req => req.closed && req.destroyed); } }; } };
      const local = harness({ managedLocalLlmService: managed }), selected = await local.bind({ schemaVersion: 1, label: "Managed fixture", kind: "managed-local", modelId: "fixture-model:local", runtimeId: "runtime-fixture", capabilities }, {}, true);
      const pending = rejection(local.service.complete(selected.bindingId, payload({ stream: true })), "AGENT_PROVIDER_ABORTED"); await entered.promise;
      const released = local.service.releaseBinding(selected.bindingId); assert.equal(releases, 0); assert.equal(local.service.isStrictOffline("other-project"), true); assert.equal(await local.service.releaseBinding(selected.bindingId), false);
      assert.equal(await released, true); await pending; assert.equal(releases, 1); assert.equal(closedAtRelease, true);
    } finally { http.request = original; }
  });
  await test("service dispose cancels pending work and invalidates all bindings", async () => {
    const entered = deferred(); remote.setHandler((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); entered.resolve(); });
    const local = harness(), selected = await local.bind(sourceProfile(remote.baseUrl)), pending = local.service.complete(selected.bindingId, payload({ stream: true })); await entered.promise; local.service.dispose();
    await rejection(pending, "AGENT_PROVIDER_ABORTED"); assert.equal(local.service.list().errorCode, "AGENT_PROVIDER_DISPOSED"); assert.throws(() => local.service.getBinding(selected.bindingId), error => error.code === "AGENT_PROVIDER_BINDING_MISSING");
  });
  await test("service restart persists selection but never auto-replays old bindings", async () => {
    const local = harness(), selected = await local.bind(sourceProfile(remote.baseUrl)); local.service.dispose();
    const start = remote.requests.length, reopened = harness({ rootDir: local.rootDir });
    assert.equal(reopened.service.status().selected.profileId, selected.profileId); assert.throws(() => reopened.service.getBinding(selected.bindingId), error => error.code === "AGENT_PROVIDER_BINDING_MISSING"); await tick(); assert.equal(remote.requests.length, start);
    remote.setHandler((_req, res) => json(res, reply("after restart")));
    const newBinding = await reopened.service.freeze({ runId: "after-restart" }); assert.equal(messageFromResponse(await reopened.service.complete(newBinding.bindingId, payload())).content, "after restart");
  });
  await test("endpoint restart requires explicit caller request and no cloud fallback", async () => {
    const endpoint = await fakeServer((_req, res) => json(res, reply())), local = harness(), selected = await local.bind(sourceProfile(endpoint.baseUrl)); await local.service.complete(selected.bindingId, payload()); const port = endpoint.port; await endpoint.close();
    const before = totalRequests; await rejection(local.service.complete(selected.bindingId, payload()), "AGENT_PROVIDER_CONNECTION_FAILED"); await tick(); assert.equal(totalRequests, before);
    const restarted = await fakeServer((_req, res) => json(res, reply("explicit recovery")), { port }); await tick(); assert.equal(restarted.requests.length, 0);
    const value = await local.service.complete(selected.bindingId, payload()); assert.equal(messageFromResponse(value).content, "explicit recovery"); assert.equal(restarted.requests.length, 1); await restarted.close();
  });
  await remote.close();

  const report = { ok: true, phase: 4, cases: results.length, results, loopbackRequests: totalRequests, realModelRequests: 0, nonLoopbackRequests: 0, modelDownloads: 0, dependencyInstalls: 0, sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "desktop/agent-provider-service.cjs"))).digest("hex"), contextPreflight: "ASCII/3 + nonASCII codepoints*2 + message/schema overhead; visual allowance separate; estimate only" };
  fs.writeFileSync(path.join(work, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: path.relative(repo, path.join(work, "report.json")).replaceAll("\\", "/") })}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; }).finally(async () => {
  await Promise.all([...services].map(service => service.dispose()));
  for (const server of servers) { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; }
  // Only this test-created directory is removed; reports remain reviewable.
  const resolved = path.resolve(temporary); assert(resolved.startsWith(path.resolve(work) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true });
});
