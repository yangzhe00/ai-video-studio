import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "./config.ts";
import { validateSecurityConfig } from "./request-security.ts";

const base: ApiConfig = { dataDir: "/tmp/unused", databaseUrl: "postgresql://unused", sessionSecret: "test-secret-at-least-thirty-two-characters" };
afterEach(() => vi.unstubAllEnvs());

describe("production request security configuration", () => {
  it("requires an exact HTTPS origin and Secure cookie mode before opening the API", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => validateSecurityConfig({ ...base, secureCookies: true })).toThrow();
    expect(() => validateSecurityConfig({ ...base, allowedOrigin: "http://studio.example.test", secureCookies: true })).toThrow();
    expect(() => validateSecurityConfig({ ...base, allowedOrigin: "https://studio.example.test/path", secureCookies: true })).toThrow();
    expect(() => validateSecurityConfig({ ...base, allowedOrigin: "https://studio.example.test", secureCookies: false })).toThrow();
    expect(() => validateSecurityConfig({ ...base, allowedOrigin: "https://studio.example.test", secureCookies: true })).not.toThrow();
  });
});
