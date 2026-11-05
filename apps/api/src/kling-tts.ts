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
export type TtsAccountStatus = "ok" | "auth_failed" | "permission_denied" | "temporarily_unavailable";

function rejectionMessage(status: number, code?: number): string {
  if (status === 401 || code === 1000 || code === 1002) return "旁白账号认证失败，请检查密钥和接口区域";
  if (status === 403 || code === 1103) return "旁白账号没有 TTS 接口权限";
  if (status === 402 || code === 1101) return "旁白账号余额或额度不足";
  if (status === 429) return "旁白服务请求过于频繁，请稍后再试";
  return "旁白文本或音色不可用，请检查输入与音色权限";
}

/** TTS has no documented external_task_id: an uncertain POST must never be repeated. */
export class KlingTtsGateway {
  private accountCheck?: { at: number; status: TtsAccountStatus };
  private accountCheckPending?: Promise<TtsAccountStatus>;
  constructor(private readonly apiKey: string,
    private readonly baseUrl = "https://api-singapore.klingai.com",
    private readonly fetchImpl: typeof fetch = fetch) {}

  /** Free account check, coalesced and cached to stay below Kling's 1 QPS limit.
   * A successful result verifies authentication, not TTS model entitlement.
   */
  async checkAccount(now = Date.now()): Promise<TtsAccountStatus> {
    if (this.accountCheck && now >= this.accountCheck.at && now - this.accountCheck.at < 60_000) return this.accountCheck.status;
    if (this.accountCheckPending) return this.accountCheckPending;
    this.accountCheckPending = (async () => {
      let status: TtsAccountStatus = "temporarily_unavailable";
      try {
        const params = new URLSearchParams({ start_time: String(now - 86_400_000), end_time: String(now) });
        const response = await this.fetchImpl(`${this.baseUrl}/account/costs?${params}`, {
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 401) status = "auth_failed";
        else if (response.status === 403) status = "permission_denied";
        else if (response.ok) {
          const payload = await response.json() as { code?: number; data?: { code?: number } };
          const code = payload.code === 0 ? payload.data?.code ?? 0 : payload.code;
          status = code === 0 ? "ok" : code === 1000 || code === 1002
            ? "auth_failed" : code === 1103 ? "permission_denied" : "temporarily_unavailable";
        }
      } catch { /* Keep the service unavailable until the account check succeeds. */ }
      this.accountCheck = { at: now, status };
      return status;
    })();
    try { return await this.accountCheckPending; }
    finally { this.accountCheckPending = undefined; }
  }

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
      if (response.status === 408) return { kind: "unknown" };
      if (response.status >= 400 && response.status < 500) {
        const payload = await response.json().catch(() => null) as { code?: number } | null;
        return { kind: "rejected", message: rejectionMessage(response.status, payload?.code) };
      }
      if (!response.ok) return { kind: "unknown" };
      const payload = await response.json() as { code?: number };
      if (payload.code !== 0) return { kind: "rejected", message: rejectionMessage(response.status, payload.code) };
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
