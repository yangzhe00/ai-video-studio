import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiConfig } from "./config.ts";
import type { PgDatabase } from "./db.ts";
import { inspectMediaFile } from "./media-inspect.ts";
import { storeObject } from "./object-capacity.ts";
import type { KlingTtsGateway, TtsProviderTask } from "./kling-tts.ts";
import { ttsVoices } from "./tts-voices.ts";

export class TtsError extends Error {
  constructor(readonly status: number, message: string,
    readonly code?: "billing_unavailable" | "task_uncertain") { super(message); }
}

interface TtsRow {
  id: string; owner_id: string; project_id: string; client_request_id: string; request_hash: string;
  text_content: string; voice_id: string; voice_language: "zh" | "en"; speed: number;
  state: "pending" | "submitting" | "unknown" | "running" | "succeeded" | "failed";
  provider_task_id: string | null; provider_request_id: string | null; result_object_id: string | null;
  cost_status: "unbilled" | "pending" | "billed" | "unknown";
  estimated_cost_json: string | null; actual_cost_json: string | null; error: string | null;
  created_at: number; updated_at: number; last_polled_at: number;
}

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quoteBucket = (now: number) => Math.floor(now / 300_000);
function quoteId(secret: string, ownerId: string, projectId: string, body: Record<string, unknown>,
  bucket: number): string {
  return createHmac("sha256", secret).update(JSON.stringify({ ownerId, projectId,
    textHash: sha(body.text), voiceId: body.voiceId, voiceLanguage: body.voiceLanguage,
    speed: body.speed, billingPolicy: "actual-usage", bucket })).digest("hex").slice(0, 40);
}

function snapshot(row: TtsRow) {
  return { id: row.id, projectId: row.project_id, clientRequestId: row.client_request_id,
    state: row.state, voiceAssetId: row.result_object_id, providerTaskId: row.provider_task_id,
    costStatus: row.cost_status, actualCost: row.actual_cost_json ? JSON.parse(row.actual_cost_json) as unknown : null,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function estimateTts(db: PgDatabase, ownerId: string, projectId: string,
  config: ApiConfig, body: Record<string, unknown>, now = Date.now()) {
  const project = await db.prepare("SELECT id FROM projects WHERE id=? AND owner_id=?").get(projectId, ownerId);
  if (!project) throw new TtsError(404, "项目不存在");
  if (!ttsVoices(config).some(voice => voice.id === body.voiceId && voice.language === body.voiceLanguage)) {
    throw new TtsError(400, "配音音色或语言不在当前可用列表中");
  }
  const bucket = quoteBucket(now);
  return { id: quoteId(config.sessionSecret, ownerId, projectId, body, bucket),
    projectId, textHash: sha(body.text), voiceId: body.voiceId as string,
    voiceLanguage: body.voiceLanguage as "zh" | "en", speed: body.speed as number,
    estimatedCost: null, billingPolicy: "actual-usage", expiresAt: (bucket + 2) * 300_000 };
}

export async function getTtsTask(db: PgDatabase, ownerId: string, taskId: string) {
  const row = await db.prepare("SELECT * FROM tts_tasks WHERE id=? AND owner_id=?").get(taskId, ownerId) as TtsRow | undefined;
  if (!row) throw new TtsError(404, "配音任务不存在");
  return snapshot(row);
}

export async function getTtsTaskByRequest(db: PgDatabase, ownerId: string, projectId: string, clientRequestId: string) {
  const row = await db.prepare("SELECT * FROM tts_tasks WHERE owner_id=? AND project_id=? AND client_request_id=?")
    .get(ownerId, projectId, clientRequestId) as TtsRow | undefined;
  if (!row) throw new TtsError(404, "配音任务不存在");
  return snapshot(row);
}

export async function createTtsTask(db: PgDatabase, ownerId: string, projectId: string,
  config: ApiConfig, body: Record<string, unknown>, now = Date.now()) {
  const requestHash = sha({ projectId, text: body.text, voiceId: body.voiceId,
    voiceLanguage: body.voiceLanguage, speed: body.speed });
  return db.transaction(async () => {
    await db.lock(`tts-create:${ownerId}:${body.clientRequestId}`);
    const previous = await db.prepare("SELECT * FROM tts_tasks WHERE owner_id=? AND client_request_id=?")
      .get(ownerId, body.clientRequestId) as TtsRow | undefined;
    if (previous) {
      if (previous.request_hash !== requestHash) throw new TtsError(409, "请求 ID 已用于其他配音内容");
      return { task: snapshot(previous), replayed: true };
    }
    const estimate = await estimateTts(db, ownerId, projectId, config, body, now);
    const currentBucket = quoteBucket(now);
    const matched = [currentBucket, currentBucket - 1].some(bucket =>
      quoteId(config.sessionSecret, ownerId, projectId, body, bucket) === body.estimateId &&
      now < (bucket + 2) * 300_000);
    if (!matched) throw new TtsError(409, "配音费用预估已过期，请重新确认");
    const id = randomUUID();
    await db.prepare(`INSERT INTO tts_tasks (id,owner_id,project_id,client_request_id,request_hash,text_content,
      voice_id,voice_language,speed,state,cost_status,estimated_cost_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'pending','unbilled',?,?,?)`).run(id, ownerId, projectId,
      body.clientRequestId, requestHash, body.text, body.voiceId, body.voiceLanguage, body.speed,
      null, now, now);
    return { task: await getTtsTask(db, ownerId, id), replayed: false };
  });
}

export class TtsWorker {
  private active = new Set<string>();
  constructor(private readonly db: PgDatabase, private readonly dataDir: string,
    private readonly gateway: Pick<KlingTtsGateway, "submit" | "query" | "download">,
    private readonly limits: ApiConfig) {}

  async tick(now = Date.now()): Promise<void> {
    const rows = await this.db.prepare(`SELECT id FROM tts_tasks WHERE state='pending' OR
      (state='running' AND last_polled_at<?) ORDER BY created_at LIMIT 2`).all(now - 5000) as { id: string }[];
    await Promise.all(rows.map(row => this.run(row.id)));
    await this.db.prepare("UPDATE tts_tasks SET state='unknown',cost_status='unknown',error='提交结果不确定，请联系支持核查；不会自动重复扣费',updated_at=? WHERE state='submitting' AND updated_at<?")
      .run(now, now - 60_000);
  }

  async run(id: string): Promise<void> {
    if (this.active.has(id) || this.active.size >= 2) return;
    this.active.add(id);
    try {
      let row = await this.db.prepare("SELECT * FROM tts_tasks WHERE id=?").get(id) as TtsRow | undefined;
      if (!row || !["pending", "running"].includes(row.state)) return;
      if (row.state === "pending") {
        const claimed = await this.db.prepare("UPDATE tts_tasks SET state='submitting',cost_status='unknown',updated_at=? WHERE id=? AND state='pending'")
          .run(Date.now(), id);
        if (!claimed.changes) return;
        const result = await this.gateway.submit({ text: row.text_content, voiceId: row.voice_id,
          voiceLanguage: row.voice_language, speed: row.speed });
        if (result.kind === "unknown") {
          await this.db.prepare("UPDATE tts_tasks SET state='unknown',error='提交结果不确定，请联系支持核查；不会自动重复扣费',updated_at=? WHERE id=? AND state='submitting'")
            .run(Date.now(), id);
          return;
        }
        if (result.kind === "rejected") {
          await this.db.prepare("UPDATE tts_tasks SET state='failed',cost_status='unbilled',error=?,updated_at=? WHERE id=? AND state='submitting'")
            .run(result.message, Date.now(), id);
          return;
        }
        await this.db.prepare("UPDATE tts_tasks SET state='running',cost_status='pending',provider_task_id=?,provider_request_id=?,updated_at=? WHERE id=? AND state='submitting'")
          .run(result.task.taskId, result.task.requestId ?? null, Date.now(), id);
        row = await this.db.prepare("SELECT * FROM tts_tasks WHERE id=?").get(id) as TtsRow;
        if (result.task.status === "succeed" || result.task.status === "failed") {
          await this.complete(row, result.task);
          return;
        }
      }
      if (!row.provider_task_id) return;
      await this.db.prepare("UPDATE tts_tasks SET last_polled_at=? WHERE id=? AND state='running'").run(Date.now(), id);
      const provider = await this.gateway.query(row.provider_task_id);
      await this.complete(row, provider);
    } finally { this.active.delete(id); }
  }

  private async complete(row: TtsRow, provider: TtsProviderTask): Promise<void> {
    const deduction = provider.deduction && Object.values(provider.deduction).some(Boolean) ? provider.deduction : null;
    if (provider.status === "failed") {
      await this.db.prepare("UPDATE tts_tasks SET state='failed',cost_status=?,actual_cost_json=?,error=?,updated_at=? WHERE id=? AND state='running'")
        .run(deduction ? "billed" : "unbilled", deduction ? JSON.stringify(deduction) : null,
          (provider.message ?? "配音生成失败").slice(0, 300), Date.now(), row.id);
      return;
    }
    if (provider.status !== "succeed" || !provider.audioUrl) return;
    const bytes = await this.gateway.download(provider.audioUrl);
    const folder = mkdtempSync(join(tmpdir(), "avs-tts-"));
    let createdFilePath: string | undefined;
    try {
      const staged = join(folder, "voice.mp3");
      writeFileSync(staged, bytes);
      const media = await inspectMediaFile(staged, "audio/mpeg");
      if (!media.durationMs) throw new Error("配音文件缺少有效时长");
      await this.db.transaction(async () => {
        const current = await this.db.prepare("SELECT state,result_object_id FROM tts_tasks WHERE id=? FOR UPDATE").get(row.id) as
          { state: string; result_object_id: string | null } | undefined;
        if (!current || current.state !== "running" || current.result_object_id) return;
        const object = await storeObject(this.db, this.dataDir, row.owner_id, "audio/mpeg", { bytes }, this.limits);
        createdFilePath = object.createdFilePath;
        const project = await this.db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE")
          .get(row.project_id, row.owner_id) as { document_json: string } | undefined;
        if (!project) throw new Error("配音所属项目不存在");
        const document = JSON.parse(project.document_json) as { assets: { id: string; kind: string; name?: string; mimeType?: string; durationMs?: number }[] };
        if (!document.assets.some(asset => asset.id === object.id)) document.assets.push({ id: object.id, kind: "voice",
          name: "AI 配音", mimeType: "audio/mpeg", durationMs: media.durationMs });
        await this.db.prepare("UPDATE projects SET document_json=?,revision=revision+1,updated_at=GREATEST(updated_at+1,?) WHERE id=?")
          .run(JSON.stringify(document), Date.now(), row.project_id);
        await this.db.prepare(`INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision)
          VALUES (?,'asset',?,1) ON CONFLICT(project_id,resource_type,resource_id) DO NOTHING`).run(row.project_id, object.id);
        await this.db.prepare("UPDATE tts_tasks SET state='succeeded',cost_status=?,actual_cost_json=?,result_object_id=?,error=NULL,updated_at=? WHERE id=?")
          .run(deduction ? "billed" : "unknown", deduction ? JSON.stringify(deduction) : null, object.id, Date.now(), row.id);
      });
    } catch (error) {
      if (createdFilePath) rmSync(createdFilePath, { force: true });
      throw error;
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
}
