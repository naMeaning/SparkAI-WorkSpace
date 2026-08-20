import { createConnection, createPool } from "mysql2/promise";
import type { CrmConfig } from "../types.js";

function escapeIdentifier(identifier: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`invalid MySQL identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function buildServerUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/";
  url.search = "";
  return url.toString();
}

export function buildDatabaseUrl(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export interface CrmMigration {
  name: string;
  statements: string[];
}

function getInitialSchemaStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS crm_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      email VARCHAR(128) NOT NULL DEFAULT '',
      new_api_user_id INT NOT NULL,
      new_api_role INT NOT NULL DEFAULT 1,
      first_topup_discount_rate DECIMAL(6,4) NULL,
      first_topup_discount_used_at TIMESTAMP NULL,
      signup_trial_grant_status VARCHAR(32) NOT NULL DEFAULT 'granted',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_users_username (username),
      UNIQUE KEY uq_crm_users_new_api_user (new_api_user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_user_profiles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      crm_user_id BIGINT UNSIGNED NOT NULL,
      phone VARCHAR(64) NOT NULL DEFAULT '',
      wechat VARCHAR(128) NOT NULL DEFAULT '',
      remark VARCHAR(1000) NOT NULL DEFAULT '',
      cumulative_paid_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      is_enterprise TINYINT(1) NOT NULL DEFAULT 0,
      enterprise_price_rmb DECIMAL(10,4) NULL,
      enterprise_fixed_commission_per_image DECIMAL(10,4) NULL,
      is_risk TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_profiles_crm_user (crm_user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_agents (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      crm_user_id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      category VARCHAR(32) NOT NULL DEFAULT 'normal',
      invite_code VARCHAR(64) NOT NULL,
      parent_agent_id BIGINT UNSIGNED NULL,
      level VARCHAR(32) NOT NULL DEFAULT 'standard',
      level_effective_at TIMESTAMP NULL,
      level_expires_at TIMESTAMP NULL,
      last_level_evaluated_at TIMESTAMP NULL,
      effective_paid_customer_count INT NOT NULL DEFAULT 0,
      created_by_crm_user_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_agents_crm_user (crm_user_id),
      UNIQUE KEY uq_agents_invite_code (invite_code),
      KEY idx_agents_parent (parent_agent_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_agent_relationships (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      customer_crm_user_id BIGINT UNSIGNED NOT NULL,
      agent_id BIGINT UNSIGNED NOT NULL,
      bind_source VARCHAR(64) NOT NULL,
      bind_reason VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      updated_by_crm_user_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_agent_relationship_customer (customer_crm_user_id),
      KEY idx_agent_relationship_agent (agent_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_account_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(64) NOT NULL,
      crm_user_id BIGINT UNSIGNED NOT NULL,
      operator_crm_user_id BIGINT UNSIGNED NULL,
      amount_rmb DECIMAL(12,2) NOT NULL,
      paid_amount_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      discount_amount_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      commission_base_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      quota_delta BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      idempotency_key VARCHAR(128) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      new_api_result JSON NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      UNIQUE KEY uq_account_events_idempotency (idempotency_key),
      KEY idx_account_events_user_created (crm_user_id, created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_ledger_entries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      crm_user_id BIGINT UNSIGNED NOT NULL,
      direction VARCHAR(16) NOT NULL,
      amount_rmb DECIMAL(12,2) NOT NULL,
      paid_amount_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      discount_amount_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      commission_base_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      balance_after_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      event_type VARCHAR(64) NOT NULL,
      source_type VARCHAR(64) NOT NULL,
      source_id BIGINT UNSIGNED NULL,
      idempotency_key VARCHAR(128) NOT NULL,
      operator_crm_user_id BIGINT UNSIGNED NULL,
      reason VARCHAR(500) NOT NULL DEFAULT '',
      is_paid TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ledger_idempotency (idempotency_key),
      KEY idx_ledger_user_created (crm_user_id, created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_commissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(64) NOT NULL,
      source_id BIGINT UNSIGNED NOT NULL,
      beneficiary_crm_user_id BIGINT UNSIGNED NOT NULL,
      customer_crm_user_id BIGINT UNSIGNED NOT NULL,
      commission_type VARCHAR(64) NOT NULL,
      order_kind VARCHAR(32) NOT NULL,
      agent_level VARCHAR(32) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'frozen',
      base_amount_rmb DECIMAL(12,2) NOT NULL,
      rate DECIMAL(8,6) NOT NULL,
      commission_amount_rmb DECIMAL(12,2) NOT NULL,
      released_amount_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      risk_case_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_commissions_beneficiary_status (beneficiary_crm_user_id, status),
      KEY idx_commissions_source (source_type, source_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_effective_customers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      agent_id BIGINT UNSIGNED NOT NULL,
      customer_crm_user_id BIGINT UNSIGNED NOT NULL,
      first_paid_event_id BIGINT UNSIGNED NOT NULL,
      first_paid_amount_rmb DECIMAL(12,2) NOT NULL,
      first_paid_at TIMESTAMP NOT NULL,
      seven_day_checked_at TIMESTAMP NULL,
      paid_balance_consumed_rate DECIMAL(8,6) NOT NULL DEFAULT 0.000000,
      is_refunded TINYINT(1) NOT NULL DEFAULT 0,
      is_related_account TINYINT(1) NOT NULL DEFAULT 0,
      is_risk TINYINT(1) NOT NULL DEFAULT 0,
      is_effective TINYINT(1) NOT NULL DEFAULT 0,
      counted_for_level TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_effective_customer_agent_customer (agent_id, customer_crm_user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_withdrawals (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      beneficiary_crm_user_id BIGINT UNSIGNED NOT NULL,
      amount_rmb DECIMAL(12,2) NOT NULL,
      payout_method VARCHAR(32) NOT NULL DEFAULT '',
      payout_account_name VARCHAR(128) NOT NULL DEFAULT '',
      payout_account VARCHAR(256) NOT NULL DEFAULT '',
      payout_bank_name VARCHAR(128) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      reviewer_crm_user_id BIGINT UNSIGNED NULL,
      review_reason VARCHAR(500) NOT NULL DEFAULT '',
      paid_reference VARCHAR(256) NOT NULL DEFAULT '',
      paid_evidence_url VARCHAR(500) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL,
      paid_at TIMESTAMP NULL,
      KEY idx_withdrawals_user_status (beneficiary_crm_user_id, status)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_enterprise_monthly_settlements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      crm_user_id BIGINT UNSIGNED NOT NULL,
      period CHAR(7) NOT NULL,
      usage_rmb DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      ledger_entry_count INT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      paid_reference VARCHAR(256) NOT NULL DEFAULT '',
      paid_evidence_url VARCHAR(500) NOT NULL DEFAULT '',
      notes VARCHAR(1000) NOT NULL DEFAULT '',
      generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_enterprise_monthly_user_period (crm_user_id, period),
      KEY idx_enterprise_monthly_period_status (period, status)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_offline_recharge_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      crm_user_id BIGINT UNSIGNED NOT NULL,
      method VARCHAR(32) NOT NULL,
      amount_rmb DECIMAL(12,2) NOT NULL,
      payer_name VARCHAR(128) NOT NULL DEFAULT '',
      payment_reference VARCHAR(256) NOT NULL,
      payment_evidence_url VARCHAR(500) NOT NULL DEFAULT '',
      notes VARCHAR(1000) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      reviewer_crm_user_id BIGINT UNSIGNED NULL,
      review_reason VARCHAR(500) NOT NULL DEFAULT '',
      account_event_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL,
      KEY idx_offline_recharge_user_status (crm_user_id, status),
      KEY idx_offline_recharge_status_created (status, created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_risk_cases (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      target_type VARCHAR(64) NOT NULL,
      target_id VARCHAR(128) NOT NULL,
      risk_type VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      evidence_json JSON NULL,
      notes VARCHAR(1000) NOT NULL DEFAULT '',
      blocks_withdrawal TINYINT(1) NOT NULL DEFAULT 0,
      blocks_commission_release TINYINT(1) NOT NULL DEFAULT 0,
      created_by_crm_user_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_risk_cases_target (target_type, target_id),
      KEY idx_risk_cases_status (status)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      operator_crm_user_id BIGINT UNSIGNED NOT NULL,
      target_type VARCHAR(64) NOT NULL,
      target_id VARCHAR(128) NOT NULL,
      action VARCHAR(128) NOT NULL,
      reason VARCHAR(500) NOT NULL DEFAULT '',
      before_snapshot JSON NULL,
      after_snapshot JSON NULL,
      request_ip VARCHAR(64) NOT NULL DEFAULT '',
      user_agent VARCHAR(500) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_audit_operator_created (operator_crm_user_id, created_at),
      KEY idx_audit_target_created (target_type, target_id, created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS crm_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(128) NOT NULL,
      setting_value JSON NOT NULL,
      updated_by_crm_user_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_settings_key (setting_key)
    )`
  ];
}

function conditionalColumnStatement({
  table,
  column,
  whenMissing,
  sql
}: {
  table: string;
  column: string;
  whenMissing: boolean;
  sql: string;
}): string[] {
  const escapedSql = sql.replaceAll("'", "''");
  const comparison = whenMissing ? "= 0" : "> 0";
  return [
    `SET @iiimage_column_count = (
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = '${table}'
        AND column_name = '${column}'
    )`,
    `SET @iiimage_migration_sql = IF(@iiimage_column_count ${comparison}, '${escapedSql}', 'SELECT 1')`,
    "PREPARE iiimage_migration_stmt FROM @iiimage_migration_sql",
    "EXECUTE iiimage_migration_stmt",
    "DEALLOCATE PREPARE iiimage_migration_stmt"
  ];
}

export function getCrmMigrations(): CrmMigration[] {
  return [
    {
      name: "001_initial_crm_schema",
      statements: getInitialSchemaStatements()
    },
    {
      name: "002_withdrawal_commission_allocations",
      statements: [
        `CREATE TABLE IF NOT EXISTS crm_withdrawal_commission_allocations (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          withdrawal_id BIGINT UNSIGNED NOT NULL,
          commission_id BIGINT UNSIGNED NOT NULL,
          amount_rmb DECIMAL(12,2) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_withdrawal_commission (withdrawal_id, commission_id),
          KEY idx_withdrawal_allocations_commission (commission_id)
        )`
      ]
    },
    {
      name: "003_unify_new_api_identity",
      statements: [
        ...conditionalColumnStatement({
          table: "crm_users",
          column: "new_api_role",
          whenMissing: true,
          sql: "ALTER TABLE crm_users ADD COLUMN new_api_role INT NOT NULL DEFAULT 1 AFTER new_api_user_id"
        }),
        "ALTER TABLE crm_users MODIFY COLUMN new_api_user_id INT NOT NULL",
        ...conditionalColumnStatement({
          table: "crm_users",
          column: "password_hash",
          whenMissing: false,
          sql: "ALTER TABLE crm_users DROP COLUMN password_hash"
        }),
        ...conditionalColumnStatement({
          table: "crm_users",
          column: "provider_relay_token",
          whenMissing: false,
          sql: "ALTER TABLE crm_users DROP COLUMN provider_relay_token"
        }),
        ...conditionalColumnStatement({
          table: "crm_users",
          column: "status",
          whenMissing: false,
          sql: "ALTER TABLE crm_users DROP COLUMN status"
        })
      ]
    }
  ];
}

export function getMigrationStatements(): string[] {
  return getCrmMigrations().flatMap((migration) => migration.statements);
}

export async function ensureDatabase(config: CrmConfig): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error("CRM_DATABASE_URL is required to create the CRM database");
  }
  const databaseName = escapeIdentifier(config.databaseName);
  const connection = await createConnection(buildServerUrl(config.databaseUrl));
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${databaseName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

export async function runMigrations(config: CrmConfig): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error("CRM_DATABASE_URL is required to run migrations");
  }
  await ensureDatabase(config);
  const pool = createPool(buildDatabaseUrl(config.databaseUrl, config.databaseName));
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS crm_schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(128) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_crm_schema_migration_name (migration_name)
      )`
    );
    const [rows] = await pool.query("SELECT migration_name FROM crm_schema_migrations");
    const applied = new Set(
      (rows as Array<{ migration_name: string }>).map((row) => String(row.migration_name))
    );
    for (const migration of getCrmMigrations()) {
      if (applied.has(migration.name)) continue;
      const connection = await pool.getConnection();
      try {
        for (const statement of migration.statements) {
          await connection.query(statement);
        }
        await connection.query(
          "INSERT INTO crm_schema_migrations (migration_name) VALUES (?)",
          [migration.name]
        );
      } finally {
        connection.release();
      }
    }
  } finally {
    await pool.end();
  }
}
