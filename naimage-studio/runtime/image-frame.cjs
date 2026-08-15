const imagePromptRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "4:5"]);
const imagePromptResolutions = new Set(["1K", "2K", "4K"]);
const legacyImagePromptResolutions = new Set(["720P", "1080P"]);
const imagePromptQualities = new Set(["low", "medium", "high", "auto"]);
const image2MaxEdge = 3840;
const image2MinPixels = 655360;
const image2MaxPixels = 8294400;
const image2SourceRequestSizes = ["1024x1024", "1536x1024", "1024x1536"];
const imageResolutionPresets = {
  "1K": { longEdge: 1280, squareEdge: 1024 },
  "720P": { longEdge: 1280, squareEdge: 1024 },
  "1080P": { longEdge: 1920, squareEdge: 1088 },
  "2K": { longEdge: 2048, squareEdge: 2048 },
  "4K": { longEdge: 3840, squareEdge: 2880 }
};

function normalizeImagePromptResolution(value, fallback = "1K") {
  const raw = String(value ?? "").trim().toUpperCase();
  if (imagePromptResolutions.has(raw)) return raw;
  if (legacyImagePromptResolutions.has(raw)) return raw;
  const normalizedFallback = String(fallback || "").trim().toUpperCase();
  if (imagePromptResolutions.has(normalizedFallback)) return normalizedFallback;
  if (legacyImagePromptResolutions.has(normalizedFallback)) return normalizedFallback;
  return "1K";
}

function isImage2Model(model) {
  return /^gpt-image-2\b/i.test(String(model || ""));
}

function parseImageRatioValue(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const max = Math.max(width, height);
  const min = Math.min(width, height);
  if (max / min > 3) return null;
  return { ratio: `${width}:${height}`, width, height };
}

function normalizeImageRatio(value, fallback = "1:1") {
  const parsed = parseImageRatioValue(value);
  if (parsed && imagePromptRatios.has(parsed.ratio)) return parsed.ratio;
  return imagePromptRatios.has(fallback) ? fallback : "1:1";
}

function parseImageSizeValue(size) {
  const match = String(size || "").trim().match(/^(\d{3,5})\s*x\s*(\d{3,5})$/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function roundToImageStep(value) {
  return Math.max(512, Math.round(Number(value || 0) / 16) * 16);
}

function computedImageSizeFor(ratio, resolution) {
  const preset = imageResolutionPresets[normalizeImagePromptResolution(resolution)];
  const parsed = parseImageRatioValue(normalizeImageRatio(ratio));
  if (!parsed || parsed.width === parsed.height) {
    const edge = roundToImageStep(preset.squareEdge);
    return `${edge}x${edge}`;
  }
  const landscape = parsed.width > parsed.height;
  const longUnits = Math.max(parsed.width, parsed.height);
  const shortUnits = Math.min(parsed.width, parsed.height);
  const pixelLimitedLongEdge = Math.floor(Math.sqrt((image2MaxPixels * longUnits) / shortUnits) / 16) * 16;
  let longEdge = Math.min(roundToImageStep(preset.longEdge), image2MaxEdge, pixelLimitedLongEdge);
  const dimensionsForLongEdge = (value) => {
    const shortEdge = roundToImageStep((value * shortUnits) / longUnits);
    return landscape ? { width: value, height: shortEdge } : { width: shortEdge, height: value };
  };
  let dimensions = dimensionsForLongEdge(longEdge);
  while (dimensions.width * dimensions.height > image2MaxPixels && longEdge > 512) {
    longEdge -= 16;
    dimensions = dimensionsForLongEdge(longEdge);
  }
  return `${dimensions.width}x${dimensions.height}`;
}

function isImage2DeliverySize(size) {
  const parsed = parseImageSizeValue(size);
  if (!parsed) return false;
  const pixels = parsed.width * parsed.height;
  const maxEdge = Math.max(parsed.width, parsed.height);
  const minEdge = Math.min(parsed.width, parsed.height);
  return parsed.width % 16 === 0 && parsed.height % 16 === 0 && maxEdge <= image2MaxEdge && maxEdge / minEdge <= 3 && pixels >= image2MinPixels && pixels <= image2MaxPixels;
}

function constrainedImage2DeliverySize(size, ratio, resolution) {
  const requested = parseImageSizeValue(size) || parseImageSizeValue(computedImageSizeFor(ratio, resolution));
  const parsedRatio = parseImageRatioValue(ratio) || (requested
    ? { ratio: `${requested.width}:${requested.height}`, width: requested.width, height: requested.height }
    : { ratio: "1:1", width: 1, height: 1 });
  const landscape = parsedRatio.width >= parsedRatio.height;
  const longUnits = Math.max(parsedRatio.width, parsedRatio.height);
  const shortUnits = Math.min(parsedRatio.width, parsedRatio.height);
  const desiredLongEdge = Math.max(requested?.width || 0, requested?.height || 0, 1024);
  const minLongEdge = Math.ceil(Math.sqrt((image2MinPixels * longUnits) / shortUnits) / 16) * 16;
  const maxLongEdge = Math.floor(Math.min(
    image2MaxEdge,
    Math.sqrt((image2MaxPixels * longUnits) / shortUnits)
  ) / 16) * 16;
  let longEdge = Math.max(minLongEdge, Math.min(maxLongEdge, Math.round(desiredLongEdge / 16) * 16));

  const dimensionsForLongEdge = (value) => {
    const shortEdge = Math.max(512, Math.round(((value * shortUnits) / longUnits) / 16) * 16);
    return landscape
      ? { width: value, height: shortEdge }
      : { width: shortEdge, height: value };
  };

  let dimensions = dimensionsForLongEdge(longEdge);
  while (!isImage2DeliverySize(`${dimensions.width}x${dimensions.height}`) && longEdge > minLongEdge) {
    longEdge -= 16;
    dimensions = dimensionsForLongEdge(longEdge);
  }
  while (!isImage2DeliverySize(`${dimensions.width}x${dimensions.height}`) && longEdge < maxLongEdge) {
    longEdge += 16;
    dimensions = dimensionsForLongEdge(longEdge);
  }
  return isImage2DeliverySize(`${dimensions.width}x${dimensions.height}`)
    ? `${dimensions.width}x${dimensions.height}`
    : "1024x1024";
}

function normalizeImage2Size(size, ratio, resolution) {
  const parsed = parseImageSizeValue(size);
  if (isImage2DeliverySize(size)) return String(size).trim().toLowerCase();
  if (parsed) {
    const rounded = `${roundToImageStep(parsed.width)}x${roundToImageStep(parsed.height)}`;
    if (isImage2DeliverySize(rounded)) return rounded;
  }
  const computed = computedImageSizeFor(ratio, resolution);
  if (isImage2DeliverySize(computed)) return computed;
  return constrainedImage2DeliverySize(parsed ? `${parsed.width}x${parsed.height}` : computed, ratio, resolution);
}

function image2SourceRequestSizeForDelivery(size) {
  const parsed = parseImageSizeValue(size);
  if (!parsed || parsed.width === parsed.height) return image2SourceRequestSizes[0];
  return parsed.width > parsed.height ? image2SourceRequestSizes[1] : image2SourceRequestSizes[2];
}

function imageFrameContractForSettings(settings = {}) {
  const ratio = normalizeImageRatio(settings.imageRatio, "1:1");
  const resolution = normalizeImagePromptResolution(settings.imageResolution, "1K");
  return {
    locked: settings.imageFrameLocked === true,
    ratio,
    resolution,
    size: computedImageSizeFor(ratio, resolution)
  };
}

function freezeImageFrameSettings(settings = {}, requested = {}) {
  const rawRatio = String(requested?.ratio || "").trim().replace("：", ":");
  const rawResolution = String(requested?.resolution || "").trim().toUpperCase();
  const resolution = rawResolution === "720P" || rawResolution === "1080P" ? "1K" : rawResolution;
  const base = { ...settings, imageFrameLocked: false };
  if (!imagePromptRatios.has(rawRatio) || !imagePromptResolutions.has(resolution)) return base;
  return {
    ...base,
    imageRatio: rawRatio,
    imageResolution: resolution,
    imageSize: computedImageSizeFor(rawRatio, resolution),
    imageFrameLocked: true
  };
}

function imageToolArgsWithFrameContract(args = {}, settings = {}) {
  const contract = imageFrameContractForSettings(settings);
  if (!contract.locked) return { ...args };
  const lockItem = (item) => item && typeof item === "object" && !Array.isArray(item)
    ? { ...item, ratio: contract.ratio, resolution: contract.resolution, size: contract.size }
    : item;
  return {
    ...args,
    ratio: contract.ratio,
    resolution: contract.resolution,
    size: contract.size,
    ...(Array.isArray(args.items)
      ? { items: args.items.map(lockItem) }
      : args.items && typeof args.items === "object"
        ? { items: lockItem(args.items) }
        : {})
  };
}

function normalizeImageToolFrame(args = {}, settings = {}) {
  const contract = imageFrameContractForSettings(settings);
  const ratio = contract.locked ? contract.ratio : normalizeImageRatio(args.ratio ?? settings.imageRatio, "1:1");
  const resolution = contract.locked
    ? contract.resolution
    : normalizeImagePromptResolution(args.resolution ?? settings.imageResolution, "1K");
  const model = args.model ?? settings?.imageModel ?? "gpt-image-2";
  const hasFramePreference = Boolean(args.ratio || args.resolution || settings.imageRatio || settings.imageResolution);
  const requestedSize = contract.locked
    ? contract.size
    : args.size ?? (hasFramePreference ? computedImageSizeFor(ratio, resolution) : settings?.imageSize ?? computedImageSizeFor(ratio, resolution));
  const size = isImage2Model(model) ? normalizeImage2Size(requestedSize, ratio, resolution) : String(requestedSize || "1024x1024");
  const requestSize = isImage2Model(model) ? image2SourceRequestSizeForDelivery(size) : size;
  return { ratio, resolution, size, requestSize };
}

function imageDeliverySpecification(frame = {}) {
  const ratio = normalizeImageRatio(frame.ratio, "1:1");
  const resolution = normalizeImagePromptResolution(frame.resolution, "1K");
  const parsedSize = parseImageSizeValue(frame.size) || parseImageSizeValue(computedImageSizeFor(ratio, resolution));
  const pixels = parsedSize ? `${parsedSize.width}×${parsedSize.height}` : computedImageSizeFor(ratio, resolution).replace("x", "×");
  return [
    `交付规格：画面比例 ${ratio}，清晰度 ${resolution}，最终像素 ${pixels}。`,
    "必须按该画幅构图，主体和关键内容完整位于安全区；不得拉伸画面，也不要把这段规格文字绘制到图片中。"
  ].join("\n");
}

function appendImageDeliverySpecification(prompt = "", frame = {}) {
  const source = String(prompt || "").trim();
  const specification = imageDeliverySpecification(frame);
  if (!source) return specification;
  return source.includes(specification) ? source : `${source}\n\n${specification}`;
}

function validateImageFrameFields(args = {}, label = "image_gen") {
  if (args.ratio !== undefined && args.ratio !== null && String(args.ratio).trim()) {
    const parsed = parseImageRatioValue(args.ratio);
    if (!parsed || !imagePromptRatios.has(parsed.ratio)) {
      throw new Error(`${label} ratio=${String(args.ratio)} 不受支持。请使用 schema 中列出的画面比例。`);
    }
  }
  if (args.resolution !== undefined && args.resolution !== null && String(args.resolution).trim()) {
    const resolution = String(args.resolution).trim().toUpperCase();
    if (!imagePromptResolutions.has(resolution) && !legacyImagePromptResolutions.has(resolution)) {
      throw new Error(`${label} resolution=${String(args.resolution)} 不受支持。请使用 1K、2K 或 4K。`);
    }
  }
  if (args.quality !== undefined && args.quality !== null && String(args.quality).trim()) {
    const quality = String(args.quality).trim();
    if (!imagePromptQualities.has(quality)) {
      throw new Error(`${label} quality=${quality} 不受支持。请使用 low、medium、high 或 auto。`);
    }
  }
  if (args.size !== undefined && args.size !== null && String(args.size).trim() && !parseImageSizeValue(args.size)) {
    throw new Error(`${label} size=${String(args.size)} 格式无效。请使用 WIDTHxHEIGHT。`);
  }
}

module.exports = {
  appendImageDeliverySpecification,
  computedImageSizeFor,
  freezeImageFrameSettings,
  imageDeliverySpecification,
  imageFrameContractForSettings,
  imagePromptQualities,
  imagePromptRatios,
  imagePromptResolutions,
  imageToolArgsWithFrameContract,
  normalizeImage2Size,
  normalizeImagePromptResolution,
  normalizeImageToolFrame,
  parseImageRatioValue,
  parseImageSizeValue,
  validateImageFrameFields
};
