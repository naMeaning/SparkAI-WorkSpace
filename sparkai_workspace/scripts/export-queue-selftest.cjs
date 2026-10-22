"use strict";
const assert = require("node:assert/strict");
const { createExportQueueService, freezeSnapshot } = require("../desktop/export-queue-service.cjs");
const hash = value => require("node:crypto").createHash("sha256").update(value).digest("hex");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const item = name => ({ assetId: `asset-${name}`, occurrenceId: `occ-${name}`, contentHash: hash(name), name, payload: { source: name } });
const base = { projectId: "p", selectionRevision: 3, target: { kind: "project", projectId: "p", relativePath: "exports/images" }, params: { format: "original" } };

(async () => {
  const groups = [];
  assert.throws(() => freezeSnapshot({ ...base, target: { kind: "path", path: "C:/tmp" }, items: [item("a")] }));
  assert.throws(() => freezeSnapshot({ ...base, items: [{ ...item("a"), contentHash: "forged" }] }));
  const input = { ...base, params: { format: "png" }, items: [item("original")] }, snapshot = freezeSnapshot(input);
  input.params.format = "jpeg"; input.items[0].payload.source = "new";
  assert.equal(snapshot.params.format, "png"); assert.equal(snapshot.items[0].payload.source, "original"); groups.push("admission validation and copied snapshot");

  const calls = [], persisted = []; let failSecond = true;
  const queue = createExportQueueService({ persist: async job => persisted.push(job), execute: async (_snapshot, { item: current }) => {
    calls.push(current.name);
    if (current.name === "second" && failSecond) { failSecond = false; throw Object.assign(new Error("fixture"), { code: "FIXTURE_FAIL" }); }
    return { ok: true, name: current.name };
  } });
  const partial = await queue.enqueue({ ...base, items: [item("first"), item("second"), item("third")] });
  assert.equal(await queue.waitForIdle(), true); assert.equal(queue.get(partial.id).status, "failed");
  assert.deepEqual(calls, ["first", "second", "third"]);
  assert.equal((await queue.retryFailed(partial.id)).length, 1); assert.equal(await queue.waitForIdle(), true);
  assert.deepEqual(calls, ["first", "second", "third", "second"]); assert.equal(queue.get(partial.id).status, "succeeded");
  assert.equal((await queue.retryFailed(partial.id)).length, 0); groups.push("partial failure retains successes and retries only failed indexes");
  const client = queue.get(partial.id); client.results[0].name = "tampered"; client.snapshot.params.format = "tampered";
  assert.equal(queue.get(partial.id).results[0].name, "first"); assert.equal(queue.get(partial.id).snapshot.params.format, "original");
  assert.equal("payload" in queue.get(partial.id).snapshot.items[0], false); groups.push("two readers cannot mutate queue state or read execution payloads");

  const entered = deferred(), release = deferred(), cancelCalls = [];
  const cancellable = createExportQueueService({ execute: async (_snapshot, { signal, item: current }) => {
    cancelCalls.push(current.name); entered.resolve(); await release.promise;
    if (signal.aborted) throw Object.assign(new Error("cancelled"), { code: "EXPORT_CANCELLED" });
    return { ok: true };
  } });
  const running = await cancellable.enqueue({ ...base, items: [item("running"), item("never-next")] }); await entered.promise;
  const queued = await cancellable.enqueue({ ...base, items: [item("never-queued")] });
  assert.equal((await cancellable.cancel(queued.id)).status, "cancelled");
  assert.ok(cancellable.get(queued.id).finishedAt); await cancellable.cancel(running.id); release.resolve();
  assert.equal(await cancellable.waitForIdle(), true); assert.equal(cancellable.get(running.id).status, "cancelled");
  assert.deepEqual(cancelCalls, ["running"]); groups.push("cancellation interrupts running item and prevents queued dispatch");

  let rejectAdmission = true, admissionCalls = 0;
  const admission = createExportQueueService({ persist: async () => { if (rejectAdmission) throw new Error("receipt unavailable"); }, execute: async () => { admissionCalls++; return { ok: true }; } });
  await assert.rejects(admission.enqueue({ ...base, items: [item("refused")] })); assert.equal(admission.list().length, 0); assert.equal(admissionCalls, 0);
  rejectAdmission = false; await admission.enqueue({ ...base, items: [item("accepted")] }); assert.equal(await admission.waitForIdle(), true); assert.equal(admissionCalls, 1);
  groups.push("receipt rejection admits no hidden job");

  const persistEntered = deferred(), persistRelease = deferred(); let rejectReceipt = true, blockedId = "", dispatched = 0;
  const blocked = createExportQueueService({ persist: async job => {
    if (!blockedId) blockedId = job.id;
    if (job.id === blockedId && job.status === "running" && rejectReceipt) { persistEntered.resolve(); await persistRelease.promise; throw new Error("receipt unavailable"); }
    if (job.id === blockedId && job.status === "failed" && rejectReceipt) throw new Error("receipt unavailable");
  }, execute: async () => { dispatched++; return { ok: true }; } });
  const refused = await blocked.enqueue({ ...base, items: [item("receipt-failure")] }); await persistEntered.promise;
  const pending = await blocked.enqueue({ ...base, items: [item("pending")] }); persistRelease.resolve();
  assert.equal(await blocked.waitForIdle(100), false); assert.equal(dispatched, 0); assert.equal(blocked.get(pending.id).status, "queued");
  assert.equal(blocked.get(refused.id).results[0].errorCode, "EXPORT_PERSIST_FAILED");
  rejectReceipt = false; assert.equal((await blocked.retryFailed(refused.id)).length, 1); assert.equal(await blocked.waitForIdle(), true);
  assert.equal(dispatched, 2); groups.push("receipt loss stops automatic dispatch until an explicit successful retry");
  console.log(JSON.stringify({ ok: true, groups, persisted: persisted.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
