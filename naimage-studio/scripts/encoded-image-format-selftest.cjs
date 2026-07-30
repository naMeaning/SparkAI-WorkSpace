"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
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
  } finally {
    runtime.dispose();
    rmSync(runtimeRoot, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    formats: ["png", "jpeg", "webp"],
    mismatchRejected: true,
    unsupportedRejected: true,
    unsupportedRejectedBeforeDispatch: providerDispatches === 0
  })}\n`);
})().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
