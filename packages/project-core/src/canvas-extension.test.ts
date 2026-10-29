import { describe, expect, it } from "vitest";
import type { ProjectManifestV2 } from "./project";
import { addStudioNode, ensureStudio, moveStudioNode } from "./studio";
import { migrateStudioGraph, readCanvasDocument } from "./canvas-extension";

const legacy = (): ProjectManifestV2 => ({
  version: 2, id: "project-1", title: "旧项目", assets: [],
  clips: [{ id: "clip-1", assetId: "asset-1", inMs: 0, outMs: 1000, volume: 1 }],
  captions: [], publishingCopy: "", coverTimeMs: null, shots: [], jobs: [], budgetUsd: null,
});

describe("canvas extension migration", () => {
  it("keeps a project without studio content readable", () => {
    const project = ensureStudio(legacy());
    expect(project.studio?.episodes[0].clips).toEqual(project.clips);
    expect(readCanvasDocument(project)?.episodeGraphs[project.studio!.activeEpisodeId].nodes[0].type).toBe("timeline");
  });

  it("preserves graph identifiers and coordinates as nodes change", () => {
    let project = ensureStudio(legacy());
    const episodeId = project.studio!.activeEpisodeId;
    project = addStudioNode(project, episodeId, { id: "prompt-1", type: "text", x: 10, y: 12, title: "镜头" });
    project = moveStudioNode(project, episodeId, "prompt-1", 230, 450);
    const reloaded = ensureStudio(JSON.parse(JSON.stringify(project)) as ProjectManifestV2);
    expect(readCanvasDocument(reloaded)?.episodeGraphs[episodeId].nodes.find(node => node.id === "prompt-1")).toMatchObject({ x: 230, y: 450 });
    expect(reloaded.studio?.episodes[0].nodes.find(node => node.id === "prompt-1")).toMatchObject({ x: 230, y: 450 });
  });

  it("rejects duplicate node IDs and unknown extension versions", () => {
    const project = ensureStudio(legacy());
    const episodeId = project.studio!.activeEpisodeId;
    const graph = readCanvasDocument(project)!.episodeGraphs[episodeId];
    expect(() => readCanvasDocument({ ...project, extensions: { canvas: { version: 1, episodeGraphs: { [episodeId]: { ...graph, nodes: [...graph.nodes, graph.nodes[0]] } } } } })).toThrow(/ID 重复/);
    expect(() => migrateStudioGraph({ ...project, extensions: { canvas: { version: 2 } } })).toThrow(/版本/);
  });
});
