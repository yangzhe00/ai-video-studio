import type { ProjectManifestV2 } from "./project";
import type { StudioEdge, StudioNode } from "./studio";

export interface CanvasEpisodeGraphV1 {
  nodes: StudioNode[];
  edges: StudioEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export interface CanvasDocumentV1 {
  version: 1;
  episodeGraphs: Record<string, CanvasEpisodeGraphV1>;
}

export function readCanvasDocument(manifest: ProjectManifestV2): CanvasDocumentV1 | null {
  const value = manifest.extensions?.canvas;
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value) || (value as CanvasDocumentV1).version !== 1) {
    throw new Error("不支持的画布扩展版本");
  }
  const document = value as CanvasDocumentV1;
  if (!document.episodeGraphs || typeof document.episodeGraphs !== "object" || Array.isArray(document.episodeGraphs)) {
    throw new Error("画布扩展数据格式错误");
  }
  for (const graph of Object.values(document.episodeGraphs)) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
      !graph.viewport || !Number.isFinite(graph.viewport.x) || !Number.isFinite(graph.viewport.y) ||
      !Number.isFinite(graph.viewport.zoom) || graph.viewport.zoom <= 0) {
      throw new Error("画布扩展数据格式错误");
    }
    const nodeIds = graph.nodes.map(node => node.id);
    if (new Set(nodeIds).size !== nodeIds.length) throw new Error("画布节点 ID 重复");
    const ids = new Set(nodeIds);
    if (graph.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) throw new Error("画布连线引用了不存在的节点");
  }
  return document;
}

export function migrateStudioGraph(manifest: ProjectManifestV2): ProjectManifestV2 {
  if (readCanvasDocument(manifest)) return manifest;
  const episodeGraphs: CanvasDocumentV1["episodeGraphs"] = {};
  for (const episode of manifest.studio?.episodes ?? []) {
    episodeGraphs[episode.id] = {
      nodes: episode.nodes,
      edges: episode.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }
  return {
    ...manifest,
    extensions: { ...manifest.extensions, canvas: { version: 1, episodeGraphs } satisfies CanvasDocumentV1 },
  };
}

export function writeCanvasEpisodeGraph(
  manifest: ProjectManifestV2,
  episodeId: string,
  graph: Pick<CanvasEpisodeGraphV1, "nodes" | "edges">,
): ProjectManifestV2 {
  const current = migrateStudioGraph(manifest);
  const canvas = readCanvasDocument(current)!;
  const next: CanvasDocumentV1 = {
    ...canvas,
    episodeGraphs: {
      ...canvas.episodeGraphs,
      [episodeId]: { ...canvas.episodeGraphs[episodeId], ...graph, viewport: canvas.episodeGraphs[episodeId]?.viewport ?? { x: 0, y: 0, zoom: 1 } },
    },
  };
  const updated = { ...current, extensions: { ...current.extensions, canvas: next } };
  readCanvasDocument(updated);
  return updated;
}
