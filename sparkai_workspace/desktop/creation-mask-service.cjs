"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { normalizeCreationTarget } = require("./project-creation-service.cjs");

const MAX_MASK_BYTES = 20 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const sameTarget = (left, right) => ["assetId", "occurrenceId", "contentHash"].every(key => left?.[key] === right?.[key]);
const pngSize = bytes => {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw fail("CREATION_MASK_INVALID", "区域修改蒙版必须是有效 PNG。");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

/** Managed masks are private project materials, never canvas results or references. */
function createCreationMaskService({ projectFor, readSession, sourceFor, projectRelativePath, resolveProjectRelativePath, sharp, metaDir = ".naimage" } = {}) {
  if (![projectFor, readSession, projectRelativePath, resolveProjectRelativePath, sharp].every(value => typeof value === "function")) throw new TypeError("creation mask project services are required");
  function projectOf(input) {
    const project = projectFor(input.expectedProjectId || input.projectId);
    if (!project?.id || !project.path) throw fail("PROJECT_NOT_FOUND", "蒙版所属项目不存在。");
    if (!/^[\p{L}\p{N}_.:@-]{1,180}$/u.test(String(input.conversationId || ""))) throw fail("CREATION_MASK_INVALID", "蒙版需要明确所属会话。");
    const session = readSession(project.id);
    if (!(session?.conversations || []).some(value => value.id === input.conversationId)) throw fail("CREATION_MASK_SCOPE_INVALID", "蒙版所属会话不存在。");
    return project;
  }
  const directory = project => path.join(project.path, metaDir, "creation-masks");
  const registryPath = project => path.join(directory(project), "manifest.json");
  function managedPath(project, relativePath, { maximum = MAX_MASK_BYTES, directoryOnly = false } = {}) {
    try {
      const candidate = resolveProjectRelativePath(project.path, relativePath);
      if (!candidate) throw Error();
      const root = fs.realpathSync(project.path), relative = path.relative(root, path.resolve(candidate));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error();
      let current = root;
      for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw Error();
      }
      const actual = path.relative(root, fs.realpathSync(candidate)), stat = fs.lstatSync(candidate);
      if (!actual || actual.startsWith("..") || path.isAbsolute(actual) || (directoryOnly ? !stat.isDirectory() : !stat.isFile() || stat.size < 1 || stat.size > maximum)) throw Error();
      return candidate;
    } catch { throw fail("CREATION_MASK_FILE_UNAVAILABLE", "蒙版或来源文件不属于当前受管项目，未执行修改。"); }
  }
  function ensureDirectory(project) {
    let current = fs.realpathSync(project.path);
    const relative = path.relative(project.path, directory(project));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw fail("CREATION_MASK_FILE_UNAVAILABLE", "蒙版目录不可用。");
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) fs.mkdirSync(current);
      if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink()) throw fail("CREATION_MASK_FILE_UNAVAILABLE", "蒙版目录不可用。");
    }
  }
  function read(project) {
    if (!fs.existsSync(registryPath(project))) return { schemaVersion: 1, masks: [] };
    try {
      const file = managedPath(project, projectRelativePath(project.path, registryPath(project)), { maximum: 8 * 1024 * 1024 });
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value.schemaVersion !== 1 || !Array.isArray(value.masks) || value.masks.length > 2000) throw Error();
      for (const record of value.masks) {
        normalizeCreationTarget(record.mask); normalizeCreationTarget(record.target);
        if (!record.conversationId || !Number.isSafeInteger(record.width) || record.width < 1 || !Number.isSafeInteger(record.height) || record.height < 1 ||
          record.relativePath !== `${metaDir}/creation-masks/${record.mask.assetId}.png` ||
          record.revision !== undefined && (!Number.isSafeInteger(record.revision) || record.revision < 1)) throw Error();
        // v1 masks predate revisions. Their immutable file/identity is revision 1.
        record.revision ??= 1;
      }
      if (new Set(value.masks.map(record => record.mask.assetId)).size !== value.masks.length ||
        new Set(value.masks.map(record => record.mask.occurrenceId)).size !== value.masks.length) throw Error();
      return value;
    } catch { throw fail("CREATION_MASK_STORE_INVALID", "蒙版记录无法安全读取，未执行修改。"); }
  }
  function targetFile(project, target) {
    const matches = (readSession(project.id)?.nodes || []).filter(node => node.type === "image").flatMap(node => node.assets || []).filter(asset => sameTarget(asset, target));
    if (matches.length > 1) throw fail("CREATION_TARGET_STALE", "所选成果身份不唯一，请重新选择。");
    const found = matches[0] || sourceFor?.(project, target);
    if (!found || ["pending", "error"].includes(found.status)) throw fail("CREATION_TARGET_STALE", "所选成果已变化或尚未保存，请重新选择。");
    const relative = String(found.relativePath || projectRelativePath(project.path, found.path)).replace(/\\/g, "/");
    if (!/^(?:assets\/|output\/(?:imagegen|post)\/|\.naimage\/assets\/)/.test(relative)) throw fail("CREATION_TARGET_STALE", "所选成果不属于项目图片库。");
    const file = managedPath(project, relative, { maximum: 128 * 1024 * 1024 }), bytes = fs.readFileSync(file);
    if (digest(bytes) !== target.contentHash) throw fail("CREATION_TARGET_STALE", "所选成果的内容已变化，请重新选择。");
    return bytes;
  }
  async function save(input = {}) {
    const project = projectOf(input), target = normalizeCreationTarget(input.target);
    const dataUrl = String(input.dataUrl || ""), encoded = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!encoded || dataUrl.length > Math.ceil(MAX_MASK_BYTES / 3) * 4 + 32) throw fail("CREATION_MASK_INVALID", "请提供有效且不超过 20 MB 的 PNG 蒙版。");
    const bytes = Buffer.from(encoded[1], "base64");
    if (!bytes.length || bytes.length > MAX_MASK_BYTES || bytes.toString("base64") !== encoded[1]) throw fail("CREATION_MASK_INVALID", "PNG 蒙版内容无效。");
    let source, decoded, normalized;
    try {
      pngSize(bytes);
      source = await sharp(targetFile(project, target), { failOn: "warning", limitInputPixels: 64_000_000 }).metadata();
      decoded = await sharp(bytes, { failOn: "warning", limitInputPixels: 64_000_000 }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (decoded.info.width !== source.width || decoded.info.height !== source.height) throw fail("CREATION_MASK_SIZE_MISMATCH", "蒙版必须与所选原图的像素尺寸完全一致。");
      let editedPixels = 0;
      for (let index = 3; index < decoded.data.length; index += 4) if (decoded.data[index] < 255) editedPixels++;
      if (editedPixels < 24) throw fail("CREATION_MASK_EMPTY", "请先涂抹需要修改的区域。");
      normalized = await sharp(decoded.data, { raw: decoded.info }).png().toBuffer();
      if (normalized.length > MAX_MASK_BYTES) throw fail("CREATION_MASK_INVALID", "PNG 蒙版超过本地大小限制。");
    } catch (error) {
      if (String(error?.code || "").startsWith("CREATION_")) throw error;
      throw fail("CREATION_MASK_INVALID", "蒙版或所选图片无法完整解码。");
    }
    // Recheck the target after asynchronous image decoding, before persistence.
    targetFile(project, target);
    ensureDirectory(project);
    const document = read(project);
    if (document.masks.length >= 2000) throw fail("CREATION_MASK_CAPACITY", "项目蒙版已达到本地容量上限。");
    const mask = { assetId: `mask-${randomUUID()}`, occurrenceId: `occ-${randomUUID()}`, contentHash: digest(normalized) };
    const relativePath = `${metaDir}/creation-masks/${mask.assetId}.png`;
    const file = resolveProjectRelativePath(project.path, relativePath);
    const revision = 1 + document.masks.filter(record => record.conversationId === input.conversationId && sameTarget(record.target, target))
      .reduce((latest, record) => Math.max(latest, record.revision), 0);
    if (!Number.isSafeInteger(revision)) throw fail("CREATION_MASK_CAPACITY", "蒙版修订已达到本地容量上限。");
    const record = { mask, target, revision, conversationId: input.conversationId, relativePath, width: source.width, height: source.height, createdAt: new Date().toISOString() };
    fs.writeFileSync(file, normalized, { flag: "wx" });
    document.masks.push(record);
    const temporary = path.join(directory(project), `manifest-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(document), { flag: "wx" });
      fs.renameSync(temporary, registryPath(project));
    } catch {
      try { fs.rmSync(temporary, { force: true }); fs.rmSync(file, { force: true }); } catch {}
      throw fail("CREATION_MASK_SAVE_FAILED", "蒙版保存失败，尚未启动修改任务。");
    }
    return { mask, revision, width: source.width, height: source.height, sourceImage: { ...target } };
  }
  function resolve(input = {}) {
    const project = projectOf(input), target = normalizeCreationTarget(input.target), mask = normalizeCreationTarget(input.mask);
    if (Object.keys(input.mask || {}).some(key => !["assetId", "occurrenceId", "contentHash", "revision"].includes(key))) throw fail("CREATION_MASK_INVALID", "蒙版只能通过项目托管身份引用。");
    const revision = input.revision ?? input.mask?.revision;
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1) ||
      input.revision !== undefined && input.mask?.revision !== undefined && input.revision !== input.mask.revision) throw fail("CREATION_MASK_REVISION_INVALID", "蒙版修订标识无效。");
    const found = read(project).masks.find(record => sameTarget(record.mask, mask));
    if (!found || found.conversationId !== input.conversationId || !sameTarget(found.target, target)) throw fail("CREATION_MASK_IDENTITY_INVALID", "蒙版不属于所选成果或当前会话，未执行修改。");
    if (revision !== undefined && revision !== found.revision) throw fail("CREATION_MASK_REVISION_INVALID", "蒙版修订与已保存记录不一致。");
    const file = managedPath(project, found.relativePath), bytes = fs.readFileSync(file), dimensions = pngSize(bytes);
    if (digest(bytes) !== mask.contentHash || dimensions.width !== found.width || dimensions.height !== found.height) throw fail("CREATION_MASK_STALE", "蒙版文件已变化，未执行修改。");
    targetFile(project, target);
    return { ...mask, revision: found.revision, target, path: file, relativePath: found.relativePath, mimeType: "image/png", name: "区域修改蒙版", width: found.width, height: found.height };
  }
  function list(input = {}) {
    const project = projectOf(input), target = normalizeCreationTarget(input.target || input.sourceImage);
    targetFile(project, target);
    return read(project).masks.filter(record => record.conversationId === input.conversationId && sameTarget(record.target, target)).map(record => {
      const material = resolve({ ...input, target, mask: record.mask, revision: record.revision });
      return { ...record.mask, revision: record.revision, width: material.width, height: material.height, sourceImage: { ...target } };
    });
  }
  function freeze(input = {}) {
    const targets = Array.isArray(input.targets) ? input.targets : [];
    const masked = targets.filter(target => target?.mask !== undefined);
    if (!masked.length) return [];
    if (targets.length !== 1 || masked.length !== 1) throw fail("CREATION_MASK_SINGLE_TARGET", "精确区域修改一次只能选择一个成果。");
    return [resolve({ ...input, target: masked[0], mask: masked[0].mask })];
  }
  return { save, resolve, freeze, list };
}

module.exports = { createCreationMaskService };
