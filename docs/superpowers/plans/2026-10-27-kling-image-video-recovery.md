# Kling Image Video Recovery Implementation Plan

> **For agentic workers:** Implement these steps in the current task; a paid live call requires the user to click Generate.

**Goal:** Submit one durable Kling image-to-video job and recover its status after a lost response or network outage without automatic resubmission.

**Architecture:** Keep Kling HTTP and credential handling in Rust. Persist task intent and remote IDs in the project manifest before and after the network request. Expose typed generation commands through platform ports and show status in the desktop editor.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, reqwest, serde.

**Spec:** `docs/superpowers/specs/2026-10-27-kling-image-video-recovery-design.md`

## Global Constraints

- Only `kling-v2-5-turbo`, silent 5/10 second image-to-video tasks in this phase.
- `KLING_API_KEY` stays in Rust; no paid request runs during tests.
- Unknown submission outcomes never trigger a second POST automatically.

## Review Focus

- POST accepted but response lost: persist and query external ID.
- App restart during generation: show persisted task and allow query.
- Download interrupted: retry download without resubmitting generation.
- Missing source image: reject before creating a billable job.
- Existing project edits: preserve timeline, captions, and shot data when updating jobs.

### Task 1: Durable Kling client

**Files:** `apps/desktop/src-tauri/src/ai/kling.rs`, `apps/desktop/src-tauri/src/ai/types.rs`, `apps/desktop/src-tauri/src/project.rs`, `apps/desktop/src-tauri/Cargo.toml`

- [x] Add mock-server tests for submit response loss, query-only recovery, and registering a downloaded result after restart.
- [x] Implement pre-submit persistence and submit-once state machine.
- [x] Implement status retrieval and local output download.
- [x] Run focused Rust tests.

### Task 2: Desktop workflow

**Files:** `packages/platform-ports/src/index.ts`, `apps/desktop/src/lib/native.ts`, `apps/desktop/src/lib/ports.ts`, `apps/desktop/src/features/create/CreateVideo.tsx`, `apps/desktop/src/features/workspace/ProjectWorkspace.tsx`

- [x] Expose typed submit and refresh ports.
- [x] Show cost notice and one explicit Generate action for eligible silent shots.
- [x] Render persisted task states and a query-only recovery action.
- [x] Verify UI tests and workspace boundary check.
