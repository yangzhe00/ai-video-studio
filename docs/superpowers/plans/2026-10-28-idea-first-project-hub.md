# Idea-first prompts and project hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user turn one sentence into three editable single-shot prompt variants before explicitly selecting a project and approving any video generation, while moving the web project list out of Home.

**Architecture:** Keep account-scoped prompt ideas in the existing Node/SQLite API, separate from `agent_runs` and `operations`. Use a server-only configurable Chat Completions compatible text-model adapter. Share prompt UI between desktop and web; leave the video run/approval API and desktop sync protocol intact.

**Tech Stack:** Tauri 2, React, TypeScript, Node HTTP server, SQLite, pnpm/Vitest.

**Spec:** `docs/product/2026-10-28-idea-first-project-flow.md`; architecture review `docs/architecture/2026-10-28-idea-first-project-handoff.md`; clickable prototype `design/prototypes/idea-first-project-flow/index.html`.

## Global Constraints

- Three variants describe ONE shot, not three different multi-shot stories. The user selects and may edit only one before the existing 5/10-second image-to-video flow.
- No project is created by merely requesting ideas. No idea request or selection creates video `agent_runs`/`operations` or reserves video demo credits.
- Real text-model credentials are server-only. The client never supplies a model URL, name, or key. If the model is absent or malformed, show an honest error; no hidden template fallback.
- A same-ID replay reads the original idea set. A timed-out or uncertain external model POST is not silently repeated; an explicit new round gets a new request ID.
- Desktop without login keeps a local-only project. The user explicitly put sync bug fixing out of scope; do not alter desktop sync protocol.
- This checkout already has many unrelated uncommitted files. Never reset or overwrite others' changes. Each worker edits only assigned files; do not create commits in this shared dirty checkout.

## Review Focus

- Two simultaneous same-ID idea requests: one model call, same persisted result. Covered by Task 2 API test.
- Provider timeout or malformed response after an uncertain POST: no automatic repeat and no fabricated choices. Covered by Task 2 API test.
- User refreshes or changes device after selecting a variant: selection and final text reload. Covered by Task 2 and Task 4 tests.
- New project created from an idea and from the project library: both enter the correct workspace without making an unapproved video run. Covered by Task 4 and Task 6 acceptance.
- Desktop logged out or logged in without a valid cloud binding: never display "已同步云端". Covered by Task 5 test and Task 6 desktop screenshot.

---

### Task 1: Backend model adapter and database migration (Backend)

**Files:** Modify `apps/api/src/config.ts`, `apps/api/src/db.ts`, `.env.example`; create `apps/api/src/idea-model.ts`, `apps/api/src/idea-model.test.ts`.

**Interfaces:** `ApiConfig` gains `ideaModelBaseUrl`, `ideaModelApiKey`, `ideaModelId`, `ideaModelTimeoutMs`; `generatePromptVariants(config: ApiConfig, input: string): Promise<PromptVariant[]>` returns exactly three `{id,title,description,prompt}` values or a typed error. `prompt_idea_sets` is owner-scoped and unique on `(owner_id, client_request_id)`.

- [ ] Write adapter tests for a valid three-variant Chat Completions response, missing configuration, invalid/duplicate variants, provider error, timeout, and oversized response.
- [ ] Run `pnpm --filter @ai-video/api test -- idea-model` and confirm new tests fail before implementation.
- [ ] Implement server-only config and HTTP adapter using `POST /chat/completions` with `model` and `messages`, parse `choices[0].message.content`, validate fields/lengths/distinctness and cap timeout/bytes. Add database v6 migration for `prompt_idea_sets` without losing v5 data.
- [ ] Run focused tests, `pnpm --filter @ai-video/api build`, and a migration test on a copy of a v5 fixture.

### Task 2: Account-scoped prompt-idea API (Backend)

**Files:** Create `apps/api/src/prompt-ideas.ts`, `apps/api/src/prompt-ideas.test.ts`; modify `apps/api/src/server.ts`; optionally add DTO to `packages/agent-core/src/index.ts`.

**Interfaces:** `POST /prompt-ideas` body `{clientRequestId,input}` returns `{ideaSet}`; `GET /prompt-ideas` and `GET /prompt-ideas/:id` restore; `POST /prompt-ideas/:id/selection` body `{variantId,editedPrompt}` stores final snapshot. `state` is `pending | ready | failed | unknown`. `POST /projects/:id/runs` remains compatible with existing manual input.

- [ ] Write API tests for auth, input limit, exactly three variants, account separation, same-ID replay, same-ID/new-input 409, concurrent duplicate suppression, refresh recovery, selection/editing, model error, and unchanged video tables/credits.
- [ ] Run focused tests to see the missing-route failures.
- [ ] Implement persistence-before-call; release SQLite transaction before external HTTP. Keep `pending/unknown` durable after timeout or restart and never blindly resubmit the same ID. Validate selected variant ownership and prompt length. Add bounded per-account idea request limit.
- [ ] Run focused tests, full API tests, and API TypeScript build.

### Task 3: Project library summary (Backend, sequential after Task 2)

**Files:** Modify `apps/api/src/db.ts`, `apps/api/src/server.ts`, project update paths in `apps/api/src/sync.ts`, `generation-worker.ts`, `render-worker.ts` as applicable; update `apps/api/src/server.test.ts`.

**Interfaces:** `GET /projects` items retain existing `id,title,revision` and add `updatedAt` plus `recentEpisode` summary, sorted by `updatedAt DESC`; old projects backfill from `created_at`.

- [ ] Write migration/list tests for existing database, create, command update, and generated-result update; assert original owner isolation.
- [ ] Run focused tests to confirm failures.
- [ ] Add migration and update timestamps at each actual project-document write path; avoid changing resource revisions or sync rules. Return a bounded summary rather than full documents.
- [ ] Run API tests and build.

### Task 4: Shared ideas UI and web integration (Frontend)

**Files:** Create `packages/ui-web/src/PromptIdeas.tsx` and focused test; modify `packages/ui-web/src/index.ts`, styles; modify `apps/web/src/App.tsx`, `apps/web/src/styles.css`, focused web tests; adjust `packages/components/src/ProjectHome.tsx` only if shared home layout requires it.

**Interfaces:** Shared UI consumes `PromptIdeaSet` and callbacks `onRequest(input, clientRequestId)`, `onSelect(variantId, editedPrompt)`, `onReload(id)`; web calls the Task 2 routes using existing `api<T>()`. It hands final prompt to the existing `plan` path only after explicit project/episode/photo selection.

- [ ] Write component/web tests for three cards, edit/cancel/regenerate, loading/failure/unknown, refresh recovery, and no `/runs` call before final approval.
- [ ] Run targeted tests to confirm failures.
- [ ] Add Home idea input, restore recent idea sets, and separate Home from a dedicated Projects view. Remove inline project form and episode list from Home. Projects view supports cards, search, refresh, empty/error states, explicit create modal; successful create enters the project workspace.
- [ ] Wire selected prompt through project/episode/photo selection into the existing 5/10-second run plan, preserving manual prompt creation. Refresh the project list on entry.
- [ ] Run `pnpm --filter @ai-video/web test`, `pnpm --filter @ai-video/web build`, and shared UI tests.

### Task 5: Desktop entry and truthful cloud state (Frontend, sequential after shared UI)

**Files:** Modify `apps/desktop/src/App.tsx`, `apps/desktop/src/features/projects/ProjectPicker.tsx`, `apps/desktop/src/features/studio/StudioWorkspace.tsx`, `apps/desktop/src-tauri/src/cloud.rs`; add focused tests.

**Interfaces:** Account-scoped ideas call Task 2 through `cloudRequest`; Rust endpoint allowlist accepts `/prompt-ideas` and `/prompt-ideas/:id` without relaxing current host/session checks. Selected prompt enters existing project generation form; it never silently submits a video run.

- [ ] Write tests for logged-in idea entry, logged-out local project label, logged-in unbound label, selected-prompt handoff, and Rust path allowlist.
- [ ] Run focused tests to see failures.
- [ ] Integrate the shared idea UI in both no-project and project Home; preserve explicit local project creation/selection. Correct cloud label based on actual binding and sync state. Do not change `apps/desktop/src/lib/sync.ts`.
- [ ] Run desktop tests/build and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

### Task 6: Cross-role acceptance, screenshots and code review (Test + PM)

**Files:** Add `docs/acceptance/2026-10-28-idea-first-project-flow.md` and evidence under `docs/acceptance/evidence/2026-10-28/`.

- [ ] Test the API with an isolated SQLite directory and mock Chat Completions endpoint; record provider call count, idea IDs, unchanged video credits, and selected snapshot. Distinguish mock from real-model validation.
- [ ] In the actual web client, verify Home, three variants, selection/edit, Projects view, creation modal and final video approval; save screenshots with environment and time.
- [ ] In the actual Tauri window, verify logged-out local-only label and logged-in idea entry; save screenshots. If native launch is blocked, record the exact blocker rather than calling a build screenshot proof.
- [ ] Run focused tests, `pnpm test`, `pnpm build`, Rust checks as applicable, and `git diff --check`; stop if unrelated concurrent changes make a result ambiguous.
- [ ] Review the complete diff for secret leakage, account scope, duplicate external calls, hidden project creation, stale UI, accessibility and unexpected sync changes; record findings and fix blocking issues before handoff.

### Task 7: Web sidebar navigation correction (Frontend + Test)

**Design:** `docs/superpowers/specs/2026-10-29-web-sidebar-navigation-design.md`. **Files:** `apps/web/src/App.tsx`, `apps/web/src/styles.css`, related web tests; modify `packages/components/src/StudioChrome.tsx` only if a nullable active state is needed.

- [ ] Keep all five sidebar items navigable with and without an open project. Render a target-specific empty state when a project is required, with explicit Select/Create Project actions.
- [ ] Render Assets in the main stage for an open project; keep existing asset selection dialog for editor/import flows. Ensure visible content, selected style and `aria-current` agree; do not highlight Home for project library and idea flow substeps.
- [ ] Preserve the idea draft and selected context when switching tabs. Navigation never calls project-create or video-run APIs.
- [ ] Add web interaction tests for all five items without/with a project, assets, Home return and draft preservation; include actual web screenshots and a QA note.
