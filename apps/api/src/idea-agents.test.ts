import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createDb } from "./db.ts";
import type { ApiConfig } from "./config.ts";
import { createIdeaAgentSession, readIdeaAgentSession } from "./idea-agents.ts";
import { IdeaAgentWorker } from "./idea-agent-worker.ts";
import { createPromptIdea } from "./prompt-ideas.ts";

const config: ApiConfig = {
  dataDir: "/tmp/idea-agent-test", sessionSecret: "x".repeat(32), ideaProvider: "agents",
  ideaAgentApiKey: "test-secret", ideaAgentModel: "test-agent-model", ideaAgentBaseUrl: "http://127.0.0.1:8788/v1",
};
const variants = [
  { title: "叙事", description: "动作完整", prompt: "小狗在厨房切菜，固定镜头。" },
  { title: "温暖", description: "突出氛围", prompt: "小狗在暖光厨房切菜，近景镜头。" },
  { title: "轻快", description: "突出节奏", prompt: "小狗快速切菜，轻快推镜。" },
];
const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch;

describe("Codex Agents idea adapter", () => {
  it("creates one no-tools session with structured three-script output", async () => {
    const fetcher = mockFetch(() => Response.json({ id: "session_001", status: "in_progress" }));
    const id = await createIdeaAgentSession(config, "小狗做饭", "idea-001", fetcher);
    expect(id).toBe("session_001");
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8788/v1/agents/sessions");
    expect(init?.headers).toMatchObject({ authorization: "Bearer test-secret", "OpenAI-Beta": "agents=v1" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ agent: { model: "test-agent-model", tools: [],
      text: { format: { type: "json_schema" } } }, environment: { type: "none" }, input: "小狗做饭",
      metadata: { idea_set_id: "idea-001" } });
  });

  it("waits for completed root turn, then reads its final answer and validates three scripts", async () => {
    let status = "in_progress";
    const fetcher = mockFetch(url => {
      if (url.endsWith("/session_001")) return Response.json({ status });
      if (url.includes("/turns?")) return Response.json({ data: [{ id: "turn_001", status: "completed", subagent_id: null, usage: { output_tokens: 50 } }] });
      return Response.json({ data: [{ type: "message", role: "assistant", phase: "final_answer", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({ variants }) }] }] });
    });
    expect(await readIdeaAgentSession(config, "session_001", fetcher)).toEqual({ state: "pending" });
    status = "idle";
    const ready = await readIdeaAgentSession(config, "session_001", fetcher);
    expect(ready).toMatchObject({ state: "ready", result: { usage: { output_tokens: 50 }, variants: [
      { id: "variant-1" }, { id: "variant-2" }, { id: "variant-3" } ] } });
  });

  it("rejects invalid final output and does not mistake idle for success", async () => {
    const noTurn = mockFetch(url => Response.json(url.includes("/turns?") ? { data: [] } : { status: "idle" }));
    expect(await readIdeaAgentSession(config, "session_001", noTurn)).toEqual({ state: "pending" });
    const bad = mockFetch(url => Response.json(url.endsWith("/session_001") ? { status: "idle" }
      : url.includes("/turns?") ? { data: [{ id: "turn_001", status: "completed" }] }
        : { data: [{ type: "message", role: "assistant", phase: "final_answer", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({ variants: [variants[0], variants[0], variants[2]] }) }] }] }));
    await expect(readIdeaAgentSession(config, "session_001", bad)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("keeps the credential server-side and distinguishes missing key from provider rejection", async () => {
    const fetcher = mockFetch(() => Response.json({ error: "forbidden" }, { status: 403 }));
    await expect(createIdeaAgentSession({ ...config, ideaAgentApiKey: undefined }, "小狗做饭", "idea-001", fetcher))
      .rejects.toMatchObject({ code: "not_configured" });
    expect(vi.mocked(fetcher)).not.toHaveBeenCalled();
    await expect(createIdeaAgentSession(config, "小狗做饭", "idea-001", fetcher))
      .rejects.toMatchObject({ code: "provider_error" });
  });
});

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("persists one Agents session and replays the same idea request without another create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "avs-agent-create-")); dirs.push(dir);
  const db = createDb(dir);
  db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run("owner-1", "owner@example.com", "hash", 1, 3);
  const fetcher = mockFetch(() => Response.json({ id: "session_001", status: "in_progress" }));
  vi.stubGlobal("fetch", fetcher);
  const body = { clientRequestId: "request-001", input: "小狗做饭" };
  const first = await createPromptIdea(db, "owner-1", config, body);
  const replay = await createPromptIdea(db, "owner-1", config, body);
  expect(first.ideaSet.state).toBe("pending");
  expect(replay.ideaSet.id).toBe(first.ideaSet.id);
  expect(replay.replayed).toBe(true);
  expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
  expect(db.prepare("SELECT provider_session_id FROM prompt_idea_sets WHERE id=?").get(first.ideaSet.id))
    .toEqual({ provider_session_id: "session_001" });
  db.close();
});

it("reconciles a saved session after restart without submitting another one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "avs-agent-recovery-")); dirs.push(dir);
  const db = createDb(dir);
  db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run("owner-1", "owner@example.com", "hash", 1, 3);
  const input = "小狗做饭";
  db.prepare(`INSERT INTO prompt_idea_sets
    (id,owner_id,client_request_id,input_hash,input_text,state,created_at,updated_at,provider,provider_session_id)
    VALUES (?,?,?,?,?,'pending',?,?, 'agents',?)`).run("idea-001", "owner-1", "request-001",
    createHash("sha256").update(input).digest("hex"), input, Date.now(), Date.now(), "session_001");
  db.close();
  const reopened = createDb(dir);
  const read = vi.fn(async () => ({ state: "ready" as const, result: { variants: variants.map((value, index) => ({ id: `variant-${index + 1}`, ...value })), usage: { output_tokens: 50 } } }));
  await new IdeaAgentWorker(reopened, config, read).tick();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(config, "session_001");
  expect(reopened.prepare("SELECT state,provider_session_id FROM prompt_idea_sets WHERE id='idea-001'").get())
    .toEqual({ state: "ready", provider_session_id: "session_001" });
  reopened.close();
});
