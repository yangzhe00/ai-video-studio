import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PgDatabase } from "./db.ts";
import { createTestDb as createDb, testDatabaseUrl, dropTestSchema } from "./test-db.ts";
import { createRun, approveRun } from "./runs.ts";
import { KlingGateway } from "./kling.ts";
import { GenerationWorker } from "./generation-worker.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) { await fixture.db.close(); rmSync(fixture.dir, { recursive: true, force: true }); } });

async function setup(fetchMock: typeof fetch, limits = {}) {
  const dir = mkdtempSync(join(tmpdir(), "avs-worker-test-"));
  const db = (await createDb(dir));
  fixtures.push({ db, dir });
  const account = randomUUID(), project = randomUUID(), episode = randomUUID(), photo = randomUUID();
  (await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)").run(account, "test@example.com", "hash", Date.now(), 2));
  (await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(project, account, "第一集", 1, JSON.stringify({ version: 1, episodes: [{ id: episode, title: "第一集", shots: [] }], assets: [] }), Date.now()));
  const folder = join(dir, "objects", account); mkdirSync(folder, { recursive: true });
  const path = join(folder, "photo"); writeFileSync(path, "sample image");
  (await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(photo, account, "photo-hash", "image/jpeg", 12, path, Date.now()));
  const run = (await createRun(db, account, project, { clientRequestId: "request-0001", episodeId: episode, sourceAssetId: photo, input: "小狗洗菜", durationSec: 5 }));
  (await approveRun(db, account, run.runId, { approvalId: "approve-0001", planHash: run.planHash }));
  const gateway = new KlingGateway("server-key", "https://api-beijing.klingai.com", fetchMock);
  return { db, dir, account, project, gateway, runId: run.runId, worker: new GenerationWorker(db, dir, gateway, limits) };
}

describe("cloud generation worker", () => {
  it("claims one paid submission across two worker connections", async () => {
    let posts = 0;
    const { db, dir, runId, gateway } = (await setup(async (_url, init) => {
      if (init?.method === "POST") { posts++; return Response.json({ code: 0, data: { id: "remote-1" } }); }
      return Response.json({ code: 0, data: [] });
    }));
    const otherDb = await createDb(dir);
    try {
      await Promise.all([
        new GenerationWorker(db, dir, gateway).run(runId),
        new GenerationWorker(otherDb, dir, gateway).run(runId),
      ]);
      expect(posts).toBe(1);
      expect(await db.prepare("SELECT COUNT(*) AS count FROM operations WHERE run_id=?").get(runId))
        .toMatchObject({ count: 1 });
    } finally { await otherDb.close(); }
  });

  it("never sends a second POST after an uncertain response", async () => {
    let posts = 0, gets = 0;
    const { db, runId, worker } = (await setup(async (_url, init) => {
      if (init?.method === "POST") { posts++; throw new Error("connection lost"); }
      gets++;
      return Response.json({ code: 0, data: gets === 1 ? [] : [{ id: "remote-1", status: "processing" }] });
    }));
    await worker.run(runId);
    expect((await db.prepare("SELECT state FROM operations WHERE run_id=?").get(runId))).toMatchObject({ state: "unknown" });
    await worker.run(runId);
    expect((await db.prepare("SELECT state FROM operations WHERE run_id=?").get(runId))).toMatchObject({ state: "unknown" });
    await worker.run(runId);
    expect((await db.prepare("SELECT state FROM operations WHERE run_id=?").get(runId))).toMatchObject({ state: "running" });
    expect(posts).toBe(1);
  });

  it("saves a completed video once and attaches it to the selected episode", async () => {
    let posts = 0;
    const { db, account, project, runId, worker } = (await setup(async (url, init) => {
      if (init?.method === "POST") { posts++; return Response.json({ code: 0, data: { id: "remote-1" } }); }
      if (String(url).includes("/tasks?")) return Response.json({ code: 0, data: [{ id: "remote-1", status: "succeeded", outputs: [{ type: "video", url: "https://h1.inkwai.com/video.mp4" }] }] });
      return new Response(Buffer.from("fake mp4 bytes"), { status: 200 });
    }));
    const before = (await db.prepare("SELECT updated_at FROM projects WHERE id=?").get(project)) as { updated_at: number };
    await worker.run(runId);
    await worker.run(runId);
    await worker.run(runId);
    const document = JSON.parse(((await db.prepare("SELECT document_json FROM projects WHERE id=?").get(project)) as { document_json: string }).document_json);
    expect(document.episodes[0].shots).toHaveLength(1);
    expect(document.episodes[0].shots[0].runId).toBe(runId);
    expect(document.episodes[0].shots[0].originalAssetId).toBe(document.episodes[0].shots[0].resultAssetId);
    expect((await db.prepare("SELECT updated_at,recent_episode_id FROM projects WHERE id=?").get(project)))
      .toMatchObject({ updated_at: expect.any(Number), recent_episode_id: document.episodes[0].id });
    expect(((await db.prepare("SELECT updated_at FROM projects WHERE id=?").get(project)) as { updated_at: number }).updated_at).toBeGreaterThan(before.updated_at);
    expect((await db.prepare("SELECT demo_reserved,demo_used FROM accounts WHERE id=?").get(account))).toMatchObject({ demo_reserved: 0, demo_used: 1 });
    expect(posts).toBe(1);
  });

  it("releases a reserved demo credit on an explicit provider rejection", async () => {
    const { db, account, runId, worker } = (await setup(async () => new Response("rejected", { status: 400 })));
    await worker.run(runId);
    expect((await db.prepare("SELECT state FROM agent_runs WHERE id=?").get(runId))).toMatchObject({ state: "failed" });
    expect((await db.prepare("SELECT demo_reserved,demo_used FROM accounts WHERE id=?").get(account))).toMatchObject({ demo_reserved: 0, demo_used: 0 });
  });

  it("stages a completed paid result when account storage is full, then saves it after capacity increases", async () => {
    const limits = { maxAccountObjects: 1 };
    const { db, dir, account, runId, worker, gateway } = (await setup(async (url, init) => {
      if (init?.method === "POST") return Response.json({ code: 0, data: { id: "remote-1" } });
      if (String(url).includes("/tasks?")) return Response.json({ code: 0, data: [{ id: "remote-1", status: "succeeded", outputs: [{ type: "video", url: "https://h1.inkwai.com/video.mp4" }] }] });
      return new Response(Buffer.from("fake mp4 bytes"), { status: 200 });
    }, limits));
    await worker.run(runId);
    await worker.run(runId);
    await worker.run(runId);
    expect((await db.prepare("SELECT state FROM operations WHERE run_id=?").get(runId))).toMatchObject({ state: "storage_pending" });
    expect((await db.prepare("SELECT demo_reserved,demo_used FROM accounts WHERE id=?").get(account))).toMatchObject({ demo_reserved: 1, demo_used: 0 });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM objects WHERE owner_id=?").get(account))).toMatchObject({ count: 1 });
    const pendingId = ((await db.prepare("SELECT id FROM operations WHERE run_id=?").get(runId)) as { id: string }).id;
    expect(existsSync(join(dir, "temporary", `${pendingId}.ready`))).toBe(true);
    limits.maxAccountObjects = 2;
    await new GenerationWorker(db, dir, gateway, limits).run(runId);
    expect((await db.prepare("SELECT state FROM operations WHERE run_id=?").get(runId))).toMatchObject({ state: "saved" });
    expect((await db.prepare("SELECT demo_used FROM accounts WHERE id=?").get(account))).toMatchObject({ demo_used: 1 });
    expect(existsSync(join(dir, "temporary", `${pendingId}.ready`))).toBe(false);
    const video = (await db.prepare("SELECT path FROM objects WHERE owner_id=? AND mime='video/mp4'").get(account)) as { path: string };
    expect(readFileSync(video.path).toString()).toBe("fake mp4 bytes");
  });

  it("queries a recovered submitting operation without sending a POST", async () => {
    let posts = 0;
    const { db, runId, worker } = (await setup(async (_url, init) => {
      if (init?.method === "POST") posts++;
      return Response.json({ code: 0, data: [] });
    }));
    (await db.prepare("UPDATE operations SET state='submitting',submitted_at=? WHERE run_id=?").run(Date.now(), runId));
    await worker.run(runId);
    expect(posts).toBe(0);
    expect((await db.prepare("SELECT state FROM operations WHERE run_id=?").get(runId))).toMatchObject({ state: "unknown" });
  });
});
