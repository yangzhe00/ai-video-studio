import { describe, expect, it } from "vitest";
import type { ProjectManifestV2 } from "./project";
import {
  addStudioNode, connectStudioNodes, createCharacter, createEpisode,
  ensureStudio, moveStudioNode, selectEpisode, syncActiveEpisode,
} from "./studio";

const base = (): ProjectManifestV2 => ({
  version: 2, id: "project-1", title: "小狗做饭",
  assets: [{ id: "photo", kind: "image", relativePath: "media/source/dog.jpg", durationMs: null, width: 500, height: 500, missing: false },
    { id: "video", kind: "video", relativePath: "media/generated/shot.mp4", durationMs: 5000, width: 720, height: 1280, missing: false }],
  clips: [{ id: "clip-1", assetId: "video", inMs: 0, outMs: 5000, volume: 1 }],
  captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null,
});

describe("studio project model", () => {
  it("wraps a legacy timeline in one default episode without losing clips", () => {
    const project = ensureStudio(base());
    expect(project.studio?.episodes).toHaveLength(1);
    expect(project.studio?.episodes[0].clips).toEqual(project.clips);
    expect(project.studio?.episodes[0].nodes.some(node => node.type === "timeline")).toBe(true);
  });

  it("rejects a damaged studio document instead of overwriting it", () => {
    const project = ensureStudio(base());
    expect(() => ensureStudio({ ...project, studio: { ...project.studio!, activeEpisodeId: "missing" } })).toThrow(/画布数据格式错误/);
  });

  it("shares characters while keeping each episode timeline independent", () => {
    let project = createCharacter(ensureStudio(base()), "小狗", "戴厨师帽", "photo");
    const firstId = project.studio!.activeEpisodeId;
    project = createEpisode(project, "第 2 集");
    expect(project.studio?.characters[0]).toMatchObject({ name: "小狗", assetId: "photo" });
    expect(project.clips).toEqual([]);
    project = selectEpisode(project, firstId);
    expect(project.clips).toHaveLength(1);
    project = syncActiveEpisode({ ...project, clips: [] });
    expect(project.studio?.episodes.find(episode => episode.id === firstId)?.clips).toEqual([]);
  });

  it("connects valid inputs and rejects a second main image or wrong direction", () => {
    let project = createCharacter(ensureStudio(base()), "小狗", "", "photo");
    const episodeId = project.studio!.activeEpisodeId;
    const characterId = project.studio!.characters[0].id;
    for (const node of [
      { id: "person", type: "character" as const, x: 1, y: 1, title: "小狗", characterId },
      { id: "image", type: "image" as const, x: 2, y: 2, title: "备用图", assetId: "photo" },
      { id: "text", type: "text" as const, x: 3, y: 3, title: "镜头", prompt: "洗菜" },
      { id: "video-node", type: "video" as const, x: 4, y: 4, title: "视频" },
    ]) project = addStudioNode(project, episodeId, node);
    project = connectStudioNodes(project, episodeId, "person", "video-node");
    project = connectStudioNodes(project, episodeId, "text", "video-node");
    expect(() => connectStudioNodes(project, episodeId, "image", "video-node")).toThrow(/主参考图/);
    expect(() => connectStudioNodes(project, episodeId, "video-node", "person")).toThrow(/不能连接/);
    project = connectStudioNodes(project, episodeId, "video-node", `timeline-${episodeId}`);
    expect(project.studio?.episodes[0].edges.some(edge => edge.from === "video-node" && edge.to === `timeline-${episodeId}`)).toBe(true);
  });

  it("persists moved node coordinates", () => {
    let project = ensureStudio(base());
    const episodeId = project.studio!.activeEpisodeId;
    project = addStudioNode(project, episodeId, { id: "text", type: "text", x: 1, y: 2, title: "镜头", prompt: "" });
    project = moveStudioNode(project, episodeId, "text", 160, 220);
    expect(project.studio?.episodes[0].nodes.find(node => node.id === "text")).toMatchObject({ x: 160, y: 220 });
  });
});
