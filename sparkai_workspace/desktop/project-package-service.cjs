"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { existsSync, lstatSync, fstatSync, statfsSync, mkdirSync, renameSync, rmSync, writeFileSync, openSync, closeSync, readSync, writeSync, fsyncSync } = require("node:fs");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const fsPromises = require("node:fs/promises");
const { redactText } = require("./debug-command-service.cjs");

const PROJECT_PACKAGE_SERVICE_OWNER = "desktop/project-package-service.cjs";
const projectPackageMaximumFileBytes = 192 * 1024 * 1024;
const projectPackageMaximumAssetBytes = 32 * 1024 * 1024;
const projectPackageMaximumDecodedBytes = 128 * 1024 * 1024;
const projectPackageMaximumSessionBytes = 16 * 1024 * 1024;
// v4 is a streaming ZIP container. The legacy JSON limits remain in force for
// v1-v3 reads so old callers keep their established safety envelope.
const projectPackageV4MaximumAssetBytes = 512 * 1024 * 1024;
const projectPackageV4MaximumDecodedBytes = 2 * 1024 * 1024 * 1024;
const projectPackageV4MaximumFileBytes = 2 * 1024 * 1024 * 1024;
const projectPackageMaximumAssets = 1_000;
const projectPackageMaximumNodes = 5_000;
const projectPackageMaximumMessages = 10_000;
const projectPackageMaximumConversations = 1_000;
const projectPackageFormats = new Set(["naimage-project-package", "iiimage-project-package"]);
const ASSET_SOURCE = Symbol("project-package-asset-source");
const RESTORED_ASSETS = Symbol("project-package-restored-assets");
const uniqueByteLength = assets => [...new Map(assets.map(asset => [asset.contentHash, asset.byteLength])).values()].reduce((total, bytes) => total + bytes, 0);
const CHUNK_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_KNOWLEDGE_BYTES = 8 * 1024 * 1024;
// Small dependency-free ZIP reader/writer. v4 deliberately uses the "store"
// method for media entries so output can be emitted incrementally from Main
// without building a second compressed copy in memory. ZIP compression/encryption
// extensions are rejected: accepting a container must not enable an inflater bomb.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();
function updateCrc32(value, buffer) {
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}
function zipName(value) {
  const name = String(value || "");
  if (!name || /[\\:\u0000-\u001f]/.test(name) || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid ZIP entry name");
  return name;
}
function zipLocalHeader(name, size, checksum) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8
  header.writeUInt16LE(0, 8); // store
  header.writeUInt16LE(0, 10); header.writeUInt16LE(0, 12);
  header.writeUInt32LE(checksum >>> 0, 14);
  header.writeUInt32LE(size >>> 0, 18); header.writeUInt32LE(size >>> 0, 22);
  header.writeUInt16LE(nameBytes.length, 26); header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return header;
}
function zipCentralHeader(name, size, checksum, offset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12); header.writeUInt16LE(0, 14);
  header.writeUInt32LE(checksum >>> 0, 16);
  header.writeUInt32LE(size >>> 0, 20); header.writeUInt32LE(size >>> 0, 24);
  header.writeUInt16LE(nameBytes.length, 28); header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32); header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36); header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset >>> 0, 42);
  nameBytes.copy(header, 46);
  return header;
}
function sourceIdentity(stats) {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}
function fileSource(filePath, maxBytes = projectPackageV4MaximumFileBytes) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > maxBytes) throw new Error("package source is missing, invalid, or exceeds its size limit");
  return { path: path.resolve(filePath), size: stats.size, identity: sourceIdentity(stats) };
}
function withSource(source, operation) {
  if (source.buffer) return operation((position, size) => {
    if (position < 0 || size < 0 || position + size > source.size) throw new Error("ZIP entry is truncated");
    return source.buffer.subarray(position, position + size);
  });
  const fd = openSync(source.path, "r");
  try {
    if (source.identity !== sourceIdentity(fstatSync(fd)) || lstatSync(source.path).isSymbolicLink()) throw new Error("package source changed during use");
    const result = operation((position, size) => {
      if (position < 0 || size < 0 || position + size > source.size) throw new Error("ZIP entry is truncated");
      const buffer = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        const received = readSync(fd, buffer, offset, size - offset, position + offset);
        if (!received) throw new Error("package source is truncated");
        offset += received;
      }
      return buffer;
    });
    if (source.identity !== sourceIdentity(fstatSync(fd))) throw new Error("package source changed during use");
    return result;
  } finally { closeSync(fd); }
}
function eachSourceChunk(source, operation) {
  let checksum = 0xffffffff;
  const hash = createHash("sha256");
  withSource(source, read => {
    const size = source.entry?.size ?? source.size, start = source.entry?.offset || 0;
    for (let position = 0; position < size; position += CHUNK_BYTES) {
      const chunk = read(start + position, Math.min(CHUNK_BYTES, size - position));
      checksum = updateCrc32(checksum, chunk); hash.update(chunk); operation?.(chunk);
    }
  });
  checksum = (checksum ^ 0xffffffff) >>> 0;
  if (source.entry && checksum !== source.entry.checksum) throw new Error("ZIP entry checksum mismatch");
  return { contentHash: hash.digest("hex"), checksum, byteLength: source.entry?.size ?? source.size };
}
function writeAll(fd, data) {
  for (let offset = 0; offset < data.length;) offset += writeSync(fd, data, offset, data.length - offset);
}
function writeStoredZip(filePath, entries, maxBytes) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = openSync(tempPath, "wx");
  const central = []; let offset = 0; let closed = false;
  try {
    for (const entry of entries) {
      const name = zipName(entry.name), source = entry.source || { buffer: entry.data, size: entry.data.length };
      const expected = entry.metadata || eachSourceChunk(source);
      const local = zipLocalHeader(name, expected.byteLength, expected.checksum);
      if (offset + local.length + expected.byteLength > maxBytes) throw new Error("ZIP package exceeds configured size limit");
      writeAll(fd, local);
      const actual = eachSourceChunk(source, chunk => writeAll(fd, chunk));
      if (actual.contentHash !== expected.contentHash || actual.byteLength !== expected.byteLength) throw new Error("asset changed during export");
      central.push(zipCentralHeader(name, expected.byteLength, expected.checksum, offset));
      offset += local.length + expected.byteLength;
    }
    const centralOffset = offset;
    for (const header of central) { writeAll(fd, header); offset += header.length; }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12); end.writeUInt32LE(centralOffset, 16);
    writeAll(fd, end); offset += end.length;
    if (offset > maxBytes) throw new Error("ZIP package exceeds configured size limit");
    fsyncSync(fd); closeSync(fd); closed = true; renameSync(tempPath, filePath);
    return { bytes: offset, entries: central.length };
  } finally {
    if (!closed) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}
function readZipDirectory(source, maxBytes) {
  return withSource(source, read => {
    const tailLength = Math.min(source.size, 0xffff + 22), tailStart = source.size - tailLength;
    if (tailLength < 22) throw new Error("invalid ZIP package");
    const tail = read(tailStart, tailLength); let end = -1;
    for (let index = tailLength - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tailLength) { end = index; break; }
    }
    if (end < 0) throw new Error("ZIP end record missing");
    const count = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), directoryOffset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count ||
      count > projectPackageMaximumAssets + 3 || directorySize > 2 * 1024 * 1024 || directoryOffset + directorySize !== tailStart + end) throw new Error("ZIP directory invalid");
    const directory = read(directoryOffset, directorySize), entries = new Map(), ranges = []; let cursor = 0, total = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP central entry invalid");
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10);
      const checksum = directory.readUInt32LE(cursor + 16), compressedSize = directory.readUInt32LE(cursor + 20), size = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28), extraLength = directory.readUInt16LE(cursor + 30), commentLength = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42), unixMode = directory.readUInt32LE(cursor + 38) >>> 16;
      if (flags & ~0x800 || method !== 0 || compressedSize !== size || size > maxBytes || directory.readUInt16LE(cursor + 34) ||
        (unixMode & 0xf000) === 0xa000 || cursor + 46 + nameLength + extraLength + commentLength > directory.length) throw new Error("unsupported or invalid ZIP entry");
      const nameBytes = directory.subarray(cursor + 46, cursor + 46 + nameLength), name = zipName(nameBytes.toString("utf8"));
      if (!Buffer.from(name).equals(nameBytes) || entries.has(name) || !/^(?:manifest\.json|session\.json|knowledge\.json|assets\/[a-f0-9]{64})$/.test(name)) throw new Error("unexpected or duplicate ZIP entry");
      cursor += 46 + nameLength + extraLength + commentLength;
      if (localOffset + 30 > directoryOffset) throw new Error("ZIP local header invalid");
      const local = read(localOffset, 30), localNameLength = local.readUInt16LE(26), localExtraLength = local.readUInt16LE(28);
      const offset = localOffset + 30 + localNameLength + localExtraLength;
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method ||
        local.readUInt32LE(14) !== checksum || local.readUInt32LE(18) !== size || local.readUInt32LE(22) !== size ||
        offset + size > directoryOffset || !read(localOffset + 30, localNameLength).equals(nameBytes)) throw new Error("ZIP local entry does not match directory");
      total += size; if (total > maxBytes) throw new Error("ZIP package exceeds size limit");
      entries.set(name, { name, offset, size, checksum }); ranges.push([localOffset, offset + size]);
    }
    ranges.sort((left, right) => left[0] - right[0]);
    if (cursor !== directory.length || ranges.some((range, index) => index && range[0] < ranges[index - 1][1])) throw new Error("ZIP entries overlap");
    return entries;
  });
}
function sourceBytes(source, maxBytes) {
  const size = source.entry?.size ?? source.size;
  if (size > maxBytes) throw new Error("asset exceeds its in-memory verification limit");
  return withSource(source, read => read(source.entry?.offset || 0, size));
}
async function writeStreamingZip(filePath, entries, { signal, overwrite = false, maxBytes = projectPackageV4MaximumFileBytes } = {}) {
  const cancelled = () => { if (signal?.aborted) throw Object.assign(new Error("ZIP 导出已取消。"), { code: "EXPORT_CANCELLED" }); };
  const names = new Set(), prepared = [];
  if (!Array.isArray(entries) || !entries.length || entries.length > 10000) throw new Error("invalid ZIP entries");
  const readEntry = async (entry, consume) => {
    cancelled(); let checksum = 0xffffffff, byteLength = 0; const hash = createHash("sha256");
    if (entry.source && sourceIdentity(await fsPromises.lstat(entry.source.path)) !== entry.source.identity) throw new Error("ZIP source changed");
    const chunks = entry.source ? createReadStream(entry.source.path, { highWaterMark: CHUNK_BYTES, signal }) : [entry.data];
    for await (const chunk of chunks) {
      cancelled(); checksum = updateCrc32(checksum, chunk); hash.update(chunk); byteLength += chunk.length;
      if (consume) await consume(chunk);
    }
    if (entry.source && sourceIdentity(await fsPromises.lstat(entry.source.path)) !== entry.source.identity) throw new Error("ZIP source changed");
    return { checksum: (checksum ^ 0xffffffff) >>> 0, contentHash: hash.digest("hex"), byteLength };
  };
  let estimated = 22;
  for (const item of entries) {
    const name = zipName(item.name), key = name.toLowerCase();
    if (names.has(key)) throw new Error("duplicate ZIP entry"); names.add(key);
    const entry = { name, ...(item.filePath ? { source: fileSource(item.filePath, maxBytes) } : { data: Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data || "") }) };
    entry.metadata = await readEntry(entry);
    if (item.expectedHash && item.expectedHash !== entry.metadata.contentHash) throw Object.assign(new Error("ZIP 来源字节已经改变。"), { code: "IMAGE_EXPORT_SOURCE_CHANGED" });
    estimated += entry.metadata.byteLength + 76 + 2 * Buffer.byteLength(name);
    if (estimated > maxBytes) throw Object.assign(new Error("ZIP 超过 2GiB 上限。"), { code: "EXPORT_ZIP_TOO_LARGE" });
    prepared.push(entry);
  }
  const temporary = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  if (typeof fsPromises.statfs === "function") {
    const space = await fsPromises.statfs(path.dirname(filePath));
    if (Number(space.bavail) * Number(space.bsize) < estimated + CHUNK_BYTES) throw Object.assign(new Error("ZIP 导出目录可用空间不足。"), { code: "EXPORT_DISK_SPACE_INSUFFICIENT" });
  }
  const fd = await fsPromises.open(temporary, "wx"); let closed = false, offset = 0; const central = [];
  const write = async bytes => { for (let written = 0; written < bytes.length;) { cancelled(); const result = await fd.write(bytes, written, bytes.length - written); written += result.bytesWritten; } };
  try {
    for (const entry of prepared) {
      const { metadata } = entry, header = zipLocalHeader(entry.name, metadata.byteLength, metadata.checksum);
      await write(header); const actual = await readEntry(entry, write);
      if (actual.contentHash !== metadata.contentHash || actual.byteLength !== metadata.byteLength) throw new Error("ZIP source changed during export");
      central.push(zipCentralHeader(entry.name, metadata.byteLength, metadata.checksum, offset)); offset += header.length + metadata.byteLength;
    }
    const directoryOffset = offset;
    for (const header of central) { await write(header); offset += header.length; }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - directoryOffset, 12); end.writeUInt32LE(directoryOffset, 16); await write(end); offset += 22;
    cancelled(); await fd.sync(); await fd.close(); closed = true; cancelled();
    if (overwrite) await fsPromises.rename(temporary, filePath);
    else { await fsPromises.link(temporary, filePath); await fsPromises.unlink(temporary); }
    return { path: filePath, bytes: offset, entries: prepared.length, format: "zip" };
  } finally { if (!closed) await fd.close(); await fsPromises.rm(temporary, { force: true }); }
}
function portableMetadata(value) {
  if (typeof value === "string") return redactText(value)
    .replace(/https?:\/\/[^\s<>"')]+[?&](?:token|signature|sig|key|expires|x-amz-[^=]+)=[^\s<>"')]+/gi, "[链接已隐藏]")
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+/gi, "[路径已隐藏]");
  if (Array.isArray(value)) return value.map(portableMetadata);
  if (!value || typeof value !== "object") return value;
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:path|assetUrl|url|sourceUrl|remoteUrl|downloadUrl|baseUrl|customBaseUrl|apiKey|token|bearerToken|accessToken|authorization|cookie|credentials|sessionCookie|sourcePath|sourceDirectory|importRootPath|projectId|taskId|receiptId|operationId|resumeToken|pendingAgentExecution|projectTaskContexts|taskScope|projectKnowledge|protocolHistory|toolHistory|compactSummary)$/i.test(key) || /(?:api.?key|access.?token|session.?cookie|secret|password)$/i.test(key) || /(?:task|receipt|operation)(?:Id|Key|Token|Context|Execution|State|Journal)$/i.test(key)) continue;
    result[key] = portableMetadata(item);
  }
  return result;
}

function createProjectPackageService(options = {}) {
  const {
    assertSafeEncodedImageDimensions,
    assetUrlFor,
    buildProjectAssetIndex,
    comparablePath,
    controlledProjectAssetFile,
    createProjectRecord,
    defaultSession,
    detectImageFormat,
    encodedImageDimensions,
    hydrateAssetForProject,
    isComparablePathInside,
    log = () => {},
    mimeTypeForPath,
    nativeImage,
    readCommerceCatalog,
    sanitizeCommerceCatalogDocument,
    projectWritableAssetRoots,
    projectRelativePath,
    projectSessionFromDisk,
    resolveProjectRelativePath,
    safeName,
    sanitizeSession,
    sessionForProjectSave,
    writeCommerceCatalog,
    writeJson,
    writeProjectManifest,
    exportProjectKnowledge,
    importProjectKnowledge,
    validatePortableProjectKnowledge,
    availableBytesForPath
  } = options;

  function projectPackageFailure(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validateProjectPackageSessionShape(session, { version = 3 } = {}) {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "画布项目包缺少有效会话数据。");
    }
    const nodes = Array.isArray(session.nodes) ? session.nodes : [];
    if (nodes.some((node) => node?.type === "video") && Number(version) < 4) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_VIDEO_UNSUPPORTED", "当前项目包暂不嵌入视频文件；请先移除视频节点，或直接复制完整项目文件夹。");
    }
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const conversations = Array.isArray(session.conversations) ? session.conversations : [];
    if (nodes.length > projectPackageMaximumNodes) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `画布节点超过 ${projectPackageMaximumNodes} 个，无法安全导入或导出。`);
    }
    if (messages.length > projectPackageMaximumMessages || conversations.length > projectPackageMaximumConversations) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "画布会话或消息数量过多，无法安全导入或导出。");
    }
    let conversationMessages = 0;
    for (const conversation of conversations) {
      conversationMessages += Array.isArray(conversation?.messages) ? conversation.messages.length : 0;
      if (conversationMessages > projectPackageMaximumMessages) {
        throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "画布历史消息数量过多，无法安全导入或导出。");
      }
    }
    let serialized;
    try {
      serialized = JSON.stringify(session);
    } catch {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "画布会话无法序列化。");
    }
    if (Buffer.byteLength(serialized, "utf8") > projectPackageMaximumSessionBytes) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", "画布会话数据超过 16MB，无法安全导入或导出。");
    }
  }

  function estimatedBase64DecodedBytes(value) {
    const data = String(value || "");
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return -1;
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return (data.length / 4) * 3 - padding;
  }

  function validateProjectPackageData(packageData) {
    if (!packageData || typeof packageData !== "object" || Array.isArray(packageData)) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "画布文件格式无效。");
    }
    if (!projectPackageFormats.has(packageData.format) || ![1, 2, 3, 4].includes(Number(packageData.version))) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_UNSUPPORTED", "这不是受支持的 naimage 画布项目包。");
    }
    validateProjectPackageSessionShape(packageData.session, { version: packageData.version });
    const assets = Array.isArray(packageData.assets) ? packageData.assets : [];
    if (assets.length > projectPackageMaximumAssets) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", `项目包图片超过 ${projectPackageMaximumAssets} 张，无法安全导入。`);
    }
    let decodedBytes = 0;
    const unique = new Set();
    for (const asset of assets) {
      if (!asset || typeof asset !== "object") throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "项目包包含缺失数据的资产。");
      const source = asset[ASSET_SOURCE];
      const estimatedBytes = source ? (source.entry?.size ?? source.size) : estimatedBase64DecodedBytes(asset.data);
      const maxAssetBytes = Number(packageData.version) >= 4 ? projectPackageV4MaximumAssetBytes : projectPackageMaximumAssetBytes;
      if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes <= 0 || estimatedBytes > maxAssetBytes) {
        throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_ASSET_TOO_LARGE", `项目包中的单个资产无效或超过 ${maxAssetBytes / 1024 / 1024}MiB。`);
      }
      if (Number(packageData.version) >= 4 && (!/^[a-f0-9]{64}$/.test(asset.contentHash || "") ||
        asset.byteLength !== undefined && asset.byteLength !== estimatedBytes ||
        asset.packagePath !== undefined && asset.packagePath !== `assets/${asset.contentHash}`)) {
        throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "项目包资产清单中的哈希、大小或存储位置无效。");
      }
      const identity = Number(packageData.version) >= 4 ? asset.contentHash : asset;
      if (!unique.has(identity)) { decodedBytes += estimatedBytes; unique.add(identity); }
      const maxDecodedBytes = Number(packageData.version) >= 4 ? projectPackageV4MaximumDecodedBytes : projectPackageMaximumDecodedBytes;
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes > maxDecodedBytes) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", `项目包素材总量超过 ${maxDecodedBytes / 1024 / 1024}MiB。`);
    }
    let commerceCatalog = null;
    if (Number(packageData.version) >= 3 && Number(packageData.version) < 4) {
      commerceCatalog = typeof sanitizeCommerceCatalogDocument === "function"
        ? sanitizeCommerceCatalogDocument(packageData.commerceCatalog)
        : null;
      if (!commerceCatalog) {
        throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CATALOG_INVALID", "项目包缺少有效的 SKU 商品素材库。");
      }
      if (Buffer.byteLength(JSON.stringify(commerceCatalog), "utf8") > 4 * 1024 * 1024) {
        throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CATALOG_TOO_LARGE", "项目包中的 SKU 商品素材库超过 4MB。");
      }
    }
    if (Number(packageData.version) === 4 && packageData.commerceCatalog != null) {
      commerceCatalog = typeof sanitizeCommerceCatalogDocument === "function" ? sanitizeCommerceCatalogDocument(packageData.commerceCatalog) : null;
      if (!commerceCatalog || Buffer.byteLength(JSON.stringify(commerceCatalog)) > 4 * 1024 * 1024) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CATALOG_INVALID", "项目包中的商品资料无效或超过 4MiB。");
    }
    if (packageData.projectKnowledge != null) {
      if (typeof validatePortableProjectKnowledge !== "function") throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_KNOWLEDGE_UNSUPPORTED", "当前运行时不能导入此项目知识。");
      validatePortableProjectKnowledge(packageData.projectKnowledge);
    }
    return { assets, decodedBytes, commerceCatalog };
  }

  function validateProjectPackageImageBuffer(buffer, label) {
    const format = detectImageFormat(buffer);
    const dimensions = encodedImageDimensions(buffer);
    if (!format || !dimensions) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”不是真实的 PNG、JPEG 或 WebP。`);
    }
    assertSafeEncodedImageDimensions(buffer, label);
    const decoded = nativeImage.createFromBuffer(buffer);
    if (decoded.isEmpty()) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”已经损坏或无法解码。`);
    }
    const decodedSize = decoded.getSize();
    if (decodedSize.width !== dimensions.width || decodedSize.height !== dimensions.height) {
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”的尺寸信息不一致。`);
    }
    return { ...format, width: dimensions.width, height: dimensions.height };
  }

  function sourceForAsset(asset) {
    if (asset[ASSET_SOURCE]) return asset[ASSET_SOURCE];
    const data = String(asset.data || "");
    if (estimatedBase64DecodedBytes(data) <= 0) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", "项目包素材编码无效。");
    const buffer = Buffer.from(data, "base64");
    if (buffer.toString("base64") !== data) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_IMAGE_INVALID", "项目包素材编码无效。");
    return { buffer, size: buffer.length };
  }
  function inspectAsset(asset, { strictHash = true } = {}) {
    const source = sourceForAsset(asset), label = asset.fileName || "素材";
    let metadata;
    try { metadata = eachSourceChunk(source); }
    catch { throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CHECKSUM", `项目素材“${label}”读取或校验失败。`); }
    if (strictHash && metadata.contentHash !== String(asset.contentHash || "").toLowerCase()) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CHECKSUM", `项目素材“${label}”的 SHA-256 校验失败。`);
    let format;
    if (/^video\//i.test(asset.mimeType || "")) {
      const extension = path.extname(label).toLowerCase(), types = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
      const prefix = withSource(source, read => read(source.entry?.offset || 0, Math.min(64, metadata.byteLength)));
      const ftyp = prefix.indexOf(Buffer.from("ftyp"));
      if (!types[extension] || types[extension] !== asset.mimeType || (extension === ".webm" ? !prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : ftyp < 4 || ftyp > 56)) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_VIDEO_INVALID", `项目视频“${label}”的格式或文件头无效。`);
      format = { extension, mimeType: types[extension] };
    } else {
      if (metadata.byteLength > projectPackageMaximumAssetBytes) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_ASSET_TOO_LARGE", "单张项目图片超过 32MiB，无法安全解码验证。");
      format = validateProjectPackageImageBuffer(sourceBytes(source, projectPackageMaximumAssetBytes), label);
    }
    return { ...metadata, ...format, source };
  }
  function inspectedAssets(packageData) {
    const validation = validateProjectPackageData(packageData), bySource = new Map();
    return validation.assets.map(asset => {
      const source = asset[ASSET_SOURCE];
      const key = source ? `${source.path || "buffer"}:${source.identity || ""}:${source.entry?.offset || 0}:${source.entry?.size || source.size}` : asset;
      let checked = bySource.get(key);
      if (!checked) { checked = inspectAsset(asset, { strictHash: Number(packageData.version) >= 4 }); bySource.set(key, checked); }
      if (Number(packageData.version) >= 4 && checked.contentHash !== asset.contentHash) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CHECKSUM", "同一素材引用的哈希不一致。");
      return { asset, ...checked };
    });
  }
  function validatePortableRelations(packageData) {
    if (Number(packageData.version) < 4) return;
    const byKey = new Map();
    for (const asset of packageData.assets || []) {
      if (asset.packageAssetKey) {
        if (byKey.has(asset.packageAssetKey)) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "项目包包含重复的素材引用标识。");
        byKey.set(asset.packageAssetKey, asset);
      }
    }
    const findReference = reference => {
      if (reference.packageAssetKey) return byKey.get(reference.packageAssetKey);
      const matches = (packageData.assets || []).filter(asset => (reference.assetId && reference.assetId === asset.assetId &&
        (!reference.occurrenceId || reference.occurrenceId === asset.occurrenceId)) ||
        (reference.relativePath && reference.relativePath === asset.path));
      return matches.length && new Set(matches.map(asset => asset.contentHash)).size === 1 ? matches[0] : null;
    };
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (value.packageAssetKey || value.type === "file" || value.relativePath && value.fileName) {
        const asset = findReference(value);
        if (!asset || value.contentHash && value.contentHash !== asset.contentHash ||
          value.assetId && asset.assetId && value.assetId !== asset.assetId ||
          value.occurrenceId && asset.occurrenceId && value.occurrenceId !== asset.occurrenceId) {
          throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_MISSING_ASSET", "项目包中的画布、商品或知识关系指向缺失或不一致的素材。");
        }
      }
      for (const item of Object.values(value)) visit(item);
    };
    visit(packageData.session); visit(packageData.commerceCatalog); visit(packageData.projectKnowledge);
    for (const node of packageData.session.nodes || []) {
      if (node.type === "video" && (!node.videoAsset || !/^video\//.test(findReference(node.videoAsset)?.mimeType || ""))) {
        throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_VIDEO_INVALID", "项目包中的视频节点缺少已验证视频素材。");
      }
    }
  }
  function assertFreeSpace(target, bytes) {
    let existing = path.resolve(target);
    while (!existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; existing = parent; }
    try {
      const available = typeof availableBytesForPath === "function" ? availableBytesForPath(existing) : (() => { const stats = statfsSync(existing); return Number(stats.bavail) * Number(stats.bsize); })();
      if (!Number.isFinite(available) || available < bytes + 8 * 1024 * 1024) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_DISK_SPACE", "目标磁盘可用空间不足，项目包未写入。");
    } catch (error) {
      if (error.code === "NAIMAGE_PROJECT_PACKAGE_DISK_SPACE") throw error;
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_DISK_SPACE_UNAVAILABLE", "无法确认目标磁盘可用空间，项目包未写入。");
    }
  }
  function writeProjectPackageFile(filePath, packageData) {
    if (Number(packageData?.version) >= 4 || path.extname(String(filePath)).toLowerCase() === ".naimage") {
      const checked = inspectedAssets(packageData), unique = new Map();
      validatePortableRelations(packageData);
      const assets = checked.map(({ asset, source, ...metadata }) => {
        if (!unique.has(metadata.contentHash)) unique.set(metadata.contentHash, { source, metadata });
        const { data, ...portable } = asset;
        return { ...portableMetadata(portable), path: String(asset.path || asset.relativePath || ""), contentHash: metadata.contentHash, byteLength: metadata.byteLength, packagePath: `assets/${metadata.contentHash}` };
      });
      const sessionData = { ...portableMetadata(packageData.session), packageVersion: 4, pendingAgentExecution: null, projectTaskContexts: [] };
      const session = Buffer.from(JSON.stringify(sessionData));
      const knowledge = packageData.projectKnowledge == null ? null : Buffer.from(JSON.stringify(packageData.projectKnowledge));
      const manifest = { format: "naimage-project-package", version: 4, project: portableMetadata(packageData.project || {}),
        preset: packageData.preset || "archive", includeHistory: packageData.includeHistory !== false, assets,
        commerceCatalog: packageData.commerceCatalog || null, sessionSha256: createHash("sha256").update(session).digest("hex"),
        ...(knowledge ? { knowledgeSha256: createHash("sha256").update(knowledge).digest("hex") } : {}) };
      const manifestBytes = Buffer.from(JSON.stringify(manifest));
      if (manifestBytes.length > MAX_MANIFEST_BYTES || session.length > projectPackageMaximumSessionBytes || knowledge?.length > MAX_KNOWLEDGE_BYTES) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", "项目包元数据超过安全上限。");
      const entries = [{ name: "manifest.json", data: manifestBytes }, { name: "session.json", data: session }];
      if (knowledge) entries.push({ name: "knowledge.json", data: knowledge });
      for (const [hash, entry] of unique) entries.push({ name: `assets/${hash}`, ...entry });
      const estimated = entries.reduce((total, entry) => total + (entry.metadata?.byteLength || entry.data.length) + 2 * Buffer.byteLength(entry.name) + 76, 22);
      if (estimated > projectPackageV4MaximumFileBytes) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", "导出的 v4 项目包超过 2GiB。");
      assertFreeSpace(filePath, estimated);
      try { return { format: "naimage-project-package", version: 4, assets: assets.length, blobs: unique.size, ...writeStoredZip(filePath, entries, projectPackageV4MaximumFileBytes) }; }
      catch { throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_WRITE_FAILED", "项目包写入失败或导出期间素材发生变化；原文件已保留。"); }
    }
    validateProjectPackageData(packageData);
    const serialized = `${JSON.stringify(packageData)}\n`;
    if (Buffer.byteLength(serialized) > projectPackageMaximumFileBytes) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", "旧 JSON 项目包超过 192MiB。");
    assertFreeSpace(filePath, Buffer.byteLength(serialized));
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
    try { writeFileSync(temporary, serialized, { flag: "wx" }); renameSync(temporary, filePath); }
    finally { rmSync(temporary, { force: true }); }
    return { format: packageData.format, version: packageData.version, bytes: Buffer.byteLength(serialized) };
  }
  function readProjectPackageFile(input) {
    let source;
    try { source = Buffer.isBuffer(input) ? { buffer: input, size: input.length } : fileSource(String(input)); }
    catch { throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "项目包不存在、不可读取或超过 2GiB。"); }
    if (!source.size || source.size > projectPackageV4MaximumFileBytes) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", "项目包为空或超过 2GiB。");
    const signature = withSource(source, read => read(0, Math.min(source.size, 2)));
    if (signature.toString("hex") !== "504b") {
      if (source.size > projectPackageMaximumFileBytes) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_LARGE", "旧 JSON 项目包超过 192MiB。");
      let legacy; try { legacy = JSON.parse(sourceBytes(source, projectPackageMaximumFileBytes).toString("utf8")); }
      catch { throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "画布项目包不是有效的 JSON 文件。"); }
      validateProjectPackageData(legacy); return legacy;
    }
    try {
      const entries = readZipDirectory(source, projectPackageV4MaximumFileBytes);
      const jsonEntry = (name, maximum, expectedHash) => {
        const entry = entries.get(name);
        if (!entry || entry.size > maximum) throw new Error("package metadata missing or exceeds size limit");
        const dataSource = { ...source, entry }, metadata = eachSourceChunk(dataSource);
        if (expectedHash && metadata.contentHash !== expectedHash) throw new Error("package metadata checksum mismatch");
        return JSON.parse(sourceBytes(dataSource, maximum).toString("utf8"));
      };
      const manifest = jsonEntry("manifest.json", MAX_MANIFEST_BYTES);
      if (manifest.format !== "naimage-project-package" || manifest.version !== 4 || !/^[a-f0-9]{64}$/.test(manifest.sessionSha256 || "")) throw new Error("unsupported package manifest");
      const session = jsonEntry("session.json", projectPackageMaximumSessionBytes, manifest.sessionSha256);
      const knowledge = manifest.knowledgeSha256 ? jsonEntry("knowledge.json", MAX_KNOWLEDGE_BYTES, manifest.knowledgeSha256) : null;
      if (entries.has("knowledge.json") !== Boolean(manifest.knowledgeSha256)) throw new Error("undeclared project knowledge");
      const referenced = new Set(["manifest.json", "session.json", ...(knowledge ? ["knowledge.json"] : [])]);
      const assets = (Array.isArray(manifest.assets) ? manifest.assets : []).map(item => {
        const entry = entries.get(item.packagePath);
        if (!entry || !/^assets\/[a-f0-9]{64}$/.test(item.packagePath || "")) throw new Error("package asset missing");
        referenced.add(item.packagePath);
        const asset = { ...item }; Object.defineProperty(asset, ASSET_SOURCE, { value: { ...source, entry } }); return asset;
      });
      if (referenced.size !== entries.size) throw new Error("package contains undeclared entries");
      const result = { format: manifest.format, version: 4, project: manifest.project || {}, preset: manifest.preset,
        includeHistory: manifest.includeHistory, session: { ...session, pendingAgentExecution: null, projectTaskContexts: [] }, assets,
        commerceCatalog: manifest.commerceCatalog || null, projectKnowledge: knowledge };
      inspectedAssets(result); validatePortableRelations(result); return result;
    } catch (error) {
      if (String(error.code || "").startsWith("NAIMAGE_PROJECT_PACKAGE_")) throw error;
      throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_INVALID", "项目包结构、资产或校验无效；没有导入。");
    }
  }
  function packageProject(project, { preset = "archive", includeHistory = true } = {}) {
    if (!["share", "archive"].includes(preset)) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_PRESET_INVALID", "请选择分享或归档项目包。");
    includeHistory = preset === "archive" && includeHistory === true;
    const session = projectSessionFromDisk(project), projectPath = path.resolve(project.path), assets = [], inspectedByPath = new Map();
    const portableReference = (reference, nodeId = "", slot = "asset", index = 1) => {
      if (!reference || typeof reference !== "object") return reference;
      let candidate = reference.path;
      if (!candidate && reference.relativePath) candidate = resolveProjectRelativePath(projectPath, reference.relativePath);
      if (!candidate) return portableMetadata(reference);
      const controlledPath = controlledProjectAssetFile(candidate, projectPath);
      if (!controlledPath) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_MISSING_ASSET", `项目素材“${reference.fileName || reference.name || slot}”缺失或不在项目受管目录。`);
      const pathKey = comparablePath(controlledPath); let inspected = inspectedByPath.get(pathKey);
      if (!inspected) {
        const source = fileSource(controlledPath, projectPackageV4MaximumAssetBytes);
        const descriptor = { fileName: path.basename(controlledPath), mimeType: mimeTypeForPath(controlledPath) };
        Object.defineProperty(descriptor, ASSET_SOURCE, { value: source });
        inspected = inspectAsset(descriptor, { strictHash: false }); inspectedByPath.set(pathKey, inspected);
      }
      if (assets.length >= projectPackageMaximumAssets) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TOO_COMPLEX", "项目素材引用超过 1000 项。");
      const packageAssetKey = `pkg-${assets.length}-${createHash("sha256").update(`${nodeId}|${slot}`).digest("hex").slice(0, 16)}`;
      const relativePath = projectRelativePath(projectPath, controlledPath);
      const portable = { ...portableMetadata(reference), packageAssetKey, contentHash: inspected.contentHash,
        relativePath, fileName: path.basename(controlledPath), mimeType: inspected.mimeType };
      const descriptor = { ...portable, nodeId, index: reference.index || index, type: "file", path: relativePath,
        byteLength: inspected.byteLength, ...(slot.startsWith("message") ? { attachment: true } : {}) };
      Object.defineProperty(descriptor, ASSET_SOURCE, { value: inspected.source }); assets.push(descriptor);
      return portable;
    };
    const portableMessage = (message, messageIndex) => ({ ...portableMetadata(message), ...(message?.attachments ? { attachments: {
      ...portableMetadata(message.attachments),
      sourceAssets: (message.attachments.sourceAssets || []).map((asset, index) => portableReference(asset, asset.nodeId || "", `message-${messageIndex}-source-${index}`, index + 1)),
      referenceAssets: (message.attachments.referenceAssets || []).map((asset, index) => portableReference(asset, asset.nodeId || "", `message-${messageIndex}-reference-${index}`, index + 1))
    } } : {}) });
    const nodes = (session.nodes || []).map(node => ({ ...portableMetadata(node),
      assets: (node.assets || []).map((asset, index) => portableReference(asset, node.id, `asset-${index}`, index + 1)),
      ...(node.videoAsset ? { videoAsset: portableReference(node.videoAsset, node.id, "video") } : {}),
      ...(node.imageParams ? { imageParams: { ...portableMetadata(node.imageParams), referenceImages: (node.imageParams.referenceImages || []).map((asset, index) => portableReference(asset, node.id, `reference-${index}`, index + 1)) } } : {}),
      ...(node.layerGroup ? { layerGroup: { ...portableMetadata(node.layerGroup), previewAsset: portableReference(node.layerGroup.previewAsset, node.id, "group-preview"), mergedAsset: portableReference(node.layerGroup.mergedAsset, node.id, "group-merged") } } : {}),
      ...(node.layerComposition ? { layerComposition: { ...portableMetadata(node.layerComposition), previewAsset: portableReference(node.layerComposition.previewAsset, node.id, "preview"), mergedAsset: portableReference(node.layerComposition.mergedAsset, node.id, "merged"),
        layers: (node.layerComposition.layers || []).map((layer, index) => ({ ...portableMetadata(layer), asset: portableReference(layer.asset, node.id, `layer-${index}`, index + 1) })) } } : {}) }));
    let commerceCatalog = null;
    if (typeof readCommerceCatalog === "function") {
      const source = readCommerceCatalog(project);
      commerceCatalog = sanitizeCommerceCatalogDocument({ ...portableMetadata(source), products: (source.products || []).map(product => ({ ...portableMetadata(product), assets: (product.assets || []).map((link, index) => {
        const reference = portableReference({ ...link, path: resolveProjectRelativePath(projectPath, link.relativePath) }, link.nodeId || "", `catalog-${link.linkId || index}`, (link.assetIndex || 0) + 1);
        // The Catalog owner deliberately excludes package-only keys. It resolves
        // through exact occurrence/relative path after byte restoration.
        return { ...link, contentHash: reference.contentHash, relativePath: reference.relativePath, fileName: reference.fileName };
      }) })) });
      if (!commerceCatalog) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CATALOG_INVALID", "商品资料无法导出。");
    }
    let projectKnowledge = null;
    if (preset === "archive" && typeof exportProjectKnowledge === "function") {
      projectKnowledge = exportProjectKnowledge(project);
      if (projectKnowledge) projectKnowledge = { ...projectKnowledge, entries: projectKnowledge.entries.map(entry => ({ ...entry,
        assetRefs: entry.assetRefs.map((reference, index) => {
          const matches = (session.nodes || []).flatMap(node => (node.assets || []).map(asset => ({ node, asset }))).filter(({ asset }) =>
            asset.assetId === reference.assetId && asset.occurrenceId === reference.occurrenceId && asset.contentHash === reference.contentHash);
          if (matches.length !== 1) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_KNOWLEDGE_ASSET_MISSING", "知识基准素材缺失或身份不唯一，无法归档。");
          const portable = portableReference(matches[0].asset, matches[0].node.id, `knowledge-${entry.knowledgeId}-${index}`);
          return { ...reference, packageAssetKey: portable.packageAssetKey };
        }) })) };
    }
    const portableSession = { ...portableMetadata(session), packageVersion: 4, pendingAgentExecution: null, projectTaskContexts: [], nodes,
      messages: includeHistory ? (session.messages || []).map(portableMessage) : [],
      conversations: includeHistory ? (session.conversations || []).map(conversation => ({ ...portableMetadata(conversation), messages: (conversation.messages || []).map(portableMessage) })) : [],
      ...(!includeHistory ? { activeConversationId: "", conversationSummary: "", summary: "" } : {}) };
    const result = { format: "naimage-project-package", version: 4, preset, includeHistory, exportedAt: new Date().toISOString(),
      project: { name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt }, commerceCatalog, projectKnowledge, session: portableSession, assets };
    validateProjectPackageData(result); validatePortableRelations(result); return result;
  }

  function sessionFromPackage(packageData, targetProject) {
    validateProjectPackageData(packageData);
    const checkedAssets = inspectedAssets(packageData);
    validatePortableRelations(packageData);
    const projectPath = path.resolve(targetProject.path);
    assertFreeSpace(projectPath, uniqueByteLength(checkedAssets));
    const assetMap = new Map();
    const assetById = new Map();
    const assetByPackageKey = new Map();
    const assetByRelativePath = new Map();
    const ambiguousAssetIds = new Set();
    const ambiguousAssetMapKeys = new Set();
    const ambiguousPackageKeys = new Set();
    const ambiguousRelativePaths = new Set();
    const restoredByTargetPath = new Map();
    const restoredByHash = new Map();
    const existingTargetEntry = (filePath) => {
      const key = comparablePath(filePath);
      const known = restoredByTargetPath.get(key);
      if (known) return known;
      if (!existsSync(filePath)) return null;
      try {
        const stats = lstatSync(filePath);
        const contentHash = stats.isFile() && !stats.isSymbolicLink()
          ? eachSourceChunk(fileSource(filePath, projectPackageV4MaximumAssetBytes)).contentHash
          : `occupied:${stats.isDirectory() ? "directory" : "non-file"}`;
        const entry = { path: filePath, contentHash };
        restoredByTargetPath.set(key, entry);
        return entry;
      } catch {
        const entry = { path: filePath, contentHash: "occupied:unreadable" };
        restoredByTargetPath.set(key, entry);
        return entry;
      }
    };
    const packageRelativeLookupKey = (value) => String(value || "").trim().replace(/\\/g, "/").toLowerCase();
    const setUniqueAssetLookup = (lookup, ambiguous, key, value) => {
      const cleanKey = String(key || "").trim();
      if (!cleanKey || ambiguous.has(cleanKey)) return;
      const existing = lookup.get(cleanKey);
      if (existing && existing.contentHash !== value.contentHash) {
        lookup.delete(cleanKey);
        ambiguous.add(cleanKey);
        return;
      }
      lookup.set(cleanKey, value);
    };
    const restoredRecords = [];
    for (const checked of checkedAssets) {
      const { asset, source, contentHash } = checked;
      const relative = String(asset.path || path.join("output", "imagegen", asset.fileName || `asset-${contentHash.slice(0, 12)}.png`)).replace(/\\/g, "/");
      const isVideoAsset = /^video\//i.test(checked.mimeType);
      const imageFormat = checked;
      const declaredTarget = resolveProjectRelativePath(projectPath, relative);
      const allowedTarget = declaredTarget && projectWritableAssetRoots(projectPath).some((root) => (
        comparablePath(declaredTarget) !== comparablePath(root) && isComparablePathInside(declaredTarget, root)
      ));
      let targetPath = restoredByHash.get(contentHash)?.path || (allowedTarget
        ? declaredTarget
        : path.join(projectPath, isVideoAsset ? "output/video/imports" : "assets/package-imports", safeName(asset.fileName || path.basename(relative), `asset-${contentHash.slice(0, 12)}${imageFormat.extension}`)));
      if (path.extname(targetPath).toLowerCase() !== imageFormat.extension) {
        targetPath = path.join(path.dirname(targetPath), `${safeName(path.basename(targetPath, path.extname(targetPath)), "asset")}${imageFormat.extension}`);
      }
      let targetKey = comparablePath(targetPath);
      const existingTarget = existingTargetEntry(targetPath);
      if (existingTarget && existingTarget.contentHash !== contentHash) {
        const extension = path.extname(targetPath);
        const stem = safeName(path.basename(targetPath, extension), "asset");
        let attempt = 0;
        do {
          const suffix = attempt ? `${contentHash.slice(0, 12)}-${attempt}` : contentHash.slice(0, 12);
          targetPath = path.join(path.dirname(targetPath), `${stem}-${suffix}${extension}`);
          targetKey = comparablePath(targetPath);
          attempt += 1;
        } while (
          existingTargetEntry(targetPath) &&
          existingTargetEntry(targetPath).contentHash !== contentHash
        );
      }
      const reusableTarget = existingTargetEntry(targetPath);
      if (!reusableTarget) {
        // Lexical containment alone is insufficient when an existing managed
        // directory is a symlink/junction. Never follow it during extraction.
        let parent = path.dirname(targetPath);
        while (isComparablePathInside(parent, projectPath) || comparablePath(parent) === comparablePath(projectPath)) {
          if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_UNSAFE_TARGET", "导入目录包含链接，无法安全写入素材。");
          if (comparablePath(parent) === comparablePath(projectPath)) break;
          parent = path.dirname(parent);
        }
        mkdirSync(path.dirname(targetPath), { recursive: true });
        const temporaryTarget = path.join(path.dirname(targetPath), `.naimage-package-${randomBytes(8).toString("hex")}.tmp`);
        let fd;
        try {
          fd = openSync(temporaryTarget, "wx");
          const copied = eachSourceChunk(source, chunk => writeAll(fd, chunk));
          if (copied.contentHash !== contentHash || copied.byteLength !== checked.byteLength) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CHECKSUM", "导入期间素材内容发生变化，已停止。");
          fsyncSync(fd); closeSync(fd); fd = undefined;
          if (existsSync(targetPath)) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TARGET_CHANGED", "导入期间目标文件发生变化，原文件已保留。");
          renameSync(temporaryTarget, targetPath);
        } finally {
          if (fd !== undefined) closeSync(fd);
          rmSync(temporaryTarget, { force: true });
        }
        targetKey = comparablePath(targetPath);
        restoredByTargetPath.set(targetKey, { path: targetPath, contentHash });
      } else {
        targetPath = reusableTarget.path;
      }
      restoredByHash.set(contentHash, { path: targetPath });
      const declaredHash = String(asset.contentHash || "").trim().toLowerCase();
      if (declaredHash && declaredHash !== contentHash) {
        log(`project package content hash corrected ${relative}`);
      }
      const key = `${asset.nodeId || ""}:${asset.index || ""}:${asset.runId || ""}`;
      const restoredAsset = {
        assetId: asset.assetId || "",
        displayCode: asset.displayCode || "",
        contentHash,
        index: Number(asset.index || 1),
        type: "file",
        path: targetPath,
        relativePath: projectRelativePath(projectPath, targetPath),
        fileName: path.basename(targetPath),
        assetUrl: assetUrlFor(targetPath),
        runId: asset.runId || "",
        revisedPrompt: asset.revisedPrompt || "",
        mimeType: checked.mimeType
      };
      restoredRecords.push({ original: asset, restored: restoredAsset });
      setUniqueAssetLookup(assetMap, ambiguousAssetMapKeys, key, restoredAsset);
      setUniqueAssetLookup(assetById, ambiguousAssetIds, restoredAsset.assetId, restoredAsset);
      setUniqueAssetLookup(assetByPackageKey, ambiguousPackageKeys, asset.packageAssetKey, restoredAsset);
      setUniqueAssetLookup(assetByRelativePath, ambiguousRelativePaths, packageRelativeLookupKey(relative), restoredAsset);
    }

    const packageAssetForReference = (reference, fallbackKey = "") => {
      if (!reference || typeof reference !== "object") return null;
      const portablePath = reference.relativePath || (
        typeof reference.path === "string" && !path.isAbsolute(reference.path) ? reference.path : ""
      );
      if (Number(packageData.version) >= 4 && reference.packageAssetKey) return assetByPackageKey.get(String(reference.packageAssetKey)) || null;
      return (reference.packageAssetKey ? assetByPackageKey.get(String(reference.packageAssetKey)) : null) ||
        (reference.assetId ? assetById.get(String(reference.assetId)) : null) ||
        (fallbackKey ? assetMap.get(fallbackKey) : null) ||
        (portablePath ? assetByRelativePath.get(packageRelativeLookupKey(portablePath)) : null) ||
        null;
    };
    const restoredForReference = (reference) => {
      if (!reference || typeof reference !== "object") return reference;
      const restored = packageAssetForReference(reference);
      if (!restored) {
        if (Number(packageData.version) >= 4 && (reference.packageAssetKey || reference.relativePath || reference.path || reference.type === "file")) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_MISSING_ASSET", "项目包中的素材关系指向缺失或不明确的资产。");
        const next = portableMetadata(reference);
        delete next.contentHash;
        delete next.sha256;
        return next;
      }
      const next = { ...reference, ...restored };
      delete next.packageAssetKey;
      return next;
    };
    const preparePackageMessage = (message) => {
      if (!message || typeof message !== "object" || !message.attachments) return message;
      return {
        ...portableMetadata(message),
        attachments: {
          ...portableMetadata(message.attachments),
          sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(restoredForReference) : [],
          referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(restoredForReference) : []
        }
      };
    };
    const portableSession = packageData?.session && typeof packageData.session === "object" ? packageData.session : defaultSession;
    const preparedSession = {
      ...portableMetadata(portableSession),
      pendingAgentExecution: null,
      projectTaskContexts: [],
      nodes: (Array.isArray(portableSession.nodes) ? portableSession.nodes : []).map((node) => ({
        ...portableMetadata(node),
        ...(node?.videoAsset ? { videoAsset: restoredForReference(node.videoAsset) } : {}),
        assets: (Array.isArray(node?.assets) ? node.assets : []).map((asset) => {
          const key = `${node?.id || ""}:${asset?.index || ""}:${asset?.runId || ""}`;
          const restored = packageAssetForReference(asset, key);
          return restored ? restoredForReference({ ...asset, ...restored }) : restoredForReference(asset);
        }),
        imageParams: node?.imageParams ? {
          ...portableMetadata(node.imageParams),
          referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : []
        } : node?.imageParams,
        layerGroup: node?.layerGroup ? {
          ...portableMetadata(node.layerGroup),
          previewAsset: restoredForReference(node.layerGroup.previewAsset),
          mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
        } : node?.layerGroup,
        layerComposition: node?.layerComposition ? {
          ...portableMetadata(node.layerComposition),
          previewAsset: restoredForReference(node.layerComposition.previewAsset),
          mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
          layers: Array.isArray(node.layerComposition.layers)
            ? node.layerComposition.layers.map((layer) => ({ ...layer, asset: restoredForReference(layer?.asset) }))
            : []
        } : node?.layerComposition
      })),
      messages: Array.isArray(portableSession.messages) ? portableSession.messages.map(preparePackageMessage) : [],
      conversations: Array.isArray(portableSession.conversations)
        ? portableSession.conversations.map((conversation) => ({
            ...portableMetadata(conversation),
            messages: Array.isArray(conversation?.messages) ? conversation.messages.map(preparePackageMessage) : []
          }))
        : []
    };
    // The first identity reconciliation must only see hashes derived from the
    // decoded package bytes. Package/session metadata is untrusted and may be
    // stale, corrupt, or deliberately forged.
    const rawSession = sanitizeSession(preparedSession);
    const importedIndex = buildProjectAssetIndex(projectPath);
    const nodes = rawSession.nodes.map((node) => {
      const assets = (node.assets || []).map((asset) => {
        const key = `${node.id}:${asset.index || ""}:${asset.runId || ""}`;
        const restored = (asset.packageAssetKey ? assetByPackageKey.get(asset.packageAssetKey) : null) ||
          (asset.assetId ? assetById.get(asset.assetId) : null) ||
          assetMap.get(key);
        if (!restored) return hydrateAssetForProject(asset, targetProject, importedIndex);
        const next = { ...asset, ...restored };
        delete next.packageAssetKey;
        return next;
      }).filter(Boolean);
      if (!assets.length && node.type !== "video") {
        for (const [key, value] of assetMap.entries()) {
          if (key.startsWith(`${node.id}:`)) assets.push(value);
        }
      }
      return {
        ...node,
        assets,
        imageParams: node.imageParams ? {
          ...portableMetadata(node.imageParams),
          referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : []
        } : node.imageParams,
        layerGroup: node.layerGroup ? {
          ...portableMetadata(node.layerGroup),
          previewAsset: restoredForReference(node.layerGroup.previewAsset),
          mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
        } : node.layerGroup,
        layerComposition: node.layerComposition ? {
          ...portableMetadata(node.layerComposition),
          previewAsset: restoredForReference(node.layerComposition.previewAsset),
          mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
          layers: Array.isArray(node.layerComposition.layers)
            ? node.layerComposition.layers.map((layer) => ({ ...layer, asset: restoredForReference(layer.asset) }))
            : []
        } : node.layerComposition,
        imageState: node.type === "image" && assets.length ? "done" : node.imageState,
        status: node.type === "image" && assets.length ? "done" : node.status,
        outputs: Math.max(Number(node.outputs || 0), assets.length)
      };
    });
    const rewriteAttachment = (attachment) => {
      if (!attachment || typeof attachment !== "object") return attachment;
      const restored = restoredForReference(attachment);
      if (restored === attachment) return attachment;
      return {
        ...restored,
        path: restored.path,
        assetUrl: restored.assetUrl,
        mimeType: attachment.mimeType || mimeTypeForPath(restored.path),
        name: attachment.name || restored.fileName
      };
    };
    const rewriteMessage = (message) => {
      if (!message || typeof message !== "object" || !message.attachments) return message;
      return {
        ...message,
        attachments: {
          ...message.attachments,
          sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(rewriteAttachment) : [],
          referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(rewriteAttachment) : []
        }
      };
    };
    const messages = Array.isArray(rawSession.messages) ? rawSession.messages.map(rewriteMessage) : [];
    const conversations = Array.isArray(rawSession.conversations)
      ? rawSession.conversations.map((conversation) => ({ ...conversation, messages: Array.isArray(conversation.messages) ? conversation.messages.map(rewriteMessage) : [] }))
      : [];
    const result = sanitizeSession({ ...rawSession, nodes, messages, conversations, pendingAgentExecution: null, projectTaskContexts: [] });
    Object.defineProperty(result, RESTORED_ASSETS, { value: { records: restoredRecords, resolve: packageAssetForReference } });
    return result;
  }

  function importProjectPackage(packageData, targetPath) {
    const packageValidation = validateProjectPackageData(packageData);
    // Complete every byte/image/relationship check and the disk preflight before
    // creating the new project's authoritative files. Partial imports remain
    // private to this newly created directory and are removed on failure.
    const checked = inspectedAssets(packageData);
    validatePortableRelations(packageData);
    targetPath = path.resolve(targetPath);
    if (existsSync(targetPath)) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_TARGET_EXISTS", "导入目标目录已经存在，请选择新的项目目录。");
    assertFreeSpace(targetPath, uniqueByteLength(checked) + projectPackageMaximumSessionBytes);
    const name = safeName(packageData.project?.name || path.basename(targetPath), "导入画布");
    let record;
    try {
      record = createProjectRecord(name, targetPath);
      if (!record?.id || record.id === packageData.project?.id) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_IDENTITY_INVALID", "导入项目必须获得新的项目身份。");
      const session = sessionFromPackage(packageData, record), restored = session[RESTORED_ASSETS];
      let importedCatalog = null;
      if (packageValidation.commerceCatalog && typeof writeCommerceCatalog === "function") {
        importedCatalog = sanitizeCommerceCatalogDocument({ ...packageValidation.commerceCatalog,
          catalogId: `catalog-${randomBytes(16).toString("hex")}`,
          products: packageValidation.commerceCatalog.products.map(product => ({ ...product,
            assets: product.assets.map(link => {
              const matches = restored.records.filter(({ original }) =>
                (link.assetId && original.assetId === link.assetId && (!link.occurrenceId || !original.occurrenceId || original.occurrenceId === link.occurrenceId)) ||
                String(original.path || "").replace(/\\/g, "/").toLowerCase() === String(link.relativePath || "").replace(/\\/g, "/").toLowerCase());
              const exact = matches.find(({ original }) => original.contentHash === link.contentHash && (!link.occurrenceId || original.occurrenceId === link.occurrenceId)) || matches[0];
              if (!exact) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CATALOG_ASSET_MISSING", "商品素材不在项目包中，导入已取消。");
              return { ...link, assetId: exact.restored.assetId || link.assetId, contentHash: exact.restored.contentHash,
                relativePath: exact.restored.relativePath, fileName: exact.restored.fileName };
            }) })) });
        if (!importedCatalog) throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_CATALOG_INVALID", "导入的商品素材关系无效。");
        writeCommerceCatalog(record, importedCatalog);
      }
      // Session persistence precedes knowledge-owner validation so adopted style
      // references resolve against the same imported canvas/catalog.
      writeJson(record.sessionPath, sessionForProjectSave(session, record));
      writeProjectManifest(record, session);
      if (packageData.projectKnowledge != null) {
        if (typeof importProjectKnowledge !== "function") throw projectPackageFailure("NAIMAGE_PROJECT_PACKAGE_KNOWLEDGE_UNSUPPORTED", "当前运行时不能导入项目知识。");
        importProjectKnowledge(record, packageData.projectKnowledge, { session, commerceCatalog: importedCatalog,
          resolveAsset: reference => {
            const asset = restored.resolve(reference);
            return asset ? { assetId: asset.assetId, occurrenceId: reference.occurrenceId, contentHash: asset.contentHash } : null;
          } });
      }
      return { record, session: projectSessionFromDisk(record) };
    } catch (error) {
      if (record && path.resolve(record.path) === targetPath && targetPath !== path.parse(targetPath).root) rmSync(targetPath, { recursive: true, force: true });
      throw error;
    }
  }

  return {
    owner: PROJECT_PACKAGE_SERVICE_OWNER,
    estimatedBase64DecodedBytes,
    importProjectPackage,
    packageProject,
    projectPackageFailure,
    readProjectPackageFile,
    sessionFromPackage,
    validateProjectPackageData,
    validateProjectPackageImageBuffer,
    validateProjectPackageSessionShape,
    writeProjectPackageFile
  };
}

module.exports = {
  createProjectPackageService,
  PROJECT_PACKAGE_SERVICE_OWNER,
  projectPackageMaximumAssetBytes,
  projectPackageMaximumAssets,
  projectPackageMaximumConversations,
  projectPackageMaximumDecodedBytes,
  projectPackageMaximumFileBytes,
  projectPackageMaximumMessages,
  projectPackageMaximumNodes,
  projectPackageMaximumSessionBytes,
  projectPackageV4MaximumAssetBytes,
  projectPackageV4MaximumDecodedBytes,
  projectPackageV4MaximumFileBytes,
  writeStreamingZip
};
