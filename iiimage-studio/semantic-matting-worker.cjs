"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { PNG } = require("pngjs");
const { removeConnectedBorderBackgroundPixels } = require("./background-removal.cjs");

class WorkerMattingError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkerMattingError";
    this.code = code || "SEMANTIC_MATTING_FAILED";
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkerMattingError(code, message, details);
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function openCv() {
  const module = require("@techstark/opencv-js");
  if (module instanceof Promise) return module;
  if (module.Mat) return module;
  await new Promise((resolve) => { module.onRuntimeInitialized = resolve; });
  return module;
}

function decodePngDataUrl(source, label, width, height) {
  let decoded;
  try {
    const comma = source.indexOf(",");
    decoded = PNG.sync.read(Buffer.from(source.slice(comma + 1), "base64"));
  } catch (error) {
    fail("SEMANTIC_MATTING_PNG_DECODE", `无法解码${label}：${error instanceof Error ? error.message : String(error)}`);
  }
  if (decoded.width !== width || decoded.height !== height) {
    fail("SEMANTIC_MATTING_DIMENSION_MISMATCH", `${label}尺寸 ${decoded.width}x${decoded.height} 与画布 ${width}x${height} 不一致。`);
  }
  return decoded;
}

function encodePngDataUrl(png) {
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function renderBinaryLayer(preview, binary, width, height) {
  const output = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.from(preview.data);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    output.data[offset + 3] = binary[index] ? 255 : 0;
    if (!binary[index]) output.data.fill(0, offset, offset + 4);
  }
  return output;
}

function distanceFromMask(seed, width, height, maximumDistance, invert = false) {
  const pixelCount = width * height;
  const distance = new Int16Array(pixelCount);
  distance.fill(-1);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const selected = invert ? !seed[index] : Boolean(seed[index]);
    if (!selected) continue;
    distance[index] = 0;
    queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++];
    if (distance[index] >= maximumDistance) continue;
    const x = index % width;
    for (const next of [index - 1, index + 1, index - width, index + width]) {
      if (next < 0 || next >= pixelCount || distance[next] >= 0 || Math.abs(next % width - x) > 1) continue;
      distance[next] = distance[index] + 1;
      queue[tail++] = next;
    }
  }
  return distance;
}

function largestConnectedComponent(binary, width, height) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || !binary[start]) continue;
    let head = 0;
    let tail = 0;
    visited[start] = 1;
    queue[tail++] = start;
    const pixels = [];
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= pixelCount || visited[next] || !binary[next] || Math.abs(next % width - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    components.push(pixels);
  }
  components.sort((left, right) => right.length - left.length);
  return components;
}

function removeLargeLowEvidencePlates(binary, difference, localEdge, width, height, trustedDistance, removedSeed) {
  const pixelCount = width * height;
  const candidate = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (binary[index] > 0 && difference[index] < 18 && localEdge[index] < 10) candidate[index] = 1;
  }
  const minimumPlateSize = Math.max(256, Math.round(pixelCount * 0.002));
  const components = largestConnectedComponent(candidate, width, height);
  let removedPixels = 0;
  let removedRegions = 0;
  const regions = [];
  const candidateRegions = [];
  for (const pixels of components) {
    if (pixels.length < minimumPlateSize) break;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let differenceTotal = 0;
    let edgeTotal = 0;
    let trustedDistanceTotal = 0;
    let trustedDistanceSamples = 0;
    let minimumTrustedDistance = Number.POSITIVE_INFINITY;
    for (const index of pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      differenceTotal += difference[index];
      edgeTotal += localEdge[index];
      const distance = trustedDistance?.[index] ?? -1;
      if (distance >= 0) {
        minimumTrustedDistance = Math.min(minimumTrustedDistance, distance);
        trustedDistanceTotal += distance;
        trustedDistanceSamples += 1;
      }
    }
    const region = {
      size: pixels.length,
      minX,
      minY,
      maxX,
      maxY,
      meanDifference: differenceTotal / Math.max(1, pixels.length),
      meanEdge: edgeTotal / Math.max(1, pixels.length),
      minimumTrustedDistance: Number.isFinite(minimumTrustedDistance) ? minimumTrustedDistance : -1,
      meanTrustedDistance: trustedDistanceSamples ? trustedDistanceTotal / trustedDistanceSamples : -1
    };
    candidateRegions.push(region);
    // Independently inpainted backgrounds can be close to dark hair or fabric
    // without being pixel-identical. Only remove a plate when the whole region
    // is exceptionally close to the clean background; broader thresholds cut
    // real navy clothing in otherwise excellent subject masks.
    const exceptionallyCloseBackground = region.meanDifference <= 8 && region.meanTrustedDistance >= 48;
    const distantLowerPlate = region.minY >= height * 0.65 && region.meanTrustedDistance >= 60;
    if (!exceptionallyCloseBackground && !distantLowerPlate) continue;
    for (const index of pixels) {
      binary[index] = 0;
      if (removedSeed) removedSeed[index] = 1;
    }
    removedPixels += pixels.length;
    removedRegions += 1;
    regions.push(region);
  }
  return { removedPixels, removedRegions, minimumPlateSize, regions, candidateRegions };
}

function alignSemanticLayerMask(preview, background, layer, width, height, blockedLayers = []) {
  const startedAt = Date.now();
  const pixelCount = width * height;
  const directReconstruction = layer.directReconstruction === true;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let visiblePixels = 0;
  const alpha = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const value = layer.png.data[index * 4 + 3];
    alpha[index] = value;
    if (value < 96) continue;
    visiblePixels += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const identity = {
    applied: false,
    x: 0,
    y: 0,
    scale: 1,
    baseScore: 0,
    score: 0,
    improvement: 0,
    inputVisiblePixels: visiblePixels,
    outputVisiblePixels: visiblePixels,
    durationMs: Date.now() - startedAt,
    output: layer.png
  };
  const minimumAlignmentPixels = layer.role === "text"
    ? Math.max(96, pixelCount * 0.00025)
    : Math.max(96, pixelCount * 0.002);
  if (right < left || bottom < top || visiblePixels < minimumAlignmentPixels) return identity;

  const originX = (left + right) / 2;
  const originY = (top + bottom) / 2;
  const interiorCandidates = [];
  const boundaryCandidates = [];
  for (let index = 0; index < pixelCount; index += 1) {
    if (alpha[index] < 96) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    interiorCandidates.push({ x, y, weight: alpha[index] / 255 });
    const boundary = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
      alpha[index - 1] < 96 || alpha[index + 1] < 96 || alpha[index - width] < 96 || alpha[index + width] < 96;
    if (boundary) boundaryCandidates.push({ x, y });
  }
  const sample = (items, maximum) => {
    if (items.length <= maximum) return items;
    const step = items.length / maximum;
    const result = [];
    for (let cursor = 0; cursor < items.length && result.length < maximum; cursor += step) result.push(items[Math.floor(cursor)]);
    return result;
  };
  const interiorPoints = sample(interiorCandidates, 420);
  const boundaryPoints = sample(boundaryCandidates, 420);
  if (interiorPoints.length < 48 || boundaryPoints.length < 32) return identity;

  const evidence = new Float32Array(pixelCount);
  const luma = new Float32Array(pixelCount);
  const edge = new Float32Array(pixelCount);
  const blocked = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    evidence[index] = (
      Math.abs(preview.data[offset] - background.data[offset]) +
      Math.abs(preview.data[offset + 1] - background.data[offset + 1]) +
      Math.abs(preview.data[offset + 2] - background.data[offset + 2])
    ) / 3;
    luma[index] = preview.data[offset] * 0.2126 + preview.data[offset + 1] * 0.7152 + preview.data[offset + 2] * 0.0722;
    if (blockedLayers.some((candidate) => candidate.png.data[offset + 3] > 32)) blocked[index] = 1;
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      edge[index] = Math.abs(luma[index + 1] - luma[index - 1]) + Math.abs(luma[index + width] - luma[index - width]);
    }
  }
  let textStrokeContrast;
  if (layer.role === "text") {
    // Thin glyphs have high evidence on the stroke and substantially less
    // evidence in their immediate neighbourhood. Specular water, foliage and
    // product highlights can have the same representative colour as gold text,
    // but their surrounding region stays busy. Cache this local contrast once
    // so the transform search can distinguish actual glyph-shaped evidence
    // without doing a neighbourhood scan for every candidate.
    const radius = 5;
    const stride = width + 1;
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y += 1) {
      let rowTotal = 0;
      for (let x = 0; x < width; x += 1) {
        rowTotal += evidence[y * width + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowTotal;
      }
    }
    textStrokeContrast = new Float32Array(pixelCount);
    for (let y = 0; y < height; y += 1) {
      const topY = Math.max(0, y - radius);
      const bottomY = Math.min(height - 1, y + radius);
      for (let x = 0; x < width; x += 1) {
        const leftX = Math.max(0, x - radius);
        const rightX = Math.min(width - 1, x + radius);
        const area = (rightX - leftX + 1) * (bottomY - topY + 1);
        const localTotal =
          integral[(bottomY + 1) * stride + rightX + 1] -
          integral[topY * stride + rightX + 1] -
          integral[(bottomY + 1) * stride + leftX] +
          integral[topY * stride + leftX];
        const index = y * width + x;
        textStrokeContrast[index] = evidence[index] - localTotal / Math.max(1, area);
      }
    }
  }
  const totalInteriorWeight = interiorPoints.reduce((total, point) => total + point.weight, 0);
  const compactDecorationAlignment = !directReconstruction && layer.role === "decoration" && visiblePixels / pixelCount < 0.12;
  const scoreAt = (dx, dy, scale, includeDetails = false) => {
    let evidenceTotal = 0;
    let strongWeight = 0;
    let veryStrongWeight = 0;
    let blockedWeight = 0;
    let sourceOverlapWeight = 0;
    let directColorMatchWeight = 0;
    let directColorWeightTotal = 0;
    let textColorMatchWeight = 0;
    let textStrokeContrastTotal = 0;
    let interiorWeight = 0;
    for (const point of interiorPoints) {
      const x = Math.round(originX + (point.x - originX) * scale + dx);
      const y = Math.round(originY + (point.y - originY) * scale + dy);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const value = evidence[y * width + x];
      evidenceTotal += value * point.weight;
      if (value >= 24) strongWeight += point.weight;
      if (value >= 46) veryStrongWeight += point.weight;
      if (blocked[y * width + x]) blockedWeight += point.weight;
      if (alpha[y * width + x] >= 96) sourceOverlapWeight += point.weight;
      if (directReconstruction) {
        const targetOffset = (y * width + x) * 4;
        const sourceOffset = (point.y * width + point.x) * 4;
        const sourceMaximum = Math.max(layer.png.data[sourceOffset], layer.png.data[sourceOffset + 1], layer.png.data[sourceOffset + 2]);
        const sourceMinimum = Math.min(layer.png.data[sourceOffset], layer.png.data[sourceOffset + 1], layer.png.data[sourceOffset + 2]);
        const sourceLuma = layer.png.data[sourceOffset] * 0.2126 + layer.png.data[sourceOffset + 1] * 0.7152 + layer.png.data[sourceOffset + 2] * 0.0722;
        const signatureWeight = point.weight * (1 + (sourceMaximum - sourceMinimum) / 255 * 1.8 + (sourceLuma >= 176 ? 0.45 : 0));
        const colorDistance = Math.sqrt(
          (preview.data[targetOffset] - layer.png.data[sourceOffset]) ** 2 +
          (preview.data[targetOffset + 1] - layer.png.data[sourceOffset + 1]) ** 2 +
          (preview.data[targetOffset + 2] - layer.png.data[sourceOffset + 2]) ** 2
        );
        directColorMatchWeight += clamp(1 - colorDistance / 180, 0, 1) * signatureWeight;
        directColorWeightTotal += signatureWeight;
      }
      if (Array.isArray(layer.alignmentColor) && layer.alignmentColor.length === 3) {
        const offset = (y * width + x) * 4;
        const colorDistance = Math.sqrt(
          (preview.data[offset] - layer.alignmentColor[0]) ** 2 +
          (preview.data[offset + 1] - layer.alignmentColor[1]) ** 2 +
          (preview.data[offset + 2] - layer.alignmentColor[2]) ** 2
        );
        textColorMatchWeight += clamp(1 - colorDistance / 150, 0, 1) * point.weight;
      }
      if (textStrokeContrast) textStrokeContrastTotal += textStrokeContrast[y * width + x] * point.weight;
      interiorWeight += point.weight;
    }
    if (interiorWeight < totalInteriorWeight * 0.78) {
      return includeDetails ? { score: -Infinity, rejected: "interior-coverage" } : -Infinity;
    }
    let boundaryEdge = 0;
    let boundarySamples = 0;
    let strongBoundarySamples = 0;
    let veryStrongBoundarySamples = 0;
    for (const point of boundaryPoints) {
      const x = Math.round(originX + (point.x - originX) * scale + dx);
      const y = Math.round(originY + (point.y - originY) * scale + dy);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const boundaryValue = edge[y * width + x];
      boundaryEdge += boundaryValue;
      if (boundaryValue >= 40) strongBoundarySamples += 1;
      if (boundaryValue >= 80) veryStrongBoundarySamples += 1;
      boundarySamples += 1;
    }
    if (boundarySamples < boundaryPoints.length * 0.72) {
      return includeDetails ? { score: -Infinity, rejected: "boundary-coverage" } : -Infinity;
    }
    const meanEvidence = evidenceTotal / Math.max(1, interiorWeight);
    const strongRatio = strongWeight / Math.max(1, interiorWeight);
    const veryStrongRatio = veryStrongWeight / Math.max(1, interiorWeight);
    const blockedRatio = blockedWeight / Math.max(1, interiorWeight);
    const sourceOverlapRatio = sourceOverlapWeight / Math.max(1, interiorWeight);
    const meanBoundaryEdge = boundaryEdge / Math.max(1, boundarySamples);
    const strongBoundaryRatio = strongBoundarySamples / Math.max(1, boundarySamples);
    const veryStrongBoundaryRatio = veryStrongBoundarySamples / Math.max(1, boundarySamples);
    const transformPenalty = Math.hypot(dx / Math.max(1, width), dy / Math.max(1, height)) * 72 + Math.abs(Math.log(scale)) * (directReconstruction ? 24 : 11);
    const compactMaskEscapePenalty = compactDecorationAlignment
      ? Math.max(0, 0.72 - sourceOverlapRatio) * 260
      : 0;
    const compactBoundaryMatchBonus = compactDecorationAlignment
      ? strongBoundaryRatio * 80 + veryStrongBoundaryRatio * 90
      : 0;
    const textColorMatchBonus = Array.isArray(layer.alignmentColor)
      ? textColorMatchWeight / Math.max(1, interiorWeight) * 42
      : 0;
    const textStrokeBonus = textStrokeContrast
      ? clamp(textStrokeContrastTotal / Math.max(1, interiorWeight), -12, 40) * 4
      : 0;
    const directColorMatchBonus = directReconstruction
      ? directColorMatchWeight / Math.max(1, directColorWeightTotal) * (layer.role === "decoration" ? 360 : 105)
      : 0;
    const blockedPenaltyWeight = directReconstruction && layer.role === "decoration" ? 360 : 145;
    const directDecorationOcclusionPenalty = directReconstruction && layer.role === "decoration"
      ? Math.max(0, blockedRatio - 0.32) * 760
      : 0;
    const directDecorationBoundaryBonus = directReconstruction && layer.role === "decoration"
      ? strongBoundaryRatio * 100 + veryStrongBoundaryRatio * 80
      : 0;
    const evidenceWeight = directReconstruction && layer.role === "decoration" ? 0.25 : 0.8;
    const strongEvidenceWeight = directReconstruction && layer.role === "decoration" ? 18 : 62;
    const veryStrongEvidenceWeight = directReconstruction && layer.role === "decoration" ? 8 : 28;
    const boundaryEvidenceWeight = directReconstruction && layer.role === "decoration" ? 0.28 : 0.16;
    const score = meanEvidence * evidenceWeight + strongRatio * strongEvidenceWeight + veryStrongRatio * veryStrongEvidenceWeight + Math.min(180, meanBoundaryEdge) * boundaryEvidenceWeight + compactBoundaryMatchBonus + directDecorationBoundaryBonus + textColorMatchBonus + textStrokeBonus + directColorMatchBonus - blockedRatio * blockedPenaltyWeight - directDecorationOcclusionPenalty - transformPenalty - compactMaskEscapePenalty;
    return includeDetails
      ? {
          score,
          meanEvidence,
          strongRatio,
          veryStrongRatio,
          meanBoundaryEdge,
          strongBoundaryRatio,
          veryStrongBoundaryRatio,
          blockedRatio,
          sourceOverlapRatio,
          directColorMatchBonus,
          directDecorationBoundaryBonus,
          transformPenalty,
          directDecorationOcclusionPenalty
        }
      : score;
  };

  const baseScore = scoreAt(0, 0, 1);
  let best = { x: 0, y: 0, scale: 1, score: baseScore };
  const coarseStep = Math.max(8, Math.round(Math.max(width, height) / 64));
  const shiftRatioX = directReconstruction ? (layer.role === "subject" ? 0.24 : 0.3) : layer.role === "subject" ? 0.18 : layer.role === "text" ? 0.1 : 0.22;
  const shiftRatioY = directReconstruction ? (layer.role === "subject" ? 0.24 : 0.3) : layer.role === "subject" ? 0.18 : layer.role === "text" ? 0.06 : 0.22;
  const maxShiftX = clamp(Math.round(width * shiftRatioX), 40, 240);
  const maxShiftY = clamp(Math.round(height * shiftRatioY), 32, 240);
  const coarseMaxShiftX = Math.floor(maxShiftX / coarseStep) * coarseStep;
  const coarseMaxShiftY = Math.floor(maxShiftY / coarseStep) * coarseStep;
  const coarseCandidates = [];
  const negativeXScaleCandidates = [];
  const scaleCandidates = directReconstruction
    ? layer.role === "subject"
      ? [0.46, 0.54, 0.62, 0.7, 0.78, 0.86, 0.94, 1, 1.08]
      : [0.2, 0.26, 0.32, 0.38, 0.46, 0.56, 0.68, 0.82, 1, 1.08]
    : layer.role === "subject"
      ? [0.62, 0.68, 0.74, 0.8, 0.88, 0.96, 1, 1.06]
      : layer.role === "text"
        ? [0.9, 0.94, 0.98, 1, 1.04, 1.08, 1.12]
        : [0.56, 0.64, 0.72, 0.8, 0.88, 0.96, 1, 1.06];
  for (const scale of scaleCandidates) {
    let scaleBest = { x: 0, y: 0, scale, score: -Infinity };
    let negativeXBest = { x: 0, y: 0, scale, score: -Infinity };
    for (let dy = -coarseMaxShiftY; dy <= coarseMaxShiftY; dy += coarseStep) {
      for (let dx = -coarseMaxShiftX; dx <= coarseMaxShiftX; dx += coarseStep) {
        const score = scoreAt(dx, dy, scale);
        if (score > scaleBest.score) scaleBest = { x: dx, y: dy, scale, score };
        if (dx < 0 && score > negativeXBest.score) negativeXBest = { x: dx, y: dy, scale, score };
        if (score > best.score) best = { x: dx, y: dy, scale, score };
      }
    }
    coarseCandidates.push(scaleBest);
    negativeXScaleCandidates.push(negativeXBest);
  }
  const refineShift = coarseStep + 2;
  for (const coarse of coarseCandidates.sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score).slice(0, 4)) {
    const minimumScale = directReconstruction
      // The coarse subject search deliberately starts at 0.46.  Letting its
      // fine pass silently fall to 0.38 can collapse a complete person/product
      // onto one high-contrast face or torso patch, leaving the semantic matte
      // without enough support to recover the full approved composition.
      ? layer.role === "subject" ? 0.46 : 0.16
      : layer.role === "subject" ? 0.6 : layer.role === "text" ? 0.88 : 0.54;
    const maximumScale = directReconstruction ? 1.16 : layer.role === "text" ? 1.14 : 1.1;
    for (let scale = Math.max(minimumScale, coarse.scale - 0.06); scale <= Math.min(maximumScale, coarse.scale + 0.06) + 0.0001; scale += 0.02) {
      for (let dy = coarse.y - refineShift; dy <= coarse.y + refineShift; dy += 2) {
        for (let dx = coarse.x - refineShift; dx <= coarse.x + refineShift; dx += 2) {
          const score = scoreAt(dx, dy, scale);
          if (score > best.score) best = { x: dx, y: dy, scale, score };
        }
      }
    }
  }
  if (directReconstruction && layer.role === "subject") {
    // Isolated direct renders often produce several nearly equal matches. The
    // absolute maximum can collapse a complete product/person onto one small,
    // high-contrast patch. Within a narrow score tolerance prefer the larger
    // plausible reconstruction, then refine that candidate locally. This
    // subject-only rule must not be applied to compact products: their correct
    // preview footprint can legitimately be far smaller than the isolated
    // Image2 render, and preferring the largest nearby score relocates them to
    // unrelated hair, clothing or title regions.
    const tolerance = 7;
    const preferredAnchor = coarseCandidates
      .filter((candidate) => candidate.score >= best.score - tolerance)
      .sort((leftCandidate, rightCandidate) => rightCandidate.scale - leftCandidate.scale || rightCandidate.score - leftCandidate.score)[0];
    if (preferredAnchor) {
      let preferred = { ...preferredAnchor };
      // The preferred anchor exists specifically to prevent collapse onto a
      // small high-contrast patch.  Refining a full candidate by another
      // -0.06 silently undid that guarantee (0.58 could fall back to 0.52 or
      // 0.46).  Permit only a tiny quantisation adjustment downward and spend
      // the remaining search budget on equal/larger reconstructions.
      for (let scale = Math.max(0.46, preferredAnchor.scale - 0.02); scale <= Math.min(1.16, preferredAnchor.scale + 0.06) + 0.0001; scale += 0.02) {
        for (let dy = preferredAnchor.y - refineShift; dy <= preferredAnchor.y + refineShift; dy += 2) {
          for (let dx = preferredAnchor.x - refineShift; dx <= preferredAnchor.x + refineShift; dx += 2) {
            const score = scoreAt(dx, dy, scale);
            if (score > preferred.score) preferred = { x: dx, y: dy, scale, score };
          }
        }
      }
      if (preferred.score >= best.score - tolerance) best = preferred;
    }
  }
  if (layer.separatedTextBand === true) {
    // A distant footer/subtitle band can have a weaker coarse score than a
    // similarly coloured product highlight. Keeping only the single coarse
    // maximum per scale then prevents the real text location from ever
    // reaching the fine search. Perform one narrow, full-height refinement
    // around the source x anchor; the unrestricted search above remains
    // available for genuinely displaced bands.
    const anchoredShiftX = clamp(Math.round(width * 0.025), 12, 36);
    for (let scale = 0.88; scale <= 1.14 + 0.0001; scale += 0.02) {
      for (let dy = -maxShiftY; dy <= maxShiftY; dy += 2) {
        for (let dx = -anchoredShiftX; dx <= anchoredShiftX; dx += 2) {
          const score = scoreAt(dx, dy, scale);
          if (score > best.score) best = { x: dx, y: dy, scale, score };
        }
      }
    }
  }
  const improvement = best.score - baseScore;
  const bestScoreDetails = scoreAt(best.x, best.y, best.scale, true);
  const scaleCandidateDetails = coarseCandidates.map((candidate) => ({
    ...candidate,
    details: scoreAt(candidate.x, candidate.y, candidate.scale, true)
  }));
  const negativeXScaleCandidateDetails = negativeXScaleCandidates.map((candidate) => ({
    ...candidate,
    details: scoreAt(candidate.x, candidate.y, candidate.scale, true)
  }));
  let requiredImprovement = directReconstruction
    ? Math.max(8, Math.max(0, baseScore) * 0.1)
    : layer.role === "text"
      ? Math.max(8, Math.max(0, baseScore) * 0.12)
      : Math.max(12, Math.max(0, baseScore) * 0.18);
  // A correctly positioned semantic subject can still score a little higher
  // after being shrunk onto only its most contrasted face/torso region. That
  // is not alignment: it discards valid hair, clothing and occluded limbs.
  // Require decisive evidence before accepting a large subject rescale,
  // especially when the identity placement already has a plausible score.
  // Truly displaced Image2 masks have a much weaker identity score and a
  // substantially larger gain, so they continue to pass this guard.
  if (!directReconstruction && layer.role === "subject" && (best.scale < 0.84 || best.scale > 1.08)) {
    if (baseScore >= 50) {
      requiredImprovement = Number.POSITIVE_INFINITY;
    } else {
      requiredImprovement = Math.max(requiredImprovement, Math.max(24, Math.max(0, baseScore) * 0.4));
    }
  }
  if (
    !directReconstruction &&
    layer.role === "decoration" &&
    visiblePixels / pixelCount < 0.06 &&
    (best.scale < 0.84 || best.scale > 1.08)
  ) {
    // Compact products and props already describe a focused object. A
    // mask-only score can otherwise shrink them onto a larger, unrelated face,
    // sleeve or title with an arbitrarily high contrast gain. Broad masks may
    // still be rescaled because that is the failure shape emitted by Image2;
    // focused masks stay at identity and are refined without geometric drift.
    requiredImprovement = Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(best.score) || best.score < 48 || improvement < requiredImprovement) {
    return {
      ...identity,
      baseScore,
      score: baseScore,
      improvement: 0,
      candidateX: best.x,
      candidateY: best.y,
      candidateScale: best.scale,
      candidateScore: best.score,
      candidateImprovement: improvement,
      scaleCandidates: scaleCandidateDetails,
      negativeXScaleCandidates: negativeXScaleCandidateDetails,
      scoreDetails: bestScoreDetails,
      durationMs: Date.now() - startedAt
    };
  }

  const output = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.alloc(pixelCount * 4);
  let outputVisiblePixels = 0;
  for (let y = 0; y < height; y += 1) {
    const sourceY = originY + (y - originY - best.y) / best.scale;
    if (sourceY < 0 || sourceY > height - 1) continue;
    const topY = Math.floor(sourceY);
    const bottomY = Math.min(height - 1, topY + 1);
    const mixY = sourceY - topY;
    for (let x = 0; x < width; x += 1) {
      const sourceX = originX + (x - originX - best.x) / best.scale;
      if (sourceX < 0 || sourceX > width - 1) continue;
      const leftX = Math.floor(sourceX);
      const rightX = Math.min(width - 1, leftX + 1);
      const mixX = sourceX - leftX;
      const topAlpha = alpha[topY * width + leftX] * (1 - mixX) + alpha[topY * width + rightX] * mixX;
      const bottomAlpha = alpha[bottomY * width + leftX] * (1 - mixX) + alpha[bottomY * width + rightX] * mixX;
      const nextAlpha = Math.round(topAlpha * (1 - mixY) + bottomAlpha * mixY);
      if (nextAlpha <= 1) continue;
      const index = y * width + x;
      const offset = index * 4;
      // Direct Image2 assets are authoritative for semantic geometry, not for
      // final colour. They are independently redrawn and may contain baked
      // checker pixels, different lighting or a slightly different product.
      // Sampling their RGB made a visually valid stack unable to recompose its
      // own preview. Apply the aligned alpha to the authoritative composite
      // pixels instead: each exported layer remains independently transparent
      // while one-click regrouping reproduces what the user actually approved.
      output.data[offset] = preview.data[offset];
      output.data[offset + 1] = preview.data[offset + 1];
      output.data[offset + 2] = preview.data[offset + 2];
      output.data[offset + 3] = nextAlpha;
      outputVisiblePixels += 1;
    }
  }
  return {
    applied: true,
    x: best.x,
    y: best.y,
    scale: best.scale,
    baseScore,
    score: best.score,
    improvement,
    scaleCandidates: scaleCandidateDetails,
    negativeXScaleCandidates: negativeXScaleCandidateDetails,
    scoreDetails: bestScoreDetails,
    inputVisiblePixels: visiblePixels,
    outputVisiblePixels,
    durationMs: Date.now() - startedAt,
    output
  };
}

function runDirectAlignment() {
  const { width, height } = workerData;
  const preview = decodePngDataUrl(workerData.previewSource, "合成预览", width, height);
  const background = decodePngDataUrl(workerData.backgroundSource, "干净背景", width, height);
  const layers = workerData.layers.map((layer) => ({
    id: layer.id,
    role: layer.role,
    directReconstruction: true,
    png: decodePngDataUrl(layer.source, `图层 ${layer.id}`, width, height)
  }));
  const reports = [];
  const alignedLayers = [];
  for (const layer of layers) {
    // Direct assets are ordered from subject to foreground decoration.  Let a
    // later product see already placed layers so it cannot win by collapsing
    // onto the same high-contrast face/torso patch.  The overlap term remains
    // a soft score penalty, so legitimate product-in-front compositions are
    // still possible when their colour/evidence match is decisive.
    const aligned = alignSemanticLayerMask(preview, background, layer, width, height, alignedLayers);
    layer.png = aligned.output;
    alignedLayers.push(layer);
    const boundaryStrongRatio = Number(aligned.scoreDetails?.strongBoundaryRatio || 0);
    const boundaryVeryStrongRatio = Number(aligned.scoreDetails?.veryStrongBoundaryRatio || 0);
    const meanBoundaryEdge = Number(aligned.scoreDetails?.meanBoundaryEdge || 0);
    const decorationBoundaryReliable = layer.role !== "decoration" || (
      (boundaryStrongRatio >= 0.3 && (meanBoundaryEdge >= 28 || boundaryVeryStrongRatio >= 0.1)) ||
      (meanBoundaryEdge >= 40 && boundaryVeryStrongRatio >= 0.18)
    );
    const accepted = (aligned.applied === true || Number(aligned.score || 0) >= 48) && decorationBoundaryReliable;
    reports.push({
      id: layer.id,
      role: layer.role,
      accepted,
      reason: accepted
        ? (aligned.applied ? "direct-layer-aligned" : "direct-layer-alignment-not-needed")
        : decorationBoundaryReliable ? "direct-layer-alignment-unreliable" : "direct-layer-boundary-mismatch",
      alignmentApplied: aligned.applied,
      alignmentX: aligned.x,
      alignmentY: aligned.y,
      alignmentScale: aligned.scale,
      alignmentBaseScore: aligned.baseScore,
      alignmentScore: aligned.score,
      alignmentImprovement: aligned.improvement,
      alignmentCandidateX: aligned.candidateX,
      alignmentCandidateY: aligned.candidateY,
      alignmentCandidateScale: aligned.candidateScale,
      alignmentCandidateScore: aligned.candidateScore,
      alignmentCandidateImprovement: aligned.candidateImprovement,
      alignmentBoundaryStrongRatio: boundaryStrongRatio,
      alignmentBoundaryVeryStrongRatio: boundaryVeryStrongRatio,
      alignmentMeanBoundaryEdge: meanBoundaryEdge,
      ...(workerData.diagnostics === true
        ? {
            alignmentScaleCandidates: aligned.scaleCandidates,
            alignmentNegativeXScaleCandidates: aligned.negativeXScaleCandidates,
            alignmentScoreDetails: aligned.scoreDetails
          }
        : {}),
      inputVisiblePixels: aligned.inputVisiblePixels,
      outputVisiblePixels: aligned.outputVisiblePixels,
      durationMs: aligned.durationMs
    });
  }
  return {
    ok: reports.every((report) => report.accepted),
    width,
    height,
    engine: "direct-rgba-alignment",
    reports,
    layers: layers.map((layer) => ({ id: layer.id, role: layer.role, source: encodePngDataUrl(layer.png) }))
  };
}

function preserveLayerGeometry(layer, width, height) {
  let visiblePixels = 0;
  for (let index = 0; index < width * height; index += 1) {
    if (layer.png.data[index * 4 + 3] > 1) visiblePixels += 1;
  }
  return {
    applied: false,
    x: 0,
    y: 0,
    scale: 1,
    baseScore: 0,
    score: 0,
    improvement: 0,
    inputVisiblePixels: visiblePixels,
    outputVisiblePixels: visiblePixels,
    durationMs: 0,
    geometryPreserved: true,
    geometryIou: 1,
    visibleRetention: 1,
    output: layer.png
  };
}

function alignSeparatedTextLayer(preview, background, layer, width, height, blockedLayers = []) {
  const pixelCount = width * height;
  const rowPixels = new Uint32Array(height);
  let totalVisiblePixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (layer.png.data[index * 4 + 3] < 32) continue;
    rowPixels[Math.floor(index / width)] += 1;
    totalVisiblePixels += 1;
  }
  const maximumRowGap = clamp(Math.round(height * 0.018), 10, 24);
  const bands = [];
  let active = null;
  let lastActiveRow = -1;
  for (let y = 0; y < height; y += 1) {
    if (!rowPixels[y]) continue;
    if (!active || y - lastActiveRow > maximumRowGap) {
      active = { top: y, bottom: y, pixels: 0 };
      bands.push(active);
    }
    active.bottom = y;
    active.pixels += rowPixels[y];
    lastActiveRow = y;
  }
  const meaningfulBands = bands.filter((band) => band.pixels >= 64 && band.bottom - band.top >= 2);
  const separated = meaningfulBands.length > 1 && meaningfulBands.some((band, index) => (
    index > 0 && band.top - meaningfulBands[index - 1].bottom > Math.max(36, Math.round(height * 0.045))
  ));
  if (!separated) return alignSemanticLayerMask(preview, background, layer, width, height, blockedLayers);

  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let colorWeightTotal = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (layer.png.data[offset + 3] < 96) continue;
    const contrast = (
      Math.abs(layer.png.data[offset] - background.data[offset]) +
      Math.abs(layer.png.data[offset + 1] - background.data[offset + 1]) +
      Math.abs(layer.png.data[offset + 2] - background.data[offset + 2])
    ) / 3;
    if (contrast < 30) continue;
    const weight = (contrast - 24) ** 2;
    redTotal += layer.png.data[offset] * weight;
    greenTotal += layer.png.data[offset + 1] * weight;
    blueTotal += layer.png.data[offset + 2] * weight;
    colorWeightTotal += weight;
  }
  const alignmentColor = colorWeightTotal > 0
    ? [Math.round(redTotal / colorWeightTotal), Math.round(greenTotal / colorWeightTotal), Math.round(blueTotal / colorWeightTotal)]
    : undefined;

  const output = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.alloc(pixelCount * 4);
  const alignments = [];
  let outputVisiblePixels = 0;
  for (const band of meaningfulBands) {
    const bandPng = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
    bandPng.data = Buffer.alloc(pixelCount * 4);
    for (let y = band.top; y <= band.bottom; y += 1) {
      const start = y * width * 4;
      layer.png.data.copy(bandPng.data, start, start, start + width * 4);
    }
    const aligned = alignSemanticLayerMask(preview, background, {
      ...layer,
      png: bandPng,
      alignmentColor,
      separatedTextBand: true
    }, width, height, blockedLayers);
    alignments.push({
      top: band.top,
      bottom: band.bottom,
      inputPixels: band.pixels,
      applied: aligned.applied,
      x: aligned.x,
      y: aligned.y,
      scale: aligned.scale,
      baseScore: aligned.baseScore,
      score: aligned.score,
      improvement: aligned.improvement,
      candidateX: aligned.candidateX,
      candidateY: aligned.candidateY,
      candidateScale: aligned.candidateScale,
      candidateScore: aligned.candidateScore,
      candidateImprovement: aligned.candidateImprovement,
      durationMs: aligned.durationMs
    });
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const alpha = aligned.output.data[offset + 3];
      if (alpha <= output.data[offset + 3]) continue;
      output.data[offset] = aligned.output.data[offset];
      output.data[offset + 1] = aligned.output.data[offset + 1];
      output.data[offset + 2] = aligned.output.data[offset + 2];
      output.data[offset + 3] = alpha;
    }
  }
  for (let index = 0; index < pixelCount; index += 1) if (output.data[index * 4 + 3] > 1) outputVisiblePixels += 1;
  const applied = alignments.some((item) => item.applied);
  return {
    applied,
    x: 0,
    y: 0,
    scale: 1,
    baseScore: alignments.reduce((total, item) => total + Number(item.baseScore || 0), 0),
    score: alignments.reduce((total, item) => total + Number(item.score || 0), 0),
    improvement: alignments.reduce((total, item) => total + Number(item.improvement || 0), 0),
    inputVisiblePixels: totalVisiblePixels,
    outputVisiblePixels,
    durationMs: alignments.reduce((total, item) => total + Number(item.durationMs || 0), 0),
    bandAlignments: alignments,
    output
  };
}

function repairTextLayerContrast(background, layer, width, height) {
  const pixelCount = width * height;
  let weightTotal = 0;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let strongPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const alpha = layer.png.data[offset + 3];
    if (alpha < 96) continue;
    const contrast = (
      Math.abs(layer.png.data[offset] - background.data[offset]) +
      Math.abs(layer.png.data[offset + 1] - background.data[offset + 1]) +
      Math.abs(layer.png.data[offset + 2] - background.data[offset + 2])
    ) / 3;
    if (contrast < 34) continue;
    const weight = (contrast - 28) ** 2;
    redTotal += layer.png.data[offset] * weight;
    greenTotal += layer.png.data[offset + 1] * weight;
    blueTotal += layer.png.data[offset + 2] * weight;
    weightTotal += weight;
    strongPixels += 1;
  }
  if (strongPixels < 32 || weightTotal <= 0) {
    return { output: layer.png, repairedPixels: 0, strongPixels, representativeColor: null };
  }
  const representativeColor = [
    Math.round(redTotal / weightTotal),
    Math.round(greenTotal / weightTotal),
    Math.round(blueTotal / weightTotal)
  ];
  const output = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  output.data = Buffer.from(layer.png.data);
  let repairedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const alpha = output.data[offset + 3];
    if (alpha <= 16) continue;
    const contrast = (
      Math.abs(output.data[offset] - background.data[offset]) +
      Math.abs(output.data[offset + 1] - background.data[offset + 1]) +
      Math.abs(output.data[offset + 2] - background.data[offset + 2])
    ) / 3;
    if (contrast >= 24) continue;
    const blend = clamp((24 - contrast) / 18, 0.35, 1);
    output.data[offset] = Math.round(output.data[offset] * (1 - blend) + representativeColor[0] * blend);
    output.data[offset + 1] = Math.round(output.data[offset + 1] * (1 - blend) + representativeColor[1] * blend);
    output.data[offset + 2] = Math.round(output.data[offset + 2] * (1 - blend) + representativeColor[2] * blend);
    repairedPixels += 1;
  }
  return { output, repairedPixels, strongPixels, representativeColor };
}

function refineSubjectLayer(cv, preview, background, layer, allLayers, width, height, includeDiagnostics = false) {
  const startedAt = Date.now();
  const pixelCount = width * height;
  const directSubjectSeed = layer.directSubjectSeed === true;
  const rough = new Uint8Array(pixelCount);
  const hardBlocked = new Uint8Array(pixelCount);
  const foregroundBlocked = new Uint8Array(pixelCount);
  const textSeed = new Uint8Array(pixelCount);
  const textZone = new Uint8Array(pixelCount);
  const difference = new Float32Array(pixelCount);
  const localEdge = new Float32Array(pixelCount);
  const luma = new Float32Array(pixelCount);
  let inputVisiblePixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    luma[index] = preview.data[offset] * 0.2126 + preview.data[offset + 1] * 0.7152 + preview.data[offset + 2] * 0.0722;
    if (layer.png.data[offset + 3] >= 96) {
      rough[index] = 1;
      inputVisiblePixels += 1;
    }
    for (const candidate of allLayers) {
      if (candidate.id === layer.id) continue;
      const alpha = candidate.png.data[offset + 3];
      if (candidate.role === "foreground" && alpha > 64) foregroundBlocked[index] = 1;
      else if ((candidate.role === "text" || candidate.role === "decoration") && alpha > 32) {
        hardBlocked[index] = 1;
        if (candidate.role === "text") textSeed[index] = 1;
      }
    }
    difference[index] = (
      Math.abs(preview.data[offset] - background.data[offset]) +
      Math.abs(preview.data[offset + 1] - background.data[offset + 1]) +
      Math.abs(preview.data[offset + 2] - background.data[offset + 2])
    ) / 3;
  }
  const textPadding = clamp(Math.round(Math.min(width, height) * 0.012), 6, 20);
  const textDistance = distanceFromMask(textSeed, width, height, textPadding, false);
  for (let index = 0; index < pixelCount; index += 1) {
    if (textDistance[index] >= 0) textZone[index] = 1;
  }
  if (inputVisiblePixels < Math.max(64, pixelCount * 0.002)) {
    return { accepted: false, reason: "subject-mask-too-small", inputVisiblePixels, output: layer.png };
  }
  for (let index = 0; index < pixelCount; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const left = x > 0 ? index - 1 : index;
    const right = x + 1 < width ? index + 1 : index;
    const top = y > 0 ? index - width : index;
    const bottom = y + 1 < height ? index + width : index;
    localEdge[index] = Math.abs(luma[right] - luma[left]) + Math.abs(luma[bottom] - luma[top]);
  }
  const outsideRadius = directSubjectSeed
    ? clamp(Math.round(Math.min(width, height) * 0.18), 96, 220)
    : 28;
  const outsideDistance = distanceFromMask(rough, width, height, outsideRadius, false);
  const interiorDistance = distanceFromMask(rough, width, height, 10, true);
  const features = new Uint8Array(pixelCount * 3);
  const labels = new Uint8Array(pixelCount);
  let foregroundSeeds = 0;
  let textureSeeds = 0;
  let probableForeground = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const featureOffset = index * 3;
    const red = preview.data[offset];
    const green = preview.data[offset + 1];
    const blue = preview.data[offset + 2];
    // GrabCut's GMM needs the real local colour distribution. Encoding only
    // luminance/saturation/background-difference makes dark teal clothing and
    // the teal backdrop collapse into nearly the same feature cluster, which
    // preserves large background plates inside an otherwise valid subject.
    // Clean-background difference remains part of the trimap seed logic below.
    features[featureOffset] = red;
    features[featureOffset + 1] = green;
    features[featureOffset + 2] = blue;
    const semanticZoneBlocked = textZone[index] && difference[index] < 28;
    if (hardBlocked[index] || foregroundBlocked[index] || semanticZoneBlocked) {
      labels[index] = cv.GC_BGD;
    } else if (
      rough[index] &&
      difference[index] >= 42 &&
      (interiorDistance[index] < 0 || interiorDistance[index] >= 3)
    ) {
      labels[index] = cv.GC_FGD;
      foregroundSeeds += 1;
    } else if (
      rough[index] &&
      (interiorDistance[index] < 0 || interiorDistance[index] >= 6) &&
      difference[index] >= 8
    ) {
      if (difference[index] >= 18 && localEdge[index] >= 16) {
        labels[index] = cv.GC_FGD;
        foregroundSeeds += 1;
        textureSeeds += 1;
      } else {
        labels[index] = cv.GC_PR_FGD;
        probableForeground += 1;
      }
    } else if (rough[index] && difference[index] >= 8) {
      labels[index] = cv.GC_PR_FGD;
      probableForeground += 1;
    } else if (rough[index]) {
      labels[index] = cv.GC_PR_BGD;
    } else if (outsideDistance[index] >= 0 && difference[index] >= 12) {
      const distance = outsideDistance[index];
      const directExpansionCandidate = directSubjectSeed && (
        (distance <= outsideRadius * 0.62 && difference[index] >= 24) ||
        (distance <= outsideRadius * 0.82 && difference[index] >= 42 && localEdge[index] >= 10)
      );
      labels[index] = directExpansionCandidate ? cv.GC_PR_FGD : cv.GC_PR_BGD;
      if (directExpansionCandidate) probableForeground += 1;
    } else {
      labels[index] = cv.GC_BGD;
    }
  }
  if (foregroundSeeds < 64 || probableForeground < 64) {
    return { accepted: false, reason: "insufficient-grabcut-seeds", inputVisiblePixels, foregroundSeeds, probableForeground, output: layer.png };
  }

  const image = cv.matFromArray(height, width, cv.CV_8UC3, features);
  const mask = cv.matFromArray(height, width, cv.CV_8UC1, labels);
  const backgroundModel = new cv.Mat();
  const foregroundModel = new cv.Mat();
  const binary = new cv.Mat(height, width, cv.CV_8UC1);
  const opened = new cv.Mat();
  const feathered = new cv.Mat();
  const openingKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  try {
    cv.grabCut(image, mask, new cv.Rect(0, 0, 1, 1), backgroundModel, foregroundModel, 5, cv.GC_INIT_WITH_MASK);
    for (let index = 0; index < pixelCount; index += 1) {
      const value = mask.data[index];
      binary.data[index] = value === cv.GC_FGD || value === cv.GC_PR_FGD ? 255 : 0;
    }
    cv.morphologyEx(binary, opened, cv.MORPH_OPEN, openingKernel);
    const components = largestConnectedComponent(opened.data, width, height);
    const componentReports = components.slice(0, 12).map((pixels) => {
      let roughPixels = 0;
      let foregroundSeedPixels = 0;
      let evidencePixels = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (const index of pixels) {
        const x = index % width;
        const y = Math.floor(index / width);
        if (rough[index]) roughPixels += 1;
        if (labels[index] === cv.GC_FGD) foregroundSeedPixels += 1;
        if (difference[index] >= 18 || localEdge[index] >= 14) evidencePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return {
        pixels,
        size: pixels.length,
        roughRatio: roughPixels / Math.max(1, pixels.length),
        foregroundSeedPixels,
        evidenceRatio: evidencePixels / Math.max(1, pixels.length),
        minX,
        minY,
        maxX,
        maxY
      };
    });
    const largest = componentReports[0];
    const componentGap = (left, right) => {
      const horizontal = Math.max(0, left.minX - right.maxX - 1, right.minX - left.maxX - 1);
      const vertical = Math.max(0, left.minY - right.maxY - 1, right.minY - left.maxY - 1);
      return Math.hypot(horizontal, vertical);
    };
    const minimumAdditionalSize = Math.max(64, Math.round(inputVisiblePixels * 0.002));
    const maximumOcclusionGap = Math.max(16, Math.round(Math.min(width, height) * 0.04));
    const isDetachedBottomPlate = (component, primary) => {
      if (!component || !primary) return false;
      const componentWidth = component.maxX - component.minX + 1;
      const componentHeight = component.maxY - component.minY + 1;
      const fillRatio = component.size / Math.max(1, componentWidth * componentHeight);
      return component.minY >= height * 0.7 &&
        component.maxY >= height - 2 &&
        componentWidth >= width * 0.28 &&
        componentWidth / Math.max(1, componentHeight) >= 1.8 &&
        fillRatio >= 0.38;
    };
    let retainedComponents = componentReports.filter((component, index) => {
      if (index === 0) return true;
      if (!largest || component.size < minimumAdditionalSize || component.roughRatio < 0.72) return false;
      // Direct Image2 subject reconstructions occasionally append a wide
      // caption plinth or floor card along the lower canvas edge.  It can be
      // large and high-contrast enough to masquerade as a second subject
      // component, but it is spatially detached from the person and belongs
      // to foreground/text layers.  Reject that plate shape without applying
      // a generic "keep only largest" rule that would lose real occluded arms
      // or clothing fragments.
      if (isDetachedBottomPlate(component, largest)) return false;
      const strongSemanticEvidence = component.foregroundSeedPixels >= Math.max(32, Math.round(component.size * 0.04)) && component.evidenceRatio >= 0.18;
      if (!strongSemanticEvidence) return false;
      return component.size >= largest.size * 0.18 || componentGap(component, largest) <= maximumOcclusionGap;
    });
    let retainedPixelCount = retainedComponents.reduce((total, component) => total + component.size, 0);
    const minimumAccepted = Math.max(64, Math.round(inputVisiblePixels * 0.35));
    const maximumAccepted = directSubjectSeed
      ? Math.max(Math.round(inputVisiblePixels * 2.8), Math.round(pixelCount * 0.18))
      : Math.round(inputVisiblePixels * 1.15);
    if (retainedPixelCount < minimumAccepted || retainedPixelCount > maximumAccepted) {
      return {
        accepted: false,
        reason: "grabcut-area-out-of-range",
        inputVisiblePixels,
        outputVisiblePixels: retainedPixelCount,
        foregroundSeeds,
        textureSeeds,
        probableForeground,
        components: components.slice(0, 12).map((pixels) => pixels.length),
        retainedComponents: retainedComponents.map((component) => component.size),
        output: layer.png
      };
    }
    binary.data.fill(0);
    for (const component of retainedComponents) {
      for (const index of component.pixels) binary.data[index] = 255;
    }
    const trustedSeed = new Uint8Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
      const semanticZoneBlocked = hardBlocked[index] || foregroundBlocked[index] || (textZone[index] && difference[index] < 28);
      if (rough[index] && !semanticZoneBlocked && difference[index] >= 42) trustedSeed[index] = 1;
    }
    const trustedComponents = largestConnectedComponent(trustedSeed, width, height);
    const largestTrustedSize = trustedComponents[0]?.length || 0;
    const minimumTrustedComponent = Math.max(128, Math.round(largestTrustedSize * 0.06));
    const trustedComponentReports = trustedComponents.map((pixels) => {
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (const pixel of pixels) {
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return { pixels, size: pixels.length, minX, minY, maxX, maxY };
    });
    trustedSeed.fill(0);
    const retainedTrustedComponents = [];
    for (const [index, component] of trustedComponentReports.entries()) {
      if (index > 0 && component.size < minimumTrustedComponent) continue;
      if (index > 0) {
        const nearestGap = retainedTrustedComponents.reduce((minimum, retained) => Math.min(minimum, componentGap(component, retained)), Number.POSITIVE_INFINITY);
        const largeDetachedEvidence = component.size >= largestTrustedSize * 0.18;
        if (isDetachedBottomPlate(component, retainedTrustedComponents[0])) continue;
        if (nearestGap > maximumOcclusionGap && !largeDetachedEvidence) continue;
      }
      retainedTrustedComponents.push(component);
      for (const pixel of component.pixels) trustedSeed[pixel] = 1;
    }
    const trustedDistance = distanceFromMask(trustedSeed, width, height, 128, false);
    const backgroundPlateRemovedSeed = new Uint8Array(pixelCount);
    const backgroundPlateCleanup = removeLargeLowEvidencePlates(binary.data, difference, localEdge, width, height, trustedDistance, backgroundPlateRemovedSeed);
    if (backgroundPlateCleanup.removedPixels > retainedPixelCount * 0.12) {
      return {
        accepted: false,
        reason: "background-plate-cleanup-too-large",
        inputVisiblePixels,
        outputVisiblePixels: retainedPixelCount - backgroundPlateCleanup.removedPixels,
        foregroundSeeds,
        textureSeeds,
        probableForeground,
        backgroundPlateCleanup,
        components: components.slice(0, 12).map((pixels) => pixels.length),
        retainedComponents: retainedComponents.map((component) => component.size),
        output: layer.png
      };
    }
    if (backgroundPlateCleanup.removedPixels > 0) {
      const plateDistance = distanceFromMask(backgroundPlateRemovedSeed, width, height, 48, false);
      let haloRemovedPixels = 0;
      for (let index = 0; index < pixelCount; index += 1) {
        if (!binary.data[index]) continue;
        const distance = plateDistance[index];
        const supportDistance = trustedDistance[index];
        if (distance <= 0 || distance > 40 || (supportDistance >= 0 && supportDistance <= 36)) continue;
        const weakHalo = difference[index] < 28 || (distance <= 12 && difference[index] < 42);
        if (!weakHalo) continue;
        binary.data[index] = 0;
        haloRemovedPixels += 1;
      }
      backgroundPlateCleanup.haloRemovedPixels = haloRemovedPixels;
      const plateAdjustedComponents = largestConnectedComponent(binary.data, width, height);
      retainedPixelCount = plateAdjustedComponents.reduce((total, pixels) => total + pixels.length, 0);
      retainedComponents = plateAdjustedComponents.map((pixels) => ({ pixels, size: pixels.length }));
    }
    const preTrustedDiagnostic = includeDiagnostics
      ? encodePngDataUrl(renderBinaryLayer(preview, binary.data, width, height))
      : undefined;
    const preTrustedBinary = new Uint8Array(binary.data);
    // The generated subject mask can still be a broad silhouette whose holes
    // contain mountains, water or architecture. Those regions often remain in
    // the same GrabCut component as the person because an independently
    // inpainted clean background is not pixel-identical. Build a trusted core
    // from the largest strong-difference regions, remove weak pixels that are
    // far from that core, then keep only components with meaningful trusted
    // support. This preserves skin, hair and clothing while breaking the
    // low-evidence bridges that attach whole scene plates to the subject.
    const trustedSeedDiagnostic = includeDiagnostics
      ? encodePngDataUrl(renderBinaryLayer(preview, trustedSeed, width, height))
      : undefined;
    let trustedSupportRemovedPixels = 0;
    let trustedSupportRestoredPixels = 0;
    let trustedComponentCount = 0;
    const interiorBackgroundPlate = backgroundPlateCleanup.regions.some((region) => region.minY < height * 0.65 && region.meanDifference <= 8);
    const trustedCleanupApplied = largestTrustedSize > 0 && interiorBackgroundPlate && backgroundPlateCleanup.removedPixels >= Math.max(2048, retainedPixelCount * 0.03);
    if (trustedCleanupApplied) {
      for (let index = 0; index < pixelCount; index += 1) {
        if (!binary.data[index]) continue;
        const distance = trustedDistance[index];
        const unsupported = distance < 0 ||
          (distance > 12 && difference[index] < 28) ||
          (distance > 28 && difference[index] < 42);
        if (!unsupported) continue;
        binary.data[index] = 0;
        trustedSupportRemovedPixels += 1;
      }
      const supportedComponents = largestConnectedComponent(binary.data, width, height).map((pixels) => {
        let roughPixels = 0;
        let foregroundSeedPixels = 0;
        let evidencePixels = 0;
        let trustedPixels = 0;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (const index of pixels) {
          const x = index % width;
          const y = Math.floor(index / width);
          if (rough[index]) roughPixels += 1;
          if (labels[index] === cv.GC_FGD) foregroundSeedPixels += 1;
          if (difference[index] >= 18 || localEdge[index] >= 14) evidencePixels += 1;
          if (trustedSeed[index]) trustedPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        return {
          pixels,
          size: pixels.length,
          roughRatio: roughPixels / Math.max(1, pixels.length),
          foregroundSeedPixels,
          evidenceRatio: evidencePixels / Math.max(1, pixels.length),
          trustedPixels,
          trustedRatio: trustedPixels / Math.max(1, pixels.length),
          minX,
          minY,
          maxX,
          maxY
        };
      });
      const supportedLargest = supportedComponents[0];
      const supportRetained = supportedComponents.filter((component, index) => {
        if (index === 0) return true;
        if (!supportedLargest || component.size < minimumAdditionalSize || component.roughRatio < 0.72) return false;
        if (isDetachedBottomPlate(component, supportedLargest)) return false;
        const nearbyTrustedFragment = component.trustedRatio >= 0.18 && componentGap(component, supportedLargest) <= maximumOcclusionGap;
        const largeTrustedSubject = component.size >= supportedLargest.size * 0.18 && component.trustedRatio >= 0.08;
        return nearbyTrustedFragment || largeTrustedSubject;
      });
      const supportRetainedPixelCount = supportRetained.reduce((total, component) => total + component.size, 0);
      if (supportRetained.length) {
        retainedComponents = supportRetained;
        retainedPixelCount = supportRetainedPixelCount;
        trustedComponentCount = supportRetained.length;
        binary.data.fill(0);
        for (const component of retainedComponents) {
          for (const index of component.pixels) binary.data[index] = 255;
        }
      }
      const strictSupportedBinary = new Uint8Array(binary.data);
      // A hard distance cut reliably removes the broad mountain/water plates,
      // but can also punch holes through dark hair and low-contrast fabric.
      // Recover only pixels that survived GrabCut, are close to a trusted
      // subject seed, and remain chromatically continuous with that seed. The
      // bounded radius prevents this recovery from growing back into the large
      // scene plates that the trusted-support pass intentionally removed.
      const recoveryRadius = clamp(Math.round(Math.min(width, height) * 0.032), 20, 40);
      const recoveryDistance = new Int16Array(pixelCount);
      const recoveryOrigin = new Int32Array(pixelCount);
      const recoveryQueue = new Int32Array(pixelCount);
      recoveryDistance.fill(-1);
      recoveryOrigin.fill(-1);
      let recoveryHead = 0;
      let recoveryTail = 0;
      for (let index = 0; index < pixelCount; index += 1) {
        if (!trustedSeed[index]) continue;
        recoveryDistance[index] = 0;
        recoveryOrigin[index] = index;
        recoveryQueue[recoveryTail++] = index;
      }
      while (recoveryHead < recoveryTail) {
        const index = recoveryQueue[recoveryHead++];
        const currentDistance = recoveryDistance[index];
        if (currentDistance >= recoveryRadius) continue;
        const x = index % width;
        for (const next of [index - 1, index + 1, index - width, index + width]) {
          if (next < 0 || next >= pixelCount || recoveryDistance[next] >= 0 || Math.abs(next % width - x) > 1) continue;
          recoveryDistance[next] = currentDistance + 1;
          recoveryOrigin[next] = recoveryOrigin[index];
          recoveryQueue[recoveryTail++] = next;
        }
      }
      for (let index = 0; index < pixelCount; index += 1) {
        if (binary.data[index] || !preTrustedBinary[index]) continue;
        const distance = recoveryDistance[index];
        const origin = recoveryOrigin[index];
        if (distance < 0 || distance > recoveryRadius || origin < 0) continue;
        const offset = index * 4;
        const originOffset = origin * 4;
        const colorDistance = (
          Math.abs(preview.data[offset] - preview.data[originOffset]) +
          Math.abs(preview.data[offset + 1] - preview.data[originOffset + 1]) +
          Math.abs(preview.data[offset + 2] - preview.data[originOffset + 2])
        ) / 3;
        if (colorDistance >= 50) continue;
        const x = index % width;
        const y = Math.floor(index / width);
        const supportProbeRadius = Math.min(24, recoveryRadius);
        let leftSupport = false;
        let rightSupport = false;
        let topSupport = false;
        let bottomSupport = false;
        for (let step = 1; step <= supportProbeRadius; step += 1) {
          if (!leftSupport && x - step >= 0 && strictSupportedBinary[index - step]) leftSupport = true;
          if (!rightSupport && x + step < width && strictSupportedBinary[index + step]) rightSupport = true;
          if (!topSupport && y - step >= 0 && strictSupportedBinary[index - step * width]) topSupport = true;
          if (!bottomSupport && y + step < height && strictSupportedBinary[index + step * width]) bottomSupport = true;
        }
        const supportDirections = Number(leftSupport) + Number(rightSupport) + Number(topSupport) + Number(bottomSupport);
        const enclosedGap = (leftSupport && rightSupport) || (topSupport && bottomSupport) || supportDirections >= 3;
        const narrowEdgeContinuation = distance <= 12 && colorDistance < 36 && (difference[index] >= 12 || localEdge[index] >= 14);
        if (!enclosedGap && !narrowEdgeContinuation) continue;
        binary.data[index] = 255;
        trustedSupportRestoredPixels += 1;
      }
      if (trustedSupportRestoredPixels > 0) {
        const recoveredComponents = largestConnectedComponent(binary.data, width, height);
        const recoveredLargest = recoveredComponents[0] || [];
        binary.data.fill(0);
        for (const index of recoveredLargest) binary.data[index] = 255;
        retainedPixelCount = recoveredLargest.length;
        retainedComponents = recoveredLargest.length ? [{ pixels: recoveredLargest, size: recoveredLargest.length }] : [];
        trustedComponentCount = recoveredLargest.length ? 1 : 0;
      }
    }
    if (retainedPixelCount < minimumAccepted || retainedPixelCount > maximumAccepted) {
      return {
        accepted: false,
        reason: "trusted-subject-support-out-of-range",
        inputVisiblePixels,
        outputVisiblePixels: retainedPixelCount,
        foregroundSeeds,
        textureSeeds,
        probableForeground,
        backgroundPlateRemovedPixels: backgroundPlateCleanup.removedPixels,
        backgroundPlateRemovedRegions: backgroundPlateCleanup.removedRegions,
        backgroundPlateRegions: backgroundPlateCleanup.regions,
        backgroundPlateCandidates: backgroundPlateCleanup.candidateRegions,
        backgroundPlateHaloRemovedPixels: backgroundPlateCleanup.haloRemovedPixels || 0,
        trustedCleanupApplied,
        trustedSupportRemovedPixels,
        trustedSupportRestoredPixels,
        trustedComponentCount,
        diagnostics: includeDiagnostics ? {
          preTrustedSubject: preTrustedDiagnostic,
          trustedSubjectSeed: trustedSeedDiagnostic,
          postTrustedSubject: encodePngDataUrl(renderBinaryLayer(preview, binary.data, width, height))
        } : undefined,
        components: components.slice(0, 12).map((pixels) => pixels.length),
        retainedComponents: retainedComponents.map((component) => component.size),
        output: layer.png
      };
    }
    cv.GaussianBlur(binary, feathered, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    const output = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
    output.data = Buffer.from(preview.data);
    let outputVisiblePixels = 0;
    let blockerPixelsRemoved = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const blocked = hardBlocked[index] || foregroundBlocked[index] || (textZone[index] && difference[index] < 28);
      const alpha = blocked ? 0 : clamp(feathered.data[index], 0, 255);
      output.data[offset + 3] = alpha;
      if (alpha <= 1) output.data.fill(0, offset, offset + 4);
      else outputVisiblePixels += 1;
      if (blocked && layer.png.data[offset + 3] > 16) blockerPixelsRemoved += 1;
    }
    return {
      accepted: true,
      reason: "grabcut-semantic-matte",
      directSubjectSeed,
      inputVisiblePixels,
      outputVisiblePixels,
      foregroundSeeds,
      textureSeeds,
      probableForeground,
      blockerPixelsRemoved,
      backgroundPlateRemovedPixels: backgroundPlateCleanup.removedPixels,
      backgroundPlateRemovedRegions: backgroundPlateCleanup.removedRegions,
      backgroundPlateRegions: backgroundPlateCleanup.regions,
      backgroundPlateCandidates: backgroundPlateCleanup.candidateRegions,
      backgroundPlateHaloRemovedPixels: backgroundPlateCleanup.haloRemovedPixels || 0,
      trustedCleanupApplied,
      trustedSupportRemovedPixels,
      trustedSupportRestoredPixels,
      trustedComponentCount,
      diagnostics: includeDiagnostics ? {
        preTrustedSubject: preTrustedDiagnostic,
        trustedSubjectSeed: trustedSeedDiagnostic,
        postTrustedSubject: encodePngDataUrl(renderBinaryLayer(preview, binary.data, width, height))
      } : undefined,
      components: components.slice(0, 12).map((pixels) => pixels.length),
      retainedComponents: retainedComponents.map((component) => component.size),
      durationMs: Date.now() - startedAt,
      output
    };
  } finally {
    image.delete();
    mask.delete();
    backgroundModel.delete();
    foregroundModel.delete();
    binary.delete();
    opened.delete();
    feathered.delete();
    openingKernel.delete();
  }
}

async function run() {
  if (workerData.mode === "background-removal") {
    const { width, height } = workerData;
    const output = decodePngDataUrl(workerData.source, "待提取图片", width, height);
    const report = removeConnectedBorderBackgroundPixels(output.data, width, height);
    return {
      ok: true,
      width,
      height,
      engine: "checkerboard-chroma-isolation",
      source: encodePngDataUrl(output),
      ...report
    };
  }
  if (workerData.mode === "direct-alignment") return runDirectAlignment();
  const { width, height } = workerData;
  const preview = decodePngDataUrl(workerData.previewSource, "合成预览", width, height);
  const background = decodePngDataUrl(workerData.backgroundSource, "干净背景", width, height);
  const layers = workerData.layers.map((layer) => ({
    id: layer.id,
    role: layer.role,
    preserveGeometry: layer.preserveGeometry === true,
    directSubjectSeed: layer.directSubjectSeed === true,
    png: decodePngDataUrl(layer.source, `图层 ${layer.id}`, width, height)
  }));
  const cv = await openCv();
  const reports = [];
  const diagnostics = [];
  const alignmentById = new Map();
  const semanticLayers = [
    ...layers.filter((layer) => layer.role === "decoration"),
    ...layers.filter((layer) => layer.role === "text"),
    ...layers.filter((layer) => layer.role === "subject")
  ];
  for (const layer of semanticLayers) {
    const blockedLayers = layer.role === "subject"
      ? layers.filter((candidate) => candidate.id !== layer.id && (candidate.role === "decoration" || candidate.role === "foreground" || candidate.role === "text"))
      : layer.role === "text"
        ? layers.filter((candidate) => candidate.id !== layer.id && (candidate.role === "decoration" || candidate.role === "text"))
        : [];
    const aligned = layer.preserveGeometry
      ? preserveLayerGeometry(layer, width, height)
      : layer.role === "text"
        ? alignSeparatedTextLayer(preview, background, layer, width, height, blockedLayers)
        : alignSemanticLayerMask(preview, background, layer, width, height, blockedLayers);
    layer.png = aligned.output;
    const textContrast = layer.role === "text"
      ? repairTextLayerContrast(background, layer, width, height)
      : null;
    if (textContrast) layer.png = textContrast.output;
    alignmentById.set(layer.id, aligned);
    if (layer.role !== "subject") {
      reports.push({
        id: layer.id,
        role: layer.role,
        accepted: true,
        reason: aligned.geometryPreserved ? "semantic-mask-geometry-preserved" : aligned.applied ? "semantic-mask-aligned" : "semantic-mask-alignment-not-needed",
        alignmentApplied: aligned.applied,
        alignmentX: aligned.x,
        alignmentY: aligned.y,
        alignmentScale: aligned.scale,
        alignmentBaseScore: aligned.baseScore,
        alignmentScore: aligned.score,
      alignmentImprovement: aligned.improvement,
      alignmentCandidateX: aligned.candidateX,
      alignmentCandidateY: aligned.candidateY,
      alignmentCandidateScale: aligned.candidateScale,
      alignmentCandidateScore: aligned.candidateScore,
        alignmentCandidateImprovement: aligned.candidateImprovement,
        bandAlignments: aligned.bandAlignments,
        geometryPreserved: aligned.geometryPreserved === true,
        geometryIou: aligned.geometryIou,
        visibleRetention: aligned.visibleRetention,
        contrastRepairedPixels: textContrast?.repairedPixels || 0,
        contrastStrongPixels: textContrast?.strongPixels || 0,
        representativeColor: textContrast?.representativeColor || undefined,
        inputVisiblePixels: aligned.inputVisiblePixels,
        outputVisiblePixels: aligned.outputVisiblePixels,
        durationMs: aligned.durationMs
      });
    }
  }
  for (const layer of layers) {
    if (layer.role !== "subject") continue;
    const refined = refineSubjectLayer(cv, preview, background, layer, layers, width, height, workerData.diagnostics === true);
    layer.png = refined.output;
    if (refined.diagnostics) diagnostics.push({ id: layer.id, role: layer.role, ...refined.diagnostics });
    const aligned = alignmentById.get(layer.id);
    reports.push({
      id: layer.id,
      role: layer.role,
      alignmentApplied: aligned?.applied === true,
      alignmentX: aligned?.x || 0,
      alignmentY: aligned?.y || 0,
      alignmentScale: aligned?.scale || 1,
      alignmentBaseScore: aligned?.baseScore || 0,
      alignmentScore: aligned?.score || 0,
      alignmentImprovement: aligned?.improvement || 0,
      alignmentCandidateX: aligned?.candidateX,
      alignmentCandidateY: aligned?.candidateY,
      alignmentCandidateScale: aligned?.candidateScale,
      alignmentCandidateScore: aligned?.candidateScore,
      alignmentCandidateImprovement: aligned?.candidateImprovement,
      alignmentInputVisiblePixels: aligned?.inputVisiblePixels || 0,
      alignmentOutputVisiblePixels: aligned?.outputVisiblePixels || 0,
      alignmentDurationMs: aligned?.durationMs || 0,
      ...Object.fromEntries(Object.entries(refined).filter(([key]) => key !== "output" && key !== "diagnostics"))
    });
  }
  return {
    ok: true,
    width,
    height,
    engine: "opencv-grabcut",
    reports,
    diagnostics: workerData.diagnostics === true ? diagnostics : undefined,
    layers: layers.map((layer) => ({ id: layer.id, role: layer.role, source: encodePngDataUrl(layer.png) }))
  };
}

run()
  .then((result) => parentPort.postMessage({ type: "result", result }))
  .catch((error) => parentPort.postMessage({
    type: "error",
    error: {
      code: error?.code || "SEMANTIC_MATTING_FAILED",
      message: error instanceof Error ? error.message : String(error),
      details: error?.details,
      stack: error?.stack
    }
  }));
