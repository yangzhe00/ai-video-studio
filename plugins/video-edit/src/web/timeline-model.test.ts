import { describe, expect, it } from "vitest";
import { audioLength, clipStart, makeAudioClip, mergeTimelineDraft, moveAudioClip, orderSavedVisuals, positionedVisuals, reorderVisual, snapTime, timelineDifferences, timelineDuration, timelineFromCloud, timelineToCloud, trimAudioClip, validateTimeline } from "./timeline-model";
import type { TimelineAsset, TimelineAudioClip, TimelineVisualClip } from "./timeline-model";

const visuals: TimelineVisualClip[] = [1, 2, 3].map(index => ({
  id: `shot-${index}`, assetId: `video-${index}`, title: `镜头 ${index}`, inMs: 0, outMs: 5000, volume: 1,
}));
const assets: TimelineAsset[] = [
  { id: "voice-a", kind: "voice", name: "旁白 A", durationMs: 5500, url: "/voice-a" },
  { id: "voice-b", kind: "voice", name: "旁白 B", durationMs: 3000, url: "/voice-b" },
  { id: "music-a", kind: "music", name: "音乐", durationMs: 15000, url: "/music-a" },
];

describe("episode timeline model", () => {
  it("positions 3 visual clips on the same 15 second ruler", () => {
    expect(positionedVisuals(visuals).map(item => item.startMs)).toEqual([0, 5000, 10000]);
    expect(timelineDuration(visuals)).toBe(15000);
  });

  it("keeps a historical absolute clip fixed while a new anchored clip follows its shot", () => {
    const legacy: TimelineAudioClip = { id: "legacy", assetId: "voice-b", kind: "voice",
      startMs: 6000, inMs: 0, outMs: 3000, volume: 1 };
    const anchored = makeAudioClip(assets[0], 6200, visuals, () => "new-id");
    expect(anchored.anchor).toEqual({ kind: "visual-clip", clipId: "shot-2", offsetMs: 1200 });
    const reordered = [visuals[1], visuals[0], visuals[2]];
    expect(clipStart(legacy, reordered)).toBe(6000);
    expect(clipStart(anchored, reordered)).toBe(1200);
  });

  it("moves and trims at 0.1 second precision without mutating source", () => {
    const original = makeAudioClip(assets[0], 2200, visuals, () => "voice-clip");
    const moved = moveAudioClip(original, 4899, visuals);
    const trimmed = trimAudioClip(moved, "left", 400, visuals);
    expect(clipStart(moved, visuals)).toBe(4900);
    expect(trimmed.inMs).toBe(400);
    expect(audioLength(trimmed)).toBe(5100);
    expect(original.inMs).toBe(0);
  });

  it("snaps near cuts and rejects overflow or invalid source ranges", () => {
    expect(snapTime(4890, [0, 5000, 10000])).toBe(5000);
    const clip = makeAudioClip(assets[1], 14000, visuals, () => "audio-clip");
    expect(clip.outMs).toBe(1000);
    expect(validateTimeline({ visuals, audio: [clip], originalVolume: 1 }, assets)).toBeNull();
    expect(validateTimeline({ visuals, audio: [{ ...clip, outMs: 3000 }], originalVolume: 1 }, assets)).toMatch(/超出/);
    expect(validateTimeline({ visuals, audio: [{ ...clip, outMs: 200 }], originalVolume: 1 }, assets)).toMatch(/超出/);
  });

  it("projects all legacy tracks and writes stable v2 ids without dropping the second voice", () => {
    const snapshot = timelineFromCloud(visuals, { originalVolume: 0.7,
      voiceClips: [{ assetId: "voice-a", startMs: 2200, inMs: 0, outMs: 5500, volume: 1 },
        { assetId: "voice-b", startMs: 8100, inMs: 0, outMs: 3000, volume: 0.8 }],
      musicClips: [{ assetId: "music-a", startMs: 0, inMs: 0, outMs: 15000, volume: 0.35 }] });
    expect(snapshot.audio).toHaveLength(3);
    expect(snapshot.audio[0].historical).toBe(true);
    const saved = timelineToCloud(snapshot);
    expect(saved.version).toBe(2);
    expect(saved.voiceClips.map(clip => clip.id)).toEqual(["legacy-voice-0", "legacy-voice-1"]);
    expect(saved.musicClips).toHaveLength(1);
  });

  it("reorders only saved shots and keeps an anchored voice attached to its shot", () => {
    const voice = makeAudioClip(assets[0], 6200, visuals, () => "voice-clip");
    const draft = { visuals, audio: [voice], originalVolume: 1 };
    const reordered = reorderVisual(draft, "shot-2", -1);
    expect(reordered.visuals.map(clip => clip.id)).toEqual(["shot-2", "shot-1", "shot-3"]);
    expect(clipStart(voice, reordered.visuals)).toBe(1200);
    expect(orderSavedVisuals(visuals, reordered.visuals).map(clip => clip.id)).toEqual(["shot-2", "shot-1", "shot-3"]);
    expect(() => orderSavedVisuals(visuals, [{ ...visuals[1], outMs: 4000 }, visuals[0], visuals[2]])).toThrow(/镜头已变化/);
  });

  it("shows concrete cloud differences and merges independent edits", () => {
    const base = { visuals, audio: [makeAudioClip(assets[0], 1000, visuals, () => "voice-clip")], originalVolume: 1 };
    const local = { ...base, audio: [{ ...base.audio[0], startMs: 1200, anchor: { kind: "absolute" as const } }] };
    const cloud = { ...base, originalVolume: 0.8 };
    expect(timelineDifferences(local, cloud, assets)).toContain("镜头原声音量：本地 100%；云端 80%");
    expect(timelineDifferences(local, cloud, assets)).toContain("旁白 A 起点：本地 1.2 秒；云端 1.0 秒");
    expect(timelineDifferences(local, { ...cloud, visuals: [{ ...visuals[0], outMs: 4500 }, ...visuals.slice(1)] }, assets))
      .toContain("镜头 1 画面范围：本地 0.0–5.0 秒；云端 0.0–4.5 秒");
    const merged = mergeTimelineDraft(base, local, cloud);
    expect(merged.conflicts).toEqual([]);
    expect(merged.snapshot.originalVolume).toBe(0.8);
    expect(merged.snapshot.audio[0].startMs).toBe(1200);
    const conflicting = mergeTimelineDraft(base, local, { ...cloud, audio: [{ ...base.audio[0], startMs: 1300 }] });
    expect(conflicting.conflicts).toContain("音频片段 voice-clip 的startMs同时被两端修改");
  });
});
