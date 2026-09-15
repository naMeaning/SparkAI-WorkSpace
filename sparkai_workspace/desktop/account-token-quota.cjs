"use strict";

const DEFAULT_QUOTA_PER_R = 500_000;
const DEFAULT_USD_TO_CNY_RATE = 7.3;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeAccountQuotaPolicy(value = {}) {
  const source = value?.data && typeof value.data === "object" ? value.data : value;
  return {
    quotaPerR: positiveNumber(source?.quotaPerR ?? source?.quota_per_unit, DEFAULT_QUOTA_PER_R),
    usdToCnyRate: positiveNumber(source?.usdToCnyRate ?? source?.usd_exchange_rate, DEFAULT_USD_TO_CNY_RATE)
  };
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
  return {
    ...normalizedPolicy,
    remainR,
    remainUsd,
    remainCnyCents,
    remainRDisplay,
    remainCnyDisplay,
    quotaAuditLabel: unlimitedQuota
      ? "不限额度"
      : `${remainRDisplay} R · 原始额度 ${rawQuota.toLocaleString("zh-CN")} · 1 R = 1 USD · $1 = ￥${formatAccountQuotaNumber(normalizedPolicy.usdToCnyRate, 4, 2)}`
  };
}

module.exports = {
  DEFAULT_QUOTA_PER_R,
  DEFAULT_USD_TO_CNY_RATE,
  accountTokenQuotaFields,
  formatAccountQuotaCny,
  formatAccountQuotaNumber,
  normalizeAccountQuotaPolicy
};
