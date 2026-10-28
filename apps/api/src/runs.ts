import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { planImageVideo } from "@ai-video/agent-core";
import type { ImageVideoIntent, RunEvent, RunState } from "@ai-video/agent-core";

export class RunError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface RunRow {
  id: string; owner_id: string; project_id: string; episode_id: string; source_object_id: string;
  prompt: string; duration_sec: number; plan_json: string; plan_hash: string; state: RunState;
  created_at: number; updated_at: number;
}

function toSnapshot(db: DatabaseSync, row: RunRow) {
  const operation = db.prepare("SELECT id, state, external_task_id, remote_task_id FROM operations WHERE run_id=?")
    .get(row.id) as { id: string; state: string; external_task_id: string; remote_task_id: string | null } | undefined;
  return {
    runId: row.id, projectId: row.project_id, episodeId: row.episode_id,
    sourceAssetId: row.source_object_id, input: row.prompt, durationSec: row.duration_sec,
    state: row.state, plan: JSON.parse(row.plan_json), planHash: row.plan_hash,
    operation: operation ? { id: operation.id, state: operation.state, externalTaskId: operation.external_task_id, remoteTaskId: operation.remote_task_id } : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function appendEvent(db: DatabaseSync, runId: string, state: RunState, message: string, result?: RunEvent["result"]) {
  const row = db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS seq FROM run_events WHERE run_id=?").get(runId) as { seq: number };
  db.prepare("INSERT INTO run_events (run_id,seq,state,message,result_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(runId, row.seq, state, message, result ? JSON.stringify(result) : null, Date.now());
}

export function createRun(db: DatabaseSync, ownerId: string, projectId: string, body: Record<string, unknown>) {
  if (!validId(body.clientRequestId) || !validId(body.episodeId) || !validId(body.sourceAssetId)) {
    throw new RunError(400, "请求、分集或照片 ID 无效");
  }
  const intent: ImageVideoIntent = {
    clientRequestId: body.clientRequestId, episodeId: body.episodeId, sourceAssetId: body.sourceAssetId,
    input: typeof body.input === "string" ? body.input : "",
    durationSec: body.durationSec as 5 | 10,
  };
  let plan: ReturnType<typeof planImageVideo>;
  try { plan = planImageVideo(intent); }
  catch (error) { throw new RunError(400, String(error).replace(/^Error: /, "")); }
  const project = db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?").get(projectId, ownerId) as { document_json: string } | undefined;
  if (!project) throw new RunError(404, "项目不存在");
  const document = JSON.parse(project.document_json) as { episodes?: { id: string }[] };
  if (!document.episodes?.some(episode => episode.id === intent.episodeId)) throw new RunError(400, "目标分集不存在");
  const object = db.prepare("SELECT mime FROM objects WHERE id=? AND owner_id=?").get(intent.sourceAssetId, ownerId) as { mime: string } | undefined;
  if (!object || !["image/jpeg", "image/png"].includes(object.mime)) throw new RunError(400, "参考照片需为 JPG 或 PNG");
  const requestHash = digest({ projectId, ...intent, input: intent.input.trim() });
  const existing = db.prepare("SELECT * FROM agent_runs WHERE owner_id=? AND client_request_id=?").get(ownerId, intent.clientRequestId) as RunRow & { request_hash: string } | undefined;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new RunError(409, "同一请求 ID 对应不同输入");
    return toSnapshot(db, existing);
  }
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO agent_runs (id,owner_id,project_id,client_request_id,request_hash,episode_id,source_object_id,prompt,duration_sec,plan_json,plan_hash,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, ownerId, projectId, intent.clientRequestId, requestHash, intent.episodeId, intent.sourceAssetId,
        intent.input.trim(), intent.durationSec, JSON.stringify(plan), digest(plan), "waiting_approval", now, now);
    appendEvent(db, id, "waiting_approval", "镜头计划已准备好，等待确认演示额度");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (String(error).includes("UNIQUE")) {
      const race = db.prepare("SELECT * FROM agent_runs WHERE owner_id=? AND client_request_id=?").get(ownerId, intent.clientRequestId) as RunRow & { request_hash: string } | undefined;
      if (race?.request_hash === requestHash) return toSnapshot(db, race);
      throw new RunError(409, "同一请求 ID 对应不同输入");
    }
    throw error;
  }
  return getRun(db, ownerId, id);
}

export function getRun(db: DatabaseSync, ownerId: string, runId: string) {
  const row = db.prepare("SELECT * FROM agent_runs WHERE id=? AND owner_id=?").get(runId, ownerId) as RunRow | undefined;
  if (!row) throw new RunError(404, "任务不存在");
  return toSnapshot(db, row);
}

export function approveRun(db: DatabaseSync, ownerId: string, runId: string, body: Record<string, unknown>) {
  if (!validId(body.approvalId) || typeof body.planHash !== "string") throw new RunError(400, "确认请求无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    const run = db.prepare("SELECT * FROM agent_runs WHERE id=? AND owner_id=?").get(runId, ownerId) as RunRow | undefined;
    if (!run) throw new RunError(404, "任务不存在");
    if (run.plan_hash !== body.planHash) throw new RunError(409, "镜头计划已变化，请重新确认");
    const existing = db.prepare("SELECT approval_id FROM operations WHERE run_id=?").get(runId) as { approval_id: string } | undefined;
    if (existing) {
      if (existing.approval_id !== body.approvalId) throw new RunError(409, "任务已经确认过");
      db.exec("COMMIT");
      return getRun(db, ownerId, runId);
    }
    if (run.state !== "waiting_approval") throw new RunError(409, "任务当前不能确认");
    const reserved = db.prepare("UPDATE accounts SET demo_reserved=demo_reserved+1 WHERE id=? AND demo_reserved+demo_used<demo_quota").run(ownerId);
    if (!reserved.changes) throw new RunError(403, "演示额度已用完");
    const operationId = randomUUID();
    db.prepare("INSERT INTO operations (id,run_id,approval_id,state,external_task_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(operationId, runId, body.approvalId, "pending_submit", operationId, Date.now());
    db.prepare("UPDATE agent_runs SET state='pending_submit',updated_at=? WHERE id=?").run(Date.now(), runId);
    appendEvent(db, runId, "pending_submit", "已确认，将消耗一次演示额度；等待云端提交");
    db.exec("COMMIT");
    return getRun(db, ownerId, runId);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listRunEvents(db: DatabaseSync, ownerId: string, runId: string, after: number): RunEvent[] {
  getRun(db, ownerId, runId);
  const rows = db.prepare("SELECT seq,state,message,result_json,created_at FROM run_events WHERE run_id=? AND seq>? ORDER BY seq")
    .all(runId, after) as { seq: number; state: RunState; message: string; result_json: string | null; created_at: number }[];
  return rows.map(row => ({ runId, seq: row.seq, state: row.state, message: row.message, createdAt: row.created_at,
    ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}) }));
}
