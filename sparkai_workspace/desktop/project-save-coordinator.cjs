"use strict";

function normalizeSessionRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function createProjectSaveCoordinator(options = {}) {
  const queues = new Map();
  const revisions = new Map();
  const initialRevision = typeof options.initialRevision === "function" ? options.initialRevision : () => 0;

  function enqueue(projectId, requestedRevision, apply) {
    const key = String(projectId || "").trim();
    if (!key) {
      return Promise.resolve({ ok: false, errorCode: "PROJECT_REQUIRED", error: "保存会话前必须指定项目。", appliedRevision: 0, skippedStale: false });
    }
    const explicitRevision = requestedRevision === undefined || requestedRevision === null || requestedRevision === ""
      ? null
      : normalizeSessionRevision(requestedRevision);
    if (explicitRevision === null && requestedRevision !== undefined && requestedRevision !== null && requestedRevision !== "") {
      return Promise.resolve({ ok: false, error: "session revision 必须是非负安全整数。", appliedRevision: revisions.get(key) ?? 0, skippedStale: false });
    }
    const previous = queues.get(key) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      if (!revisions.has(key)) revisions.set(key, normalizeSessionRevision(await initialRevision(key)) ?? 0);
      const currentRevision = revisions.get(key) || 0;
      if (explicitRevision !== null && explicitRevision <= currentRevision) {
        return { ok: true, appliedRevision: currentRevision, requestedRevision: explicitRevision, skippedStale: true };
      }
      const nextRevision = explicitRevision ?? currentRevision + 1;
      const result = await apply(nextRevision, currentRevision);
      if (result?.applied === false) {
        return { ...result, ok: result.ok !== false, appliedRevision: currentRevision, requestedRevision: explicitRevision, skippedStale: false };
      }
      revisions.set(key, nextRevision);
      return { ...result, ok: result?.ok !== false, appliedRevision: nextRevision, requestedRevision: explicitRevision, skippedStale: false };
    });
    queues.set(key, task);
    task.then(
      () => { if (queues.get(key) === task) queues.delete(key); },
      () => { if (queues.get(key) === task) queues.delete(key); }
    );
    return task;
  }

  return {
    enqueue,
    revision(projectId) {
      const key = String(projectId || "").trim();
      return key ? revisions.get(key) ?? null : null;
    },
    pendingProjectCount() {
      return queues.size;
    }
  };
}

module.exports = {
  createProjectSaveCoordinator,
  normalizeSessionRevision
};
