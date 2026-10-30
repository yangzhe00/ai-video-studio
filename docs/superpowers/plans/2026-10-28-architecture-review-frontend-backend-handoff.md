# Architecture Review Frontend and Backend Handoff Plan

> **For agentic workers:** Execute the assigned tasks in order, preserve unrelated work in the shared checkout, and report evidence for each acceptance check. The existing backend implementation plan remains the detailed checklist for its Tasks 1–4.

**Goal:** Fix the confirmed data-loss and compatibility defects, make cloud generation safer to operate, and finish the cross-platform user flows.

**Architecture:** Keep the current Tauri desktop, React web, Expo mobile, and Node API modular monolith. The API owns cloud documents, identity, paid operations, and provider keys; clients own local editing and presentation. Preserve old project documents through explicit migrations and use per-resource revisions for conflict detection.

**Tech Stack:** TypeScript, React 19, Tauri/Rust, Expo, Node.js, SQLite, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-28-cloud-agent-server-architecture-design.md`; backend detail: `docs/superpowers/plans/2026-10-28-backend-architecture-hardening.md`.

## Shared rules and ownership

- The working tree already contains uncommitted work. Do not reset, overwrite, or commit unrelated changes.
- The backend chat has already begun the timeline contract task and is editing `packages/project-core/src/sync.ts`, `apps/api/src/sync.ts`, `apps/desktop/src/lib/sync.ts`, `apps/web/src/App.tsx`, and `apps/mobile/src/App.tsx`. Backend owns those edits until it completes that task and reports the contract and test results. Frontend must wait for that handoff before editing those files.
- Do not silently merge conflicting project resources. Keep the local copy available until the user resolves a conflict.
- Never retry an uncertain paid provider POST with a new identity. Supplier credentials stay in the API process.
- Keep generated media and edited outputs immutable. Adding an edited version to an episode timeline requires an explicit user action.

## Phase 1: Complete the data contract

### Backend B1 — timeline and old-document compatibility (in progress)

**Files:** `packages/project-core/src/sync.ts`, `apps/api/src/sync.ts`, `apps/api/src/db.ts`, and the cross-client adapters already being edited under the backend plan.

- [ ] Finish `CloudTimelineClip` with stable `id`, `assetId`, `inMs`, `outMs`, `volume`; read legacy `timeline: string[]` without losing existing projects.
- [ ] Upgrade persisted cloud project JSON that lacks `timeline` or `characters`; backfill per-resource revisions transactionally. Do not rely on `CREATE TABLE IF NOT EXISTS` as a document migration.
- [ ] Reject a timeline command whose clip order and legacy asset ID order disagree, and reject references to missing or foreign objects.
- [ ] Prove a desktop trim/volume/clip ID survives push, pull, and reopen; prove an old cloud project opens and accepts a character or timeline command.
- [ ] Publish the final request/response fields and migration behavior to the frontend chat before it edits the client adapters.

### Frontend F1 — finish client adoption after B1 handoff

**Files:** `apps/desktop/src/lib/sync.ts`, `apps/web/src/App.tsx`, `apps/mobile/src/App.tsx`, and focused client tests.

- [ ] Review the backend's cross-client changes against the final `CloudTimelineClip` contract; preserve clip metadata when adding or reordering in all three clients.
- [ ] Show existing old-format timelines correctly, then save the new representation without creating duplicate clips.
- [ ] Check a real desktop project round trip and reload the web and mobile views; report which runtime checks were performed rather than relying on type checks alone.

## Phase 2: Remove blockers and protect user work

### Backend B2 — inputs, media, and operating limits

**Files:** `apps/api/src/server.ts`, `apps/api/src/config.ts`, `apps/api/src/runs.ts`, `apps/api/src/sync.ts`, `apps/api/src/auth.ts`, and API tests.

- [ ] Validate media content, dimensions/duration, and object type server-side before registering uploads; do not trust `Content-Type` alone.
- [ ] Validate nested episode, shot, character, canvas, and media references at the API boundary, with explicit 4xx errors for invalid payloads.
- [ ] Enforce per-account storage and global paid-generation limits before real provider use; make rate limiting durable or suitable for the intended deployment.
- [ ] Define and document upload/download limits consistently across API, desktop, and provider output; reject unsupported sizes before starting a dependent task.
- [ ] Verify forged MIME, malformed graphs, missing object IDs, quota exhaustion, and duplicate approvals with focused API tests.

### Frontend F2 — targeted upload and conflict resolution

**Files:** `apps/desktop/src/lib/sync.ts`, `apps/desktop/src/features/studio/StudioWorkspace.tsx`, `apps/desktop/src/features/projects/ProjectPicker.tsx`, plus relevant web/mobile flows.

- [ ] Upload the reference photo needed for generation without requiring every unrelated local video to upload first; show per-asset pending/failed state and allow retry without creating a new paid run.
- [ ] Before attaching an existing local project to a cloud project, detect local/remote differences and present keep-local, keep-cloud, or cancel choices per conflicting resource. Preserve a recoverable local copy.
- [ ] Show API validation, size, quota, and sync-conflict errors in actionable language; do not replace the local project after a failed push.
- [ ] Verify an oversized unrelated local video does not block photo generation, and a concurrent edit stops with both versions available for resolution.

## Phase 3: Durable rendering and clear output versions

### Backend B3 — render recovery and version semantics

**Files:** `apps/api/src/db.ts`, `apps/api/src/render-worker.ts`, `apps/api/src/video-edits.ts`, `apps/api/src/generation-worker.ts`, and tests.

- [ ] Finish the existing backend plan's SQLite migration, render lease, lease-expiry recovery, and explicit failed-render retry.
- [ ] Keep the original generated asset ID separately from edited output IDs; store which output is selected for a shot without rewriting the original identity. Migrate old shot records while preserving existing timeline references.
- [ ] Bound concurrent rendering and large-file memory use; keep unknown paid submissions in query/reconciliation state instead of resubmitting.
- [ ] Verify two workers cannot own one render simultaneously, crash recovery succeeds, and old/new media versions remain retrievable.

### Frontend F3 — explicit version selection

**Files:** shared video-result UI, `apps/web/src/App.tsx`, `apps/mobile/src/App.tsx`, and `apps/desktop/src/features/studio/StudioWorkspace.tsx` after backend handoff.

- [ ] Distinguish generated original, edited versions, and the currently selected preview in the UI.
- [ ] Make “use this version in the timeline” an explicit action; do not change an existing timeline clip automatically when rendering completes.
- [ ] Verify opening the editor again still starts from the intended original and that switching versions leaves prior files accessible.

## Phase 4: Maintenance and release gates

### Backend B4 — request-path performance and desktop security

- [ ] Complete the backend plan's async password hashing/media probing and bounded worker work; verify API requests and SSE stay responsive during rendering.
- [ ] Add a desktop CSP appropriate for local assets and the required APIs; narrow broad Tauri command access where possible.
- [ ] Run API tests, type checks, database migration tests, and boundary checks. Record any native packaging or paid-provider test that was not run.

### Frontend F4 — reduce contract drift and finish runtime acceptance

- [ ] Reuse shared API DTOs/validation for run, project, clip, and edit responses instead of maintaining divergent client interfaces; keep platform-specific transport adapters.
- [ ] Align static feature declarations with implemented routes and node types; do not introduce dynamic plugin loading for this milestone.
- [ ] Run desktop/web/mobile type and focused tests, then verify desktop launch and local project reopen, web reload, and mobile authentication/task recovery on a device or simulator.

## Final acceptance

- [ ] A legacy project opens, syncs, and remains editable after migration.
- [ ] Clip order, ID, trim, and volume survive desktop → cloud → desktop and web/mobile reorder.
- [ ] A failed or oversized unrelated upload does not block a valid photo-generation intent.
- [ ] Invalid media and foreign/missing references are rejected before paid work.
- [ ] Duplicate approvals reserve one credit; uncertain submissions never cause a second provider POST.
- [ ] A render can recover after a worker crash without duplicate ownership; original and edited versions remain available.
- [ ] Sync conflicts pause for explicit resolution and preserve the local copy.
