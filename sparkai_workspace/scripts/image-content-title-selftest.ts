import assert from "node:assert/strict";

import type { ImageAsset, ImageCollection } from "../src/core.ts";
import {
  imageContentSummaryTitle,
  normalizeGeneratedImageContentPresentation,
} from "../src/image-content-title.ts";

const structuredPrompt = [
  "用途：面向开发者与科技爱好者的宽幅 AI 产品宣传海报。",
  "品牌主题：Grok，xAI 的 AI 助手，突出快速推理与实时信息能力。",
  "场景：未来感产品发布会主舞台。",
].join("\n");

const imageAsset = (index: number, title: string, prompt = structuredPrompt): ImageAsset => ({
  assetId: `asset-${index}`,
  index,
  type: "file",
  path: `C:/managed/asset-${index}.png`,
  prompt,
  title,
  status: "done",
});

const imageCollection = (name: string, prompts = [structuredPrompt, structuredPrompt]): ImageCollection => ({
  id: "collection-grok",
  name,
  kind: "batch",
  collectionRole: "results",
  generationMode: "parallel",
  items: prompts.map((prompt, index) => ({
    id: `item-${index + 1}`,
    assetIndex: index + 1,
    requestIndex: index + 1,
    prompt,
    title: `方案 ${index + 1}`,
    status: "done",
  })),
});

const tests: Array<[string, () => void]> = [
  ["structured Chinese prompt becomes a content summary", () => {
    assert.equal(
      imageContentSummaryTitle(`生图：${structuredPrompt.slice(0, 18)}`, structuredPrompt),
      "Grok · xAI AI 助手 · 宽幅 AI 产品宣传海报",
    );
  }],
  ["useful authored title stays intact", () => {
    assert.equal(imageContentSummaryTitle("Grok 未来科技发布会", structuredPrompt), "Grok 未来科技发布会");
  }],
  ["prompt copied into title is summarized", () => {
    assert.equal(imageContentSummaryTitle(structuredPrompt, structuredPrompt), "Grok · xAI AI 助手 · 宽幅 AI 产品宣传海报");
  }],
  ["English structured prompt is summarized", () => {
    const prompt = "Purpose: a cinematic product launch poster\nSubject: Atlas, autonomous research assistant\nScene: a precise orbital laboratory";
    assert.equal(imageContentSummaryTitle("Generated image", prompt), "Atlas · cinematic product launch poster");
  }],
  ["batch node assets and slots share disambiguated summaries", () => {
    const assets = Object.freeze([
      Object.freeze(imageAsset(1, "方案 1")),
      Object.freeze(imageAsset(2, "方案 2")),
    ]);
    const collection = Object.freeze({
      ...imageCollection(`批量图片组：${structuredPrompt.slice(0, 18)}`),
      items: Object.freeze(imageCollection("unused").items.map((item) => Object.freeze(item))),
    }) as unknown as ImageCollection;
    const result = normalizeGeneratedImageContentPresentation({
      title: `批量图片组：${structuredPrompt.slice(0, 18)}`,
      prompt: structuredPrompt,
      assets,
      collection,
    });
    assert.equal(result.title, "Grok · xAI AI 助手 · 宽幅 AI 产品宣传海报");
    assert.equal(result.collection?.name, result.title);
    assert.deepEqual(result.collection?.items.map((item) => item.title), [
      `${result.title} · 1`,
      `${result.title} · 2`,
    ]);
    assert.deepEqual(result.assets.map((asset) => asset.title), result.collection?.items.map((item) => item.title));
    assert.equal(assets[0].title, "方案 1", "normalization must not mutate persisted input objects");
  }],
  ["existing user collection name survives later progress updates", () => {
    const existing = imageCollection("春季品牌主视觉");
    const result = normalizeGeneratedImageContentPresentation({
      title: "批量图片组：Grok",
      existingTitle: "春季品牌主视觉",
      prompt: structuredPrompt,
      assets: [imageAsset(1, "方案 1"), imageAsset(2, "方案 2")],
      collection: imageCollection("批量图片组：Grok"),
      existingCollection: existing,
    });
    assert.equal(result.title, "春季品牌主视觉");
    assert.equal(result.collection?.name, "春季品牌主视觉");
  }],
  ["long free-form prompt is bounded and empty prompt has a fallback", () => {
    const longTitle = imageContentSummaryTitle("生成图片", `请生成一张${"高精度未来城市与人物叙事场景".repeat(8)}。`);
    assert(longTitle.length <= 48);
    assert.match(longTitle, /…$/);
    assert.equal(imageContentSummaryTitle("图片成果", ""), "图片成果");
  }],
];

for (const [name, run] of tests) {
  run();
  process.stdout.write(`ok - ${name}\n`);
}

process.stdout.write(`image content title selftest passed (${tests.length} cases)\n`);
