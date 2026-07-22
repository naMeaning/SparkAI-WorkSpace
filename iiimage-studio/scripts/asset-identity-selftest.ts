import assert from "node:assert/strict";

import {
  imageAssetIdentityFingerprint,
  mergeReferenceImages,
  reconcileImageAssetIdentityClaims,
  stableImageAssetId,
  validMessages,
  type ImageAssetIdentityClaim
} from "../src/core.ts";

const firstPath = "E:\\Project\\images\\generated-1149.png";
const secondPath = "E:\\Project\\images\\generated-281600.png";

assert.equal(
  stableImageAssetId({ path: firstPath, runId: "run-a", index: 1 }, 1),
  stableImageAssetId({ path: firstPath, runId: "run-b", index: 9 }, 9),
  "A managed file path must survive container reordering and missing or changed run metadata"
);
assert.equal(
  imageAssetIdentityFingerprint({ path: firstPath, runId: "run-a" }, 1),
  imageAssetIdentityFingerprint({ path: firstPath, runId: "run-b" }, 1),
  "runId cannot split a stable managed path into two assets"
);
assert.notEqual(
  imageAssetIdentityFingerprint({ runId: "run-a" }, 1),
  imageAssetIdentityFingerprint({ runId: "run-b" }, 1),
  "runId remains the fallback identity when no path or content digest exists"
);
const sharedContentHash = "a".repeat(64);
assert.equal(
  imageAssetIdentityFingerprint({ contentHash: sharedContentHash, path: firstPath, runId: "run-a" }, 1),
  imageAssetIdentityFingerprint({ contentHash: sharedContentHash, path: secondPath }, 9),
  "A known content digest remains canonical when a project or package path changes"
);
assert.equal(
  imageAssetIdentityFingerprint({ relativePath: "output/imagegen/shared.png", path: "E:\\Project\\output\\imagegen\\shared.png" }, 1),
  imageAssetIdentityFingerprint({ relativePath: "output/imagegen/shared.png", path: "F:\\Moved\\output\\imagegen\\shared.png" }, 1),
  "Project-relative identity must survive moving the project to another path or drive"
);
assert.equal(
  imageAssetIdentityFingerprint({ url: "https://cdn.example.com/shared.png", runId: "run-a", index: 1 }, 1),
  imageAssetIdentityFingerprint({ url: "https://cdn.example.com/shared.png", runId: "run-b", index: 9 }, 9),
  "A stable URL must not be split by optional generation metadata"
);
assert.notEqual(
  stableImageAssetId({ url: "data:image/png;base64,AAAA", runId: "inline-run", index: 1 }, 1),
  stableImageAssetId({ url: "data:image/png;base64,AAAA", runId: "inline-run", index: 2 }, 2),
  "Transient inline image payloads must keep independent artifact slots"
);

const legacyCollision = "asset-1lobgxg";
const claims: ImageAssetIdentityClaim[] = [
  { assetId: legacyCollision, path: firstPath, runId: "run-a", ownerId: "A", assetIndex: 0, index: 1 },
  { assetId: legacyCollision, path: secondPath, runId: "run-b", ownerId: "B", assetIndex: 0, index: 1 },
  { assetId: legacyCollision, path: firstPath, runId: "run-a", ownerId: "C", assetIndex: 0, index: 1 }
];
const resolved = reconcileImageAssetIdentityClaims(claims);
assert.equal(resolved[0].assetId, legacyCollision, "The first non-conflicting legacy claim keeps its ID");
assert.notEqual(resolved[1].assetId, legacyCollision, "A different payload cannot reuse the first claim's ID");
assert.match(resolved[1].assetId, /^asset-[a-f0-9]{32}$/);
assert.equal(resolved[2].assetId, legacyCollision, "The same real payload may continue sharing its ID");

const differentLegacyIds = reconcileImageAssetIdentityClaims([
  { assetId: "legacy-node-id", path: firstPath, runId: "run-a", ownerId: "node", assetIndex: 0, index: 1 },
  { assetId: "legacy-message-id", path: firstPath, ownerId: "message", assetIndex: 0, index: 1 }
]);
assert.equal(
  differentLegacyIds[1].assetId,
  differentLegacyIds[0].assetId,
  "The same managed payload must converge even when node and message used different legacy IDs"
);

const hashBridgedLegacyAttachment = reconcileImageAssetIdentityClaims([
  { assetId: "hashed-node", contentHash: sharedContentHash, relativePath: "output/imagegen/shared.png", path: firstPath, ownerId: "node", assetIndex: 0, index: 1 },
  { assetId: "path-only-message", path: firstPath, ownerId: "message", assetIndex: 0, index: 1 }
]);
assert.equal(
  hashBridgedLegacyAttachment[1].assetId,
  hashBridgedLegacyAttachment[0].assetId,
  "A path-only historical attachment must bridge to the one verified payload at that locator"
);

const conflictingBytesAtReusedPath = reconcileImageAssetIdentityClaims([
  { assetId: "old-bytes", contentHash: "b".repeat(64), path: firstPath, ownerId: "old-node", assetIndex: 0, index: 1 },
  { assetId: "new-bytes", contentHash: "c".repeat(64), path: firstPath, ownerId: "new-node", assetIndex: 0, index: 1 }
]);
assert.notEqual(
  conflictingBytesAtReusedPath[1].assetId,
  conflictingBytesAtReusedPath[0].assetId,
  "A reused path cannot merge two verified but different byte payloads"
);

const weakPlaceholders = reconcileImageAssetIdentityClaims([
  { assetId: "pending-a", originalName: "pending.png", ownerId: "node-a", assetIndex: 0, index: 1 },
  { assetId: "pending-b", originalName: "pending.png", ownerId: "node-b", assetIndex: 0, index: 1 }
]);
assert.notEqual(
  weakPlaceholders[1].assetId,
  weakPlaceholders[0].assetId,
  "Weak placeholders without a path, digest, URL, or run must remain scoped to their owner and slot"
);

const secondPass = reconcileImageAssetIdentityClaims(claims.map((claim, index) => ({
  ...claim,
  assetId: resolved[index].assetId
})));
assert.deepEqual(
  secondPass.map((item) => item.assetId),
  resolved.map((item) => item.assetId),
  "Migration must be idempotent across saves and reloads"
);

const repeatedContainerAssets = reconcileImageAssetIdentityClaims([
  { path: firstPath, runId: "run-a", ownerId: "container-A", assetIndex: 0, index: 1 },
  { path: firstPath, ownerId: "container-A", assetIndex: 1, index: 2 },
  { path: secondPath, runId: "run-b", ownerId: "container-A", assetIndex: 2, index: 3 }
]);
assert.equal(repeatedContainerAssets[0].assetId, repeatedContainerAssets[1].assetId);
assert.notEqual(repeatedContainerAssets[1].assetId, repeatedContainerAssets[2].assetId);

const mergedReferences = mergeReferenceImages(
  [{ contentHash: sharedContentHash, name: "before.png", path: firstPath }],
  [{ contentHash: sharedContentHash, name: "after.png", path: secondPath }],
  9
);
assert.equal(mergedReferences.length, 1, "Composer references with the same verified bytes must not duplicate after a path change");
assert.equal(mergedReferences[0].name, "after.png", "The newest metadata should refresh the existing content identity");

const repeatedByteOccurrences = mergeReferenceImages(
  [{ occurrenceId: `occ-${"1".repeat(32)}`, importBatchId: "batch-a", importRootId: "root-a", sourceRelativePath: "a.png", contentHash: sharedContentHash, name: "a.png", path: firstPath }],
  [{ occurrenceId: `occ-${"2".repeat(32)}`, importBatchId: "batch-a", importRootId: "root-b", sourceRelativePath: "b.png", contentHash: sharedContentHash, name: "b.png", path: firstPath }],
  9
);
assert.equal(repeatedByteOccurrences.length, 2, "Distinct imported occurrences must remain independently selectable even when they share one physical blob");
assert.equal(repeatedByteOccurrences[0].assetId, repeatedByteOccurrences[1].assetId, "Logical occurrences should still share the canonical physical asset identity");
assert.notEqual(repeatedByteOccurrences[0].occurrenceId, repeatedByteOccurrences[1].occurrenceId);

const upgradedReference = mergeReferenceImages(
  [{ name: "legacy.png", path: firstPath }],
  [{ contentHash: sharedContentHash, name: "verified.png", path: firstPath }],
  9
);
assert.equal(upgradedReference.length, 1, "A verified reference must upgrade its path-only historical copy instead of duplicating it");
assert.equal(upgradedReference[0].contentHash, sharedContentHash);

const relativeOnlyReference = mergeReferenceImages(
  [],
  [{ contentHash: sharedContentHash, name: "portable.png", path: "", relativePath: "assets/portable.png" }],
  9
);
assert.equal(relativeOnlyReference.length, 1, "Portable relative-only references must survive composer merging");

const exactMessagePath = "E:\\Project\\assets\\source  with  spaces.png";
const longMessagePath = `E:\\Project\\assets\\${Array.from({ length: 180 }, (_item, index) => `nested-${index + 1}`).join("\\")}\\reference.png`;
assert.ok(longMessagePath.length > 1000);
const [messageWithLongPaths] = validMessages([{
  id: "message-paths",
  role: "user",
  content: "处理原图并参考另一张图片。",
  createdAt: "2026-07-19T00:00:00.000Z",
  attachments: {
    sourceAssets: [{ assetId: "message-source", role: "source", name: "原图", path: exactMessagePath }],
    referenceAssets: [{ assetId: "message-reference", role: "reference", name: "参考图", path: longMessagePath }],
  },
}]);
assert.equal(messageWithLongPaths.attachments?.sourceAssets[0]?.path, exactMessagePath, "Message attachment paths must preserve repeated spaces");
assert.equal(messageWithLongPaths.attachments?.referenceAssets[0]?.path, longMessagePath, "Message attachment paths must not be truncated");

console.log(JSON.stringify({ ok: true, cases: 28 }));
