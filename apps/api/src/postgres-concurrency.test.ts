import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./test-db.ts";
import { approveRun, createRun, RunError } from "./runs.ts";
import { ObjectCapacityError, storeObject } from "./object-capacity.ts";
import { claimRender } from "./render-lease.ts";

describe("PostgreSQL concurrent quotas", () => {
  it("allows only one account to reserve the last platform demo credit", async () => {
    const key = randomUUID();
    const a = await createTestDb(key), b = await createTestDb(key);
    try {
      const ready = async (db: typeof a, suffix: string) => {
        const owner = randomUUID(), project = randomUUID(), episode = randomUUID(), object = randomUUID();
        await db.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
          .run(owner, suffix + "@example.com", "hash", 1, 2);
        await db.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
          .run(project, owner, suffix, 1, JSON.stringify({ version: 1, episodes: [{ id: episode, title: suffix, shots: [] }], assets: [] }), 1);
        await db.prepare("INSERT INTO objects(id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(object, owner, suffix, "image/jpeg", 1, "/tmp/unused", 1);
        const run = await createRun(db, owner, project, { clientRequestId: "request-" + suffix,
          episodeId: episode, sourceAssetId: object, input: "小狗做饭", durationSec: 5 });
        return { owner, run };
      };
      const first = await ready(a, "first-0001"), second = await ready(b, "second-0001");
      const results = await Promise.allSettled([
        approveRun(a, first.owner, first.run.runId, { approvalId: "approval-a", planHash: first.run.planHash }, 1),
        approveRun(b, second.owner, second.run.runId, { approvalId: "approval-b", planHash: second.run.planHash }, 1),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      expect(rejected?.status).toBe("rejected");
      if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 503 } satisfies Partial<RunError>);
      expect(await a.prepare("SELECT COALESCE(SUM(demo_reserved),0)::BIGINT AS total FROM accounts").get()).toMatchObject({ total: 1 });
      expect(await a.prepare("SELECT COUNT(*) AS count FROM operations").get()).toMatchObject({ count: 1 });
    } finally { await a.close(); await b.close(); }
  });

  it("allows only one upload when two connections compete for the last storage byte", async () => {
    const key = randomUUID(), dir = mkdtempSync(join(tmpdir(), "avs-pg-storage-"));
    const a = await createTestDb(key), b = await createTestDb(key);
    try {
      const owners = [randomUUID(), randomUUID()];
      for (const [index, owner] of owners.entries()) await a.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
        .run(owner, `storage-${index}@example.com`, "hash", 1, 2);
      const limits = { maxTotalStorageBytes: 1 };
      const results = await Promise.allSettled([
        a.transaction(() => storeObject(a, dir, owners[0], "image/jpeg", { bytes: Buffer.from("a") }, limits)),
        b.transaction(() => storeObject(b, dir, owners[1], "image/jpeg", { bytes: Buffer.from("b") }, limits)),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      if (rejected?.status === "rejected") expect(rejected.reason).toBeInstanceOf(ObjectCapacityError);
      expect(await a.prepare("SELECT COUNT(*) AS count FROM objects").get()).toMatchObject({ count: 1 });
    } finally { await a.close(); await b.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("lets only one worker claim a render lease", async () => {
    const key = randomUUID(), a = await createTestDb(key), b = await createTestDb(key);
    try {
      const owner = randomUUID(), project = randomUUID(), object = randomUUID(), edit = randomUUID(), render = randomUUID();
      await a.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
        .run(owner, "render-race@example.com", "hash", 1, 1);
      await a.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
        .run(project, owner, "测试", 1, "{}", 1);
      await a.prepare("INSERT INTO objects(id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(object, owner, "render-race", "video/mp4", 1, "/tmp/unused", 1);
      await a.prepare("INSERT INTO video_edits(id,owner_id,project_id,episode_id,shot_id,source_object_id,recipe_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(edit, owner, project, "episode-race", "shot-race", object, "{}", 1, 1, 1);
      await a.prepare("INSERT INTO render_operations(id,edit_id,owner_id,recipe_revision,recipe_json,state,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)")
        .run(render, edit, owner, 1, "{}", 1, 1);
      const claims = await Promise.all([claimRender(a, render, "worker-a"), claimRender(b, render, "worker-b")]);
      expect(claims.sort()).toEqual([false, true]);
      expect(await a.prepare("SELECT state FROM render_operations WHERE id=?").get(render)).toMatchObject({ state: "running" });
    } finally { await a.close(); await b.close(); }
  });
});
