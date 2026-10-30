import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioPlacement } from "@ai-video/plugin-video-edit/core";
import type { ApiConfig } from "./config.ts";
import type { PgDatabase } from "./db.ts";
import { inspectMediaFile } from "./media-inspect.ts";
import { renderEpisodeMedia, type EpisodeVisualInput } from "./episode-media.ts";
import { storeObject } from "./object-capacity.ts";

export class EpisodeRenderError extends Error { constructor(readonly status: number, message: string) { super(message); } }
interface CloudClip { id: string; assetId: string; inMs: number; outMs: number; volume: number }
interface CloudEpisode { id: string; title: string; timeline: string[]; timelineClips?: CloudClip[];
  shots: { resultAssetId: string; durationSec: number }[];
  audio?: { originalVolume: number; voiceClips: AudioPlacement[]; musicClips: AudioPlacement[] } }
interface Row { id: string; owner_id: string; project_id: string; episode_id: string; episode_revision: number;
  snapshot_json: string; state: "pending" | "running" | "succeeded" | "failed";
  output_object_id: string | null; error: string | null; lease_token: string | null; lease_expires_at: number | null;
  created_at: number; updated_at: number }

/** Shared episode renderer for a saved preview and its final export. */
export async function renderEpisodeSnapshot(db: PgDatabase, ownerId: string, projectId: string,
  episode: CloudEpisode, output: string): Promise<void> {
  const clips = episode.timelineClips?.length === episode.timeline.length &&
    episode.timelineClips.every((clip, index) => clip.assetId === episode.timeline[index])
    ? episode.timelineClips : episode.timeline.map((assetId, index) => ({ id: `legacy-${index}`, assetId,
      inMs: 0, outMs: (episode.shots.find(shot => shot.resultAssetId === assetId)?.durationSec ?? 5) * 1000, volume: 1 }));
  const visuals: EpisodeVisualInput[] = [];
  for (const clip of clips) {
    const object = await db.prepare("SELECT path,mime FROM objects WHERE id=? AND owner_id=?").get(clip.assetId, ownerId) as
      { path: string; mime: string } | undefined;
    if (!object || !["video/mp4", "image/jpeg", "image/png", "image/webp"].includes(object.mime)) throw new Error("分集镜头素材丢失或格式不支持");
    visuals.push({ path: object.path, mime: object.mime as EpisodeVisualInput["mime"], inMs: clip.inMs, outMs: clip.outMs });
  }
  const project = await db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?").get(projectId, ownerId) as
    { document_json: string } | undefined;
  const assets = project ? (JSON.parse(project.document_json) as { assets: { id: string; kind: string }[] }).assets : [];
  const audioInput = async (clips: AudioPlacement[], kind: "voice" | "music") => {
    const result = [];
    for (const clip of clips) {
      const object = await db.prepare("SELECT path,mime FROM objects WHERE id=? AND owner_id=?").get(clip.assetId, ownerId) as
        { path: string; mime: string } | undefined;
      if (!object || !assets.some(asset => asset.id === clip.assetId && asset.kind === kind) || !object.mime.startsWith("audio/")) {
        throw new Error("分集配音或音乐素材丢失");
      }
      const media = await inspectMediaFile(object.path, object.mime);
      if (!media.durationMs || clip.outMs > media.durationMs + 100) throw new Error("分集音频裁剪超出素材");
      result.push({ clip, path: object.path });
    }
    return result;
  };
  await renderEpisodeMedia(visuals, episode.audio,
    await audioInput(episode.audio?.voiceClips ?? [], "voice"),
    await audioInput(episode.audio?.musicClips ?? [], "music"), output);
}

function snapshot(row: Row) {
  return { id: row.id, projectId: row.project_id, episodeId: row.episode_id,
    episodeRevision: row.episode_revision, state: row.state,
    outputAssetId: row.output_object_id, error: row.error };
}

export async function getEpisodeRender(db: PgDatabase, ownerId: string, id: string) {
  const row = await db.prepare("SELECT * FROM episode_render_operations WHERE id=? AND owner_id=?").get(id, ownerId) as Row | undefined;
  if (!row) throw new EpisodeRenderError(404, "整集导出任务不存在");
  return snapshot(row);
}

export async function createEpisodeRender(db: PgDatabase, ownerId: string, projectId: string, episodeId: string,
  body: Record<string, unknown>) {
  return db.transaction(async () => {
    const project = await db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE")
      .get(projectId, ownerId) as { document_json: string } | undefined;
    if (!project) throw new EpisodeRenderError(404, "项目不存在");
    const episode = (JSON.parse(project.document_json) as { episodes: CloudEpisode[] }).episodes.find(item => item.id === episodeId);
    if (!episode) throw new EpisodeRenderError(404, "分集不存在");
    if (!episode.timeline?.length || episode.timeline.length > 100) throw new EpisodeRenderError(400, "分集还没有可导出的镜头");
    const resource = await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type='episode' AND resource_id=?")
      .get(projectId, episodeId) as { revision: number } | undefined;
    const revision = resource?.revision ?? 1;
    if (revision !== body.expectedEpisodeRevision) throw new EpisodeRenderError(409, "分集版本已变化，请刷新后重试");
    const existing = await db.prepare("SELECT * FROM episode_render_operations WHERE project_id=? AND episode_id=? AND episode_revision=?")
      .get(projectId, episodeId, revision) as Row | undefined;
    if (existing) {
      if (existing.state === "failed") await db.prepare("UPDATE episode_render_operations SET state='pending',error=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
        .run(Date.now(), existing.id);
      return { render: await getEpisodeRender(db, ownerId, existing.id), replayed: true };
    }
    const used = await db.prepare("SELECT id FROM episode_render_operations WHERE id=?").get(body.renderOperationId);
    if (used) throw new EpisodeRenderError(409, "导出任务 ID 已用于其他内容");
    const now = Date.now();
    await db.prepare(`INSERT INTO episode_render_operations (id,owner_id,project_id,episode_id,episode_revision,snapshot_json,
      state,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)`)
      .run(body.renderOperationId, ownerId, projectId, episodeId, revision, JSON.stringify(episode), now, now);
    return { render: await getEpisodeRender(db, ownerId, body.renderOperationId as string), replayed: false };
  });
}

export class EpisodeRenderWorker {
  private active = new Set<string>();
  constructor(private readonly db: PgDatabase, private readonly dataDir: string, private readonly limits: ApiConfig) {}

  async tick(now = Date.now()): Promise<void> {
    const rows = await this.db.prepare("SELECT id FROM episode_render_operations WHERE state='pending' OR (state='running' AND COALESCE(lease_expires_at,0)<=?) ORDER BY created_at LIMIT 2")
      .all(now) as { id: string }[];
    await Promise.all(rows.map(row => this.run(row.id)));
  }

  async run(id: string): Promise<void> {
    if (this.active.has(id) || this.active.size >= 2) return;
    this.active.add(id);
    let folder: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const token = randomUUID();
    try {
      const claimed = await this.db.prepare(`UPDATE episode_render_operations SET state='running',lease_token=?,lease_expires_at=?,updated_at=?
        WHERE id=? AND (state='pending' OR (state='running' AND COALESCE(lease_expires_at,0)<=?))`)
        .run(token, Date.now() + 180_000, Date.now(), id, Date.now());
      if (!claimed.changes) return;
      heartbeat = setInterval(() => { void this.db.prepare(`UPDATE episode_render_operations SET lease_expires_at=?
        WHERE id=? AND state='running' AND lease_token=?`).run(Date.now() + 180_000, id, token).catch(() => {}); }, 30_000);
      const row = await this.db.prepare("SELECT * FROM episode_render_operations WHERE id=?").get(id) as Row;
      const episode = JSON.parse(row.snapshot_json) as CloudEpisode;
      folder = mkdtempSync(join(tmpdir(), "avs-episode-render-"));
      const output = join(folder, "episode.mp4");
      await renderEpisodeSnapshot(this.db, row.owner_id, row.project_id, episode, output);
      const bytes = readFileSync(output);
      let createdFilePath: string | undefined;
      try {
        await this.db.transaction(async () => {
          const current = await this.db.prepare("SELECT state,lease_token FROM episode_render_operations WHERE id=? FOR UPDATE")
            .get(id) as { state: string; lease_token: string | null } | undefined;
          if (!current || current.state !== "running" || current.lease_token !== token) return;
          const object = await storeObject(this.db, this.dataDir, row.owner_id, "video/mp4", { bytes }, this.limits);
          createdFilePath = object.createdFilePath;
          const project = await this.db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE")
            .get(row.project_id, row.owner_id) as { document_json: string } | undefined;
          if (!project) throw new Error("分集所属项目不存在");
          const document = JSON.parse(project.document_json) as { assets: { id: string; kind: string; name?: string }[] };
          if (!document.assets.some(asset => asset.id === object.id)) document.assets.push({ id: object.id, kind: "video", name: "分集成片" });
          await this.db.prepare("UPDATE projects SET document_json=?,revision=revision+1,updated_at=GREATEST(updated_at+1,?) WHERE id=?")
            .run(JSON.stringify(document), Date.now(), row.project_id);
          await this.db.prepare(`INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision)
            VALUES (?,'asset',?,1) ON CONFLICT(project_id,resource_type,resource_id) DO NOTHING`).run(row.project_id, object.id);
          await this.db.prepare(`UPDATE episode_render_operations SET state='succeeded',output_object_id=?,error=NULL,
            lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`).run(object.id, Date.now(), id);
        });
      } catch (error) { if (createdFilePath) rmSync(createdFilePath, { force: true }); throw error; }
    } catch (error) {
      await this.db.prepare(`UPDATE episode_render_operations SET state='failed',error=?,lease_token=NULL,
        lease_expires_at=NULL,updated_at=? WHERE id=? AND state='running' AND lease_token=?`)
        .run(String(error).slice(0, 500), Date.now(), id, token);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (folder) rmSync(folder, { recursive: true, force: true });
      this.active.delete(id);
    }
  }
}
