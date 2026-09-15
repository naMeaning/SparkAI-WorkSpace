"use strict";

const { existsSync, lstatSync, realpathSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

sharp.cache(false);

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathInside(filePath, rootPath) {
  const file = comparablePath(filePath);
  const root = comparablePath(rootPath);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateRequest(payload = {}) {
  const sourcePath = path.resolve(String(payload.sourcePath || ""));
  const cacheRoot = path.resolve(String(payload.cacheRoot || ""));
  const outputPath = path.resolve(String(payload.outputPath || ""));
  const maxEdge = Number(payload.maxEdge);
  const key = String(payload.key || "");
  if (!sourcePath || !cacheRoot || !outputPath || !/^[a-f0-9]{64}$/i.test(key)) {
    fail("THUMBNAIL_INVALID_INPUT", "缩略图参数无效。");
  }
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 64 || maxEdge > 4096) {
    fail("THUMBNAIL_INVALID_MAX_EDGE", "缩略图长边参数无效。");
  }
  if (path.basename(outputPath) !== `${key}.webp` || !pathInside(outputPath, cacheRoot) || comparablePath(path.dirname(outputPath)) !== comparablePath(cacheRoot)) {
    fail("THUMBNAIL_UNSAFE_OUTPUT", "缩略图输出路径越过了缓存目录。");
  }
  if (!existsSync(sourcePath)) fail("THUMBNAIL_SOURCE_NOT_FOUND", "缩略图来源文件不存在。");
  const sourceStats = lstatSync(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) fail("THUMBNAIL_UNSAFE_SOURCE", "缩略图来源不是安全的普通文件。");
  const realCache = realpathSync(cacheRoot);
  const cacheStats = lstatSync(realCache);
  if (!cacheStats.isDirectory() || cacheStats.isSymbolicLink()) fail("THUMBNAIL_UNSAFE_CACHE", "缩略图缓存目录不安全。");
  const realOutput = path.join(realCache, path.basename(outputPath));
  const expectedSize = Number(payload.sourceSize);
  const expectedMtimeMs = Number(payload.sourceMtimeMs);
  if (sourceStats.size !== expectedSize || sourceStats.mtimeMs !== expectedMtimeMs) {
    fail("THUMBNAIL_SOURCE_CHANGED", "来源图片在生成缩略图前已发生变化，请重试。");
  }
  return { sourcePath: realpathSync(sourcePath), cacheRoot: realCache, outputPath: realOutput, maxEdge };
}

async function inspectExisting(outputPath, maxEdge) {
  if (!existsSync(outputPath)) return null;
  const stats = lstatSync(outputPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 16) return null;
  const metadata = await sharp(outputPath, { failOn: "error" }).metadata();
  if (metadata.format !== "webp" || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > maxEdge) return null;
  return { path: outputPath, cacheHit: true, width: metadata.width, height: metadata.height, bytes: stats.size, hasAlpha: metadata.hasAlpha === true };
}

async function generate(payload) {
  const request = validateRequest(payload);
  const existing = await inspectExisting(request.outputPath, request.maxEdge).catch(() => null);
  if (existing) return existing;
  if (existsSync(request.outputPath)) rmSync(request.outputPath, { force: true });

  const source = sharp(request.sourcePath, { failOn: "error", limitInputPixels: 100_000_000 });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(String(metadata.format || "").toLowerCase())) {
    fail("THUMBNAIL_UNSUPPORTED_SOURCE", "缩略图只支持真实的 PNG、JPEG 或 WebP 图片。");
  }
  let pipeline = source
    .rotate()
    .resize({ width: request.maxEdge, height: request.maxEdge, fit: "inside", withoutEnlargement: true });
  pipeline = metadata.hasAlpha ? pipeline.ensureAlpha() : pipeline.removeAlpha();
  const converted = await pipeline
    .webp({ quality: 82, alphaQuality: 100, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  if (!converted.info.width || !converted.info.height || Math.max(converted.info.width, converted.info.height) > request.maxEdge) {
    fail("THUMBNAIL_DIMENSION_MISMATCH", "缩略图尺寸校验失败。");
  }

  const temporaryPath = `${request.outputPath}.thumb-${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, converted.data, { flag: "wx" });
    let cacheHit = false;
    try {
      renameSync(temporaryPath, request.outputPath);
    } catch (error) {
      const concurrent = await inspectExisting(request.outputPath, request.maxEdge).catch(() => null);
      if (!concurrent) throw error;
      rmSync(temporaryPath, { force: true });
      cacheHit = true;
    }
    const committed = await inspectExisting(request.outputPath, request.maxEdge);
    if (!committed) fail("THUMBNAIL_COMMIT_FAILED", "缩略图原子提交后校验失败。");
    return { ...committed, cacheHit, sourceFormat: metadata.format };
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

function send(message) {
  return new Promise((resolve) => {
    if (typeof process.send !== "function") {
      resolve();
      return;
    }
    try {
      process.send(message, () => resolve());
    } catch {
      resolve();
    }
  });
}

let closing = false;
let workQueue = Promise.resolve();

async function handleGenerateMessage(payload) {
  const requestId = String(payload?.requestId || "");
  try {
    if (!requestId || payload?.type !== "generate") fail("THUMBNAIL_INVALID_INPUT", "缩略图任务协议无效。");
    const result = await generate(payload.request);
    await send({ type: "result", requestId, result });
  } catch (error) {
    const code = String(error?.code || "").startsWith("THUMBNAIL_") ? error.code : "THUMBNAIL_DECODE_FAILED";
    const message = String(error?.code || "").startsWith("THUMBNAIL_")
      ? (error instanceof Error ? error.message : String(error))
      : "图片格式损坏或无法解码，不能生成缩略图。";
    await send({ type: "error", requestId, error: { code, message, stack: error?.stack } });
  }
}

process.on("message", (payload) => {
  if (payload?.type === "shutdown") {
    closing = true;
    void workQueue.finally(() => process.disconnect?.());
    return;
  }
  if (closing) return;
  workQueue = workQueue.then(() => handleGenerateMessage(payload));
});

process.on("disconnect", () => {
  closing = true;
});
