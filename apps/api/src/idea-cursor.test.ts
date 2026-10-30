import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiConfig } from "./config.ts";
import { createTestDb as createDb, testDatabaseUrl, dropTestSchema } from "./test-db.ts";
import { IdeaAgentWorker } from "./idea-agent-worker.ts";
import { createPromptIdea } from "./prompt-ideas.ts";
import { createIdeaCursorRun, readIdeaCursorRun } from "./idea-cursor.ts";

const config: ApiConfig = { dataDir: "/tmp/cursor-test", databaseUrl: "postgresql://unused", sessionSecret: "x".repeat(32),
  ideaProvider: "cursor", ideaCursorApiKey: "cursor-test-key", ideaCursorBaseUrl: "http://127.0.0.1:8788/v1" };
const variants = [
  { title: "叙事", description: "完整动作", prompt: "小狗在厨房切菜，固定镜头。" },
  { title: "温暖", description: "暖光氛围", prompt: "小狗在暖光厨房切菜，近景镜头。" },
  { title: "轻快", description: "轻快节奏", prompt: "小狗快速切菜，轻快推镜。" },
];
const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch;
const agentId = "bc-00000000-0000-4000-8000-000000000001";
const runId = "run-00000000-0000-4000-8000-000000000002";

describe("Cursor Cloud Agent inspiration adapter", () => {
  it("creates one no-repo agent with the default model and server credential", async () => {
    const fetcher = mockFetch(() => Response.json({ agent: { id: agentId }, run: { id: runId, agentId } }));
    expect(await createIdeaCursorRun(config, "小狗做饭", agentId.slice(3), fetcher)).toEqual({ agentId, runId });
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8788/v1/agents");
    expect(init?.headers).toMatchObject({ authorization: "Bearer cursor-test-key" });
    const body = JSON.parse(String(init?.body));
    expect(body.agentId).toBe(agentId);
    expect(body.prompt.text).toContain("小狗做饭");
    expect(body.prompt.text).toContain("JSON");
    expect(body.model).toBeUndefined();
    expect(body.repos).toBeUndefined();
    expect(body.env).toBeUndefined();
  });

  it("passes an explicit API model id when configured", async () => {
    const fetcher = mockFetch(() => Response.json({ agent: { id: agentId }, run: { id: runId, agentId } }));
    await createIdeaCursorRun({ ...config, ideaCursorModel: "model-from-api" }, "小狗做饭", agentId.slice(3), fetcher);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body)).model).toEqual({ id: "model-from-api" });
  });

  it("recovers a lost create response via deterministic agent id, then validates the finished run", async () => {
    const fetcher = mockFetch(url => url.endsWith(`/agents/${agentId}`)
      ? Response.json({ id: agentId, latestRunId: runId })
      : Response.json({ id: runId, agentId, status: "FINISHED", result: JSON.stringify({ variants }) }));
    const result = await readIdeaCursorRun(config, agentId, null, fetcher);
    expect(result).toMatchObject({ state: "ready", runId, result: { variants: [
      { id: "variant-1" }, { id: "variant-2" }, { id: "variant-3" } ] } });
  });

  it("keeps active runs pending and rejects terminal errors or malformed output", async () => {
    const fetcher = mockFetch(() => Response.json({ id: runId, agentId, status: "RUNNING" }));
    expect(await readIdeaCursorRun(config, agentId, runId, fetcher)).toEqual({ state: "pending", runId });
    const failed = mockFetch(() => Response.json({ id: runId, agentId, status: "ERROR" }));
    await expect(readIdeaCursorRun(config, agentId, runId, failed)).rejects.toMatchObject({ code: "provider_error" });
    const bad = mockFetch(() => Response.json({ id: runId, agentId, status: "FINISHED", result: "not-json" }));
    await expect(readIdeaCursorRun(config, agentId, runId, bad)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not send a request without a key and classifies uncertain create responses", async () => {
    const fetcher = mockFetch(() => Response.json({ error: "unauthorized" }, { status: 401 }));
    await expect(createIdeaCursorRun({ ...config, ideaCursorApiKey: undefined }, "小狗做饭", agentId.slice(3), fetcher))
      .rejects.toMatchObject({ code: "not_configured" });
    expect(vi.mocked(fetcher)).not.toHaveBeenCalled();
    await expect(createIdeaCursorRun(config, "小狗做饭", agentId.slice(3), fetcher))
      .rejects.toMatchObject({ code: "provider_error" });
    const conflict = mockFetch(() => Response.json({ error: "exists" }, { status: 409 }));
    await expect(createIdeaCursorRun(config, "小狗做饭", agentId.slice(3), conflict))
      .rejects.toMatchObject({ code: "uncertain" });
  });
});

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("persists Cursor agent and run IDs, and replays the request without a second create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "avs-cursor-create-")); dirs.push(dir);
  const db = (await createDb(dir));
  (await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run("owner-1", "owner@example.com", "hash", 1, 3));
  const fetcher = mockFetch((_url, init) => Response.json({
    agent: { id: JSON.parse(String(init?.body)).agentId }, run: { id: runId, agentId: JSON.parse(String(init?.body)).agentId },
  }));
  vi.stubGlobal("fetch", fetcher);
  const body = { clientRequestId: "request-001", input: "小狗做饭" };
  const first = await createPromptIdea(db, "owner-1", config, body);
  const replay = await createPromptIdea(db, "owner-1", config, body);
  expect(first.ideaSet.state).toBe("pending");
  expect(replay.ideaSet.id).toBe(first.ideaSet.id);
  expect(replay.replayed).toBe(true);
  expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
  expect((await db.prepare("SELECT provider,provider_session_id,provider_run_id FROM prompt_idea_sets WHERE id=?").get(first.ideaSet.id)))
    .toEqual({ provider: "cursor", provider_session_id: `bc-${first.ideaSet.id}`, provider_run_id: runId });
  (await db.close());
});

it("reconciles an uncertain Cursor create after restart without another POST", async () => {
  const dir = mkdtempSync(join(tmpdir(), "avs-cursor-recover-")); dirs.push(dir);
  const db = (await createDb(dir));
  (await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run("owner-1", "owner@example.com", "hash", 1, 3));
  (await db.prepare(`INSERT INTO prompt_idea_sets
    (id,owner_id,client_request_id,input_hash,input_text,state,created_at,updated_at,provider,provider_session_id)
    VALUES (?,?,?,?,?,'pending',?,?, 'cursor',?)`).run(agentId.slice(3), "owner-1", "request-001",
    createHash("sha256").update("小狗做饭").digest("hex"), "小狗做饭", Date.now(), Date.now(), agentId));
  (await db.close());
  const reopened = (await createDb(dir));
  const fetcher = mockFetch(url => url.endsWith(`/agents/${agentId}`)
    ? Response.json({ id: agentId, latestRunId: runId })
    : Response.json({ id: runId, agentId, status: "FINISHED", result: JSON.stringify({ variants }) }));
  vi.stubGlobal("fetch", fetcher);
  await new IdeaAgentWorker(reopened, config).tick();
  expect(vi.mocked(fetcher).mock.calls.every(([url]) => String(url).includes(`/agents/${agentId}`))).toBe(true);
  expect((await reopened.prepare("SELECT state,provider_run_id FROM prompt_idea_sets WHERE id=?").get(agentId.slice(3))))
    .toEqual({ state: "ready", provider_run_id: runId });
  reopened.close();
});

it("keeps an uncertain Cursor create pending so a later poll can reconcile it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "avs-cursor-uncertain-")); dirs.push(dir);
  const db = (await createDb(dir));
  (await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run("owner-1", "owner@example.com", "hash", 1, 3));
  const fetcher = mockFetch(() => Response.json({ error: "already exists" }, { status: 409 }));
  vi.stubGlobal("fetch", fetcher);
  const body = { clientRequestId: "request-001", input: "小狗做饭" };
  const first = await createPromptIdea(db, "owner-1", config, body);
  const replay = await createPromptIdea(db, "owner-1", config, body);
  expect(first.ideaSet.state).toBe("pending");
  expect(replay.replayed).toBe(true);
  expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
  expect((await db.prepare("SELECT provider_session_id,provider_run_id FROM prompt_idea_sets WHERE id=?").get(first.ideaSet.id)))
    .toEqual({ provider_session_id: `bc-${first.ideaSet.id}`, provider_run_id: null });
  (await db.close());
});
