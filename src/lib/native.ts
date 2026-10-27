import { invoke } from "@tauri-apps/api/core";
import type { MediaAsset, ProjectManifestV1 } from "../types/project";

export const createProject = (root: string, title: string) =>
  invoke<ProjectManifestV1>("create_project", { root, title });

export const openProject = (root: string) =>
  invoke<ProjectManifestV1>("open_project", { root });

export const saveProject = (root: string, manifest: ProjectManifestV1) =>
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
