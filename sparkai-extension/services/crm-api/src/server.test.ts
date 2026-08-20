import { Readable } from "node:stream";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountEventStatuses,
  accountEventTypes,
  agentRelationshipBindSources,
  commissionStatuses,
  commissionTypes,
  crmPageCapabilities,
  effectiveCustomerRules,
  enterpriseMonthlySettlementStatuses,
  ledgerDirections,
  ledgerEventTypes,
  offlineRechargeStatuses,
  signupTrialGrantStatuses
} from "@ai-native/crm-contracts";
import { bindCustomerAgent, createAgent } from "./domain/agents.js";
import { createMemoryRepository } from "./test-helpers/repository.js";
import type { CrmConfig, NewApiClient, NewApiQuotaPayload } from "./types.js";
import { createCrmHandler } from "./server.js";

type TestHandler = (req: IncomingMessage, res: ServerResponse) => void;

interface TestResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  payload: {
    ok?: boolean;
    data?: Record<string, unknown>;
    error_code?: string;
    err_msg?: string;
  };
}

interface RawTestResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

function config(overrides: Partial<CrmConfig> = {}): CrmConfig {
  const base: CrmConfig = {
    port: 17861,
    host: "127.0.0.1",
    databaseUrl: "",
    databaseName: "ai_native_crm",
    newApiBaseUrl: "http://127.0.0.1:17860",
    newApiAdminUserId: 0,
    newApiAdminAccessToken: "",
    quotaPerRmb: 500000,
    crmEmbedTrustSecret: "test-embed-secret",
    corsAllowedOrigins: ["*"],
    effectiveCustomerMaintenanceIntervalMinutes: 0,
    usageSyncMaintenanceIntervalMinutes: 0,
    enterpriseMonthlySettlementIntervalMinutes: 0,
    attachmentStorageDir: join(tmpdir(), "ai-native-crm-test-attachments"),
    attachmentMaxBytes: 5 * 1024 * 1024
  };
  return { ...base, ...overrides };
}

const testAuthHeaderNames = new Set([
  "x-test-crm-admin",
  "x-test-crm-user-id",
  "x-test-crm-username",
  "x-test-crm-role",
  "x-test-crm-inviter-id"
]);

function expandTestAuthHeaders(method: string, url: string, headers: Record<string, string>): Record<string, string> {
  const path = new URL(url, "http://127.0.0.1").pathname;
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const passthrough = Object.fromEntries(Object.entries(normalized).filter(([key]) => !testAuthHeaderNames.has(key)));
  if (normalized["x-test-crm-admin"]) {
    return {
      ...passthrough,
      ...embeddedHeaders({
        method,
        path,
        userId: Number(normalized["x-test-crm-admin"]),
        username: normalized["x-test-crm-username"] || "root",
        role: Number(normalized["x-test-crm-role"] || 100)
      })
    };
  }
  if (normalized["x-test-crm-user-id"]) {
    const userId = Number(normalized["x-test-crm-user-id"]);
    return {
      ...passthrough,
      ...embeddedHeaders({
        method,
        path,
        userId,
        username: normalized["x-test-crm-username"] || `newapi-${userId}`,
        role: Number(normalized["x-test-crm-role"] || 1),
        inviterId: Number(normalized["x-test-crm-inviter-id"] || 0)
      })
    };
  }
  return passthrough;
}

function request(method: string, url: string, headers: Record<string, string> = {}, body?: Record<string, unknown>): IncomingMessage {
  const chunks = body ? [JSON.stringify(body)] : [];
  const req = Readable.from(chunks) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = {
    host: "127.0.0.1",
    ...expandTestAuthHeaders(method, url, headers)
  };
  return req as unknown as IncomingMessage;
}

function rawRequest(method: string, url: string, headers: Record<string, string>, body: string | Buffer): IncomingMessage {
  const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = {
    host: "127.0.0.1",
    ...expandTestAuthHeaders(method, url, headers)
  };
  return req as unknown as IncomingMessage;
}

async function invoke(handler: TestHandler, req: IncomingMessage): Promise<TestResponse> {
  return new Promise((resolve) => {
    let statusCode = 200;
    let responseHeaders: Record<string, string | string[]> = {};
    const response = {
      writeHead(nextStatusCode: number, headers: Record<string, string | string[]> = {}) {
        statusCode = nextStatusCode;
        responseHeaders = headers;
        return response;
      },
      end(chunk: unknown) {
        const body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "{}");
        resolve({ statusCode, headers: responseHeaders, payload: JSON.parse(body) as TestResponse["payload"] });
      }
    };
    handler(req, response as unknown as ServerResponse);
  });
}

async function invokeRaw(handler: TestHandler, req: IncomingMessage): Promise<RawTestResponse> {
  return new Promise((resolve) => {
    let statusCode = 200;
    let responseHeaders: Record<string, string | string[]> = {};
    const chunks: Buffer[] = [];
    const response = {
      writeHead(nextStatusCode: number, headers: Record<string, string | string[]> = {}) {
        statusCode = nextStatusCode;
        responseHeaders = headers;
        return response;
      },
      write(chunk: unknown) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        resolve({ statusCode, headers: responseHeaders, body: Buffer.concat(chunks).toString("utf8") });
      }
    };
    handler(req, response as unknown as ServerResponse);
  });
}

function newApiClient(): NewApiClient {
  return {
    async getUser(newApiUserId: number) {
      return { id: newApiUserId, username: `user_${newApiUserId}`, quota: 1000000 };
    },
    async manageUserQuota() {
      return { ok: true };
    },
    async listTopups() {
      return {};
    },
    async listConsumeLogs() {
      return {};
    }
  };
}

const adminHeaders = { "x-test-crm-admin": "1", "x-test-crm-username": "root", "x-test-crm-role": "100" };

function userHeaders(newApiUserId: number, username = `newapi-${newApiUserId}`, role = 1): Record<string, string> {
  return {
    "x-test-crm-user-id": String(newApiUserId),
    "x-test-crm-username": username,
    "x-test-crm-role": String(role)
  };
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function embeddedHeaders({
  method = "GET",
  path,
  userId,
  username = `newapi-${userId}`,
  displayName = "",
  email = "",
  role = 1,
  inviterId = 0,
  secret = config().crmEmbedTrustSecret,
  timestamp = Date.now(),
  nonce = "test-nonce"
}: {
  method?: string;
  path: string;
  userId: number;
  username?: string;
  displayName?: string;
  email?: string;
  role?: number;
  inviterId?: number;
  secret?: string;
  timestamp?: number;
  nonce?: string;
}): Record<string, string> {
  const usernameB64 = base64Url(username);
  const displayNameB64 = base64Url(displayName);
  const emailB64 = base64Url(email);
  const payload = [
    method,
    path,
    String(timestamp),
    nonce,
    String(userId),
    usernameB64,
    displayNameB64,
    emailB64,
    String(role),
    String(inviterId)
  ].join("\n");
  return {
    "x-crm-embed-user-id": String(userId),
    "x-crm-embed-username-b64": usernameB64,
    "x-crm-embed-display-name-b64": displayNameB64,
    "x-crm-embed-email-b64": emailB64,
    "x-crm-embed-role": String(role),
    "x-crm-embed-inviter-id": String(inviterId),
    "x-crm-embed-timestamp": String(timestamp),
    "x-crm-embed-nonce": nonce,
    "x-crm-embed-signature": crypto.createHmac("sha256", secret).update(payload).digest("base64url")
  };
}

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

test("createCrmHandler keeps health public with stable service status", async () => {
  const handler = createCrmHandler({
    config: config(),
    repository: createMemoryRepository(),
    newApiClient: newApiClient()
  });

  const response = await invoke(handler, request("GET", "/health"));

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.data?.service, "crm-api");
  assert.deepEqual(Object.keys(response.payload.data?.schedulers as Record<string, unknown>).sort(), [
    "effectiveCustomerMaintenance",
    "enterpriseMonthlySettlement",
    "usageSync"
  ]);
  assert.equal(
    ((response.payload.data?.schedulers as Record<string, { enabled: boolean }>).usageSync).enabled,
    false
  );
});

test("createCrmHandler keeps super admin and agent page capabilities separated", async () => {
  const repository = createMemoryRepository();
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(handler, request("GET", "/crm/session/self", adminHeaders));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.data?.capabilities, [crmPageCapabilities.superAdmin]);
  assert.deepEqual(response.payload.data?.pageGroups, [{ key: crmPageCapabilities.superAdmin, label: "平台管理" }]);
});

test("createCrmHandler requires signed embedded new-api identity for current-user APIs", async () => {
  const repository = createMemoryRepository();
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(handler, request("GET", "/crm/session/self", { "x-crm-user-id": "1001" }));

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error_code, "crm_user_required");
  assert.equal(response.payload.err_msg, "请先登录后再继续操作。");
});

test("createCrmHandler accepts signed embedded new-api users without a CRM cookie", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: NewApiQuotaPayload[] = [];
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: `newapi_${newApiUserId}`, quota: 1000000 };
      },
      async manageUserQuota(input: NewApiQuotaPayload) {
        quotaCalls.push(input);
        return { ok: true };
      }
    }
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/session/self", embeddedHeaders({
      path: "/crm/session/self",
      userId: 42,
      username: "New Api User",
      email: "newapi@example.com"
    }))
  );

  const crmUser = await repository.getCrmUserByNewApiUserId(42);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.data?.capabilities, [crmPageCapabilities.agent]);
  assert.equal(crmUser?.newApiUserId, 42);
  assert.equal(crmUser?.username, "new_api_user");
  assert.equal(crmUser?.signupTrialGrantStatus, signupTrialGrantStatuses.granted);
  assert.deepEqual(quotaCalls, []);
});

test("createCrmHandler maps embedded new-api root users to CRM platform management", async () => {
  const repository = createMemoryRepository();
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/admin/dashboard/summary", embeddedHeaders({
      path: "/crm/admin/dashboard/summary",
      userId: 1001,
      username: "external-root",
      role: 100
    }))
  );

  const crmUser = await repository.getCrmUserByNewApiUserId(1001);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.data?.userCount, 0);
  assert.equal(crmUser?.newApiRole, 100);
});

test("createCrmHandler refreshes stored embedded identity and role on later requests", async () => {
  const repository = createMemoryRepository();
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  await invoke(
    handler,
    request("GET", "/crm/session/self", embeddedHeaders({
      path: "/crm/session/self",
      userId: 1101,
      username: "old-user",
      email: "old@example.com",
      role: 1,
      nonce: "identity-old"
    }))
  );
  const response = await invoke(
    handler,
    request("GET", "/crm/admin/dashboard/summary", embeddedHeaders({
      path: "/crm/admin/dashboard/summary",
      userId: 1101,
      username: "New User Name",
      email: "new@example.com",
      role: 100,
      nonce: "identity-new"
    }))
  );

  const crmUser = await repository.getCrmUserByNewApiUserId(1101);
  assert.equal(response.statusCode, 200);
  assert.equal(crmUser?.username, "new_user_name");
  assert.equal(crmUser?.email, "new@example.com");
  assert.equal(crmUser?.newApiRole, 100);
  assert.equal((await repository.listCrmUsers({ excludeSuperAdmins: true })).total, 0);
});

test("createCrmHandler records request IP and User-Agent for settings audit", async () => {
  const repository = createMemoryRepository();
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });
  const headers = {
    ...embeddedHeaders({
      method: "PATCH",
      path: "/crm/admin/settings",
      userId: 1201,
      username: "settings-admin",
      role: 100,
      nonce: "settings-audit"
    }),
    "x-forwarded-for": "203.0.113.10, 127.0.0.1",
    "user-agent": "crm-audit-test"
  };

  const response = await invoke(
    handler,
    request("PATCH", "/crm/admin/settings", headers, {
      withdrawalMinAmountRmb: 120
    })
  );

  assert.equal(response.statusCode, 200);
  const audit = (await repository.listAuditLogs({ action: "settings.update", page: 1, pageSize: 10 })).items[0];
  assert.equal(audit?.requestIp, "203.0.113.10");
  assert.equal(audit?.userAgent, "crm-audit-test");
});

test("createCrmHandler rejects invalid embedded new-api signatures", async () => {
  const handler = createCrmHandler({
    config: config(),
    repository: createMemoryRepository(),
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/session/self", {
      ...embeddedHeaders({ path: "/crm/session/self", userId: 42 }),
      "x-crm-embed-signature": "invalid-signature"
    })
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.error_code, "crm_embedded_auth_invalid");
});

test("createCrmHandler maps missing CRM database tables to a non-SQL user message", async () => {
  const repository = createMemoryRepository();
  const missingTable = new Error("Table 'ai_native_crm.crm_users' doesn't exist");
  (missingTable as Error & { code?: string }).code = "ER_NO_SUCH_TABLE";
  const handler = createCrmHandler({
    config: config(),
    repository: {
      ...repository,
      async getCrmUserByNewApiUserId() {
        throw missingTable;
      }
    },
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/session/self", userHeaders(42, "ceshi"))
  );

  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error_code, "crm_database_not_ready");
  assert.equal(response.payload.err_msg, "系统正在初始化，请先完成 CRM 数据库迁移后再登录。");
  assert.equal(JSON.stringify(response.payload).includes("crm_users"), false);
});

test("createCrmHandler maps unavailable CRM database connections to initialization guidance", async () => {
  const repository = createMemoryRepository();
  const connectionError = new Error("connect ECONNREFUSED 127.0.0.1:3306");
  (connectionError as Error & { code?: string }).code = "ECONNREFUSED";
  const handler = createCrmHandler({
    config: config(),
    repository: {
      ...repository,
      async getCrmUserByNewApiUserId() {
        throw connectionError;
      }
    },
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/session/self", userHeaders(42, "ceshi"))
  );

  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error_code, "crm_database_not_ready");
  assert.equal(response.payload.err_msg, "系统正在初始化，请先完成 CRM 数据库迁移后再登录。");
  assert.equal(JSON.stringify(response.payload).includes("ECONNREFUSED"), false);
});

test("createCrmHandler stores CRM evidence attachments behind embedded identity", async () => {
  const attachmentStorageDir = await mkdtemp(join(tmpdir(), "crm-attachments-"));
  try {
    const repository = createMemoryRepository();
    const crmUser = await repository.createCrmUser({
      username: "attachment-user",
      newApiUserId: 3001
    });
    const headers = userHeaders(crmUser.newApiUserId || 0, crmUser.username);
    const handler = createCrmHandler({
      config: config({ attachmentStorageDir, attachmentMaxBytes: 1024 }),
      repository,
      newApiClient: newApiClient()
    });

    const uploaded = await invoke(handler, request("POST", "/crm/attachments", headers, {
      fileName: "充值凭证.png",
      contentType: "image/png",
      dataBase64: Buffer.from("receipt-image").toString("base64")
    }));

    assert.equal(uploaded.statusCode, 200);
    const uploadData = uploaded.payload.data as unknown as { url: string; fileName: string; contentType: string; sizeBytes: number };
    assert.match(uploadData.url, /^\/crm\/attachments\/[a-f0-9]{32}\.png$/);
    assert.match(uploadData.fileName, /^[a-f0-9]{32}\.png$/);
    assert.equal(uploadData.contentType, "image/png");
    assert.equal(uploadData.sizeBytes, "receipt-image".length);

    const uploadAudit = (await repository.listAuditLogs({
      action: "attachment.upload",
      page: 1,
      pageSize: 10
    })).items[0];
    assert.equal(uploadAudit?.operatorCrmUserId, crmUser.id);
    assert.equal(uploadAudit?.targetType, "attachment");
    assert.equal(uploadAudit?.targetId, uploadData.fileName);
    assert.deepEqual(uploadAudit?.afterSnapshot, {
      url: uploadData.url,
      fileName: uploadData.fileName,
      contentType: "image/png",
      sizeBytes: "receipt-image".length
    });

    const unauthorized = await invoke(handler, request("GET", uploadData.url));
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.payload.error_code, "crm_user_required");

    const downloaded = await invokeRaw(handler, request("GET", uploadData.url, headers));
    assert.equal(downloaded.statusCode, 200);
    assert.equal(firstHeader(downloaded.headers["content-type"]), "image/png");
    assert.equal(downloaded.body, "receipt-image");
  } finally {
    await rm(attachmentStorageDir, { recursive: true, force: true });
  }
});

test("createCrmHandler rejects CRM attachments over the configured size", async () => {
  const attachmentStorageDir = await mkdtemp(join(tmpdir(), "crm-attachments-"));
  try {
    const repository = createMemoryRepository();
    const crmUser = await repository.createCrmUser({
      username: "large-attachment-user",
      newApiUserId: 3001
    });
    const headers = userHeaders(crmUser.newApiUserId || 0, crmUser.username);
    const handler = createCrmHandler({
      config: config({ attachmentStorageDir, attachmentMaxBytes: 4 }),
      repository,
      newApiClient: newApiClient()
    });

    const response = await invoke(handler, request("POST", "/crm/attachments", headers, {
      fileName: "too-large.png",
      contentType: "image/png",
      dataBase64: Buffer.from("too-large").toString("base64")
    }));

    assert.equal(response.statusCode, 413);
    assert.equal(response.payload.error_code, "crm_attachment_too_large");
    assert.equal(response.payload.err_msg, "凭证文件过大，请压缩后重新上传。");
  } finally {
    await rm(attachmentStorageDir, { recursive: true, force: true });
  }
});

test("createCrmHandler lists CRM users from CRM records when New API user fetch is unavailable", async () => {
  const repository = createMemoryRepository();
  await repository.createCrmUser({
    username: "business-user",
    newApiUserId: 3001
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async getUser() {
        throw new Error("new-api unavailable");
      }
    }
  });

  const users = await invoke(
    handler,
    request("GET", "/crm/admin/users?page=1&pageSize=20", adminHeaders)
  );

  assert.equal(users.statusCode, 200);
  const items = users.payload.data?.items as Array<Record<string, unknown>> | undefined;
  assert.deepEqual(items?.map((item) => item.username), ["business-user"]);
  assert.deepEqual(items?.map((item) => item.cumulativePaidRmb), [0]);
});

test("createCrmHandler scopes dashboard and agent list to CRM business users", async () => {
  const repository = createMemoryRepository();
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const dashboard = await invoke(
    handler,
    request("GET", "/crm/admin/dashboard/summary", adminHeaders)
  );
  const agents = await invoke(
    handler,
    request("GET", "/crm/admin/agents", adminHeaders)
  );

  assert.equal(dashboard.payload.data?.userCount, 0);
  assert.equal(dashboard.payload.data?.agentCount, 0);
  assert.deepEqual((agents.payload.data?.items as unknown[] | undefined) || [], []);
});

test("createCrmHandler creates distribution profiles from embedded new-api users and binds inviter benefits", async () => {
  const quotaManageCalls: Array<{ newApiUserId: number; mode: string; value: number }> = [];
  let newApiQuota = 0;
  const repository = createMemoryRepository();
  const testConfig = config();
  const inviterUser = await repository.createCrmUser({
    username: "inviter",
    newApiUserId: 2001
  });
  const inviter = await createAgent({ repository, input: { crmUserId: inviterUser.id, operatorCrmUserId: 1, reason: "inviter" } });
  const handler = createCrmHandler({
    config: testConfig,
    repository,
    newApiClient: {
      ...newApiClient(),
      async manageUserQuota(input) {
        quotaManageCalls.push(input);
        newApiQuota += input.value;
        return { ok: true };
      },
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: "new-api-customer", quota: newApiQuota };
      }
    }
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/session/self", {
      ...userHeaders(3003, "new-api-customer"),
      "x-test-crm-inviter-id": String(inviterUser.newApiUserId)
    })
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.data?.capabilities, [crmPageCapabilities.agent]);
  const currentUser = response.payload.data?.currentUser as {
    crmUserId?: number;
    firstTopupDiscountRate?: number | null;
    firstTopupDiscountAvailable?: boolean;
  } | undefined;
  assert.equal(currentUser?.firstTopupDiscountRate, 0.88);
  assert.equal(currentUser?.firstTopupDiscountAvailable, true);
  assert.equal(currentUser?.crmUserId, 3);
  const crmUser = await repository.getCrmUserById(3);
  assert.equal(crmUser?.newApiUserId, 3003);
  const relationship = await repository.getAgentRelationshipByCustomer(3);
  assert.equal(relationship?.agentCrmUserId, inviterUser.id);
  assert.equal(relationship?.bindSource, agentRelationshipBindSources.inviteCode);
  assert.equal(relationship?.bindReason, "new-api 注册邀请关系同步");
  const trialEvents = await repository.listAccountEvents({ eventType: accountEventTypes.signupTrialGrant });
  assert.equal(trialEvents.items.length, 0);
  const ledger = (await repository.listLedger()).items;
  assert.equal(ledger.length, 0);
  assert.deepEqual(quotaManageCalls, []);
});

test("createCrmHandler never mutates signup quota across repeated visits and CRM restarts", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: NewApiQuotaPayload[] = [];
  const firstHandler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: "restart-stable-user", quota: 1000000 };
      },
      async manageUserQuota(input) {
        quotaCalls.push(input);
        return { ok: true };
      }
    }
  });

  const firstVisit = await invoke(
    firstHandler,
    request("GET", "/crm/session/self", userHeaders(901, "restart-stable-user"))
  );
  const repeatedVisit = await invoke(
    firstHandler,
    request("GET", "/crm/session/self", userHeaders(901, "restart-stable-user"))
  );
  const restartedRepository = createMemoryRepository();
  const restartedHandler = createCrmHandler({
    config: config(),
    repository: restartedRepository,
    newApiClient: {
      ...newApiClient(),
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: "restart-stable-user", quota: 1000000 };
      },
      async manageUserQuota(input) {
        quotaCalls.push(input);
        return { ok: true };
      }
    }
  });
  const afterRestart = await invoke(
    restartedHandler,
    request("GET", "/crm/session/self", userHeaders(901, "restart-stable-user"))
  );

  assert.equal(firstVisit.statusCode, 200);
  assert.equal(repeatedVisit.statusCode, 200);
  assert.equal(afterRestart.statusCode, 200);
  assert.deepEqual(quotaCalls, []);
  assert.equal((await repository.getCrmUserByNewApiUserId(901))?.signupTrialGrantStatus, signupTrialGrantStatuses.granted);
  assert.equal((await restartedRepository.getCrmUserByNewApiUserId(901))?.signupTrialGrantStatus, signupTrialGrantStatuses.granted);
});

test("createCrmHandler lets super admins acknowledge a legacy pending signup trial without changing quota", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "pending-trial-user",
    newApiUserId: 3005,
    signupTrialGrantStatus: signupTrialGrantStatuses.pending
  });
  const quotaCalls: Array<{ newApiUserId: number; mode: string; value: number }> = [];
  let newApiQuota = 0;
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: "newapi_user_3005", quota: newApiQuota };
      },
      async manageUserQuota(input) {
        quotaCalls.push(input);
        newApiQuota += input.value;
        return { ok: true };
      }
    }
  });

  const response = await invoke(
    handler,
    request("POST", `/crm/admin/users/${crmUser.id}/signup-trial/retry`, adminHeaders)
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data?.signupTrialGrantStatus, signupTrialGrantStatuses.granted);
  assert.deepEqual(quotaCalls, []);
  assert.equal(await repository.findLedgerEntryByIdempotencyKey(`signup-trial:${crmUser.id}`), null);
});

test("createCrmHandler lets agents submit offline recharge requests", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "recharge-user",
    newApiUserId: 3001
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });
  const headers = userHeaders(crmUser.newApiUserId || 0, crmUser.username);

  const created = await invoke(handler, request("POST", "/crm/agent/offline-recharge-requests", headers, {
    method: "alipay",
    amountRmb: 100,
    payerName: "张三",
    paymentReference: "支付宝流水 20260705001",
    paymentEvidenceUrl: "https://example.com/payments/20260705001.png",
    notes: "首充"
  }));
  const listed = await invoke(handler, request("GET", "/crm/agent/offline-recharge-requests?page=1&pageSize=20", headers));

  assert.equal(created.statusCode, 200);
  assert.equal(created.payload.data?.status, offlineRechargeStatuses.pending);
  assert.equal(created.payload.data?.crmUsername, "recharge-user");
  const page = listed.payload.data as unknown as { items: Array<Record<string, unknown>>; total: number };
  assert.equal(page.total, 1);
  assert.equal(page.items[0].amountRmb, 100);
  assert.equal(page.items[0].method, "alipay");
  assert.equal(page.items[0].paymentEvidenceUrl, "https://example.com/payments/20260705001.png");
});

test("createCrmHandler exposes offline recharge account settings to agents", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "recharge-settings-user",
    newApiUserId: 3001
  });
  await repository.saveSettings({
    ...(await repository.getSettings()),
    offlineRechargeAccounts: [{
      method: "alipay",
      label: "支付宝",
      recipientName: "上海示例公司",
      account: "pay@example.com",
      qrCodeUrl: "https://example.com/alipay.png",
      instructions: "转账备注填写用户名"
    }, {
      method: "wechat",
      label: "微信",
      recipientName: "上海示例公司",
      account: "wechat-pay",
      qrCodeUrl: "https://example.com/wechat.png",
      instructions: "转账备注填写用户名"
    }]
  }, 1);
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });
  const headers = userHeaders(crmUser.newApiUserId || 0, crmUser.username);

  const response = await invoke(handler, request("GET", "/crm/agent/offline-recharge-settings", headers));

  assert.equal(response.statusCode, 200);
  const data = response.payload.data as unknown as { accounts: Array<{ method: string; qrCodeUrl: string }> };
  assert.deepEqual(data.accounts.map((account) => account.method), ["alipay", "wechat"]);
  assert.equal(data.accounts[0].qrCodeUrl, "https://example.com/alipay.png");
});

test("createCrmHandler approves offline recharge requests through unified account events", async () => {
  const repository = createMemoryRepository();
  const managedQuotaCalls: unknown[] = [];
  const crmUser = await repository.createCrmUser({
    username: "paid-user",
    newApiUserId: 3002
  });
  const agent = await repository.createCrmUser({
    username: "agent-for-paid-user",
    newApiUserId: 3003
  });
  const agentRecord = await createAgent({
    repository,
    input: {
      crmUserId: agent.id,
      operatorCrmUserId: agent.id,
      reason: "seed"
    }
  });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: crmUser.id,
      agentCrmUserId: agentRecord.crmUserId,
      operatorCrmUserId: crmUser.id,
      bindSource: agentRelationshipBindSources.adminBind,
      reason: "admin invite-code bind"
    }
  });
  const client = {
    ...newApiClient(),
    async manageUserQuota(input: unknown) {
      managedQuotaCalls.push(input);
      return { ok: true };
    }
  };
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: client
  });
  const created = await invoke(handler, request("POST", "/crm/agent/offline-recharge-requests", userHeaders(crmUser.newApiUserId || 0, crmUser.username), {
    method: "wechat",
    amountRmb: 100,
    payerName: "李四",
    paymentReference: "微信流水 20260705002",
    paymentEvidenceUrl: "https://example.com/payments/20260705002.png"
  }));

  const approved = await invoke(handler, request(
    "POST",
    `/crm/admin/offline-recharge-requests/${created.payload.data?.id}/approve`,
    adminHeaders,
    { reviewReason: "已核对到账" }
  ));
  const events = await invoke(handler, request("GET", "/crm/admin/account-events?page=1&pageSize=20", adminHeaders));
  const profile = await repository.getUserProfile(crmUser.id);

  assert.equal(approved.statusCode, 200);
  assert.equal(approved.payload.data?.status, offlineRechargeStatuses.approved);
  assert.equal(approved.payload.data?.accountEventId, 1);
  assert.equal(profile.cumulativePaidRmb, 100);
  assert.deepEqual(managedQuotaCalls, [{ newApiUserId: 3002, mode: "add", value: 50000000 }]);
  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  const accountLedger = ledger.items.find((entry) => entry.eventType === ledgerEventTypes.accountEvent);
  assert.equal(accountLedger?.balanceAfterRmb, 100);
  const eventPage = events.payload.data as unknown as { items: Array<Record<string, unknown>> };
  assert.equal(eventPage.items[0].eventType, accountEventTypes.adminPaidTopup);
  assert.equal(eventPage.items[0].idempotencyKey, `offline-recharge-request:${created.payload.data?.id}:approve`);
  assert.deepEqual((eventPage.items[0].metadata as { paymentEvidenceUrl?: string } | undefined)?.paymentEvidenceUrl, "https://example.com/payments/20260705002.png");
  const reviewAudit = (await repository.listAuditLogs({
    action: "offline_recharge.approve",
    page: 1,
    pageSize: 10
  })).items[0];
  assert.equal(reviewAudit?.targetType, "offline_recharge_request");
  assert.equal(reviewAudit?.targetId, String(created.payload.data?.id));
  assert.equal((reviewAudit?.beforeSnapshot as { status?: string } | null)?.status, offlineRechargeStatuses.pending);
  assert.equal((reviewAudit?.afterSnapshot as { status?: string } | null)?.status, offlineRechargeStatuses.approved);
});

test("createCrmHandler rejects offline recharge requests without creating account events", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "reject-recharge-user",
    newApiUserId: 3004
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });
  const created = await invoke(handler, request("POST", "/crm/agent/offline-recharge-requests", userHeaders(crmUser.newApiUserId || 0, crmUser.username), {
    method: "wechat",
    amountRmb: 20,
    paymentReference: "未到账"
  }));

  const rejected = await invoke(handler, request(
    "POST",
    `/crm/admin/offline-recharge-requests/${created.payload.data?.id}/reject`,
    adminHeaders,
    { reviewReason: "未查询到对应转账" }
  ));
  const events = await invoke(handler, request("GET", "/crm/admin/account-events?page=1&pageSize=20", adminHeaders));

  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.payload.data?.status, offlineRechargeStatuses.rejected);
  const eventPage = events.payload.data as unknown as { total: number };
  assert.equal(eventPage.total, 0);
  const reviewAudit = (await repository.listAuditLogs({
    action: "offline_recharge.reject",
    page: 1,
    pageSize: 10
  })).items[0];
  assert.equal(reviewAudit?.targetType, "offline_recharge_request");
  assert.equal(reviewAudit?.targetId, String(created.payload.data?.id));
  assert.equal((reviewAudit?.beforeSnapshot as { status?: string } | null)?.status, offlineRechargeStatuses.pending);
  assert.equal((reviewAudit?.afterSnapshot as { status?: string } | null)?.status, offlineRechargeStatuses.rejected);
});

test("createCrmHandler rejects a concurrent offline recharge review after approval is claimed", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "concurrent-recharge-user",
    newApiUserId: 3010
  });
  let releaseQuota!: () => void;
  let notifyQuotaStarted!: () => void;
  const quotaStarted = new Promise<void>((resolve) => {
    notifyQuotaStarted = resolve;
  });
  const quotaRelease = new Promise<void>((resolve) => {
    releaseQuota = resolve;
  });
  let quotaCalls = 0;
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async manageUserQuota() {
        quotaCalls += 1;
        notifyQuotaStarted();
        await quotaRelease;
        return { ok: true };
      }
    }
  });
  const created = await invoke(handler, request(
    "POST",
    "/crm/agent/offline-recharge-requests",
    userHeaders(crmUser.newApiUserId || 0, crmUser.username),
    {
      method: "alipay",
      amountRmb: 50,
      paymentReference: "concurrent-review"
    }
  ));
  const requestId = Number(created.payload.data?.id);

  const approving = invoke(handler, request(
    "POST",
    `/crm/admin/offline-recharge-requests/${requestId}/approve`,
    adminHeaders,
    { reviewReason: "到账确认" }
  ));
  await quotaStarted;
  const rejected = await invoke(handler, request(
    "POST",
    `/crm/admin/offline-recharge-requests/${requestId}/reject`,
    adminHeaders,
    { reviewReason: "并发驳回" }
  ));
  releaseQuota();
  const approved = await approving;

  assert.equal(approved.statusCode, 200);
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.payload.error_code, "offline_recharge_status_invalid");
  assert.equal(quotaCalls, 1);
  assert.equal((await repository.getOfflineRechargeRequestById(requestId))?.status, offlineRechargeStatuses.approved);
});

test("createCrmHandler keeps agent embedded identities out of super admin APIs", async () => {
  const repository = createMemoryRepository();
  await repository.createCrmUser({
    username: "agent",
    email: "",
    newApiUserId: 2002
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const admin = await invoke(
    handler,
    request("GET", "/crm/admin/dashboard/summary", userHeaders(2002, "agent"))
  );
  assert.equal(admin.statusCode, 403);
  assert.equal(admin.payload.error_code, "crm_super_admin_forbidden");
  assert.equal(admin.payload.err_msg, "当前账号没有平台管理权限。");
});

test("createCrmHandler syncs new-api consume logs into CRM ledger and effective customer candidates", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({
    username: "agent",
    email: "",
    newApiUserId: 2001
  });
  const customer = await repository.createCrmUser({
    username: "customer",
    email: "",
    newApiUserId: 2002
  });
  const agent = await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      operatorCrmUserId: 1,
      reason: "test agent"
    }
  });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customer.id,
    firstPaidEventId: 10,
    firstPaidAmountRmb: 100,
    firstPaidAt: "2024-01-01 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: 0,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });
  const consumeLogCalls: Array<{ page?: number; pageSize?: number; username?: string }> = [];
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: `newapi_${newApiUserId}`, quota: 1000000 };
      },
      async listConsumeLogs(input?: { page?: number; pageSize?: number; username?: string }) {
        consumeLogCalls.push(input || {});
        return {
          items: input?.page === 1
            ? [{
              id: 88,
              type: 2,
              username: "newapi_2002",
              model_name: "gpt-image-2",
              quota: 15000000,
              prompt_tokens: 0,
              completion_tokens: 0,
              content: "image generation",
              created_at: 1710000000
            }]
            : [],
          total: 1
        };
      }
    }
  });

  const response = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/sync-consumption", adminHeaders, {
      customerCrmUserId: customer.id
    })
  );
  const secondResponse = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/sync-consumption", adminHeaders, {
      customerCrmUserId: customer.id
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data?.syncedLogs, 1);
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(secondResponse.payload.data?.syncedLogs, 0);
  assert.equal(consumeLogCalls[0].username, "newapi_2002");
  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  assert.equal(ledger.total, 1);
  assert.equal(ledger.items[0].eventType, ledgerEventTypes.imageConsume);
  assert.equal(ledger.items[0].amountRmb, 30);
  const candidates = await repository.listEffectiveCustomers({ customerCrmUserId: customer.id });
  assert.equal(candidates.items[0].paidBalanceConsumedRate, 0.3);
  assert.equal(candidates.items[0].countedForLevel, true);
  assert.equal(candidates.items[0].isEffective, true);
});

test("createCrmHandler creates fixed enterprise commissions from image consume logs", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({
    username: "enterprise-agent",
    email: "",
    newApiUserId: 2101
  });
  const customer = await repository.createCrmUser({
    username: "enterprise-customer",
    email: "",
    newApiUserId: 2102
  });
  await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      operatorCrmUserId: 1,
      reason: "enterprise agent"
    }
  });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: customer.id,
      agentCrmUserId: agentUser.id,
      allowRebind: true,
      operatorCrmUserId: 1,
      reason: "enterprise customer bind"
    }
  });
  await repository.saveUserProfile({
    ...(await repository.getUserProfile(customer.id)),
    isEnterprise: true,
    enterpriseFixedCommissionPerImage: 0.05
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async getUser(newApiUserId: number) {
        return { id: newApiUserId, username: `enterprise_newapi_${newApiUserId}`, quota: 1000000 };
      },
      async listConsumeLogs(input?: { page?: number }) {
        return {
          items: input?.page === 1
            ? [{
              id: 188,
              type: 2,
              username: "enterprise_newapi_2102",
              model_name: "gpt-image-2",
              image_count: 3,
              quota: 1500000,
              content: "enterprise image generation",
              created_at: 1710000000
            }]
            : [],
          total: 1
        };
      }
    }
  });

  const first = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/sync-consumption", adminHeaders, {
      customerCrmUserId: customer.id
    })
  );
  const second = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/sync-consumption", adminHeaders, {
      customerCrmUserId: customer.id
    })
  );

  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.data?.syncedLogs, 1);
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.data?.syncedLogs, 0);
  const commissions = await repository.listCommissions({ page: 1, pageSize: 10 });
  assert.deepEqual(commissions.items.map((commission) => [
    commission.beneficiaryCrmUserId,
    commission.customerCrmUserId,
    commission.commissionType,
    commission.baseAmountRmb,
    commission.rate,
    commission.amountRmb,
    commission.status
  ]), [
    [agentUser.id, customer.id, commissionTypes.enterpriseFixedPerImage, 3, 0.05, 0.15, "frozen"]
  ]);
  const commissionLedger = (await repository.listLedger({ page: 1, pageSize: 10 })).items
    .filter((entry) => entry.eventType === ledgerEventTypes.commissionFreeze);
  assert.equal(commissionLedger.length, 1);
  assert.equal(commissionLedger[0]?.amountRmb, 0.15);
});

test("createCrmHandler generates and lists enterprise monthly settlements", async () => {
  const repository = createMemoryRepository();
  const customer = await repository.createCrmUser({
    username: "enterprise-monthly",
    email: "",
    newApiUserId: 2202
  });
  await repository.saveUserProfile({
    ...(await repository.getUserProfile(customer.id)),
    isEnterprise: true
  });
  await repository.insertLedgerEntry({
    crmUserId: customer.id,
    direction: ledgerDirections.debit,
    amountRmb: 12,
    eventType: ledgerEventTypes.imageConsume,
    sourceType: "new_api_consume_log",
    sourceId: null,
    idempotencyKey: "enterprise-monthly-2026-06",
    operatorCrmUserId: customer.id,
    reason: "模型消耗同步",
    isPaid: false,
    createdAt: "2026-06-10 00:00:00"
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const generated = await invoke(
    handler,
    request("POST", "/crm/admin/enterprise/monthly-settlements/generate", adminHeaders, {
      period: "2026-06",
      syncConsumption: false
    })
  );
  const list = await invoke(
    handler,
    request("GET", "/crm/admin/enterprise/monthly-settlements?page=1&pageSize=20&period=2026-06", adminHeaders)
  );

  assert.equal(generated.statusCode, 200);
  assert.equal(generated.payload.data?.settlementsGenerated, 1);
  assert.equal(generated.payload.data?.totalUsageRmb, 12);
  assert.equal(list.statusCode, 200);
  const items = list.payload.data?.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.crmUsername, "enterprise-monthly");
  assert.equal(items[0]?.usageRmb, 12);
  assert.equal(items[0]?.status, enterpriseMonthlySettlementStatuses.pending);
});

test("createCrmHandler reconciles account events by applying local ledger after manual new-api confirmation", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "customer",
    email: "",
    newApiUserId: 2002
  });
  const accountEvent = await repository.createAccountEvent({
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: crmUser.id,
    operatorCrmUserId: 1,
    amountRmb: 50,
    paidAmountRmb: 50,
    discountAmountRmb: 0,
    commissionBaseRmb: 50,
    quotaDelta: 25000000,
    idempotencyKey: "manual-reconcile-test",
    reason: "线下实付入账"
  });
  await repository.markAccountEventReconcileRequired(accountEvent.id, "new-api timeout after quota request");
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${accountEvent.id}/reconcile`, adminHeaders, {
      action: "confirm_quota_applied",
      reason: "已确认模型服务额度已入账"
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload.data?.record as { status?: string } | undefined)?.status, accountEventStatuses.completed);
  assert.equal((response.payload.data?.profile as { cumulativePaidRmb?: number } | undefined)?.cumulativePaidRmb, 50);
  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  assert.equal(ledger.total, 1);
  assert.equal(ledger.items[0].eventType, ledgerEventTypes.accountEvent);
  assert.equal(ledger.items[0].amountRmb, 50);
  assert.equal((await repository.getUserProfile(crmUser.id)).cumulativePaidRmb, 50);
});

test("createCrmHandler recovers stale quota_applying events after manual quota confirmation", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "quota-applying-customer",
    email: "",
    newApiUserId: 2003
  });
  const accountEvent = await repository.createAccountEvent({
    eventType: accountEventTypes.compensationGrant,
    crmUserId: crmUser.id,
    operatorCrmUserId: 1,
    amountRmb: 10,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    quotaDelta: 5000000,
    idempotencyKey: "stale-quota-applying-test",
    reason: "补偿额度"
  });
  await repository.markAccountEventQuotaApplying(accountEvent.id);
  let quotaCalls = 0;
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async manageUserQuota() {
        quotaCalls += 1;
        return { ok: true };
      }
    }
  });

  const response = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${accountEvent.id}/reconcile`, adminHeaders, {
      action: "confirm_quota_applied",
      reason: "已在 New API 后台确认额度已增加"
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload.data?.record as { status?: string } | undefined)?.status, accountEventStatuses.completed);
  assert.equal(quotaCalls, 0);
  assert.equal((await repository.listLedger({ page: 1, pageSize: 10 })).total, 1);
  assert.deepEqual((await repository.getAccountEventById(accountEvent.id))?.newApiResult, {
    manuallyConfirmed: true,
    reason: "已在 New API 后台确认额度已增加"
  });
});

test("createCrmHandler cancels reconcile account events without writing local ledger", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "customer",
    email: "",
    newApiUserId: 2002
  });
  const accountEvent = await repository.createAccountEvent({
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: crmUser.id,
    operatorCrmUserId: 1,
    amountRmb: 50,
    paidAmountRmb: 50,
    discountAmountRmb: 0,
    commissionBaseRmb: 50,
    quotaDelta: 25000000,
    idempotencyKey: "manual-reconcile-cancel-test",
    reason: "线下实付入账"
  });
  await repository.markAccountEventReconcileRequired(accountEvent.id, "new-api timeout before quota change");
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${accountEvent.id}/reconcile`, adminHeaders, {
      action: "cancel",
      reason: "已确认模型服务额度未入账"
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload.data?.record as { status?: string } | undefined)?.status, accountEventStatuses.cancelled);
  assert.equal((await repository.listLedger({ page: 1, pageSize: 10 })).total, 0);
  assert.equal((await repository.getUserProfile(crmUser.id)).cumulativePaidRmb, 0);
});

test("createCrmHandler refuses to cancel reconciliation when quota application is already proven", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "proven-quota-customer",
    email: "",
    newApiUserId: 2004
  });
  const accountEvent = await repository.createAccountEvent({
    eventType: accountEventTypes.adminPaidTopup,
    crmUserId: crmUser.id,
    operatorCrmUserId: 1,
    amountRmb: 30,
    paidAmountRmb: 30,
    discountAmountRmb: 0,
    commissionBaseRmb: 30,
    quotaDelta: 15000000,
    idempotencyKey: "proven-quota-cancel-test",
    reason: "线下实付入账"
  });
  await repository.markAccountEventQuotaApplying(accountEvent.id);
  await repository.markAccountEventQuotaApplied(accountEvent.id, { newApiResult: { ok: true, requestId: "quota-123" } });
  await repository.markAccountEventLocalApplying(accountEvent.id);
  await repository.markAccountEventReconcileRequired(accountEvent.id, "local transaction failed");
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${accountEvent.id}/reconcile`, adminHeaders, {
      action: "cancel",
      reason: "错误取消"
    })
  );

  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.error_code, "account_event_cancel_not_allowed");
  assert.equal((await repository.getAccountEventById(accountEvent.id))?.status, accountEventStatuses.reconcileRequired);
});

test("createCrmHandler cancels stale quota_applying events only after confirming quota was not applied", async () => {
  const repository = createMemoryRepository();
  const crmUser = await repository.createCrmUser({
    username: "quota-not-applied-customer",
    email: "",
    newApiUserId: 2005
  });
  const accountEvent = await repository.createAccountEvent({
    eventType: accountEventTypes.compensationGrant,
    crmUserId: crmUser.id,
    operatorCrmUserId: 1,
    amountRmb: 5,
    paidAmountRmb: 0,
    discountAmountRmb: 0,
    commissionBaseRmb: 0,
    quotaDelta: 2500000,
    idempotencyKey: "cancel-quota-applying-test",
    reason: "补偿额度"
  });
  await repository.markAccountEventQuotaApplying(accountEvent.id);
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${accountEvent.id}/reconcile`, adminHeaders, {
      action: "cancel",
      reason: "已确认额度请求未执行"
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload.data?.record as { status?: string } | undefined)?.status, accountEventStatuses.cancelled);
});

test("createCrmHandler refunds completed paid account events with quota, ledger, commission and effective-customer rollback", async () => {
  const repository = createMemoryRepository();
  const quotaCalls: NewApiQuotaPayload[] = [];
  const parentUser = await repository.createCrmUser({
    username: "refund-parent",
    email: "",
    newApiUserId: 2001
  });
  const agentUser = await repository.createCrmUser({
    username: "refund-agent",
    email: "",
    newApiUserId: 2002
  });
  const customerUser = await repository.createCrmUser({
    username: "refund-customer",
    email: "",
    newApiUserId: 3002
  });
  await createAgent({ repository, input: { crmUserId: parentUser.id, operatorCrmUserId: 1, reason: "parent" } });
  const agent = await createAgent({
    repository,
    input: {
      crmUserId: agentUser.id,
      parentAgentCrmUserId: parentUser.id,
      operatorCrmUserId: 1,
      reason: "agent"
    }
  });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: customerUser.id,
      agentCrmUserId: agentUser.id,
      allowRebind: true,
      operatorCrmUserId: 1,
      reason: "bind customer"
    }
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: {
      ...newApiClient(),
      async manageUserQuota(input: NewApiQuotaPayload) {
        quotaCalls.push(input);
        return { ok: true };
      }
    } as NewApiClient
  });
  const created = await invoke(
    handler,
    request("POST", "/crm/admin/account-events", adminHeaders, {
      eventType: accountEventTypes.adminPaidTopup,
      crmUserId: customerUser.id,
      amountRmb: 100,
      reason: "线下实付入账"
    })
  );
  const createdEvent = created.payload.data?.record as { id?: number } | undefined;
  assert.equal(created.statusCode, 200);
  assert.ok(createdEvent?.id);

  const refunded = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${createdEvent.id}/refund`, adminHeaders, {
      reason: "客户退款"
    })
  );

  assert.equal(refunded.statusCode, 200);
  assert.equal((refunded.payload.data?.profile as { cumulativePaidRmb?: number } | undefined)?.cumulativePaidRmb, 0);
  assert.deepEqual(quotaCalls, [
    { newApiUserId: customerUser.newApiUserId, mode: "add", value: 50000000 },
    { newApiUserId: customerUser.newApiUserId, mode: "subtract", value: 50000000 }
  ]);
  const profile = await repository.getUserProfile(customerUser.id);
  assert.equal(profile.cumulativePaidRmb, 0);
  const ledger = await repository.listLedger({ page: 1, pageSize: 20 });
  const refundLedger = ledger.items.find((entry) => entry.eventType === ledgerEventTypes.refund);
  assert.equal(refundLedger?.direction, ledgerDirections.debit);
  assert.equal(refundLedger?.amountRmb, 100);
  assert.equal(refundLedger?.balanceAfterRmb, 0);
  assert.equal(refundLedger?.sourceType, "account_event");
  assert.equal(refundLedger?.sourceId, createdEvent.id);

  const commissions = (await repository.listCommissions({ page: 1, pageSize: 20 })).items;
  assert.deepEqual(commissions.map((commission) => commission.status), [
    commissionStatuses.clawedBack,
    commissionStatuses.clawedBack
  ]);
  assert.equal(ledger.items.filter((entry) => entry.eventType === ledgerEventTypes.commissionClawback).length, 2);
  const candidate = await repository.getEffectiveCustomerByAgentAndCustomer(agent.id, customerUser.id);
  assert.equal(candidate?.isRefunded, true);
  assert.equal(candidate?.isEffective, false);
  assert.equal(candidate?.countedForLevel, false);

  const duplicate = await invoke(
    handler,
    request("POST", `/crm/admin/account-events/${createdEvent.id}/refund`, adminHeaders, {
      reason: "重复退款"
    })
  );
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.payload.error_code, "account_event_already_refunded");
});

test("createCrmHandler supports admin invite-code customer binding", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent-user", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer-user", newApiUserId: 3001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", "/crm/admin/agent-relationships", adminHeaders, {
      customerCrmUserId: customerUser.id,
      inviteCode: agent.inviteCode,
      reason: "admin bind by invite code"
    })
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal((await repository.getAgentRelationshipByCustomer(customerUser.id))?.agentCrmUserId, agentUser.id);
});

test("createCrmHandler lets super admins evaluate effective customer candidates from synced consumption", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent-user", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer-user", newApiUserId: 3001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customerUser.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-01-01 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/evaluate", adminHeaders, {
      agentId: agent.id,
      customerCrmUserId: customerUser.id,
      evaluatedAt: "2026-01-08 00:00:00"
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload.data?.effectiveCustomer as { countedForLevel?: boolean }).countedForLevel, true);
  assert.equal((response.payload.data?.agent as { effectivePaidCustomerCount?: number }).effectivePaidCustomerCount, 1);
});

test("createCrmHandler records admin commission action reasons from the request body", async () => {
  const repository = createMemoryRepository();
  const admin = await repository.createCrmUser({ username: "admin", newApiUserId: 1001, newApiRole: 100 });
  const agentUser = await repository.createCrmUser({ username: "commission-agent", newApiUserId: 2001 });
  const [commission] = await repository.insertCommissionRecords([{
    sourceType: "seed",
    sourceId: 1,
    beneficiaryCrmUserId: agentUser.id,
    customerCrmUserId: agentUser.id,
    commissionType: commissionTypes.agentDirectCommission,
    orderKind: "first_order",
    agentLevel: "standard",
    baseAmountRmb: 100,
    rate: 0.45,
    amountRmb: 45
  }]);
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(handler, request("POST", `/crm/admin/commissions/${commission.id}/release`, adminHeaders, {
    reason: "核对订单已满观察期，释放佣金"
  }));

  assert.equal(response.statusCode, 200);
  const ledger = await repository.listLedger({ page: 1, pageSize: 10 });
  assert.equal(ledger.items[0]?.reason, "核对订单已满观察期，释放佣金");
});

test("createCrmHandler ignores manually submitted consumption rates when evaluating effective customers", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent-user", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer-user", newApiUserId: 3001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customerUser.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-01-01 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: 0,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/evaluate", adminHeaders, {
      agentId: agent.id,
      customerCrmUserId: customerUser.id,
      paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
      evaluatedAt: "2026-01-08 00:00:00"
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal((response.payload.data?.effectiveCustomer as { paidBalanceConsumedRate?: number }).paidBalanceConsumedRate, 0);
  assert.equal((response.payload.data?.effectiveCustomer as { countedForLevel?: boolean }).countedForLevel, false);
  assert.equal((response.payload.data?.agent as { effectivePaidCustomerCount?: number }).effectivePaidCustomerCount, 0);
});

test("createCrmHandler lists effective customer candidates for super admins", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "agent-user", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer-user", newApiUserId: 3001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customerUser.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-01-01 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: 0,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("GET", "/crm/admin/effective-customers?page=1&pageSize=5", adminHeaders)
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data?.total, 1);
  assert.equal(((response.payload.data?.items as unknown[])?.[0] as { customerCrmUserId?: number }).customerCrmUserId, customerUser.id);
});

test("createCrmHandler runs effective customer maintenance for super admins", async () => {
  const repository = createMemoryRepository();
  const agentUser = await repository.createCrmUser({ username: "maintenance-agent", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "maintenance-customer", newApiUserId: 3001 });
  const agent = await createAgent({ repository, input: { crmUserId: agentUser.id, operatorCrmUserId: 1, reason: "agent" } });
  await repository.saveEffectiveCustomer({
    agentId: agent.id,
    customerCrmUserId: customerUser.id,
    firstPaidEventId: 1,
    firstPaidAmountRmb: effectiveCustomerRules.minFirstPaidRmb,
    firstPaidAt: "2026-01-01 00:00:00",
    sevenDayCheckedAt: null,
    paidBalanceConsumedRate: effectiveCustomerRules.minPaidBalanceConsumedRate,
    isRefunded: false,
    isRelatedAccount: false,
    isRisk: false,
    isEffective: false,
    countedForLevel: false
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", "/crm/admin/effective-customers/maintenance", adminHeaders, {
      evaluatedAt: "2026-01-08 00:00:00",
      syncConsumption: false
    })
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data?.candidatesEvaluated, 1);
  assert.equal((await repository.getEffectiveCustomerByAgentAndCustomer(agent.id, customerUser.id))?.countedForLevel, true);
});

test("createCrmHandler keeps admin APIs under /crm/admin only", async () => {
  const handler = createCrmHandler({
    config: config(),
    repository: createMemoryRepository(),
    newApiClient: newApiClient()
  });

  for (const path of ["/crm/users", "/crm/settings", "/crm/agents", "/crm/ledger", "/crm/general/dashboard"]) {
    const response = await invoke(handler, request("GET", path, adminHeaders));
    assert.equal(response.statusCode, 404);
  }

  const settings = await invoke(handler, request("GET", "/crm/admin/settings", adminHeaders));
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.payload.ok, true);
});

test("createCrmHandler processes standard paid account events with parent service fee", async () => {
  const repository = createMemoryRepository();
  const parentUser = await repository.createCrmUser({ username: "parent-user", newApiUserId: 1001 });
  const agentUser = await repository.createCrmUser({ username: "agent-user", newApiUserId: 2001 });
  const customerUser = await repository.createCrmUser({ username: "customer-user", newApiUserId: 3001 });
  await createAgent({ repository, input: { crmUserId: parentUser.id, operatorCrmUserId: 1, reason: "parent" } });
  await createAgent({ repository, input: { crmUserId: agentUser.id, parentAgentCrmUserId: parentUser.id, operatorCrmUserId: 1, reason: "child" } });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: customerUser.id,
      agentCrmUserId: agentUser.id,
      allowRebind: true,
      operatorCrmUserId: 1,
      reason: "bind"
    }
  });
  const handler = createCrmHandler({
    config: config(),
    repository,
    newApiClient: newApiClient()
  });

  const response = await invoke(
    handler,
    request("POST", "/crm/admin/account-events", adminHeaders, {
      eventType: "admin_paid_topup",
      crmUserId: customerUser.id,
      amountRmb: 100,
      idempotencyKey: "server-paid-1",
      reason: "offline paid"
    })
  );

  assert.equal(response.statusCode, 200);
  const commissions = (await repository.listCommissions()).items;
  assert.deepEqual(commissions.map((item) => [item.beneficiaryCrmUserId, item.commissionType, item.amountRmb]), [
    [agentUser.id, "agent_direct_commission", 45],
    [parentUser.id, "parent_agent_service_fee", 10]
  ]);
});
