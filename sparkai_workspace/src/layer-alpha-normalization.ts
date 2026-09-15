import { loadImageForCanvas } from "./image-processing-runtime.ts";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeLayerAlphaPixelBuffers(
  buffers: Uint8ClampedArray[],
  width: number,
  height: number,
  options?: { ownershipBoost?: number; preserveLayerAlpha?: boolean[] }
) {
  const normalizedWidth = clamp(Math.round(Number(width || 0)), 1, 8192);
  const normalizedHeight = clamp(Math.round(Number(height || 0)), 1, 8192);
  const pixelCount = normalizedWidth * normalizedHeight;
  if (buffers.some((buffer) => buffer.length !== pixelCount * 4)) {
    throw new Error("图层像素尺寸不一致，无法统一分配像素归属。");
  }
  const originalAlpha = buffers.map((buffer) => {
    const alpha = new Uint8Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) alpha[index] = buffer[index * 4 + 3];
    return alpha;
  });
  const ownershipBoost = clamp(Number(options?.ownershipBoost ?? 2), 1, 4);
  const coveredByHigherLayers = new Uint8Array(pixelCount);
  const reports = new Array<{
    originalVisiblePixels: number;
    visiblePixels: number;
    visibleRatio: number;
    removedRatio: number;
  }>(buffers.length);
  for (let layerIndex = buffers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const buffer = buffers[layerIndex];
    const sourceAlpha = originalAlpha[layerIndex];
    let originalVisiblePixels = 0;
    let visiblePixels = 0;
    let removedAlpha = 0;
    let originalAlphaTotal = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const alpha = sourceAlpha[index];
      const keptAlpha = options?.preserveLayerAlpha?.[layerIndex] === true
        ? alpha
        : Math.round(alpha * (255 - coveredByHigherLayers[index]) / 255);
      if (alpha > 16) originalVisiblePixels += 1;
      originalAlphaTotal += alpha;
      removedAlpha += alpha - keptAlpha;
      buffer[offset + 3] = keptAlpha;
      if (keptAlpha <= 1) {
        buffer[offset] = 0;
        buffer[offset + 1] = 0;
        buffer[offset + 2] = 0;
      }
      if (keptAlpha > 16) visiblePixels += 1;
      // Keep the upper layer's own feathered alpha untouched, but give that
      // edge stronger ownership when removing pixels from lower semantic
      // masks. This prevents readable text/product silhouettes from surviving
      // as ghost outlines in a lower subject layer.
      const ownershipAlpha = alpha <= 2 ? 0 : Math.min(255, Math.round(alpha * ownershipBoost));
      coveredByHigherLayers[index] = Math.max(coveredByHigherLayers[index], ownershipAlpha);
    }
    reports[layerIndex] = {
      originalVisiblePixels,
      visiblePixels,
      visibleRatio: visiblePixels / Math.max(1, pixelCount),
      removedRatio: removedAlpha / Math.max(1, originalAlphaTotal)
    };
  }
  return { width: normalizedWidth, height: normalizedHeight, reports };
}

export async function normalizeTransparentLayerAlphaExclusivity(
  layers: Array<{ id: string; role?: string; source: string }>,
  options: { width: number; height: number; preserveLayerIds?: string[] }
) {
  const width = clamp(Math.round(Number(options.width || 0)), 1, 8192);
  const height = clamp(Math.round(Number(options.height || 0)), 1, 8192);
  const pixelCount = width * height;
  const prepared: Array<{
    id: string;
    role: string;
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    data: ImageData;
  }> = [];
  for (const layer of layers) {
    const image = await loadImageForCanvas(layer.source);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器环境不支持图层像素归属处理。");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    prepared.push({
      id: layer.id,
      role: String(layer.role || "other"),
      canvas,
      context,
      data
    });
  }
  const preserveLayerIds = new Set((options.preserveLayerIds || []).map((id) => String(id)));
  const normalizedPixels = normalizeLayerAlphaPixelBuffers(prepared.map((layer) => layer.data.data), width, height, {
    preserveLayerAlpha: prepared.map((layer) => preserveLayerIds.has(layer.id))
  });
  const normalized = prepared.map((layer, layerIndex) => {
    const report = normalizedPixels.reports[layerIndex];
    layer.context.putImageData(layer.data, 0, 0);
    return {
      id: layer.id,
      role: layer.role,
      source: layer.canvas.toDataURL("image/png"),
      ...report
    };
  });
  return { width, height, layers: normalized };
}
