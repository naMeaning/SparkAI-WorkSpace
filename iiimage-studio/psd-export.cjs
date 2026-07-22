"use strict";

const { existsSync, lstatSync, readdirSync, realpathSync, rmSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const { fork } = require("node:child_process");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const PSD_EXPORT_LIMITS = Object.freeze({
  maxLayers: 64,
  maxCanvasPixels: 40_000_000,
  // Includes every source layer plus the generated composite bitmap.
  maxTotalPixels: 128_000_000,
  maxInputBytes: 1_073_741_824,
  maxOutputBytes: 2_000_000_000,
  maxDimension: 30_000,
  timeoutMs: 180_000,
});

const PSD_EXPORT_HARD_LIMITS = Object.freeze({
  maxLayers: 128,
  maxCanvasPixels: 90_000_000,
  maxTotalPixels: 200_000_000,
  maxInputBytes: 2_000_000_000,
  maxOutputBytes: 2_000_000_000,
  maxDimension: 30_000,
  timeoutMs: 600_000,
});

class PsdExportError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "PsdExportError";
    this.code = code || "PSD_EXPORT_FAILED";
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new PsdExportError(code, message, details);
}

function normalizePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail("PSD_EXPORT_INVALID_PATH", `${label}不能为空。`);
  }
  if (value.includes("\0")) {
    fail("PSD_EXPORT_INVALID_PATH", `${label}包含无效字符。`);
  }
  return path.resolve(value.trim());
}

function normalizePositiveInteger(value, label, fallback, hardMaximum) {
  const resolved = value === undefined || value === null ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    fail("PSD_EXPORT_INVALID_LIMIT", `${label}必须是正整数。`);
  }
  if (resolved > hardMaximum) {
    fail("PSD_EXPORT_INVALID_LIMIT", `${label}不能超过安全上限 ${hardMaximum.toLocaleString("zh-CN")}。`);
  }
  return resolved;
}

function normalizeOptionalDimension(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > PSD_EXPORT_HARD_LIMITS.maxDimension) {
    fail(
      "PSD_EXPORT_INVALID_DIMENSION",
      `${label}必须是 1–${PSD_EXPORT_HARD_LIMITS.maxDimension.toLocaleString("zh-CN")} 之间的整数。`,
    );
  }
  return value;
}

function normalizeLayer(layer, index) {
  if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
    fail("PSD_EXPORT_INVALID_LAYER", `第 ${index + 1} 个图层配置无效。`);
  }

  const sourcePath = normalizePath(layer.path ?? layer.filePath, `第 ${index + 1} 个图层路径`);
  if (path.extname(sourcePath).toLowerCase() !== ".png") {
    fail("PSD_EXPORT_SOURCE_NOT_PNG", `图层“${layer.name || index + 1}”必须使用 PNG 文件。`);
  }

  if (typeof layer.name !== "string" || !layer.name.trim()) {
    fail("PSD_EXPORT_INVALID_LAYER_NAME", `第 ${index + 1} 个图层缺少名称。`);
  }
  const name = layer.name.trim();
  if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(name)) {
    fail("PSD_EXPORT_INVALID_LAYER_NAME", `图层“${name}”包含不支持的控制字符。`);
  }
  if (name.length > 255) {
    fail("PSD_EXPORT_INVALID_LAYER_NAME", `图层“${name.slice(0, 32)}…”名称过长，请控制在 255 个字符以内。`);
  }

  const requestedOpacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
  if (!Number.isFinite(requestedOpacity) || requestedOpacity < 0 || requestedOpacity > 1) {
    fail("PSD_EXPORT_INVALID_OPACITY", `图层“${name}”的不透明度必须在 0 到 1 之间。`);
  }
  // PSD stores opacity in one byte. Quantize before compositing so the embedded
  // preview and Photoshop's live layer rendering use exactly the same value.
  const opacity = Math.round(requestedOpacity * 255) / 255;

  return {
    name,
    path: sourcePath,
    visible: layer.visible !== false,
    opacity,
  };
}

function normalizeRequest(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    fail("PSD_EXPORT_INVALID_INPUT", "PSD 导出参数无效。请提供输出路径和图层列表。");
  }

  const outputPath = normalizePath(options.outputPath, "PSD 输出路径");
  if (path.extname(outputPath).toLowerCase() !== ".psd") {
    fail("PSD_EXPORT_OUTPUT_EXTENSION", "PSD 输出文件必须使用 .psd 扩展名。");
  }

  if (!Array.isArray(options.layers) || options.layers.length === 0) {
    fail("PSD_EXPORT_NO_LAYERS", "没有可导出的 PNG 图层。");
  }

  const requestedLimits = options.limits && typeof options.limits === "object" ? options.limits : {};
  const limits = {
    maxLayers: normalizePositiveInteger(
      requestedLimits.maxLayers,
      "最大图层数",
      PSD_EXPORT_LIMITS.maxLayers,
      PSD_EXPORT_HARD_LIMITS.maxLayers,
    ),
    maxCanvasPixels: normalizePositiveInteger(
      requestedLimits.maxCanvasPixels,
      "最大画布像素数",
      PSD_EXPORT_LIMITS.maxCanvasPixels,
      PSD_EXPORT_HARD_LIMITS.maxCanvasPixels,
    ),
    maxTotalPixels: normalizePositiveInteger(
      requestedLimits.maxTotalPixels,
      "最大总像素数",
      PSD_EXPORT_LIMITS.maxTotalPixels,
      PSD_EXPORT_HARD_LIMITS.maxTotalPixels,
    ),
    maxInputBytes: normalizePositiveInteger(
      requestedLimits.maxInputBytes,
      "最大输入体积",
      PSD_EXPORT_LIMITS.maxInputBytes,
      PSD_EXPORT_HARD_LIMITS.maxInputBytes,
    ),
    maxOutputBytes: normalizePositiveInteger(
      requestedLimits.maxOutputBytes,
      "最大输出体积",
      PSD_EXPORT_LIMITS.maxOutputBytes,
      PSD_EXPORT_HARD_LIMITS.maxOutputBytes,
    ),
    maxDimension: normalizePositiveInteger(
      requestedLimits.maxDimension,
      "最大边长",
      PSD_EXPORT_LIMITS.maxDimension,
      PSD_EXPORT_HARD_LIMITS.maxDimension,
    ),
  };

  if (options.layers.length > limits.maxLayers) {
    fail(
      "PSD_EXPORT_TOO_MANY_LAYERS",
      `共有 ${options.layers.length} 个图层，超过当前安全上限 ${limits.maxLayers} 个。请拆分后再导出。`,
    );
  }

  const layers = options.layers.map(normalizeLayer);
  if (layers.some((layer) => path.normalize(layer.path).toLowerCase() === path.normalize(outputPath).toLowerCase())) {
    fail("PSD_EXPORT_PATH_CONFLICT", "PSD 输出路径不能与源 PNG 图层路径相同。请另选保存位置。");
  }

  const timeoutMs = normalizePositiveInteger(
    options.timeoutMs,
    "PSD 导出超时时间",
    PSD_EXPORT_LIMITS.timeoutMs,
    PSD_EXPORT_HARD_LIMITS.timeoutMs,
  );

  return {
    outputPath,
    layers,
    width: normalizeOptionalDimension(options.width, "画布宽度"),
    height: normalizeOptionalDimension(options.height, "画布高度"),
    overwrite: options.overwrite !== false,
    limits,
    timeoutMs,
  };
}

function hydrateWorkerError(payload) {
  if (!payload || typeof payload !== "object") {
    return new PsdExportError("PSD_EXPORT_FAILED", "PSD 导出失败，后台任务没有返回有效错误信息。");
  }
  const error = new PsdExportError(payload.code, payload.message || "PSD 导出失败。", payload.details);
  if (payload.stack) error.workerStack = payload.stack;
  return error;
}

function cleanupRasterConversionStaging(cacheDir, childPid) {
  if (!cacheDir || !Number.isSafeInteger(childPid) || childPid <= 0 || !existsSync(cacheDir)) return;
  for (const entry of readdirSync(cacheDir)) {
    if (!entry.endsWith(`.convert-${childPid}.tmp`)) continue;
    const candidate = path.join(cacheDir, entry);
    try {
      const stats = lstatSync(candidate);
      if (stats.isFile() && !stats.isSymbolicLink() && path.dirname(realpathSync(candidate)) === realpathSync(cacheDir)) {
        rmSync(candidate, { force: true });
      }
    } catch {
      // A concurrent successful rename may have already removed the staging file.
    }
  }
}

function preparePsdRasterSource(options = {}) {
  let sourcePath;
  let cacheDir;
  try {
    sourcePath = normalizePath(options.sourcePath ?? options.path, "PSD 图片源路径");
    cacheDir = normalizePath(options.cacheDir, "PSD 转换缓存目录");
  } catch (error) {
    return Promise.reject(error);
  }
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".png") return Promise.resolve({ path: sourcePath, converted: false });
  if (![".jpg", ".jpeg", ".webp"].includes(extension)) {
    return Promise.reject(new PsdExportError("PSD_RASTER_UNSUPPORTED_SOURCE", "普通图片 PSD 只支持 PNG、JPEG 或 WEBP。"));
  }
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new PsdExportError("PSD_EXPORT_ABORTED", "PSD 导出已取消。"));
  if (!existsSync(cacheDir)) return Promise.reject(new PsdExportError("PSD_RASTER_CACHE_NOT_FOUND", "PSD 转换缓存目录不存在。"));
  try {
    const cacheStats = lstatSync(cacheDir);
    if (!cacheStats.isDirectory() || cacheStats.isSymbolicLink()) {
      return Promise.reject(new PsdExportError("PSD_RASTER_UNSAFE_CACHE", "PSD 转换缓存目录不安全。"));
    }
  } catch (error) {
    return Promise.reject(new PsdExportError("PSD_RASTER_UNSAFE_CACHE", `无法检查 PSD 转换缓存：${error instanceof Error ? error.message : String(error)}`));
  }

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timeout = null;
    let workerResult;
    let workerError;
    const timeoutMs = normalizePositiveInteger(options.timeoutMs, "PSD 图片转换超时时间", 60_000, PSD_EXPORT_HARD_LIMITS.timeoutMs);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener?.("abort", abort);
      cleanupRasterConversionStaging(cacheDir, child?.pid);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      if (settled) return;
      child?.kill();
      finish(new PsdExportError("PSD_EXPORT_ABORTED", "PSD 导出已取消。"));
    };
    try {
      child = fork(path.join(__dirname, "psd-raster-source-worker.cjs"), [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch (error) {
      finish(new PsdExportError("PSD_RASTER_WORKER_START_FAILED", `无法启动图片转换进程：${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    timeout = setTimeout(() => {
      child?.kill();
      finish(new PsdExportError("PSD_RASTER_TIMEOUT", "JPEG/WEBP 转换超时，已安全停止。"));
    }, timeoutMs);
    signal?.addEventListener?.("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.on("message", (message) => {
      if (message?.type === "result") workerResult = message.result;
      if (message?.type === "error") workerError = hydrateWorkerError(message.error);
    });
    child.on("error", (error) => finish(new PsdExportError("PSD_RASTER_WORKER_FAILED", `图片转换进程失败：${error instanceof Error ? error.message : String(error)}`)));
    child.on("exit", (code) => {
      cleanupRasterConversionStaging(cacheDir, child?.pid);
      if (settled) return;
      if (workerError) finish(workerError);
      else if (workerResult && code === 0) finish(null, workerResult);
      else finish(new PsdExportError("PSD_RASTER_WORKER_EXITED", `图片转换进程异常退出（代码 ${code}）。`));
    });
    child.send({ sourcePath, cacheDir, ownerPid: Number(options.ownerPid || process.pid) });
  });
}

function runWorker(request, callbacks) {
  const { onProgress, signal } = callbacks;
  if (signal?.aborted) {
    return Promise.reject(new PsdExportError("PSD_EXPORT_ABORTED", "PSD 导出已取消。"));
  }

  const outputDirectory = path.dirname(request.outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(request.outputPath)}.iiimage-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}.tmp`,
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    let timeout = null;
    let workerResult;
    let workerError;

    const cleanupTemporaryFile = () => {
      try {
        if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
      } catch {
        // The next export uses a unique name, so cleanup failure must not hide the real error.
      }
    };

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener?.("abort", handleAbort);
      if (error) {
        cleanupTemporaryFile();
        reject(error);
      } else {
        resolve(result);
      }
    };

    const handleAbort = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener?.("abort", handleAbort);
      worker
        ?.terminate()
        .catch(() => undefined)
        .finally(() => {
          cleanupTemporaryFile();
          reject(new PsdExportError("PSD_EXPORT_ABORTED", "PSD 导出已取消。"));
        });
    };

    try {
      worker = new Worker(path.join(__dirname, "psd-export-worker.cjs"), {
        workerData: { ...request, temporaryPath },
        resourceLimits: {
          maxOldGenerationSizeMb: 1536,
          maxYoungGenerationSizeMb: 128,
          stackSizeMb: 8,
        },
      });
    } catch (error) {
      finish(
        new PsdExportError(
          "PSD_EXPORT_WORKER_START_FAILED",
          `无法启动 PSD 后台导出任务：${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", handleAbort);
      worker
        .terminate()
        .catch(() => undefined)
        .finally(() => {
          cleanupTemporaryFile();
          reject(
            new PsdExportError(
              "PSD_EXPORT_TIMEOUT",
              `PSD 导出超过 ${Math.round(request.timeoutMs / 1000)} 秒，已安全停止。可尝试减少图层或图片尺寸。`,
            ),
          );
        });
    }, request.timeoutMs);

    signal?.addEventListener?.("abort", handleAbort, { once: true });
    // Close the small race between the initial check and listener registration.
    if (signal?.aborted) handleAbort();

    worker.on("message", (message) => {
      if (settled) return;
      if (!message || typeof message !== "object") return;
      if (message.type === "progress") {
        if (typeof onProgress === "function") {
          try {
            onProgress(message.progress);
          } catch {
            // UI progress listeners are observational and cannot fail a valid export.
          }
        }
        return;
      }
      if (message.type === "result") workerResult = message.result;
      if (message.type === "error") workerError = hydrateWorkerError(message.error);
    });

    worker.on("error", (error) => {
      finish(
        new PsdExportError(
          "PSD_EXPORT_WORKER_FAILED",
          `PSD 后台导出任务异常退出：${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    worker.on("exit", (code) => {
      if (settled) return;
      if (workerError) {
        finish(workerError);
      } else if (workerResult && code === 0) {
        finish(null, workerResult);
      } else if (code !== 0) {
        finish(new PsdExportError("PSD_EXPORT_WORKER_EXITED", `PSD 后台导出任务异常退出（代码 ${code}）。`));
      } else {
        finish(new PsdExportError("PSD_EXPORT_NO_RESULT", "PSD 后台导出任务结束，但没有生成结果。"));
      }
    });
  });
}

let exportQueue = Promise.resolve();

/**
 * Export same-size PNG layers to a Photoshop-compatible PSD.
 * `layers` MUST be ordered from the visual top layer to the bottom layer.
 *
 * @param {{
 *   outputPath: string,
 *   layers: Array<{name: string, path?: string, filePath?: string, visible?: boolean, opacity?: number}>,
 *   width?: number,
 *   height?: number,
 *   overwrite?: boolean,
 *   timeoutMs?: number,
 *   limits?: Partial<typeof PSD_EXPORT_LIMITS>,
 *   signal?: AbortSignal,
 *   onProgress?: (progress: {stage: string, completed: number, total: number, message: string}) => void,
 * }} options
 */
function exportLayeredPsd(options) {
  let request;
  try {
    request = normalizeRequest(options);
  } catch (error) {
    return Promise.reject(error);
  }

  const callbacks = {
    signal: options.signal,
    onProgress: options.onProgress,
  };
  const task = () => runWorker(request, callbacks);
  const result = exportQueue.then(task);
  exportQueue = result.catch(() => undefined);
  return result;
}

module.exports = {
  PSD_EXPORT_LIMITS,
  PsdExportError,
  exportLayeredPsd,
  preparePsdRasterSource,
};
