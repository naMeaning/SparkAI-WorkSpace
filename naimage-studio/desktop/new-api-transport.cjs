"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const { createServer: createNetServer } = require("node:net");
const { PassThrough } = require("node:stream");
const { setTimeout: delay } = require("node:timers/promises");

function createNewApiTransport(options = {}) {
  const {
    app,
    applicationName = "naimage",
    windowsCurlPath = "",
    getDesktopVersion = () => "0.0.0",
    getAuthEpoch = () => 0
  } = options;
  const activeNewApiCurlTransports = new Set();

  function stopActiveNewApiCurlTransports(criteria = null) {
    const filter = criteria && typeof criteria === "object"
      ? criteria
      : typeof criteria === "string" && criteria
        ? { sessionCookie: criteria }
        : {};
    const hasFilter = Object.keys(filter).length > 0;
    const targets = [...activeNewApiCurlTransports].filter((entry) =>
      (!filter.sessionCookie || entry.sessionCookie === filter.sessionCookie) &&
      (!filter.userId || entry.userId === String(filter.userId)) &&
      (!Number.isFinite(filter.authEpoch) || entry.authEpoch === Number(filter.authEpoch))
    );
    if (!targets.length) return Promise.resolve(true);
    const error = new Error(hasFilter ? "登录会话已切换，网络请求已取消。" : "应用正在退出，网络请求已取消。");
    error.code = hasFilter ? "NEW_API_SESSION_CHANGED" : "APP_SHUTDOWN";
    for (const entry of targets) {
      try { entry.configServer?.close?.(); } catch {}
      if (!entry.body?.destroyed) entry.body?.destroy?.(error);
      if (!entry.child?.killed) entry.child?.kill?.();
    }
    return Promise.race([
      Promise.allSettled(targets.map((entry) => entry.closed)),
      delay(1_500)
    ]).then(() => true);
  }
  
  function activeNewApiCurlTransportCount() {
    return activeNewApiCurlTransports.size;
  }
  
  function newApiResponseHeaders(rawHeaders = {}) {
    const normalized = new Map(
      Object.entries(rawHeaders).map(([name, value]) => [String(name).toLowerCase(), value])
    );
    return {
      get(name) {
        const value = normalized.get(String(name || "").toLowerCase());
        if (Array.isArray(value)) return value.join(", ");
        return value === undefined ? null : String(value);
      },
      getSetCookie() {
        const value = normalized.get("set-cookie");
        if (Array.isArray(value)) return value.map(String);
        return value === undefined ? [] : [String(value)];
      }
    };
  }
  
  function newApiRequestSessionCookie(headers = {}) {
    for (const [name, value] of Object.entries(headers || {})) {
      if (String(name).toLowerCase() !== "cookie") continue;
      const match = String(value || "").match(/(?:^|;\s*)(session=[^;]+)/i);
      if (match) return match[1];
    }
    return "";
  }
  
  function newApiRequestUserId(headers = {}) {
    for (const [name, value] of Object.entries(headers || {})) {
      if (String(name).toLowerCase() === "new-api-user") return String(value || "").trim();
    }
    return "";
  }
  
  async function newApiRequestPayload(url, options = {}) {
    const body = options.body;
    const headers = { ...(options.headers || {}) };
    if (body === undefined || body === null) return { headers, body: null };
    if (options.signal?.aborted) throw newApiAbortError(options.signal);
    const requestedMaximum = Number(options.maxRequestBytes);
    const maximum = Math.max(1 * 1024 * 1024, Math.min(256 * 1024 * 1024, Number.isFinite(requestedMaximum) ? Math.floor(requestedMaximum) : 64 * 1024 * 1024));
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      let estimatedBytes = 0;
      for (const [name, value] of body.entries()) {
        if (options.signal?.aborted) throw newApiAbortError(options.signal);
        estimatedBytes += Buffer.byteLength(String(name || ""), "utf8") + 512;
        estimatedBytes += typeof value === "string" ? Buffer.byteLength(value, "utf8") : Number(value?.size || 0);
        if (estimatedBytes > maximum) {
          const error = new Error("New API 上传内容超过客户端安全上限，请减少图片数量或文件大小。");
          error.code = "NEW_API_REQUEST_TOO_LARGE";
          throw error;
        }
      }
      const request = new Request(url, {
        method: options.method || "POST",
        headers,
        body
      });
      const payload = Buffer.from(await request.arrayBuffer());
      if (options.signal?.aborted) throw newApiAbortError(options.signal);
      if (payload.length > maximum) {
        const error = new Error("New API 上传内容超过客户端安全上限，请减少图片数量或文件大小。");
        error.code = "NEW_API_REQUEST_TOO_LARGE";
        throw error;
      }
      const encodedHeaders = Object.fromEntries(request.headers.entries());
      encodedHeaders["content-length"] = String(payload.length);
      return { headers: encodedHeaders, body: payload };
    }
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (payload.length > maximum) {
      const error = new Error("New API 请求内容超过客户端安全上限。");
      error.code = "NEW_API_REQUEST_TOO_LARGE";
      throw error;
    }
    if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-length")) {
      headers["content-length"] = String(payload.length);
    }
    return { headers, body: payload };
  }
  
  function readNewApiNodeResponse(response, maximum = 256 * 1024 * 1024) {
    if (response?.__naimageTransportError) return Promise.reject(response.__naimageTransportError);
    if (response?.destroyed && !response?.complete) {
      const error = new Error("New API 响应连接已经关闭。");
      error.code = "ERR_STREAM_PREMATURE_CLOSE";
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let ended = false;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > maximum) {
          response.destroy(new Error("New API 响应超过客户端安全上限。"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        ended = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      response.once("error", reject);
      response.once("aborted", () => {
        const error = new Error("New API 响应被中断。");
        error.code = "ERR_STREAM_PREMATURE_CLOSE";
        reject(error);
      });
      response.once("close", () => {
        if (!ended) {
          const error = new Error("New API 响应连接提前关闭。");
          error.code = "ERR_STREAM_PREMATURE_CLOSE";
          reject(error);
        }
      });
    });
  }
  
  function newApiAbortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error(signal?.reason ? String(signal.reason) : "New API 请求已取消。");
    error.code = "ABORT_ERR";
    return error;
  }
  
  function newApiCurlConfigValue(value) {
    return String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  function normalizedNewApiProxyUrl(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      const error = new Error("网络代理地址不是有效的 URL。");
      error.code = "NEW_API_INVALID_PROXY";
      throw error;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      const error = new Error("网络代理只支持 HTTP 或 HTTPS 地址。");
      error.code = "NEW_API_INVALID_PROXY";
      throw error;
    }
    return parsed.toString();
  }
  
  function newApiCurlHeaderBlock(buffer) {
    const crlf = buffer.indexOf(Buffer.from("\r\n\r\n"));
    const lf = buffer.indexOf(Buffer.from("\n\n"));
    if (crlf >= 0 && (lf < 0 || crlf < lf)) return { index: crlf, length: 4 };
    if (lf >= 0) return { index: lf, length: 2 };
    return null;
  }
  
  function newApiTransportMetadata(error, { status = 0, headers = null, method = "GET", phase = "transport" } = {}) {
    const target = error instanceof Error ? error : new Error(String(error || "New API 网络请求失败。"));
    target.status = Number(target.status || status || 0) || 0;
    target.phase = target.phase || phase;
    target.serverRequestId = target.serverRequestId || String(
      headers?.get?.("x-request-id") || headers?.get?.("x-upstream-request-id") || headers?.get?.("request-id") || ""
    );
    target.ambiguous = target.ambiguous === true || (["awaiting_headers", "body"].includes(phase) && !["GET", "HEAD"].includes(String(method || "GET").toUpperCase()));
    return target;
  }
  
  function newApiCurlFailure(code, signal, stderr, stdinError, phase = "connect") {
    const curlCode = Number(code);
    const message = String(stderr || "").trim().slice(0, 4_096) || stdinError?.message || `Windows curl 请求失败（code=${code}, signal=${signal || "none"}）。`;
    const error = new Error(message);
    error.curlCode = Number.isFinite(curlCode) ? curlCode : null;
    error.phase = phase;
    if (curlCode === 5) error.code = "EAI_AGAIN";
    else if (curlCode === 6) error.code = "ENOTFOUND";
    else if (curlCode === 7) error.code = "ECONNREFUSED";
    else if ([18, 52, 56].includes(curlCode)) error.code = "ERR_STREAM_PREMATURE_CLOSE";
    else if ([23, 26, 55].includes(curlCode)) error.code = "EPIPE";
    else if (curlCode === 28) error.code = "ETIMEDOUT";
    else if ([35, 51, 58, 60].includes(curlCode)) error.code = "ERR_TLS_CERTIFICATE";
    else error.code = "CURL_REQUEST_FAILED";
    return error;
  }
  
  async function newApiCurlTransportFetch(target, payload, options = {}) {
    if (!windowsCurlPath || !existsSync(windowsCurlPath)) throw new Error("Windows curl 网络组件不可用。");
    if (options.signal?.aborted) throw newApiAbortError(options.signal);
  
    const method = String(options.method || "GET").toUpperCase();
    const requestedResponseBytes = Number(options.maxResponseBytes);
    const maxResponseBytes = Math.max(1 * 1024 * 1024, Math.min(256 * 1024 * 1024, Number.isFinite(requestedResponseBytes) ? Math.floor(requestedResponseBytes) : 64 * 1024 * 1024));
    const proxyUrl = normalizedNewApiProxyUrl(options.proxyUrl);
    const args = [
      "--silent",
      "--show-error",
      "--include",
      "--no-buffer",
      "--http1.1",
      "--globoff",
      "--request",
      method
    ];
    if (proxyUrl) {
      // Explicit app-level proxy configuration must win over NO_PROXY inherited
      // from the shell. Suppress CONNECT headers so the response parser only
      // sees the upstream HTTP response for HTTPS targets.
      args.push("--proxy", proxyUrl, "--noproxy", "", "--suppress-connect-headers");
    } else {
      args.push("--noproxy", "*");
    }
    const requestedConnectTimeout = Number(options.connectTimeoutMs);
    const connectTimeoutMs = Math.max(1_000, Math.min(120_000, Number.isFinite(requestedConnectTimeout) ? Math.floor(requestedConnectTimeout) : 45_000));
    const requestedHeadersTimeout = Number(options.headersTimeoutMs);
    const headersTimeoutMs = Number.isFinite(requestedHeadersTimeout) && requestedHeadersTimeout > 0
      ? Math.max(1_000, Math.min(10 * 60_000, Math.floor(requestedHeadersTimeout)))
      : 0;
    args.push("--connect-timeout", String(Math.max(1, Math.ceil(connectTimeoutMs / 1000))));
    const idleTimeoutMs = Math.max(0, Math.min(10 * 60_000, Math.floor(Number(options.idleTimeoutMs || 0) || 0)));
    if (idleTimeoutMs > 0) {
      args.push("--speed-limit", "1", "--speed-time", String(Math.max(1, Math.ceil(idleTimeoutMs / 1000))));
    }
    if (payload.body) args.push("--data-binary", "@-");
  
    const configLines = [
      `url = "${newApiCurlConfigValue(target.toString())}"`,
      `user-agent = "${newApiCurlConfigValue(`${applicationName}/${getDesktopVersion()}`)}"`
    ];
    for (const [name, rawValue] of Object.entries(payload.headers || {})) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        const cleanName = String(name || "").replace(/[^!#$%&'*+.^_`|~0-9A-Za-z-]/g, "");
        if (!cleanName) continue;
        configLines.push(`header = "${newApiCurlConfigValue(`${cleanName}: ${value}`)}"`);
      }
    }
    const configText = `${configLines.join("\n")}\n`;
    const configPipe = `\\\\.\\pipe\\naimage-curl-${process.pid}-${randomBytes(12).toString("hex")}`;
    let configDelivered = false;
    const configServer = createNetServer((socket) => {
      socket.on("error", () => {});
      if (configDelivered) {
        socket.destroy();
        return;
      }
      configDelivered = true;
      socket.end(configText, () => {
        try {
          configServer.close();
        } catch {
          // The pipe may already be closing after the single consumer exits.
        }
      });
    });
    await new Promise((resolve, reject) => {
      configServer.once("error", reject);
      configServer.listen(configPipe, () => {
        configServer.removeListener("error", reject);
        resolve();
      });
    });
    configServer.on("error", () => {});
    if (options.signal?.aborted) {
      try {
        configServer.close();
      } catch {
        // The pipe may have been closed by a racing cancellation.
      }
      throw newApiAbortError(options.signal);
    }
    args.push("--config", configPipe);
  
    const child = spawn(windowsCurlPath, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const body = new PassThrough({ highWaterMark: 256 * 1024 });
    const transportEntry = {
      child,
      configServer,
      body,
      sessionCookie: newApiRequestSessionCookie(payload.headers),
      userId: newApiRequestUserId(payload.headers),
      authEpoch: getAuthEpoch(),
      closed: new Promise((resolve) => child.once("close", resolve))
    };
    activeNewApiCurlTransports.add(transportEntry);
    let childClosed = false;
    let responseResolved = false;
    let responseSettled = false;
    let headerBuffer = Buffer.alloc(0);
    let stderr = "";
    let stdinError = null;
    let responseStatus = 0;
    let responseHeaders = null;
    let forcedError = null;
    let headersTimer = null;
  
    const cleanupConfigPipe = () => {
      try {
        configServer.close();
      } catch {
        // The one-shot named pipe may already be closed after curl consumes it.
      }
    };
    const abort = () => {
      const error = newApiAbortError(options.signal);
      if (!childClosed) child.kill();
      if (!body.destroyed) body.destroy(error);
    };
    options.signal?.addEventListener?.("abort", abort, { once: true });
    body.once("error", () => {});
    body.once("close", () => {
      if (!childClosed && responseResolved) child.kill();
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 8 * 1024) stderr += String(chunk);
    });
  
    return new Promise((resolve, reject) => {
      const rejectOnce = (error) => {
        if (responseSettled) return;
        responseSettled = true;
        options.signal?.removeEventListener?.("abort", abort);
        cleanupConfigPipe();
        reject(error);
      };
      const writeBody = (chunk) => {
        if (!chunk?.length || body.destroyed) return;
        if (!body.write(chunk)) {
          child.stdout?.pause();
          body.once("drain", () => child.stdout?.resume());
        }
      };
      const resolveHeaders = (status, rawHeaders, remainder) => {
        if (headersTimer) clearTimeout(headersTimer);
        responseResolved = true;
        responseSettled = true;
        responseStatus = status;
        responseHeaders = newApiResponseHeaders(rawHeaders);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: responseHeaders,
          requestSessionCookie: newApiRequestSessionCookie(payload.headers),
          body,
          text: async () => {
            try {
              return await readNewApiNodeResponse(body, maxResponseBytes);
            } catch (error) {
              throw newApiTransportMetadata(error, { status, headers: responseHeaders, method, phase: "body" });
            }
          }
        });
        writeBody(remainder);
      };
      child.stdout?.on("data", (chunk) => {
        if (responseResolved) {
          writeBody(chunk);
          return;
        }
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        if (headerBuffer.length > 128 * 1024) {
          const error = new Error("New API 响应头超过客户端安全上限。");
          error.code = "ERR_HTTP_HEADERS_OVERFLOW";
          child.kill();
          rejectOnce(error);
          return;
        }
        while (true) {
          const marker = newApiCurlHeaderBlock(headerBuffer);
          if (!marker) return;
          const headerText = headerBuffer.subarray(0, marker.index).toString("latin1");
          const remainder = headerBuffer.subarray(marker.index + marker.length);
          const lines = headerText.split(/\r?\n/);
          const statusMatch = String(lines.shift() || "").match(/^HTTP\/\S+\s+(\d{3})/i);
          if (!statusMatch) {
            const error = new Error("Windows curl 返回了无效的 HTTP 响应头。");
            error.code = "ERR_HTTP_INVALID_HEADER_VALUE";
            child.kill();
            rejectOnce(error);
            return;
          }
          const status = Number(statusMatch[1]);
          if (status >= 100 && status < 200) {
            headerBuffer = remainder;
            continue;
          }
          const rawHeaders = {};
          for (const line of lines) {
            const separator = line.indexOf(":");
            if (separator <= 0) continue;
            const name = line.slice(0, separator).trim().toLowerCase();
            const value = line.slice(separator + 1).trim();
            if (rawHeaders[name] === undefined) rawHeaders[name] = value;
            else if (Array.isArray(rawHeaders[name])) rawHeaders[name].push(value);
            else rawHeaders[name] = [rawHeaders[name], value];
          }
          resolveHeaders(status, rawHeaders, remainder);
          headerBuffer = Buffer.alloc(0);
          return;
        }
      });
      child.once("error", (error) => {
        if (responseResolved) body.destroy(error);
        else rejectOnce(error);
      });
      child.stdin?.on("error", (error) => {
        // A server may reject a large upload (for example with 413) before curl
        // finishes reading stdin. Preserve any HTTP response instead of turning
        // the expected early close into a transport failure.
        stdinError = error;
      });
      child.stdin?.end(payload.body || undefined);
      child.once("close", (code, signal) => {
        activeNewApiCurlTransports.delete(transportEntry);
        childClosed = true;
        if (headersTimer) clearTimeout(headersTimer);
        options.signal?.removeEventListener?.("abort", abort);
        cleanupConfigPipe();
        if (!responseResolved) {
          if (forcedError) {
            rejectOnce(forcedError);
            return;
          }
          const error = newApiCurlFailure(code, signal, stderr, stdinError, "connect");
          const curlCode = Number(code);
          const connectionFailure = [5, 6, 7, 35, 51, 58, 60].includes(curlCode) ||
            (curlCode === 28 && /connect|ssl|tls|handshake|name resolution/i.test(String(stderr || "")));
          const possiblySent = Boolean(payload.body && child.stdin?.writableFinished && !connectionFailure);
          if (possiblySent && !["GET", "HEAD"].includes(method)) {
            error.phase = "awaiting_headers";
            error.ambiguous = true;
          }
          rejectOnce(error);
          return;
        }
        if (code === 0) body.end();
        else {
          const error = newApiTransportMetadata(
            newApiCurlFailure(code, signal, stderr, stdinError, "body"),
            { status: responseStatus, headers: responseHeaders, method, phase: "body" }
          );
          body.destroy(error);
        }
      });
      if (headersTimeoutMs > 0) {
        headersTimer = setTimeout(() => {
          if (responseResolved || childClosed) return;
          forcedError = new Error("New API 等待响应头超时。");
          forcedError.code = "ETIMEDOUT";
          forcedError.phase = payload.body && !["GET", "HEAD"].includes(method) ? "awaiting_headers" : "connect";
          forcedError.ambiguous = forcedError.phase === "awaiting_headers";
          child.kill();
        }, headersTimeoutMs);
      }
    });
  }
  
  async function newApiTransportFetch(url, options = {}) {
    const target = new URL(String(url));
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error("New API 只允许 HTTP 或 HTTPS 地址。");
    }
    const method = String(options.method || "GET").toUpperCase();
    const payload = await newApiRequestPayload(target.toString(), { ...options, method });
    const requestedResponseBytes = Number(options.maxResponseBytes);
    const maxResponseBytes = Math.max(1 * 1024 * 1024, Math.min(256 * 1024 * 1024, Number.isFinite(requestedResponseBytes) ? Math.floor(requestedResponseBytes) : 64 * 1024 * 1024));
    if (!Object.keys(payload.headers).some((name) => name.toLowerCase() === "accept-encoding")) {
      payload.headers["accept-encoding"] = "identity";
    }
    const proxyUrl = normalizedNewApiProxyUrl(options.proxyUrl);
    // Node's native HTTP stack is the stable default used by the original
    // direct-API image path. Curl is retained for an explicitly configured
    // HTTP(S) proxy and for transport self-tests, without changing global or
    // process-wide proxy settings.
    if ((options.forceCurl === true || Boolean(proxyUrl)) && process.platform === "win32" && existsSync(windowsCurlPath)) {
      return newApiCurlTransportFetch(target, payload, { ...options, proxyUrl });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let incomingResponse = null;
      const transport = target.protocol === "https:" ? https : http;
      const request = transport.request(target, {
        method,
        headers: payload.headers
      });
      const requestedHeadersTimeout = Number(options.headersTimeoutMs);
      const headersTimeoutMs = Number.isFinite(requestedHeadersTimeout)
        ? Math.max(1_000, Math.min(10 * 60_000, Math.floor(requestedHeadersTimeout)))
        : 0;
      let headersTimer = null;
      const requestedConnectTimeout = Number(options.connectTimeoutMs);
      const connectTimeoutMs = Number.isFinite(requestedConnectTimeout) && requestedConnectTimeout > 0
        ? Math.max(1_000, Math.min(120_000, Math.floor(requestedConnectTimeout)))
        : 0;
      let connectTimer = null;
      const clearHeadersTimer = () => {
        if (headersTimer) clearTimeout(headersTimer);
        headersTimer = null;
      };
      const clearConnectTimer = () => {
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
      };
      const idleTimeoutMs = Math.max(0, Math.min(10 * 60_000, Math.floor(Number(options.idleTimeoutMs || 0) || 0)));
      const detachAbort = () => options.signal?.removeEventListener?.("abort", abort);
      const abort = () => {
        const error = newApiAbortError(options.signal);
        if (incomingResponse && !incomingResponse.destroyed) {
          incomingResponse.__naimageTransportError = error;
          incomingResponse.destroy(error);
        }
        if (!request.destroyed) request.destroy(error);
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener?.("abort", abort, { once: true });
      if (idleTimeoutMs > 0) {
        request.setTimeout(idleTimeoutMs, () => {
          const error = new Error("New API 连接长时间没有数据，已中断。");
          error.code = "ETIMEDOUT";
          if (incomingResponse && !incomingResponse.destroyed) {
            incomingResponse.__naimageTransportError = error;
            incomingResponse.destroy(error);
          }
          if (!request.destroyed) request.destroy(error);
        });
      }
      if (headersTimeoutMs > 0) {
        headersTimer = setTimeout(() => {
          const error = new Error("New API 等待响应头超时。");
          error.code = "ETIMEDOUT";
          if (!request.destroyed) request.destroy(error);
        }, headersTimeoutMs);
      }
      if (connectTimeoutMs > 0) {
        connectTimer = setTimeout(() => {
          const error = new Error("New API 建立连接超时。");
          error.code = "ETIMEDOUT";
          if (!request.destroyed) request.destroy(error);
        }, connectTimeoutMs);
        request.once("socket", (socket) => {
          if (!socket.connecting) {
            clearConnectTimer();
            return;
          }
          socket.once(target.protocol === "https:" ? "secureConnect" : "connect", clearConnectTimer);
        });
      }
      request.once("response", (incoming) => {
        clearHeadersTimer();
        clearConnectTimer();
        settled = true;
        incomingResponse = incoming;
        const releaseResponse = () => {
          detachAbort();
          incomingResponse = null;
        };
        incoming.once("end", releaseResponse);
        incoming.once("close", releaseResponse);
        incoming.once("aborted", releaseResponse);
        // Keep an error listener attached immediately after headers arrive. A
        // caller may not start consuming the body until the next microtask.
        incoming.once("error", releaseResponse);
        const status = Number(incoming.statusCode || 0);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: newApiResponseHeaders(incoming.headers),
          requestSessionCookie: newApiRequestSessionCookie(payload.headers),
          body: incoming,
          text: async () => {
            try {
              return await readNewApiNodeResponse(incoming, maxResponseBytes);
            } catch (error) {
              throw newApiTransportMetadata(error, {
                status,
                headers: newApiResponseHeaders(incoming.headers),
                method,
                phase: "body"
              });
            }
          }
        });
      });
      request.once("error", (error) => {
        clearHeadersTimer();
        clearConnectTimer();
        if (!settled) {
          detachAbort();
          const phase = request.writableFinished || Number(request.socket?.bytesWritten || 0) > 0 ? "awaiting_headers" : "connect";
          reject(newApiTransportMetadata(error, { method, phase }));
        } else if (incomingResponse && !incomingResponse.destroyed) {
          incomingResponse.__naimageTransportError = error;
          incomingResponse.destroy(error);
        }
      });
      request.once("close", () => {
        clearHeadersTimer();
        clearConnectTimer();
        if (!settled) {
          detachAbort();
          reject(new Error("New API 请求连接提前关闭。"));
        }
      });
      if (payload.body) request.end(payload.body);
      else request.end();
    });
  }

  return {
    activeNewApiCurlTransportCount,
    newApiTransportFetch,
    stopActiveNewApiCurlTransports
  };
}

module.exports = {
  createNewApiTransport
};
