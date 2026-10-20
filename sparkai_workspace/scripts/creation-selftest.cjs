"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const sharp = require("sharp");
const { createProjectCreationService, normalizeRequirements } = require("../desktop/project-creation-service.cjs");
const { createProjectCommerceCatalogService } = require("../desktop/project-commerce-catalog.cjs");
const { createImageObservationLedger, verifyObservationEvidence } = require("../runtime/image-observation-evidence.cjs");
const { createAgentTaskService } = require("../desktop/agent-task-service.cjs");
const { createCreationCommandService } = require("../desktop/creation-command-service.cjs");
const { createCreationMaskService } = require("../desktop/creation-mask-service.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");
const { mergeProjectSessions } = require("../desktop/project-session-merge.cjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparkai-creation-"));
const project = { id: "p", path: root, sessionPath: path.join(root, "session.json") };
const relative = (base, file) => path.relative(base, file || "").replace(/\\/g, "/");
const resolve = (base, file) => path.resolve(base, file);
const readSession = () => JSON.parse(fs.readFileSync(project.sessionPath, "utf8"));
const saveSession = session => fs.writeFileSync(project.sessionPath, JSON.stringify(sanitizeSession(session)));
const locator = { expectedProjectId: "p", conversationId: "c" };
const body = {
  goal: { text: "制作商品套图", source: "user" }, usage: { text: "用于商品详情页", source: "user" },
  slots: [{ slotId: "hero", label: "主图", source: "user" }, { slotId: "detail", label: "详情", source: "user" }],
  preserve: [{ criterionId: "shape", text: "保留主体外形", source: "user" }],
  adjustable: [{ criterionId: "background", text: "允许变换背景", source: "user" }],
  conditions: [{ criterionId: "text", text: "文字清晰", source: "assumption" }],
  fileRules: { width: 8, height: 8, formats: ["png"], alpha: "required" }
};
let cases = 0;
function check(name, run) { run(); cases++; process.stdout.write(`ok ${cases} ${name}\n`); }
async function asyncCheck(name, run) { await run(); cases++; process.stdout.write(`ok ${cases} ${name}\n`); }
const catalog = createProjectCommerceCatalogService({ getProjectById: id => id === "p" ? project : null,
  projectCommerceCatalogPath: p => path.join(p.path, ".naimage", "commerce-catalog.json"), projectRelativePath: relative,
  resolveProjectRelativePath: resolve, projectSessionFromDisk: readSession, readProjectList: () => ({ projects: [project] }) });
const serviceOptions = { projectFor: id => id === "p" ? project : null, readSession, catalogService: catalog,
  projectRelativePath: relative, resolveProjectRelativePath: resolve, verifyObservationEvidence };
let service = createProjectCreationService(serviceOptions);

async function main() {
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const secondImage = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const opaque = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const fake = image.subarray(0, image.length - 20);
  const assets = [image, secondImage, opaque, fake].map((bytes, index) => {
    const file = path.join(root, "assets", `${index}.png`); fs.writeFileSync(file, bytes);
    return { assetId: `asset-${index}`, occurrenceId: `occ-${String(index + 1).repeat(32)}`, contentHash: hash(bytes), relativePath: `assets/${index}.png`,
      path: file, type: "file", status: "done", width: 8, height: 8, generation: { version: 1, request: { model: "mock-image" } } };
  });
  const target = index => ({ assetId: assets[index].assetId, occurrenceId: assets[index].occurrenceId, contentHash: assets[index].contentHash });
  body.conditions.push({ criterionId: "source-style", text: "风格与来源图一致", source: "user", kind: "source_consistency", sourceTargets: [target(1)] });
  saveSession({ schemaVersion: 5, conversations: [{ id: "c", messages: [] }, { id: "c2", messages: [] }], activeConversationId: "c",
    nodes: assets.map((asset, index) => ({ id: `N${index + 1}`, title: `图${index + 1}`, type: "image", status: "done", assets: [asset] })) });
  const saved = service.updateRequirements({ ...locator, expectedRevision: 0, requirements: body });
  const ref = saved.requirementRef;
  const reqLocator = { ...locator, requirementId: ref.requirementId, expectedRevision: ref.revision };
  const attach = (index, slotId, creation = ref, extra = {}) => {
    const session = readSession(); session.nodes[index].taskProvenance = { version: 1, taskScopeSnapshotHash: `scope-${"a".repeat(32)}`, resultPolicy: "single",
      creation, creationSlotId: slotId, ...extra }; saveSession(session);
  };
  attach(0, "hero"); attach(1, "detail"); attach(2, "hero"); attach(3, "detail");
  check("stable slots survive source serialization and completion order", () => {
    const session = readSession(); session.nodes.reverse(); saveSession(session);
    const results = service.getAcceptance(reqLocator).results;
    assert.equal(results.find(result => result.target.assetId === assets[0].assetId).slotId, "hero");
    assert.equal(results.find(result => result.target.assetId === assets[1].assetId).slotId, "detail");
    assert.ok(results.every(result => result.generated && result.saved && !result.fileCheck && !result.visualReview && result.decision.state === "candidate"));
  });
  check("requirements CAS, source attribution and conversation isolation", () => {
    assert.throws(() => service.updateRequirements({ ...reqLocator, expectedRevision: 0, requirements: body }), { code: "CREATION_REQUIREMENTS_CONFLICT" });
    assert.throws(() => service.updateRequirements({ ...locator, expectedRevision: 1, requirements: { ...body, goal: { text: "missing source" } } }), { code: "CREATION_REQUIREMENTS_INVALID" });
    const second = service.requirementRefForTask({ ...locator, conversationId: "c2", prompt: "另一个任务" });
    assert.notEqual(second.requirementId, ref.requirementId);
    assert.equal(service.requirementsByRef({ projectId: "p", requirementRef: second }).goal.source, "user");
    assert.equal(service.getRequirements({ ...locator, conversationId: "c2", requirementId: ref.requirementId }).requirements, null);
  });
  await asyncCheck("A forces full decoding and checks dimensions, format and real alpha", async () => {
    const response = await service.checkResults({ ...reqLocator, targets: [target(0), target(1), target(2), target(3)] });
    assert.equal(response.results.find(result => result.target.assetId === assets[0].assetId).fileCheck.status, "passed");
    const alpha = response.results.find(result => result.target.assetId === assets[2].assetId);
    assert.equal(alpha.fileCheck.status, "failed"); assert.equal(alpha.fileCheck.issues[0].code, "FILE_ALPHA");
    const corrupt = response.results.find(result => result.target.assetId === assets[3].assetId);
    assert.equal(corrupt.fileCheck.status, "failed"); assert.equal(corrupt.fileCheck.issues[0].code, "FILE_DECODE_FAILED");
    assert.throws(() => service.decideResult({ ...reqLocator, target: target(2), decision: "adopt" }), { code: "CREATION_FILE_CHECK_REQUIRED" });
  });
  const proofFor = (index, requirementRef, additional = [], options = {}) => {
    const ledger = createImageObservationLedger({ projectId: "p", conversationId: "c", taskId: "", runId: "r", projectRoot: root });
    const observed = [index, ...additional];
    const messages = observed.map(value => {
      const modelImage = { dataUrl: `data:image/png;base64,${fs.readFileSync(assets[value].path).toString("base64")}`, sourceContentHash: assets[value].contentHash };
      ledger.stage({ imagePath: assets[value].path, modelImage, assets: [assets[value]], requirementRef });
      return { role: "user", content: [{ type: "input_image", image_url: modelImage.dataUrl }] };
    });
    if (options.consume !== false) ledger.consume(messages, { status: "completed", output: [] }, "round-2");
    return ledger.proofFor({ target: target(index), requirementId: requirementRef.requirementId, expectedRequirementsRevision: requirementRef.revision,
      sourceTargets: additional.map(target) });
  };
  check("B rejects forged or merely-returned pixel proof", () => {
    const review = { ...reqLocator, target: target(0), runId: "r", verdict: "pass", findings: body.preserve.concat(body.adjustable, body.conditions).map(value => ({ criterionId: value.criterionId, status: "pass", note: "ok" })) };
    assert.throws(() => service.recordReview({ ...review, observationEvidence: { ...target(0), modelRoundId: "fake" } }), { code: "CREATION_PIXELS_NOT_CONSUMED" });
    assert.throws(() => proofFor(0, ref, [], { consume: false }), /消费/);
    const proof = proofFor(0, ref);
    assert.throws(() => service.recordReview({ ...review, observationEvidence: JSON.parse(JSON.stringify(proof)) }), { code: "CREATION_PIXELS_NOT_CONSUMED" });
    assert.throws(() => service.recordReview({ ...review, observationEvidence: proof }), { code: "CREATION_PIXELS_NOT_CONSUMED" }, "target-only pixels cannot prove source consistency");
    const response = service.recordReview({ ...review, observationEvidence: proofFor(0, ref, [1]), verdict: "revise", findings: review.findings.map((value, index) => ({ ...value, status: index ? "pass" : "fail" })) });
    assert.equal(response.results.find(value => value.target.assetId === assets[0].assetId).visualReview.verdict, "revise");
  });
  check("C adoption reuses catalog state without rewriting AI findings", () => {
    const response = service.decideResult({ ...reqLocator, target: target(0), decision: "adopt", reason: "用户接受这个方向" });
    const result = response.results.find(value => value.target.assetId === assets[0].assetId);
    assert.equal(result.decision.state, "approved"); assert.equal(result.visualReview.verdict, "revise"); assert.equal(result.fileCheck.status, "passed");
    const stored = JSON.parse(fs.readFileSync(path.join(root, ".naimage", "creation.json"), "utf8"));
    assert.equal(stored.results.some(value => "approved" in value || "state" in value), false);
    const product = catalog.list(locator).catalog.products[0]; assert.equal(product.assets[0].state, "approved");
    assert.equal(product.assets[0].occurrenceId, target(0).occurrenceId);
  });
  check("catalog and A/B approvals cannot bypass hard file checks", () => {
    const session = readSession(), index = session.nodes.findIndex(node => node.assets[0].assetId === assets[2].assetId);
    const link = catalog.ensureCreationResult({ ...locator, nodeId: session.nodes[index].id, assetIndex: 0, target: target(2), role: "hero" });
    assert.throws(() => catalog.updateResultState({ ...locator, expectedCatalogRevision: link.catalogRevision, expectedProductRevision: link.product.revision,
      productId: link.product.productId, linkId: link.asset.linkId, state: "approved" }), { code: "CREATION_FILE_CHECK_REQUIRED" });
    const group = catalog.listComparisons(locator).groups[0]; assert.ok(group);
    const current = catalog.list(locator);
    assert.throws(() => catalog.selectComparisonWinner({ ...locator, expectedCatalogRevision: current.catalogRevision,
      expectedProductRevision: current.catalog.products[0].revision, productId: current.catalog.products[0].productId,
      groupKey: group.groupKey, winnerLinkId: link.asset.linkId }), { code: "CREATION_FILE_CHECK_REQUIRED" });
  });
  check("moving and renaming preserve evidence, replacing bytes invalidates it", () => {
    const session = readSession(), node = session.nodes.find(value => value.assets[0].assetId === assets[0].assetId);
    node.title = "用户改名"; node.x = 900; node.y = 800; saveSession(session);
    const result = service.getAcceptance(reqLocator).results.find(value => value.target.assetId === assets[0].assetId);
    assert.equal(result.current, true); assert.equal(result.visualReview.verdict, "revise");
    fs.writeFileSync(assets[1].path, opaque);
    const sourceChanged = service.getAcceptance(reqLocator).results.find(value => value.target.assetId === assets[0].assetId);
    assert.equal(sourceChanged.current, false); assert.ok(sourceChanged.invalidReasons.includes("source-changed-or-unavailable"));
    fs.writeFileSync(assets[1].path, secondImage);
    fs.writeFileSync(assets[0].path, opaque);
    assert.equal(service.getAcceptance(reqLocator).results.find(value => value.target.assetId === assets[0].assetId).current, false);
    assert.throws(() => service.decideResult({ ...reqLocator, target: target(0), decision: "adopt" }), { code: "CREATION_TARGET_STALE" });
    fs.writeFileSync(assets[0].path, image);
  });
  check("revision is atomic, per target, slot-bound and idempotent", () => {
    const input = { ...reqLocator, submissionId: "rev-1", targets: [{ ...target(0), changes: ["改为蓝色背景"] }, { ...target(1), changes: ["降低文字密度"] }],
      preserve: ["保留主体外观"], changes: [] };
    const revision = service.resolveRevision(input), again = service.resolveRevision(input);
    assert.equal(revision.requirementRef.revision, 2); assert.deepEqual(again.plan, revision.plan); assert.equal(again.duplicate, true);
    assert.equal(revision.targets[0].slotId, "hero"); assert.equal(revision.targets[1].slotId, "detail");
    const requirements = service.requirementsByRef({ projectId: "p", requirementRef: revision.requirementRef });
    assert.deepEqual(requirements.conditions.find(value => value.text === "改为蓝色背景").slotIds, ["hero"]);
    assert.deepEqual(requirements.conditions.find(value => value.text === "降低文字密度").slotIds, ["detail"]);
    assert.equal(service.getAcceptance(reqLocator).results.find(value => value.target.assetId === assets[0].assetId).current, false);
    assert.throws(() => service.resolveRevision({ ...input, changes: ["另一个修改"] }), { code: "CREATION_REVISION_CONFLICT" });
    assert.doesNotThrow(() => service.validateTaskContract({ ...locator, creation: { ...revision.requirementRef, revisionPlan: revision.plan } }));
    assert.throws(() => service.validateTaskContract({ ...locator, creation: { ...revision.requirementRef, revisionPlan: { ...revision.plan, changes: ["伪造"] } } }), { code: "CREATION_REVISION_CONFLICT" });
    fs.writeFileSync(assets[0].path, opaque);
    assert.deepEqual(service.resolveRevision(input).plan, revision.plan, "same submission after drift returns original receipt material without regenerating");
    fs.writeFileSync(assets[0].path, image);
  });
  check("fresh process reads complete requirements and original review", () => {
    const code = `const fs=require('node:fs');const {createProjectCreationService}=require(process.argv[1]);const p=JSON.parse(process.argv[2]);const s=createProjectCreationService({projectFor:()=>p,readSession:()=>JSON.parse(fs.readFileSync(p.sessionPath)),projectRelativePath:()=>'',resolveProjectRelativePath:()=>''});const r=s.getRequirements({projectId:p.id,conversationId:'c'});if(r.requirements.revision!==2||r.requirements.goal.text!=='制作商品套图')process.exit(2);process.stdout.write('persisted');`;
    const child = spawnSync(process.execPath, ["-e", code, path.resolve(__dirname, "../desktop/project-creation-service.cjs"), JSON.stringify(project)], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, "persisted");
    service = createProjectCreationService(serviceOptions);
    assert.equal(service.getAcceptance(locator).results.find(value => value.target.assetId === assets[0].assetId).visualReview.verdict, "revise");
  });
  check("two stale renderer session saves cannot roll back Main's contract", () => {
    const before = fs.readFileSync(path.join(root, ".naimage", "creation.json"));
    const staleA = { ...readSession(), creation: { requirements: [body] }, sessionRevision: 1 };
    const staleB = { ...readSession(), creation: { requirements: [] }, sessionRevision: 0 };
    saveSession(mergeProjectSessions(readSession(), staleA, { nextRevision: 20 }).session);
    saveSession(mergeProjectSessions(readSession(), staleB, { nextRevision: 21 }).session);
    assert.equal("creation" in readSession(), false); assert.deepEqual(fs.readFileSync(path.join(root, ".naimage", "creation.json")), before);
    assert.equal(service.getRequirements(locator).requirements.revision, 2);
  });
  await asyncCheck("task ledger preflights requirements before owner writes and freezes material/config", async () => {
    let taskService, runs = 0;
    const linkedOperations = [];
    const taskInput = { ...locator, submissionId: "task-1", prompt: "继续此创作" };
    const currentRef = service.getRequirements(locator).requirementRef;
    const frozen = { snapshotHash: "scope-one", sourceNodeIds: [], sourceAssets: [], referenceAssets: [], imageConfig: { model: "mock", models: ["mock"], ratio: "1:1" }, creation: currentRef };
    taskService = createAgentTaskService({ projectFor: () => project, readSession, operations: () => linkedOperations,
      creationRequirements: input => service.requirementRefForTask(input),
      validateCreationScope: input => service.validateTaskContract({ ...input, creation: input.taskScope.creation }),
      locateOwner: async () => "owner", dispatch: async (command, args) => {
        runs++; const runId = `run-${runs}`;
        taskService.admit({ ...args, runId, taskScope: { ...frozen, creation: args.creation || frozen.creation } }, "owner"); taskService.claimRun({ ...args, runId }, "owner");
      } });
    const accepted = await taskService.execute("agent.task.start", taskInput), task = accepted.task;
    assert.equal(taskService.assertStartAvailable(taskInput).duplicate, true);
    assert.throws(() => taskService.assertStartAvailable({ ...taskInput, submissionId: "other-intent" }), { code: "TASK_BUSY" });
    assert.equal(task.requirementRef.revision, 2);
    const mutableInput = { projectId: "p", conversationId: "c", taskId: task.taskId, runId: "run-1", previousRef: currentRef };
    const beforePreflight = fs.readFileSync(path.join(root, ".naimage", "creation.json"));
    assert.deepEqual(taskService.assertRequirementsMutable(mutableInput), { ok: true });
    assert.throws(() => taskService.assertRequirementsMutable({ ...mutableInput, runId: "other-run" }), { code: "TASK_CREATION_CONFLICT" });
    assert.throws(() => taskService.assertRequirementsMutable({ ...mutableInput, previousRef: { ...currentRef, revision: currentRef.revision + 1 } }), { code: "TASK_CREATION_CONFLICT" });
    assert.throws(() => taskService.assertRequirementsMutable({ ...mutableInput, previousRef: { ...currentRef, fingerprint: `creation-${"0".repeat(64)}` } }), { code: "TASK_CREATION_CONFLICT" });
    linkedOperations.push({ agentTaskId: task.taskId, runId: "image-child-run" });
    assert.throws(() => taskService.assertRequirementsMutable(mutableInput), { code: "TASK_CREATION_LOCKED" }, "A task-associated image operation blocks mutation even before the progress projection arrives");
    linkedOperations[0] = { runId: "run-1" };
    assert.throws(() => taskService.assertRequirementsMutable(mutableInput), { code: "TASK_CREATION_LOCKED" }, "Original run association independently blocks late requirements mutation");
    linkedOperations.length = 0;
    assert.deepEqual(fs.readFileSync(path.join(root, ".naimage", "creation.json")), beforePreflight, "All preflight rejections leave the authoritative requirements bytes unchanged");
    const next = service.updateRequirements({ ...locator, expectedRevision: 2, requirements: { ...service.getRequirements(locator).requirements, usage: { text: "改为详情页长图", source: "user" } } });
    const advance = { projectId: "p", conversationId: "c", taskId: task.taskId, runId: "run-1", previousRef: currentRef,
      requirementRef: next.requirementRef, taskScope: { ...frozen, snapshotHash: "scope-two", creation: next.requirementRef } };
    assert.throws(() => taskService.advanceRequirements({ ...advance, taskScope: { ...advance.taskScope, imageConfig: { model: "other" } } }), { code: "TASK_SCOPE_CONFLICT" });
    taskService.advanceRequirements(advance);
    assert.throws(() => taskService.assertRequirementsMutable(mutableInput), { code: "TASK_CREATION_CONFLICT" }, "Old refs cannot pass preflight after a successful refinement");
    assert.deepEqual(taskService.assertRequirementsMutable({ ...mutableInput, previousRef: next.requirementRef }), { ok: true });
    await assert.rejects(taskService.execute("agent.task.start", { ...taskInput, requirementId: next.requirementRef.requirementId,
      expectedRequirementsRevision: next.requirementRef.revision }), { code: "TASK_SUBMISSION_CONFLICT" });
    taskService.progress("p", "run-1", { phase: "image-request" });
    const lockedCreation = fs.readFileSync(path.join(root, ".naimage", "creation.json"));
    assert.throws(() => taskService.assertRequirementsMutable({ ...mutableInput, previousRef: next.requirementRef }), { code: "TASK_CREATION_LOCKED" });
    assert.throws(() => taskService.advanceRequirements({ ...advance, previousRef: next.requirementRef }), { code: "TASK_CREATION_LOCKED" });
    assert.deepEqual(fs.readFileSync(path.join(root, ".naimage", "creation.json")), lockedCreation);
    const bytes = fs.readFileSync(path.join(root, ".naimage", "agent", "tasks.json"), "utf8");
    assert.equal(bytes.includes("制作商品套图"), false); assert.equal(bytes.includes("降低文字密度"), false);
    assert.equal((await taskService.execute("agent.task.start", taskInput)).task.taskId, task.taskId); assert.equal(runs, 1);
    const pendingFile = path.join(root, "output", "imagegen", "pending.png"); fs.mkdirSync(path.dirname(pendingFile), { recursive: true }); fs.writeFileSync(pendingFile, image);
    const pendingAsset = { assetId: "pending-result", occurrenceId: `occ-${"d".repeat(32)}`, contentHash: hash(image), relativePath: "output/imagegen/pending.png",
      path: pendingFile, type: "file", status: "done", width: 8, height: 8 };
    const pendingTarget = { assetId: pendingAsset.assetId, occurrenceId: pendingAsset.occurrenceId, contentHash: pendingAsset.contentHash };
    const pendingService = createProjectCreationService({ ...serviceOptions, resolveSavedResult: payload => payload.taskId === task.taskId && payload.target.assetId === pendingAsset.assetId
      ? { asset: pendingAsset, node: { id: "", title: "已生成成果", type: "image", assets: [pendingAsset] } } : null });
    pendingService.setTaskResolver((projectId, taskId, conversationId) => taskService.get({ expectedProjectId: projectId, taskId, conversationId }).task);
    const pendingInput = { ...locator, taskId: task.taskId, expectedRevision: next.requirementRef.revision, slotId: "hero" };
    await pendingService.checkResults({ ...pendingInput, targets: [pendingTarget] });
    const ledger = createImageObservationLedger({ projectId: "p", conversationId: "c", taskId: task.taskId, runId: "run-1", projectRoot: root });
    const messages = [pendingAsset, assets[1]].map(asset => {
      const modelImage = { dataUrl: `data:image/png;base64,${fs.readFileSync(asset.path).toString("base64")}`, sourceContentHash: asset.contentHash };
      ledger.stage({ imagePath: asset.path, modelImage, assets: [asset], requirementRef: next.requirementRef });
      return { role: "user", content: [{ type: "input_image", image_url: modelImage.dataUrl }] };
    });
    ledger.consume(messages, { status: "completed", output: [] }, "pending-round");
    const latest = service.requirementsByRef({ projectId: "p", requirementRef: next.requirementRef });
    const findings = [...latest.preserve, ...latest.adjustable, ...latest.conditions].filter(value => !value.slotIds?.length || value.slotIds.includes("hero"))
      .map(value => ({ criterionId: value.criterionId, status: "pass", note: "本地Mock观察" }));
    const review = { ...pendingInput, runId: "run-1", target: pendingTarget, verdict: "pass", findings,
      observationEvidence: ledger.proofFor({ target: pendingTarget, requirementId: next.requirementRef.requirementId,
        expectedRequirementsRevision: next.requirementRef.revision, sourceTargets: [target(1)] }) };
    const pendingReview = pendingService.recordReview(review).results.find(value => value.target.assetId === pendingAsset.assetId);
    assert.equal(pendingReview.visualReview.verdict, "pass"); assert.equal(pendingReview.generated, true); assert.equal(pendingReview.fileSaved, true);
    assert.equal(pendingReview.saved, false); assert.equal(pendingReview.inProject, false);
    assert.throws(() => pendingService.decideResult({ ...pendingInput, target: pendingTarget, decision: "adopt" }), { code: "CREATION_TARGET_STALE" });
    const creationPath = path.join(root, ".naimage", "creation.json"), before = fs.readFileSync(creationPath), rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (to === creationPath) throw Object.assign(new Error("injected disk failure"), { code: "EIO" }); return rename(from, to); };
    try { assert.throws(() => pendingService.recordReview(review), error => error.creationPersistenceFailed === true && error.phase === "creation_save"); }
    finally { fs.renameSync = rename; }
    assert.deepEqual(fs.readFileSync(creationPath), before, "failed evidence write preserves the last authoritative review");
    taskService.stopScope({ projectId: "p", conversationId: "c" }, "owner");
    assert.throws(() => taskService.assertRequirementsMutable({ ...mutableInput, previousRef: next.requirementRef }), { code: "TASK_CREATION_CONFLICT" }, "A stopped task cannot revise requirements through an old run");
    const commandService = createCreationCommandService({ creationService: service, taskService });
    const revisionInput = { ...locator, requirementId: next.requirementRef.requirementId, expectedRevision: next.requirementRef.revision,
      submissionId: "queued-revision", targets: [{ ...target(0), changes: ["仅主图改为淡蓝色"] }], preserve: [], changes: [] };
    const queued = await Promise.all([commandService.execute("creation.revision.start", revisionInput), commandService.execute("creation.revision.start", revisionInput)]);
    assert.equal(queued[0].task.taskId, queued[1].task.taskId); assert.equal(runs, 2, "queued duplicate reaches the original task without a new dispatch");
    assert.equal(service.getRequirements(locator).requirements.revision, 4, "duplicate queued revision increments the contract exactly once");
    await assert.rejects(commandService.execute("creation.revision.start", { ...revisionInput, submissionId: "while-busy", expectedRevision: 4 }), { code: "TASK_BUSY" });
    assert.equal(service.getRequirements(locator).requirements.revision, 4, "busy revision must not alter active creation requirements");
  });
  await asyncCheck("GUI structured-clone undefined optionals use the public JSON contract", async () => {
    const commandService = createCreationCommandService({ creationService: service, taskService: {} });
    const revision = service.getRequirements(locator).requirementRef.revision;
    const updated = await commandService.execute("creation.requirements.update", { ...locator, expectedRevision: revision,
      requirements: { ...body, fileRules: { width: undefined, height: undefined, minWidth: undefined, minHeight: undefined, formats: [], alpha: undefined } } });
    assert.equal(updated.requirementRef.revision, revision + 1); assert.equal(updated.requirements.fileRules, undefined);
    await assert.rejects(commandService.execute("creation.requirements.update", { ...locator, expectedRevision: revision + 1,
      requirements: { ...body, fileRules: { width: "invalid" } } }), { code: "INVALID_ARGUMENT" });
    await assert.rejects(commandService.execute("creation.requirements.get", { ...locator, apiKey: "unexpected" }), { code: "INVALID_ARGUMENT" });
  });
  await asyncCheck("revision inherits original frozen config, exact references and parent receipts despite live drift", async () => {
    const originRoot = path.join(root, "revision-context"); fs.mkdirSync(path.join(originRoot, "assets"), { recursive: true });
    const originProject = { id: "p", path: originRoot };
    const originAssets = assets.slice(0, 3).map((asset, index) => {
      const file = path.join(originRoot, "assets", `${index}.png`); fs.copyFileSync(asset.path, file);
      return { ...asset, path: file, relativePath: `assets/${index}.png` };
    });
    const originSession = { activeConversationId: "c", conversations: [{ id: "c" }, { id: "other" }],
      nodes: originAssets.map((asset, index) => ({ id: `origin-${index}`, type: "image", assets: [asset] })) };
    const originOptions = { projectFor: () => originProject, readSession: () => originSession, projectRelativePath: relative, resolveProjectRelativePath: resolve };
    const originCreation = createProjectCreationService(originOptions);
    const originalRef = originCreation.updateRequirements({ ...locator, expectedRevision: 0, requirements: body }).requirementRef;
    for (const [index, node] of originSession.nodes.entries()) node.taskProvenance = { version: 1, creation: originalRef, creationSlotId: index === 1 ? "detail" : "hero" };
    const originalConfig = { model: "mock-original", models: ["mock-original"], ratio: "3:2", resolution: "2K", quality: "high", count: 7,
      outputFormat: "webp", configs: [{ model: "mock-original", protocol: "images", gateway: "custom", transportMode: "direct", capabilities: { edit: true } }], bindings: [] };
    const originalReferences = [{ ...target(2), nodeId: "origin-2", role: "reference" }];
    let liveConfig = originalConfig, originTasks, dispatched, dispatchCount = 0;
    const operationList = [];
    const originTaskOptions = { ...originOptions, operations: () => operationList, locateOwner: async () => "owner",
      creationRequirements: input => originCreation.requirementRefForTask(input),
      validateCreationScope: input => originCreation.validateTaskContract({ ...input, creation: input.taskScope.creation }),
      dispatch: async (command, args) => {
        dispatchCount++; dispatched = args;
        const runId = `origin-run-${dispatchCount}`;
        originTasks.admit({ ...args, runId, taskScope: { snapshotHash: `origin-scope-${dispatchCount}`,
          sourceNodeIds: args.sourceNodeIds || [], sourceAssets: [], referenceAssets: args.referenceAssets || originalReferences,
          imageConfig: args.imageConfig || liveConfig, creation: args.creation || originCreation.getRequirements(locator).requirementRef } }, "owner");
        originTasks.claimRun({ ...args, runId }, "owner");
      } };
    originTasks = createAgentTaskService(originTaskOptions);
    const first = (await originTasks.execute("agent.task.start", { ...locator, submissionId: "original-a", prompt: "原图A" })).task;
    operationList.push({ agentTaskId: first.taskId, runId: "child-original-a", key: "origin-a", state: "saved",
      assets: [{ assetId: originAssets[0].assetId, occurrenceId: originAssets[0].occurrenceId, path: originAssets[0].path }] });
    assert.equal(originTasks.get({ ...locator, taskId: first.taskId }).task.results[0].contentHash, target(0).contentHash);
    originTasks.stopScope(locator, "owner");
    liveConfig = { ...originalConfig, count: 11 };
    const second = (await originTasks.execute("agent.task.start", { ...locator, submissionId: "original-b", prompt: "原图B" })).task;
    originAssets[1].runId = second.currentRunId; // A legacy result without a journal result can still identify its producing run.
    originTasks.stopScope(locator, "owner");
    liveConfig = { ...originalConfig, model: "changed-live-model", models: ["changed-live-model"], ratio: "1:1", resolution: "1K", quality: "low" };
    const context = originTasks.revisionContext({ ...locator, targets: [target(0), target(1)] });
    assert.equal(context.imageConfig.model, originalConfig.model); assert.equal(context.imageConfig.ratio, "3:2");
    assert.equal(context.imageConfig.resolution, "2K"); assert.equal(context.imageConfig.quality, "high"); assert.equal(context.imageConfig.count, 1);
    assert.deepEqual(context.parentTaskIds, [first.taskId, second.taskId]); assert.deepEqual(context.referenceAssets, originalReferences);
    assert.doesNotMatch(JSON.stringify(context), /relativePath|"path"|apiKey|https?:\/\//);
    const wrapper = createCreationCommandService({ creationService: originCreation, taskService: originTasks });
    const revisionInput = { ...locator, requirementId: originalRef.requirementId, expectedRevision: 1, submissionId: "origin-revision",
      targets: [{ ...target(0), changes: ["仅调整背景"] }, { ...target(1), changes: ["仅调整文字"] }], preserve: ["保留主体"], changes: [] };
    const revised = await wrapper.execute("creation.revision.start", revisionInput);
    assert.equal(dispatched.imageConfig.count, 1); assert.equal(revised.task.scope.imageConfig.model, originalConfig.model);
    assert.deepEqual(revised.task.parentTaskIds, [first.taskId, second.taskId]); assert.deepEqual(dispatched.referenceAssets, originalReferences);
    const beforeDuplicate = dispatchCount;
    originAssets[0].contentHash = "e".repeat(64); originAssets[2].contentHash = "f".repeat(64);
    const duplicate = await wrapper.execute("creation.revision.start", revisionInput);
    assert.equal(duplicate.task.taskId, revised.task.taskId); assert.equal(dispatchCount, beforeDuplicate);
    originAssets[0].contentHash = target(0).contentHash; originAssets[2].contentHash = target(2).contentHash;
    originTasks.stopScope(locator, "owner");
    // A different source configuration must be refused before resolving a new requirements revision.
    const third = (await originTasks.execute("agent.task.start", { ...locator, submissionId: "original-c", prompt: "不同配置原图" })).task;
    originAssets[2].runId = third.currentRunId; originTasks.stopScope(locator, "owner");
    await assert.rejects(wrapper.execute("creation.revision.start", { ...revisionInput, submissionId: "mixed-config", expectedRevision: 2,
      targets: [{ ...target(0), changes: ["调整背景"] }, { ...target(2), changes: ["调整背景"] }] }), { code: "CREATION_REVISION_CONFIG_CONFLICT" });
    assert.equal(originCreation.getRequirements(locator).requirementRef.revision, 2);
    const legacyAsset = { ...originAssets[0], assetId: "legacy-asset", occurrenceId: `occ-${"b".repeat(32)}`, runId: undefined };
    originSession.nodes.push({ id: "legacy-node", type: "image", assets: [legacyAsset], taskProvenance: { version: 1, creation: originalRef, creationSlotId: "hero" } });
    const legacyTarget = { assetId: legacyAsset.assetId, occurrenceId: legacyAsset.occurrenceId, contentHash: legacyAsset.contentHash };
    assert.equal(originTasks.revisionContext({ ...locator, targets: [legacyTarget] }), null);
    const legacy = await wrapper.execute("creation.revision.start", { ...revisionInput, submissionId: "legacy-revision", expectedRevision: 2,
      targets: [{ ...legacyTarget, changes: ["调整背景"] }] });
    assert.equal(dispatched.imageConfig, undefined); assert.equal(legacy.task.scope.imageConfig.model, liveConfig.model);
    assert.equal(legacy.task.parentTaskIds, undefined); originTasks.stopScope(locator, "owner");
    originAssets[2].contentHash = "f".repeat(64);
    assert.throws(() => originTasks.revisionContext({ ...locator, targets: [target(0)] }), { code: "CREATION_REVISION_REFERENCE_STALE" });
    originAssets[2].contentHash = target(2).contentHash;
    originTasks = createAgentTaskService(originTaskOptions);
    assert.deepEqual(originTasks.get({ ...locator, taskId: revised.task.taskId }).task.parentTaskIds, [first.taskId, second.taskId]);
  });
  await asyncCheck("managed regional mask freezes one exact target and survives duplicate receipt lookup", async () => {
    const maskRoot = path.join(root, "mask-contract"); fs.mkdirSync(path.join(maskRoot, "assets"), { recursive: true });
    const maskProject = { id: "p", path: maskRoot };
    const sourceFile = path.join(maskRoot, "assets", "source.png"); fs.writeFileSync(sourceFile, image);
    const source = { ...assets[0], path: sourceFile, relativePath: "assets/source.png" };
    const maskSession = { activeConversationId: "c", conversations: [{ id: "c" }], nodes: [{ id: "mask-source", title: "原成果", type: "image", assets: [source] }] };
    const maskOptions = { projectFor: () => maskProject, readSession: () => maskSession, projectRelativePath: relative, resolveProjectRelativePath: resolve };
    const maskService = createCreationMaskService({ ...maskOptions, sharp });
    const maskCreation = createProjectCreationService(maskOptions);
    maskCreation.setMaskResolver(input => maskService.resolve(input));
    const requirements = maskCreation.updateRequirements({ ...locator, expectedRevision: 0,
      requirements: { goal: { text: "局部调整", source: "user" }, usage: { text: "成果修订", source: "user" },
        slots: [{ slotId: "mask-output", label: "展示图", source: "user" }], preserve: [], adjustable: [], conditions: [] } });
    maskSession.nodes[0].taskProvenance = { version: 1, creation: requirements.requirementRef, creationSlotId: "mask-output" };
    const savedMask = await maskService.save({ ...locator, target: target(0), dataUrl: `data:image/png;base64,${image.toString("base64")}` });
    const frozenMask = maskService.freeze({ ...locator, targets: [{ ...target(0), mask: savedMask.mask }] });
    assert.equal(frozenMask.length, 1); assert.equal(frozenMask[0].width, 8); assert.equal(frozenMask[0].height, 8);
    const revisionInput = { ...locator, requirementId: requirements.requirementRef.requirementId, expectedRevision: 1, submissionId: "masked-revision",
      targets: [{ ...target(0), mask: savedMask.mask, changes: ["只修改涂抹区域背景"] }], preserve: ["保留主体"], changes: [] };
    assert.throws(() => maskCreation.resolveRevision({ ...revisionInput, targets: [...revisionInput.targets, { ...target(1), changes: ["调整"] }] }), { code: "CREATION_MASK_SINGLE_TARGET" });
    assert.throws(() => maskCreation.resolveRevision({ ...revisionInput, targets: [{ ...target(1), mask: savedMask.mask, changes: ["调整"] }] }), { code: "CREATION_MASK_IDENTITY_INVALID" });
    assert.equal(maskCreation.getRequirements(locator).requirementRef.revision, 1);
    let maskTasks, maskDispatches = 0, lastDispatch;
    maskTasks = createAgentTaskService({ ...maskOptions, creationRequirements: input => maskCreation.requirementRefForTask(input),
      validateCreationScope: input => maskCreation.validateTaskContract({ ...input, creation: input.taskScope.creation }),
      locateOwner: async () => "mask-owner", dispatch: async (command, args) => {
        maskDispatches++; lastDispatch = args;
        maskTasks.admit({ ...args, runId: "mask-run", taskScope: { snapshotHash: "scope-masked", sourceNodeIds: args.sourceNodeIds, sourceAssets: [], referenceAssets: [],
          maskAssets: args.maskAssets, imageConfig: { model: "mock-mask", count: 1 }, creation: args.creation } }, "mask-owner");
        maskTasks.claimRun({ ...args, runId: "mask-run" }, "mask-owner");
      } });
    const wrapper = createCreationCommandService({ creationService: maskCreation, taskService: maskTasks, maskService });
    const accepted = await wrapper.execute("creation.revision.start", revisionInput);
    assert.deepEqual(accepted.task.scope.maskAssets, [{ ...savedMask.mask, target: target(0) }]);
    assert.deepEqual(lastDispatch.maskAssets[0].target, target(0)); assert.equal(lastDispatch.maskAssets[0].width, 8);
    const durable = JSON.parse(fs.readFileSync(path.join(maskRoot, ".naimage", "creation.json"), "utf8"));
    assert.deepEqual(durable.revisions[0].result.plan.targets[0].mask, savedMask.mask);
    assert.doesNotMatch(JSON.stringify(durable), /relativePath|"path"|data:image/);
    assert.doesNotMatch(fs.readFileSync(path.join(maskRoot, ".naimage", "agent", "tasks.json"), "utf8"), /relativePath|"path"|data:image/);
    fs.unlinkSync(frozenMask[0].path);
    const duplicate = await wrapper.execute("creation.revision.start", revisionInput);
    assert.equal(duplicate.task.taskId, accepted.task.taskId); assert.equal(maskDispatches, 1);
    await assert.rejects(wrapper.execute("creation.revision.start", { ...revisionInput, targets: [{ ...revisionInput.targets[0], mask: { ...savedMask.mask, contentHash: "f".repeat(64) } }] }), { code: "CREATION_REVISION_CONFLICT" });
    assert.equal(maskCreation.getRequirements(locator).requirementRef.revision, 2);
    const currentRef = maskCreation.getRequirements(locator).requirementRef;
    const newSource = { ...source, assetId: "masked-new-result", occurrenceId: `occ-${"e".repeat(32)}` };
    maskSession.nodes.push({ id: "new-result", title: "修订成果", type: "image", assets: [newSource], taskProvenance: { version: 1, creation: currentRef,
      creationSlotId: "mask-output", sourceAssetId: source.assetId, sourceOccurrenceId: source.occurrenceId, sourceContentHash: source.contentHash } });
    maskSession.nodes.shift();
    const acceptance = maskCreation.getAcceptance(locator);
    assert.equal(acceptance.results.find(result => result.target.assetId === source.assetId).label, "展示图", "Unavailable historical result uses its human slot label");
    assert.equal(acceptance.results.find(result => result.target.assetId === newSource.assetId).baseline.label, "历史成果");
  });
  await asyncCheck("8MiB capacity failure preserves records and cannot hand off a revision task", async () => {
    const capacityRoot = path.join(root, "capacity-contract"); fs.mkdirSync(path.join(capacityRoot, "assets"), { recursive: true });
    const capacityProject = { id: "p", path: capacityRoot };
    const sourceFile = path.join(capacityRoot, "assets", "source.png"); fs.writeFileSync(sourceFile, image);
    const source = { ...assets[0], path: sourceFile, relativePath: "assets/source.png" };
    const session = { activeConversationId: "c", conversations: [{ id: "c" }], nodes: [{ id: "capacity-source", type: "image", assets: [source] }] };
    const options = { projectFor: () => capacityProject, readSession: () => session, projectRelativePath: relative, resolveProjectRelativePath: resolve };
    const capacityCreation = createProjectCreationService(options);
    const requirements = { goal: { text: "Create a saved result", source: "user" }, usage: { text: "Inspect", source: "user" },
      slots: [{ slotId: "hero", label: "Hero", source: "user" }], preserve: [], adjustable: [], conditions: [] };
    const initialRef = capacityCreation.updateRequirements({ ...locator, expectedRevision: 0, requirements }).requirementRef;
    const file = path.join(capacityRoot, ".naimage", "creation.json"), initial = JSON.parse(fs.readFileSync(file, "utf8"));
    // A real, valid historical requirement fills the store; the current version
    // stays small so later failures exercise persistence rather than input size.
    const history = { ...requirements, goal: { text: "A".repeat(200_000), source: "user" }, usage: { text: "B".repeat(200_000), source: "user" },
      conditions: [...Array.from({ length: 39 }, (_, index) => ({ criterionId: `history-${index}`, text: "C".repeat(200_000), source: "user", kind: "visual" })),
        { criterionId: "history-tail", text: "D", source: "user", kind: "visual" }] };
    const version = (value, revision) => {
      const normalized = normalizeRequirements(value);
      return { requirementId: initialRef.requirementId, conversationId: "c", revision, fingerprint: `creation-${hash(JSON.stringify(normalized))}`,
        ...normalized, updatedAt: new Date().toISOString() };
    };
    const limit = 8 * 1024 * 1024;
    const projected = Buffer.byteLength(JSON.stringify({ ...initial, requirements: [...initial.requirements, version(history, 2), version(requirements, 3)] }));
    const tailLength = 1 + limit - 100 - projected;
    assert.ok(tailLength > 0 && tailLength <= 200_000);
    history.conditions.at(-1).text = "D".repeat(tailLength);
    capacityCreation.updateRequirements({ ...locator, expectedRevision: 1, requirements: history });
    const currentRef = capacityCreation.updateRequirements({ ...locator, expectedRevision: 2, requirements }).requirementRef;
    session.nodes[0].taskProvenance = { version: 1, creation: currentRef, creationSlotId: "hero" };
    const before = fs.readFileSync(file);
    assert.equal(before.length, limit - 100);
    const persistenceFailure = { code: "CREATION_STORE_FULL", creationPersistenceFailed: true, phase: "creation_save" };
    await assert.rejects(capacityCreation.checkResults({ ...locator, requirementId: currentRef.requirementId, expectedRevision: currentRef.revision,
      target: target(0), slotId: "hero" }), persistenceFailure);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.throws(() => capacityCreation.updateRequirements({ ...locator, expectedRevision: currentRef.revision,
      requirements: { ...requirements, usage: { text: "A new usage", source: "user" } } }), persistenceFailure);
    assert.deepEqual(fs.readFileSync(file), before);
    let dispatches = 0;
    const tasks = createAgentTaskService({ ...options, creationRequirements: input => capacityCreation.requirementRefForTask(input),
      validateCreationScope: input => capacityCreation.validateTaskContract({ ...input, creation: input.taskScope.creation }),
      locateOwner: async () => "capacity-owner", dispatch: async () => { dispatches++; } });
    const wrapper = createCreationCommandService({ creationService: capacityCreation, taskService: tasks });
    await assert.rejects(wrapper.execute("creation.revision.start", { ...locator, requirementId: currentRef.requirementId,
      expectedRevision: currentRef.revision, submissionId: "capacity-revision", targets: [{ ...target(0), changes: ["Change the background"] }],
      preserve: ["Keep the subject"], changes: [] }), persistenceFailure);
    assert.equal(dispatches, 0, "A failed revision record never reaches task/image dispatch");
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(capacityCreation.getRequirements(locator).requirementRef, currentRef);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["creation.json"], "Capacity refusal leaves no temporary record");
  });
  check("corrupt owner storage fails closed", () => {
    const file = path.join(root, ".naimage", "creation.json"), before = fs.readFileSync(file);
    fs.writeFileSync(file, '{"schemaVersion":1,"requirements":[{}],"results":[],"revisions":[]}');
    assert.throws(() => service.getRequirements(locator), { code: "CREATION_STORE_INVALID" });
    assert.throws(() => service.requirementRefForTask({ ...locator, prompt: "不要重建" }), { code: "CREATION_STORE_INVALID" });
    fs.writeFileSync(file, before);
  });
  process.stdout.write(`creation service: ${cases} checks passed; 0 model requests\n`);
}
main().then(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
