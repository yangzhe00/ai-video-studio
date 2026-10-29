import type { ApiConfig } from "./config.ts";

export interface PromptVariant { id: string; title: string; description: string; prompt: string }
export interface IdeaModelResult { variants: PromptVariant[]; usage: unknown }

export class IdeaModelError extends Error {
  constructor(readonly status: number, readonly code: "not_configured" | "provider_error" | "invalid_response" | "uncertain", message: string) {
    super(message);
  }
}

const maxResponseBytes = 65_536;

function endpoint(config: ApiConfig): string {
  if (!config.ideaModelBaseUrl || !config.ideaModelApiKey || !config.ideaModelId) {
    throw new IdeaModelError(503, "not_configured", "灵感服务未配置");
  }
  let url: URL;
  try { url = new URL(config.ideaModelBaseUrl); }
  catch { throw new IdeaModelError(503, "not_configured", "灵感服务地址无效"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new IdeaModelError(503, "not_configured", "灵感服务地址无效");
  }
  return `${url.toString().replace(/\/$/, "")}/chat/completions`;
}

async function boundedBody(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxResponseBytes) throw new IdeaModelError(502, "invalid_response", "灵感服务响应过大");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) throw new IdeaModelError(502, "invalid_response", "灵感服务响应过大");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

export function parseVariantContent(content: unknown, usage: unknown = null): IdeaModelResult {
  if (typeof content !== "string") throw new IdeaModelError(502, "invalid_response", "灵感服务返回内容无效");
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw new IdeaModelError(502, "invalid_response", "灵感服务未返回三版结构化提示词"); }
  const candidates = (parsed as { variants?: unknown } | null)?.variants;
  if (!Array.isArray(candidates) || candidates.length !== 3) throw new IdeaModelError(502, "invalid_response", "灵感服务未返回恰好三版提示词");
  const variants: PromptVariant[] = candidates.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new IdeaModelError(502, "invalid_response", "灵感服务提示词格式无效");
    const row = value as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
    if (!title || title.length > 50 || !description || description.length > 160 || !prompt || prompt.length > 2000) {
      throw new IdeaModelError(502, "invalid_response", "灵感服务提示词格式无效");
    }
    return { id: `variant-${index + 1}`, title, description, prompt };
  });
  if (new Set(variants.map(item => item.prompt.replace(/\s+/g, "").toLowerCase())).size !== 3) {
    throw new IdeaModelError(502, "invalid_response", "灵感服务返回了重复提示词");
  }
  return { variants, usage };
}

function parseVariants(payload: unknown): IdeaModelResult {
  if (!payload || typeof payload !== "object") throw new IdeaModelError(502, "invalid_response", "灵感服务返回内容无效");
  const result = payload as { choices?: { message?: { content?: unknown } }[]; usage?: unknown };
  return parseVariantContent(result.choices?.[0]?.message?.content, result.usage ?? null);
}

export async function generatePromptIdeas(config: ApiConfig, input: string, fetcher: typeof fetch = fetch): Promise<IdeaModelResult> {
  const url = endpoint(config);
  const timeoutMs = config.ideaModelTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new IdeaModelError(503, "not_configured", "灵感服务超时配置无效");
  }
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.ideaModelApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: config.ideaModelId,
        messages: [
          { role: "system", content: "你是短视频单镜头创意助手。根据用户的一句话或关键词，只为同一个5到10秒镜头写三种明显不同的创意方向。仅返回JSON对象，格式为 {\"variants\":[{\"title\":\"简短方向名\",\"description\":\"一句话说明画面效果\",\"prompt\":\"可直接用于图生视频的完整中文单镜头提示词\"}]}。必须恰好三项，不写旁白，不写Markdown，不虚构已有照片内容。" },
          { role: "user", content: input },
        ],
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await boundedBody(response);
    if (!response.ok) throw new IdeaModelError(502, "provider_error", "灵感服务暂时不可用");
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { throw new IdeaModelError(502, "invalid_response", "灵感服务响应无效"); }
    return parseVariants(payload);
  } catch (error) {
    if (error instanceof IdeaModelError) throw error;
    throw new IdeaModelError(504, "uncertain", "灵感请求结果待确认；不会自动重复调用，请明确开始新一轮");
  }
}

export async function generatePromptVariants(config: ApiConfig, input: string, fetcher: typeof fetch = fetch): Promise<PromptVariant[]> {
  return (await generatePromptIdeas(config, input, fetcher)).variants;
}
