"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, X509Certificate, createPrivateKey, createPublicKey } = require("node:crypto");

const STORE_VERSION = 1;
const STORE_TYPE = "sparkai-comfyui-credentials";
const MAX_ENTRIES = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_SECRET_TEXT = 64 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MODES = new Set(["bearer", "basic", "mtls"]);
const plain = value => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = value => JSON.parse(JSON.stringify(value));

function credentialRef(value, { optional = false } = {}) {
  if (optional && (!value || value.mode === "none")) return null;
  const mode = String(value?.mode || "").toLowerCase();
  const id = String(value?.id || value?.credentialId || "");
  if (!plain(value) || !MODES.has(mode) || !ID_RE.test(id)) throw fail("COMFYUI_CREDENTIAL_REF_INVALID", "ComfyUI 凭据引用无效。");
  return { mode, id };
}

function text(value, { allowEmpty = false, max = MAX_SECRET_TEXT, newlines = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.length) || value.length > max || value.includes("\0") || (!newlines && /[\r\n]/.test(value))) throw fail("COMFYUI_CREDENTIAL_INVALID", "ComfyUI 凭据内容无效。");
  return value;
}

function normalizePem(value, kind) {
  const source = text(value, { max: MAX_IMPORT_BYTES, newlines: true }).trim() + "\n";
  if (kind === "cert" || kind === "ca") {
    try {
      const certificates = source.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
      if (!certificates.length || source.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()) throw Error();
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch { throw fail("COMFYUI_CREDENTIAL_TLS_INVALID", "ComfyUI 证书必须是有效 PEM 证书。"); }
  } else {
    if (!/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(source)) throw fail("COMFYUI_CREDENTIAL_TLS_INVALID", "ComfyUI 私钥必须是 PEM 私钥。");
  }
  return source;
}

function normalizeSecret(mode, value = {}) {
  if (!plain(value)) throw fail("COMFYUI_CREDENTIAL_INVALID", "ComfyUI 凭据内容无效。");
  const allowed = mode === "bearer" ? new Set(["token", "value"]) : mode === "basic" ? new Set(["username", "password", "secret"]) :
    new Set(["cert", "clientCert", "clientCertPem", "key", "clientKey", "clientKeyPem", "ca", "caPem", "passphrase"]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw fail("COMFYUI_CREDENTIAL_INVALID", "ComfyUI 凭据文件包含未支持字段。");
  if (mode === "bearer") {
    const token = text(value.token ?? value.value).trim();
    if (!token || /\s/.test(token)) throw fail("COMFYUI_CREDENTIAL_INVALID", "ComfyUI Bearer 凭据无效。");
    return { token };
  }
  if (mode === "basic") {
    const username = text(value.username, { max: 2048 });
    const password = text(value.password ?? value.secret, { allowEmpty: true });
    if (username.includes(":")) throw fail("COMFYUI_CREDENTIAL_INVALID", "ComfyUI Basic 用户名不能包含冒号。");
    return { username, password };
  }
  if (mode !== "mtls") throw fail("COMFYUI_CREDENTIAL_MODE_INVALID", "ComfyUI 凭据类型无效。");
  const cert = normalizePem(value.cert ?? value.clientCert ?? value.clientCertPem, "cert");
  const key = normalizePem(value.key ?? value.clientKey ?? value.clientKeyPem, "key");
  const passphrase = value.passphrase === undefined ? undefined : text(value.passphrase, { allowEmpty: true });
  const caSource = value.ca ?? value.caPem;
  const ca = caSource === undefined || caSource === "" ? undefined : normalizePem(caSource, "ca");
  try {
    const privateKey = createPrivateKey({ key, ...(passphrase === undefined ? {} : { passphrase }) });
    const certificateKey = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
    const derivedKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    if (!certificateKey.equals(derivedKey)) throw Error();
  } catch { throw fail("COMFYUI_CREDENTIAL_TLS_INVALID", "ComfyUI 客户端证书与私钥不匹配或无法读取。"); }
  return { cert, key, ...(ca ? { ca } : {}), ...(passphrase === undefined ? {} : { passphrase }) };
}

function normalizeImportedCredential(value, expectedMode) {
  if (!plain(value)) throw fail("COMFYUI_CREDENTIAL_IMPORT_INVALID", "ComfyUI 凭据文件必须是 JSON 对象。");
  const mode = String(value.mode || value.type || expectedMode || "").toLowerCase();
  if (!MODES.has(mode) || (expectedMode && mode !== expectedMode)) throw fail("COMFYUI_CREDENTIAL_MODE_INVALID", "凭据文件类型与所选连接不一致。");
  const { mode: _mode, type: _type, label: _label, ...secret } = value;
  const normalized = normalizeSecret(mode, secret);
  return { mode, secret: normalized };
}

/**
 * All entry payloads, labels and references are inside one safeStorage
 * envelope.  Ordinary profiles retain only opaque references.  This service
 * has no renderer/CLI JSON path entry point: `importCredential` always opens
 * Main's native file picker and never returns the selected file path.
 */
function createComfyUiCredentialStore({ safeStorage, secretsPath, dialog } = {}) {
  if (typeof secretsPath !== "string" || !secretsPath) throw new TypeError("A ComfyUI credential sidecar path is required.");

  function encryptionAvailable() {
    try {
      return safeStorage?.isEncryptionAvailable?.() === true &&
        typeof safeStorage.encryptString === "function" && typeof safeStorage.decryptString === "function";
    } catch { return false; }
  }
  function requireEncryption() {
    if (!encryptionAvailable()) throw fail("COMFYUI_CREDENTIAL_STORAGE_UNAVAILABLE", "操作系统安全存储不可用，ComfyUI 凭据未保存。");
  }
  function decode() {
    if (!fs.existsSync(secretsPath)) return { version: STORE_VERSION, entries: [] };
    requireEncryption();
    try {
      const stat = fs.lstatSync(secretsPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES) throw Error();
      const envelope = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
      if (!plain(envelope) || envelope.version !== STORE_VERSION || envelope.type !== STORE_TYPE || typeof envelope.ciphertext !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) throw Error();
      const encrypted = Buffer.from(envelope.ciphertext, "base64");
      if (!encrypted.length || encrypted.length > MAX_PAYLOAD_BYTES || encrypted.toString("base64") !== envelope.ciphertext) throw Error();
      const plaintext = safeStorage.decryptString(encrypted);
      if (typeof plaintext !== "string" || Buffer.byteLength(plaintext, "utf8") > MAX_PAYLOAD_BYTES) throw Error();
      const payload = JSON.parse(plaintext);
      if (!plain(payload) || payload.version !== STORE_VERSION || !Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) throw Error();
      const ids = new Set();
      const entries = payload.entries.map(entry => {
        const ref = credentialRef(entry);
        if (ids.has(ref.id)) throw Error();
        ids.add(ref.id);
        return { ...ref, secret: normalizeSecret(ref.mode, entry.secret), createdAt: String(entry.createdAt || ""), updatedAt: String(entry.updatedAt || "") };
      });
      return { version: STORE_VERSION, entries };
    } catch (error) {
      if (error?.code === "COMFYUI_CREDENTIAL_STORAGE_UNAVAILABLE") throw error;
      throw fail("COMFYUI_CREDENTIAL_STORE_INVALID", "ComfyUI 受保护凭据记录无法读取，原文件已保留。");
    }
  }
  function persist(payload) {
    requireEncryption();
    const plaintext = JSON.stringify(payload);
    if (Buffer.byteLength(plaintext, "utf8") > MAX_PAYLOAD_BYTES) throw fail("COMFYUI_CREDENTIAL_CAPACITY", "ComfyUI 凭据记录已达到容量上限。");
    let ciphertext;
    try {
      const encrypted = safeStorage.encryptString(plaintext);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_PAYLOAD_BYTES) throw Error();
      ciphertext = encrypted.toString("base64");
    } catch { throw fail("COMFYUI_CREDENTIAL_ENCRYPT_FAILED", "ComfyUI 凭据加密失败，原记录已保留。"); }
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    const temporary = `${secretsPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: STORE_VERSION, type: STORE_TYPE, ciphertext }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, secretsPath);
    } catch {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw fail("COMFYUI_CREDENTIAL_WRITE_FAILED", "ComfyUI 凭据保存失败，原记录已保留。");
    }
  }
  function get(value) {
    const ref = credentialRef(value, { optional: true });
    if (!ref) return null;
    const found = decode().entries.find(entry => entry.id === ref.id && entry.mode === ref.mode);
    if (!found) throw fail("COMFYUI_CREDENTIAL_NOT_FOUND", "ComfyUI 连接凭据不存在，请重新导入。");
    return clone(found.secret);
  }
  function set(value, secret) {
    const ref = credentialRef(value);
    const normalized = normalizeSecret(ref.mode, secret);
    const payload = decode();
    const prior = payload.entries.find(entry => entry.id === ref.id);
    if (prior && prior.mode !== ref.mode) throw fail("COMFYUI_CREDENTIAL_REF_CONFLICT", "ComfyUI 凭据引用不能改变类型。");
    if (!prior && payload.entries.length >= MAX_ENTRIES) throw fail("COMFYUI_CREDENTIAL_CAPACITY", "ComfyUI 凭据记录已达到容量上限。");
    const timestamp = new Date().toISOString();
    const entry = { ...ref, secret: normalized, createdAt: prior?.createdAt || timestamp, updatedAt: timestamp };
    payload.entries = [...payload.entries.filter(item => item.id !== ref.id), entry];
    persist(payload);
    return { ...ref };
  }
  function has(value) {
    try { const ref = credentialRef(value); return decode().entries.some(entry => entry.id === ref.id && entry.mode === ref.mode); }
    catch (error) { if (error?.code === "COMFYUI_CREDENTIAL_REF_INVALID") return false; throw error; }
  }
  function remove(value) {
    const ref = credentialRef(value, { optional: true });
    if (!ref) return false;
    const payload = decode();
    const entries = payload.entries.filter(entry => !(entry.id === ref.id && entry.mode === ref.mode));
    if (entries.length === payload.entries.length) return false;
    persist({ ...payload, entries });
    return true;
  }
  function resolveTls(profileOrRefs = {}) {
    const refs = profileOrRefs.tls || profileOrRefs;
    const mainRef = profileOrRefs.credentialRef;
    const mainSecret = mainRef?.mode === "mtls" ? get(mainRef) : null;
    const result = { rejectUnauthorized: true };
    for (const [field, refName] of [["ca", "caRef"], ["cert", "clientCertRef"], ["key", "clientKeyRef"]]) {
      if (refs[refName]) {
        const refId = String(refs[refName]);
        if (!ID_RE.test(refId)) throw fail("COMFYUI_CREDENTIAL_REF_INVALID", "ComfyUI TLS 凭据引用无效。");
        const secret = get({ mode: "mtls", id: refId });
        if (!secret?.[field]) throw fail("COMFYUI_CREDENTIAL_TLS_INVALID", "ComfyUI TLS 引用缺少所需材料。");
        result[field] = secret[field];
        if (field === "key" && secret.passphrase !== undefined) result.passphrase = secret.passphrase;
      } else if (mainSecret?.[field]) result[field] = mainSecret[field];
    }
    if (mainSecret?.passphrase !== undefined && result.passphrase === undefined) result.passphrase = mainSecret.passphrase;
    return result;
  }
  async function importCredential(input = {}) {
    if (!plain(input) || Object.keys(input).some(key => !["mode", "label", "expectedMode"].includes(key))) throw fail("COMFYUI_CREDENTIAL_IMPORT_INVALID", "ComfyUI 凭据必须通过 Main 原生文件选择导入。");
    const mode = String(input.mode || input.expectedMode || "").toLowerCase();
    if (!MODES.has(mode)) throw fail("COMFYUI_CREDENTIAL_MODE_INVALID", "请选择 ComfyUI 凭据类型。");
    requireEncryption();
    if (typeof dialog?.showOpenDialog !== "function") throw fail("COMFYUI_CREDENTIAL_IMPORT_UNAVAILABLE", "当前运行时无法打开 ComfyUI 凭据文件。");
    const selection = await dialog.showOpenDialog({
      title: "导入 ComfyUI 受保护凭据 JSON",
      properties: ["openFile"],
      filters: [{ name: "ComfyUI Credential JSON", extensions: ["json"] }]
    });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: true, canceled: true };
    const file = selection.filePaths[0];
    let value;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_IMPORT_BYTES) throw Error();
      value = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { throw fail("COMFYUI_CREDENTIAL_IMPORT_INVALID", "ComfyUI 凭据文件无效或超过大小限制。"); }
    const imported = normalizeImportedCredential(value, mode);
    const ref = { mode: imported.mode, id: `comfycred-${randomUUID()}` };
    set(ref, imported.secret);
    return { ok: true, credentialRef: ref };
  }
  return Object.freeze({ get, set, has, delete: remove, remove, resolveTls, importCredential, importFromDialog: importCredential, encryptionAvailable });
}

module.exports = { STORE_VERSION, STORE_TYPE, createComfyUiCredentialStore, normalizeImportedCredential };
