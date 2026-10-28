import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { RunState } from "@ai-video/agent-core";
import { appendEvent } from "./runs.ts";
import { KlingGateway } from "./kling.ts";

interface WorkRow {
  id: string; run_id: string; owner_id: string; project_id: string; episode_id: string;
  source_object_id: string; prompt: string; duration_sec: 5 | 10;
  external_task_id: string; remote_task_id: string | null;
  operation_state: string; run_state: RunState;
}

export class GenerationWorker {
  private readonly active = new Set<string>();
  constructor(private readonly db: DatabaseSync, private readonly dataDir: string, private readonly gateway: KlingGateway) {}

  async tick() {
    const rows = this.db.prepare("SELECT run_id FROM operations WHERE state IN ('pending_submit','submitting','unknown','provider_queued','running','downloading')")
      .all() as { run_id: string }[];
    await Promise.all(rows.map(row => this.run(row.run_id)));
  }

  async run(runId: string): Promise<void> {
    if (this.active.has(runId)) return;
    this.active.add(runId);
    try { await this.process(runId); }
    catch {
      const row = this.work(runId);
      if (row && !["saved", "failed"].includes(row.operation_state)) this.transition(row, "unknown", "云端处理暂时中断，将查询原任务");
    }
    finally { this.active.delete(runId); }
  }

  private work(runId: string): WorkRow | undefined {
    return this.db.prepare(`SELECT o.id,o.run_id,r.owner_id,r.project_id,r.episode_id,r.source_object_id,
      r.prompt,r.duration_sec,o.external_task_id,o.remote_task_id,o.state AS operation_state,r.state AS run_state
      FROM operations o JOIN agent_runs r ON r.id=o.run_id WHERE o.run_id=?`).get(runId) as WorkRow | undefined;
  }

  private transition(row: WorkRow, state: RunState, message: string, remoteId?: string, result?: { assetId?: string; shotId?: string }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.work(row.run_id);
      if (!current || current.operation_state === "saved" || current.operation_state === "failed") {
        this.db.exec("COMMIT"); return;
      }
      this.db.prepare("UPDATE operations SET state=?,remote_task_id=COALESCE(?,remote_task_id) WHERE id=?")
        .run(state, remoteId ?? null, row.id);
      this.db.prepare("UPDATE agent_runs SET state=?,updated_at=? WHERE id=?").run(state, Date.now(), row.run_id);
      if (current.run_state !== state || result) appendEvent(this.db, row.run_id, state, message, result);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private fail(row: WorkRow, message: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.work(row.run_id);
      if (!current || current.operation_state === "failed" || current.operation_state === "saved") { this.db.exec("COMMIT"); return; }
      this.db.prepare("UPDATE operations SET state='failed' WHERE id=?").run(row.id);
      this.db.prepare("UPDATE agent_runs SET state='failed',updated_at=? WHERE id=?").run(Date.now(), row.run_id);
      this.db.prepare("UPDATE accounts SET demo_reserved=MAX(0,demo_reserved-1) WHERE id=?").run(row.owner_id);
      appendEvent(this.db, row.run_id, "failed", message);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private async process(runId: string) {
    const row = this.work(runId);
    if (!row || row.operation_state === "saved" || row.operation_state === "failed") return;
    if (row.operation_state === "pending_submit") {
      // This durable claim is the only path to a provider POST. After a crash, `submitting` is queried.
      const claim = this.db.prepare("UPDATE operations SET state='submitting',submitted_at=? WHERE id=? AND state='pending_submit'")
        .run(Date.now(), row.id);
      if (!claim.changes) return;
      const source = this.db.prepare("SELECT path,mime,size FROM objects WHERE id=? AND owner_id=?")
        .get(row.source_object_id, row.owner_id) as { path: string; mime: string; size: number } | undefined;
      if (!source || !["image/jpeg", "image/png"].includes(source.mime) || source.size > 10_000_000) {
        this.fail(row, "参考照片不符合可灵格式或大小要求"); return;
      }
      const result = await this.gateway.submit({
        externalTaskId: row.external_task_id, imageBase64: readFileSync(source.path).toString("base64"),
        prompt: row.prompt, durationSec: row.duration_sec,
      });
      if (result.kind === "rejected") { this.fail(row, "可灵未接受生成请求"); return; }
      if (result.kind === "unknown") { this.transition(row, "unknown", "提交结果待确认，将只查询原任务"); return; }
      this.transition(row, "provider_queued", "可灵已接收任务，正在排队", result.remoteTaskId); return;
    }

    // `submitting` may mean a process died before or after POST. Never send a second POST.
    if (row.operation_state === "submitting") this.transition(row, "unknown", "正在用原任务 ID 查询提交结果");
    let task;
    try { task = await this.gateway.query(row.remote_task_id, row.external_task_id); }
    catch { return; }
    if (task.status === "missing") return;
    if (task.status === "failed") { this.fail(row, task.message || "可灵生成失败"); return; }
    if (task.status === "submitted") { this.transition(row, "provider_queued", "可灵任务排队中", task.remoteTaskId); return; }
    if (task.status === "processing") { this.transition(row, "running", "可灵正在生成视频", task.remoteTaskId); return; }
    if (task.status !== "succeeded" || !task.videoUrl) { this.transition(row, "unknown", "结果待确认，请稍后查询原任务", task.remoteTaskId); return; }
    this.transition(row, "downloading", "生成完成，正在保存视频", task.remoteTaskId);
    let bytes: Buffer;
    try { bytes = await this.gateway.download(task.videoUrl); }
    catch { return; }
    this.saveResult(row, bytes);
  }

  private saveResult(row: WorkRow, bytes: Buffer) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const folder = join(this.dataDir, "objects", row.owner_id);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, sha256);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.work(row.run_id);
      if (!current || current.operation_state === "saved") { this.db.exec("COMMIT"); return; }
      let object = this.db.prepare("SELECT id FROM objects WHERE owner_id=? AND sha256=?").get(row.owner_id, sha256) as { id: string } | undefined;
      if (!object) {
        object = { id: randomUUID() };
        this.db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(object.id, row.owner_id, sha256, "video/mp4", bytes.length, path, Date.now());
      }
      const project = this.db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?").get(row.project_id, row.owner_id) as { document_json: string } | undefined;
      if (!project) throw new Error("生成结果的项目不存在");
      const document = JSON.parse(project.document_json) as { version: number; episodes: { id: string; title: string; shots: { id: string; runId: string; resultAssetId: string; sourceAssetId?: string; prompt?: string; durationSec?: number }[] }[]; assets: { id: string; kind: string }[] };
      const episode = document.episodes.find(item => item.id === row.episode_id);
      if (!episode) throw new Error("生成结果的分集不存在");
      if (!episode.shots) episode.shots = [];
      if (!episode.shots.some(shot => shot.runId === row.run_id)) {
        episode.shots.push({ id: row.run_id, runId: row.run_id, resultAssetId: object.id,
          sourceAssetId: row.source_object_id, prompt: row.prompt, durationSec: row.duration_sec });
      }
      if (!document.assets.some(asset => asset.id === object.id)) document.assets.push({ id: object.id, kind: "video" });
      this.db.prepare("UPDATE projects SET document_json=?,revision=revision+1 WHERE id=?").run(JSON.stringify(document), row.project_id);
      this.db.prepare("UPDATE operations SET state='saved' WHERE id=?").run(row.id);
      this.db.prepare("UPDATE agent_runs SET state='saved',updated_at=? WHERE id=?").run(Date.now(), row.run_id);
      this.db.prepare("UPDATE accounts SET demo_reserved=MAX(0,demo_reserved-1),demo_used=demo_used+1 WHERE id=?").run(row.owner_id);
      appendEvent(this.db, row.run_id, "saved", "视频已保存到指定分集", { assetId: object.id, shotId: row.run_id });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
