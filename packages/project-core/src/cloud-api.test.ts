import { describe, expect, it } from "vitest";
import { parseCloudEnvelope, parseCloudProjectSnapshot, parseCloudRunSnapshot } from "./cloud-api";

const project = () => ({
  id: "project-1", title: "第一集", revision: 2,
  resourceRevisions: [],
  document: { version: 1, assets: [], characters: [], episodes: [
    { id: "episode-1", title: "第一集", shots: [], timeline: ["asset-1"] },
  ] },
});

describe("shared cloud response contracts", () => {
  it("accepts legacy asset-only timelines on all clients", () => {
    expect(parseCloudEnvelope({ project: project() }).project.document.episodes[0].timeline).toEqual(["asset-1"]);
  });

  it("rejects clip metadata whose asset order disagrees with the timeline", () => {
    const value = project();
    const episode = value.document.episodes[0] as typeof value.document.episodes[0] & { timelineClips?: unknown[] };
    episode.timelineClips = [{ id: "clip-1", assetId: "asset-2", inMs: 0, outMs: 5000, volume: 1 }];
    expect(() => parseCloudProjectSnapshot(value)).toThrow("云端时间线片段不一致");
  });

  it("rejects an incomplete run instead of passing it to a client view", () => {
    expect(() => parseCloudRunSnapshot({ runId: "run-1", state: "running" })).toThrow("云端任务响应格式无效");
  });
});
