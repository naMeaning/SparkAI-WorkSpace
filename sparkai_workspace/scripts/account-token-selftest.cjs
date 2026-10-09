"use strict";

const assert = require("node:assert/strict");
const { createAccountTokenService } = require("../desktop/account-token-service.cjs");
const { createNewApiClient } = require("../desktop/new-api-client.cjs");

async function main() {
  const defaults = {
    accountBaseUrl: "https://sparkapi.org",
    serverSessionCookie: "",
    serverUserId: "",
    selectedAccountTokenId: "",
    selectedAccountTokenName: "",
    selectedAccountTokenGroup: "",
    networkProxyUrl: ""
  };
  let stored = {
    ...defaults,
    serverSessionCookie: "session=fixture",
    serverUserId: "7"
  };
  let tokens = [{
    id: 11,
    name: "视觉生成",
    key: "sk-***masked***",
    status: 1,
    remain_quota: 5_000_000,
    used_quota: 500_000,
    unlimited_quota: false,
    expired_time: -1,
    created_time: 1,
    accessed_time: 2,
    group: "image",
    model_limits_enabled: false,
    model_limits: "",
    allow_ips: "",
    cross_group_retry: true
  }];
  let tokenSnapshot = null;
  let statusAvailable = true;
  let statusPolicy = { quota_per_unit: 500_000, usd_exchange_rate: 7.3, price: 4.8 };
  const requests = [];
  const migrateSettings = (value) => ({ ...defaults, ...(value || {}) });
  const newApiRequest = async (_settings, endpoint, options = {}) => {
    requests.push({ endpoint, method: options.method || "GET", body: options.body, userAuth: options.userAuth === true });
    if (endpoint === "/api/status") {
      if (!statusAvailable) throw new Error("status unavailable");
      return { data: statusPolicy };
    }
    if (/^\/api\/token\/\?/.test(endpoint) && (!options.method || options.method === "GET")) return { data: { items: tokens, total: tokens.length } };
    const tokenId = endpoint.match(/^\/api\/token\/(\d+)$/)?.[1];
    if (tokenId) return { data: tokens.find((token) => token.id === Number(tokenId)) };
    const keyId = endpoint.match(/^\/api\/token\/(\d+)\/key$/)?.[1];
    if (keyId) return { data: { key: `sk-secret-${keyId}` } };
    if (endpoint === "/api/token/" && options.method === "POST") {
      tokens.push({ id: 12, key: "sk-***masked***", status: 1, used_quota: 0, created_time: 3, accessed_time: 3, ...options.body });
      return { success: true };
    }
    if (endpoint === "/api/token/" && options.method === "PUT") {
      tokens = tokens.map((token) => token.id === options.body.id ? { ...token, ...options.body } : token);
      return { data: tokens.find((token) => token.id === options.body.id) };
    }
    if (endpoint === "/api/token/?status_only=true" && options.method === "PUT") {
      tokens = tokens.map((token) => token.id === options.body.id ? { ...token, status: options.body.status } : token);
      return { success: true };
    }
    const deleteId = endpoint.match(/^\/api\/token\/(\d+)\/$/)?.[1];
    if (deleteId && options.method === "DELETE") {
      tokens = tokens.filter((token) => token.id !== Number(deleteId));
      return { success: true };
    }
    throw new Error(`Unexpected request ${options.method || "GET"} ${endpoint}`);
  };
  const createService = () => createAccountTokenService({
      defaultSettings: defaults,
      migrateSettings,
      newApiRequest,
      newApiUserAuthHeaders: () => ({ cookie: stored.serverSessionCookie, "New-Api-User": stored.serverUserId }),
      readJson: (target, fallback) => target === "token-cache.json" ? (tokenSnapshot ?? fallback) : stored,
      requireNewApiSession(settings) {
        if (!settings.serverSessionCookie || !settings.serverUserId) throw new Error("not logged in");
      },
      resolveNewApiBaseUrl: (settings) => settings.accountBaseUrl,
      settingsPath: "fixture.json",
      tokenCachePath: "token-cache.json",
      writeJson: (target, value) => {
        if (target === "token-cache.json") tokenSnapshot = value;
        else stored = value;
      }
    });
  const service = createService();

  const listed = await service.list(stored);
  assert.equal(listed.tokens.length, 1);
  assert.equal(listed.tokens[0].group, "image");
  assert.equal(listed.tokens[0].remainR, 10);
  assert.equal(listed.tokens[0].remainUsd, 10);
  assert.equal(listed.tokens[0].remainCnyCents, 7_300);
  assert.equal(listed.tokens[0].remainCnyDisplay, "￥73.00");
  assert.equal(listed.tokens[0].remainDisplay, "5,000,000 quota", "Legacy status without a display unit must retain raw quota in the UI");
  assert.match(listed.tokens[0].quotaAuditLabel, /5,000,000 quota · 原始额度 5,000,000/);
  assert.deepEqual(listed.quotaPolicy, { quotaPerR: 500_000, usdToCnyRate: 7.3, inputUnit: { unit: "quota", quotaPerAmount: 1 } });
  assert.equal("key" in listed.tokens[0], false, "Public token metadata must not contain a key field");
  assert.equal(listed.cached, false);
  assert.equal(listed.cacheAvailable, true);
  assert.ok(listed.cacheUpdatedAt > 0);
  const serializedSnapshot = JSON.stringify(tokenSnapshot);
  assert.equal(serializedSnapshot.includes("sk-***masked***"), false, "Token snapshots must not contain even masked key fields");
  assert.equal(serializedSnapshot.includes("session=fixture"), false, "Token snapshots must not contain login cookies");
  assert.equal(/allow_?ips/i.test(serializedSnapshot), false, "Token snapshots must not contain IP restrictions");
  assert.equal(/model_?limits/i.test(serializedSnapshot), false, "Token snapshots must not contain model restrictions");
  assert.equal(serializedSnapshot.includes("remainCnyDisplay"), false, "Token snapshots must retain raw quota instead of derived display strings");
  assert.equal(serializedSnapshot.includes("quotaAuditLabel"), false, "Token snapshots must not duplicate derived audit labels");

  const requestsBeforeCachedRead = requests.length;
  const cached = await createService().list(stored, { preferCached: true });
  assert.equal(cached.cached, true);
  assert.equal(cached.cacheAvailable, true);
  assert.equal(cached.tokens.length, 1);
  assert.equal(cached.tokens[0].group, "image");
  assert.equal(cached.tokens[0].remainCnyDisplay, "￥73.00");
  assert.deepEqual(cached.quotaPolicy, listed.quotaPolicy);
  assert.equal(requests.length, requestsBeforeCachedRead, "Cached token reads must not access New API");

  const currentSnapshot = tokenSnapshot;
  tokenSnapshot = JSON.parse(JSON.stringify(currentSnapshot));
  tokenSnapshot.version = 1;
  delete tokenSnapshot.entries[Object.keys(tokenSnapshot.entries)[0]].quotaPolicy;
  const legacyCached = await createService().list(stored, { preferCached: true });
  assert.equal(legacyCached.cacheAvailable, true, "Legacy v1 token snapshots must remain readable");
  assert.equal(legacyCached.tokens[0].remainCnyDisplay, "￥73.00");
  tokenSnapshot = currentSnapshot;

  statusAvailable = false;
  const statusFallback = await service.list(stored);
  assert.equal(statusFallback.tokens[0].remainCnyDisplay, "￥73.00", "A failed public status refresh must reuse the cached conversion policy");
  statusAvailable = true;

  const otherAccount = { ...stored, serverUserId: "8" };
  const isolated = await createService().list(otherAccount, { preferCached: true });
  assert.equal(isolated.cacheAvailable, false, "Token snapshots must be isolated by New API user ID");
  assert.equal(isolated.tokens.length, 0);
  await service.select(stored, "11");
  assert.equal(stored.selectedAccountTokenId, "11");
  assert.equal(stored.selectedAccountTokenGroup, "image");
  assert.equal(requests.filter((request) => request.endpoint.endsWith("/key")).length, 1, "Selecting a token must validate and warm its complete key in Main");
  const credentials = await service.credentials(stored);
  assert.equal(credentials.baseUrl, "https://sparkapi.org/v1");
  assert.equal(credentials.apiKey, "sk-secret-11");
  assert.equal(requests.filter((request) => request.endpoint.endsWith("/key")).length, 1, "A validated selection should reuse the Main-only key cache");
  assert.equal(JSON.stringify(stored).includes("sk-secret"), false, "Full keys must not enter persisted settings");

  tokens[0].status = 2;
  await assert.rejects(() => service.select(stored, "11"), /未启用/, "Disabled tokens must not be selectable");
  tokens[0].status = 1;
  tokens[0].expired_time = Math.floor(Date.now() / 1000) - 1;
  await assert.rejects(() => service.select(stored, "11"), /已过期/, "Expired tokens must not be selectable");
  assert.equal(stored.selectedAccountTokenId, "11", "A rejected replacement must not silently clear the current selection");
  tokens[0].expired_time = -1;
  await service.select(stored, "");
  assert.equal(stored.selectedAccountTokenId, "", "The empty selector value must explicitly clear the global selection");
  await service.select(stored, "11");

  service.clearKeyCache();
  tokens[0].key = "stock-new-api-secret-11";
  const keyEndpointCallsBefore = requests.filter((request) => request.endpoint.endsWith("/key")).length;
  const stockCredentials = await service.credentials(stored);
  assert.equal(stockCredentials.apiKey, "stock-new-api-secret-11", "Stock New API keys returned by token detail should remain Main-only and be reusable");
  assert.equal(requests.filter((request) => request.endpoint.endsWith("/key")).length, keyEndpointCallsBefore, "Stock New API compatibility must not require the optional full-key endpoint");
  assert.equal(JSON.stringify(stored).includes("stock-new-api-secret"), false, "Stock New API keys must not enter persisted settings");

  await service.create(stored, { name: "Agent", group: "default", unlimitedQuota: true, select: false });
  assert.equal(stored.selectedAccountTokenId, "11");
  const boundCredentials = await service.credentialsForToken(stored, "12");
  assert.equal(boundCredentials.apiKey, "sk-secret-12");
  assert.equal(boundCredentials.tokenId, "12");
  assert.equal(stored.selectedAccountTokenId, "11", "Per-model credential lookup must not change the global token selection");
  assert.equal(JSON.stringify(tokenSnapshot).includes("sk-secret-12"), false, "Full per-model keys must not enter token snapshots");
  await service.select(stored, "12");
  assert.equal(stored.selectedAccountTokenId, "12");
  await service.update(stored, { id: "12", name: "Agent Pro", group: "vip", unlimitedQuota: false, remainQuota: 1234, status: 1, expiredTime: 1_900_000_000, modelLimitsEnabled: true, modelLimits: "gpt-image-2,gpt-5.6-terra", allowIps: "127.0.0.1\n192.168.1.10", crossGroupRetry: false });
  assert.equal(tokens.find((token) => token.id === 12).group, "vip");
  assert.equal(tokens.find((token) => token.id === 12).expired_time, 1_900_000_000);
  assert.equal(tokens.find((token) => token.id === 12).model_limits_enabled, true);
  assert.equal(tokens.find((token) => token.id === 12).model_limits, "gpt-image-2,gpt-5.6-terra");
  assert.equal(tokens.find((token) => token.id === 12).allow_ips, "127.0.0.1\n192.168.1.10");
  assert.equal(tokens.find((token) => token.id === 12).cross_group_retry, false);
  statusPolicy = { ...statusPolicy, quota_display_type: "USD" };
  const nativeListed = await service.list(stored);
  const inputUnit = nativeListed.quotaPolicy.inputUnit;
  await service.update(stored, { id: "12", remainAmount: 2.25, quotaInput: inputUnit });
  assert.equal(tokens.find((token) => token.id === 12).remain_quota, 1_125_000, "Native USD input must reach New API as raw quota");
  tokens.find((token) => token.id === 12).remain_quota = 1_124_000;
  await service.update(stored, { id: "12", name: "Renamed only" });
  const renamed = tokens.find((token) => token.id === 12);
  assert.equal(renamed.remain_quota, 1_124_000, "An unchanged quota field must preserve the latest server usage");
  assert.equal(renamed.allow_ips, "127.0.0.1\n192.168.1.10");
  assert.equal(renamed.model_limits_enabled, true);
  const writesBeforeInvalidAmount = requests.filter(request => request.method === "PUT").length;
  await assert.rejects(() => service.update(stored, { id: "12", status: 2, remainAmount: -1, quotaInput: inputUnit }), /非负/);
  await assert.rejects(() => service.update(stored, { id: "12", status: 2, remainAmount: 2, quotaInput: { unit: "CNY", quotaPerAmount: 1 } }), /单位已变化/);
  assert.equal(requests.filter(request => request.method === "PUT").length, writesBeforeInvalidAmount, "Invalid amounts must fail before any status or metadata mutation");
  assert.equal(tokens.find((token) => token.id === 12).status, 1);
  await service.remove(stored, "12");
  await service.create(stored, { name: "Native amount", unlimitedQuota: false, remainAmount: 0.125, quotaInput: inputUnit, select: false });
  assert.equal(tokens.find((token) => token.id === 12).remain_quota, 62_500, "Native amounts must also work when creating a key");
  await service.remove(stored, "12");
  assert.equal(tokens.some((token) => token.id === 12), false);
  assert.equal(stored.selectedAccountTokenId, "");
  await service.create(stored, { name: "Disabled draft", status: 2, select: true });
  assert.equal(tokens.find((token) => token.id === 12).status, 2);
  assert.equal(stored.selectedAccountTokenId, "", "Creating a disabled key must not select it");
  await service.remove(stored, "12");
  assert.equal(
    requests.filter((request) => request.endpoint.startsWith("/api/token/")).every((request) => request.userAuth),
    true,
    "Every protected token request must opt into refreshable New API user authentication"
  );

  const transportCalls = [];
  const responsePayload = { id: "response-fixture", output: [{ type: "output_text", text: "ok" }] };
  const client = createNewApiClient({
    defaultSettings: defaults,
    ensureLocalServer: async () => {},
    isLocalServerUrl: () => false,
    migrateSettings,
    newApiTransportFetch: async (url, options) => {
      transportCalls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(responsePayload)
      };
    },
    normalizeServerUrl: (value, fallback = "") => String(value || fallback).replace(/\/+$/, ""),
    readJson: () => stored,
    resolveAccountApiCredentials: (settings, tokenId) => service.credentials(settings, tokenId),
    settingsPath: "fixture.json",
    writeJson: () => {}
  });
  const result = await client.newApiRelayJson(stored, "/v1/responses", { model: "gpt-5.6", group: "must-not-leak" });
  assert.equal(result.id, "response-fixture");
  assert.equal(transportCalls[0].url, "https://sparkapi.org/v1/responses");
  assert.equal(transportCalls[0].headers.authorization, "Bearer stock-new-api-secret-11");
  assert.equal("group" in transportCalls[0].body, false, "Token group is enforced by New API and must not be injected into provider JSON");

  const imageSettings = {
    ...stored,
    imageModelBindings: [{ model: "gpt-image-2", accountTokenId: "11" }]
  };
  await client.newApiRelayJson(imageSettings, "/v1/images/generations", {
    model: "gpt-image-2",
    prompt: "account token image fixture"
  }, { provider: "image" });
  assert.equal(transportCalls[1].url, "https://sparkapi.org/v1/images/generations");
  assert.equal(transportCalls[1].headers.authorization, "Bearer stock-new-api-secret-11", "The selected account token must reach image requests through the model binding");

  process.stdout.write(`${JSON.stringify({ ok: true, tokenRequests: requests.length, transportCalls: transportCalls.length, imageAccountCredential: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
