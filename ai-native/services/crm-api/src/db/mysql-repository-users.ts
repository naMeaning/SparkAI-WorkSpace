import type { ResultSetHeader } from "mysql2/promise";
import { signupTrialGrantStatuses } from "@ai-native/crm-contracts";
import type {
  CrmUserCreateInput,
  CrmUserIdentityUpdateInput,
  CrmUserRecord
} from "../types.js";
import { buildBusinessUserScope } from "./mysql-business-scope.js";
import {
  defaultProfile,
  mapCrmUser,
  mapProfile,
  numberValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createUserRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async createCrmUser(input: CrmUserCreateInput) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_users
          (username, email, new_api_user_id, new_api_role, first_topup_discount_rate,
           signup_trial_grant_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.username,
          input.email || "",
          input.newApiUserId || null,
          input.newApiRole ?? 1,
          input.firstTopupDiscountRate || null,
          input.signupTrialGrantStatus || signupTrialGrantStatuses.granted
        ]
      );
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE id = ? LIMIT 1", [result.insertId]);
      const mapped = mapCrmUser(rows[0]);
      if (!mapped) throw new Error("CRM user was not found after insert");
      return mapped;
    },

    async getCrmUserById(crmUserId) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE id = ? LIMIT 1", [crmUserId]);
      return mapCrmUser(rows[0]);
    },

    async getCrmUserByUsername(username) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE username = ? LIMIT 1", [username]);
      return mapCrmUser(rows[0]);
    },

    async getCrmUserByNewApiUserId(newApiUserId) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_users WHERE new_api_user_id = ? LIMIT 1", [newApiUserId]);
      return mapCrmUser(rows[0]);
    },

    async updateCrmUserIdentity(crmUserId, input: CrmUserIdentityUpdateInput) {
      await executor.query(
        `UPDATE crm_users
         SET username = ?, email = ?, new_api_role = ?
         WHERE id = ?`,
        [input.username, input.email, input.newApiRole, crmUserId]
      );
      const user = await this.getCrmUserById(crmUserId);
      if (!user) throw new Error("CRM user not found");
      return user;
    },

    async listCrmUsers({
      page = 1,
      pageSize = 20,
      keyword = "",
      excludeSuperAdmins = false,
      hasAgentRelationship = false,
      enterpriseOnly = false
    } = {}) {
      const search = `%${keyword}%`;
      const businessScope = excludeSuperAdmins
        ? buildBusinessUserScope({
          userAlias: "crm_users"
        })
        : null;
      const whereParts = [
        ...(keyword ? ["(crm_users.username LIKE ? OR crm_users.email LIKE ?)"] : []),
        ...(hasAgentRelationship ? ["relationship.id IS NOT NULL"] : []),
        ...(enterpriseOnly ? ["profile.is_enterprise = 1"] : []),
        ...(businessScope ? businessScope.whereParts : [])
      ];
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const params = [...(keyword ? [search, search] : []), ...(businessScope ? businessScope.params : [])];
      const joins = [
        businessScope?.joinSql || "",
        hasAgentRelationship
          ? `LEFT JOIN crm_agent_relationships relationship
             ON relationship.customer_crm_user_id = crm_users.id
              AND relationship.status = 'active'`
          : "",
        enterpriseOnly
          ? "JOIN crm_user_profiles profile ON profile.crm_user_id = crm_users.id"
          : ""
      ].filter(Boolean).join("\n");
      const from = `FROM crm_users ${joins}`;
      const [countRows] = await executor.query<DbRow[]>(`SELECT COUNT(*) AS total ${from} ${where}`, params);
      const [rows] = await executor.query<DbRow[]>(
        `SELECT crm_users.* ${from} ${where} ORDER BY crm_users.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        items: rows.map((row) => mapCrmUser(row)).filter((row): row is CrmUserRecord => Boolean(row)),
        total: numberValue(countRows[0]?.total)
      };
    },

    async markFirstTopupDiscountUsed(crmUserId, usedAt) {
      await executor.query(
        "UPDATE crm_users SET first_topup_discount_used_at = ? WHERE id = ? AND first_topup_discount_used_at IS NULL",
        [usedAt, crmUserId]
      );
      const user = await this.getCrmUserById(crmUserId);
      if (!user) throw new Error("CRM user not found");
      return user;
    },

    async markSignupTrialGrantStatus(crmUserId, status) {
      await executor.query(
        "UPDATE crm_users SET signup_trial_grant_status = ? WHERE id = ?",
        [status, crmUserId]
      );
      const user = await this.getCrmUserById(crmUserId);
      if (!user) throw new Error("CRM user not found");
      return user;
    },

    async getUserProfile(crmUserId) {
      const [rows] = await executor.query<DbRow[]>("SELECT * FROM crm_user_profiles WHERE crm_user_id = ? LIMIT 1", [crmUserId]);
      return mapProfile(rows[0]) || defaultProfile(crmUserId);
    },

    async saveUserProfile(profile) {
      await executor.query(
        `INSERT INTO crm_user_profiles
          (crm_user_id, phone, wechat, remark, cumulative_paid_rmb,
           is_enterprise, enterprise_price_rmb, enterprise_fixed_commission_per_image, is_risk)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          phone = VALUES(phone),
          wechat = VALUES(wechat),
          remark = VALUES(remark),
          cumulative_paid_rmb = VALUES(cumulative_paid_rmb),
          is_enterprise = VALUES(is_enterprise),
          enterprise_price_rmb = VALUES(enterprise_price_rmb),
          enterprise_fixed_commission_per_image = VALUES(enterprise_fixed_commission_per_image),
          is_risk = VALUES(is_risk)`,
        [
          profile.crmUserId,
          profile.phone,
          profile.wechat,
          profile.remark,
          profile.cumulativePaidRmb,
          profile.isEnterprise ? 1 : 0,
          profile.enterprisePriceRmb,
          profile.enterpriseFixedCommissionPerImage,
          profile.isRisk ? 1 : 0
        ]
      );
      return this.getUserProfile(profile.crmUserId);
    },

  };
}
