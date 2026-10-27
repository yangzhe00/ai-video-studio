import { describe, expect, it } from "vitest";
import { appendClip, moveClip, setClipVolume, trimClip, upsertCaption } from "./model";
import type { ProjectManifestV2 } from "../../types/project";

const base = (): ProjectManifestV2 => ({
  version: 2, id: "p", title: "测试", publishingCopy: "", coverTimeMs: null, captions: [], clips: [], shots: [], jobs: [], budgetUsd: null,
  assets: [
    { id: "a", kind: "video", relativePath: "media/source/a.mp4", durationMs: 4000, width: 1080, height: 1920, missing: false },
    { id: "b", kind: "video", relativePath: "media/source/b.mp4", durationMs: 3000, width: 1080, height: 1920, missing: false },
  ],
});

describe("timeline model", () => {
  it("orders clips without changing source assets", () => {
    const first = appendClip(base(), "a");
    const second = appendClip(first, "b");
    const moved = moveClip(second, second.clips[1].id, 0);
    expect(moved.clips.map(clip => clip.assetId)).toEqual(["b", "a"]);
    expect(moved.assets).toEqual(first.assets);
  });
  it("rejects invalid trim and volume", () => {
    const project = appendClip(base(), "a");
    const id = project.clips[0].id;
    expect(() => trimClip(project, id, 0, 5000)).toThrow("裁剪范围超出");
    expect(() => setClipVolume(project, id, 1.2)).toThrow("音量必须");
  });
  it("keeps Chinese caption as data", () => {
    const project = appendClip(base(), "a");
    const updated = upsertCaption(project, { id: "c", startMs: 0, endMs: 2000, text: "妈妈要下班了，我在家做饭给她吃" });
    expect(updated.captions[0].text).toContain("妈妈要下班了");
  });
});
