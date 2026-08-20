import type { ResultSetHeader } from "mysql2/promise";
import { ledgerDirections } from "@ai-native/crm-contracts";
import { getCrmRequestContext } from "../request-context.js";
import {
  mapAudit,
  mapLedger,
  numberValue,
  roundMoney
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createLedgerAuditRepositoryMethods(
  { executor, options }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async insertLedgerEntry(entry) {
      if (!options.transactional) {
        return this.withTransaction((transactionRepository) => transactionRepository.insertLedgerEntry(entry));
      }
      await executor.query(
        "SELECT id FROM crm_users WHERE id = ? FOR UPDATE",
        [entry.crmUserId]
      );
      const [existingRows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_ledger_entries WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
        [entry.idempotencyKey]
      );
      if (existingRows[0]) {
        return { ...mapLedger(existingRows[0]), didMutate: false };
      }
      const [balanceRows] = await executor.query<DbRow[]>(
        `SELECT COALESCE(SUM(CASE WHEN direction = ? THEN amount_rmb ELSE -amount_rmb END), 0) AS balance
         FROM crm_ledger_entries
         WHERE crm_user_id = ?`,
        [ledgerDirections.credit, entry.crmUserId]
      );
      const signedAmount = entry.direction === ledgerDirections.credit ? entry.amountRmb : -entry.amountRmb;
      const balanceAfterRmb = roundMoney(numberValue(balanceRows[0]?.balance) + signedAmount);
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_ledger_entries
          (crm_user_id, direction, amount_rmb, paid_amount_rmb, discount_amount_rmb, commission_base_rmb,
           balance_after_rmb, event_type, source_type, source_id, idempotency_key, operator_crm_user_id, reason, is_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.crmUserId,
          entry.direction,
          entry.amountRmb,
          entry.paidAmountRmb || 0,
          entry.discountAmountRmb || 0,
          entry.commissionBaseRmb || 0,
          balanceAfterRmb,
          entry.eventType,
          entry.sourceType,
          entry.sourceId || null,
          entry.idempotencyKey,
          entry.operatorCrmUserId || null,
          entry.reason || "",
          entry.isPaid ? 1 : 0
        ]
      );
      return {
        ...entry,
        id: result.insertId,
        paidAmountRmb: entry.paidAmountRmb || 0,
        discountAmountRmb: entry.discountAmountRmb || 0,
        commissionBaseRmb: entry.commissionBaseRmb || 0,
        sourceId: entry.sourceId || null,
        operatorCrmUserId: entry.operatorCrmUserId || null,
        reason: entry.reason || "",
        balanceAfterRmb,
        didMutate: true
      };
    },

    async findLedgerEntryByIdempotencyKey(idempotencyKey) {
      const [rows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_ledger_entries WHERE idempotency_key = ? LIMIT 1",
        [idempotencyKey]
      );
      return rows[0] ? mapLedger(rows[0]) : null;
    },

    async sumLedgerAmount(options) {
      const summary = await this.summarizeLedger(options);
      return summary.amountRmb;
    },

    async summarizeLedger({ crmUserId, eventType, direction, createdAtFrom, createdAtBefore }) {
      const clauses = ["crm_user_id = ?"];
      const params: unknown[] = [crmUserId];
      if (eventType) {
        clauses.push("event_type = ?");
        params.push(eventType);
      }
      if (direction) {
        clauses.push("direction = ?");
        params.push(direction);
      }
      if (createdAtFrom) {
        clauses.push("created_at >= ?");
        params.push(createdAtFrom);
      }
      if (createdAtBefore) {
        clauses.push("created_at < ?");
        params.push(createdAtBefore);
      }
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COALESCE(SUM(amount_rmb), 0) AS amount, COUNT(*) AS entry_count
         FROM crm_ledger_entries WHERE ${clauses.join(" AND ")}`,
        params
      );
      return {
        amountRmb: Math.round(numberValue(rows[0]?.amount) * 100) / 100,
        entryCount: numberValue(rows[0]?.entry_count)
      };
    },

    async listLedger({ crmUserId, eventType, direction, page = 1, pageSize = 20 } = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (crmUserId) {
        clauses.push("entry.crm_user_id = ?");
        params.push(crmUserId);
      }
      if (eventType) {
        clauses.push("entry.event_type = ?");
        params.push(eventType);
      }
      if (direction) {
        clauses.push("entry.direction = ?");
        params.push(direction);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_ledger_entries entry ${where}`,
        params
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          entry.*,
          crm_user.username AS crm_username,
          operator.username AS operator_username
         FROM crm_ledger_entries entry
         LEFT JOIN crm_users crm_user ON crm_user.id = entry.crm_user_id
         LEFT JOIN crm_users operator ON operator.id = entry.operator_crm_user_id
         ${where}
         ORDER BY entry.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapLedger),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async insertAuditLog(entry) {
      const requestContext = getCrmRequestContext();
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_audit_logs
          (operator_crm_user_id, target_type, target_id, action, reason, before_snapshot, after_snapshot,
           request_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.operatorCrmUserId,
          entry.targetType,
          String(entry.targetId),
          entry.action,
          entry.reason || "",
          JSON.stringify(entry.before || null),
          JSON.stringify(entry.after || null),
          requestContext?.requestIp || "",
          requestContext?.userAgent || ""
        ]
      );
      return {
        id: result.insertId,
        operatorCrmUserId: entry.operatorCrmUserId,
        targetType: entry.targetType,
        targetId: String(entry.targetId),
        action: entry.action,
        reason: entry.reason || "",
        beforeSnapshot: entry.before || null,
        afterSnapshot: entry.after || null,
        requestIp: requestContext?.requestIp || "",
        userAgent: requestContext?.userAgent || ""
      };
    },

    async listAuditLogs({ operatorCrmUserId, targetType, targetId, action, page = 1, pageSize = 20 } = {}) {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (operatorCrmUserId) {
        clauses.push("audit.operator_crm_user_id = ?");
        params.push(operatorCrmUserId);
      }
      if (targetType) {
        clauses.push("audit.target_type = ?");
        params.push(targetType);
      }
      if (targetId) {
        clauses.push("audit.target_id = ?");
        params.push(targetId);
      }
      if (action) {
        clauses.push("audit.action = ?");
        params.push(action);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total FROM crm_audit_logs audit ${where}`,
        params
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          audit.*,
          operator.username AS operator_username
         FROM crm_audit_logs audit
         LEFT JOIN crm_users operator ON operator.id = audit.operator_crm_user_id
         ${where}
         ORDER BY audit.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapAudit),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

  };
}
