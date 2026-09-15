import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { sanitizeCanvasSkill, type WorkflowNode } from "../src/core.ts";

const require = createRequire(import.meta.url);
const {
  CanvasSkillImportError,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_INSTRUCTIONS_LENGTH,
  MAX_SKILL_MARKDOWN_BYTES,
  MAX_SKILL_NAME_LENGTH,
  canvasSkillContentFingerprint,
  parseCanvasSkillMarkdown,
  readSkillMarkdownFile
} = require("../desktop/skill-import.cjs") as {
  CanvasSkillImportError: new (code: string, message: string) => Error & { code: string };
  MAX_SKILL_DESCRIPTION_LENGTH: number;
  MAX_SKILL_INSTRUCTIONS_LENGTH: number;
  MAX_SKILL_MARKDOWN_BYTES: number;
  MAX_SKILL_NAME_LENGTH: number;
  canvasSkillContentFingerprint(markdown: string): string;
  parseCanvasSkillMarkdown(markdown: unknown, options?: { sourceName?: unknown; importedAt?: string }): import("../src/core.ts").ImportedCanvasSkill;
  readSkillMarkdownFile(filePath: string): { ok: boolean; sourceName?: string; markdown?: string; byteLength?: number; errorCode?: string };
};
const { sanitizeSession } = require("../desktop/project-session-normalizer.cjs") as {
  sanitizeSession(session: unknown): { nodes: WorkflowNode[] };
};

function expectImportError(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => error instanceof CanvasSkillImportError && error.code === code);
}

const markdown = `---
name: product-photo
description: >
  Keep the product identity
  while improving presentation.
metadata:
  owner: studio
---

# Product photo

Keep labels legible and preserve the original product shape.`;
const importedAt = "2026-07-29T09:30:00.000Z";
const skill = parseCanvasSkillMarkdown(markdown, { sourceName: "C:\\private\\client-a\\SKILL.md", importedAt });
assert.equal(skill.name, "product-photo");
assert.equal(skill.description, "Keep the product identity while improving presentation.");
assert.match(skill.instructions, /^# Product photo/);
assert.equal(skill.sourceName, "SKILL.md");
assert.match(skill.contentFingerprint, /^skill-[a-f0-9]{32}$/);
assert.deepEqual(sanitizeCanvasSkill(skill), {
  version: 1,
  name: skill.name,
  description: skill.description,
  sourceName: skill.sourceName,
  contentFingerprint: skill.contentFingerprint,
  importedAt
});

const crlfMarkdown = markdown.replace(/\n/g, "\r\n");
assert.equal(canvasSkillContentFingerprint(crlfMarkdown), skill.contentFingerprint, "line endings cannot change Skill identity");

expectImportError(() => parseCanvasSkillMarkdown("# no frontmatter"), "SKILL_FRONTMATTER_MISSING");
expectImportError(() => parseCanvasSkillMarkdown("---\nname: unfinished"), "SKILL_FRONTMATTER_UNCLOSED");
expectImportError(() => parseCanvasSkillMarkdown("---\nname: quoted\ndescription: \"unterminated\n---\n\nbody"), "SKILL_FRONTMATTER_INVALID");
expectImportError(() => parseCanvasSkillMarkdown('---\nname: broken\ndescription: "unterminated\n---\n\nbody'), "SKILL_FRONTMATTER_INVALID");
expectImportError(() => parseCanvasSkillMarkdown("---\nname: broken\ndescription: 'unterminated\n---\n\nbody"), "SKILL_FRONTMATTER_INVALID");
expectImportError(() => parseCanvasSkillMarkdown("---\ndescription: missing name\n---\n\nbody"), "SKILL_NAME_MISSING");
expectImportError(() => parseCanvasSkillMarkdown("---\nname: empty-body\n---\n"), "SKILL_INSTRUCTIONS_EMPTY");
expectImportError(() => parseCanvasSkillMarkdown(`---\nname: ${"n".repeat(MAX_SKILL_NAME_LENGTH + 1)}\n---\n\nbody`), "SKILL_NAME_TOO_LONG");
expectImportError(() => parseCanvasSkillMarkdown(`---\nname: description-limit\ndescription: ${"d".repeat(MAX_SKILL_DESCRIPTION_LENGTH + 1)}\n---\n\nbody`), "SKILL_DESCRIPTION_TOO_LONG");
expectImportError(() => parseCanvasSkillMarkdown(`---\nname: instruction-limit\n---\n\n${"i".repeat(MAX_SKILL_INSTRUCTIONS_LENGTH + 1)}`), "SKILL_INSTRUCTIONS_TOO_LONG");
expectImportError(() => parseCanvasSkillMarkdown(`---\nname: nul\n---\n\nbody\u0000`), "SKILL_MARKDOWN_INVALID");
expectImportError(() => parseCanvasSkillMarkdown("x".repeat(MAX_SKILL_MARKDOWN_BYTES + 1)), "SKILL_MARKDOWN_TOO_LARGE");

const fileFixtureRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-skill-import-"));
try {
  const nestedRoot = path.join(fileFixtureRoot, "private", "client-a");
  const skillPath = path.join(nestedRoot, "SKILL.md");
  const emptyPath = path.join(fileFixtureRoot, "empty.md");
  const largePath = path.join(fileFixtureRoot, "large.md");
  const invalidUtf8Path = path.join(fileFixtureRoot, "invalid.md");
  mkdirSync(nestedRoot, { recursive: true });
  writeFileSync(skillPath, markdown, "utf8");
  writeFileSync(emptyPath, "", "utf8");
  writeFileSync(largePath, Buffer.alloc(MAX_SKILL_MARKDOWN_BYTES + 1, 0x61));
  writeFileSync(invalidUtf8Path, Buffer.from([0xc3, 0x28]));
  const fileRead = readSkillMarkdownFile(skillPath);
  assert.equal(fileRead.ok, true);
  assert.equal(fileRead.sourceName, "SKILL.md");
  assert.equal(fileRead.markdown, markdown);
  assert.equal("path" in fileRead, false, "Main must not return an absolute Skill path to Renderer");
  assert.equal(readSkillMarkdownFile(emptyPath).errorCode, "SKILL_MARKDOWN_EMPTY");
  assert.equal(readSkillMarkdownFile(largePath).errorCode, "SKILL_MARKDOWN_TOO_LARGE");
  assert.equal(readSkillMarkdownFile(invalidUtf8Path).errorCode, "SKILL_MARKDOWN_READ_FAILED");
} finally {
  rmSync(fileFixtureRoot, { recursive: true, force: true });
}

const sourceNode: WorkflowNode = {
  id: "SOURCE",
  displayCode: "SOURCE",
  title: "source",
  prompt: "",
  type: "image",
  status: "done",
  x: 0,
  y: 0,
  branch: "test",
  outputs: 0,
  createdAt: importedAt,
  assets: [],
  imageState: "empty"
};
const skillNode: WorkflowNode = {
  id: "SKILL",
  displayCode: "SKILL",
  title: `Skill · ${skill.name}`,
  prompt: skill.instructions,
  type: "requirement",
  status: "done",
  x: 320,
  y: 0,
  parentId: sourceNode.id,
  relationType: "referenced",
  branch: "project-agent",
  outputs: 0,
  createdAt: importedAt,
  requirement: {
    version: 2,
    text: skill.instructions,
    revision: 1,
    createdFrom: "canvas",
    inputBindings: [{ nodeId: sourceNode.id, role: "source" }],
    skill: {
      version: 1,
      name: skill.name,
      description: skill.description,
      sourceName: skill.sourceName,
      contentFingerprint: skill.contentFingerprint,
      importedAt: skill.importedAt
    }
  }
};
const firstLoad = sanitizeSession({ schemaVersion: 5, nodes: [sourceNode, skillNode], messages: [], conversations: [] });
const persistedSkillNode = firstLoad.nodes.find((node) => node.id === skillNode.id);
assert.equal(persistedSkillNode?.requirement?.version, 2);
assert.equal(persistedSkillNode?.requirement?.createdFrom, "canvas");
assert.deepEqual(persistedSkillNode?.requirement?.inputBindings, [{ nodeId: sourceNode.id, role: "source" }]);
assert.equal(persistedSkillNode?.requirement?.text, skill.instructions);
assert.deepEqual(persistedSkillNode?.requirement?.skill, skillNode.requirement?.skill);

const secondLoad = sanitizeSession(JSON.parse(JSON.stringify(firstLoad)));
const reloadedSkillNode = secondLoad.nodes.find((node) => node.id === skillNode.id);
assert.equal(reloadedSkillNode?.requirement?.text, skill.instructions, "Skill instructions must survive save/reload without truncation");
assert.equal(reloadedSkillNode?.requirement?.skill?.contentFingerprint, skill.contentFingerprint, "Skill identity must survive save/reload");
assert.equal(reloadedSkillNode?.requirement?.skill?.sourceName, "SKILL.md", "absolute source paths must not survive save/reload");

const untrustedPathMetadata = sanitizeCanvasSkill({
  ...skill,
  sourceName: "/private/customer/SKILL.md"
});
assert.equal(untrustedPathMetadata?.sourceName, "SKILL.md", "persisted metadata sanitization must keep only the file label");

const locallyModifiedAt = "2026-07-29T10:45:00.000Z";
const locallyModifiedMetadata = sanitizeCanvasSkill({ ...skill, locallyModifiedAt });
assert.equal(locallyModifiedMetadata?.contentFingerprint, skill.contentFingerprint,
  "Local edits must preserve the imported content fingerprint as source identity");
assert.equal(locallyModifiedMetadata?.locallyModifiedAt, locallyModifiedAt);
const locallyModifiedLoad = sanitizeSession({
  nodes: [{
    ...skillNode,
    requirement: {
      ...skillNode.requirement!,
      text: `${skill.instructions}\n\nLocal constraint.`,
      revision: 2,
      skill: locallyModifiedMetadata,
    },
  }],
});
assert.equal(locallyModifiedLoad.nodes[0]?.requirement?.skill?.locallyModifiedAt, locallyModifiedAt,
  "The locally-modified conflict marker must survive session persistence");
assert.equal(locallyModifiedLoad.nodes[0]?.requirement?.skill?.contentFingerprint, skill.contentFingerprint);

const invalidMetadataLoad = sanitizeSession({
  nodes: [{
    ...skillNode,
    id: "INVALID-SKILL",
    requirement: { ...skillNode.requirement!, skill: { ...skillNode.requirement!.skill!, contentFingerprint: "not-valid" } }
  }]
});
assert.equal(invalidMetadataLoad.nodes[0]?.requirement?.skill, undefined, "invalid Skill metadata must be removed without deleting the requirement");

console.log(JSON.stringify({
  ok: true,
  parserBounds: true,
  nestedFrontmatterCompatible: true,
  stableFingerprint: true,
  boundedMainFileRead: true,
  sessionRoundTrip: true,
  locallyModifiedIdentityRoundTrip: true,
  requirementExecutionPathPreserved: true
}));
