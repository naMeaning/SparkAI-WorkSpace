import type { ResultSetHeader } from "mysql2/promise";
import {
  mapOfflineRechargeRequest,
  numberValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createOfflineRechargeRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async createOfflineRechargeRequest(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_offline_recharge_requests
          (crm_user_id, method, amount_rmb, payer_name, payment_reference, payment_evidence_url, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.crmUserId,
          input.method,
          input.amountRmb,
          input.payerName,
          input.paymentReference,
          input.paymentEvidenceUrl,
          input.notes
        ]
      );
      const request = await this.getOfflineRechargeRequestById(result.insertId);
      if (!request) throw new Error("offline recharge request not found after insert");
      return request;
    },

    async getOfflineRechargeRequestById(id) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          request.*,
          crm_user.username AS crm_username,
          reviewer.username AS reviewer_username
         FROM crm_offline_recharge_requests request
         LEFT JOIN crm_users crm_user ON crm_user.id = request.crm_user_id
         LEFT JOIN crm_users reviewer ON reviewer.id = request.reviewer_crm_user_id
         WHERE request.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? mapOfflineRechargeRequest(rows[0]) : null;
    },

    async listOfflineRechargeRequests({ crmUserId, status, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (crmUserId) {
        clauses.push("request.crm_user_id = ?");
        params.push(crmUserId);
      }
      if (status) {
        clauses.push("request.status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_offline_recharge_requests request
        LEFT JOIN crm_users crm_user ON crm_user.id = request.crm_user_id
        LEFT JOIN crm_users reviewer ON reviewer.id = request.reviewer_crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          request.*,
          crm_user.username AS crm_username,
          reviewer.username AS reviewer_username
         ${from}
         ${where}
         ORDER BY request.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapOfflineRechargeRequest),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async updateOfflineRechargeRequest(id, patch, expectedStatus) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_offline_recharge_requests
         SET status = ?, reviewer_crm_user_id = ?, review_reason = ?, account_event_id = ?,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = ?`,
        [patch.status, patch.reviewerCrmUserId, patch.reviewReason, patch.accountEventId || null, id, expectedStatus]
      );
      if (result.affectedRows === 0) return null;
      const request = await this.getOfflineRechargeRequestById(id);
      if (!request) throw new Error("offline recharge request not found");
      return request;
    },

  };
}
