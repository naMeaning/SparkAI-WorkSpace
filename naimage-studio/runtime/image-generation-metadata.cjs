"use strict";

const supportedOutputFormats = new Set(["png", "jpeg", "webp"]);

function cleanMetadataText(value, maximum = 180) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maximum) : undefined;
}

function normalizeOutputFormat(value) {
  const normalized = cleanMetadataText(value, 24)?.toLowerCase();
  if (normalized === "jpg") return "jpeg";
  return normalized && supportedOutputFormats.has(normalized) ? normalized : undefined;
}

function normalizeOutputCompression(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : undefined;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function parameterValue(source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return undefined;
}

function applyParameterSource(target, value, includeCreatedAt = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return target;
  const nested = value.actualParams ?? value.actual_params;
  if (nested && nested !== value) applyParameterSource(target, nested, includeCreatedAt);

  const textFields = [
    ["model", ["model"]],
    ["ratio", ["ratio", "aspectRatio", "aspect_ratio"]],
    ["resolution", ["resolution"]],
    ["size", ["size"]],
    ["quality", ["quality"]],
    ["background", ["background"]],
    ["moderation", ["moderation"]],
    ["inputFidelity", ["inputFidelity", "input_fidelity"]]
  ];
  for (const [targetKey, sourceKeys] of textFields) {
    const normalized = cleanMetadataText(parameterValue(value, ...sourceKeys), targetKey === "model" ? 180 : 80);
    if (normalized) target[targetKey] = normalized;
  }

  const outputFormat = normalizeOutputFormat(parameterValue(value, "outputFormat", "output_format", "format"));
  if (outputFormat) target.outputFormat = outputFormat;
  const outputCompression = normalizeOutputCompression(parameterValue(value, "outputCompression", "output_compression"));
  if (outputCompression !== undefined) target.outputCompression = outputCompression;
  if (includeCreatedAt) {
    const createdAt = normalizeTimestamp(parameterValue(value, "createdAt", "created_at", "created"));
    if (createdAt) target.createdAt = createdAt;
  }
  return target;
}

function normalizeImageGenerationParameters(value) {
  return applyParameterSource({}, value, false);
}

function pickImageGenerationResponseMetadata(...sources) {
  const normalized = {};
  for (const source of sources) applyParameterSource(normalized, source, true);
  return normalized;
}

function mergeImageGenerationResponseMetadata(...sources) {
  return pickImageGenerationResponseMetadata(...sources);
}

function normalizeImageAssetGenerationMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const request = normalizeImageGenerationParameters(value.request);
  const response = pickImageGenerationResponseMetadata(value.response);
  const startedAt = normalizeTimestamp(value.startedAt);
  const completedAt = normalizeTimestamp(value.completedAt);
  const rawDuration = Number(value.durationMs);
  const durationMs = Number.isFinite(rawDuration) && rawDuration >= 0
    ? Math.min(Math.round(rawDuration), 86_400_000)
    : undefined;
  if (!Object.keys(request).length && !Object.keys(response).length && !startedAt && !completedAt && durationMs === undefined) {
    return undefined;
  }
  return {
    version: 1,
    ...(Object.keys(request).length ? { request } : {}),
    ...(Object.keys(response).length ? { response } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs === undefined ? {} : { durationMs })
  };
}

function buildImageAssetGenerationMetadata(value = {}) {
  return normalizeImageAssetGenerationMetadata({
    version: 1,
    request: value.request,
    response: value.response,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    durationMs: value.durationMs
  });
}

module.exports = {
  buildImageAssetGenerationMetadata,
  mergeImageGenerationResponseMetadata,
  normalizeImageAssetGenerationMetadata,
  normalizeImageGenerationParameters,
  normalizeOutputFormat,
  pickImageGenerationResponseMetadata
};
