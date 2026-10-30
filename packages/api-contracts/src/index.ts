export {
  ApiErrorCodeSchema, ApiErrorEnvelopeSchema, errorCodeForStatus, makeApiError, parseApiError,
} from "./errors.ts";
export type { ApiErrorCode, ApiErrorEnvelope } from "./errors.ts";
export {
  AuthRequestSchema, CreatePromptIdeaRequestSchema, SelectPromptIdeaRequestSchema,
  CreateProjectRequestSchema, ProjectCommandRequestSchema, CreateRunRequestSchema,
  ApproveRunRequestSchema, CreateEditRequestSchema, EditCommandRequestSchema,
  CreateRenderRequestSchema, AudioPlacementSchema, EpisodeAudioSchema,
  TtsEstimateRequestSchema, CreateTtsTaskRequestSchema, CreateEpisodeRenderRequestSchema,
  CreateShotPreviewRequestSchema, CreateEpisodePreviewRequestSchema,
  CreateAgentEditRequestSchema, ConfirmAgentEditRequestSchema,
  ApiContractValidationError, requestSchema, parseApiRequest,
} from "./requests.ts";
export type {
  CreatePromptIdeaRequest, CreateProjectRequest, ProjectCommandRequest,
  CreateRunRequest, ApproveRunRequest, AudioPlacement, EpisodeAudio,
  CreateTtsTaskRequest, ConfirmAgentEditRequest,
} from "./requests.ts";
export {
  AccountSchema, PromptVariantSchema, PromptIdeaSetSchema, ProjectSummarySchema,
  VideoEditViewSchema, RenderViewSchema, ObjectSnapshotSchema,
  TtsEstimateSchema, TtsVoiceSchema, TtsTaskSchema, EpisodeRenderViewSchema, PreviewViewSchema,
  AgentEditActionSchema, AgentEditContextSchema, AgentEditSetSchema,
  CloudProjectResponseSchema, CloudRunResponseSchema, parseApiResponse,
} from "./responses.ts";
export type {
  Account, PromptVariant, PromptIdeaSet, ProjectSummary, CloudProjectResponse,
  CloudRunResponse, VideoEditView, RenderView, ObjectSnapshot,
  TtsEstimate, TtsVoice, TtsTask, EpisodeRenderView, PreviewView, AgentEditAction, AgentEditContext, AgentEditSet,
} from "./responses.ts";
export type { VideoProjectV1 } from "@ai-video/project-schema";

/** Required on every state-changing API request, including native clients. */
export const AVS_REQUEST_HEADER_NAME = "X-AVS-Request";
export const AVS_REQUEST_HEADER_VALUE = "1";

export function requestSecurityHeaders(method: string): Record<string, string> {
  return new Set(["POST", "PUT", "PATCH", "DELETE"]).has(method.toUpperCase())
    ? { [AVS_REQUEST_HEADER_NAME]: AVS_REQUEST_HEADER_VALUE }
    : {};
}
