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
  callNewApiImageWithSession,
  clearNewApiAuth,
  completeNewApiLogin,
  defaultSettings,
  emitAgentProgress,
  extractServerImages,
  getNewApiAuthEpoch,
  isNewApiAuthError,
  log,
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
  writeServerImageOutputs
}) {
  ipcMain.handle("iiimage:server:register", async (_event, payload) => {
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

  ipcMain.handle("iiimage:server:login", async (_event, payload) => {
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

  ipcMain.handle("iiimage:server:logout", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (aidebugMode && !aidebugLiveImage && aidebugStatefulAuth) aidebugAuthenticated = false;
    clearNewApiAuth(settings);
    log("new-api logout");
    return { ok: true };
  });

  ipcMain.handle("iiimage:server:me", () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
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
        try {
          const session = await newApiRequest(settings, "/api/crm/session/self", {
            headers: newApiUserAuthHeaders(settings)
          });
          const crmSession = session?.data || session || {};
          if (crmSession?.currentUser) {
            userData = { ...userData, ...crmSession.currentUser };
          }
        } catch (error) {
          log(`crm session in me failed ${error instanceof Error ? error.message : String(error)}`);
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

  ipcMain.handle("iiimage:server:logs", async () => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api logs");
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

  ipcMain.handle("iiimage:server:models", async (_event, payload = {}) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api models");
    try {
      const modelSettings = await newApiModelSettings(settings, { forceRefresh: payload?.forceRefresh === true });
      return { ok: true, settings: modelSettings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, settings: splitModelSettings(settings, []) };
    }
  });

  ipcMain.handle("iiimage:server:recharge", async (_event, payload) => {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    log("new-api recharge requested");
    return {
      ok: false,
      error: "New API 充值需要走服务端支付/兑换流程，本地测试充值接口已移除。",
      user: settings.serverUserId ? { id: settings.serverUserId } : undefined
    };
  });

  ipcMain.handle("iiimage:server:generate-image", async (event, payload) => {
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
