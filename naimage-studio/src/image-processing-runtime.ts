import { imageAssetCanvasSrc } from "./core.ts";
import type { BackgroundRemovalReport, ImageAsset, ImageLayerComposition } from "./core.ts";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function composeImageLayersToDataUrl(composition: ImageLayerComposition) {
  const width = clamp(Number(composition.width || 0), 64, 8192);
  const height = clamp(Number(composition.height || 0), 64, 8192);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器环境不支持图层合成。");

  const background = String(composition.background || "transparent").trim();
  if (background && background !== "transparent") {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }

  let drawn = 0;
  const visibleLayers = composition.layers.filter((layer) => layer.visible !== false);
  for (const layer of visibleLayers) {
    const asset = layer.asset;
    if (!asset) continue;
    const source = await imageAssetCanvasSrc(asset);
    if (!source) continue;
    const image = await loadImageForCanvas(source);
    const scale = Number(layer.scale ?? 1);
    const targetWidth = clamp(Number(layer.width || image.naturalWidth || image.width) * (Number.isFinite(scale) ? scale : 1), 1, width * 4);
    const targetHeight = clamp(Number(layer.height || image.naturalHeight || image.height) * (Number.isFinite(scale) ? scale : 1), 1, height * 4);
    const x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 0;
    const y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 0;
    const opacity = clamp(Number(layer.opacity ?? 1), 0, 1);
    const blendMode = !layer.blendMode || layer.blendMode === "normal" ? "source-over" : layer.blendMode;

    context.save();
    context.globalAlpha = opacity;
    context.globalCompositeOperation = blendMode as GlobalCompositeOperation;
    context.drawImage(image, x, y, targetWidth, targetHeight);
    context.restore();
    drawn += 1;
  }

  if (!drawn && visibleLayers.length) throw new Error("图层合成失败：没有可读取的图层图片。");

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    layerCount: visibleLayers.length,
    drawn
  };
}

export async function compareImageSourcesVisualFidelity(leftSource: string, rightSource: string) {
  const [leftImage, rightImage] = await Promise.all([
    loadImageForCanvas(leftSource),
    loadImageForCanvas(rightSource)
  ]);
  const edge = 96;
  const read = (image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器环境不支持分层一致性校验。");
    context.fillStyle = "#000";
    context.fillRect(0, 0, edge, edge);
    context.drawImage(image, 0, 0, edge, edge);
    return context.getImageData(0, 0, edge, edge).data;
  };
  const left = read(leftImage);
  const right = read(rightImage);
  const leftLuma = new Float64Array(edge * edge);
  const rightLuma = new Float64Array(edge * edge);
  let leftMean = 0;
  let rightMean = 0;
  let meanRgbDelta = 0;
  for (let offset = 0, index = 0; offset < left.length; offset += 4, index += 1) {
    const leftValue = left[offset] * 0.2126 + left[offset + 1] * 0.7152 + left[offset + 2] * 0.0722;
    const rightValue = right[offset] * 0.2126 + right[offset + 1] * 0.7152 + right[offset + 2] * 0.0722;
    leftLuma[index] = leftValue;
    rightLuma[index] = rightValue;
    leftMean += leftValue;
    rightMean += rightValue;
    meanRgbDelta += (
      Math.abs(left[offset] - right[offset]) +
      Math.abs(left[offset + 1] - right[offset + 1]) +
      Math.abs(left[offset + 2] - right[offset + 2])
    ) / 3;
  }
  leftMean /= leftLuma.length;
  rightMean /= rightLuma.length;
  meanRgbDelta /= leftLuma.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < leftLuma.length; index += 1) {
    const leftDelta = leftLuma[index] - leftMean;
    const rightDelta = rightLuma[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const luminanceCorrelation = covariance / Math.max(1, Math.sqrt(leftVariance * rightVariance));
  return {
    ok: luminanceCorrelation >= 0.72 && meanRgbDelta <= 40,
    luminanceCorrelation,
    meanRgbDelta,
    sampleCount: leftLuma.length
  };
}

export function loadImageForCanvas(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片载入失败，无法进行本地处理。"));
    image.src = src;
  });
}

export function colorDistance(data: Uint8ClampedArray, offset: number, color: readonly [number, number, number]) {
  const dr = data[offset] - color[0];
  const dg = data[offset + 1] - color[1];
  const db = data[offset + 2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function estimateBorderColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const step = Math.max(1, Math.floor((width + height) / 420));
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  function sample(x: number, y: number) {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 8) return;
    reds.push(data[offset]);
    greens.push(data[offset + 1]);
    blues.push(data[offset + 2]);
  }

  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }

  if (!reds.length) return [255, 255, 255];
  reds.sort((left, right) => left - right);
  greens.sort((left, right) => left - right);
  blues.sort((left, right) => left - right);
  const middle = Math.floor(reds.length / 2);
  return [reds[middle], greens[middle], blues[middle]];
}

function chromaMagentaStrength(red: number, green: number, blue: number) {
  const magentaFloor = Math.min(red, blue);
  if (magentaFloor < 88) return 0;
  const dominance = magentaFloor - green;
  if (dominance < 22 || green > magentaFloor * 0.86) return 0;
  const brightnessScore = clamp((magentaFloor - 88) / 112, 0, 1);
  const dominanceScore = clamp((dominance - 22) / 92, 0, 1);
  const greenSuppressionScore = clamp((magentaFloor * 0.86 - green) / 76, 0, 1);
  const balanceScore = clamp((190 - Math.abs(red - blue)) / 145, 0.2, 1);
  return Math.min(brightnessScore, dominanceScore, greenSuppressionScore) * balanceScore;
}

export function removeConnectedBorderBackgroundPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundColor = estimateBorderColor(data, width, height)
): BackgroundRemovalReport {
  const pixelCount = width * height;
  let existingTransparentPixels = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < 245) existingTransparentPixels += 1;
  }
  const existingTransparentRatio = existingTransparentPixels / Math.max(1, pixelCount);
  const chromaLike = backgroundColor[0] >= 175 && backgroundColor[2] >= 145 && backgroundColor[1] <= 125 &&
    chromaMagentaStrength(backgroundColor[0], backgroundColor[1], backgroundColor[2]) >= 0.24;
  if (existingTransparentRatio >= 0.025 && !chromaLike) {
    let visiblePixels = 0;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] > 16) visiblePixels += 1;
    }
    return {
      backgroundColor,
      transparentRatio: existingTransparentRatio,
      visibleRatio: visiblePixels / Math.max(1, pixelCount),
      remainingChromaRatio: 0,
      removedPixels: 0,
      usedExistingAlpha: true,
      checkerboardDetected: false,
      checkerboardSuspiciousRemovedPixels: 0,
      checkerboardProtectedPixels: 0
    };
  }

  const floodThreshold = chromaLike ? 154 : 104;
  const hardThreshold = chromaLike ? 70 : 54;
  const featherThreshold = chromaLike ? 154 : 104;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const enqueue = (index: number) => {
    if (index < 0 || index >= pixelCount || visited[index]) return;
    const offset = index * 4;
    const strength = chromaLike ? chromaMagentaStrength(data[offset], data[offset + 1], data[offset + 2]) : 0;
    if (data[offset + 3] < 8 || colorDistance(data, offset, backgroundColor) <= floodThreshold || strength >= 0.12) {
      visited[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  let removedPixels = 0;
  let transparentPixels = 0;
  let visiblePixels = 0;
  let remainingChromaPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const originalAlpha = data[offset + 3];
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const distance = colorDistance(data, offset, backgroundColor);
    const magentaStrength = chromaLike ? chromaMagentaStrength(red, green, blue) : 0;
    let alphaFactor = 1;
    if (visited[index]) {
      alphaFactor = chromaLike
        ? clamp(1 - Math.max(magentaStrength / 0.62, (154 - distance) / 154), 0, 1)
        : clamp((distance - hardThreshold) / Math.max(1, featherThreshold - hardThreshold), 0, 1);
    } else if (chromaLike && magentaStrength >= 0.26) {
      alphaFactor = clamp(1 - magentaStrength / 0.72, 0, 1);
    }
    if (chromaLike && magentaStrength >= 0.72) alphaFactor = 0;
    const nextAlpha = Math.min(originalAlpha, Math.round(originalAlpha * alphaFactor));
    if (nextAlpha < originalAlpha) removedPixels += 1;
    data[offset + 3] = nextAlpha;
    if (nextAlpha <= 1) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
    } else if (chromaLike && (magentaStrength > 0.04 || nextAlpha < 245)) {
      const alpha = nextAlpha / 255;
      const spill = Math.max(0, Math.min(red, blue) - green);
      const cleanup = clamp(magentaStrength * 1.25 + (1 - alpha) * 0.9, 0, 1);
      data[offset] = Math.round(clamp(red - Math.min(spill, Math.max(0, red - green)) * cleanup, 0, 255));
      data[offset + 2] = Math.round(clamp(blue - Math.min(spill, Math.max(0, blue - green)) * cleanup, 0, 255));
    }
    if (nextAlpha < 245) transparentPixels += 1;
    if (nextAlpha > 16) visiblePixels += 1;
    if (nextAlpha > 32 && chromaMagentaStrength(data[offset], data[offset + 1], data[offset + 2]) >= 0.52) {
      remainingChromaPixels += 1;
    }
  }
  return {
    backgroundColor,
    transparentRatio: transparentPixels / Math.max(1, pixelCount),
    visibleRatio: visiblePixels / Math.max(1, pixelCount),
    remainingChromaRatio: remainingChromaPixels / Math.max(1, visiblePixels),
    removedPixels,
    usedExistingAlpha: false,
    checkerboardDetected: false,
    checkerboardSuspiciousRemovedPixels: 0,
    checkerboardProtectedPixels: 0
  };
}


export async function removeConnectedBorderBackgroundToDataUrl(
  asset: ImageAsset,
  options?: { width?: number; height?: number }
) {
  const source = await imageAssetCanvasSrc(asset);
  if (!source) throw new Error("图层图片缺少可读取来源。");
  const image = await loadImageForCanvas(source);
  const width = clamp(Math.round(Number(options?.width || image.naturalWidth || image.width || 0)), 1, 8192);
  const height = clamp(Math.round(Number(options?.height || image.naturalHeight || image.height || 0)), 1, 8192);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器环境不支持透明图层处理。");
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const result = (dataUrl: string, report: Pick<BackgroundRemovalReport,
    "transparentRatio" | "visibleRatio" | "remainingChromaRatio" | "removedPixels" | "usedExistingAlpha" |
    "checkerboardDetected" | "checkerboardSuspiciousRemovedPixels"
  >) => ({ dataUrl, width, height, ...report });
  const isolateImageBackground = window.naimageConfig?.isolateImageBackground;
  if (isolateImageBackground) {
    const isolated = await isolateImageBackground({ source: canvas.toDataURL("image/png"), width, height });
    if (!isolated.ok) throw new Error(isolated.error || "透明背景提取失败。");
    return result(isolated.source, isolated);
  }
  const report = removeConnectedBorderBackgroundPixels(data, width, height);
  context.putImageData(imageData, 0, 0);
  return result(canvas.toDataURL("image/png"), report);
}

export function findLuminanceMaskAlignmentOffset(
  previewData: Uint8ClampedArray,
  maskValues: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  options?: { maxShift?: number; minimumImprovement?: number }
) {
  const pixelCount = width * height;
  if (previewData.length !== pixelCount * 4 || maskValues.length !== pixelCount) {
    throw new Error("蒙版对齐输入尺寸不一致。");
  }
  const stride = Math.max(1, Math.round(Math.max(width, height) / 512));
  const points: Array<{ x: number; y: number; weight: number }> = [];
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const value = maskValues[y * width + x];
      if (value >= threshold) points.push({ x, y, weight: value / 255 });
    }
  }
  if (points.length < 24) return { x: 0, y: 0, baseScore: 0, score: 0, improvement: 0, pointCount: points.length };
  const lumaAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return previewData[offset] * 0.2126 + previewData[offset + 1] * 0.7152 + previewData[offset + 2] * 0.0722;
  };
  const scoreAt = (dx: number, dy: number) => {
    let score = 0;
    let weight = 0;
    for (const point of points) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const luma = lumaAt(x, y);
      const edge = Math.abs(lumaAt(x + 1, y) - lumaAt(x - 1, y)) + Math.abs(lumaAt(x, y + 1) - lumaAt(x, y - 1));
      score += point.weight * (luma + edge * 0.18);
      weight += point.weight;
    }
    return score / Math.max(1, weight) - Math.hypot(dx, dy) * 0.03;
  };
  const maxShift = clamp(Math.round(Number(options?.maxShift ?? Math.min(width, height) * 0.04)), 8, 40);
  const baseScore = scoreAt(0, 0);
  let best = { x: 0, y: 0, score: baseScore };
  for (let dy = -maxShift; dy <= maxShift; dy += 2) {
    for (let dx = -maxShift; dx <= maxShift; dx += 2) {
      const score = scoreAt(dx, dy);
      if (score > best.score) best = { x: dx, y: dy, score };
    }
  }
  const coarse = { ...best };
  for (let dy = coarse.y - 2; dy <= coarse.y + 2; dy += 1) {
    for (let dx = coarse.x - 2; dx <= coarse.x + 2; dx += 1) {
      if (Math.abs(dx) > maxShift || Math.abs(dy) > maxShift) continue;
      const score = scoreAt(dx, dy);
      if (score > best.score) best = { x: dx, y: dy, score };
    }
  }
  const improvement = best.score - baseScore;
  if (improvement < Number(options?.minimumImprovement ?? 6)) best = { x: 0, y: 0, score: baseScore };
  return { ...best, baseScore, improvement: best.score - baseScore, pointCount: points.length };
}

export function findTextMaskAlignmentTransform(
  previewData: Uint8ClampedArray,
  maskValues: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  options?: { minimumImprovement?: number; minimumScore?: number }
) {
  const pixelCount = width * height;
  if (previewData.length !== pixelCount * 4 || maskValues.length !== pixelCount) {
    throw new Error("文字蒙版对齐输入尺寸不一致。");
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let hardPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (maskValues[index] < threshold) continue;
    hardPixels += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const identity = {
    x: 0,
    y: 0,
    scale: 1,
    originX: width / 2,
    originY: height / 2,
    baseScore: 0,
    score: 0,
    improvement: 0,
    pointCount: hardPixels,
    maskFillRatio: 0
  };
  if (right < left || bottom < top || hardPixels < 96) return identity;

  const originX = (left + right) / 2;
  const originY = (top + bottom) / 2;
  const maskFillRatio = hardPixels / Math.max(1, (right - left + 1) * (bottom - top + 1));
  const foregroundPoints: Array<{ x: number; y: number; weight: number }> = [];
  const foregroundStep = Math.max(1, Math.ceil(hardPixels / 360));
  let foregroundSeen = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (maskValues[index] < threshold) continue;
    if (foregroundSeen % foregroundStep === 0) {
      foregroundPoints.push({
        x: index % width,
        y: Math.floor(index / width),
        weight: maskValues[index] / 255
      });
    }
    foregroundSeen += 1;
  }
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const backgroundPoints: Array<{ x: number; y: number }> = [];
  const backgroundStride = Math.max(2, Math.ceil(Math.sqrt((boxWidth * boxHeight) / 220)));
  for (let y = top; y <= bottom; y += backgroundStride) {
    for (let x = left; x <= right; x += backgroundStride) {
      if (maskValues[y * width + x] < threshold * 0.45) backgroundPoints.push({ x, y });
    }
  }
  if (foregroundPoints.length < 24 || backgroundPoints.length < 24) return { ...identity, originX, originY, maskFillRatio };

  const luma = new Float32Array(pixelCount);
  const edge = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    luma[index] = previewData[offset] * 0.2126 + previewData[offset + 1] * 0.7152 + previewData[offset + 2] * 0.0722;
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      edge[index] = Math.abs(luma[index + 1] - luma[index - 1]) + Math.abs(luma[index + width] - luma[index - width]);
    }
  }
  const totalForegroundWeight = foregroundPoints.reduce((total, point) => total + point.weight, 0);
  const scoreAt = (dx: number, dy: number, scale: number) => {
    let foregroundLuma = 0;
    let foregroundEdge = 0;
    let foregroundWeight = 0;
    for (const point of foregroundPoints) {
      const x = Math.round(originX + (point.x - originX) * scale + dx);
      const y = Math.round(originY + (point.y - originY) * scale + dy);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const index = y * width + x;
      foregroundLuma += luma[index] * point.weight;
      foregroundEdge += edge[index] * point.weight;
      foregroundWeight += point.weight;
    }
    let backgroundLuma = 0;
    let backgroundEdge = 0;
    let backgroundSamples = 0;
    for (const point of backgroundPoints) {
      const x = Math.round(originX + (point.x - originX) * scale + dx);
      const y = Math.round(originY + (point.y - originY) * scale + dy);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const index = y * width + x;
      backgroundLuma += luma[index];
      backgroundEdge += edge[index];
      backgroundSamples += 1;
    }
    if (foregroundWeight < totalForegroundWeight * 0.72 || backgroundSamples < backgroundPoints.length * 0.72) return -Infinity;
    const meanForegroundLuma = foregroundLuma / Math.max(1, foregroundWeight);
    const meanBackgroundLuma = backgroundLuma / Math.max(1, backgroundSamples);
    const meanForegroundEdge = foregroundEdge / Math.max(1, foregroundWeight);
    const meanBackgroundEdge = backgroundEdge / Math.max(1, backgroundSamples);
    const contrast = Math.abs(meanForegroundLuma - meanBackgroundLuma);
    const edgeAdvantage = meanForegroundEdge - meanBackgroundEdge * 0.35;
    // Prefer the nearest plausible occurrence when several gold/white text
    // regions exist in the same poster. A weak transform penalty lets a body
    // copy mask collapse onto a larger, brighter headline hundreds of pixels
    // away. Real displaced text still produces a decisive stroke/contrast
    // gain, while unrelated typography must now overcome its geometric cost.
    const transformPenalty = Math.hypot(dx / Math.max(1, width), dy / Math.max(1, height)) * 72 + Math.abs(Math.log(scale)) * 11;
    return contrast * 1.35 + Math.max(-12, edgeAdvantage) * 0.38 + meanForegroundEdge * 0.08 - transformPenalty;
  };

  const baseScore = scoreAt(0, 0, 1);
  let best = { x: 0, y: 0, scale: 1, score: baseScore };
  // Separately rendered text plates can preserve the glyphs but move them to
  // a very different design zone (for example, centred in the mask while the
  // final title sits near the lower third). Search the full plausible layout
  // range coarsely, then refine locally; a narrow translation window silently
  // locks onto hands, jewellery or garment embroidery near the source mask.
  // Text matching has narrow sub-glyph peaks: a 16px lattice can miss the
  // correct two-line copy entirely and only refine a nearby headline peak.
  // An 8px lattice at 1024px keeps the real peak in the refinement set while
  // remaining bounded for larger delivery frames.
  const coarseStep = Math.max(6, Math.round(Math.max(width, height) / 128));
  const maxShiftX = clamp(Math.round(width * 0.24), 48, 288);
  const maxShiftY = clamp(Math.round(height * 0.34), 64, 384);
  const scales = [0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.9, 0.98, 1, 1.06, 1.14];
  const coarseMaxShiftX = Math.floor(maxShiftX / coarseStep) * coarseStep;
  const coarseMaxShiftY = Math.floor(maxShiftY / coarseStep) * coarseStep;
  const coarseCandidates: Array<{ x: number; y: number; scale: number; score: number }> = [];
  for (const scale of scales) {
    let scaleBest = { x: 0, y: 0, scale, score: -Infinity };
    for (let dy = -coarseMaxShiftY; dy <= coarseMaxShiftY; dy += coarseStep) {
      for (let dx = -coarseMaxShiftX; dx <= coarseMaxShiftX; dx += coarseStep) {
        const score = scoreAt(dx, dy, scale);
        if (score > scaleBest.score) scaleBest = { x: dx, y: dy, scale, score };
        if (score > best.score) best = { x: dx, y: dy, scale, score };
      }
    }
    coarseCandidates.push(scaleBest);
  }
  const refineShift = coarseStep + 2;
  for (const coarse of coarseCandidates.sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score).slice(0, 6)) {
    for (let scale = Math.max(0.35, coarse.scale - 0.08); scale <= Math.min(1.22, coarse.scale + 0.08) + 0.0001; scale += 0.02) {
      for (let dy = coarse.y - refineShift; dy <= coarse.y + refineShift; dy += 2) {
        for (let dx = coarse.x - refineShift; dx <= coarse.x + refineShift; dx += 2) {
          const score = scoreAt(dx, dy, scale);
          if (score > best.score) best = { x: dx, y: dy, scale, score };
        }
      }
    }
  }
  const improvement = best.score - baseScore;
  // A large display mask that already overlaps its preview can often find a
  // slightly brighter unrelated plate elsewhere. Scaling is justified only
  // when the transformed glyph/plate fit is decisively better than identity;
  // modest gains are overfitting, not evidence that the authoring model moved
  // or resized the requested text.
  const requiredImprovement = Math.max(Number(options?.minimumImprovement ?? 8), Math.max(0, baseScore) * 0.9);
  if (
    !Number.isFinite(improvement) ||
    improvement < requiredImprovement ||
    best.score < Number(options?.minimumScore ?? 48)
  ) {
    best = { x: 0, y: 0, scale: 1, score: baseScore };
  }
  return {
    ...best,
    originX,
    originY,
    baseScore,
    improvement: best.score - baseScore,
    pointCount: foregroundPoints.length,
    maskFillRatio
  };
}

export function applyMaskAlignmentTransform(
  values: Uint8Array,
  width: number,
  height: number,
  transform: { x: number; y: number; scale?: number; originX?: number; originY?: number }
) {
  const pixelCount = width * height;
  if (values.length !== pixelCount) throw new Error("蒙版变换输入尺寸不一致。");
  const scale = clamp(Number(transform.scale || 1), 0.2, 4);
  const dx = Number(transform.x || 0);
  const dy = Number(transform.y || 0);
  if (Math.abs(scale - 1) < 0.0001 && !dx && !dy) return new Uint8Array(values);
  const originX = Number.isFinite(transform.originX) ? Number(transform.originX) : width / 2;
  const originY = Number.isFinite(transform.originY) ? Number(transform.originY) : height / 2;
  const output = new Uint8Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    const sourceY = originY + (y - originY - dy) / scale;
    if (sourceY < 0 || sourceY > height - 1) continue;
    const top = Math.floor(sourceY);
    const bottom = Math.min(height - 1, top + 1);
    const mixY = sourceY - top;
    for (let x = 0; x < width; x += 1) {
      const sourceX = originX + (x - originX - dx) / scale;
      if (sourceX < 0 || sourceX > width - 1) continue;
      const left = Math.floor(sourceX);
      const right = Math.min(width - 1, left + 1);
      const mixX = sourceX - left;
      const topValue = values[top * width + left] * (1 - mixX) + values[top * width + right] * mixX;
      const bottomValue = values[bottom * width + left] * (1 - mixX) + values[bottom * width + right] * mixX;
      output[y * width + x] = Math.round(topValue * (1 - mixY) + bottomValue * mixY);
    }
  }
  return output;
}

export function solidifySemanticMaskValues(values: Uint8Array, width: number, height: number, threshold: number) {
  const pixelCount = width * height;
  if (values.length !== pixelCount) throw new Error("蒙版像素尺寸不一致。");
  const binary = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) binary[index] = values[index] >= threshold ? 1 : 0;
  const dilated = new Uint8Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && binary[yy * width + xx]) {
            on = 1;
            break;
          }
        }
      }
      dilated[y * width + x] = on;
    }
  }
  const closed = new Uint8Array(pixelCount);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dilated[(y + dy) * width + x + dx]) {
            on = 0;
            break;
          }
        }
      }
      closed[y * width + x] = on;
    }
  }
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const maximumHoleArea = clamp(Math.round(pixelCount * 0.0004), 48, 512);
  for (let start = 0; start < pixelCount; start += 1) {
    if (closed[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let touchesBorder = false;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= pixelCount || visited[next] || closed[next]) continue;
        const nextX = next % width;
        if (Math.abs(nextX - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (!touchesBorder && tail <= maximumHoleArea) {
      for (let offset = 0; offset < tail; offset += 1) closed[queue[offset]] = 1;
    }
  }
  const output = new Uint8Array(values);
  for (let index = 0; index < pixelCount; index += 1) {
    if (closed[index] && output[index] < 245) output[index] = 245;
  }
  return output;
}

export function refineTextMaskValuesFromPreview(
  previewData: Uint8ClampedArray,
  values: Uint8Array,
  width: number,
  height: number,
  threshold: number
) {
  const pixelCount = width * height;
  if (previewData.length !== pixelCount * 4 || values.length !== pixelCount) throw new Error("文字蒙版细化输入尺寸不一致。");
  let support = new Uint8Array(pixelCount);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < pixelCount; index += 1) {
    if (values[index] < threshold) continue;
    support[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return values;
  // Keep the undilated semantic strokes as the colour-estimation core. The
  // wider support below is useful for recovering a differently sized/fonted
  // preview glyph, but sampling colours from that whole halo lets a bright
  // moon, cloud or product edge outweigh the requested title colour.
  const sourceCore = new Uint8Array(support);
  const supportRadius = clamp(Math.round(Math.min(width, height) * 0.008), 4, 10);
  for (let pass = 0; pass < supportRadius; pass += 1) {
    const next = new Uint8Array(support);
    for (let y = Math.max(1, top - supportRadius); y <= Math.min(height - 2, bottom + supportRadius); y += 1) {
      for (let x = Math.max(1, left - supportRadius); x <= Math.min(width - 2, right + supportRadius); x += 1) {
        const index = y * width + x;
        if (support[index]) continue;
        if (
          support[index - 1] || support[index + 1] || support[index - width] || support[index + width] ||
          support[index - width - 1] || support[index - width + 1] || support[index + width - 1] || support[index + width + 1]
        ) next[index] = 1;
      }
    }
    support = next;
  }
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let backgroundSamples = 0;
  const sampleLeft = Math.max(0, left - supportRadius * 2);
  const sampleTop = Math.max(0, top - supportRadius * 2);
  const sampleRight = Math.min(width - 1, right + supportRadius * 2);
  const sampleBottom = Math.min(height - 1, bottom + supportRadius * 2);
  for (let y = sampleTop; y <= sampleBottom; y += 1) {
    for (let x = sampleLeft; x <= sampleRight; x += 1) {
      const index = y * width + x;
      if (support[index]) continue;
      const offset = index * 4;
      histograms[0][previewData[offset]] += 1;
      histograms[1][previewData[offset + 1]] += 1;
      histograms[2][previewData[offset + 2]] += 1;
      backgroundSamples += 1;
    }
  }
  if (backgroundSamples < 32) return values;
  const median = histograms.map((histogram) => {
    const target = backgroundSamples / 2;
    let total = 0;
    for (let value = 0; value < 256; value += 1) {
      total += histogram[value];
      if (total >= target) return value;
    }
    return 0;
  });
  let foregroundRed = 0;
  let foregroundGreen = 0;
  let foregroundBlue = 0;
  let foregroundWeight = 0;
  const previewLuma = (at: number) => previewData[at] * 0.2126 + previewData[at + 1] * 0.7152 + previewData[at + 2] * 0.0722;
  for (let y = Math.max(1, top - supportRadius); y <= Math.min(height - 2, bottom + supportRadius); y += 1) {
    for (let x = Math.max(1, left - supportRadius); x <= Math.min(width - 2, right + supportRadius); x += 1) {
      const index = y * width + x;
      if (!sourceCore[index]) continue;
      const offset = index * 4;
      const redDelta = previewData[offset] - median[0];
      const greenDelta = previewData[offset + 1] - median[1];
      const blueDelta = previewData[offset + 2] - median[2];
      const distance = Math.sqrt(redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta);
      const edge = Math.abs(previewLuma(offset + 4) - previewLuma(offset - 4)) + Math.abs(previewLuma(offset + width * 4) - previewLuma(offset - width * 4));
      if (distance < 34 || edge < 14) continue;
      const weight = distance * (edge - 10);
      foregroundRed += previewData[offset] * weight;
      foregroundGreen += previewData[offset + 1] * weight;
      foregroundBlue += previewData[offset + 2] * weight;
      foregroundWeight += weight;
    }
  }
  if (foregroundWeight <= 0) return values;
  const foreground = [foregroundRed / foregroundWeight, foregroundGreen / foregroundWeight, foregroundBlue / foregroundWeight];
  const foregroundChannels = foreground.map((value, channel) => ({ value, channel })).sort((leftChannel, rightChannel) => rightChannel.value - leftChannel.value);
  const dominantForegroundChannel = foregroundChannels[0].value - foregroundChannels[1].value >= 8 &&
    foregroundChannels[0].value - foregroundChannels[2].value >= 18
    ? foregroundChannels[0].channel
    : -1;
  const candidate = new Uint8Array(pixelCount);
  for (let y = Math.max(1, top - supportRadius); y <= Math.min(height - 2, bottom + supportRadius); y += 1) {
    for (let x = Math.max(1, left - supportRadius); x <= Math.min(width - 2, right + supportRadius); x += 1) {
      const index = y * width + x;
      if (!support[index]) continue;
      const offset = index * 4;
      const redDelta = previewData[offset] - median[0];
      const greenDelta = previewData[offset + 1] - median[1];
      const blueDelta = previewData[offset + 2] - median[2];
      const distance = Math.sqrt(redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta);
      const foregroundDistance = Math.sqrt(
        (previewData[offset] - foreground[0]) ** 2 +
        (previewData[offset + 1] - foreground[1]) ** 2 +
        (previewData[offset + 2] - foreground[2]) ** 2
      );
      const edge = Math.abs(previewLuma(offset + 4) - previewLuma(offset - 4)) + Math.abs(previewLuma(offset + width * 4) - previewLuma(offset - width * 4));
      const dominantChannelValue = dominantForegroundChannel >= 0 ? previewData[offset + dominantForegroundChannel] : 255;
      const competingChannelValue = dominantForegroundChannel >= 0
        ? Math.max(...[0, 1, 2].filter((channel) => channel !== dominantForegroundChannel).map((channel) => previewData[offset + channel]))
        : 0;
      const foregroundHueCompatible = dominantForegroundChannel < 0 || dominantChannelValue + 10 >= competingChannelValue;
      if (distance >= 34 && foregroundDistance <= 60 && foregroundHueCompatible && (edge >= 6 || values[index] >= threshold)) candidate[index] = 255;
    }
  }
  const refined = solidifySemanticMaskValues(candidate, width, height, 128);
  let visible = 0;
  let overlapWithSource = 0;
  let outsideSource = 0;
  let sourceCoreVisible = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (sourceCore[index]) sourceCoreVisible += 1;
    if (refined[index] < 128) continue;
    visible += 1;
    if (values[index] >= threshold) overlapWithSource += 1;
    else outsideSource += 1;
  }
  const sourceVisible = Math.max(1, support.reduce((total, value) => total + (value ? 1 : 0), 0));
  if (visible < 24 || visible > sourceVisible * 0.92) return values;
  // A clean glyph mask is already the most trustworthy spatial contract. The
  // preview-guided refinement is intended to carve glyphs out of an overly
  // broad plate, not to recruit nearby clouds, ornaments or background edges.
  // Keep only a final sanity check here: Image2's separately rendered glyph
  // mask can differ materially from the preview glyph shape, so a strict IoU
  // check would preserve the wrong pixels. Reject only a candidate that is
  // almost entirely disconnected from the original semantic request.
  if (outsideSource > visible * 0.9 || overlapWithSource < visible * 0.05) return values;
  // When the preview-derived candidate agrees with most of the transformed
  // semantic core, the spatial match is trustworthy and the pixels it dropped
  // are usually dark metallic texture or shadow inside the same glyph. Restore
  // that core so calligraphic strokes stay complete. Low-agreement cases keep
  // the stricter colour candidate, which avoids reintroducing moon/cloud pixels
  // from a merely approximate font match.
  if (sourceCoreVisible > 0 && overlapWithSource / sourceCoreVisible >= 0.8) {
    const completed = new Uint8Array(refined);
    for (let index = 0; index < pixelCount; index += 1) {
      if (sourceCore[index] && completed[index] < values[index]) completed[index] = values[index];
    }
    return completed;
  }
  return refined;
}

export function fillNarrowSemanticMaskGaps(
  values: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  maximumGap: number
) {
  const output = new Uint8Array(values);
  const binary = new Uint8Array(width * height);
  for (let index = 0; index < binary.length; index += 1) binary[index] = output[index] >= threshold ? 1 : 0;
  const gap = clamp(Math.round(maximumGap), 1, 32);
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      while (x < width && binary[y * width + x]) x += 1;
      const start = x;
      while (x < width && !binary[y * width + x]) x += 1;
      if (start > 0 && x < width && x - start <= gap) {
        for (let fill = start; fill < x; fill += 1) {
          binary[y * width + fill] = 1;
          output[y * width + fill] = 255;
        }
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      while (y < height && binary[y * width + x]) y += 1;
      const start = y;
      while (y < height && !binary[y * width + x]) y += 1;
      if (start > 0 && y < height && y - start <= gap) {
        for (let fill = start; fill < y; fill += 1) {
          binary[fill * width + x] = 1;
          output[fill * width + x] = 255;
        }
      }
    }
  }
  return output;
}

export function extractPreviewLayerPixelsFromGeneratedInput(
  previewPixels: Uint8ClampedArray,
  generatedPixels: Uint8ClampedArray,
  width: number,
  height: number,
  removeBackgroundPixels: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    backgroundColor?: [number, number, number]
  ) => BackgroundRemovalReport = removeConnectedBorderBackgroundPixels
) {
  const pixelCount = width * height;
  if (previewPixels.length !== pixelCount * 4 || generatedPixels.length !== pixelCount * 4) {
    throw new Error("分层输入像素尺寸与画布不一致。");
  }
  let coloredPixels = 0;
  let transparentInputPixels = 0;
  let midtonePixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const red = generatedPixels[offset];
    const green = generatedPixels[offset + 1];
    const blue = generatedPixels[offset + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 24) coloredPixels += 1;
    if (generatedPixels[offset + 3] < 245) transparentInputPixels += 1;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    if (luma > 24 && luma < 231) midtonePixels += 1;
  }
  const maskColorRatio = coloredPixels / Math.max(1, pixelCount);
  const maskTransparentRatio = transparentInputPixels / Math.max(1, pixelCount);
  const maskMidtoneRatio = midtonePixels / Math.max(1, pixelCount);
  const backgroundColor = estimateBorderColor(generatedPixels, width, height);
  let borderSamples = 0;
  let matchingBorderSamples = 0;
  const inspectBorder = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    borderSamples += 1;
    if (colorDistance(generatedPixels, offset, backgroundColor) <= 46) matchingBorderSamples += 1;
  };
  for (let x = 0; x < width; x += 1) {
    inspectBorder(x, 0);
    if (height > 1) inspectBorder(x, height - 1);
  }
  for (let y = 1; y + 1 < height; y += 1) {
    inspectBorder(0, y);
    if (width > 1) inspectBorder(width - 1, y);
  }
  const borderMatchRatio = matchingBorderSamples / Math.max(1, borderSamples);
  const applyAlphaToPreview = (
    alphaSource: Uint8ClampedArray,
    inputMode: "transparent-layer" | "isolated-color-plate",
    details: {
      removedPixels: number;
      usedExistingAlpha: boolean;
      remainingChromaRatio: number;
      checkerboardDetected?: boolean;
      checkerboardSuspiciousRemovedPixels?: number;
    }
  ) => {
    const output = new Uint8ClampedArray(previewPixels);
    let transparentPixels = 0;
    let partialPixels = 0;
    let visiblePixels = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const nextAlpha = Math.min(output[offset + 3], alphaSource[offset + 3]);
      output[offset + 3] = nextAlpha;
      if (nextAlpha <= 1) {
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
      }
      if (nextAlpha <= 16) transparentPixels += 1;
      else {
        visiblePixels += 1;
        if (nextAlpha < 245) partialPixels += 1;
      }
    }
    return {
      handled: true as const,
      inputMode,
      output,
      transparentRatio: transparentPixels / Math.max(1, pixelCount),
      partialRatio: partialPixels / Math.max(1, pixelCount),
      visibleRatio: visiblePixels / Math.max(1, pixelCount),
      maskColorRatio,
      maskTransparentRatio,
      maskMidtoneRatio,
      borderMatchRatio,
      backgroundColor,
      ...details
    };
  };

  // Some Image2 responses already contain a real transparent PNG layer. Its
  // alpha is the semantic signal; use it as the matte while keeping the
  // authoritative composite preview pixels for exact recomposition.
  if (maskTransparentRatio > 0.02) {
    return applyAlphaToPreview(generatedPixels, "transparent-layer", {
      removedPixels: 0,
      usedExistingAlpha: true,
      remainingChromaRatio: 0
    });
  }

  // Image2 can also return the requested object, fully coloured, on a clean
  // black or white plate instead of a greyscale mask. Accept only a neutral,
  // highly uniform border plate, remove its border-connected key colour, and
  // use the resulting alpha against the original preview. Arbitrary coloured
  // images remain rejected by the semantic-mask path below.
  const backgroundRange = Math.max(...backgroundColor) - Math.min(...backgroundColor);
  const neutralKeyPlate = backgroundRange <= 18 && (
    Math.max(...backgroundColor) <= 40 || Math.min(...backgroundColor) >= 215
  );
  if (maskColorRatio > 0.02 && neutralKeyPlate && borderMatchRatio >= 0.94) {
    const isolatedPixels = new Uint8ClampedArray(generatedPixels);
    const isolation = removeBackgroundPixels(isolatedPixels, width, height, backgroundColor);
    return applyAlphaToPreview(isolatedPixels, "isolated-color-plate", {
      removedPixels: isolation.removedPixels,
      usedExistingAlpha: false,
      remainingChromaRatio: isolation.remainingChromaRatio,
      checkerboardDetected: isolation.checkerboardDetected,
      checkerboardSuspiciousRemovedPixels: isolation.checkerboardSuspiciousRemovedPixels
    });
  }

  return {
    handled: false as const,
    inputMode: maskColorRatio > 0.02 ? "unsupported-color" as const : "semantic-mask" as const,
    output: undefined,
    transparentRatio: 0,
    partialRatio: 0,
    visibleRatio: 0,
    maskColorRatio,
    maskTransparentRatio,
    maskMidtoneRatio,
    borderMatchRatio,
    backgroundColor,
    removedPixels: 0,
    usedExistingAlpha: false,
    remainingChromaRatio: 0
  };
}

export async function extractPreviewLayerFromMaskToDataUrl(
  previewSource: string,
  maskSource: string,
  options: { width: number; height: number; alignment?: "none" | "luminance"; solidify?: boolean; solidifyPasses?: number; refineText?: boolean; fillNarrowGaps?: number }
) {
  const [previewImage, maskImage] = await Promise.all([
    loadImageForCanvas(previewSource),
    loadImageForCanvas(maskSource)
  ]);
  const width = clamp(Math.round(Number(options.width || previewImage.naturalWidth || 0)), 1, 8192);
  const height = clamp(Math.round(Number(options.height || previewImage.naturalHeight || 0)), 1, 8192);
  const previewCanvas = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas");
  previewCanvas.width = maskCanvas.width = width;
  previewCanvas.height = maskCanvas.height = height;
  const previewContext = previewCanvas.getContext("2d", { willReadFrequently: true });
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!previewContext || !maskContext) throw new Error("当前浏览器环境不支持蒙版分层提取。");
  previewContext.drawImage(previewImage, 0, 0, width, height);
  maskContext.drawImage(maskImage, 0, 0, width, height);
  const previewData = previewContext.getImageData(0, 0, width, height);
  const maskData = maskContext.getImageData(0, 0, width, height).data;
  let alternateInput = extractPreviewLayerPixelsFromGeneratedInput(
    previewData.data,
    maskData,
    width,
    height
  );
  if (alternateInput.handled && alternateInput.inputMode === "isolated-color-plate" && window.naimageConfig?.isolateImageBackground) {
    const isolated = await window.naimageConfig.isolateImageBackground({ source: maskCanvas.toDataURL("image/png"), width, height });
    if (!isolated.ok) throw new Error(isolated.error || "独立图层透明提取失败。");
    const isolatedImage = await loadImageForCanvas(isolated.source);
    maskContext.clearRect(0, 0, width, height);
    maskContext.drawImage(isolatedImage, 0, 0, width, height);
    const applied = extractPreviewLayerPixelsFromGeneratedInput(
      previewData.data,
      maskContext.getImageData(0, 0, width, height).data,
      width,
      height
    );
    if (!applied.handled || !applied.output) throw new Error("独立图层透明结果无法应用到合成预览。");
    alternateInput = {
      ...applied,
      inputMode: "isolated-color-plate",
      removedPixels: Number(isolated.removedPixels || 0),
      usedExistingAlpha: false,
      remainingChromaRatio: Number(isolated.remainingChromaRatio || 0),
      checkerboardDetected: isolated.checkerboardDetected === true,
      checkerboardSuspiciousRemovedPixels: Number(isolated.checkerboardSuspiciousRemovedPixels || 0)
    };
  }
  if (alternateInput.handled && alternateInput.output) {
    previewData.data.set(alternateInput.output);
    previewContext.putImageData(previewData, 0, 0);
    const { output: _output, ...report } = alternateInput;
    return {
      dataUrl: previewCanvas.toDataURL("image/png"),
      width,
      height,
      ...report,
      maskContrast: undefined,
      inverted: false,
      alignmentX: 0,
      alignmentY: 0,
      alignmentImprovement: 0,
      solidified: false,
      textRefined: false
    };
  }
  const luminance = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  let borderLuma = 0;
  let borderSamples = 0;
  let coloredMaskPixels = 0;
  let transparentMaskPixels = 0;
  const readLuma = (offset: number) => Math.round(maskData[offset] * 0.2126 + maskData[offset + 1] * 0.7152 + maskData[offset + 2] * 0.0722);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const value = readLuma(offset);
      luminance[index] = value;
      histogram[value] += 1;
      const channelMax = Math.max(maskData[offset], maskData[offset + 1], maskData[offset + 2]);
      const channelMin = Math.min(maskData[offset], maskData[offset + 1], maskData[offset + 2]);
      if (channelMax - channelMin > 24) coloredMaskPixels += 1;
      if (maskData[offset + 3] < 245) transparentMaskPixels += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        borderLuma += value;
        borderSamples += 1;
      }
    }
  }
  const invert = borderLuma / Math.max(1, borderSamples) > 140;
  const pixelCount = width * height;
  const percentile = (ratio: number) => {
    const target = pixelCount * ratio;
    let cumulative = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      cumulative += histogram[value];
      if (cumulative >= target) return value;
    }
    return 255;
  };
  // A valid semantic layer can legitimately occupy only a small part of the
  // artboard (for example a short title). Fixed 8/92 percentiles therefore
  // classify a clean black/white mask as "no contrast" whenever the white
  // subject covers less than 8% of the canvas. Ignore only a very small,
  // bounded tail so isolated Image2 noise cannot define the range, while a
  // layer large enough to pass our visible-content gate still participates.
  const tailSamples = clamp(Math.round(pixelCount * 0.0002), 16, 512);
  const tailRatio = tailSamples / Math.max(1, pixelCount);
  const rawLow = percentile(tailRatio);
  const rawHigh = percentile(1 - tailRatio);
  const lowValue = invert ? 255 - rawHigh : rawLow;
  const highValue = invert ? 255 - rawLow : rawHigh;
  const contrast = highValue - lowValue;
  if (contrast < 36) throw new Error("Image2 返回的图层蒙版对比度不足，无法可靠提取透明层。");
  const threshold = (lowValue + highValue) / 2;
  let maskValues = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    maskValues[index] = invert ? 255 - luminance[index] : luminance[index];
  }
  let hardMaskPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (maskValues[index] >= threshold) hardMaskPixels += 1;
  }
  // Small captions are exactly where Image2 most often preserves the glyphs
  // but redraws the plate at a different width.  Skipping scale alignment for
  // sparse text makes the raw mask clip the authoritative preview before the
  // semantic worker ever sees it, so the missing strokes cannot be recovered
  // later.  The transform already has a 96-pixel floor plus score/improvement
  // guards; let those evidence checks decide instead of using canvas coverage.
  const useTextScaleAlignment = options.refineText === true && hardMaskPixels >= 96;
  const resolvedAlignment = options.alignment === "luminance"
    ? options.refineText === true && !useTextScaleAlignment
      ? { x: 0, y: 0, scale: 1, originX: width / 2, originY: height / 2, baseScore: 0, score: 0, improvement: 0, pointCount: hardMaskPixels }
      : useTextScaleAlignment
      ? findTextMaskAlignmentTransform(previewData.data, maskValues, width, height, threshold)
      : findLuminanceMaskAlignmentOffset(previewData.data, maskValues, width, height, threshold)
    : { x: 0, y: 0, scale: 1, originX: width / 2, originY: height / 2, baseScore: 0, score: 0, improvement: 0, pointCount: 0 };
  const alignment = {
    ...resolvedAlignment,
    scale: "scale" in resolvedAlignment ? resolvedAlignment.scale : 1,
    originX: "originX" in resolvedAlignment ? resolvedAlignment.originX : width / 2,
    originY: "originY" in resolvedAlignment ? resolvedAlignment.originY : height / 2,
    maskFillRatio: "maskFillRatio" in resolvedAlignment ? Number(resolvedAlignment.maskFillRatio || 0) : 0
  };
  const textAlignmentChanged = Boolean(alignment.x || alignment.y || Math.abs(alignment.scale - 1) > 0.0001);
  if (textAlignmentChanged) {
    maskValues = applyMaskAlignmentTransform(maskValues, width, height, alignment);
  }
  let textRefined = false;
  if (options.refineText) {
    // Small caption/body-copy masks already encode individual glyph strokes
    // more accurately than preview colour clustering. Reserve the heavier
    // preview-guided refinement for larger display text or suspicious plates.
    if (
      hardMaskPixels >= Math.max(96, Math.round(pixelCount * 0.003)) &&
      (textAlignmentChanged || alignment.maskFillRatio >= 0.68)
    ) {
      maskValues = new Uint8Array(refineTextMaskValuesFromPreview(previewData.data, maskValues, width, height, threshold));
      textRefined = true;
    }
  }
  if (options.solidify) {
    const passes = clamp(Math.round(Number(options.solidifyPasses ?? 1)), 1, 3);
    for (let pass = 0; pass < passes; pass += 1) maskValues = solidifySemanticMaskValues(maskValues, width, height, threshold);
  }
  if (Number(options.fillNarrowGaps || 0) > 0) {
    maskValues = fillNarrowSemanticMaskGaps(maskValues, width, height, threshold, Number(options.fillNarrowGaps));
  }
  const feather = clamp(contrast * 0.2, 12, 42);
  const lower = threshold - feather;
  const upper = threshold + feather;
  const output = previewData.data;
  let transparentPixels = 0;
  let partialPixels = 0;
  let visiblePixels = 0;
  let midtoneMaskPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const value = maskValues[index];
    if (value > 24 && value < 231) midtoneMaskPixels += 1;
    const normalized = clamp((value - lower) / Math.max(1, upper - lower), 0, 1);
    const smooth = normalized * normalized * (3 - 2 * normalized);
    const nextAlpha = Math.round(output[offset + 3] * smooth);
    output[offset + 3] = nextAlpha;
    if (nextAlpha <= 1) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
    }
    if (nextAlpha <= 16) transparentPixels += 1;
    else {
      visiblePixels += 1;
      if (nextAlpha < 245) partialPixels += 1;
    }
  }
  const maskColorRatio = coloredMaskPixels / Math.max(1, pixelCount);
  const maskTransparentRatio = transparentMaskPixels / Math.max(1, pixelCount);
  const maskMidtoneRatio = midtoneMaskPixels / Math.max(1, pixelCount);
  if (maskColorRatio > 0.02) throw new Error("Image2 返回的图层蒙版包含明显彩色内容，无法作为可靠语义蒙版。");
  if (maskTransparentRatio > 0.02) throw new Error("Image2 返回的图层蒙版本身包含大面积透明像素，已停止以避免伪透明结果。");
  if (maskMidtoneRatio > 0.32) throw new Error("Image2 返回的图层蒙版灰阶过多，疑似棋盘格或非二值图像。");
  previewContext.putImageData(previewData, 0, 0);
  return {
    dataUrl: previewCanvas.toDataURL("image/png"),
    width,
    height,
    transparentRatio: transparentPixels / Math.max(1, pixelCount),
    partialRatio: partialPixels / Math.max(1, pixelCount),
    visibleRatio: visiblePixels / Math.max(1, pixelCount),
    maskContrast: contrast,
    maskColorRatio,
    maskTransparentRatio,
    maskMidtoneRatio,
    inverted: invert,
    alignmentX: alignment.x,
    alignmentY: alignment.y,
    alignmentScale: alignment.scale,
    alignmentImprovement: alignment.improvement,
    solidified: options.solidify === true,
    textRefined,
    inputMode: "semantic-mask" as const,
    borderMatchRatio: alternateInput.borderMatchRatio,
    removedPixels: 0,
    usedExistingAlpha: false,
    remainingChromaRatio: 0
  };
}

export async function analyzeTransparentLayerAlphaOverlap(
  layers: Array<{ id: string; role?: string; source: string }>,
  options: { width: number; height: number }
) {
  const width = clamp(Math.round(Number(options.width || 0)), 1, 8192);
  const height = clamp(Math.round(Number(options.height || 0)), 1, 8192);
  const pixelCount = width * height;
  const prepared: Array<{ id: string; role: string; visiblePixels: number; alpha: Uint8Array }> = [];
  for (const layer of layers) {
    const image = await loadImageForCanvas(layer.source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器环境不支持图层重叠分析。");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(pixelCount);
    let visiblePixels = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const value = rgba[index * 4 + 3];
      alpha[index] = value;
      if (value > 32) visiblePixels += 1;
    }
    prepared.push({ id: layer.id, role: String(layer.role || "other"), visiblePixels, alpha });
  }
  const pairs: Array<{
    leftId: string;
    rightId: string;
    leftRole: string;
    rightRole: string;
    overlapPixels: number;
    canvasRatio: number;
    smallerLayerRatio: number;
  }> = [];
  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      const left = prepared[leftIndex];
      const right = prepared[rightIndex];
      let overlapPixels = 0;
      for (let index = 0; index < pixelCount; index += 1) {
        if (left.alpha[index] > 32 && right.alpha[index] > 32) overlapPixels += 1;
      }
      pairs.push({
        leftId: left.id,
        rightId: right.id,
        leftRole: left.role,
        rightRole: right.role,
        overlapPixels,
        canvasRatio: overlapPixels / Math.max(1, pixelCount),
        smallerLayerRatio: overlapPixels / Math.max(1, Math.min(left.visiblePixels, right.visiblePixels))
      });
    }
  }
  return {
    width,
    height,
    layers: prepared.map(({ id, role, visiblePixels }) => ({ id, role, visiblePixels, visibleRatio: visiblePixels / Math.max(1, pixelCount) })),
    pairs
  };
}

export async function analyzeLayerVisualContribution(
  backgroundSource: string,
  layers: Array<{ id: string; role?: string; source: string }>,
  options: { width: number; height: number }
) {
  const width = clamp(Math.round(Number(options.width || 0)), 1, 8192);
  const height = clamp(Math.round(Number(options.height || 0)), 1, 8192);
  const readPixels = async (source: string) => {
    const image = await loadImageForCanvas(source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器环境不支持图层视觉贡献分析。");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const underlying = new Uint8ClampedArray(await readPixels(backgroundSource));
  const reports = [] as Array<{
    id: string;
    role: string;
    visiblePixels: number;
    meanContrast: number;
    strongContrastRatio: number;
  }>;
  for (const layer of layers) {
    const pixels = await readPixels(layer.source);
    let visiblePixels = 0;
    let contrastTotal = 0;
    let strongPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const sourceAlpha = pixels[offset + 3] / 255;
      if (sourceAlpha > 0.06) {
        const contrast = (
          Math.abs(pixels[offset] - underlying[offset]) +
          Math.abs(pixels[offset + 1] - underlying[offset + 1]) +
          Math.abs(pixels[offset + 2] - underlying[offset + 2])
        ) / 3;
        visiblePixels += 1;
        contrastTotal += contrast;
        if (contrast > 24) strongPixels += 1;
      }
      const targetAlpha = underlying[offset + 3] / 255;
      const nextAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        underlying[offset + channel] = nextAlpha <= 0
          ? 0
          : Math.round((pixels[offset + channel] * sourceAlpha + underlying[offset + channel] * targetAlpha * (1 - sourceAlpha)) / nextAlpha);
      }
      underlying[offset + 3] = Math.round(nextAlpha * 255);
    }
    reports.push({
      id: layer.id,
      role: String(layer.role || "other"),
      visiblePixels,
      meanContrast: contrastTotal / Math.max(1, visiblePixels),
      strongContrastRatio: strongPixels / Math.max(1, visiblePixels)
    });
  }
  return { width, height, reports };
}

export function repairLayerCoveragePixelBuffers(
  preview: Uint8ClampedArray,
  background: Uint8ClampedArray,
  layers: Uint8ClampedArray[],
  width: number,
  height: number,
  metadata: Array<{ id: string; role?: string; semanticRefined?: boolean }>
) {
  const pixelCount = width * height;
  if (
    preview.length !== pixelCount * 4 ||
    background.length !== pixelCount * 4 ||
    layers.length !== metadata.length ||
    layers.some((layer) => layer.length !== pixelCount * 4)
  ) throw new Error("图层覆盖补偿输入尺寸不一致。");
  const normalizedRoles = metadata.map((item) => String(item.role || "other").toLowerCase());
  const subjectIndex = normalizedRoles.findIndex((role, index) => role === "subject" && metadata[index]?.semanticRefined !== true);
  const subjectOriginalSupport = new Uint8Array(pixelCount);
  const subjectRejectedSupport = new Uint8Array(pixelCount);
  let subjectLeakageRemovedPixels = 0;
  if (subjectIndex >= 0) {
    const subject = layers[subjectIndex];
    const distance = new Int16Array(pixelCount);
    distance.fill(-1);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;
    const luma = (index: number) => {
      const offset = clamp(index, 0, pixelCount - 1) * 4;
      return preview[offset] * 0.2126 + preview[offset + 1] * 0.7152 + preview[offset + 2] * 0.0722;
    };
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      if (subject[offset + 3] <= 16) continue;
      subjectOriginalSupport[index] = 1;
      const backgroundDifference = (
        Math.abs(preview[offset] - background[offset]) +
        Math.abs(preview[offset + 1] - background[offset + 1]) +
        Math.abs(preview[offset + 2] - background[offset + 2])
      ) / 3;
      const x = index % width;
      const y = Math.floor(index / width);
      const localEdge = (
        Math.abs(luma(x + 1 < width ? index + 1 : index) - luma(x > 0 ? index - 1 : index)) +
        Math.abs(luma(y + 1 < height ? index + width : index) - luma(y > 0 ? index - width : index))
      );
      if (backgroundDifference >= 36 || localEdge >= 14) {
        distance[index] = 0;
        queue[tail++] = index;
      }
    }
    // Keep low-contrast hair, fabric and antialiased edges when they are close
    // to a confident subject pixel. A loose AI mask often contains much larger
    // smooth background islands; those have no semantic seed nearby and can be
    // removed without carving through the subject itself.
    const supportRadius = 10;
    while (head < tail) {
      const index = queue[head++];
      const current = distance[index];
      if (current >= supportRadius) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (!subjectOriginalSupport[next] || distance[next] >= 0) continue;
          distance[next] = current + 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail > 0) {
      for (let index = 0; index < pixelCount; index += 1) {
        if (!subjectOriginalSupport[index] || distance[index] >= 0) continue;
        const offset = index * 4;
        subjectRejectedSupport[index] = 1;
        subject[offset] = 0;
        subject[offset + 1] = 0;
        subject[offset + 2] = 0;
        subject[offset + 3] = 0;
        subjectLeakageRemovedPixels += 1;
      }
    }
  }
  const composite = new Uint8ClampedArray(background);
  for (const layer of layers) {
    for (let offset = 0; offset < composite.length; offset += 4) {
      const sourceAlpha = layer[offset + 3] / 255;
      const targetAlpha = composite[offset + 3] / 255;
      const nextAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        composite[offset + channel] = nextAlpha <= 0
          ? 0
          : Math.round((layer[offset + channel] * sourceAlpha + composite[offset + channel] * targetAlpha * (1 - sourceAlpha)) / nextAlpha);
      }
      composite[offset + 3] = Math.round(nextAlpha * 255);
    }
  }
  const residualAlpha = new Uint8Array(pixelCount);
  let residualPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const difference = (
      Math.abs(preview[offset] - composite[offset]) +
      Math.abs(preview[offset + 1] - composite[offset + 1]) +
      Math.abs(preview[offset + 2] - composite[offset + 2])
    ) / 3;
    const alpha = difference <= 12 ? 0 : Math.round(clamp((difference - 12) / 28, 0, 1) * 255);
    residualAlpha[index] = alpha;
    if (alpha > 16) residualPixels += 1;
  }
  const distanceMap = (layer: Uint8ClampedArray, radius: number) => {
    const distance = new Int16Array(pixelCount);
    const origin = new Int32Array(pixelCount);
    distance.fill(-1);
    origin.fill(-1);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      if (layer[index * 4 + 3] <= 16) continue;
      distance[index] = 0;
      origin[index] = index;
      queue[tail++] = index;
    }
    while (head < tail) {
      const index = queue[head++];
      const current = distance[index];
      if (current >= radius) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (distance[next] >= 0) continue;
          distance[next] = current + 1;
          origin[next] = origin[index];
          queue[tail++] = next;
        }
      }
    }
    return { distance, origin };
  };
  const prioritized = metadata
    .map((item, index) => {
      const role = String(item.role || "other").toLowerCase();
      // A successful semantic pass has already aligned and refined this
      // layer. Expanding it again from a global preview residual destroys the
      // independence we just established (for example by attaching a product
      // reflection or background patch). Keep residual repair only as a
      // fallback for layers that did not pass through semantic refinement.
      const radius = item.semanticRefined === true
        ? 0
        : role === "text"
          ? 2
          : role === "decoration"
            ? 1
            : role === "subject"
              ? 6
              : 0;
      return { index, role, radius };
    })
    .filter((item) => item.radius > 0)
    .reverse()
    .map((item) => ({ ...item, ...distanceMap(layers[item.index], item.radius) }));
  const previewLumaAt = (index: number) => {
    const offset = clamp(index, 0, pixelCount - 1) * 4;
    return preview[offset] * 0.2126 + preview[offset + 1] * 0.7152 + preview[offset + 2] * 0.0722;
  };
  const localEdge = (index: number) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const left = x > 0 ? index - 1 : index;
    const right = x + 1 < width ? index + 1 : index;
    const top = y > 0 ? index - width : index;
    const bottom = y + 1 < height ? index + width : index;
    return Math.abs(previewLumaAt(right) - previewLumaAt(left)) + Math.abs(previewLumaAt(bottom) - previewLumaAt(top));
  };
  const colorDistanceToOrigin = (index: number, origin: number) => {
    if (origin < 0) return Number.POSITIVE_INFINITY;
    const offset = index * 4;
    const originOffset = origin * 4;
    return Math.sqrt(
      (preview[offset] - preview[originOffset]) ** 2 +
      (preview[offset + 1] - preview[originOffset + 1]) ** 2 +
      (preview[offset + 2] - preview[originOffset + 2]) ** 2
    );
  };
  const backgroundDifferenceAt = (index: number) => {
    const offset = index * 4;
    return (
      Math.abs(preview[offset] - background[offset]) +
      Math.abs(preview[offset + 1] - background[offset + 1]) +
      Math.abs(preview[offset + 2] - background[offset + 2])
    ) / 3;
  };
  const subjectCandidate = prioritized.find((candidate) => candidate.role === "subject");
  const isSubjectInteriorGap = (index: number) => {
    if (!subjectCandidate || subjectRejectedSupport[index]) return false;
    if (subjectOriginalSupport[index]) return true;
    const x = index % width;
    const y = Math.floor(index / width);
    const maximumGap = 12;
    let left = false;
    let right = false;
    let top = false;
    let bottom = false;
    for (let step = 1; step <= maximumGap; step += 1) {
      if (!left && x - step >= 0 && layers[subjectCandidate.index][(index - step) * 4 + 3] > 16) left = true;
      if (!right && x + step < width && layers[subjectCandidate.index][(index + step) * 4 + 3] > 16) right = true;
      if (!top && y - step >= 0 && layers[subjectCandidate.index][(index - step * width) * 4 + 3] > 16) top = true;
      if (!bottom && y + step < height && layers[subjectCandidate.index][(index + step * width) * 4 + 3] > 16) bottom = true;
      if ((left && right) || (top && bottom)) return true;
    }
    return false;
  };
  const assigned = new Uint32Array(layers.length);
  let unassignedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const alpha = residualAlpha[index];
    if (alpha <= 16) continue;
    let target = -1;
    for (const candidate of prioritized) {
      const distance = candidate.distance[index];
      if (distance < 0 || distance > candidate.radius) continue;
      const colorDistance = colorDistanceToOrigin(index, candidate.origin[index]);
      const backgroundDifference = backgroundDifferenceAt(index);
      if (candidate.role === "text") {
        // Coverage repair is only for the antialiased rim or a one/two-pixel
        // break in an already aligned glyph. Wider expansion can absorb water
        // reflections, bottle edges and foliage that happen to share the text
        // colour. Missing strokes must be solved by text-mask alignment and
        // refinement, not by claiming unrelated preview residuals.
        const edge = localEdge(index);
        if (
          backgroundDifference < 22 ||
          colorDistance > (distance <= 1 ? 56 : 40) ||
          (distance > 1 && edge < 14) ||
          (edge < 8 && colorDistance > 34)
        ) continue;
      } else if (candidate.role === "decoration") {
        // A focused product/prop matte already carries its silhouette. Only
        // admit the immediately adjacent antialiasing rim; a wider radius can
        // turn the pedestal, reflection or neighbouring subject into part of
        // the supposedly independent product PNG.
        if (backgroundDifference < 20 || colorDistance > 68 || localEdge(index) < 6) continue;
      } else if (candidate.role === "subject") {
        if (subjectRejectedSupport[index]) continue;
        const interior = isSubjectInteriorGap(index);
        if (!interior && (distance > 3 || backgroundDifference < 24 || colorDistance > 104)) continue;
      }
      target = candidate.index;
      break;
    }
    // Deliberately leave uncertain residual pixels unassigned. The clean
    // background is an independently inpainted image, so preview/background
    // differences include lighting and texture drift that do not belong to
    // any semantic layer. Falling back to the foreground-effects layer turns
    // that drift into large rectangular background plates. A small visual
    // mismatch is safer than manufacturing a semantically false PNG layer.
    if (target < 0) {
      unassignedPixels += 1;
      continue;
    }
    const offset = index * 4;
    const layer = layers[target];
    layer[offset] = preview[offset];
    layer[offset + 1] = preview[offset + 1];
    layer[offset + 2] = preview[offset + 2];
    layer[offset + 3] = Math.max(layer[offset + 3], alpha);
    assigned[target] += 1;
  }
  return {
    residualPixels,
    residualRatio: residualPixels / Math.max(1, pixelCount),
    unassignedPixels,
    unassignedRatio: unassignedPixels / Math.max(1, pixelCount),
    subjectLeakageRemovedPixels,
    subjectLeakageRemovedRatio: subjectLeakageRemovedPixels / Math.max(1, pixelCount),
    assignments: metadata.map((item, index) => ({ id: item.id, role: String(item.role || "other"), pixels: assigned[index], ratio: assigned[index] / Math.max(1, pixelCount) }))
  };
}

export async function repairLayerCoverageFromPreview(
  previewSource: string,
  backgroundSource: string,
  layers: Array<{ id: string; role?: string; source: string; semanticRefined?: boolean }>,
  options: { width: number; height: number }
) {
  const width = clamp(Math.round(Number(options.width || 0)), 1, 8192);
  const height = clamp(Math.round(Number(options.height || 0)), 1, 8192);
  const read = async (source: string) => {
    const image = await loadImageForCanvas(source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器环境不支持图层覆盖补偿。");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { canvas, context, data: context.getImageData(0, 0, width, height) };
  };
  const [preview, background, ...preparedLayers] = await Promise.all([
    read(previewSource),
    read(backgroundSource),
    ...layers.map((layer) => read(layer.source))
  ]);
  const report = repairLayerCoveragePixelBuffers(
    preview.data.data,
    background.data.data,
    preparedLayers.map((layer) => layer.data.data),
    width,
    height,
    layers
  );
  return {
    ...report,
    layers: preparedLayers.map((layer, index) => {
      layer.context.putImageData(layer.data, 0, 0);
      return { id: layers[index].id, role: String(layers[index].role || "other"), source: layer.canvas.toDataURL("image/png") };
    })
  };
}

export function maskDataUrlFromPaintCanvas(maskCanvas: HTMLCanvasElement, mode: "edit" | "keep" = "edit") {
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const sourceContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || width <= 0 || height <= 0) throw new Error("遮罩画布未就绪。");

  const sourceData = sourceContext.getImageData(0, 0, width, height).data;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器环境不支持 mask 导出。");
  context.fillStyle = mode === "keep" ? "rgba(255, 255, 255, 0)" : "rgba(255, 255, 255, 1)";
  context.fillRect(0, 0, width, height);
  const maskData = context.getImageData(0, 0, width, height);
  let paintedPixels = 0;
  for (let offset = 0; offset < sourceData.length; offset += 4) {
    if (sourceData[offset + 3] > 8) {
      maskData.data[offset] = 255;
      maskData.data[offset + 1] = 255;
      maskData.data[offset + 2] = 255;
      maskData.data[offset + 3] = mode === "keep" ? 255 : 0;
      paintedPixels += 1;
    }
  }
  context.putImageData(maskData, 0, 0);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    paintedPixels,
    width,
    height
  };
}
