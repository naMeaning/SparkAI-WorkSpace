import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAidebugReporting } from "./aidebug/harness/reporting.mjs";

function createPngHeader(width = 2, height = 2) {
  const buffer = Buffer.alloc(24);
  buffer.write("PNG", 1, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function createResult(screenshotPath, overrides = {}) {
  return {
    label: "reporting-selftest & fixture",
    screenshotPath,
    state: {},
    stateIssues: [],
    overflow: { documentOverflowX: false, bodyOverflowX: false, elementOverflowX: [] },
    captureIssues: [],
    visualReliability: { status: "verified" },
    visualPolicy: "overview",
    screenshotFrameReport: { ok: true },
    screenshotSurfaceReport: { ok: true },
    ...overrides
  };
}

function createReporter(root, { observations = [], logs = [], exitCodes = [] } = {}) {
  const runDir = join(root, "run");
  const desktopLogPath = join(root, "desktop", "aidebug-history.md");
  const fallbackPng = createPngHeader();
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    desktopLogPath,
    observations,
    logs,
    exitCodes,
    reporter: createAidebugReporting({
      runDir,
      desktopLogPath,
      observations,
      mockAgent: true,
      cycleIndex: 2,
      cycleTotal: 3,
      fallbackPng,
      recordObservation(level, label, detail) {
        observations.push({ at: "selftest", level, label, detail });
      },
      log(value) {
        logs.push(value);
      },
      setExitCode(value) {
        exitCodes.push(value);
      }
    })
  };
}

const root = mkdtempSync(join(tmpdir(), "iiimage-aidebug-reporting-"));
try {
  const success = createReporter(join(root, "success"), {
    observations: [{ at: "selftest", level: "info", label: "fixture", detail: {} }]
  });
  const screenshotPath = join(success.runDir, "fixture.png");
  writeFileSync(screenshotPath, createPngHeader(4, 3));
  const results = [createResult(screenshotPath)];
  const outcome = success.reporter.finishSuiteRun({
    results,
    reportMetadata: { mode: "reporting-contract", reportOnly: "kept" },
    consoleMetadata: { mode: "reporting-contract" },
    reportAfterObservations: { performance: { durationMs: 12 } },
    consoleAfterSummary: { performance: { durationMs: 12 } }
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.failures, []);
  assert.deepEqual(success.exitCodes, []);
  assert.equal(success.logs.length, 1);
  assert.ok(existsSync(outcome.contactSheetPath));
  assert.ok(existsSync(outcome.summaryPath));
  assert.ok(existsSync(success.desktopLogPath));
  assert.match(readFileSync(outcome.contactSheetPath, "utf8"), /reporting-selftest &amp; fixture/);
  assert.match(readFileSync(outcome.summaryPath, "utf8"), /^# IIimage AIDebug Run/u);

  const report = JSON.parse(readFileSync(outcome.reportPath, "utf8"));
  assert.deepEqual(Object.keys(report), [
    "ok",
    "mode",
    "reportOnly",
    "runDir",
    "reportPath",
    "contactSheetPath",
    "summaryPath",
    "observations",
    "performance",
    "results",
    "failures"
  ]);
  assert.equal(report.results[0].label, results[0].label);
  assert.deepEqual(report.performance, { durationMs: 12 });

  const consolePayload = JSON.parse(success.logs[0]);
  assert.deepEqual(Object.keys(consolePayload), [
    "ok",
    "mode",
    "runDir",
    "reportPath",
    "contactSheetPath",
    "summaryPath",
    "performance",
    "failures"
  ]);
  assert.equal("reportOnly" in consolePayload, false);

  success.reporter.appendSupervisorDesktopLog("contract-supervisor", true, { stages: 2 });
  const desktopLog = readFileSync(success.desktopLogPath, "utf8");
  assert.match(desktopLog, /cycle 2\/3/u);
  assert.match(desktopLog, /contract-supervisor/u);
  assert.match(desktopLog, /- stages: 2/u);

  const failure = createReporter(join(root, "failure"));
  const failureScreenshotPath = join(failure.runDir, "fixture.png");
  writeFileSync(failureScreenshotPath, createPngHeader());
  const failureOutcome = failure.reporter.finishSuiteRun({
    results: [createResult(failureScreenshotPath, { stateIssues: [{ key: "fixture", expected: true, actual: false }] })],
    reportMetadata: { imageRuns: 2, stressRounds: 3 },
    includeReportPathInReport: false
  });
  const failureReport = JSON.parse(readFileSync(failureOutcome.reportPath, "utf8"));
  assert.equal(failureOutcome.ok, false);
  assert.equal(failureOutcome.failures.length, 1);
  assert.deepEqual(failure.exitCodes, [1]);
  assert.equal("reportPath" in failureReport, false);
  assert.deepEqual(Object.keys(failureReport), [
    "ok",
    "imageRuns",
    "stressRounds",
    "runDir",
    "contactSheetPath",
    "summaryPath",
    "observations",
    "results",
    "failures"
  ]);

  console.log("AIDebug reporting self-test passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
