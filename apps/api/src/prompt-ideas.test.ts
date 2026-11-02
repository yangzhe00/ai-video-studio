import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApi } from "./server.ts";
import { IdeaAgentWorker } from "./idea-agent-worker.ts";
import { createTestDb, testDatabaseUrl } from "./test-db.ts";
import type { ApiConfig } from "./config.ts";

const initial = [
  { title: "叙事", description: "完整动作", prompt: "小狗在厨房切菜，固定镜头。" },
  { title: "温暖", description: "暖光氛围", prompt: "小狗在暖光厨房切菜，近景镜头。" },
  { title: "轻快", description: "轻快节奏", prompt: "小狗快速切菜，轻快推镜。" },
];
const additional = [
  { title: "俯拍", description: "俯视画面", prompt: "俯拍小狗把晚餐摆上木桌。" },
  { title: "窗边", description: "窗边光影", prompt: "小狗在窗边端起热汤，缓慢摇镜。" },
  { title: "特写", description: "细节镜头", prompt: "特写小狗撒上香草，再拉远看全景。" },
];

const servers: { server: Server; dir: string }[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const { server, dir } of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(options: { second?: typeof initial; secondStatus?: string; loseSecondResponse?: boolean; ideaDailyLimit?: number } = {}) {
  const nativeFetch = globalThis.fetch;
  const creates: { agentId: string; prompt: string }[] = [];
  const runs = new Map<string, { id: string; agentId: string; status: string; result: string }>();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.cursor.com/v1/agents" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { agentId: string; prompt: { text: string } };
      creates.push({ agentId: body.agentId, prompt: body.prompt.text });
      const id = `run-${randomUUID()}`;
      runs.set(id, { id, agentId: body.agentId, status: creates.length === 2 ? options.secondStatus ?? "FINISHED" : "FINISHED",
        result: JSON.stringify({ variants: creates.length === 1 ? initial : creates.length === 2 ? options.second ?? additional : additional }) });
      if (creates.length === 2 && options.loseSecondResponse) throw new Error("lost create response");
      return Response.json({ agent: { id: body.agentId }, run: { id, agentId: body.agentId } });
    }
    const agentId = /\/agents\/(bc-[a-zA-Z0-9-]+)$/.exec(url)?.[1];
    if (agentId) {
      const latest = [...runs.values()].find(run => run.agentId === agentId);
      return latest ? Response.json({ id: agentId, latestRunId: latest.id }) : Response.json({ error: "missing" }, { status: 404 });
    }
    const runId = /\/runs\/(run-[a-zA-Z0-9-]+)$/.exec(url)?.[1];
    if (runId) return Response.json(runs.get(runId) ?? { error: "missing" }, { status: runs.has(runId) ? 200 : 404 });
    return nativeFetch(input, init);
  }));
  const dir = mkdtempSync(join(tmpdir(), "avs-ideas-cursor-"));
  const config: ApiConfig = { dataDir: dir, databaseUrl: await testDatabaseUrl(dir), sessionSecret: "test-secret-at-least-thirty-two-characters",
    secureCookies: false, workerEnabled: false, ideaCursorApiKey: "test-cursor-key", ideaDailyLimit: options.ideaDailyLimit };
  const server = await createApi(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push({ server, dir });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, method = "GET", body?: unknown, cookie?: string) {
    const response = await nativeFetch(base + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { "x-avs-request": "1" }), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, payload: await response.json() as Record<string, any>, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  async function tick() { const db = await createTestDb(dir); try { await new IdeaAgentWorker(db, config).tick(); } finally { await db.close(); } }
  return { request, tick, creates, dir, register: (email: string) => request("/auth/register", "POST", { email, password: "long-password-123" }) };
}

describe("Cursor-only inspiration API", () => {
  it("generates three, expands to six once, persists selection, and rejects another expansion", async () => {
    const app = await setup();
    const user = await app.register("six@example.com");
    const first = await app.request("/prompt-ideas", "POST", { clientRequestId: "first-request-001", input: "小狗做饭" }, user.cookie);
    expect(first.status).toBe(201);
    const rootId = first.payload.ideaSet.id as string;
    await app.tick();
    const three = await app.request(`/prompt-ideas/${rootId}`, "GET", undefined, user.cookie);
    expect(three.payload.ideaSet.variants).toHaveLength(3);
    expect(three.payload.ideaSet.expansionState).toBeNull();
    const second = await app.request(`/prompt-ideas/${rootId}/more`, "POST", { clientRequestId: "more-request-001" }, user.cookie);
    expect(second).toMatchObject({ status: 201, payload: { ideaSet: { expansionState: "pending" } } });
    expect(second.payload.ideaSet.variants).toHaveLength(3);
    expect(app.creates[1].prompt).toContain(initial[0].prompt);
    const replay = await app.request(`/prompt-ideas/${rootId}/more`, "POST", { clientRequestId: "more-request-001" }, user.cookie);
    expect(replay.status).toBe(200);
    expect(app.creates).toHaveLength(2);
    await app.tick();
    const six = await app.request(`/prompt-ideas/${rootId}`, "GET", undefined, user.cookie);
    expect(six.payload.ideaSet.variants.map((item: { id: string }) => item.id)).toEqual([
      "variant-1", "variant-2", "variant-3", "variant-4", "variant-5", "variant-6"]);
    const selected = await app.request(`/prompt-ideas/${rootId}/selection`, "POST", { variantId: "variant-5", editedPrompt: "窗边小狗端汤" }, user.cookie);
    expect(selected.payload.ideaSet.selectedVariantId).toBe("variant-5");
    expect((await app.request("/prompt-ideas", "GET", undefined, user.cookie)).payload.ideaSets[0].variants).toHaveLength(6);
    expect((await app.request(`/prompt-ideas/${rootId}/more`, "POST", { clientRequestId: "more-request-002" }, user.cookie)).status).toBe(409);
    expect(app.creates).toHaveLength(2);
  });

  it("keeps both batches scoped to the owner and request IDs scoped to one root", async () => {
    const app = await setup();
    const a = await app.register("owner@example.com"), b = await app.register("other@example.com");
    const first = await app.request("/prompt-ideas", "POST", { clientRequestId: "first-request-002", input: "小狗做饭" }, a.cookie);
    const id = first.payload.ideaSet.id as string;
    await app.tick();
    expect((await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "more-request-003" }, b.cookie)).status).toBe(404);
    expect((await app.request(`/prompt-ideas/${id}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "first-request-002" }, a.cookie)).status).toBe(409);
    expect(app.creates).toHaveLength(1);
  });

  it("leaves the first three usable when the second batch duplicates them", async () => {
    const app = await setup({ second: initial });
    const user = await app.register("duplicate@example.com");
    const first = await app.request("/prompt-ideas", "POST", { clientRequestId: "first-request-003", input: "小狗做饭" }, user.cookie);
    const id = first.payload.ideaSet.id as string;
    await app.tick();
    await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "more-request-004" }, user.cookie);
    await app.tick();
    const result = await app.request(`/prompt-ideas/${id}`, "GET", undefined, user.cookie);
    expect(result.payload.ideaSet).toMatchObject({ state: "ready", expansionState: "failed" });
    expect(result.payload.ideaSet.variants).toHaveLength(3);
    expect((await app.request(`/prompt-ideas/${id}/selection`, "POST", { variantId: "variant-1", editedPrompt: "小狗在厨房切菜" }, user.cookie)).status).toBe(200);
  });

  it("retries a definitely failed expansion only when explicitly requested", async () => {
    const app = await setup({ secondStatus: "ERROR" });
    const user = await app.register("retry@example.com");
    const first = await app.request("/prompt-ideas", "POST", { clientRequestId: "first-request-004", input: "小狗做饭" }, user.cookie);
    const id = first.payload.ideaSet.id as string;
    await app.tick();
    await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "more-request-005" }, user.cookie);
    await app.tick();
    expect((await app.request(`/prompt-ideas/${id}`, "GET", undefined, user.cookie)).payload.ideaSet)
      .toMatchObject({ expansionState: "failed", variants: expect.any(Array) });
    expect((await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "more-request-005" }, user.cookie)).status).toBe(200);
    expect(app.creates).toHaveLength(2);
    expect((await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "more-request-006" }, user.cookie)).status).toBe(201);
    await app.tick();
    expect((await app.request(`/prompt-ideas/${id}`, "GET", undefined, user.cookie)).payload.ideaSet.variants).toHaveLength(6);
    expect(app.creates).toHaveLength(3);
  });

  it("recovers a lost expansion response by querying the same Cursor agent", async () => {
    const app = await setup({ loseSecondResponse: true });
    const user = await app.register("uncertain@example.com");
    const first = await app.request("/prompt-ideas", "POST", { clientRequestId: "first-request-005", input: "小狗做饭" }, user.cookie);
    const id = first.payload.ideaSet.id as string;
    await app.tick();
    const more = await app.request(`/prompt-ideas/${id}/more`, "POST", { clientRequestId: "more-request-007" }, user.cookie);
    expect(more.payload.ideaSet.expansionState).toBe("pending");
    await app.tick();
    expect((await app.request(`/prompt-ideas/${id}`, "GET", undefined, user.cookie)).payload.ideaSet.variants).toHaveLength(6);
    expect(app.creates).toHaveLength(2);
  });
});
