"use strict";

// Exercise the ordinary native transport and actual Main selection admission.
// Other Main owners are idle stubs; only this loopback server may receive data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const https = require("node:https");
const { once } = require("node:events");
const { createHash } = require("node:crypto");
const { createNewApiTransport } = require("../desktop/new-api-transport.cjs");
const { createAgentProviderService } = require("../desktop/agent-provider-service.cjs");

const repo = path.resolve(__dirname, "..");
const runDir = path.join(repo, ".diagnostics", `agent-network-transition-${Date.now()}`);
const fixtures = path.join(runDir, "fixtures");
fs.mkdirSync(fixtures, { recursive: true });
const results = [], requests = [], externalAttempts = [], sockets = new Set(), clientRequests = new Set();
let transport, service, heldResponse, requestCalls = 0, clientSockets = 0, serverConnections = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
async function waitFor(predicate, label) {
  const until = Date.now() + 3000;
  while (!predicate()) {
    assert(Date.now() < until, `Timed out: ${label}`);
    await delay(4);
  }
}
async function test(name, action) {
  const started = Date.now();
  await action();
  results.push({ name, ok: true, durationMs: Date.now() - started });
}
function networkSnapshot() { return { requests: requests.length, requestCalls, clientSockets, serverConnections }; }
function sourceHash(file) { return createHash("sha256").update(fs.readFileSync(path.join(repo, file))).digest("hex"); }

// Contain any regression before it could leave the fixture. This watcher never
// supplies a response, changes the request destination or bypasses a rejection.
const nativeHttp = http.request, nativeHttps = https.request;
function guard(original, args) {
  const target = args[0];
  const host = typeof target === "string" || target instanceof URL ? new URL(target).hostname : target.hostname || target.host || "localhost";
  if (host !== "127.0.0.1") {
    externalAttempts.push("nonloopback");
    throw new Error("This fixture forbids nonloopback HTTP.");
  }
  requestCalls++;
  const request = original.apply(this, args);
  clientRequests.add(request);
  request.once("socket", () => { clientSockets++; });
  request.once("close", () => clientRequests.delete(request));
  return request;
}
http.request = function(...args) { return guard.call(this, nativeHttp, args); };
https.request = function(...args) { return guard.call(this, nativeHttps, args); };

const server = http.createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  request.on("error", () => {});
  response.on("error", () => {});
  if (request.url === "/held" || request.url === "/error-body") {
    heldResponse = response;
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("before-strict");
  } else if (request.url === "/abort-before-headers") heldResponse = response;
  else if (request.url === "/disconnect") request.socket.destroy();
  else response.writeHead(200, { "content-type": "text/plain" }).end("fixture");
});
server.on("connection", socket => {
  serverConnections++;
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});

function mainSelectionAdmission() {
  // Reuse Main's actual hook rather than duplicate the set of owners that must
  // be idle. A hook refactor must update this extraction and its regression.
  const source = fs.readFileSync(path.join(repo, "electron-main.cjs"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("  beforeSelect(next) {", source.indexOf("agentProviderService = createAgentProviderService({"));
  assert(start > 0, "Main must supply the provider selection admission hook.");
  const end = source.indexOf("\n  }\n});", start);
  assert(end > start, "Main provider selection hook extraction must remain explicit.");
  const hook = source.slice(start, end + "\n  }".length);
  return vm.runInNewContext(`({${hook}}).beforeSelect`, {
    agentRunControl: { snapshot: () => ({ runs: [] }) },
    comfyUiExecutor: { active: new Map() },
    comfyUiTransport: { activeRemoteCount: () => 0 },
    activeNewApiTransportCount: () => transport.activeNewApiTransportCount(),
    activeVideoDownloads: 0,
    remoteImageDownloads: { snapshot: () => ({ inFlight: 0 }) },
    managedArtifactStore: { listDownloads: () => [] }
  });
}

async function run() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profileFile = path.join(fixtures, "native-profile.json");
  fs.writeFileSync(profileFile, JSON.stringify({ schemaVersion: 1, label: "Strict transition fixture", kind: "local-openai-compatible", modelId: "fixture-model", baseUrl: origin + "/v1", capabilities: { tools: true, vision: false, contextWindowTokens: 4096, maxOutputTokens: 512 } }));
  service = createAgentProviderService({
    rootDir: path.join(fixtures, "profiles"),
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [profileFile] }; } },
    safeStorage: { isEncryptionAvailable: () => false },
    beforeSelect: mainSelectionAdmission()
  });
  transport = createNewApiTransport({
    assertNetworkAllowed() {
      if (service.isStrictOffline()) throw Object.assign(new Error("Strict offline blocks cloud transport."), { code: "AGENT_OFFLINE_BLOCKED" });
    }
  });
  const imported = await service.importProfile();
  assert.equal(imported.ok, true, imported.error);
  const select = strictOffline => service.select({ profileId: imported.profile.profileId, strictOffline });
  assert.equal((await select(false)).ok, true);
  const assertIdle = () => waitFor(() => transport.activeNewApiTransportCount() === 0, "native activity release");

  await test("held native response blocks Main strict selection until request and response close", async () => {
    const response = await transport.newApiTransportFetch(origin + "/held");
    const body = response.text();
    assert.equal(transport.activeNewApiTransportCount(), 1);
    assert.equal(transport.activeNewApiCurlTransportCount(), 0);
    const blocked = await select(true);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errorCode, "AGENT_PROVIDER_BUSY");
    assert.equal(service.isStrictOffline(), false);
    heldResponse.write("during-still-online");
    await delay(20);
    assert.equal(transport.activeNewApiTransportCount(), 1);
    heldResponse.end("after-close");
    assert.equal(await body, "before-strictduring-still-onlineafter-close");
    await assertIdle();
    const admitted = await select(true);
    assert.equal(admitted.ok, true, admitted.error);
    assert.equal(service.isStrictOffline(), true);
    const before = networkSnapshot();
    await assert.rejects(transport.newApiTransportFetch(origin + "/blocked"), error => error.code === "AGENT_OFFLINE_BLOCKED");
    assert.deepEqual(networkSnapshot(), before, "An offline denial must create no request or socket.");
    assert.equal((await select(false)).ok, true);
  });

  await test("normal body end releases activity", async () => {
    const response = await transport.newApiTransportFetch(origin + "/normal");
    assert.equal(await response.text(), "fixture");
    await assertIdle();
  });

  await test("body error releases activity after both close events", async () => {
    const response = await transport.newApiTransportFetch(origin + "/error-body");
    const body = response.text();
    assert.equal(transport.activeNewApiTransportCount(), 1);
    heldResponse.socket.destroy();
    await assert.rejects(body);
    await assertIdle();
  });

  await test("preheader disconnect releases activity", async () => {
    await assert.rejects(transport.newApiTransportFetch(origin + "/disconnect"));
    await assertIdle();
  });

  await test("preheader abort blocks strict while live and releases activity", async () => {
    const controller = new AbortController();
    heldResponse = undefined;
    const pending = transport.newApiTransportFetch(origin + "/abort-before-headers", { signal: controller.signal });
    await waitFor(() => heldResponse !== undefined, "abort fixture entered");
    assert.equal(transport.activeNewApiTransportCount(), 1);
    assert.equal((await select(true)).errorCode, "AGENT_PROVIDER_BUSY");
    controller.abort();
    await assert.rejects(pending);
    await assertIdle();
  });

  await test("postheader abort retains activity until close", async () => {
    const controller = new AbortController();
    const response = await transport.newApiTransportFetch(origin + "/held", { signal: controller.signal });
    const body = response.text();
    assert.equal(transport.activeNewApiTransportCount(), 1);
    controller.abort();
    await assert.rejects(body);
    await assertIdle();
  });

  await test("preaborted request sends no request and leaves no activity", async () => {
    const controller = new AbortController();
    controller.abort();
    const before = requests.length;
    await assert.rejects(transport.newApiTransportFetch(origin + "/never-sent", { signal: controller.signal }));
    await assertIdle();
    assert.equal(requests.length, before);
  });

  await test("payload await rechecks offline permission before any request or socket", async () => {
    const NativeRequest = globalThis.Request, entered = deferred(), proceed = deferred();
    // Delay real FormData serialization to make the permission change
    // deterministic. The transport and all socket code remain unmodified.
    globalThis.Request = class extends NativeRequest {
      async arrayBuffer() { entered.resolve(); await proceed.promise; return super.arrayBuffer(); }
    };
    try {
      const body = new FormData();
      body.set("fixture", "serialization only");
      const before = networkSnapshot();
      const pending = transport.newApiTransportFetch(origin + "/serialization-race", { method: "POST", body });
      await entered.promise;
      assert.equal(transport.activeNewApiTransportCount(), 0);
      const selected = await select(true);
      assert.equal(selected.ok, true, selected.error);
      proceed.resolve();
      await assert.rejects(pending, error => error.code === "AGENT_OFFLINE_BLOCKED");
      assert.deepEqual(networkSnapshot(), before, "Postserialization denial must create zero requests and zero sockets.");
      assert.equal(transport.activeNewApiTransportCount(), 0);
    } finally {
      proceed.resolve();
      globalThis.Request = NativeRequest;
    }
  });
  assert.equal(externalAttempts.length, 0);
  return { ok: true, phase: 4, cases: results.length, results, loopbackRequests: requests.length, nonLoopbackRequests: 0, externalAttempts: externalAttempts.length, realModelRequests: 0, modelDownloads: 0, dependencyInstalls: 0, activeTransportCountAtEnd: transport.activeNewApiTransportCount(), mainHookExtractedFromLiveSource: true, sourceSha256: Object.fromEntries(["desktop/new-api-transport.cjs", "desktop/agent-provider-service.cjs", "electron-main.cjs", "scripts/agent-network-transition-selftest.cjs"].map(file => [file, sourceHash(file)])) };
}

run().then(report => {
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ report: path.join(runDir, "report.json"), ...report }, null, 2) + "\n");
}).catch(error => {
  fs.writeFileSync(path.join(runDir, "failure.json"), JSON.stringify({ ok: false, code: error.code, error: error.message, results, activeTransportCount: transport?.activeNewApiTransportCount() }, null, 2));
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
}).finally(async () => {
  await service?.dispose();
  for (const request of clientRequests) request.destroy();
  for (const socket of sockets) socket.destroy();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  http.request = nativeHttp;
  https.request = nativeHttps;
  fs.rmSync(fixtures, { recursive: true, force: true });
});
