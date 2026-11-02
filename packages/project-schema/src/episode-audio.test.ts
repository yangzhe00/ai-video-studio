import { describe, expect, it } from "vitest";
import { EpisodeAudioSchema, projectEpisodeAudio } from "./episode-audio.ts";

const clip = (id: string, startMs: number, anchor: { kind: "absolute" } | { kind: "visual-clip"; clipId: string; offsetMs: number }) =>
  ({ id, assetId: "voice-asset-0001", startMs, inMs: 0, outMs: 800, volume: 1, anchor });

describe("episode audio contract", () => {
  it("projects every legacy voice and music clip with stable IDs and unchanged absolute positions", () => {
    const episode = { id: "episode-0001", timeline: ["video-0001"], shots: [],
      timelineClips: [{ id: "visual-0001", assetId: "video-0001", inMs: 0, outMs: 3000 }],
      audio: { originalVolume: 1, voiceClips: [
        { assetId: "voice-asset-0001", startMs: 500, inMs: 0, outMs: 800, volume: 1 },
        { assetId: "voice-asset-0001", startMs: 1400, inMs: 0, outMs: 800, volume: 1 }],
      musicClips: [{ assetId: "music-asset-0001", startMs: 0, inMs: 0, outMs: 2000, volume: 0.3 }] } };
    const first = projectEpisodeAudio(episode)!;
    const second = projectEpisodeAudio(episode)!;
    expect(first.voiceClips.map(item => item.startMs)).toEqual([500, 1400]);
    expect(first.musicClips).toHaveLength(1);
    expect(first.voiceClips.map(item => item.id)).toEqual(second.voiceClips.map(item => item.id));
    expect(episode.audio.voiceClips[0]).not.toHaveProperty("id");
  });

  it("resolves anchored clips after shot reorder while absolute narration stays in place", () => {
    const episode = { id: "episode-0001", timeline: ["video-0002", "video-0001"], shots: [],
      timelineClips: [
        { id: "visual-0002", assetId: "video-0002", inMs: 0, outMs: 5000 },
        { id: "visual-0001", assetId: "video-0001", inMs: 0, outMs: 5000 }],
      audio: { version: 2 as const, originalVolume: 1,
        voiceClips: [clip("voice-clip-0001", 500, { kind: "visual-clip" as const, clipId: "visual-0001", offsetMs: 500 }),
          clip("voice-clip-0002", 1200, { kind: "absolute" as const })], musicClips: [] } };
    expect(projectEpisodeAudio(episode)!.voiceClips.map(item => item.startMs)).toEqual([5500, 1200]);
    expect(() => projectEpisodeAudio({ ...episode, timelineClips: episode.timelineClips.slice(0, 1),
      timeline: episode.timeline.slice(0, 1) })).toThrow(/锚点已失效/);
  });

  it("rejects duplicate IDs and clips under 300 milliseconds in v2 without rejecting legacy audio", () => {
    const base = { version: 2 as const, originalVolume: 1,
      voiceClips: [clip("voice-clip-0001", 0, { kind: "absolute" as const })], musicClips: [] };
    expect(EpisodeAudioSchema.safeParse(base).success).toBe(true);
    expect(EpisodeAudioSchema.safeParse({ ...base, musicClips: [clip("voice-clip-0001", 0, { kind: "absolute" })] }).success).toBe(false);
    expect(EpisodeAudioSchema.safeParse({ ...base,
      voiceClips: [{ ...base.voiceClips[0], outMs: 299 }] }).success).toBe(false);
    expect(EpisodeAudioSchema.safeParse({ originalVolume: 1,
      voiceClips: [{ assetId: "voice-asset-0001", startMs: 0, inMs: 0, outMs: 200, volume: 1 }], musicClips: [] }).success).toBe(true);
  });

  it("uses the original ten-second duration for an asset-only visual timeline", () => {
    const episode = { id: "episode-0010", timeline: ["video-0010"],
      shots: [{ resultAssetId: "video-0010", durationSec: 10 }],
      audio: { version: 2 as const, originalVolume: 1,
        voiceClips: [clip("voice-clip-0010", 0,
          { kind: "visual-clip", clipId: "cloud-episode-0010-0", offsetMs: 9000 })], musicClips: [] } };
    expect(projectEpisodeAudio(episode)?.voiceClips[0].startMs).toBe(9000);
    expect(projectEpisodeAudio({ ...episode, audio: undefined })).toBeUndefined();
    expect(episode.timeline).toEqual(["video-0010"]);
  });
});
