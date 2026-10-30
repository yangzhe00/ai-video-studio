import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDb as createLegacyDb } from "../src/legacy-sqlite.ts";

const execFileAsync = promisify(execFile);
const command = fileURLToPath(new URL("./upgrade-sqlite-copy.mjs", import.meta.url));

function schemaNineFixture(dir: string): string {
  const db = createLegacyDb(dir);
  db.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run("owner-nine", "nine@example.com", "hash", 1, 3);
  db.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("project-nine", "owner-nine", "旧项目", 1, JSON.stringify({ version: 1, episodes: [], assets: [], characters: [] }), 1, 1);
  db.exec("ALTER TABLE projects DROP COLUMN creation_hash; PRAGMA user_version = 9;");
  db.close();
  return join(dir, "studio.sqlite");
}

describe("upgrade-sqlite-copy", () => {
  it("backups a schema 9 database, upgrades only the destination and preserves source bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-sqlite-copy-"));
    try {
      const source = schemaNineFixture(dir);
      const sourceHash = createHash("sha256").update(readFileSync(source)).digest("hex");
      const destination = join(dir, "upgraded");
      const result = await execFileAsync(process.execPath, ["--experimental-transform-types", command,
        "--source", source, "--destination", join(destination, "studio.sqlite")]);
      expect(JSON.parse(result.stdout)).toMatchObject({ sourceVersion: 9, targetVersion: 10,
        counts: { accounts: 1, projects: 1 } });
      const upgraded = new DatabaseSync(join(destination, "studio.sqlite"), { readOnly: true });
      try {
        expect(upgraded.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 10 });
        expect(upgraded.prepare("PRAGMA table_info(projects)").all().some(row => row.name === "creation_hash")).toBe(true);
        expect(upgraded.prepare("SELECT COUNT(*) AS n FROM projects").get()).toMatchObject({ n: 1 });
      } finally { upgraded.close(); }
      expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(sourceHash);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses an existing destination without changing either database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-sqlite-copy-existing-"));
    try {
      const source = schemaNineFixture(dir);
      const destination = join(dir, "already");
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(destination);
      writeFileSync(join(destination, "sentinel"), "keep");
      const before = createHash("sha256").update(readFileSync(source)).digest("hex");
      await expect(execFileAsync(process.execPath, ["--experimental-transform-types", command,
        "--source", source, "--destination", join(destination, "studio.sqlite")])).rejects.toThrow();
      expect(readFileSync(join(destination, "sentinel"), "utf8")).toBe("keep");
      expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects an unsupported schema without publishing an output directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-sqlite-copy-invalid-"));
    try {
      const source = schemaNineFixture(dir);
      const raw = new DatabaseSync(source);
      raw.exec("PRAGMA user_version = 8");
      raw.close();
      const destination = join(dir, "upgraded");
      await expect(execFileAsync(process.execPath, ["--experimental-transform-types", command,
        "--source", source, "--destination", join(destination, "studio.sqlite")])).rejects.toThrow();
      expect(existsSync(destination)).toBe(false);
      const check = new DatabaseSync(source, { readOnly: true });
      try { expect(check.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 8 }); }
      finally { check.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("includes committed WAL rows in the backup copy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-sqlite-copy-wal-"));
    try {
      const source = schemaNineFixture(dir);
      const writer = new DatabaseSync(source);
      try {
        writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
        writer.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
          .run("wal-account", "wal@example.com", "hash", 2, 3);
        const destination = join(dir, "upgraded", "studio.sqlite");
        const result = await execFileAsync(process.execPath, ["--experimental-transform-types", command,
          "--source", source, "--destination", destination]);
        expect(JSON.parse(result.stdout).counts.accounts).toBe(2);
        const copy = new DatabaseSync(destination, { readOnly: true });
        try { expect(copy.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toMatchObject({ n: 2 }); }
        finally { copy.close(); }
      } finally { writer.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
