import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const diagnosticsRoot = join(repoRoot, ".diagnostics", "electron");
const runDir = join(diagnosticsRoot, `product-performance-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const bundleDir = join(runDir, "renderer-bundle");
const reportPath = join(runDir, "report.json");
const roundsArg = process.argv.find((value) => value.startsWith("--rounds="));
const rounds = Math.max(1, Math.min(5, Number(roundsArg?.split("=")[1] || 3)));
const diagnosticOnly = process.argv.includes("--diagnostic");
const cpuProfileEnabled = process.argv.includes("--cpu-profile");
function countArg(name, fallback, maximum) {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`));
  const value = Number(raw?.split("=")[1] ?? fallback);
  return Math.max(0, Math.min(maximum, Number.isFinite(value) ? Math.floor(value) : fallback));
}
const fixtureNodeCount = countArg("nodes", 1_000, 5_000);
const fixtureMessageCount = countArg("messages", 500, 2_000);
const fixtureRelationCount = Math.min(countArg("relations", 199, 2_000), Math.max(0, fixtureNodeCount - 1));
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const budgets = Object.freeze({
  workbenchReadyMs: 3_500,
  rendererBootMs: 2_600,
  bundleBytes: 1_200_000,
  heapBytes: 160 * 1024 * 1024,
  maxMountedNodes: 80,
  zoomP95Ms: 34,
  panP95Ms: 34,
  dragP95Ms: 34,
  visualFrameP95Ms: 150,
  visualFrameMedianMs: 34,
  visualSlowFrameRate: 0.15,
  longTaskMaxMs: 120
});
const interactiveSettleMs = 320;

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function filesRecursively(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) result.push(...filesRecursively(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function seedSession(configDir, round) {
  const projectDir = join(configDir, "projects", "default");
  const sessionPath = join(projectDir, "session.json");
  const now = new Date().toISOString();
  const messages = Array.from({ length: fixtureMessageCount }, (_, index) => ({
    id: `perf-message-${String(index + 1).padStart(3, "0")}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index % 2 === 0 ? "用户需求" : "Agent 结果"} ${index + 1}：生产性能基线文本，保持普通纯文本快路径。`,
    createdAt: now,
    status: "done"
  }));
  const nodes = Array.from({ length: fixtureNodeCount }, (_, index) => {
    const id = `P${String(index + 1).padStart(4, "0")}`;
    return {
      id,
      title: `性能成果 ${index + 1}`,
      prompt: `生产性能基线图片成果 ${index + 1}`,
      type: "image",
      status: "review",
      imageState: "empty",
      imageParams: { prompt: `生产性能基线图片成果 ${index + 1}`, ratio: "1:1", resolution: "720P", count: 1, quality: "auto", size: "1024x1024" },
      imageProgress: { total: 1, completed: 0, failed: 0, failedSlots: [], retryCount: 0, maxRetries: 0, message: "静态成果占位" },
      outputs: 0,
      assets: [],
      x: (index % 40) * 410 + 100,
      y: Math.floor(index / 40) * 330 + 100,
      width: 320,
      height: 260,
      zOrder: index + 1,
      ...(index > 0 && index <= fixtureRelationCount ? { parentId: `P${String(index).padStart(4, "0")}`, relationType: "derived-from" } : {})
    };
  });
  const conversationId = `perf-conversation-${round}`;
  const session = {
    schemaVersion: 2,
    sessionRevision: 1,
    messages,
    conversations: [{ id: conversationId, title: "生产性能基线", messages, createdAt: now, updatedAt: now }],
    activeConversationId: conversationId,
    nodes,
    layoutGroups: [],
    selectedNodeId: fixtureNodeCount > 0 ? `P${String(fixtureNodeCount).padStart(4, "0")}` : ""
  };
  writeJson(join(configDir, "app-settings.json"), {
    theme: "dark",
    accountBaseUrl: "https://sparkapi.org",
    relayBaseUrl: "",
    updateBaseUrl: "https://sparkapi.org",
    agentModel: "gpt-5.6-sol",
    agentModelPool: ["gpt-5.6-sol"],
    imageModel: "gpt-image-2",
    imageModelPool: ["gpt-image-2"],
    reasoningEffort: "medium"
  });
  writeJson(join(configDir, "session.json"), session);
  writeJson(sessionPath, session);
  writeJson(join(configDir, "project-list.json"), {
    activeProjectId: "default",
    projects: [{ id: "default", name: "生产性能基线", path: projectDir, sessionPath, createdAt: now, updatedAt: now, external: false }]
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", rejectPromise, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
    return result.result?.value;
  }

  close() {
    this.socket?.close();
  }
}

async function waitForDebugTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && (String(item.url).startsWith("file:") || String(item.title).includes("naimage")));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // Electron is still starting.
    }
    await delay(100);
  }
  throw new Error(`No production-like renderer target on ${port}.`);
}

async function waitForExpression(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(`Boolean(${expression})`)) return true;
    await delay(80);
  }
  return false;
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return Promise.race([
    new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal }))),
    delay(timeoutMs).then(() => null)
  ]);
}

async function forceKillProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      killer.once("exit", resolvePromise);
      killer.once("error", resolvePromise);
    });
    return;
  }
  try { process.kill(pid, "SIGKILL"); } catch {}
}

const interactionExpression = `(async () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const twice = async () => { await frame(); await frame(); };
  const p95 = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] || 0;
  };
  const midpoint = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const slowRate = (values) => values.length ? values.filter((value) => value > 50).length / values.length : 0;
  const longTasks = [];
  const interactionStartedAt = performance.now();
  const observer = typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ? new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))))
    : null;
  observer?.observe({ type: 'longtask', buffered: true });
  const canvas = document.querySelector('.workflow-canvas');
  if (!canvas) throw new Error('production canvas unavailable');
  document.querySelector('.canvas-tools .zoom-button')?.click();
  await twice();
  const canvasRect = canvas.getBoundingClientRect();
  const centerX = canvasRect.left + canvasRect.width * 0.42;
  const centerY = canvasRect.top + canvasRect.height * 0.54;
  const zoom = [];
  const zoomFrames = [];
  for (let index = 0; index < 24; index += 1) {
    const started = performance.now();
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, deltaY: index % 2 ? 80 : -80 }));
    zoom.push(performance.now() - started);
    await frame();
    zoomFrames.push(performance.now() - started);
  }
  const candidates = [[0.08, 0.12], [0.5, 0.12], [0.88, 0.12], [0.08, 0.88], [0.5, 0.88], [0.88, 0.88]];
  const blank = candidates.map(([x, y]) => ({ x: canvasRect.left + canvasRect.width * x, y: canvasRect.top + canvasRect.height * y }))
    .find((point) => !document.elementsFromPoint(point.x, point.y).some((element) => element.closest?.('.flow-node'))) || { x: centerX, y: centerY };
  const pan = [];
  const panFrames = [];
  const panPointerId = 6001;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: panPointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: blank.x, clientY: blank.y }));
  for (let index = 1; index <= 18; index += 1) {
    const started = performance.now();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: panPointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: blank.x + index * 4, clientY: blank.y + index * 3 }));
    pan.push(performance.now() - started);
    await frame();
    panFrames.push(performance.now() - started);
  }
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: panPointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: blank.x + 72, clientY: blank.y + 54 }));
  await twice();
  const drag = [];
  const dragFrames = [];
  const node = [...document.querySelectorAll('.flow-node')].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.right > canvasRect.left + 20 && rect.left < canvasRect.right - 20 && rect.bottom > canvasRect.top + 20 && rect.top < canvasRect.bottom - 20;
  });
  if (node) {
    const rect = node.getBoundingClientRect();
    const startX = Math.max(canvasRect.left + 24, Math.min(canvasRect.right - 24, rect.left + Math.min(42, rect.width / 2)));
    const startY = Math.max(canvasRect.top + 24, Math.min(canvasRect.bottom - 24, rect.top + 28));
    const pointerId = 7001;
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: startX, clientY: startY }));
    for (let index = 1; index <= 16; index += 1) {
      const started = performance.now();
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: startX + index * 5, clientY: startY + index * 2 }));
      drag.push(performance.now() - started);
      await frame();
      dragFrames.push(performance.now() - started);
    }
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: startX + 80, clientY: startY + 32 }));
    await twice();
  }
  if (observer) {
    longTasks.push(...observer.takeRecords().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
    observer.disconnect();
  }
  const startupLongTasks = longTasks.filter((entry) => entry.startTime < interactionStartedAt);
  const interactionLongTasks = longTasks.filter((entry) => entry.startTime >= interactionStartedAt);
  const finalSnapshot = window.__naimagePerformanceProbe.snapshot();
  return {
    zoom: { samples: zoom, p95: p95(zoom), frameSamples: zoomFrames, frameP95: p95(zoomFrames), frameMedian: midpoint(zoomFrames), slowFrameRate: slowRate(zoomFrames) },
    pan: { samples: pan, p95: p95(pan), frameSamples: panFrames, frameP95: p95(panFrames), frameMedian: midpoint(panFrames), slowFrameRate: slowRate(panFrames) },
    drag: { samples: drag, p95: p95(drag), frameSamples: dragFrames, frameP95: p95(dragFrames), frameMedian: midpoint(dragFrames), slowFrameRate: slowRate(dragFrames) },
    longTasks: {
      count: interactionLongTasks.length,
      maxMs: Math.max(0, ...interactionLongTasks.map((entry) => entry.duration)),
      entries: interactionLongTasks.slice(-20),
      measurementStartedAt: interactionStartedAt,
      startup: {
        count: startupLongTasks.length,
        maxMs: Math.max(0, ...startupLongTasks.map((entry) => entry.duration)),
        entries: startupLongTasks.slice(-20)
      }
    },
    finalSnapshot
  };
})()`;

async function runRound(round) {
  const roundDir = join(runDir, `round-${round}`);
  const configDir = join(roundDir, "config");
  const userDataDir = join(roundDir, "user-data");
  const electronLog = join(roundDir, "electron.log");
  const screenshotPath = join(roundDir, "workbench.png");
  seedSession(configDir, round);
  const debugPort = 11_800 + ((process.pid + round * 31) % 1_000);
  const startedAt = Date.now();
  const child = spawn(process.execPath, [electronCli, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, "electron-main.cjs"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      NAIMAGE_RENDERER_INDEX: join(bundleDir, "index.html"),
      NAIMAGE_AIDEBUG: "1",
      NAIMAGE_AIDEBUG_MOCK_AGENT: "1",
      NAIMAGE_AIDEBUG_AGENT_MODE: "mock",
      NAIMAGE_PERFORMANCE_GATE: "1",
      NAIMAGE_CONFIG_DIR: configDir,
      NAIMAGE_ELECTRON_LOG: electronLog,
      NAIMAGE_DEV_URL: ""
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let client;
  try {
    const target = await waitForDebugTarget(debugPort);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    if (cpuProfileEnabled) {
      await client.send("Profiler.enable");
      await client.send("Profiler.start");
    }
    const ready = await waitForExpression(client, `window.__naimagePerformanceProbe?.profile === 'production-like' && window.__naimagePerformanceProbe.snapshot().rendererReady === true`);
    assert(ready, "Production-like renderer probe did not become ready.");
    await client.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await delay(interactiveSettleMs);
    const workbenchReadyMs = Date.now() - startedAt;
    const startupSnapshot = await client.evaluate(`window.__naimagePerformanceProbe.snapshot()`);
    const interactions = await client.evaluate(interactionExpression);
    const cpuProfile = cpuProfileEnabled ? (await client.send("Profiler.stop")).profile : null;
    const cpuProfilePath = cpuProfile ? join(roundDir, "renderer-interactions.cpuprofile") : null;
    if (cpuProfile && cpuProfilePath) writeJson(cpuProfilePath, cpuProfile);
    await delay(520);
    const finalSnapshot = await client.evaluate(`window.__naimagePerformanceProbe.snapshot()`);
    const heap = await client.send("Runtime.getHeapUsage");
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    await client.evaluate(`window.naimageConfig?.windowControl?.({ action: 'close' })`);
    let exit = await waitForChildExit(child, 8_000);
    if (!exit) {
      await forceKillProcessTree(child.pid);
      exit = await waitForChildExit(child, 2_000);
    }
    return {
      round,
      workbenchReadyMs,
      startupSnapshot,
      finalSnapshot,
      interactions,
      heap,
      screenshotPath,
      cpuProfilePath,
      screenshotBytes: statSync(screenshotPath).size,
      exit,
      logPath: electronLog,
      stdout: stdout.slice(-1_000),
      stderr: stderr.slice(-1_000)
    };
  } finally {
    client?.close();
    if (child.exitCode === null && child.signalCode === null) await forceKillProcessTree(child.pid);
  }
}

async function main() {
  assert(existsSync(electronCli), "Electron CLI missing.");
  assert(existsSync(viteCli), "Vite CLI missing.");
  mkdirSync(runDir, { recursive: true });
  const buildArgs = [viteCli, "build", "--mode", "performance", "--outDir", bundleDir, "--emptyOutDir"];
  if (cpuProfileEnabled) buildArgs.push("--sourcemap");
  const build = spawnSync(process.execPath, buildArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
  assert.equal(build.status, 0, "Production-like renderer build failed.");
  const bundleFiles = filesRecursively(bundleDir);
  const bundleBytes = bundleFiles.reduce((total, filePath) => total + statSync(filePath).size, 0);
  const sourceText = bundleFiles.filter((filePath) => /\.(?:js|html)$/i.test(filePath)).map((filePath) => readFileSync(filePath, "utf8")).join("\n");
  const forbidden = ["__naimageAIDebug", "runLayerStackSuite", "runMixedStressSuite", "__naimageDebugSendAgentPrompt"].filter((token) => sourceText.includes(token));
  const probePresent = sourceText.includes("__naimagePerformanceProbe");
  const bundleSha256 = createHash("sha256").update(sourceText).digest("hex");

  const roundResults = [];
  for (let round = 1; round <= rounds; round += 1) roundResults.push(await runRound(round));
  const aggregate = {
    rounds,
    workbenchReadyMs: median(roundResults.map((item) => item.workbenchReadyMs)),
    rendererBootMs: median(roundResults.map((item) => Number(item.startupSnapshot.bootMs || 0))),
    heapBytes: median(roundResults.map((item) => Number(item.heap.usedSize || 0))),
    zoomP95Ms: median(roundResults.map((item) => Number(item.interactions.zoom.p95 || 0))),
    panP95Ms: median(roundResults.map((item) => Number(item.interactions.pan.p95 || 0))),
    dragP95Ms: median(roundResults.map((item) => Number(item.interactions.drag.p95 || 0))),
    zoomFrameP95Ms: median(roundResults.map((item) => Number(item.interactions.zoom.frameP95 || 0))),
    panFrameP95Ms: median(roundResults.map((item) => Number(item.interactions.pan.frameP95 || 0))),
    dragFrameP95Ms: median(roundResults.map((item) => Number(item.interactions.drag.frameP95 || 0))),
    zoomFrameMedianMs: median(roundResults.map((item) => Number(item.interactions.zoom.frameMedian || 0))),
    panFrameMedianMs: median(roundResults.map((item) => Number(item.interactions.pan.frameMedian || 0))),
    dragFrameMedianMs: median(roundResults.map((item) => Number(item.interactions.drag.frameMedian || 0))),
    visualSlowFrameRate: Math.max(...roundResults.flatMap((item) => [
      Number(item.interactions.zoom.slowFrameRate || 0),
      Number(item.interactions.pan.slowFrameRate || 0),
      Number(item.interactions.drag.slowFrameRate || 0)
    ])),
    startupLongTaskMaxMs: Math.max(...roundResults.map((item) => Number(item.interactions.longTasks.startup?.maxMs || 0))),
    longTaskMaxMs: Math.max(...roundResults.map((item) => Number(item.interactions.longTasks.maxMs || 0)))
  };
  const perRoundChecks = roundResults.map((item) => ({
    round: item.round,
    ready: item.startupSnapshot.rendererReady === true,
    nodeCount: Number(item.startupSnapshot.nodeCount) === fixtureNodeCount,
    parentedNodeCount: Number(item.startupSnapshot.parentedNodeCount) === fixtureRelationCount,
    canvasNodeCount: Number(item.startupSnapshot.canvasNodeCount) === fixtureNodeCount,
    mountedNodeBudget: fixtureNodeCount === 0
      ? Number(item.startupSnapshot.domNodeCount) === 0
      : Number(item.startupSnapshot.domNodeCount) > 0 && Number(item.startupSnapshot.domNodeCount) <= budgets.maxMountedNodes,
    selectedMounted: fixtureNodeCount === 0
      ? !item.startupSnapshot.selectedNodeId && item.startupSnapshot.selectedNodeMounted === false
      : item.startupSnapshot.selectedNodeId === `P${String(fixtureNodeCount).padStart(4, "0")}` && item.startupSnapshot.selectedNodeMounted === true,
    messageCount: Number(item.startupSnapshot.messageCount) === fixtureMessageCount,
    messageWindowHealthy: Number(item.startupSnapshot.domMessageCount) === Math.min(fixtureMessageCount, 80),
    noHorizontalOverflow: item.startupSnapshot.documentOverflowX === false,
    persistenceHealthy: Number(item.finalSnapshot.persistence?.failedWriteCount || 0) === 0,
    cleanExit: item.exit?.code === 0
  }));
  const checks = {
    productionLikeProfile: roundResults.every((item) => item.startupSnapshot.profile === "production-like"),
    minimalProbePresent: probePresent,
    fullAidebugAbsent: forbidden.length === 0,
    bundleWithinBudget: bundleBytes <= budgets.bundleBytes,
    workbenchWithinBudget: aggregate.workbenchReadyMs <= budgets.workbenchReadyMs,
    rendererBootWithinBudget: aggregate.rendererBootMs <= budgets.rendererBootMs,
    heapWithinBudget: aggregate.heapBytes <= budgets.heapBytes,
    zoomWithinBudget: aggregate.zoomP95Ms <= budgets.zoomP95Ms,
    panWithinBudget: aggregate.panP95Ms <= budgets.panP95Ms,
    dragWithinBudget: aggregate.dragP95Ms <= budgets.dragP95Ms,
    visualFramesWithinBudget: Math.max(aggregate.zoomFrameP95Ms, aggregate.panFrameP95Ms, aggregate.dragFrameP95Ms) <= budgets.visualFrameP95Ms,
    visualFrameMedianWithinBudget: Math.max(aggregate.zoomFrameMedianMs, aggregate.panFrameMedianMs, aggregate.dragFrameMedianMs) <= budgets.visualFrameMedianMs,
    visualSlowFrameRateWithinBudget: aggregate.visualSlowFrameRate <= budgets.visualSlowFrameRate,
    longTasksWithinBudget: aggregate.longTaskMaxMs <= budgets.longTaskMaxMs,
    everyRoundHealthy: perRoundChecks.every((round) => Object.entries(round).every(([key, value]) => key === "round" || value === true))
  };
  const report = {
    schemaVersion: 1,
    ok: Object.values(checks).every(Boolean),
    profile: "production-like",
    baselineOnly: false,
    productPerformanceReady: Object.values(checks).every(Boolean),
    evidenceScope: "product-gate",
    generatedAt: new Date().toISOString(),
    diagnosticOnly,
    fixture: { nodeCount: fixtureNodeCount, relationCount: fixtureRelationCount, messageCount: fixtureMessageCount },
    interactiveSettleMs,
    runDir,
    reportPath,
    bundle: { dir: bundleDir, bytes: bundleBytes, sha256: bundleSha256, fileCount: bundleFiles.length, forbidden, probePresent },
    budgets,
    aggregate,
    checks,
    perRoundChecks,
    rounds: roundResults
  };
  writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ ok: report.ok, productPerformanceReady: report.productPerformanceReady, reportPath, bundle: report.bundle, aggregate, checks }, null, 2)}\n`);
  if (!diagnosticOnly) assert(report.ok, `Production performance gate failed: ${reportPath}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
