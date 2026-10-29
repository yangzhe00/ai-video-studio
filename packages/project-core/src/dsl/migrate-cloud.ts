import { parseProjectDsl } from "@ai-video/project-schema";
import type { AssetV1, EpisodeV1, TimelineClipV1, VideoProjectV1 } from "@ai-video/project-schema";

interface LegacyCloudAsset { id: string; kind: "image" | "video"; name?: string }
interface LegacyCloudShot {
  id: string; runId: string; resultAssetId: string; originalAssetId?: string; selectedAssetId?: string;
  sourceAssetId: string; prompt: string; durationSec: number;
}
interface LegacyCloudTimelineClip { id: string; assetId: string; inMs: number; outMs: number; volume: number }
interface LegacyCloudEpisode {
  id: string; title: string; shots: LegacyCloudShot[]; timeline: string[];
  timelineClips?: LegacyCloudTimelineClip[];
}
interface LegacyCloudCharacter { id: string; name: string; description: string; assetId: string }
export interface LegacyCloudDocumentV1 {
  version: 1; episodes: LegacyCloudEpisode[]; assets: LegacyCloudAsset[];
  characters: LegacyCloudCharacter[]; extensions?: Record<string, unknown>;
}

function legacyTimelineClips(episode: LegacyCloudEpisode): LegacyCloudTimelineClip[] {
  if (episode.timelineClips) return episode.timelineClips;
  return episode.timeline.map((assetId, index) => ({
    id: `cloud-${episode.id}-${index}`, assetId, inMs: 0,
    outMs: (episode.shots.find(shot => shot.resultAssetId === assetId)?.durationSec ?? 5) * 1000,
    volume: 1,
  }));
}

export interface CloudDslMigrationContext {
  projectId: string;
  title: string;
  versionsByShotId?: Record<string, {
    outputAssetId: string;
    coverAssetId?: string;
    recipeId: string;
    createdAt: number;
  }[]>;
}

/** Convert a normalized cloud V1 document; database history is supplied by the caller. */
export function migrateCloudV1ToDsl(document: LegacyCloudDocumentV1, context: CloudDslMigrationContext): VideoProjectV1 {
  if (document.version !== 1) throw new Error("不支持的云项目版本");
  const assetById = new Map<string, AssetV1>();
  for (const asset of document.assets) {
    assetById.set(asset.id, asset.kind === "image"
      ? { id: asset.id, kind: "image", name: asset.name ?? asset.id,
        mimeType: null, width: null, height: null }
      : { id: asset.id, kind: "video", name: asset.name ?? asset.id,
        mimeType: null, durationMs: null, width: null, height: null });
  }
  const ensureVideo = (id: string, sourceAssetId?: string, runId?: string, recipeId?: string) => {
    const existing = assetById.get(id);
    if (existing && existing.kind !== "video") return;
    assetById.set(id, {
      ...(existing ?? { id, kind: "video" as const, name: id, mimeType: null,
        durationMs: null, width: null, height: null }),
      provenance: { ...existing?.provenance,
        ...(sourceAssetId ? { sourceAssetIds: [sourceAssetId] } : {}),
        ...(runId ? { runId } : {}), ...(recipeId ? { recipeId } : {}) },
    });
  };
  const episodes: EpisodeV1[] = document.episodes.map(episode => {
    if (episode.timelineClips && (episode.timelineClips.length !== episode.timeline.length ||
      episode.timelineClips.some((clip, index) => clip.assetId !== episode.timeline[index]))) {
      throw new Error(`分集 ${episode.id} 的两种时间线表示不一致`);
    }
    const scenes = episode.shots.map(shot => {
      const versions = [...(context.versionsByShotId?.[shot.id] ?? [])]
        .sort((a, b) => a.createdAt - b.createdAt || a.outputAssetId.localeCompare(b.outputAssetId));
      const outputAssetIds: string[] = [];
      const addOutput = (id: string | undefined, recipeId?: string, sourceAssetId?: string) => {
        if (!id || outputAssetIds.includes(id)) return;
        outputAssetIds.push(id);
        ensureVideo(id, sourceAssetId ?? (recipeId ? undefined : shot.sourceAssetId),
          recipeId ? undefined : shot.runId, recipeId);
      };
      addOutput(shot.originalAssetId ?? shot.resultAssetId);
      let previousOutputId = shot.originalAssetId ?? shot.resultAssetId;
      for (const version of versions) {
        addOutput(version.outputAssetId, version.recipeId, previousOutputId);
        previousOutputId = version.outputAssetId;
        if (version.coverAssetId) {
          assetById.set(version.coverAssetId, { id: version.coverAssetId, kind: "thumbnail", name: version.coverAssetId,
            mimeType: null, width: null, height: null,
            provenance: { sourceAssetIds: [version.outputAssetId], recipeId: version.recipeId } });
        }
      }
      addOutput(shot.resultAssetId);
      addOutput(shot.selectedAssetId);
      return { id: shot.id, prompt: shot.prompt, sourceAssetId: shot.sourceAssetId,
        outputAssetIds, selectedAssetId: shot.selectedAssetId ?? shot.resultAssetId,
        runIds: shot.runId ? [shot.runId] : [] };
    });
    let cursor = 0;
    const clips: TimelineClipV1[] = legacyTimelineClips(episode).map(clip => {
      const asset = assetById.get(clip.assetId);
      const length = clip.outMs - clip.inMs;
      const next: TimelineClipV1 = asset?.kind === "image"
        ? { kind: "image", id: clip.id, startMs: cursor, assetId: clip.assetId, durationMs: length }
        : { kind: "video", id: clip.id, startMs: cursor, assetId: clip.assetId,
          inMs: clip.inMs, outMs: clip.outMs, volume: clip.volume };
      cursor += length;
      return next;
    });
    return { id: episode.id, title: episode.title, scenes,
      tracks: [{ id: `track:visual:${episode.id}`, kind: "visual", clips }],
      publishingCopy: "", cover: null };
  });
  const project: VideoProjectV1 = {
    schema: "ai-video/project", dslVersion: 1, projectId: context.projectId,
    metadata: { title: context.title }, canvasConfig: { width: 1080, height: 1920 },
    renderConfig: { fps: 30, format: "mp4" },
    characters: document.characters.map(item => ({ id: item.id, name: item.name,
      description: item.description, referenceAssetId: item.assetId })),
    episodes, assets: { items: [...assetById.values()] }, extensions: { ...document.extensions },
  };
  const parsed = parseProjectDsl(project);
  if (!parsed.ok) throw new Error(`云项目无法转换为 DSL：${parsed.issues.map(issue => `${issue.path} ${issue.message}`).join("；")}`);
  return parsed.project;
}
