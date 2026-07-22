"use strict";

const { randomBytes } = require("node:crypto");
const { fork } = require("node:child_process");
const { lstat, readdir, rm } = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_MAX_FILES = 2_000;
const HARD_MAX_FILES = 10_000;
const DEFAULT_MAX_CONCURRENT_FILES = 4;
const HARD_MAX_CONCURRENT_FILES = 16;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const HARD_TIMEOUT_MS = 900_000;

class ImageImportError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ImageImportError";
    this.code = code || "IMAGE_IMPORT_FAILED";
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

function safeSourceRelativePath(value, maximum = 1000) {
  const source = typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
  if (!source || source.startsWith("/") || /^[a-z]:/i.test(source) || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (source.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return source.slice(0, maximum);
}

function normalizeInteger(value, label, fallback, minimum, maximum) {
  const resolved = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new ImageImportError(
      "IMAGE_IMPORT_INVALID_LIMIT",
      `${label}必须是 ${minimum} 到 ${maximum} 之间的整数。`,
    );
  }
  return resolved;
}

function normalizeRequest(payload, limits) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ImageImportError("IMAGE_IMPORT_INVALID_REQUEST", "图片导入参数无效。");
  }
  if (!Array.isArray(payload.inputPaths) || payload.inputPaths.length === 0) {
    throw new ImageImportError("IMAGE_IMPORT_INPUT_REQUIRED", "请至少提供一个图片或目录路径。");
  }
  if (payload.inputPaths.length > HARD_MAX_FILES) {
    throw new ImageImportError("IMAGE_IMPORT_TOO_MANY_INPUTS", `一次最多接收 ${HARD_MAX_FILES} 个入口路径。`);
  }
  const inputPaths = payload.inputPaths.map((value) => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
      throw new ImageImportError("IMAGE_IMPORT_INVALID_PATH", "图片导入路径无效。");
    }
    return path.resolve(value.trim());
  });
  if (typeof payload.outputDir !== "string" || !payload.outputDir.trim() || payload.outputDir.includes("\0")) {
    throw new ImageImportError("IMAGE_IMPORT_OUTPUT_REQUIRED", "图片导入输出目录无效。");
  }
  return {
    inputPaths,
    outputDir: path.resolve(payload.outputDir.trim()),
    maxFiles: normalizeInteger(payload.maxFiles, "图片导入数量", DEFAULT_MAX_FILES, 1, HARD_MAX_FILES),
    maxFileBytes: limits.maxFileBytes,
    maxTotalBytes: limits.maxTotalBytes,
  };
}

function hydrateWorkerError(payload) {
  if (!payload || typeof payload !== "object") {
    return new ImageImportError("IMAGE_IMPORT_WORKER_FAILED", "图片导入进程没有返回有效错误信息。");
  }
  const error = new ImageImportError(payload.code, payload.message || "图片导入失败。", payload.details);
  if (payload.stack) error.workerStack = payload.stack;
  return error;
}

async function cleanupStaging(outputDir, requestId) {
  try {
    const stats = await lstat(outputDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return;
    const prefix = `.iiimage-import-${requestId}-`;
    const entries = await readdir(outputDir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".tmp")) return;
      await rm(path.join(outputDir, entry.name), { force: true }).catch(() => undefined);
    }));
  } catch {
    // The output directory may not have been created before a worker failed.
  }
}

function validateWorkerResult(result, request) {
  if (!result || typeof result !== "object" || result.requestId !== request.requestId || !Array.isArray(result.assets)) {
    throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入进程返回了无效结果。");
  }
  if (result.importBatchId !== request.requestId || !Array.isArray(result.roots)) {
    throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入结果缺少有效批次身份。");
  }
  const rootIds = new Set();
  for (const root of result.roots) {
    if (
      !root ||
      root.importBatchId !== request.requestId ||
      !/^root-[a-f0-9]{24}$/i.test(String(root.importRootId || "")) ||
      !["file", "directory"].includes(String(root.sourceRootKind || "")) ||
      !Number.isSafeInteger(Number(root.importRootIndex)) ||
      Number(root.importRootIndex) < 0
    ) {
      throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入结果包含无效目录边界。");
    }
    rootIds.add(root.importRootId);
  }
  const occurrenceIds = new Set();
  let totalBytes = 0;
  for (const asset of result.assets) {
    if (!asset || typeof asset.path !== "string" || !pathInside(asset.path, request.outputDir)) {
      throw new ImageImportError("IMAGE_IMPORT_UNSAFE_RESULT", "图片导入结果越过了目标目录。");
    }
    if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ""))) {
      throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入结果缺少有效内容摘要。");
    }
    const assetBytes = Number(asset.bytes);
    if (!Number.isSafeInteger(assetBytes) || assetBytes <= 0 || assetBytes > request.maxFileBytes) {
      throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入结果包含超出限制的文件大小。");
    }
    totalBytes += assetBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > request.maxTotalBytes) {
      throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入结果超过本次任务的总字节限制。");
    }
    const sourceRelativePath = safeSourceRelativePath(asset.sourceRelativePath);
    if (
      asset.importBatchId !== request.requestId ||
      !rootIds.has(asset.importRootId) ||
      !/^occ-[a-f0-9]{32}$/i.test(String(asset.occurrenceId || "")) ||
      occurrenceIds.has(asset.occurrenceId) ||
      !sourceRelativePath ||
      sourceRelativePath.startsWith("/") ||
      sourceRelativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new ImageImportError("IMAGE_IMPORT_INVALID_RESULT", "图片导入结果包含无效逻辑图片身份。");
    }
    occurrenceIds.add(asset.occurrenceId);
  }
  return result;
}

function createImageImporter(options = {}) {
  const workerPath = path.resolve(options.workerPath || path.join(__dirname, "image-import-worker.cjs"));
  const log = typeof options.log === "function" ? options.log : () => undefined;
  const maxConcurrentFiles = normalizeInteger(
    options.maxConcurrentFiles,
    "并行导入文件数",
    DEFAULT_MAX_CONCURRENT_FILES,
    1,
    HARD_MAX_CONCURRENT_FILES,
  );
  const timeoutMs = normalizeInteger(options.timeoutMs, "图片导入超时时间", DEFAULT_TIMEOUT_MS, 50, HARD_TIMEOUT_MS);
  const maxFileBytes = normalizeInteger(options.maxFileBytes, "单张图片大小", DEFAULT_MAX_FILE_BYTES, 1, HARD_MAX_FILE_BYTES);
  const maxTotalBytes = normalizeInteger(options.maxTotalBytes, "单次导入总大小", DEFAULT_MAX_TOTAL_BYTES, maxFileBytes, HARD_MAX_TOTAL_BYTES);
  const pendingJobs = [];
  let currentRun = null;
  let closed = false;

  function startWorker(request) {
    let child;
    let settled = false;
    let timeout = null;
    let killFallback = null;
    let exitGrace = null;
    let workerResult;
    let workerError;
    let forcedError;
    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killFallback) clearTimeout(killFallback);
      if (exitGrace) clearTimeout(exitGrace);
      await cleanupStaging(request.outputDir, request.requestId);
      if (error) rejectPromise(error);
      else resolvePromise(result);
    };

    const cancel = (error) => {
      if (settled || forcedError) return;
      forcedError = error;
      try {
        child?.kill();
      } catch {
        // The exit/fallback path below owns final rejection and cleanup.
      }
      killFallback = setTimeout(() => {
        void finish(forcedError);
      }, 5_000);
    };

    try {
      child = fork(workerPath, [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
      log(`image import worker start request=${request.requestId} pid=${child.pid}`);
    } catch (error) {
      void finish(new ImageImportError(
        "IMAGE_IMPORT_WORKER_START_FAILED",
        `无法启动图片导入进程：${error instanceof Error ? error.message : String(error)}`,
      ));
      return { promise, cancel };
    }

    timeout = setTimeout(() => {
      cancel(new ImageImportError("IMAGE_IMPORT_TIMEOUT", "图片导入超时，已安全停止。"));
    }, timeoutMs);

    child.on("message", (message) => {
      if (message?.type === "progress") {
        log(`image import progress request=${request.requestId} completed=${Number(message.completed) || 0}/${Number(message.total) || 0}`);
      }
      if (message?.type === "result") {
        workerResult = message.result;
        if (!forcedError) {
          try {
            void finish(null, validateWorkerResult(workerResult, request));
          } catch (error) {
            void finish(error);
          }
        }
      }
      if (message?.type === "error") {
        workerError = hydrateWorkerError(message.error);
        if (!forcedError) void finish(workerError);
      }
    });
    child.on("error", (error) => {
      cancel(new ImageImportError(
        "IMAGE_IMPORT_WORKER_FAILED",
        `图片导入进程异常：${error instanceof Error ? error.message : String(error)}`,
      ));
    });
    child.on("exit", (code) => {
      if (forcedError) {
        void finish(forcedError);
      } else if (workerError) {
        void finish(workerError);
      } else if (workerResult && code === 0) {
        try {
          void finish(null, validateWorkerResult(workerResult, request));
        } catch (error) {
          void finish(error);
        }
      } else if (code === 0) {
        // On Windows the child `exit` event can beat the final buffered IPC
        // `message` even though process.send's callback already ran. Give that
        // clean-exit result a short delivery window instead of reporting a
        // false worker crash. Non-zero exits still fail immediately.
        exitGrace = setTimeout(() => {
          if (workerError) {
            void finish(workerError);
          } else if (workerResult) {
            try {
              void finish(null, validateWorkerResult(workerResult, request));
            } catch (error) {
              void finish(error);
            }
          } else {
            void finish(new ImageImportError(
              "IMAGE_IMPORT_WORKER_EXITED",
              "图片导入进程正常退出，但没有返回导入结果。",
            ));
          }
        }, 250);
      } else {
        void finish(new ImageImportError(
          "IMAGE_IMPORT_WORKER_EXITED",
          `图片导入进程异常退出（代码 ${code}）。`,
        ));
      }
    });
    child.send({ ...request, maxConcurrentFiles }, (error) => {
      if (error) {
        cancel(new ImageImportError("IMAGE_IMPORT_WORKER_FAILED", `无法发送图片导入任务：${error.message}`));
      }
    });
    return { promise, cancel };
  }

  function pumpQueue() {
    if (closed || currentRun || pendingJobs.length === 0) return;
    const job = pendingJobs.shift();
    const run = startWorker(job.request);
    currentRun = run;
    run.promise.then(job.resolve, job.reject).finally(() => {
      if (currentRun === run) currentRun = null;
      pumpQueue();
    });
  }

  function importImages(payload) {
    if (closed) return Promise.reject(new ImageImportError("IMAGE_IMPORT_CLOSED", "图片导入器已经关闭。"));
    let normalized;
    try {
      normalized = normalizeRequest(payload, { maxFileBytes, maxTotalBytes });
    } catch (error) {
      return Promise.reject(error);
    }
    const request = {
      ...normalized,
      requestId: randomBytes(12).toString("hex"),
    };
    return new Promise((resolve, reject) => {
      pendingJobs.push({ request, resolve, reject });
      log(`image import queued request=${request.requestId} queued=${pendingJobs.length}`);
      pumpQueue();
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    const error = new ImageImportError("IMAGE_IMPORT_CLOSED", "图片导入器已经关闭。");
    while (pendingJobs.length > 0) pendingJobs.shift().reject(error);
    const active = currentRun;
    active?.cancel(error);
    if (active) await Promise.allSettled([active.promise]);
    currentRun = null;
  }

  return { importImages, close };
}

module.exports = {
  createImageImporter,
  ImageImportError,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_CONCURRENT_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
};
