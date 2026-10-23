"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createComfyUiRuntimeService } = require("../desktop/comfyui-runtime-service.cjs");
const { createManagedArtifactStore } = require("../desktop/managed-artifact-store.cjs");
const { createComfyUiArchiveService, parseSevenZipListing, SEVEN_ZIP_SHA256 } = require("../desktop/comfyui-runtime-archive.cjs");
const sevenZipPath = require("7zip-bin").path7za;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function createPortableFixture(root, version = "1", extraEntries = []) {
  const directory = path.join(root, `fixture-${version}`), portable = path.join(directory, "ComfyUI_windows_portable");
  fs.mkdirSync(path.join(portable, "python_embeded"), { recursive: true }); fs.mkdirSync(path.join(portable, "ComfyUI"), { recursive: true });
  const python = Buffer.from(`MZ FAKE FIXTURE ${version}; NEVER EXECUTE`), main = Buffer.from(`# Fake ComfyUI fixture ${version}; never executed\n`);
  fs.writeFileSync(path.join(portable, "python_embeded", "python.exe"), python); fs.writeFileSync(path.join(portable, "ComfyUI", "main.py"), main);
  for (const entry of extraEntries) { const file = path.join(portable, ...entry.name.split("/")); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.data); }
  const archive = path.join(root, `portable-${version}.7z`);
  const result = spawnSync(sevenZipPath, ["a", "-t7z", "-mx=0", archive, "ComfyUI_windows_portable"], { cwd: directory, windowsHide: true, shell: false, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); const bytes = fs.readFileSync(archive);
  return { directory: portable, archive, bytes, expandedBytes: python.length + main.length + extraEntries.reduce((sum, entry) => sum + Buffer.byteLength(entry.data), 0) };
}
function createSpawnFixture(calls = []) {
  let sequence = 0;
  return (command, args, options) => {
    const child = new EventEmitter(); child.pid = 60000 + ++sequence; child.kills = 0;
    child.kill = signal => { child.kills++; child.lastSignal = signal; queueMicrotask(() => { child.emit("exit", 0); child.emit("close", 0); }); return true; };
    calls.push({ command, args, options, child }); return child;
  };
}
function crc32(bytes) { let result = 0xffffffff; for (const byte of bytes) { result ^= byte; for (let i = 0; i < 8; i++) result = result >>> 1 ^ (result & 1 ? 0xedb88320 : 0); } return (result ^ 0xffffffff) >>> 0; }
function writeZip(file, entries) {
  const chunks = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data), crc = crc32(data), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, data); const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((entry.mode || 0x81a4) * 65536) >>> 0, 38); directory.writeUInt32LE(offset, 42); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const center = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16); fs.writeFileSync(file, Buffer.concat([...chunks, center, end]));
}
async function waitJob(service, jobId, desired = ["completed", "failed"], timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const job = service.status({ jobId }).job; if (desired.includes(job.state)) return job; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Job did not settle: ${JSON.stringify(service.status({ jobId }))}`);
}
async function main() {
  const root = path.resolve(__dirname, ".."), runDir = path.join(root, ".diagnostics", `comfyui-runtime-${Date.now()}`); fs.mkdirSync(runDir, { recursive: true });
  const results = [], calls = [], artifacts = new Map(), requestLog = [], healthRequests = [], dialogLog = [], pick = [];
  let consent = 1, enoughDisk = true, healthy = true, busy = false, liveOrphan = false, healthGate;
  const server = http.createServer((request, response) => {
    requestLog.push({ path: request.url, range: request.headers.range || "" });
    const item = artifacts.get(request.url); if (!item) { response.writeHead(404).end(); return; }
    const offset = request.headers.range ? Number(/^bytes=(\d+)-$/.exec(request.headers.range)?.[1]) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= item.bytes.length) { response.writeHead(416).end(); return; }
    response.writeHead(offset ? 206 : 200, { "content-type": "application/octet-stream", "content-length": item.bytes.length - offset, etag: `"${hash(item.bytes)}"`, ...(offset ? { "content-range": `bytes ${offset}-${item.bytes.length - 1}/${item.bytes.length}` } : {}) });
    if (!item.slow) { response.end(item.bytes.subarray(offset)); return; }
    let cursor = offset; const timer = setInterval(() => { const end = Math.min(cursor + 16384, item.bytes.length); response.write(item.bytes.subarray(cursor, end)); cursor = end; if (cursor >= item.bytes.length) { clearInterval(timer); response.end(); } }, 4); response.once("close", () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); server.unref(); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const license = { id: "MIT (fake fixture)", url: "https://example.com/fixture-license" };
  const descriptor = (name, fixture, overrides = {}) => { const pathname = `/${name}`; artifacts.set(pathname, { bytes: fixture.bytes, slow: overrides.slow }); return { id: name, kind: "runtime", format: "7z", filename: `${name}.7z`, bytes: fixture.bytes.length, expandedBytes: fixture.expandedBytes, sha256: hash(fixture.bytes), url: `${baseUrl}${pathname}`, license, components: [{ name: "fake-comfyui-python", version: name, license }], dependencies: [], destination: ".", ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "slow")) }; };
  const rawManifest = (name, artifact, modelOnly = false) => ({ schemaVersion: 1, id: name, label: `Fixture ${name}`, version: name, adapter: "comfyui-portable", ...(!modelOnly ? { runtime: { artifactId: artifact.id, cpu: true } } : {}), requirements: { os: ["win32"], arch: ["x64"], gpu: ["cpu"], vramBytes: 0, diskBytes: artifact.bytes + artifact.expandedBytes }, artifacts: [artifact] });
  const dialog = { async showOpenDialog() { const file = pick.shift(); assert(file, "test must explicitly choose a native input"); return { canceled: false, filePaths: [file] }; }, async showMessageBox(options) { dialogLog.push(options); return { response: consent }; } };
  const managedRoot = path.join(runDir, "managed"), objectRoot = path.join(runDir, "artifact-store");
  const connectionRecords = new Map(), connectionService = { getInternal: key => connectionRecords.get(key), create: value => { connectionRecords.set(value.id, value); return value; }, remove: key => connectionRecords.delete(key) };
  let currentStore;
  const create = () => { currentStore = createManagedArtifactStore({ root: objectRoot, allowLoopbackForTests: true }); return createComfyUiRuntimeService({ rootDir: managedRoot, artifactStore: currentStore, dialog, connectionService, sevenZipPath, allowLoopbackForTests: true, spawn: createSpawnFixture(calls), healthCheck: async () => { if (healthGate) await healthGate; if (!healthy) throw new Error("fixture health failure with private path and token"); return true; }, healthTimeoutMs: 5, diskFreeBytes: () => enoughDisk ? 100 * 1024 ** 3 : 0, isConnectionBusy: () => busy, isProcessAlive: () => liveOrphan }); };
  let service = create();
  const importRaw = async raw => { const file = path.join(runDir, `manifest-${raw.id}.json`); fs.writeFileSync(file, JSON.stringify(raw)); pick.push(file); return (await service.importManifest()).manifest; };
  const test = async (name, run) => { await run(); results.push({ name, ok: true }); };
  let installed, firstManifest, firstPlan, firstJob, firstRevision, secondRevision, existing;
  try {
    const portable = createPortableFixture(runDir, "one"), artifact = descriptor("portable-one", portable), raw = rawManifest("one", artifact);
    await test("official metadata candidate cannot masquerade as an audited manifest", async () => { const candidate = service.list().manifests.find(item => item.reviewStatus === "needs-review"); assert(candidate); assert.equal(candidate.installable, false); assert.equal(candidate.manifestHash, undefined); assert.throws(() => service.plan({ manifestId: candidate.manifestId }), { code: "COMFYUI_RUNTIME_MANIFEST_NEEDS_REVIEW" }); assert.equal(requestLog.length, 0); });
    await test("native import and immutable plan perform zero network and expose identities only", async () => { firstManifest = await importRaw(raw); firstPlan = service.plan({ manifestId: firstManifest.manifestId }); assert.equal(firstPlan.canInstall, true); assert.equal(requestLog.length, 0); assert.equal(firstPlan.artifacts[0].bytes, portable.bytes.length); assert.equal(firstPlan.artifacts[0].sourceLabel, "127.0.0.1"); assert.doesNotMatch(JSON.stringify({ manifest: firstManifest, plan: firstPlan }), /http:|https:|python\.exe|filePaths|\.diagnostics/); });
    await test("CLI confirmed cannot authorize download when native consent is cancelled", async () => { consent = 0; assert.equal((await service.install({ planId: firstPlan.planId, confirmed: true })).canceled, true); assert.equal(requestLog.length, 0); consent = 1; });
    await test("real pinned 7za extracts a tiny portable, stub health validates before activation", async () => { const response = await service.install({ planId: firstPlan.planId }); firstJob = await waitJob(service, response.job.jobId); assert.equal(firstJob.state, "completed", JSON.stringify(firstJob)); installed = service.status({ runtimeId: response.job.runtimeId }).runtime; firstRevision = installed.activeRevisionId; assert.equal(calls.length, 1); assert.equal(calls[0].child.kills, 1); assert.equal(calls[0].options.shell, false); assert.equal(calls[0].options.env.PIP_NO_INDEX, "1"); assert(!Object.hasOwn(calls[0].options.env, "OPENAI_API_KEY")); assert.deepEqual(calls[0].args.slice(0, 9), ["-s", "ComfyUI/main.py", "--listen", "127.0.0.1", "--port", "18188", "--windows-standalone-build", "--cpu", "--extra-model-paths-config"]); assert.equal(requestLog.length, 1); assert(dialogLog.at(-1).detail.includes(artifact.url)); });
    await test("duplicate installation reuses the original job, artifact and consent", async () => { const before = [requestLog.length, dialogLog.length, calls.length]; const duplicate = await service.install({ planId: firstPlan.planId }); assert.equal(duplicate.job.jobId, firstJob.jobId); assert.deepEqual([requestLog.length, dialogLog.length, calls.length], before); });
    await test("parallel start is one native authorization and one owned child", async () => { const before = [dialogLog.length, calls.length]; const starts = await Promise.all([service.start({ runtimeId: installed.runtimeId }), service.start({ runtimeId: installed.runtimeId })]); assert(starts.every(result => result.runtime.state === "running")); assert.equal(dialogLog.length, before[0] + 1); assert.equal(calls.length, before[1] + 1); assert.throws(() => service.remove({ runtimeId: installed.runtimeId }), { code: "COMFYUI_RUNTIME_BUSY" }); busy = true; await assert.rejects(service.stop({ runtimeId: installed.runtimeId }), { code: "COMFYUI_RUNTIME_BUSY" }); busy = false; await service.stop({ runtimeId: installed.runtimeId }); });
    await test("side by side upgrade and rollback retain both verified revisions", async () => { const next = await importRaw(rawManifest("two", descriptor("portable-two", createPortableFixture(runDir, "two")))); const plan = service.plan({ manifestId: next.manifestId, runtimeId: installed.runtimeId }); const job = await service.install({ planId: plan.planId }); assert.equal((await waitJob(service, job.job.jobId)).state, "completed"); const upgraded = service.status({ runtimeId: installed.runtimeId }).runtime; secondRevision = upgraded.activeRevisionId; assert.notEqual(secondRevision, firstRevision); assert.equal(upgraded.revisions.length, 2); assert.equal(service.rollback({ runtimeId: installed.runtimeId, revisionId: firstRevision }).runtime.activeRevisionId, firstRevision); assert.equal(service.rollback({ runtimeId: installed.runtimeId, revisionId: secondRevision }).runtime.activeRevisionId, secondRevision); assert.equal((await service.install({ planId: plan.planId })).job.jobId, job.job.jobId); });
    await test("failed health preserves old active version and removes the new revision", async () => { healthy = false; const next = await importRaw(rawManifest("bad-health", descriptor("portable-bad-health", createPortableFixture(runDir, "bad-health")))); const job = await service.install({ planId: service.plan({ manifestId: next.manifestId, runtimeId: installed.runtimeId }).planId }); const result = await waitJob(service, job.job.jobId); healthy = true; assert.equal(result.state, "failed"); assert.equal(result.errorCode, "COMFYUI_RUNTIME_HEALTH_FAILED"); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.activeRevisionId, secondRevision); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.revisions.length, 2); });
    await test("activation journal failure restores the old in-memory and persisted revision", async () => {
      const next = await importRaw(rawManifest("bad-commit", descriptor("portable-bad-commit", createPortableFixture(runDir, "bad-commit"))));
      const plan = service.plan({ manifestId: next.manifestId, runtimeId: installed.runtimeId });
      const originalRename = fs.renameSync; let injected = false;
      fs.renameSync = function(source, destination) {
        if (!injected && destination === path.join(managedRoot, "runtime-journal.json") && JSON.parse(fs.readFileSync(source, "utf8")).jobs.some(job => job.manifestId === next.manifestId && job.state === "completed")) { injected = true; throw Object.assign(new Error("fixture activation save denied"), { code: "EACCES" }); }
        return originalRename.apply(this, arguments);
      };
      try {
        const job = await service.install({ planId: plan.planId }); const result = await waitJob(service, job.job.jobId);
        assert.equal(injected, true); assert.equal(result.state, "failed"); assert.equal(result.errorCode, "COMFYUI_RUNTIME_ACTIVATION_SAVE_FAILED");
        assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.activeRevisionId, secondRevision);
        const persisted = JSON.parse(fs.readFileSync(path.join(managedRoot, "runtime-journal.json"))).runtimes.find(runtime => runtime.runtimeId === installed.runtimeId);
        assert.equal(persisted.activeRevisionId, secondRevision); assert.equal(persisted.revisions.length, 2);
        assert(fs.existsSync(persisted.revisions.find(revision => revision.revisionId === secondRevision).directory));
        assert.equal(fs.readdirSync(path.join(managedRoot, "runtimes", installed.runtimeId, "revisions")).length, 2);
        await service.start({ runtimeId: installed.runtimeId }); await service.stop({ runtimeId: installed.runtimeId });
      } finally { fs.renameSync = originalRename; }
    });
    await test("rollback journal failure restores the in-memory active pointer", async () => {
      const originalRename = fs.renameSync; let injected = false;
      fs.renameSync = function(source, destination) { if (!injected && destination === path.join(managedRoot, "runtime-journal.json") && JSON.parse(fs.readFileSync(source, "utf8")).runtimes.some(runtime => runtime.runtimeId === installed.runtimeId && runtime.activeRevisionId === firstRevision)) { injected = true; throw Object.assign(new Error("fixture rollback save denied"), { code: "EACCES" }); } return originalRename.apply(this, arguments); };
      try { assert.throws(() => service.rollback({ runtimeId: installed.runtimeId, revisionId: firstRevision }), { code: "COMFYUI_RUNTIME_ACTIVATION_SAVE_FAILED" }); assert.equal(injected, true); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.activeRevisionId, secondRevision); assert.equal(JSON.parse(fs.readFileSync(path.join(managedRoot, "runtime-journal.json"))).runtimes.find(runtime => runtime.runtimeId === installed.runtimeId).activeRevisionId, secondRevision); }
      finally { fs.renameSync = originalRename; }
    });
    await test("process ownership save failure stops the child with its listeners already attached", async () => {
      const originalRename = fs.renameSync; let injected = false;
      fs.renameSync = function(source, destination) { if (!injected && destination === path.join(managedRoot, "runtime-journal.json") && JSON.parse(fs.readFileSync(source, "utf8")).runtimes.some(runtime => runtime.runtimeId === installed.runtimeId && runtime.processRecord)) { injected = true; throw Object.assign(new Error("fixture process record denied"), { code: "EACCES" }); } return originalRename.apply(this, arguments); };
      try { const before = calls.length; await assert.rejects(service.start({ runtimeId: installed.runtimeId }), { code: "COMFYUI_RUNTIME_PROCESS_RECORD_FAILED" }); assert.equal(injected, true); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).child.kills, 1); assert.equal((await service.stop({ runtimeId: installed.runtimeId })).runtime.state, "stopped"); assert(!JSON.parse(fs.readFileSync(path.join(managedRoot, "runtime-journal.json"))).runtimes.find(runtime => runtime.runtimeId === installed.runtimeId).processRecord); }
      finally { fs.renameSync = originalRename; }
    });
    await test("install after rollback creates a new activation plan instead of returning an old completed job", async () => {
      const manifest = service.list().manifests.find(item => item.label === "Fixture two"), before = [requestLog.length, dialogLog.length, calls.length];
      service.rollback({ runtimeId: installed.runtimeId, revisionId: firstRevision });
      const plan = service.plan({ manifestId: manifest.manifestId, runtimeId: installed.runtimeId }), job = (await service.install({ planId: plan.planId })).job;
      assert.equal((await waitJob(service, job.jobId)).state, "completed"); const active = service.status({ runtimeId: installed.runtimeId }).runtime; assert.notEqual(active.activeRevisionId, firstRevision); assert.notEqual(active.activeRevisionId, secondRevision); secondRevision = active.activeRevisionId;
      assert.equal(active.revisions.length, 3); assert.equal(requestLog.length, before[0]); assert.equal(dialogLog.length, before[1] + 1); assert.equal(calls.length, before[2] + 1);
    });
    await test("runtime archive cannot smuggle an undeclared executable custom node", async () => {
      const fixture = createPortableFixture(runDir, "hidden-node", [{ name: "ComfyUI/custom_nodes/unsigned/__init__.py", data: "# fake custom node; never executed\n" }]);
      const manifest = await importRaw(rawManifest("hidden-node", descriptor("hidden-node", fixture))), before = calls.length;
      const job = (await service.install({ planId: service.plan({ manifestId: manifest.manifestId, runtimeId: installed.runtimeId }).planId })).job, result = await waitJob(service, job.jobId);
      assert.equal(result.state, "failed"); assert.equal(result.errorCode, "COMFYUI_RUNTIME_NODE_UNDECLARED"); assert.equal(calls.length, before); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.activeRevisionId, secondRevision);
    });
    await test("dependency parent destination cannot hide custom_nodes archive entries", async () => {
      const entry = { name: "custom_nodes/unsigned/__init__.py", data: "# fake dependency node; never executed\n" }, zip = path.join(runDir, "dependency-hidden-node.zip"); writeZip(zip, [entry]);
      const dependency = descriptor("dependency-hidden-node", { bytes: fs.readFileSync(zip), expandedBytes: Buffer.byteLength(entry.data) }, { kind: "dependency", format: "zip", filename: "dependency-hidden-node.zip", destination: "ComfyUI" });
      const primary = descriptor("dependency-parent-runtime", portable, { dependencies: [dependency.id] }), raw = rawManifest("dependency-hidden-node", primary); raw.artifacts.push(dependency); raw.requirements.diskBytes = raw.artifacts.reduce((sum, artifact) => sum + artifact.bytes + artifact.expandedBytes, 0);
      const manifest = await importRaw(raw), before = calls.length, job = (await service.install({ planId: service.plan({ manifestId: manifest.manifestId, runtimeId: installed.runtimeId }).planId })).job, result = await waitJob(service, job.jobId);
      assert.equal(result.state, "failed"); assert.equal(result.errorCode, "COMFYUI_RUNTIME_NODE_UNDECLARED"); assert.equal(calls.length, before); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.activeRevisionId, secondRevision);
    });
    await test("portable may retain inert upstream example and README files", async () => {
      const fixture = createPortableFixture(runDir, "inert-node", [{ name: "ComfyUI/custom_nodes/example_node.py.example", data: "# inert fixture example; never executed\n" }, { name: "ComfyUI/custom_nodes/README.md", data: "Fake fixture inert documentation\n" }]), manifest = await importRaw(rawManifest("inert-node", descriptor("inert-node", fixture)));
      const job = (await service.install({ planId: service.plan({ manifestId: manifest.manifestId }).planId })).job; assert.equal((await waitJob(service, job.jobId)).state, "completed"); service.remove({ runtimeId: job.runtimeId });
    });
    await test("checksum failure prevents extraction and activation", async () => { const next = await importRaw(rawManifest("bad-sha", descriptor("bad-sha", portable, { sha256: "0".repeat(64) }))); const before = calls.length; const job = await service.install({ planId: service.plan({ manifestId: next.manifestId, runtimeId: installed.runtimeId }).planId }); assert.equal((await waitJob(service, job.job.jobId)).state, "failed"); assert.equal(calls.length, before); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.activeRevisionId, secondRevision); });
    await test("insufficient disk refuses installation before consent and network", async () => { enoughDisk = false; const preview = service.plan({ manifestId: firstManifest.manifestId, runtimeId: installed.runtimeId }); assert.equal(preview.canInstall, false); const before = [requestLog.length, dialogLog.length]; await assert.rejects(service.install({ planId: preview.planId }), { code: "COMFYUI_RUNTIME_DISK_SPACE" }); assert.deepEqual([requestLog.length, dialogLog.length], before); enoughDisk = true; });
    await test("existing import is native, idempotent and leaves Python bytes unchanged", async () => { const before = hash(fs.readFileSync(path.join(portable.directory, "python_embeded", "python.exe"))); pick.push(portable.directory); existing = (await service.registerExisting()).runtime; pick.push(portable.directory); assert.equal((await service.registerExisting()).runtime.runtimeId, existing.runtimeId); assert.equal(existing.mode, "existing"); assert.equal(hash(fs.readFileSync(path.join(portable.directory, "python_embeded", "python.exe"))), before); assert.throws(() => service.plan({ manifestId: firstManifest.manifestId, runtimeId: existing.runtimeId }), { code: "COMFYUI_RUNTIME_EXISTING_IMMUTABLE" }); });
    const modelBytes = Buffer.from("FAKE SAFETENSORS FIXTURE; NEVER LOADED"), modelArtifact = descriptor("model-one", { bytes: modelBytes, expandedBytes: modelBytes.length }, { kind: "model", format: "file", filename: "fixture.safetensors", destination: "checkpoints", modelType: "checkpoint" });
    let modelManifest;
    await test("model only requires a runtime and configures managed paths without editing existing Python", async () => { modelManifest = await importRaw(rawManifest("model-one", modelArtifact, true)); assert.equal(modelManifest.modelOnly, true); assert.throws(() => service.plan({ manifestId: modelManifest.manifestId }), { code: "COMFYUI_RUNTIME_TARGET_REQUIRED" }); const before = fs.readdirSync(portable.directory).sort(); const job = await service.install({ planId: service.plan({ manifestId: modelManifest.manifestId, runtimeId: existing.runtimeId }).planId }); assert.equal((await waitJob(service, job.job.jobId)).state, "completed"); assert.deepEqual(fs.readdirSync(portable.directory).sort(), before); const journal = JSON.parse(fs.readFileSync(path.join(managedRoot, "runtime-journal.json"))); const runtime = journal.runtimes.find(item => item.runtimeId === existing.runtimeId), revision = runtime.revisions.at(-1); assert.equal(revision.directory, portable.directory); const config = JSON.parse(fs.readFileSync(revision.modelConfigPath)); const group = Object.values(config)[0]; assert(group.base_path.startsWith(path.join(managedRoot, "models", "checkpoints"))); assert.equal(group.checkpoints, "."); assert(fs.existsSync(path.join(group.base_path, "fixture.safetensors"))); });
    await test("temporary runtime blocks its profile and loopback aliases and never kills a late busy task", async () => {
      const bytes = Buffer.from("FAKE BUSY VALIDATION MODEL; NEVER LOADED"), item = descriptor("model-busy", { bytes, expandedBytes: bytes.length }, { kind: "model", format: "file", filename: "busy.safetensors", destination: "vae", modelType: "vae" });
      const manifest = await importRaw(rawManifest("model-busy", item, true)), previous = service.status({ runtimeId: existing.runtimeId }).runtime.activeRevisionId, before = calls.length;
      let release; healthGate = new Promise(resolve => { release = resolve; });
      const job = (await service.install({ planId: service.plan({ manifestId: manifest.manifestId, runtimeId: existing.runtimeId }).planId })).job;
      try {
      const deadline = Date.now() + 5000; while (calls.length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(calls.length, before + 1);
      const internal = connectionRecords.get(existing.connectionId), port = new URL(internal.baseUrl).port;
      assert.throws(() => service.assertConnectionAvailable(internal), { code: "COMFYUI_RUNTIME_BUSY" });
      assert.throws(() => service.assertConnectionAvailable({ id: "alias", networkScope: "local", baseUrl: `http://localhost:${port}` }), { code: "COMFYUI_RUNTIME_BUSY" });
      assert.equal(service.assertConnectionAvailable({ id: "external", networkScope: "local", baseUrl: "http://127.0.0.1:12345" }), true);
      busy = true; release(); healthGate = undefined;
      const result = await waitJob(service, job.jobId); assert.equal(result.state, "failed"); assert.equal(result.errorCode, "COMFYUI_RUNTIME_BUSY"); assert.equal(calls.at(-1).child.kills, 0);
      const copy = path.join(managedRoot, "models", "vae", item.sha256, item.filename); assert(fs.existsSync(copy)); assert.equal(service.status({ runtimeId: existing.runtimeId }).runtime.activeRevisionId, previous);
      assert.throws(() => service.assertConnectionAvailable(internal), { code: "COMFYUI_RUNTIME_BUSY" });
      busy = false; await service.stop({ runtimeId: existing.runtimeId }); assert.equal(calls.at(-1).child.kills, 1); assert(!fs.existsSync(copy)); assert.equal(service.assertConnectionAvailable(internal), true);
      } finally { release(); healthGate = undefined; busy = false; }
    });
    for (const stage of ["copy", "hash"]) await test(`model ${stage} pause closes actual streams before return and resumes without another download or consent`, async () => {
      const bytes = Buffer.alloc(8 * 1024 * 1024, stage === "copy" ? 0x43 : 0x48), item = descriptor(`model-pause-${stage}`, { bytes, expandedBytes: bytes.length }, { kind: "model", format: "file", filename: `pause-${stage}.safetensors`, destination: "loras", modelType: "lora" });
      const manifest = await importRaw(rawManifest(`model-pause-${stage}`, item, true)), before = calls.length;
      const originalRead = fs.createReadStream, originalWrite = fs.createWriteStream, handles = [];
      const directory = path.join(managedRoot, "models", "loras", item.sha256); let jobId, paused, readBytes = 0;
      const observe = stream => { const handle = { closed: false }; handles.push(handle); stream.once("close", () => { handle.closed = true; }); return stream; };
      fs.createReadStream = function(file, options) {
        const stream = originalRead.apply(this, arguments), name = String(file);
        const matches = stage === "copy" ? name === currentStore.getObject(item.sha256)?.path && jobId && service.status({ jobId }).job.state === "installing" : path.dirname(name) === directory && path.basename(name).startsWith(".copy-");
        if (matches) { observe(stream); stream.on("data", chunk => { readBytes += chunk.length; if (!paused) paused = service.pause({ jobId }); }); }
        return stream;
      };
      fs.createWriteStream = function(file, options) { const stream = originalWrite.apply(this, arguments); if (path.dirname(String(file)) === directory) observe(stream); return stream; };
      try {
        jobId = (await service.install({ planId: service.plan({ manifestId: manifest.manifestId, runtimeId: existing.runtimeId }).planId })).job.jobId;
        const deadline = Date.now() + 5000; while (!paused && Date.now() < deadline) { if (["completed", "failed"].includes(service.status({ jobId }).job.state)) break; await new Promise(resolve => setTimeout(resolve, 5)); }
        assert(paused, `actual ${stage} stream must reach pause before activation`); assert.equal((await paused).job.state, "paused");
        assert(readBytes > 0 && readBytes < bytes.length); assert(handles.length >= 2); assert(handles.every(handle => handle.closed));
        assert.equal(calls.length, before); assert(!fs.existsSync(path.join(directory, item.filename))); assert(!fs.readdirSync(directory).some(name => name.endsWith(".tmp")));
      } finally { fs.createReadStream = originalRead; fs.createWriteStream = originalWrite; }
      const approved = dialogLog.length, downloaded = requestLog.length; service.resume({ jobId }); assert.equal((await waitJob(service, jobId)).state, "completed");
      assert.equal(dialogLog.length, approved); assert.equal(requestLog.length, downloaded); assert.equal(calls.length, before + 1); assert.equal(hash(fs.readFileSync(path.join(directory, item.filename))), item.sha256);
    });
    await test("download pause and new service resume retain original native authorization", async () => { const bytes = Buffer.alloc(2 * 1024 * 1024, 0x37), item = descriptor("model-resume", { bytes, expandedBytes: bytes.length }, { kind: "model", format: "file", filename: "resume.safetensors", destination: "loras", modelType: "lora", slow: true }); const manifest = await importRaw(rawManifest("model-resume", item, true)); const job = (await service.install({ planId: service.plan({ manifestId: manifest.manifestId, runtimeId: existing.runtimeId }).planId })).job; const deadline = Date.now() + 4000; while ((currentStore.getDownload(item.sha256)?.downloadedBytes || 0) < 65536 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert((currentStore.getDownload(item.sha256)?.downloadedBytes || 0) >= 65536); assert.equal((await service.pause({ jobId: job.jobId })).job.state, "paused"); const nativeCalls = dialogLog.length; await service.dispose(); service = create(); service.resume({ jobId: job.jobId }); const done = await waitJob(service, job.jobId); assert.equal(done.state, "completed", JSON.stringify(done)); assert.equal(dialogLog.length, nativeCalls); assert(requestLog.some(request => request.path === "/model-resume" && /^bytes=[1-9]/.test(request.range))); });
    await test("restart does not signal or adopt a live PID and preserves its lease", async () => { await service.start({ runtimeId: installed.runtimeId }); const original = service; liveOrphan = true; service = create(); await assert.rejects(service.start({ runtimeId: installed.runtimeId }), { code: "COMFYUI_RUNTIME_PROCESS_PENDING" }); assert.throws(() => service.remove({ runtimeId: installed.runtimeId }), { code: "COMFYUI_RUNTIME_BUSY" }); await assert.rejects(service.stop({ runtimeId: installed.runtimeId }), { code: "COMFYUI_RUNTIME_STOP_PENDING" }); const disposing = await service.dispose(); assert.equal(disposing.ok, false); assert(disposing.pendingRuntimeIds.includes(installed.runtimeId)); await original.stop({ runtimeId: installed.runtimeId }); liveOrphan = false; service = create(); assert.equal(service.status({ runtimeId: installed.runtimeId }).runtime.state, "stopped"); });
    await test("existing removal preserves user environment and clears unreferenced model copies", async () => { assert.equal(service.remove({ runtimeId: existing.runtimeId }).runtime.state, "removed"); assert(fs.existsSync(path.join(portable.directory, "python_embeded", "python.exe"))); const checkpoints = path.join(managedRoot, "models", "checkpoints"); assert.equal(fs.readdirSync(checkpoints).length, 0); const loras = path.join(managedRoot, "models", "loras"); assert.equal(fs.readdirSync(loras).length, 0); });
    await test("removed managed runtime requires a new plan, native authorization and new job", async () => {
      const previousRuntime = installed.runtimeId, before = [requestLog.length, dialogLog.length, calls.length];
      service.remove({ runtimeId: previousRuntime });
      await assert.rejects(service.install({ planId: firstPlan.planId }), { code: "COMFYUI_RUNTIME_PLAN_CHANGED" });
      const plan = service.plan({ manifestId: firstManifest.manifestId }); assert.notEqual(plan.planId, firstPlan.planId);
      const job = (await service.install({ planId: plan.planId })).job; assert.notEqual(job.jobId, firstJob.jobId); assert.notEqual(job.runtimeId, previousRuntime);
      assert.equal((await waitJob(service, job.jobId)).state, "completed"); installed = service.status({ runtimeId: job.runtimeId }).runtime;
      assert.equal(dialogLog.length, before[1] + 1); assert.equal(requestLog.length, before[0]); assert.equal(calls.length, before[2] + 1);
      assert.throws(() => service.status({ runtimeId: previousRuntime }), { code: "COMFYUI_RUNTIME_NOT_FOUND" });
    });
    let responseMode = "valid";
    const healthSpawn = createSpawnFixture(calls);
    const healthService = createComfyUiRuntimeService({ rootDir: path.join(runDir, "health-managed"), artifactStore: createManagedArtifactStore({ root: path.join(runDir, "health-artifacts"), allowLoopbackForTests: true }), dialog, sevenZipPath, healthTimeoutMs: 100, stopTimeoutMs: 1000,
      spawn(command, args, options) {
        const child = healthSpawn(command, args, options), originalKill = child.kill, port = Number(args[args.indexOf("--port") + 1]); let closing = false;
        const healthServer = http.createServer((request, response) => {
          healthRequests.push({ path: request.url, mode: responseMode });
          if (responseMode === "valid") response.end(JSON.stringify({ system: {}, devices: [] }));
          else if (responseMode === "oversized") response.end(Buffer.alloc(1024 * 1024 + 1, 0x20));
          else if (responseMode === "truncated") { response.writeHead(200, { "content-length": 100 }); response.end("{"); }
          // timeout deliberately sends no response to the loopback request.
        });
        healthServer.on("error", () => { child.emit("exit", 1); child.emit("close", 1); }); healthServer.listen(port, "127.0.0.1");
        child.kill = signal => { if (closing) return true; closing = true; child.kills++; child.lastSignal = signal; healthServer.closeAllConnections(); healthServer.close(() => { child.kills--; originalKill(signal); }); return true; };
        return child;
      },
    });
    pick.push(portable.directory); const healthRuntime = (await healthService.registerExisting()).runtime;
    try {
      await test("default health checks an actual loopback /system_stats response", async () => { assert.equal((await healthService.start({ runtimeId: healthRuntime.runtimeId })).runtime.state, "running"); await healthService.stop({ runtimeId: healthRuntime.runtimeId }); assert(healthRequests.some(request => request.mode === "valid" && request.path === "/system_stats")); });
      for (const mode of ["oversized", "truncated", "timeout"]) await test(`default health ${mode} response settles and stops its owned stub child`, async () => { responseMode = mode; const before = calls.length, started = Date.now(); await assert.rejects(healthService.start({ runtimeId: healthRuntime.runtimeId }), { code: "COMFYUI_RUNTIME_HEALTH_FAILED" }); assert(Date.now() - started < 3500); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).child.kills, 1); });
      await test("native start consent resolving after disposal cannot launch a process", async () => {
        const originalDialog = dialog.showMessageBox; let answer;
        dialog.showMessageBox = () => new Promise(resolve => { answer = resolve; });
        try { const before = calls.length, pending = healthService.start({ runtimeId: healthRuntime.runtimeId }); await new Promise(resolve => setImmediate(resolve)); assert.equal(typeof answer, "function"); await healthService.dispose(); const rejected = assert.rejects(pending, { code: "COMFYUI_RUNTIME_DISPOSED" }); answer({ response: 1 }); await rejected; assert.equal(calls.length, before); }
        finally { dialog.showMessageBox = originalDialog; }
      });
    } finally { await healthService.dispose(); }
    const extractor = createComfyUiArchiveService({ sevenZipPath });
    for (const [name, entries, expected] of [["traversal", [{ name: "../escaped.txt", data: "bad" }], "COMFYUI_RUNTIME_ARCHIVE_PATH"], ["case-collision", [{ name: "File.txt", data: "a" }, { name: "file.txt", data: "b" }], "COMFYUI_RUNTIME_ARCHIVE_COLLISION"], ["symlink", [{ name: "link", data: "../escape", mode: 0xa1ff }], "COMFYUI_RUNTIME_ARCHIVE_LINK"]]) {
      await test(`actual ZIP ${name} is rejected before extraction`, async () => { const zip = path.join(runDir, `${name}.zip`), output = path.join(runDir, `extract-${name}`); writeZip(zip, entries); fs.mkdirSync(output); await assert.rejects(extractor.extract(zip, output, { format: "zip", expandedBytes: entries.reduce((sum, item) => sum + Buffer.byteLength(item.data), 0) }), { code: expected }); assert.equal(fs.readdirSync(output).length, 0); });
    }
    await test("archive expanded byte mismatch is rejected before extraction", async () => { const output = path.join(runDir, "extract-too-large"); fs.mkdirSync(output); await assert.rejects(extractor.extract(portable.archive, output, { format: "7z", expandedBytes: 1 }), { code: "COMFYUI_RUNTIME_ARCHIVE_LIMIT" }); assert.equal(fs.readdirSync(output).length, 0); });
    await test("aborted actual 7za is closed before extraction rejects", async () => { const output = path.join(runDir, "extract-abort"); fs.mkdirSync(output); const controller = new AbortController(); const pending = extractor.extract(portable.archive, output, { format: "7z", expandedBytes: portable.expandedBytes }, { signal: controller.signal }); const timer = setTimeout(() => controller.abort(), 1); try { await assert.rejects(pending, { code: "COMFYUI_RUNTIME_PAUSED" }); assert.equal(fs.readdirSync(output).length, 0); fs.rmdirSync(output); } finally { clearTimeout(timer); } });
    await test("ADS, reserved devices and encrypted/listed links are refused", async () => { for (const unsafe of ["a:stream", "NUL.txt", "a./x", "dir/../file"]) assert.throws(() => parseSevenZipListing(`Path = ${unsafe}\nSize = 1\nAttributes = A\n`, { expandedBytes: 1 })); assert.throws(() => parseSevenZipListing("Path = a\nSize = 1\nEncrypted = +\n", { expandedBytes: 1 }), { code: "COMFYUI_RUNTIME_ARCHIVE_LINK" }); });
    await test("extractor identity is pinned before any process starts", async () => { const fakeTool = path.join(runDir, "wrong-7za.exe"), output = path.join(runDir, "extract-wrong-tool"); fs.writeFileSync(fakeTool, "MZ fake"); fs.mkdirSync(output); await assert.rejects(createComfyUiArchiveService({ sevenZipPath: fakeTool }).extract(portable.archive, output, { format: "7z", expandedBytes: portable.expandedBytes }), { code: "COMFYUI_RUNTIME_EXTRACTOR_HASH" }); assert.equal(hash(fs.readFileSync(sevenZipPath)), SEVEN_ZIP_SHA256); });
    await test("public state excludes process identity, file paths, URL, authorization and raw manifest", async () => { const text = JSON.stringify(service.list()); assert.doesNotMatch(text, /http:|https:|filePaths|python\.exe|artifactHashes|modelConfigPath|planHash|authorizedAt|\.diagnostics|processRecord/); });
    await service.dispose();
    const report = { ok: true, cases: results.length, realDownloads: 0, realDependencyInstalls: 0, realModelRequests: 0, loopbackRequests: requestLog.length, loopbackHealthRequests: healthRequests.length, stubPythonStarts: calls.length, pinnedExtractorSha256: SEVEN_ZIP_SHA256, results };
    fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2)); process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: path.join(runDir, "report.json") })}\n`);
  } catch (error) { fs.writeFileSync(path.join(runDir, "failure.json"), JSON.stringify({ results, error: String(error.stack || error), requests: requestLog, public: service.list() }, null, 2)); throw error; }
  finally { await service.dispose(); await new Promise(resolve => server.close(resolve)); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
module.exports = { createPortableFixture, createSpawnFixture, writeZip };
