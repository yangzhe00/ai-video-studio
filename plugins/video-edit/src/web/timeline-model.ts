export type TimelineAudioKind = "voice" | "music";

export interface TimelineAsset {
  id: string;
  kind: TimelineAudioKind | "video";
  name: string;
  durationMs: number;
  url?: string;
}

export interface TimelineVisualClip {
  id: string;
  assetId: string;
  title: string;
  inMs: number;
  outMs: number;
  volume: number;
}

export type TimelineAnchor = { kind: "visual-clip"; clipId: string; offsetMs: number } | { kind: "absolute" };

export interface TimelineAudioClip {
  id: string;
  assetId: string;
  kind: TimelineAudioKind;
  startMs: number;
  inMs: number;
  outMs: number;
  volume: number;
  /** Missing on historical placements: keep their absolute position when shots move. */
  anchor?: TimelineAnchor;
  historical?: boolean;
}

export interface TimelineSnapshot {
  visuals: TimelineVisualClip[];
  audio: TimelineAudioClip[];
  originalVolume: number;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Only a permutation of the saved visual clips may be written by the episode editor. */
export function orderSavedVisuals<T extends { id: string; assetId: string; inMs: number; outMs: number; volume: number }>(
  saved: T[], requested: TimelineVisualClip[],
): T[] {
  if (saved.length !== requested.length || new Set(requested.map(clip => clip.id)).size !== saved.length)
    throw new Error("409：本集镜头已变化，请查看云端版本");
  return requested.map(clip => {
    const original = saved.find(item => item.id === clip.id);
    if (!original || !same([original.assetId, original.inMs, original.outMs, original.volume],
      [clip.assetId, clip.inMs, clip.outMs, clip.volume]))
      throw new Error("409：本集镜头已变化，请查看云端版本");
    return original;
  });
}

export function reorderVisual(snapshot: TimelineSnapshot, clipId: string, offset: -1 | 1): TimelineSnapshot {
  const index = snapshot.visuals.findIndex(clip => clip.id === clipId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= snapshot.visuals.length) return snapshot;
  const visuals = [...snapshot.visuals];
  [visuals[index], visuals[target]] = [visuals[target], visuals[index]];
  return { ...snapshot, visuals };
}

function mergeField<T>(base: T, local: T, cloud: T): { value: T; conflict: boolean } {
  if (same(local, cloud)) return { value: local, conflict: false };
  if (same(local, base)) return { value: cloud, conflict: false };
  if (same(cloud, base)) return { value: local, conflict: false };
  return { value: local, conflict: true };
}

export function mergeTimelineDraft(base: TimelineSnapshot, local: TimelineSnapshot, cloud: TimelineSnapshot):
  { snapshot: TimelineSnapshot; conflicts: string[] } {
  const conflicts: string[] = [];
  const visuals = mergeField(base.visuals, local.visuals, cloud.visuals);
  if (visuals.conflict) conflicts.push("镜头顺序或裁剪同时被两端修改");
  const originalVolume = mergeField(base.originalVolume, local.originalVolume, cloud.originalVolume);
  if (originalVolume.conflict) conflicts.push("镜头原声音量同时被两端修改");
  const baseById = new Map(base.audio.map(clip => [clip.id, clip]));
  const localById = new Map(local.audio.map(clip => [clip.id, clip]));
  const cloudById = new Map(cloud.audio.map(clip => [clip.id, clip]));
  const ids = [...new Set([...localById.keys(), ...cloudById.keys(), ...baseById.keys()])];
  const fields: (keyof TimelineAudioClip)[] = ["assetId", "kind", "startMs", "inMs", "outMs", "volume", "anchor", "historical"];
  const audio: TimelineAudioClip[] = [];
  for (const id of ids) {
    const before = baseById.get(id), mine = localById.get(id), remote = cloudById.get(id);
    if (!before || !mine || !remote) {
      const merged = mergeField(before, mine, remote);
      if (merged.conflict) conflicts.push(`音频片段 ${id} 在一端被移除、另一端被修改`);
      if (merged.value) audio.push(merged.value);
      continue;
    }
    const next = { ...before };
    for (const field of fields) {
      const merged = mergeField(before[field], mine[field], remote[field]);
      if (merged.conflict) conflicts.push(`音频片段 ${id} 的${field}同时被两端修改`);
      (next as unknown as Record<string, unknown>)[field] = merged.value;
    }
    audio.push(next);
  }
  return { snapshot: { visuals: visuals.value, originalVolume: originalVolume.value, audio }, conflicts };
}

export function timelineDifferences(local: TimelineSnapshot, cloud: TimelineSnapshot, assets: TimelineAsset[]): string[] {
  const differences: string[] = [];
  const names = (clips: TimelineVisualClip[]) => clips.map(clip => clip.title || clip.id).join(" → ") || "空";
  if (!same(local.visuals.map(clip => clip.id), cloud.visuals.map(clip => clip.id)))
    differences.push(`镜头顺序：本地 ${names(local.visuals)}；云端 ${names(cloud.visuals)}`);
  for (const id of new Set([...local.visuals.map(clip => clip.id), ...cloud.visuals.map(clip => clip.id)])) {
    const mine = local.visuals.find(clip => clip.id === id), remote = cloud.visuals.find(clip => clip.id === id);
    const name = mine?.title ?? remote?.title ?? id;
    if (!mine || !remote) { differences.push(`${name}：${mine ? "仅本地存在" : "仅云端存在"}`); continue; }
    if (mine.assetId !== remote.assetId) differences.push(`${name}：画面素材不同`);
    if (mine.inMs !== remote.inMs || mine.outMs !== remote.outMs)
      differences.push(`${name} 画面范围：本地 ${(mine.inMs / 1000).toFixed(1)}–${(mine.outMs / 1000).toFixed(1)} 秒；云端 ${(remote.inMs / 1000).toFixed(1)}–${(remote.outMs / 1000).toFixed(1)} 秒`);
    if (mine.volume !== remote.volume)
      differences.push(`${name} 片段音量：本地 ${Math.round(mine.volume * 100)}%；云端 ${Math.round(remote.volume * 100)}%`);
  }
  if (local.originalVolume !== cloud.originalVolume)
    differences.push(`镜头原声音量：本地 ${Math.round(local.originalVolume * 100)}%；云端 ${Math.round(cloud.originalVolume * 100)}%`);
  const clips = [...new Set([...local.audio.map(clip => clip.id), ...cloud.audio.map(clip => clip.id)])];
  for (const id of clips) {
    const mine = local.audio.find(clip => clip.id === id), remote = cloud.audio.find(clip => clip.id === id);
    const name = assets.find(asset => asset.id === (mine ?? remote)?.assetId)?.name ?? id;
    if (!mine || !remote) { differences.push(`${name}：${mine ? "仅本地存在" : "仅云端存在"}`); continue; }
    const mineStart = clipStart(mine, local.visuals), remoteStart = clipStart(remote, cloud.visuals);
    if (mineStart !== remoteStart) differences.push(`${name} 起点：本地 ${(mineStart / 1000).toFixed(1)} 秒；云端 ${(remoteStart / 1000).toFixed(1)} 秒`);
    if (mine.inMs !== remote.inMs || mine.outMs !== remote.outMs)
      differences.push(`${name} 素材范围：本地 ${(mine.inMs / 1000).toFixed(1)}–${(mine.outMs / 1000).toFixed(1)} 秒；云端 ${(remote.inMs / 1000).toFixed(1)}–${(remote.outMs / 1000).toFixed(1)} 秒`);
    if (mine.volume !== remote.volume)
      differences.push(`${name} 音量：本地 ${Math.round(mine.volume * 100)}%；云端 ${Math.round(remote.volume * 100)}%`);
    if (!same(mine.anchor, remote.anchor)) differences.push(`${name} 跟随方式不同`);
  }
  return differences.length ? differences : ["两端时间线内容相同，可重试保存。"];
}

export interface TimelineCloudAudio {
  version?: 2;
  originalVolume: number;
  voiceClips: Array<{ id?: string; assetId: string; startMs: number; inMs: number; outMs: number; volume: number; anchor?: TimelineAnchor }>;
  musicClips: Array<{ id?: string; assetId: string; startMs: number; inMs: number; outMs: number; volume: number; anchor?: TimelineAnchor }>;
}

export function timelineFromCloud(visuals: TimelineVisualClip[], audio?: TimelineCloudAudio): TimelineSnapshot {
  const toClips = (kind: TimelineAudioKind, clips: TimelineCloudAudio["voiceClips"]) => clips.map((item, index) => ({
    ...item, id: item.id ?? `legacy-${kind}-${index}`, kind, historical: audio?.version !== 2,
  }));
  return { visuals, originalVolume: audio?.originalVolume ?? 1,
    audio: [...toClips("voice", audio?.voiceClips ?? []), ...toClips("music", audio?.musicClips ?? [])] };
}

/** Persist the complete multi-track set in the shared episode audio v2 contract. */
export function timelineToCloud(snapshot: TimelineSnapshot): TimelineCloudAudio & { version: 2 } {
  const placements = (kind: TimelineAudioKind) => snapshot.audio.filter(clip => clip.kind === kind).map(clip => ({
    id: clip.id, assetId: clip.assetId, startMs: clipStart(clip, snapshot.visuals),
    inMs: clip.inMs, outMs: clip.outMs, volume: clip.volume, anchor: clip.anchor ?? { kind: "absolute" as const },
  }));
  return { version: 2, originalVolume: snapshot.originalVolume,
    voiceClips: placements("voice"), musicClips: placements("music") };
}

export interface PositionedVisual extends TimelineVisualClip { startMs: number; endMs: number }

export function positionedVisuals(visuals: TimelineVisualClip[]): PositionedVisual[] {
  let cursor = 0;
  return visuals.map(clip => {
    const startMs = cursor;
    cursor += Math.max(0, clip.outMs - clip.inMs);
    return { ...clip, startMs, endMs: cursor };
  });
}

export function timelineDuration(visuals: TimelineVisualClip[]): number {
  return visuals.reduce((total, clip) => total + Math.max(0, clip.outMs - clip.inMs), 0);
}

export const audioLength = (clip: TimelineAudioClip) => clip.outMs - clip.inMs;

export function clipStart(clip: TimelineAudioClip, visuals: TimelineVisualClip[]): number {
  const anchor = clip.anchor;
  if (anchor?.kind !== "visual-clip") return clip.startMs;
  const shot = positionedVisuals(visuals).find(item => item.id === anchor.clipId);
  return shot ? shot.startMs + anchor.offsetMs : clip.startMs;
}

export function snapTime(ms: number, snapPoints: number[], thresholdMs = 150): number {
  const rounded = Math.max(0, Math.round(ms / 100) * 100);
  const closest = snapPoints.reduce((best, point) => Math.abs(point - rounded) < Math.abs(best - rounded) ? point : best,
    Number.POSITIVE_INFINITY);
  return Math.abs(closest - rounded) <= thresholdMs ? closest : rounded;
}

export function validateTimeline(snapshot: TimelineSnapshot, assets: TimelineAsset[]): string | null {
  const duration = timelineDuration(snapshot.visuals);
  if (!Number.isFinite(snapshot.originalVolume) || snapshot.originalVolume < 0 || snapshot.originalVolume > 2) return "镜头原声音量无效";
  for (const visual of snapshot.visuals) {
    if (!visual.id || !visual.assetId || !Number.isSafeInteger(visual.inMs) || !Number.isSafeInteger(visual.outMs)
      || visual.inMs < 0 || visual.outMs <= visual.inMs) return "画面片段时间无效";
  }
  if (snapshot.audio.filter(item => item.kind === "voice").length > 100 ||
      snapshot.audio.filter(item => item.kind === "music").length > 100) return "音频片段过多";
  const ids = new Set<string>();
  for (const clip of snapshot.audio) {
    const asset = assets.find(item => item.id === clip.assetId && item.kind === clip.kind);
    if (!asset || !asset.url) return `音频素材 ${clip.assetId} 不可试听，请重新上传或刷新`;
    if (!clip.id || ids.has(clip.id)) return "音频片段 ID 重复";
    const anchor = clip.anchor;
    if (anchor?.kind === "visual-clip" && !snapshot.visuals.some(item => item.id === anchor.clipId))
      return `音频片段「${asset.name}」的镜头锚点已失效`;
    ids.add(clip.id);
    const start = clipStart(clip, snapshot.visuals);
    if (![clip.startMs, clip.inMs, clip.outMs].every(Number.isSafeInteger) || start < 0 || clip.inMs < 0 ||
      clip.outMs > asset.durationMs || audioLength(clip) < 300 || start + audioLength(clip) > duration) {
      return `音频片段「${asset.name}」超出素材或整集范围`;
    }
    if (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2) return "音频片段音量无效";
  }
  return null;
}

/** Preserve old absolute placements; new voice defaults to the visual clip under its start. */
export function makeAudioClip(asset: TimelineAsset, startMs: number, visuals: TimelineVisualClip[], newId: () => string): TimelineAudioClip {
  if (asset.kind !== "voice" && asset.kind !== "music") throw new Error("请选择录音或音乐素材");
  const duration = timelineDuration(visuals);
  if (!duration) throw new Error("请先在画布加入视频片段");
  const start = Math.max(0, Math.round(startMs / 100) * 100);
  const available = duration - start;
  if (available < 300) throw new Error("播放头离结尾太近，请选择更早的位置");
  const shot = positionedVisuals(visuals).find(item => start >= item.startMs && start < item.endMs);
  return { id: newId(), assetId: asset.id, kind: asset.kind, startMs: start, inMs: 0,
    outMs: Math.min(asset.durationMs, available), volume: asset.kind === "music" ? 0.35 : 1,
    anchor: asset.kind === "voice" && shot ? { kind: "visual-clip", clipId: shot.id, offsetMs: start - shot.startMs } : { kind: "absolute" } };
}

export function moveAudioClip(clip: TimelineAudioClip, startMs: number, visuals: TimelineVisualClip[]): TimelineAudioClip {
  const start = Math.max(0, Math.round(startMs / 100) * 100);
  const shot = positionedVisuals(visuals).find(item => start >= item.startMs && start < item.endMs);
  return { ...clip, startMs: start,
    anchor: clip.anchor?.kind === "visual-clip"
      ? shot ? { kind: "visual-clip", clipId: shot.id, offsetMs: start - shot.startMs } : { kind: "absolute" }
      : clip.anchor };
}

export function trimAudioClip(clip: TimelineAudioClip, edge: "left" | "right", deltaMs: number,
  visuals: TimelineVisualClip[]): TimelineAudioClip {
  const delta = Math.round(deltaMs / 100) * 100;
  if (edge === "right") return { ...clip, outMs: clip.outMs + delta };
  const moved = moveAudioClip(clip, clipStart(clip, visuals) + delta, visuals);
  return { ...moved, inMs: clip.inMs + delta };
}
