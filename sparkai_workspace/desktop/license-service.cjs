"use strict";

const VERIFY_TTL_SECONDS = 24 * 60 * 60;
const OFFLINE_GRACE_SECONDS = 72 * 60 * 60;
const LICENSE_SCOPE_ACCOUNT = "account";
const LICENSE_SCOPE_CUSTOM = "custom";
const REQUIRED_CUSTOM_PLAN = "pro";

function normalizedPlan(value) {
  return String(value || "").trim().toLowerCase();
}

function createLicenseService({
  defaultSettings,
  licenseBaseUrl = "https://sparkapi.org",
  log = () => {},
  migrateSettings,
  newApiRequest,
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

  function requestedScope(settings, options = {}) {
    if (options.scope === LICENSE_SCOPE_CUSTOM) return LICENSE_SCOPE_CUSTOM;
    if (options.scope === LICENSE_SCOPE_ACCOUNT) return LICENSE_SCOPE_ACCOUNT;
    return settings.accessMode === LICENSE_SCOPE_CUSTOM ? LICENSE_SCOPE_CUSTOM : LICENSE_SCOPE_ACCOUNT;
  }

  function publicStatus(settings, scope, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Math.max(0, Number(settings.licenseExpiresAt) || 0);
    const storedLicenseActive = Boolean(settings.licenseToken)
      && normalizedPlan(settings.licensePlan) === REQUIRED_CUSTOM_PLAN
      && (!expiresAt || expiresAt > now);
    return {
      ok: true,
      active: scope === LICENSE_SCOPE_ACCOUNT ? true : storedLicenseActive,
      required: scope === LICENSE_SCOPE_CUSTOM,
      supported: true,
      scope,
      plan: settings.licensePlan || "",
      expiresAt,
      verifiedAt: Math.max(0, Number(settings.licenseLastVerifiedAt) || 0),
      ...(scope === LICENSE_SCOPE_CUSTOM ? { requiredPlan: REQUIRED_CUSTOM_PLAN } : {}),
      ...overrides
    };
  }

  function officialLicenseRequest(settings, endpoint, options = {}) {
    const baseUrl = String(licenseBaseUrl || "https://sparkapi.org").trim().replace(/\/+$/, "");
    const absoluteUrl = new URL(String(endpoint || ""), `${baseUrl}/`).toString();
    return newApiRequest(settings, endpoint, {
      ...options,
      absoluteUrl,
      requestBaseUrl: baseUrl
    });
  }

  async function licenseConfig(settings) {
    try {
      const response = await officialLicenseRequest(settings, "/api/naimage/license", {
        timeoutMs: 8_000,
        retries: 1
      });
      return {
        supported: response?.data?.supports_custom_api_mode !== false,
        verificationTtlSeconds: Math.max(60, Number(response?.data?.verification_ttl_seconds) || VERIFY_TTL_SECONDS),
        offlineGraceSeconds: Math.max(0, Number(response?.data?.offline_grace_seconds) || OFFLINE_GRACE_SECONDS)
      };
    } catch (error) {
      if (Number(error?.status) === 404) {
        return { supported: false, verificationTtlSeconds: VERIFY_TTL_SECONDS, offlineGraceSeconds: OFFLINE_GRACE_SECONDS };
      }
      throw error;
    }
  }

  async function verify(options = {}) {
    const settings = storedSettings();
    const scope = requestedScope(settings, options);
    if (scope === LICENSE_SCOPE_ACCOUNT) {
      return publicStatus(settings, scope, { active: true, required: false });
    }
    if (verificationInflight && options.force !== true) return verificationInflight;

    const task = (async () => {
      let config;
      try {
        config = await licenseConfig(settings);
      } catch (error) {
        const now = Math.floor(Date.now() / 1000);
        const verifiedAt = Math.max(0, Number(settings.licenseLastVerifiedAt) || 0);
        const expiresAt = Math.max(0, Number(settings.licenseExpiresAt) || 0);
        if (
          settings.licenseToken
          && normalizedPlan(settings.licensePlan) === REQUIRED_CUSTOM_PLAN
          && verifiedAt
          && now - verifiedAt <= OFFLINE_GRACE_SECONDS
          && (!expiresAt || expiresAt > now)
        ) {
          return publicStatus(settings, scope, { active: true, grace: true, error: "授权服务暂时不可用，正在使用离线宽限期。" });
        }
        return publicStatus(settings, scope, { ok: false, active: false, supported: false, error: error instanceof Error ? error.message : String(error) });
      }

      if (!config.supported) {
        return publicStatus(settings, scope, {
          ok: false,
          active: false,
          supported: false,
          error: "当前授权服务不支持自定义 Base URL 的 Pro License。"
        });
      }
      if (!settings.licenseToken || normalizedPlan(settings.licensePlan) !== REQUIRED_CUSTOM_PLAN) {
        return publicStatus(settings, scope, { active: false, error: "请输入 Pro 兑换码后继续。" });
      }

      const now = Math.floor(Date.now() / 1000);
      const verifiedAt = Math.max(0, Number(settings.licenseLastVerifiedAt) || 0);
      const expiresAt = Math.max(0, Number(settings.licenseExpiresAt) || 0);
      if (options.force !== true && verifiedAt && now - verifiedAt < config.verificationTtlSeconds && (!expiresAt || expiresAt > now)) {
        return publicStatus(settings, scope, { active: true });
      }

      try {
        const response = await officialLicenseRequest(settings, "/api/naimage/license/verify", {
          method: "POST",
          body: { token: settings.licenseToken, device_id: settings.licenseDeviceId },
          timeoutMs: 10_000,
          retries: 0
        });
        const data = response?.data || {};
        if (data.active !== true || normalizedPlan(data.plan) !== REQUIRED_CUSTOM_PLAN) {
          throw Object.assign(new Error("当前设备没有有效的 Pro License。"), { status: 403 });
        }
        const next = migrateSettings({
          ...settings,
          licensePlan: REQUIRED_CUSTOM_PLAN,
          licenseExpiresAt: Math.max(0, Number(data.expires_at) || 0),
          licenseLastVerifiedAt: Math.max(now, Number(data.verified_at) || 0)
        });
        writeJson(settingsPath, next);
        return publicStatus(next, scope, { active: true });
      } catch (error) {
        const status = Number(error?.status) || 0;
        if ((!status || status >= 500) && verifiedAt && now - verifiedAt <= config.offlineGraceSeconds && (!expiresAt || expiresAt > now)) {
          return publicStatus(settings, scope, { active: true, grace: true, error: "授权服务暂时不可用，正在使用离线宽限期。" });
        }
        return publicStatus(settings, scope, { ok: false, active: false, error: error instanceof Error ? error.message : String(error) });
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
    if (cleanCode.length < 12) {
      return publicStatus(settings, LICENSE_SCOPE_CUSTOM, { ok: false, active: false, error: "请输入有效的 Pro 兑换码。" });
    }
    try {
      const response = await officialLicenseRequest(settings, "/api/naimage/license/activate", {
        method: "POST",
        body: { code: cleanCode, device_id: settings.licenseDeviceId },
        timeoutMs: 12_000,
        retries: 0
      });
      const data = response?.data || {};
      if (!data.token || normalizedPlan(data.plan) !== REQUIRED_CUSTOM_PLAN) {
        throw new Error("授权服务没有返回有效的 Pro License。");
      }
      const now = Math.floor(Date.now() / 1000);
      const next = migrateSettings({
        ...settings,
        licenseToken: String(data.token),
        licensePlan: REQUIRED_CUSTOM_PLAN,
        licenseExpiresAt: Math.max(0, Number(data.expires_at) || 0),
        licenseLastVerifiedAt: now
      });
      writeJson(settingsPath, next);
      log(`naimage Pro license activated plan=${next.licensePlan}`);
      return publicStatus(next, LICENSE_SCOPE_CUSTOM, { active: true });
    } catch (error) {
      return publicStatus(settings, LICENSE_SCOPE_CUSTOM, { ok: false, active: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function requireActive(options = {}) {
    const status = await verify(options);
    if (!status.active) {
      const error = new Error(status.error || "自定义 Base URL 需要有效的 Pro License。");
      error.code = "NAIMAGE_PRO_LICENSE_REQUIRED";
      throw error;
    }
    return status;
  }

  return { activate, requireActive, verify };
}

module.exports = { createLicenseService };
