"use strict";

const assert = require("node:assert/strict");
const {
  buildImageAssetGenerationMetadata,
  mergeImageGenerationResponseMetadata,
  normalizeImageAssetGenerationMetadata,
  normalizeImageGenerationParameters,
  pickImageGenerationResponseMetadata
} = require("../runtime/image-generation-metadata.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");

async function main() {
  const request = normalizeImageGenerationParameters({
    model: "gpt-image-2",
    ratio: "16:9",
    resolution: "2K",
    size: "1536x1024",
    quality: "auto",
    output_format: "jpg",
    output_compression: 88,
    background: "transparent",
    moderation: "low",
    input_fidelity: "high",
    apiKey: "must-not-survive",
    signedUrl: "https://secret.example/image"
  });
  assert.deepEqual(request, {
    model: "gpt-image-2",
    ratio: "16:9",
    resolution: "2K",
    size: "1536x1024",
    quality: "auto",
    background: "transparent",
    moderation: "low",
    inputFidelity: "high",
    outputFormat: "jpeg",
    outputCompression: 88
  });

  const actual = pickImageGenerationResponseMetadata(
    { created_at: 1_700_000_000, model: "gpt-image-2", quality: "high" },
    { actualParams: { size: "1792x1024", output_format: "webp" }, output_compression: 76 }
  );
  assert.deepEqual(actual, {
    model: "gpt-image-2",
    quality: "high",
    createdAt: "2023-11-14T22:13:20.000Z",
    size: "1792x1024",
    outputFormat: "webp",
    outputCompression: 76
  });

  assert.deepEqual(
    mergeImageGenerationResponseMetadata({ quality: "auto", size: "1024x1024" }, { quality: "high" }),
    { quality: "high", size: "1024x1024" }
  );

  const generation = buildImageAssetGenerationMetadata({
    request,
    response: actual,
    startedAt: "2026-08-14T08:00:00.000Z",
    completedAt: "2026-08-14T08:00:02.345Z",
    durationMs: 2345
  });
  assert.equal(generation.version, 1);
  assert.equal(generation.request.quality, "auto");
  assert.equal(generation.response.quality, "high");
  assert.equal(generation.durationMs, 2345);

  const sanitized = normalizeImageAssetGenerationMetadata({
    ...generation,
    version: 999,
    request: { ...generation.request, apiKey: "must-not-survive" },
    response: { ...generation.response, bearer: "must-not-survive" },
    durationMs: 99_999_999
  });
  assert.equal(sanitized.version, 1);
  assert.equal(sanitized.durationMs, 86_400_000);
  assert.equal(JSON.stringify(sanitized).includes("must-not-survive"), false);

  const session = sanitizeSession({
    version: 5,
    nodes: [{
      id: "N1",
      displayCode: "N1",
      type: "image",
      imageState: "done",
      status: "done",
      assets: [{
        type: "file",
        path: "C:\\managed\\image.png",
        width: 1792,
        height: 1024,
        generation: {
          ...generation,
          request: { ...generation.request, token: "must-not-survive" }
        }
      }],
      layerGroup: {
        previewAsset: { type: "file", path: "C:\\managed\\preview.png", generation: { ...generation, request: { ...generation.request, apiKey: "must-not-survive" } } },
        mergedAsset: { type: "file", path: "C:\\managed\\merged.png", generation }
      },
      layerComposition: {
        previewAsset: { type: "file", path: "C:\\managed\\composition-preview.png", generation },
        mergedAsset: { type: "file", path: "C:\\managed\\composition-merged.png", generation },
        layers: [{ asset: { type: "file", path: "C:\\managed\\layer.png", generation: { ...generation, response: { ...generation.response, bearer: "must-not-survive" } } } }]
      }
    }]
  });
  const persisted = session.nodes[0].assets[0].generation;
  assert.equal(persisted.request.ratio, "16:9");
  assert.equal(persisted.response.size, "1792x1024");
  assert.equal(JSON.stringify(persisted).includes("must-not-survive"), false);
  assert.equal(JSON.stringify(session.nodes[0].layerGroup).includes("must-not-survive"), false);
  assert.equal(JSON.stringify(session.nodes[0].layerComposition).includes("must-not-survive"), false);

  const firstImage = buildImageAssetGenerationMetadata({ request, response: { quality: "high" } });
  const secondImage = buildImageAssetGenerationMetadata({ request, response: { quality: "low" } });
  assert.notDeepEqual(firstImage.response, secondImage.response, "Each output must retain its own response parameters");

  const display = await import("../src/image-generation-metadata.ts");
  const importedAsset = {
    type: "file",
    path: "C:\\managed\\imports\\local.png",
    importBatchId: "import-batch-1",
    width: 1200,
    height: 800,
    mimeType: "image/png"
  };
  const fallbackRequest = {
    prompt: "legacy fallback",
    model: "must-not-appear",
    ratio: "1:1",
    resolution: "4K",
    size: "1024x1024",
    quality: "high",
    count: 1,
    batchMode: "parallel",
    referenceImages: []
  };
  const importedRows = display.imageGenerationDisplayRows(importedAsset, fallbackRequest);
  assert.equal(display.imageGenerationSourceLabel(importedAsset, fallbackRequest), "本地导入");
  assert.deepEqual(importedRows.map((row) => row.key), ["ratio", "pixels", "fileFormat"]);
  assert.equal(importedRows.some((row) => row.requested), false, "Imported files must not inherit a synthetic generation request");
  assert.equal(display.actualImageAspectRatio(1200, 800), "3:2");

  const legacyGeneratedAsset = { type: "file", path: "C:\\managed\\legacy.png", width: 1024, height: 1024 };
  assert.equal(display.imageGenerationSourceLabel(legacyGeneratedAsset, fallbackRequest), "请求记录");
  assert.equal(display.imageGenerationDisplayRows(legacyGeneratedAsset, fallbackRequest).some((row) => row.key === "model"), true);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 13,
    requestWhitelist: true,
    responseAliases: true,
    perImageResponseIsolation: true,
    projectPersistence: true,
    sensitiveFieldsDropped: true,
    nestedLayerPersistence: true,
    localImportFallbackSuppressed: true,
    legacyRequestFallbackPreserved: true
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
