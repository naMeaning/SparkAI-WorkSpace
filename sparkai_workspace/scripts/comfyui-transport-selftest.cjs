"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { once } = require("node:events");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { createComfyUiConnectionProfileService, pinnedLookup } = require("../desktop/comfyui-connection-service.cjs");
const { createComfyUiCredentialStore } = require("../desktop/comfyui-credential-store.cjs");
const { createComfyUiTransport } = require("../desktop/comfyui-transport.cjs");
const { createComfyUiExecutor } = require("../runtime/image-generation/comfyui-executor.cjs");
const { workflow, objectInfo } = require("./comfyui-executor-selftest.cjs");
const { fixtureTls } = require("./comfyui-credential-store-selftest.cjs");

const clone = value => JSON.parse(JSON.stringify(value));
const code = expected => error => error?.code === expected;
const cases = [], fixtures = [];
const metrics = { httpRequests: 0, promptPosts: 0, viewDownloads: 0, queueDeletes: 0, websocketUpgrades: 0, authRejections: 0, tlsClientErrors: 0, dnsLookups: 0, pinnedSocketLookups: 0, fakeRemoteResolutions: 0 };
let imageBytes, temporary;

function json(response, value, status = 200) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function wsFrame(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length < 126) return Buffer.concat([Buffer.from([0x81, bytes.length]), bytes]);
  const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(bytes.length, 2);
  return Buffer.concat([header, bytes]);
}

async function fakeServer(config = {}) {
  const state = { config, requests: [], prompts: [], queueDeletes: [], pending: [], running: [], history: {}, views: 0, websocketUpgrades: 0, websocketDenied: 0, authDenied: 0, tlsClientErrors: 0, sockets: new Set(), timers: new Set(), dropHistory: 0 };
  const prefix = config.prefix || "/proxy";
  const authorized = request => !config.allowedAuth || config.allowedAuth.includes(request.headers.authorization || "");
  function later(action, ms) { const timer = setTimeout(() => { state.timers.delete(timer); action(); }, ms); state.timers.add(timer); }
  function finish(id) {
    const tuple = [...state.pending, ...state.running].find(item => item[1] === id);
    assert.ok(tuple, "fixture completion must refer to an existing task");
    state.pending = state.pending.filter(item => item[1] !== id); state.running = state.running.filter(item => item[1] !== id);
    state.history[id] = { prompt: tuple, status: { completed: true, status_str: "success" }, outputs: { "7": { images: [{ filename: `${id}.png`, subfolder: "fixture", type: "output" }] } } };
  }
  async function handle(request, response) {
    const url = new URL(request.url, "http://localhost"), route = url.pathname.slice(prefix.length) || "/";
    state.requests.push({ method: request.method, route, headers: { ...request.headers }, peerAuthorized: request.socket.authorized === true });
    if (!authorized(request)) { state.authDenied++; return json(response, {}, config.authStatus || 401); }
    if (config.redirectRoute === route) { response.writeHead(302, { location: `${prefix}/object_info` }); return response.end(); }
    if (route === "/system_stats") return json(response, { system: { os: "loopback-fixture" } });
    if (route === "/object_info") return json(response, objectInfo());
    if (route === "/prompt" && request.method === "POST") {
      config.beforePrompt?.();
      const input = await body(request), id = `transport-${state.prompts.length + 1}`;
      const tuple = [state.prompts.length + 1, id, input.prompt, { client_id: input.client_id }, ["7"]];
      state.prompts.push(input); state.pending.push(tuple);
      if (!config.hold) later(() => finish(id), config.finishAfterMs || 20);
      if (config.dropPromptAck) return request.socket.destroy();
      return json(response, { prompt_id: id, number: state.prompts.length, node_errors: {} });
    }
    if (route === "/queue" && request.method === "POST") {
      const input = await body(request); state.queueDeletes.push(input);
      state.pending = state.pending.filter(item => !input.delete.includes(item[1]));
      return json(response, {});
    }
    if (route === "/queue") return json(response, { queue_pending: state.pending, queue_running: state.running });
    if (route === "/history" || route.startsWith("/history/")) {
      config.beforeHistory?.();
      if (state.dropHistory > 0) { state.dropHistory--; return request.socket.destroy(); }
      if (route === "/history") return json(response, state.history);
      const id = decodeURIComponent(route.slice("/history/".length)); return json(response, state.history[id] ? { [id]: state.history[id] } : {});
    }
    if (route === "/view") {
      state.views++;
      if (config.viewRedirect) { response.writeHead(307, { location: `${prefix}/object_info` }); return response.end(); }
      assert.deepEqual([...url.searchParams.keys()].sort(), ["filename", "subfolder", "type"]);
      response.writeHead(200, { "content-type": "image/png" }); return response.end(imageBytes);
    }
    return json(response, {}, 404);
  }
  const handler = (request, response) => { void handle(request, response).catch(() => { if (!response.headersSent) json(response, {}, 500); else response.destroy(); }); };
  const server = config.tls ? https.createServer({ key: config.tls.key, cert: config.tls.cert, ...(config.requestCert ? { requestCert: true, rejectUnauthorized: true, ca: config.tls.ca } : {}) }, handler) : http.createServer(handler);
  server.on("tlsClientError", () => { state.tlsClientErrors++; });
  server.on("connection", socket => { state.sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => state.sockets.delete(socket)); });
  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== `${prefix}/ws` || !authorized(request) || config.wsReject) {
      state.websocketDenied++; socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return;
    }
    state.websocketUpgrades++;
    const accept = crypto.createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    later(() => { if (!socket.destroyed) socket.write(wsFrame({ type: "progress", data: { prompt_id: "transport-1", node: "5", value: 1, max: 4 } })); }, 10);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  state.port = server.address().port; state.prefix = prefix; state.finish = finish;
  state.baseUrl = `${config.tls ? "https" : "http"}://localhost:${state.port}${prefix}/`;
  state.remoteBaseUrl = `https://remote.fixture.test:${state.port}${prefix}/`;
  state.close = async () => {
    for (const timer of state.timers) clearTimeout(timer);
    for (const socket of state.sockets) socket.destroy();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    metrics.httpRequests += state.requests.length; metrics.promptPosts += state.prompts.length; metrics.viewDownloads += state.views; metrics.queueDeletes += state.queueDeletes.length;
    metrics.websocketUpgrades += state.websocketUpgrades; metrics.authRejections += state.authDenied + state.websocketDenied; metrics.tlsClientErrors += state.tlsClientErrors;
  };
  fixtures.push(state); return state;
}

function environment(server, { fakeRemote = false, socketMismatch = false } = {}) {
  const directory = fs.mkdtempSync(path.join(temporary, "environment-")), encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv); const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decryptString(value) { const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8"); }
  };
  const credentialStore = createComfyUiCredentialStore({ safeStorage, secretsPath: path.join(directory, "credentials.json") });
  const actual = createComfyUiConnectionProfileService({ credentialStore, configPath: path.join(directory, "profiles.json"), dnsLookup: async () => { metrics.dnsLookups++; return [{ address: "127.0.0.1", family: 4 }]; } });
  // Test-only façade: production remote scope correctly rejects loopback.
  // Route the fake remote hostname into this in-process fixture to exercise
  // all real URL, credential, TLS, socket, executor and recovery code. No
  // production option or runtime bypass exists, and no public host is used.
  const connectionService = {
    ...actual,
    requestPolicy(profile) {
      const policy = actual.requestPolicy(profile);
      return {
        ...policy,
        async resolveNetwork() {
          let network;
          if (fakeRemote && profile.networkScope === "remote") {
            metrics.fakeRemoteResolutions++;
            const addresses = [{ address: "127.0.0.1", family: 4 }]; network = { addresses, lookup: pinnedLookup(addresses) };
          } else network = await policy.resolveNetwork();
          const lookup = network.lookup;
          return { ...network, ...(socketMismatch ? { addresses: [{ address: "127.0.0.2", family: 4 }] } : {}), lookup(hostname, options, callback) { metrics.pinnedSocketLookups++; lookup(hostname, options, callback); } };
        }
      };
    }
  };
  const transport = createComfyUiTransport({ connectionService });
  const addProfile = (id, extra = {}) => actual.create({ id, networkScope: fakeRemote ? "remote" : "local", baseUrl: fakeRemote ? server.remoteBaseUrl : server.baseUrl, ...extra });
  const preparedPath = path.join(directory, "prepared.json"), acceptedPath = path.join(directory, "accepted.json");
  const persistence = {
    persistPrepared: async snapshot => fs.writeFileSync(preparedPath, JSON.stringify(snapshot)),
    persistAccepted: async snapshot => fs.writeFileSync(acceptedPath, JSON.stringify(snapshot))
  };
  const executor = extra => createComfyUiExecutor({ connectionService, request: transport.request, wsFactory: transport.websocket, ...persistence, ...extra });
  return { directory, credentialStore, actual, connectionService, transport, addProfile, executor, preparedPath, acceptedPath, persistence };
}

const task = (connectionId, submissionId = "transport-operation", extra = {}) => ({ connectionId, submissionId, workflow: workflow(), inputMappings: [], outputNodeId: "7", pollIntervalMs: 10, maxWaitMs: 500, ...extra });
function socketEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Object.assign(Error("WebSocket fixture timed out"), { code: "FIXTURE_TIMEOUT" })); }, 3000);
    socket.once(event, value => { clearTimeout(timer); resolve(value); });
    if (event !== "error") socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
}
async function test(name, action) {
  const start = Date.now();
  try { await action(); cases.push({ name, ok: true, durationMs: Date.now() - start }); }
  catch (error) {
    cases.push({ name, ok: false, code: error.code || error.name, durationMs: Date.now() - start });
    process.stderr.write(`${name}: ${error.code || error.name}\n${String(error.stack || "").split("\n").filter(line => line.startsWith("    at ")).join("\n")}\n`);
  }
}

async function main() {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sparkai-comfyui-transport-"));
  imageBytes = await sharp({ create: { width: 64, height: 96, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 0.5 } } }).png().toBuffer();
  try {
    await test("actual HTTP uses approved DNS socket and strips caller credentials", async () => {
      const server = await fakeServer(), env = environment(server); env.addProfile("local");
      const before = metrics.pinnedSocketLookups;
      const result = await env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "local", headers: { authorization: "untrusted", "proxy-authorization": "untrusted", Cookie: "untrusted", Host: "untrusted.test" } });
      assert.equal(result.status, 200); assert.ok(metrics.pinnedSocketLookups > before);
      const headers = server.requests[0].headers;
      assert.ok(!headers.authorization && !headers["proxy-authorization"] && !headers.cookie, "caller credentials are discarded");
      assert.equal(headers.host, `localhost:${server.port}`);
    });
    await test("only exact reviewed endpoints and one safe history identity reach transport", async () => {
      const server = await fakeServer(), env = environment(server); env.addProfile("endpoint-policy");
      for (const route of ["prompt/extra", "view/extra", "queue/other", "upload/image/extra", "system_stats/extra", "ws/extra", "history/id/extra", "history/a.b", "history/%2foutside"]) {
        await assert.rejects(env.transport.request(`${server.baseUrl}${route}`, { connectionId: "endpoint-policy" }), code("COMFYUI_CONNECTION_ENDPOINT_FORBIDDEN"));
      }
      assert.equal(server.requests.length, 0);
      assert.equal((await env.transport.request(`${server.baseUrl}history/transport-1`, { connectionId: "endpoint-policy" })).status, 200);
      assert.equal(server.requests.length, 1);
    });
    await test("damaged or unreadable profile stores fail closed and preserve original bytes", () => {
      const directory = fs.mkdtempSync(path.join(temporary, "corrupt-profiles-")), configPath = path.join(directory, "profiles.json");
      for (const original of ["{broken", JSON.stringify({ version: 2, profiles: [] }), JSON.stringify({ version: 1, profiles: null })]) {
        fs.writeFileSync(configPath, original);
        assert.throws(() => createComfyUiConnectionProfileService({ configPath }), code("COMFYUI_CONNECTION_STORE_INVALID"));
        assert.equal(fs.readFileSync(configPath, "utf8"), original);
      }
      assert.throws(() => createComfyUiConnectionProfileService({ configPath, readJson: () => { throw Error("private read error"); } }), code("COMFYUI_CONNECTION_STORE_INVALID"));
      const missingPath = path.join(directory, "new-profiles.json"), fresh = createComfyUiConnectionProfileService({ configPath: missingPath });
      assert.deepEqual(fresh.list(), []); assert.equal(fs.existsSync(missingPath), false);
      fresh.ensureDefault(); assert.equal(JSON.parse(fs.readFileSync(missingPath, "utf8")).profiles.length, 1);
    });
    await test("same origin profiles preserve bearer/basic credential isolation", async () => {
      const bearer = "Bearer fixture-bearer", basic = `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`;
      const server = await fakeServer({ allowedAuth: [bearer, basic] }), env = environment(server);
      env.credentialStore.set({ mode: "bearer", id: "bearer-ref" }, { token: "fixture-bearer" });
      env.credentialStore.set({ mode: "basic", id: "basic-ref" }, { username: "fixture-user", password: "fixture-password" });
      env.addProfile("bearer", { credentialRef: { mode: "bearer", id: "bearer-ref" } }); env.addProfile("basic", { credentialRef: { mode: "basic", id: "basic-ref" } });
      await env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "bearer", headers: { authorization: basic } });
      await env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "basic", headers: { authorization: bearer } });
      assert.ok(server.requests[0].headers.authorization === bearer && server.requests[1].headers.authorization === basic, "the selected profile owns authorization");
      const projection = JSON.stringify(env.actual.list());
      for (const secret of ["fixture-bearer", "fixture-password", "bearer-ref", "basic-ref"]) assert.ok(!projection.includes(secret), "public profiles contain no credential references or material");
    });
    await test("401 and 403 fail with a safe transport auth error", async () => {
      for (const authStatus of [401, 403]) {
        const server = await fakeServer({ allowedAuth: ["Bearer accepted"], authStatus }), env = environment(server); env.addProfile("unauthorized");
        await assert.rejects(env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "unauthorized" }), code("COMFYUI_AUTH_FAILED")); assert.equal(server.authDenied, 1);
      }
    });
    await test("HTTP and view redirects never follow the target", async () => {
      const server = await fakeServer({ redirectRoute: "/system_stats" }), env = environment(server); env.addProfile("redirect");
      await assert.rejects(env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "redirect" }), code("COMFYUI_REDIRECT_FORBIDDEN"));
      assert.equal(server.requests.length, 1);
      const viewServer = await fakeServer({ viewRedirect: true }), viewEnv = environment(viewServer); viewEnv.addProfile("view");
      await assert.rejects(viewEnv.executor().run(task("view")), code("COMFYUI_REDIRECT_FORBIDDEN"));
      assert.equal(viewServer.prompts.length, 1); assert.equal(viewServer.views, 1); assert.equal(viewServer.requests.filter(item => item.route === "/object_info").length, 1);
    });
    await test("production remote policy rejects loopback and mixed rebinding before sockets", async () => {
      const server = await fakeServer(), env = environment(server);
      env.addProfile("public-host", { networkScope: "remote", baseUrl: `https://remote.fixture.test:${server.port}/proxy/` });
      await assert.rejects(env.transport.request(`https://remote.fixture.test:${server.port}/proxy/system_stats`, { connectionId: "public-host" }), code("COMFYUI_CONNECTION_DNS_REBINDING"));
      await assert.rejects(env.actual.resolveNetwork({ connectionId: "public-host" }, { lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] }), code("COMFYUI_CONNECTION_DNS_REBINDING"));
      assert.equal(server.requests.length, 0);
    });
    await test("actual socket remote address mismatch is rejected", async () => {
      const server = await fakeServer(), env = environment(server, { socketMismatch: true }); env.addProfile("socket-mismatch");
      await assert.rejects(env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "socket-mismatch" }), code("COMFYUI_CONNECTION_DNS_REBINDING"));
      assert.equal(server.requests.length, 0);
    });
    await test("strict HTTPS rejects an untrusted self-signed certificate", async () => {
      const server = await fakeServer({ tls: fixtureTls() }), env = environment(server); env.addProfile("untrusted");
      await assert.rejects(env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "untrusted", tls: { rejectUnauthorized: false } }), code("COMFYUI_TLS_FAILED")); assert.equal(server.requests.length, 0);
    });
    await test("HTTPS accepts an explicitly protected CA and verifies hostname", async () => {
      const server = await fakeServer({ tls: fixtureTls() }), env = environment(server);
      env.credentialStore.set({ mode: "mtls", id: "ca-material" }, server.config.tls); env.addProfile("trusted", { tls: { caRef: "ca-material" } });
      assert.equal((await env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "trusted" })).status, 200);
      const remote = environment(server, { fakeRemote: true }); remote.credentialStore.set({ mode: "mtls", id: "ca-material" }, server.config.tls); remote.addProfile("wrong-hostname", { tls: { caRef: "ca-material" } });
      await assert.rejects(remote.transport.request(`${server.remoteBaseUrl}system_stats`, { connectionId: "wrong-hostname" }), code("COMFYUI_TLS_FAILED"));
      assert.equal(server.requests.length, 1);
    });
    await test("mTLS uses protected encrypted client keys for HTTPS and WSS", async () => {
      const server = await fakeServer({ tls: fixtureTls(), requestCert: true }), env = environment(server);
      const passphrase = "fixture-key-passphrase", encryptedKey = crypto.createPrivateKey(server.config.tls.key).export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase });
      env.credentialStore.set({ mode: "mtls", id: "mutual-tls" }, { ...server.config.tls, key: encryptedKey, passphrase });
      env.addProfile("mtls", { credentialRef: { mode: "mtls", id: "mutual-tls" } });
      assert.equal((await env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "mtls" })).status, 200); assert.equal(server.requests[0].peerAuthorized, true);
      const socket = env.transport.websocket(`${server.baseUrl.replace(/^https:/, "wss:")}ws?clientId=mtls-fixture`, { connectionId: "mtls" });
      assert.equal(JSON.parse(await socketEvent(socket, "message")).type, "progress"); socket.close();
      env.addProfile("no-client-cert", { tls: { caRef: "mutual-tls" } });
      await assert.rejects(env.transport.request(`${server.baseUrl}system_stats`, { connectionId: "no-client-cert" }), code("COMFYUI_TLS_FAILED")); assert.equal(server.requests.length, 1);
    });
    await test("WebSocket auth and clientId use the same profile policy", async () => {
      const server = await fakeServer({ allowedAuth: ["Bearer websocket-fixture"] }), env = environment(server);
      env.credentialStore.set({ mode: "bearer", id: "websocket-auth" }, { token: "websocket-fixture" }); env.addProfile("ws", { credentialRef: { mode: "bearer", id: "websocket-auth" } }); env.addProfile("ws-denied");
      const url = `${server.baseUrl.replace(/^http:/, "ws:")}ws?clientId=socket-fixture`;
      const socket = env.transport.websocket(url, { connectionId: "ws", headers: { authorization: "untrusted" } });
      assert.equal(JSON.parse(await socketEvent(socket, "message")).data.value, 1); socket.close();
      const denied = env.transport.websocket(url, { connectionId: "ws-denied" });
      assert.equal((await socketEvent(denied, "error")).code, "COMFYUI_WS_REJECTED"); denied.close();
      assert.equal(server.websocketUpgrades, 1); assert.equal(server.websocketDenied, 1);
    });
    await test("executor rejects same-origin different-profile submission conflict before network", async () => {
      const server = await fakeServer(), env = environment(server); env.addProfile("one"); env.addProfile("two");
      const executor = env.executor(); assert.equal((await executor.run(task("one"))).ok, true);
      const before = server.requests.length;
      await assert.rejects(executor.run(task("two")), code("COMFYUI_SUBMISSION_CONFLICT"));
      assert.equal(server.requests.length, before); assert.equal(server.prompts.length, 1);
    });
    await test("fake remote HTTPS executes with disk prepared/accepted order and authenticated view", async () => {
      const server = await fakeServer({ tls: fixtureTls("remote.fixture.test"), allowedAuth: ["Bearer remote-fixture"], finishAfterMs: 45 }), env = environment(server, { fakeRemote: true });
      env.credentialStore.set({ mode: "bearer", id: "remote-token" }, { token: "remote-fixture" }); env.credentialStore.set({ mode: "mtls", id: "remote-ca" }, server.config.tls);
      env.addProfile("remote", { credentialRef: { mode: "bearer", id: "remote-token" }, tls: { caRef: "remote-ca" } });
      server.config.beforePrompt = () => assert.equal(JSON.parse(fs.readFileSync(env.preparedPath, "utf8")).connectionId, "remote");
      server.config.beforeHistory = () => assert.equal(JSON.parse(fs.readFileSync(env.acceptedPath, "utf8")).promptId, "transport-1");
      const progress = [], result = await env.executor().run(task("remote", "remote-success", { onStatus: status => progress.push(status) }));
      assert.equal(result.ok, true); assert.equal(result.images[0].width, 64); assert.equal(result.images[0].height, 96); assert.equal(server.views, 1);
      assert.ok(progress.some(status => status.type === "progress")); assert.ok(server.requests.every(item => item.headers.authorization === "Bearer remote-fixture"));
      const saved = fs.readFileSync(env.acceptedPath, "utf8");
      for (const secret of ["Bearer remote-fixture", "remote-token", "remote-ca", "PRIVATE KEY", "CERTIFICATE"]) assert.ok(!saved.includes(secret), "Main task snapshots contain no credential material or references");
    });
    await test("fake remote lost acknowledgement recovers on restart without another prompt POST", async () => {
      const server = await fakeServer({ tls: fixtureTls("remote.fixture.test"), hold: true, dropPromptAck: true }), env = environment(server, { fakeRemote: true });
      env.credentialStore.set({ mode: "mtls", id: "remote-ca" }, server.config.tls); env.addProfile("remote", { tls: { caRef: "remote-ca" } });
      const executor = env.executor(), input = task("remote", "lost-ack");
      await assert.rejects(executor.run(input), error => error.code === "COMFYUI_SUBMISSION_UNKNOWN" && error.unsafeToRetry === true);
      await assert.rejects(executor.run(input), code("COMFYUI_SUBMISSION_UNKNOWN")); assert.equal(server.prompts.length, 1); assert.equal(fs.existsSync(env.acceptedPath), false);
      const prepared = JSON.parse(fs.readFileSync(env.preparedPath, "utf8"));
      assert.equal((await env.executor().recover({ accepted: prepared })).state, "queued");
      const accepted = JSON.parse(fs.readFileSync(env.acceptedPath, "utf8")); server.finish(accepted.promptId);
      assert.equal((await env.executor().recover({ accepted })).ok, true); assert.equal(server.prompts.length, 1);
    });
    await test("fake remote poll disconnect preserves accepted identity for restart recovery", async () => {
      const server = await fakeServer({ tls: fixtureTls("remote.fixture.test"), hold: true }), env = environment(server, { fakeRemote: true });
      env.credentialStore.set({ mode: "mtls", id: "remote-ca" }, server.config.tls); env.addProfile("remote", { tls: { caRef: "remote-ca" } }); server.dropHistory = 1;
      await assert.rejects(env.executor().run(task("remote", "poll-disconnect")), error => error.code === "COMFYUI_CONNECTION_FAILED" && error.unsafeToRetry === true);
      const accepted = JSON.parse(fs.readFileSync(env.acceptedPath, "utf8")); server.finish(accepted.promptId);
      assert.equal((await env.executor().recover({ accepted })).ok, true); assert.equal(server.prompts.length, 1);
      const before = server.requests.length; env.actual.update("remote", { label: "label-only edit" });
      assert.equal((await env.executor().recover({ accepted })).ok, true, "display-only edits preserve execution identity");
      env.credentialStore.set({ mode: "bearer", id: "new-auth" }, { token: "new-fixture" }); env.actual.update("remote", { credentialRef: { mode: "bearer", id: "new-auth" } });
      const beforeDrift = server.requests.length;
      await assert.rejects(env.executor().recover({ accepted }), code("COMFYUI_TASK_OWNERSHIP_MISMATCH")); assert.equal(server.requests.length, beforeDrift); assert.ok(beforeDrift > before);
    });
    await test("fake remote queue cancel preserves other tasks and never interrupts running work", async () => {
      const server = await fakeServer({ tls: fixtureTls("remote.fixture.test"), hold: true }), env = environment(server, { fakeRemote: true });
      env.credentialStore.set({ mode: "mtls", id: "remote-ca" }, server.config.tls); env.addProfile("remote", { tls: { caRef: "remote-ca" } });
      await assert.rejects(env.executor().run(task("remote", "queued-task", { maxWaitMs: 50 })), code("COMFYUI_TIMEOUT"));
      const accepted = JSON.parse(fs.readFileSync(env.acceptedPath, "utf8")), other = clone(server.pending[0]); other[1] = "someone-else"; other[3].client_id = "someone-else"; server.pending.push(other);
      assert.equal((await env.executor().cancel({ accepted })).canceled, true); assert.deepEqual(server.queueDeletes, [{ delete: [accepted.promptId] }]); assert.deepEqual(server.pending.map(item => item[1]), ["someone-else"]);
      await assert.rejects(env.executor().run(task("remote", "running-task", { maxWaitMs: 50 })), code("COMFYUI_TIMEOUT"));
      const running = JSON.parse(fs.readFileSync(env.acceptedPath, "utf8")), tuple = server.pending.find(item => item[1] === running.promptId);
      server.pending = server.pending.filter(item => item !== tuple); server.running.push(tuple);
      await assert.rejects(env.executor().cancel({ accepted: running }), code("COMFYUI_CANCEL_UNSUPPORTED")); assert.equal(server.queueDeletes.length, 1); assert.ok(!server.requests.some(item => item.route === "/interrupt"));
    });
  } finally {
    for (const fixture of fixtures) await fixture.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const report = { ok: cases.every(item => item.ok), cases: cases.length, results: cases, metrics, fixtureNetworkOverride: true, fakeRemoteLoopbackRouting: true, actualPinnedTransport: true, realRemoteRequests: 0, realLanRequests: 0, realModelRequests: 0, limits: ["Remote HTTPS hostname is routed to loopback only inside this test facade; production rejects that mapping.", "No real ComfyUI, public network, LAN host, model, dependency install or download was used."] };
  const reportPath = path.resolve(__dirname, "../.diagnostics/comfyui-transport/report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: ".diagnostics/comfyui-transport/report.json" })}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { process.stderr.write(`Transport fixture failed: ${error.code || error.name}\n`); process.exitCode = 1; });
