"use strict";

process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";

const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const testRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-new-api-login-"));
const configDir = path.join(testRoot, "config");
const settingsPath = path.join(configDir, "app-settings.json");
const secretsPath = path.join(configDir, "app-settings.secrets.json");
let server;

function listen(target) {
  return new Promise((resolve, reject) => {
    target.once("error", reject);
    target.listen(0, "127.0.0.2", () => {
      target.removeListener("error", reject);
      resolve(target.address());
    });
  });
}

function close(target) {
  return new Promise((resolve) => {
    if (!target?.listening) return resolve();
    target.close(() => resolve());
  });
}

function json(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
  response.end(JSON.stringify(payload));
}

async function main() {
  const calls = [];
  const delayedEndpoints = new Set([
    "/api/user/self",
    "/api/user/self/groups",
    "/api/user/models",
    "/api/status",
    "/api/token/",
    "/v1/models"
  ]);
  server = http.createServer((request, response) => {
    const endpoint = String(request.url || "").split("?", 1)[0];
    calls.push(endpoint);
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", () => {
      if (endpoint === "/api/user/login" && request.method === "POST") {
        json(response, 200, {
          success: true,
          data: {
            access_token: "fixture-access-token",
            token_type: "Bearer",
            access_expires_at: Math.floor(Date.now() / 1000) + 3_600,
            user: {
              id: 42,
              username: "fixture-user",
              email: "fixture@example.test",
              quota: 500_000
            },
            session: { sid: "fixture-auth-session" }
          }
        }, {
          "set-cookie": "new_api_refresh=fixture-refresh-cookie; Path=/; HttpOnly; Secure; SameSite=Lax"
        });
        return;
      }
      if (delayedEndpoints.has(endpoint)) {
        setTimeout(() => json(response, 200, { success: true, data: { items: [] } }), 1_500);
        return;
      }
      json(response, 404, { success: false, message: "fixture endpoint not found" });
    });
  });
  const address = await listen(server);
  assert(address && typeof address === "object" && address.port > 0);

  process.env.NAIMAGE_CONFIG_DIR = configDir;
  process.env.NAIMAGE_RENDERER_INDEX = path.join(testRoot, "renderer.html");
  process.env.SPARKAI_ACCESS_VARIANT = "dual-access";
  const accountBaseUrl = `http://127.0.0.2:${address.port}`;
  const initialSettings = {
    accessMode: "account",
    accountBaseUrl,
    relayBaseUrl: "",
    updateBaseUrl: accountBaseUrl,
    serverAuthProtocol: "legacy",
    serverToken: "legacy-token-to-clear",
    serverSessionCookie: "session=old-account",
    serverUserId: "7",
    selectedAccountTokenId: "99",
    selectedAccountTokenName: "Old token",
    selectedAccountTokenGroup: "old-group",
    agentModel: "gpt-5.6-terra",
    agentModelPool: ["gpt-5.6-terra"],
    imageModel: "gpt-image-2",
    imageModelPool: ["gpt-image-2"],
    videoModel: "doubao-seedance-2-0-260128",
    videoModelPool: ["doubao-seedance-2-0-260128"]
  };
  require("node:fs").mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(initialSettings, null, 2)}\n`, "utf8");

  const desktopMain = require("../electron-main.cjs");
  await app.whenReady();
  const startedAt = Date.now();
  const result = await desktopMain.completeNewApiLogin(initialSettings, {
    username: "fixture-user",
    password: "fixture-password"
  });
  const durationMs = Date.now() - startedAt;

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "42");
  assert.equal(result.user.id, "42");
  assert.equal(result.user.username, "fixture-user");
  assert(durationMs < 1_000, `Login critical path took ${durationMs}ms despite delayed follow-up endpoints`);
  assert.deepEqual(calls, ["/api/user/login"], "Login must not synchronously fan out to profile/token/catalog endpoints");

  const persisted = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(persisted.serverAuthProtocol, "bundle");
  assert.equal(persisted.serverUserId, "42");
  assert.equal(persisted.serverToken, "");
  assert.equal(persisted.selectedAccountTokenId, "");
  assert.equal(persisted.selectedAccountTokenName, "");
  assert.equal(persisted.selectedAccountTokenGroup, "");
  assert.equal(persisted.serverAccessToken, "");
  assert.equal(persisted.serverSessionCookie, "");
  assert.equal(persisted.serverAuthSessionId, "");
  assert.equal(existsSync(secretsPath), true, "rc.23 credentials must be persisted in the encrypted sidecar");
  const sidecar = readFileSync(secretsPath, "utf8");
  assert.equal(sidecar.includes("fixture-access-token"), false);
  assert.equal(sidecar.includes("fixture-refresh-cookie"), false);
  assert.equal(sidecar.includes("fixture-auth-session"), false);

  const returnedSettings = JSON.stringify(result.settings);
  assert.equal(returnedSettings.includes("fixture-access-token"), false);
  assert.equal(returnedSettings.includes("fixture-refresh-cookie"), false);
  assert.equal(returnedSettings.includes("fixture-auth-session"), false);
  assert.equal(returnedSettings.includes("legacy-token-to-clear"), false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    durationMs,
    loginRequests: calls.length,
    delayedFollowUpsDeferred: true,
    rc23BundlePersisted: true,
    staleTokenSelectionCleared: true,
    credentialsEncryptedAndRedacted: true
  })}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close(server);
    rmSync(testRoot, { recursive: true, force: true });
    setTimeout(() => app.exit(process.exitCode ? 1 : 0), 20);
  });
