import { serviceError } from "./errors.mjs";
import { withImmediateTransaction } from "./database.mjs";
import {
  activationCodeHint,
  createActivationCode,
  createLicenseToken,
  normalizeActivationCode,
  secretDigest
} from "./secrets.mjs";

const STATUS_ENABLED = 1;
const STATUS_DISABLED = 2;
const PLAN_PRO = "pro";

function boundedInteger(value, fallback, minimum, maximum, message) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw serviceError(400, "invalid_license_request", message);
  return number;
}

function cleanDeviceId(value) {
  const deviceId = String(value || "").trim();
  if (deviceId.length < 16 || deviceId.length > 128) throw serviceError(400, "invalid_device_id", "设备 ID 无效。");
  return deviceId;
}

function cleanPlan(value) {
  const plan = String(value || PLAN_PRO).trim().toLowerCase();
  if (plan !== PLAN_PRO) throw serviceError(400, "invalid_license_plan", "当前扩展服务只支持 Pro License。");
  return plan;
}

export class LicenseService {
  constructor({ database, hashSecret, now = () => Math.floor(Date.now() / 1000) }) {
    this.database = database;
    this.hashSecret = hashSecret;
    this.now = now;
  }

  config() {
    return {
      required: false,
      verification_ttl_seconds: 24 * 60 * 60,
      offline_grace_seconds: 72 * 60 * 60,
      supports_account_mode: true,
      supports_custom_api_mode: true,
      account_login_required: true,
      account_license_required: false,
      custom_api_license_required: true,
      custom_api_required_plan: PLAN_PRO,
      default_max_activations: 3
    };
  }

  createCodes(input = {}) {
    const name = String(input.name || "").trim().slice(0, 80);
    if (!name) throw serviceError(400, "invalid_license_request", "请输入兑换码批次名称。");
    const count = boundedInteger(input.count, 1, 1, 100, "单次只能创建 1 到 100 个兑换码。");
    const plan = cleanPlan(input.plan);
    const validDays = boundedInteger(input.valid_days, 0, 0, 3650, "授权有效天数必须在 0 到 3650 之间。");
    const maxActivations = boundedInteger(input.max_activations, 3, 1, 100, "最大设备数量必须在 1 到 100 之间。");
    const expiredTime = boundedInteger(input.expired_time, 0, 0, 4_102_444_800, "兑换截止时间无效。");
    const now = this.now();
    if (expiredTime > 0 && expiredTime <= now) throw serviceError(400, "activation_code_expired", "兑换截止时间必须晚于当前时间。");

    return withImmediateTransaction(this.database, () => {
      const insert = this.database.prepare(`
        INSERT INTO activation_codes
          (name, code_hash, code_hint, plan, valid_days, max_activations, activation_count, status, expired_time, created_time)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `);
      const codes = [];
      while (codes.length < count) {
        const code = createActivationCode();
        const codeHash = secretDigest(this.hashSecret, "activation-code", normalizeActivationCode(code));
        try {
          insert.run(name, codeHash, activationCodeHint(code), plan, validDays, maxActivations, STATUS_ENABLED, expiredTime, now);
          codes.push(code);
        } catch (error) {
          if (!String(error?.message || "").includes("UNIQUE")) throw error;
        }
      }
      return { codes, count: codes.length };
    });
  }

  listCodes({ page = 1, size = 20 } = {}) {
    const cleanPage = boundedInteger(page, 1, 1, 1_000_000, "页码无效。");
    const cleanSize = boundedInteger(size, 20, 1, 100, "每页数量必须在 1 到 100 之间。");
    const summaryRow = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS enabled,
        SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS disabled,
        SUM(activation_count) AS activation_count,
        SUM(max_activations) AS activation_capacity
      FROM activation_codes
    `).get(STATUS_ENABLED, STATUS_DISABLED);
    const summary = {
      total: Number(summaryRow.total || 0),
      enabled: Number(summaryRow.enabled || 0),
      disabled: Number(summaryRow.disabled || 0),
      activation_count: Number(summaryRow.activation_count || 0),
      activation_capacity: Number(summaryRow.activation_capacity || 0)
    };
    const items = this.database.prepare(`
      SELECT id, name, code_hint, plan, valid_days, max_activations, activation_count, status, expired_time, created_time
      FROM activation_codes ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(cleanSize, (cleanPage - 1) * cleanSize);
    return { items, total: summary.total, page: cleanPage, size: cleanSize, summary };
  }

  disableCode(id) {
    const codeId = boundedInteger(id, 0, 1, Number.MAX_SAFE_INTEGER, "兑换码 ID 无效。");
    return withImmediateTransaction(this.database, () => {
      const updated = this.database.prepare("UPDATE activation_codes SET status = ? WHERE id = ?").run(STATUS_DISABLED, codeId);
      if (updated.changes !== 1) throw serviceError(404, "activation_code_not_found", "兑换码不存在。");
      this.database.prepare("UPDATE activation_grants SET status = ? WHERE code_id = ?").run(STATUS_DISABLED, codeId);
      return { disabled: true, id: codeId };
    });
  }

  activate({ code, device_id: deviceIdValue } = {}) {
    const normalizedCode = normalizeActivationCode(code);
    if (normalizedCode.length < 12 || normalizedCode.length > 128) throw serviceError(400, "activation_code_invalid", "兑换码无效。");
    const deviceId = cleanDeviceId(deviceIdValue);
    const now = this.now();
    const codeHash = secretDigest(this.hashSecret, "activation-code", normalizedCode);
    const deviceHash = secretDigest(this.hashSecret, "license-device", deviceId);

    return withImmediateTransaction(this.database, () => {
      const activationCode = this.database.prepare("SELECT * FROM activation_codes WHERE code_hash = ?").get(codeHash);
      if (!activationCode || activationCode.status !== STATUS_ENABLED) throw serviceError(400, "activation_code_invalid", "兑换码无效或已禁用。");
      if (activationCode.expired_time > 0 && activationCode.expired_time <= now) throw serviceError(400, "activation_code_expired", "兑换码已超过兑换截止时间。");
      if (activationCode.plan !== PLAN_PRO) throw serviceError(403, "license_plan_invalid", "该兑换码不是 Pro 授权。");

      const existing = this.database.prepare(`
        SELECT * FROM activation_grants
        WHERE code_id = ? AND device_hash = ? AND status = ?
      `).get(activationCode.id, deviceHash, STATUS_ENABLED);
      const token = createLicenseToken();
      const tokenHash = secretDigest(this.hashSecret, "license-token", token);
      if (existing) {
        if (existing.expires_at > 0 && existing.expires_at <= now) throw serviceError(400, "license_expired", "当前设备授权已过期。");
        this.database.prepare(`
          UPDATE activation_grants SET token_hash = ?, last_verified_time = ? WHERE id = ?
        `).run(tokenHash, now, existing.id);
        return { token, plan: existing.plan, expires_at: existing.expires_at };
      }

      if (activationCode.activation_count >= activationCode.max_activations) {
        throw serviceError(400, "activation_limit_reached", "兑换码已达到最大设备数量。");
      }
      const expiresAt = activationCode.valid_days > 0 ? now + activationCode.valid_days * 24 * 60 * 60 : 0;
      this.database.prepare(`
        INSERT INTO activation_grants
          (code_id, device_hash, token_hash, plan, status, activated_time, last_verified_time, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(activationCode.id, deviceHash, tokenHash, activationCode.plan, STATUS_ENABLED, now, now, expiresAt);
      const updated = this.database.prepare(`
        UPDATE activation_codes SET activation_count = activation_count + 1
        WHERE id = ? AND activation_count < max_activations
      `).run(activationCode.id);
      if (updated.changes !== 1) throw serviceError(400, "activation_limit_reached", "兑换码已达到最大设备数量。");
      return { token, plan: activationCode.plan, expires_at: expiresAt };
    });
  }

  verify({ token, device_id: deviceIdValue } = {}) {
    const cleanToken = String(token || "").trim();
    if (cleanToken.length < 32 || cleanToken.length > 256) throw serviceError(400, "license_invalid", "License 无效。");
    const deviceId = cleanDeviceId(deviceIdValue);
    const now = this.now();
    const tokenHash = secretDigest(this.hashSecret, "license-token", cleanToken);
    const deviceHash = secretDigest(this.hashSecret, "license-device", deviceId);
    const grant = this.database.prepare(`
      SELECT g.* FROM activation_grants g
      JOIN activation_codes c ON c.id = g.code_id
      WHERE g.token_hash = ? AND g.device_hash = ? AND g.status = ? AND c.status = ?
    `).get(tokenHash, deviceHash, STATUS_ENABLED, STATUS_ENABLED);
    if (!grant) throw serviceError(400, "license_invalid", "License 无效、已撤销或不属于当前设备。");
    if (grant.plan !== PLAN_PRO) throw serviceError(403, "license_plan_invalid", "当前 License 不是 Pro 授权。");
    if (grant.expires_at > 0 && grant.expires_at <= now) throw serviceError(400, "license_expired", "License 已过期。");
    let verifiedAt = grant.last_verified_time;
    if (now - verifiedAt >= 5 * 60) {
      this.database.prepare("UPDATE activation_grants SET last_verified_time = ? WHERE id = ?").run(now, grant.id);
      verifiedAt = now;
    }
    return { active: true, plan: grant.plan, expires_at: grant.expires_at, verified_at: verifiedAt };
  }
}
