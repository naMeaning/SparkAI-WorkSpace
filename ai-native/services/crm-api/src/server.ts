import crypto from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  agentRelationshipBindSources,
  crmModules,
  inviteFirstTopupDiscountRate,
  signupTrialGrantStatuses,
  type CrmSchedulersHealthDto
} from "@ai-native/crm-contracts";
import { createServiceStatus } from "@ai-native/shared";
import { parseCrmConfig } from "./config.js";
import { createRepository } from "./db/mysql.js";
import { bindCustomerAgent, ensureAgent } from "./domain/agents.js";
import { runEffectiveCustomerMaintenance } from "./domain/effective-customer-maintenance.js";
import { generateEnterpriseMonthlySettlements } from "./domain/enterprise-settlements.js";
import { runUsageSyncMaintenance } from "./domain/usage-sync-maintenance.js";
import {
  bindCorsOrigin,
  fail,
  httpError,
  json,
  matchPath,
  ok,
  parsePositiveInteger,
  readJsonBody
} from "./http.js";
import { createNewApiClient } from "./new-api/client.js";
import { runWithCrmRequestContext } from "./request-context.js";
import { createSchedulerController, type SchedulerController } from "./scheduler-health.js";
import {
  createAccountEventRoute,
  listAccountEventsRoute,
  reconcileAccountEventRoute,
  refundAccountEventRoute
} from "./routes/account-events.js";
import {
  createAgentWithdrawalRoute,
  getAgentDashboardRoute,
  listAgentCommissionsRoute,
  listAgentCustomersRoute,
  listAgentSubAgentsRoute,
  listAgentWithdrawalsRoute
} from "./routes/agent-dashboard.js";
import { bindCustomerAgentRoute, createAgentRoute, listAgentsRoute, updateAgentRoute } from "./routes/agents.js";
import { uploadAttachmentRoute, writeAttachmentResponse } from "./routes/attachments.js";
import { listAuditLogsRoute } from "./routes/audit-logs.js";
import { listCommissionsRoute, matchCommissionAction, updateCommissionStatusRoute } from "./routes/commissions.js";
import { getDashboardSummary } from "./routes/dashboard.js";
import {
  evaluateEffectiveCustomerRoute,
  listEffectiveCustomersRoute,
  runEffectiveCustomerMaintenanceRoute,
  syncEffectiveCustomerConsumptionRoute
} from "./routes/effective-customers.js";
import {
  generateEnterpriseMonthlySettlementsRoute,
  listEnterpriseMonthlySettlementsRoute,
  matchEnterpriseMonthlySettlementAction,
  updateEnterpriseMonthlySettlementRoute
} from "./routes/enterprise-settlements.js";
import { listLedger } from "./routes/ledger.js";
import {
  createAgentOfflineRechargeRequestRoute,
  getAgentOfflineRechargeSettingsRoute,
  listAdminOfflineRechargeRequestsRoute,
  listAgentOfflineRechargeRequestsRoute,
  matchOfflineRechargeAction,
  updateOfflineRechargeRequestRoute
} from "./routes/offline-recharges.js";
import { createRiskCaseRoute, listRiskCasesRoute, parseRiskCaseId, updateRiskCaseRoute } from "./routes/risk-cases.js";
import { getSessionRoute } from "./routes/session.js";
import { getSettingsRoute, updateSettingsRoute } from "./routes/settings.js";
import { getUser, listUsers, updateUserProfile } from "./routes/users.js";
import { listWithdrawalsRoute, matchWithdrawalAction, updateWithdrawalRoute } from "./routes/withdrawals.js";
import type { CrmConfig, CrmRepository, CrmUserContext, NewApiClient } from "./types.js";

interface CrmServerDependencies {
  config: CrmConfig;
  repository: CrmRepository;
  newApiClient: NewApiClient;
  schedulers?: CrmSchedulers;
}

interface CrmSchedulers {
  usageSync: SchedulerController<unknown>;
  effectiveCustomerMaintenance: SchedulerController<unknown>;
  enterpriseMonthlySettlement: SchedulerController<unknown>;
}

interface NormalizedCrmError {
  statusCode: number;
  errorCode: string;
  internalDetails?: unknown;
}

const databaseNotReadyErrorCodes = new Set([
  "ER_NO_SUCH_TABLE",
  "ER_BAD_DB_ERROR",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "PROTOCOL_CONNECTION_LOST"
]);

function getHeader(req: http.IncomingMessage, name: string): string {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function getHttpStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (!Number.isInteger(statusCode) || Number(statusCode) < 400 || Number(statusCode) > 599) return null;
  return Number(statusCode);
}

function normalizeCrmError(error: unknown): NormalizedCrmError {
  const errorCode = getErrorCode(error);
  if (databaseNotReadyErrorCodes.has(errorCode)) {
    return {
      statusCode: 503,
      errorCode: "crm_database_not_ready",
      internalDetails: error instanceof Error ? error.message : error
    };
  }

  const statusCode = getHttpStatusCode(error);
  if (statusCode) {
    return {
      statusCode,
      errorCode: errorCode || "internal_error",
      internalDetails: error instanceof Error ? error.message : error
    };
  }

  return {
    statusCode: 500,
    errorCode: "internal_error",
    internalDetails: error instanceof Error ? error.message : error
  };
}

const crmEmbedHeaderNames = {
  userId: "x-crm-embed-user-id",
  username: "x-crm-embed-username-b64",
  displayName: "x-crm-embed-display-name-b64",
  email: "x-crm-embed-email-b64",
  role: "x-crm-embed-role",
  inviterId: "x-crm-embed-inviter-id",
  timestamp: "x-crm-embed-timestamp",
  nonce: "x-crm-embed-nonce",
  signature: "x-crm-embed-signature"
} as const;

const crmEmbedAuthMaxSkewMs = 5 * 60 * 1000;
const newApiRootRole = 100;

interface EmbeddedNewApiUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: number;
  inviterId: number;
}

function hasCrmEmbedAuthHeaders(req: http.IncomingMessage): boolean {
  return Boolean(
    getHeader(req, crmEmbedHeaderNames.userId) ||
    getHeader(req, crmEmbedHeaderNames.signature)
  );
}

function decodeBase64UrlHeader(value: string): string {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function parseNonNegativeInteger(value: string, fallback = 0): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildCrmEmbedSignaturePayload({
  req,
  url,
  userId,
  username,
  displayName,
  email,
  role,
  inviterId,
  timestamp,
  nonce
}: {
  req: http.IncomingMessage;
  url: URL;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  inviterId: string;
  timestamp: string;
  nonce: string;
}): string {
  return [
    req.method || "",
    url.pathname,
    timestamp,
    nonce,
    userId,
    username,
    displayName,
    email,
    role,
    inviterId
  ].join("\n");
}

function signCrmEmbedPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseEmbeddedNewApiUser(
  req: http.IncomingMessage,
  config: CrmConfig,
  url: URL
): EmbeddedNewApiUser | null {
  if (!hasCrmEmbedAuthHeaders(req)) return null;
  if (!config.crmEmbedTrustSecret) {
    throw httpError("CRM embedded auth is not configured", 503, "crm_embedded_auth_not_configured");
  }

  const userId = getHeader(req, crmEmbedHeaderNames.userId).trim();
  const username = getHeader(req, crmEmbedHeaderNames.username).trim();
  const displayName = getHeader(req, crmEmbedHeaderNames.displayName).trim();
  const email = getHeader(req, crmEmbedHeaderNames.email).trim();
  const role = getHeader(req, crmEmbedHeaderNames.role).trim();
  const inviterId = getHeader(req, crmEmbedHeaderNames.inviterId).trim();
  const timestamp = getHeader(req, crmEmbedHeaderNames.timestamp).trim();
  const nonce = getHeader(req, crmEmbedHeaderNames.nonce).trim();
  const signature = getHeader(req, crmEmbedHeaderNames.signature).trim();

  if (!userId || !role || !timestamp || !nonce || !signature) {
    throw httpError("CRM embedded auth headers are incomplete", 401, "crm_embedded_auth_invalid");
  }

  const signedPayload = buildCrmEmbedSignaturePayload({
    req,
    url,
    userId,
    username,
    displayName,
    email,
    role,
    inviterId,
    timestamp,
    nonce
  });
  const expectedSignature = signCrmEmbedPayload(signedPayload, config.crmEmbedTrustSecret);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw httpError("CRM embedded auth signature is invalid", 401, "crm_embedded_auth_invalid");
  }

  const timestampMs = parseNonNegativeInteger(timestamp, Number.NaN);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > crmEmbedAuthMaxSkewMs) {
    throw httpError("CRM embedded auth timestamp is invalid", 401, "crm_embedded_auth_invalid");
  }

  const parsedUserId = parseNonNegativeInteger(userId, Number.NaN);
  const parsedRole = parseNonNegativeInteger(role, Number.NaN);
  const parsedInviterId = parseNonNegativeInteger(inviterId, 0);
  if (!parsedUserId || !Number.isFinite(parsedRole) || !Number.isFinite(parsedInviterId)) {
    throw httpError("CRM embedded auth identity is invalid", 401, "crm_embedded_auth_invalid");
  }

  return {
    id: parsedUserId,
    username: decodeBase64UrlHeader(username),
    displayName: decodeBase64UrlHeader(displayName),
    email: decodeBase64UrlHeader(email),
    role: parsedRole,
    inviterId: parsedInviterId
  };
}

function sanitizeEmbeddedUsername(value: string, fallbackId: number): string {
  const fallback = `newapi_${fallbackId}`;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (normalized || fallback).slice(0, 64);
}

async function buildUniqueEmbeddedUsername({
  repository,
  embeddedUser
}: {
  repository: Pick<CrmRepository, "getCrmUserByUsername">;
  embeddedUser: EmbeddedNewApiUser;
}): Promise<string> {
  const base = sanitizeEmbeddedUsername(embeddedUser.username || embeddedUser.displayName, embeddedUser.id);
  const existing = await repository.getCrmUserByUsername(base);
  if (!existing) return base;
  if (existing.newApiUserId === embeddedUser.id) return base;
  const suffix = `_na${embeddedUser.id}`;
  return `${base.slice(0, 64 - suffix.length)}${suffix}`;
}

async function bindEmbeddedInviterIfPossible({
  repository,
  crmUser,
  inviterNewApiUserId
}: {
  repository: CrmRepository;
  crmUser: CrmUserContext;
  inviterNewApiUserId: number;
}): Promise<void> {
  if (!inviterNewApiUserId || inviterNewApiUserId === crmUser.newApiUserId) return;
  const inviterCrmUser = await repository.getCrmUserByNewApiUserId(inviterNewApiUserId);
  if (!inviterCrmUser || inviterCrmUser.id === crmUser.crmUserId) return;
  const existingRelationship = await repository.getAgentRelationshipByCustomer(crmUser.crmUserId);
  if (existingRelationship) return;
  await ensureAgent({
    repository,
    crmUserId: inviterCrmUser.id,
    operatorCrmUserId: crmUser.crmUserId,
    reason: "确保 new-api 邀请人成为代理"
  });
  await bindCustomerAgent({
    repository,
    input: {
      customerCrmUserId: crmUser.crmUserId,
      agentCrmUserId: inviterCrmUser.id,
      operatorCrmUserId: crmUser.crmUserId,
      bindSource: agentRelationshipBindSources.inviteCode,
      reason: "new-api 注册邀请关系同步"
    }
  });
}

async function findOrCreateEmbeddedCrmUser({
  embeddedUser,
  repository
}: {
  embeddedUser: EmbeddedNewApiUser;
  repository: CrmRepository;
}): Promise<NonNullable<Awaited<ReturnType<CrmRepository["getCrmUserById"]>>>> {
  const existing = await repository.getCrmUserByNewApiUserId(embeddedUser.id);
  if (existing) {
    const username = await buildUniqueEmbeddedUsername({ repository, embeddedUser });
    return repository.updateCrmUserIdentity(existing.id, {
      username,
      email: embeddedUser.email,
      newApiRole: embeddedUser.role
    });
  }

  const inviterCrmUser = embeddedUser.inviterId
    ? await repository.getCrmUserByNewApiUserId(embeddedUser.inviterId)
    : null;
  const username = await buildUniqueEmbeddedUsername({ repository, embeddedUser });
  return repository.createCrmUser({
    username,
    email: embeddedUser.email,
    newApiUserId: embeddedUser.id,
    newApiRole: embeddedUser.role,
    firstTopupDiscountRate: inviterCrmUser ? inviteFirstTopupDiscountRate : null,
    signupTrialGrantStatus: signupTrialGrantStatuses.granted
  });
}

async function resolveEmbeddedCrmUser(
  req: http.IncomingMessage,
  config: CrmConfig,
  repository: CrmRepository,
  newApiClient: NewApiClient,
  url: URL
): Promise<CrmUserContext | null> {
  const embeddedUser = parseEmbeddedNewApiUser(req, config, url);
  if (!embeddedUser) return null;

  let crmUser = await findOrCreateEmbeddedCrmUser({ embeddedUser, repository });
  if (!crmUser.newApiUserId) {
    throw httpError("CRM user auth is required", 401, "crm_user_required");
  }
  const newApiUserId = crmUser.newApiUserId;
  if (crmUser.signupTrialGrantStatus === signupTrialGrantStatuses.pending) {
    crmUser = await repository.markSignupTrialGrantStatus(crmUser.id, signupTrialGrantStatuses.granted);
  }
  const context: CrmUserContext = {
    crmUserId: crmUser.id,
    newApiUserId,
    isSuperAdmin: embeddedUser.role >= newApiRootRole
  };
  if (!context.isSuperAdmin) {
    await bindEmbeddedInviterIfPossible({
      repository,
      crmUser: context,
      inviterNewApiUserId: embeddedUser.inviterId
    });
  }
  return context;
}

async function requireCrmAdmin(
  req: http.IncomingMessage,
  config: CrmConfig,
  repository: CrmRepository,
  newApiClient: NewApiClient
): Promise<{ operatorCrmUserId: number }> {
  const context = await requireCrmUser(req, config, repository, newApiClient);
  if (!context.isSuperAdmin) {
    throw httpError("CRM super admin is not allowed", 403, "crm_super_admin_forbidden");
  }
  return { operatorCrmUserId: context.crmUserId };
}

async function requireCrmUser(
  req: http.IncomingMessage,
  config: CrmConfig,
  repository: CrmRepository,
  newApiClient: NewApiClient
): Promise<CrmUserContext> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const embeddedContext = await resolveEmbeddedCrmUser(req, config, repository, newApiClient, url);
  if (embeddedContext) return embeddedContext;

  throw httpError("CRM user auth is required", 401, "crm_user_required");
}

async function route(deps: CrmServerDependencies, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { config, repository, newApiClient } = deps;

  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    ok(res, {
      ...createServiceStatus("crm-api"),
      schedulers: snapshotSchedulers(deps.schedulers as CrmSchedulers)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/modules") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, { modules: crmModules });
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/session/self") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await getSessionRoute({ context, repository }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/attachments") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await uploadAttachmentRoute({ req, config, context, repository }));
    return;
  }

  const attachmentParams = matchPath(url.pathname, "/crm/attachments/:fileName");
  if (req.method === "GET" && attachmentParams) {
    await requireCrmUser(req, config, repository, newApiClient);
    await writeAttachmentResponse({ res, config, fileName: attachmentParams.fileName });
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/dashboard") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await getAgentDashboardRoute({ context, repository }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/customers") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await listAgentCustomersRoute({ context, repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/sub-agents") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await listAgentSubAgentsRoute({ context, repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/commissions") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await listAgentCommissionsRoute({ context, repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/withdrawals") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await listAgentWithdrawalsRoute({ context, repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/offline-recharge-requests") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await listAgentOfflineRechargeRequestsRoute({ context, repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/agent/offline-recharge-settings") {
    await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await getAgentOfflineRechargeSettingsRoute({ repository }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/agent/offline-recharge-requests") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    ok(res, await createAgentOfflineRechargeRequestRoute({ req, context, repository }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/agent/withdrawals") {
    const context = await requireCrmUser(req, config, repository, newApiClient);
    const body = await readJsonBody(req);
    ok(res, await createAgentWithdrawalRoute({ context, repository, body }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/dashboard/summary") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await getDashboardSummary({ repository }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/users") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listUsers({ url, repository }));
    return;
  }

  const userParams = matchPath(url.pathname, "/crm/admin/users/:crmUserId");
  if (req.method === "GET" && userParams) {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await getUser({
      crmUserId: parsePositiveInteger(userParams.crmUserId, "crmUserId"),
      repository
    }));
    return;
  }

  const profileParams = matchPath(url.pathname, "/crm/admin/users/:crmUserId/profile");
  if (req.method === "PATCH" && profileParams) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    const body = await readJsonBody(req);
    ok(res, await updateUserProfile({
      crmUserId: parsePositiveInteger(profileParams.crmUserId, "crmUserId"),
      patch: body,
      operatorCrmUserId: admin.operatorCrmUserId,
      repository
    }));
    return;
  }

  const signupTrialRetryParams = matchPath(url.pathname, "/crm/admin/users/:crmUserId/signup-trial/retry");
  if (req.method === "POST" && signupTrialRetryParams) {
    await requireCrmAdmin(req, config, repository, newApiClient);
    const crmUserId = parsePositiveInteger(signupTrialRetryParams.crmUserId, "crmUserId");
    const crmUser = await repository.getCrmUserById(crmUserId);
    if (!crmUser) {
      throw httpError("CRM user was not found", 404, "crm_user_not_found");
    }
    if (!crmUser.newApiUserId) {
      throw httpError("CRM new-api user is not linked", 409, "crm_new_api_user_unlinked");
    }
    if (crmUser.signupTrialGrantStatus === signupTrialGrantStatuses.pending) {
      await repository.markSignupTrialGrantStatus(crmUser.id, signupTrialGrantStatuses.granted);
    }
    ok(res, await getUser({
      crmUserId,
      repository
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/agent-relationships") {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await bindCustomerAgentRoute({ req, repository, operatorCrmUserId: admin.operatorCrmUserId }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/account-events") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listAccountEventsRoute({ repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/offline-recharge-requests") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listAdminOfflineRechargeRequestsRoute({ repository, url }));
    return;
  }

  const offlineRechargeAction = matchOfflineRechargeAction(url.pathname);
  if (req.method === "POST" && offlineRechargeAction) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await updateOfflineRechargeRequestRoute({
      req,
      repository,
      newApiClient,
      config,
      requestId: offlineRechargeAction.requestId,
      action: offlineRechargeAction.action,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/account-events") {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await createAccountEventRoute({
      req,
      repository,
      newApiClient,
      config,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  const accountEventReconcileParams = matchPath(url.pathname, "/crm/admin/account-events/:accountEventId/reconcile");
  if (req.method === "POST" && accountEventReconcileParams) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await reconcileAccountEventRoute({
      req,
      repository,
      accountEventId: accountEventReconcileParams.accountEventId,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  const accountEventRefundParams = matchPath(url.pathname, "/crm/admin/account-events/:accountEventId/refund");
  if (req.method === "POST" && accountEventRefundParams) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await refundAccountEventRoute({
      req,
      repository,
      newApiClient,
      accountEventId: accountEventRefundParams.accountEventId,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/ledger") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listLedger({ repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/agents") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listAgentsRoute({ repository, url }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/agents") {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await createAgentRoute({ req, repository, operatorCrmUserId: admin.operatorCrmUserId }));
    return;
  }

  const agentParams = matchPath(url.pathname, "/crm/admin/agents/:agentId");
  if (req.method === "PATCH" && agentParams) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await updateAgentRoute({
      req,
      params: agentParams,
      repository,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/commissions") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listCommissionsRoute({ repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/effective-customers") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listEffectiveCustomersRoute({ repository, url }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/effective-customers/evaluate") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await evaluateEffectiveCustomerRoute({ req, repository }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/effective-customers/sync-consumption") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await syncEffectiveCustomerConsumptionRoute({
      req,
      repository,
      newApiClient,
      quotaPerRmb: config.quotaPerRmb
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/effective-customers/maintenance") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await runEffectiveCustomerMaintenanceRoute({
      req,
      repository,
      newApiClient,
      quotaPerRmb: config.quotaPerRmb
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/enterprise/monthly-settlements") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listEnterpriseMonthlySettlementsRoute({ repository, url }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/enterprise/monthly-settlements/generate") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await generateEnterpriseMonthlySettlementsRoute({
      req,
      repository,
      newApiClient,
      config
    }));
    return;
  }

  const enterpriseMonthlySettlementAction = matchEnterpriseMonthlySettlementAction(url.pathname);
  if (req.method === "POST" && enterpriseMonthlySettlementAction) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await updateEnterpriseMonthlySettlementRoute({
      req,
      repository,
      settlementId: enterpriseMonthlySettlementAction.settlementId,
      status: enterpriseMonthlySettlementAction.status,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  const commissionAction = matchCommissionAction(url.pathname);
  if (req.method === "POST" && commissionAction) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    const body = await readJsonBody(req);
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : commissionAction.status;
    ok(res, await updateCommissionStatusRoute({
      repository,
      commissionId: commissionAction.commissionId,
      status: commissionAction.status,
      operatorCrmUserId: admin.operatorCrmUserId,
      reason
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/withdrawals") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listWithdrawalsRoute({ repository, url }));
    return;
  }

  const withdrawalAction = matchWithdrawalAction(url.pathname);
  if (req.method === "POST" && withdrawalAction) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await updateWithdrawalRoute({
      req,
      repository,
      withdrawalId: withdrawalAction.withdrawalId,
      status: withdrawalAction.status,
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/risk-cases") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listRiskCasesRoute({ repository, url }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/crm/admin/risk-cases") {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await createRiskCaseRoute({ req, repository, operatorCrmUserId: admin.operatorCrmUserId }));
    return;
  }

  const riskCaseParams = matchPath(url.pathname, "/crm/admin/risk-cases/:riskCaseId");
  if (req.method === "PATCH" && riskCaseParams) {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await updateRiskCaseRoute({
      req,
      repository,
      riskCaseId: parseRiskCaseId(riskCaseParams.riskCaseId),
      operatorCrmUserId: admin.operatorCrmUserId
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/audit-logs") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await listAuditLogsRoute({ repository, url }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/crm/admin/settings") {
    await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await getSettingsRoute({ repository }));
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/crm/admin/settings") {
    const admin = await requireCrmAdmin(req, config, repository, newApiClient);
    ok(res, await updateSettingsRoute({ req, repository, operatorCrmUserId: admin.operatorCrmUserId }));
    return;
  }

  fail(res, 404, "not_found");
}

export function createCrmHandler(deps: CrmServerDependencies): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const normalizedDependencies = {
    ...deps,
    schedulers: deps.schedulers || createCrmSchedulers(deps)
  };
  const { config } = normalizedDependencies;
  return function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
    bindCorsOrigin(res, getHeader(req, "origin"), config.corsAllowedOrigins);
    const forwardedFor = getHeader(req, "x-forwarded-for").split(",")[0]?.trim();
    const requestIp = forwardedFor || getHeader(req, "x-real-ip").trim() || req.socket?.remoteAddress || "";
    const userAgent = getHeader(req, "user-agent").trim();
    runWithCrmRequestContext({ requestIp, userAgent }, () => {
      route(normalizedDependencies, req, res).catch((error) => {
        const crmError = normalizeCrmError(error);
        fail(res, crmError.statusCode, crmError.errorCode, crmError.internalDetails);
      });
    });
  };
}

function isMainModule(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

function createCrmSchedulers({
  config,
  repository,
  newApiClient
}: {
  config: CrmConfig;
  repository: CrmRepository;
  newApiClient: NewApiClient;
}): CrmSchedulers {
  return {
    usageSync: createSchedulerController({
      name: "usage-sync",
      intervalMinutes: config.usageSyncMaintenanceIntervalMinutes,
      async run() {
        const result = await runUsageSyncMaintenance({
          repository,
          newApiClient,
          quotaPerRmb: config.quotaPerRmb
        });
        console.log("CRM usage sync maintenance completed", result);
        return result;
      }
    }),
    effectiveCustomerMaintenance: createSchedulerController({
      name: "effective-customer-maintenance",
      intervalMinutes: config.effectiveCustomerMaintenanceIntervalMinutes,
      async run() {
      const result = await runEffectiveCustomerMaintenance({
        repository,
        newApiClient,
        quotaPerRmb: config.quotaPerRmb
      });
      console.log("CRM effective customer maintenance completed", result);
        return result;
      }
    }),
    enterpriseMonthlySettlement: createSchedulerController({
      name: "enterprise-monthly-settlement",
      intervalMinutes: config.enterpriseMonthlySettlementIntervalMinutes,
      async run() {
        const result = await generateEnterpriseMonthlySettlements({
        repository,
        newApiClient,
        quotaPerRmb: config.quotaPerRmb
      });
      console.log("CRM enterprise monthly settlements completed", result);
        return result;
      }
    })
  };
}

function snapshotSchedulers(schedulers: CrmSchedulers): CrmSchedulersHealthDto {
  return {
    usageSync: schedulers.usageSync.snapshot(),
    effectiveCustomerMaintenance: schedulers.effectiveCustomerMaintenance.snapshot(),
    enterpriseMonthlySettlement: schedulers.enterpriseMonthlySettlement.snapshot()
  };
}

export function startCrmServer(env: NodeJS.ProcessEnv = process.env): http.Server {
  const config = parseCrmConfig(env);
  const repository = createRepository(config);
  const newApiClient = createNewApiClient(config);
  const schedulers = createCrmSchedulers({ config, repository, newApiClient });
  const server = http.createServer(createCrmHandler({ config, repository, newApiClient, schedulers }));
  for (const scheduler of Object.values(schedulers)) scheduler.start();
  server.once("close", () => {
    for (const scheduler of Object.values(schedulers)) scheduler.stop();
  });

  server.listen(config.port, config.host, () => {
    console.log(`CRM API listening on http://${config.host}:${config.port}`);
  });
  return server;
}

if (isMainModule()) {
  startCrmServer();
}
