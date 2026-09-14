"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CONTEXT_STRATEGY_IDS,
  contextModelFamily,
  contextStrategyForSettings,
  normalizeContextStrategyId
} = require("../runtime/context-strategy.cjs");

assert.deepEqual(CONTEXT_STRATEGY_IDS, ["auto", "codex", "claude", "naimage-balanced", "custom"]);
assert.equal(normalizeContextStrategyId("unsupported"), "auto");
assert.equal(contextModelFamily("gpt-5.6-sol"), "codex");
assert.equal(contextModelFamily("claude-opus-4-7"), "claude");
assert.equal(contextModelFamily("deepseek-v3"), "balanced");

const codex = contextStrategyForSettings({ contextStrategy: "auto", agentModel: "gpt-5.6-sol" });
assert.equal(codex.resolvedId, "codex");
assert.equal(codex.contextWindowTokens, 272_000);
assert.equal(codex.effectiveWindowTokens, 258_400);
assert.equal(codex.autoCompactTokenLimit, 244_800);
assert.equal(codex.retainedUserTokens, 20_000);
assert.equal(codex.useResponsesProtocol, true);
assert.ok(codex.protocolHistoryPromptChars >= 700_000);
assert.equal(codex.protocolMessageMaxChars, 979_200);

const claude = contextStrategyForSettings({ contextStrategy: "auto", agentModel: "claude-sonnet-4" });
assert.equal(claude.resolvedId, "claude");
assert.equal(claude.contextWindowTokens, 200_000);
assert.equal(claude.useResponsesProtocol, false);
assert.equal(claude.protocolHistoryPromptChars, 0);
assert.equal(claude.protocolMessageMaxChars, 12_000);

const longClaude = contextStrategyForSettings({ contextStrategy: "claude", agentModel: "claude-opus-4-7" });
assert.equal(longClaude.contextWindowTokens, 1_000_000);

const custom = contextStrategyForSettings({
  contextStrategy: "custom",
  agentModel: "gpt-5.6-sol",
  contextWindowTokens: 300_000,
  contextEffectiveWindowPercent: 97,
  contextAutoCompactPercent: 92,
  contextRetainedUserTokens: 24_000
});
assert.equal(custom.contextWindowTokens, 300_000);
assert.equal(custom.effectiveWindowTokens, 291_000);
assert.equal(custom.autoCompactTokenLimit, 276_000);
assert.equal(custom.retainedUserTokens, 24_000);

const repaired = contextStrategyForSettings({
  contextStrategy: "custom",
  agentModel: "unknown",
  contextWindowTokens: 1,
  contextEffectiveWindowPercent: 200,
  contextAutoCompactPercent: 2,
  contextRetainedUserTokens: 999_999
});
assert.equal(repaired.contextWindowTokens, 8_000);
assert.equal(repaired.effectiveWindowPercent, 99);
assert.equal(repaired.autoCompactPercent, 50);
assert.equal(repaired.retainedUserTokens, 50_000);

const settingsDrawerSource = fs.readFileSync(path.join(__dirname, "..", "src", "settings-drawer.tsx"), "utf8");
const persistenceSource = fs.readFileSync(path.join(__dirname, "..", "src", "settings-persistence.ts"), "utf8");
assert.match(settingsDrawerSource, /data-settings-control="context-strategy"/);
assert.match(settingsDrawerSource, /value=\{draftSettings\.contextStrategy\}[\s\S]*CONTEXT_STRATEGY_OPTIONS\.map/);
assert.match(settingsDrawerSource, /draftSettings\.contextStrategy === "custom"/);
for (const field of ["contextWindowTokens", "contextEffectiveWindowPercent", "contextAutoCompactPercent", "contextRetainedUserTokens"]) {
  assert.match(settingsDrawerSource, new RegExp(`update\\("${field}"`), `Settings UI must edit ${field}`);
}
assert.match(persistenceSource, /\["auto", "codex", "claude", "naimage-balanced", "custom"\]/);

process.stdout.write(`${JSON.stringify({ ok: true, cases: 35 })}\n`);
