"use strict";

const assert = require("node:assert/strict");
const {
  parseToolPermissions,
  parseToolManifest,
  normalizeToolManifest,
  toolContentHash,
  sealToolManifest,
} = require("../runtime/tool-contract.cjs");

const checks = [];
function check(name, operation) {
  operation();
  checks.push(name);
  console.log(`ok ${checks.length} ${name}`);
}

const draft = {
  schemaVersion: 1,
  id: "tool.sparkvas.image-generation",
  name: "内置图片生成",
  description: "调用现有受管图片执行链，不把凭据暴露给 Recipe。",
  version: "1.0.0",
  minAppVersion: "1.0.9",
  license: "UNLICENSED",
  distribution: "builtin",
  adapter: "image-generation",
  inputSlots: [
    { portId: "source", label: "来源图片", dataType: "image", required: true },
    { portId: "prompt", label: "生成要求", dataType: "text", required: true },
  ],
  outputSlots: [{ portId: "result", label: "图片成果", dataType: "image" }],
  permissions: {
    network: ["public"],
    filesystem: ["managed-write", "managed-read"],
    process: ["none"],
    models: ["image-generation"],
    mcp: ["none"],
  },
  limitations: ["不接收任意脚本"],
  tags: ["builtin", "image"],
};

check("seals a Tool v1 manifest with normalized, sorted permissions", () => {
  const sealed = sealToolManifest(draft);
  assert.ok(sealed);
  assert.match(sealed.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(sealed.permissions.filesystem, ["managed-read", "managed-write"]);
  assert.deepEqual(normalizeToolManifest(sealed), sealed);
  assert.equal(toolContentHash(Object.fromEntries(Object.entries(sealed).reverse())), sealed.contentHash);
});

check("rejects third-party executable distributions and arbitrary adapters", () => {
  const executable = parseToolManifest({ ...draft, distribution: "third-party-executable" });
  assert.ok(executable.errors.some(error => error.code === "TOOL_DISTRIBUTION_INVALID"));
  const adapter = parseToolManifest({ ...draft, adapter: "arbitrary-script" });
  assert.ok(adapter.errors.some(error => error.code === "TOOL_ADAPTER_INVALID"));
  const controlled = sealToolManifest({ ...draft, distribution: "controlled-adapter", adapter: "mcp" });
  assert.ok(controlled);
  assert.equal(controlled.distribution, "controlled-adapter");
  assert.equal(controlled.adapter, "mcp");
  const entrypoint = parseToolManifest({ ...draft, entrypoint: "tools/run.exe" });
  assert.ok(entrypoint.errors.some(error => error.code === "TOOL_FIELD_UNKNOWN" && error.path === "$.entrypoint"));
});

check("requires every permission scope and rejects mixing none with capabilities", () => {
  const missing = parseToolPermissions({
    network: ["none"], filesystem: ["none"], process: ["none"], models: ["none"],
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(error => error.path === "$.permissions.mcp"));
  const mixed = parseToolPermissions({
    ...draft.permissions,
    process: ["none", "managed-runner"],
  });
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some(error => error.code === "TOOL_PERMISSION_NONE_MIXED"));
  const invalid = parseToolPermissions({ ...draft.permissions, network: ["C:\\private"] });
  assert.ok(invalid.errors.some(error => error.code === "TOOL_PERMISSION_VALUE_INVALID"));
});

check("rejects secret-shaped fields, paths and hash tampering", () => {
  const secret = parseToolManifest({ ...draft, apiKey: "sk-private" });
  assert.ok(secret.errors.some(error => error.code === "TOOL_FIELD_UNKNOWN" && error.path === "$.apiKey"));
  const path = parseToolManifest({ ...draft, description: "把结果写入 C:\\Users\\owner\\result" });
  assert.ok(path.errors.some(error => error.code === "TOOL_PUBLIC_VALUE_UNSAFE"));
  const sealed = sealToolManifest(draft);
  const tampered = { ...sealed, permissions: { ...sealed.permissions, network: ["public", "lan"] } };
  const parsed = parseToolManifest(tampered);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(error => error.code === "TOOL_HASH_MISMATCH"));
});

check("publishes no credentials, absolute paths or executable fields", () => {
  const sealed = sealToolManifest(draft);
  assert.ok(sealed);
  assert.deepEqual(Object.keys(sealed).sort(), [
    "adapter", "contentHash", "description", "distribution", "id", "inputSlots", "license",
    "limitations", "minAppVersion", "name", "outputSlots", "permissions", "schemaVersion", "tags", "version",
  ]);
  assert.doesNotMatch(JSON.stringify(sealed), /[A-Za-z]:\\\\|apiKey|entryId|cookie|bearer/i);
});

console.log(JSON.stringify({ ok: true, checks: checks.length, manifest: "ToolManifest v1", realModelRequests: 0 }));
