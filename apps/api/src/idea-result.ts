export interface PromptVariant { id: string; title: string; description: string; prompt: string }
export interface IdeaModelResult { variants: PromptVariant[]; usage: unknown }

export class IdeaModelError extends Error {
  constructor(readonly status: number, readonly code: "not_configured" | "provider_error" | "invalid_response" | "uncertain", message: string) {
    super(message);
  }
}

export function normalizedPrompt(prompt: string): string { return prompt.replace(/\s+/g, "").toLowerCase(); }

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
  if (new Set(variants.map(item => normalizedPrompt(item.prompt))).size !== 3) {
    throw new IdeaModelError(502, "invalid_response", "灵感服务返回了重复提示词");
  }
  return { variants, usage };
}
