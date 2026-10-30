import { invoke } from "@tauri-apps/api/core";
import type { CloudAccountSnapshot, CloudProjectSnapshot, CloudRunSnapshot, MediaAsset, SyncResourceType } from "@ai-video/project-core";
import { parseCloudEnvelope, resourceRevision } from "@ai-video/project-core";
import { parseApiResponse } from "@ai-video/api-contracts";

export type CloudAccount = CloudAccountSnapshot;
export type CloudProject = CloudProjectSnapshot;
export type CloudRun = CloudRunSnapshot;

export async function cloudRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const parsed = parseApiResponse<T>(await invoke<T>("cloud_request", { path, method, body: body ?? null }));
  return path.endsWith("/dsl") ? parsed : parseCloudEnvelope(parsed);
}

export function cloudUploadAsset(root: string, assetId: string): Promise<{ object: { id: string; mime: string; size: number; durationMs?: number } }> {
  return invoke("cloud_upload_asset", { root, assetId });
}

export function cloudDownloadAsset(root: string, objectId: string, kind: "image" | "video" | "voice" | "music"): Promise<MediaAsset> {
  return invoke("cloud_download_asset", { root, objectId, kind });
}

export async function cloudCommand(project: CloudProject, resourceType: SyncResourceType, resourceId: string, payload: unknown, commandId = crypto.randomUUID()): Promise<CloudProject> {
  const result = await cloudRequest<{ project: CloudProject }>(`/projects/${project.id}/commands`, "POST", {
    id: commandId, resourceType, resourceId,
    baseRevision: resourceRevision(project.resourceRevisions ?? [], resourceType, resourceId), payload,
  });
  return result.project;
}
