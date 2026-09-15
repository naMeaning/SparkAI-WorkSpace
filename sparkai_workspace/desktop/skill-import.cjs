"use strict";

const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const MAX_SKILL_MARKDOWN_BYTES = 256 * 1024;
const MAX_SKILL_NAME_LENGTH = 120;
const MAX_SKILL_DESCRIPTION_LENGTH = 2_000;
const MAX_SKILL_INSTRUCTIONS_LENGTH = 24_000;

class CanvasSkillImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanvasSkillImportError";
    this.code = code;
  }
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function cleanText(value, maximum) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, maximum)
    : "";
}

function fileLabel(value) {
  const normalized = cleanText(value, 1_000).replace(/\\/g, "/");
  return cleanText(normalized.split("/").pop(), 180) || "SKILL.md";
}

function decodeQuotedScalar(value) {
  const source = value.trim();
  const doubleQuoted = source.startsWith('"') || source.endsWith('"');
  const singleQuoted = source.startsWith("'") || source.endsWith("'");
  if ((doubleQuoted && !(source.length >= 2 && source.startsWith('"') && source.endsWith('"'))) ||
      (singleQuoted && !(source.length >= 2 && source.startsWith("'") && source.endsWith("'")))) {
    throw new CanvasSkillImportError("SKILL_FRONTMATTER_INVALID", "SKILL.md frontmatter contains an unterminated quoted value.");
  }
  if (source.length < 2) return source;
  if (doubleQuoted) {
    try {
      const parsed = JSON.parse(source);
      return typeof parsed === "string" ? parsed : source.slice(1, -1);
    } catch {
      throw new CanvasSkillImportError("SKILL_FRONTMATTER_INVALID", "SKILL.md frontmatter contains an invalid quoted value.");
    }
  }
  if (singleQuoted) return source.slice(1, -1).replace(/''/g, "'");
  return source.replace(/\s+#.*$/, "").trim();
}

function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new CanvasSkillImportError("SKILL_FRONTMATTER_MISSING", "SKILL.md must start with YAML frontmatter delimited by ---.");
  }
  const closeIndex = normalized.indexOf("\n---\n", 4);
  if (closeIndex < 0) {
    throw new CanvasSkillImportError("SKILL_FRONTMATTER_UNCLOSED", "SKILL.md frontmatter is missing its closing --- delimiter.");
  }
  const header = normalized.slice(4, closeIndex);
  const body = normalized.slice(closeIndex + 5).trim();
  const values = new Map();
  const lines = header.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\s+/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      throw new CanvasSkillImportError("SKILL_FRONTMATTER_INVALID", `SKILL.md frontmatter line ${index + 1} is not a supported key/value field.`);
    }
    const key = match[1].toLowerCase();
    let rawValue = match[2];
    if (/^[|>][+-]?$/.test(rawValue)) {
      const folded = rawValue.startsWith(">");
      const block = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || !lines[index + 1].trim())) {
        index += 1;
        block.push(lines[index].replace(/^\s{1,4}/, ""));
      }
      rawValue = folded ? block.join(" ").replace(/\s+/g, " ") : block.join("\n");
    }
    if (!values.has(key)) values.set(key, decodeQuotedScalar(rawValue));
  }
  return { body, values };
}

function fnv1a64(value, offset) {
  let hash = offset;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function canvasSkillContentFingerprint(markdown) {
  const canonical = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  return `skill-${fnv1a64(canonical, 0xcbf29ce484222325n)}${fnv1a64(`naimage\n${canonical}`, 0x84222325cbf29cen)}`;
}

function parseCanvasSkillMarkdown(markdownValue, options = {}) {
  if (typeof markdownValue !== "string" || !markdownValue.trim()) {
    throw new CanvasSkillImportError("SKILL_MARKDOWN_EMPTY", "SKILL.md content is empty.");
  }
  if (utf8ByteLength(markdownValue) > MAX_SKILL_MARKDOWN_BYTES) {
    throw new CanvasSkillImportError("SKILL_MARKDOWN_TOO_LARGE", `SKILL.md exceeds the ${MAX_SKILL_MARKDOWN_BYTES} byte import limit.`);
  }
  if (markdownValue.includes("\u0000")) {
    throw new CanvasSkillImportError("SKILL_MARKDOWN_INVALID", "SKILL.md contains unsupported NUL bytes.");
  }
  const { body, values } = parseFrontmatter(markdownValue);
  const rawName = typeof values.get("name") === "string" ? values.get("name").replace(/\u0000/g, "").trim() : "";
  const rawDescription = typeof values.get("description") === "string" ? values.get("description").replace(/\u0000/g, "").trim() : "";
  const rawInstructions = body.replace(/\u0000/g, "").trim();
  if (rawName.length > MAX_SKILL_NAME_LENGTH) {
    throw new CanvasSkillImportError("SKILL_NAME_TOO_LONG", `Skill name exceeds ${MAX_SKILL_NAME_LENGTH} characters.`);
  }
  if (rawDescription.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new CanvasSkillImportError("SKILL_DESCRIPTION_TOO_LONG", `Skill description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters.`);
  }
  if (rawInstructions.length > MAX_SKILL_INSTRUCTIONS_LENGTH) {
    throw new CanvasSkillImportError("SKILL_INSTRUCTIONS_TOO_LONG", `Skill instructions exceed ${MAX_SKILL_INSTRUCTIONS_LENGTH} characters.`);
  }
  if (!rawName) throw new CanvasSkillImportError("SKILL_NAME_MISSING", "SKILL.md frontmatter must include a non-empty name.");
  if (!rawInstructions) throw new CanvasSkillImportError("SKILL_INSTRUCTIONS_EMPTY", "SKILL.md must include instructions after the frontmatter.");
  return {
    version: 1,
    name: rawName,
    ...(rawDescription ? { description: rawDescription } : {}),
    sourceName: fileLabel(options.sourceName),
    contentFingerprint: canvasSkillContentFingerprint(markdownValue),
    importedAt: options.importedAt || new Date().toISOString(),
    instructions: rawInstructions
  };
}

function readSkillMarkdownFile(sourceFile) {
  const sourceName = path.basename(String(sourceFile || "")).slice(0, 180) || "SKILL.md";
  try {
    const size = statSync(sourceFile).size;
    if (!Number.isSafeInteger(size) || size <= 0) {
      return { ok: false, errorCode: "SKILL_MARKDOWN_EMPTY", error: "所选 SKILL.md 是空文件。" };
    }
    if (size > MAX_SKILL_MARKDOWN_BYTES) {
      return { ok: false, errorCode: "SKILL_MARKDOWN_TOO_LARGE", error: `SKILL.md 超过 ${MAX_SKILL_MARKDOWN_BYTES} 字节导入上限。` };
    }
    const buffer = readFileSync(sourceFile);
    if (buffer.byteLength > MAX_SKILL_MARKDOWN_BYTES) {
      return { ok: false, errorCode: "SKILL_MARKDOWN_TOO_LARGE", error: `SKILL.md 超过 ${MAX_SKILL_MARKDOWN_BYTES} 字节导入上限。` };
    }
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { ok: true, sourceName, markdown, byteLength: buffer.byteLength };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errorCode: "SKILL_MARKDOWN_READ_FAILED", error: `无法读取 SKILL.md：${message}` };
  }
}

function parseSkillResult(markdown, sourceName) {
  try {
    return { ok: true, skill: parseCanvasSkillMarkdown(markdown, { sourceName }) };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof CanvasSkillImportError ? error.code : "SKILL_MARKDOWN_INVALID",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

module.exports = {
  CanvasSkillImportError,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_INSTRUCTIONS_LENGTH,
  MAX_SKILL_MARKDOWN_BYTES,
  MAX_SKILL_NAME_LENGTH,
  canvasSkillContentFingerprint,
  parseCanvasSkillMarkdown,
  parseSkillResult,
  readSkillMarkdownFile
};
