"use strict";

const assert = require("node:assert/strict");
const {
  adapterFor,
  buildGeminiRequest,
  buildOpenAiRequest,
  buildXaiRequest
} = require("../runtime/image-generation/adapters.cjs");
const {
  normalizeImageGenerationRequest,
  resolveImageModelConfig,
  validateImageGenerationRequest
} = require("../runtime/image-generation/types.cjs");
const { normalizeImageGenerationResponse } = require("../runtime/image-generation/normalize-response.cjs");
const { normalizeImageGenerationError } = require("../runtime/image-generation/errors.cjs");

async function main() {
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
  assert.equal(Object.hasOwn(xaiGenerate.body, "size"), false);

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
  assert.equal(normalizeImageGenerationError(Object.assign(new Error("too many requests"), { status: 429 }), { model: "x" }).category, "RATE_LIMIT");
  assert.equal(normalizeImageGenerationError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), { model: "x" }).category, "TIMEOUT");

  process.stdout.write(`${JSON.stringify({ ok: true, openai: true, xai: true, gemini: true, responseNormalization: true, errorNormalization: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
