import { z } from "zod";

const id = z.string().min(1);
const millis = z.number().int().nonnegative().refine(Number.isSafeInteger, "时间必须是安全整数");
const positiveMillis = z.number().int().positive().refine(Number.isSafeInteger, "时长必须是安全整数");
const volume = z.number().finite().min(0).max(2);

const clipBase = z.object({ id, startMs: millis, assetId: id });
const trimmed = { inMs: millis, outMs: positiveMillis, volume };

export const VideoClipSchema = clipBase.extend({ kind: z.literal("video"), ...trimmed }).strict();
export const ImageClipSchema = clipBase.extend({ kind: z.literal("image"), durationMs: positiveMillis }).strict();
export const VoiceClipSchema = clipBase.extend({ kind: z.literal("voice"), ...trimmed }).strict();
export const MusicClipSchema = clipBase.extend({ kind: z.literal("music"), ...trimmed }).strict();
export const UnclassifiedAudioClipSchema = clipBase.extend({ kind: z.literal("audio"), ...trimmed }).strict();
export const SubtitleClipSchema = clipBase.extend({ kind: z.literal("subtitle"), durationMs: positiveMillis }).strict();

export const TimelineClipSchema = z.discriminatedUnion("kind", [
  VideoClipSchema, ImageClipSchema, VoiceClipSchema, MusicClipSchema,
  UnclassifiedAudioClipSchema, SubtitleClipSchema,
]);

export const TimelineTrackSchema = z.object({
  id,
  kind: z.enum(["visual", "voice", "music", "subtitle", "audio"]),
  clips: z.array(TimelineClipSchema),
}).strict();

export type TimelineClipV1 = z.infer<typeof TimelineClipSchema>;
export type TimelineTrackV1 = z.infer<typeof TimelineTrackSchema>;
