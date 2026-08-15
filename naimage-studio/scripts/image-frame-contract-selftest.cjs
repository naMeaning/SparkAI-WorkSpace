"use strict";

const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { createAgentRuntime } = require("../agent-runtime.cjs");
const { toolSchemas } = require("../runtime/tool-schemas.cjs");
const {
  appendImageDeliverySpecification,
  freezeImageFrameSettings,
  imageToolArgsWithFrameContract,
  normalizeImageToolFrame
} = require("../runtime/image-frame.cjs");

sharp.cache(false);

async function writeFixture(filePath, color) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: color
    }
  }).png().toFile(filePath);
}

function imageToolSchema(runtime, settings) {
  return runtime.getToolSchemas(settings).find((tool) => tool?.function?.name === "image_gen")?.function?.parameters;
}

async function runFrameCase(spec) {
  const root = mkdtempSync(path.join(os.tmpdir(), `naimage-frame-${spec.id}-`));
  const requests = [];
  const settings = freezeImageFrameSettings({
    imageModel: "gpt-image-2",
    imageModelPool: ["gpt-image-2"],
    imageBatchSize: 2,
    imageQuality: "auto"
  }, {
    ratio: spec.ratio,
    resolution: spec.resolution
  });
  const runtime = createAgentRuntime({
    projectRoot: root,
    configDir: path.join(root, "config"),
    serverGenerateImage: async (request) => {
      requests.push({ ...request });
      const outputPath = path.join(root, "output", `${spec.id}.png`);
      await writeFixture(outputPath, spec.color);
      return {
        ok: true,
        model: "gpt-image-2",
        size: request.size,
        quality: request.quality,
        assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
      };
    }
  });

  try {
    assert.equal(settings.imageFrameLocked, true);
    assert.equal(settings.imageRatio, spec.ratio);
    assert.equal(settings.imageResolution, spec.resolution);
    assert.equal(settings.imageSize, spec.deliverySize);

    const schema = imageToolSchema(runtime, settings);
    const internalSchema = toolSchemas(settings).find((tool) => tool?.function?.name === "image_gen")?.function?.parameters;
    assert.deepEqual(schema?.properties?.ratio?.enum, [spec.ratio]);
    assert.deepEqual(schema?.properties?.resolution?.enum, [spec.resolution]);
    assert.equal(schema?.properties?.size, undefined, "公开 Agent Schema 继续隐藏内部交付 size 字段");
    assert.deepEqual(internalSchema?.properties?.size?.enum, [spec.deliverySize]);
    assert.deepEqual(schema?.properties?.items?.items?.properties?.ratio?.enum, [spec.ratio]);
    assert.deepEqual(schema?.properties?.items?.items?.properties?.resolution?.enum, [spec.resolution]);
    assert.deepEqual(schema?.properties?.items?.items?.properties?.size?.enum, [spec.deliverySize]);

    const conflictingArgs = {
      operation: "generate",
      prompt: spec.prompt,
      model: "gpt-image-2",
      ratio: spec.conflict.ratio,
      resolution: spec.conflict.resolution,
      size: spec.conflict.size,
      items: [{
        prompt: `${spec.prompt} 批量子项`,
        ratio: spec.conflict.ratio,
        resolution: spec.conflict.resolution,
        size: spec.conflict.size
      }]
    };
    const boundArgs = imageToolArgsWithFrameContract(conflictingArgs, settings);
    assert.equal(boundArgs.ratio, spec.ratio);
    assert.equal(boundArgs.resolution, spec.resolution);
    assert.equal(boundArgs.size, spec.deliverySize);
    assert.equal(boundArgs.items[0].ratio, spec.ratio);
    assert.equal(boundArgs.items[0].resolution, spec.resolution);
    assert.equal(boundArgs.items[0].size, spec.deliverySize);
    assert.deepEqual(
      normalizeImageToolFrame(conflictingArgs, settings),
      { ratio: spec.ratio, resolution: spec.resolution, size: spec.deliverySize, requestSize: spec.requestSize }
    );

    const result = await runtime.runTool("image_gen", {
      operation: "generate",
      prompt: spec.prompt,
      model: "gpt-image-2",
      ratio: spec.conflict.ratio,
      resolution: spec.conflict.resolution,
      size: spec.conflict.size,
      count: 1
    }, {
      projectId: `project-${spec.id}`,
      conversationId: `conversation-${spec.id}`,
      runId: `run-${spec.id}`,
      settings,
      nodes: []
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].ratio, spec.ratio);
    assert.equal(requests[0].resolution, spec.resolution);
    assert.equal(requests[0].size, spec.requestSize);
    assert.match(requests[0].prompt, new RegExp(`画面比例 ${spec.ratio.replace(":", "\\:")}`));
    assert.match(requests[0].prompt, new RegExp(`清晰度 ${spec.resolution}`));
    assert.match(requests[0].prompt, new RegExp(`最终像素 ${spec.deliverySize.replace("x", "×")}`));
    assert.match(requests[0].prompt, /不得拉伸画面/);
    assert.equal(appendImageDeliverySpecification(requests[0].prompt, {
      ratio: spec.ratio,
      resolution: spec.resolution,
      size: spec.deliverySize
    }), requests[0].prompt, "交付规格不得被重复追加");

    const finalAction = [...result.actions].reverse().find((action) => Array.isArray(action?.node?.assets) && action.node.assets.length > 0);
    assert.ok(finalAction, "Runtime 必须返回包含最终受管图片的画布动作");
    const finalAsset = finalAction.node.assets[0];
    const metadata = await sharp(finalAsset.path).metadata();
    const [expectedWidth, expectedHeight] = spec.deliverySize.split("x").map(Number);
    assert.equal(metadata.width, expectedWidth);
    assert.equal(metadata.height, expectedHeight);
    assert.equal(finalAsset.prompt, spec.prompt, "成果资产必须保留原始可编辑 Prompt");
    assert.doesNotMatch(finalAction.node.prompt, /交付规格：/, "画布节点不得混入仅供上游使用的规格尾注");

    return {
      ratio: spec.ratio,
      resolution: spec.resolution,
      deliverySize: spec.deliverySize,
      requestSize: spec.requestSize,
      finalSize: `${metadata.width}x${metadata.height}`
    };
  } finally {
    runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

(async () => {
  const cases = [];
  cases.push(await runFrameCase({
    id: "portrait-2k",
    ratio: "3:4",
    resolution: "2K",
    deliverySize: "1536x2048",
    requestSize: "1024x1536",
    conflict: { ratio: "16:9", resolution: "4K", size: "3840x2160" },
    prompt: "成年女性产品主视觉，主体完整，背景简洁。",
    color: { r: 30, g: 120, b: 210, alpha: 1 }
  }));
  cases.push(await runFrameCase({
    id: "landscape-4k",
    ratio: "16:9",
    resolution: "4K",
    deliverySize: "3840x2160",
    requestSize: "1536x1024",
    conflict: { ratio: "3:4", resolution: "2K", size: "1536x2048" },
    prompt: "宽幅商品场景，主体和品牌细节完整清晰。",
    color: { r: 210, g: 90, b: 50, alpha: 1 }
  }));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    cases,
    schemaLocked: true,
    conflictingToolArgsOverridden: true,
    upstreamPromptSpecified: true,
    editablePromptPreserved: true
  })}\n`);
})().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
