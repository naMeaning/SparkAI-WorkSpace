"use strict";

const assert = require("node:assert/strict");
const { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createImageImporter, ImageImportError } = require("../image-import.cjs");

sharp.cache(false);

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert(error instanceof ImageImportError, `Expected ImageImportError, received ${error}`);
    assert.equal(error.code, code);
    assert.match(error.message, /[\u4e00-\u9fff]/u);
  }
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for self-test condition");
}

function stagingFiles(outputDir) {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir).filter((entry) => entry.startsWith(".iiimage-import-") && entry.endsWith(".tmp"));
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "iiimage-image-import-"));
  const sourceRoot = path.join(root, "source");
  const nestedRoot = path.join(sourceRoot, "nested");
  const outputRoot = path.join(root, "output");
  const secondOutputRoot = path.join(root, "output-second");
  mkdirSync(nestedRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(secondOutputRoot, { recursive: true });
  const logs = [];
  const importer = createImageImporter({
    workerPath: path.join(__dirname, "..", "image-import-worker.cjs"),
    maxConcurrentFiles: 4,
    log: (message) => logs.push(String(message)),
  });

  let fileSymlinkStatus = "created";
  let sourceJunctionStatus = "created";
  let outputJunctionStatus = "created";
  try {
    for (let index = 0; index < 500; index += 1) {
      const suffix = Buffer.from(`iiimage-fixture-${String(index).padStart(4, "0")}`);
      writeFileSync(path.join(sourceRoot, `${String(index).padStart(4, "0")}.png`), Buffer.concat([PNG_1X1, suffix]));
    }
    copyFileSync(path.join(sourceRoot, "0042.png"), path.join(sourceRoot, "0500-duplicate-as-jpeg.jpg"));
    writeFileSync(path.join(sourceRoot, "0501-fake.webp"), Buffer.from("RIFF-not-a-real-webp"));
    writeFileSync(path.join(sourceRoot, "0502-corrupt.png"), Buffer.concat([PNG_1X1.subarray(0, 24), Buffer.from("truncated")]));
    const jpegBuffer = await sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 180, g: 72, b: 36 } } }).jpeg().toBuffer();
    const webpBuffer = await sharp({ create: { width: 2, height: 3, channels: 4, background: { r: 40, g: 90, b: 180, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer();
    writeFileSync(path.join(sourceRoot, "0503-real-jpeg-without-extension.bin"), jpegBuffer);
    writeFileSync(path.join(nestedRoot, "0000-real-webp.dat"), webpBuffer);
    writeFileSync(path.join(sourceRoot, "0504-not-image.txt"), Buffer.from("plain text"));

    try {
      symlinkSync(path.join(sourceRoot, "0001.png"), path.join(sourceRoot, "0505-symbolic.png"), "file");
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(String(error?.code || ""))) fileSymlinkStatus = `skipped-${error.code}`;
      else throw error;
    }
    const outsideSourceRoot = path.join(root, "outside-source");
    mkdirSync(outsideSourceRoot, { recursive: true });
    writeFileSync(path.join(outsideSourceRoot, "must-not-import.png"), Buffer.concat([PNG_1X1, Buffer.from("outside-sentinel")]));
    try {
      symlinkSync(outsideSourceRoot, path.join(sourceRoot, "0506-source-junction"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(String(error?.code || ""))) sourceJunctionStatus = `skipped-${error.code}`;
      else throw error;
    }

    const result = await importer.importImages({ inputPaths: [sourceRoot], outputDir: outputRoot, maxFiles: 600 });
    assert.equal(result.ok, true);
    assert.notEqual(result.workerPid, process.pid, "Import work must run in an independent child process");
    assert.equal(result.selectedCount, 506);
    assert.equal(result.validCount, 503, "500 PNG fixtures, one duplicate, JPEG and WebP should be valid");
    assert.equal(result.importedCount, 502, "Content-identical inputs must share one physical library blob");
    assert.equal(result.uniqueAssetCount, 502);
    assert.equal(result.occurrenceCount, 503, "Every valid source occurrence must remain addressable even when bytes are identical");
    assert.equal(result.assets.length, 503);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.maxConcurrentFiles, 4);
    assert.equal(result.maxActiveFiles, 4, "The 500-file fixture should exercise exactly four file slots");
    assert.equal(result.truncated, false);
    assert.equal(result.skipReasons["unsupported-image"], 2);
    assert.equal(result.skipReasons["damaged-image"], 1);
    const expectedSymlinkSkips = Number(fileSymlinkStatus === "created") + Number(sourceJunctionStatus === "created");
    if (expectedSymlinkSkips > 0) assert.equal(result.skipReasons["symbolic-link"], expectedSymlinkSkips);
    assert.equal(result.assets.some((asset) => asset.originalName === "must-not-import.png"), false, "A source junction must never escape directory traversal");
    if (sourceJunctionStatus === "created") {
      const directJunctionResult = await importer.importImages({
        inputPaths: [path.join(sourceRoot, "0506-source-junction", "must-not-import.png")],
        outputDir: path.join(root, "direct-junction-output"),
        maxFiles: 1,
      });
      assert.equal(directJunctionResult.importedCount, 0, "A file addressed through a junction must also be rejected");
      assert.equal(directJunctionResult.skipReasons["symbolic-link"], 1);
    }
    assert.equal(stagingFiles(outputRoot).length, 0, "Successful and skipped files must not leave staging artifacts");
    assert(result.assets.every((asset, index) => asset.index === index + 1));
    assert(result.assets.every((asset) => existsSync(asset.path) && /^[a-f0-9]{64}\.(png|jpg|webp)$/i.test(path.basename(asset.path))));
    assert(result.assets.every((asset) => /^occ-[a-f0-9]{32}$/.test(asset.occurrenceId) && /^root-[a-f0-9]{24}$/.test(asset.importRootId)));
    assert(result.assets.every((asset) => asset.importBatchId === result.importBatchId));
    assert(result.roots.every((root) => root.importBatchId === result.importBatchId && !("inputRoot" in root)));
    const duplicateOccurrences = result.assets.filter((asset) => asset.sha256 === result.assets.find((item) => item.originalName === "0042.png")?.sha256);
    assert.equal(duplicateOccurrences.length, 2);
    assert.equal(new Set(duplicateOccurrences.map((asset) => asset.path)).size, 1, "Duplicate bytes should share one managed blob path");
    assert.equal(new Set(duplicateOccurrences.map((asset) => asset.occurrenceId)).size, 2, "Duplicate bytes from different source paths need distinct logical occurrence IDs");
    assert.deepEqual(duplicateOccurrences.map((asset) => asset.sourceRelativePath).sort(), ["0042.png", "0500-duplicate-as-jpeg.jpg"]);
    const jpegAsset = result.assets.find((asset) => asset.originalName === "0503-real-jpeg-without-extension.bin");
    const webpAsset = result.assets.find((asset) => asset.originalName === "0000-real-webp.dat");
    assert.equal(jpegAsset?.mimeType, "image/jpeg", "Magic bytes, not the source extension, must decide JPEG type");
    assert.equal(path.extname(jpegAsset?.path || ""), ".jpg");
    assert.equal(webpAsset?.mimeType, "image/webp", "Magic bytes, not the source extension, must decide WebP type");
    assert.equal(path.extname(webpAsset?.path || ""), ".webp");

    const second = await importer.importImages({ inputPaths: [sourceRoot], outputDir: secondOutputRoot, maxFiles: 600 });
    assert.deepEqual(
      second.assets.map((asset) => [path.relative(sourceRoot, asset.sourcePath), asset.sha256]),
      result.assets.map((asset) => [path.relative(sourceRoot, asset.sourcePath), asset.sha256]),
      "Directory traversal and result ordering must remain deterministic across child processes",
    );
    const reused = await importer.importImages({ inputPaths: [sourceRoot], outputDir: outputRoot, maxFiles: 600 });
    assert.equal(reused.reusedCount, 502, "A repeated import must safely reuse every unique content-addressed output");
    assert.deepEqual(reused.assets.map((asset) => asset.path), result.assets.map((asset) => asset.path));
    assert.equal(stagingFiles(outputRoot).length, 0);

    const rapidResults = await Promise.all(Array.from({ length: 16 }, (_item, index) => importer.importImages({
      inputPaths: [path.join(sourceRoot, `${String(index).padStart(4, "0")}.png`)],
      outputDir: path.join(root, "rapid-output"),
      maxFiles: 1,
    })));
    assert.equal(rapidResults.length, 16);
    assert(rapidResults.every((entry) => entry.ok && entry.assets.length === 1), "Rapid SOURCE/REFERENCE-style imports must not lose a worker result during clean exit");
    assert.equal(stagingFiles(path.join(root, "rapid-output")).length, 0);

    const limited = await importer.importImages({ inputPaths: [sourceRoot], outputDir: path.join(root, "limited"), maxFiles: 10 });
    assert.equal(limited.selectedCount, 10);
    assert.equal(limited.importedCount, 10);
    assert.equal(limited.truncated, true);

    const byteLimitSource = path.join(root, "byte-limit-source");
    mkdirSync(byteLimitSource, { recursive: true });
    const oversizedPath = path.join(byteLimitSource, "00-oversized.png");
    writeFileSync(oversizedPath, Buffer.concat([PNG_1X1, Buffer.alloc(700, 0x61)]));
    writeFileSync(path.join(byteLimitSource, "01-small.png"), Buffer.concat([PNG_1X1, Buffer.alloc(300, 0x62)]));
    writeFileSync(path.join(byteLimitSource, "02-small.png"), Buffer.concat([PNG_1X1, Buffer.alloc(300, 0x63)]));
    const byteLimitedImporter = createImageImporter({
      workerPath: path.join(__dirname, "..", "image-import-worker.cjs"),
      maxConcurrentFiles: 2,
      maxFileBytes: 512,
      maxTotalBytes: 600,
    });
    try {
      const oversized = await byteLimitedImporter.importImages({ inputPaths: [oversizedPath], outputDir: path.join(root, "byte-limit-oversized"), maxFiles: 1 });
      assert.equal(oversized.selectedCount, 0);
      assert.equal(oversized.importedCount, 0);
      assert.equal(oversized.skipReasons["too-large"], 1, "Oversized inputs must be rejected before a staging copy is allocated");
      const totalLimited = await byteLimitedImporter.importImages({ inputPaths: [byteLimitSource], outputDir: path.join(root, "byte-limit-total"), maxFiles: 10 });
      assert.equal(totalLimited.selectedCount, 1);
      assert.equal(totalLimited.importedCount, 1);
      assert.equal(totalLimited.truncated, true);
      assert.equal(totalLimited.truncatedByBytes, true);
      assert(totalLimited.selectedBytes <= 600);
      assert(totalLimited.assets.every((asset) => asset.bytes <= 512));
      assert.equal(stagingFiles(path.join(root, "byte-limit-total")).length, 0);
    } finally {
      await byteLimitedImporter.close();
    }

    const mainSource = readFileSync(path.join(__dirname, "..", "image-import.cjs"), "utf8");
    const workerSource = readFileSync(path.join(__dirname, "..", "image-import-worker.cjs"), "utf8");
    assert.doesNotMatch(mainSource, /\breadFileSync\b/, "The UI/main-process importer must never synchronously read image bytes");
    assert.doesNotMatch(workerSource, /\breadFileSync\b/, "The worker must hash and copy image bytes as streams");
    assert.match(workerSource, /createReadStream/);
    assert.match(workerSource, /maxConcurrentFiles/);
    assert.match(workerSource, /maxFileBytes/);
    assert.match(workerSource, /maxTotalBytes/);
    assert(logs.some((entry) => /image import worker start/.test(entry)));

    const outsideOutputRoot = path.join(root, "outside-output");
    const outputJunction = path.join(root, "output-junction");
    const outsideSentinelPath = path.join(outsideOutputRoot, "sentinel.txt");
    mkdirSync(outsideOutputRoot, { recursive: true });
    writeFileSync(outsideSentinelPath, "outside-output-must-remain-unchanged");
    try {
      symlinkSync(outsideOutputRoot, outputJunction, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(String(error?.code || ""))) outputJunctionStatus = `skipped-${error.code}`;
      else throw error;
    }
    if (outputJunctionStatus === "created") {
      await expectCode(importer.importImages({ inputPaths: [path.join(sourceRoot, "0000.png")], outputDir: outputJunction, maxFiles: 1 }), "IMAGE_IMPORT_UNSAFE_OUTPUT");
      await expectCode(importer.importImages({ inputPaths: [path.join(sourceRoot, "0000.png")], outputDir: path.join(outputJunction, "nested"), maxFiles: 1 }), "IMAGE_IMPORT_UNSAFE_OUTPUT");
      assert.equal(readFileSync(outsideSentinelPath, "utf8"), "outside-output-must-remain-unchanged");
      assert.deepEqual(readdirSync(outsideOutputRoot), ["sentinel.txt"], "Rejected output junctions must not receive imported files");
    }

    const stallingWorkerPath = path.join(root, "stalling-image-import-worker.cjs");
    writeFileSync(stallingWorkerPath, `
      "use strict";
      const { mkdirSync, writeFileSync } = require("node:fs");
      const path = require("node:path");
      process.once("message", (payload) => {
        mkdirSync(payload.outputDir, { recursive: true });
        writeFileSync(path.join(payload.outputDir, ".iiimage-import-" + payload.requestId + "-stall.tmp"), "staging");
        setInterval(() => undefined, 1000);
      });
    `);

    const timeoutOutput = path.join(root, "timeout-output");
    const timeoutImporter = createImageImporter({ workerPath: stallingWorkerPath, timeoutMs: 100 });
    await expectCode(timeoutImporter.importImages({ inputPaths: [sourceRoot], outputDir: timeoutOutput, maxFiles: 1 }), "IMAGE_IMPORT_TIMEOUT");
    assert.equal(stagingFiles(timeoutOutput).length, 0, "Timed-out child work must have its staging files removed");
    await timeoutImporter.close();

    const closeOutput = path.join(root, "close-output");
    const closeLogs = [];
    const closeImporter = createImageImporter({ workerPath: stallingWorkerPath, log: (message) => closeLogs.push(String(message)) });
    const closeTasks = Array.from({ length: 3 }, (_, index) => closeImporter.importImages({
      inputPaths: [sourceRoot],
      outputDir: path.join(closeOutput, String(index)),
      maxFiles: 1,
    }));
    const closeSettledPromise = Promise.allSettled(closeTasks);
    await waitFor(() => closeLogs.some((entry) => /worker start/.test(entry)));
    await closeImporter.close();
    const closeSettled = await closeSettledPromise;
    assert(closeSettled.every((entry) => entry.status === "rejected" && entry.reason?.code === "IMAGE_IMPORT_CLOSED"));
    assert.equal(stagingFiles(path.join(closeOutput, "0")).length, 0, "Closing the importer must remove active child staging files");
    await expectCode(closeImporter.importImages({ inputPaths: [sourceRoot], outputDir: closeOutput, maxFiles: 1 }), "IMAGE_IMPORT_CLOSED");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      sourceFiles: result.selectedCount,
      importedAssets: result.importedCount,
      duplicatesRemoved: result.duplicateCount,
      invalidSkipped: result.skippedCount,
      formats: [...new Set(result.assets.map((asset) => asset.format))].sort(),
      deterministicOrder: true,
      maxConcurrentFiles: result.maxConcurrentFiles,
      maxActiveFiles: result.maxActiveFiles,
      separateWorker: result.workerPid !== process.pid,
      streamingSha256: true,
      boundedFileBytes: true,
      boundedBatchBytes: true,
      synchronousImageReadsInMain: false,
      fileSymlinkStatus,
      sourceJunctionStatus,
      outputJunctionStatus,
      timeoutCleanup: true,
      closeCleanup: true,
      stagingClean: true,
      rapidSequentialImports: rapidResults.length,
    })}\n`);
  } finally {
    await importer.close();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
