import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent, ReactNode } from "react";
import { audioLength, clipStart, makeAudioClip, mergeTimelineDraft, moveAudioClip, positionedVisuals, reorderVisual, snapTime, timelineDifferences, timelineDuration, trimAudioClip, validateTimeline } from "./timeline-model";
import type { TimelineAsset, TimelineAudioClip, TimelineAudioKind, TimelineSnapshot } from "./timeline-model";
import { AudioWaveform } from "./AudioWaveform";
import { VideoFrameThumbnail } from "./VideoFrameThumbnail";
import { fitTimelineZoom, rulerTimeAtX } from "./timeline-ruler";
import { AiVideoEditWorkspace } from "./AiVideoEditWorkspace";
import { canSplit, deleteClip, editImpact, positionedSourceAudio, setSourceAudio, splitClip, trimVisualClip } from "./clip-edit-model";
import type { ClipEditSnapshot, ClipSelection, EditImpact, OverflowChoice, RemovedAnchorChoice } from "./clip-edit-model";

export interface TimelineOperationView {
  state: "pending" | "running" | "succeeded" | "failed";
  revision: number;
  url?: string;
  error?: string | null;
}

interface Props {
  projectTitle: string;
  episodeTitle: string;
  revision: number;
  snapshot: TimelineSnapshot;
  assets: TimelineAsset[];
  draftStorageKey: string;
  onSave: (snapshot: TimelineSnapshot) => Promise<void>;
  onRefresh?: () => Promise<TimelineSnapshot>;
  onUploadAudio?: (file: File, kind: TimelineAudioKind) => Promise<TimelineAsset>;
  onPickNativeAudio?: (kind: TimelineAudioKind) => Promise<TimelineAsset | null>;
  onPreview?: () => Promise<void>;
  preview?: TimelineOperationView | null;
  onExport?: () => Promise<void>;
  export?: TimelineOperationView | null;
  agentSlot?: ReactNode;
  ttsSlot?: ReactNode;
  /** Enabled only after the cloud episode contract persists source-audio segments and visual edits. */
  clipEditingAvailable?: boolean;
  onBack: () => void;
}

type SaveState = "saved" | "saving" | "failed" | "conflict";
type DragMode = "move" | "left" | "right";
interface DragState { id: string; mode: DragMode; x: number; original: TimelineAudioClip; before: TimelineSnapshot; changed: boolean }
interface PendingAddition { asset: TimelineAsset; startMs: number; remainingMs: number }
interface StoredDraft { revision: number; snapshot: TimelineSnapshot; base?: TimelineSnapshot }
interface PendingClipEdit { kind: "delete" | "trim"; selection: ClipSelection; impact?: EditImpact;
  trim?: { edge: "left" | "right"; amountMs: number } }
interface TrimGesture { kind: "visual" | "source"; id: string; edge: "left" | "right";
  pointerId: number; x: number; amountMs: number }

const seconds = (ms: number) => (ms / 1000).toFixed(1);
const readSeconds = (value: string) => Math.round(Number(value) * 1000);
const formatClock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}.${Math.floor(ms % 1000 / 100)}`;
const copy = (snapshot: TimelineSnapshot): TimelineSnapshot => structuredClone(snapshot);
const sameSavedContent = (left: TimelineSnapshot, right: TimelineSnapshot) => {
  const persistent = (snapshot: TimelineSnapshot) => ({ ...snapshot,
    audio: snapshot.audio.map(({ historical: _historical, ...clip }) => clip) });
  return JSON.stringify(persistent(left)) === JSON.stringify(persistent(right));
};
function savedDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { revision?: number; snapshot?: TimelineSnapshot };
    return Number.isSafeInteger(value.revision) && value.snapshot?.visuals && value.snapshot?.audio
      ? value as StoredDraft : null;
  } catch { return null; }
}

function saveFailure(cause: unknown): { state: "failed" | "conflict"; message: string } {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (/409|冲突|版本|另一端|已更新|已修改|revision|conflict/i.test(detail))
    return { state: "conflict", message: "云端分集已被更新。本地草稿已保留，请查看两端差异后尝试合并。" };
  if (/fetch|network|网络|连接|offline|json|unexpected end|load failed/i.test(detail) ||
      typeof navigator !== "undefined" && !navigator.onLine)
    return { state: "failed", message: "网络连接中断或服务端暂时不可用。本地草稿已保留；恢复连接后点“重试保存”。" };
  return { state: "failed", message: `${detail || "保存失败"}。本地草稿已保留，可重试保存。` };
}

/** Full-episode editor. One pointer gesture becomes one history step and one save request. */
export function EpisodeTimelineEditor({ projectTitle, episodeTitle, revision, snapshot, assets, draftStorageKey, onSave,
  onRefresh, onUploadAudio, onPickNativeAudio, onPreview, preview, onExport, export: exported, agentSlot, ttsSlot,
  clipEditingAvailable = false, onBack }: Props) {
  const [draft, setDraft] = useState<ClipEditSnapshot>(() => savedDraft(draftStorageKey)?.snapshot ?? copy(snapshot));
  const draftRef = useRef(draft);
  const [library, setLibrary] = useState<TimelineAsset[]>(assets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [pendingClipEdit, setPendingClipEdit] = useState<PendingClipEdit | null>(null);
  const [removedAnchorChoice, setRemovedAnchorChoice] = useState<RemovedAnchorChoice | "">("");
  const [confirmedOverflowIds, setConfirmedOverflowIds] = useState<string[]>([]);
  const [sourceVolume, setSourceVolume] = useState("100");
  const [sourceIn, setSourceIn] = useState("0.0");
  const [sourceOut, setSourceOut] = useState("0.0");
  const [visualIn, setVisualIn] = useState("0.0");
  const [visualOut, setVisualOut] = useState("0.0");
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const startedAt = useRef(0);
  const [playbackStatus, setPlaybackStatus] = useState("");
  const [saveState, setSaveState] = useState<SaveState>(() => {
    const recovered = savedDraft(draftStorageKey);
    return recovered ? recovered.revision === revision &&
      (recovered.snapshot.sourceAudio === undefined) === (snapshot.sourceAudio === undefined) ? "failed" : "conflict" : "saved";
  });
  const [error, setError] = useState(() => {
    const recovered = savedDraft(draftStorageKey);
    return recovered && (recovered.revision !== revision ||
      (recovered.snapshot.sourceAudio === undefined) !== (snapshot.sourceAudio === undefined))
      ? "云端分集时间线或版本已变化，本地草稿已保留。请查看云端版本后决定如何处理。" : "";
  });
  const [cloudVersion, setCloudVersion] = useState<TimelineSnapshot | null>(null);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [pendingAddition, setPendingAddition] = useState<PendingAddition | null>(null);
  const [uploadKind, setUploadKind] = useState<TimelineAudioKind>("voice");
  const [zoom, setZoom] = useState(1);
  const [showAgent, setShowAgent] = useState(false);
  const [showTts, setShowTts] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [form, setForm] = useState({ start: "0.0", inPoint: "0.0", outPoint: "0.0", volume: "100", anchor: "episode" });
  const [originalVolume, setOriginalVolume] = useState(String(Math.round(draft.originalVolume * 100)));
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerDragRef = useRef<{ pointerId: number; beforeMs: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const dragRef = useRef<DragState | null>(null);
  const trimGestureRef = useRef<TrimGesture | null>(null);
  const [trimPreview, setTrimPreview] = useState<TrimGesture | null>(null);
  const historyRef = useRef<TimelineSnapshot[]>([]);
  const futureRef = useRef<TimelineSnapshot[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const changeSerial = useRef(0);
  const seenRevision = useRef(revision);
  const baseSnapshot = useRef<TimelineSnapshot>(savedDraft(draftStorageKey)?.base ?? copy(snapshot));
  const mergeBaseKnown = useRef(!savedDraft(draftStorageKey) || !!savedDraft(draftStorageKey)?.base || savedDraft(draftStorageKey)?.revision === revision);
  const visuals = useMemo(() => positionedVisuals(draft.visuals), [draft.visuals]);
  const duration = timelineDuration(draft.visuals);
  const pixelsPerSecond = 76 * zoom;
  const laneWidth = Math.max(120, duration / 1000 * pixelsPerSecond);
  const selected = draft.audio.find(item => item.id === selectedId);
  const selectedAsset = library.find(item => item.id === selected?.assetId);
  const activeVisual = visuals.find(item => playhead >= item.startMs && playhead < item.endMs) ?? visuals[visuals.length - 1];
  const selectedVisual = visuals.find(item => item.id === selectedVisualId) ?? activeVisual;
  const selectedSource = positionedSourceAudio(draft).find(item => item.id === selectedSourceId);
  const clipEditingReady = clipEditingAvailable && draft.sourceAudio !== undefined;
  const clipSelection: ClipSelection | null = selectedSourceId && selectedSource ? { kind: "source", id: selectedSourceId }
    : selectedId && selected ? { kind: selected.kind, id: selectedId }
      : selectedVisualId && visuals.some(item => item.id === selectedVisualId) ? { kind: "visual", id: selectedVisualId } : null;
  const canSplitSelected = clipEditingReady && canSplit(draft, clipSelection, playhead);
  const requiredOverflow = pendingClipEdit?.impact?.overflowingAudio.filter(item =>
    !(removedAnchorChoice === "remove" && pendingClipEdit.impact?.removedAnchoredAudio.includes(item.clip))) ?? [];
  const overflowConfirmed = requiredOverflow.every(item => confirmedOverflowIds.includes(item.clip.id));
  const activeVideoAsset = library.find(item => item.id === activeVisual?.assetId);
  const snapPoints = [0, playhead, ...visuals.map(item => item.startMs), duration];
  const currentPreview = preview?.revision === revision && saveState === "saved" ? preview : null;
  const currentExport = exported?.revision === revision && saveState === "saved" ? exported : null;

  useEffect(() => { setLibrary(assets); }, [assets]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, 88 + playheadRef.current / 1000 * pixelsPerSecond - scroll.clientWidth / 2);
  }, [zoom]);
  useEffect(() => {
    if (!showTts) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setShowTts(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showTts]);
  useEffect(() => { setOriginalVolume(String(Math.round(draft.originalVolume * 100))); }, [draft.originalVolume]);
  useEffect(() => { if (selectedSource) {
    setSourceVolume(String(Math.round(selectedSource.volume * 100)));
    setSourceIn(seconds(selectedSource.inMs)); setSourceOut(seconds(selectedSource.outMs));
  } }, [selectedSource?.id, selectedSource?.inMs, selectedSource?.outMs, selectedSource?.volume]);
  useEffect(() => { if (selectedVisual) { setVisualIn(seconds(selectedVisual.inMs)); setVisualOut(seconds(selectedVisual.outMs)); } },
    [selectedVisual?.id, selectedVisual?.inMs, selectedVisual?.outMs]);
  useEffect(() => {
    if (!selected) return;
    setForm({ start: seconds(clipStart(selected, draft.visuals)), inPoint: seconds(selected.inMs),
      outPoint: seconds(selected.outMs), volume: String(Math.round(selected.volume * 100)),
      anchor: selected.anchor?.kind === "visual-clip" ? "shot" : "episode" });
  }, [selected?.id, selected?.startMs, selected?.inMs, selected?.outMs, selected?.volume, selected?.anchor?.kind]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (saveState === "saved") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);
  useEffect(() => {
    if (revision === seenRevision.current) return;
    seenRevision.current = revision;
    if (sameSavedContent(snapshot, draftRef.current)) {
      baseSnapshot.current = copy(snapshot); return;
    }
    if (saveState !== "saved") {
      setSaveState("conflict"); setError("云端分集版本已变化，本地草稿已保留。请查看云端版本后决定如何处理。");
      return;
    }
    const next = copy(snapshot);
    draftRef.current = next; setDraft(next);
    baseSnapshot.current = copy(next);
    historyRef.current = []; futureRef.current = []; setHistoryCount(0); setFutureCount(0);
  }, [revision, snapshot, saveState]);

  function updateDraft(next: TimelineSnapshot) { draftRef.current = next; setDraft(next); }
  function storeDraft(next: TimelineSnapshot) {
    localStorage.setItem(draftStorageKey, JSON.stringify({ revision: savedDraft(draftStorageKey)?.revision ?? revision,
      snapshot: next, base: baseSnapshot.current } satisfies StoredDraft));
  }
  function persist(next: TimelineSnapshot, afterMerge = false) {
    if (saveState === "conflict" && !afterMerge) { setError("分集版本冲突。请先查看云端版本，本地草稿已保留。"); return false; }
    const problem = validateTimeline(next, library);
    if (problem) { setError(problem); return false; }
    const serial = ++changeSerial.current;
    setError(""); setSaveState("saving");
    storeDraft(next);
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => onSave(next)).then(() => {
      if (serial === changeSerial.current) { baseSnapshot.current = copy(next); mergeBaseKnown.current = true;
        setSaveState("saved"); localStorage.removeItem(draftStorageKey); }
    }).catch(cause => {
      if (serial === changeSerial.current) {
        const failure = saveFailure(cause);
        setSaveState(failure.state); setError(failure.message);
      }
    });
    return true;
  }
  function commit(next: TimelineSnapshot, before = draftRef.current, trackHistory = true) {
    const problem = validateTimeline(next, library);
    if (problem) { setError(problem); updateDraft(before); return; }
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    if (trackHistory) {
      historyRef.current.push(copy(before)); futureRef.current = [];
      setHistoryCount(historyRef.current.length); setFutureCount(0);
    }
    updateDraft(next);
    if (saveState === "conflict") {
      storeDraft(next);
      setError("分集版本冲突。本地修改已保存为草稿，请先查看云端版本。");
    } else persist(next);
  }
  function undo() {
    const previous = historyRef.current.pop(); if (!previous) return;
    futureRef.current.push(copy(draftRef.current)); setHistoryCount(historyRef.current.length); setFutureCount(futureRef.current.length);
    commit(previous, draftRef.current, false);
  }
  function redo() {
    const next = futureRef.current.pop(); if (!next) return;
    historyRef.current.push(copy(draftRef.current)); setHistoryCount(historyRef.current.length); setFutureCount(futureRef.current.length);
    commit(next, draftRef.current, false);
  }
  function changeClip(id: string, transform: (clip: TimelineAudioClip) => TimelineAudioClip) {
    commit({ ...draftRef.current, audio: draftRef.current.audio.map(item => item.id === id ? transform(item) : item) });
  }
  function choose(selection: ClipSelection | null) {
    setSelectedVisualId(selection?.kind === "visual" ? selection.id : null);
    setSelectedSourceId(selection?.kind === "source" ? selection.id : null);
    setSelectedId(selection?.kind === "voice" || selection?.kind === "music" ? selection.id : null);
  }
  function splitSelected() {
    if (!clipEditingReady || !clipSelection) return;
    try {
      const next = splitClip(draftRef.current, clipSelection, playheadRef.current, () => crypto.randomUUID());
      commit(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function requestDelete() {
    if (!clipEditingReady || !clipSelection ||
        clipSelection.kind === "visual" && draftRef.current.visuals.length <= 1) return;
    const nextVisuals = clipSelection.kind === "visual"
      ? draftRef.current.visuals.filter(item => item.id !== clipSelection.id) : null;
    const impact = nextVisuals ? editImpact(draftRef.current, nextVisuals, clipSelection.id) : undefined;
    setRemovedAnchorChoice(""); setConfirmedOverflowIds([]);
    setPendingClipEdit({ kind: "delete", selection: clipSelection, impact });
  }
  function requestVisualTrim(edge: "left" | "right", targetMs?: number, clipId = selectedVisualId) {
    const visual = draftRef.current.visuals.find(item => item.id === clipId);
    if (!clipEditingReady || !visual) return;
    const target = targetMs ?? readSeconds(edge === "left" ? visualIn : visualOut);
    const amountMs = edge === "left" ? target - visual.inMs : visual.outMs - target;
    if (!Number.isSafeInteger(amountMs) || amountMs < 0 ||
        visual.outMs - visual.inMs - amountMs < 300) {
      setError("仅可向内裁剪；画面片段至少保留 0.3 秒"); return;
    }
    if (!amountMs) return;
    const changed = draftRef.current.visuals.map(item => item.id !== visual.id ? item
      : edge === "left" ? { ...item, inMs: target } : { ...item, outMs: target });
    setRemovedAnchorChoice(""); setConfirmedOverflowIds([]);
    setPendingClipEdit({ kind: "trim", selection: { kind: "visual", id: visual.id },
      trim: { edge, amountMs }, impact: editImpact(draftRef.current, changed) });
  }
  function beginTrim(event: PointerEvent<HTMLElement>, kind: "visual" | "source", id: string, edge: "left" | "right") {
    if (!clipEditingReady || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    const gesture = { kind, id, edge, pointerId: event.pointerId, x: event.clientX, amountMs: 0 };
    trimGestureRef.current = gesture; setTrimPreview(gesture);
    event.currentTarget.setPointerCapture(event.pointerId);
    choose({ kind, id } as ClipSelection);
  }
  function trimAmount(event: PointerEvent<HTMLElement>, gesture: TrimGesture): number {
    const delta = Math.round((event.clientX - gesture.x) / pixelsPerSecond * 10) * 100;
    const clip = gesture.kind === "visual"
      ? draftRef.current.visuals.find(item => item.id === gesture.id)
      : draftRef.current.sourceAudio?.find(item => item.id === gesture.id);
    return Math.min(Math.max(0, (clip?.outMs ?? 0) - (clip?.inMs ?? 0) - 300),
      Math.max(0, gesture.edge === "left" ? delta : -delta));
  }
  function moveTrim(event: PointerEvent<HTMLElement>) {
    const gesture = trimGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const amountMs = trimAmount(event, gesture);
    setTrimPreview({ ...gesture, amountMs });
  }
  function finishTrim(event: PointerEvent<HTMLElement>) {
    const gesture = trimGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    trimGestureRef.current = null; setTrimPreview(null);
    const amountMs = trimAmount(event, gesture);
    if (!amountMs) return;
    if (gesture.kind === "visual") {
      const clip = draftRef.current.visuals.find(item => item.id === gesture.id);
      if (!clip) return;
      requestVisualTrim(gesture.edge, gesture.edge === "left" ? clip.inMs + amountMs : clip.outMs - amountMs, gesture.id);
      return;
    }
    const clip = draftRef.current.sourceAudio?.find(item => item.id === gesture.id);
    if (!clip) return;
    try { commit(setSourceAudio(draftRef.current, clip.id, gesture.edge === "left"
      ? { inMs: clip.inMs + amountMs } : { outMs: clip.outMs - amountMs })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function confirmClipEdit() {
    const pending = pendingClipEdit;
    if (!pending) return;
    if (pending.impact?.removedAnchoredAudio.length && !removedAnchorChoice) return;
    if (!overflowConfirmed) return;
    const overflow: OverflowChoice | undefined = requiredOverflow.length ? "trim" : undefined;
    try {
      const next = pending.kind === "delete"
        ? deleteClip(draftRef.current, pending.selection, {
          removedAnchor: removedAnchorChoice || undefined, overflow })
        : trimVisualClip(draftRef.current, pending.selection.id, pending.trim!.edge,
          pending.trim!.amountMs, overflow);
      commit(next); choose(null); setPendingClipEdit(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => {
    if (!clipEditingReady) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingClipEdit || showAi || showTts ||
          event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); requestDelete(); }
      else if (event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); splitSelected(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
  function addAsset(asset: TimelineAsset, startMs: number, allowTrim = false) {
    const remainingMs = duration - startMs;
    if (asset.durationMs > remainingMs && !allowTrim) {
      setPendingAddition({ asset, startMs, remainingMs }); return;
    }
    try {
      const clip = makeAudioClip(asset, startMs, draftRef.current.visuals, () => crypto.randomUUID());
      commit({ ...draftRef.current, audio: [...draftRef.current.audio, clip] }); choose({ kind: clip.kind, id: clip.id }); setPendingAddition(null);
    } catch (cause) { setError(String(cause)); }
  }
  function onAssetDrop(event: DragEvent<HTMLDivElement>, kind: TimelineAudioKind) {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-avs-audio");
    const asset = library.find(item => item.id === id && item.kind === kind);
    if (!asset) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addAsset(asset, snapTime((event.clientX - rect.left) / pixelsPerSecond * 1000, snapPoints));
  }
  function seek(ms: number) {
    const next = Math.max(0, Math.min(duration, Math.round(ms / 100) * 100));
    playheadRef.current = next; setPlayhead(next);
    if (playingRef.current) startedAt.current = performance.now() - next;
    syncMedia(next);
  }
  function seekFromRuler(event: PointerEvent<HTMLDivElement>) {
    const scroll = scrollRef.current;
    if (scroll && rulerDragRef.current) {
      const visible = scroll.getBoundingClientRect();
      if (event.clientX > visible.right - 28) scroll.scrollLeft += 22;
      else if (event.clientX < visible.left + 116) scroll.scrollLeft -= 22;
    }
    seek(rulerTimeAtX(event.clientX, event.currentTarget.getBoundingClientRect().left, pixelsPerSecond, duration));
  }
  function beginRulerDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    rulerDragRef.current = { pointerId: event.pointerId, beforeMs: playheadRef.current };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFromRuler(event);
  }
  function moveRulerDrag(event: PointerEvent<HTMLDivElement>) {
    if (rulerDragRef.current?.pointerId === event.pointerId) seekFromRuler(event);
  }
  function finishRulerDrag(event: PointerEvent<HTMLDivElement>) {
    if (rulerDragRef.current?.pointerId !== event.pointerId) return;
    seekFromRuler(event);
    rulerDragRef.current = null;
  }
  function cancelRulerDrag(event: PointerEvent<HTMLDivElement>) {
    if (rulerDragRef.current?.pointerId !== event.pointerId) return;
    seek(rulerDragRef.current.beforeMs);
    rulerDragRef.current = null;
  }
  function openAiEditor(clip = selectedVisual) {
    if (!clip) return;
    choose({ kind: "visual", id: clip.id });
    playingRef.current = false; setPlaying(false);
    videoRef.current?.pause();
    for (const audio of audioRefs.current.values()) audio.pause();
    setShowAi(true);
  }
  function syncMedia(time: number) {
    const visual = positionedVisuals(draftRef.current.visuals).find(item => time >= item.startMs && time < item.endMs);
    const video = videoRef.current;
    if (video && visual) {
      const desired = (visual.inMs + time - visual.startMs) / 1000;
      if (Math.abs(video.currentTime - desired) > 0.18) video.currentTime = desired;
      const source = positionedSourceAudio(draftRef.current).find(item => time >= item.startMs && time < item.endMs);
      video.volume = draftRef.current.sourceAudio === undefined
        ? Math.min(1, Math.max(0, draftRef.current.originalVolume * visual.volume))
        : source && !source.muted
          ? Math.min(1, Math.max(0, draftRef.current.originalVolume * source.volume)) : 0;
      if (playingRef.current && video.paused) void video.play().catch(cause => { setPlaybackStatus(`画面试听失败：${String(cause)}`); });
    }
    for (const clip of draftRef.current.audio) {
      const element = audioRefs.current.get(clip.id);
      if (!element) continue;
      const start = clipStart(clip, draftRef.current.visuals);
      const active = time >= start && time < start + audioLength(clip);
      if (!active || !playingRef.current) { if (!element.paused) element.pause(); continue; }
      const desired = (clip.inMs + time - start) / 1000;
      if (Math.abs(element.currentTime - desired) > 0.18) element.currentTime = desired;
      element.volume = Math.min(1, Math.max(0, clip.volume));
      if (element.paused) void element.play().catch(cause => { setPlaybackStatus(`音频试听失败：${String(cause)}`); });
    }
  }
  useEffect(() => {
    if (!playing) { syncMedia(playheadRef.current); videoRef.current?.pause(); return; }
    playingRef.current = true;
    startedAt.current = performance.now() - playheadRef.current;
    let frame = 0;
    const tick = () => {
      const time = Math.min(duration, performance.now() - startedAt.current);
      playheadRef.current = time; setPlayhead(time); syncMedia(time);
      if (time >= duration) { playingRef.current = false; setPlaying(false); setPlaybackStatus(""); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); playingRef.current = false; videoRef.current?.pause();
      audioRefs.current.forEach(element => element.pause()); };
  }, [playing, duration]);
  useEffect(() => { syncMedia(playheadRef.current); }, [activeVisual?.id, draft.audio, draft.originalVolume, draft.sourceAudio]);

  function beginDrag(event: PointerEvent<HTMLElement>, clip: TimelineAudioClip, mode: DragMode) {
    if (event.button !== 0) return;
    choose({ kind: clip.kind, id: clip.id });
    dragRef.current = { id: clip.id, mode, x: event.clientX, original: copy({ visuals: [], audio: [clip], originalVolume: 1 }).audio[0],
      before: copy(draftRef.current), changed: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current; if (!drag) return;
    const delta = (event.clientX - drag.x) / pixelsPerSecond * 1000;
    const start = clipStart(drag.original, drag.before.visuals);
    const nextClip = drag.mode === "move"
      ? moveAudioClip(drag.original, snapTime(start + delta, snapPoints), drag.before.visuals)
      : trimAudioClip(drag.original, drag.mode, delta, drag.before.visuals);
    drag.changed = JSON.stringify(nextClip) !== JSON.stringify(drag.original);
    updateDraft({ ...drag.before, audio: drag.before.audio.map(item => item.id === drag.id ? nextClip : item) });
  }
  function finishDrag() {
    const drag = dragRef.current; dragRef.current = null;
    if (!drag) return;
    if (!drag.changed) { updateDraft(drag.before); return; }
    commit(draftRef.current, drag.before);
  }
  function cancelDrag() {
    const drag = dragRef.current; dragRef.current = null;
    if (drag) updateDraft(drag.before);
  }
  function applyForm() {
    if (!selected) return;
    const startMs = readSeconds(form.start), inMs = readSeconds(form.inPoint), outMs = readSeconds(form.outPoint), volume = Number(form.volume) / 100;
    if (![startMs, inMs, outMs, volume].every(Number.isFinite)) { setError("请输入有效时间和音量"); return; }
    const anchor = form.anchor === "shot" ? positionedVisuals(draft.visuals).find(item => startMs >= item.startMs && startMs < item.endMs) : undefined;
    changeClip(selected.id, item => ({ ...item, startMs, inMs, outMs, volume,
      anchor: anchor ? { kind: "visual-clip", clipId: anchor.id, offsetMs: startMs - anchor.startMs } : { kind: "absolute" } }));
  }
  async function upload(file: File) {
    if (!onUploadAudio) return;
    setError("");
    try {
      const asset = await onUploadAudio(file, uploadKind);
      setLibrary(current => current.some(item => item.id === asset.id) ? current : [...current, asset]);
    } catch (cause) { setError(String(cause)); }
  }
  async function pickNative(kind: TimelineAudioKind) {
    if (!onPickNativeAudio) return;
    setError("");
    try {
      const asset = await onPickNativeAudio(kind);
      if (asset) setLibrary(current => current.some(item => item.id === asset.id) ? current : [...current, asset]);
    } catch (cause) { setError(String(cause)); }
  }
  async function retrySave() { persist(draftRef.current); }
  function mergeCloud() {
    if (!cloudVersion) return;
    if (!mergeBaseKnown.current) { setError("这份旧草稿缺少可核对的共同版本，无法安全自动合并。请比较差异，保留草稿或使用云端版本。"); return; }
    const merged = mergeTimelineDraft(baseSnapshot.current, draftRef.current, cloudVersion);
    if (merged.conflicts.length) { setError(`自动合并需要人工决定：${merged.conflicts.join("；")}。可保留本地草稿或使用云端版本。`); return; }
    const problem = validateTimeline(merged.snapshot, library);
    if (problem) { setError(`合并后的时间线需要调整：${problem}`); return; }
    baseSnapshot.current = copy(cloudVersion);
    mergeBaseKnown.current = true;
    updateDraft(merged.snapshot); setCloudVersion(null);
    persist(merged.snapshot, true);
  }
  function acceptCloud() {
    if (!cloudVersion) return;
    localStorage.setItem(`${draftStorageKey}:conflict-backup`, JSON.stringify({ revision, snapshot: draftRef.current }));
    localStorage.removeItem(draftStorageKey);
    baseSnapshot.current = copy(cloudVersion);
    mergeBaseKnown.current = true;
    updateDraft(copy(cloudVersion)); setCloudVersion(null); setSaveState("saved"); setError("");
    historyRef.current = []; futureRef.current = []; setHistoryCount(0); setFutureCount(0);
  }
  function backToCanvas() {
    if (saveState === "saved") onBack();
    else if (saveState !== "saving") setLeavePrompt(true);
  }

  return <section className="episode-editor" aria-label="整集剪辑">
    <header className="episode-editor-top"><div className="episode-editor-brand"><strong>✦ AI Video Studio</strong><span>/</span><span>{projectTitle} / {episodeTitle} / 整集剪辑</span></div>
      <div className="episode-editor-top-actions"><span role="status" data-state={saveState}>{saveState === "saved" ? "已保存" : saveState === "saving" ? "保存中…" : saveState === "conflict" ? "版本冲突" : "保存失败"}</span>
        <button type="button" onClick={backToCanvas} disabled={saveState === "saving"}>返回画布</button>
        <button type="button" onClick={undo} disabled={!historyCount}>撤销</button><button type="button" onClick={redo} disabled={!futureCount}>重做</button>
        {agentSlot && <button type="button" onClick={() => setShowAgent(value => !value)}>Agent 建议</button>}
        <button type="button" onClick={() => openAiEditor()} disabled={!visuals.length}>✦ AI 视频编辑</button>
        <button type="button" onClick={() => void onPreview?.().catch(cause => setError(String(cause)))} disabled={!onPreview || saveState !== "saved" || !duration}>精准预览</button>
        <button type="button" className="primary" onClick={() => void onExport?.().catch(cause => setError(String(cause)))}
          disabled={!onExport || saveState !== "saved" || currentPreview?.state !== "succeeded"}>导出成片</button>
      </div></header>
    {(error || playbackStatus || saveState === "failed" || saveState === "conflict") && <div className="episode-editor-notice" role="alert">{error || playbackStatus || (saveState === "failed" ? "有未保存的本地草稿，请重试保存。" : "分集版本已变化，本地草稿已保留。")}
      {saveState === "failed" && <button type="button" onClick={() => void retrySave()}>重试保存</button>}
      {saveState === "conflict" && onRefresh && <button type="button" onClick={() => void onRefresh().then(setCloudVersion).catch(cause => setError(String(cause)))}>查看云端版本</button>}</div>}
    {cloudVersion && <div className="episode-editor-cloud-diff" role="status"><strong>本地草稿与云端版本</strong>
      <p>云端有 {cloudVersion.visuals.length} 个镜头、{cloudVersion.audio.length} 个音频片段。以下差异不会自动覆盖；选择云端版本时会另存本地草稿备份。</p>
      <ul>{timelineDifferences(draft, cloudVersion, library).map(item => <li key={item}>{item}</li>)}</ul>
      <div><button type="button" onClick={mergeCloud}>重试合并本地草稿</button>
        <button type="button" onClick={acceptCloud}>使用云端版本继续</button>
        <button type="button" onClick={() => setCloudVersion(null)}>继续查看本地草稿</button></div></div>}
    <div className="episode-editor-workspace">
      <aside className="episode-editor-assets"><h2>素材库</h2><p>录音和音乐准备好后，拖到下方音轨。添加到时间线不会删除原素材。</p>
        {(["voice", "music"] as const).map(kind => <section key={kind} className="episode-editor-asset-group"><h3>{kind === "voice" ? "配音" : "背景音乐"}</h3>
          <div className="episode-editor-source-actions">
            {kind === "voice" && <>
              {(onUploadAudio || onPickNativeAudio) && <button type="button" onClick={() => { if (onPickNativeAudio) void pickNative("voice"); else { setUploadKind("voice"); fileRef.current?.click(); } }}>上传录音</button>}
              {ttsSlot && <button type="button" onClick={() => setShowTts(true)}>文字生成旁白</button>}
            </>}
            {kind === "music" && (onUploadAudio || onPickNativeAudio) && <button type="button" onClick={() => { if (onPickNativeAudio) void pickNative("music"); else { setUploadKind("music"); fileRef.current?.click(); } }}>上传背景音乐</button>}
          </div>
          {library.filter(item => item.kind === kind).map(asset => <div key={asset.id} className="episode-editor-asset-entry">
            <button type="button" draggable onDragStart={event => event.dataTransfer.setData("application/x-avs-audio", asset.id)}
              onClick={() => addAsset(asset, Math.round(playhead / 100) * 100)} className="episode-editor-asset">
              <span>{kind === "voice" ? "♪" : "♫"}</span><strong>{asset.name}</strong><small>{seconds(asset.durationMs)} 秒</small>
              <em>{kind === "voice" ? "加入配音轨" : "加入音乐轨"}</em></button>
            {kind === "voice" && asset.url && <audio controls preload="metadata" src={asset.url} aria-label={`试听${asset.name}`} />}
          </div>)}
          {!library.some(item => item.kind === kind) && <p>暂无{kind === "voice" ? "配音" : "音乐"}素材</p>}</section>)}
        {onUploadAudio && <input ref={fileRef} type="file" accept=".wav,.mp3,.m4a,audio/*" aria-label="上传音频文件" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />}
      </aside>
      <main className="episode-editor-main"><section className="episode-editor-viewer" aria-label="整集预览"><div><h1>{episodeTitle}</h1><p>{visuals.length} 个镜头 · {seconds(duration)} 秒 · 对齐声音与画面</p></div>
          <div className="episode-editor-stage">{activeVideoAsset?.url ? <video key={activeVisual?.id} ref={videoRef} src={activeVideoAsset.url} preload="auto" playsInline
            onWaiting={() => setPlaybackStatus("视频缓冲中，声音可能暂时不同步")}
            onPlaying={() => setPlaybackStatus("")} /> : <p>{duration ? "视频素材不可用，请刷新或检查项目资产" : "先在画布加入视频镜头"}</p>}
            <span>{activeVisual?.title ?? "空分集"}</span></div>
          <div className="episode-editor-transport"><button type="button" onClick={() => { if (playing) { setPlaying(false); playingRef.current = false; } else if (duration) { playingRef.current = true; syncMedia(playheadRef.current); setPlaying(true); } }} disabled={!duration} aria-label={playing ? "暂停试听" : "播放试听"}>{playing ? "Ⅱ" : "▶"}</button>
            <time>{formatClock(playhead)}</time><input type="range" aria-label="播放头位置" min="0" max={duration} step="100" value={Math.min(duration, Math.round(playhead / 100) * 100)} onChange={event => seek(Number(event.target.value))} />
            <time>{formatClock(duration)}</time><small>即时试听 · 精准结果以云端预览为准</small></div>
          {draft.audio.map(clip => <audio key={clip.id} ref={element => { if (element) audioRefs.current.set(clip.id, element); else audioRefs.current.delete(clip.id); }} src={library.find(item => item.id === clip.assetId)?.url} preload="auto" aria-hidden="true" />)}
          {currentPreview && <div className="episode-editor-operation" role="status">精准预览：{currentPreview.state}{currentPreview.error ? ` · ${currentPreview.error}` : ""}{currentPreview.url && <video controls src={currentPreview.url} aria-label="精准预览视频" />}</div>}
          {currentExport && <div className="episode-editor-operation" role="status">整集成片：{currentExport.state}{currentExport.error ? ` · ${currentExport.error}` : ""}{currentExport.url && <video controls src={currentExport.url} aria-label="整集成片" />}</div>}
        </section>
        <section className="episode-editor-timeline" aria-label="统一时间线"><header><h2>整集时间线</h2>
          <div className="episode-editor-clip-tools" aria-label="片段操作">
            <span>{clipSelection ? `${clipSelection.kind === "visual" ? "画面" : clipSelection.kind === "source" ? "镜头原声" : clipSelection.kind === "voice" ? "配音" : "音乐"}已选中` : "选择片段后编辑"}</span>
            <button type="button" onClick={splitSelected} disabled={!canSplitSelected} title={!clipEditingReady ? "请先处理旧本地草稿或等待云端时间线就绪" : "在播放头处分割所选片段"}>分割片段 S</button>
            <button type="button" onClick={requestDelete} disabled={!clipEditingReady || !clipSelection || clipSelection.kind === "visual" && draft.visuals.length <= 1}
              title={!clipEditingReady ? "请先处理旧本地草稿或等待云端时间线就绪" : "删除前查看影响"}>删除本段 Delete</button>
          </div>
          <div className="episode-editor-zoom"><button type="button" aria-label="缩小时间线" onClick={() => setZoom(value => Math.max(0.25, Math.round((value - 0.25) * 100) / 100))}>－</button>
            <button type="button" onClick={() => setZoom(fitTimelineZoom(duration, scrollRef.current?.clientWidth ?? 900))}>适配全片</button>
            <button type="button" aria-label="放大时间线" onClick={() => setZoom(value => Math.min(2.5, Math.round((value + 0.25) * 100) / 100))}>＋</button>
            <output>{Math.round(zoom * 100)}%</output></div></header>
          <div className="episode-editor-scroll" ref={scrollRef}><div className="episode-editor-tracks" style={{ width: laneWidth + 88 }}>
            <div className="episode-editor-row ruler"><strong>时间尺</strong><div className="episode-editor-lane" style={{ width: laneWidth }}
              role="slider" tabIndex={0} aria-label="时间尺播放头" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={playhead} aria-valuetext={formatClock(playhead)}
              onPointerDown={beginRulerDrag} onPointerMove={moveRulerDrag} onPointerUp={finishRulerDrag} onPointerCancel={cancelRulerDrag}
              onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seek(playheadRef.current + (event.key === "ArrowRight" ? 100 : -100)); }
                else if (event.key === "Home" || event.key === "End") { event.preventDefault(); seek(event.key === "Home" ? 0 : duration); }
                else if (event.key === "Escape" && rulerDragRef.current) { event.preventDefault(); seek(rulerDragRef.current.beforeMs); rulerDragRef.current = null; } }}>
              {Array.from({ length: Math.min(3600, Math.floor(duration / 1000) + 1) }, (_, index) => <span key={index} className={index % 5 === 0 ? "major" : "minor"} style={{ left: index * pixelsPerSecond }}>{index % 5 === 0 ? `${index}s` : ""}</span>)}</div></div>
            <div className="episode-editor-row visual"><strong>画面</strong><div className="episode-editor-lane" style={{ width: laneWidth }} onClick={event => { if (event.target === event.currentTarget) choose(null); }}>{visuals.map((clip, index) => <div key={clip.id} className={`episode-editor-visual-clip${selectedVisualId === clip.id ? " selected" : ""}`}
              style={{ left: (clip.startMs + (trimPreview?.kind === "visual" && trimPreview.id === clip.id && trimPreview.edge === "left"
                ? Math.min(trimPreview.amountMs, clip.endMs - clip.startMs - 300) : 0)) / 1000 * pixelsPerSecond,
                width: (clip.endMs - clip.startMs - (trimPreview?.kind === "visual" && trimPreview.id === clip.id
                  ? Math.min(trimPreview.amountMs, clip.endMs - clip.startMs - 300) : 0)) / 1000 * pixelsPerSecond }}
              role="button" tabIndex={0} aria-label={`选择镜头：${clip.title}`} onClick={() => choose({ kind: "visual", id: clip.id })}
              draggable={clipEditingReady} onDragStart={event => event.dataTransfer.setData("application/x-avs-visual", clip.id)}
              onDragOver={event => { if (clipEditingReady) event.preventDefault(); }}
              onDrop={event => { event.preventDefault(); const movedId = event.dataTransfer.getData("application/x-avs-visual");
                const current = draftRef.current.visuals; const from = current.findIndex(item => item.id === movedId);
                const to = current.findIndex(item => item.id === clip.id); if (from < 0 || to < 0 || from === to) return;
                const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
                commit({ ...draftRef.current, visuals: next }); choose({ kind: "visual", id: movedId }); }}
              onDoubleClick={() => openAiEditor(clip)}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose({ kind: "visual", id: clip.id }); } }}>
              {clipEditingReady && <span className="episode-editor-trim-handle left" aria-label={`裁剪${clip.title}左边缘`} onPointerDown={event => beginTrim(event, "visual", clip.id, "left")}
                onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={() => { trimGestureRef.current = null; setTrimPreview(null); }} />}
              <VideoFrameThumbnail url={library.find(item => item.id === clip.assetId)?.url} atMs={clip.inMs + Math.min(250, (clip.endMs - clip.startMs) / 2)} />
              <span className="episode-editor-visual-title"><small>镜头 {String(index + 1).padStart(2, "0")}</small><strong>{clip.title}</strong><small>{seconds(clip.endMs - clip.startMs)} 秒</small></span>
              <span className="episode-editor-visual-order"><button type="button" disabled={index === 0} aria-label={`将${clip.title}前移`}
                onClick={event => { event.stopPropagation(); commit(reorderVisual(draftRef.current, clip.id, -1)); }}>←</button>
                <button type="button" disabled={index === visuals.length - 1} aria-label={`将${clip.title}后移`}
                  onClick={event => { event.stopPropagation(); commit(reorderVisual(draftRef.current, clip.id, 1)); }}>→</button></span>
              {clipEditingReady && <span className="episode-editor-trim-handle right" aria-label={`裁剪${clip.title}右边缘`} onPointerDown={event => beginTrim(event, "visual", clip.id, "right")}
                onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={() => { trimGestureRef.current = null; setTrimPreview(null); }} />}
            </div>)}</div></div>
            <div className="episode-editor-row"><strong>镜头原声</strong><div className="episode-editor-lane episode-editor-original" style={{ width: laneWidth }} onClick={event => { if (event.target === event.currentTarget) choose(null); }}>
              {positionedSourceAudio(draft).map(clip => {
                const owner = visuals.find(item => item.id === clip.visualClipId);
                const asset = library.find(item => item.id === owner?.assetId);
                return <div key={clip.id} className={`episode-editor-audio-clip source${selectedSourceId === clip.id ? " selected" : ""}${clip.muted ? " muted" : ""}`}
                  style={{ left: (clip.startMs + (trimPreview?.kind === "source" && trimPreview.id === clip.id && trimPreview.edge === "left"
                    ? Math.min(trimPreview.amountMs, clip.endMs - clip.startMs - 300) : 0)) / 1000 * pixelsPerSecond,
                    width: Math.max(20, (clip.endMs - clip.startMs - (trimPreview?.kind === "source" && trimPreview.id === clip.id
                      ? Math.min(trimPreview.amountMs, clip.endMs - clip.startMs - 300) : 0)) / 1000 * pixelsPerSecond) }}
                  role="button" tabIndex={0} aria-label={`选择镜头原声：${owner?.title ?? "镜头"}，${seconds(clip.startMs)} 秒开始`}
                  onClick={() => choose({ kind: "source", id: clip.id })}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose({ kind: "source", id: clip.id }); } }}>
                  {clipEditingReady && <span className="episode-editor-trim-handle left" aria-label="裁剪原声左边缘" onPointerDown={event => beginTrim(event, "source", clip.id, "left")}
                    onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={() => { trimGestureRef.current = null; setTrimPreview(null); }} />}
                  <AudioWaveform url={asset?.url} inMs={clip.inMs} outMs={clip.outMs} durationMs={asset?.durationMs ?? 0} />
                  <span className="label"><strong>{owner?.title ?? "镜头原声"}</strong><small>{clip.muted ? "已静音" : `${seconds(clip.endMs - clip.startMs)} 秒 · ${Math.round(clip.volume * 100)}%`}</small></span>
                  {clipEditingReady && <span className="episode-editor-trim-handle right" aria-label="裁剪原声右边缘" onPointerDown={event => beginTrim(event, "source", clip.id, "right")}
                    onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={() => { trimGestureRef.current = null; setTrimPreview(null); }} />}
                </div>;
              })}
              {draft.sourceAudio === undefined && <span className="episode-editor-empty-lane">旧版分集尚未确认源视频是否有音轨；升级后显示可编辑原声。</span>}
              {draft.sourceAudio !== undefined && !draft.sourceAudio.length && <span className="episode-editor-empty-lane">此集没有可编辑的源视频原声。</span>}
            </div></div>
            {(["voice", "music"] as const).map(kind => <div className="episode-editor-row" key={kind}><strong>{kind === "voice" ? "配音" : "音乐"}</strong>
              <div className="episode-editor-lane" style={{ width: laneWidth }} onDragOver={event => event.preventDefault()} onDrop={event => onAssetDrop(event, kind)}
                onClick={event => { if (event.target === event.currentTarget) choose(null); }}>
                {draft.audio.filter(item => item.kind === kind).map(clip => {
                  const asset = library.find(item => item.id === clip.assetId);
                  return <div key={clip.id} className={`episode-editor-audio-clip ${kind} ${selectedId === clip.id ? "selected" : ""}`}
                    style={{ left: clipStart(clip, draft.visuals) / 1000 * pixelsPerSecond, width: Math.max(20, audioLength(clip) / 1000 * pixelsPerSecond) }}
                    onClick={() => choose({ kind: clip.kind, id: clip.id })}
                    onPointerDown={event => beginDrag(event, clip, "move")} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose({ kind: clip.kind, id: clip.id }); }
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault();
                      changeClip(clip.id, item => moveAudioClip(item, clipStart(item, draft.visuals) + (event.key === "ArrowRight" ? 100 : -100), draft.visuals)); } }}
                    role="button" tabIndex={0} aria-label={`${asset?.name ?? clip.assetId}，${seconds(clipStart(clip, draft.visuals))} 秒开始`}>
                    <span className="handle" onPointerDown={event => { event.stopPropagation(); beginDrag(event, clip, "left"); }} aria-hidden="true" />
                    <AudioWaveform url={asset?.url} inMs={clip.inMs} outMs={clip.outMs} durationMs={asset?.durationMs ?? 0} />
                    <span className="label"><strong>{asset?.name ?? "素材丢失"}</strong><small>{seconds(audioLength(clip))} 秒</small></span>
                    <span className="handle" onPointerDown={event => { event.stopPropagation(); beginDrag(event, clip, "right"); }} aria-hidden="true" />
                  </div>;
                })}{!draft.audio.some(item => item.kind === kind) && <span className="episode-editor-empty-lane">拖入{kind === "voice" ? "录音" : "音乐"}，或点击左侧素材添加</span>}</div></div>)}
            <div className="episode-editor-playhead" style={{ left: 88 + playhead / 1000 * pixelsPerSecond }} aria-hidden="true" />
          </div></div><footer>片段位置、裁剪和音量以 0.1 秒为单位。未保存的本地草稿不会用于精准预览或导出。</footer></section>
      </main>
      <aside className="episode-editor-inspector"><h2>片段属性</h2>{selectedVisual && <section className="episode-editor-shot-summary"><h3>{selectedVisualId ? "已选画面" : "当前镜头"}</h3><strong>{selectedVisual.title}</strong>
        <p>{formatClock(selectedVisual.startMs)} – {formatClock(selectedVisual.endMs)} · 源片段 {seconds(selectedVisual.inMs)} – {seconds(selectedVisual.outMs)} 秒</p>
        <button type="button" onClick={() => openAiEditor(selectedVisual)}>✦ AI 编辑这个镜头</button>
        {selectedVisualId && <div className="episode-editor-visual-fields"><label>源素材入点（秒）<input aria-label="画面源素材入点" type="number" min={seconds(selectedVisual.inMs)} max={seconds(selectedVisual.outMs - 300)} step="0.1"
          value={visualIn} onChange={event => setVisualIn(event.target.value)} /></label>
          <button type="button" disabled={!clipEditingReady} onClick={() => requestVisualTrim("left")}>裁剪左边缘</button>
          <label>源素材出点（秒）<input aria-label="画面源素材出点" type="number" min={seconds(selectedVisual.inMs + 300)} max={seconds(selectedVisual.outMs)} step="0.1"
            value={visualOut} onChange={event => setVisualOut(event.target.value)} /></label>
          <button type="button" disabled={!clipEditingReady} onClick={() => requestVisualTrim("right")}>裁剪右边缘</button>
          <button type="button" className="episode-editor-danger" disabled={!clipEditingReady || draft.visuals.length <= 1} onClick={requestDelete}>删除本段画面</button></div>}
      </section>}
        {selectedSource && <section className="episode-editor-source-inspector"><h3>镜头原声</h3>
          <p>{formatClock(selectedSource.startMs)} – {formatClock(selectedSource.endMs)} · 源片段 {seconds(selectedSource.inMs)} – {seconds(selectedSource.outMs)} 秒</p>
          <label>本段音量（%）<input aria-label="本段原声音量百分比" type="number" min="0" max="200" step="1" value={sourceVolume}
            onChange={event => setSourceVolume(event.target.value)} /></label>
          <label>原声入点（秒）<input aria-label="本段原声入点" type="number" min="0" step="0.1" value={sourceIn}
            onChange={event => setSourceIn(event.target.value)} /></label>
          <label>原声出点（秒）<input aria-label="本段原声出点" type="number" min="0" step="0.1" value={sourceOut}
            onChange={event => setSourceOut(event.target.value)} /></label>
          <button type="button" disabled={!clipEditingReady} onClick={() => {
            try { commit(setSourceAudio(draftRef.current, selectedSource.id, { volume: Number(sourceVolume) / 100,
              inMs: readSeconds(sourceIn), outMs: readSeconds(sourceOut) })); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}>保存本段原声</button>
          <button type="button" disabled={!clipEditingReady} onClick={() => commit(setSourceAudio(draftRef.current, selectedSource.id, { muted: !selectedSource.muted }))}>
            {selectedSource.muted ? "恢复此段原声" : "静音此段原声"}</button>
          <button type="button" className="episode-editor-danger" disabled={!clipEditingReady} onClick={requestDelete}>删除此段原声</button>
          <p>有效音量 = 全局原声音量 × 本段音量。删除仅让这个区间静音，画面保持不变。</p>
        </section>}
        {selected && selectedAsset ? <><strong>{selectedAsset.name}</strong><p>从时间线移除不会删除原始素材。</p>
        <label>起点（秒）<input aria-label="片段起点秒数" type="number" min="0" step="0.1" value={form.start} onChange={event => setForm({ ...form, start: event.target.value })} /></label>
        <label>素材入点（秒）<input aria-label="素材入点秒数" type="number" min="0" step="0.1" value={form.inPoint} onChange={event => setForm({ ...form, inPoint: event.target.value })} /></label>
        <label>素材出点（秒）<input aria-label="素材出点秒数" type="number" min="0" step="0.1" value={form.outPoint} onChange={event => setForm({ ...form, outPoint: event.target.value })} /></label>
        <label>音量（%）<input aria-label="片段音量百分比" type="number" min="0" max="200" step="1" value={form.volume} onChange={event => setForm({ ...form, volume: event.target.value })} /></label>
        <label>跟随方式<select aria-label="跟随方式" value={form.anchor} onChange={event => setForm({ ...form, anchor: event.target.value })}><option value="shot">跟随所在镜头</option><option value="episode">固定在整集时间</option></select></label>
        <button type="button" className="primary" onClick={applyForm}>应用修改</button>
        <button type="button" onClick={() => { if (clipEditingReady) requestDelete();
          else { commit({ ...draftRef.current, audio: draftRef.current.audio.filter(item => item.id !== selected.id) }); choose(null); }
        }}>从时间线移除</button>
      </> : !selectedSource && !selectedVisualId && <p>选择画面、镜头原声、配音或音乐，查看并编辑该片段。</p>}
        <hr /><h3>镜头原声</h3><label>原声音量（%）<input aria-label="镜头原声音量百分比" type="number" min="0" max="200" value={originalVolume} onChange={event => setOriginalVolume(event.target.value)} /></label>
        <button type="button" onClick={() => { const value = Number(originalVolume) / 100; commit({ ...draftRef.current, originalVolume: value }); }}>保存原声音量</button>
        {!clipEditingReady && <p className="episode-editor-tip">云端时间线尚未就绪，或当前本地草稿来自旧版音轨；分片段操作已停用以防丢失原声。可刷新分集后重试。</p>}
        {draft.audio.some(item => item.historical) && <p className="episode-editor-tip">旧项目无镜头锚点的配音保留原有绝对时间。重排镜头后请核对。</p>}
        {showAgent && agentSlot && <section className="episode-editor-agent"><h3>Agent 建议</h3>{agentSlot}</section>}
      </aside>
    </div>
    {showAi && selectedVisual && <AiVideoEditWorkspace key={selectedVisual.id} shot={{ ...selectedVisual,
      url: library.find(item => item.id === selectedVisual.assetId)?.url }} initialFrameMs={playhead} draftKey={`${draftStorageKey}:ai-video:${selectedVisual.id}`}
      onClose={() => setShowAi(false)} />}
    {ttsSlot && <div className="episode-editor-tts-backdrop" hidden={!showTts} onMouseDown={event => { if (event.target === event.currentTarget) setShowTts(false); }}>
      <aside className="episode-editor-tts-panel" role="dialog" aria-modal="true" aria-label="文字生成旁白">
        <header><div><small>配音素材</small><h2>文字生成旁白</h2></div><button type="button" aria-label="关闭旁白面板" onClick={() => setShowTts(false)}>×</button></header>
        {ttsSlot}
        {(onUploadAudio || onPickNativeAudio) && <button type="button" className="episode-editor-tts-upload" onClick={() => { setShowTts(false); if (onPickNativeAudio) void pickNative("voice"); else { setUploadKind("voice"); fileRef.current?.click(); } }}>改为上传录音</button>}
      </aside>
    </div>}
    {pendingAddition && <div className="episode-editor-modal-backdrop"><div role="dialog" aria-modal="true" aria-label="音频超出整集结尾" className="episode-editor-modal"><h2>音频超出整集结尾</h2>
      <p>当前位置仅剩 {seconds(pendingAddition.remainingMs)} 秒。可裁到结尾加入本集；原始素材不会改变。</p><div><button type="button" onClick={() => setPendingAddition(null)}>取消</button>
        <button type="button" className="primary" onClick={() => addAsset(pendingAddition.asset, pendingAddition.startMs, true)}>裁到结尾并加入</button></div></div></div>}
    {pendingClipEdit && <div className="episode-editor-modal-backdrop"><div role="dialog" aria-modal="true" aria-label="片段编辑影响确认" className="episode-editor-modal episode-editor-impact">
      <h2>{pendingClipEdit.kind === "delete" ? "确认删除本段" : "确认裁剪画面"}</h2>
      <p>仅修改整集时间线引用，源视频和原始音频素材仍保留。{pendingClipEdit.selection.kind === "source" && "此段原声将静音，画面时长不变。"}</p>
      {pendingClipEdit.impact && <p>整集时长：{seconds(pendingClipEdit.impact.durationBeforeMs)} 秒 → {seconds(pendingClipEdit.impact.durationAfterMs)} 秒。后续画面会自动合拢；请核对配音与音乐位置。</p>}
      {pendingClipEdit.selection.kind === "visual" && !!draft.audio.filter(item => item.anchor?.kind !== "visual-clip").length &&
        <p>固定在整集时间的配音和音乐会保持原秒数，画面合拢后可能对到其他镜头。</p>}
      {!!pendingClipEdit.impact?.removedAnchoredAudio.length && <fieldset><legend>被删画面上有 {pendingClipEdit.impact.removedAnchoredAudio.length} 段跟随镜头的配音</legend>
        <p>{pendingClipEdit.impact.removedAnchoredAudio.map(item => library.find(asset => asset.id === item.assetId)?.name ?? item.id).join("、")}</p>
        <label><input type="radio" name="removed-anchor" checked={removedAnchorChoice === "remove"} onChange={() => setRemovedAnchorChoice("remove")} /> 同时从时间线移除</label>
        <label><input type="radio" name="removed-anchor" checked={removedAnchorChoice === "absolute"} onChange={() => setRemovedAnchorChoice("absolute")} /> 保留并固定在原整集时间</label>
      </fieldset>}
      {!!requiredOverflow.length && <fieldset><legend>超出新片尾的音频（逐条确认）</legend>
        {requiredOverflow.map(item => <label key={item.clip.id}><input type="checkbox" checked={confirmedOverflowIds.includes(item.clip.id)}
          onChange={event => setConfirmedOverflowIds(current => event.target.checked
            ? [...current, item.clip.id] : current.filter(id => id !== item.clip.id))} />
          <span>{library.find(asset => asset.id === item.clip.assetId)?.name ?? item.clip.id}：超出 {seconds(item.overflowMs)} 秒；
            {item.remainingMs < 300 ? "剩余不足 0.3 秒，确认从时间线移除" : `确认裁剪并保留前 ${seconds(item.remainingMs)} 秒`}</span></label>)}
      </fieldset>}
      <div><button type="button" onClick={() => setPendingClipEdit(null)}>返回调整</button>
        <button type="button" className="primary" onClick={confirmClipEdit}
          disabled={!!pendingClipEdit.impact?.removedAnchoredAudio.length && !removedAnchorChoice || !overflowConfirmed}>
          {pendingClipEdit.kind === "delete" ? "确认删除本段" : "确认裁剪"}</button></div>
    </div></div>}
    {leavePrompt && <div className="episode-editor-modal-backdrop"><div role="dialog" aria-modal="true" aria-label="未保存的本地草稿" className="episode-editor-modal">
      <h2>本地草稿尚未保存</h2><p>离开后草稿仍保留在此设备。下次打开本集可继续编辑；云端精准预览和导出不会使用这份草稿。</p>
      <div><button type="button" onClick={() => setLeavePrompt(false)}>取消返回，继续编辑</button>
        {saveState === "failed" && <button type="button" onClick={() => { setLeavePrompt(false); void retrySave(); }}>重试保存</button>}
        <button type="button" className="primary" onClick={() => { storeDraft(draftRef.current); onBack(); }}>保留本地草稿并返回</button></div></div></div>}
  </section>;
}
