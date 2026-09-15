"use strict";

const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const sharp = require("sharp");
const { createAgentRuntime, normalizedTaskScope } = require("../agent-runtime.cjs");
const { createAgentRunControl } = require("../desktop/agent-run-control.cjs");
const { registerAgentIpc } = require("../desktop/ipc/agent-ipc.cjs");
const { createGoalProbeAdmission } = require("../runtime/goal-probe-admission.cjs");

sharp.cache(false);

const repoRoot = path.resolve(__dirname, "..");
const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-goal-dual-renderer-"));
const userDataRoot = path.join(testRoot, "user-data");
const preloadPath = path.join(repoRoot, "preload.cjs");
const windows = new Set();
const calls = [];
let crashMode = false;
let crashRelease = null;
let crashStartedResolve;
let crashStarted = new Promise((resolve) => { crashStartedResolve = resolve; });
let retryMode = true;
let retryRelease = null;
let retryStartedResolve;
let retryStarted = new Promise((resolve) => { retryStartedResolve = resolve; });
let activeRequests = 0;
let maximumActiveRequests = 0;
let trackedTransportPromises = 0;

mkdirSync(userDataRoot, { recursive: true });
app.setPath("userData", userDataRoot);
app.disableHardwareAcceleration();

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
    })
  ]);
}

async function writePng(filePath, color) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: color }
  }).png().toFile(filePath);
}

function goalFixture(label, projectId, count = 2) {
  const sourceAssets = Array.from({ length: count }, (_item, index) => index + 1).map((number) => ({
    bindingId: `binding-${label.toLowerCase()}-${number}`,
    assetId: `asset-${label.toLowerCase()}-${number}`,
    displayCode: `${label}${number}`,
    role: "source",
    name: `${label}${number}.png`,
    assetIndex: 0,
    containerSlot: 0,
    ownerAssetIndex: 0,
    ownerNodeId: `${label}-NODE-${number}`,
    nodeId: `${label}-NODE-${number}`,
    containerId: `${label}-CONTAINER-${number}`,
    path: path.join(testRoot, "sources", `${label}${number}.png`),
    mimeType: "image/png"
  }));
  const nodes = sourceAssets.map((source) => ({
    id: source.nodeId,
    type: "image",
    status: "done",
    assets: [{ assetId: source.assetId, path: source.path, mimeType: source.mimeType, title: source.name }]
  }));
  const scope = normalizedTaskScope({ taskScope: {
    version: 2,
    origin: "goal",
    scopeType: "container-group",
    canvasRevision: 1,
    sourceNodeIds: sourceAssets.map((source) => source.nodeId),
    sourceContainerIds: sourceAssets.map((source) => source.containerId),
    referenceContainerIds: [],
    sourceBindingIds: sourceAssets.map((source) => source.bindingId),
    referenceBindingIds: [],
    sourceAssets,
    referenceAssets: [],
    resultPolicy: "grouped-by-container",
    confirmationPolicy: "direct",
    goal: {
      version: 1,
      target: "all-image-containers",
      frozen: true,
      containerIds: sourceAssets.map((source) => source.containerId),
      bindingIds: sourceAssets.map((source) => source.bindingId),
      containerCount: sourceAssets.length,
      bindingCount: sourceAssets.length,
      configuredConcurrency: 4,
      probeContainerCount: 2,
      operationsPerAsset: 1,
      requestCount: sourceAssets.length
    },
    sourceAssetCount: sourceAssets.length,
    referenceAssetCount: 0,
    truncated: false
  } });
  return { label, projectId, sourceAssets, nodes, scope };
}

function runPayload(fixture, runId) {
  return {
    name: "image_gen",
    runId,
    projectId: fixture.projectId,
    conversationId: `${runId}-conversation`,
    nodes: fixture.nodes,
    taskScope: fixture.scope,
    input: {
      operation: "edit",
      prompt: `Keep ${fixture.label} unchanged and use clean studio light.`,
      size: "128x128",
      count: 1,
      scopeExecution: "all-goal-sources"
    }
  };
}

async function createRenderer(name) {
  const window = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    title: `goal-renderer-${name}`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  windows.add(window);
  window.once("closed", () => windows.delete(window));
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<title>${name}</title><main>${name}</main>`)}`);
  const ready = await window.webContents.executeJavaScript(
    "Boolean(window.naimageAgent && typeof window.naimageAgent.runTool === 'function')",
    true
  );
  assert.equal(ready, true, `${name} must receive the production naimageAgent preload bridge.`);
  return window;
}

function runTool(window, payload) {
  const serialized = JSON.stringify(JSON.stringify(payload));
  return window.webContents.executeJavaScript(
    `window.naimageAgent.runTool(JSON.parse(${serialized}))`,
    true
  );
}

async function main() {
  await app.whenReady();
  const fixtures = {
    A: goalFixture("A", "project-a", 6),
    B: goalFixture("B", "project-b", 6),
    C: goalFixture("C", "project-c")
  };
  await Promise.all(Object.values(fixtures).flatMap((fixture, fixtureIndex) => (
    fixture.sourceAssets.map((source, sourceIndex) => writePng(source.path, {
      r: 40 + fixtureIndex * 50,
      g: 70 + sourceIndex * 40,
      b: 150,
      alpha: 1
    }))
  )));

  const admission = createGoalProbeAdmission();
  const runControl = createAgentRunControl();
  const settings = {
    imageModel: "mock-image-model",
    imageModelPool: ["mock-image-model"],
    imageBatchSize: 4,
    imageSize: "128x128",
    imageQuality: "auto"
  };
  const runtime = createAgentRuntime({
    projectRoot: testRoot,
    configDir: path.join(testRoot, "config"),
    goalProbeAdmission: admission,
    serverGenerateImage: (request) => {
      const sourceName = path.basename(request.editImage?.path || "unknown");
      calls.push(sourceName);
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      const transportPromise = (async () => {
        try {
          if (crashMode && sourceName === "C1.png") {
            crashStartedResolve();
            await new Promise((resolve) => { crashRelease = resolve; });
          } else if (retryMode && sourceName === "A3.png") {
            request.onRetry?.({ category: "rate_limit", retryCount: 1, maxRetries: 5, status: 429, index: 0, count: 1 });
            retryStartedResolve();
            await new Promise((resolve) => { retryRelease = resolve; });
          } else {
            await delay(12);
          }
          const outputPath = path.join(testRoot, "outputs", `${request.runId}-${sourceName}`);
          await writePng(outputPath, { r: 20, g: 170, b: 95, alpha: 1 });
          return {
            ok: true,
            model: "mock-image-model",
            size: "128x128",
            assets: [{ path: outputPath, mimeType: "image/png", runId: request.runId }]
          };
        } finally {
          activeRequests -= 1;
        }
      })();
      request.onTransportPromise?.(transportPromise, { index: 0, count: 1, attempt: 1 });
      trackedTransportPromises += typeof request.onTransportPromise === "function" ? 1 : 0;
      return transportPromise;
    }
  });

  registerAgentIpc({
    ipcMain,
    currentAgentSettings: () => settings,
    getAgentRuntime: () => runtime,
    log: () => {},
    listAgentModels: async () => ({ ok: true, models: ["mock-image-model"] }),
    emitAgentProgress: () => {},
    agentRunControl: runControl,
    aidebugMode: false
  });

  const rendererA = await createRenderer("A");
  const rendererB = await createRenderer("B");

  const fairnessStart = calls.length;
  const resultAPromise = runTool(rendererA, runPayload(fixtures.A, "goal-run-a"));
  const resultBPromise = runTool(rendererB, runPayload(fixtures.B, "goal-run-b"));
  await withTimeout(retryStarted, 5_000, "cross-Renderer retry hold");
  await delay(45);
  const beforeRetryRelease = calls.slice(fairnessStart);
  assert.equal(
    beforeRetryRelease.some((name) => /^[AB][56]\.png$/.test(name)),
    false,
    "No Goal may dispatch its next ramp wave while another Goal is retrying"
  );
  retryRelease?.();
  const [resultA, resultB] = await withTimeout(Promise.all([resultAPromise, resultBPromise]), 12_000, "dual Renderer process Goal execution");
  retryMode = false;
  assert.equal(resultA.envelope.ok, true);
  assert.equal(resultB.envelope.ok, true);
  const fairnessCalls = calls.slice(fairnessStart, fairnessStart + 4);
  assert.equal(fairnessCalls.length, 4);
  assert.equal(fairnessCalls[0][0], fairnessCalls[1][0], "The first admitted Renderer must finish both probes before the second starts");
  assert.equal(fairnessCalls[2][0], fairnessCalls[3][0], "The queued Renderer must retain its own serial probe order");
  assert.notEqual(fairnessCalls[0][0], fairnessCalls[2][0], "Two Renderer probe sets must not overlap");
  assert.deepEqual(new Set(fairnessCalls), new Set(["A1.png", "A2.png", "B1.png", "B2.png"]));
  assert.equal(resultA.envelope.batchSafety.admission.mode, "process-goal");
  assert.equal(resultA.envelope.batchSafety.admission.admitted, true);
  assert.equal(
    Math.max(
      resultA.envelope.batchSafety.admission.queueDepthAtEnqueue,
      resultB.envelope.batchSafety.admission.queueDepthAtEnqueue
    ) >= 1,
    true,
    "One Renderer must report that it queued behind the other"
  );
  assert.equal(admission.snapshot().active, null);
  assert.equal(maximumActiveRequests <= settings.imageBatchSize, true, "All Renderer Goals must share the process capacity");
  assert.equal(trackedTransportPromises >= 12, true, "Every billable Goal request must expose its real transport Promise");

  crashMode = true;
  crashStarted = new Promise((resolve) => { crashStartedResolve = resolve; });
  const rendererCrash = await createRenderer("crash");
  const crashInvocation = runTool(rendererCrash, runPayload(fixtures.C, "goal-run-crash")).catch((error) => ({
    rendererDestroyed: true,
    error: String(error?.message || error)
  }));
  await withTimeout(crashStarted, 4_000, "crash Renderer first probe");
  const queuedStart = calls.length;
  const queuedB = runTool(rendererB, runPayload(fixtures.B, "goal-run-after-crash"));
  await delay(40);
  assert.deepEqual(calls.slice(queuedStart), [], "A second Renderer must remain queued while the crashed owner holds admission");
  rendererCrash.destroy();
  await delay(45);
  assert.deepEqual(calls.slice(queuedStart), [], "Destroying a Renderer must not release capacity before its provider Promise settles");
  crashRelease?.();
  const recovered = await withTimeout(queuedB, 8_000, "queued Goal after crashed provider drain");
  assert.equal(recovered.envelope.ok, true);
  assert.deepEqual(new Set(calls.slice(queuedStart)), new Set(["B1.png", "B2.png", "B3.png", "B4.png", "B5.png", "B6.png"]));
  assert.equal(admission.snapshot().active, null);
  assert.deepEqual(admission.snapshot().queued, []);
  assert.equal(runControl.snapshot().runs.length, 0, "Renderer destruction must not leave an owned run behind");
  await Promise.race([crashInvocation, delay(100)]);

  runtime.dispose();
  admission.dispose("selftest complete");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    realRendererWindows: 3,
    processGoalAdmission: true,
    zeroCrossRendererProbeOverlap: true,
    fairRampSharing: true,
    retryHoldsRamp: true,
    globalCapacity: true,
    crashDrainsProviderBeforeRelease: true,
    preloadBridge: true
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}).finally(async () => {
  crashRelease?.();
  for (const window of [...windows]) {
    if (!window.isDestroyed()) window.destroy();
  }
  for (const channel of [
    "naimage:agent:tools",
    "naimage:agent:list-models",
    "naimage:agent:run-tool",
    "naimage:agent:compose-image-prompt",
    "naimage:agent:chat",
    "naimage:agent:pause",
    "naimage:agent:resume",
    "naimage:agent:stop",
    "naimage:agent:steer",
    "naimage:agent:run-status",
    "naimage:agent:compact",
    "naimage:agent:memory-check",
    "naimage:agent:memory-read",
    "naimage:agent:main-prompt:get",
    "naimage:agent:main-prompt:save",
    "naimage:agent:main-prompt:reset",
    "naimage:agent:fast-memory:get",
    "naimage:agent:fast-memory:save",
    "naimage:agent:fast-memory:reset",
    "naimage:agent:clear-conversation",
    "naimage:agent:smoke",
    "naimage:agent:cancel-pending-execution"
  ]) ipcMain.removeHandler(channel);
  await new Promise((resolve) => setTimeout(resolve, 80));
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  app.exit(process.exitCode || 0);
});
