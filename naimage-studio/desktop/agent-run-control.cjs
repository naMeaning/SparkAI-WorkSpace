"use strict";

function clean(value) {
  return String(value || "").trim();
}

const MAX_STEER_PROMPT_CHARS = 36_000;

function taskScopeLockedNodeIds(taskScope = {}) {
  if (!taskScope || typeof taskScope !== "object" || Array.isArray(taskScope)) return new Set();
  return new Set([
    ...(Array.isArray(taskScope.sourceNodeIds) ? taskScope.sourceNodeIds : []),
    ...(Array.isArray(taskScope.sourceContainerIds) ? taskScope.sourceContainerIds : []),
    ...(taskScope.origin === "goal" && taskScope.goal?.target === "all-image-containers" && Array.isArray(taskScope.goal.containerIds)
      ? taskScope.goal.containerIds.slice(0, 200)
      : []),
    taskScope.requirement?.nodeId
  ].map(clean).filter(Boolean));
}

function scopeKey(value = {}) {
  const base = `${clean(value.projectId) || "default"}::${clean(value.conversationId) || "default"}`;
  const ownerId = runOwnerId(value);
  return ownerId ? `${base}::owner:${ownerId}` : base;
}

function runOwnerId(value = {}) {
  return clean(value && typeof value === "object" ? value.ownerId : value);
}

function createAbortError(reason = "任务已结束。") {
  const error = reason instanceof Error ? reason : new Error(clean(reason) || "任务已结束。");
  error.name = "AbortError";
  error.code = "NAIMAGE_RUN_CANCELLED";
  return error;
}

function createSteerError(reason = "用户修改了当前任务要求。") {
  const error = reason instanceof Error ? reason : new Error(clean(reason) || "用户修改了当前任务要求。");
  error.name = "AbortError";
  error.code = "NAIMAGE_RUN_STEERED";
  return error;
}

function createAgentRunControl(options = {}) {
  const runs = new Map();
  const scopeState = new Map();
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  function stateFor(scope) {
    const key = scopeKey(scope);
    if (!scopeState.has(key)) scopeState.set(key, {
      projectId: clean(scope?.projectId) || "default",
      conversationId: clean(scope?.conversationId) || "default",
      ownerId: runOwnerId(scope),
      paused: false,
      waiters: new Set()
    });
    return scopeState.get(key);
  }

  function releaseScopeIfUnused(scope) {
    const key = scopeKey(scope);
    if ([...runs.values()].some((run) => scopeKey(run) === key)) return false;
    const state = scopeState.get(key);
    if (!state) return false;
    state.paused = false;
    for (const resolve of state.waiters) resolve();
    state.waiters.clear();
    scopeState.delete(key);
    return true;
  }

  function snapshot(projectId = "", viewerOwner = "") {
    const project = clean(projectId);
    const viewerOwnerId = runOwnerId(viewerOwner);
    const activeRuns = [...runs.values()]
      .filter((run) => !project || run.projectId === project)
      .map((run) => ({
        runId: run.runId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        ownerId: run.ownerId || undefined,
        nodeIds: [...run.nodeIds],
        paused: (!viewerOwnerId || !run.ownerId || run.ownerId === viewerOwnerId) && stateFor(run).paused,
        steerable: run.steerable,
        queuedSteerCount: run.steers.length,
        taskScopeSnapshotHash: clean(run.taskScope?.snapshotHash) || undefined,
        phase: [...new Set([...run.phases.values()].map((phase) => phase.kind).filter(Boolean))].join("+") || undefined,
        startedAt: run.startedAt
      }));
    return {
      ok: true,
      runs: activeRuns,
      scopeCount: scopeState.size,
      lockedNodeIds: [...new Set(activeRuns.flatMap((run) => run.nodeIds))],
      pausedScopes: [...scopeState.values()]
        .filter((state) => (
          state.paused &&
          (!project || state.projectId === project) &&
          (!viewerOwnerId || !state.ownerId || state.ownerId === viewerOwnerId)
        ))
        .map((state) => ({
          projectId: state.projectId,
          conversationId: state.conversationId,
          ...(state.ownerId ? { ownerId: state.ownerId } : {})
        }))
    };
  }

  function changed() {
    // Every renderer receives the complete run map and filters by project.
    onChange(snapshot());
  }

  function begin(value = {}) {
    const runId = clean(value.runId) || `run-${Date.now()}`;
    const projectId = clean(value.projectId) || "default";
    const conversationId = clean(value.conversationId) || "default";
    const ownerId = runOwnerId(value);
    const taskScopeNodeIds = taskScopeLockedNodeIds(value.taskScope);
    const nodeIds = new Set([
      ...(Array.isArray(value.nodeIds) ? value.nodeIds : []),
      ...taskScopeNodeIds
    ].map(clean).filter(Boolean));
    const owner = scopeKey({ projectId, conversationId, ownerId });
    const conflict = [...runs.values()].find((run) => (
      run.runId !== runId && run.projectId === projectId && scopeKey(run) !== owner && [...nodeIds].some((nodeId) => run.nodeIds.has(nodeId))
    ));
    if (conflict) {
      const error = new Error(`节点 ${[...nodeIds].find((nodeId) => conflict.nodeIds.has(nodeId)) || ""} 正由另一个会话处理。`);
      error.code = "NAIMAGE_NODE_LOCKED";
      throw error;
    }
    const existing = runs.get(runId);
    if (existing) {
      if (existing.projectId !== projectId || existing.conversationId !== conversationId) {
        const error = new Error(`运行标识 ${runId} 已由另一个项目或会话占用。`);
        error.code = "NAIMAGE_RUN_ID_CONFLICT";
        throw error;
      }
      if (existing.ownerId !== ownerId) {
        const error = new Error(`运行标识 ${runId} 已由另一个窗口占用。`);
        error.code = "NAIMAGE_RUN_OWNER_CONFLICT";
        throw error;
      }
      let changedNodes = false;
      if (value.taskScope && typeof value.taskScope === "object") {
        for (const nodeId of nodeIds) {
          if (!taskScopeNodeIds.has(nodeId)) existing.retainedNodeIds.add(nodeId);
        }
        existing.taskScopeNodeIds = taskScopeNodeIds;
        const nextNodeIds = new Set([...existing.retainedNodeIds, ...taskScopeNodeIds]);
        changedNodes = nextNodeIds.size !== existing.nodeIds.size || [...nextNodeIds].some((nodeId) => !existing.nodeIds.has(nodeId));
        existing.nodeIds = nextNodeIds;
      } else {
        for (const nodeId of nodeIds) {
          if (existing.nodeIds.has(nodeId)) continue;
          existing.nodeIds.add(nodeId);
          existing.retainedNodeIds.add(nodeId);
          changedNodes = true;
        }
      }
      existing.references += 1;
      existing.steerable = existing.steerable || value.steerable === true;
      if (value.taskScope && typeof value.taskScope === "object") existing.taskScope = value.taskScope;
      if (Array.isArray(value.nodes)) existing.nodes = value.nodes;
      if (changedNodes) changed();
      return existing;
    }
    const controller = new AbortController();
    const record = {
      runId,
      projectId,
      conversationId,
      ownerId,
      nodeIds,
      controller,
      signal: controller.signal,
      startedAt: Date.now(),
      references: 1,
      steerable: value.steerable === true,
      taskScope: value.taskScope && typeof value.taskScope === "object" ? value.taskScope : undefined,
      taskScopeNodeIds,
      retainedNodeIds: new Set([...nodeIds].filter((nodeId) => !taskScopeNodeIds.has(nodeId))),
      nodes: Array.isArray(value.nodes) ? value.nodes : undefined,
      steers: [],
      phases: new Map(),
      phaseSequence: 0
    };
    runs.set(runId, record);
    stateFor(record);
    changed();
    return record;
  }

  function finish(value = {}) {
    const runId = clean(value.runId);
    const record = runs.get(runId);
    if (!record) return false;
    record.references -= 1;
    if (record.references > 0) return false;
    for (const phase of record.phases.values()) phase.finish();
    runs.delete(runId);
    releaseScopeIfUnused(record);
    changed();
    return true;
  }

  function matching(value = {}) {
    const runId = clean(value.runId);
    const projectId = clean(value.projectId);
    const conversationId = clean(value.conversationId);
    const ownerId = runOwnerId(value);
    const key = scopeKey(value);
    return [...runs.values()].filter((run) => runId
      ? run.runId === runId && (!projectId || run.projectId === projectId) && (!conversationId || run.conversationId === conversationId) && (!ownerId || run.ownerId === ownerId)
      : scopeKey(run) === key && (!ownerId || run.ownerId === ownerId)
    );
  }

  function pause(value = {}) {
    const targets = matching(value);
    for (const record of targets) stateFor(record).paused = true;
    changed();
    return snapshot(clean(value.projectId));
  }

  function resume(value = {}) {
    const states = new Set(matching(value).map((record) => stateFor(record)));
    const directState = scopeState.get(scopeKey(value));
    if (directState) states.add(directState);
    for (const state of states) {
      state.paused = false;
      for (const resolve of state.waiters) resolve();
      state.waiters.clear();
    }
    releaseScopeIfUnused(value);
    changed();
    return snapshot(clean(value.projectId));
  }

  function stopRecords(targets, error) {
    const affectedScopes = new Map();
    for (const record of targets) {
      affectedScopes.set(scopeKey(record), record);
      if (!record.signal.aborted) record.controller.abort(error);
      for (const phase of record.phases.values()) {
        record.signal.removeEventListener("abort", phase.hardAbort);
      }
      record.phases.clear();
      runs.delete(record.runId);
    }
    for (const scope of affectedScopes.values()) releaseScopeIfUnused(scope);
    return targets.length;
  }

  function stop(value = {}) {
    const targets = matching(value);
    const error = createAbortError(value.reason || "用户结束了当前任务。");
    const stopped = stopRecords(targets, error);
    if (!stopped) releaseScopeIfUnused(value);
    changed();
    return { ...snapshot(clean(value.projectId)), stopped };
  }

  function stopOwner(value = {}, fallbackReason = "Agent 窗口已关闭，运行已停止。") {
    const ownerId = runOwnerId(value);
    if (!ownerId) return { ...snapshot(clean(value?.projectId)), stopped: 0, ownerId: "" };
    const reason = value && typeof value === "object" ? value.reason : fallbackReason;
    const targets = [...runs.values()].filter((record) => record.ownerId === ownerId);
    const stopped = stopRecords(targets, createAbortError(reason || fallbackReason));
    changed();
    return { ...snapshot(clean(value?.projectId)), stopped, ownerId };
  }

  function stopAll(reason = "naimage 正在退出，所有 Agent 运行已停止。") {
    const targets = [...runs.values()];
    const stopped = stopRecords(targets, createAbortError(reason));
    for (const state of scopeState.values()) {
      state.paused = false;
      for (const resolve of state.waiters) resolve();
      state.waiters.clear();
    }
    scopeState.clear();
    changed();
    return { ...snapshot(), stopped };
  }

  function isRunnable(value = {}) {
    const record = runs.get(clean(value.runId));
    return Boolean(record && !record.signal.aborted && (!runOwnerId(value) || record.ownerId === runOwnerId(value)));
  }

  function beginPhase(value = {}, meta = {}) {
    const record = runs.get(clean(value.runId));
    if (!record) {
      const controller = new AbortController();
      controller.abort(createAbortError("运行已结束。"));
      return { phaseId: "missing", signal: controller.signal, steered: false, finish: () => false };
    }
    record.phaseSequence += 1;
    const phaseId = clean(meta.phaseId) || `${record.runId}:phase:${record.phaseSequence}`;
    const controller = new AbortController();
    const phase = {
      phaseId,
      kind: clean(meta.kind) || "work",
      controller,
      steered: false,
      hardAbort: null,
      finish: null
    };
    phase.hardAbort = () => {
      if (!controller.signal.aborted) controller.abort(record.signal.reason || createAbortError());
    };
    phase.finish = () => {
      record.signal.removeEventListener("abort", phase.hardAbort);
      const removed = record.phases.delete(phaseId);
      if (removed) changed();
      return removed;
    };
    if (record.signal.aborted) phase.hardAbort();
    else if (record.steers.length) {
      phase.steered = true;
      controller.abort(createSteerError(record.steers[record.steers.length - 1]?.prompt));
    }
    else record.signal.addEventListener("abort", phase.hardAbort, { once: true });
    record.phases.set(phaseId, phase);
    changed();
    return {
      phaseId,
      signal: controller.signal,
      get steered() { return phase.steered; },
      finish: phase.finish
    };
  }

  function steer(value = {}, normalizeTaskScopeUpdate) {
    const prompt = clean(value.prompt);
    if (!prompt) return { ...snapshot(clean(value.projectId)), accepted: 0, interrupted: 0, error: "修改需求不能为空。" };
    if (prompt.length > MAX_STEER_PROMPT_CHARS) {
      return {
        ...snapshot(clean(value.projectId)),
        accepted: 0,
        interrupted: 0,
        error: `修改需求不能超过 ${MAX_STEER_PROMPT_CHARS} 个字符。`
      };
    }
    const targets = matching(value).filter((record) => record.steerable);
    const prepared = targets.map((record) => {
      const update = typeof normalizeTaskScopeUpdate === "function"
        ? normalizeTaskScopeUpdate(record.taskScope, value.taskScopeUpdate)
        : {
            sourceMode: "keep",
            referenceMode: "keep",
            taskScope: record.taskScope
          };
      if (!update || typeof update !== "object" || (
        typeof normalizeTaskScopeUpdate === "function" && (!update.taskScope || typeof update.taskScope !== "object")
      )) {
        throw new Error("TaskScope 修改协议没有生成有效的新快照。");
      }
      const taskScopeNodeIds = taskScopeLockedNodeIds(update.taskScope);
      const nodeIds = new Set([...record.retainedNodeIds, ...taskScopeNodeIds]);
      const owner = scopeKey(record);
      const conflict = [...runs.values()].find((candidate) => (
        candidate !== record &&
        candidate.projectId === record.projectId &&
        scopeKey(candidate) !== owner &&
        [...nodeIds].some((nodeId) => candidate.nodeIds.has(nodeId))
      ));
      if (conflict) {
        const nodeId = [...nodeIds].find((candidate) => conflict.nodeIds.has(candidate)) || "";
        const error = new Error(`节点 ${nodeId} 正由另一个会话处理，不能替换当前 TaskScope。`);
        error.code = "NAIMAGE_NODE_LOCKED";
        throw error;
      }
      return { record, update, taskScopeNodeIds, nodeIds };
    });
    let interrupted = 0;
    let taskScopeSnapshotHash = "";
    for (const { record, update, taskScopeNodeIds, nodeIds } of prepared) {
      // Persist the authoritative snapshot before aborting the current child
      // phase so the continuation can never observe a half-applied steer.
      if (update.taskScope && typeof update.taskScope === "object") {
        record.taskScope = update.taskScope;
        record.taskScopeNodeIds = taskScopeNodeIds;
        record.nodeIds = nodeIds;
        taskScopeSnapshotHash = clean(update.taskScope.snapshotHash);
      }
      if (Array.isArray(update.nodes)) record.nodes = update.nodes;
      record.steers.push({
        id: `${record.runId}:steer:${Date.now()}:${record.steers.length + 1}`,
        prompt,
        taskScopeUpdate: {
          sourceMode: update.sourceMode,
          referenceMode: update.referenceMode
        },
        ...(update.taskScope ? { taskScope: update.taskScope } : {}),
        ...(Array.isArray(update.nodes) ? { nodes: update.nodes } : {}),
        createdAt: new Date().toISOString()
      });
      record.steers = record.steers.slice(-24);
      for (const phase of record.phases.values()) {
        if (phase.controller.signal.aborted) continue;
        phase.steered = true;
        phase.controller.abort(createSteerError(prompt));
        interrupted += 1;
      }
    }
    changed();
    return {
      ...snapshot(clean(value.projectId)),
      accepted: targets.length,
      interrupted,
      ...(taskScopeSnapshotHash ? { taskScopeSnapshotHash } : {}),
      ...(targets.length ? {} : { error: "当前会话没有可接收修改的 Agent 任务。" })
    };
  }

  function consumeSteers(value = {}) {
    const record = runs.get(clean(value.runId));
    if (!record || !record.steers.length) return [];
    const queued = record.steers.splice(0, record.steers.length);
    changed();
    return queued;
  }

  async function waitUntilRunnable(value = {}, signal) {
    if (clean(value.runId) && !runs.has(clean(value.runId))) throw createAbortError("运行已结束。");
    const state = stateFor(value);
    while (state.paused) {
      if (signal?.aborted) throw createAbortError(signal.reason);
      await new Promise((resolve, reject) => {
        const done = () => {
          signal?.removeEventListener?.("abort", aborted);
          resolve();
        };
        const aborted = () => {
          state.waiters.delete(done);
          reject(createAbortError(signal?.reason));
        };
        state.waiters.add(done);
        signal?.addEventListener?.("abort", aborted, { once: true });
      });
    }
    if (signal?.aborted) throw createAbortError(signal.reason);
  }

  return {
    begin,
    finish,
    pause,
    resume,
    stop,
    stopOwner,
    stopAll,
    isRunnable,
    steer,
    beginPhase,
    consumeSteers,
    snapshot,
    waitUntilRunnable,
    createAbortError,
    createSteerError
  };
}

module.exports = { createAgentRunControl, createAbortError, createSteerError, scopeKey };
