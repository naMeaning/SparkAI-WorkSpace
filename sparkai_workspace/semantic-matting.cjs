"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

const LIMITS = Object.freeze({
  maxLayers: 8,
  maxPixels: 16_777_216,
  maxPayloadChars: 160_000_000,
  timeoutMs: 120_000
});

class SemanticMattingError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "SemanticMattingError";
    this.code = code || "SEMANTIC_MATTING_FAILED";
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new SemanticMattingError(code, message, details);
}

function normalizeDataUrl(value, label) {
  const source = String(value || "");
  if (!/^data:image\/png;base64,[a-z0-9+/=\r\n]+$/i.test(source)) {
    fail("SEMANTIC_MATTING_INVALID_IMAGE", `${label}必须是 PNG data URL。`);
  }
  return source;
}

function normalizeRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("SEMANTIC_MATTING_INVALID_INPUT", "语义蒙版细化参数无效。");
  }
  const mode = payload.mode === "background-removal"
    ? "background-removal"
    : payload.mode === "direct-alignment"
      ? "direct-alignment"
      : "semantic-matting";
  const width = Math.round(Number(payload.width || 0));
  const height = Math.round(Number(payload.height || 0));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    fail("SEMANTIC_MATTING_INVALID_SIZE", "语义蒙版画布尺寸无效。");
  }
  if (width * height > LIMITS.maxPixels) {
    fail("SEMANTIC_MATTING_TOO_LARGE", `语义蒙版画布超过 ${LIMITS.maxPixels.toLocaleString("zh-CN")} 像素安全上限。`);
  }
  if (mode === "background-removal") {
    const source = normalizeDataUrl(payload.source, "待提取图片");
    if (source.length > LIMITS.maxPayloadChars) {
      fail("SEMANTIC_MATTING_PAYLOAD_TOO_LARGE", "透明提取输入体积超过安全上限。");
    }
    return { mode, width, height, source };
  }
  if (!Array.isArray(payload.layers) || payload.layers.length < 1 || payload.layers.length > LIMITS.maxLayers) {
    fail("SEMANTIC_MATTING_INVALID_LAYERS", `语义蒙版图层数必须为 1-${LIMITS.maxLayers}。`);
  }
  const ids = new Set();
  const layers = payload.layers.map((layer, index) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      fail("SEMANTIC_MATTING_INVALID_LAYER", `第 ${index + 1} 个语义图层无效。`);
    }
    const id = String(layer.id || `layer-${index + 1}`).trim().slice(0, 120);
    if (!id || ids.has(id)) fail("SEMANTIC_MATTING_DUPLICATE_LAYER", `语义图层 ID ${id || index + 1} 无效或重复。`);
    ids.add(id);
    return {
      id,
      role: String(layer.role || "other").trim().toLowerCase().slice(0, 40),
      source: normalizeDataUrl(layer.source, `图层 ${id}`),
      preserveGeometry: layer.preserveGeometry === true,
      directSubjectSeed: layer.directSubjectSeed === true
    };
  });
  const previewSource = normalizeDataUrl(payload.previewSource, "合成预览");
  const backgroundSource = normalizeDataUrl(payload.backgroundSource, "干净背景");
  const payloadChars = previewSource.length + backgroundSource.length + layers.reduce((total, layer) => total + layer.source.length, 0);
  if (payloadChars > LIMITS.maxPayloadChars) {
    fail("SEMANTIC_MATTING_PAYLOAD_TOO_LARGE", "语义蒙版细化输入体积超过安全上限。");
  }
  return { mode, width, height, previewSource, backgroundSource, layers };
}

function hydrateWorkerError(payload) {
  if (!payload || typeof payload !== "object") {
    return new SemanticMattingError("SEMANTIC_MATTING_FAILED", "语义蒙版后台任务没有返回有效错误信息。");
  }
  const error = new SemanticMattingError(payload.code, payload.message || "语义蒙版细化失败。", payload.details);
  if (payload.stack) error.workerStack = payload.stack;
  return error;
}

function refineSemanticLayers(payload, options = {}) {
  let request;
  try {
    request = normalizeRequest(payload);
  } catch (error) {
    return Promise.reject(error);
  }
  const timeoutMs = Math.max(10_000, Math.min(Number(options.timeoutMs || LIMITS.timeoutMs), 300_000));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "semantic-matting-worker.cjs"), {
      workerData: options.diagnostics === true ? { ...request, diagnostics: true } : request
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new SemanticMattingError("SEMANTIC_MATTING_TIMEOUT", `语义蒙版细化超过 ${Math.round(timeoutMs / 1000)} 秒。`));
    }, timeoutMs);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    worker.on("message", (message) => {
      if (message?.type === "result") finish(null, message.result);
      else if (message?.type === "error") finish(hydrateWorkerError(message.error));
    });
    worker.on("error", (error) => finish(new SemanticMattingError("SEMANTIC_MATTING_WORKER_FAILED", error.message || String(error))));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) finish(new SemanticMattingError("SEMANTIC_MATTING_WORKER_EXIT", `语义蒙版后台任务异常退出（${code}）。`));
    });
  });
}

module.exports = {
  LIMITS,
  SemanticMattingError,
  refineSemanticLayers
};
