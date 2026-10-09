"use strict";

const assert = require("node:assert/strict");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");

async function main() {
  const calls = [];
  const imagePayload = { data: [{ b64_json: "aW1hZ2U=" }] };
  const service = createImageGenerationService({
    accessPolicy: { customApiAccess: true },
    newApiRelayJson: async (settings, endpoint, body, options) => {
      calls.push({ kind: "json", settings, endpoint, body, options });
      return imagePayload;
    },
    newApiRelayMultipart: async (settings, endpoint, form, options) => {
      calls.push({ kind: "multipart", settings, endpoint, form, options });
      assert.equal(form.get("prompt"), "edit this");
      return imagePayload;
    },
    newApiRelayAsyncImage: async (settings, endpoint, body, options) => {
      calls.push({ kind: "async", settings, endpoint, body, options });
      return imagePayload;
    }
  });
  const settings = {
    accessMode: "account",
    imageModel: "gpt-image-2",
    imageModelBindings: [{ model: "gpt-image-2", customBaseUrl: "https://model.example/v1", customApiKey: "model-key" }]
  };
  const generated = await service.generate(settings, { model: "gpt-image-2", prompt: "a chair", size: "1024x1024" });
  assert.equal(generated.ok, true);
  assert.equal(generated.images.length, 1);
  assert.equal(calls[0].kind, "json");
  assert.equal(calls[0].settings.imageModelBindings[0].customBaseUrl, "https://model.example/v1");
  assert.equal(calls[0].options.model, "gpt-image-2");

  await service.generate(settings, {
    model: "gpt-image-2",
    prompt: "edit this",
    mode: "edit",
    editImage: { dataUrl: "data:image/png;base64,aW1hZ2U=", name: "source.png" }
  });
  assert.equal(calls[1].kind, "multipart");
  assert.equal(calls[1].endpoint, "/v1/images/edits");

  await service.generate({ ...settings, imageModelConfigs: [{
    model: "grok-imagine-image-2.0",
    protocol: "xai-images",
    gateway: "sub2api",
    transportMode: "async",
    capabilities: { generate: true, multipleOutputs: true }
  }], imageModelBindings: [{ model: "grok-imagine-image-2.0", customApiKey: "grok-key", customBaseUrl: "https://sub2api.example/v1" }] }, {
    model: "grok-imagine-image-2.0",
    prompt: "wide landscape",
    aspectRatio: "16:9",
    resolution: "2K"
  });
  assert.equal(calls[2].kind, "async");
  assert.equal(calls[2].endpoint, "/v1/images/generations");
  assert.equal(calls[2].body.aspect_ratio, "16:9");
  assert.equal(calls[2].body.resolution, "2k");
  assert.equal(calls[2].body.response_format, "b64_json");

  const source = { dataUrl: "data:image/png;base64,aW1hZ2U=", name: "source.png" };
  await service.generate({ accessMode: "custom", imageModelBindings: [{ model: "grok-imagine-image-2.0", protocol: "xai-images", gateway: "direct", customBaseUrl: "https://api.x.ai/v1", customApiKey: "test-key" }] }, { model: "grok-imagine-image-2.0", prompt: "native edit", editImage: source, referenceImages: [source], ratio: "16:9", resolution: "2K" });
  assert.equal(calls[3].kind, "json");
  assert.equal(calls[3].body.images.length, 2);
  assert.equal(calls[3].body.aspect_ratio, "16:9");
  assert.equal(calls[3].body.response_format, "b64_json");
  assert.equal(calls[3].options.authHeader, undefined);

  await service.generate({ accessMode: "account", imageModelBindings: [{ model: "gemini-3.1-flash-image", protocol: "gemini-native", gateway: "direct", customBaseUrl: "https://generativelanguage.googleapis.com/v1beta", customApiKey: "test-key" }] }, { model: "gemini-3.1-flash-image", prompt: "native edit", editImage: source, ratio: "16:9", resolution: "2K" });
  assert.equal(calls[4].endpoint, "/v1beta/models/gemini-3.1-flash-image:generateContent");
  assert.equal(calls[4].options.authHeader, "x-goog-api-key");
  assert.equal(calls[4].body.contents[0].parts[1].inlineData.data, "aW1hZ2U=");
  assert.equal(calls[4].body.generationConfig.imageConfig.imageSize, "2K");

  await service.generate({ accessMode: "custom", imageModelBindings: [{ model: "grok-imagine-image-2.0", protocol: "openai-images", gateway: "newapi" }] }, { model: "grok-imagine-image-2.0", prompt: "edit this", editImage: source });
  assert.equal(calls[5].kind, "multipart", "The same Grok ID can use OpenAI Compatible edits");
  const remoteCalls = [];
  const remoteService = createImageGenerationService({
    downloadImage: async (url) => { remoteCalls.push(url); return Buffer.from("image"); },
    newApiRelayJson: async (_settings, _endpoint, body) => { assert.equal(body.contents[0].parts[1].inlineData.data, "aW1hZ2U="); return { candidates: [{ content: { parts: [{ inlineData: { data: "aW1hZ2U=", mimeType: "image/jpeg" } }] } }] }; }
  });
  const remoteResult = await remoteService.generate({ imageModelBindings: [{ model: "channel-alias", protocol: "gemini-native", gateway: "newapi" }] }, { model: "channel-alias", prompt: "remote edit", editImage: { url: "https://cdn.example/source.png" } });
  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteResult.data[0].mime_type, "image/jpeg");
  assert.equal(remoteResult.images[0].type, "base64");

  process.stdout.write(`${JSON.stringify({ ok: true, generate: true, edit: true, modelProtocolOverride: true, async: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
