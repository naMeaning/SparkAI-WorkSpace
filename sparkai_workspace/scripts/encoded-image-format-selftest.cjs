"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
sharp.cache(false);
const { createAgentRuntime } = require("../agent-runtime.cjs");
const {
  detectEncodedImageFormat,
  normalizeEncodedImageFormat,
  requireEncodedImageFormat
} = require("../runtime/encoded-image-format.cjs");

(async () => {
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: "#3388cc" } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();

  assert.equal(normalizeEncodedImageFormat("jpg"), "jpeg");
  assert.equal(detectEncodedImageFormat(png)?.format, "png");
  assert.equal(detectEncodedImageFormat(jpeg)?.format, "jpeg");
  assert.equal(detectEncodedImageFormat(webp)?.format, "webp");
  assert.equal(requireEncodedImageFormat(webp, "webp").extension, ".webp");
  assert.throws(
    () => requireEncodedImageFormat(png, "jpeg"),
    (error) => error?.code === "NAIMAGE_IMAGE_OUTPUT_FORMAT_MISMATCH" && error?.failureKind === "validation"
  );
  assert.throws(
    () => requireEncodedImageFormat(Buffer.from("not-an-image"), "png"),
    (error) => error?.code === "NAIMAGE_IMAGE_OUTPUT_FORMAT_INVALID"
  );
  assert.throws(
    () => requireEncodedImageFormat(png, "avif"),
    (error) => error?.code === "NAIMAGE_IMAGE_OUTPUT_FORMAT_UNSUPPORTED" && error?.failureKind === "validation"
  );

  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-image-format-"));
  let providerDispatches = 0;
  const runtime = createAgentRuntime({
    projectRoot: runtimeRoot,
    configDir: path.join(runtimeRoot, "config"),
    serverGenerateImage: async () => {
      providerDispatches += 1;
      throw new Error("unsupported formats must fail before provider dispatch");
    }
  });
  const fallbackRuntime = createAgentRuntime({ projectRoot: runtimeRoot, configDir: path.join(runtimeRoot, "fallback-config") });
  const originalFetch = global.fetch;
  let fixtureBytes;
  let fallbackDispatches = 0;
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/images/generations", "The direct fallback must only invoke the mocked image endpoint");
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).n, 1);
    fallbackDispatches += 1;
    return { ok: true, json: async () => ({ data: [{ b64_json: fixtureBytes.toString("base64"), output_format: "png" }] }) };
  };
  try {
    await assert.rejects(
      runtime.runTool("image_gen", {
        operation: "generate",
        prompt: "Format validation fixture",
        count: 1,
        outputFormat: "avif"
      }, {
        projectId: "format-project",
        conversationId: "format-conversation",
        runId: "format-run",
        settings: {
          imageModel: "mock-image-model",
          imageModelPool: ["mock-image-model"],
          imageSize: "1024x1024",
          imageQuality: "auto"
        }
      }),
      (error) => error?.code === "NAIMAGE_IMAGE_OUTPUT_FORMAT_UNSUPPORTED" && error?.failureKind === "validation"
    );
    assert.equal(providerDispatches, 0, "Unsupported generated formats must not trigger a billable provider request");
    const deliveryPng = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#3388cc" } }).png().toBuffer();
    const deliveryJpeg = await sharp(deliveryPng).jpeg().toBuffer();
    const deliveryWebp = await sharp(deliveryPng).webp().toBuffer();
    for (const [format, bytes] of Object.entries({ png: deliveryPng, jpeg: deliveryJpeg, webp: deliveryWebp })) {
      fixtureBytes = bytes;
      const result = await fallbackRuntime.runTool("image_gen", {
        operation: "generate", prompt: "Direct original-format fixture", count: 1
      }, {
        projectId: "format-project", conversationId: "fallback-conversation", runId: `fallback-${format}`,
        settings: { accessMode: "custom", imageModel: "mock-image-model", imageModelPool: ["mock-image-model"], imageBaseUrl: "https://offline.example/v1", imageApiKey: "mock-format-key", imageSize: "1024x1024", imageQuality: "auto" }
      });
      assert.equal(result.envelope.ok, true);
      const asset = result.actions.find((action) => action.node?.assets?.length)?.node.assets[0];
      assert(asset?.path, "Successful direct generation must produce a managed asset");
      assert(readFileSync(asset.path).equals(bytes), "Direct fallback must retain provider bytes when the delivery dimensions already match");
      assert.equal(asset.outputFormat, format);
      assert.equal(asset.mimeType, detectEncodedImageFormat(bytes).mimeType);
      assert.equal(asset.generation.response.outputFormat, format);
    }
    assert.equal(fallbackDispatches, 3, "Each isolated format fixture uses exactly one mock request");
  } finally {
    global.fetch = originalFetch;
    fallbackRuntime.dispose();
    runtime.dispose();
    assert.equal(path.dirname(path.resolve(runtimeRoot)), path.resolve(os.tmpdir()));
    rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    formats: ["png", "jpeg", "webp"],
    mismatchRejected: true,
    unsupportedRejected: true,
    unsupportedRejectedBeforeDispatch: providerDispatches === 0,
    directFallbackOriginalBytesRetained: fallbackDispatches === 3
  })}\n`);
})().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
