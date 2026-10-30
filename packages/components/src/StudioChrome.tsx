import { useEffect, useState } from "react";
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

export function StudioSidebar({ active, onNavigate, projectTitle, footer, mobileOpen = false, id }: {
  active: StudioSection | null; onNavigate: (section: StudioSection) => void; projectTitle?: string; footer?: ReactNode;
  mobileOpen?: boolean; id?: string;
}) {
  return <aside id={id} className={`avs-studio-sidebar${mobileOpen ? " avs-studio-sidebar--open" : ""}`}
    aria-label="主导航" aria-hidden={id && !mobileOpen ? true : undefined}>
    <div className="avs-studio-brand"><span aria-hidden="true">✦</span><strong>AI Video Studio</strong></div>
    <nav>{navigation.map(item => <button type="button" key={item.id} className={active === item.id ? "active" : ""}
      aria-current={active === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}>
      <StudioIcon name={item.icon} size={18} />{item.label}</button>)}</nav>
    {projectTitle && <div className="avs-sidebar-project"><small>最近项目</small><button type="button" onClick={() => onNavigate("canvas")}><StudioIcon name="film" size={16} /><span>{projectTitle}</span></button></div>}
    {footer && <div className="avs-sidebar-footer">{footer}</div>}
  </aside>;
}

export function StudioShell({ active, onNavigate, projectTitle, footer, children, mobileNavigation = false }: {
  active: StudioSection | null; onNavigate: (section: StudioSection) => void; projectTitle?: string; footer?: ReactNode;
  children: ReactNode; mobileNavigation?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  const navigate = (section: StudioSection) => { setMenuOpen(false); onNavigate(section); };
  return <div className={`avs-studio-shell${mobileNavigation ? " avs-studio-shell--h5" : ""}`}>
    {mobileNavigation && <header className="avs-mobile-header"><strong><span aria-hidden="true">✦</span> AI Video Studio</strong>
      <button type="button" aria-label="打开账号与项目菜单" aria-expanded={menuOpen} aria-controls="avs-mobile-sidebar"
        onClick={() => setMenuOpen(open => !open)}><StudioIcon name="more" size={20} /><span>菜单</span></button></header>}
    {mobileNavigation && menuOpen && <button type="button" className="avs-mobile-scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}
    <StudioSidebar id={mobileNavigation ? "avs-mobile-sidebar" : undefined} active={active} onNavigate={navigate}
      projectTitle={projectTitle} footer={footer} mobileOpen={menuOpen} />
    <div className="avs-studio-stage">{children}</div>
    {mobileNavigation && <nav className="avs-mobile-nav" aria-label="手机主导航">{navigation.map(item => <button type="button" key={item.id}
      className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined}
      onClick={() => navigate(item.id)}><StudioIcon name={item.icon} size={20} /><span>{item.label}</span></button>)}</nav>}
  </div>;
}
