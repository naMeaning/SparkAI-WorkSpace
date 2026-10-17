import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const diagnosticsRoot = join(repoRoot, ".diagnostics", "electron");
const runDir = join(diagnosticsRoot, `product-performance-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const reuseBundle = process.argv.find(value => value.startsWith("--bundle="))?.slice(9);
const bundleDir = reuseBundle ? resolve(reuseBundle) : join(runDir, "renderer-bundle");
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
const mixedAssets = process.argv.includes("--mixed-assets");
const hubRelations = process.argv.includes("--hub");
const selectAll = process.argv.includes("--select-all");
const memoryCycles = countArg("memory-cycles", 0, 20);
const localVideo = process.argv.includes("--local-video");
const mediaFixtures = [];
const electronCli = join(repoRoot, "node_modules", "electron", "cli.js");
const viteCli = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const foregroundChromiumSwitches = Object.freeze([
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding"
]);

const budgets = Object.freeze({
  workbenchReadyMs: 3_500,
  rendererBootMs: 2_600,
  // Total runtime output is a trend signal. The production Bundle gate owns
  // the hard first-load, plugin and CSS limits separately.
  runtimeBundleAdvisoryBytes: 1_200_000,
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

// Deterministic local VP8 frames in a WebM container. Canvas capture can return
// header-only recordings on remote Windows desktops; valid WebP VP8 keyframes
// avoid depending on compositor capture or an external encoder installation.
async function prepareLocalVideo() {
  const size = value => {
    let length = 1;
    while (value >= 2 ** (7 * length) - 1) length++;
    const bytes = Buffer.alloc(length);
    for (let i = length - 1; i >= 0; i--) { bytes[i] = value % 256; value = Math.floor(value / 256); }
    bytes[0] |= 1 << (8 - length);
    return bytes;
  };
  const element = (id, data) => Buffer.concat([Buffer.from(id, "hex"), size(data.length), data]);
  const integer = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); let start = 0; while (start < 3 && !bytes[start]) start++; return bytes.subarray(start); };
  const uint = (id, value) => element(id, integer(value));
  const text = (id, value) => element(id, Buffer.from(value));
  const master = (id, children) => element(id, Buffer.concat(children));
  const duration = Buffer.alloc(8); duration.writeDoubleBE(2000);
  const blocks = [];
  for (let frame = 0; frame < 20; frame++) {
    const webp = await sharp({ create: { width: 640, height: 360, channels: 3, background: frame % 2 ? "#387fac" : "#e3b42d" } })
      .composite([{ input: Buffer.from(`<svg width="640" height="360"><rect x="${frame * 24}" y="100" width="80" height="140" fill="white"/></svg>`) }]).removeAlpha().webp({ quality: 75 }).toBuffer();
    let vp8;
    for (let offset = 12; offset + 8 <= webp.length;) {
      const bytes = webp.readUInt32LE(offset + 4);
      if (webp.toString("ascii", offset, offset + 4) === "VP8 ") { vp8 = webp.subarray(offset + 8, offset + 8 + bytes); break; }
      offset += 8 + bytes + (bytes % 2);
    }
    assert.ok(vp8, "local encoder must produce a VP8 keyframe");
    const header = Buffer.alloc(4); header[0] = 0x81; header.writeInt16BE(frame * 100, 1); header[3] = 0x80;
    blocks.push(element("a3", Buffer.concat([header, vp8])));
  }
  const header = master("1a45dfa3", [uint("4286", 1), uint("42f7", 1), uint("42f2", 4), uint("42f3", 8), text("4282", "webm"), uint("4287", 2), uint("4285", 2)]);
  const info = master("1549a966", [uint("2ad7b1", 1000000), element("4489", duration), text("4d80", "SparkAI local fixture"), text("5741", "SparkAI local fixture")]);
  const tracks = master("1654ae6b", [master("ae", [uint("d7", 1), uint("73c5", 1), uint("83", 1), uint("9c", 0), text("86", "V_VP8"), uint("23e383", 100000000), master("e0", [uint("b0", 640), uint("ba", 360)])])]);
  const file = join(runDir, "local-playback.webm");
  writeFileSync(file, Buffer.concat([header, master("18538067", [info, tracks, master("1f43b675", [uint("e7", 0), ...blocks])])]));
  return file;
}

async function prepareMediaFixtures() {
  if (!mixedAssets) return;
  const pixels = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + Math.floor(i / 192) * 17) % 256;
  for (const width of [2048, 4096]) for (const format of ["png", "jpeg", "webp"]) {
    const path = join(runDir, `fixture-${width}.${format}`);
    await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).resize(width, width).toFormat(format).toFile(path);
    mediaFixtures.push({ path, width, height: width, mimeType: `image/${format}` });
  }
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
      ...(memoryCycles ? { createdAt: "2026-01-01T00:00:00.000Z", persistenceOriginId: `perf-origin-${id}` } : {}),
      ...(index > 0 && index <= fixtureRelationCount ? { parentId: hubRelations ? "P0001" : `P${String(index).padStart(4, "0")}`, relationType: "derived-from" } : {})
    };
  });
  if (mixedAssets) for (const [index, node] of nodes.entries()) {
    if (index % 5 === 4) {
      Object.assign(node, { type: "requirement", requirement: { version: 1, revision: 1, text: "本地性能夹具，不执行模型。", inputBindings: [] } });
    } else {
      const source = mediaFixtures[index % mediaFixtures.length];
      const outputPath = join(projectDir, "output", "imagegen", `fixture-${index}-${source.width}.${source.mimeType.split('/')[1]}`);
      mkdirSync(dirname(outputPath), { recursive: true });
      // Distinct managed paths preserve node identities; hard links keep the
      // deterministic fixture from copying gigabytes of identical source bytes.
      if (!existsSync(outputPath)) linkSync(source.path, outputPath);
      const occurrenceId = `occ-${createHash("sha256").update(`perf-${index}`).digest("hex").slice(0, 32)}`;
      const asset = { ...source, path: outputPath, assetUrl: `naimage-asset://local/abs/${encodeURIComponent(outputPath)}`, type: "file", assetId: `perf-asset-${index}`, occurrenceId, index: 1 };
      node.assets = [asset]; node.outputs = 1; node.status = "done"; node.imageState = "done";
      if (index % 7 === 3) Object.assign(node, { imageContainer: true, outputs: 2, assets: [asset, { ...asset, assetId: `${asset.assetId}-2`, occurrenceId: `occ-${createHash("sha256").update(`perf-${index}-2`).digest("hex").slice(0, 32)}`, index: 2 }] });
    }
  }
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
    projects: [{ id: "default", name: "生产性能基线", path: projectDir, sessionPath, createdAt: now, updatedAt: now, external: false },
      ...(memoryCycles || localVideo ? [{ id: "secondary", name: "内存循环空项目", path: join(configDir, "projects/secondary"), sessionPath: join(configDir, "projects/secondary/session.json"), createdAt: now, updatedAt: now, external: false }] : [])]
  });
  if (memoryCycles || localVideo) writeJson(join(configDir, "projects/secondary/session.json"), { schemaVersion: 5, sessionRevision: 1, nodes: [], messages: [] });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.networkEvents = [];
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", rejectPromise, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (["Network.responseReceived", "Network.loadingFailed"].includes(message.method)) this.networkEvents.push(message);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Renderer CDP connection closed before responding."));
      this.pending.clear();
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed.");
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
      const target = targets.find((item) => item.type === "page" && (String(item.url).startsWith("file:") || String(item.title).includes("SparkAI WorkSpace")));
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
  const canvas = document.querySelector('[data-canvas-surface="true"]');
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
    .find((point) => !document.elementsFromPoint(point.x, point.y).some((element) => element.closest?.('[data-canvas-node="true"]'))) || { x: centerX, y: centerY };
  const pan = [];
  const panFrames = [];
  const panPointerId = 6001;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: panPointerId, pointerType: 'mouse', isPrimary: true, button: 1, buttons: 4, clientX: blank.x, clientY: blank.y }));
  for (let index = 1; index <= 18; index += 1) {
    const started = performance.now();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: panPointerId, pointerType: 'mouse', isPrimary: true, button: 1, buttons: 4, clientX: blank.x + index * 4, clientY: blank.y + index * 3 }));
    pan.push(performance.now() - started);
    await frame();
    panFrames.push(performance.now() - started);
  }
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: panPointerId, pointerType: 'mouse', isPrimary: true, button: 1, buttons: 0, clientX: blank.x + 72, clientY: blank.y + 54 }));
  await twice();
  const drag = [];
  const dragFrames = [];
  const node = [...document.querySelectorAll('[data-canvas-node="true"]')].find((element) => {
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

const foregroundSchedulerExpression = `(async () => {
  window.focus();
  const samples = [];
  let previous = null;
  await new Promise((resolve) => {
    let remaining = 13;
    const sample = (timestamp) => {
      if (previous !== null) samples.push(timestamp - previous);
      previous = timestamp;
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    sampleCount: samples.length,
    samples,
    medianMs,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] || 0
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
  const child = spawn(process.execPath, [
    electronCli,
    ...foregroundChromiumSwitches,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "electron-main.cjs"
  ], {
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
    await client.send("Page.bringToFront");
    if (cpuProfileEnabled) {
      await client.send("Profiler.enable");
      await client.send("Profiler.start");
    }
    const ready = await waitForExpression(client, `window.__naimagePerformanceProbe?.profile === 'production-like' && window.__naimagePerformanceProbe.snapshot().rendererReady === true`, 120000);
    assert(ready, "Production-like renderer probe did not become ready.");
    await client.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await delay(interactiveSettleMs);
    const foregroundScheduler = await client.evaluate(foregroundSchedulerExpression);
    const workbenchReadyMs = Date.now() - startedAt;
    const startupSnapshot = await client.evaluate(`window.__naimagePerformanceProbe.snapshot()`);
    let imageLoadSnapshot = null;
    if (mixedAssets) {
      assert.equal(await waitForExpression(client, `Array.from(document.querySelectorAll('[data-canvas-node="true"] img')).some(i=>i.complete && i.naturalWidth>0)`, 20000), true, "mixed fixture actually decodes managed image bytes");
      imageLoadSnapshot = await client.evaluate(`({mounted:document.querySelectorAll('[data-canvas-node="true"] img').length,decoded:Array.from(document.querySelectorAll('[data-canvas-node="true"] img')).filter(i=>i.complete && i.naturalWidth>0).length})`);
    }
    let selectionSnapshot = null;
    if (selectAll) {
      await client.evaluate(`document.querySelector('[data-canvas-surface="true"]').dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',ctrlKey:true,bubbles:true,cancelable:true}))`);
      await delay(500);
      selectionSnapshot = await client.evaluate(`window.__naimagePerformanceProbe.snapshot()`);
      selectionSnapshot.selectionCount = await client.evaluate(`document.querySelector('[data-selection-ids]')?.dataset.selectionIds.split(' ').filter(Boolean).length || 0`);
      assert.equal(selectionSnapshot.selectionCount, fixtureNodeCount, "Ctrl+A uses the canonical selection owner");
    }
    const interactions = await client.evaluate(interactionExpression);
    const cpuProfile = cpuProfileEnabled ? (await client.send("Profiler.stop")).profile : null;
    const cpuProfilePath = cpuProfile ? join(roundDir, "renderer-interactions.cpuprofile") : null;
    if (cpuProfile && cpuProfilePath) writeJson(cpuProfilePath, cpuProfile);
    await delay(520);
    const finalSnapshot = await client.evaluate(`window.__naimagePerformanceProbe.snapshot()`);
    if (selectAll && typeof finalSnapshot.selectedNodeCount === "number") {
      assert.equal(finalSnapshot.selectedNodeCount, fixtureNodeCount, "interaction preserves every canonical selection");
      if (mixedAssets && finalSnapshot.viewport.scale <= 0.3 && fixtureNodeCount >= 100) {
        assert.ok(finalSnapshot.overviewNodeCount > 0, "dense secondary selections use the existing overview mode");
        assert.equal(finalSnapshot.selectedOverviewNodeCount, finalSnapshot.overviewNodeCount, "overview components retain selected state");
      }
    }
    const heap = await client.send("Runtime.getHeapUsage");
    const memory = [];
    let videoPlayback = null;
    if (memoryCycles || localVideo) {
      const endpoint = JSON.parse(readFileSync(join(configDir, "automation/endpoint.json"), "utf8"));
      const command = async (command, args = {}) => {
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/execute`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ command, args }) });
        const result = await response.json(); assert.equal(result.ok, true, command); return result.result ?? result.data;
      };
      const alternate = "secondary";
      if (localVideo) {
        await client.send("Network.enable");
        const path = await prepareLocalVideo(), encoded = readFileSync(path).toString("base64");
        const view = finalSnapshot.viewport;
        await command("canvas.import-video", { paths: [path], x: (100 - view.x) / view.scale, y: (100 - view.y) / view.scale });
        assert.equal(await waitForExpression(client, "document.querySelector('video')", 10000), true);
        const playable = await waitForExpression(client, "document.querySelector('video')?.readyState >= 2", 15000);
        if (!playable) {
          const media = await client.evaluate(`(async()=>{const v=document.querySelector('video'),probe=document.createElement('video');probe.muted=true;probe.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0))],{type:'video/webm'}));probe.load();await new Promise(r=>setTimeout(r,3000));const result={src:v?.currentSrc,canPlay:v?.canPlayType('video/webm;codecs=vp8'),blobReady:probe.readyState,blobError:probe.error?.code};URL.revokeObjectURL(probe.src);return result})()`);
          writeJson(join(roundDir, "media-failure.json"), { media, network: client.networkEvents });
        }
        assert.equal(playable, true, `local video decode: ${JSON.stringify(await client.evaluate(`(()=>{const v=document.querySelector('video');return{readyState:v?.readyState,error:v?.error?.message,code:v?.error?.code,networkState:v?.networkState}})()`))}`);
        videoPlayback = await client.evaluate(`(async()=>{const video=document.querySelector('video');video.muted=true;video.loop=true;await video.play();const before=video.currentTime;let waited=0;while(video.currentTime<=before+0.05 && waited<5000){await new Promise(r=>setTimeout(r,100));waited+=100;}return{before,after:video.currentTime,paused:video.paused,width:video.videoWidth,height:video.videoHeight,duration:video.duration,readyState:video.readyState,frames:video.getVideoPlaybackQuality().totalVideoFrames,waited}})()`);
        assert.ok(!videoPlayback.paused && videoPlayback.after > videoPlayback.before && videoPlayback.width === 640, `local managed video is actually playing: ${JSON.stringify(videoPlayback)}`);
        const visibleVideo = await client.evaluate(`(()=>{const r=document.querySelector('video').getBoundingClientRect(),c=document.querySelector('[data-canvas-surface="true"]').getBoundingClientRect();return r.right>c.left && r.left<c.right && r.bottom>c.top && r.top<c.bottom})()`);
        assert.equal(visibleVideo, true, "playing video intersects the actual canvas viewport");
        const videoShot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(roundDir, "local-video-playback.png"), Buffer.from(videoShot.data, "base64"));
        await command("canvas.select", { ids: [], expectedProjectId: "default" });
        await client.evaluate(`window.__perfLocalProgressEvents=0;window.__perfProgressUnsubscribe=window.naimageAgent.onProgress(()=>window.__perfLocalProgressEvents++)`);
        const progressWork = (async () => {
          for (let step = 0; step < 3; step++) {
            await command("agent.chat", { prompt: `本地性能文字进度 ${step + 1}，只回复文字，不要生成图片或调用工具。`, sourceNodeIds: [] });
            await delay(400);
          }
        })();
        videoPlayback.interactions = await client.evaluate(interactionExpression);
        await progressWork;
        videoPlayback.localProgressEvents = await client.evaluate(`window.__perfProgressUnsubscribe?.();window.__perfLocalProgressEvents`);
        assert.ok(videoPlayback.localProgressEvents > 0, "local mock Agent progress reaches Renderer during playback");
        videoPlayback.afterInteractions = await client.evaluate(`({time:document.querySelector('video')?.currentTime,paused:document.querySelector('video')?.paused,frames:document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames})`);
        assert.equal(videoPlayback.afterInteractions.paused, false, "canvas interactions coexist with playback");
        assert.ok(videoPlayback.afterInteractions.frames > videoPlayback.frames, "video frames continue while canvas interaction and local mock progress run");
        const continuingShot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(roundDir, "local-video-after-interactions.png"), Buffer.from(continuingShot.data, "base64"));
        await client.evaluate(`document.querySelector('video')?.pause()`);
        await delay(300);
        videoPlayback.afterPause = await client.evaluate(`({playing:Array.from(document.querySelectorAll('video')).filter(v=>!v.paused).length})`);
        assert.equal(videoPlayback.afterPause.playing, 0, "pause stops playback before virtualization releases its activity");
        await command("project.switch", { id: alternate });
        await delay(300);
        assert.equal(await client.evaluate(`document.querySelectorAll('video').length`), 0, "project switch releases old players");
        await command("project.switch", { id: "default" });
        await delay(300);
        videoPlayback.afterProjectReturn = await client.evaluate(`({playing:Array.from(document.querySelectorAll('video')).filter(v=>!v.paused).length})`);
        assert.equal(videoPlayback.afterProjectReturn.playing, 0, "playback activity is not persisted or restored across projects");
      }
      for (let cycle = 0; cycle < memoryCycles; cycle++) {
        await command("project.switch", { id: "default" });
        await command("canvas.select", { ids: ["P0001"], expectedProjectId: "default" });
        await delay(350);
        await client.evaluate(`document.querySelector('[data-canvas-node="true"][data-node-id="P0001"] [data-asset-index="0"]')?.click()`);
        const viewerOpen = await waitForExpression(client, `document.querySelector('[role="dialog"][aria-label="图片查看"]')`, 5000);
        assert.equal(viewerOpen, true, `each memory cycle opens the real image viewer: ${JSON.stringify(await client.evaluate(`({cycle:${cycle},tiles:document.querySelector('[data-canvas-node="true"][data-node-id="P0001"]')?.outerHTML.slice(0,3000),dialogs:Array.from(document.querySelectorAll('[role="dialog"]')).map(e=>e.getAttribute('aria-label'))})`))}`);
        await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await client.evaluate(interactionExpression);
        await command("project.switch", { id: alternate });
        await delay(350);
        const beforeGc = await client.send("Runtime.getHeapUsage");
        await client.send("HeapProfiler.collectGarbage");
        const afterGc = await client.send("Runtime.getHeapUsage");
        const native = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$items=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${child.pid}); do { $added=0; foreach($item in $items) { if($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added++ } } } while($added); $p=Get-Process -Id @($ids) -ErrorAction SilentlyContinue; [pscustomobject]@{count=$p.Count;privateBytes=($p|Measure-Object PrivateMemorySize64 -Sum).Sum;workingSetBytes=($p|Measure-Object WorkingSet64 -Sum).Sum}|ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true });
        memory.push({ cycle: cycle + 1, viewerOpen, heapBeforeGc: beforeGc.usedSize, heapAfterGc: afterGc.usedSize, native: native.status === 0 ? JSON.parse(native.stdout.trim()) : { error: "native memory sample failed" } });
      }
      await command("project.switch", { id: "default" });
    }
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    // Allow CDP to acknowledge evaluation before the normal close IPC destroys
    // the renderer. Even awaitPromise:false can race a synchronous window close.
    await client.evaluate(`void setTimeout(() => window.naimageConfig?.windowControl?.({ action: 'close' }), 100)`, false);
    let exit = await waitForChildExit(child, 8_000);
    if (!exit) {
      await forceKillProcessTree(child.pid);
      exit = await waitForChildExit(child, 2_000);
    }
    return {
      round,
      workbenchReadyMs,
      foregroundScheduler,
      startupSnapshot,
      selectionSnapshot,
      finalSnapshot,
      interactions,
      heap,
      memory,
      videoPlayback,
      imageLoadSnapshot,
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
  await prepareMediaFixtures();
  const buildArgs = [viteCli, "build", "--mode", "performance", "--outDir", bundleDir, "--emptyOutDir"];
  if (cpuProfileEnabled) buildArgs.push("--sourcemap");
  const build = reuseBundle ? { status: 0 } : spawnSync(process.execPath, buildArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
  assert.equal(build.status, 0, "Production-like renderer build failed.");
  const bundleFiles = filesRecursively(bundleDir);
  // CPU profiles need source maps for attribution, but source maps are not
  // shipped or loaded by the product. Keep their size as diagnostic evidence
  // instead of letting a profiling-only artifact fail the runtime bundle gate.
  const sourceMapFiles = bundleFiles.filter((filePath) => /\.map$/i.test(filePath));
  const runtimeBundleFiles = bundleFiles.filter((filePath) => !/\.map$/i.test(filePath));
  const bundleBytes = runtimeBundleFiles.reduce((total, filePath) => total + statSync(filePath).size, 0);
  const sourceMapBytes = sourceMapFiles.reduce((total, filePath) => total + statSync(filePath).size, 0);
  const sourceText = runtimeBundleFiles.filter((filePath) => /\.(?:js|html)$/i.test(filePath)).map((filePath) => readFileSync(filePath, "utf8")).join("\n");
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
    foregroundSchedulerHealthy: item.foregroundScheduler?.visibilityState === "visible" &&
      Number(item.foregroundScheduler?.sampleCount) === 12 &&
      Number(item.foregroundScheduler?.medianMs) <= budgets.visualFrameMedianMs,
    persistenceHealthy: Number(item.finalSnapshot.persistence?.failedWriteCount || 0) === 0,
    cleanExit: item.exit?.code === 0
  }));
  const runtimeBundleWithinAdvisoryBudget = bundleBytes <= budgets.runtimeBundleAdvisoryBytes;
  const checks = {
    productionLikeProfile: roundResults.every((item) => item.startupSnapshot.profile === "production-like"),
    minimalProbePresent: probePresent,
    fullAidebugAbsent: forbidden.length === 0,
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
    fixture: { nodeCount: fixtureNodeCount, relationCount: fixtureRelationCount, messageCount: fixtureMessageCount, mixedAssets, hubRelations, selectAll, media: mediaFixtures.map(({ width, mimeType }) => ({ width, mimeType })), memoryCycles, localVideo, managedAssetStorage: "distinct paths, hard links to deterministic source bytes" },
    environment: { node: process.version, electron: JSON.parse(readFileSync(join(repoRoot, "node_modules/electron/package.json"), "utf8")).version, inputContract: "canvas-v2-middle-pan", cache: "fresh isolated user-data per round; shared machine disk cache", theme: "dark", sourceBundleReused: Boolean(reuseBundle) },
    interactiveSettleMs,
    foregroundChromiumSwitches,
    runDir,
    reportPath,
    bundle: {
      dir: bundleDir,
      bytes: bundleBytes,
      sha256: bundleSha256,
      fileCount: runtimeBundleFiles.length,
      sourceMapBytes,
      sourceMapFileCount: sourceMapFiles.length,
      totalFileCount: bundleFiles.length,
      advisoryBudgetBytes: budgets.runtimeBundleAdvisoryBytes,
      withinAdvisoryBudget: runtimeBundleWithinAdvisoryBudget,
      forbidden,
      probePresent
    },
    advisories: runtimeBundleWithinAdvisoryBudget
      ? []
      : [{
          code: "runtime-bundle-advisory-exceeded",
          bytes: bundleBytes,
          budgetBytes: budgets.runtimeBundleAdvisoryBytes,
          message: "Total runtime output exceeded its trend budget; first-load, plugin and CSS hard limits remain owned by test:bundle."
        }],
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
  if (!existsSync(reportPath)) writeJson(reportPath, { ok: false, incomplete: true, error: String(error.stack || error) });
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
