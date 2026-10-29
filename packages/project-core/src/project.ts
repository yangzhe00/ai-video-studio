import type { GenerationJob, ShotDraft } from "./ai";
import type { StudioDocument } from "./studio";

export type MediaKind = "image" | "video" | "audio";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  relativePath: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  missing: boolean;
}

export interface TimelineClip {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  volume: number;
}

export interface Caption {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface ProjectManifestV2 {
  version: 2;
  id: string;
  title: string;
  assets: MediaAsset[];
  clips: TimelineClip[];
  captions: Caption[];
  publishingCopy: string;
  coverTimeMs: number | null;
  shots: ShotDraft[];
  jobs: GenerationJob[];
  budgetUsd: number | null;
  studio?: StudioDocument | null;
  extensions?: Record<string, unknown>;
}

export interface OpenProject {
  root: string;
  manifest: ProjectManifestV2;
}

