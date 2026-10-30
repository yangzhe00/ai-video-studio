import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApi } from "./server.ts";
import { createTestDb as createDb, testDatabaseUrl, dropTestSchema } from "./test-db.ts";

const running: { server: Server; dir: string }[] = [];
afterEach(async () => {
  for (const { server, dir } of running.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "avs-brief-api-"));
  const server = (await createApi({ dataDir: dir, databaseUrl: await testDatabaseUrl(dir), sessionSecret: "test-secret-at-least-thirty-two-characters", secureCookies: false, workerEnabled: false }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  running.push({ server, dir });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
    const response = await fetch(base + path, { method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(method === "GET" ? {} : { "x-avs-request": "1" }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, payload: await response.json() as Record<string, any>,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  async function register(email: string) {
    return request("/auth/register", "POST", { email, password: "long-password-123" });
  }
  return { dir, request, register };
}

function manualBrief(id: string, text = "🐶做饭\n端菜") {
  return { id, source: "manual", originalText: text, finalText: text, createdAt: 100, updatedAt: 100 };
}

describe("project creation briefs", () => {
  it("atomically creates a project and first brief, recovers same-ID replay, and rejects changed intent", async () => {
    const app = await setup();
    const user = await app.register("brief-owner@example.com");
    const body = { id: "project-brief-0001", title: "小狗做饭", initialEpisodeId: "episode-brief-0001",
      initialBrief: manualBrief("brief-0001") };
    const created = await app.request("/projects", "POST", body, user.cookie);
    expect(created.status).toBe(201);
    expect(created.payload.project.document.briefs).toEqual([body.initialBrief]);
    expect(created.payload.project.resourceRevisions).toContainEqual({ resourceType: "brief", resourceId: "brief-0001", revision: 1 });
    const replay = await app.request("/projects", "POST", body, user.cookie);
    expect(replay.status).toBe(200);
    expect(replay.payload.project.id).toBe(body.id);
    expect((await app.request(`/projects/${body.id}`, "GET", undefined, user.cookie)).payload.project.document.briefs).toEqual([body.initialBrief]);
    const edited = { ...body.initialBrief, finalText: "只改最终文本", updatedAt: 101 };
    expect((await app.request(`/projects/${body.id}/commands`, "POST", { id: "command-brief-replay", resourceType: "brief",
      resourceId: body.initialBrief.id, baseRevision: 1, payload: edited }, user.cookie)).status).toBe(200);
    const replayAfterEdit = await app.request("/projects", "POST", body, user.cookie);
    expect(replayAfterEdit.status).toBe(200);
    expect(replayAfterEdit.payload.project.document.briefs).toEqual([edited]);
    expect((await app.request("/projects", "POST", { ...body, initialBrief: manualBrief("brief-0001", "其他内容") }, user.cookie)).status).toBe(409);
    const db = (await createDb(app.dir));
    expect((await db.prepare("SELECT COUNT(*) AS count FROM projects").get())).toEqual({ count: 1 });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get())).toEqual({ count: 0 });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM operations").get())).toEqual({ count: 0 });
    expect((await db.prepare("SELECT demo_used,demo_reserved FROM accounts WHERE id=?").get(user.payload.account.id))).toEqual({ demo_used: 0, demo_reserved: 0 });
    (await db.close());
  });

  it("appends and edits one brief with resource revisions while preserving episode data and owner isolation", async () => {
    const app = await setup();
    const a = await app.register("brief-a@example.com"), b = await app.register("brief-b@example.com");
    const created = await app.request("/projects", "POST", { id: "project-brief-0002", title: "旧项目" }, a.cookie);
    expect(created.status).toBe(201);
    expect(created.payload.project.document.briefs).toEqual([]);
    expect((await app.request("/projects", "POST", { id: "project-brief-0002", title: "旧项目" }, a.cookie)).status).toBe(200);
    const episode = created.payload.project.document.episodes[0];
    const brief = manualBrief("brief-0002");
    const command = { id: "command-brief-0001", resourceType: "brief", resourceId: brief.id, baseRevision: 0, payload: brief };
    const added = await app.request("/projects/project-brief-0002/commands", "POST", command, a.cookie);
    expect(added.status).toBe(200);
    expect(added.payload.project.document.briefs).toEqual([brief]);
    expect((await app.request("/projects/project-brief-0002/commands", "POST", command, a.cookie)).payload.replayed).toBe(true);
    const edited = { ...brief, finalText: "第二稿", updatedAt: 101 };
    const newer = await app.request("/projects/project-brief-0002/commands", "POST", { ...command,
      id: "command-brief-0002", baseRevision: 1, payload: edited }, a.cookie);
    expect(newer.status).toBe(200);
    expect(newer.payload.resourceRevision).toBe(2);
    const stale = await app.request("/projects/project-brief-0002/commands", "POST", { ...command,
      id: "command-brief-0003", baseRevision: 1, payload: { ...brief, finalText: "过期覆盖" } }, a.cookie);
    expect(stale.status).toBe(409);
    expect(stale.payload.conflict).toMatchObject({ resourceRevision: 2, resource: edited });
    const final = await app.request("/projects/project-brief-0002", "GET", undefined, a.cookie);
    expect(final.payload.project.document.briefs).toEqual([edited]);
    expect(final.payload.project.document.episodes[0]).toEqual(episode);
    expect((await app.request("/projects/project-brief-0002", "GET", undefined, b.cookie)).status).toBe(404);
    expect((await app.request("/projects/project-brief-0002/commands", "POST", command, b.cookie)).status).toBe(404);
  });

  it("accepts only the current account's saved Agent selection for first save", async () => {
    const app = await setup();
    const a = await app.register("agent-brief-a@example.com"), b = await app.register("agent-brief-b@example.com");
    const db = (await createDb(app.dir));
    (await db.prepare(`INSERT INTO prompt_idea_sets
      (id,owner_id,client_request_id,input_hash,input_text,state,variants_json,selected_variant_id,edited_prompt,created_at,updated_at)
      VALUES (?,?,?,?,?,'ready',?,?,?,?,?)`)
      .run("idea-brief-0001", a.payload.account.id, "client-brief-0001", "hash", "小狗做饭", "[]", "variant-1", "小狗在厨房端菜", 1, 1));
    (await db.close());
    const brief = { id: "brief-agent-0001", source: "agent", originalText: "小狗做饭", finalText: "小狗在厨房端菜",
      ideaSetId: "idea-brief-0001", variantId: "variant-1", createdAt: 10, updatedAt: 10 };
    expect((await app.request("/projects", "POST", { id: "project-agent-0001", title: "非法", initialBrief: brief }, b.cookie)).status).toBe(400);
    expect((await app.request("/projects", "POST", { id: "project-agent-0002", title: "非法", initialBrief: { ...brief, finalText: "假内容" } }, a.cookie)).status).toBe(400);
    const accepted = await app.request("/projects", "POST", { id: "project-agent-0003", title: "合法", initialBrief: brief }, a.cookie);
    expect(accepted.status).toBe(201);
    expect(accepted.payload.project.document.briefs).toEqual([brief]);
    const existing = await app.request("/projects", "POST", { id: "project-agent-0004", title: "加入已有" }, a.cookie);
    expect(existing.status).toBe(201);
    const append = { id: "command-agent-0001", resourceType: "brief", resourceId: brief.id, baseRevision: 0, payload: brief };
    expect((await app.request("/projects/project-agent-0004/commands", "POST", { ...append,
      payload: { ...brief, finalText: "伪造的模型输出" } }, a.cookie)).status).toBe(400);
    expect((await app.request("/projects/project-agent-0004/commands", "POST", append, a.cookie)).status).toBe(200);
    const after = (await createDb(app.dir));
    expect((await after.prepare("SELECT COUNT(*) AS count FROM projects").get())).toEqual({ count: 2 });
    after.close();
  });
});
