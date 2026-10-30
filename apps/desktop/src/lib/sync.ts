import { creationBriefs, ensureStudio, readCanvasDocument, resourceRevision } from "@ai-video/project-core";
import type { CanvasEpisodeGraphV1, CloudCharacter, MediaAsset, ProjectManifestV2, StudioEpisode, StudioNode, SyncResourceRevision, SyncResourceType } from "@ai-video/project-core";
import { saveProject } from "./native";
import { cloudCommand, cloudDownloadAsset, cloudRequest, cloudUploadAsset } from "./cloud";
import type { CloudAccount, CloudProject } from "./cloud";
import { fromCloudAudio, fromCloudClips, toCloudEpisode } from "./sync-model";

export interface CloudBinding {
  version: 1; accountId: string; projectId: string; revision: number;
  assetMap: Record<string, string>; fingerprint: string; resourceRevisions?: SyncResourceRevision[];
  resourceFingerprints?: Record<string, string>;
}

export class SyncConflictError extends Error {
  constructor(readonly resourceType: SyncResourceType, readonly resourceId: string,
    readonly localPayload: unknown, readonly cloudPayload: unknown,
    readonly localRevision: number, readonly cloudRevision: number) {
    super(`同步冲突：${resourceType} ${resourceId} 已在另一端修改`);
  }
}

export interface SyncResolution {
  resourceType: SyncResourceType;
  resourceId: string;
  choice: "local" | "cloud";
  cloudRevision: number;
}

function bindingOf(manifest: ProjectManifestV2): CloudBinding | null {
  const value = manifest.extensions?.cloudSync as CloudBinding | undefined;
  return value?.version === 1 ? value : null;
}

function withBinding(manifest: ProjectManifestV2, binding: CloudBinding): ProjectManifestV2 {
  return { ...manifest, extensions: { ...manifest.extensions, cloudSync: binding } };
}

function fingerprint(manifest: ProjectManifestV2): string {
  const data = JSON.stringify({ assets: manifest.assets, studio: manifest.studio, canvas: manifest.extensions?.canvas,
    briefs: creationBriefs(manifest), clips: manifest.clips, captions: manifest.captions, cover: manifest.coverTimeMs });
  return hashText(data);
}

function hashText(data: string): string {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

function resourceKey(type: SyncResourceType, id: string): string { return `${type}:${id}`; }
function resourceHash(value: unknown): string { return hashText(JSON.stringify(value)); }

function localResourceFingerprints(local: ProjectManifestV2, binding: CloudBinding): Record<string, string> {
  const studio = ensureStudio(local).studio!;
  const result: Record<string, string> = {};
  for (const asset of local.assets) if (binding.assetMap[asset.id]) {
    result[resourceKey("asset", asset.id)] = resourceHash({ kind: asset.kind, path: asset.relativePath });
  }
  for (const item of studio.characters) result[resourceKey("character", item.id)] = resourceHash(item);
  for (const item of studio.episodes) {
    result[resourceKey("episode", item.id)] = resourceHash({ title: item.title, clips: item.clips, audio: item.audio });
    const graph = readCanvasDocument(local)?.episodeGraphs[item.id];
    if (graph) result[resourceKey("canvas", item.id)] = resourceHash(graph);
  }
  for (const brief of creationBriefs(local)) result[resourceKey("brief", brief.id)] = resourceHash(brief);
  return result;
}

function localResourceChanged(binding: CloudBinding, type: SyncResourceType, id: string, value: unknown): boolean {
  return binding.resourceFingerprints?.[resourceKey(type, id)] !== resourceHash(value);
}

function mappedGraph(graph: CanvasEpisodeGraphV1, map: Record<string, string>): CanvasEpisodeGraphV1 {
  return { ...graph, nodes: graph.nodes.map(node => ({ ...node,
    ...(node.assetId ? { assetId: map[node.assetId] ?? node.assetId } : {}),
    ...(node.resultAssetId ? { resultAssetId: map[node.resultAssetId] ?? node.resultAssetId } : {}),
  })) };
}

function findRemoteResource(project: CloudProject, type: string, id: string): unknown {
  if (type === "canvas") return (project.document.extensions?.canvas as { episodeGraphs?: Record<string, unknown> } | undefined)?.episodeGraphs?.[id];
  if (type === "brief") return creationBriefs(project.document).find(item => item.id === id);
  const field = type === "episode" ? "episodes" : type === "asset" ? "assets" : "characters";
  return (project.document[field] as { id: string }[]).find(item => item.id === id);
}

async function putIfChanged(root: string, local: ProjectManifestV2, project: CloudProject, binding: CloudBinding,
  baseline: SyncResourceRevision[], type: SyncResourceType, id: string, payload: unknown,
  approvedRevision?: number): Promise<CloudProject> {
  const expected = resourceRevision(baseline, type, id);
  const actual = resourceRevision(project.resourceRevisions ?? [], type, id);
  const remotePayload = findRemoteResource(project, type, id);
  if (JSON.stringify(remotePayload) !== JSON.stringify(payload) && actual !== expected && approvedRevision !== actual) {
    throw new SyncConflictError(type, id, payload, remotePayload, expected, actual);
  }
  let updated = project;
  if (JSON.stringify(remotePayload) !== JSON.stringify(payload)) {
    try { updated = await cloudCommand(project, type, id, payload); }
    catch (error) {
      if (!String(error).includes("冲突")) throw error;
      const latest = await fetchProject(project.id);
      throw new SyncConflictError(type, id, payload, findRemoteResource(latest, type, id), expected,
        resourceRevision(latest.resourceRevisions ?? [], type, id));
    }
  }
  binding.revision = updated.revision;
  binding.resourceRevisions = updated.resourceRevisions;
  await saveProject(root, withBinding(local, binding));
  return updated;
}

async function putLocalResource(root: string, local: ProjectManifestV2, project: CloudProject, binding: CloudBinding,
  baseline: SyncResourceRevision[], type: SyncResourceType, id: string, localId: string,
  localValue: unknown, payload: unknown, resolution?: SyncResolution): Promise<CloudProject> {
  if (!localResourceChanged(binding, type, localId, localValue)) return project;
  const selected = resolution?.resourceType === type && resolution.resourceId === id ? resolution : undefined;
  if (selected?.choice === "cloud") return project;
  const updated = await putIfChanged(root, local, project, binding, baseline, type, id, payload,
    selected?.choice === "local" ? selected.cloudRevision : undefined);
  binding.resourceFingerprints ??= {};
  binding.resourceFingerprints[resourceKey(type, localId)] = resourceHash(localValue);
  await saveProject(root, withBinding(local, binding));
  return updated;
}

async function fetchProject(id: string): Promise<CloudProject> {
  return (await cloudRequest<{ project: CloudProject }>(`/projects/${id}`)).project;
}

async function findOrCreateProject(local: ProjectManifestV2): Promise<CloudProject> {
  const firstEpisode = local.studio!.episodes[0];
  const firstBrief = creationBriefs(local)[0];
  try {
    const existing = await fetchProject(local.id);
    const remoteBrief = firstBrief && creationBriefs(existing.document).find(item => item.id === firstBrief.id);
    if (existing.title !== local.title || !existing.document.episodes.some(item => item.id === firstEpisode.id) ||
        (firstBrief && (!remoteBrief || remoteBrief.source !== firstBrief.source ||
          remoteBrief.originalText !== firstBrief.originalText || remoteBrief.createdAt !== firstBrief.createdAt ||
          remoteBrief.ideaSetId !== firstBrief.ideaSetId || remoteBrief.variantId !== firstBrief.variantId))) {
      throw new Error("云端已有同 ID 项目，请先处理项目关联，避免覆盖云端内容");
    }
    return existing;
  } catch (error) {
    if (!String(error).includes("项目不存在")) throw error;
  }
  return (await cloudRequest<{ project: CloudProject }>("/projects", "POST", { id: local.id, title: local.title,
    initialEpisodeId: firstEpisode.id, ...(firstBrief ? { initialBrief: firstBrief } : {}) })).project;
}

function initialResourceRevisions(local: ProjectManifestV2): SyncResourceRevision[] {
  const firstEpisode = local.studio!.episodes[0];
  const firstBrief = creationBriefs(local)[0];
  return [{ resourceType: "episode", resourceId: firstEpisode.id, revision: 1 },
    ...(firstBrief ? [{ resourceType: "brief" as const, resourceId: firstBrief.id, revision: 1 }] : [])];
}

async function pull(root: string, local: ProjectManifestV2, remote: CloudProject, binding: CloudBinding): Promise<ProjectManifestV2> {
  const cloudToLocal = Object.fromEntries(Object.entries(binding.assetMap).map(([localId, cloudId]) => [cloudId, localId]));
  const assets: MediaAsset[] = [...local.assets];
  for (const object of remote.document.assets) {
    if (cloudToLocal[object.id] && assets.some(asset => asset.id === cloudToLocal[object.id] && !asset.missing)) continue;
    const downloaded = await cloudDownloadAsset(root, object.id, object.kind);
    if (!assets.some(asset => asset.id === object.id)) assets.push(downloaded);
    cloudToLocal[object.id] = object.id;
    binding.assetMap[object.id] = object.id;
  }
  const current = ensureStudio(local).studio!;
  const cloudCanvas = remote.document.extensions?.canvas as { version?: number; episodeGraphs?: Record<string, CanvasEpisodeGraphV1> } | undefined;
  const graphs: Record<string, CanvasEpisodeGraphV1> = {};
  const episodes: StudioEpisode[] = remote.document.episodes.map((item, index) => {
    const previous = current.episodes.find(episode => episode.id === item.id);
    const graph = cloudCanvas?.episodeGraphs?.[item.id];
    const mapped = graph ? mappedGraph(graph, cloudToLocal) : undefined;
    const nodes: StudioNode[] = mapped?.nodes ?? previous?.nodes ?? [{ id: `timeline-${item.id}`, type: "timeline", title: "整集时间线", x: 758, y: 501 }];
    for (const shot of item.shots) {
      const assetId = cloudToLocal[shot.resultAssetId];
      const planned = nodes.find(node => node.shotId === shot.runId);
      if (assetId && planned) planned.resultAssetId = assetId;
      else if (assetId && !nodes.some(node => node.resultAssetId === assetId)) {
        nodes.push({ id: `result-${shot.id}`, type: "video", title: shot.prompt.slice(0, 24) || "生成镜头",
          x: 665 + (index % 3) * 26, y: 140 + (nodes.length % 4) * 40, resultAssetId: assetId, shotId: shot.id });
      }
    }
    graphs[item.id] = { nodes, edges: mapped?.edges ?? previous?.edges ?? [], viewport: mapped?.viewport ?? { x: 0, y: 0, zoom: 1 } };
    const clips = fromCloudClips(item, cloudToLocal);
    return { id: item.id, title: item.title, nodes, edges: graphs[item.id].edges, clips,
      ...(item.audio ? { audio: fromCloudAudio(item, cloudToLocal) } : {}),
      captions: previous?.captions ?? [], publishingCopy: previous?.publishingCopy ?? "", coverTimeMs: previous?.coverTimeMs ?? null };
  });
  const activeEpisodeId = episodes.some(item => item.id === current.activeEpisodeId) ? current.activeEpisodeId : episodes[0].id;
  const active = episodes.find(item => item.id === activeEpisodeId)!;
  const next: ProjectManifestV2 = { ...local, assets, clips: active.clips, captions: active.captions,
    studio: { version: 1, activeEpisodeId, episodes, characters: (remote.document.characters ?? []).map(character => ({ ...character, assetId: cloudToLocal[character.assetId] ?? character.assetId })) },
    extensions: { ...local.extensions, canvas: { version: 1, episodeGraphs: graphs },
      creationBriefs: creationBriefs(remote.document) } };
  binding.revision = remote.revision;
  binding.fingerprint = fingerprint(next);
  binding.resourceFingerprints = localResourceFingerprints(next, binding);
  const bound = withBinding(next, binding);
  await saveProject(root, bound);
  return bound;
}

async function push(root: string, local: ProjectManifestV2, remote: CloudProject, binding: CloudBinding,
  resolution?: SyncResolution): Promise<ProjectManifestV2> {
  let current = remote;
  const baseline = [...(binding.resourceRevisions ?? [])];
  const studio = ensureStudio(local).studio!;
  const usedAssets = new Set<string>([
    ...studio.characters.map(item => item.assetId),
    ...studio.episodes.flatMap(episode => [
      ...episode.clips.map(clip => clip.assetId),
      ...(episode.audio?.voiceClips.map(clip => clip.assetId) ?? []),
      ...(episode.audio?.musicClips.map(clip => clip.assetId) ?? []),
      ...episode.nodes.flatMap(node => [node.assetId, node.resultAssetId].filter((id): id is string => Boolean(id))),
    ]),
  ]);
  for (const asset of local.assets.filter(item => usedAssets.has(item.id) && !item.missing &&
    (item.kind === "image" || item.kind === "video" || item.kind === "voice" || item.kind === "music"))) {
    let cloudId = binding.assetMap[asset.id];
    if (!cloudId) {
      cloudId = (await cloudUploadAsset(root, asset.id)).object.id;
      binding.assetMap[asset.id] = cloudId;
      await saveProject(root, withBinding(local, binding));
    }
    current = await putLocalResource(root, local, current, binding, baseline, "asset", cloudId, asset.id,
      { kind: asset.kind, path: asset.relativePath }, { id: cloudId, kind: asset.kind, name: asset.relativePath.split("/").pop() }, resolution);
  }
  for (const character of studio.characters) {
    const target: CloudCharacter = { ...character, assetId: binding.assetMap[character.assetId] ?? character.assetId };
    current = await putLocalResource(root, local, current, binding, baseline, "character", character.id, character.id, character, target, resolution);
  }
  for (const episode of studio.episodes) {
    const existing = current.document.episodes.find(item => item.id === episode.id);
    current = await putLocalResource(root, local, current, binding, baseline, "episode", episode.id, episode.id,
      { title: episode.title, clips: episode.clips, audio: episode.audio }, toCloudEpisode(episode, binding.assetMap, existing), resolution);
    const graph = readCanvasDocument(local)?.episodeGraphs[episode.id];
    if (graph) current = await putLocalResource(root, local, current, binding, baseline, "canvas", episode.id, episode.id, graph,
      mappedGraph(graph, binding.assetMap), resolution);
  }
  for (const brief of creationBriefs(local)) {
    current = await putLocalResource(root, local, current, binding, baseline, "brief", brief.id, brief.id,
      brief, brief, resolution);
  }
  binding.revision = current.revision;
  binding.fingerprint = fingerprint(local);
  const bound = withBinding(local, binding);
  await saveProject(root, bound);
  return bound;
}

/** Upload only the source photo needed to plan a run; no paid operation is created here. */
export async function ensureCloudReference(root: string, manifest: ProjectManifestV2, account: CloudAccount, sourceAssetId: string): Promise<{ manifest: ProjectManifestV2; cloudAssetId: string; projectId: string }> {
  const local = ensureStudio(manifest);
  const source = local.assets.find(asset => asset.id === sourceAssetId);
  if (!source || source.missing || source.kind !== "image") throw new Error("请选择存在的参考照片");
  let binding = bindingOf(local);
  if (binding && binding.accountId !== account.id) throw new Error("此本地项目已关联其他账号，请切换回原账号");
  let remote: CloudProject;
  if (!binding) {
    remote = await findOrCreateProject(local);
    binding = { version: 1, accountId: account.id, projectId: remote.id, revision: remote.revision,
      assetMap: {}, fingerprint: "", resourceRevisions: initialResourceRevisions(local) };
    await saveProject(root, withBinding(local, binding));
  } else remote = await fetchProject(binding.projectId);

  const briefBaseline = [...(binding.resourceRevisions ?? [])];
  for (const brief of creationBriefs(local)) {
    remote = await putLocalResource(root, local, remote, binding, briefBaseline, "brief", brief.id, brief.id,
      brief, brief);
  }

  let cloudAssetId = binding.assetMap[sourceAssetId];
  if (!cloudAssetId || !remote.document.assets.some(asset => asset.id === cloudAssetId)) {
    cloudAssetId = (await cloudUploadAsset(root, sourceAssetId)).object.id;
    binding.assetMap[sourceAssetId] = cloudAssetId;
    await saveProject(root, withBinding(local, binding));
  }
  if (!remote.document.assets.some(asset => asset.id === cloudAssetId)) {
    remote = await putIfChanged(root, local, remote, binding, remote.resourceRevisions ?? [], "asset", cloudAssetId,
      { id: cloudAssetId, kind: "image", name: source.relativePath.split("/").pop() });
  }
  binding.resourceFingerprints ??= {};
  binding.resourceFingerprints[resourceKey("asset", sourceAssetId)] = resourceHash({ kind: source.kind, path: source.relativePath });
  const episode = local.studio!.episodes.find(item => item.id === local.studio!.activeEpisodeId)!;
  if (!remote.document.episodes.some(item => item.id === episode.id)) {
    remote = await putIfChanged(root, local, remote, binding, remote.resourceRevisions ?? [], "episode", episode.id,
      { id: episode.id, title: episode.title, shots: [], timeline: [], timelineClips: [] });
  }
  binding.revision = remote.revision;
  binding.resourceRevisions = remote.resourceRevisions;
  const bound = withBinding(local, binding);
  await saveProject(root, bound);
  return { manifest: bound, cloudAssetId, projectId: binding.projectId };
}

export async function syncProject(root: string, manifest: ProjectManifestV2, account: CloudAccount,
  resolution?: SyncResolution): Promise<{ manifest: ProjectManifestV2; project: CloudProject; direction: "push" | "pull" | "current" }> {
  const local = ensureStudio(manifest);
  let binding = bindingOf(local);
  if (binding && binding.accountId !== account.id) throw new Error("此本地项目已关联其他账号，请切换回原账号");
  let remote: CloudProject;
  if (!binding) {
    remote = await findOrCreateProject(local);
    binding = { version: 1, accountId: account.id, projectId: remote.id, revision: remote.revision,
      assetMap: {}, fingerprint: "", resourceRevisions: initialResourceRevisions(local) };
    await saveProject(root, withBinding(local, binding));
  } else remote = await fetchProject(binding.projectId);
  if (!binding.resourceFingerprints && binding.fingerprint === fingerprint(local)) {
    binding.resourceFingerprints = localResourceFingerprints(local, binding);
    await saveProject(root, withBinding(local, binding));
  }
  const localChanged = fingerprint(local) !== binding.fingerprint;
  const remoteChanged = remote.revision !== binding.revision;
  if (localChanged) {
    const pushed = await push(root, local, remote, binding, resolution);
    const latest = await fetchProject(binding.projectId);
    const next = await pull(root, pushed, latest, binding);
    return { manifest: next, project: latest, direction: "push" };
  }
  if (remoteChanged) {
    const next = await pull(root, local, remote, binding);
    return { manifest: next, project: remote, direction: "pull" };
  }
  return { manifest: local, project: remote, direction: "current" };
}

export async function attachCloudProject(root: string, manifest: ProjectManifestV2, account: CloudAccount, projectId: string): Promise<ProjectManifestV2> {
  const remote = await fetchProject(projectId);
  const local = ensureStudio(manifest);
  const localHasWork = local.assets.length > 0 || local.shots.length > 0 || local.jobs.length > 0 ||
    creationBriefs(local).length > 0 ||
    local.studio!.characters.length > 0 || local.studio!.episodes.some(episode =>
      episode.clips.length > 0 || episode.nodes.some(node => node.type !== "timeline") || episode.title !== "第 1 集");
  if (localHasWork) throw new Error("本地项目已有内容，不能直接用云端项目覆盖；请先打开本地项目处理同步冲突");
  const binding: CloudBinding = { version: 1, accountId: account.id, projectId, revision: Math.max(0, remote.revision - 1),
    assetMap: {}, fingerprint: fingerprint(local), resourceRevisions: remote.resourceRevisions };
  await saveProject(root, withBinding(local, binding));
  return pull(root, local, remote, binding);
}
