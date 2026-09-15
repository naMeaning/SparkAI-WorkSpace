"use strict";

const maximumProcessCapacity = 10;

function clean(value, maximum = 180) {
  return String(value || "").trim().slice(0, maximum);
}

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function admissionError(message, code, details = {}) {
  const error = new Error(clean(message, 500) || "Goal admission failed.");
  error.code = code;
  Object.assign(error, details);
  return error;
}

function admissionAbortError(signal, fallback = "Goal admission was cancelled.") {
  const reason = signal?.reason;
  const error = new Error(reason instanceof Error ? reason.message : clean(reason, 500) || fallback);
  error.name = "AbortError";
  error.code = reason?.code || "NAIMAGE_RUN_CANCELLED";
  if (reason instanceof Error) error.cause = reason;
  return error;
}

function createGoalProbeAdmission(options = {}) {
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;
  const configuredCapacity = () => clampInteger(
    typeof options.getCapacity === "function" ? options.getCapacity() : options.capacity,
    1,
    maximumProcessCapacity,
    3
  );
  const goals = new Map();
  const probeQueue = [];
  const waveQueue = [];
  const retryHolds = new Set();
  let activeProbe = null;
  let activeSlots = 0;
  let maximumSlotsObserved = 0;
  let epoch = 0;
  let epochCapacity = 0;
  let circuit = null;
  let sequence = 0;
  let disposed = false;
  let pumping = false;

  function publicGoal(entry) {
    return entry ? {
      admissionId: entry.admissionId,
      runId: entry.runId || undefined,
      projectId: entry.projectId || undefined,
      conversationId: entry.conversationId || undefined,
      state: entry.state,
      configuredConcurrency: entry.configuredConcurrency,
      enqueuedAt: entry.enqueuedAt,
      acquiredAt: entry.acquiredAt || undefined,
      admittedAt: entry.admittedAt || undefined,
      outstanding: entry.tokens.size,
      closeReason: entry.closeReason || undefined
    } : null;
  }

  function publicCircuit() {
    return circuit ? {
      code: circuit.code,
      reason: circuit.reason,
      failureKind: circuit.failureKind,
      admissionId: circuit.admissionId || undefined,
      trippedAt: circuit.trippedAt,
      epoch: circuit.epoch,
      details: circuit.details
    } : null;
  }

  function snapshot() {
    return {
      version: 2,
      mode: "process-goal",
      disposed,
      epoch,
      capacity: epochCapacity || configuredCapacity(),
      activeSlots,
      maximumSlotsObserved,
      retryHoldCount: retryHolds.size,
      circuit: publicCircuit(),
      active: publicGoal(activeProbe),
      queued: probeQueue.filter((entry) => entry.state === "queued-probe").map(publicGoal),
      goals: [...goals.values()].map(publicGoal),
      pendingWaves: waveQueue.filter((request) => !request.settled).map((request) => ({
        admissionId: request.entry.admissionId,
        phase: request.phase,
        requestedSize: request.requestedSize,
        enqueuedAt: request.enqueuedAt
      }))
    };
  }

  function changed() {
    try {
      onChange(snapshot());
    } catch {
      // Admission telemetry must not affect billable dispatch decisions.
    }
  }

  function removeFrom(list, value) {
    const index = list.indexOf(value);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  function circuitFailure() {
    return admissionError(
      circuit?.reason || "The process Goal circuit is open.",
      circuit?.code || "NAIMAGE_GOAL_ADMISSION_CIRCUIT_OPEN",
      { failureKind: circuit?.failureKind || "infrastructure", circuit: publicCircuit() }
    );
  }

  function settleWaveRequest(request, method, value) {
    if (!request || request.settled) return false;
    request.settled = true;
    removeFrom(waveQueue, request);
    request.cleanupAbort();
    request[method](value);
    return true;
  }

  function rejectEntryRequests(entry, error) {
    for (const request of [...waveQueue]) {
      if (request.entry === entry) settleWaveRequest(request, "reject", error);
    }
  }

  function resetEpochIfDrained() {
    if (goals.size || activeSlots || waveQueue.some((request) => !request.settled)) return false;
    activeProbe = null;
    retryHolds.clear();
    circuit = null;
    epochCapacity = 0;
    maximumSlotsObserved = 0;
    return true;
  }

  function finalizeEntry(entry) {
    if (!entry || entry.finalized || entry.state !== "draining" || entry.tokens.size) return false;
    entry.finalized = true;
    entry.cleanupAbort();
    removeFrom(probeQueue, entry);
    if (activeProbe === entry) activeProbe = null;
    goals.delete(entry.admissionId);
    resetEpochIfDrained();
    return true;
  }

  function closeEntry(entry, reason = "goal-complete") {
    if (!entry || entry.finalized || entry.state === "draining") return false;
    const wasQueued = entry.state === "queued-probe";
    entry.state = "draining";
    entry.closeReason = clean(reason, 160) || "goal-complete";
    removeFrom(probeQueue, entry);
    if (activeProbe === entry) activeProbe = null;
    const error = admissionAbortError(entry.signal, `Goal admission closed: ${entry.closeReason}`);
    rejectEntryRequests(entry, error);
    if (entry.admitWaiter) {
      entry.admitWaiter.reject(error);
      entry.admitWaiter = null;
    }
    for (const token of [...entry.tokens]) {
      if (!token.tracked) token.releaseUnused("not-dispatched");
      else token.complete(entry.closeReason || "goal-closed");
    }
    if (wasQueued && !entry.acquireSettled) {
      entry.acquireSettled = true;
      entry.rejectAcquire(error);
    }
    finalizeEntry(entry);
    changed();
    pump();
    return true;
  }

  function makeDispatchToken(entry, reservation, index) {
    const token = {
      id: `${entry.admissionId}:wave:${reservation.sequence}:item:${index + 1}`,
      entry,
      reservation,
      index,
      tracked: false,
      completed: false,
      settled: false,
      retrying: false,
      startedAt: 0,
      settledAt: 0,
      trackedPromises: new Set(),
      track(providerPromise) {
        if (token.settled) {
          throw admissionError("The Goal dispatch reservation was released before provider dispatch.", "NAIMAGE_GOAL_RESERVATION_RELEASED");
        }
        token.tracked = true;
        if (!token.startedAt) token.startedAt = now();
        const trackedPromise = Promise.resolve(providerPromise);
        if (token.trackedPromises.has(trackedPromise)) return providerPromise;
        token.trackedPromises.add(trackedPromise);
        trackedPromise.then(
          () => token.providerSettled(trackedPromise),
          () => token.providerSettled(trackedPromise)
        );
        return providerPromise;
      },
      providerSettled(providerPromise) {
        token.trackedPromises.delete(providerPromise);
        token.finalizeIfReady();
      },
      reportRetry(details = {}) {
        if (token.settled || token.retrying) return false;
        token.retrying = true;
        token.retry = {
          category: clean(details.category, 80) || "transient",
          retryCount: Math.max(1, Math.floor(Number(details.retryCount) || 1)),
          maxRetries: Math.max(0, Math.floor(Number(details.maxRetries) || 0)),
          status: Number(details.status) || undefined,
          reportedAt: now()
        };
        retryHolds.add(token);
        changed();
        return true;
      },
      complete(outcome = "settled") {
        if (token.settled || token.completed) return false;
        token.completed = true;
        token.outcome = clean(outcome, 80) || "settled";
        token.finalizeIfReady();
        return true;
      },
      releaseUnused(outcome = "not-dispatched") {
        if (token.settled || token.tracked) return false;
        token.completed = true;
        token.outcome = clean(outcome, 80) || "not-dispatched";
        token.finalizeIfReady();
        return true;
      },
      finalizeIfReady() {
        if (token.settled || !token.completed || token.trackedPromises.size) return false;
        token.settled = true;
        token.settledAt = now();
        retryHolds.delete(token);
        entry.tokens.delete(token);
        activeSlots = Math.max(0, activeSlots - 1);
        tryAdmitEntry(entry);
        finalizeEntry(entry);
        changed();
        pump();
        return true;
      }
    };
    return token;
  }

  function grantWave(request, size) {
    const grantedSize = clampInteger(size, 1, request.requestedSize, 1);
    const reservation = {
      sequence: request.sequence,
      admissionId: request.entry.admissionId,
      phase: request.phase,
      requestedSize: request.requestedSize,
      size: grantedSize,
      processCapacity: epochCapacity,
      activeSlotsAtGrant: activeSlots + grantedSize,
      grantedAt: now(),
      tokens: [],
      item(index) {
        return reservation.tokens[index] || null;
      },
      releaseUnused(reason = "wave-finished") {
        let released = 0;
        for (const token of reservation.tokens) {
          if (!token.tracked && token.releaseUnused(reason)) released += 1;
        }
        return released;
      }
    };
    for (let index = 0; index < grantedSize; index += 1) {
      const token = makeDispatchToken(request.entry, reservation, index);
      reservation.tokens.push(token);
      request.entry.tokens.add(token);
    }
    activeSlots += grantedSize;
    maximumSlotsObserved = Math.max(maximumSlotsObserved, activeSlots);
    settleWaveRequest(request, "resolve", reservation);
    return reservation;
  }

  function rejectInvalidRequests() {
    for (const request of [...waveQueue]) {
      if (request.settled) {
        removeFrom(waveQueue, request);
        continue;
      }
      if (request.signal?.aborted || request.entry.signal?.aborted) {
        settleWaveRequest(request, "reject", admissionAbortError(request.signal?.aborted ? request.signal : request.entry.signal));
      } else if (request.entry.state === "draining" || request.entry.finalized) {
        settleWaveRequest(request, "reject", admissionError("The Goal admission lease is closed.", "NAIMAGE_GOAL_ADMISSION_CLOSED"));
      }
    }
  }

  function admitNextProbe() {
    if (disposed || circuit || activeProbe || activeSlots || retryHolds.size) return false;
    while (probeQueue.length) {
      const entry = probeQueue.shift();
      if (!entry || entry.state !== "queued-probe") continue;
      if (entry.signal?.aborted) {
        closeEntry(entry, "aborted-before-probe");
        continue;
      }
      activeProbe = entry;
      entry.state = "probing";
      entry.acquiredAt = now();
      entry.acquireSettled = true;
      entry.resolveAcquire(makeLease(entry));
      changed();
      return true;
    }
    return false;
  }

  function grantProbeWave() {
    if (!activeProbe || activeSlots || retryHolds.size || circuit) return false;
    const request = waveQueue.find((candidate) => (
      !candidate.settled && candidate.entry === activeProbe && candidate.phase === "probe"
    ));
    if (!request) return false;
    grantWave(request, 1);
    changed();
    return true;
  }

  function grantRampWaves() {
    if (activeProbe || probeQueue.some((entry) => entry.state === "queued-probe") || retryHolds.size || circuit) return false;
    let available = Math.max(0, epochCapacity - activeSlots);
    if (!available) return false;
    let granted = false;
    while (available > 0) {
      const eligible = waveQueue.filter((request) => (
        !request.settled && request.phase === "ramp" && request.entry.state === "admitted"
      ));
      if (!eligible.length) break;
      const request = eligible[0];
      const admittedGoals = [...goals.values()].filter((entry) => entry.state === "admitted").length;
      const fairShare = Math.max(1, Math.floor(epochCapacity / Math.max(1, admittedGoals)));
      const size = Math.min(
        request.requestedSize,
        request.entry.configuredConcurrency,
        available,
        fairShare
      );
      grantWave(request, size);
      available = Math.max(0, epochCapacity - activeSlots);
      granted = true;
    }
    if (granted) changed();
    return granted;
  }

  function pump() {
    if (pumping || disposed) return;
    pumping = true;
    try {
      rejectInvalidRequests();
      if (circuit) return;
      if (activeProbe) {
        grantProbeWave();
        return;
      }
      if (probeQueue.some((entry) => entry.state === "queued-probe")) {
        admitNextProbe();
        if (activeProbe) grantProbeWave();
        return;
      }
      grantRampWaves();
    } finally {
      pumping = false;
    }
  }

  function tripCircuit(entry, details = {}) {
    if (disposed || circuit) return false;
    const failureKind = clean(details.failureKind, 80) || "infrastructure";
    circuit = {
      code: clean(details.code, 120) || "NAIMAGE_GOAL_PROCESS_CIRCUIT_OPEN",
      reason: clean(details.reason || details.message, 500) || "A Goal image failure opened the process circuit.",
      failureKind,
      admissionId: entry?.admissionId || "",
      trippedAt: now(),
      epoch,
      details: details.details && typeof details.details === "object" ? details.details : undefined
    };
    const error = circuitFailure();
    for (const request of [...waveQueue]) settleWaveRequest(request, "reject", error);
    for (const goal of goals.values()) {
      if (goal.admitWaiter) {
        goal.admitWaiter.reject(error);
        goal.admitWaiter = null;
      }
    }
    for (const queued of [...probeQueue]) {
      removeFrom(probeQueue, queued);
      if (!queued.acquireSettled) {
        queued.acquireSettled = true;
        queued.rejectAcquire(error);
      }
      queued.state = "draining";
      queued.closeReason = "process-circuit";
      finalizeEntry(queued);
    }
    changed();
    return true;
  }

  function reserveWave(entry, value = {}) {
    if (disposed) return Promise.reject(admissionError("Goal admission is disposed.", "NAIMAGE_GOAL_ADMISSION_DISPOSED"));
    if (circuit) return Promise.reject(circuitFailure());
    const signal = value.signal || entry.signal;
    if (signal?.aborted) return Promise.reject(admissionAbortError(signal));
    const phase = value.phase === "probe" ? "probe" : "ramp";
    if (phase === "probe" && (entry.state !== "probing" || activeProbe !== entry)) {
      return Promise.reject(admissionError("This Goal does not own the process probe slot.", "NAIMAGE_GOAL_PROBE_NOT_ACTIVE"));
    }
    if (phase === "ramp" && entry.state !== "admitted") {
      return Promise.reject(admissionError("The Goal must pass every probe before ramp dispatch.", "NAIMAGE_GOAL_NOT_ADMITTED"));
    }
    sequence += 1;
    const requestedSize = clampInteger(value.requestedSize, 1, entry.configuredConcurrency, 1);
    return new Promise((resolve, reject) => {
      const request = {
        sequence,
        entry,
        phase,
        requestedSize,
        signal,
        enqueuedAt: now(),
        settled: false,
        resolve,
        reject,
        onAbort: null,
        cleanupAbort: () => {}
      };
      request.onAbort = () => {
        if (!settleWaveRequest(request, "reject", admissionAbortError(signal))) return;
        changed();
        pump();
      };
      request.cleanupAbort = () => signal?.removeEventListener?.("abort", request.onAbort);
      signal?.addEventListener?.("abort", request.onAbort, { once: true });
      waveQueue.push(request);
      changed();
      pump();
    });
  }

  function tryAdmitEntry(entry) {
    if (!entry?.admitWaiter || entry.tokens.size || entry.state !== "probing" || activeProbe !== entry) return false;
    const waiter = entry.admitWaiter;
    entry.admitWaiter = null;
    entry.state = "admitted";
    entry.admittedAt = now();
    activeProbe = null;
    waiter.resolve(true);
    changed();
    pump();
    return true;
  }

  function makeLease(entry) {
    if (entry.lease) return entry.lease;
    let admitted = false;
    const lease = {
      admissionId: entry.admissionId,
      mode: "process-goal",
      epoch,
      processCapacity: epochCapacity,
      configuredConcurrency: entry.configuredConcurrency,
      enqueuedAt: entry.enqueuedAt,
      acquiredAt: entry.acquiredAt,
      waitMs: Math.max(0, entry.acquiredAt - entry.enqueuedAt),
      queueDepthAtEnqueue: entry.queueDepthAtEnqueue,
      reserveWave: (value) => reserveWave(entry, value),
      admit() {
        if (admitted) return false;
        if (entry.state !== "probing" || activeProbe !== entry) {
          throw admissionError("Only the active probe owner can be admitted.", "NAIMAGE_GOAL_PROBE_NOT_ACTIVE");
        }
        admitted = true;
        if (!entry.tokens.size) {
          entry.state = "admitted";
          entry.admittedAt = now();
          activeProbe = null;
          changed();
          pump();
          return true;
        }
        entry.admitWaiter = {};
        entry.admitWaiter.promise = new Promise((resolve, reject) => {
          entry.admitWaiter.resolve = resolve;
          entry.admitWaiter.reject = reject;
        });
        changed();
        return entry.admitWaiter.promise;
      },
      tripCircuit: (details) => tripCircuit(entry, details),
      close: (reason) => closeEntry(entry, reason),
      release: (reason) => closeEntry(entry, reason),
      snapshot: () => publicGoal(entry)
    };
    entry.lease = lease;
    return lease;
  }

  function acquire(value = {}) {
    const signal = value.signal;
    if (disposed) return Promise.reject(admissionError("Goal admission is disposed.", "NAIMAGE_GOAL_ADMISSION_DISPOSED"));
    if (circuit) return Promise.reject(circuitFailure());
    if (signal?.aborted) return Promise.reject(admissionAbortError(signal));
    const projectId = clean(value.projectId);
    if (projectId) {
      const duplicate = [...goals.values()].find((entry) => entry.projectId === projectId && !entry.finalized);
      if (duplicate) {
        return Promise.reject(admissionError(
          "Another confirmed Goal is already active for this project. Preview again after it finishes.",
          "NAIMAGE_GOAL_PROJECT_ACTIVE",
          { projectId, activeAdmissionId: duplicate.admissionId }
        ));
      }
    }
    if (!epochCapacity) {
      epoch += 1;
      epochCapacity = clampInteger(value.processCapacity, 1, maximumProcessCapacity, configuredCapacity());
      maximumSlotsObserved = 0;
    }
    sequence += 1;
    const admissionId = clean(value.admissionId) || `goal-${epoch}-${sequence}`;
    if (goals.has(admissionId)) {
      return Promise.reject(admissionError("The Goal admission identifier is already active.", "NAIMAGE_GOAL_ADMISSION_ID_CONFLICT"));
    }
    const enqueuedAt = now();
    return new Promise((resolve, reject) => {
      const entry = {
        sequence,
        admissionId,
        runId: clean(value.runId),
        projectId,
        conversationId: clean(value.conversationId),
        configuredConcurrency: clampInteger(value.configuredConcurrency, 1, epochCapacity, epochCapacity),
        signal,
        enqueuedAt,
        acquiredAt: 0,
        admittedAt: 0,
        queueDepthAtEnqueue: probeQueue.filter((queued) => queued.state === "queued-probe").length + (activeProbe ? 1 : 0),
        state: "queued-probe",
        tokens: new Set(),
        lease: null,
        admitWaiter: null,
        finalized: false,
        closeReason: "",
        acquireSettled: false,
        resolveAcquire: resolve,
        rejectAcquire: reject,
        onAbort: null,
        cleanupAbort: () => {}
      };
      entry.onAbort = () => closeEntry(entry, "aborted");
      entry.cleanupAbort = () => signal?.removeEventListener?.("abort", entry.onAbort);
      signal?.addEventListener?.("abort", entry.onAbort, { once: true });
      goals.set(entry.admissionId, entry);
      probeQueue.push(entry);
      changed();
      pump();
    });
  }

  function dispose(reason = "Application shutdown.") {
    if (disposed) return false;
    disposed = true;
    const error = admissionError(clean(reason, 500) || "Goal admission was disposed.", "NAIMAGE_GOAL_ADMISSION_DISPOSED");
    for (const request of [...waveQueue]) settleWaveRequest(request, "reject", error);
    for (const entry of [...goals.values()]) {
      if (!entry.acquireSettled) {
        entry.acquireSettled = true;
        entry.rejectAcquire(error);
      }
      closeEntry(entry, "disposed");
    }
    changed();
    return true;
  }

  return { acquire, snapshot, dispose };
}

const createGoalAdmissionControl = createGoalProbeAdmission;

module.exports = {
  createGoalAdmissionControl,
  createGoalProbeAdmission,
  maximumProcessCapacity
};
