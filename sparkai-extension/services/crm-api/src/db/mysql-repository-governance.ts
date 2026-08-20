import type { ResultSetHeader } from "mysql2/promise";
import { buildBusinessUserScope } from "./mysql-business-scope.js";
import {
  jsonValue,
  mapRiskCase,
  mergeSettingsWithDefaults,
  numberValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createGovernanceRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async createRiskCase(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_risk_cases
          (target_type, target_id, risk_type, evidence_json, notes, blocks_withdrawal, blocks_commission_release, created_by_crm_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.targetType,
          input.targetId,
          input.riskType,
          JSON.stringify(input.evidence || null),
          input.notes,
          input.blocksWithdrawal ? 1 : 0,
          input.blocksCommissionRelease ? 1 : 0,
          input.createdByCrmUserId
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_risk_cases WHERE id = ? LIMIT 1", [result.insertId]);
      return mapRiskCase(rows[0]);
    },

    async listRiskCases({ status, targetType, targetId, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (targetType) {
        clauses.push("target_type = ?");
        params.push(targetType);
      }
      if (targetId) {
        clauses.push("target_id = ?");
        params.push(targetId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total FROM crm_risk_cases ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT * FROM crm_risk_cases ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapRiskCase),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async updateRiskCase(id, patch) {
      const currentRows = await this.listRiskCases({ page: 1, pageSize: 1 });
      await executor.query(
        `UPDATE crm_risk_cases
         SET status = COALESCE(?, status),
             evidence_json = COALESCE(?, evidence_json),
             notes = COALESCE(?, notes),
             blocks_withdrawal = COALESCE(?, blocks_withdrawal),
             blocks_commission_release = COALESCE(?, blocks_commission_release)
         WHERE id = ?`,
        [
          patch.status || null,
          patch.evidence === undefined ? null : JSON.stringify(patch.evidence),
          patch.notes || null,
          patch.blocksWithdrawal === undefined ? null : patch.blocksWithdrawal ? 1 : 0,
          patch.blocksCommissionRelease === undefined ? null : patch.blocksCommissionRelease ? 1 : 0,
          id
        ]
      );
      void currentRows;
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_risk_cases WHERE id = ? LIMIT 1", [id]);
      if (!rows[0]) throw new Error("risk case not found");
      return mapRiskCase(rows[0]);
    },

    async hasBlockingRisk(targetType, targetId, block) {
      const column = block === "withdrawal" ? "blocks_withdrawal" : "blocks_commission_release";
      const [rows] = await executor.query<DbRow[]>(
        `SELECT 1 FROM crm_risk_cases WHERE target_type = ? AND target_id = ? AND status IN ('open', 'reviewing') AND ${column} = 1 LIMIT 1`,
        [targetType, targetId]
      );
      return Boolean(rows[0]);
    },

    async getSettings() {
      const [rows] = await executor.query<DbRow[]>("SELECT setting_value FROM crm_settings WHERE setting_key = 'crm_settings' LIMIT 1");
      return mergeSettingsWithDefaults(jsonValue(rows[0]?.setting_value));
    },

    async saveSettings(settings, operatorCrmUserId) {
      await executor.query(
        `INSERT INTO crm_settings (setting_key, setting_value, updated_by_crm_user_id)
         VALUES ('crm_settings', ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by_crm_user_id = VALUES(updated_by_crm_user_id)`,
        [JSON.stringify(settings), operatorCrmUserId]
      );
      return this.getSettings();
    },

    async getDashboardSummary() {
      const [ledgerRows] = await executor.query<DbRow[]>(
        "SELECT COALESCE(SUM(CASE WHEN is_paid = 1 AND direction = 'credit' THEN paid_amount_rmb ELSE 0 END), 0) AS paid_topup_rmb FROM crm_ledger_entries"
      );
      const [commissionRows] = await executor.query<DbRow[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'frozen' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS frozen_commission_rmb,
          COALESCE(SUM(CASE WHEN status = 'releasable' THEN commission_amount_rmb - released_amount_rmb ELSE 0 END), 0) AS releasable_commission_rmb,
          COALESCE(SUM(released_amount_rmb), 0) AS released_commission_rmb
         FROM crm_commissions`
      );
      const [withdrawalRows] = await executor.query<DbRow[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN amount_rmb ELSE 0 END), 0) AS pending_withdrawal_rmb,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_withdrawals,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_withdrawals
         FROM crm_withdrawals`
      );
      const [accountEventRows] = await executor.query<DbRow[]>(
        "SELECT COUNT(*) AS reconcile_required_account_events FROM crm_account_events WHERE status = 'reconcile_required'"
      );
      const [offlineRechargeRows] = await executor.query<DbRow[]>(
        "SELECT COUNT(*) AS pending_offline_recharges FROM crm_offline_recharge_requests WHERE status = 'pending'"
      );
      const [riskRows] = await executor.query<DbRow[]>("SELECT COUNT(*) AS open_risk_cases FROM crm_risk_cases WHERE status = 'open'");
      const businessScope = buildBusinessUserScope({
        userAlias: "crm_user"
      });
      const businessUserJoin = `
        FROM crm_users crm_user
        ${businessScope.joinSql}
        WHERE ${businessScope.whereParts.join(" AND ")}
      `;
      const [crmUserRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS crm_user_count ${businessUserJoin}`, businessScope.params);
      const [agentRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS agent_count
         FROM crm_agents agent
         JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         ${businessScope.joinSql}
         WHERE ${businessScope.whereParts.join(" AND ")}`,
        businessScope.params
      );

      return {
        paidTopupRmb: numberValue(ledgerRows[0]?.paid_topup_rmb),
        frozenCommissionRmb: numberValue(commissionRows[0]?.frozen_commission_rmb),
        releasableCommissionRmb: numberValue(commissionRows[0]?.releasable_commission_rmb),
        releasedCommissionRmb: numberValue(commissionRows[0]?.released_commission_rmb),
        pendingWithdrawalRmb: numberValue(withdrawalRows[0]?.pending_withdrawal_rmb),
        reconcileRequiredAccountEvents: numberValue(accountEventRows[0]?.reconcile_required_account_events),
        pendingOfflineRecharges: numberValue(offlineRechargeRows[0]?.pending_offline_recharges),
        pendingWithdrawals: numberValue(withdrawalRows[0]?.pending_withdrawals),
        approvedWithdrawals: numberValue(withdrawalRows[0]?.approved_withdrawals),
        openRiskCases: numberValue(riskRows[0]?.open_risk_cases),
        userCount: numberValue(crmUserRows[0]?.crm_user_count),
        agentCount: numberValue(agentRows[0]?.agent_count)
      };
    }
  };
}
