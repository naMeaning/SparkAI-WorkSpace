"use strict";

const { createHash, randomBytes } = require("node:crypto");
const {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync
} = require("node:fs");
const path = require("node:path");

const GLASS_BACKGROUND_ASSET_ID_PATTERN = /^glass-bg-[a-f0-9]{64}$/;
const GLASS_BACKGROUND_FILE_PATTERN = /^glass-bg-([a-f0-9]{64})\.webp$/;
const GLASS_BACKGROUND_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const GLASS_BACKGROUND_MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const GLASS_BACKGROUND_MAX_INPUT_PIXELS = 100_000_000;
const GLASS_BACKGROUND_MAX_EDGE = 3_840;
const GLASS_BACKGROUND_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const GLASS_BACKGROUND_MAX_GC_FILES = 8;
const supportedInputFormats = new Set(["avif", "gif", "heif", "jpeg", "png", "tiff", "webp"]);
const defaultGlassBackgroundSettings = Object.freeze({
  glassBackgroundEnabled: false,
  glassBackgroundAssetId: "",
  glassBackgroundAssetName: "",
  glassBackgroundAssetMetadata: null,
  glassBackgroundOverlay: 38,
  glassBackgroundBlur: 6
});

function glassBackgroundFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicGlassBackgroundFailure(error, fallbackCode, fallbackMessage) {
  const candidate = String(error?.code || "");
  const owned = /^GLASS_BACKGROUND_[A-Z0-9_]+$/.test(candidate);
  return {
    errorCode: owned ? candidate : fallbackCode,
    error: owned && error instanceof Error ? error.message : fallbackMessage
  };
}

function normalizeGlassBackgroundAssetId(value) {
  const assetId = String(value || "").trim().toLowerCase();
  return GLASS_BACKGROUND_ASSET_ID_PATTERN.test(assetId) ? assetId : "";
}

function normalizeGlassBackgroundAssetName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function safeGlassBackgroundName(value) {
  const name = normalizeGlassBackgroundAssetName(path.basename(String(value || "background.webp")));
  return name || "background.webp";
}

function clampedInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function normalizeGlassBackgroundSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const glassBackgroundAssetId = normalizeGlassBackgroundAssetId(source.glassBackgroundAssetId);
  const metadataSource = source.glassBackgroundAssetMetadata;
  const metadataRecord = metadataSource && typeof metadataSource === "object" && !Array.isArray(metadataSource)
    ? metadataSource
    : null;
  const width = clampedInteger(metadataRecord?.width, 0, 0, GLASS_BACKGROUND_MAX_EDGE);
  const height = clampedInteger(metadataRecord?.height, 0, 0, GLASS_BACKGROUND_MAX_EDGE);
  const bytes = clampedInteger(metadataRecord?.bytes, 0, 0, GLASS_BACKGROUND_MAX_OUTPUT_BYTES);
  const glassBackgroundAssetMetadata = glassBackgroundAssetId
    && metadataRecord?.mimeType === "image/webp"
    && width > 0
    && height > 0
    && bytes > 0
    ? { mimeType: "image/webp", width, height, bytes }
    : null;
  const overlay = Number(source.glassBackgroundOverlay);
  const blur = Number(source.glassBackgroundBlur);
  return {
    glassBackgroundEnabled: Boolean(source.glassBackgroundEnabled) && Boolean(glassBackgroundAssetId),
    glassBackgroundAssetId,
    glassBackgroundAssetName: glassBackgroundAssetId && String(source.glassBackgroundAssetName || "").trim()
      ? normalizeGlassBackgroundAssetName(source.glassBackgroundAssetName)
      : "",
    glassBackgroundAssetMetadata,
    glassBackgroundOverlay: Number.isFinite(overlay)
      ? Math.max(0, Math.min(80, Math.round(overlay)))
      : defaultGlassBackgroundSettings.glassBackgroundOverlay,
    glassBackgroundBlur: Number.isFinite(blur)
      ? Math.max(0, Math.min(40, Math.round(blur)))
      : defaultGlassBackgroundSettings.glassBackgroundBlur
  };
}

function createGlassBackgroundService({
  assetsDir,
  dialog,
  sharp,
  now = () => Date.now(),
  retentionMs = GLASS_BACKGROUND_RETENTION_MS,
  log = () => {}
} = {}) {
  const root = path.resolve(String(assetsDir || ""));
  if (!assetsDir || root === path.parse(root).root) throw new TypeError("glass background assetsDir is required");
  if (!dialog || typeof dialog.showOpenDialog !== "function") throw new TypeError("glass background dialog is required");
  if (typeof sharp !== "function") throw new TypeError("glass background Sharp runtime is required");
  const resolvedRetentionMs = Math.max(60_000, Math.floor(Number(retentionMs) || GLASS_BACKGROUND_RETENTION_MS));

  function ensureAssetsDir() {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const stats = lstatSync(root);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw glassBackgroundFailure("GLASS_BACKGROUND_DIRECTORY_INVALID", "The managed background directory failed validation.");
    }
  }

  function filePathFor(assetId) {
    const normalized = normalizeGlassBackgroundAssetId(assetId);
    if (!normalized) throw glassBackgroundFailure("GLASS_BACKGROUND_ID_INVALID", "The managed background asset id is invalid.");
    const filePath = path.join(root, `${normalized}.webp`);
    if (path.dirname(filePath) !== root) throw glassBackgroundFailure("GLASS_BACKGROUND_ID_INVALID", "The managed background asset id is invalid.");
    return filePath;
  }

  function readBoundedSource(filePath) {
    const beforeOpen = lstatSync(filePath);
    if (beforeOpen.isSymbolicLink() || !beforeOpen.isFile()) {
      throw glassBackgroundFailure("GLASS_BACKGROUND_SOURCE_INVALID", "Select a regular image file.");
    }
    const descriptor = openSync(filePath, "r");
    try {
      const stats = fstatSync(descriptor);
      if (!stats.isFile() || stats.size <= 0) {
        throw glassBackgroundFailure("GLASS_BACKGROUND_SOURCE_INVALID", "The selected image file is empty or invalid.");
      }
      if (stats.size > GLASS_BACKGROUND_MAX_SOURCE_BYTES) {
        throw glassBackgroundFailure("GLASS_BACKGROUND_SOURCE_TOO_LARGE", "The selected background exceeds the 64 MiB source limit.");
      }
      const bytes = Buffer.allocUnsafe(stats.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        if (count <= 0) break;
        offset += count;
      }
      if (offset !== bytes.length) {
        throw glassBackgroundFailure("GLASS_BACKGROUND_SOURCE_CHANGED", "The selected image changed while it was being read.");
      }
      const extra = Buffer.allocUnsafe(1);
      if (readSync(descriptor, extra, 0, 1, offset) > 0) {
        throw glassBackgroundFailure("GLASS_BACKGROUND_SOURCE_CHANGED", "The selected image changed while it was being read.");
      }
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  }

  function managedFileBytes(assetId) {
    const filePath = filePathFor(assetId);
    if (!existsSync(filePath)) throw glassBackgroundFailure("GLASS_BACKGROUND_NOT_FOUND", "The managed background image is no longer available.");
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > GLASS_BACKGROUND_MAX_OUTPUT_BYTES) {
      throw glassBackgroundFailure("GLASS_BACKGROUND_CORRUPT", "The managed background image failed validation.");
    }
    const bytes = readFileSync(filePath);
    const expectedHash = assetId.slice("glass-bg-".length);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      throw glassBackgroundFailure("GLASS_BACKGROUND_CORRUPT", "The managed background image failed its content check.");
    }
    return { bytes, filePath, stats };
  }

  function storeContentAddressed(bytes) {
    ensureAssetsDir();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const assetId = `glass-bg-${hash}`;
    const targetPath = filePathFor(assetId);
    if (existsSync(targetPath)) {
      const managed = managedFileBytes(assetId);
      utimesSync(managed.filePath, managed.stats.atime, new Date(now()));
      return { assetId, filePath: targetPath, reused: true };
    }
    const temporaryPath = path.join(root, `.glass-bg-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    try {
      writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
      try {
        renameSync(temporaryPath, targetPath);
      } catch (error) {
        if (!existsSync(targetPath)) throw error;
        const managed = managedFileBytes(assetId);
        utimesSync(managed.filePath, managed.stats.atime, new Date(now()));
      }
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    return { assetId, filePath: targetPath, reused: false };
  }

  async function metadataFor(bytes, name = "") {
    const metadata = await sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: GLASS_BACKGROUND_MAX_INPUT_PIXELS,
      pages: 1
    }).metadata();
    if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
      throw glassBackgroundFailure("GLASS_BACKGROUND_CORRUPT", "The managed background image is not a valid WebP image.");
    }
    return {
      schemaVersion: 1,
      assetId: `glass-bg-${createHash("sha256").update(bytes).digest("hex")}`,
      ...(name ? { name: safeGlassBackgroundName(name) } : {}),
      mimeType: "image/webp",
      width: metadata.width,
      height: metadata.height,
      bytes: bytes.length
    };
  }

  async function pick(owner = null) {
    try {
      const options = {
        title: "Choose workspace background",
        buttonLabel: "Use background",
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff", "gif"] }]
      };
      const selected = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      if (selected.canceled || !selected.filePaths?.length) return { ok: true, canceled: true };
      const sourcePath = selected.filePaths[0];
      const sourceBytes = readBoundedSource(sourcePath);
      const input = sharp(sourceBytes, {
        animated: false,
        failOn: "error",
        limitInputPixels: GLASS_BACKGROUND_MAX_INPUT_PIXELS,
        pages: 1
      });
      const sourceMetadata = await input.metadata();
      if (!supportedInputFormats.has(String(sourceMetadata.format || "")) || !sourceMetadata.width || !sourceMetadata.height) {
        throw glassBackgroundFailure("GLASS_BACKGROUND_FORMAT_UNSUPPORTED", "Select a PNG, JPEG, WebP, AVIF, TIFF, or GIF image.");
      }
      const encoded = await input
        .rotate()
        .resize({
          width: GLASS_BACKGROUND_MAX_EDGE,
          height: GLASS_BACKGROUND_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true
        })
        .webp({ quality: 86, alphaQuality: 90, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      if (!encoded.data.length || encoded.data.length > GLASS_BACKGROUND_MAX_OUTPUT_BYTES) {
        throw glassBackgroundFailure("GLASS_BACKGROUND_OUTPUT_TOO_LARGE", "The optimized background exceeds the managed asset limit.");
      }
      const stored = storeContentAddressed(encoded.data);
      const asset = {
        schemaVersion: 1,
        assetId: stored.assetId,
        name: safeGlassBackgroundName(sourcePath),
        mimeType: "image/webp",
        width: encoded.info.width,
        height: encoded.info.height,
        bytes: encoded.data.length
      };
      log(`glass background picked id=${asset.assetId} ${asset.width}x${asset.height} bytes=${asset.bytes} reused=${stored.reused}`);
      return { ok: true, asset, dataUrl: `data:image/webp;base64,${encoded.data.toString("base64")}` };
    } catch (error) {
      const failure = publicGlassBackgroundFailure(
        error,
        "GLASS_BACKGROUND_IMPORT_FAILED",
        "The selected background could not be decoded or imported."
      );
      log(`glass background pick failed code=${failure.errorCode}`);
      return { ok: false, ...failure };
    }
  }

  async function load(payload = {}) {
    try {
      const assetId = normalizeGlassBackgroundAssetId(payload.assetId);
      if (!assetId) throw glassBackgroundFailure("GLASS_BACKGROUND_ID_INVALID", "The managed background asset id is invalid.");
      const managed = managedFileBytes(assetId);
      const asset = await metadataFor(managed.bytes, payload.name);
      utimesSync(managed.filePath, managed.stats.atime, new Date(now()));
      return { ok: true, asset, dataUrl: `data:image/webp;base64,${managed.bytes.toString("base64")}` };
    } catch (error) {
      const failure = publicGlassBackgroundFailure(
        error,
        "GLASS_BACKGROUND_LOAD_FAILED",
        "The managed background image could not be loaded."
      );
      log(`glass background load failed code=${failure.errorCode}`);
      return { ok: false, ...failure };
    }
  }

  function cleanup({ referencedAssetIds = [] } = {}) {
    ensureAssetsDir();
    const referenced = new Set(referencedAssetIds.map(normalizeGlassBackgroundAssetId).filter(Boolean));
    const cutoff = now() - resolvedRetentionMs;
    let removed = 0;
    let retained = 0;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const match = GLASS_BACKGROUND_FILE_PATTERN.exec(entry.name);
      if (!match || removed >= GLASS_BACKGROUND_MAX_GC_FILES) continue;
      const assetId = `glass-bg-${match[1]}`;
      if (referenced.has(assetId) || !entry.isFile() || entry.isSymbolicLink?.()) {
        retained += 1;
        continue;
      }
      const filePath = filePathFor(assetId);
      try {
        const stats = lstatSync(filePath);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.mtimeMs > cutoff) {
          retained += 1;
          continue;
        }
        managedFileBytes(assetId);
        rmSync(filePath, { force: true });
        removed += 1;
      } catch (error) {
        retained += 1;
        log(`glass background gc retained id=${assetId} code=${String(error?.code || "VALIDATION_FAILED")}`);
      }
    }
    return { ok: true, removed, retained };
  }

  function clear(payload = {}, referencedAssetIds = []) {
    try {
      const assetId = normalizeGlassBackgroundAssetId(payload.assetId);
      if (!assetId) return { ok: true, cleared: true, retained: true };
      const managed = managedFileBytes(assetId);
      const touchedAt = now();
      utimesSync(managed.filePath, managed.stats.atime, new Date(touchedAt));
      const gc = cleanup({ referencedAssetIds });
      return {
        ok: true,
        cleared: true,
        assetId,
        retained: true,
        retainedUntil: touchedAt + resolvedRetentionMs,
        garbageCollected: gc.removed
      };
    } catch (error) {
      if (error?.code === "GLASS_BACKGROUND_NOT_FOUND") return { ok: true, cleared: true, retained: false };
      const failure = publicGlassBackgroundFailure(
        error,
        "GLASS_BACKGROUND_CLEAR_FAILED",
        "The managed background image could not be released."
      );
      log(`glass background clear failed code=${failure.errorCode}`);
      return { ok: false, ...failure };
    }
  }

  return { cleanup, clear, load, pick };
}

module.exports = {
  GLASS_BACKGROUND_ASSET_ID_PATTERN,
  GLASS_BACKGROUND_MAX_EDGE,
  GLASS_BACKGROUND_MAX_GC_FILES,
  GLASS_BACKGROUND_MAX_INPUT_PIXELS,
  GLASS_BACKGROUND_MAX_OUTPUT_BYTES,
  GLASS_BACKGROUND_MAX_SOURCE_BYTES,
  GLASS_BACKGROUND_RETENTION_MS,
  createGlassBackgroundService,
  defaultGlassBackgroundSettings,
  normalizeGlassBackgroundAssetId,
  normalizeGlassBackgroundAssetName,
  normalizeGlassBackgroundSettings,
  safeGlassBackgroundName
};
