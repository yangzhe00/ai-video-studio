# PostgreSQL Migration Implementation Plan

> 状态：仓库迁移已实现；线上切换未执行。API 和三端构建通过，桌面端有 3 个离线创建流程测试在当前检出状态下失败。

**Goal:** Move the cloud API's durable state from SQLite to PostgreSQL without changing three-client HTTP contracts or paid-operation identities.

**Architecture:** Use one PostgreSQL pool with a small asynchronous database interface; transaction callbacks pin statements to one client. Create the current schema as PostgreSQL tables, then import legacy SQLite rows during a stopped-write cutover. Preserve API and worker behavior while replacing SQLite-specific concurrency with explicit PostgreSQL locks.

**Tech Stack:** Node.js 24, TypeScript, `pg`, PostgreSQL, Vitest, legacy `node:sqlite` import only.

**Spec:** `docs/superpowers/specs/2026-10-29-postgresql-migration-design.md`

## Global Constraints

- Preserve all pre-existing uncommitted work and the local desktop `project.json` format.
- Preserve existing URL, Cookie, SSE and response contracts for Web, desktop and mobile.
- Never issue a second provider POST after an uncertain paid submission.
- Do not modify a production database or service until a tested cutover is reviewable.

## Review Focus

- Concurrent account/platform quota requests must not both pass the same remaining slot.
- Concurrent workers must not claim the same paid or render operation twice.
- A failed import must leave SQLite untouched and PostgreSQL empty.
- Existing operation IDs and event sequence numbers must survive import.
- An old project with timeline metadata and briefs must remain readable and writable.

---

### Task 1: PostgreSQL connection and current schema

**Files:** `apps/api/src/db.ts`, `apps/api/src/pg-db.ts`, `apps/api/src/config.ts`, `apps/api/package.json`, `.env.example`, focused tests.

**Interfaces:** `createDb(databaseUrl): Promise<PgDatabase>`; `db.prepare(sql).get/all/run` return promises; `db.transaction(async () => ...)` pins all nested queries to one connection.

- [x] Add tests for schema creation, connection failure and rollback.
- [x] Add `pg` pool adapter, SQL parameter translation, integer handling and current schema migration.
- [x] Require `DATABASE_URL` for API startup and document local PostgreSQL setup.
- [x] Run focused database tests and TypeScript.

### Task 2: Convert API modules and transaction invariants

**Files:** `apps/api/src/{auth,runs,sync,briefs,prompt-ideas,project-dsl,video-edits,object-capacity,server}.ts`, focused tests.

**Interfaces:** Existing exported business functions become async; request/response DTOs and status codes remain unchanged.

- [x] Convert prepared reads/writes and transaction blocks to awaited PostgreSQL calls.
- [x] Protect quota aggregates and resource/event sequence updates with transaction locks.
- [x] Verify auth, project command, media, idea and render API tests against PostgreSQL.

### Task 3: Convert workers and durable recovery

**Files:** `apps/api/src/{generation-worker,render-worker,render-lease,idea-agent-worker}.ts`, focused tests.

**Interfaces:** Worker tick/run methods remain async; use conditional updates and transaction-scoped database access.

- [x] Preserve paid POST claim, unknown-query recovery and `storage_pending` results.
- [x] Preserve render lease ownership, retry and object rollback.
- [x] Add two-connection race tests and run worker tests.

### Task 4: Import, cutover and cross-client verification

**Files:** `scripts/migrate-sqlite-to-postgres.mjs`, import tests, README, `.codex/.agent/api.md`, deployment notes.

**Interfaces:** Import takes explicit SQLite path and PostgreSQL URL; rejects nonempty target; emits counts/checks without secrets.

- [x] Add a legacy SQLite fixture and test complete import plus rollback/replay rejection.
- [x] Document stopped-write backup, verification, cutover and safe rollback.
- [x] Run API tests/build, boundary checks and affected three-client checks.
- [x] Report production cutover status separately from local code readiness.
