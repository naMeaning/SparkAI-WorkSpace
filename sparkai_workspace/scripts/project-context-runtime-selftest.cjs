"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { createAgentRuntime, normalizedTaskScope, taskScopeSnapshotHash } = require("../agent-runtime.cjs");
const { agentTaskScopeSnapshotHash } = require("../src/core.ts");
const { cloneAgentTaskScope } = require("../src/task-scope.ts");
const { createAgentTaskService } = require("../desktop/agent-task-service.cjs");
const { createAgentRunControl } = require("../desktop/agent-run-control.cjs");
const { createProjectCommerceCatalogService } = require("../desktop/project-commerce-catalog.cjs");
const { createProjectCreationService } = require("../desktop/project-creation-service.cjs");
const { createProjectKnowledgeService } = require("../desktop/project-knowledge-service.cjs");
const { createProjectResultIndex } = require("../desktop/project-result-index.cjs");
const { createProjectContextCommandService } = require("../desktop/project-context-command-service.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");
const { createImageOperationJournal } = require("../desktop/image-operation-journal.cjs");
const { createRequirementLibraryService } = require("../desktop/requirement-library.cjs");
const { validateSchemaValue } = require("../desktop/debug-command-service.cjs");
const { executeAutomationCommand } = require("../src/automation-command-runtime.ts");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");
const { mergeProjectSessions } = require("../desktop/project-session-merge.cjs");
const { imageConfigSnapshot, settingsWithImageConfig } = require("../runtime/image-config-snapshot.mjs");
const { projectKnowledgeReceipt } = require("../runtime/project-knowledge-contract.mjs");
const { appendProjectTaskContext, findProjectTaskContext } = require("../runtime/project-task-contexts.mjs");
const { projectContextToolSchema, runProjectContextTool } = require("../runtime/project-context-tools.cjs");
const { bindProjectContextMaterials } = require("../runtime/project-context-scope.mjs");

const root = path.resolve(__dirname, "../.diagnostics/project-context-runtime", new Date().toISOString().replace(/[:.]/g, "-"));
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const relative = (base, file) => path.relative(base, file || "").replace(/\\/g, "/");
const targetOf = asset => ({ assetId: asset.assetId, occurrenceId: asset.occurrenceId, contentHash: asset.contentHash });
const completion = output => ({ chunks: [{ type: "response.completed", response: { status: "completed", output } }] });
const call = (name, args, id = name) => ({ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) });
const done = value => completion([{ type: "message", role: "assistant", content: [{ type: "output_text", text: value }] }]);
const checks = [], evidence = {};
async function check(name, operation) { await operation(); checks.push(name); console.log(`ok ${checks.length} ${name}`); }

async function main() {
  const projects = ["context-project-a", "context-project-b"].map(id => ({ id, path: path.join(root, id), sessionPath: path.join(root, id, "session.json") }));
  const sessions = new Map(projects.map(project => [project.id, { schemaVersion: 5, activeConversationId: "first", conversations: [{ id: "first", messages: [] }, { id: "next", messages: [] }], nodes: [], edges: [] }]));
  for (const project of projects) fs.mkdirSync(path.join(project.path, "assets"), { recursive: true });
  const project = projects[0], session = () => sessions.get(project.id), projectFor = id => projects.find(value => value.id === id);
  const readSession = value => sessions.get(typeof value === "string" ? value : value.id);
  const at = { expectedProjectId: project.id }, conversation = { ...at, conversationId: "first" };
  const assets = [];
  for (let index = 0; index < 3; index++) {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 40 + 60 * index, g: 70, b: 150 } } }).png().toBuffer();
    const relativePath = `assets/context-${index + 1}.png`, file = path.join(project.path, relativePath); fs.writeFileSync(file, bytes);
    assets.push({ assetId: `context-asset-${index + 1}`, occurrenceId: `occ-${String(index + 1).padStart(16, "0")}`, contentHash: hash(bytes),
      path: file, relativePath, width: 64, height: 64, index: 1, status: "done", prompt: index === 1 ? "金色商品横幅" : "蓝色背景商品" });
    session().nodes.push({ id: `context-node-${index + 1}`, type: "image", title: index === 1 ? "金色横幅" : `商品原图 ${index + 1}`, imageState: "done", assets: [assets[index]] });
  }
  const catalog = createProjectCommerceCatalogService({ getProjectById: projectFor, readProjectList: () => ({ projects }), projectSessionFromDisk: readSession,
    projectCommerceCatalogPath: value => path.join(value.path, ".naimage/commerce-catalog.json"), projectRelativePath: relative, resolveProjectRelativePath: path.resolve });
  const creation = createProjectCreationService({ projectFor, readSession, projectRelativePath: relative, resolveProjectRelativePath: path.resolve });
  const requirements = { goal: { text: "沿用用户明确选中的金色横幅", source: "user" }, usage: { text: "商品展示", source: "user" },
    slots: [{ slotId: "hero", label: "商品横幅", source: "user" }], preserve: [], adjustable: [], conditions: [], fileRules: { formats: ["png"], width: 64, height: 64 } };
  const creationRef = creation.updateRequirements({ ...conversation, expectedRevision: 0, requirements }).requirementRef;
  const knowledgeOptions = { projectFor, readSession, catalogService: catalog, projectRelativePath: relative, resolveProjectRelativePath: path.resolve };
  let knowledge = createProjectKnowledgeService(knowledgeOptions);
  const index = createProjectResultIndex({ projectFor, readSession, catalogService: catalog, creationService: creation, resolveProjectRelativePath: path.resolve });
  const command = createProjectContextCommandService({ knowledgeService: knowledge, resultIndex: index, readSession,
    locateOwner: async () => "owner", dispatch: async (name, input) => ({ ok: true, command: name, targets: input.targets }) });
  const save = (content, title = "项目长期配色", source = "user") => knowledge.save({ ...at, expectedRevision: knowledge.list(at).revision,
    entry: { type: "preference", title, content, scope: { type: "project" }, source, assetRefs: [] } });
  const initialEntry = save("冻结暖金规范：长期保持暖金色和清晰主体").entry;
  const settings = { agentModel: "fixture-agent", contextStrategy: "codex", imageModel: "gpt-image-2", imageModelPool: ["gpt-image-2"],
    imageRatio: "1:1", imageResolution: "1K", imageQuality: "medium", imageCount: 1 };
  const template = { templateId: `reqtpl-${"a".repeat(32)}`, revision: 1, fingerprint: `template-${"b".repeat(32)}`, variableValues: { headline: "当前商品" } };
  const emptyScope = normalizedTaskScope({ taskScope: { version: 2, origin: "chat", sourceNodeIds: [], materials: [], imageConfig: imageConfigSnapshot(settings), creation: creationRef, template } });
  let taskService, beforeAdmit = null, dispatches = 0;
  const controlSnapshots = [], runControl = createAgentRunControl({ onChange: value => controlSnapshots.push(value) });
  const taskOptions = { projectFor, readSession, runSnapshot: () => runControl.snapshot(), locateOwner: async () => "owner", operations: () => [],
    freezeProjectKnowledge: input => knowledge.freezeForTask(input), validateProjectKnowledge: input => knowledge.validateFrozen(input),
    creationRequirements: input => creation.requirementRefForTask(input),
    validateCreationScope: input => creation.validateTaskContract({ ...input, creation: input.taskScope.creation }),
    async dispatch(name, input, owner) {
      dispatches++;
      if (name !== "agent.task.dispatch") throw Error(`Unexpected dispatch ${name}`);
      await beforeAdmit?.(input);
      const runId = `context-run-${dispatches}`;
      taskService.admit({ ...input, runId, taskScope: input.taskScope }, owner);
      taskService.claimRun({ ...input, runId }, owner);
    } };
  taskService = createAgentTaskService(taskOptions);
  const wireTaskResolver = () => {
    knowledge.setTaskResolver((projectId, taskId, conversationId) => taskService.get({ expectedProjectId: projectId, taskId, conversationId }).task);
    creation.setTaskResolver((projectId, taskId, conversationId) => taskService.get({ expectedProjectId: projectId, taskId, conversationId }).task);
  };
  wireTaskResolver();
  const taskTarget = task => ({ expectedProjectId: task.projectId, conversationId: task.conversationId, taskId: task.taskId });
  const remember = (task, scope) => { session().projectTaskContexts = appendProjectTaskContext(session().projectTaskContexts, {
    version: 1, projectId: project.id, conversationId: task.conversationId, taskId: task.taskId, createdAt: task.createdAt,
    fingerprint: scope.projectKnowledge.fingerprint, projectKnowledge: scope.projectKnowledge, requirementTemplate: scope.template
  }, { expectedProjectId: project.id }); };
  let prepared, originalScope, original, originalInput;
  await check("Main prepare and shared Renderer/Runtime hashes preserve effective knowledge and template material", async () => {
    prepared = await command.prepare({ ...conversation, taskScope: emptyScope });
    assert.equal(prepared.ok, true); assert.deepEqual(prepared.knowledgeMaterials, []);
    originalScope = normalizedTaskScope({ taskScope: { ...emptyScope, projectKnowledge: prepared.projectKnowledge } });
    assert.equal(originalScope.snapshotHash, taskScopeSnapshotHash(originalScope));
    assert.equal(originalScope.snapshotHash, agentTaskScopeSnapshotHash(originalScope));
    assert.equal(cloneAgentTaskScope(originalScope).snapshotHash, originalScope.snapshotHash);
    assert.deepEqual(cloneAgentTaskScope(originalScope).projectKnowledge, prepared.projectKnowledge);
    const noKnowledge = normalizedTaskScope({ taskScope: { ...emptyScope } });
    const newTemplate = normalizedTaskScope({ taskScope: { ...originalScope, template: { ...template, variableValues: { headline: "另一商品" } } } });
    assert.notEqual(noKnowledge.snapshotHash, originalScope.snapshotHash); assert.notEqual(newTemplate.snapshotHash, originalScope.snapshotHash);
    assert.equal(newTemplate.snapshotHash, agentTaskScopeSnapshotHash(newTemplate));
  });
  await check("reserve freezes refs before admission and original tasks survive later knowledge edits", async () => {
    beforeAdmit = () => {
      knowledge.save({ ...at, expectedRevision: 1, knowledgeId: initialEntry.knowledgeId, expectedEntryRevision: 1, entry: { content: "未来蓝色规范：新任务使用蓝色" } });
    };
    originalInput = { ...conversation, submissionId: "original", prompt: "按原任务整理横幅，稍后回答版式", creation: creationRef, projectKnowledge: prepared.projectKnowledge, taskScope: originalScope, template };
    original = (await taskService.startInternal(originalInput)).task; beforeAdmit = null;
    assert.equal(original.accepted, true); assert.deepEqual(original.projectKnowledge, projectKnowledgeReceipt(prepared.projectKnowledge));
    remember(original, originalScope);
    const ledger = JSON.parse(fs.readFileSync(path.join(project.path, ".naimage/agent/tasks.json"), "utf8"));
    assert.equal(ledger.tasks[0].projectKnowledge.entries[0].content, undefined);
    assert.doesNotMatch(JSON.stringify(ledger), /冻结暖金规范|未来蓝色规范/);
    assert.deepEqual(knowledge.resolveFrozen({ ...taskTarget(original), snapshot: prepared.projectKnowledge, taskScope: originalScope }), prepared.projectKnowledge);
    const duplicate = await taskService.startInternal(originalInput); assert.equal(duplicate.duplicate, true); assert.equal(dispatches, 1);
    const current = knowledge.freezeForTask({ ...conversation, taskScope: emptyScope });
    await assert.rejects(taskService.startInternal({ ...originalInput, projectKnowledge: current, taskScope: { ...originalScope, projectKnowledge: current } }), { code: "TASK_SUBMISSION_CONFLICT" });
    assert.equal(dispatches, 1);
    evidence.originalKnowledge = prepared.projectKnowledge.fingerprint; evidence.currentKnowledgeAfterAdmission = current.fingerprint;
  });

  const modelPosts = [], imagePosts = [], scenarios = new Map();
  const server = http.createServer(async (request, reply) => {
    try {
      assert.equal(request.method, "POST"); const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks); reply.setHeader("Content-Type", "application/json");
      if (request.url === "/responses") {
        const payload = JSON.parse(bytes.toString("utf8")), scenario = scenarios.get(payload.scenario);
        if (!scenario) throw Error("Unknown model fixture");
        const round = scenario.round++; modelPosts.push({ scenario: payload.scenario, round, request: payload.request });
        const output = await scenario.respond(payload.request, round);
        reply.end(JSON.stringify(output)); return;
      }
      if (!/^\/v1\/images\/(?:edits|generations)$/.test(request.url)) throw Error("Unexpected loopback route");
      const images = []; let prompt, model, n, quality, size;
      if (String(request.headers["content-type"]).includes("multipart/form-data")) {
        const form = await new Request(`http://localhost${request.url}`, { method: "POST", headers: { "content-type": request.headers["content-type"] }, body: bytes }).formData();
        for (const [name, value] of form) if (/^image/.test(name) && typeof value.arrayBuffer === "function") images.push(hash(Buffer.from(await value.arrayBuffer())));
        [prompt, model, n, quality, size] = ["prompt", "model", "n", "quality", "size"].map(key => form.get(key));
      } else { const value = JSON.parse(bytes); ({ prompt, model, n, quality, size } = value); }
      imagePosts.push({ endpoint: request.url, images, prompt, model, n, quality, size });
      reply.end(JSON.stringify({ data: [{ b64_json: fs.readFileSync(assets[1].path).toString("base64") }] }));
    } catch (error) { fs.writeFileSync(path.join(root, "loopback-failure.json"), JSON.stringify({ error: error.stack, lastModel: modelPosts.at(-1) }, null, 2)); reply.statusCode = 500; reply.end(JSON.stringify({ error: String(error.message).slice(0, 1400) })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const postJson = async (route, value) => { const response = await fetch(`${endpoint}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const imageService = createImageGenerationService({ newApiRelayJson: (_settings, route, value) => postJson(route, value),
    newApiRelayMultipart: async (_settings, route, form) => { const response = await fetch(`${endpoint}${route}`, { method: "POST", body: form }); assert.equal(response.status, 200); return response.json(); } });
  const journal = createImageOperationJournal({ projectFor, extractImages: value => value.images || [], materialize: async (images, name) => images.map((image, index) => {
    const bytes = Buffer.from(image.value, "base64"), relativePath = `output/imagegen/${name}-${index}.png`, file = path.join(project.path, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    return { path: file, relativePath, contentHash: hash(bytes), width: 64, height: 64, status: "done" };
  }) });
  let generated = 0;
  async function run(name, task, scope, respond, options = {}) {
    scenarios.set(name, { round: 0, respond });
    runControl.begin({ runId: task.currentRunId, projectId: project.id, conversationId: task.conversationId, ownerId: "owner", steerable: true, taskScope: scope });
    const runtime = createAgentRuntime({ projectRoot: project.path, configDir: path.join(root, `runtime-${name}`),
      projectContextService: command, resultIndex: index, creationService: creation,
      onProjectMaterials: async input => {
        const resolved = await index.resolveUse({ expectedProjectId: input.expectedProjectId, targets: input.targets });
        const previousHash = runControl.snapshot().runs.find(value => value.runId === input.runId)?.taskScopeSnapshotHash;
        runControl.bindProjectMaterials({ ...input, previousHash, commit: () => taskService.advanceMaterials({ ...input, validate: () => {
          const key = value => JSON.stringify(targetOf(value));
          const frozen = new Set(input.taskScope.materials.map(key));
          assert.ok(resolved.materials.every(value => frozen.has(key(value))));
        } }) });
      },
      serverChatCompletion: request => postJson("/responses", { scenario: name, request }),
      serverGenerateImage: async payload => {
        assert.deepEqual(payload.imageConfig, scope.imageConfig);
        const frozenSettings = settingsWithImageConfig({ ...settings, ...options.settings }, payload.imageConfig);
        const operation = journal.start({ projectId: project.id, agentTaskId: task.taskId, runId: task.currentRunId, operationId: `${name}-${++generated}`, model: settings.imageModel });
        const response = await imageService.generate(frozenSettings, payload); journal.received(operation, response);
        return { ok: true, model: settings.imageModel, assets: await journal.deliver(operation, response) };
      } });
    try { return await runtime.chat({ projectId: project.id, conversationId: task.conversationId, taskId: task.taskId, runId: task.currentRunId,
      settings: { ...settings, ...options.settings }, prompt: options.prompt || "仅按本任务冻结知识继续，明确使用检索到的成果时再绑定", nodes: session().nodes, taskScope: scope,
      progress: event => taskService.progress(project.id, task.currentRunId, event) }); }
    finally { runtime.dispose(); runControl.finish({ runId: task.currentRunId }); }
  }
  let waitingScope;
  try {
    await check("actual loopback model rounds query/save knowledge without changing the active frozen context", async () => {
      const before = imagePosts.length;
      const waiting = await run("knowledge-tools", original, originalScope, (request, round) => {
        const system = request.messages.filter(message => ["system", "developer"].includes(message.role)).map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
        assert.match(system, /冻结暖金规范/); assert.match(system, /用户本次明确要求/);
        assert.ok(request.tools.some(tool => tool.function?.name === "project_context"));
        if (round === 0) return completion([call("project_context", { operation: "get_context" }, "context-read")]);
        if (round === 1) return completion([call("project_context", { operation: "save_knowledge", expectedRevision: 2,
          entry: { type: "preference", title: "Agent建议", content: "建议尝试米色", scope: { type: "project" }, source: "assumption", assetRefs: [] } }, "knowledge-suggestion")]);
        if (round === 2) return completion([call("project_context", { operation: "save_knowledge", expectedRevision: 3,
          entry: { type: "brand_rule", title: "明确长期要求", content: "长期保持标题简洁", scope: { type: "project" }, source: "user", assetRefs: [] } }, "knowledge-user-save")]);
        return completion([call("ask_user", { question: "这次使用横向还是方形排版？", options: [{ id: "wide", label: "横向" }, { id: "square", label: "方形" }] }, "layout-choice")]);
      }, { prompt: "继续原任务；请长期记住标题要简洁，米色只作为Agent建议，询问这次版式后等待。" });
      assert.ok(waiting.toolResults.every(result => result.ok !== false), JSON.stringify(waiting.toolResults));
      assert.equal(imagePosts.length, before); waitingScope = clone(waiting.effectiveTaskScope);
      assert.deepEqual(waitingScope.projectKnowledge, prepared.projectKnowledge); assert.equal(waitingScope.snapshotHash, originalScope.snapshotHash);
      const latest = knowledge.freezeForTask(at); assert.ok(latest.entries.some(entry => entry.title === "明确长期要求")); assert.ok(!latest.entries.some(entry => entry.title === "Agent建议"));
      const ask = waiting.actions.find(action => action.type === "ui.ask_user.open"); assert.ok(ask);
      session().pendingAgentExecution = { ...ask.request, projectId: project.id, conversationId: "first", taskId: original.taskId,
        originalPrompt: originalInput.prompt, taskScope: waitingScope, imageRatio: "1:1", imageResolution: "1K", sourceNodeIds: [] };
      taskService.settle({ ...taskTarget(original), runId: original.currentRunId, outcome: "waiting" }, "owner");
      assert.equal(taskService.get(taskTarget(original)).task.phase, "waiting");
    });
    await check("real session normalization/write/reopen and stale merge retain immutable context for AskUser restart", async () => {
      const sanitized = sanitizeSession(session()); assert.ok(sanitized.pendingAgentExecution);
      assert.equal(sanitized.projectTaskContexts[0].conversationId, "first"); assert.equal(sanitized.projectTaskContexts[0].createdAt, original.createdAt);
      fs.writeFileSync(project.sessionPath, JSON.stringify(sanitized));
      const reopened = sanitizeSession(JSON.parse(fs.readFileSync(project.sessionPath, "utf8")));
      const stale = { ...clone(reopened), projectTaskContexts: [] };
      const merged = mergeProjectSessions(reopened, stale, { nextRevision: 2 }).session;
      assert.deepEqual(merged.projectTaskContexts, reopened.projectTaskContexts);
      sessions.set(project.id, merged);
      knowledge = createProjectKnowledgeService(knowledgeOptions); taskService = createAgentTaskService(taskOptions); wireTaskResolver();
      const restored = taskService.get(taskTarget(original)).task; assert.equal(restored.phase, "waiting");
      const frozen = findProjectTaskContext(session().projectTaskContexts, { projectId: project.id, conversationId: "first", taskId: original.taskId });
      assert.deepEqual(knowledge.resolveFrozen({ ...taskTarget(original), snapshot: frozen.projectKnowledge, taskScope: waitingScope }), prepared.projectKnowledge);
      const claimed = taskService.claimAnswer({ ...taskTarget(original), questionId: restored.question.requestId, expectedVersion: restored.version, optionId: "wide" }, "owner");
      taskService.admit({ ...taskTarget(original), runId: claimed.runId, taskScope: waitingScope }, "owner");
      taskService.claimRun({ ...taskTarget(original), runId: claimed.runId }, "owner");
      const resumedTask = taskService.get(taskTarget(original)).task;
      const resumed = await run("knowledge-resume", resumedTask, waitingScope, request => {
        const instructions = request.messages.filter(message => ["system", "developer"].includes(message.role)).map(message => message.content).join("\n");
        assert.match(instructions, /冻结暖金规范/); assert.doesNotMatch(instructions, /未来蓝色规范/);
        return done("已按原冻结知识继续，回答仅影响这次排版。");
      });
      assert.deepEqual(resumed.effectiveTaskScope.projectKnowledge, prepared.projectKnowledge); assert.equal(resumed.effectiveTaskScope.snapshotHash, originalScope.snapshotHash);
      taskService.settle({ ...taskTarget(original), runId: claimed.runId, outcome: "completed" }, "owner");
      const context = await command.execute("project.context.get", conversation);
      assert.equal(context.usedKnowledge.fingerprint, prepared.projectKnowledge.fingerprint); assert.equal(context.usedTemplate.fingerprint, template.fingerprint);
      assert.equal((await command.execute("project.context.get", { ...at, conversationId: "next" })).usedKnowledge, undefined);
      assert.deepEqual(knowledge.freezeForTask({ expectedProjectId: projects[1].id }).entries, []);
    });
    await check("Main result binding reserves reference locks before commit and keeps scope across steer/stop", async () => {
      const resolved = await index.resolveUse({ ...at, targets: [targetOf(assets[2])] });
      const referenceScope = normalizedTaskScope({ taskScope: bindProjectContextMaterials(originalScope, resolved.materials, "reference") });
      const binding = { runId: "reference-lock-subject", projectId: project.id, conversationId: "lock-subject", previousHash: originalScope.snapshotHash, taskScope: referenceScope };
      const subject = runControl.begin({ ...binding, taskScope: originalScope, steerable: true });
      runControl.begin({ runId: "reference-lock-other", projectId: project.id, conversationId: "lock-other", nodeIds: [resolved.materials[0].nodeId] });
      let commits = 0;
      assert.throws(() => runControl.bindProjectMaterials({ ...binding, commit: () => { commits++; } }), { code: "TASK_SCOPE_BUSY" });
      assert.equal(commits, 0); assert.equal(subject.taskScope.snapshotHash, originalScope.snapshotHash);
      runControl.finish({ runId: "reference-lock-other" });
      assert.throws(() => runControl.bindProjectMaterials({ ...binding, commit: () => { throw Object.assign(Error("fixture persistence failure"), { code: "EACCES" }); } }), { code: "EACCES" });
      assert.equal(subject.taskScope.snapshotHash, originalScope.snapshotHash);
      assert.ok(!runControl.snapshot(project.id).lockedNodeIds.includes(resolved.materials[0].nodeId));
      runControl.bindProjectMaterials({ ...binding, commit: () => { commits++; return { ok: true }; } });
      assert.equal(commits, 1); assert.equal(subject.taskScope.snapshotHash, referenceScope.snapshotHash);
      assert.ok(runControl.snapshot(project.id).lockedNodeIds.includes(resolved.materials[0].nodeId));
      assert.throws(() => runControl.begin({ runId: "reference-reuse", projectId: project.id, conversationId: "another-conversation", nodeIds: [resolved.materials[0].nodeId] }), { code: "NAIMAGE_NODE_LOCKED" });
      const steered = runControl.steer({ runId: binding.runId, prompt: "只调整本次排版，保留已采用参考" }, current => ({ sourceMode: "keep", referenceMode: "keep", taskScope: current }));
      assert.equal(steered.taskScopeSnapshotHash, referenceScope.snapshotHash);
      assert.deepEqual(runControl.consumeSteers(subject)[0].taskScope.materials.map(targetOf), [targetOf(assets[2])]);
      assert.ok(runControl.snapshot(project.id).lockedNodeIds.includes(resolved.materials[0].nodeId));
      runControl.stop({ runId: binding.runId }); assert.equal(subject.signal.aborted, true); assert.equal(subject.taskScope.snapshotHash, referenceScope.snapshotHash);
      assert.equal(runControl.snapshot(project.id).runs.length, 0); assert.ok(controlSnapshots.some(value => value.lockedNodeIds.includes(resolved.materials[0].nodeId)));
      evidence.referenceLocks = { busyCommits: 0, successfulCommits: commits, persistenceFailurePreservedScope: true, retainedThroughSteer: true, releasedOnStop: true };
    });
    let searched, selectedTask, selectedScope;
    await check("public local search performs zero model/image requests and never selects materials", async () => {
      const beforeModels = modelPosts.length, beforeImages = imagePosts.length;
      searched = await command.execute("project.results.search", { ...at, query: { text: "金色横幅", description: { text: "金色", source: "intended" } }, limit: 10 });
      assert.equal(searched.results.length, 1); assert.deepEqual(searched.results[0].target, targetOf(assets[1]));
      assert.equal(searched.results[0].observation.status, "unobserved"); assert.ok(searched.results[0].matchReasons.some(reason => reason.source === "intended"));
      assert.equal(modelPosts.length, beforeModels); assert.equal(imagePosts.length, beforeImages); assert.deepEqual(originalScope.materials, []);
      assert.doesNotMatch(JSON.stringify(searched), /[A-Z]:\\|\/assets\/|data:image|apiKey|Bearer/);
      const current = await command.prepare({ ...conversation, taskScope: emptyScope });
      selectedScope = normalizedTaskScope({ taskScope: { ...emptyScope, projectKnowledge: current.projectKnowledge } });
      assert.notEqual(selectedScope.projectKnowledge.fingerprint, prepared.projectKnowledge.fingerprint);
      selectedTask = (await taskService.startInternal({ ...conversation, submissionId: "explicit-use", prompt: "查找金色横幅，明确使用它做一次编辑", creation: creationRef,
        projectKnowledge: current.projectKnowledge, taskScope: selectedScope, template })).task;
      remember(selectedTask, selectedScope);
      let unauthorizedCommits = 0;
      const changedConfig = normalizedTaskScope({ taskScope: { ...selectedScope, imageConfig: { ...selectedScope.imageConfig, quality: "high" } } });
      assert.throws(() => taskService.advanceMaterials({ ...taskTarget(selectedTask), projectId: project.id, runId: selectedTask.currentRunId,
        taskScope: changedConfig, targets: [], validate: () => { unauthorizedCommits++; } }), { code: "TASK_SCOPE_CONFLICT" });
      const changedTemplate = normalizedTaskScope({ taskScope: { ...selectedScope, template: { ...template, revision: 2 } } });
      assert.throws(() => taskService.advanceMaterials({ ...taskTarget(selectedTask), projectId: project.id, runId: selectedTask.currentRunId,
        taskScope: changedTemplate, targets: [], validate: () => { unauthorizedCommits++; } }), { code: "TASK_SCOPE_CONFLICT" });
      assert.equal(unauthorizedCommits, 0);
    });
    let boundScope;
    await check("Runtime search then explicit stable use reaches the image HTTP endpoint with the correct source and frozen config", async () => {
      const before = imagePosts.length;
      const generatedResult = await run("search-use-image", selectedTask, selectedScope, (request, round) => {
        const instructions = request.messages.filter(message => ["system", "developer"].includes(message.role)).map(message => message.content).join("\n");
        assert.match(instructions, /未来蓝色规范/); assert.doesNotMatch(instructions, /冻结暖金规范/);
        if (round === 0) return completion([call("project_context", { operation: "search_results", query: { text: "金色横幅" }, limit: 5 }, "result-search")]);
        if (round === 1) { assert.equal(imagePosts.length, before); return completion([call("project_context", { operation: "use_results", targets: [targetOf(assets[1])], role: "source" }, "result-use")]); }
        if (round === 2) { assert.equal(imagePosts.length, before); return completion([call("image_gen", { operation: "edit", prompt: "只微调选定金色横幅的排版", count: 1, sourceAssetId: assets[1].assetId }, "selected-image-edit")]); }
        return done("已经使用明确选择的金色横幅完成一次编辑。");
      }, { settings: { imageRatio: "3:2", imageResolution: "2K", imageQuality: "high" } });
      assert.ok(generatedResult.toolResults.every(result => result.ok !== false), JSON.stringify(generatedResult.toolResults));
      assert.equal(imagePosts.length, before + 1); const posted = imagePosts[before];
      assert.deepEqual(posted.images, [assets[1].contentHash]); assert.equal(posted.model, "gpt-image-2"); assert.equal(posted.quality, "medium"); assert.equal(posted.n, "1");
      assert.equal(posted.endpoint, "/v1/images/edits");
      boundScope = generatedResult.effectiveTaskScope;
      assert.equal(boundScope.materials.length, 1); assert.deepEqual(targetOf(boundScope.materials[0]), targetOf(assets[1]));
      assert.deepEqual(boundScope.projectKnowledge, selectedScope.projectKnowledge); assert.deepEqual(boundScope.imageConfig, selectedScope.imageConfig); assert.deepEqual(boundScope.template, template);
      assert.equal(boundScope.snapshotHash, agentTaskScopeSnapshotHash(boundScope));
      assert.deepEqual(taskService.get(taskTarget(selectedTask)).task.scope.sourceAssets.map(targetOf), [targetOf(assets[1])]);
      const resultAssets = generatedResult.actions.flatMap(action => action.node?.assets || []); assert.equal(resultAssets.length, 1);
      assert.equal(hash(fs.readFileSync(resultAssets[0].path)), resultAssets[0].contentHash);
      for (const action of generatedResult.actions) if (action.node?.assets?.length) session().nodes.push(action.node);
      taskService.settle({ ...taskTarget(selectedTask), runId: selectedTask.currentRunId, outcome: "completed" }, "owner");
      evidence.explicitUse = { target: targetOf(assets[1]), inputHashes: posted.images, scopeHash: boundScope.snapshotHash, localImagePosts: 1 };
    });
    await check("Goal expansion, post-dispatch use and stale occurrences fail before another image request", async () => {
      const before = imagePosts.length;
      const beforeScope = clone(boundScope);
      assert.throws(() => bindProjectContextMaterials(boundScope, [boundScope.materials[0]], "reference"), /另一用途冻结/);
      assert.deepEqual(clone(boundScope), beforeScope, "Changing an existing SOURCE to REFERENCE cannot mutate the frozen material in place.");
      assert.deepEqual(normalizedTaskScope({ taskScope: bindProjectContextMaterials(boundScope, [boundScope.materials[0]], "source") }), boundScope,
        "Rebinding the same exact identity to the same role is idempotent.");
      await assert.rejects(runProjectContextTool({ operation: "use_results", targets: [targetOf(assets[2])], role: "source" },
        { projectId: project.id, conversationId: "first", taskId: selectedTask.taskId, taskScope: { origin: "goal" } },
        { resultIndex: index, normalizeScope: value => normalizedTaskScope({ taskScope: value }), onMaterials: () => { throw Error("Goal must not enter Main material advancement"); } }), /不能扩展素材/);
      assert.throws(() => taskService.advanceMaterials({ ...taskTarget(selectedTask), projectId: project.id, runId: selectedTask.currentRunId, taskScope: boundScope,
        targets: [targetOf(assets[2])], validate: () => {} }), { code: "TASK_SCOPE_LOCKED" });
      const bytes = fs.readFileSync(assets[2].path); fs.writeFileSync(assets[2].path, fs.readFileSync(assets[0].path));
      try { await assert.rejects(index.resolveUse({ ...at, targets: [targetOf(assets[2])] }), { code: "RESULT_TARGET_STALE" }); }
      finally { fs.writeFileSync(assets[2].path, bytes); }
      await assert.rejects(index.resolveUse({ ...at, targets: [{ ...targetOf(assets[1]), occurrenceId: assets[2].occurrenceId }] }), { code: "RESULT_TARGET_STALE" });
      await assert.rejects(index.resolveUse({ expectedProjectId: projects[1].id, targets: [targetOf(assets[1])] }), { code: "RESULT_TARGET_STALE" });
      assert.equal(imagePosts.length, before);
    });
    await check("prepare resolves an adopted style baseline through the asset owner and rejects Goal expansion without requests", async () => {
      const secondary = projects[1], base = { expectedProjectId: secondary.id }, secondarySession = sessions.get(secondary.id);
      const file = path.join(secondary.path, "assets/style-baseline.png"); fs.copyFileSync(assets[0].path, file);
      const baseline = { ...assets[0], assetId: "style-baseline", occurrenceId: `occ-${"c".repeat(32)}`, path: file, relativePath: "assets/style-baseline.png" };
      secondarySession.nodes.push({ id: "style-node", type: "image", title: "已采用风格", assets: [baseline], imageState: "done" });
      let product = catalog.saveProduct({ ...base, expectedCatalogRevision: catalog.list(base).catalogRevision, title: "风格商品" }).product;
      const assigned = catalog.assignAssets({ ...base, expectedCatalogRevision: catalog.list(base).catalogRevision, expectedProductRevision: product.revision,
        productId: product.productId, kind: "result", role: "scene", assets: [{ nodeId: "style-node", assetIndex: 0 }] });
      product = assigned.product; const link = product.assets.find(value => value.assetId === baseline.assetId);
      catalog.updateResultState({ ...base, expectedCatalogRevision: assigned.catalogRevision, expectedProductRevision: product.revision,
        productId: product.productId, linkId: link.linkId, state: "approved" });
      knowledge.save({ ...base, expectedRevision: 0, entry: { type: "style_reference", title: "沿用已采用风格", content: "延续参考图的暖色光线", scope: { type: "project" }, source: "user", assetRefs: [targetOf(baseline)] } });
      const beforeModels = modelPosts.length, beforeImages = imagePosts.length;
      const styled = await command.prepare({ ...base, conversationId: "first", taskScope: emptyScope });
      assert.deepEqual(styled.knowledgeMaterials.map(targetOf), [targetOf(baseline)]);
      const withBaseline = normalizedTaskScope({ taskScope: bindProjectContextMaterials({ ...emptyScope, projectKnowledge: styled.projectKnowledge }, styled.knowledgeMaterials, "reference") });
      assert.deepEqual((await command.prepare({ ...base, conversationId: "first", taskScope: withBaseline })).knowledgeMaterials, []);
      assert.throws(() => bindProjectContextMaterials(withBaseline, styled.knowledgeMaterials, "source"), /另一用途冻结/);
      await assert.rejects(command.prepare({ ...base, conversationId: "first", taskScope: { ...emptyScope, origin: "goal" } }), { code: "GOAL_KNOWLEDGE_SCOPE_CONFLICT" });
      assert.equal(modelPosts.length, beforeModels); assert.equal(imagePosts.length, beforeImages);
    });
    await check("Runtime template schema and handler use the original Main and Renderer command owners with zero HTTP requests", async () => {
      const beforeModels = modelPosts.length, beforeImages = imagePosts.length, beforeScope = clone(originalScope);
      const libraryPath = path.join(root, "runtime-template-library.json");
      const library = createRequirementLibraryService({ libraryPath,
        readJson: (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback,
        writeJson: (file, value) => fs.writeFileSync(file, JSON.stringify(value)) });
      const saved = library.save({ title: "当前商品模板", text: "为{{headline}}整理横幅，使用{{product}}。", template: { version: 2, variables: [
        { key: "headline", type: "text", label: "标题", maxLength: 80 }, { key: "product", type: "image", label: "商品原图", role: "source" }
      ] } });
      const args = { operation: "apply_template", templateId: saved.entry.id, expectedTemplateRevision: saved.entry.revision,
        variableValues: { headline: "新项目商品" }, imageBindings: [{ key: "product", nodeId: "context-node-1", role: "source" }] };
      const schema = projectContextToolSchema().function.parameters;
      validateSchemaValue("project_context", schema, args);
      assert.deepEqual(schema.properties.imageBindings.items.required, ["key", "nodeId", "role"]);
      const owners = [], dispatched = [], applied = [];
      const renderer = {
        activeProjectId: () => project.id, activeConversationId: () => "first", workspaceDomain: () => "general",
        canvasRevision: () => 1, nodes: () => session().nodes, agentStatus: () => "idle", activeRunId: () => "", agentPaused: () => false,
        viewport: () => ({ x: 0, y: 0, zoom: 1 }), selection: () => ({ primaryId: "", ids: [] }), lockedNodeIds: () => [],
        useRequirementLibrary: input => {
          applied.push(clone(input));
          const result = library.apply({ id: input.templateId, expectedTemplateRevision: input.expectedTemplateRevision,
            variableValues: input.variableValues, imageBindings: input.imageBindings });
          return { ok: true, application: result.application };
        }
      };
      const templateCommand = createProjectContextCommandService({ knowledgeService: knowledge, resultIndex: index, readSession,
        locateOwner: async input => { owners.push(clone(input)); return "template-owner"; },
        dispatch: async (name, payload, owner) => { assert.equal(owner, "template-owner"); dispatched.push({ name, payload: clone(payload) }); return executeAutomationCommand(name, payload, renderer); } });
      const context = { projectId: project.id, conversationId: "first", taskId: original.taskId, taskScope: originalScope };
      const result = await runProjectContextTool(args, context, { service: templateCommand, requirementLibrary: library });
      assert.deepEqual(result.actions, [], "Template drafts must use the original requirement owner, never a filtered image-only workflow action.");
      assert.equal(result.value.ok, true); assert.match(result.value.application.text, /新项目商品/); assert.equal(result.value.application.unboundImages.length, 0);
      assert.deepEqual(owners, [{ projectId: project.id, conversationId: "first" }]);
      assert.equal(dispatched[0].name, "requirement-library.use"); assert.equal(dispatched[0].payload.conversationId, undefined);
      assert.deepEqual(dispatched[0].payload.inputBindings, [{ nodeId: "context-node-1", role: "source" }]);
      assert.deepEqual(applied[0].imageBindings, args.imageBindings); assert.equal(applied[0].expectedProjectId, project.id);
      const dispatchCount = dispatched.length;
      await assert.rejects(templateCommand.applyTemplate({ ...dispatched[0].payload, conversationId: "first", imageBindings: [{ key: "product", nodeId: "context-node-1", role: "invalid" }] }));
      assert.equal(dispatched.length, dispatchCount, "Invalid template bindings must fail before Main dispatch.");
      await assert.rejects(runProjectContextTool({ ...args, expectedTemplateRevision: 99 }, context, { service: templateCommand, requirementLibrary: library }), { code: "TEMPLATE_REVISION_CONFLICT" });
      await assert.rejects(templateCommand.applyTemplate({ ...dispatched[0].payload, expectedProjectId: projects[1].id, conversationId: "first" }), { code: "PROJECT_MISMATCH" });
      await assert.rejects(runProjectContextTool({ ...args, imageBindings: [{ key: "product", nodeId: "foreign-node", role: "source" }] }, context,
        { service: templateCommand, requirementLibrary: library }), { code: "NODE_NOT_FOUND" });
      assert.deepEqual(clone(originalScope), beforeScope); assert.equal(modelPosts.length, beforeModels); assert.equal(imagePosts.length, beforeImages);
      evidence.templateApplication = { schemaImageBindings: true, mainCommand: "requirement-library.use", originalRendererHandler: true,
        actualLibraryExpansion: true, actions: 0, localModelPosts: 0, localImagePosts: 0, staleVersionRejected: true, foreignProjectRejected: true, missingNodeRejected: true };
    });
    evidence.localModelPosts = modelPosts.length; evidence.localImagePosts = imagePosts.length; evidence.realModelRequests = 0;
    const report = { ok: true, checks, evidence, scope: "Main owners + durable task/session + shared hashes + actual local HTTP Responses and image edits; no GUI or real service claims" };
    fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, checks: checks.length, localModelPosts: modelPosts.length, localImagePosts: imagePosts.length, realModelRequests: 0, report: path.join(root, "report.json") }));
  } finally { await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, "failure.json"), JSON.stringify({ ok: false, checks, error: error.stack || String(error) }, null, 2)); console.error(error.stack || error); process.exitCode = 1; });
