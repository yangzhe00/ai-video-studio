import { describe, expect, it } from "vitest";
import { canSplit, deleteClip, editImpact, positionedSourceAudio, projectLegacySourceAudio, setSourceAudio, sourceAudioClips, splitClip } from "./clip-edit-model";
import type { ClipEditSnapshot } from "./clip-edit-model";
import { clipStart, timelineDuration } from "./timeline-model";

const base = (): ClipEditSnapshot => ({
  visuals: [1, 2, 3].map(index => ({ id: `shot-${index}`, assetId: `video-${index}`,
    title: `镜头 ${index}`, inMs: 0, outMs: 5000, volume: 1 })),
  audio: [], originalVolume: 1,
  sourceAudio: [1, 2, 3].map(index => ({ id: `original-shot-${index}`, visualClipId: `shot-${index}`,
    assetId: `video-${index}`, inMs: 0, outMs: 5000, volume: 1, muted: false })),
});
const ids = () => { let i = 0; return () => `new-${++i}`; };

describe("episode clip editing", () => {
  it("splits a visual and its linked source at 7.3s without changing the episode length", () => {
    const snapshot = splitClip(base(), { kind: "visual", id: "shot-2" }, 7300, ids());
    expect(snapshot.visuals.map(clip => [clip.id, clip.inMs, clip.outMs])).toEqual([
      ["shot-1", 0, 5000], ["shot-2", 0, 2300], ["new-1", 2300, 5000], ["shot-3", 0, 5000],
    ]);
    expect(positionedSourceAudio(snapshot).map(clip => [clip.startMs, clip.endMs])).toEqual([
      [0, 5000], [5000, 7300], [7300, 10000], [10000, 15000],
    ]);
    expect(timelineDuration(snapshot.visuals)).toBe(15000);
    const after = deleteClip(snapshot, { kind: "visual", id: "new-1" });
    expect(timelineDuration(after.visuals)).toBe(12300);
    expect(sourceAudioClips(after)).toHaveLength(3);
    expect(base().visuals[1].outMs).toBe(5000);
  });

  it("splits and deletes only a source segment, leaving a silent range and 15s of picture", () => {
    const snapshot = splitClip(base(), { kind: "source", id: "original-shot-2" }, 7300, ids());
    const after = deleteClip(snapshot, { kind: "source", id: "new-1" });
    expect(positionedSourceAudio(after).map(clip => [clip.startMs, clip.endMs])).toEqual([
      [0, 5000], [5000, 7300], [10000, 15000],
    ]);
    expect(timelineDuration(after.visuals)).toBe(15000);
  });

  it("splits voice at the playhead with continuous source time and one new reference", () => {
    const snapshot: ClipEditSnapshot = { ...base(), audio: [{ id: "voice", assetId: "recording",
      kind: "voice", startMs: 6000, inMs: 700, outMs: 4700, volume: 0.8,
      anchor: { kind: "visual-clip", clipId: "shot-2", offsetMs: 1000 } }] };
    const after = splitClip(snapshot, { kind: "voice", id: "voice" }, 7500, ids());
    expect(after.audio.map(clip => [clip.inMs, clip.outMs, clipStart(clip, after.visuals)])).toEqual([
      [700, 2200, 6000], [2200, 4700, 7500],
    ]);
    expect(deleteClip(after, { kind: "voice", id: "new-1" }).audio).toHaveLength(1);
    expect(snapshot.audio[0].outMs).toBe(4700);
  });

  it("requires an explicit decision for anchored and overflowing audio on visual deletion", () => {
    const snapshot: ClipEditSnapshot = { ...base(), audio: [
      { id: "voice", assetId: "voice", kind: "voice", startMs: 6000, inMs: 0,
        outMs: 2000, volume: 1, anchor: { kind: "visual-clip", clipId: "shot-2", offsetMs: 1000 } },
      { id: "music", assetId: "music", kind: "music", startMs: 9000, inMs: 0,
        outMs: 6000, volume: 0.5, anchor: { kind: "absolute" } },
    ] };
    const impact = editImpact(snapshot, [snapshot.visuals[0], snapshot.visuals[2]], "shot-2");
    expect(impact.durationAfterMs).toBe(10000);
    expect(impact.removedAnchoredAudio.map(clip => clip.id)).toEqual(["voice"]);
    expect(impact.overflowingAudio.map(item => item.clip.id)).toEqual(["music"]);
    expect(() => deleteClip(snapshot, { kind: "visual", id: "shot-2" })).toThrow(/选择/);
    expect(() => deleteClip(snapshot, { kind: "visual", id: "shot-2" }, { removedAnchor: "remove" })).toThrow(/确认/);
    const after = deleteClip(snapshot, { kind: "visual", id: "shot-2" },
      { removedAnchor: "remove", overflow: "trim" });
    expect(after.audio).toHaveLength(1);
    expect(after.audio[0]).toMatchObject({ id: "music", inMs: 0, outMs: 1000 });
  });

  it("rejects near-end split, last-visual deletion and invalid source edits", () => {
    const snapshot = base();
    expect(canSplit(snapshot, { kind: "visual", id: "shot-2" }, 5200)).toBe(false);
    expect(canSplit(snapshot, { kind: "visual", id: "shot-2" }, 5300)).toBe(true);
    expect(() => deleteClip({ ...snapshot, visuals: snapshot.visuals.slice(0, 1) },
      { kind: "visual", id: "shot-1" })).toThrow(/最后/);
    expect(() => setSourceAudio(snapshot, "original-shot-2", { outMs: 6000 })).toThrow(/无效/);
  });

  it("projects legacy sound only for assets confirmed to have a real audio stream", () => {
    const legacy = { ...base(), sourceAudio: undefined };
    expect(sourceAudioClips(legacy)).toEqual([]);
    expect(projectLegacySourceAudio(legacy, new Set(["video-2"])).map(clip => clip.visualClipId)).toEqual(["shot-2"]);
  });
});
