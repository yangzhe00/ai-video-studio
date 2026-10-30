import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) { super("请求过于频繁，请稍后再试"); }
}

function normalizeIp(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("::ffff:") && isIP(trimmed.slice(7)) === 4 ? trimmed.slice(7) : trimmed;
}

export function clientIp(req: IncomingMessage, trustedProxyIps: readonly string[] = []): string {
  const peer = normalizeIp(req.socket.remoteAddress ?? "unknown");
  if (!trustedProxyIps.some(ip => normalizeIp(ip) === peer)) return peer;
  const forwarded = req.headers["x-real-ip"];
  if (typeof forwarded !== "string" || isIP(forwarded) === 0) return peer;
  return normalizeIp(forwarded);
}

export function validateTrustedProxyIps(ips: readonly string[]): void {
  for (const ip of ips) if (isIP(ip) === 0) throw new Error("API_TRUSTED_PROXY_IPS must contain literal IP addresses");
}

type Bucket = { count: number; until: number };
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private requests = 0;
  constructor(private readonly windowMs = 60_000, private readonly maxKeys = 20_000) {}

  get size(): number { return this.buckets.size; }

  check(key: string, limit: number, now = Date.now()): void {
    // Opportunistic cleanup makes idle accounts disappear without a process-wide timer.
    if (++this.requests % 100 === 0 || this.buckets.size >= this.maxKeys) {
      for (const [entry, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(entry);
    }
    const current = this.buckets.get(key);
    if (!current && this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    const next = !current || current.until <= now ? { count: 1, until: now + this.windowMs } : { count: current.count + 1, until: current.until };
    this.buckets.set(key, next);
    if (next.count > limit) throw new RateLimitError(Math.max(1, Math.ceil((next.until - now) / 1000)));
  }
}

export function accountRateKey(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}
