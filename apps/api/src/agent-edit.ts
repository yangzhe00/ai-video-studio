import { createHash, randomUUID } from "node:crypto";
import type { AgentEditAction, AgentEditContext } from "@ai-video/api-contracts";
import { applyVideoEdit } from "@ai-video/plugin-video-edit/core";
import type { VideoEditRecipe, VideoEditCommand } from "@ai-video/plugin-video-edit/core";
import type { ApiConfig } from "./config.ts";
import type { PgDatabase } from "./db.ts";
import { generateAgentEditSuggestions } from "./agent-edit-provider.ts";
import { applyEditCommand } from "./video-edits.ts";
import { applyProjectCommand } from "./sync.ts";

export class AgentEditError extends Error { constructor(readonly status: number, message: string) { super(message); } }
interface Snapshot {
  episodeRevision: number;
  episode: { id: string; shots: { id: string; resultAssetId: string; originalAssetId?: string; durationSec?: number }[]; timeline: string[];
    timelineClips?: { id: string; assetId: string; inMs: number; outMs: number; volume: number }[] };
  edits: { id: string; shotId: string; revision: number; recipe: VideoEditRecipe }[];
  voiceAssets: { id: string; durationMs: number }[];
}
interface Row { id: string; owner_id: string; project_id: string; episode_id: string; client_request_id: string;
  request_hash: string; instruction: string; snapshot_json: string; actions_json: string | null;
  state: "pending" | "generating" | "ready" | "failed"; error: string | null;
  confirmation_request_id: string | null; confirmation_hash: string | null; confirmed_action_ids_json: string | null;
  created_at: number; updated_at: number }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function displayContext(snapshot: Snapshot): AgentEditContext {
  const remaining = [...snapshot.episode.shots];
  const timelineIds = snapshot.episode.timeline.map(assetId => {
    const index = remaining.findIndex(shot => (shot.originalAssetId ?? shot.resultAssetId) === assetId);
    return index < 0 ? undefined : remaining.splice(index, 1)[0].id;
  });
  const shotIds = timelineIds.length === snapshot.episode.shots.length && timelineIds.every(Boolean)
    ? timelineIds as string[] : snapshot.episode.shots.map(shot => shot.id);
  return { episode: { revision: snapshot.episodeRevision, shotIds },
    edits: snapshot.edits.map(edit => ({ id: edit.id, shotId: edit.shotId, revision: edit.revision,
      trimStartMs: edit.recipe.trimStartMs, trimEndMs: edit.recipe.trimEndMs,
      captions: edit.recipe.captions,
      voiceClips: edit.recipe.version === 2 ? edit.recipe.audioMix.voiceClips : [],
    })) };
}

function view(row: Row) {
  const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
  return { id: row.id, projectId: row.project_id, episodeId: row.episode_id,
    clientRequestId: row.client_request_id, revision: 1 as const, state: row.state,
    actions: row.actions_json ? JSON.parse(row.actions_json) as AgentEditAction[] : [],
    context: displayContext(snapshot),
    confirmedActionIds: row.confirmed_action_ids_json ? JSON.parse(row.confirmed_action_ids_json) as string[] : [],
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getAgentEdit(db: PgDatabase, ownerId: string, id: string) {
  const row = await db.prepare("SELECT * FROM agent_edit_sets WHERE id=? AND owner_id=?").get(id, ownerId) as Row | undefined;
  if (!row) throw new AgentEditError(404, "Agent 建议不存在");
  return view(row);
}

export async function getAgentEditByRequest(db: PgDatabase, ownerId: string, projectId: string, clientRequestId: string) {
  const row = await db.prepare("SELECT * FROM agent_edit_sets WHERE owner_id=? AND project_id=? AND client_request_id=?")
    .get(ownerId, projectId, clientRequestId) as Row | undefined;
  if (!row) throw new AgentEditError(404, "Agent 建议不存在");
  return view(row);
}

export async function createAgentEdit(db: PgDatabase, ownerId: string, projectId: string,
  config: ApiConfig, body: Record<string, unknown>) {
  if (!(config.agentEditModelBaseUrl ?? config.ideaModelBaseUrl) ||
      !(config.agentEditModelApiKey ?? config.ideaModelApiKey) ||
      !(config.agentEditModelId ?? config.ideaModelId)) throw new AgentEditError(503, "Agent 剪辑模型尚未配置");
  return db.transaction(async () => {
    await db.lock(`agent-edit-create:${ownerId}:${body.clientRequestId}`);
    const hash = digest({ projectId, episodeId: body.episodeId, instruction: body.instruction });
    const previous = await db.prepare("SELECT * FROM agent_edit_sets WHERE owner_id=? AND client_request_id=?")
      .get(ownerId, body.clientRequestId) as Row | undefined;
    if (previous) {
      if (previous.request_hash !== hash) throw new AgentEditError(409, "建议请求 ID 已用于其他内容");
      return { set: view(previous), replayed: true };
    }
    const project = await db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=?")
      .get(projectId, ownerId) as { document_json: string } | undefined;
    if (!project) throw new AgentEditError(404, "项目不存在");
    const document = JSON.parse(project.document_json) as { episodes: Snapshot["episode"][];
      assets: { id: string; kind: string; durationMs?: number }[] };
    const episode = document.episodes.find(item => item.id === body.episodeId);
    if (!episode) throw new AgentEditError(404, "分集不存在");
    const resource = await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type='episode' AND resource_id=?")
      .get(projectId, episode.id) as { revision: number } | undefined;
    const edits = await db.prepare("SELECT id,shot_id,revision,recipe_json FROM video_edits WHERE owner_id=? AND project_id=? AND episode_id=?")
      .all(ownerId, projectId, episode.id) as { id: string; shot_id: string; revision: number; recipe_json: string }[];
    const snapshot: Snapshot = { episodeRevision: resource?.revision ?? 1,
      episode: { id: episode.id, shots: episode.shots.map(shot => ({ id: shot.id, resultAssetId: shot.resultAssetId,
        originalAssetId: shot.originalAssetId, durationSec: shot.durationSec })),
        timeline: episode.timeline, timelineClips: episode.timelineClips },
      edits: edits.map(edit => ({ id: edit.id, shotId: edit.shot_id, revision: edit.revision,
        recipe: JSON.parse(edit.recipe_json) as VideoEditRecipe })),
      voiceAssets: document.assets.filter(asset => asset.kind === "voice" && Number.isSafeInteger(asset.durationMs))
        .map(asset => ({ id: asset.id, durationMs: asset.durationMs! })) };
    const id = randomUUID(), now = Date.now();
    await db.prepare(`INSERT INTO agent_edit_sets (id,owner_id,project_id,episode_id,client_request_id,request_hash,
      instruction,snapshot_json,state,prompt_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending','edit-v1',?,?)`)
      .run(id, ownerId, projectId, episode.id, body.clientRequestId, hash, body.instruction,
        JSON.stringify(snapshot), now, now);
    return { set: await getAgentEdit(db, ownerId, id), replayed: false };
  });
}

function validatedActions(snapshot: Snapshot, actions: AgentEditAction[]): AgentEditAction[] {
  if (!actions.length) throw new Error("Agent 没有给出建议");
  let reorderCount = 0;
  return actions.map(action => {
    if (action.type === "reorder-shots") {
      reorderCount++;
      if (reorderCount > 1 || action.episodeId !== snapshot.episode.id || action.expectedRevision !== snapshot.episodeRevision ||
          action.shotIds.length !== snapshot.episode.shots.length ||
          new Set(action.shotIds).size !== action.shotIds.length ||
          !action.shotIds.every(id => snapshot.episode.shots.some(shot => shot.id === id)) ||
          snapshot.episode.timeline.length !== snapshot.episode.shots.length) throw new Error("Agent 镜头排序与分集快照不一致");
      return { ...action, id: randomUUID() };
    }
    const edit = snapshot.edits.find(item => item.id === action.editId);
    if (!edit || edit.revision !== action.expectedRevision) throw new Error("Agent 引用了无效或过期的镜头编辑");
    if (action.type === "set-voice") {
      const asset = snapshot.voiceAssets.find(item => item.id === action.assetId);
      if (!asset || action.outMs <= action.inMs || action.outMs > asset.durationMs) throw new Error("Agent 配音素材或裁剪时间无效");
      const old = edit.recipe.version === 2 ? edit.recipe.audioMix : { originalVolume: 1, voiceClips: [], musicClips: [] };
      const command: VideoEditCommand = { type: "set-audio-mix", originalVolume: old.originalVolume,
        voiceClips: [...old.voiceClips, { assetId: action.assetId, startMs: action.startMs,
          inMs: action.inMs, outMs: action.outMs, volume: action.volume }], musicClips: old.musicClips };
      if (applyVideoEdit(edit.recipe, command, edit.revision).issues.length) throw new Error("Agent 配音超出镜头保留时长");
      return { ...action, id: randomUUID() };
    }
    if (action.type === "set-trim") {
      if (action.startMs >= action.endMs || applyVideoEdit(edit.recipe,
        { type: "set-trim", startMs: action.startMs, endMs: action.endMs }, edit.revision).issues.length) {
        throw new Error("Agent 裁剪超出原视频或覆盖现有字幕/配音");
      }
      return { ...action, id: randomUUID() };
    }
    const caption = { ...action.caption, id: randomUUID() };
    if (caption.startMs >= caption.endMs || applyVideoEdit(edit.recipe,
      { type: "upsert-caption", caption }, edit.revision).issues.length) throw new Error("Agent 字幕时间无效");
    return { ...action, id: randomUUID(), caption };
  });
}

export class AgentEditWorker {
  private active = new Set<string>();
  constructor(private readonly db: PgDatabase, private readonly config: ApiConfig,
    private readonly generate: typeof generateAgentEditSuggestions = generateAgentEditSuggestions) {}

  async tick(now = Date.now()): Promise<void> {
    const rows = await this.db.prepare("SELECT id FROM agent_edit_sets WHERE state='pending' ORDER BY created_at LIMIT 2")
      .all() as { id: string }[];
    await Promise.all(rows.map(row => this.run(row.id)));
    await this.db.prepare("UPDATE agent_edit_sets SET state='failed',error='Agent 请求中断，请重新发起建议',updated_at=? WHERE state='generating' AND updated_at<?")
      .run(now, now - 60_000);
  }

  async run(id: string): Promise<void> {
    if (this.active.has(id) || this.active.size >= 2) return;
    this.active.add(id);
    try {
      const claimed = await this.db.prepare("UPDATE agent_edit_sets SET state='generating',updated_at=? WHERE id=? AND state='pending'")
        .run(Date.now(), id);
      if (!claimed.changes) return;
      const row = await this.db.prepare("SELECT * FROM agent_edit_sets WHERE id=?").get(id) as Row;
      try {
        const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
        const raw = await this.generate(this.config, snapshot, row.instruction);
        const actions = validatedActions(snapshot, raw);
        await this.db.prepare("UPDATE agent_edit_sets SET state='ready',actions_json=?,error=NULL,updated_at=? WHERE id=? AND state='generating'")
          .run(JSON.stringify(actions), Date.now(), id);
      } catch (error) {
        await this.db.prepare("UPDATE agent_edit_sets SET state='failed',error=?,updated_at=? WHERE id=? AND state='generating'")
          .run(error instanceof Error ? error.message.slice(0, 300) : "Agent 建议生成失败", Date.now(), id);
      }
    } finally { this.active.delete(id); }
  }
}

export async function confirmAgentEdit(db: PgDatabase, ownerId: string, id: string, body: Record<string, unknown>) {
  return db.transaction(async () => {
    const row = await db.prepare("SELECT * FROM agent_edit_sets WHERE id=? AND owner_id=? FOR UPDATE").get(id, ownerId) as Row | undefined;
    if (!row) throw new AgentEditError(404, "Agent 建议不存在");
    if (row.state !== "ready") throw new AgentEditError(409, "Agent 建议尚不可确认");
    if (body.expectedRevision !== 1) throw new AgentEditError(409, "Agent 建议版本冲突");
    const acceptedIds = body.acceptedActionIds as string[];
    const hash = digest({ acceptedIds });
    if (row.confirmation_request_id) {
      if (row.confirmation_request_id !== body.clientRequestId || row.confirmation_hash !== hash) {
        throw new AgentEditError(409, "Agent 建议已经确认，不能覆盖先前选择");
      }
      return await getAgentEdit(db, ownerId, id);
    }
    const actions = JSON.parse(row.actions_json ?? "[]") as AgentEditAction[];
    if (new Set(acceptedIds).size !== acceptedIds.length || !acceptedIds.every(actionId => actions.some(action => action.id === actionId))) {
      throw new AgentEditError(400, "选择的 Agent 建议不存在或重复");
    }
    const selected = acceptedIds.map(actionId => actions.find(action => action.id === actionId)!);
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    const project = await db.prepare("SELECT document_json FROM projects WHERE id=? AND owner_id=? FOR UPDATE")
      .get(row.project_id, ownerId) as { document_json: string } | undefined;
    if (!project) throw new AgentEditError(404, "项目不存在");
    const document = JSON.parse(project.document_json) as { episodes: (Snapshot["episode"] & { title: string })[];
      assets: { id: string; kind: string }[] };
    const episode = document.episodes.find(item => item.id === row.episode_id);
    if (!episode) throw new AgentEditError(409, "分集已变化");
    const resource = await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type='episode' AND resource_id=?")
      .get(row.project_id, row.episode_id) as { revision: number } | undefined;
    if (selected.some(action => action.type === "reorder-shots") && (resource?.revision ?? 1) !== snapshot.episodeRevision) {
      throw new AgentEditError(409, "分集在预览后被修改，请重新生成建议");
    }
    const involved = [...new Set(selected.filter(action => action.type !== "reorder-shots").map(action => action.editId))];
    for (const editId of involved.sort()) {
      const expected = snapshot.edits.find(item => item.id === editId)?.revision;
      const current = await db.prepare("SELECT revision FROM video_edits WHERE id=? AND owner_id=? AND project_id=? FOR UPDATE")
        .get(editId, ownerId, row.project_id) as { revision: number } | undefined;
      if (!current || current.revision !== expected) throw new AgentEditError(409, "镜头在预览后被修改，请重新生成建议");
    }
    for (const action of selected) {
      if (action.type === "reorder-shots") {
        const byShotId = new Map(episode.shots.map(shot => [shot.id, shot.originalAssetId ?? shot.resultAssetId]));
        const timeline = action.shotIds.map(shotId => byShotId.get(shotId)!);
        if (timeline.length !== episode.timeline.length ||
            timeline.some(assetId => !episode.timeline.includes(assetId))) throw new AgentEditError(409, "镜头时间线已变化");
        const available = [...episode.timelineClips ?? episode.timeline.map((assetId, index) => ({
          id: `legacy-${index}`, assetId, inMs: 0,
          outMs: (episode.shots.find(shot => (shot.originalAssetId ?? shot.resultAssetId) === assetId)?.durationSec ?? 5) * 1000,
          volume: 1 }))];
        const timelineClips = timeline.map(assetId => {
          const index = available.findIndex(clip => clip.assetId === assetId);
          if (index < 0) throw new AgentEditError(409, "镜头时间线已变化");
          return available.splice(index, 1)[0];
        });
        await applyProjectCommand(db, ownerId, row.project_id, { id: action.id, resourceType: "episode",
          resourceId: row.episode_id, baseRevision: snapshot.episodeRevision,
          payload: { ...episode, timeline, timelineClips } });
      } else {
        const current = await db.prepare("SELECT recipe_json,revision FROM video_edits WHERE id=? AND owner_id=?")
          .get(action.editId, ownerId) as { recipe_json: string; revision: number };
        const recipe = JSON.parse(current.recipe_json) as VideoEditRecipe;
        let command: VideoEditCommand;
        if (action.type === "set-trim") command = { type: "set-trim", startMs: action.startMs, endMs: action.endMs };
        else if (action.type === "upsert-caption") command = { type: "upsert-caption", caption: action.caption };
        else {
          const old = recipe.version === 2 ? recipe.audioMix : { originalVolume: 1, voiceClips: [], musicClips: [] };
          if (!document.assets.some(asset => asset.id === action.assetId && asset.kind === "voice")) throw new AgentEditError(409, "配音素材已移除");
          command = { type: "set-audio-mix", originalVolume: old.originalVolume,
            voiceClips: [...old.voiceClips, { assetId: action.assetId, startMs: action.startMs,
              inMs: action.inMs, outMs: action.outMs, volume: action.volume }], musicClips: old.musicClips };
        }
        await applyEditCommand(db, ownerId, action.editId, { commandId: action.id,
          expectedRevision: current.revision, command });
      }
    }
    await db.prepare("UPDATE agent_edit_sets SET confirmation_request_id=?,confirmation_hash=?,confirmed_action_ids_json=?,updated_at=? WHERE id=?")
      .run(body.clientRequestId, hash, JSON.stringify(acceptedIds), Date.now(), id);
    return await getAgentEdit(db, ownerId, id);
  });
}
