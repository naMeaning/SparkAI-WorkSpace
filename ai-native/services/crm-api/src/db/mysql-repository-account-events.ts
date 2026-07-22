import type { ResultSetHeader } from "mysql2/promise";
import { accountEventStatuses } from "@ai-native/crm-contracts";
import type { AccountEventRecord } from "../types.js";
import {
  mapAccountEvent,
  numberValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createAccountEventRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async findAccountEventByIdempotencyKey(idempotencyKey) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
      return mapAccountEvent(rows[0]);
    },

    async getAccountEventById(id) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      return mapAccountEvent(rows[0]);
    },

    async createAccountEvent(record) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_account_events
          (event_type, crm_user_id, operator_crm_user_id, amount_rmb, paid_amount_rmb, discount_amount_rmb,
           commission_base_rmb, quota_delta, idempotency_key, reason, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.eventType,
          record.crmUserId,
          record.operatorCrmUserId,
          record.amountRmb,
          record.paidAmountRmb,
          record.discountAmountRmb,
          record.commissionBaseRmb,
          record.quotaDelta,
          record.idempotencyKey,
          record.reason,
          JSON.stringify(record.metadata || null)
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [result.insertId]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event was not found after insert");
      return mapped;
    },

    async markAccountEventQuotaApplying(id) {
      const [result] = await executor.query<ResultSetHeader>(
        "UPDATE crm_account_events SET status = 'quota_applying' WHERE id = ? AND status = 'pending'",
        [id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async markAccountEventQuotaApplied(id, patch) {
      const [result] = await executor.query<ResultSetHeader>(
        "UPDATE crm_account_events SET status = 'quota_applied', new_api_result = ? WHERE id = ? AND status IN ('quota_applying', 'reconcile_required', 'cancelled')",
        [JSON.stringify(patch.newApiResult || null), id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async markAccountEventLocalApplying(id) {
      const [result] = await executor.query<ResultSetHeader>(
        "UPDATE crm_account_events SET status = 'local_applying' WHERE id = ? AND status = 'quota_applied'",
        [id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async completeAccountEvent(id, patch) {
      await executor.query(
        "UPDATE crm_account_events SET status = 'completed', quota_delta = ?, new_api_result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'local_applying'",
        [patch.quotaDelta, JSON.stringify(patch.newApiResult || null), id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return mapped;
    },

    async markAccountEventReconcileRequired(id, reason) {
      await executor.query(
        `UPDATE crm_account_events
         SET status = ?,
             metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.reconcileReason', ?)
         WHERE id = ?`,
        [accountEventStatuses.reconcileRequired, reason, id]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return mapped;
    },

    async cancelAccountEvent(id, reason) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_account_events
         SET status = ?,
             metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.cancelReason', ?)
         WHERE id = ?
           AND status IN (?, ?, ?)
           AND new_api_result IS NULL`,
        [
          accountEventStatuses.cancelled,
          reason,
          id,
          accountEventStatuses.pending,
          accountEventStatuses.quotaApplying,
          accountEventStatuses.reconcileRequired
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_account_events WHERE id = ? LIMIT 1", [id]);
      const mapped = mapAccountEvent(rows[0]);
      if (!mapped) throw new Error("account event not found");
      return { ...mapped, didMutate: result.affectedRows > 0 };
    },

    async listAccountEvents({ crmUserId, eventType, status, page = 1, pageSize = 20 } = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (crmUserId) {
        clauses.push("event.crm_user_id = ?");
        params.push(crmUserId);
      }
      if (eventType) {
        clauses.push("event.event_type = ?");
        params.push(eventType);
      }
      if (status) {
        clauses.push("event.status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_account_events event ${where}`,
        params
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          event.*,
          crm_user.username AS crm_username,
          operator.username AS operator_username
         FROM crm_account_events event
         LEFT JOIN crm_users crm_user ON crm_user.id = event.crm_user_id
         LEFT JOIN crm_users operator ON operator.id = event.operator_crm_user_id
         ${where}
         ORDER BY event.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map((row) => mapAccountEvent(row)).filter((row): row is AccountEventRecord => Boolean(row)),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

  };
}
