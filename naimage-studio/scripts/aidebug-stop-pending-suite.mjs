import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BasicCdpClient,
  evaluateRuntime as evaluate,
  pollForDebugTarget,
  waitForRuntimeExpression
} from "./aidebug/harness/cdp.mjs";
import { allocateDebugPort, forceKillProcessTree, waitForHttpServer } from "./aidebug/harness/process.mjs";
import { createAidebugReporting } from "./aidebug/harness/reporting.mjs";
import { captureStableCdpScene, createObservationLog } from "./aidebug/harness/standalone-gui-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(repoRoot, ".diagnostics", "electron", `stop-pending-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const configDir = join(runDir, "config");
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const fallbackPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const { observations, recordObservation } = createObservationLog();
const evidenceResults = [];
const checks = {};
let viteProcess;
let electronProcess;
let client;
let reporting;

async function clickStopAndConfirm() {
  const stopClicked = await evaluate(client, `(() => {
    const button = document.querySelector('.project-agent-stop');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(stopClicked, true, "Busy Agent must expose an enabled stop button");
  await waitForRuntimeExpression(
    client,
    "Boolean(document.querySelector('.confirm-dialog'))",
    { evaluate, timeoutMs: 3_000, intervalMs: 50 }
  );
  const confirmed = await evaluate(client, `(() => {
    const button = Array.from(document.querySelectorAll('.confirm-dialog button'))
      .find((item) => item.textContent?.includes('确认结束'));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(confirmed, true, "Stop confirmation must be actionable");
}

async function readStopUi() {
  return evaluate(client, `(() => {
    const state = window.__naimageDebugAgentState?.() || {};
    const stop = document.querySelector('.project-agent-stop');
    return {
      agentStatus: state.agentStatus || '',
      busy: state.agentExecutionBusy === true,
      activeRunId: state.activeRunId || '',
      stopPresent: stop instanceof HTMLButtonElement,
      stopText: String(stop?.textContent || '').replace(/\\s+/g, ' ').trim(),
      stopDisabled: stop instanceof HTMLButtonElement ? stop.disabled : null,
      statusText: String(document.querySelector('.project-agent-status span')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      failureVisible: Boolean(document.querySelector('.project-agent-feed')?.textContent?.includes('AIDebug 注入的结束失败')),
      steerPresent: document.querySelector('.project-agent-steer') instanceof HTMLButtonElement,
      sendPresent: document.querySelector('.project-agent-send') instanceof HTMLButtonElement
    };
  })()`);
}

async function readStopEvidenceSnapshot(expectedPhase) {
  const snapshot = await evaluate(client, `(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const rect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom),
        width: Math.round(box.width), height: Math.round(box.height)
      };
    };
    const state = window.__naimageDebugAgentState?.() || {};
    const panel = document.querySelector('.project-agent-panel');
    const status = document.querySelector('.project-agent-status');
    const stop = document.querySelector('.project-agent-stop');
    const steer = document.querySelector('.project-agent-steer');
    const send = document.querySelector('.project-agent-send');
    const inspected = [panel, status, stop, steer, send].filter(visible);
    const elementOverflowX = inspected.flatMap((element) => {
      const box = rect(element);
      const overflow = element.scrollWidth > element.clientWidth + 1 || box.left < -1 || box.right > innerWidth + 1;
      return overflow ? [{ selector: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, rect: box }] : [];
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      agentStatus: state.agentStatus || '',
      busy: state.agentExecutionBusy === true,
      activeRunId: state.activeRunId || '',
      panelVisible: visible(panel),
      panelRect: rect(panel),
      stopPresent: stop instanceof HTMLButtonElement,
      stopText: String(stop?.textContent || '').replace(/\\s+/g, ' ').trim(),
      stopDisabled: stop instanceof HTMLButtonElement ? stop.disabled : null,
      stopRect: rect(stop),
      statusText: String(status?.querySelector('span')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      failureVisible: Boolean(document.querySelector('.project-agent-feed')?.textContent?.includes('AIDebug 注入的结束失败')),
      steerPresent: steer instanceof HTMLButtonElement,
      sendPresent: send instanceof HTMLButtonElement,
      sendRect: rect(send),
      documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyOverflowX: document.body.scrollWidth > document.body.clientWidth + 1,
      elementOverflowX
    };
  })()`);
  const expectations = {
    pending: {
      agentStatus: "thinking",
      busy: true,
      activeRunId: "debug-running-ui",
      stopPresent: true,
      stopText: "正在结束",
      stopDisabled: true,
      statusText: "Agent 正在确认结束",
      steerPresent: true,
      sendPresent: false
    },
    failed: {
      agentStatus: "thinking",
      busy: true,
      activeRunId: "debug-running-ui",
      stopPresent: true,
      stopText: "结束",
      stopDisabled: false,
      failureVisible: true,
      steerPresent: true,
      sendPresent: false
    },
    stopped: {
      agentStatus: "idle",
      busy: false,
      activeRunId: "",
      stopPresent: false,
      statusText: "等待指令",
      sendPresent: true
    }
  };
  const expected = expectations[expectedPhase];
  assert(expected, `Unknown stop evidence phase: ${expectedPhase}`);
  const stateIssues = Object.entries(expected).flatMap(([key, value]) => (
    snapshot[key] === value ? [] : [{ key, expected: value, actual: snapshot[key] }]
  ));
  return {
    viewport: snapshot.viewport,
    state: snapshot,
    stateIssues,
    surfaceOk: snapshot.panelVisible && (expectedPhase === "stopped" ? snapshot.sendPresent : snapshot.stopPresent),
    overflow: {
      documentOverflowX: snapshot.documentOverflowX,
      bodyOverflowX: snapshot.bodyOverflowX,
      elementOverflowX: snapshot.elementOverflowX
    }
  };
}

async function capture(label, expectedPhase) {
  const result = await captureStableCdpScene({
    client,
    runDir,
    label,
    readSnapshot: () => readStopEvidenceSnapshot(expectedPhase),
    timeoutMs: 20_000
  });
  evidenceResults.push(result);
  if (!result.visualReliability.ok) {
    const issueDetail = result.stateIssues.length ? `; stateIssues=${JSON.stringify(result.stateIssues)}` : "";
    throw new Error(`Stop-pending visual evidence failed for ${label}: ${result.visualReliability.failureReasons.join(", ")}${issueDetail}`);
  }
  return result;
}

async function main() {
  mkdirSync(runDir, { recursive: true });
  recordObservation("info", "suite-checkpoint", { label: "bootstrap:prepare-run", runDir, mode: "agent-stop-pending-suite" });
  reporting = createAidebugReporting({
    runDir,
    desktopLogPath: join(runDir, "aidebug.log"),
    observations,
    mockAgent: true,
    cycleIndex: 1,
    cycleTotal: 1,
    fallbackPng,
    recordObservation,
    log: (value) => process.stdout.write(`${value}\n`)
  });
  assert(existsSync(electronCli), "Electron CLI is missing");
  assert(existsSync(viteCli), "Vite CLI is missing");
  const [debugPort, vitePort] = await Promise.all([allocateDebugPort(), allocateDebugPort()]);
  const devUrl = `http://127.0.0.1:${vitePort}`;

  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
    shell: false
  });
  await waitForHttpServer(devUrl, {
    attempts: 120,
    intervalMs: 100,
    errorMessage: "Stop-pending Vite server did not start."
  });

  electronProcess = spawn(
    process.execPath,
    [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(runDir, "user-data")}`, "electron-main.cjs"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      env: {
        ...process.env,
        NAIMAGE_DEV_URL: devUrl,
        NAIMAGE_AIDEBUG: "1",
        NAIMAGE_AIDEBUG_LIVE_IMAGE: "0",
        NAIMAGE_AIDEBUG_REAL_AGENT: "0",
        NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
        NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
        NAIMAGE_AIDEBUG_AGENT_STOP_FIXTURE: "fail-once",
        NAIMAGE_AIDEBUG_AGENT_STOP_DELAY_MS: "1400",
        NAIMAGE_CONFIG_DIR: configDir
      }
    }
  );

  const target = await pollForDebugTarget({
    port: debugPort,
    attempts: 160,
    intervalMs: 100,
    findTarget: (targets) => targets.find((item) => item.type === "page" && String(item.url).includes(`127.0.0.1:${vitePort}`)),
    notFoundMessage: "Stop-pending main renderer was not found."
  });
  client = new BasicCdpClient(target.webSocketDebuggerUrl);
  await client.open();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await waitForRuntimeExpression(
    client,
    "Boolean(document.querySelector('.project-agent-panel') && window.__naimageAIDebug && window.__naimageDebugOpenSurface)",
    { evaluate, timeoutMs: 15_000, intervalMs: 100 }
  );

  const seeded = await evaluate(client, "window.__naimageDebugOpenSurface?.('agent-running') === true");
  assert.equal(seeded, true, "AIDebug must seed a genuine busy Renderer state");
  await waitForRuntimeExpression(
    client,
    "window.__naimageDebugAgentState?.().agentExecutionBusy === true && document.querySelector('.project-agent-stop')?.textContent?.includes('结束')",
    { evaluate, timeoutMs: 5_000, intervalMs: 60 }
  );

  await clickStopAndConfirm();
  await waitForRuntimeExpression(
    client,
    "document.querySelector('.project-agent-stop')?.textContent?.includes('正在结束') === true && window.__naimageDebugAgentState?.().agentExecutionBusy === true",
    { evaluate, timeoutMs: 3_000, intervalMs: 40 }
  );
  const pending = await readStopUi();
  assert.equal(pending.busy, true, "Delayed stop must retain busy state");
  assert.equal(pending.activeRunId, "debug-running-ui", "Delayed stop must retain the active run");
  assert.equal(pending.stopText, "正在结束");
  assert.equal(pending.stopDisabled, true);
  assert.equal(pending.statusText, "Agent 正在确认结束");
  checks.pending = { ok: true, state: pending };
  await capture("01-stop-pending", "pending");

  await waitForRuntimeExpression(
    client,
    "document.querySelector('.project-agent-stop')?.textContent?.includes('正在结束') === false && window.__naimageDebugAgentState?.().agentExecutionBusy === true && document.querySelector('.project-agent-feed')?.textContent?.includes('AIDebug 注入的结束失败') === true",
    { evaluate, timeoutMs: 8_000, intervalMs: 60 }
  );
  const failed = await readStopUi();
  assert.equal(failed.busy, true, "Rejected stop must retain busy state");
  assert.equal(failed.activeRunId, "debug-running-ui", "Rejected stop must retain the active run");
  assert.equal(failed.stopText, "结束");
  assert.equal(failed.stopDisabled, false);
  assert.equal(failed.failureVisible, true, "Rejected stop reason must be visible in the Agent timeline");
  checks.failed = { ok: true, state: failed };
  await capture("02-stop-failed", "failed");

  await clickStopAndConfirm();
  await waitForRuntimeExpression(
    client,
    "window.__naimageDebugAgentState?.().agentExecutionBusy === false && window.__naimageDebugAgentState?.().agentStatus === 'idle' && !document.querySelector('.project-agent-stop') && Boolean(document.querySelector('.project-agent-send'))",
    { evaluate, timeoutMs: 8_000, intervalMs: 60 }
  );
  const stopped = await readStopUi();
  assert.equal(stopped.agentStatus, "idle");
  assert.equal(stopped.busy, false);
  assert.equal(stopped.activeRunId, "");
  assert.equal(stopped.stopPresent, false);
  assert.equal(stopped.sendPresent, true);
  assert.equal(stopped.statusText, "等待指令");
  checks.stopped = { ok: true, state: stopped };
  await capture("03-stop-retry-succeeded", "stopped");

  const screenshots = Object.fromEntries(evidenceResults.map((item) => [item.label, {
    path: item.screenshotPath,
    sha256: item.screenshotEvidence.sha256
  }]));
  const report = reporting.finishSuiteRun({
    results: evidenceResults,
    reportMetadata: {
      mode: "agent-stop-pending-suite",
      suite: "agent-stop-pending",
      agentMode: "mock-agent",
      networkUsed: false
    },
    reportAfterObservations: { cases: 20, pending, failed, stopped, checks, screenshots },
    consoleAfterSummary: { cases: 20, screenshots: evidenceResults.length }
  });
  if (!report.ok || !Object.values(checks).every((item) => item?.ok === true)) {
    throw new Error("Stop-pending AIDebug report contains failed checks or visual scenes.");
  }
}

try {
  await main();
} catch (error) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "failure.json"), `${JSON.stringify({
    ok: false,
    suite: "agent-stop-pending",
    error: error instanceof Error ? error.stack || error.message : String(error),
    checks,
    runDir
  }, null, 2)}\n`, "utf8");
  throw error;
} finally {
  client?.close();
  await forceKillProcessTree(electronProcess?.pid);
  await forceKillProcessTree(viteProcess?.pid);
}
