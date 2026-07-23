import assert from "node:assert/strict";

import { analyzeCanvasSelection } from "../src/canvas-commands.ts";
import { fileDragPayloadPresent, stableImageAssetId } from "../src/core.ts";
import type { WorkflowNode } from "../src/core.ts";
import type { ImageLayoutGroup } from "../src/image-layout.ts";

const image = (id: string, extra: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  title: id,
  prompt: id,
  type: "image",
  status: "done",
  x: 0,
  y: 0,
  createdAt: "now",
  assets: [{ index: 1, path: `${id}.png` }],
  ...extra,
});

const stablePathAsset = { path: "E:\\Project\\images\\product.png", index: 1 };
assert.equal(
  stableImageAssetId(stablePathAsset, 1),
  stableImageAssetId({ ...stablePathAsset, index: 9 }, 9),
  "A persisted local path must keep the same asset identity after container reordering",
);
assert.notEqual(
  stableImageAssetId({ runId: "run-a", index: 1 }, 1),
  stableImageAssetId({ runId: "run-a", index: 2 }, 2),
  "Different outputs in the same generation run must not collide",
);
assert.notEqual(
  stableImageAssetId({ url: "data:image/png;base64,same-pixels", index: 1 }, 1),
  stableImageAssetId({ url: "data:image/png;base64,same-pixels", index: 2 }, 2),
  "Repeated image payloads in one batch still need independent artifact identities",
);

const nodes: WorkflowNode[] = [
  image("A"),
  image("B"),
  image("C", { imageContainer: true, assets: [] }),
  image("BUSY", { status: "working", imageState: "generating", assets: [] }),
  image("L1", { layerGroup: { id: "layers-1", groupNumber: 1, order: 1, total: 2, role: "background", layerTitle: "背景", anchorX: 0, anchorY: 0, detached: false } }),
  image("L2", { layerGroup: { id: "layers-1", groupNumber: 1, order: 2, total: 2, role: "subject", layerTitle: "主体", anchorX: 0, anchorY: 0, detached: false } }),
];

const group: ImageLayoutGroup = {
  id: "container-1",
  hostNodeId: "A",
  memberNodeIds: ["A", "B"],
  origin: "manual",
  autoFit: true,
};

const ordinary = analyzeCanvasSelection(nodes, [], ["A", "B"], "A");
assert.deepEqual(ordinary.groupableNodeIds, ["A", "B"]);
assert.equal(ordinary.canGroupIntoContainer, true);
assert.deepEqual(ordinary.deleteNodeIds, ["A", "B"]);

const mixed = analyzeCanvasSelection(nodes, [], ["A", "L1", "L2"], "A");
assert.deepEqual(mixed.groupableNodeIds, ["A"]);
assert.deepEqual(mixed.groupExcluded.map((item) => item.reason), ["layer", "layer"]);
assert.deepEqual(mixed.deleteNodeIds, ["A", "L1", "L2"]);
assert.deepEqual(mixed.selectedLayerGroupIds, ["layers-1"]);
assert.deepEqual(mixed.layerGroupRepresentativeIds, ["L2"]);

const existingContainer = analyzeCanvasSelection(nodes, [group], ["A"], "A");
assert.deepEqual(existingContainer.selectedLayoutGroupIds, ["container-1"]);
assert.deepEqual(existingContainer.deleteNodeIds, ["A", "B"]);
assert.equal(existingContainer.canGroupIntoContainer, false);

const containerPlusLayer = analyzeCanvasSelection(nodes, [group], ["A", "L1"], "A");
assert.deepEqual(containerPlusLayer.groupableNodeIds, ["A", "B"]);
assert.equal(containerPlusLayer.canGroupIntoContainer, false);
assert.deepEqual(containerPlusLayer.groupExcluded, [{ nodeId: "L1", reason: "layer" }]);

const emptyTarget = analyzeCanvasSelection(nodes, [], ["C", "A"], "C");
assert.deepEqual(emptyTarget.groupableNodeIds, ["C", "A"]);
assert.equal(emptyTarget.preferredContainerHostId, "C");
assert.equal(emptyTarget.canGroupIntoContainer, true);

const busy = analyzeCanvasSelection(nodes, [], ["A", "BUSY"], "A");
assert.deepEqual(busy.deleteNodeIds, ["A"]);
assert.deepEqual(busy.deleteExcluded, [{ nodeId: "BUSY", reason: "busy" }]);

assert.equal(fileDragPayloadPresent(["Files"], [], 0), true, "Windows may expose only the Files transfer type during dragover");
assert.equal(fileDragPayloadPresent([], ["file"], 0), true);
assert.equal(fileDragPayloadPresent([], [], 1), true);
assert.equal(fileDragPayloadPresent(["text/plain"], ["string"], 0), false);

console.log(JSON.stringify({ ok: true, cases: 10 }));
