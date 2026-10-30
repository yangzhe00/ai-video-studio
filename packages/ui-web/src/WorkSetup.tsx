import { useState } from "react";
import type { CreationBrief } from "@ai-video/project-core";
import { countUnicodeCharacters } from "@ai-video/project-core";

export type WorkMode = "direct" | "canvas";
export interface WorkProjectChoice {
  id: string;
  title: string;
  scope?: "cloud" | "local";
  episodes: { id: string; title: string }[];
}
export interface WorkSetupSelection {
  target: "new" | "existing";
  title: string;
  projectId: string;
  episodeId: string;
  mode: WorkMode | null;
  manualSingleShotConfirmed: boolean;
}

export function suggestedProjectTitle(text: string): string {
  return Array.from(text.trim().replace(/\s+/g, " ")).slice(0, 20).join("").replace(/[\\/]/g, "-").trim() || "新作品";
}

export function validProjectTitle(title: string): boolean {
  const clean = title.trim();
  return Boolean(clean && clean !== "." && clean !== ".." && !/[\\/]/.test(clean) && countUnicodeCharacters(clean) <= 50);
}

interface Props {
  brief: CreationBrief;
  projects: WorkProjectChoice[];
  selection: WorkSetupSelection;
  onChange: (next: WorkSetupSelection) => void;
  onFinalTextChange: (text: string) => void;
  onSubmit: () => void | Promise<void>;
  onBack: () => void;
  onRefreshProjects?: () => void;
  onBrowseExisting?: () => void;
  onViewCurrent?: () => void;
  onKeepDraft?: () => void;
  busy?: boolean;
  projectsLoading?: boolean;
  projectsError?: string | null;
  error?: string | null;
  conflict?: boolean;
  uncertainCreate?: boolean;
  onNewCreateAttempt?: () => void;
  canvasAvailable?: boolean;
}

export function WorkSetup({ brief, projects, selection, onChange, onFinalTextChange, onSubmit, onBack,
  onRefreshProjects, onBrowseExisting, onViewCurrent, onKeepDraft, busy = false, projectsLoading = false,
  projectsError, error, conflict = false, uncertainCreate = false, onNewCreateAttempt, canvasAvailable = true }: Props) {
  const [search, setSearch] = useState("");
  const selectedProject = projects.find(item => item.id === selection.projectId);
  const finalLength = countUnicodeCharacters(brief.finalText);
  const directAllowed = finalLength > 0 && finalLength <= 2000;
  const titleOkay = validProjectTitle(selection.title);
  const targetOkay = selection.target === "new" ? titleOkay
    : Boolean(selectedProject && selectedProject.episodes.some(item => item.id === selection.episodeId));
  const canSubmit = !busy && !projectsLoading && !projectsError && targetOkay && Boolean(selection.mode)
    && (canvasAvailable || selection.mode !== "canvas")
    && finalLength > 0 && finalLength <= 10000
    && (selection.mode !== "direct" || directAllowed && (brief.source !== "manual" || selection.manualSingleShotConfirmed));
  const filtered = projects.filter(item => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <main className="avs-work-setup" aria-label="开始这个作品">
    <header><span>WORK SETUP / 作品设置</span><h1>开始这个作品</h1>
      <p>先选项目归属和制作方式。此步骤只保存创作原文，不会提交视频任务。</p></header>
    <section className="avs-work-setup-summary"><h2>创作内容</h2>
      <p><strong>输入原文</strong><span>{brief.originalText}</span></p>
      <label htmlFor="avs-work-final">最终创作内容</label>
      {brief.source === "manual" ? <textarea id="avs-work-final" aria-label="最终创作内容" value={brief.finalText}
        onChange={event => onFinalTextChange(event.target.value)} />
        : <div className="avs-work-final-readonly" role="textbox" aria-label="最终创作内容" aria-readonly="true">{brief.finalText}</div>}
      <small>{brief.source === "agent" ? "来自已选 Agent 灵感；返回首页可修改选定版本。" : "手写内容会按原样保存在项目中。"} {finalLength} / 10000 字</small>
    </section>
    <section className="avs-work-setup-target"><h2>放在哪个项目？</h2>
      <div className="avs-work-setup-choice-row"><button type="button" aria-pressed={selection.target === "new"}
        onClick={() => onChange({ ...selection, target: "new", projectId: "", episodeId: "" })}>新建项目</button>
        <button type="button" aria-pressed={selection.target === "existing"}
          onClick={() => onChange({ ...selection, target: "existing" })}>加入已有项目</button></div>
      {selection.target === "new" ? <label className="avs-work-setup-title">项目名称<input aria-label="项目名称" value={selection.title}
        onChange={event => onChange({ ...selection, title: event.target.value })} placeholder="给这个作品起个名字" />
        {!titleOkay && <small>名称需为 1–50 字，不能是 .、.. 或包含斜杠。</small>}</label>
        : <>{onBrowseExisting && <button type="button" onClick={onBrowseExisting}>选择其他本机项目</button>}
          <input type="search" aria-label="搜索已有项目" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索项目名称" />
          {projectsLoading && <p role="status">正在加载项目</p>}
          {projectsError && <p role="alert">项目列表加载失败：{projectsError} {onRefreshProjects && <button type="button" onClick={onRefreshProjects}>重试加载</button>}</p>}
          <div className="avs-work-setup-projects">{filtered.map(item => <button type="button" key={item.id}
            aria-pressed={selection.projectId === item.id} onClick={() => onChange({ ...selection, projectId: item.id, episodeId: item.episodes[0]?.id ?? "" })}>
            <strong>{item.title}</strong><small>{item.scope === "local" ? "本机项目" : "云端项目"} · {item.episodes.length} 个分集</small></button>)}</div>
          {!projectsLoading && !projectsError && filtered.length === 0 && <p>{search ? "没有找到项目" : "还没有可加入的项目"}</p>}
          {selectedProject && <label>目标分集<select aria-label="目标分集" value={selection.episodeId}
            onChange={event => onChange({ ...selection, episodeId: event.target.value })}>
            {selectedProject.episodes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          {selectedProject && selectedProject.episodes.length === 0 && <p role="alert">这个项目还没有分集，请先在项目中创建分集。</p>}
        </>}
    </section>
    <section className="avs-work-setup-mode"><h2>准备怎么制作？</h2>
      <div className="avs-work-setup-choice-row"><button type="button" aria-pressed={selection.mode === "direct"}
        disabled={!directAllowed} onClick={() => onChange({ ...selection, mode: "direct" })}>直接生成一个镜头</button>
        {canvasAvailable && <button type="button" aria-pressed={selection.mode === "canvas"}
          onClick={() => onChange({ ...selection, mode: "canvas", manualSingleShotConfirmed: false })}>进入画布编排</button>}</div>
      {!canvasAvailable && <p>手机端可直接生成镜头；画布编排请在平板或电脑上继续。</p>}
      {!directAllowed && <p>超过 2000 字不能直接作为单镜头提示词。请缩短内容，或进入画布手动拆镜。</p>}
      {selection.mode === "direct" && brief.source === "manual" && <label className="avs-work-setup-confirm"><input type="checkbox"
        checked={selection.manualSingleShotConfirmed} onChange={event => onChange({ ...selection, manualSingleShotConfirmed: event.target.checked })} />
        我确认这是一段单镜头描述</label>}
    </section>
    {(error || finalLength > 10000) && <p role="alert" className="avs-work-setup-error">{error || "内容超过 10000 字，请缩短后继续"}</p>}
    {conflict && <div className="avs-work-setup-conflict"><p>项目内容已在另一端更新，请查看当前版本后再决定。</p>
      {onViewCurrent && <button type="button" onClick={onViewCurrent}>查看当前版本</button>}
      {onKeepDraft && <button type="button" onClick={onKeepDraft}>保留草稿返回</button>}</div>}
    <footer><button type="button" onClick={onBack} disabled={busy}>返回修改内容</button>
      {uncertainCreate && selection.target === "new" && onNewCreateAttempt && <button type="button" onClick={onNewCreateAttempt} disabled={busy}>另起新项目</button>}
      <button type="button" className="primary" onClick={() => void onSubmit()} disabled={!canSubmit}>
        {busy ? "正在保存…" : uncertainCreate && selection.target === "new" ? "查询原项目" : selection.target === "new" ? "创建项目并继续" : "加入项目并继续"}</button></footer>
  </main>;
}
