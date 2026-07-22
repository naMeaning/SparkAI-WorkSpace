import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

type FetchImpl = (input: URL, init?: RequestInit) => Promise<Response>;
type LogFn = (message: string) => void;

export interface CrmRealSmokeResult {
  status: "passed" | "skipped";
  reason?: string;
  checks: string[];
}

interface SmokeOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchImpl;
  log?: LogFn;
  now?: () => Date;
  nonce?: () => string;
}

interface EmbeddedIdentity {
  userId: number;
  username: string;
  displayName?: string;
  email?: string;
  role: number;
  inviterId?: number;
}

interface SmokeRequestResult<T> {
  data: T;
  response: Response;
}

interface PageResult<T> {
  items: T[];
  total: number;
}

type JsonRecord = Record<string, unknown>;

function trim(value: unknown): string {
  return String(value || "").trim();
}

function baseUrlFromEnv(env: Record<string, string | undefined>): string {
  return trim(env.CRM_SMOKE_BASE_URL || env.CRM_API_BASE_URL) || "http://127.0.0.1:17861";
}

function isStrict(env: Record<string, string | undefined>): boolean {
  return ["1", "true", "yes", "on"].includes(trim(env.CRM_SMOKE_STRICT).toLowerCase());
}

function parsePositiveInteger(value: unknown): number {
  const parsed = Number(trim(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function buildEmbeddedHeaders({
  method,
  path,
  identity,
  secret,
  timestamp,
  nonce
}: {
  method: string;
  path: string;
  identity: EmbeddedIdentity;
  secret: string;
  timestamp: number;
  nonce: string;
}): Record<string, string> {
  const username = base64Url(identity.username);
  const displayName = base64Url(identity.displayName || "");
  const email = base64Url(identity.email || "");
  const inviterId = String(identity.inviterId || 0);
  const payload = [
    method,
    path,
    String(timestamp),
    nonce,
    String(identity.userId),
    username,
    displayName,
    email,
    String(identity.role),
    inviterId
  ].join("\n");
  return {
    "x-crm-embed-user-id": String(identity.userId),
    "x-crm-embed-username-b64": username,
    "x-crm-embed-display-name-b64": displayName,
    "x-crm-embed-email-b64": email,
    "x-crm-embed-role": String(identity.role),
    "x-crm-embed-inviter-id": inviterId,
    "x-crm-embed-timestamp": String(timestamp),
    "x-crm-embed-nonce": nonce,
    "x-crm-embed-signature": crypto.createHmac("sha256", secret).update(payload).digest("base64url")
  };
}

async function readPayload<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) as JsonRecord : {};
  if (!response.ok || payload.ok === false) {
    throw new Error(trim(payload.err_msg || payload.message || payload.error) || `CRM API ${response.status}`);
  }
  return (payload.ok === true && "data" in payload ? payload.data : payload) as T;
}

async function smokeRequest<T>({
  baseUrl,
  fetchImpl,
  path,
  method = "GET",
  body,
  identity,
  embedSecret,
  now,
  nonce
}: {
  baseUrl: string;
  fetchImpl: FetchImpl;
  path: string;
  method?: string;
  body?: unknown;
  identity?: EmbeddedIdentity;
  embedSecret?: string;
  now: () => Date;
  nonce: () => string;
}): Promise<SmokeRequestResult<T>> {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
  const headers = {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(identity && embedSecret
      ? buildEmbeddedHeaders({
        method,
        path: url.pathname,
        identity,
        secret: embedSecret,
        timestamp: now().getTime(),
        nonce: nonce()
      })
      : {})
  };
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    response,
    data: await readPayload<T>(response)
  };
}

function skipOrThrow(reason: string, strict: boolean): CrmRealSmokeResult {
  if (strict) throw new Error(reason);
  return { status: "skipped", reason, checks: [] };
}

export async function runCrmRealSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
  now = () => new Date(),
  nonce = () => crypto.randomBytes(8).toString("hex")
}: SmokeOptions = {}): Promise<CrmRealSmokeResult> {
  const strict = isStrict(env);
  const embedSecret = trim(env.CRM_SMOKE_EMBED_TRUST_SECRET || env.CRM_EMBED_TRUST_SECRET);
  if (!embedSecret) {
    return skipOrThrow("CRM real smoke skipped: set CRM_SMOKE_EMBED_TRUST_SECRET to sign embedded new-api identities.", strict);
  }

  const adminUserId = parsePositiveInteger(env.CRM_SMOKE_ADMIN_NEW_API_USER_ID) || 1;
  const userId = parsePositiveInteger(env.CRM_SMOKE_USER_NEW_API_USER_ID);
  if (!userId) {
    return skipOrThrow("CRM real smoke skipped: set CRM_SMOKE_USER_NEW_API_USER_ID to an existing normal new-api user id.", strict);
  }

  const admin: EmbeddedIdentity = {
    userId: adminUserId,
    username: trim(env.CRM_SMOKE_ADMIN_USERNAME) || "root",
    role: 100
  };
  const user: EmbeddedIdentity = {
    userId,
    username: trim(env.CRM_SMOKE_USERNAME) || `crm-smoke-${userId}`,
    email: trim(env.CRM_SMOKE_USER_EMAIL),
    role: 1,
    inviterId: parsePositiveInteger(env.CRM_SMOKE_INVITER_NEW_API_USER_ID)
  };

  const checks: string[] = [];
  const baseUrl = baseUrlFromEnv(env);
  const request = <T>(input: Omit<Parameters<typeof smokeRequest<T>>[0], "baseUrl" | "fetchImpl" | "embedSecret" | "now" | "nonce">) =>
    smokeRequest<T>({ baseUrl, fetchImpl, embedSecret, now, nonce, ...input });

  try {
    await request({ path: "/health" });
    checks.push("health");
  } catch (error) {
    return skipOrThrow(`CRM real smoke skipped: CRM API is not reachable at ${baseUrl} (${error instanceof Error ? error.message : String(error)}).`, strict);
  }

  await request({ path: "/crm/session/self", identity: admin });
  checks.push("admin-session");

  await request({ path: "/crm/session/self", identity: user });
  checks.push("user-session");

  await request({
    path: "/crm/agent/offline-recharge-settings",
    identity: user
  });
  checks.push("offline-recharge-settings");

  const recharge = await request<{ id: number }>({
    path: "/crm/agent/offline-recharge-requests",
    method: "POST",
    identity: user,
    body: {
      method: "alipay",
      amountRmb: 1.23,
      payerName: "CRM Smoke",
      paymentReference: `smoke-${user.username}-${now().getTime()}`,
      paymentEvidenceUrl: "https://example.com/crm-smoke-payment.png",
      notes: "CRM real service smoke"
    }
  });
  checks.push("offline-recharge-create");

  await request({
    path: `/crm/admin/offline-recharge-requests/${recharge.data.id}/approve`,
    method: "POST",
    identity: admin,
    body: { reviewReason: "CRM smoke 确认到账" }
  });
  checks.push("offline-recharge-approve");

  await request<PageResult<JsonRecord>>({
    path: `/crm/admin/users?page=1&pageSize=5&keyword=${encodeURIComponent(user.username)}`,
    identity: admin
  });
  checks.push("admin-user-query");

  await request<JsonRecord>({
    path: "/crm/admin/dashboard/summary",
    identity: admin
  });
  checks.push("admin-dashboard-summary");

  await request<PageResult<JsonRecord>>({
    path: "/crm/admin/risk-cases?page=1&pageSize=5",
    identity: admin
  });
  checks.push("admin-risk-cases");

  await request<PageResult<JsonRecord>>({
    path: "/crm/admin/enterprise/monthly-settlements?page=1&pageSize=5",
    identity: admin
  });
  checks.push("admin-enterprise-settlements");

  for (const check of checks) log(`CRM real smoke check passed: ${check}`);
  log(`CRM real smoke passed for new-api user ${user.userId}`);
  return { status: "passed", checks };
}

function isMainModule(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  runCrmRealSmoke().then((result) => {
    if (result.status === "skipped") {
      console.log(result.reason);
    }
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
