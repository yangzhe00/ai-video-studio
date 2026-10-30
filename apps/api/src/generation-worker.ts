import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PgDatabase } from "./db.ts";
import type { RunState } from "@ai-video/agent-core";
import { appendEvent } from "./runs.ts";
import { KlingGateway, VideoTooLargeError } from "./kling.ts";
import { storeObject, ObjectCapacityError, type ObjectCapacity } from "./object-capacity.ts";

interface WorkRow {
  id: string; run_id: string; owner_id: string; project_id: string; episode_id: string;
  source_object_id: string; prompt: string; duration_sec: 5 | 10;
  external_task_id: string; remote_task_id: string | null;
  operation_state: string; run_state: RunState;
}

export class GenerationWorker {
  private readonly active = new Set<string>();
  private cleanedReadyFiles = false;
  constructor(private readonly db: PgDatabase, private readonly dataDir: string, private readonly gateway: KlingGateway,
    private readonly limits: ObjectCapacity = {}) {
    const temporary = join(dataDir, "temporary");
    if (!existsSync(temporary)) return;
    for (const entry of readdirSync(temporary)) {
      const path = join(temporary, entry);
      if (entry.endsWith(".part")) {
        if (Date.now() - statSync(path).mtimeMs > 3_600_000) rmSync(path, { force: true });
        continue;
      }
      if (!entry.endsWith(".ready")) continue;
      // Keep ready files until the async recovery pass has checked their operation state.
    }
  }

  async tick() {
    if (!this.cleanedReadyFiles) {
      const temporary = join(this.dataDir, "temporary");
      if (existsSync(temporary)) {
        for (const entry of readdirSync(temporary)) {
          if (!entry.endsWith(".ready")) continue;
          const operation = (await this.db.prepare("SELECT state FROM operations WHERE id=?").get(entry.slice(0, -6))) as { state: string } | undefined;
          if (!operation || ["saved", "failed"].includes(operation.state)) rmSync(join(temporary, entry), { force: true });
        }
      }
      this.cleanedReadyFiles = true;
    }
    const rows = (await this.db.prepare(`SELECT run_id FROM operations
      WHERE state IN ('pending_submit','submitting','unknown','provider_queued','running','downloading','storage_pending')
      ORDER BY last_polled_at,created_at LIMIT 2`)
      .all()) as { run_id: string }[];
    await Promise.all(rows.map(row => this.run(row.run_id)));
  }

  async run(runId: string): Promise<void> {
    if (this.active.has(runId) || this.active.size >= 2) return;
    this.active.add(runId);
    try {
      (await this.db.prepare("UPDATE operations SET last_polled_at=? WHERE run_id=?").run(Date.now(), runId));
      await this.process(runId);
    }
    catch {
      const row = (await this.work(runId));
      if (row && !["saved", "failed"].includes(row.operation_state)) (await this.transition(row, "unknown", "云端处理暂时中断，将查询原任务"));
    }
    finally { this.active.delete(runId); }
  }

  private async work(runId: string, lock = false): Promise<WorkRow | undefined> {
    return (await this.db.prepare(`SELECT o.id,o.run_id,r.owner_id,r.project_id,r.episode_id,r.source_object_id,
      r.prompt,r.duration_sec,o.external_task_id,o.remote_task_id,o.state AS operation_state,r.state AS run_state
      FROM operations o JOIN agent_runs r ON r.id=o.run_id WHERE o.run_id=? ${lock ? "FOR UPDATE OF o,r" : ""}`).get(runId)) as WorkRow | undefined;
  }

  private async transition(row: WorkRow, state: RunState, message: string, remoteId?: string, result?: { assetId?: string; shotId?: string }) {
    return await this.db.transaction(async () => {
    try {
      const current = (await this.work(row.run_id, true));
      if (!current || current.operation_state === "saved" || current.operation_state === "failed") {
         return;
      }
      (await this.db.prepare("UPDATE operations SET state=?,remote_task_id=COALESCE(?,remote_task_id) WHERE id=?")
        .run(state, remoteId ?? null, row.id));
      (await this.db.prepare("UPDATE agent_runs SET state=?,updated_at=? WHERE id=?").run(state, Date.now(), row.run_id));
      if (current.run_state !== state || result) (await appendEvent(this.db, row.run_id, state, message, result));

    } catch (error) {  throw error; }
});
  }

  private async fail(row: WorkRow, message: string, charged = false) {
    return await this.db.transaction(async () => {
    try {
      const current = (await this.work(row.run_id, true));
      if (!current || current.operation_state === "failed" || current.operation_state === "saved") {  return; }
      (await this.db.prepare("UPDATE operations SET state='failed' WHERE id=?").run(row.id));
      (await this.db.prepare("UPDATE agent_runs SET state='failed',updated_at=? WHERE id=?").run(Date.now(), row.run_id));
      (await this.db.prepare(charged
        ? "UPDATE accounts SET demo_reserved=GREATEST(0,demo_reserved-1),demo_used=demo_used+1 WHERE id=?"
        : "UPDATE accounts SET demo_reserved=GREATEST(0,demo_reserved-1) WHERE id=?").run(row.owner_id));
      (await appendEvent(this.db, row.run_id, "failed", message));

    } catch (error) {  throw error; }
});
  }

  private async deferForStorage(row: WorkRow, error: ObjectCapacityError) {
    return await this.db.transaction(async () => {
    try {
      const current = (await this.work(row.run_id, true));
      if (current && !["saved", "failed", "storage_pending"].includes(current.operation_state)) {
        (await this.db.prepare("UPDATE operations SET state='storage_pending' WHERE id=?").run(row.id));
        (await this.db.prepare("UPDATE agent_runs SET state='downloading',updated_at=? WHERE id=?").run(Date.now(), row.run_id));
        (await appendEvent(this.db, row.run_id, "downloading", `${error.message}；生成结果已暂存，释放空间后会自动保存`));
      }

    } catch (failure) {  throw failure; }
});
  }

  private async pendingResult(path: string): Promise<{ sha256: string; size: number }> {
    const size = statSync(path).size;
    if (!size || size > 100_000_000) throw new VideoTooLargeError("暂存视频大小无效");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return { sha256: hash.digest("hex"), size };
  }

  private async process(runId: string) {
    const row = (await this.work(runId));
    if (!row || row.operation_state === "saved" || row.operation_state === "failed") return;
    const temporary = join(this.dataDir, "temporary");
    const readyPath = join(temporary, `${row.id}.ready`);
    if (existsSync(readyPath)) {
      try {
        const pending = await this.pendingResult(readyPath);
        (await this.saveResult(row, readyPath, pending.sha256, pending.size));
        rmSync(readyPath, { force: true });
      } catch (error) {
        if (error instanceof ObjectCapacityError) (await this.deferForStorage(row, error));
        else if (error instanceof VideoTooLargeError) { rmSync(readyPath, { force: true }); (await this.fail(row, "暂存的生成视频无效；演示额度已计入", true)); }
        else throw error;
      }
      return;
    }
    if (row.operation_state === "pending_submit") {
      // This durable claim is the only path to a provider POST. After a crash, `submitting` is queried.
      const claim = (await this.db.prepare("UPDATE operations SET state='submitting',submitted_at=? WHERE id=? AND state='pending_submit'")
        .run(Date.now(), row.id));
      if (!claim.changes) return;
      const source = (await this.db.prepare("SELECT path,mime,size FROM objects WHERE id=? AND owner_id=?")
        .get(row.source_object_id, row.owner_id)) as { path: string; mime: string; size: number } | undefined;
      if (!source || !["image/jpeg", "image/png"].includes(source.mime) || source.size > 10_000_000) {
        (await this.fail(row, "参考照片不符合可灵格式或大小要求")); return;
      }
      const result = await this.gateway.submit({
        externalTaskId: row.external_task_id, imageBase64: readFileSync(source.path).toString("base64"),
        prompt: row.prompt, durationSec: row.duration_sec,
      });
      if (result.kind === "rejected") { (await this.fail(row, "可灵未接受生成请求")); return; }
      if (result.kind === "unknown") { (await this.transition(row, "unknown", "提交结果待确认，将只查询原任务")); return; }
      (await this.transition(row, "provider_queued", "可灵已接收任务，正在排队", result.remoteTaskId)); return;
    }

    // `submitting` may mean a process died before or after POST. Never send a second POST.
    if (row.operation_state === "submitting") (await this.transition(row, "unknown", "正在用原任务 ID 查询提交结果"));
    let task;
    try { task = await this.gateway.query(row.remote_task_id, row.external_task_id); }
    catch { return; }
    if (task.status === "missing") return;
    if (task.status === "failed") { (await this.fail(row, task.message || "可灵生成失败")); return; }
    if (task.status === "submitted") { (await this.transition(row, "provider_queued", "可灵任务排队中", task.remoteTaskId)); return; }
    if (task.status === "processing") { (await this.transition(row, "running", "可灵正在生成视频", task.remoteTaskId)); return; }
    if (task.status !== "succeeded" || !task.videoUrl) { (await this.transition(row, "unknown", "结果待确认，请稍后查询原任务", task.remoteTaskId)); return; }
    (await this.transition(row, "downloading", "生成完成，正在保存视频", task.remoteTaskId));
    mkdirSync(temporary, { recursive: true });
    const tempPath = join(temporary, `${randomUUID()}.part`);
    try {
      const downloaded = await this.gateway.downloadToFile(task.videoUrl, tempPath);
      try { linkSync(tempPath, readyPath); }
      catch (error) { if (!existsSync(readyPath)) throw error; }
      const pending = existsSync(readyPath) ? await this.pendingResult(readyPath) : downloaded;
      (await this.saveResult(row, readyPath, pending.sha256, pending.size));
      rmSync(readyPath, { force: true });
    } catch (error) {
      if (error instanceof VideoTooLargeError) (await this.fail(row, "生成视频超过云端支持的 100 MB；后台已完成调用，演示额度已计入", true));
      if (error instanceof ObjectCapacityError) (await this.deferForStorage(row, error));
      return;
    }
    finally { rmSync(tempPath, { force: true }); }
  }

  private async saveResult(row: WorkRow, tempPath: string, sha256: string, size: number) {
    let createdFilePath: string | undefined;
    try {
    return await this.db.transaction(async () => {
    try {
      const current = (await this.work(row.run_id, true));
      if (!current || current.operation_state === "saved" || current.operation_state === "failed") {  return; }
      const object = (await storeObject(this.db, this.dataDir, row.owner_id, "video/mp4", { sourcePath: tempPath, sha256, size }, this.limits));
      createdFilePath = object.createdFilePath;
      const project = (await this.db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE").get(row.project_id, row.owner_id)) as { document_json: string } | undefined;
      if (!project) throw new Error("生成结果的项目不存在");
      const document = JSON.parse(project.document_json) as { version: number; episodes: { id: string; title: string; shots: { id: string; runId: string; resultAssetId: string; originalAssetId?: string; selectedAssetId?: string; sourceAssetId?: string; prompt?: string; durationSec?: number }[] }[]; assets: { id: string; kind: string }[] };
      const episode = document.episodes.find(item => item.id === row.episode_id);
      if (!episode) throw new Error("生成结果的分集不存在");
      if (!episode.shots) episode.shots = [];
      if (!episode.shots.some(shot => shot.runId === row.run_id)) {
        episode.shots.push({ id: row.run_id, runId: row.run_id, resultAssetId: object.id,
          originalAssetId: object.id, selectedAssetId: object.id,
          sourceAssetId: row.source_object_id, prompt: row.prompt, durationSec: row.duration_sec });
      }
      if (!document.assets.some(asset => asset.id === object.id)) document.assets.push({ id: object.id, kind: "video" });
      (await this.db.prepare("UPDATE projects SET document_json=?,revision=revision+1,updated_at=GREATEST(updated_at+1,?),recent_episode_id=? WHERE id=?")
        .run(JSON.stringify(document), Date.now(), row.episode_id, row.project_id));
      (await this.db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,2) ON CONFLICT(project_id,resource_type,resource_id) DO UPDATE SET revision=resource_revisions.revision+1")
        .run(row.project_id, row.episode_id));
      (await this.db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'asset',?,1) ON CONFLICT(project_id,resource_type,resource_id) DO NOTHING")
        .run(row.project_id, object.id));
      (await this.db.prepare("UPDATE operations SET state='saved' WHERE id=?").run(row.id));
      (await this.db.prepare("UPDATE agent_runs SET state='saved',updated_at=? WHERE id=?").run(Date.now(), row.run_id));
      (await this.db.prepare("UPDATE accounts SET demo_reserved=GREATEST(0,demo_reserved-1),demo_used=demo_used+1 WHERE id=?").run(row.owner_id));
      (await appendEvent(this.db, row.run_id, "saved", "视频已保存到指定分集", { assetId: object.id, shotId: row.run_id }));

    } catch (error) {  if (createdFilePath) rmSync(createdFilePath, { force: true }); throw error; }
});
    } catch (error) {
      if (createdFilePath) rmSync(createdFilePath, { force: true });
      throw error;
    }
  }
}
