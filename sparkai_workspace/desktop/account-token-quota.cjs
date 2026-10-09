"use strict";

const DEFAULT_QUOTA_PER_R = 500_000;
const DEFAULT_USD_TO_CNY_RATE = 7.3;
const { accountQuotaPolicy, quotaDisplay } = require("./new-api-account.cjs");

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeAccountQuotaPolicy(value = {}) {
  const source = value?.data && typeof value.data === "object" ? value.data : value;
  const displayPolicy = source?.displayPolicy || (source?.quota_display_type || source?.display_in_currency !== undefined ? accountQuotaPolicy(source) : undefined);
  const factor = Number(displayPolicy?.quotaPerUnit) / Number(displayPolicy?.exchangeRate);
  const currency = ["USD", "CNY", "CUSTOM"].includes(displayPolicy?.displayType) && Number.isFinite(factor) && factor > 0;
  return {
    quotaPerR: positiveNumber(source?.quotaPerR ?? source?.quota_per_unit, DEFAULT_QUOTA_PER_R),
    usdToCnyRate: positiveNumber(source?.usdToCnyRate ?? source?.usd_exchange_rate, DEFAULT_USD_TO_CNY_RATE),
    ...(displayPolicy ? { displayPolicy } : {}),
    inputUnit: currency ? { unit: displayPolicy.displayType === "CUSTOM" ? displayPolicy.symbol : displayPolicy.displayType, quotaPerAmount: factor } : { unit: "quota", quotaPerAmount: 1 }
  };
}

function quotaFromInputAmount(amount, expectedUnit, policy = {}) {
  const current = normalizeAccountQuotaPolicy(policy).inputUnit;
  if (expectedUnit?.unit !== current.unit || expectedUnit?.quotaPerAmount !== current.quotaPerAmount) throw new Error("账户额度单位已变化，请刷新密钥后重新编辑。");
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new Error("额度必须是非负数。");
  const quota = Math.round(amount * current.quotaPerAmount);
  if (!Number.isSafeInteger(quota)) throw new Error("额度超出可安全编辑的范围。");
  return quota;
}

function formatAccountQuotaNumber(value, maximumFractionDigits = 4, minimumFractionDigits = 0) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(Math.max(0, Number(value) || 0));
}

function formatAccountQuotaCny(cents) {
  return `￥${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.max(0, Math.round(Number(cents) || 0)) / 100)}`;
}

function accountTokenQuotaFields(remainQuota, unlimitedQuota = false, policy = {}) {
  const normalizedPolicy = normalizeAccountQuotaPolicy(policy);
  const rawQuota = Math.max(0, Math.floor(Number(remainQuota) || 0));
  const remainR = rawQuota / normalizedPolicy.quotaPerR;
  const remainUsd = remainR;
  const remainCnyCents = Math.max(0, Math.round(remainUsd * normalizedPolicy.usdToCnyRate * 100));
  const remainRDisplay = formatAccountQuotaNumber(remainR);
  const remainCnyDisplay = formatAccountQuotaCny(remainCnyCents);
  const remainDisplay = quotaDisplay(rawQuota, normalizedPolicy.displayPolicy);
  return {
    ...normalizedPolicy,
    remainAmount: rawQuota / normalizedPolicy.inputUnit.quotaPerAmount,
    remainR,
    remainUsd,
    remainCnyCents,
    remainRDisplay,
    remainCnyDisplay,
    remainDisplay,
    quotaAuditLabel: unlimitedQuota
      ? "不限额度"
      : `${remainDisplay} · 原始额度 ${rawQuota.toLocaleString("zh-CN")}`
  };
}

module.exports = {
  DEFAULT_QUOTA_PER_R,
  DEFAULT_USD_TO_CNY_RATE,
  accountTokenQuotaFields,
  formatAccountQuotaCny,
  formatAccountQuotaNumber,
  normalizeAccountQuotaPolicy,
  quotaFromInputAmount
};
