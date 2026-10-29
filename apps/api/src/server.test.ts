import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApi } from "./server.ts";
import type { ApiConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { RenderWorker } from "./render-worker.ts";
import { claimRender, RENDER_LEASE_MS } from "./render-lease.ts";
import { execFileSync } from "node:child_process";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const running: { server: Server; dataDir: string }[] = [];
const photos = new Map<string, Buffer>();
function jpegFixture(color: string): Buffer {
  const cached = photos.get(color);
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "avs-photo-"));
  try {
    const path = join(dir, "photo.jpg");
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=16x16`,
      "-frames:v", "1", path]);
    const bytes = readFileSync(path);
    photos.set(color, bytes);
    return bytes;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

afterEach(async () => {
  for (const { server, dataDir } of running.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

async function start(maxUploadBytes = 1024, overrides: Partial<ApiConfig> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "avs-api-test-"));
  const server = createApi({ dataDir, sessionSecret: "test-secret-at-least-thirty-two-characters", secureCookies: false, maxUploadBytes, demoQuota: 2, klingApiKey: "fake-test-key", workerEnabled: false, ...overrides });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  running.push({ server, dataDir });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, method = "GET", body?: unknown, cookie?: string, mime = "application/json") {
    const response = await fetch(base + path, {
      method, headers: { ...(body !== undefined ? { "content-type": mime } : {}), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
    });
    const payload: Record<string, any> = response.headers.get("content-type")?.includes("application/json") ? await response.json() as Record<string, any> : {};
    return { status: response.status, payload, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  return { request, dataDir, base };
}

async function register(request: Awaited<ReturnType<typeof start>>["request"], email: string) {
  return request("/auth/register", "POST", { email, password: "long-password-123" });
}

describe("authenticated demo API", () => {
  it("projects a legacy cloud project into the read-only three-layer DSL", async () => {
    const { request } = await start();
    const owner = await register(request, "dsl-owner@example.com");
    const other = await register(request, "dsl-other@example.com");
    const created = await request("/projects", "POST", { title: "旧云项目" }, owner.cookie);
    const id = created.payload.project.id as string;
    const projected = await request(`/projects/${id}/dsl`, "GET", undefined, owner.cookie);
    expect(projected.status).toBe(200);
    expect(projected.payload.readOnly).toBe(true);
    expect(projected.payload.project.document).toMatchObject({
      schema: "ai-video/project", dslVersion: 1, projectId: id,
      metadata: { title: "旧云项目" },
      canvasConfig: { width: 1080, height: 1920 },
      renderConfig: { fps: 30, format: "mp4" },
      assets: { items: [] },
      episodes: [{ id: created.payload.project.document.episodes[0].id,
        scenes: [], tracks: [{ kind: "visual", clips: [] }] }],
    });
    expect((await request(`/projects/${id}/dsl`, "GET", undefined, other.cookie)).status).toBe(404);
    expect((await request(`/projects/${id}/dsl`, "POST", {}, owner.cookie)).status).toBe(405);
    expect((await request(`/projects/${id}`, "GET", undefined, owner.cookie)).payload.project.document.version).toBe(1);
  });

  it("registers and logs in, rejects duplicate emails and expired sessions", async () => {
    const { request, dataDir } = await start();
    const first = await register(request, "USER@example.com");
    expect(first.status).toBe(201);
    expect(first.payload.account.email).toBe("user@example.com");
    expect((await register(request, "user@example.com")).status).toBe(409);
    expect((await request("/auth/me", "GET", undefined, first.cookie)).status).toBe(200);
    const login = await request("/auth/login", "POST", { email: "user@example.com", password: "long-password-123" });
    expect(login.status).toBe(200);
    const db = createDb(dataDir);
    db.prepare("UPDATE sessions SET expires_at=0").run(); db.close();
    expect((await request("/auth/me", "GET", undefined, login.cookie)).status).toBe(401);
    expect((await request("/auth/login", "POST", { email: "user@example.com", password: "wrong" })).status).toBe(401);
  });

  it("isolates projects and objects between registered accounts", async () => {
    const { request } = await start();
    const a = await register(request, "a@example.com");
    const b = await register(request, "b@example.com");
    const project = await request("/projects", "POST", { title: "小狗做饭" }, a.cookie);
    expect(project.status).toBe(201);
    const id = project.payload.project.id as string;
    expect((await request(`/projects/${id}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await request("/projects", "GET", undefined, b.cookie)).payload.projects).toEqual([]);
    const photo = await request("/objects", "POST", jpegFixture("red"), a.cookie, "image/jpeg");
    expect(photo.status).toBe(201);
    expect((await request(`/objects/${photo.payload.object.id}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await request(`/objects/${photo.payload.object.id}`, "GET", undefined, a.cookie)).status).toBe(200);
    expect((await request("/objects", "POST", jpegFixture("red"), a.cookie, "image/jpeg")).payload.object.id).toBe(photo.payload.object.id);
    expect((await request(`/projects/${id}`, "PUT", { baseRevision: 0, document: {} }, a.cookie)).status).toBe(405);
  });

  it("lists owned projects by actual update time with a bounded recent-episode summary", async () => {
    const { request } = await start();
    const a = await register(request, "library-a@example.com");
    const b = await register(request, "library-b@example.com");
    const first = await request("/projects", "POST", { title: "先建的项目" }, a.cookie);
    const second = await request("/projects", "POST", { title: "后建的项目" }, a.cookie);
    const firstId = first.payload.project.id as string;
    const initial = first.payload.project.document.episodes[0] as { id: string; title: string; shots: unknown[]; timeline: unknown[] };
    const before = await request("/projects", "GET", undefined, a.cookie);
    expect(before.payload.projects).toHaveLength(2);
    expect(before.payload.projects.find((item: { id: string }) => item.id === firstId)).toMatchObject({
      updatedAt: expect.any(Number), recentEpisode: { id: initial.id, title: "第 1 集", shotCount: 0 },
    });
    const changed = await request(`/projects/${firstId}/commands`, "POST", {
      id: "command-library-0001", resourceType: "episode", resourceId: "episode-library-0002", baseRevision: 0,
      payload: { id: "episode-library-0002", title: "第 2 集", shots: [], timeline: [] },
    }, a.cookie);
    expect(changed.status).toBe(200);
    const list = await request("/projects", "GET", undefined, a.cookie);
    expect(list.payload.projects[0]).toMatchObject({ id: firstId, title: "先建的项目", recentEpisode: { id: "episode-library-0002", title: "第 2 集", shotCount: 0 } });
    expect(list.payload.projects[0].updatedAt).toBeGreaterThan(before.payload.projects.find((item: { id: string }) => item.id === firstId).updatedAt);
    expect(list.payload.projects[1].id).toBe(second.payload.project.id);
    expect((await request("/projects", "GET", undefined, b.cookie)).payload.projects).toEqual([]);
  });

  it("validates payloads and enforces upload limits", async () => {
    const { request } = await start(5);
    expect((await request("/auth/register", "POST", { email: "bad", password: "short" })).status).toBe(400);
    const user = await register(request, "safe@example.com");
    expect((await request("/projects", "POST", { title: "" }, user.cookie)).status).toBe(400);
    expect((await request("/objects", "POST", Buffer.from("x"), user.cookie, "text/plain")).status).toBe(415);
    expect((await request("/objects", "POST", Buffer.from("too big"), user.cookie, "image/png")).status).toBe(413);
    const mediaServer = await start(1000);
    const mediaUser = await register(mediaServer.request, "media@example.com");
    expect((await mediaServer.request("/objects", "POST", Buffer.from("not a photo"), mediaUser.cookie, "image/jpeg")).status).toBe(400);
    expect((await mediaServer.request("/objects", "POST", jpegFixture("red"), mediaUser.cookie, "image/png")).status).toBe(400);
  });

  it("enforces account and platform storage limits without charging duplicate uploads", async () => {
    const red = jpegFixture("red"), blue = jpegFixture("blue"), green = jpegFixture("green");
    const { request } = await start(1000, { maxAccountObjects: 2,
      maxAccountStorageBytes: Math.max(red.length, blue.length, green.length) + 1,
      maxTotalStorageBytes: red.length + blue.length });
    const a = await register(request, "storage-a@example.com");
    const b = await register(request, "storage-b@example.com");
    const c = await register(request, "storage-c@example.com");
    const first = await request("/objects", "POST", red, a.cookie, "image/jpeg");
    expect(first.status).toBe(201);
    expect((await request("/objects", "POST", red, a.cookie, "image/jpeg")).status).toBe(200);
    expect((await request("/objects", "POST", blue, a.cookie, "image/jpeg")).status).toBe(403);
    expect((await request("/objects", "POST", blue, b.cookie, "image/jpeg")).status).toBe(201);
    expect((await request("/objects", "POST", green, c.cookie, "image/jpeg")).status).toBe(503);
  });

  it("serializes simultaneous uploads against the same account limit", async () => {
    const { request, dataDir } = await start(1000, { maxAccountObjects: 1 });
    const user = await register(request, "parallel-storage@example.com");
    const results = await Promise.all(["red", "blue"].map(color =>
      request("/objects", "POST", jpegFixture(color), user.cookie, "image/jpeg")));
    expect(results.map(result => result.status).sort()).toEqual([201, 403]);
    const db = createDb(dataDir);
    expect(db.prepare("SELECT COUNT(*) AS count FROM objects").get()).toMatchObject({ count: 1 });
    db.close();
  });

  it("caps all demo credits across registrations while preserving approval idempotency", async () => {
    const { request } = await start(1024, { maxTotalDemoCredits: 1 });
    const first = await register(request, "quota-a@example.com");
    const second = await register(request, "quota-b@example.com");
    async function ready(cookie: string, suffix: string) {
      const project = await request("/projects", "POST", { title: suffix }, cookie);
      const photo = await request("/objects", "POST", jpegFixture(suffix.includes("quota-a") ? "red" : "blue"), cookie, "image/jpeg");
      const run = await request(`/projects/${project.payload.project.id}/runs`, "POST", {
        clientRequestId: `request-${suffix}`, episodeId: project.payload.project.document.episodes[0].id,
        sourceAssetId: photo.payload.object.id, input: "小狗洗菜", durationSec: 5,
      }, cookie);
      return { id: run.payload.run.runId as string, planHash: run.payload.run.planHash as string };
    }
    const a = await ready(first.cookie, "quota-a-0001");
    const b = await ready(second.cookie, "quota-b-0001");
    const approval = { approvalId: "approval-quota-a", planHash: a.planHash };
    expect((await request(`/runs/${a.id}/approve`, "POST", approval, first.cookie)).status).toBe(200);
    expect((await request(`/runs/${a.id}/approve`, "POST", approval, first.cookie)).status).toBe(200);
    expect((await request(`/runs/${b.id}/approve`, "POST", { approvalId: "approval-quota-b", planHash: b.planHash }, second.cookie)).status).toBe(503);
  });

  it("replays a resource command once and reports a stale episode without overwriting it", async () => {
    const { request } = await start();
    const a = await register(request, "sync-a@example.com");
    const b = await register(request, "sync-b@example.com");
    const created = await request("/projects", "POST", { title: "云端分集" }, a.cookie);
    const projectId = created.payload.project.id as string;
    const episode = created.payload.project.document.episodes[0] as { id: string; title: string; shots: unknown[]; timeline: unknown[] };
    const command = { id: "command-001", resourceType: "episode", resourceId: episode.id, baseRevision: 1,
      payload: { ...episode, title: "第一集新版" } };
    const first = await request(`/projects/${projectId}/commands`, "POST", command, a.cookie);
    expect(first.status).toBe(200);
    expect(first.payload.resourceRevision).toBe(2);
    expect(first.payload.project.document.episodes[0].title).toBe("第一集新版");
    const replay = await request(`/projects/${projectId}/commands`, "POST", command, a.cookie);
    expect(replay.payload.replayed).toBe(true);
    expect(replay.payload.project.revision).toBe(first.payload.project.revision);
    const stale = await request(`/projects/${projectId}/commands`, "POST", { ...command, id: "command-002", payload: { ...episode, title: "过期修改" } }, a.cookie);
    expect(stale.status).toBe(409);
    expect(stale.payload.conflict.resource.title).toBe("第一集新版");
    const badClip = await request(`/projects/${projectId}/commands`, "POST", { ...command, id: "command-003", baseRevision: 2,
      payload: { ...episode, timeline: ["asset-0001"], timelineClips: [{ id: "clip-0001", assetId: "asset-0002", inMs: 0, outMs: 5000, volume: 1 }] } }, a.cookie);
    expect(badClip.status).toBe(400);
    const foreign = await request("/objects", "POST", jpegFixture("blue"), b.cookie, "image/jpeg");
    const foreignId = foreign.payload.object.id as string;
    expect((await request(`/projects/${projectId}/commands`, "POST", { ...command, id: "command-004", resourceType: "asset", resourceId: foreignId,
      baseRevision: 0, payload: { id: foreignId, kind: "image" } }, a.cookie)).status).toBe(400);
    expect((await request(`/projects/${projectId}/commands`, "POST", { ...command, id: "command-005", baseRevision: 2,
      payload: { ...episode, timeline: [foreignId] } }, a.cookie)).status).toBe(400);
    expect((await request(`/projects/${projectId}/commands`, "POST", { ...command, id: "command-006", resourceType: "canvas",
      resourceId: episode.id, baseRevision: 0, payload: { nodes: [{ id: "node-0001", type: "image", x: 0, y: 0, title: "照片", assetId: foreignId }],
        edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }, a.cookie)).status).toBe(400);
    expect((await request(`/projects/${projectId}/commands`, "POST", { ...command, id: "command-007", resourceType: "canvas",
      resourceId: episode.id, baseRevision: 0, payload: { nodes: [{ id: "node-0001", type: "text", x: 0, y: 0, title: "文本" }],
        edges: [{ id: "edge-0001", from: "node-0001", to: "node-missing" }], viewport: { x: 0, y: 0, zoom: 1 } } }, a.cookie)).status).toBe(400);
    expect((await request(`/projects/${projectId}/commands`, "POST", command, b.cookie)).status).toBe(404);
    expect((await request(`/projects/${projectId}`, "GET", undefined, a.cookie)).payload.project.document.episodes[0].title).toBe("第一集新版");
  });

  it("renders a new immutable video version and keeps the timeline pinned to the original", async () => {
    const { request, dataDir } = await start(1_000_000);
    const a = await register(request, "edit-a@example.com");
    const b = await register(request, "edit-b@example.com");
    const project = await request("/projects", "POST", { title: "微调测试" }, a.cookie);
    const projectId = project.payload.project.id as string;
    const episode = project.payload.project.document.episodes[0] as { id: string; title: string; shots: unknown[]; timeline: unknown[] };
    const sourcePath = join(dataDir, "fixture.mp4");
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]);
    const original = await request("/objects", "POST", readFileSync(sourcePath), a.cookie, "video/mp4");
    const assetId = original.payload.object.id as string;
    const shotId = "shot-edit-001";
    await request(`/projects/${projectId}/commands`, "POST", { id: "edit-asset-001", resourceType: "asset", resourceId: assetId, baseRevision: 0,
      payload: { id: assetId, kind: "video" } }, a.cookie);
    const changed = await request(`/projects/${projectId}/commands`, "POST", { id: "edit-episode-001", resourceType: "episode", resourceId: episode.id, baseRevision: 1,
      payload: { ...episode, shots: [{ id: shotId, runId: shotId, resultAssetId: assetId, sourceAssetId: assetId, prompt: "蓝色测试视频", durationSec: 2 }], timeline: [assetId] } }, a.cookie);
    expect(changed.status).toBe(200);
    const created = await request("/video-edits", "POST", { projectId, episodeId: episode.id, shotId }, a.cookie);
    expect(created.status, JSON.stringify(created.payload)).toBe(201);
    const editId = created.payload.edit.id as string;
    expect((await request(`/video-edits/${editId}`, "GET", undefined, b.cookie)).status).toBe(404);
    const cover = await request(`/video-edits/${editId}/commands`, "POST", { commandId: "edit-command-001", expectedRevision: 1, command: { type: "set-cover", sourceMs: 300 } }, a.cookie);
    const trim = await request(`/video-edits/${editId}/commands`, "POST", { commandId: "edit-command-002", expectedRevision: 2, command: { type: "set-trim", startMs: 200, endMs: 1800 } }, a.cookie);
    expect(trim.status).toBe(200);
    expect((await request(`/video-edits/${editId}/commands`, "POST", { commandId: "edit-command-002", expectedRevision: 2, command: { type: "set-trim", startMs: 200, endMs: 1800 } }, a.cookie)).payload.edit.recipe.revision).toBe(3);
    const caption = await request(`/video-edits/${editId}/commands`, "POST", { commandId: "edit-command-003", expectedRevision: 3, command: { type: "upsert-caption", caption: { id: "caption-001", startMs: 500, endMs: 1000, text: "你好" } } }, a.cookie);
    expect(caption.status).toBe(200);
    const operationId = "render-001";
    const render = await request(`/video-edits/${editId}/render`, "POST", { renderOperationId: operationId, expectedRevision: 4 }, a.cookie);
    expect(render.status).toBe(201);
    const repeat = await request(`/video-edits/${editId}/render`, "POST", { renderOperationId: "render-002", expectedRevision: 4 }, a.cookie);
    expect(repeat.payload.render.id).toBe(operationId);
    const db = createDb(dataDir);
    const otherDb = createDb(dataDir);
    const now = Date.now();
    expect(claimRender(db, operationId, "worker-one", now)).toBe(true);
    expect(claimRender(otherDb, operationId, "worker-two", now)).toBe(false);
    expect(claimRender(otherDb, operationId, "worker-two", now + RENDER_LEASE_MS + 1)).toBe(true);
    otherDb.prepare("UPDATE render_operations SET state='failed',lease_token=NULL,lease_expires_at=NULL WHERE id=?").run(operationId);
    otherDb.close();
    const retried = await request(`/video-edits/${editId}/render`, "POST", { renderOperationId: "render-003", expectedRevision: 4 }, a.cookie);
    expect(retried.payload.render.id).toBe(operationId);
    expect(retried.payload.render.state).toBe("pending");
    await new RenderWorker(db, dataDir, { maxAccountObjects: 2 }).run(operationId);
    expect((await request(`/renders/${operationId}`, "GET", undefined, a.cookie)).payload.render.state).toBe("failed");
    expect(db.prepare("SELECT COUNT(*) AS count FROM objects WHERE owner_id=?").get(a.payload.account.id)).toMatchObject({ count: 1 });
    expect(readdirSync(join(dataDir, "objects", a.payload.account.id))).toHaveLength(1);
    const afterCapacity = await request(`/video-edits/${editId}/render`, "POST", { renderOperationId: "render-004", expectedRevision: 4 }, a.cookie);
    expect(afterCapacity.payload.render.id).toBe(operationId);
    await new RenderWorker(db, dataDir).run(operationId);
    db.close();
    const result = await request(`/renders/${operationId}`, "GET", undefined, a.cookie);
    expect(result.payload.render.state).toBe("succeeded");
    expect(result.payload.render.outputAssetId).not.toBe(assetId);
    expect((await request(`/objects/${result.payload.render.outputAssetId}`, "GET", undefined, a.cookie)).status).toBe(200);
    expect((await request(`/objects/${assetId}`, "GET", undefined, a.cookie)).status).toBe(200);
    expect((await request(`/renders/${operationId}`, "GET", undefined, b.cookie)).status).toBe(404);
    const current = await request(`/projects/${projectId}`, "GET", undefined, a.cookie);
    expect(current.payload.project.document.episodes[0].shots[0]).toMatchObject({
      originalAssetId: assetId, selectedAssetId: result.payload.render.outputAssetId, resultAssetId: result.payload.render.outputAssetId,
    });
    expect(current.payload.project.document.episodes[0].timeline).toEqual([assetId]);
    const versions = await request(`/video-edits/${editId}/versions`, "GET", undefined, a.cookie);
    expect(versions.payload.originalAssetId).toBe(assetId);
    expect(versions.payload.versions[0].outputAssetId).toBe(result.payload.render.outputAssetId);
    expect((await request(`/video-edits/${editId}/versions`, "GET", undefined, b.cookie)).status).toBe(404);
    expect(cover.status).toBe(200);
  });

  it("replays one Agent run for duplicate requests and reserves quota once", async () => {
    const { request, dataDir, base } = await start();
    const a = await register(request, "agent-a@example.com");
    const b = await register(request, "agent-b@example.com");
    const project = await request("/projects", "POST", { title: "第一集" }, a.cookie);
    const projectId = project.payload.project.id as string;
    const episodeId = project.payload.project.document.episodes[0].id as string;
    const photo = await request("/objects", "POST", jpegFixture("red"), a.cookie, "image/jpeg");
    const sourceAssetId = photo.payload.object.id as string;
    const intent = { clientRequestId: "request-0001", episodeId, sourceAssetId, input: "小狗穿厨师服洗菜", durationSec: 5 };
    const [first, replay] = await Promise.all([
      request(`/projects/${projectId}/runs`, "POST", intent, a.cookie),
      request(`/projects/${projectId}/runs`, "POST", intent, a.cookie),
    ]);
    expect(first.payload.run.runId).toBe(replay.payload.run.runId);
    const runId = first.payload.run.runId as string;
    expect(first.payload.run.state).toBe("waiting_approval");
    expect(first.payload.run.plan.planner).toBe("validated-input");
    expect((await request(`/projects/${projectId}/runs`, "POST", { ...intent, input: "别的需求" }, a.cookie)).status).toBe(409);
    expect((await request(`/runs/${runId}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await request(`/runs/${runId}/events`, "GET", undefined, b.cookie)).status).toBe(404);
    const approval = { approvalId: "approve-0001", planHash: first.payload.run.planHash };
    const approved = await request(`/runs/${runId}/approve`, "POST", approval, a.cookie);
    expect(approved.payload.run.state).toBe("pending_submit");
    const repeated = await request(`/runs/${runId}/approve`, "POST", approval, a.cookie);
    expect(repeated.payload.run.operation.id).toBe(approved.payload.run.operation.id);
    expect((await request("/auth/me", "GET", undefined, a.cookie)).payload.account.demo_reserved).toBe(1);
    const db = createDb(dataDir);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT seq FROM run_events WHERE run_id=? ORDER BY seq").all(runId)).toEqual([{ seq: 1 }, { seq: 2 }]);
    db.close();
    const stream = await fetch(`${base}/runs/${runId}/events?after=1`, { headers: { cookie: a.cookie } });
    const reader = stream.body!.getReader();
    const firstChunk = new TextDecoder().decode((await reader.read()).value);
    expect(firstChunk).toContain("id: 2");
    expect(firstChunk).not.toContain("id: 1\n");
    await reader.cancel();

    const second = await request(`/projects/${projectId}/runs`, "POST", { ...intent, clientRequestId: "request-0002" }, a.cookie);
    await request(`/runs/${second.payload.run.runId}/approve`, "POST", { approvalId: "approve-0002", planHash: second.payload.run.planHash }, a.cookie);
    const third = await request(`/projects/${projectId}/runs`, "POST", { ...intent, clientRequestId: "request-0003" }, a.cookie);
    expect((await request(`/runs/${third.payload.run.runId}/approve`, "POST", { approvalId: "approve-0003", planHash: third.payload.run.planHash }, a.cookie)).status).toBe(403);
  });
});
