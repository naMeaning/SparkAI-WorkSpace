// Credential-free request preferences carried by the existing frozen TaskScope.
import { normalizeComfyUiTaskOptions } from "./comfyui-options.mjs";

function comfySnapshot(value) {
  if (!value || !value.connectionId) return undefined;
  const fields = ["connectionId", "workflowId", "templateId", "templateHash", "checkpoint", "seed", "width", "height", "negativePrompt", "steps", "cfg", "sampler", "scheduler", "denoise", "strength"];
  try { return normalizeComfyUiTaskOptions(Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]))); }
  catch { return undefined; }
}

export function imageConfigSnapshot(settings = {}) {
  const text = value => String(value || "").trim().slice(0, 180);
  const list = value => Array.isArray(value) ? value : [];
  const capabilities = value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const result = {};
    for (const key of ["generate", "edit", "referenceImages", "multiReferenceImages", "mask", "multipleOutputs", "transparentBackground"])
      if (typeof value[key] === "boolean") result[key] = value[key];
    if (Number.isFinite(value.maxReferenceImages)) result.maxReferenceImages = Math.max(0, Math.min(200, Math.floor(value.maxReferenceImages)));
    for (const key of ["supportedAspectRatios", "supportedResolutions", "supportedQualities", "outputFormats"])
      if (Array.isArray(value[key])) result[key] = list(value[key]).slice(0, 80).filter(item => typeof item === "string" && /^[\w:.-]{1,32}$/.test(item));
    return result;
  };
  const model = settings.imageProvider === "comfyui" ? text(settings.comfyui?.checkpoint) || "comfyui-mask" : text(settings.imageModel);
  const models = [model, ...(settings.imageProvider === "comfyui" ? [] : list(settings.imageModelPool))].map(text).filter(Boolean)
    .filter((item, index, values) => values.findIndex(value => value.toLowerCase() === item.toLowerCase()) === index);
  const matchModel = (items, selected) => list(items).find(item => item && text(item.model || item.id).toLowerCase() === selected.toLowerCase());
  const boundedNumber = (value, fallback, minimum, maximum) => Number.isFinite(Number(value))
    ? Math.max(minimum, Math.min(maximum, Math.floor(Number(value)))) : fallback;
  const configs = models.flatMap(selected => {
    const item = matchModel(settings.imageModelConfigs, selected);
    return item ? [{
      model: selected, protocol: text(item.protocol), gateway: text(item.gateway), transportMode: text(item.transportMode),
      pollIntervalMs: boundedNumber(item.pollIntervalMs, 2_500, 100, 30_000),
      maxWaitMs: boundedNumber(item.maxWaitMs, 600_000, 5_000, 1_800_000),
      capabilities: capabilities(item.capabilities)
    }] : [];
  });
  const comfyui = settings.imageProvider === "comfyui" ? comfySnapshot(settings.comfyui) : undefined;
  return { ...(settings.imageProvider === "comfyui" ? { provider: "comfyui", ...(comfyui ? { comfyui } : {}) } : {}),
    model, models, ratio: text(settings.imageRatio) || "1:1", resolution: text(settings.imageResolution) || "1K",
    quality: text(settings.imageQuality) || "auto", count: boundedNumber(settings.imageCount, 1, 1, 200),
    outputFormat: ["png", "jpeg", "webp"].includes(settings.imageOutputFormat) ? settings.imageOutputFormat : "png", configs,
    bindings: models.flatMap(selected => {
      const item = matchModel(settings.imageModelBindings, selected);
      return item ? [{ model: selected, protocol: text(item.protocol), gateway: text(item.gateway), transportMode: text(item.transportMode) }] : [];
    }) };
}

export function settingsWithImageConfig(settings = {}, snapshot) {
  if (!snapshot) return settings;
  const clean = imageConfigSnapshot({ imageModel: snapshot.model, imageModelPool: snapshot.models, imageRatio: snapshot.ratio,
    imageProvider: snapshot.provider, comfyui: snapshot.comfyui,
    imageResolution: snapshot.resolution, imageQuality: snapshot.quality, imageCount: snapshot.count,
    imageOutputFormat: snapshot.outputFormat, imageModelConfigs: snapshot.configs, imageModelBindings: snapshot.bindings });
  return { ...settings, imageProvider: clean.provider, comfyui: clean.comfyui, imageModel: clean.model, imageModelPool: clean.models, imageRatio: clean.ratio,
    imageResolution: clean.resolution, imageQuality: clean.quality, imageCount: clean.count, imageOutputFormat: clean.outputFormat,
    imageModelConfigs: clean.configs.map(config => ({ ...(settings.imageModelConfigs || []).find(item => String(item?.model || item?.id || "").trim().toLowerCase() === config.model.toLowerCase()), ...config })),
    imageModelBindings: clean.bindings.map(binding => ({ ...(settings.imageModelBindings || []).find(item => String(item?.model || "").trim().toLowerCase() === binding.model.toLowerCase()), ...binding })) };
}

export function normalizeImageConfigSnapshot(snapshot) {
  return snapshot && typeof snapshot === "object" ? imageConfigSnapshot(settingsWithImageConfig({}, snapshot)) : undefined;
}
