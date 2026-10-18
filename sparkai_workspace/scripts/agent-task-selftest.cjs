"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmdirSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createAgentTaskService } = require("../desktop/agent-task-service.cjs");
const { createImageOperationJournal } = require("../desktop/image-operation-journal.cjs");

const frozenScope = { version: 2, origin: "chat", scopeType: "none", snapshotHash: "scope-frozen", sourceNodeIds: [], sourceAssets: [], referenceAssets: [],
  imageConfig: { model: "mock-image", models: ["mock-image"], ratio: "1:1" } };
function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "sparkai-task-edge-"));
  const state = { root, session: { activeConversationId: "c", conversations: [{ id: "c" }, { id: "c2" }], nodes: [] }, operations: [], runs: [], dispatches: 0, executions: 0, service: null };
  state.input = { expectedProjectId: "p", conversationId: "c", submissionId: "original", prompt: "fixture" };
  state.options = { projectFor: projectId => projectId === "p" ? { id: "p", path: root } : null, readSession: () => state.session,
    runSnapshot: () => ({ runs: state.runs }), operations: () => state.operations, locateOwner: async () => "11", ...overrides,
    async dispatch(command, args, owner) {
      state.dispatches++;
      if (command === "agent.task.answer-dispatch") return { accepted: true };
      await state.beforeAdmit?.(args);
      const runId = `run-${state.dispatches}`;
      const admitted = state.service.admit({ ...args, runId, taskScope: state.scope || frozenScope }, owner);
      state.service.claimRun({ ...args, runId }, owner); state.executions++;
      if (state.loseResponse) throw new Error("response disconnected");
      return admitted;
    }
  };
  state.service = createAgentTaskService(state.options);
  state.targetFor = task => ({ expectedProjectId: "p", conversationId: task.conversationId, taskId: task.taskId });
  state.file = path.join(root, ".naimage/agent/tasks.json");
  return state;
}

async function edgeCases() {
  const lost = fixture(); lost.loseResponse = true;
  const original = await lost.service.execute("agent.task.start", lost.input);
  const replay = await lost.service.execute("agent.task.start", lost.input);
  assert.equal(original.accepted, true); assert.equal(replay.task.taskId, original.task.taskId); assert.equal(lost.executions, 1);
  const waitTarget = lost.targetFor(original.task);
  const waiting = lost.service.execute("agent.task.wait", { ...waitTarget, afterVersion: replay.task.version, timeoutMs: 200 });
  lost.service.progress("p", original.task.currentRunId, { phase: "image-request" });
  assert.equal((await waiting).changed, true);
  assert.equal((await lost.service.execute("agent.task.wait", { ...waitTarget, afterVersion: 0, timeoutMs: 0 })).changed, true);
  assert.throws(() => lost.service.settle({ ...waitTarget, runId: original.task.currentRunId, outcome: "completed" }, "22"), { code: "TASK_OWNER_CONFLICT" });
  lost.service.stopScope({ projectId: "p", conversationId: "c" }, "22");
  assert.equal(lost.service.get(waitTarget).task.phase, "running");
  lost.service.stopScope({ projectId: "p", conversationId: "c" }, "11");
  lost.service.settle({ ...waitTarget, runId: original.task.currentRunId, outcome: "completed" }, "11");
  assert.equal(lost.service.get(waitTarget).task.phase, "stopped");

  const persistence = fixture();
  persistence.beforeAdmit = () => mkdirSync(`${persistence.file}.tmp`);
  await assert.rejects(persistence.service.execute("agent.task.start", persistence.input));
  assert.equal(persistence.executions, 0, "failed accepted persistence never starts Runtime");
  rmdirSync(`${persistence.file}.tmp`);
  const unaccepted = await persistence.service.execute("agent.task.start", persistence.input);
  assert.equal(unaccepted.accepted, false); assert.equal(persistence.dispatches, 1);
  persistence.service = createAgentTaskService(persistence.options);
  assert.equal(persistence.service.get({ ...persistence.input }).task.phase, "interrupted");
  assert.equal((await persistence.service.execute("agent.task.start", persistence.input)).accepted, false);

  const guiPreparation = fixture();
  assert.throws(() => guiPreparation.service.admit({ ...guiPreparation.input, runId: "gui-run", taskScope: {} }, "11"), { code: "TASK_SCOPE_REQUIRED" });
  const failedPreparation = guiPreparation.service.get(guiPreparation.input).task;
  assert.equal(failedPreparation.phase, "interrupted", "GUI admission failure must not remain preparing indefinitely");
  assert.equal(failedPreparation.accepted, false);
  assert.equal((await guiPreparation.service.execute("agent.task.start", guiPreparation.input)).task.taskId, failedPreparation.taskId);
  assert.equal(guiPreparation.executions, 0);

  const capacity = fixture({ maxTasks: 1 });
  const full = await capacity.service.execute("agent.task.start", capacity.input);
  capacity.service.settle({ ...capacity.targetFor(full.task), runId: full.task.currentRunId, outcome: "completed" }, "11");
  await assert.rejects(capacity.service.execute("agent.task.start", { ...capacity.input, submissionId: "new" }), { code: "TASK_LEDGER_FULL" });
  assert.equal((await capacity.service.execute("agent.task.start", capacity.input)).task.taskId, full.task.taskId);
  writeFileSync(capacity.file, '{"schemaVersion":1,"tasks":[{}]}');
  await assert.rejects(capacity.service.execute("agent.task.start", { ...capacity.input, submissionId: "new" }), { code: "TASK_LEDGER_INVALID" });
  assert.equal(capacity.executions, 1);

  const outputs = fixture(), assetPath = path.join(outputs.root, "saved.png"); writeFileSync(assetPath, "fixture bytes");
  const output = await outputs.service.execute("agent.task.start", outputs.input), outputTarget = outputs.targetFor(output.task);
  const asset = { assetId: "asset-1", occurrenceId: "occ-1", path: assetPath };
  outputs.operations.push({ agentTaskId: output.task.taskId, key: "saved", state: "saved", assets: [asset, asset] });
  outputs.service.settle({ ...outputTarget, runId: output.task.currentRunId, outcome: "completed" }, "11");
  const unsaved = outputs.service.get(outputTarget).task;
  assert.equal(unsaved.phase, "save-failed"); assert.equal(unsaved.savedCount, 0); assert.equal(unsaved.results.length, 1);
  outputs.session.nodes = [{ id: "A", assets: [asset] }];
  const saved = outputs.service.get(outputTarget).task; assert.equal(saved.savedCount, 1); assert.ok(saved.version > unsaved.version);
  assert.equal(saved.phase, "completed", "successful authoritative save reconciles the receipt without rerunning");
  const other = await outputs.service.execute("agent.task.start", { ...outputs.input, submissionId: "partial" });
  outputs.operations.push({ agentTaskId: other.task.taskId, key: "some-saved", state: "saved", assets: [asset] }, { agentTaskId: other.task.taskId, key: "unknown", state: "uncertain", assets: [] });
  outputs.service.settle({ ...outputs.targetFor(other.task), runId: other.task.currentRunId, outcome: "failed" }, "11");
  assert.equal(outputs.service.get(outputs.targetFor(other.task)).task.phase, "partial");

  const question = fixture();
  const q = await question.service.execute("agent.task.start", question.input), qt = question.targetFor(q.task);
  question.session.pendingAgentExecution = { projectId: "p", conversationId: "c", taskId: q.task.taskId, requestId: "q", taskScope: frozenScope, kind: "clarify", question: "which?", options: [{ id: "a", label: "A" }] };
  question.service.settle({ ...qt, runId: q.task.currentRunId, outcome: "waiting" }, "11");
  const current = question.service.get(qt).task;
  assert.throws(() => question.service.claimAnswer({ ...qt, questionId: "q", expectedVersion: current.version, optionId: "a" }, "22"), { code: "TASK_OWNER_CONFLICT" });
  question.service = createAgentTaskService(question.options);
  const afterRestart = question.service.get(qt).task; assert.equal(afterRestart.phase, "waiting");
  assert.throws(() => question.service.claimAnswer({ ...qt, questionId: "q", expectedVersion: current.version, optionId: "a" }, "11"), { code: "TASK_ANSWER_STALE" });
  assert.throws(() => question.service.claimAnswer({ ...qt, conversationId: "c2", questionId: "q", expectedVersion: afterRestart.version, optionId: "a" }, "11"), { code: "TASK_NOT_FOUND" });
  question.service.claimAnswer({ ...qt, questionId: "q", expectedVersion: afterRestart.version, answer: "custom" }, "22");
  assert.equal(question.executions, 1, "answer claim alone never starts Runtime");
  const cancelled = fixture();
  const c = await cancelled.service.execute("agent.task.start", cancelled.input), ct = cancelled.targetFor(c.task);
  cancelled.session.pendingAgentExecution = { ...question.session.pendingAgentExecution, taskId: c.task.taskId };
  cancelled.service.settle({ ...ct, runId: c.task.currentRunId, outcome: "waiting" }, "11");
  cancelled.service.ownerGone("11");
  assert.equal(cancelled.service.get(ct).task.phase, "waiting");
  cancelled.service = createAgentTaskService(cancelled.options);
  cancelled.service.settle({ ...ct, runId: c.task.currentRunId, outcome: "stopped" }, "22");
  assert.equal(cancelled.service.get(ct).task.phase, "stopped", "restored waiting question can be canceled by its new GUI owner");
  const afterCancelled = await cancelled.service.execute("agent.task.start", { ...cancelled.input, submissionId: "new-user-intent" });
  assert.equal(afterCancelled.accepted, true, "stale saved pending snapshot cannot revive a stopped receipt or block new intent");

  const recovery = fixture(); let polls = 0, materializations = 0;
  const journal = createImageOperationJournal({ projectFor: () => ({ path: recovery.root }), extractImages: result => result.images,
    download: async () => { throw new Error("unexpected download"); }, materialize: async () => {
      materializations++; const p = path.join(recovery.root, "result.png"); writeFileSync(p, "bytes"); return [{ path: p }];
    }, resolveConnection: async () => ({ connectionId: "local", protocol: "mock", transport: "async" }),
    pollTask: async () => { polls++; return { images: [{ type: "base64", value: Buffer.from("bytes").toString("base64") }] }; } });
  const task = await recovery.service.execute("agent.task.start", recovery.input), rt = recovery.targetFor(task.task);
  const accepted = journal.start({ projectId: "p", operationId: "original-operation", runId: "child-run", agentTaskId: task.task.taskId, protocol: "mock", transport: "async", connectionId: "local" });
  journal.accepted(accepted, { taskId: "original-remote" });
  const uncertain = journal.start({ projectId: "p", operationId: "uncertain", runId: "unknown-child", agentTaskId: task.task.taskId }); journal.failed(uncertain, { ambiguous: true });
  recovery.options.operations = () => journal.list("p").map(item => journal.get("p", item.key));
  recovery.service = createAgentTaskService(recovery.options);
  assert.equal(recovery.service.get(rt).task.phase, "interrupted");
  assert.equal(recovery.service.get(rt).task.imageOperations[0].taskIdPresent, true);
  await journal.recover("p", accepted.key); await journal.recover("p", accepted.key);
  await assert.rejects(journal.recover("p", uncertain.key), { code: "IMAGE_OPERATION_UNCERTAIN" });
  assert.equal(polls, 1); assert.equal(materializations, 1); assert.equal(recovery.executions, 1);
  assert.equal((await recovery.service.execute("agent.task.start", recovery.input)).task.taskId, task.task.taskId);
  assert.equal(recovery.service.get(rt).task.results.length, 1);

  const privacy = fixture(); const secret = 'Bearer sk-fixturePrivateSecret123 https://local.invalid/image?sig=private C:\\private\\asset.png /home/private/asset.png';
  privacy.scope = { ...frozenScope, imageConfig: { model: secret, models: [secret] } };
  const privateTask = await privacy.service.execute("agent.task.start", { ...privacy.input, title: secret.slice(0, 80) });
  const privateAssetPath = path.join(privacy.root, "private.png"); writeFileSync(privateAssetPath, "fixture bytes");
  privacy.operations.push({ agentTaskId: privateTask.task.taskId, key: secret, operationId: secret, stage: secret, state: "saved", assets: [{ assetId: "private-asset", path: privateAssetPath }] });
  privacy.session.nodes = [{ id: secret, assets: [{ assetId: "private-asset" }] }];
  privacy.service.settle({ ...privacy.targetFor(privateTask.task), runId: privateTask.task.currentRunId, outcome: "failed", error: secret }, "11");
  for (const payload of [JSON.stringify(privacy.service.get(privacy.targetFor(privateTask.task))), readFileSync(privacy.file, "utf8")]) {
    assert.doesNotMatch(payload, /fixturePrivateSecret|https?:\/\/|[A-Z]:\\|\/home\/private|sig=private/);
  }
  console.log("agent-task: lost response, atomic persistence failure, capacity/corruption, owner/stop, save/partial, question restart, linked recovery and privacy passed");
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "sparkai-task-"));
  const project = { id: "p", path: root };
  let session = { activeConversationId: "c", conversations: [{ id: "c" }], nodes: [] };
  let dispatches = 0, posts = 0, service;
  const operations = [];
  const scope = { version: 2, origin: "chat", scopeType: "none", snapshotHash: "frozen", sourceNodeIds: [], sourceAssets: [], referenceAssets: [], imageConfig: { models: ["mock-image"], ratio: "1:1" } };
  const input = { expectedProjectId: "p", conversationId: "c", submissionId: "same", prompt: " 一张图片\r\n " };
  const options = {
    projectFor: id => id === "p" ? project : null, readSession: () => session,
    runSnapshot: () => ({ runs: [] }), locateOwner: async () => "11",
    operations: () => operations,
    async dispatch(command, args, owner) {
      dispatches++;
      if (command === "agent.task.dispatch") {
        const admitted = service.admit({ ...args, runId: "r1", taskScope: scope }, owner);
        service.claimRun({ projectId: "p", conversationId: "c", runId: "r1", taskId: args.taskId }, owner);
        posts++;
        return admitted;
      }
      if (command === "agent.task.answer-dispatch") return { accepted: true };
      throw new Error("unexpected command");
    }
  };
  service = createAgentTaskService(options);
  const [a, b] = await Promise.all([service.execute("agent.task.start", input), service.execute("agent.task.start", { ...input, prompt: "一张图片\n" })]);
  assert.equal(a.task.taskId, b.task.taskId); assert.equal(a.accepted, true);
  assert.equal(dispatches, 1); assert.equal(posts, 1);
  const target = { expectedProjectId: "p", conversationId: "c", taskId: a.task.taskId };
  await assert.rejects(service.execute("agent.task.start", { ...input, prompt: "其他图片" }), { code: "TASK_SUBMISSION_CONFLICT" });
  assert.equal(posts, 1);
  const timed = await service.execute("agent.task.wait", { ...target, afterVersion: a.task.version, timeoutMs: 15 });
  assert.equal(timed.timedOut, true); assert.equal(timed.task.taskId, a.task.taskId);
  await assert.rejects(service.execute("agent.task.wait", { ...target, afterVersion: timed.task.version + 100 }), { code: "TASK_CURSOR_EXPIRED" });
  session.pendingAgentExecution = { taskId: a.task.taskId, requestId: "q1", projectId: "p", conversationId: "c", taskScope: scope,
    kind: "clarify", title: "确认颜色", question: "选择颜色", options: [{ id: "red", label: "红色", answer: "红色" }, { id: "blue", label: "蓝色", answer: "蓝色" }] };
  service.settle({ ...target, runId: "r1", outcome: "waiting" }, "11");
  const waiting = await service.execute("agent.task.get", target);
  assert.equal(waiting.task.question.requestId, "q1");
  const answer = { ...target, questionId: "q1", expectedVersion: waiting.task.version, optionId: "red" };
  const races = await Promise.allSettled([service.execute("agent.task.answer", answer), Promise.resolve().then(() => service.claimAnswer(answer, "11"))]);
  assert.equal(races.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(dispatches, 2);
  await assert.rejects(service.execute("agent.task.answer", answer), { code: "TASK_ANSWER_STALE" });
  assert.equal(posts, 1);
  const restarted = createAgentTaskService(options);
  const old = await restarted.execute("agent.task.get", target);
  assert.equal(old.task.phase, "interrupted");
  const replay = await restarted.execute("agent.task.start", input);
  assert.equal(replay.task.taskId, a.task.taskId); assert.equal(posts, 1);
  assert.throws(() => restarted.claimRun({ projectId: "p", conversationId: "c", runId: "r1", taskId: a.task.taskId }, "11"));
  await assert.rejects(restarted.execute("agent.task.get", { ...target, conversationId: "other" }), { code: "TASK_NOT_FOUND" });
  console.log("agent-task: concurrent start, canonical conflict, bounded wait/cursor, answer CAS, restart and isolation passed");
}
main().then(edgeCases).catch(error => { console.error(error); process.exitCode = 1; });
