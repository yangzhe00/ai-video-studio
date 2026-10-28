import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApi } from "./server.ts";
import { createDb } from "./db.ts";

const running: { server: Server; dataDir: string }[] = [];

afterEach(async () => {
  for (const { server, dataDir } of running.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

async function start(maxUploadBytes = 1024) {
  const dataDir = mkdtempSync(join(tmpdir(), "avs-api-test-"));
  const server = createApi({ dataDir, sessionSecret: "test-secret-at-least-thirty-two-characters", secureCookies: false, maxUploadBytes, demoQuota: 2, klingApiKey: "fake-test-key", workerEnabled: false });
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
    const photo = await request("/objects", "POST", Buffer.from("test-photo"), a.cookie, "image/jpeg");
    expect(photo.status).toBe(201);
    expect((await request(`/objects/${photo.payload.object.id}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await request(`/objects/${photo.payload.object.id}`, "GET", undefined, a.cookie)).status).toBe(200);
    expect((await request("/objects", "POST", Buffer.from("test-photo"), a.cookie, "image/jpeg")).payload.object.id).toBe(photo.payload.object.id);
    expect((await request(`/projects/${id}`, "PUT", { baseRevision: 0, document: {} }, a.cookie)).status).toBe(409);
  });

  it("validates payloads and enforces upload limits", async () => {
    const { request } = await start(5);
    expect((await request("/auth/register", "POST", { email: "bad", password: "short" })).status).toBe(400);
    const user = await register(request, "safe@example.com");
    expect((await request("/projects", "POST", { title: "" }, user.cookie)).status).toBe(400);
    expect((await request("/objects", "POST", Buffer.from("x"), user.cookie, "text/plain")).status).toBe(415);
    expect((await request("/objects", "POST", Buffer.from("too big"), user.cookie, "image/png")).status).toBe(413);
  });

  it("replays one Agent run for duplicate requests and reserves quota once", async () => {
    const { request, dataDir, base } = await start();
    const a = await register(request, "agent-a@example.com");
    const b = await register(request, "agent-b@example.com");
    const project = await request("/projects", "POST", { title: "第一集" }, a.cookie);
    const projectId = project.payload.project.id as string;
    const episodeId = project.payload.project.document.episodes[0].id as string;
    const photo = await request("/objects", "POST", Buffer.from("photo"), a.cookie, "image/jpeg");
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
