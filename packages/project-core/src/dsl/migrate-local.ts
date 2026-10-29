import { parseProjectDsl } from "@ai-video/project-schema";
import type { AssetV1, DslIssue, EpisodeV1, TimelineClipV1, TimelineTrackV1, VideoProjectV1 } from "@ai-video/project-schema";
import type { ProjectManifestV2 } from "../project";
import { ensureStudio, syncActiveEpisode } from "../studio";

export interface LocalAssetBinding {
  assetId: string;
  relativePath: string;
  missing: boolean;
  cloudObjectId?: string;
  uploadState?: "pending" | "uploaded" | "failed";
}

export interface LocalDslMigrationResult {
  project: VideoProjectV1;
  bindings: LocalAssetBinding[];
  issues: DslIssue[];
  activeEpisodeId: string;
}

function warning(path: string, code: string, message: string): DslIssue {
  return { path, code, message, severity: "warning" };
}

/** Pure conversion. The caller owns media probing, backup and disk writes. */
export function migrateLocalV2ToDsl(manifest: ProjectManifestV2): LocalDslMigrationResult {
  const current = syncActiveEpisode(ensureStudio(manifest));
  const studio = current.studio!;
  const issues: DslIssue[] = [];
  const bindings = current.assets.map(asset => ({
    assetId: asset.id, relativePath: asset.relativePath, missing: asset.missing,
  }));
  const assets: AssetV1[] = current.assets.map((asset, index) => {
    const name = asset.relativePath.split("/").pop() || asset.id;
    if (asset.missing) issues.push(warning(`$.assets.items[${index}]`, "missing_local_media", `本地素材 ${asset.id} 暂缺`));
    if (asset.kind !== "image" && asset.durationMs === null) {
      issues.push(warning(`$.assets.items[${index}].durationMs`, "unknown_media_duration", `素材 ${asset.id} 的时长待探测`));
    }
    if (asset.kind === "image") return {
      id: asset.id, kind: "image", name, mimeType: null, width: asset.width, height: asset.height,
    };
    if (asset.kind === "video") return {
      id: asset.id, kind: "video", name, mimeType: null,
      durationMs: asset.durationMs, width: asset.width, height: asset.height,
    };
    return { id: asset.id, kind: "audio", name, mimeType: null, durationMs: asset.durationMs };
  });
  const kindByAsset = new Map(current.assets.map(asset => [asset.id, asset.kind]));
  const episodeForShot = new Map<string, string>();
  for (const episode of studio.episodes) {
    for (const node of episode.nodes) if (node.shotId) {
      const existing = episodeForShot.get(node.shotId);
      if (existing && existing !== episode.id) throw new Error(`镜头 ${node.shotId} 同时属于多个分集`);
      episodeForShot.set(node.shotId, episode.id);
    }
  }
  const episodes: EpisodeV1[] = studio.episodes.map((episode, episodeIndex) => {
    const tracks = new Map<TimelineTrackV1["kind"], TimelineTrackV1>();
    let cursor = 0;
    for (const clip of episode.clips) {
      const sourceKind = kindByAsset.get(clip.assetId);
      if (!sourceKind) throw new Error(`分集 ${episode.id} 的片段 ${clip.id} 引用了不存在的资产`);
      const kind = sourceKind === "video" ? "video" : sourceKind === "image" ? "image" : "audio";
      const trackKind = kind === "audio" ? "audio" : "visual";
      if (!tracks.has(trackKind)) tracks.set(trackKind, { id: `track:${trackKind}:${episode.id}`, kind: trackKind, clips: [] });
      const length = clip.outMs - clip.inMs;
      const next: TimelineClipV1 = kind === "image"
        ? { kind, id: clip.id, startMs: cursor, assetId: clip.assetId, durationMs: length }
        : { kind, id: clip.id, startMs: cursor, assetId: clip.assetId,
          inMs: clip.inMs, outMs: clip.outMs, volume: clip.volume };
      tracks.get(trackKind)!.clips.push(next);
      cursor += length;
    }
    if (episode.captions.length) {
      const subtitleTrack: TimelineTrackV1 = { id: `track:subtitle:${episode.id}`, kind: "subtitle", clips: [] };
      episode.captions.forEach(caption => {
        const assetId = `subtitle-asset:${episode.id}:${caption.id}`;
        assets.push({ id: assetId, kind: "subtitle", name: `字幕 ${caption.id}`, format: "plain", text: caption.text });
        subtitleTrack.clips.push({ kind: "subtitle", id: caption.id, startMs: caption.startMs,
          assetId, durationMs: caption.endMs - caption.startMs });
      });
      tracks.set("subtitle", subtitleTrack);
    }
    const visualClips = (tracks.get("visual")?.clips ?? []).filter(
      (item): item is Extract<TimelineClipV1, { kind: "video" | "image" }> => item.kind === "video" || item.kind === "image",
    );
    let cover: EpisodeV1["cover"] = null;
    if (episode.coverTimeMs !== null) {
      const clip = visualClips.find(item => episode.coverTimeMs! >= item.startMs &&
        episode.coverTimeMs! < item.startMs + (item.kind === "image" ? item.durationMs : item.outMs - item.inMs));
      if (clip) cover = { assetId: clip.assetId,
        sourceTimeMs: clip.kind === "image" ? 0 : clip.inMs + episode.coverTimeMs - clip.startMs };
      else issues.push(warning(`$.episodes[${episodeIndex}].cover`, "unmapped_legacy_cover", "旧封面时间无法定位到视觉片段"));
    }
    return {
      id: episode.id, title: episode.title, publishingCopy: episode.publishingCopy, cover,
      scenes: current.shots.filter(shot => (episodeForShot.get(shot.id) ?? studio.activeEpisodeId) === episode.id)
        .map(shot => {
          const outputAssetIds = [...new Set(current.jobs.filter(job => job.shotId === shot.id &&
            job.state === "succeeded" && job.outputAssetId !== null).map(job => job.outputAssetId!))];
          for (const node of episode.nodes) if (node.shotId === shot.id && node.resultAssetId &&
            !outputAssetIds.includes(node.resultAssetId)) outputAssetIds.push(node.resultAssetId);
          return { id: shot.id, prompt: shot.prompt, sourceAssetId: shot.sourceAssetId,
            outputAssetIds, selectedAssetId: outputAssetIds[outputAssetIds.length - 1] ?? null, runIds: [] };
        }),
      tracks: [...tracks.values()],
    };
  });
  const extensions: Record<string, unknown> = { ...current.extensions };
  for (let index = 0; index < studio.episodes.length; index++) {
    const episode = studio.episodes[index];
    if (episode.coverTimeMs !== null && episodes[index].cover === null) {
      const legacy = extensions.legacy;
      const oldLegacy = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy as Record<string, unknown> : {};
      const covers = oldLegacy.localCoverTimeMs;
      const oldCovers = covers && typeof covers === "object" && !Array.isArray(covers) ? covers as Record<string, unknown> : {};
      extensions.legacy = { ...oldLegacy, localCoverTimeMs: { ...oldCovers, [episode.id]: episode.coverTimeMs } };
    }
  }
  const project: VideoProjectV1 = {
    schema: "ai-video/project", dslVersion: 1, projectId: current.id,
    metadata: { title: current.title }, canvasConfig: { width: 1080, height: 1920 },
    renderConfig: { fps: 30, format: "mp4" },
    characters: studio.characters.map(character => ({ id: character.id, name: character.name,
      description: character.description, referenceAssetId: character.assetId })),
    episodes, assets: { items: assets }, extensions,
  };
  const parsed = parseProjectDsl(project);
  if (!parsed.ok) throw new Error(`本地项目无法转换为 DSL：${parsed.issues.map(issue => `${issue.path} ${issue.message}`).join("；")}`);
  return { project: parsed.project, bindings, issues, activeEpisodeId: studio.activeEpisodeId };
}
