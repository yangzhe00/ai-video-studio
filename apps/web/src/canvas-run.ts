import type { CanvasEpisodeGraphV1, StudioNode } from "@ai-video/project-core";

export type CanvasRunInput = NonNullable<StudioNode["runInput"]>;

export function prepareCanvasRun(graph: CanvasEpisodeGraphV1, nodeId: string, input: CanvasRunInput,
  newId: () => string, regenerate = false): { graph: CanvasEpisodeGraphV1; clientRequestId: string } {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node || node.type !== "video") throw new Error("视频节点不存在");
  if (node.resultAssetId && !regenerate) throw new Error("该节点已有视频，请明确选择再次生成");
  const reuse = !regenerate && node.clientRequestId && JSON.stringify(node.runInput) === JSON.stringify(input);
  const clientRequestId = reuse ? node.clientRequestId! : newId();
  return { clientRequestId, graph: { ...graph, nodes: graph.nodes.map(item => item.id === nodeId ? {
    ...item, durationSec: input.durationSec, clientRequestId, runInput: input,
    shotId: reuse ? item.shotId : undefined, resultAssetId: reuse ? item.resultAssetId : undefined,
  } : item) } };
}

export function attachCanvasRun(graph: CanvasEpisodeGraphV1, nodeId: string, clientRequestId: string, runId: string): CanvasEpisodeGraphV1 {
  return { ...graph, nodes: graph.nodes.map(node => node.id === nodeId && node.clientRequestId === clientRequestId
    ? { ...node, shotId: runId } : node) };
}

export function pendingCanvasRuns(graph: CanvasEpisodeGraphV1) {
  return graph.nodes.filter(node => node.type === "video" && node.clientRequestId && node.runInput && !node.shotId)
    .map(node => ({ nodeId: node.id, clientRequestId: node.clientRequestId!, input: node.runInput! }));
}
