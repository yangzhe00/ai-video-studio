import type { ApiConfig } from "./config.ts";
import { IdeaModelError, parseVariantContent } from "./idea-model.ts";
import type { IdeaModelResult } from "./idea-model.ts";

export type CursorIdeaOutcome = { state: "pending"; runId: string | null } |
  { state: "ready"; runId: string; result: IdeaModelResult };

const maxBodyBytes = 65_536;
const agentIdPattern = /^bc-[a-zA-Z0-9-]{1,100}$/;
const runIdPattern = /^run-[a-zA-Z0-9-]{1,100}$/;
const instructions = "你是短视频单镜头创意助手。根据用户的一句话或关键词，为同一个5到10秒镜头写三种明显不同的中文视频脚本。每条描述主体、动作、场景、镜头和氛围，可直接用于图生视频。不要编造参考照片的具体内容，不写旁白，不使用工具、不修改文件。只返回一个JSON对象，不要Markdown或解释。JSON格式：{\"variants\":[{\"title\":\"简短方向名\",\"description\":\"一句话说明画面效果\",\"prompt\":\"完整中文单镜头提示词\"}]}。variants必须恰好三条，且三条提示词明显不同。";

function baseUrl(config: ApiConfig): string {
  if (!config.ideaCursorApiKey) throw new IdeaModelError(503, "not_configured", "灵感服务未配置");
  const raw = config.ideaCursorBaseUrl ?? "https://api.cursor.com/v1";
  let url: URL;
  try { url = new URL(raw); } catch { throw new IdeaModelError(503, "not_configured", "灵感服务地址无效"); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" && url.hostname === "api.cursor.com" || local) ||
      url.username || url.password || url.search || url.hash || !["/v1", "/v1/"].includes(url.pathname)) {
    throw new IdeaModelError(503, "not_configured", "灵感服务地址无效");
  }
  return url.toString().replace(/\/$/, "");
}

async function requestJson(config: ApiConfig, path: string, fetcher: typeof fetch, init: RequestInit = {},
  allowNotFound = false): Promise<unknown | null> {
  const url = `${baseUrl(config)}${path}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { authorization: `Bearer ${config.ideaCursorApiKey}`, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(config.ideaModelTimeoutMs ?? 30_000),
    });
  } catch { throw new IdeaModelError(504, "uncertain", "灵感请求结果待确认"); }
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    const uncertain = response.status === 409 || response.status === 429 || response.status >= 500;
    throw new IdeaModelError(uncertain ? 504 : 502, uncertain ? "uncertain" : "provider_error", "灵感服务暂时不可用");
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBodyBytes) throw new IdeaModelError(502, "invalid_response", "灵感服务响应过大");
  if (!response.body) throw new IdeaModelError(502, "invalid_response", "灵感服务响应无效");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, content = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) throw new IdeaModelError(502, "invalid_response", "灵感服务响应过大");
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
  } catch (error) {
    if (error instanceof IdeaModelError) throw error;
    throw new IdeaModelError(504, "uncertain", "灵感请求结果待确认");
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(content) as unknown; }
  catch { throw new IdeaModelError(502, "invalid_response", "灵感服务响应无效"); }
}

export async function createIdeaCursorRun(config: ApiConfig, input: string, ideaSetId: string,
  fetcher: typeof fetch = fetch): Promise<{ agentId: string; runId: string }> {
  const agentId = `bc-${ideaSetId}`;
  if (!agentIdPattern.test(agentId)) throw new IdeaModelError(502, "invalid_response", "灵感 ID 无效");
  const body: Record<string, unknown> = { agentId, name: "视频灵感", prompt: { text: `${instructions}\n\n用户输入：${input}` }, mode: "agent" };
  if (config.ideaCursorModel) body.model = { id: config.ideaCursorModel };
  const payload = await requestJson(config, "/agents", fetcher, { method: "POST", body: JSON.stringify(body) }) as {
    agent?: { id?: unknown }; run?: { id?: unknown; agentId?: unknown };
  } | null;
  const runId = payload?.run?.id;
  if (payload?.agent?.id !== agentId || typeof runId !== "string" || !runIdPattern.test(runId) ||
      payload.run?.agentId !== agentId) {
    throw new IdeaModelError(502, "invalid_response", "灵感会话创建响应无效");
  }
  return { agentId, runId };
}

export async function readIdeaCursorRun(config: ApiConfig, agentId: string, runId: string | null,
  fetcher: typeof fetch = fetch): Promise<CursorIdeaOutcome> {
  if (!agentIdPattern.test(agentId) || runId !== null && !runIdPattern.test(runId)) {
    throw new IdeaModelError(502, "invalid_response", "灵感会话 ID 无效");
  }
  let activeRunId = runId;
  if (!activeRunId) {
    const agent = await requestJson(config, `/agents/${agentId}`, fetcher, {}, true) as { id?: unknown; latestRunId?: unknown } | null;
    if (!agent) return { state: "pending", runId: null };
    if (agent.id !== agentId) throw new IdeaModelError(502, "invalid_response", "灵感会话响应无效");
    if (typeof agent.latestRunId !== "string" || !runIdPattern.test(agent.latestRunId)) {
      return { state: "pending", runId: null };
    }
    activeRunId = agent.latestRunId;
  }
  const run = await requestJson(config, `/agents/${agentId}/runs/${activeRunId}`, fetcher) as {
    id?: unknown; agentId?: unknown; status?: unknown; result?: unknown;
  } | null;
  if (!run || run.id !== activeRunId || run.agentId !== agentId) {
    throw new IdeaModelError(502, "invalid_response", "灵感运行响应无效");
  }
  if (["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(String(run.status))) {
    return { state: "pending", runId: activeRunId };
  }
  if (run.status === "FINISHED") {
    return { state: "ready", runId: activeRunId, result: parseVariantContent(run.result) };
  }
  if (["ERROR", "CANCELLED", "EXPIRED"].includes(String(run.status))) {
    throw new IdeaModelError(502, "provider_error", "灵感生成未完成");
  }
  throw new IdeaModelError(502, "invalid_response", "灵感运行状态无效");
}
