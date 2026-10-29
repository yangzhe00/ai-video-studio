import { describe, expect, it } from "vitest";
import type { CanvasEpisodeGraphV1 } from "@ai-video/project-core";
import { attachCanvasRun, pendingCanvasRuns, prepareCanvasRun } from "./canvas-run";

const input = { episodeId: "episode-0001", sourceAssetId: "photo-0001", input: "小狗在厨房洗菜", durationSec: 5 as const };
const blank = (): CanvasEpisodeGraphV1 => ({ nodes: [{ id: "node-0001", type: "video", title: "镜头", x: 0, y: 0 }],
  edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

describe("canvas run identity", () => {
  it("persists the intent before POST and reuses it after a lost response", () => {
    const first = prepareCanvasRun(blank(), "node-0001", input, () => "request-0001");
    expect(pendingCanvasRuns(first.graph)).toEqual([{ nodeId: "node-0001", clientRequestId: "request-0001", input }]);
    const replay = prepareCanvasRun(first.graph, "node-0001", input, () => "request-0002");
    expect(replay.clientRequestId).toBe("request-0001");
    const linked = attachCanvasRun(replay.graph, "node-0001", replay.clientRequestId, "run-0001");
    expect(linked.nodes[0].shotId).toBe("run-0001");
    expect(pendingCanvasRuns(linked)).toEqual([]);
  });

  it("requires an explicit regenerate choice before replacing a completed node intent", () => {
    const completed = { ...blank(), nodes: [{ ...blank().nodes[0], resultAssetId: "video-0001",
      clientRequestId: "request-0001", runInput: input, shotId: "run-0001" }] };
    expect(() => prepareCanvasRun(completed, "node-0001", input, () => "request-0002")).toThrow("明确选择再次生成");
    const next = prepareCanvasRun(completed, "node-0001", input, () => "request-0002", true);
    expect(next.clientRequestId).toBe("request-0002");
    expect(next.graph.nodes[0].resultAssetId).toBeUndefined();
  });
});
