import { useState } from "react";
import { StudioIcon } from "@ai-video/ui-web";
import { StatePanel } from "./StatePanel";
import type { StudioResult } from "./contracts";

export function ResultsPage({ results, episodeTitle, storageLabel = "已保存项目", onGenerate, onEdit, onAddToTimeline, onRefresh }: {
  results: StudioResult[]; episodeTitle?: string; storageLabel?: string; onGenerate: () => void;
  onEdit?: (result: StudioResult) => void; onAddToTimeline?: (result: StudioResult) => void;
  onRefresh?: (result: StudioResult) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = results.find(item => item.id === selectedId) ?? results[0];
  return <main className="avs-results-page">
    <div className="avs-page-meta"><span>创作 / {episodeTitle || "第 1 集"} / 结果</span><span>● {storageLabel}</span></div>
    <div className="avs-results-content">
      <span className="avs-section-kicker">RESULTS / LIBRARY</span>
      <h1>{selected?.status === "succeeded" ? selected.title : "你的视频结果"}</h1>
      <p className="avs-results-lead">生成成功后，原始视频和编辑版本都会保存在这里。</p>
      {!selected ? <StatePanel state="empty" title="还没有视频结果" description="上传一张参考照片，写下镜头描述，完成云端生成后从这里继续编辑。" action="去生成第一个镜头" onAction={onGenerate} />
        : selected.status === "succeeded" && selected.videoUrl ? <div className="avs-result-grid">
          <section className="avs-result-main"><div className="avs-result-video"><video src={selected.videoUrl} controls preload="metadata" aria-label={selected.title} /></div>
            <div className="avs-result-meta">{selected.durationSec} 秒 · 原始生成 · 已保存到项目素材</div>
            <p>{selected.description}</p>{selected.taskId && <small>任务 ID：{selected.taskId}</small>}</section>
          <aside className="avs-result-versions"><h2>选择使用的版本</h2><p>编辑结果会保留原视频，加入时间线前由你决定。</p>
            <div className="avs-version-current"><strong>原始生成</strong><small>{selected.durationSec} 秒 · 当前预览</small></div>
            <div className="avs-version-pending"><strong>尚无剪辑版本</strong><small>编辑完成后显示在这里</small></div>
            {onAddToTimeline && <button className="primary" type="button" onClick={() => onAddToTimeline(selected)}>使用原始版本加入时间线<StudioIcon name="arrowRight" size={16} /></button>}
            {onEdit && <button type="button" onClick={() => onEdit(selected)}>打开视频编辑</button>}</aside>
        </div> : <StatePanel state={selected.status === "succeeded" ? "failed" : selected.status} title={selected.status === "loading" ? "镜头正在生成" : selected.status === "unknown" ? "提交状态待确认" : selected.status === "succeeded" ? "视频暂时无法加载" : "视频生成失败"}
          description={selected.status === "unknown" ? "云端接收状态尚未确认，请查询原任务。" : selected.status === "failed" ? "输入与参考照片仍保留。查看原因后可重新创建计划。" : selected.status === "succeeded" ? "任务已完成，请查询原任务以恢复视频地址。" : "任务已记录，离开页面后仍可继续查看同一任务。"}
          detail={selected.taskId && <>任务 ID：{selected.taskId}</>}
          action={selected.status === "failed" ? "返回生成页" : "查询原任务"}
          onAction={selected.status === "failed" ? onGenerate : onRefresh ? () => onRefresh(selected) : undefined} />}
      {results.length > 1 && <div className="avs-result-list" aria-label="其他镜头">{results.map(item => <button type="button" key={item.id} className={selected?.id === item.id ? "active" : ""}
        onClick={() => setSelectedId(item.id)}>{item.title}<small>{item.durationSec} 秒 · {item.status === "succeeded" ? "已完成" : "处理中"}</small></button>)}</div>}
    </div>
  </main>;
}
