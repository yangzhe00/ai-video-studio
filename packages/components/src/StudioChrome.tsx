import type { ReactNode } from "react";
import { StudioIcon } from "@ai-video/ui-web";

export type StudioSection = "home" | "generate" | "canvas" | "results" | "assets";

interface TitleTab { id: string; label: string; active?: boolean; onClick: () => void }

export function StudioTitleBar({ tabs, onHome, actions, native = false }: {
  tabs: TitleTab[]; onHome: () => void; actions?: ReactNode; native?: boolean;
}) {
  return <header className="avs-titlebar" data-tauri-drag-region={native ? "" : undefined}>
    <span className="avs-window-lights" aria-hidden="true"><i /><i /><i /></span>
    <button type="button" onClick={onHome}><StudioIcon name="home" size={16} />首页</button>
    <span className="avs-titlebar-divider" />
    {tabs.map(tab => <button key={tab.id} type="button" className={tab.active ? "active" : ""}
      aria-current={tab.active ? "page" : undefined} onClick={tab.onClick} title={tab.label}>{tab.label}</button>)}
    <span className="avs-titlebar-spacer" />{actions}
  </header>;
}

const navigation: { id: StudioSection; label: string; icon: "home" | "sparkles" | "share" | "clapper" | "folder" }[] = [
  { id: "home", label: "首页", icon: "home" },
  { id: "generate", label: "创作", icon: "sparkles" },
  { id: "canvas", label: "画布", icon: "share" },
  { id: "results", label: "结果", icon: "clapper" },
  { id: "assets", label: "资产", icon: "folder" },
];

export function StudioSidebar({ active, onNavigate, projectTitle, footer }: {
  active: StudioSection | null; onNavigate: (section: StudioSection) => void; projectTitle?: string; footer?: ReactNode;
}) {
  return <aside className="avs-studio-sidebar" aria-label="主导航">
    <div className="avs-studio-brand"><span aria-hidden="true">✦</span><strong>AI Video Studio</strong></div>
    <nav>{navigation.map(item => <button type="button" key={item.id} className={active === item.id ? "active" : ""}
      aria-current={active === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}>
      <StudioIcon name={item.icon} size={18} />{item.label}</button>)}</nav>
    {projectTitle && <div className="avs-sidebar-project"><small>最近项目</small><button type="button" onClick={() => onNavigate("canvas")}><StudioIcon name="film" size={16} /><span>{projectTitle}</span></button></div>}
    {footer && <div className="avs-sidebar-footer">{footer}</div>}
  </aside>;
}

export function StudioShell({ active, onNavigate, projectTitle, footer, children }: {
  active: StudioSection | null; onNavigate: (section: StudioSection) => void; projectTitle?: string; footer?: ReactNode; children: ReactNode;
}) {
  return <div className="avs-studio-shell"><StudioSidebar active={active} onNavigate={onNavigate} projectTitle={projectTitle} footer={footer} />
    <div className="avs-studio-stage">{children}</div></div>;
}
