// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import { extractPreviewLayerPixelsFromGeneratedInput, normalizeLayerAlphaPixelBuffers } from "../src/core.ts";

function alphaAt(buffer: Uint8ClampedArray, pixel: number) {
  return buffer[pixel * 4 + 3];
}

function syntheticContract() {
  const width = 4;
  const height = 1;
  const layer = (red: number, green: number, blue: number, alpha: number[]) => {
    const buffer = new Uint8ClampedArray(width * height * 4);
    alpha.forEach((value, pixel) => {
      const offset = pixel * 4;
      buffer[offset] = red;
      buffer[offset + 1] = green;
      buffer[offset + 2] = blue;
      buffer[offset + 3] = value;
    });
    return buffer;
  };
  const lower = layer(220, 30, 30, [255, 255, 255, 0]);
  const upper = layer(30, 80, 220, [0, 255, 0, 0]);
  const softTop = layer(40, 220, 80, [0, 0, 128, 0]);
  const report = normalizeLayerAlphaPixelBuffers([lower, upper, softTop], width, height);
  assert.equal(alphaAt(lower, 0), 255, "uncovered lower pixel must remain opaque");
  assert.equal(alphaAt(lower, 1), 0, "opaque upper layer must own the overlapping pixel");
  assert.equal(alphaAt(upper, 1), 255, "upper layer must retain its pixel");
  assert.equal(alphaAt(lower, 2), 0, "soft upper edge must exclusively own its semantic pixel in lower layers");
  assert.equal(alphaAt(softTop, 2), 128, "top layer alpha must remain unchanged");
  assert(report.reports[0].removedRatio > 0.65 && report.reports[0].removedRatio < 0.68);
  return report;
}

function syntheticDirectLayerContract() {
  const width = 4;
  const height = 1;
  const layer = (red: number, green: number, blue: number, alpha: number[]) => {
    const buffer = new Uint8ClampedArray(width * height * 4);
    alpha.forEach((value, pixel) => {
      const offset = pixel * 4;
      buffer[offset] = red;
      buffer[offset + 1] = green;
      buffer[offset + 2] = blue;
      buffer[offset + 3] = value;
    });
    return buffer;
  };
  const lowerMask = layer(250, 220, 80, [255, 255, 0, 0]);
  const directSubject = layer(220, 90, 90, [0, 255, 255, 0]);
  const directProduct = layer(60, 140, 230, [0, 0, 255, 255]);
  const upperMask = layer(245, 245, 245, [0, 0, 0, 255]);
  const report = normalizeLayerAlphaPixelBuffers(
    [lowerMask, directSubject, directProduct, upperMask],
    width,
    height
  );
  assert.equal(alphaAt(lowerMask, 0), 255, "uncovered mask pixels must remain visible");
  assert.equal(alphaAt(lowerMask, 1), 0, "a lower semantic mask must still yield ownership to a direct layer above it");
  assert.equal(alphaAt(directSubject, 1), 255, "a direct subject pixel must remain intact");
  assert.equal(alphaAt(directSubject, 2), 0, "a separate product layer must own product pixels duplicated by a lower subject reconstruction");
  assert.equal(alphaAt(directProduct, 2), 255, "a direct product must preserve its own complete alpha");
  assert.equal(alphaAt(directProduct, 3), 0, "an upper text/effect layer must own pixels duplicated by a direct product reconstruction");
  assert.equal(alphaAt(upperMask, 3), 255, "an upper semantic mask must retain its own pixels");
  assert(report.reports[1].removedRatio > 0.49 && report.reports[1].removedRatio < 0.51);
  assert(report.reports[2].removedRatio > 0.49 && report.reports[2].removedRatio < 0.51);
  assert(report.reports[0].removedRatio > 0.49 && report.reports[0].removedRatio < 0.51);
  return report;
}

function generatedLayerInputContract() {
  const width = 5;
  const height = 5;
  const pixelCount = width * height;
  const preview = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    preview[offset] = 40 + pixel * 3;
    preview[offset + 1] = 90 + pixel * 2;
    preview[offset + 2] = 150;
    preview[offset + 3] = 255;
  }
  const grayscaleMask = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value = pixel === 12 ? 255 : 0;
    grayscaleMask[offset] = grayscaleMask[offset + 1] = grayscaleMask[offset + 2] = value;
    grayscaleMask[offset + 3] = 255;
  }
  const semantic = extractPreviewLayerPixelsFromGeneratedInput(preview, grayscaleMask, width, height);
  assert.equal(semantic.handled, false);
  assert.equal(semantic.inputMode, "semantic-mask");

  const transparentLayer = new Uint8ClampedArray(grayscaleMask);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) transparentLayer[pixel * 4 + 3] = pixel === 12 ? 255 : 0;
  const transparent = extractPreviewLayerPixelsFromGeneratedInput(preview, transparentLayer, width, height);
  assert.equal(transparent.handled, true);
  assert.equal(transparent.inputMode, "transparent-layer");
  assert.equal(transparent.output?.[12 * 4 + 3], 255);
  assert.equal(transparent.output?.[0 * 4 + 3], 0);

  const colorPlate = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) colorPlate[pixel * 4 + 3] = 255;
  colorPlate[12 * 4] = 220;
  colorPlate[12 * 4 + 1] = 100;
  colorPlate[12 * 4 + 2] = 40;
  const isolated = extractPreviewLayerPixelsFromGeneratedInput(preview, colorPlate, width, height);
  assert.equal(isolated.handled, true);
  assert.equal(isolated.inputMode, "isolated-color-plate");
  assert.equal(isolated.output?.[12 * 4 + 3], 255);
  assert.equal(isolated.output?.[0 * 4 + 3], 0);

  const arbitraryColor = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    arbitraryColor[offset] = (pixel * 71) % 255;
    arbitraryColor[offset + 1] = (pixel * 37 + 80) % 255;
    arbitraryColor[offset + 2] = (pixel * 19 + 160) % 255;
    arbitraryColor[offset + 3] = 255;
  }
  const unsupported = extractPreviewLayerPixelsFromGeneratedInput(preview, arbitraryColor, width, height);
  assert.equal(unsupported.handled, false);
  assert.equal(unsupported.inputMode, "unsupported-color");
  return {
    semantic: semantic.inputMode,
    transparent: transparent.inputMode,
    isolated: isolated.inputMode,
    unsupported: unsupported.inputMode
  };
}

function overlapReports(buffers: Uint8ClampedArray[], width: number, height: number) {
  const pixelCount = width * height;
  const pairs = [];
  for (let left = 0; left < buffers.length; left += 1) {
    let leftVisible = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) if (alphaAt(buffers[left], pixel) > 32) leftVisible += 1;
    for (let right = left + 1; right < buffers.length; right += 1) {
      let rightVisible = 0;
      let overlap = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const leftOn = alphaAt(buffers[left], pixel) > 32;
        const rightOn = alphaAt(buffers[right], pixel) > 32;
        if (rightOn) rightVisible += 1;
        if (leftOn && rightOn) overlap += 1;
      }
      pairs.push({
        left,
        right,
        overlapPixels: overlap,
        canvasRatio: overlap / Math.max(1, pixelCount),
        smallerLayerRatio: overlap / Math.max(1, Math.min(leftVisible, rightVisible))
      });
    }
  }
  return pairs;
}

function alphaComposite(base: PNG, overlays: PNG[]) {
  const output = new PNG({ width: base.width, height: base.height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.from(base.data);
  for (const overlay of overlays) {
    for (let offset = 0; offset < output.data.length; offset += 4) {
      const sourceAlpha = overlay.data[offset + 3] / 255;
      const targetAlpha = output.data[offset + 3] / 255;
      const nextAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = nextAlpha <= 0
          ? 0
          : Math.round((overlay.data[offset + channel] * sourceAlpha + output.data[offset + channel] * targetAlpha * (1 - sourceAlpha)) / nextAlpha);
      }
      output.data[offset + 3] = Math.round(nextAlpha * 255);
    }
  }
  return output;
}

function visualFidelity(left: PNG, right: PNG, region = { left: 0, top: 0, right: 1, bottom: 1 }) {
  assert.equal(left.width, right.width);
  assert.equal(left.height, right.height);
  const x0 = Math.max(0, Math.floor(left.width * region.left));
  const y0 = Math.max(0, Math.floor(left.height * region.top));
  const x1 = Math.min(left.width, Math.ceil(left.width * region.right));
  const y1 = Math.min(left.height, Math.ceil(left.height * region.bottom));
  const count = Math.max(1, (x1 - x0) * (y1 - y0));
  let rgbDelta = 0;
  let changedPixels = 0;
  const pixelDeltas = new Float64Array(count);
  let leftMean = 0;
  let rightMean = 0;
  const leftLuma = new Float64Array(count);
  const rightLuma = new Float64Array(count);
  let pixel = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1, pixel += 1) {
    const offset = (y * left.width + x) * 4;
    const ll = left.data[offset] * 0.2126 + left.data[offset + 1] * 0.7152 + left.data[offset + 2] * 0.0722;
    const rl = right.data[offset] * 0.2126 + right.data[offset + 1] * 0.7152 + right.data[offset + 2] * 0.0722;
    leftLuma[pixel] = ll;
    rightLuma[pixel] = rl;
    leftMean += ll;
    rightMean += rl;
    rgbDelta += Math.abs(left.data[offset] - right.data[offset]);
    rgbDelta += Math.abs(left.data[offset + 1] - right.data[offset + 1]);
    rgbDelta += Math.abs(left.data[offset + 2] - right.data[offset + 2]);
    const pixelDelta = (
      Math.abs(left.data[offset] - right.data[offset]) +
      Math.abs(left.data[offset + 1] - right.data[offset + 1]) +
      Math.abs(left.data[offset + 2] - right.data[offset + 2])
    ) / 3;
    pixelDeltas[pixel] = pixelDelta;
    if (pixelDelta > 32) changedPixels += 1;
    }
  }
  leftMean /= count;
  rightMean /= count;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const leftCentered = leftLuma[pixel] - leftMean;
    const rightCentered = rightLuma[pixel] - rightMean;
    covariance += leftCentered * rightCentered;
    leftVariance += leftCentered * leftCentered;
    rightVariance += rightCentered * rightCentered;
  }
  const sortedDeltas = Array.from(pixelDeltas).sort((a, b) => a - b);
  return {
    luminanceCorrelation: covariance / Math.max(1, Math.sqrt(leftVariance * rightVariance)),
    meanRgbDelta: rgbDelta / Math.max(1, count * 3),
    changedPixelRatio: changedPixels / Math.max(1, count),
    p90RgbDelta: sortedDeltas[Math.min(sortedDeltas.length - 1, Math.floor(sortedDeltas.length * 0.9))] || 0,
    p95RgbDelta: sortedDeltas[Math.min(sortedDeltas.length - 1, Math.floor(sortedDeltas.length * 0.95))] || 0
  };
}

function fidelityBands(left: PNG, right: PNG) {
  return {
    full: visualFidelity(left, right),
    top: visualFidelity(left, right, { left: 0, top: 0, right: 1, bottom: 0.34 }),
    center: visualFidelity(left, right, { left: 0, top: 0.2, right: 1, bottom: 0.84 }),
    bottom: visualFidelity(left, right, { left: 0, top: 0.74, right: 1, bottom: 1 })
  };
}

function realFixture(folder: string, writeOutputs: boolean) {
  assert(existsSync(folder), `fixture folder does not exist: ${folder}`);
  const files = readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".png")).sort();
  const previewName = files.find((name) => name.startsWith("00-preview-"));
  const backgroundName = files.find((name) => name.startsWith("01-background-"));
  const existingRecomposedName = files.find((name) => name.startsWith("99-recomposed-"));
  const layerNames = files.filter((name) => /^0[2-9]-/.test(name));
  assert(previewName && backgroundName && layerNames.length >= 2, "fixture needs preview, background and transparent layers");
  const preview = PNG.sync.read(readFileSync(join(folder, previewName)));
  const background = PNG.sync.read(readFileSync(join(folder, backgroundName)));
  const existingRecomposed = existingRecomposedName ? PNG.sync.read(readFileSync(join(folder, existingRecomposedName))) : null;
  const layers = layerNames.map((name) => PNG.sync.read(readFileSync(join(folder, name))));
  assert(layers.every((layer) => layer.width === preview.width && layer.height === preview.height));
  const buffers = layers.map((layer) => new Uint8ClampedArray(layer.data));
  const overlapBefore = overlapReports(buffers, preview.width, preview.height);
  const normalization = normalizeLayerAlphaPixelBuffers(buffers, preview.width, preview.height);
  const overlapAfter = overlapReports(buffers, preview.width, preview.height);
  assert(normalization.reports.every((report) => report.visibleRatio >= 0.001), "normalization produced an empty layer");
  assert(normalization.reports.every((report) => report.removedRatio <= 0.9), "normalization exposed a duplicate layer");
  const normalizedLayers = layers.map((layer, index) => {
    layer.data = Buffer.from(buffers[index]);
    return layer;
  });
  const recomposed = alphaComposite(background, normalizedLayers);
  const fidelity = fidelityBands(preview, recomposed);
  const outputDir = join(folder, "semantic-normalized");
  if (writeOutputs) {
    mkdirSync(outputDir, { recursive: true });
    normalizedLayers.forEach((layer, index) => writeFileSync(join(outputDir, layerNames[index]), PNG.sync.write(layer)));
    writeFileSync(join(outputDir, "99-semantic-recomposed.png"), PNG.sync.write(recomposed));
    writeFileSync(join(outputDir, "report.json"), JSON.stringify({ layerNames, normalization, overlapBefore, overlapAfter, fidelity }, null, 2));
  }
  return {
    folder,
    outputDir: writeOutputs ? outputDir : "",
    layerNames: layerNames.map((name) => basename(name)),
    normalization,
    maximumOverlapBefore: Math.max(0, ...overlapBefore.map((pair) => pair.smallerLayerRatio)),
    maximumOverlapAfter: Math.max(0, ...overlapAfter.map((pair) => pair.smallerLayerRatio)),
    fidelity,
    existingFidelity: existingRecomposed ? fidelityBands(preview, existingRecomposed) : null
  };
}

const synthetic = syntheticContract();
const syntheticDirect = syntheticDirectLayerContract();
const generatedInputs = generatedLayerInputContract();
const fixtureArg = process.argv.find((value, index) => index > 1 && value !== "--write");
const fixture = fixtureArg ? realFixture(fixtureArg, process.argv.includes("--write")) : null;
console.log(JSON.stringify({ ok: true, synthetic, syntheticDirect, generatedInputs, fixture }, null, 2));
