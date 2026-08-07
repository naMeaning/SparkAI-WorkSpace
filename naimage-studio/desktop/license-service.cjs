"use strict";

const VERIFY_TTL_SECONDS = 24 * 60 * 60;
const OFFLINE_GRACE_SECONDS = 72 * 60 * 60;

function createLicenseService({
  defaultSettings,
  log = () => {},
  migrateSettings,
  newApiRequest,
  newApiUserAuthHeaders,
  readJson,
  settingsPath,
  writeJson
}) {
  let verificationInflight = null;

  function storedSettings() {
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    if (!readJson(settingsPath, defaultSettings)?.licenseDeviceId) writeJson(settingsPath, settings);
    return settings;
  }

  function publicStatus(settings, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Math.max(0, Number(settings.licenseExpiresAt) || 0);
    const active = Boolean(settings.licenseToken) && (!expiresAt || expiresAt > now);
    return {
      ok: true,
      active,
      required: false,
      supported: true,
      plan: settings.licensePlan || "",
      expiresAt,
      verifiedAt: Math.max(0, Number(settings.licenseLastVerifiedAt) || 0),
      ...overrides
    };
  }

  async function licenseConfig(settings) {
    try {
      const response = await newApiRequest(settings, "/api/naimage/license", {
        timeoutMs: 8_000,
        retries: 1
      });
      return {
        supported: true,
        required: response?.data?.required === true,
        verificationTtlSeconds: Math.max(60, Number(response?.data?.verification_ttl_seconds) || VERIFY_TTL_SECONDS),
        offlineGraceSeconds: Math.max(0, Number(response?.data?.offline_grace_seconds) || OFFLINE_GRACE_SECONDS)
      };
    } catch (error) {
      if (Number(error?.status) === 404) {
        return { supported: false, required: false, verificationTtlSeconds: VERIFY_TTL_SECONDS, offlineGraceSeconds: OFFLINE_GRACE_SECONDS };
      }
      throw error;
    }
  }

  function licenseEndpoint(settings, action) {
    const accountBound = settings.accessMode === "account" && settings.serverSessionCookie && settings.serverUserId;
    return accountBound ? `/api/naimage/license/account/${action}` : `/api/naimage/license/${action}`;
  }

  async function verify(options = {}) {
    if (verificationInflight && options.force !== true) return verificationInflight;
    const task = (async () => {
      const settings = storedSettings();
      let config;
      try {
        config = await licenseConfig(settings);
      } catch (error) {
        const now = Math.floor(Date.now() / 1000);
        const verifiedAt = Math.max(0, Number(settings.licenseLastVerifiedAt) || 0);
        const expiresAt = Math.max(0, Number(settings.licenseExpiresAt) || 0);
        if (settings.licenseToken && verifiedAt && now-verifiedAt <= OFFLINE_GRACE_SECONDS && (!expiresAt || expiresAt > now)) {
          return publicStatus(settings, { required: true, grace: true, error: "授权服务暂时不可用，正在使用离线宽限期。" });
        }
        return publicStatus(settings, { ok: false, active: false, required: true, error: error instanceof Error ? error.message : String(error) });
      }

      if (!config.required) {
        return publicStatus(settings, { active: true, required: false, supported: config.supported });
      }
      if (!settings.licenseToken) {
        return publicStatus(settings, { active: false, required: true, supported: config.supported, error: "请输入激活码后继续。" });
      }
      const now = Math.floor(Date.now() / 1000);
      const verifiedAt = Math.max(0, Number(settings.licenseLastVerifiedAt) || 0);
      const expiresAt = Math.max(0, Number(settings.licenseExpiresAt) || 0);
      if (options.force !== true && verifiedAt && now-verifiedAt < config.verificationTtlSeconds && (!expiresAt || expiresAt > now)) {
        return publicStatus(settings, { active: true, required: true, supported: true });
      }
      try {
        const response = await newApiRequest(settings, licenseEndpoint(settings, "verify"), {
          method: "POST",
          headers: settings.accessMode === "account" ? newApiUserAuthHeaders(settings) : {},
          body: { token: settings.licenseToken, device_id: settings.licenseDeviceId },
          timeoutMs: 10_000,
          retries: 0
        });
        const data = response?.data || {};
        const next = migrateSettings({
          ...settings,
          licensePlan: String(data.plan || settings.licensePlan || ""),
          licenseExpiresAt: Math.max(0, Number(data.expires_at) || 0),
          licenseLastVerifiedAt: Math.max(now, Number(data.verified_at) || 0)
        });
        writeJson(settingsPath, next);
        return publicStatus(next, { active: true, required: true, supported: true });
      } catch (error) {
        const status = Number(error?.status) || 0;
        if ((!status || status >= 500) && verifiedAt && now-verifiedAt <= config.offlineGraceSeconds && (!expiresAt || expiresAt > now)) {
          return publicStatus(settings, { active: true, required: true, supported: true, grace: true, error: "授权服务暂时不可用，正在使用离线宽限期。" });
        }
        return publicStatus(settings, { ok: false, active: false, required: true, supported: true, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    const wrapped = task.finally(() => {
      if (verificationInflight === wrapped) verificationInflight = null;
    });
    verificationInflight = wrapped;
    return wrapped;
  }

  async function activate(code) {
    const settings = storedSettings();
    const cleanCode = String(code || "").trim();
    if (cleanCode.length < 12) return publicStatus(settings, { ok: false, active: false, required: true, error: "请输入有效激活码。" });
    try {
      const response = await newApiRequest(settings, licenseEndpoint(settings, "activate"), {
        method: "POST",
        headers: settings.accessMode === "account" ? newApiUserAuthHeaders(settings) : {},
        body: { code: cleanCode, device_id: settings.licenseDeviceId },
        timeoutMs: 12_000,
        retries: 0
      });
      const data = response?.data || {};
      if (!data.token) throw new Error("授权服务没有返回激活令牌。");
      const now = Math.floor(Date.now() / 1000);
      const next = migrateSettings({
        ...settings,
        licenseToken: String(data.token),
        licensePlan: String(data.plan || "standard"),
        licenseExpiresAt: Math.max(0, Number(data.expires_at) || 0),
        licenseLastVerifiedAt: now
      });
      writeJson(settingsPath, next);
      log(`naimage license activated mode=${next.accessMode} plan=${next.licensePlan || "standard"}`);
      return publicStatus(next, { active: true, required: true, supported: true });
    } catch (error) {
      return publicStatus(settings, { ok: false, active: false, required: true, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function requireActive() {
    const status = await verify();
    if (!status.active) {
      const error = new Error(status.error || "SparkAI WorkSpace 尚未激活。");
      error.code = "NAIMAGE_LICENSE_REQUIRED";
      throw error;
    }
    return status;
  }

  return { activate, requireActive, verify };
}

module.exports = { createLicenseService };
