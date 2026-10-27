import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { auditAssets, exportProject, importAsset, readAsset, saveProject } from "../../lib/native";
import type { ExportArtifacts } from "../../lib/native";
import { appendClip, moveClip, setClipVolume, trimClip, upsertCaption } from "../timeline/model";
import { CreateVideo } from "../create/CreateVideo";
import { CostReview } from "../generation/CostReview";
import { ServiceSettings } from "../generation/ServiceSettings";
import type { OpenProject, ProjectManifestV2 } from "../../types/project";

interface Props { project: OpenProject; onClose: () => void }

export function ProjectWorkspace({ project, onClose }: Props) {
  const [manifest, setManifest] = useState(project.manifest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState("video");
  const [exported, setExported] = useState<ExportArtifacts | null>(null);

  useEffect(() => {
    let live = true;
    void auditAssets(project.root, project.manifest.assets).then(assets => {
      if (live) setManifest(current => ({ ...current, assets }));
    }).catch(error => { if (live) setMessage(String(error)); });
    return () => { live = false; };
  }, [project.root, project.manifest.assets]);

  useEffect(() => {
    if (!selectedAssetId) { setPreviewUrl(null); return; }
    let live = true;
    let objectUrl: string | null = null;
    const asset = manifest.assets.find(item => item.id === selectedAssetId);
    if (!asset) return;
    const extension = asset.relativePath.split(".").slice(-1)[0].toLowerCase();
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" } as Record<string, string>)[extension] ?? "application/octet-stream";
    void readAsset(project.root, selectedAssetId).then(bytes => {
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      if (live) setPreviewUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(error => { if (live) setMessage(`预览失败：${String(error)}`); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedAssetId, project.root, manifest.assets]);

  async function update(next: ProjectManifestV2) {
    setBusy(true);
    const previous = manifest;
    setManifest(next);
    try {
      await saveProject(project.root, next);
      setMessage("已保存到项目文件夹");
    } catch (error) { setManifest(previous); setMessage(`保存失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function importFiles() {
    setMessage(null);
    try {
      const selected = await open({ multiple: true, directory: false, title: "选择照片、视频或音频" });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setBusy(true);
      let next = manifest;
      for (const path of paths) {
        const asset = await importAsset(project.root, path);
        next = { ...next, assets: [...next.assets, asset] };
        await saveProject(project.root, next);
        setManifest(next);
      }
      setMessage(`已导入 ${paths.length} 个素材`);
    } catch (error) { setMessage(`导入失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  function edit(operation: () => ProjectManifestV2) {
    try { void update(operation()); }
    catch (error) { setMessage(String(error)); }
  }

  async function exportVideo() {
    setBusy(true);
    setExported(null);
    setMessage("正在离线导出视频与封面，请稍候…");
    try {
      const result = await exportProject(project.root, outputName.trim());
      setExported(result);
      setMessage("视频与封面已导出到项目文件夹");
    } catch (error) { setMessage(`导出失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  const totalMs = manifest.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0);
  return <section className="project-content">
    <button className="text-button" onClick={onClose} type="button">← 返回项目首页</button>
    <div className="eyebrow">当前项目</div><h1>{manifest.title}</h1><p className="intro">{project.root}</p>
    <CreateVideo assets={manifest.assets} shots={manifest.shots} disabled={busy} onAdd={shot => void update({ ...manifest, shots: [...manifest.shots, shot] })} />
    <CostReview root={project.root} shots={manifest.shots} budgetUsd={manifest.budgetUsd} disabled={busy} onSaveBudget={budgetUsd => void update({ ...manifest, budgetUsd })} />
    <ServiceSettings />
    <div className="editor-grid">
      <div className="editor-panel">
        <div className="panel-heading"><h2>素材库</h2><button type="button" onClick={importFiles} disabled={busy}>＋ 导入素材</button></div>
        {manifest.assets.length === 0 ? <p className="muted">添加人物或动物照片，也可以导入已有视频和音频。</p> : <ul className="asset-list">{manifest.assets.map(asset => <li key={asset.id}>
          <span><strong>{asset.relativePath.split("/").slice(-1)[0]}</strong><small>{asset.kind === "image" ? "照片" : asset.kind === "video" ? "视频" : "音频"}{asset.durationMs ? ` · ${(asset.durationMs / 1000).toFixed(1)} 秒` : ""}</small></span>
          {asset.missing ? <em>文件缺失</em> : <div className="asset-actions"><button type="button" onClick={() => setSelectedAssetId(asset.id)}>预览</button>{asset.kind !== "audio" && <button type="button" disabled={busy} onClick={() => edit(() => appendClip(manifest, asset.id))}>加入时间线</button>}</div>}
        </li>)}</ul>}
        {previewUrl && (() => { const asset = manifest.assets.find(item => item.id === selectedAssetId); return asset?.kind === "image" ? <img className="media-preview" src={previewUrl} alt="当前素材预览" /> : asset?.kind === "video" ? <video className="media-preview" src={previewUrl} controls onError={() => setMessage("当前视频编码无法在系统预览器中播放")} /> : <audio className="audio-preview" src={previewUrl} controls />; })()}
      </div>
      <div className="editor-panel">
        <div className="panel-heading"><h2>时间线</h2><span>{(totalMs / 1000).toFixed(1)} 秒</span></div>
        {manifest.clips.length === 0 ? <p className="muted">从素材库添加片段后，可排序、裁剪并调整音量。</p> : <ol className="clip-list">{manifest.clips.map((clip, index) => {
          const asset = manifest.assets.find(item => item.id === clip.assetId);
          return <li key={clip.id}>
            <div className="clip-top"><strong>{index + 1}. {asset?.relativePath.split("/").slice(-1)[0] ?? "未知素材"}</strong><div><button type="button" disabled={busy || index === 0} onClick={() => edit(() => moveClip(manifest, clip.id, index - 1))}>↑</button><button type="button" disabled={busy || index === manifest.clips.length - 1} onClick={() => edit(() => moveClip(manifest, clip.id, index + 1))}>↓</button></div></div>
            <div className="clip-controls"><label>开始秒 <input type="number" min="0" step="0.1" value={clip.inMs / 1000} onChange={event => edit(() => trimClip(manifest, clip.id, Math.round(Number(event.target.value) * 1000), clip.outMs))} /></label><label>结束秒 <input type="number" min="0.1" step="0.1" value={clip.outMs / 1000} onChange={event => edit(() => trimClip(manifest, clip.id, clip.inMs, Math.round(Number(event.target.value) * 1000)))} /></label><label>音量 <input type="range" min="0" max="1" step="0.05" value={clip.volume} onChange={event => edit(() => setClipVolume(manifest, clip.id, Number(event.target.value)))} /></label></div>
          </li>;
        })}</ol>}
      </div>
    </div>
    <div className="editor-grid secondary-grid">
      <div className="editor-panel"><h2>字幕</h2><p className="muted">添加后可调整每条字幕的出现时间。</p><div className="inline-form"><input aria-label="字幕内容" value={captionText} onChange={event => setCaptionText(event.target.value)} placeholder="输入字幕" /><button type="button" disabled={busy || totalMs === 0} onClick={() => { if (!captionText.trim()) { setMessage("请先输入字幕"); return; } edit(() => upsertCaption(manifest, { id: crypto.randomUUID(), startMs: 0, endMs: totalMs, text: captionText })); setCaptionText(""); }}>添加</button></div><ul className="caption-list">{manifest.captions.map(caption => <li key={caption.id}><input aria-label="字幕文本" value={caption.text} onChange={event => edit(() => upsertCaption(manifest, { ...caption, text: event.target.value }))} /><label>开始 <input type="number" min="0" step="0.1" value={caption.startMs / 1000} onChange={event => edit(() => upsertCaption(manifest, { ...caption, startMs: Math.round(Number(event.target.value) * 1000) }))} /></label><label>结束 <input type="number" min="0.1" step="0.1" value={caption.endMs / 1000} onChange={event => edit(() => upsertCaption(manifest, { ...caption, endMs: Math.round(Number(event.target.value) * 1000) }))} /></label><button type="button" onClick={() => void update({ ...manifest, captions: manifest.captions.filter(item => item.id !== caption.id) })}>删除</button></li>)}</ul></div>
      <div className="editor-panel"><h2>发布文案</h2><textarea aria-label="发布文案" value={manifest.publishingCopy} onChange={event => setManifest(current => ({ ...current, publishingCopy: event.target.value }))} placeholder="写下发布时使用的文案" /><div className="panel-actions"><button type="button" disabled={busy} onClick={() => void update(manifest)}>保存文案</button><button type="button" disabled={!manifest.publishingCopy} onClick={() => void navigator.clipboard.writeText(manifest.publishingCopy).then(() => setMessage("文案已复制"))}>复制文案</button></div></div>
    </div>
    <div className="editor-panel export-panel"><div><h2>导出作品</h2><p className="muted">在本机生成 9:16 MP4 和 PNG 封面，不调用付费模型。</p></div><label>封面时间（秒）<input type="number" min="0" max={Math.max(0, totalMs / 1000 - 0.1)} step="0.1" value={(manifest.coverTimeMs ?? 0) / 1000} onChange={event => edit(() => ({ ...manifest, coverTimeMs: Math.round(Number(event.target.value) * 1000) }))} /></label><label>文件名<input aria-label="导出文件名" value={outputName} onChange={event => setOutputName(event.target.value)} /></label><button type="button" disabled={busy || totalMs === 0 || manifest.assets.some(asset => asset.missing)} onClick={exportVideo}>导出 MP4 与封面</button>{exported && <div className="export-result"><strong>导出完成</strong><small>{exported.videoRelativePath}<br />{exported.coverRelativePath}</small><button type="button" onClick={() => void openPath(`${project.root}/exports`)}>打开导出目录</button></div>}</div>
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
