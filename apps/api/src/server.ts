import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import { ApiContractValidationError, makeApiError, parseApiRequest, parseApiResponse } from "@ai-video/api-contracts";
import type { ApiConfig } from "./config.ts";
import { clearSession, createSession, hashPassword, normalizeEmail, sessionAccount, validatePassword, verifyPassword } from "./auth.ts";
import { createDb } from "./db.ts";
import { approveRun, createRun, getRun, listProjectRuns, listRunEvents, RunError } from "./runs.ts";
import { GenerationWorker } from "./generation-worker.ts";
import { KlingGateway } from "./kling.ts";
import { applyProjectCommand, listResourceRevisions, SyncError } from "./sync.ts";
import { applyEditCommand, createEdit, createRender, EditError, findEdit, getEdit, listEditVersions, renderSnapshot } from "./video-edits.ts";
import { RenderWorker } from "./render-worker.ts";
import { inspectMediaFile, MediaInspectError } from "./media-inspect.ts";
import { storeObject, ObjectCapacityError } from "./object-capacity.ts";
import { readProjectDsl } from "./project-dsl.ts";
import { createPromptIdea, getPromptIdea, listPromptIdeas, PromptIdeasError, selectPromptIdea } from "./prompt-ideas.ts";
import { assertInitialAgentBrief, BriefError, parseCreationBrief } from "./briefs.ts";
import { IdeaAgentWorker } from "./idea-agent-worker.ts";
import { checkRequestSecurity, RequestSecurityError, validateSecurityConfig } from "./request-security.ts";
import { accountRateKey, clientIp, RateLimiter, RateLimitError, validateTrustedProxyIps } from "./rate-limit.ts";
import { stageUpload, UploadError, UploadGate } from "./upload.ts";
import { KlingTtsGateway } from "./kling-tts.ts";
import { createTtsTask, estimateTts, getTtsTask, getTtsTaskByRequest, TtsError, TtsWorker } from "./tts.ts";
import { ttsVoices } from "./tts-voices.ts";
import { createEpisodeRender, EpisodeRenderError, EpisodeRenderWorker, getEpisodeRender } from "./episode-renders.ts";
import { AgentEditError, AgentEditWorker, confirmAgentEdit, createAgentEdit, getAgentEdit, getAgentEditByRequest } from "./agent-edit.ts";
import { createEpisodePreview, createShotPreview, getPreview, PreviewError, PreviewWorker } from "./previews.ts";

class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4"]);

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
  if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "请求必须使用 application/json");
  }
  const bytes = await readBytes(req, 1_000_000);
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parseApiRequest(req.method ?? "GET", new URL(req.url ?? "/", "http://localhost").pathname, parsed);
  } catch (error) {
    if (error instanceof ApiContractValidationError) throw error;
    throw new ApiError(400, "请求 JSON 无效");
  }
}

function reply(res: ServerResponse, status: number, payload: unknown) {
  parseApiResponse(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function projectSummary(row: { id: string; title: string; revision: number; updated_at: number; recent_episode_id: string | null; document_json: string }) {
  const document = JSON.parse(row.document_json) as { episodes?: { id: string; title: string; shots?: unknown[] }[] };
  const recent = document.episodes?.find(item => item.id === row.recent_episode_id) ?? document.episodes?.[0];
  return { id: row.id, title: row.title, revision: row.revision, updatedAt: row.updated_at,
    recentEpisode: recent ? { id: recent.id, title: recent.title, shotCount: recent.shots?.length ?? 0 } : null };
}

export async function createApi(config: ApiConfig): Promise<Server> {
  if (!config.dataDir || !config.sessionSecret || config.sessionSecret.length < 32) throw new Error("Persistent data directory and session secret are required");
  validateSecurityConfig(config);
  validateTrustedProxyIps(config.trustedProxyIps ?? []);
  const maxUploadBytes = config.maxUploadBytes ?? 20_000_000;
  const uploadGate = new UploadGate(config.maxConcurrentUploads ?? 3);
  const db = await createDb(config.databaseUrl);
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
  const ttsWorker = config.klingTtsApiKey ? new TtsWorker(db, config.dataDir,
    new KlingTtsGateway(config.klingTtsApiKey, config.klingTtsBaseUrl), config) : null;
  const episodeWorker = new EpisodeRenderWorker(db, config.dataDir, config);
  const agentEditWorker = new AgentEditWorker(db, config);
  const previewWorker = new PreviewWorker(db, config.dataDir, config);
  const tick = (kind: string, task: Promise<void>) => { void task.catch(error => {
    process.stderr.write(`${kind} worker tick failed (${(error as { code?: string } | null)?.code ?? "unknown"})\n`);
  }); };
  const workerTimer = worker && config.workerEnabled !== false ? setInterval(() => { tick("generation", worker.tick()); }, 5_000) : null;
  const renderTimer = config.workerEnabled !== false ? setInterval(() => { tick("render", renderWorker.tick()); }, 5_000) : null;
  const ideaTimer = config.workerEnabled !== false && (config.ideaAgentApiKey && config.ideaAgentModel || config.ideaCursorApiKey)
    ? setInterval(() => { tick("ideas", ideaWorker.tick()); }, 3_000) : null;
  const ttsTimer = ttsWorker && config.workerEnabled !== false ? setInterval(() => { tick("tts", ttsWorker!.tick()); }, 5_000) : null;
  const episodeTimer = config.workerEnabled !== false ? setInterval(() => { tick("episode-render", episodeWorker.tick()); }, 5_000) : null;
  const agentEditTimer = config.workerEnabled !== false ? setInterval(() => { tick("agent-edit", agentEditWorker.tick()); }, 5_000) : null;
  const previewTimer = config.workerEnabled !== false ? setInterval(() => { tick("preview", previewWorker.tick()); }, 5_000) : null;
  if (config.workerEnabled !== false) queueMicrotask(() => { tick("render", renderWorker.tick()); });
  if (worker && config.workerEnabled !== false) queueMicrotask(() => { tick("generation", worker.tick()); });
  if (ideaTimer) queueMicrotask(() => { tick("ideas", ideaWorker.tick()); });
  if (ttsTimer) queueMicrotask(() => { tick("tts", ttsWorker!.tick()); });
  if (episodeTimer) queueMicrotask(() => { tick("episode-render", episodeWorker.tick()); });
  if (agentEditTimer) queueMicrotask(() => { tick("agent-edit", agentEditWorker.tick()); });
  if (previewTimer) queueMicrotask(() => { tick("preview", previewWorker.tick()); });
  const rate = new RateLimiter();
  function checkAuthRate(req: IncomingMessage, email: string, kind: "login" | "register") {
    rate.check(`auth-ip:${kind}:${clientIp(req, config.trustedProxyIps)}`, 200);
    rate.check(`auth-account:${kind}:${accountRateKey(email)}`, kind === "login" ? config.authLoginAccountLimit ?? 10 : 5);
  }
  function checkCostRate(req: IncomingMessage, accountId: string, kind: "upload" | "idea" | "render" | "approval" | "tts") {
    rate.check(`cost-ip:${kind}:${clientIp(req, config.trustedProxyIps)}`, 200);
    rate.check(`cost-account:${kind}:${accountId}`, kind === "upload" ? 12 : 10);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      const method = req.method ?? "GET";
      if (checkRequestSecurity(req, res, config)) return;
      if (pathname === "/health" && method === "GET") { reply(res, 200, { ok: true }); return; }

      if (pathname === "/auth/register" && method === "POST") {
        const body = await readJson(req);
        let email: string, password: string;
        try { email = normalizeEmail(body.email); password = validatePassword(body.password); }
        catch (error) { throw new ApiError(400, String(error).replace(/^Error: /, "")); }
        checkAuthRate(req, email, "register");
        const id = randomUUID();
        try {
          (await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
            .run(id, email, await hashPassword(password), Date.now(), config.demoQuota ?? 3));
        } catch (error) {
          if ((error as { code?: string }).code === "23505") throw new ApiError(409, "邮箱已注册");
          throw error;
        }
        const session = (await createSession(db, id, config.sessionSecret));
        res.setHeader("set-cookie", `avs_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.secureCookies ? "; Secure" : ""}`);
        reply(res, 201, { account: { id, email }, expiresAt: session.expiresAt }); return;
      }
      if (pathname === "/auth/login" && method === "POST") {
        const body = await readJson(req);
        let email: string;
        try { email = normalizeEmail(body.email); }
        catch (error) { throw new ApiError(400, String(error).replace(/^Error: /, "")); }
        checkAuthRate(req, email, "login");
        const password = typeof body.password === "string" ? body.password : "";
        const row = (await db.prepare("SELECT id,password_hash FROM accounts WHERE email=?").get(email)) as { id: string; password_hash: string } | undefined;
        if (!row || !await verifyPassword(password, row.password_hash)) throw new ApiError(401, "邮箱或密码错误");
        const session = (await createSession(db, row.id, config.sessionSecret));
        res.setHeader("set-cookie", `avs_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.secureCookies ? "; Secure" : ""}`);
        reply(res, 200, { account: { id: row.id, email }, expiresAt: session.expiresAt }); return;
      }

      const accountId = (await sessionAccount(db, req.headers.cookie, config.sessionSecret));
      if (!accountId) throw new ApiError(401, "请先登录");
      if (pathname === "/auth/logout" && method === "POST") {
        (await clearSession(db, req.headers.cookie, config.sessionSecret));
        res.setHeader("set-cookie", "avs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
        reply(res, 200, { ok: true }); return;
      }
      if (pathname === "/auth/me" && method === "GET") {
        const row = (await db.prepare("SELECT id,email,demo_quota,demo_reserved,demo_used FROM accounts WHERE id=?").get(accountId));
        reply(res, 200, { account: row }); return;
      }

      const ttsEstimate = /^\/projects\/([a-zA-Z0-9-]+)\/tts\/estimate$/.exec(pathname);
      if (pathname === "/tts/voices" && method === "GET") { reply(res, 200, { voices: ttsWorker ? ttsVoices(config) : [] }); return; }
      if (ttsEstimate && method === "POST") {
        reply(res, 200, { ttsEstimate: await estimateTts(db, accountId, ttsEstimate[1], config, await readJson(req)) }); return;
      }
      const ttsCreate = /^\/projects\/([a-zA-Z0-9-]+)\/tts\/tasks$/.exec(pathname);
      if (ttsCreate && method === "POST") {
        checkCostRate(req, accountId, "tts");
        if (!ttsWorker) throw new TtsError(503, "可灵配音服务尚未配置");
        const result = await createTtsTask(db, accountId, ttsCreate[1], config, await readJson(req));
        reply(res, result.replayed ? 200 : 201, { ttsTask: result.task });
        if (config.workerEnabled !== false) queueMicrotask(() => { tick("tts", ttsWorker.run(result.task.id)); });
        return;
      }
      const ttsByRequest = /^\/projects\/([a-zA-Z0-9-]+)\/tts\/tasks\/by-request\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (ttsByRequest && method === "GET") {
        reply(res, 200, { ttsTask: await getTtsTaskByRequest(db, accountId, ttsByRequest[1], ttsByRequest[2]) }); return;
      }
      const ttsDetail = /^\/tts\/tasks\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (ttsDetail && method === "GET") { reply(res, 200, { ttsTask: await getTtsTask(db, accountId, ttsDetail[1]) }); return; }
      const episodeRenderCreate = /^\/projects\/([a-zA-Z0-9-]+)\/episodes\/([a-zA-Z0-9-]+)\/render$/.exec(pathname);
      if (episodeRenderCreate && method === "POST") {
        checkCostRate(req, accountId, "render");
        const result = await createEpisodeRender(db, accountId, episodeRenderCreate[1], episodeRenderCreate[2], await readJson(req));
        reply(res, result.replayed ? 200 : 201, { episodeRender: result.render });
        if (config.workerEnabled !== false) queueMicrotask(() => { tick("episode-render", episodeWorker.run(result.render.id)); });
        return;
      }
      const episodeRenderDetail = /^\/episode-renders\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (episodeRenderDetail && method === "GET") {
        reply(res, 200, { episodeRender: await getEpisodeRender(db, accountId, episodeRenderDetail[1]) }); return;
      }
      const episodePreviewCreate = /^\/projects\/([a-zA-Z0-9-]+)\/episodes\/([a-zA-Z0-9-]+)\/previews$/.exec(pathname);
      if (episodePreviewCreate && method === "POST") {
        checkCostRate(req, accountId, "render");
        const result = await createEpisodePreview(db, accountId, episodePreviewCreate[1], episodePreviewCreate[2], await readJson(req));
        reply(res, result.replayed ? 200 : 201, { preview: result.preview });
        if (config.workerEnabled !== false) queueMicrotask(() => { tick("preview", previewWorker.run(result.preview.id)); });
        return;
      }
      const previewDetail = /^\/previews\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (previewDetail && method === "GET") { reply(res, 200, { preview: await getPreview(db, accountId, previewDetail[1]) }); return; }
      const agentEditCreate = /^\/projects\/([a-zA-Z0-9-]+)\/agent-edits$/.exec(pathname);
      if (agentEditCreate && method === "POST") {
        checkCostRate(req, accountId, "idea");
        const result = await createAgentEdit(db, accountId, agentEditCreate[1], config, await readJson(req));
        reply(res, result.replayed ? 200 : 201, { agentEdit: result.set });
        if (config.workerEnabled !== false) queueMicrotask(() => { tick("agent-edit", agentEditWorker.run(result.set.id)); });
        return;
      }
      const agentEditByRequest = /^\/projects\/([a-zA-Z0-9-]+)\/agent-edits\/by-request\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (agentEditByRequest && method === "GET") {
        reply(res, 200, { agentEdit: await getAgentEditByRequest(db, accountId, agentEditByRequest[1], agentEditByRequest[2]) }); return;
      }
      const agentEditDetail = /^\/agent-edits\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (agentEditDetail && method === "GET") { reply(res, 200, { agentEdit: await getAgentEdit(db, accountId, agentEditDetail[1]) }); return; }
      const agentEditConfirm = /^\/agent-edits\/([a-zA-Z0-9-]+)\/confirm$/.exec(pathname);
      if (agentEditConfirm && method === "POST") {
        reply(res, 200, { agentEdit: await confirmAgentEdit(db, accountId, agentEditConfirm[1], await readJson(req)) }); return;
      }

      if (pathname === "/prompt-ideas" && method === "GET") {
        reply(res, 200, { ideaSets: (await listPromptIdeas(db, accountId, config.ideaModelTimeoutMs)) }); return;
      }
      if (pathname === "/prompt-ideas" && method === "POST") {
        checkCostRate(req, accountId, "idea");
        const result = await createPromptIdea(db, accountId, config, await readJson(req));
        reply(res, result.replayed ? 200 : 201, { ideaSet: result.ideaSet }); return;
      }
      const ideaSelection = /^\/prompt-ideas\/([a-zA-Z0-9-]+)\/selection$/.exec(pathname);
      if (ideaSelection && method === "POST") {
        reply(res, 200, { ideaSet: (await selectPromptIdea(db, accountId, ideaSelection[1], await readJson(req))) }); return;
      }
      const ideaDetail = /^\/prompt-ideas\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (ideaDetail && method === "GET") {
        reply(res, 200, { ideaSet: (await getPromptIdea(db, accountId, ideaDetail[1], config.ideaModelTimeoutMs)) }); return;
      }

      if (pathname === "/video-edits" && method === "POST") {
        reply(res, 201, { edit: await createEdit(db, accountId, await readJson(req)) }); return;
      }
      if (pathname === "/video-edits" && method === "GET") {
        const projectId = url.searchParams.get("projectId") ?? "", shotId = url.searchParams.get("shotId") ?? "";
        reply(res, 200, { edit: (await findEdit(db, accountId, projectId, shotId)) }); return;
      }
      const editMatch = /^\/video-edits\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (editMatch && method === "GET") { reply(res, 200, { edit: (await getEdit(db, accountId, editMatch[1])) }); return; }
      const editVersions = /^\/video-edits\/([a-zA-Z0-9-]+)\/versions$/.exec(pathname);
      if (editVersions && method === "GET") { reply(res, 200, (await listEditVersions(db, accountId, editVersions[1]))); return; }
      const editCommand = /^\/video-edits\/([a-zA-Z0-9-]+)\/commands$/.exec(pathname);
      if (editCommand && method === "POST") {
        reply(res, 200, { edit: (await applyEditCommand(db, accountId, editCommand[1], await readJson(req))) }); return;
      }
      const shotPreviewCreate = /^\/video-edits\/([a-zA-Z0-9-]+)\/previews$/.exec(pathname);
      if (shotPreviewCreate && method === "POST") {
        checkCostRate(req, accountId, "render");
        const result = await createShotPreview(db, accountId, shotPreviewCreate[1], await readJson(req));
        reply(res, result.replayed ? 200 : 201, { preview: result.preview });
        if (config.workerEnabled !== false) queueMicrotask(() => { tick("preview", previewWorker.run(result.preview.id)); });
        return;
      }
      const renderMatch = /^\/video-edits\/([a-zA-Z0-9-]+)\/render$/.exec(pathname);
      if (renderMatch && method === "POST") {
        checkCostRate(req, accountId, "render");
        const render = (await createRender(db, accountId, renderMatch[1], await readJson(req)));
        reply(res, 201, { render });
        if (config.workerEnabled !== false) queueMicrotask(() => { void renderWorker.run(render.id); });
        return;
      }
      const renderStatus = /^\/renders\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (renderStatus && method === "GET") { reply(res, 200, { render: (await renderSnapshot(db, accountId, renderStatus[1])) }); return; }
      const renderEvents = /^\/renders\/([a-zA-Z0-9-]+)\/events$/.exec(pathname);
      if (renderEvents && method === "GET") {
        (await renderSnapshot(db, accountId, renderEvents[1]));
        const after = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new ApiError(400, "事件序号无效");
        const rows = (await db.prepare("SELECT seq,state,message,created_at FROM render_events WHERE operation_id=? AND seq>? ORDER BY seq").all(renderEvents[1], after));
        reply(res, 200, { events: rows }); return;
      }

      const projectRuns = /^\/projects\/([a-zA-Z0-9-]+)\/runs$/.exec(pathname);
      if (projectRuns && method === "GET") { reply(res, 200, { runs: (await listProjectRuns(db, accountId, projectRuns[1])) }); return; }
      if (projectRuns && method === "POST") {
        const run = (await createRun(db, accountId, projectRuns[1], await readJson(req)));
        reply(res, 201, { run }); return;
      }
      const runMatch = /^\/runs\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (runMatch && method === "GET") { reply(res, 200, { run: (await getRun(db, accountId, runMatch[1])) }); return; }
      const approvalMatch = /^\/runs\/([a-zA-Z0-9-]+)\/approve$/.exec(pathname);
      if (approvalMatch && method === "POST") {
        checkCostRate(req, accountId, "approval");
        if (!worker) throw new ApiError(503, "后台生成服务尚未配置");
        const run = (await approveRun(db, accountId, approvalMatch[1], await readJson(req), config.maxTotalDemoCredits ?? 30));
        reply(res, 200, { run });
        if (config.workerEnabled !== false) queueMicrotask(() => { void worker.run(approvalMatch[1]); });
        return;
      }
      const eventMatch = /^\/runs\/([a-zA-Z0-9-]+)\/events$/.exec(pathname);
      if (eventMatch && method === "GET") {
        const runId = eventMatch[1];
        (await getRun(db, accountId, runId));
        let after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new ApiError(400, "事件序号无效");
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
        const send = async () => {
          for (const event of (await listRunEvents(db, accountId, runId, after))) {
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
        const rows = (await db.prepare("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE owner_id=? ORDER BY updated_at DESC,created_at DESC").all(accountId));
        reply(res, 200, { projects: rows.map(row => projectSummary(row as { id: string; title: string; revision: number; updated_at: number; recent_episode_id: string | null; document_json: string })) }); return;
      }
      if (pathname === "/projects" && method === "POST") {
        const body = await readJson(req);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || Array.from(title).length > 50 || title === "." || title === ".." || /[/\\]/.test(title)) throw new ApiError(400, "项目名称无效");
        const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
        if (body.id !== undefined && !validId(body.id)) throw new ApiError(400, "项目 ID 无效");
        if (body.initialEpisodeId !== undefined && !validId(body.initialEpisodeId)) throw new ApiError(400, "分集 ID 无效");
        const id = body.id as string | undefined ?? randomUUID();
        const episodeId = body.initialEpisodeId as string | undefined ?? randomUUID();
        const brief = body.initialBrief === undefined ? undefined : parseCreationBrief(body.initialBrief);
        const creationHash = createHash("sha256").update(JSON.stringify({ id, title,
          initialEpisodeId: body.initialEpisodeId ?? null, initialBrief: brief ?? null })).digest("hex");
        const document = { version: 1, episodes: [{ id: episodeId, title: "第 1 集", shots: [], timeline: [] }],
          assets: [], characters: [], briefs: brief ? [brief] : [] };
        let replayed = false;
        await db.transaction(async () => {
        try {
          await db.lock(`project-create:${id}`);
          const existing = (await db.prepare("SELECT owner_id,creation_hash FROM projects WHERE id=?").get(id)) as {
            owner_id: string; creation_hash: string | null;
          } | undefined;
          if (existing) {
            if (existing.owner_id !== accountId || existing.creation_hash !== creationHash) throw new ApiError(409, "项目 ID 已用于其他创建内容");
            replayed = true;
          } else {
            if (brief) (await assertInitialAgentBrief(db, accountId, brief));
            const now = Date.now();
            (await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at,updated_at,recent_episode_id,creation_hash) VALUES (?,?,?,?,?,?,?,?,?)")
              .run(id, accountId, title, 1, JSON.stringify(document), now, now, episodeId, creationHash));
            (await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,?,?,1)")
              .run(id, "episode", episodeId));
            if (brief) (await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,?,?,1)")
              .run(id, "brief", brief.id));
          }

        } catch (error) {

          throw error;
        }
});
        const row = (await db.prepare("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE id=? AND owner_id=?")
          .get(id, accountId)) as { id: string; title: string; revision: number; updated_at: number;
            recent_episode_id: string | null; document_json: string };
        reply(res, replayed ? 200 : 201, { project: { ...projectSummary(row),
          document: JSON.parse(row.document_json), resourceRevisions: (await listResourceRevisions(db, id)) } }); return;
      }
      const projectDsl = /^\/projects\/([a-zA-Z0-9-]+)\/dsl$/.exec(pathname);
      if (projectDsl) {
        if (method !== "GET") throw new ApiError(405, "DSL 投影只读");
        const project = (await readProjectDsl(db, accountId, projectDsl[1]));
        if (!project) throw new ApiError(404, "项目不存在");
        reply(res, 200, { project, readOnly: true }); return;
      }
      const projectCommand = /^\/projects\/([a-zA-Z0-9-]+)\/commands$/.exec(pathname);
      if (projectCommand && method === "POST") {
        reply(res, 200, (await applyProjectCommand(db, accountId, projectCommand[1], await readJson(req)))); return;
      }
      const projectMatch = /^\/projects\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (projectMatch) {
        const row = (await db.prepare("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE id=? AND owner_id=?")
          .get(projectMatch[1], accountId)) as { id: string; title: string; revision: number; updated_at: number; recent_episode_id: string | null; document_json: string } | undefined;
        if (!row) throw new ApiError(404, "项目不存在");
        if (method === "GET") { reply(res, 200, { project: { ...projectSummary(row), document: JSON.parse(row.document_json), resourceRevisions: (await listResourceRevisions(db, row.id)) } }); return; }
        if (method === "PUT") throw new ApiError(405, "请使用资源命令保存项目");
      }

      if (pathname === "/objects" && method === "POST") {
        checkCostRate(req, accountId, "upload");
        const mime = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
        if (!mime || !allowedMime.has(mime)) throw new ApiError(415, "不支持的素材格式");
        const release = uploadGate.acquire();
        let staged: string | undefined;
        let object: Awaited<ReturnType<typeof storeObject>> | undefined;
        let durationMs: number | undefined;
        try {
          const upload = await stageUpload(req, config.dataDir, maxUploadBytes, config.uploadTimeoutMs);
          staged = upload.path;
          ({ durationMs } = await inspectMediaFile(staged, mime));
          await db.transaction(async () => {
          try {
            object = (await storeObject(db, config.dataDir, accountId, mime,
              { sourcePath: staged!, sha256: upload.sha256, size: upload.size }, config));

          } catch (error) {  if (object?.createdFilePath) rmSync(object.createdFilePath, { force: true }); throw error; }
});
        } catch (error) {
          if (object?.createdFilePath) rmSync(object.createdFilePath, { force: true });
          throw error;
        } finally { if (staged) await rm(staged, { force: true }); release(); }
        if (!object) throw new Error("素材保存未完成");
        reply(res, object.created ? 201 : 200, { object: { id: object.id, mime: object.mime, size: object.size, sha256: object.sha256,
          ...(durationMs === undefined ? {} : { durationMs }) } }); return;
      }
      const objectMatch = /^\/objects\/([a-zA-Z0-9-]+)$/.exec(pathname);
      if (objectMatch && method === "GET") {
        const row = (await db.prepare("SELECT mime,size,path FROM objects WHERE id=? AND owner_id=?").get(objectMatch[1], accountId)) as { mime: string; size: number; path: string } | undefined;
        if (!row) throw new ApiError(404, "素材不存在");
        const suffix = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4",
          "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a" }[row.mime] ?? "bin";
        res.writeHead(200, { "content-type": row.mime, "content-length": row.size, "cache-control": "private, max-age=60",
          "content-disposition": `inline; filename="asset-${objectMatch[1]}.${suffix}"`, "x-content-type-options": "nosniff" });
        createReadStream(row.path).pipe(res); return;
      }
      throw new ApiError(404, "接口不存在");
    })().catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof RateLimitError || error instanceof UploadError && error.retryAfterSeconds) {
        res.setHeader("retry-after", String(error.retryAfterSeconds));
      }
      const status = error instanceof ObjectCapacityError ? error.scope === "account" ? 403 : 503
        : error instanceof ApiError || error instanceof UploadError || error instanceof RateLimitError || error instanceof RequestSecurityError || error instanceof ApiContractValidationError || error instanceof RunError || error instanceof SyncError || error instanceof EditError || error instanceof MediaInspectError || error instanceof PromptIdeasError || error instanceof BriefError || error instanceof TtsError || error instanceof EpisodeRenderError || error instanceof AgentEditError || error instanceof PreviewError ? error.status : 500;
      reply(res, status, makeApiError(status, status === 500 ? "服务器内部错误" : error.message,
        error instanceof SyncError && error.snapshot ? error.snapshot : undefined,
        error instanceof TtsError ? error.code : error instanceof ObjectCapacityError && error.scope === "account" ? "quota_exceeded" : undefined));
    });
  });
  server.on("close", () => { if (workerTimer) clearInterval(workerTimer); if (renderTimer) clearInterval(renderTimer); if (ideaTimer) clearInterval(ideaTimer); if (ttsTimer) clearInterval(ttsTimer); if (episodeTimer) clearInterval(episodeTimer); if (agentEditTimer) clearInterval(agentEditTimer); if (previewTimer) clearInterval(previewTimer); void db.close().catch(() => {}); });
  return server;
}
