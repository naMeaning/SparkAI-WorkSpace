"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createComfyUiCredentialStore } = require("../desktop/comfyui-credential-store.cjs");
const { createComfyUiConnectionProfileService } = require("../desktop/comfyui-connection-service.cjs");

// Create a throwaway certificate with Node's built-in crypto.  These keys are
// local fixtures and are never used for a service or reported to diagnostics.
const der = (tag, ...values) => {
  const value = Buffer.concat(values.map(item => Buffer.isBuffer(item) ? item : Buffer.from(item)));
  const length = value.length < 128 ? Buffer.from([value.length]) : value.length < 256 ? Buffer.from([0x81, value.length]) : Buffer.from([0x82, value.length >>> 8, value.length & 255]);
  return Buffer.concat([Buffer.from([tag]), length, value]);
};
function fixtureTls(commonNameValue = "localhost") {
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const algorithm = der(0x30, der(0x06, Buffer.from("2a8648ce3d040302", "hex")));
  const commonName = der(0x30, der(0x31, der(0x30, der(0x06, Buffer.from("550403", "hex")), der(0x0c, Buffer.from(commonNameValue)))));
  const validity = der(0x30, der(0x17, Buffer.from("260101000000Z")), der(0x17, Buffer.from("360101000000Z")));
  const tbs = der(0x30, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])), algorithm, commonName, validity, commonName,
    pair.publicKey.export({ type: "spki", format: "der" }));
  const signature = crypto.sign("sha256", tbs, pair.privateKey);
  const certificate = der(0x30, tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const cert = `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const key = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  new crypto.X509Certificate(cert);
  return { cert, key, ca: cert };
}

const encryptionKey = crypto.randomBytes(32);
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decryptString(value) {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
  }
};
const results = [];
const test = async (name, action) => { await action(); results.push({ name, ok: true }); };
const code = expected => error => error?.code === expected;

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sparkai-comfyui-credentials-"));
  const secretsPath = path.join(temporary, "comfyui.secrets.json");
  let selectedPath = "", canceled = false, pickerCalls = 0;
  const dialog = { showOpenDialog: async () => { pickerCalls++; return { canceled, filePaths: canceled ? [] : [selectedPath] }; } };
  const store = createComfyUiCredentialStore({ safeStorage, secretsPath, dialog });
  const tls = fixtureTls();
  try {
    await test("bearer/basic persist ciphertext and round-trip only in Main", () => {
      const ref = { mode: "bearer", id: "fixture-bearer" };
      assert.deepEqual(store.set(ref, { token: "fixture-token-sensitive" }), ref);
      assert.deepEqual(store.get(ref), { token: "fixture-token-sensitive" });
      const basic = { mode: "basic", id: "fixture-basic" };
      store.set(basic, { username: "fixture-user", password: "fixture-password-sensitive" });
      assert.deepEqual(store.get(basic), { username: "fixture-user", password: "fixture-password-sensitive" });
      const text = fs.readFileSync(secretsPath, "utf8");
      for (const secret of ["fixture-token-sensitive", "fixture-user", "fixture-password-sensitive", "fixture-bearer", "fixture-basic"]) assert.equal(text.includes(secret), false);
      assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["ciphertext", "type", "version"]);
    });
    await test("native JSON import returns only opaque refs and never paths", async () => {
      selectedPath = path.join(temporary, "bearer.json");
      fs.writeFileSync(selectedPath, JSON.stringify({ mode: "bearer", token: "native-import-token" }));
      const imported = await store.importCredential({ mode: "bearer" });
      assert.equal(imported.ok, true); assert.match(imported.credentialRef.id, /^comfycred-/); assert.equal(imported.credentialRef.mode, "bearer");
      assert.deepEqual(store.get(imported.credentialRef), { token: "native-import-token" });
      assert.equal(JSON.stringify(imported).includes(selectedPath), false); assert.equal(JSON.stringify(imported).includes("native-import-token"), false);
      assert.equal(pickerCalls, 1);
    });
    await test("mTLS PEM import validates matching keys and resolves CA/material refs", async () => {
      selectedPath = path.join(temporary, "mtls.json");
      fs.writeFileSync(selectedPath, JSON.stringify({ mode: "mtls", ...tls }));
      const imported = await store.importCredential({ mode: "mtls" });
      assert.deepEqual(store.get(imported.credentialRef), tls);
      const resolved = store.resolveTls({ credentialRef: imported.credentialRef, tls: { caRef: imported.credentialRef.id, clientCertRef: imported.credentialRef.id, clientKeyRef: imported.credentialRef.id } });
      assert.equal(resolved.rejectUnauthorized, true); assert.equal(resolved.cert, tls.cert); assert.equal(resolved.key, tls.key); assert.equal(resolved.ca, tls.ca);
      const sidecar = fs.readFileSync(secretsPath, "utf8");
      assert.equal(sidecar.includes("PRIVATE KEY"), false); assert.equal(sidecar.includes("CERTIFICATE"), false);
      const service = createComfyUiConnectionProfileService({ credentialStore: store });
      service.create({ id: "mtls-profile", networkScope: "remote", baseUrl: "https://example.test", credentialRef: imported.credentialRef });
      assert.equal(service.credentialHeaders({ connectionId: "mtls-profile" }).tls.cert, tls.cert);
      assert.equal(JSON.stringify(service.list()).includes(imported.credentialRef.id), false);
    });
    await test("native cancellation preserves sidecar and does not return secrets", async () => {
      const before = fs.readFileSync(secretsPath, "utf8"); canceled = true;
      assert.deepEqual(await store.importCredential({ mode: "basic" }), { ok: true, canceled: true });
      assert.equal(fs.readFileSync(secretsPath, "utf8"), before); canceled = false;
    });
    await test("unsafe imports fail before sidecar mutation", async () => {
      const before = fs.readFileSync(secretsPath, "utf8");
      await assert.rejects(store.importCredential({ mode: "bearer", path: selectedPath }), code("COMFYUI_CREDENTIAL_IMPORT_INVALID"));
      selectedPath = path.join(temporary, "invalid.json");
      for (const value of [{ mode: "bearer", token: "ok", shell: "never" }, { mode: "basic", username: "user", password: "pw" }, { mode: "bearer", token: "line\nbreak" }]) {
        fs.writeFileSync(selectedPath, JSON.stringify(value));
        await assert.rejects(store.importCredential({ mode: "bearer" }));
      }
      assert.throws(() => store.set({ mode: "mtls", id: "invalid-mtls" }, { cert: tls.cert, key: "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----" }), code("COMFYUI_CREDENTIAL_TLS_INVALID"));
      assert.equal(fs.readFileSync(secretsPath, "utf8"), before);
    });
    await test("unavailable safeStorage refuses writes without plaintext fallback", () => {
      const unavailablePath = path.join(temporary, "unavailable.json");
      const unavailable = createComfyUiCredentialStore({ safeStorage: { isEncryptionAvailable: () => false }, secretsPath: unavailablePath });
      assert.throws(() => unavailable.set({ mode: "bearer", id: "unavailable" }, { token: "never-write-this" }), code("COMFYUI_CREDENTIAL_STORAGE_UNAVAILABLE"));
      assert.equal(fs.existsSync(unavailablePath), false);
    });
    await test("corrupt ciphertext is preserved and cannot be overwritten", () => {
      const corruptPath = path.join(temporary, "corrupt.json"), bad = JSON.stringify({ version: 1, type: "sparkai-comfyui-credentials", ciphertext: "AQID" });
      fs.writeFileSync(corruptPath, bad);
      const corrupt = createComfyUiCredentialStore({ safeStorage, secretsPath: corruptPath });
      assert.throws(() => corrupt.get({ mode: "bearer", id: "fixture" }), code("COMFYUI_CREDENTIAL_STORE_INVALID"));
      assert.throws(() => corrupt.set({ mode: "bearer", id: "fixture" }, { token: "new-token" }), code("COMFYUI_CREDENTIAL_STORE_INVALID"));
      assert.throws(() => corrupt.delete({ mode: "bearer", id: "fixture" }), code("COMFYUI_CREDENTIAL_STORE_INVALID"));
      assert.equal(fs.readFileSync(corruptPath, "utf8"), bad);
    });
    await test("credential identity type conflicts and deletion stay scoped", () => {
      assert.throws(() => store.set({ mode: "basic", id: "fixture-bearer" }, { username: "u", password: "p" }), code("COMFYUI_CREDENTIAL_REF_CONFLICT"));
      assert.equal(store.has({ mode: "bearer", id: "fixture-bearer" }), true);
      assert.equal(store.delete({ mode: "bearer", id: "fixture-bearer" }), true);
      assert.equal(store.has({ mode: "bearer", id: "fixture-bearer" }), false);
      assert.equal(store.has({ mode: "basic", id: "fixture-basic" }), true);
      assert.throws(() => store.get({ mode: "bearer", id: "fixture-bearer" }), code("COMFYUI_CREDENTIAL_NOT_FOUND"));
    });
    const report = { ok: true, cases: results.length, results, realNetworkRequests: 0, realModelRequests: 0, encryptedSidecar: true, nativeImportOnly: true };
    const reportPath = path.resolve(__dirname, "../.diagnostics/comfyui-credential-store/report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: ".diagnostics/comfyui-credential-store/report.json" })}\n`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

module.exports = { fixtureTls };
