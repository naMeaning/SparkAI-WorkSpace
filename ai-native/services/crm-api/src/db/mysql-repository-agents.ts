import type { ResultSetHeader } from "mysql2/promise";
import type {
  AgentDto,
  AgentRelationshipDto
} from "../types.js";
import { buildBusinessUserScope } from "./mysql-business-scope.js";
import {
  mapAgent,
  mapRelationship,
  numberValue,
  stringValue
} from "./mysql-row-mappers.js";
import type {
  DbRow,
  MysqlRepositoryFactoryContext,
  MysqlRepositoryMethods
} from "./mysql-support.js";

export function createAgentRepositoryMethods(
  { executor }: MysqlRepositoryFactoryContext
): MysqlRepositoryMethods {
  return {
    async getAgentById(agentId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         WHERE agent.id = ? LIMIT 1`,
        [agentId]
      );
      return mapAgent(rows[0]);
    },

    async getAgentByCrmUserId(crmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         WHERE agent.crm_user_id = ? LIMIT 1`,
        [crmUserId]
      );
      return mapAgent(rows[0]);
    },

    async getAgentByInviteCode(inviteCode) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         WHERE agent.invite_code = ? LIMIT 1`,
        [inviteCode]
      );
      return mapAgent(rows[0]);
    },

    async saveAgent(agent) {
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_agents
          (crm_user_id, status, category, invite_code, parent_agent_id, level, level_effective_at, level_expires_at,
           last_level_evaluated_at, effective_paid_customer_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          category = VALUES(category),
          invite_code = VALUES(invite_code),
          parent_agent_id = VALUES(parent_agent_id),
          level = VALUES(level),
          level_effective_at = VALUES(level_effective_at),
          level_expires_at = VALUES(level_expires_at),
          last_level_evaluated_at = VALUES(last_level_evaluated_at),
          effective_paid_customer_count = VALUES(effective_paid_customer_count)`,
        [
          agent.crmUserId,
          agent.status,
          agent.category,
          agent.inviteCode,
          agent.parentAgentId,
          agent.level,
          agent.levelEffectiveAt,
          agent.levelExpiresAt,
          agent.lastLevelEvaluatedAt,
          agent.effectivePaidCustomerCount
        ]
      );
      const stored = await this.getAgentByCrmUserId(agent.crmUserId);
      if (!stored) throw new Error("agent record not found after save");
      return { ...stored, didMutate: result.insertId > 0 || result.changedRows > 0 } as AgentDto;
    },

    async listAgents({ page = 1, pageSize = 20, parentAgentCrmUserId, businessOnly = false } = {}) {
      const params: unknown[] = [];
      const whereParts: string[] = [];
      if (parentAgentCrmUserId) {
        whereParts.push("parent.crm_user_id = ?");
        params.push(parentAgentCrmUserId);
      }
      if (businessOnly) {
        whereParts.push("crm_user.id IS NOT NULL");
        whereParts.push("crm_user.new_api_role < ?");
        params.push(100);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const countParams = [...params];
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          agent.*,
          crm_user.username AS crm_username,
          crm_user.email AS crm_email,
          parent.crm_user_id AS parent_agent_crm_user_id,
          parent_user.username AS parent_agent_username
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         LEFT JOIN crm_users parent_user ON parent_user.id = parent.crm_user_id
         ${where}
         ORDER BY agent.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      const [countRows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total
         FROM crm_agents agent
         LEFT JOIN crm_agents parent ON agent.parent_agent_id = parent.id
         LEFT JOIN crm_users crm_user ON crm_user.id = agent.crm_user_id
         ${where}`,
        countParams
      );
      return {
        items: rows.map((row) => mapAgent(row)).filter((agent): agent is AgentDto => Boolean(agent)),
        total: numberValue(countRows[0]?.total),
        page,
        pageSize
      };
    },

    async countSubAgents(agentCrmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total
         FROM crm_agents child
         JOIN crm_agents parent ON child.parent_agent_id = parent.id
         WHERE parent.crm_user_id = ? AND child.status = 'active'`,
        [agentCrmUserId]
      );
      return numberValue(rows[0]?.total);
    },

    async getAgentRelationshipByCustomer(crmUserId) {
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          relationship.id,
          relationship.customer_crm_user_id,
          customer_user.username AS customer_username,
          agent.crm_user_id AS agent_crm_user_id,
          agent_user.username AS agent_username,
          relationship.bind_source,
          relationship.status,
          relationship.bind_reason
         FROM crm_agent_relationships relationship
         JOIN crm_agents agent ON relationship.agent_id = agent.id
         LEFT JOIN crm_users customer_user ON customer_user.id = relationship.customer_crm_user_id
         LEFT JOIN crm_users agent_user ON agent_user.id = agent.crm_user_id
         WHERE relationship.customer_crm_user_id = ? AND relationship.status = 'active'
         LIMIT 1`,
        [crmUserId]
      );
      return mapRelationship(rows[0]);
    },

    async saveAgentRelationship(customerCrmUserId, relationship) {
      const [agentRows] = await executor.query<DbRow[]>("SELECT id FROM crm_agents WHERE crm_user_id = ? LIMIT 1", [relationship.agentCrmUserId]);
      const agentId = numberValue(agentRows[0]?.id);
      if (!agentId) throw new Error("agent record not found");
      const [result] = await executor.query<ResultSetHeader>(
        `INSERT INTO crm_agent_relationships
          (customer_crm_user_id, agent_id, bind_source, bind_reason, status)
         VALUES (?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE
          agent_id = VALUES(agent_id),
          bind_source = VALUES(bind_source),
          bind_reason = VALUES(bind_reason),
          status = 'active'`,
        [customerCrmUserId, agentId, relationship.bindSource, relationship.bindReason]
      );
      const saved = await this.getAgentRelationshipByCustomer(customerCrmUserId);
      if (!saved) throw new Error("agent relationship not found after save");
      return { ...saved, didMutate: result.insertId > 0 || result.changedRows > 0 } as AgentRelationshipDto;
    },

    async listAgentCustomers(agentCrmUserId, { page = 1, pageSize = 20, keyword = "" } = {}) {
      const search = `%${keyword}%`;
      const whereParts = [
        "agent.crm_user_id = ?",
        "relationship.status = 'active'",
        ...(keyword ? ["(customer_user.username LIKE ? OR customer_user.email LIKE ?)"] : [])
      ];
      const params = [agentCrmUserId, ...(keyword ? [search, search] : [])];
      const [rows] = await executor.query<DbRow[]>(
        `SELECT
          relationship.id,
          relationship.customer_crm_user_id,
          agent.crm_user_id AS agent_crm_user_id,
          agent_user.username AS agent_username,
          relationship.bind_source,
          relationship.status,
          relationship.bind_reason,
          customer_user.username AS customer_username,
          customer_user.email AS customer_email,
          customer_user.created_at AS customer_created_at
         FROM crm_agent_relationships relationship
         JOIN crm_agents agent ON relationship.agent_id = agent.id
         LEFT JOIN crm_users agent_user ON agent_user.id = agent.crm_user_id
         JOIN crm_users customer_user ON customer_user.id = relationship.customer_crm_user_id
         WHERE ${whereParts.join(" AND ")}
         ORDER BY relationship.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return rows.map((row) => ({
        customerCrmUserId: numberValue(row.customer_crm_user_id),
        customer: {
          crmUserId: numberValue(row.customer_crm_user_id),
          username: stringValue(row.customer_username),
          email: stringValue(row.customer_email),
          createdAt: row.customer_created_at ? String(row.customer_created_at) : undefined
        },
        relationship: mapRelationship(row) as AgentRelationshipDto
      }));
    },

    async countAgentCustomers(agentCrmUserId, { keyword = "" } = {}) {
      const search = `%${keyword}%`;
      const whereParts = [
        "agent.crm_user_id = ?",
        "relationship.status = 'active'",
        ...(keyword ? ["(customer_user.username LIKE ? OR customer_user.email LIKE ?)"] : [])
      ];
      const params = [agentCrmUserId, ...(keyword ? [search, search] : [])];
      const [rows] = await executor.query<DbRow[]>(
        `SELECT COUNT(*) AS total
         FROM crm_agent_relationships relationship
         JOIN crm_agents agent ON relationship.agent_id = agent.id
         JOIN crm_users customer_user ON customer_user.id = relationship.customer_crm_user_id
         WHERE ${whereParts.join(" AND ")}`,
        params
      );
      return numberValue(rows[0]?.total);
    },

  };
}
