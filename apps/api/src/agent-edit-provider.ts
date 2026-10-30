import { AgentEditActionSchema } from "@ai-video/api-contracts";
import type { AgentEditAction } from "@ai-video/api-contracts";
import type { ApiConfig } from "./config.ts";

export class AgentEditProviderError extends Error {
  constructor(readonly code: "not_configured" | "provider_error" | "invalid_response" | "uncertain", message: string) { super(message); }
}

function endpoint(config: ApiConfig): { url: string; key: string; model: string } {
  const base = config.agentEditModelBaseUrl ?? config.ideaModelBaseUrl;
  const key = config.agentEditModelApiKey ?? config.ideaModelApiKey;
  const model = config.agentEditModelId ?? config.ideaModelId;
  if (!base || !key || !model) throw new AgentEditProviderError("not_configured", "Agent 剪辑模型尚未配置");
  let url: URL;
  try { url = new URL(base); } catch { throw new AgentEditProviderError("not_configured", "Agent 剪辑模型地址无效"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new AgentEditProviderError("not_configured", "Agent 剪辑模型地址无效");
  }
  return { url: `${url.toString().replace(/\/$/, "")}/chat/completions`, key, model };
}

async function boundedText(response: Response): Promise<string> {
  const limit = 65_536;
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new AgentEditProviderError("invalid_response", "Agent 建议响应过大");
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

export async function generateAgentEditSuggestions(config: ApiConfig, snapshot: unknown, instruction: string,
  fetcher: typeof fetch = fetch): Promise<AgentEditAction[]> {
  const target = endpoint(config);
  let response: Response;
  try {
    response = await fetcher(target.url, { method: "POST",
      headers: { authorization: `Bearer ${target.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: target.model, temperature: 0.2,
        messages: [
          { role: "system", content: "你只为已有短视频项目提出剪辑建议。只返回 JSON 对象 {\"actions\":[...]}，最多 20 条，不要 Markdown、代码、命令、URL 或素材生成。动作只能是 set-trim、reorder-shots、upsert-caption、set-voice。每条动作有 id、reason；set-trim 需 editId/expectedRevision/startMs/endMs；reorder-shots 需 episodeId/expectedRevision/shotIds；upsert-caption 需 editId/expectedRevision/caption{id,startMs,endMs,text}；set-voice 需 editId/expectedRevision/assetId/startMs/inMs/outMs/volume。所有时间为毫秒。只能使用输入快照中的 ID 与素材，不能改动已有字幕或配音。" },
          { role: "user", content: JSON.stringify({ instruction, snapshot }) },
        ] }), signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new AgentEditProviderError("uncertain", "Agent 剪辑模型连接中断，请手工编辑或重新发起新建议"); }
  if (!response.ok) throw new AgentEditProviderError("provider_error", "Agent 剪辑模型暂不可用");
  let parsed: unknown;
  try {
    const envelope = JSON.parse(await boundedText(response)) as { choices?: { message?: { content?: unknown } }[] };
    if (typeof envelope.choices?.[0]?.message?.content !== "string") throw new Error();
    parsed = JSON.parse(envelope.choices[0].message.content);
  } catch (error) {
    if (error instanceof AgentEditProviderError) throw error;
    throw new AgentEditProviderError("invalid_response", "Agent 未返回可执行的结构化建议");
  }
  const result = parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
    Object.keys(parsed).length === 1 && "actions" in parsed
    ? AgentEditActionSchema.array().min(1).max(20).safeParse(parsed.actions)
    : null;
  if (!result || !result.success) throw new AgentEditProviderError("invalid_response", "Agent 建议包含未知动作或无效字段");
  return result.data;
}
