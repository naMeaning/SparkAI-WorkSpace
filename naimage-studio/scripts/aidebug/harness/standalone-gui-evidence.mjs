import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { PNG } from "pngjs";

import { capturePngScreenshot } from "./screenshot.mjs";

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableSignature(value) {
  if (Array.isArray(value)) return `[${value.map(stableSignature).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSignature(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pngMetrics(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    const colors = new Set();
    let opaque = 0;
    let sampled = 0;
    const strideX = Math.max(1, Math.floor(png.width / 32));
    const strideY = Math.max(1, Math.floor(png.height / 24));
    for (let y = 0; y < png.height; y += strideY) {
      for (let x = 0; x < png.width; x += strideX) {
        const offset = (y * png.width + x) * 4;
        colors.add(`${png.data[offset]},${png.data[offset + 1]},${png.data[offset + 2]},${png.data[offset + 3]}`);
        if (png.data[offset + 3] >= 240) opaque += 1;
        sampled += 1;
      }
    }
    return {
      ok: png.width >= 320 && png.height >= 240 && colors.size >= 8 && opaque / Math.max(1, sampled) >= 0.9,
      width: png.width,
      height: png.height,
      uniqueSampleColors: colors.size,
      opaqueRatio: opaque / Math.max(1, sampled),
      sampled
    };
  } catch (error) {
    return {
      ok: false,
      width: 0,
      height: 0,
      uniqueSampleColors: 0,
      opaqueRatio: 0,
      sampled: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function normalizedOverflow(value) {
  return {
    documentOverflowX: Boolean(value?.documentOverflowX),
    bodyOverflowX: Boolean(value?.bodyOverflowX),
    elementOverflowX: Array.isArray(value?.elementOverflowX) ? value.elementOverflowX : []
  };
}

export function createObservationLog() {
  const observations = [];
  return {
    observations,
    recordObservation(level, label, detail = {}) {
      observations.push({ at: new Date().toISOString(), level, label, detail });
    }
  };
}

export async function captureStableCdpScene({
  client,
  runDir,
  label,
  readSnapshot,
  attempts = 4,
  settleMs = 240,
  timeoutMs = 20_000,
  captureParams = { captureBeyondViewport: false, fromSurface: true },
  visualPolicy = "overview"
}) {
  let firstFrame = null;
  let finalFrame = null;
  let firstSnapshot = null;
  let finalSnapshot = null;
  let stable = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    firstSnapshot = await readSnapshot();
    firstFrame = await capturePngScreenshot(client, captureParams, timeoutMs);
    await delay(settleMs);
    finalSnapshot = await readSnapshot();
    finalFrame = await capturePngScreenshot(client, captureParams, timeoutMs);
    stable = stableSignature(firstSnapshot?.state ?? firstSnapshot) === stableSignature(finalSnapshot?.state ?? finalSnapshot);
    if (stable) break;
    await delay(settleMs);
  }

  const firstFramePath = join(runDir, `${label}-frame-a.png`);
  const screenshotPath = join(runDir, `${label}.png`);
  writeFileSync(firstFramePath, firstFrame);
  writeFileSync(screenshotPath, finalFrame);

  const firstMetrics = pngMetrics(firstFrame);
  const finalMetrics = pngMetrics(finalFrame);
  const viewport = finalSnapshot?.viewport ?? finalSnapshot?.state?.viewport ?? null;
  const dimensionsMatch = !viewport || (
    Math.abs(finalMetrics.width - Number(viewport.width || 0)) <= 2 &&
    Math.abs(finalMetrics.height - Number(viewport.height || 0)) <= 2
  );
  const overflow = normalizedOverflow(finalSnapshot?.overflow);
  const stateIssues = Array.isArray(finalSnapshot?.stateIssues) ? [...finalSnapshot.stateIssues] : [];
  const captureIssues = [];
  if (!stable) captureIssues.push({ key: "state-stability", expected: true, actual: false });
  if (!firstMetrics.ok) captureIssues.push({ key: "first-frame-pixels", expected: true, actual: firstMetrics });
  if (!finalMetrics.ok) captureIssues.push({ key: "final-frame-pixels", expected: true, actual: finalMetrics });
  if (!dimensionsMatch) {
    captureIssues.push({
      key: "screenshot-dimensions",
      expected: viewport,
      actual: { width: finalMetrics.width, height: finalMetrics.height }
    });
  }
  if (finalSnapshot?.surfaceOk === false) {
    captureIssues.push({ key: "required-surface-visible", expected: true, actual: false });
  }

  const screenshotEvidence = {
    source: "cdp-dual-frame",
    path: screenshotPath,
    firstFramePath,
    width: finalMetrics.width,
    height: finalMetrics.height,
    byteLength: finalFrame.length,
    sha256: sha256Bytes(finalFrame),
    firstFrameSha256: sha256Bytes(firstFrame),
    finalFrameSha256: sha256Bytes(finalFrame)
  };
  const functionalOk = stateIssues.length === 0;
  const stateOk = stable;
  const visualOk = firstMetrics.ok && finalMetrics.ok && dimensionsMatch && !overflow.documentOverflowX && !overflow.bodyOverflowX && overflow.elementOverflowX.length === 0;
  const evidenceOk = screenshotEvidence.byteLength > 4096 && screenshotEvidence.width > 0 && screenshotEvidence.height > 0 && finalSnapshot?.surfaceOk !== false;
  const visualReliability = {
    ok: functionalOk && stateOk && visualOk && evidenceOk,
    status: functionalOk && stateOk && visualOk && evidenceOk ? "verified" : "failed",
    functionalOk,
    stateOk,
    visualOk,
    evidenceOk,
    failureReasons: [
      ...(functionalOk ? [] : ["state-assertion-failed"]),
      ...(stateOk ? [] : ["state-unstable-between-frames"]),
      ...(visualOk ? [] : ["visual-or-overflow-check-failed"]),
      ...(evidenceOk ? [] : ["screenshot-evidence-invalid"])
    ]
  };

  return {
    label,
    screenshotPath,
    firstFramePath,
    screenshotSource: "cdp-dual-frame",
    screenshotEvidence,
    nativeCapture: { ok: true, source: "cdp" },
    dualFrameReport: {
      ok: firstMetrics.ok && finalMetrics.ok && stable,
      stable,
      firstSha256: screenshotEvidence.firstFrameSha256,
      secondSha256: screenshotEvidence.finalFrameSha256,
      identicalPixels: screenshotEvidence.firstFrameSha256 === screenshotEvidence.finalFrameSha256
    },
    stateStabilityReport: {
      ok: stable,
      stable,
      firstSignatureSha256: sha256Bytes(stableSignature(firstSnapshot?.state ?? firstSnapshot)),
      secondSignatureSha256: sha256Bytes(stableSignature(finalSnapshot?.state ?? finalSnapshot))
    },
    screenshotFrameReport: { ok: firstMetrics.ok && finalMetrics.ok, first: firstMetrics, final: finalMetrics },
    screenshotSurfaceReport: { ok: finalSnapshot?.surfaceOk !== false && !overflow.documentOverflowX && !overflow.bodyOverflowX },
    visualReliability,
    visualPolicy,
    state: finalSnapshot?.state ?? finalSnapshot,
    stateIssues,
    captureIssues,
    overflow
  };
}
