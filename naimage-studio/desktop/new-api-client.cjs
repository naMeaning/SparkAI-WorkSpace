"use strict";

const { setTimeout: delay } = require("node:timers/promises");
const {
  mergeImageGenerationResponseMetadata,
  pickImageGenerationResponseMetadata
} = require("../runtime/image-generation-metadata.cjs");

const MANAGED_RELAY_PREFIX = "/naimage";

function createNewApiClient(options = {}) {
  const {
    defaultSettings,
    ensureLocalServer,
    isLocalServerUrl,
    log = () => {},
    migrateSettings,
    newApiTransportFetch,
    normalizeServerUrl,
    readJson,
    resolveAccountApiCredentials,
    settingsPath,
    writeJson
  } = options;

  const newApiRefreshInflight = new Map();

  function newApiAuthProtocol(settings) {
    const explicit = String(settings?.serverAuthProtocol || "").trim().toLowerCase();
    if (explicit === "bundle" || explicit === "legacy") return explicit;
    if (
      String(settings?.serverAccessToken || "").trim()
      || String(settings?.serverAuthSessionId || "").trim()
      || /^new_api_refresh=/i.test(String(settings?.serverSessionCookie || "").trim())
    ) return "bundle";
    return settings?.serverSessionCookie && settings?.serverUserId ? "legacy" : "";
  }

  function newApiUserAuthHeaders(settings) {
    const headers = {};
    if (newApiAuthProtocol(settings) === "bundle") {
      if (settings.serverAccessToken) headers.authorization = `Bearer ${String(settings.serverAccessToken).trim()}`;
    } else {
      if (settings.serverSessionCookie) headers.cookie = settings.serverSessionCookie;
      if (settings.serverUserId) headers["New-Api-User"] = String(settings.serverUserId);
    }
    if (settings.licenseDeviceId) headers["X-Naimage-Device-Id"] = String(settings.licenseDeviceId);
    if (settings.licenseToken) headers["X-Naimage-License"] = String(settings.licenseToken);
    return headers;
  }

  function mergeNewApiUserAuthHeaders(headers, settings) {
    const retained = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (["authorization", "cookie", "new-api-user"].includes(String(key).toLowerCase())) continue;
      retained[key] = value;
    }
    return { ...retained, ...newApiUserAuthHeaders(settings) };
  }

  function relayApiHeaders(headers, apiKey) {
    const retained = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (String(key).toLowerCase() === "authorization") continue;
      retained[key] = value;
    }
    return { ...retained, authorization: `Bearer ${apiKey}` };
  }

  function isCustomApiMode(settings) {
    return String(settings?.accessMode || "account").toLowerCase() === "custom";
  }

  function modelBinding(settings, provider, model) {
    const target = String(model || "").trim().toLowerCase();
    const bindings = provider === "image" ? settings?.imageModelBindings : settings?.agentModelBindings;
    if (!target || !Array.isArray(bindings)) return null;
    for (const value of bindings) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const bindingModel = String(value.model || "").trim();
      if (!bindingModel || bindingModel.toLowerCase() !== target) continue;
      const accountTokenId = /^\d+$/.test(String(value.accountTokenId || "").trim())
        && Number(value.accountTokenId) > 0
        ? String(value.accountTokenId).trim()
        : "";
      return {
        model: bindingModel,
        customBaseUrl: String(value.customBaseUrl || value.baseUrl || "").trim(),
        customApiKey: String(value.customApiKey || "").trim(),
        accountTokenId
      };
    }
    return null;
  }

  function imageModelBinding(settings, model) {
    return modelBinding(settings, "image", model);
  }

  function modelFromRequestBody(body) {
    if (!body || typeof body !== "object") return "";
    if (typeof body.get === "function") {
      const value = body.get("model");
      return typeof value === "string" ? value.trim() : "";
    }
    return String(body.model || "").trim();
  }

  function isImagesApiEndpoint(endpoint) {
    const path = String(endpoint || "").split(/[?#]/, 1)[0];
    return /(?:^|\/)images(?:\/|$)/i.test(path) || /(?:^|\/)image-tasks(?:\/|$)/i.test(path);
  }

  function modelBindingForRequest(settings, endpoint, body, provider) {
    if (provider === "image" && !isImagesApiEndpoint(endpoint)) return null;
    return modelBinding(settings, provider === "image" ? "image" : "agent", modelFromRequestBody(body));
  }

  function customApiCredentials(settings, provider = "agent", model = "") {
    const imageProvider = provider === "image";
    const binding = modelBinding(settings, imageProvider ? "image" : "agent", model);
    const baseUrl = normalizeServerUrl(
      imageProvider
        ? binding?.customBaseUrl || settings?.imageBaseUrl || settings?.agentBaseUrl
        : binding?.customBaseUrl || settings?.agentBaseUrl || settings?.imageBaseUrl,
      ""
    );
    const apiKey = String(imageProvider
      ? binding?.customApiKey || settings?.imageApiKey || settings?.agentApiKey
      : binding?.customApiKey || settings?.agentApiKey || settings?.imageApiKey).trim();
    if (!baseUrl) throw new Error(`${imageProvider ? "生图" : "Agent"} Base URL 尚未配置。`);
    parsedServiceBaseUrl(baseUrl, `${imageProvider ? "生图" : "Agent"} Base URL`);
    if (!apiKey) throw new Error(`${imageProvider ? "生图" : "Agent"} API Key 尚未配置。`);
    return { baseUrl, apiKey };
  }

  function customApiUrl(settings, endpoint, provider = "agent", model = "") {
    const { baseUrl } = customApiCredentials(settings, provider, model);
    return directApiUrl(baseUrl, endpoint);
  }

  function directApiUrl(baseUrl, endpoint) {
    const cleanEndpoint = String(endpoint || "").startsWith("/") ? String(endpoint || "") : `/${endpoint || ""}`;
    if (/\/v1$/i.test(baseUrl) && /^\/v1(?:\/|$)/i.test(cleanEndpoint)) {
      return `${baseUrl}${cleanEndpoint.slice(3) || ""}`;
    }
    return `${baseUrl}${cleanEndpoint}`;
  }

  async function accountApiCredentials(settings, tokenId = "") {
    requireNewApiSession(settings);
    if (typeof resolveAccountApiCredentials !== "function") throw new Error("账户密钥服务尚未就绪。");
    const credentials = await resolveAccountApiCredentials(settings, String(tokenId || "").trim() || undefined);
    const baseUrl = normalizeServerUrl(credentials?.baseUrl, "");
    const apiKey = String(credentials?.apiKey || "").trim();
    if (!baseUrl || !apiKey) throw new Error("所选账户密钥不可用，请在设置中重新选择。");
    parsedServiceBaseUrl(baseUrl, "账户模型 Base URL");
    return { ...credentials, baseUrl, apiKey };
  }

  function accountModelCustomCredentials(settings, binding) {
    const apiKey = String(binding?.customApiKey || "").trim();
    if (!apiKey) return null;
    requireNewApiSession(settings);
    const baseUrl = normalizeServerUrl(resolveNewApiBaseUrl(settings, "relay"), "");
    parsedServiceBaseUrl(baseUrl, "账户模型 Base URL");
    return { baseUrl, apiKey, model: binding?.model || "", source: "model-custom-key" };
  }

  async function relayApiCredentials(settings, endpoint, body, provider) {
    const binding = modelBindingForRequest(settings, endpoint, body, provider);
    if (isCustomApiMode(settings)) return customApiCredentials(settings, provider, binding?.model);
    return accountModelCustomCredentials(settings, binding)
      || accountApiCredentials(settings, binding?.accountTokenId);
  }

  function customApiHeaders(settings, provider = "agent", model = "") {
    const { apiKey } = customApiCredentials(settings, provider, model);
    return { authorization: `Bearer ${apiKey}` };
  }

  function parsedServiceBaseUrl(value, label) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${label}不是有效的 URL。`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label}只允许 HTTP 或 HTTPS 地址。`);
    }
    return parsed;
  }

  function isLoopbackServiceHost(hostname) {
    const value = String(hostname || "").toLowerCase();
    return value === "localhost" || value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value);
  }

  function resolveNewApiBaseUrl(settings, service = "account") {
    const accountBaseUrl = normalizeServerUrl(
      settings?.accountBaseUrl || settings?.serverUrl,
      defaultSettings.accountBaseUrl
    );
    const account = parsedServiceBaseUrl(accountBaseUrl, "账户服务地址");
    if (service === "account") return accountBaseUrl;
    if (service === "update") {
      const updateBaseUrl = normalizeServerUrl(settings?.updateBaseUrl, defaultSettings.updateBaseUrl);
      parsedServiceBaseUrl(updateBaseUrl, "更新服务地址");
      return updateBaseUrl;
    }
    if (service !== "relay") throw new Error(`未知的 New API 服务类型：${service}`);
    const explicitRelayBaseUrl = normalizeServerUrl(settings?.relayBaseUrl, "");
    if (!explicitRelayBaseUrl) return accountBaseUrl;
    const relay = parsedServiceBaseUrl(explicitRelayBaseUrl, "Relay 服务地址");
    if (relay.origin !== account.origin && relay.protocol !== "https:" && !isLoopbackServiceHost(relay.hostname)) {
      throw new Error("异源 Relay 服务必须使用 HTTPS 或 localhost/loopback 地址。");
    }
    return explicitRelayBaseUrl;
  }

  function sameNewApiOrigin(left, right) {
    try {
      return parsedServiceBaseUrl(left, "服务地址").origin === parsedServiceBaseUrl(right, "服务地址").origin;
    } catch {
      return false;
    }
  }

  function validateNewApiServiceSettings(settings) {
    resolveNewApiBaseUrl(settings, "account");
    resolveNewApiBaseUrl(settings, "relay");
    resolveNewApiBaseUrl(settings, "update");
    const proxyUrl = String(settings?.networkProxyUrl || "").trim();
    if (proxyUrl) parsedServiceBaseUrl(proxyUrl, "网络代理地址");
    return true;
  }
  
  function newApiUrl(settings, endpoint, service = "account") {
    const pathPart = String(endpoint || "").startsWith("/") ? String(endpoint || "") : `/${endpoint || ""}`;
    return `${resolveNewApiBaseUrl(settings, service)}${pathPart}`;
  }
  
  function parseJsonText(text) {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      const summary = String(text || "").replace(/\s+/g, " ").trim().slice(0, 4_096);
      return { error: summary || "服务器返回了无效 JSON。", parseFailed: true };
    }
  }
  
  function newApiErrorMessage(data, status) {
    const raw = (
      data?.error?.message ||
      data?.message ||
      data?.error ||
      data?.msg ||
      (status ? `New API ${status}` : "New API request failed")
    );
    const segments = String(raw || "")
      .split(/[,，]\s*/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments.filter((segment, index) => index === 0 || segment.toLowerCase() !== segments[index - 1].toLowerCase()).join("，");
  }
  
  function isNewApiAuthError(error) {
    const status = Number(error?.status);
    const code = String(error?.data?.code || error?.code || "").trim().toUpperCase();
    const message = String(error?.message || error || "");
    return status === 401
      || [
        "AUTH_TOKEN_EXPIRED",
        "AUTH_SESSION_REVOKED",
        "AUTH_UNAUTHORIZED",
        "AUTH_REFRESH_INVALID",
        "AUTH_ACCESS_TOKEN_INVALID"
      ].includes(code)
      || /invalid token|token expired|unauthorized|登录已失效|未登录|401/i.test(message);
  }

  function responseSetCookieValues(response) {
    const values = [];
    if (typeof response?.headers?.getSetCookie === "function") {
      values.push(...response.headers.getSetCookie());
    }
    const single = response?.headers?.get?.("set-cookie");
    if (single) values.push(single);
    return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
  }

  function extractNamedCookie(response, name) {
    const escapedName = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escapedName) return "";
    const pattern = new RegExp(`(?:^|,\\s*)(${escapedName}=[^;,\\s]+)`, "i");
    for (const value of responseSetCookieValues(response)) {
      const match = value.match(pattern);
      if (match) return match[1];
    }
    return "";
  }

  function extractSessionCookie(response) {
    return extractNamedCookie(response, "session");
  }

  function extractRefreshCookie(response) {
    return extractNamedCookie(response, "new_api_refresh");
  }

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function parseNewApiLoginAuth(response, data) {
    const payload = objectValue(data?.data);
    if (payload.require_2fa === true) {
      const error = new Error("该账号已启用两步验证，请先在 New API 网页完成登录验证。");
      error.code = "NEW_API_2FA_REQUIRED";
      error.data = data;
      throw error;
    }

    const accessToken = String(payload.access_token || "").trim();
    if (accessToken) {
      const tokenType = String(payload.token_type || "Bearer").trim();
      if (tokenType && !/^bearer$/i.test(tokenType)) {
        const error = new Error(`New API 返回了不支持的登录令牌类型：${tokenType}。`);
        error.code = "NEW_API_AUTH_PROTOCOL_UNSUPPORTED";
        throw error;
      }
      const user = objectValue(payload.user);
      const serverUserId = String(user.id || "").trim();
      const serverSessionCookie = extractRefreshCookie(response);
      const serverAuthSessionId = String(objectValue(payload.session).sid || "").trim();
      if (!serverUserId) throw new Error("New API 登录成功但没有返回 user id。");
      if (!serverSessionCookie) throw new Error("New API 登录成功但没有返回 refresh cookie。");
      if (!serverAuthSessionId) throw new Error("New API 登录成功但没有返回 auth session id。");
      return {
        protocol: "bundle",
        user,
        serverUserId,
        serverAccessToken: accessToken,
        serverAccessExpiresAt: Math.max(0, Math.floor(Number(payload.access_expires_at) || 0)),
        serverSessionCookie,
        serverAuthSessionId
      };
    }

    const user = payload;
    const serverUserId = String(user.id || "").trim();
    const serverSessionCookie = extractSessionCookie(response);
    if (!serverUserId) throw new Error("New API 登录成功但没有返回 user id。");
    if (!serverSessionCookie) throw new Error("New API 登录成功但没有返回 session cookie。");
    return {
      protocol: "legacy",
      user,
      serverUserId,
      serverAccessToken: "",
      serverAccessExpiresAt: 0,
      serverSessionCookie,
      serverAuthSessionId: ""
    };
  }

  function newApiAuthSnapshot(settings) {
    return {
      serverAuthProtocol: newApiAuthProtocol(settings),
      serverAccessToken: String(settings?.serverAccessToken || "").trim(),
      serverAccessExpiresAt: Math.max(0, Math.floor(Number(settings?.serverAccessExpiresAt) || 0)),
      serverSessionCookie: String(settings?.serverSessionCookie || "").trim(),
      serverAuthSessionId: String(settings?.serverAuthSessionId || "").trim(),
      serverUserId: String(settings?.serverUserId || "").trim()
    };
  }

  function applyNewApiAuthSnapshot(settings, snapshot) {
    if (!settings || typeof settings !== "object") return settings;
    Object.assign(settings, newApiAuthSnapshot(snapshot));
    return settings;
  }

  function newApiAccessRefreshNeeded(settings, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (newApiAuthProtocol(settings) !== "bundle") return false;
    if (!String(settings?.serverAccessToken || "").trim()) return true;
    const expiresAt = Math.max(0, Math.floor(Number(settings?.serverAccessExpiresAt) || 0));
    return expiresAt > 0 && expiresAt <= nowSeconds + 30;
  }

  function newApiAuthResponseFailure(response, data) {
    const status = Number(response?.status);
    const code = String(data?.code || data?.error?.code || "").trim().toUpperCase();
    const message = String(data?.message || data?.error?.message || data?.error || "");
    return status === 401
      || ["AUTH_TOKEN_EXPIRED", "AUTH_SESSION_REVOKED", "AUTH_UNAUTHORIZED", "AUTH_ACCESS_TOKEN_INVALID"].includes(code)
      || /invalid token|token expired|unauthorized|登录已失效|未登录/i.test(message);
  }

  function refreshRequestHeaders(settings) {
    const headers = {
      cookie: String(settings.serverSessionCookie || "").trim(),
      origin: parsedServiceBaseUrl(resolveNewApiBaseUrl(settings, "account"), "账户服务地址").origin
    };
    if (settings.serverAuthSessionId) headers["X-Auth-Session"] = String(settings.serverAuthSessionId);
    return headers;
  }

  function persistNewApiAuthBundle(settings, auth, expected = {}) {
    const accountBaseUrl = resolveNewApiBaseUrl(settings, "account");
    const stored = migrateSettings(readJson(settingsPath, defaultSettings));
    if (resolveNewApiBaseUrl(stored, "account").toLowerCase() !== accountBaseUrl.toLowerCase()) {
      const error = new Error("账户服务地址已切换，旧认证结果已丢弃。");
      error.code = "NEW_API_SESSION_CHANGED";
      throw error;
    }
    if (stored.serverUserId && String(stored.serverUserId) !== String(expected.serverUserId || auth.serverUserId)) {
      const error = new Error("登录账户已切换，旧认证结果已丢弃。");
      error.code = "NEW_API_SESSION_CHANGED";
      throw error;
    }
    const storedSnapshot = newApiAuthSnapshot(stored);
    const alreadyRotated = (
      expected.serverAccessToken
      && storedSnapshot.serverAccessToken
      && storedSnapshot.serverAccessToken !== expected.serverAccessToken
    ) || (
      expected.serverSessionCookie
      && storedSnapshot.serverSessionCookie
      && storedSnapshot.serverSessionCookie !== expected.serverSessionCookie
    );
    if (alreadyRotated && storedSnapshot.serverAuthProtocol === "bundle") {
      applyNewApiAuthSnapshot(settings, storedSnapshot);
      return stored;
    }
    const next = migrateSettings({
      ...stored,
      serverAuthProtocol: "bundle",
      serverAccessToken: auth.serverAccessToken,
      serverAccessExpiresAt: auth.serverAccessExpiresAt,
      serverSessionCookie: auth.serverSessionCookie,
      serverAuthSessionId: auth.serverAuthSessionId,
      serverUserId: auth.serverUserId
    });
    writeJson(settingsPath, next);
    applyNewApiAuthSnapshot(settings, next);
    return next;
  }

  async function refreshNewApiAuth(settings, options = {}) {
    if (newApiAuthProtocol(settings) !== "bundle") return settings;
    requireNewApiSession(settings);

    const stored = migrateSettings(readJson(settingsPath, defaultSettings));
    if (
      resolveNewApiBaseUrl(stored, "account").toLowerCase() === resolveNewApiBaseUrl(settings, "account").toLowerCase()
      && String(stored.serverUserId || "") === String(settings.serverUserId || "")
    ) {
      const storedSnapshot = newApiAuthSnapshot(stored);
      const callerSnapshot = newApiAuthSnapshot(settings);
      if (
        storedSnapshot.serverAuthProtocol === "bundle"
        && storedSnapshot.serverAccessToken
        && (
          storedSnapshot.serverAccessToken !== callerSnapshot.serverAccessToken
          || storedSnapshot.serverSessionCookie !== callerSnapshot.serverSessionCookie
        )
      ) {
        applyNewApiAuthSnapshot(settings, storedSnapshot);
        if (!newApiAccessRefreshNeeded(settings)) return settings;
      }
    }
    if (options.force !== true && !newApiAccessRefreshNeeded(settings)) return settings;

    const expected = newApiAuthSnapshot(settings);
    if (!expected.serverSessionCookie || !expected.serverAuthSessionId) {
      const error = new Error("New API 刷新会话不完整，请重新登录。");
      error.code = "NEW_API_SESSION_INVALID";
      throw error;
    }
    const refreshKey = [
      resolveNewApiBaseUrl(settings, "account").toLowerCase(),
      expected.serverUserId,
      expected.serverAuthSessionId
    ].join("|");
    if (newApiRefreshInflight.has(refreshKey)) {
      const next = await newApiRefreshInflight.get(refreshKey);
      applyNewApiAuthSnapshot(settings, next);
      return settings;
    }

    const task = (async () => {
      const { response, data } = await newApiFetch(settings, "/api/user/auth/refresh", {
        method: "POST",
        headers: refreshRequestHeaders(settings),
        timeoutMs: 20_000,
        retries: 0
      });
      if (!response.ok || data.parseFailed === true || data.error || data.success === false || data.ok === false) {
        const error = new Error(newApiErrorMessage(data, response.status));
        error.status = response.status;
        error.data = data;
        throw error;
      }
      const auth = parseNewApiLoginAuth(response, data);
      if (auth.protocol !== "bundle" || auth.serverUserId !== expected.serverUserId || auth.serverAuthSessionId !== expected.serverAuthSessionId) {
        const error = new Error("New API 刷新结果与当前登录会话不一致。");
        error.code = "NEW_API_SESSION_CHANGED";
        throw error;
      }
      return persistNewApiAuthBundle(settings, auth, expected);
    })();
    newApiRefreshInflight.set(refreshKey, task);
    try {
      const next = await task;
      applyNewApiAuthSnapshot(settings, next);
      return settings;
    } finally {
      if (newApiRefreshInflight.get(refreshKey) === task) newApiRefreshInflight.delete(refreshKey);
    }
  }

  async function logoutNewApiSession(settings) {
    requireNewApiSession(settings);
    if (newApiAuthProtocol(settings) !== "bundle") {
      return newApiRequest(settings, "/api/user/logout", {
        method: "POST",
        userAuth: true,
        timeoutMs: 5_000,
        retries: 0
      });
    }
    const headers = refreshRequestHeaders(settings);
    if (settings.serverAccessToken) headers.authorization = `Bearer ${String(settings.serverAccessToken).trim()}`;
    const { response, data } = await newApiFetch(settings, "/api/user/auth/logout", {
      method: "POST",
      headers,
      timeoutMs: 5_000,
      retries: 0
    });
    if (!response.ok || data.parseFailed === true || data.error || data.success === false || data.ok === false) {
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
  
  function persistNewApiSessionCookie(settings, response) {
    if (newApiAuthProtocol(settings) === "bundle") return "";
    const sessionCookie = extractSessionCookie(response);
    if (!sessionCookie) return sessionCookie;
    const accountBaseUrl = resolveNewApiBaseUrl(settings, "account");
    const requestBaseUrl = normalizeServerUrl(response?.requestBaseUrl, accountBaseUrl);
    if (!sameNewApiOrigin(accountBaseUrl, requestBaseUrl)) return "";
  
    // Node's fetch does not own a browser cookie jar. New API rotates its signed
    // session whenever a protected flow stores state (download captcha/ticket,
    // for example), so the rotated cookie must become the next request's cookie.
    const requestSessionCookie = String(response?.requestSessionCookie || "").trim();
    const currentSessionCookie = String(settings?.serverSessionCookie || "").trim();
    if (!settings.serverUserId) {
      settings.serverSessionCookie = sessionCookie;
      return sessionCookie;
    }
  
    const stored = migrateSettings(readJson(settingsPath, defaultSettings));
    if (resolveNewApiBaseUrl(stored, "account").toLowerCase() !== accountBaseUrl.toLowerCase()) {
      const error = new Error("账户服务地址已切换，旧请求结果已丢弃。");
      error.code = "NEW_API_SESSION_CHANGED";
      throw error;
    }
    if (stored.serverUserId && String(stored.serverUserId) !== String(settings.serverUserId)) {
      const error = new Error("登录账户已切换，旧请求结果已丢弃。");
      error.code = "NEW_API_SESSION_CHANGED";
      throw error;
    }
    if (requestSessionCookie && currentSessionCookie && currentSessionCookie !== requestSessionCookie) {
      // This settings object already observed a newer rotation while the request
      // was in flight. A late response must not roll it back.
      return currentSessionCookie;
    }
    const storedSessionCookie = String(stored.serverSessionCookie || "").trim();
    if (requestSessionCookie && storedSessionCookie && storedSessionCookie !== requestSessionCookie) {
      // Compare-and-swap against the cookie that was actually sent. Concurrent
      // requests may finish out of order; retain the first accepted rotation.
      settings.serverSessionCookie = storedSessionCookie;
      return storedSessionCookie;
    }
    settings.serverSessionCookie = sessionCookie;
    if (sessionCookie === storedSessionCookie) return sessionCookie;
    writeJson(settingsPath, migrateSettings({
      ...stored,
      serverSessionCookie: sessionCookie,
      serverUserId: settings.serverUserId
    }));
    return sessionCookie;
  }
  
  function newApiTransportError(error, timedOut = false) {
    if (timedOut) {
      const timeoutError = new Error("New API 请求超时，请检查网络后重试。");
      timeoutError.code = "NEW_API_TIMEOUT";
      timeoutError.cause = error;
      timeoutError.phase = error?.phase || "transport";
      timeoutError.ambiguous = error?.ambiguous === true;
      timeoutError.serverRequestId = error?.serverRequestId || "";
      return timeoutError;
    }
    return error instanceof Error ? error : new Error(String(error || "New API 网络请求失败。"));
  }
  
  function newApiTransportRetryable(error) {
    const code = String(error?.code || error?.cause?.code || "").toUpperCase();
    const message = String(error?.message || error || "");
    return code === "NEW_API_TIMEOUT" ||
      /^(?:EAI_AGAIN|EPIPE|ECONNABORTED|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|ETIMEDOUT|ERR_SOCKET_CLOSED|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/.test(code) ||
      /fetch failed|network|socket|connection|timeout|timed out|temporarily unavailable/i.test(message);
  }
  
  function newApiRetryStatus(status) {
    return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
  }
  
  function newApiRetryDelay(response, attempt) {
    const retryAfter = String(response?.headers?.get?.("retry-after") || "").trim();
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const absolute = Date.parse(retryAfter);
      const requested = Number.isFinite(seconds)
        ? seconds * 1000
        : Number.isFinite(absolute)
          ? absolute - Date.now()
          : 0;
      if (requested > 0) return Math.max(250, Math.min(30_000, Math.round(requested)));
    }
    const base = Math.min(5_000, 400 * 2 ** Math.max(0, attempt));
    return base + Math.floor(Math.random() * Math.max(50, Math.round(base * 0.2)));
  }
  
  async function waitForNewApiRetry(milliseconds, signal) {
    if (signal?.aborted) throw newApiAbortError(signal);
    try {
      await delay(milliseconds, undefined, signal ? { signal } : undefined);
    } catch (error) {
      if (signal?.aborted) throw newApiAbortError(signal);
      throw error;
    }
  }
  
  async function newApiFetch(settings, endpoint, options = {}) {
    const service = options.service || "account";
    const baseUrl = options.requestBaseUrl || resolveNewApiBaseUrl(settings, service);
    if (isLocalServerUrl(baseUrl)) {
      await ensureLocalServer(baseUrl);
    }
    const body = options.body;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const method = String(options.method || "GET").toUpperCase();
    const safeToRetry = method === "GET" || method === "HEAD";
    const retries = Math.max(0, Math.min(4, Math.floor(Number(options.retries ?? (safeToRetry ? 2 : 0)) || 0)));
    const timeoutMs = Math.max(0, Math.min(10 * 60_000, Math.floor(Number(options.timeoutMs || 0) || 0)));
    const headers = {
      ...(isForm ? {} : { "content-type": "application/json" }),
      ...(options.headers || {})
    };
    const url = options.absoluteUrl || newApiUrl(settings, endpoint, service);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const attemptStartedAt = Date.now();
      const controller = new AbortController();
      let timedOut = false;
      let timeoutTimer = null;
      const abortFromCaller = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) abortFromCaller();
      else options.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
      try {
        const response = await newApiTransportFetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
          signal: controller.signal,
          headersTimeoutMs: options.headersTimeoutMs ?? (timeoutMs > 0 ? timeoutMs : undefined),
          connectTimeoutMs: options.connectTimeoutMs,
          proxyUrl: options.proxyUrl ?? settings?.networkProxyUrl,
          maxRequestBytes: options.maxRequestBytes,
          maxResponseBytes: options.maxResponseBytes
        });
        response.requestBaseUrl = baseUrl;
        response.requestService = service;
        const text = await response.text();
        const data = parseJsonText(text);
        const durationMs = Date.now() - attemptStartedAt;
        if (durationMs >= 2_000) {
          log(`new-api transport slow endpoint=${String(endpoint || "").split("?")[0]} status=${response.status} attempt=${attempt + 1}/${retries + 1} durationMs=${durationMs}`);
        }
        if (safeToRetry && attempt < retries && newApiRetryStatus(response.status)) {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          timeoutTimer = null;
          await waitForNewApiRetry(newApiRetryDelay(response, attempt), options.signal);
          continue;
        }
        return { response, text, data };
      } catch (error) {
        const durationMs = Date.now() - attemptStartedAt;
        if (durationMs >= 2_000) {
          log(`new-api transport slow failure endpoint=${String(endpoint || "").split("?")[0]} attempt=${attempt + 1}/${retries + 1} durationMs=${durationMs} code=${String(error?.code || error?.cause?.code || "")}`);
        }
        if (options.signal?.aborted) throw error;
        const transportError = newApiTransportError(error, timedOut);
        lastError = transportError;
        if (!safeToRetry || attempt >= retries || !newApiTransportRetryable(transportError)) throw transportError;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = null;
        await waitForNewApiRetry(newApiRetryDelay(null, attempt), options.signal);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        options.signal?.removeEventListener?.("abort", abortFromCaller);
      }
    }
    throw lastError || new Error("New API 网络请求失败。");
  }
  
  async function newApiRequest(settings, endpoint, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const userAuth = options.userAuth === true;
    if (userAuth && newApiAuthProtocol(settings) === "bundle" && newApiAccessRefreshNeeded(settings)) {
      await refreshNewApiAuth(settings);
    }
    const request = () => newApiFetch(settings, endpoint, {
      ...options,
      headers: userAuth ? mergeNewApiUserAuthHeaders(options.headers, settings) : options.headers,
      timeoutMs: options.timeoutMs ?? 20_000,
      retries: options.retries ?? (method === "GET" || method === "HEAD" ? 2 : 0)
    });
    let { response, data } = await request();
    if (
      userAuth
      && newApiAuthProtocol(settings) === "bundle"
      && newApiAuthResponseFailure(response, data)
      && endpoint !== "/api/user/auth/refresh"
      && endpoint !== "/api/user/auth/logout"
    ) {
      await refreshNewApiAuth(settings, { force: true });
      ({ response, data } = await request());
    }
    persistNewApiSessionCookie(settings, response);
    if (!response.ok || data.parseFailed === true || data.error || data.success === false || data.ok === false) {
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
  
  function requireNewApiSession(settings) {
    const protocol = newApiAuthProtocol(settings);
    const hasCredential = protocol === "bundle"
      ? Boolean(settings?.serverAccessToken || settings?.serverSessionCookie)
      : Boolean(settings?.serverSessionCookie);
    if (!settings?.serverUserId || !hasCredential) {
      throw new Error("登录会话已失效，请重新登录。");
    }
  }
  
  function managedRelayEndpoint(providerEndpoint) {
    const clean = String(providerEndpoint || "").startsWith("/") ? String(providerEndpoint || "") : `/${providerEndpoint || ""}`;
    if (clean === MANAGED_RELAY_PREFIX || clean.startsWith(`${MANAGED_RELAY_PREFIX}/`)) return clean;
    if (clean === "/v1" || clean.startsWith("/v1/")) return `${MANAGED_RELAY_PREFIX}${clean}`;
    return `${MANAGED_RELAY_PREFIX}/v1${clean}`;
  }
  
  async function newApiRelayJson(settings, endpoint, body, options = {}) {
    const provider = options.provider || (String(endpoint).includes("/images/") ? "image" : "agent");
    const credentials = await relayApiCredentials(settings, endpoint, body, provider);
    const relayBody = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : body;
    if (relayBody && typeof relayBody === "object") delete relayBody.group;
    const { response, data } = await newApiFetch(settings, endpoint, {
      ...options,
      method: "POST",
      absoluteUrl: directApiUrl(credentials.baseUrl, endpoint),
      requestBaseUrl: credentials.baseUrl,
      headers: relayApiHeaders(options.headers, credentials.apiKey),
      body: relayBody,
    });
    if (!response.ok || data.parseFailed === true || data.success === false || data.ok === false || data.error) {
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function imageTaskUnsupportedError(status, data) {
    const numericStatus = Number(status);
    if ([404, 405, 501].includes(numericStatus)) return true;
    if (![400, 422].includes(numericStatus)) return false;
    const message = String(newApiErrorMessage(data, numericStatus) || "").toLowerCase();
    return /(image[_ -]?tasks?|task[_ -]?image)/.test(message)
      && /(unsupported|not supported|unknown|not found|no route|不存在|不支持|未找到)/.test(message);
  }

  function imageTaskRequestError(status, data, fallback) {
    const error = new Error(newApiErrorMessage(data, status) || fallback);
    error.status = Number(status) || undefined;
    error.data = data;
    return error;
  }

  async function newApiRelayImageTask(settings, body, options = {}) {
    const provider = "image";
    const endpoint = "/v1/image-tasks";
    const requestBody = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
    delete requestBody.group;
    delete requestBody.stream;
    delete requestBody.partial_images;

    const credentials = await relayApiCredentials(settings, endpoint, requestBody, provider);
    const relayBaseUrl = credentials.baseUrl;
    if (isLocalServerUrl(relayBaseUrl)) await ensureLocalServer(relayBaseUrl);

    let createResponse;
    try {
      createResponse = await newApiTransportFetch(directApiUrl(relayBaseUrl, endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...relayApiHeaders(options.headers, credentials.apiKey)
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
        headersTimeoutMs: options.createHeadersTimeoutMs || 30_000,
        connectTimeoutMs: options.connectTimeoutMs || 30_000,
        proxyUrl: options.proxyUrl ?? settings?.networkProxyUrl,
        maxRequestBytes: options.maxRequestBytes,
        maxResponseBytes: options.createMaxResponseBytes || 1024 * 1024
      });
    } catch (error) {
      if (error && typeof error === "object") {
        error.ambiguous = true;
        error.unsafeToRetry = true;
      }
      throw error;
    }
    const createData = parseJsonText(await createResponse.text());
    if (!createResponse.ok || createData.parseFailed === true || createData.error || createData.success === false || createData.ok === false) {
      const error = imageTaskRequestError(createResponse.status, createData, "图片任务创建失败。");
      if (imageTaskUnsupportedError(createResponse.status, createData)) {
        error.code = "NEW_API_IMAGE_TASK_UNSUPPORTED";
      } else if ([408, 425].includes(Number(createResponse.status)) || Number(createResponse.status) >= 500) {
        error.ambiguous = true;
        error.unsafeToRetry = true;
      }
      throw error;
    }

    const taskId = String(createData.task_id || createData.id || "").trim();
    if (!taskId) {
      const error = new Error("图片任务接口已返回成功，但缺少 task_id。");
      error.code = "NEW_API_IMAGE_TASK_ID_MISSING";
      error.ambiguous = true;
      error.unsafeToRetry = true;
      throw error;
    }
    options.onAccepted?.({ taskId, status: String(createData.status || "queued") });

    const configuredPollInterval = Number(options.pollIntervalMs);
    const pollIntervalMs = Number.isFinite(configuredPollInterval)
      ? Math.max(0, configuredPollInterval)
      : 2500;
    let transientPollFailures = 0;
    for (;;) {
      if (pollIntervalMs > 0) {
        await delay(pollIntervalMs, undefined, options.signal ? { signal: options.signal } : undefined);
      }
      let pollResponse;
      try {
        pollResponse = await newApiTransportFetch(
          directApiUrl(relayBaseUrl, `${endpoint}/${encodeURIComponent(taskId)}`),
          {
            method: "GET",
            headers: { authorization: `Bearer ${credentials.apiKey}` },
            signal: options.signal,
            headersTimeoutMs: options.pollHeadersTimeoutMs || 30_000,
            connectTimeoutMs: options.connectTimeoutMs || 30_000,
            proxyUrl: options.proxyUrl ?? settings?.networkProxyUrl,
            maxResponseBytes: options.maxResponseBytes || 96 * 1024 * 1024
          }
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        transientPollFailures += 1;
        options.onPollRetry?.({ taskId, failures: transientPollFailures });
        continue;
      }

      const taskData = parseJsonText(await pollResponse.text());
      if (!pollResponse.ok || taskData.parseFailed === true || taskData.success === false || taskData.ok === false || taskData.error && !taskData.status) {
        const status = Number(pollResponse.status);
        if (status === 408 || status === 425 || status === 429 || status >= 500 || taskData.parseFailed === true) {
          transientPollFailures += 1;
          options.onPollRetry?.({ taskId, failures: transientPollFailures, status });
          continue;
        }
        const error = imageTaskRequestError(status, taskData, "图片任务状态查询失败。");
        error.taskId = taskId;
        error.unsafeToRetry = true;
        throw error;
      }

      transientPollFailures = 0;
      const status = String(taskData.status || "").trim().toLowerCase();
      options.onStatus?.({ taskId, status });
      if (status === "queued" || status === "running") continue;
      if (status === "succeeded") {
        const result = taskData.result;
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          const error = new Error("图片任务已完成，但没有返回可识别的最终结果。");
          error.code = "NEW_API_IMAGE_TASK_RESULT_MISSING";
          error.taskId = taskId;
          error.unsafeToRetry = true;
          throw error;
        }
        return result;
      }
      if (status === "failed") {
        const error = imageTaskRequestError(
          0,
          taskData,
          String(taskData?.error?.message || taskData?.message || "图片生成任务失败。")
        );
        error.code = "NEW_API_IMAGE_TASK_FAILED";
        error.taskId = taskId;
        error.unsafeToRetry = true;
        throw error;
      }

      const error = new Error(`图片任务返回了未知状态：${status || "empty"}。`);
      error.code = "NEW_API_IMAGE_TASK_STATUS_INVALID";
      error.taskId = taskId;
      error.unsafeToRetry = true;
      throw error;
    }
  }
  
  async function newApiRelayStream(settings, endpoint, body, onEvent, options = {}) {
    const relayBody = { ...body, stream: true };
    delete relayBody.group;
    const provider = options.provider || (String(endpoint).includes("/images/") ? "image" : "agent");
    const credentials = await relayApiCredentials(settings, endpoint, relayBody, provider);
    const relayBaseUrl = credentials.baseUrl;
    if (isLocalServerUrl(relayBaseUrl)) {
      await ensureLocalServer(relayBaseUrl);
    }
    const response = await newApiTransportFetch(
      directApiUrl(credentials.baseUrl, endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...relayApiHeaders(options.headers, credentials.apiKey)
      },
      body: JSON.stringify(relayBody),
      signal: options.signal,
      headersTimeoutMs: options.headersTimeoutMs,
      connectTimeoutMs: options.connectTimeoutMs,
      idleTimeoutMs: options.idleTimeoutMs,
      proxyUrl: options.proxyUrl ?? settings?.networkProxyUrl,
      maxRequestBytes: options.maxRequestBytes,
      maxResponseBytes: options.maxResponseBytes
    });
    response.requestBaseUrl = relayBaseUrl;
    response.requestService = "relay";
    if (!response.ok) {
      const text = await response.text();
      const data = parseJsonText(text);
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    const contentType = String(response.headers?.get?.("content-type") || response.headers?.["content-type"] || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const data = parseJsonText(await response.text());
      if (data.parseFailed === true || data.error || data.success === false || data.ok === false) {
        const error = new Error(newApiErrorMessage(data, response.status));
        error.status = response.status;
        error.data = data;
        throw error;
      }
      if (!data || (typeof data === "object" && !Object.keys(data).length)) {
        const error = new Error("API 返回成功，但响应内容为空。");
        error.code = "NEW_API_EMPTY_STREAM_OUTPUT";
        throw error;
      }
      onEvent?.(data);
      return;
    }
    if (!response.body) throw new Error("New API 流式响应为空。");
  
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    let eventCount = 0;
    let meaningfulEventCount = 0;
    const maximumEventBytes = Math.max(64 * 1024, Math.min(
      96 * 1024 * 1024,
      Math.floor(Number(options.maximumEventBytes || 2 * 1024 * 1024) || 2 * 1024 * 1024)
    ));
    const maximumStreamBytes = Math.max(maximumEventBytes, Math.min(
      256 * 1024 * 1024,
      Math.floor(Number(options.maximumStreamBytes || 24 * 1024 * 1024) || 24 * 1024 * 1024)
    ));
    const maximumEvents = Math.max(1, Math.min(
      100_000,
      Math.floor(Number(options.maximumEvents || 20_000) || 20_000)
    ));
    const nextSeparator = () => {
      const crlf = buffer.indexOf("\r\n\r\n");
      const lf = buffer.indexOf("\n\n");
      if (crlf >= 0 && (lf < 0 || crlf < lf)) return { index: crlf, length: 4 };
      if (lf >= 0) return { index: lf, length: 2 };
      return null;
    };
    const failStream = (message, code) => {
      const error = new Error(message);
      error.code = code;
      response.body.destroy(error);
      throw error;
    };
    const consumeEvent = (rawEvent) => {
      if (Buffer.byteLength(rawEvent, "utf8") > maximumEventBytes) {
        failStream("New API 单个流式事件超过客户端安全上限。", "NEW_API_SSE_EVENT_TOO_LARGE");
      }
      const dataLines = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""));
      if (!dataLines.length) return false;
      const dataText = dataLines.join("\n");
      if (!dataText.trim()) return false;
      eventCount += 1;
      if (eventCount > maximumEvents) {
        failStream("New API 流式事件数量超过客户端安全上限。", "NEW_API_SSE_TOO_MANY_EVENTS");
      }
      if (dataText.trim() === "[DONE]") {
        onEvent?.({ done: true });
        return true;
      }
      const event = parseJsonText(dataText);
      if (event.parseFailed === true) {
        failStream("New API 返回了无效的流式 JSON。", "NEW_API_INVALID_SSE");
      }
      meaningfulEventCount += 1;
      onEvent?.(event);
      return event?.done === true || event?.type === "response.completed" || event?.type === "response.failed" || event?.type === "response.incomplete";
    };
    for await (const chunk of response.body) {
      totalBytes += Number(chunk?.byteLength || chunk?.length || 0);
      if (totalBytes > maximumStreamBytes) {
        failStream("New API 流式响应超过客户端安全上限。", "NEW_API_SSE_TOO_LARGE");
      }
      buffer += decoder.decode(chunk, { stream: true });
      if (!nextSeparator() && Buffer.byteLength(buffer, "utf8") > maximumEventBytes) {
        failStream("New API 流式事件未正常结束，已超过客户端安全上限。", "NEW_API_SSE_EVENT_TOO_LARGE");
      }
      let separator = nextSeparator();
      while (separator) {
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        if (consumeEvent(rawEvent)) {
          if (meaningfulEventCount === 0) {
            const error = new Error("API 返回成功，但没有可识别的流式内容。");
            error.code = "NEW_API_EMPTY_STREAM_OUTPUT";
            throw error;
          }
          return;
        }
        separator = nextSeparator();
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) consumeEvent(rest);
    if (meaningfulEventCount === 0) {
      const error = new Error("API 返回成功，但没有可识别的流式内容。");
      error.code = "NEW_API_EMPTY_STREAM_OUTPUT";
      throw error;
    }
  }

  function imageItemsFromPayload(payload) {
    const items = [];
    const payloadActualParams = pickImageGenerationResponseMetadata(payload);
    const append = (candidate, inheritedActualParams = payloadActualParams) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
      const b64Json = typeof candidate.b64_json === "string" ? candidate.b64_json.trim() : "";
      const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
      if (!b64Json && !url) return;
      const actualParams = mergeImageGenerationResponseMetadata(inheritedActualParams, candidate);
      items.push({
        ...(b64Json ? { b64_json: b64Json } : {}),
        ...(url ? { url } : {}),
        ...(typeof candidate.revised_prompt === "string" ? { revised_prompt: candidate.revised_prompt } : {}),
        ...(typeof candidate.size === "string" ? { size: candidate.size } : {}),
        ...(typeof candidate.quality === "string" ? { quality: candidate.quality } : {}),
        ...(typeof candidate.output_format === "string" ? { output_format: candidate.output_format } : {}),
        ...(Object.keys(actualParams).length ? { actualParams } : {})
      });
    };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return items;
    append(payload, payloadActualParams);
    for (const candidate of Array.isArray(payload.data) ? payload.data : []) append(candidate, payloadActualParams);
    const result = payload.result && typeof payload.result === "object" ? payload.result : null;
    const resultActualParams = mergeImageGenerationResponseMetadata(payloadActualParams, result);
    append(result, resultActualParams);
    for (const candidate of Array.isArray(result?.data) ? result.data : []) append(candidate, resultActualParams);
    return items;
  }

  function responsesImageItemsFromValue(value, revisedPrompt = "", inheritedActualParams = {}) {
    const items = [];
    const append = (candidate, fallbackPrompt = revisedPrompt, parentActualParams = inheritedActualParams) => {
      if (typeof candidate === "string") {
        const clean = candidate.trim();
        if (!clean) return;
        const actualParams = mergeImageGenerationResponseMetadata(parentActualParams);
        const metadata = Object.keys(actualParams).length ? { actualParams } : {};
        const dataUrl = clean.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/is);
        if (dataUrl) {
          items.push({ b64_json: dataUrl[1], ...(fallbackPrompt ? { revised_prompt: fallbackPrompt } : {}), ...metadata });
        } else if (/^https?:\/\//i.test(clean)) {
          items.push({ url: clean, ...(fallbackPrompt ? { revised_prompt: fallbackPrompt } : {}), ...metadata });
        } else {
          items.push({ b64_json: clean, ...(fallbackPrompt ? { revised_prompt: fallbackPrompt } : {}), ...metadata });
        }
        return;
      }
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
      const actualParams = mergeImageGenerationResponseMetadata(parentActualParams, candidate);
      const prompt = String(candidate.revised_prompt || candidate.revisedPrompt || fallbackPrompt || "").trim();
      const b64Json = String(
        candidate.b64_json || candidate.image_base64 || candidate.base64 || ""
      ).trim();
      const imageUrl = typeof candidate.image_url === "string"
        ? candidate.image_url
        : candidate.image_url && typeof candidate.image_url === "object"
          ? candidate.image_url.url
          : "";
      const url = String(candidate.url || imageUrl || "").trim();
      if (b64Json) append(b64Json, prompt, actualParams);
      if (url) append(url, prompt, actualParams);
      if (candidate.result !== undefined) append(candidate.result, prompt, actualParams);
    };
    append(value, revisedPrompt, inheritedActualParams);
    return items;
  }

  function responsesImageItemsFromPayload(payload) {
    const items = [];
    const appendOutputItem = (item, inheritedActualParams = {}) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      if (item.type && item.type !== "image_generation_call") return;
      const actualParams = mergeImageGenerationResponseMetadata(inheritedActualParams, item);
      items.push(...responsesImageItemsFromValue(item.result, String(item.revised_prompt || item.revisedPrompt || ""), actualParams));
    };
    const appendPayload = (candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
      const actualParams = pickImageGenerationResponseMetadata(candidate);
      appendOutputItem(candidate.item, actualParams);
      for (const item of Array.isArray(candidate.output) ? candidate.output : []) appendOutputItem(item, actualParams);
      for (const item of Array.isArray(candidate.data) ? candidate.data : []) {
        items.push(...responsesImageItemsFromValue(item, "", actualParams));
      }
    };
    appendPayload(payload);
    appendPayload(payload?.response);
    return items;
  }

  function responsesImageUnsupportedError(status, data) {
    if (![400, 404, 422].includes(Number(status))) return false;
    const message = String(newApiErrorMessage(data, status) || "").toLowerCase();
    if (Number(status) === 404 && /(404|not found|no route|endpoint|不存在|未找到)/.test(message)) return true;
    const feature = /(responses?|image[_ -]?generation|partial_images|tool(?:s|_choice)?|model)/.test(message);
    const unsupported = /(unsupported|not supported|unknown|unrecognized|unexpected|not found|does not exist|invalid (?:model|tool|parameter)|不支持|未知|未找到|不存在)/.test(message);
    return feature && unsupported;
  }

  async function newApiRelayResponsesImage(settings, body, onPartialImage, options = {}) {
    const partialImages = Math.max(1, Math.min(3, Math.floor(Number(options.partialImages || 3) || 3)));
    const requestBody = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
    requestBody.tools = Array.isArray(requestBody.tools)
      ? requestBody.tools.map((tool) => tool?.type === "image_generation" ? { ...tool, partial_images: partialImages } : tool)
      : [];
    requestBody.tool_choice = requestBody.tool_choice || "required";

    const completed = [];
    const completedIndexes = new Map();
    const previewIndexes = new Set();
    let sequentialPartialIndex = 0;
    let observedStreamEvent = false;
    let created = 0;
    let usage;
    let streamActualParams = {};
    const appendCompleted = (items) => {
      for (const item of items) {
        const key = item.b64_json ? `b64:${item.b64_json}` : `url:${item.url}`;
        const existingIndex = completedIndexes.get(key);
        if (existingIndex !== undefined) {
          const existing = completed[existingIndex];
          completed[existingIndex] = {
            ...existing,
            ...item,
            revised_prompt: item.revised_prompt || existing.revised_prompt,
            actualParams: mergeImageGenerationResponseMetadata(existing.actualParams, item.actualParams)
          };
          continue;
        }
        completedIndexes.set(key, completed.length);
        completed.push(item);
      }
    };

    try {
      await newApiRelayStream(settings, "/v1/responses", requestBody, (event) => {
        observedStreamEvent = true;
        const type = String(event?.type || "");
        const responsePayload = event?.response && typeof event.response === "object" ? event.response : null;
        streamActualParams = mergeImageGenerationResponseMetadata(streamActualParams, event, responsePayload);
        if (Number.isFinite(Number(event?.created_at || event?.created || responsePayload?.created_at))) {
          created = Number(event.created_at || event.created || responsePayload.created_at);
        }
        if (event?.usage && typeof event.usage === "object") usage = event.usage;
        if (responsePayload?.usage && typeof responsePayload.usage === "object") usage = responsePayload.usage;

        if (type === "response.failed" || type === "response.incomplete") {
          const failure = responsePayload?.error || event?.error || event;
          const error = new Error(newApiErrorMessage({ error: failure, message: event?.message }, 0) || "Responses 生图请求未完成。");
          error.code = type === "response.failed" ? "NEW_API_RESPONSES_IMAGE_FAILED" : "NEW_API_RESPONSES_IMAGE_INCOMPLETE";
          error.data = event;
          error.ambiguous = true;
          throw error;
        }

        if (type === "response.image_generation_call.partial_image") {
          const b64Json = String(event?.partial_image_b64 || event?.b64_json || "").trim();
          if (!b64Json) return;
          const rawIndex = Number(event?.partial_image_index);
          const partialIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.floor(rawIndex)) : sequentialPartialIndex;
          sequentialPartialIndex = Math.max(sequentialPartialIndex + 1, partialIndex + 1);
          // Responses emits one additional final-quality partial after the
          // requested previews. It is not a fourth preview and must not render
          // as 4/3; the authoritative final image comes from output_item.done
          // or response.completed below.
          if (partialIndex >= partialImages || previewIndexes.has(partialIndex)) return;
          previewIndexes.add(partialIndex);
          onPartialImage?.({
            b64Json,
            dataUrl: `data:image/png;base64,${b64Json}`,
            partialImageIndex: partialIndex,
            index: partialIndex + 1,
            total: partialImages,
            eventType: type
          });
          return;
        }

        if (type === "response.output_item.done") {
          appendCompleted(responsesImageItemsFromPayload({
            item: event?.item,
            actualParams: streamActualParams
          }));
          return;
        }
        if (type === "response.completed" || !type) {
          appendCompleted(responsesImageItemsFromPayload(event));
        }
      }, {
        ...options,
        provider: "image",
        maximumEventBytes: options.maximumEventBytes || 96 * 1024 * 1024,
        maximumStreamBytes: options.maximumStreamBytes || 256 * 1024 * 1024,
        maximumEvents: options.maximumEvents || 20_000,
        maxResponseBytes: options.maxResponseBytes || 256 * 1024 * 1024
      });
    } catch (error) {
      if (responsesImageUnsupportedError(error?.status, error?.data)) {
        error.code = "NEW_API_RESPONSES_IMAGE_UNSUPPORTED";
      } else if (error && typeof error === "object" && (observedStreamEvent || error.ambiguous === true)) {
        error.ambiguous = true;
        error.unsafeToRetry = true;
      }
      throw error;
    }

    if (!completed.length) {
      const error = new Error(previewIndexes.size
        ? "Responses 图片流已返回中间预览，但没有返回最终图片。"
        : "Responses 图片流没有返回可识别的最终图片。");
      error.code = "NEW_API_EMPTY_IMAGE_OUTPUT";
      error.ambiguous = observedStreamEvent;
      error.unsafeToRetry = observedStreamEvent;
      throw error;
    }
    return {
      created: created || Math.floor(Date.now() / 1000),
      data: completed,
      ...(usage ? { usage } : {}),
      stream: true,
      partial_images: partialImages
    };
  }

  function imageStreamUnsupportedError(status, data) {
    if (![400, 404, 422].includes(Number(status))) return false;
    const message = String(newApiErrorMessage(data, status) || "").toLowerCase();
    return /(stream|partial_images)/.test(message) && /(unsupported|not supported|unknown|unrecognized|unexpected|invalid|不支持|未知|无效)/.test(message);
  }

  async function newApiRelayImage(settings, endpoint, body, onPartialImage, options = {}) {
    const provider = "image";
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    let requestBody;
    if (isForm) {
      requestBody = body;
      requestBody.set("stream", "true");
      requestBody.set("partial_images", String(Math.max(1, Math.min(3, Math.floor(Number(options.partialImages || 3) || 3)))));
      requestBody.delete("group");
    } else {
      requestBody = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : {};
      requestBody.stream = true;
      requestBody.partial_images = Math.max(1, Math.min(3, Math.floor(Number(options.partialImages || 3) || 3)));
      delete requestBody.group;
    }
    const credentials = await relayApiCredentials(settings, endpoint, requestBody, provider);
    const relayBaseUrl = credentials.baseUrl;
    if (isLocalServerUrl(relayBaseUrl)) await ensureLocalServer(relayBaseUrl);
    const response = await newApiTransportFetch(
      directApiUrl(credentials.baseUrl, endpoint), {
        method: "POST",
        headers: {
          ...(isForm ? {} : { "content-type": "application/json" }),
          ...relayApiHeaders(options.headers, credentials.apiKey)
        },
        body: isForm ? requestBody : JSON.stringify(requestBody),
        signal: options.signal,
        headersTimeoutMs: options.headersTimeoutMs,
        connectTimeoutMs: options.connectTimeoutMs,
        idleTimeoutMs: options.idleTimeoutMs,
        proxyUrl: options.proxyUrl ?? settings?.networkProxyUrl,
        maxRequestBytes: options.maxRequestBytes,
        maxResponseBytes: options.maxResponseBytes
      }
    );
    response.requestBaseUrl = relayBaseUrl;
    response.requestService = "relay";
    if (!response.ok) {
      const text = await response.text();
      const data = parseJsonText(text);
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      if (imageStreamUnsupportedError(response.status, data)) error.code = "NEW_API_IMAGE_STREAM_UNSUPPORTED";
      throw error;
    }

    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (!contentType.includes("text/event-stream")) {
      const data = parseJsonText(await response.text());
      if (data.parseFailed === true || data.error || data.success === false || data.ok === false) {
        const error = new Error(newApiErrorMessage(data, response.status));
        error.status = response.status;
        error.data = data;
        throw error;
      }
      if (!imageItemsFromPayload(data).length) {
        const error = new Error("图片接口返回成功，但没有可识别的最终图片。");
        error.code = "NEW_API_EMPTY_IMAGE_OUTPUT";
        throw error;
      }
      return data;
    }
    if (!response.body) throw new Error("图片接口流式响应为空。");

    const decoder = new TextDecoder();
    const completed = [];
    let buffer = "";
    let totalBytes = 0;
    let eventCount = 0;
    let partialCount = 0;
    let created = 0;
    let usage;
    let terminal = false;
    const maximumEventBytes = 96 * 1024 * 1024;
    const maximumStreamBytes = 256 * 1024 * 1024;
    const nextSeparator = () => {
      const match = buffer.match(/\r?\n\r?\n/);
      return match && typeof match.index === "number" ? { index: match.index, length: match[0].length } : null;
    };
    const failStream = (message, code) => {
      const error = new Error(message);
      error.code = code;
      response.body.destroy(error);
      throw error;
    };
    const consumeEvent = (rawEvent) => {
      if (Buffer.byteLength(rawEvent, "utf8") > maximumEventBytes) {
        failStream("图片接口单个流式事件超过客户端安全上限。", "NEW_API_IMAGE_SSE_EVENT_TOO_LARGE");
      }
      const dataText = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
      if (!dataText) return;
      if (dataText === "[DONE]") {
        terminal = true;
        return;
      }
      eventCount += 1;
      if (eventCount > 64) failStream("图片接口流式事件数量异常。", "NEW_API_IMAGE_SSE_TOO_MANY_EVENTS");
      const event = parseJsonText(dataText);
      if (event.parseFailed === true) failStream("图片接口返回了无效的流式 JSON。", "NEW_API_INVALID_IMAGE_SSE");
      const type = String(event?.type || "");
      if (type === "error" || type === "upstream_error" || event?.error) {
        const error = new Error(newApiErrorMessage(event, response.status));
        error.status = response.status;
        error.data = event;
        throw error;
      }
      if (Number.isFinite(Number(event?.created_at || event?.created))) created = Number(event.created_at || event.created);
      if (event?.usage && typeof event.usage === "object") usage = event.usage;
      if (type === "image_generation.partial_image" || type === "image_edit.partial_image" || type === "response.image_generation_call.partial_image") {
        const b64Json = String(event?.b64_json || event?.partial_image_b64 || "").trim();
        if (!b64Json) return;
        partialCount += 1;
        const rawIndex = Number(event?.partial_image_index);
        onPartialImage?.({
          b64Json,
          dataUrl: `data:image/png;base64,${b64Json}`,
          partialImageIndex: Number.isFinite(rawIndex) ? rawIndex : partialCount - 1,
          index: Number.isFinite(rawIndex) ? rawIndex + 1 : partialCount,
          total: Number(requestBody?.partial_images || (isForm ? requestBody.get("partial_images") : 3)) || 3,
          eventType: type
        });
        return;
      }
      const object = String(event?.object || "");
      if (type === "image_generation.completed" || type === "image_edit.completed" || object === "image.generation.result" || object === "image.edit.result") {
        completed.push(...imageItemsFromPayload(event));
      }
    };

    for await (const chunk of response.body) {
      totalBytes += Number(chunk?.byteLength || chunk?.length || 0);
      if (totalBytes > maximumStreamBytes) failStream("图片接口流式响应超过客户端安全上限。", "NEW_API_IMAGE_SSE_TOO_LARGE");
      buffer += decoder.decode(chunk, { stream: true });
      if (!nextSeparator() && Buffer.byteLength(buffer, "utf8") > maximumEventBytes) {
        failStream("图片接口流式事件未正常结束。", "NEW_API_IMAGE_SSE_EVENT_TOO_LARGE");
      }
      let separator = nextSeparator();
      while (separator) {
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        consumeEvent(rawEvent);
        if (terminal) break;
        separator = nextSeparator();
      }
      if (terminal) break;
    }
    if (!terminal) {
      buffer += decoder.decode();
      if (buffer.trim()) consumeEvent(buffer.trim());
    }
    if (!completed.length) {
      const error = new Error(partialCount
        ? "图片流已返回中间预览，但没有返回最终图片。"
        : "图片流没有返回可识别的最终图片。");
      error.code = "NEW_API_EMPTY_IMAGE_OUTPUT";
      throw error;
    }
    return {
      created: created || Math.floor(Date.now() / 1000),
      data: completed,
      ...(usage ? { usage } : {}),
      stream: true,
      partial_images: partialCount
    };
  }

  return {
    extractSessionCookie,
    extractRefreshCookie,
    isNewApiAuthError,
    logoutNewApiSession,
    managedRelayEndpoint,
    newApiAuthProtocol,
    newApiAccessRefreshNeeded,
    isCustomApiMode,
    customApiCredentials,
    customApiHeaders,
    customApiUrl,
    directApiUrl,
    newApiErrorMessage,
    newApiFetch,
    newApiUrl,
    newApiRelayJson,
    newApiRelayImageTask,
    newApiRelayImage,
    newApiRelayResponsesImage,
    newApiRelayStream,
    newApiRequest,
    newApiUserAuthHeaders,
    parseNewApiLoginAuth,
    parseJsonText,
    persistNewApiSessionCookie,
    refreshNewApiAuth,
    requireNewApiSession,
    resolveNewApiBaseUrl,
    sameNewApiOrigin,
    validateNewApiServiceSettings
  };
}

module.exports = {
  createNewApiClient
};
