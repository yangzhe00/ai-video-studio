import assert from "node:assert/strict";
import test from "node:test";
import { createMobileSession, normalizeApiUrl } from "./session.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItemAsync(key: string) { return values.get(key) ?? null; },
    async setItemAsync(key: string, value: string) { values.set(key, value); },
    async deleteItemAsync(key: string) { values.delete(key); },
  };
}

test("production API path is normalized and remote HTTP is rejected", () => {
  assert.equal(normalizeApiUrl(" https://39.108.55.176/api/ "), "https://39.108.55.176/api");
  assert.throws(() => normalizeApiUrl("http://example.com/api", true), /HTTPS/);
  assert.throws(() => normalizeApiUrl("https://user:pass@example.com/api"), /HTTPS/);
  assert.throws(() => normalizeApiUrl("https://example.com/api?token=secret"), /HTTPS/);
});

test("development allows only local or private LAN HTTP", () => {
  assert.equal(normalizeApiUrl("http://192.168.1.20:8798", true), "http://192.168.1.20:8798");
  assert.equal(normalizeApiUrl("http://127.0.0.1:8798/api", true), "http://127.0.0.1:8798/api");
  assert.throws(() => normalizeApiUrl("http://192.168.1.20:8798"), /HTTPS/);
  assert.throws(() => normalizeApiUrl("http://8.8.8.8:8798", true), /HTTPS/);
});

test("changing the API clears the old cookie before a new login", async () => {
  const storage = memoryStorage();
  const session = createMobileSession(storage, { defaultUrl: "https://first.example/api" });
  await session.acceptCookie("https://first.example/api", "avs_session=old; HttpOnly");
  assert.equal(session.headers().Cookie, "avs_session=old");
  await session.setUrl("https://second.example/api");
  assert.deepEqual(session.headers(), {});
  assert.equal(storage.values.has("avs-session"), false);
  await session.acceptCookie("https://first.example/api", "avs_session=stale; HttpOnly");
  assert.deepEqual(session.headers(), {});
});

test("release restore discards a previously saved insecure API and session", async () => {
  const storage = memoryStorage({
    "avs-api-url": "http://192.168.1.20:8798", "avs-session-origin": "http://192.168.1.20:8798",
    "avs-session": "avs_session=old",
  });
  const session = createMobileSession(storage, { defaultUrl: "https://example.com/api" });
  assert.equal(await session.restore(), "https://example.com/api");
  assert.deepEqual(session.headers(), {});
  assert.equal(storage.values.has("avs-session"), false);
});
