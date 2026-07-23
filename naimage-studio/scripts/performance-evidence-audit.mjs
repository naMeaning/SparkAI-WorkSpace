import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const diagnosticsRoot = join(projectRoot, ".diagnostics", "electron");
const args = process.argv.slice(2);
const explicitReport = args.find((item) => item.startsWith("--report="))?.slice("--report=".length) || "";
const strict = args.includes("--strict");

function latestPerformanceReport() {
  if (!existsSync(diagnosticsRoot)) throw new Error(`Performance diagnostics directory does not exist: ${diagnosticsRoot}`);
  const candidates = [];
  for (const entry of readdirSync(diagnosticsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(diagnosticsRoot, entry.name, "report.json");
    if (!existsSync(reportPath)) continue;
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      if (report?.mode === "performance-suite" || report?.evidenceScope === "product-gate") {
        candidates.push({ path: reportPath, mtimeMs: statSync(reportPath).mtimeMs });
      }
    } catch {
      // Ignore unrelated or incomplete diagnostic folders.
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!candidates.length) throw new Error("No performance-suite report.json was found.");
  return candidates[0].path;
}

function readPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

function measured(value) {
  return value?.status === "measured";
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function integer(value) {
  return Number.isInteger(Number(value));
}

function approximately(left, right, tolerance = 0.001) {
  return finite(left) && finite(right) && Math.abs(Number(left) - Number(right)) <= tolerance;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function medianNumbers(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function auditProductGateReport(report, reportPath) {
  const findings = [];
  const record = (level, rule, detail) => findings.push({ level, rule, detail });
  const requireValue = (condition, rule, detail) => {
    if (!condition) record("error", rule, detail);
  };
  const fixture = report?.fixture || {};
  const budgets = report?.budgets || {};
  const aggregate = report?.aggregate || {};
  const rounds = Array.isArray(report?.rounds) ? report.rounds : [];
  const requiredChecks = [
    "productionLikeProfile", "minimalProbePresent", "fullAidebugAbsent", "bundleWithinBudget",
    "workbenchWithinBudget", "rendererBootWithinBudget", "heapWithinBudget", "zoomWithinBudget",
    "panWithinBudget", "dragWithinBudget", "visualFramesWithinBudget", "visualFrameMedianWithinBudget",
    "visualSlowFrameRateWithinBudget", "longTasksWithinBudget", "everyRoundHealthy"
  ];

  requireValue(Number(report?.schemaVersion) >= 1, "product-schema-invalid", { value: report?.schemaVersion ?? null });
  requireValue(report?.profile === "production-like", "product-profile-invalid", { value: report?.profile ?? null });
  requireValue(report?.evidenceScope === "product-gate", "product-scope-invalid", { value: report?.evidenceScope ?? null });
  requireValue(report?.baselineOnly === false, "product-baseline-flag-invalid", { value: report?.baselineOnly ?? null });
  requireValue(report?.diagnosticOnly === false, "product-diagnostic-report-not-authoritative", { value: report?.diagnosticOnly ?? null });
  requireValue(report?.ok === true && report?.productPerformanceReady === true, "product-ready-flag-invalid", { ok: report?.ok, productPerformanceReady: report?.productPerformanceReady });
  requireValue(Number(fixture.nodeCount) === 1000 && Number(fixture.relationCount) === 199 && Number(fixture.messageCount) === 500, "product-fixture-invalid", fixture);
  requireValue(Array.isArray(report?.bundle?.forbidden) && report.bundle.forbidden.length === 0, "product-bundle-aidebug-leak", { forbidden: report?.bundle?.forbidden ?? null });
  requireValue(report?.bundle?.probePresent === true, "product-probe-missing", { probePresent: report?.bundle?.probePresent });
  requireValue(/^[a-f0-9]{64}$/i.test(String(report?.bundle?.sha256 || "")), "product-bundle-digest-invalid", { sha256: report?.bundle?.sha256 ?? null });
  requireValue(finite(report?.bundle?.bytes) && Number(report.bundle.bytes) > 0 && Number(report.bundle.bytes) <= Number(budgets.bundleBytes), "product-bundle-budget-invalid", { bytes: report?.bundle?.bytes, budget: budgets.bundleBytes });
  requireValue(rounds.length >= 3 && Number(aggregate.rounds) === rounds.length, "product-round-count-invalid", { aggregateRounds: aggregate.rounds, actualRounds: rounds.length });
  for (const check of requiredChecks) requireValue(report?.checks?.[check] === true, "product-check-failed", { check, value: report?.checks?.[check] ?? null });

  const interactionNames = ["zoom", "pan", "drag"];
  const expectedSamples = { zoom: 24, pan: 18, drag: 16 };
  const handlerBudgets = { zoom: budgets.zoomP95Ms, pan: budgets.panP95Ms, drag: budgets.dragP95Ms };
  for (const [index, round] of rounds.entries()) {
    const startup = round?.startupSnapshot || {};
    requireValue(Number(round?.round) === index + 1, "product-round-index-invalid", { index, value: round?.round });
    requireValue(startup.rendererReady === true && startup.canvasViewportReady === true, "product-round-not-ready", { round: round?.round, rendererReady: startup.rendererReady, canvasViewportReady: startup.canvasViewportReady });
    requireValue(Number(startup.nodeCount) === 1000 && Number(startup.canvasNodeCount) === 1000 && Number(startup.parentedNodeCount) === 199, "product-round-node-truth-invalid", { round: round?.round, nodeCount: startup.nodeCount, canvasNodeCount: startup.canvasNodeCount, parentedNodeCount: startup.parentedNodeCount });
    requireValue(Number(startup.domNodeCount) > 0 && Number(startup.domNodeCount) <= Number(budgets.maxMountedNodes), "product-round-virtualization-invalid", { round: round?.round, domNodeCount: startup.domNodeCount, budget: budgets.maxMountedNodes });
    requireValue(startup.selectedNodeId === "P1000" && startup.selectedNodeMounted === true, "product-round-selection-invalid", { round: round?.round, selectedNodeId: startup.selectedNodeId, selectedNodeMounted: startup.selectedNodeMounted });
    requireValue(Number(startup.messageCount) === 500 && Number(startup.domMessageCount) === 80, "product-round-message-window-invalid", { round: round?.round, messageCount: startup.messageCount, domMessageCount: startup.domMessageCount });
    requireValue(startup.documentOverflowX === false, "product-round-horizontal-overflow", { round: round?.round });
    requireValue(round?.exit?.code === 0, "product-round-exit-invalid", { round: round?.round, exit: round?.exit ?? null });
    requireValue(finite(round?.screenshotBytes) && Number(round.screenshotBytes) > 0, "product-round-screenshot-missing", { round: round?.round, screenshotBytes: round?.screenshotBytes });
    requireValue(finite(round?.heap?.usedSize) && Number(round.heap.usedSize) > 0 && Number(round.heap.usedSize) <= Number(budgets.heapBytes), "product-round-heap-invalid", { round: round?.round, heapBytes: round?.heap?.usedSize, budget: budgets.heapBytes });
    requireValue(Number(round?.finalSnapshot?.persistence?.failedWriteCount || 0) === 0, "product-round-persistence-failed", { round: round?.round, persistence: round?.finalSnapshot?.persistence ?? null });

    for (const name of interactionNames) {
      const metric = round?.interactions?.[name] || {};
      const samples = Array.isArray(metric.samples) ? metric.samples : [];
      const frameSamples = Array.isArray(metric.frameSamples) ? metric.frameSamples : [];
      const expected = expectedSamples[name];
      requireValue(samples.length === expected && samples.every(finite), "product-handler-samples-invalid", { round: round?.round, interaction: name, count: samples.length, expected });
      requireValue(frameSamples.length === expected && frameSamples.every(finite), "product-frame-samples-invalid", { round: round?.round, interaction: name, count: frameSamples.length, expected });
      requireValue(approximately(metric.p95, percentile(samples, 0.95), 0.1) && Number(metric.p95) <= Number(handlerBudgets[name]), "product-handler-p95-invalid", { round: round?.round, interaction: name, p95: metric.p95, computed: percentile(samples, 0.95), budget: handlerBudgets[name] });
      requireValue(approximately(metric.frameP95, percentile(frameSamples, 0.95), 0.1) && Number(metric.frameP95) <= Number(budgets.visualFrameP95Ms), "product-frame-p95-invalid", { round: round?.round, interaction: name, p95: metric.frameP95, computed: percentile(frameSamples, 0.95), budget: budgets.visualFrameP95Ms });
      requireValue(approximately(metric.frameMedian, medianNumbers(frameSamples), 0.1) && Number(metric.frameMedian) <= Number(budgets.visualFrameMedianMs), "product-frame-median-invalid", { round: round?.round, interaction: name, median: metric.frameMedian, computed: medianNumbers(frameSamples), budget: budgets.visualFrameMedianMs });
      const computedSlowRate = frameSamples.filter((value) => Number(value) > 50).length / Math.max(1, frameSamples.length);
      requireValue(approximately(metric.slowFrameRate, computedSlowRate, 0.001) && Number(metric.slowFrameRate) <= Number(budgets.visualSlowFrameRate), "product-slow-frame-rate-invalid", { round: round?.round, interaction: name, slowFrameRate: metric.slowFrameRate, computed: computedSlowRate, budget: budgets.visualSlowFrameRate });
    }

    const longTasks = round?.interactions?.longTasks || {};
    const entries = Array.isArray(longTasks.entries) ? longTasks.entries : [];
    const computedLongTaskMax = entries.length ? Math.max(...entries.map((entry) => Number(entry.duration || 0))) : 0;
    requireValue(Number(longTasks.count) >= entries.length && entries.every((entry) => finite(entry.startTime) && finite(entry.duration) && Number(entry.duration) >= 50), "product-long-task-entries-invalid", { round: round?.round, longTasks });
    if (finite(longTasks.measurementStartedAt)) {
      requireValue(entries.every((entry) => Number(entry.startTime) >= Number(longTasks.measurementStartedAt)), "product-interaction-long-task-scope-invalid", { round: round?.round, measurementStartedAt: longTasks.measurementStartedAt, entries });
    }
    if (longTasks.startup) {
      const startupEntries = Array.isArray(longTasks.startup.entries) ? longTasks.startup.entries : [];
      const startupMax = startupEntries.length ? Math.max(...startupEntries.map((entry) => Number(entry.duration || 0))) : 0;
      requireValue(Number(longTasks.startup.count) >= startupEntries.length && startupEntries.every((entry) => finite(entry.startTime) && finite(entry.duration) && Number(entry.duration) >= 50), "product-startup-long-task-entries-invalid", { round: round?.round, startup: longTasks.startup });
      requireValue(approximately(longTasks.startup.maxMs, startupMax, 1), "product-startup-long-task-max-invalid", { round: round?.round, maxMs: longTasks.startup.maxMs, computed: startupMax });
      if (finite(longTasks.measurementStartedAt)) requireValue(startupEntries.every((entry) => Number(entry.startTime) < Number(longTasks.measurementStartedAt)), "product-startup-long-task-scope-invalid", { round: round?.round, measurementStartedAt: longTasks.measurementStartedAt, startupEntries });
    }
    requireValue(approximately(longTasks.maxMs, computedLongTaskMax, 1) && Number(longTasks.maxMs) <= Number(budgets.longTaskMaxMs), "product-long-task-budget-invalid", { round: round?.round, maxMs: longTasks.maxMs, computed: computedLongTaskMax, budget: budgets.longTaskMaxMs });
  }

  const aggregateChecks = [
    ["workbenchReadyMs", budgets.workbenchReadyMs], ["rendererBootMs", budgets.rendererBootMs],
    ["heapBytes", budgets.heapBytes], ["zoomP95Ms", budgets.zoomP95Ms], ["panP95Ms", budgets.panP95Ms],
    ["dragP95Ms", budgets.dragP95Ms], ["zoomFrameP95Ms", budgets.visualFrameP95Ms],
    ["panFrameP95Ms", budgets.visualFrameP95Ms], ["dragFrameP95Ms", budgets.visualFrameP95Ms],
    ["zoomFrameMedianMs", budgets.visualFrameMedianMs], ["panFrameMedianMs", budgets.visualFrameMedianMs],
    ["dragFrameMedianMs", budgets.visualFrameMedianMs], ["visualSlowFrameRate", budgets.visualSlowFrameRate],
    ["longTaskMaxMs", budgets.longTaskMaxMs]
  ];
  for (const [metric, budget] of aggregateChecks) requireValue(finite(aggregate[metric]) && Number(aggregate[metric]) <= Number(budget), "product-aggregate-budget-invalid", { metric, value: aggregate[metric], budget });

  const errors = findings.filter((item) => item.level === "error");
  const missing = findings.filter((item) => item.level === "missing");
  const audit = {
    ok: errors.length === 0 && missing.length === 0,
    baselineReadable: errors.length === 0,
    truthContractReady: missing.length === 0,
    productPerformanceReady: errors.length === 0 && missing.length === 0 && report?.productPerformanceReady === true,
    evidenceScope: "product-gate",
    strict,
    reportPath,
    reportMode: "product-performance-gate",
    performanceSchemaVersion: Number(report?.schemaVersion || 0),
    counts: { errors: errors.length, missing: missing.length, warnings: 0, info: 0 },
    findings
  };
  return audit;
}

const reportPath = resolve(projectRoot, explicitReport || latestPerformanceReport());
const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (report?.evidenceScope === "product-gate") {
  const audit = auditProductGateReport(report, reportPath);
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (!audit.ok) process.exit(1);
  process.exit(0);
}
const performance = report?.performance || {};
const thumbnailFixture = performance?.fixtures?.imageContainer10 || null;
const thumbnailDisk = thumbnailFixture?.thumbnailDiskCache || null;
const observedRenderCommits = performance?.rendererCommits || performance?.fixtures?.nodes200?.renderCommits || null;
const evidence = {
  ...performance,
  fixtures: {
    ...(performance?.fixtures || {}),
    imageThumbnailCold: performance?.fixtures?.imageThumbnailCold || (
      measured(thumbnailFixture) && measured(thumbnailDisk) ? thumbnailFixture : null
    ),
  },
  rendererCommits: performance?.rendererCommits || observedRenderCommits,
  imagePipeline: {
    ...(performance?.imagePipeline || {}),
    originalBytes: performance?.imagePipeline?.originalBytes ?? thumbnailDisk?.sourceBytes,
    thumbnailBytes: performance?.imagePipeline?.thumbnailBytes ?? thumbnailDisk?.thumbnailBytes,
  },
};
const findings = [];

function record(level, rule, detail) {
  findings.push({ level, rule, detail });
}

const legacyMandatory = [
  "coldStart",
  "fixtures.nodes200",
  "fixtures.imageContainer10",
  "interactions.pan",
  "interactions.zoom",
  "interactions.drag",
  "save",
];
for (const metricPath of legacyMandatory) {
  const metric = readPath(evidence, metricPath);
  if (!measured(metric)) record("error", "baseline-metric-missing", { metricPath, status: metric?.status || "missing", reason: metric?.reason || "" });
}

const truthContract = [
  ["schemaVersion", (value) => Number(value) >= 2],
  ["baselineOnly", (value) => value === true],
  ["productPerformanceReady", (value) => value === false],
  ["environment.profile", (value) => value === "production-like" || value === "development"],
  ["fixtures.nodes1000", measured],
  ["fixtures.longTimeline", measured],
  ["fixtures.streamingTimeline", measured],
  ["fixtures.imageThumbnailCold", measured],
  ["fixtures.imageThumbnailWarm", measured],
  ["rendererCommits.canvas", measured],
  ["rendererCommits.agentFeed", measured],
  ["rendererCommits.composer", measured],
  ["imagePipeline.requestCount", Number.isFinite],
  ["imagePipeline.originalBytes", Number.isFinite],
  ["imagePipeline.thumbnailBytes", Number.isFinite],
  ["imagePipeline.cacheHits", Number.isFinite],
  ["imagePipeline.maxConcurrentWorkers", (value) => Number.isFinite(value) && value >= 0 && value <= 2],
  ["persistence.largeProject", measured],
  ["persistence.writeCount", Number.isFinite],
  ["persistence.coalescedWriteCount", Number.isFinite],
  ["persistence.flushMs", Number.isFinite],
  ["memory.afterFixtureCleanup", measured],
  ["phaseLongTasks", (value) => value && typeof value === "object" && Object.keys(value).length > 0],
  ["visualCheckpoints.imageContainer10", measured],
  ["visualCheckpoints.nodes1000", measured],
  ["visualCheckpoints.longTimeline", measured],
  ["visualCheckpoints.streamingTimeline", measured],
];

const environmentProfile = performance?.environment?.profile;
const fullAidebugControlPlane = performance?.environment?.fullAidebugControlPlane;
if (environmentProfile === "production-like" && fullAidebugControlPlane !== false) {
  record("error", "production-like-aidebug-leak", { environmentProfile, fullAidebugControlPlane });
} else if (environmentProfile === "development" && fullAidebugControlPlane === true) {
  record("info", "development-aidebug-explicit", { environmentProfile, fullAidebugControlPlane });
} else if (environmentProfile && typeof fullAidebugControlPlane !== "boolean") {
  record("missing", "performance-truth-contract-missing", { metricPath: "environment.fullAidebugControlPlane", value: fullAidebugControlPlane ?? null });
}

for (const [metricPath, predicate] of truthContract) {
  const value = readPath(evidence, metricPath);
  if (!predicate(value)) record("missing", "performance-truth-contract-missing", { metricPath, value: value ?? null });
}

if (report?.mode !== "performance-suite") {
  record("error", "performance-report-mode-invalid", { expected: "performance-suite", actual: report?.mode || "missing" });
}

function recordSemanticFailures(metricPath, failures) {
  if (failures.length > 0) record("missing", "performance-truth-contract-invalid", { metricPath, failures });
}

const nodes1000Metric = performance?.fixtures?.nodes1000;
if (measured(nodes1000Metric)) {
  const failures = [];
  if (!finite(nodes1000Metric.durationMs) || Number(nodes1000Metric.durationMs) < 0) failures.push("durationMs must be finite and non-negative");
  if (Number(nodes1000Metric.requestedNodeCount) !== 1000) failures.push("requestedNodeCount must equal 1000");
  if (Number(nodes1000Metric.hydratedNodeCount) !== 1000) failures.push("hydratedNodeCount must equal 1000");
  if (Number(nodes1000Metric.requestedRelationCount) !== 199) failures.push("requestedRelationCount must equal 199");
  if (Number(nodes1000Metric.hydratedRelationCount) !== 199) failures.push("hydratedRelationCount must equal 199");
  if (!integer(nodes1000Metric.renderedNodeCount) || Number(nodes1000Metric.renderedNodeCount) < 1 || Number(nodes1000Metric.renderedNodeCount) > 1000) failures.push("renderedNodeCount must be an integer in 1..1000");
  if (!approximately(nodes1000Metric.projectionRatio, Number(nodes1000Metric.renderedNodeCount) / 1000, 0.0015)) failures.push("projectionRatio must match renderedNodeCount/1000");
  const expectedProjection = Number(nodes1000Metric.renderedNodeCount) < 1000 ? "viewport-projected" : "all-nodes-mounted";
  if (nodes1000Metric.projectionMode !== expectedProjection) failures.push(`projectionMode must equal ${expectedProjection}`);
  if (nodes1000Metric.selectedNodeId !== "aidebug-performance-node-1000-1000") failures.push("selectedNodeId must identify the final fixture node");
  if (nodes1000Metric.selectedLastRendered !== true) failures.push("selectedLastRendered must be true");
  if (!finite(nodes1000Metric.selectedLastVisibleRatio) || Number(nodes1000Metric.selectedLastVisibleRatio) <= 0.9) failures.push("selectedLastVisibleRatio must exceed 0.9");
  const geometry = nodes1000Metric.selectedLastGeometry || {};
  for (const key of ["left", "top", "right", "bottom", "width", "height"]) if (!finite(geometry[key])) failures.push(`selectedLastGeometry.${key} must be finite`);
  if (finite(geometry.width) && Number(geometry.width) <= 0) failures.push("selectedLastGeometry.width must be positive");
  if (finite(geometry.height) && Number(geometry.height) <= 0) failures.push("selectedLastGeometry.height must be positive");
  for (const area of ["canvas", "agentFeed", "composer"]) if (!finite(nodes1000Metric.renderCommits?.[area]) || Number(nodes1000Metric.renderCommits?.[area]) < 0) failures.push(`renderCommits.${area} must be finite and non-negative`);
  recordSemanticFailures("fixtures.nodes1000", failures);
}

const longTimelineMetric = performance?.fixtures?.longTimeline;
if (measured(longTimelineMetric)) {
  const failures = [];
  if (!finite(longTimelineMetric.durationMs) || Number(longTimelineMetric.durationMs) < 0) failures.push("durationMs must be finite and non-negative");
  for (const key of ["requestedMessageCount", "runtimeMessageCount"]) if (Number(longTimelineMetric[key]) !== 500) failures.push(`${key} must equal 500`);
  if (Number(longTimelineMetric.renderWindowSize) !== 80) failures.push("renderWindowSize must equal 80");
  if (Number(longTimelineMetric.domMessageCount) !== Number(longTimelineMetric.renderWindowSize)) failures.push("domMessageCount must equal the render window");
  if (Number(longTimelineMetric.toolStartCompletePairCount) !== 50) failures.push("toolStartCompletePairCount must equal 50");
  if (Number(longTimelineMetric.visibleToolPairCount) !== 40) failures.push("visibleToolPairCount must equal 40");
  if (Number(longTimelineMetric.toolTraceDomCount) !== 80) failures.push("toolTraceDomCount must equal 80");
  if (Number(longTimelineMetric.toolStartDomCount) !== 40) failures.push("toolStartDomCount must equal 40");
  if (Number(longTimelineMetric.toolCompleteDomCount) !== 40) failures.push("toolCompleteDomCount must equal 40");
  if (longTimelineMetric.feedPresent !== true) failures.push("feedPresent must be true");
  if (longTimelineMetric.composerPresent !== true) failures.push("composerPresent must be true");
  if (longTimelineMetric.inputObserved !== true) failures.push("inputObserved must be true");
  if (!finite(longTimelineMetric.inputLatencyMs) || Number(longTimelineMetric.inputLatencyMs) < 0) failures.push("inputLatencyMs must be finite and non-negative");
  if (!finite(longTimelineMetric.feedBottomGap) || Number(longTimelineMetric.feedBottomGap) < 0 || Number(longTimelineMetric.feedBottomGap) > 2) failures.push("feedBottomGap must be within 0..2");
  for (const key of ["feedScrollTop", "feedScrollHeight", "feedClientHeight"]) if (!finite(longTimelineMetric[key])) failures.push(`${key} must be finite`);
  for (const area of ["canvas", "agentFeed", "composer"]) if (!finite(longTimelineMetric.renderCommits?.[area]) || Number(longTimelineMetric.renderCommits?.[area]) < 0) failures.push(`renderCommits.${area} must be finite and non-negative`);
  recordSemanticFailures("fixtures.longTimeline", failures);
}

const streamingTimelineMetric = performance?.fixtures?.streamingTimeline;
if (measured(streamingTimelineMetric)) {
  const failures = [];
  const feedContentBottomGap = finite(streamingTimelineMetric.feedContentBottomGap)
    ? Number(streamingTimelineMetric.feedContentBottomGap)
    : Number(streamingTimelineMetric.feedBottomGap);
  if (!finite(streamingTimelineMetric.durationMs) || Number(streamingTimelineMetric.durationMs) < 0) failures.push("durationMs must be finite and non-negative");
  if (Number(streamingTimelineMetric.requestedDeltaCount) !== 1000) failures.push("requestedDeltaCount must equal 1000");
  if (Number(streamingTimelineMetric.acceptedDeltaCount) !== 1000) failures.push("acceptedDeltaCount must equal 1000");
  if (Number(streamingTimelineMetric.runtimeMessageCount) !== 1) failures.push("runtimeMessageCount must equal 1");
  if (Number(streamingTimelineMetric.domMessageCount) !== 1) failures.push("domMessageCount must equal 1");
  if (streamingTimelineMetric.finalMarkerPresent !== true) failures.push("finalMarkerPresent must be true");
  if (streamingTimelineMetric.finalStatus !== "done") failures.push("finalStatus must equal done");
  if (Number(streamingTimelineMetric.runningMessageCount) !== 0) failures.push("runningMessageCount must equal 0");
  if (streamingTimelineMetric.feedPresent !== true) failures.push("feedPresent must be true");
  if (streamingTimelineMetric.payloadExactMatch !== true) failures.push("payloadExactMatch must be true");
  if (!finite(streamingTimelineMetric.expectedPayloadLength) || Number(streamingTimelineMetric.expectedPayloadLength) <= 0) failures.push("expectedPayloadLength must be positive");
  if (Number(streamingTimelineMetric.runtimePayloadLength) !== Number(streamingTimelineMetric.expectedPayloadLength)) failures.push("runtimePayloadLength must equal expectedPayloadLength");
  if (!finite(feedContentBottomGap) || feedContentBottomGap < 0 || feedContentBottomGap > 2) failures.push("feedContentBottomGap must be within 0..2 after accounting for the feed padding");
  if (finite(streamingTimelineMetric.feedBottomPadding) && (!finite(streamingTimelineMetric.feedBottomGap) || !approximately(feedContentBottomGap, Math.max(0, Number(streamingTimelineMetric.feedBottomGap) - Number(streamingTimelineMetric.feedBottomPadding)), 0.1))) failures.push("feedContentBottomGap must match the raw gap minus bottom padding");
  for (const area of ["canvas", "agentFeed", "composer"]) if (!finite(streamingTimelineMetric.renderCommits?.[area]) || Number(streamingTimelineMetric.renderCommits?.[area]) < 0) failures.push(`renderCommits.${area} must be finite and non-negative`);
  recordSemanticFailures("fixtures.streamingTimeline", failures);
}

const imageContainerMetricV2 = performance?.fixtures?.imageContainer10;
if (measured(imageContainerMetricV2)) {
  const failures = [];
  if (!finite(imageContainerMetricV2.durationMs) || Number(imageContainerMetricV2.durationMs) < 0) failures.push("durationMs must be finite and non-negative");
  for (const key of ["requestedImageCount", "renderedImageCount", "loadedImageCount"]) if (Number(imageContainerMetricV2[key]) !== 10) failures.push(`${key} must equal 10`);
  for (const key of ["canvasUsesThumbnails", "thumbnailDimensionsBounded", "viewerUsesOriginal", "viewerStripUsesThumbnails", "coldThumbnailOk", "warmThumbnailOk", "thumbnailEvidenceOk"]) if (imageContainerMetricV2[key] !== true) failures.push(`${key} must be true`);
  if (!Array.isArray(imageContainerMetricV2.canvasImageSources) || imageContainerMetricV2.canvasImageSources.length !== 10 || !imageContainerMetricV2.canvasImageSources.every((source) => /[?&]preview=thumbnail(?:&|$)/.test(String(source)))) failures.push("canvasImageSources must contain ten thumbnail protocol URLs");
  if (!Array.isArray(imageContainerMetricV2.canvasNaturalSizes) || imageContainerMetricV2.canvasNaturalSizes.length !== 10 || !imageContainerMetricV2.canvasNaturalSizes.every((size) => finite(size?.width) && finite(size?.height) && Math.max(Number(size.width), Number(size.height)) <= 512)) failures.push("canvasNaturalSizes must contain ten images bounded to 512px");
  if (!imageContainerMetricV2.viewerMainSource || /[?&]preview=thumbnail(?:&|$)/.test(String(imageContainerMetricV2.viewerMainSource))) failures.push("viewerMainSource must use the original asset URL");
  if (!Array.isArray(imageContainerMetricV2.viewerStripSources) || imageContainerMetricV2.viewerStripSources.length < 1 || !imageContainerMetricV2.viewerStripSources.every((source) => /[?&]preview=thumbnail(?:&|$)/.test(String(source)))) failures.push("viewerStripSources must use thumbnail URLs");
  const cold = imageContainerMetricV2.coldThumbnailStats || {};
  if (Number(cold.requests) !== 10 || Number(cold.workerStarts) !== 10 || Number(cold.generated) !== 10 || Number(cold.errors) !== 0 || Number(cold.maxActiveWorkers) < 1 || Number(cold.maxActiveWorkers) > 2) failures.push("coldThumbnailStats must prove ten successful bounded workers with zero errors");
  if (!Array.isArray(cold.recentErrors) || cold.recentErrors.length !== 0) failures.push("coldThumbnailStats.recentErrors must be an empty array");
  const warm = imageContainerMetricV2.warmThumbnailStats || {};
  if (Number(warm.requests) !== 10 || Number(warm.cacheHits) !== 10 || Number(warm.workerStarts) !== 0 || Number(warm.generated) !== 0 || Number(warm.errors) !== 0) failures.push("warmThumbnailStats must prove ten cache hits with no workers or errors");
  if (!Array.isArray(warm.recentErrors) || warm.recentErrors.length !== 0) failures.push("warmThumbnailStats.recentErrors must be an empty array");
  const disk = imageContainerMetricV2.thumbnailDiskCache || {};
  if (!measured(disk) || Number(disk.sourceAssetCount) !== 10 || Number(disk.thumbnailCount) !== 10 || Number(disk.stagingFileCount) !== 0 || !finite(disk.sourceBytes) || Number(disk.sourceBytes) <= 0 || !finite(disk.thumbnailBytes) || Number(disk.thumbnailBytes) <= 0) failures.push("thumbnailDiskCache must prove ten committed thumbnails, positive bytes, and no staging files");
  recordSemanticFailures("fixtures.imageContainer10", failures);
}

const persistenceMetric = performance?.persistence;
if (persistenceMetric && typeof persistenceMetric === "object") {
  const failures = [];
  if (!measured(persistenceMetric.largeProject)) failures.push("largeProject must be measured");
  if (!integer(persistenceMetric.writeCount) || Number(persistenceMetric.writeCount) < 1) failures.push("writeCount must prove at least one committed session write");
  if (!integer(persistenceMetric.coalescedWriteCount) || Number(persistenceMetric.coalescedWriteCount) < 1) failures.push("coalescedWriteCount must prove at least one canceled debounce write");
  if (!finite(persistenceMetric.flushMs) || Number(persistenceMetric.flushMs) <= 0) failures.push("flushMs must be finite and positive");
  if (!integer(persistenceMetric.mutationCount) || Number(persistenceMetric.mutationCount) < 2) failures.push("mutationCount must prove multiple persistence-triggering mutations");
  if (!integer(persistenceMetric.scheduledWriteCount) || Number(persistenceMetric.scheduledWriteCount) < Number(persistenceMetric.mutationCount)) failures.push("scheduledWriteCount must cover every measured mutation");
  if (Number(persistenceMetric.pendingWriteCount) !== 0) failures.push("pendingWriteCount must equal zero at capture");
  if (Number(persistenceMetric.failedWriteCount) !== 0) failures.push("failedWriteCount must equal zero");
  if (String(persistenceMetric.source || "") !== "renderer-debounce-and-session-commit-roundtrip") failures.push("source must identify renderer debounce and committed session round-trip timing");
  const accountedWrites = Number(persistenceMetric.writeCount || 0) + Number(persistenceMetric.coalescedWriteCount || 0) + Number(persistenceMetric.pendingWriteCount || 0);
  if (Number(persistenceMetric.scheduledWriteCount) !== accountedWrites) failures.push("scheduled writes must equal committed + coalesced + pending writes");
  recordSemanticFailures("persistence", failures);
}

const cleanupMemory = performance?.memory?.afterFixtureCleanup;
if (measured(cleanupMemory)) {
  const failures = [];
  if (cleanupMemory.source !== "cdp-runtime-get-heap-usage") failures.push("source must equal cdp-runtime-get-heap-usage");
  for (const key of ["baselineBeforeBytes", "beforeCleanupBytes", "afterCleanupBytes"]) if (!finite(cleanupMemory[key]) || Number(cleanupMemory[key]) <= 0) failures.push(`${key} must be finite and positive`);
  if (!approximately(cleanupMemory.retainedDeltaBytes, Number(cleanupMemory.afterCleanupBytes) - Number(cleanupMemory.baselineBeforeBytes), 1)) failures.push("retainedDeltaBytes formula mismatch");
  if (!approximately(cleanupMemory.reclaimedBytes, Number(cleanupMemory.beforeCleanupBytes) - Number(cleanupMemory.afterCleanupBytes), 1)) failures.push("reclaimedBytes formula mismatch");
  if (cleanupMemory.garbageCollection?.status !== "measured" || cleanupMemory.garbageCollection?.completed !== true || Number(cleanupMemory.garbageCollection?.completedPasses) < 1) failures.push("garbageCollection must prove at least one completed CDP pass");
  const state = cleanupMemory.cleanupState || {};
  if (state.ok !== true || state.waitOk !== true) failures.push("cleanupState must settle successfully");
  for (const key of ["runtimeNodeCount", "domNodeCount", "runtimeMessageCount", "domMessageCount", "edgeCount", "selectedNodeCount"]) if (Number(state[key]) !== 0) failures.push(`cleanupState.${key} must equal 0`);
  if (!integer(state.settledFrames) || Number(state.settledFrames) < 2) failures.push("cleanupState.settledFrames must be at least 2");
  if (!finite(state.settleMs) || Number(state.settleMs) < 0) failures.push("cleanupState.settleMs must be finite and non-negative");
  recordSemanticFailures("memory.afterFixtureCleanup", failures);
  if (finite(cleanupMemory.reclaimedBytes) && Number(cleanupMemory.reclaimedBytes) < 0) record("warning", "cleanup-heap-sample-grew", { reclaimedBytes: cleanupMemory.reclaimedBytes, retainedDeltaBytes: cleanupMemory.retainedDeltaBytes });
}

const requiredPhaseNames = ["nodes200", "interactions", "nodes1000", "longTimeline", "streamingTimeline", "imageContainer10", "fixtureCleanup"];
const phaseLongTasks = performance?.phaseLongTasks;
if (phaseLongTasks && typeof phaseLongTasks === "object") {
  const failures = [];
  const support = phaseLongTasks.support || {};
  if (support.status !== "measured" || typeof support.supported !== "boolean") failures.push("support must explicitly measure a boolean supported value");
  let previousEndedAt = -Infinity;
  for (const phaseName of requiredPhaseNames) {
    const phase = phaseLongTasks[phaseName];
    if (support.supported === false) {
      if (phase?.status !== "unknown" || !String(phase?.reason || "").trim()) failures.push(`${phaseName} must be explicit unknown with a reason when longtask is unsupported`);
      continue;
    }
    if (phase?.status !== "measured" || phase?.source !== "performance-observer-longtask") { failures.push(`${phaseName} must be measured from performance-observer-longtask`); continue; }
    if (!finite(phase.startedAt) || !finite(phase.endedAt) || !finite(phase.durationMs) || Number(phase.endedAt) < Number(phase.startedAt)) failures.push(`${phaseName} time interval is invalid`);
    if (finite(phase.startedAt) && Number(phase.startedAt) < previousEndedAt - 1) failures.push(`${phaseName} overlaps or precedes the previous phase`);
    if (finite(phase.endedAt)) previousEndedAt = Number(phase.endedAt);
    if (!approximately(phase.durationMs, Number(phase.endedAt) - Number(phase.startedAt), 1)) failures.push(`${phaseName}.durationMs formula mismatch`);
    if (!integer(phase.count) || Number(phase.count) < 0) failures.push(`${phaseName}.count must be a non-negative integer`);
    if (!Array.isArray(phase.entries) || phase.entries.length !== Number(phase.count)) failures.push(`${phaseName}.entries length must equal count`);
    const entries = Array.isArray(phase.entries) ? phase.entries : [];
    for (const entry of entries) {
      if (!finite(entry.startTime) || !finite(entry.duration) || Number(entry.duration) < 49 || Number(entry.startTime) < Number(phase.startedAt) - 1 || Number(entry.startTime) > Number(phase.endedAt) + 1) failures.push(`${phaseName} contains an invalid longtask entry`);
    }
    const total = entries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0);
    const max = entries.length ? Math.max(...entries.map((entry) => Number(entry.duration || 0))) : 0;
    if (!approximately(phase.totalDurationMs, total, 1)) failures.push(`${phaseName}.totalDurationMs formula mismatch`);
    if (!approximately(phase.maxDurationMs, max, 1)) failures.push(`${phaseName}.maxDurationMs formula mismatch`);
  }
  recordSemanticFailures("phaseLongTasks", failures);
}

const commitPhaseNames = ["nodes200", "interactions", "nodes1000", "longTimeline", "streamingTimeline", "imageContainer10", "fixtureCleanup"];
for (const area of ["canvas", "agentFeed", "composer"]) {
  const metric = performance?.rendererCommits?.[area];
  if (!measured(metric)) continue;
  const failures = commitPhaseNames.filter((phase) => !finite(metric[phase]) || Number(metric[phase]) < 0).map((phase) => `${phase} must be finite and non-negative`);
  recordSemanticFailures(`rendererCommits.${area}`, failures);
}

for (const checkpointName of ["imageContainer10", "nodes1000", "longTimeline", "streamingTimeline"]) {
  const checkpoint = performance?.visualCheckpoints?.[checkpointName];
  if (!measured(checkpoint)) continue;
  const failures = [];
  if (!String(checkpoint.screenshotSource || "").startsWith("cdp")) failures.push("screenshotSource must be CDP-backed");
  if (!finite(checkpoint.screenshotBytes) || Number(checkpoint.screenshotBytes) <= 0) failures.push("screenshotBytes must be positive");
  if (!/^[a-f0-9]{64}$/i.test(String(checkpoint.screenshotSha256 || ""))) failures.push("screenshotSha256 must be a SHA-256 digest");
  if (checkpoint.dualFrameStable !== true) failures.push("dualFrameStable must be true");
  if (checkpoint.stateStable !== true) failures.push("stateStable must be true");
  if (checkpoint.visualReliabilityOk !== true) failures.push("visualReliabilityOk must be true");
  for (const key of ["stateIssueCount", "captureIssueCount", "overflowCount"]) if (Number(checkpoint[key]) !== 0) failures.push(`${key} must equal 0`);
  const observed = checkpoint.observed || {};
  if (checkpointName === "imageContainer10" && !(Number(observed.runtimeNodeCount) === 1 && Number(observed.renderedImageCount) === 10 && Number(observed.loadedImageCount) === 10)) failures.push("observed image container counts must equal 1/10/10");
  if (checkpointName === "nodes1000" && !(Number(observed.runtimeNodeCount) === 1000 && Number(observed.relationCount) === 199 && Number(observed.domNodeCount) > 0 && observed.selectedNodeId === "aidebug-performance-visual-node-1000" && observed.selectedRendered === true && Number(observed.selectedVisibleRatio) > 0.9)) failures.push("observed 1000-node runtime/relation/selection truth is incomplete");
  if (checkpointName === "longTimeline" && !(Number(observed.runtimeMessageCount) === 500 && Number(observed.domMessageCount) === 80 && Number(observed.toolStartCount) === 40 && Number(observed.toolCompleteCount) === 40 && observed.feedPresent === true && Number(observed.feedBottomGap) <= 2)) failures.push("observed long timeline window/scroll truth is incomplete");
  if (checkpointName === "streamingTimeline" && !(Number(observed.runtimeMessageCount) === 1 && Number(observed.domMessageCount) === 1 && observed.payloadExactMatch === true && observed.finalStatus === "done" && Number(observed.runningMessageCount) === 0 && observed.feedPresent === true && Number(finite(observed.feedContentBottomGap) ? observed.feedContentBottomGap : observed.feedBottomGap) <= 2)) failures.push("observed streaming payload/status truth is incomplete");
  recordSemanticFailures(`visualCheckpoints.${checkpointName}`, failures);
}

const nodes200 = performance?.fixtures?.nodes200;
if (measured(nodes200) && Number(nodes200.hydratedNodeCount) === 200 && Number(nodes200.renderedNodeCount) > 0) {
  record("info", "viewport-projection-observed", {
    hydratedNodeCount: nodes200.hydratedNodeCount,
    renderedNodeCount: nodes200.renderedNodeCount,
    projectionRatio: nodes200.projectionRatio,
  });
}
const imageContainer10 = performance?.fixtures?.imageContainer10;
if (measured(imageContainer10) && /in-memory PNG/i.test(String(imageContainer10.fixture || ""))) {
  record("warning", "thumbnail-pipeline-not-exercised", { fixture: imageContainer10.fixture });
}
if (
  measured(performance?.save) &&
  Number(performance.save.payloadNodeCount || 0) < 200 &&
  Number(performance?.persistence?.largeProject?.payloadNodeCount || 0) < 200
) {
  record("warning", "large-project-save-not-exercised", {
    legacySavePayloadNodeCount: performance.save.payloadNodeCount,
    largeProjectPayloadNodeCount: performance?.persistence?.largeProject?.payloadNodeCount ?? null
  });
}
if (performance?.baselineOnly === true || report?.baselineOnly === true) {
  record("warning", "baseline-has-no-product-thresholds", { baselineOnly: true });
}
for (const interactionName of ["pan", "zoom", "drag"]) {
  const p95Ms = Number(performance?.interactions?.[interactionName]?.p95Ms || 0);
  if (p95Ms > 16.7) {
    record("warning", `${interactionName}-p95-exceeds-one-frame`, { p95Ms, frameBudgetMs: 16.7 });
  }
}
if (Number(performance?.fixtures?.longTimeline?.inputLatencyMs || 0) > 100) {
  record("warning", "long-timeline-input-latency-exceeds-rail-response", { inputLatencyMs: performance.fixtures.longTimeline.inputLatencyMs, responseGuidelineMs: 100 });
}
if (Number(performance?.longTasks?.maxDurationMs || 0) >= 50) {
  record("warning", "long-task-observed", { maxDurationMs: performance.longTasks.maxDurationMs, count: performance.longTasks.count });
}
for (const phaseName of requiredPhaseNames) {
  const phase = performance?.phaseLongTasks?.[phaseName];
  if (measured(phase) && Number(phase.count || 0) > 0) {
    record("warning", "phase-long-task-observed", { phase: phaseName, count: phase.count, totalDurationMs: phase.totalDurationMs, maxDurationMs: phase.maxDurationMs });
  }
}
if (observedRenderCommits && [observedRenderCommits.canvas, observedRenderCommits.agentFeed, observedRenderCommits.composer].every(measured)) {
  const phases = commitPhaseNames;
  const coupledPhases = phases.filter((phase) => {
    const values = [observedRenderCommits.canvas?.[phase], observedRenderCommits.agentFeed?.[phase], observedRenderCommits.composer?.[phase]].map(Number);
    return values.every(Number.isFinite) && values[0] > 1 && values.every((value) => value === values[0]);
  });
  if (coupledPhases.length > 0) {
    record("warning", "renderer-partitions-commit-together", { renderCommits: observedRenderCommits });
  } else {
    record("info", "renderer-partition-commit-probes-present", { renderCommits: observedRenderCommits });
  }
}

const errors = findings.filter((item) => item.level === "error");
const missing = findings.filter((item) => item.level === "missing");
const warnings = findings.filter((item) => item.level === "warning");
const audit = {
  ok: errors.length === 0 && missing.length === 0,
  baselineReadable: errors.length === 0,
  truthContractReady: missing.length === 0,
  productPerformanceReady: performance?.productPerformanceReady === true,
  evidenceScope: performance?.baselineOnly === true ? "development-baseline" : "product-gate",
  strict,
  reportPath,
  reportMode: report?.mode || "unknown",
  performanceSchemaVersion: Number(performance?.schemaVersion || 0),
  counts: { errors: errors.length, missing: missing.length, warnings: warnings.length, info: findings.filter((item) => item.level === "info").length },
  findings,
};

process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
if (errors.length > 0 || (strict && missing.length > 0)) process.exitCode = 1;
