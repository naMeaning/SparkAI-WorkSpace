import assert from "node:assert/strict";

import {
  collectNodeMutationEvents,
  normalizeNodeMutationBarriers as compactNodeMutationBarriers,
  compactNodeMutationJournal,
  normalizeNodeMutationWriterCheckpoints as compactNodeMutationWriterCheckpoints,
  updateNodeMutationWriterCheckpoint
} from "../desktop/project-session-merge.cjs";
import type { WorkflowNode } from "../src/core.ts";

function node(id: string, origin: string, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    persistenceOriginId: origin,
    title: id,
    prompt: "prompt",
    type: "image",
    status: "done",
    x: 10,
    y: 20,
    branch: "basic",
    outputs: 0,
    createdAt: "now",
    assets: [],
    imageState: "empty",
    ...extra
  };
}

const unchanged = collectNodeMutationEvents({
  nodes: [node("A", "origin:A")],
  baselineNodes: [node("A", "origin:A")],
  journal: [],
  writerId: "renderer-a",
  nextWriterSequence: 0,
  baseRevision: 4,
  now: () => "2026-07-29T00:00:00.000Z"
});
assert.equal(unchanged.events.length, 0);

const changed = collectNodeMutationEvents({
  nodes: [node("A", "origin:A", { x: 99 }), node("B", "origin:B")],
  baselineNodes: [node("A", "origin:A"), node("C", "origin:C")],
  journal: [],
  writerId: "renderer-a",
  nextWriterSequence: 10,
  baseRevision: 4,
  now: () => "2026-07-29T00:00:00.000Z"
});
assert.deepEqual(changed.events.map((event) => [event.kind, event.nodeOriginId]), [
  ["upsert", "origin:A"],
  ["upsert", "origin:B"],
  ["delete", "origin:C"]
]);
assert.equal(changed.nextWriterSequence, 13);
assert.ok(changed.events.every((event) => event.baseRevision === 4));
assert.deepEqual(changed.events.find((event) => event.nodeOriginId === "origin:A")?.fields, ["x"]);
assert.deepEqual(changed.events.find((event) => event.nodeOriginId === "origin:B")?.fields, ["*"]);

const perFieldCompaction = compactNodeMutationJournal([
  { ...changed.events[0], eventId: "renderer-a:field-x", writerSequence: 20, fields: ["x"] },
  { ...changed.events[0], eventId: "renderer-a:field-y", writerSequence: 21, fields: ["y"] }
]);
assert.deepEqual(perFieldCompaction.map((event) => event.eventId), ["renderer-a:field-x", "renderer-a:field-y"]);

const compacted = compactNodeMutationJournal([
  ...changed.journal,
  {
    ...changed.events[0],
    eventId: "renderer-a:14",
    writerSequence: 14,
    nodeOriginId: "origin:A",
    kind: "delete"
  },
  {
    ...changed.events[0],
    eventId: "renderer-a:15",
    writerSequence: 15,
    nodeOriginId: "origin:A",
    kind: "upsert"
  }
]);
assert.equal(compacted.filter((event) => event.nodeOriginId === "origin:A").length, 1);
assert.equal(compacted.find((event) => event.nodeOriginId === "origin:A")?.kind, "delete");

const deletion = compacted.find((event) => event.nodeOriginId === "origin:A");
assert.ok(deletion);
const restored = collectNodeMutationEvents({
  nodes: [node("A", "origin:A")],
  baselineNodes: [],
  journal: [{ ...deletion, commitRevision: 20 }],
  writerId: "renderer-a",
  nextWriterSequence: 20,
  baseRevision: 20,
  now: () => "2026-07-29T00:01:00.000Z"
});
assert.equal(restored.events[0].kind, "restore");
assert.equal(restored.events[0].restoresEventId, deletion.eventId);
assert.deepEqual(restored.journal.map((event) => event.kind).sort(), ["delete", "restore"]);

const checkpoints = compactNodeMutationWriterCheckpoints([
  { version: 1, writerId: "renderer-a", writerSequence: 2, observedRevision: 7, lastSeenAt: "2026-07-29T00:00:00.000Z" },
  { version: 1, writerId: "renderer-a", writerSequence: 3, observedRevision: 6, lastSeenAt: "2026-07-29T00:01:00.000Z" },
  { version: 1, writerId: "renderer-b", writerSequence: 1, observedRevision: 5, lastSeenAt: "2026-07-29T00:00:30.000Z" }
]);
assert.equal(checkpoints.length, 2);
assert.equal(checkpoints[0].writerSequence, 3);
assert.equal(checkpoints[0].observedRevision, 7);
assert.equal(updateNodeMutationWriterCheckpoint(checkpoints, {
  writerId: "renderer-b",
  writerSequence: 4,
  observedRevision: 8,
  lastSeenAt: "2026-07-29T00:02:00.000Z"
})[1].observedRevision, 8);

const deleteBarrier = compactNodeMutationBarriers([{
  version: 1,
  nodeOriginId: "origin:gc",
  nodeId: "G",
  eventId: "renderer-a:delete-gc",
  kind: "delete",
  commitRevision: 20,
  createdAt: "2026-07-29T00:03:00.000Z"
}]);
const restoredFromBarrier = collectNodeMutationEvents({
  nodes: [node("G", "origin:gc")],
  baselineNodes: [],
  journal: [],
  barriers: deleteBarrier,
  writerId: "renderer-a",
  nextWriterSequence: 30,
  baseRevision: 20,
  now: () => "2026-07-29T00:04:00.000Z"
});
assert.equal(restoredFromBarrier.events[0].kind, "restore");
assert.equal(restoredFromBarrier.events[0].restoresEventId, "renderer-a:delete-gc");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 22 })}\n`);
