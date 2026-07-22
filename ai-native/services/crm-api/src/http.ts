import type { IncomingMessage, ServerResponse } from "node:http";
import type { CrmApiErrorPayload } from "@ai-native/crm-contracts";
import type { CrmHttpError } from "./types.js";

const maxJsonBodyBytes = 1024 * 1024;
const corsOriginKey = Symbol("crmCorsOrigin");

interface JsonOptions {
  origin?: string;
  headers?: Record<string, string | string[]>;
}

type CorsResponse = ServerResponse & {
  [corsOriginKey]?: string | null;
};

export function httpError(message: string, statusCode: number, code: string): CrmHttpError {
  const error: CrmHttpError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const defaultErrorMessage = "系统暂时不可用，请稍后重试。";

const errorMessages: Record<string, string> = {
  request_body_too_large: "请求内容过大，请减少提交内容后重试。",
  invalid_json: "请求内容格式不正确。",
  invalid_request: "请求参数不正确。",
  not_found: "请求的资源不存在。",
  internal_error: defaultErrorMessage,
  crm_database_not_ready: "系统正在初始化，请先完成 CRM 数据库迁移后再登录。",
  crm_embedded_auth_not_configured: "嵌入登录服务未配置，请联系管理员。",
  crm_embedded_auth_invalid: "登录状态已失效，请重新登录。",
  crm_user_required: "请先登录后再继续操作。",
  crm_user_not_found: "用户不存在。",
  crm_super_admin_forbidden: "当前账号没有平台管理权限。",
  crm_agent_required: "当前账号没有代理权限。",
  crm_new_api_user_unlinked: "账号未完成服务映射，请联系管理员。",
  crm_signup_trial_grant_failed: "试用额度发放失败，请稍后重试或联系管理员。",
  commission_cap_exceeded: "佣金比例超过平台上限。",
  commission_release_risk_blocked: "该佣金存在风控阻断，暂时不能释放。",
  agent_not_found: "代理不存在。",
  effective_customer_not_found: "有效客户候选记录不存在。",
  withdrawal_min_amount: "提现金额低于最低提现门槛。",
  withdrawal_insufficient_balance: "可提现佣金余额不足。",
  withdrawal_risk_blocked: "该账号存在风控阻断，暂时无法提现。",
  withdrawal_status_invalid: "提现状态不允许执行该操作。",
  offline_recharge_not_found: "线下充值申请不存在。",
  offline_recharge_status_invalid: "线下充值申请当前状态不允许执行该操作。",
  enterprise_monthly_settlement_status_invalid: "大客户月结单当前状态不允许执行该操作。",
  invite_code_conflict: "邀请码已被其他代理使用。",
  agent_relationship_conflict: "该客户已有有效代理归属。",
  account_event_reconcile_required: "该入账事件需要人工对账后再处理。",
  account_event_status_invalid: "入账事件当前状态不允许执行该操作。",
  account_event_refund_not_allowed: "该入账事件不能登记退款。",
  account_event_already_refunded: "该入账事件已登记过退款。",
  idempotency_payload_mismatch: "重复请求的内容与首次提交不一致。",
  crm_attachment_invalid: "凭证文件格式不正确，请重新选择文件。",
  crm_attachment_too_large: "凭证文件过大，请压缩后重新上传。",
  crm_attachment_not_found: "凭证文件不存在。"
};

export function errorMessageForCode(errorCode: string): string {
  return errorMessages[errorCode] || defaultErrorMessage;
}

function resolveCorsOrigin(origin: string | undefined, allowedOrigins: string[]): string | null {
  const requestOrigin = String(origin || "").trim();
  if (!requestOrigin) return null;
  if (allowedOrigins.includes("*")) return requestOrigin;
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin"
  };
}

export function bindCorsOrigin(res: ServerResponse, origin: string | undefined, allowedOrigins: string[] = ["*"]): void {
  (res as CorsResponse)[corsOriginKey] = resolveCorsOrigin(origin, allowedOrigins);
}

export function corsHeadersForResponse(res: ServerResponse): Record<string, string> {
  const origin = (res as CorsResponse)[corsOriginKey] || "";
  return origin ? corsHeaders(origin) : {};
}

export function json(res: ServerResponse, statusCode: number, body: unknown, options: JsonOptions = {}): void {
  const origin = options.origin || (res as CorsResponse)[corsOriginKey] || "";
  const resolvedCorsHeaders = origin ? corsHeaders(origin) : {};
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...resolvedCorsHeaders,
    ...(options.headers || {})
  });
  res.end(JSON.stringify(body));
}

export function ok(res: ServerResponse, data: unknown, options: JsonOptions = {}): void {
  json(res, 200, { ok: true, data }, options);
}

export function fail(
  res: ServerResponse,
  statusCode: number,
  errorCode: string,
  _internalDetails: unknown = undefined,
  options: JsonOptions = {}
): void {
  const payload: CrmApiErrorPayload = {
    ok: false,
    error_code: errorCode,
    err_msg: errorMessageForCode(errorCode)
  };
  json(res, statusCode, payload, options);
}

export async function readRequestBody(req: IncomingMessage, maxBytes = maxJsonBodyBytes): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw httpError("request body is too large", 413, "request_body_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage, maxBytes = maxJsonBodyBytes): Promise<Record<string, unknown>> {
  const text = (await readRequestBody(req, maxBytes)).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError("request body must be valid JSON", 400, "invalid_json");
  }
}

export function parsePositiveInteger(value: unknown, name: string): number {
  if (!/^\d+$/.test(String(value || ""))) {
    throw httpError(`${name} must be a positive integer`, 400, "invalid_request");
  }
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
    throw httpError(`${name} must be a positive integer`, 400, "invalid_request");
  }
  return numberValue;
}

export function parseListLimit(value: unknown, defaultValue: number, maxValue: number): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw httpError("limit must be a positive integer", 400, "invalid_request");
  }
  return Math.min(parsed, maxValue);
}

export function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}
