import { invoke } from "@tauri-apps/api/core";
import type { CreationBrief, MediaAsset, ProjectManifestV2 } from "@ai-video/project-core";
import type { ExportArtifacts, MoneyEstimate } from "@ai-video/platform-ports";
export type { ExportArtifacts, MoneyEstimate } from "@ai-video/platform-ports";

export const createProject = (root: string, title: string, initialBrief?: CreationBrief) =>
  invoke<ProjectManifestV2>("create_project", { root, title, ...(initialBrief ? { initialBrief } : {}) });

export const openProject = (root: string) =>
  invoke<ProjectManifestV2>("open_project", { root });

export const saveProject = (root: string, manifest: ProjectManifestV2) =>
  invoke<void>("save_project", { root, manifest });

export const backupProject = (root: string) =>
  invoke<string>("backup_project", { root });

export const importAsset = (root: string, source: string) =>
  invoke<MediaAsset>("import_asset", { root, source });

export const auditAssets = (root: string, assets: MediaAsset[]) =>
  invoke<MediaAsset[]>("audit_assets", { root, assets });

export const readAsset = (root: string, assetId: string) =>
  invoke<ArrayBuffer>("read_asset", { root, assetId });

export const exportProject = (root: string, outputName: string) =>
  invoke<ExportArtifacts>("export_project", { root, outputName });

export const quoteShot = (modelId: string, durationSec: number) =>
  invoke<MoneyEstimate>("quote_shot", { modelId, durationSec });

export const checkShotBudget = (root: string, shotId: string) =>
  invoke<MoneyEstimate>("check_shot_budget", { root, shotId });

export const refreshKlingImageVideo = (root: string, jobId: string) =>
  invoke<ProjectManifestV2>("refresh_kling_image_video", { root, jobId });
