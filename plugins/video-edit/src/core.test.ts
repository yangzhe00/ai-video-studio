import { describe, expect, it } from "vitest";
import { applyVideoEdit, createRecipe, validateRecipe } from "./core";
import { resolvePlugins } from "@ai-video/plugin-sdk";
import { videoEditPlugin } from "./index";

const base = () => createRecipe({ id: "edit-1", projectId: "project-1", episodeId: "episode-1", shotId: "shot-1", sourceAssetId: "asset-1", sourceDurationMs: 10_000 });

describe("video edit recipe", () => {
  it("keeps the original immutable and flags subtitles trimmed out", () => {
    const original = base();
    const captioned = applyVideoEdit(original, { type: "upsert-caption", caption: { id: "caption-1", startMs: 1000, endMs: 3000, text: "你好" } }, 1).recipe;
    const covered = applyVideoEdit(captioned, { type: "set-cover", sourceMs: 4000 }, 2).recipe;
    const trimmed = applyVideoEdit(covered, { type: "set-trim", startMs: 2000, endMs: 8000 }, 3);
    expect(trimmed.issues).toEqual([{ code: "caption-outside-trim", captionId: "caption-1" }]);
    expect(trimmed.recipe.captions).toHaveLength(1);
    expect(original.trimStartMs).toBe(0);
    expect(() => applyVideoEdit(trimmed.recipe, { type: "set-cover", sourceMs: 9000 }, 4)).toThrow("封面时间");
    expect(() => applyVideoEdit(trimmed.recipe, { type: "set-cover", sourceMs: 4000 }, 3)).toThrow("版本冲突");
    expect(validateRecipe(trimmed.recipe)).toHaveLength(1);
  });

  it("registers on three platforms without a canvas dependency", () => {
    for (const platform of ["desktop", "web", "mobile"] as const) {
      expect(resolvePlugins(platform, ["video-edit"], [videoEditPlugin]).map(plugin => plugin.id)).toEqual(["video-edit"]);
    }
  });

  it("upgrades only the edited recipe to V2 and checks retained-clip audio timing", () => {
    const original = base();
    const voice = { assetId: "voice-asset-001", startMs: 500, inMs: 100, outMs: 2100, volume: 1.2 };
    const result = applyVideoEdit(original, { type: "set-audio-mix", originalVolume: 0.4,
      voiceClips: [voice], musicClips: [] }, 1);
    expect(original.version).toBe(1);
    expect(result.recipe).toMatchObject({ version: 2, revision: 2, audioMix: { originalVolume: 0.4, voiceClips: [voice] } });
    expect(result.issues).toEqual([]);
    expect(() => applyVideoEdit(original, { type: "set-audio-mix", originalVolume: 3,
      voiceClips: [], musicClips: [] }, 1)).toThrow("音量");
    const trimmed = applyVideoEdit(result.recipe, { type: "set-trim", startMs: 0, endMs: 1000 }, 2);
    expect(trimmed.issues).toEqual([{ code: "audio-outside-trim", assetId: voice.assetId }]);
  });
});
