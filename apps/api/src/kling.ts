export interface KlingSubmitResult { kind: "accepted" | "rejected" | "unknown"; remoteTaskId?: string }
export interface KlingTask { status: "missing" | "submitted" | "processing" | "succeeded" | "failed" | "unknown"; remoteTaskId?: string; videoUrl?: string; message?: string }

export class KlingGateway {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api-beijing.klingai.com",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async submit(input: { externalTaskId: string; imageBase64: string; prompt: string; durationSec: 5 | 10 }): Promise<KlingSubmitResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/image-to-video/kling-2.5-turbo`, {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ type: "prompt", text: input.prompt }, { type: "first_frame", url: input.imageBase64 }],
          settings: { resolution: "720p", duration: input.durationSec },
          options: { external_task_id: input.externalTaskId },
        }), signal: AbortSignal.timeout(40_000),
      });
      if (response.status >= 400 && response.status < 500) return { kind: "rejected" };
      if (!response.ok) return { kind: "unknown" };
      const payload = await response.json() as { code?: number; data?: { id?: string } };
      if (payload.code !== 0) return { kind: "rejected" };
      return payload.data?.id ? { kind: "accepted", remoteTaskId: payload.data.id } : { kind: "unknown" };
    } catch { return { kind: "unknown" }; }
  }

  async query(remoteTaskId: string | null, externalTaskId: string): Promise<KlingTask> {
    const params = new URLSearchParams(remoteTaskId ? { task_ids: remoteTaskId } : { external_task_ids: externalTaskId });
    const response = await this.fetchImpl(`${this.baseUrl}/tasks?${params}`, {
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok) throw new Error("可灵任务查询暂不可用");
    const payload = await response.json() as { code?: number; data?: { id?: string; status?: string; outputs?: { type?: string; url?: string }[]; message?: string }[] | { result?: { id?: string; status?: string; outputs?: { type?: string; url?: string }[]; message?: string }[] } };
    if (payload.code !== 0) throw new Error("可灵任务查询返回错误");
    const entries = Array.isArray(payload.data) ? payload.data : payload.data?.result ?? [];
    const task = entries[0];
    if (!task) return { status: "missing" };
    const status = task.status === "submitted" || task.status === "processing" || task.status === "succeeded" || task.status === "failed" ? task.status : "unknown";
    return { status, remoteTaskId: task.id, videoUrl: task.outputs?.find(item => item.type === "video")?.url, message: task.message };
  }

  async download(videoUrl: string, maxBytes = 500_000_000): Promise<Buffer> {
    let current = videoUrl;
    for (let redirect = 0; redirect <= 4; redirect++) {
      const url = new URL(current);
      if (url.protocol !== "https:" || !["klingai.com", "inkwai.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
        throw new Error("视频结果地址不可信");
      }
      const response = await this.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(180_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("视频下载重定向无效");
        current = new URL(location, url).toString(); continue;
      }
      if (!response.ok || !response.body) throw new Error("视频结果下载失败");
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        total += bytes.length;
        if (total > maxBytes) throw new Error("视频结果超过大小限制");
        chunks.push(bytes);
      }
      if (!total) throw new Error("视频结果为空");
      return Buffer.concat(chunks);
    }
    throw new Error("视频结果重定向过多");
  }
}
