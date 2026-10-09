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
  "RESULT_DOWNLOAD_FAILED",
  "INVALID_RESPONSE"
]);

function normalizeImageResultDownloadError(error) {
  // Native HTTP multi-address failures can have an empty AggregateError.message.
  // Only expose bounded error codes/statuses; causes can contain signed URLs,
  // proxy credentials and private socket details.
  const codes = new Set();
  const seen = new Set();
  const pending = [error];
  const networkCode = /^(?:E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NETUNREACH|HOSTUNREACH|AI_AGAIN|NOTFOUND|PIPE|PROTO)|ABORT_ERR|UND_ERR_(?:CONNECT_TIMEOUT|SOCKET)|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS_CERT_ALTNAME_INVALID|NAIMAGE_REMOTE_[A-Z_]{1,60})$/;
  while (pending.length && seen.size < 24 && codes.size < 8) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const code = String(current.code || "");
    if (networkCode.test(code)) codes.add(code);
    const status = Number(current.status || current.statusCode);
    if (Number.isInteger(status) && status >= 100 && status <= 599) codes.add(`HTTP ${status}`);
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 8));
  }
  const reason = codes.has("NAIMAGE_REMOTE_ADDRESS_BLOCKED")
    ? "图片地址属于本机、私有或保留网络，已拒绝下载"
    : "图片下载连接失败";
  const detail = codes.size ? `${reason}；${[...codes].join(" / ")}` : reason;
  const normalized = new Error(`图片接口已返回结果，但下载成图失败（${detail}）。请检查图片地址或下载网络；不要重新生图，以免再次计费。`);
  normalized.name = "ImageGenerationError";
  normalized.code = "IMAGE_RESULT_DOWNLOAD_FAILED";
  normalized.category = "RESULT_DOWNLOAD_FAILED";
  normalized.errorCategory = "image_result_download";
  normalized.generationCompleted = true;
  normalized.unsafeToRetry = true;
  normalized.failureKind = "persistence";
  normalized.cause = error;
  return normalized;
}

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
  if (source.errorCategory) normalized.errorCategory = source.errorCategory;
  normalized.status = status;
  normalized.provider = context.provider || source.provider;
  normalized.protocol = context.protocol || source.protocol;
  normalized.gateway = context.gateway || source.gateway;
  normalized.model = context.model || source.model;
  normalized.requestId = source.requestId || source.request_id;
  normalized.taskId = source.taskId || source.task_id;
  normalized.ambiguous = source.ambiguous === true;
  normalized.unsafeToRetry = source.unsafeToRetry === true || normalized.ambiguous;
  normalized.generationCompleted = source.generationCompleted === true;
  normalized.cause = source;
  return normalized;
}

module.exports = { ERROR_CATEGORIES, categoryFor, normalizeImageGenerationError, normalizeImageResultDownloadError };
