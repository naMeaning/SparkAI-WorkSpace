"use strict";

/*
 * Phase 1 connection-profile contract.
 *
 * This is deliberately a loopback-only test.  The HTTP fixture below is not a
 * ComfyUI installation and never executes a model.  It exists to prove that
 * Main's profile boundary is sufficient for auth/redirect/transport tests.
 * Queue recovery, targeted cancellation and duplicate-submit behaviour remain
 * in comfyui-executor-selftest.cjs; this test records the shared coverage in
 * its report so a connection change cannot silently drop those checks.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  createComfyUiConnectionProfileService,
  inferComfyUiNetworkScope,
  isLanAddress,
  normalizeComfyUiConnectionProfile,
  normalizeComfyUiConnectionUrl,
  normalizeCredentialRef
} = require("../desktop/comfyui-connection-service.cjs");
const { normalizeComfyUiConnectionReference, normalizeComfyUiTaskOptions } = require("../runtime/comfyui-options.mjs");

const cases = [];
const expectCode = code => error => error?.code === code;
const check = async (name, fn) => {
  const started = Date.now();
  await fn();
  cases.push({ name, ok: true, durationMs: Date.now() - started });
};

function createMemoryStore(initial = { version: 1, profiles: [] }) {
  let value = JSON.parse(JSON.stringify(initial));
  return {
    read: () => JSON.parse(JSON.stringify(value)),
    write: (_file, next) => { value = JSON.parse(JSON.stringify(next)); },
    snapshot: () => JSON.parse(JSON.stringify(value))
  };
}

function createCredentialStore() {
  const values = new Map();
  const keyFor = ref => `${ref?.mode || "none"}:${ref?.id || "none"}`;
  return {
    set(ref, value) { values.set(keyFor(ref), JSON.parse(JSON.stringify(value))); },
    get(ref) { return values.get(keyFor(ref)); },
    delete(ref) { values.delete(keyFor(ref)); },
    has(ref) { return values.has(keyFor(ref)); }
  };
}

/**
 * Small HTTP fixture used by this selftest and available to future connection
 * tests.  It binds only to 127.0.0.1 and records no secrets.  `dropPrompt`
 * closes the socket after reading a POST, modelling an unknown submission;
 * `redirect` produces an explicit redirect that callers must inspect without
 * following; `/queue` models a targeted delete while preserving other jobs.
 */
async function createFakeRemoteServer(options = {}) {
  const state = {
    promptPosts: 0,
    queueDeletes: [],
    requests: [],
    authFailures: 0,
    promptIds: new Set(),
    pending: ["other-prompt"],
    close: null,
    baseUrl: ""
  };
  const expectedAuthorization = options.authorization || "";
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    state.requests.push({ method: request.method, path: url.pathname });
    if (expectedAuthorization && request.headers.authorization !== expectedAuthorization) {
      state.authFailures += 1;
      response.writeHead(401, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (options.redirect && url.pathname === "/system_stats") {
      response.writeHead(302, { location: `${state.baseUrl}/redirect-target` });
      return response.end();
    }
    if (url.pathname === "/redirect-target") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ followed: true }));
    }
    if (url.pathname === "/system_stats" || url.pathname === "/object_info") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ ok: true, source: "loopback-fixture" }));
    }
    if (url.pathname === "/prompt" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      state.promptPosts += 1;
      const promptId = "fixture-prompt-1";
      state.promptIds.add(promptId);
      state.pending.push(promptId);
      if (options.dropPrompt) return request.socket.destroy();
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ prompt_id: promptId, bodyBytes: Buffer.concat(chunks).length }));
    }
    if (url.pathname === "/queue" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const ids = Array.isArray(body.delete) ? body.delete.map(String) : [];
      state.queueDeletes.push(ids);
      state.pending = state.pending.filter(id => !ids.includes(id));
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ ok: true }));
    }
    if (url.pathname === "/queue") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ queue_pending: state.pending.map(prompt_id => [0, prompt_id]), queue_running: [] }));
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${server.address().port}`;
  state.close = async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  };
  return state;
}

async function createTlsFailureServer() {
  // A plain TCP endpoint behind an https URL is a deterministic TLS handshake
  // failure and avoids generating or storing a certificate in the repository.
  const server = net.createServer(socket => {
    socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    baseUrl: `https://localhost:${port}`,
    close: async () => new Promise(resolve => server.close(resolve))
  };
}

async function main() {
  const memory = createMemoryStore();
  const credentials = createCredentialStore();
  const dnsRecords = {
    "comfy.lan": [{ address: "192.168.20.15", family: 4 }],
    "public.example": [{ address: "93.184.216.34", family: 4 }],
    "rebind.example": [{ address: "127.0.0.1", family: 4 }]
  };
  const service = createComfyUiConnectionProfileService({
    configPath: "memory://comfyui-connections.json",
    readJson: memory.read,
    writeJson: memory.write,
    credentialStore: credentials,
    dnsLookup: async hostname => dnsRecords[hostname] || []
  });

  await check("scope inference distinguishes loopback, LAN and public hosts", async () => {
    assert.equal(inferComfyUiNetworkScope("http://127.0.0.1:8188"), "local");
    assert.equal(inferComfyUiNetworkScope("http://192.168.20.15:8188"), "lan");
    assert.equal(inferComfyUiNetworkScope("https://public.example"), "remote");
    assert.equal(isLanAddress("192.168.20.15"), true);
    assert.equal(isLanAddress("93.184.216.34"), false);
  });

  await check("profile normalization accepts all scopes and rejects unsafe URL forms", async () => {
    const local = normalizeComfyUiConnectionProfile({ id: "local-fixture", baseUrl: "http://127.0.0.1:8188", networkScope: "local" });
    assert.equal(local.networkScope, "local");
    const lan = normalizeComfyUiConnectionProfile({ id: "lan-fixture", baseUrl: "http://comfy.lan:8188", networkScope: "lan" });
    assert.equal(lan.networkScope, "lan");
    const remote = normalizeComfyUiConnectionProfile({ id: "remote-fixture", baseUrl: "https://public.example/comfy", networkScope: "remote", allowedHosts: ["public.example"] });
    assert.equal(remote.networkScope, "remote");
    for (const value of [
      "http://user:pass@127.0.0.1:8188",
      "http://127.0.0.1:8188/?token=secret",
      "http://127.0.0.1:8188/#fragment",
      "http://127.0.0.1:8188\\@example.com"
    ]) assert.throws(() => normalizeComfyUiConnectionUrl(value, { networkScope: "local" }), expectCode("COMFYUI_CONNECTION_URL_INVALID"));
    assert.throws(() => normalizeComfyUiConnectionUrl("http://public.example", { networkScope: "remote" }), expectCode("COMFYUI_CONNECTION_HTTPS_REQUIRED"));
    assert.throws(() => normalizeComfyUiConnectionProfile({ id: "bad-host", baseUrl: "https://public.example", networkScope: "remote", allowedHosts: ["other.example"] }), expectCode("COMFYUI_CONNECTION_HOST_NOT_ALLOWED"));
    assert.throws(() => normalizeComfyUiConnectionProfile({ id: "bad-local", baseUrl: "http://public.example", networkScope: "local" }), expectCode("COMFYUI_CONNECTION_HOST_NOT_ALLOWED"));
  });

  await check("credential refs never carry secret material", async () => {
    assert.deepEqual(normalizeCredentialRef(undefined), { mode: "none" });
    assert.deepEqual(normalizeCredentialRef({ mode: "bearer", id: "remote-token", label: "Fixture token" }), { mode: "bearer", id: "remote-token", label: "Fixture token" });
    assert.deepEqual(normalizeCredentialRef({ mode: "basic", id: "remote-basic" }), { mode: "basic", id: "remote-basic" });
    assert.deepEqual(normalizeCredentialRef({ mode: "mtls", id: "remote-mtls" }), { mode: "mtls", id: "remote-mtls" });
    assert.throws(() => normalizeCredentialRef({ mode: "bearer", id: "remote-token", token: "secret-value" }), expectCode("COMFYUI_CONNECTION_CREDENTIAL_SECRET"));
    assert.throws(() => normalizeCredentialRef({ mode: "basic", username: "admin", password: "secret" }), expectCode("COMFYUI_CONNECTION_CREDENTIAL_SECRET"));
    assert.throws(() => normalizeCredentialRef({ mode: "bearer", id: "token/with/slash" }), expectCode("COMFYUI_CONNECTION_CREDENTIAL_INVALID"));
  });

  await check("invalid and conflicting connection references cannot fall back to legacy URLs", async () => {
    const task = { templateId: "stock-generate", templateHash: "a".repeat(64), checkpoint: "fixture.safetensors", width: 512, height: 512, seed: 1, baseUrl: "http://127.0.0.1:8188" };
    const count = service.list().length;
    for (const input of [
      { connectionId: "" }, { connectionId: " " }, { connectionId: 0 }, { connectionId: 5 }, { connectionId: null }, { connectionId: {} },
      { profileId: "" }, { profileId: [] }, { connectionId: "first", profileId: "second" }, { connectionId: "valid", profileId: false }
    ]) {
      assert.throws(() => normalizeComfyUiConnectionReference(input), expectCode("COMFYUI_CONNECTION_PROFILE_INVALID"));
      assert.throws(() => normalizeComfyUiTaskOptions({ ...task, ...input }), expectCode("COMFYUI_CONNECTION_PROFILE_INVALID"));
      assert.throws(() => service.resolve({ ...task, ...input }), expectCode("COMFYUI_CONNECTION_PROFILE_INVALID"));
      assert.throws(() => service.upsert({ baseUrl: task.baseUrl, networkScope: "local", ...input }), expectCode("COMFYUI_CONNECTION_PROFILE_INVALID"));
    }
    assert.equal(service.list().length, count);
    assert.equal(normalizeComfyUiConnectionReference({ profileId: "same", connectionId: "same" }), "same");
    assert.throws(() => service.resolve({ connectionId: "unknown-remote", baseUrl: "https://public.example", networkScope: "remote" }), expectCode("COMFYUI_CONNECTION_NOT_FOUND"));
    assert.throws(() => service.resolve({ connectionId: "unknown-local", baseUrl: task.baseUrl }), expectCode("COMFYUI_CONNECTION_NOT_FOUND"));
  });

  await check("explicit address edits derive the new host while retaining explicit restrictions", () => {
    const editedMemory = createMemoryStore(); let dnsCalls = 0;
    const edited = createComfyUiConnectionProfileService({ readJson: editedMemory.read, writeJson: editedMemory.write, dnsLookup: async () => { dnsCalls++; throw Error("configuration must not resolve DNS"); } });
    edited.create({ id: "editable-remote", baseUrl: "https://first.example", networkScope: "remote", allowedHosts: ["first.example", "alias.example"], credentialRef: { mode: "bearer", id: "retained-ref" } });
    edited.upsert({ connectionId: "editable-remote", label: "Label only" });
    assert.deepEqual(edited.getInternal("editable-remote").allowedHosts, ["first.example", "alias.example"]);
    edited.upsert({ connectionId: "editable-remote", baseUrl: "https://second.example/comfy" });
    const changed = edited.getInternal("editable-remote");
    assert.deepEqual(changed.allowedHosts, ["second.example"]); assert.deepEqual(changed.credentialRef, { mode: "bearer", id: "retained-ref" });
    const policy = edited.requestPolicy(changed);
    assert.equal(policy.authorizeUrl("https://second.example/comfy/system_stats"), "https://second.example/comfy/system_stats");
    assert.throws(() => policy.authorizeUrl("https://first.example/comfy/system_stats"), expectCode("COMFYUI_CONNECTION_HOST_NOT_ALLOWED"));
    assert.throws(() => edited.upsert({ connectionId: "editable-remote", baseUrl: "https://third.example", allowedHosts: ["second.example"] }), expectCode("COMFYUI_CONNECTION_HOST_NOT_ALLOWED"));
    assert.equal(edited.getInternal("editable-remote").baseUrl, changed.baseUrl);
    edited.upsert({ connectionId: "editable-remote", baseUrl: "https://third.example", allowedHosts: ["third.example", "explicit-alias.example"] });
    edited.upsert({ connectionId: "editable-remote", baseUrl: "https://third.example", label: "Same address" });
    assert.deepEqual(edited.getInternal("editable-remote").allowedHosts, ["third.example", "explicit-alias.example"]);
    assert.equal(dnsCalls, 0);
  });

  const fake = await createFakeRemoteServer({ authorization: "Bearer fixture-secret" });
  try {
    await check("create/list/get keep credential refs Main-only and provide structured summaries", async () => {
      const created = service.create({ id: "loopback-fixture", label: "Loopback fixture", baseUrl: fake.baseUrl, networkScope: "local", credentialRef: { mode: "bearer", id: "fixture-token" } });
      assert.equal(created.credentialMode, "bearer");
      assert.equal(created.credentialConfigured, true);
      assert.equal("credentialRef" in created, false);
      assert.equal("credentialRef" in service.list()[0], false);
      assert.equal("credentialRef" in service.get("loopback-fixture"), false);
      const resolved = service.resolve({ connectionId: "loopback-fixture" });
      assert.equal(resolved.credentialRef.id, "fixture-token");
      assert.equal(JSON.stringify(service.list()).includes("fixture-token"), false);
      assert.equal(JSON.stringify(memory.snapshot()).includes("secret-value"), false);
    });

    await check("credential headers authenticate fake endpoint and reject wrong credentials", async () => {
      credentials.set({ mode: "bearer", id: "fixture-token" }, { token: "fixture-secret" });
      const auth = service.credentialHeaders({ connectionId: "loopback-fixture" });
      assert.deepEqual(auth.headers, { authorization: "Bearer fixture-secret" });
      assert.equal(JSON.stringify(memory.snapshot()).includes("fixture-secret"), false);
      const success = await fetch(`${fake.baseUrl}/system_stats`, { headers: auth.headers });
      assert.equal(success.status, 200);
      const failure = await fetch(`${fake.baseUrl}/system_stats`, { headers: { authorization: "Bearer wrong-secret" } });
      assert.equal(failure.status, 401);
      assert.equal(fake.authFailures, 1);

      const basic = service.create({ id: "basic-fixture", baseUrl: fake.baseUrl, networkScope: "local", credentialRef: { mode: "basic", id: "fixture-basic" } });
      credentials.set({ mode: "basic", id: "fixture-basic" }, { username: "fixture-user", password: "fixture-password" });
      assert.deepEqual(service.credentialHeaders({ connectionId: basic.connectionId }).headers, {
        authorization: `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`
      });

      const mtls = service.create({ id: "mtls-fixture", baseUrl: "https://public.example", networkScope: "remote", allowedHosts: ["public.example"], credentialRef: { mode: "mtls", id: "fixture-mtls" }, tls: { clientCertRef: "client-ref-a", clientKeyRef: "client-ref-b" } });
      credentials.set({ mode: "mtls", id: "fixture-mtls" }, { cert: "fixture-cert-pem", key: "fixture-key-pem", ca: "fixture-ca-pem" });
      const mtlsHeaders = service.credentialHeaders({ connectionId: mtls.connectionId });
      assert.deepEqual(mtlsHeaders.headers, {});
      assert.equal(mtlsHeaders.tls.cert, "fixture-cert-pem");
      assert.equal(mtlsHeaders.tls.key, "fixture-key-pem");
      assert.equal(JSON.stringify(service.list()).includes("fixture-key-pem"), false);
    });

    await check("profile edits retain Main-only refs and profile deletion preserves shared credentials", async () => {
      service.upsert({ connectionId: "loopback-fixture", label: "Renamed bearer" });
      assert.deepEqual(service.getInternal("loopback-fixture").credentialRef, { mode: "bearer", id: "fixture-token" });
      service.upsert({ connectionId: "loopback-fixture", credentialType: "bearer" });
      assert.equal(service.getInternal("loopback-fixture").credentialRef.id, "fixture-token");
      service.create({ id: "shared-ref-fixture", baseUrl: fake.baseUrl, networkScope: "local", credentialRef: { mode: "bearer", id: "fixture-token" } });
      assert.equal(service.remove("shared-ref-fixture"), true);
      assert.equal(credentials.has({ mode: "bearer", id: "fixture-token" }), true);
      assert.equal(service.credentialHeaders({ connectionId: "loopback-fixture" }).headers.authorization, "Bearer fixture-secret");
    });

    await check("local inspection keeps compatibility while networked profiles require explicit confirmation", async () => {
      let inspected = 0;
      const inspector = createComfyUiConnectionProfileService({
        executor: { inspect: async () => { inspected++; return { capabilities: { checkpoints: ["fixture.safetensors"] } }; } },
        dnsLookup: async hostname => dnsRecords[hostname] || [{ address: "127.0.0.1", family: 4 }]
      });
      inspector.create({ id: "inspect-local", baseUrl: fake.baseUrl, networkScope: "local" });
      inspector.create({ id: "inspect-lan", baseUrl: "http://comfy.lan:8188", networkScope: "lan" });
      inspector.create({ id: "inspect-remote", baseUrl: "https://public.example", networkScope: "remote" });
      assert.equal((await inspector.inspect({ connectionId: "inspect-local" })).ok, true);
      await assert.rejects(inspector.inspect({ connectionId: "inspect-lan" }), expectCode("COMFYUI_CONNECTION_CONFIRMATION_REQUIRED"));
      await assert.rejects(inspector.inspect({ connectionId: "inspect-remote" }), expectCode("COMFYUI_CONNECTION_CONFIRMATION_REQUIRED"));
      assert.equal(inspected, 1);
    });

    await check("authorized endpoint policy rejects redirects, queries and unapproved paths", async () => {
      const profile = service.resolve({ connectionId: "loopback-fixture" });
      const policy = service.requestPolicy(profile);
      assert.equal(policy.allowRedirect, false);
      assert.equal(policy.wsUrl(), `${fake.baseUrl.replace(/^http:/, "ws:")}/ws`);
      const systemUrl = policy.authorizeUrl(`${fake.baseUrl}/system_stats`);
      assert.equal(systemUrl, `${fake.baseUrl}/system_stats`);
      assert.throws(() => policy.authorizeUrl(`${fake.baseUrl}/system_stats?token=fixture`), expectCode("COMFYUI_CONNECTION_QUERY_FORBIDDEN"));
      assert.throws(() => policy.authorizeUrl(`${fake.baseUrl}/redirect-target`), expectCode("COMFYUI_CONNECTION_ENDPOINT_FORBIDDEN"));
      const redirect = await createFakeRemoteServer({ redirect: true });
      try {
        const redirectResponse = await fetch(`${redirect.baseUrl}/system_stats`, { redirect: "manual" });
        assert.equal(redirectResponse.status, 302);
        assert.equal(redirectResponse.headers.get("location"), `${redirect.baseUrl}/redirect-target`);
      } finally { await redirect.close(); }
    });

    await check("prompt disconnect is observable and does not imply a second submission", async () => {
      const disconnect = await createFakeRemoteServer({ dropPrompt: true });
      try {
        await assert.rejects(fetch(`${disconnect.baseUrl}/prompt`, { method: "POST", body: "{}" }));
        assert.equal(disconnect.promptPosts, 1);
        assert.equal(disconnect.promptIds.size, 1);
      } finally { await disconnect.close(); }
    });

    await check("fake queue cancellation deletes one prompt and preserves unrelated work", async () => {
      const queue = await createFakeRemoteServer();
      try {
        const submitted = await fetch(`${queue.baseUrl}/prompt`, { method: "POST", body: "{}" });
        assert.equal(submitted.status, 200);
        const canceled = await fetch(`${queue.baseUrl}/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: ["fixture-prompt-1"] }) });
        assert.equal(canceled.status, 200);
        assert.deepEqual(queue.queueDeletes, [["fixture-prompt-1"]]);
        assert.deepEqual(queue.pending, ["other-prompt"]);
      } finally { await queue.close(); }
    });
  } finally { await fake.close(); }

  await check("DNS resolution is pinned to an approved scope and rejects rebinding", async () => {
    const lan = service.create({ id: "lan-fixture", baseUrl: "http://comfy.lan:8188", networkScope: "lan" });
    const resolved = await service.resolveNetwork({ connectionId: lan.connectionId });
    assert.deepEqual(resolved.addresses, [{ address: "192.168.20.15", family: 4 }]);
    const remote = service.create({ id: "public-fixture", baseUrl: "https://public.example", networkScope: "remote", allowedHosts: ["public.example"] });
    const publicNetwork = await service.resolveNetwork({ connectionId: remote.connectionId });
    assert.equal(publicNetwork.addresses[0].address, "93.184.216.34");
    const rebinding = service.create({ id: "rebind-fixture", baseUrl: "https://rebind.example", networkScope: "remote", allowedHosts: ["rebind.example"] });
    await assert.rejects(service.resolveNetwork({ connectionId: rebinding.connectionId }), expectCode("COMFYUI_CONNECTION_DNS_REBINDING"));
  });

  await check("legacy baseUrl migrates to a profile while preserving old task recovery", async () => {
    const migrated = service.migrateLegacy({ baseUrl: "http://127.0.0.1:8189", persist: true });
    assert.equal(migrated.legacy, true);
    assert.equal(migrated.networkScope, "local");
    const resolved = service.resolve({ baseUrl: "http://127.0.0.1:8189" });
    assert.equal(resolved.legacy, true);
    assert.equal(resolved.baseUrl, "http://127.0.0.1:8189");
    assert.equal(service.list().some(profile => profile.id === migrated.id), true);
  });

  await check("TLS handshake failures are surfaced without insecure fallback", async () => {
    const tls = await createTlsFailureServer();
    try {
      const profile = normalizeComfyUiConnectionProfile({ id: "tls-fixture", baseUrl: tls.baseUrl, networkScope: "local" });
      const policy = createComfyUiConnectionProfileService({ credentialStore: createCredentialStore() }).requestPolicy(profile);
      assert.equal(policy.rejectUnauthorized, true);
      await assert.rejects(fetch(`${tls.baseUrl}/system_stats`));
      assert.throws(() => normalizeComfyUiConnectionProfile({ id: "tls-insecure", baseUrl: tls.baseUrl, networkScope: "local", tls: { rejectUnauthorized: false } }), expectCode("COMFYUI_CONNECTION_TLS_INVALID"));
    } finally { await tls.close(); }
  });

  const report = {
    ok: true,
    cases: cases.length,
    results: cases,
    realNetworkRequests: 0,
    realModelRequests: 0,
    fixture: "127.0.0.1 only",
    crossCoverage: {
      executor: ["redirect", "auth-status", "disconnect", "recovery", "queue-cancel", "duplicate-submit"],
      connection: ["scope", "credential-redaction", "url-policy", "dns-pinning", "tls-failure", "legacy-migration"]
    }
  };
  const reportDirectory = path.resolve(__dirname, "../.diagnostics/comfyui-connection");
  await fs.mkdir(reportDirectory, { recursive: true });
  await fs.writeFile(path.join(reportDirectory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: ".diagnostics/comfyui-connection/report.json" })}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { createFakeRemoteServer, createTlsFailureServer };
