import assert from "node:assert/strict";
import test from "node:test";
import { createDevNewApiClient } from "./dev-new-api-client.js";

test("createDevNewApiClient keeps explicit simulation mode without service credentials", async () => {
  const client = createDevNewApiClient({
    newApiBaseUrl: "http://new-api.local",
    newApiAdminUserId: 0,
    newApiAdminAccessToken: ""
  });

  assert.deepEqual(
    await client.manageUserQuota({ newApiUserId: 10, mode: "add", value: 5000 }),
    { ok: true, simulated: true }
  );
});

test("createDevNewApiClient uses the real New API client when service credentials are configured", async () => {
  let request: { url: string; authorization: string; userId: string; body: unknown } | null = null;
  const client = createDevNewApiClient({
    newApiBaseUrl: "http://new-api.local",
    newApiAdminUserId: 7,
    newApiAdminAccessToken: "sk-service-token"
  }, async (url, options) => {
    const headers = options?.headers as Record<string, string>;
    request = {
      url: String(url),
      authorization: headers.authorization,
      userId: headers["New-Api-User"],
      body: JSON.parse(String(options?.body || "{}"))
    };
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  await client.manageUserQuota({ newApiUserId: 10, mode: "add", value: 5000 });

  assert.deepEqual(request, {
    url: "http://new-api.local/api/user/manage",
    authorization: "Bearer sk-service-token",
    userId: "7",
    body: { id: 10, action: "add_quota", mode: "add", value: 5000 }
  });
});
