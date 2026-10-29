import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import type { ApiConfig } from "./config.ts";
import { clearSession, createSession, hashPassword, normalizeEmail, sessionAccount, validatePassword, verifyPassword } from "./auth.ts";
import { createDb } from "./db.ts";
import { approveRun, createRun, getRun, listProjectRuns, listRunEvents, RunError } from "./runs.ts";
import { GenerationWorker } from "./generation-worker.ts";
import { KlingGateway } from "./kling.ts";
import { applyProjectCommand, listResourceRevisions, SyncError } from "./sync.ts";
import { applyEditCommand, createEdit, createRender, EditError, findEdit, getEdit, listEditVersions, renderSnapshot } from "./video-edits.ts";
import { RenderWorker } from "./render-worker.ts";
import { inspectMedia, MediaInspectError } from "./media-inspect.ts";
import { storeObject, ObjectCapacityError } from "./object-capacity.ts";
import { readProjectDsl } from "./project-dsl.ts";
import { createPromptIdea, getPromptIdea, listPromptIdeas, PromptIdeasError, selectPromptIdea } from "./prompt-ideas.ts";
import { IdeaAgentWorker } from "./idea-agent-worker.ts";

class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const pieces: Buffer[] = [];
  let total = 0;
  for await (const piece of req) {
    const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    total += buffer.length;
    if (total > limit) throw new ApiError(413, "上传内容超过大小限制");
    pieces.push(buffer);
  }
  return Buffer.concat(pieces);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const bytes = await readBytes(req, 1_000_000);
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new ApiError(400, "请求 JSON 无效"); }
}

function reply(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function projectSummary(row: { id: string; title: string; revision: number; updated_at: number; recent_episode_id: string | null; document_json: string }) {
  const document = JSON.parse(row.document_json) as { episodes?: { id: string; title: string; shots?: unknown[] }[] };
  const recent = document.episodes?.find(item => item.id === row.recent_episode_id) ?? document.episodes?.[0];
  return { id: row.id, title: row.title, revision: row.revision, updatedAt: row.updated_at,
    recentEpisode: recent ? { id: recent.id, title: recent.title, shotCount: recent.shots?.length ?? 0 } : null };
}

export function createApi(config: ApiConfig): Server {
  if (!config.dataDir || !config.sessionSecret || config.sessionSecret.length < 32) throw new Error("Persistent data directory and session secret are required");
  const maxUploadBytes = config.maxUploadBytes ?? 20_000_000;
  const db = createDb(config.dataDir);
  const temporary = join(config.dataDir, "temporary");
  if (existsSync(temporary)) for (const entry of readdirSync(temporary)) {
    if (!entry.endsWith(".upload")) continue;
    const path = join(temporary, entry);
    try { if (Date.now() - statSync(path).mtimeMs > 3_600_000) rmSync(path, { force: true }); }
    catch { /* A concurrent process may have removed this stale upload. */ }
  }
  const worker = config.klingApiKey ? new GenerationWorker(db, config.dataDir, new KlingGateway(config.klingApiKey, config.klingBaseUrl), config) : null;
  const renderWorker = new RenderWorker(db, config.dataDir, config);
  const ideaWorker = new IdeaAgentWorker(db, config);
  const workerTimer = worker && config.workerEnabled !== false ? setInterval(() => { void worker.tick(); }, 5_000) : null;
  const renderTimer = config.workerEnabled !== false ? setInterval(() => { void renderWorker.tick(); }, 5_000) : null;
  const ideaTimer = config.workerEnabled !== false && (config.ideaAgentApiKey && config.ideaAgentModel || config.ideaCursorApiKey)
    ? setInterval(() => { void ideaWorker.tick(); }, 3_000) : null;
  if (config.workerEnabled !== false) queueMicrotask(() => { void renderWorker.tick(); });
  if (worker && config.workerEnabled !== false) queueMicrotask(() => { void worker.tick(); });
  if (ideaTimer) queueMicrotask(() => { void ideaWorker.tick(); });
  const recentAuthAttempts = new Map<string, { count: number; until: number }>();

  function checkAuthRate(req: IncomingMessage) {
    const key = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = recentAuthAttempts.get(key);
    const next = !current || current.until < now ? { count: 1, until: now + 60_000 } : { count: current.count + 1, until: current.until };
    recentAuthAttempts.set(key, next);
    if (next.count > 20) throw new ApiError(429, "请求过于频繁，请稍后再试");
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      const method = req.method ?? "GET";
      const origin = req.headers.origin;
      if (origin && origin !== config.allowedOrigin) throw new ApiError(403, "来源不允许");
      if (origin && config.allowedOrigin) {
        res.setHeader("access-control-allow-origin", config.allowedOrigin);
        res.setHeader("access-control-allow-credentials", "true");
        res.setHeader("vary", "Origin");
      }
      if (method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
        res.end(); return;
      }
      if (pathname === "/health" && method === "GET") { reply(res, 200, { ok: true }); return; }

      if (pathname === "/auth/register" && method === "POST") {
        checkAuthRate(req);
        const body = await readJson(req);
        let email: string, password: string;
        try { email = normalizeEmail(body.email); password = validatePassword(body.password); }
        catch (error) { throw new ApiError(400, String(error).replace(/^Error: /, "")); }
        const id = randomUUID();
        try {
          db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
            .run(id, email, await hashPassword(password), Date.now(), config.demoQuota ?? 3);
        } catch (error) {
          if (String(error).includes("UNIQUE")) throw new ApiError(409, "邮箱已注册");
          throw error;
        }
        const session = createSession(db, id, config.sessionSecret);
        res.setHeader("set-cookie", `avs_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.secureCookies ? "; Secure" : ""}`);
        reply(res, 201, { account: { id, email }, expiresAt: session.expiresAt }); return;
      }
      if (pathname === "/auth/login" && method === "POST") {
        checkAuthRate(req);
        const body = await readJson(req);
        let email: string;
        try { email = normalizeEmail(body.email); }
        catch (error) { throw new ApiError(400, String(error).replace(/^Error: /, "")); }
        const password = typeof body.password === "string" ? body.password : "";
        const row = db.prepare("SELECT id,password_hash FROM accounts WHERE email=?").get(email) as { id: string; password_hash: string } | undefined;
        if (!row || !await verifyPassword(password, row.password_hash)) throw new ApiError(401, "邮箱或密码错误");
        const session = createSession(db, row.id, config.sessionSecret);
        res.setHeader("set-cookie", `avs_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.secureCookies ? "; Secure" : ""}`);
        reply(res, 200, { account: { id: row.id, email }, expiresAt: session.expiresAt }); return;
      }

      const accountId = sessionAccount(db, req.headers.cookie, config.sessionSecret);
      if (!accountId) throw new ApiError(401, "请先登录");
      if (pathname === "/auth/logout" && method === "POST") {
        clearSession(db, req.headers.cookie, config.sessionSecret);
        res.setHeader("set-cookie", "avs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
        reply(res, 200, { ok: true }); return;
      }
      if (pathname === "/auth/me" && method === "GET") {
        const row = db.prepare("SELECT id,email,demo_quota,demo_reserved,demo_used FROM accounts WHERE id=?").get(accountId);
        reply(res, 200, { account: row }); return;
      }

      if (pathname === "/prompt-ideas" && method === "GET") {
        reply(res, 200, { ideaSets: listPromptIdeas(db, accountId, config.ideaModelTimeoutMs) }); return;
      }
      if (pathname === "/prompt-ideas" && method === "POST") {
        const result = await createPromptIdea(db, accountId, config, await readJson(req));
        reply(res, result.replayed ? 200 : 201, { ideaSet: result.ideaSet }); return;
      }
      const ideaSelection = /^\/prompt-ideas\/([a-zA-Z0-9-]+)\/selection$/.exec(pathname);
      if (ideaSelection && method === "POST") {
        reply(res, 200, { ideaSet: selectPromptIdea(db, accountId, ideaSelection[1], await readJson(req)) }); return;
      }
      const ideaDetail = /^\/prompt-ideas\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (ideaDetail && method === "GET") {
        reply(res, 200, { ideaSet: getPromptIdea(db, accountId, ideaDetail[1], config.ideaModelTimeoutMs) }); return;
      }

      if (pathname === "/video-edits" && method === "POST") {
        reply(res, 201, { edit: await createEdit(db, accountId, await readJson(req)) }); return;
      }
      if (pathname === "/video-edits" && method === "GET") {
        const projectId = url.searchParams.get("projectId") ?? "", shotId = url.searchParams.get("shotId") ?? "";
        reply(res, 200, { edit: findEdit(db, accountId, projectId, shotId) }); return;
      }
      const editMatch = /^\/video-edits\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (editMatch && method === "GET") { reply(res, 200, { edit: getEdit(db, accountId, editMatch[1]) }); return; }
      const editVersions = /^\/video-edits\/([a-zA-Z0-9-]+)\/versions$/.exec(pathname);
      if (editVersions && method === "GET") { reply(res, 200, listEditVersions(db, accountId, editVersions[1])); return; }
      const editCommand = /^\/video-edits\/([a-zA-Z0-9-]+)\/commands$/.exec(pathname);
      if (editCommand && method === "POST") {
        reply(res, 200, { edit: applyEditCommand(db, accountId, editCommand[1], await readJson(req)) }); return;
      }
      const renderMatch = /^\/video-edits\/([a-zA-Z0-9-]+)\/render$/.exec(pathname);
      if (renderMatch && method === "POST") {
        const render = createRender(db, accountId, renderMatch[1], await readJson(req));
        reply(res, 201, { render });
        if (config.workerEnabled !== false) queueMicrotask(() => { void renderWorker.run(render.id); });
        return;
      }
      const renderStatus = /^\/renders\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (renderStatus && method === "GET") { reply(res, 200, { render: renderSnapshot(db, accountId, renderStatus[1]) }); return; }
      const renderEvents = /^\/renders\/([a-zA-Z0-9-]+)\/events$/.exec(pathname);
      if (renderEvents && method === "GET") {
        renderSnapshot(db, accountId, renderEvents[1]);
        const after = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new ApiError(400, "事件序号无效");
        const rows = db.prepare("SELECT seq,state,message,created_at FROM render_events WHERE operation_id=? AND seq>? ORDER BY seq").all(renderEvents[1], after);
        reply(res, 200, { events: rows }); return;
      }

      const projectRuns = /^\/projects\/([a-zA-Z0-9-]+)\/runs$/.exec(pathname);
      if (projectRuns && method === "GET") { reply(res, 200, { runs: listProjectRuns(db, accountId, projectRuns[1]) }); return; }
      if (projectRuns && method === "POST") {
        const run = createRun(db, accountId, projectRuns[1], await readJson(req));
        reply(res, 201, { run }); return;
      }
      const runMatch = /^\/runs\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (runMatch && method === "GET") { reply(res, 200, { run: getRun(db, accountId, runMatch[1]) }); return; }
      const approvalMatch = /^\/runs\/([a-zA-Z0-9-]+)\/approve$/.exec(pathname);
      if (approvalMatch && method === "POST") {
        if (!worker) throw new ApiError(503, "后台生成服务尚未配置");
        const run = approveRun(db, accountId, approvalMatch[1], await readJson(req), config.maxTotalDemoCredits ?? 30);
        reply(res, 200, { run });
        if (config.workerEnabled !== false) queueMicrotask(() => { void worker.run(approvalMatch[1]); });
        return;
      }
      const eventMatch = /^\/runs\/([a-zA-Z0-9-]+)\/events$/.exec(pathname);
      if (eventMatch && method === "GET") {
        const runId = eventMatch[1];
        getRun(db, accountId, runId);
        let after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new ApiError(400, "事件序号无效");
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
        const send = () => {
          for (const event of listRunEvents(db, accountId, runId, after)) {
            res.write(`id: ${event.seq}\nevent: state\ndata: ${JSON.stringify(event)}\n\n`);
            after = event.seq;
          }
        };
        send();
        const timer = setInterval(() => { send(); res.write(": keepalive\n\n"); }, 1000);
        res.on("close", () => clearInterval(timer));
        return;
      }

      if (pathname === "/projects" && method === "GET") {
        const rows = db.prepare("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE owner_id=? ORDER BY updated_at DESC,created_at DESC").all(accountId);
        reply(res, 200, { projects: rows.map(row => projectSummary(row as { id: string; title: string; revision: number; updated_at: number; recent_episode_id: string | null; document_json: string })) }); return;
      }
      if (pathname === "/projects" && method === "POST") {
        const body = await readJson(req);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > 100) throw new ApiError(400, "项目名称无效");
        const id = typeof body.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.id) ? body.id : randomUUID();
        const episodeId = typeof body.initialEpisodeId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.initialEpisodeId) ? body.initialEpisodeId : randomUUID();
        const document = { version: 1, episodes: [{ id: episodeId, title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] };
        try {
          const now = Date.now();
          db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at,updated_at,recent_episode_id) VALUES (?,?,?,?,?,?,?,?)")
            .run(id, accountId, title, 1, JSON.stringify(document), now, now, episodeId);
          db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,?,?,1)")
            .run(id, "episode", episodeId);
        } catch (error) {
          if (String(error).includes("UNIQUE")) throw new ApiError(409, "项目 ID 已存在");
          throw error;
        }
        reply(res, 201, { project: { id, title, revision: 1, document, resourceRevisions: [{ resourceType: "episode", resourceId: episodeId, revision: 1 }] } }); return;
      }
      const projectDsl = /^\/projects\/([a-zA-Z0-9-]+)\/dsl$/.exec(pathname);
      if (projectDsl) {
        if (method !== "GET") throw new ApiError(405, "DSL 投影只读");
        const project = readProjectDsl(db, accountId, projectDsl[1]);
        if (!project) throw new ApiError(404, "项目不存在");
        reply(res, 200, { project, readOnly: true }); return;
      }
      const projectCommand = /^\/projects\/([a-zA-Z0-9-]+)\/commands$/.exec(pathname);
      if (projectCommand && method === "POST") {
        reply(res, 200, applyProjectCommand(db, accountId, projectCommand[1], await readJson(req))); return;
      }
      const projectMatch = /^\/projects\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (projectMatch) {
        const row = db.prepare("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE id=? AND owner_id=?")
          .get(projectMatch[1], accountId) as { id: string; title: string; revision: number; updated_at: number; recent_episode_id: string | null; document_json: string } | undefined;
        if (!row) throw new ApiError(404, "项目不存在");
        if (method === "GET") { reply(res, 200, { project: { ...projectSummary(row), document: JSON.parse(row.document_json), resourceRevisions: listResourceRevisions(db, row.id) } }); return; }
        if (method === "PUT") throw new ApiError(405, "请使用资源命令保存项目");
      }

      if (pathname === "/objects" && method === "POST") {
        const mime = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
        if (!mime || !allowedMime.has(mime)) throw new ApiError(415, "不支持的素材格式");
        const bytes = await readBytes(req, maxUploadBytes);
        if (!bytes.length) throw new ApiError(400, "素材为空");
        await inspectMedia(bytes, mime);
        const staged = join(config.dataDir, "temporary", `${randomUUID()}.upload`);
        await mkdir(join(config.dataDir, "temporary"), { recursive: true });
        let object: ReturnType<typeof storeObject> | undefined;
        try {
          const file = await open(staged, "wx");
          try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
          db.exec("BEGIN IMMEDIATE");
          try {
            object = storeObject(db, config.dataDir, accountId, mime,
              { sourcePath: staged, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }, config);
            db.exec("COMMIT");
          } catch (error) { db.exec("ROLLBACK"); if (object?.createdFilePath) rmSync(object.createdFilePath, { force: true }); throw error; }
        } finally { await rm(staged, { force: true }); }
        reply(res, object.created ? 201 : 200, { object: { id: object.id, mime: object.mime, size: object.size, sha256: object.sha256 } }); return;
      }
      const objectMatch = /^\/objects\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (objectMatch && method === "GET") {
        const row = db.prepare("SELECT mime,size,path FROM objects WHERE id=? AND owner_id=?").get(objectMatch[1], accountId) as { mime: string; size: number; path: string } | undefined;
        if (!row) throw new ApiError(404, "素材不存在");
        res.writeHead(200, { "content-type": row.mime, "content-length": row.size, "cache-control": "private, max-age=60" });
        createReadStream(row.path).pipe(res); return;
      }
      throw new ApiError(404, "接口不存在");
    })().catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof ObjectCapacityError ? error.scope === "account" ? 403 : 503
        : error instanceof ApiError || error instanceof RunError || error instanceof SyncError || error instanceof EditError || error instanceof MediaInspectError || error instanceof PromptIdeasError ? error.status : 500;
      reply(res, status, { error: status === 500 ? "服务器内部错误" : error.message, ...(error instanceof SyncError && error.snapshot ? { conflict: error.snapshot } : {}) });
    });
  });
  server.on("close", () => { if (workerTimer) clearInterval(workerTimer); if (renderTimer) clearInterval(renderTimer); if (ideaTimer) clearInterval(ideaTimer); db.close(); });
  return server;
}
