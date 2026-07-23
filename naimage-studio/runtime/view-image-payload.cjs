const { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync } = require("node:fs");
const path = require("node:path");

let sharpImage = null;

try {
  sharpImage = require("sharp");
} catch {
  sharpImage = null;
}

const viewImageModelPayloadMaxBytes = 900 * 1024;
const viewImageModelTurnPayloadMaxBytes = 1200 * 1024;
const viewImageModelPayloadMinBytes = 96 * 1024;
const runtimeImageSourceMaxBytes = 128 * 1024 * 1024;
const viewImageHighMaxEdge = 1536;

function pathWithinRoot(filePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realPathForAuthorization(filePath) {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) return resolved;
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function viewImagePathAllowed(filePath, roots = []) {
  const resolvedPath = path.resolve(filePath);
  const realResolvedPath = realPathForAuthorization(resolvedPath);
  return roots.some((root) => {
    if (typeof root !== "string" || !root.trim()) return false;
    const resolvedRoot = path.resolve(root);
    const realResolvedRoot = realPathForAuthorization(resolvedRoot);
    return pathWithinRoot(resolvedPath, resolvedRoot) && pathWithinRoot(realResolvedPath, realResolvedRoot);
  });
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function parseImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      format: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { format: "webp", width: null, height: null };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
        return {
          format: "jpeg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5)
        };
      }
      offset += 2 + length;
    }
    return { format: "jpeg", width: null, height: null };
  }

  return { format: "unknown", width: null, height: null };
}

function readRuntimeImageFile(imagePath, maximumBytes = runtimeImageSourceMaxBytes, label = "图片") {
  const safeMaximum = Math.max(1, Math.floor(Number(maximumBytes) || 0));
  const descriptor = openSync(imagePath, "r");
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile()) throw new Error(`${label}不是有效文件。`);
    if (info.size > safeMaximum) throw new Error(`${label}超过 ${Math.round(safeMaximum / 1024 / 1024)}MB 安全上限。`);
    const ceiling = safeMaximum + 1;
    let capacity = Math.min(ceiling, Math.max(64 * 1024, Number(info.size || 0) + 1));
    let buffer = Buffer.allocUnsafe(capacity);
    let offset = 0;
    while (offset < ceiling) {
      if (offset === buffer.length) {
        const nextCapacity = Math.min(ceiling, Math.max(offset + 64 * 1024, buffer.length * 2));
        if (nextCapacity <= buffer.length) break;
        const expanded = Buffer.allocUnsafe(nextCapacity);
        buffer.copy(expanded, 0, 0, offset);
        buffer = expanded;
      }
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > safeMaximum) throw new Error(`${label}在读取期间发生变化或超过 ${Math.round(safeMaximum / 1024 / 1024)}MB 安全上限。`);
    return buffer.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

function imageInfo(imagePath, sourceBuffer = null) {
  if (!imagePath || !existsSync(imagePath)) {
    return { exists: false, path: imagePath || "", bytes: 0, format: "missing", width: null, height: null };
  }

  const buffer = Buffer.isBuffer(sourceBuffer) ? sourceBuffer : readRuntimeImageFile(imagePath);
  const dimensions = parseImageDimensions(buffer);
  return {
    exists: true,
    path: imagePath,
    bytes: buffer.length,
    ...dimensions
  };
}

function viewImagePayloadBudgetForBatch(count = 1) {
  const normalizedCount = Math.max(1, Math.min(10, Number.isSafeInteger(Number(count)) ? Number(count) : 1));
  return Math.min(
    viewImageModelPayloadMaxBytes,
    Math.max(viewImageModelPayloadMinBytes, Math.floor(viewImageModelTurnPayloadMaxBytes / normalizedCount))
  );
}

async function prepareViewImageModelPayload(imagePath, requestedDetail = "high", requestedPayloadMaxBytes = viewImageModelPayloadMaxBytes) {
  const detail = String(requestedDetail || "high").trim().toLowerCase();
  if (!["high", "original"].includes(detail)) throw new Error("detail 只支持 high 或 original。");
  const numericPayloadMaxBytes = Number(requestedPayloadMaxBytes);
  const payloadMaxBytes = Number.isFinite(numericPayloadMaxBytes)
    ? Math.max(viewImageModelPayloadMinBytes, Math.min(viewImageModelPayloadMaxBytes, Math.floor(numericPayloadMaxBytes)))
    : viewImageModelPayloadMaxBytes;
  const source = readRuntimeImageFile(imagePath);
  const sourceInfo = imageInfo(imagePath, source);
  const sourceMimeType = mimeTypeForPath(imagePath);
  const sourceWithinHighDimensions =
    !sourceInfo.width ||
    !sourceInfo.height ||
    Math.max(sourceInfo.width, sourceInfo.height) <= viewImageHighMaxEdge;
  const canUseSourceDirectly =
    source.length <= payloadMaxBytes &&
    (detail === "original" || sourceWithinHighDimensions) &&
    sourceMimeType.startsWith("image/");

  if (canUseSourceDirectly) {
    return {
      dataUrl: `data:${sourceMimeType};base64,${source.toString("base64")}`,
      detail,
      mimeType: sourceMimeType,
      payloadBytes: source.length,
      width: sourceInfo.width,
      height: sourceInfo.height,
      sourceWidth: sourceInfo.width,
      sourceHeight: sourceInfo.height,
      transcoded: false,
      resized: false
    };
  }

  if (!sharpImage) {
    throw new Error("图片观察副本超过模型传输上限，且当前环境缺少图像缩放组件。请改用较小图片。");
  }

  const attempts = detail === "original"
    ? [
        { quality: 92 },
        { quality: 84 },
        { quality: 76 },
        { quality: 68 },
        { quality: 58 },
        { quality: 48 },
        { quality: 40 },
        { quality: 32 }
      ]
    : [
        { maxEdge: 1536, quality: 86 },
        { maxEdge: 1536, quality: 76 },
        { maxEdge: 1280, quality: 82 },
        { maxEdge: 1280, quality: 70 },
        { maxEdge: 1024, quality: 78 },
        { maxEdge: 768, quality: 72 },
        { maxEdge: 640, quality: 64 },
        { maxEdge: 512, quality: 56 },
        { maxEdge: 384, quality: 48 },
        { maxEdge: 256, quality: 40 }
      ];
  let smallest = null;

  for (const attempt of attempts) {
    let pipeline = sharpImage(imagePath, { failOn: "none", limitInputPixels: 268402689 }).rotate();
    if (attempt.maxEdge) {
      pipeline = pipeline.resize({
        width: attempt.maxEdge,
        height: attempt.maxEdge,
        fit: "inside",
        withoutEnlargement: true
      });
    }
    const encoded = await pipeline
      .webp({ quality: attempt.quality, alphaQuality: Math.max(attempt.quality, 88), effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    const candidate = {
      dataUrl: `data:image/webp;base64,${encoded.data.toString("base64")}`,
      detail,
      mimeType: "image/webp",
      payloadBytes: encoded.data.length,
      width: encoded.info.width,
      height: encoded.info.height,
      sourceWidth: sourceInfo.width,
      sourceHeight: sourceInfo.height,
      transcoded: true,
      resized: Boolean(
        sourceInfo.width &&
        sourceInfo.height &&
        (encoded.info.width !== sourceInfo.width || encoded.info.height !== sourceInfo.height)
      )
    };
    if (!smallest || candidate.payloadBytes < smallest.payloadBytes) smallest = candidate;
    if (candidate.payloadBytes <= payloadMaxBytes) return candidate;
  }

  if (detail === "original") {
    throw new Error(`原始分辨率观察副本仍超过本轮 ${Math.max(1, Math.round(payloadMaxBytes / 1024))}KB 传输预算，请改用 detail=high。`);
  }
  if (smallest && smallest.payloadBytes <= payloadMaxBytes) return smallest;
  throw new Error(`无法把图片观察副本压缩到 ${Math.max(1, Math.round(payloadMaxBytes / 1024))}KB 的本轮模型预算内。`);
}

module.exports = {
  imageInfo,
  mimeTypeForPath,
  prepareViewImageModelPayload,
  readRuntimeImageFile,
  runtimeImageSourceMaxBytes,
  viewImageModelPayloadMaxBytes,
  viewImagePathAllowed,
  viewImagePayloadBudgetForBatch
};
