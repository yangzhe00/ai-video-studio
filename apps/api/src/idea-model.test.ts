import { describe, expect, it, vi } from "vitest";
import { generatePromptVariants, IdeaModelError } from "./idea-model.ts";
import type { ApiConfig } from "./config.ts";

const base: ApiConfig = {
  dataDir: "/tmp/idea-model-test", databaseUrl: "postgresql://unused", sessionSecret: "x".repeat(32),
  ideaModelBaseUrl: "https://model.example/v1", ideaModelApiKey: "server-secret", ideaModelId: "text-model",
  ideaModelTimeoutMs: 1000,
};
const variants = [
  { title: "叙事", description: "交代人物动作", prompt: "小狗在厨房切菜，固定镜头。" },
  { title: "情绪", description: "突出温暖氛围", prompt: "小狗在暖光厨房切菜，近景镜头。" },
  { title: "节奏", description: "突出快速动作", prompt: "小狗快速切菜，轻快推镜。" },
];
const modelResponse = (items: unknown = variants) => Response.json({ choices: [{ message: { content: JSON.stringify({ variants: items }) } }], usage: { total_tokens: 123 } });

describe("idea model adapter", () => {
  it("uses a server-only Chat Completions request and returns exactly three variants", async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => modelResponse());
    const result = await generatePromptVariants(base, "小狗做饭", fetcher as typeof fetch);
    expect(result.map(item => item.id)).toEqual(["variant-1", "variant-2", "variant-3"]);
    expect(result[0].prompt).toBe(variants[0].prompt);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://model.example/v1/chat/completions");
    expect(options.headers).toMatchObject({ authorization: "Bearer server-secret" });
    expect(JSON.parse(options.body as string)).toMatchObject({ model: "text-model" });
  });

  it("rejects missing configuration without fabricating ideas", async () => {
    await expect(generatePromptVariants({ ...base, ideaModelApiKey: undefined }, "小狗做饭", vi.fn() as typeof fetch))
      .rejects.toMatchObject({ code: "not_configured", status: 503 });
  });

  it("rejects malformed and duplicate variants", async () => {
    const bad = vi.fn(async () => modelResponse([variants[0], variants[0], variants[2]]));
    await expect(generatePromptVariants(base, "小狗做饭", bad as typeof fetch))
      .rejects.toMatchObject({ code: "invalid_response" });
    const malformed = vi.fn(async () => Response.json({ choices: [{ message: { content: "not-json" } }] }));
    await expect(generatePromptVariants(base, "小狗做饭", malformed as typeof fetch))
      .rejects.toBeInstanceOf(IdeaModelError);
  });

  it("distinguishes provider errors from uncertain timeouts", async () => {
    await expect(generatePromptVariants(base, "小狗做饭", vi.fn(async () => new Response("bad", { status: 400 })) as typeof fetch))
      .rejects.toMatchObject({ code: "provider_error", status: 502 });
    await expect(generatePromptVariants(base, "小狗做饭", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch))
      .rejects.toMatchObject({ code: "uncertain", status: 504 });
  });

  it("rejects an oversized response body", async () => {
    const huge = vi.fn(async () => new Response("x".repeat(70_000)));
    await expect(generatePromptVariants(base, "小狗做饭", huge as typeof fetch))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});
