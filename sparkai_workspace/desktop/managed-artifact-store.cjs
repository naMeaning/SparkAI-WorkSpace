"use strict";

// Main-only, content-addressed storage. Objects never live in a project and
// callers never choose a write path, request header, redirect or executable.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { createHash, randomBytes } = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { normalizeManagedArtifactDescriptor, hashManagedArtifactValue } = require("../runtime/managed-artifact-manifest.cjs");
const { isLoopbackHost, resolveComfyUiConnectionNetwork } = require("./comfyui-connection-service.cjs");

const HASH = /^[a-f0-9]{64}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ROOT_STATES = new Map();
const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = value => JSON.parse(JSON.stringify(value));
const keyPath = value => process.platform === "win32" ? value.toLowerCase() : value;
const addressKey = value => String(value || "").replace(/^::ffff:/i, "").toLowerCase();
const now = () => new Date().toISOString();
const hashId = value => { if (typeof value !== "string" || !HASH.test(value)) throw fail("MANAGED_ARTIFACT_HASH_INVALID", "制品对象身份无效。"); return value; };
const ownerId = value => { if (typeof value !== "string" || !OWNER.test(value)) throw fail("MANAGED_ARTIFACT_OWNER_INVALID", "制品引用身份无效。"); return value; };

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

function assertNoLinks(target, { allowMissing = true } = {}) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === "ENOENT" && allowMissing) return absolute;
      throw fail("MANAGED_ARTIFACT_PATH_UNSAFE", "托管目录不可安全读取。");
    }
    if (stat.isSymbolicLink() || keyPath(fs.realpathSync.native(current)) !== keyPath(current)) throw fail("MANAGED_ARTIFACT_PATH_UNSAFE", "托管目录不能包含软链接或 junction。");
  }
  return absolute;
}
function fileSize(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw fail("MANAGED_ARTIFACT_PATH_UNSAFE", "制品文件不能使用链接或特殊文件。");
    return stat.size;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function hashFile(file, signal) {
  if (signal?.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品校验已暂停。");
  const digest = createHash("sha256");
  const input = fs.createReadStream(file, { signal }), closed = new Promise(resolve => input.once("close", resolve));
  try {
    for await (const chunk of input) digest.update(chunk);
    if (signal?.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品校验已暂停。");
    return digest.digest("hex");
  } catch (error) { throw downloadError(error, signal); }
  finally { input.destroy(); await closed; }
}
function downloadError(error, signal) {
  if (signal?.aborted) return fail("MANAGED_ARTIFACT_PAUSED", "制品下载已暂停，可沿原授权恢复。");
  if (String(error?.code || "").startsWith("MANAGED_")) return error;
  if (["ENOSPC", "EDQUOT"].includes(error?.code)) return fail("MANAGED_ARTIFACT_DISK_FULL", "托管目录剩余磁盘空间不足。");
  if (["EACCES", "EPERM", "EIO"].includes(error?.code)) return fail("MANAGED_ARTIFACT_IO_FAILED", "托管制品文件读写失败。");
  if (/CERT|TLS|SSL|SELF_SIGNED|EPROTO/.test(error?.code || "")) return fail("MANAGED_ARTIFACT_TLS_FAILED", "制品下载 TLS 校验失败。");
  return fail("MANAGED_ARTIFACT_CONNECTION_FAILED", "制品下载连接中断。");
}

function safeStoreError(error) {
  if (String(error?.code || "").startsWith("MANAGED_")) return error;
  return fail(["ENOSPC", "EDQUOT"].includes(error?.code) ? "MANAGED_ARTIFACT_DISK_FULL" : "MANAGED_ARTIFACT_IO_FAILED",
    ["ENOSPC", "EDQUOT"].includes(error?.code) ? "托管目录剩余磁盘空间不足。" : "托管制品文件读写失败。");
}
function createManagedArtifactStoreInternal(options = {}) {
  if (typeof options.root !== "string" || !path.isAbsolute(options.root) || options.root.startsWith("\\\\")) throw fail("MANAGED_ARTIFACT_ROOT_INVALID", "托管存储需要本机绝对目录。");
  const root = assertNoLinks(options.root);
  for (const projectRoot of options.projectRoots || []) {
    const project = path.resolve(projectRoot), relative = path.relative(project, root);
    if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) throw fail("MANAGED_ARTIFACT_ROOT_INVALID", "模型和依赖不能写入项目目录。");
  }
  const paths = { objects: path.join(root, "objects", "sha256"), parts: path.join(root, "parts"), downloads: path.join(root, "downloads"), bindings: path.join(root, "bindings") };
  Object.values(paths).forEach(directory => { assertNoLinks(directory); fs.mkdirSync(directory, { recursive: true }); assertNoLinks(directory, { allowMissing: false }); });
  const stateKey = keyPath(root), ownershipFile = path.join(root, "owner.lock.json");
  // Electron's application lock normally guarantees one Main process. Keep
  // the storage boundary safe when a diagnostic or another app process also
  // opens this root. A dead process's lock is recoverable; a live one is not.
  if (!ROOT_STATES.has(stateKey)) {
    let record;
    assertNoLinks(ownershipFile);
    try { if (fileSize(ownershipFile) > 4096) throw new Error(); record = JSON.parse(fs.readFileSync(ownershipFile, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "托管目录所有权记录损坏。"); }
    if (record) {
      if (!Number.isSafeInteger(record.pid) || !HASH.test(record.token || "")) throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "托管目录所有权记录无效。");
      if (processAlive(record.pid)) throw fail("MANAGED_ARTIFACT_STORE_IN_USE", "另一个 Main 进程正在使用此托管目录。");
      fs.unlinkSync(ownershipFile);
    }
    const token = randomBytes(32).toString("hex");
    let fd;
    try { fd = fs.openSync(ownershipFile, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, pid: process.pid, token })); fs.fsyncSync(fd); }
    catch (error) { throw fail(error.code === "EEXIST" ? "MANAGED_ARTIFACT_STORE_IN_USE" : "MANAGED_ARTIFACT_PATH_UNSAFE", "无法取得托管目录的独占进程所有权。"); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    ROOT_STATES.set(stateKey, { active: new Map(), leases: new Map(), reservations: new Map(), token });
  }
  const shared = ROOT_STATES.get(stateKey), allowLoopbackForTests = options.allowLoopbackForTests === true;
  const reserveBytes = options.reserveBytes === undefined ? 16 * 1024 * 1024 : options.reserveBytes;
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 30_000) : 30_000;
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) throw fail("MANAGED_ARTIFACT_SIZE_INVALID", "托管存储预留空间无效。");
  function assertOwnership() {
    assertNoLinks(ownershipFile, { allowMissing: false });
    let record;
    try { if (fileSize(ownershipFile) > 4096) throw new Error(); record = JSON.parse(fs.readFileSync(ownershipFile, "utf8")); } catch { throw fail("MANAGED_ARTIFACT_STORE_IN_USE", "托管目录进程所有权已发生变化。"); }
    if (record.pid !== process.pid || record.token !== shared.token) throw fail("MANAGED_ARTIFACT_STORE_IN_USE", "托管目录进程所有权已发生变化。");
  }
  function contained(file) {
    assertOwnership();
    const resolved = path.resolve(file), relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw fail("MANAGED_ARTIFACT_PATH_UNSAFE", "制品路径越出托管目录。");
    return assertNoLinks(resolved);
  }
  const objectPath = hash => contained(path.join(paths.objects, hashId(hash)));
  const partPath = hash => contained(path.join(paths.parts, `${hashId(hash)}.part`));
  const journalPath = hash => contained(path.join(paths.downloads, `${hashId(hash)}.json`));
  function writeJson(file, value) {
    contained(file);
    const temporary = contained(`${file}.${randomBytes(6).toString("hex")}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      contained(file); fs.renameSync(temporary, file);
    } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function readJson(file, fallback) {
    contained(file);
    try {
      if (fileSize(file) > 2 * 1024 * 1024) throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "托管记录超过大小限制。");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "托管记录损坏，已阻止继续写入。");
    }
  }
  function readJournal(hash) {
    const value = readJson(journalPath(hash), null);
    if (!value) return null;
    if (value.schemaVersion !== 1 || value.sha256 !== hash || !HASH.test(value.descriptorHash || "") || value.sourceHash !== undefined && !HASH.test(value.sourceHash) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || !["prepared", "downloading", "paused", "failed", "complete"].includes(value.status)) throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "制品下载记录无效。");
    if (value.etag !== null && value.etag !== undefined && !validEtag(value.etag)) throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "下载记录的 ETag 无效。");
    return value;
  }
  function validEtag(value) { return typeof value === "string" && value.length <= 512 && /^"[\x21\x23-\x7e]*"$/.test(value); }
  function saveJournal(journal) { journal.updatedAt = now(); writeJson(journalPath(journal.sha256), journal); }
  function getObject(hash) {
    const file = objectPath(hash), size = fileSize(file);
    if (size === null) return null;
    return { path: file, sha256: hash, bytes: size };
  }
  function readReferences() {
    const value = readJson(path.join(root, "references.json"), { schemaVersion: 1, owners: {} });
    if (value.schemaVersion !== 1 || !value.owners || typeof value.owners !== "object" || Array.isArray(value.owners)) throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "制品引用记录无效。");
    for (const [owner, hashes] of Object.entries(value.owners)) {
      ownerId(owner);
      if (!Array.isArray(hashes) || hashes.some(hash => !HASH.test(hash))) throw fail("MANAGED_ARTIFACT_JOURNAL_INVALID", "制品引用记录无效。");
    }
    return value;
  }
  function retain(owner, hashes) {
    ownerId(owner);
    if (!Array.isArray(hashes) || hashes.length > 1024) throw fail("MANAGED_ARTIFACT_OWNER_INVALID", "制品引用列表无效。");
    const values = [...new Set(hashes.map(hashId))].sort();
    if (values.some(hash => !getObject(hash))) throw fail("MANAGED_ARTIFACT_NOT_FOUND", "只能引用已校验的制品对象。");
    const refs = readReferences(); refs.owners[owner] = values; writeJson(path.join(root, "references.json"), refs); return values;
  }
  function release(owner) { ownerId(owner); const refs = readReferences(); delete refs.owners[owner]; writeJson(path.join(root, "references.json"), refs); }
  function acquireLease(owner, hashes) {
    ownerId(owner);
    if (!Array.isArray(hashes) || hashes.length > 1024) throw fail("MANAGED_ARTIFACT_OWNER_INVALID", "制品租约列表无效。");
    shared.leases.set(owner, new Set(hashes.map(hashId))); return true;
  }
  function releaseLease(owner) { ownerId(owner); return shared.leases.delete(owner); }
  function referenceSnapshot() {
    const refs = readReferences(), counts = {};
    for (const hashes of Object.values(refs.owners)) for (const hash of hashes) counts[hash] = (counts[hash] || 0) + 1;
    return { owners: clone(refs.owners), counts, leases: Object.fromEntries([...shared.leases].map(([owner, hashes]) => [owner, [...hashes]])) };
  }
  async function collect() {
    const removed = [], protectedHashes = new Set(Object.values(readReferences().owners).flat());
    for (const hashes of shared.leases.values()) for (const hash of hashes) protectedHashes.add(hash);
    for (const hash of shared.active.keys()) protectedHashes.add(hash);
    for (const entry of fs.readdirSync(paths.objects, { withFileTypes: true })) {
      if (!HASH.test(entry.name)) continue;
      const file = objectPath(entry.name);
      if (!entry.isFile() || entry.isSymbolicLink()) throw fail("MANAGED_ARTIFACT_PATH_UNSAFE", "对象存储包含不安全文件。");
      if (!protectedHashes.has(entry.name)) { fileSize(file); fs.unlinkSync(file); removed.push(entry.name); }
    }
    return { removed, protectedCount: protectedHashes.size };
  }
  function bindJob(artifact, jobId) {
    if (!jobId) throw fail("MANAGED_ARTIFACT_JOB_REQUIRED", "下载必须属于受管安装任务。");
    ownerId(jobId);
    const descriptorHash = hashManagedArtifactValue(artifact), bindingId = createHash("sha256").update(`${jobId}\n${artifact.id}`).digest("hex");
    const file = contained(path.join(paths.bindings, `${bindingId}.json`)), binding = readJson(file, null);
    if (binding && (binding.jobId !== jobId || binding.artifactId !== artifact.id || binding.descriptorHash !== descriptorHash)) throw fail("MANAGED_ARTIFACT_CONFLICT", "同一安装任务的制品内容冲突，已在网络前拒绝。");
    if (!binding) writeJson(file, { schemaVersion: 1, jobId, artifactId: artifact.id, descriptorHash });
    return descriptorHash;
  }
  async function availableSpace() {
    if (typeof options.availableBytes === "function") {
      const result = await options.availableBytes(root);
      if (!Number.isSafeInteger(result) || result < 0) throw fail("MANAGED_ARTIFACT_DISK_CHECK_FAILED", "无法确认托管目录剩余空间。");
      return result;
    }
    try { const stat = fs.statfsSync(root, { bigint: true }); return Number(stat.bavail * stat.bsize); }
    catch { throw fail("MANAGED_ARTIFACT_DISK_CHECK_FAILED", "无法确认托管目录剩余空间。"); }
  }
  function resolveNetwork(url, signal) {
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (error, network) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve(network);
      };
      const abort = () => finish(fail("MANAGED_ARTIFACT_PAUSED", "制品下载已暂停。"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) return abort();
      timer = setTimeout(() => finish(fail("MANAGED_ARTIFACT_DNS_TIMEOUT", "制品来源 DNS 解析等待超时。")), timeoutMs);
      const hostname = url.hostname.replace(/^\[|\]$/g, ""), local = allowLoopbackForTests && isLoopbackHost(hostname);
      // OS DNS lookups cannot always be canceled. Own only the bounded wait:
      // consume late success/rejection and never create a request after pause.
      void resolveComfyUiConnectionNetwork({
        id: "managed-artifact-download", label: "Managed artifact", baseUrl: url.origin,
        networkScope: local ? "local" : "remote", allowedHosts: [hostname], credentialRef: { mode: "none" }
      }, { lookup: options.lookup }).then(network => finish(null, network), error => {
        finish(fail(/DNS_REBINDING|DNS_INVALID/.test(error.code || "") ? "MANAGED_ARTIFACT_DNS_REBINDING" : /DNS/.test(error.code || "") ? "MANAGED_ARTIFACT_DNS_FAILED" : "MANAGED_ARTIFACT_NETWORK_SCOPE_DENIED", "制品来源未通过公网地址与 DNS 固定校验。"));
      });
    });
  }
  async function streamDownload(artifact, journal, controller, onProgress) {
    const file = partPath(artifact.sha256);
    let offset = fileSize(file) || 0;
    if (offset > artifact.bytes) throw fail("MANAGED_ARTIFACT_SIZE_MISMATCH", "下载临时文件超过声明大小。");
    if (offset === artifact.bytes) return;
    if (offset && !validEtag(journal.etag)) { contained(file); fs.truncateSync(file, 0); offset = 0; }
    if (controller.signal.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品下载已暂停。");
    options.assertNetworkAllowed?.();
    const url = new URL(artifact.url), network = await resolveNetwork(url, controller.signal);
    assertOwnership();
    if (controller.signal.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品下载已暂停。");
    options.assertNetworkAllowed?.();
    const headers = { accept: "application/octet-stream", "accept-encoding": "identity", "user-agent": "SparkAI-WorkSpace-Managed-Artifact/1" };
    if (offset) { headers.range = `bytes=${offset}-`; headers["if-range"] = journal.etag; }
    journal.status = "downloading"; journal.downloadedBytes = offset; journal.lastErrorCode = null; saveJournal(journal);
    await new Promise((resolve, reject) => {
      let settled = false, tlsReady = url.protocol !== "https:";
      let responseTask, responseStream, outputStream, outputClosed, responseClosed, requestClosed, requestError;
      // A request error precedes pipeline/output close on Windows. Do not let
      // a pause release the hash lock while the old .part descriptor is open.
      const finish = error => {
        if (settled) return;
        settled = true;
        if (error) outputStream?.destroy(error);
        responseStream?.destroy(); req.destroy();
        void Promise.all([outputClosed, responseClosed, requestClosed]).then(() => error ? reject(error) : resolve());
      };
      const req = (url.protocol === "https:" ? https : http).request({
        protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || undefined,
        path: url.pathname, method: "GET", headers, lookup: network.lookup, agent: false,
        rejectUnauthorized: true, maxHeaderSize: 32 * 1024, signal: controller.signal
      }, response => {
        responseStream = response;
        responseClosed = new Promise(closed => response.once("close", closed));
        response.on("error", () => {}); // Validation may fail before pipeline owns the response.
        responseTask = (async () => {
          const status = response.statusCode || 0;
          if (status >= 300 && status < 400) throw fail("MANAGED_ARTIFACT_REDIRECT_FORBIDDEN", "制品下载禁止自动重定向。");
          if (status !== 200 && status !== 206) throw fail(status === 401 || status === 403 ? "MANAGED_ARTIFACT_AUTH_FAILED" : "MANAGED_ARTIFACT_HTTP_FAILED", `制品下载被拒绝（${status}）。`);
          const encoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
          if (encoding !== "identity") throw fail("MANAGED_ARTIFACT_ENCODING_INVALID", "制品下载不允许传输压缩变换。");
          const responseEtag = response.headers.etag;
          if (status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(response.headers["content-range"] || ""));
            if (!offset || !range || Number(range[1]) !== offset || Number(range[2]) !== artifact.bytes - 1 || Number(range[3]) !== artifact.bytes || !validEtag(responseEtag) || responseEtag !== journal.etag) {
              journal.etag = null;
              throw fail("MANAGED_ARTIFACT_RANGE_INVALID", "服务器断点范围或 ETag 与已授权制品不符。");
            }
          } else { offset = 0; }
          const expected = artifact.bytes - offset, contentLength = response.headers["content-length"];
          if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) !== expected) || status === 206 && contentLength === undefined) throw fail("MANAGED_ARTIFACT_SIZE_MISMATCH", "服务器长度与制品声明不符。");
          journal.etag = validEtag(responseEtag) ? responseEtag : null; journal.downloadedBytes = offset; saveJournal(journal);
          contained(file); if (fs.existsSync(file)) fileSize(file);
          const output = outputStream = fs.createWriteStream(file, { flags: offset ? "a" : "w", mode: 0o600 });
          outputClosed = new Promise(closed => output.once("close", closed));
          let received = offset, lastPersisted = offset;
          const counter = new Transform({ transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > artifact.bytes) return callback(fail("MANAGED_ARTIFACT_SIZE_MISMATCH", "服务器返回数据超过制品声明大小。"));
            journal.downloadedBytes = received;
            if (received - lastPersisted >= 1024 * 1024) { try { saveJournal(journal); lastPersisted = received; } catch (error) { return callback(error); } }
            try { onProgress?.({ sha256: artifact.sha256, downloadedBytes: received, bytes: artifact.bytes, status: "downloading" }); } catch {}
            callback(null, chunk);
          } });
          await pipeline(response, counter, output, { signal: controller.signal });
          if (received !== artifact.bytes) throw fail("MANAGED_ARTIFACT_SIZE_MISMATCH", "制品下载未达到声明大小。");
          journal.downloadedBytes = received; saveJournal(journal);
        })();
        void responseTask.then(() => finish(requestError), error => finish(requestError || error));
      });
      requestClosed = new Promise(closed => req.once("close", closed));
      req.on("socket", socket => {
        const approved = new Set(network.addresses.map(item => addressKey(item.address)));
        socket.once(socket.encrypted ? "secureConnect" : "connect", () => {
          if (socket.encrypted) tlsReady = true;
          if (!approved.has(addressKey(socket.remoteAddress))) socket.destroy(fail("MANAGED_ARTIFACT_DNS_REBINDING", "制品下载 socket 地址与批准解析不符。"));
        });
      });
      req.setTimeout(timeoutMs, () => req.destroy(fail("MANAGED_ARTIFACT_TIMEOUT", "制品下载等待超时。")));
      req.on("error", error => {
        if (settled) return;
        requestError = !tlsReady && !controller.signal.aborted && !String(error.code || "").startsWith("MANAGED_") && ["ECONNRESET", "EPROTO"].includes(error.code)
          ? fail("MANAGED_ARTIFACT_TLS_FAILED", "制品下载 TLS 握手失败。") : downloadError(error, controller.signal);
        if (responseTask) { responseStream.destroy(requestError); outputStream?.destroy(requestError); }
        else finish(requestError);
      }); req.end();
    });
  }
  async function runDownload(artifact, descriptorHash, controller, onProgress) {
    const hash = artifact.sha256, current = getObject(hash);
    if (current) {
      if (current.bytes !== artifact.bytes || await hashFile(current.path, controller.signal) !== hash) throw fail("MANAGED_ARTIFACT_CHECKSUM_MISMATCH", "现有制品对象完整性校验失败。");
      return { ...current, reused: true };
    }
    let journal = readJournal(hash);
    if (journal && journal.bytes !== artifact.bytes) throw fail("MANAGED_ARTIFACT_CONFLICT", "同一制品对象的声明大小冲突，已在网络前拒绝。");
    const sourceHash = hashManagedArtifactValue({ url: artifact.url });
    if (journal && journal.descriptorHash !== descriptorHash) {
      // A new authorized plan may reuse the same immutable bytes under a
      // different label/license or a new source. Job bindings above still
      // reject all mutations of an existing job before reaching this point.
      if (journal.sourceHash !== sourceHash) {
        const partial = partPath(hash); if (fileSize(partial) !== null) fs.truncateSync(partial, 0);
        journal.etag = null; journal.downloadedBytes = 0;
      }
      journal.descriptorHash = descriptorHash; journal.artifactId = artifact.id;
    }
    journal ||= { schemaVersion: 1, sha256: hash, artifactId: artifact.id, descriptorHash, bytes: artifact.bytes, downloadedBytes: 0, etag: null, status: "prepared", createdAt: now(), updatedAt: now(), lastErrorCode: null };
    journal.sourceHash = sourceHash;
    const partial = fileSize(partPath(hash)) || 0, remaining = Math.max(artifact.bytes - partial, 0);
    const available = await availableSpace();
    const reservations = [...shared.reservations.entries()].filter(([key]) => key !== hash).reduce((sum, [, value]) => sum + value, 0);
    if (available < remaining + reserveBytes + reservations) throw fail("MANAGED_ARTIFACT_DISK_FULL", "托管目录剩余磁盘空间不足。");
    shared.reservations.set(hash, remaining); saveJournal(journal);
    try {
      await streamDownload(artifact, journal, controller, onProgress);
      if (controller.signal.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品下载已暂停。");
      const partialFile = partPath(hash);
      if (fileSize(partialFile) !== artifact.bytes || await hashFile(partialFile, controller.signal) !== hash) {
        journal.etag = null;
        if (fileSize(partialFile) !== null) { contained(partialFile); fs.unlinkSync(partialFile); }
        throw fail("MANAGED_ARTIFACT_CHECKSUM_MISMATCH", "制品 SHA-256 或大小校验失败。");
      }
      if (controller.signal.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品下载已暂停。");
      contained(partialFile);
      const fd = fs.openSync(partialFile, "r+");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const destination = objectPath(hash);
      if (fs.existsSync(destination)) throw fail("MANAGED_ARTIFACT_CONFLICT", "制品对象在激活前发生并发变化。");
      fs.renameSync(partialFile, destination);
      journal.status = "complete"; journal.downloadedBytes = artifact.bytes; journal.lastErrorCode = null; saveJournal(journal);
      try { onProgress?.({ sha256: hash, downloadedBytes: artifact.bytes, bytes: artifact.bytes, status: "complete" }); } catch {}
      return { path: destination, sha256: hash, bytes: artifact.bytes, reused: false };
    } catch (error) {
      const safe = downloadError(error, controller.signal);
      journal.status = safe.code === "MANAGED_ARTIFACT_PAUSED" ? "paused" : "failed";
      journal.downloadedBytes = fileSize(partPath(hash)) || 0; journal.lastErrorCode = safe.code; saveJournal(journal);
      throw safe;
    } finally { shared.reservations.delete(hash); }
  }
  async function ensureArtifact(raw, config = {}) {
    const artifact = normalizeManagedArtifactDescriptor(raw, { allowLoopbackForTests });
    const descriptorHash = bindJob(artifact, config.jobId), active = shared.active.get(artifact.sha256);
    if (config.signal?.aborted) throw fail("MANAGED_ARTIFACT_PAUSED", "制品下载等待已暂停。");
    if (active) {
      if (active.bytes !== artifact.bytes) throw fail("MANAGED_ARTIFACT_CONFLICT", "并发制品声明大小冲突，已在网络前拒绝。");
      if (active.controller.signal.aborted) {
        // Immediate resume waits for the previous output descriptor to close.
        await waitForClosingDownload(active, config.signal);
        return ensureArtifact(artifact, config);
      }
      return observeDownload(active, config);
    }
    const controller = new AbortController();
    const record = { descriptorHash, bytes: artifact.bytes, controller, promise: null, observers: new Set() };
    shared.active.set(artifact.sha256, record);
    const observer = observeDownload(record, config);
    record.promise = Promise.resolve().then(() => runDownload(artifact, descriptorHash, controller, event => {
      for (const listener of record.observers) { try { listener.onProgress?.(event); } catch {} }
    })).finally(() => {
      if (shared.active.get(artifact.sha256) === record) shared.active.delete(artifact.sha256);
    });
    void record.promise.then(result => {
      for (const listener of [...record.observers]) listener.finish(null, result);
    }, error => {
      for (const listener of [...record.observers]) listener.finish(error);
    });
    return observer;
  }
  function waitForClosingDownload(record, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => { if (settled) return; settled = true; signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
      const abort = () => finish(fail("MANAGED_ARTIFACT_PAUSED", "制品下载等待已暂停。"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) return abort();
      void record.promise.then(() => finish(), () => finish());
    });
  }
  function observeDownload(record, config) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const listener = {
        onProgress: config.onProgress,
        finish(error, result) {
          if (settled) return;
          settled = true; record.observers.delete(listener); config.signal?.removeEventListener("abort", abort);
          error ? reject(error) : resolve(result);
        }
      };
      const abort = () => {
        record.observers.delete(listener); config.signal?.removeEventListener("abort", abort);
        const paused = fail("MANAGED_ARTIFACT_PAUSED", "此安装任务的下载等待已暂停。");
        if (record.observers.size) return listener.finish(paused);
        record.controller.abort();
        // The final observer owns shutdown and waits for the actual close
        // barrier. Other observers can leave without stopping their peers.
        void record.promise.then(() => listener.finish(paused), () => listener.finish(paused));
      };
      record.observers.add(listener); config.signal?.addEventListener("abort", abort, { once: true });
    });
  }
  function pause(hash) { const active = shared.active.get(hashId(hash)); if (active) active.controller.abort(); return !!active; }
  function getDownload(hash) {
    hashId(hash); const value = readJournal(hash);
    if (!value) return null;
    return { ...clone(value), status: value.status === "downloading" && !shared.active.has(hash) ? "paused" : value.status, downloadedBytes: value.status === "complete" ? value.bytes : fileSize(partPath(hash)) || 0 };
  }
  function listDownloads() { return fs.readdirSync(paths.downloads).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => getDownload(name.slice(0, 64))); }
  const wrapSync = fn => (...args) => { try { return fn(...args); } catch (error) { throw safeStoreError(error); } };
  const wrapAsync = fn => async (...args) => { try { return await fn(...args); } catch (error) { throw safeStoreError(error); } };
  return Object.freeze({
    ensureArtifact: wrapAsync(ensureArtifact), getObject: wrapSync(getObject), retain: wrapSync(retain), release: wrapSync(release),
    acquireLease: wrapSync(acquireLease), releaseLease: wrapSync(releaseLease), collect: wrapAsync(collect), referenceSnapshot: wrapSync(referenceSnapshot),
    pause: wrapSync(pause), getDownload: wrapSync(getDownload), listDownloads: wrapSync(listDownloads)
  });
}
function createManagedArtifactStore(options) { try { return createManagedArtifactStoreInternal(options); } catch (error) { throw safeStoreError(error); } }

module.exports = { createManagedArtifactStore, assertManagedArtifactPath: assertNoLinks };
