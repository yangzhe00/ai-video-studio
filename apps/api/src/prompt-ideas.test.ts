import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createApi } from "./server.ts";
import { createDb } from "./db.ts";
import type { ApiConfig } from "./config.ts";

const running: { server: Server; dir?: string }[] = [];
afterEach(async () => {
  for (const { server, dir } of running.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const variants = [
  { title: "叙事", description: "动作完整", prompt: "小狗在厨房切菜，镜头平稳。" },
  { title: "温暖", description: "突出氛围", prompt: "暖光中的小狗缓慢切菜，近景。" },
  { title: "轻快", description: "强调节奏", prompt: "小狗快速切菜，轻快推镜。" },
];
function modelPayload(items: unknown = variants) {
  return { choices: [{ message: { content: JSON.stringify({ variants: items }) } }], usage: { total_tokens: 42 } };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function setup(modelHandler?: (response: import("node:http").ServerResponse) => void | Promise<void>, overrides: Partial<ApiConfig> = {}) {
  let calls = 0;
  const model = createServer(async (_request, response) => {
    calls++;
    try { await modelHandler?.(response); }
    catch { response.destroy(); }
  });
  const modelUrl = await listen(model);
  running.push({ server: model });
  const dir = mkdtempSync(join(tmpdir(), "avs-prompt-api-"));
  const config: ApiConfig = { dataDir: dir, sessionSecret: "test-secret-at-least-thirty-two-characters",
    secureCookies: false, workerEnabled: false, ideaModelBaseUrl: modelUrl, ideaModelApiKey: "server-only-key",
    ideaModelId: "text-model", ideaModelTimeoutMs: 1000, ...overrides };
  let api = createApi(config);
  let base = await listen(api);
  running.push({ server: api, dir });
  async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, payload: await response.json() as Record<string, any>,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  async function register(email: string) {
    return request("/auth/register", "POST", { email, password: "long-password-123" });
  }
  async function restart() {
    api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
    running.splice(running.findIndex(entry => entry.server === api), 1);
    api = createApi(config);
    base = await listen(api);
    running.push({ server: api, dir });
  }
  return { request, register, restart, dir, get calls() { return calls; } };
}

describe("account-scoped prompt ideas API", () => {
  it("persists one model call for concurrent same-ID requests, replays the result, and isolates accounts", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const modelStarted = new Promise<void>(resolve => { started = resolve; });
    const app = await setup(async response => {
      started(); await gate;
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify(modelPayload()));
    });
    const a = await app.register("idea-a@example.com"), b = await app.register("idea-b@example.com");
    expect((await app.request("/prompt-ideas")).status).toBe(401);
    const intent = { clientRequestId: "idea-request-001", input: "小狗做饭" };
    const first = app.request("/prompt-ideas", "POST", intent, a.cookie);
    await modelStarted;
    const concurrent = await app.request("/prompt-ideas", "POST", intent, a.cookie);
    expect(concurrent.status).toBe(200);
    expect(concurrent.payload.ideaSet.state).toBe("pending");
    release();
    const created = await first;
    expect(created.status).toBe(201);
    expect(created.payload.ideaSet.state).toBe("ready");
    expect(created.payload.ideaSet.variants).toHaveLength(3);
    expect(concurrent.payload.ideaSet.id).toBe(created.payload.ideaSet.id);
    const replay = await app.request("/prompt-ideas", "POST", intent, a.cookie);
    expect(replay.payload.ideaSet).toEqual(created.payload.ideaSet);
    expect(app.calls).toBe(1);
    expect((await app.request("/prompt-ideas", "POST", { ...intent, input: "不同想法" }, a.cookie)).status).toBe(409);
    const id = created.payload.ideaSet.id as string;
    expect((await app.request(`/prompt-ideas/${id}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await app.request("/prompt-ideas", "GET", undefined, b.cookie)).payload.ideaSets).toEqual([]);
    const selected = await app.request(`/prompt-ideas/${id}/selection`, "POST", { variantId: "variant-2", editedPrompt: "小狗在暖光厨房端菜，近景。" }, a.cookie);
    expect(selected.payload.ideaSet).toMatchObject({ selectedVariantId: "variant-2", editedPrompt: "小狗在暖光厨房端菜，近景。" });
    expect((await app.request(`/prompt-ideas/${id}`, "GET", undefined, a.cookie)).payload.ideaSet.editedPrompt).toBe("小狗在暖光厨房端菜，近景。");
    expect((await app.request(`/prompt-ideas/${id}/selection`, "POST", { variantId: "variant-2", editedPrompt: "x" }, b.cookie)).status).toBe(404);
    const db = createDb(app.dir);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM operations").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT demo_used,demo_reserved FROM accounts WHERE id=?").get(a.payload.account.id)).toEqual({ demo_used: 0, demo_reserved: 0 });
    db.close();
  });

  it("keeps malformed and unconfigured model results honest and limits new rounds", async () => {
    const bad = await setup(response => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(modelPayload([variants[0], variants[0], variants[2]]))); }, { ideaDailyLimit: 1 });
    const a = await bad.register("bad-model@example.com");
    const intent = { clientRequestId: "idea-request-002", input: "猫咪跳舞" };
    const failed = await bad.request("/prompt-ideas", "POST", intent, a.cookie);
    expect(failed.payload.ideaSet).toMatchObject({ state: "failed", errorCode: "invalid_response", variants: [] });
    expect((await bad.request("/prompt-ideas", "POST", intent, a.cookie)).payload.ideaSet.id).toBe(failed.payload.ideaSet.id);
    expect(bad.calls).toBe(1);
    expect((await bad.request("/prompt-ideas", "POST", { clientRequestId: "idea-request-003", input: "别的想法" }, a.cookie)).status).toBe(429);
    expect((await bad.request("/prompt-ideas", "POST", { clientRequestId: "idea-request-004", input: "x".repeat(201) }, a.cookie)).status).toBe(400);
    const empty = await setup(undefined, { ideaModelApiKey: undefined });
    const user = await empty.register("no-model@example.com");
    const notConfigured = await empty.request("/prompt-ideas", "POST", { clientRequestId: "idea-request-005", input: "小狗上菜" }, user.cookie);
    expect(notConfigured.payload.ideaSet).toMatchObject({ state: "failed", errorCode: "not_configured", variants: [] });
    expect(empty.calls).toBe(0);
  });

  it("marks uncertain model calls unknown and never resubmits the same request", async () => {
    const app = await setup(() => { /* provider holds the response until the client times out */ });
    const a = await app.register("timeout@example.com");
    const intent = { clientRequestId: "idea-request-006", input: "小狗洗菜" };
    const unknown = await app.request("/prompt-ideas", "POST", intent, a.cookie);
    expect(unknown.payload.ideaSet).toMatchObject({ state: "unknown", errorCode: "uncertain", variants: [] });
    const replay = await app.request("/prompt-ideas", "POST", intent, a.cookie);
    expect(replay.payload.ideaSet.id).toBe(unknown.payload.ideaSet.id);
    expect(replay.payload.ideaSet.state).toBe("unknown");
    expect(app.calls).toBe(1);
  });

  it("recovers a pending request after process restart as unknown without another model call", async () => {
    const app = await setup();
    const user = await app.register("restart@example.com");
    const id = randomUUID(), requestId = "idea-request-restart", input = "小狗端菜";
    const old = Date.now() - 10_000;
    const db = createDb(app.dir);
    db.prepare(`INSERT INTO prompt_idea_sets
      (id,owner_id,client_request_id,input_hash,input_text,state,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',?,?)`)
      .run(id, user.payload.account.id, requestId, createHash("sha256").update(input).digest("hex"), input, old, old);
    db.close();
    await app.restart();
    const detail = await app.request(`/prompt-ideas/${id}`, "GET", undefined, user.cookie);
    expect(detail.payload.ideaSet).toMatchObject({ id, state: "unknown", errorCode: "uncertain" });
    const list = await app.request("/prompt-ideas", "GET", undefined, user.cookie);
    expect(list.payload.ideaSets[0].state).toBe("unknown");
    const replay = await app.request("/prompt-ideas", "POST", { clientRequestId: requestId, input }, user.cookie);
    expect(replay).toMatchObject({ status: 200, payload: { ideaSet: { id, state: "unknown" } } });
    expect(app.calls).toBe(0);
  });
});
