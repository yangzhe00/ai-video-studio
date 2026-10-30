import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9-]{8,80}$/);
const ideaRequestId = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
const revision = z.number().int().nonnegative().refine(Number.isSafeInteger);
const positiveText = (max: number) => z.string().refine(value => {
  const text = value.trim();
  return text.length > 0 && Array.from(text).length <= max;
});

export const AuthRequestSchema = z.object({ email: z.string(), password: z.string() }).passthrough();
export const CreatePromptIdeaRequestSchema = z.object({ clientRequestId: ideaRequestId, input: positiveText(200) }).passthrough();
export const SelectPromptIdeaRequestSchema = z.object({ variantId: z.string().min(1), editedPrompt: positiveText(2000) }).passthrough();
export const CreateProjectRequestSchema = z.object({
  id: id.optional(), title: positiveText(50), initialEpisodeId: id.optional(), initialBrief: z.unknown().optional(),
}).passthrough();
export const ProjectCommandRequestSchema = z.object({
  id, resourceType: z.enum(["episode", "asset", "character", "canvas", "brief"]),
  resourceId: id, baseRevision: revision, payload: z.record(z.unknown()),
}).passthrough();
export const CreateRunRequestSchema = z.object({
  clientRequestId: id, episodeId: id, sourceAssetId: id,
  input: positiveText(2000), durationSec: z.literal(5),
}).passthrough();
export const ApproveRunRequestSchema = z.object({ approvalId: id, planHash: z.string().min(1) }).passthrough();
export const CreateEditRequestSchema = z.object({ projectId: id, episodeId: id, shotId: id }).passthrough();
export const AudioPlacementSchema = z.object({ assetId: id, startMs: revision, inMs: revision,
  outMs: revision, volume: z.number().finite().min(0).max(2) }).strict()
  .refine(value => value.outMs > value.inMs, "音频入点必须早于出点");
export const EditCommandRequestSchema = z.object({
  commandId: id, expectedRevision: revision,
  command: z.discriminatedUnion("type", [
    z.object({ type: z.literal("set-trim"), startMs: revision, endMs: revision }),
    z.object({ type: z.literal("upsert-caption"), caption: z.object({ id, startMs: revision, endMs: revision, text: positiveText(2000) }) }),
    z.object({ type: z.literal("remove-caption"), captionId: id }),
    z.object({ type: z.literal("set-cover"), sourceMs: revision }),
    z.object({ type: z.literal("set-audio-mix"), originalVolume: z.number().finite().min(0).max(2),
      voiceClips: z.array(AudioPlacementSchema).max(16), musicClips: z.array(AudioPlacementSchema).max(16) }),
  ]),
}).passthrough();
export const CreateRenderRequestSchema = z.object({ renderOperationId: id, expectedRevision: revision }).passthrough();

export const EpisodeAudioSchema = z.object({ originalVolume: z.number().finite().min(0).max(2),
  voiceClips: z.array(AudioPlacementSchema).max(100), musicClips: z.array(AudioPlacementSchema).max(100) }).strict();
export const TtsEstimateRequestSchema = z.object({ text: positiveText(1000),
  voiceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), voiceLanguage: z.enum(["zh", "en"]),
  speed: z.number().finite().min(0.8).max(2).refine(value => Number.isInteger(value * 10), "语速以 0.1 为步长") }).strict();
export const CreateTtsTaskRequestSchema = TtsEstimateRequestSchema.extend({
  clientRequestId: id, confirmed: z.literal(true), estimateId: id,
}).strict();
export const CreateEpisodeRenderRequestSchema = z.object({ renderOperationId: id,
  expectedEpisodeRevision: revision }).strict();
export const CreateShotPreviewRequestSchema = z.object({ previewOperationId: id,
  expectedRevision: revision }).strict();
export const CreateEpisodePreviewRequestSchema = z.object({ previewOperationId: id,
  expectedEpisodeRevision: revision }).strict();
export const CreateAgentEditRequestSchema = z.object({ clientRequestId: id, episodeId: id,
  instruction: positiveText(1000) }).strict();
export const ConfirmAgentEditRequestSchema = z.object({ clientRequestId: id, expectedRevision: revision,
  acceptedActionIds: z.array(id).min(1).max(20) }).strict();

export type AudioPlacement = z.infer<typeof AudioPlacementSchema>;
export type EpisodeAudio = z.infer<typeof EpisodeAudioSchema>;
export type CreateTtsTaskRequest = z.infer<typeof CreateTtsTaskRequestSchema>;
export type ConfirmAgentEditRequest = z.infer<typeof ConfirmAgentEditRequestSchema>;

export type CreatePromptIdeaRequest = z.infer<typeof CreatePromptIdeaRequestSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ProjectCommandRequest = z.infer<typeof ProjectCommandRequestSchema>;
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type ApproveRunRequest = z.infer<typeof ApproveRunRequestSchema>;

export class ApiContractValidationError extends Error {
  readonly status = 400;
  constructor(message = "请求内容不符合接口协议") { super(message); }
}

/** Only JSON routes are registered. Upload bytes and SSE never enter this parser. */
export function requestSchema(method: string, path: string): z.ZodTypeAny | undefined {
  if (method !== "POST") return undefined;
  if (path === "/auth/register" || path === "/auth/login") return AuthRequestSchema;
  if (path === "/prompt-ideas") return CreatePromptIdeaRequestSchema;
  if (/^\/prompt-ideas\/[a-zA-Z0-9-]+\/selection$/.test(path)) return SelectPromptIdeaRequestSchema;
  if (path === "/projects") return CreateProjectRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/commands$/.test(path)) return ProjectCommandRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/runs$/.test(path)) return CreateRunRequestSchema;
  if (/^\/runs\/[a-zA-Z0-9-]+\/approve$/.test(path)) return ApproveRunRequestSchema;
  if (path === "/video-edits") return CreateEditRequestSchema;
  if (/^\/video-edits\/[a-zA-Z0-9-]+\/commands$/.test(path)) return EditCommandRequestSchema;
  if (/^\/video-edits\/[a-zA-Z0-9-]+\/render$/.test(path)) return CreateRenderRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/tts\/estimate$/.test(path)) return TtsEstimateRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/tts\/tasks$/.test(path)) return CreateTtsTaskRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/episodes\/[a-zA-Z0-9-]+\/render$/.test(path)) return CreateEpisodeRenderRequestSchema;
  if (/^\/video-edits\/[a-zA-Z0-9-]+\/previews$/.test(path)) return CreateShotPreviewRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/episodes\/[a-zA-Z0-9-]+\/previews$/.test(path)) return CreateEpisodePreviewRequestSchema;
  if (/^\/projects\/[a-zA-Z0-9-]+\/agent-edits$/.test(path)) return CreateAgentEditRequestSchema;
  if (/^\/agent-edits\/[a-zA-Z0-9-]+\/confirm$/.test(path)) return ConfirmAgentEditRequestSchema;
  return undefined;
}

export function parseApiRequest(method: string, path: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiContractValidationError("请求 JSON 无效");
  const schema = requestSchema(method, path);
  if (!schema) return raw as Record<string, unknown>;
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiContractValidationError();
  return result.data as Record<string, unknown>;
}
