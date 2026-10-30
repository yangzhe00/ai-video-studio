import type { AudioPlacement } from "../core";
import type { VoiceDraftView } from "./VoiceoverPanel";

export interface AudioMixView {
  originalVolume: number;
  voiceClips: AudioPlacement[];
  musicClips: AudioPlacement[];
}

export function draftFromAudioMix(mix: AudioMixView): VoiceDraftView {
  const voice = mix.voiceClips[0];
  return {
    voiceAssetId: voice?.assetId ?? null,
    startMs: voice?.startMs ?? 0,
    trimStartMs: voice?.inMs ?? 0,
    trimEndMs: voice?.outMs ?? 0,
    voiceVolume: voice?.volume ?? 1,
    sourceVolume: mix.originalVolume,
    musicVolume: mix.musicClips[0]?.volume ?? 1,
  };
}

/** Keep additional tracks untouched when the simple editor changes its first voice clip. */
export function audioMixFromDraft(draft: VoiceDraftView, previous: AudioMixView): AudioMixView {
  const voice: AudioPlacement[] = draft.voiceAssetId ? [{ assetId: draft.voiceAssetId,
    startMs: draft.startMs, inMs: draft.trimStartMs, outMs: draft.trimEndMs, volume: draft.voiceVolume }] : [];
  const rest = previous.voiceClips.slice(1);
  return { originalVolume: draft.sourceVolume, voiceClips: [...voice, ...rest],
    musicClips: previous.musicClips.map((clip, index) => index === 0 ? { ...clip, volume: draft.musicVolume } : clip) };
}
