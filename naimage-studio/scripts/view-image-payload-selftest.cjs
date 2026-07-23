"use strict";

const assert = require("node:assert/strict");
const { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createAgentRuntime, prepareViewImageModelPayload, runtimeImageSourceMaxBytes, viewImagePayloadBudgetForBatch } = require("../agent-runtime.cjs");

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), "naimage-view-image-"));
  let runtime = null;
  try {
    const width = 900;
    const height = 1800;
    const noise = Buffer.alloc(width * height * 3);
    let state = 0x12345678;
    for (let index = 0; index < noise.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      noise[index] = state & 0xff;
    }
    const largePath = path.join(root, "large.png");
    await sharp(noise, { raw: { width, height, channels: 3 } }).png().toFile(largePath);

    const high = await prepareViewImageModelPayload(largePath, "high");
    assert.equal(high.detail, "high");
    assert.match(high.dataUrl, /^data:image\/webp;base64,/);
    assert.ok(high.payloadBytes <= 900 * 1024, `high payload too large: ${high.payloadBytes}`);
    assert.ok(Math.max(high.width, high.height) <= 1536);
    assert.equal(high.transcoded, true);
    assert.equal(high.resized, true);

    const threeImageBudget = viewImagePayloadBudgetForBatch(3);
    assert.equal(threeImageBudget, 400 * 1024);
    assert.ok(threeImageBudget * 3 <= 1200 * 1024);
    const batchedHigh = await prepareViewImageModelPayload(largePath, "high", threeImageBudget);
    assert.ok(batchedHigh.payloadBytes <= threeImageBudget, `batched high payload too large: ${batchedHigh.payloadBytes}`);
    assert.ok(Math.max(batchedHigh.width, batchedHigh.height) <= 1536);

    const smallPath = path.join(root, "small.png");
    await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 16, g: 96, b: 180, alpha: 0.7 } } })
      .png()
      .toFile(smallPath);
    const original = await prepareViewImageModelPayload(smallPath, "original");
    assert.equal(original.detail, "original");
    assert.equal(original.width, 64);
    assert.equal(original.height, 32);
    assert.equal(original.resized, false);
    assert.ok(original.payloadBytes <= 900 * 1024);

    const oversizedPath = path.join(root, "oversized-source.png");
    const oversizedDescriptor = openSync(oversizedPath, "w");
    try {
      ftruncateSync(oversizedDescriptor, runtimeImageSourceMaxBytes + 1);
    } finally {
      closeSync(oversizedDescriptor);
    }
    await assert.rejects(
      () => prepareViewImageModelPayload(oversizedPath, "high"),
      /128MB 安全上限/
    );

    const workspaceRoot = path.join(root, "workspace");
    const externalAssets = path.join(root, "外部  项目", "assets");
    const otherAssets = path.join(root, "other-project", "assets");
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(externalAssets, { recursive: true });
    mkdirSync(otherAssets, { recursive: true });
    const externalImagePath = path.join(externalAssets, "商品  主图.png");
    const otherImagePath = path.join(otherAssets, "other.png");
    const workspaceImagePath = path.join(workspaceRoot, "not-a-project-asset.png");
    await sharp({ create: { width: 48, height: 48, channels: 4, background: { r: 220, g: 80, b: 40, alpha: 1 } } }).png().toFile(externalImagePath);
    await sharp({ create: { width: 48, height: 48, channels: 4, background: { r: 40, g: 80, b: 220, alpha: 1 } } }).png().toFile(otherImagePath);
    await sharp({ create: { width: 48, height: 48, channels: 4, background: { r: 90, g: 90, b: 90, alpha: 1 } } }).png().toFile(workspaceImagePath);

    runtime = createAgentRuntime({
      projectRoot: workspaceRoot,
      configDir: path.join(root, "runtime-config"),
      includeProjectRootImageRoot: false,
      resolveImageRoots(context = {}) {
        if (context.projectId === "external-project") return [externalAssets];
        if (context.projectId === "other-project") return [otherAssets];
        return [];
      },
    });
    const externalView = await runtime.runTool("view_image", { path: externalImagePath, detail: "high" }, { projectId: "external-project" });
    assert.equal(externalView.envelope.ok, true, "The active external project must be able to inspect its managed image assets");
    assert.equal(externalView.envelope.modelOutput?.[0]?.type, "input_image");
    const crossProjectView = await runtime.runTool("view_image", { path: externalImagePath, detail: "high" }, { projectId: "other-project" });
    assert.equal(crossProjectView.envelope.ok, false, "A different project must not inherit the active project's image roots");
    assert.equal(crossProjectView.envelope.errorCategory, "invalid_path");
    const missingScopeView = await runtime.runTool("view_image", { path: externalImagePath, detail: "high" }, {});
    assert.equal(missingScopeView.envelope.ok, false, "External roots require an explicit validated project scope");
    const workspaceView = await runtime.runTool("view_image", { path: workspaceImagePath, detail: "high" }, { projectId: "external-project" });
    assert.equal(workspaceView.envelope.ok, false, "The Agent command workspace must not implicitly become an image authorization root");

    const invalidAskUserLimits = await runtime.runTool("ask_user", {
      kind: "source_images",
      question: "请补充原图。",
      maxSourceImages: "not-a-number",
      maxReferenceImages: "not-a-number",
    }, { projectId: "external-project", conversationId: "conversation-1" });
    assert.equal(invalidAskUserLimits.actions[0].request.maxSourceImages, 40);
    assert.equal(invalidAskUserLimits.actions[0].request.maxReferenceImages, 9);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      high: { bytes: high.payloadBytes, width: high.width, height: high.height, transcoded: high.transcoded },
      batchedHigh: { bytes: batchedHigh.payloadBytes, budget: threeImageBudget, width: batchedHigh.width, height: batchedHigh.height },
      original: { bytes: original.payloadBytes, width: original.width, height: original.height, transcoded: original.transcoded },
      externalProjectViewAllowed: true,
      crossProjectViewRejected: true,
      workspaceImageRootDisabled: true,
      oversizedSourceRejectedBeforeRead: true,
      askUserLimitsFinite: true
    })}\n`);
  } finally {
    runtime?.dispose?.();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
