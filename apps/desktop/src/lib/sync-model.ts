import { cloudTimelineClips } from "@ai-video/project-core";
import type { CloudEpisode, CloudEpisodeAudio, StudioEpisode, TimelineClip } from "@ai-video/project-core";

function mappedAudio(audio: CloudEpisodeAudio, assetMap: Record<string, string>): CloudEpisodeAudio {
  const mapped = (clips: CloudEpisodeAudio["voiceClips"]) => clips.map(clip => {
    const assetId = assetMap[clip.assetId];
    if (!assetId) throw new Error(`配音素材 ${clip.assetId} 尚未同步`);
    return { ...clip, assetId };
  });
  return { ...audio, voiceClips: mapped(audio.voiceClips), musicClips: mapped(audio.musicClips) };
}

export function toCloudEpisode(episode: StudioEpisode, localToCloud: Record<string, string>, existing?: CloudEpisode): CloudEpisode {
  const unsupported = episode.clips.find(clip => !localToCloud[clip.assetId]);
  if (unsupported) throw new Error(`时间线片段 ${unsupported.id} 的素材尚未同步，已保留本地剪辑`);
  const timelineClips = episode.clips.flatMap(clip => {
    const assetId = localToCloud[clip.assetId];
    return assetId ? [{ ...clip, assetId }] : [];
  });
  return { id: episode.id, title: episode.title, shots: existing?.shots ?? [],
    timeline: timelineClips.map(clip => clip.assetId), timelineClips,
    ...((episode.audio ?? existing?.audio) ? { audio: episode.audio
      ? mappedAudio(episode.audio, localToCloud) : existing!.audio } : {}) };
}

export function fromCloudAudio(episode: CloudEpisode, cloudToLocal: Record<string, string>): CloudEpisodeAudio | undefined {
  if (!episode.audio) return undefined;
  const mapped = (clips: CloudEpisodeAudio["voiceClips"]) => clips.map(clip => ({
    ...clip, assetId: cloudToLocal[clip.assetId] ?? clip.assetId,
  }));
  return { ...episode.audio, voiceClips: mapped(episode.audio.voiceClips), musicClips: mapped(episode.audio.musicClips) };
}

export function fromCloudClips(episode: CloudEpisode, cloudToLocal: Record<string, string>): TimelineClip[] {
  return cloudTimelineClips(episode).map(clip => ({ ...clip,
    assetId: cloudToLocal[clip.assetId] ?? clip.assetId }));
}
