import type { Caption, ProjectManifestV2, TimelineClip } from "./project";
import { migrateStudioGraph, readCanvasDocument, writeCanvasEpisodeGraph } from "./canvas-extension";

export type StudioNodeType = "character" | "image" | "text" | "video" | "timeline";

export interface StudioCharacter {
  id: string;
  name: string;
  description: string;
  assetId: string;
}

export interface StudioNode {
  id: string;
  type: StudioNodeType;
  x: number;
  y: number;
  title: string;
  characterId?: string;
  assetId?: string;
  prompt?: string;
  durationSec?: number;
  shotId?: string;
  resultAssetId?: string;
  clientRequestId?: string;
  runInput?: { episodeId: string; sourceAssetId: string; input: string; durationSec: 5 | 10 };
}

export interface StudioEdge {
  id: string;
  from: string;
  to: string;
}

export interface StudioEpisode {
  id: string;
  title: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  clips: TimelineClip[];
  captions: Caption[];
  publishingCopy: string;
  coverTimeMs: number | null;
}

export interface StudioDocument {
  version: 1;
  activeEpisodeId: string;
  characters: StudioCharacter[];
  episodes: StudioEpisode[];
}

function newEpisode(id: string, title: string): StudioEpisode {
  return {
    id, title, nodes: [{ id: `timeline-${id}`, type: "timeline", title: "整集时间线", x: 758, y: 501 }],
    edges: [], clips: [], captions: [], publishingCopy: "", coverTimeMs: null,
  };
}

export function ensureStudio(manifest: ProjectManifestV2): ProjectManifestV2 {
  if (manifest.studio?.version === 1) {
    const studio = manifest.studio;
    if (!Array.isArray(studio.characters) || !Array.isArray(studio.episodes) || !studio.episodes.length ||
      !studio.episodes.some(episode => episode.id === studio.activeEpisodeId) ||
      studio.episodes.some(episode => !Array.isArray(episode.nodes) || !Array.isArray(episode.edges) || !Array.isArray(episode.clips) || !Array.isArray(episode.captions))) {
      throw new Error("画布数据格式错误，请检查项目文件");
    }
    const current = migrateStudioGraph(manifest);
    const canvas = readCanvasDocument(current)!;
    return { ...current, studio: { ...studio, episodes: studio.episodes.map(episode => ({
      ...episode,
      nodes: canvas.episodeGraphs[episode.id]?.nodes ?? episode.nodes,
      edges: canvas.episodeGraphs[episode.id]?.edges ?? episode.edges,
    })) } };
  }
  if (manifest.studio && manifest.studio.version !== 1) throw new Error("不支持的画布数据版本");
  const episode = newEpisode(`episode-${manifest.id}`, "第 1 集");
  episode.clips = manifest.clips;
  episode.captions = manifest.captions;
  episode.publishingCopy = manifest.publishingCopy;
  episode.coverTimeMs = manifest.coverTimeMs;
  return migrateStudioGraph({ ...manifest, studio: { version: 1, activeEpisodeId: episode.id, characters: [], episodes: [episode] } });
}

function activeStudio(manifest: ProjectManifestV2): StudioDocument {
  const studio = ensureStudio(manifest).studio;
  if (!studio) throw new Error("画布数据不可用");
  return studio;
}

function updateEpisode(manifest: ProjectManifestV2, episodeId: string, change: (episode: StudioEpisode) => StudioEpisode): ProjectManifestV2 {
  const studio = activeStudio(manifest);
  if (!studio.episodes.some(episode => episode.id === episodeId)) throw new Error("分集不存在");
  const updated = change(studio.episodes.find(episode => episode.id === episodeId)!);
  const next = { ...manifest, studio: { ...studio, episodes: studio.episodes.map(episode => episode.id === episodeId ? updated : episode) } };
  return writeCanvasEpisodeGraph(next, episodeId, updated);
}

export function syncActiveEpisode(manifest: ProjectManifestV2): ProjectManifestV2 {
  const current = ensureStudio(manifest);
  const studio = activeStudio(current);
  return updateEpisode(current, studio.activeEpisodeId, episode => ({
    ...episode, clips: current.clips, captions: current.captions,
    publishingCopy: current.publishingCopy, coverTimeMs: current.coverTimeMs,
  }));
}

export function createEpisode(manifest: ProjectManifestV2, title: string): ProjectManifestV2 {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("请输入分集名称");
  const current = syncActiveEpisode(manifest);
  const studio = activeStudio(current);
  const episode = newEpisode(crypto.randomUUID(), cleanTitle);
  const next: ProjectManifestV2 = {
    ...current, clips: [], captions: [], publishingCopy: "", coverTimeMs: null,
    studio: { ...studio, activeEpisodeId: episode.id, episodes: [...studio.episodes, episode] },
  };
  return writeCanvasEpisodeGraph(next, episode.id, episode);
}

export function selectEpisode(manifest: ProjectManifestV2, episodeId: string): ProjectManifestV2 {
  const current = syncActiveEpisode(manifest);
  const studio = activeStudio(current);
  const episode = studio.episodes.find(item => item.id === episodeId);
  if (!episode) throw new Error("分集不存在");
  return {
    ...current, clips: episode.clips, captions: episode.captions,
    publishingCopy: episode.publishingCopy, coverTimeMs: episode.coverTimeMs,
    studio: { ...studio, activeEpisodeId: episodeId },
  };
}

export function createCharacter(manifest: ProjectManifestV2, name: string, description: string, assetId: string): ProjectManifestV2 {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("请输入人物名称");
  if (!manifest.assets.some(asset => asset.id === assetId && asset.kind === "image" && !asset.missing)) {
    throw new Error("请先选择可用的参考照片");
  }
  const studio = activeStudio(manifest);
  return { ...manifest, studio: { ...studio, characters: [...studio.characters, { id: crypto.randomUUID(), name: cleanName, description: description.trim(), assetId }] } };
}

export function addStudioNode(manifest: ProjectManifestV2, episodeId: string, node: StudioNode): ProjectManifestV2 {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error("节点位置无效");
  const studio = activeStudio(manifest);
  if (node.type === "character" && !studio.characters.some(character => character.id === node.characterId)) throw new Error("人物不存在");
  if (node.type === "image" && !manifest.assets.some(asset => asset.id === node.assetId && asset.kind === "image" && !asset.missing)) throw new Error("参考图片不可用");
  if (node.type === "video" && node.resultAssetId && !manifest.assets.some(asset => asset.id === node.resultAssetId && asset.kind === "video" && !asset.missing)) throw new Error("视频素材不可用");
  return updateEpisode(manifest, episodeId, episode => {
    if (episode.nodes.some(item => item.id === node.id)) throw new Error("节点已存在");
    if (node.type === "timeline" && episode.nodes.some(item => item.type === "timeline")) throw new Error("一集只能有一条时间线");
    return { ...episode, nodes: [...episode.nodes, node] };
  });
}

export function updateStudioNode(manifest: ProjectManifestV2, episodeId: string, nodeId: string, changes: Partial<Omit<StudioNode, "id" | "type">>): ProjectManifestV2 {
  return updateEpisode(manifest, episodeId, episode => {
    if (!episode.nodes.some(node => node.id === nodeId)) throw new Error("节点不存在");
    return { ...episode, nodes: episode.nodes.map(node => node.id === nodeId ? { ...node, ...changes } : node) };
  });
}

export function moveStudioNode(manifest: ProjectManifestV2, episodeId: string, nodeId: string, x: number, y: number): ProjectManifestV2 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("节点位置无效");
  return updateStudioNode(manifest, episodeId, nodeId, { x, y });
}

export function removeStudioNode(manifest: ProjectManifestV2, episodeId: string, nodeId: string): ProjectManifestV2 {
  return updateEpisode(manifest, episodeId, episode => {
    const node = episode.nodes.find(item => item.id === nodeId);
    if (!node) throw new Error("节点不存在");
    if (node.type === "timeline") throw new Error("不能删除整集时间线");
    return { ...episode, nodes: episode.nodes.filter(item => item.id !== nodeId), edges: episode.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId) };
  });
}

export function connectStudioNodes(manifest: ProjectManifestV2, episodeId: string, fromId: string, toId: string): ProjectManifestV2 {
  return updateEpisode(manifest, episodeId, episode => {
    const from = episode.nodes.find(node => node.id === fromId);
    const to = episode.nodes.find(node => node.id === toId);
    if (!from || !to) throw new Error("连接的节点不存在");
    const inputToVideo = ["character", "image", "text"].includes(from.type) && to.type === "video";
    const videoToTimeline = from.type === "video" && to.type === "timeline";
    if (!inputToVideo && !videoToTimeline) throw new Error("这些节点不能连接");
    if (episode.edges.some(edge => edge.from === fromId && edge.to === toId)) return episode;
    if ((from.type === "character" || from.type === "image") && episode.edges.some(edge => edge.to === toId && ["character", "image"].includes(episode.nodes.find(node => node.id === edge.from)?.type ?? ""))) {
      throw new Error("视频节点已有主参考图，请先断开旧连接");
    }
    if (from.type === "text" && episode.edges.some(edge => edge.to === toId && episode.nodes.find(node => node.id === edge.from)?.type === "text")) {
      throw new Error("视频节点已有提示词输入，请先断开旧连接");
    }
    const descendants = new Set<string>();
    const visit = (id: string) => {
      if (id === fromId) throw new Error("连接不能形成循环");
      if (descendants.has(id)) return;
      descendants.add(id);
      episode.edges.filter(edge => edge.from === id).forEach(edge => visit(edge.to));
    };
    visit(toId);
    return { ...episode, edges: [...episode.edges, { id: crypto.randomUUID(), from: fromId, to: toId }] };
  });
}

export function disconnectStudioNodes(manifest: ProjectManifestV2, episodeId: string, edgeId: string): ProjectManifestV2 {
  return updateEpisode(manifest, episodeId, episode => ({ ...episode, edges: episode.edges.filter(edge => edge.id !== edgeId) }));
}
