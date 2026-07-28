"use strict";

const {
  accountTokenQuotaFields,
  normalizeAccountQuotaPolicy
} = require("./account-token-quota.cjs");

const NEW_API_TOKEN_PAGE_SIZE = 100;
const TOKEN_STATUS_ENABLED = 1;
const TOKEN_SNAPSHOT_VERSION = 2;
const LEGACY_TOKEN_SNAPSHOT_VERSION = 1;
const TOKEN_SNAPSHOT_MAX_ENTRIES = 8;

function tokenItemsFromPayload(payload) {
  const source = payload?.data ?? payload;
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.items)) return source.items;
  if (Array.isArray(source?.data)) return source.data;
  return [];
}

function normalizeTokenId(value) {
  const id = Math.floor(Number(value) || 0);
  if (id <= 0) throw new Error("请选择有效的账户密钥。");
  return id;
}

function normalizeAccountApiBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("账户服务地址未配置。");
  return /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}

function fullKeyFromToken(value = {}) {
  const key = String(value.key || "").trim();
  if (!key || key.includes("*")) return "";
  return key;
}

function publicToken(value = {}, quotaPolicy = {}) {
  const token = {
    id: String(Math.floor(Number(value.id) || 0)),
    name: String(value.name || "未命名密钥").trim().slice(0, 50),
    status: Math.floor(Number(value.status) || 0),
    remainQuota: Math.max(0, Math.floor(Number(value.remain_quota) || 0)),
    usedQuota: Math.max(0, Math.floor(Number(value.used_quota) || 0)),
    unlimitedQuota: value.unlimited_quota === true,
    expiredTime: Math.floor(Number(value.expired_time) || -1),
    createdTime: Math.max(0, Math.floor(Number(value.created_time) || 0)),
    accessedTime: Math.max(0, Math.floor(Number(value.accessed_time) || 0)),
    group: String(value.group || "default").trim().slice(0, 120) || "default",
    modelLimitsEnabled: value.model_limits_enabled === true,
    modelLimits: String(value.model_limits || "").trim().slice(0, 20_000),
    allowIps: String(value.allow_ips || "").trim().slice(0, 4_096),
    crossGroupRetry: value.cross_group_retry === true || value.cross_group_retry === 1
  };
  return { ...token, ...accountTokenQuotaFields(token.remainQuota, token.unlimitedQuota, quotaPolicy) };
}

function cachedPublicToken(value = {}, quotaPolicy = {}) {
  const token = {
    id: String(Math.floor(Number(value.id) || 0)),
    name: String(value.name || "未命名密钥").trim().slice(0, 50),
    status: Math.floor(Number(value.status) || 0),
    remainQuota: Math.max(0, Math.floor(Number(value.remainQuota) || 0)),
    usedQuota: Math.max(0, Math.floor(Number(value.usedQuota) || 0)),
    unlimitedQuota: value.unlimitedQuota === true,
    expiredTime: Math.floor(Number(value.expiredTime) || -1),
    createdTime: Math.max(0, Math.floor(Number(value.createdTime) || 0)),
    accessedTime: Math.max(0, Math.floor(Number(value.accessedTime) || 0)),
    group: String(value.group || "default").trim().slice(0, 120) || "default",
    modelLimitsEnabled: false,
    modelLimits: "",
    allowIps: "",
    crossGroupRetry: value.crossGroupRetry !== false
  };
  return { ...token, ...accountTokenQuotaFields(token.remainQuota, token.unlimitedQuota, quotaPolicy) };
}

function tokenSnapshotRecord(value = {}) {
  const token = cachedPublicToken(value);
  return {
    id: token.id,
    name: token.name,
    status: token.status,
    remainQuota: token.remainQuota,
    usedQuota: token.usedQuota,
    unlimitedQuota: token.unlimitedQuota,
    expiredTime: token.expiredTime,
    createdTime: token.createdTime,
    accessedTime: token.accessedTime,
    group: token.group,
    crossGroupRetry: token.crossGroupRetry
  };
}

function createAccountTokenService({
  defaultSettings,
  log = () => {},
  migrateSettings,
  newApiRequest,
  newApiUserAuthHeaders,
  readJson,
  requireNewApiSession,
  resolveNewApiBaseUrl,
  tokenCachePath,
  settingsPath,
  writeJson
}) {
  const keyCache = new Map();

  function snapshotKey(settings) {
    return [
      resolveNewApiBaseUrl(settings, "account").toLowerCase(),
      String(settings.serverUserId || "")
    ].join("|");
  }

  function readSnapshots() {
    if (!tokenCachePath) return { version: TOKEN_SNAPSHOT_VERSION, entries: {} };
    const stored = readJson(tokenCachePath, { version: TOKEN_SNAPSHOT_VERSION, entries: {} });
    return (stored?.version === TOKEN_SNAPSHOT_VERSION || stored?.version === LEGACY_TOKEN_SNAPSHOT_VERSION) && stored.entries && typeof stored.entries === "object"
      ? { version: TOKEN_SNAPSHOT_VERSION, entries: stored.entries }
      : { version: TOKEN_SNAPSHOT_VERSION, entries: {} };
  }

  function writeSnapshots(entries) {
    if (!tokenCachePath) return;
    const boundedEntries = Object.fromEntries(
      Object.entries(entries)
        .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
        .slice(0, TOKEN_SNAPSHOT_MAX_ENTRIES)
    );
    writeJson(tokenCachePath, { version: TOKEN_SNAPSHOT_VERSION, entries: boundedEntries });
  }

  function quotaPolicyFromSnapshot(settings) {
    const snapshot = readSnapshots().entries[snapshotKey(settings)];
    return normalizeAccountQuotaPolicy(snapshot?.quotaPolicy);
  }

  async function loadQuotaPolicy(settings) {
    try {
      return normalizeAccountQuotaPolicy(await newApiRequest(settings, "/api/status", { retries: 0 }));
    } catch (error) {
      log(`new-api quota policy failed ${error instanceof Error ? error.message : String(error)}`);
      return quotaPolicyFromSnapshot(settings);
    }
  }

  function persistTokenSnapshot(settings, tokens, selectedTokenId, quotaPolicy, updatedAt = Date.now()) {
    if (!tokenCachePath) return;
    const snapshots = readSnapshots();
    snapshots.entries[snapshotKey(settings)] = {
      updatedAt: Math.max(0, Math.floor(Number(updatedAt) || Date.now())),
      selectedTokenId: String(selectedTokenId || ""),
      baseUrl: normalizeAccountApiBaseUrl(resolveNewApiBaseUrl(settings, "account")),
      quotaPolicy: normalizeAccountQuotaPolicy(quotaPolicy),
      tokens: (Array.isArray(tokens) ? tokens : [])
        .map(tokenSnapshotRecord)
        .filter((token) => Number(token.id) > 0)
        .slice(0, NEW_API_TOKEN_PAGE_SIZE)
    };
    writeSnapshots(snapshots.entries);
  }

  function updateCachedSelection(settings, token = null) {
    if (!tokenCachePath) return;
    const snapshots = readSnapshots();
    const key = snapshotKey(settings);
    const current = snapshots.entries[key];
    if (!current) return;
    const tokens = Array.isArray(current.tokens) ? current.tokens.map(tokenSnapshotRecord) : [];
    const nextToken = token ? tokenSnapshotRecord(token) : null;
    const nextTokens = nextToken && Number(nextToken.id) > 0
      ? [...tokens.filter((item) => item.id !== nextToken.id), nextToken]
      : tokens;
    snapshots.entries[key] = {
      ...current,
      selectedTokenId: nextToken?.id || "",
      tokens: nextTokens
    };
    writeSnapshots(snapshots.entries);
  }

  function cachedList(settings) {
    requireNewApiSession(settings);
    const snapshots = readSnapshots();
    const snapshot = snapshots.entries[snapshotKey(settings)];
    const baseUrl = normalizeAccountApiBaseUrl(resolveNewApiBaseUrl(settings, "account"));
    const quotaPolicy = normalizeAccountQuotaPolicy(snapshot?.quotaPolicy);
    if (!snapshot) {
      return {
        ok: true,
        cached: true,
        cacheAvailable: false,
        cacheUpdatedAt: 0,
        tokens: [],
        selectedTokenId: String(settings.selectedAccountTokenId || ""),
        baseUrl,
        quotaPolicy
      };
    }
    return {
      ok: true,
      cached: true,
      cacheAvailable: true,
      cacheUpdatedAt: Math.max(0, Math.floor(Number(snapshot.updatedAt) || 0)),
      tokens: (Array.isArray(snapshot.tokens) ? snapshot.tokens : []).map((token) => cachedPublicToken(token, quotaPolicy)).filter((token) => Number(token.id) > 0),
      selectedTokenId: String(snapshot.selectedTokenId || settings.selectedAccountTokenId || ""),
      baseUrl: String(snapshot.baseUrl || baseUrl),
      quotaPolicy
    };
  }

  function cacheKey(settings, tokenId) {
    return [
      resolveNewApiBaseUrl(settings, "account").toLowerCase(),
      String(settings.serverUserId || ""),
      String(tokenId)
    ].join("|");
  }

  function clearKeyCache() {
    keyCache.clear();
  }

  function persistSelection(settings, token = null) {
    const stored = migrateSettings(readJson(settingsPath, defaultSettings));
    if (
      String(stored.serverUserId || "") !== String(settings.serverUserId || "") ||
      resolveNewApiBaseUrl(stored, "account").toLowerCase() !== resolveNewApiBaseUrl(settings, "account").toLowerCase()
    ) {
      throw new Error("登录账户已切换，密钥选择结果已丢弃。");
    }
    const next = migrateSettings({
      ...stored,
      selectedAccountTokenId: token?.id || "",
      selectedAccountTokenName: token?.name || "",
      selectedAccountTokenGroup: token?.group || ""
    });
    writeJson(settingsPath, next);
    settings.selectedAccountTokenId = next.selectedAccountTokenId;
    settings.selectedAccountTokenName = next.selectedAccountTokenName;
    settings.selectedAccountTokenGroup = next.selectedAccountTokenGroup;
    updateCachedSelection(settings, token);
    return next;
  }

  async function list(settings, options = {}) {
    if (options?.preferCached === true) return cachedList(settings);
    requireNewApiSession(settings);
    const [response, quotaPolicy] = await Promise.all([
      newApiRequest(settings, `/api/token/?p=1&size=${NEW_API_TOKEN_PAGE_SIZE}`, {
        headers: newApiUserAuthHeaders(settings),
        retries: 0
      }),
      loadQuotaPolicy(settings)
    ]);
    const tokens = tokenItemsFromPayload(response)
      .map((value) => {
        const token = publicToken(value, quotaPolicy);
        const apiKey = fullKeyFromToken(value);
        if (apiKey && Number(token.id) > 0) keyCache.set(cacheKey(settings, token.id), apiKey);
        return token;
      })
      .filter((token) => Number(token.id) > 0);
    let selectedTokenId = String(settings.selectedAccountTokenId || "");
    if (selectedTokenId && !tokens.some((token) => token.id === selectedTokenId)) {
      clearKeyCache();
      persistSelection(settings, null);
      selectedTokenId = "";
    }
    const result = {
      ok: true,
      tokens,
      selectedTokenId,
      baseUrl: normalizeAccountApiBaseUrl(resolveNewApiBaseUrl(settings, "account")),
      quotaPolicy,
      cached: false,
      cacheAvailable: true,
      cacheUpdatedAt: Date.now()
    };
    persistTokenSnapshot(settings, tokens, selectedTokenId, quotaPolicy, result.cacheUpdatedAt);
    return result;
  }

  async function tokenById(settings, tokenId) {
    requireNewApiSession(settings);
    const id = normalizeTokenId(tokenId);
    const response = await newApiRequest(settings, `/api/token/${id}`, {
      headers: newApiUserAuthHeaders(settings),
      retries: 0
    });
    const rawToken = response?.data ?? response;
    const token = publicToken(rawToken, quotaPolicyFromSnapshot(settings));
    if (Number(token.id) !== id) throw new Error("账户服务没有返回所选密钥。");
    const apiKey = fullKeyFromToken(rawToken);
    if (apiKey) keyCache.set(cacheKey(settings, id), apiKey);
    return token;
  }

  async function select(settings, tokenId) {
    const token = await tokenById(settings, tokenId);
    if (token.status !== TOKEN_STATUS_ENABLED) throw new Error("该密钥当前未启用，请先启用后再选择。");
    persistSelection(settings, token);
    return {
      ok: true,
      token,
      selectedTokenId: token.id,
      baseUrl: normalizeAccountApiBaseUrl(resolveNewApiBaseUrl(settings, "account"))
    };
  }

  async function ensureSelection(settings) {
    const selectedId = String(settings.selectedAccountTokenId || "");
    if (selectedId) {
      try {
        const token = await tokenById(settings, selectedId);
        if (token.status === TOKEN_STATUS_ENABLED) return token;
      } catch (error) {
        log(`account token selection invalid ${error instanceof Error ? error.message : String(error)}`);
      }
      clearKeyCache();
      persistSelection(settings, null);
    }
    const result = await list(settings);
    const token = result.tokens.find((item) => item.status === TOKEN_STATUS_ENABLED && (item.expiredTime < 0 || item.expiredTime > Math.floor(Date.now() / 1000)));
    if (!token) throw new Error("当前账户没有可用密钥，请在设置中创建或启用一枚密钥。");
    persistSelection(settings, token);
    return token;
  }

  async function fullKey(settings, tokenId) {
    const id = normalizeTokenId(tokenId);
    const key = cacheKey(settings, id);
    if (keyCache.has(key)) return keyCache.get(key);
    requireNewApiSession(settings);
    const response = await newApiRequest(settings, `/api/token/${id}/key`, {
      method: "POST",
      headers: newApiUserAuthHeaders(settings),
      retries: 0
    });
    const apiKey = String(response?.data?.key || response?.key || "").trim();
    if (!apiKey) throw new Error("账户服务没有返回所选密钥的完整 Key。");
    keyCache.set(key, apiKey);
    return apiKey;
  }

  async function credentials(settings) {
    const token = await ensureSelection(settings);
    const apiKey = await fullKey(settings, token.id);
    return {
      baseUrl: normalizeAccountApiBaseUrl(resolveNewApiBaseUrl(settings, "account")),
      apiKey,
      tokenId: token.id,
      tokenName: token.name,
      group: token.group
    };
  }

  function tokenPayload(input = {}, current = {}) {
    const name = String(input.name ?? current.name ?? "").trim().slice(0, 50);
    if (!name) throw new Error("请输入密钥名称。");
    const unlimitedQuota = input.unlimitedQuota === undefined
      ? current.unlimitedQuota === true
      : input.unlimitedQuota === true;
    const remainQuota = Math.max(0, Math.floor(Number(input.remainQuota ?? current.remainQuota) || 0));
    const expiredTime = Math.floor(Number(input.expiredTime ?? current.expiredTime ?? -1) || -1);
    const modelLimits = String(input.modelLimits ?? current.modelLimits ?? "").trim().slice(0, 20_000);
    return {
      name,
      remain_quota: unlimitedQuota ? 0 : remainQuota,
      expired_time: expiredTime > 0 ? expiredTime : -1,
      unlimited_quota: unlimitedQuota,
      model_limits_enabled: input.modelLimitsEnabled === undefined ? Boolean(current.modelLimitsEnabled && modelLimits) : input.modelLimitsEnabled === true && Boolean(modelLimits),
      model_limits: modelLimits,
      allow_ips: String(input.allowIps ?? current.allowIps ?? "").trim().slice(0, 4_096),
      group: String(input.group ?? current.group ?? "default").trim().slice(0, 120) || "default",
      cross_group_retry: input.crossGroupRetry === undefined ? current.crossGroupRetry !== false : input.crossGroupRetry === true
    };
  }

  async function create(settings, input = {}) {
    requireNewApiSession(settings);
    await newApiRequest(settings, "/api/token/", {
      method: "POST",
      headers: newApiUserAuthHeaders(settings),
      body: tokenPayload(input),
      retries: 0
    });
    const result = await list(settings);
    const created = result.tokens
      .filter((token) => token.name === String(input.name || "").trim())
      .sort((left, right) => Number(right.id) - Number(left.id))[0] || result.tokens.sort((left, right) => Number(right.id) - Number(left.id))[0];
    if (created && input.select !== false && created.status === TOKEN_STATUS_ENABLED) await select(settings, created.id);
    return { ...await list(settings), createdTokenId: created?.id || "" };
  }

  async function update(settings, input = {}) {
    const id = normalizeTokenId(input.id);
    const current = await tokenById(settings, id);
    const desiredStatus = input.status === undefined ? current.status : Math.floor(Number(input.status) || 0);
    if (desiredStatus !== current.status) {
      await newApiRequest(settings, "/api/token/?status_only=true", {
        method: "PUT",
        headers: newApiUserAuthHeaders(settings),
        body: { id, status: desiredStatus },
        retries: 0
      });
    }
    const response = await newApiRequest(settings, "/api/token/", {
      method: "PUT",
      headers: newApiUserAuthHeaders(settings),
      body: { id, ...tokenPayload(input, current) },
      retries: 0
    });
    clearKeyCache();
    const token = response?.data
      ? publicToken(response.data, quotaPolicyFromSnapshot(settings))
      : await tokenById(settings, id);
    if (String(settings.selectedAccountTokenId || "") === String(id)) {
      if (desiredStatus === TOKEN_STATUS_ENABLED) persistSelection(settings, token);
      else persistSelection(settings, null);
    }
    return { ...await list(settings), updatedTokenId: String(id) };
  }

  async function remove(settings, tokenId) {
    const id = normalizeTokenId(tokenId);
    requireNewApiSession(settings);
    await newApiRequest(settings, `/api/token/${id}/`, {
      method: "DELETE",
      headers: newApiUserAuthHeaders(settings),
      retries: 0
    });
    clearKeyCache();
    if (String(settings.selectedAccountTokenId || "") === String(id)) persistSelection(settings, null);
    return { ...await list(settings), deletedTokenId: String(id) };
  }

  return {
    clearKeyCache,
    create,
    credentials,
    ensureSelection,
    list,
    remove,
    select,
    update
  };
}

module.exports = {
  NEW_API_TOKEN_PAGE_SIZE,
  TOKEN_STATUS_ENABLED,
  TOKEN_SNAPSHOT_MAX_ENTRIES,
  TOKEN_SNAPSHOT_VERSION,
  cachedPublicToken,
  createAccountTokenService,
  normalizeAccountApiBaseUrl,
  publicToken,
  fullKeyFromToken,
  tokenItemsFromPayload
};
