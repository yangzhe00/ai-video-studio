# Backend Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve desktop editing data during cloud sync and make the Node API safe to operate with real generation and recoverable rendering.

**Architecture:** Keep the existing Node API, SQLite ledger, and Tauri local adapter. Extend the cloud episode contract without breaking documents that store only asset IDs; enforce server-side aggregate limits in the same transaction as quota reservation; version database changes; claim render jobs with a durable lease.

**Tech Stack:** TypeScript, Node.js, `node:sqlite`, Vitest, Tauri/Rust, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-28-cloud-agent-server-architecture-design.md` and the current code review in this chat.

## Global Constraints

- Preserve pre-existing uncommitted work and legacy local projects.
- Keep supplier credentials and paid submissions on the API server.
- Keep generated and edited media objects immutable.
- Do not silently merge a conflicting cloud resource.

## Review Focus

- A trimmed desktop clip must retain its trim, volume, and ID after sync and reopen.
- A web or mobile timeline reorder must preserve the clip metadata supplied by desktop.
- Repeated run approval must reserve one account credit and respect the global credit cap.
- A crashed renderer must be reclaimable without simultaneous owners.
- Retrying a failed render for the same recipe must reuse the original render operation.

---

### Task 1: Preserve complete timeline clips across platforms

**Files:** `packages/project-core/src/sync.ts`, `apps/desktop/src/lib/sync.ts`, `apps/web/src/App.tsx`, `apps/mobile/src/App.tsx`, `apps/api/src/sync.ts`, focused tests.

**Interfaces:** Add `CloudTimelineClip` with stable `id`, `assetId`, `inMs`, `outMs`, and `volume`. Keep legacy `timeline: string[]` readable while `timelineClips` becomes the metadata-bearing representation.

- [x] Add a regression test for desktop trim/volume/ID preservation and legacy timelines.
- [x] Update cloud serialization and desktop pull to preserve complete clips.
- [x] Update web and mobile timeline writes to retain or create clip metadata when reordering or adding assets.
- [x] Validate that `timeline` and `timelineClips` represent the same order on the API.
- [x] Run focused tests and workspace type checks.

### Task 2: Bound paid generation and account storage

**Files:** `apps/api/src/config.ts`, `apps/api/src/runs.ts`, `apps/api/src/server.ts`, `.env.example`, API tests.

**Interfaces:** Add configurable global demo credit and storage limits; enforce the paid credit limit inside `approveRun`'s transaction. Apply per-account and total storage caps before accepting new objects.

- [x] Add tests for aggregate quota, duplicate approval, and storage limit responses.
- [x] Implement the limits without changing already approved runs.
- [x] Run API tests and type checks.

Implementation note: upload, generated output, and rendered output now use one object insertion path under `BEGIN IMMEDIATE`. A paid result that hits an object quota remains in a durable `storage_pending` staging file and is retried after capacity becomes available; its credit remains reserved until it is saved.

### Task 3: Migrate and recover render jobs

**Files:** `apps/api/src/db.ts`, `apps/api/src/render-worker.ts`, `apps/api/src/video-edits.ts`, API tests.

**Interfaces:** Version SQLite schema with `PRAGMA user_version`; add a render lease token and expiry. Only the current lease owner may complete or fail a render. An explicit retry resets a failed operation to pending and keeps its ID.

- [x] Add migration and lease/retry regression tests.
- [x] Implement schema migration and atomic job claim.
- [x] Implement explicit retry of a failed recipe revision.
- [x] Run API tests and type checks.

### Task 4: Remove synchronous media work from request handling

**Files:** `apps/api/src/auth.ts`, `apps/api/src/video-edits.ts`, `apps/api/src/server.ts`, `apps/desktop/src-tauri/src/export.rs`, focused tests.

**Interfaces:** Use asynchronous password hashing and media probing in API requests. Run desktop FFmpeg export as an async Tauri command so the application command thread does not wait for encoding.

- [x] Add or adapt focused tests around the request paths.
- [x] Convert blocking request work to async equivalents.
- [x] Verify API tests, desktop type/build checks, and boundary checks.
