import type { ApiConfig } from "./config.ts";
import { IdeaModelError, parseVariantContent } from "./idea-model.ts";
import type { IdeaModelResult } from "./idea-model.ts";

type AgentStatus = { state: "pending" } | { state: "ready"; result: IdeaModelResult };
const maxBodyBytes = 65_536;
const instructions = "你是短视频单镜头创意助手。根据用户的一句话或关键词，给同一个5到10秒镜头写三种明显不同的中文创意脚本。每条必须描述主体、动作、场景、镜头和氛围，可直接用于图生视频。不要编造参考照片的具体内容，不写旁白。";
const variantSchema = {
  type: "object", additionalProperties: false, required: ["variants"],
  properties: { variants: { type: "array", minItems: 3, maxItems: 3, items: {
    type: "object", additionalProperties: false, required: ["title", "description", "prompt"],
    properties: { title: { type: "string" }, description: { type: "string" }, prompt: { type: "string" } },
  } } },
};

function baseUrl(config: ApiConfig): string {
  if (!config.ideaAgentApiKey || !config.ideaAgentModel) throw new IdeaModelError(503, "not_configured", "灵感服务未配置");
  const raw = config.ideaAgentBaseUrl ?? "https://api.openai.com/v1";
  let url: URL;
  try { url = new URL(raw); } catch { throw new IdeaModelError(503, "not_configured", "灵感服务地址无效"); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" && url.hostname === "api.openai.com" || local) ||
      url.username || url.password || url.search || url.hash || !["/v1", "/v1/"].includes(url.pathname)) {
    throw new IdeaModelError(503, "not_configured", "灵感服务地址无效");
  }
  return url.toString().replace(/\/$/, "");
}

async function requestJson(config: ApiConfig, path: string, fetcher: typeof fetch, init: RequestInit = {}): Promise<unknown> {
  const url = `${baseUrl(config)}${path}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init, headers: { authorization: `Bearer ${config.ideaAgentApiKey}`, "OpenAI-Beta": "agents=v1",
        "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(config.ideaModelTimeoutMs ?? 30_000),
    });
  } catch { throw new IdeaModelError(504, "uncertain", "灵感请求结果待确认"); }
  if (!response.ok) throw new IdeaModelError(response.status === 429 || response.status >= 500 ? 504 : 502,
    response.status === 429 || response.status >= 500 ? "uncertain" : "provider_error", "灵感服务暂时不可用");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBodyBytes) throw new IdeaModelError(502, "invalid_response", "灵感服务响应过大");
  let text = "";
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty body");
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) { await reader.cancel(); throw new IdeaModelError(502, "invalid_response", "灵感服务响应过大"); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof IdeaModelError) throw error;
    throw new IdeaModelError(504, "uncertain", "灵感请求结果待确认");
  }
  try { return JSON.parse(text) as unknown; }
  catch { throw new IdeaModelError(502, "invalid_response", "灵感服务响应无效"); }
}

export async function createIdeaAgentSession(config: ApiConfig, input: string, ideaSetId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const payload = await requestJson(config, "/agents/sessions", fetcher, { method: "POST", body: JSON.stringify({
    agent: { model: config.ideaAgentModel, instructions, tools: [], multi_agent: { enabled: false },
      text: { format: { type: "json_schema", schema: variantSchema } } },
    environment: { type: "none" }, input,
    metadata: { idea_set_id: ideaSetId },
  }) });
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id) throw new IdeaModelError(502, "invalid_response", "灵感会话创建响应无效");
  return id;
}

export async function readIdeaAgentSession(config: ApiConfig, sessionId: string, fetcher: typeof fetch = fetch): Promise<AgentStatus> {
  if (!/^[-_a-zA-Z0-9]{1,128}$/.test(sessionId)) throw new IdeaModelError(502, "invalid_response", "灵感会话 ID 无效");
  const session = await requestJson(config, `/agents/sessions/${sessionId}`, fetcher) as { status?: string } | null;
  if (!session || typeof session !== "object") throw new IdeaModelError(502, "invalid_response", "灵感会话状态无效");
  if (session.status === "in_progress") return { state: "pending" };
  if (session.status === "failed" || session.status === "requires_action") throw new IdeaModelError(502, "provider_error", "灵感会话失败");
  if (session.status !== "idle") throw new IdeaModelError(502, "invalid_response", "灵感会话状态无效");
  const turns = await requestJson(config, `/agents/sessions/${sessionId}/turns?limit=1&order=desc`, fetcher) as { data?: { id?: string; status?: string; subagent_id?: string | null; usage?: unknown }[] };
  if (!Array.isArray(turns?.data)) throw new IdeaModelError(502, "invalid_response", "灵感会话记录无效");
  const turn = turns.data.find(item => item.subagent_id == null);
  if (!turn || ["queued", "in_progress", "waiting"].includes(turn.status ?? "")) return { state: "pending" };
  if (turn.status !== "completed" || !turn.id) throw new IdeaModelError(502, "provider_error", "灵感生成未完成");
  const items = await requestJson(config, `/agents/sessions/${sessionId}/turns/${turn.id}/items?limit=100&order=asc`, fetcher) as {
    data?: { type?: string; role?: string; phase?: string; status?: string; content?: { type?: string; text?: string }[] }[];
    has_more?: boolean;
  };
  if (items.has_more) throw new IdeaModelError(502, "invalid_response", "灵感输出过长");
  const final = items.data?.filter(item => item.type === "message" && item.role === "assistant" && item.phase === "final_answer" && item.status === "completed").at(-1);
  const content = final?.content?.filter(item => item.type === "output_text").map(item => item.text ?? "").join("");
  return { state: "ready", result: parseVariantContent(content, turn.usage ?? null) };
}
