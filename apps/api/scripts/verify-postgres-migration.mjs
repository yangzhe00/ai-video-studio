import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const expectedPath = process.argv[2];
if (!expectedPath || !process.env.DATABASE_URL) {
  process.stderr.write("Usage: DATABASE_URL=... node verify-postgres-migration.mjs /backup/source-counts.json\n");
  process.exit(2);
}
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const version = await client.query("SELECT version FROM api_schema_version LIMIT 1");
  if (Number(version.rows[0]?.version) !== 3) throw new Error("PostgreSQL schema version must be 3");
  for (const table of ["tts_tasks", "episode_render_operations", "agent_edit_sets", "preview_operations", "preview_owned_objects"]) {
    const present = await client.query("SELECT to_regclass($1) AS name", [table]);
    if (!present.rows[0]?.name) throw new Error(`Missing PostgreSQL table: ${table}`);
  }
  const counts = {};
  for (const [table, expectedCount] of Object.entries(expected)) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`Invalid table name in expected counts: ${table}`);
    const result = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(result.rows[0].count);
    if (counts[table] !== expectedCount) throw new Error(`PostgreSQL count mismatch: ${table}`);
  }
  const objects = await client.query("SELECT path FROM objects");
  const missingObjectFiles = objects.rows.filter(row => !existsSync(row.path)).length;
  if (missingObjectFiles !== 0) throw new Error(`Missing ${missingObjectFiles} object files`);
  await client.query("COMMIT");
  process.stdout.write(JSON.stringify({ status: "verified", counts, missingObjectFiles }) + "\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  process.stderr.write(`PostgreSQL verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
