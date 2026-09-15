"use strict";

const { createHash } = require("node:crypto");
const { existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

function send(message) {
  if (typeof process.send === "function") process.send(message);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function convert(payload = {}) {
  const sourcePath = path.resolve(String(payload.sourcePath || ""));
  const cacheDir = path.resolve(String(payload.cacheDir || ""));
  const ownerPid = Number(payload.ownerPid || 0);
  if (!sourcePath || !cacheDir || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    fail("PSD_RASTER_INVALID_INPUT", "PSD 图片转换参数无效。");
  }
  if (!existsSync(sourcePath)) fail("PSD_RASTER_SOURCE_NOT_FOUND", "PSD 源图片不存在。");
  const sourceStats = lstatSync(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) fail("PSD_RASTER_UNSAFE_SOURCE", "PSD 源图片不是安全的普通文件。");
  mkdirSync(cacheDir, { recursive: true });
  const cacheStats = lstatSync(cacheDir);
  if (!cacheStats.isDirectory() || cacheStats.isSymbolicLink()) fail("PSD_RASTER_UNSAFE_CACHE", "PSD 转换缓存目录不安全。");

  const image = sharp(sourcePath, { failOn: "error", limitInputPixels: 90_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "webp"].includes(String(metadata.format || "").toLowerCase())) {
    fail("PSD_RASTER_UNSUPPORTED_SOURCE", "普通图片 PSD 转换只接受真实的 JPEG 或 WEBP 源文件。");
  }
  const converted = await image
    .ensureAlpha()
    .png({ compressionLevel: 6, palette: false, force: true })
    .toBuffer({ resolveWithObject: true });
  if (converted.info.width !== metadata.width || converted.info.height !== metadata.height || converted.info.channels !== 4) {
    fail("PSD_RASTER_DIMENSION_MISMATCH", "JPEG/WEBP 转换没有保留原始尺寸或 RGBA 通道。");
  }

  const digest = createHash("sha256").update(converted.data).digest("hex");
  const outputPath = path.join(cacheDir, `${digest}-${ownerPid}.png`);
  const temporaryPath = `${outputPath}.convert-${process.pid}.tmp`;
  writeFileSync(temporaryPath, converted.data, { flag: "wx" });
  try {
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    if (existsSync(outputPath)) rmSync(temporaryPath, { force: true });
    else throw error;
  }
  return {
    path: outputPath,
    width: converted.info.width,
    height: converted.info.height,
    channels: converted.info.channels,
    sourceFormat: metadata.format,
    sha256: digest,
    bytes: converted.data.length,
    converted: true,
  };
}

process.once("message", (payload) => {
  convert(payload)
    .then((result) => send({ type: "result", result }))
    .catch((error) => send({
      type: "error",
      error: {
        code: String(error?.code || "").startsWith("PSD_") ? error.code : "PSD_RASTER_CONVERSION_FAILED",
        message: String(error?.code || "").startsWith("PSD_")
          ? (error instanceof Error ? error.message : String(error))
          : "图片格式损坏或无法解码，不能导出 Photoshop PSD。",
        stack: error?.stack,
      },
    }))
    .finally(() => process.disconnect?.());
});
