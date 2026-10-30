import { describe, expect, it } from "vitest";
import type { CloudProjectDocument } from "../sync";
import { migrateCloudV1ToDsl } from "./migrate-cloud";

function legacy(): CloudProjectDocument {
  return {
    version: 1,
    assets: [{ id: "photo-1", kind: "image", name: "照片" }, { id: "video-1", kind: "video" }],
    characters: [{ id: "character-1", name: "小狗", description: "", assetId: "photo-1" }],
    episodes: [{
      id: "episode-1", title: "第 1 集",
      shots: [{ id: "shot-1", runId: "run-1", sourceAssetId: "photo-1", resultAssetId: "video-2",
        originalAssetId: "video-1", selectedAssetId: "video-2", prompt: "小狗做饭", durationSec: 5 }],
      timeline: ["video-1", "video-1"],
      timelineClips: [
        { id: "clip-1", assetId: "video-1", inMs: 1000, outMs: 5000, volume: 1.5 },
        { id: "clip-2", assetId: "video-1", inMs: 0, outMs: 2000, volume: 1 },
      ],
    }],
    extensions: { canvas: { version: 1, episodeGraphs: {} }, "plugin.example": { opaque: true } },
  };
}

describe("cloud V1 to project DSL", () => {
  it("keeps two clip occurrences and historical edited assets", () => {
    const result = migrateCloudV1ToDsl(legacy(), { projectId: "project-1", title: "云项目",
      versionsByShotId: { "shot-1": [{ outputAssetId: "video-2", coverAssetId: "cover-1",
        recipeId: "edit-1", createdAt: 10 }] } });
    expect(result.episodes[0].tracks[0].clips).toMatchObject([
      { id: "clip-1", startMs: 0, inMs: 1000, outMs: 5000, volume: 1.5 },
      { id: "clip-2", startMs: 4000, inMs: 0, outMs: 2000, volume: 1 },
    ]);
    expect(result.episodes[0].scenes[0]).toMatchObject({
      outputAssetIds: ["video-1", "video-2"], selectedAssetId: "video-2", runIds: ["run-1"],
    });
    expect(result.assets.items.find(item => item.id === "cover-1")?.kind).toBe("thumbnail");
    expect(result.assets.items.find(item => item.id === "video-2")?.provenance).toMatchObject({
      sourceAssetIds: ["video-1"], recipeId: "edit-1",
    });
    expect(result.extensions?.["plugin.example"]).toEqual({ opaque: true });
    expect(result.extensions?.creationBriefs).toEqual([]);
  });

  it("rejects disagreeing timeline representations", () => {
    const input = legacy();
    input.episodes[0].timelineClips![0].assetId = "video-2";
    expect(() => migrateCloudV1ToDsl(input, { projectId: "project-1", title: "云项目" })).toThrow(/不一致/);
  });

  it("accepts old asset-only timeline with deterministic clip IDs", () => {
    const input = legacy();
    delete input.episodes[0].timelineClips;
    const first = migrateCloudV1ToDsl(input, { projectId: "project-1", title: "云项目" });
    const second = migrateCloudV1ToDsl(input, { projectId: "project-1", title: "云项目" });
    expect(first.episodes[0].tracks[0].clips.map(item => item.id)).toEqual(second.episodes[0].tracks[0].clips.map(item => item.id));
  });

  it("projects cloud briefs as non-executable material without altering clips", () => {
    const input = legacy();
    const brief = { id: "brief-cloud-0001", source: "manual" as const, originalText: "完整剧本", finalText: "完整剧本",
      createdAt: 1, updatedAt: 1 };
    input.briefs = [brief];
    const result = migrateCloudV1ToDsl(input, { projectId: "project-1", title: "云项目" });
    expect(result.extensions?.creationBriefs).toEqual([brief]);
    expect(result.episodes[0].scenes).toHaveLength(1);
    expect(result.episodes[0].tracks[0].clips).toHaveLength(2);
  });

  it("projects uploaded voice and music as positioned DSL tracks", () => {
    const input = legacy();
    input.assets.push({ id: "voice-001", kind: "voice", name: "录音", mimeType: "audio/mpeg", durationMs: 6000 });
    input.assets.push({ id: "music-001", kind: "music", name: "配乐", mimeType: "audio/mp4", durationMs: 6000 });
    input.episodes[0].audio = { originalVolume: 0.4,
      voiceClips: [{ assetId: "voice-001", startMs: 500, inMs: 100, outMs: 5100, volume: 1.2 }],
      musicClips: [{ assetId: "music-001", startMs: 0, inMs: 0, outMs: 6000, volume: 0.2 }] };
    const result = migrateCloudV1ToDsl(input, { projectId: "project-1", title: "云项目" });
    expect(result.episodes[0].tracks.find(track => track.kind === "voice")?.clips[0])
      .toMatchObject({ kind: "voice", startMs: 500, inMs: 100, outMs: 5100, volume: 1.2 });
    expect(result.episodes[0].tracks.find(track => track.kind === "music")?.clips[0])
      .toMatchObject({ kind: "music", assetId: "music-001" });
    expect(result.assets.items.find(asset => asset.id === "voice-001"))
      .toMatchObject({ kind: "voice", durationMs: 6000 });
  });
});
