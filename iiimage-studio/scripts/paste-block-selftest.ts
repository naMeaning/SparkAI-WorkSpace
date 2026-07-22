import assert from "node:assert/strict";

import {
  blockImagePaste,
  clonePasteBlocks,
  composePromptWithPasteBlocks,
  countTextLines,
  isOversizedPaste,
  shouldCreatePasteBlock,
  visiblePromptWithPasteBlocks
} from "../src/paste-blocks.ts";

assert.equal(countTextLines(""), 0);
assert.equal(countTextLines("one\ntwo\r\nthree"), 3);
assert.equal(shouldCreatePasteBlock("short"), false);
assert.equal(shouldCreatePasteBlock("line one\nline two"), true);
assert.equal(isOversizedPaste("x".repeat(12001)), true);

const source = [{ id: "paste-1", text: "alpha\nbeta", createdAt: 123 }];
const cloned = clonePasteBlocks(source);
assert.deepEqual(cloned, source);
assert.notEqual(cloned, source);
assert.notEqual(cloned[0], source[0]);

assert.equal(
  composePromptWithPasteBlocks("Task", source),
  "Task\n\n[Pasted Block 1: 2 lines, 10 chars]\nalpha\nbeta"
);
assert.equal(
  visiblePromptWithPasteBlocks("Task", source),
  "Task\n\n[Pasted Block 1: 2 lines, 10 chars]"
);

let prevented = false;
blockImagePaste({
  clipboardData: {
    items: [{ kind: "file", type: "image/png" }]
  },
  preventDefault() {
    prevented = true;
  }
} as never);
assert.equal(prevented, true);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 12 })}\n`);
