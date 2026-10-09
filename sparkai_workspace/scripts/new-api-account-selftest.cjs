"use strict";

const assert = require("node:assert/strict");
const { accountQuotaPolicy, createNewApiAccountService, mapNewApiLogEntry, normalizeLogQuery, quotaDisplay, walletFromNewApiUser } = require("../desktop/new-api-account.cjs");
const { registerServerIpc } = require("../desktop/ipc/server-ipc.cjs");

async function main() {
  const usd = accountQuotaPolicy({ data: { quota_per_unit: 1_000_000, quota_display_type: "USD", usd_exchange_rate: 7.25 } });
  const cny = accountQuotaPolicy({ quota_per_unit: 1_000_000, quota_display_type: "CNY", usd_exchange_rate: 7.25 });
  assert.equal(quotaDisplay(2_000_000, usd), "$2.00");
  assert.equal(quotaDisplay(2_000_000, cny), "￥14.50");
  assert.equal(quotaDisplay(2_000_000, accountQuotaPolicy({ quota_per_unit: 10, quota_display_type: "TOKENS" })), "2,000,000 quota");
  assert.equal(quotaDisplay(2_000_000, accountQuotaPolicy({ quota_per_unit: 1_000_000, quota_display_type: "CUSTOM", custom_currency_symbol: "€", custom_currency_exchange_rate: 0.9 })), "€1.80");
  assert.equal(quotaDisplay(20, {}), "20 quota");
  assert.equal(quotaDisplay(20, accountQuotaPolicy({ quota_per_unit: 1_000_000, quota_display_type: "CNY" })), "20 quota", "Missing exchange rate must not invent a currency amount");
  assert.equal(quotaDisplay(undefined, usd), "待同步");
  assert.equal(quotaDisplay(20, accountQuotaPolicy({ quota_per_unit: 1_000_000 })), "20 quota", "A missing currency mode must not fabricate USD");
  assert.equal(quotaDisplay(20, accountQuotaPolicy({ quota_per_unit: 1_000_000, quota_display_type: "UNKNOWN" })), "20 quota");
  assert.equal(quotaDisplay(2_000_000, accountQuotaPolicy({ quota_per_unit: 1_000_000, display_in_currency: true })), "$2.00", "Legacy explicit currency display is supported");
  const wallet = walletFromNewApiUser({ quota: 2_000_000, used_quota: 3_000_000, request_count: 42, group: "default" }, cny);
  assert.equal(wallet.balanceCents, 1450);
  assert.equal(wallet.usedDisplay, "￥21.75");
  assert.equal(wallet.requestCount, 42);
  assert.equal(wallet.nativeQuota, true);
  const overdrawn = walletFromNewApiUser({ quota: -500_000 }, usd);
  assert.equal(overdrawn.balanceQuota, -500_000, "Native negative balance must not be silently replaced with zero");
  assert.equal(overdrawn.balanceDisplay, "$-0.50");
  assert.equal(walletFromNewApiUser({ id: 1 }).balanceDisplay, "待同步", "Cached identity does not imply zero balance");
  const mapped = mapNewApiLogEntry({ id: 1, type: 5, created_at: 1_800_000_000, model_name: "gpt-image-2", quota: 1_000_000, use_time: 12, content: "authorization=Bearer private-secret https://host.test/image?token=signed-private C:\\private\\file.png sk-privateabcdefgh", other: JSON.stringify({ key: "should-never-leave-main", privatePath: "/private/file", apiKey: "hidden" }) }, cny);
  assert.equal(mapped.type, "error");
  assert.equal(mapped.detail.quotaDisplay, "￥7.25");
  assert.equal(mapped.detail.responseTimeMs, 12000);
  assert.ok(!/private-secret|signed-private|should-never-leave-main|private\\|sk-private/.test(JSON.stringify(mapped)));
  assert.equal(mapNewApiLogEntry({ created_at: "invalid" }).createdAt, "");
  assert.equal(mapNewApiLogEntry({ type: 2 }).type, "consume");
  assert.throws(() => normalizeLogQuery({ startTime: 200, endTime: 100 }), /开始时间/);
  assert.deepEqual([normalizeLogQuery({ page: -1, pageSize: 999, type: 100 }).page, normalizeLogQuery({ pageSize: 999 }).pageSize, normalizeLogQuery({ type: 100 }).type], [1, 100, 0]);

  const calls = [];
  let epoch = 1;
  let changeSession = false;
  const service = createNewApiAccountService({
    resolveNewApiBaseUrl: (settings) => settings.url,
    getNewApiAuthEpoch: () => epoch,
    requireNewApiSession: (settings) => assert.ok(settings.user),
    newApiUserAuthHeaders: () => ({ authorization: "Bearer fixture-only" }),
    newApiRequest: async (settings, endpoint, options) => {
      calls.push({ endpoint, options });
      if (endpoint === "/api/status") return { data: { quota_per_unit: 1_000_000, quota_display_type: "USD" } };
      if (changeSession) epoch++;
      return { data: { items: [{ id: 2, type: 2, created_at: 1_800_000_000, quota: 1_000_000, model_name: "gpt-image-2" }], total: 45 } };
    }
  });
  const settings = { url: "https://fixture.invalid", user: 1 };
  const result = await service.logs(settings, { page: 2, pageSize: 20, model: "a&b", tokenName: "office", type: 5, startTime: 1, endTime: 200 });
  const request = calls.find((call) => call.endpoint.startsWith("/api/log/"));
  const query = new URL(request.endpoint, settings.url).searchParams;
  assert.equal(query.get("p"), "2");
  assert.equal(query.get("model_name"), "a&b");
  assert.equal(query.get("token_name"), "office");
  assert.equal(query.get("type"), "5");
  assert.equal(query.get("start_timestamp"), "1");
  assert.equal(result.total, 45);
  assert.equal(result.page, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.logs[0].detail.quotaDisplay, "$1.00");
  await service.summary(settings, { id: 1, quota: 1_000_000 });
  assert.equal(calls.filter((call) => call.endpoint === "/api/status").length, 1, "Summary and logs share status cache");
  changeSession = true;
  assert.equal((await service.logs(settings)).stale, true);

  const handlers = new Map();
  registerServerIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, migrateSettings: (value) => value, readJson: () => settings, log: () => {}, newApiAccountService: service });
  changeSession = false;
  const ipcResult = await handlers.get("naimage:server:logs")({}, { page: 3 });
  assert.equal(ipcResult.page, 3, "IPC must forward paging query to owner service");
  assert.equal(ipcResult.hasMore, false);
  const invalid = await handlers.get("naimage:server:logs")({}, { startTime: 200, endTime: 100 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /开始时间/);
  process.stdout.write(`${JSON.stringify({ ok: true, cases: 38, networkRequests: 0 })}\n`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
