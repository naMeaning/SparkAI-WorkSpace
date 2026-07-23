// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  applyMaskAlignmentTransform,
  extractPreviewLayerPixelsFromGeneratedInput,
  findLuminanceMaskAlignmentOffset,
  findTextMaskAlignmentTransform,
  fillNarrowSemanticMaskGaps,
  repairLayerCoveragePixelBuffers,
  refineTextMaskValuesFromPreview,
  solidifySemanticMaskValues
} from "../src/core.ts";
import { normalizeLayerAlphaPixelBuffers } from "../src/layer-alpha-normalization.ts";

const require = createRequire(import.meta.url);
const { refineSemanticLayers } = require("../semantic-matting.cjs");
const { removeConnectedBorderBackgroundPixels } = require("../background-removal.cjs");
const { resolveLayerReplayRoot } = require("./layer-replay-fixture.cjs");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function maskValues(preview, mask, options) {
  const width = preview.width;
  const height = preview.height;
  const pixelCount = width * height;
  const luma = new Uint8Array(pixelCount);
  const histogram = new Uint32Array(256);
  let border = 0;
  let borderSamples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const value = Math.round(mask.data[offset] * 0.2126 + mask.data[offset + 1] * 0.7152 + mask.data[offset + 2] * 0.0722);
      luma[index] = value;
      histogram[value] += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border += value;
        borderSamples += 1;
      }
    }
  }
  const invert = border / Math.max(1, borderSamples) > 140;
  const percentile = (ratio) => {
    const target = pixelCount * ratio;
    let cumulative = 0;
    for (let value = 0; value < 256; value += 1) {
      cumulative += histogram[value];
      if (cumulative >= target) return value;
    }
    return 255;
  };
  const tail = clamp(Math.round(pixelCount * 0.0002), 16, 512) / pixelCount;
  const rawLow = percentile(tail);
  const rawHigh = percentile(1 - tail);
  const low = invert ? 255 - rawHigh : rawLow;
  const high = invert ? 255 - rawLow : rawHigh;
  const contrast = high - low;
  assert(contrast >= 36, `mask contrast too low: ${contrast}`);
  const threshold = (low + high) / 2;
  let values = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) values[index] = invert ? 255 - luma[index] : luma[index];
  let hardMaskPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) if (values[index] >= threshold) hardMaskPixels += 1;
  const useTextScaleAlignment = options.refineText && hardMaskPixels >= 96;
  const alignment = options.alignment
    ? options.refineText && !useTextScaleAlignment
      ? { x: 0, y: 0, scale: 1, originX: width / 2, originY: height / 2, improvement: 0 }
      : useTextScaleAlignment
      ? findTextMaskAlignmentTransform(new Uint8ClampedArray(preview.data), values, width, height, threshold)
      : findLuminanceMaskAlignmentOffset(new Uint8ClampedArray(preview.data), values, width, height, threshold)
    : { x: 0, y: 0, scale: 1, originX: width / 2, originY: height / 2, improvement: 0 };
  const textAlignmentChanged = Boolean(alignment.x || alignment.y || Math.abs(Number(alignment.scale || 1) - 1) > 0.0001);
  if (textAlignmentChanged) {
    values = applyMaskAlignmentTransform(values, width, height, alignment);
  }
  if (options.refineText) {
    if (
      hardMaskPixels >= Math.max(96, Math.round(pixelCount * 0.003)) &&
      (textAlignmentChanged || Number(alignment.maskFillRatio || 0) >= 0.68)
    ) {
      values = refineTextMaskValuesFromPreview(new Uint8ClampedArray(preview.data), values, width, height, threshold);
    }
  }
  if (options.solidify) {
    for (let pass = 0; pass < Number(options.solidifyPasses || 1); pass += 1) values = solidifySemanticMaskValues(values, width, height, threshold);
  }
  if (options.fillNarrowGaps) values = fillNarrowSemanticMaskGaps(values, width, height, threshold, options.fillNarrowGaps);
  const lower = threshold - clamp(contrast * 0.2, 12, 42);
  const upper = threshold + clamp(contrast * 0.2, 12, 42);
  return { values, lower, upper, alignment };
}

function extract(preview, mask, options) {
  if (options.directPreferred) {
    const pixels = new Uint8ClampedArray(mask.data);
    let coloredPixels = 0;
    let transparentPixels = 0;
    for (let index = 0; index < preview.width * preview.height; index += 1) {
      const offset = index * 4;
      if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) - Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 24) coloredPixels += 1;
      if (pixels[offset + 3] < 245) transparentPixels += 1;
    }
    const coloredRatio = coloredPixels / Math.max(1, preview.width * preview.height);
    const transparentRatio = transparentPixels / Math.max(1, preview.width * preview.height);
    if (coloredRatio > 0.02 || transparentRatio > 0.02) {
      const isolation = removeConnectedBorderBackgroundPixels(pixels, preview.width, preview.height);
      assert(isolation.transparentRatio >= 0.04 && isolation.visibleRatio >= 0.006 && isolation.remainingChromaRatio <= 0.002, `direct layer ${options.id || options.role} did not form reliable transparency`);
      const output = new PNG({ width: preview.width, height: preview.height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
      output.data = Buffer.from(pixels);
      return {
        output,
        alignment: { x: 0, y: 0, scale: 1, originX: preview.width / 2, originY: preview.height / 2, improvement: 0 },
        inputMode: isolation.usedExistingAlpha ? "transparent-layer" : "isolated-color-plate",
        inputReport: isolation,
        directOutput: true
      };
    }
  }
  const alternate = extractPreviewLayerPixelsFromGeneratedInput(
    new Uint8ClampedArray(preview.data),
    new Uint8ClampedArray(mask.data),
    preview.width,
    preview.height
  );
  if (alternate.handled && alternate.output) {
    const output = new PNG({ width: preview.width, height: preview.height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
    output.data = Buffer.from(alternate.output);
    return {
      output,
      alignment: { x: 0, y: 0, improvement: 0 },
      inputMode: alternate.inputMode,
      inputReport: {
        maskColorRatio: alternate.maskColorRatio,
        maskTransparentRatio: alternate.maskTransparentRatio,
        borderMatchRatio: alternate.borderMatchRatio,
        removedPixels: alternate.removedPixels,
        visibleRatio: alternate.visibleRatio,
        transparentRatio: alternate.transparentRatio
      }
    };
  }
  const report = maskValues(preview, mask, options);
  const output = new PNG({ width: preview.width, height: preview.height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.from(preview.data);
  for (let index = 0; index < preview.width * preview.height; index += 1) {
    const normalized = clamp((report.values[index] - report.lower) / Math.max(1, report.upper - report.lower), 0, 1);
    const smooth = normalized * normalized * (3 - 2 * normalized);
    const offset = index * 4;
    output.data[offset + 3] = Math.round(output.data[offset + 3] * smooth);
    if (output.data[offset + 3] <= 1) output.data.fill(0, offset, offset + 4);
  }
  return { output, alignment: report.alignment, inputMode: "semantic-mask", inputReport: {} };
}

function composite(base, layers) {
  const output = new PNG({ width: base.width, height: base.height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.from(base.data);
  for (const layer of layers) {
    for (let offset = 0; offset < output.data.length; offset += 4) {
      const sa = layer.data[offset + 3] / 255;
      const da = output.data[offset + 3] / 255;
      const na = sa + da * (1 - sa);
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = na <= 0 ? 0 : Math.round((layer.data[offset + channel] * sa + output.data[offset + channel] * da * (1 - sa)) / na);
      }
      output.data[offset + 3] = Math.round(na * 255);
    }
  }
  return output;
}

function fidelity(left, right) {
  const count = left.width * left.height;
  let leftMean = 0;
  let rightMean = 0;
  let rgb = 0;
  const ll = new Float64Array(count);
  const rl = new Float64Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4;
    ll[pixel] = left.data[offset] * 0.2126 + left.data[offset + 1] * 0.7152 + left.data[offset + 2] * 0.0722;
    rl[pixel] = right.data[offset] * 0.2126 + right.data[offset + 1] * 0.7152 + right.data[offset + 2] * 0.0722;
    leftMean += ll[pixel];
    rightMean += rl[pixel];
    rgb += (Math.abs(left.data[offset] - right.data[offset]) + Math.abs(left.data[offset + 1] - right.data[offset + 1]) + Math.abs(left.data[offset + 2] - right.data[offset + 2])) / 3;
  }
  leftMean /= count;
  rightMean /= count;
  let covariance = 0;
  let lv = 0;
  let rv = 0;
  for (let index = 0; index < count; index += 1) {
    const a = ll[index] - leftMean;
    const b = rl[index] - rightMean;
    covariance += a * b;
    lv += a * a;
    rv += b * b;
  }
  return { luminanceCorrelation: covariance / Math.max(1, Math.sqrt(lv * rv)), meanRgbDelta: rgb / count };
}

function contribution(background, layers, records) {
  const under = Buffer.from(background.data);
  return layers.map((layer, index) => {
    let visible = 0;
    let strong = 0;
    let contrast = 0;
    for (let offset = 0; offset < under.length; offset += 4) {
      const alpha = layer.data[offset + 3] / 255;
      if (alpha > 0.06) {
        const delta = (Math.abs(layer.data[offset] - under[offset]) + Math.abs(layer.data[offset + 1] - under[offset + 1]) + Math.abs(layer.data[offset + 2] - under[offset + 2])) / 3;
        visible += 1;
        contrast += delta;
        if (delta > 24) strong += 1;
      }
      const da = under[offset + 3] / 255;
      const na = alpha + da * (1 - alpha);
      for (let channel = 0; channel < 3; channel += 1) under[offset + channel] = na <= 0 ? 0 : Math.round((layer.data[offset + channel] * alpha + under[offset + channel] * da * (1 - alpha)) / na);
      under[offset + 3] = Math.round(na * 255);
    }
    return { id: records[index].id, role: records[index].role, visible, meanContrast: contrast / Math.max(1, visible), strongRatio: strong / Math.max(1, visible) };
  });
}

const explicitRoot = process.argv.find((value, index) => index > 1 && value !== "--write" && value !== "--report-only");
const replayFixture = resolveLayerReplayRoot({ repoRoot: process.cwd(), explicitRoot });
if (!replayFixture.root) {
  const result = {
    ok: true,
    skipped: true,
    reason: "no-real-layer-fixture",
    hint: "Pass a real imagegen output folder to run the strict replay.",
  };
  if (process.env.IIIMAGE_REQUIRE_REAL_LAYER_FIXTURE === "1") assert.fail(result.hint);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const root = replayFixture.root;
const files = readdirSync(root).filter((name) => name.toLowerCase().endsWith(".png"));
// A project output folder legitimately contains many Agent runs.  Replaying
// every matching filename together aliases semantic IDs such as `character`
// across runs and makes the diagnostic fail before it can inspect quality.
// Select the newest lexically sortable run prefix and keep its preview/layers
// isolated, matching the product's operation-level asset grouping.
const previewName = files
  .filter((name) => /-preview-1-01\.png$/i.test(name))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
  .at(-1);
const runPrefix = previewName?.replace(/-preview-1-01\.png$/i, "");
const batchFiles = runPrefix ? files.filter((name) => name.startsWith(`${runPrefix}-`)) : [];
const classifyRole = (name, index) => {
  if (index === 1) return "background";
  if (/title|heading|headline|body[_-]?copy|caption|text|copy|标题|文字/i.test(name)) return "text";
  if (/(?:^|[_-])props?(?:$|[_-])|character[_-]?props?|product|goods|bottle|item|object|decoration|道具|商品|产品/i.test(name)) return "decoration";
  if (/character|subject|person|model|人物|主体|模特/i.test(name)) return "subject";
  if (/foreground|front[_-]?scene|前景/i.test(name)) return "foreground";
  if (/shadow|阴影/i.test(name)) return "shadow";
  return "other";
};
const records = batchFiles
  .map((name) => {
    const match = name.match(/^.*-([1-8])-([a-z0-9_-]+)-1-01\.png$/i);
    if (!match) return null;
    const index = Number(match[1]);
    const id = match[2].replace(/[^a-z0-9_-]+/gi, "-");
    const role = classifyRole(id, index);
    return {
      index,
      id,
      role,
      name,
      directPreferred: role === "subject" || role === "decoration",
      solidify: role === "decoration" || role === "text",
      solidifyPasses: 1,
      alignment: role === "text",
      refineText: role === "text"
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.index - right.index);
assert(previewName && records.length >= 2 && records[0]?.role === "background", "missing preview or ordered layer files");
const preview = PNG.sync.read(readFileSync(join(root, previewName)));
const background = PNG.sync.read(readFileSync(join(root, records[0].name)));
const extracted = records.slice(1).map((record) => {
  const mask = PNG.sync.read(readFileSync(join(root, record.name)));
  const result = extract(preview, mask, record);
  let visiblePixels = 0;
  for (let index = 0; index < preview.width * preview.height; index += 1) {
    if (result.output.data[index * 4 + 3] > 1) visiblePixels += 1;
  }
  const alignmentChanged = Boolean(
    Number(result.alignment?.x || 0) ||
    Number(result.alignment?.y || 0) ||
    Math.abs(Number(result.alignment?.scale || 1) - 1) > 0.0001
  );
  return {
    ...record,
    ...result,
    preserveGeometry: record.role === "text" && visiblePixels / Math.max(1, preview.width * preview.height) < 0.003 && alignmentChanged
  };
});
const preNormalization = extracted.map((record) => PNG.sync.read(PNG.sync.write(record.output)));
const pngDataUrl = (png) => `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
const directExtracted = extracted.filter((record) => record.directOutput === true);
const directAlignment = directExtracted.length
  ? await refineSemanticLayers({
      mode: "direct-alignment",
      width: preview.width,
      height: preview.height,
      previewSource: pngDataUrl(preview),
      backgroundSource: pngDataUrl(background),
      layers: directExtracted.map((record) => ({ id: record.id, role: record.role, source: pngDataUrl(record.output) }))
    }, { diagnostics: process.argv.includes("--write") })
  : { ok: true, engine: "direct-rgba-alignment", reports: [], layers: [] };
assert(Array.isArray(directAlignment.layers), "direct layer alignment did not return layers");
const directById = new Map(directAlignment.layers.map((layer) => [layer.id, layer.source]));
for (const record of directExtracted) {
  const source = directById.get(record.id);
  if (!source) continue;
  record.output = PNG.sync.read(Buffer.from(String(source).split(",")[1] || "", "base64"));
  record.alignment = directAlignment.reports?.find((report) => report.id === record.id) || record.alignment;
}
// Mirror the renderer pipeline: aligned direct subjects still require
// preview/background semantic cleanup, while direct products remain
// geometry-locked blockers so duplicated product/text pixels cannot survive
// inside the subject layer.
const semanticCandidates = extracted;
const semanticMatting = semanticCandidates.length
  ? await refineSemanticLayers({
      width: preview.width,
      height: preview.height,
      previewSource: pngDataUrl(preview),
      backgroundSource: pngDataUrl(background),
      layers: semanticCandidates.map((record) => ({
        id: record.id,
        role: record.role,
        source: pngDataUrl(record.output),
        preserveGeometry: record.preserveGeometry === true || (record.directOutput === true && record.role !== "subject"),
        directSubjectSeed: record.directOutput === true && record.role === "subject"
      }))
    }, { diagnostics: process.argv.includes("--write") })
  : { ok: true, engine: "direct-semantic", reports: [], layers: [], diagnostics: [] };
assert(semanticMatting.ok && Array.isArray(semanticMatting.layers), "semantic matting did not return refined layers");
const rejectedSubject = semanticMatting.reports?.find((report) => report.role === "subject" && report.accepted !== true);
const rejectedDirect = directAlignment.reports?.filter((report) => report.accepted !== true) || [];
const subjectMattingRisks = (semanticMatting.reports || []).filter((report) => {
  if (report.role !== "subject" || report.accepted !== true) return false;
  const input = Math.max(1, Number(report.inputVisiblePixels || 0));
  const output = Number(report.outputVisiblePixels || 0);
  const removed = Number(report.trustedSupportRemovedPixels || 0);
  const restored = Number(report.trustedSupportRestoredPixels || 0);
  const suspiciousCandidates = (report.backgroundPlateCandidates || []).filter((region) =>
    (Number(region.meanDifference || 0) <= 8 && Number(region.meanTrustedDistance ?? -1) >= 48) ||
    (Number(region.minY || 0) >= preview.height * 0.65 && Number(region.meanTrustedDistance ?? -1) >= 60)
  ).reduce((total, region) => total + Number(region.size || 0), 0);
  const plateRemoved = Number(report.backgroundPlateRemovedPixels || 0);
  const directSubjectSeed = report.directSubjectSeed === true;
  const retainedRatioUnsafe = directSubjectSeed
    ? output / input < 0.55 || output / input > 2.8 || output / Math.max(1, preview.width * preview.height) > 0.35
    : output / input < 0.38 || output / input > 1.15;
  const destructiveCleanup = report.trustedCleanupApplied === true && removed > input * 0.12 && restored < Math.max(256, removed * 0.04);
  const missedPlateCleanup = suspiciousCandidates > 0 && plateRemoved < suspiciousCandidates * 0.7;
  return retainedRatioUnsafe || destructiveCleanup || missedPlateCleanup;
});
const unsafeAlignments = (semanticMatting.reports || []).filter((report) => {
  if (report.alignmentApplied !== true) return false;
  const scale = Number(report.alignmentScale || 1);
  const largeRescale = scale < 0.84 || scale > 1.08;
  if (!largeRescale) return false;
  if (report.role === "subject") return Number(report.alignmentBaseScore || 0) >= 50;
  if (report.role === "decoration") return Number(report.inputVisiblePixels || 0) / (preview.width * preview.height) < 0.06;
  return false;
});
const semanticById = new Map(semanticMatting.layers.map((layer) => [layer.id, layer.source]));
for (const record of extracted) {
  const source = semanticById.get(record.id);
  if (!source) continue;
  record.output = PNG.sync.read(Buffer.from(String(source).split(",")[1] || "", "base64"));
}
const semanticPreparedLayers = extracted.map((record) => PNG.sync.read(PNG.sync.write(record.output)));
const textGeometryReports = extracted.map((record, index) => {
  if (record.role !== "text" || record.preserveGeometry !== true) return null;
  const before = preNormalization[index];
  const after = semanticPreparedLayers[index];
  let beforeVisible = 0;
  let afterVisible = 0;
  let intersection = 0;
  let union = 0;
  for (let pixel = 0; pixel < preview.width * preview.height; pixel += 1) {
    const beforeOn = before.data[pixel * 4 + 3] > 16;
    const afterOn = after.data[pixel * 4 + 3] > 16;
    if (beforeOn) beforeVisible += 1;
    if (afterOn) afterVisible += 1;
    if (beforeOn && afterOn) intersection += 1;
    if (beforeOn || afterOn) union += 1;
  }
  return {
    id: record.id,
    beforeVisible,
    afterVisible,
    alphaIou: intersection / Math.max(1, union),
    visibleRetention: afterVisible / Math.max(1, beforeVisible)
  };
}).filter(Boolean);
const damagedLockedText = textGeometryReports.filter((report) => report.alphaIou < 0.98 || report.visibleRetention < 0.98);
const checkerboardRisks = extracted
  .filter((record) => record.inputReport?.checkerboardDetected === true)
  .filter((record) =>
    Number(record.inputReport?.checkerboardSuspiciousRemovedPixels || 0) > 0 ||
    Number(record.inputReport?.checkerboardConfidence || 0) < 0.8 ||
    Number(record.inputReport?.checkerboardBorderMatchRatio || 0) < 0.72
  )
  .map((record) => ({ id: record.id, role: record.role, ...record.inputReport }));
const buffers = extracted.map((record) => new Uint8ClampedArray(record.output.data));
const normalization = normalizeLayerAlphaPixelBuffers(buffers, preview.width, preview.height);
const underfilledLayers = normalization.reports
  .map((report, index) => ({ id: extracted[index].id, role: extracted[index].role, visibleRatio: report.visibleRatio }))
  .filter((item) => item.visibleRatio < (item.role === "text" ? 0.001 : item.role === "shadow" ? 0.002 : 0.005));
const preCoverageLayers = buffers.map((buffer) => {
  const png = new PNG({ width: preview.width, height: preview.height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  png.data = Buffer.from(buffer);
  return png;
});
const preCoverageComposite = composite(background, preCoverageLayers);
const preCoverageFidelity = fidelity(preview, preCoverageComposite);
const semanticCandidateComposite = composite(background, semanticPreparedLayers);
const semanticCandidateFidelity = fidelity(preview, semanticCandidateComposite);
const coverageRepair = repairLayerCoveragePixelBuffers(
  new Uint8ClampedArray(preview.data),
  new Uint8ClampedArray(background.data),
  buffers,
  preview.width,
  preview.height,
  extracted.map(({ id, role, directOutput }) => ({ id, role, semanticRefined: directOutput === true || semanticById.has(id) }))
);
extracted.forEach((record, index) => { record.output.data = Buffer.from(buffers[index]); });
const merged = composite(background, extracted.map((record) => record.output));
const fidelityReport = fidelity(preview, merged);
const contributionReport = contribution(background, extracted.map((record) => record.output), extracted);
const hybridDirect = directExtracted.length > 0;
const fidelityThreshold = hybridDirect ? 0.82 : 0.72;
const residualLimit = hybridDirect ? 0.22 : 0.3;
const fidelityDeltaLimit = hybridDirect ? 18 : 40;
const fidelityOk = fidelityReport.luminanceCorrelation >= fidelityThreshold && fidelityReport.meanRgbDelta <= fidelityDeltaLimit;
const coverageOk = coverageRepair.residualRatio <= residualLimit;
const weakLayers = [];
for (const report of contributionReport) {
  const title = report.id === "title";
  const weak = title
    ? report.strongRatio < 0.45 || report.meanContrast < 24
    : report.role === "text"
      ? report.strongRatio < 0.18 || report.meanContrast < 14
      : report.role === "subject" || report.role === "decoration"
        ? report.strongRatio < 0.2 || report.meanContrast < 14
        : report.strongRatio < 0.1 || report.meanContrast < 8;
  if (weak) weakLayers.push(report.id);
}
const outputDir = join(root, "mask-replay");
if (process.argv.includes("--write")) {
  mkdirSync(outputDir, { recursive: true });
  for (const diagnostic of semanticMatting.diagnostics || []) {
    for (const [name, source] of Object.entries(diagnostic)) {
      if (name === "id" || name === "role" || typeof source !== "string") continue;
      writeFileSync(join(outputDir, `diagnostic-${diagnostic.id}-${name}.png`), Buffer.from(source.split(",")[1] || "", "base64"));
    }
  }
  preNormalization.forEach((layer, index) => writeFileSync(join(outputDir, `raw-${String(index + 2).padStart(2, "0")}-${extracted[index].id}.png`), PNG.sync.write(layer)));
  semanticPreparedLayers.forEach((layer, index) => writeFileSync(join(outputDir, `semantic-${String(index + 2).padStart(2, "0")}-${extracted[index].id}.png`), PNG.sync.write(layer)));
  preCoverageLayers.forEach((layer, index) => writeFileSync(join(outputDir, `precoverage-${String(index + 2).padStart(2, "0")}-${extracted[index].id}.png`), PNG.sync.write(layer)));
  extracted.forEach((record, index) => writeFileSync(join(outputDir, `${String(index + 2).padStart(2, "0")}-${record.id}.png`), PNG.sync.write(record.output)));
  writeFileSync(join(outputDir, "98-precoverage-recomposed.png"), PNG.sync.write(preCoverageComposite));
  writeFileSync(join(outputDir, "98-semantic-candidate-recomposed.png"), PNG.sync.write(semanticCandidateComposite));
  writeFileSync(join(outputDir, "99-recomposed.png"), PNG.sync.write(merged));
  writeFileSync(join(outputDir, "report.json"), JSON.stringify({ previewName, records: extracted.map(({ id, role, name, alignment, inputMode, inputReport, preserveGeometry }) => ({ id, role, name, alignment, inputMode, inputReport, preserveGeometry })), directAlignment: { engine: directAlignment.engine, reports: directAlignment.reports }, semanticMatting: { engine: semanticMatting.engine, reports: semanticMatting.reports }, textGeometryReports, normalization, qualityGate: { hybridDirect, fidelityThreshold, fidelityDeltaLimit, residualLimit }, preCoverageFidelity, semanticCandidateFidelity, coverageRepair, fidelityReport, contributionReport }, null, 2));
}
const ok = !rejectedSubject && rejectedDirect.length === 0 && subjectMattingRisks.length === 0 && unsafeAlignments.length === 0 && damagedLockedText.length === 0 && checkerboardRisks.length === 0 && fidelityOk && coverageOk && weakLayers.length === 0;
console.log(JSON.stringify({ ok, outputDir: process.argv.includes("--write") ? outputDir : "", inputs: extracted.map(({ id, role, inputMode, inputReport, preserveGeometry }) => ({ id, role, inputMode, inputReport, preserveGeometry })), directAlignment: { engine: directAlignment.engine, reports: directAlignment.reports }, semanticMatting: { engine: semanticMatting.engine, reports: semanticMatting.reports }, rejectedDirect, subjectMattingRisks, unsafeAlignments, textGeometryReports, damagedLockedText, checkerboardRisks, underfilledLayers, qualityGate: { hybridDirect, fidelityThreshold, fidelityDeltaLimit, residualLimit, fidelityOk, coverageOk }, preCoverageFidelity, semanticCandidateFidelity, coverageRepair, fidelityReport, contributionReport, weakLayers, alignments: extracted.map(({ id, alignment }) => ({ id, alignment })) }, null, 2));
if (!process.argv.includes("--report-only")) {
  assert(!rejectedSubject, `subject semantic matting rejected: ${rejectedSubject?.reason || "unknown"}`);
  assert.equal(rejectedDirect.length, 0, `direct layer alignment rejected: ${rejectedDirect.map((report) => report.id).join(", ")}`);
  assert.equal(subjectMattingRisks.length, 0, `subject semantic matting risk: ${subjectMattingRisks.map((report) => report.id).join(", ")}`);
  assert.equal(unsafeAlignments.length, 0, `unsafe semantic alignment: ${unsafeAlignments.map((report) => `${report.id}:${report.alignmentScale}`).join(", ")}`);
  assert.equal(damagedLockedText.length, 0, `small text geometry changed: ${damagedLockedText.map((report) => report.id).join(", ")}`);
  assert.equal(checkerboardRisks.length, 0, `checkerboard extraction risk: ${checkerboardRisks.map((report) => report.id).join(", ")}`);
  assert.equal(underfilledLayers.length, 0, `valid layer area below product threshold: ${underfilledLayers.map((report) => `${report.id}:${report.visibleRatio}`).join(", ")}`);
  assert(coverageOk, `replayed layers exceed residual threshold ${residualLimit}`);
  assert(fidelityOk, "replayed layers do not meet fidelity threshold");
  assert.equal(weakLayers.length, 0, `weak layer contribution: ${weakLayers.join(", ")}`);
}
