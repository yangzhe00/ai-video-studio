import pg from "pg";
import { randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL) throw new Error("Runtime DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
try {
  await client.connect();
  const role = (await client.query("SELECT current_user AS name")).rows[0]?.name;
  if (role !== "ai_video_runtime") throw new Error("Expected ai_video_runtime account");
  const privileges = (await client.query(`SELECT
    has_table_privilege(current_user, 'accounts', 'SELECT') AS can_read,
    has_table_privilege(current_user, 'accounts', 'INSERT') AS can_insert,
    has_table_privilege(current_user, 'accounts', 'UPDATE') AS can_update,
    has_table_privilege(current_user, 'accounts', 'DELETE') AS can_delete,
    has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_temp,
    has_table_privilege(current_user, 'api_schema_version', 'INSERT') AS can_change_version`)).rows[0];
  if (!privileges.can_read || !privileges.can_insert || !privileges.can_update || !privileges.can_delete || privileges.can_change_version || privileges.can_temp) {
    throw new Error("Runtime DML grants do not match expected policy");
  }
  await client.query("SELECT version FROM api_schema_version LIMIT 1");
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), `role-check-${randomUUID()}@example.invalid`, "test-only", Date.now(), 0]);
  } finally { await client.query("ROLLBACK"); }
  for (const sql of ["CREATE TABLE avs_privilege_check (id integer)", "ALTER TABLE accounts ADD COLUMN avs_privilege_check integer", "DROP TABLE accounts"]) {
    await client.query("BEGIN");
    let denied = false;
    try { await client.query(sql); }
    catch (error) { denied = error.code === "42501"; }
    finally { await client.query("ROLLBACK"); }
    if (!denied) throw new Error("Runtime account unexpectedly has DDL permission");
  }
  process.stdout.write("Runtime role: DML allowed, DDL denied\n");
} catch (error) {
  process.stderr.write(`Runtime privilege check failed: ${error.code ?? "policy"}\n`);
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
