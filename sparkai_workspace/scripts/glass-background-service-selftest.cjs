"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const {
  GLASS_BACKGROUND_ASSET_ID_PATTERN,
  GLASS_BACKGROUND_MAX_EDGE,
  createGlassBackgroundService,
  defaultGlassBackgroundSettings,
  normalizeGlassBackgroundSettings
} = require("../desktop/glass-background-service.cjs");

sharp.cache(false);

const testRoot = path.join(os.tmpdir(), `naimage-glass-background-${process.pid}-${Date.now()}`);
const sourcePath = path.join(testRoot, "Store Hero.png");
const avifSourcePath = path.join(testRoot, "Store Hero.avif");
const assetsDir = path.join(testRoot, "managed");
mkdirSync(testRoot, { recursive: true });

let selectedPath = sourcePath;
let canceled = false;
let nowMs = Date.parse("2026-07-31T00:00:00.000Z");

async function main() {
try {
  assert.deepEqual(defaultGlassBackgroundSettings, {
    glassBackgroundEnabled: false,
    glassBackgroundAssetId: "",
    glassBackgroundAssetName: "",
    glassBackgroundAssetMetadata: null,
    glassBackgroundOverlay: 38,
    glassBackgroundBlur: 6
  });
  assert.deepEqual(normalizeGlassBackgroundSettings({
    glassBackgroundEnabled: true,
    glassBackgroundAssetId: "invalid",
    glassBackgroundAssetName: "C:/private/source.png",
    glassBackgroundAssetMetadata: { mimeType: "image/png", width: 9000, height: 10, bytes: 10 },
    glassBackgroundOverlay: -10,
    glassBackgroundBlur: 99
  }), {
    glassBackgroundEnabled: false,
    glassBackgroundAssetId: "",
    glassBackgroundAssetName: "",
    glassBackgroundAssetMetadata: null,
    glassBackgroundOverlay: 0,
    glassBackgroundBlur: 40
  });

  await sharp({
    create: { width: 32, height: 18, channels: 3, background: { r: 18, g: 42, b: 88 } }
  }).avif().toFile(avifSourcePath);
  const avifService = createGlassBackgroundService({
    assetsDir: path.join(testRoot, "managed-avif"),
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [avifSourcePath] }) },
    sharp,
    now: () => nowMs
  });
  const pickedAvif = await avifService.pick();
  assert.equal(pickedAvif.ok, true, "AVIF input must be recognized through Sharp's HEIF metadata label");
  assert.equal(pickedAvif.asset.mimeType, "image/webp");
  assert.equal(pickedAvif.asset.width, 32);

  await sharp({
    create: {
      width: 5_000,
      height: 2_500,
      channels: 4,
      background: { r: 26, g: 91, b: 160, alpha: 0.92 }
    }
  }).png().toFile(sourcePath);

  const service = createGlassBackgroundService({
    assetsDir,
    dialog: {
      async showOpenDialog() {
        return canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [selectedPath] };
      }
    },
    sharp,
    now: () => nowMs,
    retentionMs: 120_000
  });

  const picked = await service.pick();
  assert.equal(picked.ok, true);
  assert.equal(GLASS_BACKGROUND_ASSET_ID_PATTERN.test(picked.asset.assetId), true);
  assert.equal(picked.asset.schemaVersion, 1);
  assert.equal(picked.asset.name, "Store Hero.png");
  assert.equal(picked.asset.mimeType, "image/webp");
  assert.equal(picked.asset.width, GLASS_BACKGROUND_MAX_EDGE);
  assert.equal(picked.asset.height, GLASS_BACKGROUND_MAX_EDGE / 2);
  assert.match(picked.dataUrl, /^data:image\/webp;base64,/);
  assert.equal("path" in picked.asset, false, "The Renderer contract must not expose managed filesystem paths");

  const managedPath = path.join(assetsDir, `${picked.asset.assetId}.webp`);
  assert.equal(existsSync(managedPath), true);
  assert.equal(readdirSync(assetsDir).filter((name) => name.endsWith(".webp")).length, 1);

  const duplicate = await service.pick();
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.asset.assetId, picked.asset.assetId, "Identical optimized bytes must reuse one content address");
  assert.equal(readdirSync(assetsDir).filter((name) => name.endsWith(".webp")).length, 1);

  const loaded = await service.load({ assetId: picked.asset.assetId, name: "Remembered name.jpg" });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.asset.assetId, picked.asset.assetId);
  assert.equal(loaded.asset.name, "Remembered name.jpg");
  assert.equal(loaded.asset.width, GLASS_BACKGROUND_MAX_EDGE);
  assert.deepEqual(
    Buffer.from(loaded.dataUrl.slice(loaded.dataUrl.indexOf(",") + 1), "base64"),
    readFileSync(managedPath)
  );

  const traversal = await service.load({ assetId: "../../app-settings.json" });
  assert.equal(traversal.ok, false);
  assert.equal(traversal.errorCode, "GLASS_BACKGROUND_ID_INVALID");

  const cleared = service.clear({ assetId: picked.asset.assetId }, []);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.retained, true);
  assert.equal(cleared.retainedUntil, nowMs + 120_000);
  assert.equal(existsSync(managedPath), true, "Clear must retain a recent asset for stale-window recovery");

  nowMs += 60_000;
  assert.equal(service.cleanup({ referencedAssetIds: [] }).removed, 0);
  nowMs += 120_000;
  assert.equal(service.cleanup({ referencedAssetIds: [picked.asset.assetId] }).removed, 0);
  assert.equal(existsSync(managedPath), true, "A referenced asset must never be garbage-collected");
  writeFileSync(path.join(assetsDir, "user-notes.txt"), "leave me alone", "utf8");
  assert.equal(service.cleanup({ referencedAssetIds: [] }).removed, 1);
  assert.equal(existsSync(managedPath), false);
  assert.equal(existsSync(path.join(assetsDir, "user-notes.txt")), true, "GC must ignore files it does not own");

  const missing = await service.load({ assetId: picked.asset.assetId });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorCode, "GLASS_BACKGROUND_NOT_FOUND");

  selectedPath = path.join(testRoot, "private-missing-source.png");
  const missingSource = await service.pick();
  assert.equal(missingSource.errorCode, "GLASS_BACKGROUND_IMPORT_FAILED");
  assert.equal(missingSource.error.includes(testRoot), false, "Unexpected IO failures must not reveal an absolute path");

  canceled = true;
  const canceledPick = await service.pick();
  assert.deepEqual(canceledPick, { ok: true, canceled: true });

  process.stdout.write(`${JSON.stringify({ ok: true, cases: 40, maxEdge: GLASS_BACKGROUND_MAX_EDGE })}\n`);
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
