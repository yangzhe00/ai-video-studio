import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { PgDatabase } from "./db.ts";
import { EpisodeAudioSchema } from "@ai-video/api-contracts";
import { projectEpisodeAudio, projectOriginalAudio, projectEpisodeVisuals, type CloudAudioEpisode } from "@ai-video/api-contracts";
import { inspectMediaFile } from "./media-inspect.ts";
import { creationBriefs } from "../../../packages/project-core/src/brief.ts";
import type { CreationBrief } from "../../../packages/project-core/src/brief.ts";
import { assertBriefEdit, assertInitialAgentBrief, parseCreationBrief } from "./briefs.ts";
interface CloudResource { id: string; [key: string]: unknown }
interface CloudProjectDocument {
  version: 1; episodes: CloudResource[]; assets: CloudResource[]; characters: CloudResource[];
  briefs?: CreationBrief[];
  extensions?: Record<string, unknown>;
}
type SyncResourceType = "episode" | "asset" | "character" | "canvas" | "brief";
interface SyncResourceRevision { resourceType: SyncResourceType; resourceId: string; revision: number }
interface SyncCommand { id: string; resourceType: SyncResourceType; resourceId: string; baseRevision: number; payload: CloudResource | CreationBrief }

function applySyncCommand(document: CloudProjectDocument, command: SyncCommand): CloudProjectDocument {
  const { resourceType: type, resourceId: id, payload } = command;
  if (type === "canvas") {
    const old = document.extensions?.canvas as { episodeGraphs?: Record<string, unknown> } | undefined;
    return { ...document, extensions: { ...document.extensions, canvas: { version: 1, episodeGraphs: { ...old?.episodeGraphs, [id]: payload } } } };
  }
  if (type === "brief") {
    const entries = creationBriefs(document);
    return { ...document, briefs: entries.some(item => item.id === id)
      ? entries.map(item => item.id === id ? payload as CreationBrief : item)
      : [...entries, payload as CreationBrief] };
  }
  const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
  const entries = document[field];
  return { ...document, [field]: entries.some(item => item.id === id) ? entries.map(item => item.id === id ? payload : item) : [...entries, payload] };
}

export class SyncError extends Error { constructor(readonly status: number, message: string, readonly snapshot?: unknown) { super(message); } }
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(id);
const allowedTypes = new Set(["episode", "asset", "character", "canvas", "brief"]);

export async function listResourceRevisions(db: PgDatabase, projectId: string): Promise<SyncResourceRevision[]> {
  const rows = (await db.prepare("SELECT resource_type,resource_id,revision FROM resource_revisions WHERE project_id=?").all(projectId)) as { resource_type: SyncResourceType; resource_id: string; revision: number }[];
  return rows.map(row => ({ resourceType: row.resource_type, resourceId: row.resource_id, revision: row.revision }));
}

/** Read a v3 timeline without changing an old stored episode or inventing audio for silent video. */
export async function readEpisodeTimeline(db: PgDatabase, ownerId: string, projectId: string, episodeId: string) {
  const row = await db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?")
    .get(projectId, ownerId) as { document_json: string } | undefined;
  if (!row) throw new SyncError(404, "项目不存在");
  const document = JSON.parse(row.document_json) as CloudProjectDocument;
  const episode = document.episodes.find(item => item.id === episodeId);
  if (!episode) throw new SyncError(404, "分集不存在");
  const cloud = episode as unknown as CloudAudioEpisode;
  const visuals = projectEpisodeVisuals(cloud);
  const hasAudio = new Map<string, boolean>();
  for (const assetId of new Set(visuals.map(clip => clip.assetId))) {
    const object = await db.prepare("SELECT path,mime FROM objects WHERE id=? AND owner_id=?")
      .get(assetId, ownerId) as { path: string; mime: string } | undefined;
    if (!object || !existsSync(object.path)) throw new SyncError(410, "画面素材文件已失效，请重新上传或恢复");
    hasAudio.set(assetId, object.mime === "video/mp4"
      ? Boolean((await inspectMediaFile(object.path, object.mime)).hasAudio) : false);
  }
  let projected;
  try { projected = projectEpisodeAudio(cloud); }
  catch { throw new SyncError(409, "分集音频锚点已失效，请先处理旧数据冲突"); }
  const audio = cloud.audio?.version === 3 ? projected : {
    version: 3 as const, originalVolume: projected?.originalVolume ?? 1,
    originalClips: projectOriginalAudio(cloud, assetId => hasAudio.get(assetId) ?? false),
    voiceClips: projected?.voiceClips ?? [], musicClips: projected?.musicClips ?? [],
  };
  const revision = await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type='episode' AND resource_id=?")
    .get(projectId, episodeId) as { revision: number } | undefined;
  return { episodeId, episodeRevision: revision?.revision ?? 1, timelineClips: visuals,
    audio, projectedFromLegacy: cloud.audio?.version !== 3 };
}

function currentPayload(document: CloudProjectDocument, type: SyncCommand["resourceType"], id: string): unknown {
  if (type === "canvas") return (document.extensions?.canvas as { episodeGraphs?: Record<string, unknown> } | undefined)?.episodeGraphs?.[id];
  if (type === "brief") return creationBriefs(document).find(item => item.id === id);
  const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
  return document[field].find(item => item.id === id);
}

async function validateCommand(db: PgDatabase, ownerId: string, document: CloudProjectDocument, body: Record<string, unknown>): Promise<SyncCommand> {
  const type = body.resourceType;
  if (!validId(body.id) || !validId(body.resourceId) || !allowedTypes.has(type as string) || !Number.isSafeInteger(body.baseRevision) || (body.baseRevision as number) < 0) {
    throw new SyncError(400, "同步命令格式无效");
  }
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) throw new SyncError(400, "同步内容无效");
  const payload = { ...(body.payload as Record<string, unknown>) };
  const ownedObject = async (id: unknown): Promise<{ mime: string; path: string } | undefined> =>
    typeof id === "string" ? (await db.prepare("SELECT mime,path FROM objects WHERE id=? AND owner_id=?").get(id, ownerId)) as { mime: string; path: string } | undefined : undefined;
  const projectAsset = (id: unknown): boolean => typeof id === "string" && document.assets.some(asset => asset.id === id);
  if (type === "canvas") {
    if (!document.episodes.some(item => item.id === body.resourceId) || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges) ||
        payload.nodes.length > 1000 || payload.edges.length > 2000) throw new SyncError(400, "画布内容无效");
    const viewport = payload.viewport as Record<string, unknown> | undefined;
    if (!viewport || ![viewport.x, viewport.y, viewport.zoom].every(value => typeof value === "number" && Number.isFinite(value)) || (viewport.zoom as number) <= 0) {
      throw new SyncError(400, "画布视口无效");
    }
    const nodeIds = new Set<string>();
    for (const raw of payload.nodes) {
      const node = raw as Record<string, unknown> | null;
      if (!node || !validId(node.id) || nodeIds.has(node.id) || !["character", "image", "text", "video", "timeline"].includes(String(node.type)) ||
          typeof node.x !== "number" || !Number.isFinite(node.x) || typeof node.y !== "number" || !Number.isFinite(node.y) ||
          typeof node.title !== "string" || node.title.length > 200) throw new SyncError(400, "画布节点无效");
      if ((node.assetId !== undefined && (!projectAsset(node.assetId) || !(await ownedObject(node.assetId)))) ||
          (node.resultAssetId !== undefined && (!projectAsset(node.resultAssetId) || !(await ownedObject(node.resultAssetId)))) ||
          (node.characterId !== undefined && !document.characters.some(item => item.id === node.characterId))) {
        throw new SyncError(400, "画布节点引用了不可用素材或人物");
      }
      nodeIds.add(node.id);
    }
    for (const raw of payload.edges) {
      const edge = raw as Record<string, unknown> | null;
      if (!edge || !validId(edge.id) || !nodeIds.has(String(edge.from)) || !nodeIds.has(String(edge.to))) {
        throw new SyncError(400, "画布连线引用了不存在的节点");
      }
    }
  } else if (payload.id !== body.resourceId) throw new SyncError(400, "资源 ID 不一致");
  if (type === "episode" && (typeof payload.title !== "string" || !Array.isArray(payload.shots) || !Array.isArray(payload.timeline))) throw new SyncError(400, "分集内容无效");
  if (type === "episode") {
    const previous = document.episodes.find(item => item.id === body.resourceId);
    const previousAudio = previous?.audio as { version?: number } | undefined;
    const incomingAudio = payload.audio as { version?: number } | undefined;
    if ((previousAudio?.version === 2 && ![2, 3].includes(incomingAudio?.version ?? 0)) ||
        (previousAudio?.version === 3 && incomingAudio?.version !== 3)) {
      throw new SyncError(409, "分集使用新版音轨，请刷新并使用新版编辑器保存");
    }
    const savedV3 = previousAudio?.version === 3 ? previousAudio as {
      locks?: { visual: boolean; original: boolean; voice: boolean; music: boolean };
      originalVolume: number; originalClips: unknown[]; voiceClips: unknown[]; musicClips: unknown[];
    } : undefined;
    if (savedV3?.locks && incomingAudio?.version === 3) {
      const next = incomingAudio as typeof savedV3;
      const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right);
      if ((savedV3.locks.visual && changed(previous?.timelineClips, payload.timelineClips)) ||
          (savedV3.locks.original && (changed(savedV3.originalClips, next.originalClips) ||
            changed(savedV3.originalVolume, next.originalVolume))) ||
          (savedV3.locks.voice && changed(savedV3.voiceClips, next.voiceClips)) ||
          (savedV3.locks.music && changed(savedV3.musicClips, next.musicClips))) {
        throw new SyncError(409, "轨道已锁定，请先单独解锁后再编辑");
      }
    }
    const timeline = payload.timeline as unknown[];
    if (!timeline.every(id => typeof id === "string" && validId(id))) throw new SyncError(400, "时间线素材 ID 无效");
    for (const id of timeline) {
      if (!projectAsset(id) || !(await ownedObject(id))) throw new SyncError(400, "时间线引用了未添加或无权访问的素材");
    }
    if ((payload.shots as unknown[]).length > 1000) throw new SyncError(400, "分集镜头过多");
    for (const raw of payload.shots as unknown[]) {
      const shot = raw as Record<string, unknown> | null;
      if (!shot || !validId(shot.id) || !validId(shot.resultAssetId) || !(await ownedObject(shot.resultAssetId)) ||
          (shot.originalAssetId !== undefined && (!validId(shot.originalAssetId) || !(await ownedObject(shot.originalAssetId)))) ||
          (shot.selectedAssetId !== undefined && (!validId(shot.selectedAssetId) || !(await ownedObject(shot.selectedAssetId)) || shot.selectedAssetId !== shot.resultAssetId)) ||
          (shot.sourceAssetId !== undefined && (!validId(shot.sourceAssetId) || !(await ownedObject(shot.sourceAssetId))))) {
        throw new SyncError(400, "镜头引用了不存在或无权访问的素材");
      }
    }
    if (payload.timelineClips !== undefined) {
      if (!Array.isArray(payload.timelineClips) || payload.timelineClips.length !== timeline.length) throw new SyncError(400, "时间线片段不匹配");
      const ids = new Set<string>();
      const savedById = new Map(((previous?.timelineClips as { id: string; assetId: string }[] | undefined) ?? [])
        .map(clip => [clip.id, clip.assetId]));
      for (let index = 0; index < timeline.length; index++) {
        const clip = payload.timelineClips[index] as Record<string, unknown> | null;
        if (!clip || !validId(clip.id) || ids.has(clip.id) || clip.assetId !== timeline[index] ||
            !Number.isSafeInteger(clip.inMs) || !Number.isSafeInteger(clip.outMs) ||
            (clip.inMs as number) < 0 || (clip.outMs as number) <= (clip.inMs as number) ||
            typeof clip.volume !== "number" || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2) {
          throw new SyncError(400, "时间线片段无效");
        }
        if (savedById.has(clip.id) && savedById.get(clip.id) !== clip.assetId)
          throw new SyncError(409, "画面片段 ID 已关联其他源素材，请刷新时间线");
        ids.add(clip.id);
      }
    }
    if (previous && Array.isArray(previous.timeline) && Array.isArray(payload.timelineClips)) {
      const saved = projectEpisodeVisuals(previous as unknown as CloudAudioEpisode);
      const requested = payload.timelineClips as { id: string; assetId: string; inMs: number; outMs: number }[];
      const savedById = new Map(saved.map(clip => [clip.id, clip]));
      const savedAssets = new Set(saved.map(clip => clip.assetId));
      const segmentEdit = saved.some(clip => {
        const next = requested.find(item => item.id === clip.id);
        return !next || next.inMs !== clip.inMs || next.outMs !== clip.outMs;
      }) || requested.some(clip => !savedById.has(clip.id) && savedAssets.has(clip.assetId));
      if (segmentEdit && incomingAudio?.version !== 3)
        throw new SyncError(409, "分割、裁剪或删除画面须同时提交 v3 原声音轨，避免丢失分段信息");
    }
    if (payload.audio !== undefined) {
      const parsed = EpisodeAudioSchema.safeParse(payload.audio);
      if (!parsed.success) throw new SyncError(400, "分集音轨无效");
      let audio = parsed.data;
      if ("version" in audio && (audio.version === 2 || audio.version === 3)) {
        try {
          const projected = projectEpisodeAudio(payload as unknown as CloudAudioEpisode);
          if (!projected) throw new Error("分集音轨不存在");
          audio = projected as typeof audio;
          payload.audio = projected;
        } catch {
          const visualIds = new Set((payload.timelineClips as { id: string }[] | undefined)?.map(clip => clip.id) ?? []);
          const affected = [...audio.voiceClips, ...audio.musicClips].filter(clip => {
            const anchor = (clip as { anchor?: { kind: string; clipId?: string } }).anchor;
            return anchor?.kind === "visual-clip" && !visualIds.has(anchor.clipId ?? "");
          });
          throw new SyncError(409, "音频片段的镜头锚点已失效，请逐条移除或固定到整集时间", {
            affectedAudioClips: affected.map(clip => "id" in clip ? clip.id : undefined).filter(Boolean),
          });
        }
      }
      if ("version" in audio && audio.version === 3 && savedV3?.locks && !audio.locks) {
        audio = { ...audio, locks: savedV3.locks };
        payload.audio = audio;
      }
      const episodeDuration = (payload.timelineClips as { inMs: number; outMs: number }[] | undefined)
        ?.reduce((total, clip) => total + clip.outMs - clip.inMs, 0)
        ?? (payload.timeline as string[]).reduce((total, assetId) => total +
          ((payload.shots as { resultAssetId: string; durationSec: number }[]).find(shot => shot.resultAssetId === assetId)?.durationSec ?? 5) * 1000, 0);
      if ("version" in audio && (audio.version === 2 || audio.version === 3) &&
          (!Number.isSafeInteger(episodeDuration) || episodeDuration > 20 * 60_000 || timeline.length > 100)) {
        throw new SyncError(400, "分集时长或镜头数量超出精准预览限制");
      }
      if ("version" in audio && audio.version === 3) {
        const visuals = payload.timelineClips as { id: string; assetId: string; inMs: number; outMs: number; volume: number }[] | undefined;
        if (!visuals || visuals.length !== timeline.length) throw new SyncError(400, "新版时间线须包含完整画面片段");
        const byId = new Map(visuals.map(clip => [clip.id, clip]));
        const inspected = new Map<string, { durationMs?: number; hasAudio?: boolean }>();
        for (const visual of visuals) {
          if (visual.outMs - visual.inMs < 300) throw new SyncError(400, "画面片段不得短于 300 毫秒");
          if (!inspected.has(visual.assetId)) {
            const object = await ownedObject(visual.assetId);
            if (!object || object.mime !== "video/mp4" || !existsSync(object.path)) throw new SyncError(410, "画面素材文件已失效");
            inspected.set(visual.assetId, await inspectMediaFile(object.path, object.mime));
          }
          if (visual.outMs > (inspected.get(visual.assetId)?.durationMs ?? 0))
            throw new SyncError(400, "画面裁剪超出源视频时长");
        }
        const ranges = new Map<string, { inMs: number; outMs: number }[]>();
        for (const clip of audio.originalClips) {
          const visual = byId.get(clip.visualClipId);
          if (!visual || clip.assetId !== visual.assetId || clip.inMs < visual.inMs || clip.outMs > visual.outMs)
            throw new SyncError(400, "镜头原声片段须位于所属画面的同源范围");
          if (!inspected.get(clip.assetId)?.hasAudio) throw new SyncError(400, "源视频没有可编辑的原声轨道");
          const list = ranges.get(clip.visualClipId) ?? [];
          if (list.some(range => clip.inMs < range.outMs && clip.outMs > range.inMs))
            throw new SyncError(400, "同一画面的原声片段不能重叠");
          list.push({ inMs: clip.inMs, outMs: clip.outMs });
          ranges.set(clip.visualClipId, list);
        }
        const removedAnchors = [...audio.voiceClips, ...audio.musicClips].filter(clip =>
          clip.anchor.kind === "visual-clip" && !byId.has(clip.anchor.clipId));
        if (removedAnchors.length) throw new SyncError(409, "画面已删除，请逐条处理跟随该画面的配音或音乐", {
          affectedAudioClips: removedAnchors.map(clip => clip.id),
        });
      }
      const overflowAudioClips: string[] = [];
      for (const [kind, clips] of [["voice", audio.voiceClips], ["music", audio.musicClips]] as const) {
        for (const clip of clips) {
          const asset = document.assets.find(item => item.id === clip.assetId && item.kind === kind);
          const object = await ownedObject(clip.assetId);
          const assetDuration = asset?.durationMs;
          if (!asset || !object) throw new SyncError(404, "音频素材不存在或无权访问");
          if (!existsSync(object.path)) throw new SyncError(410, "音频素材文件已失效，请重新上传");
          if (!object.mime.startsWith("audio/") || !Number.isSafeInteger(assetDuration) ||
              (assetDuration as number) <= 0 || clip.outMs > (assetDuration as number) ||
              !Number.isSafeInteger(clip.startMs + clip.outMs - clip.inMs)) {
            throw new SyncError(400, "音频裁剪超出素材或分集范围，请调整入点、出点和起点");
          }
          if (clip.startMs + clip.outMs - clip.inMs > episodeDuration)
            overflowAudioClips.push("id" in clip ? String(clip.id) : clip.assetId);
        }
      }
      if (overflowAudioClips.length) throw new SyncError(409,
        "音频超出新片尾，请逐条选择返回调整或明确裁剪/移除", { affectedAudioClips: overflowAudioClips });
    }
  }
  if (type === "asset") {
    if (!["image", "video", "voice", "music"].includes(String(payload.kind))) throw new SyncError(400, "素材类型无效");
    const object = (await ownedObject(body.resourceId));
    if (!object || (payload.kind === "video" && object.mime !== "video/mp4") ||
        (payload.kind === "image" && !object.mime.startsWith("image/")) ||
        (["voice", "music"].includes(String(payload.kind)) && !["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4"].includes(object.mime))) {
      throw new SyncError(400, "素材未上传到当前账户或类型不匹配");
    }
    if (payload.kind === "voice" || payload.kind === "music") {
      const inspected = await inspectMediaFile(object.path, object.mime);
      if (typeof payload.name !== "string" || payload.name.length > 200 || payload.mimeType !== object.mime ||
          !Number.isSafeInteger(payload.durationMs) || Math.abs((payload.durationMs as number) - (inspected.durationMs ?? 0)) > 100) {
        throw new SyncError(400, "音频素材元数据不匹配");
      }
    }
  }
  if (type === "character") {
    if (typeof payload.name !== "string" || typeof payload.assetId !== "string" || !document.assets.some(item => item.id === payload.assetId && item.kind === "image")) throw new SyncError(400, "人物参考照片无效");
  }
  return { ...body, payload: type === "brief" ? parseCreationBrief(payload) : payload } as unknown as SyncCommand;
}

export async function applyProjectCommand(db: PgDatabase, ownerId: string, projectId: string, body: Record<string, unknown>) {
  return await db.transaction(async () => {
  try {
    const row = (await db.prepare("SELECT id,title,revision,document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE")
      .get(projectId, ownerId)) as { id: string; title: string; revision: number; document_json: string } | undefined;
    if (!row) throw new SyncError(404, "项目不存在");
    const document = JSON.parse(row.document_json) as CloudProjectDocument;
    const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const existing = validId(body.id) ? (await db.prepare("SELECT payload_hash,resulting_revision FROM project_commands WHERE project_id=? AND command_id=?")
      .get(projectId, body.id)) as { payload_hash: string; resulting_revision: number } | undefined : undefined;
    const replay = async () => ({ project: { id: row.id, title: row.title, revision: row.revision,
      document, resourceRevisions: await listResourceRevisions(db, projectId) },
      resourceRevision: existing!.resulting_revision, replayed: true });
    if (existing?.payload_hash === payloadHash) return replay();
    const command = await validateCommand(db, ownerId, document, body);
    if (existing) {
      const oldHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
      if (existing.payload_hash === oldHash) return replay();
      throw new SyncError(409, "同步命令 ID 已用于其他内容");
    }
    const revisionRow = (await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type=? AND resource_id=?")
      .get(projectId, command.resourceType, command.resourceId)) as { revision: number } | undefined;
    const previous = currentPayload(document, command.resourceType, command.resourceId);
    const revision = revisionRow?.revision ?? (previous ? 1 : 0);
    if (command.baseRevision !== revision) throw new SyncError(409, "资源版本冲突", { resourceRevision: revision, resource: previous });
    if (command.resourceType === "brief") {
      const brief = command.payload as CreationBrief;
      if (previous) assertBriefEdit(previous as CreationBrief, brief);
      else (await assertInitialAgentBrief(db, ownerId, brief));
    }
    const changed = applySyncCommand(document, command);
    (await db.prepare("UPDATE projects SET document_json=?,revision=revision+1,updated_at=GREATEST(updated_at+1,?),recent_episode_id=COALESCE(?,recent_episode_id) WHERE id=? AND owner_id=?")
      .run(JSON.stringify(changed), Date.now(), ["episode", "canvas"].includes(command.resourceType) ? command.resourceId : null, projectId, ownerId));
    (await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,?,?,?) ON CONFLICT(project_id,resource_type,resource_id) DO UPDATE SET revision=excluded.revision")
      .run(projectId, command.resourceType, command.resourceId, revision + 1));
    (await db.prepare("INSERT INTO project_commands (project_id,command_id,payload_hash,resource_type,resource_id,resulting_revision,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(projectId, command.id, payloadHash, command.resourceType, command.resourceId, revision + 1, Date.now()));

    return { project: { id: row.id, title: row.title, revision: row.revision + 1, document: changed, resourceRevisions: (await listResourceRevisions(db, projectId)) }, resourceRevision: revision + 1, replayed: false };
  } catch (error) {  throw error; }
});
}
