"use strict";

// Model-aware context policy for the naimage Agent.
//
// The Codex preset follows the public openai/codex source contract:
// - model metadata owns the context window;
// - 95% is treated as the effective input window;
// - automatic compaction is capped at 90% of the model window;
// - compacted history retains recent user intent up to a token budget and
//   re-injects current world state in the new context window.

const CONTEXT_STRATEGY_IDS = Object.freeze(["auto", "codex", "claude", "naimage-balanced", "custom"]);
const DEFAULT_CODEX_CONTEXT_WINDOW_TOKENS = 272_000;
const DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_BALANCED_CONTEXT_WINDOW_TOKENS = 128_000;

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function normalizeContextStrategyId(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return CONTEXT_STRATEGY_IDS.includes(normalized) ? normalized : "auto";
}

function contextModelFamily(model = "") {
  const normalized = String(model || "").trim().toLowerCase();
  if (/claude|anthropic/.test(normalized)) return "claude";
  if (/(?:^|[-_.])(gpt|chatgpt|o[1-9]|codex)(?:[-_.]|$)/.test(normalized) || /openai/.test(normalized)) return "codex";
  return "balanced";
}

function claudeLongContextModel(model = "") {
  const normalized = String(model || "").trim().toLowerCase();
  return /(?:^|[-_.])1m(?:[-_.]|$)|sonnet[-_.]?5|opus[-_.]?4[._-]?(?:6|7|8)/.test(normalized);
}

function inferredContextWindowTokens(model, family) {
  if (family === "codex") return DEFAULT_CODEX_CONTEXT_WINDOW_TOKENS;
  if (family === "claude") return claudeLongContextModel(model) ? 1_000_000 : DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS;
  return DEFAULT_BALANCED_CONTEXT_WINDOW_TOKENS;
}

function presetForFamily(family) {
  if (family === "codex") {
    return {
      effectiveWindowPercent: 95,
      autoCompactPercent: 90,
      retainedUserTokens: 20_000,
      summaryMaxChars: 24_000,
      workbenchMaxChars: 24_000,
      workbenchRecentArtifacts: 48,
      taskScopeMaxChars: 18_000,
      fastMemoryPromptMaxChars: 32_000,
      plainHistoryMaxMessages: 120,
      protocolHistoryMaxTurns: 128,
      messageCountCompactLimit: 0
    };
  }
  if (family === "claude") {
    return {
      effectiveWindowPercent: 95,
      autoCompactPercent: 90,
      retainedUserTokens: 20_000,
      summaryMaxChars: 24_000,
      workbenchMaxChars: 24_000,
      workbenchRecentArtifacts: 48,
      taskScopeMaxChars: 18_000,
      fastMemoryPromptMaxChars: 32_000,
      plainHistoryMaxMessages: 120,
      protocolHistoryMaxTurns: 0,
      messageCountCompactLimit: 0
    };
  }
  return {
    effectiveWindowPercent: 90,
    autoCompactPercent: 82,
    retainedUserTokens: 12_000,
    summaryMaxChars: 18_000,
    workbenchMaxChars: 16_000,
    workbenchRecentArtifacts: 36,
    taskScopeMaxChars: 14_000,
    fastMemoryPromptMaxChars: 20_000,
    plainHistoryMaxMessages: 80,
    protocolHistoryMaxTurns: 0,
    messageCountCompactLimit: 80
  };
}

function contextStrategyForSettings(settings = {}) {
  const requestedId = normalizeContextStrategyId(settings.contextStrategy);
  const model = String(settings.agentModel || settings.model || "").trim();
  const detectedFamily = contextModelFamily(model);
  const family = requestedId === "codex"
    ? "codex"
    : requestedId === "claude"
      ? "claude"
      : requestedId === "naimage-balanced"
        ? "balanced"
        : requestedId === "custom"
          ? detectedFamily
          : detectedFamily;
  const preset = presetForFamily(family);
  const inferredWindow = inferredContextWindowTokens(model, family);
  const custom = requestedId === "custom";
  const contextWindowTokens = custom
    ? clampInteger(settings.contextWindowTokens, 8_000, 2_000_000, inferredWindow)
    : inferredWindow;
  const effectiveWindowPercent = custom
    ? clampInteger(settings.contextEffectiveWindowPercent, 50, 99, preset.effectiveWindowPercent)
    : preset.effectiveWindowPercent;
  const autoCompactPercent = custom
    ? clampInteger(settings.contextAutoCompactPercent, 50, Math.min(98, effectiveWindowPercent), Math.min(preset.autoCompactPercent, effectiveWindowPercent))
    : Math.min(preset.autoCompactPercent, effectiveWindowPercent);
  const retainedUserTokens = custom
    ? clampInteger(settings.contextRetainedUserTokens, 0, 50_000, preset.retainedUserTokens)
    : preset.retainedUserTokens;
  const effectiveWindowTokens = Math.floor(contextWindowTokens * effectiveWindowPercent / 100);
  const autoCompactTokenLimit = Math.min(
    effectiveWindowTokens,
    Math.floor(contextWindowTokens * autoCompactPercent / 100)
  );
  const dynamicProtocolPromptChars = Math.floor(autoCompactTokenLimit * 4 * 0.72);
  const protocolHistoryPromptChars = family === "codex"
    ? clampInteger(dynamicProtocolPromptChars, 180_000, 1_200_000, 700_000)
    : 0;
  const protocolMessageMaxChars = family === "codex"
    ? clampInteger(autoCompactTokenLimit * 4, 120_000, 1_200_000, 960_000)
    : 12_000;
  const useResponsesProtocol = family === "codex" && /^gpt-5\.(?:5|6)(?:[-.:]|$)/i.test(model);

  return Object.freeze({
    id: requestedId,
    resolvedId: requestedId === "auto" ? family === "balanced" ? "naimage-balanced" : family : requestedId,
    family,
    model,
    contextWindowTokens,
    effectiveWindowPercent,
    effectiveWindowTokens,
    autoCompactPercent,
    autoCompactTokenLimit,
    retainedUserTokens,
    summaryMaxChars: preset.summaryMaxChars,
    workbenchMaxChars: preset.workbenchMaxChars,
    workbenchRecentArtifacts: preset.workbenchRecentArtifacts,
    taskScopeMaxChars: preset.taskScopeMaxChars,
    fastMemoryPromptMaxChars: preset.fastMemoryPromptMaxChars,
    plainHistoryMaxMessages: preset.plainHistoryMaxMessages,
    protocolHistoryMaxTurns: preset.protocolHistoryMaxTurns,
    protocolHistoryPromptChars,
    protocolMessageMaxChars,
    protocolHistoryStoreChars: protocolHistoryPromptChars ? Math.min(1_500_000, Math.floor(protocolHistoryPromptChars * 1.3)) : 0,
    messageCountCompactLimit: preset.messageCountCompactLimit,
    useResponsesProtocol,
    useNativeWebSearch: useResponsesProtocol,
    compactionMode: family === "codex" ? "codex-checkpoint" : family === "claude" ? "claude-summary" : "balanced-summary"
  });
}

module.exports = {
  CONTEXT_STRATEGY_IDS,
  DEFAULT_BALANCED_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CODEX_CONTEXT_WINDOW_TOKENS,
  contextModelFamily,
  contextStrategyForSettings,
  inferredContextWindowTokens,
  normalizeContextStrategyId
};
