"use strict";

const http = require("node:http");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { createHash, randomBytes } = require("node:crypto");
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const addressKey = value => String(value || "").replace(/^::ffff:/i, "").toLowerCase();

/** Main-only transport. DNS approval is pinned into each socket; no proxy,
 * redirects, cookies, implicit auth or disabled TLS verification. */
function createComfyUiTransport({ connectionService, assertNetworkAllowed = () => {} }) {
  const activeRemote = new Set();
  async function prepare(value, config, kind = "http") {
    const profile = config.connection || connectionService.resolve({ connectionId: config.connectionId, baseUrl: config.baseUrl });
    assertNetworkAllowed(profile);
    const policy = connectionService.requestPolicy(profile);
    const url = new URL(policy.authorizeUrl(value, { kind }));
    const network = await policy.resolveNetwork();
    assertNetworkAllowed(profile);
    const credentials = connectionService.credentialHeaders(profile);
    const tls = credentials.tls || {};
    const headers = { ...config.headers };
    for (const key of Object.keys(headers)) if (/^(?:authorization|proxy-authorization|cookie|host)$/i.test(key)) delete headers[key];
    Object.assign(headers, credentials.headers);
    return { url, network, headers, tls, profile };
  }
  function verifySocket(socket, network) {
    const approved = new Set(network.addresses.map(item => addressKey(item.address)));
    const verify = () => { if (!approved.has(addressKey(socket.remoteAddress))) socket.destroy(fail("COMFYUI_CONNECTION_DNS_REBINDING", "ComfyUI socket 地址与已批准解析不一致。")); };
    socket.once(socket.encrypted ? "secureConnect" : "connect", verify);
  }
  function requestOptions(prepared, config, websocket = false) {
    assertNetworkAllowed(prepared.profile);
    const { url, network, headers, tls } = prepared;
    return {
      protocol: url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || undefined,
      path: url.pathname + url.search, method: config.method || "GET", headers,
      lookup: network.lookup, agent: false, rejectUnauthorized: true,
      ...(tls.ca ? { ca: tls.ca } : {}), ...(tls.cert ? { cert: tls.cert } : {}), ...(tls.key ? { key: tls.key } : {}),
      ...(tls.passphrase ? { passphrase: tls.passphrase } : {}),
      maxHeaderSize: 32 * 1024, ...(websocket ? {} : { signal: config.signal })
    };
  }
  async function request(value, config = {}) {
    const prepared = await prepare(value, config);
    let body = config.body;
    if (body !== undefined && body !== null) {
      const encoded = new Request(prepared.url, { method: config.method || "POST", body, headers: prepared.headers });
      body = Buffer.from(await encoded.arrayBuffer());
      if (body.length > 136 * 1024 * 1024) throw fail("COMFYUI_REQUEST_TOO_LARGE", "ComfyUI 请求超过大小限制。");
      const contentType = encoded.headers.get("content-type");
      if (contentType) prepared.headers["content-type"] = contentType;
      prepared.headers["content-length"] = body.length;
    }
    return new Promise((resolve, reject) => {
      const options = requestOptions(prepared, config);
      const req = (options.protocol === "https:" ? https : http).request(options, response => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(fail(status >= 300 && status < 400 ? "COMFYUI_REDIRECT_FORBIDDEN" : status === 401 || status === 403 ? "COMFYUI_AUTH_FAILED" : "COMFYUI_HTTP_ERROR", `ComfyUI 请求失败（${status}）。`, { status }));
          return;
        }
        const chunks = []; let size = 0;
        response.on("data", chunk => {
          size += chunk.length;
          if (size > (config.maxBytes || 8 * 1024 * 1024)) req.destroy(fail("COMFYUI_RESPONSE_TOO_LARGE", "ComfyUI 响应超过大小限制。"));
          else chunks.push(chunk);
        });
        response.on("error", () => reject(fail("COMFYUI_CONNECTION_FAILED", "ComfyUI 响应连接中断。")));
        response.on("end", () => {
          const bytes = Buffer.concat(chunks), contentType = String(response.headers["content-type"] || "").toLowerCase();
          let parsed;
          if (contentType.includes("json")) {
            try { parsed = JSON.parse(bytes.toString("utf8")); }
            catch { reject(fail("COMFYUI_RESPONSE_INVALID", "ComfyUI 返回了无效 JSON。")); return; }
          }
          resolve({ status, body: parsed, bytes, contentType });
        });
      });
      if (prepared.profile.networkScope !== "local") { activeRemote.add(req); req.once("close", () => activeRemote.delete(req)); }
      req.on("socket", socket => verifySocket(socket, prepared.network));
      req.setTimeout(30_000, () => req.destroy(fail("COMFYUI_CONNECTION_TIMEOUT", "ComfyUI 连接超时。")));
      req.on("error", cause => reject(cause.code?.startsWith("COMFYUI_") ? cause : fail(config.signal?.aborted ? "ABORT_ERR" : /CERT|TLS|SSL|SELF_SIGNED/.test(cause.code || "") ? "COMFYUI_TLS_FAILED" : "COMFYUI_CONNECTION_FAILED", config.signal?.aborted ? "ComfyUI 等待已取消。" : "ComfyUI 连接或 TLS 校验失败。")));
      req.end(body || undefined);
    });
  }
  function websocket(value, config = {}) {
    const emitter = new EventEmitter();
    let req, socket, closed = false, upgraded = false, pending = Buffer.alloc(0), fragments = [], fragmentBytes = 0;
    emitter.on("error", () => {});
    const close = () => { if (closed) return; closed = true; req?.destroy(); socket?.destroy(); emitter.emit("close"); };
    emitter.close = close;
    const sendFrame = (opcode, bytes) => {
      if (!socket || closed || bytes.length > 125) return;
      const mask = randomBytes(4), frame = Buffer.alloc(6 + bytes.length);
      frame[0] = 0x80 | opcode; frame[1] = 0x80 | bytes.length; mask.copy(frame, 2);
      for (let i = 0; i < bytes.length; i++) frame[6 + i] = bytes[i] ^ mask[i % 4];
      socket.write(frame);
    };
    const handle = chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 2 * 1024 * 1024) { close(); return; }
      while (pending.length >= 2) {
        const first = pending[0], second = pending[1], opcode = first & 15, final = !!(first & 128);
        if (first & 112 || second & 128) { close(); return; }
        let length = second & 127, header = 2;
        if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); header = 4; }
        if (length === 127) { if (pending.length < 10) return; const big = pending.readBigUInt64BE(2); if (big > 1024n * 1024n) { close(); return; } length = Number(big); header = 10; }
        if (length > 1024 * 1024 || opcode >= 8 && (!final || length > 125)) { close(); return; }
        if (pending.length < header + length) return;
        const payload = pending.subarray(header, header + length); pending = pending.subarray(header + length);
        if (opcode === 8) { close(); return; }
        if (opcode === 9) { sendFrame(10, payload); continue; }
        if (opcode === 10) continue;
        if (opcode === 2) { if (!final) { close(); return; } continue; } // Binary previews never enter assets or status.
        if (opcode !== 0 && opcode !== 1 || opcode === 0 && !fragments.length || opcode === 1 && fragments.length) { close(); return; }
        fragments.push(payload); fragmentBytes += payload.length;
        if (fragmentBytes > 256 * 1024) { close(); return; }
        if (final) { emitter.emit("message", Buffer.concat(fragments).toString("utf8"), false); fragments = []; fragmentBytes = 0; }
      }
    };
    void prepare(value, config, "ws").then(prepared => {
      if (closed) return;
      const key = randomBytes(16).toString("base64"), expected = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      Object.assign(prepared.headers, { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key });
      const options = requestOptions(prepared, config, true);
      req = (options.protocol === "https:" ? https : http).request(options);
      if (prepared.profile.networkScope !== "local") {
        activeRemote.add(req); req.once("close", () => { if (!upgraded) activeRemote.delete(req); });
      }
      req.on("socket", value => verifySocket(value, prepared.network));
      req.setTimeout(15_000, close);
      req.on("response", response => { response.resume(); emitter.emit("error", fail("COMFYUI_WS_REJECTED", "ComfyUI WebSocket 握手被拒绝。")); close(); });
      req.on("upgrade", (response, value, head) => {
        upgraded = true; value.once("close", () => activeRemote.delete(req));
        if (closed || response.statusCode !== 101 || response.headers["sec-websocket-accept"] !== expected || String(response.headers.upgrade).toLowerCase() !== "websocket") { value.destroy(); close(); return; }
        socket = value; socket.setTimeout(0); socket.on("data", handle); socket.on("error", () => close()); socket.on("close", close); if (head.length) handle(head);
        emitter.emit("open");
      });
      req.on("error", () => close()); req.end();
    }).catch(error => { emitter.emit("error", error); close(); });
    return emitter;
  }
  return { request, websocket, activeRemoteCount: () => activeRemote.size };
}
module.exports = { createComfyUiTransport };
