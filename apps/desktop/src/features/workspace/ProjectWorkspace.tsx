import { useEffect, useState } from "react";
import { Button, StatusBadge } from "@ai-video/ui-web";
import type { ExportArtifacts } from "@ai-video/platform-ports";
import { appendClip, moveClip, setClipVolume, trimClip, upsertCaption } from "@ai-video/project-core";
import type { OpenProject, ProjectManifestV2, TimelineClip } from "@ai-video/project-core";
import { CreateVideo } from "../create/CreateVideo";
import { CostReview } from "../generation/CostReview";
import { ServiceSettings } from "../generation/ServiceSettings";
import { desktopPorts } from "../../lib/ports";
import { hasDesktopFeature } from "../../lib/plugins";

type SequenceView = "storyboard" | "timeline";
type InspectorTab = "clip" | "captions" | "publish" | "ai";
interface Props { project: OpenProject }

function assetName(path: string) { return path.split("/").slice(-1)[0] ?? path; }
function clipDuration(clip: TimelineClip) { return clip.outMs - clip.inMs; }
function formatTime(ms: number) { return `${(ms / 1000).toFixed(1)}s`; }

export function ProjectWorkspace({ project }: Props) {
  const [manifest, setManifest] = useState(project.manifest);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [view, setView] = useState<SequenceView>("storyboard");
  const [inspector, setInspector] = useState<InspectorTab>("clip");
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [captionText, setCaptionText] = useState("");
  const [outputName, setOutputName] = useState("video");
  const [exported, setExported] = useState<ExportArtifacts | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const selectedClip = manifest.clips.find(clip => clip.id === selectedClipId) ?? manifest.clips[0] ?? null;
  let elapsedMs = 0;
  const playheadClip = manifest.clips.find(clip => {
    const inside = positionMs >= elapsedMs && positionMs < elapsedMs + clipDuration(clip);
    elapsedMs += clipDuration(clip);
    return inside;
  }) ?? manifest.clips.slice(-1)[0] ?? null;
  const activeAssetId = selectedAssetId ?? playheadClip?.assetId ?? null;
  const previewAsset = manifest.assets.find(asset => asset.id === activeAssetId);
  const totalMs = manifest.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  const activeCaption = manifest.captions.find(caption => positionMs >= caption.startMs && positionMs < caption.endMs);

  useEffect(() => {
    let live = true;
    void desktopPorts.media.audit(project.root, project.manifest.assets).then(assets => {
      if (live) setManifest(current => ({ ...current, assets }));
    }).catch(error => { if (live) setMessage(`素材检查失败：${String(error)}`); });
    return () => { live = false; };
  }, [project.root, project.manifest.assets]);

  useEffect(() => {
    setPreviewUrl(null);
    if (!activeAssetId) return;
    let live = true;
    let objectUrl: string | null = null;
    const asset = manifest.assets.find(item => item.id === activeAssetId);
    if (!asset || asset.missing) { setPreviewUrl(null); return; }
    const extension = asset.relativePath.split(".").slice(-1)[0]?.toLowerCase();
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
    void desktopPorts.media.read(project.root, activeAssetId).then(bytes => {
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      if (live) setPreviewUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(error => { if (live) setMessage(`预览失败：${String(error)}`); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activeAssetId, project.root, manifest.assets]);

  async function update(next: ProjectManifestV2) {
    const previous = manifest;
    setManifest(next);
    setBusy(true);
    setSaveState("saving");
    try {
      await desktopPorts.projects.save(project.root, next);
      setSaveState("saved");
    } catch (error) {
      setManifest(previous);
      setSaveState("failed");
      setMessage(`保存失败：${String(error)}`);
    } finally { setBusy(false); }
  }

  function edit(operation: () => ProjectManifestV2) {
    try { void update(operation()); }
    catch (error) { setMessage(String(error)); }
  }

  async function importFiles() {
    setMessage(null);
    try {
      const paths = await desktopPorts.media.chooseFiles();
      if (!paths.length) return;
      setBusy(true);
      setSaveState("saving");
      let next = manifest;
      for (const path of paths) {
        const asset = await desktopPorts.media.import(project.root, path);
        next = { ...next, assets: [...next.assets, asset] };
        await desktopPorts.projects.save(project.root, next);
        setManifest(next);
        setSelectedAssetId(asset.id);
      }
      setSaveState("saved");
      setMessage(`已导入 ${paths.length} 个素材`);
    } catch (error) { setSaveState("failed"); setMessage(`导入失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function addClip(assetId: string) {
    try {
      const next = appendClip(manifest, assetId);
      setSelectedClipId(next.clips.slice(-1)[0]?.id ?? null);
      setSelectedAssetId(null);
      setInspector("clip");
      await update(next);
    } catch (error) { setMessage(String(error)); }
  }

  function selectClip(clip: TimelineClip, index: number) {
    setSelectedClipId(clip.id);
    setSelectedAssetId(null);
    setInspector("clip");
    setPositionMs(manifest.clips.slice(0, index).reduce((sum, item) => sum + clipDuration(item), 0));
  }

  function reorder(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const targetIndex = manifest.clips.findIndex(clip => clip.id === targetId);
    edit(() => moveClip(manifest, draggedId, targetIndex));
    setDraggedId(null);
  }

  async function exportVideo() {
    setBusy(true);
    setExporting(true);
    setExported(null);
    setMessage("导出中：正在生成 MP4 与封面…");
    try {
      const result = await desktopPorts.export.render(project.root, outputName.trim());
      setExported(result);
      setMessage("导出完成，文件已保存到项目文件夹");
    } catch (error) { setMessage(`导出失败：${String(error)}`); }
    finally { setBusy(false); setExporting(false); }
  }

  const invalidCaption = manifest.captions.some(caption => caption.endMs > totalMs);
  const invalidCover = totalMs > 0 && (manifest.coverTimeMs ?? 0) >= totalMs;
  const exportDisabled = busy || totalMs === 0 || manifest.assets.some(asset => asset.missing) || invalidCaption || invalidCover;
  const inspectorTabs = ([ ["clip", "片段"], ["captions", "字幕"], ["publish", "发布"], ["ai", "AI 创作"] ] as const).filter(([id]) =>
    id === "clip" ? hasDesktopFeature("timeline") : id === "captions" ? hasDesktopFeature("captions") : id === "publish" ? hasDesktopFeature("publishing") || hasDesktopFeature("export") : hasDesktopFeature("storyboard"));
  return <div className="editor-workspace">
    <div className="editor-commandbar">
      <div className="editor-commandbar-title"><strong>{manifest.title}</strong><small title={project.root}>{project.root}</small></div>
      <StatusBadge tone={saveState === "failed" ? "warning" : saveState === "saved" ? "success" : "neutral"}>{saveState === "failed" ? "保存失败" : saveState === "saving" ? "保存中" : "已保存"}</StatusBadge>
      <span className="editor-commandbar-spacer" />
      <span className="editor-format">竖屏 9:16 · {formatTime(totalMs)}</span>
      <Button onClick={() => setInspector("publish")} disabled={!hasDesktopFeature("export")}>导出作品</Button>
    </div>

    <div className={hasDesktopFeature("media") ? "editor-main" : "editor-main without-media"}>
      {hasDesktopFeature("media") && <aside className="editor-media" aria-label="素材库">
        <div className="editor-pane-heading"><div><strong>素材库</strong><small>{manifest.assets.length} 个素材</small></div><Button onClick={importFiles} disabled={busy}>＋ 导入</Button></div>
        {manifest.assets.length === 0 ? <div className="editor-media-empty"><span aria-hidden="true">▧</span><strong>还没有素材</strong><p>导入照片或视频，开始编排作品。</p><Button variant="secondary" onClick={importFiles} disabled={busy}>导入素材</Button></div>
          : <ul className="editor-media-list">{manifest.assets.map(asset => <li key={asset.id}>
            <button type="button" className={activeAssetId === asset.id ? "editor-media-item selected" : "editor-media-item"} onClick={() => { setSelectedAssetId(asset.id); setInspector("clip"); }} onDoubleClick={() => { if (asset.kind !== "audio" && !asset.missing) void addClip(asset.id); }}>
              <span className="editor-media-icon" aria-hidden="true">{asset.kind === "image" ? "▧" : asset.kind === "video" ? "▶" : "♫"}</span>
              <span className="editor-media-detail"><strong>{assetName(asset.relativePath)}</strong><small>{asset.missing ? "文件缺失" : asset.kind === "image" ? "照片" : asset.kind === "video" ? `视频 · ${formatTime(asset.durationMs ?? 0)}` : "音频"}</small></span>
            </button>
            {!asset.missing && asset.kind !== "audio" && <button type="button" className="editor-media-add" disabled={busy} onClick={() => void addClip(asset.id)} aria-label={`将 ${assetName(asset.relativePath)} 加入时间线`}>＋</button>}
          </li>)}</ul>}
      </aside>}

      <section className="editor-preview" aria-label="预览区">
        <div className="editor-preview-heading"><strong>预览</strong><span>{previewAsset ? assetName(previewAsset.relativePath) : "未选择素材"}</span></div>
        <div className="editor-preview-stage"><div className="editor-preview-frame">
          {previewUrl && previewAsset?.kind === "image" ? <img src={previewUrl} alt="当前素材预览" />
            : previewUrl && previewAsset?.kind === "video" ? <video key={previewUrl} src={previewUrl} controls onError={() => setMessage("当前视频编码无法在系统预览器中播放")} />
              : previewUrl && previewAsset?.kind === "audio" ? <div className="editor-audio-preview"><span aria-hidden="true">♫</span><audio src={previewUrl} controls /></div>
                : <div className="editor-preview-placeholder"><span aria-hidden="true">▶</span><strong>{previewAsset?.missing ? "素材文件缺失" : "画面预览"}</strong><small>从左侧选择素材，或在下方选择片段</small></div>}
          {activeCaption && previewAsset?.kind !== "audio" && <div className="editor-caption-overlay">{activeCaption.text}</div>}
        </div></div>
        <div className="editor-playhead"><span>{formatTime(positionMs)}</span><input aria-label="播放头位置" type="range" min="0" max={Math.max(1, totalMs)} step="100" value={Math.min(positionMs, totalMs)} onChange={event => setPositionMs(Number(event.target.value))} disabled={!totalMs} /><span>{formatTime(totalMs)}</span></div>
        <p className="editor-preview-note">素材预览 · 导出时按下方片段顺序合成</p>
      </section>

      <aside className="editor-inspector" aria-label="属性面板">
        <div className="editor-inspector-tabs" role="tablist" aria-label="属性类型">
          {inspectorTabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={inspector === id} className={inspector === id ? "active" : ""} onClick={() => setInspector(id)}>{label}</button>)}
        </div>
        <div className="editor-inspector-body">
          {inspector === "clip" && hasDesktopFeature("timeline") && (selectedClip ? <><div className="editor-inspector-title"><strong>片段属性</strong><small>{assetName(manifest.assets.find(asset => asset.id === selectedClip.assetId)?.relativePath ?? "未知素材")}</small></div><div className="editor-field-grid"><label>开始秒<input aria-label="片段开始秒" type="number" min="0" step="0.1" value={selectedClip.inMs / 1000} disabled={busy} onChange={event => edit(() => trimClip(manifest, selectedClip.id, Math.round(Number(event.target.value) * 1000), selectedClip.outMs))} /></label><label>结束秒<input aria-label="片段结束秒" type="number" min="0.1" step="0.1" value={selectedClip.outMs / 1000} disabled={busy} onChange={event => edit(() => trimClip(manifest, selectedClip.id, selectedClip.inMs, Math.round(Number(event.target.value) * 1000)))} /></label></div><label className="editor-field">音量 <input type="range" min="0" max="1" step="0.05" value={selectedClip.volume} disabled={busy} onChange={event => edit(() => setClipVolume(manifest, selectedClip.id, Number(event.target.value)))} /></label><p className="editor-helper">拖动故事板卡片可排序；数字输入可精确裁剪。</p></> : <div className="editor-inspector-empty"><strong>选择一个片段</strong><p>从素材库加入照片或视频后，在下方选择片段编辑。</p></div>)}
          {inspector === "captions" && hasDesktopFeature("captions") && <><div className="editor-inspector-title"><strong>字幕</strong><small>字幕使用整条视频的时间点</small></div><label className="editor-field">字幕内容<input aria-label="字幕内容" value={captionText} onChange={event => setCaptionText(event.target.value)} placeholder="输入字幕" /></label><Button disabled={busy || totalMs === 0} onClick={() => { if (!captionText.trim()) { setMessage("请先输入字幕"); return; } const startMs = Math.min(positionMs, Math.max(0, totalMs - 100)); edit(() => upsertCaption(manifest, { id: crypto.randomUUID(), startMs, endMs: Math.min(totalMs, startMs + 2000), text: captionText })); setCaptionText(""); }}>在当前位置添加</Button><ul className="editor-caption-list">{manifest.captions.map(caption => <li key={caption.id}><input aria-label="字幕文本" value={caption.text} disabled={busy} onChange={event => edit(() => upsertCaption(manifest, { ...caption, text: event.target.value }))} /><div className="editor-field-grid"><label>开始<input type="number" min="0" step="0.1" value={caption.startMs / 1000} disabled={busy} onChange={event => edit(() => upsertCaption(manifest, { ...caption, startMs: Math.round(Number(event.target.value) * 1000) }))} /></label><label>结束<input type="number" min="0.1" step="0.1" value={caption.endMs / 1000} disabled={busy} onChange={event => edit(() => upsertCaption(manifest, { ...caption, endMs: Math.round(Number(event.target.value) * 1000) }))} /></label></div><Button variant="ghost" disabled={busy} onClick={() => void update({ ...manifest, captions: manifest.captions.filter(item => item.id !== caption.id) })}>删除字幕</Button></li>)}</ul></>}
          {inspector === "publish" && <><div className="editor-inspector-title"><strong>发布与导出</strong><small>视频、封面和文案</small></div><label className="editor-field">发布文案<textarea aria-label="发布文案" value={manifest.publishingCopy} onChange={event => setManifest(current => ({ ...current, publishingCopy: event.target.value }))} placeholder="写下发布时使用的文案" /></label><div className="editor-row"><Button variant="secondary" disabled={busy} onClick={() => void update(manifest)}>保存文案</Button><Button variant="ghost" disabled={!manifest.publishingCopy} onClick={() => void navigator.clipboard.writeText(manifest.publishingCopy).then(() => setMessage("文案已复制"))}>复制</Button></div>{hasDesktopFeature("cover") && <label className="editor-field">封面时间（秒）<input type="number" min="0" max={Math.max(0, totalMs / 1000 - 0.1)} step="0.1" value={(manifest.coverTimeMs ?? 0) / 1000} disabled={busy} onChange={event => edit(() => ({ ...manifest, coverTimeMs: Math.round(Number(event.target.value) * 1000) }))} /></label>}<label className="editor-field">导出文件名<input aria-label="导出文件名" value={outputName} onChange={event => setOutputName(event.target.value)} /></label><Button disabled={exportDisabled} onClick={exportVideo}>{exporting ? "导出中…" : "导出 MP4 与封面"}</Button>{exportDisabled && <p className="editor-helper">{totalMs === 0 ? "请先加入片段" : manifest.assets.some(asset => asset.missing) ? "有素材文件缺失，请先修复" : invalidCaption ? "字幕超出成片时长，请调整时间" : invalidCover ? "封面时间超出成片，请调整" : "请稍候"}</p>}{exported && <div className="editor-export-result"><StatusBadge tone="success">导出完成</StatusBadge><small>{exported.videoRelativePath}<br />{exported.coverRelativePath}</small><Button variant="secondary" onClick={() => void desktopPorts.export.openFolder(project.root)}>打开导出目录</Button></div>}</>}
          {inspector === "ai" && hasDesktopFeature("storyboard") && <div className="editor-ai-panels"><p className="editor-helper">分镜草稿和费用规划不会进入可播放时间线。当前尚未接通付费生成。</p><CreateVideo assets={manifest.assets} shots={manifest.shots} disabled={busy} onAdd={shot => void update({ ...manifest, shots: [...manifest.shots, shot] })} /><CostReview root={project.root} shots={manifest.shots} budgetUsd={manifest.budgetUsd} disabled={busy} onSaveBudget={budgetUsd => void update({ ...manifest, budgetUsd })} /><ServiceSettings /></div>}
        </div>
      </aside>
    </div>

    {hasDesktopFeature("timeline") && <section className="editor-sequence" aria-label="剪辑序列">
      <div className="editor-sequence-bar"><div className="editor-view-tabs" role="tablist" aria-label="序列视图"><button type="button" role="tab" aria-selected={view === "storyboard"} className={view === "storyboard" ? "active" : ""} onClick={() => setView("storyboard")}>故事板</button><button type="button" role="tab" aria-selected={view === "timeline"} className={view === "timeline" ? "active" : ""} onClick={() => setView("timeline")}>时间线</button></div><span>{manifest.clips.length} 个片段 · {formatTime(totalMs)}</span></div>
      {manifest.clips.length === 0 ? <div className="editor-sequence-empty">从左侧素材库把照片或视频加入这里，即可开始剪辑。</div>
        : view === "storyboard" ? <ol className="editor-storyboard">{manifest.clips.map((clip, index) => { const asset = manifest.assets.find(item => item.id === clip.assetId); return <li key={clip.id} draggable={!busy} onDragStart={() => setDraggedId(clip.id)} onDragOver={event => event.preventDefault()} onDrop={() => reorder(clip.id)} onDragEnd={() => setDraggedId(null)} className={selectedClip?.id === clip.id ? "selected" : ""}><button type="button" className="editor-story-card" onClick={() => selectClip(clip, index)}><span className="editor-story-thumb" aria-hidden="true">{asset?.kind === "image" ? "▧" : "▶"}</span><span className="editor-story-number">{String(index + 1).padStart(2, "0")}</span><strong>{asset ? assetName(asset.relativePath) : "未知素材"}</strong><small>{formatTime(clipDuration(clip))}</small></button><div className="editor-story-controls"><button type="button" aria-label={`将片段 ${index + 1} 前移`} disabled={busy || index === 0} onClick={() => edit(() => moveClip(manifest, clip.id, index - 1))}>←</button><button type="button" aria-label={`将片段 ${index + 1} 后移`} disabled={busy || index === manifest.clips.length - 1} onClick={() => edit(() => moveClip(manifest, clip.id, index + 1))}>→</button></div></li>; })}</ol>
          : <div className="editor-timeline"><div className="editor-timeline-ruler"><span>00:00</span><span>{formatTime(totalMs)}</span></div><div className="editor-timeline-track"><span className="editor-track-label">画面</span><div className="editor-timeline-clips">{manifest.clips.map((clip, index) => { const asset = manifest.assets.find(item => item.id === clip.assetId); return <button key={clip.id} type="button" className={selectedClip?.id === clip.id ? "editor-timeline-clip selected" : "editor-timeline-clip"} style={{ flexGrow: Math.max(1, clipDuration(clip)) }} onClick={() => selectClip(clip, index)}><strong>{asset ? assetName(asset.relativePath) : "未知素材"}</strong><small>{formatTime(clipDuration(clip))}</small></button>; })}</div></div><div className="editor-timeline-track"><span className="editor-track-label">字幕</span><div className="editor-caption-track">{manifest.captions.map(caption => <span key={caption.id} style={{ left: `${totalMs ? caption.startMs / totalMs * 100 : 0}%`, width: `${totalMs ? (caption.endMs - caption.startMs) / totalMs * 100 : 0}%` }} title={caption.text}>{caption.text}</span>)}</div></div></div>}
    </section>}
    {message && <div className="editor-toast" role="status">{message}<button type="button" aria-label="关闭提示" onClick={() => setMessage(null)}>✕</button></div>}
  </div>;
}
