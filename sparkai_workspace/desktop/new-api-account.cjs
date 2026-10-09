"use strict";

// Stock New API user-facing DTOs. Keep upstream `other` and credentials in Main.
function safeAccountText(value, limit = 220) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[敏感信息已隐藏]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|relay[_-]?token|token|session(?:id)?|cookie|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1[敏感信息已隐藏]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [敏感信息已隐藏]")
    .replace(/https?:\/\/[^\s<>]+/gi, "[链接已隐藏]")
    .replace(/[A-Za-z]:[\\/][^\s<>]+/g, "[路径已隐藏]")
    .trim().slice(0, limit);
}

function quotaValue(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? Math.trunc(number) : undefined;
}

function count(value) {
  const number = quotaValue(value);
  return number === undefined ? undefined : Math.max(0, number);
}

function accountQuotaPolicy(payload = {}) {
  const data = payload?.data ?? payload;
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
  const quotaPerUnit = positive(data.quota_per_unit);
  const displayType = ["USD", "CNY", "TOKENS", "CUSTOM"].includes(data.quota_display_type)
    ? data.quota_display_type : data.display_in_currency === false ? "TOKENS" : data.display_in_currency === true ? "USD" : undefined;
  const exchangeRate = displayType === "CNY" ? positive(data.usd_exchange_rate)
    : displayType === "CUSTOM" ? positive(data.custom_currency_exchange_rate) : 1;
  return {
    quotaPerUnit,
    displayType,
    exchangeRate,
    usdToCnyRate: positive(data.usd_exchange_rate),
    symbol: displayType === "CNY" ? "￥" : displayType === "CUSTOM" ? safeAccountText(data.custom_currency_symbol || "¤", 12) : "$"
  };
}

function quotaDisplay(rawQuota, policy = {}) {
  if (rawQuota === undefined) return "待同步";
  if (!policy.displayType || policy.displayType === "TOKENS" || !policy.quotaPerUnit || !policy.exchangeRate) {
    return `${rawQuota.toLocaleString("zh-CN")} quota`;
  }
  return `${policy.symbol}${(rawQuota / policy.quotaPerUnit * policy.exchangeRate).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function normalizeNewApiUser(userData = {}, policy = {}) {
  const username = safeAccountText(userData.username || userData.email || userData.id, 120);
  const quota = quotaValue(userData.quota ?? userData.remain_quota);
  const cny = policy.quotaPerUnit && policy.usdToCnyRate && quota !== undefined ? quota / policy.quotaPerUnit * policy.usdToCnyRate : 0;
  return {
    id: String(userData.id || ""),
    email: safeAccountText(userData.email || username, 120),
    username, account: username,
    name: safeAccountText(userData.displayName || userData.display_name || userData.name || username || "SparkAI 用户", 120),
    balanceCents: Math.round(cny * 100),
    createdAt: userData.createdAt
  };
}

function walletFromNewApiUser(userData = {}, policy = {}) {
  const user = normalizeNewApiUser(userData, policy);
  const balanceQuota = quotaValue(userData.quota ?? userData.remain_quota);
  const usedQuota = count(userData.used_quota);
  return {
    nativeQuota: true,
    balanceCents: user.balanceCents, balanceYuan: user.balanceCents / 100,
    // There is no fixed per-image price in stock New API; legacy field is never a quote.
    imageCostCents: 0, imageCostYuan: 0,
    balanceQuota, usedQuota, requestCount: count(userData.request_count),
    balanceDisplay: quotaDisplay(balanceQuota, policy), usedDisplay: quotaDisplay(usedQuota, policy),
    group: safeAccountText(userData.group, 120),
    quotaPolicy: policy
  };
}

function normalizeLogQuery(payload = {}) {
  const bounded = (value, fallback, max) => Math.max(1, Math.min(max, count(value) || fallback));
  const type = count(payload.type) || 0;
  const query = {
    page: bounded(payload.page, 1, 1_000_000), pageSize: bounded(payload.pageSize, 20, 100),
    type: type <= 7 ? type : 0,
    model: String(payload.model || "").trim().slice(0, 160),
    tokenName: String(payload.tokenName || "").trim().slice(0, 50),
    group: String(payload.group || "").trim().slice(0, 120),
    requestId: String(payload.requestId || "").trim().slice(0, 120),
    startTime: count(payload.startTime) || 0, endTime: count(payload.endTime) || 0
  };
  if (query.startTime && query.endTime && query.startTime > query.endTime) throw new Error("日志开始时间不能晚于结束时间。");
  return query;
}

function userLogsEndpoint(query) {
  const parameters = new URLSearchParams({ p: String(query.page), page_size: String(query.pageSize), type: String(query.type) });
  for (const [name, value] of Object.entries({ model_name: query.model, token_name: query.tokenName, group: query.group, request_id: query.requestId, start_timestamp: query.startTime, end_timestamp: query.endTime })) {
    if (value) parameters.set(name, String(value));
  }
  return `/api/log/self?${parameters}`;
}

function mapNewApiLogEntry(entry = {}, policy = {}) {
  const timestamp = entry.created_at ?? entry.createdAt;
  const date = new Date(Number.isFinite(Number(timestamp)) ? Number(timestamp) * 1000 : timestamp);
  const quota = quotaValue(entry.quota);
  return {
    id: safeAccountText(entry.id, 100),
    type: ({ 1: "topup", 2: "consume", 3: "manage", 4: "system", 5: "error", 6: "refund", 7: "login" })[entry.type] || "log",
    createdAt: Number.isFinite(date.getTime()) ? date.toISOString() : "",
    detail: {
      message: safeAccountText(entry.content), model: safeAccountText(entry.model_name || entry.modelName, 160),
      tokenName: safeAccountText(entry.token_name, 50), group: safeAccountText(entry.group, 120),
      requestId: safeAccountText(entry.request_id, 120), quota, quotaDisplay: quotaDisplay(quota, policy),
      promptTokens: count(entry.prompt_tokens), completionTokens: count(entry.completion_tokens),
      responseTimeMs: count(entry.use_time) === undefined ? undefined : count(entry.use_time) * 1000,
      stream: entry.is_stream === true
    }
  };
}

function createNewApiAccountService({ newApiRequest, newApiUserAuthHeaders, requireNewApiSession, resolveNewApiBaseUrl, getNewApiAuthEpoch }) {
  const policies = new Map();
  async function policy(settings, { preferCached = false } = {}) {
    const key = resolveNewApiBaseUrl(settings, "account");
    const cached = policies.get(key);
    if (preferCached) return cached?.value || {};
    if (cached && Date.now() - cached.at < 15 * 60_000) return cached.value;
    try {
      const response = await newApiRequest(settings, "/api/status", { retries: 0 });
      const value = accountQuotaPolicy(response);
      policies.set(key, { at: Date.now(), value });
      if (policies.size > 8) policies.delete(policies.keys().next().value);
      return value;
    } catch {
      return cached?.value || {};
    }
  }
  async function summary(settings, userData, options) {
    const quotaPolicy = await policy(settings, options);
    return { user: normalizeNewApiUser(userData, quotaPolicy), wallet: walletFromNewApiUser(userData, quotaPolicy) };
  }
  async function logs(settings, payload = {}) {
    requireNewApiSession(settings);
    const epoch = getNewApiAuthEpoch();
    const query = normalizeLogQuery(payload);
    const [response, quotaPolicy] = await Promise.all([
      newApiRequest(settings, userLogsEndpoint(query), { headers: newApiUserAuthHeaders(settings), userAuth: true }), policy(settings)
    ]);
    if (epoch !== getNewApiAuthEpoch()) return { ok: false, stale: true, logs: [], error: "登录账户已切换，请重新加载日志。" };
    const data = response?.data ?? response;
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    const total = count(data?.total);
    return {
      ok: true, logs: items.slice(0, query.pageSize).map((entry) => mapNewApiLogEntry(entry, quotaPolicy)),
      page: query.page, pageSize: query.pageSize, total: total ?? items.length,
      hasMore: total === undefined ? items.length >= query.pageSize : query.page * query.pageSize < total
    };
  }
  return { logs, policy, summary };
}

module.exports = { accountQuotaPolicy, createNewApiAccountService, mapNewApiLogEntry, normalizeLogQuery, normalizeNewApiUser, quotaDisplay, safeAccountText, userLogsEndpoint, walletFromNewApiUser };
