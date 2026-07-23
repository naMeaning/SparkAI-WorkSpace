"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { constants, createReadStream, createWriteStream } = require("node:fs");
const { copyFile, link, lstat, mkdir, open, readdir, realpath, rm, unlink } = require("node:fs/promises");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const sharp = require("sharp");

sharp.cache(false);

const HARD_MAX_FILE_BYTES = 256 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
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

async function assertPathHasNoSymbolicComponent(filePath, code, message) {
  const resolved = path.resolve(filePath);
  const root = path.parse(resolved).root;
  const relative = path.relative(root, resolved);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stats.isSymbolicLink()) fail(code, message, { path: current });
  }
}

function stableNameKey(value) {
  const normalized = String(value || "").normalize("NFC");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function stableCompare(left, right) {
  const leftKey = stableNameKey(left.name || left);
  const rightKey = stableNameKey(right.name || right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  const leftRaw = String(left.name || left).normalize("NFC");
  const rightRaw = String(right.name || right).normalize("NFC");
  return leftRaw < rightRaw ? -1 : leftRaw > rightRaw ? 1 : 0;
}

function detectMagic(header) {
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "jpeg";
  if (header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return "";
}

async function readMagic(filePath) {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return detectMagic(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function sizeLimitError(maximumBytes) {
  const error = new Error(`图片超过 ${Math.max(1, Math.floor(maximumBytes / 1024 / 1024))}MB 的单文件上限。`);
  error.code = "IMAGE_IMPORT_FILE_TOO_LARGE";
  return error;
}

async function hashFile(filePath, maximumBytes) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    if (bytes + chunk.length > maximumBytes) throw sizeLimitError(maximumBytes);
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function copyAndHash(sourcePath, stagingPath, maximumBytes) {
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      if (bytes + chunk.length > maximumBytes) {
        callback(sizeLimitError(maximumBytes));
        return;
      }
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(
    createReadStream(sourcePath),
    meter,
    createWriteStream(stagingPath, { flags: "wx" }),
  );
  return { sha256: hash.digest("hex"), bytes };
}

async function validateDecodedImage(filePath, expectedFormat) {
  const actualMagic = await readMagic(filePath);
  if (!actualMagic || actualMagic !== expectedFormat) {
    fail("IMAGE_IMPORT_DAMAGED_IMAGE", "图片内容在导入时发生变化或已经损坏。");
  }
  let metadata;
  try {
    metadata = await sharp(filePath, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
  } catch {
    fail("IMAGE_IMPORT_DAMAGED_IMAGE", "图片文件损坏或无法解码。");
  }
  const format = String(metadata?.format || "").toLowerCase();
  if (format !== expectedFormat || !metadata?.width || !metadata?.height) {
    fail("IMAGE_IMPORT_DAMAGED_IMAGE", "图片格式与真实内容不一致或缺少有效尺寸。");
  }
  return { format, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha === true };
}

async function validateExistingTarget(targetPath, expected, maximumBytes) {
  const stats = await lstat(targetPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail("IMAGE_IMPORT_OUTPUT_COLLISION", "图片库中存在不安全的同名目标。");
  }
  const digest = await hashFile(targetPath, maximumBytes);
  if (digest.sha256 !== expected.sha256 || digest.bytes !== expected.bytes) {
    fail("IMAGE_IMPORT_OUTPUT_COLLISION", "图片库中存在摘要相同但内容不一致的目标。");
  }
  await validateDecodedImage(targetPath, expected.format);
}

async function commitStaging(stagingPath, targetPath, expected, maximumBytes) {
  let reused = false;
  try {
    await link(stagingPath, targetPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      await validateExistingTarget(targetPath, expected, maximumBytes);
      reused = true;
    } else if (["EPERM", "ENOSYS", "ENOTSUP", "EXDEV"].includes(String(error?.code || ""))) {
      try {
        await copyFile(stagingPath, targetPath, constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (copyError?.code !== "EEXIST") throw copyError;
        await validateExistingTarget(targetPath, expected, maximumBytes);
        reused = true;
      }
    } else {
      throw error;
    }
  } finally {
    await unlink(stagingPath).catch(() => undefined);
  }
  return reused;
}

function createSkipLedger() {
  const reasons = Object.create(null);
  const samples = [];
  return {
    add(reason, filePath, message) {
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (samples.length < 40) samples.push({ reason, path: filePath, message: String(message || "").slice(0, 240) });
    },
    count() {
      return Object.values(reasons).reduce((sum, value) => sum + Number(value || 0), 0);
    },
    snapshot() {
      return { reasons: { ...reasons }, samples: [...samples] };
    },
  };
}

async function secureOutputDirectory(outputDir) {
  await assertPathHasNoSymbolicComponent(
    outputDir,
    "IMAGE_IMPORT_UNSAFE_OUTPUT",
    "图片导入输出路径不能经过符号链接或目录联接。",
  );
  await mkdir(outputDir, { recursive: true });
  await assertPathHasNoSymbolicComponent(
    outputDir,
    "IMAGE_IMPORT_UNSAFE_OUTPUT",
    "图片导入输出路径不能经过符号链接或目录联接。",
  );
  const stats = await lstat(outputDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("IMAGE_IMPORT_UNSAFE_OUTPUT", "图片导入输出位置必须是安全的普通目录。");
  }
  const canonical = await realpath(outputDir);
  if (comparablePath(canonical) !== comparablePath(outputDir)) {
    fail("IMAGE_IMPORT_UNSAFE_OUTPUT", "图片导入输出路径不能经过符号链接或目录联接。");
  }
  return canonical;
}

async function collectInputFiles(inputPaths, outputRoot, maxFiles, maxFileBytes, maxTotalBytes, ledger, importBatchId) {
  const files = [];
  const visitedDirectories = new Set();
  let truncated = false;
  let truncatedByBytes = false;
  let selectedBytes = 0;

  async function visit(candidate, root) {
    if (truncated) return;
    let stats;
    try {
      stats = await lstat(candidate);
    } catch (error) {
      ledger.add("missing-or-unreadable", candidate, error?.message);
      return;
    }
    if (stats.isSymbolicLink()) {
      ledger.add("symbolic-link", candidate, "符号链接不会被导入。");
      return;
    }
    if (stats.isDirectory()) {
      let realDirectory;
      try {
        realDirectory = await realpath(candidate);
      } catch (error) {
        ledger.add("missing-or-unreadable", candidate, error?.message);
        return;
      }
      if (comparablePath(realDirectory) !== comparablePath(candidate)) {
        ledger.add("symbolic-link", candidate, "经过符号链接或目录联接的路径不会被导入。");
        return;
      }
      if (pathInside(realDirectory, outputRoot)) {
        ledger.add("output-directory", candidate, "输出目录不会被重新扫描。");
        return;
      }
      if (!root.kind) {
        root.kind = "directory";
        root.canonicalPath = realDirectory;
        root.importRootId = `root-${createHash("sha256").update(`${importBatchId}|${root.index}|directory`).digest("hex").slice(0, 24)}`;
        root.sourceRootLabel = path.basename(realDirectory) || `文件夹 ${root.index + 1}`;
      }
      const key = `${root.index}:${comparablePath(realDirectory)}`;
      if (visitedDirectories.has(key)) return;
      visitedDirectories.add(key);
      let entries;
      try {
        entries = await readdir(realDirectory, { withFileTypes: true });
      } catch (error) {
        ledger.add("missing-or-unreadable", candidate, error?.message);
        return;
      }
      entries.sort(stableCompare);
      for (const entry of entries) {
        await visit(path.join(realDirectory, entry.name), root);
        if (truncated) break;
      }
      return;
    }
    if (!stats.isFile()) {
      ledger.add("unsupported-entry", candidate, "只支持普通文件或目录。");
      return;
    }
    if (stats.size <= 0 || stats.size > maxFileBytes) {
      ledger.add("too-large", candidate, `单个图片文件不能超过 ${Math.max(1, Math.floor(maxFileBytes / 1024 / 1024))}MB。`);
      return;
    }
    if (selectedBytes + stats.size > maxTotalBytes) {
      truncated = true;
      truncatedByBytes = true;
      return;
    }
    let realFile;
    try {
      realFile = await realpath(candidate);
    } catch (error) {
      ledger.add("missing-or-unreadable", candidate, error?.message);
      return;
    }
    if (comparablePath(realFile) !== comparablePath(candidate)) {
      ledger.add("symbolic-link", candidate, "经过符号链接或目录联接的路径不会被导入。");
      return;
    }
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (!root.kind) {
      root.kind = "file";
      root.canonicalPath = realFile;
      root.importRootId = `root-${createHash("sha256").update(`${importBatchId}|${root.index}|file`).digest("hex").slice(0, 24)}`;
      root.sourceRootLabel = path.basename(realFile) || `图片 ${root.index + 1}`;
    }
    const sourceRelativePath = (root.kind === "directory"
      ? path.relative(root.canonicalPath, realFile)
      : path.basename(realFile)).split(path.sep).join("/");
    const occurrenceId = `occ-${createHash("sha256")
      .update(`${importBatchId}|${root.index}|${sourceRelativePath.normalize("NFC").toLowerCase()}`)
      .digest("hex")
      .slice(0, 32)}`;
    files.push({
      sourcePath: realFile,
      importBatchId,
      importRootId: root.importRootId,
      sourceRootLabel: root.sourceRootLabel,
      sourceRootKind: root.kind,
      sourceRelativePath,
      occurrenceId,
    });
    selectedBytes += stats.size;
  }

  const roots = inputPaths.map((inputPath, index) => ({
    index,
    requestedPath: inputPath,
    canonicalPath: "",
    importRootId: "",
    sourceRootLabel: "",
    kind: "",
  }));
  for (const root of roots) {
    await visit(root.requestedPath, root);
    if (truncated) break;
  }
  return {
    files,
    roots: roots.filter((root) => root.importRootId).map((root) => ({
      importBatchId,
      importRootIndex: root.index,
      importRootId: root.importRootId,
      sourceRootLabel: root.sourceRootLabel,
      sourceRootKind: root.kind,
    })),
    truncated,
    truncatedByBytes,
    selectedBytes,
  };
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await iteratee(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  return results;
}

function inputErrorReason(error) {
  const code = String(error?.code || "");
  if (code === "IMAGE_IMPORT_UNSUPPORTED_IMAGE") return "unsupported-image";
  if (code === "IMAGE_IMPORT_DAMAGED_IMAGE") return "damaged-image";
  if (code === "IMAGE_IMPORT_SOURCE_CHANGED") return "source-changed";
  if (code === "IMAGE_IMPORT_FILE_TOO_LARGE") return "too-large";
  if (["ENOENT", "EACCES", "EPERM"].includes(code)) return "missing-or-unreadable";
  return "";
}

async function processFile(sourcePath, outputRoot, requestId, index, maxFileBytes) {
  const before = await lstat(sourcePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    fail("IMAGE_IMPORT_UNSAFE_SOURCE", "图片来源必须是安全的普通文件。");
  }
  if (before.size <= 0 || before.size > maxFileBytes) throw sizeLimitError(maxFileBytes);
  const canonicalSource = await realpath(sourcePath);
  if (comparablePath(canonicalSource) !== comparablePath(sourcePath)) {
    fail("IMAGE_IMPORT_UNSAFE_SOURCE", "图片来源路径不能经过符号链接或目录联接。");
  }
  const format = await readMagic(sourcePath);
  if (!format) fail("IMAGE_IMPORT_UNSUPPORTED_IMAGE", "文件不是真实的 PNG、JPEG 或 WebP 图片。");
  const stagingPath = path.join(
    outputRoot,
    `.naimage-import-${requestId}-${String(index).padStart(6, "0")}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    const digest = await copyAndHash(sourcePath, stagingPath, maxFileBytes);
    const after = await lstat(sourcePath);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      fail("IMAGE_IMPORT_SOURCE_CHANGED", "图片在导入过程中发生了变化，请重试。");
    }
    const decoded = await validateDecodedImage(stagingPath, format);
    const extension = format === "jpeg" ? ".jpg" : `.${format}`;
    const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    const targetPath = path.join(outputRoot, `${digest.sha256}${extension}`);
    const reused = await commitStaging(stagingPath, targetPath, { ...digest, format }, maxFileBytes);
    return {
      sourcePath,
      path: targetPath,
      originalName: path.basename(sourcePath),
      mimeType,
      format,
      extension,
      sha256: digest.sha256,
      bytes: digest.bytes,
      width: decoded.width,
      height: decoded.height,
      hasAlpha: decoded.hasAlpha,
      reused,
    };
  } finally {
    await rm(stagingPath, { force: true }).catch(() => undefined);
  }
}

async function cleanupRequestStaging(outputRoot, requestId) {
  try {
    const prefix = `.naimage-import-${requestId}-`;
    const entries = await readdir(outputRoot, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".tmp")) {
        await rm(path.join(outputRoot, entry.name), { force: true }).catch(() => undefined);
      }
    }));
  } catch {
    // A fatal validation error can happen before the output directory exists.
  }
}

async function importImages(payload = {}) {
  const startedAt = Date.now();
  const requestId = String(payload.requestId || "");
  const inputPaths = Array.isArray(payload.inputPaths) ? payload.inputPaths.map((value) => path.resolve(String(value))) : [];
  const maxFiles = Number(payload.maxFiles);
  const maxConcurrentFiles = Number(payload.maxConcurrentFiles);
  const maxFileBytes = Number(payload.maxFileBytes);
  const maxTotalBytes = Number(payload.maxTotalBytes);
  if (!/^[a-f0-9]{24}$/i.test(requestId) || inputPaths.length === 0) fail("IMAGE_IMPORT_INVALID_REQUEST", "图片导入任务参数无效。");
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10_000) fail("IMAGE_IMPORT_INVALID_LIMIT", "图片导入数量无效。");
  if (!Number.isSafeInteger(maxConcurrentFiles) || maxConcurrentFiles < 1 || maxConcurrentFiles > 16) fail("IMAGE_IMPORT_INVALID_LIMIT", "并行导入文件数无效。");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > HARD_MAX_FILE_BYTES) fail("IMAGE_IMPORT_INVALID_LIMIT", "单张图片大小限制无效。");
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxFileBytes || maxTotalBytes > HARD_MAX_TOTAL_BYTES) fail("IMAGE_IMPORT_INVALID_LIMIT", "单次导入总大小限制无效。");
  const outputRoot = await secureOutputDirectory(path.resolve(String(payload.outputDir || "")));
  const ledger = createSkipLedger();
  try {
    const collected = await collectInputFiles(inputPaths, outputRoot, maxFiles, maxFileBytes, maxTotalBytes, ledger, requestId);
    let activeFiles = 0;
    let maxActiveFiles = 0;
    let completed = 0;
    const processed = await mapLimit(collected.files, maxConcurrentFiles, async (occurrence, index) => {
      activeFiles += 1;
      maxActiveFiles = Math.max(maxActiveFiles, activeFiles);
      try {
        return {
          ok: true,
          asset: {
            ...await processFile(occurrence.sourcePath, outputRoot, requestId, index, maxFileBytes),
            importBatchId: occurrence.importBatchId,
            importRootId: occurrence.importRootId,
            sourceRootLabel: occurrence.sourceRootLabel,
            sourceRootKind: occurrence.sourceRootKind,
            sourceRelativePath: occurrence.sourceRelativePath,
            occurrenceId: occurrence.occurrenceId,
          }
        };
      } catch (error) {
        const reason = inputErrorReason(error);
        if (!reason) return { ok: false, fatal: error, sourcePath: occurrence.sourcePath };
        ledger.add(reason, occurrence.sourcePath, error?.message);
        return { ok: false, sourcePath: occurrence.sourcePath };
      } finally {
        activeFiles -= 1;
        completed += 1;
        if (completed === collected.files.length || completed % 50 === 0) {
          await send({ type: "progress", requestId, completed, total: collected.files.length });
        }
      }
    });

    const fatal = processed.find((entry) => entry?.fatal);
    if (fatal) {
      const error = fatal.fatal;
      fail(
        String(error?.code || "IMAGE_IMPORT_COPY_FAILED").startsWith("IMAGE_IMPORT_") ? error.code : "IMAGE_IMPORT_COPY_FAILED",
        `无法写入图片库：${error instanceof Error ? error.message : String(error)}`,
        { sourcePath: fatal.sourcePath },
      );
    }

    const assets = [];
    const seenContent = new Set();
    let duplicateCount = 0;
    let reusedCount = 0;
    let validCount = 0;
    for (const entry of processed) {
      if (!entry?.ok || !entry.asset) continue;
      validCount += 1;
      if (seenContent.has(entry.asset.sha256)) {
        duplicateCount += 1;
      } else {
        seenContent.add(entry.asset.sha256);
        if (entry.asset.reused) reusedCount += 1;
      }
      assets.push({ ...entry.asset, index: assets.length + 1 });
    }
    const skipped = ledger.snapshot();
    return {
      ok: true,
      requestId,
      workerPid: process.pid,
      outputDir: outputRoot,
      assets,
      roots: collected.roots,
      importBatchId: requestId,
      inputCount: inputPaths.length,
      selectedCount: collected.files.length,
      validCount,
      importedCount: seenContent.size,
      uniqueAssetCount: seenContent.size,
      occurrenceCount: assets.length,
      duplicateCount,
      reusedCount,
      skippedCount: ledger.count(),
      skipReasons: skipped.reasons,
      skippedSamples: skipped.samples,
      truncated: collected.truncated,
      truncatedByBytes: collected.truncatedByBytes,
      selectedBytes: collected.selectedBytes,
      importedBytes: assets.reduce((sum, asset) => sum + Number(asset.bytes || 0), 0),
      maxFileBytes,
      maxTotalBytes,
      maxConcurrentFiles,
      maxActiveFiles,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await cleanupRequestStaging(outputRoot, requestId);
  }
}

function serializeError(error) {
  return {
    code: String(error?.code || "IMAGE_IMPORT_FAILED").startsWith("IMAGE_IMPORT_") ? error.code : "IMAGE_IMPORT_FAILED",
    message: error instanceof Error ? error.message : String(error),
    details: error?.details,
    stack: error?.stack,
  };
}

function send(message) {
  return new Promise((resolve) => {
    if (typeof process.send !== "function") {
      resolve();
      return;
    }
    process.send(message, () => resolve());
  });
}

process.once("message", async (payload) => {
  try {
    const result = await importImages(payload);
    await send({ type: "result", result });
  } catch (error) {
    await send({ type: "error", error: serializeError(error) });
  } finally {
    process.disconnect?.();
  }
});
