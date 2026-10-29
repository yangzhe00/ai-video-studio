import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const execFileAsync = promisify(execFile);
const issues = [];

for (const key of ["IDEA_MODEL_BASE_URL", "IDEA_MODEL_API_KEY", "IDEA_MODEL_ID"]) {
  if (!process.env[key]?.trim()) issues.push(`${key} is missing`);
}

if (process.env.IDEA_MODEL_BASE_URL) {
  try {
    const url = new URL(process.env.IDEA_MODEL_BASE_URL);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
        url.username || url.password || url.search || url.hash || !url.hostname) {
      issues.push("IDEA_MODEL_BASE_URL must be HTTPS (or loopback HTTP for local testing) without credentials, query or fragment");
    }
  } catch {
    issues.push("IDEA_MODEL_BASE_URL is invalid");
  }
}

try {
  const ffprobe = requireApi("@ffprobe-installer/ffprobe");
  await access(ffprobe.path, constants.X_OK);
  const { stdout } = await execFileAsync(ffprobe.path, ["-version"], { timeout: 5_000, maxBuffer: 16_384 });
  if (!stdout.startsWith("ffprobe version ")) issues.push("ffprobe returned an unexpected version response");
  else process.stdout.write(`ffprobe executable: OK (${process.platform}/${process.arch})\n`);
} catch (error) {
  const code = error?.code ?? error?.signal ?? "unknown";
  issues.push(`ffprobe cannot execute (${code}); check the platform package and its shared-library dependencies`);
}

if (issues.length) {
  for (const issue of issues) process.stderr.write(`deployment preflight: ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("API model and media runtime preflight: OK\n");
}
