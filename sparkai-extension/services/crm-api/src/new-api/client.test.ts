import test from "node:test";
import assert from "node:assert/strict";
import { createNewApiClient } from "./client.js";

test("createNewApiClient exposes only CRM new-api service-side operations", () => {
  const client = createNewApiClient({
    newApiBaseUrl: "http://new-api.local",
    newApiAdminUserId: 7,
    newApiAdminAccessToken: "service-token"
  }, async () => new Response(JSON.stringify({ success: true, data: null }), { status: 200 }));

  assert.deepEqual(Object.keys(client).sort(), [
    "getUser",
    "listConsumeLogs",
    "listTopups",
    "manageUserQuota"
  ]);
});

test("createNewApiClient maps quota changes to new-api manage user request", async () => {
  const fetchImpl = async (url: URL, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body || "{}"));
    assert.equal(String(url), "http://new-api.local/api/user/manage");
    assert.equal(options?.method, "POST");
    assert.deepEqual(body, {
      id: 1001,
      action: "add_quota",
      mode: "add",
      value: 5000
    });

    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = createNewApiClient({
    newApiBaseUrl: "http://new-api.local",
    newApiAdminUserId: 7,
    newApiAdminAccessToken: "service-token"
  }, fetchImpl);

  const result = await client.manageUserQuota({ newApiUserId: 1001, mode: "add", value: 5000 });

  assert.deepEqual(result, { success: true, data: { ok: true } });
});
