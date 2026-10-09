"use strict";

const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");
const { normalizeImageGenerationRequest, resolveImageModelConfig } = require("../runtime/image-generation/types.cjs");
const { applyClientMask, unsupportedMaskError } = require("../desktop/image-mask-compat.cjs");

async function main() {
  const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const edited = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
  const alpha = Buffer.alloc(8 * 8 * 4, 255);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) alpha[(y * 8 + x) * 4 + 3] = 0;
  const mask = await sharp(alpha, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
  const input = bytes => ({ dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, name: "fixture.png" });
  const settings = { accessMode: "custom", imageModel: "gpt-image-2", imageBaseUrl: "https://fixture.invalid", imageApiKey: "fixture-only" };
  const payload = { prompt: "blue center", editImage: input(source), maskImage: input(mask), size: "1024x1024" };
  const calls = [];
  const service = createImageGenerationService({
    newApiRelayJson: async () => { throw new Error("References must never use generation JSON"); },
    newApiRelayMultipart: async (_settings, endpoint, form) => {
      calls.push({ endpoint, hasMask: form.has("mask"), image: form.has("image[]") });
      if (form.has("mask")) throw Object.assign(new Error("mask compositing is disabled because the VPS does not process image pixels"), { status: 400 });
      return { data: [{ b64_json: edited.toString("base64") }] };
    }
  });
  const result = await service.generate(settings, payload);
  assert.equal(result.maskStrategy, "client-composite");
  assert.deepEqual(calls.map(call => call.hasMask), [true, false]);
  assert(calls.every(call => call.endpoint === "/v1/images/edits" && call.image));
  assert.equal(result.data[0].b64_json, result.images[0].value, "Legacy data must also contain the masked result");
  const rgba = await sharp(Buffer.from(result.images[0].value, "base64")).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const pixel = [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
    assert.deepEqual(pixel, x >= 2 && x < 6 && y >= 2 && y < 6 ? [0, 0, 255, 255] : [255, 0, 0, 255]);
  }
  await service.generate(settings, payload);
  assert.equal(calls.length, 3, "Known unsupported endpoint must skip the rejected mask request on subsequent edits");
  await service.generate({ ...settings, imageApiKey: "other-credential" }, payload);
  assert.equal(calls.length, 5, "Capability cache must be isolated by credential identity");
  const initial = calls.length;
  const wrongMask = await sharp(mask).resize(4, 4).png().toBuffer();
  await assert.rejects(service.generate(settings, { ...payload, maskImage: input(wrongMask) }), /尺寸一致/);
  assert.equal(calls.length, initial, "Invalid mask must be rejected before a paid request");
  const unsafeErrors = [
    { status: 400, message: "invalid mask dimensions" },
    { status: 500, message: "mask not supported" },
    { status: 400, message: "mask not supported", ambiguous: true },
    { status: 422, message: "mask not supported", taskId: "accepted-task" },
    { status: 422, message: "mask not supported", unsafeToRetry: true }
  ];
  for (const error of unsafeErrors) {
    assert.equal(unsupportedMaskError(error), false);
    let requests = 0;
    const guarded = createImageGenerationService({ newApiRelayJson: async () => {}, newApiRelayMultipart: async () => { requests++; throw Object.assign(new Error(error.message), error); } });
    await assert.rejects(guarded.generate(settings, payload));
    assert.equal(requests, 1, "An ambiguous or accepted request must never be recreated");
  }
  let urlRequests = 0;
  const privateUrl = createImageGenerationService({
    newApiRelayJson: async () => {},
    newApiRelayMultipart: async (_settings, _endpoint, form) => {
      urlRequests++;
      if (form.has("mask")) throw Object.assign(new Error("mask not supported"), { status: 400 });
      return { data: [{ url: "http://127.0.0.1/private-image.png" }] };
    }
  });
  await assert.rejects(privateUrl.generate(settings, payload), /私有|本机/);
  assert.equal(urlRequests, 2, "A rejected result download must not cause another model request");
  const badBytes = Buffer.from("corrupt-provider-image");
  const resultFailures = [
    { name: "base64 decode", data: [{ b64_json: badBytes.toString("base64") }] },
    { name: "downloaded image decode", data: [{ url: "https://fixture.invalid/result.png" }] },
    { name: "later batch image", data: [{ b64_json: edited.toString("base64") }, { b64_json: badBytes.toString("base64") }] },
    { name: "cancel after provider response", data: [{ b64_json: edited.toString("base64") }], cancel: true }
  ];
  for (const failure of resultFailures) {
    let requests = 0;
    const cancelled = new AbortController();
    const guarded = createImageGenerationService({
      downloadImage: async () => badBytes,
      newApiRelayJson: async () => {},
      newApiRelayMultipart: async (_settings, _endpoint, form) => {
        requests++;
        if (form.has("mask")) throw Object.assign(new Error("mask not supported"), { status: 400 });
        if (failure.cancel) cancelled.abort();
        return { data: failure.data };
      }
    });
    await assert.rejects(guarded.generate(settings, { ...payload, signal: cancelled.signal }), error => {
      assert.equal(error.errorCategory, "image_result_processing", failure.name);
      assert.equal(error.generationCompleted, true, failure.name);
      assert.equal(error.unsafeToRetry, true, failure.name);
      assert.equal(error.code, "IMAGE_RESULT_PROCESSING_FAILED", failure.name);
      assert.equal(error.message.includes("corrupt-provider-image"), false, "Do not expose result bytes");
      return true;
    });
    assert.equal(requests, 2, `${failure.name} must not recreate a completed generation`);
  }
  const transparent = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0 } } }).png().toBuffer();
  const masked = await applyClientMask({ images: [{ type: "url", value: "https://fixture.invalid/image.png" }] }, { editImages: [{ buffer: source }], mask: { buffer: mask } }, async () => transparent);
  const transparentRgba = await sharp(Buffer.from(masked.images[0].value, "base64")).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...transparentRgba.subarray(0, 4)], [255, 0, 0, 255], "Opaque mask preserves the original even when edited output is transparent");
  assert.equal(transparentRgba[(3 * 8 + 3) * 4 + 3], 0, "A transparent edit region must keep the edited output alpha");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(applyClientMask({ images: [{ type: "url", value: "https://fixture.invalid/image.png" }] }, { editImages: [{ buffer: source }], mask: { buffer: mask } }, async () => { throw new Error("Aborted edits must not download"); }, controller.signal), error => error.name === "AbortError");
  const config = resolveImageModelConfig(settings, "gpt-image-2");
  assert.equal(normalizeImageGenerationRequest({ prompt: "reference", referenceImages: [input(source)] }, config).mode, "edit");
  assert.equal(normalizeImageGenerationRequest({ prompt: "redraw", mode: "redraw", editImage: input(source) }, config).mode, "edit");
  await assert.rejects(service.generate(settings, { prompt: "missing source", mode: "edit" }), /来源图片/);
  process.stdout.write(`${JSON.stringify({ ok: true, pixelAssertions: 66, noRepeatCases: unsafeErrors.length, completedResultFailures: resultFailures.length, privateResultRejected: true, abortChecked: true, networkRequests: 0 })}\n`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
