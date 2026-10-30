import { backup, DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createDb as upgradeLegacyDb } from "../src/legacy-sqlite.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function counts(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name);
  return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count]));
}

const sourceArg = argument("--source");
const destinationArg = argument("--destination");
if (!sourceArg || !destinationArg || !isAbsolute(sourceArg) || !isAbsolute(destinationArg) || basename(destinationArg) !== "studio.sqlite") {
  process.stderr.write("Usage: node --experimental-transform-types upgrade-sqlite-copy.mjs --source /absolute/backup/studio.sqlite --destination /absolute/new-directory/studio.sqlite\n");
  process.exit(2);
}

const sourcePath = resolve(sourceArg);
const destinationDir = dirname(resolve(destinationArg));
let source;
let stageDir;
try {
  if (!statSync(sourcePath).isFile()) throw new Error("Source must be a regular SQLite file");
  if (existsSync(destinationDir)) throw new Error("Destination directory already exists");
  const destinationParent = dirname(destinationDir);
  if (!statSync(destinationParent).isDirectory()) throw new Error("Destination parent must be a directory");
  source = new DatabaseSync(sourcePath, { readOnly: true });
  const sourceVersion = source.prepare("PRAGMA user_version").get().user_version;
  if (sourceVersion !== 9) throw new Error(`Source SQLite schema version ${sourceVersion}; expected 9`);
  if (source.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Source integrity check failed");
  const beforeCounts = counts(source);

  stageDir = mkdtempSync(join(destinationParent, `.${basename(destinationDir)}.stage-`));
  chmodSync(stageDir, 0o700);
  await backup(source, join(stageDir, "studio.sqlite"));
  const upgraded = upgradeLegacyDb(stageDir);
  try {
    const targetVersion = upgraded.prepare("PRAGMA user_version").get().user_version;
    if (targetVersion !== 10) throw new Error(`Upgraded SQLite schema version ${targetVersion}; expected 10`);
    if (upgraded.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Upgraded copy integrity check failed");
    const afterCounts = counts(upgraded);
    for (const [table, count] of Object.entries(beforeCounts)) {
      if (afterCounts[table] !== count) throw new Error(`Row count changed during upgrade: ${table}`);
    }
    // The importer mounts this backup read-only. WAL would otherwise need to
    // create shared-memory sidecars next to the database inside that mount.
    upgraded.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const journalMode = upgraded.prepare("PRAGMA journal_mode = DELETE").get().journal_mode;
    if (journalMode !== "delete") throw new Error(`Unexpected upgraded copy journal mode: ${journalMode}`);
  } finally { upgraded.close(); }
  if (existsSync(destinationDir)) throw new Error("Destination directory appeared during upgrade");
  renameSync(stageDir, destinationDir);
  stageDir = undefined;
  process.stdout.write(JSON.stringify({ sourceVersion, targetVersion: 10, counts: beforeCounts,
    output: join(destinationDir, "studio.sqlite") }) + "\n");
} catch (error) {
  process.stderr.write(`SQLite backup-copy upgrade failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  source?.close();
  if (stageDir && existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
}
