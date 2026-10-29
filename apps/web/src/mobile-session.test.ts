import { describe, expect, it } from "vitest";
import { createMobileSession } from "../../mobile/src/session";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); },
  };
}

describe("mobile session isolation", () => {
  it("does not expose A's cookie to B, including after restart", async () => {
    const storage = memoryStorage();
    const session = createMobileSession(storage);
    await session.setUrl("https://a.example");
    await session.acceptCookie("https://a.example", "avs_session=server-a; HttpOnly");
    expect(session.headers().Cookie).toBe("avs_session=server-a");
    await session.setUrl("https://b.example");
    expect(session.headers()).toEqual({});
    await session.acceptCookie("https://a.example", "avs_session=late-a; HttpOnly");
    expect(session.headers()).toEqual({});
    await session.acceptCookie("https://b.example", "avs_session=server-b; HttpOnly");
    const restored = createMobileSession(storage);
    expect(await restored.restore()).toBe("https://b.example");
    expect(restored.headers().Cookie).toBe("avs_session=server-b");
  });

  it("discards a legacy unscoped cookie on restart", async () => {
    const storage = memoryStorage();
    storage.values.set("avs-api-url", "https://b.example");
    storage.values.set("avs-session", "avs_session=server-a");
    const session = createMobileSession(storage);
    await session.restore();
    expect(session.headers()).toEqual({});
    expect(storage.values.has("avs-session")).toBe(false);
  });

  it("removes an in-flight A response when the user switches to B", async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const originalSet = storage.setItemAsync;
    storage.setItemAsync = async (key, value) => {
      if (key === "avs-session" && value === "avs_session=server-a") await gate;
      await originalSet(key, value);
    };
    const session = createMobileSession(storage);
    await session.setUrl("https://a.example");
    const oldResponse = session.acceptCookie("https://a.example", "avs_session=server-a; HttpOnly");
    await Promise.resolve();
    const switchServer = session.setUrl("https://b.example");
    expect(session.headers()).toEqual({});
    release();
    await Promise.all([oldResponse, switchServer]);
    expect(session.headers()).toEqual({});
    expect(storage.values.has("avs-session")).toBe(false);
  });
});
