import { describe, expect, it } from "vitest";
import { timelineWithMetadata } from "./sync";

describe("cloud timeline metadata", () => {
  it("keeps per-clip edits when the web reorders duplicate assets", () => {
    const episode = { id: "episode-0001", title: "第一集", shots: [], timeline: ["asset-0001", "asset-0002", "asset-0001"], timelineClips: [
      { id: "clip-0001", assetId: "asset-0001", inMs: 100, outMs: 3000, volume: 0.5 },
      { id: "clip-0002", assetId: "asset-0002", inMs: 0, outMs: 5000, volume: 1 },
      { id: "clip-0003", assetId: "asset-0001", inMs: 200, outMs: 4000, volume: 0.8 },
    ] };
    const reordered = timelineWithMetadata(episode, ["asset-0002", "asset-0001", "asset-0001"], () => "new-clip");
    expect(reordered.timelineClips?.map(clip => clip.id)).toEqual(["clip-0002", "clip-0001", "clip-0003"]);
    expect(reordered.timelineClips?.map(clip => clip.volume)).toEqual([1, 0.5, 0.8]);
  });
  it("moves only shot-anchored audio when visual clips change order", () => {
    const episode = { id: "episode-0001", title: "第一集", shots: [], timeline: ["asset-0001", "asset-0002"],
      timelineClips: [
        { id: "visual-0001", assetId: "asset-0001", inMs: 0, outMs: 5000, volume: 1 },
        { id: "visual-0002", assetId: "asset-0002", inMs: 0, outMs: 5000, volume: 1 }],
      audio: { version: 2 as const, originalVolume: 1,
        voiceClips: [{ id: "voice-clip-0001", assetId: "voice-asset-0001", startMs: 1000,
          inMs: 0, outMs: 1000, volume: 1, anchor: { kind: "visual-clip" as const, clipId: "visual-0001", offsetMs: 1000 } }],
        musicClips: [{ id: "music-clip-0001", assetId: "music-asset-0001", startMs: 0,
          inMs: 0, outMs: 3000, volume: 0.3, anchor: { kind: "absolute" as const } }] } };
    const reordered = timelineWithMetadata(episode, ["asset-0002", "asset-0001"], () => "unused");
    expect(reordered.audio?.voiceClips[0].startMs).toBe(6000);
    expect(reordered.audio?.musicClips[0].startMs).toBe(0);
    expect(reordered.audio?.voiceClips[0].id).toBe("voice-clip-0001");
  });
});
