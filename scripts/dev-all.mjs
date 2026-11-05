import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(process.env.AI_VIDEO_DEV_ENV_FILE || resolve(root, ".env.dev.local"));
const children = [];
let stopping = false;

function fail(message) {
  process.stderr.write(`[dev] ${message}\n`);
  process.exitCode = 1;
}

function localUrl(raw, name) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${name} 不是有效 URL`); }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`${name} 必须指向本机，拒绝在开发命令中连接远程服务`);
  }
  return url;
}

function isPortOpen(port) {
  return new Promise(resolveCheck => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolveCheck(true); });
    socket.once("error", () => resolveCheck(false));
    socket.once("timeout", () => { socket.destroy(); resolveCheck(false); });
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try { process.kill(-child.pid, "SIGTERM"); }
    catch { try { child.kill("SIGTERM"); } catch { /* already exited */ } }
  }
  setTimeout(() => process.exit(), 1500).unref();
}

function start(label, args, env) {
  process.stdout.write(`[dev] 启动${label}\n`);
  const child = spawn("pnpm", args, {
    cwd: root, env, stdio: "inherit", detached: process.platform !== "win32",
  });
  children.push(child);
  child.once("error", error => { fail(`${label}启动失败：${error.message}`); stop(1); });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      fail(`${label}已退出（${signal || code}）`);
      stop(1);
    }
  });
  return child;
}

async function waitFor(url, label, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !stopping) {
    if (child.exitCode !== null) throw new Error(`${label}进程已退出`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* starting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
  }
  throw new Error(`${label} 30 秒内未就绪：${url}`);
}

async function main() {
  if (!existsSync(envFile)) {
    throw new Error(`缺少 ${envFile}；请复制 .env.example 并填写本地数据库和会话配置`);
  }
  process.loadEnvFile(envFile);
  const required = ["DATABASE_URL", "API_DATA_DIR", "API_SESSION_SECRET", "API_ALLOWED_ORIGIN"];
  for (const name of required) if (!process.env[name]) throw new Error(`${envFile} 缺少 ${name}`);
  if (process.env.API_SESSION_SECRET.length < 32) throw new Error("API_SESSION_SECRET 至少 32 字符");
  const database = localUrl(process.env.DATABASE_URL, "DATABASE_URL");
  if (!/^postgres(?:ql)?:$/.test(database.protocol)) throw new Error("DATABASE_URL 必须是 PostgreSQL URL");
  const origin = localUrl(process.env.API_ALLOWED_ORIGIN, "API_ALLOWED_ORIGIN");
  if (origin.protocol !== "http:" || origin.origin !== process.env.API_ALLOWED_ORIGIN) {
    throw new Error("API_ALLOWED_ORIGIN 必须是精确的本地 HTTP origin");
  }
  const apiPort = Number(process.env.PORT || 8787);
  const webPort = Number(origin.port || 80);
  for (const [name, port] of [["API", apiPort], ["网页", webPort], ["桌面 Vite", 1420]]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name}端口无效`);
    if (await isPortOpen(port)) throw new Error(`${name}端口 ${port} 已被占用；先停止旧进程或修改本地配置`);
  }
  const baseEnv = { ...process.env, API_SECURE_COOKIES: "false", API_BIND_HOST: "127.0.0.1", NODE_ENV: "development" };
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  process.stdout.write(`[dev] PostgreSQL ${database.hostname}:${database.port || 5432}${database.pathname}；API ${apiUrl}；网页 ${origin.origin}\n`);
  const api = start("后端 API", ["--filter", "@ai-video/api", "dev"], baseEnv);
  await waitFor(`${apiUrl}/health`, "后端 API", api);
  const web = start("网页端", ["--filter", "@ai-video/web", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    { ...baseEnv, VITE_API_PROXY_TARGET: apiUrl });
  await waitFor(origin.origin, "网页端", web);
  start("桌面端", ["--filter", "@ai-video/desktop", "tauri", "dev"],
    { ...baseEnv, AI_VIDEO_API_BASE_URL: apiUrl });
  process.stdout.write(`[dev] 网页：${origin.origin}  桌面：原生窗口  后端：${apiUrl}/health\n[dev] 按 Ctrl+C 停止本次启动的三个进程\n`);
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
main().catch(error => { fail(error.message); stop(1); });
