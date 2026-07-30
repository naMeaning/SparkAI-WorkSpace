"use strict";

const assert = require("node:assert/strict");
const {
  constants: fsConstants,
  copyFileSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
sharp.cache(false);
const {
  IMAGE_EXPORT_FORMATS,
  convertImageForExport,
  decodedImageExportFormat,
  imageExportFilters,
  imageExportFormatFromExtension,
  matchingImageExportExtension,
  normalizeImageExportFormat
} = require("../desktop/image-export-service.cjs");
const { registerAssetIpc } = require("../desktop/ipc/asset-ipc.cjs");

async function assertFullyDecoded(filePath, expectedFormat, expectedWidth, expectedHeight) {
  const metadata = await sharp(filePath, { failOn: "error" }).metadata();
  assert.equal(decodedImageExportFormat(metadata), expectedFormat);
  assert.equal(metadata.width, expectedWidth);
  assert.equal(metadata.height, expectedHeight);
  const decoded = await sharp(filePath, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.data.length > 0, true);
  assert.equal(decoded.info.width, expectedWidth);
  assert.equal(decoded.info.height, expectedHeight);
  return metadata;
}

async function assertAlphaPreserved(filePath, expectedFormat) {
  const metadata = await sharp(filePath, { failOn: "error" }).metadata();
  assert.equal(decodedImageExportFormat(metadata), expectedFormat);
  assert.equal(metadata.hasAlpha, true, `${expectedFormat} export must retain transparency`);
  const decoded = await sharp(filePath, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.channels, 4, `${expectedFormat} export must decode with an alpha channel`);
  const alpha = decoded.data[decoded.info.channels - 1];
  assert.equal(alpha >= 105 && alpha <= 175, true, `${expectedFormat} alpha must remain near the source value`);
}

async function testSaveAsIpc(root, sourcePath) {
  const handlers = new Map();
  const dialogPaths = [path.join(root, "native-choice.avif"), path.join(root, "requested-format.jpg")];
  const dialogOptions = [];
  let released = 0;
  registerAssetIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {
      async showSaveDialog(options) {
        dialogOptions.push(options);
        return { canceled: false, filePath: dialogPaths.shift() };
      }
    },
    shell: {},
    BrowserWindow: { fromWebContents: () => null },
    app: { getPath: () => root },
    log: () => {},
    createAssetExportContext: () => ({ project: { id: "project-export" } }),
    materializeManagedImageAsset: async (asset) => ({
      asset,
      path: sourcePath,
      extension: ".png",
      mimeType: "image/png",
      size: readFileSync(sourcePath).length
    }),
    exportFileName: () => "canvas-result.png",
    desktopRoot: root,
    comparablePath: (value) => path.resolve(value).toLowerCase(),
    releaseTransientExportSources: () => { released += 1; }
  });

  const saveAs = handlers.get("naimage:asset:save-as");
  assert.equal(typeof saveAs, "function");
  const selectedByExtension = await saveAs({ sender: {} }, { asset: { path: sourcePath }, projectId: "project-export" });
  assert.equal(selectedByExtension.ok, true);
  assert.equal(selectedByExtension.format, "avif");
  assert.equal(selectedByExtension.converted, true);
  assert.equal(path.extname(selectedByExtension.path), ".avif");
  assert.deepEqual(dialogOptions[0].filters.map((filter) => filter.extensions[0]), ["png", "jpg", "webp", "avif", "tif"]);

  const requestedFormat = await saveAs({ sender: {} }, {
    asset: { path: sourcePath },
    projectId: "project-export",
    format: "jpeg"
  });
  assert.equal(requestedFormat.ok, true);
  assert.equal(requestedFormat.format, "jpeg");
  assert.equal(path.extname(requestedFormat.path), ".jpg");
  assert.deepEqual(dialogOptions[1].filters[0], { name: "JPEG 图片", extensions: ["jpg", "jpeg"] });
  assert.equal((await sharp(requestedFormat.path).metadata()).hasAlpha, false);
  assert.equal(released, 2, "Each export must release its transient materialized source");
}

async function testConcurrentSaveAsIpc(root, sourcePath) {
  const handlers = new Map();
  const destinationPath = path.join(root, "concurrent-native-choice.png");
  let pickerCount = 0;
  let resolveBothPickers;
  const bothPickersReady = new Promise((resolve) => { resolveBothPickers = resolve; });
  let overwriteConfirmations = 0;
  let released = 0;
  registerAssetIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {
      async showSaveDialog() {
        pickerCount += 1;
        if (pickerCount === 2) resolveBothPickers();
        await bothPickersReady;
        return { canceled: false, filePath: destinationPath };
      },
      async showMessageBox() {
        overwriteConfirmations += 1;
        return { response: 1 };
      }
    },
    shell: {},
    BrowserWindow: { fromWebContents: () => null },
    app: { getPath: () => root },
    log: () => {},
    createAssetExportContext: () => ({ project: { id: "project-concurrent-export" } }),
    materializeManagedImageAsset: async (asset) => ({
      asset,
      path: sourcePath,
      extension: ".png",
      mimeType: "image/png",
      size: readFileSync(sourcePath).length
    }),
    exportFileName: () => "concurrent-canvas-result.png",
    desktopRoot: root,
    comparablePath: (value) => path.resolve(value).toLowerCase(),
    releaseTransientExportSources: () => { released += 1; }
  });

  const saveAs = handlers.get("naimage:asset:save-as");
  const results = await Promise.all([
    saveAs({ sender: {} }, { asset: { path: sourcePath }, projectId: "project-concurrent-export" }),
    saveAs({ sender: {} }, { asset: { path: sourcePath }, projectId: "project-concurrent-export" })
  ]);
  assert.equal(results.filter((result) => result.ok && !result.canceled).length, 1);
  assert.equal(results.filter((result) => result.ok && result.canceled).length, 1);
  assert.equal(overwriteConfirmations, 1, "The queued export must re-confirm a target created after its picker closed");
  assert.equal(released, 2);
  assert.deepEqual(readFileSync(destinationPath), readFileSync(sourcePath));
}

async function testPickerReturnRaceAndCleanupIsolation(root, sourcePath) {
  const handlers = new Map();
  const destinationPath = path.join(root, "picker-return-race.png");
  const logs = [];
  let racedDestinationBytes = null;
  let overwriteConfirmations = 0;
  registerAssetIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {
      async showSaveDialog() {
        await sharp({ create: { width: 13, height: 9, channels: 4, background: { r: 220, g: 40, b: 60, alpha: 1 } } })
          .png()
          .toFile(destinationPath);
        racedDestinationBytes = readFileSync(destinationPath);
        return { canceled: false, filePath: destinationPath };
      },
      async showMessageBox() {
        overwriteConfirmations += 1;
        return { response: 1 };
      }
    },
    shell: {},
    BrowserWindow: { fromWebContents: () => null },
    app: { getPath: () => root },
    log: (message) => logs.push(String(message)),
    createAssetExportContext: () => ({ project: { id: "project-picker-race" } }),
    materializeManagedImageAsset: async (asset) => ({
      asset,
      path: sourcePath,
      extension: ".png",
      mimeType: "image/png",
      size: readFileSync(sourcePath).length,
      transient: true
    }),
    exportFileName: () => "picker-race.png",
    desktopRoot: root,
    comparablePath: (value) => path.resolve(value).toLowerCase(),
    releaseTransientExportSources: () => {
      throw new Error("simulated deleted-project cleanup failure");
    }
  });

  const saveAs = handlers.get("naimage:asset:save-as");
  const result = await saveAs({ sender: {} }, { asset: { path: sourcePath }, projectId: "project-picker-race" });
  assert.deepEqual({ ok: result.ok, canceled: result.canceled }, { ok: true, canceled: true });
  assert.equal(overwriteConfirmations, 1, "A target created before the picker Promise returns still requires final confirmation");
  assert.deepEqual(readFileSync(destinationPath), racedDestinationBytes, "Canceling final confirmation must preserve the raced target");
  assert.equal(logs.some((entry) => /simulated deleted-project cleanup failure/.test(entry)), true,
    "Transient cleanup failure must be logged without replacing the canceled or successful IPC result");
}

async function testCommittedCleanupWarning(root, sourcePath) {
  const destinationPath = path.join(root, "cleanup-warning.webp");
  const exported = await convertImageForExport(sourcePath, destinationPath, "webp", {
    cleanupStaging: async () => {
      const error = new Error("simulated staging cleanup lock");
      error.code = "EPERM";
      throw error;
    }
  });
  assert.match(exported.cleanupWarning || "", /simulated staging cleanup lock/);
  await assertFullyDecoded(destinationPath, "webp", 37, 23);
}

async function testNoHardlinkFallback(root, sourcePath) {
  const destinationPath = path.join(root, "no-hardlink-fallback.png");
  let observedCopyMode = 0;
  const exported = await convertImageForExport(sourcePath, destinationPath, "png", {
    publishOperations: {
      link: async () => {
        const error = new Error("simulated filesystem without hardlinks");
        error.code = "ENOTSUP";
        throw error;
      },
      copyFile: async (source, destination, mode) => {
        observedCopyMode = mode;
        copyFileSync(source, destination, mode);
      }
    }
  });
  assert.equal(exported.converted, false);
  assert.equal(observedCopyMode, fsConstants.COPYFILE_EXCL, "Fallback copy must retain no-clobber semantics");
  assert.deepEqual(readFileSync(destinationPath), readFileSync(sourcePath));
}

async function testAdditionalSourceFormats(root) {
  const sources = [
    { format: "jpeg", path: path.join(root, "input-source.jpg"), width: 29, height: 17 },
    { format: "webp", path: path.join(root, "input-source.webp"), width: 31, height: 19 }
  ];
  await sharp({ create: { width: 29, height: 17, channels: 3, background: { r: 18, g: 92, b: 176 } } })
    .jpeg({ quality: 95 })
    .toFile(sources[0].path);
  await sharp({ create: { width: 31, height: 19, channels: 4, background: { r: 210, g: 70, b: 35, alpha: 0.72 } } })
    .webp({ quality: 95, alphaQuality: 100 })
    .toFile(sources[1].path);

  for (const source of sources) {
    const sourceBefore = readFileSync(source.path);
    for (const format of Object.keys(IMAGE_EXPORT_FORMATS)) {
      const destination = path.join(root, `${source.format}-to-${format}${IMAGE_EXPORT_FORMATS[format].extension}`);
      const result = await convertImageForExport(source.path, destination, format);
      assert.equal(result.format, format);
      assert.equal(result.converted, format !== source.format);
      await assertFullyDecoded(destination, format, source.width, source.height);
    }
    assert.deepEqual(readFileSync(source.path), sourceBefore, `${source.format} input must remain unchanged`);
  }
  return sources.map((source) => source.format);
}

async function testFormatAndWriteSafety(root, sourcePath) {
  const mislabeledSource = path.join(root, "png-bytes-with-jpeg-extension.jpg");
  copyFileSync(sourcePath, mislabeledSource);
  const mislabeledBefore = readFileSync(mislabeledSource);
  const correctedDestination = path.join(root, "mislabeled-to-real-jpeg.jpg");
  const corrected = await convertImageForExport(mislabeledSource, correctedDestination, "jpeg");
  assert.equal(corrected.converted, true, "Real decoded format, not the source extension, must decide conversion");
  await assertFullyDecoded(correctedDestination, "jpeg", 37, 23);
  assert.deepEqual(readFileSync(mislabeledSource), mislabeledBefore);

  const hardlinkSource = path.join(root, "hardlink-source.png");
  const hardlinkDestination = path.join(root, "hardlink-destination.jpg");
  copyFileSync(sourcePath, hardlinkSource);
  linkSync(hardlinkSource, hardlinkDestination);
  const hardlinkBefore = readFileSync(hardlinkSource);
  await assert.rejects(
    convertImageForExport(hardlinkSource, hardlinkDestination, "jpeg"),
    /destination refers to the managed source image/i
  );
  assert.deepEqual(readFileSync(hardlinkSource), hardlinkBefore, "A hardlink destination must not rewrite the managed source");
  await assertFullyDecoded(hardlinkSource, "png", 37, 23);

  const damagedSource = path.join(root, "damaged-source.png");
  writeFileSync(damagedSource, readFileSync(sourcePath).subarray(0, 64));
  const damagedMetadata = await sharp(damagedSource, { failOn: "error" }).metadata();
  assert.deepEqual(
    { width: damagedMetadata.width, height: damagedMetadata.height, format: damagedMetadata.format },
    { width: 37, height: 23, format: "png" },
    "The damaged fixture must pass metadata inspection so the full-decode guard is exercised"
  );
  const preservedDestination = path.join(root, "existing-valid-destination.png");
  await sharp({ create: { width: 11, height: 7, channels: 4, background: { r: 7, g: 8, b: 9, alpha: 1 } } })
    .png()
    .toFile(preservedDestination);
  const preservedBefore = readFileSync(preservedDestination);
  await assert.rejects(convertImageForExport(damagedSource, preservedDestination, "png"));
  assert.deepEqual(
    readFileSync(preservedDestination),
    preservedBefore,
    "A failed full decode must leave an existing destination untouched"
  );
  await assert.rejects(
    convertImageForExport(sourcePath, preservedDestination, "png"),
    (error) => error?.code === "NAIMAGE_EXPORT_TARGET_EXISTS",
    "An existing destination must not be overwritten without confirmed overwrite authority"
  );
  assert.deepEqual(
    readFileSync(preservedDestination),
    preservedBefore,
    "A no-clobber export must preserve the existing destination"
  );
  const replacement = await convertImageForExport(sourcePath, preservedDestination, "png", { overwrite: true });
  assert.equal(replacement.converted, false);
  assert.deepEqual(
    readFileSync(preservedDestination),
    readFileSync(sourcePath),
    "A validated same-format export must atomically replace an existing destination"
  );
  assert.equal(
    readdirSync(root).some((name) => name.startsWith(".naimage-export-")),
    false,
    "Export staging directories must be removed"
  );
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-image-export-"));
  try {
    const sourcePath = path.join(root, "source.png");
    await sharp({
      create: {
        width: 37,
        height: 23,
        channels: 4,
        background: { r: 42, g: 120, b: 210, alpha: 0.55 }
      }
    }).png().toFile(sourcePath);
    const sourceBefore = readFileSync(sourcePath);

    assert.equal(normalizeImageExportFormat("jpg"), "jpeg");
    assert.equal(normalizeImageExportFormat("tif"), "tiff");
    assert.equal(imageExportFormatFromExtension("image.JPEG"), "jpeg");
    assert.equal(imageExportFormatFromExtension("image.avif"), "avif");
    assert.equal(imageExportFormatFromExtension(".WEBP"), "webp", "Managed extension fields must preserve the source format");
    assert.equal(matchingImageExportExtension(path.join(root, "sample.txt"), "webp"), path.join(root, "sample.webp"));
    assert.deepEqual(imageExportFilters("webp")[0], { name: "WebP 图片", extensions: ["webp"] });
    assert.equal(decodedImageExportFormat({ format: "heif", compression: "av1" }), "avif");
    assert.equal(decodedImageExportFormat({ format: "heif", compression: "hevc" }), "");

    const metadataFormats = {};
    for (const format of Object.keys(IMAGE_EXPORT_FORMATS)) {
      const destination = path.join(root, `export${IMAGE_EXPORT_FORMATS[format].extension}`);
      const result = await convertImageForExport(sourcePath, destination, format);
      const metadata = await sharp(destination).metadata();
      assert.equal(result.format, format);
      assert.equal(result.width, 37);
      assert.equal(result.height, 23);
      assert.equal(result.converted, format !== "png");
      assert.equal(result.bytes > 0, true);
      assert.equal(metadata.width, 37);
      assert.equal(metadata.height, 23);
      if (format === "jpeg") {
        assert.equal(metadata.hasAlpha, false, "JPEG export must flatten transparency");
        const decoded = await sharp(destination).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const expected = [138, 181, 230];
        for (let channel = 0; channel < 3; channel += 1) {
          assert.equal(
            Math.abs(decoded.data[channel] - expected[channel]) <= 8,
            true,
            `JPEG channel ${channel} must be alpha-composited over white`
          );
        }
      } else {
        await assertAlphaPreserved(destination, format);
      }
      if (format === "tiff") {
        const signature = readFileSync(destination).subarray(0, 4);
        assert.equal(
          signature.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || signature.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])),
          true,
          "TIFF export must have a valid TIFF signature"
        );
      }
      metadataFormats[format] = metadata.format;
    }

    assert.equal(metadataFormats.png, "png");
    assert.equal(metadataFormats.jpeg, "jpeg");
    assert.equal(metadataFormats.webp, "webp");
    assert.equal(["avif", "heif"].includes(metadataFormats.avif), true);
    assert.equal(metadataFormats.tiff, "tiff");
    assert.deepEqual(readFileSync(sourcePath), sourceBefore, "Local export must not mutate the managed source image");
    const additionalSourceFormats = await testAdditionalSourceFormats(root);
    await testFormatAndWriteSafety(root, sourcePath);
    await testCommittedCleanupWarning(root, sourcePath);
    await testNoHardlinkFallback(root, sourcePath);
    await testSaveAsIpc(root, sourcePath);
    await testConcurrentSaveAsIpc(root, sourcePath);
    await testPickerReturnRaceAndCleanupIsolation(root, sourcePath);
    assert.deepEqual(readFileSync(sourcePath), sourceBefore, "IPC export must not mutate the managed source image");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      formats: Object.keys(IMAGE_EXPORT_FORMATS),
      metadataFormats,
      inputFormats: ["png", ...additionalSourceFormats],
      jpegFlattened: true,
      decodedFormatVerified: true,
      heifCodecVerified: true,
      alphaPreserved: true,
      atomicReplacementVerified: true,
      noClobberVerified: true,
      cleanupWarningVerified: true,
      noHardlinkFallbackVerified: true,
      hardlinkSourcePreserved: true,
      ipcPickerFormats: true,
      concurrentTargetReconfirmed: true,
      pickerReturnRaceReconfirmed: true,
      cleanupFinalizerIsolated: true,
      sourcePreserved: true
    })}\n`);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 80));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
