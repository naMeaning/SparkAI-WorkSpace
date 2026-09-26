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

  process.stdout.write(`${JSON.stringify({ ok: true, generate: true, edit: true, modelProtocolOverride: true, async: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
