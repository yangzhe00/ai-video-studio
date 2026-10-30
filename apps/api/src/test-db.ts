import { createHash } from "node:crypto";
import { Client } from "pg";
import { afterAll } from "vitest";
import { createDb, migrateSchema } from "./db.ts";

const usedKeys = new Set<string>();
const preparedKeys = new Set<string>();
afterAll(async () => {
  for (const key of usedKeys) await dropTestSchema(key);
});

function schemaName(key: string): string {
  return "avs_test_" + createHash("sha256").update(key).digest("hex").slice(0, 20);
}

export async function testDatabaseUrl(key: string, migrate = true): Promise<string> {
  usedKeys.add(key);
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is required for PostgreSQL API tests");
  const schema = schemaName(key);
  const admin = new Client({ connectionString: base });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally { await admin.end(); }
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  if (migrate && !preparedKeys.has(key)) {
    await migrateSchema(url.toString());
    preparedKeys.add(key);
  }
  return url.toString();
}

export async function createTestDb(key: string) {
  return createDb(await testDatabaseUrl(key));
}

export async function dropTestSchema(key: string): Promise<void> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return;
  const admin = new Client({ connectionString: base });
  try {
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName(key)} CASCADE`);
  } finally { await admin.end(); }
}
