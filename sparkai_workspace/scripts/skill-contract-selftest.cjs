"use strict";

const assert = require("node:assert/strict");
const {
  parseSkillManifest,
  normalizeSkillManifest,
  skillContentHash,
  sealSkillManifest,
} = require("../runtime/skill-contract.cjs");

const checks = [];
function check(name, operation) {
  operation();
  checks.push(name);
  console.log(`ok ${checks.length} ${name}`);
}

const draft = {
  schemaVersion: 1,
  id: "skill.sparkvas.product-hero",
  name: "商品主图导演",
  description: "把商品主图转换为可审阅的跨境套图步骤。",
  version: "1.0.0",
  minAppVersion: "1.0.9",
  license: "CC-BY-4.0",
  instructions: "保留商品外形、材质和标识，只调整场景与光线。",
  inputSlots: [
    { slotId: "product", label: "商品母图", dataType: "image", required: true },
    { slotId: "brief", label: "创作说明", dataType: "brief", required: false },
  ],
  parameters: [
    { parameterId: "aspect", label: "画幅", type: "enum", required: true, values: ["1:1", "4:5"], defaultValue: "1:1" },
    { parameterId: "copy-length", label: "文案长度", type: "number", required: false, defaultValue: 120 },
  ],
  examples: [{ title: "香水方形主图" }],
  limitations: ["不改变商品结构"],
  tags: ["commerce", "beauty"],
};

check("seals a Skill v1 manifest and calculates a stable canonical hash", () => {
  const sealed = sealSkillManifest(draft);
  assert.ok(sealed);
  assert.match(sealed.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(normalizeSkillManifest(sealed), sealed);
  const reordered = Object.fromEntries(Object.entries(sealed).reverse());
  assert.equal(skillContentHash(reordered), sealed.contentHash);
});

check("rejects malformed Skill IDs, versions and schema versions", () => {
  assert.equal(normalizeSkillManifest({ ...draft, id: "tool.sparkvas.product-hero" }), undefined);
  assert.equal(normalizeSkillManifest({ ...draft, id: "skill.sparkvas.product-hero-" }), undefined);
  assert.equal(normalizeSkillManifest({ ...draft, version: "1.0" }), undefined);
  assert.equal(normalizeSkillManifest({ ...draft, version: "1.0.0-01" }), undefined);
  assert.equal(normalizeSkillManifest({ ...draft, minAppVersion: "next" }), undefined);
  assert.equal(normalizeSkillManifest({ ...draft, schemaVersion: 2 }), undefined);
});

check("rejects executable fields and credential-shaped public data", () => {
  const permissions = parseSkillManifest({ ...draft, permissions: { process: ["managed-runner"] } });
  assert.equal(permissions.ok, false);
  assert.ok(permissions.errors.some(error => error.code === "SKILL_FIELD_UNKNOWN" && error.path === "$.permissions"));
  const entrypoint = parseSkillManifest({ ...draft, entrypoint: "scripts/run.cjs" });
  assert.ok(entrypoint.errors.some(error => error.code === "SKILL_FIELD_UNKNOWN" && error.path === "$.entrypoint"));
  const path = parseSkillManifest({ ...draft, instructions: "读取 C:\\Users\\owner\\secret.png" });
  assert.ok(path.errors.some(error => error.code === "SKILL_PUBLIC_VALUE_UNSAFE"));
  const key = parseSkillManifest({ ...draft, config: { apiKey: "not-public" } });
  assert.ok(key.errors.some(error => error.code === "SKILL_FIELD_UNKNOWN"));
});

check("rejects duplicate slots and invalid parameter defaults", () => {
  const duplicate = parseSkillManifest({
    ...draft,
    inputSlots: [draft.inputSlots[0], draft.inputSlots[0]],
  });
  assert.ok(duplicate.errors.some(error => error.code === "SKILL_SLOT_DUPLICATE"));
  const parameter = parseSkillManifest({
    ...draft,
    parameters: [{ parameterId: "aspect", label: "画幅", type: "enum", required: true, values: ["1:1"], defaultValue: "16:9" }],
  });
  assert.ok(parameter.errors.some(error => error.code === "SKILL_PARAMETER_DEFAULT_INVALID"));
});

check("verifies a declared Skill content hash and rejects silent edits", () => {
  const sealed = sealSkillManifest(draft);
  const tampered = { ...sealed, instructions: `${sealed.instructions} 改为蓝色背景` };
  const parsed = parseSkillManifest(tampered);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(error => error.code === "SKILL_HASH_MISMATCH"));
  assert.notEqual(skillContentHash(tampered), sealed.contentHash);
  const unsigned = { ...draft };
  assert.equal(parseSkillManifest(unsigned).ok, false);
  assert.ok(parseSkillManifest(unsigned).errors.some(error => error.code === "SKILL_HASH_INVALID"));
});

check("normalizes optional lists and keeps public DTO fields path-free", () => {
  const sealed = sealSkillManifest({ ...draft, parameters: undefined, examples: undefined, limitations: undefined, tags: undefined });
  assert.ok(sealed);
  assert.deepEqual(sealed.parameters, []);
  assert.deepEqual(sealed.examples, []);
  assert.deepEqual(sealed.limitations, []);
  assert.deepEqual(sealed.tags, []);
  assert.doesNotMatch(JSON.stringify(sealed), /[A-Za-z]:\\\\|\/Users\/|apiKey|entryId/i);
});

console.log(JSON.stringify({ ok: true, checks: checks.length, manifest: "SkillManifest v1", realModelRequests: 0 }));
