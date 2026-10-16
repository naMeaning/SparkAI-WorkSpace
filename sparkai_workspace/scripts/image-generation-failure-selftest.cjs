"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");
const { createAgentRuntime } = require("../agent-runtime.cjs");
const { publicEvent } = require("../desktop/runtime-diagnostics.cjs");

const model = "grok-imagine-image-2.0";
const settings = { accessMode: "custom", imageModel: model, imageModelPool: [model], imageBaseUrl: "https://fixture.invalid/v1",
  imageApiKey: "fixture-key", agentModel: "gpt-6.1-sol", contextStrategy: "codex", imageRatio: "1:1", imageResolution: "1K", imageConcurrency: 1 };
const root = path.resolve(__dirname, "..");
const runDir = path.join(root, ".diagnostics", `image-generation-failure-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const report = { ok: false, realModelRequests: 0, cases: [] };
const response = (status, message = "Upstream service temporarily unavailable https://private.example/?token=private-sentinel") => ({ ok: status < 400, status, headers: { get: () => "application/json" },
  text: async () => JSON.stringify(status < 400 ? { data: [{ b64_json: "aW1hZ2U=" }] }
    : { error: { message } }) });
function clientFor(transport, extra = {}) {
  return createNewApiClient({ defaultSettings: settings, accessPolicy: { customApiAccess: true },
    isLocalServerUrl: () => false, normalizeServerUrl: (v, fallback = "") => String(v || fallback).replace(/\/+$/, ""),
    newApiTransportFetch: transport, ...extra });
}
function serviceFor(client, recordDiagnostic) {
  return createImageGenerationService({ newApiRelayJson: client.newApiRelayJson, newApiRelayMultipart: client.newApiRelayMultipart, recordDiagnostic });
}
async function checkTransport() {
  for (const protocol of ["xai-images", "openai-images", "gemini-native"]) {
    for (const status of [502, 503, 504]) {
      let calls = 0;
      const events = [];
      const service = serviceFor(clientFor(async () => { calls++; return response(status); }), e => events.push(publicEvent(e)));
      await assert.rejects(() => service.generate({ ...settings, imageModelBindings: [{ model, protocol }] }, {
        model, prompt: "fixture", n: 1, ...(protocol === "openai-images" ? { editImage: { dataUrl: "data:image/png;base64,aW1hZ2U=" } } : {})
      }), error => {
        assert.equal(error.status, status);
        assert.equal(error.errorCategory, "image_generation_uncertain");
        assert.equal(error.ambiguous, true);
        assert.equal(error.unsafeToRetry, true);
        assert.equal(error.generationCompleted, false);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.match(error.message, /已停止自动重试/);
        assert.doesNotMatch(error.message, /private|https:|token/);
        return true;
      });
      assert.equal(calls, 1);
      assert.equal(events.at(-1).category, "image_generation_uncertain");
      assert.equal(events.at(-1).status, status);
      report.cases.push(`${protocol}-${status}`);
    }
  }
  for (const code of ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET"]) {
    for (const multipart of [false, true]) {
      let calls = 0;
      const client = clientFor(async () => { calls++; throw Object.assign(new Error("socket closed private-sentinel"), { code }); });
      const operation = multipart ? client.newApiRelayMultipart(settings, "/v1/images/edits", new FormData(), { model })
        : client.newApiRelayJson(settings, "/v1/images/generations", { model, n: 1 });
      await assert.rejects(operation, e => e.unsafeToRetry === true && e.ambiguous === true && !e.message.includes("private-sentinel"));
      assert.equal(calls, 1);
      report.cases.push(`${multipart ? "multipart" : "json"}-${code}`);
    }
  }
  for (const status of [400, 401, 403, 404, 422, 429]) {
    const client = clientFor(async () => response(status));
    await assert.rejects(client.newApiRelayJson(settings, "/v1/images/generations", { model }),
      e => e.status === status && e.unsafeToRetry !== true && e.ambiguous !== true);
    report.cases.push(`definitive-${status}`);
  }
  const client = clientFor(async () => response(502));
  await assert.rejects(clientFor(async () => response(400, "invalid timeout parameter")).newApiRelayJson(settings, "/v1/images/generations", { model }),
    e => e.status === 400 && e.unsafeToRetry !== true);
  report.cases.push("explicit-400-before-message-heuristics");
  await assert.rejects(client.newApiRelayJson(settings, "/v1/chat/completions", { model: settings.agentModel }, { provider: "agent" }),
    e => e.status === 502 && e.unsafeToRetry !== true);
  report.cases.push("chat-error-unchanged");
  const controller = new AbortController();
  const cancelled = Object.assign(new Error("cancelled"), { code: "NAIMAGE_RUN_CANCELLED" });
  const cancellationClient = clientFor(async () => { controller.abort(cancelled); throw cancelled; });
  await assert.rejects(cancellationClient.newApiRelayJson(settings, "/v1/images/generations", { model }, { signal: controller.signal }), e => e === cancelled);
  report.cases.push("cancellation-preserved");
  let preflightPosts = 0;
  const credentialError = Object.assign(new Error("account unavailable"), { status: 502 });
  const credentialClient = clientFor(async () => { preflightPosts++; return response(200); }, { resolveAccountApiCredentials: async () => { throw credentialError; } });
  await assert.rejects(credentialClient.newApiRelayJson({ ...settings, accessMode: "account", serverSessionCookie: "fixture", serverUserId: "1" },
    "/v1/images/generations", { model }), e => e === credentialError && e.unsafeToRetry !== true);
  assert.equal(preflightPosts, 0);
  report.cases.push("credential-failure-before-post");
  const successful = await serviceFor(clientFor(async () => response(200))).generate(settings, { model, prompt: "fixture", n: 1 });
  assert.equal(successful.images.length, 1);
  report.cases.push("successful-generation");
}
async function checkAgent() {
  let posts = 0;
  const service = serviceFor(clientFor(async () => { posts++; return response(502); }));
  const projectRoot = path.join(runDir, "project");
  const runtime = createAgentRuntime({ projectRoot, configDir: path.join(runDir, "config"), resolveProjectRoot: () => projectRoot,
    serverGenerateImage: payload => service.generate(settings, payload),
    serverChatCompletion: async request => {
      const tools = request.messages.filter(m => m.role === "tool");
      const output = tools.length < 2 ? [{ type: "function_call", name: "image_gen", call_id: `image-${tools.length}`,
        arguments: JSON.stringify({ operation: "generate", prompt: `Changed prompt ${tools.length}`, count: 1, ratio: "1:1", resolution: "1K" }) }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "图片渠道返回 HTTP 502，已停止自动重试，请先查询渠道结果。" }] }];
      return { chunks: [{ type: "response.completed", response: { status: "completed", output } }] };
    }
  });
  try {
    for (const turn of [1, 2]) {
      const events = [];
      const result = await runtime.chat({ runId: `failure-${turn}`, projectId: "fixture", conversationId: `turn-${turn}`, prompt: "Generate one fixture image",
        settings, messages: [], nodes: [], referenceImages: [], progress: e => events.push(e) });
      assert.equal(posts, turn, "Model's changed-prompt retry must not dispatch another image POST; a new explicit turn may dispatch once");
      const failures = result.toolResults.filter(r => r.tool === "image_gen");
      assert.equal(failures.length, 2);
      for (const failure of failures) {
        assert.equal(failure.ok, false);
        assert.equal(failure.errorCategory, "image_generation_uncertain");
        assert.equal(failure.retriable, false);
        assert.match(failure.advice, /不要再次调用 image_gen/);
      }
      assert.equal(events.some(e => e.phase === "tool-done" && e.tool === "image_gen"), false);
      assert.doesNotMatch(JSON.stringify(result), /private-sentinel|private\.example/);
    }
    report.cases.push("agent-retry-blocked", "new-user-turn-unblocked");
  } finally { runtime.dispose(); }
}
(async () => {
  fs.mkdirSync(runDir, { recursive: true });
  await checkTransport();
  await checkAgent();
  report.ok = true;
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: path.relative(root, path.join(runDir, "report.json")) }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
