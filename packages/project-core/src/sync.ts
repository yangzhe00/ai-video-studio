import type { CanvasEpisodeGraphV1 } from "./canvas-extension.ts";
import type { CreationBrief } from "./brief.ts";
import { creationBriefs } from "./brief.ts";

export interface CloudAsset { id: string; kind: "image" | "video" | "voice" | "music"; name?: string; mimeType?: string; durationMs?: number }
export interface CloudShot { id: string; runId: string; resultAssetId: string; originalAssetId?: string; selectedAssetId?: string; sourceAssetId: string; prompt: string; durationSec: number }
export interface CloudTimelineClip { id: string; assetId: string; inMs: number; outMs: number; volume: number }
export interface CloudAudioPlacement { assetId: string; startMs: number; inMs: number; outMs: number; volume: number }
export interface CloudEpisodeAudio { originalVolume: number; voiceClips: CloudAudioPlacement[]; musicClips: CloudAudioPlacement[] }
export interface CloudEpisode { id: string; title: string; shots: CloudShot[]; timeline: string[]; timelineClips?: CloudTimelineClip[]; audio?: CloudEpisodeAudio }
export interface CloudCharacter { id: string; name: string; description: string; assetId: string }
export interface CloudProjectDocument {
  version: 1;
  episodes: CloudEpisode[];
  assets: CloudAsset[];
  characters: CloudCharacter[];
  briefs?: CreationBrief[];
  extensions?: Record<string, unknown>;
}
export type SyncResourceType = "episode" | "asset" | "character" | "canvas" | "brief";
export interface SyncCommand {
  id: string;
  resourceType: SyncResourceType;
  resourceId: string;
  baseRevision: number;
  payload: CloudEpisode | CloudAsset | CloudCharacter | CanvasEpisodeGraphV1 | CreationBrief;
}
export interface SyncResourceRevision { resourceType: SyncResourceType; resourceId: string; revision: number }

/** Read old asset-only timelines without discarding richer edits in new documents. */
export function cloudTimelineClips(episode: CloudEpisode): CloudTimelineClip[] {
  const timeline = episode.timeline ?? [];
  if (episode.timelineClips?.length === timeline.length &&
      episode.timelineClips.every((clip, index) => clip.assetId === timeline[index])) {
    return episode.timelineClips;
  }
  return timeline.map((assetId, index) => ({ id: `cloud-${episode.id}-${index}`, assetId,
    inMs: 0, outMs: ((episode.shots ?? []).find(shot => shot.resultAssetId === assetId)?.durationSec ?? 5) * 1000, volume: 1 }));
}

/** Reorder by asset occurrence, retaining each matching clip's edit parameters. */
export function timelineWithMetadata(episode: CloudEpisode, timeline: string[], newId: () => string): CloudEpisode {
  const available = [...cloudTimelineClips(episode)];
  const timelineClips = timeline.map(assetId => {
    const index = available.findIndex(clip => clip.assetId === assetId);
    if (index >= 0) return available.splice(index, 1)[0];
    return { id: newId(), assetId, inMs: 0,
      outMs: (episode.shots.find(shot => shot.resultAssetId === assetId)?.durationSec ?? 5) * 1000, volume: 1 };
  });
  return { ...episode, timeline, timelineClips };
}

export function resourceRevision(resources: SyncResourceRevision[], type: SyncResourceType, id: string): number {
  return resources.find(item => item.resourceType === type && item.resourceId === id)?.revision ?? 0;
}

export function applySyncCommand(document: CloudProjectDocument, command: SyncCommand): CloudProjectDocument {
  const { resourceType: type, resourceId: id, payload } = command;
  if (type === "canvas") {
    const old = document.extensions?.canvas as { version?: number; episodeGraphs?: Record<string, CanvasEpisodeGraphV1> } | undefined;
    return { ...document, extensions: { ...document.extensions, canvas: { version: 1, episodeGraphs: { ...old?.episodeGraphs, [id]: payload as CanvasEpisodeGraphV1 } } } };
  }
  if (type === "brief") {
    const entries = creationBriefs(document);
    return { ...document, briefs: entries.some(item => item.id === id)
      ? entries.map(item => item.id === id ? payload as CreationBrief : item)
      : [...entries, payload as CreationBrief] };
  }
  const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
  const entries = document[field] as Array<{ id: string }>;
  const next = entries.some(item => item.id === id) ? entries.map(item => item.id === id ? payload as { id: string } : item) : [...entries, payload as { id: string }];
  return { ...document, [field]: next } as CloudProjectDocument;
}
