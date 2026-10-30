import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { accountRateKey, clientIp, RateLimiter, RateLimitError, validateTrustedProxyIps } from "./rate-limit.ts";

function request(peer: string, headers: Record<string, string>): IncomingMessage {
  return { socket: { remoteAddress: peer }, headers } as IncomingMessage;
}

describe("rate limit trust and bounded state", () => {
  it("uses X-Real-IP only from an explicitly trusted peer and never uses X-Forwarded-For", () => {
    expect(clientIp(request("198.51.100.2", { "x-real-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.8" }), ["127.0.0.1"])).toBe("198.51.100.2");
    expect(clientIp(request("::ffff:127.0.0.1", { "x-real-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.8" }), ["127.0.0.1"])).toBe("203.0.113.9");
    expect(clientIp(request("127.0.0.1", { "x-real-ip": "203.0.113.9, 1.2.3.4" }), ["127.0.0.1"])).toBe("127.0.0.1");
    expect(() => validateTrustedProxyIps(["* "])).toThrow();
  });

  it("isolates account buckets under one proxy IP, returns retry time, and bounds memory", () => {
    const limiter = new RateLimiter(60_000, 3);
    const a = accountRateKey("a@example.com"), b = accountRateKey("b@example.com");
    limiter.check(a, 1, 1_000);
    limiter.check(b, 1, 1_000);
    expect(() => limiter.check(a, 1, 1_001)).toThrow(RateLimitError);
    expect(() => limiter.check(b, 1, 1_001)).toThrow(RateLimitError);
    expect(() => limiter.check(a, 1, 1_001)).toThrowError(/频繁/);
    limiter.check("c", 1, 1_000);
    limiter.check("d", 1, 1_000);
    expect(limiter.size).toBeLessThanOrEqual(3);
    limiter.check("e", 1, 62_000);
    expect(limiter.size).toBe(1);
  });
});
