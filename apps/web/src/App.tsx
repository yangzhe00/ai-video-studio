import { useEffect, useMemo, useRef, useState } from "react";
import { Button, GeneratePage, PromptIdeas, StudioIcon, TaskStatus, ThemeToggle, pendingPromptRequestId } from "@ai-video/ui-web";
import type { PromptIdeaSet } from "@ai-video/ui-web";
import { ProjectHome, ResultsPage, StudioShell } from "@ai-video/components";
import type { StudioResult, StudioSection } from "@ai-video/components";
import { canvasPlugin } from "@ai-video/plugin-canvas";
import { CanvasPage } from "@ai-video/plugin-canvas/canvas";
import { videoEditPlugin } from "@ai-video/plugin-video-edit";
import { VideoEditor } from "@ai-video/plugin-video-edit/web";
import type { RenderView, VideoEditView } from "@ai-video/plugin-video-edit/web";
import type { VideoEditCommand } from "@ai-video/plugin-video-edit/core";
import { cloudTimelineClips, resourceRevision, timelineWithMetadata } from "@ai-video/project-core";
import type { CanvasDocumentV1, CanvasEpisodeGraphV1, CloudTimelineClip, SyncResourceType } from "@ai-video/project-core";
import type { GenerationJob, ProjectManifestV2, StudioEpisode } from "@ai-video/project-core";
import { resolvePlugins } from "@ai-video/plugin-sdk";
import { api, uploadObject } from "./api";
import type { Account, AgentRunSnapshot, CloudDocument, CloudProject } from "./api";
import { attachCanvasRun, pendingCanvasRuns, prepareCanvasRun } from "./canvas-run";

const webPlugins = resolvePlugins("web", ["canvas", "video-edit"], [canvasPlugin, videoEditPlugin]);
const hasCanvas = webPlugins.some(plugin => plugin.contributes.routes?.includes("canvas"));
const hasVideoEdit = webPlugins.some(plugin => plugin.contributes.routes?.includes("video-edit"));
const lastProjectKey = "avs-web-last-project";
interface ProjectCreateAttempt { id: string; title: string }
function createAttemptKey(accountId: string) { return `avs-web-create-project:${accountId}`; }
function readCreateAttempt(accountId: string): ProjectCreateAttempt | null {
  try {
    const value = window.sessionStorage.getItem(createAttemptKey(accountId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ProjectCreateAttempt>;
    return typeof parsed.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(parsed.id)
      && typeof parsed.title === "string" && Boolean(parsed.title.trim()) ? parsed as ProjectCreateAttempt : null;
  } catch { return null; }
}
type WebView = "home" | "projects" | "idea-choose" | "idea-prepare" | "generate" | "canvas" | "results" | "assets" | "edit";
interface ProjectSummary { id: string; title: string; revision: number; updatedAt?: number; recentEpisode?: { id: string; title: string; shotCount: number } | null }

export function webManifest(project: CloudProject, episodeId: string, run: AgentRunSnapshot | null): ProjectManifestV2 {
  const episode = project.document.episodes.find(item => item.id === episodeId) ?? project.document.episodes[0];
  const cloudCanvas = project.document.extensions?.canvas as CanvasDocumentV1 | undefined;
  const assets: ProjectManifestV2["assets"] = project.document.assets.map(asset => ({
    id: asset.id, kind: asset.kind, relativePath: asset.name ?? asset.id,
    durationMs: null, width: null, height: null, missing: false,
  }));
  const shots: ProjectManifestV2["shots"] = episode?.shots.map(shot => ({
    id: shot.id, sourceAssetId: shot.sourceAssetId, prompt: shot.prompt, durationSec: shot.durationSec,
    speaking: false, script: null, acceptedAudioAssetId: null, modelId: "kling-2.5-turbo",
  })) ?? [];
  const jobs: GenerationJob[] = (episode?.shots ?? []).map(shot => ({
    id: shot.runId, shotId: shot.id, provider: "kling", modelId: "kling-2.5-turbo", state: "succeeded",
    remoteId: null, estimatedUsd: 0, actualUsd: null, outputAssetId: shot.resultAssetId,
  }));
  if (run?.episodeId === episodeId && run.state !== "waiting_approval" && !jobs.some(job => job.id === run.runId)) {
    const state: GenerationJob["state"] = run.state === "failed" ? "failed" : run.state === "running" ? "running"
      : run.state === "provider_queued" || run.state === "pending_submit" ? "queued" : "unknown";
    jobs.push({ id: run.runId, shotId: run.runId, provider: "kling", modelId: "kling-2.5-turbo", state,
      remoteId: run.operation?.id ?? null, estimatedUsd: 0, actualUsd: null, outputAssetId: null });
    shots.push({ id: run.runId, sourceAssetId: run.sourceAssetId, prompt: run.input, durationSec: run.durationSec,
      speaking: false, script: null, acceptedAudioAssetId: null, modelId: "kling-2.5-turbo" });
  }
  const episodes: StudioEpisode[] = project.document.episodes.map(item => {
    const graph = cloudCanvas?.version === 1 ? cloudCanvas.episodeGraphs[item.id] : undefined;
    const nodes = [...(graph?.nodes ?? [{ id: `timeline-${item.id}`, type: "timeline" as const,
      title: "整集时间线", x: 758, y: 501 }])].map(node => {
      const shot = item.shots.find(shot => shot.runId === node.shotId || shot.id === node.shotId);
      return shot ? { ...node, shotId: shot.id, resultAssetId: shot.resultAssetId } : node;
    });
    for (const shot of item.shots) if (!nodes.some(node => node.shotId === shot.id || node.resultAssetId === shot.resultAssetId)) {
      nodes.push({ id: `result-${shot.id}`, type: "video", title: shot.prompt || "生成镜头", x: 520,
        y: 155 + nodes.length * 45, shotId: shot.id, resultAssetId: shot.resultAssetId,
        prompt: shot.prompt, durationSec: shot.durationSec });
    }
    const clips = cloudTimelineClips(item);
    return { id: item.id, title: item.title, nodes, edges: graph?.edges ?? [], clips,
      captions: [], publishingCopy: "", coverTimeMs: null };
  });
  const active = episodes.find(item => item.id === episodeId) ?? episodes[0];
  return { version: 2, id: project.id, title: project.title, assets, clips: active?.clips ?? [], captions: [], publishingCopy: "",
    coverTimeMs: null, shots, jobs, budgetUsd: null,
    studio: { version: 1, activeEpisodeId: episodeId, episodes, characters: project.document.characters ?? [] } };
}

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<CloudProject | null>(null);
  const projectRef = useRef<CloudProject | null>(null);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [episodeId, setEpisodeId] = useState("");
  const [view, setView] = useState<WebView>("generate");
  const [edit, setEdit] = useState<VideoEditView | null>(null);
  const [render, setRender] = useState<RenderView | null>(null);
  const renderRequestId = useRef<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [title, setTitle] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createAttempt, setCreateAttempt] = useState<ProjectCreateAttempt | null>(null);
  const [createError, setCreateError] = useState("");
  const creatingProject = useRef(false);
  const [createOrigin, setCreateOrigin] = useState<"home" | "projects" | "idea">("projects");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectListBusy, setProjectListBusy] = useState(false);
  const [projectListError, setProjectListError] = useState("");
  const [ideaSet, setIdeaSet] = useState<PromptIdeaSet | null>(null);
  const [recentIdeas, setRecentIdeas] = useState<PromptIdeaSet[]>([]);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaError, setIdeaError] = useState("");
  const [selectedIdea, setSelectedIdea] = useState<PromptIdeaSet | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [input, setInput] = useState("");
  const [durationSec, setDurationSec] = useState<5 | 10>(5);
  const [run, setRun] = useState<AgentRunSnapshot | null>(null);
  const [eventMessage, setEventMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const requestFingerprint = useRef<string | null>(null);
  const approvalId = useRef<string | null>(null);
  const submitting = useRef(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const uploadResolver = useRef<((id: string | null) => void) | null>(null);
  const canvasDraft = useRef<CanvasEpisodeGraphV1 | null>(null);
  const [showAssets, setShowAssets] = useState(false);
  const activeEpisode = project?.document.episodes.find(item => item.id === episodeId);
  const canvasDocument = project?.document.extensions?.canvas as CanvasDocumentV1 | undefined;
  const canvasGraph: CanvasEpisodeGraphV1 = useMemo(() => canvasDocument?.version === 1 && canvasDocument.episodeGraphs[episodeId]
    ? canvasDocument.episodeGraphs[episodeId]
    : { nodes: [{ id: `timeline-${episodeId}`, type: "timeline", title: "整集时间线", x: 758, y: 501 }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, [canvasDocument, episodeId]);
  useEffect(() => { canvasDraft.current = null; }, [project?.id, episodeId]);

  useEffect(() => {
    void api<{ account: Account }>("/auth/me").then(result => setAccount(result.account)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!account) return;
    void loadProjects();
    void loadIdeas();
    setView("home");
  }, [account?.id]);

  useEffect(() => { if (account && view === "projects") void loadProjects(); }, [account?.id, view === "projects"]);
  useEffect(() => {
    if (ideaSet?.state !== "pending") return;
    const id = ideaSet.id;
    const timer = window.setInterval(() => { void reloadIdea(id); }, 3000);
    return () => window.clearInterval(timer);
  }, [ideaSet?.id, ideaSet?.state]);

  async function loadProjects() {
    setProjectListBusy(true); setProjectListError("");
    try { setProjects((await api<{ projects: ProjectSummary[] }>("/projects")).projects); }
    catch (cause) { setProjectListError(String(cause)); }
    finally { setProjectListBusy(false); }
  }

  async function loadIdeas() {
    try {
      const rows = (await api<{ ideaSets: PromptIdeaSet[] }>("/prompt-ideas")).ideaSets;
      setRecentIdeas(rows);
      const pendingId = pendingPromptRequestId(`web:${account?.id ?? "anonymous"}`);
      setIdeaSet(current => current ?? rows.find(item => item.clientRequestId === pendingId) ?? rows[0] ?? null);
    } catch (cause) { setIdeaError(String(cause)); }
  }

  async function requestIdeas(inputText: string, clientRequestId: string) {
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await api<{ ideaSet: PromptIdeaSet }>("/prompt-ideas", "POST", { clientRequestId, input: inputText })).ideaSet;
      setIdeaSet(next);
      setRecentIdeas(current => [next, ...current.filter(item => item.id !== next.id)]);
    } catch (cause) { setIdeaError(String(cause)); }
    finally { setIdeaBusy(false); }
  }

  async function reloadIdea(id: string) {
    setIdeaBusy(true); setIdeaError("");
    try { setIdeaSet((await api<{ ideaSet: PromptIdeaSet }>(`/prompt-ideas/${id}`)).ideaSet); }
    catch (cause) { setIdeaError(String(cause)); }
    finally { setIdeaBusy(false); }
  }

  async function selectIdea(id: string, variantId: string, editedPrompt: string) {
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await api<{ ideaSet: PromptIdeaSet }>(`/prompt-ideas/${id}/selection`, "POST", { variantId, editedPrompt })).ideaSet;
      setIdeaSet(next); setRecentIdeas(current => [next, ...current.filter(item => item.id !== next.id)]);
      return next;
    } catch (cause) { setIdeaError(String(cause)); throw cause; }
    finally { setIdeaBusy(false); }
  }

  async function openProject(id: string, destination: "generate" | "idea-prepare" = "generate"): Promise<boolean> {
    try {
      setError("");
      const fresh = (await api<{ project: CloudProject }>(`/projects/${id}`)).project;
      projectRef.current = fresh;
      setProject(fresh);
      setView(destination);
      window.localStorage.setItem(lastProjectKey, id);
      const lastEpisode = window.localStorage.getItem(`${lastProjectKey}:${id}:episode`);
      setEpisodeId(fresh.document.episodes.some(item => item.id === lastEpisode) ? lastEpisode! : fresh.document.episodes[0]?.id ?? "");
      let current = fresh;
      const canvas = fresh.document.extensions?.canvas as CanvasDocumentV1 | undefined;
      if (destination !== "idea-prepare" && canvas?.version === 1) for (const [targetEpisodeId, graph] of Object.entries(canvas.episodeGraphs)) {
        for (const pending of pendingCanvasRuns(graph)) {
          try {
            const planned = (await api<{ run: AgentRunSnapshot }>(`/projects/${id}/runs`, "POST", {
              clientRequestId: pending.clientRequestId, ...pending.input,
            })).run;
            const latestCanvas = current.document.extensions?.canvas as CanvasDocumentV1;
            const latestGraph = latestCanvas.episodeGraphs[targetEpisodeId];
            current = await sendCommand(current, "canvas", targetEpisodeId,
              attachCanvasRun(latestGraph, pending.nodeId, pending.clientRequestId, planned.runId));
          } catch (cause) { setError(`恢复画布任务失败：${String(cause)}`); }
        }
      }
      const recent = (await api<{ runs: AgentRunSnapshot[] }>(`/projects/${id}/runs`)).runs;
      setRun(recent[0] ?? null);
      setSourceAssetId(fresh.document.assets.find(asset => asset.kind === "image")?.id ?? "");
      requestId.current = null; requestFingerprint.current = null; approvalId.current = null;
      return true;
    } catch (cause) { setError(String(cause)); return false; }
  }

  async function authenticate() {
    try {
      setBusy(true); setError("");
      const result = await api<{ account: Account }>(`/auth/${authMode}`, "POST", { email, password });
      setAccount(result.account);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api("/auth/logout", "POST");
    window.localStorage.removeItem(lastProjectKey);
    projectRef.current = null; setAccount(null); setProject(null); setRun(null); setProjects([]);
    setIdeaSet(null); setRecentIdeas([]); setSelectedIdea(null);
  }

  function selectWebEpisode(id: string) {
    if (project) window.localStorage.setItem(`${lastProjectKey}:${project.id}:episode`, id);
    setEpisodeId(id);
  }

  async function createProject() {
    if (!title.trim() || creatingProject.current) return;
    const cleanTitle = title.trim();
    if (createAttempt && createAttempt.title !== cleanTitle) {
      setCreateError("上次项目请求尚未确认。请恢复原名称查询，或明确另起新项目。");
      return;
    }
    const attempt = createAttempt ?? { id: crypto.randomUUID(), title: cleanTitle };
    try { window.sessionStorage.setItem(createAttemptKey(account!.id), JSON.stringify(attempt)); }
    catch { setCreateError("浏览器无法保存项目请求编号，请启用会话存储后重试"); return; }
    setCreateAttempt(attempt);
    creatingProject.current = true;
    try {
      setBusy(true); setCreateError(""); setError("");
      let created: CloudProject;
      try { created = (await api<{ project: CloudProject }>("/projects", "POST", { id: attempt.id, title: cleanTitle })).project; }
      catch (postError) {
        let recovered: CloudProject | null = null;
        try { recovered = (await api<{ project: CloudProject }>(`/projects/${attempt.id}`)).project; } catch { /* retry keeps the same ID */ }
        if (recovered && recovered.title !== cleanTitle) throw new Error("项目编号已对应其他名称，请明确另起新项目");
        if (!recovered) throw postError;
        created = recovered;
      }
      await loadProjects();
      if (!await openProject(created.id, createOrigin === "idea" ? "idea-prepare" : "generate")) {
        setCreateError("项目已创建，但打开失败。请查询原项目后继续。");
        return;
      }
      try { window.sessionStorage.removeItem(createAttemptKey(account!.id)); } catch { /* project has already opened */ }
      setCreateAttempt(null); setTitle(""); setShowCreateProject(false);
    } catch (cause) { setCreateError(String(cause)); }
    finally { creatingProject.current = false; setBusy(false); }
  }

  function enqueue<T>(operation: (current: CloudProject) => Promise<T>): Promise<T> {
    const pending = mutationQueue.current.then(async () => {
      const current = projectRef.current;
      if (!current) throw new Error("请先选择项目");
      return operation(current);
    });
    mutationQueue.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function sendCommand(current: CloudProject, resourceType: SyncResourceType, resourceId: string, payload: unknown) {
    try {
      const updated = (await api<{ project: CloudProject }>(`/projects/${current.id}/commands`, "POST", {
        id: crypto.randomUUID(), resourceType, resourceId,
        baseRevision: resourceRevision(current.resourceRevisions ?? [], resourceType, resourceId), payload,
      })).project;
      projectRef.current = updated; setProject(updated);
      return updated;
    } catch (cause) {
      if (String(cause).includes("冲突")) {
        const fresh = (await api<{ project: CloudProject }>(`/projects/${current.id}`)).project;
        projectRef.current = fresh; setProject(fresh);
        throw new Error("项目已在另一端更新，请检查最新内容后重试");
      }
      throw cause;
    }
  }

  async function upload(file: File | undefined): Promise<string | null> {
    if (!file || !project) return null;
    try {
      setBusy(true); setError("");
      const object = await uploadObject(file);
      await enqueue(current => sendCommand(current, "asset", object.id, { id: object.id, kind: "image", name: file.name }));
      setSourceAssetId(object.id);
      return object.id;
    } catch (cause) { setError(`上传照片失败：${cause instanceof Error ? cause.message : String(cause)}`); return null; }
    finally { setBusy(false); }
  }

  async function createEpisode() {
    if (!project) return;
    const title = window.prompt("新分集名称", `第 ${project.document.episodes.length + 1} 集`)?.trim();
    if (!title) return;
    const id = crypto.randomUUID();
    try {
      const updated = await enqueue(current => sendCommand(current, "episode", id, { id, title, shots: [], timeline: [] }));
      setEpisodeId(updated.document.episodes.find(item => item.id === id)?.id ?? episodeId);
    } catch (cause) { setError(String(cause)); }
  }

  async function saveCanvas(graph: CanvasEpisodeGraphV1, characters?: NonNullable<CloudDocument["characters"]>, timelineClips?: CloudTimelineClip[]) {
    if (!project) throw new Error("请先选择项目");
    await enqueue(async initial => {
      let current = initial;
      for (const character of characters ?? []) {
        const saved = current.document.characters?.find(item => item.id === character.id);
        if (JSON.stringify(saved) !== JSON.stringify(character)) current = await sendCommand(current, "character", character.id, character);
      }
      const episode = current.document.episodes.find(item => item.id === episodeId);
      if (episode && timelineClips && JSON.stringify(cloudTimelineClips(episode)) !== JSON.stringify(timelineClips)) {
        current = await sendCommand(current, "episode", episodeId,
          { ...episode, timeline: timelineClips.map(clip => clip.assetId), timelineClips });
      }
      await sendCommand(current, "canvas", episodeId, graph);
    });
  }

  function pickPhoto(): Promise<string | null> {
    return new Promise(resolve => {
      const input = filePicker.current;
      if (!input) { resolve(null); return; }
      const cancel = () => { uploadResolver.current = null; resolve(null); };
      input.addEventListener("cancel", cancel, { once: true });
      uploadResolver.current = id => { input.removeEventListener("cancel", cancel); resolve(id); };
      input.click();
    });
  }

  function currentGraph(): CanvasEpisodeGraphV1 {
    if (canvasDraft.current) return canvasDraft.current;
    const scene = project ? webManifest(project, episodeId, run).studio?.episodes.find(item => item.id === episodeId) : undefined;
    return { ...canvasGraph, nodes: scene?.nodes ?? canvasGraph.nodes, edges: scene?.edges ?? canvasGraph.edges };
  }

  function changeCanvas(change: (graph: CanvasEpisodeGraphV1) => CanvasEpisodeGraphV1) {
    const next = change(currentGraph());
    canvasDraft.current = next;
    void saveCanvas(next).catch(cause => setError(String(cause)));
  }

  function addCanvasNode(type: "text" | "image" | "video" | "timeline" | "character", assetId?: string, characterId?: string) {
    changeCanvas(graph => ({ ...graph, nodes: [...graph.nodes, { id: crypto.randomUUID(), type,
      title: type === "video" ? "视频镜头" : type === "text" ? "镜头描述" : type === "image" ? "参考照片" : type === "character" ? "主体" : "整集时间线",
      x: 120 + graph.nodes.length * 80, y: 150 + graph.nodes.length * 35,
      ...(assetId ? { assetId } : {}), ...(characterId ? { characterId } : {}), ...(type === "video" ? { durationSec: 5 } : {}) }] }));
  }

  function createCanvasCharacter(name: string, description: string, assetId: string) {
    if (!project) return;
    const character = { id: crypto.randomUUID(), name, description, assetId };
    const graph = currentGraph();
    const next = { ...graph, nodes: [...graph.nodes, { id: crypto.randomUUID(), type: "character" as const,
      title: name, x: 120 + graph.nodes.length * 80, y: 150 + graph.nodes.length * 35, characterId: character.id }] };
    canvasDraft.current = next;
    void saveCanvas(next, [...(project.document.characters ?? []), character]).catch(cause => setError(String(cause)));
  }

  function runCanvasNodeById(nodeId: string) {
    const graph = currentGraph();
    const node = graph.nodes.find(item => item.id === nodeId);
    const parents = graph.edges.filter(edge => edge.to === nodeId).map(edge => graph.nodes.find(item => item.id === edge.from));
    const image = parents.find(item => item?.type === "image" || item?.type === "character");
    const text = parents.find(item => item?.type === "text");
    const character = project?.document.characters?.find(item => item.id === image?.characterId);
    const photo = image?.assetId ?? character?.assetId ?? node?.assetId;
    const prompt = text?.prompt || node?.prompt;
    if (!photo || !prompt?.trim()) { setError("请先连接参考照片和镜头描述"); return; }
    void runCanvasNode(nodeId, photo, prompt, node?.durationSec === 10 ? 10 : 5).catch(cause => setError(String(cause)));
  }

  function addCanvasTimeline(assetId: string) {
    const episode = projectRef.current?.document.episodes.find(item => item.id === episodeId);
    if (!episode || (episode.timeline ?? []).includes(assetId)) return;
    const updated = timelineWithMetadata(episode, [...(episode.timeline ?? []), assetId], () => crypto.randomUUID());
    void saveCanvas(currentGraph(), undefined, updated.timelineClips).catch(cause => setError(String(cause)));
  }

  function connectCanvasNodes(from: string, to: string) {
    const graph = currentGraph();
    const source = graph.nodes.find(node => node.id === from), target = graph.nodes.find(node => node.id === to);
    const inputToVideo = source && target?.type === "video" && ["character", "image", "text"].includes(source.type);
    const resultToTimeline = source?.type === "video" && target?.type === "timeline";
    if (!source || !target || (!inputToVideo && !resultToTimeline)) { setError("只允许主体、图片或文本连接视频，视频连接时间线"); return; }
    if (graph.edges.some(edge => edge.from === from && edge.to === to)) return;
    if (inputToVideo && source.type !== "text" && graph.edges.some(edge => edge.to === to && ["character", "image"].includes(graph.nodes.find(node => node.id === edge.from)?.type ?? ""))) {
      setError("该视频已有参考主体或照片"); return;
    }
    if (source.type === "text" && graph.edges.some(edge => edge.to === to && graph.nodes.find(node => node.id === edge.from)?.type === "text")) {
      setError("该视频已有文本输入"); return;
    }
    changeCanvas(current => ({ ...current, edges: [...current.edges, { id: crypto.randomUUID(), from, to }] }));
  }

  function reorderCanvasClip(clipId: string, targetIndex: number) {
    const episode = projectRef.current?.document.episodes.find(item => item.id === episodeId);
    if (!episode?.timeline) return;
    const next = [...cloudTimelineClips(episode)];
    const sourceIndex = next.findIndex(clip => clip.id === clipId);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= next.length || targetIndex < 0 || targetIndex >= next.length) return;
    next.splice(targetIndex, 0, ...next.splice(sourceIndex, 1));
    void saveCanvas(currentGraph(), undefined, next).catch(cause => setError(String(cause)));
  }

  async function runCanvasNode(nodeId: string, photo: string, prompt: string, length: 5 | 10) {
    if (!project || submitting.current) return;
    submitting.current = true;
    try {
      setBusy(true); setError("");
      const graph = currentGraph();
      const existing = graph.nodes.find(node => node.id === nodeId);
      const regenerate = Boolean(existing?.resultAssetId);
      if (regenerate && !window.confirm("该节点已有视频，确定再次生成新版本？")) return;
      const prepared = prepareCanvasRun(graph, nodeId, { episodeId, sourceAssetId: photo, input: prompt, durationSec: length },
        () => crypto.randomUUID(), regenerate);
      canvasDraft.current = prepared.graph;
      await saveCanvas(prepared.graph);
      requestId.current = prepared.clientRequestId;
      const planned = (await api<{ run: AgentRunSnapshot }>(`/projects/${project.id}/runs`, "POST", {
        clientRequestId: prepared.clientRequestId, episodeId, sourceAssetId: photo, input: prompt, durationSec: length,
      })).run;
      const linked = attachCanvasRun(currentGraph(), nodeId, prepared.clientRequestId, planned.runId);
      canvasDraft.current = linked;
      await saveCanvas(linked);
      setRun(planned); setSourceAssetId(photo); setInput(prompt); setDurationSec(length); setView("generate"); approvalId.current = null;
    } finally { submitting.current = false; setBusy(false); }
  }

  async function openEdit(shotId: string) {
    if (!project) return;
    try {
      setBusy(true); setError("");
      const opened = (await api<{ edit: VideoEditView }>("/video-edits", "POST", { projectId: project.id, episodeId, shotId })).edit;
      setEdit(opened); setRender(null); renderRequestId.current = null; setView("edit");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function editCommand(command: VideoEditCommand, expectedRevision: number): Promise<VideoEditView> {
    if (!edit) throw new Error("请先打开视频");
    const changed = (await api<{ edit: VideoEditView }>(`/video-edits/${edit.id}/commands`, "POST", { commandId: crypto.randomUUID(), expectedRevision, command })).edit;
    setEdit(changed); setRender(null); renderRequestId.current = null;
    return changed;
  }

  async function renderEdit(revision: number) {
    if (!edit) return;
    renderRequestId.current ??= crypto.randomUUID();
    const created = (await api<{ render: RenderView }>(`/video-edits/${edit.id}/render`, "POST", { renderOperationId: renderRequestId.current, expectedRevision: revision })).render;
    setRender(created);
  }

  useEffect(() => {
    if (!render || ["succeeded", "failed"].includes(render.state)) return;
    let live = true;
    const poll = async () => {
      try {
        const next = (await api<{ render: RenderView }>(`/renders/${render.id}`)).render;
        if (!live) return;
        setRender(next);
        if (next.state === "succeeded" && edit && project) {
          const [freshEdit, freshProject] = await Promise.all([
            api<{ edit: VideoEditView }>(`/video-edits/${edit.id}`), api<{ project: CloudProject }>(`/projects/${project.id}`),
          ]);
          if (live) { setEdit(freshEdit.edit); projectRef.current = freshProject.project; setProject(freshProject.project); }
        }
      } catch (cause) { if (live) setError(String(cause)); }
    };
    const timer = window.setInterval(() => { void poll(); }, 3000);
    void poll();
    return () => { live = false; window.clearInterval(timer); };
  }, [render?.id, render?.state, edit?.id, project?.id]);

  async function useEditInTimeline(assetId: string) {
    if (!edit) throw new Error("编辑记录不存在");
    await enqueue(async current => {
      const episode = current.document.episodes.find(item => item.id === edit.recipe.episodeId);
      if (!episode) throw new Error("分集不存在");
      await sendCommand(current, "episode", episode.id,
        timelineWithMetadata(episode, [...(episode.timeline ?? []), assetId], () => crypto.randomUUID()));
    });
    setError("");
  }

  async function plan(photoId = sourceAssetId, prompt = input, length = durationSec) {
    if (!project || !episodeId || !photoId || !prompt.trim() || submitting.current) return;
    submitting.current = true;
    try {
      setBusy(true); setError("");
      setSourceAssetId(photoId); setInput(prompt); setDurationSec(length);
      const fingerprint = JSON.stringify({ episodeId, photoId, prompt: prompt.trim(), length });
      if (requestFingerprint.current !== fingerprint) { requestId.current = crypto.randomUUID(); requestFingerprint.current = fingerprint; }
      const planned = (await api<{ run: AgentRunSnapshot }>(`/projects/${project.id}/runs`, "POST", {
        clientRequestId: requestId.current, episodeId, sourceAssetId: photoId, input: prompt, durationSec: length,
      })).run;
      setRun(planned); approvalId.current = null;
    } catch (cause) { setError(String(cause)); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function approve() {
    if (!run || busy) return;
    try {
      setBusy(true); setError("");
      approvalId.current ??= crypto.randomUUID();
      const approved = (await api<{ run: AgentRunSnapshot }>(`/runs/${run.runId}/approve`, "POST", { approvalId: approvalId.current, planHash: run.planHash })).run;
      setRun(approved); setEventMessage("已确认，云端正在处理");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!run || run.state === "waiting_approval" || ["saved", "failed"].includes(run.state)) return;
    const id = run.runId;
    let live = true;
    const refresh = async () => {
      try {
        const next = (await api<{ run: AgentRunSnapshot }>(`/runs/${id}`)).run;
        if (!live) return;
        setRun(next);
        if (next.state === "saved" && project) {
          const fresh = (await api<{ project: CloudProject }>(`/projects/${project.id}`)).project;
          if (live) { projectRef.current = fresh; setProject(fresh); }
        }
      } catch (cause) { if (live) setError(String(cause)); }
    };
    const source = new EventSource(`/api/runs/${id}/events`, { withCredentials: true });
    source.addEventListener("state", event => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { message: string };
        if (live) { setEventMessage(data.message); void refresh(); }
      } catch { /* wait for snapshot poll */ }
    });
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    void refresh();
    return () => { live = false; source.close(); window.clearInterval(timer); };
  }, [run?.runId, run?.state === "waiting_approval" || run?.state === "saved" || run?.state === "failed", project?.id]);


  const manifest = project ? webManifest(project, episodeId, run) : null;
  const previewUrls = Object.fromEntries(project?.document.assets.map(asset => [asset.id, `/api/objects/${asset.id}`]) ?? []);
  const results: StudioResult[] = manifest ? [...manifest.jobs].filter(job => job.provider === "kling").reverse().map(job => {
    const shot = manifest.shots.find(item => item.id === job.shotId);
    return { id: job.id, title: shot?.prompt?.slice(0, 25) || "生成镜头", description: shot?.prompt,
      durationSec: shot?.durationSec ?? 5, taskId: job.id,
      videoUrl: job.outputAssetId ? previewUrls[job.outputAssetId] : undefined,
      status: job.state === "succeeded" ? "succeeded" : job.state === "failed" ? "failed" : job.state === "unknown" ? "unknown" : "loading" };
  }) : [];
  const navigate = (section: StudioSection) => {
    setView(section);
  };
  const openCreate = (origin: "home" | "projects" | "idea") => {
    const pending = account ? readCreateAttempt(account.id) : null;
    setCreateOrigin(origin); setCreateAttempt(pending); setCreateError(""); setTitle(pending?.title ?? ""); setShowCreateProject(true);
  };
  const filteredProjects = projects.filter(item => item.title.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase()));
  const ideaWidget = <PromptIdeas requestScope={`web:${account?.id ?? "anonymous"}`} ideaSet={ideaSet} recentSets={recentIdeas} busy={ideaBusy} error={ideaError}
    onRequest={requestIdeas} onReload={reloadIdea} onSelect={selectIdea}
    onContinue={saved => {
      setSelectedIdea(saved);
      setInput(saved.editedPrompt ?? saved.variants.find(item => item.id === saved.selectedVariantId)?.prompt ?? "");
      setView("idea-choose");
    }} onManual={draft => { setInput(draft); setView(project ? "generate" : "projects"); }} />;
  const projectCards = (destination: "generate" | "idea-prepare", rows = filteredProjects) => rows.map(item => <button type="button"
    className="web-project-card" key={item.id} onClick={() => void openProject(item.id, destination)}>
    <strong>{item.title}</strong><small>{item.recentEpisode?.title ?? "尚无分集"} · {item.recentEpisode?.shotCount ?? 0} 个镜头</small>
    <span>{item.updatedAt ? `更新于 ${new Date(item.updatedAt).toLocaleString("zh-CN")}` : "云端项目"}</span>
  </button>);
  const runPanel = run && project ? <section className="web-run web-card">
    <h2>Agent 执行状态</h2>
    <TaskStatus state={run.state} message={eventMessage} />
    <p>任务 ID：<code>{run.runId}</code></p>
    {run.state === "waiting_approval" && <div className="web-plan">
      <strong>确认镜头计划</strong><p>{run.plan.steps[0].prompt}</p>
      <p>{run.plan.steps[0].durationSec} 秒 · 将加入 {project.document.episodes.find(item => item.id === run.episodeId)?.title} · 消耗 1 次演示额度</p>
      <small>当前使用输入校验计划，尚未启用模型规划。</small>
      <Button onClick={() => void approve()} disabled={busy}>确认并调用后台生成</Button>
    </div>}
    {run.state === "unknown" && <p>提交结果待确认，系统只查询原可灵任务。</p>}
  </section> : null;
  const projectLibrary = <main className="web-project-library" aria-label="全部项目">
    <header><div><span>PROJECT LIBRARY</span><h1>我的项目</h1><p>从项目库打开作品；分集在进入项目后管理。</p></div>
      <Button onClick={() => openCreate("projects")}>＋ 新建项目</Button></header>
    <div className="web-project-library-tools"><input type="search" aria-label="搜索项目" placeholder="搜索项目名称"
      value={projectSearch} onChange={event => setProjectSearch(event.target.value)} />
      <Button variant="secondary" onClick={() => void loadProjects()} disabled={projectListBusy}>刷新列表</Button></div>
    {projectListError && <p role="alert">项目列表加载失败：{projectListError} <button type="button" onClick={() => void loadProjects()}>重试</button></p>}
    {projectListBusy && <p role="status">正在加载项目…</p>}
    <div className="web-project-library-grid">{projectCards("generate")}</div>
    {!projectListBusy && !projectListError && filteredProjects.length === 0 && <div className="web-project-library-empty">
      <h2>{projectSearch ? "没有找到项目" : "还没有项目"}</h2><p>{projectSearch ? "换个关键词试试。" : "可以先从一句想法获取灵感，或现在创建云端项目。"}</p>
      {!projectSearch && <Button onClick={() => openCreate("projects")}>新建项目</Button>}</div>}
  </main>;
  const ideaChoosePage = <main className="web-idea-flow" aria-label="为灵感选择项目">
    <span>灵感草案 / 下一步</span><h1>把这条灵感放在哪个项目？</h1>
    <p>选择已有项目或明确新建项目。此时仍不会提交视频任务。</p>
    <blockquote>{selectedIdea?.editedPrompt}</blockquote>
    <div className="web-project-library-grid">{projectCards("idea-prepare", projects)}
      <button type="button" className="web-project-card create" onClick={() => openCreate("idea")}>＋ 新建项目<small>创建后继续选择分集与照片</small></button></div>
    <Button variant="secondary" onClick={() => setView("home")}>返回修改灵感</Button>
  </main>;
  const ideaPreparePage = <main className="web-idea-flow" aria-label="准备生成镜头">
    <span>{project?.title ?? "项目"} / 准备镜头</span><h1>确认照片、分集和提示词</h1>
    <p>准备好后进入原有镜头计划；调用视频服务仍需在下一步明确确认。</p>
    <div className="web-idea-prep-form">
      <label>目标分集<select aria-label="目标分集" value={episodeId} onChange={event => selectWebEpisode(event.target.value)}>
        {project?.document.episodes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <Button variant="secondary" onClick={() => void createEpisode()}>＋ 新建分集</Button>
      <label>参考照片<select aria-label="参考照片" value={sourceAssetId} onChange={event => setSourceAssetId(event.target.value)}>
        <option value="">请选择照片</option>{project?.document.assets.filter(item => item.kind === "image").map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
      <Button variant="secondary" onClick={() => void pickPhoto()} disabled={busy}>上传照片</Button>
      <label className="wide">最终镜头提示词<textarea aria-label="最终镜头提示词" maxLength={2000} value={input} onChange={event => setInput(event.target.value)} /></label>
      <label>镜头时长<select aria-label="镜头时长" value={durationSec} onChange={event => setDurationSec(Number(event.target.value) === 10 ? 10 : 5)}>
        <option value={5}>5 秒</option><option value={10}>10 秒</option></select></label>
      <div className="wide web-idea-prep-actions"><Button onClick={() => {
        if (!project || !episodeId || !sourceAssetId || !input.trim()) { setError("请先选择项目、分集、照片并填写镜头提示词"); return; }
        setError(""); setView("generate"); void plan(sourceAssetId, input, durationSec);
      }}>检查镜头计划</Button><Button variant="secondary" onClick={() => setView("idea-choose")}>返回选项目</Button></div>
    </div>
  </main>;
  const sectionLabels: Record<"generate" | "canvas" | "results" | "assets", string> = {
    generate: "创作", canvas: "画布", results: "结果", assets: "资产",
  };
  const projectRequiredPage = (section: keyof typeof sectionLabels) => <main className="web-section-empty" aria-label={`${sectionLabels[section]}空状态`}>
    <span>{sectionLabels[section].toUpperCase()} / 选择项目</span><h1>{sectionLabels[section]}需要先打开项目</h1>
    <p>打开已有项目，或新建一个项目，再继续使用{sectionLabels[section]}。</p>
    <div><Button onClick={() => setView("projects")}>选择已有项目</Button>
      <Button variant="secondary" onClick={() => openCreate("projects")}>新建项目</Button></div>
  </main>;
  const assetsPage = <main className="web-assets-page" aria-label="项目资产">
    <header><div><span>PROJECT ASSETS</span><h1>项目资产</h1><p>{project?.title} · {project?.document.assets.length ?? 0} 个素材</p></div>
      <Button onClick={() => void pickPhoto()} disabled={busy}>上传参考照片</Button></header>
    {project?.document.assets.length ? <div className="web-assets-page-grid">{project.document.assets.map(asset => <article key={asset.id}>
      {asset.kind === "image" ? <img src={`/api/objects/${asset.id}`} alt={asset.name ?? "参考图片"} />
        : <video src={`/api/objects/${asset.id}`} controls />}
      <strong>{asset.name ?? asset.id}</strong><small>{asset.kind === "image" ? "参考照片" : "视频素材"}</small>
    </article>)}</div> : <div className="web-section-empty inline"><h2>这里还没有素材</h2><p>上传参考照片后，就能在创作页使用。</p></div>}
  </main>;
  const recentImageId = project?.document.assets.find(asset => asset.kind === "image")?.id;
  const homePage = <ProjectHome projectTitle={project?.title ?? projects[0]?.title}
    episodeTitle={activeEpisode?.title ?? projects[0]?.recentEpisode?.title}
    recentImage={recentImageId ? previewUrls[recentImageId] : undefined}
    recentMeta={activeEpisode ? `${activeEpisode.shots.length} 个片段 · 继续创作` : undefined}
    onCreate={() => openCreate("home")}
    onContinue={project ? () => setView("generate") : projects[0] ? () => void openProject(projects[0].id) : undefined}
    onCanvas={project && hasCanvas ? () => setView("canvas") : undefined}
    onProjects={() => setView("projects")} ideaSlot={ideaWidget} />;

  return <div className="web-app">
    {!account ? <div className="web-auth-page">
      <header className="web-auth-header"><strong><span>✦</span> AI VIDEO STUDIO</strong><span>从灵感到成片</span><div>还没有账号？ <button type="button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>{authMode === "login" ? "创建账号" : "返回登录"}</button></div></header>
      <main className="web-auth">
        <section className="web-auth-story"><span>✦ YOUR STORY STARTS HERE</span><h1>把想象<br />变成正在发生的画面。</h1>
          <p>从一张照片和一句描述开始。让 AI Agent 为你生成镜头，再把每个片段编排成一集属于你的故事。</p>
          <div className="web-auth-proof">●&nbsp; 云端任务可追踪 · 创作随时继续</div>
          <div className="web-auth-film" aria-hidden="true"><i /><i /><i /></div>
          <small>MOTION / 胶片缓慢滑动 · 暖光掠过 · 细颗粒轻闪</small>
        </section>
        <section className="web-auth-form"><div className="web-card"><span>WELCOME BACK</span><h1>{authMode === "login" ? "欢迎回来" : "创建账号"}</h1><p>{authMode === "login" ? "登录后继续你的创作旅程。" : "创建账号后开始制作你的第一集。"}</p><div className="web-tabs">
          <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>登录</button>
          <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>注册</button>
        </div><label>邮箱<input aria-label="邮箱" type="email" placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>密码<input aria-label="密码" type="password" placeholder="输入密码" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <Button onClick={() => void authenticate()} disabled={busy}>{authMode === "login" ? "登录并开始创作" : "创建账号并开始创作"}</Button>
        </div></section>
      </main><footer className="web-auth-footer">© 2026 AI Video Studio</footer>
    </div> : <div className="film-app web-studio">
      <StudioShell active={view === "projects" || view === "idea-choose" || view === "idea-prepare" ? null : view === "edit" ? "results" : view} onNavigate={navigate}
        projectTitle={project ? `${activeEpisode?.title ?? "第 1 集"} · ${project.title}` : undefined}
        footer={<div className="web-account-controls"><span title={account.email}>{account.email}</span><div><ThemeToggle />
          <button type="button" aria-label="退出登录" onClick={() => void logout()}><StudioIcon name="arrowRight" size={16} /><span>退出登录</span></button></div></div>}>
      {view === "projects" ? projectLibrary : view === "idea-choose" ? ideaChoosePage : view === "idea-prepare" ? ideaPreparePage
        : view === "home" ? homePage : !project || !manifest ? projectRequiredPage(view === "edit" ? "results" : view)
        : view === "assets" ? assetsPage : view === "generate" ? <GeneratePage key={project.id} manifest={manifest} previewUrls={previewUrls}
        busy={busy} saveState={busy ? "saving" : "saved"} statusSlot={runPanel} showSidebar={false}
        initialSourceAssetId={sourceAssetId} initialPrompt={input} initialDuration={durationSec}
        onImportPhoto={pickPhoto}
        onGenerate={(photo, prompt, length) => plan(photo, prompt, length === 10 ? 10 : 5)}
        onRefresh={async id => { setRun((await api<{ run: AgentRunSnapshot }>(`/runs/${id}`)).run); }}
        onAddToCanvas={() => setView("canvas")} onEditVideo={hasVideoEdit ? job => void openEdit(job.shotId) : undefined}
        onOpenCanvas={() => setView("canvas")} onOpenEditor={() => setShowAssets(true)}
        onOpenProjects={() => setView("projects")} />
      : view === "results" ? <ResultsPage results={results} episodeTitle={activeEpisode?.title} storageLabel="已保存云端"
        onGenerate={() => setView("generate")}
        onEdit={hasVideoEdit ? result => void openEdit(manifest.jobs.find(job => job.id === result.id)?.shotId ?? result.id) : undefined}
        onAddToTimeline={result => { const assetId = manifest.jobs.find(job => job.id === result.id)?.outputAssetId; if (assetId) { addCanvasTimeline(assetId); setView("canvas"); } }}
        onRefresh={result => { void api<{ run: AgentRunSnapshot }>(`/runs/${result.id}`).then(value => setRun(value.run)).catch(cause => setError(String(cause))); }} />
      : view === "edit" && edit ? <div className="web-edit-shell"><VideoEditor edit={edit}
        sourceUrl={`/api/objects/${edit.sourceAssetId}`}
        currentUrl={edit.currentOutputId ? `/api/objects/${edit.currentOutputId}` : undefined}
        render={render} onCommand={editCommand} onRender={renderEdit} onUseInTimeline={useEditInTimeline}
        onClose={() => setView("generate")} /></div>
      : <CanvasPage manifest={manifest} episode={manifest.studio!.episodes.find(item => item.id === episodeId)!}
        previewUrls={previewUrls} busy={busy} saveState={busy ? "saving" : "saved"}
        shareMessage="复制页面地址；对方登录后可从自己的项目列表打开有权限的项目。"
        onOpenGenerate={() => setView("generate")} onOpenEditor={() => setShowAssets(true)}
        onOpenProjects={() => setView("projects")} onSelectEpisode={selectWebEpisode}
        onCreateEpisode={() => void createEpisode()} onImportPhoto={pickPhoto}
        onCreateCharacter={createCanvasCharacter}
        onAddCharacterNode={id => { const character = project.document.characters?.find(item => item.id === id); if (character) addCanvasNode("character", undefined, id); }}
        onAddNode={addCanvasNode}
        onAddDownstreamVideo={id => changeCanvas(graph => {
          const nodeId = crypto.randomUUID();
          return { ...graph, nodes: [...graph.nodes, { id: nodeId, type: "video", title: "视频镜头",
            x: 540, y: 160 + graph.nodes.length * 30, durationSec: 5 }],
            edges: [...graph.edges, { id: crypto.randomUUID(), from: id, to: nodeId }] };
        })}
        onUpdateNode={(id, changes) => changeCanvas(graph => ({ ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, ...changes } : node) }))}
        onMoveNode={(id, x, y) => changeCanvas(graph => ({ ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, x, y } : node) }))}
        onRemoveNode={id => changeCanvas(graph => ({ ...graph, nodes: graph.nodes.filter(node => node.id !== id), edges: graph.edges.filter(edge => edge.from !== id && edge.to !== id) }))}
        onConnect={connectCanvasNodes}
        onDisconnect={id => changeCanvas(graph => ({ ...graph, edges: graph.edges.filter(edge => edge.id !== id) }))}
        onRunVideo={runCanvasNodeById}
        onRefreshJob={async id => { setRun((await api<{ run: AgentRunSnapshot }>(`/runs/${id}`)).run); }}
        onAddVideoToTimeline={(_nodeId, assetId) => addCanvasTimeline(assetId)}
        onReorderClip={reorderCanvasClip} />}
      </StudioShell>
      {showCreateProject && <div className="web-create-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreateProject(false); }}>
        <section className="web-create-dialog" role="dialog" aria-modal="true" aria-label="新建项目">
          <h2>新建项目</h2><p>给项目起个名字。创建后进入工作台，不会自动生成视频。</p>
          <label>项目名称<input autoFocus aria-label="项目名称" maxLength={50} value={title} onChange={event => setTitle(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && title.trim() && !busy) void createProject(); }} placeholder="例如：小狗的晚餐" /></label>
          {createAttempt && <p className="web-create-recovery">上次创建结果待确认：{createAttempt.title}。查询原项目会复用同一个编号。</p>}
          {createError && <p role="alert" className="web-create-error">{createError}</p>}
          <div><Button variant="secondary" onClick={() => setShowCreateProject(false)} disabled={busy}>取消</Button>
            {createAttempt && <Button variant="secondary" onClick={() => {
              try { window.sessionStorage.removeItem(createAttemptKey(account!.id)); }
              catch { setCreateError("浏览器无法清除旧请求编号，请启用会话存储后重试"); return; }
              setCreateAttempt(null); setTitle(""); setCreateError("");
            }} disabled={busy}>另起新项目</Button>}
            <Button onClick={() => void createProject()} disabled={busy || !title.trim()}>{busy ? "查询中…" : createAttempt ? "查询原项目" : "创建并继续"}</Button></div>
        </section></div>}
      <input ref={filePicker} type="file" accept="image/jpeg,image/png" hidden aria-label="上传参考照片文件"
        onChange={event => { const file = event.target.files?.[0]; void upload(file).then(id => {
          uploadResolver.current?.(id); uploadResolver.current = null; event.target.value = "";
        }); }} />
      {showAssets && project && <div className="web-overlay" onMouseDown={event => {
        if (event.target === event.currentTarget) setShowAssets(false);
      }}><section className="web-assets-panel" role="dialog" aria-label="项目素材">
        <header><h2>项目素材</h2><button type="button" onClick={() => setShowAssets(false)}>关闭</button></header>
        <div>{project.document.assets.map(asset => <article key={asset.id}>
          {asset.kind === "image" ? <img src={`/api/objects/${asset.id}`} alt={asset.name ?? "参考图片"} />
            : <video src={`/api/objects/${asset.id}`} controls />}
          <small>{asset.name ?? asset.id}</small>
        </article>)}</div>
      </section></div>}
    </div>}
    {error && <div className="web-error" role="alert">{error}<button type="button" onClick={() => setError("")}>关闭</button></div>}
  </div>;
}
