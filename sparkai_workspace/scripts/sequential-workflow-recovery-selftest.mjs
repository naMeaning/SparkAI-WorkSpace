import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { createSequentialWorkflows } = require("../desktop/sequential-workflows.cjs");
const fixtureRoot = resolve(import.meta.dirname, "../.diagnostics");
mkdirSync(fixtureRoot, { recursive: true });
const root = mkdtempSync(join(fixtureRoot, "workflow-recovery-"));
const projectId = "project-1";
const operations = new Map();
const attempts = [];
const recoveries = [];
const persistedAssets = new Set();
let fault = "rejected";
let recoverFault = "none";
let gate = null;
const artifact = id => ({ assetId: `asset-${id}`, occurrenceId: `occ-${id}`, contentHash: "1".repeat(64) });
const source = artifact("source");
const definition = { version: 1, title: "抠图与换背景", inputs: [{ type: "image", id: "input", label: "原图" }], steps: [
  { id: "cutout", kind: "cutout", prompt: "", source: { type: "input", id: "input" } },
  { id: "background", kind: "background", prompt: "灰色", source: { type: "step", id: "cutout" } }
] };
const templates = [
  { id: "tpl-text-default", title: "常规文本模板", text: "生成图片：一只{{color}}小猫",
    template: { version: 2, variables: [{ key: "color", type: "text", label: "颜色", required: true, default: "橙色", maxLength: 2000 }] } },
  { id: "tpl-image-required", title: "必选原图编辑", text: "编辑：换上白色背景",
    template: { version: 2, variables: [{ key: "src", type: "image", label: "原图", role: "source", required: true }] } },
  { id: "tpl-text-short", title: "限长文本模板", text: "生成图片：标题{{headline}}",
    template: { version: 2, variables: [{ key: "headline", type: "text", label: "标题", required: true, maxLength: 80 }] } },
  { id: "tpl-image-optional", title: "可选图片模板", text: "编辑：补充材质说明",
    template: { version: 2, variables: [{ key: "src", type: "image", label: "原图", role: "source", required: false }] } }
];
const makeService = () => createSequentialWorkflows({
  projectFor: () => ({ path: root }), metaDir: ".naimage", libraryFile: join(root, "library.json"),
  write(file, value) { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file); },
  listTemplates: () => templates, storedCanvasAssets: id => id === projectId ? new Set(persistedAssets) : new Set(),
  resolveAsset: (_projectId, identity) => ({ ...identity, canvasNodeId: "N1" }),
  freezeConfig: () => ({ model: "fixture" }), findOperation: (_projectId, id) => operations.get(id),
  async generate({ run, index, operationId, source, prompt }) {
    attempts.push({ id: operationId, index, source, prompt, projectId: run.projectId });
    if (gate) await gate;
    const key = operationId;
    if (index === 1 && fault === "rejected") { operations.set(key, { key, state: "rejected" }); throw Object.assign(new Error("Definitive rejection"), { status: 402 }); }
    if (index === 1 && fault === "ambiguous") { operations.set(key, { key, state: "submitted" }); throw Object.assign(new Error("Lost response"), { ambiguous: true }); }
    if (index === 0 && fault === "sub2api-task-failed") {
      operations.set(key, { key, state: "accepted", taskId: `task-${key}` });
      throw Object.assign(new Error("Async task failed"), { code: "SUB2API_IMAGE_TASK_FAILED", unsafeToRetry: true });
    }
    if (index === 0 && fault === "newapi-task-failed") {
      operations.set(key, { key, state: "accepted", taskId: `task-${key}` });
      throw Object.assign(new Error("Image task failed"), { code: "NEW_API_IMAGE_TASK_FAILED", unsafeToRetry: true });
    }
    operations.set(key, { key, state: "saved" });
    return [artifact(`${index}-${attempts.length}`)];
  },
  async recover(_projectId, id) {
    recoveries.push(id);
    if (recoverFault === "sub2api-task-failed") throw Object.assign(new Error("Task failed"), { code: "SUB2API_IMAGE_TASK_FAILED", unsafeToRetry: true });
    if (recoverFault === "terminal") {
      operations.set(id, { key: id, state: "failed" });
      throw Object.assign(new Error("Terminal"), { code: "IMAGE_OPERATION_TERMINAL", unsafeToRetry: true });
    }
    if (recoverFault === "delivery-failed") {
      operations.set(id, { key: id, state: "delivery-failed", resultCount: 1 });
      throw Object.assign(new Error("Download failed"), { code: "IMAGE_RESULT_DOWNLOAD_FAILED", unsafeToRetry: true, generationCompleted: true });
    }
    if (operations.get(id).state !== "accepted") throw Object.assign(new Error("Unknown"), { code: "IMAGE_OPERATION_UNCERTAIN" });
    return [artifact("recovered")];
  },
  onChange() {}, onError(error) { throw error; }
});
let service = makeService();
const command = (action, args = {}) => service.command({ projectId, action, ...args });
const workflowsFile = join(root, ".naimage", "workflows.json");
async function settled() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await command("state");
    if (!status.running) return status.runs[0];
    await delay(10);
  }
  assert.fail("Workflow did not settle");
}
const { draft } = await command("edit", { definition, bindings: { input: source }, expectedRevision: 0 });
await assert.rejects(command("start", { expectedRevision: draft.revision, runId: `wf-${randomUUID()}` }), /需要确认/);
await assert.rejects(command("start", { expectedRevision: draft.revision, runId: `wf-${randomUUID()}`, confirm: true, definition }), /definition|bindings/);
await assert.rejects(command("start", { expectedRevision: draft.revision, runId: `wf-${randomUUID()}`, confirm: true, bindings: {} }), /definition|bindings/);
const runId = `wf-${randomUUID()}`;
await command("start", { expectedRevision: draft.revision, runId, confirm: true });
let run = await settled();
assert.equal(run.state, "failed");
assert.equal(run.steps[0].state, "done");
const firstOutput = run.steps[0].output;
assert.equal(attempts.length, 2);
await command("start", { expectedRevision: draft.revision, runId, confirm: true });
assert.equal(attempts.length, 2);
fault = "ambiguous";
await command("resume", { runId, confirm: true });
run = await settled();
assert.equal(run.state, "uncertain");
assert.equal(attempts.length, 3);
assert.equal(attempts[2].source.assetId, firstOutput.assetId);
const uncertainId = run.steps[1].operationId;
service = makeService();
await command("resume", { runId, confirm: true });
assert.equal((await settled()).state, "uncertain");
assert.deepEqual(recoveries, [uncertainId]);
assert.equal(attempts.length, 3);
operations.set(uncertainId, { key: uncertainId, state: "accepted" });
await command("resume", { runId, confirm: true });
run = await settled();
assert.equal(run.state, "done");
assert.equal(run.steps[1].output.assetId, "asset-recovered");
assert.deepEqual(recoveries, [uncertainId, uncertainId]);
assert.equal(attempts.length, 3);

// Pre-journal crash: step stayed "running" on disk with an operationId that never entered the journal.
const preJournalRunId = `wf-${randomUUID()}`;
const preJournalOpId = `${preJournalRunId}-1-1`;
const storedAfterRun = JSON.parse(readFileSync(workflowsFile, "utf8"));
storedAfterRun.runs.unshift({
  id: preJournalRunId, projectId, conversationId: "", state: "running", startedAt: new Date().toISOString(),
  definitionHash: "0".repeat(64), definition, draftRevision: draft.revision, bindings: { input: source },
  sourceNodes: { input: "N1" }, imageConfig: { model: "fixture" },
  steps: [{ id: "cutout", state: "running", operationId: preJournalOpId, attempt: 1 }, { id: "background", state: "queued" }]
});
writeFileSync(workflowsFile, JSON.stringify(storedAfterRun));
service = makeService();
const preJournalSnapshot = await command("state");
assert.equal(preJournalSnapshot.running, false);
assert.equal(preJournalSnapshot.runs[0].id, preJournalRunId);
assert.equal(preJournalSnapshot.runs[0].state, "interrupted");
fault = "none";
await command("resume", { runId: preJournalRunId, confirm: true });
run = await settled();
assert.equal(run.state, "done");
assert.equal(attempts.length, 5);
assert.equal(attempts[3].id, `${preJournalRunId}-1-2`);

// Missing receipt for an already-uncertain step must never fall back to re-generating.
const missingReceiptRunId = `wf-${randomUUID()}`;
const storedBeforeMissing = JSON.parse(readFileSync(workflowsFile, "utf8"));
storedBeforeMissing.runs.unshift({
  id: missingReceiptRunId, projectId, conversationId: "", state: "uncertain", startedAt: new Date().toISOString(),
  definitionHash: "0".repeat(64), definition, draftRevision: draft.revision, bindings: { input: source },
  sourceNodes: { input: "N1" }, imageConfig: { model: "fixture" },
  steps: [{ id: "cutout", state: "uncertain", operationId: `${missingReceiptRunId}-1-1`, attempt: 1 }, { id: "background", state: "queued" }]
});
writeFileSync(workflowsFile, JSON.stringify(storedBeforeMissing));
service = makeService();
await command("resume", { runId: missingReceiptRunId, confirm: true });
run = await settled();
assert.equal(run.state, "uncertain");
assert.equal(attempts.length, 5);

// Post-journal crash: step stayed "running" on disk with a persisted journal operation -> must recover, not re-generate.
const postJournalRunId = `wf-${randomUUID()}`;
const postJournalOpId = `${postJournalRunId}-1-1`;
operations.set(postJournalOpId, { key: postJournalOpId, state: "accepted", taskId: "task-post-crash" });
const storedBeforePostCrash = JSON.parse(readFileSync(workflowsFile, "utf8"));
storedBeforePostCrash.runs.unshift({
  id: postJournalRunId, projectId, conversationId: "", state: "running", startedAt: new Date().toISOString(),
  definitionHash: "0".repeat(64), definition, draftRevision: draft.revision, bindings: { input: source },
  sourceNodes: { input: "N1" }, imageConfig: { model: "fixture" },
  steps: [{ id: "cutout", state: "running", operationId: postJournalOpId, attempt: 1 }, { id: "background", state: "queued" }]
});
writeFileSync(workflowsFile, JSON.stringify(storedBeforePostCrash));
service = makeService();
await command("resume", { runId: postJournalRunId, confirm: true });
run = await settled();
assert.equal(run.state, "done");
assert.equal(run.steps[0].output.assetId, "asset-recovered");
assert.equal(attempts.length, 6);
assert.equal(attempts[5].index, 1);

// Definitive async task failure during generate (SUB2API & NEW_API) -> "failed" -> resume starts fresh attempt.
for (const failKind of ["sub2api-task-failed", "newapi-task-failed"]) {
  const failedTaskRunId = `wf-${randomUUID()}`;
  fault = failKind;
  await command("start", { expectedRevision: draft.revision, runId: failedTaskRunId, confirm: true });
  run = await settled();
  assert.equal(run.state, "failed");
  assert.equal(run.steps[0].state, "failed");
  const countBeforeRetry = attempts.length;
  const recoveriesBeforeRetry = recoveries.length;
  fault = "none";
  await command("resume", { runId: failedTaskRunId, confirm: true });
  run = await settled();
  assert.equal(run.state, "done");
  assert.equal(recoveries.length, recoveriesBeforeRetry);
  assert.equal(attempts.length, countBeforeRetry + 2);
}

// Definitive failure during recover (uncertain -> failed -> fresh retry) and post-generation protection.
const recoverTerminalRunId = `wf-${randomUUID()}`;
fault = "ambiguous";
await command("start", { expectedRevision: draft.revision, runId: recoverTerminalRunId, confirm: true });
run = await settled();
assert.equal(run.state, "uncertain");
const attemptsAtUncertain = attempts.length;
recoverFault = "sub2api-task-failed";
await command("resume", { runId: recoverTerminalRunId, confirm: true });
run = await settled();
assert.equal(run.state, "failed");
assert.equal(run.steps[1].state, "failed");
assert.equal(attempts.length, attemptsAtUncertain);
recoverFault = "none";
fault = "none";
await command("resume", { runId: recoverTerminalRunId, confirm: true });
run = await settled();
assert.equal(run.state, "done");
assert.equal(attempts.length, attemptsAtUncertain + 1);

// IMAGE_OPERATION_TERMINAL during recover -> failed -> retry; delivery-failed stays uncertain.
const terminalOpRunId = `wf-${randomUUID()}`;
fault = "ambiguous";
await command("start", { expectedRevision: draft.revision, runId: terminalOpRunId, confirm: true });
run = await settled();
assert.equal(run.state, "uncertain");
const terminalOpId = run.steps[1].operationId;
recoverFault = "delivery-failed";
await command("resume", { runId: terminalOpRunId, confirm: true });
run = await settled();
assert.equal(run.state, "uncertain");
operations.set(terminalOpId, { key: terminalOpId, state: "accepted" });
recoverFault = "terminal";
await command("resume", { runId: terminalOpRunId, confirm: true });
run = await settled();
assert.equal(run.state, "failed");
recoverFault = "none";
fault = "none";
const attemptsBeforeTerminalRetry = attempts.length;
await command("resume", { runId: terminalOpRunId, confirm: true });
run = await settled();
assert.equal(run.state, "done");
assert.equal(attempts.length, attemptsBeforeTerminalRetry + 1);

// isProjectRunning(projectId) & storedCanvasAssets gating of published acks.
let releaseGate;
gate = new Promise(resolve => { releaseGate = resolve; });
const gatedRunId = `wf-${randomUUID()}`;
await command("start", { expectedRevision: draft.revision, runId: gatedRunId, confirm: true });
assert.equal(service.isRunning(), true);
assert.equal(service.isProjectRunning(projectId), true);
assert.equal(service.isProjectRunning("other-project"), false);
releaseGate();
gate = null;
run = await settled();
assert.equal(service.isRunning(), false);
assert.equal(service.isProjectRunning(projectId), false);
assert.equal(run.state, "done");

const [step0Asset, step1Asset] = run.steps.map(step => step.output.assetId);
persistedAssets.add(step0Asset);
const partialAck = await command("published", { assetIds: [step0Asset, step1Asset] });
assert.deepEqual(partialAck.assetIds, [step0Asset]);
let stateAfterPartialAck = await command("state");
assert.equal(stateAfterPartialAck.runs[0].steps[0].published, true);
assert.equal(stateAfterPartialAck.runs[0].steps[1].published, undefined);
persistedAssets.add(step1Asset);
const fullAck = await command("published", { assetIds: [step0Asset, step1Asset] });
assert.deepEqual(fullAck.assetIds, [step1Asset]);
let stateAfterFullAck = await command("state");
assert.equal(stateAfterFullAck.runs[0].steps[1].published, true);

// Migration keeps default-length text & required source image, leaves specialized maxLength & optional image slots legacy.
const library = await command("library");
assert.equal(library.migrations["tpl-text-default"], "imported");
assert.equal(library.migrations["tpl-image-required"], "imported");
assert.equal(library.migrations["tpl-text-short"], "legacy");
assert.equal(library.migrations["tpl-image-optional"], "legacy");
assert.deepEqual(library.entries.map(entry => entry.legacyId), ["tpl-text-default", "tpl-image-required"]);

console.log(JSON.stringify({
  ok: true,
  attempts: attempts.length,
  noDuplicateAfterRestart: true,
  resumedFromFailedStep: true,
  originalReceiptUsed: true,
  preJournalCrashSafeResume: true,
  terminalFailureRetry: true,
  diskPublishedAckGated: true,
  projectRunningExposed: true,
  conservativeMigration: true
}));
