import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { GenerationJob, MediaAsset, ProjectManifestV2 } from "@ai-video/project-core";
import { StudioIcon } from "./StudioIcon";

type SaveState = "saved" | "saving" | "failed";

interface Props {
  manifest: ProjectManifestV2;
  previewUrls: Record<string, string>;
  busy: boolean;
  saveState: SaveState;
  onImportPhoto: () => Promise<string | null>;
  onGenerate: (sourceAssetId: string, prompt: string, durationSec: number) => Promise<void>;
  onRefresh: (jobId: string) => Promise<void>;
  onAddToCanvas: (job: GenerationJob) => void;
  onEditVideo?: (job: GenerationJob) => void;
  onOpenCanvas: () => void;
  onOpenEditor: () => void;
  onOpenProjects: () => void;
  sidebarContent?: ReactNode;
  statusSlot?: ReactNode;
  topbarActions?: ReactNode;
  initialSourceAssetId?: string;
  initialPrompt?: string;
  showSidebar?: boolean;
}

const jobLabels: Record<GenerationJob["state"], string> = {
  draft: "草稿", submitting: "提交中", queued: "排队中", running: "生成中",
  download_pending: "下载结果中", succeeded: "已完成", failed: "生成失败", unknown: "状态待确认",
};

const promptStarts = [
  ["电影级长镜头", "电影级长镜头，镜头自然跟随主体，"],
  ["创作分镜", "清晰的分镜构图，前景与背景层次分明，"],
  ["风格大师", "富有电影质感的光线与色彩，"],
  ["微表情导演", "捕捉主体细腻自然的表情变化，"],
] as const;

function nameOf(asset: MediaAsset | undefined) {
  return asset?.relativePath.split("/").pop() ?? "未命名视频";
}

export function GeneratePage({
  manifest, previewUrls, busy, saveState, onImportPhoto, onGenerate, onRefresh,
  onAddToCanvas, onEditVideo, onOpenCanvas, onOpenEditor, onOpenProjects,
  sidebarContent, statusSlot, topbarActions, initialSourceAssetId, initialPrompt, showSidebar = true,
}: Props) {
  const images = manifest.assets.filter(asset => asset.kind === "image" && !asset.missing);
  const [sourceAssetId, setSourceAssetId] = useState(initialSourceAssetId ?? images[0]?.id ?? "");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const selectedPhoto = images.find(asset => asset.id === sourceAssetId);
  const jobs = [...manifest.jobs].filter(job => job.provider === "kling").reverse().slice(0, 3);
  const currentEpisode = manifest.studio?.episodes.find(episode => episode.id === manifest.studio?.activeEpisodeId);

  useEffect(() => { if (initialSourceAssetId) setSourceAssetId(initialSourceAssetId); }, [initialSourceAssetId]);
  useEffect(() => { if (initialPrompt !== undefined) setPrompt(initialPrompt); }, [initialPrompt]);

  async function upload() {
    const id = await onImportPhoto();
    if (id) setSourceAssetId(id);
  }

  async function generate() {
    if (!sourceAssetId) { setLocalError("请先上传或选择一张参考照片"); return; }
    if (!prompt.trim()) { setLocalError("请输入场景和动作提示词"); return; }
    setLocalError(null);
    await onGenerate(sourceAssetId, prompt, 5);
  }

  return <div className={showSidebar ? "film-generate-layout" : "film-generate-layout film-generate-layout--embedded"}>
    {showSidebar && <aside className="film-sidebar" aria-label="主导航">
      <div className="film-brand"><span className="film-brand-mark">✦</span><strong>AI Video Studio</strong></div>
      <nav className="film-main-nav">
        <button className="selected" type="button" aria-current="page"><StudioIcon name="sparkles" />创作</button>
        <button type="button" onClick={() => document.getElementById("film-quick-start")?.scrollIntoView({ behavior: "smooth" })}><StudioIcon name="compass" />探索</button>
        <button type="button" onClick={onOpenEditor}><StudioIcon name="folder" />资产</button>
        <button type="button" onClick={onOpenCanvas}><StudioIcon name="user" />主体</button>
        <span className="film-sidebar-divider" />
        <button type="button" onClick={onOpenEditor}><StudioIcon name="clapper" />短剧工作室</button>
      </nav>
      {sidebarContent}
      <div className="film-sidebar-projects"><span>最近项目</span><button type="button" onClick={onOpenCanvas}><StudioIcon name="film" size={16} />{currentEpisode?.title ?? "第 1 集"} · {manifest.title}</button></div>
      <button className="film-sidebar-settings" type="button" onClick={onOpenProjects}><StudioIcon name="settings" size={18} />切换项目</button>
    </aside>}

    <main className="film-generate-main">
      <header className="film-generate-topbar">
        <span>创作&nbsp; / &nbsp;{currentEpisode?.title ?? "第 1 集"} · {manifest.title}</span>
        <div><i className={saveState === "failed" ? "failed" : ""} />{saveState === "saving" ? "保存中" : saveState === "failed" ? "保存失败" : "已保存"}</div>
        {topbarActions}
        <button type="button" aria-label="通知" title="任务状态见最近创作"><StudioIcon name="bell" size={18} /></button>
        <span className="film-avatar" aria-hidden="true" />
      </header>
      <div className="film-generate-scroll">
        <div className="film-generate-content">
          <section className="film-hero">
            <span>TURN AN IDEA INTO A SCENE</span>
            <h1>今天想要创作什么？</h1>
            <div className="film-mode-switch" role="tablist" aria-label="创作模式">
              <button type="button" role="tab" aria-selected="true" className="active">生成</button>
              <button type="button" role="tab" aria-selected="false" onClick={onOpenCanvas}>画布</button>
            </div>
            <p>保持人物外貌一致，用一张照片开启完整故事。</p>
          </section>

          <section className="film-composer" aria-label="照片生成视频">
            <div className="film-composer-body">
              <div className="film-photo-controls">
                <button type="button" className="film-photo-tile" onClick={() => void upload()} disabled={busy} aria-label="上传参考照片">
                  {selectedPhoto && previewUrls[selectedPhoto.id] ? <img src={previewUrls[selectedPhoto.id]} alt={nameOf(selectedPhoto)} /> : <StudioIcon name="image" size={30} />}
                  <span>{selectedPhoto ? nameOf(selectedPhoto) : "上传参考照片"}</span>
                </button>
                {images.length > 1 && <select aria-label="参考照片" value={sourceAssetId} onChange={event => setSourceAssetId(event.target.value)}>
                  {images.map(asset => <option key={asset.id} value={asset.id}>{nameOf(asset)}</option>)}
                </select>}
              </div>
              <div className="film-prompt-area">
                <label htmlFor="film-prompt">让这一幕动起来</label>
                <textarea id="film-prompt" aria-label="场景和动作提示词" value={prompt} onChange={event => setPrompt(event.target.value)}
                  placeholder="描述场景、动作与镜头。例如：保持照片中小狗的外貌，让它穿厨师服在厨房洗菜做饭。" />
                <span>输入镜头、动作和场景；当前支持无声图生视频。</span>
              </div>
            </div>
            <div className="film-composer-footer">
              <span className="film-composer-kind"><StudioIcon name="clapper" size={17} />视频生成</span>
              <span><StudioIcon name="box" size={16} />无声图生视频</span>
              <span><StudioIcon name="scan" size={16} />跟随原图比例</span>
              <span aria-label="新生成镜头时长"><StudioIcon name="clock" size={16} />5 秒</span>
              <button type="button" className="film-primary-action" onClick={() => void generate()} disabled={busy}><StudioIcon name="arrowUp" size={18} />生成视频</button>
            </div>
          </section>
          {localError && <p className="film-inline-error" role="alert">{localError}</p>}
          {statusSlot}

          <section className="film-quick-start" id="film-quick-start" aria-label="快捷开始">
            <h2>快捷开始</h2>
            <div>{promptStarts.map(([label, prefix]) => <button type="button" key={label} onClick={() => setPrompt(value => prefix + value)}>/ {label}</button>)}</div>
          </section>

          <section className="film-recent" aria-label="最近创作">
            <div className="film-section-heading"><h2>最近创作</h2><button type="button" onClick={onOpenCanvas}>查看画布 →</button></div>
            <div className="film-recent-grid">
              {jobs.length ? jobs.map(job => {
                const shot = manifest.shots.find(item => item.id === job.shotId);
                const asset = manifest.assets.find(item => item.id === job.outputAssetId);
                const preview = asset ? previewUrls[asset.id] : null;
                const sourcePreview = shot ? previewUrls[shot.sourceAssetId] : undefined;
                const canRefresh = !["draft", "failed", "succeeded"].includes(job.state);
                return <article className="film-recent-card" key={job.id}>
                  <div className="film-recent-thumb">{preview && asset?.kind === "video" ? <video src={preview} muted preload="auto" /> : sourcePreview ? <img src={sourcePreview} alt="" /> : <StudioIcon name="play" size={22} />}</div>
                  <div className="film-recent-copy"><strong title={shot?.prompt}>{shot?.prompt.slice(0, 20) || nameOf(asset)}</strong><small>{jobLabels[job.state]} · {shot?.durationSec ?? 5} 秒</small>
                    {job.state === "succeeded" && job.outputAssetId ? <><button type="button" onClick={() => onAddToCanvas(job)}>加入画布 →</button>{onEditVideo && <button type="button" onClick={() => onEditVideo(job)}>微调视频</button>}</>
                      : canRefresh ? <button type="button" onClick={() => void onRefresh(job.id)} disabled={busy}>查询原任务 →</button>
                        : <span>{job.state === "failed" ? "可重新创建分镜" : "等待结果"}</span>}
                  </div>
                </article>;
              }) : <>
                <article className="film-recent-card empty"><div className="film-recent-thumb"><StudioIcon name="clapper" size={23} /></div><div className="film-recent-copy"><strong>还没有生成视频</strong><small>上传照片，写下第一个镜头</small><span>从上方开始创作 →</span></div></article>
                <article className="film-recent-card empty"><div className="film-recent-thumb secondary"><StudioIcon name="user" size={23} /></div><div className="film-recent-copy"><strong>创建故事人物</strong><small>用参考照片保持角色一致</small><button type="button" onClick={onOpenCanvas}>进入画布 →</button></div></article>
                <article className="film-recent-card empty"><div className="film-recent-thumb tertiary"><StudioIcon name="film" size={23} /></div><div className="film-recent-copy"><strong>{currentEpisode?.title ?? "第 1 集"}画布</strong><small>连接节点，编排成片</small><button type="button" onClick={onOpenCanvas}>继续编辑 →</button></div></article>
              </>}
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>;
}
