import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const diagnosticsRoot = join(packageRoot, ".diagnostics", "electron");
const args = process.argv.slice(2);
const explicitReport = args.find((item) => item.startsWith("--report="))?.split("=").slice(1).join("=") ||
  args.find((item) => !item.startsWith("--")) || "";
const allowMissingEnvironment = args.includes("--allow-missing-environment");
const noWrite = args.includes("--no-write");
const selftestRequested = args.includes("--selftest");

function latestReportPath() {
  if (!existsSync(diagnosticsRoot)) throw new Error(`AIDebug diagnostics directory is missing: ${diagnosticsRoot}`);
  const reports = [];
  for (const entry of readdirSync(diagnosticsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(diagnosticsRoot, entry.name, "report.json");
    if (!existsSync(reportPath)) continue;
    reports.push({ path: reportPath, mtimeMs: statSync(reportPath).mtimeMs });
  }
  reports.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!reports.length) throw new Error(`No AIDebug report.json exists below ${diagnosticsRoot}`);
  return reports[0].path;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function pngDimensions(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function geometryOverlap(left, right) {
  if (!left || !right) return { width: 0, height: 0, area: 0, ratio: 0 };
  const width = Math.max(0, Math.min(Number(left.right), Number(right.right)) - Math.max(Number(left.left), Number(right.left)));
  const height = Math.max(0, Math.min(Number(left.bottom), Number(right.bottom)) - Math.max(Number(left.top), Number(right.top)));
  const area = width * height;
  const targetArea = Math.max(1, Number(right.width || 0) * Number(right.height || 0));
  return { width, height, area, ratio: area / targetArea };
}

function captureEnvironmentOf(result) {
  return result?.captureEnvironment || result?.environmentEvidence || result?.evidence?.captureEnvironment || null;
}

function selectedNodeGeometry(state) {
  const selectedId = String(state?.selectedNodeId || "");
  if (!selectedId || !Array.isArray(state?.nodeLayouts)) return null;
  return state.nodeLayouts.find((item) => item?.id === selectedId)?.geometry || null;
}

function fileReports(result) {
  return Array.isArray(result?.fileImagePixelReport?.reports) ? result.fileImagePixelReport.reports : [];
}

function uniqueExistingFileHashes(paths) {
  const rows = [];
  for (const filePath of [...new Set(paths.map(String).filter(Boolean))]) {
    if (!existsSync(filePath)) {
      rows.push({ path: filePath, exists: false, sha256: "" });
      continue;
    }
    rows.push({ path: filePath, exists: true, sha256: sha256(filePath) });
  }
  return rows;
}

function sceneClassification(result) {
  const label = String(result?.label || "");
  if (label === "agent-autonomy-hard-gate-fixture") return "synthetic-autonomy-hard-gate";
  return "visual-scene";
}

function resultGateFindings(result) {
  const rows = [];
  const reliability = result?.visualReliability;
  if (!reliability || !["functionalOk", "stateOk", "visualOk", "evidenceOk"].every((key) => typeof reliability[key] === "boolean")) {
    rows.push({ rule: "five-layer-visual-report-present", detail: { reliability: reliability || null } });
  } else {
    const expectedOk = reliability.functionalOk && reliability.stateOk && reliability.visualOk && reliability.evidenceOk;
    if (reliability.ok !== expectedOk) rows.push({ rule: "visual-ok-is-layer-conjunction", detail: { expectedOk, actual: reliability.ok } });
    if (reliability.ok !== true) {
      rows.push({
        rule: "visual-reliability-must-pass",
        detail: {
          status: reliability.status || "failed",
          functionalOk: reliability.functionalOk,
          stateOk: reliability.stateOk,
          visualOk: reliability.visualOk,
          evidenceOk: reliability.evidenceOk,
          failureReasons: reliability.failureReasons || [],
        },
      });
    }
  }
  if (result?.suite?.ok === false) {
    rows.push({
      rule: "suite-must-pass",
      detail: {
        issues: result.suite.issues || [],
        steps: Array.isArray(result.suite.steps)
          ? result.suite.steps.filter((item) => item?.ok === false).map((item) => ({ label: item.label, error: item.error || "" }))
          : [],
      },
    });
  }
  return rows;
}

function reportGateFindings(report) {
  return report?.ok === true
    ? []
    : [{
        rule: "source-report-must-pass",
        detail: {
          reportOk: report?.ok,
          failureCount: Array.isArray(report?.failures) ? report.failures.length : 0,
          failureLabels: Array.isArray(report?.failures) ? report.failures.map((item) => item?.label || "unnamed-scene") : [],
        },
      }];
}

function finiteMetric(value) {
  return Number.isFinite(Number(value));
}

function performanceReportFindings(report) {
  if (report?.mode !== "performance-suite") return [];
  const rows = [];
  const performance = report?.performance;
  if (!performance || typeof performance !== "object") return [{ rule: "performance-report-present", detail: { performance: performance || null } }];
  const requireMeasured = (rule, metric, fields) => {
    if (metric?.status !== "measured" || fields.some((field) => !finiteMetric(metric?.[field]))) {
      rows.push({ rule, detail: { metric: metric || null, requiredFields: fields } });
    }
  };
  requireMeasured("performance-cold-start-recorded", performance.coldStart, ["electronSpawnToWorkbenchReadyMs", "suiteProcessToWorkbenchReadyMs"]);
  requireMeasured("performance-200-node-hydrate-recorded", performance.fixtures?.nodes200, ["durationMs", "requestedNodeCount", "hydratedNodeCount", "renderedNodeCount"]);
  if (
    Number(performance.fixtures?.nodes200?.requestedNodeCount) !== 200 ||
    Number(performance.fixtures?.nodes200?.hydratedNodeCount) !== 200 ||
    Number(performance.fixtures?.nodes200?.renderedNodeCount) < 1 ||
    Number(performance.fixtures?.nodes200?.renderedNodeCount) > 200 ||
    !["viewport-projected", "all-nodes-mounted"].includes(performance.fixtures?.nodes200?.projectionMode)
  ) {
    rows.push({ rule: "performance-200-node-fixture-complete", detail: performance.fixtures?.nodes200 || null });
  }
  requireMeasured("performance-10-image-container-recorded", performance.fixtures?.imageContainer10, ["durationMs", "requestedImageCount", "renderedImageCount"]);
  if (Number(performance.fixtures?.imageContainer10?.requestedImageCount) !== 10 || Number(performance.fixtures?.imageContainer10?.renderedImageCount) !== 10) {
    rows.push({ rule: "performance-10-image-container-complete", detail: performance.fixtures?.imageContainer10 || null });
  }
  for (const operation of ["pan", "zoom", "drag"]) {
    const metric = performance.interactions?.[operation];
    requireMeasured(`performance-${operation}-raf-recorded`, metric, ["durationMs", "sampleCount", "p50Ms", "p95Ms"]);
    if (Number(metric?.sampleCount || 0) < 10 || Number(metric?.p95Ms || 0) < Number(metric?.p50Ms || 0)) {
      rows.push({ rule: `performance-${operation}-raf-samples-valid`, detail: metric || null });
    }
    if (metric?.effectObserved !== true) rows.push({ rule: `performance-${operation}-effect-observed`, detail: metric || null });
  }
  requireMeasured("performance-save-duration-recorded", performance.save, ["durationMs", "payloadNodeCount"]);
  for (const [name, metric] of [["long-task", performance.longTasks], ["js-heap", performance.jsHeap]]) {
    if (metric?.status === "measured") {
      const measuredFields = name === "long-task" ? ["count", "totalDurationMs", "maxDurationMs"] : ["beforeBytes", "afterBytes"];
      if (measuredFields.some((field) => !finiteMetric(metric?.[field]))) rows.push({ rule: `performance-${name}-measured-fields`, detail: metric });
    } else if (metric?.status === "unknown") {
      if (!String(metric?.reason || "").trim()) rows.push({ rule: `performance-${name}-unknown-reason`, detail: metric });
    } else {
      rows.push({ rule: `performance-${name}-status-explicit`, detail: metric || null });
    }
  }
  const evidenceQuality = performance.evidenceQuality;
  if (!evidenceQuality || !["complete", "partial"].includes(evidenceQuality.status) || evidenceQuality.ok !== true || !Array.isArray(evidenceQuality.mandatory) || evidenceQuality.mandatory.some((item) => item?.status !== "measured")) {
    rows.push({ rule: "performance-evidence-quality-valid", detail: evidenceQuality || null });
  }
  return rows;
}

function runSelftest() {
  const greenReliability = { ok: true, functionalOk: true, stateOk: true, visualOk: true, evidenceOk: true, failureReasons: [] };
  const measuredRaf = { status: "measured", durationMs: 120, sampleCount: 24, p50Ms: 16.6, p95Ms: 17.8, effectObserved: true };
  const greenPerformance = {
    mode: "performance-suite",
    performance: {
      coldStart: { status: "measured", electronSpawnToWorkbenchReadyMs: 900, suiteProcessToWorkbenchReadyMs: 1200 },
      fixtures: {
        nodes200: { status: "measured", durationMs: 80, requestedNodeCount: 200, hydratedNodeCount: 200, renderedNodeCount: 57, projectionMode: "viewport-projected" },
        imageContainer10: { status: "measured", durationMs: 40, requestedImageCount: 10, renderedImageCount: 10 }
      },
      interactions: { pan: measuredRaf, zoom: measuredRaf, drag: measuredRaf },
      save: { status: "measured", durationMs: 15, payloadNodeCount: 1 },
      longTasks: { status: "unknown", reason: "PerformanceObserver longtask entry type unavailable" },
      jsHeap: { status: "unknown", reason: "Runtime.getHeapUsage unavailable" },
      evidenceQuality: {
        ok: true,
        status: "partial",
        mandatory: [
          { name: "coldStart", status: "measured" },
          { name: "nodes200", status: "measured" },
          { name: "imageContainer10", status: "measured" },
          { name: "pan", status: "measured" },
          { name: "zoom", status: "measured" },
          { name: "drag", status: "measured" },
          { name: "save", status: "measured" }
        ]
      }
    }
  };
  const cases = [
    {
      label: "visual-false",
      rows: resultGateFindings({ visualReliability: { ...greenReliability, ok: false, visualOk: false } }),
      expected: ["visual-reliability-must-pass"],
    },
    {
      label: "suite-false",
      rows: resultGateFindings({ visualReliability: greenReliability, suite: { ok: false, issues: [], steps: [] } }),
      expected: ["suite-must-pass"],
    },
    {
      label: "report-false",
      rows: reportGateFindings({ ok: false, failures: [{ label: "failed-scene" }] }),
      expected: ["source-report-must-pass"],
    },
    {
      label: "conjunction-mismatch",
      rows: resultGateFindings({ visualReliability: { ...greenReliability, visualOk: false } }),
      expected: ["visual-ok-is-layer-conjunction"],
    },
    {
      label: "green",
      rows: [...resultGateFindings({ visualReliability: greenReliability, suite: { ok: true } }), ...reportGateFindings({ ok: true })],
      expected: [],
    },
    {
      label: "performance-green-with-explicit-unknowns",
      rows: performanceReportFindings(greenPerformance),
      expected: [],
    },
    {
      label: "performance-missing-raf",
      rows: performanceReportFindings({
        ...greenPerformance,
        performance: {
          ...greenPerformance.performance,
          interactions: { ...greenPerformance.performance.interactions, drag: { status: "unknown", reason: "missing" } }
        }
      }),
      expected: ["performance-drag-raf-recorded"],
    },
  ];
  for (const testCase of cases) {
    const rules = testCase.rows.map((item) => item.rule);
    for (const expected of testCase.expected) {
      if (!rules.includes(expected)) throw new Error(`AIDebug evidence selftest ${testCase.label} missing rule ${expected}: ${rules.join(",")}`);
    }
    if (!testCase.expected.length && rules.length) throw new Error(`AIDebug evidence selftest ${testCase.label} unexpectedly failed: ${rules.join(",")}`);
  }
  if (sceneClassification({ label: "agent-autonomy-hard-gate-fixture", screenshotSource: "fallback" }) !== "synthetic-autonomy-hard-gate") {
    throw new Error("AIDebug evidence selftest did not explicitly classify the autonomy hard-gate fixture");
  }
  if (sceneClassification({ label: "ordinary-fallback-scene", screenshotSource: "fallback" }) !== "visual-scene") {
    throw new Error("AIDebug evidence selftest incorrectly exempted an ordinary fallback screenshot");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, cases: cases.map((item) => item.label), explicitSyntheticClassification: true }, null, 2)}\n`);
}

if (selftestRequested) {
  runSelftest();
  process.exit(0);
}

const reportPath = resolve(explicitReport || latestReportPath());
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const results = Array.isArray(report.results) ? report.results : [];
const findings = [];
const checkedScenes = [];
const skippedScenes = [];

function record(level, scene, rule, detail = {}) {
  findings.push({ level, scene, rule, detail });
}

for (const result of results) {
  const label = String(result?.label || "unnamed-scene");
  const classification = sceneClassification(result);
  if (classification !== "visual-scene") {
    skippedScenes.push({ label, classification });
    continue;
  }
  checkedScenes.push(label);

  for (const finding of resultGateFindings(result)) record("error", label, finding.rule, finding.detail);

  const suiteEvidence = result?.suite?.evidenceVerdict;
  if (suiteEvidence) {
    const required = ["functionalOk", "stateOk", "gestureOk", "visualOk", "evidenceOk"];
    for (const key of required) {
      if (typeof suiteEvidence[key] !== "boolean") record("error", label, `suite-evidence-${key}`, { value: suiteEvidence[key] });
    }
    const expectedSuiteOk = required.every((key) => suiteEvidence[key] === true);
    if (result?.suite?.ok === true && !expectedSuiteOk) {
      record("error", label, "suite-ok-cannot-bypass-evidence", { suiteOk: result.suite.ok, suiteEvidence });
    }
  } else if (result?.suite?.gestureVerdict?.exercised === true && result?.suite?.gestureVerdict?.ok !== true) {
    record("error", label, "exercised-gesture-must-pass", { gestureVerdict: result.suite.gestureVerdict });
  }

  const screenshotPath = String(result?.screenshotPath || result?.screenshotEvidence?.path || "");
  if (!screenshotPath || !existsSync(screenshotPath)) {
    record("error", label, "screenshot-file-exists", { screenshotPath });
  } else {
    const actualHash = sha256(screenshotPath);
    const dimensions = pngDimensions(screenshotPath);
    if (!/^[a-f0-9]{64}$/i.test(String(result?.screenshotEvidence?.sha256 || "")) || actualHash !== result.screenshotEvidence.sha256) {
      record("error", label, "screenshot-hash-matches-file", { expected: result?.screenshotEvidence?.sha256 || "", actual: actualHash });
    }
    if (!dimensions || dimensions.width < 320 || dimensions.height < 240) {
      record("error", label, "screenshot-has-real-dimensions", { dimensions });
    }
  }

  const environment = captureEnvironmentOf(result);
  if (!environment) {
    record(allowMissingEnvironment ? "warning" : "error", label, "capture-environment-present", {});
  } else {
    const requested = environment.requestedWindow || environment.requested || null;
    const actual = environment.actualWindow || environment.windowBounds || null;
    const renderer = environment.renderer || environment.viewport || null;
    const canvas = environment.canvas || null;
    const requestStatus = environment.request?.status || "legacy-unknown";
    if (Number(environment.schemaVersion || 0) < 2) {
      record("error", label, "capture-environment-truth-schema", { schemaVersion: environment.schemaVersion || null });
    }
    if (requestStatus === "requested") {
      if (!Number.isFinite(Number(requested?.width)) || !Number.isFinite(Number(requested?.height))) {
        record("error", label, "requested-window-recorded", { requestStatus, requested });
      }
      if (environment.request?.application?.status !== "applied" || !String(environment.request?.application?.method || "").trim()) {
        record("error", label, "requested-window-application-recorded", { request: environment.request });
      }
      if (!["browser-window-bounds", "renderer-outer", "renderer-inner"].includes(environment.request?.verifiedBy)) {
        record("error", label, "requested-window-verification-source", { request: environment.request, comparisons: environment.comparisons || null });
      }
    } else if (requestStatus === "not-requested") {
      if (requested != null) record("error", label, "unrequested-window-must-remain-null", { requestStatus, requested });
      if (environment.request?.application?.status !== "not-requested" || environment.request?.verifiedBy !== "not-requested") {
        record("error", label, "unrequested-window-status-consistent", { request: environment.request });
      }
    } else {
      record("error", label, "requested-window-status-explicit", { requestStatus, requested });
    }
    if (environment.browserWindow?.status === "available") {
      if (!Number.isFinite(Number(actual?.width)) || !Number.isFinite(Number(actual?.height))) {
        record("error", label, "actual-window-recorded", { actual, browserWindow: environment.browserWindow });
      }
    } else if (environment.browserWindow?.status === "unavailable") {
      if (actual != null || !String(environment.browserWindow?.error || "").trim()) {
        record("error", label, "actual-window-unavailable-honestly-recorded", { actual, browserWindow: environment.browserWindow });
      }
    } else {
      record("error", label, "actual-window-status-explicit", { actual, browserWindow: environment.browserWindow || null });
    }
    if (!Number.isFinite(Number(renderer?.innerWidth)) || !Number.isFinite(Number(renderer?.innerHeight)) || !Number.isFinite(Number(renderer?.devicePixelRatio))) {
      record("error", label, "renderer-viewport-and-dpr-recorded", { renderer });
    }
    if (!Number.isFinite(Number(renderer?.outerWidth)) || !Number.isFinite(Number(renderer?.outerHeight))) {
      record("error", label, "renderer-outer-size-recorded", { renderer });
    }
    const screenshot = environment.screenshot || null;
    if (!Number.isFinite(Number(screenshot?.width)) || !Number.isFinite(Number(screenshot?.height)) || !Number.isFinite(Number(screenshot?.byteLength))) {
      record("error", label, "capture-screenshot-size-recorded", { screenshot });
    }
    const comparison = environment.comparisons?.screenshotToRenderer;
    if (!comparison || comparison.withinTolerance !== true || !["css-pixel", "device-pixel-ratio"].includes(comparison.expectedScale)) {
      record("error", label, "capture-screenshot-renderer-size-verified", { comparison: comparison || null, renderer, screenshot });
    }
    if (!environment.evidenceQuality || environment.evidenceQuality.ok !== true || !["complete", "partial"].includes(environment.evidenceQuality.status)) {
      record("error", label, "capture-environment-evidence-quality", { evidenceQuality: environment.evidenceQuality || null });
    }
    if (result?.state?.canvasVisible && (!Number.isFinite(Number(canvas?.scale)) || !Number.isFinite(Number(canvas?.percent)))) {
      record("error", label, "canvas-zoom-recorded", { canvas });
    }
  }

  const selectionGeometry = result?.state?.canvasSelectionIndicatorMetrics?.geometry;
  const selectedGeometry = selectedNodeGeometry(result?.state);
  if (selectionGeometry && selectedGeometry && /focus|selected|selection|layer-stack|canvas-image/i.test(label)) {
    const overlap = geometryOverlap(selectionGeometry, selectedGeometry);
    if (overlap.area > 4) record("error", label, "selection-indicator-does-not-cover-selected-node", { overlap, selectionGeometry, selectedGeometry });
  }

  const layerCommitEvidence = result?.state?.layerCommitEvidence;
  if (Array.isArray(layerCommitEvidence?.operations) && layerCommitEvidence.operations.length > 0 && layerCommitEvidence.ok !== true) {
    record("error", label, "layer-result-card-after-node-commit", {
      pendingCount: layerCommitEvidence.pendingCount,
      operations: layerCommitEvidence.operations
    });
  }

  const reports = fileReports(result);
  const layerReports = reports.filter((item) => /[\\/]layers[\\/]group-/i.test(String(item?.path || "")));
  if (layerReports.length >= 3) {
    const background = layerReports.filter((item) => Number(item?.visibleRatio || 0) >= 0.9);
    const transparent = layerReports.filter((item) => Number(item?.visibleRatio || 0) > 0.005 && Number(item?.visibleRatio || 0) < 0.9);
    const hashes = uniqueExistingFileHashes(layerReports.map((item) => item.path));
    const transparentPaths = new Set(transparent.map((item) => String(item.path || "")));
    const transparentHashes = new Set(hashes.filter((item) => item.exists && transparentPaths.has(item.path)).map((item) => item.sha256));
    if (!background.length) record("error", label, "layer-background-is-opaque", { ratios: layerReports.map((item) => item.visibleRatio) });
    if (transparent.length < Math.min(2, layerReports.length - 1)) record("error", label, "layer-non-background-has-alpha", { ratios: layerReports.map((item) => item.visibleRatio) });
    if (transparentHashes.size < Math.min(3, transparent.length)) {
      record("error", label, "layer-assets-are-visually-distinct", {
        transparentLayerCount: transparent.length,
        uniqueTransparentHashes: transparentHashes.size,
        hashes
      });
    }
  }

  const previewMetrics = Array.isArray(result?.state?.selectedImagePreviewMetrics) ? result.state.selectedImagePreviewMetrics : [];
  if (previewMetrics.length >= 3 && /collection|batch|series|container/i.test(label)) {
    const hashes = uniqueExistingFileHashes(previewMetrics.map((item) => item.assetPath));
    const uniqueHashes = new Set(hashes.filter((item) => item.exists).map((item) => item.sha256));
    if (uniqueHashes.size < Math.min(3, previewMetrics.length)) {
      record("error", label, "multi-image-assets-are-distinct", { imageCount: previewMetrics.length, uniqueHashes: uniqueHashes.size, hashes });
    }
  }
}

for (const finding of reportGateFindings(report)) record("error", "__report__", finding.rule, finding.detail);
for (const finding of performanceReportFindings(report)) record("error", "__performance__", finding.rule, finding.detail);

const errors = findings.filter((item) => item.level === "error");
const warnings = findings.filter((item) => item.level === "warning");
const audit = {
  ok: errors.length === 0,
  reportPath,
  reportMode: report.mode || "full",
  reportOk: report.ok === true,
  checkedSceneCount: checkedScenes.length,
  checkedScenes,
  skippedScenes,
  errorCount: errors.length,
  warningCount: warnings.length,
  findings
};

if (!noWrite) writeFileSync(join(dirname(reportPath), "evidence-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
if (!audit.ok) process.exitCode = 1;
