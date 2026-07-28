import assert from "node:assert/strict";

import { copyCanvasNodes, pasteCanvasNodes } from "../src/canvas-clipboard.ts";
import type { WorkflowNode } from "../src/core.ts";

const image = (id: string, x: number, parentId?: string): WorkflowNode => ({
  id,
  displayCode: id,
  title: id,
  prompt: `${id} prompt`,
  type: "image",
  status: "working",
  imageState: "generating",
  generationRunId: `run-${id}`,
  x,
  y: x,
  parentId,
  relationType: parentId ? "derived-from" : undefined,
  createdAt: "now",
  assets: [{ index: 1, path: `${id}.png`, runId: `run-${id}` }],
});

const requirement: WorkflowNode = {
  id: "R",
  title: "需求",
  prompt: "批量处理",
  type: "requirement",
  status: "done",
  x: 300,
  y: 100,
  createdAt: "now",
  parentId: "A",
  relationType: "referenced",
  requirement: {
    version: 2,
    text: "批量处理",
    revision: 1,
    createdFrom: "canvas",
    inputBindings: [
      { nodeId: "A", role: "source" },
      { nodeId: "OUTSIDE", role: "reference" },
    ],
    lastRunCount: 2,
    lastSourceSignature: "old",
  },
};

const payload = copyCanvasNodes([image("A", 10), image("B", 80, "A"), requirement], ["A", "B", "R"]);
assert.ok(payload);
let sequence = 0;
const result = pasteCanvasNodes(payload, [], () => `N${++sequence}`, { x: 500, y: 600 });
assert.deepEqual(result.pastedNodeIds, ["N1", "N2", "N3"]);
assert.equal(result.pastedNodes[1].parentId, "N1");
assert.equal(result.pastedNodes[0].generationRunId, undefined);
assert.equal(result.pastedNodes[0].imageState, "done");
assert.equal(result.pastedNodes[0].assets?.[0].runId, undefined);
assert.equal(result.pastedNodes[0].x, 500);
assert.equal(result.pastedNodes[0].y, 600);
assert.deepEqual(result.pastedNodes[2].requirement?.inputBindings, [{ nodeId: "N1", role: "source" }]);
assert.equal(result.pastedNodes[2].requirement?.lastRunCount, undefined);

console.log("canvas clipboard self-test passed");
