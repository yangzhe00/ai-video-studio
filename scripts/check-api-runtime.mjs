import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const execFileAsync = promisify(execFile);
const issues = [];

if (!process.env.DATABASE_URL?.trim()) {
  issues.push("DATABASE_URL is missing");
} else {
  let client;
  try {
    const { Client } = requireApi("pg");
    client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
    await client.connect();
    await client.query("SELECT 1");
    process.stdout.write("PostgreSQL connection: OK\n");
  } catch (error) {
    issues.push(`PostgreSQL connection failed (${error?.code ?? "unknown"})`);
  } finally {
    await client?.end().catch(() => {});
  }
}

if (!process.env.CURSOR_API_KEY?.trim()) issues.push("CURSOR_API_KEY is missing");

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
  process.stdout.write("API Cursor configuration and media runtime preflight: OK\n");
}
