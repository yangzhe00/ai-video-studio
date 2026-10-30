import { createHash } from "node:crypto";
import { creationBriefs } from "../../../packages/project-core/src/brief.ts";
import type { CreationBrief } from "../../../packages/project-core/src/brief.ts";

interface Resource { id: string; [key: string]: unknown }
interface Episode extends Resource { shots: Resource[]; timeline: string[]; timelineClips: { id: string; assetId: string; inMs: number; outMs: number; volume: number }[] }
export interface MigratedCloudDocument {
  version: 1;
  episodes: Episode[];
  assets: Resource[];
  characters: Resource[];
  briefs: CreationBrief[];
  extensions?: Record<string, unknown>;
}

export function migrateCloudDocument(projectId: string, raw: unknown): { document: MigratedCloudDocument; changed: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid cloud document in ${projectId}`);
  const source = raw as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.episodes)) throw new Error(`Unsupported cloud document in ${projectId}`);
  if (source.assets !== undefined && !Array.isArray(source.assets)) throw new Error(`Invalid cloud assets in ${projectId}`);
  if (source.characters !== undefined && !Array.isArray(source.characters)) throw new Error(`Invalid cloud characters in ${projectId}`);
  if (source.briefs !== undefined && !Array.isArray(source.briefs)) throw new Error(`Invalid cloud briefs in ${projectId}`);
  let changed = source.assets === undefined || source.characters === undefined || source.briefs === undefined;
  const episodes = source.episodes.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid cloud episode in ${projectId}`);
    const episode = value as Record<string, unknown>;
    if (typeof episode.id !== "string") throw new Error(`Invalid cloud episode ID in ${projectId}`);
    if (episode.shots !== undefined && !Array.isArray(episode.shots)) throw new Error(`Invalid cloud shots in ${projectId}`);
    if (episode.timeline !== undefined && !Array.isArray(episode.timeline)) throw new Error(`Invalid cloud timeline in ${projectId}`);
    const timeline = (episode.timeline ?? []) as string[];
    if (!timeline.every(id => typeof id === "string")) throw new Error(`Invalid cloud timeline IDs in ${projectId}`);
    const shots = (episode.shots ?? []) as Resource[];
    let timelineClips = episode.timelineClips;
    if (timelineClips === undefined) {
      timelineClips = timeline.map((assetId, index) => ({
        id: `legacy-${createHash("sha256").update(`${projectId}:${episode.id}:${index}`).digest("hex").slice(0, 24)}`,
        assetId, inMs: 0, outMs: ((shots.find(shot => shot.resultAssetId === assetId)?.durationSec as number | undefined) ?? 5) * 1000,
        volume: 1,
      }));
      changed = true;
    } else if (!Array.isArray(timelineClips) || timelineClips.length !== timeline.length ||
      !timelineClips.every((clip, index) => clip && typeof clip === "object" && clip.assetId === timeline[index])) {
      throw new Error(`Inconsistent cloud timeline in ${projectId}`);
    }
    if (episode.shots === undefined || episode.timeline === undefined) changed = true;
    return { ...episode, shots, timeline, timelineClips } as Episode;
  });
  return { document: { ...source, version: 1, episodes, assets: (source.assets ?? []) as Resource[],
    characters: (source.characters ?? []) as Resource[], briefs: creationBriefs(source) } as MigratedCloudDocument, changed };
}
