import { createServer } from "node:http";

import { publicError, serviceError } from "./errors.mjs";
import { licenseAdminUiAsset } from "./license-admin-ui.mjs";
import { safeSecretEqual } from "./secrets.mjs";

class FixedWindowLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  take(key, now = Date.now()) {
    if (this.entries.size >= 10_000) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(entryKey);
        if (this.entries.size < 8_000) break;
      }
      if (this.entries.size >= 10_000 && !this.entries.has(key)) return false;
    }
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }
}

function requestIp(request, trustProxy) {
  if (trustProxy) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",", 1)[0].trim();
    if (forwarded) return forwarded.slice(0, 120);
  }
  return String(request.socket.remoteAddress || "unknown").slice(0, 120);
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw serviceError(401, "authorization_required", "需要 Bearer Token。");
  return match[1].trim();
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  response.end(body);
}

function sendAdminAsset(response, asset) {
  response.writeHead(200, {
    "content-type": asset.contentType,
    "content-length": Buffer.byteLength(asset.body),
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow"
  });
  response.end(asset.body);
}

async function readJson(request, maximumBytes) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw serviceError(415, "json_required", "请求必须使用 application/json。");
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > maximumBytes) throw serviceError(413, "request_too_large", "请求体过大。");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw serviceError(413, "request_too_large", "请求体过大。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8") || "{}");
  } catch {
    throw serviceError(400, "json_invalid", "请求 JSON 无效。");
  }
}

function requireAdmin(request, adminToken) {
  if (!safeSecretEqual(bearerToken(request), adminToken)) throw serviceError(403, "admin_forbidden", "管理员凭据无效。");
}

export function createExtensionHttpServer({ config, licenseService, imageTaskService, logger = console }) {
  const activationLimiter = new FixedWindowLimiter({ limit: 12, windowMs: 60_000 });
  const verificationLimiter = new FixedWindowLimiter({ limit: 90, windowMs: 60_000 });
  const imageCreateLimiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000 });

  return createServer(async (request, response) => {
    const startedAt = Date.now();
    let path = "";
    try {
      const url = new URL(request.url || "/", "http://extension.local");
      path = url.pathname;
      const method = String(request.method || "GET").toUpperCase();
      const ip = requestIp(request, config.trustProxy);

      if (method === "GET" && path === "/healthz") {
        sendJson(response, 200, { ok: true, service: "sparkai-extension", image_tasks: imageTaskService.stats() });
        return;
      }

      const adminAsset = method === "GET" ? licenseAdminUiAsset(path) : null;
      if (adminAsset) {
        sendAdminAsset(response, adminAsset);
        return;
      }

      if (method === "GET" && path === "/api/naimage/license") {
        sendJson(response, 200, { success: true, data: licenseService.config() });
        return;
      }

      if (method === "POST" && path === "/api/naimage/license/activate") {
        if (!activationLimiter.take(ip)) throw serviceError(429, "rate_limit_exceeded", "激活请求过于频繁，请稍后重试。");
        const result = licenseService.activate(await readJson(request, 64 * 1024));
        sendJson(response, 200, { success: true, data: result });
        return;
      }

      if (method === "POST" && path === "/api/naimage/license/verify") {
        if (!verificationLimiter.take(ip)) throw serviceError(429, "rate_limit_exceeded", "授权校验过于频繁，请稍后重试。");
        const result = licenseService.verify(await readJson(request, 64 * 1024));
        sendJson(response, 200, { success: true, data: result });
        return;
      }

      if (path === "/api/naimage/license/admin/codes" && method === "POST") {
        requireAdmin(request, config.adminToken);
        const result = licenseService.createCodes(await readJson(request, 64 * 1024));
        sendJson(response, 200, { success: true, data: result });
        return;
      }

      if (path === "/api/naimage/license/admin/codes" && method === "GET") {
        requireAdmin(request, config.adminToken);
        const result = licenseService.listCodes({ page: url.searchParams.get("page"), size: url.searchParams.get("size") });
        sendJson(response, 200, { success: true, data: result });
        return;
      }

      const disableMatch = path.match(/^\/api\/naimage\/license\/admin\/codes\/(\d+)\/disable$/);
      if (disableMatch && method === "POST") {
        requireAdmin(request, config.adminToken);
        const result = licenseService.disableCode(disableMatch[1]);
        sendJson(response, 200, { success: true, data: result });
        return;
      }

      if (method === "POST" && path === "/v1/image-tasks") {
        if (!imageCreateLimiter.take(ip)) throw serviceError(429, "rate_limit_exceeded", "图片任务创建过于频繁，请稍后重试。");
        const result = await imageTaskService.create({
          token: bearerToken(request),
          idempotencyKey: request.headers["idempotency-key"],
          body: await readJson(request, config.maxRequestBytes)
        });
        sendJson(response, 202, { task_id: result.taskId, status: result.status });
        return;
      }

      const taskMatch = path.match(/^\/v1\/image-tasks\/(imgtask_[a-f0-9]{36})$/);
      if (taskMatch && method === "GET") {
        const result = await imageTaskService.get({ taskId: taskMatch[1], token: bearerToken(request) });
        sendJson(response, 200, result);
        return;
      }

      throw serviceError(404, "route_not_found", "接口不存在。");
    } catch (error) {
      const visible = publicError(error);
      if (visible.status >= 500) logger.error?.(`extension request failed path=${path || "unknown"} code=${visible.code}`);
      sendJson(response, visible.status, {
        success: false,
        error: { code: visible.code, message: visible.message },
        message: visible.message
      });
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 2_000) logger.info?.(`extension request slow path=${path || "unknown"} durationMs=${durationMs}`);
    }
  });
}

export async function listen(server, { host, port }) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  return server.address();
}

export async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
