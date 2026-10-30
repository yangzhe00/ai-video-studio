import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { Pool, types } from "pg";
import type { PoolClient, QueryResultRow } from "pg";

types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("PostgreSQL bigint exceeds JavaScript safe integer range");
  return number;
});

export function parameters(sql: string): string {
  let index = 0;
  let result = "", quote: "'" | '"' | null = null;
  let lineComment = false, blockDepth = 0, dollarTag: string | null = null;
  const keyword = new Set(["SELECT", "WHERE", "AND", "OR", "LIKE", "ILIKE", "IN", "VALUES", "SET", "LIMIT", "OFFSET", "RETURNING", "ON", "BY", "AS"]);
  for (let position = 0; position < sql.length; position++) {
    const char = sql[position];
    if (lineComment) { result += char; if (char === "\n") lineComment = false; continue; }
    if (blockDepth > 0) {
      if (sql.startsWith("/*", position)) { blockDepth++; result += "/*"; position++; continue; }
      if (sql.startsWith("*/", position)) { blockDepth--; result += "*/"; position++; continue; }
      result += char; continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, position)) { result += dollarTag; position += dollarTag.length - 1; dollarTag = null; }
      else result += char;
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote) {
        if (sql[position + 1] === quote) result += sql[++position];
        else quote = null;
      }
      continue;
    }
    if (sql.startsWith("--", position)) { lineComment = true; result += "--"; position++; continue; }
    if (sql.startsWith("/*", position)) { blockDepth = 1; result += "/*"; position++; continue; }
    const tag = char === "$" ? /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(position))?.[0] : undefined;
    if (tag) { dollarTag = tag; result += tag; position += tag.length - 1; continue; }
    if (char === "'" || char === '"') { quote = char; result += char; continue; }
    if (char === "?" && (sql[position + 1] === "|" || sql[position + 1] === "&")) { result += char; continue; }
    const before = sql.slice(0, position).trimEnd();
    const previousWord = /[A-Za-z_][\w]*$/.exec(before)?.[0]?.toUpperCase();
    const next = sql.slice(position + 1).trimStart()[0];
    if (char === "?" && /[\w)\]"]/.test(before.slice(-1)) && !keyword.has(previousWord ?? "") &&
      (next === "'" || next === '"' || next === "?" || /[\w$]/.test(next ?? ""))) { result += char; continue; }
    result += char === "?" ? `$${++index}` : char;
  }
  return result;
}

export class PgDatabase {
  private readonly current = new AsyncLocalStorage<PoolClient>();
  constructor(readonly pool: Pool) {}

  private async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
    const client = this.current.getStore();
    return (client ?? this.pool).query<T>(parameters(sql), values);
  }

  prepare(sql: string) {
    return {
      get: async (...values: unknown[]): Promise<any> => (await this.query(sql, values)).rows[0],
      all: async (...values: unknown[]): Promise<any[]> => (await this.query(sql, values)).rows,
      run: async (...values: unknown[]): Promise<{ changes: number }> => {
        const result = await this.query(sql, values);
        return { changes: result.rowCount ?? 0 };
      },
    };
  }

  async exec(sql: string): Promise<void> { await this.query(sql); }

  async transaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.current.getStore()) return action();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.current.run(client, action);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async lock(key: string): Promise<void> {
    if (!this.current.getStore()) throw new Error("Advisory lock requires a transaction");
    await this.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(key);
  }

  async close(): Promise<void> { await this.pool.end(); }
}

function pool(databaseUrl: string): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000, statement_timeout: 30_000, lock_timeout: 5_000 });
}

export async function migrateSchema(databaseUrl: string): Promise<void> {
  const db = new PgDatabase(pool(databaseUrl));
  try {
    await db.transaction(async () => {
      await db.lock("ai-video-schema-v1");
      await db.exec(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
      const row = await db.prepare("SELECT version FROM api_schema_version LIMIT 1").get() as { version: number } | undefined;
      if (row && ![1, 2, 3].includes(row.version)) throw new Error(`Unsupported PostgreSQL schema version ${row.version}`);
      if (!row) await db.prepare("INSERT INTO api_schema_version (version) VALUES (1)").run();
      await db.exec(await readFile(new URL("./schema-v2.sql", import.meta.url), "utf8"));
      await db.exec(await readFile(new URL("./schema-v3.sql", import.meta.url), "utf8"));
      await db.prepare("UPDATE api_schema_version SET version=3").run();
    });
  } finally { await db.close(); }
}

export async function createDb(databaseUrl: string): Promise<PgDatabase> {
  const db = new PgDatabase(pool(databaseUrl));
  try {
    const row = await db.prepare("SELECT version FROM api_schema_version LIMIT 1").get() as { version: number } | undefined;
    if (!row || row.version !== 3) throw new Error("Unsupported or missing PostgreSQL schema version");
    return db;
  } catch (error) { await db.close(); throw error; }
}
