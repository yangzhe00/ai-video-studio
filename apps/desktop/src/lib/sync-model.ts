import { cloudTimelineClips } from "@ai-video/project-core";
import type { CloudEpisode, StudioEpisode, TimelineClip } from "@ai-video/project-core";

export function toCloudEpisode(episode: StudioEpisode, localToCloud: Record<string, string>, existing?: CloudEpisode): CloudEpisode {
  const unsupported = episode.clips.find(clip => !localToCloud[clip.assetId]);
  if (unsupported) throw new Error(`时间线片段 ${unsupported.id} 的素材尚未同步，已保留本地剪辑`);
  const timelineClips = episode.clips.flatMap(clip => {
    const assetId = localToCloud[clip.assetId];
    return assetId ? [{ ...clip, assetId }] : [];
  });
  return { id: episode.id, title: episode.title, shots: existing?.shots ?? [],
    timeline: timelineClips.map(clip => clip.assetId), timelineClips };
}

export function fromCloudClips(episode: CloudEpisode, cloudToLocal: Record<string, string>): TimelineClip[] {
  return cloudTimelineClips(episode).map(clip => ({ ...clip,
    assetId: cloudToLocal[clip.assetId] ?? clip.assetId }));
}
