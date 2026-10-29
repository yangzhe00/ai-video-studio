import { useEffect, useState } from "react";
import type { OpenProject } from "@ai-video/project-core";
import { ensureStudio } from "@ai-video/project-core";
import { PromptIdeas, ThemeProvider, ThemeToggle, pendingPromptRequestId } from "@ai-video/ui-web";
import type { PromptIdeaSet } from "@ai-video/ui-web";
import { ProjectHome, StudioShell, StudioTitleBar } from "@ai-video/components";
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
  const [incomingPrompt, setIncomingPrompt] = useState<{ id: string; prompt: string } | null>(null);

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

  const ideaSlot = account ? <PromptIdeas requestScope={`desktop:${account.id}`} ideaSet={ideaSet} recentSets={recentIdeas} busy={ideaBusy} error={ideaError}
    onRequest={requestIdeas} onReload={reloadIdea} onSelect={selectIdea}
    onContinue={saved => {
      const prompt = saved.editedPrompt ?? saved.variants.find(item => item.id === saved.selectedVariantId)?.prompt;
      if (!prompt) return;
      setIncomingPrompt({ id: saved.id, prompt });
      if (!project) setProjectDialog(true);
    }} onManual={!project ? () => setProjectDialog(true) : undefined} />
    : <p className="film-idea-login-note">登录云端账号后，可以用一句话获取三种镜头灵感。本地项目仍可离线编辑。</p>;

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
        <StudioTitleBar native onHome={() => setProjectDialog(true)} tabs={[]} actions={<><CloudAccountControl account={account} onChange={setAccount} /><ThemeToggle /></>} />
        <StudioShell active="home" onNavigate={() => setProjectDialog(true)}>
          <ProjectHome onCreate={() => setProjectDialog(true)} ideaSlot={ideaSlot}>
            <ProjectPicker onOpen={openProject} account={account} restoreError={restoreError} />
          </ProjectHome>
        </StudioShell>
      </div>}
    {projectDialog && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProjectDialog(false); }}>
      <div className="film-modal" role="dialog" aria-modal="true" aria-label="选择项目">
        <div className="film-modal-title"><strong>{incomingPrompt ? "选择项目继续这条灵感" : "切换项目"}</strong><button type="button" onClick={() => setProjectDialog(false)} aria-label="关闭"><StudioIcon name="x" size={18} /></button></div>
        {incomingPrompt && <p className="film-idea-handoff">已选提示词：{incomingPrompt.prompt}</p>}
        <ProjectPicker onOpen={openProject} account={account} compact />
      </div>
    </div>}
  </>;
}
