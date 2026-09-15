"use strict";

const {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat
} = require("node:fs/promises");
const { constants: fsConstants } = require("node:fs");
const path = require("node:path");
const automationCommandSchema = require("../integrations/naimage-control/references/commands.schema.json");

const SHARP_INPUT_OPTIONS = Object.freeze({ failOn: "error", limitInputPixels: 268_402_689 });

const imageExportCommand = automationCommandSchema.sections
  .flatMap((section) => section.commands || [])
  .find((command) => command.name === "canvas.export-image");
const imageExportFormatNames = imageExportCommand?.parameters?.properties?.format?.enum || [];
if (!imageExportFormatNames.length || !imageExportCommand?.formatDefinitions) {
  throw new Error("canvas.export-image has no structured format registry.");
}
const IMAGE_EXPORT_FORMATS = Object.freeze(Object.fromEntries(imageExportFormatNames.map((format) => {
  const definition = imageExportCommand.formatDefinitions[format];
  if (!definition?.extension || !definition?.mimeType || !definition?.label || !Array.isArray(definition.extensions)) {
    throw new Error(`canvas.export-image format ${format} has incomplete metadata.`);
  }
  return [format, Object.freeze({ ...definition, extensions: Object.freeze([...definition.extensions]) })];
})));

function normalizeImageExportFormat(value, fallback = "png") {
  const normalized = String(value || "").trim().toLowerCase().replace(/^\./, "");
  const alias = normalized === "jpg" ? "jpeg" : normalized === "tif" ? "tiff" : normalized;
  if (Object.prototype.hasOwnProperty.call(IMAGE_EXPORT_FORMATS, alias)) return alias;
  const normalizedFallback = String(fallback || "png").trim().toLowerCase().replace(/^\./, "");
  const fallbackAlias = normalizedFallback === "jpg" ? "jpeg" : normalizedFallback === "tif" ? "tiff" : normalizedFallback;
  return Object.prototype.hasOwnProperty.call(IMAGE_EXPORT_FORMATS, fallbackAlias) ? fallbackAlias : "png";
}

function imageExportFormatFromExtension(filePath) {
  const raw = String(filePath || "").trim();
  const selectedExtension = path.extname(raw) || (/^\.[a-z0-9]+$/i.test(raw) ? raw : "");
  const extension = selectedExtension.slice(1).toLowerCase();
  if (!extension) return "";
  return Object.entries(IMAGE_EXPORT_FORMATS)
    .find(([, definition]) => definition.extensions.includes(extension))?.[0] || "";
}

function imageExportFilters(preferredFormat = "png") {
  const preferred = normalizeImageExportFormat(preferredFormat);
  return [preferred, ...Object.keys(IMAGE_EXPORT_FORMATS).filter((format) => format !== preferred)]
    .map((format) => ({
      name: IMAGE_EXPORT_FORMATS[format].label,
      extensions: [...IMAGE_EXPORT_FORMATS[format].extensions]
    }));
}

function matchingImageExportExtension(filePath, format) {
  const definition = IMAGE_EXPORT_FORMATS[normalizeImageExportFormat(format)];
  const selectedExtension = path.extname(String(filePath || "")).toLowerCase();
  if (!selectedExtension) return `${filePath}${definition.extension}`;
  if (definition.extensions.includes(selectedExtension.slice(1))) return filePath;
  return path.join(path.dirname(filePath), `${path.parse(filePath).name}${definition.extension}`);
}

function decodedImageExportFormat(metadata) {
  const normalized = String(metadata?.format || "").trim().toLowerCase();
  const alias = normalized === "jpg"
    ? "jpeg"
    : normalized === "tif"
      ? "tiff"
      : normalized === "heif"
        ? String(metadata?.compression || "").trim().toLowerCase() === "av1" ? "avif" : ""
        : normalized;
  return Object.prototype.hasOwnProperty.call(IMAGE_EXPORT_FORMATS, alias) ? alias : "";
}

function comparableFilePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function existingFileStats(filePath) {
  try {
    return await stat(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function pathsReferToSameFile(leftPath, rightPath) {
  if (comparableFilePath(leftPath) === comparableFilePath(rightPath)) return true;
  const [leftStats, rightStats] = await Promise.all([existingFileStats(leftPath), existingFileStats(rightPath)]);
  if (!leftStats || !rightStats) return false;
  if (leftStats.ino !== 0n && leftStats.dev === rightStats.dev && leftStats.ino === rightStats.ino) return true;
  const [leftRealPath, rightRealPath] = await Promise.all([realpath(leftPath), realpath(rightPath)]);
  return comparableFilePath(leftRealPath) === comparableFilePath(rightRealPath);
}

async function inspectDecodedExportImage(filePath, expectedFormat, fullDecode = false) {
  const sharp = require("sharp");
  const metadata = await sharp(filePath, SHARP_INPUT_OPTIONS).metadata();
  const format = decodedImageExportFormat(metadata);
  if (!format) throw new Error("The image format is not supported for local export.");
  if (expectedFormat && format !== expectedFormat) {
    throw new Error(`The exported image format is ${format}, not ${expectedFormat}.`);
  }
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);
  if (width <= 0 || height <= 0) throw new Error("The exported image dimensions are invalid.");
  if (fullDecode) {
    const decoded = await sharp(filePath, SHARP_INPUT_OPTIONS).stats();
    if (!Array.isArray(decoded?.channels) || decoded.channels.length <= 0) {
      throw new Error("The exported image could not be fully decoded.");
    }
  }
  return { format, width, height };
}

async function renameWithRetry(sourcePath, destinationPath, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!new Set(["EPERM", "EACCES", "EBUSY"]).has(error?.code) || attempt === attempts - 1) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(200, 12 * (2 ** attempt))));
    }
  }
}

async function publishWithoutClobber(stagingPath, destinationPath, operations = {}) {
  const createLink = typeof operations.link === "function" ? operations.link : link;
  const copyExclusive = typeof operations.copyFile === "function" ? operations.copyFile : copyFile;
  try {
    await createLink(stagingPath, destinationPath);
    return;
  } catch (error) {
    if (error?.code === "EEXIST") {
      const conflict = new Error("The export destination was created by another operation. Confirm overwrite and retry.");
      conflict.code = "NAIMAGE_EXPORT_TARGET_EXISTS";
      throw conflict;
    }
    try {
      await copyExclusive(stagingPath, destinationPath, fsConstants.COPYFILE_EXCL);
      return;
    } catch (copyError) {
      if (copyError?.code === "EEXIST") {
        const conflict = new Error("The export destination was created by another operation. Confirm overwrite and retry.");
        conflict.code = "NAIMAGE_EXPORT_TARGET_EXISTS";
        throw conflict;
      }
      if (copyError && typeof copyError === "object" && copyError.cause === undefined) copyError.cause = error;
      throw copyError;
    }
  }
}

async function convertImageForExport(sourcePath, destinationPath, requestedFormat, options = {}) {
  const format = normalizeImageExportFormat(requestedFormat);
  const definition = IMAGE_EXPORT_FORMATS[format];
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestination = path.resolve(destinationPath);
  await mkdir(path.dirname(resolvedDestination), { recursive: true });

  const sourceInspection = await inspectDecodedExportImage(resolvedSource);
  const sourceFormat = sourceInspection.format;
  const sameFile = await pathsReferToSameFile(resolvedSource, resolvedDestination);
  if (sourceFormat !== format && sameFile) {
    throw new Error("The export destination refers to the managed source image. Choose another file for format conversion.");
  }

  let validation;
  let cleanupWarning = "";
  if (sameFile) {
    validation = await inspectDecodedExportImage(resolvedSource, format, true);
  } else {
    const stagingRoot = await mkdtemp(path.join(path.dirname(resolvedDestination), ".naimage-export-"));
    const stagingPath = path.join(stagingRoot, `image${definition.extension}`);
    let committed = false;
    let exportError = null;
    const cleanupStaging = typeof options.cleanupStaging === "function" ? options.cleanupStaging : rm;
    try {
      if (sourceFormat === format) {
        await copyFile(resolvedSource, stagingPath);
      } else {
        const sharp = require("sharp");
        let pipeline = sharp(resolvedSource, SHARP_INPUT_OPTIONS).rotate();
        if (format === "png") pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
        else if (format === "jpeg") pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
        else if (format === "webp") pipeline = pipeline.webp({ quality: 92, alphaQuality: 100, smartSubsample: true });
        else if (format === "avif") pipeline = pipeline.avif({ quality: 72, effort: 4, chromaSubsampling: "4:4:4" });
        else pipeline = pipeline.tiff({ compression: "lzw", quality: 92 });
        await pipeline.toFile(stagingPath);
      }
      validation = await inspectDecodedExportImage(stagingPath, format, true);
      if (options.overwrite === true) await renameWithRetry(stagingPath, resolvedDestination);
      else await publishWithoutClobber(stagingPath, resolvedDestination, options.publishOperations);
      committed = true;
    } catch (error) {
      exportError = error;
      throw error;
    } finally {
      try {
        await cleanupStaging(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (committed) cleanupWarning = message;
        else if (exportError && typeof exportError === "object") exportError.cleanupWarning = message;
        else throw error;
      }
    }
  }

  const stats = await stat(resolvedDestination);
  if (!stats.isFile() || stats.size <= 0) throw new Error("The exported image is empty.");
  return {
    format,
    path: resolvedDestination,
    extension: definition.extension,
    mimeType: definition.mimeType,
    bytes: stats.size,
    width: validation.width,
    height: validation.height,
    converted: sourceFormat !== format,
    ...(cleanupWarning ? { cleanupWarning } : {})
  };
}

module.exports = {
  IMAGE_EXPORT_FORMATS,
  convertImageForExport,
  decodedImageExportFormat,
  imageExportFilters,
  imageExportFormatFromExtension,
  matchingImageExportExtension,
  normalizeImageExportFormat
};
