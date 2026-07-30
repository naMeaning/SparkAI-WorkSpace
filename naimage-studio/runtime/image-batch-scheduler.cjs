"use strict";

const maximumBatchSize = 10;
const protectedFailureKinds = new Set(["infrastructure", "persistence", "validation"]);

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function schedulerError(message, code, details = {}) {
  const error = new Error(String(message || "Image batch scheduling failed."));
  error.code = code;
  Object.assign(error, details);
  return error;
}

function abortError(signal, fallback) {
  const reason = signal?.reason ?? fallback;
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : reason ? String(reason) : "The image batch was cancelled."
  );
  error.name = "AbortError";
  error.code = reason?.code || "NAIMAGE_RUN_CANCELLED";
  if (reason instanceof Error) error.cause = reason;
  return error;
}

function isAbortFailure(error, signal) {
  return Boolean(
    signal?.aborted ||
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    error?.code === "NAIMAGE_RUN_CANCELLED" ||
    error?.code === "NAIMAGE_RUN_STEERED"
  );
}

function failureKindFor(error) {
  const explicit = String(error?.failureKind || error?.kind || "").trim().toLowerCase();
  if (explicit) return explicit;
  const category = String(error?.errorCategory || error?.category || "").trim().toLowerCase();
  if (["policy", "moderation", "content"].includes(category)) return "content";
  if (["invalid_input", "missing_reference", "validation"].includes(category)) return "validation";
  if ([
    "auth",
    "quota",
    "rate_limit",
    "upstream_402",
    "upstream_5xx",
    "network",
    "timeout",
    "transient",
    "ambiguous"
  ].includes(category)) return "infrastructure";
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  const combined = `${code} ${message}`;
  if (/abort|cancel|steer/.test(combined)) return "abort";
  if (/persist|write|disk|asset|file|enoent|eacces|enospc|checksum|hash/.test(combined)) return "persistence";
  if (/invalid|validate|schema|malformed|empty result|no output/.test(combined)) return "validation";
  if (/moderation|content policy|safety/.test(combined)) return "content";
  if (/rate.?limit|too many requests|quota|insufficient|balance|payment required|unauthorized|forbidden|\b(?:401|402|403|408|425|429|5\d\d)\b/.test(combined)) {
    return "infrastructure";
  }
  if (/\b(?:400|404|409|413|422)\b/.test(combined)) return "validation";
  return "infrastructure";
}

function abortable(factory, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  const guardedFactory = () => {
    if (signal?.aborted) throw abortError(signal);
    return factory();
  };
  if (!signal || typeof signal.addEventListener !== "function") {
    return Promise.resolve().then(guardedFactory);
  }
  let onAbort;
  const cancelled = new Promise((_resolve, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([Promise.resolve().then(guardedFactory), cancelled])
    .finally(() => signal.removeEventListener("abort", onAbort));
}

function validationFailure(validation) {
  const detail = validation && typeof validation === "object" ? validation : {};
  const failureKind = detail.failureKind === "persistence" ? "persistence" : "validation";
  const code = failureKind === "persistence"
    ? "NAIMAGE_BATCH_PERSISTENCE_FAILED"
    : "NAIMAGE_BATCH_RESULT_INVALID";
  const message = detail.reason || detail.error || detail.message || "Image result validation did not pass.";
  return schedulerError(message, code, { failureKind, validation: detail });
}

async function validateSettledValue(validateResult, value, item, index, context, signal) {
  let validation;
  try {
    validation = await abortable(() => validateResult(value, item, index, context), signal);
  } catch (error) {
    if (isAbortFailure(error, signal)) throw error;
    throw schedulerError(error?.message || "Image result validation threw an error.", "NAIMAGE_BATCH_RESULT_INVALID", {
      cause: error,
      failureKind: error?.failureKind === "persistence" ? "persistence" : "validation"
    });
  }
  if (validation === true || validation?.ok === true) return validation === true ? { ok: true } : validation;
  throw validationFailure(validation);
}

function skippedResult(index, code, message, circuit) {
  const reason = schedulerError(message, code, {
    failureKind: "skipped",
    skipped: true,
    itemIndex: index,
    circuit
  });
  return {
    status: "rejected",
    reason,
    failureKind: "skipped",
    skipped: true,
    skipCode: code
  };
}

function createSummary(total, batchSize, probeSize, clusterThreshold, clusterRate, processAdmission) {
  return {
    version: 1,
    status: total ? "running" : "empty",
    total,
    configuredBatchSize: batchSize,
    probe: {
      configuredSize: probeSize,
      targetSize: Math.min(total, probeSize),
      attempted: 0,
      succeeded: 0,
      failed: 0,
      complete: total === 0
    },
    admission: {
      mode: processAdmission ? "process-goal" : "local",
      queued: false,
      acquired: false,
      admitted: false,
      released: false,
      waitMs: 0,
      queueDepthAtEnqueue: 0,
      processCapacity: 0,
      maximumProcessConcurrencyObserved: 0
    },
    ramp: {
      initialConcurrency: Math.min(2, batchSize),
      maximumConcurrency: batchSize,
      expanded: false
    },
    circuit: {
      open: false,
      code: null,
      reason: null,
      failureKind: null,
      waveIndex: null,
      itemIndexes: []
    },
    policy: {
      probeConcurrency: 1,
      clusterFailureThreshold: clusterThreshold,
      clusterFailureRate: clusterRate,
      protectedFailureKinds: [...protectedFailureKinds]
    },
    waves: [],
    attempted: 0,
    fulfilled: 0,
    validated: 0,
    failed: 0,
    rejected: 0,
    skipped: 0,
    maxConcurrentObserved: 0,
    aborted: false
  };
}

function refreshSummary(summary, results) {
  const fulfilled = results.filter((result) => result?.status === "fulfilled").length;
  const skipped = results.filter((result) => result?.skipped === true).length;
  const rejected = results.filter((result) => result?.status === "rejected").length;
  summary.fulfilled = fulfilled;
  summary.validated = fulfilled;
  summary.rejected = rejected;
  summary.skipped = skipped;
  summary.failed = rejected - skipped;
  summary.attempted = results.length - skipped;
  return summary;
}

async function runImageBatchScheduler(options = {}) {
  const items = Array.isArray(options.items) ? options.items : [];
  const batchSize = clampInteger(options.batchSize, 1, maximumBatchSize, 1);
  const configuredProbeSize = clampInteger(options.probeSize, 1, 2, 2);
  const clusterThreshold = clampInteger(options.circuitBreakerFailureThreshold, 2, maximumBatchSize, 2);
  const rawClusterRate = Number(options.circuitBreakerFailureRate);
  const clusterRate = Number.isFinite(rawClusterRate) ? Math.max(0.25, Math.min(1, rawClusterRate)) : 0.5;
  const signal = options.signal;
  const waitUntilRunnable = typeof options.waitUntilRunnable === "function" ? options.waitUntilRunnable : async () => {};
  const runItem = typeof options.runItem === "function" ? options.runItem : async (item) => item;
  const validateResult = options.validateResult;
  const onBatchStart = typeof options.onBatchStart === "function" ? options.onBatchStart : () => {};
  const probeAdmission = options.probeAdmission && typeof options.probeAdmission.acquire === "function"
    ? options.probeAdmission
    : null;
  const onProbeAdmission = typeof options.onProbeAdmission === "function" ? options.onProbeAdmission : () => {};
  const results = Array(items.length);
  const summary = createSummary(items.length, batchSize, configuredProbeSize, clusterThreshold, clusterRate, Boolean(probeAdmission));
  let nextIndex = 0;
  let active = 0;
  let goalLease = null;

  if (!items.length) return { results, summary };
  if (typeof validateResult !== "function") {
    throw schedulerError(
      "runImageBatchScheduler requires an explicit validateResult function before dispatching billable work.",
      "NAIMAGE_BATCH_VALIDATE_REQUIRED",
      { failureKind: "validation" }
    );
  }

  const openCircuit = (code, reason, failureKind, waveIndex, itemIndexes = []) => {
    if (summary.circuit.open) return;
    summary.circuit = {
      open: true,
      code,
      reason: String(reason || "The batch circuit breaker opened."),
      failureKind: failureKind || "infrastructure",
      waveIndex,
      itemIndexes: [...itemIndexes]
    };
    if (
      goalLease &&
      typeof goalLease.tripCircuit === "function" &&
      failureKind !== "abort" &&
      (protectedFailureKinds.has(failureKind) || failureKind === "cluster")
    ) {
      goalLease.tripCircuit({
        code: "NAIMAGE_GOAL_PROCESS_CIRCUIT_OPEN",
        reason: summary.circuit.reason,
        failureKind,
        details: { localCode: code, waveIndex, itemIndexes: [...itemIndexes] }
      });
    }
  };

  const fillSkipped = (code, message) => {
    for (let index = nextIndex; index < items.length; index += 1) {
      results[index] = skippedResult(index, code, message, summary.circuit);
    }
    nextIndex = items.length;
  };

  const executeWave = async (phase, requestedSize) => {
    await abortable(() => waitUntilRunnable(signal), signal);
    if (signal?.aborted) throw abortError(signal);

    let reservation = null;
    if (goalLease && typeof goalLease.reserveWave === "function") {
      reservation = await abortable(() => goalLease.reserveWave({ phase, requestedSize, signal }), signal);
      summary.admission.processCapacity = Number(reservation.processCapacity || goalLease.processCapacity) || 0;
      summary.admission.maximumProcessConcurrencyObserved = Math.max(
        summary.admission.maximumProcessConcurrencyObserved,
        Number(reservation.activeSlotsAtGrant) || 0
      );
    }
    const start = nextIndex;
    const grantedSize = reservation ? Math.max(1, Math.min(requestedSize, Number(reservation.size) || 1)) : requestedSize;
    const batch = items.slice(start, start + grantedSize);
    const waveIndex = summary.waves.length;
    const wave = {
      waveIndex,
      phase,
      start,
      size: batch.length,
      concurrency: phase === "probe" ? 1 : Math.min(requestedSize, batchSize),
      attempted: 0,
      succeeded: 0,
      failed: 0,
      failures: []
    };
    summary.waves.push(wave);
    try {
      await abortable(() => onBatchStart({
        batchIndex: waveIndex,
        waveIndex,
        phase,
        start,
        size: batch.length,
        requestedSize,
        concurrency: wave.concurrency,
        processCapacity: Number(reservation?.processCapacity) || undefined,
        total: items.length
      }), signal);

      nextIndex += batch.length;
      const settled = await Promise.all(batch.map(async (item, offset) => {
        const index = start + offset;
        const dispatchToken = reservation?.item?.(offset) || null;
        const dispatchContext = {
          phase,
          waveIndex,
          signal,
          reportRetry: (details) => dispatchToken?.reportRetry?.(details) || false,
          trackProviderPromise: (providerPromise) => dispatchToken?.track?.(providerPromise) || providerPromise
        };
        active += 1;
        summary.maxConcurrentObserved = Math.max(summary.maxConcurrentObserved, active);
        try {
          if (signal?.aborted) throw abortError(signal);
          const runPromise = Promise.resolve().then(() => runItem(item, index, signal, dispatchContext));
          dispatchToken?.track?.(runPromise);
          const value = await abortable(() => runPromise, signal);
          const validation = await validateSettledValue(validateResult, value, item, index, dispatchContext, signal);
          dispatchToken?.complete?.("fulfilled");
          return { status: "fulfilled", value, validated: true, validation };
        } catch (reason) {
          dispatchToken?.complete?.(isAbortFailure(reason, signal) ? "aborted" : "rejected");
          return {
            status: "rejected",
            reason,
            failureKind: failureKindFor(reason),
            skipped: false
          };
        } finally {
          active -= 1;
        }
      }));

      settled.forEach((result, offset) => {
        const index = start + offset;
        results[index] = result;
        wave.attempted += 1;
        if (result.status === "fulfilled") {
          wave.succeeded += 1;
        } else {
          wave.failed += 1;
          wave.failures.push({
            itemIndex: index,
            code: result.reason?.code || null,
            failureKind: result.failureKind,
            message: String(result.reason?.message || result.reason || "Image request failed.")
          });
        }
      });

      if (phase === "probe") {
        summary.probe.attempted += wave.attempted;
        summary.probe.succeeded += wave.succeeded;
        summary.probe.failed += wave.failed;
      } else if (wave.concurrency > 1) {
        summary.ramp.expanded = true;
      }
      return wave;
    } finally {
      reservation?.releaseUnused?.(signal?.aborted ? "aborted-before-dispatch" : "wave-finished");
    }
  };

  const executeOrOpenCircuit = async (phase, size) => {
    try {
      return await executeWave(phase, size);
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      const failureKind = failureKindFor(error);
      openCircuit(
        "NAIMAGE_BATCH_ORCHESTRATION_FAILED",
        error?.message || String(error),
        failureKind,
        summary.waves.length ? summary.waves.length - 1 : 0
      );
      fillSkipped("NAIMAGE_BATCH_CIRCUIT_OPEN", "The image batch stopped before the next request could be dispatched.");
      return null;
    }
  };

  const closeGoalAdmission = (reason) => {
    if (!goalLease) return false;
    const released = typeof goalLease.close === "function"
      ? goalLease.close(reason)
      : goalLease.release(reason);
    goalLease = null;
    summary.admission.released = true;
    return released;
  };

  try {
    const probeTarget = Math.min(items.length, configuredProbeSize);
    if (probeAdmission) {
      await abortable(() => waitUntilRunnable(signal), signal);
      summary.admission.queued = true;
      await abortable(() => onProbeAdmission({
        phase: "queued",
        mode: "process-goal",
        total: items.length,
        probeTarget
      }), signal);
      goalLease = await abortable(() => probeAdmission.acquire({
        ...(options.probeAdmissionContext && typeof options.probeAdmissionContext === "object"
          ? options.probeAdmissionContext
          : {}),
        configuredConcurrency: batchSize,
        processCapacity: options.processCapacity || batchSize,
        signal
      }), signal);
      summary.admission.queued = false;
      summary.admission.acquired = true;
      summary.admission.mode = goalLease.mode || "process-goal";
      summary.admission.processCapacity = Number(goalLease.processCapacity) || 0;
      summary.admission.waitMs = Number(goalLease.waitMs) || 0;
      summary.admission.queueDepthAtEnqueue = Number(goalLease.queueDepthAtEnqueue) || 0;
      await abortable(() => onProbeAdmission({
        phase: "acquired",
        mode: summary.admission.mode,
        total: items.length,
        probeTarget,
        waitMs: summary.admission.waitMs,
        queueDepthAtEnqueue: summary.admission.queueDepthAtEnqueue
      }), signal);
    }
    try {
      while (summary.probe.attempted < probeTarget && !summary.circuit.open) {
        const wave = await executeOrOpenCircuit("probe", 1);
        if (!wave) break;
        if (signal?.aborted) throw abortError(signal);
        if (wave.failed > 0) {
          const failure = wave.failures[0];
          openCircuit(
            "NAIMAGE_BATCH_PROBE_FAILED",
            failure?.message || "A probe request failed.",
            failure?.failureKind || "infrastructure",
            wave.waveIndex,
            wave.failures.map((item) => item.itemIndex)
          );
          fillSkipped("NAIMAGE_BATCH_PROBE_FAILED", "The probe did not pass; remaining image requests were not dispatched.");
        }
      }
      summary.probe.complete = summary.probe.succeeded === probeTarget;
    } finally {
      if (summary.probe.complete && !summary.circuit.open && typeof goalLease?.admit === "function") {
        await abortable(() => goalLease.admit(), signal);
        summary.admission.admitted = true;
      }
    }

    let waveSize = Math.min(2, batchSize);
    while (nextIndex < items.length && !summary.circuit.open) {
      const wave = await executeOrOpenCircuit("ramp", Math.min(waveSize, items.length - nextIndex));
      if (!wave) break;
      if (signal?.aborted) throw abortError(signal);
      const protectedFailure = wave.failures.find((failure) => protectedFailureKinds.has(failure.failureKind));
      const clusteredFailure = wave.failed >= clusterThreshold && wave.failed / Math.max(1, wave.attempted) >= clusterRate;
      if (protectedFailure || clusteredFailure) {
        const code = protectedFailure
          ? "NAIMAGE_BATCH_PROTECTED_FAILURE"
          : "NAIMAGE_BATCH_FAILURE_CLUSTER";
        openCircuit(
          code,
          protectedFailure?.message || `${wave.failed}/${wave.attempted} requests failed in one wave.`,
          protectedFailure?.failureKind || "cluster",
          wave.waveIndex,
          wave.failures.map((item) => item.itemIndex)
        );
        fillSkipped("NAIMAGE_BATCH_CIRCUIT_OPEN", "The image batch circuit breaker opened; remaining requests were not dispatched.");
        break;
      }
      waveSize = Math.min(batchSize, Math.max(1, waveSize * 2));
    }

    refreshSummary(summary, results);
    summary.status = summary.circuit.open
      ? summary.circuit.code === "NAIMAGE_BATCH_PROBE_FAILED" ? "probe-failed" : "circuit-open"
      : summary.failed > 0 ? "completed-with-errors" : "completed";
    return { results, summary };
  } catch (error) {
    if (!isAbortFailure(error, signal)) throw error;
    openCircuit(
      "NAIMAGE_BATCH_ABORTED",
      error?.message || "The image batch was cancelled.",
      "abort",
      summary.waves.length ? summary.waves.length - 1 : 0
    );
    fillSkipped("NAIMAGE_BATCH_ABORTED", "The image batch was cancelled before this request was dispatched.");
    refreshSummary(summary, results);
    summary.status = "aborted";
    summary.aborted = true;
    const cancelled = abortError(signal, error);
    cancelled.results = results;
    cancelled.summary = summary;
    throw cancelled;
  } finally {
    closeGoalAdmission(summary.aborted ? "aborted" : summary.circuit.open ? "circuit-open" : "goal-complete");
  }
}

module.exports = {
  maximumBatchSize,
  runImageBatchScheduler
};
