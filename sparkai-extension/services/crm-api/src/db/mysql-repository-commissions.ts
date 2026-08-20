import type { ResultSetHeader } from "mysql2/promise";
import { commissionStatuses } from "@ai-native/crm-contracts";
import type {
  EffectiveCustomerDto,
  EffectiveCustomerSaveInput
} from "../types.js";
import { httpError } from "../http.js";
import {
  mapCommission,
  mapEffectiveCustomer,
  numberValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createCommissionRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async getEffectiveCustomerByAgentAndCustomer(agentId, customerCrmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_effective_customers WHERE agent_id = ? AND customer_crm_user_id = ? LIMIT 1",
        [agentId, customerCrmUserId]
      );
      return mapEffectiveCustomer(rows[0]);
    },

    async saveEffectiveCustomer(input: EffectiveCustomerSaveInput) {
      await executor.query(
        `INSERT INTO crm_effective_customers
          (agent_id, customer_crm_user_id, first_paid_event_id, first_paid_amount_rmb, first_paid_at,
           seven_day_checked_at, paid_balance_consumed_rate, is_refunded, is_related_account, is_risk,
           is_effective, counted_for_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          first_paid_event_id = VALUES(first_paid_event_id),
          first_paid_amount_rmb = VALUES(first_paid_amount_rmb),
          first_paid_at = VALUES(first_paid_at),
          seven_day_checked_at = VALUES(seven_day_checked_at),
          paid_balance_consumed_rate = VALUES(paid_balance_consumed_rate),
          is_refunded = VALUES(is_refunded),
          is_related_account = VALUES(is_related_account),
          is_risk = VALUES(is_risk),
          is_effective = VALUES(is_effective),
          counted_for_level = VALUES(counted_for_level)`,
        [
          input.agentId,
          input.customerCrmUserId,
          input.firstPaidEventId,
          input.firstPaidAmountRmb,
          input.firstPaidAt,
          input.sevenDayCheckedAt,
          input.paidBalanceConsumedRate,
          input.isRefunded ? 1 : 0,
          input.isRelatedAccount ? 1 : 0,
          input.isRisk ? 1 : 0,
          input.isEffective ? 1 : 0,
          input.countedForLevel ? 1 : 0
        ]
      );
      const saved = await this.getEffectiveCustomerByAgentAndCustomer(input.agentId, input.customerCrmUserId);
      if (!saved) throw new Error("effective customer record not found after save");
      return saved;
    },

    async listEffectiveCustomers({ page = 1, pageSize = 20, agentId, customerCrmUserId, isEffective, countedForLevel } = {}) {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (agentId) {
        whereParts.push("effective.agent_id = ?");
        params.push(agentId);
      }
      if (customerCrmUserId) {
        whereParts.push("effective.customer_crm_user_id = ?");
        params.push(customerCrmUserId);
      }
      if (isEffective !== undefined) {
        whereParts.push("effective.is_effective = ?");
        params.push(isEffective ? 1 : 0);
      }
      if (countedForLevel !== undefined) {
        whereParts.push("effective.counted_for_level = ?");
        params.push(countedForLevel ? 1 : 0);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const from = `
        FROM crm_effective_customers effective
        JOIN crm_agents agent ON agent.id = effective.agent_id
        LEFT JOIN crm_users agent_user ON agent_user.id = agent.crm_user_id
        LEFT JOIN crm_users customer_user ON customer_user.id = effective.customer_crm_user_id
      `;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          effective.*,
          agent.crm_user_id AS agent_crm_user_id,
          agent_user.username AS agent_username,
          customer_user.username AS customer_username,
          customer_user.email AS customer_email
         ${from}
         ${where}
         ORDER BY effective.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map((row) => mapEffectiveCustomer(row)).filter((row): row is EffectiveCustomerDto => Boolean(row)),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async countEffectiveCustomers(agentId, options = {}) {
      const clauses = ["agent_id = ?", "counted_for_level = 1"];
      const params: unknown[] = [agentId];
      if (options.firstPaidAtFrom) {
        clauses.push("first_paid_at >= ?");
        params.push(options.firstPaidAtFrom);
      }
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_effective_customers WHERE ${clauses.join(" AND ")}`,
        params
      );
      return numberValue(rows[0]?.total);
    },

    async getCommissionSummary(beneficiaryCrmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'frozen' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS frozen_commission_rmb,
          COALESCE(SUM(CASE WHEN status = 'releasable' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS releasable_commission_rmb,
          COALESCE(SUM(released_amount_rmb), 0) AS released_commission_rmb
         FROM crm_commissions
         WHERE beneficiary_crm_user_id = ?`,
        [beneficiaryCrmUserId]
      );
      return {
        frozenCommissionRmb: numberValue(rows[0]?.frozen_commission_rmb),
        releasableCommissionRmb: numberValue(rows[0]?.releasable_commission_rmb),
        releasedCommissionRmb: numberValue(rows[0]?.released_commission_rmb)
      };
    },

    async listCommissions({ beneficiaryCrmUserId, status, sourceType, sourceId, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (beneficiaryCrmUserId) {
        clauses.push("commission.beneficiary_crm_user_id = ?");
        params.push(beneficiaryCrmUserId);
      }
      if (status) {
        clauses.push("commission.status = ?");
        params.push(status);
      }
      if (sourceType) {
        clauses.push("commission.source_type = ?");
        params.push(sourceType);
      }
      if (sourceId) {
        clauses.push("commission.source_id = ?");
        params.push(sourceId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_commissions commission
        LEFT JOIN crm_users beneficiary ON beneficiary.id = commission.beneficiary_crm_user_id
        LEFT JOIN crm_users customer ON customer.id = commission.customer_crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          commission.*,
          beneficiary.username AS beneficiary_username,
          customer.username AS customer_username
         ${from}
         ${where}
         ORDER BY commission.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapCommission),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async insertCommissionRecords(rows) {
      if (!rows.length) return [];
      const values = rows.map((row) => [
        row.sourceType,
        row.sourceId,
        row.beneficiaryCrmUserId,
        row.customerCrmUserId,
        row.commissionType,
        row.orderKind,
        row.agentLevel,
        row.baseAmountRmb,
        row.rate,
        row.amountRmb
      ]);
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_commissions
          (source_type, source_id, beneficiary_crm_user_id, customer_crm_user_id, commission_type, order_kind,
           agent_level, base_amount_rmb, rate, commission_amount_rmb)
         VALUES ?`,
        [values]
      );
      return rows.map((row, index) => ({
        ...row,
        id: result.insertId ? result.insertId + index : undefined,
        status: "frozen",
        releasedAmountRmb: 0
      }));
    },

    async updateCommissionStatus(id, status, operatorCrmUserId, reason) {
      const [currentRows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_commissions WHERE id = ? LIMIT 1",
        [id]
      );
      if (!currentRows[0]) throw httpError("commission was not found", 404, "not_found");
      const current = mapCommission(currentRows[0]);
      const allowed = (
        (current.status === commissionStatuses.frozen && (
          status === commissionStatuses.releasable ||
          status === commissionStatuses.blocked ||
          status === commissionStatuses.clawedBack
        )) ||
        (current.status === commissionStatuses.releasable && (
          status === commissionStatuses.blocked ||
          status === commissionStatuses.clawedBack
        )) ||
        (current.status === commissionStatuses.blocked && status === commissionStatuses.clawedBack)
      );
      if (!allowed || (status === commissionStatuses.clawedBack && current.releasedAmountRmb > 0)) {
        throw httpError("commission status transition is invalid", 409, "commission_status_invalid");
      }
      const [updateResult] = await executor.query<ResultSetHeader>(
        `UPDATE crm_commissions
         SET status = ?
         WHERE id = ? AND status = ? AND released_amount_rmb = ?`,
        [status, id, current.status, current.releasedAmountRmb]
      );
      if (updateResult.affectedRows !== 1) {
        throw httpError("commission status transition is invalid", 409, "commission_status_invalid");
      }
      await this.insertAuditLog({
        operatorCrmUserId,
        targetType: "commission",
        targetId: id,
        action: `commission.${status}`,
        reason,
        before: current
      });
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          commission.*,
          beneficiary.username AS beneficiary_username,
          customer.username AS customer_username
         FROM crm_commissions commission
         LEFT JOIN crm_users beneficiary ON beneficiary.id = commission.beneficiary_crm_user_id
         LEFT JOIN crm_users customer ON customer.id = commission.customer_crm_user_id
         WHERE commission.id = ? LIMIT 1`,
        [id]
      );
      if (!rows[0]) throw new Error("commission not found");
      return mapCommission(rows[0]);
    },

  };
}
