"use strict";

const assert = require("node:assert/strict");
const { mergeProjectSessions } = require("../desktop/project-session-merge.cjs");
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs");

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
const normalized = sanitizeSession(first.session);
assert.equal(normalized.nodes.find((item) => item.id === "C").persistenceOriginId, "renderer-b:B");
assert.equal(normalized.sessionRevision, 6);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 20 })}\n`);
