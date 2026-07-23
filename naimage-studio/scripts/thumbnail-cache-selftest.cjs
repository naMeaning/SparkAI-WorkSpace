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

    const pngHit = await cache.ensure({ sourcePath: pngPath, cacheRoot, maxEdge: 512 });
    assert.equal(pngHit.cacheHit, true);
    assert.equal(pngHit.path, png.path);

    const concurrencyPath = path.join(sourceRoot, "并发透明图.png");
    await writeFixture(concurrencyPath, "png", { r: 20, g: 190, b: 136, alpha: 0.58 });
    const workerStartsBefore = logs.filter((entry) => entry.includes("thumbnail worker start")).length;
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => cache.ensure({ sourcePath: concurrencyPath, cacheRoot, maxEdge: 512 })));
    const workerStartsAfter = logs.filter((entry) => entry.includes("thumbnail worker start")).length;
    assert.equal(new Set(concurrent.map((entry) => entry.path)).size, 1);
    assert.equal(workerStartsAfter - workerStartsBefore, 1, "Concurrent requests must share one worker");
    assert(logs.filter((entry) => entry.includes("thumbnail cache join")).length >= 9);
    await inspectThumbnail(concurrent[0], true);

    const distinctPaths = Array.from({ length: 6 }, (_, index) => {
      const filePath = path.join(sourceRoot, `多源并发-${index + 1}.png`);
      copyFileSync(concurrencyPath, filePath);
      const changedTime = new Date(Date.now() + 10_000 + index * 1_000);
      utimesSync(filePath, changedTime, changedTime);
      return filePath;
    });
    const distinctResults = await Promise.all(distinctPaths.map((sourcePath) => cache.ensure({ sourcePath, cacheRoot, maxEdge: 512 })));
    assert.equal(new Set(distinctResults.map((entry) => entry.path)).size, distinctPaths.length);
    const activeCounts = logs
      .filter((entry) => entry.includes("thumbnail worker start"))
      .map((entry) => Number(entry.match(/active=(\d+)/)?.[1] || 0));
    const maxActiveWorkers = Math.max(0, ...activeCounts);
    assert(maxActiveWorkers <= 2, `Expected at most 2 active workers, received ${maxActiveWorkers}`);
    assert(maxActiveWorkers >= 2, "Distinct source pressure should exercise both worker slots");

    const originalPath = png.path;
    const changedTime = new Date(Date.now() + 5_000);
    utimesSync(pngPath, changedTime, changedTime);
    const invalidated = await cache.ensure({ sourcePath: pngPath, cacheRoot, maxEdge: 512 });
    assert.equal(invalidated.cacheHit, false);
    assert.notEqual(invalidated.path, originalPath, "mtime changes must invalidate the cache key");
    await inspectThumbnail(invalidated, true);

    const corruptPath = path.join(sourceRoot, "损坏图片.png");
    writeFileSync(corruptPath, Buffer.from("not-an-image"));
    await expectCode(cache.ensure({ sourcePath: corruptPath, cacheRoot, maxEdge: 512 }), "THUMBNAIL_DECODE_FAILED");
    assert.equal(readdirSync(cacheRoot).some((entry) => entry.endsWith(".tmp")), false, "Failed generation must not leave staging files");

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
    process.stdout.write(`${JSON.stringify({
      ok: true,
      maxEdge: 512,
      formats: ["png", "jpeg", "webp"],
      alphaPreserved: true,
      cacheHit: pngHit.cacheHit,
      sourceChangeInvalidated: invalidated.path !== originalPath,
      concurrentRequests: concurrent.length,
      concurrentWorkerStarts: workerStartsAfter - workerStartsBefore,
      distinctConcurrentSources: distinctPaths.length,
      maxActiveWorkers,
      closeCanceledActiveAndQueued: true,
      cacheFiles: outputFiles.length,
      stagingClean: true,
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
