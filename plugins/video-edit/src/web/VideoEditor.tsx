import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { validateRecipe } from "../core";
import type { VideoEditCommand, VideoEditRecipe } from "../core";
import { AgentSuggestionPanel } from "./AgentSuggestionPanel";
import type { AgentSuggestionPanelProps } from "./AgentSuggestionPanel";
import { VoiceoverPanel } from "./VoiceoverPanel";
import type { VoiceoverPanelProps } from "./VoiceoverPanel";

export { AgentSuggestionPanel, VoiceoverPanel };
export type { AgentSuggestionPanelProps, EditSuggestionSetView, EditSuggestionView } from "./AgentSuggestionPanel";
export type { VoiceoverPanelProps, VoiceAssetView, VoiceDraftView, TtsVoiceView, TtsQuoteView, TtsJobView, MixPreviewView } from "./VoiceoverPanel";
export { draftFromAudioMix, audioMixFromDraft } from "./voice-adapter";
export type { AudioMixView } from "./voice-adapter";
export { readAudioDuration } from "./audio-duration";
export { VoiceoverWorkflow } from "./VoiceoverWorkflow";
export { AgentEditWorkflow } from "./AgentEditWorkflow";
export type { AgentEditContext } from "./AgentEditWorkflow";

export interface VideoEditView {
  id: string; recipe: VideoEditRecipe; sourceAssetId: string; currentOutputId: string | null; currentCoverId: string | null;
}
export interface RenderView { id: string; state: string; outputAssetId: string | null; coverAssetId: string | null; error: string | null }
interface Props {
  edit: VideoEditView; sourceUrl: string; currentUrl?: string; render?: RenderView | null;
  onCommand: (command: VideoEditCommand, expectedRevision: number) => Promise<VideoEditView>;
  onRender: (revision: number) => Promise<void>;
  onUseInTimeline?: (assetId: string) => Promise<void>;
  voiceover?: VoiceoverPanelProps;
  agentSuggestions?: AgentSuggestionPanelProps;
  voiceoverSlot?: ReactNode;
  agentSlot?: ReactNode;
  onClose: () => void;
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);
const millis = (value: string) => Math.round(Number(value) * 1000);

export function VideoEditor({ edit, sourceUrl, currentUrl, render, onCommand, onRender, onUseInTimeline, voiceover, agentSuggestions, voiceoverSlot, agentSlot, onClose }: Props) {
  const recipe = edit.recipe;
  const [start, setStart] = useState(seconds(recipe.trimStartMs));
  const [end, setEnd] = useState(seconds(recipe.trimEndMs));
  const [cover, setCover] = useState(seconds(recipe.coverSourceMs));
  const [captionText, setCaptionText] = useState("");
  const [captionStart, setCaptionStart] = useState(seconds(recipe.trimStartMs));
  const [captionEnd, setCaptionEnd] = useState(seconds(Math.min(recipe.trimEndMs, recipe.trimStartMs + 2000)));
  const editedAvailable = Boolean(edit.currentOutputId && currentUrl);
  const [previewOriginal, setPreviewOriginal] = useState(!editedAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const issues = validateRecipe(recipe);
  const selectedAssetId = previewOriginal || !editedAvailable ? edit.sourceAssetId : edit.currentOutputId!;
  const selectedLabel = selectedAssetId === edit.sourceAssetId ? "原视频" : "编辑版";

  useEffect(() => {
    setStart(seconds(recipe.trimStartMs)); setEnd(seconds(recipe.trimEndMs)); setCover(seconds(recipe.coverSourceMs));
  }, [recipe.revision]);
  useEffect(() => { if (!editedAvailable) setPreviewOriginal(true); }, [editedAvailable]);

  async function command(value: VideoEditCommand) {
    try { setBusy(true); setError(""); await onCommand(value, recipe.revision); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function finish() {
    try { setBusy(true); setError(""); await onRender(recipe.revision); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return <section className="video-edit" aria-label="视频微调">
    <header className="video-edit-header"><div><small>VIDEO EDIT / VERSION {recipe.revision}</small><h2>视频微调</h2></div><button type="button" onClick={onClose} aria-label="关闭编辑器">×</button></header>
    <div className="video-edit-body"><div className="video-edit-preview">
      <div className="video-edit-preview-tabs"><button type="button" className={previewOriginal || !editedAvailable ? "active" : ""} onClick={() => setPreviewOriginal(true)}>原视频</button><button type="button" className={!previewOriginal && editedAvailable ? "active" : ""} disabled={!editedAvailable} onClick={() => setPreviewOriginal(false)}>编辑版</button></div>
      <video controls preload="metadata" src={!previewOriginal && currentUrl ? currentUrl : sourceUrl} />
      <p>正在预览：{selectedLabel}。原片始终保留；渲染完成后生成一个新版本。</p>
      {render && <p role="status">渲染状态：{render.state}{render.error ? ` · ${render.error}` : ""}</p>}
      {onUseInTimeline && <button type="button" disabled={busy} onClick={() => void onUseInTimeline(selectedAssetId)}>将{selectedLabel}加入时间线</button>}
    </div><div className="video-edit-controls">
      <section><h3>裁剪首尾时长</h3><div className="video-edit-two"><label>开始（秒）<input aria-label="裁剪开始秒数" type="number" min="0" max={seconds(recipe.sourceDurationMs)} step="0.1" value={start} onChange={event => setStart(event.target.value)} /></label><label>结束（秒）<input aria-label="裁剪结束秒数" type="number" min="0" max={seconds(recipe.sourceDurationMs)} step="0.1" value={end} onChange={event => setEnd(event.target.value)} /></label></div><button type="button" disabled={busy} onClick={() => void command({ type: "set-trim", startMs: millis(start), endMs: millis(end) })}>保存裁剪</button><small>原视频 {seconds(recipe.sourceDurationMs)} 秒，保留 {seconds(recipe.trimEndMs - recipe.trimStartMs)} 秒</small></section>
      <section><h3>手动字幕</h3><label>字幕内容<input aria-label="新增字幕内容" value={captionText} onChange={event => setCaptionText(event.target.value)} /></label><div className="video-edit-two"><label>开始（秒）<input aria-label="字幕开始秒数" type="number" step="0.1" value={captionStart} onChange={event => setCaptionStart(event.target.value)} /></label><label>结束（秒）<input aria-label="字幕结束秒数" type="number" step="0.1" value={captionEnd} onChange={event => setCaptionEnd(event.target.value)} /></label></div><button type="button" disabled={busy || !captionText.trim()} onClick={() => { void command({ type: "upsert-caption", caption: { id: crypto.randomUUID(), startMs: millis(captionStart), endMs: millis(captionEnd), text: captionText } }); setCaptionText(""); }}>添加字幕</button><ul>{recipe.captions.map(caption => <li key={caption.id}><span>{seconds(caption.startMs)}–{seconds(caption.endMs)} 秒 · {caption.text}</span><button type="button" onClick={() => void command({ type: "remove-caption", captionId: caption.id })} aria-label={`删除字幕 ${caption.text}`}>删除</button></li>)}</ul>{issues.length > 0 && <p role="alert">{issues.length} 条字幕超出保留片段，请调整裁剪或字幕。</p>}</section>
      <section><h3>封面帧</h3><label>原视频时间（秒）<input aria-label="封面时间秒数" type="number" min={seconds(recipe.trimStartMs)} max={seconds(recipe.trimEndMs)} step="0.1" value={cover} onChange={event => setCover(event.target.value)} /></label><button type="button" disabled={busy} onClick={() => void command({ type: "set-cover", sourceMs: millis(cover) })}>保存封面时间</button></section>
      {voiceover && <VoiceoverPanel {...voiceover} />}
      {voiceoverSlot}
      {agentSuggestions && <AgentSuggestionPanel {...agentSuggestions} />}
      {agentSlot}
      {error && <p role="alert">{error}</p>}
      {!voiceover && !voiceoverSlot && <button className="video-edit-render" type="button" disabled={busy || issues.length > 0 || render?.state === "pending" || render?.state === "running"} onClick={() => void finish()}>完成并云端渲染</button>}
    </div></div>
  </section>;
}
