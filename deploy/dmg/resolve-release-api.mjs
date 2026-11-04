import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function parseReleaseApiBase(raw) {
  if (typeof raw !== "string" || raw !== raw.trim()) throw new Error("Release API base is missing or malformed");
  let url;
  try { url = new URL(raw); } catch { throw new Error("Release API base is not a URL"); }
  if (url.protocol !== "https:" || !url.hostname || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/api" ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Release API base must be a public HTTPS URL ending in /api without credentials or query");
  }
  return url.href;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
  process.stdout.write(`${parseReleaseApiBase(config.apiBaseUrl)}\n`);
}
