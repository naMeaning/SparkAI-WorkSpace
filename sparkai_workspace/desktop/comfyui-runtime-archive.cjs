"use strict";

// Main-only archive boundary. The executable is a pinned application resource;
// neither the manifest nor an IPC caller can select an extractor or its argv.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");

const SEVEN_ZIP_SHA256 = "b0cfdeaf429f5cc53f85123dd8f5a5feb92c19d31aa34df257edf9a26be05f95";
const failure = (code, message) => Object.assign(new Error(message), { code });
const safeRelative = value => {
  if (typeof value !== "string" || !value || value.length > 1024 || /[\u0000-\u001f\u007f:*?"<>|]/.test(value) || /^[\\/]/.test(value)) throw failure("COMFYUI_RUNTIME_ARCHIVE_PATH", "归档包含不安全的路径。");
  const parts = value.replace(/\\/g, "/").replace(/\/$/, "").split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw failure("COMFYUI_RUNTIME_ARCHIVE_PATH", "归档包含不安全的路径。");
  return parts.join("/");
};

function assertNoLinks(target, { directory = false, allowMissing = false } = {}) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (allowMissing) continue;
      throw failure("COMFYUI_RUNTIME_PATH_INVALID", "运行环境文件不存在。");
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw failure("COMFYUI_RUNTIME_PATH_INVALID", "运行环境不能使用链接或目录联接。");
  }
  if (!allowMissing || fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw failure("COMFYUI_RUNTIME_PATH_INVALID", "运行环境路径类型无效。");
  }
  return absolute;
}

function parseSevenZipListing(text, { expandedBytes, maxEntries = 200000 } = {}) {
  if (!Number.isSafeInteger(expandedBytes) || expandedBytes < 1) throw failure("COMFYUI_RUNTIME_ARCHIVE_LIMIT", "归档展开大小没有明确上限。");
  const entries = [], seen = new Map();
  let totalBytes = 0;
  for (const block of String(text).replace(/\r\n/g, "\n").trim().split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const values = {};
    for (const line of block.split("\n")) {
      const match = /^([^=\n]+?) = (.*)$/.exec(line);
      if (!match || Object.hasOwn(values, match[1])) throw failure("COMFYUI_RUNTIME_ARCHIVE_INVALID", "归档目录清单无效。");
      values[match[1]] = match[2];
    }
    if (!Object.hasOwn(values, "Path")) throw failure("COMFYUI_RUNTIME_ARCHIVE_INVALID", "归档缺少条目路径。");
    if (Object.keys(values).some(key => /(?:symbolic|hard|reparse).*link|^(?:symbolic|hard) link$|^reparse/i.test(key)) ||
      /(?:\blink\b|symlink|reparse|(?:^|\s)l[rwx-]{6,})/i.test(`${values.Attributes || ""} ${values.Mode || ""} ${values.Type || ""}`) || values.Encrypted === "+") throw failure("COMFYUI_RUNTIME_ARCHIVE_LINK", "归档不能包含链接或加密条目。");
    const relative = safeRelative(values.Path), key = relative.toLowerCase();
    if (seen.has(key)) throw failure("COMFYUI_RUNTIME_ARCHIVE_COLLISION", "归档包含重复或大小写冲突路径。");
    const directory = values.Folder === "+" || /^D/.test(values.Attributes || "");
    const bytes = directory ? 0 : Number(values.Size);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw failure("COMFYUI_RUNTIME_ARCHIVE_INVALID", "归档文件大小无效。");
    totalBytes += bytes;
    if (totalBytes > expandedBytes || entries.length >= maxEntries) throw failure("COMFYUI_RUNTIME_ARCHIVE_LIMIT", "归档超出已授权的展开上限。");
    seen.set(key, directory); entries.push({ relative, directory, bytes });
  }
  if (!entries.length || totalBytes !== expandedBytes) throw failure("COMFYUI_RUNTIME_ARCHIVE_SIZE", "归档展开大小与清单声明不符。");
  for (const { relative } of entries) {
    const parts = relative.toLowerCase().split("/");
    while (parts.length > 1) { parts.pop(); if (seen.get(parts.join("/")) === false) throw failure("COMFYUI_RUNTIME_ARCHIVE_COLLISION", "归档文件与目录冲突。"); }
  }
  return { entries, expandedBytes: totalBytes };
}

function runExtractor(binary, args, { signal, timeoutMs = 120000, maxOutputBytes = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child, output = "", bytes = 0, timer, settled = false, stoppingError;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(output); };
    const stop = error => { if (settled || stoppingError) return; stoppingError = error; clearTimeout(timer); try { child.kill("SIGTERM"); } catch {} };
    const abort = () => stop(failure("COMFYUI_RUNTIME_PAUSED", "运行环境任务已暂停。"));
    if (signal?.aborted) return finish(failure("COMFYUI_RUNTIME_PAUSED", "运行环境任务已暂停。"));
    try { child = spawn(binary, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: path.dirname(binary) } }); }
    catch { return finish(failure("COMFYUI_RUNTIME_EXTRACTOR_FAILED", "归档工具无法启动。")); }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => stop(failure("COMFYUI_RUNTIME_EXTRACTOR_TIMEOUT", "归档审核或解压超时。")), timeoutMs);
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > maxOutputBytes) stop(failure("COMFYUI_RUNTIME_ARCHIVE_LIMIT", "归档目录或输出超过安全上限。")); else if (!stoppingError) output += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > maxOutputBytes) stop(failure("COMFYUI_RUNTIME_ARCHIVE_LIMIT", "归档输出超过安全上限。")); });
    child.once("error", () => { const error = failure("COMFYUI_RUNTIME_EXTRACTOR_FAILED", "归档工具无法启动。"); if (!child.pid) finish(error); else stop(error); });
    // Resolve only after close: the caller may remove staging immediately on
    // rejection, so an aborted extractor must have stopped writing first.
    child.once("close", code => finish(stoppingError || (code === 0 ? null : failure("COMFYUI_RUNTIME_EXTRACTOR_FAILED", "归档审核或解压失败。"))));
  });
}

function inspectExtractedTree(root, listing) {
  const expected = new Map(listing.entries.filter(entry => !entry.directory).map(entry => [entry.relative.toLowerCase(), entry]));
  let bytes = 0, count = 0;
  const visit = (directory, relative = "") => {
    assertNoLinks(directory, { directory: true });
    for (const name of fs.readdirSync(directory)) {
      const rel = relative ? `${relative}/${name}` : name, file = path.join(directory, name), stat = fs.lstatSync(file);
      safeRelative(rel);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw failure("COMFYUI_RUNTIME_ARCHIVE_LINK", "解压结果包含链接或特殊文件。");
      if (stat.isDirectory()) visit(file, rel);
      else {
        const entry = expected.get(rel.toLowerCase());
        if (!entry || entry.bytes !== stat.size || entry.relative !== rel || stat.nlink !== 1) throw failure("COMFYUI_RUNTIME_ARCHIVE_MISMATCH", "解压结果与审核目录不一致。");
        expected.delete(rel.toLowerCase()); bytes += stat.size; count++;
      }
    }
  };
  visit(root);
  if (expected.size || bytes !== listing.expandedBytes) throw failure("COMFYUI_RUNTIME_ARCHIVE_MISMATCH", "解压结果缺失文件或大小不符。");
  return { bytes, files: count };
}

function createComfyUiArchiveService({ sevenZipPath } = {}) {
  function binary() {
    const resource = process.resourcesPath && path.join(process.resourcesPath, "tools", "7za.exe");
    const file = sevenZipPath || (resource && fs.existsSync(resource) ? resource : require("7zip-bin").path7za);
    assertNoLinks(file);
    if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== SEVEN_ZIP_SHA256) throw failure("COMFYUI_RUNTIME_EXTRACTOR_HASH", "归档工具校验失败。");
    return file;
  }
  async function extract(archive, destination, artifact, { signal } = {}) {
    assertNoLinks(archive); assertNoLinks(destination, { directory: true });
    if (fs.readdirSync(destination).length) throw failure("COMFYUI_RUNTIME_ARCHIVE_TARGET", "解压目标必须是独立空目录。");
    const handle = fs.openSync(archive, "r"), prefix = Buffer.alloc(6);
    try { fs.readSync(handle, prefix, 0, 6, 0); } finally { fs.closeSync(handle); }
    if (artifact.format === "7z" ? !prefix.equals(Buffer.from("377abcaf271c", "hex")) : artifact.format !== "zip" || prefix.readUInt16LE(0) !== 0x4b50) throw failure("COMFYUI_RUNTIME_ARCHIVE_FORMAT", "归档格式与清单不符。");
    const executable = binary();
    const listing = parseSevenZipListing(await runExtractor(executable, ["l", "-slt", "-ba", "-sccUTF-8", "-spd", "--", archive], { signal }), { expandedBytes: artifact.expandedBytes });
    await runExtractor(executable, ["x", "-y", "-bb0", "-bd", "-sccUTF-8", `-o${destination}`, "--", archive], { signal, timeoutMs: 15 * 60 * 1000 });
    return { ...inspectExtractedTree(destination, listing), listing };
  }
  return Object.freeze({ extract });
}

module.exports = { createComfyUiArchiveService, parseSevenZipListing, inspectExtractedTree, assertNoLinks, safeRelative, SEVEN_ZIP_SHA256 };
