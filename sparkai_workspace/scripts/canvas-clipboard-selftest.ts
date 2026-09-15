import assert from "node:assert/strict";

import { clipboardImageFiles, copyCanvasNodes, pasteCanvasNodes } from "../src/canvas-clipboard.ts";
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

const clipboardFile = (name: string, type = "image/png") => ({
  name,
  type,
  size: 100,
  lastModified: 1,
}) as File;
const itemFiles = [clipboardFile("one.png"), clipboardFile("two.png"), clipboardFile("three.png")];
const mirroredFiles = itemFiles.map((file) => clipboardFile(file.name));
const mirroredClipboard = {
  items: itemFiles.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
  files: mirroredFiles,
} as unknown as Pick<DataTransfer, "items" | "files">;
assert.deepEqual(
  clipboardImageFiles(mirroredClipboard),
  itemFiles,
  "The same three images mirrored in items and files must be pasted exactly once",
);

const fallbackFiles = [clipboardFile("fallback-one.webp", "image/webp"), clipboardFile("fallback-two.jpg", "image/jpeg")];
const fallbackClipboard = {
  items: [{ kind: "file", type: "image/webp", getAsFile: () => null }],
  files: fallbackFiles,
} as unknown as Pick<DataTransfer, "items" | "files">;
assert.deepEqual(
  clipboardImageFiles(fallbackClipboard),
  fallbackFiles,
  "Files must remain the fallback when clipboard items cannot materialize every image",
);

console.log("canvas clipboard self-test passed");
