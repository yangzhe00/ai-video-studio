import type { ReactNode } from "react";
import { StudioIcon } from "@ai-video/ui-web";

export function ProjectHome({ projectTitle, episodeTitle, recentImage, recentMeta, onCreate, onContinue, onCanvas, onProjects, ideaSlot, children }: {
  projectTitle?: string; episodeTitle?: string; recentImage?: string; recentMeta?: string;
  onCreate: () => void; onContinue?: () => void; onCanvas?: () => void; onProjects?: () => void;
  ideaSlot?: ReactNode; children?: ReactNode;
}) {
  const soloIdea = Boolean(ideaSlot && !projectTitle && !children);
  return <main className={ideaSlot ? `avs-project-home avs-project-home--idea-first${soloIdea ? " avs-project-home--solo" : ""}` : "avs-project-home"}>
    <div className="avs-page-meta"><span>首页 / 工作台</span><span>工作台就绪</span></div>
    <div className="avs-home-layout">
      <section className="avs-home-intro"><span className="avs-kicker">THE STORY STARTS HERE</span>
        <h1>把今天的灵感，<br />剪成一部好故事。</h1>
        <p>从一张照片和一句描述开始。Agent 帮你构思镜头，你来决定每一集如何展开。</p>
        {ideaSlot && <div className="avs-home-idea">{ideaSlot}</div>}
        <div className="avs-home-actions"><button type="button" className="primary" onClick={onCreate}><StudioIcon name="plus" size={17} />开始新项目</button>
          {onContinue && <button type="button" onClick={onContinue}>继续创作<StudioIcon name="arrowRight" size={17} /></button>}
          {onProjects && <button type="button" onClick={onProjects}>全部项目<StudioIcon name="arrowRight" size={17} /></button>}</div>
      </section>
      {projectTitle && <section className="avs-home-recent"><small>CONTINUE CREATING</small><h2>最近的一集</h2>
        <div className="avs-home-recent-media">{recentImage && <img src={recentImage} alt="最近分集封面" />}<span>EPISODE 01</span></div>
        <strong>{episodeTitle || projectTitle}</strong><p>{recentMeta || "继续制作你的分集"}</p>
        {onCanvas && <button type="button" onClick={onCanvas}>进入画布 <StudioIcon name="arrowRight" size={14} /></button>}
      </section>}
      {!projectTitle && children && <div className="avs-home-entry">{children}</div>}
    </div>
    {projectTitle && children && <div className="avs-home-projects">{children}</div>}
    <div className="avs-filmstrip" aria-hidden="true"><span /><span /><span /><span /></div>
    <small className="avs-home-caption">MOTION / 胶片横向缓动 · 暖色光晕掠过 · 颗粒轻闪</small>
  </main>;
}
