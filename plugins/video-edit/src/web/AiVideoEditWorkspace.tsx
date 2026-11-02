import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { containedVideoRect, normalizedBox, normalizedPoint } from "./annotation-geometry";
import type { Point, Rect } from "./annotation-geometry";

type Tool = "box" | "text" | "pin";
type Annotation = { id: string; kind: "box"; x: number; y: number; width: number; height: number }
  | { id: string; kind: "text"; x: number; y: number; text: string }
  | { id: string; kind: "pin"; x: number; y: number };
interface Draft { frameMs: number; prompt: string; annotations: Annotation[] }
export interface EditableShot { id: string; title: string; startMs: number; endMs: number; inMs: number; outMs: number; url?: string }

function savedDraft(key: string, frameMs: number): Draft {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { frameMs, prompt: "", annotations: [] };
    const value = JSON.parse(raw) as Draft;
    return { frameMs: Number.isFinite(value.frameMs) ? value.frameMs : frameMs,
      prompt: typeof value.prompt === "string" ? value.prompt.slice(0, 500) : "",
      annotations: Array.isArray(value.annotations) ? value.annotations.filter(item =>
        item && ["box", "text", "pin"].includes(item.kind) && Number.isFinite(item.x) && Number.isFinite(item.y)) : [] };
  } catch { return { frameMs, prompt: "", annotations: [] }; }
}

const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}.${Math.floor(ms % 1000 / 100)}`;

/** Annotation UI for one source clip. Paid actions remain unavailable until a verified provider contract is connected. */
export function AiVideoEditWorkspace({ shot, initialFrameMs, draftKey, onClose }: {
  shot: EditableShot; initialFrameMs: number; draftKey: string; onClose: () => void;
}) {
  const [initial] = useState(() => savedDraft(draftKey, initialFrameMs));
  const [frameMs, setFrameMs] = useState(() => Math.max(shot.startMs, Math.min(shot.endMs - 100, initial.frameMs)));
  const [prompt, setPrompt] = useState(initial.prompt);
  const [annotations, setAnnotations] = useState<Annotation[]>(initial.annotations);
  const [tool, setTool] = useState<Tool>("box");
  const [pendingFrame, setPendingFrame] = useState<number | null>(null);
  const [pendingText, setPendingText] = useState<Point | null>(null);
  const [textNote, setTextNote] = useState("");
  const [previewBox, setPreviewBox] = useState<ReturnType<typeof normalizedBox> | null>(null);
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [content, setContent] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxStart = useRef<Point | null>(null);

  useEffect(() => { localStorage.setItem(draftKey, JSON.stringify({ frameMs, prompt, annotations } satisfies Draft)); }, [draftKey, frameMs, prompt, annotations]);
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) video.currentTime = (shot.inMs + frameMs - shot.startMs) / 1000;
  }, [frameMs, shot.inMs, shot.startMs]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setContent(containedVideoRect({ left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight }, dimensions.width, dimensions.height));
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.height]);
  useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);

  function pointAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return normalizedPoint(event.clientX, event.clientY, { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height });
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !content.width || !shot.url) return;
    const point = pointAt(event);
    if (tool === "box") { boxStart.current = point; setPreviewBox(normalizedBox(point, point)); event.currentTarget.setPointerCapture?.(event.pointerId); }
    else if (tool === "pin") setAnnotations(current => [...current, { id: crypto.randomUUID(), kind: "pin", ...point }]);
    else { setPendingText(point); setTextNote(""); }
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (boxStart.current) setPreviewBox(normalizedBox(boxStart.current, pointAt(event)));
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!boxStart.current) return;
    const box = normalizedBox(boxStart.current, pointAt(event));
    if (box.width >= 0.01 && box.height >= 0.01) setAnnotations(current => [...current, { id: crypto.randomUUID(), kind: "box", ...box }]);
    boxStart.current = null; setPreviewBox(null);
  }
  function addText() {
    if (!pendingText || !textNote.trim()) return;
    setAnnotations(current => [...current, { id: crypto.randomUUID(), kind: "text", ...pendingText, text: textNote.trim().slice(0, 60) }]);
    setPendingText(null); setTextNote("");
  }
  function chooseFrame(next: number) {
    if (annotations.length) setPendingFrame(next);
    else setFrameMs(next);
  }
  function selectReference(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setReferenceError("参考图片仅支持 PNG、JPEG、WebP，且不能超过 10 MB。"); return;
    }
    setReferenceError("");
    setReference({ name: file.name, url: URL.createObjectURL(file) });
  }

  return <div className="episode-ai-backdrop" role="presentation">
    <section className="episode-ai-workspace" role="dialog" aria-modal="true" aria-label={`AI 编辑 ${shot.title}`}>
      <header><div><small>整集剪辑 / 单镜头编辑</small><h2>{shot.title}</h2><p>{clock(shot.startMs)} – {clock(shot.endMs)} · 源片段 {clock(shot.inMs)} – {clock(shot.outMs)}</p></div>
        <button type="button" aria-label="关闭 AI 编辑" onClick={onClose}>×</button></header>
      <div className="episode-ai-grid">
        <section className="episode-ai-visual"><div className="episode-ai-stage" ref={stageRef}>
          {shot.url && !mediaError ? <video ref={videoRef} src={shot.url} preload="auto" playsInline muted
            onLoadedMetadata={event => { const video = event.currentTarget; setDimensions({ width: video.videoWidth, height: video.videoHeight });
              video.currentTime = (shot.inMs + frameMs - shot.startMs) / 1000; video.pause(); }}
            onError={() => setMediaError(true)} /> : <p>源视频不可用，无法对实际画面标注。</p>}
          {content.width > 0 && <div className={`episode-ai-mark-surface ${tool}`} style={{ left: content.left, top: content.top, width: content.width, height: content.height }}
            aria-label="当前视频帧标注画布" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { boxStart.current = null; setPreviewBox(null); }}>
            {annotations.map(item => item.kind === "box" ? <span key={item.id} className="episode-ai-box" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` }} />
              : item.kind === "pin" ? <span key={item.id} className="episode-ai-pin" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}>＋</span>
                : <span key={item.id} className="episode-ai-text-mark" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}>{item.text}</span>)}
            {previewBox && <span className="episode-ai-box draft" style={{ left: `${previewBox.x * 100}%`, top: `${previewBox.y * 100}%`, width: `${previewBox.width * 100}%`, height: `${previewBox.height * 100}%` }} />}
          </div>}</div>
          <div className="episode-ai-frame-control"><label>编辑时刻 <strong>{clock(frameMs)}</strong><input type="range" min={shot.startMs} max={Math.max(shot.startMs, shot.endMs - 100)} step="100" value={frameMs}
            onChange={event => chooseFrame(Number(event.target.value))} /></label></div>
        </section>
        <aside className="episode-ai-tools"><h3>标注画面</h3><p>框选是修改重点提示，不能保证像素级精准修复。</p>
          <div className="episode-ai-tool-buttons">{(["box", "text", "pin"] as const).map(item => <button key={item} type="button" aria-pressed={tool === item}
            onClick={() => setTool(item)}>{item === "box" ? "框选" : item === "text" ? "文字" : "标点"}</button>)}</div>
          {pendingText && <div className="episode-ai-text-input"><label>画面文字<input aria-label="画面文字" maxLength={60} value={textNote} onChange={event => setTextNote(event.target.value)} onKeyDown={event => { if (event.key === "Enter") addText(); }} /></label>
            <button type="button" onClick={addText} disabled={!textNote.trim()}>放到画面</button><button type="button" onClick={() => setPendingText(null)}>取消</button></div>}
          <div className="episode-ai-mark-actions"><span>{annotations.length} 个标注</span><button type="button" disabled={!annotations.length} onClick={() => setAnnotations(current => current.slice(0, -1))}>撤销标注</button>
            <button type="button" disabled={!annotations.length} onClick={() => setAnnotations([])}>清空</button></div>
          <label className="episode-ai-reference">添加参考图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { selectReference(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {reference && <div className="episode-ai-reference-preview"><img src={reference.url} alt="参考图片预览" /><span>{reference.name}</span><button type="button" onClick={() => setReference(null)}>移除</button></div>}
          {referenceError && <p role="alert">{referenceError}</p>}
        </aside>
      </div>
      <footer><label>告诉 Agent 你想怎么改<textarea maxLength={500} value={prompt} onChange={event => setPrompt(event.target.value)}
        placeholder="例如：把框选的小狗改成戴厨师帽，保持镜头运动和背景不变" /></label>
        <div><p role="status">草稿保存在本机。当前未接入经验证的视频局部编辑服务，无法报价或提交任务。</p>
          <button type="button" disabled title="等待服务端确认视频编辑供应商与费用接口">查看费用并提交</button></div></footer>
    </section>
    {pendingFrame !== null && <div className="episode-ai-frame-dialog" role="dialog" aria-modal="true" aria-label="切换标注帧"><h3>切换标注帧？</h3>
      <p>当前标注只属于 {clock(frameMs)} 这一帧。切换后需要清空标注重新绘制。</p>
      <div><button type="button" onClick={() => setPendingFrame(null)}>保留旧帧</button>
        <button type="button" onClick={() => { setAnnotations([]); setFrameMs(pendingFrame); setPendingFrame(null); }}>清空并切换</button></div></div>}
  </div>;
}
