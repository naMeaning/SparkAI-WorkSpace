"use strict";

const IMAGE_PROTOCOLS = Object.freeze(["openai-images", "xai-images", "gemini-native"]);
const IMAGE_GATEWAYS = Object.freeze(["newapi", "sub2api", "direct"]);
const IMAGE_MODES = Object.freeze(["generate", "edit"]);
const IMAGE_TRANSPORT_MODES = Object.freeze(["sync", "async"]);

const GENERIC_CAPABILITIES = Object.freeze({
  generate: true,
  edit: false,
  referenceImages: false,
  multiReferenceImages: false,
  mask: false,
  multipleOutputs: false,
  supportedAspectRatios: [],
  supportedResolutions: [],
  supportedQualities: [],
  transparentBackground: false,
  outputFormats: ["png", "jpeg", "webp"]
});

// Presets are explicit configuration data, not model-name heuristics. Unknown
// models intentionally use the conservative OpenAI-compatible fallback.
const IMAGE_MODEL_PRESETS = Object.freeze({
  "gpt-image-2": {
    provider: "openai",
    protocol: "openai-images",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: true,
      multipleOutputs: true,
      supportedQualities: ["auto", "low", "medium", "high"],
      transparentBackground: true,
      outputFormats: ["png", "jpeg", "webp"]
    }
  },
  "gpt-image-1.5": {
    provider: "openai",
    protocol: "openai-images",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: true,
      multipleOutputs: true,
      supportedQualities: ["auto", "low", "medium", "high"],
      transparentBackground: true,
      outputFormats: ["png", "jpeg", "webp"]
    }
  },
  "gpt-image-1": {
    provider: "openai",
    protocol: "openai-images",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: true,
      multipleOutputs: true,
      supportedQualities: ["auto", "low", "medium", "high"],
      transparentBackground: true,
      outputFormats: ["png", "jpeg", "webp"]
    }
  },
  "grok-imagine-image-2.0": {
    provider: "xai",
    protocol: "xai-images",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: false,
      multipleOutputs: true,
      supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      supportedResolutions: ["1K", "2K"],
      supportedQualities: ["auto", "standard", "high"],
      outputFormats: ["png", "jpeg", "webp"]
    }
  },
  "gemini-3.1-flash-image": {
    provider: "google",
    protocol: "gemini-native",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: false,
      multipleOutputs: false,
      supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportedResolutions: ["1K", "2K", "4K"],
      outputFormats: ["png", "jpeg", "webp"]
    }
  },
  "gemini-3.1-flash-lite-image": {
    provider: "google",
    protocol: "gemini-native",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: false,
      multipleOutputs: false,
      supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportedResolutions: ["1K", "2K"],
      outputFormats: ["png", "jpeg", "webp"]
    }
  },
  "gemini-3-pro-image": {
    provider: "google",
    protocol: "gemini-native",
    capabilities: {
      generate: true,
      edit: true,
      referenceImages: true,
      multiReferenceImages: true,
      mask: false,
      multipleOutputs: false,
      supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportedResolutions: ["1K", "2K", "4K"],
      outputFormats: ["png", "jpeg", "webp"]
    }
  }
});

function cleanString(value, maximum = 4096) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maximum);
}

function normalizeBaseUrl(value, fallback = "") {
  const normalized = cleanString(value, 2048).replace(/\/+$/, "");
  return normalized || cleanString(fallback, 2048).replace(/\/+$/, "");
}

function joinApiUrl(baseUrl, endpoint) {
  const base = normalizeBaseUrl(baseUrl);
  const path = `/${String(endpoint || "").replace(/^\/+/, "")}`;
  if (!base) throw new Error("图片服务 Base URL 尚未配置。");
  // A gateway configured as https://host/v1 must not become /v1/v1/…;
  // the same rule applies to Gemini's /v1beta path.
  if (/\/v1$/i.test(base) && /^\/v1(?:beta)?(?:\/|$)/i.test(path)) {
    return `${base}${path.slice(3)}`;
  }
  if (/\/v1beta$/i.test(base) && /^\/v1beta(?:\/|$)/i.test(path)) {
    return `${base}${path.slice(6)}`;
  }
  return `${base}${path}`;
}

function normalizeCapabilities(value, fallback = GENERIC_CAPABILITIES) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : GENERIC_CAPABILITIES;
  const list = (candidate, inherited) => {
    if (!Array.isArray(candidate)) return Array.isArray(inherited) ? [...inherited] : [];
    return [...new Set(candidate.map((item) => cleanString(item, 80)).filter(Boolean))];
  };
  return {
    generate: source.generate === undefined ? Boolean(base.generate) : source.generate === true,
    edit: source.edit === undefined ? Boolean(base.edit) : source.edit === true,
    referenceImages: source.referenceImages === undefined ? Boolean(base.referenceImages) : source.referenceImages === true,
    multiReferenceImages: source.multiReferenceImages === undefined ? Boolean(base.multiReferenceImages) : source.multiReferenceImages === true,
    mask: source.mask === undefined ? Boolean(base.mask) : source.mask === true,
    maxReferenceImages: Number.isFinite(Number(source.maxReferenceImages))
      ? Math.max(1, Math.min(32, Math.floor(Number(source.maxReferenceImages))))
      : Number.isFinite(Number(base.maxReferenceImages))
        ? Math.max(1, Math.min(32, Math.floor(Number(base.maxReferenceImages))))
        : undefined,
    supportedAspectRatios: list(source.supportedAspectRatios, base.supportedAspectRatios),
    supportedResolutions: list(source.supportedResolutions, base.supportedResolutions),
    supportedQualities: list(source.supportedQualities, base.supportedQualities),
    transparentBackground: source.transparentBackground === undefined
      ? Boolean(base.transparentBackground)
      : source.transparentBackground === true,
    multipleOutputs: source.multipleOutputs === undefined ? Boolean(base.multipleOutputs) : source.multipleOutputs === true,
    outputFormats: list(source.outputFormats, base.outputFormats)
  };
}

function presetForModel(model) {
  const key = cleanString(model, 180).toLowerCase();
  const preset = IMAGE_MODEL_PRESETS[key];
  if (!preset) return { provider: "custom", protocol: "openai-images", capabilities: GENERIC_CAPABILITIES };
  return {
    provider: preset.provider,
    protocol: preset.protocol,
    capabilities: normalizeCapabilities(preset.capabilities)
  };
}

function normalizeProtocol(value, fallback = "openai-images") {
  const normalized = cleanString(value, 64).toLowerCase();
  return IMAGE_PROTOCOLS.includes(normalized) ? normalized : fallback;
}

function normalizeGateway(value, fallback = "newapi") {
  const normalized = cleanString(value, 64).toLowerCase();
  return IMAGE_GATEWAYS.includes(normalized) ? normalized : fallback;
}

function normalizeTransportMode(value, fallback = "sync") {
  const normalized = cleanString(value, 32).toLowerCase();
  return IMAGE_TRANSPORT_MODES.includes(normalized) ? normalized : fallback;
}

function providerForProtocol(protocol, fallback = "custom") {
  if (protocol === "openai-images") return "openai";
  if (protocol === "xai-images") return "xai";
  if (protocol === "gemini-native") return "google";
  return fallback;
}

function bindingFor(settings, model) {
  const key = cleanString(model, 180).toLowerCase();
  const bindings = Array.isArray(settings?.imageModelBindings) ? settings.imageModelBindings : [];
  return bindings.find((item) => cleanString(item?.model, 180).toLowerCase() === key) || null;
}

function configOverrideFor(settings, model) {
  const key = cleanString(model, 180).toLowerCase();
  const configs = Array.isArray(settings?.imageModelConfigs) ? settings.imageModelConfigs : [];
  return configs.find((item) => cleanString(item?.model || item?.id, 180).toLowerCase() === key) || null;
}

function resolveImageModelConfig(settings = {}, model = "") {
  const resolvedModel = cleanString(model || settings.imageModel || "gpt-image-2", 180);
  const preset = presetForModel(resolvedModel);
  const override = configOverrideFor(settings, resolvedModel) || {};
  const binding = bindingFor(settings, resolvedModel) || {};
  const protocol = normalizeProtocol(override.protocol || binding.protocol, preset.protocol);
  const provider = cleanString(override.provider || binding.provider, 64) || providerForProtocol(protocol, preset.provider);
  const defaultGateway = String(settings.accessMode || "account").toLowerCase() === "account" ? "newapi" : "direct";
  return {
    id: cleanString(override.id || resolvedModel, 180),
    model: resolvedModel,
    displayName: cleanString(override.displayName || override.name || resolvedModel, 180),
    provider,
    protocol,
    gateway: normalizeGateway(override.gateway || binding.gateway, defaultGateway),
    transportMode: normalizeTransportMode(override.transportMode || binding.transportMode, "sync"),
    pollIntervalMs: Number.isFinite(Number(override.pollIntervalMs))
      ? Math.max(100, Math.min(30_000, Math.floor(Number(override.pollIntervalMs))))
      : 2_500,
    maxWaitMs: Number.isFinite(Number(override.maxWaitMs))
      ? Math.max(5_000, Math.min(30 * 60_000, Math.floor(Number(override.maxWaitMs))))
      : 10 * 60_000,
    baseUrl: normalizeBaseUrl(override.baseUrl || binding.customBaseUrl || ""),
    apiKey: cleanString(override.apiKey || binding.customApiKey, 8192),
    accountTokenId: cleanString(override.accountTokenId || binding.accountTokenId, 64),
    capabilities: normalizeCapabilities(override.capabilities, preset.capabilities)
  };
}

function normalizeImageInput(value, fallbackName = "image.png") {
  if (!value) return null;
  if (typeof value === "string") return { path: value, name: fallbackName, mimeType: "image/png" };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const path = cleanString(value.path || value.imagePath || value.file, 4096);
  const dataUrl = cleanString(value.dataUrl || value.dataURL, 64 * 1024 * 1024);
  const url = cleanString(value.url || value.assetUrl, 8192);
  if (!path && !dataUrl && !url) return null;
  return {
    path: path || undefined,
    dataUrl: dataUrl || undefined,
    url: url || undefined,
    name: cleanString(value.name || value.originalName || fallbackName, 180) || fallbackName,
    mimeType: cleanString(value.mimeType || "image/png", 120) || "image/png",
    role: cleanString(value.role, 80) || undefined,
    purpose: cleanString(value.purpose, 320) || undefined
  };
}

function normalizeImageGenerationRequest(payload = {}, config = resolveImageModelConfig({}, payload.model)) {
  const mode = IMAGE_MODES.includes(String(payload.mode || "generate").toLowerCase())
    ? String(payload.mode || "generate").toLowerCase()
    : "generate";
  const references = (Array.isArray(payload.referenceImages) ? payload.referenceImages : [])
    .map((item, index) => normalizeImageInput(item, `reference-${index + 1}.png`))
    .filter(Boolean);
  const editImage = normalizeImageInput(payload.editImage, "source.png");
  const mask = normalizeImageInput(payload.mask || payload.maskImage, "mask.png");
  const requestedCount = Number(payload.n ?? payload.count ?? 1);
  return {
    model: config.model,
    prompt: cleanString(payload.prompt, 100_000),
    mode,
    images: references,
    editImage,
    mask,
    n: Number.isFinite(requestedCount) ? Math.max(1, Math.min(16, Math.floor(requestedCount))) : 1,
    aspectRatio: cleanString(payload.aspectRatio || payload.ratio, 32) || undefined,
    width: Number.isFinite(Number(payload.width)) ? Math.max(1, Math.floor(Number(payload.width))) : undefined,
    height: Number.isFinite(Number(payload.height)) ? Math.max(1, Math.floor(Number(payload.height))) : undefined,
    size: cleanString(payload.size, 32) || undefined,
    resolution: cleanString(payload.resolution, 32) || undefined,
    quality: cleanString(payload.quality, 64) || undefined,
    background: cleanString(payload.background, 64) || undefined,
    outputFormat: cleanString(payload.outputFormat || payload.output_format, 16).toLowerCase() || undefined,
    responseFormat: cleanString(payload.responseFormat || payload.response_format, 32).toLowerCase() || undefined,
    outputCompression: payload.outputCompression ?? payload.output_compression,
    signal: payload.signal,
    runId: cleanString(payload.runId, 180) || undefined,
    operationId: cleanString(payload.operationId, 180) || undefined,
    onPartialImage: payload.onPartialImage,
    onRetry: payload.onRetry,
    onStatus: payload.onStatus,
    onAccepted: payload.onAccepted
  };
}

function validateImageGenerationRequest(request, config) {
  if (!request.prompt) throw Object.assign(new Error("生图提示词不能为空。"), { code: "IMAGE_INVALID_INPUT", errorCategory: "invalid_input" });
  const capabilities = config.capabilities;
  if (request.mode === "generate" && !capabilities.generate) {
    throw Object.assign(new Error("当前模型不支持文生图。"), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  if (request.mode === "edit" && !capabilities.edit) {
    throw Object.assign(new Error("当前模型不支持图像编辑。"), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  if (request.images.length && !capabilities.referenceImages) {
    throw Object.assign(new Error("当前模型不支持参考图。"), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  if (request.images.length > 1 && !capabilities.multiReferenceImages) {
    throw Object.assign(new Error("当前模型不支持多张参考图。"), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  if (request.mask && !capabilities.mask) {
    throw Object.assign(new Error("当前模型不支持蒙版编辑。"), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  if (request.n > 1 && !capabilities.multipleOutputs) {
    request.n = 1;
  }
  if (request.aspectRatio && capabilities.supportedAspectRatios.length && !capabilities.supportedAspectRatios.includes(request.aspectRatio)) {
    throw Object.assign(new Error(`当前模型不支持画幅 ${request.aspectRatio}。`), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  if (request.resolution && capabilities.supportedResolutions.length && !capabilities.supportedResolutions.includes(request.resolution)) {
    throw Object.assign(new Error(`当前模型不支持分辨率 ${request.resolution}。`), { code: "IMAGE_UNSUPPORTED_PARAMETER", errorCategory: "unsupported_parameter" });
  }
  return request;
}

module.exports = {
  GENERIC_CAPABILITIES,
  IMAGE_GATEWAYS,
  IMAGE_MODEL_PRESETS,
  IMAGE_MODES,
  IMAGE_PROTOCOLS,
  IMAGE_TRANSPORT_MODES,
  cleanString,
  joinApiUrl,
  normalizeBaseUrl,
  normalizeCapabilities,
  normalizeImageGenerationRequest,
  normalizeImageInput,
  normalizeGateway,
  normalizeProtocol,
  normalizeTransportMode,
  providerForProtocol,
  resolveImageModelConfig,
  validateImageGenerationRequest
};
