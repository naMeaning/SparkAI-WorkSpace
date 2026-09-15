"use strict";

const assert = require("node:assert/strict");
const {
  mergeProjectSessions,
  prepareIncomingNodeMutationSession
} = require("../desktop/project-session-merge.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");
const { composeCommerceSetTask } = require("../runtime/commerce-set-plan.cjs");

function node(id, origin, extra = {}) {
  return {
    id,
    displayCode: id,
    persistenceOriginId: origin,
    title: `node ${id}`,
    prompt: "prompt",
    type: "image",
    status: "done",
    x: 10,
    y: 20,
    branch: "basic",
    outputs: 0,
    createdAt: "10:00",
    assets: [],
    imageState: "empty",
    ...extra
  };
}

const existing = {
  schemaVersion: 3,
  sessionRevision: 5,
  canvasRevision: 7,
  nodeSequence: 2,
  activeConversationId: "conv-a",
  messages: [{ id: "a1", role: "user", content: "A", createdAt: "2026-07-28T01:00:00Z" }],
  conversations: [],
  nodes: [
    node("A", "legacy:A"),
    node("B", "renderer-a:B", {
      assets: [{ assetId: "asset-done", occurrenceId: "done-1", type: "file", path: "done.png" }],
      outputs: 1,
      imageState: "done"
    })
  ],
  layoutGroups: []
};

const incoming = {
  schemaVersion: 3,
  sessionRevision: 5,
  canvasRevision: 8,
  nodeSequence: 2,
  activeConversationId: "conv-b",
  messages: [{ id: "b1", role: "user", content: "B", createdAt: "2026-07-28T01:01:00Z" }],
  conversations: [],
  nodes: [
    node("A", "legacy:A", { x: 99 }),
    node("B", "renderer-b:B", {
      type: "requirement",
      parentId: "A",
      requirement: { version: 2, text: "new requirement", revision: 1, createdFrom: "node", inputBindings: [{ nodeId: "A", role: "source" }] }
    })
  ],
  layoutGroups: [{ id: "layout-b", hostNodeId: "B", memberNodeIds: ["B", "A"], origin: "manual", autoFit: true }]
};

const first = mergeProjectSessions(existing, incoming, { nextRevision: 6 });
assert.equal(first.session.sessionRevision, 6);
assert.equal(first.session.canvasRevision, 8);
assert.equal(first.session.nodes.length, 3);
assert.equal(first.session.nodes.find((item) => item.id === "A").x, 99);
assert.equal(first.remappedNodeIds.B, "C");
assert.equal(first.session.nodes.find((item) => item.id === "C").parentId, "A");
assert.equal(first.session.layoutGroups[0].hostNodeId, "C");
assert.deepEqual(first.session.layoutGroups[0].memberNodeIds, ["C", "A"]);
assert.deepEqual(first.session.conversations.map((item) => item.id), ["conv-a", "conv-b"]);
assert.equal(first.session.activeConversationId, "conv-b");
assert.equal(first.session.messages[0].id, "b1");
const repeated = mergeProjectSessions(first.session, incoming, { nextRevision: 7 });
assert.equal(repeated.session.nodes.length, 3);
assert.equal(repeated.remappedNodeIds.B, "C");

const completedExisting = {
  ...existing,
  nodes: [node("A", "shared:A", {
    assets: [{ assetId: "final", occurrenceId: "final-1", type: "file", path: "final.png" }],
    outputs: 1,
    imageState: "done",
    imageProgress: { total: 1, completed: 1 }
  })]
};
const staleIncoming = {
  ...incoming,
  nodes: [node("A", "shared:A", { x: 123, imageState: "empty", imageProgress: { total: 1, completed: 0 } })]
};
const second = mergeProjectSessions(completedExisting, staleIncoming, { nextRevision: 7 }).session;
assert.equal(second.nodes[0].x, 123);
assert.equal(second.nodes[0].assets.length, 1);
assert.equal(second.nodes[0].assets[0].assetId, "final");
assert.equal(second.nodes[0].imageState, "done");

const concurrentAssets = mergeProjectSessions(
  { ...existing, nodes: [node("A", "shared:container", { imageContainer: true, assets: [{ assetId: "one", occurrenceId: "one", type: "file", path: "one.png" }] })] },
  { ...incoming, nodes: [node("A", "shared:container", { imageContainer: true, assets: [{ assetId: "two", occurrenceId: "two", type: "file", path: "two.png" }] })] },
  { nextRevision: 8 }
).session;
assert.deepEqual(concurrentAssets.nodes[0].assets.map((asset) => asset.assetId), ["one", "two"]);

const generatedPath = "output/imagegen/agent-run-1-01.png";
const generatedAsset = (occurrenceId, extra = {}) => ({
  assetId: "asset-generated",
  occurrenceId,
  type: "file",
  path: `C:/project/${generatedPath}`,
  relativePath: generatedPath,
  runId: "agent-run-1",
  ...extra
});
const repeatedGenerated = mergeProjectSessions(
  { ...existing, nodes: [node("A", "shared:generated", { assets: [generatedAsset(`occ-${"1".repeat(32)}`)], outputs: 1, imageState: "done" })] },
  { ...incoming, nodes: [node("A", "shared:generated", { assets: [generatedAsset(`occ-${"2".repeat(32)}`, { width: 1024 })], outputs: 1, imageState: "done" })] },
  { nextRevision: 8 }
).session.nodes[0];
assert.equal(repeatedGenerated.assets.length, 1, "The same generated run/file must remain idempotent across renderer occurrences");
assert.equal(repeatedGenerated.assets[0].width, 1024);
assert.equal(repeatedGenerated.assets[0].occurrenceId, `occ-${"1".repeat(32)}`, "The first persisted occurrence must remain the canonical identity");
const replayedGenerated = mergeProjectSessions(
  { ...existing, nodes: [{ ...repeatedGenerated, outputs: 42 }] },
  { ...incoming, nodes: [node("A", "shared:generated", { assets: [generatedAsset(`occ-${"7".repeat(32)}`)], outputs: 1, imageState: "done" })] },
  { nextRevision: 9 }
).session.nodes[0];
assert.equal(replayedGenerated.assets.length, 1);
assert.equal(replayedGenerated.outputs, 1, "A stale inflated output count must converge to the actual asset count");
assert.equal(replayedGenerated.assets[0].occurrenceId, `occ-${"1".repeat(32)}`);

const repeatedImports = mergeProjectSessions(
  { ...existing, nodes: [node("A", "shared:imports", { assets: [{ assetId: "imported", occurrenceId: `occ-${"3".repeat(32)}`, type: "file", path: "C:/project/assets/shared.png", importBatchId: "batch-a", importRootId: "root-a", sourceRelativePath: "shared.png", runId: "preserved-old-run" }] })] },
  { ...incoming, nodes: [node("A", "shared:imports", { assets: [{ assetId: "imported", occurrenceId: `occ-${"4".repeat(32)}`, type: "file", path: "C:/project/assets/shared.png", importBatchId: "batch-b", importRootId: "root-a", sourceRelativePath: "shared.png", runId: "preserved-old-run" }] })] },
  { nextRevision: 8 }
).session.nodes[0];
assert.equal(repeatedImports.assets.length, 2, "Two intentional import occurrences of the same file must remain distinct");
const legacyRepeatedImports = mergeProjectSessions(
  { ...existing, nodes: [node("A", "shared:legacy-imports", { assets: [{ assetId: "legacy-imported", occurrenceId: `occ-${"8".repeat(32)}`, type: "file", path: "C:/project/assets/legacy.png", runId: "import-abc123" }] })] },
  { ...incoming, nodes: [node("A", "shared:legacy-imports", { assets: [{ assetId: "legacy-imported", occurrenceId: `occ-${"9".repeat(32)}`, type: "file", path: "C:/project/assets/legacy.png", runId: "import-abc123" }] })] },
  { nextRevision: 8 }
).session.nodes[0];
assert.equal(legacyRepeatedImports.assets.length, 2, "Legacy import-* runs must retain separate occurrences without full batch metadata");

const historicalDuplicates = Array.from({ length: 42 }, (_item, index) => generatedAsset(`occ-${String(index + 10).padStart(32, "0")}`, { index: index + 1 }));
const normalizedHistoricalDuplicates = sanitizeSession({
  ...existing,
  nodes: [node("C", "shared:historical-generated", {
    assets: historicalDuplicates,
    outputs: 42,
    imageState: "done",
    imageProgress: { total: 42, completed: 42, failed: 0, failedSlots: [] },
    imageCollection: {
      id: "legacy-C",
      kind: "batch",
      generationMode: "parallel",
      items: historicalDuplicates.map((asset, index) => ({ id: `item-${index + 1}`, requestIndex: index + 1, assetIndex: index + 1, assetId: asset.assetId, occurrenceId: asset.occurrenceId, prompt: "prompt", status: "done" }))
    },
    imageContainerSpec: { version: 1, kind: "batch-result", memberNodeIds: [], childContainerNodeIds: [], memberBindings: historicalDuplicates.map((asset, index) => ({ bindingId: `binding-C-${index}`, assetId: asset.assetId, occurrenceId: asset.occurrenceId, nodeId: "C", containerNodeId: "C", assetIndex: index })), layoutOrigin: "generation", autoFit: true }
  })]
}).nodes[0];
assert.equal(normalizedHistoricalDuplicates.assets.length, 1, "A damaged historical session must collapse repeated generated files on load");
assert.equal(normalizedHistoricalDuplicates.outputs, 1);
assert.equal(normalizedHistoricalDuplicates.imageCollection.items.length, 1);
assert.equal(normalizedHistoricalDuplicates.imageContainerSpec.memberBindings.length, 1);
assert.equal(normalizedHistoricalDuplicates.imageProgress.completed, 1);
assert.equal(normalizedHistoricalDuplicates.imageProgress.total, 1);
assert.deepEqual(
  sanitizeSession({ ...existing, nodes: [normalizedHistoricalDuplicates] }).nodes[0],
  normalizedHistoricalDuplicates,
  "Historical duplicate repair must itself be idempotent"
);

const mixedCollection = sanitizeSession({
  ...existing,
  nodes: [node("D", "shared:mixed-generated", {
    assets: [generatedAsset(`occ-${"5".repeat(32)}`), generatedAsset(`occ-${"6".repeat(32)}`, { index: 2 })],
    outputs: 2,
    imageState: "done",
    imageProgress: { total: 2, completed: 1, failed: 1, failedSlots: [2] },
    imageCollection: { id: "collection-D", kind: "batch", generationMode: "parallel", items: [
      { id: "item-1", requestIndex: 1, assetIndex: 1, assetId: "asset-generated", prompt: "done", status: "done" },
      { id: "item-2", requestIndex: 2, prompt: "failed", status: "error", error: "failed" }
    ] }
  })]
}).nodes[0];
assert.equal(mixedCollection.assets.length, 1);
assert.deepEqual(mixedCollection.imageCollection.items.map((item) => item.status), ["done", "error"]);
assert.deepEqual(
  {
    total: mixedCollection.imageProgress.total,
    completed: mixedCollection.imageProgress.completed,
    failed: mixedCollection.imageProgress.failed,
    failedSlots: mixedCollection.imageProgress.failedSlots,
    message: mixedCollection.imageProgress.message
  },
  { total: 2, completed: 1, failed: 1, failedSlots: [2], message: "已完成 1/2 张，失败 1 张" }
);
const noCollectionFailure = sanitizeSession({
  ...existing,
  nodes: [node("E", "shared:no-collection-failure", {
    assets: [generatedAsset(`occ-${"a".repeat(32)}`), generatedAsset(`occ-${"b".repeat(32)}`, { index: 2 })],
    outputs: 2,
    imageState: "done",
    imageParams: { count: 2 },
    imageProgress: { total: 2, completed: 1, failed: 1, failedSlots: [2], activeIndex: 2 }
  })]
}).nodes[0];
assert.equal(noCollectionFailure.assets.length, 1);
assert.deepEqual(noCollectionFailure.imageProgress.failedSlots, [2]);
assert.equal(noCollectionFailure.imageProgress.total, 2);
assert.equal(noCollectionFailure.imageProgress.activeIndex, undefined);

const editedExisting = {
  ...existing,
  schemaVersion: 4,
  nodes: [node("A", "shared:old-node", { x: 44 })],
  nodeMutationJournal: [{
    version: 1,
    eventId: "renderer-a:1",
    writerId: "renderer-a",
    writerSequence: 1,
    baseRevision: 5,
    commitRevision: 6,
    kind: "upsert",
    nodeOriginId: "shared:old-node",
    nodeId: "A",
    createdAt: "2026-07-29T01:00:00Z"
  }]
};
const deletedIncoming = {
  ...incoming,
  schemaVersion: 4,
  nodes: [],
  nodeMutationJournal: [{
    version: 1,
    eventId: "renderer-b:1",
    writerId: "renderer-b",
    writerSequence: 1,
    baseRevision: 5,
    kind: "delete",
    nodeOriginId: "shared:old-node",
    nodeId: "A",
    createdAt: "2026-07-29T01:00:01Z"
  }]
};
const deleted = mergeProjectSessions(editedExisting, deletedIncoming, { nextRevision: 7 });
assert.equal(deleted.session.nodes.length, 0, "A concurrent delete must remove the logical node");
assert.equal(deleted.session.nodeMutationJournal.length, 1);
assert.equal(deleted.session.nodeMutationJournal[0].kind, "delete");
assert.equal(deleted.session.nodeMutationJournal[0].commitRevision, 7);

const staleEditAfterDelete = mergeProjectSessions(
  deleted.session,
  {
    ...incoming,
    schemaVersion: 4,
    nodes: [node("A", "shared:old-node", { x: 999 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-c:1",
      writerId: "renderer-c",
      writerSequence: 1,
      baseRevision: 5,
      kind: "upsert",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:00:02Z"
    }]
  },
  { nextRevision: 8 }
);
assert.equal(staleEditAfterDelete.session.nodes.length, 0, "A tombstone must prevent stale resurrection");
assert.equal(staleEditAfterDelete.session.nodeMutationJournal[0].kind, "delete");

const explicitRestore = mergeProjectSessions(
  deleted.session,
  {
    ...incoming,
    schemaVersion: 4,
    nodes: [node("A", "shared:old-node", { x: 77 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-b:restore-1",
      writerId: "renderer-b",
      writerSequence: 2,
      baseRevision: 7,
      kind: "restore",
      restoresEventId: "renderer-b:1",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:00:04Z"
    }]
  },
  { nextRevision: 8 }
);
assert.equal(explicitRestore.session.nodes.length, 1, "An explicit undo may restore its observed tombstone");
assert.equal(explicitRestore.session.nodes[0].x, 77);
assert.deepEqual(explicitRestore.session.nodeMutationJournal.map((event) => event.kind), ["delete", "restore"]);

const preRestoreStaleEdit = mergeProjectSessions(
  explicitRestore.session,
  {
    ...incoming,
    schemaVersion: 4,
    nodes: [node("A", "shared:old-node", { x: 555 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-c:stale-after-restore",
      writerId: "renderer-c",
      writerSequence: 3,
      baseRevision: 5,
      kind: "upsert",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:00:05Z"
    }]
  },
  { nextRevision: 9 }
);
assert.equal(preRestoreStaleEdit.session.nodes[0].x, 77, "An edit based before the restore barrier must not replace the restored node");

const latestConcurrentEdit = mergeProjectSessions(
  editedExisting,
  {
    ...incoming,
    schemaVersion: 4,
    nodes: [node("A", "shared:old-node", { x: 123 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-b:2",
      writerId: "renderer-b",
      writerSequence: 2,
      baseRevision: 5,
      kind: "upsert",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:00:03Z"
    }]
  },
  { nextRevision: 7 }
);
assert.equal(latestConcurrentEdit.session.nodes[0].x, 123, "The later serialized edit wins for the same logical node");

const disjointFieldEdit = mergeProjectSessions(
  {
    ...existing,
    schemaVersion: 5,
    nodes: [node("A", "shared:field-node", { x: 44, y: 20 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-a:field-x",
      writerId: "renderer-a",
      writerSequence: 3,
      baseRevision: 5,
      commitRevision: 6,
      kind: "upsert",
      fields: ["x"],
      nodeOriginId: "shared:field-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:05:00Z"
    }]
  },
  {
    ...incoming,
    schemaVersion: 5,
    nodes: [node("A", "shared:field-node", { x: 10, y: 88 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-b:field-y",
      writerId: "renderer-b",
      writerSequence: 3,
      baseRevision: 5,
      kind: "upsert",
      fields: ["y"],
      nodeOriginId: "shared:field-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:05:01Z"
    }]
  },
  { nextRevision: 7, now: "2026-07-29T01:05:01Z" }
).session;
assert.equal(disjointFieldEdit.nodes[0].x, 44, "A persisted x edit must survive a concurrent y edit");
assert.equal(disjointFieldEdit.nodes[0].y, 88, "The independent incoming y edit must also be applied");
assert.deepEqual(disjointFieldEdit.nodeMutationJournal.map((event) => event.fields[0]), ["x", "y"]);

const layerWriterId = "renderer-layer-persistence";
const committedLayerNode = node("L", "shared:layer-persistence", {
  layerGroup: {
    id: "layers-1",
    title: "Layer group",
    groupNumber: 1,
    total: 1,
    order: 1,
    layerId: "subject",
    layerTitle: "Subject",
    role: "subject",
    compositionWidth: 1024,
    compositionHeight: 1024,
    anchorX: 10,
    anchorY: 20,
    detached: true,
    visible: true,
    opacity: 1,
    blendMode: "normal"
  }
});
const committedLayerEvent = {
  version: 1,
  eventId: `${layerWriterId}:1`,
  writerId: layerWriterId,
  writerSequence: 1,
  baseRevision: 10,
  commitRevision: 11,
  kind: "upsert",
  fields: ["layerGroup"],
  nodeOriginId: committedLayerNode.persistenceOriginId,
  nodeId: committedLayerNode.id,
  createdAt: "2026-07-29T01:20:00.000Z"
};
const committedLayerSession = {
  ...existing,
  schemaVersion: 5,
  sessionRevision: 11,
  nodes: [committedLayerNode],
  nodeMutationJournal: [committedLayerEvent],
  nodeMutationWriterCheckpoints: [{
    version: 1,
    writerId: layerWriterId,
    writerSequence: 1,
    observedRevision: 10,
    lastSeenAt: "2026-07-29T01:20:00.000Z"
  }]
};
const recomposedLayerNode = node("L", "shared:layer-persistence", {
  layerGroup: { ...committedLayerNode.layerGroup, detached: false }
});
const preparedRecompose = prepareIncomingNodeMutationSession(
  committedLayerSession,
  { ...committedLayerSession, sessionRevision: 12, nodes: [recomposedLayerNode] },
  {
    writerId: layerWriterId,
    baselineNodes: [committedLayerNode],
    observedRevision: 11,
    now: new Date("2026-07-29T01:21:00.000Z")
  }
);
assert.equal(preparedRecompose.events.length, 1);
assert.equal(preparedRecompose.events[0].writerSequence, 2);
assert.deepEqual(
  preparedRecompose.session.nodeMutationJournal.map((event) => event.eventId),
  [`${layerWriterId}:1`, `${layerWriterId}:2`],
  "A pending same-field event must survive beside the older committed event until the coordinator stamps it"
);
const recomposedLayerSession = mergeProjectSessions(
  committedLayerSession,
  preparedRecompose.session,
  { nextRevision: 12, incomingOwnsNonNodeState: true, incomingWriterId: layerWriterId }
).session;
assert.equal(recomposedLayerSession.nodes[0].layerGroup.detached, false);
assert.equal(recomposedLayerSession.nodeMutationJournal.at(-1).commitRevision, 12);

const hiddenLayerNode = node("L", "shared:layer-persistence", {
  layerGroup: { ...recomposedLayerNode.layerGroup, visible: false }
});
const preparedVisibility = prepareIncomingNodeMutationSession(
  recomposedLayerSession,
  { ...recomposedLayerSession, sessionRevision: 13, nodes: [hiddenLayerNode] },
  {
    writerId: layerWriterId,
    baselineNodes: [recomposedLayerNode],
    observedRevision: 12,
    now: new Date("2026-07-29T01:22:00.000Z")
  }
);
const hiddenLayerSession = mergeProjectSessions(
  recomposedLayerSession,
  preparedVisibility.session,
  { nextRevision: 13, incomingOwnsNonNodeState: true, incomingWriterId: layerWriterId }
).session;
assert.equal(hiddenLayerSession.nodes[0].layerGroup.detached, false);
assert.equal(hiddenLayerSession.nodes[0].layerGroup.visible, false);
assert.equal(hiddenLayerSession.nodeMutationJournal.at(-1).writerSequence, 3);
assert.equal(hiddenLayerSession.nodeMutationJournal.at(-1).commitRevision, 13);

const clockedContentEdit = mergeProjectSessions(
  {
    ...existing,
    schemaVersion: 5,
    nodes: [node("A", "shared:clocked-content", {
      prompt: "old prompt",
      imageParams: { prompt: "old prompt", count: 1 },
      assets: [{ assetId: "finished", occurrenceId: "finished-1", type: "file", path: "finished.png" }],
      outputs: 1,
      imageState: "done",
      imageProgress: { total: 1, completed: 1 }
    })]
  },
  {
    ...incoming,
    schemaVersion: 5,
    nodes: [node("A", "shared:clocked-content", {
      prompt: "new explicit prompt",
      imageParams: { prompt: "new explicit prompt", count: 3 },
      imageState: "empty",
      imageProgress: { total: 3, completed: 0 }
    })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-b:clocked-content",
      writerId: "renderer-b",
      writerSequence: 4,
      baseRevision: 5,
      kind: "upsert",
      fields: ["prompt", "imageParams"],
      nodeOriginId: "shared:clocked-content",
      nodeId: "A",
      createdAt: "2026-07-29T01:06:00Z"
    }]
  },
  { nextRevision: 7, now: "2026-07-29T01:06:00Z", incomingWriterId: "renderer-b" }
).session;
assert.equal(clockedContentEdit.nodes[0].prompt, "new explicit prompt", "a richer completed node must not overwrite a clocked prompt edit");
assert.deepEqual(clockedContentEdit.nodes[0].imageParams, { prompt: "new explicit prompt", count: 3 });
assert.equal(clockedContentEdit.nodes[0].assets[0].assetId, "finished", "the dedicated asset merge must still preserve completed output");
assert.equal(clockedContentEdit.nodes[0].imageState, "done", "completed assets must still retain terminal state");

const carriedCheckpoints = mergeProjectSessions(
  {
    ...existing,
    schemaVersion: 5,
    nodeMutationWriterCheckpoints: [
      { version: 1, writerId: "historical-writer", writerSequence: 2, observedRevision: 5, lastSeenAt: "2026-07-10T00:00:00Z" },
      { version: 1, writerId: "current-writer", writerSequence: 3, observedRevision: 5, lastSeenAt: "2026-07-01T00:00:00Z" }
    ]
  },
  {
    ...incoming,
    schemaVersion: 5,
    nodeMutationWriterCheckpoints: [
      { version: 1, writerId: "historical-writer", writerSequence: 2, observedRevision: 5, lastSeenAt: "2026-07-10T00:00:00Z" },
      { version: 1, writerId: "current-writer", writerSequence: 3, observedRevision: 5, lastSeenAt: "2026-07-01T00:00:00Z" }
    ]
  },
  { nextRevision: 7, now: "2026-07-29T02:00:00Z", incomingWriterId: "current-writer" }
).session.nodeMutationWriterCheckpoints;
assert.equal(carriedCheckpoints.find((item) => item.writerId === "historical-writer").lastSeenAt, "2026-07-10T00:00:00Z", "carrying another writer checkpoint must not renew it");
assert.equal(carriedCheckpoints.find((item) => item.writerId === "current-writer").lastSeenAt, "2026-07-29T02:00:00.000Z", "the actual incoming writer must be renewed");

const acknowledgedDelete = mergeProjectSessions(
  {
    ...deleted.session,
    nodeMutationWriterCheckpoints: [
      ...(deleted.session.nodeMutationWriterCheckpoints || []),
      { version: 1, writerId: "expired-renderer", writerSequence: 1, observedRevision: 0, lastSeenAt: "2026-05-01T00:00:00Z" }
    ]
  },
  {
    ...deleted.session,
    schemaVersion: 5,
    nodes: [],
    nodeMutationWriterCheckpoints: [
      { version: 1, writerId: "renderer-a", writerSequence: 1, observedRevision: 7, lastSeenAt: "2026-07-29T01:10:00Z" },
      { version: 1, writerId: "renderer-b", writerSequence: 1, observedRevision: 7, lastSeenAt: "2026-07-29T01:10:00Z" }
    ]
  },
  { nextRevision: 8, now: "2026-07-29T01:10:01Z" }
);
assert.equal(acknowledgedDelete.session.nodeMutationJournal.length, 0, "An acknowledged tombstone should leave the full journal");
assert.equal(acknowledgedDelete.session.nodeMutationBarriers[0].kind, "delete", "GC must retain a compact delete barrier");
assert.equal(acknowledgedDelete.session.nodeMutationWriterCheckpoints.some((item) => item.writerId === "expired-renderer"), false);

const staleEditAfterGc = mergeProjectSessions(
  acknowledgedDelete.session,
  {
    ...incoming,
    schemaVersion: 5,
    nodes: [node("A", "shared:old-node", { x: 901 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-c:after-gc",
      writerId: "renderer-c",
      writerSequence: 1,
      baseRevision: 5,
      kind: "upsert",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:11:00Z"
    }],
    nodeMutationWriterCheckpoints: [
      { version: 1, writerId: "renderer-c", writerSequence: 1, observedRevision: 5, lastSeenAt: "2026-07-29T01:11:00Z" }
    ]
  },
  { nextRevision: 9, now: "2026-07-29T01:11:00Z" }
);
assert.equal(staleEditAfterGc.session.nodes.length, 0, "A compact delete barrier must reject a stale writer after tombstone GC");
assert.equal(staleEditAfterGc.session.nodeMutationBarriers[0].kind, "delete");

const restoredAfterGc = mergeProjectSessions(
  acknowledgedDelete.session,
  {
    ...incoming,
    schemaVersion: 5,
    nodes: [node("A", "shared:old-node", { x: 88 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-b:restore-after-gc",
      writerId: "renderer-b",
      writerSequence: 2,
      baseRevision: 8,
      kind: "restore",
      restoresEventId: "renderer-b:1",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:12:00Z"
    }],
    nodeMutationWriterCheckpoints: [
      { version: 1, writerId: "renderer-b", writerSequence: 2, observedRevision: 8, lastSeenAt: "2026-07-29T01:12:00Z" }
    ]
  },
  { nextRevision: 9, now: "2026-07-29T01:12:00Z" }
);
assert.equal(restoredAfterGc.session.nodes[0].x, 88, "Undo may causally restore a collected delete event through its barrier");

const acknowledgedRestore = mergeProjectSessions(
  restoredAfterGc.session,
  {
    ...restoredAfterGc.session,
    nodeMutationWriterCheckpoints: restoredAfterGc.session.nodeMutationWriterCheckpoints.map((checkpoint) => ({
      ...checkpoint,
      observedRevision: 9,
      lastSeenAt: "2026-07-29T01:13:00Z"
    }))
  },
  { nextRevision: 10, now: "2026-07-29T01:13:00Z" }
);
assert.equal(acknowledgedRestore.session.nodeMutationJournal.length, 0);
assert.equal(acknowledgedRestore.session.nodeMutationBarriers[0].kind, "restore");

const staleEditBeforeRestoreBarrier = mergeProjectSessions(
  acknowledgedRestore.session,
  {
    ...incoming,
    schemaVersion: 5,
    nodes: [node("A", "shared:old-node", { x: 902 })],
    nodeMutationJournal: [{
      version: 1,
      eventId: "renderer-c:before-restore-barrier",
      writerId: "renderer-c",
      writerSequence: 2,
      baseRevision: 5,
      kind: "upsert",
      nodeOriginId: "shared:old-node",
      nodeId: "A",
      createdAt: "2026-07-29T01:14:00Z"
    }]
  },
  { nextRevision: 11, now: "2026-07-29T01:14:00Z" }
);
assert.equal(staleEditBeforeRestoreBarrier.session.nodes[0].x, 88, "A restored generation barrier must reject pre-restore edits");

const normalized = sanitizeSession(first.session);
assert.equal(normalized.nodes.find((item) => item.id === "C").persistenceOriginId, "renderer-b:B");
assert.equal(normalized.sessionRevision, 6);
const normalizedDeleted = sanitizeSession(deleted.session);
assert.equal(normalizedDeleted.schemaVersion, 5);
assert.equal(normalizedDeleted.nodeMutationJournal[0].kind, "delete");

const goalConversationId = "goal-persistence-conversation";
const goalPendingExecution = {
  version: 2,
  requestId: "goal-pending-request",
  projectId: "goal-project",
  conversationId: goalConversationId,
  originalPrompt: "Process every eligible image container.",
  sourceNodeIds: ["GOAL-SOURCE-A", "GOAL-SOURCE-B"],
  taskOrigin: "goal",
  taskScope: {
    version: 2,
    origin: "goal",
    scopeType: "container-group",
    canvasRevision: 71,
    sourceNodeIds: ["GOAL-SOURCE-A", "GOAL-SOURCE-B"],
    sourceContainerIds: ["GOAL-CONTAINER-A", "GOAL-CONTAINER-B"],
    referenceContainerIds: [],
    sourceBindingIds: ["binding:goal:a", "binding:goal:b"],
    referenceBindingIds: [],
    sourceAssets: [{
      bindingId: "binding:goal:a",
      assetId: "asset-goal-a",
      displayCode: "GA1",
      role: "source",
      name: "goal-a.png",
      assetIndex: 0,
      containerSlot: 3,
      ownerAssetIndex: 0,
      ownerNodeId: "GOAL-SOURCE-A",
      nodeId: "GOAL-SOURCE-A",
      containerId: "GOAL-CONTAINER-A",
      path: "C:/naimage/goal-a.png"
    }, {
      bindingId: "binding:goal:b",
      assetId: "asset-goal-b",
      displayCode: "GB1",
      role: "source",
      name: "goal-b.png",
      assetIndex: 0,
      containerSlot: 0,
      ownerAssetIndex: 0,
      ownerNodeId: "GOAL-SOURCE-B",
      nodeId: "GOAL-SOURCE-B",
      containerId: "GOAL-CONTAINER-B",
      relativePath: "assets/goal-b.png"
    }],
    referenceAssets: [],
    resultPolicy: "grouped-by-container",
    confirmationPolicy: "direct",
    goal: {
      version: 1,
      target: "all-image-containers",
      frozen: true,
      containerIds: ["GOAL-CONTAINER-A", "GOAL-CONTAINER-B"],
      bindingIds: ["binding:goal:a", "binding:goal:b"],
      containerCount: 2,
      bindingCount: 2,
      configuredConcurrency: 8,
      probeContainerCount: 2,
      operationsPerAsset: 1,
      requestCount: 2
    },
    snapshotHash: `scope-${"a".repeat(32)}`,
    sourceAssetCount: 2,
    referenceAssetCount: 0,
    truncated: false
  },
  kind: "confirm",
  title: "Confirm Goal",
  question: "Run this frozen Goal?",
  createdAt: "2026-07-29T02:00:00.000Z"
};
const goalSessionInput = {
  schemaVersion: 5,
  messages: [],
  conversations: [{
    id: goalConversationId,
    title: "Goal persistence",
    createdAt: "2026-07-29T02:00:00.000Z",
    updatedAt: "2026-07-29T02:00:00.000Z",
    messages: []
  }],
  activeConversationId: goalConversationId,
  nodes: [],
  pendingAgentExecution: goalPendingExecution
};
const normalizedGoalSession = sanitizeSession(goalSessionInput);
const normalizedGoalScope = normalizedGoalSession.pendingAgentExecution?.taskScope;
assert.equal(normalizedGoalSession.pendingAgentExecution?.taskOrigin, "goal");
assert.equal(normalizedGoalScope?.origin, "goal");
assert.deepEqual(normalizedGoalScope?.goal, goalPendingExecution.taskScope.goal, "A valid frozen Goal boundary must survive persistence exactly");
assert.equal(normalizedGoalScope?.sourceAssets[0].assetIndex, 0, "Owner assetIndex must remain independent from flattened containerSlot");
assert.equal(normalizedGoalScope?.sourceAssets[0].containerSlot, 3);
assert.deepEqual(normalizedGoalScope?.sourceContainerIds, normalizedGoalScope?.goal.containerIds);
assert.deepEqual(normalizedGoalScope?.sourceBindingIds, normalizedGoalScope?.goal.bindingIds);

const persistedCommerceTask = composeCommerceSetTask({
  sourceCount: 2,
  sourceNodeIds: ["GOAL-SOURCE-A", "GOAL-SOURCE-B"],
  plan: { mode: "generate", setSize: 2, targetLocales: [] }
});
const commerceGoalSessionInput = structuredClone(goalSessionInput);
commerceGoalSessionInput.pendingAgentExecution.originalPrompt = persistedCommerceTask.prompt;
commerceGoalSessionInput.pendingAgentExecution.taskScope.goal.operationsPerAsset = persistedCommerceTask.counts.outputsPerSource;
commerceGoalSessionInput.pendingAgentExecution.taskScope.goal.requestCount = persistedCommerceTask.counts.totalRequests;
commerceGoalSessionInput.pendingAgentExecution.taskScope.goal.commercePlanHash = persistedCommerceTask.planHash;
const persistedCommerceCatalogTargets = [{
  bindingId: "binding:goal:a",
  catalogId: `catalog-${"1".repeat(32)}`,
  catalogRevision: 7,
  productId: `product-${"2".repeat(32)}`,
  productRevision: 4,
  ownerType: "sku",
  ownerId: `sku-${"3".repeat(32)}`,
  sourceLinkId: `material-${"4".repeat(32)}`
}, {
  bindingId: "binding:goal:b",
  catalogId: `catalog-${"1".repeat(32)}`,
  catalogRevision: 7,
  productId: `product-${"5".repeat(32)}`,
  productRevision: 2,
  ownerType: "product",
  ownerId: `product-${"5".repeat(32)}`,
  sourceLinkId: `material-${"6".repeat(32)}`
}];
commerceGoalSessionInput.pendingAgentExecution.taskScope.goal.commerceCatalogTargets = persistedCommerceCatalogTargets;
const persistedCommerceGoal = sanitizeSession(commerceGoalSessionInput).pendingAgentExecution?.taskScope.goal;
assert.equal(persistedCommerceGoal?.commercePlanHash, persistedCommerceTask.planHash, "A validated commerce plan hash must survive pending Goal persistence");
assert.equal(persistedCommerceGoal?.operationsPerAsset, 2);
assert.equal(persistedCommerceGoal?.requestCount, 4);
assert.deepEqual(
  persistedCommerceGoal?.commerceCatalogTargets,
  persistedCommerceCatalogTargets,
  "Frozen per-SOURCE Catalog targets must survive pending Goal persistence exactly"
);
const tamperedCommerceGoalSession = structuredClone(commerceGoalSessionInput);
tamperedCommerceGoalSession.pendingAgentExecution.taskScope.goal.commercePlanHash = `commerce-${"f".repeat(32)}`;
assert.equal(sanitizeSession(tamperedCommerceGoalSession).pendingAgentExecution, null, "A persisted commerce hash must match the trusted prompt exactly");
const unknownCatalogBindingSession = structuredClone(commerceGoalSessionInput);
unknownCatalogBindingSession.pendingAgentExecution.taskScope.goal.commerceCatalogTargets[0].bindingId = "binding:goal:unknown";
assert.equal(sanitizeSession(unknownCatalogBindingSession).pendingAgentExecution, null, "Persisted Catalog targets must remain a subset of the frozen SOURCE bindings");
const duplicateCatalogBindingSession = structuredClone(commerceGoalSessionInput);
duplicateCatalogBindingSession.pendingAgentExecution.taskScope.goal.commerceCatalogTargets[1].bindingId = "binding:goal:a";
assert.equal(sanitizeSession(duplicateCatalogBindingSession).pendingAgentExecution, null, "Persisted Catalog targets must not duplicate a SOURCE binding");
const reorderedCatalogTargetsSession = structuredClone(commerceGoalSessionInput);
reorderedCatalogTargetsSession.pendingAgentExecution.taskScope.goal.commerceCatalogTargets.reverse();
assert.equal(sanitizeSession(reorderedCatalogTargetsSession).pendingAgentExecution, null, "Persisted Catalog targets must retain frozen SOURCE order");
const invalidCatalogOwnerSession = structuredClone(commerceGoalSessionInput);
invalidCatalogOwnerSession.pendingAgentExecution.taskScope.goal.commerceCatalogTargets[1].ownerId = `product-${"7".repeat(32)}`;
assert.equal(sanitizeSession(invalidCatalogOwnerSession).pendingAgentExecution, null, "Product-owned Catalog targets must retain the frozen product identity");
const catalogTargetsWithoutPlanSession = structuredClone(commerceGoalSessionInput);
delete catalogTargetsWithoutPlanSession.pendingAgentExecution.taskScope.goal.commercePlanHash;
assert.equal(sanitizeSession(catalogTargetsWithoutPlanSession).pendingAgentExecution, null, "Persisted Catalog targets require a trusted Commerce plan");

const oneContainerProbeInput = structuredClone(goalSessionInput);
oneContainerProbeInput.pendingAgentExecution.taskScope.sourceContainerIds = ["GOAL-CONTAINER-A"];
oneContainerProbeInput.pendingAgentExecution.taskScope.sourceAssets[1].containerId = "GOAL-CONTAINER-A";
oneContainerProbeInput.pendingAgentExecution.taskScope.goal.containerIds = ["GOAL-CONTAINER-A"];
oneContainerProbeInput.pendingAgentExecution.taskScope.goal.containerCount = 1;
const oneContainerProbeScope = sanitizeSession(oneContainerProbeInput).pendingAgentExecution?.taskScope;
assert.equal(oneContainerProbeScope?.goal?.containerCount, 1);
assert.equal(oneContainerProbeScope?.goal?.bindingCount, 2);
assert.equal(oneContainerProbeScope?.goal?.probeContainerCount, 2, "Two SOURCE representatives in one container must survive persistence");
const longGoalPromptInput = structuredClone(goalSessionInput);
longGoalPromptInput.pendingAgentExecution.originalPrompt = "x".repeat(30_000);
assert.equal(
  sanitizeSession(longGoalPromptInput).pendingAgentExecution?.originalPrompt.length,
  30_000,
  "A valid long structured Goal prompt must not be truncated before strict recovery"
);

const invalidGoalPending = (mutate) => {
  const input = structuredClone(goalSessionInput);
  mutate(input.pendingAgentExecution);
  return sanitizeSession(input).pendingAgentExecution;
};
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.target = "selected-containers"; }), null, "Unknown Goal targets must not thaw into a resumable task");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.frozen = false; }), null, "A persisted Goal must retain an explicit frozen marker");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.containerIds[0] = "OTHER-CONTAINER"; }), null, "Goal and TaskScope container lists must remain identical");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.bindingCount = 1; }), null, "Goal counts must exactly describe the frozen binding list");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.configuredConcurrency = 11; }), null, "Persisted Goal concurrency must not exceed the existing cap");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.probeContainerCount = 3; }), null, "Persisted Goal probes must remain within the one-or-two SOURCE representative contract");
assert.equal(invalidGoalPending((pending) => { delete pending.taskScope.goal.operationsPerAsset; }), null, "Legacy pending Goals without a frozen per-asset operation count must be rejected");
assert.equal(invalidGoalPending((pending) => { delete pending.taskScope.goal.requestCount; }), null, "Legacy pending Goals without a frozen request count must be rejected");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.requestCount = 1; }), null, "Persisted Goal requestCount must equal bindingCount times operationsPerAsset");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.goal.commercePlanHash = `commerce-${"a".repeat(32)}`; }), null, "A non-commerce pending Goal must reject injected commerce metadata");
assert.equal(invalidGoalPending((pending) => { pending.taskScope.origin = "chat"; }), null, "Outer and inner Goal origins must not disagree");
assert.equal(invalidGoalPending((pending) => { pending.sourceNodeIds = ["OTHER-SOURCE"]; }), null, "Outer pending locks must match the frozen Goal source nodes");
assert.equal(invalidGoalPending((pending) => { delete pending.taskScope.sourceAssets[0].assetId; }), null, "Goal persistence must not synthesize a missing frozen asset identity");
assert.equal(invalidGoalPending((pending) => { delete pending.taskScope.sourceAssets[0].path; }), null, "Goal persistence must reject a frozen source without a durable locator");
assert.equal(invalidGoalPending((pending) => {
  const first = pending.taskScope.sourceAssets[0];
  pending.taskScope.sourceAssets = Array.from({ length: 201 }, (_item, index) => ({
    ...first,
    bindingId: `binding:over-limit:${index}`,
    assetId: `asset-over-limit-${index}`,
    ownerNodeId: `GOAL-SOURCE-${index}`,
    nodeId: `GOAL-SOURCE-${index}`,
    containerId: `GOAL-CONTAINER-${index}`,
    path: `C:/naimage/over-limit-${index}.png`
  }));
  pending.taskScope.sourceNodeIds = Array.from({ length: 201 }, (_item, index) => `GOAL-SOURCE-${index}`);
  pending.sourceNodeIds = [...pending.taskScope.sourceNodeIds];
  pending.taskScope.sourceContainerIds = Array.from({ length: 201 }, (_item, index) => `GOAL-CONTAINER-${index}`);
  pending.taskScope.sourceBindingIds = Array.from({ length: 201 }, (_item, index) => `binding:over-limit:${index}`);
  pending.taskScope.sourceAssetCount = 201;
  pending.taskScope.goal.containerIds = [...pending.taskScope.sourceContainerIds];
  pending.taskScope.goal.bindingIds = [...pending.taskScope.sourceBindingIds];
  pending.taskScope.goal.containerCount = 201;
  pending.taskScope.goal.bindingCount = 201;
}), null, "Goal persistence must reject rather than truncate a frozen boundary above 200 bindings");
const ordinaryPendingWithGoalMetadata = invalidGoalPending((pending) => {
  pending.taskOrigin = "chat";
  pending.taskScope.origin = "chat";
});
assert.ok(ordinaryPendingWithGoalMetadata);
assert.equal(ordinaryPendingWithGoalMetadata.taskScope.goal, undefined, "Non-Goal pending tasks must not retain Goal-only metadata");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 87 })}\n`);
