import { describe, expect, it } from "vitest";
import { fromCloudClips, toCloudEpisode } from "./sync-model";
import type { CloudEpisode, StudioEpisode } from "@ai-video/project-core";

describe("cloud timeline conversion", () => {
  it("preserves clip identity, trim and volume on desktop round trip", () => {
    const episode = { id: "episode-0001", title: "第一集", clips: [
      { id: "clip-0001", assetId: "local-asset-1", inMs: 1200, outMs: 8300, volume: 0.4 },
    ] } as StudioEpisode;
    const cloud = toCloudEpisode(episode, { "local-asset-1": "cloud-asset-1" });
    expect(cloud.timeline).toEqual(["cloud-asset-1"]);
    expect(fromCloudClips(cloud, { "cloud-asset-1": "local-asset-1" })).toEqual(episode.clips);
  });

  it("reads an old asset-only timeline", () => {
    const old = { id: "episode-0001", title: "旧项目", shots: [], timeline: ["cloud-asset-1"] } as CloudEpisode;
    expect(fromCloudClips(old, { "cloud-asset-1": "local-asset-1" })).toEqual([
      { id: "cloud-episode-0001-0", assetId: "local-asset-1", inMs: 0, outMs: 5000, volume: 1 },
    ]);
  });

  it("retains the cloud episode voice mix while syncing local timeline edits", () => {
    const audio = { originalVolume: 0.6, voiceClips: [
      { assetId: "cloud-voice-1", startMs: 1000, inMs: 200, outMs: 3200, volume: 0.9 },
    ], musicClips: [] };
    const existing = { id: "episode-0001", title: "第一集", shots: [], timeline: [], audio } as CloudEpisode;
    const episode = { id: "episode-0001", title: "第一集", clips: [
      { id: "clip-0001", assetId: "local-asset-1", inMs: 0, outMs: 5000, volume: 1 },
    ] } as StudioEpisode;
    expect(toCloudEpisode(episode, { "local-asset-1": "cloud-asset-1" }, existing).audio).toEqual(audio);
  });
});
