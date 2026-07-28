"use strict";

let aidebugAuthenticated = true;
let newApiMeInflight = null;

function registerServerIpc({
  ipcMain,
  aidebugLogs,
  aidebugLiveImage,
  aidebugMode,
  aidebugPublicSettings,
  aidebugStatefulAuth,
  aidebugUser,
  aidebugWallet,
  accountTokenService,
  callNewApiImageWithSession,
  clearNewApiAuth,
  completeNewApiLogin,
  customApiCredentials,
  defaultSettings,
  emitAgentProgress,
  extractServerImages,
  getNewApiAuthEpoch,
  isNewApiAuthError,
  log,
  licenseService,
  mapNewApiLogEntry,
  migrateSettings,
  modelSettingsWithCacheMeta,
  newApiModelSettings,
  newApiRequest,
  newApiUserAuthHeaders,
  newApiUserLogsEndpoint,
  normalizeNewApiUser,
  readJson,
  removeOwnedDataUrlTemp,
  settingsPath,
  splitModelSettings,
  tokenItemsFromNewApiPayload,
  walletFromNewApiUser,
  writeDataUrlTemp,
  writeJson,
  writeServerImageOutputs
}) {
  ipcMain.handle("naimage:server:license-status", async (_event, payload = {}) => {
    return await licenseService.verify({ force: payload?.force === true });
  });

  ipcMain.handle("naimage:server:activate-license", async (_event, payload = {}) => {
    return await licenseService.activate(payload?.code);
  });

  ipcMain.handle("naimage:server:configure-custom", async (_event, payload = {}) => {
    const current = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      const next = migrateSettings({
        ...current,
        accessMode: "custom",
        agentBaseUrl: String(payload?.baseUrl || "").trim(),
        agentApiKey: String(payload?.apiKey || "").trim(),
        imageBaseUrl: String(payload?.baseUrl || "").trim(),
        imageApiKey: String(payload?.apiKey || "").trim(),
        modelGroup: "",
        serverToken: "",
        agentModel: String(payload?.agentModel || current.agentModel || "").trim(),
        agentModelPool: String(payload?.agentModel || current.agentModel || "").trim() ? [String(payload?.agentModel || current.agentModel).trim()] : current.agentModelPool,
        imageModel: String(payload?.imageModel || current.imageModel || "").trim(),
        imageModelPool: String(payload?.imageModel || current.imageModel || "").trim() ? [String(payload?.imageModel || current.imageModel).trim()] : current.imageModelPool
      });
      customApiCredentials(next, "agent");
      writeJson(settingsPath, next);
      let modelSettings;
      let warning = "";
      try {
        modelSettings = await newApiModelSettings(next, { forceRefresh: true });
      } catch (error) {
        warning = error instanceof Error ? error.message : String(error);
        if (!next.agentModel && !next.imageModel) throw error;
        modelSettings = modelSettingsWithCacheMeta(splitModelSettings(next, [...next.agentModelPool, ...next.imageModelPool]), "settings", Date.now());
      }
      const license = await licenseService.verify();
      return {
        ok: true,
        user: { id: "custom-api", username: "自定义接口", account: "自定义接口", name: "自定义 API" },
        settings: modelSettings,
        license,
        warning
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`custom API configuration failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("naimage:server:register", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      const username = String((payload ?? {}).username ?? (payload ?? {}).email ?? "").trim();
      const password = String((payload ?? {}).password ?? "");
      if (!username || !password) throw new Error("请输入用户名和密码。");
      if (aidebugMode && !aidebugLiveImage) {
        if (/error|invalid|wrong/i.test(username)) throw new Error("AIDebug 注册失败示例：用户名不可用。");
        if (aidebugStatefulAuth) aidebugAuthenticated = true;
        return {
          ok: true,
          user: { ...aidebugUser(), username, account: username, name: String((payload ?? {}).name || username) },
          wallet: aidebugWallet(),
          settings: aidebugPublicSettings
        };
      }
      await newApiRequest(settings, "/api/user/register", {
        method: "POST",
        body: {
          username,
          password,
          email: (payload ?? {}).email,
          display_name: (payload ?? {}).name || username
        }
      });
      const result = await completeNewApiLogin(settings, { username, password });
      log("new-api register");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`new-api register failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("naimage:server:login", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) {
        const username = String((payload ?? {}).username ?? (payload ?? {}).email ?? "").trim();
        const password = String((payload ?? {}).password ?? "");
        if (!username || !password) throw new Error("请输入用户名和密码。");
        if (/error|invalid|wrong/i.test(username)) throw new Error("用户名或密码错误。");
        if (aidebugStatefulAuth) aidebugAuthenticated = true;
        return {
          ok: true,
          user: { ...aidebugUser(), username, account: username },
          wallet: aidebugWallet(),
          settings: aidebugPublicSettings
        };
      }
      const result = await completeNewApiLogin(settings, payload ?? {});
      log("new-api login");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`new-api login failed ${message}`);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("naimage:server:logout", async () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (aidebugMode && !aidebugLiveImage && aidebugStatefulAuth) aidebugAuthenticated = false;
    let remoteLogout = false;
    try {
      if (!(aidebugMode && !aidebugLiveImage) && settings.serverSessionCookie && settings.serverUserId) {
        await newApiRequest(settings, "/api/user/logout", {
          method: "POST",
          headers: newApiUserAuthHeaders(settings),
          timeoutMs: 5_000,
          retries: 0
        });
        remoteLogout = true;
      }
    } catch (error) {
      log(`new-api remote logout failed ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearNewApiAuth(settings);
    }
    log("new-api logout");
    return { ok: true, remoteLogout };
  });

  ipcMain.handle("naimage:server:me", (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (settings.accessMode === "custom") {
      if (!settings.agentBaseUrl || !settings.agentApiKey) return { ok: false, error: "请先配置自定义 Base URL 和 API Key。" };
      const user = { id: "custom-api", username: "自定义接口", account: "自定义接口", name: "自定义 API" };
      if (payload?.preferCached === true) {
        return {
          ok: true,
          cached: true,
          user,
          settings: modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now())
        };
      }
      return newApiModelSettings(settings).then((modelSettings) => ({ ok: true, user, settings: modelSettings })).catch((error) => ({
        ok: true,
        user,
        settings: modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now()),
        warning: error instanceof Error ? error.message : String(error)
      }));
    }
    if (payload?.preferCached === true && settings.serverSessionCookie && settings.serverUserId && !(aidebugMode && !aidebugLiveImage)) {
      const cachedUser = normalizeNewApiUser({
        id: settings.serverUserId,
        username: "SparkAI 用户",
        display_name: "SparkAI 用户"
      });
      return {
        ok: true,
        cached: true,
        user: cachedUser,
        wallet: walletFromNewApiUser(cachedUser),
        settings: modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now())
      };
    }
    const authEpoch = getNewApiAuthEpoch();
    const inflightKey = `${authEpoch}|${settings.serverUserId}|${settings.serverSessionCookie}`;
    if (newApiMeInflight?.key === inflightKey) return newApiMeInflight.promise;
    const task = (async () => {
      log("new-api me");
      if (aidebugMode && !aidebugLiveImage) {
        if (aidebugStatefulAuth && !aidebugAuthenticated) {
          return { ok: false, error: "登录会话已失效，请重新登录。" };
        }
        return {
          ok: true,
          user: aidebugUser(),
          wallet: aidebugWallet(),
          settings: aidebugPublicSettings
        };
      }
      try {
        if (!settings.serverSessionCookie || !settings.serverUserId) throw new Error("登录会话已失效，请重新登录。");
        let userData = { id: settings.serverUserId };
        try {
          const self = await newApiRequest(settings, "/api/user/self", {
            headers: newApiUserAuthHeaders(settings)
          });
          userData = self?.data || {};
        } catch (error) {
          if (isNewApiAuthError(error)) throw error;
          log(`new-api self in me failed ${error instanceof Error ? error.message : String(error)}`);
        }
        let modelSettings;
        try {
          modelSettings = await newApiModelSettings(settings);
        } catch (error) {
          log(`new-api models in me failed ${error instanceof Error ? error.message : String(error)}`);
          modelSettings = modelSettingsWithCacheMeta(splitModelSettings(settings, []), "settings", Date.now());
        }
        if (authEpoch !== getNewApiAuthEpoch()) {
          return { ok: false, stale: true, error: "登录账户已切换，旧请求结果已丢弃。" };
        }
        return {
          ok: true,
          user: normalizeNewApiUser(userData),
          wallet: walletFromNewApiUser(userData),
          settings: modelSettings
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (authEpoch !== getNewApiAuthEpoch() || error?.code === "NEW_API_SESSION_CHANGED") {
          return { ok: false, stale: true, error: message };
        }
        if (isNewApiAuthError(error)) clearNewApiAuth(settings);
        return { ok: false, error: message };
      }
    })();
    const wrapped = task.finally(() => {
      if (newApiMeInflight?.promise === wrapped) newApiMeInflight = null;
    });
    newApiMeInflight = { key: inflightKey, promise: wrapped };
    return wrapped;
  });

  ipcMain.handle("naimage:server:logs", async () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api logs");
    if (settings.accessMode === "custom") return { ok: true, logs: [] };
    if (aidebugMode && !aidebugLiveImage) return { ok: true, logs: aidebugLogs() };
    try {
      if (!settings.serverSessionCookie || !settings.serverUserId) return { ok: true, logs: [] };
      const response = await newApiRequest(settings, newApiUserLogsEndpoint, {
        headers: newApiUserAuthHeaders(settings)
      });
      return { ok: true, logs: tokenItemsFromNewApiPayload(response).map(mapNewApiLogEntry) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`new-api logs failed ${message}`);
      return { ok: false, error: message, logs: [] };
    }
  });

  ipcMain.handle("naimage:server:models", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (typeof payload?.group === "string") settings.modelGroup = payload.group.trim().slice(0, 120);
    log("new-api models");
    try {
      const modelSettings = await newApiModelSettings(settings, {
        forceRefresh: payload?.forceRefresh === true,
        cacheOnly: payload?.cacheOnly === true
      });
      return { ok: true, settings: modelSettings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, settings: splitModelSettings(settings, []) };
    }
  });

  ipcMain.handle("naimage:server:tokens", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (settings.accessMode === "custom") throw new Error("自定义接口模式不使用 SparkAPI 账户密钥。");
      if (aidebugMode && !aidebugLiveImage) {
        return {
          ok: true,
          cached: payload?.preferCached === true,
          cacheAvailable: true,
          cacheUpdatedAt: Date.now(),
          selectedTokenId: "1",
          baseUrl: "https://sparkapi.org/v1",
          tokens: [{
            id: "1",
            name: "AIDebug 密钥",
            status: 1,
            remainQuota: 5_000_000,
            usedQuota: 500_000,
            unlimitedQuota: false,
            expiredTime: -1,
            createdTime: 0,
            accessedTime: 0,
            group: "default",
            modelLimitsEnabled: false,
            modelLimits: "",
            allowIps: "",
            crossGroupRetry: true
          }]
        };
      }
      return await accountTokenService.list(settings, { preferCached: payload?.preferCached === true });
    } catch (error) {
      return { ok: false, tokens: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:select-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) return { ok: true, selectedTokenId: String(payload.id || "1"), baseUrl: "https://sparkapi.org/v1" };
      return await accountTokenService.select(settings, payload.id);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:create-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) throw new Error("AIDebug 不会修改远端密钥。");
      return await accountTokenService.create(settings, payload);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:update-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) throw new Error("AIDebug 不会修改远端密钥。");
      return await accountTokenService.update(settings, payload);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:delete-token", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    try {
      if (aidebugMode && !aidebugLiveImage) throw new Error("AIDebug 不会修改远端密钥。");
      return await accountTokenService.remove(settings, payload.id);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("naimage:server:recharge", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api recharge requested");
    return {
      ok: false,
      error: "New API 充值需要走服务端支付/兑换流程，本地测试充值接口已移除。",
      user: settings.serverUserId ? { id: settings.serverUserId } : undefined
    };
  });

  ipcMain.handle("naimage:server:generate-image", async (event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    const runId = String((payload ?? {}).runId || `run-${Date.now()}`);
    const projectId = (payload ?? {}).projectId;
    const ownedMaskImage = (payload ?? {}).maskDataUrl
      ? writeDataUrlTemp((payload ?? {}).maskDataUrl, `mask-${runId.replace(/[^a-z0-9_-]/gi, "-")}`, projectId)
      : null;
    try {
      const maskImage = ownedMaskImage || (payload ?? {}).maskImage;
      const data = await callNewApiImageWithSession(settings, {
        prompt: (payload ?? {}).prompt,
        model: (payload ?? {}).model,
        size: (payload ?? {}).size || settings.imageSize,
        quality: (payload ?? {}).quality || settings.imageQuality,
        count: (payload ?? {}).count || settings.imageCount,
        referenceImages: Array.isArray((payload ?? {}).referenceImages) ? (payload ?? {}).referenceImages : [],
        editImage: (payload ?? {}).editImage,
        maskImage,
        outputFormat: (payload ?? {}).outputFormat ?? (payload ?? {}).output_format,
        outputCompression: (payload ?? {}).outputCompression ?? (payload ?? {}).output_compression,
        background: (payload ?? {}).background,
        moderation: (payload ?? {}).moderation,
        inputFidelity: (payload ?? {}).inputFidelity ?? (payload ?? {}).input_fidelity,
        mode: (payload ?? {}).mode,
        runId,
        projectId,
        onRetry: (retry) => emitAgentProgress(event.sender, runId, {
          phase: "image-retry",
          tool: "image_gen",
          toolRunId: runId,
          summary: retry?.category === "timeout"
            ? "图片请求超时，正在进行唯一一次补试。"
            : `图片服务暂时不稳定，正在重试 ${retry?.retryCount || 1}/${retry?.maxRetries || 5}。`,
          detail: `第 ${Number(retry?.index || 0) + 1}/${retry?.count || 1} 张 · ${retry?.category || "transient"}`,
          retryCount: retry?.retryCount,
          maxRetries: retry?.maxRetries,
          errorCategory: retry?.category,
          projectId
        })
      });
      const stem = `basic-${runId.replace(/[^a-z0-9_-]/gi, "-")}`;
      const outputFormat = (payload ?? {}).outputFormat ?? (payload ?? {}).output_format ?? data.outputFormat ?? data.output_format ?? "png";
      const assets = writeServerImageOutputs(extractServerImages(data), stem, runId, projectId, outputFormat);
      log(`new-api generate image returned=${assets.length}`);
      return { ...data, assets, runId, returned: assets.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/invalid token|unauthorized|401/i.test(message)) {
        clearNewApiAuth(settings);
      }
      log(`new-api generate image failed ${message}`);
      const data = error && typeof error === "object" && error.data && typeof error.data === "object" ? error.data : {};
      return {
        ...data,
        ok: false,
        error: message,
        errorCategory: error && typeof error === "object" ? error.errorCategory : undefined,
        retryCount: error && typeof error === "object" ? error.retryCount : undefined,
        attempts: error && typeof error === "object" ? error.attempts : undefined,
        runId,
        assets: []
      };
    } finally {
      removeOwnedDataUrlTemp(ownedMaskImage, projectId);
    }
  });
}

module.exports = { registerServerIpc };
