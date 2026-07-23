import type { ClipboardEvent } from "react";

import type { PasteBlock } from "./core.ts";

const PASTE_CHAR_LIMIT = 12000;
const PASTE_LINE_LIMIT = 220;

export function countTextLines(text: string) {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

export function isOversizedPaste(text: string) {
  return text.length > PASTE_CHAR_LIMIT || countTextLines(text) > PASTE_LINE_LIMIT;
}

export function shouldCreatePasteBlock(text: string) {
  return text.length > 160 || countTextLines(text) > 1 || isOversizedPaste(text);
}

export function pasteBlockSummary(block: PasteBlock) {
  return `Pasted ${countTextLines(block.text)} lines ${block.text.length} chars`;
}

export function clonePasteBlocks(blocks: PasteBlock[] = []) {
  return blocks.map((block) => ({
    id: block.id,
    text: block.text,
    createdAt: block.createdAt
  }));
}

export function pasteBlockMarkdown(block: PasteBlock, index: number) {
  return `[Pasted Block ${index + 1}: ${countTextLines(block.text)} lines, ${block.text.length} chars]`;
}

export function composePromptWithPasteBlocks(prompt: string, blocks: PasteBlock[]) {
  const base = String(prompt || "").trim();
  const pasteText = blocks
    .filter((block) => block.text.trim())
    .map((block, index) => [pasteBlockMarkdown(block, index), block.text.trim()].join("\n"))
    .join("\n\n");
  return [base, pasteText].filter(Boolean).join("\n\n").trim();
}

export function visiblePromptWithPasteBlocks(prompt: string, blocks: PasteBlock[]) {
  const base = String(prompt || "").trim();
  const summaries = blocks.filter((block) => block.text.trim()).map((block, index) => pasteBlockMarkdown(block, index));
  return [base, ...summaries].filter(Boolean).join("\n\n").trim();
}

export function clipboardHasImage(event: ClipboardEvent<HTMLElement>) {
  return Array.from(event.clipboardData.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}

export function blockImagePaste(event: ClipboardEvent<HTMLElement>) {
  if (clipboardHasImage(event)) {
    event.preventDefault();
  }
}
