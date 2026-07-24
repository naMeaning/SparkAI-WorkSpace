"use strict";

const assert = require("node:assert/strict");
const { createLicenseService } = require("../desktop/license-service.cjs");

const nowSeconds = 1_800_000_000;

function createHarness(initialSettings, requestHandler) {
  const defaults = {
    accessMode: "custom",
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
    migrateSettings(settings) {
      return { ...defaults, ...settings };
    },
    async newApiRequest(settings, endpoint, options = {}) {
      calls.push({ settings: { ...settings }, endpoint, options });
      return await requestHandler(settings, endpoint, options, calls);
    },
    newApiUserAuthHeaders(settings) {
      return {
        cookie: settings.serverSessionCookie,
        "New-Api-User": String(settings.serverUserId)
      };
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

async function main() {
  const originalNow = Date.now;
  Date.now = () => nowSeconds * 1000;
  try {
    const disabled = createHarness({}, async (_settings, endpoint) => {
      assert.equal(endpoint, "/api/naimage/license");
      return { data: { required: false } };
    });
    assert.deepEqual(await disabled.service.verify(), {
      ok: true,
      active: true,
      required: false,
      supported: true,
      plan: "",
      expiresAt: 0,
      verifiedAt: 0
    });

    const missing = createHarness({}, async () => ({
      data: { required: true, verification_ttl_seconds: 86_400, offline_grace_seconds: 259_200 }
    }));
    const missingStatus = await missing.service.verify();
    assert.equal(missingStatus.ok, true);
    assert.equal(missingStatus.active, false);
    assert.equal(missingStatus.required, true);

    const activated = createHarness({}, async (_settings, endpoint, options) => {
      assert.equal(endpoint, "/api/naimage/license/activate");
      assert.deepEqual(options.body, {
        code: "NAI-AAAA-BBBB-CCCC-DDDD",
        device_id: "device-0123456789abcdef0123456789abcdef"
      });
      return { data: { token: "license-token-0123456789abcdef0123456789abcdef", plan: "standard", expires_at: nowSeconds + 86_400 } };
    });
    const activatedStatus = await activated.service.activate(" NAI-AAAA-BBBB-CCCC-DDDD ");
    assert.equal(activatedStatus.active, true);
    assert.equal(activated.stored().licenseToken, "license-token-0123456789abcdef0123456789abcdef");
    assert.equal(activated.stored().licensePlan, "standard");

    const cached = createHarness({
      licenseToken: "cached-license-token-0123456789abcdef0123456789abcdef",
      licensePlan: "standard",
      licenseLastVerifiedAt: nowSeconds - 60
    }, async (_settings, endpoint) => {
      assert.equal(endpoint, "/api/naimage/license", "24-hour cache must skip the verify endpoint");
      return { data: { required: true, verification_ttl_seconds: 86_400, offline_grace_seconds: 259_200 } };
    });
    const cachedStatus = await cached.service.verify();
    assert.equal(cachedStatus.active, true);
    assert.equal(cached.calls.length, 1);

    const account = createHarness({
      accessMode: "account",
      serverSessionCookie: "session=fixture",
      serverUserId: "42",
      licenseToken: "account-license-token-0123456789abcdef0123456789abcdef",
      licenseLastVerifiedAt: nowSeconds - 90_000
    }, async (_settings, endpoint, options) => {
      if (endpoint === "/api/naimage/license") {
        return { data: { required: true, verification_ttl_seconds: 86_400, offline_grace_seconds: 259_200 } };
      }
      assert.equal(endpoint, "/api/naimage/license/account/verify");
      assert.equal(options.headers.cookie, "session=fixture");
      assert.equal(options.headers["New-Api-User"], "42");
      return { data: { active: true, plan: "pro", expires_at: 0, verified_at: nowSeconds } };
    });
    const accountStatus = await account.service.verify({ force: true });
    assert.equal(accountStatus.active, true);
    assert.equal(account.stored().licensePlan, "pro");

    const grace = createHarness({
      licenseToken: "offline-license-token-0123456789abcdef0123456789abcdef",
      licenseLastVerifiedAt: nowSeconds - 71 * 60 * 60
    }, async () => {
      const error = new Error("service unavailable");
      error.status = 503;
      throw error;
    });
    const graceStatus = await grace.service.verify({ force: true });
    assert.equal(graceStatus.active, true);
    assert.equal(graceStatus.grace, true);

    const expiredGrace = createHarness({
      licenseToken: "expired-offline-token-0123456789abcdef0123456789abcdef",
      licenseLastVerifiedAt: nowSeconds - 73 * 60 * 60
    }, async () => {
      const error = new Error("service unavailable");
      error.status = 503;
      throw error;
    });
    const expiredGraceStatus = await expiredGrace.service.verify({ force: true });
    assert.equal(expiredGraceStatus.ok, false);
    assert.equal(expiredGraceStatus.active, false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cases: 7,
      activationDisabled: true,
      activationRequired: true,
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
