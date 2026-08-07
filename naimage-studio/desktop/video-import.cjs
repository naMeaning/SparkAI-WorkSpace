"use strict";

const { createHash, randomBytes } = require("node:crypto");
const {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync
} = require("node:fs");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const DEFAULT_MAX_FILES = 100;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024 * 1024;
const VIDEO_FORMATS = Object.freeze({
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
});

class VideoImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VideoImportError";
    this.code = code;
  }
}

function safeSourceName(filePath) {
  return path.basename(String(filePath || "video"))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 260) || "video";
}

function videoFormatForPath(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return VIDEO_FORMATS[extension] ? { extension, mimeType: VIDEO_FORMATS[extension] } : null;
}

function videoHeaderForPath(filePath, extension) {
  const descriptor = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(64);
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (extension === ".webm") {
      if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
        throw new VideoImportError("VIDEO_FORMAT_MISMATCH", "WebM 文件头无效。");
      }
      return;
    }
    const ftypOffset = bytes.indexOf(Buffer.from("ftyp", "ascii"));
    if (ftypOffset < 4 || ftypOffset > 56) {
      throw new VideoImportError("VIDEO_FORMAT_MISMATCH", "MP4/MOV 文件头缺少 ftyp 标记。");
    }
  } finally {
    closeSync(descriptor);
  }
}

function inspectVideoSource(filePath) {
  const name = safeSourceName(filePath);
  const format = videoFormatForPath(filePath);
  if (!format) throw new VideoImportError("VIDEO_FORMAT_UNSUPPORTED", `${name} 不是支持的 MP4、WebM、MOV 或 M4V 文件。`);
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    throw new VideoImportError("VIDEO_SOURCE_MISSING", `${name} 不存在或无法读取。`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new VideoImportError("VIDEO_SOURCE_INVALID", `${name} 不是可导入的普通视频文件。`);
  }
  if (!Number.isSafeInteger(stats.size) || stats.size <= 0) {
    throw new VideoImportError("VIDEO_SOURCE_EMPTY", `${name} 是空文件。`);
  }
  if (stats.size > MAX_VIDEO_BYTES) {
    throw new VideoImportError("VIDEO_SOURCE_TOO_LARGE", `${name} 超过当前 16GB 单文件上限。`);
  }
  videoHeaderForPath(filePath, format.extension);
  return { ...format, name, size: stats.size };
}

async function copyVideoWithHash(sourcePath, outputDir, format) {
  mkdirSync(outputDir, { recursive: true });
  const temporaryPath = path.join(outputDir, `.naimage-video-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  const hash = createHash("sha256");
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(
      createReadStream(sourcePath),
      hashingStream,
      createWriteStream(temporaryPath, { flags: "wx" })
    );
    const sha256 = hash.digest("hex");
    const targetPath = path.join(outputDir, `${sha256.slice(0, 32)}${format.extension}`);
    let reused = false;
    if (existsSync(targetPath)) {
      const targetStats = lstatSync(targetPath);
      if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
        throw new VideoImportError("VIDEO_TARGET_INVALID", "项目视频库中的目标条目无效。");
      }
      rmSync(temporaryPath, { force: true });
      reused = true;
    } else {
      try {
        renameSync(temporaryPath, targetPath);
      } catch (error) {
        if (!existsSync(targetPath)) throw error;
        rmSync(temporaryPath, { force: true });
        reused = true;
      }
    }
    return { path: targetPath, sha256, reused };
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function importVideoFiles({ inputPaths = [], outputDir, maxFiles = DEFAULT_MAX_FILES } = {}) {
  const requestedPaths = Array.isArray(inputPaths) ? inputPaths.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const limit = Math.max(1, Math.min(Math.floor(Number(maxFiles) || DEFAULT_MAX_FILES), DEFAULT_MAX_FILES));
  const selected = requestedPaths.slice(0, limit);
  const batchId = `video-import-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const assets = [];
  const errors = [];
  let reusedCount = 0;

  for (const [index, sourcePath] of selected.entries()) {
    const name = safeSourceName(sourcePath);
    try {
      const format = inspectVideoSource(sourcePath);
      const copied = await copyVideoWithHash(sourcePath, outputDir, format);
      if (copied.reused) reusedCount += 1;
      const occurrenceHash = createHash("sha256")
        .update(`${batchId}:${index}:${copied.sha256}`)
        .digest("hex")
        .slice(0, 32);
      assets.push({
        assetId: `video-${copied.sha256.slice(0, 32)}`,
        occurrenceId: `occ-${occurrenceHash}`,
        contentHash: copied.sha256,
        type: "file",
        path: copied.path,
        originalName: format.name,
        mimeType: format.mimeType
      });
    } catch (error) {
      errors.push({
        name,
        errorCode: String(error?.code || "VIDEO_IMPORT_FAILED"),
        error: error instanceof Error ? error.message : `${name} 导入失败。`
      });
    }
  }

  const firstError = errors[0];
  return {
    ok: assets.length > 0,
    assets,
    errors,
    selectedCount: requestedPaths.length,
    importedCount: assets.length,
    skippedCount: errors.length,
    truncated: requestedPaths.length > selected.length,
    reusedCount,
    ...(assets.length ? {} : {
      errorCode: firstError?.errorCode || "VIDEO_IMPORT_EMPTY",
      error: firstError?.error || "没有可导入的视频文件。"
    })
  };
}

module.exports = {
  DEFAULT_MAX_FILES,
  MAX_VIDEO_BYTES,
  VIDEO_FORMATS,
  VideoImportError,
  importVideoFiles,
  inspectVideoSource,
  videoFormatForPath
};
