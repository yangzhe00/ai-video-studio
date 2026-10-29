import * as SecureStore from "expo-secure-store";
import { parseCloudEnvelope } from "@ai-video/project-core";
import { createMobileSession } from "./session";

const session = createMobileSession(SecureStore);

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const restoreApi = () => session.restore();
export const setApiUrl = (url: string) => session.setUrl(url);
export const getApiUrl = () => session.getUrl();
export const mediaHeaders = () => session.headers();
export const objectUrl = (id: string) => `${session.getUrl()}/objects/${id}`;

export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const origin = session.getUrl();
  if (!origin) throw new Error("请先设置云端服务器地址");
  const response = await fetch(`${origin}${path}`, { method, credentials: "include", headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...session.headers(),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  await session.acceptCookie(origin, response.headers.get("set-cookie"));
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, payload.error ?? `请求失败：${response.status}`);
  return parseCloudEnvelope(payload);
}

export async function uploadPhoto(uri: string, mime: string): Promise<{ id: string }> {
  const origin = session.getUrl();
  if (!origin) throw new Error("请先设置云端服务器地址");
  const local = await fetch(uri);
  const bytes = await local.blob();
  const response = await fetch(`${origin}/objects`, { method: "POST", credentials: "include", headers: {
    "content-type": mime, ...session.headers(),
  }, body: bytes });
  const payload = await response.json() as { object?: { id: string }; error?: string };
  if (!response.ok || !payload.object) throw new ApiError(response.status, payload.error ?? "照片上传失败");
  return payload.object;
}
