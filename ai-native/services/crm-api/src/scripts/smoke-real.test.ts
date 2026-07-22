import test from "node:test";
import assert from "node:assert/strict";
import { runCrmRealSmoke } from "./smoke-real.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
}

function headerValue(init: RequestInit, name: string): string {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[name] || "";
}

test("runCrmRealSmoke skips without embedded auth configuration", async () => {
  const result = await runCrmRealSmoke({
    env: {
      CRM_SMOKE_BASE_URL: "http://127.0.0.1:17861"
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
    log: () => undefined
  });

  assert.equal(result.status, "skipped");
  assert.match(result.reason || "", /CRM_SMOKE_EMBED_TRUST_SECRET/);
});

test("runCrmRealSmoke skips without a normal new-api user id", async () => {
  const result = await runCrmRealSmoke({
    env: {
      CRM_SMOKE_BASE_URL: "http://127.0.0.1:17861",
      CRM_SMOKE_EMBED_TRUST_SECRET: "embed-secret"
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
    log: () => undefined
  });

  assert.equal(result.status, "skipped");
  assert.match(result.reason || "", /CRM_SMOKE_USER_NEW_API_USER_ID/);
});

test("runCrmRealSmoke exercises embedded user, offline recharge and admin approval", async () => {
  const calls: Array<{ url: string; method: string; body: unknown; userId: string; role: string }> = [];

  const result = await runCrmRealSmoke({
    env: {
      CRM_SMOKE_BASE_URL: "http://crm.local",
      CRM_SMOKE_EMBED_TRUST_SECRET: "embed-secret",
      CRM_SMOKE_ADMIN_NEW_API_USER_ID: "1",
      CRM_SMOKE_USER_NEW_API_USER_ID: "2002",
      CRM_SMOKE_USERNAME: "smoke-user"
    },
    now: () => new Date("2026-07-06T01:02:03.000Z"),
    nonce: () => "nonce",
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      const method = String(init.method || "GET");
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({
        url,
        method,
        body,
        userId: headerValue(init, "x-crm-embed-user-id"),
        role: headerValue(init, "x-crm-embed-role")
      });

      if (url.endsWith("/health")) return jsonResponse({ ok: true, data: { service: "crm-api" } });
      if (url.endsWith("/crm/session/self")) return jsonResponse({ ok: true, data: { currentUser: { crmUserId: 2, username: "smoke-user" } } });
      if (url.endsWith("/crm/agent/offline-recharge-settings")) {
        return jsonResponse({ ok: true, data: { accounts: [{ method: "alipay", qrCodeUrl: "https://example.com/alipay.png" }] } });
      }
      if (url.endsWith("/crm/agent/offline-recharge-requests")) {
        return jsonResponse({ ok: true, data: { id: 3, status: "pending", paymentEvidenceUrl: body.paymentEvidenceUrl } });
      }
      if (url.endsWith("/crm/admin/offline-recharge-requests/3/approve")) {
        return jsonResponse({ ok: true, data: { id: 3, status: "approved", accountEventId: 4 } });
      }
      if (url.includes("/crm/admin/users?")) {
        return jsonResponse({ ok: true, data: { items: [{ username: "smoke-user", cumulativePaidRmb: 29.9 }], total: 1 } });
      }
      if (url.endsWith("/crm/admin/dashboard/summary")) return jsonResponse({ ok: true, data: { userCount: 1, openRiskCases: 0 } });
      if (url.endsWith("/crm/admin/risk-cases?page=1&pageSize=5")) return jsonResponse({ ok: true, data: { items: [], total: 0 } });
      if (url.endsWith("/crm/admin/enterprise/monthly-settlements?page=1&pageSize=5")) return jsonResponse({ ok: true, data: { items: [], total: 0 } });
      throw new Error(`unexpected request ${method} ${url}`);
    },
    log: () => undefined
  });

  assert.equal(result.status, "passed");
  assert.ok(calls.some((call) => call.url.endsWith("/crm/session/self") && call.userId === "1" && call.role === "100"));
  assert.ok(calls.some((call) => call.url.endsWith("/crm/session/self") && call.userId === "2002" && call.role === "1"));
  assert.ok(calls.some((call) => call.url.endsWith("/crm/agent/offline-recharge-requests") &&
    (call.body as { paymentEvidenceUrl?: string }).paymentEvidenceUrl === "https://example.com/crm-smoke-payment.png"));
  assert.ok(calls.some((call) => call.url.endsWith("/crm/admin/offline-recharge-requests/3/approve") && call.role === "100"));
  assert.ok(calls.some((call) => call.url.endsWith("/crm/admin/dashboard/summary") && call.role === "100"));
});
