"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { createComfyUiExecutor, normalizeWorkflow, localBaseUrl, stableHash } = require("../runtime/image-generation/comfyui-executor.cjs");

const copy = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isCode = (code) => (error) => { assert.equal(error.code, code); return true; };
const cases = [];
let totalPosts = 0, totalDeletes = 0, wsConnections = 0, fixtureImage;

function workflow() {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "fixture.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "fixture positive", clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "fixture negative", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 64, height: 96, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: 42, steps: 4, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1 } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "SparkAI" } }
  };
}

// Independent stock object_info fixture; production registry is not used to
// synthesize its own expected values.
function objectInfo() {
  return {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["fixture.safetensors", "alternate.safetensors"]] } }, output: ["MODEL", "CLIP", "VAE"], python_module: "nodes" },
    CLIPTextEncode: { input: { required: { text: ["STRING"], clip: ["CLIP"] } }, output: ["CONDITIONING"], python_module: "nodes" },
    EmptyLatentImage: { input: { required: { width: ["INT", { min: 16, max: 4096 }], height: ["INT", { min: 16, max: 4096 }], batch_size: ["INT", { min: 1, max: 4 }] } }, output: ["LATENT"], python_module: "nodes" },
    KSampler: { input: { required: { model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"], seed: ["INT", { min: 0 }], steps: ["INT", { min: 1, max: 1000 }], cfg: ["FLOAT"], sampler_name: [["euler", "dpmpp_2m"]], scheduler: [["normal", "karras"]], denoise: ["FLOAT", { min: 0, max: 1 }] } }, output: ["LATENT"], python_module: "nodes" },
    VAEDecode: { input: { required: { samples: ["LATENT"], vae: ["VAE"] } }, output: ["IMAGE"], python_module: "nodes" },
    VAEEncode: { input: { required: { pixels: ["IMAGE"], vae: ["VAE"] } }, output: ["LATENT"], python_module: "nodes" },
    LoadImage: { input: { required: { image: [["old-server-input.png"]] } }, output: ["IMAGE", "MASK"], python_module: "nodes" },
    SaveImage: { input: { required: { images: ["IMAGE"], filename_prefix: ["STRING"] } }, output: [], output_node: true, python_module: "nodes" },
    PreviewImage: { input: { required: { images: ["IMAGE"] } }, output: [], output_node: true, python_module: "nodes" }
  };
}

function wsFrame(value, opcode = 1) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  if (body.length < 126) return Buffer.concat([Buffer.from([128 | opcode, body.length]), body]);
  const header = Buffer.alloc(4); header[0] = 128 | opcode; header[1] = 126; header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

async function mockServer(config = {}) {
  const state = { config, posts: [], gets: [], deletes: [], uploads: [], views: [], history: {}, pending: [], running: [], sockets: new Map(), redirects: 0, timers: new Set() };
  function later(fn, ms) { const timer = setTimeout(() => { state.timers.delete(timer); fn(); }, ms); state.timers.add(timer); }
  function json(response, value, status = 200) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); }
  function emit(clientId, value, binary = false) { for (const socket of state.sockets.get(clientId) || []) if (!socket.destroyed) socket.write(wsFrame(value, binary ? 2 : 1)); }
  function finish(promptId, tuple) {
    state.pending = state.pending.filter((entry) => entry[1] !== promptId); state.running = state.running.filter((entry) => entry[1] !== promptId);
    state.history[promptId] = { prompt: tuple, outputs: { "7": { images: [{ filename: `${promptId}.png`, subfolder: "fixtures", type: "output" }] }, "8": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] }, "99": { images: [{ filename: "unselected.png", subfolder: "", type: "output" }] } }, status: { completed: true, status_str: "success", messages: [] } };
    if (config.failure) state.history[promptId].status = { completed: true, status_str: "error", messages: [["execution_error", { exception_message: "fixture internal details must not escape" }]] };
    if (config.output) state.history[promptId].outputs = config.output;
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET") state.gets.push(url.pathname);
    try {
      if (config.redirectPath === url.pathname) { res.writeHead(302, { location: `${state.baseUrl}/redirect-target` }); return res.end(); }
      if (url.pathname === "/redirect-target") { state.redirects += 1; return json(res, {}); }
      if (url.pathname === "/system_stats") return json(res, { system: { os: "mock" } });
      if (url.pathname === "/object_info") return json(res, config.objectInfo || objectInfo());
      if (url.pathname === "/upload/image") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks); state.uploads.push(bytes);
        assert.ok(bytes.includes(fixtureImage), "HTTP multipart contains original input bytes");
        return json(res, config.upload || { name: "uploaded.png", subfolder: "task-inputs", type: "input" });
      }
      if (url.pathname === "/prompt") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString()); state.posts.push(body); totalPosts += 1;
        const promptId = `prompt-${state.posts.length}`, tuple = [state.posts.length, promptId, body.prompt, { client_id: body.client_id }, ["7"]];
        if (config.promptStatus) return json(res, { error: "fixture rejection" }, config.promptStatus);
        if (config.missingAck) return json(res, {});
        state.pending.push(tuple);
        if (config.events) later(() => {
          emit(body.client_id, { type: "progress", data: { prompt_id: "someone-else", value: 88, max: 100, node: "5" } });
          emit(body.client_id, { type: "progress", data: { value: 99, max: 100 } });
          emit(body.client_id, { type: "status", data: { prompt_id: promptId, status: { exec_info: { queue_remaining: 9 } } } });
          emit(body.client_id, { type: "progress", data: { prompt_id: promptId, value: 999, max: 100 } });
          emit(body.client_id, Buffer.from([1, 2, 3, 4]), true);
          emit(body.client_id, { type: "executing", data: { prompt_id: promptId, node: "5" } });
          emit(body.client_id, { type: "progress", data: { prompt_id: promptId, value: 2, max: 4, node: "5" } });
        }, 40);
        if (!config.hold) later(() => finish(promptId, tuple), config.finishAfterMs || (config.events ? 120 : 10));
        if (config.disconnect) return req.socket.destroy();
        if (config.abortDuringPost) { config.abortDuringPost(); return req.socket.destroy(); }
        return json(res, { prompt_id: promptId, number: state.posts.length, node_errors: {} });
      }
      if (url.pathname === "/history") return json(res, state.history);
      if (url.pathname.startsWith("/history/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop());
        return json(res, config.historyBody || (state.history[id] ? { [id]: state.history[id] } : {}));
      }
      if (url.pathname === "/queue" && req.method === "POST") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString()); state.deletes.push(body); totalDeletes += 1;
        assert.deepEqual(Object.keys(body), ["delete"]); assert.equal(body.delete.length, 1);
        if (config.cancelRace) { state.running.push(...state.pending.filter((entry) => body.delete.includes(entry[1]))); }
        if (!config.ignoreDelete) state.pending = state.pending.filter((entry) => !body.delete.includes(entry[1]));
        return json(res, {});
      }
      if (url.pathname === "/queue") return json(res, config.queueBody || { queue_pending: state.pending, queue_running: state.running });
      if (url.pathname === "/view") {
        state.views.push(Object.fromEntries(url.searchParams));
        if (config.viewStatus) return json(res, {}, config.viewStatus);
        res.writeHead(200, { "content-type": config.contentType || "image/png" }); return res.end(config.imageBytes || fixtureImage);
      }
      if (url.pathname === "/interrupt") throw new Error("Global interrupt is forbidden");
      json(res, {}, 404);
    } catch (error) { if (!res.headersSent) json(res, { fixtureError: error.message }, 500); else res.destroy(); }
  });
  server.on("upgrade", (req, socket) => {
    socket.on("error", () => {});
    const url = new URL(req.url, "http://127.0.0.1");
    const clientId = url.searchParams.get("clientId");
    if (config.wsRedirect) { socket.end(`HTTP/1.1 302 Found\r\nLocation: ${state.baseUrl}/redirect-target\r\nConnection: close\r\n\r\n`); return; }
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    if (!state.sockets.has(clientId)) state.sockets.set(clientId, new Set());
    state.sockets.get(clientId).add(socket); wsConnections += 1;
    socket.on("close", () => state.sockets.get(clientId)?.delete(socket));
    socket.on("data", (bytes) => { if ((bytes[0] & 15) === 8) socket.end(Buffer.from([136, 0])); });
    if (config.closeWs) later(() => socket.destroy(), 20);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  state.baseUrl = `http://127.0.0.1:${server.address().port}`;
  state.close = async () => { for (const timer of state.timers) clearTimeout(timer); for (const sockets of state.sockets.values()) for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
  state.finish = finish;
  return state;
}

async function fixture(config, fn) { const server = await mockServer(config); try { return await fn(server); } finally { await server.close(); } }
async function test(name, fn) { const started = Date.now(); await fn(); cases.push({ name, ok: true, durationMs: Date.now() - started }); }
function input(server, extra = {}) { return { baseUrl: server.baseUrl, submissionId: "operation-fixture", workflow: workflow(), inputMappings: [], outputNodeId: "7", pollIntervalMs: 10, maxWaitMs: 1000, ...extra }; }
function executor(extra = {}) { return createComfyUiExecutor({ persistAccepted: async () => {}, ...extra }); }
function saved(server, extra = {}) { return { schemaVersion: 1, submissionId: "operation-fixture", baseUrl: server.baseUrl, promptId: "saved-prompt", clientId: "saved-client", workflowHash: stableHash(workflow()), outputNodeId: "7", actualParams: { model: "fixture.safetensors", width: 64, height: 96, seed: 42 }, ...extra }; }
function tuple(snapshot) { return [1, snapshot.promptId, workflow(), { client_id: snapshot.clientId }, [snapshot.outputNodeId]]; }
function resultRecord(snapshot, extra = {}) { return { prompt: tuple(snapshot), status: { completed: true, status_str: "success" }, outputs: { "7": { images: [{ filename: "saved.png", subfolder: "", type: "output" }] } }, ...extra }; }

async function main() {
  fixtureImage = await sharp({ create: { width: 64, height: 96, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 0.5 } } }).png().toBuffer();
  await test("localhost URL, credentials, proxy paths and public hosts", async () => {
    assert.equal(localBaseUrl("http://127.0.0.1:8188/"), "http://127.0.0.1:8188");
    assert.equal(localBaseUrl("http://[::1]:8188"), "http://[::1]:8188");
    for (const url of ["http://example.com", "http://127.0.0.2", "ftp://localhost"]) assert.throws(() => localBaseUrl(url), isCode("COMFYUI_LOCAL_ONLY"));
    for (const url of ["http://user:pass@localhost:8188", "http://localhost:8188/?token=fixture", "http://localhost:8188/#secret", "http://localhost/proxy", "http://localhost\\@example.com", " http://localhost"]) assert.throws(() => localBaseUrl(url), isCode("COMFYUI_URL_INVALID"));
  });
  await test("inspect projects bounded sampler capabilities without private object_info", async () => fixture({}, async server => {
    const inspected = await executor().inspect(server.baseUrl);
    assert.deepEqual(inspected.checkpoints, ["fixture.safetensors", "alternate.safetensors"]);
    assert.deepEqual(inspected.samplers, ["euler", "dpmpp_2m"]);
    assert.deepEqual(inspected.schedulers, ["normal", "karras"]);
    assert.deepEqual(inspected.parameterRanges.steps, { min: 1, max: 150, step: 1 });
    assert.deepEqual(inspected.parameterRanges.cfg, { min: 0, max: 30, step: 0.1 });
    assert.deepEqual(inspected.parameterRanges.denoise, { min: 0, max: 1, step: 0.01 });
    assert.match(inspected.capabilitiesHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(inspected.capabilities).includes("python_path"), false);
    assert.equal(inspected.objectInfo, undefined); assert.equal(inspected.systemStats, undefined);
  }));
  await test("inspect omits unsupported range intersections and uses integer steps", async () => {
    const objects = objectInfo(); delete objects.KSampler.input.required.steps;
    objects.KSampler.input.required.cfg = ["INT", { min: 1, max: 20 }]; objects.KSampler.input.required.denoise = ["FLOAT", { min: 2, max: 4 }];
    await fixture({ objectInfo: objects }, async server => {
      const inspected = await executor().inspect(server.baseUrl);
      assert.deepEqual(inspected.parameterRanges, { cfg: { min: 1, max: 20, step: 1 } });
    });
  });
  await test("API Format core whitelist and typed acyclic graph", async () => {
    const opts = { outputNodeId: "7", inputMappings: [] }, original = workflow();
    const normalized = normalizeWorkflow(original, opts);
    assert.equal(normalized.nodes.length, 7); assert.equal(normalized.workflowHash.length, 64);
    const reordered = Object.fromEntries(Object.entries(original).reverse()); assert.equal(normalizeWorkflow(reordered, opts).workflowHash, normalized.workflowHash);
    for (const classType of ["PythonExec", "InnocentCustomNode", "LoadImageFromURL", "constructor"]) {
      const item = workflow(); item["4"] = { class_type: classType, inputs: {} };
      assert.throws(() => normalizeWorkflow(item, opts), (error) => ["COMFYUI_NODE_UNAPPROVED", "COMFYUI_WORKFLOW_INVALID"].includes(error.code));
    }
    const wrong = workflow(); wrong["5"].inputs.model = ["2", 0]; assert.throws(() => normalizeWorkflow(wrong, opts), isCode("COMFYUI_WORKFLOW_INVALID"));
    const cycle = workflow(); cycle["5"].inputs.latent_image = ["5", 0]; assert.throws(() => normalizeWorkflow(cycle, opts), isCode("COMFYUI_WORKFLOW_INVALID"));
    const missing = workflow(); delete missing["5"].inputs.seed; assert.throws(() => normalizeWorkflow(missing, opts), isCode("COMFYUI_WORKFLOW_INVALID"));
    const extra = workflow(); extra["5"].inputs.code = "arbitrary"; assert.throws(() => normalizeWorkflow(extra, opts), isCode("COMFYUI_WORKFLOW_INVALID"));
  });
  await test("template policy drift fails before inspect or prompt POST", async () => fixture({}, async server => {
    const canonical = normalizeWorkflow(workflow(), { outputNodeId: "7", inputMappings: [] });
    const templateHash = stableHash({ workflow: canonical.workflow, inputMappings: canonical.inputMappings, outputNodeId: canonical.outputNodeId, policyVersion: "comfyui-core-v2" });
    await assert.rejects(executor().run(input(server, { templateHash, policyVersion: "changed-policy" })), isCode("COMFYUI_TEMPLATE_CHANGED"));
    assert.equal(server.posts.length, 0);
    assert.equal(server.gets.length, 0);
  }));
  await test("explicit safe input and final-output mappings", async () => {
    for (const opts of [{ inputMappings: [] }, { outputNodeId: "6", inputMappings: [] }, { outputNodeId: "7" }, { outputNodeId: "7", inputMappings: [{ nodeId: "5", inputName: "model", value: ["1", 0] }] }, { outputNodeId: "7", inputMappings: [{ nodeId: "2", inputName: "text", kind: "seed" }] }]) assert.throws(() => normalizeWorkflow(workflow(), opts), isCode("COMFYUI_NODE_MAPPING_INVALID"));
    const bad = workflow(); bad["7"].inputs.filename_prefix = "../outside"; assert.throws(() => normalizeWorkflow(bad, { outputNodeId: "7", inputMappings: [] }), isCode("COMFYUI_WORKFLOW_INVALID"));
  });
  await test("HTTP generation, exact output node and immutable parameters", () => fixture({}, async (server) => {
    let prepared, accepted; const events = [];
    const e = executor({ persistPrepared: async (value) => { prepared = value; events.push("prepared"); assert.equal(server.posts.length, 0); value.actualParams.seed = 999; }, persistAccepted: async (value) => { accepted = copy(value); events.push("persisted"); assert.equal(server.gets.filter((p) => p.startsWith("/history/")).length, 0); value.actualParams.width = 999; } });
    const request = input(server, { inputMappings: [{ nodeId: "2", inputName: "text", kind: "prompt" }, { nodeId: "5", inputName: "seed", kind: "seed" }, { nodeId: "1", inputName: "ckpt_name", kind: "model" }], prompt: "mapped positive", seed: 123, checkpoint: "alternate.safetensors", onAccepted: () => events.push("accepted") });
    const running = e.run(request); request.workflow["2"].inputs.text = "mutated after submission"; request.inputMappings[0].kind = "negative";
    const result = await running;
    assert.deepEqual(events, ["prepared", "persisted", "accepted"]); assert.equal(server.posts.length, 1);
    assert.equal(server.posts[0].prompt["2"].inputs.text, "mapped positive");
    assert.equal(result.actualParams.seed, 123); assert.equal(result.actualParams.width, 64); assert.equal(result.actualParams.model, "alternate.safetensors");
    assert.equal(accepted.workflowHash, stableHash(server.posts[0].prompt)); assert.equal(prepared.workflowHash, accepted.workflowHash);
    assert.equal(server.views.length, 1); assert.equal(server.views[0].filename, "prompt-1.png"); assert.equal(server.views[0].type, "output");
    assert.deepEqual(Buffer.from(result.images[0].value, "base64"), fixtureImage); assert.equal(result.images[0].mimeType, "image/png");
    assert.equal((await sharp(Buffer.from(result.images[0].value, "base64")).metadata()).height, 96);
  }));
  await test("unique concurrent submission, frozen random seed and changed-content conflict", () => fixture({}, async (server) => {
    const e = executor(), request = input(server); request.workflow["5"].inputs.seed = -1;
    const [first, second] = await Promise.all([e.run(request), e.run(copy(request))]);
    assert.equal(server.posts.length, 1); assert.equal(first.promptId, second.promptId); assert.equal(first.actualParams.seed, second.actualParams.seed); assert.ok(first.actualParams.seed >= 0);
    assert.equal((await e.run(copy(request))).promptId, first.promptId); assert.equal(server.posts.length, 1);
    const changed = copy(request); changed.workflow["2"].inputs.text = "different"; await assert.rejects(e.run(changed), isCode("COMFYUI_SUBMISSION_CONFLICT")); assert.equal(server.posts.length, 1);
  }));
  await test("sampling mappings materialize, freeze actual parameters and deduplicate by sampling values", () => fixture({}, async server => {
    let prepared, accepted;
    const e = executor({ persistPrepared: async value => { prepared = copy(value); }, persistAccepted: async value => { accepted = copy(value); } });
    const inputMappings = [["steps", "steps"], ["cfg", "cfg"], ["sampler_name", "sampler"], ["scheduler", "scheduler"], ["denoise", "denoise"]]
      .map(([inputName, kind]) => ({ nodeId: "5", inputName, kind }));
    const request = input(server, { inputMappings, steps: 12, cfg: 6.5, sampler: "dpmpp_2m", scheduler: "karras", denoise: 0.75 });
    const [first, repeated] = await Promise.all([e.run(request), e.run(copy(request))]);
    assert.equal(first.promptId, repeated.promptId); assert.equal(server.posts.length, 1);
    const sampler = server.posts[0].prompt["5"].inputs;
    assert.equal(sampler.steps, 12); assert.equal(sampler.cfg, 6.5); assert.equal(sampler.sampler_name, "dpmpp_2m"); assert.equal(sampler.scheduler, "karras"); assert.equal(sampler.denoise, 0.75);
    for (const snapshot of [prepared, accepted, first]) {
      assert.equal(snapshot.actualParams.steps, 12); assert.equal(snapshot.actualParams.cfg, 6.5); assert.equal(snapshot.actualParams.sampler, "dpmpp_2m"); assert.equal(snapshot.actualParams.scheduler, "karras"); assert.equal(snapshot.actualParams.denoise, 0.75);
    }
    assert.equal(accepted.workflowHash, stableHash(server.posts[0].prompt)); assert.match(accepted.capabilitiesHash, /^[a-f0-9]{64}$/);
    for (const [field, value] of [["sampler", "euler"], ["steps", 13], ["cfg", 7]]) await assert.rejects(e.run({ ...request, [field]: value }), isCode("COMFYUI_SUBMISSION_CONFLICT"));
    assert.equal(server.posts.length, 1);
  }));
  await test("sampling options require declared mappings and local numeric capability", async () => {
    await fixture({}, async server => {
      for (const [field, value] of [["steps", 10], ["cfg", 7], ["sampler", "euler"], ["scheduler", "normal"], ["denoise", 0.5]]) await assert.rejects(executor().run(input(server, { [field]: value })), isCode("COMFYUI_PARAMETER_UNSUPPORTED"));
      assert.equal(server.posts.length, 0);
    });
    const limited = objectInfo(); limited.KSampler.input.required.steps = ["INT", { min: 1, max: 8 }];
    await fixture({ objectInfo: limited }, async server => {
      await assert.rejects(executor().run(input(server, { inputMappings: [{ nodeId: "5", inputName: "steps", kind: "steps" }], steps: 12 })), isCode("COMFYUI_DEPENDENCY_MISSING"));
      assert.equal(server.posts.length, 0); assert.equal(server.uploads.length, 0);
    });
  });
  await test("canonical sampling defaults and fixed mappings ignore mutable metadata", () => fixture({}, async server => {
    let prepared;
    const request = input(server, { inputMappings: [{ nodeId: "5", inputName: "steps", kind: "steps" }, { nodeId: "5", inputName: "cfg", kind: "cfg", value: 6.5 }], defaults: { steps: 120, cfg: 30 }, exposedInputs: ["steps", "cfg"] });
    const e = executor({ persistPrepared: async value => { prepared = copy(value); } });
    const pending = e.run(request);
    request.defaults.steps = 149; request.exposedInputs.length = 0; request.inputMappings[0].kind = "value"; request.workflow["5"].inputs.steps = 140;
    const result = await pending;
    assert.equal(result.actualParams.steps, 4); assert.equal(result.actualParams.cfg, 6.5); assert.equal(prepared.actualParams.steps, 4); assert.equal(server.posts[0].prompt["5"].inputs.steps, 4);
    await assert.rejects(executor().run(input(server, { inputMappings: [{ nodeId: "5", inputName: "steps", kind: "steps", value: 12 }], steps: 13, exposedInputs: ["steps"] })), isCode("COMFYUI_PARAMETER_UNSUPPORTED"));
    assert.equal(server.posts.length, 1);
  }));
  await test("missing persistence, stable id and prepared write failure produce zero POST", () => fixture({}, async (server) => {
    await assert.rejects(createComfyUiExecutor().run(input(server)), isCode("COMFYUI_PERSISTENCE_REQUIRED"));
    await assert.rejects(executor().run(input(server, { submissionId: undefined })), isCode("COMFYUI_SUBMISSION_ID_REQUIRED"));
    await assert.rejects(executor({ persistPrepared: async () => { throw Object.assign(new Error("fixture write failed"), { code: "EACCES" }); } }).run(input(server)), isCode("EACCES")); assert.equal(server.posts.length, 0);
  }));
  await test("accepted persistence failure preserves prompt identity and never resubmits", () => fixture({}, async (server) => {
    const e = executor({ persistAccepted: async () => { throw new Error("fixture write failed"); } }); let accepted;
    await assert.rejects(e.run(input(server)), (error) => { assert.equal(error.code, "COMFYUI_ACCEPTED_PERSIST_FAILED"); assert.equal(error.promptId, "prompt-1"); assert.equal(error.unsafeToRetry, true); accepted = error.accepted; return true; });
    await assert.rejects(e.run(input(server)), isCode("COMFYUI_ACCEPTED_PERSIST_FAILED")); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 0);
    await sleep(20); assert.equal((await executor().recover({ accepted })).ok, true); assert.equal(server.posts.length, 1);
  }));
  await test("missing nodes, weights, sampler and incompatible dependencies fail before upload/POST", async () => {
    const variants = [];
    const missing = objectInfo(); delete missing.KSampler; variants.push(missing);
    const weights = objectInfo(); weights.CheckpointLoaderSimple.input.required.ckpt_name = [["other.safetensors"]]; variants.push(weights);
    const sampler = objectInfo(); sampler.KSampler.input.required.sampler_name = [["other"]]; variants.push(sampler);
    const edge = objectInfo(); edge.VAEDecode.input.required.samples = ["IMAGE"]; variants.push(edge);
    const required = objectInfo(); required.KSampler.input.required.unreviewed = ["STRING"]; variants.push(required);
    const custom = objectInfo(); custom.KSampler.python_module = "custom_nodes.fixture"; variants.push(custom);
    for (const info of variants) await fixture({ objectInfo: info }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_DEPENDENCY_MISSING")); assert.equal(server.posts.length, 0); assert.equal(server.uploads.length, 0); });
  });
  await test("mapped image upload freezes original bytes, model, seed and dimensions", () => fixture({}, async (server) => {
    const item = workflow(); item["4"] = { class_type: "LoadImage", inputs: { image: "placeholder.png" } }; item["8"] = { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["1", 2] } }; item["5"].inputs.latent_image = ["8", 0];
    let accepted; const e = executor({ persistAccepted: async (value) => { accepted = value; } });
    const result = await e.run(input(server, { workflow: item, inputNodeId: "4", inputs: [{ buffer: fixtureImage, name: "sensitive-local-name.png" }], inputMappings: [{ nodeId: "4", inputName: "image", kind: "image", index: 0 }] }));
    assert.equal(server.uploads.length, 1); assert.ok(!server.uploads[0].includes("sensitive-local-name"));
    assert.equal(server.posts[0].prompt["4"].inputs.image, "task-inputs/uploaded.png"); assert.equal(result.actualParams.width, 64); assert.equal(result.actualParams.height, 96);
    assert.equal(accepted.inputs[0].sha256, createHash("sha256").update(fixtureImage).digest("hex")); assert.equal(accepted.inputs[0].bytes, fixtureImage.length);
    assert.throws(() => normalizeWorkflow(item, { outputNodeId: "7", inputMappings: [] }), isCode("COMFYUI_NODE_MAPPING_INVALID"));
  }));
  await test("invalid upload identity and image mapping cannot reach prompt", async () => {
    await fixture({ upload: { name: "../outside.png", type: "input" } }, async (server) => {
      const item = workflow(); item["4"] = { class_type: "LoadImage", inputs: { image: "placeholder.png" } }; item["8"] = { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["1", 2] } }; item["5"].inputs.latent_image = ["8", 0];
      await assert.rejects(executor().run(input(server, { workflow: item, inputs: [{ buffer: fixtureImage }], inputMappings: [{ nodeId: "4", inputName: "image", kind: "image", index: 0 }] })), isCode("COMFYUI_UPLOAD_INVALID")); assert.equal(server.posts.length, 0);
    });
    await fixture({}, async (server) => { await assert.rejects(executor().run(input(server, { inputs: [{ buffer: fixtureImage }] })), isCode("COMFYUI_NODE_MAPPING_INVALID")); assert.equal(server.posts.length, 0); });
  });
  await test("real WebSocket isolates prompt progress and ignores binary/global/invalid events", () => fixture({ events: true }, async (server) => {
    const statuses = [], result = await executor().run(input(server, { onStatus: (event) => statuses.push(event) }));
    assert.equal(result.ok, true); assert.equal(statuses.length, 2); assert.deepEqual(statuses.map((event) => event.type), ["executing", "progress"]); assert.ok(statuses.every((event) => event.promptId === result.promptId)); assert.equal(statuses[1].progress, 2); assert.equal(server.views.length, 1);
  }));
  await test("concurrent jobs have separate WS client ids and unrelated events stay isolated", () => fixture({ events: true }, async (server) => {
    const e = executor(), a = [], b = [];
    const [first, second] = await Promise.all([e.run(input(server, { submissionId: "operation-a", onStatus: (event) => a.push(event) })), e.run(input(server, { submissionId: "operation-b", onStatus: (event) => b.push(event) }))]);
    assert.notEqual(server.posts[0].client_id, server.posts[1].client_id); assert.equal(server.posts.length, 2); assert.equal(a.length, 2); assert.equal(b.length, 2); assert.ok(a.every((event) => event.promptId === first.promptId)); assert.ok(b.every((event) => event.promptId === second.promptId));
  }));
  await test("WS disconnect and WS redirect use HTTP history without following redirect", async () => {
    for (const config of [{ closeWs: true, events: true }, { wsRedirect: true, events: true }]) await fixture(config, async (server) => { const result = await executor().run(input(server, { onStatus() {} })); assert.equal(result.ok, true); assert.equal(server.redirects, 0); assert.equal(server.posts.length, 1); });
  });
  await test("explicit HTTP 400/401/429 are rejected; 408/500/503 remain unknown and never retry", async () => {
    for (const status of [400, 401, 429, 408, 500, 503]) await fixture({ promptStatus: status }, async (server) => {
      const e = executor(), known = status < 500 && status !== 408;
      const check = (error) => { assert.equal(error.code, known ? "COMFYUI_PROMPT_REJECTED" : "COMFYUI_SUBMISSION_UNKNOWN"); assert.equal(error.ambiguous, !known); assert.equal(error.unsafeToRetry, !known); assert.equal(error.status, status); return true; };
      await assert.rejects(e.run(input(server)), check); await assert.rejects(e.run(input(server)), check); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 0);
    });
  });
  await test("HTTP redirects are refused at inspect, submission and output download", async () => {
    await fixture({ redirectPath: "/system_stats" }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_REDIRECT_FORBIDDEN")); assert.equal(server.posts.length, 0); assert.equal(server.redirects, 0); });
    await fixture({ redirectPath: "/prompt" }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_SUBMISSION_UNKNOWN")); assert.equal(server.redirects, 0); });
    await fixture({ redirectPath: "/view" }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_REDIRECT_FORBIDDEN")); assert.equal(server.redirects, 0); assert.equal(server.posts.length, 1); });
  });
  await test("missing acknowledgement stays unknown with no automatic resubmission", () => fixture({ missingAck: true }, async (server) => {
    const e = executor(); let snapshot;
    await assert.rejects(e.run(input(server)), (error) => { snapshot = error.snapshot; return isCode("COMFYUI_SUBMISSION_UNKNOWN")(error); });
    await assert.rejects(e.run(input(server)), isCode("COMFYUI_SUBMISSION_UNKNOWN")); assert.equal((await executor().recover({ accepted: snapshot })).state, "unknown"); assert.equal(server.posts.length, 1);
  }));
  await test("lost acknowledgement recovers queued task using exact client id and workflow hash", () => fixture({ disconnect: true, hold: true }, async (server) => {
    let snapshot; await assert.rejects(executor().run(input(server)), (error) => { snapshot = error.snapshot; return isCode("COMFYUI_SUBMISSION_UNKNOWN")(error); });
    let accepted; const e = executor({ persistAccepted: async (value) => { accepted = value; } }), result = await e.recover({ accepted: snapshot });
    assert.equal(result.state, "queued"); assert.equal(accepted.promptId, "prompt-1"); assert.equal(accepted.recovered, true); assert.equal(server.posts.length, 1);
    const changed = copy(snapshot); changed.workflowHash = "0".repeat(64); await assert.rejects(e.recover({ accepted: changed }), isCode("COMFYUI_TASK_OWNERSHIP_MISMATCH")); assert.equal(server.posts.length, 1);
  }));
  await test("lost acknowledgement recovers completed task from history and refuses duplicate matches", () => fixture({ disconnect: true }, async (server) => {
    let snapshot; await assert.rejects(executor().run(input(server)), (error) => { snapshot = error.snapshot; return isCode("COMFYUI_SUBMISSION_UNKNOWN")(error); });
    await sleep(20); assert.equal((await executor().recover({ accepted: snapshot })).ok, true); assert.equal(server.posts.length, 1);
    server.history["duplicate-prompt"] = copy(server.history["prompt-1"]); server.history["duplicate-prompt"].prompt[1] = "duplicate-prompt";
    await assert.rejects(executor().recover({ accepted: snapshot }), isCode("COMFYUI_AMBIGUOUS_RECOVERY")); assert.equal(server.posts.length, 1);
  }));
  await test("abort before POST is safe; abort during POST remains ambiguous", async () => {
    await fixture({}, async (server) => { const controller = new AbortController(); controller.abort(); await assert.rejects(executor().run(input(server, { signal: controller.signal })), isCode("ABORT_ERR")); assert.equal(server.posts.length, 0); });
    const controller = new AbortController(); await fixture({ abortDuringPost: () => controller.abort() }, async (server) => { await assert.rejects(executor().run(input(server, { signal: controller.signal })), (error) => { assert.equal(error.code, "COMFYUI_SUBMISSION_UNKNOWN"); assert.equal(error.unsafeToRetry, true); return true; }); assert.equal(server.posts.length, 1); });
  });
  await test("accepted timeout and abort preserve task and support read-only recovery", async () => {
    await fixture({ hold: true }, async (server) => { let accepted; const e = executor({ persistAccepted: async (value) => { accepted = value; } }); await assert.rejects(e.run(input(server, { maxWaitMs: 50 })), isCode("COMFYUI_TIMEOUT")); assert.equal((await executor().recover({ accepted })).state, "queued"); assert.equal(server.posts.length, 1); });
    await fixture({ hold: true }, async (server) => { const controller = new AbortController(); let accepted; const e = executor({ persistAccepted: async (value) => { accepted = value; controller.abort(); } }); await assert.rejects(e.run(input(server, { signal: controller.signal })), isCode("ABORT_ERR")); assert.equal((await executor().recover({ accepted })).state, "queued"); assert.equal(server.deletes.length, 0); assert.equal(server.posts.length, 1); });
  });
  await test("restart recovery distinguishes queued/running/unknown/failed/succeeded", () => fixture({}, async (server) => {
    const snapshot = saved(server), e = executor(); server.pending.push(tuple(snapshot));
    assert.equal((await e.recover({ accepted: snapshot })).state, "queued"); server.running.push(server.pending.pop());
    assert.equal((await e.recover({ accepted: snapshot })).state, "running"); server.running = [];
    assert.equal((await e.recover({ accepted: snapshot })).state, "unknown");
    server.history[snapshot.promptId] = resultRecord(snapshot, { status: { completed: true, status_str: "error" } }); assert.equal((await e.recover({ accepted: snapshot })).state, "failed"); assert.equal(server.views.length, 0);
    server.history[snapshot.promptId] = resultRecord(snapshot); assert.equal((await e.recover({ accepted: snapshot })).state, "succeeded"); assert.equal(server.posts.length, 0);
  }));
  await test("recovery ignores changed diagnostic capabilities", () => fixture({ objectInfo: { ...objectInfo(), KSampler: { ...objectInfo().KSampler, input: { required: { ...objectInfo().KSampler.input.required, sampler_name: [["different"]] } } } } }, async server => {
    const snapshot = saved(server, { capabilitiesHash: "a".repeat(64) }); server.history[snapshot.promptId] = resultRecord(snapshot);
    const result = await executor().recover({ accepted: snapshot });
    assert.equal(result.state, "succeeded"); assert.equal(server.posts.length, 0); assert.equal(server.gets.includes("/object_info"), false);
  }));
  await test("child process recovers frozen accepted receipt without any prompt POST", () => fixture({}, async (server) => {
    const snapshot = saved(server); server.history[snapshot.promptId] = resultRecord(snapshot);
    const program = "let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{try{const r=await require(process.argv[1]).createComfyUiExecutor().recover({accepted:JSON.parse(raw)});process.stdout.write(JSON.stringify({state:r.state,count:r.images.length,width:r.images[0].width}));}catch(e){process.stderr.write(e.code||e.message);process.exitCode=1;}});";
    const child = spawn(process.execPath, ["-e", program, require.resolve("../runtime/image-generation/comfyui-executor.cjs")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.stdin.end(JSON.stringify(snapshot));
    const [code] = await once(child, "exit"); assert.equal(code, 0, stderr); assert.deepEqual(JSON.parse(stdout), { state: "succeeded", count: 1, width: 64 }); assert.equal(server.posts.length, 0);
  }));
  await test("history errors stop run without downloading or regenerating", () => fixture({ failure: true }, async (server) => { const e = executor(); await assert.rejects(e.run(input(server)), isCode("COMFYUI_EXECUTION_FAILED")); await assert.rejects(e.run(input(server)), isCode("COMFYUI_EXECUTION_FAILED")); assert.equal(server.posts.length, 1); assert.equal(server.views.length, 0); }));
  await test("wrong output node, previews, invalid filenames and invalid bytes fail closed", async () => {
    const outputs = [
      { "99": { images: [{ filename: "other.png", subfolder: "", type: "output" }] } },
      { "7": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] } },
      { "7": { images: [{ filename: "../outside.png", subfolder: "", type: "output" }] } },
      { "7": { images: [{ filename: "result.png", subfolder: "../outside", type: "output" }] } },
      { "7": { images: [{ filename: "%2foutside.png", subfolder: "", type: "output" }] } }
    ];
    for (const output of outputs) await fixture({ output }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_OUTPUT_INVALID")); assert.equal(server.views.length, 0); assert.equal(server.posts.length, 1); });
    await fixture({ imageBytes: Buffer.from("<html>not an image</html>") }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_OUTPUT_INVALID")); assert.equal(server.posts.length, 1); });
    const wrongSize = await sharp(fixtureImage).resize(96, 64).png().toBuffer(); await fixture({ imageBytes: wrongSize }, async (server) => { await assert.rejects(executor().run(input(server)), isCode("COMFYUI_OUTPUT_INVALID")); assert.equal(server.posts.length, 1); });
  });
  await test("recovery ignores unrelated history and refuses identity/config drift", () => fixture({}, async (server) => {
    const snapshot = saved(server); server.history.other = resultRecord({ ...snapshot, promptId: "other" }); const e = executor();
    assert.equal((await e.recover({ accepted: snapshot })).state, "unknown"); assert.equal(server.views.length, 0);
    await assert.rejects(e.recover({ accepted: snapshot, outputNodeId: "99" }), isCode("COMFYUI_TASK_OWNERSHIP_MISMATCH"));
    server.pending.push(tuple({ ...snapshot, clientId: "another-client" })); await assert.rejects(e.recover({ accepted: snapshot }), isCode("COMFYUI_TASK_OWNERSHIP_MISMATCH")); server.pending = [];
    server.history[snapshot.promptId] = resultRecord({ ...snapshot, clientId: "another-client" }); await assert.rejects(e.recover({ accepted: snapshot }), isCode("COMFYUI_TASK_OWNERSHIP_MISMATCH")); assert.equal(server.posts.length, 0); assert.equal(server.views.length, 0);
  }));
  await test("cancel verifies exact queued prompt/client and preserves other tasks", () => fixture({}, async (server) => {
    const snapshot = saved(server), other = saved(server, { promptId: "other-prompt", clientId: "other-client" }); server.pending.push(tuple(snapshot), tuple(other));
    const result = await executor().cancel({ accepted: snapshot, phase: "running" }); // Caller-supplied phase is never trusted.
    assert.equal(result.canceled, true); assert.deepEqual(server.deletes, [{ delete: [snapshot.promptId] }]); assert.deepEqual(server.pending.map((entry) => entry[1]), [other.promptId]); assert.ok(!server.gets.includes("/interrupt")); assert.equal(server.posts.length, 0);
  }));
  await test("running/unknown/wrong-owner cancellation never deletes or globally interrupts", () => fixture({}, async (server) => {
    const snapshot = saved(server), e = executor({ interruptTask: async () => { throw new Error("not a verified capability"); } });
    server.running.push(tuple(snapshot)); await assert.rejects(e.cancel({ accepted: snapshot, phase: "queued" }), isCode("COMFYUI_CANCEL_UNSUPPORTED")); server.running = [];
    await assert.rejects(e.cancel({ accepted: snapshot }), isCode("COMFYUI_CANCEL_NOT_QUEUED"));
    server.pending.push(tuple({ ...snapshot, clientId: "someone-else" })); await assert.rejects(e.cancel({ accepted: snapshot }), isCode("COMFYUI_TASK_OWNERSHIP_MISMATCH"));
    assert.equal(server.deletes.length, 0); assert.equal(server.posts.length, 0); assert.ok(!server.gets.includes("/interrupt"));
  }));
  await test("cancellation queue-to-running race and ignored delete are not reported canceled", async () => {
    for (const config of [{ cancelRace: true }, { ignoreDelete: true }]) await fixture(config, async (server) => { const snapshot = saved(server); server.pending.push(tuple(snapshot)); await assert.rejects(executor().cancel({ accepted: snapshot }), isCode("COMFYUI_CANCEL_NOT_CONFIRMED")); assert.equal(server.deletes.length, 1); });
  });
  const report = { ok: true, cases: cases.length, results: cases, loopbackPromptPosts: totalPosts, loopbackQueueDeletes: totalDeletes, webSocketConnections: wsConnections, realModelRequests: 0 };
  const directory = path.resolve(__dirname, "../.diagnostics/comfyui-executor"); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: ".diagnostics/comfyui-executor/report.json" })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { workflow, objectInfo, createMockServer: async (config, image) => { fixtureImage = image; return mockServer(config); } };
