export interface ShotDraft {
  id: string;
  sourceAssetId: string;
  prompt: string;
  durationSec: number;
  speaking: boolean;
  script: string | null;
  acceptedAudioAssetId: string | null;
  modelId: string;
}

export type JobState = "draft" | "submitting" | "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface GenerationJob {
  id: string;
  shotId: string;
  provider: string;
  modelId: string;
  state: JobState;
  remoteId: string | null;
  estimatedUsd: number;
  actualUsd: number | null;
  outputAssetId: string | null;
}
