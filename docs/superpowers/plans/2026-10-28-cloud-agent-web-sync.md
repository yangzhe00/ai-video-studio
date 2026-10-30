# Cloud Agent, Web, and Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let registered users run one cloud photo-to-video Agent flow and open the same project, episode, task state, and result on desktop and web without duplicate paid submissions.

**Architecture:** A single demo API deployment stores accounts, project resources, object files, Agent runs, operations, and ordered events in a durable SQLite database plus a persistent object directory. Node's built-in HTTP/crypto/sqlite facilities avoid adding an unrelated framework; API and worker are separate modules in one process. The web client and desktop adapter call the same authenticated API, while desktop retains local editing/cache and syncs versioned commands.

**Tech Stack:** Node 24 (`node:http`, `node:crypto`, `node:sqlite`, `fetch`), TypeScript 6, React 19, Vite 8, pnpm, Vitest, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-10-28-agent-first-multiplatform-architecture-design.md`.

## Global Constraints

- The backend owns provider keys (`KLING_API_KEY` and optional Agent model key); never send them to clients or project JSON.
- Login is required for all new generation, including desktop projects.
- Every mutation has an owner/project authorization check and a stable request/operation ID.
- An uncertain provider POST is queried by saved external ID; it is never blindly reposted.
- Two users may register, but cannot read each other's projects, objects, events, or quotas.
- No real payments; per-account demo quota is checked and reserved server-side.
- Old local projects still open; first sync copies assets and never destroys the source directory.

## Review Focus

- Concurrent duplicate `clientRequestId` submissions return one `runId` and one operation.
- A lost provider POST response leaves `unknown` and subsequent refresh performs GET, not POST.
- Account B cannot fetch account A's object URL, event stream, or project by guessing IDs.
- A failed first upload or stale episode revision leaves the original local project intact and surfaces a conflict.
- Browser refresh and desktop restart recover the same `runId` and replay ordered events.

---

### Task 1: Durable authenticated API and project objects

**Files:** Create `apps/api/package.json`, `tsconfig.json`, `src/server.ts`, `src/db.ts`, `src/auth.ts`, `src/projects.ts`, `src/objects.ts`, `src/config.ts`, and focused tests; update workspace scripts and `.env.example` without committing secrets.

**Interfaces:** `createApi(config: ApiConfig): http.Server`; `Account{id,email,passwordHash}`; `Session{id,accountId,expiresAt}`; `Project{id,ownerId,revision,title}`; `Object{id,ownerId,sha256,mime,size,path}`. Routes include register, login/logout/me, project list/create/read, and authorized upload/download. Cookies are HttpOnly, SameSite=Lax and Secure in nonlocal HTTPS.

- [ ] Add tests for registration/login, duplicate email, session expiry, invalid payload, cross-account project/object denial, and upload size/type limits.
- [ ] Implement SQLite schema, password hashing, sessions, object storage and API routes. Require a persistent data directory and fail startup if required server secrets/config are missing.
- [ ] Run API tests and typecheck; manually register two accounts against a local server.
- [ ] Commit only task files.

### Task 2: Agent run ledger, events, approval, and demo quota

**Files:** Create `apps/api/src/runs.ts`, `events.ts`, `quota.ts`, `worker.ts`, tests; create `packages/agent-core/src/index.ts` and tests.

**Interfaces:** `POST /projects/:id/runs` accepts `{clientRequestId,episodeId,sourceAssetId,input}` and returns `{runId}`; `GET /runs/:runId` returns a snapshot; `GET /runs/:runId/events` streams ordered SSE; `POST /runs/:runId/approve` accepts a stable approval ID. `AgentRun`, `RunEvent(seq)`, `Operation(id,externalTaskId,remoteTaskId,state)` share IDs with task notifications. A deterministic validation plan is available when an Agent model key is not configured and is clearly labeled; it must not pretend to have model reasoning.

- [ ] Add tests for duplicate request keys with same/different payload, two-account isolation, quota reservation, approval, event replay, restart recovery, and unknown state.
- [ ] Implement transactional run creation, a single worker lease per run, ordered durable events and SSE reconnect from last sequence.
- [ ] Run focused tests and verify two browser clients receive the same run ID and event sequence.
- [ ] Commit only task files.

### Task 3: Backend-only Kling gateway and result attachment

**Files:** Create `apps/api/src/kling.ts`, `src/generation-worker.ts`, tests; update Agent worker and project episode result commands. Remove the desktop's new-submit route after the remote adapter is verified; keep legacy unknown task IDs for read-only reconciliation.

**Interfaces:** `submitGeneration(operationId)` first persists `externalTaskId=operationId`, then sends one provider POST. `refreshGeneration(operationId)` uses `remoteTaskId` or `externalTaskId` to query; success downloads a bounded video object and idempotently attaches an `EpisodeShot` referencing the result. Provider base URL/key are server-only configuration.

- [ ] Add mock HTTP tests for success, explicit reject, timeout after POST, missing remote ID, repeated GET success, and output download failure; assert POST count stays one for an uncertain operation.
- [ ] Verify the actual Kling request/response contract against official documentation before enabling a paid call; implement gateway and worker recovery.
- [ ] Run tests and a controlled single paid end-to-end generation only when a real key and user approval are available; otherwise report unverified live behavior.
- [ ] Commit only task files.

### Task 4: Versioned project sync and desktop cloud adapter

**Files:** Create `packages/project-core/src/sync.ts` and tests, `apps/desktop/src/lib/cloud.ts`, `apps/desktop/src/features/account/*`, sync status UI/tests; modify desktop platform ports and studio workspace.

**Interfaces:** `SyncCommand{id,projectId,resourceType,resourceId,baseRevision,payload}`; server handles commands idempotently and returns new revision or a conflict snapshot. The desktop stores account/project binding and pending commands in its local project, uploads media before metadata, and never enqueues paid work offline.

- [ ] Add tests for first upload failure, asset hash dedupe, same-command replay, stale same-episode revision conflict, account switch, offline queue, and old-project opening.
- [ ] Implement local/cloud mapping, progress and explicit per-resource conflict resolution; switch desktop generation to authenticated API and remove new local Kling POST calls.
- [ ] Run desktop/project-core tests and a fresh Tauri launch with a two-device sync check.
- [ ] Commit only task files.

### Task 5: Web application using shared UI

**Files:** Create `apps/web/package.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts` and focused UI tests; use `packages/ui-web` and `packages/design-tokens`.

**Interfaces:** Login/register, project/episode list, photo upload, editable shot plan, explicit quota confirmation, generation submit, run status/resume, result card and canvas plugin route. The web host uses the same project IDs and core commands as desktop; no Tauri imports or provider credentials.

- [ ] Add UI tests for auth errors, project switching, duplicate-click submit, refresh-to-resume, waiting approval, failed/unknown task and result attachment.
- [ ] Implement pages and SSE/poll fallback; mount canvas only through plugin registry.
- [ ] Run web tests/build and manually perform one account's full flow in a browser while checking a second account cannot see it.
- [ ] Commit only task files.
