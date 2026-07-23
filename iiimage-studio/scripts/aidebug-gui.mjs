import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import sharp from "sharp";

import { captureAskUserContinuationSuite } from "./aidebug-ask-user-continuation-suite.mjs";
import { captureRequirementNodeSuite } from "./aidebug-requirement-node-suite.mjs";
import { createImageGenerationSuiteProbes } from "./aidebug/suites/image-generation.mjs";
import { createLayerEditingSuiteProbes } from "./aidebug/suites/layer-editing.mjs";
import { capturePerformanceSuiteProbe } from "./aidebug/suites/performance.mjs";
import { captureSelectionCommandSuite } from "./aidebug/suites/selection-command.mjs";
import { captureUiSurfaceSuite } from "./aidebug/suites/ui-surface.mjs";
import {
  createRuntimeEvaluator,
  DiagnosticCdpClient,
  pollForDebugTarget,
  waitForRuntimeExpression
} from "./aidebug/harness/cdp.mjs";
import { decodePng } from "./aidebug/harness/png.mjs";
import { createGuiStateReader } from "./aidebug/harness/state-snapshot.mjs";
import {
  forceKillProcessTree,
  isPortAvailable as portIsAvailable,
  pipeProcessLogs,
  waitForChildExit,
  waitForHttpServer
} from "./aidebug/harness/process.mjs";
import { capturePngScreenshot } from "./aidebug/harness/screenshot.mjs";

const isWindows = process.platform === "win32";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = packageRoot;
const diagnosticsRoot = join(repoRoot, ".diagnostics", "electron");
const runDir = join(diagnosticsRoot, `aidebug-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const workbenchMinWidth = 884;
const devPortArg = process.argv.find((item) => item.startsWith("--dev-port="));
const explicitDevPort = devPortArg?.split("=")[1] || process.env.IIIMAGE_AIDEBUG_DEV_PORT || "";
const defaultDevPort = 5173 + (process.pid % 1000);
let devPort = Number(explicitDevPort || defaultDevPort);
let devUrl = `http://127.0.0.1:${devPort}`;
const portArg = process.argv.find((item) => item.startsWith("--port="));
const defaultDebugPort = 9300 + (process.pid % 2000);
const explicitDebugPort = portArg?.split("=")[1] || process.env.IIIMAGE_REMOTE_DEBUGGING_PORT || "";
let debugPort = Number(explicitDebugPort || defaultDebugPort);
const keepOpen = process.argv.includes("--keep-open");
const liveImage = process.argv.includes("--live-image") || process.env.IIIMAGE_AIDEBUG_LIVE_IMAGE === "1";
const realAgentSuiteOnly = process.argv.includes("--real-agent-suite") || process.argv.includes("--agent-real-suite");
const realAgentToolsOnly = process.argv.includes("--real-agent-tools-only") || process.argv.includes("--agent-tools-only");
const agentUiPromptSuiteOnly = process.argv.includes("--agent-ui-prompt-suite") || process.argv.includes("--real-ui-prompt-suite");
const realAgent = realAgentSuiteOnly || realAgentToolsOnly || agentUiPromptSuiteOnly || process.argv.includes("--real-agent") || process.env.IIIMAGE_AIDEBUG_REAL_AGENT === "1";
// Real Agent diagnostics use the product's authenticated local settings. A
// second flag created an isolated unsigned config and misleading 401 failures.
const liveConfig = liveImage || realAgent || process.argv.includes("--live-config") || process.env.IIIMAGE_AIDEBUG_LIVE_CONFIG === "1";
const mockAgent =
  process.argv.includes("--mock-agent") ||
  process.env.IIIMAGE_AIDEBUG_MOCK_AGENT === "1" ||
  (!realAgent && !liveImage);
const agentOnly = process.argv.includes("--agent-only");
const legacyFullSuite = process.argv.includes("--legacy-full-suite");
const imageOnly = process.argv.includes("--image-only") || process.argv.includes("--image-suite");
const imageRecoveryOnly = process.argv.includes("--image-recovery-suite") || process.argv.includes("--image-failure-suite");
const imageCollectionOnly = process.argv.includes("--image-collection-suite") || process.argv.includes("--canvas-image-suite");
const layerStackOnly = process.argv.includes("--layer-stack-suite") || process.argv.includes("--layers-suite");
const cutoutOnly = process.argv.includes("--cutout-suite") || process.argv.includes("--magic-cutout-suite");
const regionRedrawOnly = process.argv.includes("--region-redraw-suite") || process.argv.includes("--redraw-suite");
const mixedStressOnly = process.argv.includes("--mixed-stress") || process.argv.includes("--mixed-suite");
const posterBatchOnly = process.argv.includes("--poster-batch") || process.argv.includes("--poster-suite");
const contextPersistenceOnly = process.argv.includes("--context-persistence") || process.argv.includes("--persistence-suite");
const imageCollectionPersistenceOnly = process.argv.includes("--image-collection-persistence") || process.argv.includes("--canvas-image-persistence");
const authGateSuiteOnly = process.argv.includes("--auth-gate-suite") || process.argv.includes("--auth-suite");
const uiSurfaceSuiteOnly = process.argv.includes("--ui-surface-suite") || process.argv.includes("--surface-suite");
const performanceSuiteOnly = process.argv.includes("--performance-suite") || process.argv.includes("--perf-suite");
const imageImportSuiteOnly = process.argv.includes("--image-import-suite") || process.argv.includes("--import-suite");
const canvasClaritySuiteOnly = process.argv.includes("--canvas-clarity-suite") || process.argv.includes("--clarity-suite");
const selectionCommandSuiteOnly = process.argv.includes("--selection-command-suite") || process.argv.includes("--selection-suite");
const contextMenuSuiteOnly = process.argv.includes("--context-menu-suite") || process.argv.includes("--menu-suite");
const requirementNodeSuiteOnly = process.argv.includes("--requirement-node-suite") || process.argv.includes("--requirement-suite");
const askUserContinuationSuiteOnly = process.argv.includes("--ask-user-continuation-suite") || process.argv.includes("--ask-user-suite");
const failureDiagnosticsSelfTestOnly = process.argv.includes("--failure-diagnostics-selftest");
const imageRunsArg = process.argv.find((item) => item.startsWith("--image-runs="));
const imageRuns = Math.max(1, Math.min(Number(imageRunsArg?.split("=")[1] || 2), 5));
const posterCountArg = process.argv.find((item) => item.startsWith("--poster-count="));
const posterCount = Math.max(1, Math.min(Number(posterCountArg?.split("=")[1] || 15), 30));
const posterAgentCountArg = process.argv.find((item) => item.startsWith("--poster-agent-count="));
const posterAgentCount = Math.max(0, Math.min(Number(posterAgentCountArg?.split("=")[1] || Math.min(10, posterCount)), 30));
const posterDirectCountArg = process.argv.find((item) => item.startsWith("--poster-direct-count="));
const posterDirectCount = Math.max(0, Math.min(Number(posterDirectCountArg?.split("=")[1] || Math.max(0, posterCount - posterAgentCount)), 30));
const posterResolutionArg = process.argv.find((item) => item.startsWith("--poster-resolution="));
const posterResolution = String(posterResolutionArg?.split("=").slice(1).join("=") || "1080P");
const posterQualityArg = process.argv.find((item) => item.startsWith("--poster-quality="));
const posterQuality = String(posterQualityArg?.split("=").slice(1).join("=") || "auto");
const stressRoundsArg = process.argv.find((item) => item.startsWith("--stress-rounds="));
const stressRounds = Math.max(1, Math.min(Number(stressRoundsArg?.split("=")[1] || 2), 5));
const persistenceStageArg = process.argv.find((item) => item.startsWith("--persistence-stage="));
const persistenceStage = String(persistenceStageArg?.split("=").slice(1).join("=") || "");
const persistenceSentinelArg = process.argv.find((item) => item.startsWith("--persistence-sentinel="));
const persistenceSentinel = String(persistenceSentinelArg?.split("=").slice(1).join("=") || `AIDEBUG_CONTEXT_PERSIST_${Date.now()}`);
const persistenceStateFileArg = process.argv.find((item) => item.startsWith("--persistence-state-file="));
const persistenceStateFile = persistenceStateFileArg?.split("=").slice(1).join("=") || join(runDir, "context-persistence-state.json");
const aidebugConfigDirArg = process.argv.find((item) => item.startsWith("--aidebug-config-dir="));
const aidebugConfigDir = resolve(aidebugConfigDirArg?.split("=").slice(1).join("=") || process.env.IIIMAGE_AIDEBUG_CONFIG_DIR || join(runDir, "config"));
const nativeCaptureMode = process.argv.includes("--native-capture");
const captureScope = nativeCaptureMode ? "window" : "page";
const cyclesArg = process.argv.find((item) => item.startsWith("--cycles="));
const cycles = Math.max(1, Math.min(Number(cyclesArg?.split("=")[1] || 1), 50));
const cycleIndexArg = process.argv.find((item) => item.startsWith("--cycle-index="));
const cycleIndex = Math.max(1, Number(cycleIndexArg?.split("=")[1] || 1));
const cycleTotalArg = process.argv.find((item) => item.startsWith("--cycle-total="));
const cycleTotal = Math.max(cycleIndex, Math.min(Number(cycleTotalArg?.split("=")[1] || cycles), 50));
const cycleDelayArg = process.argv.find((item) => item.startsWith("--cycle-delay-ms="));
const cycleDelayMs = Math.max(0, Math.min(Number(cycleDelayArg?.split("=")[1] || 1200), 60000));
const desktopLogArg = process.argv.find((item) => item.startsWith("--desktop-log="));
const desktopLogPath = desktopLogArg?.split("=").slice(1).join("=") ||
  join(repoRoot, ".diagnostics", "aidebug-history.md");
const agentUiPromptArg = process.argv.find((item) => item.startsWith("--agent-ui-prompt="));
const agentUiPrompt = String(
  process.env.IIIMAGE_AIDEBUG_AGENT_UI_PROMPT ||
  agentUiPromptArg?.split("=").slice(1).join("=") ||
  "帮我生成一张二次元写实风格竖屏小红书东方审美黑长直，极具设计感、艺术感、微海报；\n  二次元风格但也需要写实，不要太写实，公主切近景。"
);
const agentUiFollowupArg = process.argv.find((item) => item.startsWith("--agent-ui-followup="));
const agentUiFollowupPrompt = String(
  process.env.IIIMAGE_AIDEBUG_AGENT_UI_FOLLOWUP ||
  agentUiFollowupArg?.split("=").slice(1).join("=") ||
  "这张效果很好，优点是满足要求，具备设计感，很棒。没什么缺点，我需要你继续生成3张"
);
const agentUiReferencesArg = process.argv.find((item) => item.startsWith("--agent-ui-references="));
const agentUiReferencePaths = (() => {
  const raw = String(
    process.env.IIIMAGE_AIDEBUG_AGENT_UI_REFERENCES ||
    agentUiReferencesArg?.split("=").slice(1).join("=") ||
    ""
  ).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => resolve(String(item || ""))).filter(Boolean).slice(0, 9);
  } catch {
    // A pipe-delimited fallback stays convenient for simple CLI invocations.
  }
  return raw.split("|").map((item) => resolve(item.trim())).filter(Boolean).slice(0, 9);
})();
const agentUiSingleOnly = process.argv.includes("--agent-ui-single") || process.env.IIIMAGE_AIDEBUG_AGENT_UI_SINGLE === "1";
const agentUiExpectedCountArg = process.argv.find((item) => item.startsWith("--agent-ui-expected-count="));
const agentUiExpectedCount = Math.max(1, Math.min(Number(agentUiExpectedCountArg?.split("=")[1] || 1), 10));
const agentUiExpectedReviewCountArg = process.argv.find((item) => item.startsWith("--agent-ui-expected-review-count="));
const agentUiExpectedReviewCount = Math.max(1, Math.min(Number(agentUiExpectedReviewCountArg?.split("=")[1] || 1), 10));
const electronBinName = isWindows ? "electron.cmd" : "electron";
const electronCli =
  [
    join(packageRoot, "node_modules", "electron", "cli.js"),
    join(repoRoot, "node_modules", "electron", "cli.js")
  ].find((candidate) => existsSync(candidate)) ?? "";
const viteCli =
  [
    join(packageRoot, "node_modules", "vite", "bin", "vite.js"),
    join(repoRoot, "node_modules", "vite", "bin", "vite.js")
  ].find((candidate) => existsSync(candidate)) ?? "";
const electronBin =
  [
    join(packageRoot, "node_modules", ".bin", electronBinName),
    join(repoRoot, "node_modules", ".bin", electronBinName)
  ].find((candidate) => existsSync(candidate)) ?? "electron";

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fileIntegritySnapshot(filePaths) {
  return [...new Set((Array.isArray(filePaths) ? filePaths : []).map(String).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => {
      try {
        const stat = statSync(filePath);
        return {
          path: filePath,
          exists: true,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: fileSha256(filePath)
        };
      } catch (error) {
        return {
          path: filePath,
          exists: false,
          size: 0,
          mtimeMs: 0,
          sha256: "",
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
}
const observations = [];
const aidebugProcessStartedAtMs = Date.now();
let startupPerformance = null;
const cdpOperationsPath = join(runDir, "cdp-operations.ndjson");
const harnessHeartbeatPath = join(runDir, "harness-heartbeat.ndjson");
let activeProbePhase = { label: "bootstrap", detail: {}, startedAt: new Date().toISOString() };
let harnessHeartbeatTimer = null;
let activeCdpClient = null;
let activeDebugTarget = null;
let browserWindowTargetCapability = { status: "unknown", error: "" };

function appendDiagnosticLine(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { flag: "a" });
}

function redactExpressionPreview(expression) {
  return String(expression || "")
    .replace(/`(?:\\.|[^`])*`/g, "`…`")
    .replace(/"(?:\\.|[^"\\])*"/g, '"…"')
    .replace(/'(?:\\.|[^'\\])*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function cdpParamSummary(method, params) {
  if (method === "Runtime.evaluate") {
    const expression = String(params?.expression || "");
    return {
      expressionLength: expression.length,
      expressionSha256: createHash("sha256").update(expression).digest("hex"),
      expressionPreview: redactExpressionPreview(expression),
      awaitPromise: params?.awaitPromise === true,
      returnByValue: params?.returnByValue === true
    };
  }
  return {
    keys: Object.keys(params || {}).sort(),
    payloadBytes: Buffer.byteLength(JSON.stringify(params || {}))
  };
}

function setProbePhase(label, detail = {}) {
  activeProbePhase = {
    label: String(label || "unknown"),
    detail,
    startedAt: new Date().toISOString()
  };
  recordObservation("info", "suite-checkpoint", activeProbePhase);
  return activeProbePhase;
}

function startHarnessHeartbeat() {
  if (harnessHeartbeatTimer) return;
  const writeHeartbeat = () => {
    appendDiagnosticLine(harnessHeartbeatPath, {
      at: new Date().toISOString(),
      uptimeMs: Date.now() - aidebugProcessStartedAtMs,
      phase: activeProbePhase,
      debugPort,
      electron: {
        pid: electronProcess?.pid || null,
        exitCode: electronProcess?.exitCode ?? null,
        signalCode: electronProcess?.signalCode ?? null
      },
      vite: {
        pid: viteProcess?.pid || null,
        exitCode: viteProcess?.exitCode ?? null,
        signalCode: viteProcess?.signalCode ?? null
      },
      cdp: activeCdpClient?.statusSnapshot?.() || null
    });
  };
  writeHeartbeat();
  harnessHeartbeatTimer = setInterval(writeHeartbeat, 5000);
  harnessHeartbeatTimer.unref?.();
}

function stopHarnessHeartbeat() {
  if (!harnessHeartbeatTimer) return;
  clearInterval(harnessHeartbeatTimer);
  harnessHeartbeatTimer = null;
}

function createIndexedFixturePng(index, width = 192, height = 144) {
  const palette = [
    [[226, 64, 78], [255, 236, 184]],
    [[20, 147, 154], [218, 255, 247]],
    [[76, 92, 210], [232, 226, 255]],
    [[218, 132, 31], [255, 242, 205]],
    [[148, 66, 181], [248, 222, 255]],
    [[38, 153, 92], [220, 255, 223]],
    [[199, 62, 143], [255, 223, 244]],
    [[55, 112, 177], [220, 243, 255]],
    [[182, 81, 36], [255, 227, 204]],
    [[87, 121, 45], [238, 255, 211]]
  ];
  const [background, accent] = palette[Math.max(0, Number(index || 1) - 1) % palette.length];
  const png = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  const markerSize = Math.max(16, Math.round(Math.min(width, height) * 0.2));
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * (0.2 + (index % 3) * 0.035);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const checker = (Math.floor(x / 18) + Math.floor(y / 18) + index) % 2 === 0;
      const distance = Math.hypot(x - centerX, y - centerY);
      const diagonal = Math.abs((x / width) - (y / height)) < 0.055 + (index % 2) * 0.018;
      const diamond = Math.abs(x - centerX) + Math.abs(y - centerY) < radius * 1.35;
      const centralShape = index % 2 === 0 ? diamond : distance < radius;
      const marker = x >= 9 && x < 9 + markerSize && y >= 9 && y < 9 + markerSize;
      const markerBit = marker && (
        x < 9 + 4 || y < 9 + 4 || x >= 9 + markerSize - 4 || y >= 9 + markerSize - 4 ||
        (((x - 9) >> 3) & 1) === (((Number(index || 1) - 1) >> Math.min(3, Math.floor((y - 9) / Math.max(1, markerSize / 4)))) & 1)
      );
      const useAccent = centralShape || diagonal || markerBit;
      const base = useAccent ? accent : background;
      const shade = !useAccent && checker ? 12 : 0;
      png.data[offset] = Math.min(255, base[0] + shade);
      png.data[offset + 1] = Math.min(255, base[1] + shade);
      png.data[offset + 2] = Math.min(255, base[2] + shade);
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true });
}

const fallbackPng = createIndexedFixturePng(1, 2, 2);
const dragFixtureDir = join(runDir, "drag-fixture-folder");
const dragFixtureNestedDir = join(dragFixtureDir, "nested");
const dragFixturePaths = [join(dragFixtureDir, "reference-one.png"), join(dragFixtureNestedDir, "reference-two.png")];
const occurrenceFixtureDirs = [join(runDir, "occurrence-folder-a"), join(runDir, "occurrence-folder-b")];
const imageImportFixtureDir = join(runDir, "image-import-500-fixture");

function prepareImageImportFixture() {
  mkdirSync(imageImportFixtureDir, { recursive: true });
  const base = createIndexedFixturePng(7, 12, 12);
  const paths = [];
  for (let index = 0; index < 500; index += 1) {
    const filePath = join(imageImportFixtureDir, `${String(index).padStart(4, "0")}.png`);
    writeFileSync(filePath, Buffer.concat([base, Buffer.from(`aidebug-image-import-${String(index).padStart(4, "0")}`)]));
    paths.push(filePath);
  }
  return paths;
}

let viteProcess;
let electronProcess;

async function resolveDebugPort() {
  if (explicitDebugPort) return debugPort;
  for (let offset = 0; offset < 256; offset += 1) {
    const candidate = 9300 + ((defaultDebugPort - 9300 + offset) % 2000);
    if (await portIsAvailable(candidate)) return candidate;
  }
  throw new Error("No available local Electron debugging port was found.");
}

async function resolveDevPort() {
  if (explicitDevPort) {
    if (await portIsAvailable(devPort)) return devPort;
    throw new Error(`Requested AIDebug Vite port ${devPort} is already in use.`);
  }
  for (let offset = 0; offset < 1000; offset += 1) {
    const candidate = 5173 + ((defaultDevPort - 5173 + offset) % 1000);
    if (await portIsAvailable(candidate)) return candidate;
  }
  throw new Error("No available local AIDebug Vite port was found.");
}

async function runCycleSupervisor() {
  const scriptPath = fileURLToPath(import.meta.url);
  const passThroughArgs = process.argv
    .slice(2)
    .filter((item) => !item.startsWith("--cycles=") && !item.startsWith("--cycle-index=") && !item.startsWith("--cycle-total="));
  const cycleResults = [];
  for (let index = 1; index <= cycles; index += 1) {
    const args = [scriptPath, ...passThroughArgs, "--cycles=1", `--cycle-index=${index}`, `--cycle-total=${cycles}`];
    const startedAt = new Date().toISOString();
    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: packageRoot,
        stdio: "inherit",
        shell: false,
        env: { ...process.env, IIIMAGE_AIDEBUG_CHILD: "1" }
      });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    cycleResults.push({ index, startedAt, exitCode });
    if (index < cycles) await delay(cycleDelayMs);
  }
  const failed = cycleResults.filter((item) => item.exitCode !== 0);
  mkdirSync(diagnosticsRoot, { recursive: true });
  const supervisorPath = join(diagnosticsRoot, `cycle-supervisor-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    supervisorPath,
    JSON.stringify({ ok: failed.length === 0, cycles, failed, results: cycleResults }, null, 2)
  );
  appendSupervisorDesktopLog("cycle-supervisor", failed.length === 0, {
    supervisorPath,
    cycles,
    failed: failed.length,
    results: cycleResults.map((item) => `cycle ${item.index}: exitCode=${item.exitCode}`).join("; ")
  });
  if (failed.length) process.exitCode = 1;
}

async function runContextPersistenceSupervisor() {
  mkdirSync(runDir, { recursive: true });
  const scriptPath = fileURLToPath(import.meta.url);
  const sharedConfigDir = join(runDir, "shared-config");
  const stateFile = join(runDir, "context-persistence-state.json");
  const sentinel = `AIDEBUG_CONTEXT_PERSIST_${Date.now()}`;
  const passThroughArgs = process.argv
    .slice(2)
    .filter((item) =>
      !item.startsWith("--cycles=") &&
      !item.startsWith("--cycle-index=") &&
      !item.startsWith("--cycle-total=") &&
      !item.startsWith("--persistence-stage=") &&
      !item.startsWith("--persistence-sentinel=") &&
      !item.startsWith("--persistence-state-file=") &&
      !item.startsWith("--aidebug-config-dir=")
    );
  const stages = ["write", "read"];
  const results = [];
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    const args = [
      scriptPath,
      ...passThroughArgs,
      `--persistence-stage=${stage}`,
      `--persistence-sentinel=${sentinel}`,
      `--persistence-state-file=${stateFile}`,
      `--aidebug-config-dir=${sharedConfigDir}`,
      "--cycles=1",
      `--cycle-index=${index + 1}`,
      `--cycle-total=${stages.length}`
    ];
    const startedAt = new Date().toISOString();
    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: packageRoot,
        stdio: "inherit",
        shell: false,
        env: { ...process.env, IIIMAGE_AIDEBUG_CHILD: "1" }
      });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    results.push({ stage, startedAt, exitCode });
    if (exitCode !== 0) break;
    if (index < stages.length - 1) await delay(cycleDelayMs);
  }
  const failed = results.filter((item) => item.exitCode !== 0);
  const supervisorPath = join(runDir, "context-persistence-supervisor.json");
  writeFileSync(
    supervisorPath,
    JSON.stringify({ ok: failed.length === 0, sentinel, sharedConfigDir, stateFile, failed, results }, null, 2)
  );
  appendSupervisorDesktopLog("context-persistence-supervisor", failed.length === 0, {
    supervisorPath,
    sentinel,
    sharedConfigDir,
    stateFile,
    failed: failed.length,
    results: results.map((item) => `${item.stage}: exitCode=${item.exitCode}`).join("; ")
  });
  if (failed.length) process.exitCode = 1;
}

async function runImageCollectionPersistenceSupervisor() {
  mkdirSync(runDir, { recursive: true });
  const scriptPath = fileURLToPath(import.meta.url);
  const sharedConfigDir = join(runDir, "shared-config");
  const stateFile = join(runDir, "image-collection-persistence-state.json");
  const passThroughArgs = process.argv
    .slice(2)
    .filter((item) =>
      !item.startsWith("--cycles=") &&
      !item.startsWith("--cycle-index=") &&
      !item.startsWith("--cycle-total=") &&
      !item.startsWith("--persistence-stage=") &&
      !item.startsWith("--persistence-state-file=") &&
      !item.startsWith("--aidebug-config-dir=")
    );
  const stages = ["write", "read"];
  const results = [];
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    const args = [
      scriptPath,
      ...passThroughArgs,
      `--persistence-stage=${stage}`,
      `--persistence-state-file=${stateFile}`,
      `--aidebug-config-dir=${sharedConfigDir}`,
      "--cycles=1",
      `--cycle-index=${index + 1}`,
      `--cycle-total=${stages.length}`
    ];
    const startedAt = new Date().toISOString();
    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: packageRoot,
        stdio: "inherit",
        shell: false,
        env: { ...process.env, IIIMAGE_AIDEBUG_CHILD: "1" }
      });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    results.push({ stage, startedAt, exitCode });
    if (exitCode !== 0) break;
    if (index < stages.length - 1) await delay(cycleDelayMs);
  }
  const failed = results.filter((item) => item.exitCode !== 0);
  const supervisorPath = join(runDir, "image-collection-persistence-supervisor.json");
  writeFileSync(
    supervisorPath,
    JSON.stringify({ ok: failed.length === 0, sharedConfigDir, stateFile, failed, results }, null, 2)
  );
  appendSupervisorDesktopLog("image-collection-persistence-supervisor", failed.length === 0, {
    supervisorPath,
    sharedConfigDir,
    stateFile,
    failed: failed.length,
    results: results.map((item) => `${item.stage}: exitCode=${item.exitCode}`).join("; ")
  });
  if (failed.length) process.exitCode = 1;
}

function recordObservation(level, label, detail = {}) {
  const observation = {
    at: new Date().toISOString(),
    level,
    label,
    detail
  };
  observations.push(observation);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "observations.ndjson"), `${JSON.stringify(observation)}\n`, { flag: "a" });
  process.stdout.write(`[aidebug:${level}] ${label}\n`);
  return observation;
}

function prepareLiveImageConfig() {
  if (!liveConfig) return;
  mkdirSync(aidebugConfigDir, { recursive: true });
  const sourceSettingsPath = join(packageRoot, "config", "app-settings.json");
  const targetSettingsPath = join(aidebugConfigDir, "app-settings.json");
  if (!existsSync(sourceSettingsPath)) {
    recordObservation("issue", "live-image-config-missing", {
      source: "config/app-settings.json",
      target: targetSettingsPath
    });
    return;
  }
  let shouldCopy = !existsSync(targetSettingsPath);
  if (!shouldCopy) {
    try {
      const existing = JSON.parse(readFileSync(targetSettingsPath, "utf8"));
      shouldCopy = String(existing?.serverToken || "") === "aidebug-token";
    } catch {
      shouldCopy = true;
    }
  }
  if (shouldCopy) {
    copyFileSync(sourceSettingsPath, targetSettingsPath);
    recordObservation("info", "live-image-config-copied", {
      source: "config/app-settings.json",
      target: targetSettingsPath
    });
  } else {
    recordObservation("info", "live-image-config-reused", {
      target: targetSettingsPath
    });
  }
}

async function waitForServer(url) {
  return waitForHttpServer(url, {
    attempts: 100,
    intervalMs: 250,
    errorMessage: `Vite dev server did not respond: ${url}`
  });
}

function spawnVite() {
  const command = viteCli ? process.execPath : isWindows ? "cmd.exe" : "pnpm";
  const args = viteCli
    ? [viteCli, "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"]
    : isWindows
      ? ["/d", "/s", "/c", `pnpm run dev:web -- --host 127.0.0.1 --port ${devPort} --strictPort`]
      : ["run", "dev:web", "--", "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"];
  return spawn(command, args, {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
}

function spawnElectron() {
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"];
  const command = electronCli ? process.execPath : electronBin;
  const commandArgs = electronCli ? [electronCli, ...args] : args;
  return spawn(command, commandArgs, {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      IIIMAGE_DEV_URL: devUrl,
      IIIMAGE_AIDEBUG: "1",
      IIIMAGE_AIDEBUG_LIVE_IMAGE: liveImage ? "1" : "0",
      IIIMAGE_AIDEBUG_REAL_AGENT: mockAgent ? "0" : "1",
      IIIMAGE_AIDEBUG_MOCK_AGENT: mockAgent ? "1" : "0",
      IIIMAGE_AIDEBUG_AGENT_MODE: mockAgent ? "mock" : "real",
      IIIMAGE_AIDEBUG_AUTH_SESSION: authGateSuiteOnly ? "1" : "0",
      IIIMAGE_AIDEBUG_IMAGE_FAULTS: imageRecoveryOnly ? "1" : (process.env.IIIMAGE_AIDEBUG_IMAGE_FAULTS || "0"),
      IIIMAGE_AIDEBUG_ASSERT_EXPLICIT_LAYER_HINT: layerStackOnly ? "1" : (process.env.IIIMAGE_AIDEBUG_ASSERT_EXPLICIT_LAYER_HINT || "0"),
      IIIMAGE_AIDEBUG_ASSERT_CLEAN_BACKGROUND_REFERENCE: layerStackOnly ? "1" : (process.env.IIIMAGE_AIDEBUG_ASSERT_CLEAN_BACKGROUND_REFERENCE || "0"),
      IIIMAGE_AGENT_DIAGNOSTICS: agentUiPromptSuiteOnly || realAgentSuiteOnly ? "1" : (process.env.IIIMAGE_AGENT_DIAGNOSTICS || "0"),
      IIIMAGE_CONFIG_DIR: aidebugConfigDir,
      IIIMAGE_ELECTRON_LOG: join(runDir, "electron.log")
    }
  });
}

function scrubEphemeralLiveConfig() {
  if (!liveConfig) return;
  const relativeConfigDir = relative(resolve(runDir), resolve(aidebugConfigDir));
  if (!relativeConfigDir || relativeConfigDir.startsWith("..") || isAbsolute(relativeConfigDir)) return;
  const targetSettingsPath = join(aidebugConfigDir, "app-settings.json");
  if (!existsSync(targetSettingsPath)) return;
  try {
    const settings = JSON.parse(readFileSync(targetSettingsPath, "utf8"));
    for (const key of ["agentApiKey", "imageApiKey", "serverToken", "serverSessionCookie", "serverUserId"]) {
      if (key in settings) settings[key] = "";
    }
    writeFileSync(targetSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // Diagnostics are already complete; never risk touching a caller-supplied
    // config directory when the ephemeral settings cannot be parsed safely.
  }
}

async function stopChildProcess(child) {
  if (!child) return;
  if (isWindows && child.exitCode === null && child.signalCode === null) {
    // Electron and pnpm both spawn grandchildren on Windows. Killing only the
    // wrapper can leave Chromium holding the remote-debugging port and poison
    // the next independent suite, so terminate the owned tree first.
    await forceKillProcessTree(child.pid, { isWindows });
    await waitForChildExit(child, 1600);
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    // Fall through to process-tree cleanup below.
  }
  if (await waitForChildExit(child)) return;
  await forceKillProcessTree(child.pid, { isWindows });
  await waitForChildExit(child, 1200);
}

async function waitForDebugTarget() {
  return pollForDebugTarget({
    port: debugPort,
    attempts: 120,
    intervalMs: 250,
    findTarget: (targets) => targets.find((item) => item.type === "page" && (String(item.url).startsWith(devUrl) || String(item.title).includes("IIimage"))),
    notFoundMessage: `No Electron renderer debug target found on port ${debugPort}.`
  });
}

class CdpClient extends DiagnosticCdpClient {
  constructor(url, label = "primary") {
    super(url, {
      label,
      getPhase: () => activeProbePhase,
      summarizeParams: cdpParamSummary,
      recordOperation: (operation) => appendDiagnosticLine(cdpOperationsPath, operation)
    });
  }
}

const evaluate = createRuntimeEvaluator({ holdAsyncIifePromises: true });
const readGuiState = createGuiStateReader({ evaluate, workbenchMinWidth });

async function captureProcessLine(pid) {
  if (!pid || !isWindows) return "";
  return await new Promise((resolveLine) => {
    let stdout = "";
    const child = spawn("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { stdio: ["ignore", "pipe", "ignore"], shell: false });
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", () => resolveLine(""));
    child.on("exit", () => resolveLine(stdout.trim()));
  });
}

async function captureFailureDiagnostics(error, client = activeCdpClient, target = activeDebugTarget) {
  mkdirSync(runDir, { recursive: true });
  const failure = {
    at: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack || "" : "",
    phase: activeProbePhase,
    cdpOperation: error?.cdpOperation || null,
    primary: client?.statusSnapshot?.() || null,
    processes: {
      electron: {
        pid: electronProcess?.pid || null,
        exitCode: electronProcess?.exitCode ?? null,
        signalCode: electronProcess?.signalCode ?? null,
        tasklist: await captureProcessLine(electronProcess?.pid)
      },
      vite: {
        pid: viteProcess?.pid || null,
        exitCode: viteProcess?.exitCode ?? null,
        signalCode: viteProcess?.signalCode ?? null,
        tasklist: await captureProcessLine(viteProcess?.pid)
      }
    },
    secondary: {
      connected: false,
      runtimeResponsive: false,
      screenshotCaptured: false,
      runtimeError: "",
      screenshotError: "",
      statePath: "",
      domPath: "",
      screenshotPath: ""
    },
    classification: "unknown"
  };

  let secondary = null;
  if (target?.webSocketDebuggerUrl) {
    try {
      secondary = new CdpClient(target.webSocketDebuggerUrl, "failure-secondary");
      await secondary.open(4000);
      failure.secondary.connected = true;
      await secondary.send("Runtime.enable", {}, 3000);
      try {
        const runtime = await secondary.send("Runtime.evaluate", {
          expression: `(() => ({
            at: new Date().toISOString(),
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            title: document.title,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            agentState: window.__iiimageDebugAgentState?.() || null,
            dom: document.documentElement?.outerHTML?.slice(0, 240000) || ""
          }))()`,
          awaitPromise: true,
          returnByValue: true
        }, 3500);
        const value = runtime?.result?.value || null;
        failure.secondary.runtimeResponsive = true;
        if (value) {
          const dom = String(value.dom || "");
          delete value.dom;
          const statePath = join(runDir, "failure-renderer-state.json");
          const domPath = join(runDir, "failure-dom.html");
          writeFileSync(statePath, JSON.stringify(value, null, 2));
          writeFileSync(domPath, dom, "utf8");
          failure.secondary.statePath = statePath;
          failure.secondary.domPath = domPath;
        }
      } catch (runtimeError) {
        failure.secondary.runtimeError = runtimeError instanceof Error ? runtimeError.message : String(runtimeError);
      }
      try {
        await secondary.send("Page.enable", {}, 3000);
        const screenshotBuffer = await capturePngScreenshot(secondary, { fromSurface: true, captureBeyondViewport: false }, 6000, { missingData: "null" });
        if (screenshotBuffer) {
          const screenshotPath = join(runDir, "failure-last-frame.png");
          writeFileSync(screenshotPath, screenshotBuffer);
          failure.secondary.screenshotCaptured = true;
          failure.secondary.screenshotPath = screenshotPath;
        }
      } catch (screenshotError) {
        failure.secondary.screenshotError = screenshotError instanceof Error ? screenshotError.message : String(screenshotError);
      }
    } catch (secondaryError) {
      failure.secondary.runtimeError = secondaryError instanceof Error ? secondaryError.message : String(secondaryError);
    } finally {
      secondary?.close();
    }
  }

  failure.classification = failure.secondary.runtimeResponsive
    ? "probe-command-stalled-product-responsive"
    : failure.secondary.screenshotCaptured
      ? "renderer-main-thread-unresponsive-compositor-responsive"
      : electronProcess?.exitCode !== null || electronProcess?.signalCode !== null
        ? "electron-process-exited"
        : "cdp-target-or-renderer-unresponsive";
  const failurePath = join(runDir, "failure-diagnostics.json");
  writeFileSync(failurePath, JSON.stringify(failure, null, 2));
  recordObservation("issue", "aidebug-failure-diagnostics", { failurePath, classification: failure.classification, phase: activeProbePhase, message: failure.message });
  return failure;
}

async function waitForExpression(client, expression, timeoutMs = 15000) {
  await waitForRuntimeExpression(client, expression, { evaluate, timeoutMs, intervalMs: 250 });
}

async function waitForCanvasImagePreviews(client, expectedMinimum = 1, timeoutMs = 60000) {
  const minimum = Math.max(1, Math.round(Number(expectedMinimum) || 1));
  await evaluate(client, `(() => {
    const images = Array.from(document.querySelectorAll('.flow-node.image .node-image-tile img'));
    images.forEach((image) => image.setAttribute('loading', 'eager'));
    return images.length;
  })()`);
  await waitForExpression(
    client,
    `(() => {
      const images = Array.from(document.querySelectorAll('.flow-node.image .node-image-tile img'));
      return images.length >= ${minimum} && images.every((image) => image.complete && image.naturalWidth >= 2 && image.naturalHeight >= 2);
    })()`,
    timeoutMs
  );
}


async function waitForReloadedAuthGate(client, sentinel, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastSignature = "";
  let stableSamples = 0;
  let lastProbe = null;
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const probe = await evaluate(client, `(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const residualSelectors = ['.settings-drawer', '.account-drawer', '.project-menu-popover', '.file-command-popover', '.dialog-layer', '.drawer-layer', '.canvas-context-menu'];
        return {
          sentinel: window.__iiimageAuthReloadSentinel || '',
          readyState: document.readyState,
          authShellCount: document.querySelectorAll('.auth-shell').length,
          authGateCount: document.querySelectorAll('.auth-gate-form').length,
          ideShellCount: document.querySelectorAll('.ide-shell').length,
          residual: residualSelectors.filter((selector) => document.querySelector(selector)),
          href: location.href
        };
      })()`, 5000);
      lastProbe = probe || null;
      const newDocumentReady = Boolean(
        probe?.sentinel === sentinel &&
        probe?.readyState === "complete" &&
        probe?.authShellCount === 1 &&
        probe?.authGateCount === 1 &&
        probe?.ideShellCount === 0 &&
        Array.isArray(probe?.residual) &&
        probe.residual.length === 0
      );
      if (newDocumentReady) {
        const signature = JSON.stringify(probe);
        if (signature === lastSignature) stableSamples += 1;
        else {
          lastSignature = signature;
          stableSamples = 1;
        }
        if (stableSamples >= 2) {
          return { ...probe, newDocumentReady: true, stableSamples };
        }
      } else {
        lastSignature = "";
        stableSamples = 0;
      }
    } catch (error) {
      // Runtime.evaluate may briefly lose its execution context while Page.reload swaps documents.
      lastError = error instanceof Error ? error.message : String(error);
      lastSignature = "";
      stableSamples = 0;
    }
    await delay(180);
  }
  throw new Error(`Timed out waiting for reloaded auth gate: ${JSON.stringify({ sentinel, lastProbe, lastError })}`);
}

async function setWindowSize(client, targetId, width, height) {
  let application = null;
  try {
    const ipcResult = await evaluate(
      client,
      `(async () => await window.iiimageConfig?.debugWindowBounds?.(${JSON.stringify({ width, height })}))()`,
      5000
    );
    if (!ipcResult?.ok) throw new Error(ipcResult?.error || "AIDebug window IPC unavailable");
    application = {
      status: "applied",
      method: "aidebug-ipc-content-size",
      target: "renderer-inner",
      bounds: ipcResult.bounds,
      contentBounds: ipcResult.contentBounds
    };
  } catch (ipcError) {
    try {
      const { windowId } = await client.send("Browser.getWindowForTarget", { targetId });
      await client.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width, height, windowState: "normal" }
      });
      application = {
        status: "applied",
        method: "browser-window-bounds",
        target: "browser-window-outer",
        windowId,
        ipcMethodError: ipcError instanceof Error ? ipcError.message : String(ipcError)
      };
    } catch (browserError) {
      await evaluate(client, `window.resizeTo(${width}, ${height}); undefined`);
      application = {
        status: "applied",
        method: "renderer-window-resize-to",
        target: "renderer-window-size",
        ipcMethodError: ipcError instanceof Error ? ipcError.message : String(ipcError),
        browserMethodError: browserError instanceof Error ? browserError.message : String(browserError)
      };
    }
  }
  await delay(220);
  try {
    await evaluate(client, `window.dispatchEvent(new Event("resize")); undefined`, 2000);
  } catch {
    // Keep viewport tests running even if the page is between navigations.
  }
  await delay(300);
  return application;
}

function positiveFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dimensionComparison(actual, expected, tolerancePx, statusWhenUnavailable = "unknown") {
  const actualWidth = positiveFinite(actual?.width);
  const actualHeight = positiveFinite(actual?.height);
  const expectedWidth = positiveFinite(expected?.width);
  const expectedHeight = positiveFinite(expected?.height);
  if (actualWidth == null || actualHeight == null || expectedWidth == null || expectedHeight == null) {
    return {
      status: statusWhenUnavailable,
      withinTolerance: null,
      actual: actualWidth != null && actualHeight != null ? { width: actualWidth, height: actualHeight } : null,
      expected: expectedWidth != null && expectedHeight != null ? { width: expectedWidth, height: expectedHeight } : null,
      delta: null,
      tolerancePx
    };
  }
  const delta = { width: actualWidth - expectedWidth, height: actualHeight - expectedHeight };
  const withinTolerance = Math.abs(delta.width) <= tolerancePx && Math.abs(delta.height) <= tolerancePx;
  return {
    status: withinTolerance ? "matched" : "mismatch",
    withinTolerance,
    actual: { width: actualWidth, height: actualHeight },
    expected: { width: expectedWidth, height: expectedHeight },
    delta,
    tolerancePx
  };
}

async function readCaptureEnvironment(client, targetId, requestedWindow, state, timing = {}) {
  let actualWindow = null;
  let actualWindowError = "";
  if (browserWindowTargetCapability.status === "unavailable") {
    actualWindowError = browserWindowTargetCapability.error || "Browser.getWindowForTarget unavailable for this Electron target";
  } else {
    try {
      const windowInfo = await client.send("Browser.getWindowForTarget", { targetId }, 5000);
      actualWindow = windowInfo?.bounds ? { ...windowInfo.bounds, windowId: windowInfo.windowId } : null;
      if (!actualWindow) actualWindowError = "Browser.getWindowForTarget returned no bounds";
      browserWindowTargetCapability = actualWindow
        ? { status: "available", error: "" }
        : { status: "unavailable", error: actualWindowError };
    } catch (error) {
      actualWindow = null;
      actualWindowError = error instanceof Error ? error.message : String(error);
      browserWindowTargetCapability = { status: "unavailable", error: actualWindowError };
      recordObservation("info", "cdp-browser-window-capability-unavailable", { error: actualWindowError });
    }
  }
  const renderer = await evaluate(client, `({
    innerWidth: Math.round(window.innerWidth),
    innerHeight: Math.round(window.innerHeight),
    outerWidth: Math.round(window.outerWidth),
    outerHeight: Math.round(window.outerHeight),
    devicePixelRatio: Number(window.devicePixelRatio || 1),
    visualViewportWidth: Math.round(window.visualViewport?.width || 0),
    visualViewportHeight: Math.round(window.visualViewport?.height || 0),
    screen: {
      width: Math.round(window.screen?.width || 0),
      height: Math.round(window.screen?.height || 0),
      availWidth: Math.round(window.screen?.availWidth || 0),
      availHeight: Math.round(window.screen?.availHeight || 0)
    }
  })`, 5000).catch(() => null);
  const requestedWidth = positiveFinite(requestedWindow?.width);
  const requestedHeight = positiveFinite(requestedWindow?.height);
  const requestStatus = requestedWidth != null && requestedHeight != null ? "requested" : "not-requested";
  const normalizedRequestedWindow = requestStatus === "requested"
    ? { width: requestedWidth, height: requestedHeight }
    : null;
  const screenshot = timing.screenshot && typeof timing.screenshot === "object"
    ? {
        source: String(timing.screenshot.source || "unknown"),
        width: positiveFinite(timing.screenshot.width),
        height: positiveFinite(timing.screenshot.height),
        byteLength: Math.max(0, Number(timing.screenshot.byteLength || 0)),
        sha256: String(timing.screenshot.sha256 || "")
      }
    : null;
  const windowTolerancePx = 8;
  const screenshotTolerancePx = 3;
  const requestedToBrowserWindow = requestStatus === "requested"
    ? dimensionComparison(actualWindow, normalizedRequestedWindow, windowTolerancePx)
    : dimensionComparison(actualWindow, null, windowTolerancePx, "not-requested");
  const requestedToRendererOuter = requestStatus === "requested"
    ? dimensionComparison(
        renderer ? { width: renderer.outerWidth, height: renderer.outerHeight } : null,
        normalizedRequestedWindow,
        windowTolerancePx
      )
    : dimensionComparison(renderer, null, windowTolerancePx, "not-requested");
  const requestedToRendererInner = requestStatus === "requested"
    ? dimensionComparison(
        renderer ? { width: renderer.innerWidth, height: renderer.innerHeight } : null,
        normalizedRequestedWindow,
        windowTolerancePx
      )
    : dimensionComparison(renderer, null, windowTolerancePx, "not-requested");
  const rendererCssExpected = renderer ? { width: renderer.innerWidth, height: renderer.innerHeight } : null;
  const rendererDeviceExpected = renderer
    ? {
        width: Number(renderer.innerWidth || 0) * Number(renderer.devicePixelRatio || 1),
        height: Number(renderer.innerHeight || 0) * Number(renderer.devicePixelRatio || 1)
      }
    : null;
  const screenshotToRendererCss = dimensionComparison(screenshot, rendererCssExpected, screenshotTolerancePx);
  const screenshotToRendererDevice = dimensionComparison(screenshot, rendererDeviceExpected, screenshotTolerancePx);
  const screenshotToRenderer = screenshotToRendererDevice.withinTolerance === true
    ? { ...screenshotToRendererDevice, expectedScale: "device-pixel-ratio" }
    : screenshotToRendererCss.withinTolerance === true
      ? { ...screenshotToRendererCss, expectedScale: "css-pixel" }
      : {
          ...(
            screenshotToRendererDevice.delta && screenshotToRendererCss.delta &&
            Math.abs(screenshotToRendererCss.delta.width) + Math.abs(screenshotToRendererCss.delta.height) <
              Math.abs(screenshotToRendererDevice.delta.width) + Math.abs(screenshotToRendererDevice.delta.height)
              ? screenshotToRendererCss
              : screenshotToRendererDevice
          ),
          expectedScale: "unresolved",
          candidates: { cssPixel: screenshotToRendererCss, devicePixelRatio: screenshotToRendererDevice }
        };
  const requestVerifiedBy = requestStatus === "not-requested"
    ? "not-requested"
    : requestedToBrowserWindow.withinTolerance === true
      ? "browser-window-bounds"
      : requestedToRendererOuter.withinTolerance === true
        ? "renderer-outer"
        : requestedToRendererInner.withinTolerance === true
          ? "renderer-inner"
          : "unverified";
  const requestEvidenceOk = requestStatus === "not-requested" || requestVerifiedBy !== "unverified";
  const rendererEvidenceOk = Boolean(
    positiveFinite(renderer?.innerWidth) && positiveFinite(renderer?.innerHeight) &&
    positiveFinite(renderer?.outerWidth) && positiveFinite(renderer?.outerHeight) &&
    positiveFinite(renderer?.devicePixelRatio)
  );
  const screenshotEvidenceOk = screenshotToRenderer.withinTolerance === true;
  const missing = [
    !actualWindow ? "browser-window-bounds" : "",
    !rendererEvidenceOk ? "renderer-dimensions-or-dpr" : "",
    !screenshot ? "screenshot-dimensions" : ""
  ].filter(Boolean);
  const invalid = [
    !requestEvidenceOk ? "requested-size-not-verified" : "",
    !screenshotEvidenceOk ? "screenshot-size-not-verified" : ""
  ].filter(Boolean);
  const viewport = state?.agentDebugState?.viewport || null;
  return {
    schemaVersion: 2,
    request: {
      status: requestStatus,
      requestedWindow: normalizedRequestedWindow,
      application: timing.requestApplication || (requestStatus === "not-requested" ? { status: "not-requested" } : { status: "unknown" }),
      verifiedBy: requestVerifiedBy
    },
    requestedWindow: normalizedRequestedWindow,
    browserWindow: {
      status: actualWindow ? "available" : "unavailable",
      bounds: actualWindow,
      error: actualWindow ? "" : actualWindowError || "Browser window bounds unavailable"
    },
    actualWindow,
    renderer,
    screenshot,
    tolerance: {
      windowPx: windowTolerancePx,
      screenshotPx: screenshotTolerancePx
    },
    comparisons: {
      requestedToBrowserWindow,
      requestedToRendererOuter,
      requestedToRendererInner,
      screenshotToRenderer
    },
    evidenceQuality: {
      status: invalid.length ? "invalid" : missing.length ? "partial" : "complete",
      ok: invalid.length === 0,
      missing,
      invalid
    },
    canvas: {
      x: Number(viewport?.x || 0),
      y: Number(viewport?.y || 0),
      scale: Number(state?.canvasZoomScale || viewport?.scale || 0),
      percent: Number(state?.canvasZoomPercent || 0)
    },
    captureScope,
    timing: {
      startedAt: timing.startedAt || "",
      capturedAt: new Date().toISOString(),
      elapsedBeforeCaptureMs: Number(timing.elapsedBeforeCaptureMs || 0),
      stableWaitMs: Number(timing.stableWaitMs || 0)
    }
  };
}

function overflowReport(snapshot) {
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  return {
    documentOverflowX: Boolean(snapshot?.document?.overflowX),
    bodyOverflowX: Boolean(snapshot?.body?.overflowX),
    elementOverflowX: elements
      .filter((item) => item?.overflowX)
      .map((item) => ({
        selector: item.selector,
        width: item.clientWidth,
        scrollWidth: item.scrollWidth
      }))
  };
}

function pngFileAlphaReport(filePath) {
  try {
    const png = decodePng(readFileSync(filePath));
    let transparent = 0;
    let partial = 0;
    let opaque = 0;
    for (let offset = 3; offset < png.data.length; offset += 4) {
      const alpha = png.data[offset];
      if (alpha <= 16) transparent += 1;
      else if (alpha < 245) partial += 1;
      else opaque += 1;
    }
    const total = Math.max(1, transparent + partial + opaque);
    return {
      ok: true,
      path: filePath,
      width: png.width,
      height: png.height,
      transparentRatio: Math.round((transparent / total) * 10000) / 10000,
      partialRatio: Math.round((partial / total) * 10000) / 10000,
      opaqueRatio: Math.round((opaque / total) * 10000) / 10000
    };
  } catch (error) {
    return { ok: false, path: filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

function pngFileAlphaGeometryReport(filePath) {
  try {
    const png = decodePng(readFileSync(filePath));
    const visibleAt = (x, y) => png.data[(y * png.width + x) * 4 + 3] > 16;
    let visiblePixels = 0;
    let left = png.width;
    let top = png.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        if (!visibleAt(x, y)) continue;
        visiblePixels += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    const straightRuns = [];
    for (let y = 0; y < png.height - 1; y += 1) {
      let run = 0;
      for (let x = 0; x < png.width; x += 1) {
        if (visibleAt(x, y) !== visibleAt(x, y + 1)) run += 1;
        else {
          if (run >= 8) straightRuns.push(run);
          run = 0;
        }
      }
      if (run >= 8) straightRuns.push(run);
    }
    for (let x = 0; x < png.width - 1; x += 1) {
      let run = 0;
      for (let y = 0; y < png.height; y += 1) {
        if (visibleAt(x, y) !== visibleAt(x + 1, y)) run += 1;
        else {
          if (run >= 8) straightRuns.push(run);
          run = 0;
        }
      }
      if (run >= 8) straightRuns.push(run);
    }
    straightRuns.sort((left, right) => right - left);
    const longRunThreshold = Math.max(24, Math.round(Math.min(png.width, png.height) * 0.043));
    const longStraightRunCount = straightRuns.filter((length) => length >= longRunThreshold * 0.55).length;
    const maximumStraightRun = straightRuns[0] || 0;
    const visibleBounds = right >= left && bottom >= top
      ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
      : { left: 0, top: 0, right: -1, bottom: -1, width: 0, height: 0 };
    const boundingBoxFillRatio = visiblePixels / Math.max(1, visibleBounds.width * visibleBounds.height);
    const rectilinearPlateRisk = maximumStraightRun >= longRunThreshold && (
      (longStraightRunCount >= 5 && boundingBoxFillRatio >= 0.62) ||
      (longStraightRunCount >= 18 && boundingBoxFillRatio >= 0.45)
    );
    return {
      alphaGeometryOk: !rectilinearPlateRisk,
      rectilinearPlateRisk,
      visiblePixels,
      visibleBounds,
      boundingBoxFillRatio: Math.round(boundingBoxFillRatio * 10000) / 10000,
      maximumStraightRun,
      longStraightRunCount,
      longRunThreshold,
      straightRuns: straightRuns.slice(0, 12)
    };
  } catch (error) {
    return {
      alphaGeometryOk: false,
      rectilinearPlateRisk: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function pngTextLayerShapeReport(maskPath, layerPath) {
  try {
    const maskPng = decodePng(readFileSync(maskPath));
    const layerPng = decodePng(readFileSync(layerPath));
    const makeGrid = (png, mode, gridWidth = 96, gridHeight = 48) => {
      const pixelCount = png.width * png.height;
      const binary = new Uint8Array(pixelCount);
      let borderLuma = 0;
      let borderSamples = 0;
      if (mode === "mask") {
        for (let y = 0; y < png.height; y += 1) {
          for (let x = 0; x < png.width; x += 1) {
            const offset = (y * png.width + x) * 4;
            const luma = png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
            binary[y * png.width + x] = luma > 127 ? 1 : 0;
            if (x === 0 || y === 0 || x === png.width - 1 || y === png.height - 1) {
              borderLuma += luma;
              borderSamples += 1;
            }
          }
        }
        if (borderLuma / Math.max(1, borderSamples) > 140) {
          for (let index = 0; index < binary.length; index += 1) binary[index] = binary[index] ? 0 : 1;
        }
      } else {
        for (let index = 0; index < pixelCount; index += 1) binary[index] = png.data[index * 4 + 3] > 16 ? 1 : 0;
      }
      const boundsForRows = (topRow = 0, bottomRow = png.height - 1) => {
        let left = png.width;
        let top = png.height;
        let right = -1;
        let bottom = -1;
        let pixels = 0;
        for (let y = Math.max(0, topRow); y <= Math.min(png.height - 1, bottomRow); y += 1) {
          for (let x = 0; x < png.width; x += 1) {
            if (!binary[y * png.width + x]) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
            pixels += 1;
          }
        }
        return right >= left && bottom >= top
          ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, pixels }
          : null;
      };
      const gridForBounds = (bounds, targetWidth = gridWidth, targetHeight = gridHeight) => {
        const grid = new Uint8Array(targetWidth * targetHeight);
        if (!bounds) return grid;
        for (let gridY = 0; gridY < targetHeight; gridY += 1) {
          for (let gridX = 0; gridX < targetWidth; gridX += 1) {
            const x0 = Math.floor(bounds.left + gridX * bounds.width / targetWidth);
            const x1 = Math.max(x0 + 1, Math.ceil(bounds.left + (gridX + 1) * bounds.width / targetWidth));
            const y0 = Math.floor(bounds.top + gridY * bounds.height / targetHeight);
            const y1 = Math.max(y0 + 1, Math.ceil(bounds.top + (gridY + 1) * bounds.height / targetHeight));
            let samples = 0;
            let visible = 0;
            for (let y = y0; y < y1; y += 1) {
              for (let x = x0; x < x1; x += 1) {
                samples += 1;
                visible += binary[y * png.width + x];
              }
            }
            if (visible / Math.max(1, samples) >= 0.18) grid[gridY * targetWidth + gridX] = 1;
          }
        }
        return grid;
      };
      const bounds = boundsForRows();
      if (!bounds) return { ok: false, grid: new Uint8Array(gridWidth * gridHeight), bounds: null, bands: [] };
      const rowPixels = new Uint32Array(png.height);
      for (let index = 0; index < binary.length; index += 1) if (binary[index]) rowPixels[Math.floor(index / png.width)] += 1;
      const maximumRowGap = Math.max(10, Math.min(24, Math.round(png.height * 0.018)));
      const rowBands = [];
      let activeBand = null;
      let lastActiveRow = -1;
      for (let y = 0; y < png.height; y += 1) {
        if (!rowPixels[y]) continue;
        if (!activeBand || y - lastActiveRow > maximumRowGap) {
          activeBand = { top: y, bottom: y, pixels: 0 };
          rowBands.push(activeBand);
        }
        activeBand.bottom = y;
        activeBand.pixels += rowPixels[y];
        lastActiveRow = y;
      }
      const meaningfulBands = rowBands.filter((band) => band.pixels >= Math.max(24, Math.round(png.width * 0.03)) && band.bottom - band.top >= 1);
      const separated = meaningfulBands.length > 1 && meaningfulBands.some((band, index) => (
        index > 0 && band.top - meaningfulBands[index - 1].bottom > Math.max(36, Math.round(png.height * 0.045))
      ));
      const bands = separated
        ? meaningfulBands.map((band) => {
            const bandBounds = boundsForRows(band.top, band.bottom);
            return {
              bounds: bandBounds,
              grid: gridForBounds(bandBounds, gridWidth, 24),
              gridWidth,
              gridHeight: 24
            };
          })
        : [];
      return { ok: true, grid: gridForBounds(bounds), bounds, bands };
    };
    const compareGrids = (sourceGrid, outputGrid, gridWidth, gridHeight) => {
      let best = { iou: 0, sourceCoverage: 0, outputPrecision: 0, shiftX: 0, shiftY: 0 };
      for (let shiftY = -2; shiftY <= 2; shiftY += 1) {
        for (let shiftX = -2; shiftX <= 2; shiftX += 1) {
          let sourcePixels = 0;
          let outputPixels = 0;
          let intersection = 0;
          let union = 0;
          for (let y = 0; y < gridHeight; y += 1) {
            for (let x = 0; x < gridWidth; x += 1) {
              const sourceOn = sourceGrid[y * gridWidth + x] === 1;
              const outputX = x + shiftX;
              const outputY = y + shiftY;
              const outputOn = outputX >= 0 && outputY >= 0 && outputX < gridWidth && outputY < gridHeight
                ? outputGrid[outputY * gridWidth + outputX] === 1
                : false;
              if (sourceOn) sourcePixels += 1;
              if (outputOn) outputPixels += 1;
              if (sourceOn && outputOn) intersection += 1;
              if (sourceOn || outputOn) union += 1;
            }
          }
          const candidate = {
            iou: intersection / Math.max(1, union),
            sourceCoverage: intersection / Math.max(1, sourcePixels),
            outputPrecision: intersection / Math.max(1, outputPixels),
            shiftX,
            shiftY
          };
          if (candidate.iou > best.iou) best = candidate;
        }
      }
      return best;
    };
    const shapePasses = (report) => report.iou >= 0.3 && report.sourceCoverage >= 0.42 && report.outputPrecision >= 0.35;
    const source = makeGrid(maskPng, "mask");
    const output = makeGrid(layerPng, "alpha");
    if (!source.ok || !output.ok) return { ok: false, maskPath, layerPath, error: "empty text shape" };
    const best = compareGrids(source.grid, output.grid, 96, 48);
    const usesSeparatedBands = source.bands.length > 1 || output.bands.length > 1;
    const bandReports = source.bands.length === output.bands.length
      ? source.bands.map((sourceBand, index) => {
          const outputBand = output.bands[index];
          const comparison = compareGrids(sourceBand.grid, outputBand.grid, sourceBand.gridWidth, sourceBand.gridHeight);
          return {
            index,
            ok: shapePasses(comparison),
            sourceBounds: sourceBand.bounds,
            outputBounds: outputBand.bounds,
            ...comparison
          };
        })
      : [];
    const bandsOk = usesSeparatedBands && source.bands.length === output.bands.length && source.bands.length > 1 && bandReports.every((report) => report.ok);
    return {
      ok: usesSeparatedBands ? bandsOk : shapePasses(best),
      maskPath,
      layerPath,
      sourceBounds: source.bounds,
      outputBounds: output.bounds,
      comparisonMode: usesSeparatedBands ? "separated-bands" : "whole-layer",
      sourceBandCount: source.bands.length,
      outputBandCount: output.bands.length,
      bandReports,
      ...best
    };
  } catch (error) {
    return { ok: false, maskPath, layerPath, error: error instanceof Error ? error.message : String(error) };
  }
}

function generatedMaskPathForLayer(layer) {
  const runId = String(layer?.runId || "");
  const match = runId.match(/^(layers-\d+-[a-z0-9]+)-composition-\d+-(.+)$/i);
  const layerPath = String(layer?.path || "");
  if (!match || !layerPath) return "";
  const imagegenDir = resolve(dirname(layerPath), "..", "..");
  const prefix = `agent-${match[1]}-`;
  const layerId = String(layer?.layerId || match[2] || "");
  const fileName = readdirSync(imagegenDir).find((name) =>
    name.startsWith(prefix) && name.includes(`-${layerId}-`) && name.toLowerCase().endsWith(".png")
  );
  return fileName ? join(imagegenDir, fileName) : "";
}

async function runLayerSemanticReplayAudit(layerAssets) {
  const auditDir = join(runDir, `layer-semantic-replay-${Date.now()}`);
  const rawPaths = layerAssets.map((layer) => generatedMaskPathForLayer(layer)).filter(Boolean);
  const firstRunId = String(layerAssets[0]?.runId || "");
  const runMatch = firstRunId.match(/^(layers-\d+-[a-z0-9]+)-composition-\d+-(.+)$/i);
  const imagegenDir = rawPaths[0] ? dirname(rawPaths[0]) : "";
  const previewPath = runMatch && imagegenDir
    ? join(imagegenDir, readdirSync(imagegenDir).find((name) => name.startsWith(`agent-${runMatch[1]}-`) && /-preview-1-01\.png$/i.test(name)) || "")
    : "";
  if (rawPaths.length !== layerAssets.length || !previewPath || !existsSync(previewPath)) {
    return {
      ok: false,
      auditDir,
      error: "semantic replay inputs missing",
      expectedLayers: layerAssets.length,
      resolvedLayers: rawPaths.length,
      previewPath
    };
  }
  mkdirSync(auditDir, { recursive: true });
  for (const sourcePath of [...rawPaths, previewPath]) copyFileSync(sourcePath, join(auditDir, sourcePath.split(/[\\/]/).pop()));
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, [join(packageRoot, "scripts", "layer-mask-replay-selftest.ts"), auditDir, "--write"], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });
  child.stdout?.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-65536); });
  child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-65536); });
  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ timedOut: false, exitCode: code ?? 1, signal: signal || "" }));
    child.once("error", (error) => resolveExit({ timedOut: false, exitCode: 1, signal: "", error: error instanceof Error ? error.message : String(error) }));
  });
  let timeoutId;
  const timeoutResult = new Promise((resolveTimeout) => {
    timeoutId = setTimeout(() => resolveTimeout({ timedOut: true, exitCode: 1, signal: "timeout" }), 120000);
  });
  const result = await Promise.race([exited, timeoutResult]);
  clearTimeout(timeoutId);
  if (result.timedOut) await forceKillProcessTree(child.pid);
  const reportPath = join(auditDir, "mask-replay", "report.json");
  let report = null;
  try {
    report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
  } catch (error) {
    return { ok: false, auditDir, reportPath, ...result, error: error instanceof Error ? error.message : String(error), stdout, stderr };
  }
  const reports = Array.isArray(report?.semanticMatting?.reports) ? report.semanticMatting.reports : [];
  const unsafeAlignments = reports.filter((item) => {
    if (item?.alignmentApplied !== true) return false;
    const scale = Number(item?.alignmentScale || 1);
    if (scale >= 0.84 && scale <= 1.08) return false;
    if (item?.role === "subject") return Number(item?.alignmentBaseScore || 0) >= 50;
    if (item?.role === "decoration") return Number(item?.inputVisiblePixels || 0) / Math.max(1, Number(report?.normalization?.width || 1024) * Number(report?.normalization?.height || 1024)) < 0.06;
    return false;
  });
  const rejectedSubjects = reports.filter((item) => item?.role === "subject" && item?.accepted !== true);
  const residualRatio = Number(report?.coverageRepair?.residualRatio || 0);
  const luminanceCorrelation = Number(report?.fidelityReport?.luminanceCorrelation || 0);
  const meanRgbDelta = Number(report?.fidelityReport?.meanRgbDelta || Number.POSITIVE_INFINITY);
  const hybridDirect = report?.qualityGate?.hybridDirect === true;
  const residualLimit = Number(report?.qualityGate?.residualLimit || (hybridDirect ? 0.45 : 0.3));
  const fidelityThreshold = Number(report?.qualityGate?.fidelityThreshold || (hybridDirect ? 0.68 : 0.72));
  const lockedTextGeometryRisks = (Array.isArray(report?.textGeometryReports) ? report.textGeometryReports : [])
    .filter((item) => Number(item?.alphaIou || 0) < 0.98 || Number(item?.visibleRetention || 0) < 0.98);
  const checkerboardRisks = (Array.isArray(report?.records) ? report.records : [])
    .filter((item) => item?.inputReport?.checkerboardDetected === true)
    .filter((item) =>
      Number(item?.inputReport?.checkerboardSuspiciousRemovedPixels || 0) > 0 ||
      Number(item?.inputReport?.checkerboardConfidence || 0) < 0.8 ||
      Number(item?.inputReport?.checkerboardBorderMatchRatio || 0) < 0.72
    )
    .map((item) => ({ id: item.id, role: item.role, ...item.inputReport }));
  const reviewFlags = [];
  for (const item of reports.filter((entry) => entry?.alignmentApplied === true)) {
    const scale = Number(item?.alignmentScale || 1);
    const shift = Math.hypot(Number(item?.alignmentX || 0), Number(item?.alignmentY || 0));
    if (scale < 0.7 || scale > 1.12) reviewFlags.push(`${item.id}:large-scale-${scale.toFixed(2)}`);
    if (shift > 122) reviewFlags.push(`${item.id}:large-shift-${Math.round(shift)}`);
  }
  if (residualRatio > residualLimit) reviewFlags.push(`residual-${residualRatio.toFixed(3)}`);
  const ok = Boolean(
    result.exitCode === 0 && report && unsafeAlignments.length === 0 && rejectedSubjects.length === 0 &&
    lockedTextGeometryRisks.length === 0 && checkerboardRisks.length === 0 && residualRatio <= residualLimit &&
    luminanceCorrelation >= fidelityThreshold && meanRgbDelta <= 40
  );
  return {
    ok,
    auditDir,
    reportPath,
    ...result,
    unsafeAlignments,
    rejectedSubjects,
    lockedTextGeometryRisks,
    checkerboardRisks,
    hybridDirect,
    residualLimit,
    fidelityThreshold,
    residualRatio,
    luminanceCorrelation,
    meanRgbDelta,
    alignments: reports.filter((item) => item?.alignmentApplied === true).map((item) => ({
      id: item.id,
      role: item.role,
      x: item.alignmentX,
      y: item.alignmentY,
      scale: item.alignmentScale,
      baseScore: item.alignmentBaseScore,
      improvement: item.alignmentImprovement
    })),
    visualReviewRequired: reviewFlags.length > 0,
    reviewFlags,
    stdoutTail: stdout.slice(-4000),
    stderrTail: stderr.slice(-4000)
  };
}

function rgbaFileContentReport(filePath, width, height, data, sourceFormat = "unknown") {
  try {
    const pixelCount = Math.max(1, width * height);
    // Real layer-stack outputs are normally 1024-2048 px. Scan those assets
    // completely so thin copy, hairlines and sparse typography cannot fall
    // between a coarse sampling grid. Keep bounded sampling only for unusually
    // large imports where a full audit would add avoidable test latency.
    const fullScan = pixelCount <= 4_194_304;
    const step = fullScan ? 1 : Math.max(1, Math.floor(Math.sqrt(pixelCount / 18000)));
    let sampled = 0;
    let visible = 0;
    let minChannel = 255;
    let maxChannel = 0;
    let minVisibleX = width;
    let minVisibleY = height;
    let maxVisibleX = -1;
    let maxVisibleY = -1;
    const colorBins = new Set();
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        sampled += 1;
        if (alpha <= 16) continue;
        visible += 1;
        minVisibleX = Math.min(minVisibleX, x);
        minVisibleY = Math.min(minVisibleY, y);
        maxVisibleX = Math.max(maxVisibleX, x);
        maxVisibleY = Math.max(maxVisibleY, y);
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        minChannel = Math.min(minChannel, red, green, blue);
        maxChannel = Math.max(maxChannel, red, green, blue);
        colorBins.add(`${red >> 4}:${green >> 4}:${blue >> 4}:${alpha >> 5}`);
      }
    }
    const visibleRatio = Math.round((visible / Math.max(1, sampled)) * 1_000_000) / 1_000_000;
    const channelSpread = visible ? Math.round(maxChannel - minChannel) : 0;
    const minimumVisiblePixels = Math.max(4, Math.ceil(sampled * 0.001));
    const hasVisibleContent = visible >= minimumVisiblePixels && visibleRatio >= 0.001;
    // A sparse single-colour title or line drawing is valid content because its
    // transparency already proves a non-empty shape. A fully opaque, flat plate
    // still needs actual colour variation so blank placeholder images fail.
    const hasVisualStructure = visibleRatio <= 0.985 || channelSpread >= 4 || colorBins.size >= 3;
    const contentOk = hasVisibleContent && hasVisualStructure;
    const visibleBounds = visible
      ? {
          left: minVisibleX,
          top: minVisibleY,
          right: maxVisibleX,
          bottom: maxVisibleY,
          width: maxVisibleX - minVisibleX + 1,
          height: maxVisibleY - minVisibleY + 1
        }
      : null;
    return {
      ok: contentOk,
      path: filePath,
      sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
      sourceFormat,
      width,
      height,
      scanMode: fullScan ? "full" : "sampled",
      step,
      sampled,
      visible,
      visibleRatio,
      minimumVisiblePixels,
      visibleBounds,
      channelSpread,
      colorBinCount: colorBins.size,
      error: contentOk ? "" : "file-has-no-visible-pixel-content"
    };
  } catch (error) {
    return { ok: false, path: filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

async function rasterFileContentReport(filePath) {
  try {
    const extension = extname(filePath).toLowerCase();
    if (extension === ".png") {
      const png = decodePng(readFileSync(filePath));
      return rgbaFileContentReport(filePath, png.width, png.height, png.data, "png");
    }
    const bytes = readFileSync(filePath);
    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "webp"].includes(String(metadata.format || "").toLowerCase())) {
      return { ok: false, path: filePath, sourceFormat: metadata.format || "unknown", error: "unsupported-raster-format" };
    }
    const decoded = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return rgbaFileContentReport(filePath, decoded.info.width, decoded.info.height, decoded.data, metadata.format);
  } catch (error) {
    return { ok: false, path: filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fileAssetPixelReport(state) {
  const metrics = (Array.isArray(state?.imagePreviewMetrics) ? state.imagePreviewMetrics : [])
    .filter((item) => item?.visible && Number(item.visibleRatio || 0) >= 0.45 && String(item.assetPath || ""));
  const reports = await Promise.all(metrics.slice(0, 24).map(async (item) => ({
    nodeId: item.nodeId,
    imageIndex: item.imageIndex,
    ...await rasterFileContentReport(String(item.assetPath || ""))
  })));
  const reportByKey = new Map(reports.map((item) => [`${item.nodeId}:${item.imageIndex}`, item]));
  const diversityGroups = [];
  const collectionNodeIds = [...new Set(metrics.map((item) => String(item.nodeId || "")).filter(Boolean))];
  for (const nodeId of collectionNodeIds) {
    const nodeReports = metrics
      .filter((item) => String(item.nodeId || "") === nodeId)
      .map((item) => reportByKey.get(`${item.nodeId}:${item.imageIndex}`))
      .filter(Boolean);
    if (nodeReports.length < 3) continue;
    const uniqueHashes = new Set(nodeReports.map((item) => item.sha256).filter(Boolean));
    const requiredUnique = Math.min(3, nodeReports.length);
    diversityGroups.push({
      kind: "image-collection",
      id: nodeId,
      assetCount: nodeReports.length,
      uniqueHashes: uniqueHashes.size,
      requiredUnique,
      ok: uniqueHashes.size >= requiredUnique
    });
  }
  const layerGroupByNodeId = new Map(
    (Array.isArray(state?.nodeLayouts) ? state.nodeLayouts : [])
      .filter((item) => item?.id && item?.layerGroupId)
      .map((item) => [String(item.id), String(item.layerGroupId)])
  );
  const layerGroupIds = [...new Set(layerGroupByNodeId.values())];
  for (const layerGroupId of layerGroupIds) {
    const layerReports = reports.filter((item) => layerGroupByNodeId.get(String(item.nodeId || "")) === layerGroupId);
    if (layerReports.length < 3) continue;
    const uniqueHashes = new Set(layerReports.map((item) => item.sha256).filter(Boolean));
    const requiredUnique = Math.min(3, layerReports.length);
    diversityGroups.push({
      kind: "layer-group",
      id: layerGroupId,
      assetCount: layerReports.length,
      uniqueHashes: uniqueHashes.size,
      requiredUnique,
      ok: uniqueHashes.size >= requiredUnique
    });
  }
  const diversityOk = diversityGroups.every((item) => item.ok);
  return {
    checked: reports.length > 0,
    ok: (reports.length === 0 ? Number(state?.visibleImagePreviewCount || 0) === 0 : reports.every((item) => item.ok)) && diversityOk,
    reports,
    diversityOk,
    diversityGroups,
    failureReasons: [
      ...reports.filter((item) => !item.ok).map((item) => `file-image-pixel-failed:${item.nodeId}:${item.imageIndex}:${item.error || "unknown"}`),
      ...diversityGroups.filter((item) => !item.ok).map((item) => `file-image-diversity-failed:${item.kind}:${item.id}:${item.uniqueHashes}/${item.requiredUnique}`)
    ]
  };
}

function pngFileMagentaReport(filePath) {
  try {
    const png = decodePng(readFileSync(filePath));
    let visible = 0;
    let chromaMagenta = 0;
    for (let offset = 0; offset < png.data.length; offset += 4) {
      const alpha = png.data[offset + 3];
      if (alpha <= 32) continue;
      visible += 1;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      if (red >= 190 && blue >= 165 && green <= 86 && Math.min(red, blue) - green >= 92) chromaMagenta += 1;
    }
    return {
      ok: true,
      path: filePath,
      width: png.width,
      height: png.height,
      magentaRatio: Math.round((chromaMagenta / Math.max(1, visible)) * 10000) / 10000
    };
  } catch (error) {
    return { ok: false, path: filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

async function pngFilesVisualFidelityReport(leftPath, rightPath) {
  try {
    if (!leftPath || !rightPath || !existsSync(leftPath) || !existsSync(rightPath)) {
      throw new Error("preview or recomposed PNG missing");
    }
    const edge = 96;
    const decode = async (filePath) => (await sharp(filePath, { failOn: "error", limitInputPixels: 100_000_000 })
      .resize(edge, edge, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer());
    const [left, right] = await Promise.all([decode(leftPath), decode(rightPath)]);
    const leftLuma = new Float64Array(edge * edge);
    const rightLuma = new Float64Array(edge * edge);
    let leftMean = 0;
    let rightMean = 0;
    let meanRgbDelta = 0;
    for (let offset = 0, index = 0; offset < left.length; offset += 3, index += 1) {
      const leftValue = left[offset] * 0.2126 + left[offset + 1] * 0.7152 + left[offset + 2] * 0.0722;
      const rightValue = right[offset] * 0.2126 + right[offset + 1] * 0.7152 + right[offset + 2] * 0.0722;
      leftLuma[index] = leftValue;
      rightLuma[index] = rightValue;
      leftMean += leftValue;
      rightMean += rightValue;
      meanRgbDelta += (Math.abs(left[offset] - right[offset]) + Math.abs(left[offset + 1] - right[offset + 1]) + Math.abs(left[offset + 2] - right[offset + 2])) / 3;
    }
    leftMean /= leftLuma.length;
    rightMean /= rightLuma.length;
    meanRgbDelta /= leftLuma.length;
    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;
    for (let index = 0; index < leftLuma.length; index += 1) {
      const leftDelta = leftLuma[index] - leftMean;
      const rightDelta = rightLuma[index] - rightMean;
      covariance += leftDelta * rightDelta;
      leftVariance += leftDelta * leftDelta;
      rightVariance += rightDelta * rightDelta;
    }
    const luminanceCorrelation = covariance / Math.max(1, Math.sqrt(leftVariance * rightVariance));
    const ok = luminanceCorrelation >= 0.72 && meanRgbDelta <= 40;
    return {
      checked: true,
      ok,
      leftPath,
      rightPath,
      luminanceCorrelation: Math.round(luminanceCorrelation * 10000) / 10000,
      meanRgbDelta: Math.round(meanRgbDelta * 1000) / 1000,
      sampleCount: leftLuma.length,
      failureReasons: ok ? [] : [
        luminanceCorrelation < 0.72 ? "preview-recomposition-structure-mismatch" : "",
        meanRgbDelta > 40 ? "preview-recomposition-colour-delta-too-high" : ""
      ].filter(Boolean)
    };
  } catch (error) {
    return { checked: true, ok: false, leftPath, rightPath, failureReasons: ["preview-recomposition-compare-failed"], error: error instanceof Error ? error.message : String(error) };
  }
}

function samplePngArea(png, box) {
  const left = Math.max(0, Math.floor(box.left));
  const top = Math.max(0, Math.floor(box.top));
  const right = Math.min(png.width, Math.ceil(box.right));
  const bottom = Math.min(png.height, Math.ceil(box.bottom));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width < 4 || height < 4) return { sampled: false, pixelOk: false, opaqueRatio: 0, channelSpread: 0, width, height, error: "sample-area-too-small" };
  const stepX = Math.max(1, Math.floor(width / 18));
  const stepY = Math.max(1, Math.floor(height / 18));
  let total = 0;
  let opaque = 0;
  let minChannel = 255;
  let maxChannel = 0;
  for (let y = top; y < bottom; y += stepY) {
    for (let x = left; x < right; x += stepX) {
      const index = (y * png.width + x) * 4;
      const alpha = png.data[index + 3];
      total += 1;
      if (alpha > 16) {
        opaque += 1;
        minChannel = Math.min(minChannel, png.data[index], png.data[index + 1], png.data[index + 2]);
        maxChannel = Math.max(maxChannel, png.data[index], png.data[index + 1], png.data[index + 2]);
      }
    }
  }
  const opaqueRatio = Math.round((opaque / Math.max(1, total)) * 1000) / 1000;
  const channelSpread = Math.round(maxChannel - minChannel);
  return { sampled: true, pixelOk: opaqueRatio >= 0.2 && channelSpread >= 4, opaqueRatio, channelSpread, width, height, error: "" };
}

function analyzePngVisualArea(png, box = null) {
  const left = Math.max(0, Math.floor(Number(box?.left ?? 0)));
  const top = Math.max(0, Math.floor(Number(box?.top ?? 0)));
  const right = Math.min(png.width, Math.ceil(Number(box?.right ?? png.width)));
  const bottom = Math.min(png.height, Math.ceil(Number(box?.bottom ?? png.height)));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width < 4 || height < 4) {
    return { sampled: false, ok: false, width, height, sampleCount: 0, error: "visual-area-too-small" };
  }
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 14000)));
  let sampleCount = 0;
  let opaque = 0;
  let minChannel = 255;
  let maxChannel = 0;
  let meanLuma = 0;
  let lumaM2 = 0;
  let greenDominant = 0;
  const colorBins = new Map();
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];
      sampleCount += 1;
      if (alpha > 16) opaque += 1;
      minChannel = Math.min(minChannel, red, green, blue);
      maxChannel = Math.max(maxChannel, red, green, blue);
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const delta = luma - meanLuma;
      meanLuma += delta / sampleCount;
      lumaM2 += delta * (luma - meanLuma);
      if (green >= red + 28 && green >= blue + 22 && green >= 96) greenDominant += 1;
      const bin = `${red >> 4}:${green >> 4}:${blue >> 4}:${alpha >> 5}`;
      colorBins.set(bin, Number(colorBins.get(bin) || 0) + 1);
    }
  }
  const dominantColorCount = Math.max(0, ...colorBins.values());
  const opaqueRatio = Math.round((opaque / Math.max(1, sampleCount)) * 1000) / 1000;
  const dominantColorRatio = Math.round((dominantColorCount / Math.max(1, sampleCount)) * 1000) / 1000;
  const greenDominantRatio = Math.round((greenDominant / Math.max(1, sampleCount)) * 1000) / 1000;
  const lumaStdDev = Math.round(Math.sqrt(lumaM2 / Math.max(1, sampleCount - 1)) * 1000) / 1000;
  const channelSpread = Math.round(maxChannel - minChannel);
  const colorBinCount = colorBins.size;
  const uniformFrameRisk = colorBinCount < 6 || dominantColorRatio >= 0.975 || (channelSpread < 10 && lumaStdDev < 2);
  const greenFrameRisk = greenDominantRatio >= 0.82 && dominantColorRatio >= 0.72;
  return {
    sampled: true,
    ok: sampleCount >= 32 && opaqueRatio >= 0.9 && !uniformFrameRisk && !greenFrameRisk,
    width,
    height,
    sampleCount,
    step,
    opaqueRatio,
    channelSpread,
    lumaMean: Math.round(meanLuma * 1000) / 1000,
    lumaStdDev,
    colorBinCount,
    dominantColorRatio,
    greenDominantRatio,
    uniformFrameRisk,
    greenFrameRisk,
    error: ""
  };
}

function screenshotEdgeContrastReport(screenshotPath, cssRect, devicePixelRatio = 1) {
  try {
    const png = PNG.sync.read(readFileSync(screenshotPath));
    const dpr = Math.max(0.5, Number(devicePixelRatio) || 1);
    const left = Math.max(0, Math.floor(Number(cssRect?.left || 0) * dpr));
    const top = Math.max(0, Math.floor(Number(cssRect?.top || 0) * dpr));
    const right = Math.min(png.width, Math.ceil(Number(cssRect?.right || 0) * dpr));
    const bottom = Math.min(png.height, Math.ceil(Number(cssRect?.bottom || 0) * dpr));
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width < 12 || height < 12) {
      return { checked: true, ok: false, width, height, error: "clarity-crop-too-small" };
    }
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 60000)));
    const lumaAt = (x, y) => {
      const offset = (y * png.width + x) * 4;
      return png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
    };
    const gradients = [];
    let strongEdges = 0;
    for (let y = top; y < bottom - step; y += step) {
      for (let x = left; x < right - step; x += step) {
        const center = lumaAt(x, y);
        const gradient = Math.max(Math.abs(center - lumaAt(x + step, y)), Math.abs(center - lumaAt(x, y + step)));
        gradients.push(gradient);
        if (gradient >= 24) strongEdges += 1;
      }
    }
    gradients.sort((leftValue, rightValue) => leftValue - rightValue);
    const percentile = (ratio) => gradients[Math.min(gradients.length - 1, Math.max(0, Math.floor(gradients.length * ratio)))] || 0;
    const p95 = percentile(0.95);
    const p99 = percentile(0.99);
    const strongEdgeRatio = strongEdges / Math.max(1, gradients.length);
    const ok = gradients.length >= 64 && p95 >= 14 && strongEdgeRatio >= 0.008;
    return {
      checked: true,
      ok,
      width,
      height,
      step,
      sampleCount: gradients.length,
      p95: Math.round(p95 * 1000) / 1000,
      p99: Math.round(p99 * 1000) / 1000,
      strongEdgeRatio: Math.round(strongEdgeRatio * 10000) / 10000,
      failureReasons: ok ? [] : [
        gradients.length < 64 ? "insufficient-edge-samples" : "",
        p95 < 14 ? "edge-contrast-too-soft" : "",
        strongEdgeRatio < 0.008 ? "edge-density-too-low" : ""
      ].filter(Boolean)
    };
  } catch (error) {
    return { checked: true, ok: false, error: error instanceof Error ? error.message : String(error), failureReasons: ["edge-contrast-analysis-failed"] };
  }
}

function screenshotFramePixelReport(screenshotBuffer, snapshot) {
  try {
    const png = decodePng(screenshotBuffer);
    const viewport = snapshot?.viewport || {};
    const viewportWidth = Math.max(1, Number(viewport.width || png.width));
    const viewportHeight = Math.max(1, Number(viewport.height || png.height));
    const scaleX = png.width / viewportWidth;
    const scaleY = png.height / viewportHeight;
    const dimensionOk = png.width >= 320 && png.height >= 240 && scaleX >= 0.7 && scaleX <= 4 && scaleY >= 0.7 && scaleY <= 4 && Math.abs(scaleX - scaleY) <= Math.max(0.08, Math.max(scaleX, scaleY) * 0.06);
    const visual = analyzePngVisualArea(png);
    const failureReasons = [];
    if (!dimensionOk) failureReasons.push("screenshot-dimensions-do-not-match-viewport");
    if (!visual.sampled) failureReasons.push(visual.error || "screenshot-pixels-not-sampled");
    if (visual.uniformFrameRisk) failureReasons.push("screenshot-is-nearly-uniform");
    if (visual.greenFrameRisk) failureReasons.push("screenshot-is-green-dominant");
    if (Number(visual.opaqueRatio || 0) < 0.9) failureReasons.push("screenshot-mostly-transparent");
    return {
      checked: true,
      width: png.width,
      height: png.height,
      viewportWidth,
      viewportHeight,
      scaleX: Math.round(scaleX * 1000) / 1000,
      scaleY: Math.round(scaleY * 1000) / 1000,
      dimensionOk,
      ...visual,
      ok: dimensionOk && visual.ok,
      failureReasons
    };
  } catch (error) {
    return { checked: true, ok: false, failureReasons: ["screenshot-decode-failed"], error: error instanceof Error ? error.message : String(error) };
  }
}

function compareScreenshotFrames(firstBuffer, secondBuffer) {
  const firstSha256 = Buffer.isBuffer(firstBuffer) ? createHash("sha256").update(firstBuffer).digest("hex") : "";
  const secondSha256 = Buffer.isBuffer(secondBuffer) ? createHash("sha256").update(secondBuffer).digest("hex") : "";
  try {
    const first = decodePng(firstBuffer);
    const second = decodePng(secondBuffer);
    const dimensionsMatch = first.width === second.width && first.height === second.height;
    if (!dimensionsMatch) {
      return {
        checked: true,
        ok: false,
        stable: false,
        exactHashMatch: firstSha256 === secondSha256,
        firstSha256,
        secondSha256,
        firstSize: { width: first.width, height: first.height },
        secondSize: { width: second.width, height: second.height },
        failureReasons: ["dual-frame-dimensions-changed"]
      };
    }
    const step = Math.max(1, Math.floor(Math.sqrt((first.width * first.height) / 18000)));
    let samples = 0;
    let changed = 0;
    let deltaTotal = 0;
    let deltaMax = 0;
    for (let y = 0; y < first.height; y += step) {
      for (let x = 0; x < first.width; x += step) {
        const offset = (y * first.width + x) * 4;
        const delta = (
          Math.abs(first.data[offset] - second.data[offset]) +
          Math.abs(first.data[offset + 1] - second.data[offset + 1]) +
          Math.abs(first.data[offset + 2] - second.data[offset + 2]) +
          Math.abs(first.data[offset + 3] - second.data[offset + 3])
        ) / 4;
        samples += 1;
        deltaTotal += delta;
        deltaMax = Math.max(deltaMax, delta);
        if (delta >= 12) changed += 1;
      }
    }
    const changedRatio = Math.round((changed / Math.max(1, samples)) * 10000) / 10000;
    const meanDelta = Math.round((deltaTotal / Math.max(1, samples)) * 1000) / 1000;
    const exactHashMatch = firstSha256 === secondSha256;
    const stable = exactHashMatch || (changedRatio <= 0.18 && meanDelta <= 8);
    return {
      checked: true,
      ok: stable,
      stable,
      exactHashMatch,
      firstSha256,
      secondSha256,
      firstSize: { width: first.width, height: first.height },
      secondSize: { width: second.width, height: second.height },
      step,
      samples,
      changedRatio,
      meanDelta,
      maxDelta: Math.round(deltaMax * 1000) / 1000,
      failureReasons: stable ? [] : ["dual-frame-pixels-unstable"]
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      stable: false,
      exactHashMatch: firstSha256 === secondSha256,
      firstSha256,
      secondSha256,
      failureReasons: ["dual-frame-compare-failed"],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function compareGuiStatesForCapture(first, second) {
  const firstLayers = first?.agentDebugState?.stateLayerEvidence?.layers || {};
  const secondLayers = second?.agentDebugState?.stateLayerEvidence?.layers || {};
  const firstDomIds = Array.isArray(firstLayers.dom) ? firstLayers.dom : [];
  const secondDomIds = Array.isArray(secondLayers.dom) ? secondLayers.dom : [];
  const sameDomIds = firstDomIds.length === secondDomIds.length && firstDomIds.every((id, index) => id === secondDomIds[index]);
  const firstNodes = new Map((Array.isArray(first?.flowNodeVisualEvidence) ? first.flowNodeVisualEvidence : []).map((item) => [item.id, item]));
  const secondNodes = new Map((Array.isArray(second?.flowNodeVisualEvidence) ? second.flowNodeVisualEvidence : []).map((item) => [item.id, item]));
  const geometryDeltas = [];
  for (const [id, firstNode] of firstNodes) {
    const secondNode = secondNodes.get(id);
    if (!secondNode) continue;
    const a = firstNode?.geometry || {};
    const b = secondNode?.geometry || {};
    const delta = Math.max(
      Math.abs(Number(a.left || 0) - Number(b.left || 0)),
      Math.abs(Number(a.top || 0) - Number(b.top || 0)),
      Math.abs(Number(a.width || 0) - Number(b.width || 0)),
      Math.abs(Number(a.height || 0) - Number(b.height || 0))
    );
    geometryDeltas.push({
      id,
      delta: Math.round(delta * 1000) / 1000,
      components: {
        left: Math.round(Math.abs(Number(a.left || 0) - Number(b.left || 0)) * 1000) / 1000,
        top: Math.round(Math.abs(Number(a.top || 0) - Number(b.top || 0)) * 1000) / 1000,
        width: Math.round(Math.abs(Number(a.width || 0) - Number(b.width || 0)) * 1000) / 1000,
        height: Math.round(Math.abs(Number(a.height || 0) - Number(b.height || 0)) * 1000) / 1000
      },
      first: { geometry: a, transform: firstNode?.computedStyle?.transform || "", className: firstNode?.className || "" },
      second: { geometry: b, transform: secondNode?.computedStyle?.transform || "", className: secondNode?.className || "" }
    });
  }
  const maxGeometryDelta = geometryDeltas.length ? Math.max(...geometryDeltas.map((item) => item.delta)) : 0;
  const sameViewport = JSON.stringify(first?.agentDebugState?.viewport || null) === JSON.stringify(second?.agentDebugState?.viewport || null);
  const stable = sameDomIds && sameViewport && maxGeometryDelta <= 2;
  const failureReasons = [];
  if (!sameDomIds) failureReasons.push("dom-node-ids-changed-between-frames");
  if (!sameViewport) failureReasons.push("canvas-viewport-changed-between-frames");
  if (maxGeometryDelta > 2) failureReasons.push("node-geometry-changed-between-frames");
  return {
    checked: true,
    ok: stable,
    stable,
    sameDomIds,
    sameViewport,
    maxGeometryDelta,
    geometryDeltas: geometryDeltas.filter((item) => item.delta > 0).slice(0, 12),
    firstDomIds,
    secondDomIds,
    failureReasons
  };
}

async function waitForGuiStateStability(client, options = {}) {
  const timeoutMs = Math.max(600, Number(options.timeoutMs || 5200));
  const intervalMs = Math.max(80, Number(options.intervalMs || 180));
  const requiredStablePairs = Math.max(1, Number(options.requiredStablePairs || 2));
  const startedAt = Date.now();
  const readProbe = () => evaluate(client, `(() => {
    const debug = window.__iiimageDebugAgentState?.() || {};
    const nodes = Array.from(document.querySelectorAll('.flow-node[data-node-id]'));
    return {
      agentDebugState: {
        viewport: debug.viewport || null,
        stateLayerEvidence: { layers: { dom: nodes.map((node) => String(node.dataset.nodeId || '')) } }
      },
      flowNodeVisualEvidence: nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          id: String(node.dataset.nodeId || ''),
          className: String(node.className || ''),
          geometry: { left: box.left, top: box.top, width: box.width, height: box.height },
          computedStyle: { transform: style.transform }
        };
      })
    };
  })()`);
  let previous = await readProbe();
  let stablePairs = 0;
  let samples = 1;
  let latestReport = null;
  while (Date.now() - startedAt < timeoutMs) {
    await delay(intervalMs);
    const current = await readProbe();
    samples += 1;
    latestReport = compareGuiStatesForCapture(previous, current);
    if (latestReport.ok) {
      stablePairs += 1;
      if (stablePairs >= requiredStablePairs) {
        return {
          ok: true,
          timedOut: false,
          samples,
          stablePairs,
          elapsedMs: Date.now() - startedAt,
          report: latestReport
        };
      }
    } else {
      stablePairs = 0;
    }
    previous = current;
  }
  return {
    ok: false,
    timedOut: true,
    samples,
    stablePairs,
    elapsedMs: Date.now() - startedAt,
    report: latestReport
  };
}

function screenshotSurfacePixelReport(screenshotBuffer, state, snapshot) {
  const surfaces = Array.isArray(state?.visualSurfaceMetrics) ? state.visualSurfaceMetrics : [];
  const nodes = Array.isArray(state?.flowNodeVisualEvidence) ? state.flowNodeVisualEvidence : [];
  try {
    const png = decodePng(screenshotBuffer);
    const viewport = snapshot?.viewport || {};
    const scaleX = png.width / Math.max(1, Number(viewport.width || png.width));
    const scaleY = png.height / Math.max(1, Number(viewport.height || png.height));
    const toPixelBox = (geometry) => geometry ? ({
      left: Number(geometry.left || 0) * scaleX,
      top: Number(geometry.top || 0) * scaleY,
      right: Number(geometry.right || 0) * scaleX,
      bottom: Number(geometry.bottom || 0) * scaleY
    }) : null;
    const surfaceSamples = surfaces.filter((item) => item?.visible && item?.clippedGeometry).slice(0, 8).map((item) => ({
      kind: "surface",
      name: item.name,
      visibleRatio: item.visibleRatio,
      geometry: item.clippedGeometry,
      ...analyzePngVisualArea(png, toPixelBox(item.clippedGeometry))
    }));
    const nodeSamples = nodes.filter((item) => item?.visible && item?.clippedGeometry).slice(0, 8).map((item) => ({
      kind: "node",
      name: item.id,
      visibleRatio: item.visibleRatio,
      centerHitSelf: item.centerHitSelf,
      previewHitSelf: item.previewHitSelf,
      geometry: item.clippedGeometry,
      ...analyzePngVisualArea(png, toPixelBox(item.clippedGeometry))
    }));
    const requiredSurfaceNames = ["shell", "canvas"];
    const sampledSurfaceNames = surfaceSamples.filter((item) => item.sampled).map((item) => item.name);
    const missingRequiredSurfaces = requiredSurfaceNames.filter((name) => surfaces.some((item) => item.name === name && item.present) && !sampledSurfaceNames.includes(name));
    const invalidSamples = [...surfaceSamples, ...nodeSamples].filter((item) => !item.sampled || Number(item.opaqueRatio || 0) < 0.85);
    const failureReasons = [
      ...missingRequiredSurfaces.map((name) => `surface-not-sampled:${name}`),
      ...invalidSamples.map((item) => `${item.kind}-pixel-evidence-invalid:${item.name}`)
    ];
    return {
      checked: true,
      ok: surfaceSamples.length >= 2 && missingRequiredSurfaces.length === 0 && invalidSamples.length === 0,
      scaleX: Math.round(scaleX * 1000) / 1000,
      scaleY: Math.round(scaleY * 1000) / 1000,
      surfaceSamples,
      nodeSamples,
      missingRequiredSurfaces,
      invalidSamples,
      failureReasons,
      error: ""
    };
  } catch (error) {
    return { checked: true, ok: false, surfaceSamples: [], nodeSamples: [], failureReasons: ["surface-screenshot-decode-failed"], error: error instanceof Error ? error.message : String(error) };
  }
}

function previewGeometryProof(metric = {}) {
  const width = Math.max(1, Number(metric.width || 0));
  const height = Math.max(1, Number(metric.height || 0));
  const naturalWidth = Math.max(1, Number(metric.naturalWidth || 0));
  const naturalHeight = Math.max(1, Number(metric.naturalHeight || 0));
  const displayRatio = width / height;
  const naturalRatio = naturalWidth / naturalHeight;
  const objectFit = String(metric.objectFit || "").trim() || "unknown";
  const aspectDelta = Math.round(Math.abs(Math.log(Math.max(0.01, displayRatio) / Math.max(0.01, naturalRatio))) * 1000) / 1000;
  let sourceVisibleRatio = 1;
  if (objectFit === "cover") {
    const scale = Math.max(width / naturalWidth, height / naturalHeight);
    const visibleSourceWidth = Math.min(naturalWidth, width / Math.max(0.001, scale));
    const visibleSourceHeight = Math.min(naturalHeight, height / Math.max(0.001, scale));
    sourceVisibleRatio = (visibleSourceWidth * visibleSourceHeight) / Math.max(1, naturalWidth * naturalHeight);
  }
  sourceVisibleRatio = Math.round(sourceVisibleRatio * 1000) / 1000;
  const aspectOk = objectFit === "contain" || objectFit === "cover" || aspectDelta <= 0.08;
  const cropOk = objectFit !== "cover" || sourceVisibleRatio >= 0.72;
  return {
    objectFit,
    naturalRatio: Math.round(naturalRatio * 1000) / 1000,
    displayRatio: Math.round(displayRatio * 1000) / 1000,
    aspectDelta,
    sourceVisibleRatio,
    aspectOk,
    cropOk,
    geometryOk: aspectOk && cropOk
  };
}

function screenshotPreviewPixelReport(screenshotBuffer, state, snapshot) {
  const metrics = Array.isArray(state?.imagePreviewMetrics) ? state.imagePreviewMetrics : [];
  const visibleMetrics = metrics.filter((item) => item?.visible && Number(item.visibleRatio || 0) >= 0.45 && Number(item.width || 0) >= 12 && Number(item.height || 0) >= 12);
  if (!visibleMetrics.length) {
    return {
      checked: false,
      ok: Number(state?.visibleImageNodeCount || 0) === 0,
      visiblePreviews: 0,
      samples: [],
      error: Number(state?.visibleImageNodeCount || 0) === 0 ? "" : "no-visible-preview-metrics"
    };
  }
  try {
    const png = decodePng(screenshotBuffer);
    const viewport = snapshot?.viewport || {};
    const scaleX = png.width / Math.max(1, Number(viewport.width || png.width));
    const scaleY = png.height / Math.max(1, Number(viewport.height || png.height));
    const selectedNodeId = String(state?.selectedNodeId || "");
    const orderedMetrics = [...visibleMetrics].sort((left, right) => {
      const leftSelected = left?.nodeId === selectedNodeId ? 1 : 0;
      const rightSelected = right?.nodeId === selectedNodeId ? 1 : 0;
      return rightSelected - leftSelected;
    });
    const samples = orderedMetrics.slice(0, 24).map((item) => {
      const box = {
        left: Number(item.left || 0) * scaleX,
        top: Number(item.top || 0) * scaleY,
        right: Number(item.right || 0) * scaleX,
        bottom: Number(item.bottom || 0) * scaleY
      };
      return { nodeId: item.nodeId, imageIndex: item.imageIndex, ...previewGeometryProof(item), ...samplePngArea(png, box) };
    });
    const geometryOk = samples.every((item) => item.geometryOk);
    const selectedSamples = selectedNodeId ? samples.filter((item) => item.nodeId === selectedNodeId) : [];
    const selectedOk = state?.selectedNodeType !== "image" || Boolean(
      selectedSamples.length > 0 && selectedSamples.every((item) => item.sampled && item.pixelOk && item.geometryOk)
    );
    return {
      checked: true,
      ok: samples.length > 0 && samples.every((item) => item.pixelOk) && geometryOk,
      geometryOk,
      selectedNodeId,
      selectedOk,
      selectedSamples,
      visiblePreviews: visibleMetrics.length,
      scaleX: Math.round(scaleX * 1000) / 1000,
      scaleY: Math.round(scaleY * 1000) / 1000,
      samples,
      error: ""
    };
  } catch (error) {
    return { checked: true, ok: false, visiblePreviews: visibleMetrics.length, samples: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function screenshotMessageFixturePixelReport(screenshotBuffer, state, snapshot, requiredKindsOverride = null) {
  const metrics = Array.isArray(state?.agentMessageLayoutMetrics) ? state.agentMessageLayoutMetrics : [];
  const proofKinds = new Set(["tool-trace", "code-block", "paste-block"]);
  const visibleMetrics = metrics.filter((item) =>
    proofKinds.has(String(item?.kind || "")) &&
    item?.visibleY &&
    Number(item.width || 0) >= 72 &&
    Number(item.height || 0) >= 12
  );
  const requiredKinds = Array.isArray(requiredKindsOverride) && requiredKindsOverride.length
    ? requiredKindsOverride.map((item) => String(item || "")).filter(Boolean)
    : [
        state?.agentToolTracePresent ? "tool-trace" : "",
        state?.markdownCodeBlockPresent ? "code-block" : "",
        state?.agentPasteBlockPresent ? "paste-block" : ""
      ].filter(Boolean);
  if (!requiredKinds.length) {
    return { checked: false, ok: true, samples: [], requiredKinds: [], visibleKinds: [], error: "" };
  }
  try {
    const png = decodePng(screenshotBuffer);
    const viewport = snapshot?.viewport || {};
    const scaleX = png.width / Math.max(1, Number(viewport.width || png.width));
    const scaleY = png.height / Math.max(1, Number(viewport.height || png.height));
    const samples = visibleMetrics.map((item) => {
      const box = {
        left: Number(item.left || 0) * scaleX,
        top: Number(item.top || 0) * scaleY,
        right: Number(item.right || 0) * scaleX,
        bottom: Number(item.bottom || 0) * scaleY
      };
      return { kind: item.kind, ...samplePngArea(png, box) };
    });
    const visibleKinds = Array.from(new Set(samples.map((item) => item.kind)));
    const missingKinds = requiredKinds.filter((kind) => !visibleKinds.includes(kind));
    const badSamples = samples.filter((item) => !item.sampled || !item.pixelOk);
    return {
      checked: true,
      ok: missingKinds.length === 0 && badSamples.length === 0,
      requiredKinds,
      visibleKinds,
      missingKinds,
      samples,
      error: ""
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      requiredKinds,
      visibleKinds: [],
      missingKinds: requiredKinds,
      samples: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function openSurfaceExpression(surface = "main", afterExpression = "") {
  return `new Promise((resolve) => {
    const targetSurface = ${JSON.stringify(surface)};
    const readySelectors = {
      settings: ".settings-drawer:not(.account-drawer)",
      "model-config": ".model-picker-dialog",
      "prompt-entries": ".agent-text-editor-dialog",
      account: ".account-drawer",
      history: ".project-agent-history",
      "project-menu": ".project-menu-popover:not(.file-command-popover)",
      "file-menu": ".file-command-popover",
      "image-task": ".manual-image-task-dialog",
      "agent-timeline": ".project-agent-panel",
      "agent-collapsed": ".project-agent-panel.is-collapsed",
      "agent-running": ".project-agent-panel",
      "agent-image-running": ".project-agent-panel"
    };
    const transientSelectors = ".ui-surface[data-ui-surface], .agent-history-popover, .project-menu-popover";
    const delay = (ms) => new Promise((done) => setTimeout(done, ms));
    const waitForDebugHook = async () => {
      const deadline = Date.now() + 1600;
      while (Date.now() < deadline) {
        if (typeof window.__iiimageDebugOpenSurface === "function") return true;
        await delay(40);
      }
      return typeof window.__iiimageDebugOpenSurface === "function";
    };
    const waitForSelector = async (selector, expected = true, timeout = 1800) => {
      if (!selector) return true;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const present = Boolean(document.querySelector(selector));
        if (present === expected) return true;
        await delay(40);
      }
      return Boolean(document.querySelector(selector)) === expected;
    };
    const invokeSurface = async (name, selector = "") => {
      const deadline = Date.now() + 1800;
      do {
        await waitForDebugHook();
        window.__iiimageDebugOpenSurface?.(name);
        await delay(80);
        if (!selector || document.querySelector(selector)) return true;
      } while (Date.now() < deadline);
      return Boolean(selector ? document.querySelector(selector) : true);
    };
    (async () => {
      await invokeSurface("main");
      await waitForSelector(transientSelectors, false, 1200);
      await delay(80);
      if (targetSurface !== "main") {
        const preSelector = targetSurface === "model-config" || targetSurface === "prompt-entries"
          ? readySelectors.settings
          : readySelectors[targetSurface];
        await invokeSurface(targetSurface, preSelector);
      }
      ${afterExpression}
      const finalSelector = readySelectors[targetSurface] || "";
      if (finalSelector) await waitForSelector(finalSelector, true);
      await delay(80);
      resolve(true);
    })();
  })`;
}

function bilinearPngPixel(png, rawX, rawY) {
  const x = Math.max(0, Math.min(png.width - 1, Number(rawX || 0)));
  const y = Math.max(0, Math.min(png.height - 1, Number(rawY || 0)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(png.width - 1, x0 + 1);
  const y1 = Math.min(png.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const read = (px, py, channel) => png.data[(py * png.width + px) * 4 + channel];
  return [0, 1, 2, 3].map((channel) => {
    const top = read(x0, y0, channel) * (1 - tx) + read(x1, y0, channel) * tx;
    const bottom = read(x0, y1, channel) * (1 - tx) + read(x1, y1, channel) * tx;
    return top * (1 - ty) + bottom * ty;
  });
}

function layerCompositeScreenshotMatchReport({ screenshotPath, capture, mergedPath, nodeId }) {
  try {
    if (!screenshotPath || !existsSync(screenshotPath)) throw new Error("layer screenshot missing");
    if (!mergedPath || !existsSync(mergedPath)) throw new Error("merged PNG missing");
    const screenshot = decodePng(readFileSync(screenshotPath));
    const merged = decodePng(readFileSync(mergedPath));
    const layout = (Array.isArray(capture?.state?.nodeLayouts) ? capture.state.nodeLayouts : [])
      .find((item) => item?.id === nodeId);
    const geometry = layout?.geometry;
    const viewport = capture?.snapshot?.viewport || {};
    const viewportWidth = Math.max(1, Number(viewport.width || screenshot.width));
    const viewportHeight = Math.max(1, Number(viewport.height || screenshot.height));
    if (!geometry || Number(geometry.width || 0) < 32 || Number(geometry.height || 0) < 32) {
      throw new Error("layer artboard geometry missing");
    }
    const scaleX = screenshot.width / viewportWidth;
    const scaleY = screenshot.height / viewportHeight;
    const deltas = [];
    let opaqueSamples = 0;
    let matchedSamples = 0;
    const grid = 25;
    const inset = 0.055;
    for (let row = 0; row < grid; row += 1) {
      const v = inset + ((row + 0.5) / grid) * (1 - inset * 2);
      for (let column = 0; column < grid; column += 1) {
        const u = inset + ((column + 0.5) / grid) * (1 - inset * 2);
        const source = bilinearPngPixel(merged, u * (merged.width - 1), v * (merged.height - 1));
        if (source[3] < 230) continue;
        const screenX = (Number(geometry.left || 0) + u * Number(geometry.width || 0)) * scaleX;
        const screenY = (Number(geometry.top || 0) + v * Number(geometry.height || 0)) * scaleY;
        const actual = bilinearPngPixel(screenshot, screenX, screenY);
        const delta = (Math.abs(actual[0] - source[0]) + Math.abs(actual[1] - source[1]) + Math.abs(actual[2] - source[2])) / 3;
        deltas.push(delta);
        opaqueSamples += 1;
        if (delta <= 46) matchedSamples += 1;
      }
    }
    const sorted = [...deltas].sort((left, right) => left - right);
    const meanDelta = deltas.reduce((total, value) => total + value, 0) / Math.max(1, deltas.length);
    const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))] || 0;
    const matchRatio = matchedSamples / Math.max(1, opaqueSamples);
    const sourceOpaqueCoverage = opaqueSamples / (grid * grid);
    const ok = opaqueSamples >= grid * grid * 0.82 && sourceOpaqueCoverage >= 0.82 && matchRatio >= 0.68 && meanDelta <= 38 && percentile(0.9) <= 78;
    return {
      checked: true,
      ok,
      screenshotPath,
      mergedPath,
      nodeId,
      screenshotSize: { width: screenshot.width, height: screenshot.height },
      mergedSize: { width: merged.width, height: merged.height },
      artboardGeometry: geometry,
      scaleX: Math.round(scaleX * 1000) / 1000,
      scaleY: Math.round(scaleY * 1000) / 1000,
      samples: deltas.length,
      opaqueSamples,
      sourceOpaqueCoverage: Math.round(sourceOpaqueCoverage * 10000) / 10000,
      matchRatio: Math.round(matchRatio * 10000) / 10000,
      meanDelta: Math.round(meanDelta * 1000) / 1000,
      p90Delta: Math.round(percentile(0.9) * 1000) / 1000,
      maxDelta: Math.round((sorted[sorted.length - 1] || 0) * 1000) / 1000,
      failureReasons: ok ? [] : [
        opaqueSamples < grid * grid * 0.82 ? "merged-opaque-coverage-too-low" : "",
        matchRatio < 0.68 ? "stack-screenshot-does-not-match-merged" : "",
        meanDelta > 38 ? "stack-screenshot-mean-delta-too-high" : "",
        percentile(0.9) > 78 ? "stack-screenshot-p90-delta-too-high" : ""
      ].filter(Boolean)
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      screenshotPath: screenshotPath || "",
      mergedPath: mergedPath || "",
      nodeId: nodeId || "",
      failureReasons: ["layer-composite-screenshot-compare-failed"],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function outsideClickExpression(surface = "main", x = 520, y = 420) {
  return openSurfaceExpression(
    surface,
    `{
      const clientX = Math.min(window.innerWidth - 24, ${Number(x)});
      const clientY = Math.min(window.innerHeight - 24, ${Number(y)});
      const target = document.elementFromPoint(clientX, clientY) || document.body;
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: "mouse" }));
      target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: "mouse" }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX, clientY }));
    }`
  );
}

function scrollAgentFeedBottomExpression() {
  return `new Promise((resolve) => {
    window.__iiimageDebugOpenSurface?.("agent-timeline");
    let done = false;
    const applyScroll = () => {
      const feed = document.querySelector(".project-agent-feed, .agent-feed");
      if (feed) feed.scrollTop = feed.scrollHeight;
    };
    const finish = () => {
      if (done) return;
      done = true;
      applyScroll();
      resolve(true);
    };
    setTimeout(() => {
      applyScroll();
      requestAnimationFrame(() => {
        finish();
      });
      window.setTimeout(finish, 180);
    }, 260);
    window.setTimeout(finish, 1200);
  })`;
}

function scrollExistingAgentFeedBottomExpression() {
  return `new Promise((resolve) => {
    let done = false;
    const applyScroll = () => {
      const feed = document.querySelector(".project-agent-feed, .agent-feed");
      if (feed) feed.scrollTop = feed.scrollHeight;
    };
    const finish = () => {
      if (done) return;
      done = true;
      applyScroll();
      resolve(true);
    };
    applyScroll();
    requestAnimationFrame(finish);
    window.setTimeout(finish, 220);
  })`;
}

function agentMessageFixtureExpression(scrollMode = "bottom") {
  const messages = [
    {
      id: "aidebug-message-fixture-assistant",
      role: "assistant",
      status: "done",
      meta: "aidebug fixture",
      toolTrace: {
        label: "工具",
        name: "experience",
        operation: "读取当前会话绘画经验",
        params: "action=read brief=验证较长工具参数在窄屏不会撑破 Agent 时间线布局",
        brief: "AIDEBUG_MESSAGE_FIXTURE 验证 trace badge、operation 和 brief 在 540px 下换行清晰，不产生横向溢出。"
      },
      content: [
        "### AIDEBUG 消息布局 fixture",
        "",
        "这条消息包含一段很长的 `AIDEBUG_INLINE_CODE_WITH_A_VERY_LONG_IDENTIFIER_SHOULD_WRAP_CLEANLY`，用于验证 inline code 不会撑出 Agent 面板。",
        "",
        "```ts",
        "const fixturePrompt = \"AIDEBUG_MESSAGE_FIXTURE long code block remains scrollable inside the message body\";",
        "export const result = { tool: \"experience\", action: \"read\" };",
        "```",
        "",
        "> 引用块保持边距、换行和可读高度。"
      ].join("\n"),
      pasteBlocks: [
        {
          id: "aidebug-paste-fixture",
          text: "AIDEBUG paste block content with a deliberately long filename-like-token: experience_fastmemory_readback_prompt_reference_trace_fixture.md",
          createdAt: "13:49"
        }
      ]
    }
  ];
  return `new Promise((resolve) => {
    window.__iiimageDebugOpenSurface?.("agent-timeline");
    const seeded = window.__iiimageDebugSeedAgentMessages?.({ messages: ${JSON.stringify(messages)}, append: false });
    const scrollMode = ${JSON.stringify(scrollMode)};
    let done = false;
    const applyScroll = () => {
      const feed = document.querySelector(".project-agent-feed, .agent-feed");
      if (feed) feed.scrollTop = scrollMode === "top" ? 0 : feed.scrollHeight;
    };
    const finish = () => {
      if (done) return;
      done = true;
      applyScroll();
      resolve(Boolean(seeded));
    };
    setTimeout(() => {
      let ticks = 0;
      const timer = window.setInterval(() => {
        applyScroll();
        ticks += 1;
        if (ticks >= 10) {
          window.clearInterval(timer);
          requestAnimationFrame(() => {
            finish();
          });
          window.setTimeout(finish, 180);
        }
      }, 80);
    }, 220);
    window.setTimeout(finish, 1800);
  })`;
}

function stopThenResendExpression(sentinel) {
  const prompt = `AIDEBUG_STOP_RESEND_${sentinel} 请调用 workflow list_nodes 读取当前节点列表，只返回简短结果；不要使用其他工具。`;
  return `new Promise((resolve) => {
    const prompt = ${JSON.stringify(prompt)};
    const sentinel = ${JSON.stringify(`AIDEBUG_STOP_RESEND_${sentinel}`)};
    const fail = (error) => resolve({ ok: false, error });
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const waitForDone = () => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const state = window.__iiimageDebugAgentState?.();
        const messages = Array.isArray(state?.messages) ? state.messages : [];
        const progress = Array.isArray(state?.progress) ? state.progress : [];
        const promptIndex = messages.findIndex((message) => String(message.content || "").includes(sentinel));
        const assistantIndex = messages.findIndex((message, index) => index > promptIndex && message.role === "assistant" && message.status !== "running");
        const workflowTool = progress.some((item) => {
          const input = item?.input && typeof item.input === "object" ? item.input : {};
          return item?.tool === "workflow" && (item?.operation === "list_nodes" || input.operation === "list_nodes");
        });
        const imageGen = progress.some((item) => item?.tool === "image_gen" || String(item?.phase || "").startsWith("image-"));
        if (state?.agentStatus === "idle" && promptIndex >= 0 && assistantIndex > promptIndex && workflowTool && !imageGen) {
          window.clearInterval(timer);
          resolve({ ok: true, promptIndex, assistantIndex });
          return;
        }
        if (Date.now() - startedAt > 45000) {
          window.clearInterval(timer);
          resolve({ ok: false, error: "stop-then-resend timed out", state, promptIndex, assistantIndex, workflowTool, imageGen });
        }
      }, 160);
    };
    const clickSendWhenReady = () => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const send = document.querySelector(".send-button:not(.is-stop)");
        if (send && !send.disabled) {
          window.clearInterval(timer);
          send.click();
          waitForDone();
          return;
        }
        if (Date.now() - startedAt > 5000) {
          window.clearInterval(timer);
          fail("send button did not become enabled");
        }
      }, 80);
    };
    window.__iiimageDebugOpenSurface?.("main");
    window.setTimeout(() => {
      window.__iiimageDebugOpenSurface?.("agent-running");
      window.setTimeout(() => {
        const stop = document.querySelector(".send-button.is-stop");
        if (!stop) {
          fail("stop button missing");
          return;
        }
        stop.click();
        window.setTimeout(() => {
          const textarea = document.querySelector(".agent-composer textarea");
          if (!textarea) {
            fail("composer textarea missing");
            return;
          }
          textarea.focus();
          setTextareaValue(textarea, prompt);
          window.setTimeout(clickSendWhenReady, 120);
        }, 300);
      }, 260);
    }, 220);
  })`;
}

function runningSupplementExpression(sentinel) {
  const prompt = `AIDEBUG_BUSY_SUPPLEMENT_${sentinel} 请调用 workflow list_nodes 读取当前节点列表，只返回简短结果；不要使用其他工具。`;
  return `new Promise((resolve) => {
    const prompt = ${JSON.stringify(prompt)};
    const sentinel = ${JSON.stringify(`AIDEBUG_BUSY_SUPPLEMENT_${sentinel}`)};
    const fail = (error) => resolve({ ok: false, error });
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const progressOperation = (item) => {
      const input = item?.input && typeof item.input === "object" ? item.input : {};
      return item?.operation || input.operation || "";
    };
    const isListNodesProgress = (item) => item?.tool === "workflow" && progressOperation(item) === "list_nodes";
    const waitForDone = () => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const state = window.__iiimageDebugAgentState?.();
        const messages = Array.isArray(state?.messages) ? state.messages : [];
        const progress = Array.isArray(state?.progress) ? state.progress : [];
        const promptIndex = messages.findIndex((message) => message?.role === "user" && String(message.content || "").includes(sentinel));
        const promptMessage = promptIndex >= 0 ? messages[promptIndex] : null;
        const assistantIndex = messages.findIndex((message, index) => index > promptIndex && message.role === "assistant" && message.status !== "running");
        const newRunId = [...progress].reverse().find((item) => item?.runId && item.runId !== "debug-running-ui" && item.phase === "runtime-request")?.runId ||
          [...progress].reverse().find((item) => item?.runId && item.runId !== "debug-running-ui")?.runId ||
          "";
        const newProgress = newRunId ? progress.filter((item) => item?.runId === newRunId) : [];
        const latestProgressRunId = [...progress].reverse().find((item) => item?.runId)?.runId || "";
        const runtimeRequest = newProgress.some((item) => item?.phase === "runtime-request");
        const workflowTool = newProgress.some(isListNodesProgress);
        const imageGen = newProgress.some((item) => item?.tool === "image_gen" || String(item?.phase || "").startsWith("image-"));
        const latestProgressOk = Boolean(newRunId && latestProgressRunId === newRunId);
        const userMetaOk = String(promptMessage?.meta || "").includes("interrupt");
        const textarea = document.querySelector(".agent-composer textarea");
        const promptCleared = !textarea || textarea.value.trim() === "";
        if (
          state?.agentStatus === "idle" &&
          promptIndex >= 0 &&
          userMetaOk &&
          assistantIndex > promptIndex &&
          runtimeRequest &&
          workflowTool &&
          !imageGen &&
          latestProgressOk &&
          promptCleared
        ) {
          window.clearInterval(timer);
          resolve({ ok: true, promptIndex, assistantIndex, newRunId });
          return;
        }
        if (Date.now() - startedAt > 45000) {
          window.clearInterval(timer);
          resolve({
            ok: false,
            error: "running supplement timed out",
            state,
            promptIndex,
            assistantIndex,
            newRunId,
            runtimeRequest,
            workflowTool,
            imageGen,
            latestProgressRunId,
            latestProgressOk,
            userMetaOk,
            promptCleared
          });
        }
      }, 160);
    };
    const submitSupplement = () => {
      const textarea = document.querySelector(".agent-composer textarea, .project-agent-composer textarea");
      if (!textarea) {
        fail("composer textarea missing");
        return;
      }
      textarea.focus();
      setTextareaValue(textarea, prompt);
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const sendSupplement = document.querySelector(".send-supplement-button:not(:disabled)");
        if (sendSupplement) {
          window.clearInterval(timer);
          window.__iiimageBusySupplementButtonClicked = true;
          sendSupplement.click();
          waitForDone();
          return;
        }
        if (Date.now() - startedAt > 3000) {
          window.clearInterval(timer);
          fail("send supplement button missing");
        }
      }, 80);
    };
    window.__iiimageBusySupplementButtonClicked = false;
    window.__iiimageDebugOpenSurface?.("main");
    window.setTimeout(() => {
      window.__iiimageDebugOpenSurface?.("agent-running");
      window.setTimeout(() => {
        const stop = document.querySelector(".send-button.is-stop");
        if (!stop) {
          fail("busy stop button missing before supplement");
          return;
        }
        submitSupplement();
      }, 260);
    }, 220);
  })`;
}

function runningSupplementDraftExpression(sentinel) {
  const prompt = `AIDEBUG_BUSY_DRAFT_${sentinel} 继续补充：只读取 workflow list_nodes，不要使用其他工具。`;
  return `new Promise((resolve) => {
    const prompt = ${JSON.stringify(prompt)};
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    window.__iiimageBusySupplementButtonClicked = false;
    window.__iiimageDebugOpenSurface?.("main");
    window.setTimeout(() => {
      window.__iiimageDebugOpenSurface?.("agent-running");
      window.setTimeout(() => {
        const textarea = document.querySelector(".agent-composer textarea");
        if (textarea) {
          textarea.focus();
          setTextareaValue(textarea, prompt);
        }
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          const supplement = document.querySelector(".send-supplement-button:not(:disabled)");
          if (supplement || Date.now() - startedAt > 3000) {
            window.clearInterval(timer);
            resolve(Boolean(supplement));
          }
        }, 80);
      }, 260);
    }, 220);
  })`;
}

function runningSupplementDraftModelPopoverExpression(sentinel) {
  const prompt = `AIDEBUG_BUSY_MODEL_${sentinel} 继续补充：只读取 workflow list_nodes，不要使用其他工具。`;
  return `new Promise((resolve) => {
    const prompt = ${JSON.stringify(prompt)};
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    window.__iiimageBusySupplementButtonClicked = false;
    window.__iiimageDebugOpenSurface?.("main");
    window.setTimeout(() => {
      window.__iiimageDebugOpenSurface?.("agent-running");
      window.setTimeout(() => {
        const textarea = document.querySelector(".agent-composer textarea");
        if (textarea) {
          textarea.focus();
          setTextareaValue(textarea, prompt);
        }
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          const supplement = document.querySelector(".send-supplement-button:not(:disabled)");
          const model = document.querySelector(".composer-model-chip");
          if (supplement && model) {
            window.clearInterval(timer);
            model.click();
            const popoverStartedAt = Date.now();
            const popoverTimer = window.setInterval(() => {
              const popover = document.querySelector(".composer-model-popover");
              if (popover || Date.now() - popoverStartedAt > 3000) {
                window.clearInterval(popoverTimer);
                resolve(Boolean(popover));
              }
            }, 80);
            return;
          }
          if (Date.now() - startedAt > 3000) {
            window.clearInterval(timer);
            resolve(false);
          }
        }, 80);
      }, 260);
    }, 220);
  })`;
}

function runningReferenceRemoveExpression() {
  return `new Promise((resolve) => {
    window.__iiimageDebugOpenSurface?.("main");
    window.setTimeout(() => {
      window.__iiimageDebugOpenSurface?.("agent-running-reference-limit");
      window.setTimeout(() => {
        const remove = document.querySelector(".agent-reference-strip span > button");
        if (!remove) {
          resolve(false);
          return;
        }
        remove.click();
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          const count = document.querySelectorAll(".agent-reference-strip span").length;
          const add = document.querySelector(".composer-tool-button");
          if (count === 5 && add && !add.disabled) {
            window.clearInterval(timer);
            resolve(true);
            return;
          }
          if (Date.now() - startedAt > 3000) {
            window.clearInterval(timer);
            resolve(false);
          }
        }, 80);
      }, 280);
    }, 220);
  })`;
}

function mixedSelectedContinuationExpression(sequenceIds, options = {}) {
  const ids = Array.from(new Set((Array.isArray(sequenceIds) ? sequenceIds : []).map((id) => String(id || "")).filter(Boolean)));
  const directProbe = Boolean(options.directProbe);
  const prompt = directProbe
    ? "AIDEBUG_DIRECT_SELECTED_CONTINUATION 请基于当前最后选中的图片节点继续生成一张更清爽、更专业的测试变体图，保持主体明确并同步到画布；不要清理画布；请自然返回 image_gen tool_call。"
    : "AIDEBUG_SELECTED_CONTINUATION 请基于当前最后选中的图片节点继续生成一张更清爽、更专业的测试变体图，保持主体明确并同步到画布；不要清理画布。";
  return `new Promise(async (resolve) => {
    const sequence = ${JSON.stringify(ids)};
    const directProbe = ${JSON.stringify(directProbe)};
    const prompt = ${JSON.stringify(`${prompt} nonce ${Date.now()}`)};
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    try {
      if (!sequence.length) {
        resolve({ ok: false, error: "no image node sequence" });
        return;
      }
      window.__iiimageDebugOpenSurface?.("main");
      await sleep(260);
      const initialState = window.__iiimageDebugAgentState?.();
      const beforeIds = new Set((initialState?.nodes || []).map((node) => node.id));
      const steps = [];
      for (const id of sequence) {
        const detail = await window.__iiimageAIDebug?.selectNode?.({ id });
        await sleep(180);
        const state = window.__iiimageDebugAgentState?.();
        steps.push({ id, ok: Boolean(detail?.ok && state?.selectedNodeId === id), selectedNodeId: state?.selectedNodeId || "", detail });
      }
      const selectedBeforeChat = window.__iiimageDebugAgentState?.()?.selectedNodeId || "";
      const beforeChatState = window.__iiimageDebugAgentState?.();
      const beforeChatIds = new Set((beforeChatState?.nodes || []).map((node) => node.id));
      const chat = await window.__iiimageAIDebug?.chat?.(prompt, { skipAsk: true });
      await sleep(260);
      const afterState = window.__iiimageDebugAgentState?.();
      const nodes = afterState?.nodes || [];
      const created = nodes.find((node) =>
        !beforeChatIds.has(node.id) &&
        node.type === "image" &&
        node.parentId === selectedBeforeChat &&
        node.imageState === "done" &&
        Number(node.assetCount || 0) > 0
      ) || null;
      const newImages = nodes.filter((node) => !beforeIds.has(node.id) && node.type === "image");
      const progress = Array.isArray(afterState?.progress) ? afterState.progress : [];
      const requestIndex = progress.reduce((latest, item, index) => item?.phase === "runtime-request" ? index : latest, -1);
      const chatProgress = requestIndex >= 0 ? progress.slice(requestIndex) : progress;
      const forcedProgress = chatProgress
        .filter((item) => item?.phase === "model-force")
        .map((item) => ({ tool: item?.tool, summary: item?.summary, input: item?.input }));
      const correctedProgress = chatProgress
        .filter((item) => item?.phase === "model-arg-correct")
        .map((item) => ({ tool: item?.tool, summary: item?.summary, input: item?.input }));
      const usedImageGen = chatProgress.some((item) => item?.tool === "image_gen" || String(item?.phase || "").startsWith("image-"));
      const usedModelForce = forcedProgress.length > 0;
      const usedToolChoice = chatProgress.some((item) => item?.phase === "model-tool-choice" && item?.tool === "image_gen");
      const autonomousImageGen = usedImageGen && !usedModelForce && !usedToolChoice;
      const routedImageGen = usedImageGen && usedToolChoice && !usedModelForce;
      const autonomyKind = autonomousImageGen
        ? "direct"
        : routedImageGen
          ? "tool-choice"
          : usedModelForce
            ? "fallback"
            : "unknown";
      const autonomyCounts = {
        direct: autonomyKind === "direct" ? 1 : 0,
        toolChoice: autonomyKind === "tool-choice" ? 1 : 0,
        fallback: autonomyKind === "fallback" ? 1 : 0,
        unknown: autonomyKind === "unknown" ? 1 : 0,
        modelForce: forcedProgress.length,
        argCorrections: correctedProgress.length,
        modelToolChoice: chatProgress.filter((item) => item?.phase === "model-tool-choice").length,
        imageToolChoice: chatProgress.filter((item) => item?.phase === "model-tool-choice" && item?.tool === "image_gen").length
      };
      const unexpectedClear = chatProgress.some((item) => {
        const input = item?.input && typeof item.input === "object" ? item.input : {};
        return item?.tool === "workflow" && (item?.operation === "clear_canvas" || input.operation === "clear_canvas");
      });
      const selectedSequenceOk = steps.length === sequence.length && steps.every((step) => step.ok);
      const targetId = sequence[sequence.length - 1];
      const correctionFreeOk = !directProbe || correctedProgress.length === 0;
      resolve({
        ok: Boolean(selectedSequenceOk && selectedBeforeChat === targetId && chat?.ok && created?.id && usedImageGen && !unexpectedClear && correctionFreeOk),
        sequence,
        targetId,
        selectedBeforeChat,
        selectedAfterChat: afterState?.selectedNodeId || "",
        createdId: created?.id || "",
        createdParentId: created?.parentId || "",
        newImages,
        selectedSequenceOk,
        usedImageGen,
        usedModelForce,
        usedToolChoice,
        autonomousImageGen,
        routedImageGen,
        autonomyKind,
        autonomyCounts,
        forcedProgress,
        correctedProgress,
        correctionFreeOk,
        unexpectedClear,
        directProbe: ${JSON.stringify(directProbe)},
        prompt,
        steps,
        chat,
        state: afterState
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error), sequence });
    }
  })`;
}

function stateFailures(state, expected = {}) {
  return Object.entries(expected)
    .filter(([key, value]) => state?.[key] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: state?.[key] }));
}

function auditProvenanceSceneParameters(metrics) {
  const thresholds = {
    nodeVisibleRatioMin: 0.98,
    nodeScreenWidthMin: 96,
    nodeScreenHeightMin: 64,
    titleScreenWidthMin: 42,
    titleScreenHeightMin: 8,
    hudOverlapAreaMax: 4,
    nodePairOverlapAreaMax: 4,
    portDiameterMin: 7,
    endpointErrorMax: 6,
    edgeScreenLengthMin: 60,
    edgeStrokeWidthMin: 1,
    viewportScaleMin: 0.3,
    viewportScaleMax: 1.25
  };
  const failureReasons = [];
  const check = (condition, reason) => {
    if (!condition) failureReasons.push(reason);
    return Boolean(condition);
  };
  const area = (box) => Math.max(0, Number(box?.width || 0)) * Math.max(0, Number(box?.height || 0));
  const intersection = (left, right) => {
    if (!left || !right) return { width: 0, height: 0, area: 0 };
    const width = Math.max(0, Math.min(Number(left.right), Number(right.right)) - Math.max(Number(left.left), Number(right.left)));
    const height = Math.max(0, Math.min(Number(left.bottom), Number(right.bottom)) - Math.max(Number(left.top), Number(right.top)));
    return { width, height, area: width * height };
  };
  const sorted = (values) => [...values].map(String).sort((left, right) => left.localeCompare(right));
  const sameSet = (actual, expected) => JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
  const canvas = metrics?.canvas || null;
  const hud = metrics?.hud || null;
  const nodes = Array.isArray(metrics?.nodeMetrics) ? metrics.nodeMetrics : [];
  const ports = Array.isArray(metrics?.connectedPortMetrics) ? metrics.connectedPortMetrics : [];
  const edges = Array.isArray(metrics?.edgeMetrics) ? metrics.edgeMetrics : [];
  const selectedIds = Array.isArray(metrics?.selectedIds) ? metrics.selectedIds.map(String) : [];
  const fixtureIds = metrics?.fixtureIds && typeof metrics.fixtureIds === "object" ? metrics.fixtureIds : {};
  const sourceId = String(fixtureIds.sourceId || "A");
  const derivedId = String(fixtureIds.derivedId || "B");
  const targetId = String(fixtureIds.targetId || "C");
  const variantId = String(fixtureIds.variantId || "D");
  const expectedNodeIds = [sourceId, derivedId, targetId, variantId];
  const expectedPortKeys = [`${sourceId}:output`, `${derivedId}:input`, `${derivedId}:output`, `${targetId}:input`, `${variantId}:input`];
  const expectedEdgeKeys = [`${sourceId}->${derivedId}`, `${sourceId}->${variantId}`, `${derivedId}->${targetId}`];
  const checks = {};
  checks.canvasGeometry = check(Boolean(canvas && Number(canvas.width) > 0 && Number(canvas.height) > 0 && area(canvas) > 0), "scene:canvas-geometry");
  checks.exactNodeSet = check(nodes.length === 4 && sameSet(nodes.map((item) => item?.id), expectedNodeIds), "scene:node-set");
  checks.nodesReadableAndInside = nodes.every((item) => {
    const box = item?.geometry;
    const title = item?.titleGeometry;
    const visibleArea = intersection(box, canvas).area;
    const visibleRatio = visibleArea / Math.max(1, area(box));
    const ok = Boolean(
      item?.present && box && title &&
      visibleRatio >= thresholds.nodeVisibleRatioMin &&
      Number(box.width) >= thresholds.nodeScreenWidthMin && Number(box.height) >= thresholds.nodeScreenHeightMin &&
      Number(title.width) >= thresholds.titleScreenWidthMin && Number(title.height) >= thresholds.titleScreenHeightMin
    );
    if (!ok) failureReasons.push(`scene:node-readable:${item?.id || "unknown"}`);
    return ok;
  });
  checks.hudClear = nodes.every((item) => {
    const nodeOverlap = intersection(item?.geometry, hud).area;
    const titleOverlap = intersection(item?.titleGeometry, hud).area;
    const ok = nodeOverlap <= thresholds.hudOverlapAreaMax && titleOverlap <= thresholds.hudOverlapAreaMax;
    if (!ok) failureReasons.push(`scene:hud-overlap:${item?.id || "unknown"}:${Math.round(Math.max(nodeOverlap, titleOverlap))}`);
    return ok;
  });
  const derivedNodePairOverlaps = [];
  for (let index = 0; index < nodes.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
      const overlap = intersection(nodes[index]?.geometry, nodes[nextIndex]?.geometry);
      if (overlap.area > thresholds.nodePairOverlapAreaMax) {
        derivedNodePairOverlaps.push({ first: nodes[index]?.id || "", second: nodes[nextIndex]?.id || "", ...overlap });
      }
    }
  }
  checks.nodesDoNotOverlap = check(derivedNodePairOverlaps.length === 0, `scene:node-overlap:${derivedNodePairOverlaps.map((item) => `${item.first}-${item.second}-${Math.round(item.area)}`).join(",") || "none"}`);
  const portKeys = ports.map((item) => `${item?.nodeId || ""}:${item?.role || ""}`);
  checks.exactConnectedPorts = check(ports.length === 5 && sameSet(portKeys, expectedPortKeys), "scene:connected-port-set");
  checks.connectedPortsUsable = ports.every((item) => {
    const center = item?.center;
    const inside = Boolean(center && canvas && Number(center.x) >= Number(canvas.left) && Number(center.x) <= Number(canvas.right) && Number(center.y) >= Number(canvas.top) && Number(center.y) <= Number(canvas.bottom));
    const ok = inside && Number(item?.diameter || 0) >= thresholds.portDiameterMin && item?.hitTestOk === true;
    if (!ok) failureReasons.push(`scene:port-unusable:${item?.nodeId || "unknown"}:${item?.role || "unknown"}`);
    return ok;
  });
  const edgeKeys = edges.map((item) => item?.key || `${item?.sourceId || ""}->${item?.targetId || ""}`);
  checks.exactEdges = check(edges.length === 3 && sameSet(edgeKeys, expectedEdgeKeys), "scene:edge-set");
  const relationByKey = Object.fromEntries(edges.map((item) => [item?.key || `${item?.sourceId || ""}->${item?.targetId || ""}`, String(item?.relation || "")]));
  checks.exactRelations = check(
    relationByKey[`${sourceId}->${derivedId}`] === "derived-from" &&
    relationByKey[`${sourceId}->${variantId}`] === "variant" &&
    relationByKey[`${derivedId}->${targetId}`] === "derived-from",
    "scene:edge-relations"
  );
  checks.edgesReadableAndInside = edges.every((item) => {
    const box = item?.geometry;
    const inside = Boolean(box && canvas && Number(box.left) >= Number(canvas.left) - 2 && Number(box.top) >= Number(canvas.top) - 2 && Number(box.right) <= Number(canvas.right) + 2 && Number(box.bottom) <= Number(canvas.bottom) + 2);
    const ok = Boolean(
      String(item?.path || "") && inside && Number(item?.totalLength || 0) >= thresholds.edgeScreenLengthMin &&
      Number(item?.strokeWidth || 0) >= thresholds.edgeStrokeWidthMin && Number(item?.opacity || 0) > 0 &&
      !["", "none", "transparent"].includes(String(item?.stroke || "").toLowerCase())
    );
    if (!ok) failureReasons.push(`scene:edge-unreadable:${item?.key || "unknown"}`);
    return ok;
  });
  checks.edgeEndpointsAligned = edges.every((item) => {
    const ok = Number(item?.sourceEndpointError) <= thresholds.endpointErrorMax && Number(item?.targetEndpointError) <= thresholds.endpointErrorMax;
    if (!ok) failureReasons.push(`scene:edge-endpoint:${item?.key || "unknown"}:${item?.sourceEndpointError}/${item?.targetEndpointError}`);
    return ok;
  });
  checks.edgesAvoidUnrelatedNodes = edges.every((item) => {
    const hits = Array.isArray(item?.unrelatedNodeSampleHits) ? item.unrelatedNodeSampleHits : [];
    if (hits.length) failureReasons.push(`scene:edge-crosses-node:${item?.key || "unknown"}:${hits.map((hit) => hit?.nodeId || "unknown").join(",")}`);
    return hits.length === 0;
  });
  checks.selectedNodeStable = check(selectedIds.length === 1 && selectedIds[0] === derivedId, `scene:selected:${selectedIds.join(",") || "none"}`);
  const viewportScale = Number(metrics?.viewport?.scale || 0);
  checks.viewportScaleReadable = check(viewportScale >= thresholds.viewportScaleMin && viewportScale <= thresholds.viewportScaleMax, `scene:viewport-scale:${viewportScale}`);
  return {
    checked: true,
    ok: Object.values(checks).every(Boolean) && failureReasons.length === 0,
    thresholds,
    checks,
    failureReasons: [...new Set(failureReasons)],
    derived: {
      nodePairOverlaps: derivedNodePairOverlaps,
      nodeIds: sorted(nodes.map((item) => item?.id || "")),
      portKeys: sorted(portKeys),
      edgeKeys: sorted(edgeKeys),
      relationByKey,
      selectedIds,
      viewportScale
    },
    producerChecks: metrics?.checks || null,
    producerThresholds: metrics?.thresholds || null
  };
}

function buildVisualReliabilityReport({
  state,
  stateIssues,
  overflow,
  captureIssues,
  screenshotSource,
  screenshotFramePixelReport: frameReport,
  screenshotSurfacePixelReport: surfaceReport,
  dualFrameReport,
  stateStabilityReport,
  screenshotEvidence,
  captureEnvironment,
  imagePreviewPixelReport,
  fileImagePixelReport,
  messageFixturePixelReport,
  expectedState,
  visualPolicy = "overview",
  requireImagePixels = false,
  requireMessagePixels = false
}) {
  const hasVisibleImagePreviews = Number(state?.visibleImagePreviewCount || 0) > 0;
  const visibleDomImageMetrics = (Array.isArray(state?.imagePreviewMetrics) ? state.imagePreviewMetrics : []).filter((item) => item?.visible && Number(item.visibleRatio || 0) >= 0.45);
  const imageSamples = Array.isArray(imagePreviewPixelReport?.samples) ? imagePreviewPixelReport.samples : [];
  const metricKey = (item) => `${item?.nodeId || ""}:${item?.imageIndex ?? ""}`;
  const screenshotSampleByKey = new Map(imageSamples.map((item) => [metricKey(item), item]));
  const fileReportByKey = new Map((Array.isArray(fileImagePixelReport?.reports) ? fileImagePixelReport.reports : []).map((item) => [metricKey(item), item]));
  const screenshotImagePixelEvidenceOk = !hasVisibleImagePreviews || Boolean(
    imagePreviewPixelReport?.checked && imageSamples.length > 0 && imageSamples.every((item) => item?.sampled && item?.pixelOk)
  );
  const domImagePixelFailedMetrics = visibleDomImageMetrics.filter((item) => item?.sampled && !item?.pixelOk);
  const domImagePixelUnknownMetrics = visibleDomImageMetrics.filter((item) => !item?.sampled);
  const domImagePixelDirectOk = !hasVisibleImagePreviews || Boolean(
    visibleDomImageMetrics.length > 0 && domImagePixelFailedMetrics.length === 0 && domImagePixelUnknownMetrics.length === 0
  );
  const domUnknownFallbackProofs = domImagePixelUnknownMetrics.map((item) => {
    const key = metricKey(item);
    const file = fileReportByKey.get(key);
    const screen = screenshotSampleByKey.get(key);
    const domLoadedGeometryOk = Boolean(
      item?.complete && Number(item?.naturalWidth || 0) >= 2 && Number(item?.naturalHeight || 0) >= 2 &&
      Number(item?.width || 0) >= 12 && Number(item?.height || 0) >= 12 && Number(item?.visibleRatio || 0) >= 0.45
    );
    return {
      key,
      nodeId: item?.nodeId || "",
      imageIndex: item?.imageIndex,
      domLoadedGeometryOk,
      filePixelOk: file?.ok === true,
      screenshotPixelOk: Boolean(screen?.sampled && screen?.pixelOk),
      ok: Boolean(domLoadedGeometryOk && file?.ok === true && screen?.sampled && screen?.pixelOk),
      domError: item?.error || item?.bridgeError || item?.fetchError || "direct DOM canvas unavailable"
    };
  });
  const domUnknownVerifiedByFileAndScreen = domImagePixelUnknownMetrics.length > 0 && domUnknownFallbackProofs.every((item) => item.ok);
  const domImagePixelEvidenceOk = !hasVisibleImagePreviews || Boolean(
    domImagePixelFailedMetrics.length === 0 && (domImagePixelUnknownMetrics.length === 0 || domUnknownVerifiedByFileAndScreen)
  );
  const domImagePixelStatus = !hasVisibleImagePreviews
    ? "not-applicable"
    : domImagePixelFailedMetrics.length
      ? "failed"
      : domImagePixelUnknownMetrics.length
        ? (domUnknownVerifiedByFileAndScreen ? "unknown-verified-by-file-and-screen" : "unknown-unproven")
        : "verified";
  const messagePixelEvidenceOk = !requireMessagePixels || Boolean(messageFixturePixelReport?.checked && messageFixturePixelReport?.ok);
  const screenshotImagePixelsRequired = Boolean(
    requireImagePixels || (
      hasVisibleImagePreviews && !state?.modalOpen && !state?.settingsOpen && !state?.accountOpen
    )
  );
  const provenanceSceneAudit = expectedState?.provenanceSceneViewportOk === true
    ? auditProvenanceSceneParameters(state?.provenanceSceneViewportMetrics)
    : { checked: false, ok: true, thresholds: null, checks: {}, failureReasons: [], derived: null };
  const authPolicy = visualPolicy === "auth";
  const stateLayerRequired = Boolean(state?.agentDebugReady || state?.agentDebugState);
  const focusPolicy = visualPolicy === "focus";
  const projectAgentContextRequired = Boolean(
    state?.agentPanelVisible &&
    !state?.projectAgentCollapsed &&
    !state?.settingsOpen &&
    !state?.accountOpen &&
    !state?.modalOpen
  );
  const canvasSelectionIndicatorRequired = Boolean(
    state?.canvasVisible &&
    !state?.settingsOpen &&
    !state?.accountOpen &&
    !state?.modalOpen
  );
  const selectionSurfacesRequired = projectAgentContextRequired && canvasSelectionIndicatorRequired;
  const canvasSelectionSemanticsRequired = Boolean(
    projectAgentContextRequired &&
    Array.isArray(state?.selectedNodeIds) &&
    state.selectedNodeIds.length === 0
  );
  const selectionIndicatorGeometry = state?.canvasSelectionIndicatorMetrics?.geometry || null;
  const selectedNodeGeometry = Array.isArray(state?.nodeLayouts)
    ? state.nodeLayouts.find((item) => item?.id === state?.selectedNodeId)?.geometry || null
    : null;
  const selectionIndicatorOverlap = selectionIndicatorGeometry && selectedNodeGeometry
    ? (() => {
        const width = Math.max(0, Math.min(Number(selectionIndicatorGeometry.right), Number(selectedNodeGeometry.right)) - Math.max(Number(selectionIndicatorGeometry.left), Number(selectedNodeGeometry.left)));
        const height = Math.max(0, Math.min(Number(selectionIndicatorGeometry.bottom), Number(selectedNodeGeometry.bottom)) - Math.max(Number(selectionIndicatorGeometry.top), Number(selectedNodeGeometry.top)));
        const area = width * height;
        return { width, height, area, ratio: area / Math.max(1, Number(selectedNodeGeometry.width || 0) * Number(selectedNodeGeometry.height || 0)) };
      })()
    : { width: 0, height: 0, area: 0, ratio: 0 };
  const captureRenderer = captureEnvironment?.renderer || null;
  const captureWindow = captureEnvironment?.actualWindow || null;
  const captureRequested = captureEnvironment?.requestedWindow || null;
  const captureRequestStatus = captureEnvironment?.request?.status || (captureRequested ? "requested" : "unknown");
  const captureRequestRecordedOk = captureRequestStatus === "not-requested"
    ? captureRequested == null
    : captureRequestStatus === "requested" && Number(captureRequested?.width) > 0 && Number(captureRequested?.height) > 0;
  const captureBrowserWindowRecordedOk = captureEnvironment?.browserWindow?.status === "available"
    ? Number(captureWindow?.width) > 0 && Number(captureWindow?.height) > 0
    : captureEnvironment?.browserWindow?.status === "unavailable" && Boolean(captureEnvironment?.browserWindow?.error);
  const captureCanvas = captureEnvironment?.canvas || null;
  const captureParametersOk = Boolean(
    captureRequestRecordedOk &&
    captureBrowserWindowRecordedOk &&
    Number(captureRenderer?.innerWidth) > 0 &&
    Number(captureRenderer?.innerHeight) > 0 &&
    Number(captureRenderer?.devicePixelRatio) > 0 &&
    captureEnvironment?.evidenceQuality?.ok === true &&
    (!state?.canvasVisible || (Number(captureCanvas?.scale) > 0 && Number(captureCanvas?.percent) > 0))
  );
  const functionalChecks = {
    expectedState: stateIssues.length === 0,
    horizontalOverflow: !overflow.documentOverflowX && !overflow.bodyOverflowX && overflow.elementOverflowX.length === 0,
    captureBridge: captureIssues.length === 0
  };
  const stateChecks = authPolicy
    ? {
        stateStableAcrossFrames: Boolean(stateStabilityReport?.ok)
      }
    : {
        stateLayers: !stateLayerRequired || state?.stateLayerConsistencyOk === true,
        stateStableAcrossFrames: Boolean(stateStabilityReport?.ok),
        canvasSelectionSemantics: !canvasSelectionSemanticsRequired || state?.canvasSelectionStateOk === true,
        selectionSurfaces: !selectionSurfacesRequired || state?.selectionSurfacesConsistentOk === true
      };
  const visualChecks = authPolicy
    ? {
        screenshotFrame: Boolean(frameReport?.ok),
        screenshotSurfaces: Boolean(surfaceReport?.ok),
        authGateStructure: !state?.authGateVisible || Boolean(state?.authGateOnlyOk && state?.authGateLayoutOk && state?.authGateControlsStyledOk),
        reloginWorkbench: Boolean(state?.authGateVisible || state?.authReloginCleanOk)
      }
    : {
        screenshotFrame: Boolean(frameReport?.ok),
        screenshotSurfaces: Boolean(surfaceReport?.ok),
        domVisibility: !stateLayerRequired || state?.domVisualEvidenceOk === true,
        canvasSelectionIndicator: !canvasSelectionIndicatorRequired || state?.canvasSelectionIndicatorVisibleOk === true,
        projectAgentContext: !projectAgentContextRequired || state?.projectAgentContextVisible === true,
        contextPrefixSingleLine: !state?.projectAgentContextPrefixPresent || state?.projectAgentContextPrefixSingleLineOk === true,
        selectionIndicatorDoesNotCoverSelection: selectionIndicatorOverlap.area <= 4,
        visibleNodeStyles: !Array.isArray(state?.visibleNodeStyleFailures) || state.visibleNodeStyleFailures.length === 0,
        nodeGeometry: Number(state?.visibleFlowNodeCount || 0) === 0 || state?.nodeOverlapOk === true,
        imagePixels: domImagePixelEvidenceOk,
        fileImageAssets: !fileImagePixelReport?.checked || fileImagePixelReport?.ok === true,
        screenshotImagePixels: !screenshotImagePixelsRequired || screenshotImagePixelEvidenceOk,
        selectedPreviewDetail: !focusPolicy || state?.selectedImagePreviewDetailOk === true,
         selectedScreenshotPixels: !focusPolicy || imagePreviewPixelReport?.selectedOk === true,
         provenanceSceneParameters: provenanceSceneAudit.ok,
         messagePixels: messagePixelEvidenceOk
      };
  const evidenceChecks = {
    realScreenshot: screenshotSource !== "fallback",
    dualFrameCapture: Boolean(dualFrameReport?.ok),
    screenshotHashes: Boolean(screenshotEvidence?.sha256 && screenshotEvidence?.firstFrameSha256 && screenshotEvidence?.finalFrameSha256),
    screenshotDimensions: Boolean(frameReport?.dimensionOk),
    captureParameters: captureParametersOk
  };
  const failureReasons = [];
  for (const [layer, checks] of Object.entries({ functional: functionalChecks, state: stateChecks, visual: visualChecks, evidence: evidenceChecks })) {
    for (const [key, value] of Object.entries(checks)) {
      if (!value) failureReasons.push(`${layer}:${key}`);
    }
  }
  if (Array.isArray(frameReport?.failureReasons)) failureReasons.push(...frameReport.failureReasons);
  if (Array.isArray(surfaceReport?.failureReasons)) failureReasons.push(...surfaceReport.failureReasons);
  if (Array.isArray(dualFrameReport?.failureReasons)) failureReasons.push(...dualFrameReport.failureReasons);
  if (Array.isArray(stateStabilityReport?.failureReasons)) failureReasons.push(...stateStabilityReport.failureReasons);
  if (state?.stateLayerFailures?.length) failureReasons.push(...state.stateLayerFailures.map((item) => `state-layer:${item.kind || "unknown"}`));
  if (state?.visualSurfaceFailures?.length) failureReasons.push(...state.visualSurfaceFailures.map((item) => `hidden-surface:${item.name || "unknown"}`));
  if (state?.nodeOverlapPairs?.length) failureReasons.push(...state.nodeOverlapPairs.slice(0, 6).map((item) => `node-overlap:${item.first}:${item.second}:${item.ratio}`));
  if (domImagePixelFailedMetrics.length) {
    failureReasons.push(...domImagePixelFailedMetrics.map((item) => `dom-image-pixel-failed:${item?.nodeId || "unknown"}:${item?.imageIndex ?? "unknown"}:${item?.error || item?.fetchError || "no-reason"}`));
  }
  if (domImagePixelUnknownMetrics.length && !domUnknownVerifiedByFileAndScreen) {
    failureReasons.push(...domUnknownFallbackProofs.filter((item) => !item.ok).map((item) => `dom-image-pixel-unknown-unproven:${item.key}:${item.domError}`));
  }
  if (Array.isArray(fileImagePixelReport?.failureReasons)) failureReasons.push(...fileImagePixelReport.failureReasons);
  if (Array.isArray(provenanceSceneAudit?.failureReasons)) failureReasons.push(...provenanceSceneAudit.failureReasons);
  const uniqueFailureReasons = [...new Set(failureReasons)];
  const functionalOk = Object.values(functionalChecks).every(Boolean);
  const stateOk = Object.values(stateChecks).every(Boolean);
  const visualOk = Object.values(visualChecks).every(Boolean);
  const evidenceOk = Object.values(evidenceChecks).every(Boolean);
  const assertionOk = functionalOk;
  return {
    ok: functionalOk && stateOk && visualOk && evidenceOk,
    assertionOk,
    functionalOk,
    stateOk,
    visualOk,
    evidenceOk,
    status: functionalOk
      ? (stateOk && visualOk && evidenceOk ? (domUnknownVerifiedByFileAndScreen ? "verified-by-file-and-screen" : "verified") : "assertion-green-evidence-unproven")
      : (stateOk && visualOk && evidenceOk ? "evidence-verified-functional-failed" : "failed"),
    layers: {
      functional: { ok: functionalOk, status: functionalOk ? "verified" : "failed", checks: functionalChecks },
      state: { ok: stateOk, status: stateOk ? "verified" : "failed", checks: stateChecks },
      gesture: { ok: null, status: "not-exercised", checks: {} },
      visual: {
        ok: visualOk,
        status: visualOk ? (domUnknownVerifiedByFileAndScreen ? "verified-by-file-and-screen" : "verified") : "failed-or-unknown",
        policy: visualPolicy,
        checks: visualChecks,
        domImagePixelStatus,
        domUnknownFallbackProofs,
        fileImagePixelStatus: fileImagePixelReport?.checked ? (fileImagePixelReport?.ok ? "verified" : "failed") : "not-applicable",
        screenshotImagePixelStatus: !screenshotImagePixelsRequired ? "not-required-for-surface" : (screenshotImagePixelEvidenceOk ? "verified" : "failed"),
        provenanceSceneAudit
      },
      evidence: { ok: evidenceOk, status: evidenceOk ? "verified" : "failed", checks: evidenceChecks }
    },
    failureReasons: uniqueFailureReasons,
    advisory: {
      centerOccludedNodeCount: Number(state?.centerOccludedNodeCount || 0),
      previewOccludedNodeCount: Number(state?.previewOccludedNodeCount || 0),
      imageGeometryOk: imagePreviewPixelReport?.geometryOk !== false,
      messagePixelChecked: Boolean(messageFixturePixelReport?.checked),
      staleClosureWarnings: state?.stateLayerClosureWarnings || [],
      captureEnvironment,
      selectionIndicatorOverlap,
      provenanceSceneAudit,
      domCanvasPixelUnknown: domImagePixelUnknownMetrics.map((item) => ({
        nodeId: item?.nodeId || "",
        imageIndex: item?.imageIndex,
        assetPath: item?.assetPath || "",
        error: item?.error || item?.bridgeError || item?.fetchError || "direct DOM canvas unavailable"
      }))
    }
  };
}

async function captureState(client, targetId, label, setupExpression, size, expectedState = {}, setupTimeoutMs = 30000, visualPolicy = "auto") {
  const scenarioStartedAtMs = Date.now();
  const scenarioStartedAt = new Date(scenarioStartedAtMs).toISOString();
  const requestApplication = size
    ? await setWindowSize(client, targetId, size.width, size.height)
    : { status: "not-requested" };
  if (setupExpression) await evaluate(client, setupExpression, setupTimeoutMs);
  await delay(500);
  // Chromium can return one compositor frame from the previous window size
  // immediately after Electron applies setContentSize. Prime that stale frame
  // before collecting the two frames used as release evidence.
  if (size) {
    try {
      await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 12000);
      await delay(160);
    } catch {
      // The real capture path below records any persistent CDP failure.
    }
  }
  if (typeof expectedState?.selectedNodeId === "string" && expectedState.selectedNodeId) {
    try {
      await waitForExpression(
        client,
        `window.__iiimageDebugAgentState?.().selectedNodeId === ${JSON.stringify(expectedState.selectedNodeId)}`,
        2400
      );
      await delay(160);
    } catch {
      // Keep the original assertion path so the captured report still shows the failed selection metrics.
    }
  }
  if (expectedState?.selectedImageFocusOk) {
    const expectedSelectedId = typeof expectedState?.selectedNodeId === "string" ? expectedState.selectedNodeId : "";
    try {
      await waitForExpression(client, `(() => {
        const expectedId = ${JSON.stringify(expectedSelectedId)};
        const nodes = Array.from(document.querySelectorAll(".flow-node"));
        const node = (expectedId ? nodes.find((item) => item.dataset.nodeId === expectedId) : null) || nodes.find((item) => item.classList.contains("selected"));
        const canvas = document.querySelector(".workflow-canvas");
        if (!node || !canvas || !node.classList.contains("image")) return false;
        const box = node.getBoundingClientRect();
        const canvasBox = canvas.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(box.right, canvasBox.right) - Math.max(box.left, canvasBox.left));
        const visibleHeight = Math.max(0, Math.min(box.bottom, canvasBox.bottom) - Math.max(box.top, canvasBox.top));
        const visibleRatio = (visibleWidth * visibleHeight) / Math.max(1, box.width * box.height);
        const composerBox = document.querySelector(".agent-composer")?.getBoundingClientRect?.() || null;
        const overlapWidth = composerBox ? Math.max(0, Math.min(box.right, composerBox.right) - Math.max(box.left, composerBox.left)) : 0;
        const overlapHeight = composerBox ? Math.max(0, Math.min(box.bottom, composerBox.bottom) - Math.max(box.top, composerBox.top)) : 0;
        return visibleRatio >= 0.96 && overlapWidth * overlapHeight <= 4;
      })()`, 3600);
      await delay(180);
    } catch {
      // Keep the original assertion path so the captured report still shows the failed focus metrics.
    }
  }
  if (expectedState?.imageNodeViewportOk) {
    try {
      await waitForExpression(client, "Boolean(window.__iiimageDebugAgentState?.().imageNodeViewportOk)", 1800);
      await delay(160);
    } catch {
      // Keep the original assertion path so the captured report still shows the failed viewport metrics.
    }
  }
  const preCaptureStability = await waitForGuiStateStability(client);
  const preFrameState = await readGuiState(client);
  const preFrameSnapshot = await evaluate(client, "window.__iiimageDebugLayoutSnapshot ? window.__iiimageDebugLayoutSnapshot() : null");
  const enrichedExpectedState = { ...expectedState };
  if (enrichedExpectedState.uiControlFoundationOk == null) {
    enrichedExpectedState.uiControlFoundationOk = true;
  }
  if (enrichedExpectedState.canvasDynamicStatusQuietOk == null) {
    enrichedExpectedState.canvasDynamicStatusQuietOk = true;
  }
  if (enrichedExpectedState.canvasExecutionChromeQuietOk == null) {
    enrichedExpectedState.canvasExecutionChromeQuietOk = true;
  }
  if (size?.width <= 740 && size?.height <= 760 && enrichedExpectedState.compactInspectorHeaderOk == null) {
    enrichedExpectedState.compactInspectorHeaderOk = true;
  }
  if (size?.width <= 740 && enrichedExpectedState.agentMessageLayoutOk == null) {
    enrichedExpectedState.agentMessageLayoutOk = true;
  }
  const { imagePreviewPixelProofOk, messageFixturePixelProofOk, messageFixturePixelKinds, ...stateExpected } = enrichedExpectedState;
  const resolvedVisualPolicy = visualPolicy === "focus" || visualPolicy === "overview" || visualPolicy === "auth"
    ? visualPolicy
    : (/focus(?:ed)?/i.test(label) || expectedState?.selectedImageFocusOk === true || expectedState?.selectedImagePreviewDetailOk === true ? "focus" : "overview");
  const screenshotPath = join(runDir, `${label}.png`);
  const firstFramePath = join(runDir, `${label}-frame-a.png`);
  const stabilitySampleStartedAtMs = Date.now();
  let firstScreenshotBuffer = null;
  let screenshotBuffer = fallbackPng;
  let screenshotSource = "fallback";
  let firstCdpScreenshotIssue = null;
  let secondCdpScreenshotIssue = null;
  let cdpScreenshotIssue = null;
  let screenshotWritten = false;
  try {
    firstScreenshotBuffer = await capturePngScreenshot(client, { captureBeyondViewport: false }, 12000);
    writeFileSync(firstFramePath, firstScreenshotBuffer);
  } catch (error) {
    firstCdpScreenshotIssue = error instanceof Error ? error.message : String(error);
  }
  await delay(180);
  const postFrameState = await readGuiState(client);
  const postFrameSnapshot = await evaluate(client, "window.__iiimageDebugLayoutSnapshot ? window.__iiimageDebugLayoutSnapshot() : null");
  try {
    screenshotBuffer = await capturePngScreenshot(client, { captureBeyondViewport: false }, 12000);
    screenshotSource = firstScreenshotBuffer ? "cdp-dual-frame" : "cdp-second-frame-only";
    writeFileSync(screenshotPath, screenshotBuffer);
    screenshotWritten = true;
  } catch (error) {
    secondCdpScreenshotIssue = error instanceof Error ? error.message : String(error);
    if (firstScreenshotBuffer) {
      screenshotBuffer = firstScreenshotBuffer;
      screenshotSource = "cdp-first-frame-only";
      writeFileSync(screenshotPath, screenshotBuffer);
      screenshotWritten = true;
    }
  }
  cdpScreenshotIssue = [firstCdpScreenshotIssue ? `frame-a: ${firstCdpScreenshotIssue}` : "", secondCdpScreenshotIssue ? `frame-b: ${secondCdpScreenshotIssue}` : ""].filter(Boolean).join("; ") || null;
  const state = postFrameState;
  const snapshot = postFrameSnapshot;
  const stateIssues = stateFailures(state, stateExpected);
  const overflow = overflowReport(snapshot);
  const captureIssues = [];
  let nativeCapture = null;
  try {
    nativeCapture = await evaluate(
      client,
      `window.__iiimageDebugCaptureGui ? window.__iiimageDebugCaptureGui(${JSON.stringify(label)}, ${JSON.stringify(captureScope)}) : Promise.resolve({ ok: false, error: "capture hook missing" })`
    );
  } catch (error) {
    nativeCapture = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!nativeCapture?.ok && resolvedVisualPolicy !== "auth") captureIssues.push({ key: "nativeCapture", expected: true, actual: nativeCapture?.error || false });
  if (nativeCapture?.ok && nativeCapture.source !== captureScope) captureIssues.push({ key: "nativeCapture.source", expected: captureScope, actual: nativeCapture.source || "unknown" });
  if (!screenshotWritten && nativeCapture?.ok && nativeCapture.path && existsSync(nativeCapture.path)) {
    try {
      screenshotBuffer = readFileSync(nativeCapture.path);
      screenshotSource = "native-fallback";
      writeFileSync(screenshotPath, screenshotBuffer);
      screenshotWritten = true;
    } catch (error) {
      captureIssues.push({ key: "nativeScreenshotFallback", expected: true, actual: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!screenshotWritten) {
    screenshotSource = "fallback";
    writeFileSync(screenshotPath, fallbackPng);
    if (cdpScreenshotIssue) captureIssues.push({ key: "cdpScreenshot", expected: true, actual: cdpScreenshotIssue });
  }
  const screenshotDimensions = screenshotBuffer.length >= 24 && screenshotBuffer.toString("ascii", 1, 4) === "PNG"
    ? { width: screenshotBuffer.readUInt32BE(16), height: screenshotBuffer.readUInt32BE(20) }
    : { width: 0, height: 0 };
  const captureEnvironment = await readCaptureEnvironment(client, targetId, size, state, {
    startedAt: scenarioStartedAt,
    elapsedBeforeCaptureMs: Date.now() - scenarioStartedAtMs,
    stableWaitMs: Date.now() - stabilitySampleStartedAtMs,
    requestApplication,
    screenshot: {
      source: screenshotSource,
      width: screenshotDimensions.width,
      height: screenshotDimensions.height,
      byteLength: screenshotBuffer.length,
      sha256: createHash("sha256").update(screenshotBuffer).digest("hex")
    }
  });
  const dualFrameReport = firstScreenshotBuffer && screenshotSource === "cdp-dual-frame"
    ? compareScreenshotFrames(firstScreenshotBuffer, screenshotBuffer)
    : {
        checked: false,
        ok: false,
        stable: false,
        firstSha256: firstScreenshotBuffer ? createHash("sha256").update(firstScreenshotBuffer).digest("hex") : "",
        secondSha256: screenshotWritten ? createHash("sha256").update(screenshotBuffer).digest("hex") : "",
        failureReasons: ["dual-frame-capture-incomplete"],
        firstCdpScreenshotIssue,
        secondCdpScreenshotIssue
      };
  const stateStabilityReport = compareGuiStatesForCapture(preFrameState, postFrameState);
  const screenshotEvidence = {
    source: screenshotSource,
    path: screenshotPath,
    firstFramePath: firstScreenshotBuffer ? firstFramePath : "",
    byteLength: screenshotBuffer.length,
    width: screenshotDimensions.width,
    height: screenshotDimensions.height,
    firstFrameByteLength: firstScreenshotBuffer?.length || 0,
    sha256: createHash("sha256").update(screenshotBuffer).digest("hex"),
    firstFrameSha256: firstScreenshotBuffer ? createHash("sha256").update(firstScreenshotBuffer).digest("hex") : "",
    finalFrameSha256: createHash("sha256").update(screenshotBuffer).digest("hex"),
    cdp: {
      firstIssue: firstCdpScreenshotIssue,
      secondIssue: secondCdpScreenshotIssue
    },
    native: nativeCapture ? {
      ok: Boolean(nativeCapture.ok),
      source: nativeCapture.source || "",
      path: nativeCapture.path || "",
      error: nativeCapture.error || ""
    } : null
  };
  const imagePreviewPixelReport = screenshotPreviewPixelReport(screenshotBuffer, state, snapshot);
  if (imagePreviewPixelProofOk && !imagePreviewPixelReport.ok) {
    captureIssues.push({ key: "imagePreviewPixelProofOk", expected: true, actual: imagePreviewPixelReport });
  }
  const messageFixturePixelReport = screenshotMessageFixturePixelReport(screenshotBuffer, state, snapshot, messageFixturePixelKinds);
  if (messageFixturePixelProofOk && !messageFixturePixelReport.ok) {
    captureIssues.push({ key: "messageFixturePixelProofOk", expected: true, actual: messageFixturePixelReport });
  }
  const screenshotFrameReport = screenshotFramePixelReport(screenshotBuffer, snapshot);
  const screenshotSurfaceReport = screenshotSurfacePixelReport(screenshotBuffer, state, snapshot);
  const fileImagePixelReport = await fileAssetPixelReport(state);
  const visualReliability = buildVisualReliabilityReport({
    state,
    stateIssues,
    overflow,
    captureIssues: [...captureIssues],
    screenshotSource,
    screenshotFramePixelReport: screenshotFrameReport,
    screenshotSurfacePixelReport: screenshotSurfaceReport,
    dualFrameReport,
    stateStabilityReport,
    screenshotEvidence,
    captureEnvironment,
    imagePreviewPixelReport,
    fileImagePixelReport,
    messageFixturePixelReport,
    expectedState: stateExpected,
    visualPolicy: resolvedVisualPolicy,
    requireImagePixels: Boolean(imagePreviewPixelProofOk),
    requireMessagePixels: Boolean(messageFixturePixelProofOk)
  });
  if (!visualReliability.ok) {
    captureIssues.push({
      key: "visualReliability",
      expected: "verified GUI evidence",
      actual: visualReliability.status,
      reasons: visualReliability.failureReasons
    });
  }
  const jsonPath = join(runDir, `${label}.json`);
  writeFileSync(jsonPath, JSON.stringify({
    label,
    state,
    stateIssues,
    snapshot,
    overflow,
    screenshotPath,
    screenshotSource,
    cdpScreenshotIssue,
    preFrameSnapshot,
    postFrameSnapshot,
    preCaptureStability,
    dualFrameReport,
    stateStabilityReport,
    screenshotEvidence,
    captureEnvironment,
    visualPolicy: resolvedVisualPolicy,
    screenshotFrameReport,
    screenshotSurfaceReport,
    fileImagePixelReport,
    imagePreviewPixelReport,
    messageFixturePixelReport,
    visualReliability,
    nativeCapture,
    captureIssues
  }, null, 2));
  if (stateIssues.length || overflow.documentOverflowX || overflow.bodyOverflowX || overflow.elementOverflowX.length || captureIssues.length) {
    recordObservation("issue", label, { stateIssues, overflow, captureIssues, visualReliability });
  }
  return {
    label,
    screenshotPath,
    jsonPath,
    screenshotSource,
    cdpScreenshotIssue,
    dualFrameReport,
    stateStabilityReport,
    preCaptureStability,
    screenshotEvidence,
    captureEnvironment,
    visualPolicy: resolvedVisualPolicy,
    screenshotFrameReport,
    screenshotSurfaceReport,
    fileImagePixelReport,
    imagePreviewPixelReport,
    messageFixturePixelReport,
    visualReliability,
    nativeCapture,
    snapshot,
    state,
    stateIssues,
    overflow,
    captureIssues
  };
}

async function seedClearCanvasProbe(client) {
  const state = await evaluate(client, `new Promise((resolve) => {
    window.__iiimageDebugOpenSurface?.("main");
    window.__iiimageDebugApplyAgentActions?.([
      { type: "workflow.canvas.clear", mode: "all" },
      {
        type: "workflow.node.create",
        toolRunId: "aidebug-seed-node-a",
        node: {
          title: "AIDebug 待清理节点 A",
          prompt: "用于验证 Agent 能否按自然语言请求清理画布。",
          nodeType: "intent",
          status: "review",
          x: 180,
          y: 160
        }
      },
      {
        type: "workflow.node.create",
        toolRunId: "aidebug-seed-node-b",
        node: {
          title: "AIDebug 待清理节点 B",
          prompt: "用于验证清画布任务是否真实删除节点。",
          nodeType: "intent",
          status: "review",
          x: 480,
          y: 250
        }
      }
    ]);
    setTimeout(() => resolve(window.__iiimageDebugAgentState?.()), 320);
  })`);
  recordObservation("info", "agent-clear-canvas-seeded", { nodeCount: state?.nodeCount ?? 0 });
  await waitForExpression(client, "Number(window.__iiimageDebugAgentState?.().nodeCount || 0) >= 2", 10000);
}

async function captureAgentRunningUiProbe(client, targetId) {
  const expected = {
    settingsOpen: false,
    historyOpen: false,
    modalOpen: false,
    accountOpen: false,
    titlebarOverlay: true,
    topbarControlsDockedOk: true,
    verticalOverflowFree: true,
    compactViewportFitOk: true,
    agentDebugReady: true,
    agentBusy: true,
    agentRunningUiOk: true,
    agentRunningStatusOk: true,
    stopButtonOk: true,
    runningTimelineDotOk: true,
    agentThinkingNoLeftRuleOk: true,
    agentRunningThinkingOpenOk: true,
    agentDoneThinkingCollapsedOk: true,
    composerBusyPlaceholderOk: true,
    composerControlsVisibleOk: true,
    composerViewportVisibleOk: true,
    timelineNodesVisible: true
  };
  const captures = [];
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-ui-1280",
    openSurfaceExpression("agent-running"),
    { width: 1280, height: 820 },
    {
      ...expected,
      composerModelCompact: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentMotionCoreOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-ui-540",
    openSurfaceExpression("agent-running"),
    { width: 540, height: 700 },
    {
      ...expected,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentPanelVisible: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      composerViewportVisibleOk: true,
      agentMotionCoreOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-supplement-draft-540",
    runningSupplementDraftExpression(Date.now()),
    { width: 540, height: 700 },
    {
      ...expected,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentPanelVisible: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      composerViewportVisibleOk: true,
      supplementButtonVisibleOk: true,
      supplementButtonPairOk: true,
      supplementDraftPromptPresent: true,
      agentRunningSupplementDraftOk: true,
      agentMotionCoreOk: true,
      supplementMotionOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-reference-strip-540",
    openSurfaceExpression("agent-running-references"),
    { width: 540, height: 700 },
    {
      ...expected,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentPanelVisible: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      composerViewportVisibleOk: true,
      supplementButtonVisibleOk: true,
      supplementButtonPairOk: true,
      referenceImageCount: 3,
      referenceStripVisibleOk: true,
      referenceThumbsVisibleOk: true,
      referenceThumbVisualOk: true,
      referenceThumbPolishOk: true,
      referenceRemoveButtonsOk: true,
      referenceStripLayoutOk: true,
      referenceAddButtonEnabledOk: true,
      referenceAddButtonDisabledOk: false,
      busyReferencePromptPresent: true,
      agentRunningReferenceStripOk: true,
      agentMotionCoreOk: true,
      supplementMotionOk: true,
      referenceRemoveMotionOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-reference-limit-540",
    openSurfaceExpression("agent-running-reference-limit"),
    { width: 540, height: 700 },
    {
      ...expected,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentPanelVisible: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      composerViewportVisibleOk: true,
      supplementButtonVisibleOk: true,
      supplementButtonPairOk: true,
      referenceImageCount: 6,
      referenceStripVisibleOk: true,
      referenceThumbsVisibleOk: true,
      referenceThumbVisualOk: true,
      referenceThumbPolishOk: true,
      referenceRemoveButtonsOk: true,
      referenceStripLayoutOk: true,
      referenceAddButtonEnabledOk: false,
      referenceAddButtonDisabledOk: true,
      busyReferencePromptPresent: true,
      agentRunningReferenceStripOk: true,
      agentMotionCoreOk: true,
      supplementMotionOk: true,
      referenceRemoveMotionOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-reference-remove-540",
    runningReferenceRemoveExpression(),
    { width: 540, height: 700 },
    {
      ...expected,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentPanelVisible: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      composerViewportVisibleOk: true,
      supplementButtonVisibleOk: true,
      supplementButtonPairOk: true,
      referenceImageCount: 5,
      referenceStripVisibleOk: true,
      referenceThumbsVisibleOk: true,
      referenceThumbVisualOk: true,
      referenceThumbPolishOk: true,
      referenceRemoveButtonsOk: true,
      referenceStripLayoutOk: true,
      referenceAddButtonEnabledOk: true,
      referenceAddButtonDisabledOk: false,
      busyReferencePromptPresent: true,
      agentRunningReferenceStripOk: true,
      agentMotionCoreOk: true,
      supplementMotionOk: true,
      referenceRemoveMotionOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-running-supplement-model-popover-540",
    runningSupplementDraftModelPopoverExpression(Date.now()),
    { width: 540, height: 700 },
    {
      ...expected,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentPanelVisible: true,
      composerPopoverOpen: true,
      composerPopoverDocked: true,
      composerPopoverAvoidsActions: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      composerViewportVisibleOk: true,
      supplementButtonVisibleOk: true,
      supplementButtonPairOk: true,
      busyModelPromptPresent: true,
      busySupplementModelPopoverOk: true,
      agentMotionCoreOk: true,
      supplementMotionOk: true,
      popoverMotionOk: true,
      agentMotionOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-stop-ui-540",
    openSurfaceExpression("agent-running", `document.querySelector(".send-button.is-stop")?.click();`),
    { width: 540, height: 700 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentBusy: false,
      agentIdle: true,
      agentStoppedStatusOk: true,
      sendButtonIdleOk: true,
      runningMessageCount: 0,
      agentInterruptMessageVisible: true,
      agentStopUiOk: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      timelineNodesVisible: true,
      agentTimelineBottomOk: true,
      canvasReadabilityOk: true
    }
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-stop-resend-540",
    stopThenResendExpression(Date.now()),
    { width: 540, height: 700 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentBusy: false,
      agentIdle: true,
      agentStoppedStatusOk: true,
      sendButtonIdleOk: true,
      runningMessageCount: 0,
      agentInterruptMessageVisible: true,
      interruptMessageCount: 1,
      stopResendPromptVisible: true,
      stopResendAfterInterruptOk: true,
      stopResendAssistantOk: true,
      stopResendRuntimeRequestOk: true,
      stopResendWorkflowToolOk: true,
      stopResendImageGenUsed: false,
      stopResendPromptCleared: true,
      agentStopResendOk: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      timelineNodesVisible: true,
      agentTimelineBottomOk: true,
      canvasReadabilityOk: true
    },
    60000
  ));
  captures.push(await captureState(
    client,
    targetId,
    "agent-busy-supplement-540",
    runningSupplementExpression(Date.now()),
    { width: 540, height: 700 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentBusy: false,
      agentIdle: true,
      agentStoppedStatusOk: true,
      sendButtonIdleOk: true,
      runningMessageCount: 0,
      busySupplementPromptVisible: true,
      busySupplementClickPathOk: true,
      busySupplementUserMetaOk: true,
      busySupplementAssistantOk: true,
      busySupplementRuntimeRequestOk: true,
      busySupplementWorkflowToolOk: true,
      busySupplementImageGenUsed: false,
      busySupplementPromptCleared: true,
      busySupplementLatestProgressOk: true,
      agentBusySupplementOk: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      timelineNodesVisible: true,
      agentTimelineBottomOk: true,
      canvasReadabilityOk: true
    },
    60000
  ));
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  return captures;
}

async function captureCurrentAgentNodeRunningProbe(client, targetId) {
  const expected = {
    settingsOpen: false,
    historyOpen: false,
    modalOpen: false,
    accountOpen: false,
    titlebarOverlay: true,
    workbenchMinWidthOk: true,
    topbarCanvasActionsFitOk: true,
    agentDebugReady: true,
    agentBusy: true,
    agentPanelVisible: true,
    projectAgentFixedOk: true,
    agentRunningUiOk: true,
    agentRunningStatusOk: true,
    stopButtonOk: true,
    runningTimelineDotOk: true,
    composerBusyPlaceholderOk: true,
    composerControlsVisibleOk: true,
    composerViewportVisibleOk: true,
    timelineNodesVisible: true
  };
  const desktop = await captureState(
    client,
    targetId,
    "agent-node-running-1280",
    openSurfaceExpression("agent-running"),
    { width: 1280, height: 820 },
    expected
  );
  const minimum = await captureState(
    client,
    targetId,
    "agent-node-running-min-884",
    openSurfaceExpression("agent-running"),
    { width: workbenchMinWidth, height: 720 },
    {
      ...expected,
      topbarCompactOk: true,
      compactViewportFitOk: true,
      verticalOverflowFree: true
    }
  );
  const stopped = await captureState(
    client,
    targetId,
    "agent-node-stop-min-884",
    openSurfaceExpression("agent-running", `document.querySelector(".project-agent-send")?.click();`),
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      workbenchMinWidthOk: true,
      topbarCompactOk: true,
      topbarCanvasActionsFitOk: true,
      agentDebugReady: true,
      agentBusy: false,
      agentIdle: true,
      agentPanelVisible: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      runningMessageCount: 0,
      verticalOverflowFree: true
    }
  );
  return [desktop, minimum, stopped];
}

async function captureAgentToolSuiteProbe(client, targetId) {
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "agent-tool-suite-request", {
    tools: ["shell_command", "workflow", "view_image"],
    prompt: "请调用 workflow list_nodes 查看当前画布节点，不要生成图片。"
  });
  const suite = await evaluate(client, `window.__iiimageAIDebug.runSuite()`);
  const suitePath = join(runDir, "agent-tool-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-tool-suite-failed", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error }))
    });
  } else {
    recordObservation("info", "agent-tool-suite-success", {
      suitePath,
      steps: suite.steps?.map((item) => item.label)
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-tool-suite-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const capture = await captureState(
    client,
    targetId,
    "agent-tool-suite-1280",
    openSurfaceExpression("agent-timeline"),
    { width: 1280, height: 820 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: 1,
      agentPanelVisible: true,
      timelineNodesVisible: true,
      agentTimelineLeftLineOk: true,
      agentToolTraceNoLeftRuleOk: true,
      agentToolTraceNoPseudoLeftRuleOk: true,
      agentToolTraceTitleBriefOk: true,
      agentImageGenTimerOk: true,
      agentImageGenStillRunningTextAbsent: true
    }
  );
  const compactCapture = await captureState(
    client,
    targetId,
    "agent-tool-suite-min-884",
    scrollExistingAgentFeedBottomExpression(),
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentPanelVisible: true,
      timelineNodesVisible: true,
      agentTimelineBottomOk: true,
      agentFeedScrolledToBottom: true,
      lastAgentMessageBottomVisible: true,
      composerDoesNotCoverLastMessage: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      agentMessageLayoutOk: true,
      agentToolTraceLayoutOk: true,
      agentToolTraceNoLeftRuleOk: true,
      agentToolTraceNoPseudoLeftRuleOk: true,
      agentToolTraceTitleBriefOk: true,
      agentToolTraceOperationHiddenOk: true,
      agentTimelineLeftLineOk: true,
      agentImageGenTimerOk: true,
      agentImageGenStillRunningTextAbsent: true,
      markdownCodeBlockLayoutOk: true
    }
  );
  return [{ ...capture, suite, suitePath }, compactCapture];
}

async function captureRealAgentSuiteProbe(client, targetId) {
  const suiteTimeoutMs = liveImage ? 600000 : 360000;
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runRealAgentSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "real-agent-suite-request", {
    liveImage,
    agentMode: mockAgent ? "mock-agent" : "real-agent",
    tools: ["shell_command", "workflow", "experience", "view_image", "web_search", "image_gen"],
    prompt: "AIDebug 真实 Agent 自主工具调用专项，只经 chat 入口，不使用 runTool 探针。"
  });
  const suite = await evaluate(client, `window.__iiimageAIDebug.runRealAgentSuite({ liveImage: ${JSON.stringify(liveImage)}, skipImage: ${JSON.stringify(realAgentToolsOnly)} })`, suiteTimeoutMs);
  const suitePath = join(runDir, "real-agent-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "real-agent-suite-failed", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "real-agent-suite-success", {
      suitePath,
      createdImageId: suite?.createdImageId,
      liveImage
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `real-agent-suite-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const capture = await captureState(
    client,
    targetId,
    "agent-real-agent-suite-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      ...(realAgentToolsOnly ? {} : {
        imagePreviewVisibleCountOk: true,
        imagePreviewLoadedOk: true,
        imagePreviewPixelProofOk: true,
        agentImageGenTimelineOrderOk: true
      })
    }
  );
  const compactCapture = await captureState(
    client,
    targetId,
    "agent-real-agent-suite-min-884",
    scrollExistingAgentFeedBottomExpression(),
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentPanelVisible: true,
      canvasVisible: true,
      timelineNodesVisible: true,
      composerViewportVisibleOk: true,
      agentTimelineBottomOk: true,
      agentFeedScrolledToBottom: true,
      lastAgentMessageBottomVisible: true,
      composerDoesNotCoverLastMessage: true,
      agentMessageLayoutOk: true,
      agentToolTraceLayoutOk: true,
      agentToolTraceOperationHiddenOk: true,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true,
      ...(realAgentToolsOnly ? {} : { agentImageGenTimelineOrderOk: true })
    }
  );
  return [
    { ...capture, suite, suitePath },
    { ...compactCapture, suite, suitePath, compactOf: "agent-real-agent-suite-1280" }
  ];
}

function agentUiPromptSuiteExpression(prompt, timeoutMs) {
  return `new Promise((resolve) => {
    const prompt = ${JSON.stringify(prompt)};
    const timeoutMs = ${Number(timeoutMs)};
    const startedAt = Date.now();
    const fail = (error, extra = {}) => {
      const state = window.__iiimageDebugAgentState?.() || {};
      resolve({ ok: false, error, state, durationMs: Date.now() - startedAt, ...extra });
    };
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const readState = () => window.__iiimageDebugAgentState?.() || {};
    window.__iiimageDebugOpenSurface?.("main");
    window.setTimeout(() => {
      const beforeState = readState();
      const beforeNodeIds = new Set((Array.isArray(beforeState.nodes) ? beforeState.nodes : []).map((node) => String(node.id || "")));
      const textarea = document.querySelector(".agent-composer textarea");
      if (!textarea) {
        fail("composer textarea missing", { beforeState });
        return;
      }
      textarea.focus();
      setTextareaValue(textarea, prompt);
      const submitStartedAt = Date.now();
      const submitTimer = window.setInterval(() => {
        const send = document.querySelector(".send-button:not(.is-stop), .project-agent-composer button[aria-label='发送']");
        if (send && !send.disabled) {
          window.clearInterval(submitTimer);
          send.click();
          const pollStartedAt = Date.now();
          const pollTimer = window.setInterval(() => {
            const state = readState();
            const progress = Array.isArray(state.progress) ? state.progress : [];
            const latestRunId =
              [...progress].reverse().find((item) => item?.runId && item.phase === "runtime-request")?.runId ||
              [...progress].reverse().find((item) => item?.runId)?.runId ||
              "";
            const runProgress = latestRunId ? progress.filter((item) => item?.runId === latestRunId) : progress;
            const modelForce = runProgress.filter((item) => item.phase === "model-force");
            const modelToolChoice = runProgress.filter((item) => item.phase === "model-tool-choice");
            const modelArgCorrect = runProgress.filter((item) => item.phase === "model-arg-correct");
            const modelContractWarning = runProgress.filter((item) => item.phase === "model-contract-warning");
            const modelRequestDetails = runProgress.filter((item) => item.phase === "model-request-detail").map((item) => item.detail || item.summary);
            const modelResponseDetails = runProgress.filter((item) => item.phase === "model-response-detail").map((item) => item.detail || item.summary);
            const usedImageGen = runProgress.some((item) => item.tool === "image_gen" || String(item.phase || "").startsWith("image-"));
            const toolStartImage = runProgress.some((item) => item.phase === "tool-start" && item.tool === "image_gen");
            const imageTaskModalOpen = Boolean(document.querySelector(".manual-image-task-dialog"));
            const newImageNodes = (Array.isArray(state.nodes) ? state.nodes : []).filter((node) =>
              !beforeNodeIds.has(String(node.id || "")) &&
              node.type === "image" &&
              node.imageState === "done" &&
              Number(node.assetCount || 0) > 0
            );
            const idle = state.agentStatus === "idle" || state.agentStatus === "error";
            if (idle) {
              window.clearInterval(pollTimer);
              const autonomous = Boolean(usedImageGen && !modelForce.length && !modelToolChoice.length && !modelArgCorrect.length && !modelContractWarning.length);
              const ok = Boolean(state.agentStatus === "idle" && autonomous && toolStartImage && newImageNodes.length && !imageTaskModalOpen);
              resolve({
                ok,
                prompt,
                durationMs: Date.now() - startedAt,
                latestRunId,
                autonomous,
                usedImageGen,
                toolStartImage,
                imageTaskModalOpen,
                newImageNodes,
                modelForce,
                modelToolChoice,
                modelArgCorrect,
                modelContractWarning,
                modelRequestDetails,
                modelResponseDetails,
                runProgress,
                beforeState,
                state,
                error: ok ? "" : "Agent did not complete a natural image_gen tool call from the real composer path."
              });
              return;
            }
            if (Date.now() - pollStartedAt > timeoutMs) {
              window.clearInterval(pollTimer);
              fail("agent-ui-prompt timed out", {
                prompt,
                latestRunId,
                runProgress,
                beforeState,
                timeoutMs
              });
            }
          }, 260);
          return;
        }
        if (Date.now() - submitStartedAt > 5000) {
          window.clearInterval(submitTimer);
          fail("send button did not become enabled", { beforeState });
        }
      }, 80);
    }, 240);
  })`;
}

function agentUiPromptSequenceExpression(initialPrompt, followupPrompt, timeoutMs, singleOnly = false, initialExpectedCount = 1, initialExpectedReviewCount = 1) {
  return `new Promise((resolve) => {
    const initialPrompt = ${JSON.stringify(initialPrompt)};
    const followupPrompt = ${JSON.stringify(followupPrompt)};
    const timeoutMs = ${Number(timeoutMs)};
    const singleOnly = ${JSON.stringify(Boolean(singleOnly))};
    const initialExpectedCount = ${JSON.stringify(Number(initialExpectedCount))};
    const initialExpectedReviewCount = ${JSON.stringify(Number(initialExpectedReviewCount))};
    const sequenceStartedAt = Date.now();
    const setTextareaValue = (textarea, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, value);
      else textarea.value = value;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const readState = () => window.__iiimageDebugAgentState?.() || {};
    const feedbackOnlyPattern = /^这张效果很好，优点是满足要求，具备设计感，很棒。没什么缺点，我需要你继续生成3张$/;
    const semanticPromptTokens = (value) => {
      const normalized = String(value || "").toLowerCase();
      const ignored = new Set(["image", "generate", "prompt", "tool", "生成", "图片", "一张", "完成", "效果", "用户", "需要", "继续", "提示", "工具", "画面", "要求", "设计", "风格"]);
      const tokens = new Set();
      for (const token of normalized.match(/[a-z][a-z0-9_-]{2,}/g) || []) {
        if (!ignored.has(token)) tokens.add(token);
      }
      for (const segment of normalized.match(/[\u3400-\u9fff]{2,}/g) || []) {
        const maxSize = Math.min(4, segment.length);
        for (let size = 2; size <= maxSize; size += 1) {
          for (let index = 0; index <= segment.length - size; index += 1) {
            const token = segment.slice(index, index + size);
            if (!ignored.has(token)) tokens.add(token);
          }
        }
      }
      return tokens;
    };
    const promptInheritanceReport = (source, target) => {
      const sourceTokens = semanticPromptTokens(source);
      const targetTokens = semanticPromptTokens(target);
      const sharedTokens = [...sourceTokens].filter((token) => targetTokens.has(token));
      return {
        ok: String(target || "").trim().length >= 60 && sharedTokens.length >= 4 && !feedbackOnlyPattern.test(String(target || "").trim()),
        sharedTokens: sharedTokens.slice(0, 20),
        sharedTokenCount: sharedTokens.length,
        sourceTokenCount: sourceTokens.size,
        targetTokenCount: targetTokens.size
      };
    };
    const parsedAspectRatio = (value) => {
      const [rawWidth, rawHeight, ...rest] = String(value || "").trim().replace("：", ":").split(":");
      if (rest.length) return 0;
      const width = Number(rawWidth);
      const height = Number(rawHeight);
      return width > 0 && height > 0 ? width / height : 0;
    };
    const runOne = (label, prompt, expected = {}) => new Promise((stepResolve) => {
      const startedAt = Date.now();
      const fail = (error, extra = {}) => {
        const state = readState();
        stepResolve({ ok: false, label, prompt, error, state, durationMs: Date.now() - startedAt, ...extra });
      };
      window.__iiimageDebugOpenSurface?.("main");
      window.setTimeout(() => {
        const beforeState = readState();
        const beforeNodeIds = new Set((Array.isArray(beforeState.nodes) ? beforeState.nodes : []).map((node) => String(node.id || "")));
        const textarea = document.querySelector(".agent-composer textarea, .project-agent-composer textarea");
        if (!textarea) {
          fail("composer textarea missing", { beforeState });
          return;
        }
        textarea.focus();
        setTextareaValue(textarea, prompt);
        const submitStartedAt = Date.now();
        const submitTimer = window.setInterval(() => {
          const send = document.querySelector(".send-button:not(.is-stop), .project-agent-composer button[aria-label='发送']");
          if (send && !send.disabled) {
            window.clearInterval(submitTimer);
            send.click();
            const pollStartedAt = Date.now();
            const pollTimer = window.setInterval(() => {
              const state = readState();
              const progress = Array.isArray(state.progress) ? state.progress : [];
              const latestRunId =
                [...progress].reverse().find((item) => item?.runId && item.phase === "runtime-request")?.runId ||
                [...progress].reverse().find((item) => item?.runId)?.runId ||
                "";
              const runProgress = latestRunId ? progress.filter((item) => item?.runId === latestRunId) : progress;
              const modelForce = runProgress.filter((item) => item.phase === "model-force");
              const modelToolChoice = runProgress.filter((item) => item.phase === "model-tool-choice");
              const modelArgCorrect = runProgress.filter((item) => item.phase === "model-arg-correct");
              const modelContractWarning = runProgress.filter((item) => item.phase === "model-contract-warning" || item.phase === "model-contract-failed");
              const modelRequestDetails = runProgress.filter((item) => item.phase === "model-request-detail").map((item) => item.detail || item.summary);
              const modelResponseDetails = runProgress.filter((item) => item.phase === "model-response-detail").map((item) => item.detail || item.summary);
              const imageToolInputs = runProgress
                .filter((item) => item.phase === "tool-start" && item.tool === "image_gen" && item.input && typeof item.input === "object" && !Array.isArray(item.input))
                .map((item) => item.input);
              const usedImageGen = runProgress.some((item) => item.tool === "image_gen" || String(item.phase || "").startsWith("image-"));
              const toolStartImage = runProgress.some((item) => item.phase === "tool-start" && item.tool === "image_gen");
              const imageDoneIndex = runProgress.findIndex((item) => item.phase === "tool-done" && item.tool === "image_gen");
              const viewImageStartIndex = runProgress.findIndex((item, index) => index > imageDoneIndex && item.phase === "tool-start" && item.tool === "view_image");
              const viewImageDoneIndex = runProgress.findIndex((item, index) => index > viewImageStartIndex && item.phase === "tool-done" && item.tool === "view_image");
              const viewImageStartCount = runProgress.filter((item, index) => index > imageDoneIndex && item.phase === "tool-start" && item.tool === "view_image").length;
              const imageReviewed = imageDoneIndex >= 0 && viewImageStartIndex > imageDoneIndex && viewImageDoneIndex > viewImageStartIndex;
              const imageTaskModalOpen = Boolean(document.querySelector(".manual-image-task-dialog"));
              const newImageNodes = (Array.isArray(state.nodes) ? state.nodes : []).filter((node) =>
                !beforeNodeIds.has(String(node.id || "")) &&
                node.type === "image" &&
                node.imageState === "done" &&
                Number(node.assetCount || 0) > 0
              );
              const newAssetCount = newImageNodes.reduce((total, node) => total + Number(node.assetCount || 0), 0);
              const latestImageInput = [...imageToolInputs].reverse().find((input) => String(input.prompt || "").trim()) || imageToolInputs[imageToolInputs.length - 1] || {};
              const expectedCount = Number(expected.count || 1);
              const expectedMinAssets = Number(expected.minAssets || expectedCount || 1);
              const countOk = !expected.count ||
                imageToolInputs.some((input) => Number(input.count || 1) === expectedCount) ||
                newImageNodes.some((node) => Number(node.assetCount || 0) === expectedCount);
              const parentOk = !expected.parentId || imageToolInputs.some((input) => String(input.parentId || "") === String(expected.parentId || ""));
              const relationOk = !expected.relationType || newImageNodes.some((node) => String(node.relationType || "") === String(expected.relationType || ""));
              const promptText = String(latestImageInput.prompt || "");
              const sourceNode = (Array.isArray(beforeState.nodes) ? beforeState.nodes : []).find((node) => String(node.id || "") === String(expected.parentId || ""));
              const promptInheritance = promptInheritanceReport(String(sourceNode?.prompt || initialPrompt), promptText);
              const promptInheritedOk = !expected.inheritVisualPrompt || promptInheritance.ok;
              const imageCountOk = newAssetCount >= expectedMinAssets;
              const targetAspectRatio = parsedAspectRatio(latestImageInput.ratio);
              const outputDimensions = newImageNodes.flatMap((node) =>
                (Array.isArray(node.assets) ? node.assets : []).map((asset) => ({
                  width: Number(asset?.width || 0),
                  height: Number(asset?.height || 0)
                }))
              );
              const outputRatioOk = !targetAspectRatio || Boolean(
                outputDimensions.length >= expectedMinAssets &&
                outputDimensions.every(({ width, height }) => width > 0 && height > 0 && Math.abs(width / height - targetAspectRatio) <= 0.025)
              );
              const reviewOk = !expected.requireViewImage || (imageReviewed && viewImageStartCount >= Number(expected.minViewImages || 1));
              const idle = state.agentStatus === "idle" || state.agentStatus === "error";
              if (idle) {
                window.clearInterval(pollTimer);
                const autonomous = Boolean(usedImageGen && !modelForce.length && !modelToolChoice.length && !modelArgCorrect.length && !modelContractWarning.length);
                const ok = Boolean(
                  state.agentStatus === "idle" &&
                  autonomous &&
                  toolStartImage &&
                  imageCountOk &&
                  countOk &&
                  parentOk &&
                  relationOk &&
                  promptInheritedOk &&
                  outputRatioOk &&
                  reviewOk &&
                  !imageTaskModalOpen
                );
                stepResolve({
                  ok,
                  label,
                  prompt,
                  durationMs: Date.now() - startedAt,
                  latestRunId,
                  autonomous,
                  usedImageGen,
                  toolStartImage,
                  imageTaskModalOpen,
                  newImageNodes,
                  newAssetCount,
                  imageToolInputs,
                  latestImageInput,
                  expected,
                  countOk,
                  parentOk,
                  relationOk,
                  promptInheritedOk,
                  promptInheritance,
                  imageCountOk,
                  targetAspectRatio,
                  outputDimensions,
                  outputRatioOk,
                  imageReviewed,
                  viewImageStartCount,
                  reviewOk,
                  modelForce,
                  modelToolChoice,
                  modelArgCorrect,
                  modelContractWarning,
                  modelRequestDetails,
                  modelResponseDetails,
                  runProgress,
                  beforeState,
                  state,
                  error: ok ? "" : "Agent did not satisfy the natural real-composer image generation expectation."
                });
                return;
              }
              if (Date.now() - pollStartedAt > timeoutMs) {
                window.clearInterval(pollTimer);
                fail("agent-ui-prompt timed out", {
                  latestRunId,
                  runProgress,
                  beforeState,
                  timeoutMs
                });
              }
            }, 260);
            return;
          }
          if (Date.now() - submitStartedAt > 5000) {
            window.clearInterval(submitTimer);
            fail("send button did not become enabled", { beforeState });
          }
        }, 80);
      }, 240);
    });
    (async () => {
      const requireViewImage = ${JSON.stringify(realAgent && liveImage)};
      const initial = await runOne("initial-image", initialPrompt, { count: initialExpectedCount, minAssets: initialExpectedCount, minViewImages: initialExpectedReviewCount, requireViewImage });
      const parentId = initial?.newImageNodes?.[0]?.id || "";
      const followup = singleOnly
        ? null
        : parentId
          ? await runOne("feedback-continue-3", followupPrompt, { count: 3, minAssets: 3, parentId, relationType: "variant", inheritVisualPrompt: true, requireViewImage })
          : { ok: false, label: "feedback-continue-3", prompt: followupPrompt, skipped: true, error: "initial image did not create a parent node" };
      const steps = followup ? [initial, followup] : [initial];
      const modelForce = steps.flatMap((step) => Array.isArray(step.modelForce) ? step.modelForce : []);
      const modelToolChoice = steps.flatMap((step) => Array.isArray(step.modelToolChoice) ? step.modelToolChoice : []);
      const modelArgCorrect = steps.flatMap((step) => Array.isArray(step.modelArgCorrect) ? step.modelArgCorrect : []);
      const modelContractWarning = steps.flatMap((step) => Array.isArray(step.modelContractWarning) ? step.modelContractWarning : []);
      const modelRequestDetails = steps.flatMap((step) => Array.isArray(step.modelRequestDetails) ? step.modelRequestDetails : []);
      const modelResponseDetails = steps.flatMap((step) => Array.isArray(step.modelResponseDetails) ? step.modelResponseDetails : []);
      const newImageNodes = steps.flatMap((step) => Array.isArray(step.newImageNodes) ? step.newImageNodes : []);
      const ok = steps.every((step) => step.ok);
      resolve({
        ok,
        prompt: initialPrompt,
        followupPrompt,
        durationMs: Date.now() - sequenceStartedAt,
        autonomous: steps.every((step) => step.autonomous),
        usedImageGen: steps.every((step) => step.usedImageGen),
        toolStartImage: steps.every((step) => step.toolStartImage),
        imageTaskModalOpen: steps.some((step) => step.imageTaskModalOpen),
        newImageNodes,
        modelForce,
        modelToolChoice,
        modelArgCorrect,
        modelContractWarning,
        modelRequestDetails,
        modelResponseDetails,
        steps,
        initialParentId: parentId,
        error: ok ? "" : "One or more real-composer Agent image steps failed."
      });
    })().catch((error) => {
      resolve({
        ok: false,
        prompt: initialPrompt,
        followupPrompt,
        durationMs: Date.now() - sequenceStartedAt,
        error: error instanceof Error ? error.message : String(error),
        state: readState()
      });
    });
  })`;
}

async function captureAgentUiPromptSuiteProbe(client, targetId) {
  const suiteTimeoutMs = liveImage ? 600000 : realAgent ? 360000 : 120000;
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageDebugAgentState && document.querySelector('.agent-composer textarea, .project-agent-composer textarea'))", 10000);
  recordObservation("info", "agent-ui-prompt-suite-request", {
    liveImage,
    agentMode: mockAgent ? "mock-agent" : "real-agent",
    prompt: agentUiPrompt,
    followupPrompt: agentUiFollowupPrompt,
    referenceCount: agentUiReferencePaths.length,
    singleOnly: agentUiSingleOnly,
    expectedCount: agentUiExpectedCount,
    expectedReviewCount: agentUiExpectedReviewCount
  });
  const referenceImport = agentUiReferencePaths.length
    ? await evaluate(
        client,
        `window.__iiimageDebugImportPathsAsReferences?.({ paths: ${JSON.stringify(agentUiReferencePaths)} })`,
        180000
      )
    : { ok: true, imported: [], skipped: true };
  if (agentUiReferencePaths.length && referenceImport?.ok !== false) {
    await waitForExpression(
      client,
      `Number(window.__iiimageDebugAgentState?.().referenceImageCount || 0) >= ${agentUiReferencePaths.length}`,
      30000
    );
  }
  const suite = await evaluate(
    client,
    agentUiPromptSequenceExpression(agentUiPrompt, agentUiFollowupPrompt, suiteTimeoutMs, agentUiSingleOnly, agentUiExpectedCount, agentUiExpectedReviewCount),
    (agentUiSingleOnly ? suiteTimeoutMs : suiteTimeoutMs * 2) + 20000
  );
  suite.referenceImport = referenceImport;
  suite.referencePaths = agentUiReferencePaths.map((value) => value.split(/[\\/]/).at(-1) || value);
  const initialMessages = Array.isArray(suite?.steps?.[0]?.state?.messages) ? suite.steps[0].state.messages : [];
  const initialUserMessage = [...initialMessages].reverse().find((message) => message?.role === "user" && String(message?.content || "").includes(agentUiPrompt.trim()));
  const scopedReferences = Array.isArray(initialUserMessage?.attachments?.referenceAssets) ? initialUserMessage.attachments.referenceAssets : [];
  const referenceScopeOk = agentUiReferencePaths.length === 0 || (
    scopedReferences.length === agentUiReferencePaths.length &&
    scopedReferences.every((item) => item?.role === "reference" && item?.assetId && item?.displayCode)
  );
  const followupMessages = Array.isArray(suite?.steps?.[1]?.state?.messages) ? suite.steps[1].state.messages : [];
  const followupUserMessage = [...followupMessages].reverse().find((message) => message?.role === "user" && String(message?.content || "").includes(agentUiFollowupPrompt.trim()));
  const scopedSources = Array.isArray(followupUserMessage?.attachments?.sourceAssets) ? followupUserMessage.attachments.sourceAssets : [];
  const sourceScopeOk = agentUiSingleOnly || Boolean(scopedSources.length && scopedSources.every((item) => item?.role === "source" && item?.assetId && item?.displayCode));
  suite.taskScopeEvidence = {
    ok: referenceScopeOk && sourceScopeOk,
    referenceScopeOk,
    sourceScopeOk,
    referenceCount: scopedReferences.length,
    sourceCount: scopedSources.length,
    references: scopedReferences.map((item) => ({ assetId: item.assetId, displayCode: item.displayCode, role: item.role })),
    sources: scopedSources.map((item) => ({ assetId: item.assetId, displayCode: item.displayCode, role: item.role, nodeId: item.nodeId }))
  };
  if (!suite.taskScopeEvidence.ok) {
    suite.ok = false;
    suite.error = suite.error || "Agent composer did not preserve SOURCE/REFERENCE TaskScope identity.";
  }
  if (agentUiReferencePaths.length && referenceImport?.ok === false) {
    suite.ok = false;
    suite.error = suite.error || "Reference images could not be imported into the Agent composer.";
  }
  const suitePath = join(runDir, "agent-ui-prompt-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-ui-prompt-suite-failed", {
      suitePath,
      error: suite?.error,
      usedImageGen: suite?.usedImageGen,
      autonomous: suite?.autonomous,
      modelForce: suite?.modelForce?.length || 0,
      modelToolChoice: suite?.modelToolChoice?.length || 0,
      modelArgCorrect: suite?.modelArgCorrect?.length || 0,
      modelContractWarning: suite?.modelContractWarning?.length || 0,
      taskScopeEvidence: suite?.taskScopeEvidence,
      steps: suite?.steps?.map((step) => ({
        label: step.label,
        ok: step.ok,
        countOk: step.countOk,
        parentOk: step.parentOk,
        relationOk: step.relationOk,
        promptInheritedOk: step.promptInheritedOk,
        imageCountOk: step.imageCountOk,
        outputRatioOk: step.outputRatioOk,
        outputDimensions: step.outputDimensions,
        reviewOk: step.reviewOk,
        error: step.error
      })),
      modelResponseDetails: suite?.modelResponseDetails
    });
  } else {
    recordObservation("info", "agent-ui-prompt-suite-success", {
      suitePath,
      taskScopeEvidence: suite?.taskScopeEvidence,
      newImageNodes: suite?.newImageNodes?.map((node) => node.id)
    });
  }
  await evaluate(client, `window.__iiimageAIDebug?.fitCanvas?.()`);
  const expectedPreviewCount = Math.max(
    1,
    (Array.isArray(suite?.newImageNodes) ? suite.newImageNodes : [])
      .reduce((sum, node) => sum + Math.max(1, Number(node?.assetCount ?? node?.assets?.length ?? 1)), 0)
  );
  await waitForCanvasImagePreviews(client, expectedPreviewCount, 60000);
  const capture = await captureState(
    client,
    targetId,
    "agent-ui-prompt-suite-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true,
      composerViewportVisibleOk: true,
      agentMessageLayoutOk: true,
      agentToolTraceLayoutOk: true,
      agentToolTraceOperationHiddenOk: true
    }
  );
  const compactCapture = await captureState(
    client,
    targetId,
    "agent-ui-prompt-suite-min-884",
    scrollExistingAgentFeedBottomExpression(),
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      workbenchMinWidthOk: true,
      compactMainGridOk: true,
      agentDebugReady: true,
      agentIdle: true,
      agentPanelVisible: true,
      canvasVisible: true,
      composerViewportVisibleOk: true,
      agentTimelineBottomOk: true,
      agentFeedScrolledToBottom: true,
      lastAgentMessageBottomVisible: true,
      composerDoesNotCoverLastMessage: true,
      agentMessageLayoutOk: true,
      agentToolTraceLayoutOk: true,
      agentToolTraceOperationHiddenOk: true
    }
  );
  return [
    { ...capture, suite, suitePath },
    { ...compactCapture, suite, suitePath, compactOf: "agent-ui-prompt-suite-1280" }
  ];
}

async function captureAgentMessageFixtureProbe(client, targetId) {
  const topCapture = await captureState(
    client,
    targetId,
    "agent-message-fixture-trace-min-884",
    agentMessageFixtureExpression("top"),
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentPanelVisible: true,
      timelineNodesVisible: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      agentMessageLayoutOk: true,
      agentToolTracePresent: true,
      agentToolTraceLayoutOk: true,
      agentToolTraceOperationHiddenOk: true,
      markdownCodeBlockPresent: true,
      markdownCodeBlockLayoutOk: true,
      markdownCodeHeaderPolishOk: true,
      agentPasteBlockPresent: true,
      agentPasteBlockLayoutOk: true,
      messageFixturePixelProofOk: true,
      messageFixturePixelKinds: ["tool-trace"]
    }
  );
  const bottomCapture = await captureState(
    client,
    targetId,
    "agent-message-fixture-bottom-min-884",
    scrollExistingAgentFeedBottomExpression(),
    { width: workbenchMinWidth, height: 720 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentPanelVisible: true,
      timelineNodesVisible: true,
      agentTimelineBottomOk: true,
      agentFeedScrolledToBottom: true,
      lastAgentMessageBottomVisible: true,
      composerDoesNotCoverLastMessage: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      agentMessageLayoutOk: true,
      agentToolTracePresent: true,
      agentToolTraceLayoutOk: true,
      agentToolTraceOperationHiddenOk: true,
      markdownCodeBlockPresent: true,
      markdownCodeBlockLayoutOk: true,
      markdownCodeHeaderPolishOk: true,
      agentPasteBlockPresent: true,
      agentPasteBlockLayoutOk: true,
      messageFixturePixelProofOk: true,
      messageFixturePixelKinds: ["code-block", "paste-block"]
    }
  );
  return [topCapture, bottomCapture];
}

const {
  captureAgentImageRecoverySuiteProbe,
  captureAgentImageSuiteProbe,
  captureCanvasImageCollectionSuiteProbe
} = createImageGenerationSuiteProbes({
  captureState,
  dragFixturePaths,
  evaluate,
  imageRuns,
  liveImage,
  recordObservation,
  runDir,
  setWindowSize,
  waitForCanvasImagePreviews,
  waitForExpression,
  workbenchMinWidth
});

const {
  captureCutoutSuiteProbe,
  captureLayerStackSuiteProbe,
  captureRegionRedrawSuiteProbe
} = createLayerEditingSuiteProbes({
  aidebugConfigDir,
  captureState,
  evaluate,
  fileSha256,
  generatedMaskPathForLayer,
  layerCompositeScreenshotMatchReport,
  liveImage,
  pngFileAlphaGeometryReport,
  pngFileAlphaReport,
  pngFileMagentaReport,
  pngFilesVisualFidelityReport,
  pngTextLayerShapeReport,
  realAgent,
  recordObservation,
  runDir,
  runLayerSemanticReplayAudit,
  setWindowSize,
  waitForExpression,
  workbenchMinWidth
});







async function captureAgentPosterBatchProbe(client, targetId, total = posterCount, agentCount = posterAgentCount, directCount = posterDirectCount) {
  const payload = { total, agentCount, directCount, resolution: posterResolution, quality: posterQuality };
  const suiteTimeoutMs = Math.max(300000, Number(total || 1) * 220000);
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runPosterBatchSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "agent-poster-batch-request", {
    ...payload,
    prompt: "AIDebug 执行真实 9:16 二次元写实风微海报批量生图，覆盖 Agent 与直接 image_gen 链路。"
  });
  await evaluate(client, `(() => {
    window.__iiimagePosterBatchAsync = { done: false, ok: true, startedAt: new Date().toISOString() };
    Promise.resolve(window.__iiimageAIDebug.runPosterBatchSuite(${JSON.stringify(payload)})).then(
      (result) => { window.__iiimagePosterBatchAsync = { done: true, ok: true, startedAt: window.__iiimagePosterBatchAsync?.startedAt, finishedAt: new Date().toISOString(), result }; },
      (error) => { window.__iiimagePosterBatchAsync = { done: true, ok: false, startedAt: window.__iiimagePosterBatchAsync?.startedAt, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }; }
    );
    return true;
  })()`);
  const suiteStartedAt = Date.now();
  let heartbeatKey = "";
  let asyncStatus = null;
  while (Date.now() - suiteStartedAt < suiteTimeoutMs) {
    asyncStatus = await evaluate(client, `(() => {
      const run = window.__iiimagePosterBatchAsync || {};
      const heartbeat = window.__iiimagePosterBatchHeartbeat || {};
      return { done: Boolean(run.done), ok: run.ok !== false, error: run.error || "", startedAt: run.startedAt || "", finishedAt: run.finishedAt || "", heartbeat };
    })()`);
    const heartbeat = asyncStatus?.heartbeat || {};
    const nextHeartbeatKey = [heartbeat.stage, heartbeat.label, heartbeat.completedSteps, heartbeat.recordedPosters, heartbeat.ok, heartbeat.error].join("|");
    if (nextHeartbeatKey && nextHeartbeatKey !== heartbeatKey) {
      heartbeatKey = nextHeartbeatKey;
      recordObservation("info", "agent-poster-batch-heartbeat", heartbeat);
    }
    if (asyncStatus?.done) break;
    await delay(500);
  }
  if (!asyncStatus?.done) {
    throw new Error(`Poster batch suite timed out after ${suiteTimeoutMs}ms; last heartbeat=${JSON.stringify(asyncStatus?.heartbeat || {})}`);
  }
  if (!asyncStatus.ok) throw new Error(`Poster batch suite failed: ${asyncStatus.error || "unknown renderer error"}`);
  const suite = await evaluate(client, `window.__iiimagePosterBatchAsync?.result`, Math.min(suiteTimeoutMs, 120000));
  const suitePath = join(runDir, "agent-poster-batch-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-poster-batch-failed", {
      suitePath,
      requested: payload,
      generatedCount: suite?.generatedCount,
      agentGenerated: suite?.agentGenerated,
      directGenerated: suite?.directGenerated,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "agent-poster-batch-success", {
      suitePath,
      requested: payload,
      generatedCount: suite?.generatedCount,
      agentGenerated: suite?.agentGenerated,
      directGenerated: suite?.directGenerated,
      posterNodeIds: suite?.posterNodeIds,
      assetLocations: Array.isArray(suite?.assets)
        ? suite.assets.flatMap((item) => (Array.isArray(item.assets) ? item.assets : []).map((asset) => asset.path || asset.url || asset.assetUrl).filter(Boolean)).slice(0, 40)
        : []
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-poster-batch-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const expectedImageNodes = Number(suite?.generatedCount || total);
  const capture = await captureState(
    client,
    targetId,
    "agent-poster-batch-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: expectedImageNodes,
      agentImageNodeCount: expectedImageNodes,
      nodeFooterGapOk: true,
      imageNodeViewportOk: true,
      canvasReadabilityOk: true,
      compactCanvasDensityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  const compactCapture = await captureState(
    client,
    targetId,
    "agent-poster-batch-540",
    `window.__iiimageDebugOpenSurface?.("main")`,
    { width: 540, height: 700 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
       agentIdle: true,
       canvasVisible: true,
       agentPanelVisible: true,
       compactMainGridOk: true,
       agentNodeCount: expectedImageNodes,
       agentImageNodeCount: expectedImageNodes,
      nodeFooterGapOk: true,
      imageNodeViewportOk: true,
      timelineNodesVisible: true,
      composerViewportVisibleOk: true,
      canvasReadabilityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  return [
    { ...capture, suite, suitePath },
    { ...compactCapture, suite, suitePath, compactOf: "agent-poster-batch-1280" }
  ];
}

async function captureAgentExperienceImageProbe(client, targetId) {
  const suiteTimeoutMs = 300000;
  await setWindowSize(client, targetId, 540, 700);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runExperienceImageSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "agent-experience-image-request", {
    viewport: "540x700",
    prompt: "AIDebug 540px Agent 自主经验写入、读回并生图专项。"
  });
  const suite = await evaluate(client, `window.__iiimageAIDebug.runExperienceImageSuite()`, suiteTimeoutMs);
  const suitePath = join(runDir, "agent-experience-image-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-experience-image-failed", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "agent-experience-image-success", {
      suitePath,
      experienceSentinel: suite?.agentExperienceSentinel,
      experienceRecorded: suite?.experienceRecorded,
      experienceRead: suite?.experienceRead,
      imageId: suite?.imageId
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-experience-image-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const capture = await captureState(
    client,
    targetId,
    "agent-experience-image-540",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      canvasVisible: true,
      agentPanelVisible: true,
      compactMainGridOk: true,
      agentNodeCount: 1,
      imageNodeCount: 1,
      nodeFooterGapOk: true,
      imageNodeViewportOk: true,
      timelineNodesVisible: true,
      canvasReadabilityOk: true,
      compactCanvasDensityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  return { ...capture, suite, suitePath };
}

async function captureAgentMixedStressProbe(client, targetId, rounds = stressRounds) {
  const suiteTimeoutMs = Math.max(300000, Number(rounds || 1) * 260000);
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runMixedStressSuite && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", "agent-mixed-stress-request", {
    rounds,
    prompt: "AIDebug 混合压力测试：experience、command、workflow、真实 image_gen 和 Agent 续图连续组合。"
  });
  const suite = await evaluate(client, `window.__iiimageAIDebug.runMixedStressSuite({ rounds: ${Number(rounds)} })`, suiteTimeoutMs);
  const expectedImageNodes = Number(suite?.expectedImageNodes || Number(rounds) * 2);
  // The current product canvas contains image artifacts only; the historical
  // Agent-core canvas node no longer exists and must not be counted.
  const expectedTotalNodes = expectedImageNodes;
  const suitePath = join(runDir, "agent-mixed-stress-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite?.ok) {
    recordObservation("issue", "agent-mixed-stress-failed", {
      suitePath,
      steps: suite?.steps?.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues: suite?.issues
    });
  } else {
    recordObservation("info", "agent-mixed-stress-success", {
      suitePath,
      rounds,
      imageNodeIds: suite?.imageNodeIds,
      experienceSentinels: suite?.experienceSentinels,
      experienceRoundCount: suite?.experienceSentinels?.length || 0,
      compactDoneCount: suite?.compactDoneCount,
      compactImageContinuations: suite?.compactImageContinuations,
      compactSummaryRequired: suite?.compactSummaryRequired,
      compactSummaryImageOk: suite?.compactSummaryImageOk
    });
  }
  for (const issue of Array.isArray(suite?.issues) ? suite.issues : []) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-mixed-stress-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const capture = await captureState(
    client,
    targetId,
    "agent-mixed-stress-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: expectedTotalNodes,
      nodeFooterGapOk: true,
      imageNodeViewportOk: true,
      timelineNodesVisible: true,
      canvasReadabilityOk: true,
      compactCanvasDensityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  const compactCapture = await captureState(
    client,
    targetId,
    "agent-mixed-stress-884",
    `window.__iiimageDebugOpenSurface?.("main")`,
    { width: 884, height: 700 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      canvasVisible: true,
      agentPanelVisible: true,
      compactMainGridOk: true,
      agentNodeCount: expectedTotalNodes,
      nodeFooterGapOk: true,
      imageNodeViewportOk: true,
      timelineNodesVisible: true,
      composerViewportVisibleOk: true,
      canvasReadabilityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  const focusTargetIds = Array.from(new Set((Array.isArray(suite?.imageNodeIds) ? suite.imageNodeIds : []).map((id) => String(id || "")).filter(Boolean)));
  const focusTargetIndexes = Array.from(new Set([0, Math.floor((focusTargetIds.length - 1) / 2), focusTargetIds.length - 1].filter((index) => index >= 0)));
  const focusCaptures = [];
  if (focusTargetIndexes.length) {
    recordObservation("info", "agent-mixed-focus-request", {
      targets: focusTargetIndexes.map((index) => ({ index, id: focusTargetIds[index] }))
    });
  }
  for (const index of focusTargetIndexes) {
    const id = focusTargetIds[index];
    const name = index === 0 ? "first" : index === focusTargetIds.length - 1 ? "last" : "middle";
    const focusCapture = await captureState(
      client,
      targetId,
      `agent-mixed-focus-${name}-884`,
      `window.__iiimageDebugOpenSurface?.("main"); window.__iiimageAIDebug?.selectNode?.({ id: ${JSON.stringify(id)} })`,
      { width: 884, height: 700 },
      {
        settingsOpen: false,
        historyOpen: false,
        modalOpen: false,
        accountOpen: false,
        titlebarOverlay: true,
        topbarCompactOk: true,
        topbarControlsDockedOk: true,
        verticalOverflowFree: true,
        compactViewportFitOk: true,
        agentDebugReady: true,
        agentDebugApiReady: true,
        agentIdle: true,
        canvasVisible: true,
        agentPanelVisible: true,
        compactMainGridOk: true,
        agentNodeCount: expectedTotalNodes,
        selectedNodeId: id,
        selectedNodeType: "image",
        selectedImageFocusOk: true,
        selectedNodeVisibleOk: true,
        selectedImageNodeViewportOk: true,
        selectedNodeTitleVisibleOk: true,
        selectedNodeSpacingOk: true,
        selectedNodeComposerOverlapOk: true,
        canvasZoomUsableOk: true,
        visibleImageNodeCountOk: true,
        nodeFooterGapOk: true,
        timelineNodesVisible: true,
        composerViewportVisibleOk: true,
        canvasReadabilityOk: true,
        compactCanvasDensityOk: true,
        imagePreviewVisibleCountOk: true,
        imagePreviewLoadedOk: true,
        imagePreviewPixelProofOk: true
      },
      10000
    );
    focusCaptures.push({ ...focusCapture, suite, suitePath, compactOf: "agent-mixed-stress-1280", focusTargetId: id, focusTargetIndex: index });
  }
  const selectedContinuationSequence = focusTargetIndexes.map((index) => focusTargetIds[index]).filter(Boolean);
  let selectedContinuation = { ok: false, error: "not-run", sequence: selectedContinuationSequence };
  let selectedContinuationPath = "";
  let selectedContinuationCapture = null;
  let directContinuation = { ok: false, error: "not-run", sequence: selectedContinuationSequence, directProbe: true };
  let directContinuationPath = "";
  let directContinuationCapture = null;
  if (selectedContinuationSequence.length >= 2) {
    recordObservation("info", "agent-selected-continuation-request", {
      sequence: selectedContinuationSequence,
      prompt: "先切换多个图片节点，再要求 Agent 基于当前最后选中节点续图。"
    });
    selectedContinuation = await evaluate(client, mixedSelectedContinuationExpression(selectedContinuationSequence), 70000);
    selectedContinuationPath = join(runDir, "agent-selected-continuation-suite.json");
    writeFileSync(selectedContinuationPath, JSON.stringify(selectedContinuation, null, 2));
    if (!selectedContinuation?.ok) {
      recordObservation("issue", "agent-selected-continuation-failed", {
        suitePath: selectedContinuationPath,
        sequence: selectedContinuationSequence,
        error: selectedContinuation?.error,
        targetId: selectedContinuation?.targetId,
        selectedBeforeChat: selectedContinuation?.selectedBeforeChat,
        createdId: selectedContinuation?.createdId,
        createdParentId: selectedContinuation?.createdParentId,
        selectedSequenceOk: selectedContinuation?.selectedSequenceOk,
        usedImageGen: selectedContinuation?.usedImageGen,
        usedModelForce: selectedContinuation?.usedModelForce,
        usedToolChoice: selectedContinuation?.usedToolChoice,
        autonomousImageGen: selectedContinuation?.autonomousImageGen,
        routedImageGen: selectedContinuation?.routedImageGen,
        forcedProgress: selectedContinuation?.forcedProgress,
        correctedProgress: selectedContinuation?.correctedProgress,
        unexpectedClear: selectedContinuation?.unexpectedClear
      });
    } else {
      recordObservation("info", "agent-selected-continuation-success", {
        suitePath: selectedContinuationPath,
        sequence: selectedContinuationSequence,
        targetId: selectedContinuation?.targetId,
        createdId: selectedContinuation?.createdId,
        createdParentId: selectedContinuation?.createdParentId,
        autonomy: selectedContinuation?.autonomousImageGen
          ? "direct-tool-call"
          : selectedContinuation?.routedImageGen
            ? "tool-choice-routed"
            : selectedContinuation?.usedModelForce
              ? "runtime-fallback"
              : "unknown",
        forcedProgress: selectedContinuation?.forcedProgress,
        correctedProgress: selectedContinuation?.correctedProgress
      });
    }
    const continuationExpectedImageNodes = expectedImageNodes + (selectedContinuation?.createdId ? 1 : 0);
    selectedContinuationCapture = await captureState(
      client,
      targetId,
      "agent-selected-continuation-884",
      null,
      { width: 884, height: 700 },
      {
        settingsOpen: false,
        historyOpen: false,
        modalOpen: false,
        accountOpen: false,
        titlebarOverlay: true,
        topbarCompactOk: true,
        topbarControlsDockedOk: true,
        verticalOverflowFree: true,
        compactViewportFitOk: true,
        agentDebugReady: true,
        agentDebugApiReady: true,
        agentIdle: true,
        canvasVisible: true,
        agentPanelVisible: true,
        compactMainGridOk: true,
        agentNodeCount: continuationExpectedImageNodes,
        selectedNodeType: "image",
        selectedImageFocusOk: true,
        selectedNodeVisibleOk: true,
        selectedImageNodeViewportOk: true,
        selectedNodeTitleVisibleOk: true,
        selectedNodeComposerOverlapOk: true,
        canvasZoomUsableOk: true,
        visibleImageNodeCountOk: true,
        nodeFooterGapOk: true,
        imageNodeViewportOk: true,
        timelineNodesVisible: true,
        composerViewportVisibleOk: true,
        canvasReadabilityOk: true,
        compactCanvasDensityOk: true,
        imagePreviewVisibleCountOk: true,
        imagePreviewLoadedOk: true,
        imagePreviewPixelProofOk: true
      },
      10000
    );
    recordObservation("info", "agent-selected-direct-continuation-request", {
      sequence: selectedContinuationSequence,
      prompt: "重复切换多个图片节点，跳过 tool_choice，观察 Agent 是否自然返回 image_gen。"
    });
    directContinuation = await evaluate(client, mixedSelectedContinuationExpression(selectedContinuationSequence, { directProbe: true }), 70000);
    directContinuationPath = join(runDir, "agent-selected-direct-continuation-suite.json");
    writeFileSync(directContinuationPath, JSON.stringify(directContinuation, null, 2));
    if (!directContinuation?.ok) {
      recordObservation("issue", "agent-selected-direct-continuation-failed", {
        suitePath: directContinuationPath,
        sequence: selectedContinuationSequence,
        error: directContinuation?.error,
        targetId: directContinuation?.targetId,
        selectedBeforeChat: directContinuation?.selectedBeforeChat,
        createdId: directContinuation?.createdId,
        createdParentId: directContinuation?.createdParentId,
        selectedSequenceOk: directContinuation?.selectedSequenceOk,
        usedImageGen: directContinuation?.usedImageGen,
        usedModelForce: directContinuation?.usedModelForce,
        usedToolChoice: directContinuation?.usedToolChoice,
        autonomousImageGen: directContinuation?.autonomousImageGen,
        routedImageGen: directContinuation?.routedImageGen,
        forcedProgress: directContinuation?.forcedProgress,
        correctedProgress: directContinuation?.correctedProgress,
        correctionFreeOk: directContinuation?.correctionFreeOk,
        unexpectedClear: directContinuation?.unexpectedClear
      });
    } else {
      recordObservation("info", "agent-selected-direct-continuation-success", {
        suitePath: directContinuationPath,
        sequence: selectedContinuationSequence,
        targetId: directContinuation?.targetId,
        createdId: directContinuation?.createdId,
        createdParentId: directContinuation?.createdParentId,
        autonomy: directContinuation?.autonomyKind || "unknown",
        forcedProgress: directContinuation?.forcedProgress,
        correctedProgress: directContinuation?.correctedProgress
      });
    }
    const directExpectedImageNodes = continuationExpectedImageNodes + (directContinuation?.createdId ? 1 : 0);
    directContinuationCapture = await captureState(
      client,
      targetId,
      "agent-selected-direct-continuation-884",
      null,
      { width: 884, height: 700 },
      {
        settingsOpen: false,
        historyOpen: false,
        modalOpen: false,
        accountOpen: false,
        titlebarOverlay: true,
        topbarCompactOk: true,
        topbarControlsDockedOk: true,
        verticalOverflowFree: true,
        compactViewportFitOk: true,
        agentDebugReady: true,
        agentDebugApiReady: true,
        agentIdle: true,
        canvasVisible: true,
        agentPanelVisible: true,
        compactMainGridOk: true,
        agentNodeCount: directExpectedImageNodes,
        selectedNodeType: "image",
        selectedImageFocusOk: true,
        selectedNodeVisibleOk: true,
        selectedImageNodeViewportOk: true,
        selectedNodeTitleVisibleOk: true,
        selectedNodeComposerOverlapOk: true,
        canvasZoomUsableOk: true,
        visibleImageNodeCountOk: true,
        nodeFooterGapOk: true,
        imageNodeViewportOk: true,
        timelineNodesVisible: true,
        composerViewportVisibleOk: true,
        canvasReadabilityOk: true,
        compactCanvasDensityOk: true,
        imagePreviewVisibleCountOk: true,
        imagePreviewLoadedOk: true,
        imagePreviewPixelProofOk: true
      },
      10000
    );
  }
  const bottomCapture = await captureState(
    client,
    targetId,
    "agent-long-session-bottom-884",
    scrollAgentFeedBottomExpression(),
    { width: 884, height: 700 },
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      topbarCompactOk: true,
      topbarControlsDockedOk: true,
      verticalOverflowFree: true,
      compactViewportFitOk: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentPanelVisible: true,
      timelineNodesVisible: true,
      composerButtonsConsistent: true,
      composerTextareaTall: true,
      agentTimelineBottomOk: true,
      agentFeedScrolledToBottom: true,
      lastAgentMessageBottomVisible: true,
      composerControlsVisibleOk: true,
      composerViewportVisibleOk: true,
      composerDoesNotCoverLastMessage: true,
      canvasReadabilityOk: true,
      compactCanvasDensityOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      imagePreviewPixelProofOk: true
    }
  );
  return [
    { ...capture, suite, suitePath },
    { ...compactCapture, suite, suitePath, compactOf: "agent-mixed-stress-1280" },
    ...focusCaptures,
    ...(selectedContinuationCapture ? [{ ...selectedContinuationCapture, suite: selectedContinuation, suitePath: selectedContinuationPath, compactOf: "agent-mixed-stress-1280" }] : []),
    ...(directContinuationCapture ? [{ ...directContinuationCapture, suite: directContinuation, suitePath: directContinuationPath, compactOf: "agent-mixed-stress-1280" }] : []),
    { ...bottomCapture, suite, suitePath, compactOf: "agent-mixed-stress-1280" }
  ];
}

function readPersistenceState() {
  try {
    if (!existsSync(persistenceStateFile)) return {};
    return JSON.parse(readFileSync(persistenceStateFile, "utf8"));
  } catch {
    return {};
  }
}

function writePersistenceState(patch) {
  mkdirSync(dirname(persistenceStateFile), { recursive: true });
  const current = readPersistenceState();
  writeFileSync(persistenceStateFile, JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2));
}

function imageCollectionPersistenceSignature(state) {
  const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
  return {
    selectedNodeId: String(state?.selectedNodeId || ""),
    layoutGroups: (Array.isArray(state?.layoutGroups) ? state.layoutGroups : []).map((group) => ({
      id: String(group?.id || ""),
      hostNodeId: String(group?.hostNodeId || ""),
      memberNodeIds: (Array.isArray(group?.memberNodeIds) ? group.memberNodeIds : []).map(String),
      origin: String(group?.origin || ""),
      autoFit: group?.autoFit !== false
    })),
    nodes: nodes
      .filter((node) => node?.type === "image")
      .map((node) => ({
        id: String(node.id || ""),
        parentId: String(node.parentId || ""),
        relationType: String(node.relationType || ""),
        branch: String(node.branch || ""),
        imageState: String(node.imageState || ""),
        x: Number(node.x || 0),
        y: Number(node.y || 0),
        zOrder: Number.isFinite(Number(node.zOrder)) ? Number(node.zOrder) : null,
        width: Number(node.width || 0),
        height: Number(node.height || 0),
        outputs: Number(node.outputs || 0),
        assetCount: Number(node.assetCount || 0),
        imageCollection: node.imageCollection
          ? {
              id: String(node.imageCollection.id || ""),
              kind: String(node.imageCollection.kind || ""),
              generationMode: String(node.imageCollection.generationMode || ""),
              sourceNodeId: String(node.imageCollection.sourceNodeId || ""),
              autoFit: node.imageCollection.autoFit !== false,
              items: (Array.isArray(node.imageCollection.items) ? node.imageCollection.items : []).map((item) => ({
                id: String(item.id || ""),
                assetIndex: Number(item.assetIndex || 0),
                prompt: String(item.prompt || ""),
                title: String(item.title || ""),
                status: String(item.status || ""),
                error: String(item.error || "")
              }))
            }
          : null,
        assets: (Array.isArray(node.assets) ? node.assets : []).map((asset) => ({
          index: Number(asset.index || 0),
          path: String(asset.path || ""),
          prompt: String(asset.prompt || ""),
          title: String(asset.title || ""),
          status: String(asset.status || ""),
          runId: String(asset.runId || "")
        }))
      }))
  };
}

async function captureImageCollectionPersistenceProbe(client, targetId) {
  const stage = persistenceStage === "read" ? "read" : "write";
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runCanvasImageCollectionSuite && window.__iiimageAIDebug?.fitCanvas && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", `canvas-image-collection-persistence-${stage}-request`, {
    stage,
    configDir: aidebugConfigDir,
    stateFile: persistenceStateFile
  });

  if (stage === "write") {
    const captures = await captureCanvasImageCollectionSuiteProbe(client, targetId, { runLayoutMutationRegression: false });
    const suite = captures[0]?.suite;
    const ids = suite?.ids && typeof suite.ids === "object" ? suite.ids : {};
    const persistenceGroupProof = await evaluate(
      client,
      `(async () => {
        const sourceNodeId = ${JSON.stringify(String(ids.extractedId || ""))};
        const targetNodeId = ${JSON.stringify(String(ids.singleId || ""))};
        const collectionNodeId = ${JSON.stringify(String(ids.batchId || ""))};
        const fit = await window.__iiimageAIDebug.fitCanvas();
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        const before = window.__iiimageDebugAgentState?.();
        const source = before?.nodes?.find((node) => node.id === sourceNodeId);
        const assetKey = source?.assets?.[0]?.path || source?.assets?.[0]?.assetUrl || source?.assets?.[0]?.url || "";
        if (!source || !assetKey || !targetNodeId) return { ok: false, error: "persistence grouping fixture unavailable" };
        const beforeIds = before.nodes.map((node) => node.id);
        const beforeCausality = Object.fromEntries(before.nodes.map((node) => [node.id, [node.parentId || "", node.relationType || ""]]));
        const result = await window.__iiimageAIDebug.nativeAssetDrop({ sourceNodeId, targetContainerId: targetNodeId, assetKey });
        await new Promise((resolve) => window.setTimeout(resolve, 680));
        const batchRequested = { width: 690, height: 820 };
        const layoutRequested = { width: 610, height: 690 };
        const batchResizeAccepted = window.__iiimageDebugResizeNode?.({ id: collectionNodeId, ...batchRequested }) === true;
        const layoutResizeAccepted = window.__iiimageDebugResizeNode?.({ id: targetNodeId, ...layoutRequested }) === true;
        await new Promise((resolve) => window.setTimeout(resolve, 520));
        let after = window.__iiimageDebugAgentState?.();
        let group = after?.layoutGroups?.find((item) => item.hostNodeId === targetNodeId && item.memberNodeIds?.includes(sourceNodeId));
        const batchNode = after?.nodes?.find((node) => node.id === collectionNodeId);
        const layoutHost = after?.nodes?.find((node) => node.id === targetNodeId);
        const manualSizeProof = {
          ok: Boolean(
            batchResizeAccepted && layoutResizeAccepted && batchNode?.imageCollection?.autoFit === false && group?.autoFit === false &&
            Number(batchNode?.width || 0) >= batchRequested.width && Number(batchNode?.width || 0) <= batchRequested.width + 16 && Number(batchNode?.height || 0) === batchRequested.height &&
            Number(layoutHost?.width || 0) === layoutRequested.width && Number(layoutHost?.height || 0) === layoutRequested.height
          ),
          batchResizeAccepted,
          layoutResizeAccepted,
          batchRequested,
          layoutRequested,
          batchActual: batchNode ? { width: batchNode.width, height: batchNode.height, autoFit: batchNode.imageCollection?.autoFit } : null,
          layoutActual: layoutHost ? { width: layoutHost.width, height: layoutHost.height, autoFit: group?.autoFit } : null
        };
        const hiddenMemberIds = new Set((group?.memberNodeIds || []).filter((id) => id !== group?.hostNodeId));
        const visibleNodes = (after?.nodes || []).filter((node) => !hiddenMemberIds.has(node.id));
        let packX = 100;
        let packY = 100;
        let rowHeight = 0;
        let packed = true;
        for (const node of visibleNodes) {
          const width = Math.max(260, Number(node.width || 360));
          const height = Math.max(220, Number(node.height || 420));
          if (packX > 100 && packX + width > 2200) {
            packX = 100;
            packY += rowHeight + 140;
            rowHeight = 0;
          }
          packed = window.__iiimageDebugMoveNode?.({ id: node.id, x: packX, y: packY }) === true && packed;
          packX += width + 140;
          rowHeight = Math.max(rowHeight, height);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        after = window.__iiimageDebugAgentState?.();
        group = after?.layoutGroups?.find((item) => item.hostNodeId === targetNodeId && item.memberNodeIds?.includes(sourceNodeId));
        const sourceRetained = after?.nodes?.some((node) => node.id === sourceNodeId) === true;
        const allNodesRetained = beforeIds.every((id) => after?.nodes?.some((node) => node.id === id));
        const causalityPreserved = after?.nodes?.every((node) => !beforeCausality[node.id] || (
          beforeCausality[node.id][0] === (node.parentId || "") && beforeCausality[node.id][1] === (node.relationType || "")
        )) === true;
        return {
          ok: Boolean(fit?.ok && result?.ok && sourceRetained && allNodesRetained && causalityPreserved && group && group.memberNodeIds.join(",") === [targetNodeId, sourceNodeId].join(",") && manualSizeProof.ok && packed),
          fitOk: Boolean(fit?.ok),
          resultOk: Boolean(result?.ok),
          result,
          sourceRetained,
          allNodesRetained,
          causalityPreserved,
          manualSizeProof,
          packed,
          group: group ? { ...group, memberNodeIds: [...group.memberNodeIds] } : null
        };
      })()`
    );
    const autoDissolveStep = Array.isArray(suite?.steps)
      ? suite.steps.find((item) => item?.label === "canvas-container-auto-downgrade")
      : null;
    const autoDissolveProof = {
      ok: autoDissolveStep?.ok === true,
      label: autoDissolveStep?.label || "",
      detail: autoDissolveStep?.detail || null
    };
    await evaluate(client, `new Promise((resolve) => window.setTimeout(resolve, 920))`);
    const state = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
    const signature = imageCollectionPersistenceSignature(state);
    const assetPaths = signature.nodes.flatMap((node) => node.assets.map((asset) => asset.path).filter(Boolean));
    const assetFileIntegrity = fileIntegritySnapshot(assetPaths);
    const writeOk = Boolean(suite?.ok && persistenceGroupProof?.ok && autoDissolveProof.ok && signature.layoutGroups.length === 1);
    writePersistenceState({
      kind: "canvas-image-collection",
      ids,
      signature,
      persistenceGroupProof,
      autoDissolveProof,
      assetFileIntegrity,
      writeRunDir: runDir,
      configDir: aidebugConfigDir
    });
    if (!writeOk) {
      recordObservation("issue", "canvas-image-collection-persistence-write-group-failed", {
        suiteOk: suite?.ok,
        persistenceGroupProof,
        autoDissolveProof,
        layoutGroups: signature.layoutGroups
      });
    }
    return captures.map((capture) => ({
      ...capture,
      suite: {
        ...capture.suite,
        ok: Boolean(capture.suite?.ok && writeOk),
        persistenceGroupProof,
        autoDissolveProof,
        assetFileIntegrity
      },
      persistenceStage: stage,
      persistenceStateFile
    }));
  }

  await waitForExpression(client, "Number(window.__iiimageDebugAgentState?.()?.nodeCount || 0) === 6", 15000);
  const persisted = readPersistenceState();
  const stateBefore = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
  const actualSignature = imageCollectionPersistenceSignature(stateBefore);
  const expectedSignature = persisted.signature || null;
  const semanticSignature = (signature) => signature ? ({
    ...signature,
    nodes: (Array.isArray(signature.nodes) ? signature.nodes : []).map(({ zOrder: _zOrder, ...node }) => node)
  }) : null;
  const semanticSignatureOk = Boolean(
    expectedSignature && JSON.stringify(semanticSignature(actualSignature)) === JSON.stringify(semanticSignature(expectedSignature))
  );
  const zOrderIds = (signature) => (Array.isArray(signature?.nodes) ? signature.nodes : [])
    .filter((node) => Number.isFinite(Number(node.zOrder)))
    .sort((left, right) => Number(left.zOrder) - Number(right.zOrder))
    .map((node) => node.id);
  const zOrderRelativeOk = Boolean(
    expectedSignature && JSON.stringify(zOrderIds(actualSignature)) === JSON.stringify(zOrderIds(expectedSignature))
  );
  const signatureOk = Boolean(semanticSignatureOk && zOrderRelativeOk);
  const assetPaths = actualSignature.nodes.flatMap((node) => node.assets.map((asset) => asset.path).filter(Boolean));
  const assetPathsExist = assetPaths.length === 18 && assetPaths.every((assetPath) => existsSync(assetPath));
  const actualAssetFileIntegrity = fileIntegritySnapshot(assetPaths);
  const assetFileIntegrityOk = Boolean(
    Array.isArray(persisted.assetFileIntegrity) &&
    persisted.assetFileIntegrity.length === actualAssetFileIntegrity.length &&
    JSON.stringify(actualAssetFileIntegrity) === JSON.stringify(persisted.assetFileIntegrity)
  );
  const persistedIds = persisted.ids && typeof persisted.ids === "object" ? persisted.ids : {};
  const expectedNodesById = new Map((Array.isArray(expectedSignature?.nodes) ? expectedSignature.nodes : []).map((node) => [node.id, node]));
  const sourceNodesRetained = [...expectedNodesById.keys()].every((id) => actualSignature.nodes.some((node) => node.id === id));
  const causalityPreserved = actualSignature.nodes.every((node) => {
    const expected = expectedNodesById.get(node.id);
    return !expected || (node.parentId === expected.parentId && node.relationType === expected.relationType);
  });
  const expectedLayoutGroup = Array.isArray(expectedSignature?.layoutGroups) ? expectedSignature.layoutGroups[0] : null;
  const actualLayoutGroup = actualSignature.layoutGroups[0] || null;
  const layoutGroupOrderOk = Boolean(
    expectedLayoutGroup && actualLayoutGroup &&
    actualSignature.layoutGroups.length === 1 &&
    actualLayoutGroup.id === expectedLayoutGroup.id &&
    actualLayoutGroup.hostNodeId === expectedLayoutGroup.hostNodeId &&
    JSON.stringify(actualLayoutGroup.memberNodeIds) === JSON.stringify(expectedLayoutGroup.memberNodeIds)
  );
  const groupedSourcesRetained = Boolean(
    actualLayoutGroup?.memberNodeIds?.length === 2 &&
    actualLayoutGroup.memberNodeIds.every((id) => actualSignature.nodes.some((node) => node.id === id))
  );
  const expectedManualSize = persisted.persistenceGroupProof?.manualSizeProof || null;
  const persistedBatchNode = actualSignature.nodes.find((node) => node.id === persistedIds.batchId);
  const persistedLayoutHost = actualSignature.nodes.find((node) => node.id === persistedIds.singleId);
  const manualSizePersistenceOk = Boolean(
    expectedManualSize?.ok &&
    persistedBatchNode?.imageCollection?.autoFit === false &&
    actualLayoutGroup?.autoFit === false &&
    Number(persistedBatchNode?.width || 0) === Number(expectedManualSize.batchActual?.width || 0) &&
    Number(persistedBatchNode?.height || 0) === Number(expectedManualSize.batchActual?.height || 0) &&
    Number(persistedLayoutHost?.width || 0) === Number(expectedManualSize.layoutActual?.width || 0) &&
    Number(persistedLayoutHost?.height || 0) === Number(expectedManualSize.layoutActual?.height || 0)
  );
  const autoDissolveProofOk = persisted.autoDissolveProof?.ok === true;
  const nonDestructiveGroupingProofOk = Boolean(
    persisted.persistenceGroupProof?.ok &&
    persisted.persistenceGroupProof?.sourceRetained &&
    persisted.persistenceGroupProof?.allNodesRetained &&
    persisted.persistenceGroupProof?.causalityPreserved
  );
  const shapeOk = Boolean(
    actualSignature.nodes.length === 6 &&
    actualSignature.nodes.find((node) => node.id === persistedIds.seriesId)?.imageCollection?.kind === "series" &&
    actualSignature.nodes.find((node) => node.id === persistedIds.seriesId)?.assetCount === 3 &&
    actualSignature.nodes.find((node) => node.id === persistedIds.batchId)?.imageCollection?.kind === "batch" &&
    actualSignature.nodes.find((node) => node.id === persistedIds.batchId)?.assetCount === 10 &&
    actualSignature.nodes.find((node) => node.id === persistedIds.mixedBatchId)?.assetCount === 2 &&
    sourceNodesRetained && groupedSourcesRetained && causalityPreserved && layoutGroupOrderOk && manualSizePersistenceOk &&
    autoDissolveProofOk && nonDestructiveGroupingProofOk
  );
  const persistedSuite = {
    ok: Boolean(signatureOk && assetPathsExist && assetFileIntegrityOk && shapeOk),
    stage,
    signatureOk,
    semanticSignatureOk,
    zOrderRelativeOk,
    assetPathsExist,
    assetFileIntegrityOk,
    assetPathCount: assetPaths.length,
    sourceNodesRetained,
    groupedSourcesRetained,
    causalityPreserved,
    layoutGroupOrderOk,
    manualSizePersistenceOk,
    expectedManualSize,
    persistedManualSize: {
      batch: persistedBatchNode ? { width: persistedBatchNode.width, height: persistedBatchNode.height, autoFit: persistedBatchNode.imageCollection?.autoFit } : null,
      layout: persistedLayoutHost ? { width: persistedLayoutHost.width, height: persistedLayoutHost.height, autoFit: actualLayoutGroup?.autoFit } : null
    },
    autoDissolveProofOk,
    nonDestructiveGroupingProofOk,
    shapeOk,
    expectedAssetFileIntegrity: persisted.assetFileIntegrity || [],
    actualAssetFileIntegrity,
    expectedSignature,
    actualSignature,
    ids: persistedIds
  };
  if (!persistedSuite.ok) {
    recordObservation("issue", "canvas-image-collection-persistence-readback-failed", {
      signatureOk,
      semanticSignatureOk,
      zOrderRelativeOk,
      assetPathsExist,
      assetFileIntegrityOk,
      assetPathCount: assetPaths.length,
      sourceNodesRetained,
      groupedSourcesRetained,
      causalityPreserved,
      layoutGroupOrderOk,
      manualSizePersistenceOk,
      autoDissolveProofOk,
      nonDestructiveGroupingProofOk,
      shapeOk,
      stateFile: persistenceStateFile
    });
  }
  await evaluate(client, `window.__iiimageAIDebug.fitCanvas()`);
  const persistenceCapture = await captureState(
    client,
    targetId,
    "canvas-image-collection-persistence-read-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: 6,
      imageNodeCount: 5,
      nodeFooterGapOk: true,
      nodeOverlapOk: true,
      provenanceEdgeVisible: true
    }
  );

  const extractedId = String(persistedIds.extractedId || "");
  const beforeIds = new Set(actualSignature.nodes.map((node) => node.id));
  const dissolveAfterRestart = await evaluate(
    client,
    `(async () => {
      const extractedId = ${JSON.stringify(extractedId)};
      const before = window.__iiimageDebugAgentState?.();
      const group = before?.layoutGroups?.find((item) => item.memberNodeIds?.includes(extractedId));
       const source = before?.nodes?.find((node) => node.id === extractedId);
       const assetKey = source?.assets?.[0]?.path || source?.assets?.[0]?.assetUrl || source?.assets?.[0]?.url || "";
       if (!group || !source || !assetKey) return { ok: false, error: "persisted layout group unavailable" };
       const beforeIds = before.nodes.map((node) => node.id);
       const beforeCausality = Object.fromEntries(before.nodes.map((node) => [node.id, [node.parentId || "", node.relationType || ""]]));
       const canvasRect = document.querySelector(".workflow-canvas")?.getBoundingClientRect();
       const viewport = before?.viewport || { x: 0, y: 0, scale: 1 };
       const occupied = before.nodes.filter((node) => node.id !== source.id && !group.memberNodeIds?.includes(node.id));
       const openWorldX = Math.max(0, ...occupied.map((node) => Number(node.x || 0) + Number(node.width || 360))) + 180 + Number(source.width || 360) / 2;
       const openWorldY = Math.max(270, Math.min(...occupied.map((node) => Number(node.y || 0)), 270)) + 40;
       const clientX = (canvasRect?.left || 0) + Number(viewport.x || 0) + openWorldX * Number(viewport.scale || 1);
       const clientY = (canvasRect?.top || 0) + Number(viewport.y || 0) + openWorldY * Number(viewport.scale || 1);
       const result = await window.__iiimageDebugMoveContainerAsset({ sourceContainerId: extractedId, assetKey, clientX, clientY });
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      let after = window.__iiimageDebugAgentState?.();
      const restoredBeforePacking = after?.nodes?.find((node) => node.id === extractedId);
      const otherRight = Math.max(0, ...(after?.nodes || []).filter((node) => node.id !== extractedId).map((node) => Number(node.x || 0) + Number(node.width || 360)));
      const packedPosition = { x: otherRight + 180, y: 270 };
      const packed = restoredBeforePacking
        ? window.__iiimageDebugMoveNode?.({ id: extractedId, ...packedPosition }) === true
        : false;
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      after = window.__iiimageDebugAgentState?.();
      const groupRemoved = !after?.layoutGroups?.some((item) => item.id === group.id);
      const allNodesRetained = beforeIds.every((id) => after?.nodes?.some((node) => node.id === id));
      const causalityPreserved = after?.nodes?.every((node) => !beforeCausality[node.id] || (
        beforeCausality[node.id][0] === (node.parentId || "") && beforeCausality[node.id][1] === (node.relationType || "")
      )) === true;
      return {
        ok: Boolean(result?.ok && packed && group.memberNodeIds?.length === 2 && groupRemoved && allNodesRetained && causalityPreserved),
        result,
        groupId: group.id,
        memberNodeIds: [...group.memberNodeIds],
         groupRemoved,
         allNodesRetained,
         causalityPreserved,
         packed,
         packedPosition,
         requestedOpenPoint: { x: openWorldX, y: openWorldY },
         restoredPosition: (() => {
           const restored = after?.nodes?.find((node) => node.id === extractedId);
           return { x: Number(restored?.x || 0), y: Number(restored?.y || 0) };
         })()
       };
    })()`
  );
  if (!dissolveAfterRestart?.ok) {
    recordObservation("issue", "canvas-image-collection-persistence-auto-dissolve-failed", {
      extractedId,
      dissolveAfterRestart
    });
  }
  const continuation = await evaluate(
    client,
    `(async () => {
      const extractedId = ${JSON.stringify(extractedId)};
      const selected = await window.__iiimageAIDebug.selectNode({ id: extractedId });
      const run = await window.__iiimageAIDebug.runTool(${JSON.stringify({
        name: "image_gen",
        selectedNodeId: "__EXTRACTED__",
        input: {
          operation: "variants",
          parentId: "__EXTRACTED__",
          prompt: "重启后基于当前拖出的图片成果继续生成一张清爽近景变体，保持主体和来源关系。",
          ratio: "3:4",
          resolution: "720P",
          count: 1,
          quality: "auto",
          brief: "验证重启后从画布选中成果继续生成。"
        }
      }).replace(/__EXTRACTED__/g, extractedId)});
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      return { selected, run, state: window.__iiimageDebugAgentState?.() };
    })()`
  );
  const continuationNodes = Array.isArray(continuation?.state?.nodes) ? continuation.state.nodes : [];
  const created = continuationNodes.find((node) =>
    !beforeIds.has(String(node.id || "")) &&
    node.type === "image" &&
    node.parentId === extractedId &&
    node.relationType === "variant" &&
    node.imageState === "done" &&
    Number(node.assetCount || 0) === 1
  );
  const continuationOk = Boolean(continuation?.selected?.ok && continuation?.run?.ok && created?.id);
  const combinedSuite = {
    ...persistedSuite,
    ok: Boolean(persistedSuite.ok && dissolveAfterRestart?.ok && continuationOk),
    dissolveAfterRestart,
    continuationOk,
    createdId: created?.id || "",
    continuation
  };
  if (!continuationOk) {
    recordObservation("issue", "canvas-image-collection-persistence-continuation-failed", {
      extractedId,
      createdId: created?.id || "",
      selectedOk: continuation?.selected?.ok,
      runOk: continuation?.run?.ok
    });
  }
  const continuationCapture = await captureState(
    client,
    targetId,
    "canvas-image-collection-persistence-continue-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentIdle: true,
      agentNodeCount: 7,
      agentImageNodeCount: 7,
      imageNodeViewportOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
      nodeFooterGapOk: true,
      nodeOverlapOk: true,
      provenanceEdgeVisible: true
    }
  );
  return [
    { ...persistenceCapture, suite: combinedSuite, persistenceStage: stage, persistenceStateFile },
    { ...continuationCapture, suite: combinedSuite, persistenceStage: stage, persistenceStateFile }
  ];
}

async function captureContextPersistenceProbe(client, targetId) {
  const stage = persistenceStage === "read" ? "read" : "write";
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(client, "Boolean(window.__iiimageAIDebug?.runTool && window.__iiimageAIDebug?.chat && window.__iiimageDebugAgentState)", 10000);
  recordObservation("info", `agent-context-persistence-${stage}-request`, {
    stage,
    sentinel: persistenceSentinel,
    configDir: aidebugConfigDir,
    stateFile: persistenceStateFile
  });

  const steps = [];
  const issues = [];
  const step = async (label, action) => {
    const started = Date.now();
    try {
      const detail = await action();
      const ok = !detail || typeof detail !== "object" || detail.ok !== false;
      steps.push({ label, ok, durationMs: Date.now() - started, detail });
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ label, ok: false, durationMs: Date.now() - started, error: message });
      return { ok: false, error: message };
    }
  };

  const forbiddenPublicMetadata = /\bfmem(?:-[a-z0-9_-]+)?\b|\bentry[_ ]?id\b|\bentryId\b|\bselector\b|\bsourceEntryIds\b|\bkeywords\b|\bcontext_manage\b/i;
  const memoryText = `${persistenceSentinel}: 跨 Electron 重启后仍应读取这条绘画经验；续图前确认父节点与最终图片成果可见。`;
  let scope = readPersistenceState().scope || null;
  if (stage === "write") {
    const saveDetail = await step("context-persistence-write-fast-memory-api", () => evaluate(
      client,
      `(async () => {
        const state = window.__iiimageDebugAgentState?.();
        const scope = { projectId: String(state?.activeProjectId || ""), conversationId: String(state?.activeConversationId || "") };
        const text = ${JSON.stringify(memoryText)};
        const saved = await window.iiimageAgent?.saveFastMemory?.({ ...scope, text });
        const read = await window.iiimageAgent?.getFastMemory?.(scope);
        const tools = await window.iiimageAgent?.tools?.();
        const publicSchemaText = JSON.stringify(tools?.tools || tools || {});
        const publicMetadataHidden = !/\\bfmem(?:-[a-z0-9_-]+)?\\b|\\bentry[_ ]?id\\b|\\bentryId\\b|\\bselector\\b|\\bsourceEntryIds\\b|\\bkeywords\\b|\\bcontext_manage\\b/i.test(publicSchemaText);
        return {
          ok: Boolean(scope.projectId && scope.conversationId && saved?.ok && read?.ok && read.text === text && publicMetadataHidden),
          scope,
          saved,
          read,
          publicMetadataHidden,
          publicToolNames: (tools?.tools || []).map((tool) => tool?.function?.name || "").filter(Boolean)
        };
      })()`
    ));
    scope = saveDetail?.scope || null;
    if (!scope?.projectId || !scope?.conversationId) {
      issues.push({ level: "error", area: "context-persistence", message: "写入阶段没有取得项目与会话作用域。", detail: saveDetail });
    }
    await step("context-persistence-save-session-scope", async () => {
      if (!scope?.projectId || !scope?.conversationId) return { ok: false, error: "missing FastMemory scope" };
      return evaluate(
        client,
        `(async () => {
          const expectedScope = ${JSON.stringify(scope)};
          const seeded = window.__iiimageDebugSeedAgentMessages?.({
            append: false,
            messages: [{ role: "assistant", content: "AIDebug 会话持久化锚点。", status: "done", meta: "aidebug persistence" }]
          });
          await new Promise((resolve) => window.setTimeout(resolve, 1100));
          const state = window.__iiimageDebugAgentState?.();
          const activeScope = { projectId: String(state?.activeProjectId || ""), conversationId: String(state?.activeConversationId || "") };
          return { ok: Boolean(seeded && JSON.stringify(activeScope) === JSON.stringify(expectedScope)), seeded, expectedScope, activeScope };
        })()`
      );
    });
    writePersistenceState({ sentinel: persistenceSentinel, memoryText, scope, configDir: aidebugConfigDir, writeRunDir: runDir });
    await step("context-persistence-write-experience-readback", async () => {
      const toolInput = {
        action: "read",
        brief: "写入阶段立即读取当前会话绘画经验。"
      };
      const read = await evaluate(client, `window.__iiimageAIDebug.runTool(${JSON.stringify({
        name: "experience",
        input: toolInput
      })})`);
      const output = JSON.stringify(read?.envelope || {});
      const inputText = JSON.stringify(toolInput);
      return {
        ...read,
        ok: Boolean(read?.ok && output.includes(persistenceSentinel) && !forbiddenPublicMetadata.test(output) && !forbiddenPublicMetadata.test(inputText)),
        publicMetadataHidden: !forbiddenPublicMetadata.test(output) && !forbiddenPublicMetadata.test(inputText),
        toolInput
      };
    });
  } else {
    const persisted = readPersistenceState();
    scope = persisted.scope || null;
    await step("context-persistence-load-state", async () => ({
      ok: Boolean(scope?.projectId && scope?.conversationId && persisted.sentinel === persistenceSentinel && persisted.memoryText === memoryText),
      scope,
      stateFile: persistenceStateFile,
      persisted
    }));
    await step("context-persistence-fast-memory-api-after-restart", async () => {
      if (!scope?.projectId || !scope?.conversationId) return { ok: false, error: "missing persisted FastMemory scope" };
      return evaluate(
        client,
        `(async () => {
          const expectedScope = ${JSON.stringify(scope)};
          const state = window.__iiimageDebugAgentState?.();
          const activeScope = { projectId: String(state?.activeProjectId || ""), conversationId: String(state?.activeConversationId || "") };
          const read = await window.iiimageAgent?.getFastMemory?.(expectedScope);
          return {
            ok: Boolean(read?.ok && read.text === ${JSON.stringify(memoryText)} && JSON.stringify(activeScope) === JSON.stringify(expectedScope)),
            expectedScope,
            activeScope,
            read
          };
        })()`
      );
    });
    await step("context-persistence-experience-read-after-restart", async () => {
      const toolInput = {
        action: "read",
        brief: "重启后读取当前会话绘画经验。"
      };
      const read = await evaluate(client, `window.__iiimageAIDebug.runTool(${JSON.stringify({
        name: "experience",
        input: toolInput
      })})`);
      const output = JSON.stringify(read?.envelope || {});
      const inputText = JSON.stringify(toolInput);
      return {
        ...read,
        ok: Boolean(read?.ok && output.includes(persistenceSentinel) && !forbiddenPublicMetadata.test(output) && !forbiddenPublicMetadata.test(inputText)),
        publicMetadataHidden: !forbiddenPublicMetadata.test(output) && !forbiddenPublicMetadata.test(inputText),
        toolInput
      };
    });
    await step("context-persistence-agent-read", async () => {
      const beforeState = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
      const beforeProgressCount = Number(beforeState?.progressCount || 0);
      const prompt = `请调用 Experience 读取当前项目当前会话的绘画经验，不要生成图片。nonce ${Date.now()}`;
      const detail = await evaluate(client, `window.__iiimageAIDebug.chat(${JSON.stringify(prompt)}, { skipAsk: true })`);
      const progress = Array.isArray(detail?.state?.progress) ? detail.state.progress : [];
      const progressCount = Number(detail?.state?.progressCount || progress.length);
      const recentWindowStart = Math.max(0, progressCount - progress.length);
      const newProgress = progress.slice(Math.max(0, beforeProgressCount - recentWindowStart));
      const usedRead = newProgress.some((item) => {
        const input = item?.input && typeof item.input === "object" && !Array.isArray(item.input) ? item.input : {};
        return item?.tool === "experience" && input.action === "read" && !forbiddenPublicMetadata.test(JSON.stringify(input));
      });
      const internalToolUsed = newProgress.some((item) => item?.tool === "context_manage");
      const publicUiText = JSON.stringify({ messages: detail?.state?.messages || [], lastAssistant: detail?.state?.lastAssistant || "" });
      const publicMetadataHidden = !forbiddenPublicMetadata.test(publicUiText) && !forbiddenPublicMetadata.test(JSON.stringify(newProgress));
      const forced = newProgress.filter((item) => item?.phase === "model-force").map((item) => ({ tool: item.tool, summary: item.summary, input: item.input }));
      if (forced.length) {
        issues.push({
          level: "warning",
          area: "context-persistence-autonomy",
          message: "跨重启读回阶段 Agent 依赖了 model-force 兜底。",
          detail: forced
        });
      }
      return { ...detail, ok: Boolean(detail?.ok && usedRead && !internalToolUsed && publicMetadataHidden && !forced.length), usedRead, internalToolUsed, publicMetadataHidden, forced };
    });
    await step("context-persistence-agent-image-after-read", async () => {
      const beforeState = await evaluate(client, `window.__iiimageDebugAgentState?.()`);
      const beforeProgressCount = Number(beforeState?.progressCount || 0);
      const prompt = `请使用刚才读到的 AIDebug 跨重启绘画经验生成一张清爽专业的工具测试海报，画面不要文字，完成后同步到画布。nonce ${Date.now()}`;
      const detail = await evaluate(client, `window.__iiimageAIDebug.chat(${JSON.stringify(prompt)}, { skipAsk: true })`);
      const afterProgress = Array.isArray(detail?.state?.progress) ? detail.state.progress : [];
      const afterProgressCount = Number(detail?.state?.progressCount || beforeProgressCount + afterProgress.length);
      const recentWindowStart = Math.max(0, afterProgressCount - afterProgress.length);
      const newProgress = afterProgressCount >= beforeProgressCount
        ? afterProgress.slice(Math.max(0, beforeProgressCount - recentWindowStart))
        : afterProgress;
      const imageEvents = newProgress.filter((item) => {
        const phase = String(item?.phase || "");
        return item?.tool === "image_gen" || phase.startsWith("image-");
      });
      const imagePrompts = imageEvents
        .map((item) => {
          const input = item?.input && typeof item.input === "object" && !Array.isArray(item.input) ? item.input : {};
          return String(input.prompt || "");
        })
        .filter(Boolean);
      const promptIncludesSentinel = imagePrompts.some((item) => item.includes(persistenceSentinel));
      const usedImageGen = imageEvents.length > 0;
      const forced = newProgress
        .filter((item) => item?.phase === "model-force")
        .map((item) => ({ tool: item.tool, summary: item.summary, input: item.input }));
      if (forced.length) {
        issues.push({
          level: "warning",
          area: "context-persistence-image-autonomy",
          message: "跨重启经验生图阶段 Agent 依赖了 model-force 兜底或参数修正。",
          detail: forced
        });
      }
      const beforeNodeCount = Number(beforeState?.nodeCount || 0);
      await waitForExpression(
        client,
        `(() => {
          const state = window.__iiimageDebugAgentState?.();
          const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
          return Boolean(
            state &&
            Number(state.nodeCount || 0) >= ${beforeNodeCount + 1} &&
            nodes.some((node) => node.type === "image" && node.imageState === "done" && Number(node.assetCount || 0) > 0)
          );
        })()`,
        20000
      );
      return {
        ...detail,
        ok: Boolean(detail?.ok && usedImageGen && promptIncludesSentinel && !forced.length),
        usedImageGen,
        promptIncludesSentinel,
        imagePrompts,
        forced,
        wait: { ok: true }
      };
    });
    writePersistenceState({ readRunDir: runDir, readBackOk: true });
  }

  const ok = steps.every((item) => item.ok) && !issues.some((issue) => issue.level === "error" || /autonomy/i.test(String(issue.area || "")));
  const suite = {
    ok,
    stage,
    sentinel: persistenceSentinel,
    scope,
    publicMetadataHidden: steps.every((item) => item?.detail?.publicMetadataHidden !== false),
    configDir: aidebugConfigDir,
    stateFile: persistenceStateFile,
    steps,
    issues
  };
  const suitePath = join(runDir, "agent-context-persistence-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  if (!suite.ok) {
    recordObservation("issue", `agent-context-persistence-${stage}-failed`, {
      suitePath,
      steps: steps.map((item) => ({ label: item.label, ok: item.ok, error: item.error })),
      issues
    });
  } else {
    recordObservation("info", `agent-context-persistence-${stage}-success`, { suitePath, scope });
  }
  for (const issue of issues) {
    recordObservation(issue.level === "error" ? "issue" : "info", `agent-context-persistence-${issue.area || "observation"}`, {
      message: issue.message,
      detail: issue.detail
    });
  }
  const capture = await captureState(
    client,
    targetId,
    `agent-context-persistence-${stage}-1280`,
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true
    }
  );
  return { ...capture, suite, suitePath };
}

async function captureClearCanvasAgentProbe(client, targetId) {
  await setWindowSize(client, targetId, 1280, 820);
  let lastCapture = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await seedClearCanvasProbe(client);
    recordObservation("info", "agent-clear-canvas-request", { attempt, prompt: "我需要清理下画布" });
    await evaluate(client, `window.__iiimageDebugSendAgentPrompt?.("我需要清理下画布", { skipAsk: true })`);
    try {
      await waitForExpression(
        client,
        `(() => {
          const state = window.__iiimageDebugAgentState?.();
          const progress = Array.isArray(state?.progress) ? state.progress : [];
          const clearTool = progress.some((item) => {
            const input = item?.input && typeof item.input === "object" ? item.input : {};
            return item?.tool === "workflow" && (item?.operation === "clear_canvas" || input.operation === "clear_canvas");
          });
          return Boolean(state && state.agentStatus === "idle" && Number(state.nodeCount || 0) === 0 && clearTool);
        })()`,
        45000
      );
      recordObservation("info", "agent-clear-canvas-success", { attempt });
      return captureState(
        client,
        targetId,
        "agent-clear-canvas-1280",
        null,
        null,
        {
          settingsOpen: false,
          historyOpen: false,
          modalOpen: false,
          accountOpen: false,
          titlebarOverlay: true,
          agentDebugReady: true,
          agentIdle: true,
          agentForcedRetry: false,
          agentWorkflowClearTool: true,
          agentClearCanvasDone: true,
          agentClearCanvasFinal: true,
          timelineNodesVisible: true
        }
      );
    } catch (error) {
      recordObservation("issue", "agent-clear-canvas-attempt-failed", { attempt, error: error instanceof Error ? error.message : String(error) });
      lastCapture = await captureState(
        client,
        targetId,
        `agent-clear-canvas-failed-${attempt}-1280`,
        null,
        null,
        {
          settingsOpen: false,
          historyOpen: false,
          modalOpen: false,
          accountOpen: false,
          titlebarOverlay: true,
          agentDebugReady: true,
          agentIdle: true,
          agentForcedRetry: false,
          agentWorkflowClearTool: true,
          agentClearCanvasDone: true,
          agentClearCanvasFinal: true,
          timelineNodesVisible: true
        }
      );
    }
  }
  return lastCapture;
}

function pngSize(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 1, height: 1 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeContactSheet(results) {
  const tileWidth = 560;
  const labelHeight = 28;
  const gap = 12;
  const columns = 2;
  const tiles = results.map((result) => {
    const size = pngSize(result.screenshotPath);
    const imageHeight = Math.max(1, Math.round(tileWidth * size.height / size.width));
    return {
      ...result,
      size,
      imageHeight,
      tileHeight: labelHeight + imageHeight
    };
  });
  const rowHeights = [];
  for (let i = 0; i < tiles.length; i += columns) {
    rowHeights.push(Math.max(...tiles.slice(i, i + columns).map((tile) => tile.tileHeight)));
  }
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rowHeights.reduce((total, row) => total + row, gap) + (rowHeights.length + 1) * gap;
  let body = `<rect width="100%" height="100%" fill="#1e1e1e"/>`;
  let y = gap;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowTiles = tiles.slice(row * columns, row * columns + columns);
    for (let column = 0; column < rowTiles.length; column += 1) {
      const tile = rowTiles[column];
      const x = gap + column * (tileWidth + gap);
      const imageBase64 = readFileSync(tile.screenshotPath).toString("base64");
      const label = `${tile.label} | overflow:${tile.overflow.elementOverflowX.length ? "yes" : "no"} | state:${tile.stateIssues.length ? "fail" : "ok"} | visual:${tile.visualReliability?.status || "unverified"}/${tile.visualPolicy || "overview"} | capture:${tile.captureIssues.length ? "fail" : "window"}`;
      body += `<rect x="${x}" y="${y}" width="${tileWidth}" height="${tile.tileHeight}" fill="#252526" stroke="#3c3c3c"/>`;
      body += `<text x="${x + 10}" y="${y + 19}" fill="#cccccc" font-family="Segoe UI, Arial" font-size="13">${xmlEscape(label)}</text>`;
      body += `<image x="${x}" y="${y + labelHeight}" width="${tileWidth}" height="${tile.imageHeight}" href="data:image/png;base64,${imageBase64}" preserveAspectRatio="xMinYMin meet"/>`;
    }
    y += rowHeights[row] + gap;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  const sheetPath = join(runDir, "contact-sheet.svg");
  writeFileSync(sheetPath, svg);
  return sheetPath;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function latestRuntimeProgress(progress) {
  const list = asArray(progress).filter((item) => item && typeof item === "object");
  if (!list.length) return [];
  const requestIndex = list.reduce((latest, item, index) => (item?.phase === "runtime-request" ? index : latest), -1);
  if (requestIndex < 0) return list;
  const runId = list[requestIndex]?.runId;
  const sliced = list.slice(requestIndex);
  return runId ? sliced.filter((item) => !item?.runId || item.runId === runId) : sliced;
}

function progressToolSet(progress) {
  const tools = new Set();
  for (const item of asArray(progress)) {
    const phase = String(item?.phase || "");
    const tool = String(item?.tool || "").trim();
    if (tool && (phase === "tool-start" || phase === "tool-done" || phase.startsWith("image-"))) {
      tools.add(tool);
    }
  }
  return tools;
}

function isAgentAutonomyStep(label, detail) {
  const text = String(label || "");
  if (!detail || typeof detail !== "object") return false;
  if (text.includes("direct-image-gen") || text.includes("create-probe-image")) return false;
  if (text.includes("agent-chat") || text.includes("agent-image-continue") || text.includes("agent-read-image")) return true;
  if (text.includes("-agent-") || text.startsWith("agent-")) return true;
  if (text.includes("compact-summary-image")) return true;
  return Boolean(detail.chat || detail.usedImageGen || detail.usedCommand || detail.usedWorkflowList || detail.usedContextManage);
}

function classifyAgentAutonomyStep(label, detail) {
  const progress = latestRuntimeProgress(detail?.state?.progress || detail?.chat?.state?.progress || detail?.progress);
  const forcedProgress = asArray(detail?.forcedProgress);
  const modelForceEvents = forcedProgress.length || progress.filter((item) => item?.phase === "model-force").length;
  const argCorrectionEvents = asArray(detail?.correctedProgress).length || progress.filter((item) => item?.phase === "model-arg-correct").length;
  const modelToolChoiceEvents = progress.filter((item) => item?.phase === "model-tool-choice").length;
  const imageToolChoiceEvents = progress.filter((item) => item?.phase === "model-tool-choice" && item?.tool === "image_gen").length;
  const tools = progressToolSet(progress);
  if (detail?.usedCommand) tools.add("shell_command");
  if (detail?.usedWorkflowList) tools.add("workflow");
  if (detail?.usedContextManage) tools.add("context_manage");
  if (detail?.usedImageGen) tools.add("image_gen");
  const usedTool = tools.size > 0;
  const usedImageGen = tools.has("image_gen") || Boolean(detail?.usedImageGen);
  const kind = modelForceEvents > 0
    ? "fallback"
    : modelToolChoiceEvents > 0
      ? "tool-choice"
      : usedTool
        ? "direct"
        : "unknown";
  return {
    label,
    kind,
    usedTool,
    usedImageGen,
    tools: Array.from(tools).sort(),
    modelForceEvents,
    argCorrectionEvents,
    modelToolChoiceEvents,
    imageToolChoiceEvents
  };
}

function collectAgentAutonomyStats(results) {
  const stats = {
    requests: 0,
    direct: 0,
    toolChoice: 0,
    fallback: 0,
    unknown: 0,
    imageRequests: 0,
    imageDirect: 0,
    imageToolChoice: 0,
    imageFallback: 0,
    modelForceEvents: 0,
    argCorrectionEvents: 0,
    modelToolChoiceEvents: 0,
    imageToolChoiceEvents: 0,
    selectedContinuation: "not-run",
    selectedDirectContinuation: "not-run",
    samples: []
  };
  const addRecord = (record) => {
    if (!record) return;
    stats.requests += 1;
    if (record.kind === "direct") stats.direct += 1;
    else if (record.kind === "tool-choice") stats.toolChoice += 1;
    else if (record.kind === "fallback") stats.fallback += 1;
    else stats.unknown += 1;
    if (record.usedImageGen) {
      stats.imageRequests += 1;
      if (record.kind === "direct") stats.imageDirect += 1;
      else if (record.kind === "tool-choice") stats.imageToolChoice += 1;
      else if (record.kind === "fallback") stats.imageFallback += 1;
    }
    stats.modelForceEvents += Number(record.modelForceEvents || 0);
    stats.argCorrectionEvents += Number(record.argCorrectionEvents || 0);
    stats.modelToolChoiceEvents += Number(record.modelToolChoiceEvents || 0);
    stats.imageToolChoiceEvents += Number(record.imageToolChoiceEvents || 0);
    if (stats.samples.length < 18) {
      const tools = record.tools?.length ? `:${record.tools.join("+")}` : "";
      stats.samples.push(`${record.label}=${record.kind}${tools}`);
    }
  };

  const seenSuiteKeys = new Set();
  for (const result of results) {
    const suite = result?.suite || {};
    const suiteSteps = asArray(suite.steps);
    const suiteKey = result?.suitePath || (suite.startedAt ? `${result?.label || "suite"}:${suite.startedAt}` : "");
    const shouldScanSuite = suiteSteps.length && (!suiteKey || !seenSuiteKeys.has(suiteKey));
    if (suiteKey && shouldScanSuite) seenSuiteKeys.add(suiteKey);
    if (shouldScanSuite) {
      for (const step of suiteSteps) {
        const detail = step?.detail;
        if (!isAgentAutonomyStep(step?.label, detail)) continue;
        addRecord(classifyAgentAutonomyStep(step.label, detail));
      }
    }
    if ((result?.label === "agent-selected-continuation-884" || result?.label === "agent-selected-direct-continuation-884") && suite) {
      const kind = suite.autonomyKind || (suite.autonomousImageGen ? "direct" : suite.routedImageGen ? "tool-choice" : suite.usedModelForce ? "fallback" : "unknown");
      if (result.label === "agent-selected-direct-continuation-884") stats.selectedDirectContinuation = kind;
      else stats.selectedContinuation = kind;
      addRecord({
        label: result.label,
        kind,
        usedTool: Boolean(suite.usedImageGen),
        usedImageGen: Boolean(suite.usedImageGen),
        tools: suite.usedImageGen ? ["image_gen"] : [],
        modelForceEvents: asArray(suite.forcedProgress).length,
        argCorrectionEvents: Number(suite.autonomyCounts?.argCorrections || asArray(suite.correctedProgress).length),
        modelToolChoiceEvents: Number(suite.autonomyCounts?.modelToolChoice || (suite.usedToolChoice ? 1 : 0)),
        imageToolChoiceEvents: Number(suite.autonomyCounts?.imageToolChoice || (suite.usedToolChoice ? 1 : 0))
      });
    }
  }
  stats.ok = stats.requests > 0 && stats.fallback === 0 && stats.unknown === 0;
  return stats;
}

function emptyOverflowReport() {
  return { documentOverflowX: false, bodyOverflowX: false, elementOverflowX: [] };
}

function captureAgentAutonomyHardGateFixture() {
  const label = "agent-autonomy-hard-gate-fixture";
  const screenshotPath = join(runDir, `${label}.png`);
  const jsonPath = join(runDir, `${label}.json`);
  const directSuite = {
    ok: false,
    directProbe: true,
    correctionFreeOk: false,
    usedImageGen: true,
    autonomousImageGen: true,
    routedImageGen: false,
    usedModelForce: false,
    usedToolChoice: false,
    autonomyKind: "direct",
    forcedProgress: [],
    correctedProgress: [{ tool: "image_gen", summary: "fixture corrected wrong parentId", input: { parentId: "wrong-node" } }],
    autonomyCounts: {
      direct: 1,
      toolChoice: 0,
      fallback: 0,
      unknown: 0,
      modelForce: 0,
      argCorrections: 1,
      modelToolChoice: 0,
      imageToolChoice: 0
    }
  };
  const stats = collectAgentAutonomyStats([{ label: "agent-selected-direct-continuation-884", suite: directSuite }]);
  const hardGateWouldFail = directSuite.directProbe && !directSuite.correctionFreeOk && directSuite.ok === false;
  const aggregateCountsCorrection = stats.argCorrectionEvents === 1;
  const aggregateWouldWarn = stats.argCorrectionEvents > 0;
  const ok = Boolean(hardGateWouldFail && aggregateCountsCorrection && aggregateWouldWarn);
  const state = {
    hardGateFixtureOk: ok,
    hardGateWouldFail,
    aggregateCountsCorrection,
    aggregateWouldWarn,
    argCorrectionEvents: stats.argCorrectionEvents,
    selectedDirectContinuation: stats.selectedDirectContinuation
  };
  const stateIssues = ok ? [] : Object.entries(state)
    .filter(([key, value]) => (key === "argCorrectionEvents" ? value !== 1 : value !== true && key !== "selectedDirectContinuation"))
    .map(([key, actual]) => ({ key, expected: key === "argCorrectionEvents" ? 1 : true, actual }));
  writeFileSync(screenshotPath, fallbackPng);
  writeFileSync(jsonPath, JSON.stringify({ label, state, suite: { ok, directSuite, stats }, stateIssues }, null, 2));
  if (stateIssues.length) recordObservation("issue", label, { stateIssues, stats });
  return {
    label,
    screenshotPath,
    jsonPath,
    imagePreviewPixelReport: { checked: false, ok: true },
    nativeCapture: { ok: true, source: "fixture" },
    state,
    stateIssues,
    overflow: emptyOverflowReport(),
    captureIssues: [],
    suite: { ok, directSuite, stats }
  };
}

function appendNonVisualSelfChecks(results) {
  if (!results.some((item) => item?.label === "agent-autonomy-hard-gate-fixture")) {
    results.push(captureAgentAutonomyHardGateFixture());
  }
}

function formatAgentAutonomyStats(stats) {
  if (!stats?.requests) return "requests=0, direct=0, toolChoice=0, fallback=0, unknown=0";
  return [
    `requests=${stats.requests}`,
    `direct=${stats.direct}`,
    `toolChoice=${stats.toolChoice}`,
    `fallback=${stats.fallback}`,
    `unknown=${stats.unknown}`,
    `image=${stats.imageRequests}`,
    `imageDirect=${stats.imageDirect}`,
    `imageToolChoice=${stats.imageToolChoice}`,
    `imageFallback=${stats.imageFallback}`,
    `modelForce=${stats.modelForceEvents}`,
    `argCorrections=${stats.argCorrectionEvents}`,
    `modelToolChoice=${stats.modelToolChoiceEvents}`,
    `imageToolChoiceEvents=${stats.imageToolChoiceEvents}`,
    `selected=${stats.selectedContinuation}`,
    `selectedDirect=${stats.selectedDirectContinuation}`
  ].join(", ");
}

function writeRunSummary(results, failures, contactSheetPath) {
  const issueObservations = observations.filter((item) => item.level === "issue");
  const runningUiSuites = results.filter((item) => item.label.startsWith("agent-running-ui"));
  const runningSupplementDraftSuites = results.filter((item) => item.label.startsWith("agent-running-supplement-draft"));
  const runningSupplementModelSuites = results.filter((item) => item.label.startsWith("agent-running-supplement-model-popover"));
  const runningReferenceSuites = results.filter((item) => item.label.startsWith("agent-running-reference-"));
  const stopUiSuites = results.filter((item) => item.label.startsWith("agent-stop-ui"));
  const stopResendSuites = results.filter((item) => item.label.startsWith("agent-stop-resend"));
  const busySupplementSuites = results.filter((item) => item.label.startsWith("agent-busy-supplement"));
  const toolSuite = results.find((item) => item.label.startsWith("agent-tool-suite")) || results.find((item) => item.label.startsWith("agent-clear-canvas"));
  const toolSuiteCompact = results.find((item) => item.label === "agent-tool-suite-540");
  const messageFixtureSuites = results.filter((item) => item.label.startsWith("agent-message-fixture-"));
  const agentUiPromptSuite = results.find((item) => item.label.startsWith("agent-ui-prompt-suite"));
  const realAgentSuite = results.find((item) => item.label.startsWith("agent-real-agent-suite"));
  const experienceImageSuite = results.find((item) => item.label.startsWith("agent-experience-image"));
  const imageSuite = results.find((item) => item.label.startsWith("agent-image-suite"));
  const posterBatchSuite = results.find((item) => item.label.startsWith("agent-poster-batch"));
  const mixedSuite = results.find((item) => item.label.startsWith("agent-mixed-stress"));
  const mixedCompactSuite = results.find((item) => item.label === "agent-mixed-stress-884");
  const mixedFocusSuites = results.filter((item) => item.label.startsWith("agent-mixed-focus-"));
  const selectedContinuationSuite = results.find((item) => item.label === "agent-selected-continuation-884");
  const selectedDirectContinuationSuite = results.find((item) => item.label === "agent-selected-direct-continuation-884");
  const longSessionBottomSuite = results.find((item) => item.label === "agent-long-session-bottom-884");
  const contextPersistenceSuite = results.find((item) => item.label.startsWith("agent-context-persistence"));
  const hardGateFixture = results.find((item) => item.label === "agent-autonomy-hard-gate-fixture");
  const contextPersistenceImageStep = contextPersistenceSuite?.suite?.steps?.find((item) => item.label === "context-persistence-agent-image-after-read");
  const contextPersistenceMemoryImage =
    contextPersistenceImageStep
      ? contextPersistenceImageStep.ok && contextPersistenceImageStep.detail?.promptIncludesSentinel
        ? "ok"
        : "fail"
      : "not-run";
  const agentAutonomyStats = collectAgentAutonomyStats(results);
  const agentAutonomySummary = formatAgentAutonomyStats(agentAutonomyStats);
  const agentAutonomyObservation = agentAutonomyStats.requests
    ? {
        level: agentAutonomyStats.fallback > 0 || agentAutonomyStats.unknown > 0 || agentAutonomyStats.argCorrectionEvents > 0 ? "warning" : "info",
        area: "agent-autonomy",
        message: `Agent autonomy aggregate: ${agentAutonomySummary}`
      }
    : null;
  const previewCropStatus = (item) =>
    item?.imagePreviewPixelReport?.checked
      ? item.imagePreviewPixelReport.geometryOk === false
        ? "fail"
        : "ok"
      : "not-run";
  const compactSummaryStatus = (suite) =>
    suite?.compactSummaryRequired === false
      ? "skip"
      : suite?.compactSummaryImageOk
        ? "ok"
        : "fail";
  const previewGeometryStats = (item) => {
    const report = item?.imagePreviewPixelReport || {};
    if (!report.checked) return "minSrc=not-run, maxAspect=not-run";
    const samples = Array.isArray(report.samples) ? report.samples : [];
    if (!samples.length) return "minSrc=none, maxAspect=none";
    const sourceRatios = samples.map((sample) => Number(sample.sourceVisibleRatio)).filter(Number.isFinite);
    const aspectDeltas = samples.map((sample) => Number(sample.aspectDelta)).filter(Number.isFinite);
    const minSource = sourceRatios.length ? Math.min(...sourceRatios) : 0;
    const maxAspect = aspectDeltas.length ? Math.max(...aspectDeltas) : 0;
    return `minSrc=${Math.round(minSource * 1000) / 1000}, maxAspect=${Math.round(maxAspect * 1000) / 1000}`;
  };
  const previewDetailStats = (item) => {
    const thresholds = item?.state?.imagePreviewDetailThresholds || {};
    return `detail=${item?.state?.imagePreviewDetailOk ? "ok" : "fail"}, previewArea=${item?.state?.imagePreviewAreaMin ?? "unknown"}/${thresholds.minArea ?? "unknown"}`;
  };
  const titleAccessStats = (item) =>
    `titleAccess=${item?.state?.nodeTitleTextClippingAccessibleOk ? "ok" : "fail"}, visibleTitleClip=${item?.state?.visibleNodeTitleTextClippedCount ?? "unknown"}`;
  const formatMessageFixtureSuite = (item) => {
    const report = item?.messageFixturePixelReport || {};
    const requiredKinds = Array.isArray(report.requiredKinds) && report.requiredKinds.length ? report.requiredKinds.join("|") : "none";
    const visibleKinds = Array.isArray(report.visibleKinds) && report.visibleKinds.length ? report.visibleKinds.join("|") : "none";
    const missingKinds = Array.isArray(report.missingKinds) && report.missingKinds.length ? report.missingKinds.join("|") : "none";
    const bottomStatus = requiredKinds === "tool-trace" ? "not-required" : item.state?.agentTimelineBottomOk ? "ok" : "fail";
    return `- ${item.label}: messageLayout=${item.state?.agentMessageLayoutOk ? "ok" : "fail"}, trace=${item.state?.agentToolTracePresent && item.state?.agentToolTraceLayoutOk ? "ok" : "fail"}, traceCount=${item.state?.agentToolTraceCount ?? "unknown"}, code=${item.state?.markdownCodeBlockPresent && item.state?.markdownCodeBlockLayoutOk ? "ok" : "fail"}, codeCount=${item.state?.markdownCodeBlockCount ?? "unknown"}, codeHead=${item.state?.markdownCodeHeaderPolishOk ? "ok" : "fail"}, paste=${item.state?.agentPasteBlockPresent && item.state?.agentPasteBlockLayoutOk ? "ok" : "fail"}, pasteCount=${item.state?.agentPasteBlockCount ?? "unknown"}, pixel=${report.checked ? report.ok ? "ok" : "fail" : "not-run"}, required=${requiredKinds}, visible=${visibleKinds}, missing=${missingKinds}, bottom=${bottomStatus}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`;
  };
  const agentIssues = [
    ...(Array.isArray(toolSuite?.suite?.issues) ? toolSuite.suite.issues : []),
    ...(Array.isArray(realAgentSuite?.suite?.issues) ? realAgentSuite.suite.issues : []),
    ...(Array.isArray(experienceImageSuite?.suite?.issues) ? experienceImageSuite.suite.issues : []),
    ...(Array.isArray(imageSuite?.suite?.issues) ? imageSuite.suite.issues : []),
    ...(Array.isArray(posterBatchSuite?.suite?.issues) ? posterBatchSuite.suite.issues : []),
    ...(Array.isArray(mixedSuite?.suite?.issues) ? mixedSuite.suite.issues : []),
    ...(Array.isArray(contextPersistenceSuite?.suite?.issues) ? contextPersistenceSuite.suite.issues : []),
    ...(agentAutonomyObservation ? [agentAutonomyObservation] : [])
  ];
  const lines = [
    "# IIimage AIDebug Run",
    "",
    `- ok: ${failures.length === 0}`,
    `- agentMode: ${mockAgent ? "mock-agent" : "real-agent"}`,
    `- modelForce: ${mockAgent ? "enabled-for-fixture" : "disabled"}`,
    `- scenes: ${results.length}`,
    `- failures: ${failures.length}`,
    `- observations: ${observations.length}`,
    `- cycle: ${cycleIndex}/${cycleTotal}`,
    `- contactSheet: ${contactSheetPath}`,
    "",
    "## Agent Running UI",
    "",
    ...(runningUiSuites.length
      ? runningUiSuites.map((item) => `- ${item.label}: running=${item.state?.agentRunningUiOk ? "ok" : "fail"}, status=${item.state?.agentRunningStatusOk ? "ok" : "fail"}, stop=${item.state?.stopButtonOk ? "ok" : "fail"}, dot=${item.state?.runningTimelineDotOk ? "ok" : "fail"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, stopMs=${item.state?.motionMetrics?.stop?.transitionMs ?? "unknown"}, dotAnim=${item.state?.motionMetrics?.runningDot?.animationName || "none"}, placeholder=${item.state?.composerBusyPlaceholderOk ? "ok" : "fail"}, controls=${item.state?.composerControlsVisibleOk ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, topbar=${item.state?.topbarControlsDockedOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : ["- agent running UI scene missing"]),
    ...(runningSupplementDraftSuites.length
      ? runningSupplementDraftSuites.map((item) => `- ${item.label}: draft=${item.state?.agentRunningSupplementDraftOk ? "ok" : "fail"}, send=${item.state?.supplementButtonVisibleOk ? "visible" : "missing"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, supplementAnim=${item.state?.motionMetrics?.supplement?.animationName || "none"}, pair=${item.state?.supplementButtonPairOk ? "ok" : "fail"}, gap=${item.state?.supplementButtonGap ?? "unknown"}, prompt=${item.state?.supplementDraftPromptPresent ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    ...(runningSupplementModelSuites.length
      ? runningSupplementModelSuites.map((item) => `- ${item.label}: popover=${item.state?.busySupplementModelPopoverOk ? "ok" : "fail"}, docked=${item.state?.composerPopoverDocked ? "ok" : "fail"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, popoverAnim=${item.state?.motionMetrics?.popover?.animationName || "none"}, avoidsActions=${item.state?.composerPopoverAvoidsActions ? "ok" : "fail"}, stopOverlap=${item.state?.popoverStopOverlapArea ?? "unknown"}, supplementOverlap=${item.state?.popoverSupplementOverlapArea ?? "unknown"}, send=${item.state?.supplementButtonVisibleOk ? "visible" : "missing"}, pair=${item.state?.supplementButtonPairOk ? "ok" : "fail"}, prompt=${item.state?.busyModelPromptPresent ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    ...(runningReferenceSuites.length
      ? runningReferenceSuites.map((item) => `- ${item.label}: strip=${item.state?.agentRunningReferenceStripOk ? "ok" : "fail"}, count=${item.state?.referenceImageCount ?? "unknown"}, add=${item.state?.referenceAddButtonDisabledOk ? "disabled" : item.state?.referenceAddButtonEnabledOk ? "enabled" : "fail"}, motion=${item.state?.agentMotionOk ? "ok" : "fail"}, removeMs=${item.state?.motionMetrics?.referenceRemove?.transitionMs ?? "unknown"}, thumbs=${item.state?.referenceThumbsVisibleOk ? "ok" : "fail"}, visual=${item.state?.referenceThumbVisualOk ? "ok" : "fail"}, polish=${item.state?.referenceThumbPolishOk ? "ok" : "fail"}, remove=${item.state?.referenceRemoveButtonsOk ? "ok" : "fail"}, toolbarOverlap=${item.state?.referenceStripToolbarOverlapArea ?? "unknown"}, sendOverlap=${item.state?.referenceStripSendOverlapArea ?? "unknown"}, supplementOverlap=${item.state?.referenceStripSupplementOverlapArea ?? "unknown"}, toolbarGap=${item.state?.referenceStripToolbarGap ?? "unknown"}, pair=${item.state?.supplementButtonPairOk ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    ...(stopUiSuites.length
      ? stopUiSuites.map((item) => `- ${item.label}: stopped=${item.state?.agentStopUiOk ? "ok" : "fail"}, status=${item.state?.agentStoppedStatusOk ? "ok" : "fail"}, send=${item.state?.sendButtonIdleOk ? "ok" : "fail"}, runningMessages=${item.state?.runningMessageCount ?? "unknown"}, interrupt=${item.state?.agentInterruptMessageVisible ? "ok" : "fail"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    ...(stopResendSuites.length
      ? stopResendSuites.map((item) => `- ${item.label}: resend=${item.state?.agentStopResendOk ? "ok" : "fail"}, afterInterrupt=${item.state?.stopResendAfterInterruptOk ? "ok" : "fail"}, assistant=${item.state?.stopResendAssistantOk ? "ok" : "fail"}, workflow=${item.state?.stopResendWorkflowToolOk ? "ok" : "fail"}, imageGen=${item.state?.stopResendImageGenUsed ? "used" : "none"}, promptCleared=${item.state?.stopResendPromptCleared ? "ok" : "fail"}, runningMessages=${item.state?.runningMessageCount ?? "unknown"}, interruptCount=${item.state?.interruptMessageCount ?? "unknown"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    ...(busySupplementSuites.length
      ? busySupplementSuites.map((item) => `- ${item.label}: supplement=${item.state?.agentBusySupplementOk ? "ok" : "fail"}, click=${item.state?.busySupplementClickPathOk ? "button" : "fail"}, meta=${item.state?.busySupplementUserMetaOk ? "interrupt" : "fail"}, assistant=${item.state?.busySupplementAssistantOk ? "ok" : "fail"}, runtime=${item.state?.busySupplementRuntimeRequestOk ? "ok" : "fail"}, workflow=${item.state?.busySupplementWorkflowToolOk ? "ok" : "fail"}, imageGen=${item.state?.busySupplementImageGenUsed ? "used" : "none"}, latestProgress=${item.state?.busySupplementLatestProgressOk ? "new-run" : "stale"}, promptCleared=${item.state?.busySupplementPromptCleared ? "ok" : "fail"}, runningMessages=${item.state?.runningMessageCount ?? "unknown"}, runId=${item.state?.busySupplementRunId || "unknown"}, composerViewport=${item.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${item.state?.compactViewportFitOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    "",
    "## Agent Tool Suite",
    "",
    toolSuite?.suite
      ? `- ${toolSuite.label}: ok=${toolSuite.suite.ok}, steps=${toolSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : toolSuite
        ? `- ${toolSuite.label}: nodeCount=${toolSuite.state?.agentNodeCount}, workflowClear=${toolSuite.state?.agentWorkflowClearTool}, done=${toolSuite.state?.agentClearCanvasDone}`
        : "- agent tool suite scene missing",
    toolSuiteCompact
      ? `- ${toolSuiteCompact.label}: messageLayout=${toolSuiteCompact.state?.agentMessageLayoutOk ? "ok" : "fail"}, trace=${toolSuiteCompact.state?.agentToolTraceLayoutOk ? "ok" : "fail"}, traceNoBar=${toolSuiteCompact.state?.agentToolTraceNoLeftRuleOk && toolSuiteCompact.state?.agentToolTraceNoPseudoLeftRuleOk ? "ok" : "fail"}, traceCopy=${toolSuiteCompact.state?.agentToolTraceTitleBriefOk ? "ok" : "fail"}, timelineLine=${toolSuiteCompact.state?.agentTimelineLeftLineOk ? "ok" : "fail"}, imageGenText=${toolSuiteCompact.state?.agentImageGenStillRunningTextAbsent ? "ok" : "fail"}, imageGenTimer=${toolSuiteCompact.state?.agentImageGenTimerOk ? "ok" : "fail"}, traceCount=${toolSuiteCompact.state?.agentToolTraceCount ?? "unknown"}, code=${toolSuiteCompact.state?.markdownCodeBlockLayoutOk ? "ok" : "fail"}, codeCount=${toolSuiteCompact.state?.markdownCodeBlockCount ?? "unknown"}, bottom=${toolSuiteCompact.state?.agentTimelineBottomOk ? "ok" : "fail"}, stateIssues=${toolSuiteCompact.stateIssues.length}, overflow=${toolSuiteCompact.overflow.elementOverflowX.length}, captureIssues=${toolSuiteCompact.captureIssues.length}`
      : null,
    ...(messageFixtureSuites.length
      ? messageFixtureSuites.map(formatMessageFixtureSuite)
      : ["- agent message fixture scenes missing"]),
    "",
    "## Real UI Prompt Suite",
    "",
    agentUiPromptSuite?.suite
      ? `- ${agentUiPromptSuite.label}: ok=${agentUiPromptSuite.suite.ok}, autonomous=${agentUiPromptSuite.suite.autonomous ? "yes" : "no"}, usedImageGen=${agentUiPromptSuite.suite.usedImageGen ? "yes" : "no"}, toolStartImage=${agentUiPromptSuite.suite.toolStartImage ? "yes" : "no"}, modal=${agentUiPromptSuite.suite.imageTaskModalOpen ? "open" : "closed"}, newImages=${agentUiPromptSuite.suite.newImageNodes?.map((node) => node.id).join("|") || "none"}, force=${agentUiPromptSuite.suite.modelForce?.length || 0}, toolChoice=${agentUiPromptSuite.suite.modelToolChoice?.length || 0}, argCorrect=${agentUiPromptSuite.suite.modelArgCorrect?.length || 0}, contractWarn=${agentUiPromptSuite.suite.modelContractWarning?.length || 0}, responses=${agentUiPromptSuite.suite.modelResponseDetails?.map((item) => `toolCalls=${item?.toolCallCount ?? "unknown"}`).join("|") || "none"}, steps=${agentUiPromptSuite.suite.steps?.map((step) => `${step.label}:${step.ok ? "ok" : "fail"}${step.label === "feedback-continue-3" ? `/count=${step.countOk ? "ok" : "fail"}/parent=${step.parentOk ? "ok" : "fail"}/relation=${step.relationOk ? "ok" : "fail"}/prompt=${step.promptInheritedOk ? "ok" : "fail"}/assets=${step.imageCountOk ? "ok" : "fail"}` : ""}`).join(", ") || "none"}`
      : "- real UI prompt suite scene missing",
    "",
    "## Real Agent Suite",
    "",
    realAgentSuite?.suite
      ? `- ${realAgentSuite.label}: ok=${realAgentSuite.suite.ok}, liveImage=${realAgentSuite.suite.liveImageMode ? "true" : "false"}, created=${realAgentSuite.suite.createdImageId || "none"}, steps=${realAgentSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : "- real agent suite scene missing",
    "",
    "## Agent Experience Image",
    "",
    experienceImageSuite?.suite
      ? `- ${experienceImageSuite.label}: ok=${experienceImageSuite.suite.ok}, recorded=${experienceImageSuite.suite.experienceRecorded ? "yes" : "no"}, read=${experienceImageSuite.suite.experienceRead ? "yes" : "no"}, sentinel=${experienceImageSuite.suite.agentExperienceSentinel ? "present" : "none"}, imageId=${experienceImageSuite.suite.imageId || "none"}, steps=${experienceImageSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : "- agent experience image scene missing",
    "",
    "## Agent Image Suite",
    "",
    imageSuite?.suite
      ? `- ${imageSuite.label}: ok=${imageSuite.suite.ok}, runs=${imageSuite.suite.runs}, maxFooterGap=${imageSuite.state?.nodeFooterGapMax}, readability=${imageSuite.state?.canvasReadabilityOk ? "ok" : "fail"}, preview=${imageSuite.state?.imagePreviewVisibleCountOk && imageSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${imageSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(imageSuite)}, ${previewGeometryStats(imageSuite)}, ${previewDetailStats(imageSuite)}, visiblePreviews=${imageSuite.state?.visibleImagePreviewCount ?? "unknown"}, overlap=${imageSuite.state?.nodeOverlapPairCount ?? "unknown"}, titleMin=${imageSuite.state?.nodeTitleVisibleRatioMin ?? "unknown"}, ${titleAccessStats(imageSuite)}, composerOverlap=${imageSuite.state?.composerNodeOverlapCount ?? "unknown"}, steps=${imageSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : "- agent image suite scene missing",
    "",
    "## Agent Poster Batch",
    "",
    posterBatchSuite?.suite
      ? `- ${posterBatchSuite.label}: ok=${posterBatchSuite.suite.ok}, generated=${posterBatchSuite.suite.generatedCount}/${posterBatchSuite.suite.totalRequested}, agent=${posterBatchSuite.suite.agentGenerated}/${posterBatchSuite.suite.agentRequested}, direct=${posterBatchSuite.suite.directGenerated}/${posterBatchSuite.suite.directRequested}, resolution=${posterBatchSuite.suite.resolution || "unknown"}, maxFooterGap=${posterBatchSuite.state?.nodeFooterGapMax}, readability=${posterBatchSuite.state?.canvasReadabilityOk ? "ok" : "fail"}, preview=${posterBatchSuite.state?.imagePreviewVisibleCountOk && posterBatchSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${posterBatchSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(posterBatchSuite)}, ${previewGeometryStats(posterBatchSuite)}, ${previewDetailStats(posterBatchSuite)}, visiblePreviews=${posterBatchSuite.state?.visibleImagePreviewCount ?? "unknown"}, overlap=${posterBatchSuite.state?.nodeOverlapPairCount ?? "unknown"}, titleMin=${posterBatchSuite.state?.nodeTitleVisibleRatioMin ?? "unknown"}, ${titleAccessStats(posterBatchSuite)}, composerOverlap=${posterBatchSuite.state?.composerNodeOverlapCount ?? "unknown"}, steps=${posterBatchSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : "- agent poster batch scene missing",
    "",
    "## Agent Mixed Stress",
    "",
    mixedSuite?.suite
      ? `- ${mixedSuite.label}: ok=${mixedSuite.suite.ok}, rounds=${mixedSuite.suite.rounds}, imageNodes=${mixedSuite.suite.imageNodeIds?.length || 0}/${mixedSuite.suite.expectedImageNodes || 0}, imageChains=${mixedSuite.suite.imageChains?.filter((item) => item.parentOk).length || 0}/${mixedSuite.suite.rounds || 0}, compactDone=${mixedSuite.suite.compactDoneCount || 0}, compactImage=${mixedSuite.suite.compactImageContinuations || 0}, compactAny=${mixedSuite.suite.compactSuccessfulContinuations || 0}, compactSummary=${compactSummaryStatus(mixedSuite.suite)}, experienceRounds=${mixedSuite.suite.experienceSentinels?.length || 0}, steps=${mixedSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : "- agent mixed stress scene missing",
    mixedSuite?.suite && mixedCompactSuite
      ? `- ${mixedCompactSuite.label}: supportedMinimum=${mixedCompactSuite.stateIssues.length || mixedCompactSuite.overflow.elementOverflowX.length || mixedCompactSuite.captureIssues.length ? "fail" : "ok"}, imageViewport=${mixedCompactSuite.state?.imageNodeViewportOk ? "ok" : "fail"}, readability=${mixedCompactSuite.state?.canvasReadabilityOk ? "ok" : "fail"}, preview=${mixedCompactSuite.state?.imagePreviewVisibleCountOk && mixedCompactSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${mixedCompactSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(mixedCompactSuite)}, ${previewGeometryStats(mixedCompactSuite)}, ${previewDetailStats(mixedCompactSuite)}, density=${mixedCompactSuite.state?.compactCanvasDensityOk ? "ok" : "fail"}, spacing=${mixedCompactSuite.state?.selectedNodeSpacingOk ? "ok" : "fail"}, viewport=${mixedCompactSuite.state?.compactViewportFitOk ? "ok" : "fail"}, topbar=${mixedCompactSuite.state?.topbarControlsDockedOk ? "ok" : "fail"}, composerViewport=${mixedCompactSuite.state?.composerViewportVisibleOk ? "ok" : "fail"}, imageNodes=${mixedCompactSuite.state?.imageNodeCount ?? "unknown"}, visibleNodes=${mixedCompactSuite.state?.visibleFlowNodeCount ?? "unknown"}, visiblePreviews=${mixedCompactSuite.state?.visibleImagePreviewCount ?? "unknown"}, zoom=${mixedCompactSuite.state?.canvasZoomPercent ?? "unknown"}%, selectedGap=${mixedCompactSuite.state?.selectedNodeNearestGap ?? "unknown"}, selectedVisibleGap=${mixedCompactSuite.state?.selectedNodeNearestVisibleGap ?? "unknown"}, footerGap=${mixedCompactSuite.state?.nodeFooterGapMax ?? "unknown"}, overlap=${mixedCompactSuite.state?.nodeOverlapPairCount ?? "unknown"}, maxOverlapRatio=${mixedCompactSuite.state?.nodeOverlapRatioMax ?? "unknown"}, titleMin=${mixedCompactSuite.state?.nodeTitleVisibleRatioMin ?? "unknown"}, ${titleAccessStats(mixedCompactSuite)}, composerOverlap=${mixedCompactSuite.state?.composerNodeOverlapCount ?? "unknown"}, stateIssues=${mixedCompactSuite.stateIssues.length}, overflow=${mixedCompactSuite.overflow.elementOverflowX.length}, captureIssues=${mixedCompactSuite.captureIssues.length}`
      : null,
    ...(mixedFocusSuites.length
      ? mixedFocusSuites.map((item) => `- ${item.label}: target=${item.focusTargetId || "unknown"}, selected=${item.state?.selectedNodeId || "unknown"}, focus=${item.state?.selectedImageFocusOk ? "ok" : "fail"}, selectedViewport=${item.state?.selectedImageNodeViewportOk ? "ok" : "fail"}, latestViewport=${item.state?.imageNodeViewportOk ? "ok" : "fail"}, title=${item.state?.selectedNodeTitleVisibleOk ? "ok" : "fail"}, ${titleAccessStats(item)}, spacing=${item.state?.selectedNodeSpacingOk ? "ok" : "fail"}, zoom=${item.state?.canvasZoomPercent ?? "unknown"}%, zoomUsable=${item.state?.canvasZoomUsableOk ? "ok" : "fail"}, visibleImages=${item.state?.visibleImageNodeCount ?? "unknown"}, visiblePreviews=${item.state?.visibleImagePreviewCount ?? "unknown"}, preview=${item.state?.imagePreviewVisibleCountOk && item.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${item.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(item)}, ${previewGeometryStats(item)}, ${previewDetailStats(item)}, composerOverlap=${item.state?.selectedNodeComposerOverlapArea ?? "unknown"}, readability=${item.state?.canvasReadabilityOk ? "ok" : "fail"}, density=${item.state?.compactCanvasDensityOk ? "ok" : "fail"}, stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}`)
      : []),
    selectedContinuationSuite
      ? `- ${selectedContinuationSuite.label}: ok=${selectedContinuationSuite.suite?.ok ? "true" : "false"}, sequence=${selectedContinuationSuite.suite?.sequence?.join(">") || "none"}, target=${selectedContinuationSuite.suite?.targetId || "unknown"}, selectedBefore=${selectedContinuationSuite.suite?.selectedBeforeChat || "unknown"}, created=${selectedContinuationSuite.suite?.createdId || "none"}, parent=${selectedContinuationSuite.suite?.createdParentId || "none"}, imageGen=${selectedContinuationSuite.suite?.usedImageGen ? "used" : "missing"}, autonomy=${selectedContinuationSuite.suite?.autonomousImageGen ? "direct" : selectedContinuationSuite.suite?.routedImageGen ? "tool-choice" : selectedContinuationSuite.suite?.usedModelForce ? "fallback" : "unknown"}, force=${selectedContinuationSuite.suite?.forcedProgress?.length || 0}, correct=${selectedContinuationSuite.suite?.correctedProgress?.length || 0}, clear=${selectedContinuationSuite.suite?.unexpectedClear ? "bad" : "none"}, focus=${selectedContinuationSuite.state?.selectedImageFocusOk ? "ok" : "fail"}, selected=${selectedContinuationSuite.state?.selectedNodeId || "unknown"}, preview=${selectedContinuationSuite.state?.imagePreviewVisibleCountOk && selectedContinuationSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${selectedContinuationSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(selectedContinuationSuite)}, ${previewGeometryStats(selectedContinuationSuite)}, ${previewDetailStats(selectedContinuationSuite)}, ${titleAccessStats(selectedContinuationSuite)}, stateIssues=${selectedContinuationSuite.stateIssues.length}, overflow=${selectedContinuationSuite.overflow.elementOverflowX.length}, captureIssues=${selectedContinuationSuite.captureIssues.length}`
      : null,
    selectedDirectContinuationSuite
      ? `- ${selectedDirectContinuationSuite.label}: ok=${selectedDirectContinuationSuite.suite?.ok ? "true" : "false"}, sequence=${selectedDirectContinuationSuite.suite?.sequence?.join(">") || "none"}, target=${selectedDirectContinuationSuite.suite?.targetId || "unknown"}, selectedBefore=${selectedDirectContinuationSuite.suite?.selectedBeforeChat || "unknown"}, created=${selectedDirectContinuationSuite.suite?.createdId || "none"}, parent=${selectedDirectContinuationSuite.suite?.createdParentId || "none"}, imageGen=${selectedDirectContinuationSuite.suite?.usedImageGen ? "used" : "missing"}, autonomy=${selectedDirectContinuationSuite.suite?.autonomousImageGen ? "direct" : selectedDirectContinuationSuite.suite?.routedImageGen ? "tool-choice" : selectedDirectContinuationSuite.suite?.usedModelForce ? "fallback" : "unknown"}, force=${selectedDirectContinuationSuite.suite?.forcedProgress?.length || 0}, correct=${selectedDirectContinuationSuite.suite?.correctedProgress?.length || 0}, clear=${selectedDirectContinuationSuite.suite?.unexpectedClear ? "bad" : "none"}, focus=${selectedDirectContinuationSuite.state?.selectedImageFocusOk ? "ok" : "fail"}, selected=${selectedDirectContinuationSuite.state?.selectedNodeId || "unknown"}, preview=${selectedDirectContinuationSuite.state?.imagePreviewVisibleCountOk && selectedDirectContinuationSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${selectedDirectContinuationSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(selectedDirectContinuationSuite)}, ${previewGeometryStats(selectedDirectContinuationSuite)}, ${previewDetailStats(selectedDirectContinuationSuite)}, ${titleAccessStats(selectedDirectContinuationSuite)}, stateIssues=${selectedDirectContinuationSuite.stateIssues.length}, overflow=${selectedDirectContinuationSuite.overflow.elementOverflowX.length}, captureIssues=${selectedDirectContinuationSuite.captureIssues.length}`
      : null,
    mixedSuite?.suite && longSessionBottomSuite
      ? `- ${longSessionBottomSuite.label}: bottom=${longSessionBottomSuite.state?.agentTimelineBottomOk ? "ok" : "fail"}, feedBottom=${longSessionBottomSuite.state?.agentFeedScrolledToBottom ? "ok" : "fail"}, lastMessage=${longSessionBottomSuite.state?.lastAgentMessageBottomVisible ? "ok" : "fail"}, composerControls=${longSessionBottomSuite.state?.composerControlsVisibleOk ? "ok" : "fail"}, composerViewport=${longSessionBottomSuite.state?.composerViewportVisibleOk ? "ok" : "fail"}, viewport=${longSessionBottomSuite.state?.compactViewportFitOk ? "ok" : "fail"}, topbar=${longSessionBottomSuite.state?.topbarControlsDockedOk ? "ok" : "fail"}, density=${longSessionBottomSuite.state?.compactCanvasDensityOk ? "ok" : "fail"}, spacing=${longSessionBottomSuite.state?.selectedNodeSpacingOk ? "ok" : "fail"}, preview=${longSessionBottomSuite.state?.imagePreviewVisibleCountOk && longSessionBottomSuite.state?.imagePreviewLoadedOk ? "ok" : "fail"}, pixel=${longSessionBottomSuite.imagePreviewPixelReport?.ok ? "ok" : "fail"}, crop=${previewCropStatus(longSessionBottomSuite)}, ${previewGeometryStats(longSessionBottomSuite)}, ${previewDetailStats(longSessionBottomSuite)}, ${titleAccessStats(longSessionBottomSuite)}, zoom=${longSessionBottomSuite.state?.canvasZoomPercent ?? "unknown"}%, visibleNodes=${longSessionBottomSuite.state?.visibleFlowNodeCount ?? "unknown"}, visiblePreviews=${longSessionBottomSuite.state?.visibleImagePreviewCount ?? "unknown"}, selectedGap=${longSessionBottomSuite.state?.selectedNodeNearestGap ?? "unknown"}, composerGap=${longSessionBottomSuite.state?.agentComposerBottomGap ?? "unknown"}, overlapLast=${longSessionBottomSuite.state?.composerLastMessageOverlapArea ?? "unknown"}, stateIssues=${longSessionBottomSuite.stateIssues.length}, overflow=${longSessionBottomSuite.overflow.elementOverflowX.length}, captureIssues=${longSessionBottomSuite.captureIssues.length}`
      : null,
    "",
    "## Agent Context Persistence",
    "",
    contextPersistenceSuite?.suite
      ? `- ${contextPersistenceSuite.label}: ok=${contextPersistenceSuite.suite.ok}, stage=${contextPersistenceSuite.suite.stage}, scope=${contextPersistenceSuite.suite.scope ? `${contextPersistenceSuite.suite.scope.projectId}/${contextPersistenceSuite.suite.scope.conversationId}` : "none"}, publicMetadataHidden=${contextPersistenceSuite.suite.publicMetadataHidden ? "yes" : "no"}, memoryImage=${contextPersistenceMemoryImage}, steps=${contextPersistenceSuite.suite.steps?.map((item) => `${item.label}:${item.ok ? "ok" : "fail"}`).join(", ")}`
      : "- agent context persistence scene missing",
    "",
    "## Agent Autonomy",
    "",
    `- aggregate: ${agentAutonomySummary}`,
    agentAutonomyStats.samples.length
      ? `- samples: ${agentAutonomyStats.samples.join("; ")}`
      : "- samples: none",
    hardGateFixture
      ? `- hardGateFixture(synthetic): ${hardGateFixture.suite?.ok ? "ok" : "fail"}, syntheticCorrectionCount=${hardGateFixture.state?.argCorrectionEvents ?? "unknown"}, reporterWouldFail=${hardGateFixture.state?.hardGateWouldFail ? "yes" : "no"}, reporterWouldWarn=${hardGateFixture.state?.aggregateWouldWarn ? "yes" : "no"}`
      : "- hardGateFixture: not-run",
    "",
    "## Agent Tool Observations",
    "",
    ...(agentIssues.length
      ? agentIssues.map((item) => `- ${item.level || "info"} ${item.area || "agent"}: ${item.message || JSON.stringify(item)}`)
      : ["- none"]),
    "",
    "## Issues",
    "",
    ...(issueObservations.length
      ? issueObservations.map((item) => `- [${item.at}] ${item.label}: ${JSON.stringify(item.detail)}`)
      : ["- none"]),
    "",
    "## Next Cycle Plan",
    "",
    ...(failures.length || issueObservations.length
      ? [
          "- Re-run the same AIDebug mode after fixing the failed scene checks.",
          "- Prioritize Agent tool-call failures before visual polish if both appear.",
          "- If image generation passes but node layout fails, inspect `.flow-node.image` sizing, footer spacing, title visibility, and node overlap metrics."
        ]
      : agentIssues.some((item) => item.level === "warning")
        ? [
            "- Reduce Agent autonomy warnings, especially model-force fallback during explicit tool and image-generation requests.",
            "- Re-run mixed stress with --stress-rounds=2 after fallback warnings are reduced.",
            "- Keep one real image-suite run after any Agent prompt/runtime change."
          ]
      : [
          "- Increase --stress-rounds, --cycles, or --image-runs to expose long-session Agent tool drift.",
          "- Run mixed stress in 540px compact mode after long image chains to keep narrow UI regressions visible.",
          "- Keep one real image-suite run after any Agent prompt/runtime change."
        ]),
    "",
    "## Scene Results",
    "",
    ...results.map((item) => `- ${item.label}: stateIssues=${item.stateIssues.length}, overflow=${item.overflow.elementOverflowX.length}, captureIssues=${item.captureIssues.length}, visual=${item.visualReliability?.status || "unverified"}, policy=${item.visualPolicy || "overview"}, selectedPreview=${item.visualPolicy === "focus" ? item.state?.selectedImagePreviewDetailOk ? "ok" : "fail" : "n/a"}, frame=${item.screenshotFrameReport?.ok ? "ok" : "fail"}, surfaces=${item.screenshotSurfaceReport?.ok ? "ok" : "fail"}, stateLayers=${item.state?.stateLayerConsistencyOk ? "ok" : "fail"}`)
  ];
  const summaryPath = join(runDir, "summary.md");
  writeFileSync(summaryPath, `${lines.filter((line) => line != null).join("\n")}\n`);
  appendDesktopLog(summaryPath, failures, contactSheetPath);
  return summaryPath;
}

function appendDesktopLog(summaryPath, failures, contactSheetPath) {
  try {
    mkdirSync(dirname(desktopLogPath), { recursive: true });
    const firstWrite = !existsSync(desktopLogPath);
    const summary = readFileSync(summaryPath, "utf8");
    const header = firstWrite
      ? [
          "# IIimage AIDebug 持续测试记录",
          "",
          "本文件由 `scripts/aidebug-gui.mjs` 追加写入，用于睡眠/长任务期间保留每轮观察、问题和下一轮计划。",
          ""
        ].join("\n")
      : "";
    const block = [
      header,
      `\n---\n\n## Run ${new Date().toLocaleString("zh-CN")} · cycle ${cycleIndex}/${cycleTotal}`,
      "",
      `- ok: ${failures.length === 0}`,
      `- runDir: ${runDir}`,
      `- contactSheet: ${contactSheetPath}`,
      "",
      summary.replace(/^# IIimage AIDebug Run\s*/u, "").trim(),
      ""
    ].filter(Boolean).join("\n");
    writeFileSync(desktopLogPath, `${block}\n`, { flag: "a" });
  } catch (error) {
    recordObservation("issue", "desktop-log-write-failed", { path: desktopLogPath, error: error instanceof Error ? error.message : String(error) });
  }
}

function appendSupervisorDesktopLog(label, ok, detail = {}) {
  try {
    mkdirSync(dirname(desktopLogPath), { recursive: true });
    const firstWrite = !existsSync(desktopLogPath);
    const header = firstWrite
      ? [
          "# IIimage AIDebug 持续测试记录",
          "",
          "本文件由 `scripts/aidebug-gui.mjs` 追加写入，用于睡眠/长任务期间保留每轮观察、问题和下一轮计划。",
          ""
        ].join("\n")
      : "";
    const lines = [
      header,
      `\n---\n\n## Supervisor ${new Date().toLocaleString("zh-CN")} · ${label}`,
      "",
      `- ok: ${ok}`,
      ...Object.entries(detail).map(([key, value]) => `- ${key}: ${value}`),
      ""
    ].filter(Boolean);
    writeFileSync(desktopLogPath, `${lines.join("\n")}\n`, { flag: "a" });
  } catch (error) {
    recordObservation("issue", "desktop-log-write-failed", { path: desktopLogPath, error: error instanceof Error ? error.message : String(error), label });
  }
}

function contextMenuSuiteSetupExpression(menuKind) {
  return `new Promise((resolve) => {
    const delay = (ms) => new Promise((done) => setTimeout(done, ms));
    const scenario = ${JSON.stringify(menuKind)};
    const roundedRect = (rect) => rect ? ({
      left: Math.round(rect.left * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      right: Math.round(rect.right * 100) / 100,
      bottom: Math.round(rect.bottom * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100
    }) : null;
    const spread = (values) => {
      const finite = values.filter(Number.isFinite);
      return finite.length > 1 ? Math.max(...finite) - Math.min(...finite) : 0;
    };
    const textRect = (button) => {
      const explicit = button.querySelector('.ui-menu-item-label');
      if (explicit) return explicit.getBoundingClientRect();
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const parent = current.parentElement;
        if (String(current.textContent || '').trim() && !parent?.closest('svg, kbd, .ui-menu-item-shortcut')) {
          const range = document.createRange();
          range.selectNodeContents(current);
          const rect = range.getBoundingClientRect();
          range.detach?.();
          if (rect.width > 0 && rect.height > 0) return rect;
        }
        current = walker.nextNode();
      }
      return null;
    };
    const parseColor = (value) => {
      const text = String(value || '').trim().toLowerCase();
      if (!text || text === 'transparent') return [0, 0, 0, 0];
      const match = text.match(/rgba?\\(([^)]+)\\)/);
      if (!match) return [0, 0, 0, 1];
      const values = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [Number(values[0] || 0), Number(values[1] || 0), Number(values[2] || 0), Number(values[3] ?? 1)];
    };
    const colorDistance = (left, right) => {
      const a = parseColor(left);
      const b = parseColor(right);
      return Math.sqrt(
        Math.pow(a[0] - b[0], 2) +
        Math.pow(a[1] - b[1], 2) +
        Math.pow(a[2] - b[2], 2) +
        Math.pow((a[3] - b[3]) * 255, 2)
      );
    };
    const styleDifference = (left, right) => Math.max(
      colorDistance(left.color, right.color),
      colorDistance(left.backgroundColor, right.backgroundColor),
      colorDistance(left.borderColor, right.borderColor)
    );
    const dispatchContextMenu = (target, x, y) => target?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: Math.round(x),
      clientY: Math.round(y)
    }));
    let resolvedFixtureIds = null;
    const auditMenu = (menu) => {
      const menuRect = menu.getBoundingClientRect();
      const buttons = Array.from(menu.querySelectorAll('button'));
      let sectionIndex = 0;
      const sectionByButton = new Map();
      Array.from(menu.children).forEach((child) => {
        if (child.matches('[role="separator"], .context-menu-separator, [data-ui-menu-summary="true"], .selection-context-summary')) {
          sectionIndex += 1;
        } else if (child instanceof HTMLButtonElement) {
          sectionByButton.set(child, sectionIndex);
        }
      });
      const metrics = buttons.map((button, index) => {
        const rect = button.getBoundingClientRect();
        const icon = button.querySelector('.ui-menu-item-icon') || button.querySelector('svg');
        const label = textRect(button);
        const shortcut = button.querySelector('kbd, .ui-menu-item-shortcut');
        const style = getComputedStyle(button);
        return {
          index,
          section: sectionByButton.get(button) ?? -1,
          text: String(button.textContent || '').replace(/\\s+/g, ' ').trim(),
          disabled: button.disabled,
          focused: document.activeElement === button,
          rect: roundedRect(rect),
          iconRect: roundedRect(icon?.getBoundingClientRect?.()),
          labelRect: roundedRect(label),
          shortcutRect: roundedRect(shortcut?.getBoundingClientRect?.()),
          tone: String(button.dataset.uiTone || ''),
          className: String(button.className || ''),
          style: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderTopColor,
            borderStyle: style.borderTopStyle,
            borderWidth: style.borderTopWidth
          }
        };
      });
      const overlaps = [];
      for (let leftIndex = 0; leftIndex < metrics.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < metrics.length; rightIndex += 1) {
          const left = metrics[leftIndex].rect;
          const right = metrics[rightIndex].rect;
          const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
          const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
          if (width * height > 0.5) overlaps.push({ left: metrics[leftIndex].text, right: metrics[rightIndex].text, area: Math.round(width * height * 100) / 100 });
        }
      }
      const sectionGaps = [];
      const sectionIds = [...new Set(metrics.map((item) => item.section))];
      for (const section of sectionIds) {
        const items = metrics.filter((item) => item.section === section);
        if (items.length < 2) continue;
        for (let index = 1; index < items.length; index += 1) {
          sectionGaps.push(Math.round((items[index].rect.top - items[index - 1].rect.bottom) * 100) / 100);
        }
      }
      const iconLefts = metrics.map((item) => item.iconRect?.left).filter(Number.isFinite);
      const labelLefts = metrics.map((item) => item.labelRect?.left).filter(Number.isFinite);
      const shortcutRights = metrics.map((item) => item.shortcutRect?.right).filter(Number.isFinite);
      const dangerMetrics = metrics.filter((item) => /删除|解散/.test(item.text));
      const normalMetrics = metrics.filter((item) => !item.disabled && !item.focused && !/删除|解散/.test(item.text));
      const styleCounts = new Map();
      normalMetrics.forEach((item) => {
        const signature = [item.style.color, item.style.backgroundColor, item.style.borderColor, item.style.borderStyle, item.style.borderWidth].join('|');
        styleCounts.set(signature, (styleCounts.get(signature) || 0) + 1);
      });
      const dominantSignature = [...styleCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
      const dominantNormal = normalMetrics.find((item) => [item.style.color, item.style.backgroundColor, item.style.borderColor, item.style.borderStyle, item.style.borderWidth].join('|') === dominantSignature) || normalMetrics[0] || null;
      const dangerItems = dangerMetrics.map((item) => {
        const difference = dominantNormal ? Math.round(styleDifference(item.style, dominantNormal.style) * 100) / 100 : 0;
        return {
          text: item.text,
          tone: item.tone,
          className: item.className,
          style: item.style,
          normalStyle: dominantNormal?.style || null,
          visualDifference: difference,
          visuallyDistinct: difference >= 18
        };
      });
      const visibleTop = menuRect.top + menu.clientTop;
      const visibleBottom = visibleTop + menu.clientHeight;
      const clippedButtons = metrics.filter((item) => item.rect.top < visibleTop - 1 || item.rect.bottom > visibleBottom + 1).map((item) => item.text);
      const scrollRange = Math.max(0, menu.scrollHeight - menu.clientHeight);
      return {
        ariaLabel: menu.getAttribute('aria-label') || '',
        className: String(menu.className || ''),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        rect: roundedRect(menuRect),
        withinViewport: menuRect.left >= -0.5 && menuRect.top >= -0.5 && menuRect.right <= window.innerWidth + 0.5 && menuRect.bottom <= window.innerHeight + 0.5,
        clientHeight: menu.clientHeight,
        scrollHeight: menu.scrollHeight,
        scrollRange,
        scrollTop: menu.scrollTop,
        maxHeight: getComputedStyle(menu).maxHeight,
        clippedButtons,
        overflowed: clippedButtons.length > 0 || scrollRange > 3,
        buttonCount: metrics.length,
        enabledButtonCount: metrics.filter((item) => !item.disabled).length,
        buttons: metrics,
        overlaps,
        noButtonOverlap: overlaps.length === 0,
        sectionGaps,
        sectionGapSpread: Math.round(spread(sectionGaps) * 100) / 100,
        spacingStable: sectionGaps.length < 2 || spread(sectionGaps) <= 1.5,
        iconAlignment: { applicable: iconLefts.length > 1, sampleCount: iconLefts.length, spread: Math.round(spread(iconLefts) * 100) / 100, ok: iconLefts.length < 2 || spread(iconLefts) <= 1.5 },
        labelAlignment: { applicable: labelLefts.length > 1, sampleCount: labelLefts.length, spread: Math.round(spread(labelLefts) * 100) / 100, ok: labelLefts.length < 2 || spread(labelLefts) <= 1.5 },
        shortcutAlignment: { applicable: shortcutRights.length > 1, sampleCount: shortcutRights.length, spread: Math.round(spread(shortcutRights) * 100) / 100, ok: shortcutRights.length < 2 || spread(shortcutRights) <= 1.5 },
        danger: {
          expected: scenario !== 'canvas',
          notApplicable: scenario === 'canvas' && dangerItems.length === 0,
          items: dangerItems,
          ok: scenario === 'canvas' ? dangerItems.length === 0 : dangerItems.length > 0 && dangerItems.every((item) => item.visuallyDistinct)
        }
      };
    };
    (async () => {
      const api = window.__iiimageAIDebug;
      window.__iiimageContextMenuAudit = null;
      if (!api?.seedSelectionCanvas || !api?.selectNodes) {
        resolve({ ok: false, failures: ['selection debug bridge unavailable'] });
        return;
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const seedResult = await api.seedSelectionCanvas();
      const imageIds = Array.isArray(seedResult?.fixtureIds?.imageIds) ? seedResult.fixtureIds.imageIds.map(String).filter(Boolean) : [];
      const layerIds = Array.isArray(seedResult?.fixtureIds?.layerIds) ? seedResult.fixtureIds.layerIds.map(String).filter(Boolean) : [];
      const busyIds = Array.isArray(seedResult?.fixtureIds?.busyIds) ? seedResult.fixtureIds.busyIds.map(String).filter(Boolean) : [];
      const stateNodes = Array.isArray(seedResult?.state?.nodes) ? seedResult.state.nodes : [];
      const nodeId = imageIds[0] || '';
      const secondaryNodeId = imageIds.find((id) => id !== nodeId) || '';
      const layerId = layerIds[0] || '';
      const ordinaryNode = stateNodes.find((node) => node?.id === nodeId);
      const layerNode = stateNodes.find((node) => node?.id === layerId);
      if (!seedResult?.ok || !nodeId || !secondaryNodeId || !layerId) throw new Error('selection fixture identities unavailable');
      if (ordinaryNode?.type !== 'image' || ordinaryNode?.layerGroup) throw new Error('selection fixture ordinary image identity is invalid');
      if (layerNode?.type !== 'image' || !layerNode?.layerGroup) throw new Error('selection fixture layer identity is invalid');
      resolvedFixtureIds = {
        imageIds,
        layerIds,
        busyIds,
        nodeId,
        secondaryNodeId,
        layerId,
        selectionIds: [nodeId, secondaryNodeId, layerId]
      };
      await delay(180);
      const canvas = document.querySelector('.workflow-canvas');
      const canvasRect = canvas?.getBoundingClientRect();
      if (!canvas || !canvasRect) throw new Error('workflow canvas unavailable');
      const menuX = canvasRect.left + 28;
      const menuY = canvasRect.bottom - 16;
      if (scenario === 'canvas') {
        await api.selectNodes({ ids: [] });
        dispatchContextMenu(canvas, menuX, menuY);
      } else if (scenario === 'selection') {
        await api.selectNodes({ ids: resolvedFixtureIds.selectionIds, primaryId: nodeId });
        const node = Array.from(document.querySelectorAll('.flow-node')).find((item) => item.dataset.nodeId === nodeId);
        dispatchContextMenu(node, menuX, menuY);
      } else {
        const id = scenario === 'layer' ? layerId : nodeId;
        await api.selectNodes({ ids: [id], primaryId: id });
        const node = Array.from(document.querySelectorAll('.flow-node')).find((item) => item.dataset.nodeId === id);
        dispatchContextMenu(node, menuX, menuY);
      }
      const deadline = Date.now() + 2600;
      let menu = null;
      while (Date.now() < deadline) {
        menu = document.querySelector('.canvas-context-menu[data-ui-menu-surface="true"]');
        if (menu && menu.querySelectorAll('button').length > 0) break;
        await delay(40);
      }
      if (!menu) {
        const result = { ok: false, scenario, fixtureIds: resolvedFixtureIds, failures: ['context menu did not open'] };
        window.__iiimageContextMenuAudit = result;
        resolve(result);
        return;
      }
      await delay(220);
      const initial = auditMenu(menu);
      const initialScrollTop = menu.scrollTop;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      await delay(220);
      const enabledButtons = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      const lastEnabled = enabledButtons[enabledButtons.length - 1] || null;
      const lastRect = lastEnabled?.getBoundingClientRect?.() || null;
      const menuRect = menu.getBoundingClientRect();
      const visibleTop = menuRect.top + menu.clientTop;
      const visibleBottom = visibleTop + menu.clientHeight;
      const keyboard = {
        activeText: String(document.activeElement?.textContent || '').replace(/\\s+/g, ' ').trim(),
        lastEnabledText: String(lastEnabled?.textContent || '').replace(/\\s+/g, ' ').trim(),
        lastEnabledFocused: Boolean(lastEnabled && document.activeElement === lastEnabled),
        lastEnabledVisible: Boolean(lastRect && lastRect.top >= visibleTop - 1 && lastRect.bottom <= visibleBottom + 1),
        scrollTopBefore: initialScrollTop,
        scrollTopAfter: menu.scrollTop,
        overflowScrollAdvanced: !initial.overflowed || menu.scrollTop > initialScrollTop + 0.5
      };
      const failures = [];
      if (!initial.withinViewport) failures.push('menu rectangle escapes viewport');
      if (!initial.noButtonOverlap) failures.push('menu buttons overlap');
      if (!initial.spacingStable) failures.push('menu button spacing is inconsistent');
      if (!initial.iconAlignment.ok) failures.push('menu icon column is not aligned');
      if (!initial.labelAlignment.ok) failures.push('menu label column is not aligned');
      if (!initial.shortcutAlignment.ok) failures.push('menu shortcut column is not right-aligned');
      if (!keyboard.lastEnabledFocused) failures.push('End key did not focus the final enabled menu item');
      if (!keyboard.lastEnabledVisible) failures.push('final enabled menu item is outside the visible menu area after End');
      if (!keyboard.overflowScrollAdvanced) failures.push('overflowing menu did not scroll after End');
      if (!initial.danger.ok) failures.push(initial.danger.expected ? 'danger actions are not visually distinct from normal actions' : 'blank canvas menu unexpectedly contains a danger action');
      const result = { ok: failures.length === 0, scenario, fixtureIds: resolvedFixtureIds, failures, initial, keyboard };
      window.__iiimageContextMenuAudit = result;
      resolve(result);
    })().catch((error) => {
      const result = { ok: false, scenario, fixtureIds: resolvedFixtureIds, failures: [error instanceof Error ? error.message : String(error)] };
      window.__iiimageContextMenuAudit = result;
      resolve(result);
    });
  })`;
}

async function captureContextMenuSuiteProbe(client, targetId) {
  const scenarios = [
    { kind: "canvas", label: "context-menu-canvas-1280", width: 1280, height: 820 },
    { kind: "canvas", label: "context-menu-canvas-min-884", width: workbenchMinWidth, height: 720 },
    { kind: "node", label: "context-menu-image-1280", width: 1280, height: 820 },
    { kind: "node", label: "context-menu-image-min-884", width: workbenchMinWidth, height: 720 },
    { kind: "layer", label: "context-menu-layer-1280", width: 1280, height: 820 },
    { kind: "layer", label: "context-menu-layer-min-884", width: workbenchMinWidth, height: 720 },
    { kind: "selection", label: "context-menu-selection-1280", width: 1280, height: 820 },
    { kind: "selection", label: "context-menu-selection-min-884", width: workbenchMinWidth, height: 720 }
  ];
  const captures = [];
  for (const scenario of scenarios) {
    setProbePhase(`context-menu:${scenario.kind}:${scenario.width}`, { label: scenario.label, width: scenario.width, height: scenario.height });
    const capture = await captureState(
      client,
      targetId,
      scenario.label,
      contextMenuSuiteSetupExpression(scenario.kind),
      { width: scenario.width, height: scenario.height },
      {
        settingsOpen: false,
        historyOpen: false,
        modalOpen: false,
        accountOpen: false,
        titlebarOverlay: true
      }
    );
    const menuAudit = await evaluate(client, "window.__iiimageContextMenuAudit || null", 10000);
    capture.fixtureIds = menuAudit?.fixtureIds || null;
    capture.menuAudit = menuAudit;
    capture.suite = { ok: menuAudit?.ok === true, scenario, menuAudit };
    if (!menuAudit?.ok) {
      const failures = Array.isArray(menuAudit?.failures) && menuAudit.failures.length ? menuAudit.failures : ["menu audit did not return a passing result"];
      for (const failure of failures) capture.stateIssues.push(`context menu ${scenario.kind} ${scenario.width}x${scenario.height}: ${failure}`);
    }
    captures.push(capture);
  }
  return captures;
}

async function captureAuthGateSuiteProbe(client, targetId) {
  const captures = [];
  const authExpected = {
    authGateVisible: true,
    authGateOnlyOk: true,
    authGateLayoutOk: true,
    authGateSwitchHorizontalOk: true,
    authGateControlsStyledOk: true,
    authGateErrorStyledOk: true,
    authGateModeLoginOk: true,
    authLogoutFlowOk: true,
    authLogoutPendingClearedOk: true,
    settingsOpen: false,
    accountOpen: false,
    projectMenuOpen: false,
    fileMenuOpen: false,
    modalOpen: false
  };

  await setWindowSize(client, targetId, 1280, 820);
  await waitForExpression(client, "Boolean(document.querySelector('.ide-shell') && window.__iiimageDebugOpenSurface)", 15000);
  const logoutProof = await evaluate(client, `(async () => {
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const waitFor = async (predicate, timeout = 4000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (predicate()) return true;
        await wait(40);
      }
      return Boolean(predicate());
    };
    const buttonByText = (root, text) => Array.from((root || document).querySelectorAll('button'))
      .find((button) => String(button.textContent || '').replace(/\\s+/g, ' ').trim() === text);
    const openSurface = async (surface, selector) => {
      const opened = window.__iiimageDebugOpenSurface?.(surface) === true;
      const visible = await waitFor(() => Boolean(document.querySelector(selector)));
      return Boolean(opened && visible);
    };

    const settingsOpened = await openSurface('settings', '.settings-drawer');
    const promptButton = Array.from(document.querySelectorAll('.settings-drawer button'))
      .find((button) => String(button.textContent || '').includes('编辑提示词'));
    promptButton?.click();
    const promptDialogOpened = await waitFor(() => Boolean(document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 提示词"]')));
    document.querySelector('.agent-text-editor-dialog button[aria-label="关闭"]')?.click();
    await waitFor(() => !document.querySelector('.agent-text-editor-dialog'));

    const projectMenuOpened = await openSurface('project-menu', '.project-menu-popover');
    const fileMenuOpened = await openSurface('file-menu', '.file-command-popover');
    const timelineOpened = await openSurface('agent-timeline', '.project-agent-panel');
    const memoryButton = document.querySelector('button[aria-label="编辑 Agent 记忆"]');
    memoryButton?.click();
    const memoryDialogOpened = await waitFor(() => Boolean(document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 记忆"]')));

    const accountOpened = await openSurface('account', '.account-drawer');
    const memoryDialogCoexisted = Boolean(document.querySelector('.agent-text-editor-dialog[aria-label="编辑 Agent 记忆"]'));
    const pendingStarted = await window.__iiimageAIDebug?.chat?.('AIDEBUG_ASK_CONFIRM AUTH_LOGOUT_PENDING 请先确认后再继续。', { timeoutMs: 30000 });
    const pendingOpened = await waitFor(() => Boolean(window.__iiimageDebugAgentState?.().pendingAgentExecution && document.querySelector('.ask-user-dialog')), 6000);
    const logoutButton = document.querySelector('.account-logout-button');
    const logoutClicked = Boolean(logoutButton);
    logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    const authVisible = await waitFor(() => Boolean(document.querySelector('.auth-shell') && !document.querySelector('.ide-shell')), 8000);
    const residualSelectors = ['.settings-drawer', '.account-drawer', '.project-menu-popover', '.file-command-popover', '.dialog-layer', '.drawer-layer', '.canvas-context-menu'];
    const residual = residualSelectors.filter((selector) => document.querySelector(selector));
    const uniqueAuthGate = Boolean(authVisible && residual.length === 0);
    const pendingLogoutState = window.__iiimageDebugAgentState?.() || {};
    const logoutPendingCleared = Boolean(!pendingLogoutState.pendingAgentExecution && !pendingLogoutState.askUserOpen && !pendingLogoutState.referencePickerOpen);
    const proof = {
      settingsOpened,
      promptDialogOpened,
      projectMenuOpened,
      fileMenuOpened,
      timelineOpened,
      memoryDialogOpened,
      accountOpened,
      memoryDialogCoexisted,
      pendingStarted: Boolean(pendingStarted?.ok),
      pendingOpened,
      logoutClicked,
      authVisible,
      uniqueAuthGate,
      logoutPendingCleared,
      residual,
      logoutFlowOk: Boolean(
        settingsOpened && promptDialogOpened && projectMenuOpened && fileMenuOpened && timelineOpened &&
        memoryDialogOpened && accountOpened && memoryDialogCoexisted && pendingStarted?.ok && pendingOpened &&
        logoutClicked && uniqueAuthGate && logoutPendingCleared
      )
    };
    window.__iiimageAuthProbe = proof;
    return proof;
  })()`, 30000);

  captures.push(await captureState(client, targetId, "auth-login-after-real-logout-1280", null, { width: 1280, height: 820 }, authExpected, 30000, "auth"));
  captures.push(await captureState(client, targetId, "auth-login-after-real-logout-884", null, { width: workbenchMinWidth, height: 720 }, authExpected, 30000, "auth"));

  const authReloadSentinel = `auth-reload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const authReloadScript = await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__iiimageAuthReloadSentinel = ${JSON.stringify(authReloadSentinel)};`
  }, 5000);
  let authReloadProof = null;
  try {
    await client.send("Page.reload", { ignoreCache: true }, 15000);
    authReloadProof = await waitForReloadedAuthGate(client, authReloadSentinel, 20000);
  } finally {
    if (authReloadScript?.identifier) {
      try {
        await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: authReloadScript.identifier }, 5000);
      } catch {
        // The proof already distinguishes the reloaded document; cleanup failure must not mask it.
      }
    }
  }
  const refreshProof = await evaluate(client, `(() => {
    const residualSelectors = ['.settings-drawer', '.account-drawer', '.project-menu-popover', '.file-command-popover', '.dialog-layer', '.drawer-layer', '.canvas-context-menu'];
    const residual = residualSelectors.filter((selector) => document.querySelector(selector));
    const refreshIsolationOk = Boolean(document.querySelector('.auth-shell') && !document.querySelector('.ide-shell') && residual.length === 0);
    window.__iiimageAuthProbe = { ...${JSON.stringify(logoutProof)}, refreshIsolationOk, refreshResidual: residual, refreshReload: ${JSON.stringify(authReloadProof)} };
    return window.__iiimageAuthProbe;
  })()`);
  captures.push(await captureState(client, targetId, "auth-login-after-refresh-884", null, { width: workbenchMinWidth, height: 720 }, { ...authExpected, authRefreshIsolationOk: true }, 30000, "auth"));

  const registerProof = await evaluate(client, `(async () => {
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const registerButton = Array.from(document.querySelectorAll('.auth-switch button'))
      .find((button) => String(button.textContent || '').trim() === '注册');
    registerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await wait(180);
    const registerSwitchOk = Boolean(
      document.querySelector('.auth-gate-form .basic-auth-name') &&
      Array.from(document.querySelectorAll('.auth-switch button')).some((button) => button.classList.contains('active') && String(button.textContent || '').trim() === '注册')
    );
    window.__iiimageAuthProbe = { ...(window.__iiimageAuthProbe || {}), registerSwitchOk };
    return { registerSwitchOk };
  })()`);
  const registerExpected = {
    ...authExpected,
    authGateModeLoginOk: false,
    authGateModeRegisterOk: true,
    authRefreshIsolationOk: true,
    authRegisterSwitchOk: true
  };
  captures.push(await captureState(client, targetId, "auth-register-1280", null, { width: 1280, height: 820 }, registerExpected, 30000, "auth"));
  captures.push(await captureState(client, targetId, "auth-register-884", null, { width: workbenchMinWidth, height: 720 }, registerExpected, 30000, "auth"));

  const errorProof = await evaluate(client, `(async () => {
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const setInputValue = (input, value) => {
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const loginButton = Array.from(document.querySelectorAll('.auth-switch button'))
      .find((button) => String(button.textContent || '').trim() === '登录');
    loginButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await wait(100);
    const email = document.querySelector('.auth-gate-form .basic-auth-email');
    const password = document.querySelector('.auth-gate-form .basic-auth-password');
    const valuesSet = setInputValue(email, 'wrong-user') && setInputValue(password, 'wrong-pass');
    document.querySelector('.auth-gate-form')?.requestSubmit();
    const started = Date.now();
    while (Date.now() - started < 8000 && !/(?:错误|失败)/.test(String(document.querySelector('.auth-message')?.textContent || ''))) await wait(50);
    const message = String(document.querySelector('.auth-message')?.textContent || '').trim();
    const errorFlowOk = Boolean(
      valuesSet && document.querySelector('.auth-shell') && !document.querySelector('.ide-shell') &&
      /(?:错误|失败)/.test(message) && document.querySelector('.auth-message[data-ui-notice="true"][data-ui-tone="danger"]')
    );
    window.__iiimageAuthProbe = { ...(window.__iiimageAuthProbe || {}), errorFlowOk, errorMessage: message };
    return { errorFlowOk, message };
  })()`, 15000);
  const errorExpected = {
    ...authExpected,
    authRefreshIsolationOk: true,
    authRegisterSwitchOk: true,
    authErrorFlowOk: true,
    authGateErrorVisible: true
  };
  captures.push(await captureState(client, targetId, "auth-login-error-1280", null, { width: 1280, height: 820 }, errorExpected, 30000, "auth"));
  captures.push(await captureState(client, targetId, "auth-login-error-884", null, { width: workbenchMinWidth, height: 720 }, errorExpected, 30000, "auth"));

  const reloginProof = await evaluate(client, `(async () => {
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const setInputValue = (input, value) => {
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const email = document.querySelector('.auth-gate-form .basic-auth-email');
    const password = document.querySelector('.auth-gate-form .basic-auth-password');
    const valuesSet = setInputValue(email, 'aidebug') && setInputValue(password, 'aidebug-pass');
    document.querySelector('.auth-gate-form')?.requestSubmit();
    const started = Date.now();
    while (Date.now() - started < 10000 && !document.querySelector('.ide-shell')) await wait(50);
    await wait(350);
    const residualSelectors = ['.auth-shell', '.settings-drawer', '.account-drawer', '.project-menu-popover', '.file-command-popover', '.dialog-layer', '.drawer-layer', '.canvas-context-menu'];
    const residual = residualSelectors.filter((selector) => document.querySelector(selector));
    const state = window.__iiimageDebugAgentState?.() || {};
    const pendingIsolationOk = Boolean(!state.pendingAgentExecution && !state.askUserOpen && !state.referencePickerOpen);
    const ok = Boolean(valuesSet && document.querySelector('.ide-shell') && residual.length === 0 && pendingIsolationOk);
    window.__iiimageAuthReloginProbe = { ok, residual, valuesSet, pendingIsolationOk, workbenchVisible: Boolean(document.querySelector('.ide-shell')) };
    return window.__iiimageAuthReloginProbe;
  })()`, 20000);
  await waitForExpression(client, "Boolean(document.querySelector('.ide-shell') && window.__iiimageAuthReloginProbe?.ok)", 12000);
  const reloginCapture = await captureState(client, targetId, "auth-relogin-clean-workbench-1280", null, { width: 1280, height: 820 }, {
    authGateVisible: false,
    authReloginCleanOk: true,
    settingsOpen: false,
    accountOpen: false,
    projectMenuOpen: false,
    fileMenuOpen: false,
    modalOpen: false
  }, 30000, "auth");
  captures.push(reloginCapture);

  const suite = {
    ok: Boolean(
      logoutProof?.logoutFlowOk && refreshProof?.refreshIsolationOk && registerProof?.registerSwitchOk &&
      errorProof?.errorFlowOk && reloginProof?.ok &&
      captures.every((capture) => capture.stateIssues.length === 0 && capture.captureIssues.length === 0 && !capture.overflow.documentOverflowX && !capture.overflow.bodyOverflowX && capture.overflow.elementOverflowX.length === 0)
    ),
    logoutProof,
    refreshProof,
    registerProof,
    errorProof,
    reloginProof
  };
  reloginCapture.suite = suite;
  return captures;
}


async function captureImageImportSuiteProbe(client, targetId) {
  const fixturePaths = readdirSync(imageImportFixtureDir)
    .filter((entry) => entry.endsWith(".png"))
    .sort()
    .map((entry) => join(imageImportFixtureDir, entry));
  if (fixturePaths.length !== 500) throw new Error(`Expected 500 image-import fixtures, received ${fixturePaths.length}`);
  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(
    client,
    "Boolean(window.__iiimageAIDebug?.imageImportStatus && window.__iiimageAIDebug?.cancelImageImports && window.__iiimageAIDebug?.chat && window.__iiimageAIDebug?.selectNodes && window.__iiimageAIDebug?.mergeSelectedImages && window.__iiimageDebugImportPathsToCanvas && window.__iiimageDebugImportPathsAsSources && window.__iiimageDebugImportPathsAsReferences)",
    10000,
  );
  recordObservation("info", "image-import-suite-request", {
    fixtureCount: fixturePaths.length,
    contract: "real renderer IPC, independent child process, 4-file bounded concurrency, cancel/recovery, canvas/reference/layer isolation",
  });
  const suite = await evaluate(client, `(async () => {
    const config = window.iiimageConfig;
    const debug = window.__iiimageAIDebug;
    const paths = ${JSON.stringify(fixturePaths)};
    const waitForCondition = async (test, timeoutMs = 8000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const value = test();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return null;
    };
    const projects = await config.listProjects();
    const projectId = String(projects?.activeProjectId || projects?.projects?.[0]?.id || "");
    const reset = await debug.imageImportStatus({ reset: true });
    const unknownProject = await config.importLocalImages({
      paths: [paths[0]],
      projectId: "aidebug-project-does-not-exist",
      maxFiles: 1
    });

    let intervalTicks = 0;
    let animationFrames = 0;
    let maxIntervalGapMs = 0;
    let lastIntervalAt = performance.now();
    let running = true;
    const interval = setInterval(() => {
      const now = performance.now();
      maxIntervalGapMs = Math.max(maxIntervalGapMs, now - lastIntervalAt);
      lastIntervalAt = now;
      intervalTicks += 1;
    }, 8);
    const frame = () => {
      if (!running) return;
      animationFrames += 1;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const importStartedAt = performance.now();
    const imported = await config.importLocalImages({ paths: [${JSON.stringify(imageImportFixtureDir)}], projectId, maxFiles: 500 });
    const importDurationMs = performance.now() - importStartedAt;
    running = false;
    clearInterval(interval);
    const statusAfterImport = await debug.imageImportStatus();

    const cancelImportPromise = config.importLocalImages({ paths: [${JSON.stringify(imageImportFixtureDir)}], projectId, maxFiles: 500 });
    let activeSeen = false;
    for (let index = 0; index < 100; index += 1) {
      const activeStatus = await debug.imageImportStatus();
      if (Number(activeStatus?.status?.active || 0) > 0) {
        activeSeen = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const cancelResult = await debug.cancelImageImports();
    const canceledImport = await cancelImportPromise;
    const recovery = await config.importLocalImages({ paths: [paths[0]], projectId, maxFiles: 1 });
    const statusAfterCancel = await debug.imageImportStatus();

    const canvas = document.querySelector(".workflow-canvas");
    const canvasRect = canvas?.getBoundingClientRect?.();
    const blankNodeCount = Number(window.__iiimageDebugAgentState?.()?.nodes?.length || 0);
    const dragTransfer = new DataTransfer();
    dragTransfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "blank-canvas-drop-probe.png", { type: "image/png" }));
    const blankDragOverAccepted = canvas?.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dragTransfer,
      clientX: (canvasRect?.left || 0) + 220,
      clientY: (canvasRect?.top || 0) + 220
    })) === false;
    const blankDropOverlay = await waitForCondition(() => document.querySelector(".canvas-external-file-drop"));
    canvas?.dispatchEvent(new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dragTransfer,
      relatedTarget: document.body
    }));
    await waitForCondition(() => !document.querySelector(".canvas-external-file-drop"));
    const blankDropOverlayCleared = !document.querySelector(".canvas-external-file-drop");
    const canvasImport = await window.__iiimageDebugImportPathsToCanvas({
      paths: [paths[0], paths[1]],
      clientX: (canvasRect?.left || 0) + 280,
      clientY: (canvasRect?.top || 0) + 240
    });
    const canvasNode = await waitForCondition(() => window.__iiimageDebugAgentState?.()?.nodes?.find((node) => node.id === canvasImport?.containerId && node.assetCount === 2));
    const folderImport = await window.__iiimageDebugImportPathsToCanvas({
      paths: ${JSON.stringify(occurrenceFixtureDirs)},
      clientX: (canvasRect?.left || 0) + 520,
      clientY: (canvasRect?.top || 0) + 260
    });
    const folderGroup = await waitForCondition(() => {
      const state = window.__iiimageDebugAgentState?.();
      const host = state?.nodes?.find((node) => node.id === folderImport?.containerId);
      return host?.imageContainerSpec?.kind === "container-group" ? host : null;
    });
    const folderState = window.__iiimageDebugAgentState?.();
    const folderChildIds = folderGroup?.imageContainerSpec?.childContainerNodeIds || [];
    const folderChildren = folderChildIds.map((id) => folderState?.nodes?.find((node) => node.id === id)).filter(Boolean);
    if (folderGroup?.id) await window.__iiimageAIDebug.selectNodes({ ids: [folderGroup.id], primaryId: folderGroup.id });
    const folderScopePrompt = "请确认当前文件夹组包含的两张原图，无需调用工具。";
    const folderScopeChat = folderGroup?.id
      ? await window.__iiimageAIDebug.chat(folderScopePrompt, { skipAsk: true, timeoutMs: 30000 })
      : { ok: false, error: "folder-group-missing" };
    const folderScopeState = window.__iiimageDebugAgentState?.();
    const folderScopeMessage = [...(folderScopeState?.messages || [])].reverse().find((message) => message.role === "user" && message.content === folderScopePrompt);
    const folderScopeAssets = Array.isArray(folderScopeMessage?.attachments?.sourceAssets) ? folderScopeMessage.attachments.sourceAssets : [];
    const targetFolderImport = await window.__iiimageDebugImportPathsToCanvas({
      paths: [${JSON.stringify(occurrenceFixtureDirs[0])}],
      targetContainerId: canvasImport?.containerId,
      clientX: (canvasRect?.left || 0) + 420,
      clientY: (canvasRect?.top || 0) + 440
    });
    const targetFolderGroup = await waitForCondition(() => {
      const state = window.__iiimageDebugAgentState?.();
      const host = state?.nodes?.find((node) => node.id === targetFolderImport?.containerId);
      return host?.imageContainerSpec?.kind === "container-group" ? host : null;
    });
    const targetFolderState = window.__iiimageDebugAgentState?.();
    const targetFolderChildIds = targetFolderGroup?.imageContainerSpec?.childContainerNodeIds || [];
    const targetImportedChildren = targetFolderChildIds
      .filter((id) => id !== canvasImport?.containerId)
      .map((id) => targetFolderState?.nodes?.find((node) => node.id === id))
      .filter(Boolean);
    const canvasState = window.__iiimageDebugAgentState?.();
    const sourcesBefore = Number(canvasState?.sourceImageCount || 0);
    const referencesBefore = Number(canvasState?.referenceImageCount || 0);
    const sourceImport = await window.__iiimageDebugImportPathsAsSources({ paths: ${JSON.stringify(occurrenceFixtureDirs)} });
    await waitForCondition(() => Number(window.__iiimageDebugAgentState?.()?.sourceImageCount || 0) === sourcesBefore + 2);
    const referenceImport = await window.__iiimageDebugImportPathsAsReferences({ paths: [paths[8], paths[9]] });
    await waitForCondition(() => Number(window.__iiimageDebugAgentState?.()?.referenceImageCount || 0) === referencesBefore + 2);
    const stagedAttachmentState = window.__iiimageDebugAgentState?.();
    await window.__iiimageAIDebug.selectNodes({ ids: [] });
    const attachmentPrompt = "请确认本轮附件角色，无需调用工具，也不要生成图片。";
    const attachmentChat = await window.__iiimageAIDebug.chat(attachmentPrompt, { skipAsk: true, timeoutMs: 30000 });
    const attachmentState = window.__iiimageDebugAgentState?.();
    const sourceContainer = attachmentState?.nodes?.find((node) => node.imageContainerRole === "source");
    const referenceContainer = attachmentState?.nodes?.find((node) => node.imageContainerRole === "reference");
    const attachmentUserMessage = [...(attachmentState?.messages || [])].reverse().find((message) => message.role === "user" && message.content === attachmentPrompt);
    const attachmentSourceAssets = Array.isArray(attachmentUserMessage?.attachments?.sourceAssets) ? attachmentUserMessage.attachments.sourceAssets : [];
    const attachmentReferenceAssets = Array.isArray(attachmentUserMessage?.attachments?.referenceAssets) ? attachmentUserMessage.attachments.referenceAssets : [];
    await waitForCondition(() => {
      const latestUserMessage = Array.from(document.querySelectorAll(".agent-message.user")).at(-1);
      return latestUserMessage?.querySelectorAll(".agent-message-attachment-group > summary").length === 2;
    }, 3000);
    const attachmentMessageElement = Array.from(document.querySelectorAll(".agent-message.user")).at(-1);
    const attachmentSummaryNodes = Array.from(attachmentMessageElement?.querySelectorAll(".agent-message-attachment-group > summary") || []);
    const attachmentSummaries = attachmentSummaryNodes
      .map((element) => String(element.textContent || "").replace(/\\s+/g, " ").trim());
    attachmentSummaryNodes.forEach((element) => element.click());
    const attachmentPreviewsVisible = Boolean(await waitForCondition(() => {
      const groups = Array.from(attachmentMessageElement?.querySelectorAll(".agent-message-attachment-group") || []);
      const imageCount = attachmentMessageElement?.querySelectorAll(".agent-message-attachment-grid img").length || 0;
      return groups.length === 2 && groups.every((group) => group.open) && imageCount === 4;
    }, 3000));

    await debug.selectNodes({ ids: [sourceContainer?.id, referenceContainer?.id].filter(Boolean), primaryId: sourceContainer?.id });
    const mixedRoleMerge = await debug.mergeSelectedImages();
    const mixedRoleGroup = mixedRoleMerge?.state?.layoutGroups?.find((group) =>
      group.memberNodeIds?.includes(sourceContainer?.id) && group.memberNodeIds?.includes(referenceContainer?.id)
    );
    const mixedRoleHostId = String(mixedRoleGroup?.hostNodeId || "");
    if (mixedRoleHostId) await debug.selectNodes({ ids: [mixedRoleHostId], primaryId: mixedRoleHostId });
    const mixedRolePrompt = "请只确认混合图片容器中的原图与参考图角色，无需调用工具。";
    const mixedRoleChat = mixedRoleHostId
      ? await debug.chat(mixedRolePrompt, { skipAsk: true, timeoutMs: 30000 })
      : { ok: false, error: "mixed-role-host-missing" };
    const mixedRoleState = window.__iiimageDebugAgentState?.();
    const mixedRoleMessage = [...(mixedRoleState?.messages || [])].reverse().find((message) => message.role === "user" && message.content === mixedRolePrompt);
    const mixedRoleSources = Array.isArray(mixedRoleMessage?.attachments?.sourceAssets) ? mixedRoleMessage.attachments.sourceAssets : [];
    const mixedRoleReferences = Array.isArray(mixedRoleMessage?.attachments?.referenceAssets) ? mixedRoleMessage.attachments.referenceAssets : [];

    const layers = await debug.runLayerStackSuite({ agentDriven: false });
    const layerIds = Array.isArray(layers?.layerNodeIds) ? layers.layerNodeIds : [];
    const beforeLayerImport = window.__iiimageDebugAgentState?.();
    const layerSnapshot = beforeLayerImport?.nodes
      ?.filter((node) => layerIds.includes(node.id))
      .map((node) => ({ id: node.id, layerGroup: node.layerGroup, assets: node.assets })) || [];
    const layerTargetImport = await window.__iiimageDebugImportPathsToCanvas({
      paths: [paths[4], paths[5]],
      targetContainerId: layers?.subjectId,
      clientX: (canvasRect?.left || 0) + 420,
      clientY: (canvasRect?.top || 0) + 330
    });
    const layerGuardNode = await waitForCondition(() => window.__iiimageDebugAgentState?.()?.nodes?.find((node) => node.id === layerTargetImport?.containerId && node.assetCount === 2));
    const afterLayerImport = window.__iiimageDebugAgentState?.();
    const afterLayerSnapshot = afterLayerImport?.nodes
      ?.filter((node) => layerIds.includes(node.id))
      .map((node) => ({ id: node.id, layerGroup: node.layerGroup, assets: node.assets })) || [];
    await debug.fitCanvas?.();

    const bridgeOk = Boolean(
      imported?.ok && imported.assets?.length === 500 && imported.selectedCount === 500 && imported.maxActiveFiles === 4 &&
      Number(imported.workerPid || 0) > 0 && Number(imported.workerPid) !== Number(statusAfterImport?.status?.mainProcessPid || 0) &&
      imported.assets.every((asset) => /^[a-f0-9]{64}$/i.test(String(asset.contentHash || "")) && String(asset.relativePath || "").toLowerCase().startsWith("output/imagegen/imports/"))
    );
    const responsiveOk = intervalTicks >= 10 && animationFrames >= 10 && maxIntervalGapMs < 400;
    const unknownProjectRejected = unknownProject?.ok === false && unknownProject?.assets?.length === 0;
    const cancelOk = Boolean(activeSeen && cancelResult?.ok && canceledImport?.ok === false && canceledImport?.canceled === true && recovery?.ok && recovery.assets?.length === 1);
    const blankCanvasDropOk = Boolean(blankNodeCount === 0 && blankDragOverAccepted && blankDropOverlay && blankDropOverlayCleared);
    const canvasOk = Boolean(canvasImport?.ok && canvasNode?.imageContainer && canvasNode?.assetCount === 2 && canvasNode?.assets?.every((asset) =>
      /output[\\\\/]imagegen[\\\\/]imports/i.test(String(asset.path || "")) &&
      String(asset.relativePath || "").toLowerCase().startsWith("output/imagegen/imports/") &&
      /^[a-f0-9]{64}$/i.test(String(asset.contentHash || ""))
    ));
    const folderAssets = folderChildren.flatMap((node) => node.assets || []);
    const folderOccurrenceOk = Boolean(
      folderImport?.ok && folderImport.assets?.length === 2 && folderGroup && folderChildren.length === 2 &&
      folderChildren.every((node) => node.imageContainerSpec?.kind === "folder" && node.assetCount === 1) &&
      folderAssets.length === 2 &&
      new Set(folderAssets.map((asset) => asset.path)).size === 1 &&
      new Set(folderAssets.map((asset) => asset.assetId)).size === 1 &&
      new Set(folderAssets.map((asset) => asset.occurrenceId)).size === 2 &&
      new Set(folderAssets.map((asset) => asset.importRootId)).size === 2 &&
      folderChildren.every((node) => node.imageContainerSpec?.memberBindings?.length === 1 && node.imageContainerSpec.memberBindings[0]?.occurrenceId === node.assets?.[0]?.occurrenceId)
    );
    const folderTaskScopeOk = Boolean(
      folderScopeChat?.ok && folderScopeAssets.length === 2 &&
      folderScopeAssets.every((asset) => asset.role === "source" && asset.nodeId === folderGroup.id && asset.bindingId && asset.occurrenceId) &&
      new Set(folderScopeAssets.map((asset) => asset.assetId)).size === 1 &&
      new Set(folderScopeAssets.map((asset) => asset.bindingId)).size === 2 &&
      new Set(folderScopeAssets.map((asset) => asset.occurrenceId)).size === 2
    );
    const targetFolderCombineOk = Boolean(
      targetFolderImport?.ok && targetFolderGroup && targetFolderChildIds.includes(canvasImport?.containerId) &&
      targetImportedChildren.length === 1 && targetImportedChildren[0]?.imageContainerSpec?.kind === "folder" &&
      targetImportedChildren[0]?.assetCount === 1 &&
      targetFolderState?.nodes?.find((node) => node.id === canvasImport?.containerId)?.assetCount === 2
    );
    const attachmentIdentityMatches = (container, attachments) => Boolean(
      container?.assets?.length === attachments.length && attachments.every((attachment) => {
        const member = container.assets.find((asset) => attachment.occurrenceId
          ? asset.occurrenceId === attachment.occurrenceId
          : asset.assetId === attachment.assetId);
        return member && member.contentHash === attachment.contentHash && member.relativePath === attachment.relativePath;
      })
    );
    const sourceOccurrenceIdentityOk = Boolean(
      sourceContainer?.assets?.length === 2 &&
      new Set(sourceContainer.assets.map((asset) => asset.path)).size === 1 &&
      new Set(sourceContainer.assets.map((asset) => asset.assetId)).size === 1 &&
      new Set(sourceContainer.assets.map((asset) => asset.occurrenceId)).size === 2 &&
      new Set(attachmentSourceAssets.map((asset) => asset.occurrenceId)).size === 2 &&
      new Set(attachmentSourceAssets.map((asset) => asset.bindingId)).size === 2
    );
    const attachmentsOk = Boolean(
      sourceImport?.ok && referenceImport?.ok &&
      Number(stagedAttachmentState?.sourceImageCount || 0) === sourcesBefore + 2 &&
      Number(stagedAttachmentState?.referenceImageCount || 0) === referencesBefore + 2 &&
      Number(attachmentState?.sourceImageCount || 0) === 0 &&
      Number(attachmentState?.referenceImageCount || 0) === 0 &&
      sourceContainer?.assetCount === 2 && referenceContainer?.assetCount === 2 &&
      attachmentSourceAssets.length === 2 && attachmentReferenceAssets.length === 2 &&
      attachmentSourceAssets.every((asset) => asset.role === "source" && asset.nodeId === sourceContainer.id && Number.isInteger(asset.assetIndex) && asset.displayCode && asset.occurrenceId && /^[a-f0-9]{64}$/i.test(String(asset.contentHash || "")) && asset.relativePath) &&
      attachmentReferenceAssets.every((asset) => asset.role === "reference" && asset.nodeId === referenceContainer.id && Number.isInteger(asset.assetIndex) && asset.displayCode && asset.referenceRole !== "source" && /^[a-f0-9]{64}$/i.test(String(asset.contentHash || "")) && asset.relativePath) &&
      attachmentIdentityMatches(sourceContainer, attachmentSourceAssets) &&
      attachmentIdentityMatches(referenceContainer, attachmentReferenceAssets) &&
      sourceOccurrenceIdentityOk &&
      attachmentSummaries.includes("2 张原图") && attachmentSummaries.includes("2 张参考图") &&
      attachmentPreviewsVisible &&
      attachmentChat?.ok && attachmentState?.agentStatus === "idle"
    );
    const mixedRolesOk = Boolean(
      mixedRoleMerge?.ok && mixedRoleHostId && mixedRoleChat?.ok &&
      mixedRoleSources.length === 2 && mixedRoleReferences.length === 2 &&
      mixedRoleSources.every((asset) => asset.role === "source" && asset.nodeId === mixedRoleHostId) &&
      mixedRoleReferences.every((asset) => asset.role === "reference" && asset.nodeId === mixedRoleHostId) &&
      mixedRoleSources.every((source) => !mixedRoleReferences.some((reference) => reference.assetId === source.assetId))
    );
    const layerIsolationOk = Boolean(
      layers?.ok && layerIds.length === 6 && layerTargetImport?.ok && layerTargetImport.containerId !== layers.subjectId &&
      layerGuardNode?.imageContainer && !layerGuardNode?.layerGroup && layerGuardNode?.assetCount === 2 &&
      JSON.stringify(layerSnapshot) === JSON.stringify(afterLayerSnapshot)
    );
    const folderCleanupIds = [folderGroup?.id, ...folderChildIds, targetFolderGroup?.id, ...targetImportedChildren.map((node) => node.id)].filter(Boolean);
    const folderCleanupResults = [];
    for (let pass = 0; pass < 3; pass += 1) {
      const liveIds = new Set((window.__iiimageDebugAgentState?.()?.nodes || []).map((node) => node.id));
      const remaining = folderCleanupIds.filter((id) => liveIds.has(id));
      if (!remaining.length) break;
      await debug.selectNodes({ ids: remaining, primaryId: remaining[0] });
      folderCleanupResults.push(await debug.deleteSelectedNodes());
    }
    const folderCleanupOk = Boolean(await waitForCondition(() => {
      const ids = new Set((window.__iiimageDebugAgentState?.()?.nodes || []).map((node) => node.id));
      return folderCleanupIds.every((id) => !ids.has(id));
    }, 3000));
    return {
      ok: Boolean(bridgeOk && responsiveOk && unknownProjectRejected && cancelOk && blankCanvasDropOk && canvasOk && folderOccurrenceOk && folderTaskScopeOk && targetFolderCombineOk && folderCleanupOk && attachmentsOk && mixedRolesOk && layerIsolationOk),
      projectId,
      fixtureCount: paths.length,
      reset,
      bridge: {
        ok: bridgeOk,
        selectedCount: imported?.selectedCount,
        importedCount: imported?.assets?.length,
        skippedCount: imported?.skippedCount,
        maxActiveFiles: imported?.maxActiveFiles,
        workerPid: imported?.workerPid,
        durationMs: imported?.durationMs,
        rendererMeasuredDurationMs: Math.round(importDurationMs)
      },
      responsiveness: { ok: responsiveOk, intervalTicks, animationFrames, maxIntervalGapMs: Math.round(maxIntervalGapMs * 10) / 10 },
      unknownProject: { ok: unknownProjectRejected, result: unknownProject },
      cancellation: { ok: cancelOk, activeSeen, cancelResult, canceledImport, recovery, statusAfterCancel },
      blankCanvasDrop: {
        ok: blankCanvasDropOk,
        blankNodeCount,
        dragOverAccepted: blankDragOverAccepted,
        overlayVisible: Boolean(blankDropOverlay),
        overlayCleared: blankDropOverlayCleared
      },
      canvas: { ok: canvasOk, result: canvasImport, node: canvasNode },
      folderOccurrences: { ok: folderOccurrenceOk && folderTaskScopeOk && targetFolderCombineOk && folderCleanupOk, identityOk: folderOccurrenceOk, taskScopeOk: folderTaskScopeOk, targetCombineOk: targetFolderCombineOk, cleanupOk: folderCleanupOk, cleanupResults: folderCleanupResults, result: folderImport, host: folderGroup, children: folderChildren, chat: folderScopeChat, userMessage: folderScopeMessage, sourceAssets: folderScopeAssets, targetImport: targetFolderImport, targetHost: targetFolderGroup, targetChildren: targetImportedChildren },
      attachments: {
        ok: attachmentsOk,
        staged: { sourcesBefore, referencesBefore, state: stagedAttachmentState, sourceImport, referenceImport },
        chat: attachmentChat,
        sourceContainer,
        referenceContainer,
        sourceOccurrenceIdentityOk,
        userMessage: attachmentUserMessage,
        summaries: attachmentSummaries,
        previewsVisible: attachmentPreviewsVisible
      },
      mixedRoles: {
        ok: mixedRolesOk,
        merge: mixedRoleMerge,
        group: mixedRoleGroup,
        hostId: mixedRoleHostId,
        chat: mixedRoleChat,
        userMessage: mixedRoleMessage,
        sourceAssets: mixedRoleSources,
        referenceAssets: mixedRoleReferences
      },
      layerIsolation: {
        ok: layerIsolationOk,
        layerSuiteOk: layers?.ok,
        layerIds,
        subjectId: layers?.subjectId,
        result: layerTargetImport,
        container: layerGuardNode,
        originalLayersUnchanged: JSON.stringify(layerSnapshot) === JSON.stringify(afterLayerSnapshot)
      },
      statusAfterImport,
      finalState: afterLayerImport
    };
  })()`, 300000);
  const suitePath = join(runDir, "image-import-suite.json");
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  recordObservation(suite?.ok ? "info" : "issue", suite?.ok ? "image-import-suite-success" : "image-import-suite-failed", {
    suitePath,
    bridge: suite?.bridge,
    responsiveness: suite?.responsiveness,
    cancellation: suite?.cancellation,
    blankCanvasDrop: suite?.blankCanvasDrop,
    canvas: suite?.canvas,
    folderOccurrences: suite?.folderOccurrences,
    attachments: suite?.attachments,
    mixedRoles: suite?.mixedRoles,
    layerIsolation: suite?.layerIsolation,
  });
  const capture = await captureState(
    client,
    targetId,
    "image-import-suite-1280",
    null,
    null,
    {
      settingsOpen: false,
      historyOpen: false,
      modalOpen: false,
      accountOpen: false,
      titlebarOverlay: true,
      agentDebugReady: true,
      agentDebugApiReady: true,
      agentIdle: true,
      agentNodeCount: 7,
      imageNodeCount: 7,
      imageNodeViewportOk: true,
      nodeOverlapOk: true,
      imagePreviewVisibleCountOk: true,
      imagePreviewLoadedOk: true,
    },
  );
  return { ...capture, suite, suitePath };
}

async function captureCanvasClaritySuiteProbe(client, targetId) {
  const fixturePath = join(runDir, "canvas-clarity-4096.png");
  const fixtureSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="4096" height="3072" viewBox="0 0 4096 3072">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#071b24"/><stop offset="0.5" stop-color="#174a5a"/><stop offset="1" stop-color="#071017"/>
        </linearGradient>
        <pattern id="grid" width="128" height="128" patternUnits="userSpaceOnUse">
          <path d="M128 0H0V128" fill="none" stroke="#65e6d3" stroke-opacity=".36" stroke-width="10"/>
        </pattern>
      </defs>
      <rect width="4096" height="3072" fill="url(#bg)"/>
      <rect width="4096" height="3072" fill="url(#grid)"/>
      <circle cx="1120" cy="1460" r="720" fill="#efb24f" stroke="#fff7dc" stroke-width="42"/>
      <path d="M420 2580L1960 540 3600 2580Z" fill="none" stroke="#f8ffff" stroke-width="52"/>
      <path d="M260 420H3836M260 2652H3836" stroke="#ff7096" stroke-width="34"/>
      <text x="2048" y="1380" text-anchor="middle" fill="#071017" font-family="Segoe UI, sans-serif" font-size="300" font-weight="800">IIIMAGE</text>
      <text x="2048" y="1740" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="220" font-weight="700">CLARITY 4096</text>
    </svg>`;
  await sharp(Buffer.from(fixtureSvg)).png({ compressionLevel: 9 }).toFile(fixturePath);

  await setWindowSize(client, targetId, 1280, 820);
  await evaluate(client, `window.__iiimageDebugOpenSurface?.("main")`);
  await waitForExpression(
    client,
    "Boolean(window.__iiimageAIDebug?.runTool && window.__iiimageDebugImportPathsToCanvas && window.__iiimageDebugSetViewport)",
    10000
  );
  recordObservation("info", "canvas-clarity-suite-request", {
    scales: [0.5, 1, 1.5, 2.4],
    fixture: { width: 4096, height: 3072 },
    contract: "DOM text + SVG provenance edges + device-pixel-aware image source + 2D settled transform"
  });

  const setup = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const debug = window.__iiimageAIDebug;
    await debug.runTool({ name: "workflow", input: { operation: "clear_canvas", brief: "清理画布缩放清晰度专项。" } });
    await delay(180);
    const canvas = document.querySelector('.workflow-canvas');
    const rect = canvas?.getBoundingClientRect();
    const first = await window.__iiimageDebugImportPathsToCanvas({
      paths: [${JSON.stringify(fixturePath)}],
      clientX: (rect?.left || 0) + 300,
      clientY: (rect?.top || 0) + 280
    });
    const second = await window.__iiimageDebugImportPathsToCanvas({
      paths: [${JSON.stringify(fixturePath)}],
      clientX: (rect?.left || 0) + 720,
      clientY: (rect?.top || 0) + 330
    });
    const firstId = String(first?.containerId || '');
    const secondId = String(second?.containerId || '');
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      const state = window.__iiimageDebugAgentState?.();
      const ids = new Set((state?.nodes || []).map((node) => node.id));
      if (firstId && secondId && ids.has(firstId) && ids.has(secondId)) break;
      await delay(80);
    }
    const state = window.__iiimageDebugAgentState?.();
    const firstNode = state?.nodes?.find((node) => node.id === firstId);
    const baseX = Number(firstNode?.x || 520);
    const baseY = Number(firstNode?.y || 420);
    window.__iiimageDebugMoveNode?.({ id: firstId, x: baseX, y: baseY });
    window.__iiimageDebugMoveNode?.({ id: secondId, x: baseX + 460, y: baseY + 40 });
    const connected = window.__iiimageDebugConnectNodes?.({ sourceId: firstId, targetId: secondId });
    await debug.selectNode({ id: firstId });
    window.__iiimageDebugSetViewport({ scale: 1, nodeId: firstId });
    await delay(420);
    document.querySelector('.canvas-selection-indicator button[aria-label="取消当前选中"]')?.click();
    await delay(140);
    return {
      ok: Boolean(first?.ok && second?.ok && firstId && secondId && connected !== false),
      first,
      second,
      firstId,
      secondId,
      connected: connected !== false,
      state: window.__iiimageDebugAgentState?.()
    };
  })()`, 60000);

  const suitePath = join(runDir, "canvas-clarity-suite.json");
  if (!setup?.ok) {
    const capture = await captureState(client, targetId, "canvas-clarity-setup-failed", null, null, {
      settingsOpen: false,
      historyOpen: false,
      accountOpen: false,
      canvasVisible: true,
      agentDebugReady: true
    });
    const suite = { ok: false, setup, samples: [], interaction: null, suitePath };
    writeFileSync(suitePath, JSON.stringify(suite, null, 2));
    capture.suite = suite;
    return [capture];
  }

  const interaction = await evaluate(client, `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const canvas = document.querySelector('.workflow-canvas');
    const stage = document.querySelector('.canvas-stage');
    const rect = canvas?.getBoundingClientRect();
    canvas?.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
      clientX: (rect?.left || 0) + (rect?.width || 0) / 2,
      clientY: (rect?.top || 0) + (rect?.height || 0) / 2
    }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const active = {
      classApplied: canvas?.classList.contains('is-viewport-interacting') === true,
      acceleratedTransform: String(stage?.style.transform || '').includes('translate3d('),
      willChange: stage ? getComputedStyle(stage).willChange : ''
    };
    // Product intentionally coalesces wheel updates for 240ms before the
    // 96ms quality-settle pass. Sample after both phases instead of treating
    // the active compositor layer as a leak while the debounce is still live.
    await delay(420);
    const settled = {
      classCleared: canvas?.classList.contains('is-viewport-interacting') !== true,
      twoDimensionalTransform: String(stage?.style.transform || '').includes('translate(') && !String(stage?.style.transform || '').includes('translate3d('),
      willChange: stage ? getComputedStyle(stage).willChange : ''
    };
    window.__iiimageDebugSetViewport({ scale: 1, nodeId: ${JSON.stringify(setup.firstId)} });
    await delay(180);
    return {
      ok: Boolean(active.classApplied && active.acceleratedTransform && active.willChange.includes('transform') && settled.classCleared && settled.twoDimensionalTransform && settled.willChange === 'auto'),
      active,
      settled
    };
  })()`);

  const captures = [];
  const samples = [];
  for (const scale of [0.5, 1, 1.5, 2.4]) {
    await evaluate(client, `window.__iiimageDebugSetViewport?.({ scale: ${scale}, nodeId: ${JSON.stringify(setup.firstId)} })`);
    await waitForExpression(client, `Math.abs(Number(window.__iiimageDebugAgentState?.().viewport?.scale || 0) - ${scale}) < 0.001`, 5000);
    await waitForCanvasImagePreviews(client, 1, 30000);
    await delay(260);
    const proof = await evaluate(client, `(() => {
      const node = document.querySelector('.flow-node[data-node-id=${JSON.stringify(setup.firstId)}]');
      const image = node?.querySelector('.node-image-tile img');
      const title = node?.querySelector('.node-head strong');
      const canvas = document.querySelector('.workflow-canvas');
      const stage = document.querySelector('.canvas-stage');
      const edgeLayer = document.querySelector('.edge-layer');
      const edge = document.querySelector('.edge.provenance[data-source-id=${JSON.stringify(setup.firstId)}][data-target-id=${JSON.stringify(setup.secondId)}]');
      const imageRect = image?.getBoundingClientRect();
      const titleRect = title?.getBoundingClientRect();
      const dpr = Number(window.devicePixelRatio || 1);
      const naturalLongest = Math.max(Number(image?.naturalWidth || 0), Number(image?.naturalHeight || 0));
      const displayedDeviceLongest = imageRect ? Math.max(imageRect.width, imageRect.height) * dpr : 0;
      const density = naturalLongest / Math.max(1, displayedDeviceLongest);
      const source = String(image?.currentSrc || image?.getAttribute('src') || '');
      let thumbnail = false;
      let thumbnailMax = 0;
      try {
        const url = new URL(source);
        thumbnail = url.searchParams.get('preview') === 'thumbnail';
        thumbnailMax = Number(url.searchParams.get('max') || 0);
      } catch {}
      const transform = String(stage?.style.transform || '');
      const translate = transform.match(/translate\\(([-0-9.]+)px,\\s*([-0-9.]+)px\\)/);
      const translationAligned = Boolean(translate && [Number(translate[1]), Number(translate[2])].every((value) => Math.abs(value * dpr - Math.round(value * dpr)) < 0.001));
      const sourceTierOk = displayedDeviceLongest <= 900 || !thumbnail;
      const proof = {
        scale: Number(window.__iiimageDebugAgentState?.().viewport?.scale || 0),
        dpr,
        nodeMounted: Boolean(node),
        imageLoaded: Boolean(image?.complete && image?.naturalWidth > 0 && image?.naturalHeight > 0),
        imageRect: imageRect ? { left: imageRect.left, top: imageRect.top, right: imageRect.right, bottom: imageRect.bottom, width: imageRect.width, height: imageRect.height } : null,
        titleRect: titleRect ? { left: titleRect.left, top: titleRect.top, right: titleRect.right, bottom: titleRect.bottom, width: titleRect.width, height: titleRect.height } : null,
        naturalSize: { width: Number(image?.naturalWidth || 0), height: Number(image?.naturalHeight || 0) },
        displayedDeviceLongest: Math.round(displayedDeviceLongest * 1000) / 1000,
        density: Math.round(density * 1000) / 1000,
        source,
        thumbnail,
        thumbnailMax,
        sourceTierOk,
        settledClassCleared: canvas?.classList.contains('is-viewport-interacting') !== true,
        settledTransform2d: transform.includes('translate(') && !transform.includes('translate3d('),
        translationAligned,
        stageWillChange: stage ? getComputedStyle(stage).willChange : '',
        textVector: Boolean(title instanceof HTMLElement && title.namespaceURI === 'http://www.w3.org/1999/xhtml'),
        edgeVector: Boolean(edgeLayer instanceof SVGSVGElement && edge instanceof SVGPathElement),
        edgeHasNoRasterFilter: edge ? getComputedStyle(edge).filter === 'none' : false,
        imageRendering: image ? getComputedStyle(image).imageRendering : ''
      };
      return {
        ...proof,
        ok: Boolean(
          proof.nodeMounted && proof.imageLoaded && proof.density >= 1.05 && proof.sourceTierOk &&
          proof.settledClassCleared && proof.settledTransform2d && proof.translationAligned && proof.stageWillChange === 'auto' &&
          proof.textVector && proof.edgeVector && proof.edgeHasNoRasterFilter && proof.imageRendering === 'auto'
        )
      };
    })()`);
    const scaleLabel = String(scale).replace('.', '-');
    const capture = await captureState(client, targetId, `canvas-clarity-${scaleLabel}x`, null, null, {
      settingsOpen: false,
      historyOpen: false,
      accountOpen: false,
      canvasVisible: true,
      agentDebugReady: true,
      agentIdle: true
    });
    const edgeContrast = screenshotEdgeContrastReport(capture.screenshotPath, proof?.imageRect, proof?.dpr);
    const screenshotStable = capture?.dualFrameReport?.stable === true;
    const sample = {
      scale,
      ok: Boolean(proof?.ok && edgeContrast.ok && screenshotStable && capture?.screenshotSource !== 'fallback'),
      proof,
      edgeContrast,
      screenshotStable,
      screenshotPath: capture.screenshotPath,
      screenshotSource: capture.screenshotSource,
      dualFrameReport: capture.dualFrameReport
    };
    samples.push(sample);
    capture.suite = { ok: sample.ok, suitePath, sample };
    captures.push(capture);
  }

  const suite = {
    ok: Boolean(interaction?.ok && samples.every((sample) => sample.ok)),
    setup: { ok: setup.ok, firstId: setup.firstId, secondId: setup.secondId, connected: setup.connected },
    interaction,
    samples
  };
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  for (const capture of captures) capture.suite = { ok: suite.ok, suitePath, interaction, sample: capture.suite.sample };
  recordObservation(suite.ok ? "info" : "issue", suite.ok ? "canvas-clarity-suite-success" : "canvas-clarity-suite-failed", {
    suitePath,
    interaction,
    samples: samples.map((sample) => ({ scale: sample.scale, ok: sample.ok, density: sample.proof?.density, thumbnail: sample.proof?.thumbnail, thumbnailMax: sample.proof?.thumbnailMax, edgeContrast: sample.edgeContrast, screenshotStable: sample.screenshotStable }))
  });
  return captures;
}

async function main() {
  if (imageCollectionPersistenceOnly && !persistenceStage && process.env.IIIMAGE_AIDEBUG_CHILD !== "1") {
    await runImageCollectionPersistenceSupervisor();
    return;
  }
  if (contextPersistenceOnly && !persistenceStage && process.env.IIIMAGE_AIDEBUG_CHILD !== "1") {
    await runContextPersistenceSupervisor();
    return;
  }
  if (cycles > 1 && process.env.IIIMAGE_AIDEBUG_CHILD !== "1") {
    await runCycleSupervisor();
    return;
  }
  mkdirSync(runDir, { recursive: true });
  setProbePhase("bootstrap:prepare-run", { runDir });
  startHarnessHeartbeat();
  devPort = await resolveDevPort();
  devUrl = `http://127.0.0.1:${devPort}`;
  debugPort = await resolveDebugPort();
  if (imageImportSuiteOnly) prepareImageImportFixture();
  mkdirSync(dragFixtureNestedDir, { recursive: true });
  writeFileSync(dragFixturePaths[0], createIndexedFixturePng(1));
  writeFileSync(dragFixturePaths[1], createIndexedFixturePng(2));
  writeFileSync(join(dragFixtureDir, "ignored.txt"), "not an image", "utf8");
  const occurrenceBytes = createIndexedFixturePng(91, 24, 24);
  for (const [index, folder] of occurrenceFixtureDirs.entries()) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, index === 0 ? "same-a.png" : "same-b.png"), occurrenceBytes);
  }
  prepareLiveImageConfig();
  const serverProbeStartedAtMs = Date.now();
  viteProcess = spawnVite();
  pipeProcessLogs(viteProcess, "vite");
  await waitForServer(devUrl);
  const serverReadyAtMs = Date.now();
  const electronSpawnedAtMs = Date.now();
  electronProcess = spawnElectron();
  pipeProcessLogs(electronProcess, "electron");
  const target = await waitForDebugTarget();
  activeDebugTarget = target;
  const client = new CdpClient(target.webSocketDebuggerUrl, "primary");
  activeCdpClient = client;
  await client.open();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await waitForExpression(client, "Boolean(document.querySelector('.ide-shell') || document.querySelector('.auth-card'))");
  await delay(500);
  await evaluate(client, `(async () => {
    window.__iiimageAgentToolsProbe = await window.iiimageAgent?.tools?.();
    return window.__iiimageAgentToolsProbe;
  })()`);
  const workbenchReadyAtMs = Date.now();
  startupPerformance = {
    suiteProcessStartedAt: new Date(aidebugProcessStartedAtMs).toISOString(),
    serverProbeStartedAt: new Date(serverProbeStartedAtMs).toISOString(),
    serverReadyAt: new Date(serverReadyAtMs).toISOString(),
    electronSpawnedAt: new Date(electronSpawnedAtMs).toISOString(),
    workbenchReadyAt: new Date(workbenchReadyAtMs).toISOString(),
    serverAlreadyReady: false,
    devPort,
    devUrl,
    serverProbeToReadyMs: serverReadyAtMs - serverProbeStartedAtMs,
    electronSpawnToWorkbenchReadyMs: workbenchReadyAtMs - electronSpawnedAtMs,
    suiteProcessToWorkbenchReadyMs: workbenchReadyAtMs - aidebugProcessStartedAtMs,
    readinessContract: "debug target attached, Runtime/Page enabled, workbench or auth shell mounted, agent tools bridge resolved"
  };

  try {
    const results = [];
    if (failureDiagnosticsSelfTestOnly) {
      setProbePhase("selftest:controlled-cdp-timeout", { expectedClassification: "probe-command-stalled-product-responsive" });
      await evaluate(client, "new Promise(() => {})", 800);
      throw new Error("AIDebug failure diagnostics self-test did not time out as expected");
    }
    if (imageImportSuiteOnly) {
      results.push(await captureImageImportSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "image-import-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "image-import-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (requirementNodeSuiteOnly) {
      results.push(...await captureRequirementNodeSuite({
        client,
        targetId: target.id,
        waitForExpression,
        evaluate,
        captureState,
        runDir,
        fixturePaths: dragFixturePaths,
        recordObservation,
        setProbePhase
      }));
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "requirement-node-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "requirement-node-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (askUserContinuationSuiteOnly) {
      results.push(...await captureAskUserContinuationSuite({
        client,
        targetId: target.id,
        waitForExpression,
        evaluate,
        captureState,
        runDir,
        fixturePaths: dragFixturePaths,
        recordObservation,
        setProbePhase
      }));
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "ask-user-continuation-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "ask-user-continuation-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (contextMenuSuiteOnly) {
      results.push(...await captureContextMenuSuiteProbe(client, target.id));
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "context-menu-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "context-menu-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (selectionCommandSuiteOnly) {
      results.push(...await captureSelectionCommandSuite({
        client,
        targetId: target.id,
        setWindowSize,
        evaluate,
        captureState
      }));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "selection-command-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "selection-command-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (canvasClaritySuiteOnly) {
      results.push(...await captureCanvasClaritySuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "canvas-clarity-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "canvas-clarity-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (performanceSuiteOnly) {
      results.push(...await capturePerformanceSuiteProbe({
        client,
        targetId: target.id,
        aidebugConfigDir,
        packageRoot,
        runDir,
        startupPerformance,
        evaluate,
        captureState
      }));
      const performance = results[0]?.performance || null;
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "performance-suite", baselineOnly: true, runDir, reportPath, contactSheetPath, summaryPath, observations, performance, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "performance-suite", baselineOnly: true, runDir, reportPath, contactSheetPath, summaryPath, performance, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (authGateSuiteOnly) {
      results.push(...await captureAuthGateSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "auth-gate-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "auth-gate-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (uiSurfaceSuiteOnly) {
      results.push(...await captureUiSurfaceSuite({
        client,
        targetId: target.id,
        captureState,
        openSurfaceExpression,
        workbenchMinWidth
      }));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "ui-surface-suite", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "ui-surface-suite", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (agentUiPromptSuiteOnly) {
      results.push(...await captureAgentUiPromptSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "agent-ui-prompt-suite", agentMode: mockAgent ? "mock-agent" : "real-agent", liveImage, prompt: agentUiPrompt, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "agent-ui-prompt-suite", agentMode: mockAgent ? "mock-agent" : "real-agent", liveImage, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (realAgentSuiteOnly) {
      results.push(...await captureRealAgentSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "real-agent-suite", agentMode: mockAgent ? "mock-agent" : "real-agent", liveImage, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "real-agent-suite", agentMode: mockAgent ? "mock-agent" : "real-agent", liveImage, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (imageCollectionPersistenceOnly) {
      results.push(...await captureImageCollectionPersistenceProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "canvas-image-collection-persistence", persistenceStage: persistenceStage || "supervised", persistenceStateFile, aidebugConfigDir, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "canvas-image-collection-persistence", persistenceStage: persistenceStage || "supervised", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (contextPersistenceOnly) {
      results.push(await captureContextPersistenceProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "context-persistence", persistenceStage: persistenceStage || "supervised", persistenceSentinel, persistenceStateFile, aidebugConfigDir, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "context-persistence", persistenceStage: persistenceStage || "supervised", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (posterBatchOnly) {
      results.push(...await captureAgentPosterBatchProbe(client, target.id, posterCount, posterAgentCount, posterDirectCount));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "poster-batch", liveImage, posterCount, posterAgentCount, posterDirectCount, posterResolution, posterQuality, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "poster-batch", liveImage, posterCount, posterAgentCount, posterDirectCount, posterResolution, posterQuality, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (mixedStressOnly) {
      results.push(...await captureAgentMixedStressProbe(client, target.id, stressRounds));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "mixed-stress", stressRounds, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "mixed-stress", stressRounds, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (regionRedrawOnly) {
      results.push(...await captureRegionRedrawSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "region-redraw", liveImage, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "region-redraw", liveImage, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (cutoutOnly) {
      results.push(await captureCutoutSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "cutout", liveImage, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "cutout", liveImage, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (layerStackOnly) {
      results.push(...await captureLayerStackSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "layer-stack", liveImage, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "layer-stack", liveImage, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (imageCollectionOnly) {
      results.push(...await captureCanvasImageCollectionSuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "canvas-image-collection", liveImage, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "canvas-image-collection", liveImage, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (imageRecoveryOnly) {
      results.push(await captureAgentImageRecoverySuiteProbe(client, target.id));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "image-recovery", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "image-recovery", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (imageOnly) {
      results.push(await captureAgentImageSuiteProbe(client, target.id, imageRuns));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "image-only", imageRuns, runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "image-only", imageRuns, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (agentOnly) {
      const fixedAgentExpected = {
        settingsOpen: false,
        modalOpen: false,
        accountOpen: false,
        agentPanelVisible: true,
        projectAgentFixedOk: true,
        projectAgentContextVisible: true,
        canvasSelectionIndicatorVisibleOk: true,
        canvasSelectionIndicatorGeometryOk: true,
        selectionSurfacesConsistentOk: true,
        agentCoreNodeAbsent: true,
        manualWorkflowControlsAbsent: true,
        imageTaskButtonsVisibleOk: true,
        imageTaskButtonStateOk: true,
        publicAgentToolSchemaOk: true,
        projectAgentCollapseButtonVisible: true,
        timelineNodesVisible: true,
        composerTextareaTall: true,
        composerControlsVisibleOk: true,
        composerViewportVisibleOk: true,
        canvasVisible: true,
        canvasViewportFillOk: true,
        toolTimelineIdentityOk: true
      };
      const emptyCanvasAgentExpected = { ...fixedAgentExpected, canvasSelectionStateOk: true };
      results.push(await captureState(client, target.id, "project-agent-1280", openSurfaceExpression("agent-timeline"), { width: 1280, height: 820 }, emptyCanvasAgentExpected));
      results.push(await captureState(client, target.id, "project-agent-min-884", openSurfaceExpression("agent-timeline"), { width: workbenchMinWidth, height: 720 }, { ...emptyCanvasAgentExpected, imageNodeViewportOk: true }));
      const collapsedExpected = { settingsOpen: false, modalOpen: false, accountOpen: false, agentPanelVisible: true, projectAgentCollapsed: true, projectAgentCollapsedOk: true, projectAgentCollapseButtonVisible: true, canvasVisible: true, canvasViewportFillOk: true, manualWorkflowControlsAbsent: true, agentCoreNodeAbsent: true };
      results.push(await captureState(client, target.id, "project-agent-collapsed-1280", openSurfaceExpression("agent-collapsed"), { width: 1280, height: 820 }, collapsedExpected));
      results.push(await captureState(client, target.id, "project-agent-collapsed-min-884", openSurfaceExpression("agent-collapsed"), { width: workbenchMinWidth, height: 720 }, { ...collapsedExpected, imageNodeViewportOk: true }));
      results.push(await captureState(client, target.id, "project-agent-collapsed-file-menu-min-884", openSurfaceExpression("agent-collapsed", `document.querySelector(".file-command-menu > button")?.click(); await delay(120);`), { width: workbenchMinWidth, height: 720 }, { ...collapsedExpected, fileMenuOpen: true, projectMenuOpen: false, menuWithinViewport: true, imageNodeViewportOk: true }));
      results.push(await captureState(client, target.id, "project-agent-collapsed-project-menu-min-884", openSurfaceExpression("agent-collapsed", `document.querySelector(".project-menu:not(.file-command-menu) > button")?.click(); await delay(120);`), { width: workbenchMinWidth, height: 720 }, { ...collapsedExpected, fileMenuOpen: false, projectMenuOpen: true, menuWithinViewport: true, imageNodeViewportOk: true }));
      const artifactContextExpression = openSurfaceExpression("agent-timeline", `
        const sourceId = "aidebug-artifact-source";
        const targetId = "aidebug-artifact-target";
        const variantId = "aidebug-artifact-variant";
        window.__iiimageDebugApplyAgentActions?.([
          { type: "workflow.canvas.clear", mode: "all" },
          { type: "workflow.node.create", node: { title: "不应出现的 Agent 节点", nodeType: "agent" } },
          {
            type: "workflow.node.create",
            node: { id: sourceId, title: "AIDebug 来源成果", prompt: "用于验证成果来源关系。", nodeType: "image", imageState: "empty", outputs: 0 }
          }
        ]);
        await delay(160);
        const beforeAutoNodeIds = new Set((window.__iiimageDebugAgentState?.().nodes || []).map((node) => String(node.id || "")));
        window.__iiimageAutoImageProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "image_gen",
          input: { operation: "generate", prompt: "AIDebug 自动续图关系测试。", ratio: "1:1", resolution: "720P", count: 1, quality: "auto", brief: "验证 Image Gen 自动显示并继承当前成果关系。" }
        });
        await delay(220);
        const afterAutoNodes = window.__iiimageDebugAgentState?.().nodes || [];
        const derivedNode = afterAutoNodes.find((node) => node.parentId === sourceId) ||
          afterAutoNodes.find((node) => !beforeAutoNodeIds.has(String(node.id || "")) && node.type === "image");
        const derivedId = String(derivedNode?.id || "");
        window.__iiimageDebugApplyAgentActions?.([
          {
            type: "workflow.node.create",
            node: { id: targetId, title: "AIDebug 手动连接目标", prompt: "用于验证端口拖接、断开与重连。", nodeType: "image", imageState: "empty", outputs: 0, parentId: null }
          },
          {
            type: "workflow.node.create",
            node: { id: variantId, title: "AIDebug 变体成果", prompt: "用于验证独立的成果关系类型。", nodeType: "image", imageState: "empty", outputs: 0, parentId: null }
          }
        ]);
        await delay(520);
        window.__iiimageArtifactSceneIds = { sourceId, derivedId, targetId, variantId };
        // Four independent artifacts are intentionally arranged as two compact
        // horizontal rows so every connection port and its overlap point stays in
        // the real viewport. This makes the gesture proof deterministic without
        // bypassing the product's pointer handlers.
        window.__iiimageDebugMoveNode?.({ id: sourceId, x: 160, y: 100 });
        window.__iiimageDebugMoveNode?.({ id: variantId, x: 1260, y: 100 });
        window.__iiimageDebugMoveNode?.({ id: derivedId, x: 160, y: 700 });
        window.__iiimageDebugMoveNode?.({ id: targetId, x: 1260, y: 700 });
        await window.__iiimageAIDebug?.fitCanvas?.();
        await delay(320);
       {
         const dragToTargetBody = async (pointerId) => {
            const output = document.querySelector('.flow-node[data-node-id="' + derivedId + '"] .node-port.provenance-port.output');
            const targetNode = document.querySelector('.flow-node[data-node-id="' + targetId + '"]');
            const from = output?.getBoundingClientRect();
            const to = targetNode?.getBoundingClientRect();
            if (!output || !from || !to) return false;
            const startX = from.left + from.width / 2;
            const startY = from.top + from.height / 2;
           const endX = to.left + to.width / 2;
           const endY = to.top + Math.min(96, to.height / 2);
           output.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY }));
           await delay(40);
           window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: endX, clientY: endY }));
           await delay(30);
           window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: endX, clientY: endY }));
           await delay(100);
           return true;
         };
         if (await dragToTargetBody(74)) {
           const connected = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === targetId);
           const connectedByBody = connected?.parentId === derivedId;
           const connectedVisual = Boolean(
             document.querySelector('.flow-node[data-node-id="' + derivedId + '"] .node-port.provenance-port.output.connected') &&
             document.querySelector('.flow-node[data-node-id="' + targetId + '"] .node-port.provenance-port.input.connected')
           );
           const input = document.querySelector('.flow-node[data-node-id="' + targetId + '"] .node-port.provenance-port.input');
           input?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
           await delay(80);
           const inputDisconnected = !window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === targetId)?.parentId;
            await dragToTargetBody(75);
            const output = document.querySelector('.flow-node[data-node-id="' + derivedId + '"] .node-port.provenance-port.output');
            const from = output?.getBoundingClientRect();
            if (!output || !from) return;
            const startX = from.left + from.width / 2;
           const startY = from.top + from.height / 2;
           output.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 76, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY }));
           await delay(30);
           window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 76, pointerType: 'mouse', button: 0, buttons: 0, clientX: startX, clientY: startY }));
           await delay(80);
           const outputDisconnected = !window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === targetId)?.parentId;
           await dragToTargetBody(77);
           const cycleResult = window.__iiimageDebugConnectNodes?.({ sourceId: targetId, targetId: derivedId });
           await delay(50);
           const finalC = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === targetId);
           const finalB = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === derivedId);
           const cycleBlocked = cycleResult === false && finalB?.parentId !== targetId;
           const originalCX = finalC?.x;
           const originalCY = finalC?.y;
            const overlapInset = 64;
            const overlapMoved = window.__iiimageDebugMoveNode?.({ id: targetId, x: Number(finalB?.x || 0) + Number(finalB?.width || 364) - overlapInset, y: Number(finalB?.y || 0) });
           await delay(80);
           const overlappedOutput = document.querySelector('.flow-node[data-node-id="' + derivedId + '"] .node-port.provenance-port.output');
           const overlappedOutputBox = overlappedOutput?.getBoundingClientRect();
            const hitAtOutput = overlappedOutputBox
              ? document.elementFromPoint(overlappedOutputBox.left + overlappedOutputBox.width / 2, overlappedOutputBox.top + overlappedOutputBox.height / 2)
              : null;
            const hitNodeIds = overlappedOutputBox
              ? [...new Set(document.elementsFromPoint(overlappedOutputBox.left + overlappedOutputBox.width / 2, overlappedOutputBox.top + overlappedOutputBox.height / 2)
                .map((element) => element.closest?.('.flow-node')?.getAttribute('data-node-id') || '')
                .filter(Boolean))]
              : [];
            const hitNodeId = hitAtOutput?.closest?.('.flow-node')?.getAttribute('data-node-id') || '';
           const bNodeElement = document.querySelector('.flow-node[data-node-id="' + derivedId + '"]');
           const cNodeElement = document.querySelector('.flow-node[data-node-id="' + targetId + '"]');
           const bZ = Number.parseInt(bNodeElement ? getComputedStyle(bNodeElement).zIndex : '0', 10) || 0;
           const cZ = Number.parseInt(cNodeElement ? getComputedStyle(cNodeElement).zIndex : '0', 10) || 0;
            const expectedHitNodeId = cZ >= bZ ? targetId : derivedId;
            const stackingHitOk = overlapMoved === true && hitNodeIds.includes(derivedId) && hitNodeIds.includes(targetId) && hitNodeId === expectedHitNodeId;
           if (Number.isFinite(originalCX) && Number.isFinite(originalCY)) window.__iiimageDebugMoveNode?.({ id: targetId, x: originalCX, y: originalCY });
           await delay(80);
           window.__iiimageConnectionPortProbe = {
             ok: connectedByBody && connectedVisual && inputDisconnected && outputDisconnected && finalC?.parentId === derivedId && cycleBlocked && stackingHitOk,
             parentId: finalC?.parentId || '',
             connectedByBody,
             connectedVisual,
             inputDisconnected,
             outputDisconnected,
             cycleBlocked,
              stackingHitOk,
              overlapInset,
              hitNodeIds,
             hitNodeId,
             expectedHitNodeId,
             bZ,
             cZ
           };
         }
        }
        window.__iiimageEdgeCreationSequenceProbe = {
          beforeSecondRelationKeys: Array.from(document.querySelectorAll('.edge.provenance')).map((edge) =>
            String(edge.getAttribute('data-source-id') || '') + '->' + String(edge.getAttribute('data-target-id') || '')
          ),
          beforeSecondRelationAt: performance.now()
        };
       window.__iiimageRelationTypeProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "workflow",
           input: { operation: "connect_nodes", sourceId, targetId: variantId, relationType: "variant", brief: "验证变体成果关系。" }
        });
        await delay(120);
        window.__iiimageEdgeCreationSequenceProbe.afterSecondRelationAt = performance.now();
        window.__iiimageEdgeCreationSequenceProbe.afterSecondRelationKeys = Array.from(document.querySelectorAll('.edge.provenance')).map((edge) =>
          String(edge.getAttribute('data-source-id') || '') + '->' + String(edge.getAttribute('data-target-id') || '')
        );
       {
         const edgePaths = () => Object.fromEntries(Array.from(document.querySelectorAll('.edge.provenance')).map((edge) => [
           String(edge.getAttribute('data-source-id') || '') + '->' + String(edge.getAttribute('data-target-id') || ''),
           String(edge.getAttribute('d') || '')
         ]));
         const nodeZ = () => Object.fromEntries(Array.from(document.querySelectorAll('.flow-node')).map((node) => [
           String(node.getAttribute('data-node-id') || ''),
           Number.parseInt(getComputedStyle(node).zIndex, 10) || 0
         ]));
         const persistedZ = () => Object.fromEntries((window.__iiimageDebugAgentState?.().nodes || []).map((node) => [
           String(node.id || ''),
           Number.isFinite(Number(node.zOrder)) ? Number(node.zOrder) : null
         ]));
         const beforeState = window.__iiimageDebugAgentState?.() || {};
         const movingNode = beforeState.nodes?.find((node) => node.id === derivedId);
         const beforePaths = edgePaths();
         const beforeZ = nodeZ();
         const beforePersistedZ = persistedZ();
         const moved = movingNode && window.__iiimageDebugMoveNode?.({
           id: derivedId,
           x: Number(movingNode.x || 0),
           y: Number(movingNode.y || 0) + Math.max(560, Number(movingNode.height || 0) + 80)
         });
         await delay(140);
         const movedPaths = edgePaths();
          const derivedTargetKey = derivedId + '->' + targetId;
          const sourceVariantKey = sourceId + '->' + variantId;
          const movedEndpointPathChanged = Boolean(moved && beforePaths[derivedTargetKey] && movedPaths[derivedTargetKey] && beforePaths[derivedTargetKey] !== movedPaths[derivedTargetKey]);
          const unrelatedEdgePathStable = Boolean(beforePaths[sourceVariantKey] && movedPaths[sourceVariantKey] && beforePaths[sourceVariantKey] === movedPaths[sourceVariantKey]);
         if (movingNode) window.__iiimageDebugMoveNode?.({ id: derivedId, x: Number(movingNode.x || 0), y: Number(movingNode.y || 0) });
         await delay(140);
         const restoredPaths = edgePaths();
          const restoredPathStable = Boolean(beforePaths[derivedTargetKey] === restoredPaths[derivedTargetKey] && beforePaths[sourceVariantKey] === restoredPaths[sourceVariantKey]);
         const selected = await window.__iiimageAIDebug?.selectNode?.({ id: derivedId });
         await delay(120);
         const selectedZ = nodeZ();
         const selectedPersistedZ = persistedZ();
         const selectedNodeZOrderStable = JSON.stringify(beforeZ) === JSON.stringify(selectedZ);
         const zOrderDebugDataAvailable = Object.values(beforePersistedZ).length > 0 && Object.values(beforePersistedZ).every((value) => value !== null);
         const persistedZOrderStable = !zOrderDebugDataAvailable || JSON.stringify(beforePersistedZ) === JSON.stringify(selectedPersistedZ);
          window.__iiimageEdgeStabilityProbe = {
           ok: Boolean(movedEndpointPathChanged && unrelatedEdgePathStable && restoredPathStable && selected?.ok && selectedNodeZOrderStable && persistedZOrderStable),
           movedEndpointPathChanged,
           unrelatedEdgePathStable,
           restoredPathStable,
           selectedNodeZOrderStable,
           persistedZOrderStable,
           zOrderDebugDataAvailable,
           zOrderDebugDataMissingIds: Object.entries(beforePersistedZ).filter(([, value]) => value === null).map(([id]) => id),
           beforePaths,
           movedPaths,
           restoredPaths,
           beforeZ,
           selectedZ,
           beforePersistedZ,
            selectedPersistedZ
           };
         }
         await window.__iiimageAIDebug?.fitCanvas?.();
         await delay(220);
         {
           const edgeFor = (sourceId, targetId) => document.querySelector(
             '.edge.provenance[data-source-id="' + sourceId + '"][data-target-id="' + targetId + '"]'
           );
           const obstacleEdgeKey = sourceId + '->' + variantId;
           const pathShape = (path) => {
             const commands = Array.from(String(path || '')).filter((character) => /[A-Za-z]/.test(character) && character.toUpperCase() !== 'E');
             return {
               commands,
               cubicCount: commands.filter((command) => command.toUpperCase() === 'C').length,
               extraRouteCommandCount: commands.filter((command) => ['L', 'Q', 'S', 'T', 'A', 'H', 'V'].includes(command.toUpperCase())).length
             };
           };
           const targetEdge = edgeFor(sourceId, variantId);
           const obstacleElement = document.querySelector('.flow-node[data-node-id="' + derivedId + '"]');
           const obstacleState = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === derivedId);
           const beforePath = String(targetEdge?.getAttribute('d') || '');
           const beforeShape = pathShape(beforePath);
           const targetLength = typeof targetEdge?.getTotalLength === 'function' ? Number(targetEdge.getTotalLength() || 0) : 0;
           const targetMatrix = typeof targetEdge?.getScreenCTM === 'function' ? targetEdge.getScreenCTM() : null;
           const localMidpoint = targetLength > 0 && typeof targetEdge?.getPointAtLength === 'function'
             ? targetEdge.getPointAtLength(targetLength / 2)
             : null;
           const screenMidpoint = localMidpoint && targetMatrix ? {
             x: targetMatrix.a * localMidpoint.x + targetMatrix.c * localMidpoint.y + targetMatrix.e,
             y: targetMatrix.b * localMidpoint.x + targetMatrix.d * localMidpoint.y + targetMatrix.f
           } : null;
           const obstacleBeforeBox = obstacleElement?.getBoundingClientRect();
           const viewportScale = Math.max(0.01, Number(window.__iiimageDebugAgentState?.().viewport?.scale || 1));
           const obstacleMove = screenMidpoint && obstacleBeforeBox && obstacleState
             ? window.__iiimageDebugMoveNode?.({
                 id: derivedId,
                 x: Number(obstacleState.x || 0) + (screenMidpoint.x - (obstacleBeforeBox.left + obstacleBeforeBox.width / 2)) / viewportScale,
                 y: Number(obstacleState.y || 0) + (screenMidpoint.y - (obstacleBeforeBox.top + obstacleBeforeBox.height / 2)) / viewportScale
               })
             : false;
           await delay(160);
           const duringEdge = edgeFor(sourceId, variantId);
           const duringPath = String(duringEdge?.getAttribute('d') || '');
           const duringShape = pathShape(duringPath);
           const obstacleDuringBox = document.querySelector('.flow-node[data-node-id="' + derivedId + '"]')?.getBoundingClientRect();
           const duringLength = typeof duringEdge?.getTotalLength === 'function' ? Number(duringEdge.getTotalLength() || 0) : 0;
           const duringMatrix = typeof duringEdge?.getScreenCTM === 'function' ? duringEdge.getScreenCTM() : null;
           const duringLocalMidpoint = duringLength > 0 && typeof duringEdge?.getPointAtLength === 'function'
             ? duringEdge.getPointAtLength(duringLength / 2)
             : null;
           const duringScreenMidpoint = duringLocalMidpoint && duringMatrix ? {
             x: duringMatrix.a * duringLocalMidpoint.x + duringMatrix.c * duringLocalMidpoint.y + duringMatrix.e,
             y: duringMatrix.b * duringLocalMidpoint.x + duringMatrix.d * duringLocalMidpoint.y + duringMatrix.f
           } : null;
           const obstacleCoversMidpoint = Boolean(duringScreenMidpoint && obstacleDuringBox &&
             duringScreenMidpoint.x >= obstacleDuringBox.left && duringScreenMidpoint.x <= obstacleDuringBox.right &&
             duringScreenMidpoint.y >= obstacleDuringBox.top && duringScreenMidpoint.y <= obstacleDuringBox.bottom);
           const exactPathStable = Boolean(beforePath && duringPath && beforePath === duringPath);
           const simpleCubicBeforeAndDuring = Boolean(
             beforeShape.cubicCount === 1 && beforeShape.extraRouteCommandCount === 0 &&
             duringShape.cubicCount === 1 && duringShape.extraRouteCommandCount === 0
           );
           if (obstacleState) {
             window.__iiimageDebugMoveNode?.({ id: derivedId, x: Number(obstacleState.x || 0), y: Number(obstacleState.y || 0) });
           }
           await delay(160);
           const restoredPath = String(edgeFor(sourceId, variantId)?.getAttribute('d') || '');
           const restoredExactly = Boolean(beforePath && restoredPath === beforePath);
           window.__iiimageEdgeObstacleProbe = {
             ok: Boolean(obstacleMove === true && obstacleCoversMidpoint && exactPathStable && simpleCubicBeforeAndDuring && restoredExactly),
             targetEdge: obstacleEdgeKey,
             obstacleNodeId: derivedId,
             obstacleMove,
             viewportScale,
             screenMidpoint,
             duringScreenMidpoint,
             obstacleBeforeBox: obstacleBeforeBox ? { left: obstacleBeforeBox.left, top: obstacleBeforeBox.top, right: obstacleBeforeBox.right, bottom: obstacleBeforeBox.bottom } : null,
             obstacleDuringBox: obstacleDuringBox ? { left: obstacleDuringBox.left, top: obstacleDuringBox.top, right: obstacleDuringBox.right, bottom: obstacleDuringBox.bottom } : null,
             obstacleCoversMidpoint,
             exactPathStable,
             simpleCubicBeforeAndDuring,
             restoredExactly,
             beforePath,
             duringPath,
             restoredPath,
             beforeShape,
             duringShape
           };
         }
         {
           const stateBeforeCross = window.__iiimageDebugAgentState?.() || {};
           const nodeById = new Map((stateBeforeCross.nodes || []).map((node) => [String(node.id || ''), node]));
           const nodeA = nodeById.get(sourceId);
           const nodeB = nodeById.get(derivedId);
           const nodeC = nodeById.get(targetId);
           const nodeD = nodeById.get(variantId);
           const topY = Math.min(Number(nodeA?.y || 0), Number(nodeD?.y || 0));
           const bottomY = Math.max(Number(nodeB?.y || 0), Number(nodeC?.y || 0));
           const movedC = nodeC ? window.__iiimageDebugMoveNode?.({ id: targetId, x: Number(nodeC.x || 0), y: topY }) : false;
           const movedD = nodeD ? window.__iiimageDebugMoveNode?.({ id: variantId, x: Number(nodeD.x || 0), y: bottomY }) : false;
           await delay(180);
           await window.__iiimageAIDebug?.fitCanvas?.();
           await delay(260);
           const edgeKey = (edge) => String(edge?.getAttribute('data-source-id') || '') + '->' + String(edge?.getAttribute('data-target-id') || '');
           const edgeNodes = Array.from(document.querySelectorAll('.edge.provenance'));
           const edgeByKey = new Map(edgeNodes.map((edge) => [edgeKey(edge), edge]));
           const beforeSecondKeys = Array.isArray(window.__iiimageEdgeCreationSequenceProbe?.beforeSecondRelationKeys)
             ? window.__iiimageEdgeCreationSequenceProbe.beforeSecondRelationKeys
             : [];
           const afterSecondKeys = Array.isArray(window.__iiimageEdgeCreationSequenceProbe?.afterSecondRelationKeys)
             ? window.__iiimageEdgeCreationSequenceProbe.afterSecondRelationKeys
             : [];
           const newlyCreatedKeys = afterSecondKeys.filter((key) => !beforeSecondKeys.includes(key));
           const creationOrder = [...beforeSecondKeys, ...newlyCreatedKeys];
           const domOrder = edgeNodes.map(edgeKey);
           const sourceDerivedKey = sourceId + '->' + derivedId;
           const derivedTargetKey = derivedId + '->' + targetId;
           const sourceVariantKey = sourceId + '->' + variantId;
           const expectedOrder = [sourceDerivedKey, derivedTargetKey, sourceVariantKey];
           const creationOrderExact = JSON.stringify(creationOrder) === JSON.stringify(expectedOrder);
           const domOrderExact = JSON.stringify(domOrder) === JSON.stringify(expectedOrder);
           const laterEdgeDrawnAfterEarlier = domOrder.indexOf(sourceVariantKey) > domOrder.indexOf(derivedTargetKey);
           const earlierEdge = edgeByKey.get(derivedTargetKey);
           const laterEdge = edgeByKey.get(sourceVariantKey);
           const sampleScreenPoints = (edge, count = 180) => {
             const length = typeof edge?.getTotalLength === 'function' ? Number(edge.getTotalLength() || 0) : 0;
             const matrix = typeof edge?.getScreenCTM === 'function' ? edge.getScreenCTM() : null;
             if (!edge || !matrix || length <= 0 || typeof edge.getPointAtLength !== 'function') return [];
             return Array.from({ length: count + 1 }, (_, index) => {
               const point = edge.getPointAtLength(length * index / count);
               return {
                 x: matrix.a * point.x + matrix.c * point.y + matrix.e,
                 y: matrix.b * point.x + matrix.d * point.y + matrix.f,
                 ratio: index / count
               };
             });
           };
           const segmentIntersection = (a, b, c, d) => {
             const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
             if (Math.abs(denominator) < 0.000001) return null;
             const numeratorT = (c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x);
             const numeratorU = (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
             const t = numeratorT / denominator;
             const u = numeratorU / denominator;
             if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
             return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), t, u };
           };
           const earlierSamples = sampleScreenPoints(earlierEdge);
           const laterSamples = sampleScreenPoints(laterEdge);
           let crossingPoint = null;
           let crossingSegments = null;
           for (let firstIndex = 1; firstIndex < earlierSamples.length && !crossingPoint; firstIndex += 1) {
             for (let secondIndex = 1; secondIndex < laterSamples.length; secondIndex += 1) {
               const hit = segmentIntersection(earlierSamples[firstIndex - 1], earlierSamples[firstIndex], laterSamples[secondIndex - 1], laterSamples[secondIndex]);
               if (hit) {
                 crossingPoint = { x: hit.x, y: hit.y };
                 crossingSegments = { firstIndex, secondIndex, sampleCount: earlierSamples.length - 1 };
                 break;
               }
             }
           }
           const crossingOk = Boolean(crossingPoint && crossingSegments &&
             crossingSegments.firstIndex > 6 && crossingSegments.firstIndex < crossingSegments.sampleCount - 6 &&
             crossingSegments.secondIndex > 6 && crossingSegments.secondIndex < crossingSegments.sampleCount - 6);
           const edgeLayer = document.querySelector('.edge-layer');
           const originalLayerStyle = edgeLayer?.getAttribute('style') || '';
           const originalEdgeStyles = new Map(edgeNodes.map((edge) => [edge, edge.getAttribute('style') || '']));
           let crossingHitStack = [];
           let laterEdgeHitFirst = false;
           let pixelProof = { ok: false, reason: 'crossing unavailable' };
           if (crossingOk && edgeLayer && earlierEdge && laterEdge) {
             edgeLayer.style.pointerEvents = 'auto';
             edgeNodes.forEach((edge) => {
               const isLater = edge === laterEdge;
               edge.style.pointerEvents = 'stroke';
               edge.style.stroke = isLater ? 'rgb(37, 99, 235)' : 'rgb(239, 68, 68)';
               edge.style.strokeWidth = '18px';
               edge.style.strokeDasharray = 'none';
               edge.style.animation = 'none';
               edge.style.opacity = '1';
             });
             crossingHitStack = document.elementsFromPoint(crossingPoint.x, crossingPoint.y)
               .filter((element) => element.matches?.('.edge.provenance'))
               .map(edgeKey);
             laterEdgeHitFirst = crossingHitStack[0] === sourceVariantKey && crossingHitStack.includes(derivedTargetKey);
             try {
               const matrix = typeof earlierEdge.getScreenCTM === 'function' ? earlierEdge.getScreenCTM() : null;
               const determinant = matrix ? matrix.a * matrix.d - matrix.b * matrix.c : 0;
               if (!matrix || Math.abs(determinant) < 0.000001) throw new Error('crossing SVG transform is not invertible');
               const localCrossing = {
                 x: (matrix.d * (crossingPoint.x - matrix.e) - matrix.c * (crossingPoint.y - matrix.f)) / determinant,
                 y: (-matrix.b * (crossingPoint.x - matrix.e) + matrix.a * (crossingPoint.y - matrix.f)) / determinant
               };
               const width = 64;
               const height = 64;
               const localRadius = 48;
               const clone = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
               clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
               clone.setAttribute('width', String(width));
               clone.setAttribute('height', String(height));
               clone.setAttribute('viewBox', [localCrossing.x - localRadius, localCrossing.y - localRadius, localRadius * 2, localRadius * 2].join(' '));
               [earlierEdge, laterEdge].forEach((edge, index) => {
                 const pathClone = edge.cloneNode(false);
                 pathClone.setAttribute('fill', 'none');
                 pathClone.setAttribute('stroke', index === 1 ? 'rgb(37, 99, 235)' : 'rgb(239, 68, 68)');
                 pathClone.setAttribute('stroke-width', '18');
                 pathClone.setAttribute('stroke-linecap', 'round');
                 pathClone.setAttribute('stroke-dasharray', 'none');
                 pathClone.setAttribute('opacity', '1');
                 pathClone.removeAttribute('class');
                 pathClone.removeAttribute('style');
                 pathClone.removeAttribute('vector-effect');
                 clone.appendChild(pathClone);
               });
               const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
               const url = URL.createObjectURL(blob);
               const raster = new Image();
               await new Promise((resolve, reject) => {
                 const timeoutId = setTimeout(() => reject(new Error('crossing raster timed out')), 2500);
                 raster.onload = () => {
                   clearTimeout(timeoutId);
                   resolve();
                 };
                 raster.onerror = (error) => {
                   clearTimeout(timeoutId);
                   reject(error);
                 };
                 raster.src = url;
               });
               const canvas = document.createElement('canvas');
               canvas.width = width;
               canvas.height = height;
               const context = canvas.getContext('2d', { willReadFrequently: true });
               context.drawImage(raster, 0, 0, width, height);
               URL.revokeObjectURL(url);
               const centerX = width / 2;
               const centerY = height / 2;
               const rgba = context.getImageData(centerX - 2, centerY - 2, 5, 5).data;
               let blueDominant = 0;
               let redDominant = 0;
               let opaque = 0;
               for (let index = 0; index < rgba.length; index += 4) {
                 const red = rgba[index];
                 const green = rgba[index + 1];
                 const blue = rgba[index + 2];
                 const alpha = rgba[index + 3];
                 if (alpha > 32) opaque += 1;
                 if (alpha > 32 && blue > red * 1.35 && blue > green * 1.35) blueDominant += 1;
                 if (alpha > 32 && red > blue * 1.35 && red > green * 1.35) redDominant += 1;
               }
               pixelProof = {
                 ok: opaque >= 16 && blueDominant >= 16 && blueDominant > redDominant * 3,
                 centerX,
                 centerY,
                 opaque,
                 blueDominant,
                 redDominant,
                 samplePixels: 25,
                 expectedTopColor: 'rgb(37, 99, 235)',
                 expectedTopEdge: sourceVariantKey,
                 localCrossing,
                 viewBox: clone.getAttribute('viewBox')
               };
             } catch (error) {
               pixelProof = { ok: false, reason: error instanceof Error ? error.message : String(error) };
             } finally {
               edgeLayer.setAttribute('style', originalLayerStyle);
               edgeNodes.forEach((edge) => edge.setAttribute('style', originalEdgeStyles.get(edge) || ''));
             }
           }
           const reloadApiKeys = Object.keys(window.__iiimageAIDebug || {}).filter((key) => /reload|persist|save.*project|load.*project/i.test(key));
           const persistenceReloadAvailable = reloadApiKeys.length > 0;
           const creationAndDomOrderOk = Boolean(
             movedC === true && movedD === true && creationOrderExact && domOrderExact && laterEdgeDrawnAfterEarlier
           );
           const paintOrderOk = Boolean(crossingOk && laterEdgeHitFirst && pixelProof.ok);
           window.__iiimageEdgeOrderProbe = {
             ok: Boolean(creationAndDomOrderOk && crossingOk && paintOrderOk),
             movedC,
             movedD,
             beforeSecondKeys,
             afterSecondKeys,
             newlyCreatedKeys,
             creationOrder,
             domOrder,
             expectedOrder,
             creationOrderExact,
             domOrderExact,
             laterEdgeDrawnAfterEarlier,
             creationAndDomOrderOk,
             crossingOk,
             crossingPoint,
             crossingSegments,
             crossingHitStack,
             laterEdgeHitFirst,
             pixelProof,
             paintOrderOk,
             persistenceReloadAvailable,
             reloadApiKeys,
             persistenceReloadVerified: false,
             persistenceReloadGap: persistenceReloadAvailable
               ? 'A scoped reload API exists but this inline visual scene does not yet have a safe state handoff.'
               : 'No scoped save/reload project API is exposed by window.__iiimageAIDebug; a full location reload would destroy the inline probe and destabilize the remaining suite.',
             originalPositions: {
               C: nodeC ? { id: targetId, x: Number(nodeC.x || 0), y: Number(nodeC.y || 0) } : null,
               D: nodeD ? { id: variantId, x: Number(nodeD.x || 0), y: Number(nodeD.y || 0) } : null
             }
           };
         }
         await window.__iiimageAIDebug?.fitCanvas?.();
        await delay(260);
         {
           const canvas = document.querySelector('.workflow-canvas');
           const canvasBox = canvas?.getBoundingClientRect();
           const hudBox = document.querySelector('.canvas-selection-indicator')?.getBoundingClientRect();
           const requiredIds = [sourceId, derivedId, targetId, variantId];
          const initialBoxes = requiredIds.map((id) => document.querySelector('.flow-node[data-node-id="' + id + '"]')?.getBoundingClientRect()).filter(Boolean);
          const top = initialBoxes.length ? Math.min(...initialBoxes.map((box) => box.top)) : 0;
          const bottom = initialBoxes.length ? Math.max(...initialBoxes.map((box) => box.bottom)) : 0;
          const desiredPanY = hudBox ? Math.max(0, hudBox.bottom + 12 - top) : 0;
          const availablePanY = canvasBox ? Math.max(0, canvasBox.bottom - 12 - bottom) : 0;
          const appliedPanY = Math.min(desiredPanY, availablePanY);
          if (canvas && appliedPanY > 0) {
            canvas.dispatchEvent(new CustomEvent('iiimage-debug-pan', { bubbles: true, detail: { dx: 0, dy: appliedPanY } }));
            await delay(220);
          }
           const overlap = (left, right) => {
             if (!left || !right) return { width: 0, height: 0, area: 0 };
             const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
             const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
             return { width, height, area: width * height };
           };
           const rounded = (value) => Math.round(Number(value || 0) * 1000) / 1000;
           const plainBox = (box) => box ? {
             left: rounded(box.left), top: rounded(box.top), right: rounded(box.right), bottom: rounded(box.bottom),
             width: rounded(box.width), height: rounded(box.height)
           } : null;
           const withinCanvas = (box, pad = 2) => Boolean(
             box && canvasBox && box.left >= canvasBox.left - pad && box.top >= canvasBox.top - pad &&
             box.right <= canvasBox.right + pad && box.bottom <= canvasBox.bottom + pad
           );
          const visibleRatio = (box) => {
            if (!box || !canvasBox || box.width <= 0 || box.height <= 0) return 0;
            const width = Math.max(0, Math.min(box.right, canvasBox.right) - Math.max(box.left, canvasBox.left));
            const height = Math.max(0, Math.min(box.bottom, canvasBox.bottom) - Math.max(box.top, canvasBox.top));
            return Math.round((width * height / (box.width * box.height)) * 1000) / 1000;
          };
           const nodeMetrics = requiredIds.map((id) => {
             const node = document.querySelector('.flow-node[data-node-id="' + id + '"]');
             const box = node?.getBoundingClientRect();
             const headBox = node?.querySelector('.node-head')?.getBoundingClientRect();
             const titleBox = node?.querySelector('.node-title-block')?.getBoundingClientRect();
             return {
               id,
               present: Boolean(node),
               geometry: plainBox(box),
               headGeometry: plainBox(headBox),
               titleGeometry: plainBox(titleBox),
               visibleRatio: visibleRatio(box),
               withinCanvas: withinCanvas(box),
               canvasGaps: box && canvasBox ? {
                 left: rounded(box.left - canvasBox.left),
                 right: rounded(canvasBox.right - box.right),
                 top: rounded(box.top - canvasBox.top),
                 bottom: rounded(canvasBox.bottom - box.bottom)
               } : null,
               hudNodeOverlap: overlap(hudBox, box),
               hudHeadOverlap: overlap(hudBox, headBox),
               hudTitleOverlap: overlap(hudBox, titleBox)
             };
           });
           const nodeMetricById = new Map(nodeMetrics.map((item) => [item.id, item]));
           const nodePairOverlaps = [];
           for (let index = 0; index < nodeMetrics.length; index += 1) {
             for (let nextIndex = index + 1; nextIndex < nodeMetrics.length; nextIndex += 1) {
               const first = nodeMetrics[index];
               const second = nodeMetrics[nextIndex];
               const intersect = overlap(first.geometry, second.geometry);
               if (intersect.area > 0) nodePairOverlaps.push({ first: first.id, second: second.id, ...intersect });
             }
           }
           const connectedPortMetrics = Array.from(document.querySelectorAll('.node-port.provenance-port.connected')).map((port) => {
             const box = port.getBoundingClientRect();
             const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
             const hitStack = document.elementsFromPoint(center.x, center.y);
             return {
               nodeId: port.closest('.flow-node')?.getAttribute('data-node-id') || '',
               role: port.classList.contains('output') ? 'output' : 'input',
               geometry: plainBox(box),
               center: { x: rounded(center.x), y: rounded(center.y) },
               diameter: rounded(Math.min(box.width, box.height)),
               hitTestOk: hitStack.includes(port),
               hitStack: hitStack.slice(0, 5).map((element) => ({
                 tag: element.tagName?.toLowerCase?.() || '',
                 className: typeof element.className === 'string' ? element.className : element.getAttribute?.('class') || '',
                 nodeId: element.closest?.('.flow-node')?.getAttribute('data-node-id') || ''
               })),
               withinCanvas: Boolean(canvasBox && center.x >= canvasBox.left && center.x <= canvasBox.right && center.y >= canvasBox.top && center.y <= canvasBox.bottom)
             };
           });
           const portMetricByKey = new Map(connectedPortMetrics.map((item) => [item.nodeId + ':' + item.role, item]));
           const pointInsideBox = (point, box, inset = 4) => Boolean(
             point && box && point.x > box.left + inset && point.x < box.right - inset && point.y > box.top + inset && point.y < box.bottom - inset
           );
           const edgeMetrics = Array.from(document.querySelectorAll('.edge.provenance')).map((edge) => {
             const box = edge.getBoundingClientRect();
             const sourceId = String(edge.getAttribute('data-source-id') || '');
             const targetId = String(edge.getAttribute('data-target-id') || '');
             const totalLength = typeof edge.getTotalLength === 'function' ? Number(edge.getTotalLength() || 0) : 0;
             const matrix = typeof edge.getScreenCTM === 'function' ? edge.getScreenCTM() : null;
             const screenPointAt = (length) => {
               if (!matrix || typeof edge.getPointAtLength !== 'function') return null;
               const point = edge.getPointAtLength(length);
               return {
                 x: matrix.a * point.x + matrix.c * point.y + matrix.e,
                 y: matrix.b * point.x + matrix.d * point.y + matrix.f
               };
             };
             const startPoint = screenPointAt(0);
             const endPoint = screenPointAt(totalLength);
             const sourcePort = portMetricByKey.get(sourceId + ':output');
             const targetPort = portMetricByKey.get(targetId + ':input');
             const endpointDistance = (point, port) => point && port ? Math.hypot(point.x - port.center.x, point.y - port.center.y) : 999999;
             const unrelatedIds = requiredIds.filter((id) => id !== sourceId && id !== targetId);
             const unrelatedNodeSampleHits = [];
             for (let sampleIndex = 1; sampleIndex < 16; sampleIndex += 1) {
               const point = screenPointAt(totalLength * sampleIndex / 16);
               for (const nodeId of unrelatedIds) {
                 if (pointInsideBox(point, nodeMetricById.get(nodeId)?.geometry, 5)) {
                   unrelatedNodeSampleHits.push({ sampleIndex, nodeId, point: point ? { x: rounded(point.x), y: rounded(point.y) } : null });
                 }
               }
             }
             const edgeStyle = getComputedStyle(edge);
             return {
               key: sourceId + '->' + targetId,
               sourceId,
               targetId,
               relation: String(edge.getAttribute('data-relation') || ''),
               path: String(edge.getAttribute('d') || ''),
               geometry: plainBox(box),
               totalLength: rounded(totalLength),
               startPoint: startPoint ? { x: rounded(startPoint.x), y: rounded(startPoint.y) } : null,
               endPoint: endPoint ? { x: rounded(endPoint.x), y: rounded(endPoint.y) } : null,
               sourceEndpointError: rounded(endpointDistance(startPoint, sourcePort)),
               targetEndpointError: rounded(endpointDistance(endPoint, targetPort)),
               unrelatedNodeSampleHits,
               stroke: edgeStyle.stroke,
               strokeWidth: rounded(Number.parseFloat(edgeStyle.strokeWidth) || 0),
               opacity: rounded(Number.parseFloat(edgeStyle.opacity) || 0),
               withinCanvas: Boolean(canvasBox && box.left >= canvasBox.left - 2 && box.right <= canvasBox.right + 2 && box.top >= canvasBox.top - 2 && box.bottom <= canvasBox.bottom + 2)
             };
           });
           const edgeKeys = edgeMetrics.map((item) => item.key).sort();
           const connectedKeys = connectedPortMetrics.map((item) => item.nodeId + ':' + item.role).sort();
           const selectedIds = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
           const viewport = window.__iiimageDebugAgentState?.().viewport || null;
           const thresholds = {
             nodeVisibleRatioMin: 0.98,
             nodeScreenWidthMin: 96,
             nodeScreenHeightMin: 64,
             titleScreenWidthMin: 42,
             titleScreenHeightMin: 8,
             hudOverlapAreaMax: 4,
             nodePairOverlapAreaMax: 4,
             portDiameterMin: 7,
             endpointErrorMax: 6,
             edgeScreenLengthMin: 60,
             edgeStrokeWidthMin: 1,
             viewportScaleMin: 0.3,
             viewportScaleMax: 1.25
           };
           const relationByKey = Object.fromEntries(edgeMetrics.map((item) => [item.key, item.relation]));
           const checks = {
             exactNodeSet: nodeMetrics.length === 4 && nodeMetrics.every((item) => item.present),
             nodesReadableAndInside: nodeMetrics.every((item) =>
               item.visibleRatio >= thresholds.nodeVisibleRatioMin && item.withinCanvas &&
               Number(item.geometry?.width || 0) >= thresholds.nodeScreenWidthMin && Number(item.geometry?.height || 0) >= thresholds.nodeScreenHeightMin &&
               Number(item.titleGeometry?.width || 0) >= thresholds.titleScreenWidthMin && Number(item.titleGeometry?.height || 0) >= thresholds.titleScreenHeightMin
             ),
             hudClear: nodeMetrics.every((item) =>
               item.hudNodeOverlap.area <= thresholds.hudOverlapAreaMax &&
               item.hudHeadOverlap.area <= thresholds.hudOverlapAreaMax &&
               item.hudTitleOverlap.area <= thresholds.hudOverlapAreaMax
             ),
             nodesDoNotOverlap: nodePairOverlaps.every((item) => item.area <= thresholds.nodePairOverlapAreaMax),
             exactConnectedPorts: connectedPortMetrics.length === 5 && JSON.stringify(connectedKeys) === JSON.stringify([
               sourceId + ':output',
               derivedId + ':input',
               derivedId + ':output',
               targetId + ':input',
               variantId + ':input'
             ].sort()),
             connectedPortsUsable: connectedPortMetrics.every((item) => item.withinCanvas && item.diameter >= thresholds.portDiameterMin && item.hitTestOk),
             exactEdges: edgeMetrics.length === 3 && JSON.stringify(edgeKeys) === JSON.stringify([
               sourceId + '->' + derivedId,
               sourceId + '->' + variantId,
               derivedId + '->' + targetId
             ].sort()),
             exactRelations:
               relationByKey[sourceId + '->' + derivedId] === 'derived-from' &&
               relationByKey[sourceId + '->' + variantId] === 'variant' &&
               relationByKey[derivedId + '->' + targetId] === 'derived-from',
             edgesReadableAndInside: edgeMetrics.every((item) =>
               item.path && item.withinCanvas && item.totalLength >= thresholds.edgeScreenLengthMin &&
               item.strokeWidth >= thresholds.edgeStrokeWidthMin && item.opacity > 0 && item.stroke !== 'none' && item.stroke !== 'transparent'
             ),
             edgeEndpointsAligned: edgeMetrics.every((item) => item.sourceEndpointError <= thresholds.endpointErrorMax && item.targetEndpointError <= thresholds.endpointErrorMax),
             edgesAvoidUnrelatedNodes: edgeMetrics.every((item) => item.unrelatedNodeSampleHits.length === 0),
             selectedNodeStable: selectedIds.length === 1 && selectedIds[0] === derivedId,
             viewportScaleReadable: Number(viewport?.scale || 0) >= thresholds.viewportScaleMin && Number(viewport?.scale || 0) <= thresholds.viewportScaleMax
           };
           window.__iiimageProvenanceSceneProbe = {
             ok: Boolean(canvasBox && Object.values(checks).every(Boolean)),
             thresholds,
             checks,
             canvas: plainBox(canvasBox),
             hud: plainBox(hudBox),
             desiredPanY,
             availablePanY,
             appliedPanY,
             nodeMetrics,
             nodePairOverlaps,
             connectedPortMetrics,
             connectedKeys,
             edgeMetrics,
             edgeKeys,
             relationByKey,
             fixtureIds: { sourceId, derivedId, targetId, variantId },
             selectedIds,
             viewport
           };
         }
      `);
      const artifactContextCapture = await captureState(client, target.id, "project-agent-artifact-context-1280", artifactContextExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, projectAgentContextHasArtifact: true, selectedNodeHighlightVisibleOk: true, provenanceEdgeVisible: true, provenanceVariantEdgeVisible: true, provenanceConnectionPortsVisible: true, provenanceArrowAbsent: true, provenanceConnectionPortRuntimeOk: true, provenancePortStackingRuntimeOk: true, provenanceLegacyEdgeStyleOk: true, provenanceActiveEdgeFlowOk: true, provenanceSimpleStablePathOk: true, provenanceEdgeLayerBelowNodesOk: true, provenanceStablePathRuntimeOk: true, provenanceObstacleNoRerouteRuntimeOk: true, provenanceEdgeCreationOrderRuntimeOk: true, provenanceEdgeCrossingRuntimeOk: true, provenanceEdgeCrossingPaintRuntimeOk: true, selectedNodeZOrderStableOk: true, zOrderPersistenceContractOk: true, provenanceConnectedPortStateOk: true, provenanceSceneViewportOk: true, workflowRelationTypeRuntimeOk: true, autoImageRelationRuntimeOk: true });
      if (!artifactContextCapture.state?.zOrderDebugDataAvailable) {
        recordObservation("info", "z-order-debug-data-pending", {
         scene: artifactContextCapture.label,
         missingNodeIds: artifactContextCapture.state?.zOrderDebugDataMissingIds || [],
         requiredMainDebugFields: ["window.__iiimageDebugAgentState().nodes[].zOrder"],
          note: "DOM computed z-index and path stability are verified; persisted zOrder readback will activate automatically when the debug state exposes zOrder."
        });
      }
      if (!artifactContextCapture.state?.provenanceEdgeOrderRuntimeMetrics?.persistenceReloadVerified) {
        recordObservation("info", "edge-order-reload-proof-pending", {
          scene: artifactContextCapture.label,
          availableReloadApiKeys: artifactContextCapture.state?.provenanceEdgeOrderRuntimeMetrics?.reloadApiKeys || [],
          note: artifactContextCapture.state?.provenanceEdgeOrderRuntimeMetrics?.persistenceReloadGap || "No safe scoped persistence reload evidence is available in this scene."
        });
      }
       results.push(artifactContextCapture);
      {
        const originalPositions = artifactContextCapture.state?.provenanceEdgeOrderRuntimeMetrics?.originalPositions;
        if (originalPositions?.C && originalPositions?.D) {
          await evaluate(client, `(async () => {
            window.__iiimageDebugMoveNode?.({ id: ${JSON.stringify(String(originalPositions.C.id || ""))}, x: ${JSON.stringify(Number(originalPositions.C.x || 0))}, y: ${JSON.stringify(Number(originalPositions.C.y || 0))} });
            window.__iiimageDebugMoveNode?.({ id: ${JSON.stringify(String(originalPositions.D.id || ""))}, x: ${JSON.stringify(Number(originalPositions.D.x || 0))}, y: ${JSON.stringify(Number(originalPositions.D.y || 0))} });
            await window.__iiimageAIDebug?.fitCanvas?.();
            return true;
          })()`, 10000);
        }
      }
       const multiSelectionExpression = openSurfaceExpression("agent-timeline", `
        await window.__iiimageAIDebug?.fitCanvas?.();
        await delay(240);
        {
          const canvas = document.querySelector(".workflow-canvas");
          const nodes = Array.from(document.querySelectorAll(".flow-node")).slice(0, 2);
          const boxes = nodes.map((node) => node.getBoundingClientRect());
          const canvasBox = canvas?.getBoundingClientRect();
          const startX = Math.max((canvasBox?.left || 0) + 3, Math.min(...boxes.map((box) => box.left)) - 8);
          const startY = Math.max((canvasBox?.top || 0) + 3, Math.min(...boxes.map((box) => box.top)) - 8);
          const endX = Math.min((canvasBox?.right || innerWidth) - 3, Math.max(...boxes.map((box) => box.right)) + 8);
          const endY = Math.min((canvasBox?.bottom || innerHeight) - 3, Math.max(...boxes.map((box) => box.bottom)) + 8);
          canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 71, pointerType: "mouse", button: 1, buttons: 4, clientX: startX, clientY: startY }));
          window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 71, pointerType: "mouse", button: 1, buttons: 4, clientX: endX, clientY: endY }));
          window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 71, pointerType: "mouse", button: 1, buttons: 0, clientX: endX, clientY: endY }));
        }
        await delay(180);
        await window.__iiimageAIDebug?.fitCanvas?.();
        await delay(240);
        {
          const canvas = document.querySelector('.workflow-canvas');
          const canvasBox = canvas?.getBoundingClientRect();
          const hudBox = document.querySelector('.canvas-selection-indicator')?.getBoundingClientRect();
          const selectedBoxes = Array.from(document.querySelectorAll('.flow-node.selected')).map((node) => node.getBoundingClientRect());
          const top = selectedBoxes.length ? Math.min(...selectedBoxes.map((box) => box.top)) : 0;
          const bottom = selectedBoxes.length ? Math.max(...selectedBoxes.map((box) => box.bottom)) : 0;
          const desiredPanY = hudBox ? Math.max(0, hudBox.bottom + 12 - top) : 0;
          const availablePanY = canvasBox ? Math.max(0, canvasBox.bottom - 12 - bottom) : 0;
          const appliedPanY = Math.min(desiredPanY, availablePanY);
          if (canvas && appliedPanY > 0) {
            canvas.dispatchEvent(new CustomEvent('iiimage-debug-pan', { bubbles: true, detail: { dx: 0, dy: appliedPanY } }));
            await delay(180);
          }
          const finalHudBox = document.querySelector('.canvas-selection-indicator')?.getBoundingClientRect();
          const finalSelectedBoxes = Array.from(document.querySelectorAll('.flow-node.selected')).map((node) => ({
            id: node.getAttribute('data-node-id') || '',
            box: node.getBoundingClientRect()
          }));
          const overlapArea = (left, right) => {
            if (!left || !right) return 0;
            return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
          };
          window.__iiimageMultiSelectionSceneProbe = {
            ok: finalSelectedBoxes.length === 2 && finalSelectedBoxes.every((item) => overlapArea(finalHudBox, item.box) <= 4),
            desiredPanY,
            availablePanY,
            appliedPanY,
            selected: finalSelectedBoxes.map((item) => ({
              id: item.id,
              geometry: { left: item.box.left, top: item.box.top, right: item.box.right, bottom: item.box.bottom, width: item.box.width, height: item.box.height },
              hudOverlapArea: overlapArea(finalHudBox, item.box)
            }))
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-multi-selection-1280", multiSelectionExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, multiSelectionStateOk: true, multiSelectionSceneOk: true, selectedNodeHighlightVisibleOk: true }));
      const middleMarqueeSelectionExpression = openSurfaceExpression("agent-timeline", `
        {
          const canvas = document.querySelector('.workflow-canvas');
          const canvasBox = canvas?.getBoundingClientRect();
          const candidates = Array.from(document.querySelectorAll('.flow-node[data-node-id]')).filter((node) => {
            const box = node.getBoundingClientRect();
            return canvasBox && box.width > 20 && box.height > 20 && box.right >= canvasBox.left && box.left <= canvasBox.right && box.bottom >= canvasBox.top && box.top <= canvasBox.bottom;
          });
          const first = candidates[0];
          const second = candidates[1];
          const firstId = String(first?.dataset.nodeId || '');
          if (firstId) await window.__iiimageAIDebug?.selectNode?.({ id: firstId });
          await delay(120);
          const before = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const firstBox = first?.getBoundingClientRect();
          const secondBox = second?.getBoundingClientRect();
          const left = Math.max((canvasBox?.left || 0) + 2, Math.min(firstBox?.left || 0, secondBox?.left || 0) - 6);
          const top = Math.max((canvasBox?.top || 0) + 2, Math.min(firstBox?.top || 0, secondBox?.top || 0) - 6);
          const right = Math.min((canvasBox?.right || innerWidth) - 2, Math.max(firstBox?.right || 0, secondBox?.right || 0) + 6);
          const bottom = Math.min((canvasBox?.bottom || innerHeight) - 2, Math.max(firstBox?.bottom || 0, secondBox?.bottom || 0) + 6);
          const expected = Array.from(document.querySelectorAll('.flow-node[data-node-id]')).filter((node) => {
            const box = node.getBoundingClientRect();
            return box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom;
          }).map((node) => String(node.dataset.nodeId || '')).filter(Boolean);
          const pointerId = 79;
          canvas?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 1, buttons: 4, clientX: left, clientY: top }));
          window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 1, buttons: 4, clientX: right, clientY: bottom }));
          await delay(60);
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 1, buttons: 0, clientX: right, clientY: bottom }));
          await delay(160);
          const state = window.__iiimageDebugAgentState?.() || {};
          const after = [...(state.selectedNodeIds || [])];
          const highlighted = Array.from(document.querySelectorAll('.flow-node.selected[data-node-id]')).map((node) => String(node.dataset.nodeId || '')).filter(Boolean);
          const normalize = (ids) => [...new Set(ids)].sort();
          const expectedIds = normalize(expected);
          const afterIds = normalize(after);
          const highlightedIds = normalize(highlighted);
          window.__iiimageMiddleMarqueeSelectionProbe = {
            ok: Boolean(
              canvas && first && second && before.length === 1 && expectedIds.length >= 2 &&
              JSON.stringify(afterIds) === JSON.stringify(expectedIds) &&
              JSON.stringify(highlightedIds) === JSON.stringify(expectedIds) &&
              state.selectionMode === 'multiple' && state.selectionGesture === 'middle-marquee'
            ),
            before,
            expected: expectedIds,
            after: afterIds,
            highlighted: highlightedIds,
            selectionMode: state.selectionMode || '',
            selectionGesture: state.selectionGesture || '',
            rectangle: { left, top, right, bottom, width: right - left, height: bottom - top }
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-middle-marquee-selection-1280", middleMarqueeSelectionExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, middleMarqueeSelectionOk: true, multiSelectionStateOk: true, selectedNodeHighlightVisibleOk: true }));
      const ctrlNodeSelectionExpression = openSurfaceExpression("agent-timeline", `
        {
          const normalizeIds = (value) => [...new Set(String(value || '').split(/\\s+/).filter(Boolean))];
          const sameIds = (left, right) => left.length === right.length && left.every((id) => right.includes(id));
          const before = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const nodes = Array.from(document.querySelectorAll('.flow-node[data-node-id]'));
          const addNode = nodes.find((node) => !before.includes(String(node.dataset.nodeId || '')));
          const removeNode = nodes.find((node) => String(node.dataset.nodeId || '') === before[0]);
          const ctrlClick = async (node, pointerId) => {
            if (!node) return false;
            const box = node.getBoundingClientRect();
            const clientX = box.left + Math.min(36, box.width / 2);
            const clientY = box.top + Math.min(22, box.height / 2);
            node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ctrlKey: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX, clientY }));
            node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, ctrlKey: true, pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX, clientY }));
            node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0, buttons: 0, clientX, clientY }));
            await delay(120);
            return true;
          };
          const addId = String(addNode?.dataset.nodeId || '');
          const removeId = String(removeNode?.dataset.nodeId || '');
          const added = await ctrlClick(addNode, 76);
          const afterAdd = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const removed = await ctrlClick(removeNode, 77);
          const afterRemove = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          document.querySelector('.zoom-button')?.click();
          await delay(220);
          const highlightedIds = Array.from(document.querySelectorAll('.flow-node.selected[data-node-id]')).map((node) => String(node.dataset.nodeId || '')).filter(Boolean);
          const indicatorIds = normalizeIds(document.querySelector('.canvas-selection-indicator')?.getAttribute('data-selection-ids'));
          const composerIds = normalizeIds(document.querySelector('.project-agent-composer-context')?.getAttribute('data-selection-ids'));
          window.__iiimageCtrlNodeSelectionProbe = {
            ok: Boolean(
              before.length >= 2 && added && removed && addId && removeId &&
              afterAdd.length === before.length + 1 && before.every((id) => afterAdd.includes(id)) && afterAdd.includes(addId) &&
              afterRemove.length === before.length && !afterRemove.includes(removeId) && afterRemove.includes(addId) &&
              sameIds(highlightedIds, afterRemove) && sameIds(indicatorIds, afterRemove) && sameIds(composerIds, afterRemove)
            ),
            before,
            addId,
            removeId,
            afterAdd,
            afterRemove,
            highlightedIds,
            indicatorIds,
            composerIds
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-ctrl-node-selection-1280", ctrlNodeSelectionExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, ctrlNodeSelectionOk: true, multiSelectionStateOk: true, selectedNodeHighlightVisibleOk: true }));
      const canvasPanSelectionExpression = openSurfaceExpression("agent-timeline", `
        {
          const canvas = document.querySelector(".workflow-canvas");
          const box = canvas?.getBoundingClientRect();
          const stage = document.querySelector(".canvas-stage");
          const before = getComputedStyle(stage || document.body).transform;
          const selectionBefore = window.__iiimageDebugAgentState?.().selectedNodeIds || [];
          const x = (box?.left || 0) + 40;
          const y = (box?.bottom || innerHeight) - 80;
          canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 72, pointerType: "mouse", button: 0, buttons: 1, clientX: x, clientY: y }));
          window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 72, pointerType: "mouse", button: 0, buttons: 1, clientX: x + 42, clientY: y + 26 }));
          await delay(40);
          window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 72, pointerType: "mouse", button: 0, buttons: 0, clientX: x + 42, clientY: y + 26 }));
          await delay(80);
          const after = getComputedStyle(stage || document.body).transform;
          const selectionAfter = window.__iiimageDebugAgentState?.().selectedNodeIds || [];
          window.__iiimageCanvasLeftPanProbe = {
            before,
            after,
            moved: before !== after,
            selectionBefore,
            selectionAfter,
            selectionPreserved: JSON.stringify(selectionBefore) === JSON.stringify(selectionAfter)
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-selection-persistence-1280", canvasPanSelectionExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, canvasLeftPanSelectionOk: true, selectedNodeHighlightVisibleOk: true }));
      const stickySelectionExpression = openSurfaceExpression("agent-timeline", `
        {
          const before = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const selectedNode = document.querySelector('.flow-node[data-node-id="' + before[0] + '"]');
          const selectedHead = selectedNode?.querySelector('.node-head');
          const unselectedNode = Array.from(document.querySelectorAll('.flow-node[data-node-id]')).find((node) => !before.includes(String(node.dataset.nodeId || '')));
          const snapshots = [];
          const record = (label) => snapshots.push({ label, ids: [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])] });
          selectedNode?.click();
          record('click-selected');
          if (selectedNode && selectedHead) {
            const rect = selectedHead.getBoundingClientRect();
            selectedNode.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 0, buttons: 1, clientX: rect.left + 20, clientY: rect.top + 12 }));
            selectedNode.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 0, buttons: 1, clientX: rect.left + 30, clientY: rect.top + 18 }));
            selectedNode.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 0, buttons: 0, clientX: rect.left + 30, clientY: rect.top + 18 }));
          }
          await delay(90);
          record('drag-selected');
          selectedNode?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 320, clientY: 220 }));
          await delay(50);
          record('context-selected');
          document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 82, pointerType: 'mouse', button: 0, buttons: 1, clientX: 4, clientY: 4 }));
          selectedHead?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
          await delay(80);
          record('edit-selected');
          document.querySelector('.node-editor-dialog .ui-surface-close')?.click();
          unselectedNode?.click();
          await delay(80);
          record('click-unselected');
          window.__iiimageStickySelectionProbe = {
            ok: before.length >= 2 && snapshots.every((item) => JSON.stringify(item.ids) === JSON.stringify(before)),
            before,
            snapshots,
            unselectedId: unselectedNode?.dataset.nodeId || ''
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-sticky-multi-selection-1280", stickySelectionExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, stickyMultiSelectionOk: true, multiSelectionStateOk: true, selectedNodeHighlightVisibleOk: true }));
      const pruneSelectionExpression = openSurfaceExpression("agent-timeline", `
        {
          const before = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const removedId = before[1] || '';
          if (removedId) window.__iiimageDebugApplyAgentActions?.([{ type: 'workflow.node.delete', id: removedId, mode: 'only' }]);
          await delay(160);
          const after = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const expected = before.filter((id) => id !== removedId);
          window.__iiimageSelectionPruneProbe = {
            ok: Boolean(removedId && expected.length > 0 && JSON.stringify(after) === JSON.stringify(expected)),
            before,
            after,
            expected,
            removedId
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-selection-prune-1280", pruneSelectionExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, prunedMultiSelectionOk: true, selectedNodeHighlightVisibleOk: true }));
      const singleSelectionSwitchExpression = openSurfaceExpression("agent-timeline", `
        {
          const before = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const selectedId = before[0] || '';
          const unselectedNode = Array.from(document.querySelectorAll('.flow-node[data-node-id]')).find((node) => String(node.dataset.nodeId || '') !== selectedId);
          const unselectedId = String(unselectedNode?.dataset.nodeId || '');
          unselectedNode?.click();
          await delay(100);
          const switchedState = window.__iiimageDebugAgentState?.() || {};
          const afterSwitch = [...(switchedState.selectedNodeIds || [])];
          const highlightedAfterSwitch = Array.from(document.querySelectorAll('.flow-node.selected[data-node-id]')).map((node) => String(node.dataset.nodeId || '')).filter(Boolean);
          const switchedCard = document.querySelector('.project-agent-composer-context.has-artifact');
          const clearButton = switchedCard?.querySelector('button[aria-label="取消当前选中"]');
          clearButton?.click();
          await delay(100);
          const afterExplicitClear = [...(window.__iiimageDebugAgentState?.().selectedNodeIds || [])];
          const selectionUiHidden = Boolean(
            !document.querySelector('.project-agent-composer-context') &&
            !document.querySelector('.canvas-selection-indicator')
          );
          window.__iiimageSingleSelectionSwitchProbe = {
            ok: Boolean(
              before.length === 1 &&
              unselectedId && unselectedId !== selectedId &&
              afterSwitch.length === 1 && afterSwitch[0] === unselectedId &&
              highlightedAfterSwitch.length === 1 && highlightedAfterSwitch[0] === unselectedId &&
              switchedState.selectionMode === 'single' && switchedState.selectionGesture === 'plain-click' &&
              afterExplicitClear.length === 0 &&
              selectionUiHidden &&
              switchedCard && clearButton
            ),
            before,
            afterSwitch,
            highlightedAfterSwitch,
            afterExplicitClear,
            selectionUiHidden,
            unselectedId,
            selectionMode: switchedState.selectionMode || '',
            selectionGesture: switchedState.selectionGesture || '',
            switchedCardPresent: Boolean(switchedCard),
            clearButtonPresent: Boolean(clearButton)
          };
        }
      `);
      results.push(await captureState(client, target.id, "project-agent-single-selection-switch-1280", singleSelectionSwitchExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, singleSelectionSwitchOk: true, canvasSelectionStateOk: true }));
      const dragFixtureIntegrityBefore = fileIntegritySnapshot(dragFixturePaths);
     const imageContainerExpression = openSurfaceExpression("agent-timeline", `
        window.__iiimageDebugApplyAgentActions?.([{ type: "workflow.canvas.clear", mode: "all" }]);
        await delay(140);
       {
         const canvas = document.querySelector(".workflow-canvas");
         const box = canvas?.getBoundingClientRect();
         canvas?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: (box?.left || 0) + 180, clientY: (box?.top || 0) + 150, button: 2 }));
         await delay(140);
         window.__iiimageCanvasMenuProbe = { texts: Array.from(document.querySelectorAll(".canvas-context-menu button")).map((item) => String(item.textContent || "").replace(/\\s+/g, " ").trim()) };
          const createButton = Array.from(document.querySelectorAll(".canvas-context-menu button")).find((item) => String(item.textContent || "").includes("创建图片容器"));
          createButton?.click();
       }
        await delay(220);
       {
         const containerId = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.imageContainer)?.id || "";
          window.__iiimageLegacyContainerId = containerId;
          window.__iiimageContainerImportProbe = await window.__iiimageDebugImportPathsToCanvas?.({ paths: [${JSON.stringify(dragFixtureDir)}], targetContainerId: containerId });
          const importDeadline = Date.now() + 8000;
          let importedContainer = null;
          while (Date.now() < importDeadline) {
            importedContainer = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === containerId && node.imageContainer) || null;
            if (window.__iiimageContainerImportProbe?.ok && importedContainer?.assetCount === 2) break;
            await delay(40);
          }
          window.__iiimageContainerImportSettleProbe = {
            ok: Boolean(window.__iiimageContainerImportProbe?.ok && importedContainer?.assetCount === 2),
            containerId,
            assetCount: Number(importedContainer?.assetCount || 0),
            import: window.__iiimageContainerImportProbe || null
          };
       }
        {
          const before = window.__iiimageDebugAgentState?.();
          const container = before?.nodes?.find((node) => node.id === window.__iiimageLegacyContainerId && node.imageContainer);
          const assetKey = container?.assets?.[0]?.path || container?.assets?.[0]?.assetUrl || "";
          window.__iiimageContainerMoveProbe = await window.__iiimageDebugMoveContainerAsset?.({ sourceContainerId: container?.id || "", assetKey });
          await delay(360);
          const after = window.__iiimageDebugAgentState?.();
          const imported = after?.nodes?.filter((node) => node.type === "image" && node.imageContainer !== true && node.assetCount === 1 && node.assets?.some((asset) => /output[\\\\/]imagegen[\\\\/]imports/i.test(String(asset.path || "")))) || [];
          window.__iiimageContainerSplitProbe = {
            ok: Boolean(window.__iiimageContainerMoveProbe?.ok && imported.length === 2 && imported.some((node) => node.id === window.__iiimageLegacyContainerId)),
            nodeIds: imported.map((node) => node.id),
            assetPaths: imported.flatMap((node) => node.assets?.map((asset) => asset.path || "") || [])
          };
        }
        await delay(220);
        {
          const before = window.__iiimageDebugAgentState?.();
          const imported = before?.nodes?.filter((node) => node.type === "image" && node.imageContainer !== true && node.assetCount === 1 && node.assets?.some((asset) => /output[\\\\/]imagegen[\\\\/]imports/i.test(String(asset.path || "")))) || [];
          const target = imported.find((node) => node.id === window.__iiimageLegacyContainerId) || imported[0];
          const source = imported.find((node) => node.id !== target?.id);
          const assetKey = source?.assets?.[0]?.path || source?.assets?.[0]?.assetUrl || "";
          const beforeCausality = Object.fromEntries(imported.map((node) => [node.id, [node.parentId || "", node.relationType || ""]]));
          const result = await window.__iiimageAIDebug?.nativeAssetDrop?.({ sourceNodeId: source?.id || "", targetContainerId: target?.id || "", assetKey });
          await delay(420);
          const after = window.__iiimageDebugAgentState?.();
          const group = after?.layoutGroups?.find((item) => item.hostNodeId === target?.id && item.memberNodeIds?.includes(source?.id));
          const sourceRetained = after?.nodes?.some((node) => node.id === source?.id) === true;
          const causalityPreserved = after?.nodes?.filter((node) => beforeCausality[node.id]).every((node) => beforeCausality[node.id][0] === (node.parentId || "") && beforeCausality[node.id][1] === (node.relationType || ""));
          window.__iiimageContainerGroupProbe = {
            ok: Boolean(result?.ok && sourceRetained && causalityPreserved && group?.memberNodeIds?.join(",") === [target?.id, source?.id].join(",")),
            result,
            targetId: target?.id || "",
            sourceId: source?.id || "",
            sourceRetained,
            causalityPreserved,
            group: group ? { ...group, memberNodeIds: [...group.memberNodeIds] } : null
          };
        }
        await delay(220);
        {
          const group = window.__iiimageContainerGroupProbe?.group;
          const containerId = group?.hostNodeId || "";
           const roleResult = await window.__iiimageAIDebug?.setContainerRole?.({ id: containerId, role: "reference" });
           await delay(220);
           window.__iiimageContainerAgentRunProbe = await window.__iiimageAIDebug?.runTool?.({
             name: "image_gen",
             selectedNodeId: containerId,
             input: { operation: "generate", parentId: containerId, prompt: "参考当前图片容器生成一张测试图。", ratio: "1:1", resolution: "720P", count: 1, quality: "auto", brief: "验证容器路径自动进入 Agent 参考图。" }
           });
            await delay(360);
           const generated = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.parentId === containerId && /referenceImages:\\s*2/i.test(String(node.prompt || "")));
           const referenceMatch = String(generated?.prompt || "").match(/referenceImages:\\s*(\\d+)/i);
           window.__iiimageContainerAgentProbe = {
             ok: Boolean(window.__iiimageContainerAgentRunProbe?.ok && generated && Number(referenceMatch?.[1] || 0) === 2),
             roleSet: roleResult?.ok === true,
             selectedNodeId: containerId,
             actionCount: Number(window.__iiimageContainerAgentRunProbe?.actionCount || 0),
             generatedId: generated?.id || "",
             generatedParentId: generated?.parentId || "",
             generatedRelationType: generated?.relationType || "",
             referenceImageCount: Number(referenceMatch?.[1] || 0),
             envelopeSummary: String(window.__iiimageContainerAgentRunProbe?.envelope?.summary || "")
           };
          if (generated?.id) window.__iiimageDebugApplyAgentActions?.([{ type: "workflow.node.delete", id: generated.id, mode: "only" }]);
        }
        await delay(220);
        {
          const before = window.__iiimageDebugAgentState?.();
          const group = before?.layoutGroups?.find((item) => item.id === window.__iiimageContainerGroupProbe?.group?.id);
          const memberId = group?.memberNodeIds?.find((id) => id !== group.hostNodeId) || "";
           const member = before?.nodes?.find((node) => node.id === memberId);
           const assetKey = member?.assets?.[0]?.path || member?.assets?.[0]?.assetUrl || "";
           const beforeCausality = Object.fromEntries(before?.nodes?.map((node) => [node.id, [node.parentId || "", node.relationType || ""]]) || []);
           const canvas = document.querySelector(".workflow-canvas");
           const canvasBox = canvas?.getBoundingClientRect();
           const hostBox = document.querySelector('.flow-node[data-node-id="' + String(group?.hostNodeId || '') + '"]')?.getBoundingClientRect();
           const hostCenterX = (hostBox?.left || 0) + (hostBox?.width || 0) / 2;
           const hostCenterY = (hostBox?.top || 0) + (hostBox?.height || 0) / 2;
           const canvasCenterX = (canvasBox?.left || 0) + (canvasBox?.width || 0) / 2;
           const canvasCenterY = (canvasBox?.top || 0) + (canvasBox?.height || 0) / 2;
           const extractionClientX = hostCenterX <= canvasCenterX
             ? (canvasBox?.right || window.innerWidth) - 72
             : (canvasBox?.left || 0) + 72;
           const extractionClientY = hostCenterY <= canvasCenterY
             ? (canvasBox?.bottom || window.innerHeight) - 72
             : (canvasBox?.top || 0) + 72;
           const result = await window.__iiimageDebugMoveContainerAsset?.({
             sourceContainerId: memberId,
             assetKey,
             clientX: extractionClientX,
             clientY: extractionClientY
           });
            // The product deliberately performs a short focus settle after extracting a
            // node. Let that bounded animation finish before fitting both nodes for the
            // second, real pointer-drag regroup gesture.
            await delay(640);
           const after = window.__iiimageDebugAgentState?.();
           const groupRemoved = !after?.layoutGroups?.some((item) => item.id === group?.id);
           const sourceRetained = after?.nodes?.some((node) => node.id === memberId) === true;
           const causalityPreserved = after?.nodes?.filter((node) => beforeCausality[node.id]).every((node) => beforeCausality[node.id][0] === (node.parentId || "") && beforeCausality[node.id][1] === (node.relationType || ""));
           const extractedMember = after?.nodes?.find((node) => node.id === memberId);
           const extractedHost = after?.nodes?.find((node) => node.id === group?.hostNodeId);
           const separatedDistance = extractedMember && extractedHost
             ? Math.hypot(Number(extractedMember.x || 0) - Number(extractedHost.x || 0), Number(extractedMember.y || 0) - Number(extractedHost.y || 0))
             : 0;
           window.__iiimageContainerDissolveProbe = {
             ok: Boolean(result?.ok && group?.memberNodeIds?.length === 2 && groupRemoved && sourceRetained && causalityPreserved && separatedDistance >= 18),
             result,
             groupRemoved,
             sourceRetained,
             causalityPreserved,
             extractionClientX,
             extractionClientY,
             separatedDistance
           };
           await window.__iiimageAIDebug?.fitCanvas?.();
           await delay(420);
           const regroup = await window.__iiimageAIDebug?.nativeAssetDrop?.({ sourceNodeId: memberId, targetContainerId: group?.hostNodeId || "", assetKey });
          await delay(420);
          const finalState = window.__iiimageDebugAgentState?.();
          const finalGroup = finalState?.layoutGroups?.find((item) => item.hostNodeId === group?.hostNodeId && item.memberNodeIds?.includes(memberId));
          window.__iiimageContainerFinalGroupProbe = {
            ok: Boolean(regroup?.ok && finalGroup?.memberNodeIds?.join(",") === [group?.hostNodeId, memberId].join(",")),
            regroup,
            group: finalGroup ? { ...finalGroup, memberNodeIds: [...finalGroup.memberNodeIds] } : null
          };
        }
        await delay(220);
       window.__iiimageReferenceDropProbe = await window.__iiimageDebugImportPathsAsReferences?.({ paths: [${JSON.stringify(dragFixtureDir)}] });
       await delay(260);
        document.querySelector(".project-agent-references")?.click();
        await delay(180);
        window.__iiimageReferenceCapacityProbe = { slots: document.querySelectorAll(".reference-picker-dialog .reference-slot").length };
        const referencePickerClose = document.querySelector('[data-ui-surface="reference-picker"] .ui-surface-close');
        referencePickerClose?.click();
        const referencePickerCloseDeadline = Date.now() + 3000;
        while (Date.now() < referencePickerCloseDeadline && document.querySelector('[data-ui-surface="reference-picker"]')) await delay(40);
        window.__iiimageReferencePickerCloseProbe = {
          ok: Boolean(referencePickerClose && !document.querySelector('[data-ui-surface="reference-picker"]')),
          closeButtonPresent: Boolean(referencePickerClose),
          pickerStillOpen: Boolean(document.querySelector('[data-ui-surface="reference-picker"]'))
        };
        await delay(380);
      `);
      const imageContainerCapture = await captureState(client, target.id, "project-image-container-import-1280", imageContainerExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, imageContainerRuntimeOk: true, imageContainerGridOk: true, imageResultContainerCoreOk: true, imageLibraryPathsOk: true, imageLayoutSourcesRetainedOk: true, imageLayoutCausalityOk: true, imageLayoutAutoDissolveOk: true, canvasImageContainerActionVisible: true, referenceContainerDropOk: true, referenceCapacityNineOk: true, referencePickerClosedOk: true, imageContainerAgentReferenceOk: true, referenceDropNoInlineThumbsOk: true });
      const imageContainerSessionPath = join(aidebugConfigDir, "projects", "default", "session.json");
      const imageContainerSessionSnapshotPath = join(runDir, "image-container-session.json");
      let imageContainerPersistence = { ok: false, path: imageContainerSessionPath, snapshotPath: imageContainerSessionSnapshotPath, error: "session not saved" };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          if (existsSync(imageContainerSessionPath)) {
            const session = JSON.parse(readFileSync(imageContainerSessionPath, "utf8"));
             const imageNodes = Array.isArray(session?.nodes) ? session.nodes.filter((node) => node?.type === "image") : [];
             const containerNodes = imageNodes.filter((node) => node?.imageContainer === true);
             const layoutGroups = Array.isArray(session?.layoutGroups) ? session.layoutGroups : [];
             const layoutGroup = layoutGroups[0] || null;
             const groupedNodes = layoutGroup?.memberNodeIds?.map((id) => imageNodes.find((node) => node.id === id)).filter(Boolean) || [];
             const assets = groupedNodes.flatMap((node) => Array.isArray(node?.assets) ? node.assets : []);
             const canonicalHost = groupedNodes.find((node) => node.id === layoutGroup?.hostNodeId) || null;
             const canonicalHostSpec = canonicalHost?.imageContainerSpec && typeof canonicalHost.imageContainerSpec === "object"
               ? canonicalHost.imageContainerSpec
               : null;
             const memberOrderOk = Boolean(
               layoutGroups.length === 1 && layoutGroup?.memberNodeIds?.length === 2 &&
               layoutGroup.hostNodeId === layoutGroup.memberNodeIds[0] &&
               layoutGroup.memberNodeIds.every((id) => groupedNodes.some((node) => node.id === id))
             );
             const canonicalHostOk = Boolean(
               containerNodes.length === 1 && canonicalHost?.id === containerNodes[0]?.id &&
               canonicalHost?.imageContainerRole === "reference" &&
               canonicalHostSpec?.kind === "manual" &&
               canonicalHostSpec?.layoutId === layoutGroup?.id &&
               JSON.stringify(canonicalHostSpec?.memberNodeIds || []) === JSON.stringify(layoutGroup?.memberNodeIds?.slice(1) || []) &&
               Array.isArray(canonicalHostSpec?.memberBindings) && canonicalHostSpec.memberBindings.length === 2
             );
             const sourcesRetained = groupedNodes.length === 2 && groupedNodes.every((node) => !node.parentId && !node.relationType);
            const originalIntegrityAfter = fileIntegritySnapshot(dragFixturePaths);
            const originalIntegrityOk = JSON.stringify(originalIntegrityAfter) === JSON.stringify(dragFixtureIntegrityBefore);
            const copiedHashes = assets.map((asset) => String(asset?.path || "")).filter((assetPath) => existsSync(assetPath)).map(fileSha256).sort();
            const sourceHashes = dragFixtureIntegrityBefore.filter((item) => item.exists).map((item) => item.sha256).sort();
            const copiedHashesOk = copiedHashes.length === sourceHashes.length && JSON.stringify(copiedHashes) === JSON.stringify(sourceHashes);
            const ok = Boolean(
               Number(session?.schemaVersion || 0) >= 2 &&
               canonicalHostOk &&
               sourcesRetained && memberOrderOk &&
              assets.length === 2 &&
              assets.every((asset) => existsSync(String(asset?.path || "")) && /output[\\/]imagegen[\\/]imports/i.test(String(asset?.path || ""))) &&
              originalIntegrityOk && copiedHashesOk
            );
            imageContainerPersistence = {
              ok,
              path: imageContainerSessionPath,
              snapshotPath: imageContainerSessionSnapshotPath,
               schemaVersion: Number(session?.schemaVersion || 0),
               containerCount: containerNodes.length,
               importedNodeCount: groupedNodes.length,
               layoutGroupCount: layoutGroups.length,
               layoutGroup,
               memberOrderOk,
               canonicalHostOk,
              sourcesRetained,
              assetCount: assets.length,
              originalIntegrityOk,
              originalIntegrityBefore: dragFixtureIntegrityBefore,
              originalIntegrityAfter,
              copiedHashesOk,
              error: ok ? "" : "layoutGroups non-destructive persistence metadata incomplete"
            };
            if (ok) {
              copyFileSync(imageContainerSessionPath, imageContainerSessionSnapshotPath);
              break;
            }
          }
        } catch (error) {
          imageContainerPersistence = { ...imageContainerPersistence, error: error instanceof Error ? error.message : String(error) };
        }
        await delay(100);
      }
      imageContainerCapture.state.imageContainerPersistenceOk = imageContainerPersistence.ok;
      imageContainerCapture.imageContainerPersistence = imageContainerPersistence;
      if (!imageContainerPersistence.ok) imageContainerCapture.stateIssues.push({ key: "imageContainerPersistenceOk", expected: true, actual: false });
      results.push(imageContainerCapture);
     const layeredPngExpression = openSurfaceExpression("agent-timeline", `
        window.__iiimageDebugApplyAgentActions?.([{ type: "workflow.canvas.clear", mode: "all" }]);
        await delay(120);
        window.__iiimageLayersProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "image_gen",
          input: {
            operation: "layers",
            prompt: "AIDebug 蓝色玻璃香水瓶产品海报，柔和摄影棚光线。",
            ratio: "1:1",
            resolution: "720P",
            quality: "auto",
            layerPlan: [
              { id: "background", title: "背景", role: "background", prompt: "摄影棚渐变背景", transparent: false },
              { id: "product", title: "香水瓶", role: "subject", prompt: "蓝色玻璃香水瓶主体", transparent: true },
              { id: "light", title: "光效", role: "foreground", prompt: "前景柔和光斑", transparent: true }
            ],
            brief: "验证分层 PNG、透明图层和重组预览。"
          }
        });
        const layerDeadline = Date.now() + 45000;
        let layerState = window.__iiimageAIDebug?.layerState?.() || { selectedNodeId: "", nodes: [] };
        while (Date.now() < layerDeadline && !(layerState.nodes.length === 3 && layerState.nodes.every((node) => node.assetCount === 1))) {
          await delay(180);
          layerState = window.__iiimageAIDebug?.layerState?.() || { selectedNodeId: "", nodes: [] };
        }
        window.__iiimageLayerStateProbe = layerState;
        const menuNodeId = layerState.selectedNodeId || layerState.nodes.at(-1)?.id || "";
        await delay(240);
        window.__iiimageLayerMenuProbe = await window.__iiimageAIDebug?.openNodeMenu?.({ id: menuNodeId });
        await delay(160);
      `);
      const layeredCapture = await captureState(client, target.id, "project-agent-layered-png-1280", layeredPngExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, layerPngRuntimeOk: true, layerFolderActionVisible: true });
      const layeredSessionPath = join(aidebugConfigDir, "projects", "default", "session.json");
      const layeredSessionSnapshotPath = join(runDir, "layered-session.json");
      let layerSessionPersistence = { ok: false, path: layeredSessionPath, snapshotPath: layeredSessionSnapshotPath, roles: [], error: "session not saved" };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          if (existsSync(layeredSessionPath)) {
            const session = JSON.parse(readFileSync(layeredSessionPath, "utf8"));
            const layerNodes = Array.isArray(session?.nodes)
              ? session.nodes.filter((node) => node?.layerGroup?.id)
              : [];
            const roles = layerNodes.map((node) => String(node?.layerGroup?.role || "")).filter(Boolean);
            const groupIds = Array.from(new Set(layerNodes.map((node) => String(node?.layerGroup?.id || "")).filter(Boolean)));
            const requiredRoles = ["background", "subject", "foreground"];
            const layerAssets = layerNodes.map((node) => node?.assets?.[0]).filter(Boolean);
            const previewAsset = layerNodes[0]?.layerGroup?.previewAsset;
            const mergedAsset = layerNodes[0]?.layerGroup?.mergedAsset;
            const anchors = new Set(layerNodes.map((node) => `${node?.x}:${node?.y}`));
            const ok = Boolean(
              layerNodes.length === 3 &&
              new Set(layerNodes.map((node) => node?.id)).size === 3 &&
              anchors.size === 1 &&
              layerNodes.every((node, index) =>
                node?.type === "image" &&
                node?.imageParams?.outputFormat === "png" &&
                node?.layerGroup?.order === index + 1 &&
                node?.layerGroup?.total === 3 &&
                node?.layerGroup?.detached === false &&
                !node?.layerComposition &&
                node?.assets?.length === 1
              ) &&
              groupIds.length === 1 &&
              requiredRoles.every((role) => roles.includes(role)) &&
              layerAssets.length === requiredRoles.length &&
              [...layerAssets, previewAsset, mergedAsset].every((asset) => asset?.path && existsSync(String(asset.path)) && /\.png$/i.test(String(asset.path)))
            );
            layerSessionPersistence = { ok, path: layeredSessionPath, snapshotPath: layeredSessionSnapshotPath, roles, groupIds, anchors: [...anchors], nodeCount: layerNodes.length, error: ok ? "" : "independent layer node metadata incomplete" };
            if (ok) {
              copyFileSync(layeredSessionPath, layeredSessionSnapshotPath);
              break;
            }
          }
        } catch (error) {
          layerSessionPersistence = { ...layerSessionPersistence, error: error instanceof Error ? error.message : String(error) };
        }
        await delay(100);
      }
      layeredCapture.state.layerSessionPersistenceOk = layerSessionPersistence.ok;
      layeredCapture.layerSessionPersistence = layerSessionPersistence;
      if (!layerSessionPersistence.ok) {
        layeredCapture.stateIssues.push({ key: "layerSessionPersistenceOk", expected: true, actual: false });
      }
      results.push(layeredCapture);
      const editVariantsExpression = openSurfaceExpression("agent-timeline", `
        window.__iiimageDebugApplyAgentActions?.([{ type: "workflow.canvas.clear", mode: "all" }]);
        await delay(120);
        window.__iiimageEditSourceProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "image_gen",
          input: { operation: "generate", prompt: "AIDebug 蓝色运动鞋产品图。", ratio: "1:1", resolution: "720P", count: 1, quality: "auto", brief: "生成款式来源图。" }
        });
        await delay(260);
        window.__iiimageEditSourceId = window.__iiimageDebugAgentState?.().selectedNodeId || "";
        window.__iiimageVariantsProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "image_gen",
          selectedNodeId: window.__iiimageEditSourceId,
          input: { operation: "variants", parentId: window.__iiimageEditSourceId, prompt: "设计四种不同鞋带和配色款式，保持鞋型一致。", ratio: "1:1", resolution: "720P", count: 4, quality: "auto", brief: "生成四种独立款式。" }
        });
        await delay(320);
        window.__iiimageReplaceProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "image_gen",
          selectedNodeId: window.__iiimageEditSourceId,
          input: { operation: "replace", parentId: window.__iiimageEditSourceId, prompt: "把鞋带替换成红色丝带，其他区域保持不变。", ratio: "1:1", resolution: "720P", count: 1, quality: "auto", brief: "替换鞋带元素。" }
        });
        await delay(420);
        const referenceSource = window.__iiimageDebugAgentState?.().nodes?.find((node) => node.id === window.__iiimageEditSourceId)?.assets?.[0];
        window.__iiimageReferenceProbe = await window.__iiimageAIDebug?.runTool?.({
          name: "image_gen",
          selectedNodeId: "",
          referenceImages: referenceSource?.path ? [{ name: "aidebug-reference.png", path: referenceSource.path, mimeType: "image/png" }] : [],
          input: { operation: "generate", prompt: "参考附件生成一个蓝紫色版本。", ratio: "1:1", resolution: "720P", count: 1, quality: "auto", brief: "验证参考图附件自动注入。" }
        });
        await delay(320);
      `);
      results.push(await captureState(client, target.id, "project-agent-edit-variants-1280", editVariantsExpression, { width: 1280, height: 820 }, { ...fixedAgentExpected, variantsRuntimeOk: true, replaceRuntimeOk: true, referenceImageRuntimeOk: true, provenanceEdgeVisible: true, provenanceVariantEdgeVisible: true }));
      results.push(await captureState(client, target.id, "project-agent-running-1280", openSurfaceExpression("agent-running"), { width: 1280, height: 820 }, { ...fixedAgentExpected, agentBusy: true, stopButtonOk: true }));
      const imageRunningExpected = { ...fixedAgentExpected, agentBusy: true, stopButtonOk: true, agentImageGenTimerVisible: true, agentImageGenTimerPositionOk: true, agentImageGenTimerOk: true, agentImageGenSingleDynamicStatusOk: true, agentToolPromptFoldOk: true, agentToolBriefVisible: true };
      results.push(await captureState(client, target.id, "project-agent-image-running-1280", openSurfaceExpression("agent-image-running"), { width: 1280, height: 820 }, imageRunningExpected));
      results.push(await captureState(client, target.id, "project-agent-image-running-min-884", openSurfaceExpression("agent-image-running"), { width: workbenchMinWidth, height: 720 }, { ...imageRunningExpected, imageNodeViewportOk: true }));
      const isolationExpression = openSurfaceExpression("agent-timeline", `
        {
          const stateBefore = window.__iiimageDebugAgentState?.();
          const clearSentinel = "AIDebug-clear-scope-" + Date.now();
          const clearWrite = await window.__iiimageAIDebug?.chat?.(
            "请调用 experience 记录这条绘画经验，标题是清理隔离专项，内容是：" + clearSentinel,
            { timeoutMs: 20000 }
          );
          await delay(180);
          const experienceUiText = String(document.querySelector(".project-agent-feed")?.textContent || "").replace(/\\s+/g, " ").trim();
          const experienceStartCard = Array.from(document.querySelectorAll('.agent-tool-trace[data-tool-stage="start"]')).find((node) => String(node.textContent || "").includes("Experience"));
          const experienceResultCard = Array.from(document.querySelectorAll('.agent-tool-trace[data-tool-stage="result"]')).find((node) => String(node.textContent || "").includes("Experience") && String(node.textContent || "").includes("记录经验成功"));
          const experienceUiOk = Boolean(
            experienceStartCard && experienceResultCard && experienceUiText.includes("Experience") && experienceUiText.includes("记录经验成功") &&
            !/fmem-|entry[_ ]?id|selector|sourceEntryIds|keywords|context_manage/i.test(experienceUiText)
          );
          const clearButton = document.querySelector('button[title="清理当前聊天和绘画经验"]');
          clearButton?.click();
          await delay(120);
          document.querySelector(".confirm-dialog footer button:last-child")?.click();
          await delay(420);
          const stateAfterClear = window.__iiimageDebugAgentState?.();
          const clearRead = await window.__iiimageAIDebug?.runTool?.({
            name: "experience",
            input: { action: "read", brief: "验证当前会话经验已清除。" }
          });
          const clearOutput = String(clearRead?.envelope?.visibleOutput || clearRead?.envelope?.summary || "");
          window.__iiimageIsolationProbe = {
            clear: {
              ok: Boolean(
                clearWrite?.ok &&
                experienceUiOk &&
                stateAfterClear?.activeConversationId === stateBefore?.activeConversationId &&
                stateAfterClear?.messageCount === 0 &&
                stateAfterClear?.nodeCount === stateBefore?.nodeCount &&
                !clearOutput.includes(clearSentinel)
              ),
              conversationId: stateAfterClear?.activeConversationId,
              messageCount: stateAfterClear?.messageCount,
              nodeCountBefore: stateBefore?.nodeCount,
              nodeCountAfter: stateAfterClear?.nodeCount,
              clearedSentinelAbsent: !clearOutput.includes(clearSentinel),
              experienceUiOk
            }
          };

          const conversationSentinel = "AIDebug-conversation-scope-" + Date.now();
          const conversationWrite = await window.__iiimageAIDebug?.runTool?.({
            name: "experience",
            input: { action: "add", title: "会话隔离专项", text: conversationSentinel, rating: "note", brief: "记录旧会话专项经验。" }
          });
          const beforeConversation = window.__iiimageDebugAgentState?.();
          document.querySelector('button[title="新建会话"]')?.click();
          await delay(120);
          document.querySelector(".confirm-dialog footer button:last-child")?.click();
          await delay(320);
          const afterConversation = window.__iiimageDebugAgentState?.();
          const conversationRead = await window.__iiimageAIDebug?.runTool?.({
            name: "experience",
            input: { action: "read", brief: "验证新会话没有旧经验。" }
          });
          const conversationOutput = String(conversationRead?.envelope?.visibleOutput || conversationRead?.envelope?.summary || "");
          window.__iiimageIsolationProbe.conversation = {
            ok: Boolean(
              conversationWrite?.ok &&
              afterConversation?.activeConversationId &&
              afterConversation.activeConversationId !== beforeConversation?.activeConversationId &&
              afterConversation?.messageCount === 0 &&
              afterConversation?.nodeCount === beforeConversation?.nodeCount &&
              !conversationOutput.includes(conversationSentinel)
            ),
            previousConversationId: beforeConversation?.activeConversationId,
            activeConversationId: afterConversation?.activeConversationId,
            messageCount: afterConversation?.messageCount,
            nodeCountBefore: beforeConversation?.nodeCount,
            nodeCountAfter: afterConversation?.nodeCount,
            oldSentinelAbsent: !conversationOutput.includes(conversationSentinel)
          };

          const projectSentinel = "AIDebug-project-scope-" + Date.now();
          const projectWrite = await window.__iiimageAIDebug?.runTool?.({
            name: "experience",
            input: { action: "add", title: "项目隔离专项", text: projectSentinel, rating: "note", brief: "记录旧项目专项经验。" }
          });
          const beforeProject = window.__iiimageDebugAgentState?.();
          const newProjectButton = Array.from(document.querySelectorAll("button")).find((button) => String(button.textContent || "").replace(/\\s+/g, " ").trim() === "新建项目");
          newProjectButton?.click();
          await delay(140);
          const projectInput = document.querySelector(".project-create-dialog input");
          if (projectInput) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(projectInput, "AIDebug 隔离项目 " + Date.now());
            projectInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
          await delay(80);
          const createProjectButton = Array.from(document.querySelectorAll(".project-create-dialog button")).find((button) => String(button.textContent || "").includes("创建"));
          createProjectButton?.click();
          await delay(720);
          const afterProject = window.__iiimageDebugAgentState?.();
          const projectRead = await window.__iiimageAIDebug?.runTool?.({
            name: "experience",
            input: { action: "read", brief: "验证新项目没有旧经验。" }
          });
          const projectOutput = String(projectRead?.envelope?.visibleOutput || projectRead?.envelope?.summary || "");
          window.__iiimageIsolationProbe.project = {
            ok: Boolean(
              projectWrite?.ok &&
              afterProject?.activeProjectId &&
              afterProject.activeProjectId !== beforeProject?.activeProjectId &&
              afterProject?.activeConversationId !== beforeProject?.activeConversationId &&
              afterProject?.nodeCount === 0 &&
              afterProject?.messageCount === 0 &&
              !projectOutput.includes(projectSentinel)
            ),
            previousProjectId: beforeProject?.activeProjectId,
            activeProjectId: afterProject?.activeProjectId,
            previousConversationId: beforeProject?.activeConversationId,
            activeConversationId: afterProject?.activeConversationId,
            nodeCount: afterProject?.nodeCount,
            messageCount: afterProject?.messageCount,
            oldSentinelAbsent: !projectOutput.includes(projectSentinel)
          };
        }
      `);
      results.push(await captureState(client, target.id, "agent-conversation-project-isolation-1280", isolationExpression, { width: 1280, height: 820 }, {
        ...fixedAgentExpected,
        timelineNodesVisible: false,
        conversationClearIsolationOk: true,
        newConversationIsolationOk: true,
        newProjectIsolationOk: true
      }));
      appendNonVisualSelfChecks(results);
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "agent-only", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "agent-only", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    if (!legacyFullSuite) {
      const mainExpected = {
        settingsOpen: false,
        historyOpen: false,
        modalOpen: false,
        accountOpen: false,
        titlebarOverlay: true,
        workbenchMinWidthOk: true,
        titlebarBrandVisible: true,
        accountAvatarCircular: true,
        rightCollapseAligned: true,
        oldAgentPanelUnmounted: true,
        agentPanelVisible: true,
        projectAgentFixedOk: true,
        projectAgentContextVisible: true,
        canvasSelectionIndicatorVisibleOk: true,
        canvasSelectionIndicatorGeometryOk: true,
        selectionSurfacesConsistentOk: true,
        agentCoreNodeAbsent: true,
        manualWorkflowControlsAbsent: true,
        imageTaskButtonsVisibleOk: true,
        imageTaskButtonStateOk: true,
        publicAgentToolSchemaOk: true,
        topbarCanvasActionLabelsOk: true,
        topbarCanvasActionsFitOk: true,
        emptyCanvasArtifactOnlyOk: true,
        canvasSelectionStateOk: true,
        canvasToolbarAbsent: true,
        canvasStatusDockedBottom: true,
        canvasZoomDockedBottom: true,
        canvasViewportFillOk: true,
        settingsChannelHidden: true,
        agentDebugReady: true,
        agentBridgeReady: true,
        canvasReadabilityOk: true,
        compactMainGridOk: true
      };
      const projectAgentExpected = {
        settingsOpen: false,
        historyOpen: false,
        modalOpen: false,
        accountOpen: false,
        titlebarOverlay: true,
        workbenchMinWidthOk: true,
        oldAgentPanelUnmounted: true,
        agentPanelVisible: true,
        projectAgentFixedOk: true,
        projectAgentContextVisible: true,
        canvasSelectionIndicatorVisibleOk: true,
        canvasSelectionIndicatorGeometryOk: true,
        selectionSurfacesConsistentOk: true,
        canvasSelectionStateOk: true,
        agentCoreNodeAbsent: true,
        manualWorkflowControlsAbsent: true,
        timelineNodesVisible: true,
        composerTextareaTall: true,
        composerControlsVisibleOk: true,
        composerViewportVisibleOk: true,
        canvasToolbarAbsent: true,
        canvasStatusDockedBottom: true,
        canvasZoomDockedBottom: true,
        canvasViewportFillOk: true
      };
      results.push(await captureState(client, target.id, "main-1280", openSurfaceExpression("main"), { width: 1280, height: 820 }, mainExpected));
      results.push(await captureState(client, target.id, "main-min-884", openSurfaceExpression("main"), { width: workbenchMinWidth, height: 720 }, { ...mainExpected, canvasVisible: true, imageNodeViewportOk: true }));
      results.push(await captureState(client, target.id, "project-agent-1280", openSurfaceExpression("agent-timeline"), { width: 1280, height: 820 }, projectAgentExpected));
      results.push(await captureState(client, target.id, "project-agent-min-884", openSurfaceExpression("agent-timeline"), { width: workbenchMinWidth, height: 720 }, { ...projectAgentExpected, imageNodeViewportOk: true }));
      const settingsExpected = { settingsOpen: true, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, workbenchMinWidthOk: true, oldAgentPanelUnmounted: true, settingsChannelHidden: true, settingsThemeCopyRemovedOk: true, settingsBoxless: true, settingsRowsAiry: true, settingsHeaderCompactOk: true, settingsHeaderBreathingOk: true, settingsDrawerBreathingOk: true, settingsDrawerFlushRightOk: true, settingsDrawerWidthOk: true, settingsDrawerUiOk: true, settingsLabelsOk: true, settingsSaveControlsOk: true, settingsUpdateCenterOk: true, modelFetchButtonTextOk: true, modelFetchButtonRightOk: true, modelFetchButtonAlignedOk: true, settingsPromptActionFlowOk: true, canvasToolbarAbsent: true, canvasStatusDockedBottom: true, canvasZoomDockedBottom: true, canvasViewportFillOk: true };
      const modelPickerExpression = openSurfaceExpression("model-config", `
        {
          await window.iiimageServer?.models?.();
          const standard = [];
          for (let index = 0; index < 5; index += 1) standard.push(await window.iiimageServer?.models?.({ forceRefresh: false }));
          const forced = await window.iiimageServer?.models?.({ forceRefresh: true });
          const afterForce = await window.iiimageServer?.models?.({ forceRefresh: false });
          const agentFirst = await window.iiimageAgent?.listModels?.({ provider: "agent", settings: {} });
          const agentSecond = await window.iiimageAgent?.listModels?.({ provider: "agent", settings: {} });
          const latest = afterForce || standard[standard.length - 1];
          const full = [...(latest?.settings?.models || []), ...(latest?.settings?.agentModels || []), ...(latest?.settings?.imageModels || [])];
          window.__iiimageModelCacheProbe = {
            ok: Boolean(standard.every((item) => item?.ok) && forced?.ok && afterForce?.ok && agentFirst?.ok && agentSecond?.ok),
            firstSource: standard[0]?.settings?.cacheSource || "",
            secondSource: standard[1]?.settings?.cacheSource || "",
            standardSources: standard.map((item) => item?.settings?.cacheSource || ""),
            forceSource: forced?.settings?.cacheSource || "",
            afterForceSource: afterForce?.settings?.cacheSource || "",
            agentFirstSource: agentFirst?.cacheSource || "",
            agentSecondSource: agentSecond?.cacheSource || "",
            count: new Set(full).size
          };
          await delay(180);
          document.querySelector(".settings-model-config-action")?.click();
          const optionDeadline = Date.now() + 1800;
          while (Date.now() < optionDeadline && document.querySelectorAll(".model-picker-option").length < 15) await delay(40);
          const list = document.querySelector(".model-picker-list");
          if (list) {
            const before = list.scrollTop;
            list.scrollTop = Math.max(1, Math.min(list.scrollHeight - list.clientHeight, 180));
            await delay(100);
            window.__iiimageModelPickerScrollProbe = { before, after: list.scrollTop, moved: list.scrollTop > before };
          } else {
            window.__iiimageModelPickerScrollProbe = { before: 0, after: 0, moved: false };
          }
        }
      `);
      const modelPickerExpected = { settingsOpen: true, modalOpen: true, modelConfigOpen: true, modelPickerLayoutOk: true, modelPickerPartsWithinViewport: true, modelPickerCloseButtonOk: true, modelPickerScrollOk: true, modelPickerGpt56Ok: true, modelPickerGpt55CleanOk: true, cacheUiCopyHiddenOk: true, modelCacheSecondHitOk: true, modelCacheForceRefreshOk: true, modalWithinViewport: true };
      const accountExpected = { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: true, titlebarOverlay: true, workbenchMinWidthOk: true, oldAgentPanelUnmounted: true, accountAvatarCircular: true, accountDrawerFlushRightOk: true, accountDrawerWidthOk: true, accountHeaderBreathingOk: true, accountDrawerUiOk: true, accountProfileCardOk: true, walletCardThreeColumnOk: true, walletCardPolishedOk: true, accountActionButtonsDesignedOk: true, usageLogListInsetOk: true, usageLogRowsCompactOk: true, accountUsageLogLabel: true, accountUsageLogFailureVisibleOk: true, accountUsageLogTimeOk: true, accountSensitiveLogTextHiddenOk: true, canvasToolbarAbsent: true, canvasStatusDockedBottom: true, canvasZoomDockedBottom: true, canvasViewportFillOk: true };
      results.push(await captureState(client, target.id, "settings-1280", openSurfaceExpression("settings"), { width: 1280, height: 820 }, settingsExpected));
      results.push(await captureState(client, target.id, "settings-min-884", openSurfaceExpression("settings"), { width: workbenchMinWidth, height: 720 }, { ...settingsExpected, settingsDrawerWithinViewport: true, imageNodeViewportOk: true }));
      results.push(await captureState(client, target.id, "model-picker-1280", modelPickerExpression, { width: 1280, height: 820 }, modelPickerExpected));
      results.push(await captureState(client, target.id, "model-picker-min-884", modelPickerExpression, { width: workbenchMinWidth, height: 720 }, { ...modelPickerExpected, imageNodeViewportOk: true }));
      results.push(await captureState(client, target.id, "account-1280", openSurfaceExpression("account"), { width: 1280, height: 820 }, accountExpected));
      results.push(await captureState(client, target.id, "account-min-884", openSurfaceExpression("account"), { width: workbenchMinWidth, height: 720 }, { ...accountExpected, imageNodeViewportOk: true }));
      results.push(await captureState(client, target.id, "project-menu-min-884", openSurfaceExpression("project-menu"), { width: workbenchMinWidth, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, projectMenuOpen: true, fileMenuOpen: false, titlebarOverlay: true, workbenchMinWidthOk: true, oldAgentPanelUnmounted: true, topbarCanvasActionLabelsOk: true, topbarCanvasActionsFitOk: true, menuWithinViewport: true, imageNodeViewportOk: true, canvasToolbarAbsent: true, canvasStatusDockedBottom: true, canvasZoomDockedBottom: true, canvasViewportFillOk: true }));
      results.push(await captureState(client, target.id, "file-menu-min-884", openSurfaceExpression("file-menu"), { width: workbenchMinWidth, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, projectMenuOpen: false, fileMenuOpen: true, titlebarOverlay: true, workbenchMinWidthOk: true, oldAgentPanelUnmounted: true, topbarCanvasActionLabelsOk: true, topbarCanvasActionsFitOk: true, menuWithinViewport: true, imageNodeViewportOk: true, canvasToolbarAbsent: true, canvasStatusDockedBottom: true, canvasZoomDockedBottom: true, canvasViewportFillOk: true }));
      const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
      const contactSheetPath = writeContactSheet(results);
      const summaryPath = writeRunSummary(results, failures, contactSheetPath);
      const reportPath = join(runDir, "report.json");
      writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, mode: "canvas-only-smoke", runDir, reportPath, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
      console.log(JSON.stringify({ ok: failures.length === 0, mode: "canvas-only-smoke", runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
      if (failures.length) process.exitCode = 1;
      return;
    }
    results.push(await captureState(client, target.id, "main-1280", openSurfaceExpression("main"), { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, titlebarBrandVisible: true, accountAvatarCircular: true, rightCollapseAligned: true, settingsChannelHidden: true, agentDebugReady: true, agentBridgeReady: true, canvasReadabilityOk: true, compactMainGridOk: true }));
    results.push(await captureState(client, target.id, "composer-model-popover-1280", openSurfaceExpression("agent-timeline", `document.querySelector(".composer-model-chip")?.click();`), { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, agentPanelVisible: true, composerPopoverOpen: true, composerPopoverDocked: true, composerButtonsConsistent: true, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "workspace-resize-1280", "window.__iiimageDebugOpenSurface?.('main'); window.__iiimageDebugResizeWorkspace?.({ inspectorWidth: 300, agentWidth: 360 }); undefined", { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, agentWidth: 40, titlebarOverlay: true, titlebarBrandVisible: true, rightCollapseAligned: true, compactMainGridOk: true }));
    results.push(...await captureAgentRunningUiProbe(client, target.id));
    results.push(...await captureAgentToolSuiteProbe(client, target.id));
    results.push(await captureAgentExperienceImageProbe(client, target.id));
    results.push(await captureAgentImageSuiteProbe(client, target.id, imageRuns));
    results.push(...await captureAgentMixedStressProbe(client, target.id, stressRounds));
    results.push(...await captureAgentMessageFixtureProbe(client, target.id));
    results.push(await captureState(client, target.id, "agent-timeline-1280", openSurfaceExpression("agent-timeline"), { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, timelineNodesVisible: true, composerModelCompact: true, composerTextareaTall: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "settings-1280", openSurfaceExpression("settings"), { width: 1280, height: 820 }, { settingsOpen: true, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, settingsChannelHidden: true, settingsBoxless: true, settingsRowsAiry: true, settingsHeaderCompactOk: true, settingsDrawerFlushRightOk: true, settingsLabelsOk: true, settingsSaveControlsOk: true, settingsUpdateCenterOk: true, modelFetchButtonAlignedOk: true }));
    results.push(await captureState(client, target.id, "model-config-1280", openSurfaceExpression("model-config", `document.querySelector(".settings-model-config-action")?.click();`), { width: 1280, height: 820 }, { settingsOpen: true, historyOpen: false, modalOpen: true, modelConfigOpen: true, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "account-1280", openSurfaceExpression("account"), { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: true, titlebarOverlay: true, accountAvatarCircular: true, accountDrawerFlushRightOk: true, accountUsageLogLabel: true, accountUsageLogFailureVisibleOk: true, accountUsageLogTimeOk: true, accountSensitiveLogTextHiddenOk: true }));
    results.push(await captureState(client, target.id, "image-task-1280", openSurfaceExpression("image-task"), { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: false, modalOpen: true, imageTaskOpen: true, manualImageTaskControlsOk: true, manualImageTaskLayoutOk: true, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "history-1280", openSurfaceExpression("history"), { width: 1280, height: 820 }, { settingsOpen: false, historyOpen: true, modalOpen: false, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "project-menu-outside-close-1280", outsideClickExpression("project-menu", 640, 420), { width: 1280, height: 820 }, { projectMenuOpen: false, fileMenuOpen: false, settingsOpen: false, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "file-menu-outside-close-1280", outsideClickExpression("file-menu", 640, 420), { width: 1280, height: 820 }, { projectMenuOpen: false, fileMenuOpen: false, settingsOpen: false, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "settings-outside-close-1280", outsideClickExpression("settings", 520, 420), { width: 1280, height: 820 }, { settingsOpen: false, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "account-outside-close-1280", outsideClickExpression("account", 520, 420), { width: 1280, height: 820 }, { settingsOpen: false, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "history-outside-close-1280", outsideClickExpression("history", 520, 420), { width: 1280, height: 820 }, { historyOpen: false, settingsOpen: false, accountOpen: false, titlebarOverlay: true }));
    results.push(await captureState(client, target.id, "narrow-history-960", openSurfaceExpression("history"), { width: 960, height: 760 }, { settingsOpen: false, historyOpen: true, modalOpen: false, accountOpen: false, titlebarOverlay: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "settings-960", openSurfaceExpression("settings"), { width: 960, height: 760 }, { settingsOpen: true, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, settingsChannelHidden: true, settingsBoxless: true, settingsRowsAiry: true, settingsHeaderCompactOk: true, settingsDrawerFlushRightOk: true, settingsLabelsOk: true, settingsSaveControlsOk: true, settingsUpdateCenterOk: true, modelFetchButtonAlignedOk: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "main-760", openSurfaceExpression("main"), { width: 760, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, agentDebugReady: true, canvasVisible: true, compactMainGridOk: true, imageNodeViewportOk: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "agent-timeline-760", openSurfaceExpression("agent-timeline"), { width: 760, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, agentPanelVisible: true, timelineNodesVisible: true, composerButtonsConsistent: true, composerTextareaTall: true, imageNodeViewportOk: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "settings-760", openSurfaceExpression("settings"), { width: 760, height: 720 }, { settingsOpen: true, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, settingsChannelHidden: true, settingsBoxless: true, settingsRowsAiry: true, settingsHeaderCompactOk: true, settingsDrawerWithinViewport: true, settingsDrawerFlushRightOk: true, settingsLabelsOk: true, modelFetchButtonAlignedOk: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "image-task-760", openSurfaceExpression("image-task"), { width: 760, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: true, imageTaskOpen: true, manualImageTaskControlsOk: true, manualImageTaskLayoutOk: true, accountOpen: false, titlebarOverlay: true, modalWithinViewport: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "main-620", openSurfaceExpression("main"), { width: 620, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, agentDebugReady: true, canvasVisible: true, compactMainGridOk: true, imageNodeViewportOk: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "agent-timeline-620", openSurfaceExpression("agent-timeline"), { width: 620, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, agentPanelVisible: true, timelineNodesVisible: true, composerButtonsConsistent: true, composerTextareaTall: true, imageNodeViewportOk: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "settings-620", openSurfaceExpression("settings"), { width: 620, height: 720 }, { settingsOpen: true, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, settingsChannelHidden: true, settingsBoxless: true, settingsRowsAiry: true, settingsHeaderCompactOk: true, settingsDrawerWithinViewport: true, settingsDrawerFlushRightOk: true, settingsLabelsOk: true, modelFetchButtonAlignedOk: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "image-task-620", openSurfaceExpression("image-task"), { width: 620, height: 720 }, { settingsOpen: false, historyOpen: false, modalOpen: true, imageTaskOpen: true, manualImageTaskControlsOk: true, manualImageTaskLayoutOk: true, accountOpen: false, titlebarOverlay: true, modalWithinViewport: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "main-540", openSurfaceExpression("main"), { width: 540, height: 700 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, agentDebugReady: true, topbarCompactOk: true, canvasVisible: true, compactMainGridOk: true, imageNodeViewportOk: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "agent-timeline-540", openSurfaceExpression("agent-timeline"), { width: 540, height: 700 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, topbarCompactOk: true, agentPanelVisible: true, timelineNodesVisible: true, composerButtonsConsistent: true, composerTextareaTall: true, imageNodeViewportOk: true, canvasReadabilityOk: true }));
    results.push(await captureState(client, target.id, "settings-540", openSurfaceExpression("settings"), { width: 540, height: 700 }, { settingsOpen: true, historyOpen: false, modalOpen: false, accountOpen: false, titlebarOverlay: true, topbarCompactOk: true, settingsChannelHidden: true, settingsBoxless: true, settingsRowsAiry: true, settingsHeaderCompactOk: true, settingsDrawerWithinViewport: true, settingsDrawerFlushRightOk: true, settingsLabelsOk: true, modelFetchButtonAlignedOk: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "image-task-540", openSurfaceExpression("image-task"), { width: 540, height: 700 }, { settingsOpen: false, historyOpen: false, modalOpen: true, imageTaskOpen: true, manualImageTaskControlsOk: true, manualImageTaskLayoutOk: true, accountOpen: false, titlebarOverlay: true, topbarCompactOk: true, modalWithinViewport: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "project-menu-540", openSurfaceExpression("project-menu"), { width: 540, height: 700 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, projectMenuOpen: true, fileMenuOpen: false, titlebarOverlay: true, topbarCompactOk: true, menuWithinViewport: true, imageNodeViewportOk: true }));
    results.push(await captureState(client, target.id, "file-menu-540", openSurfaceExpression("file-menu"), { width: 540, height: 700 }, { settingsOpen: false, historyOpen: false, modalOpen: false, accountOpen: false, projectMenuOpen: false, fileMenuOpen: true, titlebarOverlay: true, topbarCompactOk: true, menuWithinViewport: true, imageNodeViewportOk: true }));
    const reportPath = join(runDir, "report.json");
    appendNonVisualSelfChecks(results);
    const failures = results.filter((item) => item.overflow.documentOverflowX || item.overflow.bodyOverflowX || item.overflow.elementOverflowX.length || item.stateIssues.length || item.captureIssues.length || item.suite?.ok === false);
    const contactSheetPath = writeContactSheet(results);
    const summaryPath = writeRunSummary(results, failures, contactSheetPath);
    writeFileSync(reportPath, JSON.stringify({ ok: failures.length === 0, imageRuns, stressRounds, runDir, contactSheetPath, summaryPath, observations, results, failures }, null, 2));
    console.log(JSON.stringify({ ok: failures.length === 0, imageRuns, stressRounds, runDir, reportPath, contactSheetPath, summaryPath, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    setProbePhase("failure:capture-diagnostics", { previousPhase: activeProbePhase, message: error instanceof Error ? error.message : String(error) });
    await captureFailureDiagnostics(error, client, target).catch((diagnosticError) => {
      recordObservation("issue", "aidebug-failure-diagnostics-capture-failed", {
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
      });
    });
    throw error;
  } finally {
    stopHarnessHeartbeat();
    client.close();
    activeCdpClient = null;
    activeDebugTarget = null;
    if (!keepOpen) {
      await stopChildProcess(electronProcess);
      await stopChildProcess(viteProcess);
      scrubEphemeralLiveConfig();
    }
  }
}

main()
  .then(() => {
    if (!keepOpen) process.exit(process.exitCode || 0);
  })
  .catch(async (error) => {
    console.error(error);
    stopHarnessHeartbeat();
    await stopChildProcess(electronProcess);
    await stopChildProcess(viteProcess);
    process.exit(1);
  });
