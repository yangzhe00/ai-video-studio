import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import ffprobe from "@ffprobe-installer/ffprobe";
import { applyVideoEdit, createRecipe, validateRecipe } from "@ai-video/plugin-video-edit/core";
import type { VideoEditCommand, VideoEditRecipeV1 } from "@ai-video/plugin-video-edit/core";

export class EditError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const execFileAsync = promisify(execFile);

async function videoDuration(path: string): Promise<number> {
  try { await access(ffprobe.path, constants.X_OK); }
  catch { await chmod(ffprobe.path, 0o755); }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
      { encoding: "utf8", timeout: 10_000 }));
  } catch { throw new EditError(400, "视频时长无法识别或超出限制"); }
  const ms = Math.round(Number(stdout.trim()) * 1000);
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 60 * 60 * 1000) throw new EditError(400, "视频时长无法识别或超出限制");
  return ms;
}

interface EditRow { id: string; owner_id: string; project_id: string; episode_id: string; shot_id: string; source_object_id: string; recipe_json: string; revision: number; current_output_id: string | null; current_cover_id: string | null }
export function editSnapshot(row: EditRow) {
  return { id: row.id, projectId: row.project_id, episodeId: row.episode_id, shotId: row.shot_id,
    sourceAssetId: row.source_object_id, recipe: JSON.parse(row.recipe_json) as VideoEditRecipeV1,
    currentOutputId: row.current_output_id, currentCoverId: row.current_cover_id };
}

export function getEdit(db: DatabaseSync, ownerId: string, editId: string) {
  const row = db.prepare("SELECT * FROM video_edits WHERE id=? AND owner_id=?").get(editId, ownerId) as EditRow | undefined;
  if (!row) throw new EditError(404, "视频编辑不存在");
  return editSnapshot(row);
}

export function findEdit(db: DatabaseSync, ownerId: string, projectId: string, shotId: string) {
  const row = db.prepare("SELECT * FROM video_edits WHERE owner_id=? AND project_id=? AND shot_id=?").get(ownerId, projectId, shotId) as EditRow | undefined;
  return row ? editSnapshot(row) : null;
}

export function listEditVersions(db: DatabaseSync, ownerId: string, editId: string) {
  const edit = getEdit(db, ownerId, editId);
  const rows = db.prepare(`SELECT id,recipe_revision,output_object_id,cover_object_id,updated_at
    FROM render_operations WHERE edit_id=? AND owner_id=? AND state='succeeded' ORDER BY recipe_revision DESC`)
    .all(editId, ownerId) as { id: string; recipe_revision: number; output_object_id: string; cover_object_id: string; updated_at: number }[];
  return { originalAssetId: edit.sourceAssetId, selectedAssetId: edit.currentOutputId ?? edit.sourceAssetId,
    versions: rows.map(row => ({ operationId: row.id, recipeRevision: row.recipe_revision,
      outputAssetId: row.output_object_id, coverAssetId: row.cover_object_id, createdAt: row.updated_at })) };
}

export async function createEdit(db: DatabaseSync, ownerId: string, body: Record<string, unknown>) {
  if (!validId(body.projectId) || !validId(body.episodeId) || !validId(body.shotId)) throw new EditError(400, "项目、分集或镜头 ID 无效");
  const existing = findEdit(db, ownerId, body.projectId, body.shotId);
  if (existing) return existing;
  const project = db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?").get(body.projectId, ownerId) as { document_json: string } | undefined;
  if (!project) throw new EditError(404, "项目不存在");
  const document = JSON.parse(project.document_json) as { episodes: { id: string; shots: { id: string; resultAssetId: string; originalAssetId?: string }[] }[] };
  const shot = document.episodes.find(item => item.id === body.episodeId)?.shots.find(item => item.id === body.shotId);
  if (!shot) throw new EditError(404, "镜头不在指定分集");
  const originalAssetId = shot.originalAssetId ?? shot.resultAssetId;
  const object = db.prepare("SELECT path,mime FROM objects WHERE id=? AND owner_id=?").get(originalAssetId, ownerId) as { path: string; mime: string } | undefined;
  if (!object || object.mime !== "video/mp4") throw new EditError(400, "镜头视频不可编辑");
  const id = randomUUID();
  const duration = await videoDuration(object.path);
  const raced = findEdit(db, ownerId, body.projectId as string, body.shotId as string);
  if (raced) return raced;
  const recipe = createRecipe({ id, projectId: body.projectId, episodeId: body.episodeId, shotId: body.shotId, sourceAssetId: originalAssetId, sourceDurationMs: duration });
  try {
    db.prepare("INSERT INTO video_edits (id,owner_id,project_id,episode_id,shot_id,source_object_id,recipe_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, ownerId, body.projectId, body.episodeId, body.shotId, originalAssetId, JSON.stringify(recipe), 1, Date.now(), Date.now());
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      const existingEdit = findEdit(db, ownerId, body.projectId as string, body.shotId as string);
      if (existingEdit) return existingEdit;
    }
    throw error;
  }
  return getEdit(db, ownerId, id);
}

export function applyEditCommand(db: DatabaseSync, ownerId: string, editId: string, body: Record<string, unknown>) {
  if (!validId(body.commandId) || !Number.isSafeInteger(body.expectedRevision) || !body.command || typeof body.command !== "object") throw new EditError(400, "编辑命令无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM video_edits WHERE id=? AND owner_id=?").get(editId, ownerId) as EditRow | undefined;
    if (!row) throw new EditError(404, "视频编辑不存在");
    const hash = digest(body);
    const prior = db.prepare("SELECT payload_hash FROM edit_commands WHERE edit_id=? AND command_id=?").get(editId, body.commandId) as { payload_hash: string } | undefined;
    if (prior) {
      if (prior.payload_hash !== hash) throw new EditError(409, "编辑命令 ID 已用于其他内容");
      db.exec("COMMIT"); return getEdit(db, ownerId, editId);
    }
    let changed: ReturnType<typeof applyVideoEdit>;
    try { changed = applyVideoEdit(JSON.parse(row.recipe_json) as VideoEditRecipeV1, body.command as VideoEditCommand, body.expectedRevision as number); }
    catch (error) { throw new EditError(String(error).includes("冲突") ? 409 : 400, String(error).replace(/^Error: /, "")); }
    db.prepare("UPDATE video_edits SET recipe_json=?,revision=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(changed.recipe), changed.recipe.revision, Date.now(), editId);
    db.prepare("INSERT INTO edit_commands (edit_id,command_id,payload_hash,resulting_revision) VALUES (?,?,?,?)")
      .run(editId, body.commandId, hash, changed.recipe.revision);
    db.exec("COMMIT");
    return { ...getEdit(db, ownerId, editId), issues: changed.issues };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function renderSnapshot(db: DatabaseSync, ownerId: string, operationId: string) {
  const row = db.prepare("SELECT id,edit_id,recipe_revision,state,output_object_id,cover_object_id,error FROM render_operations WHERE id=? AND owner_id=?")
    .get(operationId, ownerId) as { id: string; edit_id: string; recipe_revision: number; state: string; output_object_id: string | null; cover_object_id: string | null; error: string | null } | undefined;
  if (!row) throw new EditError(404, "渲染任务不存在");
  return { id: row.id, editId: row.edit_id, recipeRevision: row.recipe_revision, state: row.state,
    outputAssetId: row.output_object_id, coverAssetId: row.cover_object_id, error: row.error };
}

export function createRender(db: DatabaseSync, ownerId: string, editId: string, body: Record<string, unknown>) {
  if (!validId(body.renderOperationId) || !Number.isSafeInteger(body.expectedRevision)) throw new EditError(400, "渲染请求无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM video_edits WHERE id=? AND owner_id=?").get(editId, ownerId) as EditRow | undefined;
    if (!row) throw new EditError(404, "视频编辑不存在");
    const recipe = JSON.parse(row.recipe_json) as VideoEditRecipeV1;
    if (recipe.revision !== body.expectedRevision) throw new EditError(409, "视频配方版本冲突");
    if (validateRecipe(recipe).length) throw new EditError(409, "有字幕超出保留片段，请调整后再渲染");
    const existing = db.prepare("SELECT id,state FROM render_operations WHERE edit_id=? AND recipe_revision=?").get(editId, recipe.revision) as { id: string; state: string } | undefined;
    if (existing) {
      if (existing.state === "failed") {
        db.prepare("UPDATE render_operations SET state='pending',error=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
          .run(Date.now(), existing.id);
        const seq = db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS seq FROM render_events WHERE operation_id=?").get(existing.id) as { seq: number };
        db.prepare("INSERT INTO render_events (operation_id,seq,state,message,created_at) VALUES (?,?,'pending','已重新排队渲染',?)")
          .run(existing.id, seq.seq, Date.now());
      }
      db.exec("COMMIT"); return renderSnapshot(db, ownerId, existing.id);
    }
    const used = db.prepare("SELECT edit_id FROM render_operations WHERE id=?").get(body.renderOperationId) as { edit_id: string } | undefined;
    if (used) throw new EditError(409, "渲染任务 ID 已存在");
    const now = Date.now();
    db.prepare("INSERT INTO render_operations (id,edit_id,owner_id,recipe_revision,recipe_json,state,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)")
      .run(body.renderOperationId, editId, ownerId, recipe.revision, JSON.stringify(recipe), now, now);
    db.prepare("INSERT INTO render_events (operation_id,seq,state,message,created_at) VALUES (?,1,'pending','等待渲染',?)")
      .run(body.renderOperationId, now);
    db.exec("COMMIT");
    return renderSnapshot(db, ownerId, body.renderOperationId as string);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
