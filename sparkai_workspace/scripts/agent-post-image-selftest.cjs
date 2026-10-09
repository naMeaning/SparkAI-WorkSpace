"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { createAgentRuntime } = require("../agent-runtime.cjs");
const { createAgentRunControl } = require("../desktop/agent-run-control.cjs");

const root = path.resolve(__dirname, "..");
const runDir = path.join(root, ".diagnostics", "electron", `agent-post-image-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const settings = { agentModel: "gpt-6.1-sol", contextStrategy: "codex", imageModel: "grok-imagine-image-2.0",
  imageModelPool: ["grok-imagine-image-2.0"], imageRatio: "1:1", imageResolution: "1K", imageConcurrency: 1 };
const response = (output) => ({ chunks: [{ type: "response.completed", response: { status: "completed", output } }] });
const textResponse = (text) => response([{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }]);
const callResponse = (name, args, id) => response([{ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) }]);
const imageArgs = { operation: "generate", prompt: "Local image fixture", ratio: "1:1", resolution: "1K", count: 1 };
const gatewayError = () => Object.assign(new Error("502 at https://private.example?token=secret-sentinel"), { status: 502 });

async function scenario(name, mode) {
  const scenarioRoot = path.join(runDir, name);
  const projectRoot = path.join(scenarioRoot, "project");
  const imagePath = path.join(projectRoot, "output", "imagegen", "fixture.png");
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#2593b5" } }).png().toFile(imagePath);
  const control = createAgentRunControl();
  const runId = `post-image-${name}`;
  const controlled = control.begin({ projectId: "fixture", conversationId: name, runId, ownerId: "fixture", steerable: true });
  const events = [];
  const requests = [];
  let imageCalls = 0;
  let resumed = false;
  const runtime = createAgentRuntime({
    projectRoot, configDir: path.join(scenarioRoot, "config"), resolveProjectRoot: () => projectRoot,
    serverGenerateImage: async () => {
      imageCalls++;
      if (mode === "image-failure" || (mode === "partial-batch" && imageCalls === 2)) throw Object.assign(new Error("Image unavailable"), { status: 401, retriable: false });
      return { ok: true, model: settings.imageModel, size: "1024x1024", assets: [{ path: imagePath, mimeType: "image/png", width: 1024, height: 1024 }] };
    },
    serverChatCompletion: async (request) => {
      requests.push(request);
      if (resumed) return textResponse("Existing image retained; no new generation.");
      const tools = request.messages.filter((message) => message.role === "tool");
      if (mode === "first-failure") throw gatewayError();
      if (!tools.length) return callResponse("image_gen", { ...imageArgs, count: mode === "partial-batch" ? 2 : 1 }, "image-call");
      if (mode === "image-failure" || mode === "before-review") throw gatewayError();
      if (!tools.some((message) => message.name === "view_image")) {
        return callResponse("view_image", { path: mode === "view-failure" ? "missing.png" : imagePath, detail: "high" }, "view-call");
      }
      if (mode === "cancel") {
        control.stop({ runId, ownerId: "fixture" });
        throw request.signal.reason;
      }
      if (mode === "steer" && requests.length === 3) {
        control.steer({ runId, ownerId: "fixture", prompt: "Keep the existing image and finish." });
        throw request.signal.reason;
      }
      if (mode === "steer" || mode === "success") return textResponse("Visual review completed.");
      if (mode === "partial-stream") request.onStreamEvent?.({ choices: [{ delta: { content: "unfinished draft" } }] });
      throw gatewayError();
    }
  });
  const payload = { runId, projectId: "fixture", conversationId: name, prompt: "Generate a local test image", nodes: [], messages: [], settings,
    signal: controlled.signal, beginPhase: (meta) => control.beginPhase(controlled, meta),
    consumeSteers: () => control.consumeSteers(controlled),
    waitUntilRunnable: (signal) => control.waitUntilRunnable(controlled, signal), progress: (event) => events.push(event) };
  try {
    if (["first-failure", "image-failure", "cancel"].includes(mode)) {
      await assert.rejects(() => runtime.chat(payload), (error) => mode === "cancel" ? error.code === "NAIMAGE_RUN_CANCELLED" : error.status === 502);
      assert.equal(events.some((event) => event.phase === "runtime-partial"), false);
      assert.equal(imageCalls, mode === "first-failure" ? 0 : 1);
      return { name, throws: true, imageCalls };
    }
    const result = await runtime.chat(payload);
    assert.equal(result.ok, true);
    const expectedImageCalls = mode === "partial-batch" ? 2 : 1;
    assert.equal(imageCalls, expectedImageCalls, "No model recovery may replay image generation");
    assert.equal(result.actions.filter((action) => action.node?.assets?.length).length, 1);
    assert.equal(result.toolResults.find((tool) => tool.tool === "image_gen").ok, true);
    if (["success", "steer"].includes(mode)) {
      assert.equal(result.completion, undefined);
      assert.equal(result.content, "Visual review completed.");
      return { name, completion: "complete", imageCalls };
    }
    assert.equal(result.completion, "partial");
    assert.equal(result.modelFailure.status, 502);
    assert.equal(result.executionFailed, ["partial-batch", "view-failure"].includes(mode));
    assert.match(result.content, /视觉质检或最终回复未完成/);
    assert.doesNotMatch(JSON.stringify(result), /secret-sentinel|private.example/);
    assert.equal(events.filter((event) => event.phase === "runtime-partial").length, 1);
    assert.equal(events.filter((event) => event.tool === "image_gen" && event.phase === "tool-done").length, 1);
    if (mode === "view-failure") {
      assert.equal(result.toolResults.find((tool) => tool.tool === "view_image").ok, false);
      assert.match(result.content, /部分工具未完成/);
    } else if (mode !== "before-review") {
      assert.equal(result.toolResults.find((tool) => tool.tool === "view_image").ok, true);
    }
    // A later turn must see the actual call/output pairs and the incomplete
    // receipt, rather than forgetting the already billed generation.
    const persisted = JSON.parse(fs.readFileSync(path.join(projectRoot, ".naimage", "agent", "conversations.json"), "utf8"));
    assert.equal(persisted.protocols[name].turns.length, 1);
    assert.doesNotMatch(JSON.stringify(persisted.protocols), /data:image\/png;base64/);
    resumed = true;
    const resumedResult = await runtime.chat({ ...payload, settings: { ...settings, agentModel: "gpt-5.6-sol" },
      runId: `${runId}-resume`, prompt: "Describe the existing result", beginPhase: undefined, signal: undefined });
    assert.equal(resumedResult.completion, undefined);
    const history = requests[requests.length - 1].messages.flatMap((message) => message.role === "responses_items" ? message.items : []);
    assert.equal(history.filter((item) => item.type === "function_call" && item.name === "image_gen").length, 1);
    assert.equal(history.filter((item) => item.type === "function_call_output" && item.call_id === "image-call").length, 1);
    assert.ok(history.some((item) => item.type === "message" && JSON.stringify(item).includes("最终回复未完成")));
    assert.doesNotMatch(JSON.stringify(history), /data:image\/png;base64/);
    assert.equal(imageCalls, expectedImageCalls);
    return { name, completion: result.completion, imageCalls, protocolRetained: true, toolFailure: mode === "view-failure" };
  } catch (error) {
    fs.writeFileSync(path.join(scenarioRoot, "failure-events.json"), JSON.stringify(events, null, 2));
    throw error;
  } finally { runtime.dispose(); control.finish(controlled); }
}

(async () => {
  const results = [];
  for (const mode of ["after-view", "before-review", "view-failure", "partial-batch", "partial-stream", "first-failure", "image-failure", "cancel", "steer", "success"]) {
    results.push(await scenario(mode, mode));
  }
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify({ ok: true, realModelRequests: 0, results }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, results, report: path.relative(root, path.join(runDir, "report.json")) }) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
