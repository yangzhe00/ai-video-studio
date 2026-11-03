# Python Cloud API Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Python 接管 AI Video Studio 云端 Node.js API 和后台任务，同时保持 Web、Tauri 桌面、Expo 移动端以及现有 PostgreSQL 数据和登录会话兼容。

**Architecture:** 在 `apps/api-python` 平行实现 FastAPI HTTP 层和独立 worker；现有 PostgreSQL schema 4、对象目录与客户端协议保持权威。先用恢复库和黄金样例验证各领域，再在单一维护窗口停止 Node 领取任务并切换 API；不进行双写或双付费执行。

**Tech Stack:** Python 3.13、FastAPI/Pydantic、Psycopg 3 异步连接池、redis-py、pytest、uv 锁定依赖、现有 PostgreSQL 17、Redis、FFmpeg/ffprobe、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-11-03-python-cloud-api-replacement-design.md`

## Global Constraints

- 用户已批准 Python 全量接管云端后端；Redis 第一阶段用于跨实例限流与短期缓存，PostgreSQL 继续承担持久任务。
- 执行前冻结一个提交和工作树快照；当前主工作区有并行未提交的 v3/TTS 等改动，不能以本计划编写时的 HEAD 作为最终协议基线。
- 替换范围仅是 `apps/api` 云端服务；Tauri/Rust 本地能力和三个客户端继续存在。
- 保留现有 `/api` 路由、JSON 错误包、Cookie、SSE、上传、单区间 HTTP Range、毫秒时间戳、命令 ID、任务 ID 与对象 ID；不得顺带引入 JWT。
- PostgreSQL schema 4 与 `API_DATA_DIR` 是既有数据源。API 启动只校验版本，DDL 只由独立迁移命令执行。迁移不得重建或清空生产数据。
- Node 和 Python 的付费 worker 不能同时领取相同任务；未知供应商提交状态不得自动重发 POST。
- Redis 只服务限流和可重建的短期缓存；会话、业务额度、幂等键、任务状态和队列租约留在 PostgreSQL。Redis 不公开端口，受限环境文件注入凭据。
- 真实付费接口只在受控人工联调中调用；自动化测试使用模拟供应商和隔离的数据库/文件目录。

## Review Focus

1. 旧 `avs_session` Cookie 与旧 scrypt 哈希：Task 3 的跨语言登录测试必须保持会话连续，并验证登出撤销。
2. 请求来源、预检和 `X-AVS-Request`：Task 3 的安全测试必须验证非法 Origin、跨站请求和缺标识均为原有拒绝语义。
3. 重复审批、响应丢失与 worker 重启：Task 6 的并发测试必须证明只有一个付费提交，`unknown` 状态先查询不重发。
4. 旧项目及整集 v3、对象 Range 和断线 SSE：Tasks 4、5、6 的对照测试必须验证数据/媒体/事件可继续读取。
5. Redis 中断或达到内存上限：Task 2A 的测试必须证明付费/认证入口明确停止新请求、只读缓存旁路原始来源；Task 9 验证容器不公开端口。
6. 切流后新写入与回退：Task 9 的恢复演练必须证明可读兼容时停写切回；否则维持维护状态并对账。

## File Map

| 位置 | 责任 |
| --- | --- |
| `docs/architecture/python-api-route-matrix.md` | 冻结时的路由、状态码、Cookie、SSE、媒体和 worker 行为清单 |
| `contracts/fixtures/python-replacement/` | 匿名化请求、响应和数据状态黄金样例；Node/Python 双端对照 |
| `apps/api-python/pyproject.toml`、`uv.lock` | Python 版本范围、运行/测试依赖与精确锁定 |
| `apps/api-python/src/ai_video_api/main.py`、`settings.py`、`errors.py` | FastAPI 生命周期、配置和原错误包映射 |
| `apps/api-python/src/ai_video_api/db.py`、`migrate.py` | PostgreSQL 连接、事务、锁、schema 检查与独立迁移 |
| `apps/api-python/src/ai_video_api/limits.py`、`cache.py` | Redis 原子限流与可重建的短期缓存；故障显式处理 |
| `apps/api-python/src/ai_video_api/auth.py`、`security.py` | 旧密码/会话兼容、Cookie、Origin 和请求标识 |
| `apps/api-python/src/ai_video_api/projects.py`、`objects.py` | 项目/资源命令、上传/额度、媒体读取 |
| `apps/api-python/src/ai_video_api/tasks/` | 生成、灵感、Agent 编辑、TTS、预览和渲染的持久任务与 worker |
| `apps/api-python/src/ai_video_api/media.py` | FFmpeg/ffprobe 进程与临时文件生命周期 |
| `apps/api-python/tests/` | 合同、数据库、并发、媒体和路由测试 |
| `deploy/docker/Dockerfile.api-python`、`deploy/docker/compose.python.yaml` | Python 镜像、Redis 内部服务、隔离预发与最终单服务切流配置 |

## Tasks

### Task 1: 冻结基线和协议清单

**Files:** Create `docs/architecture/python-api-route-matrix.md`, `contracts/fixtures/python-replacement/manifest.json`, `scripts/capture-api-contract-fixtures.mjs`; inspect `apps/api/src/server.ts`, `packages/api-contracts/src`, `packages/project-schema/src`, `deploy/docker/compose.yaml`.

**Interfaces:** Produces `manifest.json` entries `{id, method, path, expectedStatus, responseKind, fixture}` and an immutable baseline commit/schema version consumed by every later task. Fixture generator uses existing Zod validation and synthetic data, never production secrets.

- [ ] Write a route matrix covering every `server.ts` route, including auth, projects, objects, runs/events, ideas, TTS, Agent edits, preview/render, errors and health; record v3/TTS candidate status at the frozen commit.
- [ ] Add golden requests/responses for success and failure, plus cookie/header/SSE/Range byte fixtures; assert each manifest entry has a fixture or an explicit non-JSON contract test.
- [ ] Run `pnpm --filter @ai-video/api test` and `pnpm --filter @ai-video/api-contracts test` on the frozen commit; save test output and `git rev-parse HEAD` in the matrix.
- [ ] Commit only the matrix, generator and anonymous fixtures after checking no personal data or keys are present.

### Task 2: Python service skeleton and database adapter

**Files:** Create `apps/api-python/pyproject.toml`, `uv.lock`, `src/ai_video_api/{main,settings,errors,db}.py`, `tests/test_health_db.py`; modify `package.json` only to add optional Python verification commands once runnable.

**Interfaces:** `create_app() -> FastAPI`; `Settings.from_env()`; `Database.open/close`, `fetch_one`, `fetch_all`, `execute`, `transaction()` and `advisory_lock(key)`; `/health` returns current `{ "ok": true }` only when service is ready. SQL uses Psycopg `%s` parameters; transactions hold one connection.

- [ ] Write failing tests for missing `DATABASE_URL`/`API_DATA_DIR`/short `API_SESSION_SECRET`, schema 4 read-only startup, unsupported schema refusal, transaction rollback and concurrent advisory lock.
- [ ] Implement settings, error envelope, FastAPI lifespan and Psycopg pool; keep DDL out of `create_app()`.
- [ ] Run `uv run --project apps/api-python pytest apps/api-python/tests/test_health_db.py -q`; expect all tests pass against isolated PostgreSQL.
- [ ] Run formatting/type checks configured in `pyproject.toml` and commit Python skeleton with locked dependencies.

### Task 2A: Redis 跨实例限流与短期缓存

**Files:** Create `apps/api-python/src/ai_video_api/{limits,cache}.py`, `apps/api-python/tests/{test_limits,test_cache}.py`; compare `apps/api/src/rate-limit.ts` and current route thresholds.

**Interfaces:** `RedisRateLimiter.check(key: str, limit: int, window_ms: int = 60000) -> None` uses one atomic increment-plus-expiry operation; `ShortCache.get_or_load(key: str, ttl_seconds: int, load: Callable[[], Awaitable[T]]) -> T` never caches secrets, sessions, mutable projects or task states. Both use `REDIS_URL` only inside the server. Limit keys hash account/email material and have bounded TTL.

- [ ] Write failing tests with isolated Redis for two limiter instances sharing one bucket, first-key TTL, exact limit and retry delay, expiry, Redis unavailable, and maxmemory/no-write error. Protected auth and cost routes must return explicit temporary errors on Redis failure; read cache must call the loader.
- [ ] Implement the atomic limiter (Lua script or equivalent single atomic command) and short cache. Use Node route thresholds as frozen baseline. Add a verified short TTL only for the TTS voice directory after its provider contract is stable.
- [ ] Run `uv run --project apps/api-python pytest apps/api-python/tests/test_limits.py apps/api-python/tests/test_cache.py -q` against isolated Redis; commit independently.

### Task 3: 旧账号、会话与请求安全兼容

**Files:** Create `apps/api-python/src/ai_video_api/{auth,security}.py`, `tests/{test_auth,test_security}.py`; compare `apps/api/src/{auth,request-security,server}.ts`.

**Interfaces:** `verify_legacy_password(password, stored_hash) -> bool`; `resolve_session(cookie_header, secret, db) -> account_id | None`; auth routes remain `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout` with the same cookie attributes and error envelopes.

- [ ] Write failing cross-language tests: Node 生成的 scrypt 哈希能由 Python 验证；Node 发的旧 Cookie 可访问 Python `/auth/me`；Python 登出后 Node/Python 都拒绝；旧会话摘要保持一致。
- [ ] Write failing security tests for wrong Origin, `Sec-Fetch-Site: cross-site`, invalid OPTIONS, missing `X-AVS-Request`, wrong password, session expiry and account isolation.
- [ ] Implement only existing session semantics, strict origin/header checks, constant-time comparison and matched JSON errors; do not generate JWT.
- [ ] Run `uv run --project apps/api-python pytest apps/api-python/tests/test_auth.py apps/api-python/tests/test_security.py -q` and Node auth/security suites; commit.

### Task 4: 项目读取、同步与资源命令

**Files:** Create `apps/api-python/src/ai_video_api/projects.py`, `tests/{test_projects,test_project_concurrency}.py`; compare `apps/api/src/{sync,cloud-document,project-dsl}.ts` and `packages/project-schema/src`.

**Interfaces:** Existing `/projects`, `/projects/:id` and resource-command routes; same `baseRevision`, `commandId`, conflict snapshot and v2/v3 episode audio/visual projection. Python writes the current `document_json` shape and increments resource revisions exactly once.

- [ ] Write failing golden tests for old project JSON, v3 timeline GET, same-command replay, stale revision 409, cross-account denial, malformed asset references and locked/overflow audio conflict IDs.
- [ ] Write a two-connection concurrency test: same resource/command cannot produce two writes or lost revision.
- [ ] Port document upgrade/projection and command transaction logic; preserve integer milliseconds and omitted-versus-null fields.
- [ ] Run focused Python tests plus `pnpm --filter @ai-video/project-schema test` and `pnpm --filter @ai-video/project-core test`; compare normalized Node/Python output; commit.

### Task 5: 媒体对象、上传与播放

**Files:** Create `apps/api-python/src/ai_video_api/objects.py`, `tests/{test_objects,test_media_range}.py`; compare `apps/api/src/{upload,object-capacity,media-range,media-inspect}.ts`.

**Interfaces:** Existing object/upload routes; object ID/path and owner scope unchanged. A single byte range returns 206 with exact `Content-Range`/`Content-Length`, invalid range 416, full object 200; upload uses bounded streaming and atomic object registration.

- [ ] Write failing tests for mime/size/time limits, duplicate content quota, hash mismatch, temp-file rollback, cross-owner access, 200/206/416 and range start/end bytes.
- [ ] Port streaming upload, capacity transaction, ffprobe metadata and media response without loading full videos into RAM.
- [ ] Run focused Python object/media tests with generated MP4/WAV and the existing Node upload/range suites; commit.

### Task 6: 生成任务、付费操作、事件与 worker 恢复

**Files:** Create `apps/api-python/src/ai_video_api/tasks/{runs,events,worker,kling}.py`, `tests/{test_runs,test_worker_recovery,test_sse}.py`; compare `apps/api/src/{runs,generation-worker,kling,render-lease}.ts`.

**Interfaces:** Existing create/approve/detail/list/events routes and operation IDs; worker `claim_once()` atomically leases one task, `run(operation_id)` records submitted/unknown/succeeded/failed states. SSE replays events with `id: seq` after `Last-Event-ID`.

- [ ] Write failing tests for duplicate client request/approval IDs, concurrent quota claims, repeated worker claim, timeout after provider POST, restart from `unknown`, SSE resume and no duplicate event sequence.
- [ ] Implement transactions, lease renewal/recovery, provider adapter and independent worker process. Never place paid provider execution in FastAPI `BackgroundTasks`.
- [ ] Run focused Python tests with fake provider and two connections; compare Node task snapshots and SSE framing; commit.

### Task 7: 灵感、Agent 编辑、TTS 的独立任务族

**Files:** Create `apps/api-python/src/ai_video_api/tasks/{ideas,agent_edit,tts}.py`, `tests/{test_ideas,test_agent_edit,test_tts}.py`; compare `apps/api/src/{prompt-ideas,idea-agent-worker,agent-edit,tts,kling-tts}.ts`.

**Interfaces:** Preserve current request IDs, ownership, state enums, daily limits, pending/unknown behavior, supplier error mapping and existing routes; each family has one task owner and one executable worker.

- [ ] Write failing golden tests for initial three ideas plus one persisted expansion (maximum six), failed expansion preserving initial results, Agent edit confirmation idempotency and TTS voice/fee confirmation errors.
- [ ] Implement each family behind the existing provider interface; keep real provider calls disabled in automated tests.
- [ ] Run each focused Python suite and corresponding Node tests; verify no new route/JSON drift; commit each family separately when independently green.

### Task 8: FFmpeg 预览、剪辑与最终导出

**Files:** Create `apps/api-python/src/ai_video_api/{media.py,tasks/renders.py}`, `tests/{test_media_render,test_render_recovery}.py`; compare `apps/api/src/{episode-media,episode-renders,previews,render-worker,audio-render}.ts`.

**Interfaces:** Preview and final export read the same saved recipe/revision. `run_ffmpeg(args: list[str], timeout_s: float, output_path: Path)` starts an argument-vector subprocess, bounds concurrency, kills on timeout/cancel and removes incomplete output; completed output is registered once.

- [ ] Write failing real-media tests for exact duration, 15-second split, 12.3-second deletion, per-segment silence/30% gain, source audio mapping, preview/export parity, process failure and temp-file cleanup.
- [ ] Port ffprobe validation, FFmpeg graph creation and render-task lifecycle; preserve old assets and v3 original/voice/music behavior.
- [ ] Run focused Python tests with real generated media, existing Node media/render tests and manual playback of one output; commit.

### Task 9: 独立迁移命令、部署、三端验收与切流

**Files:** Create `apps/api-python/src/ai_video_api/migrate.py`, `apps/api-python/tests/test_migrate.py`, `deploy/docker/{Dockerfile.api-python,compose.python.yaml}`, `docs/acceptance/python-api-cutover.md`; modify `.codex/.agent/api.md`, `.codex/.agent/deployment.md` only after implementation is verified.

**Interfaces:** Python release image needs no Node runtime. Independent `python -m ai_video_api.migrate` bootstraps an empty database through historical schema 1–4 and refuses unknown/newer schema; normal API start performs read-only version check. Compose runs one API and one worker with the same existing database/object mounts and restricted runtime role.

- [ ] Write failing migration tests for empty DB, existing schema 4, unknown version, transaction rollback and restricted runtime role; retain immutable copies/checksums of historical SQL.
- [ ] Build pinned Python image on the target architecture; run isolated Compose with a private Redis service, restored PostgreSQL and copied objects with workers disabled, then exercise the route matrix and three clients. Confirm Redis has no host-published port, healthy status and memory cap.
- [ ] Run full Python and affected TS test/build suites, `pnpm check:boundaries`, Web browser flow, Tauri native flow and Expo device/simulator flow; record each as separate evidence.
- [ ] Rehearse maintenance gate: stop Node worker/API, take and restore backups, privately start Python API/one worker, check old account/project/media/task/SSE, then reopen traffic; test read-compatible rollback after a new Python write.
- [ ] Only after that rehearsal and release review, perform a supervised production cutover. Keep the old image and a written data-reconciliation path; never restore an old snapshot over newer writes.

## Self-review and completion gates

- Each route in Task 1 has a Python implementation and at least one success/failure or binary/streaming contract check; unexplained fixture differences block cutover.
- Old account, session, project, task and object IDs remain valid in a restored database; no reset or forced logout.
- All six task families have a persisted owner/lease and a recovery test; only one process can issue a given paid POST. Redis contains no sole copy of task state.
- Three client acceptance records distinguish automated API parity, browser behavior, native Tauri behavior and mobile behavior.
- A full rollback rehearsal demonstrates what happens after Python has accepted new writes; unresolved schema incompatibility blocks reopening public writes.

## Source references

Python/FastAPI/Pydantic: [Python tutorial](https://docs.python.org/3/tutorial/), [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/), [Pydantic JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/json_schema/). Database and workers: [Psycopg async/pool](https://www.psycopg.org/psycopg3/docs/advanced/async.html), [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/), [Python asyncio subprocess](https://docs.python.org/3/library/asyncio-subprocess.html). Dependency lock: [uv project lock/sync](https://docs.astral.sh/uv/concepts/projects/sync/).
