"use strict";

const assert = require("node:assert/strict");
const { runImageBatchScheduler } = require("../runtime/image-batch-scheduler.cjs");
const { createGoalProbeAdmission } = require("../runtime/goal-probe-admission.cjs");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function validateImageResult(value) {
  if (!value || typeof value !== "object" || value.ok === false) {
    return { ok: false, reason: value?.error || "request was not successful" };
  }
  const assets = Array.isArray(value.assets) ? value.assets : Array.isArray(value.outputs) ? value.outputs : [];
  return assets.length
    ? { ok: true, assetCount: assets.length }
    : { ok: false, reason: "no output assets" };
}

async function testProbeAndRamp() {
  const batches = [];
  let active = 0;
  let maximumActive = 0;
  const validationIndexes = [];
  const { results, summary } = await runImageBatchScheduler({
    items: Array.from({ length: 16 }, (_item, index) => index + 1),
    batchSize: 8,
    onBatchStart: (batch) => batches.push(batch),
    runItem: async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await delay(item % 3 === 0 ? 7 : 3);
      active -= 1;
      return { ok: true, assets: [{ id: item }] };
    },
    validateResult: (value, _item, index) => {
      validationIndexes.push(index);
      return validateImageResult(value);
    }
  });

  assert.deepEqual(batches.map(({ phase, start, size, concurrency }) => ({ phase, start, size, concurrency })), [
    { phase: "probe", start: 0, size: 1, concurrency: 1 },
    { phase: "probe", start: 1, size: 1, concurrency: 1 },
    { phase: "ramp", start: 2, size: 2, concurrency: 2 },
    { phase: "ramp", start: 4, size: 4, concurrency: 4 },
    { phase: "ramp", start: 8, size: 8, concurrency: 8 }
  ]);
  assert.equal(maximumActive, 8);
  assert.equal(summary.maxConcurrentObserved, 8);
  assert.equal(summary.probe.succeeded, 2);
  assert.equal(summary.ramp.expanded, true);
  assert.equal(summary.status, "completed");
  assert.deepEqual(validationIndexes.sort((left, right) => left - right), Array.from({ length: 16 }, (_item, index) => index));
  assert.equal(results.every((result) => result.status === "fulfilled" && result.validated === true), true);
}

async function testProbeFailureStopsSpread() {
  const dispatched = [];
  const { results, summary } = await runImageBatchScheduler({
    items: [1, 2, 3, 4, 5, 6],
    batchSize: 6,
    runItem: async (item, index) => {
      dispatched.push(index);
      return index === 1 ? { ok: false, assets: [] } : { ok: true, assets: [{ id: item }] };
    },
    validateResult: validateImageResult
  });

  assert.deepEqual(dispatched, [0, 1], "a failed second probe must not dispatch any later item");
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.code, "NAIMAGE_BATCH_RESULT_INVALID");
  assert.equal(results.slice(2).every((result) => result.status === "rejected" && result.skipped === true), true);
  assert.equal(summary.status, "probe-failed");
  assert.equal(summary.circuit.code, "NAIMAGE_BATCH_PROBE_FAILED");
  assert.equal(summary.attempted, 2);
  assert.equal(summary.skipped, 4);
}

async function testFulfilledInvalidIsRejected() {
  const { results, summary } = await runImageBatchScheduler({
    items: [1, 2, 3],
    batchSize: 3,
    runItem: async () => ({ ok: true, outputs: [] }),
    validateResult: validateImageResult
  });

  assert.equal(results[0].status, "rejected", "Promise fulfillment alone must never count as success");
  assert.equal(results[0].failureKind, "validation");
  assert.equal(results[0].reason.code, "NAIMAGE_BATCH_RESULT_INVALID");
  assert.equal(results[1].skipped, true);
  assert.equal(results[2].skipped, true);
  assert.equal(summary.fulfilled, 0);
  assert.equal(summary.validated, 0);
}

async function testProtectedFailureOpensCircuit() {
  const dispatched = [];
  const { results, summary } = await runImageBatchScheduler({
    items: [0, 1, 2, 3, 4, 5],
    batchSize: 4,
    runItem: async (_item, index) => {
      dispatched.push(index);
      return index === 2
        ? { ok: true, outputs: [] }
        : { ok: true, outputs: [{ id: index }] };
    },
    validateResult: validateImageResult
  });

  assert.deepEqual(dispatched, [0, 1, 2, 3]);
  assert.equal(results[2].failureKind, "validation");
  assert.equal(results[4].skipped, true);
  assert.equal(results[5].skipped, true);
  assert.equal(summary.status, "circuit-open");
  assert.equal(summary.circuit.code, "NAIMAGE_BATCH_PROTECTED_FAILURE");
  assert.equal(summary.circuit.failureKind, "validation");
}

async function testClusteredContentFailuresOpenCircuit() {
  const dispatched = [];
  const { results, summary } = await runImageBatchScheduler({
    items: Array.from({ length: 12 }, (_item, index) => index),
    batchSize: 4,
    runItem: async (_item, index) => {
      dispatched.push(index);
      if (index === 4 || index === 5) {
        const error = new Error("content-specific rejection");
        error.failureKind = "content";
        throw error;
      }
      return { ok: true, assets: [{ id: index }] };
    },
    validateResult: validateImageResult
  });

  assert.deepEqual(dispatched, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(results.slice(8).every((result) => result.skipped === true), true);
  assert.equal(summary.circuit.code, "NAIMAGE_BATCH_FAILURE_CLUSTER");
  assert.equal(summary.circuit.failureKind, "cluster");
  assert.equal(summary.skipped, 4);
}

async function testRateLimitOpensProtectedCircuit() {
  const dispatched = [];
  const { results, summary } = await runImageBatchScheduler({
    items: Array.from({ length: 8 }, (_item, index) => index),
    batchSize: 4,
    runItem: async (_item, index) => {
      dispatched.push(index);
      if (index === 2) {
        const error = new Error("HTTP 429 too many requests");
        error.status = 429;
        throw error;
      }
      return { ok: true, assets: [{ id: index }] };
    },
    validateResult: validateImageResult
  });

  assert.deepEqual(dispatched, [0, 1, 2, 3], "a rate limit after probing must stop the next wave");
  assert.equal(results[2].failureKind, "infrastructure");
  assert.equal(results.slice(4).every((result) => result.skipped === true), true);
  assert.equal(summary.status, "circuit-open");
  assert.equal(summary.circuit.code, "NAIMAGE_BATCH_PROTECTED_FAILURE");
  assert.equal(summary.circuit.failureKind, "infrastructure");
}

async function testPauseAndAbort() {
  let releasePause;
  let dispatched = 0;
  const paused = runImageBatchScheduler({
    items: [1],
    signal: new AbortController().signal,
    waitUntilRunnable: () => new Promise((resolve) => { releasePause = resolve; }),
    runItem: async () => {
      dispatched += 1;
      return { ok: true, assets: [{ id: 1 }] };
    },
    validateResult: validateImageResult
  });
  await delay(5);
  assert.equal(dispatched, 0, "paused work must not be dispatched");
  releasePause();
  const pausedResult = await paused;
  assert.equal(pausedResult.summary.status, "completed");
  assert.equal(dispatched, 1);

  const controller = new AbortController();
  let abortDispatches = 0;
  const aborted = runImageBatchScheduler({
    items: [1, 2, 3],
    signal: controller.signal,
    waitUntilRunnable: () => new Promise(() => {}),
    runItem: async () => {
      abortDispatches += 1;
      return { ok: true, assets: [{ id: 1 }] };
    },
    validateResult: validateImageResult
  });
  controller.abort(new Error("cancelled during pause"));
  await assert.rejects(aborted, (error) => {
    assert.equal(error.name, "AbortError");
    assert.match(error.message, /cancelled during pause/);
    assert.equal(error.summary.status, "aborted");
    assert.equal(error.summary.skipped, 3);
    assert.equal(error.results.every((result) => result.skipped === true), true);
    return true;
  });
  assert.equal(abortDispatches, 0);
}

async function testValidatorIsMandatory() {
  let dispatched = false;
  await assert.rejects(runImageBatchScheduler({
    items: [1],
    runItem: async () => {
      dispatched = true;
      return { ok: true };
    }
  }), (error) => error?.code === "NAIMAGE_BATCH_VALIDATE_REQUIRED");
  assert.equal(dispatched, false);
}

async function testProcessProbeAdmissionAcrossSchedulers() {
  const admission = createGoalProbeAdmission({ capacity: 4 });
  const dispatchOrder = [];
  let processActive = 0;
  let maximumProcessActive = 0;
  const run = (label, itemCount) => runImageBatchScheduler({
    items: Array.from({ length: itemCount }, (_item, index) => `${label}-${index + 1}`),
    batchSize: 4,
    probeSize: 2,
    probeAdmission: admission,
    probeAdmissionContext: { admissionId: `goal-${label}`, runId: `run-${label}`, projectId: `project-${label}` },
    runItem: async (item) => {
      dispatchOrder.push(item);
      processActive += 1;
      maximumProcessActive = Math.max(maximumProcessActive, processActive);
      try {
        await delay(4);
        return { ok: true, assets: [{ id: item }] };
      } finally {
        processActive -= 1;
      }
    },
    validateResult: validateImageResult
  });

  const [first, second] = await Promise.all([run("A", 4), run("B", 3)]);
  const firstB = dispatchOrder.indexOf("B-1");
  assert.equal(firstB > dispatchOrder.indexOf("A-2"), true, "Renderer B must not probe before Renderer A validates its full probe set");
  assert.equal(first.summary.admission.mode, "process-goal");
  assert.equal(first.summary.admission.acquired, true);
  assert.equal(first.summary.admission.admitted, true);
  assert.equal(first.summary.admission.released, true);
  assert.equal(second.summary.admission.queueDepthAtEnqueue >= 1, true);
  assert.equal(second.summary.admission.released, true);
  assert.equal(admission.snapshot().active, null);
  assert.deepEqual(admission.snapshot().queued, []);
  assert.equal(maximumProcessActive <= 4, true);
  admission.dispose("selftest complete");
}

async function testRawProviderPromiseDelaysAdmission() {
  const admission = createGoalProbeAdmission({ capacity: 2 });
  const rawProvider = deferred();
  let rampDispatched = false;
  const run = runImageBatchScheduler({
    items: ["probe", "ramp"],
    batchSize: 2,
    probeSize: 1,
    probeAdmission: admission,
    probeAdmissionContext: { admissionId: "raw-provider", projectId: "raw-provider-project" },
    runItem: async (item, _index, _signal, dispatch) => {
      if (item === "probe") {
        dispatch.trackProviderPromise(rawProvider.promise);
        dispatch.reportRetry({ category: "rate_limit", retryCount: 1, maxRetries: 5, status: 429 });
      } else {
        rampDispatched = true;
      }
      return { ok: true, assets: [{ id: item }] };
    },
    validateResult: validateImageResult
  });
  await delay(10);
  assert.equal(rampDispatched, false, "Ramp must wait while a timed-out raw provider Promise is unresolved");
  assert.equal(admission.snapshot().activeSlots, 1);
  assert.equal(admission.snapshot().retryHoldCount, 1);
  rawProvider.resolve({ ok: true });
  const result = await run;
  assert.equal(rampDispatched, true);
  assert.equal(result.summary.admission.admitted, true);
  assert.equal(result.summary.admission.released, true);
  assert.equal(admission.snapshot().activeSlots, 0);
  admission.dispose("selftest complete");
}

(async () => {
  await testProbeAndRamp();
  await testProbeFailureStopsSpread();
  await testFulfilledInvalidIsRejected();
  await testProtectedFailureOpensCircuit();
  await testClusteredContentFailuresOpenCircuit();
  await testRateLimitOpensProtectedCircuit();
  await testPauseAndAbort();
  await testValidatorIsMandatory();
  await testProcessProbeAdmissionAcrossSchedulers();
  await testRawProviderPromiseDelaysAdmission();
  console.log("image batch scheduler self-test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
