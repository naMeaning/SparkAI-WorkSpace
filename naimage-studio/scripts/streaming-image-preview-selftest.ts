import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  groupStreamingImagePreviewsByNode,
  upsertStreamingImagePreviewState
} from "../src/streaming-image-preview.ts";
import type { AgentProgress, WorkflowNode } from "../src/core.ts";

const dataUrl = `data:image/png;base64,${Buffer.from("preview").toString("base64")}`;
const firstProgress: AgentProgress = {
  runId: "parent-1-child-1",
  phase: "image-preview",
  tool: "image_gen",
  partialImage: { dataUrl, index: 1, total: 3, requestIndex: 1 }
};
const secondProgress: AgentProgress = {
  ...firstProgress,
  runId: "parent-1-child-2",
  partialImage: { dataUrl, index: 2, total: 3, requestIndex: 2 }
};

let previews = upsertStreamingImagePreviewState({}, firstProgress, "parent-1");
previews = upsertStreamingImagePreviewState(previews, secondProgress, "parent-1");
assert.equal(Object.keys(previews).length, 2, "Parallel preview slots must not overwrite one another");
assert.deepEqual(Object.values(previews).map((preview) => preview.requestIndex), [1, 2]);

const updated = upsertStreamingImagePreviewState(previews, {
  ...firstProgress,
  partialImage: { dataUrl: `${dataUrl}AA`, index: 3, total: 3, requestIndex: 1 }
}, "parent-1");
assert.equal(Object.keys(updated).length, 2);
assert.equal(updated["parent-1:1"].index, 3);

const unchanged = upsertStreamingImagePreviewState(updated, {
  ...firstProgress,
  partialImage: { dataUrl: "https://example.com/not-allowed.png", index: 1, total: 3, requestIndex: 1 }
}, "parent-1");
assert.equal(unchanged, updated, "Only bounded data-image previews may enter Renderer state");

const nodes = [
  { id: "mapped", type: "image", generationRunId: "another-run" },
  { id: "fallback", type: "image", generationRunId: "parent-1" }
] as WorkflowNode[];
const explicitlyMapped = groupStreamingImagePreviewsByNode(updated, nodes, { "parent-1": "mapped" });
assert.equal(explicitlyMapped.mapped.length, 2);
assert.equal(explicitlyMapped.fallback, undefined);
const fallbackMapped = groupStreamingImagePreviewsByNode(updated, nodes, {});
assert.equal(fallbackMapped.fallback.length, 2, "Generation run prefixes must recover local manual preview ownership");

const root = path.resolve(import.meta.dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "src", "styles", "02-canvas-workspace.css"), "utf8");
const serverIpcSource = fs.readFileSync(path.join(root, "desktop", "ipc", "server-ipc.cjs"), "utf8");
const runtimeSource = fs.readFileSync(path.join(root, "agent-runtime.cjs"), "utf8");
const agentTraceSource = fs.readFileSync(path.join(root, "src", "agent.ts"), "utf8");
const agentWindowRendererSource = fs.readFileSync(path.join(root, "agent-window-renderer.js"), "utf8");

assert.match(mainSource, /className="node-image-pending-tile stream-preview-tile"/, "Streaming previews must render inside image slots");
assert.doesNotMatch(mainSource, /image-stream-preview/, "Renderer must not create a separate floating preview node");
assert.match(cssSource, /\.node-image-pending-tile\.stream-preview-tile/, "Container preview slots must own their styling");
assert.doesNotMatch(cssSource, /\.flow-node\.image-stream-preview/, "Obsolete floating preview styling must be removed");
assert.match(serverIpcSource, /onPartialImage:\s*\(partial\)\s*=>\s*emitAgentProgress/, "Manual image IPC must forward partial images");
assert.match(mainSource, /operationId:\s*generationRunId,[\s\S]{0,80}requestIndex:\s*index \+ 1/, "Manual parallel requests must preserve parent operation and slot index");
assert.match(runtimeSource, /requestIndex:\s*Math\.max\(1, Math\.min\(10, Math\.floor\(Number\(args\.partialRequestIndex\) \|\| index \+ 1\)\)\)/, "Agent parallel previews must use one-based request indexes");
assert.match(runtimeSource, /partialRequestIndex:\s*index \+ 1,[\s\S]{0,80}runId:\s*`\$\{groupId\}-\$\{index \+ 1\}-\$\{layer\.id\}`/, "Layer partials must preserve their own container slot");
assert.doesNotMatch(agentTraceSource, /partialImageFromProgress/, "Intermediate images must not be copied into Agent timeline messages");
assert.doesNotMatch(agentWindowRendererSource, /tool-preview|trace\.partialImage/, "Agent windows must not render intermediate images outside the canvas container");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 17 })}\n`);
