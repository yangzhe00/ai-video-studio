import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const passwordFile = process.env.API_RUNTIME_PASSWORD_FILE;
if (!databaseUrl || !passwordFile) throw new Error("Migration DATABASE_URL and API_RUNTIME_PASSWORD_FILE are required");
const password = (await readFile(passwordFile, "utf8")).trimEnd();
if (password.length < 32) throw new Error("Runtime database password must contain at least 32 characters");
const quotedPassword = password.replaceAll("'", "''");
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
try {
  await client.connect();
  await client.query("BEGIN");
  const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname='ai_video_runtime'")).rowCount !== 0;
  if (exists) await client.query(`ALTER ROLE ai_video_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${quotedPassword}'`);
  else await client.query(`CREATE ROLE ai_video_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${quotedPassword}'`);
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query("REVOKE TEMP ON DATABASE ai_video_studio FROM PUBLIC");
  await client.query("REVOKE CONNECT ON DATABASE ai_video_studio FROM PUBLIC");
  await client.query("GRANT CONNECT ON DATABASE ai_video_studio TO ai_video_runtime");
  await client.query("GRANT USAGE ON SCHEMA public TO ai_video_runtime");
  await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ai_video_runtime");
  await client.query("REVOKE INSERT, UPDATE, DELETE ON api_schema_version FROM ai_video_runtime");
  await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ai_video_runtime");
  await client.query("COMMIT");
  process.stdout.write("Runtime database role provisioned with DML privileges\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  process.stderr.write(`Runtime role provisioning failed: ${error.code ?? "unknown"}\n`);
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
