import { describe, expect, it } from "vitest";
import type { ProjectManifestV2 } from "../project";
import { migrateLocalV2ToDsl } from "./migrate-local";

function legacy(): ProjectManifestV2 {
  return {
    version: 2, id: "project-1", title: "旧本地项目",
    assets: [
      { id: "photo-1", kind: "image", relativePath: "media/source/photo.jpg", durationMs: null,
        width: 1080, height: 1920, missing: false },
      { id: "video-1", kind: "video", relativePath: "media/generated/video.mp4", durationMs: 7000,
        width: 1080, height: 1920, missing: false },
      { id: "audio-1", kind: "audio", relativePath: "media/source/audio.mp3", durationMs: null,
        width: null, height: null, missing: true },
    ],
    clips: [
      { id: "clip-1", assetId: "video-1", inMs: 1000, outMs: 5000, volume: 1.5 },
      { id: "clip-2", assetId: "video-1", inMs: 0, outMs: 2000, volume: 1 },
    ],
    captions: [{ id: "caption-1", startMs: 500, endMs: 1500, text: "你好" }],
    publishingCopy: "文案", coverTimeMs: 3000,
    shots: [{ id: "shot-1", sourceAssetId: "photo-1", prompt: "走进厨房", durationSec: 5,
      speaking: false, script: null, acceptedAudioAssetId: null, modelId: "legacy" }],
    jobs: [{ id: "job-1", shotId: "shot-1", provider: "kling", modelId: "legacy", state: "succeeded",
      remoteId: "remote-1", estimatedUsd: 1, actualUsd: 1, outputAssetId: "video-1" }],
    budgetUsd: null,
  };
}

describe("local V2 to project DSL", () => {
  it("keeps clip IDs, trims, volume, captions, cover and local binding", () => {
    const migrated = migrateLocalV2ToDsl(legacy());
    const episode = migrated.project.episodes[0];
    expect(episode.tracks[0].clips).toMatchObject([
      { id: "clip-1", startMs: 0, assetId: "video-1", inMs: 1000, outMs: 5000, volume: 1.5 },
      { id: "clip-2", startMs: 4000, assetId: "video-1", inMs: 0, outMs: 2000, volume: 1 },
    ]);
    expect(episode.cover).toEqual({ assetId: "video-1", sourceTimeMs: 4000 });
    expect(episode.tracks.find(track => track.kind === "subtitle")?.clips[0]).toMatchObject({
      id: "caption-1", startMs: 500, durationMs: 1000,
    });
    expect(migrated.project.assets.items.find(item => item.kind === "subtitle")).toMatchObject({ text: "你好" });
    expect(migrated.bindings[0]).toEqual({ assetId: "photo-1", relativePath: "media/source/photo.jpg", missing: false });
  });

  it("keeps old paid job identity out of runIds and reports missing media", () => {
    const migrated = migrateLocalV2ToDsl(legacy());
    expect(migrated.project.episodes[0].scenes[0]).toMatchObject({
      id: "shot-1", outputAssetIds: ["video-1"], selectedAssetId: "video-1", runIds: [],
    });
    expect(migrated.issues.map(item => item.code)).toEqual(expect.arrayContaining(["missing_local_media", "unknown_media_duration"]));
  });

  it("preserves a cover time that cannot be located", () => {
    const input = { ...legacy(), coverTimeMs: 99999 };
    const migrated = migrateLocalV2ToDsl(input);
    expect(migrated.project.episodes[0].cover).toBeNull();
    expect(migrated.project.extensions?.legacy).toMatchObject({
      localCoverTimeMs: { [migrated.activeEpisodeId]: 99999 },
    });
  });
});
