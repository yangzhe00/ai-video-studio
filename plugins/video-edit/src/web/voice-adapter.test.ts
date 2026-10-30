import { describe, expect, it } from "vitest";
import { audioMixFromDraft, draftFromAudioMix } from "./voice-adapter";

describe("voice audio mix adapter", () => {
  it("preserves extra voice and music tracks while editing the first voice", () => {
    const mix = { originalVolume: 1, voiceClips: [
      { assetId: "voice-one", startMs: 0, inMs: 0, outMs: 3000, volume: 1 },
      { assetId: "voice-two", startMs: 4000, inMs: 0, outMs: 2000, volume: 0.7 },
    ], musicClips: [{ assetId: "music-one", startMs: 0, inMs: 0, outMs: 6000, volume: 0.3 }] };
    const draft = { ...draftFromAudioMix(mix), voiceAssetId: "voice-three", startMs: 500, sourceVolume: 0.8, musicVolume: 0.2 };
    expect(audioMixFromDraft(draft, mix)).toEqual({ originalVolume: 0.8, voiceClips: [
      { assetId: "voice-three", startMs: 500, inMs: 0, outMs: 3000, volume: 1 }, mix.voiceClips[1],
    ], musicClips: [{ ...mix.musicClips[0], volume: 0.2 }] });
  });
});
