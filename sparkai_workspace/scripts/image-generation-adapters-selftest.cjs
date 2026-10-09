"use strict";

const assert = require("node:assert/strict");
const {
  adapterFor,
  buildGeminiRequest,
  buildOpenAiRequest,
  buildXaiRequest
} = require("../runtime/image-generation/adapters.cjs");
const {
  joinApiUrl,
  normalizeImageGenerationRequest,
  resolveImageModelConfig,
  validateImageGenerationRequest
} = require("../runtime/image-generation/types.cjs");
const { normalizeImageGenerationResponse } = require("../runtime/image-generation/normalize-response.cjs");
const { normalizeImageGenerationError, normalizeImageResultDownloadError } = require("../runtime/image-generation/errors.cjs");

async function main() {
  for (const prefix of ["", "/v1", "/v1beta", "/relay/v1beta"]) {
    const rootPath = prefix.startsWith("/relay") ? "/relay" : "";
    assert.equal(joinApiUrl(`https://image.example${prefix}`, "/v1beta/models/image:generateContent"), `https://image.example${rootPath}/v1beta/models/image:generateContent`);
    assert.equal(joinApiUrl(`https://image.example${prefix}`, "/v1/images/generations"), `https://image.example${rootPath}/v1/images/generations`);
  }
  const openaiSettings = { accessMode: "custom", imageModel: "gpt-image-2", imageModelBindings: [] };
  const openaiConfig = resolveImageModelConfig(openaiSettings, "gpt-image-2");
  const openaiRequest = validateImageGenerationRequest(
    normalizeImageGenerationRequest({ model: "gpt-image-2", prompt: "a red chair", n: 2, size: "1024x1024", quality: "high", outputFormat: "png" }, openaiConfig),
    openaiConfig
  );
  const openaiGenerate = await buildOpenAiRequest(openaiRequest, openaiConfig, { editImages: [], mask: null });
  assert.equal(openaiGenerate.endpoint, "/v1/images/generations");
  assert.equal(openaiGenerate.body.model, "gpt-image-2");
  assert.equal(openaiGenerate.body.quality, "high");
  assert.equal(openaiGenerate.body.n, 2);
  assert.equal(Object.hasOwn(openaiGenerate.body, "response_format"), false, "Keep GPT Image's existing default response contract");

  const openaiEdit = await buildOpenAiRequest(
    validateImageGenerationRequest(normalizeImageGenerationRequest({ model: "gpt-image-2", prompt: "edit", mode: "edit", editImage: { path: "x.png" } }, openaiConfig), openaiConfig),
    openaiConfig,
    { editImages: [{ buffer: Buffer.from("png"), mimeType: "image/png", name: "x.png" }], mask: null }
  );
  assert.equal(openaiEdit.kind, "multipart");
  assert.equal(openaiEdit.parts[0].field, "image[]");

  const xaiConfig = resolveImageModelConfig({ accessMode: "custom" }, "grok-imagine-image-2.0");
  const xaiRequest = normalizeImageGenerationRequest({ model: xaiConfig.model, prompt: "wide scene", aspectRatio: "16:9", resolution: "2K", n: 3, size: "2048x1152" }, xaiConfig);
  const xaiGenerate = await buildXaiRequest(xaiRequest, xaiConfig, { editImages: [], mask: null });
  assert.equal(xaiGenerate.body.aspect_ratio, "16:9");
  assert.equal(xaiGenerate.body.resolution, "2k");
  assert.equal(xaiGenerate.body.response_format, "b64_json", "Grok should return image bytes without requiring another CDN connection");
  const xaiUrl = await buildXaiRequest({ ...xaiRequest, responseFormat: "url" }, xaiConfig, { editImages: [], mask: null });
  assert.equal(xaiUrl.body.response_format, "url", "Preserve an explicit caller response format");
  assert.equal(Object.hasOwn(xaiGenerate.body, "size"), false);
  const xaiHigh = await buildXaiRequest({ ...xaiRequest, quality: "high" }, xaiConfig, { editImages: [], mask: null });
  assert.equal(xaiHigh.body.quality, "medium", "Map the shared high-quality option to xAI's highest supported quality");

  const autoXaiConfig = resolveImageModelConfig({
    accessMode: "custom",
    imageModelConfigs: [{ model: "grok-imagine-image-2.0", protocol: "openai-images", gateway: "newapi", capabilities: { generate: true } }]
  }, "grok-imagine-image-2.0");
  assert.equal(autoXaiConfig.protocol, "openai-images", "Explicit channel adapter must win over a known model name");
  assert.equal(autoXaiConfig.provider, "openai");
  for (const model of ["grok-imagine-image-2.0", "gemini-3.1-flash-image", "relay-alias"]) {
    for (const protocol of ["openai-images", "xai-images", "gemini-native"]) {
      const config = resolveImageModelConfig({ accessMode: "custom", imageModelBindings: [{ model, protocol, gateway: "newapi", transportMode: "sync" }] }, model);
      assert.equal(config.model, model);
      assert.equal(config.protocol, protocol);
      assert.equal(config.gateway, "newapi");
      assert.equal(config.transportMode, "sync");
    }
  }
  const automatic = resolveImageModelConfig({ accessMode: "account", imageModelConfigs: [{ model: "gemini-3.1-flash-image", protocol: "openai-images", gateway: "newapi", transportMode: "async" }], imageModelBindings: [{ model: "gemini-3.1-flash-image", protocol: "auto", gateway: "auto", transportMode: "auto", customBaseUrl: "https://generativelanguage.googleapis.com/v1beta" }] }, "gemini-3.1-flash-image");
  assert.equal(automatic.protocol, "gemini-native");
  assert.equal(automatic.gateway, "direct");
  assert.equal(automatic.transportMode, "sync");
  const preparedXai = { editImages: [{ base64: "aW1hZ2U=", mimeType: "image/png" }], mask: null };
  const xaiEdit = await buildXaiRequest({ ...xaiRequest, mode: "edit", quality: "auto" }, xaiConfig, preparedXai);
  assert.equal(xaiEdit.kind, "json");
  assert.equal(xaiEdit.endpoint, "/v1/images/edits");
  assert.equal(xaiEdit.body.response_format, "b64_json");
  assert.deepEqual(xaiEdit.body.image, { type: "image_url", url: "data:image/png;base64,aW1hZ2U=" });
  assert.equal(Object.hasOwn(xaiEdit.body, "quality"), false);
  const xaiMulti = await buildXaiRequest({ ...xaiRequest, mode: "edit" }, xaiConfig, { editImages: [...preparedXai.editImages, { url: "https://cdn.example/source.jpg" }], mask: null });
  assert.equal(xaiMulti.body.images.length, 2);
  assert.equal(Object.hasOwn(xaiMulti.body, "image"), false);
  assert.throws(() => validateImageGenerationRequest(normalizeImageGenerationRequest({ prompt: "too many", editImage: { path: "first.png" }, referenceImages: Array.from({ length: 5 }, (_, i) => ({ path: `ref-${i}.png` })) }, xaiConfig), xaiConfig), /最多支持 5/);

  const inferredFamilies = [
    ["gpt-image-4", "openai-images"],
    ["dall-e-4", "openai-images"],
    ["chatgpt-image-preview", "openai-images"],
    ["xai-image-3", "xai-images"],
    ["gemini-4-image", "gemini-native"],
    ["nano-banana-pro", "gemini-native"]
  ];
  for (const [model, protocol] of inferredFamilies) {
    const config = resolveImageModelConfig({ accessMode: "custom", imageBaseUrl: "https://sub2-api.example/v1" }, model);
    assert.equal(config.protocol, protocol, `${model} protocol`);
    assert.equal(config.gateway, "sub2api", `${model} gateway`);
    assert.equal(config.transportMode, "async", `${model} transport`);
  }
  const directUnknown = resolveImageModelConfig({ accessMode: "custom", imageBaseUrl: "https://images.example/v1" }, "vendor-image-v1");
  assert.equal(directUnknown.protocol, "openai-images");
  assert.equal(directUnknown.gateway, "direct");
  assert.equal(directUnknown.transportMode, "sync");

  const geminiConfig = resolveImageModelConfig({ accessMode: "custom" }, "gemini-3.1-flash-image");
  const geminiRequest = normalizeImageGenerationRequest({ model: geminiConfig.model, prompt: "cat", aspectRatio: "1:1", resolution: "1K", mode: "edit", editImage: { dataUrl: "data:image/png;base64,aW1hZ2U=" } }, geminiConfig);
  const gemini = await buildGeminiRequest(geminiRequest, geminiConfig, {
    editImages: [{ base64: "aW1hZ2U=", mimeType: "image/png", name: "cat.png" }],
    mask: null
  });
  assert.match(gemini.endpoint, /\/v1beta\/models\/gemini-3\.1-flash-image:generateContent$/);
  assert.deepEqual(gemini.body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(gemini.body.generationConfig.imageConfig.aspectRatio, "1:1");
  assert.equal(gemini.body.contents[0].parts[1].inlineData.data, "aW1hZ2U=");

  const normalized = normalizeImageGenerationResponse({
    data: [{ url: "https://cdn.example/a.png" }, { b64_json: "aW1hZ2U=" }]
  }, { model: "gpt-image-2", provider: "openai", protocol: "openai-images", gateway: "newapi" });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.images.length, 2);
  const geminiNormalized = normalizeImageGenerationResponse({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }]
  }, { model: "gemini-3.1-flash-image", provider: "google", protocol: "gemini-native", gateway: "newapi" });
  assert.equal(geminiNormalized.images[0].type, "base64");
  const thoughtFiltered = normalizeImageGenerationResponse({ candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: "image/png", data: "dGhvdWdodA==" } }, { inline_data: { mime_type: "image/jpeg", data: "aW1hZ2U=" } }] } }] });
  assert.equal(thoughtFiltered.images.length, 1);
  assert.equal(thoughtFiltered.images[0].mimeType, "image/jpeg");
  const nestedNormalized = normalizeImageGenerationResponse({
    response: {
      revisedPrompt: "keep the subject centered",
      requestIndex: 3,
      result: {
        data: {
          data: [
            { url: "https://cdn.example/nested.png" },
            { url: "https://cdn.example/nested.png" },
            { inlineData: { mimeType: "image/webp", data: "d2VicA==" } }
          ]
        }
      }
    }
  });
  assert.equal(nestedNormalized.images.length, 2);
  assert.equal(nestedNormalized.images[0].requestIndex, 3);
  assert.equal(nestedNormalized.images[0].revisedPrompt, "keep the subject centered");
  assert.equal(nestedNormalized.images[1].mimeType, "image/webp");
  assert.equal(normalizeImageGenerationError(Object.assign(new Error("too many requests"), { status: 429 }), { model: "x" }).category, "RATE_LIMIT");
  assert.equal(normalizeImageGenerationError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), { model: "x" }).category, "TIMEOUT");
  const privateError = new AggregateError([
    Object.assign(new Error("https://cdn.example/image?token=private-signature"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("Bearer private-key 10.0.0.1"), { code: "ENETUNREACH" })
  ]);
  privateError.cause = privateError;
  const downloadFailure = normalizeImageResultDownloadError(privateError);
  assert.equal(downloadFailure.errorCategory, "image_result_download");
  assert.equal(downloadFailure.unsafeToRetry, true);
  assert.equal(downloadFailure.generationCompleted, true);
  assert.match(downloadFailure.message, /ETIMEDOUT.*ENETUNREACH/);
  assert.doesNotMatch(downloadFailure.message, /https:|private|Bearer|10\.0\.0\.1/);
  const normalizedDownloadFailure = normalizeImageGenerationError(downloadFailure, { model: "grok-imagine-image-2.0" });
  assert.equal(normalizedDownloadFailure.errorCategory, "image_result_download");
  assert.equal(normalizedDownloadFailure.unsafeToRetry, true);
  assert.equal(normalizedDownloadFailure.generationCompleted, true);
  assert.match(normalizeImageResultDownloadError(Object.assign(new Error("private server body"), { status: 403 })).message, /HTTP 403/);

  process.stdout.write(`${JSON.stringify({ ok: true, openai: true, xai: true, gemini: true, responseNormalization: true, errorNormalization: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
