"use strict";

// Main owns installation consent, private paths, immutable plans, and processes.
// Public methods accept identities; a CLI boolean cannot grant download consent.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { createHash, randomUUID } = require("node:crypto");
const { spawn: spawnProcess } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { normalizeManagedArtifactManifest, hashManagedArtifactValue } = require("../runtime/managed-artifact-manifest.cjs");
const { createComfyUiArchiveService, assertNoLinks, safeRelative } = require("./comfyui-runtime-archive.cjs");

const VERSION = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(["completed", "failed"]);
const MODEL_DIR = { checkpoint: "checkpoints", vae: "vae", lora: "loras" };
// Publisher metadata is not an installation manifest: expanded contents,
// component licenses, GPU requirements and a redirect-free source are unaudited.
// The publisher-provided artifact digest must never become a manifestHash.
const OFFICIAL_CANDIDATES = [{
  manifestId: "candidate-comfyui-portable-nvidia-0.42.1",
  label: "官方 ComfyUI NVIDIA Portable（展开内容与许可待审核）", version: "0.42.1",
  adapter: "comfyui-portable", artifactCount: 1, modelOnly: false,
  trust: "needs-review", reviewStatus: "needs-review", installable: false,
}];
const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash("sha256").update(value).digest("hex");
const id = value => { if (typeof value !== "string" || !ID.test(value)) throw fail("COMFYUI_RUNTIME_ID_INVALID", "运行环境标识无效。"); return value; };
const clean = value => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
const errorCode = error => /^(?:COMFYUI_RUNTIME_|MANAGED_)[A-Z0-9_]+$/.test(error?.code || "") ? error.code : "COMFYUI_RUNTIME_FAILED";

function mkdir(directory) { assertNoLinks(directory, { directory: true, allowMissing: true }); fs.mkdirSync(directory, { recursive: true }); return assertNoLinks(directory, { directory: true }); }
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  assertNoLinks(file);
  if (fs.statSync(file).size > 16 * 1024 * 1024) throw fail("COMFYUI_RUNTIME_JOURNAL_INVALID", "运行环境记录超过安全上限。");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw fail("COMFYUI_RUNTIME_JOURNAL_INVALID", "运行环境记录损坏，未自动执行任何任务。"); }
}
function writeJson(file, value) {
  mkdir(path.dirname(file)); assertNoLinks(file, { allowMissing: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}
function privateFileHash(file) { assertNoLinks(file); return digest(fs.readFileSync(file)); }
function portableDirectory(directory) {
  for (const candidate of [directory, path.join(directory, "ComfyUI_windows_portable")]) {
    if (!fs.existsSync(path.join(candidate, "python_embeded", "python.exe")) || !fs.existsSync(path.join(candidate, "ComfyUI", "main.py"))) continue;
    assertNoLinks(candidate, { directory: true });
    const python = assertNoLinks(path.join(candidate, "python_embeded", "python.exe")), main = assertNoLinks(path.join(candidate, "ComfyUI", "main.py"));
    const prefix = Buffer.alloc(2), fd = fs.openSync(python, "r"); try { fs.readSync(fd, prefix, 0, 2, 0); } finally { fs.closeSync(fd); }
    if (prefix.toString("ascii") !== "MZ" || fs.statSync(main).size < 1) throw fail("COMFYUI_RUNTIME_LAYOUT_INVALID", "运行环境需要有效的 portable Python 和 ComfyUI main.py。");
    return { directory: candidate, pythonHash: privateFileHash(python), mainHash: privateFileHash(main) };
  }
  throw fail("COMFYUI_RUNTIME_LAYOUT_INVALID", "请选择包含 python_embeded/python.exe 与 ComfyUI/main.py 的 portable 运行环境。");
}
function defaultHealthCheck({ port, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false, request;
    const invalid = () => fail("COMFYUI_RUNTIME_HEALTH_FAILED", "运行环境健康检查未通过。");
    const finish = error => { if (settled) return; settled = true; signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(true); };
    const abort = () => { const error = fail("COMFYUI_RUNTIME_PAUSED", "运行环境任务已暂停。"); request?.destroy(error); finish(error); };
    if (signal?.aborted) return abort();
    request = http.get({ host: "127.0.0.1", port, path: "/system_stats", agent: false, timeout: 2000 }, response => {
      let bytes = 0; const chunks = [];
      response.on("data", chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) { const error = invalid(); finish(error); response.destroy(error); request.destroy(error); } else chunks.push(chunk); });
      response.once("error", () => finish(invalid())); response.once("aborted", () => finish(invalid()));
      response.once("close", () => { if (!response.complete) finish(invalid()); });
      response.once("end", () => { try { const data = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (response.statusCode !== 200 || !data.system || !Array.isArray(data.devices)) throw new Error(); finish(); } catch { finish(invalid()); } });
    });
    request.once("timeout", () => request.destroy(invalid()));
    request.once("error", () => finish(signal?.aborted ? fail("COMFYUI_RUNTIME_PAUSED", "运行环境任务已暂停。") : invalid()));
    request.once("close", () => { if (!settled) finish(invalid()); });
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  });
}
function availablePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(fail("COMFYUI_RUNTIME_PORT_BUSY", "受管端口已被占用，请先停止原运行环境。")));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
function mergeTree(source, target) {
  mkdir(target);
  for (const name of fs.readdirSync(source)) {
    safeRelative(name);
    const from = path.join(source, name), to = path.join(target, name), stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw fail("COMFYUI_RUNTIME_ARCHIVE_LINK", "依赖中不能包含链接。");
    if (stat.isDirectory()) mergeTree(from, to);
    else {
      if (!stat.isFile() || fs.existsSync(to)) throw fail("COMFYUI_RUNTIME_DEPENDENCY_CONFLICT", "依赖不能覆盖运行环境现有文件。");
      assertNoLinks(to, { allowMissing: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
  }
}
function assertNoUndeclaredCustomNodes(source, destination = "") {
  const visit = (directory, relative = "") => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), relativeFile = relative ? `${relative}/${name}` : name;
      const logical = [destination === "." ? "" : destination, relativeFile].filter(Boolean).join("/").replace(/\\/g, "/"), stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file, relativeFile);
      else if (/(?:^|\/)custom_nodes(?:\/|$)/i.test(logical) && !/\.example$/i.test(name) && !/^(?:readme|license|copying|notice)(?:\.(?:md|txt|rst))?$/i.test(name)) throw fail("COMFYUI_RUNTIME_NODE_UNDECLARED", "运行环境或依赖归档包含未单独声明并审核的自定义节点。");
    }
  };
  visit(source);
}

function createComfyUiRuntimeService(options = {}) {
  if (!options.rootDir || !path.isAbsolute(options.rootDir) || options.rootDir.startsWith("\\\\")) throw fail("COMFYUI_RUNTIME_ROOT_INVALID", "托管运行环境需要本机独立目录。");
  const root = mkdir(path.resolve(options.rootDir)), store = options.artifactStore, dialog = options.dialog;
  if (!store || typeof store.ensureArtifact !== "function") throw fail("COMFYUI_RUNTIME_STORE_REQUIRED", "托管制品存储尚未就绪。");
  const now = options.now || (() => new Date().toISOString()), unique = options.randomId || randomUUID;
  const spawn = options.spawn || spawnProcess, healthCheck = options.healthCheck || defaultHealthCheck;
  const archive = createComfyUiArchiveService({ sevenZipPath: options.sevenZipPath });
  const journalFile = path.join(root, "runtime-journal.json"), activeJobs = new Map(), processes = new Map(), starts = new Map();
  let disposed = false;
  const state = readJson(journalFile, { schemaVersion: VERSION, manifests: [], plans: [], jobs: [], runtimes: [] });
  if (state.schemaVersion !== VERSION || !["manifests", "plans", "jobs", "runtimes"].every(key => Array.isArray(state[key]))) throw fail("COMFYUI_RUNTIME_JOURNAL_INVALID", "运行环境记录版本无效。");
  const save = () => writeJson(journalFile, state);
  const inside = (...parts) => { const result = path.resolve(root, ...parts); if (!result.startsWith(`${root}${path.sep}`)) throw fail("COMFYUI_RUNTIME_PATH_INVALID", "运行环境路径越界。"); return result; };
  const removeDirectory = directory => { if (!path.resolve(directory).startsWith(`${root}${path.sep}`)) throw fail("COMFYUI_RUNTIME_PATH_INVALID", "不能删除托管目录以外的数据。"); assertNoLinks(directory, { directory: true, allowMissing: true }); fs.rmSync(directory, { recursive: true, force: true }); };
  const manifestRecord = manifestId => { const key = id(manifestId); if (OFFICIAL_CANDIDATES.some(item => item.manifestId === key)) throw fail("COMFYUI_RUNTIME_MANIFEST_NEEDS_REVIEW", "官方候选尚未完成展开内容、组件许可、显存与下载来源审核，不能生成安装计划。"); const value = state.manifests.find(item => item.manifestId === key); if (!value) throw fail("COMFYUI_RUNTIME_MANIFEST_NOT_FOUND", "安装声明不存在。"); return value; };
  const normalizedManifest = record => {
    const manifest = normalizeManagedArtifactManifest(record.raw, { trustContext: record.trustContext, trustedSigningKeys: options.trustedSigningKeys, allowLoopbackForTests: options.allowLoopbackForTests === true });
    if (manifest.adapter !== "comfyui-portable") throw fail("COMFYUI_RUNTIME_ADAPTER_INVALID", "ComfyUI 只能导入 ComfyUI portable 安装声明。");
    if (record.manifestHash && record.manifestHash !== manifest.manifestHash) throw fail("COMFYUI_RUNTIME_MANIFEST_CHANGED", "安装声明已改变，请重新导入并确认计划。");
    return manifest;
  };
  const runtimeRecord = runtimeId => { const value = state.runtimes.find(item => item.runtimeId === id(runtimeId)); if (!value || value.state === "removed") throw fail("COMFYUI_RUNTIME_NOT_FOUND", "运行环境不存在。"); return value; };
  const jobRecord = jobId => { const value = state.jobs.find(item => item.jobId === id(jobId)); if (!value) throw fail("COMFYUI_RUNTIME_JOB_NOT_FOUND", "安装任务不存在。"); return value; };
  const planRecord = planId => { const value = state.plans.find(item => item.planId === id(planId)); if (!value || hashManagedArtifactValue(value.material) !== value.planHash) throw fail("COMFYUI_RUNTIME_PLAN_INVALID", "安装计划不存在或已改变。"); return value; };
  const revisionOwner = (runtime, revision) => `runtime:${runtime.runtimeId}:${revision.revisionId}`;
  const publicManifest = record => { const manifest = normalizedManifest(record); return { manifestId: record.manifestId, label: manifest.label, version: manifest.version, manifestHash: manifest.manifestHash, adapter: manifest.adapter, artifactCount: manifest.artifacts.length, modelOnly: !manifest.runtime, trust: manifest.provenance.kind, reviewStatus: manifest.provenance.kind === "reviewed-registry" ? "reviewed" : manifest.provenance.kind, installable: manifest.installable }; };
  const publicRuntime = runtime => ({ runtimeId: runtime.runtimeId, label: runtime.label, mode: runtime.mode, state: runtime.state, connectionId: runtime.connectionId, ...(runtime.activeRevisionId ? { activeRevisionId: runtime.activeRevisionId } : {}), revisions: runtime.revisions.map(revision => ({ revisionId: revision.revisionId, manifestId: revision.manifestId || "", manifestHash: revision.manifestHash || "", version: revision.version || "existing", state: revision.state, createdAt: revision.createdAt })), createdAt: runtime.createdAt, updatedAt: runtime.updatedAt });
  const publicJob = job => ({ jobId: job.jobId, planId: job.planId, runtimeId: job.runtimeId, manifestId: job.manifestId, manifestHash: job.manifestHash, state: job.state, downloadedBytes: job.downloadedBytes, totalBytes: job.totalBytes, ...(job.errorCode ? { errorCode: job.errorCode } : {}), createdAt: job.createdAt, updatedAt: job.updatedAt });
  const diskFreeBytes = () => { const value = typeof options.diskFreeBytes === "function" ? options.diskFreeBytes(root) : fs.statfsSync(root); const bytes = typeof value === "number" ? value : Number(value.bavail) * Number(value.bsize); if (!Number.isFinite(bytes) || bytes < 0) throw fail("COMFYUI_RUNTIME_DISK_UNKNOWN", "无法确认托管目录可用空间。"); return bytes; };
  const runtimeBusy = runtime => !!processes.get(runtime.runtimeId) || !!runtime.processRecord || !!runtime.pendingCleanup?.length || starts.has(runtime.runtimeId) || state.jobs.some(job => job.runtimeId === runtime.runtimeId && !TERMINAL.has(job.state));
  const connectionBusy = runtime => options.isConnectionBusy?.(runtime.connectionId) === true;
  const assertMutable = runtime => { if (runtimeBusy(runtime) || connectionBusy(runtime)) throw fail("COMFYUI_RUNTIME_BUSY", "运行环境仍有进程、安装任务或图片任务，请先安全停止。"); };
  const bump = record => { record.updatedAt = now(); save(); };
  const assertActive = () => { if (disposed) throw fail("COMFYUI_RUNTIME_DISPOSED", "运行环境服务正在退出。"); };
  const creationGeneration = manifestId => {
    const runtimeIds = new Set(state.jobs.filter(job => job.manifestId === manifestId && state.plans.find(prepared => prepared.planId === job.planId)?.material.runtimeId === "").map(job => job.runtimeId));
    return state.runtimes.filter(runtime => runtimeIds.has(runtime.runtimeId) && (runtime.state === "removed" || state.jobs.some(job => job.runtimeId === runtime.runtimeId && job.state === "completed"))).length;
  };
  for (const job of state.jobs) if (!["completed", "failed", "paused"].includes(job.state)) { job.state = "paused"; job.updatedAt = now(); }
  const processAlive = options.isProcessAlive || (pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } });
  function cleanPendingRevisions(runtime) {
    if (processes.has(runtime.runtimeId) || runtime.processRecord || !runtime.pendingCleanup?.length) return false;
    for (const revision of [...runtime.pendingCleanup]) {
      if (!runtime.revisions.some(item => item.revisionId === revision.revisionId)) {
        if (revision.metadataDirectory) removeDirectory(revision.metadataDirectory);
        store.release(revisionOwner(runtime, revision));
      }
      runtime.pendingCleanup = runtime.pendingCleanup.filter(item => item.revisionId !== revision.revisionId);
    }
    delete runtime.pendingCleanup; return true;
  }
  function reconcileProcesses() {
    let changed = false;
    for (const runtime of state.runtimes) {
      if (!runtime.processRecord || processes.has(runtime.runtimeId)) continue;
      const record = runtime.processRecord;
      if (!Number.isSafeInteger(record.pid) || record.pid < 1 || !Array.isArray(record.artifactHashes) || record.artifactHashes.some(hash => !HASH.test(hash))) throw fail("COMFYUI_RUNTIME_JOURNAL_INVALID", "运行进程所有权记录无效。");
      if (processAlive(record.pid)) {
        // A PID alone cannot prove ownership after restart. Never signal it or
        // treat its HTTP response as a process launched by this service.
        runtime.state = "failed"; store.acquireLease(`orphan:${runtime.runtimeId}`, record.artifactHashes);
      } else {
        store.releaseLease(`orphan:${runtime.runtimeId}`); delete runtime.processRecord; runtime.state = runtime.activeRevisionId ? "stopped" : "failed"; changed = true;
        if (record.referenceOwner && !runtime.revisions.some(item => item.revisionId === record.revisionId)) { store.release(record.referenceOwner); if (record.metadataDirectory && path.resolve(record.metadataDirectory).startsWith(`${root}${path.sep}`) && fs.existsSync(record.metadataDirectory)) removeDirectory(record.metadataDirectory); }
      }
    }
    for (const runtime of state.runtimes) if (cleanPendingRevisions(runtime)) { changed = true; cleanUnusedModels(); }
    if (changed) save();
  }
  for (const runtime of state.runtimes) if (runtime.state === "running" && !runtime.processRecord) runtime.state = "stopped";
  reconcileProcesses();

  function addManifest(raw, trustContext) {
    const manifest = normalizeManagedArtifactManifest(raw, { trustContext, trustedSigningKeys: options.trustedSigningKeys, allowLoopbackForTests: options.allowLoopbackForTests === true });
    if (manifest.adapter !== "comfyui-portable") throw fail("COMFYUI_RUNTIME_ADAPTER_INVALID", "ComfyUI 只能导入 ComfyUI portable 安装声明。");
    const manifestId = `manifest-${manifest.manifestHash.slice(0, 32)}`;
    let record = state.manifests.find(item => item.manifestId === manifestId);
    if (!record) { record = { manifestId, manifestHash: manifest.manifestHash, raw: clone(raw), trustContext: clone(trustContext), createdAt: now() }; state.manifests.push(record); save(); }
    return record;
  }
  for (const entry of options.catalog || []) addManifest(entry.raw, entry.trustContext || { kind: "needs-review", id: "catalog-unreviewed" });
  save();

  function list() { reconcileProcesses(); return { ok: true, manifests: [...state.manifests.map(publicManifest), ...OFFICIAL_CANDIDATES.map(clone)], runtimes: state.runtimes.filter(item => item.state !== "removed").map(publicRuntime), jobs: state.jobs.map(publicJob) }; }
  async function importManifest() {
    assertActive();
    if (!dialog?.showOpenDialog) throw fail("COMFYUI_RUNTIME_DIALOG_REQUIRED", "安装声明必须通过原生文件选择导入。");
    const selection = await dialog.showOpenDialog({ title: "明确导入 ComfyUI 安装声明", properties: ["openFile"], filters: [{ name: "安装声明 JSON", extensions: ["json"] }] });
    assertActive();
    if (selection.canceled || !selection.filePaths?.length) return { ok: true, canceled: true };
    const file = assertNoLinks(selection.filePaths[0]);
    if (fs.statSync(file).size > 1024 * 1024) throw fail("COMFYUI_RUNTIME_MANIFEST_INVALID", "安装声明超过 1 MiB。");
    let raw; try { raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { throw fail("COMFYUI_RUNTIME_MANIFEST_INVALID", "请选择有效的安装声明 JSON。"); }
    const record = addManifest(raw, { kind: "user-import", id: `native-${unique()}` });
    return { ok: true, manifest: publicManifest(record) };
  }
  function plan(input = {}) {
    assertActive();
    const record = manifestRecord(input.manifestId), manifest = normalizedManifest(record);
    const runtime = input.runtimeId ? runtimeRecord(input.runtimeId) : null;
    if (!manifest.runtime && !runtime) throw fail("COMFYUI_RUNTIME_TARGET_REQUIRED", "模型安装需要选择已登记的运行环境。");
    if (manifest.runtime && runtime?.mode === "existing") throw fail("COMFYUI_RUNTIME_EXISTING_IMMUTABLE", "不能覆盖已有 Python 环境，请创建独立托管运行环境。");
    const material = { policyVersion: VERSION, manifestId: record.manifestId, manifestHash: manifest.manifestHash, runtimeId: runtime?.runtimeId || "", baseRevisionId: runtime?.activeRevisionId || "", ...(runtime ? { baseActivationRevision: runtime.activationRevision || 0 } : { creationGeneration: creationGeneration(record.manifestId) }) };
    const planHash = hashManagedArtifactValue(material), planId = `plan-${planHash.slice(0, 32)}`;
    let prepared = state.plans.find(item => item.planId === planId);
    if (!prepared) { prepared = { planId, planHash, material, createdAt: now() }; state.plans.push(prepared); save(); }
    const downloadBytes = manifest.artifacts.reduce((sum, item) => sum + (store.getObject(item.sha256) ? 0 : item.bytes), 0);
    const requiredDiskBytes = Math.max(manifest.requirements.diskBytes, downloadBytes + manifest.expandedBytes * 2) + 64 * 1024 * 1024;
    const free = diskFreeBytes(), platformSupported = manifest.requirements.os.includes(process.platform) && manifest.requirements.arch.includes(process.arch);
    return { ok: true, planId, manifestId: record.manifestId, manifestHash: manifest.manifestHash, ...(runtime ? { runtimeId: runtime.runtimeId } : {}), modelOnly: !manifest.runtime, label: manifest.label, version: manifest.version,
      artifacts: manifest.artifacts.map(item => ({ artifactId: item.id, label: item.filename, kind: item.kind, sourceLabel: new URL(item.url).hostname, license: { id: item.license.id }, bytes: item.bytes, expandedBytes: item.expandedBytes, dependencies: [...item.dependencies] })), requirements: clone(manifest.requirements), downloadBytes, expandedBytes: manifest.expandedBytes, requiredDiskBytes, availableDiskBytes: free, canInstall: manifest.installable && platformSupported && free >= requiredDiskBytes && (!runtime || !runtimeBusy(runtime) && !connectionBusy(runtime)) };
  }
  function validatePlan(prepared) {
    const manifest = normalizedManifest(manifestRecord(prepared.material.manifestId));
    if (prepared.material.manifestHash !== manifest.manifestHash || !manifest.installable) throw fail("COMFYUI_RUNTIME_PLAN_CHANGED", "安装计划已改变或尚未审核。");
    const runtime = prepared.material.runtimeId ? runtimeRecord(prepared.material.runtimeId) : null;
    if (runtime && runtime.activeRevisionId !== prepared.material.baseRevisionId) throw fail("COMFYUI_RUNTIME_PLAN_CHANGED", "目标版本已改变，请重新预检安装计划。");
    if (runtime && (runtime.activationRevision || 0) !== (prepared.material.baseActivationRevision || 0)) throw fail("COMFYUI_RUNTIME_PLAN_CHANGED", "目标版本已切换，请重新预检安装计划。");
    if (!runtime && (prepared.material.creationGeneration || 0) !== creationGeneration(prepared.material.manifestId)) throw fail("COMFYUI_RUNTIME_PLAN_CHANGED", "原安装计划已完成或环境已移除，请生成新的安装计划并重新许可。");
    return { manifest, runtime };
  }
  function allocatePort() {
    for (let port = 18188; port < 18288; port++) if (!state.runtimes.some(item => item.state !== "removed" && item.port === port)) return port;
    throw fail("COMFYUI_RUNTIME_CAPACITY", "受管运行环境数量已达上限。");
  }
  function ensureConnection(runtime) {
    const service = options.connectionService;
    if (!service) return;
    const expected = { id: runtime.connectionId, label: runtime.label, networkScope: "local", baseUrl: `http://127.0.0.1:${runtime.port}`, credentialRef: { mode: "none" } };
    const previous = service.getInternal?.(runtime.connectionId);
    if (previous && (previous.baseUrl !== expected.baseUrl || previous.networkScope !== "local" || previous.credentialRef?.mode !== "none")) throw fail("COMFYUI_RUNTIME_CONNECTION_CHANGED", "受管连接配置已改变，未启动运行环境。");
    if (!previous) service.create(expected);
  }
  function revisionFor(runtime) { const revision = runtime.revisions.find(item => item.revisionId === runtime.activeRevisionId && item.state === "ready"); if (!revision) throw fail("COMFYUI_RUNTIME_REVISION_MISSING", "运行环境没有可用版本。"); return revision; }
  function assertRevision(revision) {
    const portable = portableDirectory(revision.directory);
    if (portable.directory !== revision.directory || portable.pythonHash !== revision.pythonHash || portable.mainHash !== revision.mainHash) throw fail("COMFYUI_RUNTIME_SOURCE_CHANGED", "运行环境的 Python 或入口文件已改变。");
    if (revision.modelConfigPath && privateFileHash(revision.modelConfigPath) !== revision.modelConfigHash) throw fail("COMFYUI_RUNTIME_SOURCE_CHANGED", "托管模型配置已改变。");
    return portable;
  }
  async function stopProcess(runtime) {
    const entry = processes.get(runtime.runtimeId);
    if (!entry) return true;
    if (connectionBusy(runtime)) throw fail("COMFYUI_RUNTIME_BUSY", "ComfyUI 仍有图片任务，不能停止运行环境。");
    if (!entry.exited) {
      entry.child.kill("SIGTERM");
      const stopped = await Promise.race([entry.closed.then(() => true), new Promise(resolve => { const timer = setTimeout(() => resolve(false), options.stopTimeoutMs || 5000); timer.unref?.(); })]);
      if (!stopped) return false;
    }
    return true;
  }
  async function launch(runtime, revision, { signal } = {}) {
    assertActive();
    if (processes.has(runtime.runtimeId) || runtime.processRecord) throw fail("COMFYUI_RUNTIME_BUSY", "运行环境已有进程或需要确认的重启残留进程。");
    assertRevision(revision); await availablePort(runtime.port); ensureConnection(runtime);
    assertActive();
    if (processes.has(runtime.runtimeId) || runtime.processRecord) throw fail("COMFYUI_RUNTIME_BUSY", "运行环境已有进程。");
    const owner = `process:${runtime.runtimeId}`, hashes = revision.artifactHashes || [];
    store.acquireLease(owner, hashes);
    const args = ["-s", "ComfyUI/main.py", "--listen", "127.0.0.1", "--port", String(runtime.port), "--windows-standalone-build", ...(revision.cpu ? ["--cpu"] : []), ...(revision.modelConfigPath ? ["--extra-model-paths-config", revision.modelConfigPath] : [])];
    let child;
    try { child = spawn(path.join(revision.directory, "python_embeded", "python.exe"), args, { cwd: revision.directory, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: path.join(revision.directory, "python_embeded"), PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PIP_NO_INDEX: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } }); }
    catch { store.releaseLease(owner); throw fail("COMFYUI_RUNTIME_START_FAILED", "运行环境无法启动。"); }
    let resolveClosed;
    const entry = { child, exited: false, closed: new Promise(resolve => { resolveClosed = resolve; }) };
    processes.set(runtime.runtimeId, entry);
    const closed = () => {
      if (entry.exited) return; entry.exited = true;
      if (processes.get(runtime.runtimeId) === entry) { processes.delete(runtime.runtimeId); delete runtime.processRecord; }
      try { store.releaseLease(owner); } catch { entry.cleanupErrorCode = "COMFYUI_RUNTIME_LEASE_RELEASE_PENDING"; }
      if (runtime.state === "running") runtime.state = "stopped";
      try { if (cleanPendingRevisions(runtime)) cleanUnusedModels(); } catch { entry.cleanupErrorCode = "COMFYUI_RUNTIME_REVISION_CLEANUP_PENDING"; }
      try { bump(runtime); } catch { entry.cleanupErrorCode = "COMFYUI_RUNTIME_PROCESS_SAVE_PENDING"; }
      resolveClosed();
    };
    child.on("error", () => { if (!child.pid) closed(); else entry.processErrorCode = "COMFYUI_RUNTIME_PROCESS_ERROR"; }); child.once("exit", closed); child.once("close", closed);
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) { processes.delete(runtime.runtimeId); store.releaseLease(owner); try { child.kill("SIGTERM"); } catch {} throw fail("COMFYUI_RUNTIME_START_FAILED", "无法记录运行进程身份。"); }
    runtime.processRecord = { pid: child.pid, port: runtime.port, revisionId: revision.revisionId, artifactHashes: [...hashes], startedAt: now(), referenceOwner: revisionOwner(runtime, revision), ...(revision.metadataDirectory ? { metadataDirectory: revision.metadataDirectory } : {}) };
    try { save(); } catch { await stopProcess(runtime); throw fail("COMFYUI_RUNTIME_PROCESS_RECORD_FAILED", "运行进程身份未能保存，已请求停止该进程。"); }
    const deadline = Date.now() + (options.healthTimeoutMs || 30000);
    while (true) {
      if (signal?.aborted) { await stopProcess(runtime); throw fail("COMFYUI_RUNTIME_PAUSED", "运行环境任务已暂停。"); }
      if (entry.exited) throw fail("COMFYUI_RUNTIME_START_FAILED", "运行环境在健康检查前退出。");
      try { await healthCheck({ runtimeId: runtime.runtimeId, port: runtime.port, signal, child }); if (entry.exited) throw new Error(); break; }
      catch { if (Date.now() >= deadline || entry.exited) { await stopProcess(runtime); throw fail("COMFYUI_RUNTIME_HEALTH_FAILED", "运行环境健康检查失败，上一版本仍保留。"); } await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now())))); }
    }
    return entry;
  }
  function modelsFor(base, manifest) {
    const models = new Map((base?.models || []).map(item => [`${item.modelType}:${item.filename.toLowerCase()}`, item]));
    for (const artifact of manifest.artifacts.filter(item => item.kind === "model")) models.set(`${artifact.modelType}:${artifact.filename.toLowerCase()}`, { modelType: artifact.modelType, filename: artifact.filename, sha256: artifact.sha256, bytes: artifact.bytes });
    return [...models.values()];
  }
  function cleanUnusedModels() {
    const referenced = new Set(state.runtimes.filter(runtime => runtime.state !== "removed").flatMap(runtime => runtime.revisions.flatMap(revision => (revision.models || []).map(model => model.sha256))));
    for (const runtime of state.runtimes) for (const hash of runtime.processRecord?.artifactHashes || []) referenced.add(hash);
    for (const job of state.jobs.filter(item => !TERMINAL.has(item.state))) {
      for (const artifact of normalizedManifest(manifestRecord(job.manifestId)).artifacts) if (artifact.kind === "model") referenced.add(artifact.sha256);
    }
    for (const destination of Object.values(MODEL_DIR)) {
      const directory = inside("models", destination);
      if (!fs.existsSync(directory)) continue;
      assertNoLinks(directory, { directory: true });
      for (const hash of fs.readdirSync(directory)) if (HASH.test(hash) && !referenced.has(hash)) removeDirectory(path.join(directory, hash));
    }
  }
  async function installFiles(job, manifest, runtime, signal) {
    const staging = inside("staging", job.jobId), revisionId = `rev-${manifest.manifestHash.slice(0, 24)}-${digest(job.planId).slice(0, 8)}`;
    if (fs.existsSync(staging)) removeDirectory(staging); mkdir(staging);
    const base = runtime.activeRevisionId ? revisionFor(runtime) : null;
    let portable;
    if (manifest.runtime) {
      const artifact = manifest.artifacts.find(item => item.id === manifest.runtime.artifactId), directory = mkdir(path.join(staging, "portable"));
      await archive.extract(store.getObject(artifact.sha256).path, directory, artifact, { signal }); portable = portableDirectory(directory);
      assertNoUndeclaredCustomNodes(portable.directory);
      for (const artifactId of manifest.installOrder) {
        const dependency = manifest.artifacts.find(item => item.id === artifactId);
        if (!["dependency", "custom-node"].includes(dependency.kind)) continue;
        if (dependency.format === "file") throw fail("COMFYUI_RUNTIME_DEPENDENCY_UNSUPPORTED", "依赖只能使用审核归档，不能执行安装程序。");
        if (dependency.kind === "custom-node" && !/^ComfyUI\/custom_nodes\/[^/]+$/.test(dependency.destination)) throw fail("COMFYUI_RUNTIME_NODE_DESTINATION", "自定义节点只能安装到独立的 custom_nodes 子目录。");
        const unpacked = mkdir(path.join(staging, `dependency-${dependency.id}`));
        await archive.extract(store.getObject(dependency.sha256).path, unpacked, dependency, { signal });
        if (dependency.kind !== "custom-node") assertNoUndeclaredCustomNodes(unpacked, dependency.destination);
        mergeTree(unpacked, path.join(portable.directory, ...safeRelative(dependency.destination).split("/"))); removeDirectory(unpacked);
      }
    } else {
      if (!base || manifest.artifacts.some(item => !["model"].includes(item.kind))) throw fail("COMFYUI_RUNTIME_MODEL_ONLY_INVALID", "现有运行环境只接受独立模型安装，不覆盖依赖。");
      portable = assertRevision(base);
    }
    const models = modelsFor(base, manifest), modelPaths = {};
    for (const model of models) {
      if (signal.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "运行环境任务已暂停。");
      const object = store.getObject(model.sha256);
      if (!object) throw fail("COMFYUI_RUNTIME_MODEL_MISSING", "托管模型对象不可用。");
      const modelDir = mkdir(inside("models", MODEL_DIR[model.modelType], model.sha256)), file = path.join(modelDir, model.filename);
      if (!fs.existsSync(file)) await copyManagedModel(object.path, file, model.sha256, signal);
      else if (await hashLargeFile(file, signal) !== model.sha256) throw fail("COMFYUI_RUNTIME_MODEL_CHANGED", "托管模型校验失败。");
      const group = `${model.modelType}_${model.sha256.slice(0, 16)}`;
      modelPaths[group] = { base_path: modelDir, [MODEL_DIR[model.modelType]]: "." };
    }
    const configPath = path.join(staging, "extra-model-paths.json"); writeJson(configPath, modelPaths);
    const destination = inside("runtimes", runtime.runtimeId, "revisions", revisionId);
    mkdir(path.dirname(destination));
    if (fs.existsSync(destination)) removeDirectory(destination);
    fs.renameSync(staging, destination);
    const directory = manifest.runtime ? path.join(destination, path.relative(staging, portable.directory)) : portable.directory;
    const artifactHashes = [...new Set([...(base?.artifactHashes || []), ...manifest.artifacts.map(item => item.sha256)])];
    return { revisionId, manifestId: job.manifestId, manifestHash: manifest.manifestHash, version: manifest.version, state: "ready", createdAt: now(), directory, metadataDirectory: destination, pythonHash: portable.pythonHash, mainHash: portable.mainHash, cpu: manifest.runtime ? manifest.runtime.cpu : base.cpu, models, artifactHashes, modelConfigPath: path.join(destination, "extra-model-paths.json"), modelConfigHash: privateFileHash(path.join(destination, "extra-model-paths.json")) };
  }
  async function runJob(job, controller) {
    let lease = false, revision;
    const prepared = planRecord(job.planId), { manifest, runtime: existing } = validatePlan(prepared);
    if (job.authorization?.planHash !== prepared.planHash || job.authorization?.manifestHash !== manifest.manifestHash || !job.authorization?.authorizedAt) throw fail("COMFYUI_RUNTIME_AUTHORIZATION_REQUIRED", "安装需要绑定当前计划的原生人工许可。");
    let runtime = existing || state.runtimes.find(item => item.runtimeId === job.runtimeId);
    if (!runtime) { const port = allocatePort(); runtime = { runtimeId: job.runtimeId, label: manifest.label, mode: "managed", state: "stopped", connectionId: `connection-${job.runtimeId}`, port, revisions: [], createdAt: now(), updatedAt: now() }; state.runtimes.push(runtime); save(); }
    const owner = `install:${job.jobId}`;
    try {
      if (processes.has(runtime.runtimeId) || runtime.processRecord || starts.has(runtime.runtimeId) || connectionBusy(runtime)) throw fail("COMFYUI_RUNTIME_BUSY", "请先安全停止目标运行环境。");
      const required = Math.max(manifest.requirements.diskBytes, manifest.downloadBytes + manifest.expandedBytes * 2) + 64 * 1024 * 1024;
      if (diskFreeBytes() < required) throw fail("COMFYUI_RUNTIME_DISK_SPACE", "磁盘空间不足，未开始安装。");
      store.acquireLease(owner, manifest.artifacts.map(item => item.sha256)); lease = true;
      job.state = "downloading"; delete job.errorCode; bump(job);
      const progress = new Map();
      for (const artifactId of manifest.installOrder) {
        const artifact = manifest.artifacts.find(item => item.id === artifactId);
        await store.ensureArtifact(artifact, { jobId: job.jobId, signal: controller.signal, onProgress: event => { progress.set(artifact.sha256, event.downloadedBytes); job.downloadedBytes = [...progress.values()].reduce((sum, value) => sum + value, 0); job.updatedAt = now(); } });
        progress.set(artifact.sha256, artifact.bytes); job.downloadedBytes = [...progress.values()].reduce((sum, value) => sum + value, 0); bump(job);
      }
      if (controller.signal.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "安装任务已暂停。");
      job.state = "installing"; bump(job);
      revision = await installFiles(job, manifest, runtime, controller.signal);
      store.retain(revisionOwner(runtime, revision), revision.artifactHashes);
      job.state = "validating"; bump(job);
      await launch(runtime, revision, { signal: controller.signal });
      if (!await stopProcess(runtime)) throw fail("COMFYUI_RUNTIME_STOP_PENDING", "验证进程尚未退出，未激活新版本。");
      if (controller.signal.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "安装任务已暂停。");
      ensureConnection(runtime);
      const previous = { revisions: runtime.revisions, activeRevisionId: runtime.activeRevisionId, state: runtime.state, updatedAt: runtime.updatedAt, activationRevision: runtime.activationRevision };
      runtime.revisions = [...runtime.revisions.filter(item => item.revisionId !== revision.revisionId), revision];
      runtime.activeRevisionId = revision.revisionId; runtime.state = "ready"; runtime.updatedAt = now(); runtime.activationRevision = (runtime.activationRevision || 0) + 1;
      job.state = "completed"; job.updatedAt = now();
      try { save(); }
      catch {
        runtime.revisions = previous.revisions; runtime.state = previous.state; runtime.updatedAt = previous.updatedAt;
        if (previous.activeRevisionId) runtime.activeRevisionId = previous.activeRevisionId; else delete runtime.activeRevisionId;
        if (previous.activationRevision !== undefined) runtime.activationRevision = previous.activationRevision; else delete runtime.activationRevision;
        throw fail("COMFYUI_RUNTIME_ACTIVATION_SAVE_FAILED", "新版本激活记录未能保存，上一版本仍保留。");
      }
    } catch (error) {
      if (revision && !processes.has(runtime.runtimeId) && !runtime.processRecord) { if (revision.metadataDirectory) removeDirectory(revision.metadataDirectory); store.release(revisionOwner(runtime, revision)); }
      else if (revision) runtime.pendingCleanup = [...(runtime.pendingCleanup || []).filter(item => item.revisionId !== revision.revisionId), { revisionId: revision.revisionId, metadataDirectory: revision.metadataDirectory }];
      job.state = controller.signal.aborted || ["MANAGED_ARTIFACT_PAUSED", "COMFYUI_RUNTIME_PAUSED"].includes(error.code) ? "paused" : "failed";
      job.errorCode = errorCode(error); job.updatedAt = now();
      if (!runtime.activeRevisionId) runtime.state = "failed";
      save(); cleanUnusedModels();
    } finally { if (lease) store.releaseLease(owner); if (fs.existsSync(inside("staging", job.jobId))) removeDirectory(inside("staging", job.jobId)); }
  }
  function schedule(job) {
    if (disposed) throw fail("COMFYUI_RUNTIME_DISPOSED", "运行环境服务正在退出。");
    if (activeJobs.has(job.jobId)) return;
    const controller = new AbortController(), entry = { controller };
    activeJobs.set(job.jobId, entry);
    entry.promise = Promise.resolve().then(() => runJob(job, controller)).catch(error => { job.state = "failed"; job.errorCode = errorCode(error); bump(job); }).finally(() => activeJobs.delete(job.jobId));
  }
  async function install(input = {}) {
    assertActive();
    const prepared = planRecord(input.planId);
    const reusableJob = job => job.planId === prepared.planId && job.state !== "failed" && (job.state !== "completed" || state.runtimes.some(runtime => runtime.runtimeId === job.runtimeId && runtime.state !== "removed" && runtime.activeRevisionId === `rev-${job.manifestHash.slice(0, 24)}-${digest(job.planId).slice(0, 8)}` && runtime.revisions.some(revision => revision.revisionId === runtime.activeRevisionId && revision.state === "ready")));
    const duplicate = state.jobs.find(reusableJob);
    if (duplicate) return { ok: true, job: publicJob(duplicate) };
    const { manifest, runtime } = validatePlan(prepared);
    if (runtime) assertMutable(runtime);
    const preview = plan({ manifestId: prepared.material.manifestId, ...(runtime ? { runtimeId: runtime.runtimeId } : {}) });
    if (!preview.canInstall) throw fail(preview.availableDiskBytes < preview.requiredDiskBytes ? "COMFYUI_RUNTIME_DISK_SPACE" : "COMFYUI_RUNTIME_PLAN_UNAVAILABLE", "当前环境不满足安装计划，请核对系统与可用空间。");
    if (!dialog?.showMessageBox) throw fail("COMFYUI_RUNTIME_AUTHORIZATION_REQUIRED", "安装必须通过 Main 原生对话框人工许可。");
    const answer = await dialog.showMessageBox({ type: "warning", title: "许可下载并安装 ComfyUI 运行环境", message: `${manifest.label} ${manifest.version}`, detail: ["此操作将下载、校验、解压并短时启动明确声明的 Python/ComfyUI 代码进行健康检查；不会运行 pip/npm/bat 或生成模型图片。", `计划：${prepared.planId}`, `声明 SHA-256：${manifest.manifestHash}`, `下载：${preview.downloadBytes} B；展开：${preview.expandedBytes} B；所需磁盘：${preview.requiredDiskBytes} B；可用：${preview.availableDiskBytes} B`, `系统：${manifest.requirements.os.join(", ")} / ${manifest.requirements.arch.join(", ")}；GPU：${manifest.requirements.gpu.join(", ")}；显存：${manifest.requirements.vramBytes} B`, ...manifest.artifacts.flatMap(item => [`${item.filename} (${item.bytes} B → ${item.expandedBytes} B)`, `来源：${item.url}`, `许可：${item.license.id} ${item.license.url}`, `依赖：${item.dependencies.join(", ") || "无"}`, ...item.components.map(component => `组件：${component.name} ${component.version} — ${component.license.id} ${component.license.url}`)])].join("\n"), buttons: ["取消", "许可此计划"], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return { ok: true, canceled: true };
    assertActive();
    validatePlan(prepared); if (runtime) assertMutable(runtime);
    const raced = state.jobs.find(reusableJob); if (raced) return { ok: true, job: publicJob(raced) };
    const job = { jobId: `job-${unique()}`, planId: prepared.planId, runtimeId: runtime?.runtimeId || `runtime-${digest(prepared.planId).slice(0, 24)}`, manifestId: prepared.material.manifestId, manifestHash: manifest.manifestHash, state: "authorized", downloadedBytes: 0, totalBytes: manifest.downloadBytes, authorization: { planHash: prepared.planHash, manifestHash: manifest.manifestHash, authorizedAt: now() }, createdAt: now(), updatedAt: now() };
    state.jobs.push(job); save(); schedule(job); return { ok: true, job: publicJob(job) };
  }
  async function pause(input = {}) { const job = jobRecord(input.jobId); if (TERMINAL.has(job.state)) return { ok: true, job: publicJob(job) }; activeJobs.get(job.jobId)?.controller.abort(); const entry = activeJobs.get(job.jobId); if (entry) await entry.promise; job.state = "paused"; bump(job); return { ok: true, job: publicJob(job) }; }
  function resume(input = {}) { assertActive(); reconcileProcesses(); const job = jobRecord(input.jobId); if (job.state === "completed" || activeJobs.has(job.jobId)) return { ok: true, job: publicJob(job) }; const { runtime } = validatePlan(planRecord(job.planId)); const target = runtime || state.runtimes.find(item => item.runtimeId === job.runtimeId); if (target && (processes.has(target.runtimeId) || target.processRecord || starts.has(target.runtimeId) || connectionBusy(target) || state.jobs.some(item => item.jobId !== job.jobId && item.runtimeId === target.runtimeId && !TERMINAL.has(item.state)))) throw fail("COMFYUI_RUNTIME_BUSY", "请先安全停止目标运行环境。"); schedule(job); return { ok: true, job: publicJob(job) }; }
  async function registerExisting() {
    assertActive();
    if (!dialog?.showOpenDialog) throw fail("COMFYUI_RUNTIME_DIALOG_REQUIRED", "已有运行环境必须由原生目录选择授权。");
    const selection = await dialog.showOpenDialog({ title: "登记已有 ComfyUI portable 环境（不会修改 Python）", properties: ["openDirectory"] });
    assertActive();
    if (selection.canceled || !selection.filePaths?.length) return { ok: true, canceled: true };
    const portable = portableDirectory(selection.filePaths[0]);
    const duplicate = state.runtimes.find(item => item.mode === "existing" && item.state !== "removed" && item.revisions.some(revision => revision.directory.toLowerCase() === portable.directory.toLowerCase()));
    if (duplicate) return { ok: true, runtime: publicRuntime(duplicate) };
    const runtimeId = `runtime-${unique()}`, revision = { revisionId: `existing-${digest(portable.directory).slice(0, 24)}`, state: "ready", createdAt: now(), ...portable, cpu: false, artifactHashes: [], models: [] };
    const runtime = { runtimeId, label: `已有 ComfyUI ${state.runtimes.length + 1}`, mode: "existing", state: "stopped", port: allocatePort(), connectionId: `connection-${runtimeId}`, activeRevisionId: revision.revisionId, revisions: [revision], createdAt: now(), updatedAt: now() };
    ensureConnection(runtime); state.runtimes.push(runtime); save(); return { ok: true, runtime: publicRuntime(runtime) };
  }
  async function startRuntime(input = {}) {
    assertActive();
    reconcileProcesses();
    const runtime = runtimeRecord(input.runtimeId); if (processes.has(runtime.runtimeId)) return { ok: true, runtime: publicRuntime(runtime) };
    if (runtime.processRecord) throw fail("COMFYUI_RUNTIME_PROCESS_PENDING", "上次运行的进程仍存在；请先关闭原 ComfyUI，不能根据旧 PID 自动终止或接管。");
    if (state.jobs.some(job => job.runtimeId === runtime.runtimeId && !TERMINAL.has(job.state))) throw fail("COMFYUI_RUNTIME_BUSY", "运行环境安装任务尚未结束。");
    const revision = revisionFor(runtime); assertRevision(revision);
    if (!dialog?.showMessageBox) throw fail("COMFYUI_RUNTIME_AUTHORIZATION_REQUIRED", "启动需要原生人工确认。");
    const answer = await dialog.showMessageBox({ type: "warning", title: "启动本机 ComfyUI", message: runtime.label, detail: "将运行已登记的 Python 与 ComfyUI main.py，固定仅监听 127.0.0.1。此操作不会下载依赖或发送模型生成请求；已有环境中的代码会在当前用户权限下运行。", buttons: ["取消", "启动"], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return { ok: true, canceled: true };
    assertActive();
    if (processes.has(runtime.runtimeId)) return { ok: true, runtime: publicRuntime(runtime) };
    await launch(runtime, revision); runtime.state = "running"; bump(runtime); return { ok: true, runtime: publicRuntime(runtime) };
  }
  function start(input = {}) {
    assertActive();
    const runtimeId = id(input.runtimeId);
    if (starts.has(runtimeId)) return starts.get(runtimeId);
    const promise = Promise.resolve().then(() => startRuntime(input)).finally(() => starts.delete(runtimeId)); starts.set(runtimeId, promise); return promise;
  }
  async function stop(input = {}) { reconcileProcesses(); const runtime = runtimeRecord(input.runtimeId); if (runtime.processRecord && !processes.has(runtime.runtimeId) || starts.has(runtime.runtimeId) && !processes.has(runtime.runtimeId)) throw fail("COMFYUI_RUNTIME_STOP_PENDING", "运行环境启动或重启残留进程尚未安全退出。"); if (!await stopProcess(runtime)) throw fail("COMFYUI_RUNTIME_STOP_PENDING", "运行环境尚未退出，未强制终止。"); runtime.state = runtime.activeRevisionId ? "stopped" : "failed"; bump(runtime); return { ok: true, runtime: publicRuntime(runtime) }; }
  function rollback(input = {}) {
    const runtime = runtimeRecord(input.runtimeId); assertMutable(runtime);
    const candidates = runtime.revisions.filter(item => item.state === "ready" && item.revisionId !== runtime.activeRevisionId);
    const revision = input.revisionId ? candidates.find(item => item.revisionId === id(input.revisionId)) : candidates[candidates.length - 1];
    if (!revision) throw fail("COMFYUI_RUNTIME_ROLLBACK_UNAVAILABLE", "没有可回滚的已验证版本。");
    assertRevision(revision); const previous = { activeRevisionId: runtime.activeRevisionId, state: runtime.state, updatedAt: runtime.updatedAt, activationRevision: runtime.activationRevision };
    runtime.activeRevisionId = revision.revisionId; runtime.state = "ready"; runtime.activationRevision = (runtime.activationRevision || 0) + 1;
    try { bump(runtime); } catch { Object.assign(runtime, previous); throw fail("COMFYUI_RUNTIME_ACTIVATION_SAVE_FAILED", "版本切换未能保存，原版本仍保留。"); }
    return { ok: true, runtime: publicRuntime(runtime) };
  }
  function remove(input = {}) {
    const runtime = runtimeRecord(input.runtimeId); assertMutable(runtime);
    if (runtime.mode === "managed") { const directory = inside("runtimes", runtime.runtimeId); if (fs.existsSync(directory)) removeDirectory(directory); }
    else { const directory = inside("runtimes", runtime.runtimeId); if (fs.existsSync(directory)) removeDirectory(directory); }
    for (const revision of runtime.revisions) store.release(revisionOwner(runtime, revision));
    options.connectionService?.remove(runtime.connectionId); runtime.state = "removed"; bump(runtime); cleanUnusedModels(); return { ok: true, runtime: publicRuntime(runtime) };
  }
  function status(input = {}) { reconcileProcesses(); return { ok: true, ...(input.runtimeId ? { runtime: publicRuntime(runtimeRecord(input.runtimeId)) } : {}), ...(input.jobId ? { job: publicJob(jobRecord(input.jobId)) } : {}) }; }
  // Main-only admission guard. A local alias must share the same installation
  // boundary; changing a profile ID cannot expose a validation process to tasks.
  function assertConnectionAvailable(connection) {
    const connectionId = typeof connection === "string" ? connection : connection?.id || connection?.connectionId;
    let localPort;
    if (connection?.networkScope === "local" && typeof connection.baseUrl === "string") {
      try { const url = new URL(connection.baseUrl), host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); if (host === "localhost" || host === "localhost." || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host) || host === "::ffff:7f00:1") localPort = Number(url.port || (url.protocol === "https:" ? 443 : 80)); } catch {}
    }
    const runtime = state.runtimes.find(item => item.state !== "removed" && (item.connectionId === connectionId || localPort === item.port));
    if (!runtime) return true;
    if (starts.has(runtime.runtimeId) || state.jobs.some(job => job.runtimeId === runtime.runtimeId && !TERMINAL.has(job.state)) || runtime.processRecord && (!processes.has(runtime.runtimeId) || runtime.processRecord.revisionId !== runtime.activeRevisionId)) throw fail("COMFYUI_RUNTIME_BUSY", "运行环境正在安装、验证或恢复进程所有权，暂不能执行图片任务。");
    return true;
  }
  async function dispose() {
    disposed = true;
    for (const entry of activeJobs.values()) entry.controller.abort();
    await Promise.allSettled([...activeJobs.values()].map(entry => entry.promise));
    const pendingRuntimeIds = [];
    for (const runtime of state.runtimes.filter(item => processes.has(item.runtimeId))) {
      if (connectionBusy(runtime) || !await stopProcess(runtime)) pendingRuntimeIds.push(runtime.runtimeId);
    }
    reconcileProcesses();
    for (const runtime of state.runtimes) if (runtime.processRecord && !processes.has(runtime.runtimeId) && !pendingRuntimeIds.includes(runtime.runtimeId)) pendingRuntimeIds.push(runtime.runtimeId);
    save(); return { ok: pendingRuntimeIds.length === 0, pendingRuntimeIds };
  }
  return Object.freeze({ list, importManifest, plan, install, pause, resume, registerExisting, remove, rollback, start, stop, status, dispose, assertConnectionAvailable });
}

async function hashLargeFile(file, signal) {
  if (signal?.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "托管模型校验已暂停。");
  assertNoLinks(file); const hash = createHash("sha256"), input = fs.createReadStream(file, { signal });
  const closed = new Promise(resolve => input.once("close", resolve));
  try {
    for await (const chunk of input) hash.update(chunk);
    if (signal?.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "托管模型校验已暂停。");
    return hash.digest("hex");
  } catch (error) { if (signal?.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "托管模型校验已暂停。"); throw error; }
  finally { input.destroy(); await closed; }
}

async function copyManagedModel(source, destination, expectedHash, signal) {
  if (signal?.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "托管模型复制已暂停。");
  assertNoLinks(source); assertNoLinks(destination, { allowMissing: true });
  const temporary = path.join(path.dirname(destination), `.copy-${randomUUID()}.tmp`);
  const input = fs.createReadStream(source, { signal }), output = fs.createWriteStream(temporary, { flags: "wx", mode: 0o600, signal });
  const closed = [new Promise(resolve => input.once("close", resolve)), new Promise(resolve => output.once("close", resolve))];
  try {
    await pipeline(input, output, { signal });
    if (await hashLargeFile(temporary, signal) !== expectedHash) throw fail("COMFYUI_RUNTIME_MODEL_CHANGED", "托管模型副本校验失败。");
    if (signal?.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "托管模型复制已暂停。");
    // The two synchronous operations cannot interleave with another job in this
    // Main. Concurrent copies may reuse a fully verified copy, never overwrite it.
    if (fs.existsSync(destination)) {
      if (await hashLargeFile(destination, signal) !== expectedHash) throw fail("COMFYUI_RUNTIME_MODEL_CHANGED", "托管模型副本发生并发冲突。");
    } else { assertNoLinks(destination, { allowMissing: true }); fs.renameSync(temporary, destination); }
  } catch (error) { if (signal?.aborted) throw fail("COMFYUI_RUNTIME_PAUSED", "托管模型复制已暂停。"); throw error; }
  finally { input.destroy(); output.destroy(); await Promise.all(closed); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

module.exports = { createComfyUiRuntimeService };
