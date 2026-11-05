export interface SessionStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const urlKey = "avs-api-url";
const cookieKey = "avs-session";
const cookieOriginKey = "avs-session-origin";

export const defaultApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "https://39.108.55.176/api";

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
}

export function normalizeApiUrl(raw: string, allowInsecureLocal = false): string {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new Error("请输入有效的服务器地址，例如 https://39.108.55.176/api"); }
  const path = url.pathname.replace(/\/$/, "");
  if ((url.protocol !== "https:" && !(allowInsecureLocal && url.protocol === "http:" && isLocalHost(url.hostname))) ||
      url.username || url.password || url.search || url.hash || !["", "/api"].includes(path)) {
    throw new Error("服务器地址须为 HTTPS；本地调试可使用局域网 HTTP，路径只支持 /api");
  }
  return `${url.origin}${path}`;
}

export function createMobileSession(storage: SessionStorage, options: { defaultUrl?: string; allowInsecureLocal?: boolean } = {}) {
  const allowInsecureLocal = options.allowInsecureLocal ?? false;
  const initialUrl = normalizeApiUrl(options.defaultUrl ?? defaultApiUrl, allowInsecureLocal);
  let baseUrl = initialUrl;
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
      try { baseUrl = savedUrl ? normalizeApiUrl(savedUrl, allowInsecureLocal) : initialUrl; }
      catch { baseUrl = initialUrl; }
      cookie = origin === baseUrl ? savedCookie ?? "" : "";
      if (origin !== baseUrl) await serialize(async () => {
        if (started !== generation) return;
        await storage.deleteItemAsync(cookieKey);
        await storage.deleteItemAsync(cookieOriginKey);
      });
      return baseUrl;
    },
    async setUrl(url: string) {
      const normalized = normalizeApiUrl(url, allowInsecureLocal);
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
