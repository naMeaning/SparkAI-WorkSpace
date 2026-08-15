"use strict";

const { createHash } = require("node:crypto");
const { fork } = require("node:child_process");
const {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
} = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_EDGE = 512;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_EDGE_LIMIT = 4096;
const DEFAULT_MAX_CACHE_FILES = 512;
const DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

class ThumbnailCacheError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ThumbnailCacheError";
    this.code = code || "THUMBNAIL_CACHE_FAILED";
    if (details !== undefined) this.details = details;
  }
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathInside(filePath, rootPath) {
  const file = comparablePath(filePath);
  const root = comparablePath(rootPath);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function normalizeMaxEdge(value) {
  const number = value === undefined || value === null || value === "" ? DEFAULT_MAX_EDGE : Number(value);
  if (!Number.isSafeInteger(number) || number < 64 || number > MAX_EDGE_LIMIT) {
    throw new ThumbnailCacheError("THUMBNAIL_INVALID_MAX_EDGE", `缩略图长边必须是 64 到 ${MAX_EDGE_LIMIT} 之间的整数。`);
  }
  return number;
}

function secureSourceFile(sourcePath) {
  const requested = path.resolve(String(sourcePath || ""));
  if (!sourcePath || !existsSync(requested)) {
    throw new ThumbnailCacheError("THUMBNAIL_SOURCE_NOT_FOUND", "缩略图来源文件不存在。");
  }
  const stats = lstatSync(requested);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new ThumbnailCacheError("THUMBNAIL_UNSAFE_SOURCE", "缩略图来源必须是安全的普通图片文件。");
  }
  return { path: realpathSync(requested), stats };
}

function secureCacheRoot(cacheRoot) {
  if (!cacheRoot) throw new ThumbnailCacheError("THUMBNAIL_CACHE_ROOT_REQUIRED", "没有提供缩略图缓存目录。");
  const requested = path.resolve(String(cacheRoot));
  mkdirSync(requested, { recursive: true });
  const stats = lstatSync(requested);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ThumbnailCacheError("THUMBNAIL_UNSAFE_CACHE", "缩略图缓存目录不安全。");
  }
  return realpathSync(requested);
}

function sourceFingerprint(sourcePath, stats, maxEdge) {
  const normalizedPath = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
  return createHash("sha256")
    .update(JSON.stringify({
      path: normalizedPath,
      size: Number(stats.size),
      mtimeMs: Number(stats.mtimeMs),
      maxEdge,
      formatVersion: 1,
    }))
    .digest("hex");
}

function looksLikeWebp(filePath, cacheRoot) {
  try {
    if (!existsSync(filePath) || !pathInside(filePath, cacheRoot) || comparablePath(path.dirname(filePath)) !== comparablePath(cacheRoot)) return false;
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 16) return false;
    const descriptor = openSync(filePath, "r");
    try {
      const header = Buffer.alloc(12);
      if (readSync(descriptor, header, 0, header.length, 0) !== header.length) return false;
      return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return false;
  }
}

function cleanupWorkerStaging(cacheRoot, childPid) {
  if (!cacheRoot || !Number.isSafeInteger(childPid) || childPid <= 0 || !existsSync(cacheRoot)) return;
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.endsWith(`.thumb-${childPid}.tmp`)) continue;
    const candidate = path.join(cacheRoot, entry);
    try {
      const stats = lstatSync(candidate);
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      const realCandidate = realpathSync(candidate);
      if (!pathInside(realCandidate, cacheRoot) || comparablePath(path.dirname(realCandidate)) !== comparablePath(cacheRoot)) continue;
      rmSync(realCandidate, { force: true });
    } catch {
      // The worker may already have committed or removed its unique staging file.
    }
  }
}

function hydrateWorkerError(payload) {
  if (!payload || typeof payload !== "object") {
    return new ThumbnailCacheError("THUMBNAIL_WORKER_FAILED", "缩略图进程没有返回有效错误信息。");
  }
  const error = new ThumbnailCacheError(payload.code, payload.message || "缩略图生成失败。", payload.details);
  if (payload.stack) error.workerStack = payload.stack;
  return error;
}

function createThumbnailCache(options = {}) {
  const workerPath = path.resolve(options.workerPath || path.join(__dirname, "image-thumbnail-worker.cjs"));
  const maxConcurrent = Number.isSafeInteger(Number(options.maxConcurrent))
    ? Math.max(1, Math.min(4, Number(options.maxConcurrent)))
    : 2;
  const timeoutMs = Number.isSafeInteger(Number(options.timeoutMs))
    ? Math.max(1_000, Math.min(600_000, Number(options.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  const log = typeof options.log === "function" ? options.log : () => undefined;
  const inflight = new Map();
  const lastPrunedAt = new Map();
  const workerSlots = new Set();
  const pendingJobs = [];
  let nextRequestId = 1;
  let closed = false;
  let counters = {
    requests: 0,
    cacheHits: 0,
    inflightJoins: 0,
    workerStarts: 0,
    workerJobs: 0,
    workerReuses: 0,
    workerFailures: 0,
    generated: 0,
    errors: 0,
    recentErrors: [],
    maxActiveWorkers: 0,
    pruneRuns: 0,
    prunedFiles: 0,
    prunedBytes: 0,
  };

  function prune(payload = {}) {
    if (closed) throw new ThumbnailCacheError("THUMBNAIL_CACHE_CLOSED", "缩略图缓存已经关闭。");
    const cacheRoot = secureCacheRoot(payload.cacheRoot);
    const maxFiles = Number.isSafeInteger(Number(payload.maxFiles))
      ? Math.max(8, Math.min(2_000, Number(payload.maxFiles)))
      : DEFAULT_MAX_CACHE_FILES;
    const maxBytes = Number.isSafeInteger(Number(payload.maxBytes))
      ? Math.max(8 * 1024 * 1024, Math.min(2 * 1024 * 1024 * 1024, Number(payload.maxBytes)))
      : DEFAULT_MAX_CACHE_BYTES;
    const maxAgeMs = Number.isSafeInteger(Number(payload.maxAgeMs))
      ? Math.max(60_000, Math.min(365 * 24 * 60 * 60 * 1000, Number(payload.maxAgeMs)))
      : DEFAULT_MAX_CACHE_AGE_MS;
    const protectedPaths = new Set([
      ...[...inflight.keys()].map((key) => comparablePath(path.join(cacheRoot, `${key}.webp`))),
      ...(Array.isArray(payload.protectedPaths) ? payload.protectedPaths : []).map((value) => comparablePath(String(value || ""))),
    ]);
    const now = Date.now();
    const files = [];
    for (const entry of readdirSync(cacheRoot)) {
      if (!entry.toLowerCase().endsWith(".webp")) continue;
      const candidate = path.join(cacheRoot, entry);
      try {
        const stats = lstatSync(candidate);
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
        const realCandidate = realpathSync(candidate);
        if (!pathInside(realCandidate, cacheRoot) || comparablePath(path.dirname(realCandidate)) !== comparablePath(cacheRoot)) continue;
        files.push({ path: realCandidate, size: Number(stats.size) || 0, mtimeMs: Number(stats.mtimeMs) || 0 });
      } catch {
        // A concurrent worker or cleanup may have already removed the entry.
      }
    }
    files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path));
    let retainedFiles = files.length;
    let retainedBytes = files.reduce((total, item) => total + item.size, 0);
    let prunedFiles = 0;
    let prunedBytes = 0;
    for (let index = files.length - 1; index >= 0; index -= 1) {
      const file = files[index];
      const expired = now - file.mtimeMs > maxAgeMs;
      const overLimit = retainedFiles > maxFiles || retainedBytes > maxBytes;
      if (!expired && !overLimit) continue;
      if (protectedPaths.has(comparablePath(file.path))) continue;
      try {
        rmSync(file.path, { force: true });
        retainedFiles -= 1;
        retainedBytes = Math.max(0, retainedBytes - file.size);
        prunedFiles += 1;
        prunedBytes += file.size;
      } catch {
        // Cache cleanup is opportunistic; preview generation must still work.
      }
    }
    counters.pruneRuns += 1;
    counters.prunedFiles += prunedFiles;
    counters.prunedBytes += prunedBytes;
    lastPrunedAt.set(comparablePath(cacheRoot), now);
    if (prunedFiles) log(`thumbnail cache pruned files=${prunedFiles} bytes=${prunedBytes} retained=${retainedFiles}`);
    return { prunedFiles, prunedBytes, retainedFiles, retainedBytes, maxFiles, maxBytes, maxAgeMs };
  }

  function maybePrune(cacheRoot) {
    const cacheKey = comparablePath(cacheRoot);
    const previous = Number(lastPrunedAt.get(cacheKey) || 0);
    if (Date.now() - previous < DEFAULT_PRUNE_INTERVAL_MS) return;
    try {
      prune({ cacheRoot });
    } catch (error) {
      log(`thumbnail cache prune skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function recordError(error, key = "") {
    counters.errors += 1;
    counters.recentErrors = [
      ...counters.recentErrors,
      {
        key: String(key || ""),
        code: String(error?.code || "THUMBNAIL_UNKNOWN_ERROR"),
        message: error instanceof Error ? error.message : String(error),
      },
    ].slice(-8);
  }

  function activeJobCount() {
    return [...workerSlots].filter((slot) => slot.currentJob).length;
  }

  function finishWorkerJob(slot, error, result) {
    const job = slot.currentJob;
    if (!job) return;
    if (slot.timeout) clearTimeout(slot.timeout);
    slot.timeout = undefined;
    slot.currentJob = undefined;
    cleanupWorkerStaging(job.request.cacheRoot, slot.child?.pid);
    if (error) job.reject(error);
    else {
      slot.completedJobs += 1;
      job.resolve(result);
    }
    log(`thumbnail worker slot released pid=${slot.child?.pid} active=${activeJobCount()} queued=${pendingJobs.length}`);
  }

  function retireWorker(slot, error, terminate = false) {
    if (!slot || slot.retired) return;
    slot.retired = true;
    workerSlots.delete(slot);
    if (slot.timeout) clearTimeout(slot.timeout);
    slot.timeout = undefined;
    const job = slot.currentJob;
    slot.currentJob = undefined;
    if (job) {
      cleanupWorkerStaging(job.request.cacheRoot, slot.child?.pid);
      job.reject(error);
    }
    if (!closed) {
      counters.workerFailures += 1;
      log(`thumbnail worker retired pid=${slot.child?.pid} code=${error?.code || "THUMBNAIL_WORKER_FAILED"} queued=${pendingJobs.length}`);
    }
    if (terminate && slot.child?.exitCode === null && !slot.child?.killed) slot.child.kill();
    if (!closed) pumpQueue();
  }

  function dispatchWorkerJob(slot, job) {
    const requestId = `thumb-${process.pid}-${nextRequestId++}`;
    slot.currentJob = { ...job, requestId };
    counters.workerJobs += 1;
    if (slot.completedJobs > 0) counters.workerReuses += 1;
    log(`thumbnail worker dispatch key=${job.request.key} request=${requestId} pid=${slot.child?.pid} reused=${slot.completedJobs > 0}`);
    slot.timeout = setTimeout(() => {
      if (slot.currentJob?.requestId !== requestId) return;
      retireWorker(slot, new ThumbnailCacheError("THUMBNAIL_TIMEOUT", "缩略图生成超时，已安全停止。"), true);
    }, timeoutMs);
    try {
      slot.child.send({ type: "generate", requestId, request: job.request }, (error) => {
        if (!error || slot.currentJob?.requestId !== requestId) return;
        retireWorker(slot, new ThumbnailCacheError("THUMBNAIL_WORKER_FAILED", `缩略图任务发送失败：${error.message}`), true);
      });
    } catch (error) {
      retireWorker(slot, new ThumbnailCacheError("THUMBNAIL_WORKER_FAILED", `缩略图任务发送失败：${error instanceof Error ? error.message : String(error)}`), true);
    }
  }

  function spawnWorker() {
    if (closed || workerSlots.size >= maxConcurrent) return null;
    let child;
    try {
      child = fork(workerPath, [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch (error) {
      const failure = new ThumbnailCacheError("THUMBNAIL_WORKER_START_FAILED", `无法启动缩略图进程：${error instanceof Error ? error.message : String(error)}`);
      const job = pendingJobs.shift();
      if (job) job.reject(failure);
      return null;
    }
    const slot = { child, currentJob: undefined, timeout: undefined, completedJobs: 0, retired: false };
    workerSlots.add(slot);
    counters.workerStarts += 1;
    counters.maxActiveWorkers = Math.max(counters.maxActiveWorkers, workerSlots.size);
    log(`thumbnail worker start pid=${child.pid} active=${workerSlots.size}`);
    child.on("message", (message) => {
      const job = slot.currentJob;
      if (!job || message?.requestId !== job.requestId) return;
      if (message?.type === "error") finishWorkerJob(slot, hydrateWorkerError(message.error));
      else if (message?.type === "result") finishWorkerJob(slot, null, message.result);
      else return;
      pumpQueue();
    });
    child.on("error", (error) => {
      retireWorker(slot, new ThumbnailCacheError("THUMBNAIL_WORKER_FAILED", `缩略图进程异常：${error instanceof Error ? error.message : String(error)}`), true);
    });
    child.on("close", (code) => {
      if (slot.retired) return;
      const error = closed
        ? new ThumbnailCacheError("THUMBNAIL_CACHE_CLOSED", "缩略图缓存已经关闭。")
        : new ThumbnailCacheError("THUMBNAIL_WORKER_EXITED", `缩略图进程异常退出（代码 ${code}）。`);
      retireWorker(slot, error);
    });
    return slot;
  }

  function pumpQueue() {
    if (closed) return;
    while (pendingJobs.length > 0) {
      let slot = [...workerSlots].find((candidate) => !candidate.retired && !candidate.currentJob);
      if (!slot) {
        if (workerSlots.size >= maxConcurrent) return;
        slot = spawnWorker();
        if (!slot) return;
      }
      const job = pendingJobs.shift();
      dispatchWorkerJob(slot, job);
    }
  }

  function scheduleWorker(request) {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new ThumbnailCacheError("THUMBNAIL_CACHE_CLOSED", "缩略图缓存已经关闭。"));
        return;
      }
      pendingJobs.push({ request, resolve, reject });
      log(`thumbnail worker queued key=${request.key} queued=${pendingJobs.length} active=${activeJobCount}`);
      pumpQueue();
    });
  }

  async function ensure(payload = {}) {
    counters.requests += 1;
    try {
      if (closed) throw new ThumbnailCacheError("THUMBNAIL_CACHE_CLOSED", "缩略图缓存已经关闭。");
      const maxEdge = normalizeMaxEdge(payload.maxEdge);
      const source = secureSourceFile(payload.sourcePath);
      const cacheRoot = secureCacheRoot(payload.cacheRoot);
      const key = sourceFingerprint(source.path, source.stats, maxEdge);
      const outputPath = path.join(cacheRoot, `${key}.webp`);
      if (looksLikeWebp(outputPath, cacheRoot)) {
        const stats = lstatSync(outputPath);
        counters.cacheHits += 1;
        log(`thumbnail cache hit key=${key}`);
        maybePrune(cacheRoot);
        return { path: outputPath, cacheHit: true, bytes: stats.size };
      }
      if (existsSync(outputPath)) rmSync(outputPath, { force: true });
      if (inflight.has(key)) {
        counters.inflightJoins += 1;
        log(`thumbnail cache join key=${key}`);
        return inflight.get(key);
      }

      const promise = scheduleWorker({
        key,
        sourcePath: source.path,
        sourceSize: source.stats.size,
        sourceMtimeMs: source.stats.mtimeMs,
        cacheRoot,
        outputPath,
        maxEdge,
      }).then((result) => {
        if (!result?.path || comparablePath(result.path) !== comparablePath(outputPath) || !looksLikeWebp(outputPath, cacheRoot)) {
          throw new ThumbnailCacheError("THUMBNAIL_INVALID_RESULT", "缩略图进程没有生成有效的 WebP 文件。");
        }
        if (result.cacheHit === true) counters.cacheHits += 1;
        else counters.generated += 1;
        log(`thumbnail cache ready key=${key} hit=${result.cacheHit === true}`);
        maybePrune(cacheRoot);
        return {
          path: outputPath,
          cacheHit: result.cacheHit === true,
          width: Number(result.width) || undefined,
          height: Number(result.height) || undefined,
          bytes: Number(result.bytes) || lstatSync(outputPath).size,
        };
      }).catch((error) => {
        recordError(error, key);
        throw error;
      }).finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
      inflight.set(key, promise);
      return promise;
    } catch (error) {
      recordError(error);
      throw error;
    }
  }

  function stats() {
    return {
      ...counters,
      maxConcurrent,
      activeWorkers: workerSlots.size,
      activeJobs: activeJobCount(),
      queuedJobs: pendingJobs.length,
      inflight: inflight.size,
      closed,
    };
  }

  function resetStats() {
    counters = {
      requests: 0,
      cacheHits: 0,
      inflightJoins: 0,
      workerStarts: 0,
      workerJobs: 0,
      workerReuses: 0,
      workerFailures: 0,
      generated: 0,
      errors: 0,
      recentErrors: [],
      maxActiveWorkers: workerSlots.size,
      pruneRuns: 0,
      prunedFiles: 0,
      prunedBytes: 0,
    };
    return stats();
  }

  async function close() {
    if (closed) return;
    closed = true;
    const closeError = new ThumbnailCacheError("THUMBNAIL_CACHE_CLOSED", "缩略图缓存已经关闭。");
    while (pendingJobs.length > 0) pendingJobs.shift().reject(closeError);
    const slots = [...workerSlots];
    const closeWaiters = slots.map((slot) => new Promise((resolve) => {
      if (slot.child.exitCode !== null) {
        resolve();
        return;
      }
      const fallback = setTimeout(resolve, 2_000);
      slot.child.once("close", () => {
        clearTimeout(fallback);
        resolve();
      });
    }));
    for (const slot of slots) {
      slot.retired = true;
      workerSlots.delete(slot);
      if (slot.timeout) clearTimeout(slot.timeout);
      slot.timeout = undefined;
      const job = slot.currentJob;
      slot.currentJob = undefined;
      if (job) {
        cleanupWorkerStaging(job.request.cacheRoot, slot.child?.pid);
        job.reject(closeError);
      }
      if (slot.child.exitCode === null && !slot.child.killed) slot.child.kill();
    }
    await Promise.allSettled([...inflight.values()]);
    await Promise.allSettled(closeWaiters);
    inflight.clear();
  }

  return { ensure, prune, close, stats, resetStats };
}

module.exports = {
  createThumbnailCache,
  ThumbnailCacheError,
  DEFAULT_MAX_EDGE,
  DEFAULT_MAX_CACHE_FILES,
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_CACHE_AGE_MS,
};
