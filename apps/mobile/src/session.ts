export interface SessionStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const urlKey = "avs-api-url";
const cookieKey = "avs-session";
const cookieOriginKey = "avs-session-origin";

export function createMobileSession(storage: SessionStorage) {
  let baseUrl = "";
  let cookie = "";
  let generation = 0;
  let pending: Promise<unknown> = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = pending.then(operation);
    pending = task.catch(() => {});
    return task;
  }
  return {
    async restore() {
      const started = generation;
      await pending;
      const [savedUrl, origin, savedCookie] = await Promise.all([
        storage.getItemAsync(urlKey), storage.getItemAsync(cookieOriginKey), storage.getItemAsync(cookieKey),
      ]);
      if (started !== generation) return baseUrl;
      baseUrl = savedUrl ?? "";
      cookie = origin === baseUrl ? savedCookie ?? "" : "";
      if (origin !== baseUrl) await serialize(async () => {
        if (started !== generation) return;
        await storage.deleteItemAsync(cookieKey);
        await storage.deleteItemAsync(cookieOriginKey);
      });
      return baseUrl;
    },
    async setUrl(url: string) {
      const normalized = url.trim().replace(/\/$/, "");
      if (!/^https?:\/\/[^/]+$/.test(normalized)) throw new Error("请输入服务器地址，例如 http://192.168.1.10:8787");
      const changed = normalized !== baseUrl;
      if (changed) generation++;
      baseUrl = normalized;
      if (changed) cookie = "";
      await serialize(async () => {
        if (changed) {
          await storage.deleteItemAsync(cookieKey);
          await storage.deleteItemAsync(cookieOriginKey);
        }
        await storage.setItemAsync(urlKey, normalized);
      });
    },
    getUrl: () => baseUrl,
    headers: (): Record<string, string> => cookie ? { Cookie: cookie } : {},
    async acceptCookie(origin: string, setCookie: string | null) {
      if (origin !== baseUrl || !setCookie?.startsWith("avs_session=")) return;
      const receivedAt = generation;
      await serialize(async () => {
        if (origin !== baseUrl || receivedAt !== generation) return;
        cookie = setCookie.split(";")[0] === "avs_session=" ? "" : setCookie.split(";")[0];
        if (cookie) {
          await storage.setItemAsync(cookieOriginKey, origin);
          await storage.setItemAsync(cookieKey, cookie);
        } else {
          await storage.deleteItemAsync(cookieKey);
          await storage.deleteItemAsync(cookieOriginKey);
        }
      });
    },
  };
}
