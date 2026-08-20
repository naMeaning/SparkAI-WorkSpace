import test from "node:test";
import assert from "node:assert/strict";
import { buildDatabaseUrl, getCrmMigrations, getMigrationStatements } from "./migrations.js";

test("getCrmMigrations defines ordered repeatable CRM schema versions", () => {
  const migrations = getCrmMigrations();

  assert.deepEqual(
    migrations.map((migration) => migration.name),
    [
      "001_initial_crm_schema",
      "002_withdrawal_commission_allocations",
      "003_unify_new_api_identity"
    ]
  );
  assert.match(
    migrations[1]?.statements.join("\n") || "",
    /CREATE TABLE IF NOT EXISTS crm_withdrawal_commission_allocations/
  );
  assert.match(
    migrations[1]?.statements.join("\n") || "",
    /UNIQUE KEY uq_withdrawal_commission \(withdrawal_id, commission_id\)/
  );
  const identityMigration = migrations[2]?.statements.join("\n") || "";
  assert.match(identityMigration, /ADD COLUMN new_api_role INT NOT NULL DEFAULT 1/);
  assert.match(identityMigration, /MODIFY COLUMN new_api_user_id INT NOT NULL/);
  assert.match(identityMigration, /DROP COLUMN password_hash/);
  assert.match(identityMigration, /DROP COLUMN provider_relay_token/);
});

test("getMigrationStatements creates the non-payment CRM tables", () => {
  const sql = getMigrationStatements().join("\n");

  for (const table of [
    "crm_users",
    "crm_user_profiles",
    "crm_agents",
    "crm_agent_relationships",
    "crm_account_events",
    "crm_ledger_entries",
    "crm_commissions",
    "crm_effective_customers",
    "crm_withdrawals",
    "crm_withdrawal_commission_allocations",
    "crm_offline_recharge_requests",
    "crm_risk_cases",
    "crm_audit_logs",
    "crm_settings"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(sql, /parent_agent_id BIGINT UNSIGNED NULL/);
  assert.match(sql, /crm_user_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /customer_crm_user_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /beneficiary_crm_user_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /operator_crm_user_id BIGINT UNSIGNED NULL/);
  assert.match(sql, /new_api_user_id INT NOT NULL/);
  assert.match(sql, /new_api_role INT NOT NULL DEFAULT 1/);
  assert.match(sql, /first_topup_discount_rate DECIMAL\(6,4\) NULL/);
  assert.match(sql, /signup_trial_grant_status VARCHAR\(32\) NOT NULL DEFAULT 'granted'/);
  assert.match(sql, /paid_amount_rmb DECIMAL\(12,2\) NOT NULL DEFAULT 0.00/);
  assert.match(sql, /category VARCHAR\(32\) NOT NULL DEFAULT 'normal'/);
  assert.match(sql, /level VARCHAR\(32\) NOT NULL DEFAULT 'standard'/);
  assert.match(sql, /commission_type VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /order_kind VARCHAR\(32\) NOT NULL/);
  assert.match(sql, /blocks_withdrawal TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(sql, /payment_reference VARCHAR\(256\) NOT NULL/);
  assert.match(sql, /payment_evidence_url VARCHAR\(500\) NOT NULL DEFAULT ''/);
  assert.match(sql, /paid_evidence_url VARCHAR\(500\) NOT NULL DEFAULT ''/);
  assert.match(sql, /account_event_id BIGINT UNSIGNED NULL/);
});

test("getMigrationStatements stores New API identity only on crm_users", () => {
  const statements = getMigrationStatements();
  const crmUsersStatement = statements.find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS crm_users"));
  const sql = statements.join("\n");

  assert.ok(crmUsersStatement);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS crm_users \([\s\S]*new_api_user_id INT NOT NULL/);
  assert.match(sql, /crm_user_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /customer_crm_user_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /beneficiary_crm_user_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /operator_crm_user_id BIGINT UNSIGNED NULL/);
});

test("initial schema stays clean while the explicit production upgrade removes legacy identity columns", () => {
  const migrations = getCrmMigrations();
  const initialSql = migrations[0]?.statements.join("\n") || "";
  const upgradeSql = migrations[2]?.statements.join("\n") || "";

  assert.equal(initialSql.includes("password_hash"), false);
  assert.equal(initialSql.includes("provider_relay_token"), false);
  assert.equal(initialSql.includes("crm_banned"), false);
  assert.match(upgradeSql, /DROP COLUMN password_hash/);
  assert.match(upgradeSql, /DROP COLUMN provider_relay_token/);
});

test("buildDatabaseUrl forces migrations to run against CRM_DATABASE_NAME", () => {
  assert.equal(
    buildDatabaseUrl("mysql://root@127.0.0.1:3306/other_db", "ai_native_crm"),
    "mysql://root@127.0.0.1:3306/ai_native_crm"
  );
  assert.equal(
    buildDatabaseUrl("mysql://root@127.0.0.1:3306", "ai_native_crm"),
    "mysql://root@127.0.0.1:3306/ai_native_crm"
  );
});
