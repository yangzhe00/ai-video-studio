import { useEffect, useMemo, useRef, useState } from "react";
import { Button, GeneratePage, PromptIdeas, StudioIcon, TaskStatus, ThemeToggle, WorkSetup, pendingPromptRequestId, suggestedProjectTitle } from "@ai-video/ui-web";
import type { PromptIdeaSet, WorkProjectChoice, WorkSetupSelection } from "@ai-video/ui-web";
import { ProjectHome, ResultsPage, StudioShell } from "@ai-video/components";
import type { StudioResult, StudioSection } from "@ai-video/components";
import { canvasPlugin } from "@ai-video/plugin-canvas";
import { CanvasPage } from "@ai-video/plugin-canvas/canvas";
import { videoEditPlugin } from "@ai-video/plugin-video-edit";
import { AgentEditWorkflow, VideoEditor, VoiceoverWorkflow, readAudioDuration } from "@ai-video/plugin-video-edit/web";
import type { RenderView, VideoEditView, VoiceAssetView } from "@ai-video/plugin-video-edit/web";
import type { VideoEditCommand } from "@ai-video/plugin-video-edit/core";
import { cloudTimelineClips, countUnicodeCharacters, creationBriefs, resourceRevision, timelineWithMetadata, validateCreationBrief } from "@ai-video/project-core";
import type { CanvasDocumentV1, CanvasEpisodeGraphV1, CloudTimelineClip, CreationBrief, SyncResourceType } from "@ai-video/project-core";
import type { GenerationJob, ProjectManifestV2, StudioEpisode } from "@ai-video/project-core";
import { resolvePlugins } from "@ai-video/plugin-sdk";
import type { EpisodeRenderView, ProjectSummary } from "@ai-video/api-contracts";
import { api as requestApi, uploadObject, uploadVoiceObject } from "./api";
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
type WebView = "home" | "projects" | "work-setup" | "idea-prepare" | "generate" | "canvas" | "results" | "assets" | "edit";
interface WorkCreateAttempt { id: string; title: string; episodeId: string; brief: CreationBrief }
const workDraftKey = (accountId: string) => `avs-web-work-draft:${accountId}`;
class StaleAccountResponse extends Error { constructor() { super("账号已切换"); } }
const isStaleAccountResponse = (cause: unknown) => cause instanceof StaleAccountResponse;

function usePhoneViewport() {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" &&
    (window.matchMedia ? window.matchMedia("(max-width: 640px)").matches : window.innerWidth <= 640));
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 640px)");
    if (!media) return;
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return phone;
}

export function webManifest(project: CloudProject, episodeId: string, run: AgentRunSnapshot | null): ProjectManifestV2 {
  const episode = project.document.episodes.find(item => item.id === episodeId) ?? project.document.episodes[0];
  const cloudCanvas = project.document.extensions?.canvas as CanvasDocumentV1 | undefined;
  const assets: ProjectManifestV2["assets"] = project.document.assets.filter((asset): asset is typeof asset & { kind: "image" | "video" } =>
    asset.kind === "image" || asset.kind === "video").map(asset => ({
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
  const phoneViewport = usePhoneViewport();
  const [account, setAccount] = useState<Account | null>(null);
  const accountEpoch = useRef(0);
  const activeAccountId = useRef<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<CloudProject | null>(null);
  const projectRef = useRef<CloudProject | null>(null);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const openProjectSequence = useRef(0);
  const [episodeId, setEpisodeId] = useState("");
  const [view, setView] = useState<WebView>("home");
  const [edit, setEdit] = useState<VideoEditView | null>(null);
  const [render, setRender] = useState<RenderView | null>(null);
  const renderRequestId = useRef<string | null>(null);
  const [episodeRender, setEpisodeRender] = useState<EpisodeRenderView | null>(null);
  const [showEpisodeVoice, setShowEpisodeVoice] = useState(false);
  const episodeRenderRequestId = useRef<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [title, setTitle] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createAttempt, setCreateAttempt] = useState<ProjectCreateAttempt | null>(null);
  const [createError, setCreateError] = useState("");
  const creatingProject = useRef(false);
  const logoutPending = useRef(false);
  const [createOrigin, setCreateOrigin] = useState<"home" | "projects" | "idea">("projects");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectListBusy, setProjectListBusy] = useState(false);
  const [projectListError, setProjectListError] = useState("");
  const [ideaSet, setIdeaSet] = useState<PromptIdeaSet | null>(null);
  const [recentIdeas, setRecentIdeas] = useState<PromptIdeaSet[]>([]);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaError, setIdeaError] = useState("");
  const [workBrief, setWorkBrief] = useState<CreationBrief | null>(null);
  const [workSelection, setWorkSelection] = useState<WorkSetupSelection | null>(null);
  const [workCreateId, setWorkCreateId] = useState<string | null>(null);
  const [workEpisodeId, setWorkEpisodeId] = useState<string | null>(null);
  const [workCreateAttempt, setWorkCreateAttempt] = useState<WorkCreateAttempt | null>(null);
  const workHydrated = useRef<string | null>(null);
  const [workProjects, setWorkProjects] = useState<WorkProjectChoice[]>([]);
  const [workProjectLoading, setWorkProjectLoading] = useState(false);
  const [workError, setWorkError] = useState("");
  const [workBusy, setWorkBusy] = useState(false);
  const [workConflict, setWorkConflict] = useState(false);
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [input, setInput] = useState("");
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
  const uploadPickerGeneration = useRef(0);
  const canvasDraft = useRef<CanvasEpisodeGraphV1 | null>(null);
  const [showAssets, setShowAssets] = useState(false);
  const activeEpisode = project?.document.episodes.find(item => item.id === episodeId);
  const canvasDocument = project?.document.extensions?.canvas as CanvasDocumentV1 | undefined;
  const canvasGraph: CanvasEpisodeGraphV1 = useMemo(() => canvasDocument?.version === 1 && canvasDocument.episodeGraphs[episodeId]
    ? canvasDocument.episodeGraphs[episodeId]
    : { nodes: [{ id: `timeline-${episodeId}`, type: "timeline", title: "整集时间线", x: 758, y: 501 }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, [canvasDocument, episodeId]);
  useEffect(() => { canvasDraft.current = null; }, [project?.id, episodeId]);

  type AccountScope = { id: string; epoch: number };
  const scopeForAccount = (): AccountScope | null => account?.id && activeAccountId.current === account.id
    ? { id: account.id, epoch: accountEpoch.current } : null;
  const scopeIsCurrent = (scope: AccountScope | null): scope is AccountScope =>
    Boolean(scope && activeAccountId.current === scope.id && accountEpoch.current === scope.epoch);
  function requireCurrentScope(scope: AccountScope) {
    if (!scopeIsCurrent(scope)) throw new StaleAccountResponse();
  }
  function reportAsyncFailure(promise: Promise<unknown>) {
    const scope = scopeForAccount();
    void promise.catch(cause => {
      if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause));
    });
  }
  function activateAccount(next: Account) {
    accountEpoch.current += 1;
    activeAccountId.current = next.id;
    setAccount(next);
  }
  async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    const scope = { id: activeAccountId.current, epoch: accountEpoch.current };
    if (!scope.id) throw new StaleAccountResponse();
    try {
      const response = await requestApi<T>(path, method, data);
      if (activeAccountId.current !== scope.id || accountEpoch.current !== scope.epoch)
        throw new StaleAccountResponse();
      return response;
    } catch (cause) {
      if (activeAccountId.current !== scope.id || accountEpoch.current !== scope.epoch)
        throw new StaleAccountResponse();
      throw cause;
    }
  }

  useEffect(() => {
    const started = accountEpoch.current;
    void requestApi<{ account: Account }>("/auth/me").then(result => {
      if (accountEpoch.current === started) activateAccount(result.account);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!account) return;
    void loadProjects();
    void loadIdeas();
  }, [account?.id]);

  useEffect(() => {
    if (!account || workHydrated.current === account.id) return;
    workHydrated.current = account.id;
    try {
      const raw = window.sessionStorage.getItem(workDraftKey(account.id));
      if (!raw) return;
      const saved = JSON.parse(raw) as { brief: unknown; selection: WorkSetupSelection; createId: string; episodeId: string; attempt?: WorkCreateAttempt };
      const brief = validateCreationBrief(saved.brief);
      if (!saved.selection || !["new", "existing"].includes(saved.selection.target) || typeof saved.createId !== "string" || typeof saved.episodeId !== "string") return;
      setWorkBrief(brief); setWorkSelection(saved.selection); setWorkCreateId(saved.createId); setWorkEpisodeId(saved.episodeId);
      setWorkCreateAttempt(saved.attempt ?? null); setView("work-setup");
    } catch { /* bad session draft stays inactive */ }
  }, [account?.id]);

  useEffect(() => {
    if (!account || workHydrated.current !== account.id || !workBrief || !workSelection || !workCreateId || !workEpisodeId) return;
    try { window.sessionStorage.setItem(workDraftKey(account.id), JSON.stringify({ brief: workBrief,
      selection: workSelection, createId: workCreateId, episodeId: workEpisodeId, attempt: workCreateAttempt })); }
    catch { setWorkError("浏览器无法保存创作草稿，刷新页面后可能丢失"); }
  }, [account?.id, workBrief, workSelection, workCreateId, workEpisodeId, workCreateAttempt]);

  useEffect(() => {
    if (!workBrief) return;
    setWorkProjects(current => projects.map(item => ({ id: item.id, title: item.title, scope: "cloud",
      episodes: current.find(row => row.id === item.id)?.episodes ?? (item.recentEpisode
        ? [{ id: item.recentEpisode.id, title: item.recentEpisode.title }] : []) })));
  }, [projects, workBrief?.id]);

  useEffect(() => { if (account && view === "projects") void loadProjects(); }, [account?.id, view === "projects"]);
  useEffect(() => {
    if (ideaSet?.state !== "pending") return;
    const id = ideaSet.id;
    const timer = window.setInterval(() => { void reloadIdea(id); }, 3000);
    return () => window.clearInterval(timer);
  }, [ideaSet?.id, ideaSet?.state]);

  async function loadProjects() {
    const scope = scopeForAccount();
    if (!scope) return;
    setProjectListBusy(true); setProjectListError("");
    try {
      const rows = (await api<{ projects: ProjectSummary[] }>("/projects")).projects;
      if (scopeIsCurrent(scope)) setProjects(rows);
    } catch (cause) { if (scopeIsCurrent(scope)) setProjectListError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) setProjectListBusy(false); }
  }

  async function loadIdeas() {
    const scope = scopeForAccount();
    if (!scope) return;
    try {
      const rows = (await api<{ ideaSets: PromptIdeaSet[] }>("/prompt-ideas")).ideaSets;
      if (!scopeIsCurrent(scope)) return;
      setRecentIdeas(rows);
      const pendingId = pendingPromptRequestId(`web:${scope.id}`);
      setIdeaSet(current => current ?? rows.find(item => item.clientRequestId === pendingId) ?? rows[0] ?? null);
    } catch (cause) { if (scopeIsCurrent(scope)) setIdeaError(String(cause)); }
  }

  async function requestIdeas(inputText: string, clientRequestId: string) {
    const scope = scopeForAccount();
    if (!scope) return;
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await api<{ ideaSet: PromptIdeaSet }>("/prompt-ideas", "POST", { clientRequestId, input: inputText })).ideaSet;
      if (scopeIsCurrent(scope)) {
        setIdeaSet(next);
        setRecentIdeas(current => [next, ...current.filter(item => item.id !== next.id)]);
      }
    } catch (cause) { if (scopeIsCurrent(scope)) setIdeaError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) setIdeaBusy(false); }
  }

  async function reloadIdea(id: string) {
    const scope = scopeForAccount();
    if (!scope) return;
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await api<{ ideaSet: PromptIdeaSet }>(`/prompt-ideas/${id}`)).ideaSet;
      if (scopeIsCurrent(scope)) setIdeaSet(next);
    } catch (cause) { if (scopeIsCurrent(scope)) setIdeaError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) setIdeaBusy(false); }
  }

  async function selectIdea(id: string, variantId: string, editedPrompt: string) {
    const scope = scopeForAccount();
    if (!scope) throw new Error("请先登录账号");
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await api<{ ideaSet: PromptIdeaSet }>(`/prompt-ideas/${id}/selection`, "POST", { variantId, editedPrompt })).ideaSet;
      if (!scopeIsCurrent(scope)) throw new Error("账号已切换，请在当前账号重新选择灵感");
      setIdeaSet(next); setRecentIdeas(current => [next, ...current.filter(item => item.id !== next.id)]);
      return next;
    } catch (cause) { if (scopeIsCurrent(scope)) setIdeaError(String(cause)); throw cause; }
    finally { if (scopeIsCurrent(scope)) setIdeaBusy(false); }
  }

  async function openProject(id: string, destination: "generate" | "idea-prepare" | "canvas" = "generate"): Promise<boolean> {
    const scope = scopeForAccount();
    if (!scope) return false;
    const sequence = ++openProjectSequence.current;
    const isCurrentOpen = () => scopeIsCurrent(scope) && openProjectSequence.current === sequence;
    try {
      setError("");
      const fresh = (await api<{ project: CloudProject }>(`/projects/${id}`)).project;
      if (!isCurrentOpen()) return false;
      projectRef.current = fresh;
      setProject(fresh);
      setView(destination);
      window.localStorage.setItem(lastProjectKey, id);
      const lastEpisode = window.localStorage.getItem(`${lastProjectKey}:${id}:episode`);
      setEpisodeId(fresh.document.episodes.some(item => item.id === lastEpisode) ? lastEpisode! : fresh.document.episodes[0]?.id ?? "");
      let current = fresh;
      const canvas = fresh.document.extensions?.canvas as CanvasDocumentV1 | undefined;
      if (destination === "generate" && canvas?.version === 1) for (const [targetEpisodeId, graph] of Object.entries(canvas.episodeGraphs)) {
        for (const pending of pendingCanvasRuns(graph)) {
          if (!isCurrentOpen()) return false;
          try {
            const planned = (await api<{ run: AgentRunSnapshot }>(`/projects/${id}/runs`, "POST", {
              clientRequestId: pending.clientRequestId, ...pending.input,
            })).run;
            if (!isCurrentOpen()) return false;
            const latestCanvas = current.document.extensions?.canvas as CanvasDocumentV1;
            const latestGraph = latestCanvas.episodeGraphs[targetEpisodeId];
            current = await sendCommand(current, "canvas", targetEpisodeId,
              attachCanvasRun(latestGraph, pending.nodeId, pending.clientRequestId, planned.runId));
          } catch (cause) { if (isCurrentOpen() && !isStaleAccountResponse(cause)) setError(`恢复画布任务失败：${String(cause)}`); }
        }
      }
      requireCurrentScope(scope);
      if (!isCurrentOpen()) return false;
      const recent = (await api<{ runs: AgentRunSnapshot[] }>(`/projects/${id}/runs`)).runs;
      if (!isCurrentOpen()) return false;
      setRun(recent[0] ?? null);
      setSourceAssetId(fresh.document.assets.find(asset => asset.kind === "image")?.id ?? "");
      requestId.current = null; requestFingerprint.current = null; approvalId.current = null;
      return true;
    } catch (cause) { if (isCurrentOpen() && !isStaleAccountResponse(cause)) setError(String(cause)); return false; }
  }

  async function authenticate() {
    const started = ++accountEpoch.current;
    activeAccountId.current = null;
    openProjectSequence.current += 1;
    mutationQueue.current = Promise.resolve();
    creatingProject.current = false; submitting.current = false;
    uploadPickerGeneration.current += 1;
    uploadResolver.current?.(null); uploadResolver.current = null;
    try {
      setBusy(true); setError("");
      const result = await requestApi<{ account: Account }>(`/auth/${authMode}`, "POST", { email, password });
      if (accountEpoch.current !== started) return;
      setBusy(false);
      setAccount(result.account);
      activeAccountId.current = result.account.id;
      accountEpoch.current += 1;
      setPassword("");
      setView("home");
    } catch (cause) { if (accountEpoch.current === started) setError(String(cause)); }
    finally { if (accountEpoch.current === started) setBusy(false); }
  }

  async function logout() {
    if (!account || logoutPending.current) return;
    const previousAccount = account;
    logoutPending.current = true;
    const started = ++accountEpoch.current;
    activeAccountId.current = null;
    openProjectSequence.current += 1;
    mutationQueue.current = Promise.resolve();
    creatingProject.current = false; submitting.current = false;
    uploadPickerGeneration.current += 1;
    uploadResolver.current?.(null); uploadResolver.current = null;
    setBusy(true); setError("");
    let confirmedLoggedOut = false;
    let observedAccount: Account | null = null;
    let failure: unknown = null;
    try {
      await requestApi("/auth/logout", "POST");
      confirmedLoggedOut = true;
    } catch (cause) {
      failure = cause;
      if (accountEpoch.current !== started) return;
      try {
        const check = await fetch("/api/auth/me", { credentials: "include" });
        if (check.status === 401) confirmedLoggedOut = true;
        else if (check.ok) {
          const payload = await check.json() as { account?: Account };
          if (payload.account?.id) observedAccount = payload.account;
        }
      } catch { /* keep the visible account until the session can be confirmed */ }
    } finally { logoutPending.current = false; }
    if (accountEpoch.current !== started) return;
    if (!confirmedLoggedOut && (!observedAccount || observedAccount.id === previousAccount.id)) {
      if (observedAccount) activeAccountId.current = previousAccount.id;
      setBusy(false);
      setError(observedAccount
        ? `退出失败，账号仍已登录。请重试退出：${String(failure)}`
        : `退出状态无法确认，请重试退出或刷新页面；确认前其他账号操作不可用：${String(failure)}`);
      return;
    }
    {
      window.localStorage.removeItem(lastProjectKey);
      projectRef.current = null; setAccount(null); setProject(null); setRun(null); setProjects([]);
      setIdeaSet(null); setRecentIdeas([]); setWorkBrief(null); setWorkSelection(null); setWorkProjects([]);
      setEdit(null); setRender(null); setShowAssets(false); setShowCreateProject(false); setCreateAttempt(null);
      setProjectListBusy(false); setProjectListError(""); setIdeaBusy(false); setIdeaError(""); setWorkBusy(false);
      setSourceAssetId(""); setInput(""); setEventMessage(""); setView("home"); setBusy(false);
      setEmail(""); setPassword("");
      workHydrated.current = null;
    }
    if (observedAccount && !confirmedLoggedOut) {
      activeAccountId.current = observedAccount.id;
      accountEpoch.current += 1;
      setAccount(observedAccount);
      setError("当前登录账号已变更，已切换到该账号");
    }
  }

  function selectWebEpisode(id: string) {
    if (project) window.localStorage.setItem(`${lastProjectKey}:${project.id}:episode`, id);
    setEpisodeId(id);
  }

  async function createProject() {
    const scope = scopeForAccount();
    if (!scope) return;
    if (!title.trim() || creatingProject.current) return;
    const cleanTitle = title.trim();
    if (createAttempt && createAttempt.title !== cleanTitle) {
      setCreateError("上次项目请求尚未确认。请恢复原名称查询，或明确另起新项目。");
      return;
    }
    const attempt = createAttempt ?? { id: crypto.randomUUID(), title: cleanTitle };
    try { window.sessionStorage.setItem(createAttemptKey(scope.id), JSON.stringify(attempt)); }
    catch { setCreateError("浏览器无法保存项目请求编号，请启用会话存储后重试"); return; }
    setCreateAttempt(attempt);
    creatingProject.current = true;
    try {
      setBusy(true); setCreateError(""); setError("");
      let created: CloudProject;
      try { created = (await api<{ project: CloudProject }>("/projects", "POST", { id: attempt.id, title: cleanTitle })).project; }
      catch (postError) {
        if (isStaleAccountResponse(postError)) throw postError;
        requireCurrentScope(scope);
        let recovered: CloudProject | null = null;
        try { recovered = (await api<{ project: CloudProject }>(`/projects/${attempt.id}`)).project; }
        catch (cause) { if (isStaleAccountResponse(cause)) throw cause; /* retry keeps the same ID */ }
        if (recovered && recovered.title !== cleanTitle) throw new Error("项目编号已对应其他名称，请明确另起新项目");
        if (!recovered) throw postError;
        created = recovered;
      }
      requireCurrentScope(scope);
      await loadProjects();
      requireCurrentScope(scope);
      if (!await openProject(created.id, createOrigin === "idea" ? "idea-prepare" : "generate")) {
        requireCurrentScope(scope);
        setCreateError("项目已创建，但打开失败。请查询原项目后继续。");
        return;
      }
      requireCurrentScope(scope);
      try { window.sessionStorage.removeItem(createAttemptKey(scope.id)); } catch { /* project has already opened */ }
      setCreateAttempt(null); setTitle(""); setShowCreateProject(false);
    } catch (cause) { if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setCreateError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) { creatingProject.current = false; setBusy(false); } }
  }

  function beginWork(brief: CreationBrief) {
    setWorkBrief(brief);
    setWorkSelection({ target: "new", title: suggestedProjectTitle(brief.finalText), projectId: "", episodeId: "",
      mode: null, manualSingleShotConfirmed: false });
    setWorkCreateId(crypto.randomUUID());
    setWorkEpisodeId(crypto.randomUUID()); setWorkCreateAttempt(null);
    setWorkError(""); setWorkConflict(false);
    setWorkProjects(projects.map(item => ({ id: item.id, title: item.title, scope: "cloud",
      episodes: item.recentEpisode ? [{ id: item.recentEpisode.id, title: item.recentEpisode.title }] : [] })));
    setView("work-setup");
  }

  useEffect(() => {
    if (view !== "work-setup" || workSelection?.target !== "existing" || !workSelection.projectId) {
      setWorkProjectLoading(false);
      return;
    }
    const scope = scopeForAccount();
    if (!scope) return;
    const id = workSelection.projectId;
    let live = true;
    setWorkError("");
    setWorkProjectLoading(true);
    void api<{ project: CloudProject }>(`/projects/${id}`).then(({ project: detail }) => {
      if (!live || !scopeIsCurrent(scope)) return;
      setWorkProjects(current => current.map(item => item.id === id
        ? { ...item, episodes: detail.document.episodes.map(episode => ({ id: episode.id, title: episode.title })) } : item));
      setWorkSelection(current => current && current.projectId === id && !detail.document.episodes.some(item => item.id === current.episodeId)
        ? { ...current, episodeId: detail.document.episodes[0]?.id ?? "" } : current);
    }).catch(cause => { if (live && scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setWorkError(`读取目标项目失败：${String(cause)}`); })
      .finally(() => { if (live && scopeIsCurrent(scope)) setWorkProjectLoading(false); });
    return () => { live = false; };
  }, [view, workSelection?.target, workSelection?.projectId]);

  async function submitWork() {
    const brief = workBrief, selection = workSelection;
    const scope = scopeForAccount();
    if (!scope || !brief || !selection || !selection.mode || workBusy) return;
    if (selection.mode === "direct" && countUnicodeCharacters(brief.finalText) > 2000) return;
    setWorkBusy(true); setWorkError(""); setWorkConflict(false);
    try {
      let target: CloudProject;
      if (selection.target === "new") {
        const id = workCreateId ?? crypto.randomUUID();
        setWorkCreateId(id);
        const attempt = workCreateAttempt ?? { id, title: selection.title.trim(), episodeId: workEpisodeId ?? crypto.randomUUID(), brief };
        if (workCreateAttempt && (workCreateAttempt.title !== selection.title.trim() || JSON.stringify(workCreateAttempt.brief) !== JSON.stringify(brief)))
          throw new Error("上次创建结果待确认；请恢复原名称和内容查询，或明确另起新项目");
        setWorkCreateAttempt(attempt);
        setWorkEpisodeId(attempt.episodeId);
        let existingProject: CloudProject | null = null;
        if (workCreateAttempt) try { existingProject = (await api<{ project: CloudProject }>(`/projects/${id}`)).project; }
        catch (cause) { if (isStaleAccountResponse(cause)) throw cause; /* original create may not have arrived */ }
        requireCurrentScope(scope);
        try { target = existingProject ?? (await api<{ project: CloudProject }>("/projects", "POST", {
          id: attempt.id, title: attempt.title, initialEpisodeId: attempt.episodeId, initialBrief: attempt.brief,
        })).project; }
        catch (postError) {
          if (isStaleAccountResponse(postError)) throw postError;
          requireCurrentScope(scope);
          let recovered: CloudProject | null = null;
          try { recovered = (await api<{ project: CloudProject }>(`/projects/${id}`)).project; }
          catch (cause) { if (isStaleAccountResponse(cause)) throw cause; /* keep the same ID for retry */ }
          if (!recovered) throw postError;
          const saved = creationBriefs(recovered.document).find(item => item.id === brief.id);
          if (recovered.title !== attempt.title || JSON.stringify(saved) !== JSON.stringify(attempt.brief))
            throw new Error("项目编号已有不同内容，请查看当前项目后再决定");
          target = recovered;
        }
        const createdBrief = creationBriefs(target.document).find(item => item.id === attempt.brief.id);
        if (target.title !== attempt.title || JSON.stringify(createdBrief) !== JSON.stringify(attempt.brief))
          throw new Error("项目编号已有不同内容，请查看当前项目后再决定");
      } else {
        if (!selection.projectId || !selection.episodeId) throw new Error("请先选择项目和分集");
        const current = (await api<{ project: CloudProject }>(`/projects/${selection.projectId}`)).project;
        requireCurrentScope(scope);
        const existing = creationBriefs(current.document).find(item => item.id === brief.id);
        if (existing && JSON.stringify(existing) === JSON.stringify(brief)) target = current;
        else if (existing) throw new Error("创作原文已被修改，请查看当前版本后再决定");
        else {
          try { target = (await api<{ project: CloudProject }>(`/projects/${current.id}/commands`, "POST", {
            id: brief.id, resourceType: "brief", resourceId: brief.id, baseRevision: 0, payload: brief,
          })).project; }
          catch (postError) {
            if (isStaleAccountResponse(postError)) throw postError;
            requireCurrentScope(scope);
            const recovered = (await api<{ project: CloudProject }>(`/projects/${selection.projectId}`)).project;
            const saved = creationBriefs(recovered.document).find(item => item.id === brief.id);
            if (!saved || JSON.stringify(saved) !== JSON.stringify(brief)) throw postError;
            target = recovered;
          }
        }
      }
      requireCurrentScope(scope);
      await loadProjects();
      requireCurrentScope(scope);
      if (!await openProject(target.id, selection.mode === "canvas" ? "canvas" : "idea-prepare"))
        throw new Error("原文已保存，但打开项目失败。请从项目库重新打开。");
      requireCurrentScope(scope);
      if (selection.target === "existing") selectWebEpisode(selection.episodeId);
      setInput(brief.finalText);
      setWorkBrief(null); setWorkSelection(null); setWorkCreateId(null); setWorkEpisodeId(null); setWorkCreateAttempt(null);
      try { window.sessionStorage.removeItem(workDraftKey(scope.id)); } catch { /* saved project is already open */ }
    } catch (cause) {
      if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) {
        const message = String(cause);
        setWorkError(message);
        setWorkConflict(/冲突|另一端|不同内容|已被修改/.test(message));
      }
    } finally { if (scopeIsCurrent(scope)) setWorkBusy(false); }
  }

  function enqueue<T>(operation: (current: CloudProject) => Promise<T>): Promise<T> {
    const scope = scopeForAccount();
    const projectId = projectRef.current?.id;
    const pending = mutationQueue.current.then(async () => {
      if (!scope || !scopeIsCurrent(scope)) throw new StaleAccountResponse();
      const current = projectRef.current;
      if (!current || current.id !== projectId) throw new StaleAccountResponse();
      return operation(current);
    });
    mutationQueue.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function sendCommand(current: CloudProject, resourceType: SyncResourceType, resourceId: string, payload: unknown) {
    const scope = scopeForAccount();
    if (!scope || projectRef.current?.id !== current.id) throw new StaleAccountResponse();
    try {
      const updated = (await api<{ project: CloudProject }>(`/projects/${current.id}/commands`, "POST", {
        id: crypto.randomUUID(), resourceType, resourceId,
        baseRevision: resourceRevision(current.resourceRevisions ?? [], resourceType, resourceId), payload,
      })).project;
      requireCurrentScope(scope);
      if (projectRef.current?.id !== current.id) throw new StaleAccountResponse();
      projectRef.current = updated; setProject(updated);
      return updated;
    } catch (cause) {
      if (isStaleAccountResponse(cause)) throw cause;
      if (String(cause).includes("冲突")) {
        requireCurrentScope(scope);
        const fresh = (await api<{ project: CloudProject }>(`/projects/${current.id}`)).project;
        requireCurrentScope(scope);
        if (projectRef.current?.id !== current.id) throw new StaleAccountResponse();
        projectRef.current = fresh; setProject(fresh);
        throw new Error("项目已在另一端更新，请检查最新内容后重试");
      }
      throw cause;
    }
  }

  async function upload(file: File | undefined): Promise<string | null> {
    if (!file || !project) return null;
    const scope = scopeForAccount();
    if (!scope) return null;
    try {
      setBusy(true); setError("");
      const object = await uploadObject(file);
      requireCurrentScope(scope);
      await enqueue(current => sendCommand(current, "asset", object.id, { id: object.id, kind: "image", name: file.name }));
      requireCurrentScope(scope);
      setSourceAssetId(object.id);
      return object.id;
    } catch (cause) { if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(`上传照片失败：${cause instanceof Error ? cause.message : String(cause)}`); return null; }
    finally { if (scopeIsCurrent(scope)) setBusy(false); }
  }

  async function createEpisode() {
    if (!project) return;
    const scope = scopeForAccount();
    if (!scope) return;
    const title = window.prompt("新分集名称", `第 ${project.document.episodes.length + 1} 集`)?.trim();
    if (!title) return;
    const id = crypto.randomUUID();
    try {
      const updated = await enqueue(current => sendCommand(current, "episode", id, { id, title, shots: [], timeline: [] }));
      requireCurrentScope(scope);
      setEpisodeId(updated.document.episodes.find(item => item.id === id)?.id ?? episodeId);
    } catch (cause) { if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause)); }
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

  async function updateCreationBrief(id: string, finalText: string, expectedRemoteText?: string) {
    const scope = scopeForAccount();
    if (!scope) throw new StaleAccountResponse();
    if (!finalText.trim() || countUnicodeCharacters(finalText) > 10000) throw new Error("创作内容需为 1–10000 字");
    await enqueue(async current => {
      requireCurrentScope(scope);
      const conflict = (remoteText: string) => Object.assign(new Error("创作原文已在另一端修改，请选择使用哪一版"), {
        kind: "creation-brief-conflict" as const, localText: finalText, remoteText,
      });
      let base = current;
      if (expectedRemoteText !== undefined) {
        base = (await api<{ project: CloudProject }>(`/projects/${current.id}`)).project;
        requireCurrentScope(scope);
        projectRef.current = base; setProject(base);
        const latest = creationBriefs(base.document).find(item => item.id === id);
        if (!latest) throw new Error("云端创作原文已不存在，请保留本端草稿并联系管理员");
        if (latest.finalText !== expectedRemoteText) throw conflict(latest.finalText);
      }
      const previous = creationBriefs(base.document).find(item => item.id === id);
      if (!previous) throw new Error("创作原文不存在，请刷新项目");
      try {
        const updated = (await api<{ project: CloudProject }>(`/projects/${base.id}/commands`, "POST", {
          id: crypto.randomUUID(), resourceType: "brief", resourceId: id,
          baseRevision: resourceRevision(base.resourceRevisions ?? [], "brief", id),
          payload: { ...previous, finalText, updatedAt: Date.now() },
        })).project;
        requireCurrentScope(scope);
        projectRef.current = updated; setProject(updated);
      } catch (cause) {
        if (isStaleAccountResponse(cause)) throw cause;
        if (!String(cause).includes("冲突")) throw cause;
        requireCurrentScope(scope);
        const fresh = (await api<{ project: CloudProject }>(`/projects/${base.id}`)).project;
        requireCurrentScope(scope);
        projectRef.current = fresh; setProject(fresh);
        const remote = creationBriefs(fresh.document).find(item => item.id === id);
        if (!remote) throw new Error("云端创作原文已不存在，请保留本端草稿并联系管理员");
        if (remote.finalText === finalText) return;
        throw conflict(remote.finalText);
      }
    });
  }

  function pickPhoto(): Promise<string | null> {
    const scope = scopeForAccount();
    if (!scope) return Promise.resolve(null);
    return new Promise(resolve => {
      const input = filePicker.current;
      if (!input) { resolve(null); return; }
      const generation = ++uploadPickerGeneration.current;
      const cancel = () => { if (uploadPickerGeneration.current === generation && uploadResolver.current === complete) uploadResolver.current = null; resolve(null); };
      const complete = (id: string | null) => {
        input.removeEventListener("cancel", cancel);
        resolve(scopeIsCurrent(scope) && uploadPickerGeneration.current === generation ? id : null);
      };
      input.addEventListener("cancel", cancel, { once: true });
      uploadResolver.current = complete;
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
    reportAsyncFailure(saveCanvas(next));
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
    reportAsyncFailure(saveCanvas(next, [...(project.document.characters ?? []), character]));
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
    reportAsyncFailure(runCanvasNode(nodeId, photo, prompt));
  }

  function addCanvasTimeline(assetId: string) {
    const episode = projectRef.current?.document.episodes.find(item => item.id === episodeId);
    if (!episode || (episode.timeline ?? []).includes(assetId)) return;
    const updated = timelineWithMetadata(episode, [...(episode.timeline ?? []), assetId], () => crypto.randomUUID());
    reportAsyncFailure(saveCanvas(currentGraph(), undefined, updated.timelineClips));
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
    reportAsyncFailure(saveCanvas(currentGraph(), undefined, next));
  }

  async function runCanvasNode(nodeId: string, photo: string, prompt: string) {
    const length = 5;
    if (!project || submitting.current) return;
    const scope = scopeForAccount();
    if (!scope) return;
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
      requireCurrentScope(scope);
      requestId.current = prepared.clientRequestId;
      const planned = (await api<{ run: AgentRunSnapshot }>(`/projects/${project.id}/runs`, "POST", {
        clientRequestId: prepared.clientRequestId, episodeId, sourceAssetId: photo, input: prompt, durationSec: length,
      })).run;
      requireCurrentScope(scope);
      const linked = attachCanvasRun(currentGraph(), nodeId, prepared.clientRequestId, planned.runId);
      canvasDraft.current = linked;
      await saveCanvas(linked);
      requireCurrentScope(scope);
      setRun(planned); setSourceAssetId(photo); setInput(prompt); setView("generate"); approvalId.current = null;
    } finally { if (scopeIsCurrent(scope)) { submitting.current = false; setBusy(false); } }
  }

  async function openEdit(shotId: string) {
    if (!project) return;
    const scope = scopeForAccount();
    if (!scope) return;
    try {
      setBusy(true); setError("");
      const opened = (await api<{ edit: VideoEditView }>("/video-edits", "POST", { projectId: project.id, episodeId, shotId })).edit;
      requireCurrentScope(scope);
      setEdit(opened); setRender(null); renderRequestId.current = null; setView("edit");
    } catch (cause) { if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) setBusy(false); }
  }

  async function editCommand(command: VideoEditCommand, expectedRevision: number): Promise<VideoEditView> {
    if (!edit) throw new Error("请先打开视频");
    const scope = scopeForAccount();
    if (!scope) throw new StaleAccountResponse();
    const changed = (await api<{ edit: VideoEditView }>(`/video-edits/${edit.id}/commands`, "POST", { commandId: crypto.randomUUID(), expectedRevision, command })).edit;
    requireCurrentScope(scope);
    setEdit(changed); setRender(null); renderRequestId.current = null;
    return changed;
  }

  async function renderEdit(revision: number) {
    if (!edit) return;
    const scope = scopeForAccount();
    if (!scope) return;
    renderRequestId.current ??= crypto.randomUUID();
    const created = (await api<{ render: RenderView }>(`/video-edits/${edit.id}/render`, "POST", { renderOperationId: renderRequestId.current, expectedRevision: revision })).render;
    requireCurrentScope(scope);
    setRender(created);
  }

  useEffect(() => {
    if (!render || ["succeeded", "failed"].includes(render.state)) return;
    const scope = scopeForAccount();
    if (!scope) return;
    let live = true;
    const poll = async () => {
      if (!scopeIsCurrent(scope)) return;
      try {
        const next = (await api<{ render: RenderView }>(`/renders/${render.id}`)).render;
        if (!live || !scopeIsCurrent(scope)) return;
        setRender(next);
        if (next.state === "succeeded" && edit && project) {
          const [freshEdit, freshProject] = await Promise.all([
            api<{ edit: VideoEditView }>(`/video-edits/${edit.id}`), api<{ project: CloudProject }>(`/projects/${project.id}`),
          ]);
          if (live && scopeIsCurrent(scope) && projectRef.current?.id === project.id) {
            setEdit(freshEdit.edit); projectRef.current = freshProject.project; setProject(freshProject.project);
          }
        }
      } catch (cause) { if (live && scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause)); }
    };
    const timer = window.setInterval(() => { void poll(); }, 3000);
    void poll();
    return () => { live = false; window.clearInterval(timer); };
  }, [render?.id, render?.state, edit?.id, project?.id]);

  async function useEditInTimeline(assetId: string) {
    if (!edit) throw new Error("编辑记录不存在");
    const scope = scopeForAccount();
    if (!scope) throw new StaleAccountResponse();
    await enqueue(async current => {
      const episode = current.document.episodes.find(item => item.id === edit.recipe.episodeId);
      if (!episode) throw new Error("分集不存在");
      await sendCommand(current, "episode", episode.id,
        timelineWithMetadata(episode, [...(episode.timeline ?? []), assetId], () => crypto.randomUUID()));
    });
    requireCurrentScope(scope);
    setError("");
  }

  async function uploadVoice(file: File): Promise<VoiceAssetView> {
    const scope = scopeForAccount();
    if (!scope || !projectRef.current) throw new StaleAccountResponse();
    const object = await uploadVoiceObject(file);
    requireCurrentScope(scope);
    let durationMs = object.durationMs;
    if (!durationMs) {
      const localUrl = URL.createObjectURL(file);
      try { durationMs = await readAudioDuration(localUrl); }
      finally { URL.revokeObjectURL(localUrl); }
    }
    const asset = { id: object.id, kind: "voice" as const, name: file.name, mimeType: object.mime, durationMs };
    await enqueue(current => sendCommand(current, "asset", asset.id, asset));
    requireCurrentScope(scope);
    return { id: asset.id, name: asset.name, durationMs, url: `/api/objects/${asset.id}` };
  }

  async function ttsAssetReady(assetId: string): Promise<VoiceAssetView> {
    const scope = scopeForAccount();
    const current = projectRef.current;
    if (!scope || !current) throw new StaleAccountResponse();
    const fresh = (await api<{ project: CloudProject }>(`/projects/${current.id}`)).project;
    requireCurrentScope(scope);
    if (projectRef.current?.id !== current.id) throw new StaleAccountResponse();
    projectRef.current = fresh; setProject(fresh);
    const asset = fresh.document.assets.find(item => item.id === assetId);
    if (!asset || asset.kind !== "voice") throw new Error("配音已生成，但语音资产尚未关联到项目。请稍后查询原任务");
    return { id: assetId, name: asset.name ?? "文字配音", durationMs: asset.durationMs ?? await readAudioDuration(`/api/objects/${assetId}`),
      url: `/api/objects/${assetId}` };
  }

  async function saveEpisodeAudio(mix: { originalVolume: number; voiceClips: { assetId: string; startMs: number; inMs: number; outMs: number; volume: number }[];
    musicClips: { assetId: string; startMs: number; inMs: number; outMs: number; volume: number }[] }) {
    const currentEpisodeId = episodeId;
    await enqueue(async current => {
      const currentEpisode = current.document.episodes.find(item => item.id === currentEpisodeId);
      if (!currentEpisode) throw new Error("分集不存在");
      await sendCommand(current, "episode", currentEpisodeId, { ...currentEpisode, audio: mix });
    });
  }

  async function refreshAgentApplied(editId?: string) {
    const scope = scopeForAccount();
    const current = projectRef.current;
    if (!scope || !current) throw new StaleAccountResponse();
    const [freshProject, freshEdit] = await Promise.all([
      api<{ project: CloudProject }>(`/projects/${current.id}`),
      editId ? api<{ edit: VideoEditView }>(`/video-edits/${editId}`) : Promise.resolve(null),
    ]);
    requireCurrentScope(scope);
    if (projectRef.current?.id !== current.id) throw new StaleAccountResponse();
    projectRef.current = freshProject.project; setProject(freshProject.project);
    if (freshEdit) { setEdit(freshEdit.edit); setRender(null); renderRequestId.current = null; }
  }

  async function exportCloudEpisode() {
    const scope = scopeForAccount();
    const current = projectRef.current;
    if (!scope || !current || !episodeId) throw new Error("请先打开分集");
    const episode = current.document.episodes.find(item => item.id === episodeId);
    if (!episode || !cloudTimelineClips(episode).length) throw new Error("请先把视频加入本集时间线");
    const key = `avs-episode-render:${scope.id}:${current.id}:${episodeId}`;
    const rememberedId = episodeRenderRequestId.current ?? window.localStorage.getItem(key);
    let latestRender = episodeRender;
    if (rememberedId && (!episodeRender || episodeRender.id !== rememberedId)) {
      const previous = (await api<{ episodeRender: EpisodeRenderView }>(`/episode-renders/${rememberedId}`)).episodeRender;
      requireCurrentScope(scope);
      setEpisodeRender(previous);
      latestRender = previous;
      if (!["succeeded", "failed"].includes(previous.state)) throw new Error("整集导出仍在进行，请查看原任务状态");
    }
    if (latestRender && latestRender.episodeId === episodeId && ["succeeded", "failed"].includes(latestRender.state)) {
      episodeRenderRequestId.current = null;
    }
    episodeRenderRequestId.current ??= crypto.randomUUID();
    window.localStorage.setItem(key, episodeRenderRequestId.current);
    const created = (await api<{ episodeRender: EpisodeRenderView }>(`/projects/${current.id}/episodes/${episodeId}/render`, "POST", {
      renderOperationId: episodeRenderRequestId.current,
      expectedEpisodeRevision: resourceRevision(current.resourceRevisions ?? [], "episode", episodeId),
    })).episodeRender;
    requireCurrentScope(scope);
    setEpisodeRender(created);
  }

  useEffect(() => {
    if (!account || !project || !episodeId) return;
    const key = `avs-episode-render:${account.id}:${project.id}:${episodeId}`;
    const id = window.localStorage.getItem(key);
    if (!id || !/^[a-zA-Z0-9-]{8,80}$/.test(id) || episodeRender?.id === id) return;
    let live = true;
    void api<{ episodeRender: EpisodeRenderView }>(`/episode-renders/${id}`).then(result => {
      if (live) { episodeRenderRequestId.current = id; setEpisodeRender(result.episodeRender); }
    }).catch(cause => { if (live && !isStaleAccountResponse(cause)) setError(`查询整集导出失败：${String(cause)}`); });
    return () => { live = false; };
  }, [account?.id, project?.id, episodeId]);

  useEffect(() => {
    episodeRenderRequestId.current = null;
    setEpisodeRender(null);
  }, [account?.id, project?.id, episodeId]);

  useEffect(() => {
    if (!episodeRender || ["succeeded", "failed"].includes(episodeRender.state)) return;
    let live = true;
    const poll = async () => {
      try {
        const next = (await api<{ episodeRender: EpisodeRenderView }>(`/episode-renders/${episodeRender.id}`)).episodeRender;
        if (live) setEpisodeRender(next);
      } catch (cause) { if (live && !isStaleAccountResponse(cause)) setError(`查询整集导出失败：${String(cause)}`); }
    };
    const timer = window.setInterval(() => { void poll(); }, 3000);
    void poll();
    return () => { live = false; window.clearInterval(timer); };
  }, [episodeRender?.id, episodeRender?.state]);

  async function plan(photoId = sourceAssetId, prompt = input) {
    const length = 5;
    if (!project || !episodeId || !photoId || !prompt.trim() || submitting.current) return;
    const scope = scopeForAccount();
    if (!scope) return;
    submitting.current = true;
    try {
      setBusy(true); setError("");
      setSourceAssetId(photoId); setInput(prompt);
      const fingerprint = JSON.stringify({ episodeId, photoId, prompt: prompt.trim(), length });
      if (requestFingerprint.current !== fingerprint) { requestId.current = crypto.randomUUID(); requestFingerprint.current = fingerprint; }
      const planned = (await api<{ run: AgentRunSnapshot }>(`/projects/${project.id}/runs`, "POST", {
        clientRequestId: requestId.current, episodeId, sourceAssetId: photoId, input: prompt, durationSec: length,
      })).run;
      requireCurrentScope(scope);
      setRun(planned); approvalId.current = null;
    } catch (cause) { if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) { submitting.current = false; setBusy(false); } }
  }

  async function approve() {
    if (!run || busy) return;
    const scope = scopeForAccount();
    if (!scope) return;
    try {
      setBusy(true); setError("");
      approvalId.current ??= crypto.randomUUID();
      const approved = (await api<{ run: AgentRunSnapshot }>(`/runs/${run.runId}/approve`, "POST", { approvalId: approvalId.current, planHash: run.planHash })).run;
      requireCurrentScope(scope);
      setRun(approved); setEventMessage("已确认，云端正在处理");
    } catch (cause) { if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause)); }
    finally { if (scopeIsCurrent(scope)) setBusy(false); }
  }

  useEffect(() => {
    if (!run || run.state === "waiting_approval" || ["saved", "failed"].includes(run.state)) return;
    const scope = scopeForAccount();
    if (!scope) return;
    const id = run.runId;
    let live = true;
    const refresh = async () => {
      if (!scopeIsCurrent(scope)) return;
      try {
        const next = (await api<{ run: AgentRunSnapshot }>(`/runs/${id}`)).run;
        if (!live || !scopeIsCurrent(scope)) return;
        setRun(next);
        if (next.state === "saved" && project) {
          const fresh = (await api<{ project: CloudProject }>(`/projects/${project.id}`)).project;
          if (live && scopeIsCurrent(scope) && projectRef.current?.id === project.id) { projectRef.current = fresh; setProject(fresh); }
        }
      } catch (cause) { if (live && scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause)); }
    };
    const source = new EventSource(`/api/runs/${id}/events`, { withCredentials: true });
    source.addEventListener("state", event => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { message: string };
        if (live && scopeIsCurrent(scope)) { setEventMessage(data.message); void refresh(); }
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
  const refreshRun = async (id: string) => {
    const scope = scopeForAccount();
    if (!scope) return;
    try {
      const next = (await api<{ run: AgentRunSnapshot }>(`/runs/${id}`)).run;
      if (scopeIsCurrent(scope) && projectRef.current?.id === next.projectId) setRun(next);
    } catch (cause) {
      if (scopeIsCurrent(scope) && !isStaleAccountResponse(cause)) setError(String(cause));
    }
  };
  const openCreate = (origin: "home" | "projects" | "idea") => {
    const pending = account ? readCreateAttempt(account.id) : null;
    setCreateOrigin(origin); setCreateAttempt(pending); setCreateError(""); setTitle(pending?.title ?? ""); setShowCreateProject(true);
  };
  const filteredProjects = projects.filter(item => item.title.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase()));
  const ideaWidget = <PromptIdeas requestScope={`web:${account?.id ?? "anonymous"}`} ideaSet={ideaSet} recentSets={recentIdeas} busy={ideaBusy} error={ideaError}
    onRequest={requestIdeas} onReload={reloadIdea} onSelect={selectIdea}
    onContinue={saved => {
      if (!saved.selectedVariantId || !saved.editedPrompt) return;
      const now = Date.now();
      beginWork({ id: crypto.randomUUID(), source: "agent", originalText: saved.input, finalText: saved.editedPrompt,
        ideaSetId: saved.id, variantId: saved.selectedVariantId, createdAt: now, updatedAt: now });
    }} onManual={draft => {
      const now = Date.now();
      beginWork({ id: crypto.randomUUID(), source: "manual", originalText: draft, finalText: draft,
        createdAt: now, updatedAt: now });
    }} />;
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
      {previewUrls[run.sourceAssetId] && <img src={previewUrls[run.sourceAssetId]} alt="本次参考照片" style={{ maxWidth: 180, maxHeight: 120, objectFit: "contain" }} />}
      <p>{run.plan.steps[0].durationSec} 秒 · 将加入 {project.document.episodes.find(item => item.id === run.episodeId)?.title} · 消耗 1 次演示额度</p>
      <small>当前使用输入校验计划，尚未启用模型规划。</small>
      <Button variant="secondary" onClick={() => setView("idea-prepare")}>返回修改</Button>
      <Button onClick={() => void approve()} disabled={busy}>确认并开始生成</Button>
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
  const workSetupPage = workBrief && workSelection ? <WorkSetup brief={workBrief} projects={workProjects} canvasAvailable={!phoneViewport}
    selection={workSelection} onChange={setWorkSelection}
    onFinalTextChange={finalText => setWorkBrief(current => current && { ...current, finalText, updatedAt: Date.now() })}
    onSubmit={submitWork} onBack={() => setView("home")} busy={workBusy}
    projectsLoading={workSelection.target === "existing" && workProjectLoading}
    projectsError={workSelection.target === "existing" && workError.startsWith("读取目标项目失败") ? workError : null}
    onRefreshProjects={() => { setWorkSelection(current => current && { ...current, projectId: "", episodeId: "" }); void loadProjects(); }}
    error={workError} conflict={workConflict} uncertainCreate={Boolean(workCreateAttempt)}
    onNewCreateAttempt={() => { setWorkCreateId(crypto.randomUUID()); setWorkEpisodeId(crypto.randomUUID()); setWorkCreateAttempt(null); setWorkError(""); }}
    onViewCurrent={() => { if (workSelection.projectId) void openProject(workSelection.projectId); else setView("projects"); }}
    onKeepDraft={() => setView("home")} /> : null;
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
      <label className="wide">最终镜头提示词<textarea aria-label="最终镜头提示词" value={input} onChange={event => setInput(event.target.value)} /></label>
      {countUnicodeCharacters(input) > 2000 && <p role="alert">单镜头提示词最多 2000 字，请返回作品设置选择画布或缩短内容。</p>}
      <p>新生成镜头时长：5 秒</p>
      <div className="wide web-idea-prep-actions"><Button disabled={busy || !project || !episodeId || !sourceAssetId || !input.trim() || countUnicodeCharacters(input) > 2000} onClick={() => {
        if (!project || !episodeId || !sourceAssetId || !input.trim() || countUnicodeCharacters(input) > 2000) { setError("请先选择项目、分集、照片并填写 1–2000 字的镜头提示词"); return; }
        setError(""); setView("generate"); void plan(sourceAssetId, input);
      }}>检查镜头计划</Button><Button variant="secondary" onClick={() => setView("work-setup")}>返回作品设置</Button></div>
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
        : asset.kind === "voice" || asset.kind === "music" ? <audio src={`/api/objects/${asset.id}`} controls />
          : <video src={`/api/objects/${asset.id}`} controls />}
      <strong>{asset.name ?? asset.id}</strong><small>{asset.kind === "image" ? "参考照片"
        : asset.kind === "voice" ? "配音录音" : asset.kind === "music" ? "背景音乐" : "视频素材"}</small>
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
      <StudioShell mobileNavigation={phoneViewport} active={view === "projects" || view === "work-setup" || view === "idea-prepare" ? null : view === "edit" ? "results" : view} onNavigate={navigate}
        projectTitle={project ? `${activeEpisode?.title ?? "第 1 集"} · ${project.title}` : undefined}
        footer={<div className="web-account-controls"><span title={account.email}>{account.email}</span><div><ThemeToggle />
          <button type="button" aria-label="退出登录" onClick={() => void logout()}><StudioIcon name="arrowRight" size={16} /><span>退出登录</span></button></div></div>}>
      {view === "projects" ? projectLibrary : view === "work-setup" ? workSetupPage : view === "idea-prepare" ? ideaPreparePage
        : view === "home" ? homePage : !project || !manifest ? projectRequiredPage(view === "edit" ? "results" : view)
        : view === "assets" ? assetsPage : view === "generate" ? <GeneratePage key={project.id} manifest={manifest} previewUrls={previewUrls}
        busy={busy} saveState={busy ? "saving" : "saved"} statusSlot={runPanel} showSidebar={false}
        initialSourceAssetId={sourceAssetId} initialPrompt={input}
        onImportPhoto={pickPhoto}
        onGenerate={(photo, prompt) => plan(photo, prompt)}
        onRefresh={refreshRun}
        onAddToCanvas={() => setView("canvas")} onEditVideo={hasVideoEdit ? job => void openEdit(job.shotId) : undefined}
        onOpenCanvas={() => setView("canvas")} onOpenEditor={() => setShowAssets(true)}
        onOpenProjects={() => setView("projects")} />
      : view === "results" ? <ResultsPage results={results} episodeTitle={activeEpisode?.title} storageLabel="已保存云端"
        onGenerate={() => setView("generate")}
        onEdit={hasVideoEdit ? result => void openEdit(manifest.jobs.find(job => job.id === result.id)?.shotId ?? result.id) : undefined}
        onAddToTimeline={result => { const assetId = manifest.jobs.find(job => job.id === result.id)?.outputAssetId; if (assetId) { addCanvasTimeline(assetId); setView("canvas"); } }}
        onRefresh={result => { void refreshRun(result.id); }} />
      : view === "edit" && edit ? <div className="web-edit-shell"><VideoEditor edit={edit}
        sourceUrl={`/api/objects/${edit.sourceAssetId}`}
        currentUrl={edit.currentOutputId ? `/api/objects/${edit.currentOutputId}` : undefined}
        render={render} onCommand={editCommand} onRender={renderEdit} onUseInTimeline={useEditInTimeline}
        voiceoverSlot={<VoiceoverWorkflow accountId={account.id} projectId={project.id} scope="shot" targetId={edit.id}
          targetRevision={edit.recipe.revision}
          durationMs={edit.recipe.trimEndMs - edit.recipe.trimStartMs}
          audioMix={edit.recipe.version === 2 ? edit.recipe.audioMix : { originalVolume: 1, voiceClips: [], musicClips: [] }}
          voiceAssets={project.document.assets.filter(item => item.kind === "voice" && item.durationMs).map(item => ({
            id: item.id, name: item.name ?? "配音录音", durationMs: item.durationMs!, url: `/api/objects/${item.id}` }))}
          request={api} onUpload={uploadVoice} onTtsAssetReady={ttsAssetReady}
          onPreviewAssetReady={async id => `/api/objects/${id}`}
          onSave={async mix => { await editCommand({ type: "set-audio-mix", ...mix }, edit.recipe.revision); }}
          onExport={() => renderEdit(edit.recipe.revision)}
          exportBusy={render?.state === "pending" || render?.state === "running"} />}
        agentSlot={<AgentEditWorkflow accountId={account.id} projectId={project.id} episodeId={edit.recipe.episodeId}
          targetRevision={edit.recipe.revision}
          context={{ trim: { startMs: edit.recipe.trimStartMs, endMs: edit.recipe.trimEndMs }, captions: edit.recipe.captions,
            voiceAssetId: edit.recipe.version === 2 ? edit.recipe.audioMix.voiceClips[0]?.assetId : null,
            shotIds: activeEpisode?.shots.map(item => item.id),
            shotTitles: Object.fromEntries((activeEpisode?.shots ?? []).map((item, index) => [item.id, `镜头 ${index + 1}`])) }}
          request={api} onApplied={() => refreshAgentApplied(edit.id)} />}
        onClose={() => setView("generate")} /></div>
      : phoneViewport ? <main className="web-mobile-episode" aria-label="手机分集概览">
          <span>EPISODE / 分集概览</span><h1>{activeEpisode?.title ?? "当前分集"}</h1>
          <p>这一集已有 {activeEpisode?.shots.length ?? 0} 个镜头，{manifest.clips.length} 个片段加入时间线。手机上可继续生成、查看结果和微调视频；节点画布请在平板或电脑上编辑。</p>
          <div className="web-mobile-episode-actions"><Button onClick={() => setView("generate")}>继续生成镜头</Button><Button variant="secondary" onClick={() => setView("results")}>查看生成结果</Button></div>
          <section><h2>本集镜头</h2>{activeEpisode?.shots.length ? <ol>{activeEpisode.shots.map((shot, index) => <li key={shot.id}><strong>镜头 {String(index + 1).padStart(2, "0")}</strong><span>{shot.prompt}</span><small>{shot.resultAssetId ? "已生成" : "生成中"} · {shot.durationSec} 秒</small></li>)}</ol>
            : <p>还没有镜头。从创作页上传参考照片，写下第一个场景。</p>}</section>
        </main>
      : <CanvasPage manifest={manifest} episode={manifest.studio!.episodes.find(item => item.id === episodeId)!}
        creationBriefs={creationBriefs(project.document)} onUpdateCreationBrief={updateCreationBrief}
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
        onRefreshJob={refreshRun}
        onAddVideoToTimeline={(_nodeId, assetId) => addCanvasTimeline(assetId)}
        onReorderClip={reorderCanvasClip} onOpenVoiceover={() => setShowEpisodeVoice(true)}
        onExport={() => { void exportCloudEpisode().catch(cause => setError(String(cause))); }} />}
      </StudioShell>
      {showEpisodeVoice && project && activeEpisode && <div className="web-episode-voice-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowEpisodeVoice(false); }}>
        <section className="web-episode-voice-dialog" role="dialog" aria-modal="true" aria-label="本集配音与导出">
          <header><div><small>EPISODE AUDIO</small><h2>{activeEpisode.title} · 配音与导出</h2></div><button type="button" aria-label="关闭本集配音" onClick={() => setShowEpisodeVoice(false)}>×</button></header>
          <VoiceoverWorkflow accountId={account.id} projectId={project.id} scope="episode" targetId={activeEpisode.id}
            targetRevision={resourceRevision(project.resourceRevisions ?? [], "episode", activeEpisode.id)}
            durationMs={cloudTimelineClips(activeEpisode).reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0)}
            audioMix={activeEpisode.audio ?? { originalVolume: 1, voiceClips: [], musicClips: [] }}
            voiceAssets={project.document.assets.filter(item => item.kind === "voice" && item.durationMs).map(item => ({
              id: item.id, name: item.name ?? "配音录音", durationMs: item.durationMs!, url: `/api/objects/${item.id}` }))}
            request={api} onUpload={uploadVoice} onTtsAssetReady={ttsAssetReady}
            onPreviewAssetReady={async id => `/api/objects/${id}`} onSave={saveEpisodeAudio}
            onExport={exportCloudEpisode} exportBusy={episodeRender?.state === "pending" || episodeRender?.state === "running"} />
          <AgentEditWorkflow accountId={account.id} projectId={project.id} episodeId={activeEpisode.id}
            targetRevision={resourceRevision(project.resourceRevisions ?? [], "episode", activeEpisode.id)}
            context={{ shotIds: activeEpisode.shots.map(item => item.id),
              shotTitles: Object.fromEntries(activeEpisode.shots.map((item, index) => [item.id, `镜头 ${index + 1}`])) }}
            request={api} onApplied={() => refreshAgentApplied()} />
          {episodeRender && <div className="web-episode-render-status" role="status">整集导出：{episodeRender.state}{episodeRender.error ? ` · ${episodeRender.error}` : ""}
            {episodeRender.state === "succeeded" && episodeRender.outputAssetId && <video controls preload="metadata" src={`/api/objects/${episodeRender.outputAssetId}`} aria-label="整集成片" />}</div>}
        </section>
      </div>}
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
        onChange={event => { const file = event.target.files?.[0]; const inputElement = event.currentTarget;
          const resolver = uploadResolver.current, generation = uploadPickerGeneration.current, scope = scopeForAccount();
          void upload(file).then(id => {
          if (scopeIsCurrent(scope) && uploadPickerGeneration.current === generation && uploadResolver.current === resolver) {
            resolver?.(id); uploadResolver.current = null; inputElement.value = "";
          }
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
