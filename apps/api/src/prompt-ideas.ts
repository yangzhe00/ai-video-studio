import { createHash, randomUUID } from "node:crypto";
import type { PgDatabase } from "./db.ts";
import type { ApiConfig } from "./config.ts";
import { IdeaModelError } from "./idea-result.ts";
import type { PromptVariant } from "./idea-result.ts";
import { createIdeaCursorRun } from "./idea-cursor.ts";

type IdeaState = "pending" | "ready" | "failed" | "unknown";
interface IdeaRow {
  id: string; owner_id: string; client_request_id: string; input_hash: string; input_text: string;
  state: IdeaState; variants_json: string | null; selected_variant_id: string | null;
  edited_prompt: string | null; model_id: string | null; usage_json: string | null;
  error_code: string | null; created_at: number; updated_at: number;
  provider: string; provider_session_id: string | null; provider_last_polled_at: number;
  provider_run_id: string | null; parent_idea_set_id: string | null;
}

export interface PromptIdeaSet {
  id: string; clientRequestId: string; input: string; state: IdeaState; variants: PromptVariant[];
  selectedVariantId: string | null; editedPrompt: string | null; createdAt: number; updatedAt: number;
  error: string | null; errorCode: string | null;
  expansionState: IdeaState | null; expansionError: string | null; expansionClientRequestId: string | null;
}

export class PromptIdeasError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const errorMessages: Record<string, string> = {
  not_configured: "灵感服务未配置，请稍后再试或手写提示词",
  provider_error: "灵感服务暂时不可用，请稍后再试或手写提示词",
  invalid_response: "灵感服务未返回可用的三版提示词，请开始新一轮或手写提示词",
  uncertain: "灵感请求结果待确认；为避免重复调用，请明确开始新一轮",
};

function rowToSnapshot(row: IdeaRow, expansion: IdeaRow | null = null): PromptIdeaSet {
  const original = row.variants_json ? JSON.parse(row.variants_json) as PromptVariant[] : [];
  const more = expansion?.state === "ready" && expansion.variants_json
    ? (JSON.parse(expansion.variants_json) as PromptVariant[]).map((item, index) => ({ ...item, id: `variant-${index + 4}` })) : [];
  return {
    id: row.id, clientRequestId: row.client_request_id, input: row.input_text, state: row.state,
    variants: [...original, ...more],
    selectedVariantId: row.selected_variant_id, editedPrompt: row.edited_prompt,
    createdAt: row.created_at, updatedAt: Math.max(row.updated_at, expansion?.updated_at ?? 0),
    error: row.error_code ? errorMessages[row.error_code] ?? "灵感服务暂时不可用" : null,
    errorCode: row.error_code,
    expansionState: expansion?.state ?? null,
    expansionError: expansion?.error_code ? errorMessages[expansion.error_code] ?? "新增灵感生成失败" : null,
    expansionClientRequestId: expansion?.client_request_id ?? null,
  };
}

async function latestExpansion(db: PgDatabase, rootId: string): Promise<IdeaRow | null> {
  return (await db.prepare("SELECT * FROM prompt_idea_sets WHERE parent_idea_set_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(rootId)) as IdeaRow | undefined ?? null;
}

async function rootSnapshot(db: PgDatabase, row: IdeaRow): Promise<PromptIdeaSet> {
  return rowToSnapshot(row, await latestExpansion(db, row.id));
}

async function findById(db: PgDatabase, ownerId: string, id: string): Promise<IdeaRow> {
  const row = (await db.prepare("SELECT * FROM prompt_idea_sets WHERE id=? AND owner_id=?").get(id, ownerId)) as IdeaRow | undefined;
  if (!row) throw new PromptIdeasError(404, "灵感草案不存在");
  return row;
}

async function expireStalePending(db: PgDatabase, ownerId: string, timeoutMs: number): Promise<void> {
  // A process may exit after persisting intent but before receiving the model response.
  // Once the bounded HTTP timeout and a small scheduling margin have passed, keep the
  // original request ID but stop presenting it as an active request. Never resubmit it.
  const maxAge = Math.min(Math.max(timeoutMs, 1_000), 120_000) + 5_000;
  const now = Date.now();
  (await db.prepare(`UPDATE prompt_idea_sets SET state='unknown',error_code='uncertain',updated_at=GREATEST(updated_at+1,?)
    WHERE owner_id=? AND state='pending' AND provider_session_id IS NULL AND created_at<=?`).run(now, ownerId, now - maxAge));
}

export async function getPromptIdea(db: PgDatabase, ownerId: string, id: string, timeoutMs = 30_000): Promise<PromptIdeaSet> {
  (await expireStalePending(db, ownerId, timeoutMs));
  const row = await findById(db, ownerId, id);
  return rootSnapshot(db, row.parent_idea_set_id ? await findById(db, ownerId, row.parent_idea_set_id) : row);
}

export async function listPromptIdeas(db: PgDatabase, ownerId: string, timeoutMs = 30_000): Promise<PromptIdeaSet[]> {
  (await expireStalePending(db, ownerId, timeoutMs));
  const rows = (await db.prepare("SELECT * FROM prompt_idea_sets WHERE owner_id=? AND parent_idea_set_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 30").all(ownerId)) as unknown as IdeaRow[];
  return Promise.all(rows.map(row => rootSnapshot(db, row)));
}

export async function createPromptIdea(db: PgDatabase, ownerId: string, config: ApiConfig, body: Record<string, unknown>): Promise<{ ideaSet: PromptIdeaSet; replayed: boolean }> {
  const id = body.clientRequestId;
  const rawInput = body.input;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new PromptIdeasError(400, "请求 ID 无效");
  if (typeof rawInput !== "string") throw new PromptIdeasError(400, "请输入一句想法或关键词");
  const input = rawInput.trim();
  if (!input || Array.from(input).length > 200) throw new PromptIdeasError(400, "想法长度需为 1 到 200 字");
  const inputHash = createHash("sha256").update(input).digest("hex");
  const reservation = await db.transaction(async () => {
  try {
    await db.lock("ideas-daily");
    (await expireStalePending(db, ownerId, config.ideaModelTimeoutMs ?? 30_000));
    const existing = (await db.prepare("SELECT * FROM prompt_idea_sets WHERE owner_id=? AND client_request_id=?").get(ownerId, id)) as IdeaRow | undefined;
    if (existing) {
      if (existing.input_hash !== inputHash) throw new PromptIdeasError(409, "请求 ID 已用于其他想法，请开始新一轮");

      return { row: existing, replayed: true };
    }
    const since = Date.now() - 86_400_000;
    const ownerCount = ((await db.prepare("SELECT COUNT(*) AS count FROM prompt_idea_sets WHERE owner_id=? AND created_at>=?").get(ownerId, since)) as { count: number }).count;
    const platformCount = ((await db.prepare("SELECT COUNT(*) AS count FROM prompt_idea_sets WHERE created_at>=?").get(since)) as { count: number }).count;
    if (ownerCount >= (config.ideaDailyLimit ?? 20)) throw new PromptIdeasError(429, "今日灵感次数已用完，请明天再试或手写提示词");
    if (platformCount >= (config.ideaPlatformDailyLimit ?? 200)) throw new PromptIdeasError(503, "今日平台灵感额度已用完，请稍后再试或手写提示词");
    const now = Date.now();
    const row: IdeaRow = { id: randomUUID(), owner_id: ownerId, client_request_id: id, input_hash: inputHash, input_text: input,
      state: "pending", variants_json: null, selected_variant_id: null, edited_prompt: null,
      model_id: config.ideaCursorModel ?? null,
      usage_json: null, error_code: null, created_at: now, updated_at: now,
      provider: "cursor", provider_session_id: null,
      provider_run_id: null, provider_last_polled_at: 0, parent_idea_set_id: null };
    row.provider_session_id = `bc-${row.id}`;
    (await db.prepare(`INSERT INTO prompt_idea_sets
      (id,owner_id,client_request_id,input_hash,input_text,state,variants_json,selected_variant_id,edited_prompt,model_id,usage_json,error_code,created_at,updated_at,provider,provider_session_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.owner_id, row.client_request_id, row.input_hash, row.input_text, row.state,
        null, null, null, row.model_id, null, null, row.created_at, row.updated_at, row.provider, row.provider_session_id));
    return { row, replayed: false };
  } catch (error) {  throw error; }
});
  if (reservation.replayed) return { ideaSet: await getPromptIdea(db, ownerId, reservation.row.id), replayed: true };
  const row = reservation.row;

  // The pending row is durable before the external model request. Never hold a write transaction across HTTP.
  try {
    const { runId } = await createIdeaCursorRun(config, input, row.id);
    (await db.prepare("UPDATE prompt_idea_sets SET provider_run_id=?,updated_at=GREATEST(updated_at+1,?) WHERE id=? AND state='pending'")
      .run(runId, Date.now(), row.id));
    return { ideaSet: (await getPromptIdea(db, ownerId, row.id, config.ideaModelTimeoutMs)), replayed: false };
  } catch (error) {
    const code = error instanceof IdeaModelError ? error.code : "uncertain";
    if (code === "uncertain") {
      return { ideaSet: (await getPromptIdea(db, ownerId, row.id, config.ideaModelTimeoutMs)), replayed: false };
    }
    (await db.prepare("UPDATE prompt_idea_sets SET state='failed',error_code=?,updated_at=GREATEST(updated_at+1,?) WHERE id=? AND state='pending'")
      .run(code, Date.now(), row.id));
  }
  return { ideaSet: (await getPromptIdea(db, ownerId, row.id, config.ideaModelTimeoutMs)), replayed: false };
}

export async function createMorePromptIdeas(db: PgDatabase, ownerId: string, config: ApiConfig, rootId: string,
  body: Record<string, unknown>): Promise<{ ideaSet: PromptIdeaSet; replayed: boolean }> {
  const requestId = body.clientRequestId;
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw new PromptIdeasError(400, "请求 ID 无效");
  const reserved = await db.transaction(async () => {
    await db.lock("ideas-daily");
    const root = await findById(db, ownerId, rootId);
    if (root.parent_idea_set_id) throw new PromptIdeasError(400, "请选择原始灵感任务");
    if (root.state !== "ready") throw new PromptIdeasError(409, "请等待最初三条灵感生成完成");
    const original = root.variants_json ? JSON.parse(root.variants_json) as PromptVariant[] : [];
    if (original.length !== 3) throw new PromptIdeasError(409, "原始灵感不完整，无法生成更多");
    const replay = (await db.prepare("SELECT * FROM prompt_idea_sets WHERE owner_id=? AND client_request_id=?").get(ownerId, requestId)) as IdeaRow | undefined;
    if (replay) {
      if (replay.parent_idea_set_id !== root.id) throw new PromptIdeasError(409, "请求 ID 已用于其他灵感");
      return { root, row: replay, original, replayed: true };
    }
    const active = (await db.prepare("SELECT id FROM prompt_idea_sets WHERE parent_idea_set_id=? AND state IN ('pending','ready','unknown') LIMIT 1").get(root.id)) as { id: string } | undefined;
    if (active) throw new PromptIdeasError(409, "这组灵感已达到六条，或新增任务仍待确认");
    const since = Date.now() - 86_400_000;
    const ownerCount = ((await db.prepare("SELECT COUNT(*) AS count FROM prompt_idea_sets WHERE owner_id=? AND created_at>=?").get(ownerId, since)) as { count: number }).count;
    const platformCount = ((await db.prepare("SELECT COUNT(*) AS count FROM prompt_idea_sets WHERE created_at>=?").get(since)) as { count: number }).count;
    if (ownerCount >= (config.ideaDailyLimit ?? 20)) throw new PromptIdeasError(429, "今日灵感次数已用完，请明天再试");
    if (platformCount >= (config.ideaPlatformDailyLimit ?? 200)) throw new PromptIdeasError(503, "今日平台灵感额度已用完，请稍后再试");
    const newest = (await db.prepare("SELECT MAX(created_at) AS latest FROM prompt_idea_sets WHERE parent_idea_set_id=?").get(root.id)) as { latest: number | null };
    const now = Math.max(Date.now(), (newest.latest ?? 0) + 1);
    const row: IdeaRow = { id: randomUUID(), owner_id: ownerId, client_request_id: requestId,
      input_hash: createHash("sha256").update(`${root.id}:${root.input_hash}`).digest("hex"), input_text: root.input_text,
      state: "pending", variants_json: null, selected_variant_id: null, edited_prompt: null,
      model_id: config.ideaCursorModel ?? null, usage_json: null, error_code: null, created_at: now, updated_at: now,
      provider: "cursor", provider_session_id: null, provider_run_id: null, provider_last_polled_at: 0, parent_idea_set_id: root.id };
    row.provider_session_id = `bc-${row.id}`;
    await db.prepare(`INSERT INTO prompt_idea_sets
      (id,owner_id,client_request_id,input_hash,input_text,state,variants_json,selected_variant_id,edited_prompt,model_id,usage_json,error_code,created_at,updated_at,provider,provider_session_id,parent_idea_set_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.owner_id, row.client_request_id, row.input_hash, row.input_text,
      row.state, null, null, null, row.model_id, null, null, now, now, row.provider, row.provider_session_id, root.id);
    return { root, row, original, replayed: false };
  });
  if (reserved.replayed) return { ideaSet: await getPromptIdea(db, ownerId, rootId), replayed: true };
  try {
    const { runId } = await createIdeaCursorRun(config, reserved.root.input_text, reserved.row.id, reserved.original);
    await db.prepare("UPDATE prompt_idea_sets SET provider_run_id=?,updated_at=GREATEST(updated_at+1,?) WHERE id=? AND state='pending'")
      .run(runId, Date.now(), reserved.row.id);
  } catch (error) {
    const code = error instanceof IdeaModelError ? error.code : "uncertain";
    if (code !== "uncertain") await db.prepare("UPDATE prompt_idea_sets SET state='failed',error_code=?,updated_at=GREATEST(updated_at+1,?) WHERE id=? AND state='pending'")
      .run(code, Date.now(), reserved.row.id);
  }
  return { ideaSet: await getPromptIdea(db, ownerId, rootId), replayed: false };
}

export async function selectPromptIdea(db: PgDatabase, ownerId: string, id: string, body: Record<string, unknown>): Promise<PromptIdeaSet> {
  const row = (await findById(db, ownerId, id));
  if (row.parent_idea_set_id) throw new PromptIdeasError(400, "请选择原始灵感任务");
  if (row.state !== "ready") throw new PromptIdeasError(409, "这轮灵感尚未生成成功");
  const variantId = body.variantId, editedPrompt = body.editedPrompt;
  if (typeof variantId !== "string" || !(await rootSnapshot(db, row)).variants.some(item => item.id === variantId)) {
    throw new PromptIdeasError(400, "请选择本轮的一个提示词");
  }
  if (typeof editedPrompt !== "string" || !editedPrompt.trim() || Array.from(editedPrompt.trim()).length > 2000) {
    throw new PromptIdeasError(400, "最终提示词长度需为 1 到 2000 字");
  }
  (await db.prepare("UPDATE prompt_idea_sets SET selected_variant_id=?,edited_prompt=?,updated_at=GREATEST(updated_at+1,?) WHERE id=? AND owner_id=?")
    .run(variantId, editedPrompt.trim(), Date.now(), id, ownerId));
  return (await getPromptIdea(db, ownerId, id));
}
