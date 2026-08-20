import { createPool } from "mysql2/promise";
import type { CrmConfig, CrmRepository } from "../types.js";
import { buildDatabaseUrl } from "./migrations.js";
import { createAccountEventRepositoryMethods } from "./mysql-repository-account-events.js";
import { createAgentRepositoryMethods } from "./mysql-repository-agents.js";
import { createCommissionRepositoryMethods } from "./mysql-repository-commissions.js";
import { createEnterpriseSettlementRepositoryMethods } from "./mysql-repository-enterprise-settlements.js";
import { createGovernanceRepositoryMethods } from "./mysql-repository-governance.js";
import { createLedgerAuditRepositoryMethods } from "./mysql-repository-ledger-audit.js";
import { createOfflineRechargeRepositoryMethods } from "./mysql-repository-offline-recharges.js";
import { createUserRepositoryMethods } from "./mysql-repository-users.js";
import { createWithdrawalRepositoryMethods } from "./mysql-repository-withdrawals.js";
import type {
  MysqlQueryExecutor,
  MysqlRepositoryExecutorOptions
} from "./mysql-support.js";

export { buildBusinessUserScope } from "./mysql-business-scope.js";

export function createMysqlRepositoryForExecutor(
  executor: MysqlQueryExecutor,
  options: MysqlRepositoryExecutorOptions = {}
): CrmRepository {
  let repository: CrmRepository;
  const context = { executor, options };
  repository = {
    async close() {
      await options.close?.();
    },

    async withTransaction(work) {
      if (options.transactional) return work(repository);
      if (!options.withTransaction) {
        throw new Error("CRM repository transaction support is not configured");
      }
      return options.withTransaction(work);
    },

    ...createUserRepositoryMethods(context),
    ...createAccountEventRepositoryMethods(context),
    ...createLedgerAuditRepositoryMethods(context),
    ...createAgentRepositoryMethods(context),
    ...createCommissionRepositoryMethods(context),
    ...createWithdrawalRepositoryMethods(context),
    ...createEnterpriseSettlementRepositoryMethods(context),
    ...createOfflineRechargeRepositoryMethods(context),
    ...createGovernanceRepositoryMethods(context)
  } as CrmRepository;
  return repository;
}

export function createMysqlRepository(config: CrmConfig): CrmRepository {
  const pool = createPool(buildDatabaseUrl(config.databaseUrl, config.databaseName));
  return createMysqlRepositoryForExecutor(pool, {
    close: () => pool.end(),
    withTransaction: async (work) => {
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      const transactionRepository = createMysqlRepositoryForExecutor(connection, {
        transactional: true
      });
      try {
        const result = await work(transactionRepository);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  });
}

export function createRepository(config: CrmConfig): CrmRepository {
  if (!config.databaseUrl) {
    throw new Error("CRM_DATABASE_URL is required for durable CRM persistence");
  }
  return createMysqlRepository(config);
}
