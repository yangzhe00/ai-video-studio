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
  const server = createApi({ dataDir, sessionSecret: "test-secret-at-least-thirty-two-characters", secureCookies: false, maxUploadBytes, demoQuota: 2 });
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
  return { request, dataDir };
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
});
