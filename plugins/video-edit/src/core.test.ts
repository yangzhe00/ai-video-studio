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
});
