import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "studio.sqlite"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, demo_quota INTEGER NOT NULL, demo_reserved INTEGER NOT NULL DEFAULT 0,
      demo_used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, document_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(owner_id, sha256)
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      episode_id TEXT NOT NULL, source_object_id TEXT NOT NULL REFERENCES objects(id),
      prompt TEXT NOT NULL, duration_sec INTEGER NOT NULL, plan_json TEXT NOT NULL,
      plan_hash TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, UNIQUE(owner_id, client_request_id)
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
      result_json TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
      approval_id TEXT NOT NULL, state TEXT NOT NULL, external_task_id TEXT NOT NULL UNIQUE,
      remote_task_id TEXT, submitted_at INTEGER, created_at INTEGER NOT NULL
    );
  `);
  return db;
}
