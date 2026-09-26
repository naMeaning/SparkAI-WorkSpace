"use strict";

const ERROR_CATEGORIES = Object.freeze([
  "AUTH_ERROR",
  "INSUFFICIENT_BALANCE",
  "MODEL_NOT_FOUND",
  "UNSUPPORTED_PARAMETER",
  "CONTENT_POLICY",
  "RATE_LIMIT",
  "UPSTREAM_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "TASK_FAILED",
  "INVALID_RESPONSE"
]);

function categoryFor(status, message, code = "") {
  const value = String(message || "").toLowerCase();
  const normalizedCode = String(code || "").toLowerCase();
  const numeric = Number(status);
  if (normalizedCode.includes("timeout") || value.includes("timeout") || value.includes("timed out")) return "TIMEOUT";
  if (normalizedCode.includes("network") || /econn|socket|fetch failed|network/.test(value)) return "NETWORK_ERROR";
  if ([401, 403].includes(numeric) || /unauthor|invalid api key|authentication/.test(value)) return "AUTH_ERROR";
  if ([402].includes(numeric) || /insufficient|quota|balance|credit/.test(value)) return "INSUFFICIENT_BALANCE";
  if ([404].includes(numeric) || /model.*(not found|不存在)|unknown model/.test(value)) return "MODEL_NOT_FOUND";
  if ([409, 429].includes(numeric) || /rate.?limit|too many requests/.test(value)) return "RATE_LIMIT";
  if ([400, 422].includes(numeric) || /unsupported|invalid parameter|not support/.test(value)) return "UNSUPPORTED_PARAMETER";
  if (/content policy|safety|moderation|policy/.test(value)) return "CONTENT_POLICY";
  if (normalizedCode.includes("task") || /task.*failed/.test(value)) return "TASK_FAILED";
  if (normalizedCode.includes("response") || /invalid json|no recognizable|empty response/.test(value)) return "INVALID_RESPONSE";
  if (numeric >= 500) return "UPSTREAM_ERROR";
  return "UPSTREAM_ERROR";
}

function normalizeImageGenerationError(error, context = {}) {
  const source = error instanceof Error ? error : new Error(String(error || "图片生成失败。"));
  const status = Number(source.status || source.statusCode || 0) || undefined;
  const message = String(source.message || "图片生成失败。").slice(0, 2_000);
  const normalized = new Error(message);
  normalized.name = "ImageGenerationError";
  normalized.code = source.code || `IMAGE_${categoryFor(status, message, source.code)}`;
  normalized.category = source.category || categoryFor(status, message, source.code);
  normalized.status = status;
  normalized.provider = context.provider || source.provider;
  normalized.protocol = context.protocol || source.protocol;
  normalized.gateway = context.gateway || source.gateway;
  normalized.model = context.model || source.model;
  normalized.requestId = source.requestId || source.request_id;
  normalized.taskId = source.taskId || source.task_id;
  normalized.ambiguous = source.ambiguous === true;
  normalized.unsafeToRetry = source.unsafeToRetry === true || normalized.ambiguous;
  normalized.cause = source;
  return normalized;
}

module.exports = { ERROR_CATEGORIES, categoryFor, normalizeImageGenerationError };
