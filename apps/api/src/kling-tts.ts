export interface TtsProviderTask {
  taskId: string;
  status: "submitted" | "processing" | "succeed" | "failed";
  audioUrl?: string;
  requestId?: string;
  message?: string;
  deduction?: { quota?: string; listPrice?: string; units?: string };
}
export type TtsSubmitResult = { kind: "accepted"; task: TtsProviderTask } |
  { kind: "rejected"; message: string } | { kind: "unknown" };

/** TTS has no documented external_task_id: an uncertain POST must never be repeated. */
export class KlingTtsGateway {
  constructor(private readonly apiKey: string,
    private readonly baseUrl = "https://api-singapore.klingai.com",
    private readonly fetchImpl: typeof fetch = fetch) {}

  private parse(payload: unknown): TtsProviderTask | null {
    const response = payload as { code?: number; request_id?: string; data?: {
      task_id?: string; task_status?: string; task_status_msg?: string;
      task_result?: { audios?: { url?: string }[] };
      final_unit_deduction?: string;
      final_balance_deduction?: { quota?: string; list_price?: string };
    } };
    if (response.code !== 0 || !response.data?.task_id) return null;
    const status = response.data.task_status;
    if (status !== "submitted" && status !== "processing" && status !== "succeed" && status !== "failed") return null;
    return { taskId: response.data.task_id, status, requestId: response.request_id,
      audioUrl: response.data.task_result?.audios?.[0]?.url,
      message: response.data.task_status_msg,
      deduction: { quota: response.data.final_balance_deduction?.quota,
        listPrice: response.data.final_balance_deduction?.list_price,
        units: response.data.final_unit_deduction } };
  }

  async submit(input: { text: string; voiceId: string; voiceLanguage: "zh" | "en"; speed: number }): Promise<TtsSubmitResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/audio/tts`, {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ text: input.text, voice_id: input.voiceId,
          voice_language: input.voiceLanguage, voice_speed: input.speed }), signal: AbortSignal.timeout(40_000),
      });
      if (response.status >= 400 && response.status < 500) return { kind: "rejected", message: "可灵拒绝了配音请求，请检查账户权限和文本" };
      if (!response.ok) return { kind: "unknown" };
      const payload = await response.json() as { code?: number };
      if (payload.code !== 0) return { kind: "rejected", message: "可灵拒绝了配音请求，请检查音色、语言与账户权限" };
      const task = this.parse(payload);
      return task ? { kind: "accepted", task } : { kind: "unknown" };
    } catch { return { kind: "unknown" }; }
  }

  async query(taskId: string): Promise<TtsProviderTask> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/audio/tts/${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok) throw new Error("可灵配音任务查询暂不可用");
    const task = this.parse(await response.json());
    if (!task || task.taskId !== taskId) throw new Error("可灵配音任务响应无效");
    return task;
  }

  async download(urlText: string, maxBytes = 20_000_000): Promise<Buffer> {
    let current = urlText;
    for (let redirect = 0; redirect < 5; redirect++) {
      const url = new URL(current);
      if (url.protocol !== "https:" || !["klingai.com", "inkwai.com", "kwimgs.com"].some(domain =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new Error("配音结果地址不可信");
      const response = await this.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("配音下载重定向无效");
        current = new URL(location, url).toString(); continue;
      }
      if (!response.ok || !response.body) throw new Error("配音结果下载失败");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) throw new Error("配音结果过大");
        chunks.push(bytes);
      }
      if (!size) throw new Error("配音结果为空");
      return Buffer.concat(chunks);
    }
    throw new Error("配音结果重定向过多");
  }
}
