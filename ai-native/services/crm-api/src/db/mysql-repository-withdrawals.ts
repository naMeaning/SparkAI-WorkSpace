import type { ResultSetHeader } from "mysql2/promise";
import { ledgerDirections, ledgerEventTypes } from "@ai-native/crm-contracts";
import type { WithdrawalCommissionAllocationDto } from "../types.js";
import { httpError } from "../http.js";
import {
  mapCommission,
  mapWithdrawal,
  mapWithdrawalCommissionAllocation,
  numberValue,
  roundMoney
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createWithdrawalRepositoryMethods(
  { executor, options }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async createWithdrawal(input) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_withdrawals
          (beneficiary_crm_user_id, amount_rmb, payout_method, payout_account_name, payout_account, payout_bank_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.beneficiaryCrmUserId,
          input.amountRmb,
          input.payoutMethod,
          input.payoutAccountName,
          input.payoutAccount,
          input.payoutBankName
        ]
      );
      const [rows] = await executor.query<DbRow[]>(
        `SELECT withdrawal.*, beneficiary.username AS beneficiary_username
         FROM crm_withdrawals withdrawal
         LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
         WHERE withdrawal.id = ? LIMIT 1`,
        [result.insertId]
      );
      return mapWithdrawal(rows[0]);
    },

    async createWithdrawalWithBalanceCheck(input) {
      if (!options.transactional) {
        return this.withTransaction((transactionRepository) => (
          transactionRepository.createWithdrawalWithBalanceCheck(input)
        ));
      }
      await executor.query(
        "SELECT id FROM crm_users WHERE id = ? FOR UPDATE",
        [input.beneficiaryCrmUserId]
      );
      const settings = await this.getSettings();
      if (input.amountRmb < settings.withdrawalMinAmountRmb) {
        throw httpError("withdrawal amount is below the minimum", 400, "withdrawal_min_amount");
      }
      const blocked = await this.hasBlockingRisk(
        "user",
        String(input.beneficiaryCrmUserId),
        "withdrawal"
      );
      if (blocked) {
        throw httpError("withdrawal is blocked by risk case", 409, "withdrawal_risk_blocked");
      }
      const summary = await this.getCommissionSummary(input.beneficiaryCrmUserId);
      const [pending, approved] = await Promise.all([
        this.sumWithdrawals({ beneficiaryCrmUserId: input.beneficiaryCrmUserId, status: "pending" }),
        this.sumWithdrawals({ beneficiaryCrmUserId: input.beneficiaryCrmUserId, status: "approved" })
      ]);
      const available = Math.max(
        0,
        roundMoney(summary.releasableCommissionRmb - pending - approved)
      );
      if (available < input.amountRmb) {
        throw httpError("releasable commission balance is insufficient", 400, "withdrawal_insufficient_balance");
      }
      return this.createWithdrawal(input);
    },

    async getWithdrawalById(id) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          withdrawal.*,
          beneficiary.username AS beneficiary_username,
          reviewer.username AS reviewer_username
         FROM crm_withdrawals withdrawal
         LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
         LEFT JOIN crm_users reviewer ON reviewer.id = withdrawal.reviewer_crm_user_id
         WHERE withdrawal.id = ? LIMIT 1`,
        [id]
      );
      return rows[0] ? mapWithdrawal(rows[0]) : null;
    },

    async listWithdrawals({ beneficiaryCrmUserId, status, page = 1, pageSize = 20 } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (beneficiaryCrmUserId) {
        clauses.push("withdrawal.beneficiary_crm_user_id = ?");
        params.push(beneficiaryCrmUserId);
      }
      if (status) {
        clauses.push("withdrawal.status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const from = `FROM crm_withdrawals withdrawal
        LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
        LEFT JOIN crm_users reviewer ON reviewer.id = withdrawal.reviewer_crm_user_id`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          withdrawal.*,
          beneficiary.username AS beneficiary_username,
          reviewer.username AS reviewer_username
         ${from}
         ${where}
         ORDER BY withdrawal.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map(mapWithdrawal),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async sumWithdrawals({ beneficiaryCrmUserId, status } = {}) {
      const clauses = [];
      const params: unknown[] = [];
      if (beneficiaryCrmUserId) {
        clauses.push("beneficiary_crm_user_id = ?");
        params.push(beneficiaryCrmUserId);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [rows] = await executor.query<DbRow[]>(`SELECT COALESCE(SUM(amount_rmb), 0) AS total FROM crm_withdrawals ${where}`, params);
      return numberValue(rows[0]?.total);
    },

    async updateWithdrawal(id, patch, expectedStatus) {
      const [result] = await executor.query<ResultSetHeader>(
        `UPDATE crm_withdrawals
         SET status = ?, reviewer_crm_user_id = ?, review_reason = ?, paid_reference = COALESCE(?, paid_reference),
             paid_evidence_url = COALESCE(?, paid_evidence_url),
             reviewed_at = CURRENT_TIMESTAMP,
             paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
         WHERE id = ? AND status = ?`,
        [
          patch.status,
          patch.reviewerCrmUserId,
          patch.reviewReason,
          patch.paidReference || null,
          patch.paidEvidenceUrl || null,
          patch.status,
          id,
          expectedStatus
        ]
      );
      if (result.affectedRows === 0) return null;
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          withdrawal.*,
          beneficiary.username AS beneficiary_username,
          reviewer.username AS reviewer_username
         FROM crm_withdrawals withdrawal
         LEFT JOIN crm_users beneficiary ON beneficiary.id = withdrawal.beneficiary_crm_user_id
         LEFT JOIN crm_users reviewer ON reviewer.id = withdrawal.reviewer_crm_user_id
         WHERE withdrawal.id = ? LIMIT 1`,
        [id]
      );
      if (!rows[0]) throw new Error("withdrawal not found");
      return mapWithdrawal(rows[0]);
    },

    async markWithdrawalPaidWithAllocations(input) {
      if (!options.transactional) {
        return this.withTransaction((transactionRepository) => (
          transactionRepository.markWithdrawalPaidWithAllocations(input)
        ));
      }
      const [withdrawalRows] = await executor.query<DbRow[]>(
        "SELECT * FROM crm_withdrawals WHERE id = ? FOR UPDATE",
        [input.withdrawalId]
      );
      if (!withdrawalRows[0]) throw httpError("withdrawal was not found", 404, "not_found");
      const current = mapWithdrawal(withdrawalRows[0]);
      if (current.status !== "approved") {
        throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
      }
      await executor.query(
        "SELECT id FROM crm_users WHERE id = ? FOR UPDATE",
        [current.beneficiaryCrmUserId]
      );
      const [commissionRows] = await executor.query<DbRow[]>(
        `SELECT * FROM crm_commissions
         WHERE beneficiary_crm_user_id = ?
           AND status = 'releasable'
           AND commission_amount_rmb > released_amount_rmb
         ORDER BY created_at ASC, id ASC
         FOR UPDATE`,
        [current.beneficiaryCrmUserId]
      );
      const candidates = commissionRows.map(mapCommission);
      const available = candidates.reduce(
        (sum, commission) => sum + commission.amountRmb - commission.releasedAmountRmb,
        0
      );
      if (Math.round(available * 100) < Math.round(current.amountRmb * 100)) {
        throw httpError("releasable commission balance is insufficient", 409, "withdrawal_insufficient_balance");
      }

      let remaining = current.amountRmb;
      const allocations: WithdrawalCommissionAllocationDto[] = [];
      for (const commission of candidates) {
        if (remaining <= 0) break;
        const remainingCommission = roundMoney(commission.amountRmb - commission.releasedAmountRmb);
        const allocatedAmount = Math.min(remainingCommission, remaining);
        const [allocationResult] = await executor.query<ResultSetHeader>(
          `INSERT INTO crm_withdrawal_commission_allocations
            (withdrawal_id, commission_id, amount_rmb)
           VALUES (?, ?, ?)`,
          [current.id, commission.id, allocatedAmount]
        );
        await executor.query(
          `UPDATE crm_commissions
           SET status = CASE
                 WHEN released_amount_rmb + ? >= commission_amount_rmb THEN 'released'
                 ELSE status
               END,
               released_amount_rmb = released_amount_rmb + ?
           WHERE id = ? AND status = 'releasable'`,
          [allocatedAmount, allocatedAmount, commission.id]
        );
        allocations.push({
          id: allocationResult.insertId,
          withdrawalId: current.id,
          commissionId: Number(commission.id),
          amountRmb: allocatedAmount
        });
        remaining = roundMoney(remaining - allocatedAmount);
      }

      const [updateResult] = await executor.query<ResultSetHeader>(
        `UPDATE crm_withdrawals
         SET status = 'paid', reviewer_crm_user_id = ?, review_reason = ?, paid_reference = ?,
             paid_evidence_url = COALESCE(?, paid_evidence_url), reviewed_at = CURRENT_TIMESTAMP,
             paid_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'approved'`,
        [
          input.operatorCrmUserId,
          input.reviewReason,
          input.paidReference,
          input.paidEvidenceUrl || null,
          current.id
        ]
      );
      if (updateResult.affectedRows !== 1) {
        throw httpError("withdrawal status transition is invalid", 409, "withdrawal_status_invalid");
      }
      const withdrawal = await this.getWithdrawalById(current.id);
      if (!withdrawal) throw httpError("withdrawal was not found", 404, "not_found");
      await this.insertLedgerEntry({
        crmUserId: current.beneficiaryCrmUserId,
        direction: ledgerDirections.debit,
        amountRmb: current.amountRmb,
        paidAmountRmb: 0,
        discountAmountRmb: 0,
        commissionBaseRmb: 0,
        eventType: ledgerEventTypes.commissionWithdrawal,
        sourceType: "withdrawal",
        sourceId: current.id,
        idempotencyKey: `commission-withdrawal:${current.id}:paid`,
        operatorCrmUserId: input.operatorCrmUserId,
        reason: input.reviewReason,
        isPaid: false
      });
      await this.insertAuditLog({
        operatorCrmUserId: input.operatorCrmUserId,
        targetType: "withdrawal",
        targetId: current.id,
        action: "withdrawal.paid",
        reason: input.reviewReason,
        before: current,
        after: { withdrawal, allocations }
      });
      return { withdrawal, allocations };
    },

    async listWithdrawalCommissionAllocations(withdrawalId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT * FROM crm_withdrawal_commission_allocations
         WHERE withdrawal_id = ? ORDER BY id ASC`,
        [withdrawalId]
      );
      return rows.map(mapWithdrawalCommissionAllocation);
    },

  };
}
