import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { canApplyContentName, contentNamePatch, normalizeStoredContentName } from "../runtime/image-content-name.mjs";

import type { ImageAsset, ImageCollection } from "../src/core.ts";
import {
  imageContentSummaryTitle,
  normalizeGeneratedImageContentPresentation,
} from "../src/image-content-title.ts";

const require = createRequire(import.meta.url);
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");

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
  ["visual naming metadata survives Main session persistence", () => {
    const node = { id: "VISUAL-A", type: "image", title: "图片容器", imageContainer: true, assets: [imageAsset(1, "图片成果", "")] };
    const name = { displayName: "蓝色机器人", confidence: "high" };
    const patch = contentNamePatch(node, name, node.assets[0].path);
    assert(patch);
    const persisted = sanitizeSession(JSON.parse(JSON.stringify({ nodes: [{ ...node, ...patch }] }))).nodes[0];
    assert.equal(persisted.title, "蓝色机器人");
    assert.deepEqual(persisted.contentName, { ...name, source: "visual" });
    assert.equal(persisted.assets[0].title, "蓝色机器人");
    assert.deepEqual(persisted.assets[0].contentName, persisted.contentName);
    const renamed = { ...persisted, title: "用户的封面", assets: [{ ...persisted.assets[0], title: "用户的素材名" }] };
    const restored = sanitizeSession(JSON.parse(JSON.stringify({ nodes: [renamed] }))).nodes[0];
    assert.equal(contentNamePatch(restored, { displayName: "新的内容名称", confidence: "high" }, restored.assets[0].path), undefined,
      "Manual asset-title divergence is preserved after serialization and blocks a later automatic rename");
    const manualNodeOnly = { ...persisted, title: "用户容器名称" };
    assert.equal(contentNamePatch(manualNodeOnly, { displayName: "新的内容名称", confidence: "high" }, persisted.assets[0].path)?.title, "用户容器名称",
      "A manually renamed node remains intact when an automatic asset name changes");
  }],
  ["explicit manual names survive Main and Renderer normalization regardless of spelling", () => {
    for (const title of ["红色圆形 · 2", "图片成果", "红色圆形", "用户手动名称".repeat(12)]) {
      const contentName = { displayName: title, source: "manual" as const };
      const source = { id: "MANUAL-A", type: "image", title, contentName, assets: [{ ...imageAsset(1, title, ""), contentName }] };
      const persisted = sanitizeSession(JSON.parse(JSON.stringify({ nodes: [source] }))).nodes[0];
      const restored = {
        ...persisted,
        contentName: normalizeStoredContentName(persisted.contentName),
        assets: persisted.assets.map((asset: ImageAsset) => ({ ...asset, contentName: normalizeStoredContentName(asset.contentName) })),
      };
      assert.deepEqual(restored.contentName, contentName);
      assert.deepEqual(restored.assets[0].contentName, contentName);
      assert.equal(canApplyContentName(restored), false, "Equal display text does not release explicit manual ownership");
      assert.equal(contentNamePatch(restored, { displayName: "蓝色方块", confidence: "high" }, restored.assets[0].path), undefined);
    }
  }],
  ["automatic sibling naming preserves a manual generic name and collection slot", () => {
    const manual = { ...imageAsset(1, "图片成果", ""), contentName: { displayName: "图片成果", source: "manual" as const } };
    const automatic = imageAsset(2, "图片成果", "");
    const node = { title: "图片容器", assets: [manual, automatic], imageCollection: imageCollection("图片容器", ["", ""]) };
    const patch = contentNamePatch(node, { displayName: "图片成果", confidence: "high" }, automatic.path);
    assert(patch);
    assert.equal(patch.assets?.[0].title, "图片成果");
    assert.deepEqual(patch.assets?.[0].contentName, manual.contentName);
    assert.equal(patch.imageCollection?.items[0].title, "图片成果");
    assert.notEqual(patch.assets?.[1].title, "图片成果", "Automatic collisions may receive a suffix while the manual text remains exact");
  }],
  ["incoming visual progress preserves manual titles by identity after asset reorder", () => {
    const manual = { ...imageAsset(1, "图片成果"), contentName: { displayName: "图片成果", source: "manual" as const } };
    const automatic = imageAsset(2, "旧自动名称");
    const incoming = [
      { ...automatic, title: "新的自动名称" },
      { ...manual, title: "新的视觉名称", contentName: { displayName: "新的视觉名称", source: "visual" as const, confidence: "high" as const } },
    ];
    const nodeContentName = { displayName: "图片成果", source: "manual" as const };
    const result = normalizeGeneratedImageContentPresentation({
      title: "新的视觉名称", contentName: { displayName: "新的视觉名称", source: "visual", confidence: "high" },
      existingTitle: "图片成果", existingContentName: nodeContentName, prompt: structuredPrompt,
      assets: incoming, existingAssets: [manual, automatic], collection: imageCollection("新的视觉名称"),
    });
    assert.equal(result.title, "图片成果");
    assert.deepEqual(result.contentName, nodeContentName);
    assert.equal(result.collection?.name, "图片成果");
    assert.equal(result.assets[1].title, "图片成果");
    assert.deepEqual(result.assets[1].contentName, manual.contentName);
    assert.equal(result.collection?.items[1].title, "图片成果");
  }],
  ["manual duplicate and long titles bypass prompt heuristics and automatic suffixes", () => {
    for (const title of ["图片成果", "用户手动名称".repeat(12)]) {
      const contentName = { displayName: title, source: "manual" as const };
      const result = normalizeGeneratedImageContentPresentation({
        title, contentName, prompt: structuredPrompt,
        assets: [1, 2].map((index) => ({ ...imageAsset(index, title), contentName })),
      });
      assert.equal(result.title, title);
      assert.deepEqual(result.assets.map((asset) => asset.title), [title, title]);
    }
  }],
  ["new asset identities never inherit a previous slot's manual ownership", () => {
    const old = { ...imageAsset(1, "用户手动名"), contentName: { displayName: "用户手动名", source: "manual" as const } };
    const fresh = imageAsset(3, "新的成果");
    const result = normalizeGeneratedImageContentPresentation({ title: "新的成果", assets: [fresh], existingAssets: [old] });
    assert.equal(result.assets[0].title, "新的成果");
    assert.equal(result.assets[0].contentName, undefined);
  }],
];

for (const [name, run] of tests) {
  run();
  process.stdout.write(`ok - ${name}\n`);
}

process.stdout.write(`image content title selftest passed (${tests.length} cases)\n`);
