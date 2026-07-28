"use strict";

function clean(value) {
  return String(value || "").trim();
}

function scopeKey(value = {}) {
  return `${clean(value.projectId) || "default"}::${clean(value.conversationId) || "default"}`;
}

function createAbortError(reason = "任务已结束。") {
  const error = reason instanceof Error ? reason : new Error(clean(reason) || "任务已结束。");
  error.name = "AbortError";
  error.code = "NAIMAGE_RUN_CANCELLED";
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
      paused: false,
      waiters: new Set()
    });
    return scopeState.get(key);
  }

  function snapshot(projectId = "") {
    const project = clean(projectId);
    const activeRuns = [...runs.values()]
      .filter((run) => !project || run.projectId === project)
      .map((run) => ({
        runId: run.runId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        nodeIds: [...run.nodeIds],
        paused: stateFor(run).paused,
        startedAt: run.startedAt,
      }));
    return {
      ok: true,
      runs: activeRuns,
      lockedNodeIds: [...new Set(activeRuns.flatMap((run) => run.nodeIds))],
      pausedScopes: [...scopeState.values()]
        .filter((state) => state.paused && (!project || state.projectId === project))
        .map((state) => ({ projectId: state.projectId, conversationId: state.conversationId })),
    };
  }

  function changed() {
    // Every renderer receives the complete run map and filters it by its own
    // project. A project-scoped empty update is otherwise indistinguishable
    // from "all runs finished" and can incorrectly clear another window's locks.
    onChange(snapshot());
  }

  function begin(value = {}) {
    const runId = clean(value.runId) || `run-${Date.now()}`;
    const projectId = clean(value.projectId) || "default";
    const conversationId = clean(value.conversationId) || "default";
    const nodeIds = new Set((Array.isArray(value.nodeIds) ? value.nodeIds : []).map(clean).filter(Boolean));
    const owner = scopeKey({ projectId, conversationId });
    const conflict = [...runs.values()].find((run) => (
      run.projectId === projectId && scopeKey(run) !== owner && [...nodeIds].some((nodeId) => run.nodeIds.has(nodeId))
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
      let changedNodes = false;
      for (const nodeId of nodeIds) {
        if (existing.nodeIds.has(nodeId)) continue;
        existing.nodeIds.add(nodeId);
        changedNodes = true;
      }
      existing.references += 1;
      if (changedNodes) changed();
      return existing;
    }
    const controller = new AbortController();
    const record = { runId, projectId, conversationId, nodeIds, controller, signal: controller.signal, startedAt: Date.now(), references: 1 };
    runs.set(runId, record);
    stateFor(record);
    changed(projectId);
    return record;
  }

  function finish(value = {}) {
    const runId = clean(value.runId);
    const record = runs.get(runId);
    if (!record) return false;
    record.references -= 1;
    if (record.references > 0) return false;
    runs.delete(runId);
    changed(record.projectId);
    return true;
  }

  function matching(value = {}) {
    const runId = clean(value.runId);
    const key = scopeKey(value);
    return [...runs.values()].filter((run) => runId ? run.runId === runId : scopeKey(run) === key);
  }

  function pause(value = {}) {
    const state = stateFor(value);
    state.paused = true;
    changed();
    return snapshot(clean(value.projectId));
  }

  function resume(value = {}) {
    const state = stateFor(value);
    state.paused = false;
    for (const resolve of state.waiters) resolve();
    state.waiters.clear();
    changed();
    return snapshot(clean(value.projectId));
  }

  function stop(value = {}) {
    const targets = matching(value);
    const error = createAbortError(value.reason || "用户结束了当前任务。");
    for (const record of targets) {
      if (!record.signal.aborted) record.controller.abort(error);
      runs.delete(record.runId);
    }
    resume(value);
    return { ...snapshot(clean(value.projectId)), stopped: targets.length };
  }

  async function waitUntilRunnable(value = {}, signal) {
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

  return { begin, finish, pause, resume, stop, snapshot, waitUntilRunnable, createAbortError };
}

module.exports = { createAgentRunControl, createAbortError, scopeKey };
