"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { createAgentRuntime, normalizedTaskScope } = require("../agent-runtime.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");
const { responsesRequestFromChatRequest } = require("../desktop/agent-responses-adapter.cjs");
const { imageConfigSnapshot, settingsWithImageConfig } = require("../runtime/image-config-snapshot.mjs");
const { contentNamePatch } = require("../runtime/image-content-name.mjs");
const { imageInputManifest } = require("../runtime/image-input-manifest.cjs");
const runDir = path.resolve(__dirname, "../.diagnostics/agent-workflow", new Date().toISOString().replace(/[:.]/g, "-"));
const response = output => ({ chunks: [{ type: "response.completed", response: { status: "completed", output } }] });
const call = (name, args, id = name) => ({ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) });
const text = value => response([{ type: "message", role: "assistant", content: [{ type: "output_text", text: value }] }]);
async function main() {
  fs.mkdirSync(runDir, { recursive: true });
  const paths = ["unknown-a.png", "unknown-b.png", "result.png"].map(name => path.join(runDir, name));
  for (const [index, file] of paths.entries()) await sharp({ create: { width: 64, height: 64, channels: 3, background: ["#31a7d7", "#efb532", "#d83065"][index] } }).png().toFile(file);
  const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const materials = paths.slice(0, 2).map((file, index) => ({ assetId: `asset-${index}`, nodeId: index ? "B" : "A", displayCode: index ? "B1" : "A1", name: "未知内容", role: "source", path: file, assetIndex: 0, contentHash: hash(file), purpose: index ? "保持主体" : "颜色参考" }));
  const settings = { agentModel: "gpt-6.1-sol", contextStrategy: "codex", imageModel: "grok-imagine-image-2.0", imageModelPool: ["grok-imagine-image-2.0"], imageRatio: "1:1", imageResolution: "1K", imageQuality: "high", imageCount: 1,
    imageModelBindings: [{ model: "grok-imagine-image-2.0", protocol: "openai-images", gateway: "newapi", customApiKey: "never-in-snapshot" }] };
  const taskScope = normalizedTaskScope({ taskScope: { version: 2, origin: "node", sourceNodeIds: ["B", "A"], materials,
    imageConfig: imageConfigSnapshot(settings) } });
  assert.doesNotMatch(JSON.stringify(taskScope.imageConfig), /never-in-snapshot|customApiKey/);
  const nodes = materials.map(material => ({ id: material.nodeId, title: "图片成果", type: "image", assets: [{ ...material, index: 1 }], imageParams: { ratio: "9:16", quality: "low", model: "old-model" } }));
  const sends = [], prepared = [], traces = [], modelRequests = [];
  const service = createImageGenerationService({ newApiRelayJson: async (_settings, endpoint, body) => { sends.push({ endpoint, body }); return { data: [{ b64_json: fs.readFileSync(paths[2]).toString("base64") }] }; },
    newApiRelayMultipart: async (_settings, endpoint, form) => {
      const images = []; for (const [key, value] of form.entries()) if (key.startsWith("image")) images.push(createHash("sha256").update(Buffer.from(await value.arrayBuffer())).digest("hex"));
      sends.push({ endpoint, images, quality: form.get("quality"), prompt: form.get("prompt") });
      return { data: [{ b64_json: fs.readFileSync(paths[2]).toString("base64") }] };
    } });
  let round = 0;
  const runtime = createAgentRuntime({ projectRoot: runDir, configDir: path.join(runDir, "config"), resolveProjectRoot: () => runDir,
    serverGenerateImage: async payload => {
      const result = await service.generate(settings, { ...payload, onRequestPrepared: detail => prepared.push(detail) });
      return { ...result, assets: [{ path: paths[2], mimeType: "image/png", width: 64, height: 64 }] };
    }, serverChatCompletion: async request => {
      modelRequests.push(responsesRequestFromChatRequest(request));
      if (round++ === 0) return response(materials.map((material, index) => call("view_image", { path: material.path, detail: "original" }, `view-${index}`)));
      if (round === 2) return response([call("image_gen", { operation: "edit", parentId: "B", prompt: "保持第二张主体并参考第一张颜色", quality: "high", count: 1, referenceImages: [{ assetId: "asset-0", role: "style", purpose: "颜色参考" }] })]);
      if (round === 3) return response([call("view_image", { path: paths[2], detail: "original" }, "review")]);
      if (round === 4) return response([call("workflow", { operation: "update_node", visualName: { path: paths[2], displayName: "哆啦A梦与大雄", confidence: "high" } }, "name")]);
      return text("本地协议夹具完成。");
    } });
  try {
    const result = await runtime.chat({ projectId: "fixture", conversationId: "flow", runId: "workflow-flow", prompt: "处理选中图", nodes, selectedNodeId: "B", selectedNodeIds: ["B", "A"], taskScope,
      settings: { ...settings, imageRatio: "9:16", imageQuality: "low" }, progress: event => {
        if (event.phase === "protocol-trace") {
          assert.equal(event.internalOnly, true, "Protocol diagnostics must not become user timeline messages");
          traces.push(event.detail);
        }
      } });
    assert.equal(sends.length, 1); assert.deepEqual(sends[0].images, [hash(paths[1]), hash(paths[0])]);
    assert.equal(sends[0].quality, "medium"); assert.match(sends[0].prompt, /1\. source/); assert.match(sends[0].prompt, /2\. reference.*style.*颜色参考/);
    assert.equal(prepared[0].inputManifest.snapshotHash, taskScope.snapshotHash);
    assert.deepEqual(prepared[0].parameterDecisions, [{ parameter: "quality", requested: "high", effective: "medium", reason: "configured-capability" }]);
    const pixelCount = value => JSON.stringify(value).match(/"type":"input_image"/g)?.length || 0;
    assert.ok(pixelCount(modelRequests[1]) >= 2, "Both pixel payloads reach the same continuation after view_image");
    assert.ok(pixelCount(modelRequests[3]) >= 1, "Generated result pixels reach review continuation");
    assert.equal(result.actions.find(action => action.node?.assets?.length)?.node?.title, "哆啦A梦与大雄");
    const badManifest = imageInputManifest(materials[1], [materials[0]], taskScope.snapshotHash); badManifest.hash = "0".repeat(64);
    await assert.rejects(service.generate(settings, { prompt: "test", editImage: materials[1], referenceImages: [materials[0]], inputManifest: badManifest }), /冻结素材/);
    assert.equal(sends.length, 1, "Input mismatch never sends a paid request");
    const manual = { ...nodes[0], title: "用户的封面", contentName: { displayName: "图片成果", source: "fallback" } };
    assert.equal(contentNamePatch(manual, { displayName: "哆啦A梦", confidence: "high" }, paths[0]).title, "用户的封面");
    assert.equal(contentNamePatch({ ...manual, assets: [{ ...manual.assets[0], title: "用户的素材名" }] }, { displayName: "哆啦A梦", confidence: "high" }, paths[0]), undefined);
    assert.equal(contentNamePatch({ ...manual, assets: [{ ...manual.assets[0], title: "圆形 · 定稿", contentName: { displayName: "圆形", confidence: "high", source: "visual" } }] },
      { displayName: "红色圆形", confidence: "high" }, paths[0]), undefined, "A manually appended label is not an automatic numeric duplicate suffix");
    const named = contentNamePatch(nodes[0], { displayName: "哆啦A梦", confidence: "high" }, paths[0]);
    assert.equal(named.title, "哆啦A梦"); assert.equal(JSON.parse(JSON.stringify(named)).assets[0].title, "哆啦A梦");
    let batch = { title: "相册文件夹", contentName: { displayName: "相册文件夹", source: "fallback" }, assets: [
      { assetId: "b", path: "second.png", index: 1 }, { assetId: "a", path: "first.png", index: 2 }
    ] };
    const visual = { displayName: "哆啦A梦", confidence: "high" };
    batch = { ...batch, ...contentNamePatch(batch, visual, "second.png") };
    batch = { ...batch, ...contentNamePatch(batch, visual, "first.png") };
    const stableTitles = Object.fromEntries(batch.assets.map(asset => [asset.assetId, asset.title]));
    assert.equal(new Set(Object.values(stableTitles)).size, 2);
    batch.assets.reverse(); batch.assets.forEach((asset, index) => { asset.index = index + 1; });
    batch = JSON.parse(JSON.stringify(batch));
    batch = { ...batch, ...contentNamePatch(batch, visual, "second.png") };
    assert.deepEqual(Object.fromEntries(batch.assets.map(asset => [asset.assetId, asset.title])), stableTitles);
    assert.equal(batch.title, "哆啦A梦");

    // A successful tool read prepares pixels for the next model request. It
    // cannot authorize a name already emitted alongside that view_image call.
    const namingModelRequests = [], earlyNamingErrors = [];
    let namingRound = 0;
    const namingRuntime = createAgentRuntime({ projectRoot: runDir, configDir: path.join(runDir, "naming-config"), resolveProjectRoot: () => runDir,
      serverChatCompletion: async request => {
        namingModelRequests.push(responsesRequestFromChatRequest(request));
        if (namingRound++ === 0) return response([
          call("view_image", { path: paths[0], detail: "original" }, "prepare-pixels"),
          call("workflow", { operation: "update_node", visualName: { path: paths[0], displayName: "提前命名", confidence: "high" } }, "too-early-name")
        ]);
        if (namingRound === 2) return response([call("workflow", { operation: "update_node", visualName: { path: paths[0], displayName: "观察后短名", confidence: "high" } }, "observed-name")]);
        return text("本地命名时序夹具完成。");
      } });
    let namingResult;
    try {
      namingResult = await namingRuntime.chat({ projectId: "fixture", conversationId: "naming-sequence", runId: "naming-sequence", prompt: "观察后命名", settings,
        nodes: [nodes[0]], selectedNodeId: "A", selectedNodeIds: ["A"], progress: event => {
          if (event.tool === "workflow" && event.phase === "tool-error") earlyNamingErrors.push({ modelRequestCount: namingModelRequests.length, error: event.summary });
        } });
    } finally { namingRuntime.dispose(); }
    assert.equal(pixelCount(namingModelRequests[0]), 0);
    assert.ok(pixelCount(namingModelRequests[1]) >= 1, "The later naming decision actually receives the image pixels");
    assert.equal(earlyNamingErrors.length, 1, "Naming in the response that first asks to view pixels is rejected");
    assert.equal(earlyNamingErrors[0].modelRequestCount, 1);
    const namingUpdates = namingResult.actions.filter(action => action.type === "workflow.node.update");
    assert.equal(namingUpdates.length, 1, "Rejected early naming produces no canvas rename");
    assert.equal(namingUpdates[0].patch.title, "观察后短名", "Naming after the pixel-bearing continuation succeeds");

    // Freeze the original identity, then change only the local bytes. Comparing
    // two freshly recomputed manifests would otherwise bless the replacement.
    const changedPath = path.join(runDir, "changed-after-freeze.png");
    fs.copyFileSync(paths[0], changedPath);
    const frozenMaterial = { ...materials[0], assetId: "frozen-asset", nodeId: "F", path: changedPath, contentHash: hash(changedPath) };
    const changedScope = normalizedTaskScope({ taskScope: { version: 2, origin: "node", sourceNodeIds: ["F"], materials: [frozenMaterial], imageConfig: imageConfigSnapshot(settings) } });
    fs.copyFileSync(paths[1], changedPath);
    assert.notEqual(hash(changedPath), frozenMaterial.contentHash);
    let mutationDispatches = 0, mutationRound = 0;
    const mutationRuntime = createAgentRuntime({ projectRoot: runDir, configDir: path.join(runDir, "mutation-config"), resolveProjectRoot: () => runDir,
      serverGenerateImage: async () => { mutationDispatches++; throw new Error("冻结素材变更不应进入 serverGenerateImage。"); },
      serverChatCompletion: async () => mutationRound++ === 0
        ? response([call("image_gen", { operation: "edit", parentId: "F", prompt: "保持主体并调整背景", count: 1 }, "stale-input")])
        : text("本地冻结素材变更夹具完成。") });
    let mutationResult;
    try {
      mutationResult = await mutationRuntime.chat({ projectId: "fixture", conversationId: "mutation", runId: "mutation", prompt: "编辑冻结图片", settings,
        nodes: [{ ...nodes[0], id: "F", assets: [{ ...frozenMaterial, index: 1 }] }], selectedNodeId: "F", selectedNodeIds: ["F"], taskScope: changedScope });
    } finally { mutationRuntime.dispose(); }
    assert.equal(mutationDispatches, 0, "Changed frozen bytes are blocked before the image dispatch callback");
    assert.ok(mutationResult.toolResults.some(result => result.tool === "image_gen" && result.ok === false), "The model receives the stale-input failure");

    for (const gateway of ["newapi", "sub2api", "direct"]) {
      await service.generate({ ...settings, imageModelBindings: [{ model: settings.imageModel, protocol: "openai-images", gateway }] }, { prompt: "fixture", quality: "high", n: 1 });
      assert.equal(sends.at(-1).body.quality, "medium");
    }
    // A connection with an explicitly configured quality matrix remains independent.
    await service.generate({ ...settings, imageModelConfigs: [{ model: settings.imageModel, capabilities: { supportedQualities: ["auto", "high"] } }] }, { prompt: "fixture", quality: "high", n: 1 });
    assert.equal(sends.at(-1).body.quality, "high");

    // The Main bridge re-reads credentials at dispatch time, while the selected
    // protocol and capability policy must still come from the frozen request.
    const frozenConnectionSettings = { ...settings,
      imageModelConfigs: [{ model: settings.imageModel, protocol: "xai-images", gateway: "direct", capabilities: { supportedQualities: ["auto", "high"] } }],
      imageModelBindings: [{ model: settings.imageModel, protocol: "xai-images", gateway: "direct" }] };
    const frozenConnectionScope = normalizedTaskScope({ taskScope: { version: 2, origin: "canvas", sourceNodeIds: [], materials: [], imageConfig: imageConfigSnapshot(frozenConnectionSettings) } });
    const currentConnectionSettings = { ...settings, imageQuality: "medium",
      imageModelConfigs: [{ model: settings.imageModel, protocol: "openai-images", gateway: "newapi", apiKey: "live-secret-never-in-snapshot", capabilities: { supportedQualities: ["auto", "medium"] } }],
      imageModelBindings: [{ model: settings.imageModel, protocol: "openai-images", gateway: "newapi" }] };
    const frozenConnectionPrepared = [], frozenConnectionWire = [], dispatchedSnapshots = [];
    const frozenConnectionService = createImageGenerationService({ newApiRelayJson: async (_transportSettings, endpoint, body) => {
      frozenConnectionWire.push({ endpoint, quality: body.quality, aspectRatio: body.aspect_ratio });
      return { data: [{ b64_json: fs.readFileSync(paths[2]).toString("base64") }] };
    } });
    let frozenConnectionRound = 0;
    const frozenConnectionRuntime = createAgentRuntime({ projectRoot: runDir, configDir: path.join(runDir, "frozen-connection-config"), resolveProjectRoot: () => runDir,
      serverGenerateImage: async payload => {
        assert.ok(payload.imageConfig, "Runtime must carry the frozen policy across the actual generation bridge");
        dispatchedSnapshots.push(payload.imageConfig);
        assert.doesNotMatch(JSON.stringify(payload.imageConfig), /live-secret|apiKey|customApiKey/);
        const effectiveSettings = settingsWithImageConfig(currentConnectionSettings, payload.imageConfig);
        assert.equal(effectiveSettings.imageModelConfigs[0].apiKey, "live-secret-never-in-snapshot", "Only current credentials remain live");
        const result = await frozenConnectionService.generate(effectiveSettings, { ...payload, onRequestPrepared: detail => frozenConnectionPrepared.push(detail) });
        return { ...result, assets: [{ path: paths[2], mimeType: "image/png", width: 64, height: 64 }] };
      },
      serverChatCompletion: async () => frozenConnectionRound++ === 0
        ? response([call("image_gen", { operation: "generate", prompt: "一张纯色图形", quality: "high", count: 1,
          imageConfig: imageConfigSnapshot(currentConnectionSettings) }, "frozen-connection")])
        : text("本地冻结连接夹具完成。") });
    try {
      await frozenConnectionRuntime.chat({ projectId: "fixture", conversationId: "frozen-connection", runId: "frozen-connection", prompt: "生成图形", settings: currentConnectionSettings,
        nodes: [], taskScope: frozenConnectionScope });
    } finally { frozenConnectionRuntime.dispose(); }
    assert.equal(dispatchedSnapshots.length, 1);
    assert.deepEqual(dispatchedSnapshots[0], frozenConnectionScope.imageConfig, "Extra model arguments cannot replace the internal frozen image configuration");
    assert.equal(frozenConnectionPrepared.length, 1);
    assert.equal(frozenConnectionPrepared[0].protocol, "xai-images");
    assert.equal(frozenConnectionPrepared[0].gateway, "direct");
    assert.equal(frozenConnectionPrepared[0].quality, "high");
    assert.deepEqual(frozenConnectionPrepared[0].parameterDecisions, []);
    assert.equal(frozenConnectionWire.length, 1);
    assert.equal(frozenConnectionWire[0].quality, "high");
    assert.equal(frozenConnectionWire[0].aspectRatio, "1:1", "The native xAI adapter constructs the wire request");
    const mainRuntimeBridgeSource = fs.readFileSync(path.resolve(__dirname, "../electron-main.cjs"), "utf8")
      .split("function getAgentRuntime() {")[1]?.split("function emitAgentProgress(")[0] || "";
    assert.match(mainRuntimeBridgeSource, /serverGenerateImage:\s*async[\s\S]*?const settings = settingsWithImageConfig\(currentAgentSettings\(\), payload\.imageConfig\)/,
      "Main's actual Runtime callback applies the frozen policy to current credential-bearing settings");

    const plain = createAgentRuntime({ projectRoot: runDir, configDir: path.join(runDir, "plain-config"), serverChatCompletion: async () => text("你希望选第一项还是第二项？\n- 方案一\n- 方案二") });
    const noTool = await plain.chat({ projectId: "fixture", conversationId: "plain", settings, prompt: "讨论", nodes: [] }); plain.dispose();
    assert.equal(noTool.actions.some(action => action.type === "ui.ask_user.open"), false);
    const ask = await runtime.runTool("ask_user", { question: "选择", options: [{ id: "a", label: "A", recommended: true }, { id: "b", label: "B" }] }, { runId: "ask", taskScope });
    assert.equal(ask.actions[0].request.options.length, 2);
    const report = { ok: true, actualModelRecognition: false, realModelRequests: 0, pixelContinuationCounts: modelRequests.map(pixelCount),
      sameRoundNaming: { pixelContinuationCounts: namingModelRequests.map(pixelCount), earlyNamingErrors, acceptedTitle: namingUpdates[0].patch.title },
      changedFrozenInput: { frozenHash: frozenMaterial.contentHash, currentHash: hash(changedPath), serverGenerateCalls: mutationDispatches },
      frozenConnectionPolicy: { prepared: frozenConnectionPrepared, wire: frozenConnectionWire, mainBridgeValidation: "static source contract", currentCredentialsPreserved: true, extraToolConfigurationIgnored: true },
      prepared, traces, checks: ["structured ask and plain text distinction", "pixels in same continuation", "frozen config beats historical params", "ordered source/reference request bytes", "manifest mismatch blocks send", "changed frozen bytes block dispatch", "connection quality policy", "frozen protocol and capability policy reaches wire", "observed-image naming", "same-response naming rejected until pixel continuation", "manual title protection"] };
    fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, checks: report.checks, report: path.join(runDir, "report.json") }));
  } finally { runtime.dispose(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
