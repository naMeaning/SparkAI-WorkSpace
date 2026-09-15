"use strict";

const assert = require("node:assert/strict");
const { createLicenseService } = require("../desktop/license-service.cjs");

const nowSeconds = 1_800_000_000;
const licenseBaseUrl = "https://license.sparkapi.test";

function createHarness(initialSettings, requestHandler) {
  const defaults = {
    accessMode: "custom",
    accountBaseUrl: "https://user-controlled-account.example",
    agentBaseUrl: "https://private-model.example/v1",
    agentApiKey: "must-not-upload",
    serverSessionCookie: "",
    serverUserId: "",
    licenseDeviceId: "device-0123456789abcdef0123456789abcdef",
    licenseToken: "",
    licensePlan: "",
    licenseExpiresAt: 0,
    licenseLastVerifiedAt: 0
  };
  let stored = { ...defaults, ...initialSettings };
  const calls = [];
  const service = createLicenseService({
    defaultSettings: defaults,
    licenseBaseUrl,
    migrateSettings(settings) {
      return { ...defaults, ...settings };
    },
    async newApiRequest(settings, endpoint, options = {}) {
      calls.push({ settings: { ...settings }, endpoint, options });
      return await requestHandler(settings, endpoint, options, calls);
    },
    readJson() {
      return { ...stored };
    },
    settingsPath: "memory://settings.json",
    writeJson(_path, settings) {
      stored = { ...settings };
    }
  });
  return { calls, service, stored: () => ({ ...stored }) };
}

function proConfig() {
  return {
    data: {
      required: false,
      supports_custom_api_mode: true,
      custom_api_license_required: true,
      custom_api_required_plan: "pro",
      verification_ttl_seconds: 86_400,
      offline_grace_seconds: 259_200
    }
  };
}

async function main() {
  const originalNow = Date.now;
  Date.now = () => nowSeconds * 1000;
  try {
    const account = createHarness({ accessMode: "account" }, async () => {
      throw new Error("Account access must not call the License service");
    });
    const accountStatus = await account.service.verify({ scope: "account", force: true });
    assert.equal(accountStatus.active, true);
    assert.equal(accountStatus.required, false);
    assert.equal(accountStatus.scope, "account");
    assert.equal(account.calls.length, 0);

    const missing = createHarness({}, async (_settings, endpoint, options) => {
      assert.equal(endpoint, "/api/naimage/license");
      assert.equal(options.absoluteUrl, `${licenseBaseUrl}/api/naimage/license`);
      return proConfig();
    });
    const missingStatus = await missing.service.verify({ scope: "custom" });
    assert.equal(missingStatus.ok, true);
    assert.equal(missingStatus.active, false);
    assert.equal(missingStatus.required, true);
    assert.equal(missingStatus.requiredPlan, "pro");

    const activated = createHarness({}, async (_settings, endpoint, options) => {
      assert.equal(endpoint, "/api/naimage/license/activate");
      assert.equal(options.absoluteUrl, `${licenseBaseUrl}/api/naimage/license/activate`);
      assert.equal(options.headers, undefined, "License activation must not send account cookies or model credentials");
      assert.deepEqual(options.body, {
        code: "NAI-AAAA-BBBB-CCCC-DDDD",
        device_id: "device-0123456789abcdef0123456789abcdef"
      });
      return { data: { token: "license-token-0123456789abcdef0123456789abcdef", plan: "pro", expires_at: nowSeconds + 86_400 } };
    });
    const activatedStatus = await activated.service.activate(" NAI-AAAA-BBBB-CCCC-DDDD ");
    assert.equal(activatedStatus.active, true);
    assert.equal(activatedStatus.scope, "custom");
    assert.equal(activated.stored().licenseToken, "license-token-0123456789abcdef0123456789abcdef");
    assert.equal(activated.stored().licensePlan, "pro");

    const wrongPlan = createHarness({}, async () => ({
      data: { token: "standard-token-0123456789abcdef0123456789abcdef", plan: "standard", expires_at: 0 }
    }));
    const wrongPlanStatus = await wrongPlan.service.activate("NAI-AAAA-BBBB-CCCC-DDDD");
    assert.equal(wrongPlanStatus.active, false);
    assert.equal(wrongPlan.stored().licenseToken, "");

    const cached = createHarness({
      licenseToken: "cached-license-token-0123456789abcdef0123456789abcdef",
      licensePlan: "pro",
      licenseLastVerifiedAt: nowSeconds - 60
    }, async (_settings, endpoint) => {
      assert.equal(endpoint, "/api/naimage/license", "24-hour cache must skip the verify endpoint");
      return proConfig();
    });
    const cachedStatus = await cached.service.verify({ scope: "custom" });
    assert.equal(cachedStatus.active, true);
    assert.equal(cached.calls.length, 1);

    const verified = createHarness({
      accessMode: "account",
      serverSessionCookie: "session=fixture",
      serverUserId: "42",
      licenseToken: "device-license-token-0123456789abcdef0123456789abcdef",
      licensePlan: "pro",
      licenseLastVerifiedAt: nowSeconds - 90_000
    }, async (_settings, endpoint, options) => {
      if (endpoint === "/api/naimage/license") return proConfig();
      assert.equal(endpoint, "/api/naimage/license/verify");
      assert.equal(options.absoluteUrl, `${licenseBaseUrl}/api/naimage/license/verify`);
      assert.equal(options.headers, undefined);
      return { data: { active: true, plan: "pro", expires_at: 0, verified_at: nowSeconds } };
    });
    const verifiedStatus = await verified.service.verify({ force: true, scope: "custom" });
    assert.equal(verifiedStatus.active, true);
    assert.equal(verified.stored().licensePlan, "pro");

    const grace = createHarness({
      licenseToken: "offline-license-token-0123456789abcdef0123456789abcdef",
      licensePlan: "pro",
      licenseLastVerifiedAt: nowSeconds - 71 * 60 * 60
    }, async () => {
      const error = new Error("service unavailable");
      error.status = 503;
      throw error;
    });
    const graceStatus = await grace.service.verify({ force: true, scope: "custom" });
    assert.equal(graceStatus.active, true);
    assert.equal(graceStatus.grace, true);

    const expiredGrace = createHarness({
      licenseToken: "expired-offline-token-0123456789abcdef0123456789abcdef",
      licensePlan: "pro",
      licenseLastVerifiedAt: nowSeconds - 73 * 60 * 60
    }, async () => {
      const error = new Error("service unavailable");
      error.status = 503;
      throw error;
    });
    const expiredGraceStatus = await expiredGrace.service.verify({ force: true, scope: "custom" });
    assert.equal(expiredGraceStatus.ok, false);
    assert.equal(expiredGraceStatus.active, false);

    const unsupported = createHarness({}, async () => {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    });
    const unsupportedStatus = await unsupported.service.verify({ scope: "custom" });
    assert.equal(unsupportedStatus.active, false);
    assert.equal(unsupportedStatus.supported, false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cases: 9,
      accountLoginIsEntitlement: true,
      proCustomAccess: true,
      officialLicenseOrigin: licenseBaseUrl,
      verificationCacheHours: 24,
      offlineGraceHours: 72
    })}\n`);
  } finally {
    Date.now = originalNow;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
