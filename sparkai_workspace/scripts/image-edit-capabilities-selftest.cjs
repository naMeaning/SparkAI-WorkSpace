"use strict";
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { normalizeAiEditOperation, normalizeEditRegions, verifyProtectedPixels, verifyAlphaSubject } = require("../runtime/image-generation/edit-capabilities.cjs");
const { createImageGenerationService } = require("../desktop/image-generation-service.cjs");

async function run() {
  // A duplicate identity is a conflict, never two silently merged selections.
  assert.throws(() => normalizeEditRegions({ regions: [{ regionId: "same", x: 0, y: 0, width: 1, height: 1 }, { regionId: "same", x: 1, y: 1, width: 1, height: 1 }] }), /身份重复/);
  assert.throws(() => normalizeEditRegions({ regions: [{ x: -1, y: 0, width: 1, height: 1 }] }), /坐标无效/);
  const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
  const edited = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 150, b: 100, alpha: 1 } } }).png().toBuffer();
  const input = value => ({ dataUrl: `data:image/png;base64,${value.toString("base64")}`, name: "fixture.png" });
  const settings = { accessMode: "custom", imageModel: "gpt-image-2", imageBaseUrl: "https://fixture.invalid", imageApiKey: "fixture-only" };
  const regions = [{ regionId: "modify-center", x: 1, y: 1, width: 6, height: 6, role: "modify" }, { regionId: "keep-center", x: 3, y: 3, width: 2, height: 2, role: "preserve" }, { regionId: "describe-corner", x: 0, y: 0, width: 1, height: 1, role: "annotation", label: "原有标志" }];
  const normalized = normalizeEditRegions({ regions });
  assert.deepEqual(normalized.map(region => [region.regionId, region.role]), regions.map(region => [region.regionId, region.role]));
  let requests = 0, prepared;
  const service = createImageGenerationService({ newApiRelayJson: async () => { throw new Error("must use edit"); }, newApiRelayMultipart: async (_settings, endpoint, form) => {
    requests++; assert.equal(endpoint, "/v1/images/edits"); assert.equal(form.has("mask"), true);
    return { data: [{ b64_json: edited.toString("base64"), output_format: "jpeg", quality: "high" }] };
  } });
  const result = await service.generate(settings, { prompt: "修改中心", editOperation: "redraw", editImage: input(source), regions, onResultReceived: (_result, processing) => { prepared = processing; } });
  assert.equal(requests, 1); assert.equal(result.maskStrategy, "client-composite"); assert.equal(prepared.clientMask, true);
  const pixels = await sharp(Buffer.from(result.images[0].value, "base64")).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const changed = x >= 1 && x < 7 && y >= 1 && y < 7 && !(x >= 3 && x < 5 && y >= 3 && y < 5);
    assert.deepEqual([...pixels.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)], changed ? [200, 150, 100, 255] : [10, 20, 30, 255]);
  }
  assert.equal(result.images[0].actualParams.outputFormat, "jpeg", "Local encoding must not rewrite the provider response metadata");
  assert.equal(result.images[0].localProcessing.outputFormat, "png");
  assert.equal(result.images[0].localProcessing.maskComposite.changedPixels, 0);
  for (const operation of ["expand", "outpaint", "outpainting"]) await assert.rejects(service.generate(settings, { prompt: "禁止扩图", editOperation: operation, editImage: input(source) }), error => error.code === "IMAGE_EDIT_EXPAND_UNAVAILABLE");
  await assert.rejects(service.generate(settings, { prompt: "越界", editImage: input(source), regions: [{ x: 7, y: 0, width: 2, height: 1 }] }), /超出原图/);
  assert.equal(requests, 1, "Invalid operation/region must make zero provider requests");
  const protectedCheck = await verifyProtectedPixels(source, edited, [regions[1]]);
  assert.equal(protectedCheck.ok, false); assert.equal(protectedCheck.changedPixels, 4);
  const small = await sharp(edited).resize(4, 4).png().toBuffer();
  assert.equal((await verifyProtectedPixels(source, small, [regions[1]])).code, "IMAGE_EDIT_DIMENSION_MISMATCH");
  for (const output of [small, Buffer.from("corrupt-local-fixture")]) {
    let count = 0;
    const failure = createImageGenerationService({ newApiRelayJson: async () => {}, newApiRelayMultipart: async () => { count++; return { data: [{ b64_json: output.toString("base64") }] }; } });
    await assert.rejects(failure.generate(settings, { prompt: "中心", editImage: input(source), regions }), error => error.generationCompleted && error.unsafeToRetry && error.code === "IMAGE_RESULT_PROCESSING_FAILED");
    assert.equal(count, 1, "Completed output processing failure must never create another image");
  }
  const transparent = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0 } } }).png().toBuffer();
  const visible = await sharp(transparent).composite([{ input: source, left: 0, top: 0, blend: "over" }]).png().toBuffer();
  assert.equal((await verifyAlphaSubject(source)).ok, false, "Opaque checkerboard-like RGB is not true alpha");
  assert.equal((await verifyAlphaSubject(transparent)).ok, false, "An empty transparent result has no subject");
  assert.equal((await verifyAlphaSubject(visible)).ok, false);
  const rgba = await sharp(source).raw().toBuffer(); for (let i = 0; i < 32; i++) rgba[i * 4 + 3] = 0;
  const subject = await sharp(rgba, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
  assert.equal((await verifyAlphaSubject(subject)).ok, true);
  for (const output of [source, transparent, subject]) {
    let count = 0;
    const alphaService = createImageGenerationService({ newApiRelayJson: async () => { count++; return { data: [{ b64_json: output.toString("base64") }] }; } });
    const run = alphaService.generate(settings, { prompt: "透明主体", requireAlpha: true });
    if (output === subject) assert.equal((await run).images[0].localProcessing.alpha.verified, true);
    else await assert.rejects(run, error => error.generationCompleted && error.unsafeToRetry);
    assert.equal(count, 1);
  }
  let nativeCalls = 0;
  const xai = createImageGenerationService({ newApiRelayJson: async (_settings, endpoint) => { nativeCalls++; assert.equal(endpoint, "/v1/images/edits"); return { data: [{ b64_json: edited.toString("base64") }] }; } });
  assert.equal((await xai.generate({ ...settings, imageModel: "grok-imagine-image-2.0" }, { prompt: "中心", editImage: input(source), regions })).maskStrategy, "client-composite");
  assert.equal(nativeCalls, 1);
  console.log(JSON.stringify({ ok: true, groups: 12, pixelAssertions: 64, realModelRequests: 0, nativeMaskProtection: true, localResultFailuresNotResent: true, metadataSourcesSeparate: true }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
