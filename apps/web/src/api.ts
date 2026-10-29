import type { AgentPlan, RunState } from "@ai-video/agent-core";
import type { CloudAccountSnapshot, CloudEpisode, CloudProjectDocument, CloudProjectSnapshot, CloudRunSnapshot, CloudShot } from "@ai-video/project-core";
import { parseCloudEnvelope } from "@ai-video/project-core";

export type Account = CloudAccountSnapshot;
export type EpisodeShot = CloudShot;
export type Episode = CloudEpisode;
export type CloudDocument = CloudProjectDocument;
export type CloudProject = CloudProjectSnapshot;
export interface AgentRunSnapshot extends CloudRunSnapshot { state: RunState; plan: AgentPlan }

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: "include", headers: data === undefined ? {} : { "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return parseCloudEnvelope(payload);
}

export async function uploadObject(file: File): Promise<{ id: string; mime: string; size: number }> {
  if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
    throw new Error("目前仅支持 JPG 或 PNG 照片；请将 HEIC 等格式导出后重试");
  }
  if (file.size === 0) throw new Error("照片文件为空，请重新选择");
  const response = await fetch("/api/objects", { method: "POST", credentials: "include", headers: { "content-type": file.type }, body: file });
  const payload = await response.json() as { object?: { id: string; mime: string; size: number }; error?: string };
  if (!response.ok || !payload.object) {
    const message = payload.error || "上传失败";
    throw new Error(message.includes("无法识别媒体内容")
      ? `${message}。若照片在本机可正常打开，请联系管理员检查服务端媒体解析。` : message);
  }
  return payload.object;
}
