import type { PgDatabase } from "./db.ts";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiConfig } from "./config.ts";

export type ObjectCapacity = Pick<ApiConfig, "maxAccountObjects" | "maxAccountStorageBytes" | "maxTotalStorageBytes">;

export class ObjectCapacityError extends Error {
  constructor(readonly scope: "account" | "platform") {
    super(scope === "account" ? "账号素材存储额度已用完" : "平台素材存储额度已用完");
  }
}

// Call inside the same PostgreSQL transaction that inserts the new object.
export async function assertObjectCapacity(db: PgDatabase, ownerId: string, size: number, limits: ObjectCapacity): Promise<void> {
  const account = (await db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size),0)::BIGINT AS bytes FROM objects WHERE owner_id=?")
    .get(ownerId)) as { count: number; bytes: number };
  if (account.count >= (limits.maxAccountObjects ?? 100) ||
      account.bytes + size > (limits.maxAccountStorageBytes ?? 200_000_000)) {
    throw new ObjectCapacityError("account");
  }
  const total = (await db.prepare("SELECT COALESCE(SUM(size),0)::BIGINT AS bytes FROM objects").get()) as { bytes: number };
  if (total.bytes + size > (limits.maxTotalStorageBytes ?? 2_000_000_000)) {
    throw new ObjectCapacityError("platform");
  }
}

export interface StoredObject { id: string; sha256: string; mime: string; size: number; created: boolean; createdFilePath?: string }

// Caller owns the transaction and must remove createdFilePath on rollback.
export async function storeObject(db: PgDatabase, dataDir: string, ownerId: string, mime: string,
  input: { bytes: Buffer } | { sourcePath: string; sha256: string; size: number }, limits: ObjectCapacity): Promise<StoredObject> {
  await db.lock("storage-total");
  const sha256 = "bytes" in input ? createHash("sha256").update(input.bytes).digest("hex") : input.sha256;
  const size = "bytes" in input ? input.bytes.length : input.size;
  const existing = (await db.prepare("SELECT id,sha256,mime,size FROM objects WHERE owner_id=? AND sha256=?")
    .get(ownerId, sha256)) as Omit<StoredObject, "created" | "createdFilePath"> | undefined;
  if (existing) return { ...existing, created: false };
  (await assertObjectCapacity(db, ownerId, size, limits));
  const folder = join(dataDir, "objects", ownerId);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, sha256);
  // A file without an object row can remain after a crash; replace it with verified input.
  if (existsSync(path)) rmSync(path, { force: true });
  const createdFilePath = path;
  try {
    if ("bytes" in input) {
      writeFileSync(path, input.bytes, { flag: "wx" });
      const fd = openSync(path, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } else {
      // The staging file is already flushed and lives under the same data directory.
      linkSync(input.sourcePath, path);
    }
    const object = { id: randomUUID(), sha256, mime, size };
    (await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(object.id, ownerId, sha256, mime, size, path, Date.now()));
    return { ...object, created: true, createdFilePath };
  } catch (error) {
    if (createdFilePath) rmSync(createdFilePath, { force: true });
    throw error;
  }
}
