import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS activation_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    plan TEXT NOT NULL,
    valid_days INTEGER NOT NULL,
    max_activations INTEGER NOT NULL,
    activation_count INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL,
    expired_time INTEGER NOT NULL DEFAULT 0,
    created_time INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activation_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id INTEGER NOT NULL REFERENCES activation_codes(id),
    device_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL,
    status INTEGER NOT NULL,
    activated_time INTEGER NOT NULL,
    last_verified_time INTEGER NOT NULL,
    expires_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE(code_id, device_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_activation_grants_device ON activation_grants(device_hash, status);
  CREATE INDEX IF NOT EXISTS idx_activation_grants_code ON activation_grants(code_id, status);

  CREATE TABLE IF NOT EXISTS image_tasks (
    id TEXT PRIMARY KEY,
    owner_hash TEXT NOT NULL,
    idempotency_hash TEXT,
    status TEXT NOT NULL,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_image_tasks_idempotency
    ON image_tasks(owner_hash, idempotency_hash)
    WHERE idempotency_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_image_tasks_updated ON image_tasks(updated_at);
`;

export function openDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(SCHEMA);
  return database;
}

export function withImmediateTransaction(database, action) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original transactional error.
    }
    throw error;
  }
}
