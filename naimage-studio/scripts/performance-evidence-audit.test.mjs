import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const auditPath = resolve(scriptDir, "performance-evidence-audit.mjs");
const phases = ["nodes200", "interactions", "nodes1000", "longTimeline", "streamingTimeline", "imageContainer10", "fixtureCleanup"];

function phaseMetric(index) {
  const startedAt = index * 10;
  return {
    status: "measured",
    source: "performance-observer-longtask",
    startedAt,
    endedAt: startedAt + 5,
    durationMs: 5,
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    entries: [],
  };
}

function visualCheckpoint(name) {
  const observed = name === "imageContainer10"
    ? { runtimeNodeCount: 1, renderedImageCount: 10, loadedImageCount: 10 }
    : name === "nodes1000"
      ? { runtimeNodeCount: 1000, relationCount: 199, domNodeCount: 20, selectedNodeId: "aidebug-performance-visual-node-1000", selectedRendered: true, selectedVisibleRatio: 1 }
      : name === "longTimeline"
        ? { runtimeMessageCount: 500, domMessageCount: 80, toolStartCount: 40, toolCompleteCount: 40, feedPresent: true, feedBottomGap: 0 }
        : { runtimeMessageCount: 1, domMessageCount: 1, payloadExactMatch: true, finalStatus: "done", runningMessageCount: 0, feedPresent: true, feedBottomGap: 0 };
  return {
    status: "measured",
    reason: "",
    label: name,
    path: `${name}.png`,
    screenshotSource: "cdp-dual-frame",
    screenshotBytes: 4096,
    screenshotSha256: "a".repeat(64),
    dualFrameStable: true,
    stateStable: true,
    visualReliabilityOk: true,
    stateIssueCount: 0,
    captureIssueCount: 0,
    overflowCount: 0,
    observed,
  };
}

function validReport() {
  const commits = Object.fromEntries(phases.map((phase) => [phase, 1]));
  return {
    ok: true,
    mode: "performance-suite",
    baselineOnly: true,
    performance: {
      schemaVersion: 2,
      baselineOnly: true,
      productPerformanceReady: false,
      environment: { profile: "development", fullAidebugControlPlane: true },
      coldStart: { status: "measured" },
      fixtures: {
        nodes200: { status: "measured", hydratedNodeCount: 200, renderedNodeCount: 20, projectionRatio: 0.1 },
        nodes1000: {
          status: "measured", reason: "", durationMs: 10,
          requestedNodeCount: 1000, hydratedNodeCount: 1000,
          requestedRelationCount: 199, hydratedRelationCount: 199,
          renderedNodeCount: 100, projectionRatio: 0.1, projectionMode: "viewport-projected",
          selectedNodeId: "aidebug-performance-node-1000-1000", selectedLastRendered: true, selectedLastVisibleRatio: 1,
          selectedLastGeometry: { left: 1, top: 1, right: 101, bottom: 101, width: 100, height: 100 },
          renderCommits: { canvas: 1, agentFeed: 1, composer: 1 },
        },
        longTimeline: {
          status: "measured", reason: "", durationMs: 10,
          requestedMessageCount: 500, renderWindowSize: 80, runtimeMessageCount: 500, domMessageCount: 80,
          toolStartCompletePairCount: 50, visibleToolPairCount: 40, toolTraceDomCount: 80, toolStartDomCount: 40, toolCompleteDomCount: 40,
          feedPresent: true, composerPresent: true, inputObserved: true, inputLatencyMs: 1,
          feedScrollTop: 100, feedScrollHeight: 500, feedClientHeight: 400, feedBottomGap: 0,
          renderCommits: { canvas: 1, agentFeed: 1, composer: 1 },
        },
        streamingTimeline: {
          status: "measured", reason: "", durationMs: 10,
          requestedDeltaCount: 1000, acceptedDeltaCount: 1000,
          runtimeMessageCount: 1, domMessageCount: 1, finalMarkerPresent: true, finalStatus: "done", runningMessageCount: 0,
          feedPresent: true, payloadExactMatch: true, expectedPayloadLength: 6028, runtimePayloadLength: 6028, feedBottomGap: 0,
          renderCommits: { canvas: 1, agentFeed: 1, composer: 1 },
        },
        imageContainer10: {
          status: "measured", durationMs: 10,
          requestedImageCount: 10, renderedImageCount: 10, loadedImageCount: 10,
          canvasUsesThumbnails: true, thumbnailDimensionsBounded: true, viewerUsesOriginal: true, viewerStripUsesThumbnails: true,
          coldThumbnailOk: true, warmThumbnailOk: true, thumbnailEvidenceOk: true,
          canvasImageSources: Array.from({ length: 10 }, (_, index) => `naimage-asset://fixture-${index}.png?preview=thumbnail&max=512`),
          canvasNaturalSizes: Array.from({ length: 10 }, () => ({ width: 512, height: 288 })),
          viewerMainSource: "naimage-asset://fixture-0.png",
          viewerStripSources: ["naimage-asset://fixture-0.png?preview=thumbnail&max=512"],
          coldThumbnailStats: { requests: 10, workerStarts: 10, generated: 10, errors: 0, recentErrors: [], maxActiveWorkers: 2 },
          warmThumbnailStats: { requests: 10, cacheHits: 10, workerStarts: 0, generated: 0, errors: 0, recentErrors: [] },
          thumbnailDiskCache: { status: "measured", sourceAssetCount: 10, sourceBytes: 10000, thumbnailCount: 10, thumbnailBytes: 1000, stagingFileCount: 0 },
        },
        imageThumbnailCold: { status: "measured" },
        imageThumbnailWarm: { status: "measured" },
      },
      visualCheckpoints: {
        imageContainer10: visualCheckpoint("imageContainer10"),
        nodes1000: visualCheckpoint("nodes1000"),
        longTimeline: visualCheckpoint("longTimeline"),
        streamingTimeline: visualCheckpoint("streamingTimeline"),
      },
      interactions: {
        pan: { status: "measured", effectObserved: true, p95Ms: 5 },
        zoom: { status: "measured", effectObserved: true, p95Ms: 5 },
        drag: { status: "measured", effectObserved: true, p95Ms: 5 },
      },
      rendererCommits: {
        canvas: { status: "measured", ...commits },
        agentFeed: { status: "measured", ...commits },
        composer: { status: "measured", ...commits },
      },
      imagePipeline: { requestCount: 20, originalBytes: 10000, thumbnailBytes: 1000, cacheHits: 10, maxConcurrentWorkers: 2 },
      persistence: {
        largeProject: { status: "measured" },
        writeCount: 2,
        coalescedWriteCount: 1,
        flushMs: 5,
        mutationCount: 3,
        scheduledWriteCount: 3,
        pendingWriteCount: 0,
        skippedWriteCount: 0,
        failedWriteCount: 0,
        maxFlushMs: 6,
        lastFlushMs: 4,
        source: "renderer-debounce-and-session-commit-roundtrip"
      },
      memory: {
        afterFixtureCleanup: {
          status: "measured", source: "cdp-runtime-get-heap-usage",
          baselineBeforeBytes: 1000, beforeCleanupBytes: 3000, afterCleanupBytes: 1500,
          retainedDeltaBytes: 500, reclaimedBytes: 1500,
          garbageCollection: { status: "measured", completed: true, completedPasses: 3 },
          cleanupState: { ok: true, waitOk: true, runtimeNodeCount: 0, domNodeCount: 0, runtimeMessageCount: 0, domMessageCount: 0, edgeCount: 0, selectedNodeCount: 0, settledFrames: 8, settleMs: 20 },
        },
      },
      phaseLongTasks: { support: { status: "measured", supported: true }, ...Object.fromEntries(phases.map((phase, index) => [phase, phaseMetric(index)])) },
      longTasks: { status: "measured", count: 0, maxDurationMs: 0 },
      save: { status: "measured", payloadNodeCount: 200 },
    },
  };
}

function validProductReport() {
  const budgets = {
    workbenchReadyMs: 3500,
    rendererBootMs: 2500,
    bundleBytes: 1200000,
    heapBytes: 160 * 1024 * 1024,
    maxMountedNodes: 80,
    zoomP95Ms: 34,
    panP95Ms: 34,
    dragP95Ms: 34,
    visualFrameP95Ms: 150,
    visualFrameMedianMs: 34,
    visualSlowFrameRate: 0.15,
    longTaskMaxMs: 120,
  };
  const interaction = (count) => ({
    samples: Array.from({ length: count }, () => 0.5),
    p95: 0.5,
    frameSamples: Array.from({ length: count }, () => 7),
    frameP95: 7,
    frameMedian: 7,
    slowFrameRate: 0,
  });
  const rounds = Array.from({ length: 3 }, (_item, index) => ({
    round: index + 1,
    workbenchReadyMs: 1200,
    startupSnapshot: {
      profile: "production-like",
      rendererReady: true,
      canvasViewportReady: true,
      bootMs: 780,
      nodeCount: 1000,
      parentedNodeCount: 199,
      canvasNodeCount: 1000,
      domNodeCount: 24,
      messageCount: 500,
      domMessageCount: 80,
      selectedNodeId: "P1000",
      selectedNodeMounted: true,
      documentOverflowX: false,
    },
    finalSnapshot: { persistence: { failedWriteCount: 0 } },
    interactions: {
      zoom: interaction(24),
      pan: interaction(18),
      drag: interaction(16),
      longTasks: { count: 0, maxMs: 0, entries: [] },
    },
    heap: { usedSize: 16 * 1024 * 1024 },
    screenshotBytes: 4096,
    exit: { code: 0, signal: null },
  }));
  const checks = Object.fromEntries([
    "productionLikeProfile", "minimalProbePresent", "fullAidebugAbsent", "bundleWithinBudget",
    "workbenchWithinBudget", "rendererBootWithinBudget", "heapWithinBudget", "zoomWithinBudget",
    "panWithinBudget", "dragWithinBudget", "visualFramesWithinBudget", "visualFrameMedianWithinBudget",
    "visualSlowFrameRateWithinBudget", "longTasksWithinBudget", "everyRoundHealthy"
  ].map((key) => [key, true]));
  return {
    schemaVersion: 1,
    ok: true,
    profile: "production-like",
    baselineOnly: false,
    productPerformanceReady: true,
    evidenceScope: "product-gate",
    diagnosticOnly: false,
    fixture: { nodeCount: 1000, relationCount: 199, messageCount: 500 },
    bundle: { bytes: 860000, sha256: "b".repeat(64), fileCount: 5, forbidden: [], probePresent: true },
    budgets,
    aggregate: {
      rounds: 3,
      workbenchReadyMs: 1200,
      rendererBootMs: 780,
      heapBytes: 16 * 1024 * 1024,
      zoomP95Ms: 0.5,
      panP95Ms: 0.5,
      dragP95Ms: 0.5,
      zoomFrameP95Ms: 7,
      panFrameP95Ms: 7,
      dragFrameP95Ms: 7,
      zoomFrameMedianMs: 7,
      panFrameMedianMs: 7,
      dragFrameMedianMs: 7,
      visualSlowFrameRate: 0,
      longTaskMaxMs: 0,
    },
    checks,
    rounds,
  };
}

function runAudit(report) {
  const directory = mkdtempSync(join(tmpdir(), "naimage-performance-audit-"));
  const reportPath = join(directory, "report.json");
  writeFileSync(reportPath, JSON.stringify(report));
  const result = spawnSync(process.execPath, [auditPath, `--report=${reportPath}`, "--strict"], { encoding: "utf8" });
  rmSync(directory, { recursive: true, force: true });
  return { status: result.status, audit: JSON.parse(result.stdout), stderr: result.stderr };
}

test("complete semantic v2 report passes strict truth audit without becoming a product gate", () => {
  const result = runAudit(validReport());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.audit.ok, true);
  assert.equal(result.audit.truthContractReady, true);
  assert.equal(result.audit.productPerformanceReady, false);
  assert.equal(result.audit.evidenceScope, "development-baseline");
});

test("slow drag remains a visible warning without invalidating evidence truth", () => {
  const report = validReport();
  report.performance.interactions.drag.p95Ms = 34.6;
  const result = runAudit(report);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.audit.ok, true);
  assert(result.audit.findings.some((finding) => finding.rule === "drag-p95-exceeds-one-frame"));
});

test("production-like product gate passes the strict audit as authoritative evidence", () => {
  const result = runAudit(validProductReport());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.audit.ok, true);
  assert.equal(result.audit.productPerformanceReady, true);
  assert.equal(result.audit.evidenceScope, "product-gate");
  assert.equal(result.audit.reportMode, "product-performance-gate");
});

test("diagnostic product profile cannot masquerade as an authoritative gate", () => {
  const report = validProductReport();
  report.diagnosticOnly = true;
  const result = runAudit(report);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.audit.ok, false);
  assert(result.audit.findings.some((finding) => finding.rule === "product-diagnostic-report-not-authoritative"));
});

test("product frame samples and declared slow-frame rate must agree", () => {
  const report = validProductReport();
  report.rounds[0].interactions.zoom.frameSamples[0] = 200;
  const result = runAudit(report);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.audit.ok, false);
  assert(result.audit.findings.some((finding) => finding.rule === "product-frame-p95-invalid" || finding.rule === "product-slow-frame-rate-invalid"));
});

const invalidCases = [
  ["shallow measured nodes fixture", (report) => { report.performance.fixtures.nodes1000 = { status: "measured" }; }],
  ["wrong long timeline count", (report) => { report.performance.fixtures.longTimeline.domMessageCount = 79; }],
  ["unapplied streaming payload", (report) => { report.performance.fixtures.streamingTimeline.payloadExactMatch = false; }],
  ["uncleared runtime node", (report) => { report.performance.memory.afterFixtureCleanup.cleanupState.runtimeNodeCount = 1; }],
  ["missing phase evidence", (report) => { delete report.performance.phaseLongTasks.streamingTimeline; }],
  ["fallback visual checkpoint", (report) => { report.performance.visualCheckpoints.nodes1000.screenshotSource = "fallback"; }],
  ["thumbnail cold error", (report) => { report.performance.fixtures.imageContainer10.coldThumbnailStats.errors = 1; report.performance.fixtures.imageContainer10.coldThumbnailStats.recentErrors = [{ code: "THUMBNAIL_WORKER_EXITED" }]; }],
  ["legacy schema", (report) => { report.performance.schemaVersion = 1; }],
];

for (const [name, mutate] of invalidCases) {
  test(`${name} fails strict truth audit`, () => {
    const report = validReport();
    mutate(report);
    const result = runAudit(report);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.audit.ok, false);
    assert.ok(result.audit.counts.missing > 0);
  });
}
