import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAidebugOptions } from "./aidebug/options.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const cwd = join(packageRoot, ".diagnostics", "aidebug-options-cwd");
const context = Object.freeze({
  pid: 1234,
  runDir: join(packageRoot, ".diagnostics", "electron", "aidebug-options-run"),
  repoRoot: packageRoot,
  cwd,
  now: 1_700_000_000_123
});

function parse(args = [], env = {}, contextOverrides = {}) {
  return parseAidebugOptions(
    ["node", join(packageRoot, "scripts", "aidebug-gui.mjs"), ...args],
    env,
    { ...context, ...contextOverrides }
  );
}

const defaults = parse();
assert.deepEqual(Object.keys(defaults).sort(), [
  "rawArgs",
  "explicitDevPort",
  "defaultDevPort",
  "devPort",
  "explicitDebugPort",
  "defaultDebugPort",
  "debugPort",
  "keepOpen",
  "liveImage",
  "realAgentSuiteOnly",
  "realAgentToolsOnly",
  "agentUiPromptSuiteOnly",
  "realAgent",
  "liveConfig",
  "mockAgent",
  "agentOnly",
  "legacyFullSuite",
  "imageOnly",
  "imageRecoveryOnly",
  "imageCollectionOnly",
  "layerStackOnly",
  "cutoutOnly",
  "regionRedrawOnly",
  "mixedStressOnly",
  "posterBatchOnly",
  "contextPersistenceOnly",
  "imageCollectionPersistenceOnly",
  "authGateSuiteOnly",
  "uiSurfaceSuiteOnly",
  "performanceSuiteOnly",
  "imageImportSuiteOnly",
  "canvasClaritySuiteOnly",
  "selectionCommandSuiteOnly",
  "contextMenuSuiteOnly",
  "requirementNodeSuiteOnly",
  "askUserContinuationSuiteOnly",
  "failureDiagnosticsSelfTestOnly",
  "imageRuns",
  "posterCount",
  "posterAgentCount",
  "posterDirectCount",
  "posterResolution",
  "posterQuality",
  "stressRounds",
  "persistenceStage",
  "persistenceSentinel",
  "persistenceStateFile",
  "aidebugConfigDir",
  "nativeCaptureMode",
  "captureScope",
  "cycles",
  "cycleIndex",
  "cycleTotal",
  "cycleDelayMs",
  "desktopLogPath",
  "agentUiPrompt",
  "agentUiFollowupPrompt",
  "agentUiReferencePaths",
  "agentUiSingleOnly",
  "agentUiExpectedCount",
  "agentUiExpectedReviewCount"
].sort());
assert.deepEqual({
  rawArgs: defaults.rawArgs,
  explicitDevPort: defaults.explicitDevPort,
  defaultDevPort: defaults.defaultDevPort,
  devPort: defaults.devPort,
  explicitDebugPort: defaults.explicitDebugPort,
  defaultDebugPort: defaults.defaultDebugPort,
  debugPort: defaults.debugPort,
  keepOpen: defaults.keepOpen,
  liveImage: defaults.liveImage,
  realAgent: defaults.realAgent,
  liveConfig: defaults.liveConfig,
  mockAgent: defaults.mockAgent,
  imageRuns: defaults.imageRuns,
  posterCount: defaults.posterCount,
  posterAgentCount: defaults.posterAgentCount,
  posterDirectCount: defaults.posterDirectCount,
  posterResolution: defaults.posterResolution,
  posterQuality: defaults.posterQuality,
  stressRounds: defaults.stressRounds,
  persistenceStage: defaults.persistenceStage,
  persistenceSentinel: defaults.persistenceSentinel,
  persistenceStateFile: defaults.persistenceStateFile,
  aidebugConfigDir: defaults.aidebugConfigDir,
  captureScope: defaults.captureScope,
  cycles: defaults.cycles,
  cycleIndex: defaults.cycleIndex,
  cycleTotal: defaults.cycleTotal,
  cycleDelayMs: defaults.cycleDelayMs,
  desktopLogPath: defaults.desktopLogPath,
  agentUiReferencePaths: defaults.agentUiReferencePaths,
  agentUiExpectedCount: defaults.agentUiExpectedCount,
  agentUiExpectedReviewCount: defaults.agentUiExpectedReviewCount
}, {
  rawArgs: [],
  explicitDevPort: "",
  defaultDevPort: 5407,
  devPort: 5407,
  explicitDebugPort: "",
  defaultDebugPort: 10534,
  debugPort: 10534,
  keepOpen: false,
  liveImage: false,
  realAgent: false,
  liveConfig: false,
  mockAgent: true,
  imageRuns: 2,
  posterCount: 15,
  posterAgentCount: 10,
  posterDirectCount: 5,
  posterResolution: "1080P",
  posterQuality: "auto",
  stressRounds: 2,
  persistenceStage: "",
  persistenceSentinel: "AIDEBUG_CONTEXT_PERSIST_1700000000123",
  persistenceStateFile: join(context.runDir, "context-persistence-state.json"),
  aidebugConfigDir: join(context.runDir, "config"),
  captureScope: "page",
  cycles: 1,
  cycleIndex: 1,
  cycleTotal: 1,
  cycleDelayMs: 1200,
  desktopLogPath: join(packageRoot, ".diagnostics", "aidebug-history.md"),
  agentUiReferencePaths: [],
  agentUiExpectedCount: 1,
  agentUiExpectedReviewCount: 1
});
assert.equal(defaults.agentUiPrompt, "帮我生成一张二次元写实风格竖屏小红书东方审美黑长直，极具设计感、艺术感、微海报；\n  二次元风格但也需要写实，不要太写实，公主切近景。");
assert.equal(defaults.agentUiFollowupPrompt, "这张效果很好，优点是满足要求，具备设计感，很棒。没什么缺点，我需要你继续生成3张");

const aliasGroups = [
  ["realAgentSuiteOnly", ["--real-agent-suite", "--agent-real-suite"]],
  ["realAgentToolsOnly", ["--real-agent-tools-only", "--agent-tools-only"]],
  ["agentUiPromptSuiteOnly", ["--agent-ui-prompt-suite", "--real-ui-prompt-suite"]],
  ["imageOnly", ["--image-only", "--image-suite"]],
  ["imageRecoveryOnly", ["--image-recovery-suite", "--image-failure-suite"]],
  ["imageCollectionOnly", ["--image-collection-suite", "--canvas-image-suite"]],
  ["layerStackOnly", ["--layer-stack-suite", "--layers-suite"]],
  ["cutoutOnly", ["--cutout-suite", "--magic-cutout-suite"]],
  ["regionRedrawOnly", ["--region-redraw-suite", "--redraw-suite"]],
  ["mixedStressOnly", ["--mixed-stress", "--mixed-suite"]],
  ["posterBatchOnly", ["--poster-batch", "--poster-suite"]],
  ["contextPersistenceOnly", ["--context-persistence", "--persistence-suite"]],
  ["imageCollectionPersistenceOnly", ["--image-collection-persistence", "--canvas-image-persistence"]],
  ["authGateSuiteOnly", ["--auth-gate-suite", "--auth-suite"]],
  ["uiSurfaceSuiteOnly", ["--ui-surface-suite", "--surface-suite"]],
  ["performanceSuiteOnly", ["--performance-suite", "--perf-suite"]],
  ["imageImportSuiteOnly", ["--image-import-suite", "--import-suite"]],
  ["canvasClaritySuiteOnly", ["--canvas-clarity-suite", "--clarity-suite"]],
  ["selectionCommandSuiteOnly", ["--selection-command-suite", "--selection-suite"]],
  ["contextMenuSuiteOnly", ["--context-menu-suite", "--menu-suite"]],
  ["requirementNodeSuiteOnly", ["--requirement-node-suite", "--requirement-suite"]],
  ["askUserContinuationSuiteOnly", ["--ask-user-continuation-suite", "--ask-user-suite"]]
];
for (const [field, aliases] of aliasGroups) {
  assert.equal(defaults[field], false, `${field} default`);
  for (const alias of aliases) assert.equal(parse([alias])[field], true, `${alias} -> ${field}`);
}

const directFlags = parse([
  "--keep-open",
  "--live-image",
  "--real-agent",
  "--live-config",
  "--mock-agent",
  "--agent-only",
  "--legacy-full-suite",
  "--failure-diagnostics-selftest",
  "--native-capture",
  "--agent-ui-single"
]);
for (const field of ["keepOpen", "liveImage", "realAgent", "liveConfig", "mockAgent", "agentOnly", "legacyFullSuite", "failureDiagnosticsSelfTestOnly", "nativeCaptureMode", "agentUiSingleOnly"]) {
  assert.equal(directFlags[field], true, field);
}
assert.equal(directFlags.captureScope, "window");
assert.equal(parse(["--live-image"]).mockAgent, false);
assert.equal(parse(["--real-agent"]).mockAgent, false);
const toolsOnly = parse(["--agent-tools-only"]);
assert.equal(toolsOnly.realAgentToolsOnly, true);
assert.equal(toolsOnly.realAgent, true);
assert.equal(toolsOnly.realAgentSuiteOnly, false);
const combinedSelectors = parse(["--image-suite", "--layers-suite"]);
assert.equal(combinedSelectors.imageOnly, true);
assert.equal(combinedSelectors.layerStackOnly, true);

const envOptions = parse([], {
  IIIMAGE_AIDEBUG_DEV_PORT: "6211",
  IIIMAGE_REMOTE_DEBUGGING_PORT: "9411",
  IIIMAGE_AIDEBUG_LIVE_IMAGE: "1",
  IIIMAGE_AIDEBUG_REAL_AGENT: "1",
  IIIMAGE_AIDEBUG_LIVE_CONFIG: "1",
  IIIMAGE_AIDEBUG_MOCK_AGENT: "1",
  IIIMAGE_AIDEBUG_CONFIG_DIR: "env-config",
  IIIMAGE_AIDEBUG_AGENT_UI_PROMPT: "env prompt",
  IIIMAGE_AIDEBUG_AGENT_UI_FOLLOWUP: "env followup",
  IIIMAGE_AIDEBUG_AGENT_UI_REFERENCES: "env-a.png|env-b.png",
  IIIMAGE_AIDEBUG_AGENT_UI_SINGLE: "1"
});
assert.deepEqual({
  explicitDevPort: envOptions.explicitDevPort,
  devPort: envOptions.devPort,
  explicitDebugPort: envOptions.explicitDebugPort,
  debugPort: envOptions.debugPort,
  liveImage: envOptions.liveImage,
  realAgent: envOptions.realAgent,
  liveConfig: envOptions.liveConfig,
  mockAgent: envOptions.mockAgent,
  aidebugConfigDir: envOptions.aidebugConfigDir,
  agentUiPrompt: envOptions.agentUiPrompt,
  agentUiFollowupPrompt: envOptions.agentUiFollowupPrompt,
  agentUiReferencePaths: envOptions.agentUiReferencePaths,
  agentUiSingleOnly: envOptions.agentUiSingleOnly
}, {
  explicitDevPort: "6211",
  devPort: 6211,
  explicitDebugPort: "9411",
  debugPort: 9411,
  liveImage: true,
  realAgent: true,
  liveConfig: true,
  mockAgent: true,
  aidebugConfigDir: resolve(cwd, "env-config"),
  agentUiPrompt: "env prompt",
  agentUiFollowupPrompt: "env followup",
  agentUiReferencePaths: [resolve(cwd, "env-a.png"), resolve(cwd, "env-b.png")],
  agentUiSingleOnly: true
});

const mixedPrecedence = parse([
  "--dev-port=6222",
  "--port=9422",
  "--aidebug-config-dir=cli-config",
  "--agent-ui-prompt=cli prompt",
  "--agent-ui-followup=cli followup",
  "--agent-ui-references=cli.png"
], {
  IIIMAGE_AIDEBUG_DEV_PORT: "6333",
  IIIMAGE_REMOTE_DEBUGGING_PORT: "9533",
  IIIMAGE_AIDEBUG_CONFIG_DIR: "env-config",
  IIIMAGE_AIDEBUG_AGENT_UI_PROMPT: "env prompt",
  IIIMAGE_AIDEBUG_AGENT_UI_FOLLOWUP: "env followup",
  IIIMAGE_AIDEBUG_AGENT_UI_REFERENCES: "env.png"
});
assert.equal(mixedPrecedence.devPort, 6222);
assert.equal(mixedPrecedence.debugPort, 9422);
assert.equal(mixedPrecedence.aidebugConfigDir, resolve(cwd, "cli-config"));
assert.equal(mixedPrecedence.agentUiPrompt, "env prompt");
assert.equal(mixedPrecedence.agentUiFollowupPrompt, "env followup");
assert.deepEqual(mixedPrecedence.agentUiReferencePaths, [resolve(cwd, "env.png")]);
assert.equal(parse(["--dev-port=", "--port="], { IIIMAGE_AIDEBUG_DEV_PORT: "6444", IIIMAGE_REMOTE_DEBUGGING_PORT: "9644" }).devPort, 6444);
assert.equal(parse(["--dev-port=", "--port="], { IIIMAGE_AIDEBUG_DEV_PORT: "6444", IIIMAGE_REMOTE_DEBUGGING_PORT: "9644" }).debugPort, 9644);

const bounded = parse([
  "--image-runs=99",
  "--poster-count=99",
  "--poster-agent-count=-1",
  "--poster-direct-count=99",
  "--stress-rounds=0",
  "--cycles=99",
  "--cycle-index=99",
  "--cycle-total=-1",
  "--cycle-delay-ms=-1",
  "--agent-ui-expected-count=99",
  "--agent-ui-expected-review-count=0"
]);
assert.deepEqual({
  imageRuns: bounded.imageRuns,
  posterCount: bounded.posterCount,
  posterAgentCount: bounded.posterAgentCount,
  posterDirectCount: bounded.posterDirectCount,
  stressRounds: bounded.stressRounds,
  cycles: bounded.cycles,
  cycleIndex: bounded.cycleIndex,
  cycleTotal: bounded.cycleTotal,
  cycleDelayMs: bounded.cycleDelayMs,
  agentUiExpectedCount: bounded.agentUiExpectedCount,
  agentUiExpectedReviewCount: bounded.agentUiExpectedReviewCount
}, {
  imageRuns: 5,
  posterCount: 30,
  posterAgentCount: 0,
  posterDirectCount: 30,
  stressRounds: 1,
  cycles: 50,
  cycleIndex: 99,
  cycleTotal: 99,
  cycleDelayMs: 0,
  agentUiExpectedCount: 10,
  agentUiExpectedReviewCount: 1
});
const dependentPosterDefaults = parse(["--poster-count=3"]);
assert.equal(dependentPosterDefaults.posterAgentCount, 3);
assert.equal(dependentPosterDefaults.posterDirectCount, 0);
const infiniteNumbers = parse(["--image-runs=Infinity", "--cycles=Infinity", "--cycle-delay-ms=Infinity"]);
assert.equal(infiniteNumbers.imageRuns, 5);
assert.equal(infiniteNumbers.cycles, 50);
assert.equal(infiniteNumbers.cycleDelayMs, 60000);
const emptyNumbers = parse(["--image-runs=", "--cycles=", "--cycle-delay-ms="]);
assert.equal(emptyNumbers.imageRuns, 2);
assert.equal(emptyNumbers.cycles, 1);
assert.equal(emptyNumbers.cycleDelayMs, 1200);

const invalidNumbers = parse([
  "--dev-port=nope",
  "--port=nope",
  "--image-runs=nope",
  "--poster-count=nope",
  "--poster-agent-count=nope",
  "--poster-direct-count=nope",
  "--stress-rounds=nope",
  "--cycles=nope",
  "--cycle-index=nope",
  "--cycle-total=nope",
  "--cycle-delay-ms=nope",
  "--agent-ui-expected-count=nope",
  "--agent-ui-expected-review-count=nope"
]);
for (const field of ["devPort", "debugPort", "imageRuns", "posterCount", "posterAgentCount", "posterDirectCount", "stressRounds", "cycles", "cycleIndex", "cycleTotal", "cycleDelayMs", "agentUiExpectedCount", "agentUiExpectedReviewCount"]) {
  assert.equal(Number.isNaN(invalidNumbers[field]), true, `${field} keeps NaN semantics`);
}

const equalsValues = parse([
  "--dev-port=6200=ignored",
  "--port=9400=ignored",
  "--poster-resolution=1080=P",
  "--poster-quality=high=detail",
  "--persistence-stage=write=again",
  "--persistence-sentinel=sentinel=value",
  "--persistence-state-file=state=name.json",
  "--aidebug-config-dir=config=name",
  "--desktop-log=history=name.md",
  "--agent-ui-prompt=prompt=value",
  "--agent-ui-followup=followup=value",
  `--agent-ui-references=${JSON.stringify(["reference=name.png"])}`
]);
assert.equal(equalsValues.explicitDevPort, "6200");
assert.equal(equalsValues.devPort, 6200);
assert.equal(equalsValues.explicitDebugPort, "9400");
assert.equal(equalsValues.debugPort, 9400);
assert.equal(equalsValues.posterResolution, "1080=P");
assert.equal(equalsValues.posterQuality, "high=detail");
assert.equal(equalsValues.persistenceStage, "write=again");
assert.equal(equalsValues.persistenceSentinel, "sentinel=value");
assert.equal(equalsValues.persistenceStateFile, "state=name.json");
assert.equal(equalsValues.aidebugConfigDir, resolve(cwd, "config=name"));
assert.equal(equalsValues.desktopLogPath, "history=name.md");
assert.equal(equalsValues.agentUiPrompt, "prompt=value");
assert.equal(equalsValues.agentUiFollowupPrompt, "followup=value");
assert.deepEqual(equalsValues.agentUiReferencePaths, [resolve(cwd, "reference=name.png")]);

const jsonReferences = parse([`--agent-ui-references=${JSON.stringify(["one.png", "", null, 0, false, "six.png", "seven.png", "eight.png", "nine.png", "ten.png"])}`]);
assert.equal(jsonReferences.agentUiReferencePaths.length, 9);
assert.deepEqual(jsonReferences.agentUiReferencePaths.slice(0, 6), [
  resolve(cwd, "one.png"),
  cwd,
  cwd,
  cwd,
  cwd,
  resolve(cwd, "six.png")
]);
const pipeReferences = parse(["--agent-ui-references=one.png| two.png |"]);
assert.deepEqual(pipeReferences.agentUiReferencePaths, [resolve(cwd, "one.png"), resolve(cwd, "two.png"), cwd]);

const customPaths = parse([
  "--persistence-state-file=relative-state.json",
  "--aidebug-config-dir=relative-config",
  "--desktop-log=relative-history.md",
  "--persistence-sentinel=custom-sentinel"
]);
assert.equal(customPaths.persistenceStateFile, "relative-state.json");
assert.equal(customPaths.aidebugConfigDir, resolve(cwd, "relative-config"));
assert.equal(customPaths.desktopLogPath, "relative-history.md");
assert.equal(customPaths.persistenceSentinel, "custom-sentinel");

let lazyNowCalls = 0;
const lazyNow = () => {
  lazyNowCalls += 1;
  return 1_800_000_000_456;
};
assert.equal(
  parse(["--persistence-sentinel=explicit-sentinel"], {}, { now: lazyNow }).persistenceSentinel,
  "explicit-sentinel"
);
assert.equal(lazyNowCalls, 0, "Explicit persistence sentinel must not read the clock");
assert.equal(
  parse([], {}, { now: lazyNow }).persistenceSentinel,
  "AIDEBUG_CONTEXT_PERSIST_1800000000456"
);
assert.equal(lazyNowCalls, 1, "Default persistence sentinel reads the injected clock once");

const firstMatchWins = parse([
  "--dev-port=6111",
  "--dev-port=6222",
  "--poster-quality=first",
  "--poster-quality=second",
  "--agent-ui-prompt=first prompt",
  "--agent-ui-prompt=second prompt"
]);
assert.equal(firstMatchWins.devPort, 6111);
assert.equal(firstMatchWins.posterQuality, "first");
assert.equal(firstMatchWins.agentUiPrompt, "first prompt");

const argv = ["node", "aidebug-gui.mjs", "--unknown=value", "--keep-open", "--unknown=value", "--persistence-sentinel=snapshot"];
const snapshotted = parseAidebugOptions(argv, {}, context);
argv.push("--agent-only");
assert.deepEqual(snapshotted.rawArgs, ["--unknown=value", "--keep-open", "--unknown=value", "--persistence-sentinel=snapshot"]);
assert.equal(snapshotted.agentOnly, false);
assert.equal(parseAidebugOptions(["--keep-open", "aidebug-gui.mjs"], {}, context).keepOpen, true, "parser receives complete argv");

const optionsSource = readFileSync(join(packageRoot, "scripts", "aidebug", "options.mjs"), "utf8");
const mainSource = readFileSync(join(packageRoot, "scripts", "aidebug-gui.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.equal(/process\.(?:argv|env|pid|cwd)/.test(optionsSource), false, "pure options owner must not read process state");
assert.equal(/Date\.now\(\)/.test(optionsSource), false, "pure options owner must use injected now");
assert.equal((mainSource.match(/process\.argv/g) || []).length, 1, "main reads argv only at parser call");
assert.equal(mainSource.includes("parseAidebugOptions(process.argv, process.env"), true);
assert.equal(mainSource.includes("let { devPort, debugPort } = aidebugOptions;"), true);
assert.equal((mainSource.match(/const passThroughArgs = rawArgs/g) || []).length, 3, "all supervisors use the argv snapshot");
assert.equal(mainSource.includes("process.argv.slice"), false);
assert.equal(mainSource.includes("function selectSuite"), false);
assert.equal(packageJson.scripts["test:aidebug-options"], "node scripts/aidebug-options-selftest.mjs");

console.log(JSON.stringify({
  ok: true,
  aliasesChecked: aliasGroups.reduce((total, [, aliases]) => total + aliases.length, 0),
  optionFields: Object.keys(defaults).length,
  sourceBoundary: "pure parser + one argv read + three rawArgs supervisors"
}, null, 2));
