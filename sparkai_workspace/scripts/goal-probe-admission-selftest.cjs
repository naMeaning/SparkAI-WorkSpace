"use strict";

const assert = require("node:assert/strict");
const { createGoalAdmissionControl } = require("../runtime/goal-probe-admission.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function finishReservation(reservation, outcome = "fulfilled") {
  for (let index = 0; index < reservation.size; index += 1) {
    const token = reservation.item(index);
    const provider = Promise.resolve({ index });
    token.track(provider);
    token.complete(outcome);
  }
  await tick();
}

async function passProbe(lease) {
  const reservation = await lease.reserveWave({ phase: "probe", requestedSize: 1 });
  await finishReservation(reservation);
  assert.equal(lease.admit(), true);
}

async function testFifoAbortAndDispose() {
  const snapshots = [];
  const admission = createGoalAdmissionControl({ capacity: 4, onChange: (snapshot) => snapshots.push(snapshot) });
  const controllerA = new AbortController();
  const controllerB = new AbortController();
  const controllerC = new AbortController();

  const leaseA = await admission.acquire({
    admissionId: "goal-a",
    runId: "run-a",
    projectId: "project-a",
    conversationId: "conversation-a",
    configuredConcurrency: 4,
    signal: controllerA.signal
  });
  assert.equal(leaseA.mode, "process-goal");
  assert.equal(admission.snapshot().active.admissionId, "goal-a");

  let bAcquired = false;
  const leaseBPromise = admission.acquire({
    admissionId: "goal-b",
    projectId: "project-b",
    configuredConcurrency: 4,
    signal: controllerB.signal
  }).then((lease) => {
    bAcquired = true;
    return lease;
  });
  const leaseCPromise = admission.acquire({
    admissionId: "goal-c",
    projectId: "project-c",
    configuredConcurrency: 4,
    signal: controllerC.signal
  });
  await tick();
  assert.equal(bAcquired, false);
  assert.deepEqual(admission.snapshot().queued.map((item) => item.admissionId), ["goal-b", "goal-c"]);

  controllerC.abort(new Error("renderer c closed"));
  await assert.rejects(leaseCPromise, (error) => error?.name === "AbortError");
  assert.deepEqual(admission.snapshot().queued.map((item) => item.admissionId), ["goal-b"]);

  assert.equal(leaseA.release("probe-complete"), true);
  assert.equal(leaseA.release("duplicate"), false);
  const leaseB = await leaseBPromise;
  assert.equal(leaseB.queueDepthAtEnqueue, 1);
  assert.equal(admission.snapshot().active.admissionId, "goal-b");

  controllerB.abort(new Error("renderer b crashed"));
  await tick();
  assert.equal(admission.snapshot().active, null);

  const leaseD = await admission.acquire({ admissionId: "goal-d", projectId: "project-d" });
  const queuedE = admission.acquire({ admissionId: "goal-e", projectId: "project-e" });
  assert.equal(admission.snapshot().queued.length, 1);
  assert.equal(admission.dispose("test shutdown"), true);
  assert.equal(leaseD.release("after-dispose"), false);
  await assert.rejects(queuedE, (error) => error?.code === "NAIMAGE_GOAL_ADMISSION_DISPOSED");
  assert.equal(admission.snapshot().disposed, true);
  assert.equal(snapshots.some((snapshot) => snapshot.active?.admissionId === "goal-a"), true);
  assert.equal(snapshots.some((snapshot) => snapshot.queued.some((item) => item.admissionId === "goal-b")), true);
}

async function testProbePriorityFairCapacityAndRetryHold() {
  const admission = createGoalAdmissionControl({ capacity: 4 });
  const leaseA = await admission.acquire({ admissionId: "fair-a", projectId: "fair-project-a", configuredConcurrency: 4 });
  const probeA = await leaseA.reserveWave({ phase: "probe", requestedSize: 1 });
  const providerA = deferred();
  probeA.item(0).track(providerA.promise);
  probeA.item(0).complete("fulfilled");

  let bAcquired = false;
  const leaseBPromise = admission.acquire({
    admissionId: "fair-b",
    projectId: "fair-project-b",
    configuredConcurrency: 4
  }).then((lease) => {
    bAcquired = true;
    return lease;
  });
  await tick();
  assert.equal(bAcquired, false, "A queued probe must wait for the real provider Promise to settle");
  assert.equal(admission.snapshot().activeSlots, 1);
  providerA.resolve({ ok: true });
  await tick();
  assert.equal(bAcquired, false, "The current Goal retains exclusive probe ownership through validation");
  leaseA.admit();
  const leaseB = await leaseBPromise;

  let rampAResolved = false;
  const rampAPromise = leaseA.reserveWave({ phase: "ramp", requestedSize: 4 }).then((reservation) => {
    rampAResolved = true;
    return reservation;
  });
  await tick();
  assert.equal(rampAResolved, false, "A waiting probe must block every new ramp wave");
  await passProbe(leaseB);

  const rampA = await rampAPromise;
  const rampB = await leaseB.reserveWave({ phase: "ramp", requestedSize: 4 });
  assert.equal(rampA.size, 2);
  assert.equal(rampB.size, 2);
  assert.equal(admission.snapshot().activeSlots, 4);
  assert.equal(admission.snapshot().maximumSlotsObserved, 4);

  const aProviders = Array.from({ length: rampA.size }, deferred);
  const bProviders = Array.from({ length: rampB.size }, deferred);
  for (let index = 0; index < rampA.size; index += 1) {
    rampA.item(index).track(aProviders[index].promise);
    rampA.item(index).complete("fulfilled");
  }
  for (let index = 0; index < rampB.size; index += 1) {
    rampB.item(index).track(bProviders[index].promise);
    rampB.item(index).complete("fulfilled");
  }
  rampA.item(0).reportRetry({ category: "rate_limit", retryCount: 1, maxRetries: 5, status: 429 });
  bProviders.forEach((item) => item.resolve({ ok: true }));
  await tick();
  assert.equal(admission.snapshot().activeSlots, 2);
  assert.equal(admission.snapshot().retryHoldCount, 1);

  let nextBResolved = false;
  const nextBPromise = leaseB.reserveWave({ phase: "ramp", requestedSize: 2 }).then((reservation) => {
    nextBResolved = true;
    return reservation;
  });
  await tick();
  assert.equal(nextBResolved, false, "A provider retry must pause all new process ramp waves");
  aProviders.forEach((item) => item.resolve({ ok: true }));
  const nextB = await nextBPromise;
  assert.equal(nextB.size, 2);
  assert.equal(admission.snapshot().retryHoldCount, 0);
  await finishReservation(nextB);

  leaseA.close("done");
  leaseB.close("done");
  await tick();
  assert.equal(admission.snapshot().activeSlots, 0);
  admission.dispose("selftest complete");
}

async function testAbortDrainingCircuitDuplicateAndEpochReset() {
  const admission = createGoalAdmissionControl({ capacity: 2 });
  const controllerA = new AbortController();
  const leaseA = await admission.acquire({
    admissionId: "drain-a",
    projectId: "same-project",
    configuredConcurrency: 2,
    signal: controllerA.signal
  });
  await assert.rejects(
    admission.acquire({ admissionId: "duplicate", projectId: "same-project" }),
    (error) => error?.code === "NAIMAGE_GOAL_PROJECT_ACTIVE"
  );

  const probeA = await leaseA.reserveWave({ phase: "probe", requestedSize: 1 });
  const provider = deferred();
  probeA.item(0).track(provider.promise);
  probeA.item(0).complete("aborted");
  controllerA.abort(new Error("renderer destroyed"));
  let bAcquired = false;
  const leaseBPromise = admission.acquire({
    admissionId: "drain-b",
    projectId: "other-project",
    configuredConcurrency: 2
  }).then((lease) => {
    bAcquired = true;
    return lease;
  });
  await tick();
  assert.equal(bAcquired, false);
  assert.equal(admission.snapshot().goals.find((goal) => goal.admissionId === "drain-a")?.state, "draining");
  provider.resolve({ ok: true });
  const leaseB = await leaseBPromise;
  await passProbe(leaseB);

  const epochBeforeCircuit = admission.snapshot().epoch;
  assert.equal(leaseB.tripCircuit({
    code: "NAIMAGE_GOAL_PROCESS_CIRCUIT_OPEN",
    reason: "provider persistence validation failed",
    failureKind: "persistence"
  }), true);
  await assert.rejects(
    leaseB.reserveWave({ phase: "ramp", requestedSize: 1 }),
    (error) => error?.code === "NAIMAGE_GOAL_PROCESS_CIRCUIT_OPEN"
  );
  await assert.rejects(
    admission.acquire({ admissionId: "old-epoch", projectId: "third-project" }),
    (error) => error?.code === "NAIMAGE_GOAL_PROCESS_CIRCUIT_OPEN"
  );
  leaseB.close("circuit-observed");
  await tick();
  assert.equal(admission.snapshot().circuit, null, "The circuit resets only after every lease and token drain");

  const leaseC = await admission.acquire({ admissionId: "new-epoch", projectId: "same-project" });
  assert.equal(admission.snapshot().epoch, epochBeforeCircuit + 1);
  leaseC.close("done");
  admission.dispose("selftest complete");
}

(async () => {
  await testFifoAbortAndDispose();
  await testProbePriorityFairCapacityAndRetryHold();
  await testAbortDrainingCircuitDuplicateAndEpochReset();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    processGoalAdmission: true,
    probePriority: true,
    fairRampSharing: true,
    globalCapacity: true,
    retryHold: true,
    providerDrainAfterAbort: true,
    sameProjectLease: true,
    crossGoalCircuit: true,
    epochReset: true
  })}\n`);
})().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
