import { useEffect, useState } from "react";
import type { CreationBrief, OpenProject, ProjectManifestV2 } from "@ai-video/project-core";
import { creationBriefs, ensureStudio, selectEpisode, validateCreationBrief } from "@ai-video/project-core";
import { PromptIdeas, ThemeProvider, ThemeToggle, WorkSetup, pendingPromptRequestId, suggestedProjectTitle } from "@ai-video/ui-web";
import type { PromptIdeaSet, WorkProjectChoice, WorkSetupSelection } from "@ai-video/ui-web";
import { ProjectHome, StudioShell, StudioTitleBar } from "@ai-video/components";
import type { StudioSection } from "@ai-video/components";
import { ProjectPicker } from "./features/projects/ProjectPicker";
import { StudioWorkspace } from "./features/studio/StudioWorkspace";
import { StudioIcon } from "@ai-video/ui-web";
import { desktopPorts } from "./lib/ports";
import { cloudRequest } from "./lib/cloud";
import type { CloudAccount } from "./lib/cloud";
import { CloudAccountControl } from "./features/account/CloudAccountControl";
import "./App.css";
import "./Editor.css";

const LAST_PROJECT_KEY = "ai-video-studio:last-project-root";
const PENDING_LOCAL_CREATE_KEY = "ai-video-studio:pending-local-create";

interface PendingLocalCreate { version: 1; root: string; title: string; brief: CreationBrief }

function pendingLocalCreate(): PendingLocalCreate | null {
  try {
    const raw = localStorage.getItem(PENDING_LOCAL_CREATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingLocalCreate>;
    if (value.version !== 1 || typeof value.root !== "string" || !value.root ||
        typeof value.title !== "string" || !value.title || !value.brief) return null;
    return { version: 1, root: value.root, title: value.title, brief: validateCreationBrief(value.brief) };
  } catch { return null; }
}

function sameCreationContent(saved: CreationBrief, draft: CreationBrief): boolean {
  return saved.source === draft.source && saved.originalText === draft.originalText &&
    saved.finalText === draft.finalText && saved.ideaSetId === draft.ideaSetId &&
    saved.variantId === draft.variantId;
}

function samePendingBrief(saved: CreationBrief, pending: CreationBrief): boolean {
  return saved.id === pending.id && sameCreationContent(saved, pending) &&
    saved.createdAt === pending.createdAt && saved.updatedAt === pending.updatedAt;
}

function matchingPendingProject(manifest: ProjectManifestV2, intent: PendingLocalCreate): CreationBrief | null {
  const briefs = creationBriefs(manifest);
  return manifest.title === intent.title && briefs.length === 1 && samePendingBrief(briefs[0], intent.brief)
    ? briefs[0] : null;
}

export default function App() { return <ThemeProvider><AppContent /></ThemeProvider>; }

function AppContent() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const [projectRevision, setProjectRevision] = useState(0);
  const [restoring, setRestoring] = useState(() => Boolean(localStorage.getItem(LAST_PROJECT_KEY)));
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [ideaSet, setIdeaSet] = useState<PromptIdeaSet | null>(null);
  const [recentIdeas, setRecentIdeas] = useState<PromptIdeaSet[]>([]);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaError, setIdeaError] = useState("");
  const [incomingPrompt, setIncomingPrompt] = useState<{ id: string; prompt: string; mode: "direct" | "canvas" } | null>(null);
  const [workBrief, setWorkBrief] = useState<CreationBrief | null>(null);
  const [workSelection, setWorkSelection] = useState<WorkSetupSelection | null>(null);
  const [workProjectCandidate, setWorkProjectCandidate] = useState<OpenProject | null>(null);
  const [workError, setWorkError] = useState("");
  const [workBusy, setWorkBusy] = useState(false);
  const [workLocalCreate, setWorkLocalCreate] = useState<{ root: string; title: string } | null>(null);
  const [browseWorkProject, setBrowseWorkProject] = useState(false);
  const [noProjectView, setNoProjectView] = useState<StudioSection>("home");

  useEffect(() => { void cloudRequest<{ account: CloudAccount }>("/auth/me").then(result => setAccount(result.account)).catch(() => {}); }, []);

  useEffect(() => {
    if (!account) { setIdeaSet(null); setRecentIdeas([]); return; }
    void cloudRequest<{ ideaSets: PromptIdeaSet[] }>("/prompt-ideas").then(result => {
      const pendingId = pendingPromptRequestId(`desktop:${account.id}`);
      setRecentIdeas(result.ideaSets);
      setIdeaSet(result.ideaSets.find(item => item.clientRequestId === pendingId) ?? result.ideaSets[0] ?? null);
    }).catch(error => setIdeaError(String(error)));
  }, [account?.id]);

  useEffect(() => {
    if (ideaSet?.state !== "pending") return;
    const id = ideaSet.id;
    const timer = window.setInterval(() => { void reloadIdea(id); }, 3000);
    return () => window.clearInterval(timer);
  }, [ideaSet?.id, ideaSet?.state]);

  async function requestIdeas(input: string, clientRequestId: string) {
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await cloudRequest<{ ideaSet: PromptIdeaSet }>("/prompt-ideas", "POST", { clientRequestId, input })).ideaSet;
      setIdeaSet(next); setRecentIdeas(current => [next, ...current.filter(item => item.id !== next.id)]);
    } catch (error) { setIdeaError(String(error)); }
    finally { setIdeaBusy(false); }
  }

  async function reloadIdea(id: string) {
    setIdeaBusy(true); setIdeaError("");
    try { setIdeaSet((await cloudRequest<{ ideaSet: PromptIdeaSet }>(`/prompt-ideas/${id}`)).ideaSet); }
    catch (error) { setIdeaError(String(error)); }
    finally { setIdeaBusy(false); }
  }

  async function selectIdea(id: string, variantId: string, editedPrompt: string) {
    setIdeaBusy(true); setIdeaError("");
    try {
      const next = (await cloudRequest<{ ideaSet: PromptIdeaSet }>(`/prompt-ideas/${id}/selection`, "POST", { variantId, editedPrompt })).ideaSet;
      setIdeaSet(next); setRecentIdeas(current => [next, ...current.filter(item => item.id !== next.id)]);
      return next;
    } catch (error) { setIdeaError(String(error)); throw error; }
    finally { setIdeaBusy(false); }
  }

  function beginWork(brief: CreationBrief) {
    const pending = pendingLocalCreate();
    const resumed = pending && sameCreationContent(pending.brief, brief) ? pending : null;
    setWorkBrief(resumed?.brief ?? brief);
    setWorkSelection({ target: "new", title: resumed?.title ?? suggestedProjectTitle(brief.finalText), projectId: "", episodeId: "",
      mode: null, manualSingleShotConfirmed: false });
    setWorkProjectCandidate(null); setWorkLocalCreate(resumed ? { root: resumed.root, title: resumed.title } : null); setWorkError("");
  }

  const ideaSlot = <PromptIdeas requestScope={`desktop:${account?.id ?? "anonymous"}`} ideaSet={ideaSet} recentSets={recentIdeas} busy={ideaBusy} error={ideaError}
    agentEnabled={Boolean(account)} agentUnavailableReason="登录后可让 Agent 提供方向；自己的内容可离线开始。"
    onRequest={requestIdeas} onReload={reloadIdea} onSelect={selectIdea}
    onContinue={saved => {
      const prompt = saved.editedPrompt ?? saved.variants.find(item => item.id === saved.selectedVariantId)?.prompt;
      if (!prompt || !saved.selectedVariantId) return;
      const now = Date.now();
      beginWork({ id: crypto.randomUUID(), source: "agent", originalText: saved.input, finalText: prompt,
        ideaSetId: saved.id, variantId: saved.selectedVariantId, createdAt: now, updatedAt: now });
    }} onManual={draft => {
      const now = Date.now();
      beginWork({ id: crypto.randomUUID(), source: "manual", originalText: draft, finalText: draft,
        createdAt: now, updatedAt: now });
    }} />;

  const availableProjects: { project: OpenProject; choice: WorkProjectChoice }[] = [project, workProjectCandidate]
    .filter((item): item is OpenProject => Boolean(item))
    .filter((item, index, all) => all.findIndex(other => other.root === item.root) === index)
    .map(item => ({ project: item, choice: { id: item.root, title: item.manifest.title, scope: "local",
      episodes: ensureStudio(item.manifest).studio!.episodes.map(episode => ({ id: episode.id, title: episode.title })) } }));

  async function submitWork() {
    const brief = workBrief, selection = workSelection;
    if (!brief || !selection?.mode || workBusy) return;
    setWorkBusy(true); setWorkError("");
    try {
      let next: OpenProject;
      let openedBrief = brief;
      if (selection.target === "new") {
        const title = selection.title.trim();
        const pending = pendingLocalCreate();
        const resumesPending = pending && pending.title === title && sameCreationContent(pending.brief, brief);
        if (pending && !resumesPending)
          throw new Error("上次本机创建结果待确认，请先恢复原项目，或点击另起新项目");
        if (workLocalCreate && workLocalCreate.title !== title)
          throw new Error("上次本机创建结果待确认，请恢复原项目名称和内容后重试，或另起新项目");
        let root = workLocalCreate?.root ?? (resumesPending ? pending.root : null);
        openedBrief = resumesPending ? pending.brief : brief;
        let created: ProjectManifestV2 | null = null;
        if (root) {
          try { created = ensureStudio(await desktopPorts.projects.open(root)); }
          catch { /* the pending creation may not have reached native storage */ }
          if (created && resumesPending) {
            let matched: CreationBrief | null;
            try { matched = matchingPendingProject(created, pending); } catch { matched = null; }
            if (!matched) throw new Error("本机项目与待恢复的创建意图不一致，请查看后再决定");
            openedBrief = matched;
          }
        }
        if (!created) {
          if (!root) {
            const parent = await desktopPorts.projects.chooseParent();
            if (!parent) return;
            root = `${parent.replace(/\/$/, "")}/${title}`;
          }
          const intent: PendingLocalCreate = { version: 1, root, title, brief: openedBrief };
          localStorage.setItem(PENDING_LOCAL_CREATE_KEY, JSON.stringify(intent));
          try { created = ensureStudio(await desktopPorts.projects.create(root, title, openedBrief)); }
          catch (createError) {
            let disk: ProjectManifestV2;
            let matched: CreationBrief | null;
            try {
              disk = ensureStudio(await desktopPorts.projects.open(root));
              const persisted = pendingLocalCreate();
              matched = persisted && persisted.root === root && persisted.title === title &&
                samePendingBrief(persisted.brief, intent.brief) ? matchingPendingProject(disk, persisted) : null;
            }
            catch { throw createError; }
            if (!matched) throw createError;
            created = disk;
            openedBrief = matched;
          }
          setWorkLocalCreate({ root, title });
        }
        if (!root) throw new Error("请选择项目保存位置");
        if (created.title !== title) throw new Error("本机项目名称与创建意图不一致，请查看后再决定");
        const old = creationBriefs(created);
        const match = old.find(item => item.id === openedBrief.id);
        if (match && JSON.stringify(match) !== JSON.stringify(openedBrief)) throw new Error("本机项目已有不同版本的创作原文，请查看后再决定");
        if (!match && old.length) throw new Error("本机项目已有其他创作原文，请查看后再决定");
        const manifest = match ? created : { ...created, extensions: { ...created.extensions, creationBriefs: [openedBrief] } };
        await desktopPorts.projects.save(root, manifest);
        next = { root, manifest };
      } else {
        const selected = availableProjects.find(item => item.choice.id === selection.projectId)?.project;
        if (!selected || !selection.episodeId) throw new Error("请先选择已有项目和分集");
        const latest = ensureStudio(await desktopPorts.projects.open(selected.root));
        const old = creationBriefs(latest);
        const match = old.find(item => item.id === brief.id);
        if (match && JSON.stringify(match) !== JSON.stringify(brief)) throw new Error("本机项目已有不同版本的创作原文，请查看后再决定");
        const withBrief = match ? latest : { ...latest, extensions: { ...latest.extensions, creationBriefs: [...old, brief] } };
        const manifest = selectEpisode(withBrief, selection.episodeId);
        await desktopPorts.projects.save(selected.root, manifest);
        next = { root: selected.root, manifest };
      }
      openProject(next);
      if (selection.target === "new") {
        const completed = pendingLocalCreate();
        if (completed?.root === next.root && completed.brief.id === openedBrief.id)
          localStorage.removeItem(PENDING_LOCAL_CREATE_KEY);
      }
      setIncomingPrompt({ id: openedBrief.id, prompt: selection.mode === "direct" ? openedBrief.finalText : "", mode: selection.mode });
      setWorkBrief(null); setWorkSelection(null); setWorkProjectCandidate(null); setWorkLocalCreate(null);
    } catch (cause) { setWorkError(String(cause)); }
    finally { setWorkBusy(false); }
  }

  const workSetup = workBrief && workSelection ? <WorkSetup brief={workBrief} selection={workSelection}
    projects={availableProjects.map(item => item.choice)} onChange={setWorkSelection}
    onFinalTextChange={finalText => setWorkBrief(current => current && { ...current, finalText, updatedAt: Date.now() })}
    onSubmit={submitWork} onBack={() => setWorkBrief(null)} busy={workBusy} error={workError}
    uncertainCreate={Boolean(workLocalCreate || pendingLocalCreate())}
    onNewCreateAttempt={() => {
      localStorage.removeItem(PENDING_LOCAL_CREATE_KEY);
      setWorkLocalCreate(null); setWorkError("");
      setWorkBrief(current => {
        if (!current) return null;
        const now = Date.now();
        return { ...current, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      });
    }}
    onBrowseExisting={() => setBrowseWorkProject(true)} /> : null;
  const sectionLabels: Record<Exclude<StudioSection, "home">, string> = {
    generate: "创作", canvas: "画布", results: "结果", assets: "资产",
  };

  useEffect(() => {
    const root = localStorage.getItem(LAST_PROJECT_KEY);
    if (!root) return;
    let live = true;
    void desktopPorts.projects.open(root).then(manifest => {
      ensureStudio(manifest);
      if (live) setProject({ root, manifest });
    }).catch(error => {
      if (!live) return;
      localStorage.removeItem(LAST_PROJECT_KEY);
      setRestoreError(`上次的项目无法打开：${String(error)}`);
    }).finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, []);

  function openProject(next: OpenProject) {
    ensureStudio(next.manifest);
    localStorage.setItem(LAST_PROJECT_KEY, next.root);
    setProject(next);
    setProjectRevision(current => current + 1);
    setProjectDialog(false);
    setRestoreError(null);
  }

  if (restoring) return <div className="film-app"><StudioTitleBar native onHome={() => {}} tabs={[]} actions={<ThemeToggle />} /><div className="film-loading" role="status">正在打开上次的项目…</div></div>;

  return <>
    {project ? <StudioWorkspace key={`${project.root}:${projectRevision}`} project={project} account={account} onAccountChange={setAccount}
        onOpenProjects={() => setProjectDialog(true)} ideaSlot={ideaSlot} incomingPrompt={incomingPrompt}
        onIdeaConsumed={() => setIncomingPrompt(null)} />
      : <div className="film-app">
        <StudioTitleBar native onHome={() => setNoProjectView("home")} tabs={[]} actions={<><CloudAccountControl account={account} onChange={setAccount} /><ThemeToggle /></>} />
        <StudioShell active={noProjectView === "home" && workSetup ? null : noProjectView} onNavigate={setNoProjectView}>
          {noProjectView !== "home" ? <main className="film-section-empty" aria-label={`${sectionLabels[noProjectView]}空状态`}>
            <h1>{sectionLabels[noProjectView]}需要先打开项目</h1>
            <p>打开已有项目，或返回作品设置创建项目后继续。</p>
            <div>{workSetup && <button type="button" onClick={() => setNoProjectView("home")}>继续作品设置</button>}
              <button type="button" onClick={() => setProjectDialog(true)}>选择已有项目</button>
              <button type="button" onClick={() => setProjectDialog(true)}>新建项目</button></div>
          </main> : workSetup ?? <><ProjectHome onCreate={() => setProjectDialog(true)} ideaSlot={ideaSlot}
            onProjects={() => setProjectDialog(true)} />
            {restoreError && <p className="project-picker-warning" role="alert">{restoreError}</p>}</>}
        </StudioShell>
      </div>}
    {project && workSetup && <div className="film-modal-backdrop"><div className="film-modal film-work-setup-overlay" role="dialog" aria-modal="true" aria-label="开始这个作品">{workSetup}</div></div>}
    {browseWorkProject && <div className="film-modal-backdrop"><div className="film-modal" role="dialog" aria-modal="true" aria-label="选择本机项目"><div className="film-modal-title"><strong>选择已有项目</strong><button type="button" onClick={() => setBrowseWorkProject(false)} aria-label="关闭"><StudioIcon name="x" size={18} /></button></div>
      <ProjectPicker compact account={account} onOpen={next => {
        setWorkProjectCandidate(next); setBrowseWorkProject(false);
        setWorkSelection(current => current && { ...current, target: "existing", projectId: next.root,
          episodeId: ensureStudio(next.manifest).studio!.episodes[0]?.id ?? "" });
      }} /></div></div>}
    {projectDialog && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProjectDialog(false); }}>
      <div className="film-modal" role="dialog" aria-modal="true" aria-label="选择项目">
        <div className="film-modal-title"><strong>切换项目</strong><button type="button" onClick={() => setProjectDialog(false)} aria-label="关闭"><StudioIcon name="x" size={18} /></button></div>
        <ProjectPicker onOpen={openProject} account={account} restoreError={restoreError} compact />
      </div>
    </div>}
  </>;
}
