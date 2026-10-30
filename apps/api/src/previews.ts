import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoEditRecipe } from "@ai-video/plugin-video-edit/core";
import { validateRecipe } from "@ai-video/plugin-video-edit/core";
import type { ApiConfig } from "./config.ts";
import type { PgDatabase } from "./db.ts";
import { renderEpisodeSnapshot } from "./episode-renders.ts";
import { storeObject } from "./object-capacity.ts";
import { renderShotMedia } from "./render-worker.ts";

export class PreviewError extends Error { constructor(readonly status: number, message: string) { super(message); } }
interface Row {
  id: string; owner_id: string; project_id: string; scope: "shot" | "episode"; target_id: string;
  revision: number; snapshot_json: string; state: "pending" | "running" | "succeeded" | "failed";
  output_object_id: string | null; error: string | null; lease_token: string | null;
  expires_at: number | null;
}
const snapshot = (row: Row) => ({ id: row.id, scope: row.scope, targetId: row.target_id,
  revision: row.revision, state: row.state, outputAssetId: row.output_object_id, error: row.error });

export async function getPreview(db: PgDatabase, ownerId: string, id: string) {
  const row = await db.prepare("SELECT * FROM preview_operations WHERE id=? AND owner_id=?")
    .get(id, ownerId) as Row | undefined;
  if (!row) throw new PreviewError(404, "混音预览不存在");
  if (row.expires_at !== null && row.expires_at <= Date.now()) throw new PreviewError(410, "混音预览已过期，请重新生成");
  return snapshot(row);
}

async function createPreview(db: PgDatabase, ownerId: string, projectId: string,
  scope: "shot" | "episode", targetId: string, revision: number, content: unknown, operationId: string) {
  const previous = await db.prepare("SELECT * FROM preview_operations WHERE scope=? AND target_id=? AND revision=?")
    .get(scope, targetId, revision) as Row | undefined;
  if (previous) {
    if (previous.owner_id !== ownerId || previous.project_id !== projectId) throw new PreviewError(409, "预览目标冲突");
    if (previous.state === "failed" || previous.expires_at !== null && previous.expires_at <= Date.now()) await db.prepare(`UPDATE preview_operations
      SET state='pending',output_object_id=NULL,error=NULL,expires_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`)
      .run(Date.now(), previous.id);
    return { preview: await getPreview(db, ownerId, previous.id), replayed: true };
  }
  if (await db.prepare("SELECT id FROM preview_operations WHERE id=?").get(operationId)) {
    throw new PreviewError(409, "预览任务 ID 已用于其他内容");
  }
  const now = Date.now();
  await db.prepare(`INSERT INTO preview_operations (id,owner_id,project_id,scope,target_id,revision,
    snapshot_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)`)
    .run(operationId, ownerId, projectId, scope, targetId, revision, JSON.stringify(content), now, now);
  return { preview: await getPreview(db, ownerId, operationId), replayed: false };
}

export async function createShotPreview(db: PgDatabase, ownerId: string, editId: string, body: Record<string, unknown>) {
  return db.transaction(async () => {
    const edit = await db.prepare("SELECT project_id,recipe_json,revision FROM video_edits WHERE id=? AND owner_id=? FOR UPDATE")
      .get(editId, ownerId) as { project_id: string; recipe_json: string; revision: number } | undefined;
    if (!edit) throw new PreviewError(404, "视频编辑不存在");
    if (edit.revision !== body.expectedRevision) throw new PreviewError(409, "视频配方版本已变化");
    const recipe = JSON.parse(edit.recipe_json) as VideoEditRecipe;
    if (validateRecipe(recipe).length) throw new PreviewError(409, "视频配方有未解决的问题");
    return createPreview(db, ownerId, edit.project_id, "shot", editId, edit.revision, recipe,
      body.previewOperationId as string);
  });
}

export async function createEpisodePreview(db: PgDatabase, ownerId: string, projectId: string,
  episodeId: string, body: Record<string, unknown>) {
  return db.transaction(async () => {
    const project = await db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE")
      .get(projectId, ownerId) as { document_json: string } | undefined;
    if (!project) throw new PreviewError(404, "项目不存在");
    const episode = (JSON.parse(project.document_json) as { episodes: { id: string; timeline: string[] }[] })
      .episodes.find(item => item.id === episodeId);
    if (!episode) throw new PreviewError(404, "分集不存在");
    if (!episode.timeline?.length || episode.timeline.length > 100) throw new PreviewError(400, "分集还没有可预览的镜头");
    const resource = await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type='episode' AND resource_id=?")
      .get(projectId, episodeId) as { revision: number } | undefined;
    const revision = resource?.revision ?? 1;
    if (revision !== body.expectedEpisodeRevision) throw new PreviewError(409, "分集版本已变化");
    return createPreview(db, ownerId, projectId, "episode", episodeId, revision, episode,
      body.previewOperationId as string);
  });
}

export class PreviewWorker {
  private active = new Set<string>();
  private lastCleanup = 0;
  constructor(private readonly db: PgDatabase, private readonly dataDir: string,
    private readonly limits: ApiConfig) {}

  async tick(now = Date.now()): Promise<void> {
    if (now - this.lastCleanup >= 60_000) {
      this.lastCleanup = now;
      await this.cleanup(now);
    }
    const rows = await this.db.prepare(`SELECT id FROM preview_operations WHERE state='pending' OR
      (state='running' AND COALESCE(lease_expires_at,0)<=?) ORDER BY created_at LIMIT 2`).all(now) as { id: string }[];
    await Promise.all(rows.map(row => this.run(row.id)));
  }

  /** Preview files are short-lived and never form part of a project's version history. */
  async cleanup(now = Date.now()): Promise<void> {
    const files: string[] = [];
    await this.db.transaction(async () => {
      await this.db.lock("storage-total");
      await this.db.prepare(`DELETE FROM preview_operations WHERE
        (expires_at IS NOT NULL AND expires_at<=?) OR
        (state IN ('succeeded','failed') AND updated_at<=? AND EXISTS
          (SELECT 1 FROM preview_operations newer WHERE newer.scope=preview_operations.scope
            AND newer.target_id=preview_operations.target_id AND newer.revision>preview_operations.revision))`)
        .run(now, now - 300_000);
      const owned = await this.db.prepare("SELECT object_id,owner_id FROM preview_owned_objects").all() as
        { object_id: string; owner_id: string }[];
      for (const item of owned) {
        if (await this.db.prepare("SELECT id FROM preview_operations WHERE output_object_id=? LIMIT 1").get(item.object_id)) continue;
        try {
          const deleted = await this.db.prepare(`DELETE FROM objects WHERE id=? AND owner_id=? AND
            NOT EXISTS (SELECT 1 FROM projects WHERE owner_id=? AND POSITION(? IN document_json)>0)
            RETURNING path`).get(item.object_id, item.owner_id, item.owner_id, item.object_id) as
            { path: string } | undefined;
          if (deleted) files.push(deleted.path);
        } catch (error) {
          if ((error as { code?: string }).code !== "23503") throw error;
        }
      }
    });
    for (const path of files) rmSync(path, { force: true });
  }

  async run(id: string): Promise<void> {
    if (this.active.has(id) || this.active.size >= 2) return;
    this.active.add(id);
    let folder: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const token = randomUUID();
    try {
      const claimed = await this.db.prepare(`UPDATE preview_operations SET state='running',lease_token=?,lease_expires_at=?,updated_at=?
        WHERE id=? AND (state='pending' OR (state='running' AND COALESCE(lease_expires_at,0)<=?))`)
        .run(token, Date.now() + 180_000, Date.now(), id, Date.now());
      if (!claimed.changes) return;
      heartbeat = setInterval(() => { void this.db.prepare(`UPDATE preview_operations SET lease_expires_at=?
        WHERE id=? AND state='running' AND lease_token=?`).run(Date.now() + 180_000, id, token).catch(() => {}); }, 30_000);
      const row = await this.db.prepare("SELECT * FROM preview_operations WHERE id=?").get(id) as Row;
      folder = mkdtempSync(join(tmpdir(), "avs-preview-"));
      const output = join(folder, "preview.mp4");
      if (row.scope === "shot") {
        const recipe = JSON.parse(row.snapshot_json) as VideoEditRecipe;
        const source = await this.db.prepare("SELECT path,mime FROM objects WHERE id=? AND owner_id=?")
          .get(recipe.sourceAssetId, row.owner_id) as { path: string; mime: string } | undefined;
        if (!source || source.mime !== "video/mp4") throw new Error("原视频已丢失");
        await renderShotMedia(this.db, row.owner_id, recipe, source.path, folder, output);
      } else {
        await renderEpisodeSnapshot(this.db, row.owner_id, row.project_id,
          JSON.parse(row.snapshot_json), output);
      }
      const bytes = readFileSync(output);
      if (!bytes.length || bytes.length > 100_000_000) throw new Error("混音预览无效或过大");
      let createdFilePath: string | undefined;
      try {
        await this.db.transaction(async () => {
          const current = await this.db.prepare("SELECT state,lease_token FROM preview_operations WHERE id=? FOR UPDATE")
            .get(id) as { state: string; lease_token: string | null } | undefined;
          if (!current || current.state !== "running" || current.lease_token !== token) return;
          const object = await storeObject(this.db, this.dataDir, row.owner_id, "video/mp4", { bytes }, this.limits);
          createdFilePath = object.createdFilePath;
          if (object.created) await this.db.prepare("INSERT INTO preview_owned_objects (object_id,owner_id) VALUES (?,?) ON CONFLICT DO NOTHING")
            .run(object.id, row.owner_id);
          await this.db.prepare(`UPDATE preview_operations SET state='succeeded',output_object_id=?,error=NULL,
            expires_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`)
            .run(object.id, Date.now() + 3_600_000, Date.now(), id);
        });
      } catch (error) { if (createdFilePath) rmSync(createdFilePath, { force: true }); throw error; }
    } catch (error) {
      await this.db.prepare(`UPDATE preview_operations SET state='failed',error=?,lease_token=NULL,
        lease_expires_at=NULL,updated_at=? WHERE id=? AND state='running' AND lease_token=?`)
        .run(error instanceof Error ? error.message.slice(0, 500) : "混音预览失败", Date.now(), id, token);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (folder) rmSync(folder, { recursive: true, force: true });
      this.active.delete(id);
    }
  }
}
