"use strict";

// Main-only installation declaration. No command, environment, script, URL
// credential or self-asserted trust field is part of this format.
const { createHash, verify } = require("node:crypto");
const net = require("node:net");

const MANAGED_ARTIFACT_POLICY_VERSION = 1;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const ARTIFACT_KINDS = Object.freeze(["runtime", "model", "dependency", "custom-node"]);
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

function exact(value, fields, name) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key))) {
    throw fail("MANAGED_MANIFEST_FIELDS_INVALID", `${name}包含不支持的字段。`);
  }
}
function text(value, name, limit = 160) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw fail("MANAGED_MANIFEST_VALUE_INVALID", `${name}无效。`);
  }
  return value;
}
function identifier(value, name) {
  if (typeof value !== "string" || !ID.test(value)) throw fail("MANAGED_MANIFEST_ID_INVALID", `${name}标识无效。`);
  return value;
}
function bytes(value, name, zero = false) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw fail("MANAGED_MANIFEST_SIZE_INVALID", `${name}必须是精确字节数。`);
  return value;
}
function safeTotal(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw fail("MANAGED_MANIFEST_SIZE_INVALID", "安装声明的合计大小无效。");
  return total;
}
function list(value, choices, name) {
  if (!Array.isArray(value) || !value.length || value.length > choices.length || new Set(value).size !== value.length || value.some(item => !choices.includes(item))) {
    throw fail("MANAGED_MANIFEST_VALUE_INVALID", `${name}无效。`);
  }
  return [...value].sort();
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function canonicalManagedArtifactValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalManagedArtifactValue).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalManagedArtifactValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hashManagedArtifactValue(value) {
  return createHash("sha256").update(canonicalManagedArtifactValue(value)).digest("hex");
}
function normalizeManagedArtifactUrl(value, { allowLoopbackForTests = false } = {}) {
  text(value, "制品来源", 2048);
  if (/[\u0000-\u0020\u007f\\]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) throw fail("MANAGED_ARTIFACT_URL_INVALID", "制品地址包含不安全的路径。");
  let url;
  try { url = new URL(value); } catch { throw fail("MANAGED_ARTIFACT_URL_INVALID", "制品地址无效。"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "::1" || net.isIP(hostname) === 4 && hostname.startsWith("127.");
  if (url.username || url.password || url.search || url.hash || !hostname || hostname.endsWith(".") || hostname.includes("%")) throw fail("MANAGED_ARTIFACT_URL_INVALID", "制品地址不能携带凭据、查询参数或片段。");
  if (url.protocol !== "https:" && !(allowLoopbackForTests && loopback && url.protocol === "http:")) throw fail("MANAGED_ARTIFACT_HTTPS_REQUIRED", "制品下载必须使用 HTTPS。");
  const rawPath = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  if (rawPath.split("/").some(part => part === "." || part === "..") || url.pathname.includes("\\")) throw fail("MANAGED_ARTIFACT_URL_INVALID", "制品地址路径无效。");
  return url.toString();
}
function normalizeManagedArtifactRelativePath(value, { allowRoot = false } = {}) {
  if (allowRoot && value === ".") return value;
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\\") || value.startsWith("/") || value.endsWith("/") || value.includes(":")) throw fail("MANAGED_ARTIFACT_PATH_INVALID", "制品目标必须是受控相对路径。");
  if (value.split("/").some(part => !part || part === "." || part === ".." || part.length > 100 || /[<>:"|?*\u0000-\u001f\u007f]/.test(part) || /[ .]$/.test(part) || DEVICE.test(part))) throw fail("MANAGED_ARTIFACT_PATH_INVALID", "制品目标包含无效路径段。");
  return value;
}
function normalizeLicense(value) {
  exact(value, ["id", "url"], "许可声明");
  return { id: text(value.id, "许可名称", 160), url: normalizeManagedArtifactUrl(value.url) };
}
function normalizeComponent(value) {
  exact(value, ["name", "version", "license"], "组件声明");
  return { name: text(value.name, "组件名称"), version: text(value.version, "组件版本", 80), license: normalizeLicense(value.license) };
}
function normalizeManagedArtifactDescriptor(raw, options = {}) {
  exact(raw, ["id", "kind", "format", "filename", "bytes", "expandedBytes", "sha256", "url", "license", "components", "dependencies", "destination", "modelType"], "制品声明");
  const id = identifier(raw.id, "制品");
  if (!ARTIFACT_KINDS.includes(raw.kind) || !["7z", "zip", "file"].includes(raw.format)) throw fail("MANAGED_MANIFEST_ARTIFACT_INVALID", "制品类型或格式无效。");
  const filename = normalizeManagedArtifactRelativePath(raw.filename);
  if (filename.includes("/")) throw fail("MANAGED_ARTIFACT_PATH_INVALID", "制品文件名不能包含目录。");
  const size = bytes(raw.bytes, "制品大小"), expandedBytes = bytes(raw.expandedBytes, "制品展开大小");
  if (raw.format === "file" && size !== expandedBytes || raw.format !== "file" && expandedBytes < 1) throw fail("MANAGED_MANIFEST_SIZE_INVALID", "制品展开大小与格式不符。");
  if (typeof raw.sha256 !== "string" || !HASH.test(raw.sha256)) throw fail("MANAGED_MANIFEST_HASH_INVALID", "制品必须声明精确 SHA-256。");
  if (raw.format !== "file" && !filename.toLowerCase().endsWith(`.${raw.format}`)) throw fail("MANAGED_MANIFEST_ARTIFACT_INVALID", "归档格式与文件名不符。");
  if (raw.kind === "runtime" && raw.format === "file") throw fail("MANAGED_MANIFEST_ARTIFACT_INVALID", "portable runtime 必须声明归档。");
  const modelDestinations = { checkpoint: "checkpoints", vae: "vae", lora: "loras" };
  if (raw.kind === "model" && (raw.format !== "file" || !Object.hasOwn(modelDestinations, raw.modelType) || !filename.toLowerCase().endsWith(".safetensors") || raw.destination !== modelDestinations[raw.modelType])) throw fail("MANAGED_MANIFEST_MODEL_INVALID", "模型只允许 safetensors 与对应的受控模型目录。");
  if (raw.kind !== "model" && raw.modelType !== undefined) throw fail("MANAGED_MANIFEST_MODEL_INVALID", "非模型制品不能声明 modelType。");
  const destination = normalizeManagedArtifactRelativePath(raw.destination, { allowRoot: raw.kind === "runtime" });
  const targetsCustomNodes = destination.split("/").some(part => part.toLowerCase() === "custom_nodes");
  if (raw.kind === "custom-node" ? !/^ComfyUI\/custom_nodes\/[^/]+$/.test(destination) : targetsCustomNodes) throw fail("MANAGED_MANIFEST_CUSTOM_NODE_DESTINATION", "自定义节点必须显式声明为 custom-node，并使用独立的 ComfyUI/custom_nodes 包目录。");
  if (!Array.isArray(raw.dependencies) || raw.dependencies.length > 128 || new Set(raw.dependencies).size !== raw.dependencies.length) throw fail("MANAGED_MANIFEST_DEPENDENCY_INVALID", "制品依赖无效。");
  const dependencies = raw.dependencies.map(value => identifier(value, "依赖")).sort();
  if (!Array.isArray(raw.components) || raw.components.length < 1 || raw.components.length > 512) throw fail("MANAGED_MANIFEST_COMPONENTS_REQUIRED", "制品必须声明版本固定的组件与许可。");
  const components = raw.components.map(normalizeComponent).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (new Set(components.map(item => item.name.toLowerCase())).size !== components.length) throw fail("MANAGED_MANIFEST_COMPONENTS_REQUIRED", "组件声明不能重复。");
  return {
    id, kind: raw.kind, format: raw.format, filename, bytes: size, expandedBytes, sha256: raw.sha256,
    url: normalizeManagedArtifactUrl(raw.url, options), license: normalizeLicense(raw.license), components, dependencies,
    destination,
    ...(raw.kind === "model" ? { modelType: raw.modelType } : {})
  };
}
function normalizeSignature(value) {
  exact(value, ["algorithm", "keyId", "value"], "签名");
  if (value.algorithm !== "ed25519" || typeof value.value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.value) || Buffer.from(value.value, "base64").length !== 64) throw fail("MANAGED_MANIFEST_SIGNATURE_INVALID", "安装声明签名格式无效。");
  return { algorithm: "ed25519", keyId: identifier(value.keyId, "签名密钥"), value: value.value };
}
function normalizeManagedArtifactManifest(raw, options = {}) {
  exact(raw, ["schemaVersion", "id", "label", "version", "adapter", "runtime", "requirements", "artifacts", "signature"], "安装声明");
  if (raw.schemaVersion !== 1 || raw.adapter !== "comfyui-portable") throw fail("MANAGED_MANIFEST_ADAPTER_INVALID", "只支持版本 1 的 ComfyUI portable 安装声明。");
  if (raw.runtime !== undefined) {
    exact(raw.runtime, ["artifactId", "cpu"], "运行时声明");
    if (typeof raw.runtime.cpu !== "boolean") throw fail("MANAGED_MANIFEST_VALUE_INVALID", "运行时必须明确 CPU 模式。");
  }
  exact(raw.requirements, ["os", "arch", "gpu", "vramBytes", "diskBytes"], "硬件要求");
  const requirements = {
    os: list(raw.requirements.os, ["win32"], "操作系统"), arch: list(raw.requirements.arch, ["x64", "arm64"], "架构"),
    gpu: list(raw.requirements.gpu, ["cpu", "nvidia", "amd", "intel"], "GPU 要求"),
    vramBytes: bytes(raw.requirements.vramBytes, "显存要求", true), diskBytes: bytes(raw.requirements.diskBytes, "磁盘要求")
  };
  if (!Array.isArray(raw.artifacts) || !raw.artifacts.length || raw.artifacts.length > 128) throw fail("MANAGED_MANIFEST_ARTIFACT_INVALID", "安装声明必须包含制品。");
  const artifacts = raw.artifacts.map(value => normalizeManagedArtifactDescriptor(value, options)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ids = new Map(artifacts.map(item => [item.id, item]));
  if (ids.size !== artifacts.length) throw fail("MANAGED_MANIFEST_DEPENDENCY_INVALID", "制品标识不能重复。");
  const runtimeCount = artifacts.filter(item => item.kind === "runtime").length;
  const runtimeId = raw.runtime === undefined ? undefined : identifier(raw.runtime.artifactId, "运行时制品");
  if (runtimeCount > 1 || runtimeCount === 1 && ids.get(runtimeId)?.kind !== "runtime" || runtimeCount === 0 && (runtimeId !== undefined || artifacts.some(item => item.kind !== "model"))) throw fail("MANAGED_MANIFEST_ARTIFACT_INVALID", "必须明确一个 portable runtime，或仅声明受管模型。");
  const visiting = new Set(), visited = new Set(), installOrder = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw fail("MANAGED_MANIFEST_DEPENDENCY_CYCLE", "安装声明包含循环依赖。");
    const item = ids.get(id);
    if (!item) throw fail("MANAGED_MANIFEST_DEPENDENCY_INVALID", "安装声明包含不存在的依赖。");
    visiting.add(id); item.dependencies.forEach(visit); visiting.delete(id); visited.add(id); installOrder.push(id);
  }
  artifacts.forEach(item => visit(item.id));
  const downloadBytes = safeTotal(artifacts.map(item => item.bytes)), expandedBytes = safeTotal(artifacts.map(item => item.expandedBytes));
  if (requirements.diskBytes < safeTotal([downloadBytes, expandedBytes])) throw fail("MANAGED_MANIFEST_SIZE_INVALID", "磁盘要求不能低于下载与展开大小合计。");
  const manifest = {
    schemaVersion: 1, id: identifier(raw.id, "安装声明"), label: text(raw.label, "安装名称"), version: text(raw.version, "安装版本", 80),
    adapter: "comfyui-portable", ...(runtimeId ? { runtime: { artifactId: runtimeId, cpu: raw.runtime.cpu } } : {}), requirements, artifacts
  };
  const signature = raw.signature === undefined ? undefined : normalizeSignature(raw.signature);
  let signatureVerified = false;
  if (signature) {
    const key = options.trustedSigningKeys?.[signature.keyId];
    if (!key) throw fail("MANAGED_MANIFEST_SIGNATURE_UNTRUSTED", "安装声明签名密钥尚未受信。");
    try { signatureVerified = verify(null, Buffer.from(canonicalManagedArtifactValue(manifest)), key, Buffer.from(signature.value, "base64")); } catch {}
    if (!signatureVerified) throw fail("MANAGED_MANIFEST_SIGNATURE_INVALID", "安装声明签名校验失败。");
    manifest.signature = signature;
  }
  const context = options.trustContext || { kind: "needs-review", id: "unreviewed" };
  if (!plain(context) || !["user-import", "reviewed-registry", "needs-review"].includes(context.kind)) throw fail("MANAGED_MANIFEST_TRUST_INVALID", "安装声明来源上下文无效。");
  const provenance = { kind: context.kind, id: identifier(context.id, "来源授权") };
  if (artifacts.some(item => item.kind === "custom-node") && context.kind !== "reviewed-registry" && !signatureVerified) throw fail("MANAGED_MANIFEST_CUSTOM_NODE_UNTRUSTED", "自定义节点只允许审核 registry 或受信签名包。");
  return freeze({
    ...manifest, manifestHash: hashManagedArtifactValue(manifest), policyVersion: MANAGED_ARTIFACT_POLICY_VERSION,
    provenance, signatureVerified, installable: context.kind !== "needs-review", downloadBytes, expandedBytes, installOrder
  });
}
function publicManagedArtifactManifest(manifest) {
  return {
    manifestId: manifest.id, label: manifest.label, version: manifest.version, manifestHash: manifest.manifestHash,
    adapter: manifest.adapter, requirements: JSON.parse(JSON.stringify(manifest.requirements)), artifactCount: manifest.artifacts.length,
    downloadBytes: manifest.downloadBytes, expandedBytes: manifest.expandedBytes, installable: manifest.installable === true,
    provenance: manifest.provenance.kind
  };
}

module.exports = {
  MANAGED_ARTIFACT_POLICY_VERSION, ARTIFACT_KINDS,
  canonicalManagedArtifactValue, hashManagedArtifactValue, normalizeManagedArtifactUrl,
  normalizeManagedArtifactRelativePath, normalizeManagedArtifactDescriptor, normalizeManagedArtifactManifest, publicManagedArtifactManifest
};
