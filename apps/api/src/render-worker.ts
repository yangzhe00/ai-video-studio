import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import type { VideoEditRecipeV1 } from "@ai-video/plugin-video-edit/core";
import { claimRender } from "./render-lease.ts";
import { storeObject, type ObjectCapacity } from "./object-capacity.ts";

const runFile = promisify(execFile);
const ffmpegPath = process.env.API_FFMPEG_PATH || ffmpeg.path;
const stamp = (ms: number) => {
  const hours = Math.floor(ms / 3_600_000), minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60, millis = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

function subtitleFile(recipe: VideoEditRecipeV1, folder: string): string | null {
  if (!recipe.captions.length) return null;
  const path = join(folder, "captions.srt");
  const content = recipe.captions.map((caption, index) => {
    const start = caption.startMs - recipe.trimStartMs;
    const end = caption.endMs - recipe.trimStartMs;
    const text = caption.text.replace(/[<>]/g, "").replace(/\r?\n/g, " ");
    return `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}\n`;
  }).join("\n");
  writeFileSync(path, content, "utf8");
  return path;
}

interface RenderRow { id: string; edit_id: string; owner_id: string; recipe_revision: number; recipe_json: string; state: string }

export class RenderWorker {
  private active = new Set<string>();
  constructor(private db: DatabaseSync, private dataDir: string, private limits: ObjectCapacity = {}) {
    if (!existsSync(ffmpegPath)) throw new Error("Cloud FFmpeg binary is unavailable");
  }

  async tick() {
    const rows = this.db.prepare("SELECT id FROM render_operations WHERE state='pending' OR (state='running' AND COALESCE(lease_expires_at,0) <= ?) ORDER BY created_at LIMIT 2")
      .all(Date.now()) as { id: string }[];
    await Promise.all(rows.map(row => this.run(row.id)));
  }

  private event(id: string, state: string, message: string) {
    const seq = this.db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS seq FROM render_events WHERE operation_id=?").get(id) as { seq: number };
    this.db.prepare("INSERT INTO render_events (operation_id,seq,state,message,created_at) VALUES (?,?,?,?,?)")
      .run(id, seq.seq, state, message, Date.now());
  }

  async run(id: string): Promise<void> {
    if (this.active.has(id) || this.active.size >= 2) return;
    this.active.add(id);
    let folder: string | null = null;
    const leaseToken = randomUUID();
    try {
      const row = this.db.prepare("SELECT * FROM render_operations WHERE id=?") .get(id) as RenderRow | undefined;
      if (!row || !["pending", "running"].includes(row.state)) return;
      if (!claimRender(this.db, id, leaseToken)) return;
      this.event(id, "running", row.state === "running" ? "上次渲染中断，正在继续处理" : "正在云端渲染视频");
      const recipe = JSON.parse(row.recipe_json) as VideoEditRecipeV1;
      const source = this.db.prepare("SELECT path FROM objects WHERE id=? AND owner_id=?").get(recipe.sourceAssetId, row.owner_id) as { path: string } | undefined;
      if (!source) throw new Error("原视频已丢失");
      folder = mkdtempSync(join(tmpdir(), "avs-render-"));
      const output = join(folder, "output.mp4"), cover = join(folder, "cover.jpg");
      const subtitle = subtitleFile(recipe, folder);
      const videoArgs = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(recipe.trimStartMs / 1000), "-i", source.path,
        "-t", String((recipe.trimEndMs - recipe.trimStartMs) / 1000), ...(subtitle ? ["-vf", `subtitles=${subtitle}`] : []),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output];
      await runFile(ffmpegPath, videoArgs, { timeout: 120_000, maxBuffer: 1_000_000 });
      await runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(recipe.coverSourceMs / 1000), "-i", source.path, "-frames:v", "1", "-q:v", "2", cover], { timeout: 30_000, maxBuffer: 1_000_000 });
      const video = readFileSync(output), image = readFileSync(cover);
      if (!video.length || !image.length || video.length > 100_000_000) throw new Error("渲染文件无效或过大");
      const createdFiles: string[] = [];
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const latest = this.db.prepare("SELECT state,lease_token FROM render_operations WHERE id=?").get(id) as { state: string; lease_token: string | null } | undefined;
        if (latest?.state === "succeeded") { this.db.exec("COMMIT"); return; }
        if (latest?.state !== "running" || latest.lease_token !== leaseToken) { this.db.exec("COMMIT"); return; }
        const outputObject = storeObject(this.db, this.dataDir, row.owner_id, "video/mp4", { bytes: video }, this.limits);
        if (outputObject.createdFilePath) createdFiles.push(outputObject.createdFilePath);
        const coverObject = storeObject(this.db, this.dataDir, row.owner_id, "image/jpeg", { bytes: image }, this.limits);
        if (coverObject.createdFilePath) createdFiles.push(coverObject.createdFilePath);
        const outputId = outputObject.id, coverId = coverObject.id;
        const edit = this.db.prepare("SELECT project_id,episode_id,shot_id,revision FROM video_edits WHERE id=?").get(row.edit_id) as { project_id: string; episode_id: string; shot_id: string; revision: number } | undefined;
        if (!edit) throw new Error("编辑记录不存在");
        if (edit.revision === row.recipe_revision) {
          const project = this.db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?").get(edit.project_id, row.owner_id) as { document_json: string } | undefined;
          if (!project) throw new Error("项目不存在");
          const document = JSON.parse(project.document_json) as { episodes: { id: string; shots: { id: string; resultAssetId: string; originalAssetId?: string; selectedAssetId?: string; coverAssetId?: string }[] }[]; assets: { id: string; kind: string }[] };
          const shot = document.episodes.find(item => item.id === edit.episode_id)?.shots.find(item => item.id === edit.shot_id);
          if (!shot) throw new Error("镜头不存在");
          shot.originalAssetId ??= recipe.sourceAssetId;
          shot.selectedAssetId = outputId; shot.resultAssetId = outputId; shot.coverAssetId = coverId;
          if (!document.assets.some(item => item.id === outputId)) document.assets.push({ id: outputId, kind: "video" });
          if (!document.assets.some(item => item.id === coverId)) document.assets.push({ id: coverId, kind: "image" });
          this.db.prepare("UPDATE projects SET document_json=?,revision=revision+1,updated_at=MAX(updated_at+1,?),recent_episode_id=? WHERE id=?")
            .run(JSON.stringify(document), Date.now(), edit.episode_id, edit.project_id);
          this.db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,2) ON CONFLICT(project_id,resource_type,resource_id) DO UPDATE SET revision=revision+1")
            .run(edit.project_id, edit.episode_id);
          for (const objectId of [outputId, coverId]) this.db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'asset',?,1) ON CONFLICT(project_id,resource_type,resource_id) DO NOTHING").run(edit.project_id, objectId);
          this.db.prepare("UPDATE video_edits SET current_output_id=?,current_cover_id=?,updated_at=? WHERE id=?").run(outputId, coverId, Date.now(), row.edit_id);
        }
        this.db.prepare("UPDATE render_operations SET state='succeeded',output_object_id=?,cover_object_id=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
          .run(outputId, coverId, Date.now(), id);
        this.event(id, "succeeded", "渲染完成，已保存新版本");
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); for (const path of createdFiles) rmSync(path, { force: true }); throw error; }
    } catch (error) {
      const failed = this.db.prepare("UPDATE render_operations SET state='failed',error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND state='running' AND lease_token=?")
        .run(String(error).slice(0, 500), Date.now(), id, leaseToken);
      if (failed.changes) this.event(id, "failed", "渲染失败，原视频仍可使用");
    } finally {
      if (folder) rmSync(folder, { recursive: true, force: true });
      this.active.delete(id);
    }
  }
}
