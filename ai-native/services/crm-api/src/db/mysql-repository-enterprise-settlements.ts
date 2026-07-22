import type { ResultSetHeader } from "mysql2/promise";
import { enterpriseMonthlySettlementStatuses } from "@ai-native/crm-contracts";
import {
  mapEnterpriseMonthlySettlement,
  numberValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createEnterpriseSettlementRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async saveEnterpriseMonthlySettlement(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_enterprise_monthly_settlements
          (crm_user_id, period, usage_rmb, ledger_entry_count, notes)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          usage_rmb = IF(status = 'pending', VALUES(usage_rmb), usage_rmb),
          ledger_entry_count = IF(status = 'pending', VALUES(ledger_entry_count), ledger_entry_count),
          notes = IF(status = 'pending', VALUES(notes), notes)`,
        [
          input.crmUserId,
          input.period,
          input.usageRmb,
          input.ledgerEntryCount,
          input.notes || ""
        ]
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT settlement.*, crm_user.username AS crm_username
         FROM crm_enterprise_monthly_settlements settlement
         LEFT JOIN crm_users crm_user ON crm_user.id = settlement.crm_user_id
         WHERE settlement.crm_user_id = ? AND settlement.period = ? LIMIT 1`,
        [input.crmUserId, input.period]
      );
      const settlement = mapEnterpriseMonthlySettlement(rows[0]);
      const updated = settlement.status === enterpriseMonthlySettlementStatuses.pending &&
        settlement.usageRmb === input.usageRmb &&
        settlement.ledgerEntryCount === input.ledgerEntryCount;
      return {
        settlement,
        created: result.affectedRows === 1,
        updated: result.affectedRows > 1 && updated
      };
    },

    async getEnterpriseMonthlySettlementById(id) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT settlement.*, crm_user.username AS crm_username
         FROM crm_enterprise_monthly_settlements settlement
         LEFT JOIN crm_users crm_user ON crm_user.id = settlement.crm_user_id
         WHERE settlement.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? mapEnterpriseMonthlySettlement(rows[0]) : null;
    },

    async listEnterpriseMonthlySettlements({ period, status, crmUserId, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (period) {
        clauses.push("settlement.period = ?");
        params.push(period);
      }
      if (status) {
        clauses.push("settlement.status = ?");
        params.push(status);
      }
      if (crmUserId) {
        clauses.push("settlement.crm_user_id = ?");
        params.push(crmUserId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_enterprise_monthly_settlements settlement
        LEFT JOIN crm_users crm_user ON crm_user.id = settlement.crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT settlement.*, crm_user.username AS crm_username
         ${from}
         ${where}
         ORDER BY settlement.period DESC, settlement.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapEnterpriseMonthlySettlement),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async updateEnterpriseMonthlySettlement(id, patch, expectedStatus) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_enterprise_monthly_settlements
         SET status = ?,
             paid_reference = COALESCE(?, paid_reference),
             paid_evidence_url = COALESCE(?, paid_evidence_url),
             notes = COALESCE(?, notes),
             paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
         WHERE id = ? AND status = ?`,
        [
          patch.status,
          patch.paidReference || null,
          patch.paidEvidenceUrl || null,
          patch.notes || null,
          patch.status,
          id,
          expectedStatus
        ]
      );
      if (result.affectedRows === 0) return null;
      const settlement = await this.getEnterpriseMonthlySettlementById(id);
      if (!settlement) throw new Error("enterprise monthly settlement not found");
      return settlement;
    },

  };
}
