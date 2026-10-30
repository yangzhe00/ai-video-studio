import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const tables = [
  "accounts", "sessions", "projects", "objects", "agent_runs", "run_events",
  "operations", "resource_revisions", "project_commands", "video_edits",
  "edit_commands", "render_operations", "render_events", "prompt_idea_sets",
];

const sqlitePath = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!sqlitePath || !databaseUrl) {
  process.stderr.write("Usage: DATABASE_URL=... node apps/api/scripts/migrate-sqlite-to-postgres.mjs /absolute/path/studio.sqlite\n");
  process.exit(2);
}

let source;
const client = new pg.Client({ connectionString: databaseUrl });
let begun = false;
try {
  source = new DatabaseSync(resolve(sqlitePath), { readOnly: true });
  const version = source.prepare("PRAGMA user_version").get().user_version;
  if (version !== 10) throw new Error(`SQLite schema version ${version}; first upgrade a copy with the previous API to version 10`);
  await client.connect();
  await client.query("BEGIN");
  begun = true;
  await client.query(await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"));
  const currentVersion = await client.query("SELECT version FROM api_schema_version LIMIT 1");
  if (currentVersion.rows.length && ![1, 2, 3].includes(Number(currentVersion.rows[0].version))) {
    throw new Error("Target PostgreSQL schema version is unsupported");
  }
  for (const table of tables) {
    const count = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
    if (Number(count.rows[0].count) !== 0) throw new Error(`Target is not empty: ${table}`);
  }
  const counts = {};
  let missingObjectFiles = 0;
  for (const table of tables) {
    const expected = source.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const columns = source.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    for (const row of source.prepare(`SELECT * FROM ${table}`).iterate()) {
      if (table === "objects" && !existsSync(row.path)) missingObjectFiles++;
      const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`;
      await client.query(sql, columns.map(column => row[column]));
    }
    const imported = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
    if (Number(imported.rows[0].count) !== expected) throw new Error(`Count mismatch: ${table}`);
    counts[table] = expected;
  }
  if (missingObjectFiles !== 0) throw new Error(`Missing ${missingObjectFiles} object files; target import rolled back`);
  await client.query(await readFile(new URL("../src/schema-v2.sql", import.meta.url), "utf8"));
  await client.query(await readFile(new URL("../src/schema-v3.sql", import.meta.url), "utf8"));
  for (const table of ["tts_tasks", "episode_render_operations", "agent_edit_sets", "preview_operations", "preview_owned_objects"]) {
    const count = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
    if (Number(count.rows[0].count) !== 0) throw new Error(`Target is not empty: ${table}`);
  }
  if (!currentVersion.rows.length) await client.query("INSERT INTO api_schema_version (version) VALUES (3)");
  else await client.query("UPDATE api_schema_version SET version=3");
  await client.query("COMMIT");
  begun = false;
  process.stdout.write(JSON.stringify({ status: "imported", sqliteVersion: version, counts, missingObjectFiles }) + "\n");
} catch (error) {
  if (begun) await client.query("ROLLBACK");
  process.stderr.write(`Import failed; target transaction rolled back: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  source?.close();
  await client.end().catch(() => {});
}
