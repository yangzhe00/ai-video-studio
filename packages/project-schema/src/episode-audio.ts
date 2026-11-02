import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
const millis = z.number().int().nonnegative().refine(Number.isSafeInteger);
const volume = z.number().finite().min(0).max(2);
const placement = { assetId: id, startMs: millis, inMs: millis, outMs: millis, volume };

export const AudioAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absolute") }).strict(),
  z.object({ kind: z.literal("visual-clip"), clipId: z.string().min(1).max(120), offsetMs: millis }).strict(),
]);

export const LegacyEpisodeAudioClipSchema = z.object(placement).strict()
  .refine(clip => clip.outMs > clip.inMs, "音频入点必须早于出点");
export const EpisodeAudioClipV2Schema = z.object({ ...placement, id, anchor: AudioAnchorSchema }).strict()
  .refine(clip => clip.outMs - clip.inMs >= 300, "音频片段不得短于 300 毫秒");

export const LegacyEpisodeAudioSchema = z.object({ originalVolume: volume,
  voiceClips: z.array(LegacyEpisodeAudioClipSchema).max(100),
  musicClips: z.array(LegacyEpisodeAudioClipSchema).max(100) }).strict();
export const EpisodeAudioV2Schema = z.object({ version: z.literal(2), originalVolume: volume,
  voiceClips: z.array(EpisodeAudioClipV2Schema).max(100),
  musicClips: z.array(EpisodeAudioClipV2Schema).max(100) }).strict().superRefine((audio, ctx) => {
  const ids = new Set<string>();
  for (const clip of [...audio.voiceClips, ...audio.musicClips]) {
    if (ids.has(clip.id)) ctx.addIssue({ code: "custom", message: "音频片段 ID 不得重复" });
    ids.add(clip.id);
  }
});
export const EpisodeAudioSchema = z.union([EpisodeAudioV2Schema, LegacyEpisodeAudioSchema]);

export type AudioAnchor = z.infer<typeof AudioAnchorSchema>;
export type LegacyEpisodeAudio = z.infer<typeof LegacyEpisodeAudioSchema>;
export type EpisodeAudioV2 = z.infer<typeof EpisodeAudioV2Schema>;

export interface CloudAudioPlacement {
  id?: string; assetId: string; startMs: number; inMs: number; outMs: number; volume: number;
  anchor?: AudioAnchor;
}
export interface CloudEpisodeAudio { version?: 2; originalVolume: number;
  voiceClips: CloudAudioPlacement[]; musicClips: CloudAudioPlacement[] }
export interface CloudAudioEpisode {
  id: string; timeline: string[];
  timelineClips?: { id: string; assetId: string; inMs: number; outMs: number }[];
  shots: { resultAssetId: string; durationSec: number }[];
  audio?: CloudEpisodeAudio;
}

/** Resolve shot-relative positions without changing stored legacy audio or creating duplicate tracks. */
export function projectEpisodeAudio(episode: CloudAudioEpisode): CloudEpisodeAudio | undefined {
  if (!episode.audio) return undefined;
  const visuals = episode.timelineClips?.length === episode.timeline.length &&
    episode.timelineClips.every((clip, index) => clip.assetId === episode.timeline[index])
    ? episode.timelineClips : episode.timeline.map((assetId, index) => ({
      id: `cloud-${episode.id}-${index}`, assetId, inMs: 0,
      outMs: (episode.shots.find(shot => shot.resultAssetId === assetId)?.durationSec ?? 5) * 1000,
    }));
  const starts = new Map<string, number>();
  let cursor = 0;
  for (const clip of visuals) { starts.set(clip.id, cursor); cursor += clip.outMs - clip.inMs; }
  const projected = (kind: "voice" | "music", clips: CloudAudioPlacement[]) => clips.map((clip, index) => {
    const id = clip.id ?? `legacy-${kind}-${episode.id.slice(0, 12)}-${index}`;
    const anchor = clip.anchor ?? { kind: "absolute" as const };
    let startMs = clip.startMs;
    if (anchor.kind === "visual-clip") {
      const visualStart = starts.get(anchor.clipId);
      if (visualStart === undefined) throw new Error(`音频片段 ${id} 的镜头锚点已失效`);
      startMs = visualStart + anchor.offsetMs;
    }
    return { ...clip, id, anchor, startMs };
  });
  return { ...episode.audio, voiceClips: projected("voice", episode.audio.voiceClips),
    musicClips: projected("music", episode.audio.musicClips) };
}
