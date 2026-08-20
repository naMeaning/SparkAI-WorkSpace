import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { loadConfig } from "../src/config.mjs";
import { openDatabase } from "../src/database.mjs";
import { createExtensionHttpServer, closeServer, listen } from "../src/http-server.mjs";
import { ImageTaskService } from "../src/image-task-service.mjs";
import { compileLicenseAdminScript } from "../src/license-admin-ui.mjs";
import { LicenseService } from "../src/license-service.mjs";

const ADMIN_TOKEN = "admin-token-for-tests-1234567890abcdef";
const HASH_SECRET = "hash-secret-for-tests-1234567890abcdef";
const MODEL_TOKEN = "model-token-for-tests-1234567890abcdef";

function configEnv(overrides = {}) {
  return {
    SPARKAI_EXTENSION_ADMIN_TOKEN: ADMIN_TOKEN,
    SPARKAI_EXTENSION_HASH_SECRET: HASH_SECRET,
    SPARKAI_NEW_API_UPSTREAM: "http://new-api:3000",
    ...overrides
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function startServer(server) {
  const address = await listen(server, { host: "127.0.0.1", port: 0 });
  return `http://127.0.0.1:${address.port}`;
}

async function createHarness(t, upstreamHandler = (_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ created: 1, data: [{ b64_json: "fixture" }] }));
}, configOverrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sparkai-extension-test-"));
  const upstream = createServer(upstreamHandler);
  const upstreamUrl = await startServer(upstream);
  const database = openDatabase(join(directory, "extension.sqlite"));
  const licenseService = new LicenseService({ database, hashSecret: HASH_SECRET });
  const imageTaskService = new ImageTaskService({
    database,
    hashSecret: HASH_SECRET,
    resultsDir: join(directory, "results"),
    upstreamBaseUrl: upstreamUrl,
    concurrency: 2,
    timeoutMs: 5_000,
    maxResultBytes: 2 * 1024 * 1024,
    retentionHours: 24,
    logger: { info() {}, warn() {}, error() {} }
  });
  await imageTaskService.initialize();
  const config = {
    adminToken: ADMIN_TOKEN,
    maxRequestBytes: 128 * 1024,
    trustProxy: false,
    ...configOverrides
  };
  const extension = createExtensionHttpServer({
    config,
    licenseService,
    imageTaskService,
    logger: { info() {}, warn() {}, error() {} }
  });
  const extensionUrl = await startServer(extension);
  t.after(async () => {
    await closeServer(extension);
    await imageTaskService.shutdown();
    database.close();
    await closeServer(upstream);
    await rm(directory, { recursive: true, force: true });
  });
  return { database, directory, extensionUrl, imageTaskService };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  return { response, payload: await response.json() };
}

test("license API creates hash-only codes, limits devices, verifies, and revokes", async (t) => {
  const harness = await createHarness(t);
  const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
  const created = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Pro test", count: 1, valid_days: 0, max_activations: 3 })
  });
  assert.equal(created.response.status, 200);
  const code = created.payload.data.codes[0];
  assert.match(code, /^NAI-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  const storedCode = harness.database.prepare("SELECT * FROM activation_codes").get();
  assert.notEqual(storedCode.code_hash, code);
  assert.match(storedCode.code_ciphertext, /^v1\./);
  assert.equal(JSON.stringify(storedCode).includes(code), false);

  const licenses = [];
  for (let index = 1; index <= 3; index += 1) {
    const activation = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, device_id: `device-000000000${index}` })
    });
    assert.equal(activation.response.status, 200);
    assert.equal(activation.payload.data.plan, "pro");
    licenses.push(activation.payload.data.token);
  }

  const overLimit = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_id: "device-0000000004" })
  });
  assert.equal(overLimit.response.status, 400);
  assert.equal(overLimit.payload.error.code, "activation_limit_reached");

  const verified = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: licenses[0], device_id: "device-0000000001" })
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.payload.data.active, true);

  const listed = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes?page=1&size=20`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.data.items[0].activation_count, 3);
  assert.equal(listed.payload.data.items[0].code_reveal_available, 1);
  assert.deepEqual(listed.payload.data.summary, {
    total: 1,
    enabled: 1,
    disabled: 0,
    activation_count: 3,
    activation_capacity: 3
  });
  assert.equal(JSON.stringify(listed.payload).includes("code_hash"), false);

  const revealHeaders = { authorization: `Bearer ${ADMIN_TOKEN}` };
  const revealed = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes/${storedCode.id}/reveal`, {
    headers: revealHeaders
  });
  assert.equal(revealed.response.status, 200);
  assert.equal(revealed.payload.data.code, code);
  const revealedAgain = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes/${storedCode.id}/reveal`, {
    headers: revealHeaders
  });
  assert.equal(revealedAgain.response.status, 200);
  assert.equal(revealedAgain.payload.data.code, code);
  const unauthorizedReveal = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes/${storedCode.id}/reveal`);
  assert.equal(unauthorizedReveal.response.status, 401);

  const disabled = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes/${storedCode.id}/disable`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  assert.equal(disabled.response.status, 200);
  const revoked = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: licenses[0], device_id: "device-0000000001" })
  });
  assert.equal(revoked.response.status, 400);
  assert.equal(revoked.payload.error.code, "license_invalid");

  const afterDisable = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes?page=1&size=20`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  assert.deepEqual(afterDisable.payload.data.summary, {
    total: 1,
    enabled: 0,
    disabled: 1,
    activation_count: 3,
    activation_capacity: 3
  });
});

test("license admin page exposes no secrets and keeps data endpoints protected", async (t) => {
  compileLicenseAdminScript();
  const harness = await createHarness(t);

  const page = await fetch(`${harness.extensionUrl}/api/naimage/license/admin`);
  const pageBody = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(pageBody.includes(ADMIN_TOKEN), false);
  assert.equal(pageBody.includes(HASH_SECRET), false);
  assert.match(pageBody, /License 管理/);
  assert.match(pageBody, /autocomplete="off"/);
  assert.match(pageBody, /id="open-create-button"/);
  assert.match(pageBody, /id="create-dialog"/);

  const script = await fetch(`${harness.extensionUrl}/api/naimage/license/admin/assets/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /^application\/javascript/);
  const scriptBody = await script.text();
  assert.equal(scriptBody.includes(ADMIN_TOKEN), false);
  assert.equal(/localStorage|sessionStorage/.test(scriptBody), false);

  const unauthorized = await jsonRequest(`${harness.extensionUrl}/api/naimage/license/admin/codes?page=1&size=20`);
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.payload.error.code, "authorization_required");
});

test("license admin page can be embedded only for configured exact origins", async (t) => {
  const harness = await createHarness(t, undefined, {
    adminFrameOrigins: ["https://admin.example.com"]
  });
  const page = await fetch(`${harness.extensionUrl}/api/naimage/license/admin`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'self' https:\/\/admin\.example\.com/);
  assert.equal(page.headers.get("x-frame-options"), null);
});

test("admin frame configuration accepts exact origins and rejects paths or wildcards", () => {
  const config = loadConfig(configEnv({
    SPARKAI_EXTENSION_ADMIN_FRAME_ORIGINS: "https://admin.example.com, http://127.0.0.1:3000,https://admin.example.com/"
  }), "C:\\sparkai-extension-test");
  assert.deepEqual(config.adminFrameOrigins, ["https://admin.example.com", "http://127.0.0.1:3000"]);
  assert.throws(
    () => loadConfig(configEnv({ SPARKAI_EXTENSION_ADMIN_FRAME_ORIGINS: "https://admin.example.com/settings" })),
    /exact HTTP\(S\) origins/
  );
  assert.throws(
    () => loadConfig(configEnv({ SPARKAI_EXTENSION_ADMIN_FRAME_ORIGINS: "https://*.example.com" })),
    /exact HTTP\(S\) origins/
  );
});

test("historical hash-only codes are explicitly unrecoverable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sparkai-extension-license-legacy-"));
  const databasePath = join(directory, "extension.sqlite");
  const code = ["NAI", "ABCD", "EFGH", "JKLM", "NPQR"].join("-");
  const { secretDigest } = await import("../src/secrets.mjs");
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE activation_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      code_hint TEXT NOT NULL,
      plan TEXT NOT NULL,
      valid_days INTEGER NOT NULL,
      max_activations INTEGER NOT NULL,
      activation_count INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL,
      expired_time INTEGER NOT NULL DEFAULT 0,
      created_time INTEGER NOT NULL
    )
  `);
  legacyDatabase.prepare(`
    INSERT INTO activation_codes
      (name, code_hash, code_hint, plan, valid_days, max_activations, status, expired_time, created_time)
    VALUES (?, ?, ?, 'pro', 0, 1, 1, 0, ?)
  `).run("legacy", secretDigest(HASH_SECRET, "activation-code", code), "NAI-ABCD...NPQR", Math.floor(Date.now() / 1000));
  legacyDatabase.close();

  const database = openDatabase(databasePath);
  const licenseService = new LicenseService({ database, hashSecret: HASH_SECRET });
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  assert.throws(
    () => licenseService.revealCode(1),
    (error) => error?.code === "activation_code_unrecoverable"
  );
  const listed = licenseService.listCodes().items[0];
  assert.equal(listed.code_reveal_available, 0);
});

test("time-limited licenses and redemption deadlines expire", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sparkai-extension-license-time-"));
  const database = openDatabase(join(directory, "extension.sqlite"));
  let now = 1_800_000_000;
  const licenseService = new LicenseService({ database, hashSecret: HASH_SECRET, now: () => now });
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const limitedCode = licenseService.createCodes({
    name: "30 day Pro",
    count: 1,
    valid_days: 30,
    max_activations: 1
  }).codes[0];
  const activated = licenseService.activate({ code: limitedCode, device_id: "device-limited-0001" });
  assert.equal(activated.expires_at, now + 30 * 24 * 60 * 60);
  assert.equal(licenseService.verify({ token: activated.token, device_id: "device-limited-0001" }).active, true);

  now = activated.expires_at + 1;
  assert.throws(
    () => licenseService.verify({ token: activated.token, device_id: "device-limited-0001" }),
    (error) => error?.code === "license_expired"
  );

  const expiringCode = licenseService.createCodes({
    name: "Redeem before deadline",
    count: 1,
    valid_days: 0,
    max_activations: 1,
    expired_time: now + 10
  }).codes[0];
  now += 11;
  assert.throws(
    () => licenseService.activate({ code: expiringCode, device_id: "device-deadline-0001" }),
    (error) => error?.code === "activation_code_expired"
  );
});

test("image task returns immediately, forwards in background, and protects task ownership", async (t) => {
  const releaseUpstream = deferred();
  const observed = deferred();
  const harness = await createHarness(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    observed.resolve({
      path: request.url,
      authorization: request.headers.authorization,
      idempotencyKey: request.headers["idempotency-key"],
      body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
    });
    await releaseUpstream.promise;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ created: 123, data: [{ b64_json: "generated-fixture" }] }));
  });

  const headers = {
    authorization: `Bearer ${MODEL_TOKEN}`,
    "content-type": "application/json",
    "idempotency-key": "naimage-test-task-1"
  };
  const created = await jsonRequest(`${harness.extensionUrl}/v1/image-tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "gpt-image-2", prompt: "fixture prompt", group: "must-not-forward", stream: true })
  });
  assert.equal(created.response.status, 202);
  assert.equal(created.payload.status, "queued");
  assert.match(created.payload.task_id, /^imgtask_[a-f0-9]{36}$/);

  const duplicate = await jsonRequest(`${harness.extensionUrl}/v1/image-tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "gpt-image-2", prompt: "fixture prompt" })
  });
  assert.equal(duplicate.payload.task_id, created.payload.task_id);

  const forwarded = await observed.promise;
  assert.equal(forwarded.path, "/v1/images/generations");
  assert.equal(forwarded.authorization, `Bearer ${MODEL_TOKEN}`);
  assert.equal(forwarded.idempotencyKey, "naimage-test-task-1");
  assert.equal("group" in forwarded.body, false);
  assert.equal("stream" in forwarded.body, false);

  const stored = harness.database.prepare("SELECT owner_hash, status FROM image_tasks WHERE id = ?").get(created.payload.task_id);
  assert.notEqual(stored.owner_hash, MODEL_TOKEN);
  assert.equal(stored.status, "running");

  const hidden = await jsonRequest(`${harness.extensionUrl}/v1/image-tasks/${created.payload.task_id}`, {
    headers: { authorization: "Bearer another-model-token-1234567890" }
  });
  assert.equal(hidden.response.status, 404);

  releaseUpstream.resolve();
  let completed;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    completed = await jsonRequest(`${harness.extensionUrl}/v1/image-tasks/${created.payload.task_id}`, {
      headers: { authorization: `Bearer ${MODEL_TOKEN}` }
    });
    if (completed.payload.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(completed.payload.status, "succeeded");
  assert.equal(completed.payload.result.data[0].b64_json, "generated-fixture");
});

test("startup marks queued and running tasks failed without replay", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sparkai-extension-recovery-"));
  const database = openDatabase(join(directory, "extension.sqlite"));
  const now = Math.floor(Date.now() / 1000);
  database.prepare(`
    INSERT INTO image_tasks (id, owner_hash, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)
  `).run("imgtask_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "owner", now, now);
  const service = new ImageTaskService({
    database,
    hashSecret: HASH_SECRET,
    resultsDir: join(directory, "results"),
    upstreamBaseUrl: "http://127.0.0.1:9",
    logger: { info() {}, warn() {}, error() {} }
  });
  await service.initialize();
  const recovered = database.prepare("SELECT status, error_code FROM image_tasks").get();
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.error_code, "service_restarted");
  await service.shutdown();
  database.close();
  await rm(directory, { recursive: true, force: true });
});

test("upstream failures are persisted without bearer secrets", async (t) => {
  const harness = await createHarness(t, async (_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `Rejected exact token=${MODEL_TOKEN}` } }));
  });
  const created = await jsonRequest(`${harness.extensionUrl}/v1/image-tasks`, {
    method: "POST",
    headers: { authorization: `Bearer ${MODEL_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt: "fixture prompt" })
  });
  let failed;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    failed = await jsonRequest(`${harness.extensionUrl}/v1/image-tasks/${created.payload.task_id}`, {
      headers: { authorization: `Bearer ${MODEL_TOKEN}` }
    });
    if (failed.payload.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(failed.payload.status, "failed");
  assert.equal(JSON.stringify(failed.payload).includes(MODEL_TOKEN), false);
  const stored = harness.database.prepare("SELECT error_message FROM image_tasks WHERE id = ?").get(created.payload.task_id);
  assert.equal(stored.error_message.includes(MODEL_TOKEN), false);
});
