"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_QUOTA_PER_R,
  DEFAULT_USD_TO_CNY_RATE,
  accountTokenQuotaFields,
  formatAccountQuotaCny,
  normalizeAccountQuotaPolicy,
  quotaFromInputAmount
} = require("../desktop/account-token-quota.cjs");

const defaults = normalizeAccountQuotaPolicy();
assert.deepEqual(defaults, {
  quotaPerR: DEFAULT_QUOTA_PER_R,
  usdToCnyRate: DEFAULT_USD_TO_CNY_RATE,
  inputUnit: { unit: "quota", quotaPerAmount: 1 }
});

assert.deepEqual(normalizeAccountQuotaPolicy({
  data: {
    quota_per_unit: "1000000",
    usd_exchange_rate: "7.25",
    price: 4.2
  }
}), { quotaPerR: 1_000_000, usdToCnyRate: 7.25, inputUnit: defaults.inputUnit }, "Recharge price must not be treated as an exchange rate");

assert.deepEqual(normalizeAccountQuotaPolicy({ quota_per_unit: 0, usd_exchange_rate: -1 }), defaults);

const zero = accountTokenQuotaFields(0, false, defaults);
assert.equal(zero.remainR, 0);
assert.equal(zero.remainCnyCents, 0);
assert.equal(zero.remainCnyDisplay, "￥0.00");

const oneR = accountTokenQuotaFields(500_000, false, defaults);
assert.equal(oneR.remainR, 1);
assert.equal(oneR.remainUsd, 1);
assert.equal(oneR.remainCnyCents, 730);
assert.equal(oneR.remainCnyDisplay, "￥7.30");

const tenR = accountTokenQuotaFields(5_000_000, false, defaults);
assert.equal(tenR.remainR, 10);
assert.equal(tenR.remainCnyCents, 7_300);
assert.equal(tenR.remainCnyDisplay, "￥73.00");
assert.match(tenR.quotaAuditLabel, /原始额度 5,000,000/);

const fractional = accountTokenQuotaFields(333_333, false, defaults);
assert.ok(Math.abs(fractional.remainR - 0.666666) < 0.000001);
assert.equal(fractional.remainCnyCents, 487, "CNY conversion must round to the nearest cent");
assert.equal(fractional.remainCnyDisplay, "￥4.87");

const unlimited = accountTokenQuotaFields(9_999_999, true, defaults);
assert.equal(unlimited.quotaAuditLabel, "不限额度");
assert.equal(unlimited.remainCnyCents, 14_600, "Unlimited tokens retain raw audit math without becoming the display limit");

assert.equal(formatAccountQuotaCny(1), "￥0.01");
const nativeUsd = normalizeAccountQuotaPolicy({ quota_per_unit: 1_000_000, usd_exchange_rate: 7.25, quota_display_type: "USD" });
assert.equal(accountTokenQuotaFields(2_000_000, false, nativeUsd).remainDisplay, "$2.00");
assert.equal(accountTokenQuotaFields(20, false, {}).remainDisplay, "20 quota", "Unknown unit policy must display raw quota");
const inputPolicies = [
  [{ quota_display_type: "USD", quota_per_unit: 500_000, usd_exchange_rate: 7.3 }, "USD", 1.25, 625_000],
  [{ quota_display_type: "CNY", quota_per_unit: 500_000, usd_exchange_rate: 7.25 }, "CNY", 7.25, 500_000],
  [{ quota_display_type: "CUSTOM", quota_per_unit: 500_000, custom_currency_exchange_rate: 3.5, custom_currency_symbol: "€" }, "€", 7, 1_000_000],
  [{ quota_display_type: "TOKENS", quota_per_unit: 500_000 }, "quota", 17, 17],
  [{ quota_display_type: "USD" }, "quota", 21, 21],
  [{ quota_display_type: "CNY", quota_per_unit: 500_000 }, "quota", 23, 23]
];
for (const [source, unit, amount, raw] of inputPolicies) {
  const policy = normalizeAccountQuotaPolicy(source);
  assert.equal(policy.inputUnit.unit, unit);
  assert.equal(quotaFromInputAmount(amount, policy.inputUnit, policy), raw);
  const token = accountTokenQuotaFields(raw, false, policy);
  assert.ok(Math.abs(token.remainAmount - amount) < 1e-9, "Displayed input amount must round-trip through the Main quota owner");
}
const invalidAmounts = [-1, NaN, Infinity, -Infinity, "2", null, Number.MAX_SAFE_INTEGER];
for (const amount of invalidAmounts) assert.throws(() => quotaFromInputAmount(amount, nativeUsd.inputUnit, nativeUsd));
assert.throws(() => quotaFromInputAmount(1, { unit: "CNY", quotaPerAmount: 1 }, nativeUsd), /单位已变化/);
assert.equal(quotaFromInputAmount(0.000001, nativeUsd.inputUnit, nativeUsd), 1, "Sub-cent edits must preserve single raw quota units");

const settingsDrawerSource = fs.readFileSync(path.join(__dirname, "..", "src", "settings-drawer.tsx"), "utf8");
assert.match(settingsDrawerSource, /token\.remainCnyDisplay/, "Account token UI must display the derived CNY amount");
assert.match(settingsDrawerSource, /原始额度 \{token\.remainQuota/, "Account token UI must preserve raw quota audit values");
assert.match(settingsDrawerSource, /token\.remainDisplay/, "Account token UI must prefer the server's native quota display");
assert.match(settingsDrawerSource, /aria-label="密钥额度"/, "Token editing must expose a named quota amount control");

process.stdout.write(`${JSON.stringify({ ok: true, legacyChecks: true, conversionPolicies: inputPolicies.length, rejectedInputs: invalidAmounts.length })}\n`);
