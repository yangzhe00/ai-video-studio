import { z } from "zod";

const id = z.string().min(1);
const nonNegativeMillis = z.number().int().nonnegative().refine(Number.isSafeInteger, "时间必须是安全整数");
const dimension = z.number().int().positive().refine(Number.isSafeInteger, "尺寸必须是安全整数");

export const AssetProvenanceSchema = z.object({
  sourceAssetIds: z.array(id).optional(),
  runId: id.optional(),
  recipeId: id.optional(),
}).strict();

const assetBase = z.object({
  id,
  name: z.string(),
  provenance: AssetProvenanceSchema.optional(),
});

const imageFields = {
  mimeType: z.string().min(1).nullable(),
  width: dimension.nullable(),
  height: dimension.nullable(),
};

const timedMediaFields = {
  mimeType: z.string().min(1).nullable(),
  durationMs: nonNegativeMillis.nullable(),
};

export const ImageAssetSchema = assetBase.extend({ kind: z.literal("image"), ...imageFields }).strict();
export const ThumbnailAssetSchema = assetBase.extend({ kind: z.literal("thumbnail"), ...imageFields }).strict();
export const VideoAssetSchema = assetBase.extend({
  kind: z.literal("video"), ...timedMediaFields, width: dimension.nullable(), height: dimension.nullable(),
}).strict();
export const VoiceAssetSchema = assetBase.extend({ kind: z.literal("voice"), ...timedMediaFields }).strict();
export const MusicAssetSchema = assetBase.extend({ kind: z.literal("music"), ...timedMediaFields }).strict();
/** Legacy audio whose voice/music role cannot be identified without asking the user. */
export const UnclassifiedAudioAssetSchema = assetBase.extend({ kind: z.literal("audio"), ...timedMediaFields }).strict();
export const SubtitleAssetSchema = assetBase.extend({
  kind: z.literal("subtitle"), format: z.literal("plain"), text: z.string(),
}).strict();

export const AssetSchema = z.discriminatedUnion("kind", [
  ImageAssetSchema, ThumbnailAssetSchema, VideoAssetSchema,
  VoiceAssetSchema, MusicAssetSchema, UnclassifiedAudioAssetSchema, SubtitleAssetSchema,
]);

export const ProjectAssetsSchema = z.object({ items: z.array(AssetSchema) }).strict();

export type AssetV1 = z.infer<typeof AssetSchema>;
export type ProjectAssetsV1 = z.infer<typeof ProjectAssetsSchema>;
