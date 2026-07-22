"use strict";

const { setTimeout: delay } = require("node:timers/promises");

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
    settingsPath,
    writeJson
  } = options;

  function newApiUserAuthHeaders(settings) {
    const headers = {};
    if (settings.serverSessionCookie) headers.cookie = settings.serverSessionCookie;
    if (settings.serverUserId) headers["New-Api-User"] = String(settings.serverUserId);
    return headers;
  }
  
  function newApiUrl(settings, endpoint) {
    const pathPart = String(endpoint || "").startsWith("/") ? String(endpoint || "") : `/${endpoint || ""}`;
    return `${normalizeServerUrl(settings.serverUrl)}${pathPart}`;
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
    return (
      data?.error?.message ||
      data?.message ||
      data?.error ||
      data?.msg ||
      (status ? `New API ${status}` : "New API request failed")
    );
  }
  
  function isNewApiAuthError(error) {
    const status = Number(error?.status);
    const message = String(error?.message || error || "");
    return status === 401 || status === 403 || /invalid token|unauthorized|forbidden|登录已失效|401|403/i.test(message);
  }
  
  function extractSessionCookie(response) {
    const values = [];
    if (typeof response.headers.getSetCookie === "function") {
      values.push(...response.headers.getSetCookie());
    }
    const single = response.headers.get("set-cookie");
    if (single) values.push(single);
    for (const value of values) {
      const match = String(value || "").match(/(?:^|,\s*)(session=[^;,\s]+)/i);
      if (match) return match[1];
    }
    return "";
  }
  
  function persistNewApiSessionCookie(settings, response) {
    const sessionCookie = extractSessionCookie(response);
    if (!sessionCookie) return sessionCookie;
  
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
    if (isLocalServerUrl(settings.serverUrl)) {
      await ensureLocalServer();
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
    const url = newApiUrl(settings, endpoint);
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
          maxRequestBytes: options.maxRequestBytes,
          maxResponseBytes: options.maxResponseBytes
        });
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
    const { response, data } = await newApiFetch(settings, endpoint, {
      ...options,
      timeoutMs: options.timeoutMs ?? 20_000,
      retries: options.retries ?? (method === "GET" || method === "HEAD" ? 2 : 0)
    });
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
    if (!settings.serverSessionCookie || !settings.serverUserId) {
      throw new Error("登录会话已失效，请重新登录。");
    }
  }
  
  function managedRelayEndpoint(providerEndpoint) {
    const clean = String(providerEndpoint || "").startsWith("/") ? String(providerEndpoint || "") : `/${providerEndpoint || ""}`;
    if (clean.startsWith("/iiimage/")) return clean;
    if (clean.startsWith("/api/crm/ai/")) {
      return managedRelayEndpoint(clean.slice("/api/crm/ai".length));
    }
    if (clean === "/v1" || clean.startsWith("/v1/")) return `/iiimage${clean}`;
    return `/iiimage/v1${clean}`;
  }
  
  async function newApiRelayJson(settings, endpoint, body, options = {}) {
    requireNewApiSession(settings);
    const { response, data } = await newApiFetch(settings, managedRelayEndpoint(endpoint), {
      method: "POST",
      headers: { ...newApiUserAuthHeaders(settings), ...(options.headers || {}) },
      body,
      signal: options.signal,
      headersTimeoutMs: options.headersTimeoutMs,
      connectTimeoutMs: options.connectTimeoutMs,
      maxRequestBytes: options.maxRequestBytes,
      maxResponseBytes: options.maxResponseBytes
    });
    persistNewApiSessionCookie(settings, response);
    if (!response.ok || data.parseFailed === true || data.success === false || data.ok === false || data.error) {
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
  
  async function newApiRelayStream(settings, endpoint, body, onEvent, options = {}) {
    requireNewApiSession(settings);
    if (isLocalServerUrl(settings.serverUrl)) {
      await ensureLocalServer();
    }
    const response = await newApiTransportFetch(newApiUrl(settings, managedRelayEndpoint(endpoint)), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...newApiUserAuthHeaders(settings)
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: options.signal,
      headersTimeoutMs: options.headersTimeoutMs,
      connectTimeoutMs: options.connectTimeoutMs
    });
    persistNewApiSessionCookie(settings, response);
    if (!response.ok) {
      const text = await response.text();
      const data = parseJsonText(text);
      const error = new Error(newApiErrorMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    if (!response.body) throw new Error("New API 流式响应为空。");
  
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    let eventCount = 0;
    const maximumEventBytes = 2 * 1024 * 1024;
    const maximumStreamBytes = 24 * 1024 * 1024;
    const maximumEvents = 20_000;
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
        if (consumeEvent(rawEvent)) return;
        separator = nextSeparator();
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) consumeEvent(rest);
  }

  return {
    extractSessionCookie,
    isNewApiAuthError,
    managedRelayEndpoint,
    newApiErrorMessage,
    newApiFetch,
    newApiRelayJson,
    newApiRelayStream,
    newApiRequest,
    newApiUserAuthHeaders,
    parseJsonText,
    persistNewApiSessionCookie,
    requireNewApiSession
  };
}

module.exports = {
  createNewApiClient
};

