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

  const localGeneration = normalizeImageAssetGenerationMetadata({ request: { protocol: "comfyui", model: "stock.safetensors", seed: 456, steps: 20,
    cfg: 7, denoise: 0.65, sampler: "euler", scheduler: "normal", templateId: "stock-img2img", templateVersion: 1,
    templateHash: "a".repeat(64), workflowHash: "b".repeat(64), sourceHashes: ["c".repeat(64), "must-not-survive"], baseUrl: "must-not-survive", promptId: "must-not-survive" } });
  assert.equal(localGeneration.request.seed, 456); assert.deepEqual(localGeneration.request.sourceHashes, ["c".repeat(64)]);
  assert.equal(JSON.stringify(localGeneration).includes("must-not-survive"), false);
  assert.equal(normalizeImageGenerationParameters({ protocol: "comfyui", seed: -1, sourceHashes: ["C:/private/file"] }).seed, undefined);

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
  assert.deepEqual(display.sanitizeImageAssetGenerationMetadata(localGeneration), localGeneration, "Renderer and Main preserve the same Comfy whitelist");
  const localRows = display.imageGenerationDisplayRows({ type: "file", generation: localGeneration, width: 512, height: 512 }, { model: "cloud", quality: "high", ratio: "16:9", resolution: "2K" });
  assert.equal(localRows.some(row => row.key === "quality" || row.key === "resolution"), false); assert.equal(localRows.find(row => row.key === "seed").requested, "456");
  assert.equal(display.imageGenerationSourceLabel({ type: "file", generation: localGeneration }), "ComfyUI 本地执行");
  const scopeLabels = { local: "ComfyUI 本地执行", lan: "ComfyUI 局域网执行", remote: "ComfyUI 远程执行" };
  for (const [networkScope, label] of Object.entries(scopeLabels)) {
    const scopedGeneration = normalizeImageAssetGenerationMetadata({
      request: { protocol: "comfyui", connectionId: "scope-fixture", networkScope, model: "scope.safetensors", baseUrl: "must-not-survive", credentialRef: { id: "must-not-survive" } },
      response: { protocol: "comfyui", connectionId: "scope-fixture", networkScope, token: "must-not-survive" }
    });
    assert.equal(scopedGeneration.request.connectionId, "scope-fixture"); assert.equal(scopedGeneration.request.networkScope, networkScope);
    assert.equal(scopedGeneration.response.connectionId, "scope-fixture"); assert.equal(scopedGeneration.response.networkScope, networkScope);
    assert.equal(JSON.stringify(scopedGeneration).includes("must-not-survive"), false);
    assert.deepEqual(display.sanitizeImageAssetGenerationMetadata(scopedGeneration), scopedGeneration, `${networkScope}: Renderer/Main metadata whitelist agrees`);
    assert.equal(display.imageGenerationSourceLabel({ type: "file", generation: scopedGeneration }), label);
    const scopedSession = sanitizeSession({ nodes: [{ id: `scope-${networkScope}`, type: "image", assets: [{ type: "file", path: "C:\\managed\\scope.png", generation: scopedGeneration }] }] });
    assert.deepEqual(scopedSession.nodes[0].assets[0].generation, scopedGeneration, `${networkScope}: project save preserves network boundary`);
  }
  const unknownGeneration = normalizeImageAssetGenerationMetadata({ request: { protocol: "comfyui", connectionId: "scope-fixture", networkScope: "untrusted-scope" } });
  assert.equal(unknownGeneration.request.networkScope, "unknown");
  assert.deepEqual(normalizeImageAssetGenerationMetadata(unknownGeneration), unknownGeneration, "repeated normalization must never turn an invalid scope into local");
  assert.deepEqual(display.sanitizeImageAssetGenerationMetadata(unknownGeneration), unknownGeneration, "Renderer preserves the explicit unknown boundary");
  assert.equal(display.imageGenerationSourceLabel({ type: "file", generation: unknownGeneration }), "ComfyUI 执行（网络范围未知）");
  assert.equal(localGeneration.request.networkScope, "local", "legacy metadata without a scope retains the historical local boundary");
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

  const { normalizeImageLocalProcessing } = await import("../runtime/image-local-processing.mjs");
  const localProcessing = { outputFormat: "png", maskComposite: { width: 8, height: 8, protectedPixelCount: 32, changedPixels: 0, verified: true, providerUrl: "must-not-survive" }, alpha: { width: 8, height: 8, transparentPixels: 32, visiblePixels: 32, transparentRatio: 999, visibleRatio: -1, verified: true }, apiKey: "must-not-survive" };
  const cleanProcessing = normalizeImageLocalProcessing(localProcessing);
  assert.equal(cleanProcessing.alpha.transparentRatio, 0.5);
  assert.equal(cleanProcessing.alpha.visibleRatio, 0.5);
  assert.equal(JSON.stringify(cleanProcessing).includes("must-not-survive"), false);
  assert.equal(normalizeImageLocalProcessing({ maskComposite: { ...localProcessing.maskComposite, changedPixels: 1 } }), undefined, "Unverified preservation cannot become successful local evidence");
  assert.equal(normalizeImageLocalProcessing({ alpha: { ...localProcessing.alpha, visiblePixels: 0 } }), undefined, "An empty alpha result cannot acquire verified subject evidence");
  const localSession = sanitizeSession({ nodes: [{ id: "local-result", type: "image", assets: [{ type: "file", path: "C:\\managed\\local.png", generation, localProcessing }], layerGroup: { previewAsset: { type: "file", path: "C:\\managed\\preview.png", localProcessing } } }] });
  assert.deepEqual(localSession.nodes[0].assets[0].localProcessing, cleanProcessing);
  assert.deepEqual(localSession.nodes[0].layerGroup.previewAsset.localProcessing, cleanProcessing);
  assert.deepEqual(localSession.nodes[0].assets[0].generation.response, generation.response, "Local processing must preserve provider metadata unchanged");
  const { cloneImageAssets } = await import("../src/core.ts");
  const cloned = cloneImageAssets([{ type: "file", path: "C:\\managed\\local.png", localProcessing: cleanProcessing }]);
  cloned[0].localProcessing.alpha.visiblePixels = 12;
  assert.equal(cleanProcessing.alpha.visiblePixels, 32, "Undo snapshots must not share nested processing evidence");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases: 21,
    requestWhitelist: true,
    responseAliases: true,
    perImageResponseIsolation: true,
    projectPersistence: true,
    sensitiveFieldsDropped: true,
    nestedLayerPersistence: true,
    localProcessingSourcesSeparated: true,
    localImportFallbackSuppressed: true,
    legacyRequestFallbackPreserved: true,
    comfyUiNetworkScopeLabels: true,
    unknownScopeIdempotent: true
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
