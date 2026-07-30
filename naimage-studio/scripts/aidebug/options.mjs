import { join, resolve } from "node:path";

export function parseAidebugOptions(argv, env, context) {
  const { pid, runDir, repoRoot, cwd, now } = context;
  const rawArgs = argv.slice(2);
  const has = (option) => argv.includes(option);
  const find = (prefix) => argv.find((item) => item.startsWith(prefix));
  const firstValue = (item) => item?.split("=")[1];
  const fullValue = (item) => item?.split("=").slice(1).join("=");
  const resolveFromCwd = (value) => resolve(cwd, value);

  const devPortArg = find("--dev-port=");
  const explicitDevPort = firstValue(devPortArg) || env.NAIMAGE_AIDEBUG_DEV_PORT || "";
  const defaultDevPort = 5173 + (pid % 1000);
  const devPort = Number(explicitDevPort || defaultDevPort);
  const portArg = find("--port=");
  const defaultDebugPort = 9300 + (pid % 2000);
  const explicitDebugPort = firstValue(portArg) || env.NAIMAGE_REMOTE_DEBUGGING_PORT || "";
  const debugPort = Number(explicitDebugPort || defaultDebugPort);
  const keepOpen = has("--keep-open");
  const liveImage = has("--live-image") || env.NAIMAGE_AIDEBUG_LIVE_IMAGE === "1";
  const realAgentSuiteOnly = has("--real-agent-suite") || has("--agent-real-suite");
  const realAgentToolsOnly = has("--real-agent-tools-only") || has("--agent-tools-only");
  const agentUiPromptSuiteOnly = has("--agent-ui-prompt-suite") || has("--real-ui-prompt-suite");
  const realAgent = realAgentSuiteOnly || realAgentToolsOnly || agentUiPromptSuiteOnly || has("--real-agent") || env.NAIMAGE_AIDEBUG_REAL_AGENT === "1";
  const liveConfig = liveImage || realAgent || has("--live-config") || env.NAIMAGE_AIDEBUG_LIVE_CONFIG === "1";
  const mockAgent =
    has("--mock-agent") ||
    env.NAIMAGE_AIDEBUG_MOCK_AGENT === "1" ||
    (!realAgent && !liveImage);
  const agentOnly = has("--agent-only");
  const quickSmokeOnly = has("--quick-smoke") || has("--smoke");
  const legacyFullSuite = has("--legacy-full-suite");
  const imageOnly = has("--image-only") || has("--image-suite");
  const imageRecoveryOnly = has("--image-recovery-suite") || has("--image-failure-suite");
  const imageCollectionOnly = has("--image-collection-suite") || has("--canvas-image-suite");
  const layerStackOnly = has("--layer-stack-suite") || has("--layers-suite");
  const cutoutOnly = has("--cutout-suite") || has("--magic-cutout-suite");
  const regionRedrawOnly = has("--region-redraw-suite") || has("--redraw-suite");
  const mixedStressOnly = has("--mixed-stress") || has("--mixed-suite");
  const posterBatchOnly = has("--poster-batch") || has("--poster-suite");
  const contextPersistenceOnly = has("--context-persistence") || has("--persistence-suite");
  const imageCollectionPersistenceOnly = has("--image-collection-persistence") || has("--canvas-image-persistence");
  const authGateSuiteOnly = has("--auth-gate-suite") || has("--auth-suite");
  const uiSurfaceSuiteOnly = has("--ui-surface-suite") || has("--surface-suite");
  const performanceSuiteOnly = has("--performance-suite") || has("--perf-suite");
  const imageImportSuiteOnly = has("--image-import-suite") || has("--import-suite");
  const canvasClaritySuiteOnly = has("--canvas-clarity-suite") || has("--clarity-suite");
  const selectionCommandSuiteOnly = has("--selection-command-suite") || has("--selection-suite");
  const contextMenuSuiteOnly = has("--context-menu-suite") || has("--menu-suite");
  const requirementNodeSuiteOnly = has("--requirement-node-suite") || has("--requirement-suite");
  const skillNodeSuiteOnly = has("--skill-node-suite") || has("--skills-suite");
  const goalModeSuiteOnly = has("--goal-mode-suite") || has("--goal-suite");
  const askUserContinuationSuiteOnly = has("--ask-user-continuation-suite") || has("--ask-user-suite");
  const failureDiagnosticsSelfTestOnly = has("--failure-diagnostics-selftest");
  const imageRunsArg = find("--image-runs=");
  const imageRuns = Math.max(1, Math.min(Number(firstValue(imageRunsArg) || 2), 5));
  const posterCountArg = find("--poster-count=");
  const posterCount = Math.max(1, Math.min(Number(firstValue(posterCountArg) || 15), 30));
  const posterAgentCountArg = find("--poster-agent-count=");
  const posterAgentCount = Math.max(0, Math.min(Number(firstValue(posterAgentCountArg) || Math.min(10, posterCount)), 30));
  const posterDirectCountArg = find("--poster-direct-count=");
  const posterDirectCount = Math.max(0, Math.min(Number(firstValue(posterDirectCountArg) || Math.max(0, posterCount - posterAgentCount)), 30));
  const posterResolutionArg = find("--poster-resolution=");
  const posterResolution = String(fullValue(posterResolutionArg) || "1080P");
  const posterQualityArg = find("--poster-quality=");
  const posterQuality = String(fullValue(posterQualityArg) || "auto");
  const stressRoundsArg = find("--stress-rounds=");
  const stressRounds = Math.max(1, Math.min(Number(firstValue(stressRoundsArg) || 2), 5));
  const persistenceStageArg = find("--persistence-stage=");
  const persistenceStage = String(fullValue(persistenceStageArg) || "");
  const persistenceSentinelArg = find("--persistence-sentinel=");
  const persistenceSentinel = String(fullValue(persistenceSentinelArg) || `AIDEBUG_CONTEXT_PERSIST_${typeof now === "function" ? now() : now}`);
  const persistenceStateFileArg = find("--persistence-state-file=");
  const persistenceStateFile = fullValue(persistenceStateFileArg) || join(runDir, "context-persistence-state.json");
  const aidebugConfigDirArg = find("--aidebug-config-dir=");
  const aidebugConfigDir = resolveFromCwd(fullValue(aidebugConfigDirArg) || env.NAIMAGE_AIDEBUG_CONFIG_DIR || join(runDir, "config"));
  const nativeCaptureMode = has("--native-capture");
  const captureScope = nativeCaptureMode ? "window" : "page";
  const cyclesArg = find("--cycles=");
  const cycles = Math.max(1, Math.min(Number(firstValue(cyclesArg) || 1), 50));
  const cycleIndexArg = find("--cycle-index=");
  const cycleIndex = Math.max(1, Number(firstValue(cycleIndexArg) || 1));
  const cycleTotalArg = find("--cycle-total=");
  const cycleTotal = Math.max(cycleIndex, Math.min(Number(firstValue(cycleTotalArg) || cycles), 50));
  const cycleDelayArg = find("--cycle-delay-ms=");
  const cycleDelayMs = Math.max(0, Math.min(Number(firstValue(cycleDelayArg) || 1200), 60000));
  const desktopLogArg = find("--desktop-log=");
  const desktopLogPath = fullValue(desktopLogArg) || join(repoRoot, ".diagnostics", "aidebug-history.md");
  const agentUiPromptArg = find("--agent-ui-prompt=");
  const agentUiPrompt = String(
    env.NAIMAGE_AIDEBUG_AGENT_UI_PROMPT ||
    fullValue(agentUiPromptArg) ||
    "帮我生成一张二次元写实风格竖屏小红书东方审美黑长直，极具设计感、艺术感、微海报；\n  二次元风格但也需要写实，不要太写实，公主切近景。"
  );
  const agentUiFollowupArg = find("--agent-ui-followup=");
  const agentUiFollowupPrompt = String(
    env.NAIMAGE_AIDEBUG_AGENT_UI_FOLLOWUP ||
    fullValue(agentUiFollowupArg) ||
    "这张效果很好，优点是满足要求，具备设计感，很棒。没什么缺点，我需要你继续生成3张"
  );
  const agentUiReferencesArg = find("--agent-ui-references=");
  const agentUiReferencePaths = (() => {
    const raw = String(
      env.NAIMAGE_AIDEBUG_AGENT_UI_REFERENCES ||
      fullValue(agentUiReferencesArg) ||
      ""
    ).trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => resolveFromCwd(String(item || ""))).filter(Boolean).slice(0, 9);
    } catch {
      // A pipe-delimited fallback stays convenient for simple CLI invocations.
    }
    return raw.split("|").map((item) => resolveFromCwd(item.trim())).filter(Boolean).slice(0, 9);
  })();
  const agentUiSingleOnly = has("--agent-ui-single") || env.NAIMAGE_AIDEBUG_AGENT_UI_SINGLE === "1";
  const agentUiExpectedCountArg = find("--agent-ui-expected-count=");
  const agentUiExpectedCount = Math.max(1, Math.min(Number(firstValue(agentUiExpectedCountArg) || 1), 10));
  const agentUiExpectedReviewCountArg = find("--agent-ui-expected-review-count=");
  const agentUiExpectedReviewCount = Math.max(1, Math.min(Number(firstValue(agentUiExpectedReviewCountArg) || 1), 10));

  return {
    rawArgs,
    explicitDevPort,
    defaultDevPort,
    devPort,
    explicitDebugPort,
    defaultDebugPort,
    debugPort,
    keepOpen,
    liveImage,
    realAgentSuiteOnly,
    realAgentToolsOnly,
    agentUiPromptSuiteOnly,
    realAgent,
    liveConfig,
    mockAgent,
    agentOnly,
    quickSmokeOnly,
    legacyFullSuite,
    imageOnly,
    imageRecoveryOnly,
    imageCollectionOnly,
    layerStackOnly,
    cutoutOnly,
    regionRedrawOnly,
    mixedStressOnly,
    posterBatchOnly,
    contextPersistenceOnly,
    imageCollectionPersistenceOnly,
    authGateSuiteOnly,
    uiSurfaceSuiteOnly,
    performanceSuiteOnly,
    imageImportSuiteOnly,
    canvasClaritySuiteOnly,
    selectionCommandSuiteOnly,
    contextMenuSuiteOnly,
    requirementNodeSuiteOnly,
    skillNodeSuiteOnly,
    goalModeSuiteOnly,
    askUserContinuationSuiteOnly,
    failureDiagnosticsSelfTestOnly,
    imageRuns,
    posterCount,
    posterAgentCount,
    posterDirectCount,
    posterResolution,
    posterQuality,
    stressRounds,
    persistenceStage,
    persistenceSentinel,
    persistenceStateFile,
    aidebugConfigDir,
    nativeCaptureMode,
    captureScope,
    cycles,
    cycleIndex,
    cycleTotal,
    cycleDelayMs,
    desktopLogPath,
    agentUiPrompt,
    agentUiFollowupPrompt,
    agentUiReferencePaths,
    agentUiSingleOnly,
    agentUiExpectedCount,
    agentUiExpectedReviewCount
  };
}
