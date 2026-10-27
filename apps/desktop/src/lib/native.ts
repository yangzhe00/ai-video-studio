import { invoke } from "@tauri-apps/api/core";
import type { MediaAsset, ProjectManifestV2 } from "@ai-video/project-core";

export const createProject = (root: string, title: string) =>
  invoke<ProjectManifestV2>("create_project", { root, title });

export const openProject = (root: string) =>
  invoke<ProjectManifestV2>("open_project", { root });

export const saveProject = (root: string, manifest: ProjectManifestV2) =>
  invoke<void>("save_project", { root, manifest });

export const importAsset = (root: string, source: string) =>
  invoke<MediaAsset>("import_asset", { root, source });

export const auditAssets = (root: string, assets: MediaAsset[]) =>
  invoke<MediaAsset[]>("audit_assets", { root, assets });

export const readAsset = (root: string, assetId: string) =>
  invoke<ArrayBuffer>("read_asset", { root, assetId });

export interface ExportArtifacts {
  videoRelativePath: string;
  coverRelativePath: string;
}

export const exportProject = (root: string, outputName: string) =>
  invoke<ExportArtifacts>("export_project", { root, outputName });

export interface MoneyEstimate { modelId: string; durationSec: number; microsUsd: number; asOf: string }

export const quoteShot = (modelId: string, durationSec: number) =>
  invoke<MoneyEstimate>("quote_shot", { modelId, durationSec });

export const checkShotBudget = (root: string, shotId: string) =>
  invoke<MoneyEstimate>("check_shot_budget", { root, shotId });

export type ProviderId = "hedra" | "runway" | "deepseek";
export interface ProviderKeyStatus { provider: ProviderId; configured: boolean }

export const providerKeyStatus = () => invoke<ProviderKeyStatus[]>("provider_key_status");
export const setProviderKey = (provider: ProviderId, key: string) => invoke<void>("set_provider_key", { provider, key });
export const removeProviderKey = (provider: ProviderId) => invoke<void>("remove_provider_key", { provider });
