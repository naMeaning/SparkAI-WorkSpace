"use strict";

// Fake bytes on loopback only: no archive/model download or installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  normalizeManagedArtifactManifest, normalizeManagedArtifactDescriptor,
  canonicalManagedArtifactValue, publicManagedArtifactManifest
} = require("../runtime/managed-artifact-manifest.cjs");
const { createManagedArtifactStore } = require("../desktop/managed-artifact-store.cjs");

const cases = [], clone = value => JSON.parse(JSON.stringify(value));
const code = expected => error => error?.code === expected;
const sha = value => createHash("sha256").update(value).digest("hex");
const license = { id: "MIT", url: "https://example.com/LICENSE" };
const trust = { kind: "user-import", id: "native-import-fixture" };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function bounded(promise, milliseconds = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture operation did not settle within its bound.")), milliseconds);
    void promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
async function trackNetworkRequests(run) {
  const nativeHttp = http.request, nativeHttps = https.request, calls = [];
  http.request = function(...args) { calls.push("http"); return nativeHttp.apply(this, args); };
  https.request = function(...args) { calls.push("https"); return nativeHttps.apply(this, args); };
  try { await run(calls); } finally { http.request = nativeHttp; https.request = nativeHttps; }
}
async function gateHashRead(predicate, run) {
  const native = fs.createReadStream, streams = [], signals = [], releases = [];
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  fs.createReadStream = function(file, options) {
    const stream = native.call(this, file, options);
    if (predicate(String(file))) {
      streams.push(stream); signals.push(options?.signal instanceof AbortSignal);
      const read = stream._read; let held = true;
      stream._read = function(...args) {
        if (!held) return read.apply(this, args);
        held = false; releases.push(() => { if (!stream.destroyed) read.apply(stream, args); }); entered(stream);
      };
    }
    return stream;
  };
  try { await run({ started, streams, signals }); }
  finally { fs.createReadStream = native; for (const release of releases) release(); }
}
async function check(name, fn) { const start = Date.now(); await fn(); cases.push({ name, ok: true, durationMs: Date.now() - start }); if (process.argv.includes("--verbose")) process.stdout.write(`PASS ${name}\n`); }
async function trackPartStreams(run) {
  const native = fs.createWriteStream, streams = [], overlaps = [];
  fs.createWriteStream = function(file, ...args) {
    const stream = native.call(this, file, ...args);
    if (String(file).endsWith(".part")) { if (streams.some(previous => !previous.closed)) overlaps.push(true); streams.push(stream); }
    return stream;
  };
  try { await run({ streams, overlaps }); } finally { fs.createWriteStream = native; }
}
function descriptor(body, url, overrides = {}) {
  return {
    id: "fixture-model", kind: "model", format: "file", filename: "fixture.safetensors", bytes: body.length,
    expandedBytes: body.length, sha256: sha(body), url, license, components: [{ name: "fixture", version: "1.0.0", license }],
    dependencies: [], destination: "checkpoints", modelType: "checkpoint", ...overrides
  };
}
function manifest(artifacts, overrides = {}) {
  const runtime = artifacts.find(item => item.kind === "runtime");
  return {
    schemaVersion: 1, id: "fixture-manifest", label: "Fake fixture only", version: "1.0.0", adapter: "comfyui-portable",
    ...(runtime ? { runtime: { artifactId: runtime.id, cpu: true } } : {}),
    requirements: { os: ["win32"], arch: ["x64"], gpu: ["cpu"], vramBytes: 0, diskBytes: artifacts.reduce((sum, item) => sum + item.bytes + item.expandedBytes, 0) },
    artifacts, ...overrides
  };
}
async function createFixture() {
  const bodies = new Map(), behaviors = new Map(), requests = [];
  const server = http.createServer((request, response) => {
    const route = request.url, body = bodies.get(route), behavior = behaviors.get(route) || {};
    requests.push({ route, range: request.headers.range || null, ifRange: request.headers["if-range"] || null, auth: !!request.headers.authorization, cookie: !!request.headers.cookie });
    if (behavior.redirect) { response.writeHead(302, { location: behavior.redirect }); response.end(); return; }
    if (behavior.status) { response.writeHead(behavior.status, { "content-length": 0 }); response.end(); return; }
    if (!body) { response.writeHead(404); response.end(); return; }
    const range = /^bytes=(\d+)-$/.exec(request.headers.range || ""), offset = range && !behavior.ignoreRange ? Number(range[1]) : 0;
    const etag = behavior.noEtag ? null : behavior.changedEtag ? '"fixture-changed"' : '"fixture-v1"';
    const headers = { "content-type": "application/octet-stream", ...(etag ? { etag } : {}) };
    if (!behavior.chunked) headers["content-length"] = body.length - offset + (behavior.wrongLength || 0);
    if (offset) headers["content-range"] = `bytes ${behavior.badRange ? offset + 1 : offset}-${body.length - 1}/${body.length}`;
    response.writeHead(offset ? 206 : 200, headers);
    let sent = offset;
    const timer = setInterval(() => {
      if (response.destroyed) { clearInterval(timer); return; }
      if (behavior.dropAfter && sent >= behavior.dropAfter) { clearInterval(timer); response.destroy(); return; }
      const next = Math.min(sent + 16 * 1024, body.length);
      response.write(body.subarray(sent, next)); sent = next;
      if (sent === body.length) { clearInterval(timer); response.end(); }
    }, behavior.interval || 1);
    response.once("close", () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`, bodies, behaviors, requests,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function main() {
  const directory = path.resolve(__dirname, "..", ".diagnostics", `managed-artifact-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(directory, { recursive: true });
  const fixture = await createFixture(), body = Buffer.alloc(512 * 1024, 0x4d);
  let storeNumber = 0;
  const storeAt = (name = `store-${++storeNumber}`, extra = {}) => createManagedArtifactStore({ root: path.join(directory, name), allowLoopbackForTests: true, reserveBytes: 0, ...extra });
  const itemAt = (route, data = body, overrides = {}) => { fixture.bodies.set(route, data); return descriptor(data, `${fixture.baseUrl}${route}`, overrides); };
  try {
    await check("strict manifest + stable canonical hash + source-free public DTO", async () => {
      const raw = manifest([descriptor(body, "https://example.com/model.safetensors")]);
      const first = normalizeManagedArtifactManifest(raw, { trustContext: trust });
      const reordered = { artifacts: raw.artifacts, requirements: raw.requirements, adapter: raw.adapter, version: raw.version, label: raw.label, id: raw.id, schemaVersion: 1 };
      assert.equal(first.manifestHash, normalizeManagedArtifactManifest(reordered, { trustContext: trust }).manifestHash);
      assert.equal(first.installable, true); assert.ok(Object.isFrozen(first.artifacts[0]));
      assert.equal(normalizeManagedArtifactManifest(raw).installable, false);
      const dto = JSON.stringify(publicManagedArtifactManifest(first));
      assert.ok(!dto.includes("https:") && !dto.includes("filename") && !dto.includes("destination"));
      assert.throws(() => normalizeManagedArtifactManifest({ ...raw, scripts: [] }, { trustContext: trust }), code("MANAGED_MANIFEST_FIELDS_INVALID"));
      assert.throws(() => normalizeManagedArtifactManifest({ ...raw, reviewed: true }), code("MANAGED_MANIFEST_FIELDS_INVALID"));
      assert.throws(() => normalizeManagedArtifactManifest({ ...raw, adapter: "shell" }), code("MANAGED_MANIFEST_ADAPTER_INVALID"));
    });
    await check("paths, pickle, URL credentials/query/redirect sources rejected", async () => {
      const item = descriptor(body, "https://example.com/model.safetensors");
      for (const filename of ["../escape", "file:ads", "nul.safetensors", "model. ", "a/b.safetensors", "a\\b"]) assert.throws(() => normalizeManagedArtifactDescriptor({ ...item, filename }), code("MANAGED_ARTIFACT_PATH_INVALID"));
      assert.throws(() => normalizeManagedArtifactDescriptor({ ...item, filename: "model.ckpt" }), code("MANAGED_MANIFEST_MODEL_INVALID"));
      assert.throws(() => normalizeManagedArtifactDescriptor({ ...item, destination: "../../models" }), code("MANAGED_MANIFEST_MODEL_INVALID"));
      for (const url of ["https://user:password@example.com/model", "https://example.com/model?token=value", "https://example.com/model#fragment", "https://example.com/a/../model", "https://example.com/%2e%2e/model"]) assert.throws(() => normalizeManagedArtifactDescriptor({ ...item, url }), code("MANAGED_ARTIFACT_URL_INVALID"));
      assert.throws(() => normalizeManagedArtifactDescriptor({ ...item, url: "http://127.0.0.1/model" }), code("MANAGED_ARTIFACT_HTTPS_REQUIRED"));
      assert.throws(() => normalizeManagedArtifactDescriptor({ ...item, bytes: 1.1 }), code("MANAGED_MANIFEST_SIZE_INVALID"));
    });
    await check("model-only + portable dependency DAG + declared component licenses", async () => {
      const runtime = descriptor(Buffer.from("fake-archive"), "https://example.com/runtime.zip", { id: "runtime", kind: "runtime", modelType: undefined, format: "zip", filename: "runtime.zip", destination: "." });
      const model = descriptor(body, "https://example.com/model.safetensors", { dependencies: ["runtime"] });
      const raw = manifest([runtime, model]), result = normalizeManagedArtifactManifest(raw, { trustContext: trust });
      assert.deepEqual(result.installOrder, ["runtime", "fixture-model"]);
      const cyclic = clone(raw); cyclic.artifacts[0].dependencies = ["fixture-model"];
      assert.throws(() => normalizeManagedArtifactManifest(cyclic, { trustContext: trust }), code("MANAGED_MANIFEST_DEPENDENCY_CYCLE"));
      const missing = clone(raw); missing.artifacts[1].dependencies = ["missing"];
      assert.throws(() => normalizeManagedArtifactManifest(missing, { trustContext: trust }), code("MANAGED_MANIFEST_DEPENDENCY_INVALID"));
      assert.throws(() => normalizeManagedArtifactDescriptor({ ...model, components: [] }), code("MANAGED_MANIFEST_COMPONENTS_REQUIRED"));
      assert.throws(() => normalizeManagedArtifactManifest({ ...raw, requirements: { ...raw.requirements, diskBytes: 1 } }), code("MANAGED_MANIFEST_SIZE_INVALID"));
      for (const [modelType, destination] of [["checkpoint", "checkpoints"], ["vae", "vae"], ["lora", "loras"]]) assert.equal(normalizeManagedArtifactManifest(manifest([{ ...model, modelType, destination, dependencies: [] }]), { trustContext: trust }).runtime, undefined);
    });
    await check("custom node cannot self-authorize; trusted Ed25519 signatures are verified", async () => {
      const runtime = descriptor(Buffer.from("runtime"), "https://example.com/runtime.zip", { id: "runtime", kind: "runtime", modelType: undefined, format: "zip", filename: "runtime.zip", destination: "." });
      const custom = descriptor(Buffer.from("node"), "https://example.com/node.zip", { id: "custom", kind: "custom-node", modelType: undefined, format: "zip", filename: "node.zip", destination: "ComfyUI/custom_nodes/reviewed", dependencies: ["runtime"] });
      const raw = manifest([runtime, custom]);
      assert.throws(() => normalizeManagedArtifactManifest(raw, { trustContext: trust }), code("MANAGED_MANIFEST_CUSTOM_NODE_UNTRUSTED"));
      const reviewed = normalizeManagedArtifactManifest(raw, { trustContext: { kind: "reviewed-registry", id: "fixture-registry" } });
      const payload = Object.fromEntries(["schemaVersion", "id", "label", "version", "adapter", "runtime", "requirements", "artifacts"].map(key => [key, reviewed[key]]));
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const signature = { algorithm: "ed25519", keyId: "test-key", value: sign(null, Buffer.from(canonicalManagedArtifactValue(payload)), privateKey).toString("base64") };
      const signed = { ...raw, signature };
      assert.throws(() => normalizeManagedArtifactManifest(signed, { trustContext: trust }), code("MANAGED_MANIFEST_SIGNATURE_UNTRUSTED"));
      assert.equal(normalizeManagedArtifactManifest(signed, { trustContext: trust, trustedSigningKeys: { "test-key": publicKey } }).signatureVerified, true);
      assert.throws(() => normalizeManagedArtifactManifest({ ...signed, version: "tampered" }, { trustContext: trust, trustedSigningKeys: { "test-key": publicKey } }), code("MANAGED_MANIFEST_SIGNATURE_INVALID"));
    });
    await check("custom-node destinations cannot be relabeled as dependencies or broad package roots", async () => {
      const dependency = descriptor(Buffer.from("node"), "https://example.com/node.zip", { id: "custom", kind: "dependency", modelType: undefined, format: "zip", filename: "node.zip", destination: "ComfyUI/custom_nodes/unsigned_fixture" });
      for (const destination of ["ComfyUI/custom_nodes/unsigned_fixture", "ComfyUI/custom_nodes", "comfyui/CUSTOM_NODES/unsigned_fixture", "custom_nodes/unsigned_fixture", "elsewhere/custom_nodes/unsigned_fixture"]) {
        for (const kind of ["dependency", "runtime"]) assert.throws(() => normalizeManagedArtifactDescriptor({ ...dependency, kind, destination }), code("MANAGED_MANIFEST_CUSTOM_NODE_DESTINATION"));
      }
      for (const destination of ["ComfyUI", "ComfyUI/custom_nodes", "ComfyUI/custom_nodes/package/nested", "custom_nodes/package", "comfyui/custom_nodes/package"]) assert.throws(() => normalizeManagedArtifactDescriptor({ ...dependency, kind: "custom-node", destination }), code("MANAGED_MANIFEST_CUSTOM_NODE_DESTINATION"));
      assert.equal(normalizeManagedArtifactDescriptor({ ...dependency, kind: "custom-node", destination: "ComfyUI/custom_nodes/reviewed" }).kind, "custom-node");
    });
    await check("stream to immutable object; exact bytes/hash; reuse sends zero requests", async () => {
      const store = storeAt(), item = itemAt("/success"), progress = [], count = fixture.requests.length;
      const result = await store.ensureArtifact(item, { jobId: "success-job", onProgress: event => progress.push(event) });
      assert.equal(result.sha256, item.sha256); assert.equal(sha(await fsp.readFile(result.path)), item.sha256); assert.equal(result.bytes, body.length);
      assert.equal(store.getDownload(item.sha256).status, "complete"); assert.equal(progress.at(-1).status, "complete");
      assert.equal((await store.ensureArtifact(item, { jobId: "second-job" })).reused, true);
      assert.equal(fixture.requests.length - count, 1);
      assert.ok(fixture.requests.every(request => !request.auth && !request.cookie));
      const journal = JSON.stringify(store.getDownload(item.sha256)); assert.ok(!journal.includes(fixture.baseUrl) && !journal.includes(directory));
    });
    await check("cached object hash pause cancels and closes the native read stream without network", async () => {
      const store = storeAt(), item = itemAt("/hash-cached"); await store.ensureArtifact(item, { jobId: "hash-cached-seed" });
      const count = fixture.requests.length, controller = new AbortController();
      await gateHashRead(file => !file.endsWith(".part"), async ({ started, streams, signals }) => {
        const rejected = assert.rejects(store.ensureArtifact(item, { jobId: "hash-cached-check", signal: controller.signal }), code("MANAGED_ARTIFACT_PAUSED"));
        try {
          await bounded(started); controller.abort(); await bounded(rejected);
          assert.deepEqual(signals, [true]); assert.equal(streams[0].closed, true); assert.equal(streams[0].fd, null);
        } finally { controller.abort(); }
      });
      assert.equal(fixture.requests.length, count); assert.equal((await store.ensureArtifact(item, { jobId: "hash-cached-resume" })).reused, true);
    });
    await check("postdownload hash pause leaves a resumable verified-size partial and closes its read", async () => {
      const store = storeAt(), item = itemAt("/hash-downloaded"), controller = new AbortController(), count = fixture.requests.length;
      await gateHashRead(file => file.endsWith(".part"), async ({ started, streams, signals }) => {
        const rejected = assert.rejects(store.ensureArtifact(item, { jobId: "hash-downloaded", signal: controller.signal }), code("MANAGED_ARTIFACT_PAUSED"));
        try {
          await bounded(started, 3000); controller.abort(); await bounded(rejected);
          assert.deepEqual(signals, [true]); assert.equal(streams[0].closed, true); assert.equal(streams[0].fd, null);
        } finally { controller.abort(); }
      });
      assert.equal(store.getObject(item.sha256), null); assert.equal(store.getDownload(item.sha256).status, "paused");
      assert.equal(store.getDownload(item.sha256).downloadedBytes, item.bytes);
      const result = await store.ensureArtifact(item, { jobId: "hash-downloaded" }); assert.equal(sha(fs.readFileSync(result.path)), item.sha256);
      assert.equal(fixture.requests.length - count, 1);
    });
    await check("submission conflict is rejected before network", async () => {
      const store = storeAt(), item = itemAt("/conflict"), count = fixture.requests.length;
      await store.ensureArtifact(item, { jobId: "stable-job" });
      await assert.rejects(store.ensureArtifact({ ...item, sha256: "a".repeat(64) }, { jobId: "stable-job" }), code("MANAGED_ARTIFACT_CONFLICT"));
      assert.equal(fixture.requests.length - count, 1);
    });
    await check("concurrent duplicate callers share one transfer", async () => {
      const store = storeAt(), item = itemAt("/concurrent"), count = fixture.requests.length;
      const [a, b] = await Promise.all([store.ensureArtifact(item, { jobId: "concurrent-a" }), store.ensureArtifact(item, { jobId: "concurrent-b" })]);
      assert.equal(a.path, b.path); assert.equal(fixture.requests.length - count, 1);
    });
    await check("distinct authorized manifests share immutable bytes despite different artifact labels", async () => {
      const store = storeAt(), item = itemAt("/shared-bytes"), count = fixture.requests.length;
      const [a, b] = await Promise.all([store.ensureArtifact(item, { jobId: "shared-a" }), store.ensureArtifact({ ...item, id: "another-id", filename: "another.safetensors" }, { jobId: "shared-b" })]);
      assert.equal(a.path, b.path); assert.equal(fixture.requests.length - count, 1);
      assert.equal((await store.ensureArtifact({ ...item, id: "third-id", url: "https://example.com/never-requested.safetensors" }, { jobId: "shared-c" })).reused, true);
    });
    await check("aborting primary observer preserves secondary progress and one GET", async () => {
      const store = storeAt(), item = itemAt("/abort-primary"), controller = new AbortController(), count = fixture.requests.length;
      let canceled = false, canceledProgress = 0, secondaryProgress = 0;
      const primary = store.ensureArtifact(item, { jobId: "observer-primary-a", signal: controller.signal, onProgress(event) {
        if (canceled) canceledProgress++;
        if (!canceled && event.downloadedBytes >= 64 * 1024) { canceled = true; controller.abort(); }
      } });
      const secondary = store.ensureArtifact(item, { jobId: "observer-secondary-a", onProgress() { secondaryProgress++; } });
      const results = await Promise.allSettled([primary, secondary]);
      assert.equal(results[0].status, "rejected"); assert.equal(results[0].reason.code, "MANAGED_ARTIFACT_PAUSED");
      assert.equal(results[1].status, "fulfilled"); assert.equal(sha(fs.readFileSync(results[1].value.path)), item.sha256);
      assert.equal(canceledProgress, 0); assert.ok(secondaryProgress > 1); assert.equal(fixture.requests.length - count, 1);
    });
    await check("aborting secondary observer leaves primary running and one GET", async () => {
      const store = storeAt(), item = itemAt("/abort-secondary"), controller = new AbortController(), count = fixture.requests.length;
      let canceled = false, canceledProgress = 0;
      const primary = store.ensureArtifact(item, { jobId: "observer-primary-b" });
      const secondary = store.ensureArtifact(item, { jobId: "observer-secondary-b", signal: controller.signal, onProgress(event) {
        if (canceled) canceledProgress++;
        if (!canceled && event.downloadedBytes >= 64 * 1024) { canceled = true; controller.abort(); }
      } });
      const results = await Promise.allSettled([primary, secondary]);
      assert.equal(results[0].status, "fulfilled"); assert.equal(sha(fs.readFileSync(results[0].value.path)), item.sha256);
      assert.equal(results[1].status, "rejected"); assert.equal(results[1].reason.code, "MANAGED_ARTIFACT_PAUSED");
      assert.equal(canceledProgress, 0); assert.equal(fixture.requests.length - count, 1);
    });
    await check("last observer abort waits for actual output close", async () => trackPartStreams(async ({ streams }) => {
      const store = storeAt(), item = itemAt("/abort-final"), controller = new AbortController(); let canceled = false;
      await assert.rejects(store.ensureArtifact(item, { jobId: "observer-final", signal: controller.signal, onProgress(event) {
        if (!canceled && event.downloadedBytes >= 64 * 1024) { canceled = true; controller.abort(); }
      } }), code("MANAGED_ARTIFACT_PAUSED"));
      assert.equal(streams.length, 1); assert.equal(streams[0].closed, true); assert.equal(streams[0].fd, null);
      const offset = store.getDownload(item.sha256).downloadedBytes; assert.ok(offset > 0 && offset < item.bytes);
      const result = await store.ensureArtifact(item, { jobId: "observer-final" }); assert.equal(sha(fs.readFileSync(result.path)), item.sha256);
      assert.equal(fixture.requests.filter(request => request.route === "/abort-final").at(-1).range, `bytes=${offset}-`);
    }));
    await check("pause + fresh store resumes exact Range/If-Range without duplicate bytes", async () => {
      const name = "resume-store", store = storeAt(name), item = itemAt("/resume");
      let paused = false;
      await assert.rejects(store.ensureArtifact(item, { jobId: "resume-job", onProgress(event) { if (!paused && event.downloadedBytes >= 96 * 1024) { paused = true; store.pause(item.sha256); } } }), code("MANAGED_ARTIFACT_PAUSED"));
      const partial = store.getDownload(item.sha256); assert.equal(partial.status, "paused"); assert.ok(partial.downloadedBytes > 0 && partial.downloadedBytes < item.bytes);
      const fresh = storeAt(name), result = await fresh.ensureArtifact(item, { jobId: "resume-job" });
      assert.equal(sha(await fsp.readFile(result.path)), item.sha256);
      const request = fixture.requests.filter(request => request.route === "/resume").at(-1);
      assert.equal(request.range, `bytes=${partial.downloadedBytes}-`); assert.equal(request.ifRange, '"fixture-v1"');
    });
    await check("six immediate pause/resume cycles close every previous part descriptor", async () => trackPartStreams(async ({ streams, overlaps }) => {
      const store = storeAt(), item = itemAt("/repeat-pause"), offsets = [];
      for (let round = 0; round < 6; round++) {
        const offset = store.getDownload(item.sha256)?.downloadedBytes || 0; let paused = false;
        await assert.rejects(store.ensureArtifact(item, { jobId: "repeat-pause", onProgress(event) {
          if (!paused && event.downloadedBytes >= offset + 64 * 1024) { paused = true; store.pause(item.sha256); }
        } }), code("MANAGED_ARTIFACT_PAUSED"));
        assert.equal(streams.at(-1).closed, true); assert.equal(streams.at(-1).fd, null);
        const actual = store.getDownload(item.sha256).downloadedBytes; assert.ok(actual > offset && actual < item.bytes); offsets.push(actual);
      }
      const completed = await store.ensureArtifact(item, { jobId: "repeat-pause" }); assert.equal(sha(fs.readFileSync(completed.path)), item.sha256);
      const requests = fixture.requests.filter(request => request.route === "/repeat-pause");
      assert.equal(requests.length, 7); assert.deepEqual(requests.slice(1).map(request => request.range), offsets.map(offset => `bytes=${offset}-`));
      assert.deepEqual(overlaps, []); assert.ok(streams.every(stream => stream.closed && stream.fd === null));
    }));
    await check("resume requested inside pause callback waits for the previous stream close", async () => trackPartStreams(async ({ streams, overlaps }) => {
      const store = storeAt(), item = itemAt("/raced-resume"); let paused = false, resumed;
      await assert.rejects(store.ensureArtifact(item, { jobId: "raced-resume", onProgress(event) {
        if (!paused && event.downloadedBytes >= 64 * 1024) { paused = true; store.pause(item.sha256); resumed = store.ensureArtifact(item, { jobId: "raced-resume" }); }
      } }), code("MANAGED_ARTIFACT_PAUSED"));
      assert.equal(streams[0].closed, true); const result = await resumed;
      assert.equal(sha(fs.readFileSync(result.path)), item.sha256); assert.deepEqual(overlaps, []);
      assert.equal(fixture.requests.filter(request => request.route === "/raced-resume").length, 2);
    }));
    await check("abrupt child-process exit recovers journal and actual partial bytes", async () => {
      const root = path.join(directory, "child-process-store"), item = itemAt("/child-process");
      const child = spawn(process.execPath, [__filename, "--partial-child", root, item.url, item.sha256, String(item.bytes)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
      const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (exitCode, signal) => resolve({ exitCode, signal })); });
      assert.equal(result.exitCode, 0, stderr);
      const fresh = createManagedArtifactStore({ root, allowLoopbackForTests: true, reserveBytes: 0 }), journal = fresh.getDownload(item.sha256);
      assert.equal(journal.status, "paused"); assert.ok(journal.downloadedBytes > 0 && journal.downloadedBytes < item.bytes);
      const completed = await fresh.ensureArtifact(item, { jobId: "child-process-job" }); assert.equal(sha(fs.readFileSync(completed.path)), item.sha256);
      assert.equal(fixture.requests.filter(request => request.route === "/child-process").at(-1).range, `bytes=${journal.downloadedBytes}-`);
    });
    await check("HTTP 200 after Range truncates old partial instead of appending", async () => {
      const name = "restart-200-store", store = storeAt(name), item = itemAt("/restart-200"); let paused = false;
      await assert.rejects(store.ensureArtifact(item, { jobId: "restart-200", onProgress(event) { if (!paused && event.downloadedBytes >= 96 * 1024) { paused = true; store.pause(item.sha256); } } }), code("MANAGED_ARTIFACT_PAUSED"));
      fixture.behaviors.set("/restart-200", { ignoreRange: true });
      const result = await storeAt(name).ensureArtifact(item, { jobId: "restart-200" });
      assert.equal(fs.statSync(result.path).size, item.bytes); assert.equal(sha(fs.readFileSync(result.path)), item.sha256);
    });
    await check("absence of strong ETag restarts safely", async () => {
      const name = "no-etag-store", store = storeAt(name), item = itemAt("/no-etag"); fixture.behaviors.set("/no-etag", { noEtag: true }); let paused = false;
      await assert.rejects(store.ensureArtifact(item, { jobId: "no-etag", onProgress(event) { if (!paused && event.downloadedBytes >= 96 * 1024) { paused = true; store.pause(item.sha256); } } }), code("MANAGED_ARTIFACT_PAUSED"));
      const result = await storeAt(name).ensureArtifact(item, { jobId: "no-etag" }); assert.equal(sha(fs.readFileSync(result.path)), item.sha256);
      assert.equal(fixture.requests.filter(request => request.route === "/no-etag").at(-1).range, null);
    });
    await check("new authorized source discards old ETag and partial; old job remains immutable", async () => {
      const name = "changed-source-store", store = storeAt(name), item = itemAt("/old-source"); let paused = false;
      await assert.rejects(store.ensureArtifact(item, { jobId: "old-source-job", onProgress(event) { if (!paused && event.downloadedBytes >= 96 * 1024) { paused = true; store.pause(item.sha256); } } }), code("MANAGED_ARTIFACT_PAUSED"));
      const changed = itemAt("/new-source", body);
      await assert.rejects(store.ensureArtifact(changed, { jobId: "old-source-job" }), code("MANAGED_ARTIFACT_CONFLICT"));
      const completed = await storeAt(name).ensureArtifact(changed, { jobId: "new-source-job" }); assert.equal(sha(fs.readFileSync(completed.path)), item.sha256);
      assert.equal(fixture.requests.filter(request => request.route === "/new-source").at(-1).range, null);
    });
    await check("mismatched Content-Range / changed ETag fail with no hidden retry", async () => {
      for (const behavior of ["badRange", "changedEtag"]) {
        const name = `${behavior}-store`, store = storeAt(name), route = `/${behavior}`, item = itemAt(route); let paused = false;
        await assert.rejects(store.ensureArtifact(item, { jobId: behavior, onProgress(event) { if (!paused && event.downloadedBytes >= 96 * 1024) { paused = true; store.pause(item.sha256); } } }), code("MANAGED_ARTIFACT_PAUSED"));
        fixture.behaviors.set(route, { [behavior]: true }); const count = fixture.requests.length;
        await assert.rejects(storeAt(name).ensureArtifact(item, { jobId: behavior }), code("MANAGED_ARTIFACT_RANGE_INVALID")); assert.equal(fixture.requests.length - count, 1);
        assert.equal(store.getObject(item.sha256), null);
      }
    });
    await check("connection loss persists journal; explicit retry resumes after restart", async () => {
      const name = "dropped-store", store = storeAt(name), item = itemAt("/dropped"); fixture.behaviors.set("/dropped", { dropAfter: 128 * 1024 });
      await assert.rejects(store.ensureArtifact(item, { jobId: "dropped" }), code("MANAGED_ARTIFACT_CONNECTION_FAILED"));
      assert.equal(store.getDownload(item.sha256).status, "failed"); fixture.behaviors.set("/dropped", {});
      const result = await storeAt(name).ensureArtifact(item, { jobId: "dropped" }); assert.equal(sha(fs.readFileSync(result.path)), item.sha256);
      assert.ok(fixture.requests.filter(request => request.route === "/dropped").at(-1).range);
    });
    await check("checksum / declared length failures never activate an object", async () => {
      const corruptStore = storeAt(), corrupt = itemAt("/checksum", Buffer.alloc(80 * 1024, 2)); corrupt.sha256 = "b".repeat(64);
      await assert.rejects(corruptStore.ensureArtifact(corrupt, { jobId: "checksum" }), code("MANAGED_ARTIFACT_CHECKSUM_MISMATCH")); assert.equal(corruptStore.getObject(corrupt.sha256), null);
      const lengthStore = storeAt(), length = itemAt("/length"); fixture.behaviors.set("/length", { wrongLength: 1 });
      await assert.rejects(lengthStore.ensureArtifact(length, { jobId: "length" }), code("MANAGED_ARTIFACT_SIZE_MISMATCH")); assert.equal(lengthStore.getObject(length.sha256), null);
    });
    await check("redirect / auth failures never follow or retry", async () => {
      for (const [route, behavior, expected] of [["/redirect", { redirect: `${fixture.baseUrl}/forbidden-follow` }, "MANAGED_ARTIFACT_REDIRECT_FORBIDDEN"], ["/auth", { status: 401 }, "MANAGED_ARTIFACT_AUTH_FAILED"]]) {
        const store = storeAt(), item = itemAt(route); fixture.behaviors.set(route, behavior); const count = fixture.requests.length;
        await assert.rejects(store.ensureArtifact(item, { jobId: route.slice(1) }), code(expected)); assert.equal(fixture.requests.length - count, 1);
      }
      assert.ok(!fixture.requests.some(request => request.route === "/forbidden-follow"));
    });
    await check("TLS failure is explicit and never downgrades", async () => {
      const sockets = new Set();
      const server = net.createServer(socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", () => socket.destroy()); });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const item = descriptor(body, `https://127.0.0.1:${server.address().port}/tls`);
        await assert.rejects(storeAt().ensureArtifact(item, { jobId: "tls" }), code("MANAGED_ARTIFACT_TLS_FAILED"));
      } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
    });
    await check("public DNS resolving to private/mixed addresses is blocked before sockets", async () => {
      const item = descriptor(body, "https://public.example.com/model.safetensors"), count = fixture.requests.length;
      const store = storeAt(undefined, { allowLoopbackForTests: false, lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] });
      await assert.rejects(store.ensureArtifact(item, { jobId: "dns" }), code("MANAGED_ARTIFACT_DNS_REBINDING")); assert.equal(fixture.requests.length, count);
    });
    await check("last observer pauses pending DNS before late success with zero requests", async () => trackNetworkRequests(async calls => {
      let entered, release;
      const lookupEntered = new Promise(resolve => { entered = resolve; }), lookupGate = new Promise(resolve => { release = resolve; });
      const item = itemAt("/dns-abort-late-success"); item.url = item.url.replace("127.0.0.1", "localhost");
      const store = storeAt(undefined, { timeoutMs: 2000, lookup: async () => { entered(); return lookupGate; } }), controller = new AbortController();
      const pending = store.ensureArtifact(item, { jobId: "dns-abort-late-success", signal: controller.signal });
      const rejected = assert.rejects(pending, code("MANAGED_ARTIFACT_PAUSED"));
      try {
        await bounded(lookupEntered); controller.abort(); await bounded(rejected);
        assert.equal(store.getDownload(item.sha256).status, "paused"); assert.deepEqual(calls, []);
      } finally { release([{ address: "127.0.0.1", family: 4 }]); await rejected; }
      await delay(20); assert.deepEqual(calls, []);
    }));
    await check("late DNS rejection after pause is consumed without unhandled rejection", async () => trackNetworkRequests(async calls => {
      let entered, rejectLookup;
      const lookupEntered = new Promise(resolve => { entered = resolve; }), lookupGate = new Promise((_resolve, reject) => { rejectLookup = reject; });
      const item = itemAt("/dns-abort-late-error"); item.url = item.url.replace("127.0.0.1", "localhost");
      const store = storeAt(undefined, { timeoutMs: 2000, lookup: async () => { entered(); return lookupGate; } }), controller = new AbortController(), unhandled = [];
      const onUnhandled = error => unhandled.push(error); process.on("unhandledRejection", onUnhandled);
      const rejected = assert.rejects(store.ensureArtifact(item, { jobId: "dns-abort-late-error", signal: controller.signal }), code("MANAGED_ARTIFACT_PAUSED"));
      try {
        await bounded(lookupEntered); controller.abort(); await bounded(rejected);
        rejectLookup(Object.assign(new Error("fake DNS failure"), { code: "ENOTFOUND" }));
        await delay(20); assert.deepEqual(calls, []); assert.deepEqual(unhandled, []);
      } finally { rejectLookup(new Error("fixture released")); process.removeListener("unhandledRejection", onUnhandled); await rejected; }
    }));
    await check("nonresponding DNS times out before any request or socket", async () => trackNetworkRequests(async calls => {
      let lookups = 0;
      const item = itemAt("/dns-timeout"); item.url = item.url.replace("127.0.0.1", "localhost");
      const store = storeAt(undefined, { timeoutMs: 40, lookup: () => { lookups++; return new Promise(() => {}); } });
      await bounded(assert.rejects(store.ensureArtifact(item, { jobId: "dns-timeout" }), code("MANAGED_ARTIFACT_DNS_TIMEOUT")));
      assert.equal(lookups, 1); assert.deepEqual(calls, []);
      assert.equal(store.getDownload(item.sha256).status, "failed"); assert.equal(store.getDownload(item.sha256).lastErrorCode, "MANAGED_ARTIFACT_DNS_TIMEOUT");
    }));
    await check("one observer can leave pending DNS while its peer completes one request", async () => trackNetworkRequests(async calls => {
      let entered, release, lookups = 0;
      const lookupEntered = new Promise(resolve => { entered = resolve; }), lookupGate = new Promise(resolve => { release = resolve; });
      const item = itemAt("/dns-shared-observers"); item.url = item.url.replace("127.0.0.1", "localhost");
      const store = storeAt(undefined, { timeoutMs: 2000, lookup: async () => { lookups++; entered(); return lookupGate; } }), controller = new AbortController();
      const primary = store.ensureArtifact(item, { jobId: "dns-observer-a", signal: controller.signal });
      const secondary = store.ensureArtifact(item, { jobId: "dns-observer-b" }), primaryRejected = assert.rejects(primary, code("MANAGED_ARTIFACT_PAUSED"));
      try {
        await bounded(lookupEntered); controller.abort(); await bounded(primaryRejected); assert.deepEqual(calls, []);
      } finally { release([{ address: "127.0.0.1", family: 4 }]); }
      const completed = await bounded(secondary, 3000); assert.equal(sha(fs.readFileSync(completed.path)), item.sha256);
      assert.equal(lookups, 1); assert.deepEqual(calls, ["http"]);
    }));
    await check("disk preflight and overlapping reservations reject before transfer", async () => {
      const low = storeAt(undefined, { availableBytes: () => 1 }), item = itemAt("/disk"), count = fixture.requests.length;
      await assert.rejects(low.ensureArtifact(item, { jobId: "disk" }), code("MANAGED_ARTIFACT_DISK_FULL")); assert.equal(fixture.requests.length, count);
      const overlap = storeAt(undefined, { availableBytes: async () => body.length + 1 }), one = itemAt("/disk-one"), two = itemAt("/disk-two", Buffer.alloc(body.length, 3));
      const results = await Promise.allSettled([overlap.ensureArtifact(one, { jobId: "disk-one" }), overlap.ensureArtifact(two, { jobId: "disk-two" })]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.ok(results.some(result => result.status === "rejected" && result.reason.code === "MANAGED_ARTIFACT_DISK_FULL"));
    });
    await check("persistent references and active leases protect shared objects from GC", async () => {
      const name = "reference-store", store = storeAt(name), item = itemAt("/references"); await store.ensureArtifact(item, { jobId: "references" });
      store.retain("runtime-a", [item.sha256]); store.retain("runtime-b", [item.sha256]); assert.equal(store.referenceSnapshot().counts[item.sha256], 2);
      store.release("runtime-a"); assert.deepEqual((await storeAt(name).collect()).removed, []);
      store.acquireLease("active-install", [item.sha256]); store.release("runtime-b"); assert.deepEqual((await storeAt(name).collect()).removed, []);
      store.releaseLease("active-install"); assert.deepEqual((await store.collect()).removed, [item.sha256]); assert.equal(store.getObject(item.sha256), null);
    });
    await check("tampered immutable object is rejected without redownload", async () => {
      const store = storeAt(), item = itemAt("/tamper"); const result = await store.ensureArtifact(item, { jobId: "tamper" });
      fs.writeFileSync(result.path, Buffer.alloc(item.bytes, 0)); const count = fixture.requests.length;
      await assert.rejects(store.ensureArtifact(item, { jobId: "tamper-again" }), code("MANAGED_ARTIFACT_CHECKSUM_MISMATCH")); assert.equal(fixture.requests.length, count);
    });
    await check("project directories, junctions and hardlinked objects are rejected", async () => {
      const project = path.join(directory, "project"); fs.mkdirSync(project);
      assert.throws(() => createManagedArtifactStore({ root: path.join(project, "models"), projectRoots: [project] }), code("MANAGED_ARTIFACT_ROOT_INVALID"));
      const outside = path.join(directory, "outside"), link = path.join(directory, "junction"); fs.mkdirSync(outside); fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      assert.throws(() => createManagedArtifactStore({ root: path.join(link, "managed") }), code("MANAGED_ARTIFACT_PATH_UNSAFE"));
      const name = "hardlink-store", store = storeAt(name), hash = sha(Buffer.from("hardlink")), target = path.join(directory, "hardlink-target"); fs.writeFileSync(target, "hardlink"); fs.linkSync(target, path.join(directory, name, "objects", "sha256", hash));
      assert.throws(() => store.getObject(hash), code("MANAGED_ARTIFACT_PATH_UNSAFE"));
    });
    await check("another live process cannot mutate or collect the same store", async () => {
      const root = path.join(directory, "process-owner-store"); createManagedArtifactStore({ root, allowLoopbackForTests: true, reserveBytes: 0 });
      const child = spawn(process.execPath, [__filename, "--ownership-child", root], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", chunk => { output += chunk; });
      const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      assert.equal(exitCode, 0); assert.equal(output.trim(), "MANAGED_ARTIFACT_STORE_IN_USE");
    });
    await check("separate roots in one Main PID keep independent ownership tokens and leases", async () => {
      const firstName = "pid-root-a", secondName = "pid-root-b", first = storeAt(firstName), second = storeAt(secondName);
      const firstOwner = JSON.parse(fs.readFileSync(path.join(directory, firstName, "owner.lock.json"), "utf8"));
      const secondOwner = JSON.parse(fs.readFileSync(path.join(directory, secondName, "owner.lock.json"), "utf8"));
      assert.equal(firstOwner.pid, process.pid); assert.equal(secondOwner.pid, process.pid); assert.notEqual(firstOwner.token, secondOwner.token);
      const firstHash = "a".repeat(64), secondHash = "b".repeat(64);
      first.acquireLease("same-owner", [firstHash]); second.acquireLease("same-owner", [secondHash]);
      assert.deepEqual(first.referenceSnapshot().leases, { "same-owner": [firstHash] }); assert.deepEqual(second.referenceSnapshot().leases, { "same-owner": [secondHash] });
      first.releaseLease("same-owner"); assert.deepEqual(second.referenceSnapshot().leases, { "same-owner": [secondHash] });
      assert.deepEqual(storeAt(firstName).referenceSnapshot().leases, {}); assert.deepEqual(storeAt(secondName).referenceSnapshot().leases, { "same-owner": [secondHash] });
      second.releaseLease("same-owner");
    });
    await check("filesystem errors expose stable codes without absolute paths", async () => {
      const blocked = path.join(directory, "blocked-root"); fs.writeFileSync(blocked, "file");
      assert.throws(() => createManagedArtifactStore({ root: blocked }), error => error.code === "MANAGED_ARTIFACT_IO_FAILED" && !error.message.includes(directory));
      const store = storeAt(undefined, { availableBytes() { throw Object.assign(new Error(`private ${directory}`), { code: "ENOSPC" }); } }), item = itemAt("/native-space");
      await assert.rejects(store.ensureArtifact(item, { jobId: "native-space" }), error => error.code === "MANAGED_ARTIFACT_DISK_FULL" && !error.message.includes(directory));
    });
    await check("pre-aborted authorization signal performs zero DNS lookups or requests", async () => trackNetworkRequests(async calls => {
      let lookups = 0;
      const store = storeAt(undefined, { lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; } }), item = itemAt("/aborted"), controller = new AbortController();
      item.url = item.url.replace("127.0.0.1", "localhost"); controller.abort();
      await assert.rejects(store.ensureArtifact(item, { jobId: "aborted", signal: controller.signal }), code("MANAGED_ARTIFACT_PAUSED")); assert.equal(lookups, 0); assert.deepEqual(calls, []);
    }));
    const report = { ok: true, policy: "fake-loopback-only", realPayloadDownloads: 0, realModelRequests: 0, dependencyInstalls: 0, caseCount: cases.length, requestCount: fixture.requests.length, cases, evidenceDirectory: directory, generatedAt: new Date().toISOString() };
    const reportPath = path.resolve(__dirname, "..", ".diagnostics", "comfyui-workflows-delivery", "managed-artifact-report.json"); fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify({ ok: true, caseCount: cases.length, reportPath })}\n`);
  } finally { await fixture.close(); }
}
if (require.main === module) {
  if (process.argv[2] === "--partial-child") {
    const [, , , root, url, hash, size] = process.argv, body = Buffer.alloc(Number(size), 0x4d), item = descriptor(body, url);
    assert.equal(item.sha256, hash);
    const store = createManagedArtifactStore({ root, allowLoopbackForTests: true, reserveBytes: 0 }); let exiting = false;
    store.ensureArtifact(item, { jobId: "child-process-job", onProgress(event) { if (!exiting && event.downloadedBytes >= 128 * 1024) { exiting = true; setTimeout(() => process.exit(0), 0); } } }).catch(error => { process.stderr.write(`${error.code}\n`); process.exitCode = 1; });
  } else if (process.argv[2] === "--ownership-child") {
    try { createManagedArtifactStore({ root: process.argv[3] }); process.exitCode = 1; }
    catch (error) { process.stdout.write(`${error.code}\n`); process.exitCode = error.code === "MANAGED_ARTIFACT_STORE_IN_USE" ? 0 : 1; }
  } else main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
module.exports = { createFixture, descriptor, manifest };
