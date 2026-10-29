import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
interface CloudResource { id: string; [key: string]: unknown }
interface CloudProjectDocument {
  version: 1; episodes: CloudResource[]; assets: CloudResource[]; characters: CloudResource[];
  extensions?: Record<string, unknown>;
}
type SyncResourceType = "episode" | "asset" | "character" | "canvas";
interface SyncResourceRevision { resourceType: SyncResourceType; resourceId: string; revision: number }
interface SyncCommand { id: string; resourceType: SyncResourceType; resourceId: string; baseRevision: number; payload: CloudResource }

function applySyncCommand(document: CloudProjectDocument, command: SyncCommand): CloudProjectDocument {
  const { resourceType: type, resourceId: id, payload } = command;
  if (type === "canvas") {
    const old = document.extensions?.canvas as { episodeGraphs?: Record<string, unknown> } | undefined;
    return { ...document, extensions: { ...document.extensions, canvas: { version: 1, episodeGraphs: { ...old?.episodeGraphs, [id]: payload } } } };
  }
  const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
  const entries = document[field];
  return { ...document, [field]: entries.some(item => item.id === id) ? entries.map(item => item.id === id ? payload : item) : [...entries, payload] };
}

export class SyncError extends Error { constructor(readonly status: number, message: string, readonly snapshot?: unknown) { super(message); } }
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(id);
const allowedTypes = new Set(["episode", "asset", "character", "canvas"]);

export function listResourceRevisions(db: DatabaseSync, projectId: string): SyncResourceRevision[] {
  const rows = db.prepare("SELECT resource_type,resource_id,revision FROM resource_revisions WHERE project_id=?").all(projectId) as { resource_type: SyncResourceType; resource_id: string; revision: number }[];
  return rows.map(row => ({ resourceType: row.resource_type, resourceId: row.resource_id, revision: row.revision }));
}

function currentPayload(document: CloudProjectDocument, type: SyncCommand["resourceType"], id: string): unknown {
  if (type === "canvas") return (document.extensions?.canvas as { episodeGraphs?: Record<string, unknown> } | undefined)?.episodeGraphs?.[id];
  const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
  return document[field].find(item => item.id === id);
}

function validateCommand(db: DatabaseSync, ownerId: string, document: CloudProjectDocument, body: Record<string, unknown>): SyncCommand {
  const type = body.resourceType;
  if (!validId(body.id) || !validId(body.resourceId) || !allowedTypes.has(type as string) || !Number.isSafeInteger(body.baseRevision) || (body.baseRevision as number) < 0) {
    throw new SyncError(400, "同步命令格式无效");
  }
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) throw new SyncError(400, "同步内容无效");
  const payload = body.payload as Record<string, unknown>;
  const ownedObject = (id: unknown): { mime: string } | undefined =>
    typeof id === "string" ? db.prepare("SELECT mime FROM objects WHERE id=? AND owner_id=?").get(id, ownerId) as { mime: string } | undefined : undefined;
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
      if ((node.assetId !== undefined && (!projectAsset(node.assetId) || !ownedObject(node.assetId))) ||
          (node.resultAssetId !== undefined && (!projectAsset(node.resultAssetId) || !ownedObject(node.resultAssetId))) ||
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
    const timeline = payload.timeline as unknown[];
    if (!timeline.every(id => typeof id === "string" && validId(id))) throw new SyncError(400, "时间线素材 ID 无效");
    if (!timeline.every(id => projectAsset(id) && ownedObject(id))) throw new SyncError(400, "时间线引用了未添加或无权访问的素材");
    if ((payload.shots as unknown[]).length > 1000) throw new SyncError(400, "分集镜头过多");
    for (const raw of payload.shots as unknown[]) {
      const shot = raw as Record<string, unknown> | null;
      if (!shot || !validId(shot.id) || !validId(shot.resultAssetId) || !ownedObject(shot.resultAssetId) ||
          (shot.originalAssetId !== undefined && (!validId(shot.originalAssetId) || !ownedObject(shot.originalAssetId))) ||
          (shot.selectedAssetId !== undefined && (!validId(shot.selectedAssetId) || !ownedObject(shot.selectedAssetId) || shot.selectedAssetId !== shot.resultAssetId)) ||
          (shot.sourceAssetId !== undefined && (!validId(shot.sourceAssetId) || !ownedObject(shot.sourceAssetId)))) {
        throw new SyncError(400, "镜头引用了不存在或无权访问的素材");
      }
    }
    if (payload.timelineClips !== undefined) {
      if (!Array.isArray(payload.timelineClips) || payload.timelineClips.length !== timeline.length) throw new SyncError(400, "时间线片段不匹配");
      const ids = new Set<string>();
      for (let index = 0; index < timeline.length; index++) {
        const clip = payload.timelineClips[index] as Record<string, unknown> | null;
        if (!clip || !validId(clip.id) || ids.has(clip.id) || clip.assetId !== timeline[index] ||
            !Number.isSafeInteger(clip.inMs) || !Number.isSafeInteger(clip.outMs) ||
            (clip.inMs as number) < 0 || (clip.outMs as number) <= (clip.inMs as number) ||
            typeof clip.volume !== "number" || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2) {
          throw new SyncError(400, "时间线片段无效");
        }
        ids.add(clip.id);
      }
    }
  }
  if (type === "asset") {
    if (!["image", "video"].includes(String(payload.kind))) throw new SyncError(400, "素材类型无效");
    const object = ownedObject(body.resourceId);
    if (!object || (payload.kind === "video" && object.mime !== "video/mp4") ||
        (payload.kind === "image" && !object.mime.startsWith("image/"))) throw new SyncError(400, "素材未上传到当前账户或类型不匹配");
  }
  if (type === "character") {
    if (typeof payload.name !== "string" || typeof payload.assetId !== "string" || !document.assets.some(item => item.id === payload.assetId && item.kind === "image")) throw new SyncError(400, "人物参考照片无效");
  }
  return body as unknown as SyncCommand;
}

export function applyProjectCommand(db: DatabaseSync, ownerId: string, projectId: string, body: Record<string, unknown>) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT id,title,revision,document_json FROM projects WHERE id=? AND owner_id=?")
      .get(projectId, ownerId) as { id: string; title: string; revision: number; document_json: string } | undefined;
    if (!row) throw new SyncError(404, "项目不存在");
    const document = JSON.parse(row.document_json) as CloudProjectDocument;
    const command = validateCommand(db, ownerId, document, body);
    const payloadHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const existing = db.prepare("SELECT payload_hash,resulting_revision FROM project_commands WHERE project_id=? AND command_id=?")
      .get(projectId, command.id) as { payload_hash: string; resulting_revision: number } | undefined;
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new SyncError(409, "同步命令 ID 已用于其他内容");
      db.exec("COMMIT");
      return { project: { id: row.id, title: row.title, revision: row.revision, document, resourceRevisions: listResourceRevisions(db, projectId) }, resourceRevision: existing.resulting_revision, replayed: true };
    }
    const revisionRow = db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type=? AND resource_id=?")
      .get(projectId, command.resourceType, command.resourceId) as { revision: number } | undefined;
    const previous = currentPayload(document, command.resourceType, command.resourceId);
    const revision = revisionRow?.revision ?? (previous ? 1 : 0);
    if (command.baseRevision !== revision) throw new SyncError(409, "资源版本冲突", { resourceRevision: revision, resource: previous });
    const changed = applySyncCommand(document, command);
    db.prepare("UPDATE projects SET document_json=?,revision=revision+1,updated_at=MAX(updated_at+1,?),recent_episode_id=COALESCE(?,recent_episode_id) WHERE id=? AND owner_id=?")
      .run(JSON.stringify(changed), Date.now(), ["episode", "canvas"].includes(command.resourceType) ? command.resourceId : null, projectId, ownerId);
    db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,?,?,?) ON CONFLICT(project_id,resource_type,resource_id) DO UPDATE SET revision=excluded.revision")
      .run(projectId, command.resourceType, command.resourceId, revision + 1);
    db.prepare("INSERT INTO project_commands (project_id,command_id,payload_hash,resource_type,resource_id,resulting_revision,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(projectId, command.id, payloadHash, command.resourceType, command.resourceId, revision + 1, Date.now());
    db.exec("COMMIT");
    return { project: { id: row.id, title: row.title, revision: row.revision + 1, document: changed, resourceRevisions: listResourceRevisions(db, projectId) }, resourceRevision: revision + 1, replayed: false };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
