import type { Caption, ProjectManifestV2, TimelineClip } from "../../types/project";

export class TimelineError extends Error {}

export function appendClip(project: ProjectManifestV2, assetId: string): ProjectManifestV2 {
  const asset = project.assets.find(item => item.id === assetId);
  if (!asset || asset.missing) throw new TimelineError("素材不存在或已丢失");
  if (asset.kind === "audio") throw new TimelineError("音频暂不能作为画面片段");
  const duration = asset.kind === "image" ? 5000 : asset.durationMs;
  if (!duration || duration <= 0) throw new TimelineError("无法确定素材时长");
  const clip: TimelineClip = { id: crypto.randomUUID(), assetId, inMs: 0, outMs: duration, volume: 1 };
  return { ...project, clips: [...project.clips, clip] };
}

export function trimClip(project: ProjectManifestV2, clipId: string, inMs: number, outMs: number): ProjectManifestV2 {
  const clip = project.clips.find(item => item.id === clipId);
  if (!clip) throw new TimelineError("片段不存在");
  const asset = project.assets.find(item => item.id === clip.assetId);
  const duration = asset?.kind === "image" ? 5000 : asset?.durationMs;
  if (!duration || !Number.isFinite(inMs) || !Number.isFinite(outMs) || inMs < 0 || outMs <= inMs || outMs > duration) {
    throw new TimelineError("裁剪范围超出素材时长");
  }
  return { ...project, clips: project.clips.map(item => item.id === clipId ? { ...item, inMs, outMs } : item) };
}

export function moveClip(project: ProjectManifestV2, clipId: string, toIndex: number): ProjectManifestV2 {
  const clips = [...project.clips];
  const fromIndex = clips.findIndex(item => item.id === clipId);
  if (fromIndex < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= clips.length) throw new TimelineError("片段位置无效");
  clips.splice(toIndex, 0, clips.splice(fromIndex, 1)[0]);
  return { ...project, clips };
}

export function setClipVolume(project: ProjectManifestV2, clipId: string, volume: number): ProjectManifestV2 {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new TimelineError("音量必须在 0 到 1 之间");
  if (!project.clips.some(item => item.id === clipId)) throw new TimelineError("片段不存在");
  return { ...project, clips: project.clips.map(item => item.id === clipId ? { ...item, volume } : item) };
}

export function upsertCaption(project: ProjectManifestV2, caption: Caption): ProjectManifestV2 {
  const totalMs = project.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0);
  if (!caption.text.trim() || !Number.isFinite(caption.startMs) || !Number.isFinite(caption.endMs) || caption.startMs < 0 || caption.endMs <= caption.startMs || caption.endMs > totalMs) {
    throw new TimelineError("字幕内容或时间范围无效");
  }
  const found = project.captions.some(item => item.id === caption.id);
  return { ...project, captions: found ? project.captions.map(item => item.id === caption.id ? caption : item) : [...project.captions, caption] };
}
