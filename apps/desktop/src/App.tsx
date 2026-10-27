import { useState } from "react";
import { ProjectHome } from "./features/projects/ProjectHome";
import { ProjectWorkspace } from "./features/workspace/ProjectWorkspace";
import type { OpenProject } from "@ai-video/project-core";
import { hasDesktopFeature } from "./lib/plugins";
import "./App.css";

export default function App() {
  const [project, setProject] = useState<OpenProject | null>(null);

  return <div className="app-shell">
    <aside className="sidebar" aria-label="主导航">
      <div className="brand"><div className="brand-mark" aria-hidden="true">✦</div><div><strong>AI Video Studio</strong><span>创作工作台</span></div></div>
      <nav className="side-nav" aria-label="工作区"><span className="nav-section-label">工作区</span><button type="button" className="nav-item active" onClick={() => setProject(null)}><span aria-hidden="true">▦</span> 项目</button>{hasDesktopFeature("media") && <button type="button" className="nav-item" disabled={!project} onClick={() => document.getElementById("media-library")?.scrollIntoView({ behavior: "smooth" })}><span aria-hidden="true">▤</span> 素材库</button>}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> 本地创作空间</div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">工作区 <span>/</span> {project?.manifest.title ?? "项目"}</div><div className="topbar-tag">macOS · 本地优先</div></header>
      {project ? <ProjectWorkspace project={project} onClose={() => setProject(null)} /> : <ProjectHome onOpen={setProject} />}
    </main>
  </div>;
}
