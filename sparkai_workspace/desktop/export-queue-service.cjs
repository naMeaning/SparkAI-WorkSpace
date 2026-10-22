"use strict";

const { randomUUID, createHash } = require("node:crypto");

const EXPORT_QUEUE_OWNER = "desktop/export-queue-service.cjs";
const MAX_ITEMS = 10_000;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function cleanTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) fail("EXPORT_TARGET_INVALID", "导出目标授权引用无效。");
  const kind = String(target.kind || "");
  if (!["project", "authorized-directory"].includes(kind)) fail("EXPORT_TARGET_INVALID", "导出目标必须是项目目录或 Main 授权目录引用。");
  if (kind === "project" && (!target.projectId || !target.relativePath || String(target.relativePath).split(/[\\/]/).some((part) => part === ".."))) fail("EXPORT_TARGET_INVALID", "项目导出目标缺少安全相对路径。");
  if (kind === "authorized-directory" && !target.authorizationId) fail("EXPORT_TARGET_INVALID", "项目外导出目标缺少 Main 授权引用。");
  return Object.freeze(clone(target));
}

function freezeSnapshot(input = {}) {
  const target = cleanTarget(input.target);
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length || items.length > MAX_ITEMS) fail("EXPORT_QUEUE_ITEMS_INVALID", "导出队列项目数量无效。");
  const snapshot = {
    projectId: String(input.projectId || ""),
    selectionRevision: Number(input.selectionRevision || 0),
    target,
    params: clone(input.params || {}),
    items: items.map((item, index) => ({
      index,
      assetId: String(item.assetId || ""),
      occurrenceId: String(item.occurrenceId || ""),
      contentHash: String(item.contentHash || "").toLowerCase(),
      name: String(item.name || `image-${index + 1}`),
      payload: clone(item.payload ?? item.asset ?? undefined)
    })),
    createdAt: new Date().toISOString()
  };
  if (!snapshot.projectId || snapshot.items.some((item) => !item.assetId || !/^[a-f0-9]{64}$/.test(item.contentHash))) fail("EXPORT_QUEUE_SNAPSHOT_INVALID", "导出队列必须冻结项目与资产哈希。");
  return Object.freeze({ ...snapshot, snapshotHash: digest(snapshot) });
}

function publicItem(item) {
  const { payload, asset, ...safe } = item || {};
  return safe;
}

function publicJob(job) {
  const { controller, snapshot, ...safe } = job;
  return clone({
    ...safe,
    snapshot: snapshot ? { ...snapshot, items: snapshot.items.map(publicItem) } : undefined,
    results: Array.isArray(job.results) ? job.results.map((result) => clone(result)) : []
  });
}

function createExportQueueService({ execute, persist = async () => {} } = {}) {
  if (typeof execute !== "function") throw new TypeError("export queue execute is required");
  const jobs = new Map();
  let active = null;
  let receiptBlocked = false;
  let wake = null;
  const notify = () => { const fn = wake; wake = null; fn?.(); };
  async function persistJob(job) { await persist(publicJob(job)); }

  async function pump() {
    if (active || receiptBlocked) return;
    const next = [...jobs.values()].find((job) => job.status === "queued");
    if (!next) return;
    active = next;
    next.status = "running";
    next.startedAt ||= new Date().toISOString();
    try {
      await persistJob(next);
      for (let index = 0; index < next.snapshot.items.length; index += 1) {
        if (next.cancelRequested || next.controller.signal.aborted) break;
        if (next.retryOnlyFailed && next.results[index]?.ok !== false) {
          next.completed = Math.max(next.completed, index + 1);
          continue;
        }
        next.itemIndex = index;
        await persistJob(next);
        try {
          const result = await execute(clone(next.snapshot), {
            signal: next.controller.signal,
            item: clone(next.snapshot.items[index]),
            index
          });
          next.results[index] = clone(result);
        } catch (error) {
          next.results[index] = { ok: false, errorCode: String(error?.code || "EXPORT_FAILED"), error: String(error?.message || error) };
        }
        next.completed = Math.max(next.completed, index + 1);
        await persistJob(next);
      }
      if (next.cancelRequested || next.controller.signal.aborted) next.status = "cancelled";
      else if (next.results.some((result) => result && result.ok === false)) next.status = "failed";
      else next.status = "succeeded";
    } catch (error) {
      next.status = "failed";
      next.error = { code: String(error?.code || "EXPORT_PERSIST_FAILED"), message: "导出记录保存失败，队列已停止。" };
      for (let index = 0; index < next.snapshot.items.length; index += 1) {
        if (!next.results[index]) next.results[index] = { ok: false, errorCode: "EXPORT_PERSIST_FAILED", error: next.error.message };
      }
    } finally {
      next.finishedAt = new Date().toISOString();
      next.itemIndex = undefined;
      next.retryOnlyFailed = false;
      try { await persistJob(next); } catch { receiptBlocked = true; }
      active = null;
      notify();
      void pump();
    }
  }

  async function enqueue(input) {
    if (jobs.size >= 500) fail("EXPORT_QUEUE_FULL", "当前 Main 导出记录已达上限，请重启后查看项目历史。");
    const snapshot = freezeSnapshot(input);
    const job = { id: `export-${randomUUID()}`, snapshot, status: "queued", completed: 0, results: [], cancelRequested: false, controller: new AbortController() };
    jobs.set(job.id, job);
    try { await persistJob(job); } catch (error) { jobs.delete(job.id); throw error; }
    receiptBlocked = false;
    void pump();
    return publicJob(job);
  }

  async function cancel(jobId) {
    const job = jobs.get(String(jobId));
    if (!job) return { ok: false, code: "EXPORT_JOB_NOT_FOUND" };
    if (["queued", "running"].includes(job.status)) {
      job.cancelRequested = true;
      job.controller.abort();
      if (job.status === "queued") { job.status = "cancelled"; job.finishedAt = new Date().toISOString(); }
    }
    await persistJob(job);
    notify();
    return { ok: true, ...publicJob(job) };
  }

  async function retryFailed(jobId) {
    const selected = jobId ? [jobs.get(String(jobId))].filter(Boolean) : [...jobs.values()];
    const retried = [];
    for (const job of selected) {
      if (job.status !== "failed" || !job.results.some(result => result?.ok === false)) continue;
      job.status = "queued";
      job.cancelRequested = false;
      job.controller = new AbortController();
      job.retryOnlyFailed = true;
      job.finishedAt = undefined;
      job.error = undefined;
      await persistJob(job);
      receiptBlocked = false;
      retried.push(publicJob(job));
    }
    void pump();
    return retried;
  }

  async function waitForIdle(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while ([...jobs.values()].some((job) => ["queued", "running"].includes(job.status))) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 50); });
    }
    return true;
  }

  return { owner: EXPORT_QUEUE_OWNER, enqueue, cancel, retryFailed, waitForIdle, get: (id) => jobs.get(String(id)) ? publicJob(jobs.get(String(id))) : null, list: () => [...jobs.values()].map(publicJob), freezeSnapshot };
}

module.exports = { EXPORT_QUEUE_OWNER, createExportQueueService, freezeSnapshot };
