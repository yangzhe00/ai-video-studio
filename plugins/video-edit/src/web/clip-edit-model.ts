import { audioLength, clipStart, positionedVisuals, timelineDuration } from "./timeline-model";
import type { TimelineAudioClip, TimelineSnapshot, TimelineVisualClip } from "./timeline-model";

export const MIN_CLIP_MS = 300;

/** A source-audio range uses the same source clock as its owning video clip. */
export interface SourceAudioClip {
  id: string;
  visualClipId: string;
  assetId: string;
  inMs: number;
  outMs: number;
  volume: number;
  muted: boolean;
}

export interface ClipEditSnapshot extends TimelineSnapshot {
  sourceAudio?: SourceAudioClip[];
}

export type ClipSelection = { kind: "visual" | "source" | "voice" | "music"; id: string };
export type OverflowChoice = "return" | "trim";
export type RemovedAnchorChoice = "remove" | "absolute";
export interface EditImpact {
  durationBeforeMs: number;
  durationAfterMs: number;
  removedAnchoredAudio: TimelineAudioClip[];
  overflowingAudio: Array<{ clip: TimelineAudioClip; overflowMs: number; remainingMs: number }>;
}

export function sourceAudioClips(snapshot: ClipEditSnapshot): SourceAudioClip[] {
  return snapshot.sourceAudio ?? [];
}

/** Upgrade only after the source videos with real audio have been identified. */
export function projectLegacySourceAudio(snapshot: ClipEditSnapshot, audioAssetIds: ReadonlySet<string>): SourceAudioClip[] {
  return snapshot.visuals.filter(clip => audioAssetIds.has(clip.assetId)).map(clip => ({
    id: `original-${clip.id}`, visualClipId: clip.id, assetId: clip.assetId,
    inMs: clip.inMs, outMs: clip.outMs, volume: clip.volume, muted: false,
  }));
}

export function positionedSourceAudio(snapshot: ClipEditSnapshot) {
  const visuals = new Map(positionedVisuals(snapshot.visuals).map(clip => [clip.id, clip]));
  return sourceAudioClips(snapshot).flatMap(clip => {
    const visual = visuals.get(clip.visualClipId);
    if (!visual) return [];
    return [{ ...clip, startMs: visual.startMs + clip.inMs - visual.inMs,
      endMs: visual.startMs + clip.outMs - visual.inMs }];
  });
}

export function canSplit(snapshot: ClipEditSnapshot, selection: ClipSelection | null, atMs: number): boolean {
  if (!selection) return false;
  if (selection.kind === "visual") {
    const clip = positionedVisuals(snapshot.visuals).find(item => item.id === selection.id);
    return !!clip && atMs - clip.startMs >= MIN_CLIP_MS && clip.endMs - atMs >= MIN_CLIP_MS;
  }
  if (selection.kind === "source") {
    const clip = positionedSourceAudio(snapshot).find(item => item.id === selection.id);
    return !!clip && atMs - clip.startMs >= MIN_CLIP_MS && clip.endMs - atMs >= MIN_CLIP_MS;
  }
  const clip = snapshot.audio.find(item => item.id === selection.id && item.kind === selection.kind);
  if (!clip) return false;
  const start = clipStart(clip, snapshot.visuals);
  return atMs - start >= MIN_CLIP_MS && start + audioLength(clip) - atMs >= MIN_CLIP_MS;
}

/** The retained left half keeps its ID; the right half gets a new stable ID. */
export function splitClip(snapshot: ClipEditSnapshot, selection: ClipSelection, atMs: number,
  newId: () => string): ClipEditSnapshot {
  if (!canSplit(snapshot, selection, atMs)) throw new Error("播放头需位于所选片段内部，且距两端至少 0.3 秒");
  if (selection.kind === "visual") {
    const positioned = positionedVisuals(snapshot.visuals).find(item => item.id === selection.id)!;
    const cutInSource = positioned.inMs + atMs - positioned.startMs;
    const rightId = newId();
    const visuals = snapshot.visuals.flatMap(clip => clip.id === selection.id
      ? [{ ...clip, outMs: cutInSource }, { ...clip, id: rightId, inMs: cutInSource }]
      : [clip]);
    const sourceAudio = sourceAudioClips(snapshot).flatMap(clip => {
      if (clip.visualClipId !== selection.id) return [clip];
      if (clip.outMs <= cutInSource) return [clip];
      if (clip.inMs >= cutInSource) return [{ ...clip, visualClipId: rightId }];
      return [{ ...clip, outMs: cutInSource },
        { ...clip, id: newId(), visualClipId: rightId, inMs: cutInSource }];
    });
    const audio = snapshot.audio.map(clip => {
      const anchor = clip.anchor;
      return anchor?.kind === "visual-clip" && anchor.clipId === selection.id && anchor.offsetMs >= atMs - positioned.startMs
        ? { ...clip, anchor: { kind: "visual-clip" as const, clipId: rightId,
          offsetMs: anchor.offsetMs - (atMs - positioned.startMs) } }
        : clip;
    });
    return { ...snapshot, visuals, sourceAudio, audio };
  }
  if (selection.kind === "source") {
    const positioned = positionedSourceAudio(snapshot).find(item => item.id === selection.id)!;
    const sourceCut = positioned.inMs + atMs - positioned.startMs;
    return { ...snapshot, sourceAudio: sourceAudioClips(snapshot).flatMap(clip => clip.id === selection.id
      ? [{ ...clip, outMs: sourceCut }, { ...clip, id: newId(), inMs: sourceCut }]
      : [clip]) };
  }
  return { ...snapshot, audio: snapshot.audio.flatMap(clip => {
    if (clip.id !== selection.id) return [clip];
    const start = clipStart(clip, snapshot.visuals);
    const elapsed = atMs - start;
    const sourceCut = clip.inMs + elapsed;
    const anchor = clip.anchor?.kind === "visual-clip"
      ? { ...clip.anchor, offsetMs: clip.anchor.offsetMs + elapsed } : clip.anchor;
    return [{ ...clip, outMs: sourceCut },
      { ...clip, id: newId(), startMs: atMs, inMs: sourceCut, anchor }];
  }) };
}

export function editImpact(snapshot: ClipEditSnapshot, visualsAfter: TimelineVisualClip[], removedVisualId?: string): EditImpact {
  const durationAfterMs = timelineDuration(visualsAfter);
  const removedAnchoredAudio = snapshot.audio.filter(clip => clip.anchor?.kind === "visual-clip" &&
    clip.anchor.clipId === removedVisualId);
  const overflowingAudio = snapshot.audio.flatMap(clip => {
    const start = removedAnchoredAudio.includes(clip)
      ? clipStart(clip, snapshot.visuals) : clipStart(clip, visualsAfter);
    const end = start + audioLength(clip);
    return end > durationAfterMs ? [{ clip, overflowMs: end - durationAfterMs,
      remainingMs: audioLength(clip) - (end - durationAfterMs) }] : [];
  });
  return { durationBeforeMs: timelineDuration(snapshot.visuals), durationAfterMs,
    removedAnchoredAudio, overflowingAudio };
}

/** No source file is removed; the caller must collect explicit choices before applying impacts. */
export function deleteClip(snapshot: ClipEditSnapshot, selection: ClipSelection,
  choices: { removedAnchor?: RemovedAnchorChoice; overflow?: OverflowChoice } = {}): ClipEditSnapshot {
  if (selection.kind === "source") {
    return { ...snapshot, sourceAudio: sourceAudioClips(snapshot).filter(clip => clip.id !== selection.id) };
  }
  if (selection.kind === "voice" || selection.kind === "music") {
    return { ...snapshot, audio: snapshot.audio.filter(clip => clip.id !== selection.id) };
  }
  if (snapshot.visuals.length <= 1) throw new Error("最后一个画面片段不能删除");
  const visuals = snapshot.visuals.filter(clip => clip.id !== selection.id);
  if (visuals.length === snapshot.visuals.length) return snapshot;
  const impact = editImpact(snapshot, visuals, selection.id);
  if (impact.removedAnchoredAudio.length && !choices.removedAnchor)
    throw new Error("请先选择被删画面上的配音处理方式");
  const overflowNeedsDecision = impact.overflowingAudio.some(item =>
    !(choices.removedAnchor === "remove" && impact.removedAnchoredAudio.includes(item.clip)));
  if (overflowNeedsDecision && choices.overflow !== "trim")
    throw new Error("请先确认超出新片尾的音频片段如何裁剪或移除");
  const originalStarts = new Map(snapshot.audio.map(clip => [clip.id, clipStart(clip, snapshot.visuals)]));
  const overflowing = new Map(impact.overflowingAudio.map(item => [item.clip.id, item]));
  const audio = snapshot.audio.flatMap(clip => {
    const removedAnchor = clip.anchor?.kind === "visual-clip" && clip.anchor.clipId === selection.id;
    if (removedAnchor && choices.removedAnchor === "remove") return [];
    const anchored = removedAnchor ? { ...clip, startMs: originalStarts.get(clip.id)!,
      anchor: { kind: "absolute" as const } } : clip;
    const overflow = overflowing.get(clip.id);
    if (!overflow) return [anchored];
    if (overflow.remainingMs < MIN_CLIP_MS) return [];
    return [{ ...anchored, outMs: anchored.outMs - overflow.overflowMs }];
  });
  return { ...snapshot, visuals, audio,
    sourceAudio: sourceAudioClips(snapshot).filter(clip => clip.visualClipId !== selection.id) };
}

export function setSourceAudio(snapshot: ClipEditSnapshot, clipId: string,
  change: Partial<Pick<SourceAudioClip, "volume" | "muted" | "inMs" | "outMs">>): ClipEditSnapshot {
  const sourceAudio = sourceAudioClips(snapshot).map(clip => clip.id === clipId ? { ...clip, ...change } : clip);
  const changed = sourceAudio.find(clip => clip.id === clipId);
  const owner = snapshot.visuals.find(clip => clip.id === changed?.visualClipId);
  if (!changed || !owner || changed.assetId !== owner.assetId || changed.inMs < owner.inMs || changed.outMs > owner.outMs ||
      changed.outMs - changed.inMs < MIN_CLIP_MS || changed.volume < 0 || changed.volume > 2)
    throw new Error("镜头原声范围或音量无效");
  return { ...snapshot, sourceAudio };
}

/** Trimming only moves an edge inward. Any audio crossing the new end needs an explicit choice. */
export function trimVisualClip(snapshot: ClipEditSnapshot, clipId: string,
  edge: "left" | "right", amountMs: number, overflow?: OverflowChoice): ClipEditSnapshot {
  const visual = snapshot.visuals.find(item => item.id === clipId);
  if (!visual || !Number.isSafeInteger(amountMs) || amountMs < 0 ||
      visual.outMs - visual.inMs - amountMs < MIN_CLIP_MS) throw new Error("画面片段至少保留 0.3 秒");
  if (amountMs === 0) return snapshot;
  const changed = edge === "left" ? { ...visual, inMs: visual.inMs + amountMs }
    : { ...visual, outMs: visual.outMs - amountMs };
  const visuals = snapshot.visuals.map(item => item.id === clipId ? changed : item);
  const impact = editImpact(snapshot, visuals);
  if (impact.overflowingAudio.length && overflow !== "trim")
    throw new Error("请先确认超出新片尾的音频片段如何裁剪或移除");
  const overflowing = new Map(impact.overflowingAudio.map(item => [item.clip.id, item]));
  const audio = snapshot.audio.flatMap(clip => {
    const item = overflowing.get(clip.id);
    if (!item) return [clip];
    if (item.remainingMs < MIN_CLIP_MS) return [];
    return [{ ...clip, outMs: clip.outMs - item.overflowMs }];
  });
  const sourceAudio = sourceAudioClips(snapshot).flatMap(clip => {
    if (clip.visualClipId !== clipId) return [clip];
    const inMs = Math.max(clip.inMs, changed.inMs), outMs = Math.min(clip.outMs, changed.outMs);
    return outMs - inMs >= MIN_CLIP_MS ? [{ ...clip, inMs, outMs }] : [];
  });
  return { ...snapshot, visuals, audio, sourceAudio };
}
