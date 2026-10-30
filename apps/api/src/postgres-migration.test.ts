import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDb as createLegacyDb } from "./legacy-sqlite.ts";
import { createDb } from "./db.ts";
import { testDatabaseUrl } from "./test-db.ts";

const execFileAsync = promisify(execFile);
const migration = fileURLToPath(new URL("../scripts/migrate-sqlite-to-postgres.mjs", import.meta.url));
const upgradeCopy = fileURLToPath(new URL("../scripts/upgrade-sqlite-copy.mjs", import.meta.url));
const verifyMigration = fileURLToPath(new URL("../scripts/verify-postgres-migration.mjs", import.meta.url));

describe("SQLite to PostgreSQL import", () => {
  it("preserves IDs and documents, leaves SQLite untouched and refuses replay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-pg-import-"));
    const sqlite = join(dir, "studio.sqlite");
    try {
      const legacy = createLegacyDb(dir);
      legacy.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
        .run("account-import", "import@example.com", "hash", 123, 3);
      const document = { version: 1, episodes: [{ id: "episode-import", title: "旧分集", shots: [],
        timeline: ["asset-import"], timelineClips: [{ id: "clip-import", assetId: "asset-import", inMs: 100, outMs: 900, volume: 0.7 }] }],
        assets: [{ id: "asset-import", kind: "video" }], characters: [], briefs: [] };
      legacy.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run("project-import", "account-import", "旧项目", 7, JSON.stringify(document), 123, 456);
      legacy.close();
      const before = createHash("sha256").update(readFileSync(sqlite)).digest("hex");
      const url = await testDatabaseUrl(dir);
      const result = await execFileAsync(process.execPath, [migration, sqlite], { env: { ...process.env, DATABASE_URL: url } });
      expect(JSON.parse(result.stdout).counts).toMatchObject({ accounts: 1, projects: 1 });
      const expectedPath = join(dir, "expected-counts.json");
      writeFileSync(expectedPath, JSON.stringify(JSON.parse(result.stdout).counts));
      const verified = await execFileAsync(process.execPath, [verifyMigration, expectedPath],
        { env: { ...process.env, DATABASE_URL: url } });
      expect(JSON.parse(verified.stdout)).toMatchObject({ status: "verified", missingObjectFiles: 0 });
      const db = await createDb(url);
      try {
        const row = await db.prepare("SELECT id,revision,document_json FROM projects WHERE id=?").get("project-import");
        expect(row.id).toBe("project-import");
        expect(row.revision).toBe(7);
        expect(JSON.parse(row.document_json)).toEqual(document);
      } finally { await db.close(); }
      await expect(execFileAsync(process.execPath, [migration, sqlite], { env: { ...process.env, DATABASE_URL: url } }))
        .rejects.toThrow();
      expect(createHash("sha256").update(readFileSync(sqlite)).digest("hex")).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("imports a schema 9 backup only after upgrading the copy to schema 10", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-pg-schema-nine-"));
    try {
      const legacy = createLegacyDb(dir);
      legacy.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
        .run("nine-account", "nine-import@example.com", "hash", 1, 3);
      legacy.exec("ALTER TABLE projects DROP COLUMN creation_hash; PRAGMA user_version = 9;");
      legacy.close();
      const sqlite = join(dir, "studio.sqlite");
      const before = createHash("sha256").update(readFileSync(sqlite)).digest("hex");
      const upgraded = join(dir, "upgraded", "studio.sqlite");
      const upgradeResult = await execFileAsync(process.execPath, ["--experimental-transform-types", upgradeCopy,
        "--source", sqlite, "--destination", upgraded]);
      expect(JSON.parse(upgradeResult.stdout)).toMatchObject({ sourceVersion: 9, targetVersion: 10 });
      const upgradedDb = new DatabaseSync(upgraded, { readOnly: true });
      expect(upgradedDb.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "delete" });
      upgradedDb.close();
      const url = await testDatabaseUrl(dir);
      chmodSync(join(dir, "upgraded"), 0o555);
      let imported: { stdout: string };
      try {
        imported = await execFileAsync(process.execPath, [migration, upgraded], { env: { ...process.env, DATABASE_URL: url } });
      } finally { chmodSync(join(dir, "upgraded"), 0o700); }
      expect(JSON.parse(imported.stdout)).toMatchObject({ status: "imported", missingObjectFiles: 0,
        counts: { accounts: 1 } });
      expect(createHash("sha256").update(readFileSync(sqlite)).digest("hex")).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rolls back the target when a legacy row violates a foreign key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-pg-import-invalid-"));
    const sqlite = join(dir, "studio.sqlite");
    try {
      createLegacyDb(dir).close();
      const raw = new DatabaseSync(sqlite);
      raw.exec("PRAGMA foreign_keys = OFF");
      raw.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run("orphan-project", "missing-account", "损坏记录", 1,
          JSON.stringify({ version: 1, episodes: [], assets: [], characters: [], briefs: [] }), 1, 1);
      raw.close();
      const url = await testDatabaseUrl(dir);
      await expect(execFileAsync(process.execPath, [migration, sqlite], { env: { ...process.env, DATABASE_URL: url } }))
        .rejects.toThrow();
      const db = await createDb(url);
      try {
        expect(await db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toMatchObject({ count: 0 });
      } finally { await db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rolls back the target if a referenced object file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-pg-import-missing-object-"));
    const sqlite = join(dir, "studio.sqlite");
    try {
      const legacy = createLegacyDb(dir);
      legacy.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
        .run("account-missing", "missing@example.com", "hash", 1, 3);
      legacy.prepare("INSERT INTO objects(id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run("object-missing", "account-missing", "missing-sha", "image/png", 1, join(dir, "absent.png"), 1);
      legacy.close();
      const url = await testDatabaseUrl(dir);
      await expect(execFileAsync(process.execPath, [migration, sqlite], { env: { ...process.env, DATABASE_URL: url } }))
        .rejects.toThrow();
      const db = await createDb(url);
      try {
        expect(await db.prepare("SELECT COUNT(*) AS count FROM accounts").get()).toMatchObject({ count: 0 });
        expect(await db.prepare("SELECT COUNT(*) AS count FROM objects").get()).toMatchObject({ count: 0 });
      } finally { await db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
