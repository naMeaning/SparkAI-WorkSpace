"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_QUOTA_PER_R,
  DEFAULT_USD_TO_CNY_RATE,
  accountTokenQuotaFields,
  formatAccountQuotaCny,
  normalizeAccountQuotaPolicy
} = require("../desktop/account-token-quota.cjs");

const defaults = normalizeAccountQuotaPolicy();
assert.deepEqual(defaults, {
  quotaPerR: DEFAULT_QUOTA_PER_R,
  usdToCnyRate: DEFAULT_USD_TO_CNY_RATE
});

assert.deepEqual(normalizeAccountQuotaPolicy({
  data: {
    quota_per_unit: "1000000",
    usd_exchange_rate: "7.25",
    price: 4.2
  }
}), { quotaPerR: 1_000_000, usdToCnyRate: 7.25 }, "Recharge price must not be treated as an exchange rate");

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

const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.tsx"), "utf8");
assert.match(mainSource, /token\.remainCnyDisplay/, "Account token UI must display the derived CNY amount");
assert.match(mainSource, /token\.remainRDisplay[\s\S]{0,80}原始/, "Account token UI must preserve R and raw quota audit values");
assert.match(mainSource, /原始额度（New API quota）/, "Token editing must explicitly keep raw New API quota semantics");

process.stdout.write(`${JSON.stringify({ ok: true, cases: 10 })}\n`);
