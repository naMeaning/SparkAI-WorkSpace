"use strict";

const http = require("node:http");
const path = require("node:path");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { randomBytes, timingSafeEqual } = require("node:crypto");

const MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

function safeTokenEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function jsonResponse(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store"
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(new Error("自动化请求体超过 1 MB。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("自动化请求不是有效 JSON。"));
      }
    });
    request.on("error", reject);
  });
}

function createAutomationService({ BrowserWindow, configDir, version, executablePath, log }) {
  const automationDir = path.join(configDir, "automation");
  const endpointPath = path.join(automationDir, "endpoint.json");
  const token = randomBytes(32).toString("hex");
  const pending = new Map();
  const rendererIds = new Set();
  let server = null;
  let endpoint = null;

  function activeRenderer() {
    return BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed() && rendererIds.has(window.webContents.id))
      .sort((left, right) => Number(right.isFocused()) - Number(left.isFocused()))[0] || null;
  }

  function status() {
    return {
      ok: true,
      service: "naimage-automation",
      version: 1,
      appVersion: String(version || ""),
      rendererReady: Boolean(activeRenderer()),
      pid: process.pid
    };
  }

  function dispatch(command, args = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    const cleanCommand = String(command || "").trim().slice(0, 120);
    if (!cleanCommand) return Promise.reject(new Error("缺少自动化命令。"));
    const window = activeRenderer();
    if (!window) return Promise.reject(new Error("naimage 界面尚未就绪，请稍后重试。"));
    const requestId = `automation-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`自动化命令超时：${cleanCommand}`));
      }, Math.max(1_000, Math.min(30 * 60 * 1000, Number(timeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS)));
      pending.set(requestId, { resolve, reject, timer, webContentsId: window.webContents.id });
      window.webContents.send("naimage:automation:request", {
        requestId,
        command: cleanCommand,
        args: args && typeof args === "object" && !Array.isArray(args) ? args : {}
      });
    });
  }

  function rendererReady(webContents) {
    if (!webContents || webContents.isDestroyed()) return { ok: false, error: "Renderer 不可用。" };
    if (rendererIds.has(webContents.id)) return { ok: true };
    rendererIds.add(webContents.id);
    webContents.once("destroyed", () => rendererIds.delete(webContents.id));
    return { ok: true };
  }

  function resolveRendererResponse(webContents, payload = {}) {
    const requestId = String(payload.requestId || "");
    const item = pending.get(requestId);
    if (!item || item.webContentsId !== webContents?.id) return false;
    pending.delete(requestId);
    clearTimeout(item.timer);
    if (payload.ok === false) item.reject(new Error(String(payload.error || "自动化命令执行失败。")));
    else item.resolve(payload.result);
    return true;
  }

  async function handleRequest(request, response) {
    const remoteAddress = String(request.socket.remoteAddress || "");
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) {
      jsonResponse(response, 403, { ok: false, error: "只允许本机访问。" });
      return;
    }
    const authorization = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!safeTokenEqual(authorization, token)) {
      jsonResponse(response, 401, { ok: false, error: "自动化令牌无效。" });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/status") {
      jsonResponse(response, 200, status());
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/execute") {
      jsonResponse(response, 404, { ok: false, error: "未知自动化端点。" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await dispatch(body.command, body.args, body.timeoutMs);
      jsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      jsonResponse(response, /尚未就绪/.test(String(error?.message || "")) ? 503 : 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function start() {
    if (server) return Promise.resolve(endpoint);
    mkdirSync(automationDir, { recursive: true });
    server = http.createServer((request, response) => void handleRequest(request, response));
    server.on("clientError", (_error, socket) => socket.destroy());
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = address && typeof address === "object" ? address.port : 0;
        endpoint = {
          version: 1,
          host: "127.0.0.1",
          port,
          token,
          pid: process.pid,
          appVersion: String(version || ""),
          executablePath: String(executablePath || ""),
          updatedAt: new Date().toISOString()
        };
        writeFileSync(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        log(`automation service ready port=${port}`);
        resolve(endpoint);
      });
    });
  }

  async function stop() {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("naimage 正在退出。"));
    }
    pending.clear();
    rendererIds.clear();
    rmSync(endpointPath, { force: true });
    if (!server) return;
    const current = server;
    server = null;
    await new Promise((resolve) => current.close(() => resolve()));
  }

  return {
    endpointPath,
    start,
    stop,
    status,
    rendererReady,
    resolveRendererResponse
  };
}

module.exports = { createAutomationService };
