export type ReleaseInfo = {
  version: string;
  platform: "macos-arm64";
  filename: string;
  bytes: number;
  sha256: string;
  publishedAt: string;
};

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const HASH = /^[a-fA-F0-9]{64}$/;

export function parseRelease(value: unknown): ReleaseInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.version !== "string" || !VERSION.test(item.version)) return null;
  if (item.platform !== "macos-arm64") return null;
  if (item.filename !== `AI-Video-Studio-${item.version}-macos-arm64.dmg`) return null;
  if (!Number.isSafeInteger(item.bytes) || Number(item.bytes) <= 0) return null;
  if (typeof item.sha256 !== "string" || !HASH.test(item.sha256)) return null;
  if (typeof item.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(item.publishedAt) || Number.isNaN(Date.parse(item.publishedAt))) return null;
  return {
    version: item.version,
    platform: "macos-arm64",
    filename: item.filename,
    bytes: Number(item.bytes),
    sha256: item.sha256.toLowerCase(),
    publishedAt: item.publishedAt,
  };
}

export function releaseUrl(release: ReleaseInfo): string {
  return `/downloads/${release.filename}`;
}

export async function loadRelease(
  manifestUrl = "/downloads/latest.json",
  fetcher: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
  try {
    const response = await fetcher(manifestUrl, { cache: "no-store", redirect: "error" });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    const release = parseRelease(await response.json());
    if (!release) return null;

    const file = await fetcher(releaseUrl(release), { method: "HEAD", cache: "no-store", redirect: "error" });
    if (!file.ok) return null;
    const fileType = file.headers.get("content-type") || "";
    if (fileType.includes("text/html") || fileType.includes("application/json")) return null;
    if (Number(file.headers.get("content-length")) !== release.bytes) return null;
    return release;
  } catch {
    return null;
  }
}
