import { useEffect, useState } from "react";
import type { OpenProject } from "@ai-video/project-core";
import { Button, StatusBadge } from "@ai-video/ui-web";
import { ProjectPicker } from "./features/projects/ProjectPicker";
import { ProjectWorkspace } from "./features/workspace/ProjectWorkspace";
import { desktopPorts } from "./lib/ports";
import "./App.css";
import "./Editor.css";

const LAST_PROJECT_KEY = "ai-video-studio:last-project-root";

export default function App() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const [projectRevision, setProjectRevision] = useState(0);
  const [restoring, setRestoring] = useState(() => Boolean(localStorage.getItem(LAST_PROJECT_KEY)));
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);

  useEffect(() => {
    const root = localStorage.getItem(LAST_PROJECT_KEY);
    if (!root) return;
    let live = true;
    void desktopPorts.projects.open(root).then(manifest => {
      if (live) setProject({ root, manifest });
    }).catch(() => {
      if (!live) return;
      localStorage.removeItem(LAST_PROJECT_KEY);
      setRestoreError("上次的项目文件夹无法打开，请重新选择项目。");
    }).finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, []);

  function openProject(next: OpenProject) {
    localStorage.setItem(LAST_PROJECT_KEY, next.root);
    setProject(next);
    setProjectRevision(current => current + 1);
    setProjectDialog(false);
    setRestoreError(null);
  }

  return <div className="studio-shell">
    <header className="studio-topbar">
      <div className="studio-brand"><span className="studio-brand-mark" aria-hidden="true">✦</span><strong>AI Video Studio</strong></div>
      <span className="studio-separator" aria-hidden="true" />
      <div className="studio-project-label"><span>当前项目</span><strong>{project?.manifest.title ?? "未打开项目"}</strong></div>
      <div className="studio-toolbar-actions">
        <StatusBadge>{project ? "本地项目" : "未选择项目"}</StatusBadge>
        <Button variant="ghost" onClick={() => setProjectDialog(true)}>新建或打开</Button>
      </div>
    </header>
    {restoring ? <div className="studio-loading" role="status">正在打开上次的项目…</div>
      : project ? <ProjectWorkspace key={`${project.root}:${projectRevision}`} project={project} />
        : <div className="studio-empty"><div className="studio-empty-pane">素材库</div><div className="studio-empty-preview"><div className="studio-empty-frame" /></div><div className="studio-empty-pane">属性</div><div className="studio-empty-timeline">故事板　　时间线</div><ProjectPicker onOpen={openProject} restoreError={restoreError} /></div>}
    {project && projectDialog && <div className="studio-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProjectDialog(false); }}>
      <div className="studio-dialog" role="dialog" aria-modal="true" aria-label="选择项目">
        <div className="studio-dialog-heading"><strong>切换项目</strong><Button variant="ghost" aria-label="关闭" onClick={() => setProjectDialog(false)}>✕</Button></div>
        <ProjectPicker onOpen={openProject} compact />
      </div>
    </div>}
  </div>;
}
