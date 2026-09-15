import assert from "node:assert/strict";

import type { ImageAsset, ImageCollection, WorkflowNode } from "../src/core.ts";
import {
  ImageCollectionMutationError,
  renameImageCollections,
  replaceImageCollectionItems,
  sanitizeImageCollectionName,
} from "../src/image-collection-mutation.ts";

const asset = (assetId: string, index: number, options: Partial<ImageAsset> = {}): ImageAsset => ({
  assetId,
  occurrenceId: `occ-${String(index).padStart(32, "0")}`,
  index,
  type: "file",
  path: `C:/managed/output/${assetId}.png`,
  prompt: `prompt-${index}`,
  status: "done",
  ...options,
});

const collection = (id: string, name: string, assets: ImageAsset[]): ImageCollection => ({
  id,
  name,
  kind: "batch",
  collectionRole: "results",
  generationMode: "parallel",
  createdAt: "2026-08-11T00:00:00.000Z",
  items: assets.map((item, index) => ({
    id: `${id}-item-${index + 1}`,
    assetId: item.assetId,
    occurrenceId: item.occurrenceId,
    assetIndex: index + 1,
    requestIndex: index + 1,
    prompt: `collection-prompt-${index + 1}`,
    title: `slot-${index + 1}`,
    status: "done",
    taskProvenance: {
      version: 1,
      taskScopeSnapshotHash: `scope-${"a".repeat(32)}`,
      resultPolicy: "grouped-by-source",
      sourceBindingId: `binding-${index + 1}`,
    },
  })),
});

const node = (id: string, imageCollection?: ImageCollection, assets: ImageAsset[] = []): WorkflowNode => ({
  id,
  displayCode: id,
  title: imageCollection?.name || id,
  prompt: `${id} prompt`,
  type: "image",
  status: "done",
  x: 100,
  y: 120,
  branch: "test",
  outputs: assets.length,
  createdAt: "2026-08-11T00:00:00.000Z",
  assets,
  imageState: "done",
  imageCollection,
  imageContainerSpec: imageCollection ? {
    version: 1,
    kind: "batch-result",
    memberNodeIds: [],
    childContainerNodeIds: [],
    memberBindings: [],
    layoutOrigin: "generation",
    autoFit: true,
    collection,
  } : undefined,
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
};

const testSafeBatchRename = (): void => {
  const firstAssets = [asset("asset-a", 1)];
  const secondAssets = [asset("asset-b", 2)];
  const source = deepFreeze([
    node("A", collection("collection-a", "旧 A", firstAssets), firstAssets),
    node("B", collection("collection-b", "旧 B", secondAssets), secondAssets),
    node("C", collection("collection-c", "商品图", [asset("asset-c", 3)]), [asset("asset-c", 3)]),
  ]);
  const result = renameImageCollections(source, [
    { collectionId: "collection-a", name: "  商品图<>  " },
    { collectionId: "collection-b", name: "商品图" },
  ]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.renamed.map((entry) => entry.name), ["商品图 (2)", "商品图 (3)"]);
  assert.deepEqual(result.nodes.slice(0, 2).map((entry) => [entry.title, entry.imageCollection?.name, entry.imageContainerSpec?.collection?.name]), [
    ["商品图 (2)", "商品图 (2)", "商品图 (2)"],
    ["商品图 (3)", "商品图 (3)", "商品图 (3)"],
  ]);
  assert.equal(source[0].title, "旧 A");
  assert.equal(sanitizeImageCollectionName("CON"), "_CON");
  assert.equal(sanitizeImageCollectionName(" ..\\/:*?\"<>| "), "图片组");
};

const testReplacementCreatesDefectGroup = (): void => {
  const originals = [asset("original-a", 1), asset("original-b", 2)];
  const replacement = asset("replacement-a", 9, { occurrenceId: `occ-${"9".repeat(32)}` });
  const source = deepFreeze([
    node("RESULT", collection("collection-result", "广告候选", originals), originals),
    node("LIBRARY", undefined, [replacement]),
  ]);
  const result = replaceImageCollectionItems(source, [{
    sourceCollectionId: "collection-result",
    requestIndex: 1,
    replacementNodeId: "LIBRARY",
    replacementAssetIndex: 0,
    defectReason: "主体手指出现瑕疵",
  }], { createdAt: "2026-08-11T01:00:00.000Z" });
  assert.equal(result.changed, true);
  assert.equal(result.nodes.length, 3);
  const repaired = result.nodes.find((entry) => entry.id === "RESULT")!;
  const defect = result.nodes.find((entry) => entry.imageCollection?.collectionRole === "defects")!;
  assert.equal(repaired.assets?.[0].assetId, "replacement-a");
  assert.equal(repaired.imageCollection?.items[0].replacedByAssetId, "replacement-a");
  assert.equal(repaired.imageCollection?.items[0].requestIndex, 1);
  assert.equal(repaired.imageCollection?.items[0].prompt, "collection-prompt-1");
  assert.equal(repaired.imageCollection?.items[0].taskProvenance?.sourceBindingId, "binding-1");
  assert.equal(repaired.imageContainerSpec?.collection?.items[0].assetId, "replacement-a");
  assert.equal(defect.imageCollection?.collectionRole, "defects");
  assert.equal(defect.imageCollection?.sourceCollectionId, "collection-result");
  assert.equal(defect.imageCollection?.defectOfNodeId, "RESULT");
  assert.equal(defect.assets?.[0].assetId, "original-a");
  assert.equal(defect.imageCollection?.items[0].replacesItemId, "collection-result-item-1");
  assert.equal(defect.imageCollection?.items[0].defectReason, "主体手指出现瑕疵");
  assert.equal(defect.parentId, undefined);
  assert.equal(source[0].assets?.[0].assetId, "original-a");

  const replay = replaceImageCollectionItems(result.nodes, [{
    sourceCollectionId: "collection-result",
    itemId: "collection-result-item-1",
    replacementNodeId: "LIBRARY",
    replacementAssetIndex: 0,
    defectReason: "重复执行不应追加",
  }]);
  assert.equal(replay.changed, false);
  assert.equal(replay.nodes.filter((entry) => entry.imageCollection?.collectionRole === "defects").length, 1);
  assert.equal(replay.nodes.find((entry) => entry.imageCollection?.collectionRole === "defects")?.assets?.length, 1);
};

const testBatchValidationRollsBack = (): void => {
  const originals = [asset("original-a", 1), asset("original-b", 2)];
  const replacement = asset("replacement-a", 9);
  const source = deepFreeze([
    node("RESULT", collection("collection-result", "广告候选", originals), originals),
    node("LIBRARY", undefined, [replacement]),
  ]);
  assert.throws(() => replaceImageCollectionItems(source, [
    {
      sourceCollectionId: "collection-result",
      requestIndex: 1,
      replacementNodeId: "LIBRARY",
      replacementAssetIndex: 0,
      defectReason: "第一张",
    },
    {
      sourceCollectionId: "collection-result",
      requestIndex: 2,
      replacementNodeId: "MISSING",
      replacementAssetIndex: 0,
      defectReason: "第二张",
    },
  ]), (error: unknown) => error instanceof ImageCollectionMutationError && error.code === "REPLACEMENT_ASSET_NOT_FOUND");
  assert.equal(source[0].assets?.[0].assetId, "original-a");
  assert.equal(source[0].imageCollection?.items[0].replacedByAssetId, undefined);
};

const testDuplicateTargetIsRejected = (): void => {
  const originals = [asset("original-a", 1)];
  const replacement = asset("replacement-a", 9);
  const source = [
    node("RESULT", collection("collection-result", "广告候选", originals), originals),
    node("LIBRARY", undefined, [replacement]),
  ];
  assert.throws(() => replaceImageCollectionItems(source, [
    { sourceCollectionId: "collection-result", requestIndex: 1, replacementNodeId: "LIBRARY", replacementAssetIndex: 0, defectReason: "A" },
    { sourceCollectionId: "collection-result", itemId: "collection-result-item-1", replacementNodeId: "LIBRARY", replacementAssetIndex: 0, defectReason: "B" },
  ]), (error: unknown) => error instanceof ImageCollectionMutationError && error.code === "DUPLICATE_REPLACEMENT");
};

const tests: Array<[string, () => void]> = [
  ["safe batch rename stays synchronized", testSafeBatchRename],
  ["replacement creates one independent defect group", testReplacementCreatesDefectGroup],
  ["batch validation rolls back every mutation", testBatchValidationRollsBack],
  ["duplicate replacement targets are rejected", testDuplicateTargetIsRejected],
];

for (const [name, run] of tests) {
  run();
  process.stdout.write(`ok - ${name}\n`);
}
process.stdout.write(`image-collection mutation selftest passed (${tests.length} cases)\n`);
