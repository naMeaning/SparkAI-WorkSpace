"use strict";

const assert = require("node:assert/strict");
const { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createThumbnailCache, ThumbnailCacheError } = require("../thumbnail-cache.cjs");

sharp.cache(false);

async function writeFixture(filePath, format, background) {
  let image = sharp({ create: { width: 3840, height: 2160, channels: format === "jpeg" ? 3 : 4, background } });
  if (format === "png") image = image.png({ compressionLevel: 3 });
  if (format === "jpeg") image = image.jpeg({ quality: 90, chromaSubsampling: "4:4:4" });
  if (format === "webp") image = image.webp({ lossless: true });
  writeFileSync(filePath, await image.toBuffer());
}

async function inspectThumbnail(result, expectedAlpha) {
  assert.equal(existsSync(result.path), true);
  const metadata = await sharp(result.path).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(Math.max(metadata.width || 0, metadata.height || 0), 512);
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 288);
  if (expectedAlpha) {
    assert.equal(metadata.hasAlpha, true);
    const raw = await sharp(result.path).ensureAlpha().raw().toBuffer();
    let minAlpha = 255;
    let maxAlpha = 0;
    for (let index = 3; index < raw.length; index += 4) {
      minAlpha = Math.min(minAlpha, raw[index]);
      maxAlpha = Math.max(maxAlpha, raw[index]);
    }
    assert(minAlpha > 0 && minAlpha < 255, `Expected translucent alpha, received min=${minAlpha}`);
    assert(maxAlpha < 255, `Expected alpha channel to remain translucent, received max=${maxAlpha}`);
  }
  assert.equal(result.bytes, statSync(result.path).size);
  return metadata;
}

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert(error instanceof ThumbnailCacheError, `Expected ThumbnailCacheError, received ${error}`);
    assert.equal(error.code, code);
    assert.match(error.message, /[\u4e00-\u9fff]/u);
  }
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "naimage-thumbnail-cache-"));
  const sourceRoot = path.join(root, "source");
  const cacheRoot = path.join(root, "cache");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });
  const logs = [];
  const cache = createThumbnailCache({
    workerPath: path.join(__dirname, "..", "image-thumbnail-worker.cjs"),
    log: (message) => logs.push(String(message)),
  });
  try {
    const pngPath = path.join(sourceRoot, "透明商品.png");
    const jpegPath = path.join(sourceRoot, "商品主图.jpg");
    const webpPath = path.join(sourceRoot, "透明商品.webp");
    await writeFixture(pngPath, "png", { r: 36, g: 120, b: 220, alpha: 0.42 });
    await writeFixture(jpegPath, "jpeg", { r: 210, g: 126, b: 52 });
    await writeFixture(webpPath, "webp", { r: 116, g: 66, b: 210, alpha: 0.33 });

    const png = await cache.ensure({ sourcePath: pngPath, cacheRoot, maxEdge: 512 });
    const jpeg = await cache.ensure({ sourcePath: jpegPath, cacheRoot, maxEdge: 512 });
    const webp = await cache.ensure({ sourcePath: webpPath, cacheRoot, maxEdge: 512 });
    assert.equal(png.cacheHit, false);
    assert.equal(jpeg.cacheHit, false);
    assert.equal(webp.cacheHit, false);
    await inspectThumbnail(png, true);
    await inspectThumbnail(jpeg, false);
    await inspectThumbnail(webp, true);
    const sequentialStats = cache.stats();
    assert.equal(sequentialStats.workerStarts, 1, "Sequential cold thumbnails must reuse one persistent worker");
    assert.equal(sequentialStats.workerJobs, 3);
    assert.equal(sequentialStats.workerReuses, 2);

    const pngHit = await cache.ensure({ sourcePath: pngPath, cacheRoot, maxEdge: 512 });
    assert.equal(pngHit.cacheHit, true);
    assert.equal(pngHit.path, png.path);
    const pngBucketHit = await cache.ensure({ sourcePath: pngPath, cacheRoot, maxEdge: 400 });
    assert.equal(pngBucketHit.cacheHit, true, "Nearby thumbnail sizes must share the 512px cache bucket");
    assert.equal(pngBucketHit.path, png.path);

    const concurrencyPath = path.join(sourceRoot, "并发透明图.png");
    await writeFixture(concurrencyPath, "png", { r: 20, g: 190, b: 136, alpha: 0.58 });
    const workerStartsBefore = cache.stats().workerStarts;
    const workerJobsBefore = cache.stats().workerJobs;
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => cache.ensure({ sourcePath: concurrencyPath, cacheRoot, maxEdge: 512 })));
    const workerStartsAfter = cache.stats().workerStarts;
    const workerJobsAfter = cache.stats().workerJobs;
    assert.equal(new Set(concurrent.map((entry) => entry.path)).size, 1);
    assert.equal(workerStartsAfter - workerStartsBefore, 0, "A warm persistent worker must handle the joined request without another fork");
    assert.equal(workerJobsAfter - workerJobsBefore, 1, "Concurrent requests for the same variant must dispatch one worker job");
    assert(logs.filter((entry) => entry.includes("thumbnail cache join")).length >= 9);
    await inspectThumbnail(concurrent[0], true);

    const copyPath = path.join(sourceRoot, "内容相同副本.png");
    copyFileSync(pngPath, copyPath);
    utimesSync(copyPath, new Date(Date.now() + 20_000), new Date(Date.now() + 20_000));
    const copyHit = await cache.ensure({ sourcePath: copyPath, cacheRoot, maxEdge: 512 });
    assert.equal(copyHit.cacheHit, true, "Identical image bytes at another path must reuse the thumbnail");
    assert.equal(copyHit.path, png.path);

    const distinctPaths = [];
    for (let index = 0; index < 6; index += 1) {
      const filePath = path.join(sourceRoot, `多源并发-${index + 1}.png`);
      await writeFixture(filePath, "png", { r: 20 + index * 30, g: 40, b: 80 + index * 20, alpha: 0.5 });
      distinctPaths.push(filePath);
    }
    const distinctResults = await Promise.all(distinctPaths.map((sourcePath) => cache.ensure({ sourcePath, cacheRoot, maxEdge: 512 })));
    assert.equal(new Set(distinctResults.map((entry) => entry.path)).size, distinctPaths.length);
    const activeCounts = logs
      .filter((entry) => entry.includes("thumbnail worker start"))
      .map((entry) => Number(entry.match(/active=(\d+)/)?.[1] || 0));
    const maxActiveWorkers = Math.max(0, ...activeCounts);
    assert(maxActiveWorkers <= 2, `Expected at most 2 active workers, received ${maxActiveWorkers}`);
    assert(maxActiveWorkers >= 2, "Distinct source pressure should exercise both worker slots");
    assert.equal(cache.stats().workerStarts, 2, "The persistent pool must never fork more than its two worker slots under normal load");

    const originalPath = png.path;
    const changedTime = new Date(Date.now() + 5_000);
    utimesSync(pngPath, changedTime, changedTime);
    const sameContentHit = await cache.ensure({ sourcePath: pngPath, cacheRoot, maxEdge: 512 });
    assert.equal(sameContentHit.cacheHit, true, "mtime-only changes must keep the content-addressed thumbnail");
    assert.equal(sameContentHit.path, originalPath);

    const corruptPath = path.join(sourceRoot, "损坏图片.png");
    writeFileSync(corruptPath, Buffer.from("not-an-image"));
    await expectCode(cache.ensure({ sourcePath: corruptPath, cacheRoot, maxEdge: 512 }), "THUMBNAIL_DECODE_FAILED");
    assert.equal(readdirSync(cacheRoot).some((entry) => entry.endsWith(".tmp")), false, "Failed generation must not leave staging files");

    const crashCacheRoot = path.join(root, "crash-cache");
    const crashMarkerPath = path.join(root, "worker-crashed.marker");
    const crashWorkerPath = path.join(root, "thumbnail-worker-crash-once.cjs");
    mkdirSync(crashCacheRoot, { recursive: true });
    writeFileSync(crashWorkerPath, [
      '"use strict";',
      'const { existsSync, writeFileSync } = require("node:fs");',
      `const markerPath = ${JSON.stringify(crashMarkerPath)};`,
      'if (!existsSync(markerPath)) {',
      '  process.once("message", () => { writeFileSync(markerPath, "crashed"); process.exit(23); });',
      '} else {',
      `  require(${JSON.stringify(path.join(__dirname, "..", "image-thumbnail-worker.cjs"))});`,
      '}',
      '',
    ].join("\n"));
    const crashCache = createThumbnailCache({ workerPath: crashWorkerPath, maxConcurrent: 1 });
    const crashSource = path.join(sourceRoot, "进程崩溃.png");
    const recoverySource = path.join(sourceRoot, "崩溃恢复.png");
    copyFileSync(concurrencyPath, crashSource);
    copyFileSync(concurrencyPath, recoverySource);
    await expectCode(crashCache.ensure({ sourcePath: crashSource, cacheRoot: crashCacheRoot, maxEdge: 512 }), "THUMBNAIL_WORKER_EXITED");
    const recovered = await crashCache.ensure({ sourcePath: recoverySource, cacheRoot: crashCacheRoot, maxEdge: 512 });
    await inspectThumbnail(recovered, true);
    const crashStats = crashCache.stats();
    assert.equal(crashStats.workerStarts, 2, "A failed worker must be replaced for the next queued request");
    assert.equal(crashStats.workerFailures, 1);
    assert.equal(crashStats.generated, 1);
    await crashCache.close();

    const closeCacheRoot = path.join(root, "close-cache");
    mkdirSync(closeCacheRoot, { recursive: true });
    const closeCache = createThumbnailCache({
      workerPath: path.join(__dirname, "..", "image-thumbnail-worker.cjs"),
      maxConcurrent: 1,
    });
    const closeSources = Array.from({ length: 3 }, (_, index) => {
      const filePath = path.join(sourceRoot, `关闭队列-${index + 1}.png`);
      copyFileSync(concurrencyPath, filePath);
      return filePath;
    });
    const closePromises = closeSources.map((sourcePath) => closeCache.ensure({ sourcePath, cacheRoot: closeCacheRoot, maxEdge: 512 }));
    const closeSettledPromise = Promise.allSettled(closePromises);
    await closeCache.close();
    const closeSettled = await closeSettledPromise;
    assert(closeSettled.every((entry) => entry.status === "rejected" && entry.reason?.code === "THUMBNAIL_CACHE_CLOSED"));
    assert.equal(readdirSync(closeCacheRoot).some((entry) => entry.endsWith(".tmp")), false, "Closing the cache must clean active and queued staging files");

    const outputFiles = readdirSync(cacheRoot).filter((entry) => entry.endsWith(".webp"));
    assert(outputFiles.length >= 5);
    const runtimeStats = cache.stats();
    assert.equal(runtimeStats.maxConcurrent, 2);
    assert.equal(runtimeStats.maxActiveWorkers, maxActiveWorkers);
    assert.equal(runtimeStats.inflightJoins >= 9, true);
    assert.equal(runtimeStats.cacheHits >= 1, true);
    assert.equal(runtimeStats.generated >= outputFiles.length, true);
    assert.equal(runtimeStats.errors, 1);
    assert.equal(runtimeStats.recentErrors.length, 1);
    assert.equal(runtimeStats.recentErrors[0].code, "THUMBNAIL_DECODE_FAILED");

    const pruneRoot = path.join(root, "prune-cache");
    mkdirSync(pruneRoot, { recursive: true });
    for (let index = 0; index < 24; index += 1) {
      const target = path.join(pruneRoot, `${String(index).padStart(2, "0")}.webp`);
      copyFileSync(png.path, target);
      const changedAt = new Date(Date.now() - index * 1_000);
      utimesSync(target, changedAt, changedAt);
    }
    const pruneResult = cache.prune({ cacheRoot: pruneRoot, maxFiles: 12, maxBytes: 64 * 1024 * 1024, maxAgeMs: 24 * 60 * 60 * 1000 });
    assert.equal(pruneResult.prunedFiles, 12, "Pruning must retain only the newest bounded thumbnail set");
    assert.equal(readdirSync(pruneRoot).filter((entry) => entry.endsWith(".webp")).length, 12);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      maxEdge: 512,
      formats: ["png", "jpeg", "webp"],
      alphaPreserved: true,
      cacheHit: pngHit.cacheHit,
      sourceChangeInvalidated: false,
      contentAddressedHit: copyHit.cacheHit,
      concurrentRequests: concurrent.length,
      concurrentWorkerStarts: workerStartsAfter - workerStartsBefore,
      concurrentWorkerJobs: workerJobsAfter - workerJobsBefore,
      distinctConcurrentSources: distinctPaths.length,
      maxActiveWorkers,
      persistentWorkerStarts: runtimeStats.workerStarts,
      persistentWorkerReuses: runtimeStats.workerReuses,
      crashRecovery: crashStats,
      closeCanceledActiveAndQueued: true,
      cacheFiles: outputFiles.length,
      stagingClean: true,
      cachePruned: pruneResult.prunedFiles,
      runtimeStats,
    })}\n`);
  } finally {
    await cache.close();
    rmSync(root, { recursive: true, force: true });
  }

  await expectCode(cache.ensure({ sourcePath: __filename, cacheRoot, maxEdge: 512 }), "THUMBNAIL_CACHE_CLOSED");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
