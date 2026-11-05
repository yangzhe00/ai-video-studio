import { describe, expect, it, vi } from "vitest";
import { KlingTtsGateway } from "./kling-tts.ts";

describe("Kling TTS account preflight", () => {
  it("uses the free regional account check and caches a successful result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    const gateway = new KlingTtsGateway("test-secret", "https://api-singapore.klingai.com", fetchImpl);
    expect(await gateway.checkAccount(100_000_000)).toBe("ok");
    expect(await gateway.checkAccount(100_000_001)).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api-singapore.klingai.com/account/costs?");
    expect(url).toContain("start_time=");
    expect(options.headers).toMatchObject({ authorization: "Bearer test-secret" });
  });

  it.each([
    [401, {}, "auth_failed"],
    [403, {}, "permission_denied"],
    [200, { code: 1002 }, "auth_failed"],
    [200, { code: 0, data: { code: 1103 } }, "permission_denied"],
    [200, { code: 1103 }, "permission_denied"],
    [503, {}, "temporarily_unavailable"],
  ] as const)("keeps voices unavailable for HTTP %s and response %j", async (http, body, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: http }));
    const gateway = new KlingTtsGateway("test-secret", undefined, fetchImpl);
    expect(await gateway.checkAccount()).toBe(expected);
  });

  it.each([
    [401, 1002, "账号认证失败"],
    [403, 1103, "没有 TTS 接口权限"],
    [429, 1101, "余额或额度不足"],
  ] as const)("classifies a rejected TTS POST without retrying it", async (http, code, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code }), { status: http }));
    const gateway = new KlingTtsGateway("test-secret", undefined, fetchImpl);
    const result = await gateway.submit({ text: "晚餐做好啦，上菜！", voiceId: "verified_zh",
      voiceLanguage: "zh", speed: 1 });
    expect(result).toMatchObject({ kind: "rejected", message: expect.stringContaining(message) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a request timeout as an unknown paid submission", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 408 }));
    const gateway = new KlingTtsGateway("test-secret", undefined, fetchImpl);
    expect(await gateway.submit({ text: "晚餐做好啦，上菜！", voiceId: "verified_zh",
      voiceLanguage: "zh", speed: 1 })).toEqual({ kind: "unknown" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
