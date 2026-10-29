import { z } from "zod";
import { ProjectAssetsSchema } from "./assets.ts";
import { TimelineTrackSchema } from "./clips.ts";

const id = z.string().min(1);
const millis = z.number().int().nonnegative().refine(Number.isSafeInteger, "时间必须是安全整数");
const positiveInteger = z.number().int().positive().refine(Number.isSafeInteger, "必须是安全整数");

export const ProjectMetadataSchema = z.object({
  title: z.string().min(1),
  createdAt: z.string().optional(),
}).strict();

export const CanvasConfigSchema = z.object({ width: positiveInteger, height: positiveInteger }).strict();
export const RenderConfigSchema = z.object({ fps: positiveInteger, format: z.literal("mp4") }).strict();

export const CharacterSchema = z.object({
  id, name: z.string(), description: z.string(), referenceAssetId: id,
}).strict();

export const SceneSchema = z.object({
  id,
  prompt: z.string().min(1),
  sourceAssetId: id,
  outputAssetIds: z.array(id),
  selectedAssetId: id.nullable(),
  runIds: z.array(id),
}).strict();

export const EpisodeSchema = z.object({
  id,
  title: z.string(),
  scenes: z.array(SceneSchema),
  tracks: z.array(TimelineTrackSchema),
  publishingCopy: z.string(),
  cover: z.object({ assetId: id, sourceTimeMs: millis }).strict().nullable(),
}).strict();

/** Pure shape check. Use VideoProjectSchema for cross-layer reference checks. */
export const VideoProjectShapeSchema = z.object({
  schema: z.literal("ai-video/project"),
  dslVersion: z.literal(1),
  projectId: id,
  metadata: ProjectMetadataSchema,
  canvasConfig: CanvasConfigSchema,
  renderConfig: RenderConfigSchema,
  characters: z.array(CharacterSchema),
  episodes: z.array(EpisodeSchema),
  assets: ProjectAssetsSchema,
  extensions: z.record(z.unknown()).optional(),
}).strict();

export type CharacterV1 = z.infer<typeof CharacterSchema>;
export type SceneV1 = z.infer<typeof SceneSchema>;
export type EpisodeV1 = z.infer<typeof EpisodeSchema>;
export type VideoProjectV1 = z.infer<typeof VideoProjectShapeSchema>;
