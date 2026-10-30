import { z } from "zod";
import { parseProjectDsl } from "@ai-video/project-schema";
import { ApiErrorEnvelopeSchema } from "./errors.ts";

const text = z.string().min(1);
const int = z.number().int().nonnegative().refine(Number.isSafeInteger);
export const AccountSchema = z.object({ id: text, email: text,
  demo_quota: int.optional(), demo_reserved: int.optional(), demo_used: int.optional() }).passthrough();
export const PromptVariantSchema = z.object({ id: text, title: text, description: text, prompt: text }).passthrough();
export const PromptIdeaSetSchema = z.object({
  id: text, clientRequestId: text, input: z.string(),
  state: z.enum(["pending", "ready", "failed", "unknown"]),
  variants: z.array(PromptVariantSchema), selectedVariantId: text.nullable(), editedPrompt: z.string().nullable(),
  createdAt: int, updatedAt: int, error: z.string().nullable(), errorCode: z.string().nullable(),
}).passthrough();
export const ProjectSummarySchema = z.object({ id: text, title: text, revision: int,
  updatedAt: int.optional(), recentEpisode: z.object({ id: text, title: z.string(), shotCount: int }).nullable().optional() }).passthrough();
export const VideoEditViewSchema = z.object({
  id: text, sourceAssetId: text, currentOutputId: text.nullable(), currentCoverId: text.nullable(),
  recipe: z.object({ version: z.union([z.literal(1), z.literal(2)]), revision: int }).passthrough(),
}).passthrough();
export const RenderViewSchema = z.object({ id: text, state: text,
  outputAssetId: text.nullable(), coverAssetId: text.nullable(), error: z.string().nullable() }).passthrough();
export const ObjectSnapshotSchema = z.object({ id: text, mime: text, size: int, sha256: text.optional(), durationMs: int.optional() }).passthrough();
export const TtsEstimateSchema = z.object({ id: text, projectId: text, textHash: text, voiceId: text,
  voiceLanguage: z.enum(["zh", "en"]), speed: z.number().finite(), estimatedCost: z.object({ amount: z.number().nonnegative(), currency: text }).nullable(),
  billingPolicy: z.literal("actual-usage"), expiresAt: int }).passthrough();
export const TtsVoiceSchema = z.object({ id: text, label: text, language: z.enum(["zh", "en"]) }).strict();
export const TtsTaskSchema = z.object({ id: text, projectId: text, clientRequestId: text,
  state: z.enum(["pending", "submitting", "unknown", "running", "succeeded", "failed"]),
  voiceAssetId: text.nullable(), providerTaskId: text.nullable(),
  costStatus: z.enum(["unbilled", "pending", "billed", "unknown"]),
  error: z.string().nullable(), actualCost: z.object({ quota: z.string().optional(), listPrice: z.string().optional(), units: z.string().optional() }).nullable().optional(),
  createdAt: int, updatedAt: int }).passthrough();
export const EpisodeRenderViewSchema = z.object({ id: text, projectId: text, episodeId: text,
  episodeRevision: int, state: z.enum(["pending", "running", "succeeded", "failed"]),
  outputAssetId: text.nullable(), error: z.string().nullable() }).passthrough();
export const PreviewViewSchema = z.object({ id: text, scope: z.enum(["shot", "episode"]), targetId: text,
  revision: int, state: z.enum(["pending", "running", "succeeded", "failed"]),
  outputAssetId: text.nullable(), error: z.string().nullable() }).passthrough();
const actionBase = { id: text, reason: text };
export const AgentEditActionSchema = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("set-trim"), editId: text, expectedRevision: int,
    startMs: int, endMs: int }).strict(),
  z.object({ ...actionBase, type: z.literal("reorder-shots"), episodeId: text, expectedRevision: int,
    shotIds: z.array(text).min(1).max(100) }).strict(),
  z.object({ ...actionBase, type: z.literal("upsert-caption"), editId: text, expectedRevision: int,
    caption: z.object({ id: text, startMs: int, endMs: int, text }).strict() }).strict(),
  z.object({ ...actionBase, type: z.literal("set-voice"), editId: text, expectedRevision: int,
    assetId: text, startMs: int, inMs: int, outMs: int, volume: z.number().finite().min(0).max(2) }).strict(),
]);
export const AgentEditContextSchema = z.object({
  episode: z.object({ revision: int, shotIds: z.array(text) }).strict(),
  edits: z.array(z.object({ id: text, shotId: text, revision: int,
    trimStartMs: int, trimEndMs: int,
    captions: z.array(z.object({ id: text, startMs: int, endMs: int, text: z.string() }).strict()),
    voiceClips: z.array(z.object({ assetId: text, startMs: int, inMs: int, outMs: int,
      volume: z.number().finite().min(0).max(2) }).strict()),
  }).strict()),
}).strict();
export const AgentEditSetSchema = z.object({ id: text, projectId: text, episodeId: text,
  clientRequestId: text, revision: z.literal(1), state: z.enum(["pending", "generating", "ready", "failed"]),
  actions: z.array(AgentEditActionSchema).max(20), confirmedActionIds: z.array(text), error: z.string().nullable(),
  context: AgentEditContextSchema.optional(),
  createdAt: int, updatedAt: int }).passthrough();
export const CloudProjectResponseSchema = z.object({ id: text, title: text, revision: int,
  document: z.object({ version: z.literal(1), assets: z.array(z.unknown()), characters: z.array(z.unknown()),
    episodes: z.array(z.unknown()) }).passthrough(), resourceRevisions: z.array(z.unknown()) }).passthrough();
export const CloudRunResponseSchema = z.object({
  runId: text, projectId: text, episodeId: text, sourceAssetId: text, input: z.string(),
  durationSec: z.union([z.literal(5), z.literal(10)]), state: text, planHash: text,
  plan: z.object({ steps: z.array(z.object({ prompt: z.string(), durationSec: z.union([z.literal(5), z.literal(10)]) }).passthrough()) }).passthrough(),
}).passthrough();

export type PromptVariant = z.infer<typeof PromptVariantSchema>;
export type PromptIdeaSet = z.infer<typeof PromptIdeaSetSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type CloudProjectResponse = z.infer<typeof CloudProjectResponseSchema>;
export type CloudRunResponse = z.infer<typeof CloudRunResponseSchema>;
export type VideoEditView = z.infer<typeof VideoEditViewSchema>;
export type RenderView = z.infer<typeof RenderViewSchema>;
export type ObjectSnapshot = z.infer<typeof ObjectSnapshotSchema>;
export type TtsEstimate = z.infer<typeof TtsEstimateSchema>;
export type TtsVoice = z.infer<typeof TtsVoiceSchema>;
export type TtsTask = z.infer<typeof TtsTaskSchema>;
export type EpisodeRenderView = z.infer<typeof EpisodeRenderViewSchema>;
export type PreviewView = z.infer<typeof PreviewViewSchema>;
export type AgentEditAction = z.infer<typeof AgentEditActionSchema>;
export type AgentEditContext = z.infer<typeof AgentEditContextSchema>;
export type AgentEditSet = z.infer<typeof AgentEditSetSchema>;

/** Parses response envelopes, retaining every existing wire field. */
export function parseApiResponse<T = unknown>(raw: unknown): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("API 响应格式无效");
  const value = raw as Record<string, unknown>;
  if ("error" in value) { ApiErrorEnvelopeSchema.parse(value); return raw as T; }
  if ("project" in value) {
    if (value.readOnly === true) {
      const snapshot = z.object({ id: text, title: text, revision: int, resourceRevisions: z.array(z.unknown()),
        document: z.unknown() }).passthrough().parse(value.project);
      const parsed = parseProjectDsl(snapshot.document);
      if (!parsed.ok || parsed.project.projectId !== snapshot.id || parsed.project.metadata.title !== snapshot.title) {
        throw new Error("项目 DSL 响应格式无效");
      }
      return raw as T;
    }
    z.object({ project: CloudProjectResponseSchema }).passthrough().parse(value);
    return raw as T;
  }
  if ("run" in value) { z.object({ run: CloudRunResponseSchema }).passthrough().parse(value); return raw as T; }
  if ("runs" in value) { z.object({ runs: z.array(CloudRunResponseSchema) }).passthrough().parse(value); return raw as T; }
  if ("ttsEstimate" in value) { z.object({ ttsEstimate: TtsEstimateSchema }).passthrough().parse(value); return raw as T; }
  if ("voices" in value) { z.object({ voices: z.array(TtsVoiceSchema) }).passthrough().parse(value); return raw as T; }
  if ("ttsTask" in value) { z.object({ ttsTask: TtsTaskSchema }).passthrough().parse(value); return raw as T; }
  if ("episodeRender" in value) { z.object({ episodeRender: EpisodeRenderViewSchema }).passthrough().parse(value); return raw as T; }
  if ("preview" in value) { z.object({ preview: PreviewViewSchema }).passthrough().parse(value); return raw as T; }
  if ("agentEdit" in value) { z.object({ agentEdit: AgentEditSetSchema }).passthrough().parse(value); return raw as T; }
  if ("ideaSet" in value) z.object({ ideaSet: PromptIdeaSetSchema }).passthrough().parse(value);
  else if ("ideaSets" in value) z.object({ ideaSets: z.array(PromptIdeaSetSchema) }).passthrough().parse(value);
  else if ("account" in value) z.object({ account: AccountSchema }).passthrough().parse(value);
  else if ("projects" in value) z.object({ projects: z.array(ProjectSummarySchema) }).passthrough().parse(value);
  else if ("edit" in value) z.object({ edit: VideoEditViewSchema.nullable() }).passthrough().parse(value);
  else if ("render" in value) z.object({ render: RenderViewSchema }).passthrough().parse(value);
  else if ("object" in value) z.object({ object: ObjectSnapshotSchema }).passthrough().parse(value);
  else if ("ok" in value) z.object({ ok: z.literal(true) }).passthrough().parse(value);
  else if ("events" in value) z.object({ events: z.array(z.object({ seq: int, state: text, message: z.string() }).passthrough()) }).passthrough().parse(value);
  else if ("versions" in value) z.object({ originalAssetId: text, selectedAssetId: text, versions: z.array(z.object({ operationId: text, recipeRevision: int, outputAssetId: text, coverAssetId: text, createdAt: int }).passthrough()) }).passthrough().parse(value);
  else throw new Error("API 响应 envelope 未注册");
  return raw as T;
}
