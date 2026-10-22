function dimensions(value) {
  const width = Number(value?.width), height = Number(value?.height);
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= 32_000_000 ? { width, height, pixels: width * height } : null;
}

/** Shape sanitization only; evidence is created by the actual pixel processors. */
export function normalizeImageLocalProcessing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = {};
  if (["png", "jpeg", "webp"].includes(value.outputFormat)) result.outputFormat = value.outputFormat;
  const mask = value.maskComposite, maskSize = dimensions(mask);
  if (maskSize && mask.verified === true && mask.changedPixels === 0 && Number.isInteger(mask.protectedPixelCount) && mask.protectedPixelCount >= 0 && mask.protectedPixelCount <= maskSize.pixels) {
    result.maskComposite = { width: maskSize.width, height: maskSize.height, protectedPixelCount: mask.protectedPixelCount, changedPixels: 0, verified: true };
  }
  const alpha = value.alpha, alphaSize = dimensions(alpha);
  if (alphaSize && alpha.verified === true && [alpha.transparentPixels, alpha.visiblePixels].every(count => Number.isInteger(count) && count >= 0 && count <= alphaSize.pixels)) {
    const transparentRatio = alpha.transparentPixels / alphaSize.pixels, visibleRatio = alpha.visiblePixels / alphaSize.pixels;
    if (transparentRatio >= 0.025 && visibleRatio >= 0.005) result.alpha = { width: alphaSize.width, height: alphaSize.height, transparentPixels: alpha.transparentPixels, visiblePixels: alpha.visiblePixels, transparentRatio, visibleRatio, verified: true };
  }
  return Object.keys(result).length ? result : undefined;
}
