"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { createAgentRuntime, normalizedTaskScope, taskScopeSnapshotHash } = require("../agent-runtime.cjs");
const { createProjectCreationService, normalizeRequirements } = require("../desktop/project-creation-service.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");
const { createImageOperationJournal } = require("../desktop/image-operation-journal.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");
const { imageConfigSnapshot } = require("../runtime/image-config-snapshot.mjs");
const { verifyObservationEvidence } = require("../runtime/image-observation-evidence.cjs");
const { agentToolSchemas } = require("../runtime/tool-schemas.cjs");
const { creationRevisionJobs, runCreationRevision } = require("../runtime/creation-revision.cjs");
const { createSavedCreationActionChecker, creationCheckUnrecorded } = require("../runtime/creation-local-check.cjs");

const root = path.resolve(__dirname, "../.diagnostics/creation-runtime", new Date().toISOString().replace(/[:.]/g, "-"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const response = output => ({ chunks: [{ type: "response.completed", response: { status: "completed", output } }] });
const call = (name, args, id = name) => ({ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) });
const text = value => response([{ type: "message", role: "assistant", content: [{ type: "output_text", text: value }] }]);
const targetOf = asset => ({ assetId: asset.assetId, occurrenceId: asset.occurrenceId, contentHash: asset.contentHash });

async function main() {
  fs.mkdirSync(path.join(root, "output/imagegen"), { recursive: true });
  const assets = [];
  for (let index = 0; index < 7; index++) {
    const relativePath = `output/imagegen/fixture-${index + 1}.png`, file = path.join(root, relativePath);
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20 + index * 20, g: 90, b: 160 } } }).png().toFile(file);
    assets.push({ assetId: `asset-${index + 1}`, occurrenceId: `occ-${String(index + 1).padStart(16, "0")}`, contentHash: hash(fs.readFileSync(file)),
      path: file, relativePath, width: 64, height: 64, index: 1, status: "done" });
  }
  const nodes = assets.map((asset, index) => ({ id: `node-${index + 1}`, title: `作品 ${index + 1}`, type: "image", assets: [asset], imageState: "done" }));
  const project = { id: "creation-project", path: root }, conversationId = "creation-conversation", taskId = "creation-task";
  const projectFor = id => id === project.id ? project : null;
  const journal = createImageOperationJournal({ projectFor, extractImages: result => result.images || [],
    materialize: async (images, name) => images.map((image, index) => {
      const bytes = Buffer.from(image.value, "base64"), file = path.join(root, `output/imagegen/${name}-${index}.png`);
      fs.writeFileSync(file, bytes);
      return { path: file, relativePath: path.relative(root, file).replace(/\\/g, "/"), contentHash: hash(bytes), width: 64, height: 64, status: "done" };
    }) });
  let taskRef;
  const owner = createProjectCreationService({ projectFor, readSession: () => ({ nodes }),
    projectRelativePath: (directory, file) => path.relative(directory, file).replace(/\\/g, "/"), resolveProjectRelativePath: (directory, file) => path.resolve(directory, file),
    resolveSavedResult({ projectId, taskId: expectedTask, target }) {
      for (const summary of journal.list(projectId)) {
        const operation = journal.get(projectId, summary.key);
        if (operation.agentTaskId !== expectedTask) continue;
        const asset = operation.assets.find(asset => Object.keys(target).every(key => asset[key] === target[key]));
        if (asset) return { asset, node: { id: "", title: "已生成成果", type: "image", assets: [asset] } };
      }
      return null;
    },
    verifyObservationEvidence });
  owner.setTaskResolver(() => ({ requirementRef: taskRef }));
  const requirements = { goal: { text: "制作统一商品作品", source: "user" }, usage: { text: "商品展示", source: "user" },
    slots: [{ slotId: "hero", label: "商品主图", source: "user" }, { slotId: "second", label: "第二张", source: "user" }, { slotId: "fifth", label: "第五张", source: "user" }], preserve: [{ criterionId: "identity", text: "保持来源商品结构", source: "user", kind: "source_consistency", sourceTargets: [targetOf(assets[0])] }],
    adjustable: [], conditions: [{ criterionId: "visual", text: "构图清晰", source: "user", kind: "visual" }], fileRules: { formats: ["png"], width: 64, height: 64 } };
  taskRef = owner.updateRequirements({ projectId: project.id, conversationId, expectedRevision: 0, requirements }).requirementRef;
  const settings = { agentModel: "fixture-agent", contextStrategy: "codex", imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"], imageRatio: "1:1", imageResolution: "1K", imageQuality: "medium", imageCount: 1 };
  const material = (asset, index) => ({ ...asset, role: "source", bindingId: `binding-${index + 1}`, nodeId: nodes[index].id, assetIndex: 0 });
  const scope = ref => normalizedTaskScope({ taskScope: { version: 2, origin: "chat", sourceNodeIds: nodes.map(node => node.id), materials: assets.map(material), imageConfig: imageConfigSnapshot(settings), creation: ref } });
  const reviews = [], requests = [], advances = [];
  const service = { ...owner, recordReview(input) { reviews.push(input); return owner.recordReview(input); } };
  const findings = [{ criterionId: "identity", status: "pass", note: "来源形状保持。" }, { criterionId: "visual", status: "pass", note: "主体清晰。" }];
  const review = () => ({ operation: "record_review", expectedRequirementsRevision: taskRef.revision, target: targetOf(assets[1]), slotId: "hero", verdict: "pass", findings, summary: "符合当前条件。" });
  const refined = { ...requirements, usage: { text: "用于电商商品页面", source: "user" } };
  let round = 0;
  const runtime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-review"), creationService: service,
    onCreationRequirements: event => { advances.push(event); taskRef = event.requirementRef; },
    serverChatCompletion: async request => {
      requests.push(request); assert.equal(request.tool_choice, "auto");
      if (round++ === 0) return response([
        call("creation", { operation: "update_requirements", expectedRequirementsRevision: 1, requirements: refined }, "refine"),
        call("view_image", { path: assets[1].path, detail: "original" }, "read-result"), call("creation", { ...review(), expectedRequirementsRevision: 2 }, "too-early")]);
      if (round === 2) return response([call("view_image", { path: assets[0].path, detail: "original" }, "read-source"), call("creation", review(), "source-too-early")]);
      if (round === 3) return response([call("creation", review(), "review-consumed")]);
      return text("已记录本地验收。");
    } });
  let result;
  try { result = await runtime.chat({ projectId: project.id, conversationId, taskId, runId: "review-run", settings, prompt: "按商品页面用途整理要求并检查", nodes, taskScope: scope(taskRef) }); }
  finally { runtime.dispose(); }
  assert.equal(advances.length, 1); assert.equal(advances[0].taskScope.creation.revision, 2);
  assert.equal(advances[0].taskScope.snapshotHash, taskScopeSnapshotHash(advances[0].taskScope));
  assert.equal(result.effectiveTaskScope.creation.revision, 2, "Ask/final callers receive the effective frozen requirements ref");
  assert.equal(result.toolResults.filter(value => value.tool === "creation" && value.ok === false).length, 2, "Same response reads never authorize result/source review");
  assert.equal(reviews.length, 1, "Only the later pixel-bearing successful model rounds reach Main review");
  assert.ok(requests[0].tools.some(tool => tool.function?.name === "creation"));
  assert.equal(requests[0].tools.filter(tool => tool.function?.name === "image_gen").length, 1);
  const receipt = owner.getAcceptance({ projectId: project.id, conversationId });
  assert.equal(receipt.results[0].visualReview.verdict, "pass");
  const genuine = reviews[0];
  assert.throws(() => owner.recordReview({ ...genuine, observationEvidence: JSON.parse(JSON.stringify(genuine.observationEvidence)) }), /尚未消费/, "Serialized CLI proof is rejected by Main");
  assert.throws(() => owner.recordReview({ ...genuine, runId: "other-run" }), /尚未消费/, "A genuine proof cannot move across runs");
  assert.throws(() => owner.recordReview({ ...genuine, target: targetOf(assets[2]) }), /尚未消费/, "A genuine proof cannot move to another asset");
  owner.updateRequirements({ projectId: project.id, conversationId, expectedRevision: 2, requirements: { ...refined, usage: { text: "新版商品页", source: "user" } } });
  assert.throws(() => owner.recordReview(genuine), /版本已变化/, "A later requirement revision invalidates existing observations");
  taskRef = owner.getRequirements({ projectId: project.id, conversationId }).requirementRef;
  const originalBytes = fs.readFileSync(assets[1].path);
  let changedRound = 0;
  const mutation = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-mutation"), creationService: service,
    serverChatCompletion: async () => {
      if (changedRound++ === 0) return response([call("view_image", { path: assets[1].path, detail: "original" })]);
      if (changedRound === 2) { fs.writeFileSync(assets[1].path, fs.readFileSync(assets[2].path)); return response([call("creation", { ...review(), findings: [findings[1]] })]); }
      return text("观察后字节变化已拒绝。");
    } });
  try {
    const mutated = await mutation.chat({ projectId: project.id, conversationId, taskId, runId: "mutation-run", settings, prompt: "复核构图", nodes, taskScope: scope(taskRef) });
    assert.ok(mutated.toolResults.some(value => value.tool === "creation" && value.ok === false && /字节已经改变/.test(value.error)));
  } finally { mutation.dispose(); fs.writeFileSync(assets[1].path, originalBytes); }

  const beforeIncompleteReviews = reviews.length;
  let incompleteRound = 0;
  const incomplete = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-incomplete"), creationService: service,
    serverChatCompletion: async () => {
      if (incompleteRound++ === 0) return response([call("view_image", { path: assets[1].path, detail: "original" })]);
      if (incompleteRound === 2) return { chunks: [{ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [call("creation", { ...review(), findings: [findings[1]] })] } }] };
      return text("未完成的模型回合不能提交验收。");
    } });
  try {
    const incompleteResult = await incomplete.chat({ projectId: project.id, conversationId, taskId, runId: "incomplete-run", settings, prompt: "检查成果", nodes, taskScope: scope(taskRef) });
    assert.ok(incompleteResult.toolResults.some(value => value.tool === "creation" && value.ok === false));
    assert.equal(reviews.length, beforeIncompleteReviews, "An incomplete pixel-bearing model response never reaches Main review");
  } finally { incomplete.dispose(); }
  let askRound = 0;
  const beforeAskRevision = taskRef.revision;
  const askRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-ask"), creationService: owner,
    onCreationRequirements: event => { taskRef = event.requirementRef; },
    serverChatCompletion: async () => askRound++ === 0 ? response([
      call("creation", { operation: "update_requirements", expectedRequirementsRevision: beforeAskRevision, requirements: { ...refined, usage: { text: "社交展示页", source: "user" } } }),
      call("ask_user", { question: "选择版式", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] })
    ]) : text("等待版式选择。") });
  let pendingScope;
  try {
    const waiting = await askRuntime.chat({ projectId: project.id, conversationId, taskId, runId: "requirements-ask-run", settings, prompt: "整理新用途后询问版式", nodes, taskScope: scope(taskRef) });
    assert.equal(waiting.effectiveTaskScope.creation.revision, beforeAskRevision + 1, "AskUser hands the updated requirement ref back to the original pending execution owner");
    assert.ok(waiting.actions.some(action => action.type === "ui.ask_user.open"));
    pendingScope = JSON.parse(JSON.stringify(waiting.effectiveTaskScope));
  } finally { askRuntime.dispose(); }
  let resumedRound = 0;
  const resumed = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-ask"), creationService: owner,
    serverChatCompletion: async () => resumedRound++ === 0 ? response([call("creation", { operation: "get_requirements" })]) : text("按已保存版本继续。") });
  try {
    const continued = await resumed.chat({ projectId: project.id, conversationId, taskId, runId: "requirements-resumed-run", settings, prompt: "选择A，继续", nodes, taskScope: pendingScope });
    assert.deepEqual(continued.effectiveTaskScope.creation, pendingScope.creation, "A fresh Runtime restores the exact persisted AskUser contract");
    assert.equal(continued.effectiveTaskScope.snapshotHash, pendingScope.snapshotHash);
    assert.ok(continued.toolResults.every(value => value.ok !== false));
  } finally { resumed.dispose(); }

  const revisionArgs = { operation: "revise_results", expectedRequirementsRevision: taskRef.revision, preserve: ["保持商品结构"], changes: [], targets: [
    { ...targetOf(assets[1]), changes: ["背景改为纯白色"] }, { ...targetOf(assets[4]), changes: ["减少文字密度"] }
  ] };
  let deferredRounds = 0, forbiddenImageCalls = 0;
  const beforeDeferredStore = fs.readFileSync(path.join(root, ".naimage/creation.json"), "utf8");
  const deferredRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-deferred"), creationService: owner,
    serverGenerateImage: async () => { forbiddenImageCalls++; throw Error("Deferred revisions must not dispatch in the original run"); },
    serverChatCompletion: async () => {
      deferredRounds++;
      if (deferredRounds > 1) return text("定向修改未受理。");
      return response([call("creation", revisionArgs, "defer-revision"), call("image_gen", { operation: "edit", prompt: "不得在旧run执行", count: 2 }, "forbidden-original-run-image")]);
    } });
  try {
    const deferred = await deferredRuntime.chat({ projectId: project.id, conversationId, taskId, runId: "deferred-revision-run", settings, prompt: "只修第2张背景和第5张文字", nodes, taskScope: scope(taskRef) });
    assert.equal(deferredRounds, 1, `Structured revision handoff ends the original run without a planning round: ${JSON.stringify(deferred.toolResults)}`);
    assert.equal(forbiddenImageCalls, 0);
    assert.deepEqual(deferred.deferredCreationRevision, { input: { expectedProjectId: project.id, conversationId, submissionId: `${taskId}-revision`,
      requirementId: taskRef.requirementId, expectedRevision: taskRef.revision, targets: revisionArgs.targets, preserve: revisionArgs.preserve, changes: [] }, parentTaskId: taskId });
    assert.equal(fs.readFileSync(path.join(root, ".naimage/creation.json"), "utf8"), beforeDeferredStore, "Handoff never increments requirements before original actions are saved");
    assert.deepEqual(deferred.effectiveTaskScope.creation, taskRef, "The original task remains bound to its original requirements ref");
  } finally { deferredRuntime.dispose(); }
  let invalidRound = 0;
  const invalidDeferred = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-invalid-deferred"), creationService: owner,
    serverChatCompletion: async () => invalidRound++ === 0 ? response([call("creation", { ...revisionArgs, targets: [{ ...revisionArgs.targets[0], contentHash: "0".repeat(64) }] })]) : text("已拒绝不在冻结成果中的目标。") });
  try {
    const invalid = await invalidDeferred.chat({ projectId: project.id, conversationId, taskId, runId: "invalid-deferred-run", settings, prompt: "修指定成果", nodes, taskScope: scope(taskRef) });
    assert.equal(invalid.deferredCreationRevision, undefined);
    assert.ok(invalid.toolResults.some(value => value.tool === "creation" && value.ok === false));
  } finally { invalidDeferred.dispose(); }
  let lockedRound = 0, lockedOwnerWrites = 0, mutableChecks = 0;
  const lockedStore = fs.readFileSync(path.join(root, ".naimage/creation.json"), "utf8");
  const lockedRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-requirements-locked"),
    creationService: { ...owner, updateRequirements(input) { lockedOwnerWrites++; return owner.updateRequirements(input); } },
    beforeCreationRequirements: input => {
      mutableChecks++; assert.equal(input.taskId, taskId); assert.deepEqual(input.previousRef, taskRef);
      throw Object.assign(Error("任务已开始图片派发，不能改变该次执行的创作要求。"), { code: "TASK_CREATION_LOCKED" });
    },
    serverChatCompletion: async () => lockedRound++ === 0 ? response([call("creation", { operation: "update_requirements", expectedRequirementsRevision: taskRef.revision,
      requirements: { ...refined, usage: { text: "不可写入的迟到变更", source: "user" } } })]) : text("原任务要求保持冻结。") });
  try {
    const locked = await lockedRuntime.chat({ projectId: project.id, conversationId, taskId, runId: "requirements-locked-run", settings, prompt: "尝试迟到更新", nodes, taskScope: scope(taskRef) });
    assert.equal(mutableChecks, 1); assert.equal(lockedOwnerWrites, 0, "Main mutability preflight executes before the requirements owner can increment its version");
    assert.equal(fs.readFileSync(path.join(root, ".naimage/creation.json"), "utf8"), lockedStore);
    assert.deepEqual(locked.effectiveTaskScope.creation, taskRef);
    assert.ok(locked.toolResults.some(value => value.tool === "creation" && value.ok === false));
  } finally { lockedRuntime.dispose(); }

  const posts = [], server = http.createServer(async (request, responseStream) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const form = await new Request(`http://localhost${request.url}`, { method: "POST", headers: { "content-type": request.headers["content-type"] }, body: Buffer.concat(chunks) }).formData();
      const images = []; for (const [name, value] of form) if (/^image/.test(name) && typeof value.arrayBuffer === "function") images.push(hash(Buffer.from(await value.arrayBuffer())));
      const uploadedMask = form.get("mask");
      posts.push({ endpoint: request.url, prompt: form.get("prompt"), n: form.get("n"), images,
        ...(uploadedMask && typeof uploadedMask.arrayBuffer === "function" ? { maskHash: hash(Buffer.from(await uploadedMask.arrayBuffer())) } : {}) });
      const fixtureOutput = fs.readFileSync(assets[(posts.length - 1) % assets.length].path);
      responseStream.setHeader("Content-Type", "application/json"); responseStream.end(JSON.stringify({ data: [{ b64_json: fixtureOutput.toString("base64") }] }));
    } catch (error) { responseStream.statusCode = 500; responseStream.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const imageService = createImageGenerationService({ newApiRelayJson: async () => { throw new Error("Revision must use the source-image edit endpoint"); }, newApiRelayMultipart: async (_settings, route, form) => {
    const response = await fetch(`${endpoint}${route}`, { method: "POST", body: form });
    assert.equal(response.status, 200); return response.json();
  } });
  const plan = { revisionId: "revision-fixture", baselineReviewIds: [receipt.results[0].visualReview.reviewId], preserve: ["保持商品结构和统一视觉"], changes: [], targets: [
    { ...targetOf(assets[1]), nodeId: nodes[1].id, slotId: "second", changes: ["背景改为纯白色"] },
    { ...targetOf(assets[4]), nodeId: nodes[4].id, slotId: "fifth", changes: ["减少文字密度"] }
  ] };
  const revisionScope = scope({ ...taskRef, revisionPlan: plan });
  const frozenHashes = assets.map(asset => hash(fs.readFileSync(asset.path)));
  let outputCount = 0;
  async function executeRevision(name, { saveFails = false, modelArgs = {}, creationService = owner, taskScope = revisionScope, repeatImage = false, localCheckWriteFails = false } = {}) {
    let modelRound = 0;
    const progress = [], effectiveService = localCheckWriteFails ? { ...creationService, async checkResults(input) {
      const rename = fs.renameSync, destination = path.join(root, ".naimage/creation.json");
      fs.renameSync = (from, to) => { if (to === destination) throw Object.assign(Error("acceptance write fixture"), { code: "EACCES" }); return rename(from, to); };
      try { return await creationService.checkResults(input); } finally { fs.renameSync = rename; }
    } } : creationService;
    const revised = createAgentRuntime({ projectRoot: root, configDir: path.join(root, `config-${name}`), creationService: effectiveService,
      serverGenerateImage: async payload => {
        let imagePayload = payload;
        if (payload.maskDataUrl) {
          const dispatchMask = path.join(root, ".naimage", "creation-masks", `dispatch-${name}.png`);
          fs.writeFileSync(dispatchMask, Buffer.from(payload.maskDataUrl.split(",")[1], "base64"));
          imagePayload = { ...payload, maskDataUrl: undefined, maskImage: { path: dispatchMask, mimeType: "image/png", name: "mask.png" } };
        }
        const generated = await imageService.generate(settings, imagePayload);
        if (saveFails) throw Object.assign(new Error("本地保存故障夹具"), { generationCompleted: true, unsafeToRetry: true, category: "image_result_processing" });
        const operation = journal.start({ projectId: project.id, agentTaskId: taskId, runId: name, operationId: `${name}-${++outputCount}`, model: settings.imageModel });
        journal.received(operation, generated);
        return { ok: true, model: settings.imageModel, assets: await journal.deliver(operation, generated) };
      }, serverChatCompletion: async request => {
        assert.equal(request.tool_choice, "auto");
        if (modelRound++ === 0) return response([call("image_gen", { operation: "edit", prompt: "仅修订指定图片", count: taskScope.creation.revisionPlan.targets.length, ...modelArgs }, "revision-generation")]);
        if (localCheckWriteFails && modelRound === 2) assert.match(JSON.stringify(request.messages), /Do not repeat image_gen/, "The actual follow-up model context receives no-regenerate guidance after acceptance persistence fails");
        if (modelRound === 2 && (saveFails || repeatImage)) return response([call("image_gen", { operation: "edit", prompt: "尝试重复", count: taskScope.creation.revisionPlan.targets.length }, "must-not-regenerate")]);
        return text(saveFails ? "保存失败保留原任务。" : "完成指定两张修订。");
      } });
    try { return { ...await revised.chat({ projectId: project.id, conversationId, taskId, runId: name, settings, prompt: "只修指定成果", nodes, taskScope, progress: event => progress.push(event) }), testProgress: progress }; }
    finally { revised.dispose(); }
  }
  let batchEvidence, maskEvidence, localCheckEvidence, capacityEvidence;
  try {
    const revisionResult = await executeRevision("revision-success");
    assert.equal(posts.length, 2); assert.deepEqual(posts.map(post => post.images), [[assets[1].contentHash], [assets[4].contentHash]], "Each edit uploads exactly its specified source");
    assert.ok(posts.every(post => post.n === "1"));
    assert.ok(posts.every(post => /保持来源商品结构/.test(post.prompt) && /构图清晰/.test(post.prompt)), "Each actual image POST retains the frozen original subject/source constraint and acceptance condition");
    assert.match(posts[0].prompt, /背景改为纯白色/); assert.doesNotMatch(posts[0].prompt, /减少文字密度/);
    assert.match(posts[1].prompt, /减少文字密度/); assert.doesNotMatch(posts[1].prompt, /背景改为纯白色/);
    const frozenRequirements = owner.requirementsByRef({ projectId: project.id, requirementRef: taskRef });
    const scopedJobs = creationRevisionJobs({ operation: "edit", count: 2, prompt: "模型遗漏或改写原要求" }, { taskScope: revisionScope, nodes }, {
      ...frozenRequirements,
      preserve: [...frozenRequirements.preserve, { text: "与参考图保持相同商品外观和品牌文字", slotIds: ["second"] }, { text: "保留第五张主体边缘", slotIds: ["fifth"] }],
      conditions: [...frozenRequirements.conditions, { text: "第二张保留商品比例", slotIds: ["second"] }, { text: "第五张文字可读", slotIds: ["fifth"] }, { text: "其他槽位专用红色边框", slotIds: ["other"] }]
    });
    assert.match(scopedJobs[0].args.prompt, /与参考图保持相同商品外观和品牌文字/);
    assert.match(scopedJobs[0].args.prompt, /第二张保留商品比例/);
    assert.doesNotMatch(scopedJobs[0].args.prompt, /保留第五张主体边缘|第五张文字可读|其他槽位专用红色边框|模型遗漏或改写原要求/);
    assert.match(scopedJobs[1].args.prompt, /保留第五张主体边缘/);
    assert.match(scopedJobs[1].args.prompt, /第五张文字可读/);
    assert.doesNotMatch(scopedJobs[1].args.prompt, /与参考图保持相同商品外观和品牌文字|第二张保留商品比例|其他槽位专用红色边框|模型遗漏或改写原要求/);
    for (const { args } of scopedJobs) {
      assert.equal(args.count, 1);
      for (const key of ["model", "ratio", "resolution", "quality", "outputFormat"]) assert.equal(args[key], revisionScope.imageConfig[key], `Revision preserves the frozen ${key}`);
    }
    assert.equal(revisionResult.actions.filter(action => action.node?.assets?.length).length, 2);
    const provenance = revisionResult.actions.filter(action => action.node?.assets?.length).map(action => action.node.taskProvenance);
    assert.deepEqual(provenance.map(value => value.sourceAssetId), [assets[1].assetId, assets[4].assetId]);
    assert.deepEqual(provenance.map(value => value.creationSlotId), ["second", "fifth"]);
    assert.ok(provenance.every(value => value.creationRevisionId === plan.revisionId && value.creation.revision === taskRef.revision));
    const revisionAssets = revisionResult.actions.flatMap(action => action.node?.assets || []);
    const autoRevision = owner.getAcceptance({ projectId: project.id, conversationId, taskId }).results.filter(record => revisionAssets.some(asset => asset.assetId === record.target.assetId));
    assert.equal(autoRevision.length, 2); assert.ok(autoRevision.every(record => record.fileCheck?.status === "passed" && !record.visualReview && record.requirementRef.revision === taskRef.revision));
    assert.deepEqual(assets.map(asset => hash(fs.readFileSync(asset.path))), frozenHashes, "The seven originals remain byte-identical");
    const beforeInvalid = posts.length;
    await executeRevision("revision-wrong-count", { modelArgs: { count: 7 } });
    await executeRevision("revision-wrong-source", { modelArgs: { parentId: nodes[0].id } });
    assert.equal(posts.length, beforeInvalid, "Model count/source overrides fail before HTTP dispatch");
    const drifted = await executeRevision("revision-requirements-drift", { creationService: { ...owner, getRequirements(input) {
      const current = owner.getRequirements(input);
      return { ...current, requirements: { ...current.requirements, fingerprint: "changed-frozen-requirements" } };
    } } });
    assert.equal(posts.length, beforeInvalid, "A changed frozen requirements fingerprint causes zero image POSTs");
    assert.ok(drifted.toolResults.some(value => value.tool === "image_gen" && value.ok === false && /完整创作要求与冻结版本不一致/.test(value.error)));
    const failed = await executeRevision("revision-save-failed", { saveFails: true });
    assert.equal(posts.length, beforeInvalid + 1, "Save failure stops remaining targets and all model regenerate attempts");
    assert.ok(failed.toolResults.some(value => value.tool === "image_gen" && value.ok === false));

    const maskDirectory = path.join(root, ".naimage", "creation-masks"); fs.mkdirSync(maskDirectory, { recursive: true });
    const rgbaMask = Buffer.alloc(64 * 64 * 4, 255);
    for (let y = 20; y < 28; y++) for (let x = 15; x < 23; x++) rgbaMask[(y * 64 + x) * 4 + 3] = 0;
    const maskBytes = await sharp(rgbaMask, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    const maskFile = path.join(maskDirectory, "mask-fixture.png"); fs.writeFileSync(maskFile, maskBytes);
    const maskIdentity = { assetId: "mask-fixture", occurrenceId: "occ-1234567812345678", contentHash: hash(maskBytes) };
    const maskScope = normalizedTaskScope({ taskScope: { ...revisionScope,
      creation: { ...taskRef, revisionPlan: { ...plan, targets: [{ ...plan.targets[0], mask: maskIdentity }] } },
      maskAssets: [{ ...maskIdentity, target: targetOf(assets[1]), path: maskFile, relativePath: ".naimage/creation-masks/mask-fixture.png", width: 64, height: 64, mimeType: "image/png", name: "区域修改蒙版", apiKey: "must-not-survive" }]
    } });
    assert.deepEqual(maskScope.creation.revisionPlan.targets[0].mask, maskIdentity);
    assert.equal(maskScope.maskAssets.length, 1); assert.equal(maskScope.maskAssets[0].apiKey, undefined);
    const beforeMask = posts.length;
    const masked = await executeRevision("revision-mask-success", { taskScope: maskScope, repeatImage: true });
    assert.equal(posts.length, beforeMask + 1, "A masked revision and its duplicate model call produce one actual image POST");
    assert.equal(posts[beforeMask].maskHash, maskIdentity.contentHash, "The HTTP edit uploads the same verified PNG bytes");
    assert.deepEqual(posts[beforeMask].images, [assets[1].contentHash]); assert.equal(posts[beforeMask].n, "1");
    assert.match(posts[beforeMask].prompt, /只修改用户蒙版的透明区域/);
    assert.equal(masked.actions.filter(action => action.node?.assets?.length).length, 1);
    const maskedAsset = masked.actions.flatMap(action => action.node?.assets || [])[0];
    const autoMask = owner.getAcceptance({ projectId: project.id, conversationId, taskId }).results.find(record => record.target.assetId === maskedAsset.assetId);
    assert.equal(autoMask.fileCheck.status, "passed"); assert.equal(autoMask.visualReview, undefined);
    assert.deepEqual(masked.effectiveTaskScope.maskAssets, maskScope.maskAssets);
    const { DatabaseSync } = require("node:sqlite"), maskMemory = new DatabaseSync(path.join(root, "config-revision-mask-success", "memory", "naimage-memory.db"), { readOnly: true });
    try { assert.ok(maskMemory.prepare("SELECT call_json FROM tool_memory").all().every(row => !row.call_json.includes("data:image/")), "The internal mask base64 is never persisted in tool call memory"); }
    finally { maskMemory.close(); }
    const beforeLocalWriteFailure = posts.length, oldAcceptance = fs.readFileSync(path.join(root, ".naimage/creation.json"), "utf8");
    const localWriteFailed = await executeRevision("revision-local-check-write-failure", { taskScope: maskScope, localCheckWriteFails: true, repeatImage: true });
    assert.equal(posts.length, beforeLocalWriteFailure + 1, "Acceptance write failure never retries the already-saved masked image");
    const preservedAssets = localWriteFailed.actions.flatMap(action => action.node?.assets || []);
    assert.equal(preservedAssets.length, 1); assert.equal(hash(fs.readFileSync(preservedAssets[0].path)), preservedAssets[0].contentHash);
    assert.equal(fs.readFileSync(path.join(root, ".naimage/creation.json"), "utf8"), oldAcceptance, "Failed acceptance write preserves the last authoritative document");
    assert.ok(localWriteFailed.testProgress.some(event => event.phase === "creation-check" && /本地验收记录失败/.test(event.summary)));
    assert.ok(localWriteFailed.toolResults.some(value => value.tool === "image_gen" && value.ok !== false), "A local acceptance failure must not turn successful image delivery into a failed image tool");
    localCheckEvidence = { revisionChecked: autoRevision.length, maskChecked: 1, writeFailureImagePosts: posts.length - beforeLocalWriteFailure, writeFailurePreservedAssets: preservedAssets.length };
    await executeRevision("revision-mask-model-override", { taskScope: maskScope, modelArgs: { maskDataUrl: `data:image/png;base64,${maskBytes.toString("base64")}` } });
    assert.equal(posts.length, beforeLocalWriteFailure + 1, "A model-supplied mask cannot replace the registered user mask");
    let invalidMaskDispatches = 0;
    const maskContext = taskScope => ({ projectId: project.id, conversationId, taskId, runId: "mask-preflight", taskScope, nodes, creationRevisionExecution: { accepted: false } });
    const maskDependencies = { creationService: owner, projectRoot: root, normalizeImageArgs: value => value,
      runImageTool: async () => { invalidMaskDispatches++; return { envelope: { ok: true }, actions: [] }; } };
    const rejectMask = async (taskScope, reason) => {
      await assert.rejects(runCreationRevision({ operation: "edit", count: taskScope.creation.revisionPlan.targets.length }, maskContext(taskScope), maskDependencies), /蒙版|精确区域修改/, reason);
      assert.equal(invalidMaskDispatches, 0, `${reason}: zero image dispatches`);
    };
    const changedMask = edit => { const value = structuredClone(maskScope); edit(value); return normalizedTaskScope({ taskScope: value }); };
    await rejectMask(changedMask(value => { value.maskAssets[0].target = targetOf(assets[4]); }), "A mask bound to another occurrence is rejected");
    await rejectMask(changedMask(value => { value.maskAssets[0].width = 32; }), "Frozen mask dimensions must match actual mask and source pixels");
    await rejectMask(changedMask(value => { value.maskAssets[0].path = path.join(maskDirectory, "missing.png"); value.maskAssets[0].relativePath = ".naimage/creation-masks/missing.png"; }), "Missing mask bytes are rejected");
    await rejectMask(changedMask(value => { value.maskAssets.push(structuredClone(value.maskAssets[0])); }), "Duplicate frozen mask bindings are rejected");
    await rejectMask(changedMask(value => { value.creation.revisionPlan.targets.push(plan.targets[1]); }), "A mask cannot apply to a second selected target");
    fs.writeFileSync(maskFile, Buffer.from("changed registered mask"));
    try { await rejectMask(maskScope, "A registered mask changed on disk is rejected"); } finally { fs.writeFileSync(maskFile, maskBytes); }
    const truncatedMask = maskBytes.subarray(0, 33); fs.writeFileSync(maskFile, truncatedMask);
    try { await rejectMask(changedMask(value => { const contentHash = hash(truncatedMask); value.maskAssets[0].contentHash = contentHash; value.creation.revisionPlan.targets[0].mask.contentHash = contentHash; }), "A valid PNG header cannot replace complete PNG decoding"); }
    finally { fs.writeFileSync(maskFile, maskBytes); }
    const opaqueMask = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ffffff" } }).png().toBuffer(); fs.writeFileSync(maskFile, opaqueMask);
    try { await rejectMask(changedMask(value => { const contentHash = hash(opaqueMask); value.maskAssets[0].contentHash = contentHash; value.creation.revisionPlan.targets[0].mask.contentHash = contentHash; }), "A mask without a user-painted transparent region is rejected"); }
    finally { fs.writeFileSync(maskFile, maskBytes); }
    const maskSource = fs.readFileSync(assets[1].path); fs.writeFileSync(assets[1].path, fs.readFileSync(assets[4].path));
    try { await rejectMask(maskScope, "The original source bytes must still match the frozen target hash"); } finally { fs.writeFileSync(assets[1].path, maskSource); }
    let releaseMaskPreflight;
    const preflightResult = new Promise(resolve => { releaseMaskPreflight = resolve; }), concurrentMaskContext = maskContext(maskScope);
    const concurrentMaskDependencies = { ...maskDependencies, creationService: { getRequirements: () => preflightResult } };
    const firstMask = runCreationRevision({ operation: "edit", count: 1 }, concurrentMaskContext, concurrentMaskDependencies);
    await assert.rejects(runCreationRevision({ operation: "edit", count: 1 }, concurrentMaskContext, concurrentMaskDependencies), /已派发/);
    releaseMaskPreflight(owner.getRequirements({ projectId: project.id, conversationId, taskId })); await firstMask;
    assert.equal(invalidMaskDispatches, 1, "Concurrent calls share one preflight/dispatch claim");
    await assert.rejects(runCreationRevision({ operation: "edit", count: 1 }, concurrentMaskContext, concurrentMaskDependencies), /已派发/);
    assert.equal(invalidMaskDispatches, 1, "A completed masked revision cannot dispatch again");
    assert.deepEqual(assets.map(asset => hash(fs.readFileSync(asset.path))), frozenHashes);
    maskEvidence = { localImagePosts: posts.length - beforeMask, successImagePosts: 1, acceptanceWriteFailureImagePosts: 1, uploadedMaskHash: posts[beforeMask].maskHash, invalidPreflightDispatches: 0, concurrentDispatches: invalidMaskDispatches, base64Persisted: false };

    let savedAsset, journalRound = 0, journalDispatches = 0;
    const beforeJournalPosts = posts.length;
    const journalRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-journal-review"), creationService: service,
      serverGenerateImage: async payload => {
        journalDispatches++;
        const operation = journal.start({ projectId: project.id, agentTaskId: taskId, runId: "journal-review-run", operationId: "journal-generation", model: settings.imageModel });
        const generated = await imageService.generate(settings, payload);
        journal.received(operation, generated);
        const saved = await journal.deliver(operation, generated);
        savedAsset = saved[0];
        return { ok: true, model: settings.imageModel, assets: saved };
      }, serverChatCompletion: async request => {
        if (journalRound++ === 0) return response([call("image_gen", { operation: "edit", prompt: "制作商品展示图", count: 1, parentId: nodes[0].id, sourceAssetId: assets[0].assetId, creationSlotId: "hero" }, "journal-generation")]);
        if (journalRound === 2) {
          const automatic = owner.getAcceptance({ projectId: project.id, conversationId, taskId }).results.find(value => value.target.assetId === savedAsset.assetId);
          assert.equal(automatic.fileCheck.status, "passed", "The initial image is checked locally before the next model round");
          assert.equal(automatic.visualReview, undefined, "Local checking never grants AI acceptance");
          return response([call("view_image", { path: savedAsset.path, detail: "original" }, "read-journal-result"), call("view_image", { path: assets[0].path, detail: "original" }, "read-journal-source")]);
        }
        assert.ok(request.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "input_image")), "Successful review round actually contains generated and source pixels");
        return response([call("creation", { ...review(), target: targetOf(savedAsset) }, "review-journal-result"),
          call("creation", { operation: "revise_results", expectedRequirementsRevision: taskRef.revision, targets: [{ ...targetOf(savedAsset), changes: ["背景改为纯白色"] }], preserve: ["保持商品结构"], changes: [] }, "defer-new-result-revision")]);
      } });
    try {
      const journalResult = await journalRuntime.chat({ projectId: project.id, conversationId, taskId, runId: "journal-review-run", settings, prompt: "制作、检查商品图后仅修改背景", nodes, taskScope: scope(taskRef) });
      assert.equal(journalDispatches, 1);
      assert.equal(posts.length, beforeJournalPosts + 1, "Review and deferred revision never regenerate the already-saved image");
      assert.ok(!nodes.some(node => node.assets.some(asset => asset.assetId === savedAsset.assetId)), "Generated asset remains absent from the persisted Renderer session fixture");
      assert.ok(journalResult.toolResults.every(value => value.ok !== false), JSON.stringify(journalResult.toolResults));
      const observed = owner.getAcceptance({ projectId: project.id, conversationId, taskId }).results.find(value => value.target.assetId === savedAsset.assetId);
      assert.equal(observed.visualReview.verdict, "pass", "Main resolves exact durable journal asset before Renderer actions are saved");
      assert.equal(observed.fileSaved, true); assert.equal(observed.saved, false); assert.equal(observed.inProject, false);
      assert.deepEqual(journalResult.deferredCreationRevision.input.targets, [{ ...targetOf(savedAsset), changes: ["背景改为纯白色"] }], "A generated action can hand off an exact deferred revision target before session materialization");
      assert.equal(hash(fs.readFileSync(savedAsset.path)), savedAsset.contentHash);
      assert.equal(journal.list(project.id)[0].state, "saved");
      let repeatedChecks = 0;
      const checkAgain = createSavedCreationActionChecker({ ...owner, checkResults(input) { repeatedChecks++; return owner.checkResults(input); } });
      const localScope = scope(taskRef), delivery = { envelope: { ok: true }, actions: journalResult.actions };
      for (let index = 0; index < 2; index++) {
        const checkedDelivery = await checkAgain(delivery, { projectId: project.id, conversationId, taskId, runId: "local-repeat", taskScope: localScope });
        assert.equal(checkedDelivery[creationCheckUnrecorded], undefined, "A persisted local check never blocks later legitimate image work");
      }
      assert.equal(repeatedChecks, 1, "One target/ref in an ordinary frozen scope is checked once across repeated deliveries");
      const failedCheck = createSavedCreationActionChecker({ async checkResults() { throw Object.assign(Error("private helper fixture"), { code: "EACCES", creationPersistenceFailed: true }); } });
      const preservedDelivery = await failedCheck(delivery, { projectId: project.id, conversationId, taskId, runId: "local-private-failure", taskScope: scope(taskRef) });
      assert.equal(preservedDelivery[creationCheckUnrecorded], true); assert.equal(preservedDelivery.envelope.ok, true);
      assert.strictEqual(preservedDelivery.actions, delivery.actions, "A failed acceptance check retains the original action objects");
      assert.ok(Object.getOwnPropertySymbols(preservedDelivery).includes(creationCheckUnrecorded));
      assert.doesNotMatch(JSON.stringify(preservedDelivery), /creation-check-unrecorded/, "The process-private failure marker is absent from JSON envelopes and DTOs");
      Object.assign(localCheckEvidence, { initialCheckedBeforeModelRound: 1, duplicateChecks: repeatedChecks, failureMarkerPrivate: true });
    } finally { journalRuntime.dispose(); }

    const capacityConversation = "capacity-conversation", capacityTaskId = "capacity-task", capacityNodes = [{ ...nodes[0], assets: [assets[0]] }];
    const capacityOwner = createProjectCreationService({ projectFor, metaDir: ".naimage/capacity", readSession: () => ({ nodes: capacityNodes }),
      projectRelativePath: (directory, file) => path.relative(directory, file).replace(/\\/g, "/"), resolveProjectRelativePath: (directory, file) => path.resolve(directory, file) });
    const capacityLocator = { projectId: project.id, conversationId: capacityConversation };
    const capacityRequirements = { ...requirements, goal: { text: "Check the saved image without regenerating it", source: "user" },
      usage: { text: "Inspect the existing result", source: "user" }, slots: [{ slotId: "hero", label: "Hero", source: "user" }], preserve: [], conditions: [] };
    const capacityInitialRef = capacityOwner.updateRequirements({ ...capacityLocator, expectedRevision: 0, requirements: capacityRequirements }).requirementRef;
    const capacityFile = path.join(root, ".naimage/capacity/creation.json"), capacityInitial = JSON.parse(fs.readFileSync(capacityFile, "utf8"));
    // Fill the real store through the owner with valid historical requirements.
    // Keep the current contract small so the Runtime failure is persistence,
    // rather than an oversized model request or an invalid input fixture.
    const capacityHistory = { ...capacityRequirements, goal: { text: "A".repeat(200_000), source: "user" }, usage: { text: "B".repeat(200_000), source: "user" },
      conditions: [...Array.from({ length: 39 }, (_, index) => ({ criterionId: `history-${index}`, text: "C".repeat(200_000), source: "user", kind: "visual" })),
        { criterionId: "history-tail", text: "D", source: "user", kind: "visual" }] };
    const capacityVersion = (value, revision) => {
      const normalized = normalizeRequirements(value);
      return { requirementId: capacityInitialRef.requirementId, conversationId: capacityConversation, revision,
        fingerprint: `creation-${hash(JSON.stringify(normalized))}`, ...normalized, updatedAt: new Date().toISOString() };
    };
    const capacityLimit = 8 * 1024 * 1024;
    const capacityProjected = Buffer.byteLength(JSON.stringify({ ...capacityInitial,
      requirements: [...capacityInitial.requirements, capacityVersion(capacityHistory, 2), capacityVersion(capacityRequirements, 3)] }));
    const capacityTailLength = 1 + capacityLimit - 100 - capacityProjected;
    assert.ok(capacityTailLength > 0 && capacityTailLength <= 200_000);
    capacityHistory.conditions.at(-1).text = "D".repeat(capacityTailLength);
    capacityOwner.updateRequirements({ ...capacityLocator, expectedRevision: 1, requirements: capacityHistory });
    const capacityRef = capacityOwner.updateRequirements({ ...capacityLocator, expectedRevision: 2, requirements: capacityRequirements }).requirementRef;
    capacityOwner.setTaskResolver(() => ({ requirementRef: capacityRef }));
    capacityNodes[0].taskProvenance = { version: 1, creation: capacityRef, creationSlotId: "hero" };
    const capacityBefore = fs.readFileSync(capacityFile), beforeCapacityPosts = posts.length, capacityFailures = [];
    assert.equal(capacityBefore.length, capacityLimit - 100, "The legitimate persisted document reaches the actual 8MiB boundary");
    assert.deepEqual(capacityOwner.getRequirements(capacityLocator).requirementRef, capacityRef);
    let capacityRounds = 0, capacityDispatches = 0;
    const capacityRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-capacity"),
      creationService: { ...capacityOwner, async checkResults(input) {
        try { return await capacityOwner.checkResults(input); }
        catch (error) { capacityFailures.push({ code: error.code, creationPersistenceFailed: error.creationPersistenceFailed, phase: error.phase }); throw error; }
      } },
      serverGenerateImage: async payload => { capacityDispatches++; return imageService.generate(settings, payload); },
      serverChatCompletion: async request => {
        if (capacityRounds++ === 0) return response([call("creation", { operation: "check_results", expectedRequirementsRevision: capacityRef.revision,
          target: targetOf(assets[0]) }, "capacity-local-check")]);
        if (capacityRounds === 2) {
          assert.match(JSON.stringify(request.messages), /容量上限/, "The actual follow-up model round receives the capacity refusal");
          return response([call("image_gen", { operation: "edit", prompt: "不得用重新生图修复验收记录容量失败", count: 1,
            parentId: nodes[0].id, sourceAssetId: assets[0].assetId, creationSlotId: "hero" }, "capacity-must-not-regenerate")]);
        }
        return text("保留原成果，等待恢复本地验收记录。");
      } });
    try {
      const capacityResult = await capacityRuntime.chat({ ...capacityLocator, taskId: capacityTaskId, runId: "capacity-check-run", settings,
        prompt: "检查当前已有成果，记录失败不得重生", nodes: capacityNodes, taskScope: scope(capacityRef) });
      assert.deepEqual(capacityFailures, [{ code: "CREATION_STORE_FULL", creationPersistenceFailed: true, phase: "creation_save" }], "The real owner capacity failure reaches Runtime unchanged");
      assert.equal(capacityRounds, 3, "The model actually attempts image_gen in the next round after the rejected check");
      assert.ok(capacityResult.toolResults.some(value => value.tool === "creation" && value.ok === false && /容量上限/.test(value.error)));
      assert.ok(capacityResult.toolResults.some(value => value.tool === "image_gen" && value.ok === false && /本run不能通过重新生图/.test(value.error) && value.errorCategory === "image_result_processing" && value.retriable === false),
        "The regenerate attempt receives the non-retriable image boundary failure");
      assert.equal(capacityDispatches, 0, "A capacity-rejected local check blocks serverGenerateImage before dispatch");
      assert.equal(posts.length, beforeCapacityPosts, "The explicit model regenerate attempt produces zero image HTTP POSTs");
      assert.equal(capacityResult.actions.flatMap(action => action.node?.assets || []).length, 0);
      assert.deepEqual(fs.readFileSync(capacityFile), capacityBefore, "Capacity rejection preserves every previous creation-record byte");
      assert.deepEqual(assets.map(asset => hash(fs.readFileSync(asset.path))), frozenHashes, "Capacity rejection preserves every original image byte");
      capacityEvidence = { storeBytes: capacityBefore.length, limitBytes: capacityLimit, ...capacityFailures[0], modelRounds: capacityRounds,
        serverGenerateImageCalls: capacityDispatches, localImagePosts: posts.length - beforeCapacityPosts, creationFileUnchanged: true, originalImageBytesUnchanged: true };
      fs.writeFileSync(path.join(root, "capacity-guard.json"), JSON.stringify(capacityEvidence, null, 2));
    } finally { capacityRuntime.dispose(); }

    const beforeAutomaticFailurePosts = posts.length, beforeAutomaticFailureStore = fs.readFileSync(path.join(root, ".naimage/creation.json"));
    const automaticFailures = [], automaticProgress = [];
    let automaticRounds = 0, automaticDispatches = 0;
    const automaticFailureRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-automatic-check-failure"),
      creationService: { ...owner, async checkResults(input) {
        const rename = fs.renameSync, destination = path.join(root, ".naimage/creation.json");
        fs.renameSync = (from, to) => { if (to === destination) throw Object.assign(Error("automatic acceptance write fixture"), { code: "EACCES" }); return rename(from, to); };
        try { return await owner.checkResults(input); }
        catch (error) { automaticFailures.push({ code: error.code, creationPersistenceFailed: error.creationPersistenceFailed, phase: error.phase }); throw error; }
        finally { fs.renameSync = rename; }
      } },
      serverGenerateImage: async payload => {
        automaticDispatches++;
        const operation = journal.start({ projectId: project.id, agentTaskId: taskId, runId: "automatic-check-failure-run",
          operationId: `automatic-check-failure-${automaticDispatches}`, model: settings.imageModel });
        const generated = await imageService.generate(settings, payload);
        journal.received(operation, generated);
        return { ok: true, model: settings.imageModel, assets: await journal.deliver(operation, generated) };
      }, serverChatCompletion: async request => {
        if (automaticRounds++ === 0) return response([call("image_gen", { operation: "edit", prompt: "制作商品展示图", count: 1,
          parentId: nodes[0].id, sourceAssetId: assets[0].assetId, creationSlotId: "hero" }, "automatic-failure-original")]);
        if (automaticRounds === 2) {
          assert.match(JSON.stringify(request.messages), /Do not repeat image_gen/, "The model sees the local check failure guidance before trying a different image request");
          return response([call("image_gen", { operation: "edit", prompt: "尝试换目标和槽位重新生图", count: 1,
            parentId: nodes[4].id, sourceAssetId: assets[4].assetId, creationSlotId: "fifth" }, "automatic-failure-different-request")]);
        }
        return text("保留已保存成果，等待恢复本地验收记录。");
      } });
    try {
      const automaticResult = await automaticFailureRuntime.chat({ projectId: project.id, conversationId, taskId, runId: "automatic-check-failure-run", settings,
        prompt: "制作并检查商品图，记录失败不得重生", nodes, taskScope: scope(taskRef), progress: event => automaticProgress.push(event) });
      const retainedAssets = automaticResult.actions.flatMap(action => action.node?.assets || []);
      const automaticFailureEvidence = { modelRounds: automaticRounds, serverGenerateImageCalls: automaticDispatches,
        localImagePosts: posts.length - beforeAutomaticFailurePosts, persistenceFailures: automaticFailures,
        retainedAssets: retainedAssets.length, successfulImageTools: automaticResult.toolResults.filter(value => value.tool === "image_gen" && value.ok !== false).length,
        blockedImageTools: automaticResult.toolResults.filter(value => value.tool === "image_gen" && value.ok === false).length,
        creationFileUnchanged: fs.readFileSync(path.join(root, ".naimage/creation.json")).equals(beforeAutomaticFailureStore),
        originalImageBytesUnchanged: assets.every((asset, index) => hash(fs.readFileSync(asset.path)) === frozenHashes[index]) };
      fs.writeFileSync(path.join(root, "automatic-check-guard.json"), JSON.stringify(automaticFailureEvidence, null, 2));
      assert.equal(automaticRounds, 3);
      assert.equal(automaticDispatches, 1, "Automatic local-check persistence failure blocks even a different later image request before serverGenerateImage");
      assert.equal(posts.length, beforeAutomaticFailurePosts + 1, "Only the originally saved image produces an actual loopback POST");
      assert.deepEqual(automaticFailures, [{ code: "EACCES", creationPersistenceFailed: true, phase: "creation_save" }]);
      assert.equal(retainedAssets.length, 1); assert.equal(hash(fs.readFileSync(retainedAssets[0].path)), retainedAssets[0].contentHash);
      assert.equal(automaticFailureEvidence.successfulImageTools, 1, "Automatic acceptance failure preserves the original successful image tool");
      assert.ok(automaticResult.toolResults.some(value => value.tool === "image_gen" && value.ok === false && value.errorCategory === "image_result_processing" && value.retriable === false));
      assert.ok(automaticProgress.some(event => event.phase === "creation-check" && /本地验收记录失败/.test(event.summary)));
      assert.equal(automaticFailureEvidence.creationFileUnchanged, true); assert.equal(automaticFailureEvidence.originalImageBytesUnchanged, true);
      assert.ok(automaticResult.toolResults.every(value => Object.getOwnPropertySymbols(value).length === 0));
      assert.doesNotMatch(JSON.stringify(automaticResult), /creation-check-unrecorded/, "The internal guard marker never appears in the public chat DTO");
      Object.assign(localCheckEvidence, { ordinaryWriteFailure: automaticFailureEvidence });
    } finally { automaticFailureRuntime.dispose(); }

    const batchConversation = "batch-conversation", batchTaskId = "batch-task", batchSessionFile = path.join(root, "batch-session.json");
    fs.writeFileSync(batchSessionFile, JSON.stringify(sanitizeSession({ nodes: [] })));
    const batchOwner = createProjectCreationService({ projectFor, metaDir: ".naimage/batch", readSession: () => JSON.parse(fs.readFileSync(batchSessionFile, "utf8")),
      projectRelativePath: (directory, file) => path.relative(directory, file).replace(/\\/g, "/"), resolveProjectRelativePath: (directory, file) => path.resolve(directory, file) });
    const batchRef = batchOwner.updateRequirements({ projectId: project.id, conversationId: batchConversation, expectedRevision: 0, requirements: { ...requirements,
      slots: Array.from({ length: 7 }, (_, index) => ({ slotId: `output-${index + 1}`, label: `成果 ${index + 1}`, source: "user" })), preserve: [], conditions: [] } }).requirementRef;
    batchOwner.setTaskResolver(() => ({ requirementRef: batchRef }));
    const batchSettings = { ...settings, imageBatchSize: 7 }, completionOrder = [], beforeBatchPosts = posts.length;
    let batchRound = 0;
    const batchRuntime = createAgentRuntime({ projectRoot: root, configDir: path.join(root, "config-batch"), creationService: batchOwner,
      serverGenerateImage: async payload => {
        const index = Number(payload.runId.match(/-(\d+)$/)?.[1]);
        const generated = await imageService.generate(batchSettings, payload);
        await new Promise(resolve => setTimeout(resolve, (8 - index) * 45));
        completionOrder.push(index);
        if ([3, 6].includes(index)) throw Object.assign(Error(`第 ${index} 项内容策略拒绝夹具`), { errorCategory: "policy" });
        const outputBytes = Buffer.from(generated.images[0].value, "base64"), file = path.join(root, `output/imagegen/batch-${index}.png`); fs.writeFileSync(file, outputBytes);
        return { ok: true, model: settings.imageModel, assets: [{ assetId: `batch-${index}`, occurrenceId: `occ-${index.toString(16).padStart(16, "b")}`,
          contentHash: hash(outputBytes), path: file, relativePath: path.relative(root, file).replace(/\\/g, "/"), width: 64, height: 64,
          recoveryOperationId: `batch-operation-${index}`, status: "done" }] };
      },
      serverChatCompletion: async () => batchRound++ === 0 ? response([call("image_gen", { operation: "edit", prompt: "制作七张商品图片", count: 7, parentId: nodes[0].id, sourceAssetId: assets[0].assetId }, "seven-out-of-order")]) : text("保留已完成成果和失败槽位。") });
    try {
      const batchResult = await batchRuntime.chat({ projectId: project.id, conversationId: batchConversation, taskId: batchTaskId, runId: "seven-out-of-order-run", settings: batchSettings,
        prompt: "生成七张商品作品", nodes, taskScope: scope(batchRef) });
      assert.equal(posts.length - beforeBatchPosts, 7, "count=7 dispatches seven actual loopback image POSTs");
      assert.notDeepEqual(completionOrder, [1, 2, 3, 4, 5, 6, 7], "The exercised batch actually completes out of order");
      const action = batchResult.actions.find(value => value.node?.imageCollection?.items?.length === 7);
      assert.ok(action, JSON.stringify(batchResult.toolResults));
      assert.equal(action.node.assets.length, 5);
      assert.deepEqual(action.node.imageCollection.items.map(item => item.taskProvenance?.creationSlotId), Array.from({ length: 7 }, (_, index) => `output-${index + 1}`), "Final actions retain provenance for successful and failed request slots");
      for (const item of action.node.imageCollection.items.filter(item => item.status === "done")) {
        assert.equal(item.assetId, `batch-${item.requestIndex}`); assert.equal(item.assetId, action.node.assets[item.assetIndex - 1].assetId);
      }
      const savedSession = sanitizeSession({ nodes: [{ ...action.node, id: "batch-node", type: "image", status: "done", x: 0, y: 0 }] });
      fs.writeFileSync(batchSessionFile, JSON.stringify(savedSession));
      const persisted = JSON.parse(fs.readFileSync(batchSessionFile, "utf8")).nodes[0];
      assert.equal(persisted.assets.length, 5);
      assert.deepEqual(persisted.imageCollection.items.map(item => item.taskProvenance?.creationSlotId), Array.from({ length: 7 }, (_, index) => `output-${index + 1}`));
      const acceptance = batchOwner.getAcceptance({ projectId: project.id, conversationId: batchConversation, taskId: batchTaskId });
      assert.equal(acceptance.results.length, 5, "Main discovers all five saved results from the actual persisted final batch action");
      const slotMap = Object.fromEntries(acceptance.results.map(value => [value.target.assetId, value.slotId]));
      assert.deepEqual(slotMap, Object.fromEntries([1, 2, 4, 5, 7].map(index => [`batch-${index}`, `output-${index}`])), "Out-of-order completion and partial failures never shift output slot identity");
      assert.ok(acceptance.results.every(value => value.saved && value.fileSaved));
      batchEvidence = { localImagePosts: posts.length - beforeBatchPosts, completionOrder, savedCount: persisted.assets.length,
        failedRequestIndexes: persisted.imageCollection.items.filter(item => item.status === "error").map(item => item.requestIndex), slotMap };
    } finally { batchRuntime.dispose(); }
  } finally { await new Promise(resolve => server.close(resolve)); }
  const report = { ok: true, realModelRequests: 0, localImagePosts: posts.length, checks: ["public schema and automatic tool choice", "main-agent requirement refinement updates frozen ref", "same-response target/source review rejected", "consumed target and source review persisted", "CLI forged/cross-run/cross-asset proof rejected", "requirements and source hash invalidation", "incomplete model round rejects review", "AskUser hands off refined requirements", "fresh Runtime resumes serialized AskUser contract", "structured targeted revision defers without original-run dispatch or requirement mutation", "unknown deferred revision target rejected", "requirements preflight blocks owner mutation after dispatch", "exact two target posts and separate delta prompts", "original files unchanged", "model count/source overrides cause zero posts", "save failure cannot regenerate", "new saved journal output reviewed before session materialization", "new output can defer a revision without regenerating", "seven-image out-of-order partial batch retains final action and persisted acceptance slots"], posts, batchEvidence };
  report.checks.push("frozen original requirements and per-slot subject/reference constraints preserved", "managed masked revision uses exact verified bytes in one HTTP POST", "mask target/hash/dimensions/decode/empty/source failures dispatch zero images", "masked revision duplicate and concurrent preflight dispatch only once", "mask base64 excluded from persistent tool memory");
  report.maskEvidence = maskEvidence;
  report.checks.push("initial, targeted and masked saved images automatically receive local checks without AI acceptance", "acceptance write failure retains one saved image POST and reports no-regenerate guidance", "repeated target/ref delivery does not repeat local decoding");
  report.localCheckEvidence = localCheckEvidence;
  report.checks.push("real 8MiB creation capacity refusal blocks the later model image_gen attempt with zero dispatch and unchanged records/images");
  report.capacityEvidence = capacityEvidence;
  report.checks.push("automatic local-check EACCES retains the successful saved action and blocks a different later image request before dispatch");
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, checks: report.checks, localImagePosts: posts.length, realModelRequests: 0, report: path.join(root, "report.json") }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
