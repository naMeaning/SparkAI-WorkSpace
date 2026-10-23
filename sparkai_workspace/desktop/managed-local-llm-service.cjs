"use strict";

// Main owns manifests, native consent, paths and process identity. Public DTOs
// contain stable IDs only. This adapter never accepts commands, argv or URLs
// from an Agent, starts implicitly, or downloads a model while serving a task.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { once } = require("node:events");
const { createHash, randomUUID } = require("node:crypto");
const { spawn: nativeSpawn } = require("node:child_process");
const { normalizeManagedArtifactManifest, hashManagedArtifactValue } = require("../runtime/managed-artifact-manifest.cjs");
const { createComfyUiArchiveService, assertNoLinks } = require("./comfyui-runtime-archive.cjs");

const HASH = /^[a-f0-9]{64}$/, ID = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const TERMINAL = new Set(["completed", "failed"]);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const digest = value => createHash("sha256").update(value).digest("hex");
function id(value) { if (typeof value !== "string" || !ID.test(value)) throw fail("MANAGED_LLM_ID_INVALID", "本地模型标识无效。"); return value; }
function abort(signal) { if (signal?.aborted) throw fail("MANAGED_LLM_PAUSED", "本地模型安装已暂停。"); }
function safeCode(error) { return typeof error?.code === "string" && /^(?:MANAGED_|COMFYUI_RUNTIME_)[A-Z0-9_]+$/.test(error.code) ? error.code : "MANAGED_LLM_OPERATION_FAILED"; }
function mkdir(directory) { assertNoLinks(directory, { directory: true, allowMissing: true }); fs.mkdirSync(directory, { recursive: true }); return assertNoLinks(directory, { directory: true }); }
function readJson(file, fallback) { assertNoLinks(file, { allowMissing: true }); if (!fs.existsSync(file)) return fallback; try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw fail("MANAGED_LLM_JOURNAL_INVALID", "本地模型记录损坏。"); } }
function writeJson(file, value) { assertNoLinks(file, { allowMissing: true }); const temporary = `${file}.${randomUUID()}.tmp`; try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } }
async function hashFile(file, signal) {
  abort(signal); assertNoLinks(file); const stream = fs.createReadStream(file, { signal }), hash = createHash("sha256");
  try { for await (const chunk of stream) hash.update(chunk); abort(signal); return hash.digest("hex"); }
  finally { if (!stream.closed) { const closed = once(stream, "close").catch(() => {}); stream.destroy(); await closed; } }
}
async function assertGguf(file, expectedHash, expectedBytes, signal) {
  abort(signal); assertNoLinks(file); const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size !== expectedBytes || stat.size < 32) throw fail("MANAGED_LLM_GGUF_INVALID", "GGUF 模型大小或文件类型无效。");
  const handle = await fsp.open(file, "r"), header = Buffer.alloc(24);
  try { const { bytesRead } = await handle.read(header, 0, header.length, 0); if (bytesRead !== 24 || header.toString("ascii", 0, 4) !== "GGUF" || ![2, 3].includes(header.readUInt32LE(4)) || header.readBigUInt64LE(8) < 1n || header.readBigUInt64LE(8) > 10000000n || header.readBigUInt64LE(16) > 1000000n) throw fail("MANAGED_LLM_GGUF_INVALID", "只支持具有有效 GGUF v2/v3 头的模型与视觉投影器。"); }
  finally { await handle.close(); }
  if (await hashFile(file, signal) !== expectedHash) throw fail("MANAGED_LLM_MODEL_CHANGED", "GGUF 模型 SHA-256 已改变。");
}
async function runtimeFiles(directory, signal) {
  assertNoLinks(directory, { directory: true }); const files = [];
  async function visit(root, relative = "") {
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      abort(signal); const file = path.join(root, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
      assertNoLinks(file);
      if (entry.isDirectory()) await visit(file, name);
      else if (entry.isFile()) {
        if (/\.(?:bat|cmd|ps1|psm1|vbs|sh|py|js|cjs|mjs)$/i.test(name)) throw fail("MANAGED_LLM_RUNTIME_SCRIPT_REJECTED", "固定 LLM portable 环境不能包含脚本依赖。");
        files.push({ name, bytes: fs.statSync(file).size, sha256: await hashFile(file, signal) });
      } else throw fail("MANAGED_LLM_RUNTIME_INVALID", "运行环境包含不支持的文件。");
    }
  }
  await visit(directory);
  const executable = files.find(item => item.name === "llama-server.exe");
  if (!executable || executable.bytes < 2) throw fail("MANAGED_LLM_RUNTIME_INVALID", "归档根目录必须包含固定 llama-server.exe。");
  const handle = await fsp.open(path.join(directory, "llama-server.exe"), "r"), header = Buffer.alloc(2);
  try { await handle.read(header, 0, 2, 0); if (header.toString("ascii") !== "MZ") throw fail("MANAGED_LLM_RUNTIME_INVALID", "LLM server 不是 Windows portable 程序。"); } finally { await handle.close(); }
  return files;
}
async function availablePort(port) { await new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", () => reject(fail("MANAGED_LLM_PORT_BUSY", "本地模型端口已被其他程序占用。"))); server.listen(port, "127.0.0.1", () => server.close(resolve)); }); }
function defaultHealthCheck({ port, requestModel, signal, timeoutMs = 1500 }) {
  return new Promise((resolve, reject) => {
    let settled = false, response, size = 0; const chunks = [];
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", canceled); response?.destroy(); request.destroy(); error ? reject(error) : resolve(true); };
    const canceled = () => finish(fail("MANAGED_LLM_PAUSED", "本地模型任务已暂停。"));
    const request = http.request({ hostname: "127.0.0.1", port, path: "/v1/models", method: "GET", agent: false }, incoming => {
      response = incoming;
      if (incoming.statusCode !== 200) return finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康检查失败。"));
      incoming.on("data", chunk => { size += chunk.length; if (size > 1024 * 1024) return finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康响应超过限制。")); chunks.push(chunk); });
      incoming.once("aborted", () => finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康响应断开。")));
      incoming.once("error", () => finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康响应失败。")));
      incoming.once("end", () => { try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!Array.isArray(value.data) || !value.data.some(item => item?.id === requestModel)) throw new Error(); finish(); } catch { finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型别名与冻结版本不匹配。")); } });
    });
    const timer = setTimeout(() => finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康检查超时。")), timeoutMs);
    request.once("error", () => finish(fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康连接失败。")));
    signal?.addEventListener("abort", canceled, { once: true }); if (signal?.aborted) canceled(); else request.end();
  });
}

function createManagedLocalLlmServiceInternal(options = {}) {
  if (!options.rootDir || !path.isAbsolute(options.rootDir) || options.rootDir.startsWith("\\\\")) throw fail("MANAGED_LLM_ROOT_INVALID", "托管 LLM 必须使用应用独立本机目录。");
  const root = mkdir(path.resolve(options.rootDir)), store = options.artifactStore, dialog = options.dialog;
  if (!store?.ensureArtifact) throw fail("MANAGED_LLM_STORE_REQUIRED", "必须复用 Main 受管制品存储。");
  const archive = createComfyUiArchiveService({ sevenZipPath: options.sevenZipPath }), spawn = options.spawn || nativeSpawn, healthCheck = options.healthCheck || defaultHealthCheck;
  const now = options.now || (() => new Date().toISOString()), unique = options.randomId || randomUUID;
  const journal = path.join(root, "llm-journal.json"), state = readJson(journal, { schemaVersion: 1, manifests: [], plans: [], jobs: [], runtimes: [] });
  if (state.schemaVersion !== 1 || !["manifests", "plans", "jobs", "runtimes"].every(key => Array.isArray(state[key]))) throw fail("MANAGED_LLM_JOURNAL_INVALID", "托管 LLM 记录版本无效。");
  const jobs = new Map(), processes = new Map(), starts = new Map(), installs = new Map(), bindings = new Map(); let disposed = false;
  const save = () => writeJson(journal, state);
  const assertActive = () => { if (disposed) throw fail("MANAGED_LLM_DISPOSED", "本地模型服务正在退出。"); };
  const inside = (...parts) => { const result = path.resolve(root, ...parts); if (!result.startsWith(`${root}${path.sep}`)) throw fail("MANAGED_LLM_PATH_INVALID", "托管 LLM 路径越界。"); return result; };
  const removeDirectory = directory => { const target = inside(path.relative(root, directory)); assertNoLinks(target, { directory: true, allowMissing: true }); fs.rmSync(target, { recursive: true, force: true }); };
  const bump = value => { value.updatedAt = now(); save(); };
  const getRuntime = key => { const runtime = state.runtimes.find(item => item.runtimeId === id(key) && item.state !== "removed"); if (!runtime) throw fail("MANAGED_LLM_NOT_FOUND", "托管 LLM 环境不存在。"); if (!Number.isSafeInteger(runtime.port) || runtime.port < 18388 || runtime.port >= 18488 || !Array.isArray(runtime.revisions)) throw fail("MANAGED_LLM_JOURNAL_INVALID", "托管 LLM 版本或端口记录无效。"); return runtime; };
  const getJob = key => { const job = state.jobs.find(item => item.jobId === id(key)); if (!job) throw fail("MANAGED_LLM_JOB_NOT_FOUND", "托管 LLM 安装任务不存在。"); return job; };
  const getPlan = key => { const plan = state.plans.find(item => item.planId === id(key)); if (!plan || hashManagedArtifactValue(plan.material) !== plan.planHash) throw fail("MANAGED_LLM_PLAN_INVALID", "LLM 安装计划无效。"); return plan; };
  const getManifest = key => { const record = state.manifests.find(item => item.manifestId === id(key)); if (!record) throw fail("MANAGED_LLM_MANIFEST_NOT_FOUND", "LLM 安装声明不存在。"); return record; };
  const normalize = record => { const manifest = normalizeManagedArtifactManifest(record.raw, { trustContext: record.trustContext, trustedSigningKeys: options.trustedSigningKeys, allowLoopbackForTests: options.allowLoopbackForTests === true }); if (manifest.adapter !== "llama.cpp-portable" || record.manifestHash && record.manifestHash !== manifest.manifestHash) throw fail("MANAGED_LLM_MANIFEST_CHANGED", "LLM 声明类型或内容已改变。"); return manifest; };
  const caps = manifest => ({ ...manifest.model.capabilities, contextWindowTokens: manifest.model.contextWindowTokens, maxOutputTokens: manifest.model.maxOutputTokens });
  const publicManifest = record => { const manifest = normalize(record); return { manifestId: record.manifestId, label: manifest.label, version: manifest.version, manifestHash: manifest.manifestHash, adapter: manifest.adapter, artifactCount: manifest.artifacts.length, modelOnly: false, trust: manifest.provenance.kind, reviewStatus: manifest.provenance.kind === "reviewed-registry" ? "reviewed" : manifest.provenance.kind, installable: manifest.installable, modelId: manifest.model.artifactId, capabilities: caps(manifest) }; };
  const publicRevision = revision => ({ revisionId: revision.revisionId, manifestId: revision.manifestId, manifestHash: revision.manifestHash, version: revision.version, state: revision.state, createdAt: revision.createdAt, modelId: revision.modelId, capabilities: clone(revision.capabilities) });
  const publicRuntime = runtime => { const active = runtime.revisions.find(item => item.revisionId === runtime.activeRevisionId); return { runtimeId: runtime.runtimeId, label: runtime.label, mode: "managed", state: runtime.state, ...(active ? { activeRevisionId: active.revisionId, modelId: active.modelId, capabilities: clone(active.capabilities) } : {}), revisions: runtime.revisions.map(publicRevision), createdAt: runtime.createdAt, updatedAt: runtime.updatedAt }; };
  const publicJob = job => ({ jobId: job.jobId, planId: job.planId, runtimeId: job.runtimeId, manifestId: job.manifestId, manifestHash: job.manifestHash, state: job.state, downloadedBytes: job.downloadedBytes, totalBytes: job.totalBytes, ...(job.errorCode ? { errorCode: job.errorCode } : {}), createdAt: job.createdAt, updatedAt: job.updatedAt });
  const revisionOwner = (runtime, revision) => `llm-revision:${runtime.runtimeId}:${revision.revisionId}`;
  const bound = runtime => [...bindings.values()].some(item => item.runtimeId === runtime.runtimeId);
  const busy = runtime => !!processes.get(runtime.runtimeId) || !!runtime.processRecord || starts.has(runtime.runtimeId) || bound(runtime) || !!runtime.pendingCleanup?.length || state.jobs.some(item => item.runtimeId === runtime.runtimeId && !TERMINAL.has(item.state));
  const assertMutable = runtime => { if (busy(runtime)) throw fail("MANAGED_LLM_BUSY", "本地模型仍有进程、安装或 Agent 任务，请先安全停止。"); };
  const diskFree = () => { const raw = options.diskFreeBytes ? options.diskFreeBytes(root) : fs.statfsSync(root); const value = typeof raw === "number" ? raw : Number(raw.bavail) * Number(raw.bsize); if (!Number.isSafeInteger(value) || value < 0) throw fail("MANAGED_LLM_DISK_UNKNOWN", "无法确认可用磁盘空间。"); return value; };
  const generation = manifestId => state.runtimes.filter(runtime => state.jobs.some(job => job.manifestId === manifestId && job.runtimeId === runtime.runtimeId && getPlan(job.planId).material.runtimeId === "") && (runtime.state === "removed" || state.jobs.some(job => job.runtimeId === runtime.runtimeId && job.state === "completed"))).length;
  const processAlive = options.isProcessAlive || (pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } });
  function cleanPending(runtime) {
    if (processes.has(runtime.runtimeId) || runtime.processRecord || !runtime.pendingCleanup?.length) return;
    for (const revision of runtime.pendingCleanup) if (!runtime.revisions.some(item => item.revisionId === revision.revisionId)) { removeDirectory(revision.directory); store.release(revisionOwner(runtime, revision)); }
    delete runtime.pendingCleanup;
  }
  function reconcile() {
    let changed = false;
    for (const runtime of state.runtimes) {
      if (runtime.processRecord && !processes.has(runtime.runtimeId)) {
        const record = runtime.processRecord;
        if (!Number.isSafeInteger(record.pid) || record.pid < 1 || !Array.isArray(record.artifactHashes) || record.artifactHashes.some(hash => !HASH.test(hash))) throw fail("MANAGED_LLM_JOURNAL_INVALID", "LLM 进程所有权记录无效。");
        if (processAlive(record.pid)) { runtime.state = "orphaned"; store.acquireLease(`llm-orphan:${runtime.runtimeId}`, record.artifactHashes); }
        else { store.releaseLease(`llm-orphan:${runtime.runtimeId}`); delete runtime.processRecord; runtime.state = runtime.activeRevisionId ? "stopped" : "failed"; changed = true; if (!runtime.revisions.some(item => item.revisionId === record.revisionId)) { store.release(record.referenceOwner); if (record.directory) removeDirectory(record.directory); } }
      }
      if (!runtime.processRecord && runtime.pendingCleanup?.length) { cleanPending(runtime); changed = true; }
    }
    if (changed) save();
  }
  for (const job of state.jobs) if (!["completed", "failed", "paused"].includes(job.state)) job.state = "paused";
  for (const runtime of state.runtimes) if (runtime.state === "running" && !runtime.processRecord) runtime.state = "stopped";
  reconcile();
  function addManifest(raw, trustContext) { const temporary = { raw, trustContext }, manifest = normalize(temporary); const manifestId = `llm-manifest-${manifest.manifestHash.slice(0, 32)}`; let record = state.manifests.find(item => item.manifestId === manifestId); if (!record) { record = { ...temporary, raw: clone(raw), trustContext: clone(trustContext), manifestId, manifestHash: manifest.manifestHash, createdAt: now() }; state.manifests.push(record); save(); } return record; }
  for (const entry of options.catalog || []) addManifest(entry.raw, entry.trustContext || { kind: "needs-review", id: "unreviewed" });
  save();
  function list() { reconcile(); return { ok: true, manifests: state.manifests.map(publicManifest), runtimes: state.runtimes.filter(item => item.state !== "removed").map(publicRuntime), jobs: state.jobs.map(publicJob) }; }
  async function importManifest() {
    assertActive(); if (!dialog?.showOpenDialog) throw fail("MANAGED_LLM_DIALOG_REQUIRED", "安装声明必须由用户通过原生选择器导入。");
    const picked = await dialog.showOpenDialog({ title: "明确导入本地 LLM 安装声明", properties: ["openFile"], filters: [{ name: "安装声明 JSON", extensions: ["json"] }] }); assertActive();
    if (picked.canceled || !picked.filePaths?.length) return { ok: true, canceled: true };
    const file = assertNoLinks(picked.filePaths[0]); if (fs.statSync(file).size > 1024 * 1024) throw fail("MANAGED_LLM_MANIFEST_INVALID", "安装声明不能超过 1 MiB。");
    let raw; try { raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { throw fail("MANAGED_LLM_MANIFEST_INVALID", "安装声明 JSON 无效。"); }
    return { ok: true, manifest: publicManifest(addManifest(raw, { kind: "user-import", id: `native-${unique()}` })) };
  }
  function plan(input = {}) {
    assertActive(); reconcile(); const record = getManifest(input.manifestId), manifest = normalize(record), runtime = input.runtimeId ? getRuntime(input.runtimeId) : null;
    const material = { policyVersion: 1, manifestId: record.manifestId, manifestHash: manifest.manifestHash, runtimeId: runtime?.runtimeId || "", baseRevisionId: runtime?.activeRevisionId || "", ...(runtime ? { baseActivationRevision: runtime.activationRevision || 0 } : { creationGeneration: generation(record.manifestId) }) };
    const planHash = hashManagedArtifactValue(material), planId = `llm-plan-${planHash.slice(0, 32)}`; if (!state.plans.some(item => item.planId === planId)) { state.plans.push({ planId, planHash, material, createdAt: now() }); save(); }
    const downloadBytes = manifest.artifacts.reduce((sum, item) => sum + (store.getObject(item.sha256) ? 0 : item.bytes), 0), requiredDiskBytes = Math.max(manifest.requirements.diskBytes, downloadBytes + manifest.expandedBytes * 2) + 64 * 1024 * 1024, free = diskFree();
    return { ok: true, planId, manifestId: record.manifestId, manifestHash: manifest.manifestHash, ...(runtime ? { runtimeId: runtime.runtimeId } : {}), modelOnly: false, label: manifest.label, version: manifest.version, modelId: manifest.model.artifactId, capabilities: caps(manifest), artifacts: manifest.artifacts.map(item => ({ artifactId: item.id, label: item.filename, kind: item.kind, sourceLabel: new URL(item.url).hostname, license: { id: item.license.id }, bytes: item.bytes, expandedBytes: item.expandedBytes, dependencies: [...item.dependencies] })), requirements: clone(manifest.requirements), downloadBytes, expandedBytes: manifest.expandedBytes, requiredDiskBytes, availableDiskBytes: free, canInstall: manifest.installable && manifest.requirements.os.includes(process.platform) && manifest.requirements.arch.includes(process.arch) && free >= requiredDiskBytes && (!runtime || !busy(runtime)) };
  }
  function validatePlan(prepared) {
    const manifest = normalize(getManifest(prepared.material.manifestId)), runtime = prepared.material.runtimeId ? getRuntime(prepared.material.runtimeId) : null;
    if (manifest.manifestHash !== prepared.material.manifestHash || !manifest.installable || runtime && ((runtime.activeRevisionId || "") !== prepared.material.baseRevisionId || (runtime.activationRevision || 0) !== prepared.material.baseActivationRevision) || !runtime && generation(prepared.material.manifestId) !== prepared.material.creationGeneration) throw fail("MANAGED_LLM_PLAN_CHANGED", "LLM 声明或目标版本已改变，请重新预检并许可。");
    return { manifest, runtime };
  }
  function activeRevision(runtime) { const revision = runtime.revisions.find(item => item.revisionId === runtime.activeRevisionId && item.state === "ready"); if (!revision) throw fail("MANAGED_LLM_REVISION_MISSING", "本地模型没有可用版本。"); return revision; }
  async function assertRevision(runtime, revision, signal) {
    if (revision.directory !== inside("runtimes", id(runtime.runtimeId), "revisions", id(revision.revisionId)) || !HASH.test(revision.filesHash)) throw fail("MANAGED_LLM_JOURNAL_INVALID", "LLM 版本的受管目录或文件身份无效。");
    const manifest = normalize(getManifest(revision.manifestId)), expectedModels = manifest.artifacts.filter(item => item.kind === "model").map(item => ({ artifactId: item.id, modelType: item.modelType, sha256: item.sha256, bytes: item.bytes }));
    if (revision.manifestHash !== manifest.manifestHash || revision.modelId !== manifest.model.artifactId || hashManagedArtifactValue(revision.models) !== hashManagedArtifactValue(expectedModels) || hashManagedArtifactValue(revision.capabilities) !== hashManagedArtifactValue(caps(manifest)) || revision.requestModel !== `managed-${expectedModels.find(item => item.modelType === "llm").sha256.slice(0, 24)}`) throw fail("MANAGED_LLM_JOURNAL_INVALID", "LLM 版本与已许可声明不匹配。");
    const files = await runtimeFiles(revision.directory, signal); if (hashManagedArtifactValue(files) !== revision.filesHash) throw fail("MANAGED_LLM_RUNTIME_CHANGED", "本地 LLM 运行程序或依赖已改变。");
    for (const model of revision.models) { const object = store.getObject(model.sha256); if (!object) throw fail("MANAGED_LLM_MODEL_MISSING", "本地 GGUF 模型对象不存在。"); await assertGguf(object.path, model.sha256, model.bytes, signal); }
  }
  async function stopProcess(runtime) {
    if (bound(runtime)) throw fail("MANAGED_LLM_BUSY", "Agent 仍在使用此本地模型，未停止共享进程。");
    const entry = processes.get(runtime.runtimeId); if (!entry) return true;
    if (!entry.exited) { try { entry.child.kill("SIGTERM"); } catch {} const stopped = await Promise.race([entry.closed.then(() => true), new Promise(resolve => { const timer = setTimeout(() => resolve(false), options.stopTimeoutMs || 5000); timer.unref?.(); })]); if (!stopped) return false; }
    return true;
  }
  async function launch(runtime, revision, signal) {
    assertActive(); abort(signal); if (processes.has(runtime.runtimeId) || runtime.processRecord) throw fail("MANAGED_LLM_BUSY", "本地模型已有进程或重启残留。");
    await assertRevision(runtime, revision, signal); await availablePort(runtime.port); assertActive(); abort(signal);
    if (processes.has(runtime.runtimeId) || runtime.processRecord) throw fail("MANAGED_LLM_BUSY", "本地模型已有进程。");
    const model = revision.models.find(item => item.modelType === "llm"), projector = revision.models.find(item => item.modelType === "vision-projector"), owner = `llm-process:${runtime.runtimeId}`;
    const args = ["--host", "127.0.0.1", "--port", String(runtime.port), "--model", store.getObject(model.sha256).path, "--alias", revision.requestModel, "--ctx-size", String(revision.capabilities.contextWindowTokens), "--parallel", "1", "--n-gpu-layers", "0", "--no-warmup", "--no-webui", ...(revision.capabilities.tools ? ["--jinja"] : []), ...(projector ? ["--mmproj", store.getObject(projector.sha256).path] : [])];
    store.acquireLease(owner, revision.artifactHashes); let child;
    try { child = spawn(path.join(revision.directory, "llama-server.exe"), args, { cwd: revision.directory, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: revision.directory, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", CUDA_VISIBLE_DEVICES: "" } }); }
    catch { store.releaseLease(owner); throw fail("MANAGED_LLM_START_FAILED", "本地模型进程无法启动。"); }
    let resolveClosed; const entry = { child, revisionId: revision.revisionId, healthy: false, exited: false, closed: new Promise(resolve => { resolveClosed = resolve; }) }; processes.set(runtime.runtimeId, entry);
    const closed = () => { if (entry.exited) return; entry.exited = true; if (processes.get(runtime.runtimeId) === entry) { processes.delete(runtime.runtimeId); delete runtime.processRecord; } try { store.releaseLease(owner); } catch {} if (runtime.state === "running") runtime.state = "stopped"; try { cleanPending(runtime); bump(runtime); } catch {} resolveClosed(); };
    child.once("close", closed); child.on("error", () => { entry.error = true; if (!child.pid) closed(); });
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) { try { child.kill("SIGTERM"); } catch {} closed(); throw fail("MANAGED_LLM_START_FAILED", "本地模型进程身份无效。"); }
    runtime.processRecord = { pid: child.pid, port: runtime.port, revisionId: revision.revisionId, artifactHashes: [...revision.artifactHashes], referenceOwner: revisionOwner(runtime, revision), directory: revision.directory, startedAt: now() };
    try { save(); } catch { await stopProcess(runtime); throw fail("MANAGED_LLM_PROCESS_RECORD_FAILED", "进程身份未能保存，已请求停止。"); }
    const deadline = Date.now() + (options.healthTimeoutMs || 30000);
    while (true) {
      if (signal?.aborted) { await stopProcess(runtime); abort(signal); }
      if (entry.exited || entry.error) { await stopProcess(runtime); throw fail("MANAGED_LLM_START_FAILED", "本地模型在健康检查前退出。"); }
      try { await healthCheck({ runtimeId: runtime.runtimeId, port: runtime.port, requestModel: revision.requestModel, signal, child, timeoutMs: options.healthRequestTimeoutMs || 1500 }); if (entry.exited) throw new Error(); entry.healthy = true; break; }
      catch { if (Date.now() >= deadline || entry.exited || signal?.aborted) { await stopProcess(runtime); abort(signal); throw fail("MANAGED_LLM_HEALTH_FAILED", "本地模型健康或别名检查失败，未切换版本。"); } await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now())))); }
    }
    return entry;
  }
  function allocatePort() { for (let port = 18388; port < 18488; port++) if (!state.runtimes.some(item => item.state !== "removed" && item.port === port)) return port; throw fail("MANAGED_LLM_CAPACITY", "托管本地模型数量已达上限。"); }
  async function installFiles(job, manifest, runtime, signal) {
    const staging = mkdir(inside("staging", job.jobId)), destination = inside("runtimes", runtime.runtimeId, "revisions", `llm-rev-${manifest.manifestHash.slice(0, 24)}-${digest(job.planId).slice(0, 8)}`);
    const artifact = manifest.artifacts.find(item => item.id === manifest.runtime.artifactId), object = store.getObject(artifact.sha256);
    await archive.extract(object.path, staging, artifact, { signal }); const files = await runtimeFiles(staging, signal);
    const models = manifest.artifacts.filter(item => item.kind === "model").map(item => ({ artifactId: item.id, modelType: item.modelType, sha256: item.sha256, bytes: item.bytes }));
    for (const model of models) { const source = store.getObject(model.sha256); if (!source) throw fail("MANAGED_LLM_MODEL_MISSING", "GGUF 模型对象不存在。"); await assertGguf(source.path, model.sha256, model.bytes, signal); }
    abort(signal); mkdir(path.dirname(destination)); if (fs.existsSync(destination)) removeDirectory(destination); fs.renameSync(staging, destination);
    return { revisionId: path.basename(destination), directory: destination, manifestId: job.manifestId, manifestHash: manifest.manifestHash, version: manifest.version, state: "ready", createdAt: now(), filesHash: hashManagedArtifactValue(files), models, modelId: manifest.model.artifactId, capabilities: caps(manifest), requestModel: `managed-${models.find(item => item.modelType === "llm").sha256.slice(0, 24)}`, artifactHashes: [...new Set(manifest.artifacts.map(item => item.sha256))] };
  }
  async function runJob(job, controller) {
    let revision, leased = false; const prepared = getPlan(job.planId), { manifest, runtime: previous } = validatePlan(prepared);
    if (job.authorization?.planHash !== prepared.planHash || job.authorization?.manifestHash !== manifest.manifestHash || !job.authorization?.authorizedAt) throw fail("MANAGED_LLM_AUTHORIZATION_REQUIRED", "安装必须持有绑定精确计划的原生人工许可。");
    let runtime = previous || state.runtimes.find(item => item.runtimeId === job.runtimeId);
    if (!runtime) { runtime = { runtimeId: job.runtimeId, label: manifest.label, mode: "managed", state: "stopped", port: allocatePort(), revisions: [], createdAt: now(), updatedAt: now() }; state.runtimes.push(runtime); save(); }
    const owner = `llm-install:${job.jobId}`;
    try {
      if (processes.has(runtime.runtimeId) || runtime.processRecord || starts.has(runtime.runtimeId) || bound(runtime)) throw fail("MANAGED_LLM_BUSY", "请先安全停止本地模型。");
      if (diskFree() < Math.max(manifest.requirements.diskBytes, manifest.downloadBytes + manifest.expandedBytes * 2) + 64 * 1024 * 1024) throw fail("MANAGED_LLM_DISK_SPACE", "可用磁盘空间不足。");
      store.acquireLease(owner, manifest.artifacts.map(item => item.sha256)); leased = true; job.state = "downloading"; delete job.errorCode; bump(job); const progress = new Map();
      for (const artifactId of manifest.installOrder) { const artifact = manifest.artifacts.find(item => item.id === artifactId); await store.ensureArtifact(artifact, { jobId: job.jobId, signal: controller.signal, onProgress: event => { progress.set(artifact.sha256, event.downloadedBytes); job.downloadedBytes = [...progress.values()].reduce((sum, value) => sum + value, 0); } }); progress.set(artifact.sha256, artifact.bytes); job.downloadedBytes = [...progress.values()].reduce((sum, value) => sum + value, 0); bump(job); }
      abort(controller.signal); job.state = "installing"; bump(job); revision = await installFiles(job, manifest, runtime, controller.signal); store.retain(revisionOwner(runtime, revision), revision.artifactHashes);
      job.state = "validating"; bump(job); await launch(runtime, revision, controller.signal); if (!await stopProcess(runtime)) throw fail("MANAGED_LLM_STOP_PENDING", "验证进程尚未退出，未激活新版本。"); abort(controller.signal);
      const old = { revisions: runtime.revisions, activeRevisionId: runtime.activeRevisionId, activationRevision: runtime.activationRevision, state: runtime.state, updatedAt: runtime.updatedAt };
      runtime.revisions = [...runtime.revisions.filter(item => item.revisionId !== revision.revisionId), revision]; runtime.activeRevisionId = revision.revisionId; runtime.activationRevision = (runtime.activationRevision || 0) + 1; runtime.state = "ready"; runtime.updatedAt = now(); job.state = "completed"; job.updatedAt = now();
      try { save(); } catch { Object.assign(runtime, old); if (!old.activeRevisionId) delete runtime.activeRevisionId; throw fail("MANAGED_LLM_ACTIVATION_SAVE_FAILED", "新版本激活未能保存，上一版本保留。"); }
    } catch (error) {
      if (revision && !processes.has(runtime.runtimeId) && !runtime.processRecord) { removeDirectory(revision.directory); store.release(revisionOwner(runtime, revision)); }
      else if (revision) runtime.pendingCleanup = [...(runtime.pendingCleanup || []).filter(item => item.revisionId !== revision.revisionId), revision];
      job.state = controller.signal.aborted || ["MANAGED_LLM_PAUSED", "MANAGED_ARTIFACT_PAUSED"].includes(error.code) ? "paused" : "failed"; job.errorCode = safeCode(error); if (!runtime.activeRevisionId) runtime.state = "failed"; bump(job);
    } finally { if (leased) store.releaseLease(owner); const staging = inside("staging", job.jobId); if (fs.existsSync(staging)) removeDirectory(staging); }
  }
  function schedule(job) { assertActive(); if (jobs.has(job.jobId)) return; const controller = new AbortController(), entry = { controller }; jobs.set(job.jobId, entry); entry.promise = Promise.resolve().then(() => runJob(job, controller)).catch(error => { job.state = controller.signal.aborted ? "paused" : "failed"; job.errorCode = safeCode(error); bump(job); }).finally(() => jobs.delete(job.jobId)); }
  async function installInternal(input = {}) {
    assertActive(); const prepared = getPlan(input.planId), reusable = job => job.planId === prepared.planId && job.state !== "failed" && (job.state !== "completed" || state.runtimes.some(runtime => runtime.state !== "removed" && runtime.runtimeId === job.runtimeId && runtime.activeRevisionId === `llm-rev-${job.manifestHash.slice(0, 24)}-${digest(job.planId).slice(0, 8)}`));
    const duplicate = state.jobs.find(reusable); if (duplicate) return { ok: true, job: publicJob(duplicate) };
    const { manifest, runtime } = validatePlan(prepared); if (runtime) assertMutable(runtime); const preview = plan({ manifestId: prepared.material.manifestId, ...(runtime ? { runtimeId: runtime.runtimeId } : {}) });
    if (!preview.canInstall) throw fail(preview.availableDiskBytes < preview.requiredDiskBytes ? "MANAGED_LLM_DISK_SPACE" : "MANAGED_LLM_PLAN_UNAVAILABLE", "当前系统、磁盘或版本不满足安装计划。");
    if (!dialog?.showMessageBox) throw fail("MANAGED_LLM_AUTHORIZATION_REQUIRED", "LLM 安装需要 Main 原生人工许可。");
    const consent = await dialog.showMessageBox({ type: "warning", title: "许可下载并安装本地 LLM", message: `${manifest.label} ${manifest.version}`, detail: ["将下载、校验、解压并短时启动固定 CPU llama-server 载入 GGUF 做健康检查；不会运行 shell/pip/npm，不发推理请求。", `计划：${prepared.planId}`, `声明 SHA-256：${manifest.manifestHash}`, `下载：${preview.downloadBytes} B；展开：${preview.expandedBytes} B；磁盘：${preview.requiredDiskBytes} B；可用：${preview.availableDiskBytes} B`, `系统：Windows x64 CPU；显存：0 B；上下文：${manifest.model.contextWindowTokens}；工具：${manifest.model.capabilities.tools}；视觉：${manifest.model.capabilities.vision}`, ...manifest.artifacts.flatMap(item => [`${item.filename} (${item.bytes} B → ${item.expandedBytes} B)`, `来源：${item.url}`, `许可：${item.license.id} ${item.license.url}`, `依赖：${item.dependencies.join(", ") || "无"}`, ...item.components.map(value => `组件：${value.name} ${value.version} — ${value.license.id} ${value.license.url}`)])].join("\n"), buttons: ["取消", "许可此计划"], defaultId: 0, cancelId: 0, noLink: true });
    if (consent.response !== 1) return { ok: true, canceled: true }; assertActive(); validatePlan(prepared); if (runtime) assertMutable(runtime); const raced = state.jobs.find(reusable); if (raced) return { ok: true, job: publicJob(raced) };
    const job = { jobId: `llm-job-${unique()}`, planId: prepared.planId, runtimeId: runtime?.runtimeId || `llm-runtime-${digest(prepared.planId).slice(0, 24)}`, manifestId: prepared.material.manifestId, manifestHash: manifest.manifestHash, state: "authorized", downloadedBytes: 0, totalBytes: manifest.downloadBytes, authorization: { planHash: prepared.planHash, manifestHash: manifest.manifestHash, authorizedAt: now() }, createdAt: now(), updatedAt: now() }; state.jobs.push(job); save(); schedule(job); return { ok: true, job: publicJob(job) };
  }
  function install(input = {}) { const key = id(input.planId); if (installs.has(key)) return installs.get(key); const promise = Promise.resolve().then(() => installInternal(input)).finally(() => installs.delete(key)); installs.set(key, promise); return promise; }
  async function pause(input = {}) { const job = getJob(input.jobId); if (TERMINAL.has(job.state)) return { ok: true, job: publicJob(job) }; const active = jobs.get(job.jobId); active?.controller.abort(); if (active) await active.promise; job.state = "paused"; bump(job); return { ok: true, job: publicJob(job) }; }
  function resume(input = {}) { assertActive(); reconcile(); const job = getJob(input.jobId); if (job.state === "completed" || jobs.has(job.jobId)) return { ok: true, job: publicJob(job) }; const { runtime } = validatePlan(getPlan(job.planId)), target = runtime || state.runtimes.find(item => item.runtimeId === job.runtimeId); if (target && (processes.has(target.runtimeId) || target.processRecord || starts.has(target.runtimeId) || bound(target) || state.jobs.some(item => item.runtimeId === target.runtimeId && item.jobId !== job.jobId && !TERMINAL.has(item.state)))) throw fail("MANAGED_LLM_BUSY", "请先安全停止目标模型。"); schedule(job); return { ok: true, job: publicJob(job) }; }
  async function startRuntime(input = {}) {
    assertActive(); reconcile(); const runtime = getRuntime(input.runtimeId);
    if (state.jobs.some(item => item.runtimeId === runtime.runtimeId && !TERMINAL.has(item.state)) || runtime.processRecord && !processes.has(runtime.runtimeId)) throw fail("MANAGED_LLM_BUSY", "模型仍有安装任务或重启残留进程。");
    if (processes.get(runtime.runtimeId)?.healthy) return { ok: true, runtime: publicRuntime(runtime) };
    const revision = activeRevision(runtime); if (!dialog?.showMessageBox) throw fail("MANAGED_LLM_AUTHORIZATION_REQUIRED", "启动本地模型需要原生人工许可。");
    const consent = await dialog.showMessageBox({ type: "warning", title: "启动托管本地模型", message: runtime.label, detail: `仅在 127.0.0.1 启动已校验的 CPU llama-server。\n版本：${revision.revisionId}\n声明：${revision.manifestHash}\n模型：${revision.modelId}\n不下载模型，不自动调用云端。`, buttons: ["取消", "启动此版本"], defaultId: 0, cancelId: 0, noLink: true });
    if (consent.response !== 1) return { ok: true, canceled: true }; assertActive(); if (runtime.activeRevisionId !== revision.revisionId || runtime.processRecord || bound(runtime)) throw fail("MANAGED_LLM_BUSY", "模型版本或占用状态已改变。");
    await launch(runtime, revision); const previousState = runtime.state; runtime.state = "running"; try { bump(runtime); } catch { runtime.state = previousState; await stopProcess(runtime); throw fail("MANAGED_LLM_START_SAVE_FAILED", "启动状态未能保存，已请求停止本地模型。"); } return { ok: true, runtime: publicRuntime(runtime) };
  }
  function start(input = {}) { const key = id(input.runtimeId); if (starts.has(key)) return starts.get(key); const promise = Promise.resolve().then(() => startRuntime(input)).finally(() => starts.delete(key)); starts.set(key, promise); return promise; }
  async function stop(input = {}) { reconcile(); const runtime = getRuntime(input.runtimeId); if (starts.has(runtime.runtimeId) || runtime.processRecord && !processes.has(runtime.runtimeId)) throw fail("MANAGED_LLM_STOP_PENDING", "进程正在启动或重启所有权未确认。"); if (state.jobs.some(item => item.runtimeId === runtime.runtimeId && jobs.has(item.jobId))) throw fail("MANAGED_LLM_BUSY", "请先暂停安装任务。"); if (!await stopProcess(runtime)) throw fail("MANAGED_LLM_STOP_PENDING", "本地模型尚未退出，未释放文件租约。"); runtime.state = runtime.activeRevisionId ? "stopped" : "failed"; bump(runtime); return { ok: true, runtime: publicRuntime(runtime) }; }
  function rollback(input = {}) { assertActive(); reconcile(); const runtime = getRuntime(input.runtimeId); assertMutable(runtime); const revision = runtime.revisions.find(item => item.revisionId === id(input.revisionId) && item.state === "ready"); if (!revision) throw fail("MANAGED_LLM_REVISION_MISSING", "回滚版本不存在。"); const previous = { activeRevisionId: runtime.activeRevisionId, activationRevision: runtime.activationRevision, state: runtime.state, updatedAt: runtime.updatedAt }; runtime.activeRevisionId = revision.revisionId; runtime.activationRevision = (runtime.activationRevision || 0) + 1; runtime.state = "ready"; try { bump(runtime); } catch { Object.assign(runtime, previous); throw fail("MANAGED_LLM_ACTIVATION_SAVE_FAILED", "回滚记录未能保存，原版本保留。"); } return { ok: true, runtime: publicRuntime(runtime) }; }
  function remove(input = {}) { assertActive(); reconcile(); const runtime = getRuntime(input.runtimeId); assertMutable(runtime); const previous = { state: runtime.state, updatedAt: runtime.updatedAt }; runtime.state = "removed"; try { bump(runtime); } catch (error) { Object.assign(runtime, previous); throw error; } for (const revision of runtime.revisions) { removeDirectory(revision.directory); store.release(revisionOwner(runtime, revision)); } return { ok: true, runtime: publicRuntime(runtime) }; }
  function status(input = {}) { reconcile(); return { ok: true, ...(input.runtimeId ? { runtime: publicRuntime(getRuntime(input.runtimeId)) } : {}), ...(input.jobId ? { job: publicJob(getJob(input.jobId)) } : {}) }; }
  function acquireBinding(input, context = {}) {
    assertActive(); reconcile(); const runtime = getRuntime(input.runtimeId), revision = activeRevision(runtime), entry = processes.get(runtime.runtimeId);
    if (!entry?.healthy || entry.exited || entry.revisionId !== revision.revisionId || runtime.state !== "running") throw fail("MANAGED_LLM_NOT_RUNNING", "请先明确启动并验证本地模型。");
    if (id(input.modelId) !== revision.modelId) throw fail("MANAGED_LLM_MODEL_MISMATCH", "Agent 模型与受管版本不匹配。");
    if (typeof context.taskId !== "string" || !context.taskId || context.taskId.length > 200 || /[\u0000-\u0020\u007f\\/]/.test(context.taskId)) throw fail("MANAGED_LLM_ID_INVALID", "Agent 任务身份无效。");
    const key = `llm-run:${runtime.runtimeId}:${unique()}`, snapshot = { runtimeId: runtime.runtimeId, revisionId: revision.revisionId, modelId: revision.modelId, manifestHash: revision.manifestHash, artifactHashes: revision.artifactHashes, capabilities: revision.capabilities, networkScope: "local" };
    store.acquireLease(key, revision.artifactHashes); bindings.set(key, { runtimeId: runtime.runtimeId, taskId: context.taskId }); let released = false;
    return { binding: Object.freeze({ runtimeId: runtime.runtimeId, revisionId: revision.revisionId, modelId: revision.modelId, bindingHash: hashManagedArtifactValue(snapshot), capabilities: Object.freeze(clone(revision.capabilities)), networkScope: "local" }), endpoint: Object.freeze({ baseUrl: `http://127.0.0.1:${runtime.port}`, requestModel: revision.requestModel }), release() { if (released) return; released = true; bindings.delete(key); store.releaseLease(key); } };
  }
  async function dispose() { disposed = true; for (const entry of jobs.values()) entry.controller.abort(); await Promise.allSettled([...jobs.values()].map(entry => entry.promise)); const pending = []; for (const runtime of state.runtimes) { if (bound(runtime) || runtime.processRecord && !processes.has(runtime.runtimeId)) { pending.push(runtime.runtimeId); continue; } try { if (!await stopProcess(runtime)) pending.push(runtime.runtimeId); } catch { pending.push(runtime.runtimeId); } } reconcile(); return { ok: pending.length === 0, pendingRuntimeIds: pending, activeBindings: bindings.size }; }
  // Never propagate Node filesystem/spawn errors containing private paths.
  const safeError = error => fail(safeCode(error), /^(?:MANAGED_|COMFYUI_RUNTIME_)[A-Z0-9_]+$/.test(error?.code || "") ? error.message : "本地模型操作失败，请检查托管环境状态。");
  const sync = action => (...args) => { try { return action(...args); } catch (error) { throw safeError(error); } };
  const async = action => async (...args) => { try { return await action(...args); } catch (error) { throw safeError(error); } };
  return Object.freeze({ list: sync(list), importManifest: async(importManifest), plan: sync(plan), install: async(install), pause: async(pause), resume: sync(resume), start: async(start), stop: async(stop), rollback: sync(rollback), remove: sync(remove), status: sync(status), dispose: async(dispose), acquireBinding: sync(acquireBinding) });
}

function createManagedLocalLlmService(options) {
  try { return createManagedLocalLlmServiceInternal(options); }
  catch (error) { throw fail(safeCode(error), /^(?:MANAGED_|COMFYUI_RUNTIME_)[A-Z0-9_]+$/.test(error?.code || "") ? error.message : "本地模型服务无法初始化。"); }
}

module.exports = { createManagedLocalLlmService };
