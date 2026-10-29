import { describe, expect, it } from "vitest";
import { createVideoProject, parseProjectDsl, VideoProjectSchema } from "./index";
import type { VideoProjectV1 } from "./index";

function project(): VideoProjectV1 {
  return {
    schema: "ai-video/project", dslVersion: 1, projectId: "project-1",
    metadata: { title: "测试项目" },
    canvasConfig: { width: 1080, height: 1920 }, renderConfig: { fps: 30, format: "mp4" },
    characters: [{ id: "character-1", name: "小狗", description: "", referenceAssetId: "photo-1" }],
    episodes: [{
      id: "episode-1", title: "第 1 集", publishingCopy: "", cover: null,
      scenes: [{ id: "scene-1", prompt: "走进厨房", sourceAssetId: "photo-1",
        outputAssetIds: ["video-1"], selectedAssetId: "video-1", runIds: ["run-1"] }],
      tracks: [{ id: "track-1", kind: "visual", clips: [{
        kind: "video", id: "clip-1", startMs: 0, assetId: "video-1", inMs: 1000, outMs: 5000, volume: 1.5,
      }] }],
    }],
    assets: { items: [
      { id: "photo-1", kind: "image", name: "照片", mimeType: "image/jpeg", width: 1080, height: 1920 },
      { id: "video-1", kind: "video", name: "视频", mimeType: "video/mp4", durationMs: 5000,
        width: 1080, height: 1920, provenance: { sourceAssetIds: ["photo-1"], runId: "run-1" } },
    ] },
    extensions: { "plugin.example": { opaque: true } },
  };
}

describe("three-layer project DSL", () => {
  it("creates a valid one-episode project with the current render defaults", () => {
    const created = createVideoProject({ projectId: "project-1", title: "新项目", initialEpisodeId: "episode-1" });
    expect(created).toMatchObject({ canvasConfig: { width: 1080, height: 1920 },
      renderConfig: { fps: 30, format: "mp4" }, episodes: [{ id: "episode-1", tracks: [{ kind: "visual", clips: [] }] }] });
    expect(parseProjectDsl(created).ok).toBe(true);
  });

  it("accepts an image-to-video scene and preserves namespaced extensions", () => {
    const parsed = VideoProjectSchema.safeParse(project());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.extensions?.["plugin.example"]).toEqual({ opaque: true });
  });

  it("rejects a missing or wrong-kind reference at the exact field", () => {
    const missing = project();
    missing.episodes[0].scenes[0].sourceAssetId = "missing";
    expect(parseProjectDsl(missing)).toMatchObject({ ok: false, issues: [{
      path: "$.episodes[0].scenes[0].sourceAssetId", code: "missing_asset",
    }] });
    const wrong = project();
    wrong.episodes[0].scenes[0].sourceAssetId = "video-1";
    expect(parseProjectDsl(wrong)).toMatchObject({ ok: false, issues: [{
      path: "$.episodes[0].scenes[0].sourceAssetId", code: "wrong_asset_kind",
    }] });
  });

  it("rejects clips outside asset range and overlapping visual clips", () => {
    const invalid = project();
    const visual = invalid.episodes[0].tracks[0];
    visual.clips.push({ kind: "video", id: "clip-2", startMs: 2000, assetId: "video-1",
      inMs: 0, outMs: 6000, volume: 1 });
    const result = parseProjectDsl(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["outside_asset", "visual_overlap"]));
  });

  it("keeps old clips pinned when a scene selects a new output", () => {
    const changed = project();
    changed.assets.items.push({ id: "video-2", kind: "video", name: "微调版", mimeType: "video/mp4",
      durationMs: 5000, width: 1080, height: 1920, provenance: { sourceAssetIds: ["video-1"], recipeId: "recipe-1" } });
    changed.episodes[0].scenes[0].outputAssetIds.push("video-2");
    changed.episodes[0].scenes[0].selectedAssetId = "video-2";
    const result = parseProjectDsl(changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.episodes[0].tracks[0].clips[0].assetId).toBe("video-1");
  });

  it("allows legacy media with unknown metadata but rejects future versions", () => {
    const pending = project();
    pending.assets.items[1] = { id: "video-1", kind: "video", name: "旧视频",
      mimeType: null, durationMs: null, width: null, height: null };
    expect(parseProjectDsl(pending).ok).toBe(true);
    expect(parseProjectDsl({ ...pending, dslVersion: 2 })).toMatchObject({ ok: false, issues: [{
      path: "$.dslVersion", code: "unsupported_version",
    }] });
  });

  it("rejects cyclic asset provenance and duplicate IDs", () => {
    const invalid = project();
    invalid.assets.items[0].provenance = { sourceAssetIds: ["video-1"] };
    invalid.characters.push({ id: "scene-1", name: "冲突", description: "", referenceAssetId: "photo-1" });
    const result = parseProjectDsl(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["provenance_cycle", "duplicate_id"]));
  });
});
