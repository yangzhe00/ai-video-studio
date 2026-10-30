import type { AgentPlan, RunState } from "@ai-video/agent-core";
import { parseCloudEnvelope } from "@ai-video/project-core";
import type { CloudAccountSnapshot, CloudEpisode, CloudProjectDocument, CloudProjectSnapshot, CloudRunSnapshot, CloudShot } from "@ai-video/project-core";
import { parseApiError, parseApiResponse, requestSecurityHeaders } from "@ai-video/api-contracts";

export type Account = CloudAccountSnapshot;
export type EpisodeShot = CloudShot;
export type Episode = CloudEpisode;
export type CloudDocument = CloudProjectDocument;
export type CloudProject = CloudProjectSnapshot;
export interface AgentRunSnapshot extends CloudRunSnapshot { state: RunState; plan: AgentPlan }

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: "include", headers: {
    ...(data === undefined ? {} : { "content-type": "application/json" }), ...requestSecurityHeaders(method),
  }, body: data === undefined ? undefined : JSON.stringify(data) });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(parseApiError(payload, response.status).error);
  const parsed = parseApiResponse<T>(payload);
  return path.endsWith("/dsl") ? parsed : parseCloudEnvelope(parsed);
}

export async function uploadObject(file: File): Promise<{ id: string; mime: string; size: number }> {
  if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
    throw new Error("目前仅支持 JPG 或 PNG 照片；请将 HEIC 等格式导出后重试");
  }
  if (file.size === 0) throw new Error("照片文件为空，请重新选择");
  const response = await fetch("/api/objects", { method: "POST", credentials: "include", headers: {
    "content-type": file.type, ...requestSecurityHeaders("POST"),
  }, body: file });
  const payload = await response.json() as { object?: { id: string; mime: string; size: number }; error?: string };
  if (!response.ok || !payload.object) {
    const message = response.ok ? "上传失败" : parseApiError(payload, response.status).error;
    throw new Error(message.includes("无法识别媒体内容")
      ? `${message}。若照片在本机可正常打开，请联系管理员检查服务端媒体解析。` : message);
  }
  return payload.object;
}

export async function uploadVoiceObject(file: File): Promise<{ id: string; mime: string; size: number; durationMs?: number }> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mime = extension === "mp3" ? "audio/mpeg" : extension === "wav" ? "audio/wav"
    : extension === "m4a" ? "audio/mp4" : null;
  if (!mime) throw new Error("请选择 MP3、WAV 或 M4A 录音");
  if (file.size === 0) throw new Error("录音文件为空，请重新选择");
  if (file.size > 20_000_000) throw new Error("录音超过 20 MB 上传限制");
  const response = await fetch("/api/objects", { method: "POST", credentials: "include", headers: {
    "content-type": mime, ...requestSecurityHeaders("POST"),
  }, body: file });
  const payload = await response.json() as { object?: { id: string; mime: string; size: number; durationMs?: number }; error?: string };
  if (!response.ok || !payload.object) throw new Error(response.ok ? "录音上传失败" : parseApiError(payload, response.status).error);
  return payload.object;
}
